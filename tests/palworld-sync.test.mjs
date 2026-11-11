// Testes do sync do Palworld OFFICIAL CARD GAME (scripts/sync-palworld.mjs),
// sem rede: o setId fixo por groupId, a 2ª edição do Dawn of Palpagos
// separada num set próprio (o TCGplayer a cadastra no grupo da 1ª), o
// acabamento que ela herda da 1ª enquanto não tem preço, o que é carta e o
// que é selado, e o mapeamento de campo do produto. Os produtos são cópias
// do que a TCGCSV (categoria 91) devolvia em 11/11/2026.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  setIdOf, codigoDominante, ABREV_FIXA, isCard, isSegundaEdicao, cleanName, cardOf, edicoesDoGrupo, acabamentosDoGrupo, chaveNoGrupo
} from "../scripts/sync-palworld.mjs";

const ed = (pares) => Object.entries(pares).map(([name, value]) => ({ name, displayName: name, value }));
const GRUPO = { groupId: 24842, name: "BP01: Dawn of Palpagos", abbreviation: "BP01", publishedOn: "2026-07-30T00:00:00" };
const CAMPOS = { CardType: "Pal", CardSubtype: "Lucky Pal", Color: "Red", Cost: "7", Element: "Fire", WorkSuitability: "Kindling", Power: "1200", Strike: "3" };
const SUZAKU = { productId: 713882, name: "Suzaku - Hellfire Wings", extendedData: ed({ Rarity: "RR", Number: "EBP01-002", ...CAMPOS }) };
const SUZAKU_OSR = { productId: 713883, name: "Suzaku - Hellfire Wings (OSR)", extendedData: ed({ Rarity: "OSR", Number: "EBP01-002OSR", ...CAMPOS }) };
const SUZAKU_2E = { productId: 725686, name: "Suzaku - Hellfire Wings (2nd Edition)", extendedData: ed({ Rarity: "RR", Number: "EBP01-002", ...CAMPOS }) };
const SOUL = { productId: 714040, name: "Soul (SSS)", extendedData: ed({ Rarity: "SSS" }) };
const SOUL_2E = { productId: 725736, name: "Soul (SSS) (2nd Edition)", extendedData: ed({ Rarity: "SSS" }) };
const BOX = { productId: 713786, name: "Dawn of Palpagos Booster Box", extendedData: [] };
const BOX_2E = { productId: 725648, name: "Dawn of Palpagos Booster Box (2nd Edition)", extendedData: [] };

test("setId: o código impresso, pinado por groupId, vale mais que a abreviação da fonte", () => {
  // A fonte abrevia "BP01"; a carta imprime "EBP01-001" (o mesmo código do
  // Godzilla), e é ele que o scanner procura no índice de sets.
  assert.equal(setIdOf(GRUPO), "EBP01");
  assert.equal(setIdOf({ groupId: 24842, abbreviation: "BP-01" }), "EBP01");
  assert.equal(setIdOf({ groupId: 24843, abbreviation: "TD01" }), "ETD01");
  assert.equal(setIdOf({ groupId: 24851, abbreviation: "PR" }), "EPR");
  // "PW_PC": o sublinhado não entra no setId dos pins.
  assert.equal(setIdOf({ groupId: 24876, abbreviation: "PW_PC" }), "PC");
});

test("setId: grupo novo sem pin cai no código que a maioria das cartas imprime", () => {
  assert.equal(setIdOf({ groupId: 9, abbreviation: "BP04" }, null, ["EBP04-001", "EBP04-001OSR", "ESOUL-020", ""]), "EBP04");
  assert.equal(setIdOf({ groupId: 9, abbreviation: "TD05" }, null, ["ETD05-001", "ETD05-002TSR", "ESOUL-021"]), "ETD05");
  // Promo mistura reimpressões: sem maioria, vale a abreviação.
  assert.equal(setIdOf({ groupId: 9, abbreviation: "PR2" }, null, ["EBP01-001", "EBP02-003", "ETD01-004"]), "PR2");
  assert.equal(codigoDominante(["ESOUL-001", "ESOUL-002"]), "");
});

test("setId: grupo novo sem pin nem código cai na abreviação (limpa), ou no groupId se vier vazia", () => {
  assert.equal(setIdOf({ groupId: 1, abbreviation: "BP04" }, new Map([["BP04", 1]])), "BP04");
  assert.equal(setIdOf({ groupId: 2, abbreviation: "PW_XX" }), "PW-XX");
  assert.equal(setIdOf({ groupId: 3, abbreviation: " " }), "G3");
  assert.equal(setIdOf({ groupId: 4, abbreviation: "PR" }, new Map([["PR", 2]])), "PR-4");
});

test("setId: os pins são únicos e cabem num nome de arquivo", () => {
  const ids = Object.values(ABREV_FIXA);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[A-Z0-9-]+$/);
});

test("carta x selado: campo de carta presente, mesmo com Rarity \"None\"", () => {
  assert.equal(isCard(SUZAKU), true);
  assert.equal(isCard(SOUL), true); // sem número, mas é carta
  assert.equal(isCard({ productId: 716360, name: "Soul", extendedData: ed({ Rarity: "None", Description: "…" }) }), true);
  assert.equal(isCard(BOX), false);
  assert.equal(isCard({ productId: 722750, name: "PR Card Pack Vol.1" }), false);
});

