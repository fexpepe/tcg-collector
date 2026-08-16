// Histórico de preços SEM SERVIDOR: a cada build, tira um snapshot do preço de
// referência de cada carta e acumula numa série semanal. O "banco" é a própria
// produção — o build busca o acumulador publicado no deploy anterior, anexa o
// ponto de hoje e re-publica (backup em data/.cache pra sobreviver a um outage).
//
// Saídas (por dataDir, gitignored, deployadas como estáticos):
//   price-history.generated.json  acumulador completo (uso interno do próximo build)
//   price-deltas.generated.json   { from, to, c: { id: pct } } — variação % vs o
//                                  snapshot anterior (mesma fonte), |pct| >= 1
//   price-deltas-7d.generated.json  idem, mas contra o snapshot de ~7 DIAS atrás
//   price-movers.generated.json   { from, to, up: [...], down: [...] } — maiores
//                                  altas/quedas ({ id, pct, v }), só cartas >= MIN_MOVER
//
// Por que DOIS arquivos de delta: desde que o build passou a ser diário
// (2026-08-05), o delta "vs snapshot anterior" virou variação de 24h — bom pro
// "maiores altas e quedas" do portfólio, ruim pro aviso semanal da wishlist, que
// perderia a carta que caiu 20% na semana em passos de 3%/dia. O de 7 dias existe
// pra esse aviso (ver scripts/send-wishlist-push.mjs).
//
// Preço de referência = MESMA prioridade do cardValue (b.md BR > u USD > e EUR),
// com a FONTE gravada — deltas só comparam pontos da mesma fonte (moedas diferem).
//
// Uso: node scripts/sync-price-history.mjs [data|data/lorcana]
// Sem pricing local (dev), busca o de produção. Sai com sucesso se nada existir.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const PROD = "https://tcg-collector.pages.dev";
const MAX_POINTS = 60;   // ~2 meses de snapshots diários (era 26 = 6 meses semanais)
const WINDOW_7D = 7;     // dias da janela longa (aviso de queda da wishlist)
const MIN_DELTA_PCT = 1; // abaixo disso é ruído, não entra no arquivo de deltas
const MIN_MOVER = 1;     // valor mínimo (na moeda da fonte) pra rankear nos movers
const MOVERS_N = 30;

const dir = (process.argv[2] || "data").replace(/\/+$/, "");
const slug = dir.replace(/[\\/]/g, "-");
const cacheDir = new URL("../data/.cache/", import.meta.url);
const outHistory = new URL(`../${dir}/price-history.generated.json`, import.meta.url);
const outDeltas = new URL(`../${dir}/price-deltas.generated.json`, import.meta.url);
const outDeltas7d = new URL(`../${dir}/price-deltas-7d.generated.json`, import.meta.url);
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

// Janela LONGA (~7 dias), pro aviso de queda da wishlist. Ancora por DATA, não
// por número de pontos: um dia sem build (cron atrasado, deploy que falhou) não
// pode encolher a janela em silêncio. Sem ponto velho o bastante, usa o mais
// antigo que existir — na primeira semana a janela nasce curta e vai crescendo.
const alvo7d = new Date(Date.parse(today + "T00:00:00Z") - WINDOW_7D * 86400000)
  .toISOString().slice(0, 10);
let idx7d = -1;
for (let i = hist.d.length - 2; i >= 0; i--) { idx7d = i; if (hist.d[i] <= alvo7d) break; }
const deltas7d = {};
if (idx7d >= 0) {
  Object.entries(hist.c).forEach(([id, c]) => {
    const now = c.p[hist.d.length - 1];
    if (now == null) return;
    let prev = null;
    for (let i = idx7d; i >= 0; i--) { if (c.p[i] != null) { prev = c.p[i]; break; } }
    if (prev == null || prev <= 0) return;
    const pct = ((now - prev) / prev) * 100;
    if (Math.abs(pct) < MIN_DELTA_PCT) return;
    deltas7d[id] = Math.round(pct * 10) / 10;
  });
}
const from7d = idx7d >= 0 ? hist.d[idx7d] : null;

// ── ÍNDICE DE MERCADO ───────────────────────────────────────────────────────
// Uma linha só: "como o mercado deste jogo se moveu", pro Portfólio comparar a
// coleção da pessoa contra ele ("o mercado subiu 4%, você subiu 7%"). É o papel
// que o CL50 cumpre no Card Ladder, e o enquadramento que a literatura de UX de
// investimento recomenda pra perda: sem referência, cair 7% parece erro seu; com
// ela, dá pra ver que o mercado caiu 10%.
//
// EQUAL-WEIGHTED (média das variações relativas), não a soma dos preços: somando,
// uma Charizard de US$ 900 mandaria no índice sozinha e ele viraria o gráfico
// daquela carta. Normalizado em 1000 na primeira data, como o CL50.
//
// Só entram cartas com preço >= MIN_INDEX na base e da MESMA fonte no par
// comparado: 0,01 -> 0,02 numa comum é +100% e faria o índice tremer à toa.
// O arquivo é minúsculo (uma série de ~60 números), então o Portfólio pode
// baixar o dos 13 jogos sem pesar.
const MIN_INDEX = 1;
const idxBase = [];
Object.values(hist.c).forEach((c) => {
  const base = c.p.findIndex((v) => v != null && v >= MIN_INDEX);
  if (base >= 0) idxBase.push({ p: c.p, base });
});
const serie = hist.d.map((_, i) => {
  let soma = 0, n = 0;
  idxBase.forEach(({ p, base }) => {
    if (i < base) return;                  // carta ainda não tinha preço
    const v = p[i], b = p[base];
    if (v == null || !(b > 0)) return;
    soma += v / b; n++;
  });
  return n ? Math.round((soma / n) * 1000 * 100) / 100 : null;
});
// Re-ancora em 1000: cartas entram no índice em datas diferentes, então a média
// do 1º dia raramente é exatamente 1000 — sem isso a linha nasce torta.
const primeiro = serie.find((v) => v != null);
const indice = primeiro > 0 ? serie.map((v) => (v == null ? null : Math.round((v / primeiro) * 1000 * 100) / 100)) : serie;
const outIndex = new URL(`../${dir}/market-index.generated.json`, import.meta.url);

await mkdir(cacheDir, { recursive: true });
await writeFile(outHistory, JSON.stringify(hist), "utf8");
await writeFile(cacheFile, JSON.stringify(hist), "utf8");
await writeFile(outDeltas, JSON.stringify({ from, to: today, c: deltas }), "utf8");
await writeFile(outDeltas7d, JSON.stringify({ from: from7d, to: today, c: deltas7d }), "utf8");
await writeFile(outMovers, JSON.stringify({ from, to: today, up, down }), "utf8");
await writeFile(outIndex, JSON.stringify({ v: 1, d: hist.d, i: indice, n: idxBase.length }), "utf8");
console.log(`[price-history] ${dir}: ${tracked} cartas, ${hist.d.length} snapshot(s) (${hist.d[0]}..${today})${replacing ? " [substituiu hoje]" : ""}; deltas ${Object.keys(deltas).length} (desde ${from}), 7d ${Object.keys(deltas7d).length} (desde ${from7d}), movers +${up.length}/-${down.length}, índice ${idxBase.length} cartas -> ${indice[indice.length - 1]}`);
