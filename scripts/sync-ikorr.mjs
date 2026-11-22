// Catálogo do RUSH OF IKORR (Upper Deck, lançado em 11/06/2025) a partir da
// TCGCSV (tcgcsv.com), espelho público diário do TCGplayer — categoria 94,
// linha `rush-of-ikorr` (conferidas em 22/11/2026). Mesmo padrão do Sorcery e
// do Shadowverse: catálogo inteiro em data/ikorr/ (cards.js versionado =
// durabilidade; 5 grupos / ~1.185 cartas em 11/2026).
//
// Identidade: id = "ikr-<productId>" (prefixo livre, conferido com a 7.3 do
// docs/CATALOGO.md; "roi-" também estava livre, mas é o código do primeiro
// set e confundiria o id com o número impresso).
//
// O que este jogo tem de diferente dos outros da família TCGCSV:
//
// 1. CADA CARTA SÃO ATÉ TRÊS PRODUTOS. O TCGplayer cadastra a carta (com os
//    subtipos de preço Normal e Foil) e, à parte, "X (Fracture Foil)" e
//    "X (Rapture Foil)", os dois acabamentos especiais, com o MESMO número
//    impresso. Os produtos Fracture e Rapture não têm foto (0 de 1.042 em
//    22/11/2026) e o Rapture quase não tem preço (1 de 405): como cartas
//    soltas, seriam 2.223 tiles, metade sem imagem. Aqui os três viram UMA
//    carta, juntados pelo NÚMERO dentro do grupo, com as versões Normal,
//    Foil, Fracture Foil e Rapture Foil (as que existem). Pelo número, e não
//    pelo nome, porque a fonte escreve o nome do foil com erro às vezes
//    ("Seth, Enigma of the Red Land (Alt Art (Fracture Foil)", sem fechar o
//    parêntese).
//
// 2. PREÇO POR VERSÃO. `u` = Normal (ou a primeira com preço), `uf` = Foil
//    (ou o Fracture, ou o Rapture) e `v` = o preço próprio do Fracture e do
//    Rapture, que o cliente lê pela versão do tile (usdForVariant, em
//    scripts/lib/pricing.mjs e no shared.js). É o primeiro jogo da TCGCSV a
//    usar o `v` (o Pokémon usa desde 14/09/2026). Versão foil SEM cotação
//    própria cai no `uf`: o Rapture sem venda aparece com o preço do Foil
//    comum, como o Cold Foil do FAB. Limitação aceita: o valor sai por baixo,
//    nunca inventado pra cima.
//
// 3. O id é PEGAJOSO entre os produtos da carta (como no Sorcery). Sai do
//    produto da carta (o que tem foto); se o catálogo anterior já tem a carta
//    com o id de outro produto do grupo, esse fica. A carta que só existe
//    como foil especial usa o productId dele.
//
// 4. As outras impressões têm NÚMERO PRÓPRIO e são cartas próprias: Alt Art
//    (raridade "A", com Fracture Foil), Scrollwork, Expression, Starter e as
//    Influence Card de número no nome.
//
// Número: o que a carta imprime no rodapé, com a raridade ("ROI-001 R"); o
// banco oficial da Upper Deck grava igual. A fonte escreveu "RO!-206 R" numa
// carta, e o número volta pra "ROI-206 R" (o banco oficial confirma). O
// número que o TCGplayer cola no nome ("Influence Card (ROI-197)") sai do
// nome quando é o desta carta: ele já está no campo `number`.
//
// Campos do jogo: o tipo (Avatar, Champion, Fabled Champion, Spell, Location,
// Influence, Infusion…) em `cardType`; a LEALDADE (o panteão: Japanese,
// Greek, Egyptian, Maya, Chinese) em `color`, o nome que o índice de busca e
// o editor de decks leem; os ASPECTOS ("Devotion;Fear") em `aspect`; o tipo
// do campeão (Human, Beast, God…) em `trait`; o custo de influência em
// `cost`; ataque, vida e raid.
//
// setId: FIXO por groupId com o código que a carta imprime (ROI, RMB, RLS,
// REJ) e o da fonte nas promos (RIPC). setId publicado não muda nunca (URL,
// régua do lint); grupo novo sem pin avisa no log.
//
// Imagens: CDN do TCGplayer (_in_1000x1000 = 716×1000), host já liberado na
// CSP e no SW e coberto pelo espelho R2. As 7 promos de 11/2026 não têm foto
// no TCGplayer: ficam com o endereço do CDN, e o front cai no verso, como no
// Shadowverse.
//
// O que NÃO vem daqui: o ilustrador. A carta o imprime ("Artist: Narendra
// Adi") e o banco oficial da Upper Deck o publica
// (https://my.upperdeck.com/public/roi/cards, JSON no `data-page`, 913 cartas,
// mesmo número da TCGplayer; robots.txt libera /public, conferido em
// 22/11/2026). Fica pra uma segunda etapa.
//
// Logo de set: só o Epic Journey tem um publicado (site da Upper Deck); os
// outros não. Todos mostram o NOME, como manda a política do site, até
// alguém curar os logos.
//
//   node scripts/sync-ikorr.mjs
import { fileURLToPath } from "node:url";
import { writeGameCatalog, readGlobalVar, preserveMissingCards, fetchJsonRetry, sleep } from "./lib/sync-common.mjs";
import { nomeDoSet } from "./lib/nome-do-set.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/ikorr/", ROOT);
const API = "https://tcgcsv.com/tcgplayer/94";
const UA = "Sleevu (sleevu.app) catalog sync";
const imagemDoProduto = (productId) => `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`;

