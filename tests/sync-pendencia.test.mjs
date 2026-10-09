// Sync com a nuvem falhando não pode apagar dado (2026-10-08).
//
// Três buracos travados aqui, todos no boot do initAuth (src/shared.js):
//  1. LOGIN cujo pull falhava (5xx, 429, rede trocando de Wi-Fi pra 4G) subia
//     mesmo assim o snapshot de cada jogo deste aparelho. O upsert troca o
//     `data` inteiro da linha: num celular novo, a coleção VAZIA ia por cima da
//     nuvem. Agora não sobe nada e todos os jogos ficam devendo.
//  2. Boot de SESSÃO com pull falho ligava o laço com `lastPushedByGame`
//     vazio: o 1º push subia o local de todos os jogos sem o merge. Agora a
//     página não sobe nada; o que for editado vira pendência na saída.
//  3. Edição que não teve push confirmado antes de a pessoa sair (keepalive
//     recusado acima de 64 KB, página fechada) ficava só no aparelho: o boot
//     seguinte carimbava o local como "já enviado". Agora a saída grava a
//     pendência e o próximo boot com pull bom sobe o jogo.
// O shared.js roda inteiro num sandbox com um Supabase falso no fetch.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const FONTE = readFileSync(join(raiz, "src/shared.js"), "utf8");
const PENDENCIA = "tcg-sync-pendente-v1";
const SESSAO = "tcg-supabase-session-v1";
const UID = "u-teste";

