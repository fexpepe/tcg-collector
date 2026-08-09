// Magic: The Gathering via Scryfall — catálogo + preços + imagens numa fonte só.
//
//   node scripts/sync-magic.mjs                  # completo (todos os sets de papel)
//   node scripts/sync-magic.mjs --sets mh3,fdn   # só sets específicos (teste local)
//   node scripts/sync-magic.mjs --no-fetch       # rebuild só dos chunks versionados
//
// Por que Scryfall: grátis, sem chave, bulk/API abertos, e o objeto da carta já
// traz os preços de mercado (TCGplayer USD + Cardmarket EUR) e as imagens —
// nenhuma outra API (nem paga) é necessária. Regras deles: <10 req/s e
// User-Agent identificado (respeitados abaixo).
//
// DURABILIDADE — padrão POKÉMON, não One Piece: um cards.js de Magic teria
// ~30MB e viraria um blob novo no git a cada mudança semanal (inflação real).
// Em vez disso, os chunks data/magic/sets/*.json são VERSIONADOS (delta = só
// os sets que mudaram) e cards.js/indexes/pricing/manifest são artefatos
// regenerados no build (gitignored). O sync SEMPRE parte dos chunks
// versionados: fetch falhou = catálogo congela, nada some.
//
// ESCOPO v1: só inglês. O acervo pt-BR do Scryfall (39,5k impressões até
// Modern Horizons 3, jun/2024, quando a WotC parou de imprimir em português)
// entra numa fase 2 — exige o modelo de merge multi-idioma do Pokémon (chunks
// por idioma pro filtro global de idioma de carta não esvaziar a listagem).
//
// Sets excluídos por tipo: tokens, memorabilia (art series/oversized),
// minigame, alchemy/treasure_chest (digitais) e vanguard — não são cartas que
// se colecionam no fichário. Promos/Secret Lair/Un-sets FICAM (colecionáveis).
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fetchRetry, mapLimit, sleep, writeGameCatalog, preserveMissingCards, winSafeName } from "./lib/sync-common.mjs";

const API = "https://api.scryfall.com";
const HEADERS = { "User-Agent": "Sleevu/1.0 (https://sleevu.app)", Accept: "application/json" };
const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/magic/", ROOT);
const CHUNKS = new URL("data/magic/sets/", ROOT);
const CACHE = new URL("data/.cache/magic/", ROOT);
// Versão do FORMATO da carta gravada no cache. O cache guarda a carta já
// transformada (não a resposta crua), então mudar o shape do makeCard sem
// invalidar deixaria os sets estáveis (card_count igual) presos no formato
// antigo pra sempre. Bump obrigatório a cada campo novo/renomeado.
//   v2: campos de deck (cardType, manaCost, cost, color, colorId).
//   v3: `treat` — tratamento/acabamento da impressão (o "sub-set" que o
//       TCGplayer mostra: Extended Art, Borderless, Showcase, Surge Foil…),
//       usado pela faceta "Seleção" na página do set.
const CACHE_VERSION = 3;

const argv = process.argv.slice(2);
const NO_FETCH = argv.includes("--no-fetch");
const onlyArg = (() => {
  const eq = argv.find((a) => a.startsWith("--sets="));
  if (eq) return eq.slice(7);
  const i = argv.indexOf("--sets");
  return i >= 0 ? argv[i + 1] : "";
})();
const ONLY = new Set((onlyArg || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));

const EXCLUDE_SET_TYPES = new Set(["token", "memorabilia", "minigame", "alchemy", "vanguard", "treasure_chest"]);
const SKIP_LAYOUTS = new Set(["art_series", "token", "double_faced_token", "emblem"]);

const r2 = (x) => Math.round(x * 100) / 100;
const num = (v) => { const n = Number(v); return n > 0 ? r2(n) : 0; };

