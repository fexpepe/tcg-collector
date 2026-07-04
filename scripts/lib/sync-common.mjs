// Helpers compartilhados dos scripts de sync/build de catálogo. Sem dependências.
// Cada jogo novo deve custar ~1 arquivo pequeno usando estas peças.
import { writeFile, readFile, mkdir } from "node:fs/promises";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch com retry/backoff (rede/429/5xx). Lança no esgotamento.
export async function fetchRetry(url, { headers = {}, tries = 4, timeoutMs = 30000 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const signal = (typeof AbortSignal !== "undefined" && AbortSignal.timeout) ? AbortSignal.timeout(timeoutMs) : undefined;
      const r = await fetch(url, { headers, signal });
      if (r.ok) return r;
      last = new Error(`HTTP ${r.status} em ${url}`);
      if (r.status < 500 && r.status !== 429) throw last; // 4xx (menos 429): não adianta repetir
    } catch (e) { last = e; }
    await sleep(1000 * (i + 1));
  }
  throw last;
}

// map com concorrência limitada (ordem preservada).
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function slug(s) {
  return String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Entidades HTML comuns + strip de tags (parsers de wiki).
export const decodeEntities = (s) => String(s || "")
  .replace(/&#8217;|&#39;|&rsquo;/g, "'").replace(/&amp;/g, "&").replace(/&#8211;|&#8212;/g, "-")
  .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

// Lê um window.<var> de um arquivo data/*.js (formato dos catálogos).
export async function readGlobalVar(fileUrl, varName) {
  try {
    const t = await readFile(fileUrl, "utf8");
    const g = { window: {} };
    new Function("window", t)(g.window);
    return g.window[varName];
  } catch { return null; }
}

// Índices padrão (sets/artists) a partir das cartas — formato que o front consome.
export function buildSetIndexes(cards) {
  const bySet = new Map();
  const byArtist = new Map();
  for (const c of cards) {
    if (!bySet.has(c.set)) bySet.set(c.set, []);
    bySet.get(c.set).push(c.id);
    if (c.artist) {
      if (!byArtist.has(c.artist)) byArtist.set(c.artist, []);
      byArtist.get(c.artist).push(c.id);
    }
  }
  return {
    sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)),
    artists: [...byArtist.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name))
  };
}

// Escreve o catálogo completo de um jogo (cards/indexes/pricing + .generated).
export async function writeGameCatalog(outDirUrl, { cards, indexes, pricing }) {
  await mkdir(outDirUrl, { recursive: true });
  const w = (name, varName, value) => writeFile(new URL(name, outDirUrl), `window.${varName} = ${JSON.stringify(value)};\n`, "utf8");
  const idx = indexes || buildSetIndexes(cards);
  await w("cards.js", "TCG_CARDS", cards);
  await w("manifest.generated.js", "TCG_CARDS", cards);
  await w("indexes.js", "TCG_INDEXES", idx);
  await w("indexes.generated.js", "TCG_INDEXES", idx);
  await w("pricing.js", "TCG_PRICING", pricing || {});
  await w("pricing.generated.js", "TCG_PRICING", pricing || {});
}

// Snapshot versionado (fontes-fã frágeis): lê/escreve data/vintage/<nome>.json.
// A regra de ouro: o build SEMPRE parte do snapshot; o fetch da fonte só
// ATUALIZA o snapshot quando responde e não regride (menos cartas = suspeito).
export async function readSnapshot(fileUrl) {
  try { return JSON.parse(await readFile(fileUrl, "utf8")); } catch { return null; }
}
export async function writeSnapshot(fileUrl, snap) {
  await mkdir(new URL("./", fileUrl), { recursive: true });
  await writeFile(fileUrl, JSON.stringify(snap, null, 1), "utf8");
}
export function snapshotCardCount(snap) {
  return (snap && snap.sets || []).reduce((n, s) => n + (s.cards ? s.cards.length : 0), 0);
}
