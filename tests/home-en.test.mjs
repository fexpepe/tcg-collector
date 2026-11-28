// A home em inglês em /en/ (functions/en.js, functions/_lib/home-en.js).
//
// O que se trava aqui (2026-11-28, D3 da revisão de novembro):
//   - o texto em inglês que a borda lê (home-en-textos.js) é o do src/i18n.js:
//     a tabela é gerada, e este teste reprova se ela ficar pra trás;
//   - toda chave da home tem texto em inglês, e a home não ganha um tipo de
//     data-i18n-* que a troca não sabe fazer;
//   - o HTML de /en/ sai com lang="en", título, descrição, Open Graph,
//     canonical, JSON-LD e os textos visíveis em inglês, SEM depender de JS;
//   - o <base href="/"> que o endereço com barra exige não quebra o SVG nem o
//     "Tentar de novo";
//   - o trio hreflang do index.html, o sitemap e a constante do endereço
//     dizem a mesma coisa;
//   - a Function: /en leva 301 pra /en/, HEAD não tem corpo, casca fora do ar
//     passa como veio;
//   - o theme.js: quem chega em /en/ sem escolha salva abre em inglês, a
//     escolha salva vence, robô fica no inglês do HTML, e quem abre no idioma
//     do HTML não espera pacote de tradução.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import {
  CAMINHO_EN, CANONICAL_EN, chavesDaHome, chavesSemTexto, atributosDeTraducaoNaoTratados, pecasDaHomeEn, traduzHomeEn
} from "../functions/_lib/home-en.js";
import { TEXTOS_HOME_EN } from "../functions/_lib/home-en-textos.js";
import { moduloDaHome, tabelaDoIdioma } from "../scripts/gen-home-en.mjs";
import { paresDaHome, montaSitemaps, lerSitemap } from "../scripts/lib/sitemap.mjs";
import { onRequestGet, onRequestHead } from "../functions/en.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const lerLF = (...caminho) => readFileSync(join(raiz, ...caminho), "utf8").replace(/\r\n/g, "\n");
const HOME = lerLF("index.html");
const I18N = lerLF("src", "i18n.js");
const THEME = lerLF("src", "theme.js");
const EN = tabelaDoIdioma(I18N, "en");
const PT = tabelaDoIdioma(I18N, "pt");
const SAIDA = traduzHomeEn(HOME, TEXTOS_HOME_EN);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── o texto vem do i18n.js, e a tabela não fica pra trás ────────────────────
test("home-en-textos.js é exatamente o que o gerador faz com o index.html e o i18n.js", () => {
  assert.equal(lerLF("functions", "_lib", "home-en-textos.js"), moduloDaHome(HOME, I18N),
    "a tabela ficou pra trás: rode node scripts/gen-home-en.mjs");
});

test("toda chave da home tem texto em inglês, e cada texto é o do i18n.js", () => {
  assert.deepEqual(chavesSemTexto(HOME, TEXTOS_HOME_EN), []);
  for (const chave of chavesDaHome(HOME)) assert.equal(TEXTOS_HOME_EN[chave], EN[chave], chave);
  assert.equal(Object.keys(TEXTOS_HOME_EN).length, chavesDaHome(HOME).length, "chave sobrando na tabela");
});

test("a home só usa os tipos de data-i18n que a troca sabe fazer", () => {
  assert.deepEqual(atributosDeTraducaoNaoTratados(HOME), [],
    "tipo novo de data-i18n-* no index.html: ensine o traduzHomeEn (e o gerador) a trocá-lo");
});

// ── o HTML de /en/ ──────────────────────────────────────────────────────────
test("o <head> sai em inglês: lang, título, descrição, Open Graph, Twitter e canonical", () => {
  const p = pecasDaHomeEn(TEXTOS_HOME_EN);
  assert.equal(p.titulo, EN["title.home"]);
  assert.equal(p.desc, EN["home.lp.sub"]);
  assert.match(SAIDA, /<html lang="en" data-idioma-padrao="en">/);
  assert.match(SAIDA, new RegExp(`<title data-i18n="title.home">${esc(EN["title.home"])}</title>`));
  const meta = (chave) => new RegExp(`<meta (?:name|property)="${chave}" content="([^"]*)">`).exec(SAIDA)[1];
  const dec = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  for (const chave of ["description", "og:description", "twitter:description"]) assert.equal(dec(meta(chave)), EN["home.lp.sub"], chave);
  for (const chave of ["og:title", "twitter:title"]) assert.equal(dec(meta(chave)), EN["title.home"], chave);
  assert.equal(meta("og:url"), CANONICAL_EN);
  assert.match(SAIDA, new RegExp(`<link rel="canonical" href="${CANONICAL_EN}">`));
  // Nada do <head> em português sobrou.
  assert.doesNotMatch(SAIDA, /Acompanhe suas coleções|num só lugar|Coleção de cartas TCG/);
});

