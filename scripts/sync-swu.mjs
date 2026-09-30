// Catálogo do Star Wars: Unlimited (Fantasy Flight Games, 2024) a partir da
// TCGCSV (tcgcsv.com), espelho público diário do TCGplayer — categoria 79.
// Mesmo padrão do Union Arena/Riftbound: catálogo inteiro em data/swu/
// (cards.js versionado = durabilidade; ~33 sets / ~9k cartas, escala média).
//
// Identidade: id = "swu-<productId>". Imagens: CDN do TCGplayer (_in_1000x1000),
// host já liberado na CSP e no SW e já coberto pelo espelho R2
// (scripts/mirror-r2.mjs lê o catálogo pelo d1-catalogo). Acabamentos:
// Normal / Foil (u/uf).
//
// Hyperspace e Showcase são PRODUTOS separados no TCGplayer ("Luke Skywalker -
// Faithful Friend (Hyperspace)"), com número e preço próprios — então viram
// cartas separadas, como as alt-arts do One Piece (decisão do Fernando,
// 2026-09-30). No Spark of Rebellion são 275 base + 259 Hyperspace + 16
// Showcase: o set mostra 550 cartas, e o % completo conta as variantes.
//
// setId = abreviação do grupo na TCGCSV (SOR, SHD, TWI…), que é também o
// código oficial do set — é por ele que o mirror-swu-set-logos.mjs casa o logo.
// Cuidado: a TCGCSV REPETE abreviação ("P26" em dois grupos de promo de 2026) e
// deixa outras vazias (GenCon 2023, Gamegenic); nesses casos o setId leva o
// groupId junto, senão os dois grupos cairiam no mesmo chunk.
//
//   node scripts/sync-swu.mjs
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { writeGameCatalog, readGlobalVar, preserveMissingCards, winSafeName } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/swu/", ROOT);
const API = "https://tcgcsv.com/tcgplayer/79";
const UA = "Sleevu (sleevu.app) catalog sync";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`${API}${path}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (r.status === 429 || r.status >= 500) { await sleep(1500 * (attempt + 1)); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status} em ${path}`);
    return r.json();
  }
  throw new Error(`retries esgotados em ${path}`);
}
const listOf = (j) => (j && Array.isArray(j.results)) ? j.results : [];

const r2 = (x) => Math.round(x * 100) / 100;
const ext = (p, key) => {
  const d = (p.extendedData || []).find((e) => e.name === key);
  return d ? String(d.value) : "";
};
// Campo numérico da TCGCSV: vem string ("0", "3"). Sem valor -> null (e não 0,
// que no histograma de custo do editor viraria uma coluna falsa em zero).
const num = (s) => (s !== "" && Number.isFinite(Number(s)) ? Number(s) : null);
// Aspecto: a TCGCSV manda "Vigilance;Heroism" (às vezes com espaço ou vírgula).
// Normaliza pro ";" que as facetas e o COLOR_FIELDS do índice já entendem.
const aspects = (s) => String(s || "").split(/[;,]/).map((x) => x.trim()).filter(Boolean).join(";");

const VARIANT_ORDER = ["Normal", "Foil"];
const pick = (map, names) => { for (const n of names) { if (map.get(n) > 0) return map.get(n); } return 0; };

