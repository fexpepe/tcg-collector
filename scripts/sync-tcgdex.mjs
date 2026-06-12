import { writeFile, readFile, mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    sets: { type: "string", default: "" },
    force: { type: "boolean", default: false },
    concurrency: { type: "string", default: "8" },
    help: { type: "boolean", default: false }
  }
});

if (options.help) {
  console.log(`Uso: node scripts/sync-tcgdex.mjs [idioma] [opções]

  idioma             Idioma do catálogo (padrão: pt)
  --sets a,b,c       Sincroniza apenas os sets informados (ids da TCGdex, ex: base1,swsh3)
  --force            Ignora o cache e baixa tudo de novo
  --concurrency N    Requisições paralelas por set (padrão: 8)

O progresso fica em data/.cache/<idioma>/<setId>.json; rodadas seguintes
reaproveitam os sets já baixados e só buscam o que falta.`);
  process.exit(0);
}

const language = positionals[0] || "pt";
const concurrency = Math.max(1, Number(options.concurrency) || 8);
const setFilter = options.sets.split(",").map((id) => id.trim()).filter(Boolean);

const baseUrl = `https://api.tcgdex.net/v2/${language}`;
const cacheDir = new URL(`../data/.cache/${language}/`, import.meta.url);
const cardsOutFile = new URL("../data/cards.generated.js", import.meta.url);
const indexesOutFile = new URL("../data/indexes.generated.js", import.meta.url);
const manifestOutFile = new URL("../data/manifest.generated.js", import.meta.url);
const chunksDir = new URL(`../data/sets/${language}/`, import.meta.url);

const startedAt = Date.now();
const stats = { fromCache: 0, fetched: 0, skippedCards: 0 };

const allSets = await fetchJson(`${baseUrl}/sets`);
const sets = setFilter.length
  ? allSets.filter((set) => setFilter.includes(set.id))
  : allSets;

if (setFilter.length) {
  const known = new Set(allSets.map((set) => set.id));
  const unknown = setFilter.filter((id) => !known.has(id));
  if (unknown.length) {
    console.warn(`Aviso: sets não encontrados na TCGdex (${language}): ${unknown.join(", ")}`);
  }
  if (!sets.length) {
    console.error("Nenhum set válido para sincronizar.");
    process.exit(1);
  }
}

await mkdir(cacheDir, { recursive: true });

await mkdir(chunksDir, { recursive: true });

const cards = [];
const manifestSets = [];
for (const [index, set] of sets.entries()) {
  if (!set.id) continue;
  const label = `[${index + 1}/${sets.length}] ${set.id}`;
  const entry = await loadSetCards(set.id, label);
  const setCards = entry.cards.map((rawCard) => toAppCard(rawCard, language, entry.set));
  cards.push(...setCards);

  await writeFile(new URL(`${set.id}.json`, chunksDir), JSON.stringify(setCards), "utf8");
  manifestSets.push({
    id: set.id,
    name: entry.set.name || set.id,
    count: setCards.length,
    file: `data/sets/${language}/${set.id}.json`
  });
}

const manifest = {
  language,
  generatedAt: new Date().toISOString(),
  sets: manifestSets
};

await writeFile(cardsOutFile, `window.TCG_CARDS = ${JSON.stringify(cards)};\n`, "utf8");
await writeFile(indexesOutFile, `window.TCG_INDEXES = ${JSON.stringify(buildIndexes(cards))};\n`, "utf8");
await writeFile(manifestOutFile, `window.TCG_MANIFEST = ${JSON.stringify(manifest)};\n`, "utf8");

const seconds = Math.round((Date.now() - startedAt) / 1000);
console.log(`\nGeradas ${cards.length} cartas em ${cardsOutFile.pathname}`);
console.log(`Gerados índices em ${indexesOutFile.pathname}`);
console.log(`Gerados manifest e ${manifestSets.length} chunks de set em data/sets/${language}/`);
console.log(`Sets: ${stats.fetched} baixados, ${stats.fromCache} do cache · cartas puladas: ${stats.skippedCards} · ${seconds}s`);