function montaApp({ seed = {}, hash = "", pullOk = true, linhas = [], pushOk = true } = {}) {
  const noop = () => {};
  const makeEl = (extra = {}) => new Proxy(
    Object.assign({ dataset: {}, style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, children: [], childNodes: [], options: [], attributes: [] }, extra),
    {
      get: (t, k) => {
        if (k in t) return t[k];
        if (typeof k !== "string") return undefined;
        if (/^(textContent|innerHTML|innerText|value|id|className|tagName|href|src|type|name|placeholder|title)$/.test(k)) return "";
        if (/^(querySelectorAll|getElementsByTagName|getElementsByClassName|getClientRects)$/.test(k)) return () => [];
        // querySelector de elemento CRIADO devolve outro falso: o initAuth monta
        // o menu da conta e os dropdowns por innerHTML e liga ouvintes nos filhos.
        if (k === "querySelector") return () => makeEl();
        if (/^(closest|getAttribute)$/.test(k)) return () => null;
        if (k === "getBoundingClientRect") return () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 });
        if (/^(appendChild|insertBefore|prepend|append|replaceWith|cloneNode)$/.test(k)) return (x) => x || makeEl();
        if (k === "hasAttribute") return () => false;
        return noop;
      },
      set: (t, k, v) => { t[k] = v; return true; }
    }
  );
  const attrs = new Map();
  const html = makeEl({ setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null), hasAttribute: (k) => attrs.has(k), removeAttribute: (k) => attrs.delete(k), lang: "pt-BR" });
  const nav = makeEl({ dataset: { activePage: "detail" } });
  const acoes = makeEl();
  const store = { ...seed };
  const ls = {
    getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; }, get length() { return Object.keys(store).length; }, key: (i) => Object.keys(store)[i] ?? null
  };
  const ouvintes = {};
  const ouve = (tipo, fn) => { (ouvintes[tipo] = ouvintes[tipo] || []).push(fn); };
  const pushes = [];
  const resposta = (ok, corpo, status = ok ? 200 : 503) => Promise.resolve({ ok, status, json: async () => corpo, text: async () => JSON.stringify(corpo) });
  const fetch = (url, init = {}) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) return resposta(true, { id: UID, email: "a@b.c" });
    if (u.includes("/auth/v1/token")) return resposta(true, { access_token: "t2", refresh_token: "r2", user: { id: UID, email: "a@b.c" } });
    if (u.includes("/rest/v1/collections") && (init.method || "GET") === "GET") return pullOk ? resposta(true, linhas) : resposta(false, { message: "fora" });
    if (u.includes("/rest/v1/collections") && init.method === "POST") {
      pushes.push({ corpo: JSON.parse(init.body), keepalive: !!init.keepalive });
      return resposta(pushOk, null);
    }
    return resposta(false, null, 599);
  };
  const sandbox = {
    document: {
      querySelector: (sel) => (/page-nav/.test(sel) ? nav : /header-actions/.test(sel) ? acoes : null), querySelectorAll: () => [],
      getElementById: () => null, createElement: () => makeEl(), createTextNode: () => makeEl(), createDocumentFragment: () => makeEl(),
      addEventListener: ouve, removeEventListener: noop, dispatchEvent: noop,
      documentElement: html, body: makeEl(), head: makeEl(), title: "", cookie: "", referrer: "", visibilityState: "visible", readyState: "loading",
      scripts: [], currentScript: null
    },
    localStorage: ls, sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    navigator: { language: "pt-BR", languages: ["pt-BR"], serviceWorker: undefined, onLine: true, userAgent: "Mozilla/5.0 (Linux; Android 14)" },
    location: { pathname: "/collection", search: "", hash, origin: "http://localhost", hostname: "localhost", host: "localhost", protocol: "http:", href: "http://localhost/collection" + hash, replace: noop, reload: noop },
    history: { replaceState: noop, pushState: noop, state: null },
    fetch,
    setInterval: noop, clearTimeout: noop, clearInterval: noop, setTimeout: noop, requestIdleCallback: noop, requestAnimationFrame: noop,
    console: { ...console, warn: noop, log: noop, info: noop }, URL, URLSearchParams, Blob: class {}, CustomEvent: class {},
    MessageChannel: class { constructor() { this.port1 = {}; this.port2 = {}; } },
    addEventListener: ouve, removeEventListener: noop, dispatchEvent: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    TCG_MESSAGES: { pt: {} },
    SLEEVU: { game: "hub", dataDir: "", manifest: true, catalogReady: Promise.resolve(), games: {}, line: "", urlDoJogo: () => "/games/pokemon", urlDoSet: () => "/games/pokemon" },
    IntersectionObserver: function () { return { observe: noop, disconnect: noop }; },
    ResizeObserver: function () { return { observe: noop, disconnect: noop }; },
    MutationObserver: function () { return { observe: noop, disconnect: noop }; },
    indexedDB: { open: () => ({}) }, performance: { now: () => 0, getEntriesByType: () => [] },
    screen: { width: 390, height: 844 }, innerWidth: 390, innerHeight: 844, devicePixelRatio: 3,
    alert: noop
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const fonte = FONTE.replace("window.TCGShared = {", "window.__t = { GAME_SLUGS, createCollectionStore, flushWrites, get comKeepalive() { return comKeepalive; } };\nwindow.TCGShared = {");
  vm.runInContext(fonte, sandbox, { filename: "shared.js" });
  const espera = async () => { for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r)); };
  const dispara = (tipo) => (ouvintes[tipo] || []).forEach((fn) => fn({ type: tipo }));
  const pendencia = () => { const p = ls.getItem(PENDENCIA); return p ? JSON.parse(p) : null; };
  return { sandbox, t: sandbox.__t, ls, pushes, espera, dispara, pendencia };
}

const comSessao = (extra = {}) => ({
  [SESSAO]: JSON.stringify({ access_token: "t1", refresh_token: "r1", user: { id: UID, email: "a@b.c" }, ts: Date.now() }),
  "tcg-collector-profile-v1": JSON.stringify({ handle: "teste" }),
  ...extra
});
const UMA_CARTA = JSON.stringify({ "base1-4": { Normal: { NM: 1 } } });

test("login com o pull FALHANDO não sobe nada e deixa todos os jogos devendo", async () => {
  const app = montaApp({ hash: "#access_token=t1&refresh_token=r1", pullOk: false, seed: { "tcg-collector-profile-v1": JSON.stringify({ handle: "teste" }) } });
  await app.espera();
  assert.equal(app.pushes.length, 0, "com o pull falho o login subiu o snapshot local por cima da nuvem");
  const p = app.pendencia();
  assert.ok(p && p.u === UID, "a pendência do login tem de ficar gravada com o dono");
  assert.deepEqual([...p.g].sort(), [...app.t.GAME_SLUGS].sort());
});

