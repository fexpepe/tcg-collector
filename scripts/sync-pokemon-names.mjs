// Gera data/pokemon-names.js (window.TCG_POKEMON_NAMES = { dexId: "Nome" }) a
// partir da PokéAPI. Usado pelo merge para dar nome canônico (latino) a toda
// carta de Pokémon pelo dexId, evitando nomes em japonês/chinês na Pokédex.
import { writeFile } from "node:fs/promises";

const MAX_DEX = 1025;
const outFile = new URL("../data/pokemon-names.js", import.meta.url);

// Nomes com formatação especial que o title-case simples erraria.
const OVERRIDES = {
  "nidoran-f": "Nidoran♀", "nidoran-m": "Nidoran♂", "farfetchd": "Farfetch'd",
  "mr-mime": "Mr. Mime", "ho-oh": "Ho-Oh", "mime-jr": "Mime Jr.",
  "porygon-z": "Porygon-Z", "type-null": "Type: Null", "jangmo-o": "Jangmo-o",
  "hakamo-o": "Hakamo-o", "kommo-o": "Kommo-o", "tapu-koko": "Tapu Koko",
  "tapu-lele": "Tapu Lele", "tapu-bulu": "Tapu Bulu", "tapu-fini": "Tapu Fini",
  "sirfetchd": "Sirfetch'd", "mr-rime": "Mr. Rime", "flabebe": "Flabébé",
  "wo-chien": "Wo-Chien", "chien-pao": "Chien-Pao", "ting-lu": "Ting-Lu", "chi-yu": "Chi-Yu"
};

const data = await fetchJson(`https://pokeapi.co/api/v2/pokemon-species?limit=${MAX_DEX}`);
const names = {};
for (const entry of data.results) {
  const id = Number(entry.url.split("/").filter(Boolean).pop());
  if (id && id <= MAX_DEX) names[id] = formatName(entry.name);
}

await writeFile(outFile, `window.TCG_POKEMON_NAMES = ${JSON.stringify(names)};\n`, "utf8");
console.log(`Gerados ${Object.keys(names).length} nomes em ${outFile.pathname}`);

function formatName(slug) {
  if (OVERRIDES[slug]) return OVERRIDES[slug];
  return slug.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

async function fetchJson(url, retries = 3) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: ${response.status}`);
      return response.json();
    } catch (error) {
      if (attempt >= retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
}
