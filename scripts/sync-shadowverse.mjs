// Catálogo do SHADOWVERSE: EVOLVE (Bushiroad/Cygames, edição em inglês desde
// 30/06/2023) a partir da TCGCSV (tcgcsv.com), espelho público diário do
// TCGplayer — categoria 73, linha `shadowverse-evolve` (conferidas em
// 13/11/2026). Mesmo padrão da Union Arena, do Vanguard e do hololive:
// catálogo inteiro em data/shadowverse/ (cards.js versionado = durabilidade;
// 50 sets / 7.447 cartas em 11/2026).
//
// Só a edição em INGLÊS: a japonesa (desde 04/2022) não está no TCGplayer.
//
// Identidade: id = "shv-<productId>". O prefixo NÃO é "sve-": esse é do set
// "sve" do Pokémon (Scarlet & Violet Energies, ids "sve-001"…), e o id diz de
// que jogo a carta é (7.3 do docs/CATALOGO.md). O número impresso é único no
// jogo inteiro hoje (medido: nenhum repetido em 7.447), mas o id segue o
// productId como nos outros jogos da TCGCSV: a reimpressão guarda o número
// de origem ("BP05-R001EN" dentro do BP19) e um dia pode sair repetida.
//
// Cada versão é um PRODUTO próprio no TCGplayer, com número e preço próprios:
// a Premium (foil, "BP19-P10EN"), a Super Legendary ("-SL01EN"), a Ultimate
// ("-U01EN"), a Special ("-SP01EN") e a face Evolved do seguidor, que é outra
// carta física, do Evolve Deck. Por isso o preço só tem o subtipo Normal (`u`).
//
// Nome da carta: o TCGplayer cola o fim do número nas Premium ("Cannon Volley
// - P10EN (Foil)"), o número nas promos ("Blazing Breath - PR-123") e o número
// inteiro em algumas homônimas ("Maid Leader (GFB01a-038EN)"). O número já vai no campo `number`, então sai do nome
// quando é o desta carta. Os outros qualificadores ficam: "(Evolved)",
// "(Foil)", "(SL)", "(SP)", "(U)".
//
// Imagens: CDN do TCGplayer (_in_1000x1000), host já liberado na CSP e no SW e
// coberto pelo espelho R2. Três cartas por set, medidas em 13/11/2026: 716 px
// de largura nos sets de jul/2026 em diante, 500 px na maioria e 459 px nos de
// 2023. O site oficial (en.shadowverse-evolve.com/cards) serve 459×641 em
// tudo, então não há fonte maior. 13 cartas sem foto no TCGplayer: ficam com o
// endereço do CDN (o front cai no verso), sem regra de carta-irmã — não há
// par conferido que só mude o carimbo.
//
// setId: a abreviação da fonte, que é o CÓDIGO que a carta imprime antes do
// hífen (BP01, SD01, CP01, CSD01, ECP01, GFB01, SDD01…), não falta em nenhum
// grupo e não se repete (13/11/2026). Promos = SVPR (as cartas são "PR-…").
//
// Nome do set: sem o código na frente ("Advent of Genesis"), como no Vanguard
// — o código aparece no selo do cartão (scripts/lib/codigo-do-set.mjs). Quando
// dois grupos ficam com o MESMO título (os dois boosters de uma
// colaboração: "CP01: Umamusume: Pretty Derby" e "ECP01: Umamusume: Pretty
// Derby"), os dois guardam o nome inteiro da fonte, com o código: o nome do
// set é chave no índice e não pode repetir.
//
// Fora do catálogo: produto sem "Number" (selados e os 5 marcadores com
// raridade), como em todo jogo da TCGCSV.
//
// O que NÃO vem daqui: o ilustrador (a TCGCSV não publica).
//
// Logo de set: nenhuma fonte conferida. Sem logo, o front desenha o NOME
// (política única do site).
//
//   node scripts/sync-shadowverse.mjs
import { fileURLToPath } from "node:url";
import { writeGameCatalog, readGlobalVar, preserveMissingCards, fetchJsonRetry, sleep } from "./lib/sync-common.mjs";
import { nomeDoSet } from "./lib/nome-do-set.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/shadowverse/", ROOT);
const API = "https://tcgcsv.com/tcgplayer/73";
const UA = "Sleevu (sleevu.app) catalog sync";
const imagemDoProduto = (productId) => `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`;

