// jserror v2 (2026-10-03, docs/PLANO-TECNICO.md S1/D1). O que se trava:
//   - o theme.js enfileira erro de JS, rejeição, recurso do site e CSP —
//     e deixa de fora imagem, recurso de outro domínio e o script inline da
//     detecção de robô do Cloudflare;
//   - o src/erros.js classifica o navegador/app embutido certo (é o corte que
//     o /admin usa pra separar celular, desktop e o público do anúncio), tira
//     o hash da leva dos quadros (senão o mesmo bug vira uma linha por deploy),
//     filtra extensão e ResizeObserver, marca terceiro e respeita os tetos;
//   - nenhum envio "dispara e esquece" do shared.js fica sem .catch — sem ele,
//     a falha de rede do próprio rastreio virava erro no painel.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (f) => readFileSync(join(raiz, f), "utf8");
const j = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

const UA = {
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  chromeIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1",
  instagramIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.20.104 (iPhone14,5; iOS 17_5; pt_BR; pt; scale=3.00; 1170x2532; 640253012)",
  facebookAndroid: "Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.47.109;]",
  tiktokAndroid: "Mozilla/5.0 (Linux; Android 12; moto g22 Build/STAS32.79; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 trill_340700 BytedanceWebview/d8a21c6",
  firefoxWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
  edgeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
};

// ── src/erros.js num navegador de mentira ──────────────────────────────────
function carregaErros({ ua = UA.chromeAndroid, toque = true, fila = [], sessao = new Map(), fetchFalha = false } = {}) {
  const enviados = [];
  const window = {
    __sleevuErros: fila,
    innerWidth: 412,
    matchMedia: () => ({ matches: toque })
  };
  const sandbox = {
    window,
    matchMedia: window.matchMedia,
    navigator: { userAgent: ua, maxTouchPoints: toque ? 5 : 0 },
    document: { querySelector: (s) => (s === 'meta[name="sleevu-build"]' ? { getAttribute: () => "cfcdd120" } : null) },
    location: { origin: "https://sleevu.app" },
    sessionStorage: { getItem: (k) => (sessao.has(k) ? sessao.get(k) : null), setItem: (k, v) => sessao.set(k, String(v)) },
    fetch: (url, init) => {
      enviados.push({ url, corpo: JSON.parse(init.body), headers: init.headers, keepalive: init.keepalive });
      return fetchFalha ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve({ ok: true });
    },
    console
  };
  vm.runInNewContext(ler("src/erros.js"), sandbox);
  const T = window.TCGErros;
  assert.ok(T, "erros.js não expôs window.TCGErros");
  // Objetos do vm têm outro protótipo: o deepEqual estrito compara pelo JSON.
  const E = { familia: (...a) => j(T.familia(...a)), quadros: (...a) => j(T.quadros(...a)), monta: (...a) => j(T.monta(...a)), despeja: T.despeja };
  return { E, window, enviados, sessao };
}
const ENVIO = { url: "https://x.supabase.co/rest/v1/events", headers: { apikey: "k" }, anon: "a1", game: "pokemon", path: "sets", lg: 1, pwa: 0 };

test("família do navegador, sistema e app embutido pelo user-agent", () => {
  const { E } = carregaErros();
  assert.deepEqual(E.familia(UA.chromeAndroid), { b: "chrome 141", o: "android" });
  assert.deepEqual(E.familia(UA.samsung), { b: "samsung 27", o: "android" });
  assert.deepEqual(E.familia(UA.safariIphone), { b: "safari 18", o: "ios" });
  assert.deepEqual(E.familia(UA.chromeIphone), { b: "chrome 141", o: "ios" });
  assert.deepEqual(E.familia(UA.instagramIos), { b: "webkit 17", o: "ios", iab: "instagram" });
  assert.deepEqual(E.familia(UA.facebookAndroid), { b: "chrome 141", o: "android", iab: "facebook" });
  assert.deepEqual(E.familia(UA.tiktokAndroid), { b: "chrome 140", o: "android", iab: "tiktok" });
  assert.deepEqual(E.familia(UA.firefoxWin), { b: "firefox 131", o: "windows" });
  assert.deepEqual(E.familia(UA.edgeWin), { b: "edge 141", o: "windows" });
  assert.deepEqual(E.familia(UA.safariMac), { b: "safari 18", o: "mac" });
  // iPad com iPadOS se declara Mac: o toque é o que entrega
  assert.equal(E.familia(UA.safariMac, true).o, "ios");
});

