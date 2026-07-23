// Catálogo do Gundam Card Game (Bandai) a partir da TCGCSV (tcgcsv.com),
// espelho público diário do TCGplayer — categoria 86: sets ("groups"), cartas
// ("products") e preços de mercado em USD. Sem API key. Mesmo padrão do One
// Piece/FAB: catálogo inteiro em data/gundam/ (cards.js versionado = durabilidade;
// ~22 sets, escala pequena).
//
// Identidade da carta: id = "gcg-<productId>" (estável e único; o "Number"
// oficial tipo GD01-001 pode repetir entre arte base e reprint/promo). Imagens:
// CDN do TCGplayer (_in_1000x1000), host já liberado na CSP e no SW.
//
// ACABAMENTOS: o Gundam tem preço em Normal / Holofoil (o par que o schema de
// preço do site já trata em 2 slots): u = Normal (ou Holofoil se só houver
// foil), uf = Holofoil. As variantes preservam o subTypeName, então a coleção
// distingue Normal de Holofoil.
//
//   node scripts/sync-gundam.mjs
import { fileURLToPath } from "node:url";
import { writeGameCatalog, readGlobalVar, preserveMissingCards } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/gundam/", ROOT);
const API = "https://tcgcsv.com/tcgplayer/86";
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

const VARIANT_ORDER = ["Normal", "Holofoil"];
const pick = (map, names) => { for (const n of names) { if (map.get(n) > 0) return map.get(n); } return 0; };

async function run() {
  console.log("Gundam: buscando sets (TCGCSV cat. 86)…");
  const groups = listOf(await api("/groups"));
  console.log(`  ${groups.length} sets.`);

  const cards = [];
  const pricing = {}; // { id: { u, uf } } — USD market do TCGplayer

  for (const g of groups) {
    await sleep(120); // educado com o espelho comunitário
    let products, prices;
    try {
      products = listOf(await api(`/${g.groupId}/products`));
      prices = listOf(await api(`/${g.groupId}/prices`));
    } catch (e) {
      console.warn(`  ${g.abbreviation || g.groupId} ${g.name}: erro ${e.message} (pulado)`);
      continue;
    }
    const priceBy = new Map(); // productId -> Map(subType -> USD)
    for (const p of prices) {
      const v = Number(p.marketPrice) > 0 ? p.marketPrice : (Number(p.midPrice) > 0 ? p.midPrice : 0);
      if (v <= 0) continue;
      if (!priceBy.has(p.productId)) priceBy.set(p.productId, new Map());
      priceBy.get(p.productId).set(p.subTypeName, r2(v));
    }

    // Cartas = produtos com "Number" (o resto é selado: decks, boxes, boosters).
    const setCards = products.filter((p) => ext(p, "Number"));
    if (!setCards.length) { console.log(`  ${g.abbreviation || g.groupId} ${g.name}: 0 cartas (só selados)`); continue; }

    const setId = g.abbreviation || String(g.groupId);
    const release = (g.publishedOn || "").slice(0, 10);
    for (const p of setCards) {
      const id = `gcg-${p.productId}`;
      const by = priceBy.get(p.productId) || new Map();
      const pr = {};
      const u = pick(by, ["Normal", "Holofoil"]);
      const uf = pick(by, ["Holofoil"]);
      if (u) pr.u = u;
      if (uf) pr.uf = uf;
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
        artist: "", // o TCGplayer não expõe ilustrador do Gundam
        language: "en", // o TCGplayer cataloga a linha EN
        image: `https://tcgplayer-cdn.tcgplayer.com/product/${p.productId}_in_1000x1000.jpg`,
        variants: variants.length ? variants : ["Normal"],
        // extras do Gundam (detalhe/busca futura; pequenos):
        cardType: ext(p, "CardType") || null,
        color: ext(p, "Color") || null,
        level: ext(p, "Level") || null,
        cost: ext(p, "Cost") || null
      });
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

  // setLogo: arte da 1ª carta do set (sem logos de set públicos por ora).
  const coverBySet = {};
  for (const c of merged) { if (!coverBySet[c.setId]) coverBySet[c.setId] = c.image; }
  for (const c of merged) { c.setLogo = coverBySet[c.setId] || ""; }

  const bySet = new Map();
  for (const c of merged) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c.id); }
  const indexes = {
    sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)),
    artists: []
  };

  await writeGameCatalog(OUT, { cards: merged, indexes, pricing, webDir: "data/gundam/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} (cards/indexes/pricing + manifest/chunks).`);
}

await run();
