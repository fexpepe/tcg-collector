// Enriquecimento do catálogo japonês (scripts/lib/enrich-ja.mjs). O que está
// travado: (1) só campo VAZIO é preenchido — TCGdex > Bulbapedia > TCGCSV;
// (2) a carta importada guarda o nome inglês em nameEn e ganha o japonês em
// `name` quando a Bulbapedia o traz; (3) o irmão inglês só empresta
// categoria/tipo/estágio quando TODOS os homônimos EN concordam, e nunca o
// artista; (4) o casamento com a Bulbapedia é pelo número, "001" = "1".
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEnIndex, enrichJaCard, classificarTipoBulba, numberKey, isAsciiName, raridadeValida } from "../scripts/lib/enrich-ja.mjs";

const EN = [
  { id: "sv01-001", name: "Sprigatito", category: "Pokemon", types: "Grass", stage: "Basic" },
  { id: "sv02-001", name: "Sprigatito", category: "Pokemon", types: "Grass", stage: "Basic" },
  { id: "sv01-180", name: "Boss's Orders", category: "Trainer", trainerType: "Supporter" },
  { id: "sv01-190", name: "Basic Grass Energy", category: "Energy", energyType: "Normal" },
  // homônimos que DISCORDAM no tipo (Eevee é Colorless numa e... noutra não): não empresta tipo
  { id: "x-1", name: "Discordante", category: "Pokemon", types: "Fire", stage: "Basic" },
  { id: "x-2", name: "Discordante", category: "Pokemon", types: "Water", stage: "Basic" }
];
const idx = buildEnIndex(EN);
const importada = (extra) => Object.assign({ id: "SV1S-001-ja", name: "Sprigatito", number: "001", setId: "SV1S", category: "", types: "", rarity: "None", artist: "", image: "I", language: "ja" }, extra || {});

test("número comparável e nome ASCII", () => {
  assert.equal(numberKey("001"), "1"); assert.equal(numberKey("TG05"), "tg5"); assert.equal(numberKey("227/S-P"), "227"); assert.equal(numberKey(""), "");
  assert.equal(isAsciiName("Sprigatito"), true); assert.equal(isAsciiName("ニャオハ"), false); assert.equal(isAsciiName(""), false);
});

test("import sem cache: série pelo código, nameEn = nome inglês, categoria/tipo/estágio do irmão EN", () => {
  const c = importada();
  const mudou = enrichJaCard(c, { enIndex: idx, bulba: null });
  assert.deepEqual(mudou.sort(), ["category", "nameEn", "setSerieId", "stage", "types"]);
  assert.equal(c.setSerieId, "SV"); assert.equal(c.nameEn, "Sprigatito"); assert.equal(c.name, "Sprigatito");
  assert.equal(c.category, "Pokemon"); assert.equal(c.types, "Grass"); assert.equal(c.stage, "Basic");
  assert.equal(c.artist, "", "artista nunca vem do irmão inglês");
  // idempotente
  assert.deepEqual(enrichJaCard(c, { enIndex: idx, bulba: null }), []);
});

test("treinador e energia herdam o campo da sua categoria; homônimos discordantes não emprestam", () => {
  const t = importada({ id: "SV1S-180-ja", name: "Boss's Orders", number: "180" });
  enrichJaCard(t, { enIndex: idx });
  assert.equal(t.category, "Trainer"); assert.equal(t.trainerType, "Supporter"); assert.equal(t.types, "");
  const e = importada({ name: "Basic Grass Energy", number: "190" });
  enrichJaCard(e, { enIndex: idx });
  assert.equal(e.category, "Energy"); assert.equal(e.energyType, "Normal");
  const d = importada({ name: "Discordante", number: "2" });
  enrichJaCard(d, { enIndex: idx });
  assert.equal(d.category, "Pokemon"); assert.equal(d.stage, "Basic"); assert.equal(d.types, "", "tipo discorda entre os homônimos: fica vazio");
});

test("cache da Bulbapedia: nome japonês entra no `name`, inglês fica em nameEn, raridade/artista/scan só onde vazio", () => {
  const bulba = { cards: { "1": { en: "Sprigatito", ja: "ニャオハ", rarity: "C", type: "Grass", artist: "Mizue", image: "https://archives.bulbagarden.net/media/upload/a/ab/X.jpg" } } };
  const c = importada({ image: "" });
  enrichJaCard(c, { enIndex: idx, bulba });
  assert.equal(c.name, "ニャオハ"); assert.equal(c.nameEn, "Sprigatito");
  assert.equal(c.rarity, "C"); assert.equal(c.artist, "Mizue"); assert.equal(c.image, "https://archives.bulbagarden.net/media/upload/a/ab/X.jpg");
  assert.equal(c.category, "Pokemon"); assert.equal(c.types, "Grass");
  // carta da TCGdex (nome já japonês, artista e raridade próprios): só ganha nameEn
  const dex = { id: "SV1S-001-ja", name: "ニャオハ", number: "001", setId: "SV1S", setSerieId: "SV", category: "Pokemon", types: "Grass", stage: "Basic", rarity: "Common", artist: "Sekio", image: "I", language: "ja" };
  assert.deepEqual(enrichJaCard(dex, { enIndex: idx, bulba }), ["nameEn"]);
  assert.equal(dex.artist, "Sekio"); assert.equal(dex.rarity, "Common"); assert.equal(dex.image, "I");
  // número que não está no cache: nada da Bulbapedia
  const fora = importada({ number: "099" });
  enrichJaCard(fora, { enIndex: idx, bulba });
  assert.equal(fora.name, "Sprigatito"); assert.equal(fora.artist, "");
});

test("tipo da Bulbapedia -> categoria do catálogo", () => {
  assert.deepEqual(classificarTipoBulba("Lightning"), { category: "Pokemon", types: "Lightning" });
  assert.deepEqual(classificarTipoBulba("Supporter"), { category: "Trainer", trainerType: "Supporter" });
  assert.deepEqual(classificarTipoBulba("Pokémon Tool"), { category: "Trainer", trainerType: "Tool" });
  assert.deepEqual(classificarTipoBulba("Trainer"), { category: "Trainer" });
  assert.deepEqual(classificarTipoBulba("Special Energy"), { category: "Energy", energyType: "Special" });
  assert.deepEqual(classificarTipoBulba("Basic Energy"), { category: "Energy", energyType: "Normal" });
  assert.equal(classificarTipoBulba("???"), null); assert.equal(classificarTipoBulba(""), null);
});

test("guarda do cache: raridade que não parece raridade e imagem que não é scan não entram", () => {
  assert.equal(raridadeValida("C"), true); assert.equal(raridadeValida("SAR"), true); assert.equal(raridadeValida("Rare Holo"), true);
  assert.equal(raridadeValida("Promotion"), false); assert.equal(raridadeValida(""), false); assert.equal(raridadeValida("Grass"), false);
  const bulba = { cards: { "1": { en: "Sprigatito", ja: "ニャオハ", rarity: "Promotion", artist: "Mizue", image: "https://archives.bulbagarden.net/media/upload/2/2e/Grass-attack.png" } } };
  const c = importada({ image: "" });
  enrichJaCard(c, { enIndex: idx, bulba });
  assert.equal(c.rarity, "None"); assert.equal(c.image, ""); assert.equal(c.name, "ニャオハ"); assert.equal(c.artist, "Mizue");
});
