// Lint dos catálogos gerados — roda no deploy DEPOIS dos syncs, pra corrupção
// não ir pro ar em silêncio (os syncs têm "|| echo" de resiliência; o lint é o
// contrapeso que FALHA alto em erro duro).
//
//   node scripts/lint-catalog.mjs                # todos os jogos
//   node scripts/lint-catalog.mjs --update-baseline  # regrava a régua (rodar local e commitar)
//
// Erro DURO (exit 1): ids duplicados, carta sem id/nome/set, catálogo zerado
//   quando a régua diz que havia cartas.
// AVISO (exit 0): contagem caiu vs a régua (data/catalog-baseline.json), % de
//   imagem baixou muito — pode ser legítimo (fonte removeu), então não bloqueia,
//   mas fica gritante no log do deploy.
import { readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const BASELINE = new URL("data/catalog-baseline.json", ROOT);
const GAMES = { pokemon: "data/", lorcana: "data/lorcana/", onepiece: "data/onepiece/", magic: "data/magic/", fab: "data/fab/", naruto: "data/naruto/", hxh: "data/hxh/", jump: "data/jump/" };
const UPDATE = process.argv.includes("--update-baseline");

async function readCards(dir) {
  // Pokémon usa chunks/manifest em produção; cards.js local é amostra — pula a
  // régua de contagem pra ele quando só há a amostra (< 100 cartas).
  try {
    const t = await readFile(new URL(dir + "cards.js", ROOT), "utf8");
    const g = { window: {} };
    new Function("window", t)(g.window);
    return g.window.TCG_CARDS || null;
  } catch { return null; }
}

const errors = [];
const warnings = [];
let baseline = {};
try { baseline = JSON.parse(await readFile(BASELINE, "utf8")); } catch { /* primeira rodada */ }
const nextBaseline = {};

for (const [game, dir] of Object.entries(GAMES)) {
  const cards = await readCards(dir);
  if (!cards) { console.log(`  ${game}: sem catálogo (ok se o jogo ainda não tem dados)`); continue; }

  // Erros duros: integridade básica.
  const seen = new Set();
  let dupes = 0, broken = 0, withImage = 0;
  for (const c of cards) {
    if (!c || !c.id || !c.name || !c.set) { broken++; continue; }
    if (seen.has(c.id)) dupes++;
    seen.add(c.id);
    if (c.image) withImage++;
  }
  if (dupes) errors.push(`${game}: ${dupes} id(s) duplicado(s)`);
  if (broken) errors.push(`${game}: ${broken} carta(s) sem id/nome/set`);

  const sets = new Set(cards.map((c) => c.set)).size;
  const imgPct = cards.length ? Math.round((withImage / cards.length) * 100) : 0;
  const base = baseline[game];
  const sample = cards.length < 100; // amostra local (ex.: Pokémon dev): não aplica régua
  if (base && !sample) {
    if (cards.length === 0 && base.cards > 0) errors.push(`${game}: catálogo ZEROU (régua: ${base.cards})`);
    else if (cards.length < base.cards) warnings.push(`${game}: ${cards.length} cartas < régua ${base.cards} (regressão?)`);
    if (sets < base.sets) warnings.push(`${game}: ${sets} sets < régua ${base.sets}`);
    if (base.imgPct && imgPct < base.imgPct - 10) warnings.push(`${game}: imagens ${imgPct}% (régua ${base.imgPct}%)`);
  }
  nextBaseline[game] = sample && base ? base : { cards: cards.length, sets, imgPct };
  console.log(`  ${game}: ${cards.length} cartas · ${sets} sets · ${imgPct}% com imagem${sample ? " (amostra: régua não aplicada)" : ""}`);
}

if (UPDATE) {
  await writeFile(BASELINE, JSON.stringify(nextBaseline, null, 1), "utf8");
  console.log("  régua atualizada: data/catalog-baseline.json (commitar).");
}
if (warnings.length) { console.log(`\n⚠ ${warnings.length} AVISO(S):`); warnings.forEach((w) => console.log("   - " + w)); }
if (errors.length) { console.log(`\n✖ ${errors.length} ERRO(S) DURO(S):`); errors.forEach((e) => console.log("   - " + e)); process.exit(1); }
console.log("\n✓ catálogos íntegros");
