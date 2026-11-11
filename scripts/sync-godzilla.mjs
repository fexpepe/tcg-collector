// Catálogo do GODZILLA CARD GAME (Bushiroad, desenvolvido pela Yuhodo, TM & ©
// TOHO; edição inglesa desde 05/07/2025) a partir da TCGCSV (tcgcsv.com),
// espelho público diário do TCGplayer — categoria 88, linha
// `godzilla-card-game` (conferidas em 11/11/2026). Mesmo padrão do
// Cyberpunk/Union Arena: catálogo inteiro em data/godzilla/ (cards.js
// versionado = durabilidade; 8 sets / ~1.100 cartas em 11/2026).
//
// Só a edição INGLESA, como os modernos da Bandai: o TCGplayer cataloga a
// linha EN (códigos com "E" na frente: EBP01, ESD01, EPR…). A japonesa
// (BP01, SD01…) não tem categoria na TCGCSV e fica fora.
//
// Não confundir com o "Godzilla Card Game" da Bandai de 2019 (sistema Chrono
// Clash), outro jogo, sem relação com este nem com a categoria 88.
//
// Identidade: id = "gzc-<productId>" (`gcg-` é do Gundam). Imagens: CDN do
// TCGplayer (_in_1000x1000), host já liberado na CSP e no SW e já coberto
// pelo espelho R2. Acabamentos: Normal / Foil (u/uf).
//
// PARALELAS são produtos próprios no TCGplayer, com número próprio: o "+"
// (SP; RP nas Rage), o "++" (SSP; PP nas Rage) e o "+++" (SSSP) depois do
// número da carta base ("EBP01-001+"). Viram cartas separadas, como as
// paralelas do Weiß e o Hyperspace do Star Wars.
//
// Nome: o TCGplayer repete o número entre parênteses no fim do nome
// ("Godzilla (1954) (EBP01-001+)"). O número já vai no campo `number` e
// aparece ao lado do nome em toda tela, então sai do nome; o ano do filme
// ("(1954)", é o que separa os Godzilla) e os qualificadores de produto
// ("(Promotion Pack Vol.1)") ficam, como no One Piece.
//
// setId: o código IMPRESSO na carta (EBP01, ESD02, ESC01, EPR), fixo por
// groupId antes da primeira publicação — a TCGCSV deixou a abreviação vazia
// em dois dos oito grupos (o Booster Set 4 e o Sleeve & Card Set) e chama as
// promos de "PR" (a carta imprime "EPR-005"). setId publicado não muda nunca
// (URL, logo, régua do lint). Grupo novo sem pin (o Booster Set #5 e os
// starters ESD03–05 de dezembro de 2026) cai no código que a maioria das
// cartas dele imprime ("EBP05-001" -> EBP05), que é o mesmo que o pin daria;
// sem código dominante, na abreviação, e sem ela em "G<groupId>". O log avisa
// pra pinar antes do deploy que publica.
//
// Logo de set: nenhum publicado. O site oficial (en.godzilla-cardgame.com/
// products/) só tem a foto da caixa de cada produto, não um logo do set. Sem
// logo, o front desenha o NOME (política única do site).
//
//   node scripts/sync-godzilla.mjs
import { fileURLToPath } from "node:url";
import { writeGameCatalog, readGlobalVar, preserveMissingCards, fetchJsonRetry, sleep } from "./lib/sync-common.mjs";
import { nomeDoSet } from "./lib/nome-do-set.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/godzilla/", ROOT);
const API = "https://tcgcsv.com/tcgplayer/88";
const UA = "Sleevu (sleevu.app) catalog sync";

