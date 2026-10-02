// Navegação do service worker (sw.js): a regra que decide se uma página vem
// do cache ou da rede — e a chave única por página. É o que evitava (e volta a
// evitar) o Portfólio abrir numa versão velha e quebrada antes da nova:
// o precache do deploy e a navegação gravavam em entradas diferentes, e a da
// navegação (velha) ganhava. Carrega o sw.js num sandbox com um Cache Storage
// de mentira e um fetch programável.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGEM = "https://sleevu.app";

function fakeCaches(location) {
  const href = (k) => {
    const u = new URL(typeof k === "string" ? k : k.url, location);
    return u.href;
  };
  const stores = new Map();
  class FakeCache {
    constructor() { this.map = new Map(); }
    async match(k, opts) {
      let alvo = href(k);
      if (opts && opts.ignoreSearch) { const u = new URL(alvo); u.search = ""; alvo = u.href; }
      const r = this.map.get(alvo);
      return r ? r.clone() : undefined;
    }
    async put(k, res) { this.map.set(href(k), res); }
    async keys() { return Array.from(this.map.keys()); }
    async delete(k) { return this.map.delete(href(k)); }
  }
  return {
    stores,
    async open(name) { if (!stores.has(name)) stores.set(name, new FakeCache()); return stores.get(name); },
    async keys() { return Array.from(stores.keys()); },
    async delete(name) { return stores.delete(name); },
    async match(k, opts) { for (const c of stores.values()) { const r = await c.match(k, opts); if (r) return r; } return undefined; }
  };
}

// hashed=true simula o deploy (o sed que vira HASHED_ASSETS e o hash-assets
// que põe o build id no SHELL_CACHE); false é o dev local. `ajusta` mexe no
// fonte antes de carregar (ex.: nomes com hash no SHELL_ASSETS, como no deploy).
function carrega({ hashed, build, ajusta } = {}) {
  let src = readFileSync(join(raiz, "sw.js"), "utf8");
  if (hashed) src = src.replace("const HASHED_ASSETS = false", "const HASHED_ASSETS = true");
  if (build) src = src.replace(/(const SHELL_CACHE\s*=\s*")([^"]+)(")/, `$1$2-${build}$3`);
  if (ajusta) src = ajusta(src);
  const location = new URL("/sw.js", ORIGEM);
  const listeners = {};
  const updates = [];
  const skips = [];
  const self = {
    location,
    addEventListener: (tipo, fn) => { listeners[tipo] = fn; },
    registration: { scope: ORIGEM + "/", update: async () => { updates.push(Date.now()); } },
    clients: { claim: async () => {} },
    skipWaiting: () => { skips.push(Date.now()); }
  };
  const estado = { fetch: async () => { throw new Error("sem rede"); } };
  // No SW, new Request("src/x.js") resolve contra a URL do próprio SW; o
  // Request do Node exige URL absoluta.
  class RequestDoSw extends Request {
    constructor(entrada, init) { super(typeof entrada === "string" ? new URL(entrada, location).href : entrada, init); }
  }
  const sandbox = {
    self, caches: fakeCaches(location), Response, Request: RequestDoSw, URL, Headers, console, Date, Math, Number, String, Promise, Set, RegExp, Error,
    fetch: (...args) => estado.fetch(...args),
    // O teto de espera do SW é de segundos; aqui encurta pra o teste não dormir.
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 40)),
    clearTimeout,
    navigator: {}
  };
  sandbox.self.navigator = sandbox.navigator;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const pega = (nome) => vm.runInContext(nome, sandbox);
  return { sandbox, listeners, estado, updates, skips, chave: pega("chaveDeNavegacao"), reserva: pega("reservaDaNavegacao"), nav: pega("navigationFast"), SHELL: pega("SHELL_CACHE"), META: pega("META_CACHE"), BUILD: pega("BUILD_ID") };
}

