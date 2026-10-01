// Catálogo do Weiß Schwarz (Bushiroad; edição em inglês desde 2013) a partir
// da TCGCSV (tcgcsv.com), espelho público diário do TCGplayer — categoria 20
// ("Weiss Schwarz"), linha `weiss-schwarz` (conferidas em 01/10/2026). Jogo
// ATIVO, na grade principal: em out/2026 a TCGCSV já listava set em pré-venda
// até fev/2027. Mesmo padrão do Cyberpunk/Union Arena: catálogo inteiro em
// data/weiss/ (cards.js versionado = durabilidade; ~170 sets / ~31 mil cartas,
// ~10 MB sem o texto das cartas, que os jogos da TCGCSV não guardam).
//
// SÓ a edição inglesa, por decisão do Fernando (01/10/2026). A japonesa não
// está no TCGplayer; o site oficial (ws-tcg.com) tem 65.767 cartas + 3.506 PR
// numa API JSON interna, sem preço — fica pra uma fase própria, se vier.
//
// Identidade: id = "ws-<productId>" (`ws-` livre no Pokémon e no Lorcana, 7.3
// do docs/CATALOGO.md). O número impresso NÃO serve: 763 produtos repetem o de
// outro (reimpressão do Chronicle Set, promo de evento com a mesma carta).
// Cada paralela (SR/SP/SSP/OFR/assinada…) é um PRODUTO próprio no TCGplayer,
// com número próprio ("HOL/W91-E001SSP") e preço próprio — vira carta separada,
// como o Hyperspace do Star Wars. Por isso o preço só tem o subtipo Normal (u).
//
// Número: a TCGCSV manda "<código> <raridade> [RE]" ("DDD/S118-E014 C",
// "FT/EN-S02-T01 TD RE"); fica só o código impresso na carta.
//
// Imagens: CDN do TCGplayer (_in_1000x1000), host já liberado na CSP e no SW e
// já coberto pelo espelho R2. A resolução varia por set: os de 2024 em diante
// vêm com 500–716 px de largura, os de 2013–2023 com 200–400 px (amostra de 44
// cartas, 30/09/2026; o site oficial EN dá 346 px, então não há fonte melhor —
// aceito pelo Fernando). As Climax são HORIZONTAIS: o popup já trata carta
// deitada (.is-landscape).
//
// setId: a TCGCSV deixou a abreviação vazia em 4 grupos e repetida em 5 (HOL
// ×3, LRC, OSK, JJ, FT/), e em dois ela aponta pro set errado (o grupo do
// "Dreaming Girl" vem "SHS/W56", que é o código do Saekano). Como setId
// publicado não muda nunca (logo, régua do lint), os 169 ficam FIXOS pelo
// groupId aqui, com o CÓDIGO IMPRESSO na carta ("DDD/S118" -> "DDD-S118"):
// é o que o jogador procura e o que a Bushiroad usa. Exceções, à mão:
//   - PR (Promo Cards) e EVENT (Bushiroad Event Cards): misturam séries;
//   - F-W65, F-W120 (Fujimi Fantasia Bunko) e G-WS02 (Dengeki Bunko): um
//     código por título dentro do set (FSI/W65, FDD/W65…); fica a letra comum,
//     como a própria abreviação da fonte ("F**", "G**");
//   - LL-WE39 e SIF-W109: idem, os títulos do Love Live! dividem o set;
//   - FT-EN-S02-RE: o Chronicle Set do Fairy Tail reimprime o FT/EN-S02 com o
//     MESMO código (e o selo RE), sem código próprio;
//   - LRC-WE47 e MDE-SE45: a fonte grafa o número fora do padrão.
// Grupo novo sem pin cai na abreviação da fonte quando ela é um código
// completo ("XXX/W123"), senão no código mais comum das cartas, e avisa no log:
// pinar ANTES do primeiro deploy que o publica.
//
// Logo de set: não existe publicado. O media kit oficial
// (en.ws-tcg.com/mediakit, 133 pacotes zip, índice conferido por range request
// em 01/10/2026) só traz banners, caixa, embalagem e arte de carta — o logo da
// série vem sempre pintado em cima de arte, nunca solto. A tela mostra o NOME
// (política única do site). Arquivo que aparecer em
// data/weiss/set-logos/<setId>.webp é usado.
//
//   node scripts/sync-weiss.mjs
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { writeGameCatalog, readGlobalVar, preserveMissingCards, winSafeName, fetchJsonRetry, sleep } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/weiss/", ROOT);
const API = "https://tcgcsv.com/tcgplayer/20";
const UA = "Sleevu (sleevu.app) catalog sync";

