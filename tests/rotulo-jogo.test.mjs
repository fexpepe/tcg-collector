// Rótulo curto de cada jogo (shared.gameLabel): desde 2026-11-11 a chave i18n
// é DERIVADA do slug ("filter.game" + inicial maiúscula), com o mapa
// GAME_LABEL_KEY só pras exceções de nome composto. Antes, o mapa escrito por
// extenso era o que fazia o check.mjs cobrar a chave; agora é este teste: todo
// jogo do DATA_GAMES tem o rótulo nos três idiomas, e jogo fora do registro
// cai no Pokémon, como antes.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shared = readFileSync(new URL("../src/shared.js", import.meta.url), "utf8");
const i18n = readFileSync(new URL("../src/i18n.js", import.meta.url), "utf8");

function jogos() {
  const ini = shared.indexOf("const DATA_GAMES");
  return Array.from(shared.slice(ini, shared.indexOf("]", ini)).matchAll(/"([a-z0-9]+)"/g), (m) => m[1]);
}
const ini = shared.indexOf("const GAME_LABEL_KEY");
const fim = shared.indexOf("\n  }\n", shared.indexOf("function gameLabel", ini)) + 4;
const gameLabel = new Function("t", "GAME_SLUGS", `${shared.slice(ini, fim)}\nreturn gameLabel;`)((k) => k, jogos());

test("todo jogo do site tem rótulo nos três idiomas", () => {
  const lista = jogos();
  assert.ok(lista.length >= 28, `só ${lista.length} jogos lidos do shared.js`);
  for (const g of lista) {
    const chave = gameLabel(g);
    const n = i18n.split(`"${chave}":`).length - 1;
    assert.equal(n, 3, `${g}: a chave ${chave} aparece ${n} vez(es) no src/i18n.js (pt, en e es)`);
  }
});

test("a chave sai do slug; as compostas vêm do mapa; jogo fora do registro cai no Pokémon", () => {
  assert.equal(gameLabel("lorcana"), "filter.gameLorcana");
  assert.equal(gameLabel("narutocg"), "filter.gameNarutocg");
  assert.equal(gameLabel("narutoboruto"), "filter.gameNarutoboruto");
  assert.equal(gameLabel("narutomythos"), "filter.gameNarutomythos");
  assert.equal(gameLabel("narutokayou"), "filter.gameNarutokayou");
  assert.equal(gameLabel("palworld"), "filter.gamePalworld");
  assert.equal(gameLabel("onepiece"), "filter.gameOnePiece");
  assert.equal(gameLabel("harrypotter"), "filter.gameHarryPotter");
  assert.equal(gameLabel("hub"), "filter.gamePokemon");
  assert.equal(gameLabel("toString"), "filter.gamePokemon");
  assert.equal(gameLabel(undefined), "filter.gamePokemon");
});
