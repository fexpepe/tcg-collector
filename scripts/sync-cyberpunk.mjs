// Catálogo do Cyberpunk TCG (Weird Co., licença da CD PROJEKT RED,
// 2026) a partir da TCGCSV (tcgcsv.com), espelho público diário do TCGplayer —
// categoria 92, linha `cyberpunk-tcg` (conferidas em 30/09/2026). Mesmo padrão
// do Star Wars/Union Arena: catálogo inteiro em data/cyberpunk/ (cards.js
// versionado = durabilidade; ~12 sets / ~460 cartas no lançamento).
//
// Identidade: id = "cpk-<productId>" (`cp-` colide com o Lorcana: cp-6).
// Imagens: CDN do TCGplayer (_in_1000x1000 = 716×1000), host já liberado na
// CSP e no SW e já coberto pelo espelho R2. Acabamentos: Normal / Foil (u/uf).
//
// DUAS EDIÇÕES do mesmo set: a "Beta" (a do Kickstarter, 10/09/2026, números
// B001…) e a "Retail" (varejo, 06/11/2026, números 001…). São produtos
// diferentes no TCGplayer, com preço próprio — viram sets separados, como as
// edições de outros jogos. As alt-arts ("Adam Smasher - Ender of Legends
// (Epic)") também são produtos próprios e viram cartas separadas, como o
// Hyperspace do Star Wars.
//
// Pré-venda: em 30/09/2026 a edição Retail estava em pré-venda, sem preço e
// quase sem raridade, e o próprio TCGplayer avisa que nome e raridade podem
// mudar até o lançamento. O id vem do productId, então não muda; nome e
// raridade se corrigem sozinhos no build seguinte.
//
// setId: a TCGCSV deixou a abreviação VAZIA em 8 dos 13 grupos, e sem pin o
// setId viraria "G<groupId>" (é o que o sync-swu faz). Como setId publicado
// não muda nunca (URL, logo, régua do lint), os códigos legíveis ficam FIXOS
// pelo groupId aqui, antes da primeira publicação — o pin vale mais que a
// abreviação que a fonte vier a preencher. Grupo novo sem pin cai na
// abreviação, ou em "G<groupId>" se ela vier vazia (e aí vale pinar ANTES do
// primeiro deploy que o publica).
//
// Logo de set: o único publicado é o do "Welcome to Night City" (página
// cyberpunktcg.com/marketing-materials, seção "Logo", 30/09/2026 — PNG
// oficial 1880×1679, recortado e salvo em webp 462×400). Vale pras duas
// edições: o setId da Beta é o da Retail com "-B", e o logo é procurado pelo
// código base. Starters, promos e eventos não têm logo próprio e mostram o
// NOME (política única do site).
//
//   node scripts/sync-cyberpunk.mjs
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { writeGameCatalog, readGlobalVar, preserveMissingCards, winSafeName, fetchJsonRetry, sleep } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/cyberpunk/", ROOT);
const API = "https://tcgcsv.com/tcgplayer/92";
const UA = "Sleevu (sleevu.app) catalog sync";

// groupId -> setId (ver cabeçalho). Beta = código da Retail + "-B".
export const ABREV_FIXA = {
  24855: "WNC", 24845: "WNC-B",   // Welcome to Night City (Retail / Beta)
  24858: "EP", 24846: "EP-B",     // Embracing Power — Starter Deck
  24859: "TH", 24847: "TH-B",     // The Heist — Starter Deck
  24857: "BT", 24848: "BT-B",     // Box Toppers
  24860: "PR1",                   // Set 1 Promos
  24880: "PRR",                   // Pre-Release Beta (abreviação da fonte)
  24884: "NCB01",                 // Night City Brawl Season 1 (idem)
  24883: "EOR01"                  // Edgerunner Open Season 1 (idem)
};

const listOf = (j) => (j && Array.isArray(j.results)) ? j.results : [];
const api = async (path) => listOf(await fetchJsonRetry(`${API}${path}`, { headers: { "User-Agent": UA, Accept: "application/json" } }));