// groupId -> setId (ver cabeçalho), por ano de lançamento.
export const ABREV_FIXA = {
  // 2013
  1624: "PD-S22", 1626: "MM-W17", 1628: "SAO-S20", 1630: "FZ-S17", 1644: "PR",
  // 2014
  1611: "AB-W31", 1614: "LL-W24", 1615: "FT-EN-S02", 1618: "P4-EN-S01",
  1619: "KLK-S27", 1621: "SAO-S26", 1622: "BM-S15",
  // 2015
  1601: "AOT-S35", 1603: "LL-EN-W01", 1604: "NK-W30", 1606: "KC-S25",
  1608: "SAO-SE23", 1610: "PD-S29", 1635: "FS-S34", 1650: "MM-W35",
  1666: "LH-SE20", 1667: "KC-S31", 1678: "LL-W34",
  // 2016
  1702: "SY-W08", 1732: "NM-S24", 1746: "IMC-W41", 1758: "FS-S36",
  1785: "SY-WE09", 1787: "SAO-SE26", 1799: "DG-EN-S03", 1808: "LL-EN-W02",
  1813: "NK-WE22", 1843: "PI-EN-S04",
  // 2017
  1864: "TL-W37", 1888: "LSS-W45", 1916: "SAO-S47", 1926: "AW-S18",
  1927: "AW-S43", 1928: "KC-SE28", 1937: "BD-W47", 1955: "P5-S45",
  1992: "KS-W49", 1993: "AOT-S50", 2097: "SAO-S51",
  // 2018
  1623: "KS-W55", 1668: "RZ-S46", 1865: "BD-W54", 1887: "GL-S52",
  1956: "LSS-WE27", 2265: "KC-S42", 2271: "APO-S53",
  // 2019
  1602: "SBY-W64", 1605: "NGL-S58", 1609: "RSL-S56", 1612: "BD-W63",
  1617: "RZ-S55", 1629: "FS-S64", 1631: "BD-EN-W03", 1636: "CCS-WX01",
  1703: "BNJ-SX01", 1757: "GGO-S59",
  // 2020
  1607: "RZ-S68", 1613: "GBS-S63", 1616: "BD-W73", 1620: "OVL-S62",
  1625: "TSK-S70", 1627: "KS-W76", 1733: "JJ-S66", 1805: "AT-WX02",
  1811: "F-W65", 1906: "SAO-S65", 2602: "EVENT", 2709: "MOB-SX02",
  // 2021
  2746: "FGO-S75", 2747: "RZ-SE35", 2748: "MR-W59", 2758: "DAL-W79",
  2768: "MR-W80", 2780: "BFR-S78", 2812: "KGL-S79", 2813: "FS-S77",
  2815: "SDS-SX03", 2872: "TSK-S82", 2875: "SAO-S80", 2878: "5HY-W83",
  2929: "RWBY-WX03", 2930: "DAL-WE33",
  // 2022
  2943: "BD-WE34", 2944: "BD-WE35", 2972: "KNK-W86", 2979: "MTI-S83",
  3007: "HOL-W91", 3010: "BD-WE32", 3074: "FGO-S87", 3077: "DDM-S88",
  3078: "TRV-S92", 3088: "5HY-W90", 3091: "AOT-SX04", 3113: "SBY-W77",
  3114: "SHS-W56", 3137: "HOL-WE36", 3161: "KMD-W96", 3184: "SDS-SX05",
  // 2023
  17705: "KGL-S95", 17709: "KLK-SP03", 22870: "DAL-W99", 22897: "ATLA-WX04",
  22975: "SY-WP02", 22976: "LH-SP02", 22978: "BD-W95", 22980: "SAO-S100",
  22984: "GRI-S72", 22985: "SHS-W71", 22986: "5HY-W101", 22988: "TSK-S101",
  22992: "RSL-S69", 22994: "HOL-W104", 23240: "AZL-S102", 23245: "ARI-S103",
  23261: "OVL-S99", 23262: "RSL-S98", 23339: "GGST-SX06",
  // 2024
  23249: "SPY-S106", 23307: "CSM-S96", 23322: "LRC-W105", 23382: "BD-WE42",
  23398: "BTR-W107", 23417: "SHS-W98", 23423: "RWBY-WXE01", 23432: "SS-WE41",
  23468: "AYT-W110", 23499: "HOL-WE44", 23500: "HOL-WE45", 23501: "LL-WE39",
  23507: "OSK-S107", 23508: "JJ-SE41", 23510: "JJ-SE42", 23516: "G-WS02",
  23547: "SIF-W109", 23553: "SAO-SC20", 23554: "FZ-SC17", 23570: "SFN-S108",
  23571: "MDE-SE45",
  // 2025
  23650: "5HY-WE43", 23751: "BAV-W112", 23785: "P3-SE46", 23788: "SBY-W114",
  23932: "NIK-S117", 23989: "RKN-S115", 24177: "LRC-WE47", 24244: "PJS-S91",
  24270: "BD-W125", 24332: "GGO-SE50", 24354: "AZL-S119",
  24369: "FT-EN-S02-RE", 24476: "KS-W75",
  // 2026
  24314: "GCR-SE48", 24453: "DDD-S118", 24455: "MKI-W126", 24470: "FT-S120",
  24530: "OSK-S121", 24546: "F-W120", 24556: "EIS-SX07", 24593: "OVL-SE51",
  24613: "UMA-W106", 24614: "BD-WE49", 24634: "BAV-W129", 24667: "RZ-S116",
  24696: "NIK-S135"
};

