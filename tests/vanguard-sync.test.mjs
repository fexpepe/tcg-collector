// Testes do sync do Cardfight!! Vanguard (scripts/sync-vanguard.mjs), sem
// rede: o setId do código impresso que abre o nome do grupo, o título sem o
// código (menos onde ele repete), o número que sai do nome da carta e a
// limpeza dos campos que a fonte grafa de dezenas de jeitos.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { codigoETitulo, setIdOf, nomesDosSets, nomeDaCarta, tipoDaCarta, gatilhoDaCarta, raridadeDaCarta, cardOf } from "../scripts/sync-vanguard.mjs";

test("código e título: as quatro grafias do nome do grupo", () => {
  assert.deepEqual(codigoETitulo("DZ-BT16: Parallactic Dawn"), ["DZ-BT16", "Parallactic Dawn"]);
  assert.deepEqual(codigoETitulo("V-BT02 : Strongest! Team AL4"), ["V-BT02", "Strongest! Team AL4"]);
  assert.deepEqual(codigoETitulo("EB12 - Waltz of the Goddess"), ["EB12", "Waltz of the Goddess"]);
  assert.deepEqual(codigoETitulo("V-SS10 Premium Battle Deckset 2023"), ["V-SS10", "Premium Battle Deckset 2023"]);
  // Sem código: o número do trial deck e o "Vol." não são código.
  assert.deepEqual(codigoETitulo("Trial Deck 14: Seeker of Hope"), ["", "Trial Deck 14: Seeker of Hope"]);
  assert.deepEqual(codigoETitulo("G-Legend Deck Vol.3: The Blaster"), ["", "G-Legend Deck Vol.3: The Blaster"]);
  assert.deepEqual(codigoETitulo("D Promo Cards"), ["", "D Promo Cards"]);
  assert.deepEqual(codigoETitulo("Moonlit Dragonfang"), ["", "Moonlit Dragonfang"]);
});

test("setId: o código do nome vale mais que a abreviação da fonte", () => {
  // A fonte perde o prefixo da era em 6 grupos.
  assert.equal(setIdOf({ groupId: 1, name: "DZ-SS04: Special Series Stardust Blade", abbreviation: "SSSB" }), "DZ-SS04");
  assert.equal(setIdOf({ groupId: 2, name: "D-SS04: Stride Deckset - Messiah", abbreviation: "SS04" }), "D-SS04");
  // Sem código no nome: a abreviação; a barra vira hífen.
  assert.equal(setIdOf({ groupId: 3, name: "Trial Deck 14: Seeker of Hope", abbreviation: "TD14" }), "TD14");
  assert.equal(setIdOf({ groupId: 4, name: "Kero Kero Ace Pack", abbreviation: "KA1/2" }), "KA1-2");
  assert.equal(setIdOf({ groupId: 5, name: "V Promo Cards", abbreviation: "VPR" }), "VPR");
  // Grupo novo que chega sem abreviação e sem código; e id que já foi tomado.
  assert.equal(setIdOf({ groupId: 99001, name: "Mystery Pack", abbreviation: "" }), "G99001");
  assert.equal(setIdOf({ groupId: 99002, name: "DZ-BT16: Outro", abbreviation: "" }, new Set(["DZ-BT16"])), "DZ-BT16-99002");
});

test("nome do set: sem o código, menos onde o título repete", () => {
  const nomes = nomesDosSets([
    { groupId: 1, name: "DZ-BT16: Parallactic Dawn" },
    { groupId: 2, name: "D-TB03: Shaman King" },
    { groupId: 3, name: "D-TTD03: Shaman King" },
    { groupId: 4, name: "Trial Deck 1: Blaster Blade" },
    { groupId: 5, name: "D Promo Cards" }
  ]);
  assert.equal(nomes.get(1), "Parallactic Dawn");
  // Booster e trial deck da mesma colaboração: os dois guardam o código.
  assert.equal(nomes.get(2), "D-TB03: Shaman King");
  assert.equal(nomes.get(3), "D-TTD03: Shaman King");
  assert.equal(nomes.get(4), "Trial Deck 1: Blaster Blade");
  assert.equal(nomes.get(5), "D Promo Cards");
  assert.equal(new Set(nomes.values()).size, 5);
});

