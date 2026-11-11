// NARUTO CARD GAME (Bandai, lançamento mundial 2027) — o jogo NOVO, `narutocg`,
// em data/narutocg/. Até 11/11/2026 foi a LINHA nrt-ncg- do catálogo do
// Naruto (o `naruto`, que é o vintage de 2002–2006 e as linhas dele); virou
// jogo próprio porque é outro jogo, moderno, com preço e set novo pela frente,
// e somava na coleção do vintage. Os ids (nrt-ncg-) e o endereço
// (/games/naruto-card-game) não mudaram. Duas fontes:
//
//   1. CURADORIA manual (abaixo): promos de evento com scan próprio — ex.: a
//      Chakra Card da Gen Con 2026, a PRIMEIRA carta do jogo. Imagens locais
//      em assets/cards/naruto/ (scan recortado).
//   2. TCGCSV (dados públicos do TCGplayer), mesmo modelo do Cyberpunk: id =
//      "nrt-ncg-<productId>", imagem do CDN do TCGplayer, preço market (ou mid
//      quando não há venda). A categoria vem de --category ou da env
//      NARUTO_TCGCSV_CATEGORY (variável do repositório no GitHub, lida pelo
//      deploy.yml); sem ela, só a curadoria e o que já foi publicado.
//
// Conferido em 30/09/2026: a TCGCSV lista a categoria 93 "Naruto Card Game"
// com UM grupo, 24885 "Promotion Cards" (publishedOn 2026-09-16), e dois
// produtos, as duas CP-001 que já existem: Gen Con (717832) e New York Yankees
// (717838, distribuída no NARUTO Night at Yankee Stadium, 08/09/2026). A
// terceira (New York Comic Con, 8–11/10/2026) ainda não estava listada.
//
//   node scripts/sync-naruto.mjs                    # curadoria (+ TCGCSV se houver categoria)
//   node scripts/sync-naruto.mjs --discover         # lista categorias com "naruto"
//   node scripts/sync-naruto.mjs --category 93      # sincroniza a categoria
//
// O catálogo é só deste sync. Carta da TCGCSV que a fonte tirar fica
// CONGELADA, sem preço (id publicado nunca some — docs/CATALOGO.md, contrato
// 2). Isso vale também enquanto a variável não está ligada no GitHub: o build
// segue com o que está versionado em vez de apagar a carta.
//
// As cartas que moravam no catálogo do Naruto (a linha, até 11/11/2026) entram
// como "anteriores", com o preço que tinham, e saem de lá (tiraDoNaruto) — no
// CI este sync roda antes dos do Naruto, e o sync-naruto-vintage não as
// preserva mais.
import { fetchJsonRetry, mapLimit, readGlobalVar, writeGameCatalog, preserveMissingCards, slug } from "./lib/sync-common.mjs";
import { fileURLToPath } from "node:url";
import { nomeDoSet } from "./lib/nome-do-set.mjs";

const ROOT = new URL("../", import.meta.url);
const GAME = "narutocg";
const OUT = new URL(`data/${GAME}/`, ROOT);
const NARUTO = new URL("data/naruto/", ROOT);
const BASE = "https://tcgcsv.com/tcgplayer";
const HEADERS = { "User-Agent": "Sleevu (sleevu.app) catalog sync", Accept: "application/json" };
const DESTE_JOGO = /^nrt-ncg-/;

// ── Curadoria: promos com scan próprio ───────────────────────────────────────
// CP-001 "Chakra Card -Gen Con 2026 Ver.-" — a primeira carta do jogo, dada nas
// sessões de tutorial da Gen Con 2026 (Indianápolis, 30/07–02/08/2026), antes
// do lançamento mundial de 2027. Naruto & Sasuke na arte; carta de recurso
// ("When using Chakra, turn this card face-down."). Scan próprio, recortado.
export const CURATED = [
  {
    id: "nrt-ncg-cp-001",
    name: "Chakra Card -Gen Con 2026 Ver.-",
    set: "Promotion Cards",
    setId: "nrt-ncg-promo",
    number: "CP-001",
    setTotal: 1,
    setReleaseDate: "2026-07-30",
    rarity: "Promo",
    artist: "",
    language: "en",
    image: "/assets/cards/naruto/nrt-ncg-cp-001.webp",
    variants: ["Normal"],
    setLogo: "/assets/games/game_naruto_2027.webp",
    cardType: "Chakra"
  }
];