const listOf = (j) => (j && Array.isArray(j.results)) ? j.results : [];
const api = async (path) => listOf(await fetchJsonRetry(`${API}${path}`, { headers: { "User-Agent": UA, Accept: "application/json" } }));

const r2 = (x) => Math.round(x * 100) / 100;
export const ext = (p, key) => {
  const d = (p.extendedData || []).find((e) => e.name === key);
  return d && d.value != null ? String(d.value).trim() : "";
};
// Número da TCGCSV vem string. Sem valor -> null (e não 0, que no histograma
// de custo do editor viraria uma coluna falsa em zero).
const num = (s) => (/^\d+$/.test(s) ? Number(s) : null);

// "DDD/S118-E014 C" -> "DDD/S118-E014" (ver cabeçalho).
export const numberOf = (s) => String(s || "").trim().split(/\s+/)[0] || "";

// Código do set dentro do número impresso: "DDD/S118-E014" -> "DDD-S118",
// "LL/EN-W01-001" -> "LL-EN-W01".
export function codeOfNumber(n) {
  const m = /^([A-Za-z0-9*]+)\/((?:EN-)?[A-Za-z]*\d+)-/.exec(String(n || "").trim());
  return m ? `${m[1]}-${m[2]}`.toUpperCase() : "";
}

// setId de um grupo: o pin; senão a abreviação, quando é um código completo;
// senão o código mais comum entre os números das cartas; senão "G<groupId>".
export function setIdOf(g, numbers = []) {
  if (ABREV_FIXA[g.groupId]) return ABREV_FIXA[g.groupId];
  const a = String(g.abbreviation || "").trim();
  if (/^[A-Za-z0-9]+\/(EN-)?[A-Za-z]*\d+$/.test(a)) return a.toUpperCase().replace("/", "-");
  const conta = new Map();
  for (const n of numbers) { const c = codeOfNumber(n); if (c) conta.set(c, (conta.get(c) || 0) + 1); }
  const top = [...conta.entries()].sort((x, y) => y[1] - x[1])[0];
  return top ? top[0] : `G${g.groupId}`;
}

const VARIANT_ORDER = ["Normal", "Foil"];
const pick = (map, names) => { for (const n of names) { if (map.get(n) > 0) return map.get(n); } return 0; };

