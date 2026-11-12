// Foto da carta-irmã quando o TCGplayer não tem a da própria carta
// (scripts/lib/imagem-da-irma.mjs, 2026-11-12). Os produtos abaixo são os da
// TCGCSV (cat. 89, Riftbound) como estavam no dia, com o imageCount de lá.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { irmasComFoto, nomeBase, numeroBase, qualificadores, temLetraDeVariante } from "../scripts/lib/imagem-da-irma.mjs";

const T1 = 24861, RAD = 24819, VEN = 24698, SFD = 24519, OGN = 24344, OPP = 24528;
const p = (productId, groupId, name, number, imageCount) => ({ productId, groupId, name, number, imageCount });

test("nome, qualificadores e número da carta", () => {
  assert.equal(nomeBase("Galio, Indefatigable (T1 Worlds Champion Signature Edition Bundle) (Serial Numbered)"), "Galio, Indefatigable");
  assert.deepEqual(qualificadores("Azir, Emperor of the Sands (Metal) (Prize Wall)"), ["metal", "prize wall"]);
  assert.deepEqual(qualificadores("Mech // Recruit"), []);
  assert.equal(numeroBase("168*/167"), "168/167");
  assert.equal(temLetraDeVariante("R03a"), true);
  assert.equal(temLetraDeVariante("007a/298"), true);
  assert.equal(temLetraDeVariante("T1S 003/005"), false, "o S do código do produto não é letra de variante");
  assert.equal(temLetraDeVariante("168*/167"), false);
  assert.equal(temLetraDeVariante("R01"), false);
});

test("Serial Numbered do T1 pega a foto da Signature Edition do mesmo número", () => {
  const irmas = irmasComFoto([
    p(716020, T1, "Galio, Indefatigable (T1 Worlds Champion Player Bundle)", "T1A 003/005", 1),
    p(716021, T1, "Galio, Indefatigable (T1 Worlds Champion Signature Edition Bundle)", "T1S 003/005", 1),
    p(716022, T1, "Galio, Indefatigable (T1 Worlds Champion Signature Edition Bundle) (Serial Numbered)", "T1S 003/005", 0)
  ]);
  assert.deepEqual([...irmas], [[716022, 716021]], "a Player Bundle tem outro número (T1A), não é irmã");
});

test("Signature (número com *) pega a Overnumbered do mesmo número", () => {
  const irmas = irmasComFoto([
    p(724600, RAD, "Ekko, Boy Who Shattered Time (Overnumbered)", "168/167", 1),
    p(724638, RAD, "Ekko, Boy Who Shattered Time (Signature)", "168*/167", 0)
  ]);
  assert.equal(irmas.get(724638), 724600);
});

test("promo de evento pega a carta do set de origem, a mais parecida primeiro", () => {
  const irmas = irmasComFoto([
    p(653055, OGN, "Lee Sin, Blind Monk", "257/298", 1),
    p(669256, OPP, "Lee Sin, Blind Monk (Metal) (Best Of)", "257/298", 1),
    p(662892, OPP, "Lee Sin, Blind Monk", "257/298", 0),
    p(689171, OPP, "Lee Sin, Blind Monk (Metal) (Prize Wall)", "257/298", 0)
  ]);
  assert.equal(irmas.get(662892), 653055, "a promo comum pega a carta comum do Origins, não a Metal");
  assert.equal(irmas.get(689171), 669256, "a Metal pega a Metal; no empate, a do mesmo set");
});

test("arte alternativa (número com letra) só pega irmã do MESMO set", () => {
  const irmas = irmasComFoto([
    p(722316, RAD, "Mind Rune (R03a)", "R03a", 1),
    p(709313, VEN, "Mind Rune (R03a)", "R03a", 0),
    p(722878, RAD, "Fury Rune", "R01", 1),
    p(678183, SFD, "Fury Rune", "R01", 0)
  ]);
  assert.equal(irmas.has(709313), false, "a R03a do Vendetta não é a do Radiance");
  assert.equal(irmas.get(678183), 722878, "a runa comum é a mesma arte em todo set");
});

test("sem irmã, sem imageCount ou com foto própria: nada muda", () => {
  const irmas = irmasComFoto([
    p(709917, VEN, "Mech // Recruit", "T03 // T04", 0),
    p(724641, RAD, "Jarvan IV, Exemplar of Demacia (Signature)", "179*/167", 0),
    p(724664, RAD, "Aphelios, Exalted (Heartsteel Overnumbered)", "179/167", 1),
    { productId: 1, groupId: VEN, name: "Carta (Foil)", number: "001/166" },
    p(2, VEN, "Carta", "001/166", 1)
  ]);
  assert.equal(irmas.size, 0, "nome diferente no mesmo número não é irmã; imageCount ausente conta como foto");
});
