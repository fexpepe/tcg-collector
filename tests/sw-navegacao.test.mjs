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

// Resposta como o servidor manda: com o Date de agora (a cópia do cache HTTP
// guarda o Date de quando foi baixada).
const doServidor = (res, quando = Date.now()) => { res.headers.set("date", new Date(quando).toUTCString()); return res; };

test("HTML de OUTRO build vindo do servidor: responde com UM pedido, não entra no cache e o SW não pede a própria atualização", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const shell = await sw.sandbox.caches.open(sw.SHELL);
  await shell.put("portfolio.html", html("velha"));
  const pedidos = [];
  sw.estado.fetch = async (...args) => { pedidos.push(args); return doServidor(html("deploy-novo", "ffff0000")); };
  // parado há tempo: rede primeiro — o Date de agora diz que a página veio do
  // servidor, então é a leva atual: entregue sem baixar o mesmo HTML de novo
  const ev = evento("/portfolio");
  assert.equal(await texto(await sw.nav(ev)), "deploy-novo");
  assert.equal(pedidos.length, 1, "HTML fresco do servidor não é pedido duas vezes");
  await Promise.all(ev.pendentes);
  assert.equal(await texto(await shell.match("portfolio.html")), "velha", "página de outra leva não entra neste cache");
  // Quem pede a atualização é a página, depois da carga (shared.js): pedida
  // daqui, o install do SW novo disputava banda com a página recém-chegada.
  assert.equal(sw.updates.length, 0, "o SW não pede registration.update() no meio da navegação");
  assert.equal(await (await sw.sandbox.caches.open(sw.META)).match("shell-confirmado"), undefined, "sem confirmação: a próxima navegação volta à rede");
  // sessão ativa: cache na hora, e a rede por trás percebe o deploy
  await (await sw.sandbox.caches.open(sw.META)).put("shell-confirmado", new Response(String(Date.now())));
  const ev2 = evento("/portfolio");
  assert.equal(await texto(await sw.nav(ev2)), "velha");
  await Promise.all(ev2.pendentes);
  assert.equal(sw.updates.length, 0);
});

