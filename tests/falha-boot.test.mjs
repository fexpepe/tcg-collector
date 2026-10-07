// Saída de emergência (.falha-boot) — o "Tentar de novo" e o rastro.
//
// 2026-10-07: no celular, sets (do Cyberpunk e outros) mostravam "Esta tela
// não terminou de carregar" e o "Tentar de novo" levava pro INÍCIO. As telas
// de Sets e do set têm <base href="/">, então o href="" do botão resolve na
// raiz; quem trocava pela URL da tela era o theme.js, e só no
// DOMContentLoaded. Os dois jeitos de o cartão aparecer furavam isso:
//   - o boot.js (theme+game) não chega: o cartão aparece na hora e o theme.js
//     nem rodou;
//   - um script `defer` (shared.js) ainda baixando aos 15 s: o cartão aparece
//     e o DOMContentLoaded, que espera os `defer`, ainda não disparou.
// Reproduzido em produção com o Chromium nos dois modos. Trava:
//   - toda página com data-recarrega e <base> tem, no <head>, o ouvinte
//     inline que põe location.href no link NO TOQUE (roda sem nenhum arquivo
//     do app). A 1ª versão era um <script> logo depois do link, e perdia a
//     corrida: o cartão pintava antes de ele rodar (medido em produção);
//   - o theme.js acerta o href NO TOQUE (reserva pra página sem nonce);
//   - aos 15 s sem data-app, o theme.js guarda uma marca que a próxima página
//     põe na fila de erros (o /admin passa a ver a saída de emergência).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (f) => readFileSync(join(raiz, f), "utf8");
const THEME = ler("src/theme.js");
// O ouvinte inline do <head>: o 1º <script> sem src que cita o data-recarrega.
const OUVINTE = /<script>([^<]*\[data-recarrega\][^<]*)<\/script>/;
const cabeca = (html) => html.slice(0, html.indexOf("</head>"));

