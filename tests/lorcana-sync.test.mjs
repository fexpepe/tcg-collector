// Testes do sync do Lorcana (scripts/sync-lorcana.mjs). Set que a Lorcast não
// entregou fica com as cartas e o preço do catálogo anterior: em 2026-11-15 os
// 14 sets principais vieram cortados, o sync gravou só os promos e o lint
// barrou o build completo de todos os jogos.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { juntaComAnterior } from "../scripts/sync-lorcana.mjs";

const carta = (id, setId) => ({ id, setId, number: id.split("-")[1] });

test("set que falhou: as cartas do catálogo anterior ficam, com o preço delas", () => {
  const prev = [carta("1-1", "1"), carta("1-2", "1"), carta("P1-1", "P1")];
  const prevPricing = { "1-1": { u: 2 }, "1-2": { u: 3, uf: 9 }, "P1-1": { u: 1 } };
  // desta vez só o P1 respondeu, com preço novo
  const r = juntaComAnterior({ cards: [carta("P1-1", "P1")], pricing: { "P1-1": { u: 1.5 } }, prev, prevPricing });
  assert.deepEqual(r.cards.map((c) => c.id).sort(), ["1-1", "1-2", "P1-1"]);
  assert.deepEqual(r.mantidas.map((c) => c.id), ["1-1", "1-2"]);
  assert.deepEqual(r.pricing["1-2"], { u: 3, uf: 9 });
  // o preço que a fonte mandou agora vence o antigo
  assert.deepEqual(r.pricing["P1-1"], { u: 1.5 });
});

test("tudo respondeu: nada a manter, nada duplicado", () => {
  const prev = [carta("1-1", "1")];
  const r = juntaComAnterior({ cards: [carta("1-1", "1"), carta("1-2", "1")], pricing: {}, prev, prevPricing: { "1-1": { u: 2 } } });
  assert.equal(r.mantidas.length, 0);
  assert.equal(r.cards.length, 2);
  // carta que veio da fonte sem preço não herda o antigo (preço some de verdade)
  assert.equal(r.pricing["1-1"], undefined);
});

test("primeiro build, sem catálogo anterior", () => {
  const r = juntaComAnterior({ cards: [carta("1-1", "1")], pricing: { "1-1": { u: 2 } }, prev: [], prevPricing: {} });
  assert.equal(r.cards.length, 1);
  assert.deepEqual(r.pricing, { "1-1": { u: 2 } });
});
