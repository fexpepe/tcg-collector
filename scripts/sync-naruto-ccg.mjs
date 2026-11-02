// Naruto CCG (Bandai USA, 2006–2013): o jogo de cartas AMERICANO — 28 sets
// principais + Shinobi's Dream (29, cancelado; a checklist existe), 4
// Tournament Packs, 4 tins e promos. Numeração GLOBAL por tipo de carta
// (N-/J-/M-/PR-…) que atravessa o jogo inteiro — inclusive TPs e tins têm
// faixas próprias (J-1030, N-1831…), então o código oficial é chave única.
//
// Fonte: narutocards.ca (catálogo fã, Next.js renderizado no servidor) — cada
// página de set traz TODAS as cartas com aria-label "Nome, CÓDIGO, RARIDADE"
// e scan no CDN próprio (cdn.narutocards.ca, URL previsível por código).
// Padrão-snapshot: o build parte de data/vintage/naruto-ccg.json; o fetch só
// atualiza quando responde e não regride. ANEXA ao catálogo do Naruto
// (ids nrt-ccg-*); roda DEPOIS dos outros syncs do Naruto no CI.
//
// COMPLEMENTO (2026-11-02): o narutocards não tem ~400 cartas dos sets 3–15
// (buracos na numeração: o Approaching Wind tem 90 lá e 163 no ccgtrader).
// Elas vêm de data/vintage/naruto-ccg-complemento.json — N-CCG-DB (código
// impresso + scan) cruzado com o ccgtrader (raridade), montado à mão por
// scripts/naruto-ccg-complemento.mjs — e entram no set de origem DEPOIS das
// do narutocards, que ganham sempre que o código já existe. O mesmo arquivo
// marca as cartas nossas que são de Starter Deck (o narutocards as dá como
// U/C).
//
// NÚMERO IMPRESSO (2026-11-02): do set 17 em diante (e nas missões do 16, nos
// Tournament Packs e nas tins) o código do narutocards NÃO é o impresso — ele
// renumerou em sequência. data/vintage/naruto-ccg-numero-impresso.json
// (montado por scripts/naruto-ccg-numero-impresso.mjs) dá, por código do
// narutocards, o número impresso e o scan do N-CCG-DB (750×1050, contra os
// 214×300 de lá, que ainda se repetem entre cartas de mesmo nome). O sync
// troca só o `number` e a imagem; o id continua o código do narutocards, que
// é o que está publicado.
//
//   node scripts/sync-naruto-ccg.mjs             # fetch + build
//   node scripts/sync-naruto-ccg.mjs --no-fetch  # só build
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog, decodeEntities, sleep } from "./lib/sync-common.mjs";
import { FAN_IMG, codigoCanonico } from "./naruto-ccg-complemento.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/naruto/", ROOT);
const SNAP = new URL("data/vintage/naruto-ccg.json", ROOT);
const COMPLEMENTO = new URL("data/vintage/naruto-ccg-complemento.json", ROOT);
const NUMERO_IMPRESSO = new URL("data/vintage/naruto-ccg-numero-impresso.json", ROOT);
const CACHE_DIR = new URL("data/.cache/", ROOT);
const BASE = "https://www.narutocards.ca/sets/bandai-ccg/";
const CDN = "cdn.narutocards.ca/bandai-ccg/";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
const NO_FETCH = process.argv.includes("--no-fetch");

// Imagem CURADA do dono: assets/cards/naruto/<id>.* substitui o scan remoto
// (mesmo mecanismo dos outros syncs do Naruto).
function curatedImg(id) {
  for (const ext of ["webp", "jpg", "png"]) {
    if (existsSync(fileURLToPath(new URL(`assets/cards/naruto/${id}.${ext}`, ROOT)))) {
      return `/assets/cards/naruto/${id}.${ext}`;
    }
  }
  return "";
}