const listOf = (j) => (j && Array.isArray(j.results)) ? j.results : [];
const api = async (path) => listOf(await fetchJsonRetry(`${API}${path}`, { headers: { "User-Agent": UA, Accept: "application/json" } }));

const r2 = (x) => Math.round(x * 100) / 100;
export const ext = (p, key) => {
  const d = (p.extendedData || []).find((e) => e.name === key);
  return d && d.value != null ? String(d.value).trim() : "";
};

// "BP01: Advent of Genesis" -> ["BP01", "Advent of Genesis"]. O código é
// letras e dois dígitos; "Gloryfinder Events" e "Shadowverse: Evolve Promo
// Cards" não têm, e ficam inteiros.
const CODIGO_NO_NOME = /^([A-Z]{2,4}[0-9]{2})\s*:\s*(\S.*)$/;
export function codigoETitulo(nome) {
  const m = CODIGO_NO_NOME.exec(String(nome || "").trim());
  return m ? [m[1], m[2].trim()] : ["", String(nome || "").trim()];
}

// `usados` = setIds já tomados nesta rodada: dois grupos nunca dividem o id.
export function setIdOf(g, usados = new Set()) {
  const base = String(g.abbreviation || "").toUpperCase().replace(/[^A-Z0-9]+/g, "")
    || codigoETitulo(g.name)[0] || `G${g.groupId}`;
  return usados.has(base) ? `${base}-${g.groupId}` : base;
}

// Título de cada grupo, sem o código — menos onde o título repete (cabeçalho).
// Recebe TODOS os grupos com carta, porque a repetição só se vê na lista.
export function nomesDosSets(grupos) {
  const titulo = (g) => nomeDoSet("shadowverse", codigoETitulo(g.name)[1]);
  const vezes = new Map();
  for (const g of grupos) vezes.set(titulo(g).toLowerCase(), (vezes.get(titulo(g).toLowerCase()) || 0) + 1);
  const nomes = new Map();
  for (const g of grupos) {
    nomes.set(g.groupId, vezes.get(titulo(g).toLowerCase()) > 1 ? String(g.name || "").trim() : titulo(g));
  }
  return nomes;
}

