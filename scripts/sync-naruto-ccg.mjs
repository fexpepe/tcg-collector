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
// cancelado em 2013) — a lista é fixa. `date` é CURADORIA (a fonte não expõe
// data); ordenação cronológica do front usa isso, com fallback pro setId.
const SETS = [
  { key: "s01",   slug: "bandai-ccg-01",    name: "The Path to Hokage",        date: "" },
  { key: "s02",   slug: "bandai-ccg-02",    name: "Coils of the Snake",        date: "" },
  { key: "s03",   slug: "bandai-ccg-03",    name: "Curse of the Sand",         date: "" },
  { key: "s04",   slug: "bandai-ccg-04",    name: "Revenge and Rebirth",       date: "" },
  { key: "s05",   slug: "bandai-ccg-05",    name: "Dream Legacy",              date: "" },
  { key: "s06",   slug: "bandai-ccg-06",    name: "Eternal Rivalry",           date: "" },
  { key: "s07",   slug: "bandai-ccg-07",    name: "Quest for Power",           date: "" },
  { key: "s08",   slug: "bandai-ccg-08",    name: "Battle of Destiny",         date: "" },
  { key: "s09",   slug: "bandai-ccg-09",    name: "The Chosen",                date: "" },
  { key: "s10",   slug: "bandai-ccg-10",    name: "Lineage of Legends",        date: "" },
  { key: "s11",   slug: "bandai-ccg-11",    name: "Approaching Wind",          date: "" },
  { key: "s12",   slug: "bandai-ccg-12",    name: "A New Chronicle",           date: "" },
  { key: "s13",   slug: "bandai-ccg-13",    name: "Fateful Reunion",           date: "" },
  { key: "s14",   slug: "bandai-ccg-14",    name: "Emerging Alliance",         date: "" },
  { key: "s15",   slug: "bandai-ccg-15",    name: "Foretold Prophecy",         date: "" },
  { key: "s16",   slug: "bandai-ccg-16",    name: "Broken Promises",           date: "" },
  { key: "s17",   slug: "bandai-ccg-17",    name: "Will of Fire",              date: "" },
  { key: "s18",   slug: "bandai-ccg-18",    name: "Fangs of the Snake",        date: "" },
  { key: "s19",   slug: "bandai-ccg-19",    name: "Path of Pain",              date: "" },
  { key: "s20",   slug: "bandai-ccg-20",    name: "Tales of the Gallant Sage", date: "" },
  { key: "s21",   slug: "bandai-ccg-21",    name: "Shattered Truths",          date: "" },
  { key: "s22",   slug: "bandai-ccg-22",    name: "Weapons of War",            date: "" },
  { key: "s23",   slug: "bandai-ccg-23",    name: "Invasion",                  date: "" },
  { key: "s24",   slug: "bandai-ccg-24",    name: "Sage's Legacy",             date: "" },
  { key: "s25",   slug: "bandai-ccg-25",    name: "Kage Summit",               date: "" },
  { key: "s26",   slug: "bandai-ccg-26",    name: "Avenger's Wrath",           date: "" },
  { key: "s27",   slug: "bandai-ccg-27",    name: "Hero's Ascension",          date: "" },
  { key: "s28",   slug: "bandai-ccg-28",    name: "Ultimate Ninja Storm 3",    date: "" },
  { key: "s29",   slug: "bandai-ccg-29",    name: "Shinobi's Dream",           date: "" },
  { key: "tp1",   slug: "bandai-ccg-tp1",   name: "Tournament Pack 1",         date: "" },
  { key: "tp2",   slug: "bandai-ccg-tp2",   name: "Tournament Pack 2",         date: "" },
  { key: "tp3",   slug: "bandai-ccg-tp3",   name: "Tournament Pack 3",         date: "" },
  { key: "tp4",   slug: "bandai-ccg-tp4",   name: "Tournament Pack 4",         date: "" },
  { key: "tin1",  slug: "bandai-ccg-tin1",  name: "Fierce Ambitions (Tin)",    date: "" },
  { key: "tin2",  slug: "bandai-ccg-tin2",  name: "Untouchables (Tin)",        date: "" },
  { key: "tin3",  slug: "bandai-ccg-tin3",  name: "Ultimate Battle (Tin)",     date: "" },
  { key: "tin4",  slug: "bandai-ccg-tin4",  name: "Rebirth (Tin)",             date: "" },
  { key: "promo", slug: "bandai-ccg-promo", name: "Promotional Cards",         date: "" }
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
    if (!def) continue;
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
