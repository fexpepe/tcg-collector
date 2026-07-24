// Catálogo do Yu-Gi-Oh! (Konami) a partir da TCGCSV (tcgcsv.com), espelho público
// diário do TCGplayer — categoria 2. É o MAIOR catálogo do site (~653 sets /
// ~46 mil impressões), então segue o padrão MAGIC de durabilidade: os CHUNKS por
// set (data/ygo/sets/) são versionados; o monolito cards.js (dezenas de MB) NÃO
// vai pro git nem pro deploy (o Cloudflare Pages recusa arquivo > 25 MiB) — é
// regenerado no build e o cliente carrega só o manifest + chunks sob demanda.
//
// Identidade: id = "ygo-<productId>" (estável e único; o "Number" tipo CORI-EN001
// repete entre edições/reprints). Imagens: CDN do TCGplayer (_in_1000x1000).
//
// EDIÇÕES: o Yu-Gi-Oh não tem "foil" no schema de preço — tem EDIÇÃO (1st
// Edition / Unlimited / Limited / Normal). O slot `u` recebe o preço da edição
// canônica (1st Edition > Unlimited > Limited > Normal); as `variants` preservam
// as edições presentes pra a coleção distinguir. (A raridade — Common/Super/
// Ultra/Secret… — vive no campo `rarity`, ortogonal à edição.)
//
//   node scripts/sync-ygo.mjs
import { fileURLToPath } from "node:url";
import { writeGameCatalog, readGlobalVar, preserveMissingCards } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/ygo/", ROOT);
const API = "https://tcgcsv.com/tcgplayer/2";
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

const EDITION_ORDER = ["1st Edition", "Unlimited", "Limited", "Normal"];
const pick = (map, names) => { for (const n of names) { if (map.get(n) > 0) return map.get(n); } return 0; };

async function run() {
  console.log("Yu-Gi-Oh!: buscando sets (TCGCSV cat. 2)…");
  const groups = listOf(await api("/groups"));
  console.log(`  ${groups.length} sets.`);

  const cards = [];
  const pricing = {}; // { id: { u } } — USD market do TCGplayer (edição canônica)

  let done = 0;
  for (const g of groups) {
    await sleep(90);
    let products, prices;
    try {
      products = listOf(await api(`/${g.groupId}/products`));
      prices = listOf(await api(`/${g.groupId}/prices`));
    } catch (e) {
      console.warn(`  ${g.abbreviation || g.groupId} ${g.name}: erro ${e.message} (pulado)`);
      continue;
    }
    const priceBy = new Map(); // productId -> Map(edição -> USD)
    for (const p of prices) {
      const v = Number(p.marketPrice) > 0 ? p.marketPrice : (Number(p.midPrice) > 0 ? p.midPrice : 0);
      if (v <= 0) continue;
      if (!priceBy.has(p.productId)) priceBy.set(p.productId, new Map());
      priceBy.get(p.productId).set(p.subTypeName, r2(v));
    }

    const setCards = products.filter((p) => ext(p, "Number"));
    if (!setCards.length) continue;

    const setId = g.abbreviation || String(g.groupId);
    const release = (g.publishedOn || "").slice(0, 10);
    for (const p of setCards) {
      const id = `ygo-${p.productId}`;
      const by = priceBy.get(p.productId) || new Map();
      const u = pick(by, EDITION_ORDER);
      if (u) pricing[id] = { u };

      const present = new Set(by.keys());
      const variants = EDITION_ORDER.filter((v) => present.has(v));
      cards.push({
        id,
        name: p.name,
        set: g.name,
        setId,
        number: ext(p, "Number"),
        setTotal: setCards.length,
        setReleaseDate: release,
        rarity: ext(p, "Rarity"),
        artist: "", // o TCGplayer não expõe ilustrador do Yu-Gi-Oh
        language: "en", // TCGplayer cataloga a linha EN (o OCG japonês é jogo à parte)
        image: `https://tcgplayer-cdn.tcgplayer.com/product/${p.productId}_in_1000x1000.jpg`,
        variants: variants.length ? variants : ["Normal"],
        cardType: ext(p, "Card Type") || null,
        attribute: ext(p, "Attribute") || null,
        monsterType: ext(p, "MonsterType") || null,
        atk: ext(p, "Attack") || null,
        def: ext(p, "Defense") || null
      });
    }
    if (++done % 50 === 0) console.log(`  …${done}/${groups.length} sets · ${cards.length} cartas até agora`);
  }
  console.log(`  ${done} sets processados.`);

  // União preservadora: carta que sumiu do espelho fica (do cards.js anterior).
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

  await writeGameCatalog(OUT, { cards: merged, indexes, pricing, webDir: "data/ygo/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} (cards/indexes/pricing + manifest/chunks).`);
}

await run();
