// Catálogo do FINAL FANTASY TRADING CARD GAME (Square Enix, edição ocidental
// desde 2016; os Opus) a partir da TCGCSV (tcgcsv.com), espelho público
// diário do TCGplayer — categoria 24, linha `final-fantasy-tcg` (conferidas
// em 11/11/2026). Mesmo padrão do Godzilla/Union Arena: catálogo inteiro em
// data/fftcg/ (cards.js versionado = durabilidade; 38 sets / ~5.700 cartas em
// 11/2026).
//
// Não confundir com o set "Final Fantasy" do Magic (Universes Beyond, 2025):
// aquele mora no catálogo do Magic; este é o jogo próprio da Square Enix.
//
// Identidade: id = "fftcg-<productId>". Imagens: CDN do TCGplayer
// (_in_1000x1000), host já liberado na CSP e no SW e já coberto pelo espelho
// R2. Na maioria dos sets o TCGplayer só tem 429×600 — o CDN oficial da Square
// Enix (fftcg.cdn.sewest.net/images/cards/full/<número>_eg.jpg) tem o MESMO
// tamanho, então não há fonte melhor (conferido em 11/11/2026). Acabamentos:
// Normal / Foil (u/uf).
// Produto sem foto no TCGplayer (imageCount 0) usa a da carta-irmã do mesmo
// número: a "(Full Art)" e a "(Prerelease Promo)" têm a mesma ilustração da
// comum; a "(Noir Promo)", em preto e branco, só pega outra Noir
// (scripts/lib/imagem-da-irma.mjs).
//
// FULL ART é produto próprio no TCGplayer, com o MESMO número da carta comum
// ("Tifa (Full Art)", 20-077L): vira carta própria, como o Hyperspace do Star
// Wars e as paralelas do Godzilla. O id é o productId, então os dois não se
// confundem.
//
// Nome: o TCGplayer enfia o número no nome de jeitos diferentes — "Black Mage
// (Arc) - 1-010C", "Black Mage (2-033C)", "Kain - PR-009/2-103H (Alternate Art
// Promo)", "Warrior of Light (PR-171)(JP)". O número já vai no campo `number`
// e aparece ao lado do nome em toda tela, então sai do nome quando é o desta
// carta (ou uma das partes dele: a promo "PR-078/7-128H" escrita só "(PR-078)").
// Os qualificadores ficam: "(Full Art)", "(Hero)" — o TCGplayer separa assim
// as homônimas do mesmo set —, "(JP)", "(Gold)".
//
// setId: fixo por groupId antes da primeira publicação. A abreviação da TCGCSV
// não serve: o Journey of Discovery vem "28" mas imprime 27-xxx (o Opus 27), o
// Dreamlike Oceans também é "28", o Starter Set Heavensward e o Memories of
// Life são os dois "30", e os Boss Decks vêm sem. Os boosters viram "OP<n>",
// o número que a carta imprime antes do hífen e que a Square Enix usa ("Opus
// 28" no material do Dreamlike Oceans) — o TCGplayer já abreviava assim até o
// Opus XIV. Starter Sets "ST<n>", Boss Decks "BDC"/"BD7", o Legacy Collection
// "RE" (a carta imprime "Re-001H"). setId publicado não muda nunca (URL, régua
// do lint). Grupo novo sem pin (o Opus 31) cai no número que a maioria das
// cartas dele imprime ("31-001H" -> OP31; "ST31" se o nome diz Starter), e o
// log avisa pra pinar antes do deploy que publica.
//
// Logo de set: nenhum publicado. O site oficial (fftcg.square-enix-games.com/
// en/releases) só tem a arte de capa, a caixa e o pacote de cada set. Sem
// logo, o front desenha o NOME (política única do site).
//
//   node scripts/sync-fftcg.mjs
import { fileURLToPath } from "node:url";
import { writeGameCatalog, readGlobalVar, preserveMissingCards, fetchJsonRetry, sleep } from "./lib/sync-common.mjs";
import { nomeDoSet } from "./lib/nome-do-set.mjs";
import { fotosDasIrmas } from "./lib/imagem-da-irma.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/fftcg/", ROOT);
const API = "https://tcgcsv.com/tcgplayer/24";
const UA = "Sleevu (sleevu.app) catalog sync";
const imagemDoProduto = (productId) => `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`;

