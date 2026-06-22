// Sincroniza preços/imagens da PokemonPriceTracker (PPT) para as cartas JP,
// onde a TCGdex falha (preço-lixo do Cardmarket e imagens faltando, ex.: era
// Mega). Roda no BUILD, nunca no navegador: a key fica no secret PPT_API_TOKEN.
//
// Saída: data/ppt-prices.generated.json — { cardId: { u: USD, img: url, g?:{p9,p10} } }
// que o merge-catalogs aplica por cima do pricing (preço melhor) e do chunk
// (preenche imagem faltante).
//
// Uso:
//   PPT_API_TOKEN=xxx node scripts/sync-ppt.mjs --probe            # validação barata
//   PPT_API_TOKEN=xxx node scripts/sync-ppt.mjs --dry-run --set SV4a   # testa join 1 set (não grava)
//   PPT_API_TOKEN=xxx node scripts/sync-ppt.mjs --set SV4a,SV9     # grava só esses sets
//   PPT_API_TOKEN=xxx node scripts/sync-ppt.mjs                    # incremental c/ orçamento (todos JP)
//
// Flags:
//   --probe        diagnóstico (não grava)
//   --dry-run      faz o join e loga, mas NÃO grava o artefato
//   --set A,B      limita a esses setIds (nossos, ex.: SV4a)
//   --graded       inclui PSA 9/10 (custa +1 crédito/carta)
//   --budget N     teto de créditos neste run (padrão 8000)
//
// Sem PPT_API_TOKEN, é no-op (sai com sucesso) — o deploy não quebra.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const TOKEN = process.env.PPT_API_TOKEN;
const BASE = "https://www.pokemonpricetracker.com/api/v2";
const PROD = "https://tcg-collector.pages.dev";
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const PROBE = has("--probe");
const DRY = has("--dry-run");
const GRADED = has("--graded");
const BUDGET = Number(val("--budget")) || 8000;
const ONLY_SETS = (val("--set") || "").split(",").map((s) => s.trim()).filter(Boolean);

const dataDir = new URL("../data/", import.meta.url);
const cacheDir = new URL("../data/.cache/ppt/", import.meta.url);
const OUT = new URL("ppt-prices.generated.json", dataDir);

if (!TOKEN) { console.warn("PPT_API_TOKEN não definido — pulando sync da PPT (no-op)."); process.exit(0); }

let creditsUsed = 0;
let lastCall = 0;
// O rate limit da PPT é PONDERADO por cartas (~ceil(cartas/10) "minute calls",
// teto 60/min). Uma página de 100 cartas custa ~10, então ~6 chamadas/min é o
// teto -> ~10s entre chamadas. Sem isso, ~7 paginas ja estouram (429).
const MIN_GAP = 10500;
async function ppt(path, retries = 3) {
  const gap = MIN_GAP - (Date.now() - lastCall);
  if (gap > 0) await new Promise((r) => setTimeout(r, gap));
  lastCall = Date.now();
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (res.status === 429 && retries > 0) {
    await new Promise((r) => setTimeout(r, 8000)); // backoff e tenta de novo
    return ppt(path, retries - 1);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || (json && json.error)) throw new Error(`PPT ${res.status}: ${(json && (json.error || json.message)) || res.statusText}`);
  const c = json.metadata && json.metadata.apiCallsConsumed && json.metadata.apiCallsConsumed.total;
  if (c) creditsUsed += c;
  return json;
}

// setName "SV4a: Shiny Treasure ex" -> "SV4a" (nosso setId). Sem ":" -> null.
function setCodeFromName(name) {
  const m = String(name || "").match(/^([A-Za-z0-9.-]+):/);
  return m ? m[1] : null;
}
// "349/190" -> 349 (inteiro, pra casar com o número do nosso card id).
function numOf(s) { const m = String(s || "").match(/(\d+)/); return m ? Number(m[1]) : null; }

// Nosso chunk JP do set: tenta local (gerado no build); senão produção (pra
// dry-run local funcionar sem rodar o sync-tcgdex antes).
async function ourChunk(setId, lang = "ja") {
  const local = new URL(`sets/${lang}/${setId}.json`, dataDir);
  try { if (existsSync(local)) return JSON.parse(await readFile(local, "utf8")); } catch { /* segue pra prod */ }
  try { const r = await fetch(`${PROD}/data/sets/${lang}/${setId}.json`); if (r.ok) return r.json(); } catch { /* nada */ }
  return null;
}

