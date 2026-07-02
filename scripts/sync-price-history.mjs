// Histórico de preços SEM SERVIDOR: a cada build, tira um snapshot do preço de
// referência de cada carta e acumula numa série semanal. O "banco" é a própria
// produção — o build busca o acumulador publicado no deploy anterior, anexa o
// ponto de hoje e re-publica (backup em data/.cache pra sobreviver a um outage).
//
// Saídas (por dataDir, gitignored, deployadas como estáticos):
//   price-history.generated.json  acumulador completo (uso interno do próximo build)
//   price-deltas.generated.json   { from, to, c: { id: pct } } — variação % vs o
//                                  snapshot anterior (mesma fonte), |pct| >= 1
//   price-movers.generated.json   { from, to, up: [...], down: [...] } — maiores
//                                  altas/quedas ({ id, pct, v }), só cartas >= MIN_MOVER
//
// Preço de referência = MESMA prioridade do cardValue (b.md BR > u USD > e EUR),
// com a FONTE gravada — deltas só comparam pontos da mesma fonte (moedas diferem).
//
// Uso: node scripts/sync-price-history.mjs [data|data/lorcana]
// Sem pricing local (dev), busca o de produção. Sai com sucesso se nada existir.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const PROD = "https://tcg-collector.pages.dev";
const MAX_POINTS = 26;   // ~6 meses de snapshots semanais
const MIN_DELTA_PCT = 1; // abaixo disso é ruído, não entra no arquivo de deltas
const MIN_MOVER = 1;     // valor mínimo (na moeda da fonte) pra rankear nos movers
const MOVERS_N = 30;

const dir = (process.argv[2] || "data").replace(/\/+$/, "");
const slug = dir.replace(/[\\/]/g, "-");
const cacheDir = new URL("../data/.cache/", import.meta.url);
const outHistory = new URL(`../${dir}/price-history.generated.json`, import.meta.url);
const outDeltas = new URL(`../${dir}/price-deltas.generated.json`, import.meta.url);
const outMovers = new URL(`../${dir}/price-movers.generated.json`, import.meta.url);
const cacheFile = new URL(`price-history-${slug}.json`, cacheDir);

// Pricing atual: local (build) ou produção (dev/teste). Formato: window.TCG_PRICING = {...};
async function loadPricing() {
  const local = new URL(`../${dir}/pricing.generated.js`, import.meta.url);
  let text = null;
  if (existsSync(local)) text = await readFile(local, "utf8");
  else {
    try { const r = await fetch(`${PROD}/${dir}/pricing.generated.js`); if (r.ok) text = await r.text(); } catch { /* sem rede */ }
  }
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

// Acumulador anterior: produção primeiro (deploy passado), senão o cache do runner.
async function loadPrevious() {
  try {
    const r = await fetch(`${PROD}/${dir}/price-history.generated.json`);
    if (r.ok) { const j = await r.json(); if (j && Array.isArray(j.d) && j.c) return j; }
  } catch { /* sem rede/404: cai no cache */ }
  try { const j = JSON.parse(await readFile(cacheFile, "utf8")); if (j && Array.isArray(j.d) && j.c) return j; } catch { /* primeira vez */ }
  return { v: 1, d: [], c: {} };
}

// Referência: [fonte, valor] na prioridade do front (BR mediana > USD > EUR).
function refOf(e) {
  if (e && e.b && e.b.md > 0) return ["b", e.b.md];
  if (e && e.u > 0) return ["u", e.u];
  if (e && e.e > 0) return ["e", e.e];
  return null;
}
const r2 = (x) => Math.round(x * 100) / 100;

const pricing = await loadPricing();
if (!pricing) { console.log(`[price-history] ${dir}: sem pricing (pulado, no-op)`); process.exit(0); }

const hist = await loadPrevious();
const today = new Date().toISOString().slice(0, 10);
const replacing = hist.d.length && hist.d[hist.d.length - 1] === today; // build no mesmo dia: substitui
if (!replacing) hist.d.push(today);
const idx = hist.d.length - 1;

// Anexa o ponto de hoje. Fonte mudou (ex.: carta ganhou preço BR) -> série
// recomeça na fonte nova (comparar moedas diferentes daria delta sem sentido).
let tracked = 0;
Object.entries(pricing).forEach(([id, entry]) => {
  const ref = refOf(entry);
  if (!ref) return;
  tracked++;
  let c = hist.c[id];
  if (!c || c.s !== ref[0]) { c = hist.c[id] = { s: ref[0], p: new Array(idx).fill(null) }; }
  while (c.p.length < idx) c.p.push(null);
  c.p[idx] = r2(ref[1]);
});
// Cartas que sumiram do pricing ganham null hoje; séries 100% nulas caem fora.
Object.entries(hist.c).forEach(([id, c]) => {
  while (c.p.length < hist.d.length) c.p.push(null);
  if (c.p.every((v) => v == null)) delete hist.c[id];
});
// Teto de pontos: derruba os mais antigos.
if (hist.d.length > MAX_POINTS) {
  const drop = hist.d.length - MAX_POINTS;
  hist.d.splice(0, drop);
  Object.values(hist.c).forEach((c) => c.p.splice(0, drop));
}

// Deltas: hoje vs o ponto anterior mais recente com valor (pula nulls).
const deltas = {};
const movers = [];
if (hist.d.length >= 2) {
  Object.entries(hist.c).forEach(([id, c]) => {
    const now = c.p[hist.d.length - 1];
    if (now == null) return;
    let prev = null;
    for (let i = hist.d.length - 2; i >= 0; i--) { if (c.p[i] != null) { prev = c.p[i]; break; } }
    if (prev == null || prev <= 0) return;
    const pct = ((now - prev) / prev) * 100;
    if (Math.abs(pct) < MIN_DELTA_PCT) return;
    const p1 = Math.round(pct * 10) / 10;
    deltas[id] = p1;
    if (Math.min(now, prev) >= MIN_MOVER) movers.push({ id, pct: p1, v: now });
  });
}
movers.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
const up = movers.filter((m) => m.pct > 0).slice(0, MOVERS_N);
const down = movers.filter((m) => m.pct < 0).slice(0, MOVERS_N);
const from = hist.d.length >= 2 ? hist.d[hist.d.length - 2] : null;

await mkdir(cacheDir, { recursive: true });
await writeFile(outHistory, JSON.stringify(hist), "utf8");
await writeFile(cacheFile, JSON.stringify(hist), "utf8");
await writeFile(outDeltas, JSON.stringify({ from, to: today, c: deltas }), "utf8");
await writeFile(outMovers, JSON.stringify({ from, to: today, up, down }), "utf8");
console.log(`[price-history] ${dir}: ${tracked} cartas, ${hist.d.length} snapshot(s) (${hist.d[0]}..${today})${replacing ? " [substituiu hoje]" : ""}; deltas ${Object.keys(deltas).length}, movers +${up.length}/-${down.length}`);
