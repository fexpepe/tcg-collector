// Catálogo do Palworld OFFICIAL CARD GAME (Bushiroad com a Pocketpair, 2026,
// lançamento mundial simultâneo em 30/07/2026) a partir da TCGCSV
// (tcgcsv.com), espelho público diário do TCGplayer — categoria 91, linha
// `palworld-official-card-game` (conferidas em 11/11/2026). Mesmo padrão do
// Cyberpunk/Union Arena: catálogo inteiro em data/palworld/ (cards.js
// versionado = durabilidade; ~10 grupos / ~800 cartas no fim de 2026).
//
// Identidade: id = "pal-<productId>" (`pal-` livre: nem set do Pokémon nem id
// do Lorcana, docs/CATALOGO.md 7.3). Imagens: CDN do TCGplayer
// (_in_1000x1000 = 716×1000), host já liberado na CSP e no SW e já coberto
// pelo espelho R2. Acabamentos: Normal / Foil (u/uf) — no Palworld o
// acabamento sai da raridade (C/U/TD são Normal, o resto Foil), e cada
// produto do TCGplayer tem UM preço só.
//
// Paralelas (SR, OSR, SP, SSP, as TSR/TSP dos trial decks, as "S" das promos)
// são produtos próprios e viram cartas separadas, como as alt-arts do One
// Piece. O número que a carta IMPRIME já traz a raridade grudada
// ("<OSR> EBP01-001OSR"), e é o que fica em `number`.
//
// 2ª EDIÇÃO do Dawn of Palpagos: a reimpressão que a Bushiroad anunciou em
// agosto/2026, depois de o BP01 esgotar, sai com um "II" ao lado do
// ©PALWORLD (conferido no scan do TCGplayer, 11/11/2026). O TCGplayer a
// cadastrou DENTRO do grupo do BP01 (24842), produto a produto, com
// "(2nd Edition)" no nome e o MESMO número da 1ª. Aqui ela vira um set à
// parte, "<set> (2nd Edition)" com setId "<setId>-2E", como as edições do
// Cyberpunk (Beta/Retail): é outra impressão, com preço próprio, e misturada
// a 1ª o X/Y do BP01 contaria em dobro (setId "EBP01-2E"). Na tela de Sets
// ela vira o chip "2nd Edition" dentro do cartão do BP01 (aninhaPorNome). A
// data é a do grupo
// (a única que a fonte dá; a Bushiroad não anunciou data da reimpressão), e o
// nome da carta perde o "(2nd Edition)", que o set já diz.
//
// Nome da carta: o da fonte. Nas promos o TCGplayer põe o código no nome
// ("Flambelle - Scorching Tears - EPR-002" e "… - EPR-002S") e ele FICA: a
// versão "S" é a full art da mesma promo (US$ 86 contra US$ 1,42 em
// 11/11/2026), e sem o código as duas teriam o mesmo nome no mesmo set.
//
// Cartas sem número: as Prototype Cards (o deck de demonstração anterior ao
// lançamento) não têm número nem na fonte, e o "Soul (SSS)" do BP01 também
// não. Carta = produto com algum campo de carta (isCard); selado (booster,
// caixa, pack de promo) não tem nenhum. Sem número a ordem é pelo nome (o
// `dotJoin` das telas pula o número vazio, como no Sorcery).
//
// setId: o CÓDIGO IMPRESSO do set (EBP01, ETD01, ESS01, EPR), como no
// Godzilla, fixo por groupId (ABREV_FIXA) antes da primeira publicação —
// setId publicado não muda nunca (URL, logo, régua do lint), e a abreviação
// da fonte pode mudar. A fonte abrevia sem o "E" da edição inglesa (BP01),
// mas é o código impresso que o scanner lê ("EBP01-001") e procura no índice
// de sets; o Godzilla, também da Bushiroad, imprime o MESMO "EBP01-001", e
// com o setId sem o E o índice mandava a carta do Palworld só pro Godzilla.
// As Prototype Cards não imprimem código: "PC" (a fonte diz "PW_PC", e o
// sublinhado não entra no padrão dos pins). Grupo novo sem pin cai no
// código que a maioria das cartas dele imprime ("EBP04-001" -> EBP04), o
// mesmo que o pin daria; sem código dominante, na abreviação (o log avisa:
// pinar ANTES do primeiro deploy que o publica).
//
// Logo de set: nenhum publicado (as páginas de produto do site oficial,
// en.palworld-official-cardgame.com/products/bp01…, só têm arte; auditado em
// 11/11/2026): setLogo vazio e o front desenha o NOME (política única).
//
// Texto de regra (Description) e Work Suitability ficam de fora: a tela não
// os usa e somariam ~120 KB ao cards.js (medido em 11/11/2026; o Union Arena
// fez a mesma conta).
//
//   node scripts/sync-palworld.mjs
import { fileURLToPath } from "node:url";
import { writeGameCatalog, readGlobalVar, preserveMissingCards, fetchJsonRetry, sleep } from "./lib/sync-common.mjs";
import { nomeDoSet } from "./lib/nome-do-set.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/palworld/", ROOT);
const API = "https://tcgcsv.com/tcgplayer/91";
const UA = "Sleevu (sleevu.app) catalog sync";