// Throttle GLOBAL: reserva um slot a cada 200ms pra TODAS as requisições
// somadas (~5 req/s, metade do limite do Scryfall — a concorrência do mapLimit
// só sobrepõe a latência de rede). E 429 ganha resfriamento LONGO: o Scryfall
// bloqueia temporariamente quem insiste, então 1-3s de backoff não resolvem.
let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + 200;
  if (wait) await sleep(wait);
}
async function api(path) {
  for (let attempt = 0; ; attempt++) {
    await throttle();
    try {
      const r = await fetchRetry(`${API}${path}`, { headers: HEADERS, tries: 2 });
      return await r.json();
    } catch (e) {
      if (String(e.message || "").includes("429") && attempt < 5) {
        console.warn("  429 do Scryfall — esfriando 30s…");
        await sleep(30000);
        continue;
      }
      throw e;
    }
  }
}

// Chunks versionados = base da união preservadora (e do --no-fetch).
async function readChunkCards() {
  try {
    const files = (await readdir(CHUNKS)).filter((f) => f.endsWith(".json"));
    const all = [];
    for (const f of files) {
      try { all.push(...JSON.parse(await readFile(new URL(f, CHUNKS), "utf8"))); } catch { /* chunk corrompido: pula */ }
    }
    return all;
  } catch { return []; }
}

// "123★" -> "123s", "A-25†" -> "a-25d" — id estável e único por set+número.
function numSlug(collectorNumber) {
  return String(collectorNumber || "").toLowerCase()
    .replace(/★/g, "s").replace(/†/g, "d").replace(/Φ/g, "p")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
}

function makeCard(c, set, usedIds, pricing) {
  if (c.digital || c.oversized || SKIP_LAYOUTS.has(c.layout)) return null;
  const base = `mtg-${set.code}-${numSlug(c.collector_number)}`;
  let id = base, n = 2;
  while (usedIds.has(id)) id = `${base}-${n++}`;
  usedIds.add(id);

  const faces = Array.isArray(c.card_faces) ? c.card_faces : [];
  const img = (c.image_uris && c.image_uris.normal) || (faces[0] && faces[0].image_uris && faces[0].image_uris.normal) || "";

  const fin = Array.isArray(c.finishes) ? c.finishes : [];
  const variants = [];
  if (fin.includes("nonfoil")) variants.push("Normal");
  if (fin.includes("foil")) variants.push("Foil");
  if (fin.includes("etched")) variants.push("Etched");
  if (!variants.length) variants.push("Normal");

  const p = c.prices || {};
  const pr = {};
  if (num(p.usd)) pr.u = num(p.usd);
  const foil = num(p.usd_foil) || num(p.usd_etched);
  if (foil) pr.uf = foil;
  if (!pr.u && pr.uf) pr.u = pr.uf; // só-foil: foil vira a referência
  // eur_foil como fallback do EUR: serializadas caras (borderless/box topper)
  // muitas vezes SÓ têm cotação foil no Cardmarket — sem isto ficavam sem
  // preço nenhum (ex.: Smaug borderless €450 aparecia como "—").
  if (num(p.eur) || num(p.eur_foil)) pr.e = num(p.eur) || num(p.eur_foil);
  if (Object.keys(pr).length) pricing[id] = pr;

  // Campos de DECK (construtor de decks). O Scryfall já mandou tudo isto na mesma
  // resposta — só não era gravado. Nomes alinhados com os outros jogos pra engine
  // de decks ser genérica: `cardType` (= type_line), `cost` (= cmc, numérico, vira
  // a curva) e `color` (";"-joined, como no Digimon/Gundam).
  // Carta de duas faces (transform/modal): o topo vem vazio — cai pra 1ª face.
  const face0 = faces[0] || {};
  const cardType = c.type_line || face0.type_line || "";
  const manaCost = c.mana_cost || face0.mana_cost || "";
  const colors = Array.isArray(c.colors) ? c.colors : (Array.isArray(face0.colors) ? face0.colors : []);
  // color_identity é sempre do card inteiro (as duas faces somadas) — é o que
  // Commander usa pra legalidade, então guardamos separado das cores de custo.
  const colorId = Array.isArray(c.color_identity) ? c.color_identity : [];

  const card = {
    id,
    name: c.name,
    set: set.name,
    setId: set.code,
    number: String(c.collector_number || ""),
    setTotal: set.card_count,
    setReleaseDate: set.released_at || "",
    rarity: c.rarity || "",
    artist: c.artist || "",
    language: "en",
    image: img,
    variants,
    // Símbolo de set: SVG local espelhado (mirror-magic-set-logos.mjs) quando
    // existe; senão o ícone remoto do Scryfall (degrada gracioso). winSafeName:
    // códigos como "con" (Conspiracy) viram con_.svg (reservado no Windows).
    setLogo: existsSync(new URL(`set-logos/${winSafeName(set.code)}.svg`, OUT))
      ? `data/magic/set-logos/${winSafeName(set.code)}.svg`
      : (set.icon_svg_uri || "")
  };

  // Só grava o que existe: campo vazio em ~100k cartas viraria peso morto no
  // catálogo (que é servido em chunks).
  if (cardType) card.cardType = cardType;
  if (manaCost) card.manaCost = manaCost;
  if (typeof c.cmc === "number") card.cost = c.cmc;
  if (colors.length) card.color = colors.join(";");
  if (colorId.length) card.colorId = colorId.join(";");

  // TRATAMENTO da impressão — é o que o TCGplayer vende como "sub-set" do set
  // ("The Hobbit (Extended Art)", "(Borderless)", "(Surge Foil)"…). No Scryfall
  // não existe um campo só: sai de frame_effects + borda + arte cheia +
  // promo_types. Guardamos os tokens CRUS do Scryfall, ";"-joined: a UI traduz
  // os que conhece e prettifica os que não conhece — então um efeito NOVO num
  // set futuro aparece na faceta sozinho, sem mexer no código.
  // DENYLIST: promo_types traz também marcas de EVENTO (prerelease, promo
  // datestamped/stamped…), que não são tratamento visual — virariam lixo na
  // lista. frame_effects e os demais entram inteiros.
  const PROMO_NOISE = new Set(["boosterfun", "prerelease", "datestamped", "stamped", "promo", "setpromo", "buyabox", "planeswalkerdeck", "beginnerbox", "starterdeck", "release", "jpwalker"]);
  const treats = [];
  (Array.isArray(c.frame_effects) ? c.frame_effects : []).forEach((f) => treats.push(String(f)));
  if (c.border_color === "borderless") treats.push("borderless");
  if (c.full_art) treats.push("fullart");
  (Array.isArray(c.promo_types) ? c.promo_types : []).forEach((p) => {
    const tok = String(p);
    if (!PROMO_NOISE.has(tok)) treats.push(tok);
  });
  const treat = [...new Set(treats)].filter(Boolean);
  if (treat.length) card.treat = treat.join(";");

  return card;
}