// groupId -> setId (ver cabeçalho).
export const ABREV_FIXA = {
  24891: "ROI",  // Shattered Chaos Act 1 Part 1 (06/2025)
  24892: "RMB",  // Merciless Battlegrounds Act 1 Part 2
  24893: "RLS",  // Luminary Strike Act 1 Part 3
  24937: "REJ",  // Epic Journey Act 2 Part 1 (11/2026)
  24949: "RIPC"  // Rush of Ikorr Promotional Cards
};

const listOf = (j) => (j && Array.isArray(j.results)) ? j.results : [];
const api = async (path) => listOf(await fetchJsonRetry(`${API}${path}`, { headers: { "User-Agent": UA, Accept: "application/json" } }));

const r2 = (x) => Math.round(x * 100) / 100;
export const ext = (p, key) => {
  const d = (p && p.extendedData || []).find((e) => e.name === key);
  return d && d.value != null ? String(d.value).trim() : "";
};
// Custo vazio -> null (no histograma de custo do editor, 0 seria uma coluna
// falsa).
const num = (s) => (/^\d+$/.test(s) ? Number(s) : null);

// `usados` = setIds já tomados nesta rodada: dois grupos nunca dividem o id.
export function setIdOf(g, usados = new Set()) {
  if (ABREV_FIXA[g.groupId]) return ABREV_FIXA[g.groupId];
  const base = String(g.abbreviation || "").toUpperCase().replace(/[^A-Z0-9]+/g, "") || `G${g.groupId}`;
  return usados.has(base) ? `${base}-${g.groupId}` : base;
}

// Carta = produto com "Number"; o resto é selado (booster, caixa, deck).
export const isCard = (p) => !!ext(p, "Number");

