// Testes do sync do World of Warcraft TCG (scripts/sync-wow.mjs), sem rede: o
// setId, o nome e a data fixos por groupId (a TCGCSV deixou a abreviação vazia
// e a data nula ou errada em vários grupos), o que conta como carta e o
// mapeamento de campo do produto. Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { setIdOf, setNameOf, releaseOf, isCard, cardOf, ABREV_FIXA, NOME_FIXO, DATA_FIXA } from "../scripts/sync-wow.mjs";

test("setId: pin por groupId vale mais que a abreviação da fonte", () => {
  assert.equal(setIdOf({ groupId: 1082, abbreviation: "" }), "HOA");
  // A fonte tem abreviação em 3 grupos; o pin manda (setId publicado não muda).
  assert.equal(setIdOf({ groupId: 1334, abbreviation: "WOWLC" }), "LOOT");
  assert.equal(setIdOf({ groupId: 1923, abbreviation: "TWK" }), "TWK");
  // Grupo novo sem pin: groupId (e o sync avisa no log).
  assert.equal(setIdOf({ groupId: 9999, abbreviation: "X" }), "G9999");
});

test("setId: os pins são únicos e cabem num nome de arquivo", () => {
  const ids = Object.values(ABREV_FIXA);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[A-Z0-9-]+$/);
  // Nome e data fixos só de grupo que tem pin (senão o set some da lista).
  for (const g of Object.keys(NOME_FIXO).concat(Object.keys(DATA_FIXA))) assert.ok(ABREV_FIXA[g], `grupo ${g} sem setId fixo`);
});

test("nome e data: o fixo cobre a sigla de estoque e a data nula ou errada", () => {
  assert.equal(setNameOf({ groupId: 1070, name: "CRP" }), "Crafting Cards");
  assert.equal(setNameOf({ groupId: 1071, name: "Dark Portal" }), "Through the Dark Portal");
  assert.equal(setNameOf({ groupId: 1082, name: "Heroes of Azeroth" }), "Heroes of Azeroth");
  assert.equal(releaseOf({ groupId: 1082, publishedOn: "2006-10-25T00:00:00" }), "2006-10-25");
  assert.equal(releaseOf({ groupId: 1334, publishedOn: "2017-12-01T00:00:00" }), "2006-10-25");
  assert.equal(releaseOf({ groupId: 1096, publishedOn: null }), "2007-01-16");
  for (const d of Object.values(DATA_FIXA)) assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
});

test("carta = produto com Rarity; selado fica de fora", () => {
  assert.equal(isCard({ extendedData: [{ name: "Rarity", value: "E" }] }), true);
  assert.equal(isCard({ name: "Booster Box", extendedData: [{ name: "UPC", value: "815442010537" }] }), false);
  assert.equal(isCard({ name: "Booster Pack" }), false);
});

const GRUPO = { groupId: 1082, name: "Heroes of Azeroth", publishedOn: "2006-10-25T00:00:00" };

test("carta: id do productId, sem número, raridade por extenso e imagem do CDN", () => {
  const p = { productId: 16485, name: "Leeroy Jenkins", extendedData: [{ name: "Rarity", value: "E" }] };
  const { card, price } = cardOf(p, GRUPO, 361, new Map([["Normal", 24.5], ["Foil", 80]]));
  assert.equal(card.id, "wow-16485");
  assert.equal(card.setId, "HOA");
  assert.equal(card.set, "Heroes of Azeroth");
  assert.equal(card.number, "");
  assert.equal(card.setTotal, 361);
  assert.equal(card.setReleaseDate, "2006-10-25");
  assert.equal(card.rarity, "Epic");
  assert.equal(card.language, "en");
  assert.equal(card.image, "https://tcgplayer-cdn.tcgplayer.com/product/16485_in_1000x1000.jpg");
  assert.deepEqual(card.variants, ["Normal", "Foil"]);
  assert.deepEqual(price, { u: 24.5, uf: 80 });
});

test("carta: código de raridade sem nome conhecido fica como veio", () => {
  const ony = { groupId: 1092, name: "Onyxia's Lair", publishedOn: "2006-11-01T00:00:00" };
  const { card } = cardOf({ productId: 16845, name: "Onyxia, Stage 1", extendedData: [{ name: "Rarity", value: "F" }] }, ony, 63);
  assert.equal(card.rarity, "F");
  const loot = { groupId: 1334, name: "Loot Cards", publishedOn: "2017-12-01T00:00:00" };
  assert.equal(cardOf({ productId: 16641, name: "Landro Longshot (LOOT)", extendedData: [{ name: "Rarity", value: "L" }] }, loot, 33).card.rarity, "Loot");
});

test("carta: sem preço fica sem preço e com Normal; só Foil vira u e uf", () => {
  const p = { productId: 1, name: "X", extendedData: [{ name: "Rarity", value: "C" }] };
  const sem = cardOf(p, GRUPO, 361);
  assert.equal(sem.price, null);
  assert.deepEqual(sem.card.variants, ["Normal"]);
  const foil = cardOf(p, GRUPO, 361, new Map([["Foil", 5]]));
  assert.deepEqual(foil.price, { u: 5, uf: 5 });
  assert.deepEqual(foil.card.variants, ["Foil"]);
});