// HTML como o deploy entrega: com o carimbo do build (o mesmo do SW, salvo
// quando o teste quer simular um deploy novo).
const html = (texto, build = "abc12345") => new Response(`<meta charset="utf-8">\n<meta name="sleevu-build" content="${build}">\n${texto}`, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
// `pedido` completa o request da navegação (cache, referrer); `preload` é a
// resposta do navigation preload — a que, no histórico, sai do cache HTTP.
function evento(path, { pedido = {}, preload } = {}) {
  const pendentes = [];
  return { request: { url: ORIGEM + path, mode: "navigate", method: "GET", ...pedido }, preloadResponse: preload, waitUntil: (p) => pendentes.push(p), pendentes };
}
const texto = async (res) => (await res.text()).split("\n").pop();

test("chave de navegação: uma entrada por página, seja qual for a forma da URL", () => {
  const { chave } = carrega();
  assert.equal(chave(ORIGEM + "/portfolio"), ORIGEM + "/portfolio.html");
  assert.equal(chave(ORIGEM + "/portfolio?tab=x#y"), ORIGEM + "/portfolio.html");
  assert.equal(chave(ORIGEM + "/portfolio.html"), ORIGEM + "/portfolio.html");
  assert.equal(chave(ORIGEM + "/"), ORIGEM + "/");
  assert.equal(chave(ORIGEM + "/?game=magic"), ORIGEM + "/");
  assert.equal(chave(ORIGEM + "/users/fulano"), ORIGEM + "/collection.html");
  assert.equal(chave(ORIGEM + "/set/pokemon/sv1"), ORIGEM + "/set/pokemon/sv1.html");
});

// A tela de Sets de cada jogo mora em /games/<jogo> desde 2026-09-30, com
// título e índice DAQUELE jogo postos pela borda. Cada uma tem entrada própria
// (uma só pra todas entregava, na troca de jogo, a cópia do anterior), e a do
// sets.html, que o install guarda, é a reserva de quem ainda não tem a sua:
// sem ela, a tela de um jogo nunca visitado não abria offline.
test("chave de navegação: /games/<jogo> tem entrada própria, com o sets.html de reserva", () => {
  const { chave, reserva } = carrega();
  assert.equal(chave(ORIGEM + "/games/star-wars-unlimited"), ORIGEM + "/games/star-wars-unlimited.html");
  assert.equal(chave(ORIGEM + "/games/naruto-data-carddass?serie=x"), ORIGEM + "/games/naruto-data-carddass.html");
  assert.equal(chave(ORIGEM + "/sets?game=swu"), ORIGEM + "/sets.html");
  assert.equal(chave(ORIGEM + "/games"), ORIGEM + "/games.html");
  assert.equal(chave(ORIGEM + "/games/pokemon/base-set"), ORIGEM + "/games/pokemon/base-set.html");
  assert.equal(chave(ORIGEM + "/games/pokemon/base-set/charizard-4-102"), ORIGEM + "/games/pokemon/base-set/charizard-4-102.html");
  assert.equal(reserva(ORIGEM + "/games/star-wars-unlimited?serie=x"), ORIGEM + "/sets.html");
  // Tela do set e da carta (2026-10-01): a reserva é a do detail.html.
  assert.equal(reserva(ORIGEM + "/games/pokemon/base-set"), ORIGEM + "/detail.html");
  assert.equal(reserva(ORIGEM + "/games/pokemon/base-set/charizard-4-102?x=1"), ORIGEM + "/detail.html");
  for (const semReserva of ["/games", "/games/pokemon/_id/base1-4", "/games/a/b/c/d", "/portfolio", "/detail"]) {
    assert.equal(reserva(ORIGEM + semReserva), null, semReserva);
  }
});

test("offline: a carta de um set nunca visitado abre da cópia do detail.html", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const shell = await sw.sandbox.caches.open(sw.SHELL);
  await shell.put("detail.html", html("tela do set"));
  sw.estado.fetch = async () => { throw new Error("offline"); };
  assert.equal(await texto(await sw.nav(evento("/games/pokemon/base-set/charizard-4-102"))), "tela do set");
  assert.equal(await texto(await sw.nav(evento("/games/pokemon/base-set"))), "tela do set");
});

