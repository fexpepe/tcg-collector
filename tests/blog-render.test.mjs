// Renderizador do blog (src/blog-render.js): o texto do post → HTML.
//
// Três coisas que não podem quebrar caladas:
//   1. SEGURANÇA — o post é escrito por editor, mas conta de editor vaza. Nada
//      do texto pode virar tag, atributo de evento ou link javascript:.
//   2. As duas leituras do mesmo texto — a do renderizador (o que a página
//      desenha) e a do trigger do banco (card_refs, que alimenta o "aparece
//      nestes artigos") — contam as mesmas cartas.
//   3. As cópias que o renderizador carrega porque a borda não tem o
//      shared.js: a lista de hosts de imagem (a CSP do _headers) e a tabela
//      de jogos (GAME_COLOR + rótulos do i18n).
//
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

import "../src/blog-render.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
// Normaliza CRLF: a checkout Windows do repo usa core.autocrlf=true.
const ler = (p) => readFileSync(join(RAIZ, p), "utf8").replace(/\r\n/g, "\n");
const B = globalThis.SleevuBlog;

const CARTAS = {
  "pokemon/base1-4": { name: "Charizard", set: "Base Set", setId: "base1", number: "4/102", image: "https://assets.tcgdex.net/en/base/base1/4", price: "US$ 350,00" },
  "pokemon/base1-2": { name: "Blastoise", set: "Base Set", setId: "base1", number: "2/102", image: "https://assets.tcgdex.net/en/base/base1/2", price: "" },
  "lorcana/abc": { name: "Elsa <b>", set: "The First Chapter", number: "42", image: "https://evil.example/x.png", price: "" }
};
const comCartas = (extra) => Object.assign({ card: (ref) => CARTAS[ref] || null }, extra);

// ── Sintaxe ────────────────────────────────────────────────────────────────
test("títulos: # e ## viram h2, ### h3; ids únicos e índice só com h2/h3", () => {
  const r = B.render("# Começo\n\n## Começo\n\n### Ação & Reação\n\n#### Menor");
  assert.match(r.html, /<h2 id="comeco">Começo<\/h2>/);
  assert.match(r.html, /<h2 id="comeco-2">Começo<\/h2>/);
  assert.match(r.html, /<h3 id="acao-reacao">Ação &amp; Reação<\/h3>/);
  assert.match(r.html, /<h4 id="menor">Menor<\/h4>/);
  assert.deepEqual(r.toc.map((h) => [h.id, h.level]), [["comeco", 2], ["comeco-2", 2], ["acao-reacao", 3]]);
});

test("parágrafo: Enter simples vira <br>, linha em branco separa", () => {
  const r = B.render("linha um\nlinha dois\n\noutro parágrafo");
  assert.equal(r.html, "<p>linha um<br>linha dois</p>\n<p>outro parágrafo</p>\n");
});

test("inline: negrito, itálico, riscado, código, escape", () => {
  const h = B.inline("**n** *i* _i2_ ~~r~~ `a < b` \\*literal\\* nome_de_arquivo");
  assert.equal(h, "<strong>n</strong> <em>i</em> <em>i2</em> <del>r</del> <code>a &lt; b</code> *literal* nome_de_arquivo");
  assert.equal(B.inline("**negrito com *itálico* dentro**"), "<strong>negrito com <em>itálico</em> dentro</strong>");
  assert.equal(B.inline("crase ``sem par"), "crase ``sem par");
});

