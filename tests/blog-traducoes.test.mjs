// Blog em três idiomas (2026-10-06, migração 20261006a): um post, uma versão
// por idioma, cada uma no seu endereço e o post acompanhando a bandeirinha.
//
// O que se trava aqui:
//   - versao(): a tradução no lugar dos campos de texto, sem herdar texto da
//     original; idioma sem versão cai na original;
//   - endereços: /blog/<slug> pra original, /blog/<idioma>/<slug> pras
//     traduções — o MESMO no renderizador e no sitemap;
//   - "Leia em" só com mais de uma versão, com a aberta marcada;
//   - lista na língua de quem lê, com a etiqueta do idioma quando falta versão;
//   - meta da borda: canonical da versão, hreflang de todas + x-default;
//   - redirecionamentos da borda: idioma original no endereço = 301, tradução
//     que não existe = 302, maiúscula e endereço antigo mantêm o idioma.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/blog-render.js";
import { metaDoPost, paginaDoPost } from "../functions/blog/[slug].js";
import { enderecosDoPost } from "../scripts/lib/sitemap.mjs";

const B = globalThis.SleevuBlog;

const TRADUCAO_EN = {
  title: "The grails of the 2002 Naruto Card Game", subtitle: "", excerpt: "Promos and foils.",
  body_md: "When Bandai put out the game.\n\n::card[naruto/nrt-PRN-001R]\n", cover_alt: "Foil promo",
  seo_title: "", seo_desc: ""
};
const POST = {
  id: "11111111-1111-1111-1111-111111111111", slug: "naruto-card-game-2002-grails", lang: "pt",
  title: "Os graals do Naruto Card Game de 2002", subtitle: "Linha fina", excerpt: "As promos.",
  body_md: "Quando a Bandai lançou o jogo.\n\n::card[naruto/nrt-PRN-001R]\n", cover_alt: "Promo foil",
  cover_url: "", game: "naruto", category: "historia", tags: [], seo_title: "SEO em pt", seo_desc: "Desc pt",
  author_name: "Fernando", reading_min: 4, published_at: "2026-10-06T12:00:00Z", updated_at: "2026-10-06T12:00:00Z",
  traducoes: { en: TRADUCAO_EN }, versoes: { en: { title: TRADUCAO_EN.title, subtitle: "", excerpt: "Promos and foils.", cover_alt: "Foil promo", reading_min: 2 } }
};

test("versao(): tradução no lugar dos campos de texto, sem herdar o SEO da original", () => {
  const v = B.versao(POST, "en");
  assert.equal(v.lang, "en");
  assert.equal(v.original, "pt");
  assert.equal(v.title, TRADUCAO_EN.title);
  assert.equal(v.body_md, TRADUCAO_EN.body_md);
  assert.equal(v.subtitle, "", "linha fina vazia na tradução não puxa a do português");
  assert.equal(v.seo_title, "", "SEO vazio fica vazio (a página cai no título da própria versão)");
  assert.equal(v.reading_min, 2, "tempo de leitura da tradução (versoes)");
  assert.deepEqual(v.idiomas, ["pt", "en"]);
  assert.deepEqual(v.caminhos, { pt: "/blog/naruto-card-game-2002-grails", en: "/blog/en/naruto-card-game-2002-grails" });
  assert.equal(v.caminho, "/blog/en/naruto-card-game-2002-grails");
  // Campos do post (não da versão) seguem os mesmos.
  assert.equal(v.slug, POST.slug);
  assert.equal(v.game, "naruto");
});

test("versao(): idioma sem versão (ou inventado) é a original; sem versoes nem traducoes, um idioma só", () => {
  for (const l of ["es", "pt", "ja", "", undefined]) {
    const v = B.versao(POST, l);
    assert.equal(v.lang, "pt", String(l));
    assert.equal(v.title, POST.title);
    assert.equal(v.caminho, "/blog/naruto-card-game-2002-grails");
  }
  const sozinho = B.versao({ slug: "a-b", lang: "en", title: "Hi" }, "pt");
  assert.deepEqual(sozinho.idiomas, ["en"]);
  assert.equal(sozinho.lang, "en");
  // A linha da LISTA só tem o resumo leve: a versão sai sem texto (a lista não usa).
  const daLista = B.versao({ slug: "a-b", lang: "pt", title: "Oi", versoes: { es: { title: "Hola", reading_min: 3 } } }, "es");
  assert.equal(daLista.title, "Hola");
  assert.equal(daLista.body_md, "");
  assert.equal(daLista.reading_min, 3);
});

