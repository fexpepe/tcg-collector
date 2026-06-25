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
// Referência de preço por cardId (TCGdex), extraída para um artefato separado e
// removida dos chunks (mantém os chunks leves). { id: { u: USD, e: EUR } }.
const pricing = {};
// Preços/imagens da PPT (JP), se o sync rodou (data/ppt-prices.generated.json):
// { cardId: { u: USD, img: url, g?: {p9,p10} } }. Preenche imagem faltante no
// chunk e dá um preço JP melhor que o do Cardmarket da TCGdex. No-op sem o arquivo.
let pptData = {};
try { pptData = JSON.parse(await readFile(new URL("ppt-prices.generated.json", dataDir), "utf8")); } catch { /* sem PPT */ }

// Imagem EN por cardId (preenchida no loop), pra usar de fallback nas cartas
// localizadas sem imagem própria (ex.: MEP PT sem arte na TCGdex).
const enImageById = new Map();

// Cartas que a PPT tem e a TCGdex NÃO (add-on-miss): secret rares/promos que a
// fonte do catálogo não traz. Injetamos no chunk do set+idioma certo (dedupe por
// id), e o resto do merge (preço/índices) trata como qualquer carta.
// { "<lang>/<setId>": [card, ...] }
let pptNewCards = [];
try { pptNewCards = JSON.parse(await readFile(new URL("ppt-newcards.generated.json", dataDir), "utf8")); } catch { /* sem novas */ }
const newBySet = {};
for (const c of Array.isArray(pptNewCards) ? pptNewCards : []) {
  if (!c || !c.id || !c.language || !c.setId) continue;
  (newBySet[`${c.language}/${c.setId}`] = newBySet[`${c.language}/${c.setId}`] || []).push(c);
}
let injectedNew = 0;