test("HTML de OUTRO build que pode ter saído do cache HTTP (Date velho ou ausente, histórico): confere no servidor", async () => {
  for (const [nome, resposta, pedido] of [
    ["Date de ontem", () => doServidor(html("deploy-novo", "ffff0000"), Date.now() - 864e5)],
    ["sem Date", () => html("deploy-novo", "ffff0000")],
    // relógio do aparelho atrasado: o Date "do futuro" também não conta como agora
    ["Date de daqui a 1 h", () => doServidor(html("deploy-novo", "ffff0000"), Date.now() + 36e5)],
    ["histórico (force-cache), mesmo com Date de agora", () => doServidor(html("deploy-novo", "ffff0000")), { cache: "force-cache" }]
  ]) {
    const sw = carrega({ hashed: true, build: "abc12345" });
    const pedidos = [];
    sw.estado.fetch = async (...args) => { pedidos.push(args); return resposta(); };
    const ev = evento("/portfolio", { pedido });
    assert.equal(await texto(await sw.nav(ev)), "deploy-novo", nome);
    assert.equal(pedidos.length, 2, `${nome}: conferido com um 2º pedido`);
    assert.equal(pedidos[1][0], ORIGEM + "/portfolio");
    assert.equal(pedidos[1][1].cache, "reload", "a conferência fura o cache HTTP");
    assert.equal(pedidos[1][1].redirect, "manual", "e não segue redirect (a navegação recusa resposta redirecionada)");
  }
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

// Dia de lançamento (2026-10-08): o manifest e os mapas de /games dizem QUAIS
// sets existem. Revalidando pelo cache HTTP (max-age=3600 + swr=86400), o SW
// recebia a cópia velha do próprio navegador e ficava dois deploys atrás — a
// lista de Sets não mostrava o set novo e a tela dele abria vazia. Os
// arquivos-índice revalidam com no-cache; os chunks seguem pelo cache HTTP.
test("catálogo: o índice revalida sem o cache HTTP, o chunk com ele, e a resposta sai do cache na hora", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const swr = vm.runInContext("staleWhileRevalidate", sw.sandbox);
  const cache = await sw.sandbox.caches.open(vm.runInContext("DATA_CACHE", sw.sandbox));
  const pedidos = [];
  sw.estado.fetch = async (req, init) => { pedidos.push([new URL(req.url).pathname, (init && init.cache) || "default"]); return new Response("novo", { status: 200 }); };
  for (const p of ["/data/manifest.generated.js", "/data/magic/game-pages/x.json", "/data/game-pages/pokemon.json", "/data/indexes-sets.generated.json", "/data/sets/en/sv1.json", "/data/magic/pricing-chunks/lea.json"]) {
    await cache.put(ORIGEM + p, new Response("velho"));
    let atras = null;
    const r = await swr({ request: new sw.sandbox.Request(ORIGEM + p), waitUntil: (x) => { atras = x; } });
    assert.equal(await r.text(), "velho", `${p}: a página não espera a rede`);
    await atras;
  }
  assert.deepEqual(pedidos, [
    ["/data/manifest.generated.js", "no-cache"],
    ["/data/magic/game-pages/x.json", "no-cache"],
    ["/data/game-pages/pokemon.json", "no-cache"],
    ["/data/indexes-sets.generated.json", "no-cache"],
    ["/data/sets/en/sv1.json", "default"],
    ["/data/magic/pricing-chunks/lea.json", "default"]
  ]);
});

test("tela do set novo: o detail.js busca o manifest de novo (query nova) antes de declarar o set vazio", () => {
  const detail = readFileSync(join(raiz, "src/detail.js"), "utf8");
  assert.ok(detail.includes("manifest.generated.js?v=${Date.now()}"), "sem o recarregaManifest com query nova");
  assert.ok(/if \(!entries\.length && detailName\) \{\s*const fresco = await recarregaManifest\(\);/.test(detail), "o resolveCards tem de tentar o manifest fresco antes de devolver []");
});

// ── Deploy novo sem competir com a página aberta (2026-10-08) ──────────────
// O install soltava os ~150 arquivos do precache de uma vez, na hora em que a
// página recém-chegada de um deploy ainda baixava os scripts dela.
test("install: no máximo INSTALL_PARALELO pedidos no ar, e as páginas por último", async () => {
  const sw = carrega({ hashed: true, build: "abc12345", ajusta: comHash });
  let noAr = 0, pico = 0;
  const ordem = [];
  sw.estado.fetch = async (req) => {
    ordem.push(new URL(req.url).pathname);
    noAr++;
    pico = Math.max(pico, noAr);
    await new Promise((r) => setTimeout(r, 2));
    noAr--;
    return new Response("ok");
  };
  await instala(sw);
  const lista = vm.runInContext("SHELL_ASSETS", sw.sandbox);
  assert.equal(ordem.length, lista.length, "cada arquivo pedido uma vez");
  assert.equal(pico, vm.runInContext("INSTALL_PARALELO", sw.sandbox), "a fila respeita o teto");
  const ehPagina = (p) => p === "/" || p.endsWith(".html");
  const primeira = ordem.findIndex(ehPagina);
  assert.ok(primeira > 0, "o shell começa pelos arquivos");
  assert.ok(ordem.slice(primeira).every(ehPagina), "depois da 1ª página, só páginas");
  assert.equal(sw.skips.length, 1);
});

test("fetch: /api/ e /cdn-cgi/ não passam pelo SW (a borda tem cache HTTP próprio)", () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  for (const p of ["/api/search?game=all&q=dragon&full=1", "/api/collection?ids=x", "/cdn-cgi/rum?x=1"]) {
    let respondeu = false;
    sw.listeners.fetch({ request: { url: ORIGEM + p, method: "GET", mode: "cors" }, respondWith: () => { respondeu = true; } });
    assert.equal(respondeu, false, p);
  }
  let respondeu = false;
  sw.listeners.fetch({ request: { url: ORIGEM + "/data/sets/en/sv1.json", method: "GET", mode: "cors" }, respondWith: () => { respondeu = true; }, waitUntil: () => {} });
  assert.equal(respondeu, true, "o catálogo segue com o SW");
});

test("navegação: 5xx do servidor com cópia guardada entrega a cópia; 404 é resposta", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const shell = await sw.sandbox.caches.open(sw.SHELL);
  await shell.put("portfolio.html", html("guardada"));
  sw.estado.fetch = async () => new Response("erro", { status: 503, headers: { "content-type": "text/html" } });
  assert.equal(await texto(await sw.nav(evento("/portfolio"))), "guardada");
  sw.estado.fetch = async () => new Response("sumiu", { status: 404, headers: { "content-type": "text/html" } });
  assert.equal((await sw.nav(evento("/portfolio"))).status, 404, "página que deixou de existir é resposta");
  sw.estado.fetch = async () => new Response("erro", { status: 502 });
  assert.equal((await sw.nav(evento("/blog"))).status, 502, "sem cópia, o erro passa (não há nada melhor pra mostrar)");
});

test("networkFirst: 404/5xx de um arquivo com cópia guardada entrega a cópia", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const nf = vm.runInContext("networkFirst", sw.sandbox);
  const shell = await sw.sandbox.caches.open(sw.SHELL);
  await shell.put(ORIGEM + "/manifest.json", new Response("guardado"));
  sw.estado.fetch = async () => new Response("erro", { status: 503 });
  const req = new sw.sandbox.Request(ORIGEM + "/manifest.json");
  assert.equal(await (await nf(req, new URL(req.url))).text(), "guardado");
  const outro = new sw.sandbox.Request(ORIGEM + "/speculation-rules.json");
  assert.equal((await nf(outro, new URL(outro.url))).status, 503, "sem cópia, o erro passa");
});