test("2ª edição: set próprio com o nome do grupo + (2nd Edition), sem o selado", () => {
  const eds = edicoesDoGrupo(GRUPO, [BOX, SUZAKU, SUZAKU_OSR, SOUL, BOX_2E, SUZAKU_2E, SOUL_2E], "EBP01");
  assert.deepEqual(eds.map((e) => [e.setId, e.set, e.produtos.map((p) => p.productId)]), [
    ["EBP01", "BP01: Dawn of Palpagos", [713882, 713883, 714040]],
    ["EBP01-2E", "BP01: Dawn of Palpagos (2nd Edition)", [725686, 725736]]
  ]);
  assert.equal(isSegundaEdicao(SUZAKU_2E), true);
  assert.equal(isSegundaEdicao(SUZAKU_OSR), false);
  // Grupo sem 2ª edição não ganha set vazio; grupo só de selado não gera set.
  assert.equal(edicoesDoGrupo(GRUPO, [SUZAKU], "EBP01").length, 1);
  assert.equal(edicoesDoGrupo(GRUPO, [BOX], "EBP01").length, 0);
});

test("nome: o set leva o jogo fora (contrato 7) e a carta perde só o (2nd Edition)", () => {
  const promos = edicoesDoGrupo({ groupId: 24851, name: "Palworld Promo Cards" }, [SUZAKU], "EPR");
  assert.equal(promos[0].set, "Promo Cards");
  assert.equal(cleanName("Jormuntide Ignis - Savage Lava Dragon (OSR) (2nd Edition)"), "Jormuntide Ignis - Savage Lava Dragon (OSR)");
  // O código da promo fica: separa a comum da full art ("S") no mesmo set.
  assert.equal(cleanName("Flambelle - Scorching Tears - EPR-002S"), "Flambelle - Scorching Tears - EPR-002S");
});

test("acabamento: a 2ª edição sem preço herda o da 1ª, pelo número ou pelo nome", () => {
  const priceBy = new Map([[713882, new Map([["Foil", 1.28]])], [714040, new Map([["Foil", 30]])]]);
  const acab = acabamentosDoGrupo([SUZAKU, SOUL, SUZAKU_2E, SOUL_2E], priceBy);
  assert.equal(chaveNoGrupo(SUZAKU_2E), "EBP01-002");
  assert.equal(chaveNoGrupo(SOUL_2E), "nome:Soul (SSS)");
  const { card, price } = cardOf(SUZAKU_2E, GRUPO, "BP01: Dawn of Palpagos (2nd Edition)", "EBP01-2E", 162, new Map(), acab.get(chaveNoGrupo(SUZAKU_2E)));
  assert.deepEqual(card.variants, ["Foil"]);
  assert.equal(price, null);
  assert.deepEqual(cardOf(SOUL_2E, GRUPO, "x", "EBP01-2E", 162, new Map(), acab.get(chaveNoGrupo(SOUL_2E))).card.variants, ["Foil"]);
  // Sem preço e sem par: Normal, como nos outros syncs.
  assert.deepEqual(cardOf(SUZAKU, GRUPO, "x", "EBP01", 162).card.variants, ["Normal"]);
});

test("carta: id do productId, campos do jogo e imagem grande do CDN", () => {
  const { card, price } = cardOf(SUZAKU_OSR, GRUPO, "BP01: Dawn of Palpagos", "EBP01", 162, new Map([["Foil", 8.49]]));
  assert.equal(card.id, "pal-713883");
  assert.equal(card.name, "Suzaku - Hellfire Wings (OSR)");
  assert.equal(card.number, "EBP01-002OSR"); // a raridade paralela é parte do número impresso
  assert.equal(card.setReleaseDate, "2026-07-30");
  assert.equal(card.rarity, "OSR");
  assert.equal(card.image, "https://tcgplayer-cdn.tcgplayer.com/product/713883_in_1000x1000.jpg");
  assert.deepEqual(card.variants, ["Foil"]);
  assert.equal(card.cardType, "Pal");
  assert.equal(card.subtype, "Lucky Pal");
  assert.equal(card.color, "Red");
  assert.equal(card.cost, 7);
  assert.equal(card.power, 1200);
  assert.equal(card.element, "Fire");
  assert.equal("WorkSuitability" in card || "work" in card, false);
  assert.deepEqual(price, { u: 8.49, uf: 8.49 });
});

test("carta: protótipo sem número e com Rarity \"None\" fica sem raridade", () => {
  const { card } = cardOf({ productId: 716343, name: "Cattiva", extendedData: ed({ Rarity: "None", CardType: "Pal" }) }, { publishedOn: "2026-07-30T00:00:00" }, "Prototype Cards", "PC", 16, new Map([["Normal", 0.5]]));
  assert.equal(card.number, "");
  assert.equal(card.rarity, "");
  assert.equal(card.cost, null);
  assert.deepEqual(card.variants, ["Normal"]);
});