// groupId -> setId (ver cabeçalho): o código que a carta imprime.
export const ABREV_FIXA = {
  24337: "EBP01",  // Booster Set 1: Godzilla VS. Godzilla (05/07/2025)
  24339: "ESD01",  // Starter Deck: Godzilla Minus One (05/07/2025)
  24338: "ESD02",  // Starter Deck: Heisei Series (05/07/2025)
  24431: "EPR",    // Promo Cards (a fonte abrevia "PR"; a carta imprime EPR-xxx)
  24440: "EBP02",  // Booster Set 2: G: Monsters Raid Again (25/10/2025)
  24501: "EBP03",  // Booster Set 3: Resonance of Rivals (31/01/2026)
  24641: "EBP04",  // Booster Set 4: Endless Wars (23/05/2026; abreviação vazia)
  24674: "ESC01"   // Ink-Brushed Monster Rampage (02/07/2026; o Sleeve & Card Set SCS01, cartas ESC01-xxx)
};

const listOf = (j) => (j && Array.isArray(j.results)) ? j.results : [];
const api = async (path) => listOf(await fetchJsonRetry(`${API}${path}`, { headers: { "User-Agent": UA, Accept: "application/json" } }));

const r2 = (x) => Math.round(x * 100) / 100;
export const ext = (p, key) => {
  const d = (p.extendedData || []).find((e) => e.name === key);
  return d && d.value != null ? String(d.value).trim() : "";
};

// Código do set que a MAIORIA das cartas do grupo imprime ("EBP05-001+" ->
// EBP05). As Rage ("EGZ07", "E09") não têm código de set e não votam. Abaixo
// de metade das cartas numeradas, não há código dominante (as promos misturam
// reimpressões de vários sets).
export function codigoDominante(numeros) {
  const conta = new Map();
  let total = 0;
  for (const n of numeros) {
    const m = /^(E[A-Z]{1,3}\d{0,3})-/.exec(String(n || "").trim());
    total++;
    if (m) conta.set(m[1], (conta.get(m[1]) || 0) + 1);
  }
  const [codigo, n] = [...conta].sort((a, b) => b[1] - a[1])[0] || [];
  return codigo && n * 2 > total ? codigo : "";
}

export function setIdOf(g, numeros = [], abbrCount) {
  if (ABREV_FIXA[g.groupId]) return ABREV_FIXA[g.groupId];
  const dominante = codigoDominante(numeros);
  if (dominante) return dominante;
  const a = String(g.abbreviation || "").trim();
  if (!a) return `G${g.groupId}`;
  return abbrCount && abbrCount.get(a) > 1 ? `${a}-${g.groupId}` : a;
}

// "Godzilla (1954) (EBP01-001+)" -> "Godzilla (1954)"; "Rage(EGZ10)" -> "Rage".
// Só o número DESTA carta sai; os outros parênteses ficam. No Booster Set 1 o
// TCGplayer grava o número das Rage com o tipo na frente ("Rage-EGZ01+", e no
// nome "Rage (EGZ01+)"); o número fica como a fonte publica (é por ele que o
// import de CSV do TCGplayer casa a carta), e o nome sai limpo do mesmo jeito.
export function nomeDaCarta(nome, numero) {
  const n = String(nome || "").trim();
  const num = String(numero || "").trim();
  if (!num) return n;
  for (const forma of new Set([num, num.replace(/^Rage-/i, "")])) {
    const esc = forma.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const limpo = n.replace(new RegExp(`\\s*\\(${esc}\\)`), " ").replace(/\s{2,}/g, " ").trim();
    if (limpo && limpo !== n) return limpo;
  }
  return n;
}

const VARIANT_ORDER = ["Normal", "Foil"];
const pick = (map, names) => { for (const n of names) { if (map.get(n) > 0) return map.get(n); } return 0; };

