// Snapshot da LISTA OFICIAL da Bandai do NARUTO カードゲーム (2002–2006).
//
// POR QUE EXISTE. O catálogo vintage do Naruto nasceu de duas fontes que não
// cobrem o jogo inteiro: a TV Tokyo só tem os vols. 1–13 (card_14+.html dá
// 404) e o tcg-db é um banco de fã com buracos. Em 2026-11-04 o Fernando
// procurou "Itachi" e achou 2 cartas: faltavam 忍-203 (vol. 9) e 忍-365/367
// (starter 巻ノ十五 暗躍の書). A lista do site oficial do jogo
// (www.carddas.com/naruto/cardlist/) tem 1.169 números; o catálogo tinha 793.
// O site saiu do ar, mas o Wayback guardou as páginas (capturas até 2007).
//
// POR QUE UM PASSO LOCAL, e não no CI: a fonte é um arquivo morto (o jogo
// acabou em 2006) e o Wayback derruba conexão e fica "Temporarily Offline"
// por minutos. O sync (scripts/sync-naruto-vintage.mjs) lê só o snapshot
// versionado data/vintage/naruto-bandai-oficial.json, sem rede.
//
//   node scripts/naruto-lista-oficial-bandai.mjs              # baixa do Wayback
//   node scripts/naruto-lista-oficial-bandai.mjs --dir <pasta> # páginas já baixadas
//
// Só número, nome e produto (収録) entram; o texto das cartas fica de fora.
// Não regride: se a coleta der menos cartas que o snapshot, ele fica.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { parseBandaiCardlist } from "./lib/naruto-vintage-fontes.mjs";

const SNAP = new URL("../data/vintage/naruto-bandai-oficial.json", import.meta.url);
const CACHE = new URL("../data/.cache/", import.meta.url);
const BASE = "www.carddas.com/naruto/cardlist/";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
const dirArg = process.argv.indexOf("--dir");
const DIR = dirArg > 0 ? process.argv[dirArg + 1] : "";

// Ordem de exibição e rótulo de cada página (o menu do próprio site).
const PAGINAS = [
  "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th", "11th", "12th",
  "13th", "14th", "15th", "16th", "17th", "bst_nin2",
  "st_5th", "st_8th", "st_10th", "st_12th", "st_daizen", "st_15th", "st_16th", "st_higi",
  "ex_1st", "ex_yuki", "ex_nin2", "ex_kfs", "ex_kfs2", "ex_spc2", "coin_1", "coin_2", "promo"
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sjis = (buf) => new TextDecoder("shift_jis").decode(buf);

async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(90000) });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    } catch { /* tenta de novo */ }
    await sleep(3000 * (i + 1));
  }
  return null;
}

// Última captura 200 de cada página (o estado final da lista).
async function capturas() {
  const cdx = await get(`http://web.archive.org/cdx/search/cdx?url=${BASE}*&output=txt&fl=timestamp,original,statuscode&filter=statuscode:200&limit=20000`);
  if (!cdx) return new Map();
  const ult = new Map();
  for (const linha of cdx.toString("utf8").split("\n")) {
    const [ts, original] = linha.trim().split(/\s+/);
    const m = String(original || "").match(/\/naruto\/cardlist\/([a-z0-9_]+)\.shtml$/);
    if (!m || !PAGINAS.includes(m[1])) continue;
    if (!ult.has(m[1]) || ts > ult.get(m[1]).ts) ult.set(m[1], { ts, original });
  }
  return ult;
}

async function coleta() {
  const pages = [];
  if (DIR) {
    let arquivos;
    try { arquivos = new Set(await readdir(DIR)); } catch { console.log(`  pasta ${DIR} não existe`); return pages; }
    for (const p of PAGINAS) {
      if (!arquivos.has(`${p}.shtml`)) { console.log(`  ${p}: não está em ${DIR}`); continue; }
      const cards = parseBandaiCardlist(sjis(await readFile(`${DIR}/${p}.shtml`)));
      pages.push({ page: p, capture: "", cards });
    }
    return pages;
  }
  const ult = await capturas();
  if (!ult.size) { console.log("  Wayback não respondeu o índice (CDX)."); return pages; }
  await mkdir(CACHE, { recursive: true });
  for (const p of PAGINAS) {
    const c = ult.get(p);
    if (!c) { console.log(`  ${p}: sem captura 200 no Wayback`); continue; }
    // Cache local (data/.cache/, fora do git): reler sem baixar de novo
    // quando só o leitor muda. A captura entra no nome do arquivo.
    const arq = new URL(`naruto-bandai-${p}-${c.ts}.shtml`, CACHE);
    let buf = null;
    try { buf = await readFile(arq); } catch { /* baixa */ }
    if (!buf) {
      buf = await get(`http://web.archive.org/web/${c.ts}id_/${c.original}`);
      if (buf) await writeFile(arq, buf);
      await sleep(1500); // gentileza com o Wayback
    }
    if (!buf) { console.log(`  ${p}: download falhou (${c.ts})`); continue; }
    const cards = parseBandaiCardlist(sjis(buf));
    console.log(`  ${p}: ${cards.length} cartas (captura ${c.ts})`);
    pages.push({ page: p, capture: c.ts, cards });
  }
  return pages;
}

const conta = (snap) => (snap && snap.pages ? snap.pages.reduce((n, p) => n + p.cards.length, 0) : 0);
let atual = null;
try { atual = JSON.parse(await readFile(SNAP, "utf8")); } catch { /* primeiro snapshot */ }

console.log("Lista oficial da Bandai (NARUTO カードゲーム) — Wayback");
const pages = await coleta();
// Página que não veio desta vez mantém a do snapshot (o Wayback falha aos pedaços).
for (const antiga of (atual && atual.pages) || []) {
  if (!pages.some((p) => p.page === antiga.page)) pages.push(antiga);
}
pages.sort((a, b) => PAGINAS.indexOf(a.page) - PAGINAS.indexOf(b.page));
const novo = {
  source: `https://web.archive.org/web/2007/http://${BASE}`,
  updatedAt: new Date().toISOString().slice(0, 10),
  note: "Lista oficial do site da Bandai (carddas.com/naruto/cardlist/), pelo Wayback. Uma página por produto; a mesma carta aparece em mais de uma (reimpressões em starters e folhas). Só número, nome e produto (収録/配布方法).",
  pages
};
const antes = conta(atual), depois = conta(novo);
const distintos = new Set(pages.flatMap((p) => p.cards.map((c) => c.num))).size;
console.log(`  ${pages.length} páginas, ${depois} linhas, ${distintos} números distintos (snapshot: ${antes} linhas).`);
if (depois < antes) {
  console.log(`  ⚠ REGRESSÃO (${depois} < ${antes}) — snapshot mantido.`);
} else {
  // Uma carta por linha: o diff de uma recoleta mostra carta, não campo.
  const corpo = pages.map((p) => ` {"page": ${JSON.stringify(p.page)}, "capture": ${JSON.stringify(p.capture)}, "cards": [\n`
    + p.cards.map((c) => `  ${JSON.stringify(c)}`).join(",\n") + "\n ]}").join(",\n");
  const txt = JSON.stringify({ ...novo, pages: "@PAGES@" }, null, 1).replace('"@PAGES@"', `[\n${corpo}\n]`);
  JSON.parse(txt); // trava: o texto montado à mão tem de ser JSON válido
  await writeFile(SNAP, txt + "\n", "utf8");
  console.log(`  gravado em data/vintage/naruto-bandai-oficial.json`);
}
