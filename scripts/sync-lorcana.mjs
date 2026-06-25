// Catálogo do Disney Lorcana a partir da Lorcast (api.lorcast.com, comunitária).
// Roda no BUILD (e dá pra rodar local). O Lorcana é pequeno (~2-3k cartas), então
// geramos o catálogo INTEIRO (sem o esquema de chunks/manifest do Pokémon): um
// window.TCG_CARDS completo, que o loadCatalog do shared.js consome direto.
//
// Saída em data/lorcana/: cards.js, indexes.js, pricing.js (+ cópias .generated
// pro modo produção do game.js). Estrutura espelha a do Pokémon pro frontend
// (game-aware da Fase 0) renderizar igual.
//
//   node scripts/sync-lorcana.mjs
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/lorcana/", ROOT);
const API = "https://api.lorcast.com/v0";
const UA = "Sleevu (sleevu.app) catalog sync";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`${API}${path}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (r.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status} em ${path}`);
    return r.json();
  }
  throw new Error(`429 repetido em ${path}`);
}
const listOf = (j) => Array.isArray(j) ? j : (j.results || j.cards || j.data || []);

// "Ariel" + "On Human Legs" -> "Ariel - On Human Legs" (nome completo do Lorcana).
function cardName(c) {
  const v = (c.version || "").trim();
  return v ? `${c.name} - ${v}` : c.name;
}

