// Catálogo do Sorcery: Contested Realm (Erik's Curiosa, 2023) a partir da
// TCGCSV (tcgcsv.com), espelho público diário do TCGplayer — categoria 77,
// linha `sorcery-contested-realm` (conferidas em 30/09/2026). Mesmo padrão do
// Cyberpunk/Star Wars: catálogo inteiro em data/sorcery/ (cards.js versionado
// = durabilidade; 8 sets / ~1.690 cartas em 30/09/2026).
//
// Identidade: id = "sor-<productId>" (prefixo livre, conferido com a 7.3 do
// docs/CATALOGO.md). Imagens: CDN do TCGplayer (_in_1000x1000 = 716×1000),
// host já liberado na CSP e no SW e já coberto pelo espelho R2. As cartas de
// Site são impressas DEITADAS, e o TCGplayer as fotografa giradas em pé (texto
// de lado): cabem na moldura 63/88 de sempre, sem exceção na tela.
//
// O que este jogo tem de diferente dos outros da família TCGCSV:
//
// 1. O FOIL É OUTRO PRODUTO. O TCGplayer lista "Sea Raider" e "Sea Raider
//    (Foil)" com productIds próprios, cada um com um subtipo de preço só. Aqui
//    os dois viram UMA carta com as versões Normal e Foil (u/uf), como em todo
//    jogo do site. O nome base tira o "(Foil)" e o "(Corrected)": o Blink foil
//    de Beta saiu com erro, e o TCGplayer chama o foil normal de "(Foil)
//    (Corrected)" ao lado do "(Foil) (Misprint)", que fica carta própria.
//    Os outros sufixos ("(Preconstructed Deck)", "(Box Topper)", "(Alpha
//    Investments Promo)"…) são impressões diferentes, com preço próprio, e
//    viram cartas separadas no mesmo set, como o Hyperspace do Star Wars.
//
// 2. O id é PEGAJOSO entre os dois produtos. Ele sai do productId do Normal
//    (ou do Foil, na carta que só existe em foil), mas, se o catálogo anterior
//    já tem a carta com o id do OUTRO produto do par, esse id fica: quando o
//    TCGplayer cadastra o Normal depois do Foil (acontece em promo), o id
//    publicado não muda nem some (contrato 1 do docs/CATALOGO.md).
//
// 3. NÃO HÁ NÚMERO DE COLEÇÃO. O jogo não imprime número, e nem a TCGCSV nem
//    a API oficial têm o campo; `number` fica vazio e a ordem dentro do set
//    cai no nome, como no WoW TCG (o `dotJoin` do shared.js cuida das telas).
//
// 4. Raridade "None" é a do Avatar e dos tokens: fica vazia (dado que falta
//    não se inventa). O elemento ("Air;Earth" na carta de dois) vai em
//    `color`, o nome que o índice de busca e o editor de decks leem, como o
//    aspecto do Star Wars.
//
// setId: FIXO por groupId com os códigos da própria editora (os slugs do
// Curiosa começam com alp/bet/art/dra/got), porque a TCGCSV usa "A" e "B" no
// Alpha e no Beta e deixou o Welcome Kit sem abreviação. setId publicado não
// muda nunca (URL, régua do lint); grupo novo sem pin avisa no log.
//
// Logo de set: nenhum publicado avulso (auditado em 01/10/2026: o site
// oficial tem só a arte de capa e a foto das caixas, e o Alpha e o Beta usam
// o logo do jogo). Todos mostram o NOME, como manda a política do site.
//
// API oficial (api.sorcerytcg.com/api/cards, conferida em 30/09/2026): pública
// e sem login, mas pede que se sincronize em vez de consultar ao vivo e
// PROÍBE servir imagem da CDN deles. Não é usada aqui; fica como fonte pro
// artista, que a TCGCSV não tem.
//
//   node scripts/sync-sorcery.mjs
import { fileURLToPath } from "node:url";
import { writeGameCatalog, readGlobalVar, preserveMissingCards, fetchJsonRetry, sleep } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/sorcery/", ROOT);
const API = "https://tcgcsv.com/tcgplayer/77";
const UA = "Sleevu (sleevu.app) catalog sync";