// Graded EN: mapa curado nosso setId -> id PPT (tcgPlayerNumericId, EN). Só sets
// de alto valor (onde graded importa); evita match fuzzy de nome (preço errado é
// pior que ausente). Os preços EN base vêm da TCGdex; aqui só pegamos o graded.
const EN_GRADED_SETS = {
  base1: 604, base2: 635, base3: 630, base4: 605, base5: 1373,
  gym1: 1441, gym2: 1440,
  neo1: 1396, neo2: 1434, neo3: 1389, neo4: 1444,
  ecard1: 1375, ecard2: 1397, ecard3: 1372,
  sma: 2594 // Hidden Fates Shiny Vault
};

// Busca graded EN de um set curado e casa por número com o nosso chunk EN.
// Retorna { cardId: { g } } (só graded — não mexe no preço/imagem EN da TCGdex).
async function syncGradedEN(ourSetId, pptNumericId) {
  const chunk = await ourChunk(ourSetId, "en");
  if (!chunk || !chunk.length) return null;
  const byNum = new Map();
  for (const card of chunk) { const n = numOf(String(card.id).replace(`${ourSetId}-`, "")); if (n != null) byNum.set(n, card.id); }
  const arr = [];
  for (let page = 0, offset = 0; page < 30; page++) {
    const j = await ppt(`/cards?setId=${pptNumericId}&language=english&limit=100&offset=${offset}&includeEbay=true&days=90`);
    const batch = j.data || [];
    arr.push(...batch);
    if (!(j.metadata && j.metadata.hasMore) || !batch.length) break;
    offset += batch.length;
  }
  // A PPT tem várias entradas no mesmo número (erros, staff, reverse...). Por
  // carta nossa, fica a impressão com MAIS vendas graded — a "principal" líquida,
  // não a variante de erro (que costuma vir sem graded).
  const best = {};
  for (const c of arr) {
    const ourId = byNum.get(numOf(c.cardNumber));
    if (!ourId) continue;
    const g = pickGraded(c);
    if (!g) continue;
    const score = ((g["10"] && g["10"].n) || 0) + ((g["9"] && g["9"].n) || 0);
    if (!best[ourId] || score > best[ourId].score) best[ourId] = { g, score };
  }
  const entries = {};
  for (const [id, b] of Object.entries(best)) entries[id] = { g: b.g };
  console.log(`  [EN graded] ${ourSetId} (ppt ${pptNumericId}): ${Object.keys(entries).length}/${arr.length} com graded`);
  return entries;
}

// Mapa setId(nosso) -> pptSetId, a partir do /sets da PPT (cacheado 7 dias).
const SETMAP_VERSION = 4; // bump invalida o cache do mapa de sets
const DISC_VERSION = 2;   // bump descarta o cache de descobertas (positivo+negativo)
const discoveredFile = () => new URL("discovered.json", cacheDir);
// Sets descobertos via cartas (ver discoverSetId) — { CODE: numericId|null }.
async function loadDiscovered() { try { const c = JSON.parse(await readFile(discoveredFile(), "utf8")); return c.v === DISC_VERSION ? (c.e || {}) : {}; } catch { return {}; } }
async function saveDiscovered(obj) { try { await writeFile(discoveredFile(), JSON.stringify({ v: DISC_VERSION, e: obj }), "utf8"); } catch { /* ignora */ } }

// Nome do Pokémon em INGLÊS por dexId (data/pokemon-names.js, gerado antes do
// sync-ppt). O chunk pré-merge tem pokemonName em japonês, que não casa na
// busca da PPT (catálogo inglês) — por isso a descoberta usa este mapa.
let _names = null;
async function pokemonNames() {
  if (_names) return _names;
  try {
    const raw = await readFile(new URL("pokemon-names.js", dataDir), "utf8");
    _names = JSON.parse(raw.replace(/^window\.TCG_POKEMON_NAMES = /, "").replace(/;\s*$/, ""));
  } catch { _names = {}; }
  return _names;
}

