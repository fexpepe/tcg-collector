// Espelha os LOGOS dos sets JAPONESES do Pokémon localmente. A TCGdex, que é a
// fonte do catálogo, simplesmente NÃO TEM arte de set em japonês: o payload de
// /v2/ja/sets/<id> vem sem os campos `logo`/`symbol` (só o /v2/en/ os traz) e o
// CDN devolve 404 em assets.tcgdex.net/ja/<serie>/<set>/logo.png. Resultado: os
// 72 chunks de data/sets/ja/ nascem com setLogo:"" e a tela de Sets cai no
// fallback de texto — uma parede de kanji onde o EN tem logo.
//
// A fonte aqui é o Bulbagarden Archives (MediaWiki), que hospeda o logo oficial
// de cada expansão japonesa. O nome do arquivo NÃO segue uma regra única — há
// "<setId> Logo JP.png" (era SV/MEGA), "<setId> <Nome EN> Logo.png" (subsets) e
// nomes por extenso nos vintages — então o de-para é CURADO no FILES abaixo, e
// não adivinhado. Set que não está no mapa não tem logo publicado: fica sem, e
// o tile mostra o NOME (agora em inglês, via JA_SET_EN no shared.js).
//
// Dois modos, porque o CI não deve depender do Bulbagarden:
//   node scripts/mirror-ja-set-logos.mjs             baixa o que falta e carimba
//   node scripts/mirror-ja-set-logos.mjs --no-fetch  só carimba (é o que roda no build)
//   node scripts/mirror-ja-set-logos.mjs --force     rebaixa tudo
//
// O carimbo precisa rodar em TODO build: o sync-tcgdex reescreve os chunks a
// cada rodada e devolve setLogo:"" (é o que a API diz). Mesmo papel do
// mirror-set-logos.mjs, que roda logo antes — a diferença é que lá a URL remota
// existe e aqui ela não existe em lugar nenhum.
//
// Rodar LOCAL (rede aberta) e COMMITAR os PNGs novos.
import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { mapLimit, sleep } from "./lib/sync-common.mjs";

const run = promisify(execFile);

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/set-logos/ja/", ROOT);
const CHUNKS = new URL("data/sets/ja/", ROOT);
const API = "https://archives.bulbagarden.net/w/api.php";
const HEADERS = { "User-Agent": "Sleevu/1.0 (https://sleevu.app)" };
const FORCE = process.argv.includes("--force");
const NO_FETCH = process.argv.includes("--no-fetch");
// Largura do thumbnail pedido ao MediaWiki. O tile de set desenha ~200px e o
// hero de detalhe ~400px; 520 cobre os dois em tela 2x sem trazer o original
// (alguns passam de 1800px de largura e 400 KB).
const WIDTH = 520;