test("login com o pull bom segue subindo os jogos mesclados, sem pendência", async () => {
  const app = montaApp({ hash: "#access_token=t1&refresh_token=r1", linhas: [], seed: { "tcg-collector-profile-v1": JSON.stringify({ handle: "teste" }) } });
  await app.espera();
  assert.equal(app.pushes.length, 1);
  assert.equal(app.pushes[0].corpo.length, app.t.GAME_SLUGS.length);
  assert.equal(app.pendencia(), null);
});

test("sessão com o pull FALHANDO não sobe nada; o que for editado vira pendência na saída", async () => {
  const app = montaApp({ seed: comSessao(), pullOk: false });
  await app.espera();
  app.t.createCollectionStore("pokemon").add("base1-4", "Normal", "NM", 1);
  app.t.flushWrites();
  app.dispara("pagehide");
  await app.espera();
  assert.equal(app.pushes.length, 0, "pull falho: nenhum push sem merge");
  const p = app.pendencia();
  assert.ok(p && p.g.includes("pokemon"), `a edição do Pokémon tinha de ficar devendo: ${JSON.stringify(p)}`);
});

test("boot com pull bom sobe o que ficou devendo e limpa a pendência", async () => {
  const app = montaApp({
    seed: comSessao({ "tcg-collector-pokemon-collection-v3": UMA_CARTA, [PENDENCIA]: JSON.stringify({ u: UID, g: ["pokemon"] }) }),
    linhas: []
  });
  await app.espera();
  assert.equal(app.pushes.length, 1, "o jogo devendo tinha de subir no boot");
  const linha = app.pushes[0].corpo.find((l) => l.game === "pokemon");
  assert.ok(linha && linha.data.collection && linha.data.collection["base1-4"], "a carta que só existia no aparelho tinha de ir pra nuvem");
  assert.equal(app.pendencia(), null);
});

test("pendência de OUTRA conta não sobe", async () => {
  const app = montaApp({
    seed: comSessao({ "tcg-collector-pokemon-collection-v3": UMA_CARTA, [PENDENCIA]: JSON.stringify({ u: "outra-conta", g: ["pokemon"] }) }),
    linhas: []
  });
  await app.espera();
  assert.equal(app.pushes.length, 0);
});

test("push do boot que falha mantém o jogo devendo", async () => {
  const app = montaApp({
    seed: comSessao({ "tcg-collector-pokemon-collection-v3": UMA_CARTA, [PENDENCIA]: JSON.stringify({ u: UID, g: ["pokemon"] }) }),
    linhas: [], pushOk: false
  });
  await app.espera();
  assert.ok(app.pushes.length >= 1);
  assert.deepEqual(app.pendencia(), { u: UID, g: ["pokemon"] });
});

test("saída sem nada editado não varre nem sobe; com edição, grava a pendência antes de enviar", async () => {
  const app = montaApp({ seed: comSessao(), linhas: [] });
  await app.espera();
  const antes = app.pushes.length;
  app.dispara("pagehide");
  await app.espera();
  assert.equal(app.pushes.length, antes, "saída sem edição não pode subir nada");
  app.dispara("pageshow"); // a página voltou (bfcache): pode sair de novo
  app.t.createCollectionStore("pokemon").add("base1-4", "Normal", "NM", 1);
  app.t.flushWrites();
  app.sandbox.document.visibilityState = "hidden";
  app.dispara("visibilitychange");
  app.dispara("pagehide"); // os dois juntos, como na navegação: UM push só
  await app.espera();
  assert.equal(app.pushes.length, antes + 1, "um push por saída");
  // O push confirmou: a pendência gravada antes do envio foi limpa.
  assert.equal(app.pendencia(), null);
});

test("keepalive só com corpo que cabe nos 64 KB do Fetch", () => {
  const { t } = montaApp({});
  assert.equal(t.comKeepalive(true, "x".repeat(1000)), true);
  assert.equal(t.comKeepalive(true, "x".repeat(30000)), false, "corpo grande com keepalive é recusado pelo navegador na hora");
  assert.equal(t.comKeepalive(false, "x"), false);
});