async function setMap() {
  await mkdir(cacheDir, { recursive: true });
  const cacheFile = new URL("sets.json", cacheDir);
  // TTL curto (2 dias): a PPT adiciona sets novos ao longo do tempo (ex.: o M3
  // entrou semanas depois do lançamento); refrescar o mapa cedo faz o set novo
  // ser pego em ~2 dias em vez de 7.
  let map = null;
  try {
    const c = JSON.parse(await readFile(cacheFile, "utf8"));
    if (c.v === SETMAP_VERSION && Date.now() - c.t < 2 * 864e5) map = new Map(c.m);
  } catch { /* sem cache */ }
  if (!map) {
    map = new Map();
    let offset = 0;
    // /sets não consome créditos de carta; pagina até acabar. Chave em MAIÚSCULA
    // porque a PPT mistura caixa ("m1L: Mega Brave" vs nosso setId "M1L").
    for (let page = 0; page < 50; page++) {
      const j = await ppt(`/sets?language=japanese&limit=100&offset=${offset}`);
      const arr = j.data || [];
      for (const s of arr) { const code = setCodeFromName(s.name); const id = s.tcgPlayerNumericId; if (code && id != null) { const k = code.toUpperCase(); if (!map.has(k)) map.set(k, id); } }
      if (!(j.metadata && j.metadata.hasMore)) break;
      offset += arr.length || 100;
    }
    await writeFile(cacheFile, JSON.stringify({ v: SETMAP_VERSION, t: Date.now(), m: [...map] }), "utf8");
  }
  // Sets que existem nas cartas mas faltam no /sets (ex.: M3) entram aqui.
  const disc = await loadDiscovered();
  for (const [code, id] of Object.entries(disc)) if (id != null && !map.has(code)) map.set(code, id);
  return map;
}

// Descobre o numericId de um set que não está no /sets (a PPT às vezes só lista
// o set semanas depois das cartas aparecerem). Busca cartas pelo pokemonName
// (inglês) do nosso chunk e casa o código do setName. Custa alguns créditos.
async function discoverSetId(ourSetId) {
  const chunk = await ourChunk(ourSetId);
  if (!chunk || !chunk.length) return null;
  const names = await pokemonNames();
  const code = ourSetId.toUpperCase();
  const tried = new Set();
  for (const card of chunk) {
    const q = names[card.dexId] || card.pokemonName; // INGLÊS (chunk pré-merge é JP)
    if (!q || tried.has(q)) continue;
    tried.add(q);
    if (tried.size > 2) break; // teto de buscas (custo); 2 basta p/ set que existe
    try {
      const j = await ppt(`/cards?search=${encodeURIComponent(q)}&language=japanese&limit=30`);
      const hit = (j.data || []).find((c) => { const cc = setCodeFromName(c.setName); return cc && cc.toUpperCase() === code; });
      if (hit && hit.setId != null) return hit.setId;
    } catch { /* tenta o próximo nome */ }
  }
  return null;
}

// Extrai o melhor valor unitário (USD) e a imagem de um card da PPT.
function pickPrice(c) {
  if (c.prices && c.prices.market > 0) return c.prices.market;
  const v = c.prices && c.prices.variants;
  if (v) for (const variant of Object.values(v)) for (const cond of Object.values(variant)) if (cond && cond.price > 0) return cond.price;
  return 0;
}
// Graded (eBay, por nota PSA). Por nota guarda: s = preço "mercado" (smartMarket
// ponderado, com fallback mediana/7d), r = recente 7 dias, m = mediana 90 dias,
// n = nº de vendas (90d), t = tendência (1 alta / -1 baixa). Tudo USD; o front
// converte. Só PSA 9 e 10 (as notas que movem o mercado).
function pickGraded(c) {
  const byGrade = c.ebay && c.ebay.salesByGrade;
  if (!byGrade) return null;
  const r2 = (x) => Math.round(x * 100) / 100;
  const one = (node) => {
    if (!node || !node.count) return null;
    const smart = node.smartMarketPrice && node.smartMarketPrice.price > 0 ? node.smartMarketPrice.price : 0;
    const med = node.medianPrice > 0 ? node.medianPrice : 0;
    const r7 = node.marketPrice7Day > 0 ? node.marketPrice7Day : 0;
    const s = smart || med || r7;
    if (!s) return null;
    const g = { s: r2(s) };
    if (r7 && Math.round(r7) !== Math.round(s)) g.r = r2(r7);
    if (med && Math.round(med) !== Math.round(s)) g.m = r2(med);
    if (node.count) g.n = node.count;
    if (node.marketTrend === "up") g.t = 1; else if (node.marketTrend === "down") g.t = -1;
    return g;
  };
  const out = {};
  const p10 = one(byGrade.psa10), p9 = one(byGrade.psa9);
  if (p10) out["10"] = p10;
  if (p9) out["9"] = p9;
  return Object.keys(out).length ? out : null;
}

