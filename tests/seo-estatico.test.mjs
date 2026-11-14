// Texto no HTML pra quem não roda JS (scripts/seo-estatico.mjs, 2026-11-14).
//
// Os robôs das IAs leem o HTML do servidor e em geral não rodam JS. Medido em
// 13/11: /about, /faq, /help, /privacy, /terms e /comparar chegavam com os
// blocos de texto vazios (o /about com 20 palavras), a /vintage sem dado
// estruturado e o /llms.txt dava 404. O que se trava aqui:
//   - todo bloco vazio das páginas de texto ganha o português, e chave sem
//     texto derruba o passo;
//   - o JSON-LD da /vintage sai da lista do HTML, na mesma ordem;
//   - o llms.txt lista todo jogo do registro, vintage com o resumo em inglês;
//   - o deploy roda o passo depois do prerender e antes do split-i18n.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PAGINAS_DE_TEXTO, mensagensPt, preencheTextos, jogosDoVintage, jsonLdDoVintage, comJsonLd, llmsTxt, montaTudo } from "../scripts/seo-estatico.mjs";
import { JOGOS_URL } from "../functions/_lib/jogos.js";

const ler = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const texto = (html) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, "")
  .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

test("bloco vazio ganha o português; o que já tem texto fica; chave sem texto derruba", () => {
  const pt = { "a.um": "<h2>Um</h2><p>texto $1 com cifrão</p>", "a.dois": "<p>dois</p>" };
  const html = `<main><section data-i18n-html="a.um"></section><section id="x" data-i18n-html="a.dois" class="y"></section><section data-i18n-html="a.dois"><p>já</p></section></main>`;
  const r = preencheTextos(html, pt);
  assert.equal(r.blocos, 2);
  assert.equal(r.html, `<main><section data-i18n-html="a.um"><h2>Um</h2><p>texto $1 com cifrão</p></section><section id="x" data-i18n-html="a.dois" class="y"><p>dois</p></section><section data-i18n-html="a.dois"><p>já</p></section></main>`);
  assert.equal(preencheTextos(r.html, pt).html, r.html, "rodar de novo não duplica");
  assert.throws(() => preencheTextos(`<section data-i18n-html="nao.existe"></section>`, pt), /nao\.existe/);
});

test("as páginas de texto do site saem sem bloco vazio e com texto de verdade", () => {
  const pt = mensagensPt();
  for (const f of PAGINAS_DE_TEXTO) {
    const { html, blocos } = preencheTextos(ler(f), pt);
    assert.ok(blocos > 0, `${f}: nenhum bloco preenchido`);
    assert.doesNotMatch(html, /data-i18n-html="[^"]+"[^>]*><\/[a-z0-9]+>/, `${f}: sobrou bloco vazio`);
    assert.ok(texto(html).split(" ").length > 150, `${f}: pouco texto no HTML`);
  }
});

test("o JSON-LD da /vintage é a lista do HTML, na mesma ordem", () => {
  const html = ler("vintage.html");
  const jogos = jogosDoVintage(html);
  const linhas = [...html.matchAll(/<li class="vt-jogo"/g)].length;
  assert.equal(jogos.length, linhas);
  const ld = jsonLdDoVintage(jogos);
  assert.equal(ld["@type"], "CollectionPage");
  assert.equal(ld.mainEntity.numberOfItems, linhas);
  const dbc = ld.mainEntity.itemListElement.find((x) => x.item.url === "https://sleevu.app/games/dragon-ball-carddass");
  assert.deepEqual(dbc.item.publisher, { "@type": "Organization", name: "Bandai" });
  assert.equal(dbc.item.datePublished, "1988-11");
  // Entra no <head>, uma vez só, mesmo rodando duas vezes.
  const uma = comJsonLd(html, ld);
  const duas = comJsonLd(uma, ld);
  assert.equal(duas, uma);
  assert.equal([...duas.matchAll(/data-gerado="seo-estatico"/g)].length, 1);
  assert.ok(duas.indexOf('data-gerado="seo-estatico"') < duas.indexOf("</head>"));
});

test("o llms.txt lista todo jogo do registro; o vintage com fabricante, anos e resumo em inglês", () => {
  const { llms, vintage } = montaTudo();
  assert.match(llms, /^# Sleevu\n\n> /);
  for (const j of JOGOS_URL) assert.ok(llms.includes(`(https://sleevu.app/games/${j.url})`), `${j.url} fora do llms.txt`);
  assert.match(llms, /- \[Dragon Ball Carddass\]\(https:\/\/sleevu\.app\/games\/dragon-ball-carddass\): Bandai, Japan, 1988–1997\. Bandai's Dragon Ball/);
  assert.ok(vintage.jogos > 0);
  // Com os mapas do prerender, a contagem de sets (e o singular certo).
  const l = llmsTxt({ jogos: [{ url: "a", nome: "A" }, { url: "b", nome: "B" }], vintage: [], sets: { a: 1, b: 12 } });
  assert.match(l, /\[A\]\(https:\/\/sleevu\.app\/games\/a\): 1 set\n/);
  assert.match(l, /\[B\]\(https:\/\/sleevu\.app\/games\/b\): 12 sets\n/);
});

test("o deploy roda o passo depois do prerender e antes do split-i18n", () => {
  const yml = ler(".github/workflows/deploy.yml");
  const passo = yml.indexOf("node scripts/seo-estatico.mjs --write");
  assert.ok(passo > 0, "passo fora do deploy");
  assert.ok(passo > yml.indexOf("node scripts/prerender-catalog.mjs"));
  assert.ok(passo < yml.indexOf("node scripts/split-i18n.mjs --write"));
});