// Os 38 subsets, na ordem de numeração da fonte. História encerrada (jogo
// cancelado em maio/2013) — a lista é fixa.
//
// `date` é CURADORIA (a fonte não expõe data): dia exato quando documentado
// (Wikipedia rev. 251396543 pré-deleção, PreviewsWorld In-Shops, ICv2),
// dia 01 quando a fonte só dá o mês (ToyWiz) ou é estimativa por cadência
// (a Bandai manteve ritmo trimestral fev/mai/ago/nov de 2008 a 2013).
//
// `skip`: fica no snapshot (espelho fiel da fonte) mas NÃO entra no catálogo.
// O "set 29" (Shinobi's Dream) é criação FÃ da comunidade de Organized Play
// pós-cancelamento (~2018) — a Bandai nunca o anunciou; catalogá-lo como set
// real poluiria coleção/progresso. Reativar = tirar o skip.
//
// Fora da fonte (sem checklist lá): as tins #1–#5 (2007–2009); os packs
// delas eram de sets normais e as promos exclusivas moram na série PR.
const SETS = [
  { key: "s01",   slug: "bandai-ccg-01",    name: "The Path to Hokage",        date: "2006-04-28" },
  { key: "s02",   slug: "bandai-ccg-02",    name: "Coils of the Snake",        date: "2006-07-28" },
  { key: "s03",   slug: "bandai-ccg-03",    name: "Curse of the Sand",         date: "2006-10-01" },
  { key: "s04",   slug: "bandai-ccg-04",    name: "Revenge and Rebirth",       date: "2007-02-16" },
  { key: "s05",   slug: "bandai-ccg-05",    name: "Dream Legacy",              date: "2007-05-11" },
  { key: "s06",   slug: "bandai-ccg-06",    name: "Eternal Rivalry",           date: "2007-07-27" },
  { key: "s07",   slug: "bandai-ccg-07",    name: "Quest for Power",           date: "2007-10-26" },
  { key: "s08",   slug: "bandai-ccg-08",    name: "Battle of Destiny",         date: "2008-01-25" },
  { key: "s09",   slug: "bandai-ccg-09",    name: "The Chosen",                date: "2008-05-16" },
  { key: "s10",   slug: "bandai-ccg-10",    name: "Lineage of Legends",        date: "2008-08-29" },
  { key: "s11",   slug: "bandai-ccg-11",    name: "Approaching Wind",          date: "2008-11-28" },
  { key: "s12",   slug: "bandai-ccg-12",    name: "A New Chronicle",           date: "2009-02-20" },
  { key: "s13",   slug: "bandai-ccg-13",    name: "Fateful Reunion",           date: "2009-05-01" },
  { key: "s14",   slug: "bandai-ccg-14",    name: "Emerging Alliance",         date: "2009-08-01" },
  { key: "s15",   slug: "bandai-ccg-15",    name: "Foretold Prophecy",         date: "2009-11-11" },
  { key: "s16",   slug: "bandai-ccg-16",    name: "Broken Promises",           date: "2010-02-24" },
  { key: "s17",   slug: "bandai-ccg-17",    name: "Will of Fire",              date: "2010-05-26" },
  { key: "s18",   slug: "bandai-ccg-18",    name: "Fangs of the Snake",        date: "2010-08-01" },
  { key: "s19",   slug: "bandai-ccg-19",    name: "Path of Pain",              date: "2010-11-10" },
  { key: "s20",   slug: "bandai-ccg-20",    name: "Tales of the Gallant Sage", date: "2011-02-01" },
  { key: "s21",   slug: "bandai-ccg-21",    name: "Shattered Truths",          date: "2011-05-01" },
  { key: "s22",   slug: "bandai-ccg-22",    name: "Weapons of War",            date: "2011-08-01" },
  { key: "s23",   slug: "bandai-ccg-23",    name: "Invasion",                  date: "2011-11-18" },
  { key: "s24",   slug: "bandai-ccg-24",    name: "Sage's Legacy",             date: "2012-02-01" },
  { key: "s25",   slug: "bandai-ccg-25",    name: "Kage Summit",               date: "2012-05-01" },
  { key: "s26",   slug: "bandai-ccg-26",    name: "Avenger's Wrath",           date: "2012-09-01" },
  { key: "s27",   slug: "bandai-ccg-27",    name: "Hero's Ascension",          date: "2012-12-01" },
  { key: "s28",   slug: "bandai-ccg-28",    name: "Ultimate Ninja Storm 3",    date: "2013-03-01" },
  { key: "s29",   slug: "bandai-ccg-29",    name: "Shinobi's Dream",           date: "", skip: true },
  { key: "tp1",   slug: "bandai-ccg-tp1",   name: "Tournament Pack 1",         date: "2010-07-07" },
  { key: "tp2",   slug: "bandai-ccg-tp2",   name: "Tournament Pack 2",         date: "2011-01-05" },
  { key: "tp3",   slug: "bandai-ccg-tp3",   name: "Tournament Pack 3",         date: "2011-07-01" },
  { key: "tp4",   slug: "bandai-ccg-tp4",   name: "Tournament Pack 4",         date: "2012-01-01" },
  { key: "tin1",  slug: "bandai-ccg-tin1",  name: "Fierce Ambitions (Tin)",    date: "2010-03-01" },
  { key: "tin2",  slug: "bandai-ccg-tin2",  name: "Untouchables (Tin)",        date: "2010-10-01" },
  { key: "tin3",  slug: "bandai-ccg-tin3",  name: "Ultimate Battle (Tin)",     date: "2011-03-01" },
  { key: "tin4",  slug: "bandai-ccg-tin4",  name: "Rebirth (Tin)",             date: "2011-11-01" },
  // Série PR corrente (2006–2013, revistas/tins/torneios/jogos): sem data
  // única possível; ancora no lançamento do jogo pra ordenação estável.
  { key: "promo", slug: "bandai-ccg-promo", name: "Promotional Cards",         date: "2006-04-28" }
];

