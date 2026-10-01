// Catálogo do World of Warcraft TCG (Upper Deck 2006–2010, Cryptozoic
// 2010–2013; a Blizzard encerrou a licença em agosto de 2013) a partir da
// TCGCSV (tcgcsv.com), espelho público diário do TCGplayer — categoria 13
// ("WoW"), linha `wow` (conferidas em 30/09/2026: a busca
// tcgplayer.com/search/wow/product devolve a carta "in WoW"). Jogo VINTAGE com
// preço: o primeiro do site (os outros vintages não têm fonte de preço).
//
// Decisão do Fernando (30/09/2026): usar SÓ o que a TCGCSV tem. O que isso
// deixa de fora, medido no mesmo dia contra o dataset aberto do CardCarp
// (github.com/cardcarp/wow, 7.922 impressões oficiais):
//   - os sets de 2012–2013 (Crown of the Heavens, Tomb of the Forgotten, War
//     of the Ancients, Betrayal of the Guardian, Reign of Fire), os raids
//     Battle of the Aspects e Caverns of Time, os dungeon decks e os class
//     decks de 2011/2013: o TCGplayer nunca os listou. A TCGCSV tem 4.672
//     cartas, ~59% do jogo;
//   - o NÚMERO de coleção ("198/361"): a TCGCSV não tem o campo Number nesta
//     categoria, então `number` fica vazio e a ordem dentro do set cai no nome;
//   - imagem boa: o TCGplayer só tem scan de ~200 px destas cartas (o
//     _in_1000x1000 devolve 200×279, e o product-images "1000" é o mesmo scan
//     esticado). O espelho R2 nunca amplia, então fica nesse tamanho.
// Se a Coleção mostrar demanda, o passo seguinte é completar pelo CardCarp
// (número, scan de 745×1040 e os sets que faltam): o cruzamento set + nome
// casa 99,5% das cartas da TCGCSV.
//
// Identidade: id = "wow-<productId>" (`wow-` livre no Pokémon e no Lorcana,
// 7.3 do docs/CATALOGO.md). Imagens: CDN do TCGplayer, host já liberado na
// CSP e no SW e já coberto pelo espelho R2. Acabamentos: Normal / Foil (u/uf);
// o TCGplayer só cota foil de 140 cartas.
//
// Carta = produto com Rarity; o resto é selado (booster, deck, display). Os
// grupos só de selados (Archives, Naxxramas, os class decks de 2010/2011…)
// não viram set. Raridade vem em código de uma letra; as que o jogo imprime
// viram o nome (C/U/R/E). "L" só existe no grupo Loot Cards (Loot). "F" é o
// código do TCGplayer pras cartas do raid de Onyxia e a própria loja mostra
// só "F" (conferido em 30/09/2026): fica como veio, sem inventar o que é.
//
// setId: a TCGCSV deixou a abreviação VAZIA em 51 dos 54 grupos. Como setId
// publicado não muda nunca (URL, régua do lint), os códigos ficam FIXOS pelo
// groupId aqui (padrão do sync-cyberpunk). Grupo novo sem pin cai em
// "G<groupId>" e avisa no log (o jogo acabou em 2013; só se o TCGplayer abrir
// grupo novo de algo antigo).
//
// Nome e data: alguns grupos vêm com nome de estoque ("CRP", "BoJ", "CAT
// Promos") e sem data — a TCGCSV devolve publishedOn nulo, ou a data em que o
// TCGplayer abriu o grupo (Loot Cards 2017, Dungeon Treasure 2018). O nome
// entra no endereço do set (/games/<jogo>/<set>), então os que mudam aqui
// ficam FIXOS desde a primeira publicação. Fonte do nome e do mês: os sets do
// CardCarp (pelo nome das cartas de cada grupo) e a Wikipedia ("World of
// Warcraft Trading Card Game", lista de expansões e raids), 30/09/2026. Onde
// só o mês tem fonte, o dia é 01.
//
// Logo de set: nenhum curado — a tela mostra o NOME (política única do site).
//
//   node scripts/sync-wow.mjs
import { fileURLToPath } from "node:url";
import { writeGameCatalog, readGlobalVar, preserveMissingCards, fetchJsonRetry, sleep } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/wow/", ROOT);
const API = "https://tcgcsv.com/tcgplayer/13";
const UA = "Sleevu (sleevu.app) catalog sync";

