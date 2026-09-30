// Testes do sync do Cyberpunk TCG (scripts/sync-cyberpunk.mjs), sem rede: o
// setId fixo por groupId (a TCGCSV deixou a abreviação vazia na maioria dos
// grupos), o logo da edição Beta achado pelo código base e o mapeamento de
// campo do produto. Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { setIdOf, logoCandidates, cardOf, ABREV_FIXA } from "../scripts/sync-cyberpunk.mjs";

test("setId: pin por groupId vale mais que a abreviação da fonte", () => {
  assert.equal(setIdOf({ groupId: 24845, abbreviation: "" }), "WNC-B");
  assert.equal(setIdOf({ groupId: 24855, abbreviation: "" }), "WNC");
  // A fonte preencher a abreviação depois não pode mudar setId publicado.
  assert.equal(setIdOf({ groupId: 24855, abbreviation: "WTNC" }), "WNC");
  assert.equal(setIdOf({ groupId: 24884, abbreviation: "NCB01" }), "NCB01");
});

test("setId: grupo novo sem pin cai na abreviação, ou no groupId se vier vazia", () => {
  assert.equal(setIdOf({ groupId: 1, abbreviation: "SET2" }, new Map([["SET2", 1]])), "SET2");
  assert.equal(setIdOf({ groupId: 2, abbreviation: " " }), "G2");
  assert.equal(setIdOf({ groupId: 3, abbreviation: "P26" }, new Map([["P26", 2]])), "P26-3");
});

test("setId: os pins são únicos e cabem num nome de arquivo", () => {
  const ids = Object.values(ABREV_FIXA);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[A-Z0-9-]+$/);
});

test("logo: a Beta procura o próprio código e depois o da Retail", () => {
  assert.deepEqual(logoCandidates("WNC-B"), ["WNC-B.webp", "WNC.webp"]);
  assert.deepEqual(logoCandidates("WNC"), ["WNC.webp"]);
  assert.deepEqual(logoCandidates("EOR01"), ["EOR01.webp"]);
});

const PRODUTO = {
  productId: 714162,
  name: "Adam Smasher - Ender of Legends (Epic)",
  extendedData: [
    { name: "Rarity", value: "Epic" }, { name: "Number", value: "B001" },
    { name: "Color", value: "Red" }, { name: "CardType", value: "Legend" },
    { name: "Tags", value: "Arasaka;Merc" }, { name: "Cost", value: "09" },
    { name: "Power", value: "4+" }, { name: "RAM", value: "x2" }, { name: "Eddies", value: "TRUE" }
  ]
};
const GRUPO = { groupId: 24845, name: "Welcome to Night City - Beta", publishedOn: "2026-09-10T00:00:00" };

test("carta: id do productId, campos do jogo e imagem grande do CDN", () => {
  const { card, price } = cardOf(PRODUTO, GRUPO, "WNC-B", 172, new Map([["Foil", 12.5], ["Normal", 3.1]]));
  assert.equal(card.id, "cpk-714162");
  assert.equal(card.setId, "WNC-B");
  assert.equal(card.number, "B001");
  assert.equal(card.setReleaseDate, "2026-09-10");
  assert.equal(card.image, "https://tcgplayer-cdn.tcgplayer.com/product/714162_in_1000x1000.jpg");
  assert.deepEqual(card.variants, ["Normal", "Foil"]);
  assert.equal(card.color, "Red");
  assert.equal(card.cardType, "Legend");
  assert.equal(card.cost, 9);        // "09" -> 9
  assert.equal(card.power, "4+");    // poder variável fica como texto
  assert.equal(card.ram, 2);         // "x2" -> 2
  assert.equal(card.tags, "Arasaka;Merc");
  assert.deepEqual(price, { u: 3.1, uf: 12.5 });
});

test("carta: pré-venda sem preço fica sem preço e com Normal", () => {
  const { card, price } = cardOf({ productId: 1, name: "X", extendedData: [{ name: "Number", value: "001" }] }, GRUPO, "WNC", 141);
  assert.equal(price, null);
  assert.deepEqual(card.variants, ["Normal"]);
  assert.equal(card.rarity, "");
  assert.equal(card.cost, null);
  assert.equal(card.power, null);
  assert.equal(card.ram, null);
});

test("carta: só Foil com preço vira u e uf", () => {
  const { card, price } = cardOf(PRODUTO, GRUPO, "BT-B", 6, new Map([["Foil", 20]]));
  assert.deepEqual(price, { u: 20, uf: 20 });
  assert.deepEqual(card.variants, ["Foil"]);
});
