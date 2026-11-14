// Testes do sync do Shadowverse: Evolve (scripts/sync-shadowverse.mjs), sem
// rede: o setId pela abreviação, o nome do set sem o código (menos onde o
// título repete), o número que sai do nome da carta e o mapeamento de campo.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { setIdOf, codigoETitulo, nomesDosSets, nomeDaCarta, cardOf } from "../scripts/sync-shadowverse.mjs";

test("setId: a abreviação da fonte, que é o código impresso", () => {
  assert.equal(setIdOf({ groupId: 23037, abbreviation: "BP01", name: "BP01: Advent of Genesis" }), "BP01");
  assert.equal(setIdOf({ groupId: 23044, abbreviation: "SVPR", name: "Shadowverse: Evolve Promo Cards" }), "SVPR");
  assert.equal(setIdOf({ groupId: 24772, abbreviation: "GFE", name: "Gloryfinder Events" }), "GFE");
  // Sem abreviação: o código do nome; sem nenhum dos dois, o groupId.
  assert.equal(setIdOf({ groupId: 99001, abbreviation: "", name: "BP30: Algum Set" }), "BP30");
  assert.equal(setIdOf({ groupId: 99002, abbreviation: "", name: "Sem Código" }), "G99002");
  // Código repetido não colide.
  assert.equal(setIdOf({ groupId: 99003, abbreviation: "BP01" }, new Set(["BP01"])), "BP01-99003");
});

test("nome do set: sem o código na frente e sem o nome do jogo", () => {
  assert.deepEqual(codigoETitulo("BP01: Advent of Genesis"), ["BP01", "Advent of Genesis"]);
  assert.deepEqual(codigoETitulo("CSD01: Ready, Set, Umamusume!"), ["CSD01", "Ready, Set, Umamusume!"]);
  // Não é código: fica inteiro.
  assert.deepEqual(codigoETitulo("Gloryfinder Events"), ["", "Gloryfinder Events"]);
  assert.deepEqual(codigoETitulo("Shadowverse: Evolve Promo Cards"), ["", "Shadowverse: Evolve Promo Cards"]);
  const nomes = nomesDosSets([
    { groupId: 1, name: "BP01: Advent of Genesis" },
    { groupId: 2, name: "Shadowverse: Evolve Promo Cards" },
    { groupId: 3, name: "SDD01: Showdown Deck: Forestcraft" }
  ]);
  assert.equal(nomes.get(1), "Advent of Genesis");
  assert.equal(nomes.get(2), "Promo Cards");
  assert.equal(nomes.get(3), "Showdown Deck: Forestcraft");
});

test("nome do set: título repetido guarda o nome inteiro, com o código", () => {
  const nomes = nomesDosSets([
    { groupId: 23343, name: "CP01: Umamusume: Pretty Derby" },
    { groupId: 24504, name: "ECP01: Umamusume: Pretty Derby" },
    { groupId: 23360, name: "CSD01: Ready, Set, Umamusume!" }
  ]);
  assert.equal(nomes.get(23343), "CP01: Umamusume: Pretty Derby");
  assert.equal(nomes.get(24504), "ECP01: Umamusume: Pretty Derby");
  assert.equal(nomes.get(23360), "Ready, Set, Umamusume!");
});

test("nome da carta: o número desta carta sai, o resto fica", () => {
  assert.equal(nomeDaCarta("Cannon Volley - P10EN (Foil)", "BP19-P10EN"), "Cannon Volley (Foil)");
  assert.equal(nomeDaCarta("Alwida's Command - P06 (Foil)", "BP01-P06EN"), "Alwida's Command (Foil)");
  assert.equal(nomeDaCarta("Forest Bat - PR-092EN", "PR-092EN"), "Forest Bat");
  assert.equal(nomeDaCarta("Blazing Breath - PR-123", "PR-123EN"), "Blazing Breath");
  assert.equal(nomeDaCarta("Maid Leader (GFB01a-038EN)", "GFB01a-038EN"), "Maid Leader");
  assert.equal(nomeDaCarta("Powers Converged (SL24EN) (SL)", "CP03-SL24EN"), "Powers Converged (SL)");
  // Qualificador de versão fica.
  assert.equal(nomeDaCarta("Drazael, Ravening Enforcer (Evolved) (SL)", "BP19-SL16EN"), "Drazael, Ravening Enforcer (Evolved) (SL)");
  // Número que NÃO é o desta carta fica como a fonte gravou.
  assert.equal(nomeDaCarta("Servant of Destruction (Evolved) - P22EN (Foil)", "BP05-P23EN"), "Servant of Destruction (Evolved) - P22EN (Foil)");
  // Hífen do próprio nome não é número.
  assert.equal(nomeDaCarta("Angel - Devil", "BP01-001EN"), "Angel - Devil");
});

const GRUPO = { groupId: 23037, name: "BP01: Advent of Genesis", publishedOn: "2023-06-30T00:00:00" };
const PRODUTO = {
  productId: 502257,
  name: "White General",
  extendedData: [
    { name: "Rarity", value: "Silver" }, { name: "Number", value: "SD02-006EN" },
    { name: "Class", value: "Swordcraft" }, { name: "CardType", value: "Follower" },
    { name: "Trait", value: "Commander" }, { name: "Cost", value: "4" },
    { name: "Attack", value: "5" }, { name: "Defense", value: "3" }
  ]
};

test("carta: id do productId com prefixo shv-, campos do jogo e imagem grande do CDN", () => {
  const { card, price } = cardOf(PRODUTO, GRUPO, "BP01", "Advent of Genesis", 273, new Map([["Normal", 0.25]]));
  assert.equal(card.id, "shv-502257"); // "sve-" é do set Scarlet & Violet Energies do Pokémon
  assert.equal(card.name, "White General");
  assert.equal(card.set, "Advent of Genesis");
  assert.equal(card.setId, "BP01");
  assert.equal(card.number, "SD02-006EN");
  assert.equal(card.setTotal, 273);
  assert.equal(card.setReleaseDate, "2023-06-30");
  assert.equal(card.rarity, "Silver");
  assert.equal(card.language, "en");
  assert.equal(card.image, "https://tcgplayer-cdn.tcgplayer.com/product/502257_in_1000x1000.jpg");
  assert.deepEqual(card.variants, ["Normal"]);
  assert.equal(card.cardType, "Follower");
  assert.equal(card.color, "Swordcraft");
  assert.equal(card.trait, "Commander");
  assert.equal(card.cost, "4");
  assert.equal(card.attack, "5");
  assert.equal(card.defense, "3");
  assert.deepEqual(price, { u: 0.25 });
});

test("carta: token vem com raridade None e sem preço", () => {
  const token = { productId: 9, name: "Knight", extendedData: [{ name: "Number", value: "BP19-T04EN" }, { name: "Rarity", value: "None" }, { name: "CardType", value: "Follower;Token" }] };
  const { card, price } = cardOf(token, GRUPO, "BP19", "Eightfold Retribution", 229);
  assert.equal(card.rarity, "");
  assert.equal(card.cardType, "Follower;Token");
  assert.equal(card.color, null);
  assert.equal(price, null);
});