// groupId -> setId (ver cabeçalho).
export const ABREV_FIXA = {
  23335: "ALP",   // Alpha (Kickstarter, 2023)
  23336: "BET",   // Beta
  23514: "DRP",   // Dust Reward Promos
  23588: "ART",   // Arthurian Legends
  23778: "ARTP",  // Arthurian Legends Promo
  24378: "DRA",   // Dragonlord (mini set)
  24471: "GOT",   // Gothic
  24871: "WKP"    // Welcome Kit Promos (a fonte deixou a abreviação vazia)
};

const listOf = (j) => (j && Array.isArray(j.results)) ? j.results : [];
const api = async (path) => listOf(await fetchJsonRetry(`${API}${path}`, { headers: { "User-Agent": UA, Accept: "application/json" } }));

const r2 = (x) => Math.round(x * 100) / 100;
export const ext = (p, key) => {
  const d = (p && p.extendedData || []).find((e) => e.name === key);
  return d && d.value != null ? String(d.value).trim() : "";
};
// Custo "X" e vazio -> null (no histograma de custo do editor, 0 seria uma
// coluna falsa).
const num = (s) => (/^\d+$/.test(s) ? Number(s) : null);

export function setIdOf(g, abbrCount) {
  if (ABREV_FIXA[g.groupId]) return ABREV_FIXA[g.groupId];
  const a = String(g.abbreviation || "").trim();
  if (!a) return `G${g.groupId}`;
  return abbrCount && abbrCount.get(a) > 1 ? `${a}-${g.groupId}` : a;
}

// Carta = produto com campo de jogo. Booster, caixa e deck pronto vêm sem
// extendedData nenhum (conferido nos 8 grupos em 30/09/2026); o token "Stealth
// (Box Topper)" só tem a categoria.
export const isCard = (p) => ["Rarity", "CardType", "CardCategory"].some((k) => ext(p, k));

export const isFoilProduct = (p) => /\(Foil\)/i.test(String(p.name || ""));
const tidy = (s) => String(s).replace(/\s+/g, " ").trim();
export const baseName = (name) => tidy(String(name || "").replace(/\s*\((?:Foil|Corrected)\)/gi, ""));

// Junta Normal e Foil do mesmo grupo pelo nome base. Devolve [{ n, f }] na
// ordem em que a fonte lista. Se dois produtos do mesmo lado caem no mesmo
// nome (não acontece em 30/09/2026), o segundo vira carta própria em vez de
// apagar o primeiro.
export function pairProducts(products) {
  const byKey = new Map();
  const out = [];
  for (const p of products) {
    const side = isFoilProduct(p) ? "f" : "n";
    const key = baseName(p.name);
    let pair = byKey.get(key);
    if (!pair || pair[side]) {
      pair = { n: null, f: null };
      if (!byKey.has(key)) byKey.set(key, pair);
      out.push(pair);
    }
    pair[side] = p;
  }
  return out;
}

// Campo do par: o do Normal, ou o do Foil quando o Normal não tem (o TCGplayer
// às vezes preenche só um dos dois).
const extPar = (pair, key) => ext(pair.n, key) || ext(pair.f, key);

