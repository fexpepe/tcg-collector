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
//   node scripts/sync-naruto-ccg.mjs             # fetch + build
//   node scripts/sync-naruto-ccg.mjs --no-fetch  # só build
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog, decodeEntities, sleep } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/naruto/", ROOT);
const SNAP = new URL("data/vintage/naruto-ccg.json", ROOT);
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

async function run() {
  console.log("Naruto CCG (Bandai USA 2006–2013, vintage EN)");
  let snap = await readSnapshot(SNAP);
  if (!NO_FETCH) snap = await refreshSnapshot(snap);
  if (!snap || !snapshotCardCount(snap)) { console.log("  snapshot vazio — nada a construir."); return; }

  // Ids pegajosos: número oficial -> id já publicado (coleções referenciam ids).
  const existing = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const idByNum = new Map();
  for (const c of existing) {
    if (/^nrt-ccg-/.test(String(c.id)) && c.number && !idByNum.has(c.number)) idByNum.set(c.number, c.id);
  }

  const defByKey = new Map(SETS.map((d) => [d.key, d]));
  const line = [];
  for (const s of snap.sets) {
    const def = defByKey.get(s.key);
    if (!def || def.skip) continue;
    const setId = `nrt-ccg-${def.key}`;
    for (const c of s.cards) {
      const cardId = idByNum.get(c.code) || `nrt-ccg-${c.code.toLowerCase()}`;
      const scan = c.img ? `https://wsrv.nl/?url=${encodeURIComponent(`${CDN}${def.slug}/${c.code}-EN.jpg`)}&w=440&output=webp` : "";
      line.push({
        id: cardId,
        name: c.name,
        set: `Naruto CCG — ${def.name}`,
        setId,
        number: c.code,
        setTotal: s.cards.length,
        setReleaseDate: def.date,
        // s29 (Shinobi's Dream, cancelado) vem com "UNKNOWN" da fonte: vira
        // vazio — chip "UNKNOWN" na UI seria ruído, não informação.
        rarity: c.rarity === "UNKNOWN" ? "" : c.rarity,
        artist: "",
        language: "en",
        image: curatedImg(cardId) || scan,
        variants: ["Normal"],
        setLogo: "/assets/games/game_naruto.webp",
        vintage: true,
        vintageLine: "nrt-ccg"
      });
    }
  }
  const semImg = line.filter((c) => !c.image).length;
  console.log(`  build: ${line.length} cartas em ${snap.sets.length} sets (${semImg} sem scan).`);

  const kept = existing.filter((c) => c && !/^nrt-ccg-/.test(String(c.id)));
  const have = new Set(kept.map((c) => c.id));
  const merged = kept.concat(line.filter((c) => !have.has(c.id)));
  const pricing = (await readGlobalVar(new URL("pricing.js", OUT), "TCG_PRICING")) || {};
  await writeGameCatalog(OUT, { cards: merged, pricing, webDir: "data/naruto/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} — ${merged.length} cartas totais.`);
}

await run();