async function run() {
  console.log("Star Wars: Unlimited: buscando sets (TCGCSV cat. 79)…");
  const groups = listOf(await api("/groups"));
  console.log(`  ${groups.length} sets.`);

  // Abreviações repetidas ou vazias -> setId com o groupId (ver cabeçalho).
  const abbrCount = new Map();
  for (const g of groups) { const a = String(g.abbreviation || "").trim(); if (a) abbrCount.set(a, (abbrCount.get(a) || 0) + 1); }
  const setIdOf = (g) => {
    const a = String(g.abbreviation || "").trim();
    if (!a) return `G${g.groupId}`;
    return abbrCount.get(a) > 1 ? `${a}-${g.groupId}` : a;
  };

  const cards = [];
  const pricing = {}; // { id: { u, uf } } — USD market do TCGplayer

  for (const g of groups) {
    await sleep(120);
    let products, prices;
    try {
      products = listOf(await api(`/${g.groupId}/products`));
      prices = listOf(await api(`/${g.groupId}/prices`));
    } catch (e) {
      console.warn(`  ${g.abbreviation || g.groupId} ${g.name}: erro ${e.message} (pulado)`);
      continue;
    }
    const priceBy = new Map();
    for (const p of prices) {
      const v = Number(p.marketPrice) > 0 ? p.marketPrice : (Number(p.midPrice) > 0 ? p.midPrice : 0);
      if (v <= 0) continue;
      if (!priceBy.has(p.productId)) priceBy.set(p.productId, new Map());
      priceBy.get(p.productId).set(p.subTypeName, r2(v));
    }

    // Carta = produto com "Number"; o resto é selado (booster, display, starter).
    const setCards = products.filter((p) => ext(p, "Number"));
    if (!setCards.length) { console.log(`  ${g.abbreviation || g.groupId} ${g.name}: 0 cartas (só selados)`); continue; }

    const setId = setIdOf(g);
    const release = (g.publishedOn || "").slice(0, 10);
    for (const p of setCards) {
      const id = `swu-${p.productId}`;
      const by = priceBy.get(p.productId) || new Map();
      const pr = {};
      const u = pick(by, ["Normal", "Foil"]);
      const uf = pick(by, ["Foil"]);
      if (u) pr.u = u;
      if (uf) pr.uf = uf;
      if (!pr.u && pr.uf) pr.u = pr.uf;
      if (Object.keys(pr).length) pricing[id] = pr;

      const present = new Set(by.keys());
      const variants = VARIANT_ORDER.filter((v) => present.has(v));
      cards.push({
        id,
        name: p.name,
        set: g.name,
        setId,
        number: ext(p, "Number"),
        setTotal: setCards.length,
        setReleaseDate: release,
        rarity: ext(p, "Rarity"),
        artist: "",
        language: "en",
        image: `https://tcgplayer-cdn.tcgplayer.com/product/${p.productId}_in_1000x1000.jpg`,
        variants: variants.length ? variants : ["Normal"],
        cardType: ext(p, "CardType") || null,
        // `color` é o nome que o índice de busca e o editor de decks esperam
        // (COLOR_FIELDS no sync-common); no Star Wars a "cor" é o ASPECTO
        // (Vigilance/Command/Aggression/Cunning/Heroism/Villainy).
        color: aspects(ext(p, "Aspect")) || null,
        cost: num(ext(p, "Cost")),
        power: num(ext(p, "Power")),
        hp: num(ext(p, "HP")),
        arena: ext(p, "Arena Type") || null,
        traits: ext(p, "Traits") || null
      });
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

  // setLogo: o logo OFICIAL espelhado em data/swu/set-logos/<setId>.webp
  // (mirror-swu-set-logos.mjs, a partir do site da FFG) quando existe; senão
  // VAZIO — política única do site: o front desenha o NOME do set como título
  // (.set-logo-placeholder). Os grupos de promo (Weekly Play, Judge…) não têm
  // logo próprio e ficam com o nome.
  const localLogo = (setId) => {
    const file = `${winSafeName(setId)}.webp`;
    return existsSync(new URL(`set-logos/${file}`, OUT)) ? `data/swu/set-logos/${file}` : "";
  };
  for (const c of merged) { c.setLogo = localLogo(c.setId); }

  const bySet = new Map();
  for (const c of merged) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c.id); }
  const indexes = {
    sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)),
    artists: []
  };

  await writeGameCatalog(OUT, { cards: merged, indexes, pricing, webDir: "data/swu/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} (cards/indexes/pricing + manifest/chunks).`);
}

await run();
