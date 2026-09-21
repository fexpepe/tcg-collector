// Ingestão da Bulbapedia pro catálogo JAPONÊS — roda LOCAL, nunca no CI.
//
// O que traz, por set (data/ja-enrich/<setId>.json, versionado):
//   cards: { <número>: { en, ja, page, type, rarity, mark, artist, image } }
// A lista do set (1 requisição) dá número, nome inglês, tipo e raridade; a
// página de cada carta (1 requisição por carta) dá o nome japonês, o
// ilustrador e o scan do Archives. O enrich-ja.mjs (passo do deploy, sem
// rede) aplica isso nos chunks, só em campo vazio: TCGdex > Bulbapedia >
// TCGCSV. O cliente nunca toca o wiki: texto vai pro git, imagem pro R2.
//
// Educação: um wiki comunitário — UMA requisição por vez, ~1 s entre elas,
// User-Agent identificado. Resumível: grava o arquivo do set a cada set e
// pula o que já está completo; `--limit` põe teto de páginas de carta por
// rodada (10 mil cartas ≈ 3 h no primeiro passe).
//
//   node scripts/sync-bulbapedia-ja.mjs --set SV4a,S-P     # esses sets
//   node scripts/sync-bulbapedia-ja.mjs --all              # todos os chunks ja
//   node scripts/sync-bulbapedia-ja.mjs --all --no-cards   # só as listas (rápido)
//   node scripts/sync-bulbapedia-ja.mjs --all --limit 500  # até 500 páginas de carta
//   node scripts/sync-bulbapedia-ja.mjs --names            # lista de expansões -> _set-names.json
//   node scripts/sync-bulbapedia-ja.mjs --probe "Shiny Treasure ex (TCG)"   # mostra o que o parser lê
//   node scripts/sync-bulbapedia-ja.mjs --probe-file pagina.html            # idem, de um HTML salvo
//   --force  refaz o set mesmo completo
//
// AVISO (20/09/2026): os parsers (scripts/lib/bulbapedia.mjs) foram escritos
// sem acesso ao wiki. Primeiro run: --probe num set e numa carta, comparar
// com o esperado em tests/bulbapedia.test.mjs, ajustar o parser se preciso.
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { API, UA, LISTA_DE_EXPANSOES, parseUrl, parseSetList, parseSetLists, escolherLista, parseCardPage, parseExpansionList } from "./lib/bulbapedia.mjs";
import { numberKey } from "./lib/enrich-ja.mjs";
import { sleep } from "./lib/sync-common.mjs";

const RAIZ = new URL("../", import.meta.url);
const CHUNKS = new URL("data/sets/ja/", RAIZ);
const OUT = new URL("data/ja-enrich/", RAIZ);
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const INTERVALO_MS = 1100;

async function leJson(url, padrao) { try { return JSON.parse(await readFile(url, "utf8")); } catch { return padrao; } }

