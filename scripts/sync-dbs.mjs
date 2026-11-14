// Catálogo do DRAGON BALL SUPER CARD GAME (Bandai, 2017+; a fase "Masters"
// desde 2022) a partir da TCGCSV (tcgcsv.com), espelho público diário do
// TCGplayer — categoria 27, "Dragon Ball Super: Masters" (conferida em
// 14/11/2026). Distinto do Fusion World (cat. 80, jogo `dbfw`) e do DBZ da
// Score (jogo `dbz`). Mesmo padrão do One Piece/FAB/DBFW: catálogo inteiro em
// data/dbs/ (cards.js versionado = durabilidade; ~107 grupos / ~11.700 cartas
// em 11/2026).
//
// Só a edição em INGLÊS: a japonesa não está no TCGplayer.
//
// Identidade: id = "dbs-<productId>". O número (BT10-001) se repete entre a
// carta do booster, a Pre-Release/Release Event com selo, a 2nd Edition e as
// promos de torneio, e cada uma é um produto próprio no TCGplayer.
//
// Acabamentos: Normal e Foil (os dois subtipos do TCGplayer pra este jogo).
// u = Normal (ou Foil, se só houver foil), uf = Foil.
//
// setId: a abreviação do grupo no TCGplayer (BT31, DBS-B10, DBS-B12PRE,
// BT31_PR…). O único código repetido é o BT26, que o TCGplayer usa também nas
// Pre-Release do Ultimate Advent: esse grupo fica em SET_FIXO.
//
// Imagens: CDN do TCGplayer (_in_1000x1000), host já liberado na CSP e no SW e
// coberto pelo espelho R2. 1.370 das 11.734 cartas vêm sem foto (imageCount 0,
// medido em 14/11/2026), quase todas Pre-Release, Release Event e 2nd Edition:
// a carta do set com um selo ou reimpressa. Essas pegam a foto da irmã do
// mesmo set (scripts/lib/imagem-da-irma.mjs, REGRAS_DBS abaixo). As promos de
// torneio e de judge sem foto ficam sem: têm arte própria.
//
// O que NÃO vem daqui: o ilustrador (a TCGCSV não publica).
//
// Logo de set: nenhum versionado. Sem logo, o front desenha o NOME do set
// (política única do site).
//
//   node scripts/sync-dbs.mjs
import { fileURLToPath } from "node:url";
import { writeGameCatalog, readGlobalVar, preserveMissingCards, fetchJsonRetry, sleep } from "./lib/sync-common.mjs";
import { nomeDoSet } from "./lib/nome-do-set.mjs";
import { fotosDasIrmas } from "./lib/imagem-da-irma.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/dbs/", ROOT);
const API = "https://tcgcsv.com/tcgplayer/27";
const UA = "Sleevu (sleevu.app) catalog sync";
const imagemDoProduto = (productId) => `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`;

// groupId -> setId, onde a abreviação da fonte repete a de outro grupo.
export const SET_FIXO = {
  23647: "BT26_PR" // Ultimate Advent Pre-Release Cards ("BT26", igual ao booster)
};

// Regra da carta-irmã (ver imagem-da-irma.mjs). Como no Fusion World, o
// número não diz a arte (a alt-art e as promos repetem o número), então só
// versão base com versão base. O carimbo é o sufixo que o grupo ganha na
// edição com selo ou reimpressa do mesmo set: "Rise of the Unison Warrior
// (2nd Edition)", "Fearsome Rivals Release Event", "Cross Spirits Pre-Release
// Cards".
export const REGRAS_DBS = {
  soArteBase: true,
  carimbo: /\s*(?:Release Event(?: Cards)?|Pre-Release Cards|\(2nd Edition\))\s*$/i
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
  const cru = String(g.abbreviation || "").trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, "");
  const base = SET_FIXO[g.groupId] || cru || `G${g.groupId}`;
  return usados.has(base) ? `${base}-${g.groupId}` : base;
}

// Produto da TCGCSV -> { card, price }. `by` = Map(subTypeName -> USD, só os
// com preço); `subtipos` = os acabamentos que o TCGplayer lista pra carta,
// com ou sem preço.
export function cardOf(p, g, setId, setTotal, by = new Map(), subtipos = new Set()) {
  const id = `dbs-${p.productId}`;
  const price = {};
  const foil = by.get("Foil") || 0;
  const u = by.get("Normal") || foil;
  if (u) price.u = u;
  if (foil) price.uf = foil;
  const presentes = new Set([...by.keys(), ...subtipos]);
  const variants = ["Normal", "Foil"].filter((v) => presentes.has(v));
  const card = {
    id,
    name: String(p.name || "").trim(),
    // Nome do grupo do TCGplayer sem o jogo na frente (contrato 7 do
    // docs/CATALOGO.md, regra em scripts/lib/nome-do-set.mjs).
    set: nomeDoSet("dbs", g.name),
    setId,
    // "BT10-001", "P-123", "SD4-01", "EX21-05": o código impresso.
    number: ext(p, "Number"),
    setTotal,
    setReleaseDate: (g.publishedOn || "").slice(0, 10),
    // Common, Uncommon, Rare, Super Rare, Special Rare, Secret Rare, Starter
    // Rare, Expansion Rare, Promo e as raras de coleção (God Rare, Special
    // Leader Rare, Concept Rare…).
    rarity: ext(p, "Rarity"),
    artist: "", // a TCGCSV não publica o ilustrador
    language: "en",
    image: imagemDoProduto(p.productId),
    variants: variants.length ? variants : ["Normal"],
    // Leader, Battle, Extra, Unison, Z-Extra, Z-Battle…
    cardType: ext(p, "CardType") || null,
    // Red, Blue, Green, Yellow, Black; a de várias cores vem "Red;Blue".
    // `color` é o nome que o índice de busca e o editor de decks esperam.
    color: ext(p, "Color") || null,
    // Custo de energia ("2(R)"), como o TCGplayer escreve.
    cost: ext(p, "EnergyColor Cost") || null,
    power: ext(p, "Power") || null
  };
  return { card, price: Object.keys(price).length ? price : null };
}

async function run() {
  console.log("DBS: buscando sets (TCGCSV cat. 27)…");
  const groups = await api("/groups");
  console.log(`  ${groups.length} grupos.`);

  const usados = new Set();
  const cards = [];
  const pricing = {}; // { id: { u, uf } } — USD market do TCGplayer
  // Produtos de TODOS os grupos: a irmã com foto está no set sem o selo.
  const irmas = fotosDasIrmas(REGRAS_DBS);

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

    // Carta = produto com "Number"; o resto é selado (booster, display, deck).
    const setCards = products.filter((p) => ext(p, "Number"));
    if (!setCards.length) { console.log(`  ${g.groupId} ${g.name}: 0 cartas (só selados ou ainda vazio)`); continue; }

    const setId = setIdOf(g, usados);
    usados.add(setId);
    for (const p of setCards) {
      const { card, price } = cardOf(p, g, setId, setCards.length, priceBy.get(p.productId), subtiposDe.get(p.productId));
      cards.push(card);
      if (price) pricing[card.id] = price;
      irmas.anota(p, g, card.number, card);
    }
    console.log(`  ${setId} ${g.name}: ${setCards.length} cartas`);
  }
  console.log((await irmas.aplica(imagemDoProduto)).resumo);

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

  await writeGameCatalog(OUT, { cards: merged, indexes, pricing, webDir: "data/dbs/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} (cards/indexes/pricing + manifest/chunks).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