// VALIDADE do cache: o card_count pega mudança de ESTRUTURA, mas preço muda
// todo dia com o count parado — só ele deixava o preço congelado no dia do
// primeiro fetch (o CI restaura data/.cache entre builds; o Hobbit ficou
// semanas com preço de pré-venda). Regra: set lançado há <120 dias (ou
// pré-venda) re-busca SEMPRE (preço de spoiler despenca na primeira semana);
// os demais entram numa rotação semanal determinística por código do set —
// ~1/7 dos sets por dia, todo preço fica no máximo 7 dias defasado e o cron
// diário segue leve (~115 sets em vez de ~800). Sem estado extra: perder um
// build só adia aquele 1/7 pra semana seguinte.
const hashCode = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
function cacheStillFresh(set) {
  const rel = Date.parse(set.released_at || "");
  const ageDays = Number.isNaN(rel) ? Infinity : (Date.now() - rel) / 86400000;
  if (ageDays < 120) return false; // pré-venda/recém-lançado: preço diário
  return hashCode(set.code) % 7 !== Math.floor(Date.now() / 86400000) % 7;
}

// Busca as cartas de UM set (paginado), com cache incremental: o cache vale
// enquanto o card_count não mudar E o preço não estiver vencido (ver
// cacheStillFresh — o cache guarda cartas e preços juntos).
async function fetchSetCards(set, pricing, usedIds) {
  const cacheFile = new URL(`${set.code}.json`, CACHE);
  try {
    const cached = JSON.parse(await readFile(cacheFile, "utf8"));
    if (cached && cached.v === CACHE_VERSION && cached.count === set.card_count && Array.isArray(cached.cards) && cacheStillFresh(set)) {
      for (const c of cached.cards) usedIds.add(c.id);
      Object.assign(pricing, cached.pricing || {});
      return cached.cards;
    }
  } catch { /* sem cache: busca */ }

  const q = encodeURIComponent(`e:${set.code} game:paper`);
  let url = `/cards/search?q=${q}&unique=prints&order=set`;
  const localPricing = {};
  const cards = [];
  try {
    while (url) {
      const page = await api(url);
      for (const raw of page.data || []) {
        const card = makeCard(raw, set, usedIds, localPricing);
        if (card) cards.push(card);
      }
      url = page.has_more && page.next_page ? page.next_page.replace(API, "") : null;
    }
  } catch (e) {
    if (String(e.message || "").includes("404")) return []; // set sem cartas de papel
    throw e;
  }
  Object.assign(pricing, localPricing);
  await mkdir(CACHE, { recursive: true });
  await writeFile(cacheFile, JSON.stringify({ v: CACHE_VERSION, count: set.card_count, cards, pricing: localPricing }), "utf8");
  return cards;
}