// groupId -> setId (ver cabeçalho). Os grupos ainda sem carta (BP03, TD03 e
// TD04, em pré-venda em 11/11/2026) já ficam pinados.
export const ABREV_FIXA = {
  24842: "EBP01",  // BP01: Dawn of Palpagos (e a 2ª edição, EBP01-2E)
  24850: "EBP02",  // BP02: Legends Awaken
  24912: "EBP03",  // BP03: Eternal Ascent (29/01/2027)
  24843: "ETD01",  // TD01: Dawn of Palpagos Red•Blue
  24844: "ETD02",  // TD02: Dawn of Palpagos Green•Purple
  24852: "ETD03",  // TD03: Eternal Ascent Red•Green (18/12/2026)
  24853: "ETD04",  // TD04: Eternal Ascent Blue•Purple (18/12/2026)
  24851: "EPR",    // Palworld Promo Cards
  24876: "PC",     // Palworld Prototype Cards (abreviação da fonte: PW_PC)
  24908: "ESS01"   // Sleeve and Card Set Vol. 1
};

// A reimpressão que o TCGplayer cadastra no grupo do set original.
const SEGUNDA_EDICAO = /\s*\(2nd Edition\)\s*$/i;
export const SUFIXO_2E = "-2E";

const listOf = (j) => (j && Array.isArray(j.results)) ? j.results : [];
const api = async (path) => listOf(await fetchJsonRetry(`${API}${path}`, { headers: { "User-Agent": UA, Accept: "application/json" } }));

const r2 = (x) => Math.round(x * 100) / 100;
export const ext = (p, key) => {
  const d = (p.extendedData || []).find((e) => e.name === key);
  const v = d && d.value != null ? String(d.value).trim() : "";
  // As Prototype Cards vêm com Rarity "None" (texto): é falta de dado.
  return v === "None" ? "" : v;
};
// Número da TCGCSV vem string. Sem valor -> null (e não 0, que no histograma
// de custo do editor viraria uma coluna falsa em zero).
const num = (s) => (/^\d+$/.test(s) ? Number(s) : null);

// Produto é carta quando tem algum campo de carta; selado (booster, caixa,
// pack de promo) vem com extendedData vazio. Olha a PRESENÇA do campo, não o
// valor: o "Soul" das Prototype Cards só tem Rarity "None" e o texto.
const CAMPOS_DE_CARTA = new Set(["Number", "CardType", "Rarity", "Description"]);
export const isCard = (p) => (p.extendedData || []).some((e) => CAMPOS_DE_CARTA.has(e.name));
export const isSegundaEdicao = (p) => SEGUNDA_EDICAO.test(String(p.name || ""));

// Só o "(2nd Edition)" sai do nome: o set já diz (ver cabeçalho).
export const cleanName = (name) => String(name || "").replace(SEGUNDA_EDICAO, "").trim();

// Chave da carta DENTRO do grupo, igual nas duas edições: o número e, sem
// ele (o "Soul (SSS)"), o nome sem o "(2nd Edition)".
export const chaveNoGrupo = (p) => ext(p, "Number") || `nome:${cleanName(p.name)}`;

// Código do set que a MAIORIA das cartas numeradas do grupo imprime
// ("EBP04-001OSR" -> EBP04). As Soul ("ESOUL-011") não têm código de set e só
// contam no total. Abaixo de metade, não há código dominante.
export function codigoDominante(numeros) {
  const conta = new Map();
  let total = 0;
  for (const n of numeros) {
    const s = String(n || "").trim();
    if (!s) continue;
    total++;
    const m = /^(E(?:BP|TD|SS|PR)\d{0,2})-\d/.exec(s);
    if (m) conta.set(m[1], (conta.get(m[1]) || 0) + 1);
  }
  const [codigo, n] = [...conta].sort((a, b) => b[1] - a[1])[0] || [];
  return codigo && n * 2 > total ? codigo : "";
}

export function setIdOf(g, abbrCount, numeros = []) {
  if (ABREV_FIXA[g.groupId]) return ABREV_FIXA[g.groupId];
  const dominante = codigoDominante(numeros);
  if (dominante) return dominante;
  const a = String(g.abbreviation || "").trim().replace(/[^A-Za-z0-9-]+/g, "-");
  if (!a) return `G${g.groupId}`;
  return abbrCount && abbrCount.get(a) > 1 ? `${a}-${g.groupId}` : a;
}

const VARIANT_ORDER = ["Normal", "Foil"];
const pick = (map, names) => { for (const n of names) { if (map.get(n) > 0) return map.get(n); } return 0; };

