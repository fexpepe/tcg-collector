// "Tenho essa carta em outra língua" (progresso de set EN↔PT, 2026-09-29):
// a chave que liga a mesma carta entre línguas, o índice da coleção e a
// preferência que vem ligada. Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

function fresh(seed) {
  const ls = makeLocalStorage(seed);
  const sb = loadShared(
    "window.__test = { createCollectionStore, sameCardKey, ownedSameCardIndex, otherLanguageOwned, getAnyLangProgress, setAnyLangProgress };",
    { localStorage: ls }
  );
  return { ls, api: sb.window.__test };
}

test("sameCardKey: EN e PT são a mesma carta; JA e chinês também", () => {
  const { api } = fresh();
  assert.equal(api.sameCardKey("sv03.5-001"), api.sameCardKey("sv03.5-001-pt"));
  assert.equal(api.sameCardKey("SV1S-001-ja"), api.sameCardKey("SV1S-001-zh-tw"));
  assert.equal(api.sameCardKey("SV1S-001-ja"), api.sameCardKey("SV1S-001-zh-cn"));
});

test("sameCardKey: neo1 EN e neo1 JA NÃO se juntam (mesmo setId, coleções diferentes)", () => {
  const { api } = fresh();
  assert.notEqual(api.sameCardKey("neo1-1"), api.sameCardKey("neo1-1-ja"));
  assert.notEqual(api.sameCardKey("sv03.5-001-pt"), api.sameCardKey("sv03.5-001-ja"));
});

test("otherLanguageOwned: acha a língua da outra cópia, respeitando a versão", () => {
  const { api } = fresh();
  const st = api.createCollectionStore("pokemon");
  st.add("sv03.5-001", "Reverse Holo", "NM", 1);
  const idx = api.ownedSameCardIndex(st);
  // Qualquer versão: a Reverse em EN cobre a carta em PT.
  assert.equal(api.otherLanguageOwned(idx, st, "sv03.5-001-pt", null), "en");
  // Master set: a Reverse em EN não cobre a Normal em PT.
  assert.equal(api.otherLanguageOwned(idx, st, "sv03.5-001-pt", ["Normal"]), "");
  assert.equal(api.otherLanguageOwned(idx, st, "sv03.5-001-pt", ["Reverse Holo"]), "en");
  // A própria cópia não é "outra língua".
  assert.equal(api.otherLanguageOwned(idx, st, "sv03.5-001", null), "");
  // Carta que você não tem em língua nenhuma.
  assert.equal(api.otherLanguageOwned(idx, st, "sv03.5-002-pt", null), "");
});

test("getAnyLangProgress: vem ligado; desligar grava e vale", () => {
  const { api } = fresh();
  assert.equal(api.getAnyLangProgress(), true);
  api.setAnyLangProgress(false);
  assert.equal(api.getAnyLangProgress(), false);
  api.setAnyLangProgress(true);
  assert.equal(api.getAnyLangProgress(), true);
});
