// Testes do sync do Dragon Ball Super Card Game Masters (scripts/sync-dbs.mjs),
// sem rede: o setId pela abreviação do TCGplayer (e o BT26 repetido), o id
// pelo productId, o preço Normal/Foil e a regra da carta-irmã (o carimbo que
// separa a Pre-Release, a Release Event e a 2nd Edition do set de origem).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { setIdOf, cardOf, SET_FIXO, REGRAS_DBS } from "../scripts/sync-dbs.mjs";
import { irmasComFoto } from "../scripts/lib/imagem-da-irma.mjs";

test("setId: a abreviação do TCGplayer, como vem", () => {
  assert.equal(setIdOf({ groupId: 24900, abbreviation: "BT31" }), "BT31");
  assert.equal(setIdOf({ groupId: 24901, abbreviation: "BT31_PR" }), "BT31_PR");
  assert.equal(setIdOf({ groupId: 2266, abbreviation: "DBS-B01" }), "DBS-B01");
  assert.equal(setIdOf({ groupId: 2800, abbreviation: "DBS-B10-RE" }), "DBS-B10-RE");
  assert.equal(setIdOf({ groupId: 2801, abbreviation: "DBS-B12PRE" }), "DBS-B12PRE");
  // Cabe num nome de arquivo e num pedaço de URL.
  for (const a of ["BT31_PR", "DBS-B10-RE", "EB-01", "csv1"]) assert.match(setIdOf({ groupId: 1, abbreviation: a }), /^[A-Z0-9_-]+$/);
});

test("setId: o BT26 das Pre-Release fica fixo, e código repetido não colide", () => {
  assert.equal(setIdOf({ groupId: 23647, abbreviation: "BT26" }), "BT26_PR");
  assert.deepEqual(Object.keys(SET_FIXO), ["23647"]);
  assert.equal(setIdOf({ groupId: 99001, abbreviation: "" }), "G99001");
  assert.equal(setIdOf({ groupId: 99002, abbreviation: "BT26" }, new Set(["BT26"])), "BT26-99002");
});

const GRUPO = { groupId: 24900, name: "Impact Beyond Dimensions", publishedOn: "2026-07-03T00:00:00" };
const PRODUTO = {
  productId: 700001,
  name: "Son Goku & Vegeta // SS Gogeta, Situation Reversal Fusion",
  extendedData: [
    { name: "Number", value: "BT31-001" },
    { name: "Rarity", value: "Uncommon" },
    { name: "CardType", value: "Leader" },
    { name: "Color", value: "Red;Blue" },
    { name: "EnergyColor Cost", value: "" },
    { name: "Power", value: "10000" }
  ]
};

test("carta: id pelo productId, campos do produto e o set sem o jogo na frente", () => {
  const { card } = cardOf(PRODUTO, GRUPO, "BT31", 190);
  assert.equal(card.id, "dbs-700001");
  assert.equal(card.number, "BT31-001");
  assert.equal(card.set, "Impact Beyond Dimensions");
  assert.equal(card.setId, "BT31");
  assert.equal(card.setTotal, 190);
  assert.equal(card.setReleaseDate, "2026-07-03");
  assert.equal(card.rarity, "Uncommon");
  assert.equal(card.cardType, "Leader");
  assert.equal(card.color, "Red;Blue");
  assert.equal(card.cost, null);
  assert.equal(card.power, "10000");
  assert.equal(card.language, "en");
  assert.equal(card.image, "https://tcgplayer-cdn.tcgplayer.com/product/700001_in_1000x1000.jpg");
  const { card: c2 } = cardOf(PRODUTO, { ...GRUPO, name: "Dragon Ball Super: Promo Cards" }, "X", 1);
  assert.equal(c2.set, "Promo Cards");
});

test("carta: Normal e Foil viram u e uf; só Foil vira u e uf", () => {
  const ambos = cardOf(PRODUTO, GRUPO, "BT31", 1, new Map([["Normal", 0.25], ["Foil", 1.5]]));
  assert.deepEqual(ambos.price, { u: 0.25, uf: 1.5 });
  assert.deepEqual(ambos.card.variants, ["Normal", "Foil"]);
  const soFoil = cardOf(PRODUTO, GRUPO, "BT31", 1, new Map([["Foil", 9]]));
  assert.deepEqual(soFoil.price, { u: 9, uf: 9 });
  assert.deepEqual(soFoil.card.variants, ["Foil"]);
  // Sem preço: fica sem preço, e o acabamento listado sem preço ainda conta.
  const semPreco = cardOf(PRODUTO, GRUPO, "BT31", 1, new Map(), new Set(["Foil"]));
  assert.equal(semPreco.price, null);
  assert.deepEqual(semPreco.card.variants, ["Foil"]);
  assert.deepEqual(cardOf(PRODUTO, GRUPO, "BT31", 1).card.variants, ["Normal"]);
});

test("carta-irmã: a carta com selo pega a foto da do set de origem, e só dele", () => {
  // Nomes reais dos grupos (TCGCSV, 14/11/2026).
  for (const g of ["Fearsome Rivals Release Event", "Ultimate Advent Pre-Release Cards", "Rise of the Unison Warrior (2nd Edition)", "History of Z Pre-Release Cards"]) {
    assert.match(g, REGRAS_DBS.carimbo, g);
  }
  assert.doesNotMatch("Fearsome Rivals", REGRAS_DBS.carimbo);
  const prods = [
    { productId: 1, groupId: 10, grupo: "Fearsome Rivals", name: "Krillin // Krillin, Grown-up Support", number: "BT29-001", imageCount: 1 },
    { productId: 2, groupId: 11, grupo: "Fearsome Rivals Release Event", name: "Krillin // Krillin, Grown-up Support", number: "BT29-001", imageCount: 0 },
    { productId: 3, groupId: 12, grupo: "Rise of the Unison Warrior", name: "Fused Zamasu, Divine Ruinbringer", number: "BT10-032", imageCount: 1 },
    { productId: 4, groupId: 13, grupo: "Rise of the Unison Warrior (2nd Edition)", name: "Fused Zamasu, Divine Ruinbringer", number: "BT10-032", imageCount: 0 },
    // Promo de torneio com o mesmo número: arte própria, fica sem foto.
    { productId: 5, groupId: 14, grupo: "Tournament Promotion Cards", name: "Krillin // Krillin, Grown-up Support", number: "BT29-001", imageCount: 0 },
    // Versão com qualificador de arte não pega a base.
    { productId: 6, groupId: 11, grupo: "Fearsome Rivals Release Event", name: "Krillin // Krillin, Grown-up Support (Alternate Art)", number: "BT29-001", imageCount: 0 }
  ];
  const irmas = irmasComFoto(prods, REGRAS_DBS);
  assert.equal(irmas.get(2), 1);
  assert.equal(irmas.get(4), 3);
  assert.equal(irmas.has(5), false);
  assert.equal(irmas.has(6), false);
});