// groupId -> setId (ver cabeçalho). Abreviação da fonte entre parênteses
// quando ela diverge.
export const ABREV_FIXA = {
  1939: "OP1",    // Opus I (2017)
  1940: "OP2",    // Opus II
  1946: "OP3",    // Opus III
  1947: "OP4",    // Opus IV
  2190: "OP5",    // Opus V
  2254: "OP6",    // Opus VI
  2342: "OP7",    // Opus VII
  2395: "OP8",    // Opus VIII
  2460: "OP9",    // Opus IX
  2530: "OP10",   // Opus X
  2589: "OP11",   // Opus XI
  2664: "OP12",   // Opus XII
  2764: "OP13",   // Opus XIII: Crystal Radiance
  2792: "OP14",   // Opus XIV: Crystal Abyss
  2888: "OP15",   // Crystal Dominion ("15")
  2974: "OP16",   // Emissaries of Light ("16")
  3058: "OP17",   // Rebellion's Call ("17")
  3153: "OP18",   // Resurgence of Power ("18")
  22891: "OP19",  // From Nightmares ("19")
  23244: "OP20",  // Dawn of Heroes ("20")
  23271: "OP21",  // Beyond Destiny ("21")
  23344: "OP22",  // Hidden Hope ("22")
  23568: "OP23",  // Hidden Trials ("23")
  23783: "OP24",  // Hidden Legends ("24")
  24229: "OP25",  // Tears of the Planet ("25")
  24317: "OP26",  // Gunslinger in the Abyss ("26")
  24481: "OP27",  // Journey of Discovery ("28" na fonte; a carta imprime 27-xxx)
  24576: "OP28",  // Dreamlike Oceans ("28")
  24577: "OP29",  // Blissful Eternity ("29")
  24788: "OP30",  // Memories of Life ("30"; 13/11/2026)
  24472: "ST27",  // Starter Set 2025 ("27"; imprime 27-xxx, como o Journey)
  24742: "ST30",  // Starter Set: Heavensward ("30"; imprime 30-xxx, como o Memories)
  2774: "BDC",    // Boss Deck: Chaos (imprime B-001…B-027)
  22894: "BD7",   // Boss Deck: Final Fantasy VII (sem abreviação; B-028…B-054)
  22892: "CS13",  // Custom Starter Set: Final Fantasy XIII (sem abreviação; 0 cartas em 11/2026)
  24187: "RE",    // Legacy Collection ("LGC"; a carta imprime Re-001H)
  1941: "PR",     // FF: Promo Cards
  24321: "W24",   // World Champion Decks 2024
  2362: "DEC"     // Deck Exclusive Cards (as cartas só de starter do Opus I–III)
};

// groupId -> data de lançamento, quando a da fonte está errada. O Deck
// Exclusive Cards vem com publishedOn de 11/11/2026 (a data em que a TCGCSV
// mexeu no grupo), e com ela o set entraria em /lancamentos como novidade. As
// cartas são dos starter decks do Opus I–III; fica a data do Opus I.
export const DATA_FIXA = {
  2362: "2017-05-30"
};

const listOf = (j) => (j && Array.isArray(j.results)) ? j.results : [];
const api = async (path) => listOf(await fetchJsonRetry(`${API}${path}`, { headers: { "User-Agent": UA, Accept: "application/json" } }));

const r2 = (x) => Math.round(x * 100) / 100;
export const ext = (p, key) => {
  const d = (p.extendedData || []).find((e) => e.name === key);
  return d && d.value != null ? String(d.value).trim() : "";
};