test("tela do set visitada: a entrada própria dela vence a reserva", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const shell = await sw.sandbox.caches.open(sw.SHELL);
  await shell.put("detail.html", html("reserva"));
  await (await sw.sandbox.caches.open(sw.META)).put("shell-confirmado", new Response(String(Date.now())));
  sw.estado.fetch = async () => html("base set da borda");
  const ev = evento("/games/pokemon/base-set");
  assert.equal(await texto(await sw.nav(ev)), "reserva", "sessão ativa, 1ª visita: a reserva na hora");
  await Promise.all(ev.pendentes);
  assert.equal(await texto(await shell.match(ORIGEM + "/games/pokemon/base-set.html")), "base set da borda");
  assert.equal(await texto(await shell.match("detail.html")), "reserva", "a reserva não é sobrescrita");
  assert.equal(await texto(await sw.nav(evento("/games/pokemon/base-set"))), "base set da borda");
});

test("offline: a tela de um jogo nunca visitado abre da cópia do sets.html", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const shell = await sw.sandbox.caches.open(sw.SHELL);
  await shell.put("sets.html", html("tela de sets"));
  sw.estado.fetch = async () => { throw new Error("offline"); };
  const res = await sw.nav(evento("/games/one-piece-carddass"));
  assert.equal(await texto(res), "tela de sets");
});

test("troca de jogo na sessão ativa: nunca a cópia do jogo anterior", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const shell = await sw.sandbox.caches.open(sw.SHELL);
  await shell.put("sets.html", html("tela de sets"));
  await (await sw.sandbox.caches.open(sw.META)).put("shell-confirmado", new Response(String(Date.now())));
  // Visita ao One Piece: a rede grava a entrada DELE.
  sw.estado.fetch = async () => html("tela do one piece");
  const ev1 = evento("/games/one-piece-carddass");
  await sw.nav(ev1);
  await Promise.all(ev1.pendentes);
  assert.equal(await texto(await shell.match(ORIGEM + "/games/one-piece-carddass.html")), "tela do one piece");
  assert.equal(await texto(await shell.match("sets.html")), "tela de sets", "a reserva não é sobrescrita");
  // Star Wars logo depois: sem entrada própria, vai a reserva (genérica), não o One Piece.
  sw.estado.fetch = async () => html("tela do star wars");
  const ev2 = evento("/games/star-wars-unlimited");
  assert.equal(await texto(await sw.nav(ev2)), "tela de sets");
  await Promise.all(ev2.pendentes);
  assert.equal(await texto(await shell.match(ORIGEM + "/games/star-wars-unlimited.html")), "tela do star wars");
  // E de volta ao One Piece, a dele.
  assert.equal(await texto(await sw.nav(evento("/games/one-piece-carddass"))), "tela do one piece");
});

test("precache (\"portfolio.html\") e navegação (/portfolio) caem na MESMA entrada", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const shell = await sw.sandbox.caches.open(sw.SHELL);
  await shell.put("portfolio.html", html("nova")); // como o install grava
  await (await sw.sandbox.caches.open(sw.META)).put("shell-confirmado", new Response(String(Date.now())));
  const res = await sw.nav(evento("/portfolio?x=1"));
  assert.equal(await texto(res), "nova");
});

test("sessão ativa (confirmação recente): cache na hora, rede atualiza por trás", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const shell = await sw.sandbox.caches.open(sw.SHELL);
  await shell.put("portfolio.html", html("velha"));
  await (await sw.sandbox.caches.open(sw.META)).put("shell-confirmado", new Response(String(Date.now())));
  sw.estado.fetch = async () => html("nova");
  const ev = evento("/portfolio");
  const res = await sw.nav(ev);
  assert.equal(await texto(res), "velha");
  await Promise.all(ev.pendentes);
  assert.equal(await texto(await shell.match("portfolio.html")), "nova", "a rede deve atualizar a entrada única");
});

test("parado há tempo (sem confirmação): a rede vem PRIMEIRO e carimba a confirmação", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const shell = await sw.sandbox.caches.open(sw.SHELL);
  await shell.put("portfolio.html", html("velha"));
  sw.estado.fetch = async () => html("nova");
  const res = await sw.nav(evento("/portfolio"));
  assert.equal(await texto(res), "nova");
  assert.equal(await texto(await shell.match("portfolio.html")), "nova");
  const carimbo = await (await sw.sandbox.caches.open(sw.META)).match("shell-confirmado");
  assert.ok(carimbo, "confirmação gravada");
  assert.ok(Date.now() - Number(await carimbo.text()) < 5000);
});

