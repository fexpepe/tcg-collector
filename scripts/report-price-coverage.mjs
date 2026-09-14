// Relatório de COBERTURA DE PREÇO do Pokémon, no log do deploy (nunca falha o
// build): por idioma, quantas cartas têm cotação e de que fonte; quantas foram
// sintetizadas de fonte de preço (TCGplayer via TCGCSV/PPT) em vez de vir da
// TCGdex; e as cotações acima de um teto, pra alguém olhar.
//
// Existe porque o problema de 14/09/2026 ficou meses invisível: promos
// japonesas injetadas em sets americanos no topo do ranking de Pikachu, sets JP
// inteiros sem preço nenhum, Reverse valendo o preço do Normal — nada disso
// quebrava teste ou lint, e só apareceu quando alguém comparou com outro site.
// Com o número no log, uma queda de cobertura ou um preço absurdo aparece no
// dia, não na comparação seguinte.
//
// Uso: node scripts/report-price-coverage.mjs [--teto 5000] [--top 15]
import { readdir, readFile } from "node:fs/promises";
import { pickPricingRef, usdForVariant } from "./lib/pricing.mjs";
import { basePricingId } from "./lib/sync-common.mjs";

const argv = process.argv.slice(2);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? Number(argv[i + 1]) || d : d; };
const TETO = val("--teto", 5000);   // USD: acima disto vale um par de olhos
const TOP = val("--top", 15);
const DATA = new URL("../data/", import.meta.url);

async function leGlobal(nome, varName) {
  try {
    const t = await readFile(new URL(nome, DATA), "utf8");
    const g = { window: {} };
    new Function("window", t)(g.window);
    return g.window[varName] || null;
  } catch { return null; }
}
const pricing = await leGlobal("pricing.generated.js", "TCG_PRICING") || await leGlobal("pricing.js", "TCG_PRICING") || {};
let csv = {}, ppt = {};
try { csv = JSON.parse(await readFile(new URL("tcgcsv-prices.generated.json", DATA), "utf8")); } catch { /* sem TCGCSV */ }
try { ppt = JSON.parse(await readFile(new URL("ppt-prices.generated.json", DATA), "utf8")); } catch { /* sem PPT */ }

const setsDir = new URL("sets/", DATA);
let langs = [];
try { langs = (await readdir(setsDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* sem chunks */ }
if (!langs.length) { console.log("[cobertura] sem chunks em data/sets — nada a medir"); process.exit(0); }

const caros = [];
const porSetSemPreco = [];
console.log(`\nCobertura de preço (Pokémon) — teto de revisão US$ ${TETO}`);
console.log("idioma | cartas | com preço | % | por impressão (v) | fonte USD: tcgcsv / ppt / tcgdex | só EUR | sintetizadas | sets sem preço nenhum");
for (const lang of langs) {
  const dir = new URL(`${lang}/`, setsDir);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  let cartas = 0, comPreco = 0, comV = 0, fCsv = 0, fPpt = 0, fDex = 0, soEur = 0, sint = 0, setsSem = 0;
  for (const f of files) {
    let cards;
    try { cards = JSON.parse(await readFile(new URL(f, dir), "utf8")); } catch { continue; }
    if (!Array.isArray(cards) || !cards.length) continue;
    let setCom = 0;
    for (const c of cards) {
      cartas++;
      if (/tcgplayer-cdn/.test(c.image || "")) sint++;
      const ref = pickPricingRef(pricing[c.id], pricing[basePricingId(c.id)]);
      const usd = usdForVariant(ref, (c.variants && c.variants[0]) || "Normal");
      const tem = !!ref && (usd > 0 || ref.e > 0 || (ref.b && ref.b.md > 0));
      if (!tem) continue;
      comPreco++; setCom++;
      if (ref.v) comV++;
      if (usd > 0) {
        if (csv[c.id] && csv[c.id].u > 0) fCsv++; else if (ppt[c.id] && ppt[c.id].u > 0) fPpt++; else fDex++;
      } else soEur++;
      // Maior impressão da carta, pro teto.
      let max = usd;
      for (const v of Object.values((ref && ref.v) || {})) if (v > max) max = v;
      if (max >= TETO) caros.push({ id: c.id, name: c.name, set: c.set, lang, usd: max });
    }
    if (!setCom) { setsSem++; porSetSemPreco.push(`${lang}/${f.replace(/\.json$/, "")} (${cards.length})`); }
  }
  const pct = cartas ? Math.round((comPreco / cartas) * 100) : 0;
  console.log(`${lang.padEnd(6)} | ${String(cartas).padStart(6)} | ${String(comPreco).padStart(9)} | ${String(pct).padStart(3)}% | ${String(comV).padStart(17)} | ${String(fCsv).padStart(6)} / ${String(fPpt).padStart(5)} / ${String(fDex).padStart(6)} | ${String(soEur).padStart(6)} | ${String(sint).padStart(12)} | ${setsSem}`);
}
if (porSetSemPreco.length) {
  console.log(`\nSets sem NENHUMA cotação (${porSetSemPreco.length}) — é onde a ordenação por valor fica cega:`);
  console.log("  " + porSetSemPreco.slice(0, 60).join(", ") + (porSetSemPreco.length > 60 ? ", …" : ""));
}
caros.sort((a, b) => b.usd - a.usd);
if (caros.length) {
  console.log(`\nCotações ≥ US$ ${TETO} (${caros.length}; as ${Math.min(TOP, caros.length)} maiores) — conferir se a carta e a impressão são as certas:`);
  for (const c of caros.slice(0, TOP)) console.log(`  US$ ${c.usd.toFixed(2).padStart(10)}  ${c.id}  ${c.name} · ${c.set} [${c.lang}]`);
}
console.log("");