// setId (o mesmo da TCGdex/ja) -> arquivo no Bulbagarden Archives.
// Ausente = não existe logo publicado lá. Conferido arquivo por arquivo: os
// vintages (PMCG, neo1/neo2, VS, web, e-Card 1/2, toda a era PCG) só têm o
// símbolo, nunca o logo; e os decks/promos (MC, SVK, SVLN, SVLS, M-P, MBG,
// svpj) não têm entrada de logo no wiki.
const FILES = {
  // ---- e-Card (2001-2002)
  E3: "E3 Logo.png",
  E4: "E4 Logo.png",
  E5: "E5 Logo.png",
  // ---- neo (2000-2001)
  neo3: "neo3 Logo.png",
  neo4: "neo4 Logo.png",
  // ---- VS / web (2001)
  VS1: "Pokémon Card VS Logo.png",
  web1: "Pokémon Card web Logo.png",
  // ---- Concept Pack (2015)
  CP1: "CP1 Logo.png",
  // ---- Sun & Moon (2019)
  SM10: "SM10 Logo.png",
  SM11b: "SM11b Logo.png",
  SM12: "SM12 Logo.png",
  SM12a: "SM12a Logo.png",
  // ---- Sword & Shield (2022)
  S9: "S9 Logo.png",
  S9a: "S9a Battle Region Logo.png",
  S12: "S12 Logo.png",
  S12a: "S12a VSTAR Universe Logo.png",
  // ---- Scarlet & Violet (2023-2025)
  SV1S: "SV1S Logo JP.png",
  SV1V: "SV1V Logo JP.png",
  SV1a: "SV1a Triplet Beat Logo.png",
  SV2a: "SV2a Pokémon Card 151 Logo.png",
  SV3: "SV3 Logo JP.png",
  SV3a: "SV3a Raging Surf Logo.png",
  SV4a: "SV4a Shiny Treasure ex Logo.png",
  SV5a: "SV5a Crimson Haze Logo.png",
  SV6: "SV6 Logo JP.png",
  SV7: "SV7 Logo JP.png",
  SV7a: "SV7a Paradise Dragona Logo.png",
  SV8: "SV8 Logo JP.png",
  SV8a: "SV8a Terastal Fest ex Logo.png",
  SV9: "SV9 Logo JP.png",
  SV9a: "SV9a Hot Wind Arena Logo.png",
  SV10: "SV10 Logo JP.png",
  SV11B: "SV11B Logo JP.png",
  SV11W: "SV11W Logo JP.png",
  // ---- MEGA (2025-2026)
  M1S: "M1S Logo JP.png",
  M1L: "M1L Logo JP.png",
  M2: "M2 Logo JP.png",
  M2a: "M2a Logo JP.png",
  M3: "M3 Logo JP.png",
  M4: "M4 Logo JP.png",
  M5: "M5 Logo JP.png"
  // SV2D/SV2P, SV4K/SV4M e SV5K de propósito FORA: o wiki só publica o logo do
  // PAR (SV2/SV4/SV5), com os dois nomes na mesma imagem. Carimbar o par nas
  // duas metades daria dois tiles com a arte idêntica — exatamente o que o
  // fallback de nome existe pra evitar (ver o comentário do tile em app.js).
};

// O wiki só serve PNG (100 KB por logo, contra ~20 KB dos .webp que a TCGdex
// entrega no en/pt). Convertemos com o ffmpeg quando ele existe na máquina; sem
// ffmpeg o PNG fica como está — pesa mais, mas funciona, e o carimbo aceita as
// duas extensões. Por isso todo lugar que toca arquivo passa por localFile().
const EXTS = ["webp", "png"];
const fileUrl = (setId, ext) => new URL(`${setId}.${ext}`, OUT);
function localFile(setId) {
  const ext = EXTS.find((e) => existsSync(fileUrl(setId, e)));
  return ext ? { ext, url: fileUrl(setId, ext), webPath: `data/set-logos/ja/${setId}.${ext}` } : null;
}

let ffmpegOk = null;
async function toWebp(setId) {
  if (ffmpegOk === null) {
    try { await run("ffmpeg", ["-version"]); ffmpegOk = true; }
    catch { ffmpegOk = false; console.warn("  Aviso: ffmpeg ausente; guardando os logos em PNG (~5x maiores)."); }
  }
  if (!ffmpegOk) return;
  const png = fileUrl(setId, "png");
  try {
    // yuva420p preserva o alfa (logo é recortado); q 82 é o mesmo patamar de
    // qualidade dos .webp que a TCGdex serve nos outros idiomas.
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", fileURLToPath(png),
      "-c:v", "libwebp", "-compression_level", "6", "-q:v", "82", "-pix_fmt", "yuva420p",
      fileURLToPath(fileUrl(setId, "webp"))]);
    await rm(png, { force: true });
  } catch { /* conversão falhou: fica o PNG */ }
}

