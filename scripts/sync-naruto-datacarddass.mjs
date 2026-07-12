// データカードダス NARUTO (Bandai, arcade): as cartas com código de barras no
// verso, dispensadas pelas máquinas. Duas séries catalogadas pela fonte:
//
//   ナルティメットカードバトル (DN-xxx, 2005–2007): 8 弾 + 2 folhas combo
//   究極任務 ナルティメットミッション (NM-xxx, 2007–2008): 4 章 + 特別任務
//
// (As séries seguintes — Formation NF/Cross — ainda não têm checklist aberta;
// quando aparecer fonte, entram aqui por append sem conflito.)
//
// Fonte: naruto.noihjp.com (acervo de fã japonês, Shift-JIS) — páginas por
// capítulo com código oficial + nome, SEM imagens (cartas ficam com o
// placeholder, mesmo caso do One Piece 2002). Padrão-snapshot: o build parte
// de data/vintage/naruto-datacarddass.json; o fetch só atualiza quando
// responde e não regride. ANEXA ao catálogo do Naruto (ids nrt-dc-*).
//
//   node scripts/sync-naruto-datacarddass.mjs             # fetch + build
//   node scripts/sync-naruto-datacarddass.mjs --no-fetch  # só build
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog, sleep } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/naruto/", ROOT);
const SNAP = new URL("data/vintage/naruto-datacarddass.json", ROOT);
const CACHE_DIR = new URL("data/.cache/", ROOT);
const BASE = "http://naruto.noihjp.com/Goods/DataCarddas/";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
const NO_FETCH = process.argv.includes("--no-fetch");

// As 15 páginas da fonte, em ordem CRONOLÓGICA (folhas combo entre os 弾 em que
// saíram). História encerrada — a lista é fixa; só as cartas de cada página
// podem crescer (o acervo confirma cartas aos poucos).
const PAGES = [
  { seq: 1,  page: "01.php",                    name: "ナルティメットカードバトル 第１弾" },
  { seq: 2,  page: "02.php",                    name: "ナルティメットカードバトル 第２弾" },
  { seq: 3,  page: "03.php",                    name: "ナルティメットカードバトル 第３弾" },
  { seq: 4,  page: "Special-Combo-Sheet.php",   name: "ナルティメットカードバトル スペシャルコンボシート" },
  { seq: 5,  page: "04.php",                    name: "ナルティメットカードバトル 第４弾" },
  { seq: 6,  page: "05.php",                    name: "ナルティメットカードバトル 第５弾" },
  { seq: 7,  page: "Special-Combo-Sheet_2.php", name: "ナルティメットカードバトル スペシャルコンボシート２" },
  { seq: 8,  page: "06.php",                    name: "ナルティメットカードバトル 第６弾" },
  { seq: 9,  page: "07.php",                    name: "ナルティメットカードバトル 第７弾" },
  { seq: 10, page: "08.php",                    name: "ナルティメットカードバトル 第８弾 ナルティメットSP！" },
  { seq: 11, page: "Shippuden/NarutimateMission/01.php",      name: "究極任務 ナルティメットミッション 第１章 蒼天！新たなる旅立ち編" },
  { seq: 12, page: "Shippuden/NarutimateMission/02.php",      name: "究極任務 ナルティメットミッション 第２章 君臨！黄砂に舞う風編" },
  { seq: 13, page: "Shippuden/NarutimateMission/03.php",      name: "究極任務 ナルティメットミッション 第３章 強襲！赤き絶望の毒牙編" },
  { seq: 14, page: "Shippuden/NarutimateMission/04.php",      name: "究極任務 ナルティメットミッション 第４章 激闘！闇を運ぶ暗雲編" },
  { seq: 15, page: "Shippuden/NarutimateMission/Tokunin.php", name: "究極任務 ナルティメットミッション 特別任務の章" }
];