test("confirmação VELHA conta como nenhuma", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const shell = await sw.sandbox.caches.open(sw.SHELL);
  await shell.put("portfolio.html", html("velha"));
  await (await sw.sandbox.caches.open(sw.META)).put("shell-confirmado", new Response(String(Date.now() - 11 * 60 * 1000)));
  sw.estado.fetch = async () => html("nova");
  assert.equal(await texto(await sw.nav(evento("/portfolio"))), "nova");
});

test("rede lenta demais: a cópia local entra no teto e a rede termina por trás", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const shell = await sw.sandbox.caches.open(sw.SHELL);
  await shell.put("portfolio.html", html("velha"));
  let solta;
  sw.estado.fetch = () => new Promise((resolve) => { solta = () => resolve(html("nova")); });
  const ev = evento("/portfolio");
  const res = await sw.nav(ev);
  assert.equal(await texto(res), "velha");
  assert.equal(ev.pendentes.length, 1, "a rede fica pendurada no waitUntil");
  solta();
  await Promise.all(ev.pendentes);
  assert.equal(await texto(await shell.match("portfolio.html")), "nova");
});

test("offline (rede falha): a cópia local responde; sem cópia, erro de rede", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const shell = await sw.sandbox.caches.open(sw.SHELL);
  await shell.put("portfolio.html", html("velha"));
  sw.estado.fetch = async () => { throw new Error("offline"); };
  assert.equal(await texto(await sw.nav(evento("/portfolio"))), "velha");
  const res = await sw.nav(evento("/nunca-vista"));
  assert.equal(res.type, "error");
});

// /condicao e /ferramentas viraram /condition e /tools (301, 2026-10-01). O
// install novo não guarda mais as páginas antigas e o activate apaga o cache
// velho: offline, um atalho salvo pro endereço antigo caía em "sem conexão"
// com a página nova no cache. A reserva final mapeia; online o 301 segue.
test("offline: os endereços antigos das ferramentas abrem a cópia da página nova", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const shell = await sw.sandbox.caches.open(sw.SHELL);
  await shell.put("condition.html", html("guia de condição"));
  await shell.put("tools.html", html("índice"));
  sw.estado.fetch = async () => { throw new Error("offline"); };
  assert.equal(await texto(await sw.nav(evento("/condicao"))), "guia de condição");
  assert.equal(await texto(await sw.nav(evento("/condicao.html"))), "guia de condição");
  assert.equal(await texto(await sw.nav(evento("/ferramentas?x=1"))), "índice");
  // e não grava cópia nenhuma no endereço antigo
  assert.equal(await shell.match(ORIGEM + "/condicao.html"), undefined);
  // o resto segue sem reserva
  assert.equal((await sw.nav(evento("/sleeves"))).type, "error");
});

test("dev (sem hash): sempre rede primeiro, mesmo com confirmação recente", async () => {
  const sw = carrega({ hashed: false });
  const shell = await sw.sandbox.caches.open(sw.SHELL);
  await shell.put("portfolio.html", html("velha"));
  await (await sw.sandbox.caches.open(sw.META)).put("shell-confirmado", new Response(String(Date.now())));
  sw.estado.fetch = async () => html("nova");
  assert.equal(await texto(await sw.nav(evento("/portfolio"))), "nova");
});