async function loadSetCards(setId, label) {
  const cacheFile = new URL(`${setId}.json`, cacheDir);

  if (!options.force) {
    try {
      const cached = JSON.parse(await readFile(cacheFile, "utf8"));
      stats.fromCache++;
      console.log(`${label} — ${cached.cards.length} cartas (cache)`);
      return cached;
    } catch {
      // sem cache ou cache corrompido: baixa de novo
    }
  }

  const fullSet = await fetchJson(`${baseUrl}/sets/${setId}`);
  const briefs = fullSet.cards || [];

  const fetchedCards = await mapLimit(briefs, concurrency, async (brief) => {
    try {
      return await fetchJson(`${baseUrl}/cards/${brief.id}`);
    } catch (error) {
      if (error.status === 404) {
        stats.skippedCards++;
        console.warn(`${label} — carta ${brief.id} não encontrada (404), pulando`);
        return null;
      }
      throw error;
    }
  });

  const entry = { set: fullSet, cards: fetchedCards.filter(Boolean) };
  await writeFile(cacheFile, JSON.stringify(entry), "utf8");
  stats.fetched++;
  console.log(`${label} — ${entry.cards.length} cartas baixadas`);
  return entry;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function fetchJson(url, retries = 3) {
  for (let attempt = 0; ; attempt++) {
    let retryable = true;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        retryable = response.status === 429 || response.status >= 500;
        const error = new Error(`Falha ao buscar ${url}: ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    } catch (error) {
      if (!retryable || attempt >= retries) {
        throw error;
      }
      await sleep(500 * 2 ** attempt);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toAppCard(card, fallbackLanguage, fullSet) {
  const variants = Object.entries(card.variants || {})
    .filter(([, enabled]) => enabled)
    .map(([name]) => normalizeVariantName(name));

  return {
    // Ids da TCGdex repetem entre idiomas (sv03.5-199 existe em en e pt);
    // o inglês fica com o id canônico e os demais ganham sufixo de idioma.
    id: fallbackLanguage === "en" ? card.id : `${card.id}-${fallbackLanguage}`,
    name: card.name || card.id,
    pokemonName: speciesName(card.name || card.id),
    dexId: Array.isArray(card.dexId) ? card.dexId[0] : "",
    generation: generationFromDexId(Array.isArray(card.dexId) ? card.dexId[0] : ""),
    pokemonImage: pokemonImageUrl(Array.isArray(card.dexId) ? card.dexId[0] : ""),
    number: card.localId || "",
    set: card.set?.name || card.set?.id || "",
    setId: card.set?.id || fullSet?.id || "",
    setLogo: imageUrl(card.set?.logo || fullSet?.logo),
    setSymbol: imageUrl(card.set?.symbol || fullSet?.symbol),
    setTotal: card.set?.cardCount?.official || fullSet?.cardCount?.official || fullSet?.cardCount?.total || "",
    setReleaseDate: card.set?.releaseDate || fullSet?.releaseDate || "",
    artist: card.illustrator || "",
    rarity: card.rarity || "",
    language: fallbackLanguage,
    image: imageUrl(card.image, "high"),
    variants
  };
}

function imageUrl(baseImageUrl, quality = "") {
  if (!baseImageUrl) return "";
  return quality ? `${baseImageUrl}/${quality}.png` : `${baseImageUrl}.png`;
}

function normalizeVariantName(name) {
  const labels = {
    normal: "Normal",
    reverse: "Reverse",
    holo: "Holo",
    firstEdition: "1st Edition",
    wPromo: "W Promo"
  };
  return labels[name] || name;
}

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

function pokemonImageUrl(dexId) {
  return dexId ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${dexId}.png` : "";
}

function generationFromDexId(dexId) {
  const id = Number(dexId);
  if (!id) return "";
  if (id <= 151) return 1;
  if (id <= 251) return 2;
  if (id <= 386) return 3;
  if (id <= 493) return 4;
  if (id <= 649) return 5;
  if (id <= 721) return 6;
  if (id <= 809) return 7;
  if (id <= 905) return 8;
  return 9;
}

function groupToIndex(sourceCards, getKey) {
  const groups = new Map();

  for (const card of sourceCards) {
    const key = getKey(card) || "Sem grupo";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(card.id);
  }

  return Array.from(groups, ([name, cardIds]) => ({
    name,
    cardIds: cardIds.sort((a, b) => a.localeCompare(b))
  })).sort((a, b) => a.name.localeCompare(b.name));
}