for (const lang of langs) {
  for (const chunk of chunksByLang[lang] || []) {
    let changed = false;
    // Injeta as cartas novas da PPT deste set+idioma (dedupe por id) antes do
    // processamento, pra entrarem no preço/índices/chunk como qualquer outra.
    const news = newBySet[`${lang}/${chunk.setId}`];
    if (news && news.length) {
      const have = new Set(chunk.cards.map((c) => c.id));
      for (const nc of news) {
        if (have.has(nc.id)) continue;
        const { _new, ...card } = nc; // remove a flag interna
        chunk.cards.push(card); have.add(nc.id); injectedNew++; changed = true;
      }
    }
    for (const card of chunk.cards) {
      const canonical = speciesByDex.get(speciesDexId(card));
      if (canonical && card.pokemonName !== canonical) {
        card.pokemonName = canonical;
        changed = true;
      }
      if (card.price) {
        pricing[card.id] = card.price;
        delete card.price;
        changed = true;
      }
      // Imagem da PPT (TCGplayer CDN) onde a TCGdex não tem (ex.: era Mega JP).
      const pp = pptData[card.id];
      if (pp && pp.img && !card.image) { card.image = pp.img; changed = true; }
      // Coleta as imagens EN (já com o fill da PPT) por id, pra usar como fallback
      // nas cartas localizadas (PT/JA/ZH) que não têm imagem própria.
      if (lang === "en" && card.image) enImageById.set(card.id, card.image);
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

// Fallback de imagem por idioma: carta localizada (PT/JA/ZH) sem imagem própria
// herda a imagem da MESMA carta em EN (mesmo id TCGdex, ex.: "mep-12-pt" ->
// "mep-12"). Texto/nome/bandeira seguem no idioma da carta — só a imagem é EN.
// Roda DEPOIS do loop (enImageById já completo, com o fill da PPT). Os objetos
// são os mesmos de allCards, então a alteração entra no catálogo unificado.
let imgFallbacks = 0;
for (const lang of langs) {
  if (lang === "en") continue;
  for (const chunk of chunksByLang[lang] || []) {
    let changed = false;
    for (const card of chunk.cards) {
      if (card.image) continue;
      const enImg = enImageById.get(String(card.id).replace(/-(pt|ja|zh-tw)$/, ""));
      if (enImg) { card.image = enImg; imgFallbacks++; changed = true; }
    }
    if (changed) await writeFile(new URL(`sets/${lang}/${chunk.file}`, dataDir), JSON.stringify(chunk.cards), "utf8");
  }
}
if (imgFallbacks) console.log(`Imagem EN herdada por cartas localizadas sem imagem própria: ${imgFallbacks}`);

// Preços de mercado BR (MYP), se o sync rodou com token (data/myp-prices.
// generated.json). Grava em pricing[id].b = { mn, md, mx }; o front prioriza
// isto sobre a referência internacional (shared.js#cardValue) e mostra o
// tooltip "Referência de mercado BR (MYP)". Sem o arquivo (token ausente) é
// no-op — o build segue só com a referência internacional.
//
// O JOIN entre a entrada do MYP e o cardId do catálogo é o ponto a calibrar
// quando o token chegar: a forma exata de editionCode/cardCode só se confirma
// com um retorno real (ver scripts/sync-myp.mjs). Hoje casa por nome
// normalizado + número da carta, registrando nos logs quantas casaram para
// validar/ajustar o join na primeira execução real.
await applyMypPrices(pricing, allCards);

// Preço/graded da PPT por cima: a TCGdex dá preço-lixo (Cardmarket EUR) pras
// cartas JP e pra várias EN (só o piso do Cardmarket, sem TCGplayer); o `u` da
// PPT é o mercado real do TCGplayer (JP + sets EN de alto valor), e sobrescreve.
// O front (shared.js#cardValue) prioriza `u` sobre `e`, então isso já conserta
// o valor JP. Graded (PSA 9/10) vai em `g` pra exibição no card.
let pptApplied = 0;
for (const [id, p] of Object.entries(pptData)) {
  if (!p) continue;
  const ref = pricing[id] || (pricing[id] = {});
  if (p.u > 0) { ref.u = p.u; pptApplied++; }
  if (p.g) ref.g = p.g;
}
if (Object.keys(pptData).length) console.log(`Preços PPT aplicados: ${pptApplied} (de ${Object.keys(pptData).length} no artefato)`);

const manifest = {
  languages: langs,
  generatedAt: new Date().toISOString(),
  sets: manifestSets
};

await writeFile(new URL("indexes.generated.js", dataDir), `window.TCG_INDEXES = ${JSON.stringify(buildIndexes(allCards))};\n`, "utf8");
await writeFile(new URL("manifest.generated.js", dataDir), `window.TCG_MANIFEST = ${JSON.stringify(manifest)};\n`, "utf8");
await writeFile(new URL("pricing.generated.js", dataDir), `window.TCG_PRICING = ${JSON.stringify(pricing)};\n`, "utf8");

if (pptNewCards.length) console.log(`Cartas novas da PPT (add-on-miss) injetadas: ${injectedNew}/${pptNewCards.length}`);
console.log(`Mesclados: ${allCards.length} cartas, ${manifestSets.length} sets (${langs.join(", ")})`);
console.log(`Preços de referência: ${Object.keys(pricing).length} cartas`);
console.log(`Espécies canônicas conhecidas: ${speciesByDex.size}`);

// Lê data/myp-prices.generated.json (se existir) e aplica os preços BR em
// pricing[id].b. Defensivo: ausência do arquivo = no-op silencioso.
async function applyMypPrices(priceTable, sourceCards) {
  let entries;
  try {
    entries = JSON.parse(await readFile(new URL("myp-prices.generated.json", dataDir), "utf8"));
  } catch {
    return; // sem token / sem arquivo — segue só com referência internacional
  }
  if (!Array.isArray(entries) || !entries.length) return;

  // Índice das entradas MYP por nome normalizado + número. Calibrar este join
  // (e o normalize() do sync-myp) quando houver retorno real da API.
  const byKey = new Map();
  for (const e of entries) {
    const num = mypNumber(e.cardCode);
    const name = normName(e.nameEn) || normName(e.namePt);
    if (name && num) byKey.set(`${name}#${num}`, e);
  }

  let applied = 0;
  for (const card of sourceCards) {
    const e = byKey.get(`${normName(card.name)}#${mypNumber(card.number)}`);
    if (!e) continue;
    const mn = num(e.min), md = num(e.avg) || num(e.min), mx = num(e.max);
    if (!md) continue;
    const ref = priceTable[card.id] || (priceTable[card.id] = {});
    ref.b = { mn: mn || md, md, mx: mx || md };
    applied++;
  }
  console.log(`Preços BR (MYP): ${entries.length} entradas, ${applied} casadas com o catálogo`);
}

function normName(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
// Número da carta (parte antes da barra, sem zeros à esquerda): "012/198" -> "12".
function mypNumber(s) {
  const m = String(s || "").match(/(\d+)/);
  return m ? String(Number(m[1])) : "";
}
function num(v) {
  const n = Number(String(v == null ? "" : v).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

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
