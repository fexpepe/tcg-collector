// Mescla os catálogos por idioma (data/sets/<lang>/*.json, gerados pelo
// sync-tcgdex.mjs) num catálogo unificado para o modo manifest:
//   - canoniza pokemonName via dexId usando o catálogo en (リザードン -> Charizard),
//     reescrevendo os chunks para a página de detalhe filtrar certo;
//   - gera data/indexes.generated.js e data/manifest.generated.js mesclados.
// Uso: node scripts/merge-catalogs.mjs en ja zh-tw pt
import { readdir, readFile, writeFile } from "node:fs/promises";

const langs = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
if (!langs.length) {
  console.error("Uso: node scripts/merge-catalogs.mjs <idioma> [idioma...]");
  process.exit(1);
}

const dataDir = new URL("../data/", import.meta.url);
const chunksByLang = {};

for (const lang of langs) {
  const dir = new URL(`sets/${lang}/`, dataDir);
  let files = [];
  try {
    files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
  } catch {
    console.warn(`Aviso: sem chunks para "${lang}" (rode o sync antes); pulando.`);
    continue;
  }
  chunksByLang[lang] = [];
  for (const file of files) {
    const cards = JSON.parse(await readFile(new URL(file, dir), "utf8"));
    if (!cards.length) continue;
    chunksByLang[lang].push({ file, setId: file.replace(/\.json$/, ""), cards });
  }
}

// Nome canônico de espécie por dexId, tirado do catálogo en.
const speciesByDex = new Map();
for (const chunk of chunksByLang.en || []) {
  for (const card of chunk.cards) {
    if (card.dexId && card.pokemonName && !speciesByDex.has(card.dexId)) {
      speciesByDex.set(card.dexId, card.pokemonName);
    }
  }
}

const allCards = [];
const manifestSets = [];

for (const lang of langs) {
  for (const chunk of chunksByLang[lang] || []) {
    let changed = false;
    for (const card of chunk.cards) {
      const canonical = card.dexId ? speciesByDex.get(card.dexId) : null;
      if (canonical && card.pokemonName !== canonical) {
        card.pokemonName = canonical;
        changed = true;
      }
    }
    if (changed) {
      await writeFile(new URL(`sets/${lang}/${chunk.file}`, dataDir), JSON.stringify(chunk.cards), "utf8");
    }
    allCards.push(...chunk.cards);
    manifestSets.push({
      id: chunk.setId,
      name: chunk.cards[0]?.set || chunk.setId,
      count: chunk.cards.length,
      language: lang,
      file: `data/sets/${lang}/${chunk.file}`
    });
  }
}

const manifest = {
  languages: langs,
  generatedAt: new Date().toISOString(),
  sets: manifestSets
};

await writeFile(new URL("indexes.generated.js", dataDir), `window.TCG_INDEXES = ${JSON.stringify(buildIndexes(allCards))};\n`, "utf8");
await writeFile(new URL("manifest.generated.js", dataDir), `window.TCG_MANIFEST = ${JSON.stringify(manifest)};\n`, "utf8");

console.log(`Mesclados: ${allCards.length} cartas, ${manifestSets.length} sets (${langs.join(", ")})`);
console.log(`Espécies canônicas conhecidas: ${speciesByDex.size}`);

function buildIndexes(sourceCards) {
  return {
    pokedex: groupToIndex(sourceCards, (card) => card.pokemonName || speciesName(card.name)),
    sets: groupToIndex(sourceCards, (card) => card.set),
    artists: groupToIndex(sourceCards, (card) => card.artist || "Artista desconhecido")
  };
}

function speciesName(name) {
  return String(name || "")
    .replace(/\b(VMAX|VSTAR|ex|EX|GX|V-UNION|V)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function groupToIndex(sourceCards, getKey) {
  const groups = new Map();
  for (const card of sourceCards) {
    const key = getKey(card) || "Sem grupo";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card.id);
  }
  return Array.from(groups, ([name, cardIds]) => ({
    name,
    cardIds: cardIds.sort((a, b) => a.localeCompare(b))
  })).sort((a, b) => a.name.localeCompare(b.name));
}
