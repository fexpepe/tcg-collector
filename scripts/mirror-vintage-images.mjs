// Espelha as imagens do vintage (Carddass Hyper Battle) localmente — 1x, já que
// cartas de 1999 são imutáveis. Baixa a versão REDIMENSIONADA via wsrv.nl
// (~60KB webp em vez do scan de ~7MB do wiki) e grava em
// data/onepiece/vintage-images/<num>.webp; o sync vintage usa o arquivo local
// quando existe (imune a outage do wiki/wsrv, respeitoso com o servidor de fã).
//
// Séries FP/H/numéricas não seguem o path previsível cards/<num>.png: pra essas,
// SONDA variantes comuns de nome (fp1/fp01/FP1…) e fica com a que responder.
//
// 2ª fonte (2026-10-27): One Piece Collection (scripts/lib/onepiececollection.mjs).
// O wiki não tem scan de C46–C99 (2ª metade do 2nd Stage + Grand Box): a página
// da carta aponta pra cards/c46.png, que dá 404 lá. O site francês tem os 16
// sets, com scan menor e marca d'água (ver a lib). Só entra quando o wiki
// falha, então não troca nenhuma imagem que já existe.
//
// Rodar LOCAL (rede aberta) e COMMITAR as imagens; no deploy o resultado também
// entra no cache (data/.cache) como rede de segurança.
//   node scripts/mirror-vintage-images.mjs [--limit N] [--force]
import { writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mapLimit, sleep, readSnapshot } from "./lib/sync-common.mjs";
import { OPC, numKey, opcSeries, firstByNum } from "./lib/onepiececollection.mjs";

const ROOT = new URL("../", import.meta.url);
const SNAP = new URL("data/vintage/onepiece-hyperbattle.json", ROOT);
const OUT = new URL("data/onepiece/vintage-images/", ROOT);
const CACHE = new URL("data/.cache/vintage-images/", ROOT);
const IMG_BASE = "grandlinewiki.net/images/tcg/hyperbattle/cards";
const FORCE = process.argv.includes("--force");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

// Candidatos de nome de arquivo no wiki para um número de carta. C/S seguem
// <num minúsculo>.png; FP/H/numéricas variam — sonda as formas mais prováveis.
function candidates(num) {
  const n = String(num);
  const lower = n.toLowerCase();
  const set = new Set([lower, n, n.toUpperCase()]);
  const m = /^([A-Za-z]+)0*(\d+)$/.exec(n);
  if (m) {
    const [, p, d] = m;
    for (const pre of [p.toLowerCase(), p.toUpperCase()]) {
      set.add(`${pre}${d}`);                   // fp1
      set.add(`${pre}${d.padStart(2, "0")}`);  // fp01
      set.add(`${pre}${d.padStart(3, "0")}`);  // fp001
    }
  }
  // Número sem letra é erro de digitação da lista do wiki ("159" no 4th Stage):
  // a página e o scan da carta são c159.
  if (/^\d+$/.test(n)) set.add(`c${n}`);
  return [...set];
}

const wikiUrl = (file) => `https://wsrv.nl/?url=${IMG_BASE}/${encodeURIComponent(file)}.png&w=440&output=webp`;
// Sem w=: o scan francês já é menor que 440 e ampliar só borra; q=90 porque a
// origem já é JPEG (evita perder mais uma geração na conversão).
const opcUrl = (path) => `https://wsrv.nl/?url=${OPC}/cartes/${path}_carte.jpg&output=webp&q=90`;

// Número da carta -> caminho do scan no One Piece Collection ("19/81/h400_2601").
// Reimpressões (Grand Box DX, Compilations) repetem números: fica a 1ª.
// Lido uma vez, só se o wiki falhar em alguma carta.
let opcScans = null;
function opcMap() {
  return (opcScans ??= opcSeries(19).then((series) => {
    const map = firstByNum(series);
    console.log(`  One Piece Collection: ${map.size} scans em ${series.length} sets.`);
    return map;
  }));
}

async function fetchImage(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    // wsrv devolve páginas de erro pequenas/nao-webp quando a origem 404a.
    if (buf.length < 2048 || !(r.headers.get("content-type") || "").includes("image")) return null;
    return buf;
  } catch { return null; }
}

const snap = await readSnapshot(SNAP);
if (!snap) { console.error("snapshot ausente"); process.exit(1); }
const nums = [...new Set(snap.sets.flatMap((s) => s.cards.map((c) => c.num)))].slice(0, LIMIT);
await mkdir(OUT, { recursive: true });
await mkdir(CACHE, { recursive: true });

let ok = 0, fromOpc = 0, skipped = 0, failed = [];
await mapLimit(nums, 3, async (num) => {
  const name = `${String(num).toLowerCase()}.webp`;
  const dest = new URL(name, OUT);
  const cached = new URL(name, CACHE);
  if (!FORCE && existsSync(dest)) { skipped++; return; }
  if (!FORCE && existsSync(cached)) { await copyFile(cached, dest); ok++; return; } // reuso do cache do CI
  const save = async (buf) => {
    await writeFile(dest, buf);
    await writeFile(cached, buf);
    ok++;
    await sleep(350); // educado com o wiki/wsrv
  };
  for (const cand of candidates(num)) {
    const buf = await fetchImage(wikiUrl(cand));
    if (buf) return save(buf);
    await sleep(200);
  }
  const path = (await opcMap()).get(numKey(num));
  const buf = path && await fetchImage(opcUrl(path));
  if (buf) { fromOpc++; return save(buf); }
  failed.push(num);
});

console.log(`Espelhadas: ${ok} (${fromOpc} do One Piece Collection) · já existiam: ${skipped} · falharam: ${failed.length}`);
if (failed.length) console.log("  sem imagem encontrada (ficam no wsrv/placeholder): " + failed.join(", "));
console.log(`Saída: ${fileURLToPath(OUT)} — commitar as imagens novas.`);
