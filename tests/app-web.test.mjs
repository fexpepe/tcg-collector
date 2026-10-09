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
import {
  paginaDoApp, assetDoApp, transformaGameJs, transformaHtml, transformaCss, preenchePonte, confereOrigem, temVitrine, ORIGEM_PADRAO
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

function carregaPonte({ href = "http://localhost/", pagina = "index", base, nativo = false } = {}) {
  const u = new URL(href);
  const reg = { replace: [], replaceState: [], write: [], nativo: [], fetch: [], xhr: [], beacon: [], voltar: 0, ouvintes: {}, minimizou: 0 };
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
      write: (s) => reg.write.push(s)
    },
    history: { state: null, replaceState: (s, t, x) => reg.replaceState.push(x), back: () => { reg.voltar++; } },
    navigator: { serviceWorker: {}, sendBeacon: (x) => { reg.beacon.push(x); return true; } },
    PushManager: function () {},
    fetch: (x) => { reg.fetch.push(typeof x === "string" ? x : x.url); return Promise.resolve({}); },
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
          minimizeApp: () => { reg.minimizou++; return Promise.resolve(); }
        }
      }
    };
  }
  janela.window = janela;
  vm.createContext(janela);
  vm.runInContext(preenchePonte(PONTE, { origem: "https://sleevu.app", paginas: PAGINAS }), janela);
  return { janela, reg, app: janela.SLEEVU_APP };
}

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
