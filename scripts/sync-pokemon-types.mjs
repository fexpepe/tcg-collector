// Gera data/pokemon-types.js (window.TCG_POKEMON_TYPES = { dexId: [tipos] }) a
// partir da PokéAPI. Usa o endpoint /type (18 requisições cobrem toda a Pokédex),
// muito mais barato do que uma requisição por Pokémon.
import { writeFile } from "node:fs/promises";

const TYPES = [
  "normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison",
  "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy"
];
const MAX_DEX = 1025; // nº nacional máximo (gen 9); ignora formas alternativas (ids 10000+)
const outFile = new URL("../data/pokemon-types.js", import.meta.url);

const byDex = new Map();

for (const type of TYPES) {
  const data = await fetchJson(`https://pokeapi.co/api/v2/type/${type}`);
  for (const entry of data.pokemon) {
    const id = Number(entry.pokemon.url.split("/").filter(Boolean).pop());
    if (!id || id > MAX_DEX) continue;
    if (!byDex.has(id)) byDex.set(id, []);
    byDex.get(id).push(type);
  }
  console.log(`${type}: ${data.pokemon.length} Pokémon`);
}

const result = {};
Array.from(byDex.keys()).sort((a, b) => a - b).forEach((id) => {
  // ordena os tipos na ordem canônica de TYPES para estabilidade
  result[id] = TYPES.filter((type) => byDex.get(id).includes(type));
});

await writeFile(outFile, `window.TCG_POKEMON_TYPES = ${JSON.stringify(result)};\n`, "utf8");
console.log(`\nGerados tipos de ${Object.keys(result).length} Pokémon em ${outFile.pathname}`);

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