test("links: internos na mesma aba, externos com target+noopener, URL solta vira link sem a pontuação", () => {
  assert.equal(B.inline("[Sets](/sets)"), '<a href="/sets">Sets</a>');
  assert.equal(B.inline("[x](https://sleevu.app/decks)"), '<a href="https://sleevu.app/decks">x</a>');
  assert.equal(B.inline('[TCGplayer](https://www.tcgplayer.com/x "loja")'), '<a href="https://www.tcgplayer.com/x" title="loja" target="_blank" rel="noopener">TCGplayer</a>');
  assert.equal(B.inline("veja https://example.com/a."), 'veja <a href="https://example.com/a" target="_blank" rel="noopener">https://example.com/a</a>.');
  assert.equal(B.inline("(https://example.com/a)"), '(<a href="https://example.com/a" target="_blank" rel="noopener">https://example.com/a</a>)');
  assert.equal(B.inline("[wiki](https://en.wikipedia.org/wiki/X_(y))"), '<a href="https://en.wikipedia.org/wiki/X_(y)" target="_blank" rel="noopener">wiki</a>');
});

test("listas: ul, ol com início, sub-lista e continuação", () => {
  assert.equal(B.render("- a\n- b").html, "<ul><li>a</li><li>b</li></ul>\n");
  assert.equal(B.render("3. c\n4. d").html, '<ol start="3"><li>c</li><li>d</li></ol>\n');
  assert.equal(B.render("- a\n  - a1\n  - a2\n- b").html, "<ul><li>a<ul><li>a1</li><li>a2</li></ul>\n</li><li>b</li></ul>\n");
  assert.equal(B.render("- a\n  continua\n- b").html, "<ul><li>a<br>continua</li><li>b</li></ul>\n");
  assert.equal(B.render("- a\n\n- b").html, "<ul><li>a</li><li>b</li></ul>\n", "linha em branco entre itens mantém a lista");
});

test("item recuado no começo do bloco não trava (o laço sempre anda)", () => {
  const r = B.render("  - recuado\n  - outro\ntexto");
  assert.match(r.html, /<ul><li>recuado<\/li><li>outro<\/li><\/ul>/);
});

test("citação, linha, tabela com alinhamento, código", () => {
  assert.equal(B.render("> dito\n> por alguém").html, "<blockquote><p>dito<br>por alguém</p>\n</blockquote>\n");
  assert.equal(B.render("---").html, "<hr>\n");
  const t = B.render("| Carta | Preço |\n|:---|---:|\n| Charizard | US$ 350 |\n| a \\| b | 1 |").html;
  assert.match(t, /^<div class="blog-table"><table><thead><tr><th style="text-align:left">|<th>Carta/);
  assert.match(t, /<th style="text-align:right">Preço<\/th>/);
  assert.match(t, /<td>a \| b<\/td>/);
  assert.equal(B.render("```\n<b>x</b>\n```").html, '<pre class="blog-code"><code>&lt;b&gt;x&lt;/b&gt;</code></pre>\n');
});

