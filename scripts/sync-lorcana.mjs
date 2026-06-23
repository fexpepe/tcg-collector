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
      // Enchanted/Iconic (cartas-chave) são SÓ foil: têm usd_foil, não usd. Usa
      // usd quando existe, senão usd_foil (senão a carta mais cara fica sem preço).
      const pr = c.prices || {};
      const usd = Number(pr.usd) > 0 ? Number(pr.usd) : (Number(pr.usd_foil) > 0 ? Number(pr.usd_foil) : 0);
      if (usd > 0) pricing[id] = { u: Math.round(usd * 100) / 100 };
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
        variants: ["Normal", "Foil"],
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
