// Lógica pura do sync da TCGCSV pro Pokémon (scripts/lib/tcgcsv-pokemon.mjs).
// O sync de verdade só roda no deploy com a fonte viva; aqui vão fixtures no
// formato que a TCGCSV devolve (o mesmo do sync-onepiece): groups
// { groupId, name, abbreviation, publishedOn }, products { productId, name,
// extendedData: [{ name: "Number"|"Rarity", value }] } e prices { productId,
// subTypeName, marketPrice, midPrice, lowPrice }.
// Roda com: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSetName, setNameKeys, indexGroupsByName, candidateGroups, productKey,
  cleanProductName, pickMainProduct, matchGroup, groupFits, jpSetCode, jpSetTitle,
  synthesizeCard, speciesOf
} from "../scripts/lib/tcgcsv-pokemon.mjs";

test("normalizeSetName: tira código de era, sufixo Base Set e iguala &/and", () => {
  assert.equal(normalizeSetName("SWSH07: Evolving Skies").short, "evolving skies");
  assert.equal(normalizeSetName("SV01: Scarlet & Violet Base Set").short, "scarlet and violet");
  assert.equal(normalizeSetName("Scarlet & Violet").short, "scarlet and violet");
  assert.equal(normalizeSetName("SM - Ultra Prism").short, "ultra prism");
  assert.equal(normalizeSetName("XY - Evolutions").short, "evolutions");
  assert.equal(normalizeSetName("Base Set").short, "base set"); // não some
  assert.equal(normalizeSetName("Expedition Base Set").short, "expedition");
  assert.equal(normalizeSetName("Pokémon GO").short, "go");
});

test("setNameKeys: apelidos entre TCGdex e TCGplayer (151, Expedition, Ruby & Sapphire)", () => {
  assert.ok(setNameKeys("151").includes("scarlet and violet 151"));
  assert.ok(setNameKeys("SV: Scarlet & Violet 151").includes("151"));
  assert.ok(setNameKeys("EX Ruby and Sapphire").includes("ruby and sapphire"));
  assert.ok(setNameKeys("Expedition").includes("expedition base set"));
});

const GROUPS = [
  { groupId: 2948, name: "SWSH09: Brilliant Stars", publishedOn: "2022-02-25" },
  { groupId: 3020, name: "SWSH09: Brilliant Stars Trainer Gallery", publishedOn: "2022-02-25" },
  { groupId: 604, name: "Base Set", publishedOn: "1999-01-09" },
  { groupId: 23237, name: "SV: Scarlet & Violet 151", publishedOn: "2023-09-22" }
];

test("candidateGroups: acha o set e a galeria-irmã pelo nome da TCGdex", () => {
  const idx = indexGroupsByName(GROUPS);
  assert.deepEqual(candidateGroups({ id: "swsh9", name: "Brilliant Stars" }, idx).map((g) => g.groupId), [2948, 3020]);
  assert.deepEqual(candidateGroups({ id: "sv03.5", name: "151" }, idx).map((g) => g.groupId), [23237]);
  assert.deepEqual(candidateGroups({ id: "base1", name: "Base Set" }, idx).map((g) => g.groupId), [604]);
  assert.deepEqual(candidateGroups({ id: "zzz", name: "Inexistente" }, idx), []);
});

test("productKey / cleanProductName: número e nome limpos do produto", () => {
  const p = { name: "Charizard ex - 199/165", extendedData: [{ name: "Number", value: "199/165" }] };
  assert.equal(productKey(p), "199");
  assert.equal(cleanProductName(p.name), "Charizard ex");
  assert.equal(cleanProductName("Pikachu (025/165) (Poke Ball Pattern)"), "Pikachu (Poke Ball Pattern)");
  assert.equal(cleanProductName("Special Delivery Pikachu - SWSH074"), "Special Delivery Pikachu");
  assert.equal(productKey({ name: "Booster Box", extendedData: [] }), ""); // selado
  assert.equal(productKey({ extendedData: [{ name: "Number", value: "TG08/TG30" }] }), "tg8");
});

