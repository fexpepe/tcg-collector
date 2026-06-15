// Sincroniza preços do mercado BRASILEIRO a partir da API do MYP Cards
// (https://github.com/MYPCards/mypcards-api). Roda no BUILD (GitHub Actions),
// nunca no navegador: o token fica num secret e nunca vai para o cliente.
//
// Uso: MYP_API_TOKEN=xxxxx node scripts/sync-myp.mjs [jogo]
//   jogo   slug do jogo no MYP (padrão: "pokemon")
//
// Sem MYP_API_TOKEN definido, o script é um NO-OP (sai com sucesso) — assim o
// deploy continua funcionando enquanto o token não estiver disponível.
//
// Saída: data/myp-prices.generated.json — um array de entradas normalizadas
// { cardCode, editionCode, nameEn, namePt, min, avg, max } (preços em BRL).
// O merge (merge-catalogs) casa essas entradas com as cartas do catálogo e
// grava o preço BR como `b: { mn, md, mx }` em data/pricing.generated.js.
//
// OBS: a forma exata da resposta (nome dos campos de paginação/itens) só pode
// ser confirmada com um token real. O parser abaixo é defensivo (aceita array
// solto ou {data|items|results: [...]}). Ajuste fino após o primeiro retorno.

import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { positionals } = parseArgs({ allowPositionals: true, options: {} });
const jogo = positionals[0] || "pokemon";
const token = process.env.MYP_API_TOKEN;
const BASE = "https://mypcards.com/api/v1";
const OUT = new URL("../data/myp-prices.generated.json", import.meta.url);
const MAX_PAGES = 2000; // trava de segurança

if (!token) {
  console.warn("MYP_API_TOKEN não definido — pulando sync do MYP (no-op).");
  process.exit(0);
}

const num = (v) => {
  const n = Number(String(v == null ? "" : v).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "X-Api-Token": token, Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.json();
}

// Extrai o array de itens de formatos comuns de resposta paginada.
function itemsOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    for (const key of ["data", "items", "results", "precos", "cards"]) {
      if (Array.isArray(payload[key])) return payload[key];
    }
  }
  return [];
}

function normalize(raw) {
  return {
    cardCode: raw.card_code || raw.cardCode || null,
    editionCode: raw.edition_code || raw.editionCode || null,
    nameEn: raw.name_en || raw.nameEn || null,
    namePt: raw.name_pt || raw.namePt || null,
    min: num(raw.min_price ?? raw.min),
    avg: num(raw.avg_price ?? raw.avg ?? raw.median),
    max: num(raw.max_price ?? raw.max)
  };
}

async function main() {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${BASE}/${encodeURIComponent(jogo)}/precos?page=${page}`;
    let payload;
    try {
      payload = await fetchJson(url);
    } catch (error) {
      console.error(`Falha na página ${page}: ${error.message}`);
      break;
    }
    const items = itemsOf(payload);
    if (!items.length) break;
    items.forEach((raw) => {
      const entry = normalize(raw);
      if (entry.cardCode && (entry.avg || entry.min || entry.max)) all.push(entry);
    });
    process.stdout.write(`\rPágina ${page} — ${all.length} preços coletados`);
  }
  process.stdout.write("\n");
  await writeFile(OUT, JSON.stringify(all), "utf8");
  console.log(`MYP: ${all.length} preços BR salvos em data/myp-prices.generated.json (jogo: ${jogo}).`);
}

main().catch((error) => { console.error(error); process.exit(1); });
