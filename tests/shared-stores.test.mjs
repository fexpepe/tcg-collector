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

// Pokédex "já tenho": store de dexIds (global) com carimbo pra LWW no sync.
function freshDex() {
  const ls = makeLocalStorage();
  const sb = loadShared("window.__test = { createDexOwnedStore, mergeData };", { localStorage: ls });
  return { ls, api: sb.window.__test, flush: sb.__flushTimers };
}

test("dex owned store: toggle liga/desliga, persiste na chave global e carimba o meta", () => {
  const { ls, api, flush } = freshDex();
  const dex = api.createDexOwnedStore();
  dex.toggle("25");
  assert.equal(dex.has("25"), true);
  dex.toggle("1");
  dex.toggle("25");
  assert.equal(dex.has("25"), false);
  assert.equal(dex.size, 1);
  flush();
  const dump = ls._dump();
  assert.deepEqual(JSON.parse(dump["tcg-collector-dex-owned-v1"]), ["1"], "chave global, sem jogo no nome");
  assert.ok(JSON.parse(dump["tcg-collector-dex-owned-meta-v1"]).updatedAt > 0, "meta carimbado pro LWW");
});

test("dex owned no sync: LWW pelo meta (desmarcar propaga) e união no empate", () => {
  const { api } = freshDex();
  const T1 = 1000, T2 = 2000;
  // Remoto desmarcou o 25 depois do local marcar: o remoto vence inteiro.
  let m = api.mergeData({ dexOwned: ["1", "25"], dexOwnedMeta: { updatedAt: T1 } }, { dexOwned: ["1"], dexOwnedMeta: { updatedAt: T2 } });
  assert.deepEqual(JSON.parse(JSON.stringify(m.dexOwned)), ["1"]);
  assert.equal(m.dexOwnedMeta.updatedAt, T2);
  // Sem carimbo dos dois lados (dados antigos): união, nada se perde.
  m = api.mergeData({ dexOwned: ["1"] }, { dexOwned: ["4"] });
  assert.deepEqual(JSON.parse(JSON.stringify(m.dexOwned)).sort(), ["1", "4"]);
  // Ausente nos dois: fica fora do blob (sem diff eterno no push).
  m = api.mergeData({}, {});
  assert.equal(m.dexOwned, undefined);
});

// Pokédex automática: carta de Pokémon que PASSA A EXISTIR na coleção marca o
// dexId dela na checklist (opção ligada); carta que só muda de quantidade, não.
test("dex auto-mark: adicionar carta de Pokémon marca o dexId (só com a opção ligada)", async () => {
  const ls = makeLocalStorage({ "tcg-dex-automark": "on" });
  const sb = loadShared("window.__test = { createCollectionStore, createDexOwnedStore, dexAutoMarkEnabled, setDexAutoMark };", { localStorage: ls });
  sb.window.TCG_INDEXES = { pokedex: [{ dexId: 6, name: "Charizard", cardIds: ["base1-4"] }, { dexId: 25, name: "Pikachu", cardIds: ["base1-58"] }] };
  const api = sb.window.__test;
  assert.equal(api.dexAutoMarkEnabled(), true);
  const col = api.createCollectionStore("pokemon");
  const dex = api.createDexOwnedStore();
  col.add("base1-4", "Holo", "NM", 1);
  await new Promise((r) => setImmediate(r)); // o índice resolve numa microtask
  assert.equal(dex.has("6"), true, "Charizard entrou na Pokédex");
  assert.equal(dex.has("25"), false);
  // Só +1 numa carta que já existia: nada muda (e nada desmarca ao remover).
  col.add("base1-4", "Holo", "NM", 1);
  col.add("base1-4", "Holo", "NM", -2);
  await new Promise((r) => setImmediate(r));
  assert.equal(col.has("base1-4"), false);
  assert.equal(dex.has("6"), true, "a marca fica mesmo com a carta fora");
  // Opção desligada: adicionar não marca.
  api.setDexAutoMark(false);
  col.toggleVariant("base1-58", "Normal");
  await new Promise((r) => setImmediate(r));
  assert.equal(dex.has("25"), false);
  // Outro jogo nunca mexe na Pokédex.
  api.setDexAutoMark(true);
  api.createCollectionStore("lorcana").add("base1-58", "Normal", "NM", 1);
  await new Promise((r) => setImmediate(r));
  assert.equal(dex.has("25"), false);
});

test("dex progress: cache válido volta, inválido vira null", () => {
  const ls = makeLocalStorage();
  const sb = loadShared("window.__test = { readDexProgress, writeDexProgress };", { localStorage: ls });
  const api = sb.window.__test;
  assert.equal(api.readDexProgress(), null);
  api.writeDexProgress({ c: 3, t: 1025, gen: { "1": { c: 3, t: 151 } } });
  const p = api.readDexProgress();
  assert.equal(p.c, 3); assert.equal(p.t, 1025); assert.equal(p.gen["1"].c, 3); assert.ok(p.ts > 0);
  ls.setItem("tcg-pokedex-progress-v1", JSON.stringify({ c: "x" }));
  assert.equal(api.readDexProgress(), null);
});
