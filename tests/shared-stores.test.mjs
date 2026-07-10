// Testes das stores e helpers de valor do src/shared.js, via sandbox de vm
// (tests/lib/shared-sandbox.mjs). Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

function fresh() {
  const ls = makeLocalStorage();
  const sb = loadShared(
    "window.__test = { createCollectionStore, createWishlistStore, sumCardsValue, basePricingId };",
    { localStorage: ls }
  );
  // Os writes são debounced (scheduleWrite): flush materializa no localStorage.
  return { ls, api: sb.window.__test, flush: sb.__flushTimers };
}

test("collection store: add soma, remove limpa e carimba meta (LWW)", () => {
  const { ls, api, flush } = fresh();
  const st = api.createCollectionStore("pokemon");
  st.add("base1-4", "Holo", "NM", 2);
  assert.equal(st.variantTotal("base1-4", "Holo"), 2);
  assert.equal(st.has("base1-4"), true);

  st.add("base1-4", "Holo", "NM", -2);
  assert.equal(st.has("base1-4"), false);

  // meta: carta removida ganha tombstone (del) — é o que faz a exclusão
  // propagar no sync em vez de "ressuscitar" no merge.
  flush();
  const meta = JSON.parse(ls._dump()["tcg-collector-pokemon-collection-meta-v1"] || "{}");
  assert.ok(meta.del && meta.del["base1-4"] > 0, "tombstone gravado");
});

test("collection store: toggleVariant liga 1 NM e desliga a variante inteira", () => {
  const { api } = fresh();
  const st = api.createCollectionStore("pokemon");
  st.toggleVariant("x-1", "Normal");
  assert.equal(st.getQuantity("x-1", "Normal", "NM"), 1);
  st.add("x-1", "Normal", "PL", 3);
  st.toggleVariant("x-1", "Normal");
  assert.equal(st.variantTotal("x-1", "Normal"), 0, "desliga TODAS as condições");
});

test("wishlist store: toggle liga/desliga e persiste por jogo", () => {
  const { ls, api, flush } = fresh();
  const wl = api.createWishlistStore("onepiece");
  assert.equal(wl.toggle("op-1", "Normal"), true);
  assert.equal(wl.has("op-1", "Normal"), true);
  assert.equal(wl.toggle("op-1", "Normal"), false);
  assert.equal(wl.hasCard("op-1"), false);
  flush();
  assert.ok("tcg-collector-onepiece-wishlist-v1" in ls._dump(), "chave por jogo");
});

test("sumCardsValue: soma variante padrão e conta as sem preço (piso ≥)", () => {
  const { api } = fresh();
  // Sem tabela de preços carregada, tudo é "sem preço" — o contrato do unpriced.
  const r = api.sumCardsValue([{ id: "a-1", variants: ["Normal"] }, { id: "a-2" }], null);
  assert.equal(r.value, 0);
  assert.equal(r.unpriced, 2);
});

test("basePricingId: tira só sufixo de idioma localizado", () => {
  const { api } = fresh();
  assert.equal(api.basePricingId("sv03.5-198-pt"), "sv03.5-198");
  assert.equal(api.basePricingId("MBG-003-ja"), "MBG-003");
  assert.equal(api.basePricingId("cel25-5"), "cel25-5");
  assert.equal(api.basePricingId("op-544523"), "op-544523");
});
