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
//   - o llms.txt lista os posts do blog (2026-11-19: no dia do primeiro post
//     ele não tinha uma linha do blog), na versão em inglês quando existe;
//   - o deploy roda o passo depois do prerender e antes do split-i18n.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PAGINAS_DE_TEXTO, mensagensPt, preencheTextos, jogosDoVintage, jsonLdDoVintage, comJsonLd, llmsTxt, postsDoLlms, montaTudo } from "../scripts/seo-estatico.mjs";
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

// O blog no llms.txt (2026-11-19). O arquivo é em inglês: o post entra na
// versão em inglês quando ela existe, no endereço dela; sem ela, na original,
// dizendo o idioma.
test("o llms.txt lista os posts do blog, em inglês quando há versão em inglês", () => {
  const posts = [
    { slug: "bandai-carddass-history", lang: "en", title: "Bandai Carddass and the 20-Yen\n  Anime Card Boom", excerpt: "In 1988, 20 yen got you one card.", versoes: {} },
    { slug: "guia-de-condicao", lang: "pt", title: "Guia de condição", excerpt: "NM, SP ou MP?", versoes: { en: { title: "Card condition guide [NM, SP, MP]", excerpt: "NM, SP or MP?" }, es: { title: "Guía de condición", excerpt: "" } } },
    { slug: "mercado-de-novembro", lang: "pt", title: "Mercado de novembro", excerpt: "", versoes: { en: { title: "  ", excerpt: "sem título não é versão" } } },
    { slug: "sin-traduccion", lang: "es", title: "Sin traducción", excerpt: "Resumen.", versoes: {} },
    { slug: "sem-titulo", lang: "en", title: "", excerpt: "fica de fora" },
    { slug: "Endereço Torto", lang: "en", title: "Endereço que a Function não serviria" }
  ];
  const linhas = postsDoLlms(posts);
  assert.deepEqual(linhas.map((p) => [p.caminho, p.idioma]), [
    ["/blog/bandai-carddass-history", "en"],
    ["/blog/en/guia-de-condicao", "en"],
    ["/blog/mercado-de-novembro", "pt"],
    ["/blog/sin-traduccion", "es"]
  ]);
  const l = llmsTxt({ jogos: [{ url: "a", nome: "A" }], vintage: [], posts });
  const blog = l.slice(l.indexOf("## Blog"), l.indexOf("## Pages"));
  assert.equal(blog, [
    "## Blog",
    "",
    "- [Bandai Carddass and the 20-Yen Anime Card Boom](https://sleevu.app/blog/bandai-carddass-history): In 1988, 20 yen got you one card.",
    "- [Card condition guide (NM, SP, MP)](https://sleevu.app/blog/en/guia-de-condicao): NM, SP or MP?",
    "- [Mercado de novembro](https://sleevu.app/blog/mercado-de-novembro) (in Portuguese)",
    "- [Sin traducción](https://sleevu.app/blog/sin-traduccion): Resumen. (in Spanish)",
    "",
    ""
  ].join("\n"));
  assert.ok(l.indexOf("## Card games in print") < l.indexOf("## Blog"), "o blog vem depois dos jogos");
  assert.match(l, /- \[Blog\]\(https:\/\/sleevu\.app\/blog\): /);
  // A lista de todos os jogos é a /games (o /hub só tem os em atividade).
  assert.match(l, /- \[All games\]\(https:\/\/sleevu\.app\/games\): /);
});

// O /blog sem post leva noindex e fica fora do sitemap; no llms.txt, idem.
test("sem post publicado o llms.txt não cita o blog", () => {
  for (const posts of [undefined, [], [{ slug: "so-rascunho", lang: "pt", title: "" }]]) {
    const l = llmsTxt({ jogos: [{ url: "a", nome: "A" }], vintage: [], posts });
    assert.ok(!l.includes("## Blog") && !l.includes("sleevu.app/blog"), "blog citado sem post");
    assert.match(l, /in print\n\n- \[A\]\(https:\/\/sleevu\.app\/games\/a\)\n\n## Pages\n/);
  }
});

// Quem entrega os posts é o prerender, que roda antes e já os busca pro
// sitemap: o seo-estatico não vai à rede. O que ele grava tem que ser o que o
// postsDoLlms lê.
test("o prerender pede título e resumo dos posts e os grava onde o llms.txt lê", () => {
  const prerender = ler("scripts/prerender-catalog.mjs");
  assert.match(prerender, /pede\("slug,title,excerpt,lang,versoes,updated_at"\)/);
  assert.match(prerender, /join\(MAPAS_DIR, "blog\.json"\)[^\n]*\n\s*slug: p\.slug, lang: [^\n]*title: [^\n]*excerpt: [^\n]*versoes: /);
  assert.match(ler("scripts/seo-estatico.mjs"), /lerJson\(`\$\{raiz\}data\/game-pages\/blog\.json`\)/);
});

// A política de uso de 16/11/2026 (a mesma do robots.txt e dos Termos): o texto
// é aberto, inclusive pra treino; imagem e extração em massa, não.
test("o llms.txt diz o que pode e o que não pode fazer com o conteúdo", () => {
  const { llms } = montaTudo();
  const uso = llms.slice(llms.indexOf("## Using this content"));
  assert.ok(llms.includes("## Using this content"), "seção de uso fora do llms.txt");
  assert.match(uso, /train models on their text/);
  assert.match(uso, /Card images .* not licensed for AI training/);
  assert.match(uso, /https:\/\/img\.sleevu\.app\/robots\.txt/);
  assert.match(uso, /Bulk extraction .* not allowed/);
  assert.match(uso, /https:\/\/sleevu\.app\/terms#uso-do-catalogo/);
});

test("o deploy roda o passo depois do prerender e antes do split-i18n", () => {
  const yml = ler(".github/workflows/deploy.yml");
  const passo = yml.indexOf("node scripts/seo-estatico.mjs --write");
  assert.ok(passo > 0, "passo fora do deploy");
  assert.ok(passo > yml.indexOf("node scripts/prerender-catalog.mjs"));
  assert.ok(passo < yml.indexOf("node scripts/split-i18n.mjs --write"));
});
