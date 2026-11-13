// Testes do sync do Grand Archive TCG (scripts/sync-grandarchive.mjs), sem
// rede: o setId que sai da abreviação da TCGCSV, o id pelo productId (o número
// repete dentro do set) e o mapeamento de campo do produto.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { setIdOf, cardOf, DATA_FIXA } from "../scripts/sync-grandarchive.mjs";

test("setId: a abreviação da fonte, em maiúscula e sem espaço nem pontuação", () => {
  assert.equal(setIdOf({ groupId: 23123, abbreviation: "DOA 1st" }), "DOA-1ST");
  assert.equal(setIdOf({ groupId: 23128, abbreviation: "DOA Alter" }), "DOA-ALTER");
  assert.equal(setIdOf({ groupId: 24906, abbreviation: "ReC: MSD" }), "REC-MSD");
  assert.equal(setIdOf({ groupId: 23131, abbreviation: "DOAp" }), "DOAP");
  assert.equal(setIdOf({ groupId: 23545, abbreviation: "AMB1E" }), "AMB1E");
  // Cabe num nome de arquivo e num pedaço de URL.
  for (const a of ["DOA 1st", "ReC: MSD", "MH Alter", "P", "SP4"]) assert.match(setIdOf({ groupId: 1, abbreviation: a }), /^[A-Z0-9-]+$/);
});

test("setId: sem abreviação cai no groupId, e abreviação repetida não colide", () => {
  assert.equal(setIdOf({ groupId: 99001, abbreviation: "" }), "G99001");
  assert.equal(setIdOf({ groupId: 99002, abbreviation: " : " }), "G99002");
  assert.equal(setIdOf({ groupId: 99003, abbreviation: "PRD" }, new Set(["PRD"])), "PRD-99003");
});

const GRUPO = { groupId: 23123, name: "Dawn of Ashes 1st Edition", publishedOn: "2023-04-28T00:00:00" };
const PRODUTO = {
  productId: 494129,
  name: "Accepted Contract",
  extendedData: [
    { name: "Rarity", value: "Common" }, { name: "Number", value: "069" },
    { name: "CardType", value: "Action" }, { name: "CardSubtype", value: "Skill" },
    { name: "Element", value: "Norm" }, { name: "Class", value: "Assassin" },
    { name: "Reserve Cost", value: "5" }, { name: "Speed", value: "Slow" }
  ]
};

test("carta: id do productId, campos do jogo e imagem grande do CDN", () => {
  const { card, price } = cardOf(PRODUTO, GRUPO, "DOA-1ST", 287, new Map([["Normal", 0.25], ["Foil", 1.5]]));
  assert.equal(card.id, "ga-494129");
  assert.equal(card.name, "Accepted Contract");
  assert.equal(card.set, "Dawn of Ashes 1st Edition");
  assert.equal(card.setId, "DOA-1ST");
  assert.equal(card.number, "069");
  assert.equal(card.setTotal, 287);
  assert.equal(card.setReleaseDate, "2023-04-28");
  assert.equal(card.rarity, "Common");
  assert.equal(card.language, "en");
  assert.equal(card.image, "https://tcgplayer-cdn.tcgplayer.com/product/494129_in_1000x1000.jpg");
  assert.deepEqual(card.variants, ["Normal", "Foil"]);
  assert.equal(card.cardType, "Action");
  assert.equal(card.color, "Norm");
  assert.equal(card.cardClass, "Assassin");
  assert.equal(card.cost, "5");
  assert.deepEqual(price, { u: 0.25, uf: 1.5 });
});

test("carta: a versão de colecionador divide o número com a comum e é outra carta", () => {
  const comum = { productId: 1, name: "Lorraine, Blademaster", extendedData: [{ name: "Number", value: "005" }, { name: "Rarity", value: "Common" }, { name: "MemoryCost", value: "2" }] };
  const cur = { productId: 2, name: "Lorraine, Blademaster (CUR)", extendedData: [{ name: "Number", value: "005" }, { name: "Rarity", value: "Collector Ultra Rare" }] };
  const a = cardOf(comum, GRUPO, "DOA-1ST", 287).card;
  const b = cardOf(cur, GRUPO, "DOA-1ST", 287, new Map([["Foil", 900]]), new Set(["Foil"]));
  assert.notEqual(a.id, b.card.id);
  assert.equal(a.number, b.card.number);
  assert.equal(b.card.name, "Lorraine, Blademaster (CUR)"); // o qualificador é o que separa as duas
  assert.equal(a.cost, "2");                                // sem custo de reserva, vale o de memória
  assert.deepEqual(a.variants, ["Normal"]);                 // sem acabamento listado
  assert.deepEqual(b.card.variants, ["Foil"]);
  assert.deepEqual(b.price, { u: 900, uf: 900 });           // só foil: o preço base é o do foil
  assert.equal(b.card.cardType, null);
});

test("data: o 2023 Demo Deck não vira lançamento de 12/11/2026", () => {
  const p = { productId: 3, name: "Crescent Glaive", extendedData: [{ name: "Number", value: "001" }] };
  const { card } = cardOf(p, { groupId: 23238, name: "2023 Demo Deck", publishedOn: "2026-11-12T00:00:00" }, "DEMO23", 29);
  assert.equal(card.setReleaseDate, DATA_FIXA[23238]);
  assert.equal(card.setReleaseDate, "2023-08-01");
});