// "Cannon Volley - P10EN (Foil)" com BP19-P10EN -> "Cannon Volley (Foil)";
// "Maid Leader (GFB01a-038EN)" -> "Maid Leader"; "Powers Converged (125EN)"
// -> "Powers Converged". Código que NÃO é o desta
// carta fica (dado não se inventa).
export function nomeDaCarta(nome, numero) {
  const n = String(nome || "").trim();
  const num = String(numero || "").trim().toUpperCase();
  if (!num) return n;
  // A cauda vem de quatro jeitos: "P10EN", "P06" (sem o idioma), "PR-092EN"
  // (o número inteiro) e "PR-123".
  const cauda = num.split("-").pop();
  const semEN = (s) => s.replace(/EN$/, "");
  const minhas = new Set([num, semEN(num), cauda, semEN(cauda)]);
  const limpo = n
    .replace(/\s+-\s+([A-Za-z0-9-]+)(?=\s*(?:\(|$))/g, (todo, c) => (minhas.has(c.toUpperCase()) ? "" : todo))
    .replace(/\s*\(([^()]+)\)/g, (todo, dentro) => (minhas.has(dentro.trim().toUpperCase()) ? "" : todo))
    .replace(/\s{2,}/g, " ").trim();
  return limpo || n;
}

// Produto da TCGCSV -> { card, price }. `by` = Map(subTypeName -> USD, só os
// com preço).
export function cardOf(p, g, setId, setName, setTotal, by = new Map()) {
  const id = `shv-${p.productId}`;
  const number = ext(p, "Number");
  const u = by.get("Normal") || [...by.values()][0] || 0;
  // A fonte grava "None" nos tokens e deixa vazio em 153 cartas: os dois são
  // "sem raridade".
  const rarity = ext(p, "Rarity");
  const card = {
    id,
    name: nomeDaCarta(p.name, number),
    set: setName,
    setId,
    // "BP01-001EN": o código impresso.
    number,
    setTotal,
    setReleaseDate: (g.publishedOn || "").slice(0, 10),
    // Bronze, Silver, Gold e Legendary (a escada), Premium (a foil), Super
    // Legendary, Ultimate, Special, Super Special, Anniversary e Promo.
    rarity: /^none$/i.test(rarity) ? "" : rarity,
    artist: "", // a TCGCSV não publica o ilustrador
    language: "en",
    image: imagemDoProduto(p.productId),
    variants: ["Normal"],
    // Follower, Spell, Amulet, Leader, Equipment, Evolution Point; a carta do
    // Evolve Deck vem "Follower;Evolved", o token "Follower;Token".
    cardType: ext(p, "CardType") || null,
    // CLASSE (Forestcraft, Swordcraft, Runecraft, Dragoncraft, Abysscraft,
    // Havencraft e Neutral): é ela que diz em que deck a carta entra. `color`
    // é o nome que o índice de busca e o editor de decks esperam (COLOR_FIELDS
    // no sync-common), como o elemento do Final Fantasy e do Grand Archive.
    color: ext(p, "Class") || null,
    // "Mage;Academic", "Umamusume", "iM@S CG;Cool": os traços que os efeitos
    // procuram.
    trait: ext(p, "Trait") || null,
    cost: ext(p, "Cost") || null,
    attack: ext(p, "Attack") || null,
    defense: ext(p, "Defense") || null
  };
  return { card, price: u ? { u } : null };
}

async function run() {
  console.log("Shadowverse: Evolve: buscando sets (TCGCSV cat. 73)…");
  const groups = await api("/groups");
  console.log(`  ${groups.length} grupos.`);

  const baixados = [];
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
    // Carta = produto com "Number"; o resto é selado (booster, display, deck).
    const setCards = products.filter((p) => ext(p, "Number"));
    if (!setCards.length) { console.log(`  ${g.groupId} ${g.name}: 0 cartas (só selados ou ainda vazio)`); continue; }
    baixados.push({ g, setCards, prices });
  }

  const nomes = nomesDosSets(baixados.map((b) => b.g));
  const usados = new Set();
  const cards = [];
  const pricing = {}; // { id: { u } } — USD market do TCGplayer

  for (const { g, setCards, prices } of baixados) {
    const priceBy = new Map(); // productId -> Map(subType -> USD)
    for (const p of prices) {
      const v = Number(p.marketPrice) > 0 ? p.marketPrice : (Number(p.midPrice) > 0 ? p.midPrice : 0);
      if (v <= 0) continue;
      if (!priceBy.has(p.productId)) priceBy.set(p.productId, new Map());
      priceBy.get(p.productId).set(p.subTypeName, r2(v));
    }
    const setId = setIdOf(g, usados);
    usados.add(setId);
    for (const p of setCards) {
      const { card, price } = cardOf(p, g, setId, nomes.get(g.groupId), setCards.length, priceBy.get(p.productId));
      cards.push(card);
      if (price) pricing[card.id] = price;
    }
    console.log(`  ${setId} ${nomes.get(g.groupId)}: ${setCards.length} cartas`);
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

  await writeGameCatalog(OUT, { cards: merged, indexes, pricing, webDir: "data/shadowverse/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} (cards/indexes/pricing + manifest/chunks).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
