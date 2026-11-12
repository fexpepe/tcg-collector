// Foto da carta-irmã quando o TCGplayer não tem a da própria carta
// (scripts/lib/imagem-da-irma.mjs, 2026-11-12). Os produtos abaixo são os da
// TCGCSV (cat. 89, Riftbound) como estavam no dia, com o imageCount de lá.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { irmasComFoto, nomeBase, numeroBase, qualificadores, temLetraDeVariante, qualificadoresDeArte, setSemCarimbo, fotosDasIrmas, REGRAS_BANDAI } from "../scripts/lib/imagem-da-irma.mjs";

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

// Regras por jogo (2026-11-12). Produtos da TCGCSV como estavam no dia; quando
// a carta tinha foto, o imageCount 0 é fingido pra montar o caso.
const g = (groupId, grupo) => ({ groupId, grupo });
const q = (productId, grp, name, number, imageCount) => ({ productId, ...grp, name, number, imageCount });

test("Yu-Gi-Oh: a (Version N) só pega a mesma versão", () => {
  const LCKC = g(2195, "Legendary Collection Kaiba"), R2020 = g(24506, "Legendary Collection Kaiba (2020 Date Reprint)");
  const regras = { arte: /\bart\b|^version\b|^[a-z]$|arkana/i };
  const produtos = [
    q(161927, LCKC, "Blue-Eyes White Dragon (Version 1)", "LCKC-EN001", 1),
    q(162088, LCKC, "Blue-Eyes White Dragon (Version 3)", "LCKC-EN001", 1),
    q(658908, R2020, "Blue-Eyes White Dragon (Version 2)", "LCKC-EN001", 0),
    q(658909, R2020, "Blue-Eyes White Dragon (Version 3)", "LCKC-EN001", 0)
  ];
  assert.deepEqual([...irmasComFoto(produtos, regras)], [[658909, 162088]], "a Version 2 sem irmã da mesma versão fica sem foto");
  assert.equal(irmasComFoto(produtos).get(658908), 161927, "sem a regra, pegaria a Version 1 (outra arte)");
});

test("Weiß: a (Alternate Art) não pega a comum", () => {
  const SAO = g(1608, "Sword Art Online II");
  const irmas = irmasComFoto([
    q(200173, SAO, "Winning Combination, Sinon & Kirito", "SAO/SE23-PE03 PR", 1),
    q(200174, SAO, "Winning Combination, Sinon & Kirito (Alternate Art)", "SAO/SE23-PE03 PR", 0)
  ], { arte: /\bart\b|^[a-z]$/i });
  assert.equal(irmas.size, 0);
});

test("Bandai: a Release Event pega a carta do mesmo set, e só ela", () => {
  const OP16 = g(24664, "The Time of Battle"), OP16RE = g(24677, "The Time of Battle Release Event Cards");
  const irmas = irmasComFoto([
    q(695988, OP16, "Curiel", "OP16-004", 1),
    q(696713, OP16RE, "Curiel", "OP16-004", 0)
  ], REGRAS_BANDAI);
  assert.equal(irmas.get(696713), 695988);
  assert.equal(setSemCarimbo("Carrying On His Will: 3rd Anniversary Tournament Cards", REGRAS_BANDAI.carimbo), "carrying on his will");
});