// groupId -> setId (ver cabeçalho). Expansões pela sigla usada pela
// comunidade; raids pelo nome curto, com "-T" no baú de tesouro (treasure).
export const ABREV_FIXA = {
  // Expansões (boosters)
  1082: "HOA", 1071: "TDP", 1080: "FOO", 1087: "MOL", 1095: "SOB", 1099: "HFI",
  1076: "DOW", 1066: "BOG", 1079: "FOH", 1094: "SCW", 1107: "WG", 1084: "ICE",
  1105: "WB", 1104: "WOE", 1102: "TOD", 1100: "TOT", 1923: "TWK",
  // Raids e dungeons
  1092: "ONY", 1093: "ONY-T", 1088: "MC", 1089: "MC-T", 1085: "MAG", 1086: "MAG-T",
  1097: "BT", 1098: "BT-T", 1091: "NAX-T", 1064: "ICC", 2375: "DT",
  // Decks
  1069: "CSD", 1075: "DKS", 1077: "DOWS",
  // Promos e extras
  1334: "LOOT", 1070: "CRAFT", 1067: "BOJ", 1063: "AGM", 1073: "DMF", 1078: "FWV",
  1081: "BC07", 1096: "TBCP", 1106: "WLKP", 1068: "CATP"
};

// groupId -> nome de exibição, onde o do TCGplayer é sigla de estoque ou
// encurtado (ver cabeçalho).
export const NOME_FIXO = {
  1071: "Through the Dark Portal",
  1070: "Crafting Cards",                 // "CRP": as cartas de crafting de 2006 a 2011
  1067: "Badges of Justice",              // "BoJ"
  1068: "Cataclysm Collector's Edition Promos",
  1096: "The Burning Crusade Collector's Edition Promos",
  1106: "Wrath of the Lich King Collector's Edition Promos",
  1081: "BlizzCon 2007 Promo",            // "Giveaway": Mrglrglmrglmrrrlggg
  1069: "Class Starter Decks (2010)",
  1078: "Feast of Winter Veil (2007)"
};

// groupId -> data, onde a TCGCSV não tem a de lançamento (ver cabeçalho).
export const DATA_FIXA = {
  1334: "2006-10-25", // Loot Cards: os loots de 2006 a 2011; a data é a do 1º (Heroes of Azeroth)
  1070: "2006-10-25", // Crafting: idem, do Azeroth Crafting em diante
  2375: "2011-11-01", // Dungeon Treasure: os dungeon decks saíram em nov/2011
  1923: "2012-10-01", // Timewalkers Heroes: War of the Ancients, out/2012 (a TCGCSV diz abr/2013)
  1067: "2009-11-01", // Badge of Justice do Scourgewar
  1068: "2010-12-07", // Cataclysm Collector's Edition
  1069: "2010-07-01", // Class Starter (2010)
  1073: "2009-05-01", // Darkmoon Faire
  1075: "2009-06-01", // Death Knight Starter
  1077: "2008-10-28", // Drums of War Starter: saiu com a expansão
  1078: "2007-11-01", // Feast of Winter Veil (2007)
  1081: "2007-08-03", // BlizzCon 2007
  1096: "2007-01-16", // The Burning Crusade Collector's Edition
  1106: "2008-11-13", // Wrath of the Lich King Collector's Edition
  1097: "2008-09-01", // Black Temple (raid)
  1098: "2008-09-01"  // Black Temple Treasure
};

export const RARIDADE = { C: "Common", U: "Uncommon", R: "Rare", E: "Epic", L: "Loot" };

const listOf = (j) => (j && Array.isArray(j.results)) ? j.results : [];
const api = async (path) => listOf(await fetchJsonRetry(`${API}${path}`, { headers: { "User-Agent": UA, Accept: "application/json" } }));

const r2 = (x) => Math.round(x * 100) / 100;
export const ext = (p, key) => {
  const d = (p.extendedData || []).find((e) => e.name === key);
  return d && d.value != null ? String(d.value).trim() : "";
};