// Acabamento especial pelo nome do produto: "Fracture Foil", "Rapture Foil"
// ou "" (o produto da carta, com Normal e Foil).
export function acabamentoDe(p) {
  const m = /\((Fracture|Rapture) Foil\)/i.exec(String(p && p.name || ""));
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} Foil` : "";
}

// "ROI-001 R" (com a raridade, como a carta imprime). Ver cabeçalho.
export const numeroDe = (p) => ext(p, "Number").replace(/^RO!-/, "ROI-").replace(/\s+/g, " ").trim();

// Nome da carta: sem o acabamento especial e sem o número desta carta entre
// parênteses. Parêntese que a fonte deixou aberto é fechado.
export function nomeDaCarta(nome, numero) {
  let n = String(nome || "").replace(/\s*\((?:Fracture|Rapture) Foil\)/gi, "");
  const codigo = String(numero || "").split(" ")[0].toUpperCase();
  if (codigo) {
    n = n.replace(/\s*\(([^()]+)\)/g, (todo, dentro) => (dentro.trim().toUpperCase().replace(/^RO!-/, "ROI-") === codigo ? "" : todo));
  }
  const abertos = (n.match(/\(/g) || []).length - (n.match(/\)/g) || []).length;
  if (abertos > 0) n += ")".repeat(abertos);
  return n.replace(/\s{2,}/g, " ").trim();
}

// Junta os produtos de UM grupo pelo número: [{ base, "Fracture Foil",
// "Rapture Foil" }] na ordem da fonte. Dois produtos do mesmo lado no mesmo
// número (não acontece em 22/11/2026) viram cartas separadas em vez de um
// apagar o outro.
export function agrupaProdutos(products) {
  const abertos = new Map();
  const out = [];
  for (const p of products) {
    if (!isCard(p)) continue;
    const lado = acabamentoDe(p) || "base";
    const chave = numeroDe(p);
    let g = abertos.get(chave);
    if (!g || g[lado]) {
      g = { base: null, "Fracture Foil": null, "Rapture Foil": null };
      if (!abertos.has(chave)) abertos.set(chave, g);
      out.push(g);
    }
    g[lado] = p;
  }
  return out;
}

export const ESPECIAIS = ["Fracture Foil", "Rapture Foil"];

// Versões e preço de um grupo. `linhas` = Map(productId -> Map(subTypeName ->
// USD ou 0)): o subtipo aparece mesmo sem preço, e é ele que diz que a
// impressão existe (as Alt Art e as Expression só têm "Foil"; as Scrollwork,
// só "Normal").
export function versoesEPreco(grupo, linhas = new Map()) {
  const da = (p) => (p && linhas.get(p.productId)) || new Map();
  const base = da(grupo.base);
  const variants = [];
  if (grupo.base) {
    if (base.has("Normal")) variants.push("Normal");
    if (base.has("Foil")) variants.push("Foil");
    if (!variants.length) variants.push("Normal"); // sem linha de preço: o padrão
  }
  for (const e of ESPECIAIS) if (grupo[e]) variants.push(e);

  const precoDe = (p) => {
    const by = da(p);
    if (by.get("Foil") > 0) return by.get("Foil");
    for (const v of by.values()) if (v > 0) return v;
    return 0;
  };
  const n = base.get("Normal") || 0;
  const f = base.get("Foil") || 0;
  const especiais = {};
  for (const e of ESPECIAIS) { const v = precoDe(grupo[e]); if (v > 0) especiais[e] = v; }
  const fr = especiais["Fracture Foil"] || 0;
  const ra = especiais["Rapture Foil"] || 0;

  const price = {};
  const u = n || f || fr || ra;
  if (u) price.u = u;
  const uf = f || fr || ra;
  if (uf) price.uf = uf;
  if (Object.keys(especiais).length) price.v = especiais;
  return { variants, price: price.u ? price : null };
}

// Grupo de produtos -> { card, price }. `prevIds` = ids do catálogo anterior
// (id pegajoso, ver cabeçalho).
export function cardOf(grupo, g, setId, setTotal, linhas = new Map(), prevIds = new Set()) {
  const produtos = [grupo.base, grupo["Fracture Foil"], grupo["Rapture Foil"]].filter(Boolean);
  const main = produtos[0];
  const ids = produtos.map((p) => `ikr-${p.productId}`);
  const id = ids.find((x) => prevIds.has(x)) || ids[0];
  const campo = (k) => { for (const p of produtos) { const v = ext(p, k); if (v) return v; } return ""; };
  const number = numeroDe(main);
  const { variants, price } = versoesEPreco(grupo, linhas);
  const card = {
    id,
    name: nomeDaCarta(main.name, number),
    // Nome do grupo do TCGplayer sem o jogo na frente: contrato 7 do
    // docs/CATALOGO.md, regra em scripts/lib/nome-do-set.mjs.
    set: nomeDoSet("ikorr", g.name),
    setId,
    number,
    setTotal,
    setReleaseDate: (g.publishedOn || "").slice(0, 10),
    // C, U, R, UR, A (Alt Art) e T (Token).
    rarity: campo("Rarity"),
    artist: "", // a TCGCSV não publica (ver cabeçalho)
    language: "en",
    image: imagemDoProduto(main.productId),
    variants,
    cardType: campo("CardType") || null,
    color: campo("Loyalty") || null,
    aspect: campo("Aspect") || null,
    trait: campo("ChampionType") || null,
    cost: num(campo("InfluenceCost")),
    attack: campo("Attack") || null,
    health: campo("Health") || null,
    raid: campo("Raid") || null
  };
  return { card, price };
}

async function run() {
  console.log("Rush of Ikorr: buscando sets (TCGCSV cat. 94)…");
  const groups = await api("/groups");
  console.log(`  ${groups.length} grupos.`);

  const prev = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const prevIds = new Set(prev.map((c) => c && c.id).filter(Boolean));

  const usados = new Set();
  const cards = [];
  const pricing = {}; // { id: { u, uf?, v? } } — USD market do TCGplayer

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
    const linhas = new Map(); // productId -> Map(subType -> USD ou 0)
    for (const p of prices) {
      const v = Number(p.marketPrice) > 0 ? p.marketPrice : (Number(p.midPrice) > 0 ? p.midPrice : 0);
      if (!linhas.has(p.productId)) linhas.set(p.productId, new Map());
      linhas.get(p.productId).set(p.subTypeName, v > 0 ? r2(v) : 0);
    }

    const grupos = agrupaProdutos(products);
    if (!grupos.length) { console.log(`  ${g.groupId} ${g.name}: 0 cartas (só selados ou ainda vazio)`); continue; }

    const setId = setIdOf(g, usados);
    usados.add(setId);
    if (!ABREV_FIXA[g.groupId]) console.warn(`  AVISO: grupo novo sem pin (${g.groupId} ${g.name}) -> setId "${setId}". Pinar em ABREV_FIXA antes de publicar.`);
    for (const grupo of grupos) {
      const { card, price } = cardOf(grupo, g, setId, grupos.length, linhas, prevIds);
      cards.push(card);
      if (price) pricing[card.id] = price;
    }
    const comEspecial = grupos.filter((x) => x["Fracture Foil"] || x["Rapture Foil"]).length;
    console.log(`  ${setId} ${nomeDoSet("ikorr", g.name)}: ${grupos.length} cartas (${comEspecial} com foil especial)`);
  }

  // União preservadora: carta que sumiu do espelho fica (do cards.js anterior).
  const merged = cards.concat(preserveMissingCards(prev, cards));

  merged.sort((a, b) =>
    String(a.setReleaseDate).localeCompare(String(b.setReleaseDate))
    || a.setId.localeCompare(b.setId)
    || a.number.localeCompare(b.number, undefined, { numeric: true })
    || a.id.localeCompare(b.id));
  console.log(`Total: ${merged.length} cartas, ${Object.keys(pricing).length} com preço.`);

  // Sem logo de set curado (ver cabeçalho): vazio, e o front desenha o nome.
  for (const c of merged) { c.setLogo = ""; }

  const bySet = new Map();
  for (const c of merged) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c.id); }
  const indexes = {
    sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)),
    artists: []
  };

  await writeGameCatalog(OUT, { cards: merged, indexes, pricing, webDir: "data/ikorr/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} (cards/indexes/pricing + manifest/chunks).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