// Busca um set na PPT e casa cada card com o nosso cardId pelo número.
// Retorna { cardId: { u, img, g? } } ou null se não houver chunk nosso.
async function syncSet(ourSetId, pptSetId) {
  const chunk = await ourChunk(ourSetId);
  if (!chunk || !chunk.length) { console.log(`  ${ourSetId}: sem chunk nosso (pulado)`); return null; }
  const byNum = new Map();
  for (const card of chunk) { const n = numOf(String(card.id).replace(`${ourSetId}-`, "").replace(/-ja$/, "")); if (n != null) byNum.set(n, card.id); }

  const inc = GRADED ? "&includeEbay=true&days=90" : "";
  // Pagina o set inteiro (limit máx = 100; fetchAllInSet sozinho corta no limit).
  const arr = [];
  for (let page = 0, offset = 0; page < 30; page++) {
    const j = await ppt(`/cards?setId=${pptSetId}&language=japanese&limit=100&offset=${offset}${inc}`);
    const batch = j.data || [];
    arr.push(...batch);
    if (!(j.metadata && j.metadata.hasMore) || !batch.length) break;
    offset += batch.length;
  }
  const entries = {};
  for (const c of arr) {
    const ourId = byNum.get(numOf(c.cardNumber));
    if (!ourId) continue;
    const u = pickPrice(c), img = c.imageCdnUrl400 || c.imageCdnUrl200 || c.imageUrl || null;
    const e = {};
    if (u > 0) e.u = Math.round(u * 100) / 100;
    if (img) e.img = img;
    if (GRADED) { const g = pickGraded(c); if (g) e.g = g; }
    if (Object.keys(e).length) entries[ourId] = e;
  }
  console.log(`  ${ourSetId} (ppt ${pptSetId}): ${Object.keys(entries).length}/${arr.length} casadas`);
  return entries;
}

const REFRESH_DAYS = 7; // re-busca um set se o cache dele tiver mais que isso