// Produto da TCGCSV -> { card, price }. `by` = Map(subTypeName -> USD, só os
// com preço); `subtipos` = os acabamentos que o TCGplayer lista pra carta,
// com ou sem preço (a paralela recém-lançada já é "Foil" antes da 1ª venda).
export function cardOf(p, g, setId, setTotal, by = new Map(), subtipos = new Set()) {
  const id = `gzc-${p.productId}`;
  const number = ext(p, "Number");
  const price = {};
  const u = pick(by, ["Normal", "Foil"]);
  const uf = pick(by, ["Foil"]);
  if (u) price.u = u;
  if (uf) price.uf = uf;
  const presentes = new Set([...by.keys(), ...subtipos]);
  const variants = VARIANT_ORDER.filter((v) => presentes.has(v));
  const nome = nomeDaCarta(p.name, number);
  const card = {
    id,
    name: nome,
    // Nome do grupo do TCGplayer sem o jogo na frente (contrato 7 do
    // docs/CATALOGO.md, regra em scripts/lib/nome-do-set.mjs).
    set: nomeDoSet("godzilla", g.name),
    setId,
    number,
    setTotal,
    setReleaseDate: (g.publishedOn || "").slice(0, 10),
    rarity: ext(p, "Rarity"),
    artist: "", // nem a TCGCSV nem o site oficial publicam o ilustrador
    language: "en",
    image: `https://tcgplayer-cdn.tcgplayer.com/product/${p.productId}_in_1000x1000.jpg`,
    variants: variants.length ? variants : ["Normal"],
    // Monster / Battle / Strategy / Rage. Parte das Rage vem sem CardType na
    // fonte (as do Booster Set 2 e as paralelas do 4); o nome delas é
    // literalmente "Rage", então o tipo sai dele.
    cardType: ext(p, "CardType") || (/^Rage\b/.test(nome) ? "Rage" : null),
    // Cor (Red/Blue/Green/White; a multicor vem "Red;Blue"): `color` é o nome
    // que o índice de busca e o editor de decks esperam (COLOR_FIELDS no
    // sync-common), e a faceta conta a carta nas duas cores.
    color: ext(p, "Color") || null,
    // Rank: I–IV nos monstros, 1–8 nas cartas de batalha. Texto, porque mistura
    // romano e arábico.
    rank: ext(p, "Rank") || null,
    traits: ext(p, "Traits") || null
  };
  return { card, price: Object.keys(price).length ? price : null };
}

async function run() {
  console.log("Godzilla Card Game: buscando sets (TCGCSV cat. 88)…");
  const groups = await api("/groups");
  console.log(`  ${groups.length} grupos.`);

  const abbrCount = new Map();
  for (const g of groups) { const a = String(g.abbreviation || "").trim(); if (a) abbrCount.set(a, (abbrCount.get(a) || 0) + 1); }

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
    const priceBy = new Map();   // productId -> Map(subType -> USD)
    const subtiposDe = new Map(); // productId -> Set(subType), com ou sem preço
    for (const p of prices) {
      if (!subtiposDe.has(p.productId)) subtiposDe.set(p.productId, new Set());
      if (p.subTypeName) subtiposDe.get(p.productId).add(p.subTypeName);
      const v = Number(p.marketPrice) > 0 ? p.marketPrice : (Number(p.midPrice) > 0 ? p.midPrice : 0);
      if (v <= 0) continue;
      if (!priceBy.has(p.productId)) priceBy.set(p.productId, new Map());
      priceBy.get(p.productId).set(p.subTypeName, r2(v));
    }

    // Carta = produto com "Number"; o resto é selado (booster, caixa, deck,
    // Promotion Pack).
    const setCards = products.filter((p) => ext(p, "Number"));
    if (!setCards.length) { console.log(`  ${g.groupId} ${g.name}: 0 cartas (só selados)`); continue; }

    const setId = setIdOf(g, setCards.map((p) => ext(p, "Number")), abbrCount);
    if (!ABREV_FIXA[g.groupId]) console.warn(`  AVISO: grupo novo sem pin (${g.groupId} ${g.name}) -> setId "${setId}". Pinar em ABREV_FIXA antes de publicar.`);
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

  // setLogo: VAZIO (nenhum set tem logo publicado, ver cabeçalho); o front
  // desenha o NOME do set como título (.set-logo-placeholder).
  for (const c of merged) { c.setLogo = ""; }

  const bySet = new Map();
  for (const c of merged) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c.id); }
  const indexes = {
    sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)),
    artists: []
  };

  await writeGameCatalog(OUT, { cards: merged, indexes, pricing, webDir: "data/godzilla/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} (cards/indexes/pricing + manifest/chunks).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