test("pickMainProduct: arte base (sem parêntese) ganha do padrão Poke Ball, empate pelo preço", () => {
  const a = { productId: 1, name: "Pikachu - 025/165" };
  const b = { productId: 2, name: "Pikachu (Poke Ball Pattern) - 025/165" };
  assert.equal(pickMainProduct([b, a], () => 1).productId, 1);
  const c = { productId: 3, name: "Pikachu (Master Ball Pattern) - 025/165" };
  assert.equal(pickMainProduct([b, c], (p) => (p.productId === 3 ? 90 : 10)).productId, 3);
});

const CHUNK = [
  { id: "swshp-SWSH001", number: "SWSH001", rarity: "Promo", image: "https://assets.tcgdex.net/1.png", set: "SWSH Black Star Promos", setId: "swshp", setLogo: "L", setTotal: 307 },
  { id: "swshp-SWSH002", number: "SWSH002", rarity: "Promo", image: "https://assets.tcgdex.net/2.png", set: "SWSH Black Star Promos", setId: "swshp" },
  { id: "swshp-SWSH003", number: "SWSH003", rarity: "Promo", image: "https://assets.tcgdex.net/3.png", set: "SWSH Black Star Promos", setId: "swshp" }
];
const PRODUCTS = [
  { productId: 10, name: "Pikachu - SWSH001", extendedData: [{ name: "Number", value: "SWSH001" }, { name: "Rarity", value: "Promo" }] },
  { productId: 11, name: "Grookey - SWSH002", extendedData: [{ name: "Number", value: "SWSH002" }] },
  { productId: 12, name: "Special Delivery Pikachu - SWSH074", extendedData: [{ name: "Number", value: "SWSH074" }, { name: "Rarity", value: "Promo" }] },
  { productId: 13, name: "Pikachu - 227/S-P", extendedData: [{ name: "Number", value: "227/S-P" }] }, // promo JP misturada
  { productId: 14, name: "Sword & Shield Booster Box", extendedData: [] }
];
const PRICES = [
  { productId: 10, subTypeName: "Holofoil", marketPrice: 2.5 },
  { productId: 11, subTypeName: "Holofoil", marketPrice: 1 },
  { productId: 12, subTypeName: "Holofoil", marketPrice: 30 },
  { productId: 13, subTypeName: "Holofoil", marketPrice: 1500 }
];

test("matchGroup: casa por número, ignora selado, aceita promo EN nova e RECUSA a promo JP '227'", () => {
  const m = matchGroup(CHUNK, PRODUCTS, PRICES, { setId: "swshp", lang: "en" });
  assert.equal(m.matched, 2);
  assert.equal(m.total, 4);
  assert.deepEqual(m.entries["swshp-SWSH001"], { img: "https://tcgplayer-cdn.tcgplayer.com/product/10_in_400x400.jpg", u: 2.5 });
  assert.deepEqual(m.misses.map((x) => x.key), ["swsh74"]);
  assert.equal(groupFits(m), true); // 2 de 3 nossas
});

test("groupFits: nome igual com números que não batem não é o set", () => {
  const outros = [
    { productId: 1, name: "A - 1/102", extendedData: [{ name: "Number", value: "1/102" }] },
    { productId: 2, name: "B - 2/102", extendedData: [{ name: "Number", value: "2/102" }] }
  ];
  const m = matchGroup(CHUNK, outros, [], { setId: "swshp", lang: "en" });
  assert.equal(groupFits(m), false);
  assert.equal(groupFits(matchGroup([], outros, [], { setId: "S-P", lang: "ja" })), false); // sem chunk não "cabe" — é import
});

