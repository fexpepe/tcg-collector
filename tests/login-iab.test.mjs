// Login no navegador embutido de app (2026-10-03, docs/PLANO-TECNICO.md S5).
// O anúncio da campanha abre dentro do Instagram/Facebook/TikTok, e lá o
// Google recusa o OAuth (403 disallowed_useragent). Trava:
//   - o theme.js carimba data-iab no <html> antes da primeira pintura, com o
//     MESMO veredito do familia() do src/erros.js (o /admin cruza os dois);
//   - navegador comum (Chrome, Safari, Samsung, Chrome do iPhone) não ganha a
//     marca — falso positivo tiraria o Google de quem pode usá-lo;
//   - o /login tem o aviso traduzido, o CSS troca os botões do Google por ele,
//     e o login.js não oferece o atalho da última conta (também Google);
//   - o pageview e o login_gate levam a marca.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (f) => readFileSync(join(raiz, f), "utf8");

const UA = {
  instagramIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.20.104 (iPhone14,5; iOS 17_5; pt_BR; pt; scale=3.00; 1170x2532; 640253012)",
  instagramAndroid: "Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.42.86 Android (34/14; 450dpi; 1080x2340; samsung; SM-A546E; a54x; s5e8835; pt_BR; 640261170)",
  facebookIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.40.104;FBBV/123;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.0;FBSS/3;FBCR/;FBID/phone;FBLC/pt_BR;FBOP/80]",
  facebookAndroid: "Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.47.109;]",
  tiktokAndroid: "Mozilla/5.0 (Linux; Android 12; moto g22 Build/STAS32.79; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 trill_340700 BytedanceWebview/d8a21c6",
  webviewAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  chromeIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1",
  edgeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0"
};

// theme.js num navegador de mentira: devolve o data-iab que ele carimbou.
function iabDoTheme(ua) {
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const attrs = new Map([["lang", "pt-BR"]]);
  const window = { localStorage: storage, sessionStorage: storage, matchMedia: () => ({ matches: false }), addEventListener() {} };
  window.window = window;
  const document = {
    addEventListener() {},
    documentElement: { getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null), setAttribute: (n, v) => attrs.set(n, String(v)), hasAttribute: (n) => attrs.has(n) },
    currentScript: null,
    querySelector: () => null,
    write: () => {}
  };
  vm.runInNewContext(ler("src/theme.js"), {
    window, document, localStorage: storage,
    navigator: { userAgent: ua, languages: ["pt-BR"], language: "pt-BR" },
    location: { search: "", pathname: "/login", hash: "", origin: "https://sleevu.app" },
    history: { state: null, replaceState() {} }
  });
  return attrs.has("data-iab") ? attrs.get("data-iab") : "";
}

// familia() do src/erros.js, o que classifica o erro no /admin.
function iabDoErros(ua) {
  const window = {};
  vm.runInNewContext(ler("src/erros.js"), { window, navigator: { userAgent: ua }, document: { querySelector: () => null }, location: { origin: "https://sleevu.app" }, console });
  return window.TCGErros.familia(ua, false).iab || "";
}

test("theme.js marca o app embutido antes da primeira pintura", () => {
  assert.equal(iabDoTheme(UA.instagramIos), "instagram");
  assert.equal(iabDoTheme(UA.instagramAndroid), "instagram", "Instagram no Android também diz wv: o nome do app vence");
  assert.equal(iabDoTheme(UA.facebookIos), "facebook");
  assert.equal(iabDoTheme(UA.facebookAndroid), "facebook");
  assert.equal(iabDoTheme(UA.tiktokAndroid), "tiktok");
  assert.equal(iabDoTheme(UA.webviewAndroid), "webview");
});

test("navegador de verdade não perde o Google", () => {
  for (const k of ["chromeAndroid", "samsung", "safariIphone", "chromeIphone", "edgeWin"]) {
    assert.equal(iabDoTheme(UA[k]), "", `${k} marcado como app embutido`);
  }
});

test("theme.js e erros.js dão o mesmo veredito (o /admin cruza os dois)", () => {
  for (const [k, ua] of Object.entries(UA)) assert.equal(iabDoTheme(ua), iabDoErros(ua), k);
});

test("/login: aviso traduzido, botões do Google fora e atalho da última conta desligado", () => {
  const html = ler("login.html"), css = ler("styles.css"), js = ler("src/login.js"), i18n = ler("src/i18n.js");
  assert.match(html, /class="login-iab"[\s\S]{0,700}data-i18n="login\.iab"/);
  assert.equal((i18n.match(/"login\.iab":/g) || []).length, 3, "login.iab nos três idiomas");
  assert.equal((i18n.match(/"login\.rateLimitedIab":/g) || []).length, 3, "login.rateLimitedIab nos três idiomas");
  assert.match(css, /html\[data-iab\] \.login-oauth,\s*html\[data-iab\] \.login-other,\s*html\[data-iab\] \.login-sep \{ display: none; \}/);
  assert.match(css, /\.login-iab \{ display: none; \}/, "fora do app embutido o aviso não aparece");
  assert.match(js, /if \(!embutido && conta && conta\.via === "google"/, "o atalho da última conta é Google: fora no app embutido");
});

test("pageview e login_gate levam a marca do app embutido", () => {
  const shared = ler("src/shared.js");
  assert.match(shared, /getAttribute\("data-iab"\);\s*if \(iab\) p\.iab = iab;/);
  assert.match(shared, /logEvento\("login_gate", document\.documentElement\.hasAttribute\("data-iab"\) \? \{ p: page, iab: 1 \}/);
});
