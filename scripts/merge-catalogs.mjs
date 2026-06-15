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

// Nome canônico de espécie por dexId. Base: PokéAPI (todos os 1025, sempre
// latino); o catálogo en só entra como fallback para dexIds fora da lista —
// nomes de carta ("M Absol", "Arcanine BREAK", "Iono's Bellibolt") não podem
// sobrescrever o nome da espécie.
const speciesByDex = new Map();
try {
  const raw = await readFile(new URL("pokemon-names.js", dataDir), "utf8");
  const map = JSON.parse(raw.replace(/^window\.TCG_POKEMON_NAMES = /, "").replace(/;\s*$/, ""));
  for (const [dexId, name] of Object.entries(map)) speciesByDex.set(Number(dexId), name);
} catch {
  console.warn("Aviso: data/pokemon-names.js ausente; rode sync-pokemon-names.mjs.");
}
for (const chunk of chunksByLang.en || []) {
  for (const card of chunk.cards) {
    const dexId = speciesDexId(card);
    if (dexId && card.pokemonName && !speciesByDex.has(dexId)) speciesByDex.set(dexId, card.pokemonName);
  }
}

// Número nacional da espécie; dexIds fracionários de forma (Rayquaza ☆ = 384.1)
// pertencem à espécie da parte inteira.
function speciesDexId(card) {
  return Math.trunc(Number(card.dexId)) || 0;
}

const allCards = [];
const manifestSets = [];

for (const lang of langs) {
  for (const chunk of chunksByLang[lang] || []) {
    let changed = false;
    for (const card of chunk.cards) {
      const canonical = speciesByDex.get(speciesDexId(card));
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
    pokedex: buildPokedexIndex(sourceCards),
    // Treinadores agrupados por nome (Supporter/Item/Stadium/Tool).
    trainers: groupToIndex(sourceCards.filter((card) => card.category === "Trainer"), (card) => card.name),
    sets: groupToIndex(sourceCards, (card) => card.set),
    artists: groupToIndex(sourceCards, (card) => card.artist || "Artista desconhecido"),
    // Totais (só contagem) por chave da aba "Pokémon" da Coleção, que agrupa por
    // pokemonName OU speciesName(name) — logo inclui Treinador/Energia/Item, que
    // ficam de fora do índice pokedex. A Coleção usa isto para os denominadores
    // de progresso sem precisar baixar o catálogo inteiro.
    pokemonTotals: countByKey(sourceCards, (card) => card.pokemonName || speciesNameKey(card.name))
  };
}

// Replica shared.js#speciesName: a chave precisa ser idêntica à do front.
function speciesNameKey(name) {
  return String(name || "")
    .replace(/\b(VMAX|VSTAR|ex|EX|GX|V-UNION|V)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function countByKey(sourceCards, getKey) {
  const counts = {};
  for (const card of sourceCards) {
    const key = getKey(card) || "—";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// Pokédex nacional completa: uma entrada por espécie (dexId 1..1025), em ordem
// de número e mesmo sem carta no catálogo. Só cartas com dexId entram como
// cardIds — Treinador/Energia/Item ficam de fora.
function buildPokedexIndex(sourceCards) {
  const byDex = new Map();
  for (const [dexId, name] of speciesByDex) byDex.set(dexId, { dexId, name, cardIds: [] });
  for (const card of sourceCards) {
    const dexId = speciesDexId(card);
    if (!dexId) continue;
    if (!byDex.has(dexId)) byDex.set(dexId, { dexId, name: card.pokemonName, cardIds: [] });
    byDex.get(dexId).cardIds.push(card.id);
  }
  return Array.from(byDex.values())
    .sort((a, b) => a.dexId - b.dexId)
    .map((entry) => ({ ...entry, cardIds: entry.cardIds.sort((a, b) => a.localeCompare(b)) }));
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