let ultima = 0;
async function html(title) {
  const espera = INTERVALO_MS - (Date.now() - ultima);
  if (espera > 0) await sleep(espera);
  ultima = Date.now();
  const r = await fetch(parseUrl(title), { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${title}: HTTP ${r.status}`);
  const j = await r.json();
  if (j && j.error) { if (j.error.code === "missingtitle") return null; throw new Error(`${title}: ${j.error.code}`); }
  return j && j.parse ? j.parse.text : null;
}

// ── probe ───────────────────────────────────────────────────────────────────
function mostra(h) {
  const listas = parseSetLists(h);
  if (listas.length) {
    console.log(`lista de set: ${listas.length} tabela(s) — ${listas.map((l) => `${l.cards.length} carta(s), nº ${l.cards[0].number}…${l.cards[l.cards.length - 1].number}`).join(" | ")}`);
    console.log(JSON.stringify(parseSetList(h).slice(0, 5), null, 1));
    return;
  }
  console.log("página de carta:", JSON.stringify(parseCardPage(h), null, 1));
  const nomes = parseExpansionList(h);
  if (Object.keys(nomes).length) console.log(`lista de expansões: ${Object.keys(nomes).length}`, JSON.stringify(Object.entries(nomes).slice(0, 5)));
}
if (val("--probe-file")) { mostra(await readFile(val("--probe-file"), "utf8")); process.exit(0); }
if (val("--probe")) { const h = await html(val("--probe")); if (!h) { console.log("página não existe"); process.exit(1); } mostra(h); process.exit(0); }

await mkdir(OUT, { recursive: true });

// ── nomes traduzidos dos sets ───────────────────────────────────────────────
if (has("--names")) {
  const h = await html(LISTA_DE_EXPANSOES);
  const nomes = h ? parseExpansionList(h) : {};
  await writeFile(new URL("_set-names.json", OUT), JSON.stringify({
    _: "Nome japonês -> nome traduzido, da coluna 'Translated name' da lista de expansões da Bulbapedia (sync-bulbapedia-ja --names). É a fonte do JA_SET_EN do src/shared.js: set ja cujo nome do chunk esteja aqui e não esteja lá é candidato a entrar no mapa (copiar verbatim).",
    at: new Date().toISOString().slice(0, 10), names: nomes
  }, null, 1) + "\n", "utf8");
  console.log(`_set-names.json: ${Object.keys(nomes).length} nome(s)`);
  if (!has("--all") && !val("--set")) process.exit(0);
}

// ── quais sets ──────────────────────────────────────────────────────────────
const pedidos = (val("--set") || "").split(",").map((s) => s.trim()).filter(Boolean);
let setIds = pedidos;
if (has("--all")) setIds = (await readdir(CHUNKS)).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
if (!setIds.length) { console.log("nada pedido: use --set A,B ou --all (ou --names / --probe)."); process.exit(0); }

// Título da página: _pages.json > JA_SET_EN (shared.js) + " (TCG)" > nome do chunk se ASCII + " (TCG)".
const pages = (await leJson(new URL("_pages.json", OUT), {})).pages || {};
const shared = await readFile(new URL("src/shared.js", RAIZ), "utf8");
const m = /const JA_SET_EN = (\{[\s\S]*?\n  \});/.exec(shared);
const JA_SET_EN = m ? new Function(`return ${m[1]}`)() : {};
function tituloDe(setId, chunk) {
  if (pages[setId]) return pages[setId];
  if (JA_SET_EN[setId]) return `${JA_SET_EN[setId]} (TCG)`;
  const nome = chunk && chunk[0] && chunk[0].set;
  if (nome && /^[\x20-\x7E]+$/.test(nome)) return `${nome} (TCG)`;
  return "";
}

const LIMITE = Number(val("--limit")) || Infinity;
let paginasDeCarta = 0;
const semTitulo = [], semPagina = [];
for (const setId of setIds) {
  const chunk = await leJson(new URL(`${setId}.json`, CHUNKS), null);
  const arquivo = new URL(`${setId}.json`, OUT);
  const cache = await leJson(arquivo, null) || { page: "", at: "", cards: {} };
  const titulo = tituloDe(setId, chunk) || cache.page;
  if (!titulo) { semTitulo.push(setId); continue; }
  if (paginasDeCarta >= LIMITE) { console.log(`${setId}: teto de páginas por rodada atingido; fica pra próxima.`); continue; }
  // Lista do set: só quando ainda não há cache (ou --force).
  if (!Object.keys(cache.cards).length || has("--force")) {
    const h = await html(titulo);
    if (!h) { semPagina.push(`${setId} ("${titulo}")`); continue; }
    // A página de uma expansão com par ocidental traz a lista dela E a nossa:
    // fica a que casa com o total do set (denominador do número), senão a de
    // contagem mais próxima da do chunk.
    const listas = parseSetLists(h);
    const total = chunk && chunk[0] ? Number(chunk[0].setTotal) || 0 : 0;
    const lista = escolherLista(listas, { total, count: chunk ? chunk.length : 0 });
    if (!lista) { semPagina.push(`${setId} ("${titulo}": página sem lista de cartas)`); continue; }
    cache.page = titulo;
    // Lista refeita (--force): tipo e raridade vêm de novo por cima (o 1º run
    // gravou colunas deslocadas); nome japonês e ilustrador das páginas já
    // lidas ficam; imagem que não é scan (.jpg) sai, pra ser buscada de novo.
    for (const c of lista.cards) {
      const k = numberKey(c.number);
      if (!k) continue;
      const atual = cache.cards[k] || {};
      if (atual.image && !/\.jpe?g$/i.test(atual.image)) { delete atual.image; delete atual.semScan; }
      cache.cards[k] = Object.assign(atual, { en: c.en, page: c.page, type: c.type, rarity: c.rarity, mark: c.mark });
    }
    console.log(`${setId}: "${titulo}" — ${lista.cards.length} carta(s) na lista${listas.length > 1 ? ` (${listas.length} tabelas na página; ficou a nº ${lista.cards[0].number}…)` : ""}`);
  }
  // Páginas de carta: nome japonês, ilustrador e scan — só o que falta.
  // `semScan`: a página foi lida e não tem .jpg (vintage sem scan no wiki);
  // não se insiste a cada rodada.
  if (!has("--no-cards")) {
    let feitas = 0;
    for (const [k, c] of Object.entries(cache.cards)) {
      if (!c.page || (c.ja && c.artist && (c.image || c.semScan))) continue;
      if (paginasDeCarta >= LIMITE) break;
      try {
        const h = await html(c.page);
        paginasDeCarta++; feitas++;
        if (!h) { c.page = ""; continue; }
        const p = parseCardPage(h);
        if (p.ja) c.ja = p.ja;
        if (p.artist) c.artist = p.artist;
        if (p.rarity && !c.rarity) c.rarity = p.rarity;
        if (p.image) { c.image = p.image; delete c.semScan; } else c.semScan = 1;
        if (!p.ja && !p.artist) c.page = ""; // página existe mas não tem infobox de carta: não insistir
      } catch (e) { console.log(`  ${setId} #${k}: ${e.message}`); }
      if (feitas % 25 === 0) await writeFile(arquivo, JSON.stringify(cache, null, 1) + "\n", "utf8");
    }
    if (feitas) console.log(`${setId}: ${feitas} página(s) de carta lidas`);
  }
  cache.at = new Date().toISOString().slice(0, 10);
  await writeFile(arquivo, JSON.stringify(cache, null, 1) + "\n", "utf8");
}
if (semTitulo.length) console.log(`\nSem título de página (entrar em data/ja-enrich/_pages.json): ${semTitulo.join(", ")}`);
if (semPagina.length) console.log(`\nPágina não encontrada ou sem lista (conferir o título em _pages.json): ${semPagina.join("; ")}`);
console.log(`\nsync-bulbapedia-ja: ${setIds.length} set(s) pedidos, ${paginasDeCarta} página(s) de carta nesta rodada.`);