async function fetchSjis(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
      if (r.ok) return new TextDecoder("shift_jis").decode(await r.arrayBuffer());
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

// Página do noihjp: código (DN-001/NM-001/…) e nome em células vizinhas. Varre
// o texto sem tags: linha que é só um código -> a próxima linha "normal" é o
// nome (se a próxima também for código, a carta fica sem nome e é pulada).
function parseCards(html) {
  const text = html.replace(/<[^>]+>/g, "\n");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const isCode = (l) => /^[A-Z]{1,4}-\d{1,4}$/.test(l);
  const cards = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (!isCode(lines[i]) || seen.has(lines[i])) continue;
    const name = lines[i + 1] && !isCode(lines[i + 1]) ? lines[i + 1] : "";
    if (!name || name.length > 40) continue; // célula de texto corrido: não é nome
    seen.add(lines[i]);
    cards.push({ code: lines[i], name });
  }
  return cards;
}

async function refreshSnapshot(existing) {
  const sets = [];
  let missed = 0;
  for (const def of PAGES) {
    const cacheName = `naruto-dc-${String(def.seq).padStart(2, "0")}.html`;
    const html = await cached(cacheName, () => fetchSjis(BASE + def.page));
    if (!html) { missed++; continue; }
    const cards = parseCards(html);
    if (cards.length) sets.push({ seq: def.seq, name: def.name, cards });
    await sleep(400); // gentileza com o site de fã
  }
  if (missed && !sets.length) { console.log("  noihjp inacessível — segue com o snapshot versionado."); return existing; }
  const candidate = { source: BASE, updatedAt: new Date().toISOString().slice(0, 10), sets };
  const newCount = snapshotCardCount(candidate);
  const oldCount = snapshotCardCount(existing);
  console.log(`  noihjp: ${sets.length} sets, ${newCount} cartas (snapshot: ${oldCount}).`);
  if (newCount < oldCount) { console.log(`  ⚠ REGRESSÃO (${newCount} < ${oldCount}) — snapshot mantido.`); return existing; }
  if (newCount !== oldCount) await writeSnapshot(SNAP, candidate);
  return (await readSnapshot(SNAP)) || candidate;
}

async function run() {
  console.log("Data Carddass NARUTO (Bandai 2005–2008, arcade vintage)");
  let snap = await readSnapshot(SNAP);
  if (!NO_FETCH) snap = await refreshSnapshot(snap);
  if (!snap || !snapshotCardCount(snap)) { console.log("  snapshot vazio — nada a construir."); return; }

  // A numeração é GLOBAL na série (DN-001… / NM-001…) e os 弾 seguintes
  // relistam cartas antigas (re-impressões pra máquina). Mesmo código = mesma
  // carta: ela pertence ao set em que ESTREOU; relistagem não vira carta nova.
  const seen = new Set();
  const line = [];
  for (const s of [...snap.sets].sort((a, b) => a.seq - b.seq)) {
    const setId = `nrt-dc-s${String(s.seq).padStart(2, "0")}`;
    const setName = `Data Carddass — ${s.name}`;
    const fresh = s.cards.filter((c) => !seen.has(c.code));
    fresh.forEach((c) => seen.add(c.code));
    for (const c of fresh) {
      line.push({
        id: `nrt-dc-${c.code.toLowerCase()}`,
        name: c.name,
        set: setName,
        setId,
        number: c.code,
        setTotal: fresh.length,
        setReleaseDate: "",
        rarity: "",
        artist: "",
        language: "ja",
        image: "", // sem scans abertos; placeholder (mesmo caso do OP 2002)
        variants: ["Normal"],
        setLogo: "",
        vintage: true,
        vintageLine: "dc"
      });
    }
  }
  console.log(`  build: ${line.length} cartas em ${snap.sets.length} sets.`);

  const existing = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const kept = existing.filter((c) => c && !String(c.id).startsWith("nrt-dc-"));
  const have = new Set(kept.map((c) => c.id));
  const merged = kept.concat(line.filter((c) => !have.has(c.id)));
  const pricing = (await readGlobalVar(new URL("pricing.js", OUT), "TCG_PRICING")) || {};
  await writeGameCatalog(OUT, { cards: merged, pricing, webDir: "data/naruto/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} — ${merged.length} cartas totais.`);
}

await run();