test("o texto visível sai em inglês no HTML, sem JS: cada elemento com a frase da sua chave", () => {
  for (const chave of chavesDaHome(HOME)) {
    if (chave === "title.home" || chave === "home.lp.sub") { assert.ok(SAIDA.includes(esc(EN[chave])) || SAIDA.includes(EN[chave]), chave); continue; }
    const ptTexto = PT[chave];
    if (typeof ptTexto === "string" && ptTexto !== EN[chave]) {
      assert.ok(!SAIDA.includes(`>${ptTexto}<`) && !SAIDA.includes(`>${esc(ptTexto)}<`), `${chave} ficou em português`);
    }
  }
  // O texto de cada elemento de texto puro, lido direto da saída.
  const comTexto = [...HOME.matchAll(/\sdata-i18n="([^"]+)"[^>]*>/g)].map((m) => m[1]);
  assert.ok(comTexto.length > 50, "esperava dezenas de elementos data-i18n na home");
  for (const chave of new Set(comTexto)) {
    const re = new RegExp(`data-i18n="${chave.replace(/[.]/g, "\\.")}"[^>]*>([^<]*)<`, "g");
    const textos = [...SAIDA.matchAll(re)].map((m) => m[1]);
    assert.ok(textos.length > 0, chave);
    for (const t of textos) assert.equal(t, esc(EN[chave]), chave);
  }
  // O HTML de confiança (home.sources.lead tem <strong>) sai como HTML, não escapado.
  assert.ok(SAIDA.includes(EN["home.sources.lead"]));
  // Os aria-label dos data-i18n-aria.
  assert.match(SAIDA, new RegExp(`data-i18n-aria="aria.pages" aria-label="${EN["aria.pages"]}"`));
  assert.match(SAIDA, new RegExp(`data-i18n-aria="aria.sleevuNumbers" aria-label="${EN["aria.sleevuNumbers"]}"`));
});

