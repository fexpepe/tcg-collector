// Sitemap em índice (scripts/lib/sitemap.mjs, 2026-09-30): o sitemap.xml
// virou índice, com um arquivo por tipo de página, pro Search Console mostrar
// a cobertura de cada tipo. O que se trava aqui:
//   - o índice aponta só pros tipos que têm página (arquivo vazio é aviso);
//   - o leitor (usado pelo IndexNow) devolve o que o montador escreveu, seja
//     índice, seja lista, inclusive com & escapado;
//   - o robots.txt continua anunciando o sitemap.xml, que é o índice.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { montaSitemaps, lerSitemap } from "../scripts/lib/sitemap.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const O = "https://sleevu.app";

test("índice só com os tipos que têm página, na ordem dada", () => {
  const arq = montaSitemaps(O, [
    ["sitemap-paginas.xml", [`${O}/`, `${O}/hub`]],
    ["sitemap-sets.xml", [`${O}/set/base-set`]],
    ["sitemap-decks.xml", []]
  ]);
  assert.deepEqual(Object.keys(arq).sort(), ["sitemap-paginas.xml", "sitemap-sets.xml", "sitemap.xml"]);
  const indice = lerSitemap(arq["sitemap.xml"]);
  assert.equal(indice.indice, true);
  assert.deepEqual(indice.locs, [`${O}/sitemap-paginas.xml`, `${O}/sitemap-sets.xml`]);
  assert.match(arq["sitemap.xml"], /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
});

test("lista de URLs volta igual pelo leitor, com & escapado no XML", () => {
  const urls = [`${O}/`, `${O}/set/a&b`];
  const arq = montaSitemaps(O, [["sitemap-x.xml", urls]]);
  assert.match(arq["sitemap-x.xml"], /<loc>https:\/\/sleevu\.app\/set\/a&amp;b<\/loc>/);
  assert.match(arq["sitemap-x.xml"], /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.deepEqual(lerSitemap(arq["sitemap-x.xml"]), { indice: false, locs: urls });
});

test("post do blog leva lastmod; entrada sem data sai sem o campo", () => {
  const arq = montaSitemaps(O, [["sitemap-blog.xml", [
    { loc: `${O}/blog/guia-151`, lastmod: "2026-09-30" },
    { loc: `${O}/blog/sem-data`, lastmod: "" }
  ]]]);
  assert.match(arq["sitemap-blog.xml"], /<url><loc>https:\/\/sleevu\.app\/blog\/guia-151<\/loc><lastmod>2026-09-30<\/lastmod><\/url>/);
  assert.match(arq["sitemap-blog.xml"], /<url><loc>https:\/\/sleevu\.app\/blog\/sem-data<\/loc><\/url>/);
  assert.deepEqual(lerSitemap(arq["sitemap-blog.xml"]).locs, [`${O}/blog/guia-151`, `${O}/blog/sem-data`]);
});

test("o leitor entende o sitemap antigo (uma lista só, sem índice)", () => {
  // É o que está no ar no primeiro deploy depois da mudança.
  const antigo = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://sleevu.app/</loc></url>
  <url><loc>https://sleevu.app/set/sv03-5-151</loc></url>
</urlset>
`;
  assert.deepEqual(lerSitemap(antigo), { indice: false, locs: [`${O}/`, `${O}/set/sv03-5-151`] });
});

test("robots.txt anuncia o índice", () => {
  const robots = readFileSync(join(raiz, "robots.txt"), "utf8");
  assert.match(robots, /^Sitemap: https:\/\/sleevu\.app\/sitemap\.xml$/m);
});
