// Espelha os LOGOS e SÍMBOLOS de set do Pokémon localmente — tira o site da
// dependência do CDN da TCGdex pra arte de set (as CARTAS continuam remotas: são
// caras de hospedar; logo/símbolo são poucos KB e mudam raramente).
//
// Roda no BUILD DEPOIS do merge-catalogs (que reescreve os chunks). Varre
// data/sets/<lang>/*.json, baixa cada logo/símbolo .webp uma vez pra
// data/set-logos/ e reescreve os campos setLogo/setSymbol dos chunks pro caminho
// local. O tcgdexAssetUrl() do front deixa passar qualquer URL que não seja da
// TCGdex, então o caminho local carrega direto (sem transformar, sem fallback
// remoto). Idempotente: re-rodar não baixa de novo (skip-if-exists) e só reescreve
// URLs ainda remotas — igual ao mirror-vintage-images.mjs.
//
// Layout (espelha o path da TCGdex, colapsado por setId, que já é único):
//   logo   {lang}/{serie}/{setId}/logo.png    -> data/set-logos/{lang}/{setId}.webp
//   símbolo /univ/{serie}/{setId}/symbol.png  -> data/set-logos/symbol/{setId}.webp
//
// Rodar LOCAL (rede aberta) e COMMITAR os arquivos novos.
//   node scripts/mirror-set-logos.mjs [--force]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { mapLimit, sleep } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const SETS_DIR = new URL("data/sets/", ROOT);
const OUT = new URL("data/set-logos/", ROOT);
const FORCE = process.argv.includes("--force");

// URL de arte de set da TCGdex -> descritor. Só logo/symbol (não as cartas).
// Sempre terminam em .png (imageUrl() do sync-tcgdex anexa ".png" sem qualidade).
const RE = /^https?:\/\/assets\.tcgdex\.net\/([^/]+)\/([^/]+)\/([^/]+)\/(logo|symbol)\.(?:png|webp)(?:\?.*)?$/;
function parse(url) {
  const m = typeof url === "string" && url.match(RE);
  if (!m) return null;
  const [, lang, , setId, kind] = m;
  // setId pode ter ponto (sv03.5) — válido em nome de arquivo.
  const webPath = kind === "symbol"
    ? `data/set-logos/symbol/${setId}.webp`
    : `data/set-logos/${lang}/${setId}.webp`;
  const downloadUrl = url.replace(/\.(png|webp)(\?.*)?$/, ".webp");
  return { webPath, downloadUrl };
}

async function listChunks() {
  const files = [];
  for (const lang of await readdir(SETS_DIR)) {
    const dir = new URL(`${lang}/`, SETS_DIR);
    let entries;
    try { entries = await readdir(dir); } catch { continue; } // não é diretório
    for (const f of entries) if (f.endsWith(".json")) files.push(new URL(f, dir));
  }
  return files;
}

async function download(descriptor) {
  const dest = new URL(descriptor.webPath.replace(/^data\/set-logos\//, ""), OUT);
  if (!FORCE && existsSync(dest)) return "skip";
  try {
    const r = await fetch(descriptor.downloadUrl, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return "fail";
    const buf = Buffer.from(await r.arrayBuffer());
    // Guarda contra páginas de erro: arte de set é webp de verdade (RIFF/WEBP).
    if (buf.length < 200 || buf.slice(0, 4).toString("ascii") !== "RIFF") return "fail";
    await mkdir(new URL(".", dest), { recursive: true });
    await writeFile(dest, buf);
    await sleep(80); // educado com o CDN
    return "ok";
  } catch { return "fail"; }
}

const chunks = await listChunks();

// 1) Coleta as URLs distintas de logo/símbolo (são dados de SET: iguais em todas
// as cartas do chunk, mas varremos tudo pra não depender de "a 1ª carta tem").
const byUrl = new Map(); // url remota -> descritor
for (const file of chunks) {
  let cards;
  try { cards = JSON.parse(await readFile(file, "utf8")); } catch { continue; }
  for (const c of cards) {
    for (const key of ["setLogo", "setSymbol"]) {
      const d = parse(c[key]);
      if (d && !byUrl.has(c[key])) byUrl.set(c[key], d);
    }
  }
}
console.log(`${byUrl.size} artes de set distintas na TCGdex; baixando as que faltam…`);

// 2) Baixa as que faltam (skip-if-exists). Guarda quais existem local pra saber
// quais URLs é seguro reescrever.
await mkdir(OUT, { recursive: true });
let ok = 0, skip = 0, fail = 0;
await mapLimit([...byUrl.values()], 6, async (d) => {
  const r = await download(d);
  if (r === "ok") ok++; else if (r === "skip") skip++; else fail++;
});
console.log(`  baixadas: ${ok} · já existiam: ${skip} · falharam: ${fail}`);

const have = (webPath) => existsSync(new URL(webPath.replace(/^data\/set-logos\//, ""), OUT));

// 3) Reescreve os chunks: URL remota -> caminho local, SÓ quando o arquivo local
// existe (download que falhou fica na URL remota, degrada gracioso). Escreve o
// chunk só se algo mudou.
let rewritten = 0, cardsChanged = 0;
for (const file of chunks) {
  let cards;
  try { cards = JSON.parse(await readFile(file, "utf8")); } catch { continue; }
  let changed = false;
  for (const c of cards) {
    for (const key of ["setLogo", "setSymbol"]) {
      const d = parse(c[key]);
      if (d && have(d.webPath)) { c[key] = d.webPath; changed = true; cardsChanged++; }
    }
  }
  if (changed) { await writeFile(file, JSON.stringify(cards), "utf8"); rewritten++; }
}
console.log(`Chunks reescritos: ${rewritten} (${cardsChanged} campos localizados).`);
console.log(`Saída: ${fileURLToPath(OUT)} — commitar os arquivos novos.`);