async function run() {
  const map = await setMap();
  console.log(`Mapa de sets JP (PPT): ${map.size} sets com código.`);

  // Quais sets: --set, senão todos os nossos JP do manifest de produção.
  let targets = ONLY_SETS;
  if (!targets.length) {
    try {
      const r = await fetch(`${PROD}/data/manifest.generated.js`); const txt = await r.text();
      const m = txt.match(/=\s*(\{[\s\S]*\});?\s*$/); const man = JSON.parse(m[1]);
      targets = man.sets.filter((s) => s.language === "ja").map((s) => s.id);
    } catch { console.warn("Sem manifest de produção; use --set."); targets = []; }
  }

  const setsCache = new URL("sets/", cacheDir);
  await mkdir(setsCache, { recursive: true });
  const cacheFileOf = (id) => new URL(`${id.replace(/[^A-Za-z0-9_.-]/g, "_")}.json`, setsCache);
  const readCache = async (id) => { try { return JSON.parse(await readFile(cacheFileOf(id), "utf8")); } catch { return null; } };

  // Sem --set, processa os mais ANTIGOS/faltantes primeiro: refresh rotativo
  // que cobre tudo em alguns runs e nunca estoura o orçamento.
  if (!ONLY_SETS.length) {
    const ages = await Promise.all(targets.map(async (s) => [s, (await readCache(s) || {}).t || 0]));
    targets = ages.sort((a, b) => a[1] - b[1]).map((x) => x[0]);
  }

  // Teto de tempo por run: com ~10s/chamada, o orçamento de créditos sozinho
  // deixaria o build longo demais. O que não couber agora entra nos próximos
  // deploys (rotação dos mais antigos primeiro + cache). 0 = sem teto.
  const TIME_CAP_MS = (Number(val("--max-minutes")) || 6) * 60 * 1000;
  const startedAt = Date.now();
  const discovered = await loadDiscovered();
  let discDirty = false;
  const out = {};
  let fetched = 0, cacheHits = 0;

  // Graded EN (curado) primeiro: sets de alto valor onde graded importa (base set
  // etc.). Cacheia/rotaciona igual aos JP (chave "en-<setId>", janela REFRESH_DAYS).
  if (GRADED) {
    let enF = 0, enH = 0;
    for (const [ourSetId, pptNumericId] of Object.entries(EN_GRADED_SETS)) {
      const ck = `en-${ourSetId}`;
      const cached = await readCache(ck);
      if (cached && Date.now() - (cached.t || 0) < REFRESH_DAYS * 864e5 && !DRY) { Object.assign(out, cached.entries); enH++; continue; }
      if (creditsUsed >= BUDGET || (TIME_CAP_MS && Date.now() - startedAt > TIME_CAP_MS)) { if (cached) { Object.assign(out, cached.entries); enH++; } continue; }
      try {
        const entries = await syncGradedEN(ourSetId, pptNumericId);
        if (entries) { Object.assign(out, entries); enF++; if (!DRY) await writeFile(cacheFileOf(ck), JSON.stringify({ t: Date.now(), entries }), "utf8"); }
        else if (cached) Object.assign(out, cached.entries);
      } catch (e) { console.log(`  [EN graded] ${ourSetId}: erro ${e.message}`); if (cached) Object.assign(out, cached.entries); }
    }
    console.log(`Graded EN: ${enF} buscados, ${enH} do cache`);
  }

  for (const setId of targets) {
    const code = setId.toUpperCase();
    let pptId = map.get(code);
    // Set não listado no /sets (ex.: M3): descobre pelas cartas. Cache negativo
    // (`code in discovered`, valor null) evita re-tentar sets que de fato não
    // existem na PPT (E*/PCG*/neo*...). Gasta crédito, então só com orçamento/tempo.
    if (pptId == null && !(code in discovered) && creditsUsed < BUDGET && !(TIME_CAP_MS && Date.now() - startedAt > TIME_CAP_MS)) {
      const found = await discoverSetId(setId);
      if (!DRY) { discovered[code] = found; discDirty = true; }
      if (found != null) { pptId = found; map.set(code, found); console.log(`  ${setId}: descoberto via cartas (ppt ${found})`); }
    }
    if (pptId == null) { console.log(`  ${setId}: sem equivalente na PPT (pulado)`); continue; }
    const cached = await readCache(setId);
    const fresh = cached && Date.now() - (cached.t || 0) < REFRESH_DAYS * 864e5;
    // Fresco (e não é dry-run): usa o cache, não gasta crédito.
    if (fresh && !DRY) { Object.assign(out, cached.entries); cacheHits++; continue; }
    // Sem orçamento OU sem tempo: mantém o que já tem em cache (não regride).
    if (creditsUsed >= BUDGET || (TIME_CAP_MS && Date.now() - startedAt > TIME_CAP_MS)) {
      if (cached) { Object.assign(out, cached.entries); cacheHits++; }
      continue;
    }
    try {
      const entries = await syncSet(setId, pptId);
      if (entries) { Object.assign(out, entries); fetched++; if (!DRY) await writeFile(cacheFileOf(setId), JSON.stringify({ t: Date.now(), entries }), "utf8"); }
      else if (cached) Object.assign(out, cached.entries);
    } catch (e) { console.log(`  ${setId}: erro ${e.message}`); if (cached) Object.assign(out, cached.entries); }
  }

  if (discDirty) await saveDiscovered(discovered);
  console.log(`\nSets: ${fetched} buscados, ${cacheHits} do cache | cartas: ${Object.keys(out).length} | créditos: ${creditsUsed}/${BUDGET}`);
  if (DRY) { console.log("[dry-run] nada gravado. Amostra:", JSON.stringify(Object.fromEntries(Object.entries(out).slice(0, 5)), null, 1)); return; }
  // Artefato montado a partir de TODOS os sets em cache (cobertura completa).
  await writeFile(OUT, JSON.stringify(out), "utf8");
  console.log(`Gravado ${Object.keys(out).length} cartas em data/ppt-prices.generated.json`);
}