// Logo do set: a Lorcast NÃO serve logo/capa de set. O MushuReport (wiki
// MediaWiki da comunidade Lorcana) tem todos como "<Nome do Set> logo.png".
// Baixamos o thumb (500px, via iiurlwidth) e hospedamos LOCAL em
// data/lorcana/set-logos/<code>.png (mesmo padrão dos dados do Pokémon: baixa no
// build, serve do próprio site). Retorna o caminho relativo ao site, ou null se
// o set não tiver logo no wiki (promos/sets novos) — aí o chamador cai pra arte
// da 1ª carta. Nunca derruba o sync (try/catch -> null).
const LOGOS_DIR = new URL("set-logos/", OUT);
const WIKI_API = "https://wiki.mushureport.com/api.php";
async function fetchSetLogo(setName, code) {
  try {
    const u = new URL(WIKI_API);
    u.search = new URLSearchParams({
      action: "query", titles: `File:${setName} logo.png`,
      prop: "imageinfo", iiprop: "url", iiurlwidth: "500", format: "json"
    }).toString();
    const r = await fetch(u, { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const j = await r.json();
    const pg = Object.values((j.query && j.query.pages) || {})[0];
    const ii = pg && pg.imageinfo && pg.imageinfo[0];
    const thumb = ii && (ii.thumburl || ii.url);
    if (!thumb) return null; // página inexistente = set sem logo no wiki
    const img = await fetch(thumb, { headers: { "User-Agent": UA } });
    if (!img.ok) return null;
    const buf = Buffer.from(await img.arrayBuffer());
    if (buf.length < 200 || buf.slice(1, 4).toString() !== "PNG") return null; // não é PNG
    await mkdir(LOGOS_DIR, { recursive: true });
    await writeFile(new URL(`${code}.png`, LOGOS_DIR), buf);
    return `data/lorcana/set-logos/${code}.png`;
  } catch (e) {
    console.warn(`  logo ${code} (${setName}): ${e.message}`);
    return null;
  }
}

// Logo genérico da Lorcana (MushuReport: File:Lorcana.png) — fallback pros sets
// SEM logo próprio no wiki (Promo Set, Challenge, coleções especiais), no lugar
// da arte de uma carta aleatória. Salvo em set-logos/_lorcana.png. Retorna o
// caminho relativo, ou null (aí cai pra arte da carta).
async function fetchBrandLogo() {
  try {
    const u = new URL(WIKI_API);
    u.search = new URLSearchParams({
      action: "query", titles: "File:Lorcana.png", prop: "imageinfo", iiprop: "url", format: "json"
    }).toString();
    const r = await fetch(u, { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const j = await r.json();
    const pg = Object.values((j.query && j.query.pages) || {})[0];
    const ii = pg && pg.imageinfo && pg.imageinfo[0];
    const src = ii && ii.url;
    if (!src) return null;
    const img = await fetch(src, { headers: { "User-Agent": UA } });
    if (!img.ok) return null;
    const buf = Buffer.from(await img.arrayBuffer());
    if (buf.length < 200 || buf.slice(1, 4).toString() !== "PNG") return null;
    await mkdir(LOGOS_DIR, { recursive: true });
    await writeFile(new URL("_lorcana.png", LOGOS_DIR), buf);
    return "data/lorcana/set-logos/_lorcana.png";
  } catch (e) { console.warn(`  brand logo: ${e.message}`); return null; }
}

async function run() {
  console.log("Lorcana: buscando sets…");
  const sets = listOf(await api("/sets"));
  console.log(`  ${sets.length} sets.`);

  const cards = [];
  const pricing = {}; // { id: { u: usd } } — preço de referência (Lorcast)
  for (const s of sets) {
    await sleep(250); // educado com a API comunitária
    let raw;
    try { raw = listOf(await api(`/sets/${s.id}/cards`)); }
    catch (e) { console.warn(`  ${s.code}: erro ${e.message} (pulado)`); continue; }
    const total = raw.length;
    for (const c of raw) {
      if ((c.lang || "en") !== "en") continue;
      const img = c.image_uris && c.image_uris.digital;
      const id = `${s.code}-${c.collector_number}`;
      const r2 = (x) => Math.round(x * 100) / 100;
      // Enchanted/Iconic são alt-art SÓ foil (não têm versão Normal). As demais
      // têm Normal + Foil. Preço por acabamento: u = usd (normal), uf = usd_foil.
      const pr = c.prices || {};
      const usd = Number(pr.usd) > 0 ? r2(Number(pr.usd)) : 0;
      const usdFoil = Number(pr.usd_foil) > 0 ? r2(Number(pr.usd_foil)) : 0;
      const foilOnly = /enchanted|iconic/i.test(c.rarity || "");
      const p = {};
      if (usd) p.u = usd;
      if (usdFoil) p.uf = usdFoil;
      if (!p.u && p.uf) p.u = p.uf; // fallback p/ a referência única (ex.: só-foil)
      if (Object.keys(p).length) pricing[id] = p;
      cards.push({
        id,
        name: cardName(c),
        set: s.name,
        setId: s.code,
        number: String(c.collector_number),
        setTotal: total,
        setReleaseDate: s.released_at || "",
        rarity: c.rarity || "",
        artist: (c.illustrators && c.illustrators[0]) || "",
        language: "en",
        image: img ? (img.large || img.normal || img.small) : null,
        variants: foilOnly ? ["Foil"] : ["Normal", "Foil"],
        // extras do Lorcana (pra detalhe/busca futura; pequenos):
        ink: c.ink || (Array.isArray(c.inks) ? c.inks.join("/") : null) || null,
        cost: c.cost != null ? c.cost : null,
        cardType: Array.isArray(c.type) ? c.type.join("/") : (c.type || null)
      });
    }
    console.log(`  ${s.code} ${s.name}: ${total} cartas`);
  }

  cards.sort((a, b) => a.setId.localeCompare(b.setId) || (Number(a.number) || 0) - (Number(b.number) || 0));
  console.log(`Total: ${cards.length} cartas.`);

  // Logo de set: baixa do MushuReport pra cada set (hospeda local). Sets sem
  // logo no wiki (promos/novos) caem pra arte da 1ª carta.
  console.log("Lorcana: baixando logos de set (MushuReport)…");
  const brandLogo = await fetchBrandLogo();
  console.log(brandLogo ? "  logo genérico da Lorcana ✓ (fallback dos promos)" : "  logo genérico indisponível (fallback = arte da carta)");
  const logoBySet = {};
  for (const s of sets) {
    const path = await fetchSetLogo(s.name, s.code);
    if (path) { logoBySet[s.code] = path; console.log(`  ${s.code} ${s.name}: logo ✓`); }
    else console.log(`  ${s.code} ${s.name}: sem logo próprio (usa o logo da Lorcana)`);
    await sleep(120);
  }

  // setLogo: logo próprio do set quando existe; senão o logo genérico da Lorcana
  // (promos/challenge); e só em último caso a arte da 1ª carta do set.
  const coverBySet = {};
  for (const c of cards) { if (c.image && !coverBySet[c.setId]) coverBySet[c.setId] = c.image; }
  for (const c of cards) { c.setLogo = logoBySet[c.setId] || brandLogo || coverBySet[c.setId] || ""; }

  // Índices (sets, artists) no formato { name, cardIds } — o frontend usa nas
  // páginas Sets e Artistas. (Sem pokedex/trainers: não existem no Lorcana.)
  const groupBy = (keyFn) => {
    const m = new Map();
    for (const c of cards) { const k = keyFn(c); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(c.id); }
    return [...m.entries()].map(([name, cardIds]) => ({ name, cardIds }))
      .sort((a, b) => a.name.localeCompare(b.name));
  };
  const indexes = {
    sets: groupBy((c) => c.set),
    artists: groupBy((c) => c.artist || "Artista desconhecido")
  };

  await mkdir(OUT, { recursive: true });
  const wlabel = async (name, varname, value) => {
    const js = `window.${varname} = ${JSON.stringify(value)};\n`;
    await writeFile(new URL(name, OUT), js, "utf8");
  };
  await wlabel("cards.js", "TCG_CARDS", cards);
  await wlabel("manifest.generated.js", "TCG_CARDS", cards); // modo prod do game.js
  await wlabel("indexes.js", "TCG_INDEXES", indexes);
  await wlabel("indexes.generated.js", "TCG_INDEXES", indexes);
  await wlabel("pricing.js", "TCG_PRICING", pricing);
  await wlabel("pricing.generated.js", "TCG_PRICING", pricing);
  console.log(`Gravado em ${fileURLToPath(OUT)} (cards/indexes/pricing + .generated).`);
}

run().catch((e) => { console.error("Falhou:", e); process.exit(1); });
