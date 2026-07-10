// Testes dos helpers PUROS do importador de CSV (TCGplayer/Collectr/Dex) do
// src/shared.js, capturados via sandbox. Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared } from "./lib/shared-sandbox.mjs";

const sb = loadShared(
  "window.__test = { parseCsvText, mapCsvHeader, mapCsvVariant, mapCsvCondition, mapCsvLanguage, mapCsvGame, csvSetKeys };"
);
const api = sb.window.__test;

test("parseCsvText: aspas com vírgula/aspas internas, CRLF e separador ;", () => {
  // Array.from: arrays do sandbox (outro realm do vm) falham no deepStrictEqual.
  const rows = api.parseCsvText('Name,Set\n"Erika\'s Venusaur, Holo","Gym ""Heroes"""\r\nPikachu,Base Set\n');
  assert.deepEqual(Array.from(rows[1]), ["Erika's Venusaur, Holo", 'Gym "Heroes"']);
  assert.deepEqual(Array.from(rows[2]), ["Pikachu", "Base Set"]);

  const semi = api.parseCsvText("Name;Qty\nMewtwo;2");
  assert.deepEqual(Array.from(semi[1]), ["Mewtwo", "2"]);
});

test("mapCsvHeader: formato TCGplayer", () => {
  const cols = api.mapCsvHeader(["Quantity", "Name", "Simple Name", "Set", "Card Number", "Set Code", "Printing", "Condition", "Language", "Rarity", "Product ID", "SKU"]);
  assert.equal(cols.qty, 0);
  assert.equal(cols.name, 1); // "Name" vence "Simple Name" (ordem de sinônimos)
  assert.equal(cols.set, 3);
  assert.equal(cols.number, 4);
  assert.equal(cols.variant, 6);
  assert.equal(cols.condition, 7);
  assert.equal(cols.language, 8);
});

test("mapCsvHeader: formato Collectr (Product Name/Variance/Game)", () => {
  const cols = api.mapCsvHeader(["Product Name", "Set", "Game", "Card Number", "Variance", "Quantity", "Price"]);
  assert.equal(cols.name, 0);
  assert.equal(cols.set, 1);
  assert.equal(cols.game, 2);
  assert.equal(cols.number, 3);
  assert.equal(cols.variant, 4);
  assert.equal(cols.qty, 5);
});

test("mapCsvVariant: printings do TCGplayer", () => {
  assert.equal(api.mapCsvVariant("Holofoil"), "Holo");
  assert.equal(api.mapCsvVariant("Reverse Holofoil"), "Reverse");
  assert.equal(api.mapCsvVariant("1st Edition Holofoil"), "1st Edition");
  assert.equal(api.mapCsvVariant("Normal"), "Normal");
  assert.equal(api.mapCsvVariant(""), "Normal");
});

test("mapCsvCondition: nomes longos e siglas", () => {
  assert.equal(api.mapCsvCondition("Near Mint"), "NM");
  assert.equal(api.mapCsvCondition("Lightly Played"), "SP");
  assert.equal(api.mapCsvCondition("Moderately Played"), "MP");
  assert.equal(api.mapCsvCondition("Heavily Played"), "HP");
  assert.equal(api.mapCsvCondition("Damaged"), "D");
  assert.equal(api.mapCsvCondition(""), "NM");
});

test("mapCsvLanguage/mapCsvGame", () => {
  assert.equal(api.mapCsvLanguage("Portuguese"), "pt");
  assert.equal(api.mapCsvLanguage("Japanese"), "ja");
  assert.equal(api.mapCsvLanguage("English"), "en");
  assert.equal(api.mapCsvGame("Pokemon"), "pokemon");
  assert.equal(api.mapCsvGame("Disney Lorcana"), "lorcana");
  assert.equal(api.mapCsvGame("One Piece Card Game"), "onepiece");
  assert.equal(api.mapCsvGame("Sports"), "");
});

test("csvSetKeys: nome cru e sem o prefixo de código", () => {
  const keys = [...api.csvSetKeys("SV08.5: Prismatic Evolutions")];
  assert.ok(keys.includes("sv085prismaticevolutions"));
  assert.ok(keys.includes("prismaticevolutions"));
});
