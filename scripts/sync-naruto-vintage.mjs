// NARUTO カードゲーム (Bandai, 2003–2006): checklist + scans do tcg-db.nikita.jp
// (DB de fã japonês). Mesmo padrão-snapshot dos vintage do One Piece: o build
// SEMPRE parte de data/vintage/naruto-carddass.json; o fetch do site só
// atualiza o snapshot quando responde e não regride. ANEXA ao catálogo do
// Naruto (mantém cartas de outras linhas — ex.: um futuro moderno da TCGCSV).
//
//   node scripts/sync-naruto-vintage.mjs             # fetch (se der) + build
//   node scripts/sync-naruto-vintage.mjs --no-fetch  # só build do snapshot
//
// Imagens: scans pequenos do próprio DB, servidos via wsrv.nl (proxy com CORS
// e cache de borda — mesmo esquema do Carddass do One Piece na fase 1).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog, sleep } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/naruto/", ROOT);
const SNAP = new URL("data/vintage/naruto-carddass.json", ROOT);
const CACHE = new URL("data/.cache/naruto-explist.html", ROOT);
const BASE = "https://tcg-db.nikita.jp";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
const NO_FETCH = process.argv.includes("--no-fetch");

async function fetchText(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
      if (r.ok) return await r.text();
    } catch (e) { /* retry */ }
    await sleep(1200 * (i + 1));
  }
  return null;
}

// explist: todos os links de set "<a href='/cardlist/nrt/?exp=NOME'>NOME (N 枚)</a>".
function parseSetList(html) {
  const sets = [];
  const seen = new Set();
  const re = /<a href='\/cardlist\/nrt\/\?exp=([^'&]+)'>([^<]+?)\s*\((\d+)\s*枚\)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const exp = decodeURIComponent(m[1]);
    if (seen.has(exp)) continue;
    seen.add(exp);
    sets.push({ exp, name: m[2].trim(), official: Number(m[3]) || 0 });
  }
  return sets;
}

// cardlist de um set: linhas com o scan (código do arquivo) + "NUM　<a>NOME</a>".
function parseCards(html) {
  const cards = [];
  const seen = new Set();
  const re = /<img src='\/img\/card\/nrt\/([^']+)\.jpg'[^>]*>[\s\S]{0,200}?<span style='font-weight:bold;font-size:120%;'>([^<]+?)[\s　]+<a href='\?name=[^']*'>([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const code = m[1].trim();
    if (code === "back" || seen.has(code)) continue;
    seen.add(code);
    cards.push({ code, num: m[2].trim(), name: m[3].trim() });
  }
  return cards;
}

async function refreshSnapshot(existing) {
  let listHtml = null;
  try { listHtml = await readFile(CACHE, "utf8"); } catch { /* sem cache */ }
  if (!listHtml) {
    listHtml = await fetchText(`${BASE}/explist/nrt/`);
    if (listHtml) { await mkdir(new URL("data/.cache/", ROOT), { recursive: true }); await writeFile(CACHE, listHtml, "utf8"); }
  }
  if (!listHtml) { console.log("  fonte inacessível — build segue do snapshot versionado."); return existing; }

  const setDefs = parseSetList(listHtml);
  if (!setDefs.length) { console.log("  parser não achou sets — snapshot mantido."); return existing; }
  const sets = [];
  for (const def of setDefs) {
    const html = await fetchText(`${BASE}/cardlist/nrt/?exp=${encodeURIComponent(def.exp)}`);
    const cards = html ? parseCards(html) : [];
    console.log(`  ${def.name}: ${cards.length}/${def.official} cartas`);
    if (cards.length) sets.push({ name: def.name, official: def.official, cards });
    await sleep(700); // gentileza com o site de fã
  }
  const candidate = { source: `${BASE}/explist/nrt/`, updatedAt: new Date().toISOString().slice(0, 10), sets };
  const newCount = snapshotCardCount(candidate);
  const oldCount = snapshotCardCount(existing);
  console.log(`  fonte: ${sets.length} sets, ${newCount} cartas (snapshot atual: ${oldCount}).`);
  if (newCount < oldCount) { console.log(`  ⚠ REGRESSÃO (${newCount} < ${oldCount}) — snapshot mantido.`); return existing; }
  if (newCount !== oldCount) {
    await writeSnapshot(SNAP, candidate);
    console.log(`  snapshot atualizado: ${oldCount} -> ${newCount} cartas.`);
  }
  return (await readSnapshot(SNAP)) || candidate;
}

async function run() {
  console.log("NARUTO カードゲーム (Bandai 2003–2006, vintage)");
  let snap = await readSnapshot(SNAP);
  if (!NO_FETCH) snap = await refreshSnapshot(snap);
  if (!snap || !snapshotCardCount(snap)) { console.log("  snapshot vazio — nada a construir ainda."); return; }

  const cardsNrt = [];
  snap.sets.forEach((s, i) => {
    const setId = `nrt-s${String(i + 1).padStart(2, "0")}`;
    for (const c of s.cards || []) {
      cardsNrt.push({
        id: `nrt-${c.code}`,
        name: c.name,
        set: s.name,
        setId,
        number: c.num,
        setTotal: s.official || s.cards.length,
        setReleaseDate: "",
        rarity: "",
        artist: "",
        language: "ja",
        image: `https://wsrv.nl/?url=${encodeURIComponent(`tcg-db.nikita.jp/img/card/nrt/${c.code}.jpg`)}&w=440&output=webp`,
        variants: ["Normal"],
        setLogo: "",
        vintage: true,
        vintageLine: "nrtcg"
      });
    }
  });
  console.log(`  build: ${cardsNrt.length} cartas em ${snap.sets.length} sets.`);

  // Anexa: mantém o que NÃO é desta linha (nrt-) — ex.: um futuro moderno da
  // TCGCSV — e regrava a linha vintage inteira.
  const existing = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const kept = existing.filter((c) => c && !String(c.id).startsWith("nrt-"));
  const have = new Set(kept.map((c) => c.id));
  const merged = kept.concat(cardsNrt.filter((c) => !have.has(c.id)));
  const pricing = (await readGlobalVar(new URL("pricing.js", OUT), "TCG_PRICING")) || {}; // vintage sem preço

  await writeGameCatalog(OUT, { cards: merged, pricing, webDir: "data/naruto/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} — ${merged.length} cartas totais.`);
}

await run();