test("quadros: Chrome e Safari viram o mesmo caminho, sem origem e sem o hash da leva", () => {
  const { E } = carregaErros();
  const chrome = "TypeError: x is undefined\n    at No (https://sleevu.app/src/shared.a9fc7e26.js:93:2765)\n    at hl (https://sleevu.app/src/shared.a9fc7e26.js:93:2925)\n    at https://sleevu.app/src/app.f88583a3.js:1:200\n    at outro (https://sleevu.app/src/app.f88583a3.js:2:10)";
  const safari = "No@https://sleevu.app/src/shared.11112222.js:93:2765\nhl@https://sleevu.app/src/shared.11112222.js:93:2925";
  const q1 = E.quadros(chrome, "https://sleevu.app");
  assert.equal(q1.cru, "https://sleevu.app/src/shared.a9fc7e26.js:93:2765", "o 1º quadro cru fica, pro decodificador");
  assert.deepEqual(q1.f, ["src/shared.js:93:2765", "src/shared.js:93:2925", "src/app.js:1:200"]);
  assert.deepEqual(E.quadros(safari, "https://sleevu.app").f, ["src/shared.js:93:2765", "src/shared.js:93:2925"]);
  assert.deepEqual(E.quadros("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js:2:100", "https://sleevu.app").f,
    ["https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js:2:100"]);
});

test("monta: contexto completo, terceiro marcado, extensão e ResizeObserver de fora", () => {
  const { E } = carregaErros();
  const ctx = { origem: "https://sleevu.app", aparelho: { d: "m", b: "chrome 141", o: "android" }, v: "cfcdd120", lg: 1, pwa: 0, vw: 410 };
  const p = E.monta({ k: "promise", m: "x is not a function", p: "TypeError: x\n    at No (https://sleevu.app/src/detail.dfaf7ea6.js:1:500)" }, ctx);
  assert.deepEqual(p, { m: "x is not a function", s: "https://sleevu.app/src/detail.dfaf7ea6.js:1:500", k: "promise", f: ["src/detail.js:1:500"], d: "m", b: "chrome 141", o: "android", v: "cfcdd120", lg: 1, vw: 410 });
  assert.equal(E.monta({ k: "js", m: "Script error.", s: "" }, ctx).k, "terceiro");
  assert.equal(E.monta({ k: "js", m: "TagError: adsbygoogle.push() error", s: "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js:2:100" }, ctx).k, "terceiro");
  assert.equal(E.monta({ k: "js", m: "boom", s: "chrome-extension://abc/content.js:1:1" }, ctx), null);
  assert.equal(E.monta({ k: "js", m: "boom", p: "Error: boom\n    at x (webkit-masked-url://hidden/:1:1)" }, ctx), null);
  assert.equal(E.monta({ k: "js", m: "ResizeObserver loop completed with undelivered notifications.", s: "" }, ctx), null);
  assert.equal(E.monta({ k: "js", m: "", s: "" }, ctx), null);
  // recurso do site: sem pilha, a fonte é a URL que não veio
  assert.equal(E.monta({ k: "recurso", m: "script não carregou", s: "https://sleevu.app/src/scan.12345678.js" }, ctx).s, "https://sleevu.app/src/scan.12345678.js");
  // promise sem pilha nenhuma: "promise", como antes
  assert.equal(E.monta({ k: "promise", m: "undefined" }, ctx).s, "promise");
});

test("despeja: manda com o contexto do aparelho, uma vez por erro, com .catch e teto por sessão", async () => {
  const fila = [
    { k: "js", m: "a", s: "https://sleevu.app/src/app.f88583a3.js:1:1" },
    { k: "js", m: "a", s: "https://sleevu.app/src/app.f88583a3.js:1:1" },
    { k: "js", m: "ResizeObserver loop limit exceeded", s: "" },
    { k: "promise", m: "Load failed", p: "No@https://sleevu.app/src/shared.11112222.js:93:2765" }
  ];
  const { E, window, enviados, sessao } = carregaErros({ ua: UA.safariIphone, fila, fetchFalha: true });
  E.despeja(ENVIO);
  await new Promise((r) => setTimeout(r, 0)); // a rejeição do fetch precisa ser tratada (senão o node:test acusa)
  assert.equal(window.__sleevuErros.length, 0, "a fila esvazia");
  assert.equal(enviados.length, 2, "repetido e ResizeObserver não vão");
  const [primeiro, segundo] = enviados;
  assert.equal(primeiro.corpo.name, "jserror");
  assert.equal(primeiro.corpo.anon, "a1");
  assert.equal(primeiro.keepalive, true);
  assert.equal(primeiro.corpo.props.d, "m");
  assert.equal(primeiro.corpo.props.o, "ios");
  assert.equal(primeiro.corpo.props.b, "safari 18");
  assert.equal(primeiro.corpo.props.v, "cfcdd120");
  assert.equal(primeiro.corpo.props.lg, 1);
  assert.deepEqual(segundo.corpo.props.f, ["src/shared.js:93:2765"]);
  assert.equal(sessao.get("sleevu-jserror-n"), "2");

  // sessão que já mandou 15 não manda mais
  const cheio = carregaErros({ fila: [{ k: "js", m: "z", s: "" }], sessao: new Map([["sleevu-jserror-n", "15"]]) });
  cheio.E.despeja(ENVIO);
  assert.equal(cheio.enviados.length, 0);
});