test("matchGroup com chunk vazio (import JP inteiro): tudo vira miss, com preço por impressão", () => {
  const prods = [
    { productId: 20, name: "Pikachu - 227/S-P", extendedData: [{ name: "Number", value: "227/S-P" }] },
    { productId: 21, name: "Eevee - 228/S-P", extendedData: [{ name: "Number", value: "228/S-P" }] }
  ];
  const prices = [
    { productId: 20, subTypeName: "Normal", marketPrice: 120 }, { productId: 20, subTypeName: "Holofoil", marketPrice: 150 }
  ];
  const m = matchGroup([], prods, prices, { setId: "S-P", lang: "ja" });
  assert.equal(m.misses.length, 2);
  assert.deepEqual(m.misses.find((x) => x.key === "227").price, { u: 120, v: { Normal: 120, Holo: 150 } });
});

test("jpSetCode / jpSetTitle: código no nome do grupo japonês", () => {
  assert.equal(jpSetCode("SV4a: Shiny Treasure ex"), "SV4a");
  assert.equal(jpSetTitle("SV4a: Shiny Treasure ex"), "Shiny Treasure ex");
  assert.equal(jpSetCode("SV-P Promotional Cards"), "SV-P");
  assert.equal(jpSetCode("S-P Promotional Cards"), "S-P");
  assert.equal(jpSetCode("SM-P Promo"), "SM-P");
  assert.equal(jpSetCode("Neo Genesis"), null);
  assert.equal(jpSetCode("M2a: MEGA Dream ex"), "M2a");
});

test("synthesizeCard: id pinado vence o derivado; sem pino o id sai do número sem zeros; set importado herda nome/data do grupo", () => {
  const product = { productId: 13, name: "Pikachu - 227/S-P", extendedData: [{ name: "Number", value: "227/S-P" }, { name: "Rarity", value: "Promo" }] };
  const group = { groupId: 9, name: "S-P Promotional Cards", publishedOn: "2020-01-01T00:00:00" };
  const rev = { pikachu: 25 };
  const c = synthesizeCard({ product, price: { u: 120, v: { Normal: 120, Holo: 150 } }, img: "I", setId: "S-P", lang: "ja", sib: null, group, pinned: null, revNames: rev });
  assert.equal(c.id, "S-P-227-ja");
  assert.equal(c.name, "Pikachu");
  assert.equal(c.dexId, 25);
  assert.equal(c.language, "ja");
  assert.equal(c.set, "S-P Promotional Cards");
  assert.equal(c.setReleaseDate, "2020-01-01");
  assert.equal(c.setTotal, ""); // "227/S-P": o denominador é o código, não o total
  assert.equal(synthesizeCard({ product: { productId: 1, name: "X - 010/165", extendedData: [{ name: "Number", value: "010/165" }] }, price: null, img: "I", setId: "sv2a", lang: "ja", sib: null, group, pinned: null, revNames: {} }).setTotal, 165);
  assert.equal(c.rarity, "Promo");
  assert.deepEqual(c.price, { u: 120, v: { Normal: 120, Holo: 150 } });
  assert.equal(c._new, true);
  const pinned = synthesizeCard({ product, price: null, img: "I", setId: "S-P", lang: "ja", sib: null, group, pinned: "S-P-0227-ja", revNames: rev });
  assert.equal(pinned.id, "S-P-0227-ja");
  assert.equal(pinned.price, undefined);
  // add-on-miss EN: campos do set vêm da carta-irmã
  const en = synthesizeCard({ product: PRODUCTS[2], price: { u: 30 }, img: "I", setId: "swshp", lang: "en", sib: CHUNK[0], group: GROUPS[0], pinned: null, revNames: {} });
  assert.equal(en.id, "swshp-SWSH74");
  assert.equal(en.set, "SWSH Black Star Promos");
  assert.equal(en.setLogo, "L");
  assert.equal(en.pokemonName, "Special Delivery Pikachu");
});

test("speciesOf: tira sufixos de mecânica", () => {
  assert.equal(speciesOf("Charizard ex"), "Charizard");
  assert.equal(speciesOf("Pikachu VMAX"), "Pikachu");
  assert.equal(speciesOf("Umbreon"), "Umbreon");
});
