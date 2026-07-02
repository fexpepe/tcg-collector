// Catálogo do One Piece Card Game (Bandai) a partir da TCGCSV (tcgcsv.com),
// que republica diariamente os dados públicos do TCGplayer (categoria 68):
// sets ("groups"), cartas ("products") e preços de mercado em USD. Arquivos
// estáticos, sem API key. Roda no BUILD (e dá pra rodar local).
//
// Como o Lorcana, o One Piece é pequeno o bastante (~8k cartas) pra gerar o
// catálogo INTEIRO (sem chunks/manifest): um window.TCG_CARDS completo em
// data/onepiece/, que o loadCatalog do shared.js consome direto.
//
// Identidade da carta: o TCGplayer repete o "Number" (OP01-001) entre a arte
// base e as alt-arts (produtos separados), então o id do catálogo é o
// productId (estável e único): "op-<productId>". O campo `number` guarda o
// código oficial pra exibição/checklist.
//
// Imagens: CDN do TCGplayer (tcgplayer-cdn.tcgplayer.com, já liberado na CSP
// e no SW por causa das cartas JP da PPT). _in_1000x1000 = alta resolução.
//
//   node scripts/sync-onepiece.mjs
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/onepiece/", ROOT);
const API = "https://tcgcsv.com/tcgplayer/68";
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
// "Portgas.D.Ace (001)" -> "Portgas.D.Ace" (o número já vai no campo number;
// sufixos informativos tipo "(Alternate Art)"/"(Manga)" ficam no nome).
const cleanName = (name) => String(name).replace(/\s*\(\d{2,4}\)\s*/g, " ").replace(/\s{2,}/g, " ").trim();

async function run() {
  console.log("One Piece: buscando sets (TCGCSV cat. 68)…");
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
    // Preço por produto e acabamento (subTypeName: Normal | Foil).
    const priceBy = new Map();
    for (const p of prices) {
      const v = Number(p.marketPrice) > 0 ? p.marketPrice : (Number(p.midPrice) > 0 ? p.midPrice : 0);
      if (v > 0) priceBy.set(`${p.productId}|${p.subTypeName}`, r2(v));
    }

    // Cartas = produtos com "Number" no extendedData (o resto é selado: caixas,
    // packs, decks — não entram no catálogo de colecionáveis).
    const setCards = products.filter((p) => ext(p, "Number"));
    if (!setCards.length) { console.log(`  ${g.abbreviation || g.groupId} ${g.name}: 0 cartas (só selados)`); continue; }

    const setId = g.abbreviation || String(g.groupId);
    const release = (g.publishedOn || "").slice(0, 10);
    for (const p of setCards) {
      const id = `op-${p.productId}`;
      const normal = priceBy.get(`${p.productId}|Normal`);
      const foil = priceBy.get(`${p.productId}|Foil`);
      const pr = {};
      if (normal) pr.u = normal;
      if (foil) pr.uf = foil;
      if (!pr.u && pr.uf) pr.u = pr.uf; // só-foil: foil vira a referência
      if (Object.keys(pr).length) pricing[id] = pr;

      cards.push({
        id,
        name: cleanName(p.name),
        set: g.name,
        setId,
        number: ext(p, "Number"),
        setTotal: setCards.length,
        setReleaseDate: release,
        rarity: ext(p, "Rarity"),
        artist: "", // o TCGplayer não expõe ilustrador do One Piece
        language: "en",
        image: `https://tcgplayer-cdn.tcgplayer.com/product/${p.productId}_in_1000x1000.jpg`,
        variants: foil && normal ? ["Normal", "Foil"] : (foil && !normal ? ["Foil"] : ["Normal"]),
        // extras do One Piece (detalhe/busca futura; pequenos):
        opColor: ext(p, "Color") || null,
        cardType: ext(p, "CardType") || null,
        cost: ext(p, "Cost") || null,
        power: ext(p, "Power") || null
      });
    }
    console.log(`  ${setId} ${g.name}: ${setCards.length} cartas`);
  }

  // Ordena por set e número oficial (OP16-001 < OP16-002 < ... < OP16-118).
  cards.sort((a, b) => a.setId.localeCompare(b.setId) || a.number.localeCompare(b.number, undefined, { numeric: true }) || a.id.localeCompare(b.id));
  console.log(`Total: ${cards.length} cartas, ${Object.keys(pricing).length} com preço.`);

  // setLogo: o TCGplayer não tem logo de set — usa a arte da 1ª carta (o líder
  // costuma abrir o set) como capa, mesmo fallback final do Lorcana.
  const coverBySet = {};
  for (const c of cards) { if (!coverBySet[c.setId]) coverBySet[c.setId] = c.image; }
  for (const c of cards) { c.setLogo = coverBySet[c.setId] || ""; }

  // Índices no formato { name, cardIds } (páginas Sets/Artistas). Sem artistas:
  // o TCGplayer não expõe ilustrador, então o índice fica vazio e a página de
  // Artistas não lista nada pro One Piece.
  const bySet = new Map();
  for (const c of cards) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c.id); }
  const indexes = {
    sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)),
    artists: []
  };

  await mkdir(OUT, { recursive: true });
  const wlabel = async (name, varname, value) => {
    await writeFile(new URL(name, OUT), `window.${varname} = ${JSON.stringify(value)};\n`, "utf8");
  };
  await wlabel("cards.js", "TCG_CARDS", cards);
  await wlabel("manifest.generated.js", "TCG_CARDS", cards); // modo prod do game.js
  await wlabel("indexes.js", "TCG_INDEXES", indexes);
  await wlabel("indexes.generated.js", "TCG_INDEXES", indexes);
  await wlabel("pricing.js", "TCG_PRICING", pricing);
  await wlabel("pricing.generated.js", "TCG_PRICING", pricing);
  console.log(`Gravado em ${fileURLToPath(OUT)} (cards/indexes/pricing + .generated).`);
}

await run();