async function run() {
  const prev = await readChunkCards();
  console.log(`Magic: ${prev.length} cartas nos chunks versionados (base).`);

  if (NO_FETCH) {
    if (!prev.length) { console.error("--no-fetch sem chunks versionados: nada a construir."); process.exit(1); }
    await writeGameCatalog(OUT, { cards: prev, pricing: {}, webDir: "data/magic/" });
    console.log("Rebuild dos chunks concluído (sem preços — rode sem --no-fetch pra atualizá-los).");
    return;
  }

  let cards = [];
  const pricing = {};
  try {
    const setsResp = await api("/sets");
    const sets = (setsResp.data || []).filter((s) =>
      !s.digital && !EXCLUDE_SET_TYPES.has(s.set_type) && s.card_count > 0
      && (!ONLY.size || ONLY.has(s.code)));
    console.log(`  ${sets.length} sets de papel a sincronizar${ONLY.size ? " (filtro --sets)" : ""}.`);

    const usedIds = new Set();
    let done = 0;
    const perSet = await mapLimit(sets, 4, async (s) => {
      const list = await fetchSetCards(s, pricing, usedIds);
      done += 1;
      if (done % 50 === 0) console.log(`  ${done}/${sets.length} sets…`);
      return list;
    });
    cards = perSet.flat();
    console.log(`  ${cards.length} cartas da API, ${Object.keys(pricing).length} com preço.`);
  } catch (e) {
    // Scryfall fora: congela no versionado (mesmo padrão dos outros jogos).
    console.warn(`  Scryfall falhou (${e.message}) — congela nos chunks versionados.`);
    if (!prev.length) throw e;
  }

  // União preservadora: quem sumiu da API fica (carta indexada nunca some).
  // Com --sets, os sets não sincronizados continuam inteiros pela mesma via.
  const merged = cards.concat(preserveMissingCards(prev, cards));
  // Ordena por data de lançamento (asc), set e número (numérico quando dá).
  const numVal = (x) => { const m = String(x.number).match(/\d+/); return m ? Number(m[0]) : 1e9; };
  merged.sort((a, b) =>
    String(a.setReleaseDate).localeCompare(String(b.setReleaseDate))
    || String(a.setId).localeCompare(String(b.setId))
    || (numVal(a) - numVal(b))
    || String(a.number).localeCompare(String(b.number)));

  await writeGameCatalog(OUT, { cards: merged, pricing, webDir: "data/magic/" });
  const setCount = new Set(merged.map((c) => c.setId)).size;
  console.log(`Magic: catálogo com ${merged.length} cartas em ${setCount} sets.`);
}

run().catch((e) => { console.error(e); process.exit(1); });
