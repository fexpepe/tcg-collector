// Injetor de meta tags de SEO/social nas paginas HTML. Como o site e um MPA
// estatico sem template, cada <head> e independente — este script mantem o
// bloco de canonical/OpenGraph/Twitter uniforme em todas as paginas.
//
// Idempotente: remove qualquer og:/twitter:/canonical/robots existente e
// reinsere o bloco logo apos a <meta name="description">. Roda com:
//   node scripts/seo-meta.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://sleevu.app/";
const OG_IMAGE = BASE + "og-image.svg";
// Paginas que nao devem ser indexadas (conteudo dinamico ou de fluxo).
const NOINDEX = new Set(["detail.html", "login.html"]);
// Paginas a ignorar de vez (nenhuma hoje, mas deixa explicito o universo).
const SKIP = new Set([]);

function cleanUrl(file) {
  if (file === "index.html") return BASE;
  return BASE + file.replace(/\.html$/, "");
}
function attr(s) { return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;"); }

const files = readdirSync(root).filter((f) => f.endsWith(".html") && !SKIP.has(f));
let changed = 0;

for (const file of files) {
  const path = join(root, file);
  let html = readFileSync(path, "utf8");
  const before = html;

  // 1) Remove o bloco anterior (linhas de og:/twitter:/canonical/robots).
  html = html.replace(/^[ \t]*<(?:meta (?:property="og:|name="twitter:|name="robots")|link rel="canonical")[^>]*>\r?\n/gim, "");

  const titleM = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const descM = html.match(/<meta name="description" content="([^"]*)">/i);
  if (!descM) { console.log(`  - ${file}: sem <meta description>, pulado`); continue; }
  const title = titleM ? titleM[1].trim() : "Sleevu";
  const desc = descM[1];
  const url = cleanUrl(file);

  let block;
  if (NOINDEX.has(file)) {
    block = `    <meta name="robots" content="noindex, follow">\n`;
  } else {
    block = [
      `    <link rel="canonical" href="${url}">`,
      `    <meta property="og:site_name" content="Sleevu">`,
      `    <meta property="og:type" content="website">`,
      `    <meta property="og:url" content="${url}">`,
      `    <meta property="og:title" content="${attr(title)}">`,
      `    <meta property="og:description" content="${attr(desc)}">`,
      `    <meta property="og:image" content="${OG_IMAGE}">`,
      `    <meta property="og:image:width" content="1200">`,
      `    <meta property="og:image:height" content="630">`,
      `    <meta name="twitter:card" content="summary_large_image">`,
      `    <meta name="twitter:title" content="${attr(title)}">`,
      `    <meta name="twitter:description" content="${attr(desc)}">`,
      `    <meta name="twitter:image" content="${OG_IMAGE}">`,
      ""
    ].join("\n");
  }

  // 2) Insere logo apos a linha da description.
  html = html.replace(/([ \t]*<meta name="description" content="[^"]*">\r?\n)/i, `$1${block}`);

  if (html !== before) { writeFileSync(path, html); changed++; console.log(`  ✓ ${file}${NOINDEX.has(file) ? " (noindex)" : ""}`); }
}
console.log(`\n  ${changed} arquivo(s) atualizado(s)`);