test("versao(): sem o tempo do banco (prévia do editor), conta as palavras da tradução", () => {
  const v = B.versao({ slug: "a-b", lang: "pt", title: "Oi", traducoes: { en: { title: "Hi", body_md: "word ".repeat(700) } } }, "en");
  assert.equal(v.reading_min, 3);
});

test("endereços: o sitemap e o renderizador usam a mesma regra", () => {
  const linhas = [
    { slug: "a-b", lang: "pt", versoes: { en: {}, es: {} } },
    { slug: "c-d", lang: "en", versoes: { pt: {} } },
    { slug: "e-f", lang: "es", versoes: {} },
    { slug: "g-h" } // migração 20261006a ainda não aplicada: sem lang nem versoes
  ];
  for (const p of linhas) {
    const v = B.versao(p, "pt");
    assert.deepEqual(enderecosDoPost(p), v.idiomas.map((l) => v.caminhos[l]), p.slug);
  }
  assert.deepEqual(enderecosDoPost(linhas[0]), ["/blog/a-b", "/blog/en/a-b", "/blog/es/a-b"]);
  assert.deepEqual(enderecosDoPost(linhas[1]), ["/blog/c-d", "/blog/pt/c-d"]);
});

test("\"Leia em\": só com mais de uma versão, a aberta marcada e as outras com link, hreflang e data-idioma", () => {
  assert.equal(B.versoesHtml(B.versao({ slug: "a-b", lang: "pt", title: "Oi" }, "pt")), "");
  const html = B.versoesHtml(B.versao(POST, "en"));
  assert.ok(html.includes('aria-label="Read in"'), "rótulo no idioma da página");
  assert.ok(html.includes('<span class="blog-versao is-on" aria-current="true" lang="en">English</span>'));
  assert.ok(html.includes('<a class="blog-versao" href="/blog/naruto-card-game-2002-grails" hreflang="pt-BR" lang="pt-BR" data-idioma="pt">Português</a>'));
  // Vai no cabeçalho do post (logo depois da linha do autor).
  const pagina = B.paginaDoPostHtml(B.versao(POST, "en"), B.render(TRADUCAO_EN.body_md, { lang: "en" }), {});
  assert.ok(pagina.indexOf("blog-byline") < pagina.indexOf("blog-versoes"));
  assert.ok(pagina.includes('<article class="blog-article" lang="en-US">'));
  assert.ok(pagina.includes("<h1 class=\"blog-title\">The grails of the 2002 Naruto Card Game</h1>"));
  assert.ok(pagina.includes('data-url="https://sleevu.app/blog/en/naruto-card-game-2002-grails"'), "compartilhar leva o endereço da versão");
});

test("lista: cada post na versão de quem lê; sem a versão, a original com a etiqueta do idioma", () => {
  const outro = { slug: "so-em-portugues", lang: "pt", title: "Só em português", excerpt: "Resumo", category: "guias", reading_min: 2, versoes: {} };
  const html = B.listaHtml([POST, outro], "en");
  assert.ok(html.includes('href="/blog/en/naruto-card-game-2002-grails"'), "link pra versão de quem lê");
  assert.ok(html.includes(">The grails of the 2002 Naruto Card Game<"));
  assert.ok(html.includes('<span class="blog-item-title" lang="pt-BR">Só em português</span>'), "título marcado com o idioma dele");
  assert.ok(html.includes('<span class="blog-item-lang">In Portuguese</span>'));
  assert.ok(html.includes("2 min read"), "moldura no idioma de quem lê");
  // Sem leitor (a borda), tudo na original e sem etiqueta.
  const daBorda = B.listaHtml([POST, outro]);
  assert.ok(daBorda.includes('href="/blog/naruto-card-game-2002-grails"'));
  assert.ok(!daBorda.includes("blog-item-lang"));
  // "Leia também" na língua da página.
  const rel = B.relacionadosHtml([POST], "en");
  assert.ok(rel.includes("Keep reading") && rel.includes('href="/blog/en/naruto-card-game-2002-grails"'));
});