test("a troca não mexe na estrutura: mesmas tags, só a <base> a mais", () => {
  const tags = (s) => (s.replace(/<!--[\s\S]*?-->/g, "").match(/<[a-zA-Z][\w:-]*/g) || []).length;
  assert.equal(tags(SAIDA), tags(HOME) + 1);
  // Os desenhos (SVG) e os links passam intactos.
  const dsDe = (s) => [...s.matchAll(/ d="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(dsDe(SAIDA), dsDe(HOME));
  const hrefsDe = (s) => [...s.matchAll(/<a [^>]*href="([^"#][^"]*)"/g)].map((m) => m[1]).sort();
  // (o único href="" da home, o "Tentar de novo", é o que ganha o endereço de /en/)
  assert.deepEqual(hrefsDe(SAIDA), [...hrefsDe(HOME), CAMINHO_EN].sort());
});

test("<base href=\"/\">: primeira coisa do <head>, e o SVG e o \"Tentar de novo\" não quebram", () => {
  assert.match(SAIDA, /<head><base href="\/">\s*<meta charset="utf-8">/);
  assert.equal((SAIDA.match(/<base /g) || []).length, 1);
  // O wordmark (SVG): o <use xlink:href="#…"> é referência interna e fica como
  // está (reescrever pro caminho completo quebra com ?query: foi testado no
  // Chrome). O clip-path="url(#…)" é URL de CSS e o Safari/Firefox o resolvem
  // contra a base: sai (era o retângulo do viewBox inteiro).
  assert.ok((SAIDA.match(/xlink:href="#font_/g) || []).length >= 6);
  assert.doesNotMatch(SAIDA, /clip-path\s*=/);
  assert.match(HOME, /clip-path="url\(#clip_1\)"/, "o index.html mudou: reconfira o recorte do wordmark");
  assert.match(SAIDA, /<clipPath id="clip_1">/, "a definição do recorte não é mexida");
  // O href="" do cartão de falha resolveria na raiz (a home em português).
  assert.doesNotMatch(SAIDA, /href=""/);
  assert.match(SAIDA, new RegExp(`<a class="primary" href="${CAMINHO_EN}" data-i18n="boot.retry">Try again</a>`));
});

test("JSON-LD: o WebSite sai em inglês, a Organization não muda", () => {
  const ld = (s) => JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(s)[1]);
  const antes = ld(HOME)["@graph"];
  const depois = ld(SAIDA)["@graph"];
  const site = depois.find((n) => n["@type"] === "WebSite");
  assert.equal(site.inLanguage, "en");
  assert.equal(site.description, EN["home.lp.sub"]);
  assert.equal(site.name, "Sleevu");
  assert.equal(site.url, "https://sleevu.app/");
  assert.deepEqual(depois.find((n) => n["@type"] === "Organization"), antes.find((n) => n["@type"] === "Organization"));
});

test("a home em português não é tocada: o index.html segue em pt-BR e só traz o trio hreflang a mais", () => {
  assert.match(HOME, /<html lang="pt-BR">/);
  assert.match(HOME, /<link rel="canonical" href="https:\/\/sleevu\.app\/">/);
  assert.match(HOME, /<title data-i18n="title\.home">Sleevu — Coleção de cartas TCG/);
  assert.doesNotMatch(HOME, /data-idioma-padrao|<base /);
});

// ── hreflang, sitemap e o endereço dizem a mesma coisa ──────────────────────
test("o trio hreflang do index.html bate com o CAMINHO_EN e com o sitemap", () => {
  const links = [...HOME.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map((m) => ({ hreflang: m[1], href: m[2] }));
  assert.deepEqual(links, [
    { hreflang: "pt-BR", href: "https://sleevu.app/" },
    { hreflang: "en", href: CANONICAL_EN },
    { hreflang: "x-default", href: CANONICAL_EN }
  ]);
  const [pt, en] = paresDaHome("https://sleevu.app", CAMINHO_EN);
  assert.equal(pt.loc, "https://sleevu.app/");
  assert.equal(en.loc, CANONICAL_EN);
  assert.deepEqual(pt.alternates, links);
  assert.deepEqual(en.alternates, links, "cada URL do par lista as duas, ela mesma inclusive");
  // O x-default é o inglês, como nas páginas de set.
  assert.equal(links.find((l) => l.hreflang === "x-default").href, links.find((l) => l.hreflang === "en").href);
});

test("sitemap: a home e a home em inglês saem com os alternates; as outras URLs não mudam", () => {
  const arq = montaSitemaps("https://sleevu.app", [["sitemap-pages.xml", [...paresDaHome("https://sleevu.app", CAMINHO_EN), "https://sleevu.app/hub"]]]);
  const xml = arq["sitemap-pages.xml"];
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9" xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml">/);
  assert.match(xml, /<url><loc>https:\/\/sleevu\.app\/<\/loc><xhtml:link rel="alternate" hreflang="pt-BR" href="https:\/\/sleevu\.app\/"\/>/);
  assert.match(xml, /<url><loc>https:\/\/sleevu\.app\/en\/<\/loc><xhtml:link rel="alternate" hreflang="pt-BR"/);
  assert.equal((xml.match(/hreflang="x-default" href="https:\/\/sleevu\.app\/en\/"/g) || []).length, 2);
  assert.match(xml, /<url><loc>https:\/\/sleevu\.app\/hub<\/loc><\/url>/);
  // O leitor (IndexNow) enxerga as duas URLs e não confunde os alternates com páginas.
  assert.deepEqual(lerSitemap(xml).locs, ["https://sleevu.app/", CANONICAL_EN, "https://sleevu.app/hub"]);
  // Sem alternates, o urlset fica como era (sem o xmlns:xhtml).
  const so = montaSitemaps("https://sleevu.app", [["sitemap-x.xml", ["https://sleevu.app/hub"]]])["sitemap-x.xml"];
  assert.doesNotMatch(so, /xhtml/);
});

test("o prerender põe a home e a /en/ no sitemap-pages.xml (e o /blog continua só com post)", () => {
  const fonte = lerLF("scripts", "prerender-catalog.mjs");
  assert.match(fonte, /import \{ CAMINHO_EN \} from "\.\.\/functions\/_lib\/home-en\.js"/);
  assert.match(fonte, /p === "\/" \? paresDaHome\(ORIGIN, CAMINHO_EN\)/);
});

// ── a Function ──────────────────────────────────────────────────────────────
function contexto(caminho, { status = 200, corpo = HOME, metodo = "GET" } = {}) {
  const pedidos = [];
  const env = { ASSETS: { fetch: async (req) => {
    pedidos.push(new URL(req.url).pathname);
    return new Response(corpo, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate", etag: '"x"', "x-do-asset": "sim" } });
  } } };
  return { context: { env, request: new Request(`https://sleevu.app${caminho}`, { method: metodo, headers: { "if-none-match": '"x"' } }) }, pedidos };
}

test("Function: /en/ devolve a home em inglês, a partir do index.html, sem validadores", async () => {
  const { context, pedidos } = contexto("/en/");
  const r = await onRequestGet(context);
  assert.equal(r.status, 200);
  assert.deepEqual(pedidos, ["/"]);
  assert.match(r.headers.get("content-type"), /^text\/html/);
  assert.equal(r.headers.get("x-do-asset"), "sim", "os cabeçalhos do asset (CSP, Link…) passam");
  assert.equal(r.headers.get("etag"), null, "a resposta é montada: o validador do asset não vale");
  assert.equal(await r.text(), SAIDA);
});

test("Function: /en leva 301 pra /en/, com a query", async () => {
  for (const [pedido, destino] of [["/en", "https://sleevu.app/en/"], ["/en?utm_source=x", "https://sleevu.app/en/?utm_source=x"]]) {
    const { context, pedidos } = contexto(pedido);
    const r = await onRequestGet(context);
    assert.equal(r.status, 301, pedido);
    assert.equal(r.headers.get("location"), destino);
    assert.deepEqual(pedidos, [], "o redirecionamento não precisa da casca");
  }
});

test("Function: HEAD sem corpo, e casca que não é 200 passa como veio", async () => {
  const head = await onRequestHead(contexto("/en/", { metodo: "HEAD" }).context);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const fora = await onRequestGet(contexto("/en/", { status: 500, corpo: "erro" }).context);
  assert.equal(fora.status, 500);
  assert.equal(await fora.text(), "erro");
});

// ── o theme.js ──────────────────────────────────────────────────────────────
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const GOOGLEBOT = "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const COM_PACOTES = THEME.replace("var I18N = null; /* SLEEVU_I18N */", 'var I18N = { i18n: { pt: "src/i18n.pt.js", en: "src/i18n.en.js", es: "src/i18n.es.js" } };');

function rodaTheme({ htmlLang = "pt-BR", padrao = null, languages = ["pt-BR"], ua = CHROME, salvo = null, pathname = "/", cookie = "", referrer = "" } = {}) {
  const attrs = new Map([["lang", htmlLang], ["data-i18n-packs", "i18n"]]);
  if (padrao) attrs.set("data-idioma-padrao", padrao);
  const dados = new Map(salvo ? [["tcg-collector-ui-lang-v1", salvo]] : []);
  const storage = { getItem: (k) => (dados.has(k) ? dados.get(k) : null), setItem: (k, v) => dados.set(k, String(v)), removeItem: (k) => dados.delete(k) };
  const window = { localStorage: storage, sessionStorage: storage, matchMedia: () => ({ matches: false }), addEventListener() {} };
  window.window = window;
  const escritos = [];
  const scripts = [];
  let foiPara = null;
  const document = {
    documentElement: { getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null), setAttribute: (n, v) => attrs.set(n, String(v)), hasAttribute: (n) => attrs.has(n), removeAttribute: (n) => attrs.delete(n) },
    currentScript: null,
    addEventListener() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    get scripts() { return scripts; },
    write: (html) => { const src = /src="([^"]+)"/.exec(html)[1]; escritos.push(src); scripts.push({ getAttribute: () => src, addEventListener() {} }); },
    cookie, referrer
  };
  vm.runInNewContext(COM_PACOTES, {
    window, document, localStorage: storage, sessionStorage: storage,
    navigator: { userAgent: ua, languages, language: languages[0] },
    location: { search: "", pathname, hash: "", origin: "https://sleevu.app", href: `https://sleevu.app${pathname}`, replace: (u) => { foiPara = u; } },
    history: { state: null, replaceState() {} },
    performance: { getEntriesByType: () => [] },
    setTimeout: () => 0
  });
  return { lang: attrs.get("lang"), sleevu: window.SLEEVU_LANG, escritos, espera: attrs.has("data-i18n-espera"), foiPara };
}
const EN_DA_HOME = { htmlLang: "en", padrao: "en", pathname: CAMINHO_EN };

test("theme.js: em /en/ quem não escolheu idioma abre em inglês, seja qual for o navegador", () => {
  for (const languages of [["pt-BR"], ["es-AR"], ["en-US"], ["fr-FR"]]) {
    const r = rodaTheme({ ...EN_DA_HOME, languages });
    assert.deepEqual([r.lang, r.sleevu], ["en", "en"], languages.join());
  }
  // O robô vê o inglês do HTML (e não o idioma do navegador dele).
  assert.equal(rodaTheme({ ...EN_DA_HOME, ua: GOOGLEBOT, languages: ["pt-BR"] }).sleevu, "en");
});

test("theme.js: a escolha salva vence também em /en/ (é a regra do app)", () => {
  assert.deepEqual(rodaTheme({ ...EN_DA_HOME, salvo: "pt" }).sleevu, "pt");
  assert.deepEqual(rodaTheme({ ...EN_DA_HOME, salvo: "es", languages: ["en-US"] }).lang, "es");
});

test("theme.js: a home em português segue como era (sem o atributo, navegador manda)", () => {
  assert.equal(rodaTheme({ languages: ["en-US"] }).sleevu, "en");
  assert.equal(rodaTheme({ languages: ["pt-BR"] }).sleevu, "pt");
  assert.equal(rodaTheme({ ua: GOOGLEBOT, languages: ["en-US"] }).sleevu, "pt");
});

test("theme.js: quem lê no idioma do HTML não espera pacote; quem lê em outro, espera", () => {
  // /en/ em inglês: o texto já está certo, nada fica escondido esperando o pacote.
  const en = rodaTheme(EN_DA_HOME);
  assert.deepEqual(en.escritos, ["src/i18n.en.js"]);
  assert.equal(en.espera, false);
  // /en/ com o português escolhido: o HTML está em inglês, então espera o pacote pt.
  const pt = rodaTheme({ ...EN_DA_HOME, salvo: "pt" });
  assert.deepEqual(pt.escritos, ["src/i18n.pt.js"]);
  assert.equal(pt.espera, true);
  // A home em português lida em inglês: como sempre foi.
  const comoSempre = rodaTheme({ languages: ["en-US"] });
  assert.equal(comoSempre.espera, true);
  assert.equal(rodaTheme({ languages: ["pt-BR"] }).espera, false);
});

test("theme.js: quem já tem sessão e chega de fora em /en/ vai pro painel, como na home", () => {
  const sessao = "sleevu_session=1";
  assert.equal(rodaTheme({ ...EN_DA_HOME, cookie: sessao }).foiPara, "/dashboard");
  assert.equal(rodaTheme({ htmlLang: "pt-BR", pathname: "/", cookie: sessao }).foiPara, "/dashboard");
  // Clicado de dentro do site, ou sem sessão: fica na landing.
  assert.equal(rodaTheme({ ...EN_DA_HOME, cookie: sessao, referrer: "https://sleevu.app/hub" }).foiPara, null);
  assert.equal(rodaTheme(EN_DA_HOME).foiPara, null);
  assert.equal(rodaTheme({ htmlLang: "pt-BR", pathname: "/hub", cookie: sessao }).foiPara, null);
});

// ── o sw.js não guarda a home em português pra /en/ ─────────────────────────
test("sw.js: /en/ tem entrada própria no cache e nenhuma cópia de reserva (não recebe a home em português)", () => {
  const sw = lerLF("sw.js");
  // Mesma função que o sw.js usa pra chave de navegação, extraída da fonte.
  const chave = new Function(`${/function chaveDeNavegacao\(url\) \{[\s\S]*?\n\}/.exec(sw)[0]}; return chaveDeNavegacao;`)();
  assert.equal(chave("https://sleevu.app/en/"), "https://sleevu.app/en/");
  assert.notEqual(chave("https://sleevu.app/en/"), chave("https://sleevu.app/"));
  assert.notEqual(chave("https://sleevu.app/en/?utm=x"), "https://sleevu.app/index.html");
  const reserva = new Function("self", `${/function reservaDaNavegacao\(url\) \{[\s\S]*?\n\}/.exec(sw)[0]}; return reservaDaNavegacao;`)({ location: "https://sleevu.app/sw.js" });
  assert.equal(reserva("https://sleevu.app/en/"), null);
});