// Produto da TCGCSV -> { card, price }. `by` = Map(subTypeName -> USD).
export function cardOf(p, g, setId, setTotal, by = new Map()) {
  const id = `ws-${p.productId}`;
  const price = {};
  const u = pick(by, ["Normal", "Foil"]);
  const uf = pick(by, ["Foil"]);
  if (u) price.u = u;
  if (uf) price.uf = uf;
  const variants = VARIANT_ORDER.filter((v) => by.has(v));
  const traits = [ext(p, "Trait"), ext(p, "Trait 2")].filter((s) => s && s !== "-");
  const card = {
    id,
    name: p.name,
    set: g.name,
    setId,
    number: numberOf(ext(p, "Number")),
    setTotal,
    setReleaseDate: (g.publishedOn || "").slice(0, 10),
    rarity: ext(p, "Rarity"),
    artist: "",
    language: "en",
    image: `https://tcgplayer-cdn.tcgplayer.com/product/${p.productId}_in_1000x1000.jpg`,
    variants: variants.length ? variants : ["Normal"],
    cardType: ext(p, "CardType") || null,   // Character / Event / Climax
    // Cor (Yellow/Green/Red/Blue): `color` é o nome que o índice de busca e o
    // editor de decks esperam (COLOR_FIELDS no sync-common).
    color: ext(p, "Color") || null,
    level: num(ext(p, "Level")),
    cost: num(ext(p, "Cost")),
    power: num(ext(p, "Power")),
    soul: num(ext(p, "Soul")),
    traits: traits.length ? traits.join(";") : null,
    trigger: ext(p, "Triggers") || null
  };
  return { card, price: Object.keys(price).length ? price : null };
}

async function run() {
  console.log("Weiß Schwarz: buscando sets (TCGCSV cat. 20)…");
  const groups = await api("/groups");
  console.log(`  ${groups.length} grupos.`);

  const cards = [];
  const pricing = {}; // { id: { u } } — USD market do TCGplayer

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

    // Carta = produto com "Number"; o resto é selado (booster, display, deck).
    const setCards = products.filter((p) => ext(p, "Number"));
    if (!setCards.length) { console.log(`  ${g.groupId} ${g.name}: 0 cartas (só selados ou pré-venda)`); continue; }

    const setId = setIdOf(g, setCards.map((p) => ext(p, "Number")));
    if (!ABREV_FIXA[g.groupId]) console.warn(`  AVISO: grupo novo sem pin (${g.groupId} ${g.name}) -> setId "${setId}". Pinar em ABREV_FIXA antes de publicar.`);
    for (const p of setCards) {
      const { card, price } = cardOf(p, g, setId, setCards.length, priceBy.get(p.productId));
      cards.push(card);
      if (price) pricing[card.id] = price;
    }
    console.log(`  ${setId} ${g.name}: ${setCards.length} cartas`);
  }

  const prev = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const merged = cards.concat(preserveMissingCards(prev, cards));

  merged.sort((a, b) =>
    String(a.setReleaseDate).localeCompare(String(b.setReleaseDate))
    || a.setId.localeCompare(b.setId)
    || a.number.localeCompare(b.number, undefined, { numeric: true })
    || a.id.localeCompare(b.id));
  console.log(`Total: ${merged.length} cartas, ${Object.keys(pricing).length} com preço.`);

  // setLogo: logo curado em data/weiss/set-logos/ quando existe (ver
  // cabeçalho); senão VAZIO e o front desenha o nome do set.
  const localLogo = (setId) => {
    const file = `${winSafeName(setId)}.webp`;
    return existsSync(new URL(`set-logos/${file}`, OUT)) ? `data/weiss/set-logos/${file}` : "";
  };
  for (const c of merged) { c.setLogo = localLogo(c.setId); }

  const bySet = new Map();
  for (const c of merged) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c.id); }
  const indexes = {
    sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)),
    artists: []
  };

  await writeGameCatalog(OUT, { cards: merged, indexes, pricing, webDir: "data/weiss/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} (cards/indexes/pricing + manifest/chunks).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
