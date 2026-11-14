// Testes do sync do hololive OFFICIAL CARD GAME (scripts/sync-hololive.mjs),
// sem rede: o setId que vira o código oficial apesar da grafia solta da
// TCGCSV, o id pelo productId (número e raridade repetem) e o mapeamento de
// campo do produto.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { setIdOf, cardOf, SET_FIXO } from "../scripts/sync-hololive.mjs";

test("setId: o código oficial, qualquer que seja a grafia da abreviação", () => {
  // As quatro grafias que a fonte usa pros boosters (13/11/2026).
  assert.equal(setIdOf({ groupId: 24345, abbreviation: "BP01E" }), "HBP01");
  assert.equal(setIdOf({ groupId: 24469, abbreviation: "HBP03E" }), "HBP03");
  assert.equal(setIdOf({ groupId: 24796, abbreviation: "hBP07e" }), "HBP07");
  assert.equal(setIdOf({ groupId: 24710, abbreviation: "HEB01" }), "HEB01");
  // Start Deck: com dois e com três dígitos.
  assert.equal(setIdOf({ groupId: 24347, abbreviation: "SD01E" }), "HSD01");
  assert.equal(setIdOf({ groupId: 24643, abbreviation: "SD012E" }), "HSD12");
  assert.equal(setIdOf({ groupId: 24760, abbreviation: "SD19E" }), "HSD19");
  // Cabe num nome de arquivo e num pedaço de URL.
  for (const a of ["BP01E", "hBP08e", "SD012E", "HEB01"]) assert.match(setIdOf({ groupId: 1, abbreviation: a }), /^[A-Z0-9]+$/);
});

test("setId: os dois grupos sem código na abreviação ficam fixos", () => {
  assert.equal(setIdOf({ groupId: 24346, abbreviation: "S01E" }), "HYS01");
  assert.equal(setIdOf({ groupId: 24398, abbreviation: "hOCGP" }), "HPR");
  assert.deepEqual(Object.keys(SET_FIXO), ["24346", "24398"]);
});

test("setId: sem abreviação cai no groupId, e código repetido não colide", () => {
  assert.equal(setIdOf({ groupId: 99001, abbreviation: "" }), "G99001");
  assert.equal(setIdOf({ groupId: 99002, abbreviation: "Bloom Cup" }), "BLOOMCUP");
  assert.equal(setIdOf({ groupId: 99003, abbreviation: "HBP01E" }, new Set(["HBP01"])), "HBP01-99003");
});

const GRUPO = { groupId: 24345, name: "Blooming Radiance", publishedOn: "2025-07-11T00:00:00" };
const PRODUTO = {
  productId: 640001,
  name: "Tokino Sora (RR)",
  extendedData: [
    { name: "Rarity", value: "Double Rare" }, { name: "Number", value: "hBP01-014" },
    { name: "Color", value: "White" }, { name: "CardType", value: "holomem" },
    { name: "BloomLevel", value: "2nd" }, { name: "HP", value: "190" },
    { name: "Tags", value: "#JP;#Gen0;#Song" }
  ]
};

test("carta: id do productId, campos do jogo e imagem grande do CDN", () => {
  const { card, price } = cardOf(PRODUTO, GRUPO, "HBP01", 248, new Map([["Foil", 3.5]]), new Set(["Foil"]));
  assert.equal(card.id, "holo-640001");
  assert.equal(card.name, "Tokino Sora (RR)");
  assert.equal(card.set, "Blooming Radiance");
  assert.equal(card.setId, "HBP01");
  assert.equal(card.number, "hBP01-014");
  assert.equal(card.setTotal, 248);
  assert.equal(card.setReleaseDate, "2025-07-11");
  assert.equal(card.rarity, "Double Rare");
  assert.equal(card.language, "en");
  assert.equal(card.image, "https://tcgplayer-cdn.tcgplayer.com/product/640001_in_1000x1000.jpg");
  assert.deepEqual(card.variants, ["Foil"]);
  assert.equal(card.cardType, "holomem");
  assert.equal(card.color, "White");
  assert.equal(card.bloom, "2nd");
  assert.equal(card.hp, "190");
  assert.equal(card.tags, "#JP;#Gen0;#Song");
  assert.deepEqual(price, { u: 3.5, uf: 3.5 }); // só foil: o preço base é o do foil
});

test("carta: a reimpressão divide número e raridade com a original e é outra carta", () => {
  const original = { productId: 1, name: "Vestia Zeta (C)", extendedData: [{ name: "Number", value: "hBP01-024" }, { name: "Rarity", value: "Common" }] };
  const reimpressa = { productId: 2, name: "Vestia Zeta (C)", extendedData: [{ name: "Number", value: "hBP01-024" }, { name: "Rarity", value: "Common" }] };
  const a = cardOf(original, GRUPO, "HBP01", 248, new Map([["Normal", 0.2]]), new Set(["Normal"]));
  const b = cardOf(reimpressa, { groupId: 24796, name: "Diva Fever", publishedOn: "2026-11-20T00:00:00" }, "HBP07", 246);
  assert.notEqual(a.card.id, b.card.id);
  assert.equal(a.card.number, b.card.number);
  assert.equal(b.card.setId, "HBP07");          // o set é o do produto, não o do prefixo do número
  assert.deepEqual(a.price, { u: 0.2 });
  assert.equal(b.price, null);
  assert.deepEqual(b.card.variants, ["Normal"]); // sem acabamento listado
  assert.equal(b.card.cardType, null);
});

test("carta: o Spot da fonte vem minúsculo, e o grupo de promos perde o nome do jogo", () => {
  const p = { productId: 3, name: "Friend A", extendedData: [{ name: "Number", value: "hPR-001" }, { name: "BloomLevel", value: "spot" }] };
  const { card } = cardOf(p, { groupId: 24398, name: "hololive OFFICIAL CARD GAME Promos", publishedOn: "2025-07-31T00:00:00" }, "HPR", 162);
  assert.equal(card.bloom, "Spot");
  assert.equal(card.set, "Promos");
});