test("meta da borda: canonical da versão, hreflang de todas + x-default na original", () => {
  const m = metaDoPost(B.versao(POST, "en"));
  assert.equal(m.lang, "en");
  assert.equal(m.canonical, "https://sleevu.app/blog/en/naruto-card-game-2002-grails");
  assert.equal(m.titulo, "The grails of the 2002 Naruto Card Game | Sleevu", "SEO vazio da tradução cai no título dela, não no SEO em pt");
  assert.equal(m.desc, "Promos and foils.");
  assert.equal(m.jsonLd["@graph"][0].inLanguage, "en-US");
  assert.deepEqual(m.alternativas, [
    { hreflang: "pt-BR", href: "https://sleevu.app/blog/naruto-card-game-2002-grails" },
    { hreflang: "en", href: "https://sleevu.app/blog/en/naruto-card-game-2002-grails" },
    { hreflang: "x-default", href: "https://sleevu.app/blog/naruto-card-game-2002-grails" }
  ]);
  const original = metaDoPost(POST);
  assert.equal(original.canonical, "https://sleevu.app/blog/naruto-card-game-2002-grails");
  assert.equal(original.titulo, "SEO em pt | Sleevu");
  assert.equal(original.alternativas.length, 3);
  assert.deepEqual(metaDoPost(Object.assign({}, POST, { traducoes: {}, versoes: {} })).alternativas, [], "um idioma só: sem hreflang");
});

// Borda sem HTMLRewriter: os redirecionamentos saem ANTES de montar a página,
// então dá pra conferir com um Supabase de mentira.
async function pedeNaBorda(caminho, { pedido = "", slug, post = POST, redirecionaPara = null } = {}) {
  const fetchAntes = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    let corpo = [];
    if (u.includes("/rest/v1/posts?slug=eq.")) corpo = post && u.includes("slug=eq." + post.slug + "&") ? [post] : [];
    else if (u.includes("/rest/v1/post_redirects")) corpo = redirecionaPara ? [{ post_id: post.id }] : [];
    else if (u.includes("/rest/v1/posts?id=eq.")) corpo = redirecionaPara ? [{ slug: redirecionaPara }] : [];
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const env = { BLOG_SUPABASE_URL: "https://supabase.teste", ASSETS: { fetch: async () => new Response("404", { status: 404 }) } };
    return await paginaDoPost({ params: { slug }, env, request: new Request("https://sleevu.app" + caminho), waitUntil: () => {} }, pedido);
  } finally { globalThis.fetch = fetchAntes; }
}

test("borda: /blog/<idioma>/<slug> no idioma original = 301 pro endereço sem prefixo", async () => {
  const r = await pedeNaBorda("/blog/pt/naruto-card-game-2002-grails", { pedido: "pt", slug: POST.slug });
  assert.equal(r.status, 301);
  assert.equal(r.headers.get("location"), "https://sleevu.app/blog/naruto-card-game-2002-grails");
});

test("borda: tradução que não existe = 302 pra original (pode aparecer depois)", async () => {
  const r = await pedeNaBorda("/blog/es/naruto-card-game-2002-grails", { pedido: "es", slug: POST.slug });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "https://sleevu.app/blog/naruto-card-game-2002-grails");
});

test("borda: maiúscula e endereço antigo mantêm o idioma do endereço", async () => {
  const maiuscula = await pedeNaBorda("/blog/en/Naruto-Card-Game-2002-Grails", { pedido: "en", slug: "Naruto-Card-Game-2002-Grails" });
  assert.equal(maiuscula.status, 301);
  assert.equal(maiuscula.headers.get("location"), "https://sleevu.app/blog/en/naruto-card-game-2002-grails");
  const antigo = await pedeNaBorda("/blog/en/endereco-antigo", { pedido: "en", slug: "endereco-antigo", redirecionaPara: POST.slug });
  assert.equal(antigo.status, 301);
  assert.equal(antigo.headers.get("location"), "https://sleevu.app/blog/en/naruto-card-game-2002-grails");
});