// Número do set que a MAIORIA das cartas do grupo imprime ("31-001H" -> 31).
// Promo, Legacy e Boss Deck não têm número de set e não votam. Abaixo de
// metade das cartas numeradas, não há número dominante.
export function numeroDominante(numeros) {
  const conta = new Map();
  let total = 0;
  for (const n of numeros) {
    const m = /^(\d{1,2})-\d{3}/.exec(String(n || "").trim());
    total++;
    if (m) conta.set(m[1], (conta.get(m[1]) || 0) + 1);
  }
  const [num, n] = [...conta].sort((a, b) => b[1] - a[1])[0] || [];
  return num && n * 2 > total ? String(Number(num)) : "";
}

// `usados` = setIds já tomados (os pins e os grupos novos desta rodada): o
// Opus 31 e o starter dele imprimem os dois 31-xxx.
export function setIdOf(g, numeros = [], usados = new Set()) {
  if (ABREV_FIXA[g.groupId]) return ABREV_FIXA[g.groupId];
  const dominante = numeroDominante(numeros);
  let base;
  if (dominante) base = (/starter/i.test(g.name || "") ? "ST" : "OP") + dominante;
  else base = String(g.abbreviation || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "") || `G${g.groupId}`;
  return usados.has(base) ? `${base}-${g.groupId}` : base;
}

// Partes de um número: "PR-078/7-128H" -> ["PR-078", "7-128H"], em maiúscula
// (a fonte escreve "Pr-178/20-003H" numa das promos).
const partes = (s) => String(s || "").toUpperCase().split("/").map((x) => x.trim()).filter(Boolean);
// Formato de número de carta: 1-010C, PR-009, PR165, Re-001H, W24-041, B-027.
const PARECE_NUMERO = /^[A-Z]{0,3}\d{0,2}-?\d{3}[A-Z]?$/;
function ehONumero(trecho, numero) {
  const t = partes(trecho);
  if (!t.length || !t.every((x) => PARECE_NUMERO.test(x))) return false;
  // Também sem a letra da raridade: "Lightning - 13-081" é a 13-081H.
  const n = new Set(partes(numero).flatMap((x) => [x, x.replace(/(\d)[A-Z]$/, "$1")]));
  return t.some((x) => n.has(x));
}

// "Black Mage (Arc) - 1-010C" -> "Black Mage (Arc)"; "Yuri (PR-078)" com o
// número "PR-078/7-128H" -> "Yuri"; "Warrior of Light (PR-171)(JP)" ->
// "Warrior of Light (JP)". Número que NÃO é o desta carta fica (a fonte erra
// às vezes, e dado não se inventa).
export function nomeDaCarta(nome, numero) {
  let n = String(nome || "").trim();
  if (!String(numero || "").trim()) return n;
  n = n.replace(/\s*\(([^()]+)\)/g, (todo, dentro) => (ehONumero(dentro, numero) ? " " : todo));
  n = n.replace(/\s+-\s+([A-Za-z0-9/-]+)(?=\s|$)/g, (todo, trecho) => (ehONumero(trecho, numero) ? " " : todo));
  return n.replace(/\s{2,}/g, " ").trim() || String(nome || "").trim();
}

const VARIANT_ORDER = ["Normal", "Foil"];
const pick = (map, names) => { for (const n of names) { if (map.get(n) > 0) return map.get(n); } return 0; };

