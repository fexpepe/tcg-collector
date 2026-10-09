// "Todas as cartas" responde a busca pela borda (2026-10-08).
//
// Tocar no campo de busca baixava o jogo INTEIRO (Pokémon: 1.506 pedidos e
// 5,4 MB, medido em produção, sem digitar nada) e a 1ª busca também. Agora o
// texto digitado vai pra /api/search completa (full=1), o filtro de set sem
// texto baixa só os chunks daquele set, e o catálogo inteiro só desce quando
// nada disso responde (raridade/preço sem texto nem set, borda fora, busca com
// mais de 10 mil cartas). Conferido contra produção trocando só o cards.js:
// boot 3 pedidos de dado (antes 71), foco na busca 0 (antes 296), "pikachu"
// 1 pedido à borda e 1.008 resultados (antes 468 pedidos de chunk).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const cards = readFileSync(join(raiz, "src/cards.js"), "utf8");

test("focar a busca não baixa o catálogo: só raridade e preço adiantam", () => {
  assert.ok(cards.includes("[elements.rarityFilter, elements.priceMin, elements.priceMax].forEach((element) => {"));
  assert.ok(!/\[elements\.search, elements\.setFilter/.test(cards), "o foco da busca voltou a disparar o catálogo inteiro");
});

test("a busca digitada vai pela borda completa e o set sem texto só pelos chunks dele", () => {
  assert.ok(cards.includes("shared.searchApiFull(game, q)"));
  assert.ok(cards.includes("shared.fetchSetChunks(doSet)"));
  assert.ok(!cards.includes("shared.searchApi(game, q, 60)"), "voltou a ponte de 60 cartas");
});

test("as mais vistas e o ?card= vêm pela borda, não pelos chunks dos sets", () => {
  assert.ok(!cards.includes("loadCatalogForCardIds("), "o intro voltou a baixar os chunks inteiros dos sets das mais vistas");
  assert.ok(cards.includes("shared.loadOwnedFast({ [game]: top.map((row) => row.card_id) })"));
  assert.ok(cards.includes("shared.loadOwnedFast({ [game]: [id] })"));
});
