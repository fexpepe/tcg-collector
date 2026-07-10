// Carrega o src/shared.js num sandbox de Node (vm) com stubs de navegador, pra
// testar a lógica interna sem browser. `expose` é um trecho injetado logo antes
// do export público — use pra capturar funções do closure em window.__test.
// Ex.: loadShared("window.__test = { mergeData, createCollectionStore };")
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));

export function makeLocalStorage(seed = {}) {
  const store = { ...seed };
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    _dump: () => ({ ...store })
  };
}

export function loadShared(expose, { localStorage } = {}) {
  let src = readFileSync(join(here, "..", "..", "src", "shared.js"), "utf8");
  src = src.replace("window.TCGShared = {", `${expose || ""}\nwindow.TCGShared = {`);

  const noop = () => {};
  // Elemento fake: qualquer propriedade lida vira função-noop; atribuições são
  // aceitas. dataset/classList/style são objetos reais (código de produção seta
  // document.documentElement.dataset.gameAccent etc.).
  const makeEl = () => new Proxy(
    { dataset: {}, style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false } },
    { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } }
  );
  const documentStub = {
    querySelector: () => null, querySelectorAll: () => [],
    getElementById: () => null, createElement: makeEl,
    addEventListener: noop, removeEventListener: noop,
    documentElement: makeEl(), body: makeEl(), head: makeEl(), title: ""
  };
  const sandbox = {
    document: documentStub,
    localStorage: localStorage || makeLocalStorage(),
    navigator: { language: "pt-BR", serviceWorker: undefined, onLine: true },
    location: { pathname: "/", search: "", hash: "", origin: "http://x", hostname: "localhost", href: "http://x/" },
    history: { replaceState: noop },
    // fetch "offline": resolve com !ok (os caminhos de produção tratam), em vez
    // de rejeitar — rejeição de boot viraria unhandledRejection e o node:test
    // marca o ARQUIVO como falho mesmo com todos os testes passando.
    fetch: () => Promise.resolve({ ok: false, status: 599, json: async () => null, text: async () => "" }),
    setInterval: noop, clearTimeout: noop, clearInterval: noop,
    console, URL, URLSearchParams, Blob: class {}, CustomEvent: class {},
    addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    TCG_MESSAGES: { pt: {}, en: {} },
    IntersectionObserver: function () { return { observe: noop, disconnect: noop }; },
    indexedDB: { open: () => ({}) }
  };
  // setTimeout vira uma FILA: o shared.js debouncia os writes de localStorage
  // (scheduleWrite); os testes chamam sandbox.__flushTimers() pra materializar.
  const timers = [];
  sandbox.setTimeout = (fn) => { if (typeof fn === "function") timers.push(fn); return timers.length; };
  sandbox.__flushTimers = () => { while (timers.length) timers.shift()(); };

  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox;
}