test("caixas: dica/info/alerta com título; palavra desconhecida vira info com a palavra no título", () => {
  const r = B.render(":::dica Guarde a nota\nTexto **forte**.\n:::");
  assert.equal(r.html, '<aside class="blog-callout blog-callout--tip"><p class="blog-callout-title">Guarde a nota</p><p>Texto <strong>forte</strong>.</p>\n</aside>\n');
  assert.match(B.render(":::alerta\nx\n:::").html, /blog-callout--warn/);
  assert.match(B.render(":::Curiosidade da semana\nx\n:::").html, /blog-callout--info"><p class="blog-callout-title">Curiosidade da semana</);
});

test("imagem do Storage do blog ganha medidas e srcset com a versão de 640", () => {
  const url = "https://dlnalopazitfdgnmdguu.supabase.co/storage/v1/object/public/blog-media/2026/09/capa-ab12cd-w1600h900.webp";
  const h = B.render(`![Charizard na mesa](${url} "Foto: arquivo")`).html;
  assert.match(h, /<figure class="blog-figure"><img src="[^"]+-w1600h900\.webp" srcset="[^"]+-w640h360\.webp 640w, [^"]+-w1600h900\.webp 1600w"/);
  assert.match(h, /width="1600" height="900" alt="Charizard na mesa"/);
  assert.match(h, /<figcaption>Foto: arquivo<\/figcaption>/);
  assert.equal(B.imagemPequena(url).endsWith("-w640h360.webp"), true);
  assert.equal(B.mediaInfo("https://x/y.webp"), null);
  // Plano B do editor (navegador sem WebP): JPEG com as mesmas medidas no nome.
  const jpg = url.replace(".webp", ".jpg");
  assert.deepEqual(B.mediaInfo(jpg), { w: 1600, h: 900, small: jpg.replace("-w1600h900.jpg", "-w640h360.jpg") });
  // Imagem pequena (até 640) não tem versão menor.
  assert.equal(B.mediaInfo(url.replace("-w1600h900", "-w600h400")).small, "");
});

// ── Cartas ─────────────────────────────────────────────────────────────────
test("::card desenha a carta com imagem, set, preço, link canônico e o slot de ações", () => {
  const r = B.render("::card[pokemon/base1-4]", comCartas());
  assert.match(r.html, /^<figure class="blog-card-one" data-card-ref="pokemon\/base1-4">/);
  assert.match(r.html, /<img src="https:\/\/assets\.tcgdex\.net\/en\/base\/base1\/4\/high\.webp"[^>]* alt="Charizard"[^>]* data-card-img data-img-fallbacks="https:\/\/assets\.tcgdex\.net\/en\/base\/base1\/4\/high\.png">/);
  assert.match(r.html, /href="\/detail\?type=set&amp;name=Base%20Set&amp;card=base1-4&amp;setId=base1&amp;game=pokemon"/);
  assert.match(r.html, /<span class="blog-card-set">Base Set · 4\/102<\/span>/);
  assert.match(r.html, /<span class="blog-card-price" data-card-price>US\$ 350,00<\/span>/);
  assert.match(r.html, /data-card-actions/);
  assert.deepEqual(r.refs, ["pokemon/base1-4"]);
});

test("::cards desenha a grade com miniatura (srcset low/high); ref inválida e repetida caem", () => {
  const r = B.render("::cards[pokemon/base1-4, pokemon/base1-2, POKEMON/x, pokemon/base1-4, sem-barra]", comCartas());
  assert.equal((r.html.match(/class="blog-card-tile"/g) || []).length, 2);
  assert.match(r.html, /srcset="https:\/\/assets\.tcgdex\.net\/en\/base\/base1\/4\/low\.webp 245w, https:\/\/assets\.tcgdex\.net\/en\/base\/base1\/4\/high\.webp 600w"/);
  assert.deepEqual(r.refs, ["pokemon/base1-4", "pokemon/base1-2"]);
});

test("carta que não existe: some da página publicada, aparece como aviso no editor", () => {
  assert.equal(B.render("::card[pokemon/nao-existe]", comCartas()).html, "");
  assert.match(B.render("::card[pokemon/nao-existe]", comCartas({ editor: true })).html, /class="blog-warn"[^>]*>Carta não encontrada: pokemon\/nao-existe/);
});

test("dado da carta também é escapado e imagem de host fora da CSP não vira <img>", () => {
  const h = B.render("::card[lorcana/abc]", comCartas()).html;
  assert.match(h, /Elsa &lt;b&gt;/);
  assert.doesNotMatch(h, /evil\.example/);
  assert.match(h, /blog-card-noimg/);
});

test("a sintaxe de carta no meio da frase ou em código não é carta (mesma regra do trigger do banco)", () => {
  const md = "texto ::card[pokemon/base1-4] no meio\n\n`::card[ygo/1]`\n\n  ::card[pokemon/base1-2]  \n::cards[magic/aa-1,fab/bb-2]";
  const r = B.render(md, comCartas());
  assert.deepEqual(r.refs, ["pokemon/base1-2", "magic/aa-1", "fab/bb-2"]);
  // Espelho em JS do regex do posts_before_write (20260930b_blog.sql) — lá o
  // fim do texto é a âncora \Z (cifrão dentro de $$…$$ quebra o SQL Editor),
  // aqui é o $. Se um
  // lado mudar, este teste obriga o outro a acompanhar.
  const sql = ler("supabase/migrations/20260930b_blog.sql");
  const m = /regexp_matches\(new\.body_md, '([^']+)', 'g'\)/.exec(sql);
  assert.ok(m, "regex do trigger não encontrado na migração");
  assert.equal(m[1], "(?:^|\\n)[ \\t]*::cards?\\[([^\\]\\n]+)\\][ \\t]*(?=\\r?\\n|\\Z)");
  const doBanco = [];
  for (const x of md.matchAll(/(?:^|\n)[ \t]*::cards?\[([^\]\n]+)\][ \t]*(?=\r?\n|$)/g)) {
    x[1].split(",").map((s) => s.trim()).filter((s) => B.REF_RE.test(s)).forEach((s) => { if (!doBanco.includes(s)) doBanco.push(s); });
  }
  assert.deepEqual([...doBanco].sort(), [...r.refs].sort());
});

