// Duas formas de perder carta em silêncio, ambas pela mesma causa: o store
// guarda o blob em MEMÓRIA e save() grava a cópia inteira por cima da chave.
//   1. Duas INSTÂNCIAS na mesma aba (a paleta Ctrl+K criava a sua) — resolvido
//      com cache de instância por chave.
//   2. Duas ABAS — resolvido remesclando disco+memória (registerCrossTabStore).
// Roda com: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

const EXPOSE = "window.__test = { createCollectionStore, createWishlistStore, createCostsStore, createSoldStore, createWishTargetsStore, rehydrateCrossTab };";
const COL_KEY = "tcg-collector-pokemon-collection-v3";
const COL_META = "tcg-collector-pokemon-collection-meta-v1";
const WISH_KEY = "tcg-collector-pokemon-wishlist-v1";

function sandbox(seed = {}) {
  const ls = makeLocalStorage(seed);
  const sb = loadShared(EXPOSE, { localStorage: ls });
  return { sb, ls, api: sb.window.__test };
}

test("wishlist: pedir o store duas vezes devolve a MESMA instância", () => {
  const { api } = sandbox();
  assert.equal(api.createWishlistStore("pokemon"), api.createWishlistStore("pokemon"));
  assert.notEqual(api.createWishlistStore("pokemon"), api.createWishlistStore("lorcana"));
});

test("wishlist: o que uma referência marca, a outra enxerga (era o bug do Ctrl+K)", () => {
  const { sb, ls, api } = sandbox();
  const daPagina = api.createWishlistStore("pokemon");
  const daPaleta = api.createWishlistStore("pokemon"); // o que o Ctrl+K fazia
  daPaleta.toggle("a-1", "Normal");
  daPagina.toggle("b-2", "Normal");
  sb.__flushTimers();
  const disco = JSON.parse(ls.getItem(WISH_KEY));
  assert.ok(disco["a-1"], "a carta marcada pela paleta sobreviveu");
  assert.ok(disco["b-2"], "a carta marcada pela página sobreviveu");
});

test("stores globais (custos/vendas/preço-alvo) também são instância única", () => {
  const { api } = sandbox();
  assert.equal(api.createCostsStore(), api.createCostsStore());
  assert.equal(api.createSoldStore(), api.createSoldStore());
  assert.equal(api.createWishTargetsStore(), api.createWishTargetsStore());
});

test("custo digitado no popup sobrevive à gravação da página de Vendas", () => {
  const { api } = sandbox();
  const doPopup = api.createCostsStore();
  const daPagina = api.createCostsStore();
  doPopup.set("a-1", "Normal", 10, "BRL");
  daPagina.set("b-2", "Normal", 20, "BRL");
  assert.equal(daPagina.get("a-1", "Normal").v, 10);
  assert.equal(doPopup.get("b-2", "Normal").v, 20);
});

test("coleção: a carta que a OUTRA aba adicionou não é apagada pelo próximo save", () => {
  const { sb, ls, api } = sandbox();
  const store = api.createCollectionStore("pokemon");
  store.add("a-1", "Normal", "NM", 1);
  sb.__flushTimers();

  // Outra aba grava a própria versão do blob (tem a dela + a nossa).
  ls.setItem(COL_KEY, JSON.stringify({ "a-1": { Normal: { NM: 1 } }, "b-2": { Normal: { NM: 1 } } }));
  ls.setItem(COL_META, JSON.stringify({ mod: { "b-2": Date.now() }, del: {} }));
  api.rehydrateCrossTab(COL_KEY); // é o que o evento `storage` dispara

  assert.equal(store.has("b-2"), true, "a memória absorveu a carta da outra aba");

  store.add("c-3", "Normal", "NM", 1);
  sb.__flushTimers();
  const disco = JSON.parse(ls.getItem(COL_KEY));
  assert.ok(disco["a-1"], "a carta desta aba continua");
  assert.ok(disco["b-2"], "a carta da outra aba NÃO foi apagada");
  assert.ok(disco["c-3"], "a carta nova entrou");
});

test("remescla não ressuscita carta apagada na outra aba (tombstone vence)", () => {
  const { sb, ls, api } = sandbox({
    [COL_KEY]: JSON.stringify({ "a-1": { Normal: { NM: 1 } } }),
    [COL_META]: JSON.stringify({ mod: { "a-1": 1000 }, del: {} })
  });
  const store = api.createCollectionStore("pokemon");
  assert.equal(store.has("a-1"), true);

  // Outra aba removeu a carta (blob sem ela + tombstone mais novo).
  ls.setItem(COL_KEY, JSON.stringify({}));
  ls.setItem(COL_META, JSON.stringify({ mod: {}, del: { "a-1": 2000 } }));
  api.rehydrateCrossTab(COL_KEY);
  sb.__flushTimers();

  assert.equal(store.has("a-1"), false, "a remoção da outra aba prevaleceu");
});