// RARIDADE: a fonte dá uma sigla própria, e o próprio narutocards marca o dado
// como "Unverified" — conferi set a set contra o ccgtrader.net (2026-11-01,
// 28 sets, contagem por raridade) e a tradução é esta:
//   - UR (sets 3–22, TPs, tin 1), SR (sets 1–2 e 23–28) e MR (2 cartas, que o
//     site chama de "Movie Rare") são TODAS a Super Rare do jogo — a de 3
//     pontos, dourada. Nos sets 4, 7 e 8 a contagem de UR bate 1:1 com a de
//     Super Rare do ccgtrader;
//   - F, que o site chama de "Foil", é a carta de STARTER DECK (ponto
//     vermelho): as 13 F do set 1 são as 12 "Starter Deck" do ccgtrader + 1
//     Haku, e as 10 do Hero's Ascension estão entre as 12 de lá. Nos outros
//     sets a fonte não separa o starter (vem com a raridade nominal);
//   - PR = Promo. O nome vai por extenso, como está no verso do Narutopedia e
//     no ccgtrader — sigla solta ("UR") no filtro não diz nada a ninguém.
export const RARIDADE = {
  C: "Common", U: "Uncommon", R: "Rare",
  SR: "Super Rare", UR: "Super Rare", MR: "Super Rare",
  F: "Starter Deck", PR: "Promo",
  // s29 (Shinobi's Dream, fora do catálogo) vem com "UNKNOWN": vazio, um chip
  // "UNKNOWN" na UI seria ruído, não informação.
  UNKNOWN: ""
};

// FOIL PARALELO: todo booster trazia um foil de raridade aleatória, e cada set
// saiu em duas embalagens — numa o foil tem padrão de DIAMANTE, na outra
// ONDULADO (Narutopedia, "Naruto Collectible Card Game" › Rarity; anúncios
// "Wavy Foil / Diamond Foil" dos sets 4–8 confirmam). Vale pra Common,
// Uncommon e Rare de booster; a Super Rare já é dourada e não tem paralelo, e
// carta de starter, TP, tin ou promo não sai em booster. A "Normal" continua a
// primeira (e a padrão): é sob ela que as coleções já marcadas estão.
const FOIL_PARALELO = new Set(["Common", "Uncommon", "Rare"]);
const VERSOES_FOIL = ["Normal", "Diamond Foil", "Wavy Foil"];

// Raridade e versões de uma carta da fonte. `setKey` é a chave do SETS: só
// set de booster (s01…s28) tem foil paralelo. Sigla que a tabela não conhece
// passa crua (e aparece no filtro) em vez de sumir — é o sinal de que a fonte
// mudou o vocabulário. O complemento já manda o nome por extenso ("Starter
// Deck", "Common"), que passa pelo mesmo caminho.
export function raridadeEVersoes(setKey, sigla) {
  const rarity = Object.prototype.hasOwnProperty.call(RARIDADE, sigla) ? RARIDADE[sigla] : sigla;
  const booster = /^s\d+$/.test(setKey);
  return { rarity, variants: booster && FOIL_PARALELO.has(rarity) ? [...VERSOES_FOIL] : ["Normal"] };
}

