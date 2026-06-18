// Teste unitário do merge de sync com timestamps por carta (LWW + tombstone).
// Carrega o src/shared.js num sandbox com stubs e captura as funções internas
// mergeData/mergeCollection/mergeWishlist injetando uma linha de captura — sem
// alterar o arquivo de produção. Roda com: node scripts/test-sync-merge.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
let src = readFileSync(join(here, "..", "src", "shared.js"), "utf8");
// Expõe os internos do closure logo antes do export público.
src = src.replace(
  "window.TCGShared = {",
  "window.__test = { mergeData, mergeCollection, mergeWishlist }; window.TCGShared = {"
);

const store = {};
const localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
const noop = () => {};
const elStub = new Proxy({}, { get: () => noop });
const documentStub = {
  querySelector: () => null, querySelectorAll: () => [],
  getElementById: () => null, createElement: () => elStub,
  addEventListener: noop, documentElement: { lang: "", setAttribute: noop },
  body: elStub, head: elStub
};
const windowStub = {};
const sandbox = {
  window: windowStub, document: documentStub, localStorage,
  navigator: { language: "pt-BR" }, location: { pathname: "/", search: "", hash: "", origin: "http://x" },
  history: { replaceState: noop }, fetch: () => Promise.reject(new Error("no net")),
  setInterval: noop, setTimeout: noop, clearTimeout: noop, console,
  addEventListener: noop, removeEventListener: noop, matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
  TCG_MESSAGES: { pt: {}, en: {} }, IntersectionObserver: function () { return { observe: noop, disconnect: noop }; },
  indexedDB: { open: () => ({}) }
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const { mergeData } = sandbox.window.__test;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const NOW = Date.now();
const T1 = NOW - 3000, T2 = NOW - 2000, T3 = NOW - 1000;

// 1) Exclusão propaga: A apagou a carta (del>mod), B ainda tem (sem ts/legado).
{
  const local = { collection: {}, collectionMeta: { mod: {}, del: { "x-1": T2 } } };
  const remote = { collection: { "x-1": { normal: { NM: 1 } } }, collectionMeta: { mod: {}, del: {} } };
  const m = mergeData(local, remote);
  check("exclusao propaga sobre carta legada (sem mod-ts)", !m.collection["x-1"] && m.collectionMeta.del["x-1"] === T2);
}

// 2) Edição mais nova revive: del em T1, mas a outra ponta editou em T3 > T1.
{
  const local = { collection: {}, collectionMeta: { mod: {}, del: { "x-1": T1 } } };
  const remote = { collection: { "x-1": { normal: { NM: 2 } } }, collectionMeta: { mod: { "x-1": T3 }, del: {} } };
  const m = mergeData(local, remote);
  check("edicao (mod>del) revive a carta", !!m.collection["x-1"] && m.collection["x-1"].normal.NM === 2);
}

// 3) Sem deleções: união normal, quantidade pelo máximo.
{
  const local = { collection: { "x-1": { normal: { NM: 1 } } }, collectionMeta: { mod: { "x-1": T1 }, del: {} } };
  const remote = { collection: { "x-1": { normal: { NM: 3 }, holo: { NM: 1 } } }, collectionMeta: { mod: { "x-1": T2 }, del: {} } };
  const m = mergeData(local, remote);
  check("uniao mantem maior qty e une variantes", m.collection["x-1"].normal.NM === 3 && m.collection["x-1"].holo.NM === 1);
}

// 4) Carta nova só num lado (com mod) sobrevive.
{
  const local = { collection: { "y-9": { normal: { NM: 1 } } }, collectionMeta: { mod: { "y-9": T2 }, del: {} } };
  const remote = { collection: {}, collectionMeta: { mod: {}, del: {} } };
  const m = mergeData(local, remote);
  check("carta adicionada num lado aparece", !!m.collection["y-9"]);
}

// 5) Dados legados sem nenhuma meta: nada é apagado (compat retro).
{
  const local = { collection: { "a-1": { normal: { NM: 1 } } } };
  const remote = { collection: { "b-2": { normal: { NM: 1 } } } };
  const m = mergeData(local, remote);
  check("sem meta nenhuma: une e nao apaga (compat)", !!m.collection["a-1"] && !!m.collection["b-2"]);
}

// 6) Tombstone antigo (>1 ano) é podado.
{
  const old = Date.now() - 400 * 24 * 60 * 60 * 1000;
  const local = { collection: {}, collectionMeta: { mod: {}, del: { "z-1": old } } };
  const remote = { collection: {}, collectionMeta: { mod: {}, del: {} } };
  const m = mergeData(local, remote);
  check("tombstone com mais de 1 ano e podado", !("z-1" in m.collectionMeta.del));
}

// 7) Wishlist: exclusão propaga.
{
  const local = { wishlist: {}, wishlistMeta: { mod: {}, del: { "w-1": T2 } } };
  const remote = { wishlist: { "w-1": ["normal"] }, wishlistMeta: { mod: {}, del: {} } };
  const m = mergeData(local, remote);
  check("wishlist: exclusao propaga", !m.wishlist["w-1"]);
}

// 8) Wishlist: união de variantes desejadas quando ambas vivas.
{
  const local = { wishlist: { "w-2": ["normal"] }, wishlistMeta: { mod: { "w-2": T1 }, del: {} } };
  const remote = { wishlist: { "w-2": ["holo"] }, wishlistMeta: { mod: { "w-2": T2 }, del: {} } };
  const m = mergeData(local, remote);
  check("wishlist: une variantes desejadas", m.wishlist["w-2"].sort().join(",") === "holo,normal");
}

console.log(`\n  ${pass} passou, ${fail} falhou`);
process.exit(fail ? 1 : 0);
