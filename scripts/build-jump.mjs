// Compila o catálogo do "jogo" JUMP a partir dos sets CURADOS em
// data/jump/curated/*.json — promos de Jump Festa / V-Jump / revista Shonen Jump
// cruzam franquias e NÃO têm fonte única/API, então aqui a fonte de verdade é o
// dataset versionado no git (editado à mão/via PR), não scraping.
//
// Arquivos começando com "_" são ignorados (_TEMPLATE.json, rascunhos).
// Schema de um set: ver data/jump/curated/README.md.
//
//   node scripts/build-jump.mjs
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { writeGameCatalog, slug } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const CURATED = new URL("data/jump/curated/", ROOT);
const OUT = new URL("data/jump/", ROOT);

let files = [];
try { files = (await readdir(CURATED)).filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort(); }
catch { /* pasta ainda não existe */ }

const cards = [];
const errors = [];
for (const file of files) {
  const set = JSON.parse(await readFile(new URL(file, CURATED), "utf8"));
  if (!set.name || !Array.isArray(set.cards)) { errors.push(`${file}: precisa de name e cards[]`); continue; }
  const setId = "jump-" + slug(set.name);
  for (const c of set.cards) {
    if (!c.number || !c.name) { errors.push(`${file}: carta sem number/name`); continue; }
    cards.push({
      id: `${setId}-${slug(String(c.number))}`,
      name: c.name,
      set: set.name,
      setId,
      number: String(c.number),
      setTotal: set.total || set.cards.length,
      setReleaseDate: set.date || "",
      rarity: c.rarity || "",
      artist: c.artist || "",
      language: c.language || set.language || "ja",
      image: c.image || "",
      variants: ["Normal"],
      setLogo: set.logo || "",
      cardType: c.franchise || null, // franquia (Dragon Ball, One Piece…) como "tipo"
      vintage: !!set.vintage,
      nameJp: c.nameJp || null,
      note: c.note || null
    });
  }
  console.log(`  ${set.name}: ${set.cards.length} cartas`);
}
if (errors.length) { console.error("ERROS de curadoria:\n  - " + errors.join("\n  - ")); process.exit(1); }

// Ids únicos (duas promos com o mesmo número no mesmo set = erro de curadoria).
const seen = new Set();
for (const c of cards) {
  if (seen.has(c.id)) { console.error(`ERRO: id duplicado ${c.id}`); process.exit(1); }
  seen.add(c.id);
}

await writeGameCatalog(OUT, { cards, pricing: {} });
console.log(`JUMP: ${cards.length} cartas em ${files.length} sets → ${fileURLToPath(OUT)}`);
