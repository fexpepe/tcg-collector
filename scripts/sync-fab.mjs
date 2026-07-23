// Catálogo do Flesh and Blood (Legend Story Studios) a partir da TCGCSV
// (tcgcsv.com), espelho público diário do TCGplayer — categoria 62: sets
// ("groups"), cartas ("products") e preços de mercado em USD. Sem API key.
// Mesmo padrão do One Piece: catálogo inteiro em data/fab/ (cards.js
// versionado = durabilidade; ~100 sets, escala pequena).
//
// Identidade da carta: id = "fab-<productId>" (estável e único; o "Number"
// oficial tipo MON000 repete entre arte base e reprints). Imagens: CDN do
// TCGplayer (_in_1000x1000), host já liberado na CSP e no SW.
//
// ACABAMENTOS: o FAB tem até 6 preços por carta (1st Edition / Unlimited ×
// Normal / Rainbow Foil / Cold Foil). O schema de preço do site tem 2 slots
// (u = normal, uf = foil, escolhido pelo /foil/i do nome da variante), então:
//   u  = "Normal" > "Unlimited Edition Normal" > "1st Edition Normal"
//   uf = Rainbow Foil (Unlimited > 1st) > Cold Foil — o Rainbow é o foil mais
//        comum; o COLD FOIL (raro e caro) fica APROXIMADO por este slot até o
//        schema ganhar preço por variante. Limitação conhecida e aceita na v1.
// As variantes em si preservam o subTypeName completo do TCGplayer, então a
// coleção distingue 1st/Unlimited/Cold — só o preço de referência é que
// compartilha o slot.
//
// Sem logo de set: a LSS não expõe logos transparentes por set em página
// pública estável (diferente da Bandai) — setLogo cai na arte da 1ª carta.
//
//   node scripts/sync-fab.mjs
import { fileURLToPath } from "node:url";
import { writeGameCatalog, readGlobalVar, preserveMissingCards } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/fab/", ROOT);
const API = "https://tcgcsv.com/tcgplayer/62";
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

// Ordem canônica de exibição das variantes (o que existir do produto).
const VARIANT_ORDER = [
  "Normal", "1st Edition Normal", "Unlimited Edition Normal",
  "Rainbow Foil", "1st Edition Rainbow Foil", "Unlimited Edition Rainbow Foil",
  "Cold Foil", "1st Edition Cold Foil", "Unlimited Edition Cold Foil"
];
const pick = (map, names) => { for (const n of names) { if (map.get(n) > 0) return map.get(n); } return 0; };

async function run() {
  console.log("FAB: buscando sets (TCGCSV cat. 62)…");
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
    // Preço por produto e acabamento (subTypeName completo do FAB).
    const priceBy = new Map(); // productId -> Map(subType -> USD)
    for (const p of prices) {
      const v = Number(p.marketPrice) > 0 ? p.marketPrice : (Number(p.midPrice) > 0 ? p.midPrice : 0);
      if (v <= 0) continue;
      if (!priceBy.has(p.productId)) priceBy.set(p.productId, new Map());
      priceBy.get(p.productId).set(p.subTypeName, r2(v));
    }

    // Cartas = produtos com "Number" (o resto é selado: boosters, decks, kits).
    const setCards = products.filter((p) => ext(p, "Number"));
    if (!setCards.length) { console.log(`  ${g.abbreviation || g.groupId} ${g.name}: 0 cartas (só selados)`); continue; }

    const setId = g.abbreviation || String(g.groupId);
    const release = (g.publishedOn || "").slice(0, 10);
    for (const p of setCards) {
      const id = `fab-${p.productId}`;
      const by = priceBy.get(p.productId) || new Map();
      const pr = {};
      const u = pick(by, ["Normal", "Unlimited Edition Normal", "1st Edition Normal"]);
      const uf = pick(by, [
        "Rainbow Foil", "Unlimited Edition Rainbow Foil", "1st Edition Rainbow Foil",
        "Cold Foil", "1st Edition Cold Foil", "Unlimited Edition Cold Foil"
      ]);
      if (u) pr.u = u;
      if (uf) pr.uf = uf;
      if (!pr.u && pr.uf) pr.u = pr.uf; // só-foil: foil vira a referência
      if (Object.keys(pr).length) pricing[id] = pr;

      const present = new Set(by.keys());
      const variants = VARIANT_ORDER.filter((v) => present.has(v));
      cards.push({
        id,
        name: p.name.replace(/\s*\((?:Rainbow|Cold) Foil\)\s*/gi, " ").replace(/\s{2,}/g, " ").trim(),
        set: g.name,
        setId,
        number: ext(p, "Number"),
        setTotal: setCards.length,
        setReleaseDate: release,
        rarity: ext(p, "Rarity"),
        artist: "", // o TCGplayer não expõe ilustrador do FAB
        language: "en", // a LSS só imprime em inglês desde 2022
        image: `https://tcgplayer-cdn.tcgplayer.com/product/${p.productId}_in_1000x1000.jpg`,
        variants: variants.length ? variants : ["Normal"],
        // extras do FAB (detalhe/busca futura; pequenos):
        cardType: ext(p, "CardType") || null,
        pitch: ext(p, "Pitch Value") || null,
        talent: ext(p, "Talent") || null
      });
    }
    console.log(`  ${setId} ${g.name}: ${setCards.length} cartas`);
  }

  // União preservadora: carta que sumiu do espelho fica (do cards.js anterior).
  const prev = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const merged = cards.concat(preserveMissingCards(prev, cards));

  // Ordena por data de lançamento, set e número oficial (MON000 < MON001…).
  merged.sort((a, b) =>
    String(a.setReleaseDate).localeCompare(String(b.setReleaseDate))
    || a.setId.localeCompare(b.setId)
    || a.number.localeCompare(b.number, undefined, { numeric: true })
    || a.id.localeCompare(b.id));
  console.log(`Total: ${merged.length} cartas, ${Object.keys(pricing).length} com preço.`);

  // setLogo: arte da 1ª carta do set (a LSS não tem logos públicos por set).
  const coverBySet = {};
  for (const c of merged) { if (!coverBySet[c.setId]) coverBySet[c.setId] = c.image; }
  for (const c of merged) { c.setLogo = coverBySet[c.setId] || ""; }

  // Índices { name, cardIds } (página Sets; Artistas fica vazio como no OP).
  const bySet = new Map();
  for (const c of merged) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c.id); }
  const indexes = {
    sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)),
    artists: []
  };

  await writeGameCatalog(OUT, { cards: merged, indexes, pricing, webDir: "data/fab/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} (cards/indexes/pricing + manifest/chunks).`);
}

await run();