const scanDoFan = (img) => `https://wsrv.nl/?url=${encodeURIComponent(FAN_IMG + img)}&w=440&output=webp`;

// Cartas de um set do snapshot + o complemento do mesmo set. Do narutocards
// sai { code, numero, name, rarity: sigla, scan: url|"" }: `code` é o dele
// (de onde sai o id), `numero` o impresso, que o de-para do número impresso
// (`impresso`: código do narutocards → { numero?, img? }) corrige, e o scan
// o do N-CCG-DB quando o de-para tem. Do complemento a raridade já vem por
// extenso, e código e número são o impresso. Código que o narutocards já tem
// (mesmo com outra grafia, NC-001 × N-C001, ou só como número impresso) não
// entra de novo.
export function cartasDoSet(set, def, comp, impresso) {
  const doNc = set.cards.map((c) => {
    const imp = (impresso && impresso[c.code]) || {};
    return {
      code: c.code,
      numero: imp.numero || c.code,
      name: c.name,
      rarity: comp && comp.starter && comp.starter.includes(c.code) ? "Starter Deck" : c.rarity,
      scan: imp.img ? scanDoFan(imp.img)
        : c.img ? `https://wsrv.nl/?url=${encodeURIComponent(`${CDN}${def.slug}/${c.code}-EN.jpg`)}&w=440&output=webp` : ""
    };
  });
  if (!comp) return doNc;
  const tem = new Set(doNc.flatMap((c) => [codigoCanonico(c.code), codigoCanonico(c.numero)]));
  const extra = comp.cards.filter((c) => !tem.has(codigoCanonico(c.code))).map((c) => ({
    code: c.code,
    numero: c.code,
    name: c.name,
    rarity: c.rarity,
    scan: c.img ? scanDoFan(c.img) : ""
  }));
  return doNc.concat(extra);
}

async function fetchPage(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25000) });
      if (r.ok) return await r.text();
    } catch (e) { /* retry */ }
    await sleep(1200 * (i + 1));
  }
  return null;
}

async function cached(name, getter) {
  const file = new URL(name, CACHE_DIR);
  try { return await readFile(file, "utf8"); } catch { /* sem cache */ }
  const text = await getter();
  if (text) { await mkdir(CACHE_DIR, { recursive: true }); await writeFile(file, text, "utf8"); }
  return text;
}

// Cada carta é um <article aria-label="Nome, CÓDIGO, RARIDADE">. O (.+) guloso
// ancora no ÚLTIMO ", código, raridade" — nome com vírgula não quebra. `img`
// marca se o scan existe no CDN (a página só referencia o arquivo quando tem).
function parseCards(html, slugName) {
  const cards = [];
  const seen = new Set();
  for (const m of html.matchAll(/aria-label="([^"]+)"/g)) {
    const t = decodeEntities(m[1]);
    const mm = t.match(/^(.+), ([A-Z]{1,3}-[A-Za-z0-9]+), (.+)$/);
    if (!mm || seen.has(mm[2])) continue;
    seen.add(mm[2]);
    const card = { code: mm[2], name: mm[1], rarity: mm[3] };
    if (html.includes(`${slugName}%2F${mm[2]}-EN.jpg`)) card.img = 1;
    cards.push(card);
  }
  return cards;
}

async function refreshSnapshot(existing) {
  const sets = [];
  let missed = 0;
  for (const def of SETS) {
    const html = await cached(`naruto-ccg-${def.slug}.html`, () => fetchPage(BASE + def.slug));
    if (!html) { missed++; console.log(`  ${def.slug}: inacessível`); continue; }
    const cards = parseCards(html, def.slug);
    if (cards.length) sets.push({ key: def.key, cards });
    await sleep(350); // gentileza com o site de fã
  }
  if (missed && !sets.length) { console.log("  narutocards.ca inacessível — segue com o snapshot versionado."); return existing; }
  const candidate = { source: BASE, updatedAt: new Date().toISOString().slice(0, 10), sets };
  const newCount = snapshotCardCount(candidate);
  const oldCount = snapshotCardCount(existing);
  console.log(`  narutocards.ca: ${sets.length} sets, ${newCount} cartas (snapshot: ${oldCount}).`);
  if (newCount < oldCount) { console.log(`  ⚠ REGRESSÃO (${newCount} < ${oldCount}) — snapshot mantido.`); return existing; }
  if (newCount !== oldCount) await writeSnapshot(SNAP, candidate);
  return (await readSnapshot(SNAP)) || candidate;
}

