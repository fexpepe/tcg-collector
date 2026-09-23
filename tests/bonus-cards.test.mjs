// Cartas BÔNUS de set (src/shared.js BONUS_CARDS/isBonusCard, espelho em
// scripts/lib/bonus-cards.mjs): listadas no set, fora do 100%. Nasceu com o
// Mew RGB da 30th Celebration (23/09/2026) — o set não pode ficar impossível
// de fechar por três cartas de US$ 20 mil com tiragem desconhecida.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared } from "./lib/shared-sandbox.mjs";
import { BONUS_CARDS, isBonusCardId } from "../scripts/lib/bonus-cards.mjs";
import { setManifestMeta } from "../scripts/lib/sync-common.mjs";

const EXPOR = "window.__test = { BONUS_CARDS, isBonusCard };";

test("a tabela do núcleo é a mesma do build", () => {
  const { __test } = loadShared(EXPOR);
  assert.deepEqual(JSON.parse(JSON.stringify(__test.BONUS_CARDS)), BONUS_CARDS);
});

test("Mew RGB é bônus em todo idioma; o resto do set não", () => {
  const { __test: t } = loadShared(EXPOR);
  for (const id of ["30th-R", "30th-G", "30th-B", "30th-R-pt", "M6a-B-ja"]) {
    assert.equal(t.isBonusCard(id), true, id);
    assert.equal(t.isBonusCard({ id }), true, id);        // aceita carta ou id
    assert.equal(isBonusCardId(id), true, id);
  }
  for (const id of ["30th-001", "30th-065", "30th-c-001", "M6a-001-ja", "M6a-DAR-ja", "sv01-R", "", null]) {
    assert.equal(t.isBonusCard(id), false, String(id));
    assert.equal(isBonusCardId(id), false, String(id));
  }
});

test("manifest: bônus contada à parte e fora do valor do set", () => {
  const cards = [{ id: "30th-001", variants: ["Normal"] }, { id: "30th-R", variants: ["Holo"] }];
  const pricing = { "30th-001": { u: 1 }, "30th-R": { u: 20000 } };
  const meta = setManifestMeta(cards, pricing);
  assert.equal(meta.bonus, 1);
  assert.equal(meta.vu, 1);
  assert.equal(setManifestMeta([cards[0]], pricing).bonus, undefined); // set sem bônus: nada muda
});