test("HTML de OUTRO build vindo da rede: responde, não entra no cache e pede a atualização do SW (uma vez)", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const shell = await sw.sandbox.caches.open(sw.SHELL);
  await shell.put("portfolio.html", html("velha"));
  const pedidos = [];
  sw.estado.fetch = async (...args) => { pedidos.push(args); return html("deploy-novo", "ffff0000"); };
  // parado há tempo: rede primeiro — a página nova é entregue mesmo assim,
  // depois de CONFERIDA direto no servidor (não é a cópia velha do cache HTTP)
  const ev = evento("/portfolio");
  assert.equal(await texto(await sw.nav(ev)), "deploy-novo");
  assert.equal(pedidos.length, 2, "o HTML de outra leva foi conferido com um 2º pedido");
  assert.equal(pedidos[1][0], ORIGEM + "/portfolio");
  assert.equal(pedidos[1][1].cache, "reload", "a conferência fura o cache HTTP");
  assert.equal(pedidos[1][1].redirect, "manual", "e não segue redirect (a navegação recusa resposta redirecionada)");
  await Promise.all(ev.pendentes);
  assert.equal(await texto(await shell.match("portfolio.html")), "velha", "página de outra leva não entra neste cache");
  assert.equal(sw.updates.length, 1, "pediu registration.update()");
  assert.equal(await (await sw.sandbox.caches.open(sw.META)).match("shell-confirmado"), undefined, "sem confirmação: a próxima navegação volta à rede");
  // sessão ativa: cache na hora, e a rede por trás percebe o deploy
  await (await sw.sandbox.caches.open(sw.META)).put("shell-confirmado", new Response(String(Date.now())));
  const ev2 = evento("/portfolio");
  assert.equal(await texto(await sw.nav(ev2)), "velha");
  await Promise.all(ev2.pendentes);
  assert.equal(sw.updates.length, 1, "o pedido de atualização não se repete no mesmo SW");
});

// O set que "não abria" no PWA do iPhone (2026-09-29): voltar pra uma tela (ou
// o app restaurado pelo sistema) pede com cache "force-cache", e o navigation
// preload devolve a cópia que o navegador guardou daquela URL — de uma leva que
// já não existe no servidor. Entregue, ela pede um boot.js que dá 404 e a
// página fica em "Carregando" pra sempre, sem menu.
test("cópia VELHA do cache HTTP (histórico): o SW confere no servidor e entrega a da leva certa", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const shell = await sw.sandbox.caches.open(sw.SHELL);
  await shell.put("detail.html", html("local"));
  const pedidos = [];
  sw.estado.fetch = async (...args) => { pedidos.push(args); return html("conferida"); };
  const ev = evento("/detail?type=set&setId=sv08", { pedido: { cache: "force-cache" }, preload: html("copia-de-ontem", "0ld0ld00") });
  assert.equal(await texto(await sw.nav(ev)), "conferida");
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0][0], ORIGEM + "/detail?type=set&setId=sv08", "confere a MESMA URL, com a query");
  assert.equal(pedidos[0][1].cache, "reload");
  await Promise.all(ev.pendentes);
  assert.equal(await texto(await shell.match("detail.html")), "conferida", "a conferida é desta leva: entra no cache");
  assert.equal(sw.updates.length, 0, "cópia velha não é deploy novo: nada de pedir atualização do SW");
});

test("cópia velha e SEM rede pra conferir: vai a cópia deste cache, nunca a velha", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const shell = await sw.sandbox.caches.open(sw.SHELL);
  await shell.put("detail.html", html("local"));
  sw.estado.fetch = async () => { throw new Error("offline"); };
  const ev = evento("/detail?type=set&setId=sv08", { preload: html("copia-de-ontem", "0ld0ld00") });
  assert.equal(await texto(await sw.nav(ev)), "local");
});

test("cópia DESTA leva no preload: entrega sem pedido extra", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const pedidos = [];
  sw.estado.fetch = async (...args) => { pedidos.push(args); return html("nao-devia"); };
  const ev = evento("/detail?type=set&setId=sv08", { preload: html("do-preload") });
  assert.equal(await texto(await sw.nav(ev)), "do-preload");
  assert.equal(pedidos.length, 0);
});

test("a MESMA tela pedida de novo (recarregar, link pra ela mesma) pula a cópia da sessão", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const shell = await sw.sandbox.caches.open(sw.SHELL);
  const meta = await sw.sandbox.caches.open(sw.META);
  sw.estado.fetch = async () => html("da-rede");
  const url = "/detail?type=set&setId=sv08";
  // Cada passo parte do mesmo estado (cópia da sessão + confirmação recente) e
  // espera a rede de trás terminar antes do próximo.
  const navega = async (opcoes) => {
    await shell.put("detail.html", html("da-sessao"));
    await meta.put("shell-confirmado", new Response(String(Date.now())));
    const ev = evento(url, opcoes);
    const lido = await texto(await sw.nav(ev));
    await Promise.all(ev.pendentes);
    return lido;
  };
  assert.equal(await navega(), "da-sessao", "navegação comum na sessão ativa: cache na hora");
  assert.equal(await navega({ pedido: { referrer: ORIGEM + url } }), "da-rede", "o \"Tentar de novo\" (href=\"\") vai à rede");
  assert.equal(await navega({ pedido: { cache: "no-cache" } }), "da-rede", "recarregar vai à rede");
  assert.equal(await navega({ pedido: { referrer: ORIGEM + "/sets?game=pokemon" } }), "da-sessao", "vindo de outra tela, segue o cache da sessão");
});