test("toda página com <base> e o \"Tentar de novo\" acerta o link desde o <head>", () => {
  const paginas = readdirSync(raiz).filter((f) => f.endsWith(".html") && /data-recarrega/.test(ler(f)));
  assert.ok(paginas.includes("detail.html") && paginas.includes("sets.html"), `páginas com data-recarrega: ${paginas.join(", ")}`);
  for (const f of paginas) {
    const html = ler(f);
    if (!/<base href=/.test(html)) continue; // sem <base>, o href="" já é a própria tela
    assert.match(cabeca(html), OUVINTE, `${f}: sem o ouvinte inline no <head>`);
    assert.ok(cabeca(html).indexOf("<base") < cabeca(html).search(OUVINTE), `${f}: o ouvinte tem de vir depois do <base> (é dele que o link depende)`);
    assert.doesNotMatch(html, /<\/a>\s*<script>/, `${f}: voltou o <script> depois do link, que perde a corrida pro cartão`);
    // Precisa sair pela borda com nonce: o _headers barra script inline
    // (script-src 'self').
    const funcao = { "detail.html": "functions/detail.js", "sets.html": "functions/sets.js" }[f];
    assert.ok(funcao, `${f}: <base> + data-recarrega numa página que não sai pela vitrine (sem nonce, o script inline é barrado)`);
    assert.match(ler(funcao), /comVitrine|paginaComVitrine/, `${funcao} não passa pela CSP com nonce`);
  }
  // As telas do endereço /games/... (detail e sets decorados) também saem com nonce.
  assert.match(ler("functions/games/[[path]].js"), /comVitrine\(/);
  assert.match(ler("functions/_vitrine-csp.js"), /\.on\("script", \{ element\(el\) \{ el\.setAttribute\("nonce", nonce\)/, "o nonce tem de ir em TODO <script>, inclusive o inline");
});

test("o ouvinte do <head> põe a URL da tela no link no toque, sem nenhum arquivo do app", () => {
  for (const f of ["detail.html", "sets.html"]) {
    const codigo = cabeca(ler(f)).match(OUVINTE)[1];
    const ouvintes = {};
    vm.runInNewContext(codigo, {
      document: { addEventListener: (tipo, fn, captura) => { ouvintes[tipo] = { fn, captura: !!captura }; } },
      location: { href: "https://sleevu.app/games/cyberpunk-tcg/welcome-to-night-city-beta" }
    });
    assert.ok(ouvintes.click && ouvintes.click.captura, `${f}: o ouvinte tem de ser de clique, na captura`);
    const link = { href: "" };
    ouvintes.click.fn({ target: { closest: (sel) => (sel === ".falha-boot [data-recarrega]" ? link : null) } });
    assert.equal(link.href, "https://sleevu.app/games/cyberpunk-tcg/welcome-to-night-city-beta", f);
    const outro = { href: "/x" };
    ouvintes.click.fn({ target: { closest: () => null } });
    ouvintes.click.fn({ target: null });
    assert.equal(outro.href, "/x");
  }
});

// theme.js num navegador de mentira, com relógio e armazenamento controlados.
function rodaTheme({ sessao = new Map(), comCartao = true, origin = "https://sleevu.app", pathname = "/games/cyberpunk-tcg/pre-release-beta" } = {}) {
  const ouvintes = {};
  const timers = [];
  const attrs = new Map([["lang", "pt-BR"]]);
  const storage = (m) => ({ getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) });
  const local = storage(new Map());
  const session = storage(sessao);
  const window = { localStorage: local, sessionStorage: session, matchMedia: () => ({ matches: false }), addEventListener() {} };
  window.window = window;
  const cartao = { tagName: "DIV" };
  const document = {
    addEventListener: (tipo, fn, captura) => { ouvintes[tipo] = { fn, captura: !!captura }; },
    documentElement: { getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null), setAttribute: (n, v) => attrs.set(n, String(v)), hasAttribute: (n) => attrs.has(n) },
    currentScript: null,
    querySelector: (sel) => (sel === ".falha-boot" && comCartao ? cartao : null),
    scripts: [
      { src: `${origin}/src/boot.1234abcd.js` },
      { src: `${origin}/src/shared.1234abcd.js` },
      { src: `${origin}/src/detail.1234abcd.js` },
      { src: "" }, // inline
      { src: "https://static.cloudflareinsights.com/beacon.min.js" }
    ],
    write: () => {},
    referrer: "",
    cookie: ""
  };
  const location = { search: "", pathname, hash: "", origin, href: `${origin}${pathname}?x=1`, replace() {} };
  vm.runInNewContext(THEME, {
    window, document, localStorage: local, sessionStorage: session,
    navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", languages: ["pt-BR"], language: "pt-BR" },
    location,
    history: { state: null, replaceState() {} },
    performance: { getEntriesByType: () => [{ name: `${origin}/src/boot.1234abcd.js` }] },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }
  });
  return { window, ouvintes, timers, attrs, sessao, location };
}

test("theme.js acerta o href do \"Tentar de novo\" no toque, antes do DOMContentLoaded", () => {
  const { ouvintes, location } = rodaTheme();
  assert.ok(ouvintes.click && ouvintes.click.captura, "sem ouvinte de clique na captura (o toque tem de chegar antes da ação padrão do link)");
  assert.equal(ouvintes.DOMContentLoaded, undefined, "voltou a depender do DOMContentLoaded, que espera os scripts defer");
  const retry = { href: "" };
  ouvintes.click.fn({ target: { closest: (sel) => (sel === ".falha-boot [data-recarrega]" ? retry : null) } });
  assert.equal(retry.href, location.href);
  // Outros cliques não mexem em nada.
  const outro = { href: "/x" };
  ouvintes.click.fn({ target: { closest: () => null, href: outro } });
  ouvintes.click.fn({ target: null });
  assert.equal(outro.href, "/x");
});

test("15 s sem data-app: a tela guarda a marca, e a próxima página a põe na fila", () => {
  const sessao = new Map();
  const travada = rodaTheme({ sessao });
  const timer = travada.timers.find((t) => t.ms === 15000);
  assert.ok(timer, "sem o timer dos 15 s (a régua do CSS da .falha-boot)");
  timer.fn();
  const marca = JSON.parse(sessao.get("sleevu-falha-boot"));
  assert.equal(marca.k, "falha");
  assert.match(marca.s, /^\/games\/cyberpunk-tcg\/pre-release-beta · faltavam src\/shared\.1234abcd\.js src\/detail\.1234abcd\.js$/);
  assert.doesNotMatch(marca.s, /\?x=1/, "a query não vai pro rastreio");
  assert.equal(travada.window.__sleevuErros.length, 0, "na própria tela não há quem mande: a marca espera a próxima");

  const seguinte = rodaTheme({ sessao, pathname: "/" });
  assert.deepEqual(JSON.parse(JSON.stringify(seguinte.window.__sleevuErros)), [marca]);
  assert.equal(sessao.has("sleevu-falha-boot"), false, "a marca é mandada uma vez só");
});

test("tela que subiu, ou página sem o cartão, não deixa marca", () => {
  const sessao = new Map();
  const subiu = rodaTheme({ sessao });
  subiu.attrs.set("data-app", "");
  subiu.timers.find((t) => t.ms === 15000).fn();
  assert.equal(sessao.size, 0);
  // Pré-renderizada: carrega o theme.js sozinho e nunca ganha o data-app.
  const estatica = rodaTheme({ sessao, comCartao: false });
  estatica.timers.find((t) => t.ms === 15000).fn();
  assert.equal(sessao.size, 0);
});

test("sem setTimeout nem sessionStorage (navegador estranho), o theme.js segue de pé", () => {
  assert.doesNotThrow(() => vm.runInNewContext(THEME, {
    window: { addEventListener() {} },
    document: { addEventListener() {}, documentElement: { getAttribute: () => null, setAttribute() {}, hasAttribute: () => false }, querySelector: () => null, write() {} },
    navigator: { userAgent: "", languages: [], language: "" },
    location: { search: "", pathname: "/", hash: "", origin: "https://sleevu.app" },
    history: { state: null, replaceState() {} }
  }));
});
