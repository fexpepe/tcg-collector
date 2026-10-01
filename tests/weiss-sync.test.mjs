// Testes do sync do Weiß Schwarz (scripts/sync-weiss.mjs), sem rede: o setId
// fixo por groupId (a TCGCSV deixou a abreviação vazia, repetida ou errada em
// vários grupos), a regra de grupo novo, o número sem a raridade e o
// mapeamento de campo do produto. Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { setIdOf, codeOfNumber, numberOf, cardOf, ABREV_FIXA } from "../scripts/sync-weiss.mjs";

test("setId: pin por groupId vale mais que a abreviação da fonte", () => {
  assert.equal(setIdOf({ groupId: 24453, abbreviation: "DDD" }), "DDD-S118");
  // A fonte grafa "SHS/W56" no Dreaming Girl, que é o código do Saekano.
  assert.equal(setIdOf({ groupId: 3113, abbreviation: "SHS/W56" }), "SBY-W77");
  assert.equal(setIdOf({ groupId: 3114, abbreviation: "SHRB" }), "SHS-W56");
  // Abreviação vazia e repetida (três "HOL").
  assert.equal(setIdOf({ groupId: 22986, abbreviation: "" }), "5HY-W101");
  assert.equal(setIdOf({ groupId: 22994, abbreviation: "HOL" }), "HOL-W104");
  assert.equal(setIdOf({ groupId: 23499, abbreviation: "HOL" }), "HOL-WE44");
});

test("setId: os pins são únicos e cabem num nome de arquivo", () => {
  const ids = Object.values(ABREV_FIXA);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[A-Z0-9-]+$/);
});

test("setId de grupo novo: abreviação completa, senão o código das cartas", () => {
  assert.equal(setIdOf({ groupId: 1, abbreviation: "XYZ/W200" }), "XYZ-W200");
  assert.equal(setIdOf({ groupId: 2, abbreviation: "XYZ" }, ["XYZ/S201-E001 C", "XYZ/S201-E002 U", "ABC/BCS2026-01 PR"]), "XYZ-S201");
  assert.equal(setIdOf({ groupId: 3, abbreviation: "" }, ["???"]), "G3");
});

test("número: só o código impresso, sem a raridade nem o RE", () => {
  assert.equal(numberOf("DDD/S118-E014 C"), "DDD/S118-E014");
  assert.equal(numberOf("FT/EN-S02-T01 TD RE"), "FT/EN-S02-T01");
  assert.equal(numberOf("GGO/SE50-E01H Holo Rare"), "GGO/SE50-E01H");
  assert.equal(numberOf(""), "");
  assert.equal(codeOfNumber("LL/EN-W01-001"), "LL-EN-W01");
  assert.equal(codeOfNumber("Foy/W65-E001"), "FOY-W65");
});

const GRUPO = { groupId: 24453, name: "DANDADAN", publishedOn: "2026-01-30T00:00:00" };
const ext = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));

test("carta: id do productId, campos do jogo e imagem do CDN", () => {
  const p = {
    productId: 674019, name: "I Wanna Say Good Morning! Okarun",
    extendedData: ext({ Number: "DDD/S118-E014 C", Rarity: "Common", CardType: "Character", Color: "Yellow", Level: "0", Cost: "0", Power: "2500", Soul: "1", Trait: "Occult", "Trait 2": "-", Triggers: "" })
  };
  const { card, price } = cardOf(p, GRUPO, "DDD-S118", 298, new Map([["Normal", 0.12]]));
  assert.equal(card.id, "ws-674019");
  assert.equal(card.setId, "DDD-S118");
  assert.equal(card.set, "DANDADAN");
  assert.equal(card.number, "DDD/S118-E014");
  assert.equal(card.setTotal, 298);
  assert.equal(card.setReleaseDate, "2026-01-30");
  assert.equal(card.rarity, "Common");
  assert.equal(card.language, "en");
  assert.equal(card.image, "https://tcgplayer-cdn.tcgplayer.com/product/674019_in_1000x1000.jpg");
  assert.equal(card.cardType, "Character");
  assert.equal(card.color, "Yellow");
  assert.equal(card.level, 0);
  assert.equal(card.cost, 0);
  assert.equal(card.power, 2500);
  assert.equal(card.soul, 1);
  assert.equal(card.traits, "Occult");
  assert.equal(card.trigger, null);
  assert.deepEqual(card.variants, ["Normal"]);
  assert.deepEqual(price, { u: 0.12 });
});

test("carta: Climax sem poder fica com null, e sem preço fica sem preço", () => {
  const p = { productId: 1, name: "Climax", extendedData: ext({ Number: "DDD/S118-E049 CC", Rarity: "Climax Common", CardType: "Climax", Color: "Red", Triggers: "Soul" }) };
  const { card, price } = cardOf(p, GRUPO, "DDD-S118", 298);
  assert.equal(card.power, null);
  assert.equal(card.level, null);
  assert.equal(card.trigger, "Soul");
  assert.equal(card.traits, null);
  assert.equal(price, null);
  assert.deepEqual(card.variants, ["Normal"]);
});
