// Prévia das páginas /deck/<slug> (og:image), 2026-10-06.
//
// A página de deck era a única do site sem og:image: colada no WhatsApp,
// chegava como texto puro. A imagem sai do deckImage() do prerender, que só
// aceita a capa do payload (data.cover, escrita pelo cliente) quando ela é a
// imagem de uma carta do PRÓPRIO deck no catálogo — URL gravada por fora não
// vira prévia no nosso domínio.
//
// O prerender roda o build inteiro ao ser importado (await main() no topo),
// então o teste lê a função do fonte, como o json-ld.test.mjs faz com o
// template.
//
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const fonte = readFileSync(join(RAIZ, "scripts/prerender-catalog.mjs"), "utf8").replace(/\r\n/g, "\n");

const corpo = (fonte.match(/\nfunction deckImage\(cover, imagens\) \{\n([\s\S]*?)\n\}\n/) || [])[1];
const deckImage = new Function("cover", "imagens", corpo);

const cartas = [
  { image: "https://img.sleevu.app/a.png", usd: 1 },
  { image: "https://img.sleevu.app/b.png", usd: 30 },
  { image: "https://img.sleevu.app/c.png", usd: 5 }
];

test("o deckImage existe no prerender", () => {
  assert.ok(corpo, "função deckImage não encontrada em scripts/prerender-catalog.mjs");
});

test("capa escolhida pelo dono vale quando é uma carta do deck", () => {
  assert.equal(deckImage("https://img.sleevu.app/c.png", cartas), "https://img.sleevu.app/c.png");
});

test("capa de fora do deck é ignorada: vale a carta mais cara", () => {
  assert.equal(deckImage("https://evil.example/x.png", cartas), "https://img.sleevu.app/b.png");
});

test("sem capa, a carta mais cara; sem preço nenhum, a primeira", () => {
  assert.equal(deckImage(null, cartas), "https://img.sleevu.app/b.png");
  assert.equal(deckImage(null, [{ image: "p.png", usd: 0 }, { image: "q.png", usd: 0 }]), "p.png");
});

test("deck sem carta achada no catálogo não inventa imagem", () => {
  assert.equal(deckImage("https://img.sleevu.app/a.png", []), "");
});

test("o template do deck publica og:image e twitter:image", () => {
  const tpl = (fonte.match(/\nfunction deckPageHtml\(dp\) \{\n([\s\S]*?)\n\}\n/) || [])[1] || "";
  assert.match(tpl, /<meta property="og:image" content="\$\{escapeAttr\(ogImage\)\}">/);
  assert.match(tpl, /<meta name="twitter:image" content="\$\{escapeAttr\(ogImage\)\}">/);
  assert.match(tpl, /const ogImage = absUrl\(image\) \|\| `\$\{ORIGIN\}\/og-image\.png`;/);
});