// Par de produtos -> { card, price }. `priceBy` = Map(productId -> Map(subTypeName -> USD)).
// `prevIds` = ids do catálogo anterior (id pegajoso, ver cabeçalho).
export function cardOf(pair, g, setId, setTotal, priceBy = new Map(), prevIds = new Set()) {
  const main = pair.n || pair.f;
  const ids = [pair.n, pair.f].filter(Boolean).map((p) => `sor-${p.productId}`);
  const id = ids.find((x) => prevIds.has(x)) || ids[0];

  // Cada produto tem um subtipo só ("Normal" no comum, "Foil" no foil); o
  // preço do Normal vale como u e o do Foil como uf. Carta só-foil fica com o
  // preço do foil nos dois, como nos outros jogos.
  const precoDe = (p, ordem) => {
    const by = p && priceBy.get(p.productId);
    if (!by) return 0;
    for (const st of ordem) { if (by.get(st) > 0) return by.get(st); }
    for (const v of by.values()) { if (v > 0) return v; }
    return 0;
  };
  const normal = precoDe(pair.n, ["Normal", "Foil"]);
  const foil = precoDe(pair.f, ["Foil", "Normal"]);
  const price = {};
  if (normal || foil) price.u = normal || foil;
  if (foil) price.uf = foil;

  const variants = [];
  if (pair.n) variants.push("Normal");
  if (pair.f) variants.push("Foil");

  const rarity = extPar(pair, "Rarity");
  const categoria = extPar(pair, "CardCategory");
  const card = {
    id,
    name: baseName(main.name),
    set: g.name,
    setId,
    number: "",
    setTotal,
    setReleaseDate: (g.publishedOn || "").slice(0, 10),
    rarity: rarity === "None" ? "" : rarity,
    artist: "",
    language: "en",
    image: `https://tcgplayer-cdn.tcgplayer.com/product/${main.productId}_in_1000x1000.jpg`,
    variants,
    // Minion/Magic/Artifact/Aura/Site/Avatar; o token só tem a categoria
    // ("Token"), e "Spell" sozinho não diz o tipo.
    cardType: extPar(pair, "CardType") || (categoria && categoria !== "Spell" ? categoria : "") || null,
    color: extPar(pair, "Element") || null,
    cost: num(extPar(pair, "Cost"))
  };
  return { card, price: Object.keys(price).length ? price : null };
}

async function run() {
  console.log("Sorcery: Contested Realm: buscando sets (TCGCSV cat. 77)…");
  const groups = await api("/groups");
  console.log(`  ${groups.length} grupos.`);

  const abbrCount = new Map();
  for (const g of groups) { const a = String(g.abbreviation || "").trim(); if (a) abbrCount.set(a, (abbrCount.get(a) || 0) + 1); }

  const prev = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const prevIds = new Set(prev.map((c) => c && c.id).filter(Boolean));

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

    const pairs = pairProducts(products.filter(isCard));
    if (!pairs.length) { console.log(`  ${g.groupId} ${g.name}: 0 cartas (só selados)`); continue; }

    const setId = setIdOf(g, abbrCount);
    if (!ABREV_FIXA[g.groupId]) console.warn(`  AVISO: grupo novo sem pin (${g.groupId} ${g.name}) -> setId "${setId}". Pinar em ABREV_FIXA antes de publicar.`);
    for (const pair of pairs) {
      const { card, price } = cardOf(pair, g, setId, pairs.length, priceBy, prevIds);
      cards.push(card);
      if (price) pricing[card.id] = price;
    }
    const foils = pairs.filter((p) => p.f).length;
    console.log(`  ${setId} ${g.name}: ${pairs.length} cartas (${foils} com foil)`);
  }

  const merged = cards.concat(preserveMissingCards(prev, cards));

  // Sem número: dentro do set, pelo nome (ver cabeçalho).
  merged.sort((a, b) =>
    String(a.setReleaseDate).localeCompare(String(b.setReleaseDate))
    || a.setId.localeCompare(b.setId)
    || a.name.localeCompare(b.name, "en")
    || a.id.localeCompare(b.id));
  console.log(`Total: ${merged.length} cartas, ${Object.keys(pricing).length} com preço.`);

  // Sem logo de set publicado (ver cabeçalho): vazio, e o front desenha o nome.
  for (const c of merged) { c.setLogo = ""; }

  const bySet = new Map();
  for (const c of merged) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c.id); }
  const indexes = {
    sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)),
    artists: []
  };

  await writeGameCatalog(OUT, { cards: merged, indexes, pricing, webDir: "data/sorcery/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} (cards/indexes/pricing + manifest/chunks).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
