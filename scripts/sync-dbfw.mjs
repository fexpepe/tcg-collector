// Catálogo do Dragon Ball Super Card Game FUSION WORLD (Bandai) a partir da
// TCGCSV (tcgcsv.com), espelho público diário do TCGplayer — categoria 80.
// ATENÇÃO: 80 é o Fusion World (2024+), distinto do clássico "Masters" (cat 27)
// e do DBZ TCG (cat 23). Mesmo padrão do One Piece/FAB: catálogo inteiro em
// data/dbfw/ (cards.js versionado = durabilidade).
//
// Identidade: id = "dbfw-<productId>" (estável e único; o "Number" FB01-066
// repete entre a arte base e as reprints/alt-art, que a TCGCSV traz em grupos
// próprios "…Alternate Art Reprints"/"…Release Event Cards" — cada uma vira
// carta própria pelo productId). Imagens: CDN do TCGplayer (_in_1000x1000).
//
// ACABAMENTOS: Normal / Holofoil (2 slots do schema): u = Normal (ou Holofoil
// se só houver foil — comum nas alt-art), uf = Holofoil.
//
//   node scripts/sync-dbfw.mjs
import { fileURLToPath } from "node:url";
import { writeGameCatalog, readGlobalVar, preserveMissingCards } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/dbfw/", ROOT);
const API = "https://tcgcsv.com/tcgplayer/80";
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
  console.log("DBFW: buscando sets (TCGCSV cat. 80)…");
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
    const priceBy = new Map();
    for (const p of prices) {
      const v = Number(p.marketPrice) > 0 ? p.marketPrice : (Number(p.midPrice) > 0 ? p.midPrice : 0);
      if (v <= 0) continue;
      if (!priceBy.has(p.productId)) priceBy.set(p.productId, new Map());
      priceBy.get(p.productId).set(p.subTypeName, r2(v));
    }

    // Cartas = produtos com "Number" (o resto é selado: boosters, starters, boxes).
    const setCards = products.filter((p) => ext(p, "Number"));
    if (!setCards.length) { console.log(`  ${g.abbreviation || g.groupId} ${g.name}: 0 cartas (só selados)`); continue; }

    const setId = g.abbreviation || String(g.groupId);
    const release = (g.publishedOn || "").slice(0, 10);
    for (const p of setCards) {
      const id = `dbfw-${p.productId}`;
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
        artist: "", // o TCGplayer não expõe ilustrador do Fusion World
        language: "en", // o TCGplayer cataloga a linha EN (existe JP, fora do TCGCSV)
        image: `https://tcgplayer-cdn.tcgplayer.com/product/${p.productId}_in_1000x1000.jpg`,
        variants: variants.length ? variants : ["Normal"],
        cardType: ext(p, "CardType") || null,
        color: ext(p, "Color") || null,
        cost: ext(p, "Cost") || null
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

  const coverBySet = {};
  for (const c of merged) { if (!coverBySet[c.setId]) coverBySet[c.setId] = c.image; }
  for (const c of merged) { c.setLogo = coverBySet[c.setId] || ""; }

  const bySet = new Map();
  for (const c of merged) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c.id); }
  const indexes = {
    sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)),
    artists: []
  };

  await writeGameCatalog(OUT, { cards: merged, indexes, pricing, webDir: "data/dbfw/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} (cards/indexes/pricing + manifest/chunks).`);
}

await run();
