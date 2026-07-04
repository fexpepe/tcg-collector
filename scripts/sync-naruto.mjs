// Catálogo do Naruto a partir da TCGCSV (dados públicos do TCGplayer) — mesmo
// modelo do One Piece moderno. A Bandai anunciou o novo Naruto card game; quando
// o TCGplayer listar, a TCGCSV ganha a categoria e este sync passa a funcionar.
// Também serve pro Naruto CCG clássico (Bandai, ~2006), se a categoria existir.
//
//   node scripts/sync-naruto.mjs --discover        # lista categorias com "naruto"
//   node scripts/sync-naruto.mjs --category <id>   # sincroniza a categoria
//
// Enquanto não há categoria, o jogo fica com o catálogo vazio (tile "Em breve").
// O vintage Carddass do Naruto entrará pelo padrão snapshot
// (data/vintage/naruto-carddass.json) quando a checklist for levantada.
import { fetchRetry, mapLimit, writeGameCatalog, slug } from "./lib/sync-common.mjs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/naruto/", ROOT);
const BASE = "https://tcgcsv.com/tcgplayer";
const HEADERS = { "User-Agent": "Sleevu (sleevu.app) catalog sync" };

const argAt = (flag) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : null; };
const json = async (url) => (await fetchRetry(url, { headers: HEADERS })).json();

if (process.argv.includes("--discover")) {
  const cats = (await json(`${BASE}/categories`)).results || [];
  const hits = cats.filter((c) => /naruto/i.test(c.name || "") || /naruto/i.test(c.displayName || ""));
  console.log(hits.length ? "Categorias com 'naruto' na TCGCSV:" : "Nenhuma categoria 'naruto' na TCGCSV ainda.");
  hits.forEach((c) => console.log(`  ${c.categoryId} - ${c.name}`));
  process.exit(0);
}

const CATEGORY = argAt("--category") || process.env.NARUTO_TCGCSV_CATEGORY;
if (!CATEGORY) {
  console.log("Sem categoria definida (use --discover, depois --category <id> ou NARUTO_TCGCSV_CATEGORY). Catálogo mantido como está.");
  process.exit(0);
}

console.log(`Naruto: sincronizando TCGCSV categoria ${CATEGORY}…`);
const groups = (await json(`${BASE}/${CATEGORY}/groups`)).results || [];
console.log(`  ${groups.length} sets.`);

const cards = [];
const pricing = {};
await mapLimit(groups, 4, async (g) => {
  const [prods, prices] = await Promise.all([
    json(`${BASE}/${CATEGORY}/${g.groupId}/products`).then((r) => r.results || []),
    json(`${BASE}/${CATEGORY}/${g.groupId}/prices`).then((r) => r.results || []).catch(() => [])
  ]);
  const priceByProduct = new Map();
  for (const p of prices) {
    const cur = priceByProduct.get(p.productId);
    if (!cur || (p.marketPrice || 0) > (cur.marketPrice || 0)) priceByProduct.set(p.productId, p);
  }
  for (const p of prods) {
    const ext = Object.fromEntries((p.extendedData || []).map((e) => [e.name, e.value]));
    if (/pack|box|deck|case|bundle|tin/i.test(p.name) && !ext.Number) continue; // produto selado, não carta
    const id = `nrt-${p.productId}`;
    cards.push({
      id,
      name: p.cleanName || p.name,
      set: g.name,
      setId: `nrt-${slug(g.abbreviation || g.name)}`,
      number: ext.Number || "",
      setTotal: "",
      setReleaseDate: (g.publishedOn || "").slice(0, 10),
      rarity: ext.Rarity || "",
      artist: "",
      language: "en",
      image: p.imageUrl ? p.imageUrl.replace(/_\d+x\d+/, "_in_1000x1000") : "",
      variants: ["Normal"],
      setLogo: "",
      cardType: ext.CardType || ext.Type || null
    });
    const mp = priceByProduct.get(p.productId);
    if (mp && mp.marketPrice > 0) pricing[id] = { u: Math.round(mp.marketPrice * 100) / 100 };
  }
});

cards.sort((a, b) => a.setId.localeCompare(b.setId) || String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
await writeGameCatalog(OUT, { cards, pricing });
console.log(`Gravado em ${fileURLToPath(OUT)} — ${cards.length} cartas, ${Object.keys(pricing).length} com preço.`);