test("nome da carta: o número desta carta sai, o qualificador fica", () => {
  assert.equal(nomeDaCarta("Enjoy Summer Days! Holly (184)", "D-PR/184EN"), "Enjoy Summer Days! Holly");
  assert.equal(nomeDaCarta("Enjoy Summer Days! Holly (184) (Foil)", "D-PR/184EN"), "Enjoy Summer Days! Holly (Foil)");
  assert.equal(nomeDaCarta("Energy (SER) (DZ-BT09/SER01EN)", "DZ-BT09/SER01EN"), "Energy (SER)");
  assert.equal(nomeDaCarta("Angelic Wiseman (0271EN)", "V-PR/0271EN"), "Angelic Wiseman");
  assert.equal(nomeDaCarta("Imperial Shrine Guard, Nozuchi (209)", "V-PR/0209EN 2022"), "Imperial Shrine Guard, Nozuchi");
  // Dígito que não é o número (o ano, a versão de uma paralela) fica.
  assert.equal(nomeDaCarta("Imaginary Gift [Force] - Happy Holidays (2020)", "VG-2020/TOYOU"), "Imaginary Gift [Force] - Happy Holidays (2020)");
  assert.equal(nomeDaCarta("Blaster Blade (1)", "DZ-BT16/FR01EN"), "Blaster Blade (1)");
  assert.equal(nomeDaCarta("Blaster Blade (SP)", "BT01/S01EN"), "Blaster Blade (SP)");
  assert.equal(nomeDaCarta("Blaster Blade", ""), "Blaster Blade");
});

test("tipo, gatilho e raridade: uma grafia só", () => {
  for (const s of ["Normal", "Normal Unit", "Nornal", "Nornmal", "Nomral", "normal", "Unit", "Normal Unit, Ultimate Skill"]) assert.equal(tipoDaCarta(s), "Normal Unit", s);
  for (const s of ["Trigger", "Trigger Unit"]) assert.equal(tipoDaCarta(s), "Trigger Unit", s);
  for (const s of ["G", "G Unit", "G-Unit"]) assert.equal(tipoDaCarta(s), "G Unit", s);
  for (const s of ["G-Guardian", "G Guardian"]) assert.equal(tipoDaCarta(s), "G Guardian", s);
  assert.equal(tipoDaCarta("Normal Order Zeus"), "Normal Order");
  assert.equal(tipoDaCarta("Set Order/Research"), "Set Order");
  assert.equal(tipoDaCarta("Set order"), "Set Order");
  assert.equal(tipoDaCarta("Blitz Order Cursed Play"), "Blitz Order");
  assert.equal(tipoDaCarta("Token Set Order"), "Set Order");
  assert.equal(tipoDaCarta("Trigger Order Spell"), "Trigger Order");
  assert.equal(tipoDaCarta("Ride Deck Creast"), "Crest");
  assert.equal(tipoDaCarta("Imaginary Gift"), "Gift Marker");
  for (const s of ["", "None", "2", "Star-vader, Dark Band Dragon"]) assert.equal(tipoDaCarta(s), null, s);

  assert.equal(gatilhoDaCarta("Critical Trigger +10000"), "Critical");
  assert.equal(gatilhoDaCarta("Critcal"), "Critical");
  assert.equal(gatilhoDaCarta("Citical"), "Critical");
  assert.equal(gatilhoDaCarta("Dront"), "Front");
  assert.equal(gatilhoDaCarta("Over Trigger +100,000,000"), "Over");
  // Ícone de habilidade no campo errado não é gatilho.
  for (const s of ["", "None", "Boost", "Intercept", "Twin Drive!!", "10000"]) assert.equal(gatilhoDaCarta(s), null, s);

  assert.equal(raridadeDaCarta("Frame Rare"), "FR");
  assert.equal(raridadeDaCarta("Double Frame Rare"), "FFR");
  assert.equal(raridadeDaCarta("Trial Deck Rare"), "TDR");
  assert.equal(raridadeDaCarta("Gift Marker"), "");
  assert.equal(raridadeDaCarta("RRR"), "RRR");
});

