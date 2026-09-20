// Passo do deploy: ENRIQUECE os chunks japoneses (data/sets/ja/*.json) com o
// que a TCGdex e a TCGCSV não trazem — série da era, categoria/tipo/estágio
// pelo irmão inglês, e nome japonês/raridade/ilustrador/scan do cache da
// Bulbapedia (data/ja-enrich/, baixado LOCAL pelo sync-bulbapedia-ja.mjs).
// A regra é pura e testada em scripts/lib/enrich-ja.mjs; aqui é só o fs.
//
// Roda em TODO build completo, sem rede, DEPOIS do sync-tcgdex e do
// sync-tcgcsv-pokemon (que reescrevem os chunks a partir das fontes) e ANTES
// do merge-catalogs (que lê os chunks). Precisa rodar toda vez: o sync-tcgdex
// devolve o chunk como a API manda, então o enriquecimento não "fica" — ele é
// reaplicado do cache versionado. Só campo VAZIO é preenchido: TCGdex >
// Bulbapedia > TCGCSV, e nada apaga o que a fonte de cima disse.
//
//   node scripts/enrich-ja.mjs             # aplica e grava
//   node scripts/enrich-ja.mjs --dry-run   # só conta
import { readdir, readFile, writeFile } from "node:fs/promises";
import { buildEnIndex, enrichJaCard } from "./lib/enrich-ja.mjs";

const RAIZ = new URL("../", import.meta.url);
const SETS = new URL("data/sets/", RAIZ);
const CACHE = new URL("data/ja-enrich/", RAIZ);
const DRY = process.argv.includes("--dry-run");

async function leJson(url, padrao) {
  try { return JSON.parse(await readFile(url, "utf8")); } catch { return padrao; }
}
async function chunks(lang) {
  let files = [];
  try { files = (await readdir(new URL(`${lang}/`, SETS))).filter((f) => f.endsWith(".json")).sort(); } catch { return []; }
  const out = [];
  for (const f of files) {
    const cards = await leJson(new URL(`${lang}/${f}`, SETS), null);
    if (Array.isArray(cards) && cards.length) out.push({ setId: f.replace(/\.json$/, ""), file: new URL(`${lang}/${f}`, SETS), cards });
  }
  return out;
}

const en = await chunks("en");
const ja = await chunks("ja");
if (!ja.length) { console.log("enrich-ja: sem chunks em data/sets/ja — nada a fazer."); process.exit(0); }
const enIndex = buildEnIndex(en.flatMap((c) => c.cards));

let comCache = 0, chunksMudados = 0, cartasMudadas = 0;
const porCampo = {};
for (const chunk of ja) {
  const bulba = await leJson(new URL(`${chunk.setId}.json`, CACHE), null);
  if (bulba && bulba.cards) comCache++;
  let mudouChunk = false;
  for (const card of chunk.cards) {
    const campos = enrichJaCard(card, { enIndex, bulba });
    if (!campos.length) continue;
    mudouChunk = true; cartasMudadas++;
    for (const f of campos) porCampo[f] = (porCampo[f] || 0) + 1;
  }
  if (mudouChunk) {
    chunksMudados++;
    if (!DRY) await writeFile(chunk.file, JSON.stringify(chunk.cards), "utf8");
  }
}
const resumo = Object.entries(porCampo).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`).join(", ");
console.log(`enrich-ja: ${ja.length} sets ja (${comCache} com cache da Bulbapedia), ${en.length} sets en no índice · `
  + `${cartasMudadas} carta(s) em ${chunksMudados} chunk(s) ${DRY ? "mudariam" : "enriquecidas"}${resumo ? ` — ${resumo}` : ""}`);