// ── theme.js: a fila ───────────────────────────────────────────────────────
function rodaTheme() {
  const ouvintes = {};
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const add = (alvo) => (tipo, fn, captura) => { ouvintes[`${alvo}:${tipo}`] = { fn, captura: !!captura }; };
  const attrs = new Map([["lang", "pt-BR"]]);
  const window = { localStorage: storage, sessionStorage: storage, matchMedia: () => ({ matches: false }), addEventListener: add("window") };
  const document = {
    addEventListener: add("document"),
    documentElement: { getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null), setAttribute: (n, v) => attrs.set(n, String(v)), hasAttribute: (n) => attrs.has(n) },
    currentScript: null,
    querySelector: () => null,
    write: () => {}
  };
  window.window = window;
  vm.runInNewContext(ler("src/theme.js"), {
    window, document, localStorage: storage,
    navigator: { userAgent: UA.chromeAndroid, languages: ["pt-BR"], language: "pt-BR" },
    location: { search: "", pathname: "/", hash: "", origin: "https://sleevu.app" },
    history: { state: null, replaceState() {} }
  });
  return { window, ouvintes };
}

test("theme.js enfileira o que importa desde o 1º script, e avisa o shared.js", () => {
  const { window, ouvintes } = rodaTheme();
  assert.ok(Array.isArray(window.__sleevuErros), "a fila não nasceu");
  assert.ok(ouvintes["window:error"] && ouvintes["window:error"].captura, "erro de recurso só chega na fase de captura");
  let avisos = 0;
  window.__sleevuErroNovo = () => { avisos += 1; };
  const erro = ouvintes["window:error"].fn;
  erro({ target: window, message: "x is undefined", filename: "https://sleevu.app/src/app.js", lineno: 3, colno: 9, error: { stack: "TypeError: x\n    at f (https://sleevu.app/src/app.js:3:9)" } });
  erro({ target: { tagName: "SCRIPT", src: "https://sleevu.app/src/scan.1234abcd.js" } });
  erro({ target: { tagName: "IMG", src: "https://sleevu.app/x.webp" } });               // imagem: tem cadeia própria
  erro({ target: { tagName: "SCRIPT", src: "https://static.cloudflareinsights.com/beacon.min.js" } }); // de fora
  ouvintes["window:unhandledrejection"].fn({ reason: { message: "Load failed", stack: "No@https://sleevu.app/src/shared.js:1:1" } });
  ouvintes["document:securitypolicyviolation"].fn({ blockedURI: "inline", effectiveDirective: "script-src-elem" });       // Cloudflare
  ouvintes["document:securitypolicyviolation"].fn({ blockedURI: "https://novo-host.com/a.png?x=1", effectiveDirective: "img-src", sourceFile: "" });
  assert.deepEqual(j(window.__sleevuErros.map((x) => [x.k, x.m])), [
    ["js", "x is undefined"],
    ["recurso", "script não carregou"],
    ["promise", "Load failed"],
    ["csp", "img-src https://novo-host.com"]
  ]);
  assert.equal(window.__sleevuErros[0].s, "https://sleevu.app/src/app.js:3:9");
  assert.equal(avisos, 4);
});

test("shared.js: nenhum fetch de medição sem .catch, e os ouvintes saíram dele", () => {
  const src = ler("src/shared.js");
  for (const alvo of ["rest/v1/events", "rest/v1/rpc/consent_tally", "rest/v1/rpc/increment_card_view", "rest/v1/rpc/contribute_price", "rest/v1/rpc/increment_deck_view"]) {
    const re = new RegExp("fetch\\(`\\$\\{SUPABASE_URL\\}/" + alvo.replace(/\//g, "\\/") + "`", "g");
    let m, n = 0;
    while ((m = re.exec(src))) {
      n += 1;
      // o fim da chamada é o "})" no começo de uma linha que não é "})," (esse
      // fecha o JSON.stringify do corpo)
      const resto = src.slice(m.index, m.index + 900);
      const fim = resto.search(/\n\s*\}\)(?!,)/);
      assert.ok(fim > 0 && /^\n\s*\}\)\.catch\(semErro\)/.test(resto.slice(fim)), `fetch de ${alvo} sem .catch(semErro)`);
    }
    assert.ok(n > 0, `não achei o fetch de ${alvo}`);
  }
  assert.ok(!/addEventListener\("unhandledrejection"/.test(src), "o ouvinte de rejeição voltou pro shared.js (duplicaria o envio)");
  assert.match(src, /injectScript\("src\/erros\.js"\)/);
  assert.match(ler("sw.js"), /"src\/erros\.js"/, "o módulo de erros tem de estar no shell do SW (offline)");
});
