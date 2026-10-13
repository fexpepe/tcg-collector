// Índices de /artists e /decks (functions/_lib/indices.js, 2026-10-13): as
// páginas /artist/<slug> e /deck/<slug> não tinham link interno nenhum (o app
// abre o artista em /detail?type=artist, noindex, e o deck em /decks?s=). O
// que se trava aqui: os links certos, slug fora da régua fora, nome escapado,
// mapa vazio ou ausente = sem índice, e o CSS que segura o índice até a tela
// ter conteúdo (senão ele pula pra baixo quando a grade enche).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { indiceDeArtistas, indiceDeDecks } from "../functions/_lib/indices.js";

test("índice de artistas: link pra /artist/<slug>, com o nº de cartas", () => {
  const html = indiceDeArtistas([["ken-sugimori", "Ken Sugimori", 412], ["mitsuhiro-arita", "Mitsuhiro Arita", 0]]);
  assert.match(html, /<a href="\/artist\/ken-sugimori">Ken Sugimori<\/a> <small>412 cartas<\/small>/);
  assert.match(html, /<a href="\/artist\/mitsuhiro-arita">Mitsuhiro Arita<\/a><\/li>/, "sem contagem, sem <small>");
  assert.match(html, /Ver a lista \(2\)/);
  assert.match(html, /html\[data-game\] #cardGrid:empty~\.indice-paginas,html\[data-game\] #cardGrid:has\(\.skel\)~\.indice-paginas\{display:none\}/);
});

test("índice de decks: link pra /deck/<slug>, com o jogo", () => {
  const html = indiceDeDecks([["mickey-aggro-lorcana-45bc387a", "Mickey Aggro", "Lorcana"]]);
  assert.match(html, /<a href="\/deck\/mickey-aggro-lorcana-45bc387a">Mickey Aggro<\/a> <small>Lorcana<\/small>/);
  assert.match(html, /#deckCommunity:not\(:has\(> :not\(noscript\)\)\)~\.indice-paginas/);
});

test("slug fora da régua sai, nome sai escapado, mapa vazio não vira índice", () => {
  const html = indiceDeArtistas([["../x", "A", 1], ["ok", "<img src=x onerror=alert(1)>", 1], "lixo", null]);
  assert.doesNotMatch(html, /\.\.\/x|<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /Ver a lista \(1\)/);
  for (const vazio of [null, undefined, [], {}, [["../x", "A"]]]) {
    assert.equal(indiceDeArtistas(vazio), "");
    assert.equal(indiceDeDecks(vazio), "");
  }
});
