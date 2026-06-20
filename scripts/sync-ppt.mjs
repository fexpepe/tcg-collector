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
const MIN_GAP = 1200; // ms entre chamadas (~50/min, abaixo do limite de 60/min da PPT)
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
async function ourChunk(setId) {
  const local = new URL(`sets/ja/${setId}.json`, dataDir);
  try { if (existsSync(local)) return JSON.parse(await readFile(local, "utf8")); } catch { /* segue pra prod */ }
  try { const r = await fetch(`${PROD}/data/sets/ja/${setId}.json`); if (r.ok) return r.json(); } catch { /* nada */ }
  return null;
}

// Mapa setId(nosso) -> pptSetId, a partir do /sets da PPT (cacheado 7 dias).
async function setMap() {
  await mkdir(cacheDir, { recursive: true });
  const cacheFile = new URL("sets.json", cacheDir);
  const VERSION = 3; // bump invalida o cache (códigos agora normalizados em MAIÚSCULA)
  try {
    const c = JSON.parse(await readFile(cacheFile, "utf8"));
    if (c.v === VERSION && Date.now() - c.t < 7 * 864e5) return new Map(c.m);
  } catch { /* sem cache */ }
  const map = new Map();
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
  await writeFile(cacheFile, JSON.stringify({ v: VERSION, t: Date.now(), m: [...map] }), "utf8");
  return map;
}

// Extrai o melhor valor unitário (USD) e a imagem de um card da PPT.
function pickPrice(c) {
  if (c.prices && c.prices.market > 0) return c.prices.market;
  const v = c.prices && c.prices.variants;
  if (v) for (const variant of Object.values(v)) for (const cond of Object.values(variant)) if (cond && cond.price > 0) return cond.price;
  return 0;
}
function pickGraded(c) {
  const byGrade = c.ebay && c.ebay.salesByGrade;
  if (!byGrade) return null;
  const g = {};
  const pick = (node) => node && node.smartMarketPrice && node.smartMarketPrice.price > 0 ? Math.round(node.smartMarketPrice.price * 100) / 100
    : node && node.medianPrice > 0 ? node.medianPrice : 0;
  const p9 = pick(byGrade.psa9), p10 = pick(byGrade.psa10);
  if (p9) g.p9 = p9; if (p10) g.p10 = p10;
  return Object.keys(g).length ? g : null;
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

  const out = {};
  let fetched = 0, cacheHits = 0;
  for (const setId of targets) {
    const pptId = map.get(setId.toUpperCase());
    if (!pptId) { console.log(`  ${setId}: sem equivalente na PPT (pulado)`); continue; }
    const cached = await readCache(setId);
    const fresh = cached && Date.now() - (cached.t || 0) < REFRESH_DAYS * 864e5;
    // Fresco (e não é dry-run): usa o cache, não gasta crédito.
    if (fresh && !DRY) { Object.assign(out, cached.entries); cacheHits++; continue; }
    // Sem orçamento: mantém o que já tem em cache (cobertura não regride).
    if (creditsUsed >= BUDGET) { if (cached) { Object.assign(out, cached.entries); cacheHits++; } continue; }
    try {
      const entries = await syncSet(setId, pptId);
      if (entries) { Object.assign(out, entries); fetched++; if (!DRY) await writeFile(cacheFileOf(setId), JSON.stringify({ t: Date.now(), entries }), "utf8"); }
      else if (cached) Object.assign(out, cached.entries);
    } catch (e) { console.log(`  ${setId}: erro ${e.message}`); if (cached) Object.assign(out, cached.entries); }
  }

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
