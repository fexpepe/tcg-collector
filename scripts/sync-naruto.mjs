// NARUTO CARD GAME (Bandai, lançamento mundial 2027) — o jogo NOVO, que vive na
// LINHA nrt-ncg- do catálogo do Naruto (o principal, sem prefixo, é o CCG
// vintage 2002–2006 do sync-naruto-vintage.mjs). Duas fontes:
//
//   1. CURADORIA manual (abaixo): promos de evento que existem antes de o jogo
//      chegar às lojas — ex.: a Chakra Card da Gen Con 2026, a PRIMEIRA carta
//      do jogo. Imagens locais em assets/cards/naruto/ (scan recortado).
//   2. TCGCSV (dados públicos do TCGplayer), mesmo modelo do One Piece moderno:
//      quando o TCGplayer listar o jogo, a TCGCSV ganha a categoria e este sync
//      passa a puxar os sets de verdade (defina NARUTO_TCGCSV_CATEGORY).
//
//   node scripts/sync-naruto.mjs                    # curadoria (+ TCGCSV se houver categoria)
//   node scripts/sync-naruto.mjs --discover         # lista categorias com "naruto"
//   node scripts/sync-naruto.mjs --category <id>    # sincroniza a categoria
//
// ANEXA ao catálogo (mantém o vintage e as demais linhas): regrava só o que é
// nrt-ncg-. Atenção ao dedupe futuro: quando a TCGCSV listar as promos de
// evento, a versão curada (id nrt-ncg-cp-001, imagem própria) deve ceder ou
// absorver a do productId — decidir na hora, os ids são pegajosos.
import { fetchRetry, mapLimit, readGlobalVar, writeGameCatalog, slug } from "./lib/sync-common.mjs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/naruto/", ROOT);
const BASE = "https://tcgcsv.com/tcgplayer";
const HEADERS = { "User-Agent": "Sleevu (sleevu.app) catalog sync" };

// ── Curadoria: promos que antecedem o lançamento ─────────────────────────────
// CP-001 "Chakra Card -Gen Con 2026 Ver.-" — a primeira carta do jogo, dada nas
// sessões de tutorial da Gen Con 2026 (Indianápolis, 30/07–02/08/2026), antes
// do lançamento mundial de 2027. Naruto & Sasuke na arte; carta de recurso
// ("When using Chakra, turn this card face-down."). Scan próprio, recortado.
const CURATED = [
  {
    id: "nrt-ncg-cp-001",
    name: "Chakra Card -Gen Con 2026 Ver.-",
    set: "Promotion Cards",
    setId: "nrt-ncg-promo",
    number: "CP-001",
    setTotal: 1,
    setReleaseDate: "2026-07-30",
    rarity: "",
    artist: "",
    language: "en",
    image: "/assets/cards/naruto/nrt-ncg-cp-001.webp",
    variants: ["Normal"],
    setLogo: "/assets/games/game_naruto_2027.webp",
    cardType: "Chakra"
  }
];

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
const line = [...CURATED];
const pricingNew = {};

if (!CATEGORY) {
  console.log(`Naruto (novo): sem categoria TCGCSV ainda — só a curadoria (${CURATED.length} carta(s)).`);
} else {
  console.log(`Naruto (novo): sincronizando TCGCSV categoria ${CATEGORY}…`);
  const groups = (await json(`${BASE}/${CATEGORY}/groups`)).results || [];
  console.log(`  ${groups.length} sets.`);
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
      const id = `nrt-ncg-${p.productId}`;
      line.push({
        id,
        name: p.cleanName || p.name,
        set: g.name,
        setId: `nrt-ncg-${slug(g.abbreviation || g.name)}`,
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
      if (mp && mp.marketPrice > 0) pricingNew[id] = { u: Math.round(mp.marketPrice * 100) / 100 };
    }
  });
}

line.sort((a, b) => a.setId.localeCompare(b.setId) || String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));

// Anexa: mantém tudo que NÃO é desta linha (vintage nrt-*, Miracle Battle
// nrt-mb-*, Data Carddass nrt-dc-* etc.) e regrava só a nrt-ncg-.
const existing = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
const kept = existing.filter((c) => c && !/^nrt-ncg-/.test(String(c.id)));
const have = new Set(kept.map((c) => c.id));
const merged = kept.concat(line.filter((c) => !have.has(c.id)));
// Preço: preserva o que existe (vintage não tem, mas não custa) + os novos.
const pricingOld = (await readGlobalVar(new URL("pricing.js", OUT), "TCG_PRICING")) || {};
const pricing = Object.assign({}, pricingOld, pricingNew);

await writeGameCatalog(OUT, { cards: merged, pricing, webDir: "data/naruto/" });
console.log(`Gravado em ${fileURLToPath(OUT)} — ${merged.length} cartas totais (${line.length} na linha nova), ${Object.keys(pricing).length} com preço.`);
