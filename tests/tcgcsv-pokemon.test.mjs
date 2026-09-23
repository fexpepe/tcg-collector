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
  synthesizeCard, speciesOf, extraNumbersOf, mirrorLangsOf, mirrorCard
} from "../scripts/lib/tcgcsv-pokemon.mjs";
import { missAllowed } from "../scripts/lib/pricing.mjs";

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

test("jpSerieOfCode: toda era japonesa tem série, com o nome que a TCGdex usa onde ela tem a era", () => {
  const s = (code) => (jpSerieOfCode(code) || {}).setSerieId;
  // as que a TCGdex ja já cobre (mesmo id/nome dos chunks)
  assert.deepEqual(jpSerieOfCode("SV4a"), { setSerieId: "SV", setSerieName: "ポケモンカードゲーム スカーレット&バイオレット" });
  assert.deepEqual(jpSerieOfCode("neo1"), { setSerieId: "neo", setSerieName: "ポケモンカード★neo" });
  assert.equal(s("PMCG3"), "PMCG"); assert.equal(s("E4"), "e"); assert.equal(s("VS1"), "VS"); assert.equal(s("web1"), "web");
  assert.equal(s("PCG-P"), "PCG"); assert.equal(s("XY-P"), "XY"); assert.equal(s("CP6"), "XY"); assert.equal(s("SM-P"), "SM");
  assert.equal(s("S12a"), "S"); assert.equal(s("S-P"), "S"); assert.equal(s("sC2"), "S"); assert.equal(s("sp5"), "S");
  assert.equal(s("SVK"), "SV"); assert.equal(s("svpj"), "SV"); assert.equal(s("M6a"), "M"); assert.equal(s("MBG"), "M"); assert.equal(s("MP1"), "M");
  // as que a TCGdex ja não tem: o id é o código da era
  assert.equal(s("ADV-P"), "ADV"); assert.equal(s("DP-P"), "DP"); assert.equal(s("DPt-P"), "DPt"); assert.equal(s("Pt4"), "Pt"); assert.equal(s("PtM"), "Pt");
  assert.equal(s("L3"), "L"); assert.equal(s("LL"), "L"); assert.equal(s("L-P"), "L"); assert.equal(s("BW9"), "BW"); assert.equal(s("BW"), "BW");
  assert.equal(s("BKZ"), "BW"); assert.equal(s("HSZ"), "BW"); assert.equal(s("PLAY"), "ADV"); assert.equal(s("T"), "e"); assert.equal(s("PPP"), "DP"); assert.equal(s("WCS23"), "SV");
  // "S" não engole SM/SV; "E" só casa E<dígito>; código desconhecido fica sem série
  assert.notEqual(s("SM10"), "S"); assert.notEqual(s("SV1S"), "S");
  assert.equal(jpSerieOfCode("EXTRA"), null); assert.equal(jpSerieOfCode("P"), null); assert.equal(jpSerieOfCode(""), null);
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
  assert.equal(speciesOf("Mew - R/RGB"), "Mew");                 // número no nome (TCGplayer) não é espécie
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
  assert.equal(jpSerieOfCode("BW1").setSerieId, "BW");   // era que a TCGdex ja não cobre: código da era (20/09/2026)
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

// ── Casamento por NOME (Classic Collection: numeração que não bate) ──────────
// 19/09/2026: a TCGdex numera a Classic Collection em sequência (001–030 no
// "30th Classic Collection", CC001–CC025 no de 2021) e o TCGplayer mantém o
// número ORIGINAL da carta reimpressa. Nenhum número batia, o groupFits não
// confirmava o grupo e o set inteiro ficava sem preço e sem imagem.
import { matchGroupByName, nameFits } from "../scripts/lib/tcgcsv-pokemon.mjs";

// O chunk é como a TCGdex publica; os produtos, como o TCGplayer vende (número
// original, e a mecânica decorando o nome).
const CC_CHUNK = [
  { id: "30th-c-001", number: "001", name: "Charizard" },
  { id: "30th-c-018", number: "018", name: "Gengar" },
  { id: "30th-c-019", number: "019", name: "Darkrai & Cresselia LEGEND" },
  { id: "30th-c-020", number: "020", name: "Darkrai & Cresselia LEGEND" },
  { id: "30th-c-022", number: "022", name: "Palkia" },
  { id: "30th-c-030", number: "030", name: "Magikarp" }
];
const prod = (id, nome, num) => ({ productId: id, name: nome, extendedData: [{ name: "Number", value: num }] });
const CC_PRODUTOS = [
  prod(901, "Charizard - 4/102", "4/102"),
  prod(902, "Gengar (Prime) - 94/123", "94/123"),
  prod(903, "Darkrai & Cresselia Legend (Top) - 99/113", "99/113"),
  prod(904, "Darkrai & Cresselia Legend (Bottom) - 100/113", "100/113"),
  prod(905, "Palkia LV.X - 106/106", "106/106"),
  prod(906, "Magikarp - 203/203", "203/203"),
  { productId: 907, name: "30th Celebration Classic Collection Booster Box" } // selado: sem Number, fica fora
];
const CC_PRECOS = [
  { productId: 901, subTypeName: "Holofoil", marketPrice: 120 },
  { productId: 902, subTypeName: "Holofoil", marketPrice: 40 },
  { productId: 905, subTypeName: "Holofoil", marketPrice: 25 }
];

test("casamento por nome: número diferente não impede, mecânica no nome não atrapalha", () => {
  const m = matchGroupByName(CC_CHUNK, CC_PRODUTOS, CC_PRECOS);
  // "Gengar (Prime)" = "Gengar" e "Palkia LV.X" = "Palkia" (ver cardNameKey).
  assert.equal(m.matched, 4);
  assert.equal(m.ourCount, 6);
  assert.ok(m.entries["30th-c-001"], "Charizard casou");
  assert.ok(m.entries["30th-c-018"], "Gengar (Prime) casou");
  assert.ok(m.entries["30th-c-022"], "Palkia LV.X casou");
  assert.equal(m.entries["30th-c-001"].u, 120);
  assert.match(m.entries["30th-c-022"].img, /901|905/);
  // Nome REPETIDO dos dois lados (as duas metades do LEGEND) fica de fora: sem
  // saber qual metade é qual, preço errado seria pior que preço nenhum.
  assert.equal(m.entries["30th-c-019"], undefined);
  assert.equal(m.entries["30th-c-020"], undefined);
  assert.equal(nameFits(m), true); // 4/6 ≥ metade
});

test("casamento por nome NUNCA sintetiza carta (o número de lá não vira id)", () => {
  const m = matchGroupByName(CC_CHUNK, CC_PRODUTOS, CC_PRECOS);
  assert.equal(m.misses, undefined);
  // Todo id devolvido é id NOSSO, do chunk — nenhum "30th-c-4" inventado do
  // número do TCGplayer (seria recriar a duplicata dentro do próprio set).
  const nossos = new Set(CC_CHUNK.map((c) => c.id));
  for (const id of Object.keys(m.entries)) assert.ok(nossos.has(id), `${id} veio do chunk`);
});

test("casamento por nome descarta o grupo ERRADO (poucos homônimos não confirmam)", () => {
  const outroSet = [
    prod(801, "Pikachu - 001/158", "001/158"), prod(802, "Raichu - 002/158", "002/158"),
    prod(803, "Charizard - 003/158", "003/158"), prod(804, "Exeggcute - 004/158", "004/158"),
    prod(805, "Exeggutor - 005/158", "005/158"), prod(806, "Nidoran F - 006/158", "006/158")
  ];
  const m = matchGroupByName(CC_CHUNK, outroSet, []);
  assert.equal(m.matched, 1);        // só o Charizard, que é homônimo
  assert.equal(nameFits(m), false);  // 1/6 não confirma nada
});

test("casamento por nome não roda em set importado inteiro (não há chunk)", () => {
  const m = matchGroupByName([], CC_PRODUTOS, CC_PRECOS);
  assert.deepEqual(m, { entries: {}, matched: 0, ourCount: 0 });
  assert.equal(nameFits(m), false);
});

test("pin `en` por NOME do grupo acha o grupo que o nome do set não acha", () => {
  const grupos = [
    { groupId: 25100, name: "ME: 30th Celebration" },
    { groupId: 25101, name: "ME: 30th Celebration Classic Collection" }
  ];
  // O nome do SET ("30th Classic Collection") não casa com o do grupo; o pin sim.
  assert.equal(candidateGroups({ id: "30th-c", name: "30th Classic Collection" }, indexGroupsByName(grupos)).length, 0);
  assert.equal(findImportGroup({ group: "ME: 30th Celebration Classic Collection" }, grupos).groupId, 25101);
});

// ── Janela de lançamento: set EN novo entra sozinho ─────────────────────────
// 19/09/2026: o pin `enImport` dependia de alguém ler o log do deploy e
// escrever o pin à mão — dois dias de atraso no 30th Celebration. A régua
// automática é estreita de propósito; estes testes travam o quão estreita.
import { autoImportGroups, autoImportSetId, autoImportEntry, isModernEnGroup } from "../scripts/lib/tcgcsv-pokemon.mjs";

const HOJE = Date.parse("2026-11-10T00:00:00Z");
const GRUPOS = [
  { groupId: 1, name: "ME: Delta Reign", publishedOn: "2026-11-06T00:00:00" },          // set novo: entra
  { groupId: 2, name: "ME: 30th Celebration", publishedOn: "2026-09-16T00:00:00" },     // já é nosso: fora
  { groupId: 3, name: "SWSH07: Evolving Skies", publishedOn: "2021-08-27T00:00:00" },   // antigo: fora
  { groupId: 4, name: "Celebrations: Classic Collection", publishedOn: "2026-11-01T00:00:00" }, // sem era: fora
  { groupId: 5, name: "SV10: Destined Rivals", publishedOn: "2026-10-20T00:00:00" },    // set novo: entra
  { groupId: 6, name: "Pokemon Sealed Product", publishedOn: "2026-11-02T00:00:00" }    // sem era: fora
];

test("janela: só era moderna, só recente, só o que não é nosso", () => {
  const r = autoImportGroups(GRUPOS, { usedIds: [2], existingIds: ["30th", "swsh7"], hoje: HOJE });
  assert.deepEqual(r.map((x) => `${x.group.groupId}:${x.setId}`), ["1:delta-reign", "5:destined-rivals"]);
});

test("janela: grupo já casado com set nosso nunca entra de novo", () => {
  // O groupId do set que já casou chega em usedIds — sem isso, o set entraria
  // duas vezes (uma pelo casamento, outra pela janela).
  const r = autoImportGroups(GRUPOS, { usedIds: [1, 2, 5], existingIds: [], hoje: HOJE });
  assert.deepEqual(r, []);
});

test("janela: a régua de data é o que impede importar a lista histórica de uma vez", () => {
  // Sem a janela, TODO grupo de era moderna que a TCGdex não tem viraria set no
  // primeiro build com a automação ligada.
  const semJanela = autoImportGroups(GRUPOS, { usedIds: [], existingIds: [], hoje: HOJE, janelaDias: 36500 });
  assert.equal(semJanela.length, 4); // 1, 2, 3 e 5
  const comJanela = autoImportGroups(GRUPOS, { usedIds: [], existingIds: [], hoje: HOJE });
  assert.equal(comJanela.length, 3); // o Evolving Skies de 2021 fica fora
  // Grupo sem data publicada não entra: não dá pra saber se é da janela.
  assert.deepEqual(autoImportGroups([{ groupId: 9, name: "ME: Sem Data" }], { usedIds: [], existingIds: [], hoje: HOJE }), []);
});

test("setId provisório: slug do nome, e colisão com set nosso cancela", () => {
  assert.equal(autoImportSetId("ME: Delta Reign", []), "delta-reign");
  assert.equal(autoImportSetId("SV10: Destined Rivals", ["sv10"]), "destined-rivals");
  // Id que já existe = o set já é nosso; importar de novo seria a duplicata.
  assert.equal(autoImportSetId("ME: Delta Reign", ["delta-reign"]), "");
  assert.equal(autoImportSetId("ME:", []), "");
});

test("entry automático tira o código de era do nome e herda a série", () => {
  const e = autoImportEntry({ groupId: 1, name: "ME: Delta Reign" }, "delta-reign");
  assert.equal(e.name, "Delta Reign");
  assert.equal(e.serie, "me");
  assert.equal(e.setId, "delta-reign");
  assert.equal(importSetFields(e, { name: "ME: Delta Reign" }).setSerieName, "Mega Evolution");
  assert.equal(autoImportEntry({ name: "SV10: Destined Rivals" }, "x").serie, "sv");
});

test("isModernEnGroup: o filtro de nome que abre a janela", () => {
  assert.equal(isModernEnGroup("ME: 30th Celebration"), true);
  assert.equal(isModernEnGroup("SV09: Journey Together"), true);
  assert.equal(isModernEnGroup("SWSH12: Silver Tempest"), true);
  assert.equal(isModernEnGroup("Celebrations: Classic Collection"), false);
  assert.equal(isModernEnGroup("Pokemon Sealed Product"), false);
  assert.equal(isModernEnGroup(""), false);
});

// Mew RGB da 30th Celebration (23/09/2026): "R/RGB", "G/RGB", "B/RGB" no lugar
// do número. O set EN já tinha chunk (TCGdex), a guarda de numeração recusava
// letra sem dígito e as três cartas nunca entravam; o PT nem fonte tem.
test("extraNumbers: Mew RGB passa pela guarda só com o pin, e nasce em EN e PT", () => {
  const pins = { extraNumbers: { "30th": { numbers: "^[RGB]$", mirror: ["pt"] } } };
  const extra = extraNumbersOf(pins, "30th");
  const prefixes = new Set([""]);
  assert.equal(missAllowed("R/RGB", prefixes), false);          // sem pin: recusa (como antes)
  assert.equal(missAllowed("R/RGB", prefixes, extra), true);
  assert.equal(missAllowed("R", prefixes, extra), true);         // o merge só tem o numerador
  assert.equal(missAllowed("X/RGB", prefixes, extra), false);    // o pin não abre a porta pra qualquer letra
  assert.equal(missAllowed("227/S-P", prefixes, extra), true);   // numérico segue a régua de sempre
  assert.equal(extraNumbersOf(pins, "sv01"), null);
  assert.deepEqual(mirrorLangsOf(pins, "30th"), ["pt"]);
  assert.deepEqual(mirrorLangsOf(pins, "sv01"), []);

  const chunk = [{ id: "30th-001", number: "001", rarity: "Common", image: "x" }, { id: "30th-065", number: "065", rarity: "Rare", image: "x" }];
  const prods = [
    { productId: 1, name: "Exeggcute - 001/128", extendedData: [{ name: "Number", value: "001/128" }] },
    { productId: 717607, name: "Mew - R/RGB", extendedData: [{ name: "Number", value: "R/RGB" }, { name: "Rarity", value: "RGB Rare" }] }
  ];
  const prices = [{ productId: 717607, subTypeName: "Holofoil", marketPrice: 20000 }];
  assert.equal(matchGroup(chunk, prods, prices, { setId: "30th", lang: "en" }).misses.length, 0);
  const m = matchGroup(chunk, prods, prices, { setId: "30th", lang: "en", extraNumbers: extra });
  assert.equal(m.misses.length, 1);

  const sib = { set: "30th Celebration", setId: "30th", setTotal: 128, setSerieId: "me", setSerieName: "Mega Evolution", setReleaseDate: "2026-09-16" };
  const miss = m.misses[0];
  const en = synthesizeCard({ product: miss.product, price: miss.price, img: miss.img, setId: "30th", lang: "en", sib, revNames: { mew: 151 }, variants: miss.variants });
  assert.equal(en.id, "30th-R");
  assert.equal(en.number, "R");
  assert.equal(en.name, "Mew - R/RGB");
  assert.equal(en.dexId, 151);                                   // entra na página do Mew
  assert.deepEqual(en.variants, ["Holo"]);
  assert.ok(en.price && en.price.u > 0);

  const ptSib = { set: "Celebração de 30 Anos", setTotal: 128, setSerieId: "me", setSerieName: "Megaevolução", setReleaseDate: "2026-09-16" };
  const pt = mirrorCard(en, "pt", ptSib);
  assert.equal(pt.id, "30th-R-pt");
  assert.equal(pt.language, "pt");
  assert.equal(pt.set, "Celebração de 30 Anos");
  assert.equal(pt.setSerieName, "Megaevolução");
  assert.equal(pt.image, en.image);
  assert.equal(pt.price, undefined);                             // preço do TCGplayer é da impressão EN
  assert.ok(en.price);                                           // e a carta EN segue com o dela
});
