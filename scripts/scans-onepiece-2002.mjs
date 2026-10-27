// Scans do One Piece Card Game 2002–2005 (linha op2002), que o Grand Line Wiki
// não tem: o catálogo saiu em 2026-07 com as ~1300 cartas em placeholder. Fonte:
// One Piece Collection, categoria "Card Game" (idc=2; ver scripts/lib/onepiececollection.mjs).
//
// Grava data/vintage/onepiece-2002-scans.json (versionado): pra cada set do
// snapshot do 2002, número -> caminho do scan no site francês. O sync-onepiece-2002
// só LÊ esse arquivo e monta a URL do wsrv.nl (o espelho do R2 copia de lá) —
// nada de imagem local, que contaria no teto de 20.000 arquivos do Pages.
//
// Set nosso -> set do site: o que tiver mais números em comum (os nomes de lá
// estão em francês). Importa porque os Treasure Sheet reimprimem números de
// sets anteriores com fundo e texto revisados: a carta do Treasure Sheet tem que
// usar o scan do Treasure Sheet. Número que o set casado não tem cai no 1º scan
// daquele número em qualquer set (o "Decisive Battle", só reimpressão, não
// existe lá e usa o scan do set original).
//
// Rodar LOCAL (rede aberta) e COMMITAR o JSON; cartas de 2002 não mudam, então
// é uma vez só. Não regride: se vier menos scan que o arquivo atual (site fora,
// HTML mudou), mantém o que há.
//   node scripts/scans-onepiece-2002.mjs
import { fileURLToPath } from "node:url";
import { readSnapshot, writeSnapshot } from "./lib/sync-common.mjs";
import { OPC, numKey, opcSeries, firstByNum } from "./lib/onepiececollection.mjs";

const ROOT = new URL("../", import.meta.url);
const SNAP = new URL("data/vintage/onepiece-2002cardgame.json", ROOT);
const OUT = new URL("data/vintage/onepiece-2002-scans.json", ROOT);

const snap = await readSnapshot(SNAP);
if (!snap) { console.error("snapshot do 2002 ausente"); process.exit(1); }

const series = await opcSeries(2);
const global = firstByNum(series);
console.log(`One Piece Collection (Card Game): ${series.length} sets, ${global.size} números com scan.`);

const sets = {};
let total = 0, cards = 0;
const semScan = [];
for (const s of snap.sets) {
  const nums = s.cards.map((c) => numKey(c.num));
  let best = null, bestHits = 0;
  for (const sr of series) {
    const have = new Set(sr.cards.map((c) => numKey(c.num)));
    const hits = nums.filter((n) => have.has(n)).length;
    if (hits > bestHits) { best = sr; bestHits = hits; }
  }
  const own = best ? firstByNum([best]) : new Map();
  const scans = {};
  for (const c of s.cards) {
    cards++;
    const path = own.get(numKey(c.num)) || global.get(numKey(c.num));
    if (path) { scans[c.num] = path; total++; } else semScan.push(`${s.name}: ${c.num}`);
  }
  sets[s.name] = { series: best ? best.ids : null, scans };
  console.log(`  ${s.name} -> ${best ? `ids=${best.ids} (${bestHits}/${s.cards.length} em comum)` : "sem set casado"}: ${Object.keys(scans).length}/${s.cards.length} com scan`);
}

const existing = await readSnapshot(OUT);
const oldTotal = existing ? Object.values(existing.sets || {}).reduce((n, s) => n + Object.keys(s.scans || {}).length, 0) : 0;
console.log(`Cartas com scan: ${total}/${cards}.`);
if (semScan.length) console.log(`  sem scan (ficam no placeholder): ${semScan.join(", ")}`);
if (total < oldTotal) {
  console.log(`  ⚠ REGRESSÃO (${total} < ${oldTotal}): arquivo mantido.`);
} else {
  await writeSnapshot(OUT, { source: `http://${OPC}/cartes.php?idc=2`, updatedAt: new Date().toISOString().slice(0, 10), sets });
  console.log(`Gravado em ${fileURLToPath(OUT)}.`);
}