// ── Segurança ──────────────────────────────────────────────────────────────
const TAGS_OK = new Set(["p", "br", "strong", "em", "del", "code", "pre", "a", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "hr",
  "figure", "img", "figcaption", "aside", "div", "table", "thead", "tbody", "tr", "th", "td", "span"]);
const ATTRS_OK = new Set(["href", "title", "target", "rel", "id", "class", "src", "srcset", "sizes", "width", "height", "alt", "loading",
  "decoding", "style", "start", "data-card-ref", "data-blog-card", "data-card-img", "data-img-fallbacks", "data-card-price", "data-card-actions"]);

// O "chrome" da página (cabeçalho do artigo, cartão da lista) tem umas tags e
// atributos a mais que o corpo do post nunca gera.
const TAGS_PAGINA = new Set([...TAGS_OK, "header", "nav", "h1", "time", "article", "section"]);
const ATTRS_PAGINA = new Set([...ATTRS_OK, "aria-hidden", "aria-label", "datetime", "fetchpriority", "data-game", "data-cat", "data-lang",
  "lang", "data-toc", "data-blog-share", "data-url", "data-title", "data-blog-cta", "data-share-native", "data-share-copy", "hidden", "type"]);

function confereHtml(html, origem, pagina) {
  // Toda tag é conhecida, todo atributo é conhecido, nenhum on*, nenhum
  // esquema perigoso em href/src, style só o text-align da tabela (ou a cor
  // da etiqueta de jogo, no chrome).
  const tagsOk = pagina ? TAGS_PAGINA : TAGS_OK;
  const attrsOk = pagina ? ATTRS_PAGINA : ATTRS_OK;
  const tags = html.match(/<\/?[a-zA-Z][^>]*>/g) || [];
  for (const tag of tags) {
    const nome = /^<\/?([a-zA-Z0-9]+)/.exec(tag)[1].toLowerCase();
    assert.ok(tagsOk.has(nome), `tag fora da lista: ${tag} (de ${JSON.stringify(origem)})`);
    for (const [, attr, , val] of tag.matchAll(/\s([a-zA-Z-]+)(="([^"]*)")?/g)) {
      assert.ok(attrsOk.has(attr.toLowerCase()), `atributo fora da lista: ${attr} em ${tag} (de ${JSON.stringify(origem)})`);
      if (attr === "href" || attr === "src") assert.match(val, /^(https?:|mailto:|\/(?!\/)|#)/, `esquema proibido em ${tag}`);
      if (attr === "style") assert.match(val, pagina ? /^(text-align:(left|right|center)|--gt:#[0-9a-f]{6}(;--gt-fg:#(000000|ffffff))?)$/ : /^text-align:(left|right|center)$/, `style inesperado em ${tag}`);
    }
  }
  // "<" solto fora de tag seria HTML injetado que o regex de cima não reconheceu.
  const semTags = html.replace(/<\/?[a-zA-Z][^>]*>/g, "");
  assert.ok(!/[<>]/.test(semTags), `sinal < ou > cru no texto (de ${JSON.stringify(origem)})`);
}

const ATAQUES = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "[x](javascript:alert(1))",
  "[x](JaVaScRiPt:alert(1))",
  "[x](  javascript:alert(1))",
  "[x](data:text/html;base64,PHNjcmlwdD4=)",
  "[x](vbscript:msgbox)",
  "[x](//evil.com)",
  "[x](/\\evil.com)",
  '[x](https://ok.com" onmouseover="alert(1))',
  '[x](https://ok.com "t\\" onmouseover=alert(1) x")',
  "[<img src=x onerror=alert(1)>](https://ok.com)",
  "![x](javascript:alert(1))",
  "![x](https://evil.com/a.png)",
  '![" onerror="alert(1)](https://assets.tcgdex.net/a.png)',
  "::card[pokemon/\"><script>]",
  ":::dica <script>x</script>\n<b>oi</b>\n:::",
  "| <b> | c |\n|---|---|\n| <i> | [a](javascript:1) |",
  "```\n</code><script>\n```",
  "## <img src=x onerror=1>",
  "- <svg onload=1>\n  - [a](javascript:x)",
  "> <iframe src=//x>",
  "https://ok.com/\"><script>",
  "[a](https://ok.com/<script>)",
  "**<b>**  _<i>_ ~~<s>~~ `<u>`"
];

test("ataques conhecidos saem inertes", () => {
  for (const md of ATAQUES) {
    for (const editor of [false, true]) {
      const { html } = B.render(md, comCartas({ editor }));
      confereHtml(html, md);
      assert.doesNotMatch(html, /javascript:|vbscript:|data:text/i, `esquema perigoso sobrou: ${md}`);
    }
  }
});

test("fuzz: texto aleatório com a sintaxe do blog sempre sai com HTML bem-comportado", () => {
  const PECAS = ["**", "*", "_", "__", "~~", "`", "```", "[", "]", "(", ")", "![", "\"", "'", "<", ">", "&", "\\", "|", "---", "\n", "\n\n",
    "- ", "1. ", "> ", "## ", ":::dica ", ":::", "::card[", "::cards[", "pokemon/base1-4", "javascript:", "https://", "ok.com", "/x",
    "onerror=", " ", "texto", "  ", "\t", "#", "http://a.b/c?d=e&f=g", "mailto:a@b.c"];
  let semente = 42;
  const rnd = (n) => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente % n; };
  for (let k = 0; k < 3000; k++) {
    let md = "";
    const n = 1 + rnd(30);
    for (let j = 0; j < n; j++) md += PECAS[rnd(PECAS.length)];
    confereHtml(B.render(md, comCartas({ editor: rnd(2) === 1 })).html, md);
  }
});

test("safeHref e safeImg barram esquema, host e caractere de controle", () => {
  assert.equal(B.safeHref("java" + String.fromCharCode(10) + "script:alert(1)"), "");
  assert.equal(B.safeHref("https://ok.com/a" + String.fromCharCode(0)), "");
  assert.equal(B.safeHref("https://ok.com/a b"), "");
  assert.equal(B.safeHref("mailto:contato@sleevu.app"), "mailto:contato@sleevu.app");
  assert.equal(B.safeImg("http://assets.tcgdex.net/a.png"), "", "imagem só https");
  assert.equal(B.safeImg("https://assets.tcgdex.net.evil.com/a.png"), "");
  assert.equal(B.safeImg("https://assets.tcgdex.net/a.png"), "https://assets.tcgdex.net/a.png");
});

test("texto enorme não trava (parágrafo de 200 mil caracteres com marcação sem par)", () => {
  const md = ("**a *b _c ~~d `e [f](g " + "x".repeat(40)).repeat(2500).slice(0, 200000);
  const t0 = Date.now();
  B.render(md);
  assert.ok(Date.now() - t0 < 4000, `levou ${Date.now() - t0} ms`);
});

// ── Pedaços de página ──────────────────────────────────────────────────────
test("cabeçalho e cartão escapam o que vem do banco e usam o idioma do POST", () => {
  const post = {
    slug: "guia-x", title: "Guia <script>", subtitle: "sub & mais", author_name: "Fê \"Pepe\"", lang: "en",
    category: "guias", game: "pokemon", reading_min: 7, published_at: "2026-09-30T15:00:00Z",
    cover_url: "https://dlnalopazitfdgnmdguu.supabase.co/storage/v1/object/public/blog-media/2026/09/c-w1200h630.webp", cover_alt: "a \"capa\"", excerpt: "resumo <b>"
  };
  const cab = B.cabecalhoHtml(post);
  confereHtml(cab, "cabeçalho", true);
  confereHtml(B.cartaoHtml(post, true), "cartão", true);
  const semCapa = B.cartaoHtml(Object.assign({}, post, { cover_url: "" }), false);
  confereHtml(semCapa, "cartão sem capa", true);
  assert.match(semCapa, /class="blog-item-cover blog-item-cover--vazia" style="--gt:#e23030"/);
  assert.match(cab, /<h1 class="blog-title">Guia &lt;script&gt;<\/h1>/);
  assert.match(cab, /By <strong>Fê &quot;Pepe&quot;<\/strong>/);
  assert.match(cab, /7 min read/);
  assert.match(cab, /September 30, 2026/);
  assert.match(cab, /<span class="game-tag" style="--gt:#e23030;--gt-fg:#000000">Pokémon<\/span>/);
  assert.match(cab, /width="1200" height="630" alt="a &quot;capa&quot;"/);
  const card = B.cartaoHtml(post, false);
  assert.match(card, /href="\/blog\/guia-x"/);
  assert.match(card, /-w640h336\.webp/, "cartão da lista usa a capa pequena");
  assert.match(card, /resumo &lt;b&gt;/);
  assert.equal(B.cartaoHtml(Object.assign({}, post, { lang: "xx" }), false).includes("min de leitura"), true, "idioma desconhecido cai no pt");
});

test("página do post: âncoras levam o caminho do post (a página tem <base href=/>) e tudo segue escapado", () => {
  const post = { slug: "guia-x", title: "T \"<x>\"", lang: "pt", tags: ["vintage", "<b>"], published_at: "2026-09-01T12:00:00Z", updated_at: "2026-09-20T12:00:00Z", category: "guias", game: "pokemon" };
  const md = "## Um\n\ntexto [volta](#um)\n\n## Dois\n\n::card[pokemon/base1-4]\n\n[fora](https://sleevu.app/x#y)";
  const r = B.render(md, comCartas({ ancora: "/blog/guia-x" }));
  assert.match(r.html, /<a href="\/blog\/guia-x#um">volta<\/a>/);
  assert.match(r.html, /<a href="https:\/\/sleevu\.app\/x#y">fora<\/a>/, "âncora de outra página fica como está");
  assert.equal(B.render("[a](#b)").html, '<p><a href="#b">a</a></p>\n', "sem ancora (editor), # fica cru");
  assert.equal(B.render("[a](#b)", { ancora: "javascript:x" }).html, '<p><a href="#b">a</a></p>\n', "ancora esquisita é ignorada");
  const pag = B.paginaDoPostHtml(post, r, comCartas());
  confereHtml(pag.replace(/<\/?(details|summary|footer|button|svg|path|article|header)\b[^>]*>/g, ""), "página", true);
  assert.match(pag, /<a href="\/blog\/guia-x#um" data-toc="um">Um<\/a>/);
  assert.match(pag, /class="blog-toc-mobile"/);
  assert.match(pag, /class="blog-side-cards"[\s\S]*Charizard[\s\S]*US\$ 350,00/);
  assert.match(pag, /href="https:\/\/wa\.me\/\?text=T%20%22%3Cx%3E%22%20https%3A%2F%2Fsleevu\.app%2Fblog%2Fguia-x"/);
  assert.match(pag, /<a class="blog-tag" href="\/blog\?tag=%3Cb%3E">&lt;b&gt;<\/a>/);
  assert.match(pag, /Atualizado em <time datetime="2026-09-20T12:00:00Z">20 de setembro de 2026<\/time>/);
  assert.doesNotMatch(pag, /"<x>"/);
});

test("preço da borda: US$, € quando só há euro, vazio sem preço", () => {
  assert.equal(B.precoTexto({ u: 12.5 }, "pt"), "US$ 12,50");
  assert.equal(B.precoTexto({ u: 1234.5 }, "en"), "US$ 1,234.50");
  assert.equal(B.precoTexto({ e: 3 }, "pt"), "€ 3,00");
  assert.equal(B.precoTexto({}, "pt"), "");
  assert.equal(B.precoTexto(null, "pt"), "");
});

test("slugify: acento, símbolo, limite sem cortar palavra", () => {
  assert.equal(B.slugify("Os 10 cartões que TODO mundo quer — 30th Celebration!"), "os-10-cartoes-que-todo-mundo-quer-30th-celebration");
  assert.equal(B.slugify("Ação/Reação: Pokémon"), "acao-reacao-pokemon");
  assert.equal(B.slugify("palavra-um palavra-dois palavra-tres", 20), "palavra-um-palavra");
  assert.equal(B.slugify("ポケモン"), "");
});

test("resumo automático tira a marcação e corta em palavra inteira", () => {
  const md = "## Título\n\nO **Charizard** do [Base Set](/set/base) é a carta mais famosa.\n\n::card[pokemon/base1-4]\n\n- item";
  assert.equal(B.textoPuro(md), "Título O Charizard do Base Set é a carta mais famosa. item");
  assert.equal(B.resumo(md, 30), "Título O Charizard do Base…");
  assert.equal(B.contaPalavras(md), 12);
});

// ── Cópias que a borda carrega ─────────────────────────────────────────────
test("IMG_HOSTS = hosts do img-src da CSP (+ o próprio site)", () => {
  const headers = ler("_headers");
  const csp = /Content-Security-Policy:\s*([^\n]+)/.exec(headers)[1];
  const imgSrc = /img-src ([^;]+)/.exec(csp)[1].split(/\s+/).filter((x) => /^https:\/\//.test(x)).map((x) => x.replace("https://", ""));
  assert.deepEqual([...B.IMG_HOSTS].filter((h) => h !== "sleevu.app").sort(), imgSrc.sort());
});

test("GAMES = GAME_COLOR do shared.js com os rótulos do i18n", () => {
  const shared = ler("src/shared.js");
  const cores = vm.runInNewContext("(" + /const GAME_COLOR = (\{[\s\S]*?\});/.exec(shared)[1] + ")");
  const chaves = vm.runInNewContext("(" + /const GAME_LABEL_KEY = (\{[\s\S]*?\});/.exec(shared)[1] + ")");
  const sandbox = { window: {} };
  vm.runInNewContext(ler("src/i18n.js"), sandbox);
  const pt = sandbox.window.TCG_MESSAGES.pt;
  assert.deepEqual(Object.keys(B.GAMES).sort(), Object.keys(cores).sort());
  for (const g of Object.keys(cores)) {
    assert.equal(B.GAMES[g][1], cores[g], `cor de ${g}`);
    assert.equal(B.GAMES[g][0], pt[chaves[g]], `rótulo de ${g}`);
  }
});
