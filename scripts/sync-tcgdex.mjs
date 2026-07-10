import { writeFile, readFile, mkdir, readdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { preserveMissingCards } from "./lib/sync-common.mjs";

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    sets: { type: "string", default: "" },
    force: { type: "boolean", default: false },
    concurrency: { type: "string", default: "8" },
    "include-digital": { type: "boolean", default: false },
    help: { type: "boolean", default: false }
  }
});

// Séries digital-only que NÃO são TCG físico — ficam de fora da importação.
// Pokémon TCG Pocket (tcgp) é um jogo de celular; suas cartas não existem em papel.
const DIGITAL_SERIES = ["tcgp"];

if (options.help) {
  console.log(`Uso: node scripts/sync-tcgdex.mjs [idioma] [opções]

  idioma             Idioma do catálogo (padrão: pt)
  --sets a,b,c       Sincroniza apenas os sets informados (ids da TCGdex, ex: base1,swsh3)
  --force            Ignora o cache e baixa tudo de novo
  --concurrency N    Requisições paralelas por set (padrão: 8)
  --include-digital  Inclui séries digital-only (Pokémon TCG Pocket); por padrão são puladas

Por padrão só entram TCGs físicos: a série Pokémon TCG Pocket (digital) é
excluída. O progresso fica em data/.cache/<idioma>/<setId>.json; rodadas
seguintes reaproveitam os sets já baixados e só buscam o que falta.`);
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

// Ids dos sets digital-only (Pokémon TCG Pocket etc.), buscados pela série,
// para deixá-los de fora — a menos que --include-digital seja passado.
const digitalSetIds = options["include-digital"] ? new Set() : await fetchDigitalSetIds();

const requested = setFilter.length
  ? allSets.filter((set) => setFilter.includes(set.id))
  : allSets;
const sets = requested.filter((set) => !digitalSetIds.has(set.id));

const skippedDigital = requested.length - sets.length;
if (skippedDigital > 0) {
  console.log(`Ignorando ${skippedDigital} set(s) digital-only (Pokémon TCG Pocket) — use --include-digital para incluir.`);
}

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

// Busca os ids de sets das séries digital-only. Se a série não existir no
// idioma, ignora silenciosamente (ela pode não ter localização).
async function fetchDigitalSetIds() {
  const ids = new Set();
  for (const serieId of DIGITAL_SERIES) {
    try {
      const serie = await fetchJson(`${baseUrl}/series/${serieId}`);
      (serie.sets || []).forEach((set) => set.id && ids.add(set.id));
    } catch (error) {
      // série ausente nesse idioma: ok
    }
  }
  return ids;
}

await mkdir(cacheDir, { recursive: true });

await mkdir(chunksDir, { recursive: true });

// União PRESERVADORA: carta indexada nunca some do catálogo. Se a TCGdex parar
// de listar uma carta (ou um set inteiro), a versão já versionada no repo é
// mantida — no pior caso ela congela sem update de preço/imagem. É a garantia
// de que um item marcado no portfólio de alguém não desaparece embaixo dele.
async function readExistingChunk(fileUrl) {
  try { const a = JSON.parse(await readFile(fileUrl, "utf8")); return Array.isArray(a) ? a : []; } catch { return []; }
}
let preservedCards = 0;
let preservedSets = 0;

const cards = [];
const manifestSets = [];
const seenSetIds = new Set();
for (const [index, set] of sets.entries()) {
  if (!set.id || seenSetIds.has(set.id)) continue;
  seenSetIds.add(set.id);
  const label = `[${index + 1}/${sets.length}] ${set.id}`;
  const entry = await loadSetCards(set.id, label);
  const setCards = entry.cards.map((rawCard) => toAppCard(rawCard, language, entry.set));
  // Cartas que EXISTIAM no chunk versionado e sumiram da API: preserva no fim.
  const chunkFile = new URL(`${set.id}.json`, chunksDir);
  const kept = preserveMissingCards(await readExistingChunk(chunkFile), setCards);
  if (kept.length) { setCards.push(...kept); preservedCards += kept.length; }
  if (!setCards.length) continue; // sets sem cartas na TCGdex (comuns em ja/zh antigos)
  cards.push(...setCards);

  await writeFile(chunkFile, JSON.stringify(setCards), "utf8");
  manifestSets.push({
    id: set.id,
    name: entry.set.name || set.id,
    count: setCards.length,
    file: `data/sets/${language}/${set.id}.json`
  });
}

// Set que sumiu da LISTA da TCGdex: o chunk versionado continua valendo — entra
// no manifest/catálogo como estava (congelado), em vez de evaporar do site.
try {
  for (const f of await readdir(chunksDir)) {
    if (!f.endsWith(".json")) continue;
    const setId = f.replace(/\.json$/, "");
    if (seenSetIds.has(setId)) continue;
    const existing = await readExistingChunk(new URL(f, chunksDir));
    if (!existing.length) continue;
    cards.push(...existing);
    manifestSets.push({ id: setId, name: existing[0].set || setId, count: existing.length, file: `data/sets/${language}/${f}` });
    preservedSets++;
  }
} catch { /* diretório recém-criado */ }
if (preservedCards || preservedSets) {
  console.log(`Preservados do catálogo versionado (sumiram da API): ${preservedCards} cartas · ${preservedSets} sets inteiros`);
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

// Decide se um set cacheado deve ser re-baixado: sets recentes (a TCGdex ainda
// preenche) ou que parecem incompletos (menos cartas que o total oficial) e
// ainda não são velhos demais. Sets antigos e completos ficam no cache.
function shouldRefreshCache(cached) {
  const set = cached && cached.set;
  if (!set) return true;
  const release = set.releaseDate ? new Date(set.releaseDate).getTime() : NaN;
  const ageDays = Number.isNaN(release) ? Infinity : (Date.now() - release) / 86400000;
  if (ageDays < 0) return true;                    // pré-lançamento: sempre tenta
  if (ageDays <= 180) return true;                 // recente: TCGdex ainda completa
  const official = set.cardCount && set.cardCount.official;
  const have = Array.isArray(cached.cards) ? cached.cards.length : 0;
  if (official && have < official && ageDays <= 730) return true; // incompleto e novo-ish
  return false;
}

async function loadSetCards(setId, label) {
  const cacheFile = new URL(`${setId}.json`, cacheDir);

  if (!options.force) {
    try {
      const cached = JSON.parse(await readFile(cacheFile, "utf8"));
      // A TCGdex COMPLETA os sets aos poucos (secret rares/promos entram semanas
      // depois do lançamento). Sem isto, um set baixado cedo ficaria incompleto
      // pra sempre. Então re-baixa sets recentes/incompletos; os antigos e
      // completos seguem do cache (rápido).
      if (!shouldRefreshCache(cached)) {
        stats.fromCache++;
        console.log(`${label} — ${cached.cards.length} cartas (cache)`);
        return cached;
      }
      console.log(`${label} — cache desatualizado (recente/incompleto), re-baixando`);
    } catch {
      // sem cache ou cache corrompido: baixa de novo
    }
  }

  // encodeURIComponent: ids como "SM1+" quebrariam a URL sem escape
  const fullSet = await fetchJson(`${baseUrl}/sets/${encodeURIComponent(setId)}`);
  const briefs = fullSet.cards || [];

  const fetchedCards = await mapLimit(briefs, concurrency, async (brief) => {
    try {
      return await fetchJson(`${baseUrl}/cards/${encodeURIComponent(brief.id)}`);
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
  if (!entry.cards.length) {
    // não cacheia sets vazios: se a TCGdex completar o set depois, pegamos
    console.warn(`${label} — set sem cartas na TCGdex, pulando`);
    return entry;
  }
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

  const appCard = {
    // Ids da TCGdex repetem entre idiomas (sv03.5-199 existe em en e pt);
    // o inglês fica com o id canônico e os demais ganham sufixo de idioma.
    id: fallbackLanguage === "en" ? card.id : `${card.id}-${fallbackLanguage}`,
    name: card.name || card.id,
    pokemonName: speciesName(card.name || card.id),
    category: card.category || "",
    dexId: primaryDexId(card),
    generation: generationFromDexId(primaryDexId(card)),
    pokemonImage: pokemonImageUrl(primaryDexId(card)),
    number: card.localId || "",
    set: card.set?.name || card.set?.id || "",
    setId: card.set?.id || fullSet?.id || "",
    setLogo: imageUrl(card.set?.logo || fullSet?.logo),
    setSymbol: imageUrl(card.set?.symbol || fullSet?.symbol),
    setTotal: card.set?.cardCount?.official || fullSet?.cardCount?.official || fullSet?.cardCount?.total || "",
    setReleaseDate: card.set?.releaseDate || fullSet?.releaseDate || "",
    setSerieId: card.set?.serie?.id || fullSet?.serie?.id || "",
    setSerieName: card.set?.serie?.name || fullSet?.serie?.name || "",
    artist: card.illustrator || "",
    rarity: card.rarity || "",
    language: fallbackLanguage,
    image: imageUrl(card.image, "high"),
    variants,
    // Preço de referência compacto (TCGdex já trouxe o card completo): { u, e }.
    // O merge move isto para data/pricing.generated.js e remove daqui.
    price: compactPrice(card.pricing)
  };
  if (!appCard.price) delete appCard.price;
  return appCard;
}

// Um valor representativo por moeda do `pricing` da TCGdex: USD do TCGplayer
// (market/mid da 1ª variante com preço), EUR do Cardmarket (avg/trend/low).
function compactPrice(pricing) {
  if (!pricing || typeof pricing !== "object") return null;
  const tp = pricing.tcgplayer || {};
  const cm = pricing.cardmarket || {};
  const pick = (obj, keys) => {
    for (const k of keys) { const v = obj && obj[k]; if (typeof v === "number" && v > 0) return v; }
    return 0;
  };
  let usd = 0;
  for (const key of ["normal", "holofoil", "reverseHolofoil", "reverse-holofoil", "1stEditionHolofoil", "1stEdition"]) {
    const v = tp[key];
    if (v && typeof v === "object") { usd = pick(v, ["marketPrice", "midPrice", "lowPrice"]); if (usd) break; }
  }
  const eur = pick(cm, ["avg", "trendPrice", "avg-holo", "low", "low-holo"]);
  if (!usd && !eur) return null;
  const out = {};
  if (usd) out.u = Math.round(usd * 100) / 100;
  if (eur) out.e = Math.round(eur * 100) / 100;
  return out;
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
    // Só cartas de Pokémon (têm dexId), agrupadas por número nacional; o
    // merge-catalogs refaz este índice com as 1025 espécies canônicas.
    pokedex: pokedexIndex(sourceCards),
    trainers: groupToIndex(sourceCards.filter((card) => card.category === "Trainer"), (card) => card.name),
    sets: groupToIndex(sourceCards, (card) => card.set),
    artists: groupToIndex(sourceCards, (card) => card.artist || "Artista desconhecido")
  };
}

function pokedexIndex(sourceCards) {
  const byDex = new Map();
  for (const card of sourceCards) {
    const dexId = Number(card.dexId);
    if (!dexId) continue;
    if (!byDex.has(dexId)) byDex.set(dexId, { dexId, name: card.pokemonName || speciesName(card.name), cardIds: [] });
    byDex.get(dexId).cardIds.push(card.id);
  }
  return Array.from(byDex.values()).sort((a, b) => a.dexId - b.dexId);
}

function speciesName(name) {
  return String(name || "")
    .replace(/\b(VMAX|VSTAR|ex|EX|GX|V-UNION|V)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Número nacional da espécie. A TCGdex às vezes traz formas como fração
// (Rayquaza ☆ japonês = 384.1); a espécie é a parte inteira.
function primaryDexId(card) {
  if (!Array.isArray(card.dexId)) return "";
  return Math.trunc(Number(card.dexId[0])) || "";
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
