// Testes do sync do Final Fantasy TCG (scripts/sync-fftcg.mjs), sem rede: o
// setId fixo por groupId (a abreviação da TCGCSV erra e repete), o número
// dominante pro grupo novo, o número que sai do nome e o mapeamento de campo
// do produto. Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { setIdOf, numeroDominante, nomeDaCarta, cardOf, ABREV_FIXA, DATA_FIXA } from "../scripts/sync-fftcg.mjs";

test("setId: pin por groupId vale mais que a abreviação da fonte", () => {
  assert.equal(setIdOf({ groupId: 1939, abbreviation: "OP1" }), "OP1");
  // Journey of Discovery: a fonte diz "28", a carta imprime 27-xxx.
  assert.equal(setIdOf({ groupId: 24481, abbreviation: "28" }), "OP27");
  assert.equal(setIdOf({ groupId: 24576, abbreviation: "28" }), "OP28");
  // Os dois "30": o booster e o starter.
  assert.equal(setIdOf({ groupId: 24788, abbreviation: "30" }), "OP30");
  assert.equal(setIdOf({ groupId: 24742, abbreviation: "30" }), "ST30");
  assert.equal(setIdOf({ groupId: 22894, abbreviation: "" }), "BD7");
  assert.equal(setIdOf({ groupId: 24187, abbreviation: "LGC" }), "RE");
});

test("setId: grupo novo sem pin cai no número que a maioria das cartas imprime", () => {
  // O Opus 31, com uma reimpressão Full Art de outro set no meio.
  const nums = ["31-001H", "31-002C", "20-077L", "31-003R"];
  assert.equal(numeroDominante(nums), "31");
  assert.equal(setIdOf({ groupId: 99001, name: "Opus 31", abbreviation: "31" }, nums), "OP31");
  // O starter do mesmo Opus imprime o mesmo 31: vira ST31, e se o nome não
  // disser "Starter", o grupoId desempata.
  assert.equal(setIdOf({ groupId: 99002, name: "Starter Set: Ivalice", abbreviation: "31" }, ["31-001L"]), "ST31");
  assert.equal(setIdOf({ groupId: 99003, name: "Deck X", abbreviation: "" }, ["31-001L"], new Set(["OP31"])), "OP31-99003");
  // Promos: reimpressões de vários sets, nenhum com maioria -> abreviação.
  const promos = ["PR-210", "PR-211/30-001H", "PR-212"];
  assert.equal(numeroDominante(promos), "");
  assert.equal(setIdOf({ groupId: 99004, name: "Promo 2027", abbreviation: "P27" }, promos), "P27");
  assert.equal(setIdOf({ groupId: 99005, name: "X", abbreviation: " " }, promos), "G99005");
  // Pin já usado por outro grupo não se repete.
  assert.equal(setIdOf({ groupId: 99006, name: "Y", abbreviation: "PR" }, promos, new Set(Object.values(ABREV_FIXA))), "PR-99006");
});

test("setId: os pins são únicos e cabem num nome de arquivo", () => {
  const ids = Object.values(ABREV_FIXA);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[A-Z0-9-]+$/);
});

test("data: o Deck Exclusive Cards não vira lançamento de 11/11/2026", () => {
  const p = { productId: 1, name: "Quina - 3-133C", extendedData: [{ name: "Number", value: "3-133C" }] };
  const { card } = cardOf(p, { groupId: 2362, name: "Deck Exclusive Cards", publishedOn: "2026-11-11T00:00:00" }, "DEC", 113);
  assert.equal(card.setReleaseDate, DATA_FIXA[2362]);
  assert.equal(card.name, "Quina");
});

