// Gera data/set-id-map.js: o "de-para" de setId da TCGdex -> setId da
// pokemontcg.io. Serve para buscar a imagem de cartas EN no pokemontcg.io
// quando a TCGdex não tem o asset (promos, McDonald's, sets novos) e como
// fallback durante outage do CDN da TCGdex.
//
// O mapa é casado automaticamente por nome + total de cartas entre as duas
// APIs; casos que não batem por nome ficam em MANUAL_OVERRIDES (preservados a
// cada regeração). Rode: node scripts/build-set-id-map.mjs
import { writeFile } from "node:fs/promises";

// Correções/descobertas manuais (TCGdex -> pokemontcg.io). Têm prioridade
// sobre o casamento automático; é aqui que o registro cresce com o tempo.
const MANUAL_OVERRIDES = {
  // Sets duplos da era SV (a regra algorítmica do app já cobre, mas fixamos):
  "sv03.5": "sv3pt5",
  // Ids com ponto que a pokemontcg.io escreve de formas irregulares (testados
  // um a um em 2026-07: uns viram "pt5", outros colapsam o ponto, GO é "pgo",
  // e Black Bolt/White Flare ganham prefixo z/r):
  "swsh3.5": "swsh35",
  "swsh4.5": "swsh45",
  "swsh4.5sv": "swsh45sv",
  "swsh9.5tg": "swsh9tg",
  "swsh10.5": "pgo",
  "swsh11.5tg": "swsh11tg",
  "swsh12.5": "swsh12pt5",
  "swsh12.5gg": "swsh12pt5gg",
  "swsh12.5tg": "swsh12tg",
  "sm11.5": "sm115",
  "sv10.5b": "zsv10pt5",
  "sv10.5w": "rsv10pt5",
  // McDonald's Collections (nomes/ids divergem bastante entre as bases):
  "2011bw": "mcd11",
  "2012bw": "mcd12",
  "2014xy": "mcd14",
  "2015xy": "mcd15",
  "2016xy": "mcd16"
};

const outFile = new URL("../data/set-id-map.js", import.meta.url);

const normalize = (value) => String(value || "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const tcgdexSets = await fetchJson("https://api.tcgdex.net/v2/en/sets");
const ptcgSets = await fetchAllPtcgSets();

// Índice da pokemontcg.io por nome normalizado -> [{id, printedTotal, total}].
const ptcgByName = new Map();
for (const set of ptcgSets) {
  const key = normalize(set.name);
  if (!ptcgByName.has(key)) ptcgByName.set(key, []);
  ptcgByName.get(key).push(set);
}

const map = {};
let matched = 0;
const unmatched = [];

for (const set of tcgdexSets) {
  const official = set.cardCount?.official;
  const total = set.cardCount?.total;
  const candidates = ptcgByName.get(normalize(set.name)) || [];
  // Mesmo nome: se houver vários, desempata pelo total de cartas.
  let hit = candidates.find((c) => c.printedTotal === official || c.total === total);
  if (!hit && candidates.length === 1) hit = candidates[0];
  if (hit && hit.id !== set.id) {
    map[set.id] = hit.id;
    matched++;
  } else if (!hit) {
    unmatched.push(`${set.id} (${set.name})`);
  }
}

// Overrides manuais por último (vencem o automático).
Object.assign(map, MANUAL_OVERRIDES);

// Só guardamos as DIFERENÇAS — quando o id é igual, a regra do app já resolve.
const sorted = Object.fromEntries(Object.keys(map).sort().map((key) => [key, map[key]]));

const banner = `// GERADO por scripts/build-set-id-map.mjs — de-para de setId TCGdex -> pokemontcg.io.\n`
  + `// Só sets cujos ids DIFEREM entre as bases (ids iguais a regra do app resolve).\n`
  + `// Edite MANUAL_OVERRIDES no script para adicionar/corrigir e rode de novo.\n`;
await writeFile(outFile, `${banner}window.TCG_SET_ID_MAP = ${JSON.stringify(sorted, null, 2)};\n`, "utf8");

console.log(`Mapa gerado: ${Object.keys(sorted).length} entradas (${matched} por nome+total, ${Object.keys(MANUAL_OVERRIDES).length} overrides).`);
console.log(`Sets TCGdex sem correspondência por nome: ${unmatched.length}`);
if (unmatched.length) console.log("  " + unmatched.slice(0, 30).join("\n  ") + (unmatched.length > 30 ? "\n  ..." : ""));

async function fetchAllPtcgSets() {
  const all = [];
  for (let page = 1; ; page++) {
    const data = await fetchJson(`https://api.pokemontcg.io/v2/sets?page=${page}&pageSize=250`);
    const sets = data.data || [];
    all.push(...sets);
    if (sets.length < 250) break;
  }
  return all;
}

async function fetchJson(url, retries = 3) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} em ${url}`);
      return await response.json();
    } catch (error) {
      if (attempt >= retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 600 * 2 ** attempt));
    }
  }
}