// Produto da TCGCSV -> { card, price }.
//   `by`        Map(subTypeName -> USD) do produto
//   `variantes` acabamentos de quem não tem preço ainda: os da carta de
//               MESMO número já precificada (a 2ª edição herda da 1ª). Sem
//               nenhum dos dois, fica "Normal", como nos outros syncs.
export function cardOf(p, g, set, setId, setTotal, by = new Map(), variantes = null) {
  const id = `pal-${p.productId}`;
  const price = {};
  const u = pick(by, ["Normal", "Foil"]);
  const uf = pick(by, ["Foil"]);
  if (u) price.u = u;
  if (uf) price.uf = uf;
  const comPreco = VARIANT_ORDER.filter((v) => by.has(v));
  const variants = comPreco.length ? comPreco : (variantes && variantes.length ? variantes : ["Normal"]);
  const card = {
    id,
    name: cleanName(p.name),
    set,
    setId,
    number: ext(p, "Number"),
    setTotal,
    setReleaseDate: (g.publishedOn || "").slice(0, 10),
    rarity: ext(p, "Rarity"),
    artist: "",
    language: "en",
    image: `https://tcgplayer-cdn.tcgplayer.com/product/${p.productId}_in_1000x1000.jpg`,
    variants,
    // Pal, Structure, Gear, Event, Soul.
    cardType: ext(p, "CardType") || null,
    // Normal Pal / Lucky Pal.
    subtype: ext(p, "CardSubtype") || null,
    // Cor do jogo (Red/Blue/Green/Purple/Colorless): `color` é o nome que o
    // índice de busca e o editor de decks esperam (COLOR_FIELDS no sync-common).
    color: ext(p, "Color") || null,
    cost: num(ext(p, "Cost")),
    power: num(ext(p, "Power")),
    // Elemento do Pal ("Dragon;Fire" na carta de dois): faceta da página do set.
    element: ext(p, "Element") || null
  };
  return { card, price: Object.keys(price).length ? price : null };
}

// Acabamentos por carta do grupo (chaveNoGrupo), de quem já tem preço: é o
// que a 2ª edição, listada antes de ter preço, herda da 1ª.
export function acabamentosDoGrupo(products, priceBy) {
  const out = new Map();
  for (const p of products) {
    const by = priceBy.get(p.productId);
    const k = chaveNoGrupo(p);
    if (by && by.size && !out.has(k)) out.set(k, VARIANT_ORDER.filter((v) => by.has(v)));
  }
  return out;
}

// Um grupo da TCGCSV -> as cartas dele, já separadas por edição.
//   [{ setId, set, produtos: [...] }]   (a 1ª edição primeiro)
export function edicoesDoGrupo(g, products, setId) {
  const cartas = products.filter(isCard);
  const primeira = cartas.filter((p) => !isSegundaEdicao(p));
  const segunda = cartas.filter(isSegundaEdicao);
  const nome = nomeDoSet("palworld", g.name);
  const out = [];
  if (primeira.length) out.push({ setId, set: nome, produtos: primeira });
  if (segunda.length) out.push({ setId: setId + SUFIXO_2E, set: `${nome} (2nd Edition)`, produtos: segunda });
  return out;
}

async function run() {
  console.log("Palworld OFFICIAL CARD GAME: buscando sets (TCGCSV cat. 91)…");
  const groups = await api("/groups");
  console.log(`  ${groups.length} grupos.`);

  const abbrCount = new Map();
  for (const g of groups) { const a = String(g.abbreviation || "").trim(); if (a) abbrCount.set(a, (abbrCount.get(a) || 0) + 1); }

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

    const setId = setIdOf(g, abbrCount, products.map((p) => ext(p, "Number")));
    const edicoes = edicoesDoGrupo(g, products, setId);
    if (!edicoes.length) { console.log(`  ${setId} ${g.name}: 0 cartas (só selados)`); continue; }
    if (!ABREV_FIXA[g.groupId]) console.warn(`  AVISO: grupo novo sem pin (${g.groupId} ${g.name}) -> setId "${setId}". Pinar em ABREV_FIXA antes de publicar.`);

    const acabamento = acabamentosDoGrupo(products, priceBy);
    for (const ed of edicoes) {
      for (const p of ed.produtos) {
        const { card, price } = cardOf(p, g, ed.set, ed.setId, ed.produtos.length, priceBy.get(p.productId), acabamento.get(chaveNoGrupo(p)));
        cards.push(card);
        if (price) pricing[card.id] = price;
      }
      console.log(`  ${ed.setId} ${ed.set}: ${ed.produtos.length} cartas`);
    }
  }

  const prev = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const merged = cards.concat(preserveMissingCards(prev, cards));

  merged.sort((a, b) =>
    String(a.setReleaseDate).localeCompare(String(b.setReleaseDate))
    || a.setId.localeCompare(b.setId)
    || a.number.localeCompare(b.number, undefined, { numeric: true })
    || a.name.localeCompare(b.name)
    || a.id.localeCompare(b.id));
  console.log(`Total: ${merged.length} cartas, ${Object.keys(pricing).length} com preço.`);

  // setLogo: VAZIO — nenhum set tem logo publicado (ver cabeçalho); o front
  // desenha o NOME do set como título (.set-logo-placeholder).
  for (const c of merged) { c.setLogo = ""; }

  const bySet = new Map();
  for (const c of merged) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c.id); }
  const indexes = {
    sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)),
    artists: []
  };

  await writeGameCatalog(OUT, { cards: merged, indexes, pricing, webDir: "data/palworld/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} (cards/indexes/pricing + manifest/chunks).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
