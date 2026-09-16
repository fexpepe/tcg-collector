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

// ── Import de set EN inteiro (16/09/2026: "30th Celebration" antes da TCGdex) ──
import {
  jpSerieOfCode, enImportEntries, findImportGroup, importSetFields, importNumberFilter, splitByDenominator,
  jpAliasOf, jpAmbiguousCodes
} from "../scripts/lib/tcgcsv-pokemon.mjs";

test("jpSerieOfCode: série do set JP importado pelo prefixo do código (mais longo primeiro)", () => {
  assert.deepEqual(jpSerieOfCode("M6a"), { setSerieId: "M", setSerieName: "ポケモンカードゲーム MEGA" });
  assert.deepEqual(jpSerieOfCode("M-P"), { setSerieId: "M", setSerieName: "ポケモンカードゲーム MEGA" });
  assert.equal(jpSerieOfCode("SV1a").setSerieId, "SV");  // SV, não S
  assert.equal(jpSerieOfCode("SM10").setSerieId, "SM");  // SM, não S
  assert.equal(jpSerieOfCode("S-P").setSerieId, "S");
  assert.equal(jpSerieOfCode("CP1").setSerieId, "XY");
  assert.equal(jpSerieOfCode("BW1"), null);              // era que a TCGdex ja não cobre: sem série
  assert.equal(jpSerieOfCode(""), null);
});

const IMPORT_GROUPS = [
  { groupId: 24451, name: "ME: Black Star Promos", publishedOn: "2025-09-26T00:00:00" },
  { groupId: 25100, name: "ME: 30th Celebration", publishedOn: "2026-09-16T00:00:00" },
  { groupId: 25101, name: "ME: 30th Celebration Classic Collection", publishedOn: "2026-09-16T00:00:00" }
];
const PINS = { en: { mep: 24451 }, enImport: [
  { group: "ME: 30th Celebration", setId: "cel30", name: "30th Celebration", serie: "me", date: "2026-09-16", total: 128 },
  { group: 25101, setId: "cel30cc", name: "30th Celebration Classic Collection", serie: "me" },
  { group: "Sem setId" }, null
] };

test("enImportEntries / findImportGroup: pin válido acha o grupo pelo nome normalizado ou pelo groupId", () => {
  const entries = enImportEntries(PINS);
  assert.deepEqual(entries.map((e) => e.setId), ["cel30", "cel30cc"]);
  assert.equal(findImportGroup(entries[0], IMPORT_GROUPS).groupId, 25100); // "ME: 30th Celebration" ≠ "…Classic Collection"
  assert.equal(findImportGroup(entries[1], IMPORT_GROUPS).groupId, 25101);
  assert.equal(findImportGroup({ group: "30th celebration", setId: "x" }, IMPORT_GROUPS).groupId, 25100); // sem o "ME: " também
  assert.equal(findImportGroup({ group: "ME: Delta Reign", setId: "x" }, IMPORT_GROUPS), null);   // ainda não existe
  assert.deepEqual(enImportEntries({}), []);
});

test("importSetFields / importNumberFilter: campos do set vêm do pin, senão do grupo; regex sobre o número impresso", () => {
  const [main, cc] = enImportEntries(PINS);
  const f = importSetFields(main, IMPORT_GROUPS[1]);
  assert.equal(f.set, "30th Celebration");
  assert.equal(f.setSerieId, "me");
  assert.equal(f.setSerieName, "Mega Evolution");
  assert.equal(f.setReleaseDate, "2026-09-16");
  assert.equal(f.setTotal, 128);
  assert.equal(importSetFields({ setId: "x", group: 1 }, IMPORT_GROUPS[2]).set, "ME: 30th Celebration Classic Collection");
  assert.equal(importSetFields(cc, null).setReleaseDate, "");
  const keep = importNumberFilter({ numbers: "/\\s*128$" });
  assert.equal(keep({ extendedData: [{ name: "Number", value: "129/128" }] }), true);
  assert.equal(keep({ extendedData: [{ name: "Number", value: "4/102" }] }), false);
  assert.equal(importNumberFilter(null)({}), true);
});