// SHELL_ASSETS como o deploy deixa: nomes com hash (hash-assets.mjs).
const comHash = (src) => src.replace('"src/shared.js"', '"src/shared.46f75d8b.js"').replace('"styles.css"', '"styles.63a0ece8.css"');
async function instala(sw) {
  let promessa;
  sw.listeners.install({ waitUntil: (p) => { promessa = p; } });
  return promessa;
}

test("install: arquivo COM HASH que não baixa derruba a instalação (shell com buraco não assume)", async () => {
  const sw = carrega({ hashed: true, build: "abc12345", ajusta: comHash });
  sw.estado.fetch = async (req) => (req.url.endsWith("/src/shared.46f75d8b.js") ? new Response("", { status: 404 }) : new Response("ok"));
  await assert.rejects(instala(sw), /src\/shared\.46f75d8b\.js/);
  assert.equal(sw.skips.length, 0, "sem skipWaiting: o SW atual segue no comando");
});

test("install: HTML que não baixa NÃO derruba (a página só vai à rede), e arquivo com hash ganha 2ª chance", async () => {
  const sw = carrega({ hashed: true, build: "abc12345", ajusta: comHash });
  const tentativas = new Map();
  sw.estado.fetch = async (req) => {
    const n = (tentativas.get(req.url) || 0) + 1;
    tentativas.set(req.url, n);
    if (req.url.endsWith("/about.html")) return new Response("", { status: 404 });
    if (req.url.endsWith("/styles.63a0ece8.css") && n === 1) throw new Error("rede oscilou");
    return new Response("ok");
  };
  await instala(sw);
  assert.equal(sw.skips.length, 1);
  const shell = await sw.sandbox.caches.open(sw.SHELL);
  assert.ok(await shell.match("styles.63a0ece8.css"), "a 2ª tentativa gravou o CSS");
  assert.equal(await shell.match("about.html"), undefined);
});

test("dev: HTML sem carimbo e SW sem build são a mesma leva — entra no cache normalmente", async () => {
  const sw = carrega({ hashed: false });
  const shell = await sw.sandbox.caches.open(sw.SHELL);
  sw.estado.fetch = async () => html("local", "");
  const ev = evento("/portfolio");
  assert.equal(await texto(await sw.nav(ev)), "local");
  await Promise.all(ev.pendentes);
  assert.equal(await texto(await shell.match("portfolio.html")), "local");
  assert.equal(sw.updates.length, 0);
});

test("build id: sai do sufixo do SHELL_CACHE e volta na mensagem sleevu:build", () => {
  const dev = carrega();
  assert.equal(dev.BUILD, "");
  const prod = carrega({ hashed: true, build: "abc12345" });
  assert.equal(prod.BUILD, "abc12345");
  const respostas = [];
  prod.listeners.message({ data: { type: "sleevu:build" }, ports: [{ postMessage: (m) => respostas.push(m) }] });
  prod.listeners.message({ data: { type: "outra" }, ports: [{ postMessage: (m) => respostas.push(m) }] });
  assert.equal(respostas.length, 1);
  assert.equal(respostas[0].build, "abc12345");
  assert.ok(respostas[0].cache.endsWith("-abc12345"));
});

test("caches: só os desta leva sobrevivem ao activate", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const c = sw.sandbox.caches;
  await c.open("tcg-shell-v264-velho1");
  await c.open("tcg-shell-v265-outro");
  await c.open(sw.SHELL);
  await c.open("tcg-data-v1");
  const ev = { waitUntil: (p) => { ev.p = p; } };
  sw.listeners.activate(ev);
  await ev.p;
  assert.deepEqual((await c.keys()).sort(), [sw.SHELL, "tcg-data-v1"].sort());
});
