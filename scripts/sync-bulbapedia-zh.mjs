// Ingestão da Bulbapedia pro catálogo CHINÊS SIMPLIFICADO (zh-cn) — roda
// LOCAL, nunca no CI (mesma regra do sync-bulbapedia-ja: wiki comunitário, e
// o resultado vai pro git). A regra é pura e testada em
// scripts/lib/bulbapedia-zh.mjs; aqui é só rede e fs.
//
// O que faz:
//   1. lê o "Template:Simplified Chinese Releases" (a lista de TODOS os sets
//      chineses, por era);
//   2. baixa o wikitext das páginas de set, 50 por requisição, e tira as
//      listas (número, nome inglês, tipo, raridade) com o código de cada set;
//   3. baixa o wikitext das páginas de CARTA, 50 por requisição, seguindo o
//      redirect pra impressão ocidental/japonesa: espécie, estágio e as
//      impressões EN/JP da carta (set, raridade, número) — qual delas é a
//      chinesa o build decide pela raridade;
//   4. grava data/zh-import/<setId>.json (versionado) — o build
//      (scripts/import-zh.mjs, sem rede) transforma isso em cartas, com a
//      imagem da impressão EN/JP que já está no catálogo.
//   Com --logos, baixa também o logo de cada set (thumb de 520px, o mesmo
//   tamanho do mirror-ja-set-logos) e grava data/set-logos/zh-cn/<setId>.webp,
//   que o mirror-set-logos carimba no chunk como logo CURADO. Precisa do sharp
//   instalado fora do repo (SHARP_DIR, como no mirror-r2).
//
// Educação: uma requisição por vez, ~1,1 s entre elas, User-Agent
// identificado. A rodada completa são ~250 requisições (~11 min). Página de
// carta já lida fica no cache e não é pedida de novo (--force refaz).
//
//   node scripts/sync-bulbapedia-zh.mjs                 # tudo
//   node scripts/sync-bulbapedia-zh.mjs --set CSV9.5C,CBB6C
//   node scripts/sync-bulbapedia-zh.mjs --no-cards      # só as listas (rápido)
//   node scripts/sync-bulbapedia-zh.mjs --logos         # + logos (precisa do SHARP_DIR)
//   node scripts/sync-bulbapedia-zh.mjs --force         # relê as páginas de carta
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { API, UA } from "./lib/bulbapedia.mjs";
import { TEMPLATE, releasePages, parseSetPage, juntarSets, completarDatas, parseCardPage, desambiguacao, compactarImpressoes, ordemNumero } from "./lib/bulbapedia-zh.mjs";
import { fetchJsonRetry, sleep } from "./lib/sync-common.mjs";

const RAIZ = new URL("../", import.meta.url);
const OUT = new URL("data/zh-import/", RAIZ);
const LOGOS = new URL("data/set-logos/zh-cn/", RAIZ);
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const SO = new Set((val("--set") || "").split(",").map((s) => s.trim()).filter(Boolean));
const INTERVALO_MS = 1100;
const LOTE = 50;
const HOJE = new Date().toISOString().slice(0, 10);

async function leJson(url, padrao) { try { return JSON.parse(await readFile(url, "utf8")); } catch { return padrao; } }

let ultima = 0;
async function api(params) {
  const espera = INTERVALO_MS - (Date.now() - ultima);
  if (espera > 0) await sleep(espera);
  ultima = Date.now();
  const q = new URLSearchParams({ format: "json", formatversion: "2", ...params });
  const j = await fetchJsonRetry(`${API}?${q}`, { headers: { "user-agent": UA, accept: "application/json" } });
  if (j && j.error) throw new Error(`API: ${j.error.code} ${j.error.info || ""}`);
  return j;
}

// Wikitext de várias páginas: { títuloPedido: { title (final), wikitext } | null }.
// Segue normalização e redirect (a página chinesa de uma carta quase sempre
// redireciona pra impressão ocidental).
async function wikitexts(titles) {
  const out = {};
  for (let i = 0; i < titles.length; i += LOTE) {
    const lote = titles.slice(i, i + LOTE);
    const j = await api({ action: "query", titles: lote.join("|"), redirects: "1", prop: "revisions", rvprop: "content", rvslots: "main" });
    const q = j.query || {};
    const norm = new Map((q.normalized || []).map((n) => [n.from, n.to]));
    const red = new Map((q.redirects || []).map((r) => [r.from, r.to]));
    const pagina = new Map((q.pages || []).map((p) => [p.title, p]));
    for (const t of lote) {
      let alvo = norm.get(t) || t;
      for (let k = 0; k < 5 && red.has(alvo); k++) alvo = red.get(alvo);
      const p = pagina.get(alvo);
      out[t] = p && !p.missing && p.revisions ? { title: p.title, wikitext: p.revisions[0].slots.main.content } : null;
    }
    if (titles.length > LOTE) process.stdout.write(`\r  ${Math.min(i + LOTE, titles.length)}/${titles.length} páginas`);
  }
  if (titles.length > LOTE) process.stdout.write("\n");
  return out;
}

