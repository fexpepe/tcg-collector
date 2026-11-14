// Catálogo do HOLOLIVE OFFICIAL CARD GAME (Bushiroad/COVER, edição em inglês,
// 2025+) a partir da TCGCSV (tcgcsv.com), espelho público diário do TCGplayer —
// categoria 87, linha `hololive-official-card-game` (conferidas em
// 13/11/2026). Mesmo padrão da Union Arena e do Grand Archive: catálogo
// inteiro em data/hololive/ (cards.js versionado = durabilidade; 24 sets /
// ~2.060 cartas em 11/2026).
//
// Só a edição em INGLÊS: a japonesa (desde 09/2024) não está no TCGplayer. O
// banco oficial japonês tem a lista, mas sem preço — ficou pra depois.
//
// Identidade: id = "holo-<productId>". O NÚMERO não serve de id: 341 cartas
// dividem número E raridade com outra (a reimpressão num produto seguinte, a
// arte alternativa, as versões de torneio "Bloom Cup"), e o prefixo do número
// não é o set — o booster hBP06 traz cartas hBP01, hSD02 e as Cheer hY01. Cada
// produto é uma carta, e o qualificador do nome ("(SR)", "(Alternate Art)")
// fica, porque é o que separa as versões.
//
// Acabamentos: cada produto é Normal OU Foil, nunca os dois (medido: nenhum
// produto com dois subtipos). O preço base (`u`) é o do acabamento que existe.
//
// Imagens: CDN do TCGplayer (_in_1000x1000), host já liberado na CSP e no SW e
// coberto pelo espelho R2. Numa amostra de 219 cartas, 81% vêm com 500–699 px
// de largura, 12% com 700+ e 6% abaixo de 500. O site oficial
// (en.hololive-official-cardgame.com/cardlist) serve só 400×559, então não há
// fonte maior (medido em 13/11/2026). Nenhuma carta sem foto: a regra da
// carta-irmã (scripts/lib/imagem-da-irma.mjs) fica desligada.
//
// setId: o CÓDIGO OFICIAL do produto, o que a carta imprime antes do hífen
// ("hBP01-001"), em maiúscula: HBP01, HSD12, HEB01. A abreviação da TCGCSV
// muda de grafia de um grupo pro outro ("BP01E", "HBP03E", "hBP08e", "SD012E")
// e o setId vira arquivo e URL, então sai dela por regra: tira o "E" da edição
// inglesa, põe o "H" que falta e deixa o número com dois dígitos. Os dois
// grupos sem código na abreviação ficam em SET_FIXO.
//
// O que NÃO vem daqui: o ilustrador (a TCGCSV não publica).
//
// Logo de set: nenhum versionado. Sem logo, o front desenha o NOME (política
// única do site).
//
//   node scripts/sync-hololive.mjs
import { fileURLToPath } from "node:url";
import { writeGameCatalog, readGlobalVar, preserveMissingCards, fetchJsonRetry, sleep } from "./lib/sync-common.mjs";
import { nomeDoSet } from "./lib/nome-do-set.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/hololive/", ROOT);
const API = "https://tcgcsv.com/tcgplayer/87";
const UA = "Sleevu (sleevu.app) catalog sync";
const imagemDoProduto = (productId) => `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`;

// groupId -> setId, onde a abreviação da fonte não carrega o código oficial.
export const SET_FIXO = {
  24346: "HYS01", // Start Cheer Set ("S01E" na fonte; as cartas são hYS01-…)
  24398: "HPR"    // hololive OFFICIAL CARD GAME Promos ("hOCGP"; as promos são hPR-…)
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
  const cru = String(g.abbreviation || "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
  const m = /^H?([A-Z]+?)0*(\d{1,2})E?$/.exec(cru);
  const base = SET_FIXO[g.groupId] || (m ? `H${m[1]}${m[2].padStart(2, "0")}` : cru) || `G${g.groupId}`;
  return usados.has(base) ? `${base}-${g.groupId}` : base;
}

// O texto da carta vem com HTML do TCGplayer ("<br>", "\r\n"); os campos que o
// catálogo guarda são de uma palavra só, mas a etiqueta ("#JP;#Gen0") não.
const limpa = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// Produto da TCGCSV -> { card, price }. `by` = Map(subTypeName -> USD, só os
// com preço); `subtipos` = os acabamentos que o TCGplayer lista pra carta,
// com ou sem preço.
export function cardOf(p, g, setId, setTotal, by = new Map(), subtipos = new Set()) {
  const id = `holo-${p.productId}`;
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
    set: nomeDoSet("hololive", g.name),
    setId,
    // "hBP01-001": o código impresso, com o "h" minúsculo da marca.
    number: ext(p, "Number"),
    setTotal,
    setReleaseDate: (g.publishedOn || "").slice(0, 10),
    // Common, Uncommon, Rare, Double Rare, Super Rare, Holomem Rare, Ultra
    // Rare, as do Oshi (Oshi Common / Super Rare / Ultra Rare), Secret Rare,
    // Special, Special Yell e Promo.
    rarity: ext(p, "Rarity"),
    artist: "", // a TCGCSV não publica o ilustrador
    language: "en",
    image: imagemDoProduto(p.productId),
    variants: variants.length ? variants : ["Normal"],
    // holomem, Oshi holomem, buzz holomem, Support e Cheer.
    cardType: ext(p, "CardType") || null,
    // White, Green, Red, Blue, Purple, Yellow e Neutral; a de duas cores vem
    // "Blue;Red" (e às vezes na outra ordem). `color` é o nome que o índice
    // de busca e o editor de decks esperam (COLOR_FIELDS no sync-common).
    color: ext(p, "Color") || null,
    // Debut, 1st, 2nd e Spot — o degrau do holomem (a fonte grava "spot").
    bloom: (ext(p, "BloomLevel") || "").replace(/^spot$/i, "Spot") || null,
    // Staff, Item, Event, Tool, Mascot e Fan: o tipo do Support.
    subtype: ext(p, "Subtype") || null,
    hp: ext(p, "HP") || null,
    // "#JP;#Gen0;#Song": as etiquetas que os efeitos procuram.
    tags: limpa(ext(p, "Tags")) || null
  };
  return { card, price: Object.keys(price).length ? price : null };
}

async function run() {
  console.log("hololive: buscando sets (TCGCSV cat. 87)…");
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

    // Carta = produto com "Number"; o resto é selado (booster, display, deck).
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

  await writeGameCatalog(OUT, { cards: merged, indexes, pricing, webDir: "data/hololive/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} (cards/indexes/pricing + manifest/chunks).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
