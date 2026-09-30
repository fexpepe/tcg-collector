// Dados estruturados da MARCA na home (index.html, 2026-09-30). O Google tira
// o nome do site dos resultados do WebSite da home; as páginas pré-renderizadas
// apontam pros mesmos @id. O que se trava aqui:
//   - todo bloco JSON-LD das páginas da raiz é JSON válido (um erro de vírgula
//     some calado: o navegador não reclama, o Google só ignora o bloco);
//   - a home tem WebSite e Organization com os @id que o prerender usa;
//   - o bloco fica FORA do par theme.js+game.js, que o bundle-boot funde
//     (script no meio do par reprova o deploy).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (f) => readFileSync(join(raiz, f), "utf8");
const blocos = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);

test("todo JSON-LD das páginas da raiz é JSON válido", () => {
  for (const f of readdirSync(raiz).filter((n) => n.endsWith(".html"))) {
    for (const b of blocos(ler(f))) assert.doesNotThrow(() => JSON.parse(b), `${f}: JSON-LD inválido`);
  }
});

test("a home declara o site e a organização com os @id do prerender", () => {
  const home = ler("index.html");
  const grafo = blocos(home).flatMap((b) => JSON.parse(b)["@graph"] || []);
  const site = grafo.find((n) => n["@type"] === "WebSite");
  const org = grafo.find((n) => n["@type"] === "Organization");
  assert.ok(site && org, "faltou WebSite ou Organization");
  assert.equal(site["@id"], "https://sleevu.app/#website");
  assert.equal(site.name, "Sleevu");
  assert.equal(site.url, "https://sleevu.app/");
  assert.equal(site.publisher["@id"], org["@id"]);
  assert.equal(org["@id"], "https://sleevu.app/#organization");
  assert.match(org.logo.url, /^https:\/\/sleevu\.app\/.+\.png$/);
  assert.ok(readdirSync(raiz).includes(org.logo.url.split("/").pop()), "o logo do JSON-LD não existe na raiz");
  // O prerender liga as páginas de set/artista ao WebSite e o deck à marca.
  const prerender = ler("scripts/prerender-catalog.mjs");
  assert.match(prerender, /"@id": ORIGIN \+ "\/#website"/);
  assert.match(prerender, /"@id": ORIGIN \+ "\/#organization"/);
});

test("o JSON-LD da home fica fora do par theme.js+game.js", () => {
  const home = ler("index.html");
  const par = home.slice(home.indexOf('<script src="src/theme.js">'), home.indexOf('<script src="src/game.js"'));
  assert.ok(par.length > 0, "o par theme.js+game.js sumiu da home");
  assert.doesNotMatch(par, /ld\+json/);
});