test("Bandai: mesmo número em outro set ou com qualificador não é a mesma arte", () => {
  const OP01 = g(3188, "Romance Dawn"), ST31 = g(24749, "ST-31: Starter Deck 31 RED Monkey.D.Luffy");
  const ST01 = g(3189, "ST-01: Starter Deck 1 Straw Hat Crew"), ST01PRE = g(17659, "ST-01: Starter Deck 1 Straw Hat Crew (Super Pre-Release Edition)");
  const FB06 = g(24247, "Rivals Clash"), SB02 = g(24288, "Manga Booster 02"), FB11 = g(24716, "Brightness of Hope");
  const produtos = [
    q(454534, OP01, "Nami", "OP01-016", 1),
    q(706310, ST31, "Nami", "OP01-016", 0),
    q(288228, ST01, "Monkey.D.Luffy (001)", "ST01-001", 1),
    q(412113, ST01PRE, "Monkey.D.Luffy (001)", "ST01-001", 0),
    q(635474, FB06, "World King", "FB06-096", 1),
    q(657507, SB02, "World King", "FB06-096", 0),
    q(713339, FB11, "Son Gohan : Future - FB11-032 (Alternate Art)", "FB11-032", 1),
    q(709978, FB11, "Son Gohan : Future - FB11-032", "FB11-032", 0)
  ];
  assert.equal(irmasComFoto(produtos).size, 4, "a regra do Riftbound casaria os quatro");
  assert.equal(irmasComFoto(produtos, REGRAS_BANDAI).size, 0, "deck inicial com arte nova, líder do Super Pre-Release, Manga Booster e alt-art: nenhum vale");
  assert.equal(qualificadoresDeArte("Saint Gunko (060) (Alternate Art)", REGRAS_BANDAI), "alternate art", "o (060) é código");
  assert.equal(qualificadoresDeArte("Carta (AP1*)", REGRAS_BANDAI), "ap1*", "com estrela é a paralela do Union Arena");
});

test("fotosDasIrmas troca a imagem da carta, menos a que já tem foto no CDN", async () => {
  const irmas = fotosDasIrmas();
  const grupo = { groupId: RAD, name: "Radiance" };
  const ekko = { image: "x/724600" }, assinada = { image: "x/724638" }, jarvan = { image: "x/724641" };
  irmas.anota({ productId: 724600, name: "Ekko, Boy Who Shattered Time (Overnumbered)", imageCount: 1 }, grupo, "168/167", ekko);
  irmas.anota({ productId: 724638, name: "Ekko, Boy Who Shattered Time (Signature)", imageCount: 0 }, grupo, "168*/167", assinada);
  irmas.anota({ productId: 724699, name: "Jarvan IV (Overnumbered)", imageCount: 1 }, grupo, "179/167", { image: "x/724699" });
  irmas.anota({ productId: 724641, name: "Jarvan IV (Signature)", imageCount: 0 }, grupo, "179*/167", jarvan);
  // o imageCount atrasou: a do Jarvan já está no CDN
  const consultadas = [];
  const r = await irmas.aplica((id) => `x/${id}`, { temFoto: async (url) => { consultadas.push(url); return url === "x/724641"; } });
  assert.equal(assinada.image, "x/724600");
  assert.equal(ekko.image, "x/724600");
  assert.equal(jarvan.image, "x/724641", "foto própria no CDN vence a da irmã");
  assert.deepEqual(consultadas.sort(), ["x/724638", "x/724641"], "só consulta quem a regra trocaria");
  assert.deepEqual([r.semFoto, r.comIrma, r.jaTinha], [2, 1, 1]);
  assert.match(r.resumo, /1 com a foto da irmã \(1 já tinham a própria no CDN\)/);
});

test("carta sem número só pega irmã do mesmo set (Palworld)", () => {
  const BP01 = g(24346, "Booster Pack 01"), PC = g(24345, "Prototype Cards");
  const irmas = irmasComFoto([
    q(1, PC, "Soul", "", 1),
    q(2, BP01, "Soul (SSS)", "", 0),
    q(3, BP01, "Soul (SSS) (2nd Edition)", "", 0),
    q(4, BP01, "Soul (SSS)", "", 1)
  ]);
  assert.equal(irmas.get(3), 4, "a 2ª edição pega a 1ª do mesmo set");
  assert.equal(irmas.get(2), 4);
  assert.equal(irmasComFoto([q(1, PC, "Soul", "", 1), q(2, BP01, "Soul (SSS)", "", 0)]).size, 0, "o Soul das Prototype Cards é outra arte");
});