test("matchGroup em modo import: mesmo numerador com denominadores diferentes vira DUAS cartas, ids estáveis", () => {
  const prods = [
    { productId: 30, name: "Blastoise - 2/102", extendedData: [{ name: "Number", value: "2/102" }] },
    { productId: 31, name: "Blaine's Charizard - 2/132", extendedData: [{ name: "Number", value: "2/132" }] },
    { productId: 32, name: "Charizard - 4/102", extendedData: [{ name: "Number", value: "4/102" }] },
    { productId: 33, name: "Pikachu (Poke Ball Pattern) - 4/102", extendedData: [{ name: "Number", value: "4/102" }] }
  ];
  const m = matchGroup([], prods, [], { setId: "cel30cc", lang: "en" });
  assert.deepEqual(m.misses.map((x) => x.key).sort(), ["2", "2-132", "4"]);
  const dup = m.misses.find((x) => x.key === "2-132");
  assert.equal(dup.idExtra, "132");
  assert.equal(dup.product.productId, 31);
  assert.equal(m.misses.find((x) => x.key === "4").product.productId, 32); // padrão Poke Ball é impressão, não carta
  const sib = importSetFields(PINS.enImport[1], IMPORT_GROUPS[2]);
  const c = synthesizeCard({ product: dup.product, price: null, img: "I", setId: "cel30cc", lang: "en", sib, group: IMPORT_GROUPS[2], pinned: null, revNames: {}, keepZeros: true, idExtra: dup.idExtra });
  assert.equal(c.id, "cel30cc-2-132");
  assert.equal(c.number, "2");
  assert.equal(c.setTotal, 132);
  assert.equal(c.set, "30th Celebration Classic Collection");
  assert.equal(c.setSerieId, "me");
  // Set que JÁ existe: um numerador = uma carta (o segundo denominador é ignorado, como antes)
  const chunk = [{ id: "cel30cc-2", number: "2", rarity: "Classic Collection" }];
  const m2 = matchGroup(chunk, prods, [], { setId: "cel30cc", lang: "en" });
  assert.equal(m2.matched, 1);
  assert.deepEqual(m2.misses.map((x) => x.key), ["4"]);
  assert.deepEqual(splitByDenominator([]), []);
});

test("synthesizeCard keepZeros: id com o número como impresso, convenção da TCGdex nas eras SV/ME", () => {
  const product = { productId: 40, name: "Pikachu - 001/128", extendedData: [{ name: "Number", value: "001/128" }, { name: "Rarity", value: "Common" }] };
  const group = IMPORT_GROUPS[1];
  const sib = importSetFields(PINS.enImport[0], group);
  const c = synthesizeCard({ product, price: { u: 1 }, img: "I", setId: "cel30", lang: "en", sib, group, pinned: null, revNames: { pikachu: 25 }, keepZeros: true });
  assert.equal(c.id, "cel30-001");
  assert.equal(c.number, "001");
  assert.equal(c.setTotal, 128);
  assert.equal(c.setReleaseDate, "2026-09-16");
  assert.equal(c.setSerieName, "Mega Evolution");
  assert.equal(c.dexId, 25);
  assert.equal(c.rarity, "Common");
  // sem keepZeros segue como antes (promo/add-on)
  assert.equal(synthesizeCard({ product, price: null, img: "I", setId: "cel30", lang: "en", sib, group, pinned: null, revNames: {} }).id, "cel30-1");
  // set JP importado: série pelo código, nome do grupo sem o código
  const jp = synthesizeCard({ product: { productId: 41, name: "Pikachu - 001/103", extendedData: [{ name: "Number", value: "001/103" }] }, price: null, img: "I", setId: "M6a", lang: "ja", sib: jpSerieOfCode("M6a"), group: { groupId: 9, name: "M6a: 30th Celebration", publishedOn: "2026-09-16" }, pinned: null, revNames: {}, keepZeros: true });
  assert.equal(jp.id, "M6a-001-ja"); // convenção da TCGdex em ja (M-P-001-ja)
  assert.equal(jp.set, "30th Celebration");
  assert.equal(jp.setSerieId, "M");
  assert.equal(jp.setSerieName, "ポケモンカードゲーム MEGA");
  assert.equal(jp.setTotal, 103);
});

test("jpAmbiguousCodes: código repetido em grupos sem chunk é ambíguo; chunk ou apelido por nome desambiguam", () => {
  const groups = [
    { groupId: 1, name: "SV: Ceruledge ex Stellar Tera Type Starter Set" },
    { groupId: 2, name: "SV: Chien-Pao ex Battle Master Deck" },
    { groupId: 3, name: "SV: Terastal Charizard ex Battle Master Deck" },
    { groupId: 4, name: "BW1: Black Collection" }, { groupId: 5, name: "BW1: White Collection" },
    { groupId: 6, name: "SV4a: Shiny Treasure ex" }, { groupId: 7, name: "SV4a: Shiny Treasure ex (reprint)" },
    { groupId: 8, name: "M6a: 30th Celebration" }, { groupId: 9, name: "Sem código" }
  ];
  const alias = { "SV: Ceruledge ex Stellar Tera Type Starter Set": "SVLS" };
  const amb = jpAmbiguousCodes(groups, { codeOf: (g) => jpSetCode(g.name), hasChunk: (c) => c.toUpperCase() === "SV4A", alias }); // mesma régua do sync (byCode em maiúsculas)
  assert.deepEqual([...amb.keys()].sort(), ["BW1", "SV"]);
  assert.deepEqual(amb.get("SV").map((g) => g.groupId), [2, 3]); // o apelidado (1) saiu da conta
  assert.equal(jpAliasOf(groups[0], "SV", alias), "SVLS");
  assert.equal(jpAliasOf(groups[1], "SV", alias), null);
  assert.equal(jpAliasOf({ name: "SVP Promo" }, "SVP", { svp: "SV-P" }), null);
  assert.equal(jpAliasOf({ name: "SVP Promo" }, "SVP", { SVP: "SV-P" }), "SV-P");
  assert.equal(jpAmbiguousCodes([], { codeOf: () => null, hasChunk: () => false, alias: {} }).size, 0);
});