// O catálogo da linha, sem disco (os testes chamam com os snapshots).
//
// O ID SAI DO CÓDIGO DO NARUTOCARDS, nunca do `number`. Até 2026-11-02 havia
// aqui um mapa "número -> id já publicado" (ids pegajosos), inofensivo enquanto
// número e código eram a mesma coisa. Com o número impresso eles se separam, e
// o mapa viraria ladrão: o catálogo publicado tem o Neji como N-880 (código do
// narutocards; impresso, 883), e a carta impressa N-880 (Yamato, do TP1) ou a
// que passa a ser N-883 herdariam o id de outra. O id de quem já está
// publicado é exatamente nrt-ccg-<código>, então nenhum muda; o de-para
// (data/vintage/naruto-ccg-numero-impresso.json) é a ponte explícita.
export function montaLinha(snap, complemento, impresso) {
  const defByKey = new Map(SETS.map((d) => [d.key, d]));
  const compByKey = new Map(((complemento && complemento.sets) || []).map((s) => [s.key, s]));
  const impressoDe = (impresso && impresso.sets) || {};
  const line = [];
  let doComplemento = 0;
  for (const s of snap.sets) {
    const def = defByKey.get(s.key);
    if (!def || def.skip) continue;
    const setId = `nrt-ccg-${def.key}`;
    const cartas = cartasDoSet(s, def, compByKey.get(s.key), impressoDe[s.key]);
    doComplemento += cartas.length - s.cards.length;
    for (const c of cartas) {
      const cardId = `nrt-ccg-${c.code.toLowerCase()}`;
      const { rarity, variants } = raridadeEVersoes(def.key, c.rarity);
      line.push({
        id: cardId,
        name: c.name,
        // Só o nome do set: o jogo já está no cabeçalho, no logo e no
        // endereço (/games/naruto-ccg). Até 2026-11-02 era "Naruto CCG — …"
        // (contrato 7 do docs/CATALOGO.md; o 301 dos endereços antigos sai de
        // scripts/data/sets-renomeados.json).
        set: def.name,
        setId,
        number: c.numero,
        setTotal: cartas.length,
        setReleaseDate: def.date,
        rarity,
        artist: "",
        language: "en",
        image: curatedImg(cardId) || c.scan,
        variants,
        setLogo: "/assets/games/game_naruto_ccg-v2.webp",
        vintage: true,
        vintageLine: "nrt-ccg"
      });
    }
  }
  return { line, doComplemento };
}

async function run() {
  console.log("Naruto CCG (Bandai USA 2006–2013, vintage EN)");
  let snap = await readSnapshot(SNAP);
  if (!NO_FETCH) snap = await refreshSnapshot(snap);
  if (!snap || !snapshotCardCount(snap)) { console.log("  snapshot vazio — nada a construir."); return; }

  const complemento = await readSnapshot(COMPLEMENTO);
  const impresso = await readSnapshot(NUMERO_IMPRESSO);
  const { line, doComplemento } = montaLinha(snap, complemento, impresso);
  const semImg = line.filter((c) => !c.image).length;
  const renumeradas = line.filter((c) => c.id !== `nrt-ccg-${c.number.toLowerCase()}`).length;
  console.log(`  build: ${line.length} cartas em ${snap.sets.length} sets (${semImg} sem scan; ${doComplemento} do complemento; ${renumeradas} com o número impresso do de-para).`);

  const existing = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const kept = existing.filter((c) => c && !/^nrt-ccg-/.test(String(c.id)));
  const have = new Set(kept.map((c) => c.id));
  const merged = kept.concat(line.filter((c) => !have.has(c.id)));
  const pricing = (await readGlobalVar(new URL("pricing.js", OUT), "TCG_PRICING")) || {};
  await writeGameCatalog(OUT, { cards: merged, pricing, webDir: "data/naruto/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} — ${merged.length} cartas totais.`);
}

// Importável pelos testes sem rodar o sync (ver tests/naruto-ccg-raridade.test.mjs).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
