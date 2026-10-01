// Testes do sync do Sorcery: Contested Realm (scripts/sync-sorcery.mjs), sem
// rede: o par Normal+Foil que o TCGplayer cadastra como dois produtos, o id
// pegajoso entre os dois, o setId fixo por groupId e o mapeamento de campo.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { setIdOf, ABREV_FIXA, baseName, isCard, pairProducts, cardOf } from "../scripts/sync-sorcery.mjs";

const prod = (productId, name, ext = {}) => ({
  productId, name,
  extendedData: Object.entries(ext).map(([name, value]) => ({ name, value }))
});
const GRUPO = { groupId: 23336, name: "Beta", publishedOn: "2023-11-10T00:00:00" };
const RAIDER = { Rarity: "Exceptional", CardType: "Minion", CardCategory: "Spell", Element: "Water", Cost: "3", Threshold: "WW" };

test("setId: pin por groupId com os códigos da editora, acima da abreviação da fonte", () => {
  assert.equal(setIdOf({ groupId: 23335, abbreviation: "A" }), "ALP");
  assert.equal(setIdOf({ groupId: 23336, abbreviation: "B" }), "BET");
  assert.equal(setIdOf({ groupId: 24871, abbreviation: "" }), "WKP");
  assert.equal(setIdOf({ groupId: 9, abbreviation: "" }), "G9");
  const ids = Object.values(ABREV_FIXA);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[A-Z0-9-]+$/);
});

test("nome base: tira o (Foil) e o (Corrected), e só eles", () => {
  assert.equal(baseName("Sea Raider (Foil)"), "Sea Raider");
  assert.equal(baseName("Blink (Foil) (Corrected)"), "Blink");
  assert.equal(baseName("Blink (Foil) (Misprint)"), "Blink (Misprint)");
  assert.equal(baseName("Sorcerer (Foil) (Box Topper)"), "Sorcerer (Box Topper)");
  assert.equal(baseName("Abundance (Preconstructed Deck)"), "Abundance (Preconstructed Deck)");
});

test("carta x selado: booster e caixa vêm sem campo nenhum; o token só com a categoria", () => {
  assert.equal(isCard(prod(1, "Beta - Booster Box")), false);
  assert.equal(isCard(prod(2, "Stealth (Box Topper)", { CardCategory: "Token" })), true);
  assert.equal(isCard(prod(3, "Sea Raider", RAIDER)), true);
});

test("par: Normal e Foil do mesmo nome viram uma carta; o misprint fica à parte", () => {
  const pares = pairProducts([
    prod(10, "Sea Raider", RAIDER), prod(11, "Sea Raider (Foil)", RAIDER),
    prod(20, "Blink", RAIDER), prod(21, "Blink (Foil) (Misprint)", RAIDER), prod(22, "Blink (Foil) (Corrected)", RAIDER),
    prod(30, "Sorcerer (Foil) (Box Topper)", RAIDER)
  ]);
  const ver = pares.map((p) => [p.n && p.n.productId, p.f && p.f.productId]);
  assert.deepEqual(ver, [[10, 11], [20, 22], [null, 21], [null, 30]]);
});

test("par: dois produtos do mesmo lado no mesmo nome não se apagam", () => {
  const pares = pairProducts([prod(1, "X", RAIDER), prod(2, "X", RAIDER)]);
  assert.equal(pares.length, 2);
});

test("carta: id do Normal, preço do Normal em u e do Foil em uf, campos do jogo", () => {
  const [par] = pairProducts([prod(522747, "Sea Raider", RAIDER), prod(522748, "Sea Raider (Foil)", RAIDER)]);
  const precos = new Map([[522747, new Map([["Normal", 0.18]])], [522748, new Map([["Foil", 9.13]])]]);
  const { card, price } = cardOf(par, GRUPO, "BET", 413, precos);
  assert.equal(card.id, "sor-522747");
  assert.equal(card.name, "Sea Raider");
  assert.equal(card.setId, "BET");
  assert.equal(card.number, "");
  assert.equal(card.setReleaseDate, "2023-11-10");
  assert.equal(card.image, "https://tcgplayer-cdn.tcgplayer.com/product/522747_in_1000x1000.jpg");
  assert.deepEqual(card.variants, ["Normal", "Foil"]);
  assert.equal(card.rarity, "Exceptional");
  assert.equal(card.cardType, "Minion");
  assert.equal(card.color, "Water");
  assert.equal(card.cost, 3);
  assert.deepEqual(price, { u: 0.18, uf: 9.13 });
});

test("carta: id pegajoso — o Normal cadastrado depois não troca o id já publicado", () => {
  const [par] = pairProducts([prod(700, "Promo X", RAIDER), prod(650, "Promo X (Foil)", RAIDER)]);
  assert.equal(cardOf(par, GRUPO, "DRP", 1).card.id, "sor-700");
  assert.equal(cardOf(par, GRUPO, "DRP", 1, new Map(), new Set(["sor-650"])).card.id, "sor-650");
});

test("carta: só-foil tem o preço do foil nos dois slots e a versão Foil", () => {
  const [par] = pairProducts([prod(30, "Sorcerer (Foil) (Box Topper)", { Rarity: "Elite", CardType: "Avatar" })]);
  const { card, price } = cardOf(par, GRUPO, "BET", 1, new Map([[30, new Map([["Foil", 0.37]])]]));
  assert.equal(card.id, "sor-30");
  assert.deepEqual(card.variants, ["Foil"]);
  assert.deepEqual(price, { u: 0.37, uf: 0.37 });
});

test("carta: raridade None vira vazia; tipo cai na categoria só quando ela diz algo", () => {
  const avatar = cardOf(pairProducts([prod(1, "Necromancer", { Rarity: "None", CardCategory: "Avatar" })])[0], GRUPO, "GOT", 1).card;
  assert.equal(avatar.rarity, "");
  assert.equal(avatar.cardType, "Avatar");
  const semTipo = cardOf(pairProducts([prod(2, "Wall of Ice", { Rarity: "Ordinary", CardCategory: "Spell", Cost: "X" })])[0], GRUPO, "BET", 1).card;
  assert.equal(semTipo.cardType, null);
  assert.equal(semTipo.cost, null); // "X" não é custo numérico
});

test("carta: campo vazio no Normal vem do Foil do mesmo par", () => {
  const [par] = pairProducts([
    prod(1, "Bone Rabble (Store Alternate Art Promo)", { Rarity: "Promo", CardCategory: "Spell" }),
    prod(2, "Bone Rabble (Store Alternate Art Promo) (Foil)", { Rarity: "Promo", CardType: "Minion", Element: "Earth" })
  ]);
  const { card } = cardOf(par, GRUPO, "BET", 1);
  assert.equal(card.cardType, "Minion");
  assert.equal(card.color, "Earth");
});