// Resolve o thumburl de cada arquivo numa chamada só a cada 40 (limite da API).
async function resolveUrls(files) {
  const urls = new Map();
  for (let i = 0; i < files.length; i += 40) {
    const titles = files.slice(i, i + 40).map((f) => `File:${f}`).join("|");
    const query = new URLSearchParams({
      action: "query", format: "json", prop: "imageinfo",
      iiprop: "url", iiurlwidth: String(WIDTH), titles
    });
    let payload;
    try {
      const r = await fetch(`${API}?${query}`, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
      payload = await r.json();
    } catch {
      console.warn("  Aviso: falha ao consultar o Bulbagarden; seguindo com o que já veio.");
      continue;
    }
    // O MediaWiki normaliza o título (maiúscula inicial, "_" por espaço) — sem
    // desfazer isso, "neo3 Logo.png" volta como "Neo3 Logo.png" e não casa.
    const back = new Map((payload.query?.normalized || []).map((n) => [n.to, n.from]));
    for (const page of Object.values(payload.query?.pages || {})) {
      if (page.missing !== undefined) continue;
      const title = (back.get(page.title) || page.title).replace(/^File:/, "");
      const info = page.imageinfo?.[0];
      if (info) urls.set(title, info.thumburl || info.url);
    }
    await sleep(300); // educado com o wiki
  }
  return urls;
}

async function download(setId, url) {
  if (!FORCE && localFile(setId)) return "skip";
  try {
    const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
    if (!r.ok) return "fail";
    const buf = Buffer.from(await r.arrayBuffer());
    // Guarda contra página de erro: logo de set é PNG de verdade.
    if (buf.length < 200 || buf.slice(1, 4).toString("ascii") !== "PNG") return "fail";
    await mkdir(OUT, { recursive: true });
    await writeFile(fileUrl(setId, "png"), buf);
    await toWebp(setId);
    await sleep(120);
    return "ok";
  } catch { return "fail"; }
}

if (!NO_FETCH) {
  const pendentes = Object.entries(FILES).filter(([setId]) => FORCE || !localFile(setId));
  if (!pendentes.length) {
    console.log(`Logos JP: os ${Object.keys(FILES).length} já estão em data/set-logos/ja/.`);
  } else {
    console.log(`Logos JP: resolvendo ${pendentes.length} arquivo(s) no Bulbagarden Archives…`);
    const urls = await resolveUrls(pendentes.map(([, file]) => file));
    let ok = 0, skip = 0, fail = 0;
    await mapLimit(pendentes, 4, async ([setId, file]) => {
      const url = urls.get(file);
      if (!url) { fail++; console.warn(`  sem arquivo no wiki: ${setId} (${file})`); return; }
      const r = await download(setId, url);
      if (r === "ok") ok++; else if (r === "skip") skip++; else { fail++; console.warn(`  falhou: ${setId}`); }
    });
    console.log(`  baixados: ${ok} · já existiam: ${skip} · falharam: ${fail}`);
  }
}

// Carimba o setLogo nos chunks: só onde o PNG local EXISTE (mapa sem arquivo
// baixado degrada pro fallback de nome, em vez de apontar pra um 404).
let chunks = [];
try { chunks = (await readdir(CHUNKS)).filter((f) => f.endsWith(".json")); } catch {
  console.warn("Aviso: sem data/sets/ja/ (rode o sync-tcgdex antes); nada a carimbar.");
}
let rewritten = 0, cardsChanged = 0;
for (const file of chunks) {
  const setId = file.replace(/\.json$/, "");
  const local = localFile(setId);
  if (!local) continue;
  const url = new URL(file, CHUNKS);
  let cards;
  try { cards = JSON.parse(await readFile(url, "utf8")); } catch { continue; }
  let changed = false;
  for (const card of cards) {
    if (card.setLogo === local.webPath) continue;
    card.setLogo = local.webPath;
    changed = true;
    cardsChanged++;
  }
  if (changed) { await writeFile(url, JSON.stringify(cards), "utf8"); rewritten++; }
}
console.log(`Chunks JP carimbados: ${rewritten} (${cardsChanged} cartas).`);
if (!NO_FETCH) console.log(`Saída: ${fileURLToPath(OUT)} — commitar os arquivos novos.`);
