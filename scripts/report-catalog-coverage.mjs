// Relatório de COBERTURA DO CATÁLOGO do Pokémon, por idioma — e, no japonês,
// por era. Só informa (nunca falha o build): é a régua da v2 do modelo de
// carregamento (README, "v2 — japonês"). Existe porque o japonês tinha metade
// das cartas sem artista, categoria e série e ninguém via: nada quebrava
// teste, e o buraco só aparecia comparando com outro site.
//
// Colunas: sets, cartas e a fração de cartas com imagem, artista, categoria,
// raridade e nome em inglês (nameEn: só faz sentido em ja), mais a fração de
// SETS com série e com logo. O "só-TCGCSV" é o set em que nenhuma carta tem
// artista — a assinatura do import (a TCGCSV não publica artista).
//
// Uso: node scripts/report-catalog-coverage.mjs [--lang ja]
import { readdir, readFile } from "node:fs/promises";

const argv = process.argv.slice(2);
const SO_LANG = (() => { const i = argv.indexOf("--lang"); return i >= 0 ? argv[i + 1] : ""; })();
const SETS = new URL("../data/sets/", import.meta.url);

let langs = [];
try { langs = (await readdir(SETS, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* sem chunks */ }
langs = langs.filter((l) => !SO_LANG || l === SO_LANG).sort();
if (!langs.length) { console.log("[catálogo] sem chunks em data/sets — nada a medir"); process.exit(0); }

const pct = (n, d) => (d ? `${String(Math.round((100 * n) / d)).padStart(3)}%` : "   -");
function conta(chunks) {
  const t = { sets: 0, cartas: 0, img: 0, artista: 0, cat: 0, rar: 0, nameEn: 0, serie: 0, logo: 0, soCsv: 0 };
  for (const { cards } of chunks) {
    t.sets++;
    if (cards[0].setSerieId) t.serie++;
    if (cards[0].setLogo) t.logo++;
    if (cards.every((c) => !c.artist)) t.soCsv++;
    for (const c of cards) {
      t.cartas++;
      if (c.image) t.img++;
      if (c.artist) t.artista++;
      if (c.category) t.cat++;
      if (c.rarity && c.rarity !== "None") t.rar++;
      if (c.nameEn || (c.language !== "ja")) t.nameEn++;
    }
  }
  return t;
}
const linha = (rotulo, t) => `${rotulo.padEnd(8)} | ${String(t.sets).padStart(4)} | ${String(t.cartas).padStart(6)} | ${pct(t.img, t.cartas)} | ${pct(t.artista, t.cartas)} | ${pct(t.cat, t.cartas)} | ${pct(t.rar, t.cartas)} | ${pct(t.nameEn, t.cartas)} | ${pct(t.serie, t.sets)} | ${pct(t.logo, t.sets)} | ${String(t.soCsv).padStart(3)}`;
const cabecalho = "idioma   | sets | cartas | img  | artis | categ | rarid | nomEN | série | logo  | só-TCGCSV";

console.log("\nCobertura do catálogo (Pokémon)");
console.log(cabecalho);
const porLang = {};
for (const lang of langs) {
  const dir = new URL(`${lang}/`, SETS);
  const chunks = [];
  for (const f of (await readdir(dir)).filter((x) => x.endsWith(".json")).sort()) {
    let cards;
    try { cards = JSON.parse(await readFile(new URL(f, dir), "utf8")); } catch { continue; }
    if (Array.isArray(cards) && cards.length) chunks.push({ setId: f.replace(/\.json$/, ""), cards });
  }
  porLang[lang] = chunks;
  console.log(linha(lang, conta(chunks)));
}

// Japonês por ERA (setSerieId; "?" = sem série), do mais antigo pro mais novo.
if (porLang.ja && porLang.ja.length) {
  const porEra = new Map();
  for (const chunk of porLang.ja) {
    const era = chunk.cards[0].setSerieId || "?";
    if (!porEra.has(era)) porEra.set(era, { chunks: [], data: "9999" });
    const e = porEra.get(era);
    e.chunks.push(chunk);
    const d = chunk.cards[0].setReleaseDate || "9999";
    if (d < e.data) e.data = d;
  }
  console.log("\nJaponês por era");
  console.log(cabecalho.replace("idioma  ", "era     "));
  for (const [era, e] of [...porEra].sort((a, b) => a[1].data.localeCompare(b[1].data))) console.log(linha(era, conta(e.chunks)));
  const semSerie = porLang.ja.filter((c) => !c.cards[0].setSerieId).map((c) => c.setId);
  if (semSerie.length) console.log(`\nSets ja sem série (${semSerie.length}): ${semSerie.join(", ")}`);
  const semImagem = porLang.ja.filter((c) => c.cards.every((x) => !x.image)).map((c) => `${c.setId} (${c.cards.length})`);
  if (semImagem.length) console.log(`Sets ja sem NENHUMA imagem (${semImagem.length}): ${semImagem.join(", ")}`);
}
