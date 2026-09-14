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
// que põe o build id no SHELL_CACHE); false é o dev local.
function carrega({ hashed, build } = {}) {
  let src = readFileSync(join(raiz, "sw.js"), "utf8");
  if (hashed) src = src.replace("const HASHED_ASSETS = false", "const HASHED_ASSETS = true");
  if (build) src = src.replace(/(const SHELL_CACHE\s*=\s*")([^"]+)(")/, `$1$2-${build}$3`);
  const location = new URL("/sw.js", ORIGEM);
  const listeners = {};
  const updates = [];
  const self = {
    location,
    addEventListener: (tipo, fn) => { listeners[tipo] = fn; },
    registration: { scope: ORIGEM + "/", update: async () => { updates.push(Date.now()); } },
    clients: { claim: async () => {} },
    skipWaiting: () => {}
  };
  const estado = { fetch: async () => { throw new Error("sem rede"); } };
  const sandbox = {
    self, caches: fakeCaches(location), Response, Request, URL, Headers, console, Date, Math, Number, String, Promise, Set, RegExp,
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
  return { sandbox, listeners, estado, updates, chave: pega("chaveDeNavegacao"), nav: pega("navigationFast"), SHELL: pega("SHELL_CACHE"), META: pega("META_CACHE"), BUILD: pega("BUILD_ID") };
}

// HTML como o deploy entrega: com o carimbo do build (o mesmo do SW, salvo
// quando o teste quer simular um deploy novo).
const html = (texto, build = "abc12345") => new Response(`<meta charset="utf-8">\n<meta name="sleevu-build" content="${build}">\n${texto}`, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
function evento(path) {
  const pendentes = [];
  return { request: { url: ORIGEM + path, mode: "navigate", method: "GET" }, preloadResponse: undefined, waitUntil: (p) => pendentes.push(p), pendentes };
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
  sw.estado.fetch = async () => html("deploy-novo", "ffff0000");
  // parado há tempo: rede primeiro — a página nova é entregue mesmo assim
  const ev = evento("/portfolio");
  assert.equal(await texto(await sw.nav(ev)), "deploy-novo");
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