// ── 1-2. sets ───────────────────────────────────────────────────────────────
const tpl = await api({ action: "parse", page: TEMPLATE, prop: "wikitext" });
const paginas = releasePages(tpl.parse.wikitext);
console.log(`template: ${paginas.length} página(s) de set`);
const textos = await wikitexts(paginas.map((p) => p.title));
const brutos = [];
const avisos = [];
for (const p of paginas) {
  const t = textos[p.title];
  if (!t) { avisos.push(`sem página: ${p.title}`); continue; }
  const r = parseSetPage(t.wikitext, p.title);
  if (r.semCodigo.length) avisos.push(`sem código (pulada): ${p.title} — ${r.semCodigo.join("; ")}`);
  for (const s of r.listas) brutos.push({ ...s, page: p.title, serieId: p.era ? p.era.id : "", serieName: p.era ? p.era.name : "" });
}
let sets = completarDatas(juntarSets(brutos));
if (SO.size) sets = sets.filter((s) => SO.has(s.setId));
console.log(`${sets.length} set(s), ${sets.reduce((n, s) => n + s.entries.length, 0)} carta(s) nas listas`);

// ── 3. páginas de carta ─────────────────────────────────────────────────────
// Cache por página: o que já foi lido não é pedido de novo.
await mkdir(OUT, { recursive: true });
const anteriores = new Map();
for (const f of (await readdir(OUT)).filter((f) => f.endsWith(".json") && !f.startsWith("_"))) {
  const c = await leJson(new URL(f, OUT), null);
  for (const card of (c && c.cards) || []) if (card.page && card.lida) anteriores.set(card.page, card);
}
const CAMPOS_DA_PAGINA = ["species", "stage", "dexId", "artist", "prints", "semPagina"];
const pedir = [];
if (!has("--no-cards")) {
  for (const s of sets) for (const e of s.entries) {
    if (!e.page) continue;
    if (!has("--force") && anteriores.has(e.page)) continue;
    pedir.push(e.page);
  }
}
const unicos = [...new Set(pedir)];
console.log(`páginas de carta: ${unicos.length} a ler${anteriores.size ? ` (${anteriores.size} no cache)` : ""}`);
const paginasCarta = unicos.length ? await wikitexts(unicos) : {};
// Promo: a página do número é desambiguação por língua; a cópia chinesa é
// outra página — segunda rodada só com essas.
const desamb = Object.entries(paginasCarta).map(([t, p]) => [t, p && desambiguacao(p.wikitext)]).filter(([, alvo]) => alvo);
if (desamb.length) {
  console.log(`desambiguação de promo: ${desamb.length} página(s)`);
  const alvos = await wikitexts([...new Set(desamb.map(([, a]) => a))]);
  for (const [t, a] of desamb) paginasCarta[t] = alvos[a] || null;
}