// --- INSPECT: descobre qual id de set o /cards?fetchAllInSet aceita ---
async function inspect() {
  console.log("=== INSPECT sets ===");
  // pagina /sets e acha as entradas dos códigos pedidos (--set)
  const wanted = new Set(ONLY_SETS);
  const found = new Map();
  let offset = 0;
  for (let p = 0; p < 50 && found.size < wanted.size; p++) {
    const j = await ppt(`/sets?language=japanese&limit=100&offset=${offset}`);
    const arr = j.data || [];
    for (const s of arr) { const code = setCodeFromName(s.name); if (wanted.has(code) && !found.has(code)) found.set(code, s); }
    if (!(j.metadata && j.metadata.hasMore)) break;
    offset += arr.length || 100;
  }
  for (const [code, s] of found) {
    console.log(`\n[${code}] ids: id=${s.id} | tcgPlayerId=${s.tcgPlayerId} | tcgPlayerNumericId=${s.tcgPlayerNumericId}`);
    // candidatos (param, valor) — log verboso: contagem OU erro de cada um.
    const tries = [
      ["setId", s.tcgPlayerNumericId, "numericId"],
      ["setId", s.tcgPlayerId, "slug"]
    ];
    for (const [param, value, label] of tries) {
      if (value == null) continue;
      try {
        const r = await ppt(`/cards?${param}=${encodeURIComponent(value)}&language=japanese&fetchAllInSet=true&limit=3`);
        const n = (r.data || []).length;
        console.log(`  ${n ? "✓" : "·"} ${param}=${label}(${value}) +lang=ja +fetchAll -> ${n} cartas${n ? ` | ex: ${r.data[0].name} #${r.data[0].cardNumber} setId=${r.data[0].setId}` : ""}`);
      } catch (e) { console.log(`  ✗ ${param}=${label}(${value}) -> ${e.message}`); }
    }
  }
  console.log(`\n=== créditos: ${creditsUsed} ===`);
}

// --- PROBE: diagnóstico barato (mantido) ---
async function probe() {
  console.log("=== PPT PROBE ===\n");
  let ours = {};
  try { const r = await fetch(`${PROD}/data/pricing.generated.js`); const t = await r.text(); const m = t.match(/=\s*(\{[\s\S]*\});?\s*$/); ours = JSON.parse(m[1]); } catch { /* nada */ }
  try {
    const en = await ppt(`/cards?search=charizard&language=english&limit=20`);
    const base = (en.data || []).find((c) => /base set/i.test(c.setName || "") && String(c.cardNumber) === "4") || (en.data || [])[0];
    console.log("[1] EN:", base && `${base.name} | ${base.setName} #${base.cardNumber} | ${JSON.stringify(base.prices).slice(0, 200)}`);
    console.log("    nosso base1-4:", JSON.stringify(ours["base1-4"] || "(sem)"));
  } catch (e) { console.log("[1] EN falhou:", e.message); }
  try {
    const g = await ppt(`/cards?search=charizard&language=english&limit=3&includeEbay=true&days=90`);
    console.log("\n[2] GRADED:");
    (g.data || []).forEach((c) => console.log(`    ${c.name}: ${c.ebay && c.ebay.salesByGrade ? JSON.stringify(c.ebay.salesByGrade).slice(0, 300) : "(sem)"}`));
  } catch (e) { console.log("[2] graded falhou:", e.message); }
  try {
    const jp = await ppt(`/cards?search=charizard&language=japanese&limit=10`);
    console.log("\n[3] JOIN:");
    (jp.data || []).slice(0, 6).forEach((c) => console.log(`    ${c.name} | code=${setCodeFromName(c.setName)} | num=${numOf(c.cardNumber)} | img=${c.imageCdnUrl400 ? "sim" : "não"} | market=${c.prices && c.prices.market}`));
  } catch (e) { console.log("[3] JP falhou:", e.message); }
  console.log(`\n=== créditos: ${creditsUsed} ===`);
}

const entry = has("--inspect") ? inspect : PROBE ? probe : run;
entry().catch((e) => { console.error("falhou:", e.message); process.exit(1); });
