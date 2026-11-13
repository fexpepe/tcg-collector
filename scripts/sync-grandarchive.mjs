// Catálogo do GRAND ARCHIVE TCG (Weebs of the Shore, 2023+) a partir da TCGCSV
// (tcgcsv.com), espelho público diário do TCGplayer — categoria 74, linha
// `grand-archive` (conferidas em 13/11/2026). Mesmo padrão do Riftbound e do
// Final Fantasy: catálogo inteiro em data/grandarchive/ (cards.js versionado =
// durabilidade; 52 sets / ~5.350 cartas em 11/2026).
//
// Identidade: id = "ga-<productId>". O NÚMERO não serve de id: dentro do mesmo
// set a versão de colecionador repete o número da comum ("Lorraine,
// Blademaster" e "Lorraine, Blademaster (CUR)" são as duas 005), a "(Curio
// Foil)" idem, e o grupo "Promotional Cards" junta as promos de todos os anos
// (três cartas diferentes com o número 001). Cada produto é uma carta.
//
// Acabamentos: Normal / Foil no MESMO produto (u/uf), como o Riftbound.
//
// Imagens: CDN do TCGplayer (_in_1000x1000), host já liberado na CSP e no SW e
// coberto pelo espelho R2. Quase tudo vem em 500×700 (o Mortal Ambition em
// 714×1000). O Index oficial (api.gatcg.com/cards/images/<uuid>.jpg) tem o
// MESMO 500×700, então não há fonte maior (medido em 13/11/2026).
// A regra da foto da carta-irmã (scripts/lib/imagem-da-irma.mjs) fica
// DESLIGADA: só 15 cartas estão sem foto, 11 delas num bloco do Mortal
// Ambition Alter Edition que ainda não subiu, e a irmã de mesmo número é a
// carta comum — a Alter Edition e a "(CSR)" têm outra arte. Sem irmã, a carta
// fica com a URL dela e a foto aparece no dia em que o TCGplayer subir.
//
// setId: a abreviação da TCGCSV, em maiúscula e com hífen no lugar de espaço e
// pontuação ("DOA 1st" -> "DOA-1ST", "ALC Alter" -> "ALC-ALTER", "ReC: MSD" ->
// "REC-MSD"): o setId vira nome de arquivo e pedaço de URL. Todas as 56
// abreviações existem e nenhuma repete (13/11/2026); se um dia repetir, o
// groupId desempata.
//
// Data: o "2023 Demo Deck" vem com publishedOn de 12/11/2026 (o dia em que a
// TCGCSV mexeu no grupo) e entraria em /lancamentos como novidade. O Index
// oficial dá 01/08/2023 pro "LGS Demo 2023" (DATA_FIXA).
//
// O que NÃO vem daqui: o ilustrador (a TCGCSV não publica; o Index oficial
// tem, mas os códigos de set dele não batem um a um com os do TCGplayer —
// "PRD 1st" × "PRD", "ReC-AUR" × "AURR" — e o cruzamento ficou pra depois).
//
// Logo de set: nenhum versionado. Sem logo, o front desenha o NOME (política
// única do site).
//
//   node scripts/sync-grandarchive.mjs
import { fileURLToPath } from "node:url";
import { writeGameCatalog, readGlobalVar, preserveMissingCards, fetchJsonRetry, sleep } from "./lib/sync-common.mjs";
import { nomeDoSet } from "./lib/nome-do-set.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/grandarchive/", ROOT);
const API = "https://tcgcsv.com/tcgplayer/74";
const UA = "Sleevu (sleevu.app) catalog sync";
const imagemDoProduto = (productId) => `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`;

// groupId -> data de lançamento, quando a da fonte está errada (ver cabeçalho).
export const DATA_FIXA = {
  23238: "2023-08-01" // 2023 Demo Deck
};

const listOf = (j) => (j && Array.isArray(j.results)) ? j.results : [];
const api = async (path) => listOf(await fetchJsonRetry(`${API}${path}`, { headers: { "User-Agent": UA, Accept: "application/json" } }));

const r2 = (x) => Math.round(x * 100) / 100;
export const ext = (p, key) => {
  const d = (p.extendedData || []).find((e) => e.name === key);
  return d && d.value != null ? String(d.value).trim() : "";
};