test("nome: o número desta carta sai do nome, em todas as grafias da fonte", () => {
  assert.equal(nomeDaCarta("Black Mage (Arc) - 1-010C", "1-010C"), "Black Mage (Arc)");
  assert.equal(nomeDaCarta("Black Mage (2-033C)", "2-033C"), "Black Mage");
  assert.equal(nomeDaCarta("Kain - PR-009/2-103H (Alternate Art Promo)", "PR-009/2-103H"), "Kain (Alternate Art Promo)");
  assert.equal(nomeDaCarta("Warrior of Light (PR-171)(JP)", "PR-171"), "Warrior of Light (JP)");
  assert.equal(nomeDaCarta("Warrior of Light LB (PR-200/24-120R) (Gold)", "PR-200/24-120R"), "Warrior of Light LB (Gold)");
  assert.equal(nomeDaCarta("Lightning (Prerelease Promo) (PR-206/28-093H)", "PR-206/28-093H"), "Lightning (Prerelease Promo)");
  assert.equal(nomeDaCarta("Zidane - 8-115L (Full Art)", "8-115L"), "Zidane (Full Art)");
  assert.equal(nomeDaCarta("Aerith (Full Art) - PR-157", "PR-157"), "Aerith (Full Art)");
  // Só uma das partes do número aparece no nome, ou com outra caixa.
  assert.equal(nomeDaCarta("Yuri (PR-078)", "PR-078/7-128H"), "Yuri");
  assert.equal(nomeDaCarta("Nine - 3-113R", "PR-018/3-113R"), "Nine");
  assert.equal(nomeDaCarta("Golbez (PR-205/25-118H)", "25-118H"), "Golbez");
  assert.equal(nomeDaCarta("Ifrit (PR-178/20-003H)", "Pr-178/20-003H"), "Ifrit");
  assert.equal(nomeDaCarta("Venat (PR165/23-115L)", "PR165/23-115L"), "Venat");
  assert.equal(nomeDaCarta("Sephiroth (B-028)", "B-028"), "Sephiroth");
  // O nome traz o número sem a letra da raridade.
  assert.equal(nomeDaCarta("Lightning - 13-081 (Full Art)", "13-081H"), "Lightning (Full Art)");
  // Qualificador que não é número fica: o TCGplayer separa homônimas assim.
  assert.equal(nomeDaCarta("Auron (Hero)", "1-001H"), "Auron (Hero)");
  assert.equal(nomeDaCarta("Shantotto (XI)", "2-123L"), "Shantotto (XI)");
  assert.equal(nomeDaCarta("Machina (Type-0)", "4-050H"), "Machina (Type-0)");
  // Número de OUTRA carta no nome: fica como veio (dado não se inventa).
  assert.equal(nomeDaCarta("Cloud - 8-006L (Noir Promo)", "8-143S"), "Cloud - 8-006L (Noir Promo)");
  assert.equal(nomeDaCarta("Yuna (1-117R)", "1-177R"), "Yuna (1-117R)");
  assert.equal(nomeDaCarta("Tifa", ""), "Tifa");
});

const PRODUTO = {
  productId: 132375,
  name: "Auron (Hero)",
  extendedData: [
    { name: "Rarity", value: "Hero" }, { name: "Number", value: "1-001H" },
    { name: "Description", value: "..." }, { name: "CardType", value: "Forward" },
    { name: "Element", value: "Fire" }, { name: "Cost", value: "5" },
    { name: "Power", value: "9000" }, { name: "Job", value: "Guardian" },
    { name: "Category", value: "X" }
  ]
};
const GRUPO = { groupId: 1939, name: "Opus I", publishedOn: "2017-05-30T00:00:00" };

test("carta: id do productId, campos do jogo e imagem grande do CDN", () => {
  const { card, price } = cardOf(PRODUTO, GRUPO, "OP1", 217, new Map([["Normal", 0.5], ["Foil", 2.25]]));
  assert.equal(card.id, "fftcg-132375");
  assert.equal(card.name, "Auron (Hero)");
  assert.equal(card.set, "Opus I");
  assert.equal(card.setId, "OP1");
  assert.equal(card.number, "1-001H");
  assert.equal(card.setTotal, 217);
  assert.equal(card.setReleaseDate, "2017-05-30");
  assert.equal(card.rarity, "Hero");
  assert.equal(card.language, "en");
  assert.equal(card.image, "https://tcgplayer-cdn.tcgplayer.com/product/132375_in_1000x1000.jpg");
  assert.deepEqual(card.variants, ["Normal", "Foil"]);
  assert.equal(card.cardType, "Forward");
  assert.equal(card.color, "Fire");
  assert.equal(card.cost, "5");
  assert.equal(card.series, "X");
  assert.deepEqual(price, { u: 0.5, uf: 2.25 });
});

test("carta: promo genérica perde o 'FF:' do set; Boss Deck fica sem raridade", () => {
  const promo = cardOf(PRODUTO, { groupId: 1941, name: "FF: Promo Cards", publishedOn: "2017-06-07" }, "PR", 235).card;
  assert.equal(promo.set, "Promo Cards");
  const boss = { productId: 2, name: "Zalera, the Death Seraph", extendedData: [{ name: "Rarity", value: "None" }, { name: "Number", value: "B-027" }, { name: "Element", value: "Dark" }] };
  const { card, price } = cardOf(boss, { groupId: 2774, name: "Boss Deck: Chaos", publishedOn: "2021-03-05" }, "BDC", 28, new Map(), new Set(["Foil"]));
  assert.equal(card.rarity, "");
  assert.equal(card.set, "Boss Deck: Chaos");
  assert.equal(price, null);
  assert.deepEqual(card.variants, ["Foil"]); // acabamento listado sem preço ainda vira variante
  assert.equal(card.cardType, null);
  assert.equal(card.cost, null);
});
