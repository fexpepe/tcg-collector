// Quem já tem conta e chega DE FORA no Início vai pro Hub pessoal
// (2026-10-06, auditoria de aquisição).
//
// O app instalado abre no start_url ("./", a landing), e a landing não olhava
// sessão: quem já usa o Sleevu dava de cara com "Começar agora, é grátis" toda
// vez que abria o app — e o mesmo pra quem digita sleevu.app. O theme.js (o
// primeiro script síncrono do <head>) manda pro /dashboard ANTES da pintura.
// Trava:
//   - sessão + chegada de fora (referrer vazio ou de outro site) → /dashboard;
//   - o "Início"/logo clicados dentro do site (referrer da própria origem)
//     continuam na landing;
//   - sem sessão, nada muda (é a landing de quem ainda não conhece o site);
//   - a volta do link mágico (#access_token) fica com o shared.js;
//   - só a home: nenhuma outra página é redirecionada.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const THEME = readFileSync(join(raiz, "src/theme.js"), "utf8");

// theme.js num navegador de mentira: devolve pra onde ele mandou (ou null).
function destino({ pathname = "/", hash = "", referrer = "", cookie = "", sessaoLocal = null, origin = "https://sleevu.app" } = {}) {
  const dados = sessaoLocal ? { "tcg-supabase-session-v1": sessaoLocal } : {};
  const storage = { getItem: (k) => (k in dados ? dados[k] : null), setItem() {}, removeItem() {} };
  const attrs = new Map([["lang", "pt-BR"]]);
  const window = { localStorage: storage, sessionStorage: storage, matchMedia: () => ({ matches: false }), addEventListener() {} };
  window.window = window;
  const document = {
    addEventListener() {},
    documentElement: { getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null), setAttribute: (n, v) => attrs.set(n, String(v)), hasAttribute: (n) => attrs.has(n) },
    currentScript: null,
    querySelector: () => null,
    write: () => {},
    referrer,
    cookie
  };
  let foi = null;
  vm.runInNewContext(THEME, {
    window, document, localStorage: storage,
    navigator: { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/141.0.0.0 Mobile Safari/537.36", languages: ["pt-BR"], language: "pt-BR" },
    location: { search: "", pathname, hash, origin, replace: (u) => { if (foi === null) foi = u; } },
    history: { state: null, replaceState() {} }
  });
  return foi;
}

const COOKIE = "outra=1; sleevu_session=%7B%22access_token%22%3A%22x%22%7D; tcg-consent=1";

test("app instalado / endereço digitado com sessão: vai pro Hub pessoal", () => {
  assert.equal(destino({ cookie: COOKIE }), "/dashboard");
  assert.equal(destino({ pathname: "/index.html", cookie: COOKIE }), "/dashboard");
  assert.equal(destino({ pathname: "/index", cookie: COOKIE }), "/dashboard");
});

test("volta pelo Google (referrer de outro site) com sessão: Hub pessoal", () => {
  assert.equal(destino({ cookie: COOKIE, referrer: "https://www.google.com/" }), "/dashboard");
  // Domínio parecido não conta como "de dentro".
  assert.equal(destino({ cookie: COOKIE, referrer: "https://sleevu.app.evil.example/" }), "/dashboard");
});

test("Início clicado dentro do site continua na landing", () => {
  assert.equal(destino({ cookie: COOKIE, referrer: "https://sleevu.app/sets" }), null);
  assert.equal(destino({ cookie: COOKIE, referrer: "https://sleevu.app/" }), null);
});

test("sem sessão, a landing fica", () => {
  assert.equal(destino({}), null);
  assert.equal(destino({ cookie: "tcg-consent=1; outro_sleevu_session=1" }), null);
});

test("fora de *.sleevu.app a sessão vem do localStorage", () => {
  assert.equal(destino({ origin: "http://localhost:4173", sessaoLocal: "{\"access_token\":\"x\"}" }), "/dashboard");
});

test("a volta do link mágico na home fica com o shared.js", () => {
  assert.equal(destino({ cookie: COOKIE, hash: "#access_token=abc&refresh_token=def" }), null);
  assert.equal(destino({ cookie: COOKIE, hash: "#error=access_denied&error_description=expired" }), null);
});

test("só a home: as outras páginas não são redirecionadas", () => {
  for (const pathname of ["/sets", "/login", "/hub", "/users/fexpepe", "/games/pokemon", "/dashboard"]) {
    assert.equal(destino({ pathname, cookie: COOKIE }), null, pathname);
  }
});
