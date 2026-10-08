// Arquivo de idioma que não chega não pode derrubar a tela (2026-10-08).
//
// Em produção o idioma é um <script defer> que o theme.js escreve
// (split-i18n). Quando esse pedido falhava (rede do celular oscilou, 404
// momentâneo), o shared.js rodava mesmo assim com window.TCG_MESSAGES
// indefinido: o primeiro t() lia `table[key]` com `table` undefined e lançava
// TypeError ANTES de marcar o data-app. Resultado: tela sem navegação, sem
// grade e o cartão "Esta tela não terminou de carregar" aos 15 s. Reproduzido
// em produção abortando só o i18n.pt.<hash>.js.
//
// Trava: (1) o theme.js cria o esqueleto { pt: {} } antes de escrever os
// pacotes; (2) com SÓ esse esqueleto (nenhum pacote chegou), o shared.js sobe
// até o data-app.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (f) => readFileSync(join(raiz, f), "utf8");

test("o theme.js cria o esqueleto da tabela antes de escrever os pacotes de idioma", () => {
  const theme = ler("src/theme.js");
  const esqueleto = theme.search(/window\.TCG_MESSAGES = window\.TCG_MESSAGES \|\| \{ pt: \{\} \};/);
  const escreve = theme.indexOf("document.write('<script defer src=");
  assert.ok(esqueleto > 0, "sem o esqueleto window.TCG_MESSAGES = … || { pt: {} } no theme.js");
  assert.ok(escreve > esqueleto, "o esqueleto tem de vir ANTES do document.write dos pacotes");
});

// O shared.js num sandbox em que o <html> registra atributos (é o data-app que
// prova que a tela subiu) e a página tem a .page-nav (o initPageNav chama t()).
function sobeShared(mensagens) {
  const noop = () => {};
  const attrs = new Map();
  const makeEl = (extra = {}) => new Proxy(
    Object.assign({ dataset: {}, style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, children: [], childNodes: [], options: [], attributes: [] }, extra),
    {
      get: (t, k) => {
        if (k in t) return t[k];
        if (typeof k !== "string") return undefined;
        if (/^(textContent|innerHTML|innerText|value|id|className|tagName|href|src|type|name|placeholder|title)$/.test(k)) return "";
        if (/^(querySelectorAll|getElementsByTagName|getElementsByClassName|getClientRects)$/.test(k)) return () => [];
        if (/^(querySelector|closest|getAttribute)$/.test(k)) return () => null;
        if (k === "getBoundingClientRect") return () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 });
        if (/^(appendChild|insertBefore|prepend|append|replaceWith|cloneNode)$/.test(k)) return (x) => x || makeEl();
        if (k === "hasAttribute") return () => false;
        return noop;
      },
      set: (t, k, v) => { t[k] = v; return true; }
    }
  );
  const html = makeEl({
    setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    hasAttribute: (k) => attrs.has(k), removeAttribute: (k) => attrs.delete(k), lang: "pt-BR"
  });
  const nav = makeEl({ dataset: { activePage: "detail" } });
  const ls = () => {
    const store = {};
    return { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; }, clear: noop, get length() { return Object.keys(store).length; }, key: (i) => Object.keys(store)[i] ?? null };
  };
  const sandbox = {
    document: {
      querySelector: (sel) => (/page-nav/.test(sel) ? nav : null), querySelectorAll: () => [],
      getElementById: () => null, createElement: () => makeEl(), createTextNode: () => makeEl(), createDocumentFragment: () => makeEl(),
      addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
      documentElement: html, body: makeEl(), head: makeEl(), title: "", cookie: "", referrer: "", visibilityState: "visible", readyState: "loading",
      scripts: [], currentScript: null
    },
    localStorage: ls(), sessionStorage: ls(),
    navigator: { language: "pt-BR", languages: ["pt-BR"], serviceWorker: undefined, onLine: true, userAgent: "Mozilla/5.0 (Linux; Android 14)" },
    location: { pathname: "/games/pokemon/base-set", search: "", hash: "", origin: "https://sleevu.app", hostname: "sleevu.app", host: "sleevu.app", protocol: "https:", href: "https://sleevu.app/games/pokemon/base-set", replace: noop, reload: noop },
    history: { replaceState: noop, pushState: noop, state: null },
    fetch: () => Promise.resolve({ ok: false, status: 599, json: async () => null, text: async () => "" }),
    setInterval: noop, clearTimeout: noop, clearInterval: noop, setTimeout: noop, requestIdleCallback: noop, requestAnimationFrame: noop,
    console: { ...console, warn: noop, log: noop, info: noop }, URL, URLSearchParams, Blob: class {}, CustomEvent: class {},
    MessageChannel: class { constructor() { this.port1 = {}; this.port2 = {}; } },
    addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    TCG_MESSAGES: mensagens,
    SLEEVU: { game: "pokemon", dataDir: "data/", manifest: true, catalogReady: Promise.resolve(), games: {}, line: "", urlDoJogo: () => "/games/pokemon", urlDoSet: () => "/games/pokemon" },
    IntersectionObserver: function () { return { observe: noop, disconnect: noop }; },
    ResizeObserver: function () { return { observe: noop, disconnect: noop }; },
    MutationObserver: function () { return { observe: noop, disconnect: noop }; },
    indexedDB: { open: () => ({}) }, performance: { now: () => 0, getEntriesByType: () => [] },
    screen: { width: 390, height: 844 }, innerWidth: 390, innerHeight: 844, devicePixelRatio: 3
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  let erro = null;
  try { vm.runInContext(ler("src/shared.js"), sandbox, { filename: "shared.js" }); } catch (e) { erro = e; }
  return { erro, dataApp: attrs.has("data-app"), t: sandbox.TCGShared && sandbox.TCGShared.t };
}

test("sem nenhum pacote de idioma (só o esqueleto do theme.js), o shared.js sobe até o data-app", () => {
  const r = sobeShared({ pt: {} });
  assert.equal(r.erro, null, `o boot lançou: ${r.erro && r.erro.message}`);
  assert.equal(r.dataApp, true, "a tela não marcou o data-app (o cartão de emergência apareceria aos 15 s)");
  assert.equal(r.t("nav.games"), "nav.games", "sem tabela, o t() devolve a chave crua");
});

test("controle: sem o esqueleto, o mesmo boot morre (é o que o theme.js previne)", () => {
  const r = sobeShared(undefined);
  assert.ok(r.erro instanceof Error || (r.erro && r.erro.name === "TypeError"), "esperava o TypeError do t() sem tabela");
  assert.equal(r.dataApp, false);
});