// `usados` = setIds já tomados nesta rodada.
export function setIdOf(g, usados = new Set()) {
  const base = String(g.abbreviation || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `G${g.groupId}`;
  return usados.has(base) ? `${base}-${g.groupId}` : base;
}

const VARIANT_ORDER = ["Normal", "Foil"];
const pick = (map, names) => { for (const n of names) { if (map.get(n) > 0) return map.get(n); } return 0; };

// Produto da TCGCSV -> { card, price }. `by` = Map(subTypeName -> USD, só os
// com preço); `subtipos` = os acabamentos que o TCGplayer lista pra carta,
// com ou sem preço.
export function cardOf(p, g, setId, setTotal, by = new Map(), subtipos = new Set()) {
  const id = `ga-${p.productId}`;
  const price = {};
  const u = pick(by, ["Normal", "Foil"]);
  const uf = pick(by, ["Foil"]);
  if (u) price.u = u;
  if (uf) price.uf = uf;
  const presentes = new Set([...by.keys(), ...subtipos]);
  const variants = VARIANT_ORDER.filter((v) => presentes.has(v));
  const card = {
    id,
    // O nome fica como veio: "(CSR)", "(CUR)", "(CPR)" e "(Curio Foil)" são o
    // que separa as versões que dividem o número.
    name: String(p.name || "").trim(),
    // Nome do grupo do TCGplayer sem o jogo na frente (contrato 7 do
    // docs/CATALOGO.md, regra em scripts/lib/nome-do-set.mjs).
    set: nomeDoSet("grandarchive", g.name),
    setId,
    number: ext(p, "Number"),
    setTotal,
    setReleaseDate: DATA_FIXA[g.groupId] || (g.publishedOn || "").slice(0, 10),
    // Common, Uncommon, Rare, Super Rare, Ultra Rare, Promo e as de
    // colecionador (Collector Super Rare / Ultra Rare / Promo).
    rarity: ext(p, "Rarity"),
    artist: "", // a TCGCSV não publica o ilustrador
    language: "en",
    image: imagemDoProduto(p.productId),
    variants: variants.length ? variants : ["Normal"],
    // Action, Ally, Champion, Attack, Item, Regalia, Weapon… A carta de dois
    // tipos vem "Item;Regalia" (e às vezes na outra ordem).
    cardType: ext(p, "CardType") || null,
    // ELEMENTO (Norm, Fire, Water, Wind e os avançados): `color` é o nome que
    // o índice de busca e o editor de decks esperam (COLOR_FIELDS no
    // sync-common), como no Final Fantasy e no Sorcery.
    color: ext(p, "Element") || null,
    // Classe do campeão que joga a carta (Cleric, Mage, Warrior…; a de duas
    // classes vem "Cleric;Mage").
    cardClass: ext(p, "Class") || null,
    // Custo de reserva (cartas do deck principal) ou de memória (as do
    // material deck): a carta tem um ou outro.
    cost: ext(p, "Reserve Cost") || ext(p, "MemoryCost") || null
  };
  return { card, price: Object.keys(price).length ? price : null };
}

async function run() {
  console.log("Grand Archive: buscando sets (TCGCSV cat. 74)…");
  const groups = await api("/groups");
  console.log(`  ${groups.length} grupos.`);

  const usados = new Set();
  const cards = [];
  const pricing = {}; // { id: { u, uf } } — USD market do TCGplayer

  for (const g of groups) {
    await sleep(120); // educado com o espelho comunitário
    let products, prices;
    try {
      products = await api(`/${g.groupId}/products`);
      prices = await api(`/${g.groupId}/prices`);
    } catch (e) {
      console.warn(`  ${g.groupId} ${g.name}: erro ${e.message} (pulado)`);
      continue;
    }
    const priceBy = new Map();    // productId -> Map(subType -> USD)
    const subtiposDe = new Map(); // productId -> Set(subType), com ou sem preço
    for (const p of prices) {
      if (!subtiposDe.has(p.productId)) subtiposDe.set(p.productId, new Set());
      if (p.subTypeName) subtiposDe.get(p.productId).add(p.subTypeName);
      const v = Number(p.marketPrice) > 0 ? p.marketPrice : (Number(p.midPrice) > 0 ? p.midPrice : 0);
      if (v <= 0) continue;
      if (!priceBy.has(p.productId)) priceBy.set(p.productId, new Map());
      priceBy.get(p.productId).set(p.subTypeName, r2(v));
    }

    // Carta = produto com "Number"; o resto é selado (booster, display, kit).
    const setCards = products.filter((p) => ext(p, "Number"));
    if (!setCards.length) { console.log(`  ${g.groupId} ${g.name}: 0 cartas (só selados ou ainda vazio)`); continue; }

    const setId = setIdOf(g, usados);
    usados.add(setId);
    for (const p of setCards) {
      const { card, price } = cardOf(p, g, setId, setCards.length, priceBy.get(p.productId), subtiposDe.get(p.productId));
      cards.push(card);
      if (price) pricing[card.id] = price;
    }
    console.log(`  ${setId} ${g.name}: ${setCards.length} cartas`);
  }

  // União preservadora: carta que sumiu do espelho fica (do cards.js anterior).
  const prev = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const merged = cards.concat(preserveMissingCards(prev, cards));

  merged.sort((a, b) =>
    String(a.setReleaseDate).localeCompare(String(b.setReleaseDate))
    || a.setId.localeCompare(b.setId)
    || a.number.localeCompare(b.number, undefined, { numeric: true })
    || a.id.localeCompare(b.id));
  console.log(`Total: ${merged.length} cartas, ${Object.keys(pricing).length} com preço.`);

  // setLogo: VAZIO (ver cabeçalho); o front desenha o NOME do set como título
  // (.set-logo-placeholder).
  for (const c of merged) { c.setLogo = ""; }

  const bySet = new Map();
  for (const c of merged) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c.id); }
  const indexes = {
    sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)),
    artists: []
  };

  await writeGameCatalog(OUT, { cards: merged, indexes, pricing, webDir: "data/grandarchive/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} (cards/indexes/pricing + manifest/chunks).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
