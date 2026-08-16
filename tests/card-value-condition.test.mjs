// cardValue (src/shared.js): o preço de REFERÊNCIA de mercado descreve uma
// cópia NM — cópia em condição pior vale uma fração dela. Antes o multiplicador
// só valia pro preço manual, então um HP entrava no patrimônio valendo o mesmo
// que um NM (e a nota do Portfólio prometia justamente o contrário).
// Roda com: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

const EXPOSE = "window.__test = { cardValue, collectionValueLines, createCollectionStore, createPriceStore };";

// Usa o preço BR (ref.b.md, já em BRL) de propósito: BRL→BRL dispensa a tabela
// de câmbio, então o teste mede só o efeito da condição.
function monta(colecao = {}, pricing = {}) {
  const sb = loadShared(EXPOSE, { localStorage: makeLocalStorage({
    "tcg-collector-pokemon-collection-v3": JSON.stringify(colecao)
  }) });
  sb.window.TCG_PRICING = pricing;
  const api = sb.window.__test;
  return { api, owned: api.createCollectionStore(), prices: api.createPriceStore() };
}

const CARD = { id: "a-1", variants: ["Normal"], game: "pokemon" };
const REF = { "a-1": { b: { md: 100 } } };

test("referência de mercado: NM vale cheio", () => {
  const { api, prices } = monta({}, REF);
  assert.equal(api.cardValue(CARD, "Normal", prices, "NM").value, 100);
});

test("referência de mercado: condição pior desconta (mesma tabela do manual)", () => {
  const { api, prices } = monta({}, REF);
  assert.equal(api.cardValue(CARD, "Normal", prices, "SP").value, 85);
  assert.equal(api.cardValue(CARD, "Normal", prices, "MP").value, 70);
  assert.equal(api.cardValue(CARD, "Normal", prices, "HP").value, 50);
  assert.equal(api.cardValue(CARD, "Normal", prices, "D").value, 30);
});

test("referência continua marcada como estimada", () => {
  const { api, prices } = monta({}, REF);
  const r = api.cardValue(CARD, "Normal", prices, "HP");
  assert.equal(r.estimated, true);
  assert.equal(r.source, "myp");
});

test("sem condição, segue valendo o NM cheio (nada muda pra quem chama sem condição)", () => {
  const { api, prices } = monta({}, REF);
  assert.equal(api.cardValue(CARD, "Normal", prices).value, 100);
});

test("patrimônio: 1 NM + 1 HP = 1,5× o preço de referência, não 2×", () => {
  const { api, owned, prices } = monta({ "a-1": { Normal: { NM: 1, HP: 1 } } }, REF);
  const r = api.collectionValueLines([CARD], owned, prices, {});
  assert.equal(r.total, 150);
  assert.equal(r.totalCopies, 2);
});