export const setIdOf = (g) => ABREV_FIXA[g.groupId] || `G${g.groupId}`;
export const setNameOf = (g) => NOME_FIXO[g.groupId] || g.name;
export const releaseOf = (g) => DATA_FIXA[g.groupId] || String(g.publishedOn || "").slice(0, 10);
export const isCard = (p) => !!ext(p, "Rarity");

const VARIANT_ORDER = ["Normal", "Foil"];
const pick = (map, names) => { for (const n of names) { if (map.get(n) > 0) return map.get(n); } return 0; };

// Produto da TCGCSV -> { card, price }. `by` = Map(subTypeName -> USD).
export function cardOf(p, g, setTotal, by = new Map()) {
  const id = `wow-${p.productId}`;
  const price = {};
  const u = pick(by, ["Normal", "Foil"]);
  const uf = pick(by, ["Foil"]);
  if (u) price.u = u;
  if (uf) price.uf = uf;
  const variants = VARIANT_ORDER.filter((v) => by.has(v));
  const r = ext(p, "Rarity");
  const card = {
    id,
    name: p.name,
    set: setNameOf(g),
    setId: setIdOf(g),
    number: "",
    setTotal,
    setReleaseDate: releaseOf(g),
    rarity: RARIDADE[r] || r,
    artist: "",
    language: "en",
    image: `https://tcgplayer-cdn.tcgplayer.com/product/${p.productId}_in_1000x1000.jpg`,
    variants: variants.length ? variants : ["Normal"]
  };
  return { card, price: Object.keys(price).length ? price : null };
}

async function run() {
  console.log("World of Warcraft TCG: buscando sets (TCGCSV cat. 13)…");
  const groups = await api("/groups");
  console.log(`  ${groups.length} grupos.`);

  const cards = [];
  const pricing = {}; // { id: { u, uf } } — USD market do TCGplayer

  for (const g of groups) {
    await sleep(120);
    let products, prices;
    try {
      products = await api(`/${g.groupId}/products`);
      prices = await api(`/${g.groupId}/prices`);
    } catch (e) {
      console.warn(`  ${g.groupId} ${g.name}: erro ${e.message} (pulado)`);
      continue;
    }
    const priceBy = new Map();
    for (const p of prices) {
      const v = Number(p.marketPrice) > 0 ? p.marketPrice : (Number(p.midPrice) > 0 ? p.midPrice : 0);
      if (v <= 0) continue;
      if (!priceBy.has(p.productId)) priceBy.set(p.productId, new Map());
      priceBy.get(p.productId).set(p.subTypeName, r2(v));
    }

    const setCards = products.filter(isCard);
    if (!setCards.length) { console.log(`  ${g.groupId} ${g.name}: 0 cartas (só selados)`); continue; }
    if (!ABREV_FIXA[g.groupId]) console.warn(`  AVISO: grupo novo sem pin (${g.groupId} ${g.name}) -> setId "${setIdOf(g)}". Pinar em ABREV_FIXA antes de publicar.`);
    for (const p of setCards) {
      const { card, price } = cardOf(p, g, setCards.length, priceBy.get(p.productId));
      cards.push(card);
      if (price) pricing[card.id] = price;
    }
    console.log(`  ${setIdOf(g)} ${setNameOf(g)}: ${setCards.length} cartas`);
  }

  const prev = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const merged = cards.concat(preserveMissingCards(prev, cards));

  // Sem número: dentro do set, a ordem é a do nome.
  merged.sort((a, b) =>
    String(a.setReleaseDate).localeCompare(String(b.setReleaseDate))
    || a.setId.localeCompare(b.setId)
    || a.name.localeCompare(b.name, "en")
    || a.id.localeCompare(b.id));
  console.log(`Total: ${merged.length} cartas, ${Object.keys(pricing).length} com preço.`);

  for (const c of merged) c.setLogo = "";

  const bySet = new Map();
  for (const c of merged) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c.id); }
  const indexes = {
    sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)),
    artists: []
  };

  await writeGameCatalog(OUT, { cards: merged, indexes, pricing, webDir: "data/wow/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} (cards/indexes/pricing + manifest/chunks).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
