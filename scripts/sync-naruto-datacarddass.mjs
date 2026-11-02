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
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog, sleep } from "./lib/sync-common.mjs";
import { PAGES, estreias, estreiasForaDaFaixa } from "./lib/naruto-datacarddass.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/naruto/", ROOT);

// Imagem CURADA do dono: assets/cards/naruto/<id>.(webp|jpg|png) substitui o
// placeholder (mesmo mecanismo do sync vintage).
function curatedImg(id) {
  for (const ext of ["webp", "jpg", "png"]) {
    if (existsSync(fileURLToPath(new URL(`assets/cards/naruto/${id}.${ext}`, ROOT)))) {
      return `/assets/cards/naruto/${id}.${ext}`;
    }
  }
  return "";
}
const SNAP = new URL("data/vintage/naruto-datacarddass.json", ROOT);
const CACHE_DIR = new URL("data/.cache/", ROOT);
const BASE = "http://naruto.noihjp.com/Goods/DataCarddas/";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
const NO_FETCH = process.argv.includes("--no-fetch");

// Logo do Card Battle (NARUTO ナルティメットカードバトル), recortado da capa do
// guia oficial (2026-09-30, ver assets/games/README.md). É a marca SÓ do
// primeiro título: a Mission (究極任務) tem logo próprio, que ainda não temos —
// os sets dela seguem sem setLogo e mostram o nome, pela regra de logo de set.
const CARD_BATTLE_LOGO = "/assets/games/game_naruto_datacarddass.webp";
const isCardBattle = (s) => s.name.startsWith("ナルティメットカードバトル");

// As 15 páginas da fonte (ordem, nome e faixa oficial de estreia) moram em
// scripts/lib/naruto-datacarddass.mjs, que o teste trava: o noihjp troca o
// título do 第1弾 com o do 第2弾 (02/11/2026).

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
    // Cache pela PÁGINA, não pelo seq: o seq 1 deixou de ser a 01.php, e um
    // naruto-dc-01.html velho no disco traria o 第2弾 de volta como 第1弾.
    const cacheName = `naruto-dc-pagina-${def.page.replace(/\.php$/, "").replace(/[^A-Za-z0-9]+/g, "-")}.html`;
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
  // Título trocado na fonte (foi assim com o 第1弾 e o 第2弾) põe carta no set
  // errado sem mudar a contagem: estreia fora da faixa oficial não entra.
  const fora = estreiasForaDaFaixa(sets);
  if (fora.length) { console.log(`  ⚠ ${fora.length} estreia(s) fora da faixa oficial (${fora.slice(0, 5).join("; ")}) — snapshot mantido.`); return existing; }
  if (newCount !== oldCount) await writeSnapshot(SNAP, candidate);
  return (await readSnapshot(SNAP)) || candidate;
}

async function run() {
  console.log("Data Carddass NARUTO (Bandai 2005–2008, arcade vintage)");
  let snap = await readSnapshot(SNAP);
  if (!NO_FETCH) snap = await refreshSnapshot(snap);
  if (!snap || !snapshotCardCount(snap)) { console.log("  snapshot vazio — nada a construir."); return; }

  // A carta pertence ao set em que ESTREOU (numeração global, relistagem não
  // vira carta nova) — a regra mora no estreias() da lib.
  const line = [];
  for (const { set: s, estreias: fresh } of estreias(snap.sets)) {
    const setId = `nrt-dc-s${String(s.seq).padStart(2, "0")}`;
    const setName = `Data Carddass — ${s.name}`;
    for (const c of fresh) {
      const cardId = `nrt-dc-${c.code.toLowerCase()}`;
      line.push({
        id: cardId,
        name: c.name,
        set: setName,
        setId,
        number: c.code,
        setTotal: fresh.length,
        setReleaseDate: "",
        rarity: "",
        artist: "",
        language: "ja",
        image: curatedImg(cardId), // curada do dono se existir; senão placeholder (sem scans abertos)
        variants: ["Normal"],
        setLogo: isCardBattle(s) ? CARD_BATTLE_LOGO : "",
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