// Produto do TCGplayer que É uma carta da curadoria -> id curado. O id curado
// foi publicado antes de o TCGplayer listar a carta e não muda (contrato 1):
// ele ABSORVE o produto. Nome, imagem e set seguem os da curadoria (o scan é
// nosso; o do TCGplayer é foto). Do produto vêm o preço e os campos que a
// curadoria deixou vazios, mas só com a categoria ligada: o que tem de valer
// sempre (a raridade "Promo", a do TCGplayer) fica escrito na curadoria, senão
// vai e volta conforme a variável. Sem este mapa, a mesma carta entraria duas
// vezes. Só mapear produto que ainda NÃO foi publicado como
// nrt-ncg-<productId>: depois disso, trocar de id é de-para em
// data/card-id-merges.json, conversa com o Fernando antes.
// O número não serve pra casar sozinho: as três Chakra Card são CP-001.
export const PRODUTO_CURADO = {
  717832: "nrt-ncg-cp-001"  // "Chakra Card (Gen Con)"
};

// groupId -> setId. setId publicado não muda nunca (URL, chunk, régua do lint);
// o grupo das promos cai no set que a curadoria já publicou. Grupo novo sem
// pin vira "nrt-ncg-<abreviação>" ou "nrt-ncg-g<groupId>" se ela vier vazia
// (o log avisa: pinar ANTES do primeiro deploy que o publica).
export const SET_FIXO = {
  24885: "nrt-ncg-promo"   // Promotion Cards
};

// Nome oficial da Bandai quando o do TCGplayer é só um apelido ("Chakra Card
// (New York Yankees)"). Mesmo padrão da curadoria ("-<Evento> Ver.-"), sem o ™.
// Fonte: naruto-cardgame.com/en/news/nyy-collab.php (conferida em 30/09/2026).
export const NOME_OFICIAL = {
  717838: "Chakra Card -New York Yankees Ver.-"
};

export const ext = (p, key) => {
  const d = (p.extendedData || []).find((e) => e.name === key);
  return d && d.value != null ? String(d.value).trim() : "";
};

export function setIdOf(g, abbrCount) {
  if (SET_FIXO[g.groupId]) return SET_FIXO[g.groupId];
  const a = slug(String(g.abbreviation || "").trim());
  if (!a) return `nrt-ncg-g${g.groupId}`;
  return abbrCount && abbrCount.get(a) > 1 ? `nrt-ncg-${a}-${g.groupId}` : `nrt-ncg-${a}`;
}

const r2 = (x) => Math.round(x * 100) / 100;
const VARIANT_ORDER = ["Normal", "Foil"];
const pick = (map, names) => { for (const n of names) { if (map.get(n) > 0) return map.get(n); } return 0; };

// Linhas de preço da TCGCSV -> Map(productId -> Map(subTypeName -> USD)).
// Market quando há venda; sem venda (promo nova), o mid dos anúncios — o mesmo
// critério dos outros jogos da TCGCSV.
export function precosPorProduto(prices) {
  const by = new Map();
  for (const p of prices || []) {
    const v = Number(p.marketPrice) > 0 ? p.marketPrice : (Number(p.midPrice) > 0 ? p.midPrice : 0);
    if (v <= 0) continue;
    if (!by.has(p.productId)) by.set(p.productId, new Map());
    by.get(p.productId).set(p.subTypeName, r2(v));
  }
  return by;
}

// Produto da TCGCSV -> { card, price }. `by` = Map(subTypeName -> USD).
export function cardOf(p, g, setId, by = new Map()) {
  const price = {};
  const u = pick(by, ["Normal", "Foil"]);
  const uf = pick(by, ["Foil"]);
  if (u) price.u = u;
  if (uf) price.uf = uf;
  const variants = VARIANT_ORDER.filter((v) => by.has(v));
  const card = {
    id: `nrt-ncg-${p.productId}`,
    name: NOME_OFICIAL[p.productId] || p.name,
    // Nome do grupo do TCGplayer sem o jogo na frente (2026-11-02):
    // contrato 7 do docs/CATALOGO.md, regra em scripts/lib/nome-do-set.mjs.
    set: nomeDoSet(GAME, g.name),
    setId,
    number: ext(p, "Number"),
    setTotal: 0, // contado por set em uniformizaSets
    setReleaseDate: (g.publishedOn || "").slice(0, 10),
    rarity: ext(p, "Rarity"),
    artist: "",
    language: "en",
    image: `https://tcgplayer-cdn.tcgplayer.com/product/${p.productId}_in_1000x1000.jpg`,
    variants: variants.length ? variants : ["Normal"],
    setLogo: "",
    cardType: ext(p, "CardType") || null
  };
  return { card, price: Object.keys(price).length ? price : null };
}

