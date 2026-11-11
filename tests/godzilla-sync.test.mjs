// Testes do sync do Godzilla Card Game (scripts/sync-godzilla.mjs), sem rede:
// o setId fixo por groupId (a TCGCSV deixou a abreviação vazia em dois grupos
// e chama as promos de "PR"), o código dominante pro grupo novo, o número que
// sai do nome e o mapeamento de campo do produto. Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { setIdOf, codigoDominante, nomeDaCarta, cardOf, ABREV_FIXA } from "../scripts/sync-godzilla.mjs";

test("setId: pin por groupId vale mais que a abreviação da fonte", () => {
  assert.equal(setIdOf({ groupId: 24337, abbreviation: "EBP01" }), "EBP01");
  assert.equal(setIdOf({ groupId: 24641, abbreviation: "" }), "EBP04");      // abreviação vazia na fonte
  assert.equal(setIdOf({ groupId: 24674, abbreviation: "" }), "ESC01");      // o Sleeve & Card Set
  // A carta imprime EPR-005; a fonte abrevia "PR". E preencher depois não muda.
  assert.equal(setIdOf({ groupId: 24431, abbreviation: "PR" }), "EPR");
  assert.equal(setIdOf({ groupId: 24641, abbreviation: "BP04" }), "EBP04");
});

test("setId: grupo novo sem pin cai no código que a maioria das cartas imprime", () => {
  // O Booster Set #5 de dezembro de 2026, com as Rage de sempre (não votam,
  // mas contam no total).
  const nums = ["EBP05-001", "EBP05-001+", "EBP05-002", "EGZ30", "E13", "EBP05-003"];
  assert.equal(setIdOf({ groupId: 99001, abbreviation: "" }, nums), "EBP05");
  assert.equal(codigoDominante(["ESD03-001", "ESD03-002", "EBP01-010+"]), "ESD03");
  // Promos: reimpressões de vários sets, nenhum com maioria -> abreviação.
  const promos = ["ESD01-005+", "EBP01-001+", "EPR-015", "EBP02-007+"];
  assert.equal(codigoDominante(promos), "");
  assert.equal(setIdOf({ groupId: 99002, abbreviation: "PR2" }, promos), "PR2");
  assert.equal(setIdOf({ groupId: 99003, abbreviation: " " }, promos), "G99003");
  assert.equal(setIdOf({ groupId: 99004, abbreviation: "P26" }, promos, new Map([["P26", 2]])), "P26-99004");
});

test("setId: os pins são únicos e cabem num nome de arquivo", () => {
  const ids = Object.values(ABREV_FIXA);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[A-Z0-9-]+$/);
});

test("nome: o número desta carta sai do nome; o ano e o produto ficam", () => {
  assert.equal(nomeDaCarta("Godzilla (1954) (EBP01-001)", "EBP01-001"), "Godzilla (1954)");
  assert.equal(nomeDaCarta("Godzilla (1954) (EBP01-001+)", "EBP01-001+"), "Godzilla (1954)");
  assert.equal(nomeDaCarta("Rage(EGZ10)", "EGZ10"), "Rage");
  // Booster Set 1: o número da Rage vem com o tipo na frente.
  assert.equal(nomeDaCarta("Rage (EGZ01+)", "Rage-EGZ01+"), "Rage");
  assert.equal(nomeDaCarta("Godzilla (1992) (ESD02-003+) (Promotion Pack Vol.1)", "ESD02-003+"),
    "Godzilla (1992) (Promotion Pack Vol.1)");
  // Na paralela "+", o "(EBP01-001)" da base NÃO casa com o número dela, e
  // vice-versa: o "+" é parte do número, não curinga de regex.
  assert.equal(nomeDaCarta("Godzilla (1954) (EBP01-001)", "EBP01-001+"), "Godzilla (1954) (EBP01-001)");
  // Nome e número divergentes na fonte: fica como veio (dado não se inventa).
  assert.equal(nomeDaCarta("Godzilla (2023) (ESD01-007+)", "ESD01-007"), "Godzilla (2023) (ESD01-007+)");
  assert.equal(nomeDaCarta("Heat Ray", ""), "Heat Ray");
});

const PRODUTO = {
  productId: 645822,
  name: "Godzilla (1954) (EBP01-001+)",
  extendedData: [
    { name: "Rarity", value: "SP" }, { name: "Number", value: "EBP01-001+" },
    { name: "Color", value: "Red" }, { name: "CardType", value: "Monster" },
    { name: "Threat Level", value: "5000" }, { name: "Traits", value: "Godzilla" },
    { name: "Invade", value: "1" }, { name: "Rank", value: "I" }
  ]
};
const GRUPO = { groupId: 24337, name: "Booster Set 1: Godzilla VS. Godzilla", publishedOn: "2025-07-05T00:00:00" };

test("carta: id do productId, campos do jogo e imagem grande do CDN", () => {
  const { card, price } = cardOf(PRODUTO, GRUPO, "EBP01", 184, new Map([["Foil", 12.5]]));
  assert.equal(card.id, "gzc-645822");
  assert.equal(card.name, "Godzilla (1954)");
  assert.equal(card.set, "Booster Set 1: Godzilla VS. Godzilla"); // o "Godzilla" do set fica
  assert.equal(card.setId, "EBP01");
  assert.equal(card.number, "EBP01-001+");
  assert.equal(card.setTotal, 184);
  assert.equal(card.setReleaseDate, "2025-07-05");
  assert.equal(card.rarity, "SP");
  assert.equal(card.language, "en");
  assert.equal(card.image, "https://tcgplayer-cdn.tcgplayer.com/product/645822_in_1000x1000.jpg");
  assert.deepEqual(card.variants, ["Foil"]);
  assert.equal(card.cardType, "Monster");
  assert.equal(card.color, "Red");
  assert.equal(card.rank, "I");
  assert.equal(card.traits, "Godzilla");
  assert.deepEqual(price, { u: 12.5, uf: 12.5 });
});

test("carta: acabamento listado sem preço ainda vira variante", () => {
  const { card, price } = cardOf(PRODUTO, GRUPO, "EBP01", 184, new Map(), new Set(["Foil"]));
  assert.equal(price, null);
  assert.deepEqual(card.variants, ["Foil"]);
});

test("carta: Rage sem CardType na fonte é Rage pelo nome; multicor fica com ';'", () => {
  const rage = { productId: 659565, name: "Rage (E02)", extendedData: [{ name: "Rarity", value: "C" }, { name: "Number", value: "E02" }] };
  const { card } = cardOf(rage, GRUPO, "EBP02", 235, new Map([["Normal", 0.21]]));
  assert.equal(card.name, "Rage");
  assert.equal(card.cardType, "Rage");
  assert.equal(card.color, null);
  assert.equal(card.rank, null);
  const duas = { productId: 1, name: "X (EBP03-100)", extendedData: [{ name: "Number", value: "EBP03-100" }, { name: "Color", value: "Red;Blue" }] };
  assert.equal(cardOf(duas, GRUPO, "EBP03", 191).card.color, "Red;Blue");
  assert.deepEqual(cardOf(duas, GRUPO, "EBP03", 191).card.variants, ["Normal"]);
});

test("carta: Normal e Foil com preço vão pra u e uf", () => {
  const { card, price } = cardOf(PRODUTO, GRUPO, "EBP01", 184, new Map([["Foil", 9], ["Normal", 0.5]]));
  assert.deepEqual(price, { u: 0.5, uf: 9 });
  assert.deepEqual(card.variants, ["Normal", "Foil"]);
});
