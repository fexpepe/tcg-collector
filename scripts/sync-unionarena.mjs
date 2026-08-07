// Catálogo do Union Arena (Bandai, 2024 — o TCG que junta vários animes: Bleach,
// Hunter x Hunter, Chainsaw Man, Jujutsu Kaisen…) a partir da TCGCSV
// (tcgcsv.com), espelho público diário do TCGplayer — categoria 81.
// Mesmo padrão do Riftbound/Digimon: catálogo inteiro em data/unionarena/
// (cards.js versionado = durabilidade; ~78 sets / ~6,5k cartas, escala média).
//
// Identidade: id = "ua-<productId>". Imagens: CDN do TCGplayer (_in_1000x1000),
// host já liberado na CSP e no SW. Acabamentos: Normal / Foil (u/uf).
//
// Cada SET é um anime ("SeriesName"), e o mesmo IP volta em sets diferentes —
// por isso a série vai no card como campo próprio, e não só no nome do set: é
// por ela que se navega o jogo. Cuidado: o set de promos (UEPR) mistura várias
// séries, então SeriesName é por CARTA, nunca por set.
//
// Nota: existe um jogo `hxh` no site (Carddass vintage do Hunter x Hunter). Os
// sets de HxH daqui são do Union Arena e vivem neste catálogo — sem colisão de
// id, porque os prefixos são diferentes.
//
//   node scripts/sync-unionarena.mjs
import { fileURLToPath } from "node:url";
import { writeGameCatalog, readGlobalVar, preserveMissingCards } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/unionarena/", ROOT);
const API = "https://tcgcsv.com/tcgplayer/81";
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
// Gatilho: só a PALAVRA-CHAVE entre colchetes ("[Draw] Draw a card." -> "Draw").
// O texto inteiro é regra de carta — nenhum sync do site guarda isso, e aqui
// somariam ~250 KB ao cards.js por um texto que a tela não usa. A keyword, sim:
// é atributo curto e vira faceta.
const triggerKeyword = (s) => {
  const m = String(s || "").match(/^\s*\[([^\]]+)\]/);
  return m ? m[1].trim() : "";
};

const VARIANT_ORDER = ["Normal", "Foil"];
const pick = (map, names) => { for (const n of names) { if (map.get(n) > 0) return map.get(n); } return 0; };

async function run() {
  console.log("Union Arena: buscando sets (TCGCSV cat. 81)…");
  const groups = listOf(await api("/groups"));
  console.log(`  ${groups.length} sets.`);

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

    const setCards = products.filter((p) => ext(p, "Number"));
    if (!setCards.length) { console.log(`  ${g.abbreviation || g.groupId} ${g.name}: 0 cartas (só selados)`); continue; }

    const setId = g.abbreviation || String(g.groupId);
    const release = (g.publishedOn || "").slice(0, 10);
    for (const p of setCards) {
      const id = `ua-${p.productId}`;
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
        // (COLOR_FIELDS no sync-common); no Union Arena a cor é a energia de
        // ativação (Purple/Green/Red…), o mesmo papel da tinta do Lorcana.
        color: ext(p, "ActivationEnergy") || null,
        cost: num(ext(p, "RequiredEnergy")),
        ap: num(ext(p, "ActionPointCost")),
        bp: ext(p, "BattlePointBP") || null,     // "3000+" existe: string, não número
        energy: ext(p, "GeneratedEnergy") || null,
        series: ext(p, "SeriesName") || null,
        trigger: triggerKeyword(ext(p, "Trigger")) || null
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

  // setLogo: VAZIO quando o set nao tem logo proprio (politica unica do site) —
  // o front desenha o NOME do set como titulo (.set-logo-placeholder).
  for (const c of merged) { c.setLogo = ""; }

  const bySet = new Map();
  for (const c of merged) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c.id); }
  const indexes = {
    sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)),
    artists: []
  };

  await writeGameCatalog(OUT, { cards: merged, indexes, pricing, webDir: "data/unionarena/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} (cards/indexes/pricing + manifest/chunks).`);
}

await run();
