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
  // Jogos TCGCSV (Magic, One Piece, YGO): Foil é variante própria, e
  // "Non-Foil" NÃO pode cair nela.
  assert.equal(api.mapCsvVariant("Foil"), "Foil");
  assert.equal(api.mapCsvVariant("Non-Foil"), "Normal");
  assert.equal(api.mapCsvVariant("Nonfoil"), "Normal");
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

test("mapCsvGame: os 13 jogos, nas grafias do Collectr/TCGplayer", () => {
  assert.equal(api.mapCsvGame("Magic: The Gathering"), "magic");
  assert.equal(api.mapCsvGame("MTG"), "magic");
  assert.equal(api.mapCsvGame("Yu-Gi-Oh!"), "ygo");
  assert.equal(api.mapCsvGame("YuGiOh"), "ygo");
  assert.equal(api.mapCsvGame("Digimon Card Game"), "digimon");
  assert.equal(api.mapCsvGame("Flesh and Blood TCG"), "fab");
  assert.equal(api.mapCsvGame("Flesh & Blood"), "fab");
  assert.equal(api.mapCsvGame("Gundam Card Game"), "gundam");
  assert.equal(api.mapCsvGame("Dragon Ball Super: Fusion World"), "dbfw");
  assert.equal(api.mapCsvGame("Riftbound: League of Legends TCG"), "riftbound");
  assert.equal(api.mapCsvGame("Union Arena"), "unionarena");
  assert.equal(api.mapCsvGame("Naruto Kayou"), "naruto");
  assert.equal(api.mapCsvGame("Hunter x Hunter"), "hxh");
});

test("csvSetKeys: nome cru e sem o prefixo de código", () => {
  const keys = [...api.csvSetKeys("SV08.5: Prismatic Evolutions")];
  assert.ok(keys.includes("sv085prismaticevolutions"));
  assert.ok(keys.includes("prismaticevolutions"));
});

// ---------------------------------------------------------------------------
// ManaBox e Dragon Shield MV — os dois scanners grátis mais usados no Brasil.
// O caminho de entrada do Sleevu passa por eles: quem já escaneou a coleção
// num dos dois não deveria ter que redigitar nada aqui. Cabeçalhos conferidos
// contra a documentação de cada app (ver docs/IMPORTAR.md).
// ---------------------------------------------------------------------------

const MANABOX_HEADER = ["Name", "Set Code", "Set Name", "Collector Number", "Foil", "Rarity",
  "Quantity", "ManaBox ID", "Scryfall ID", "Purchase Price", "Misprint", "Altered",
  "Condition", "Language", "Purchase Price Currency"];

const DRAGONSHIELD_HEADER = ["Folder Name", "Quantity", "Trade Quantity", "Card Name", "Set Code",
  "Set Name", "Card Number", "Condition", "Printing", "Language", "Price Bought",
  "Date Bought", "LOW", "MID", "MARKET"];

test("ManaBox: o cabeçalho inteiro cai nas colunas certas", () => {
  const c = api.mapCsvHeader(MANABOX_HEADER);
  assert.equal(c.name, 0);
  assert.equal(c.set, 2);        // "Set Name" ganha de "Set Code"
  assert.equal(c.number, 3);     // "Collector Number"
  assert.equal(c.variant, 4);    // "Foil"
  assert.equal(c.qty, 6);
  assert.equal(c.condition, 12);
  assert.equal(c.language, 13);
});

test("ManaBox: 'etched' é foil, não carta normal", () => {
  // O ManaBox escreve etched SECO na coluna Foil, e "etched" não contém
  // "foil": antes caía em Normal e a carta entrava na coleção como se não
  // fosse foil — perda silenciosa, na impressão mais cara do Magic moderno.
  assert.equal(api.mapCsvVariant("etched"), "Etched");
  assert.equal(api.mapCsvVariant("Etched Foil"), "Etched");
  assert.equal(api.mapCsvVariant("foil"), "Foil");
  assert.equal(api.mapCsvVariant("normal"), "Normal");
});

test("ManaBox: as condições vêm com underscore", () => {
  assert.equal(api.mapCsvCondition("near_mint"), "NM");
  assert.equal(api.mapCsvCondition("excellent"), "SP");
  assert.equal(api.mapCsvCondition("good"), "MP");
  assert.equal(api.mapCsvCondition("light_played"), "SP");
  assert.equal(api.mapCsvCondition("played"), "MP");
  assert.equal(api.mapCsvCondition("poor"), "D");
});

test("Dragon Shield: o preâmbulo 'sep=,' não vira cabeçalho", () => {
  // Sem tirar a linha, ela era lida como cabeçalho, o mapeamento voltava
  // TUDO -1 e o arquivo inteiro não importava — nenhuma carta, sem erro.
  const csv = "sep=,\n" + DRAGONSHIELD_HEADER.join(",") +
    "\nMinha pasta,2,0,Lightning Bolt,2X2,Double Masters 2022,117,NearMint,Normal,English,0,,0,0,0\n";
  const rows = api.parseCsvText(csv);
  assert.deepEqual(Array.from(rows[0]), DRAGONSHIELD_HEADER);

  const c = api.mapCsvHeader(Array.from(rows[0]));
  assert.equal(c.qty, 1);        // "Quantity" antes de "Trade Quantity"
  assert.equal(c.name, 3);       // "Card Name"
  assert.equal(c.set, 5);        // "Set Name"
  assert.equal(c.number, 6);
  assert.equal(c.condition, 7);
  assert.equal(c.variant, 8);    // "Printing"
  assert.equal(c.language, 9);

  const linha = Array.from(rows[1]);
  assert.equal(linha[c.name], "Lightning Bolt");
  assert.equal(api.mapCsvCondition(linha[c.condition]), "NM");
  assert.equal(api.mapCsvVariant(linha[c.variant]), "Normal");
});

test("Dragon Shield: o separador declarado no preâmbulo é o que vale", () => {
  // Um ; declarado tem que vencer a heurística, mesmo com vírgulas no meio
  // do nome — que é justamente o caso que a heurística erraria.
  const rows = api.parseCsvText('sep=;\nCard Name;Quantity\nErika\'s Venusaur, Holo;3\n');
  assert.deepEqual(Array.from(rows[1]), ["Erika's Venusaur, Holo", "3"]);
});

test("Dragon Shield: condições em CamelCase e idioma por extenso", () => {
  assert.equal(api.mapCsvCondition("NearMint"), "NM");
  assert.equal(api.mapCsvCondition("LightPlayed"), "SP");
  assert.equal(api.mapCsvCondition("Excellent"), "SP");
  assert.equal(api.mapCsvCondition("Good"), "MP");
  assert.equal(api.mapCsvCondition("Played"), "MP");
  assert.equal(api.mapCsvCondition("Poor"), "D");
  assert.equal(api.mapCsvLanguage("Portuguese (Brazil)"), "pt");
});

test("CSV sem preâmbulo continua igual (a heurística não foi mexida)", () => {
  const rows = api.parseCsvText("Name;Qty\nMewtwo;2");
  assert.deepEqual(Array.from(rows[1]), ["Mewtwo", "2"]);
  const tab = api.parseCsvText("Name\tQty\nMewtwo\t2");
  assert.deepEqual(Array.from(tab[1]), ["Mewtwo", "2"]);
});