test("imagem de host mutável: erro na revalidação entrega a cópia guardada", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const cf = vm.runInContext("cacheFirst", sw.sandbox);
  const img = await sw.sandbox.caches.open(vm.runInContext("IMAGE_CACHE", sw.sandbox));
  const url = new URL("https://tcgplayer-cdn.tcgplayer.com/product/1_in_1000x1000.jpg");
  await img.put(url.href, new Response("arte-guardada"));
  sw.estado.fetch = async () => new Response("", { status: 403 });
  assert.equal(await (await cf(url)).text(), "arte-guardada");
});

test("precache: sem as páginas raras e com todo script das páginas que ele guarda", () => {
  const sw = readFileSync(join(raiz, "sw.js"), "utf8");
  const lista = new Set([...sw.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  for (const rara of ["admin.html", "src/admin.js", "faq.html", "privacy.html", "terms.html"]) assert.ok(!lista.has(rara), `${rara} voltou pro precache`);
  const faltando = [];
  for (const a of lista) {
    if (!(a === "./" || a.endsWith(".html"))) continue;
    const pagina = readFileSync(join(raiz, a === "./" ? "index.html" : a), "utf8");
    for (const m of pagina.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
      const s = m[1].replace(/^\.?\//, "");
      if (s.startsWith("src/") && !lista.has(s)) faltando.push(`${a} -> ${s}`);
    }
  }
  assert.deepEqual(faltando, [], "script de página precacheada fora do SHELL_ASSETS: offline a página pede um arquivo que o cache não tem");
});

// A atualização do SW sai da PÁGINA, depois da carga: quando o build dela é
// outro que o do SW no comando (saiu deploy). E a volta do segundo plano
// confere no máximo a cada 30 min.
test("shared.js: a página pede a atualização do SW depois da carga, e a volta do app tem intervalo", () => {
  const shared = readFileSync(join(raiz, "src/shared.js"), "utf8");
  const bloco = shared.slice(shared.indexOf('navigator.serviceWorker.register("sw.js")'), shared.indexOf('navigator.serviceWorker.addEventListener("controllerchange"'));
  assert.ok(bloco.includes("buildDoServiceWorker().then((dele) => { if (dele !== null && dele !== buildDaPagina()) reg.update()"));
  assert.ok(/Date\.now\(\) - conferiu < 18e5\) return;/.test(bloco), "a volta do segundo plano sem intervalo pede um update (e um install) por troca de app");
  assert.ok(/requestIdleCallback\(instala/.test(shared), "o registro segue depois do load e de um respiro");
});

// Espelho das imagens (2026-10-08): o job regrava a MESMA chave do
// img.sleevu.app quando a arte muda na origem (o TCGplayer troca o arquivo na
// mesma URL; o Scryfall muda a versão), e com o immutable de um ano o aparelho
// e a borda seguiam com a arte velha. O espelho do TCGplayer passa a valer a
// regra do host mutável no SW (revalida em 7 dias, furando o cache HTTP).
test("espelho do TCGplayer é mutável no SW: revalida vencido, com no-cache", async () => {
  const sw = carrega({ hashed: true, build: "abc12345" });
  const mutavel = vm.runInContext("imagemMutavel", sw.sandbox);
  assert.equal(mutavel(new URL("https://img.sleevu.app/tcgplayer-cdn.tcgplayer.com/product/1_in_1000x1000.jpg@600.webp")), true);
  assert.equal(mutavel(new URL("https://img.sleevu.app/cards.scryfall.io/normal/front/a/b.jpg@600.webp")), false);
  assert.equal(mutavel(new URL("https://tcgplayer-cdn.tcgplayer.com/product/1_in_1000x1000.jpg")), true);
  const cf = vm.runInContext("cacheFirst", sw.sandbox);
  const img = await sw.sandbox.caches.open(vm.runInContext("IMAGE_CACHE", sw.sandbox));
  const url = new URL("https://img.sleevu.app/tcgplayer-cdn.tcgplayer.com/product/2_in_1000x1000.jpg@600.webp");
  await img.put(url.href, new Response("arte-velha"));
  const pedidos = [];
  sw.estado.fetch = async (u, init) => { pedidos.push(init && init.cache); return new Response("arte-nova", { status: 200 }); };
  assert.equal(await (await cf(url)).text(), "arte-nova", "sem carimbo de validade, a cópia é conferida");
  assert.deepEqual(pedidos, ["no-cache"]);
});

test("job do espelho: regravação e host mutável sobem com 7 dias, e as regravadas vão pra purga da borda", () => {
  const job = readFileSync(join(raiz, "scripts/mirror-r2.mjs"), "utf8");
  assert.ok(job.includes('const CACHE_MUTAVEL = "public, max-age=604800";'));
  assert.ok(job.includes("const cacheControl = tem || f.mutavel ? CACHE_MUTAVEL : undefined;"));
  assert.ok(job.includes("if (tem) LARGURAS.forEach((w) => regravadas.push("));
  assert.ok(job.includes("if (!SECO) await purgaBorda();"));
  const wf = readFileSync(join(raiz, ".github/workflows/mirror-images.yml"), "utf8");
  assert.ok(wf.includes("CF_ZONE_ID: ${{ secrets.CF_ZONE_ID }}") && wf.includes("CF_PURGE_TOKEN: ${{ secrets.CF_PURGE_TOKEN }}"));
});
