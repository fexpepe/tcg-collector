// A régua do lint-catalog (scripts/lib/regua-catalogo.mjs). Caso real congelado
// aqui: até 22/11/2026 a trava de "catálogo ZEROU" nunca disparava — vazio
// (0 < 100) caía no atalho de amostra e catálogo ausente (readCards -> null)
// era pulado calado, com a régua dizendo que o jogo tinha milhares de cartas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { avaliaRegua, medeCatalogo, LIMITE_DE_AMOSTRA } from "../scripts/lib/regua-catalogo.mjs";

// N cartas válidas em `sets` sets, `comImagem` delas com imagem.
function catalogo(n, sets = 5, comImagem = n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `x-${i}`, name: `Carta ${i}`, set: `Set ${i % sets}`, image: i < comImagem ? "https://img/x.png" : "",
  }));
}

test("catálogo VAZIO com régua é erro (era o furo: 0 < 100 virava amostra)", () => {
  const r = avaliaRegua("lorcana", [], { cards: 3192, sets: 22, imgPct: 100 });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^lorcana: catálogo ZEROU \(régua: 3192\)$/);
  assert.equal(r.amostra, false);
});

test("catálogo NÃO LIDO (null) com régua é erro (era pulado calado)", () => {
  const r = avaliaRegua("onepiece", null, { cards: 8691, sets: 119, imgPct: 85 });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^onepiece: catálogo NÃO LIDO/);
  assert.match(r.errors[0], /8691/);
});

test("régua 0 (o JUMP, sem catálogo ainda) passa vazio e não lido", () => {
  const base = { cards: 0, sets: 0, imgPct: 0 };
  for (const cards of [[], null]) {
    const r = avaliaRegua("jump", cards, base);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
  }
});

test("jogo sem entrada na régua (novo) passa vazio e não lido", () => {
  for (const cards of [[], null]) {
    const r = avaliaRegua("jogonovo", cards, undefined);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
  }
});

test("amostra de 1 a 99 cartas não aplica a régua (Pokémon de dev: 13 cartas, régua 52.430)", () => {
  const r = avaliaRegua("pokemon", catalogo(13), { cards: 52430, sets: 434, imgPct: 79 });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.amostra, true);
  // o limite: 99 ainda é amostra, 100 já é catálogo
  assert.equal(avaliaRegua("x", catalogo(LIMITE_DE_AMOSTRA - 1), { cards: 5000, sets: 9, imgPct: 100 }).amostra, true);
  assert.equal(avaliaRegua("x", catalogo(LIMITE_DE_AMOSTRA), { cards: 5000, sets: 9, imgPct: 100 }).amostra, false);
});

test("catálogo cheio abaixo da régua segue como aviso, não erro", () => {
  const r = avaliaRegua("lorcana", catalogo(3000, 22), { cards: 3192, sets: 22, imgPct: 100 });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, ["lorcana: 3000 cartas < régua 3192 (regressão?)"]);
  assert.equal(r.amostra, false);
});

test("sets e imagem abaixo da régua são avisos; dentro da tolerância de 10 pontos, nada", () => {
  const base = { cards: 1000, sets: 20, imgPct: 100 };
  const r = avaliaRegua("g", catalogo(1000, 10, 500), base);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, ["g: 10 sets < régua 20", "g: imagens 50% (régua 100%)"]);
  const ok = avaliaRegua("g", catalogo(1000, 20, 950), base);
  assert.deepEqual(ok.warnings, []);
});

test("catálogo igual ou acima da régua passa limpo", () => {
  const r = avaliaRegua("g", catalogo(1200, 25), { cards: 1000, sets: 20, imgPct: 100 });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test("medeCatalogo: duplicados, quebradas e imagem (quebrada não entra na conta de imagem)", () => {
  const cards = [
    { id: "a", name: "A", set: "S1", image: "u" },
    { id: "a", name: "A", set: "S1", image: "u" },
    { id: "b", name: "B", set: "S2" },
    { id: "", name: "sem id", set: "S2", image: "u" },
  ];
  const m = medeCatalogo(cards);
  assert.equal(m.cards, 4);
  assert.equal(m.dupes, 1);
  assert.equal(m.broken, 1);
  assert.equal(m.sets, 2);
  assert.equal(m.imgPct, 50);   // 2 com imagem válidas / 4
});