// ── 4. grava ────────────────────────────────────────────────────────────────
let comImpressao = 0, semPagina = 0, total = 0;
for (const s of sets) {
  const cards = [];
  for (const e of s.entries) {
    const card = { number: e.number, name: e.name, page: e.page, type: e.type, subtype: e.subtype, rarity: e.rarity, mark: e.mark };
    const velho = anteriores.get(e.page);
    const lida = e.page ? paginasCarta[e.page] : undefined;
    if (lida) {
      const info = parseCardPage(lida.wikitext);
      if (info.species) card.species = info.species;
      if (info.stage) card.stage = info.stage;
      if (info.dexId) card.dexId = info.dexId;
      if (info.artist) card.artist = info.artist;
      // As impressões vão CRUAS: qual delas é a chinesa (pela raridade) o
      // build decide (escolherImpressao), sem voltar ao wiki.
      if (info.prints.length) card.prints = compactarImpressoes(info.prints);
      card.lida = 1;
    } else if (lida === null) {
      card.semPagina = 1; card.lida = 1;
    } else if (velho) {
      for (const k of CAMPOS_DA_PAGINA) if (velho[k] != null) card[k] = velho[k];
      card.lida = 1;
    } else if (!e.page) {
      card.semPagina = 1;
    }
    if (card.prints) comImpressao++;
    if (card.semPagina) semPagina++;
    total++;
    cards.push(card);
  }
  cards.sort(ordemNumero);
  const arquivo = {
    page: s.page,
    at: HOJE,
    set: {
      id: s.setId, code: s.code, name: s.name, release: s.release || "",
      ...(s.releaseAprox ? { releaseAprox: true } : {}),
      // Total só quando a numeração IMPRIME um ("001/208"): Gem Pack ("01
      // 01/07") e promo ("001/SV-P") ficam vazios, como o S-P japonês — senão
      // a carta aparecia "01-01/196", um total que não existe na carta.
      total: s.total || "", serieId: s.serieId, serieName: s.serieName,
      logoFile: s.logo || ""
    },
    cards
  };
  // Uma carta por linha: diff legível no git e metade do tamanho do JSON
  // indentado campo a campo.
  const txt = `{\n "page": ${JSON.stringify(arquivo.page)},\n "at": ${JSON.stringify(arquivo.at)},\n "set": ${JSON.stringify(arquivo.set)},\n "cards": [\n${cards.map((c) => `  ${JSON.stringify(c)}`).join(",\n")}\n ]\n}\n`;
  await writeFile(new URL(`${s.setId}.json`, OUT), txt, "utf8");
}
console.log(`\nsync-bulbapedia-zh: ${sets.length} set(s), ${total} carta(s) — ${comImpressao} com impressões EN/JP na página, ${semPagina} sem página no wiki.`);
if (avisos.length) console.log(`\nAvisos:\n  ${avisos.join("\n  ")}`);

// ── logos (opcional) ────────────────────────────────────────────────────────
if (has("--logos")) {
  // SHARP_DIR = a pasta do PACOTE sharp, como no mirror-r2. Carregado por
  // require da pasta (o layout interno mudou entre versões do sharp).
  let sharp = null;
  try { const dir = process.env.SHARP_DIR || ""; sharp = dir ? createRequire(join(dir, "package.json"))(dir) : null; } catch { sharp = null; }
  if (!sharp) console.log("\n--logos: sem o sharp (SHARP_DIR=<pasta do pacote sharp>) — logos pulados.");
  if (sharp) {
    await mkdir(LOGOS, { recursive: true });
    // Logo da PÁGINA dividido entre as metades (Storming Emergence Radiant/
    // Verdant/Abundant, os pares a/b da Espada e Escudo) fica de fora: três
    // tiles com a arte idêntica é o que o fallback de nome existe pra evitar
    // — mesma regra do mirror-ja-set-logos com SV2D/SV2P.
    const usos = new Map();
    for (const s of sets) if (s.logo) usos.set(s.logo, (usos.get(s.logo) || 0) + 1);
    const comLogo = sets.filter((s) => s.logo && usos.get(s.logo) === 1);
    const arquivos = [...new Set(comLogo.map((s) => s.logo))];
    const urls = {};
    for (let i = 0; i < arquivos.length; i += LOTE) {
      const j = await api({ action: "query", titles: arquivos.slice(i, i + LOTE).map((f) => `File:${f}`).join("|"), prop: "imageinfo", iiprop: "url", iiurlwidth: "520" });
      for (const p of (j.query && j.query.pages) || []) {
        const ii = p.imageinfo && p.imageinfo[0];
        if (ii) urls[p.title.replace(/^File:/, "").replace(/_/g, " ")] = ii.thumburl || ii.url;
      }
    }
    let feitos = 0;
    for (const s of comLogo) {
      const u = urls[s.logo.replace(/_/g, " ")];
      if (!u) { console.log(`  logo ausente no Archives: ${s.setId} (${s.logo})`); continue; }
      await sleep(INTERVALO_MS);
      const r = await fetch(u, { headers: { "user-agent": UA } });
      if (!r.ok) { console.log(`  logo ${s.setId}: HTTP ${r.status}`); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      await sharp(buf).webp({ quality: 82, effort: 6 }).toFile(new URL(`${s.setId}.webp`, LOGOS).pathname);
      feitos++;
    }
    console.log(`logos: ${feitos} de ${comLogo.length} gravados em data/set-logos/zh-cn/`);
  }
}
