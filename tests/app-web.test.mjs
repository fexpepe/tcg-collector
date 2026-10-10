// O app (Capacitor, mobile/): a montagem do pacote web (scripts/lib/app-web.mjs),
// a ponte que roda em toda página dele (mobile/web/app-nativo.js) e as amarras
// que, se soltarem, quebram o app CALADAS — o mesmo id nos quatro lugares, o
// app fora do deploy do site, o pacote sem data/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { webcrypto, createHash } from "node:crypto";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";
import {
  paginaDoApp, assetDoApp, transformaGameJs, transformaHtml, transformaCss, preenchePonte, supabaseDoSite, confereOrigem, temVitrine, temTurnstile, ORIGEM_PADRAO
} from "../scripts/lib/app-web.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
// Checkout Windows (autocrlf) traz CRLF; as regras abaixo comparam com LF.
const ler = (rel) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const PAGINAS = readdirSync(RAIZ).filter((f) => f.endsWith(".html")).map((f) => f.slice(0, -5)).filter(paginaDoApp).sort();

// ── Montagem ────────────────────────────────────────────────────────────────

test("game.js do app: modo manifest, espelho e o catálogo de todo jogo na origem", () => {
  const { texto, jogos } = transformaGameJs(ler("src/game.js"), { origem: "https://sleevu.app", hostsEspelho: ["wsrv.nl"] });
  assert.match(texto, /var MANIFEST = true; \/\* SLEEVU_MANIFEST \*\//);
  assert.match(texto, /var IMG_MIRROR_HOSTS = \["wsrv\.nl"\]; \/\* SLEEVU_IMG_MIRROR \*\//);
  assert.ok(jogos >= 20, `só ${jogos} jogos no registro`);
  assert.doesNotMatch(texto, /dataDir: "data\//, "sobrou dataDir relativo: o catálogo desse jogo pediria ao próprio aparelho");
  assert.equal((texto.match(/dataDir: "https:\/\/sleevu\.app\/data\//g) || []).length, jogos);
});

test("game.js sem os marcadores: a montagem PARA, não sai um app com catálogo de amostra", () => {
  assert.throws(() => transformaGameJs("var MANIFEST = false;"), /SLEEVU_MANIFEST/);
  const semEspelho = ler("src/game.js").replace(/var IMG_MIRROR_HOSTS[^\n]*/, "");
  assert.throws(() => transformaGameJs(semEspelho), /SLEEVU_IMG_MIRROR/);
});

test("toda página do app: a ponte é o 1º script, logo depois do <head>", () => {
  for (const p of PAGINAS) {
    const html = transformaHtml(ler(`${p}.html`), { pagina: p });
    const head = /<head(?:\s[^>]*)?>/i.exec(html);
    const depois = html.slice(head.index + head[0].length);
    const primeiroScript = /<script\b[^>]*>/i.exec(depois);
    assert.ok(primeiroScript, `${p}.html sem script`);
    assert.equal(primeiroScript[0], `<script src="/src/app-nativo.js" data-pagina="${p}">`, `${p}.html: a ponte não é o 1º script`);
    assert.ok(depois.indexOf(primeiroScript[0]) < 3, `${p}.html: a ponte não está colada no <head>`);
    // O Capacitor injeta a ponte DELE depois do 1º "<head>" literal (Android
    // antigo, sem DOCUMENT_START_SCRIPT): <head> com atributo cairia no </head>.
    assert.ok(html.includes("<head>"), `${p}.html: <head> com atributo`);
  }
});

test("pacote sem data/: referência estática vai pra origem, vitrine sai, .ics vai pro servidor", () => {
  for (const p of PAGINAS) {
    const html = transformaHtml(ler(`${p}.html`), { pagina: p, origem: "https://sleevu.app" });
    assert.doesNotMatch(html, /\s(?:src|href)="(?:\.?\/)?data\//, `${p}.html ainda pede data/ ao aparelho`);
    assert.ok(!temVitrine(html), `${p}.html ainda carrega a vitrine (src/ads.js)`);
    assert.doesNotMatch(html, /\shref="(?:\.?\/)?lancamentos\.ics"/, `${p}.html: o .ics só existe no servidor`);
  }
  // As que tinham vitrine continuam inteiras, só sem ela.
  const sets = transformaHtml(ler("sets.html"), { pagina: "sets" });
  assert.ok(temVitrine(ler("sets.html")));
  assert.match(sets, /src="src\/shared\.js"/);
});

test("<base href=\"/\"> entra só no index.html (o que o Capacitor serve em todo caminho)", () => {
  assert.match(transformaHtml(ler("index.html"), { pagina: "index" }), /data-pagina="index"><\/script>\n<base href="\/">/);
  for (const p of PAGINAS.filter((x) => x !== "index")) {
    const antes = (ler(`${p}.html`).match(/<base\s/g) || []).length;
    const depois = (transformaHtml(ler(`${p}.html`), { pagina: p }).match(/<base\s/g) || []).length;
    assert.equal(depois, antes, `${p}.html ganhou <base>: href="?aba=x" passaria a ir pro início`);
  }
});

test("CSS do app: cada env(safe-area-inset-*) ganha a medida do Capacitor na frente", () => {
  assert.equal(transformaCss("padding-top: env(safe-area-inset-top, 0px);"),
    "padding-top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px));");
  assert.equal(transformaCss("bottom: calc(8px + env(safe-area-inset-bottom));"),
    "bottom: calc(8px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom)));");
  const css = transformaCss(ler("styles.css"));
  const soltos = css.replace(/var\(--safe-area-inset-[a-z]+, env\(safe-area-inset-[a-z]+(?:\s*,\s*[^)]*)?\)\)/g, "");
  assert.doesNotMatch(soltos, /env\(safe-area-inset-(?:top|right|bottom|left)/, "sobrou env() sem a medida do Capacitor");
  assert.ok((css.match(/var\(--safe-area-inset-/g) || []).length >= 20);
});

test("o que fica de fora do app", () => {
  for (const p of ["admin", "parceiro", "blog-editor", "games", "mockup-home"]) assert.equal(paginaDoApp(p), false, p);
  for (const p of ["index", "hub", "sets", "detail", "collection", "login", "404"]) assert.equal(paginaDoApp(p), true, p);
  assert.equal(assetDoApp("brand/Magic-The-Gathering-logo.png"), false);
  assert.equal(assetDoApp("brand/sleevu-wordmark.svg"), true);
  assert.equal(assetDoApp("games/README.md"), false);
  assert.equal(assetDoApp("vendor/tesseract-7.0.0/worker.min.js"), true, "o Worker do scanner tem de vir da origem da página");
});

test("origem: https, ou http só em localhost (ensaio); sem caminho", () => {
  assert.equal(confereOrigem("https://sleevu.app"), "https://sleevu.app");
  assert.equal(confereOrigem("http://localhost:8790"), "http://localhost:8790");
  assert.throws(() => confereOrigem("http://sleevu.app"), /https/);
  assert.throws(() => confereOrigem("https://sleevu.app/data"), /caminho/);
  assert.throws(() => confereOrigem("sleevu.app"), /inválida/);
  assert.equal(ORIGEM_PADRAO, "https://sleevu.app");
});

// ── A ponte, num navegador de mentira ───────────────────────────────────────

const PONTE = ler("mobile/web/app-nativo.js");

// Armazenamento de mentira que sobrevive entre "páginas" (cada carregaPonte é
// uma página nova do mesmo app): é o que o PKCE e a volta do login usam.
function armazem() {
  const dados = {};
  return {
    getItem: (k) => (k in dados ? dados[k] : null),
    setItem: (k, v) => { dados[k] = String(v); },
    removeItem: (k) => { delete dados[k]; },
    _dados: dados
  };
}

function carregaPonte({ href = "http://localhost/", pagina = "index", base, nativo = false, local = armazem(), sessao = armazem(), lancamento = null, sessaoSupabase = null } = {}) {
  const u = new URL(href);
  const reg = { replace: [], replaceState: [], write: [], nativo: [], fetch: [], xhr: [], beacon: [], voltar: 0, ouvintes: {}, minimizou: 0, abriu: [], fechou: 0, token: [], barras: [], aoCarregar: [], observadores: [] };
  const atributosHtml = {};
  const comAcessor = (proto, props) => {
    for (const p of props) {
      Object.defineProperty(proto, p, { configurable: true, enumerable: true, get() { return this["_" + p]; }, set(v) { this["_" + p] = v; } });
    }
  };
  class Element {
    setAttribute(n, v) { (this.attrs = this.attrs || {})[n] = v; }
    insertAdjacentHTML(onde, html) { this.adjacente = html; }
  }
  comAcessor(Element.prototype, ["innerHTML", "outerHTML"]);
  class HTMLImageElement extends Element {}
  comAcessor(HTMLImageElement.prototype, ["src", "srcset"]);
  class HTMLScriptElement extends Element {}
  comAcessor(HTMLScriptElement.prototype, ["src"]);
  class XMLHttpRequest { open(m, url) { reg.xhr.push(url); } }
  const janela = {
    location: { href, pathname: u.pathname, search: u.search, hash: u.hash, origin: u.origin, replace: (x) => reg.replace.push(x) },
    document: {
      baseURI: base || href,
      currentScript: { getAttribute: (n) => (n === "data-pagina" ? pagina : null) },
      write: (s) => reg.write.push(s),
      documentElement: { getAttribute: (n) => (n in atributosHtml ? atributosHtml[n] : null) },
      addEventListener: (ev, fn) => { if (ev === "DOMContentLoaded") reg.aoCarregar.push(fn); }
    },
    MutationObserver: class { constructor(fn) { reg.observadores.push(fn); } observe() {} },
    history: { state: null, replaceState: (s, t, x) => reg.replaceState.push(x), back: () => { reg.voltar++; } },
    navigator: { serviceWorker: {}, sendBeacon: (x) => { reg.beacon.push(x); return true; } },
    PushManager: function () {},
    fetch: (x, opcoes) => {
      const alvo = typeof x === "string" ? x : x.url;
      reg.fetch.push(alvo);
      if (/\/auth\/v1\/token\?grant_type=pkce$/.test(alvo)) {
        reg.token.push({ alvo, opcoes });
        return Promise.resolve({ ok: !!sessaoSupabase, json: async () => sessaoSupabase });
      }
      return Promise.resolve({});
    },
    localStorage: local, sessionStorage: sessao,
    crypto: webcrypto, TextEncoder, btoa,
    XMLHttpRequest, Element, HTMLImageElement, HTMLScriptElement,
    URL, URLSearchParams, Request
  };
  if (nativo) {
    janela.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => "android",
      nativePromise: (plugin, metodo) => { reg.nativo.push(`${plugin}.${metodo}`); return Promise.resolve({}); },
      // O que a ponte nativa injeta pra cada plugin instalado (JSExport).
      Plugins: {
        App: {
          addListener: (evento, fn) => { reg.ouvintes[evento] = fn; return Promise.resolve({ remove() {} }); },
          minimizeApp: () => { reg.minimizou++; return Promise.resolve(); },
          getLaunchUrl: () => Promise.resolve(lancamento ? { url: lancamento } : undefined)
        },
        Browser: {
          open: (o) => { reg.abriu.push(o.url); return Promise.resolve(); },
          close: () => { reg.fechou++; return Promise.resolve(); }
        },
        SystemBars: { setStyle: (o) => { reg.barras.push(o.style); return Promise.resolve(); } }
      }
    };
  }
  janela.window = janela;
  vm.createContext(janela);
  vm.runInContext(preenchePonte(PONTE, { origem: "https://sleevu.app", paginas: PAGINAS, supabase: SUPABASE_DO_SITE }), janela);
  return { janela, reg, app: janela.SLEEVU_APP, atributosHtml };
}
const SUPABASE_DO_SITE = supabaseDoSite(ler("src/shared.js"));
const espera = () => new Promise((r) => setTimeout(r, 20));

test("rotas: cada endereço que a borda serve abre a página certa do pacote", () => {
  const { app } = carregaPonte();
  // JSON: o objeto nasce no contexto do vm (outro Object.prototype).
  const d = (c) => JSON.parse(JSON.stringify(app._destino(c)));
  assert.equal(d("/"), null);
  assert.equal(d("/index"), null);
  assert.deepEqual(d("/games/pokemon/base-set/charizard-4-102"), { arquivo: "detail" });
  assert.deepEqual(d("/games/pokemon/base-set"), { arquivo: "detail" });
  assert.deepEqual(d("/games/pokemon"), { arquivo: "sets" });
  assert.deepEqual(d("/games/pokemon/"), { arquivo: "sets" });
  assert.deepEqual(d("/games"), { arquivo: "hub", bonito: "/hub" });
  assert.equal(d("/games/pokemon/_id/base1-4"), null, "o _id é 301 que só a borda resolve");
  assert.equal(d("/games/a/b/c/d"), null);
  assert.deepEqual(d("/users/fexpepe"), { arquivo: "collection" });
  assert.deepEqual(d("/users/fexpepe/vendas/caixa-1"), { arquivo: "collection" });
  assert.deepEqual(d("/blog"), { arquivo: "blog" });
  assert.deepEqual(d("/blog/guia-do-charizard"), { arquivo: "blog-post" });
  assert.deepEqual(d("/graded"), { arquivo: "collection", busca: "tab=graded", bonito: "/collection" });
  assert.deepEqual(d("/ferramentas"), { arquivo: "tools", bonito: "/tools" });
  assert.deepEqual(d("/condicao"), { arquivo: "condition", bonito: "/condition" });
  assert.equal(d("/admin"), null, "painel de admin não vai no app");
  assert.equal(d("/nao-existe"), null);
  // URL limpa: toda página do pacote abre pelo próprio nome.
  for (const p of PAGINAS.filter((x) => x !== "index")) assert.deepEqual(d(`/${p}`), { arquivo: p }, p);
});

test("index.html fora da raiz: vai pra página certa e para de carregar a landing", () => {
  const { reg } = carregaPonte({ href: "http://localhost/games/pokemon/base-set/charizard-4-102?x=1#popup" });
  assert.deepEqual(reg.replace, ["/detail.html?x=1&__rota=%2Fgames%2Fpokemon%2Fbase-set%2Fcharizard-4-102%3Fx%3D1%23popup"]);
  assert.match(reg.write[0], /<plaintext/);

  const graded = carregaPonte({ href: "http://localhost/graded" }).reg;
  assert.deepEqual(graded.replace, ["/collection.html?tab=graded&__rota=%2Fcollection%3Ftab%3Dgraded"]);

  const desconhecido = carregaPonte({ href: "http://localhost/qualquer-coisa" }).reg;
  assert.deepEqual(desconhecido.replace, ["/404.html"]);

  const raiz = carregaPonte({ href: "http://localhost/" }).reg;
  assert.deepEqual(raiz.replace, []);
  assert.deepEqual(raiz.write, []);
});

test("a página de destino põe o endereço bonito de volta; endereço de fora não entra", () => {
  const ok = carregaPonte({ href: "http://localhost/detail.html?x=1&__rota=%2Fgames%2Fpokemon%2Fbase-set%3Fx%3D1", pagina: "detail" }).reg;
  assert.deepEqual(ok.replaceState, ["/games/pokemon/base-set?x=1"]);
  assert.deepEqual(ok.replace, []);
  const fora = carregaPonte({ href: "http://localhost/detail.html?__rota=%2F%2Fgolpe.com%2Fx", pagina: "detail" }).reg;
  assert.deepEqual(fora.replaceState, []);
  const absoluto = carregaPonte({ href: "http://localhost/detail.html?__rota=https%3A%2F%2Fgolpe.com", pagina: "detail" }).reg;
  assert.deepEqual(absoluto.replaceState, []);
});

test("pedido ao servidor sai pra origem; o resto passa reto", async () => {
  const { janela, reg } = carregaPonte({ href: "http://localhost/games/pokemon/base-set", pagina: "detail", base: "http://localhost/" });
  await janela.fetch("data/game-pages/pokemon.json");
  await janela.fetch("/api/search?game=all&q=mew");
  await janela.fetch("https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/events");
  await janela.fetch("src/erros.js");
  await janela.fetch(new Request("http://localhost/api/collection", { method: "POST", body: "{}" }));
  assert.deepEqual(reg.fetch, [
    "https://sleevu.app/data/game-pages/pokemon.json",
    "https://sleevu.app/api/search?game=all&q=mew",
    "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/events",
    "src/erros.js",
    "https://sleevu.app/api/collection"
  ]);
  new janela.XMLHttpRequest().open("GET", "data/fx.generated.json");
  assert.deepEqual(reg.xhr, ["https://sleevu.app/data/fx.generated.json"]);
  janela.navigator.sendBeacon("/api/x", "{}");
  assert.deepEqual(reg.beacon, ["https://sleevu.app/api/x"]);
});

test("imagem do catálogo (data/…) em innerHTML, src, srcset e setAttribute vai pra origem", () => {
  const { janela } = carregaPonte({ href: "http://localhost/sets", pagina: "sets", base: "http://localhost/" });
  const el = new janela.Element();
  el.innerHTML = '<img class="logo" src="data/set-logos/en/base1.webp" srcset="data/a.webp 1x, data/b.webp 2x"><a href="detail?type=set">x</a>';
  assert.equal(el.innerHTML, '<img class="logo" src="https://sleevu.app/data/set-logos/en/base1.webp" srcset="https://sleevu.app/data/a.webp 1x, https://sleevu.app/data/b.webp 2x"><a href="detail?type=set">x</a>');
  const semDado = '<div class="tile"><img src="https://img.sleevu.app/x@300.webp"></div>';
  el.innerHTML = semDado;
  assert.equal(el.innerHTML, semDado);
  el.insertAdjacentHTML("beforeend", "<img src='data/onepiece/vintage-images/a.webp'>");
  assert.equal(el.adjacente, "<img src='https://sleevu.app/data/onepiece/vintage-images/a.webp'>");
  const img = new janela.HTMLImageElement();
  img.src = "data/set-logos/symbol/base1.png";
  assert.equal(img.src, "https://sleevu.app/data/set-logos/symbol/base1.png");
  img.setAttribute("src", "data/x.webp");
  img.setAttribute("class", "data/nao-e-url");
  assert.deepEqual(img.attrs, { src: "https://sleevu.app/data/x.webp", class: "data/nao-e-url" });
  const s = new janela.HTMLScriptElement();
  s.src = "src/scan.js";
  assert.equal(s.src, "src/scan.js", "código do pacote fica no pacote");
});

test("no aparelho: avisa o Capgo, some com SW e Web Push e já é 'app instalado'", () => {
  const { janela, reg, app } = carregaPonte({ href: "http://localhost/hub.html", pagina: "hub", nativo: true });
  assert.deepEqual(reg.nativo, ["CapacitorUpdater.notifyAppReady"]);
  assert.equal(app.nativo, true);
  assert.equal(app.plataforma, "android");
  assert.equal(app.origem, "https://sleevu.app");
  assert.equal(janela.navigator.serviceWorker, undefined);
  assert.equal(janela.navigator.standalone, true);
  assert.equal("PushManager" in janela, false);
  // No navegador comum (ensaio do pacote) não há Capgo nem "app instalado".
  const web = carregaPonte({ href: "http://localhost/hub.html", pagina: "hub" });
  assert.deepEqual(web.reg.nativo, []);
  assert.equal(web.app.nativo, false);
  assert.equal(web.janela.navigator.standalone, undefined);
});

test("voltar do Android: anda no histórico; sem pra onde voltar, minimiza", () => {
  const { reg } = carregaPonte({ href: "http://localhost/hub.html", pagina: "hub", nativo: true });
  assert.equal(typeof reg.ouvintes.backButton, "function");
  reg.ouvintes.backButton({ canGoBack: true });
  assert.equal(reg.voltar, 1);
  assert.equal(reg.minimizou, 0);
  reg.ouvintes.backButton({ canGoBack: false });
  assert.equal(reg.voltar, 1);
  assert.equal(reg.minimizou, 1);
  assert.deepEqual(carregaPonte({ href: "http://localhost/hub.html", pagina: "hub" }).reg.ouvintes, {}, "no navegador comum não há botão nativo");
});

test("cada página do app leva o commit do pacote como build (o `v` do rastreio de erro)", () => {
  const html = transformaHtml(ler("hub.html"), { pagina: "hub", build: "app-2cfc8ed8" });
  assert.match(html, /data-pagina="hub"><\/script>\n<meta name="sleevu-build" content="app-2cfc8ed8">/);
  assert.match(transformaHtml(ler("hub.html"), { pagina: "hub" }), /content="app-dev"/);
  assert.throws(() => transformaHtml(ler("hub.html"), { pagina: "hub", build: '"><script>' }), /build inválido/);
});

test("barras do sistema: ícones claros no tema escuro do site, escuros no claro — e acompanham a troca", () => {
  const { reg, atributosHtml } = carregaPonte({ href: "http://localhost/hub.html", pagina: "hub", nativo: true });
  reg.aoCarregar.forEach((fn) => fn());
  assert.deepEqual(reg.barras, ["DARK"], "tema escuro (padrão): fundo escuro, ícones claros");
  atributosHtml["data-theme"] = "light";
  reg.observadores.forEach((fn) => fn());
  assert.deepEqual(reg.barras, ["DARK", "LIGHT"]);
  reg.observadores.forEach((fn) => fn());
  assert.deepEqual(reg.barras, ["DARK", "LIGHT"], "sem chamada repetida pro mesmo tema");
  // No navegador comum não há barras nativas.
  const web = carregaPonte({ href: "http://localhost/hub.html", pagina: "hub" });
  assert.deepEqual(web.reg.barras, []);
});

test("toda página do app pede viewport-fit=cover (o app desenha por baixo das barras)", () => {
  for (const p of PAGINAS) {
    const meta = /<meta[^>]+name="viewport"[^>]*>/i.exec(ler(`${p}.html`));
    assert.ok(meta, `${p}.html sem viewport`);
    assert.match(meta[0], /viewport-fit=cover/, `${p}.html sem viewport-fit=cover: no Android o app ganharia faixas nas barras`);
  }
  const cfg = JSON.parse(ler("mobile/capacitor.config.json"));
  assert.equal(cfg.plugins.SystemBars.initialViewportFitValueHint, "cover");
  assert.match(ler("mobile/android/app/src/main/res/values/styles.xml"), /android:windowBackground">@color\/fundo_app</);
  assert.match(ler("mobile/android/app/src/main/java/app/sleevu/MainActivity.java"), /onRenderProcessGone[\s\S]*recreate\(\);[\s\S]*return true;/, "WebView que cai não pode fechar o app");
});

// ── Login no app (PKCE) ─────────────────────────────────────────────────────

test("entrar: guarda o segredo e abre o login do SITE com o desafio S256", async () => {
  const local = armazem();
  const { app, reg } = carregaPonte({ href: "http://localhost/login.html", pagina: "login", nativo: true, local });
  assert.equal(await app.entrar(), true);
  assert.equal(reg.abriu.length, 1);
  const u = new URL(reg.abriu[0]);
  assert.equal(u.origin + u.pathname, "https://sleevu.app/login");
  assert.equal(u.searchParams.get("m"), "s256");
  assert.equal(u.searchParams.get("p"), "android");
  const guardado = JSON.parse(local.getItem("sleevu-app-pkce"));
  assert.match(guardado.v, /^[\w-]{43}$/);
  const esperado = createHash("sha256").update(guardado.v).digest("base64url");
  assert.equal(u.searchParams.get("app"), esperado, "o desafio é o SHA-256 do segredo, e o segredo não sai do app");
  assert.ok(!reg.abriu[0].includes(guardado.v));
  // Fora do app (ensaio no navegador) não há plugin: não abre nada.
  assert.equal(await carregaPonte({ href: "http://localhost/login.html", pagina: "login" }).app.entrar(), false);
});

test("volta do login: troca o código pela sessão com o segredo e entra pelo caminho do site", async () => {
  const local = armazem();
  local.setItem("sleevu-app-pkce", JSON.stringify({ v: "segredo-de-teste-".padEnd(43, "x"), t: Date.now() }));
  const sessaoSupabase = { access_token: "tok.acesso", refresh_token: "tok-renova", expires_in: 3600 };
  const { app, reg, janela } = carregaPonte({ href: "http://localhost/hub.html", pagina: "hub", nativo: true, local, sessaoSupabase });
  assert.equal(app._trataVolta("app.sleevu://login?code=c0d1g0"), true);
  await espera();
  assert.equal(reg.token.length, 1);
  assert.equal(reg.token[0].alvo, `${SUPABASE_DO_SITE.url}/auth/v1/token?grant_type=pkce`);
  assert.equal(reg.token[0].opcoes.headers.apikey, SUPABASE_DO_SITE.chave);
  assert.deepEqual(JSON.parse(reg.token[0].opcoes.body), { auth_code: "c0d1g0", code_verifier: "segredo-de-teste-".padEnd(43, "x") });
  const destino = new URL(janela.location.href, "http://localhost/");
  assert.equal(destino.pathname, "/login.html");
  const h = new URLSearchParams(destino.hash.slice(1));
  assert.equal(h.get("access_token"), "tok.acesso");
  assert.equal(h.get("refresh_token"), "tok-renova");
  assert.equal(reg.fechou, 1, "fecha o navegador do login (iOS)");
  assert.equal(local.getItem("sleevu-app-pkce"), null, "o segredo é de uso único");
});

test("volta do login: recusa do Supabase, segredo ausente, repetição e outro endereço", async () => {
  // Link vencido: o motivo do Supabase vai pro login.js mostrar.
  const r1 = carregaPonte({ href: "http://localhost/hub.html", pagina: "hub", nativo: true });
  r1.app._trataVolta("app.sleevu://login?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid");
  const h1 = new URLSearchParams(new URL(r1.janela.location.href, "http://x/").hash.slice(1));
  assert.equal(h1.get("error_code"), "otp_expired");
  // Código sem segredo (outro aparelho, app reinstalado): aviso do app, sem chamar o Supabase.
  const r2 = carregaPonte({ href: "http://localhost/hub.html", pagina: "hub", nativo: true });
  r2.app._trataVolta("app.sleevu://login?code=x");
  assert.equal(new URLSearchParams(new URL(r2.janela.location.href, "http://x/").hash.slice(1)).get("error"), "app_login");
  assert.equal(r2.reg.token.length, 0);
  // Segredo velho (mais de 30 min) também não vale.
  const local = armazem();
  local.setItem("sleevu-app-pkce", JSON.stringify({ v: "v".repeat(43), t: Date.now() - 31 * 60 * 1000 }));
  const r3 = carregaPonte({ href: "http://localhost/hub.html", pagina: "hub", nativo: true, local });
  r3.app._trataVolta("app.sleevu://login?code=x");
  assert.equal(r3.reg.token.length, 0);
  // A mesma volta duas vezes na mesma abertura do app (evento + getLaunchUrl): só a 1ª.
  const sessao = armazem();
  const r4 = carregaPonte({ href: "http://localhost/hub.html", pagina: "hub", nativo: true, sessao });
  assert.equal(r4.app._trataVolta("app.sleevu://login?code=um"), true);
  const r5 = carregaPonte({ href: "http://localhost/login.html", pagina: "login", nativo: true, sessao });
  assert.equal(r5.app._trataVolta("app.sleevu://login?code=um"), false);
  // Qualquer outro endereço não é volta de login.
  assert.equal(r5.app._trataVolta("https://sleevu.app/login?code=x"), false);
  assert.equal(r5.app._trataVolta("app.sleevu://outra-coisa?code=x"), false);
});

test("volta do login chega pelo evento e pela abertura do app — mas não no index que está saindo", async () => {
  const fica = carregaPonte({ href: "http://localhost/", pagina: "index", nativo: true, lancamento: "app.sleevu://login?code=z" });
  assert.equal(typeof fica.reg.ouvintes.appUrlOpen, "function");
  await espera();
  assert.match(String(fica.janela.location.href), /\/login\.html#error=app_login/, "abriu pelo link: tratou (sem segredo, aviso)");
  const sai = carregaPonte({ href: "http://localhost/games/pokemon", pagina: "index", nativo: true, lancamento: "app.sleevu://login?code=z" });
  assert.equal(sai.reg.ouvintes.appUrlOpen, undefined, "o index que redireciona não ouve a volta");
});

test("pacote do app: a ponte leva o Supabase do site e o login fica sem o Turnstile", () => {
  assert.match(SUPABASE_DO_SITE.url, /^https:\/\/[a-z0-9]+\.supabase\.co$/);
  assert.ok(SUPABASE_DO_SITE.chave.length > 10);
  const ponte = preenchePonte(PONTE, { origem: "https://sleevu.app", paginas: PAGINAS, supabase: SUPABASE_DO_SITE });
  assert.ok(ponte.includes(JSON.stringify(SUPABASE_DO_SITE.url)));
  assert.throws(() => preenchePonte(PONTE, { origem: "https://sleevu.app", paginas: PAGINAS }), /Supabase/);
  assert.ok(temTurnstile(ler("login.html")), "o site segue com o Turnstile");
  assert.ok(!temTurnstile(transformaHtml(ler("login.html"), { pagina: "login" })), "o app não");
  // O bloco do app e o aviso do navegador aberto pelo app estão no login.html.
  const login = ler("login.html");
  assert.match(login, /id="loginApp"/);
  assert.match(login, /class="login-app-web"/);
});

test("site: login pedido pelo app volta pro app (link e Google), com o desafio; sem pedido, nada muda", async () => {
  const sb = loadShared("window.__test = { sendMagicLink, oauthSignIn };");
  const pedidos = [];
  sb.fetch = async (url, opcoes) => { pedidos.push({ url, corpo: JSON.parse(opcoes.body) }); return { ok: true }; };
  sb.sessionStorage = makeLocalStorage();
  sb.location = { origin: "https://sleevu.app", pathname: "/login", href: "https://sleevu.app/login", search: "", hash: "" };
  const { sendMagicLink, oauthSignIn } = sb.window.__test;

  // Login normal: volta pra esta página, sem PKCE.
  await sendMagicLink("a@b.com", "tok");
  assert.match(pedidos[0].url, /\/auth\/v1\/otp\?redirect_to=https%3A%2F%2Fsleevu\.app%2Flogin$/);
  assert.equal(pedidos[0].corpo.code_challenge, undefined);

  // Pedido do app (o login.js guardou): volta pro app, com o desafio.
  const c = "A".repeat(43);
  sb.sessionStorage.setItem("sleevu-login-app", JSON.stringify({ c, m: "s256", p: "android" }));
  await sendMagicLink("a@b.com", "tok");
  assert.match(pedidos[1].url, /redirect_to=app\.sleevu%3A%2F%2Flogin$/);
  assert.equal(pedidos[1].corpo.code_challenge, c);
  assert.equal(pedidos[1].corpo.code_challenge_method, "s256");
  assert.equal(pedidos[1].corpo.gotrue_meta_security.captcha_token, "tok", "o captcha segue indo");
  oauthSignIn("google", { login_hint: "a@b.com" });
  const u = new URL(sb.location.href);
  assert.equal(u.searchParams.get("redirect_to"), "app.sleevu://login");
  assert.equal(u.searchParams.get("code_challenge"), c);
  assert.equal(u.searchParams.get("code_challenge_method"), "s256");
  assert.equal(u.searchParams.get("login_hint"), "a@b.com");

  // Pedido torto (desafio fora do formato) não desvia o login de ninguém.
  sb.sessionStorage.setItem("sleevu-login-app", JSON.stringify({ c: "curto", m: "s256" }));
  await sendMagicLink("a@b.com", "tok");
  assert.match(pedidos[2].url, /redirect_to=https%3A%2F%2Fsleevu\.app%2Flogin$/);
});

// ── Amarras do projeto ──────────────────────────────────────────────────────

test("o mesmo id nos quatro lugares (Capgo, Capacitor, Android, iOS)", () => {
  const cfg = JSON.parse(ler("mobile/capacitor.config.json"));
  assert.equal(cfg.appId, "app.sleevu");
  const gradle = ler("mobile/android/app/build.gradle");
  assert.match(gradle, new RegExp(`applicationId "${cfg.appId.replace(".", "\\.")}"`));
  assert.match(gradle, new RegExp(`namespace = "${cfg.appId.replace(".", "\\.")}"`));
  const pbx = ler("mobile/ios/App/App.xcodeproj/project.pbxproj");
  const ids = [...new Set(pbx.match(/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g))];
  assert.deepEqual(ids, [`PRODUCT_BUNDLE_IDENTIFIER = ${cfg.appId};`]);
  assert.match(ler("mobile/android/app/src/main/java/app/sleevu/MainActivity.java"), /^package app\.sleevu;/m);
  assert.match(ler("codemagic.yaml"), new RegExp(`bundle_identifier: ${cfg.appId.replace(".", "\\.")}`));
  // Versão nativa em X.Y.Z: o Capgo compara com a do pacote web por semver.
  assert.match(gradle, /versionName\(System\.getenv\("SLEEVU_VERSION_NAME"\) \?: "1\.0\.0"\)/);
  assert.deepEqual([...new Set(pbx.match(/MARKETING_VERSION = [^;]+;/g))], ["MARKETING_VERSION = 1.0.0;"]);
});

test("o app não vai pro site e o site não espera pelo app", () => {
  const deploy = ler(".github/workflows/deploy.yml");
  const rm = /rm -rf \.git \.github[^\n]*/.exec(deploy)[0];
  assert.match(rm, /\smobile(\s|$)/, "o deploy publicaria mobile/ no sleevu.app");
  assert.match(rm, /\scodemagic\.yaml(\s|$)/);
  assert.match(deploy, /paths-ignore:[\s\S]*?- "mobile\/\*\*"[\s\S]*?- "codemagic\.yaml"[\s\S]*?schedule:/);
  assert.equal(JSON.parse(ler("mobile/capacitor.config.json")).webDir, "www");
  assert.match(ler("mobile/.gitignore"), /^www\/$/m, "o pacote montado não é versionado");
  assert.ok(!existsSync(join(RAIZ, "package.json")), "package.json na raiz subiria pro site (o deploy publica a raiz)");
});

test("codemagic.yaml: build de loja só por tag vX.Y.Z", () => {
  const cm = ler("codemagic.yaml");
  const eventos = [...cm.matchAll(/events:\n((?:\s+- \w+\n)+)/g)].map((m) => m[1].trim().split(/\s*-\s*/).filter(Boolean));
  assert.ok(eventos.length >= 2, "workflows sem gatilho");
  for (const e of eventos) assert.deepEqual(e, ["tag"]);
  assert.match(cm, /pattern: "v\*"/);
  assert.doesNotMatch(cm, /@capgo\/cli|capgo (?:bundle|upload)/i, "live update não sai do Codemagic");
});
