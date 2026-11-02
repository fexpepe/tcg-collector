// Raridade e versões do Naruto CCG americano (scripts/sync-naruto-ccg.mjs),
// sem rede. A fonte (narutocards.ca) usa siglas próprias que o próprio site
// marca como não verificadas; a tradução foi conferida set a set contra o
// ccgtrader em 2026-11-01. E as regras de vitrine que dependem disso: a
// escada genérica de raridade (shared.rarityRank) e o filtro da página de set
// (detail.js), que até então escondia a raridade dos vintage.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RARIDADE, raridadeEVersoes } from "../scripts/sync-naruto-ccg.mjs";

const ler = (arq) => readFileSync(new URL(`../${arq}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("siglas da fonte viram os nomes do jogo: UR/SR/MR são a Super Rare, F é Starter Deck", () => {
  assert.equal(raridadeEVersoes("s01", "C").rarity, "Common");
  assert.equal(raridadeEVersoes("s01", "U").rarity, "Uncommon");
  assert.equal(raridadeEVersoes("s01", "R").rarity, "Rare");
  for (const sigla of ["SR", "UR", "MR"]) assert.equal(raridadeEVersoes("s05", sigla).rarity, "Super Rare", sigla);
  assert.equal(raridadeEVersoes("s01", "F").rarity, "Starter Deck");
  assert.equal(raridadeEVersoes("promo", "PR").rarity, "Promo");
  assert.equal(raridadeEVersoes("s29", "UNKNOWN").rarity, "");
});

test("sigla nova da fonte passa crua (aparece no filtro) em vez de sumir", () => {
  assert.equal(raridadeEVersoes("s10", "XR").rarity, "XR");
  assert.ok(!Object.prototype.hasOwnProperty.call(RARIDADE, "XR"));
});

test("foil paralelo (Diamond/Wavy) só em Common/Uncommon/Rare de booster, com a Normal primeiro", () => {
  for (const sigla of ["C", "U", "R"]) {
    assert.deepEqual(raridadeEVersoes("s12", sigla).variants, ["Normal", "Diamond Foil", "Wavy Foil"], sigla);
  }
  // Super Rare já é dourada; starter e promo não saem em booster.
  for (const sigla of ["SR", "UR", "MR", "F", "PR"]) {
    assert.deepEqual(raridadeEVersoes("s12", sigla).variants, ["Normal"], sigla);
  }
  // Tournament Pack, tin e a série de promos não são booster.
  for (const set of ["tp1", "tin2", "promo"]) {
    assert.deepEqual(raridadeEVersoes(set, "C").variants, ["Normal"], set);
  }
});

test("cada carta ganha a PRÓPRIA lista de versões (sem array compartilhado entre cartas)", () => {
  const a = raridadeEVersoes("s01", "C").variants;
  const b = raridadeEVersoes("s01", "C").variants;
  assert.notEqual(a, b);
});

test("rarityRank: Super Rare acima de Rare; Normal/N no nível do comum; Starter logo acima", () => {
  const src = ler("src/shared.js");
  const corpo = src.match(/const RARITY_SIGLA = \{[\s\S]*?\n  function rarityRank\(rarity\) \{[\s\S]*?\n  \}\n/)[0];
  const rarityRank = new Function(`${corpo}; return rarityRank;`)();
  assert.ok(rarityRank("Super Rare") > rarityRank("Rare"));
  assert.equal(rarityRank("Normal"), rarityRank("Common"));
  assert.equal(rarityRank("N"), rarityRank("Common"));
  assert.ok(rarityRank("Starter Deck") > rarityRank("Common") && rarityRank("Starter Deck") < rarityRank("Uncommon"));
  // Vintage: estrelas do One Piece 2002 em escada; Gold Stamp acima da Holo;
  // siglas do Miracle Battle no lugar certo.
  assert.ok(rarityRank("☆") < rarityRank("☆☆") && rarityRank("☆☆") < rarityRank("☆☆☆"));
  assert.ok(rarityRank("Gold Stamp") > rarityRank("Holo"));
  assert.ok(rarityRank("U") > rarityRank("C") && rarityRank("超Ω") > rarityRank("Ω") && rarityRank("Ω") > rarityRank("SR"));
  // As que já valiam não mudam.
  assert.equal(rarityRank("C"), 10);
  assert.equal(rarityRank("Super_rare"), 50);
  assert.equal(rarityRank("Rare Holo"), 40);
});

test("página de set: a raridade real é o padrão; os dois baldes ficam só no Pokémon", () => {
  const src = ler("src/detail.js");
  assert.match(src, /const RARITY_BUCKET_GAMES = new Set\(\["pokemon"\]\);/);
  // Jogo sem escada própria também lista (escada vazia), em vez de cair nos baldes.
  assert.match(src, /RARITY_BUCKET_GAMES\.has\(jogoDaPagina\) \? null : \(RARITY_LISTED_GAMES\[jogoDaPagina\] \|\| \[\]\)/);
});