const r2 = (x) => Math.round(x * 100) / 100;
export const ext = (p, key) => {
  const d = (p.extendedData || []).find((e) => e.name === key);
  return d && d.value != null ? String(d.value).trim() : "";
};
// Número da TCGCSV vem string, às vezes com zero à esquerda ("02"). Sem valor
// -> null (e não 0, que no histograma de custo do editor viraria uma coluna
// falsa em zero). Poder com "+" ("4+": ganha poder em jogo) fica como texto.
const num = (s) => (/^\d+$/.test(s) ? Number(s) : null);
const power = (s) => (/^\d+$/.test(s) ? Number(s) : (s || null));

export function setIdOf(g, abbrCount) {
  if (ABREV_FIXA[g.groupId]) return ABREV_FIXA[g.groupId];
  const a = String(g.abbreviation || "").trim();
  if (!a) return `G${g.groupId}`;
  return abbrCount && abbrCount.get(a) > 1 ? `${a}-${g.groupId}` : a;
}

// Arquivo de logo procurado pro set: o próprio setId e, na edição Beta, o
// código base (WNC-B -> WNC).
export const logoCandidates = (setId) => {
  const base = String(setId).replace(/-B$/, "");
  return [...new Set([setId, base])].map((s) => `${winSafeName(s)}.webp`);
};

const VARIANT_ORDER = ["Normal", "Foil"];
const pick = (map, names) => { for (const n of names) { if (map.get(n) > 0) return map.get(n); } return 0; };

// Produto da TCGCSV -> { card, price }. `by` = Map(subTypeName -> USD).
export function cardOf(p, g, setId, setTotal, by = new Map()) {
  const id = `cpk-${p.productId}`;
  const price = {};
  const u = pick(by, ["Normal", "Foil"]);
  const uf = pick(by, ["Foil"]);
  if (u) price.u = u;
  if (uf) price.uf = uf;
  const variants = VARIANT_ORDER.filter((v) => by.has(v));
  const ram = /^x?(\d+)$/i.exec(ext(p, "RAM"));
  const card = {
    id,
    name: p.name,
    set: g.name,
    setId,
    number: ext(p, "Number"),
    setTotal,
    setReleaseDate: (g.publishedOn || "").slice(0, 10),
    rarity: ext(p, "Rarity"),
    artist: "",
    language: "en",
    image: `https://tcgplayer-cdn.tcgplayer.com/product/${p.productId}_in_1000x1000.jpg`,
    variants: variants.length ? variants : ["Normal"],
    cardType: ext(p, "CardType") || null,
    // Cor do jogo (Red/Blue/Green/Yellow): `color` é o nome que o índice de
    // busca e o editor de decks esperam (COLOR_FIELDS no sync-common).
    color: ext(p, "Color") || null,
    cost: num(ext(p, "Cost")),
    power: power(ext(p, "Power")),
    ram: ram ? Number(ram[1]) : null,
    tags: ext(p, "Tags") || null
  };
  return { card, price: Object.keys(price).length ? price : null };
}

async function run() {
  console.log("Cyberpunk TCG: buscando sets (TCGCSV cat. 92)…");
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

    // Carta = produto com "Number"; o resto é selado (booster, display, kit).
    const setCards = products.filter((p) => ext(p, "Number"));
    if (!setCards.length) { console.log(`  ${g.groupId} ${g.name}: 0 cartas (só selados)`); continue; }

    const setId = setIdOf(g, abbrCount);
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

  // setLogo: logo oficial curado em data/cyberpunk/set-logos/ quando existe
  // (ver cabeçalho); senão VAZIO e o front desenha o nome do set.
  const localLogo = (setId) => {
    const file = logoCandidates(setId).find((f) => existsSync(new URL(`set-logos/${f}`, OUT)));
    return file ? `data/cyberpunk/set-logos/${file}` : "";
  };
  for (const c of merged) { c.setLogo = localLogo(c.setId); }

  const bySet = new Map();
  for (const c of merged) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c.id); }
  const indexes = {
    sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)),
    artists: []
  };

  await writeGameCatalog(OUT, { cards: merged, indexes, pricing, webDir: "data/cyberpunk/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} (cards/indexes/pricing + manifest/chunks).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