// Produto da TCGCSV -> { card, price }. `by` = Map(subTypeName -> USD, só os
// com preço); `subtipos` = os acabamentos que o TCGplayer lista pra carta,
// com ou sem preço.
export function cardOf(p, g, setId, setTotal, by = new Map(), subtipos = new Set()) {
  const id = `fftcg-${p.productId}`;
  const number = ext(p, "Number");
  const price = {};
  const u = pick(by, ["Normal", "Foil"]);
  const uf = pick(by, ["Foil"]);
  if (u) price.u = u;
  if (uf) price.uf = uf;
  const presentes = new Set([...by.keys(), ...subtipos]);
  const variants = VARIANT_ORDER.filter((v) => presentes.has(v));
  const raridade = ext(p, "Rarity");
  const card = {
    id,
    name: nomeDaCarta(p.name, number),
    // Nome do grupo do TCGplayer sem o jogo na frente (contrato 7 do
    // docs/CATALOGO.md, regra em scripts/lib/nome-do-set.mjs).
    set: nomeDoSet("fftcg", g.name),
    setId,
    number,
    setTotal,
    setReleaseDate: DATA_FIXA[g.groupId] || (g.publishedOn || "").slice(0, 10),
    // Common/Rare/Hero/Legend/Starter/Promo. As cartas dos Boss Decks vêm
    // "None": sem raridade.
    rarity: raridade === "None" ? "" : raridade,
    artist: "", // a TCGCSV não publica o ilustrador
    language: "en",
    image: imagemDoProduto(p.productId),
    variants: variants.length ? variants : ["Normal"],
    // Forward / Backup / Summon / Monster.
    cardType: ext(p, "CardType") || null,
    // ELEMENTO (Fire, Ice, Wind, Earth, Lightning, Water, Light, Dark; o de
    // dois elementos vem "Fire;Ice"): `color` é o nome que o índice de busca e
    // o editor de decks esperam (COLOR_FIELDS no sync-common), como o Sorcery.
    color: ext(p, "Element") || null,
    cost: ext(p, "Cost") || null,
    // De qual Final Fantasy é a carta (VII, XIV, Type-0, MOBIUS…; a fonte
    // chama de "Category", e a carta de vários títulos vem "VI;DFF").
    series: ext(p, "Category") || null
  };
  return { card, price: Object.keys(price).length ? price : null };
}

async function run() {
  console.log("Final Fantasy TCG: buscando sets (TCGCSV cat. 24)…");
  const groups = await api("/groups");
  console.log(`  ${groups.length} grupos.`);

  const usados = new Set(Object.values(ABREV_FIXA));
  const cards = [];
  const pricing = {}; // { id: { u, uf } } — USD market do TCGplayer
  // Produtos de TODOS os grupos: a irmã com foto pode estar em outro set.
  const irmas = fotosDasIrmas({ arte: /noir/i });

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

    // Carta = produto com "Number"; o resto é selado (booster, display, kit).
    const setCards = products.filter((p) => ext(p, "Number"));
    if (!setCards.length) { console.log(`  ${g.groupId} ${g.name}: 0 cartas (só selados)`); continue; }

    const setId = setIdOf(g, setCards.map((p) => ext(p, "Number")), usados);
    if (!ABREV_FIXA[g.groupId]) {
      usados.add(setId);
      console.warn(`  AVISO: grupo novo sem pin (${g.groupId} ${g.name}) -> setId "${setId}". Pinar em ABREV_FIXA antes de publicar.`);
    }
    for (const p of setCards) {
      const { card, price } = cardOf(p, g, setId, setCards.length, priceBy.get(p.productId), subtiposDe.get(p.productId));
      cards.push(card);
      irmas.anota(p, g, ext(p, "Number"), card);
      if (price) pricing[card.id] = price;
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

  // setLogo: VAZIO (nenhum set tem logo publicado, ver cabeçalho); o front
  // desenha o NOME do set como título (.set-logo-placeholder).
  for (const c of merged) { c.setLogo = ""; }

  const bySet = new Map();
  for (const c of merged) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c.id); }
  const indexes = {
    sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)),
    artists: []
  };

  await writeGameCatalog(OUT, { cards: merged, indexes, pricing, webDir: "data/fftcg/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} (cards/indexes/pricing + manifest/chunks).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