// A carta curada absorve o produto: mantém o que é dela, preenche o que está
// vazio. As variantes vêm do produto (são as que têm preço).
export function absorve(curada, doProduto) {
  const out = { ...curada };
  for (const k of ["rarity", "artist", "cardType"]) {
    if (!out[k] && doProduto[k]) out[k] = doProduto[k];
  }
  if (doProduto.variants && doProduto.variants.length) out.variants = doProduto.variants;
  return out;
}

// Campos de SET iguais em todas as cartas do set, venha a carta da curadoria,
// da TCGCSV ou congelada: nome e logo do primeiro que tiver (a ordem da linha
// é curadoria > TCGCSV > congeladas), data = a mais antiga (no set de promos,
// a do primeiro evento; a do grupo da TCGCSV é a da listagem) e total = o que
// existe no set.
export function uniformizaSets(cards) {
  const porSet = new Map();
  for (const c of cards) {
    if (!porSet.has(c.setId)) porSet.set(c.setId, []);
    porSet.get(c.setId).push(c);
  }
  for (const grupo of porSet.values()) {
    const set = (grupo.find((c) => c.set) || {}).set || "";
    const setLogo = (grupo.find((c) => c.setLogo) || {}).setLogo || "";
    const datas = grupo.map((c) => c.setReleaseDate).filter(Boolean).sort();
    for (const c of grupo) {
      c.set = set;
      c.setLogo = setLogo;
      c.setReleaseDate = datas[0] || "";
      c.setTotal = grupo.length;
    }
  }
  return cards;
}

// Ordem da linha: set, número; empate (as CP-001) fica na ordem de entrada —
// curadoria primeiro, que é a ordem dos eventos.
export const ordena = (cards) => cards.sort((a, b) =>
  a.setId.localeCompare(b.setId) || String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));

// Monta a linha a partir dos produtos de cada grupo ({ g, prods, prices }).
export function montaLinha(grupos, { curated = CURATED, anteriores = [] } = {}) {
  const linha = curated.map((c) => ({ ...c }));
  const porId = new Map(linha.map((c) => [c.id, c]));
  const pricing = {};
  const abbrCount = new Map();
  for (const { g } of grupos) {
    const a = slug(String(g.abbreviation || "").trim());
    if (a) abbrCount.set(a, (abbrCount.get(a) || 0) + 1);
  }
  const daFonte = [];
  for (const { g, prods, prices } of grupos) {
    const setId = setIdOf(g, abbrCount);
    const by = precosPorProduto(prices);
    // Carta = produto com "Number"; o resto é selado (booster, display, kit).
    const cartas = (prods || []).filter((p) => ext(p, "Number"));
    if (cartas.length && !SET_FIXO[g.groupId]) console.warn(`  AVISO: grupo novo sem pin (${g.groupId} ${g.name}) -> setId "${setId}". Pinar em SET_FIXO antes de publicar.`);
    for (const p of cartas) {
      const { card, price } = cardOf(p, g, setId, by.get(p.productId));
      const curadaId = PRODUTO_CURADO[p.productId];
      const curada = curadaId && porId.get(curadaId);
      if (curada) {
        porId.set(curadaId, absorve(curada, card));
        if (price) pricing[curadaId] = price;
        continue;
      }
      daFonte.push(card);
      if (price) pricing[card.id] = price;
    }
  }
  const novas = [...porId.values()].concat(daFonte);
  const congeladas = preserveMissingCards(anteriores.filter((c) => c && DESTE_JOGO.test(String(c.id))), novas);
  return { cards: ordena(uniformizaSets(novas.concat(congeladas))), pricing, congeladas: congeladas.length };
}

const json = (url) => fetchJsonRetry(url, { headers: HEADERS });
const argAt = (flag) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : null; };

async function discover() {
  const cats = (await json(`${BASE}/categories`)).results || [];
  const hits = cats.filter((c) => /naruto/i.test(c.name || "") || /naruto/i.test(c.displayName || ""));
  console.log(hits.length ? "Categorias com 'naruto' na TCGCSV:" : "Nenhuma categoria 'naruto' na TCGCSV ainda.");
  hits.forEach((c) => console.log(`  ${c.categoryId} - ${c.name}`));
}

