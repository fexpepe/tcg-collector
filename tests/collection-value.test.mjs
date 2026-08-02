// collectionNetWorth / collectionValueLines / cardVariants (src/shared.js):
// a conta de "quanto vale a sua coleção". Ela é UMA porque três telas mostram
// esse número — Coleção, Portfólio e Hub — e antes cada uma tinha a sua.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

const EXPOSE = "window.__test = { collectionValueLines, collectionNetWorth, cardVariants, createCollectionStore, createPriceStore };";

// Preço manual em BRL (a moeda padrão), pra não depender de câmbio nem da
// tabela de referência: o que importa aqui é a ARITMÉTICA da soma.
function monta(colecao, precos) {
  const sb = loadShared(EXPOSE, { localStorage: makeLocalStorage({
    "tcg-collector-pokemon-collection-v3": JSON.stringify(colecao),
    "tcg-collector-pokemon-prices-v1": JSON.stringify(precos)
  }) });
  const api = sb.window.__test;
  return { api, owned: api.createCollectionStore(), prices: api.createPriceStore() };
}

const preco = (valor) => ({ Normal: { prices: { NM: valor }, source: "manual", updatedAt: "" } });

test("soma variante × condição × quantidade", () => {
  const { api, owned, prices } = monta(
    { "a-1": { Normal: { NM: 2, SP: 1 } } },
    { "a-1": { Normal: { prices: { NM: 10, SP: 6 }, source: "manual", updatedAt: "" } } }
  );
  const cards = [{ id: "a-1", variants: ["Normal"], game: "pokemon" }];
  const r = api.collectionValueLines(cards, owned, prices, {});
  assert.equal(r.total, 26);        // 2×10 + 1×6
  assert.equal(r.totalCopies, 3);
  assert.equal(r.pricedCopies, 3);
});

// O bug que fazia a Coleção mostrar MENOS que o Portfólio.
test("carta com variants: [] entra pela variante padrão (não some da conta)", () => {
  const { api, owned, prices } = monta({ "pop6-1": { Normal: { NM: 1 } } }, { "pop6-1": preco(40) });
  const cards = [{ id: "pop6-1", variants: [], game: "pokemon" }];
  // Array.from: array do sandbox (outro realm do vm) falha no deepStrictEqual.
  assert.deepEqual(Array.from(api.cardVariants(cards[0])), ["Normal"]);
  assert.equal(api.collectionValueLines(cards, owned, prices, {}).total, 40);
  // `card.variants || [...]` devolveria [] aqui — array vazio é truthy —, que
  // era exatamente como a Coleção somava.
  assert.equal((cards[0].variants || ["Normal"]).length, 0);
});

test("carta sem o campo variants também cai na padrão", () => {
  const { api, owned, prices } = monta({ "b-1": { Normal: { NM: 1 } } }, { "b-1": preco(15) });
  assert.equal(api.collectionValueLines([{ id: "b-1", game: "pokemon" }], owned, prices, {}).total, 15);
});

test("carta repetida na lista não conta duas vezes", () => {
  const { api, owned, prices } = monta({ "c-1": { Normal: { NM: 1 } } }, { "c-1": preco(30) });
  const card = { id: "c-1", variants: ["Normal"], game: "pokemon" };
  assert.equal(api.collectionValueLines([card, card], owned, prices, {}).total, 30);
});

test("filtro de jogo corta o que não é do jogo", () => {
  const { api, owned, prices } = monta(
    { "p-1": { Normal: { NM: 1 } }, "l-1": { Normal: { NM: 1 } } },
    { "p-1": preco(10), "l-1": preco(100) }
  );
  const cards = [{ id: "p-1", variants: ["Normal"], game: "pokemon" }, { id: "l-1", variants: ["Normal"], game: "lorcana" }];
  assert.equal(api.collectionValueLines(cards, owned, prices, {}).total, 110);
  assert.equal(api.collectionValueLines(cards, owned, prices, { gameFilter: "all" }).total, 110);
  assert.equal(api.collectionValueLines(cards, owned, prices, { gameFilter: "pokemon" }).total, 10);
});

test("carta sem preço conta cópia mas não valor (é o piso da tela)", () => {
  const { api, owned, prices } = monta({ "d-1": { Normal: { NM: 3 } } }, {});
  const r = api.collectionValueLines([{ id: "d-1", variants: ["Normal"], game: "pokemon" }], owned, prices, {});
  assert.equal(r.total, 0);
  assert.equal(r.totalCopies, 3);
  assert.equal(r.pricedCopies, 0);
});

test("patrimônio = cartas soltas + graded, e sem coleção dá zero", () => {
  const { api, owned, prices } = monta({ "e-1": { Normal: { NM: 2 } } }, { "e-1": preco(25) });
  const cards = [{ id: "e-1", variants: ["Normal"], game: "pokemon" }];
  const n = api.collectionNetWorth(cards, owned, prices, { gameOf: () => "pokemon" });
  assert.equal(n.raw, 50);
  assert.equal(n.graded, 0);        // nenhum slab guardado neste sandbox
  assert.equal(n.total, n.raw + n.graded);

  const vazio = monta({}, {});
  assert.equal(vazio.api.collectionNetWorth([], vazio.owned, vazio.prices, {}).total, 0);
});