const PRODUTO = {
  productId: 727149,
  name: "Moonflower Stealth Princess, Lisciafael \"Fantome\"",
  extendedData: [
    { name: "Number", value: "DZ-BT16/001EN" }, { name: "Rarity", value: "RRR" },
    { name: "Unit", value: "Normal Unit" }, { name: "Grade", value: "3" },
    { name: "Nation", value: "Dragon Empire" }, { name: "Power", value: "13000" },
    { name: "Description", value: "..." }
  ]
};
const GRUPO = { groupId: 24795, name: "DZ-BT16: Parallactic Dawn", publishedOn: "2026-10-30T00:00:00" };

test("carta: id do productId, campos do jogo e imagem grande do CDN", () => {
  const { card, price } = cardOf(PRODUTO, GRUPO, "DZ-BT16", "Parallactic Dawn", 326, new Map([["Normal", 63.3]]));
  assert.equal(card.id, "vg-727149");
  assert.equal(card.set, "Parallactic Dawn");
  assert.equal(card.setId, "DZ-BT16");
  assert.equal(card.number, "DZ-BT16/001EN");
  assert.equal(card.setTotal, 326);
  assert.equal(card.setReleaseDate, "2026-10-30");
  assert.equal(card.rarity, "RRR");
  assert.equal(card.language, "en");
  assert.equal(card.image, "https://tcgplayer-cdn.tcgplayer.com/product/727149_in_1000x1000.jpg");
  assert.deepEqual(card.variants, ["Normal"]);
  assert.equal(card.cardType, "Normal Unit");
  assert.equal(card.color, "Dragon Empire");
  assert.equal(card.clan, null);
  assert.equal(card.grade, 3);
  assert.equal(card.trigger, null);
  assert.equal(card.description, undefined); // texto de regra não entra no catálogo
  assert.deepEqual(price, { u: 63.3 });
});

test("carta: era antiga tem clã e gatilho; nação torta e 'None' são limpos", () => {
  const p = {
    productId: 68554, name: "Bringer of Good Luck, Epona",
    extendedData: [
      { name: "Number", value: "BT01/046EN" }, { name: "Rarity", value: "C" }, { name: "Unit", value: "Trigger Unit" },
      { name: "Grade", value: "0" }, { name: "Nation", value: "United Sanctary" }, { name: "Clan", value: "Royal Paladin" },
      { name: "Trigger", value: "Stand" }
    ]
  };
  const { card, price } = cardOf(p, { groupId: 1, name: "BT01: Descent of the King of Knights", publishedOn: "2011-12-10" }, "BT01", "Descent of the King of Knights", 80);
  assert.equal(card.color, "United Sanctuary");
  assert.equal(card.clan, "Royal Paladin");
  assert.equal(card.grade, 0);
  assert.equal(card.trigger, "Stand");
  assert.equal(price, null);
  const semNada = cardOf({ productId: 2, name: "X", extendedData: [{ name: "Number", value: "V-GM/0001EN" }, { name: "Nation", value: "None" }, { name: "Clan", value: "None" }, { name: "Grade", value: "" }] }, GRUPO, "V-GM", "Gift Markers", 1).card;
  assert.equal(semNada.color, null);
  assert.equal(semNada.clan, null);
  assert.equal(semNada.grade, null);
});