// As cartas nrt-ncg- moraram no catálogo do Naruto enquanto isto foi linha
// dele (até 11/11/2026). Tira de lá, com o preço: o sync-naruto-vintage também
// as descarta, e no build rápido o translate-naruto-names regrava o Naruto a
// partir do cards.js versionado, que já vem sem elas. Sem carta nrt-ncg- lá,
// não faz nada.
async function tiraDoNaruto() {
  const cards = (await readGlobalVar(new URL("cards.js", NARUTO), "TCG_CARDS")) || [];
  const resto = cards.filter((c) => c && !DESTE_JOGO.test(String(c.id)));
  if (!cards.length || resto.length === cards.length) return 0;
  const precos = (await readGlobalVar(new URL("pricing.js", NARUTO), "TCG_PRICING")) || {};
  const pricing = {};
  for (const [id, v] of Object.entries(precos)) if (!DESTE_JOGO.test(id)) pricing[id] = v;
  await writeGameCatalog(NARUTO, { cards: resto, pricing, webDir: "data/naruto/" });
  return cards.length - resto.length;
}

async function run() {
  const CATEGORY = argAt("--category") || process.env.NARUTO_TCGCSV_CATEGORY;
  const proprias = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const precosProprios = (await readGlobalVar(new URL("pricing.js", OUT), "TCG_PRICING")) || {};
  // O que ainda está no catálogo do Naruto (a 1ª rodada depois da separação)
  // conta como publicado: sem isto, a carta da TCGCSV que só existe lá
  // sumiria enquanto a categoria não está ligada.
  const doNaruto = ((await readGlobalVar(new URL("cards.js", NARUTO), "TCG_CARDS")) || []).filter((c) => c && DESTE_JOGO.test(String(c.id)));
  const precosDoNaruto = (await readGlobalVar(new URL("pricing.js", NARUTO), "TCG_PRICING")) || {};
  const temAqui = new Set(proprias.map((c) => c && c.id));
  const existing = proprias.concat(doNaruto.filter((c) => !temAqui.has(c.id)));
  const pricingOld = {};
  for (const [id, v] of Object.entries(precosDoNaruto)) if (DESTE_JOGO.test(id)) pricingOld[id] = v;
  Object.assign(pricingOld, precosProprios);

  const grupos = [];
  if (!CATEGORY) {
    console.log(`Naruto Card Game (${GAME}): sem categoria TCGCSV — curadoria (${CURATED.length}) + o que já foi publicado.`);
  } else {
    console.log(`Naruto Card Game (${GAME}): sincronizando TCGCSV categoria ${CATEGORY}…`);
    const groups = (await json(`${BASE}/${CATEGORY}/groups`)).results || [];
    console.log(`  ${groups.length} grupo(s).`);
    await mapLimit(groups, 4, async (g) => {
      const [prods, prices] = await Promise.all([
        json(`${BASE}/${CATEGORY}/${g.groupId}/products`).then((r) => r.results || []),
        json(`${BASE}/${CATEGORY}/${g.groupId}/prices`).then((r) => r.results || []).catch(() => [])
      ]);
      grupos.push({ g, prods, prices });
    });
    grupos.sort((a, b) => a.g.groupId - b.g.groupId);
  }

  const { cards, pricing: pricingNew, congeladas } = montaLinha(grupos, { anteriores: existing });
  for (const s of new Set(cards.map((c) => c.setId))) {
    const cs = cards.filter((c) => c.setId === s);
    console.log(`  ${s} ${cs[0].set}: ${cs.length} carta(s)`);
  }
  if (congeladas) console.log(CATEGORY
    ? `  ${congeladas} carta(s) que a fonte não lista mais ficaram congeladas.`
    : `  ${congeladas} carta(s) mantidas como estão no catálogo publicado (fonte não consultada).`);

  // Preço: com a categoria, é refeito (carta congelada fica sem preço, preço
  // que a fonte tirou não fica velho pra sempre). Sem ela, fica o publicado.
  const ids = new Set(cards.map((c) => c.id));
  const pricing = {};
  if (!CATEGORY) for (const [id, v] of Object.entries(pricingOld)) if (ids.has(id)) pricing[id] = v;
  Object.assign(pricing, pricingNew);

  await writeGameCatalog(OUT, { cards, pricing, webDir: `data/${GAME}/` });
  const tiradas = await tiraDoNaruto();
  console.log(`Gravado em ${fileURLToPath(OUT)} — ${cards.length} cartas, ${Object.keys(pricing).length} com preço${tiradas ? `; ${tiradas} saíram do catálogo do Naruto` : ""}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--discover")) await discover();
  else await run();
}
