// Testes do sync do Harry Potter TCG (scripts/sync-harrypotter.mjs): o parse do
// hpjson (com o NaN cru e os sets fan-made que ficam de fora), as grafias
// duplicadas, o Draco/Hermione de duas versões e a gêmea premium como carta
// separada. Sem rede: a fixture imita o formato do hpjson.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHpjson, buildCards, imageUrl, artistOf, SETS, EXTRAS, VERSAO } from "../scripts/sync-harrypotter.mjs";

const card = (setName, number, name, extra = {}) => ({ number, name, type: ["Spell"], rarity: "Common", artist: "Ron Spencer", setName, imgSrc: name.replace(/[^A-Za-z]/g, "") + ".png", ...extra });
const FIXTURE = JSON.stringify([
  card("Base", "3a", "Draco Malfoy", { type: ["Character"], rarity: "Foil Premium", artist: "Romas", imgSrc: "DracoMalfoyV1.png" }),
  card("Base", "3b", "Draco Malfoy", { type: ["Character"], rarity: "Foil Premium", artist: "Pete Venters", imgSrc: "DracoMalfoyV2.png" }),
  card("Base", "30", "Norbert", { type: ["Creature"], rarity: "Rare", lesson: ["Care of Magical Creatures"] }),
  card("Base", "112", "Wizard Crackers"),
  card("Quidditch Cup", "7", "Gold Cauldron", { type: ["Item"], rarity: "Foil Premium" }),
  card("Quidditch Cup", "7", "Golden Cauldron", { type: ["Item"], rarity: "Rare" }),
  card("Quidditch Cup", "15", "Neville Longbottom", { type: ["Character"], rarity: "Rare" }),
  card("Quidditch Cup", "79", "Quidditch", { type: ["Lesson"], rarity: "Common" }),
  card("Diagon Alley", "68", "River Troll", { type: ["Creature"] }),
  card("Chamber of Secrets", "1", "Angelina Johnson", { type: ["Character"], rarity: "Rare" }),
  card("Heir of Slytherin", "1", "Fan Card"),
  card("Promotional", "1a", "House Points")
]).replace('"artist":"Ron Spencer","setName":"Base","imgSrc":"WizardCrackers.png"', '"artist":NaN,"setName":"Base","imgSrc":"WizardCrackers.png"');

const snapshotDe = (parsed) => ({
  sets: SETS.map((s) => ({ code: s.code, cards: (parsed[s.code] || []).map((c) => ({ ...c, file: c.files[0], img: `https://accio.cards/cardimages/${c.files[0]}` })) }))
});

test("parse: NaN cru não quebra, e os sets fan-made ficam de fora", () => {
  assert.ok(FIXTURE.includes('"artist":NaN'));
  const p = parseHpjson(FIXTURE);
  assert.deepEqual(Object.keys(p), SETS.map((s) => s.code));
  const todos = Object.values(p).flat().map((c) => c.name);
  assert.ok(!todos.includes("Fan Card") && !todos.includes("House Points"));
  assert.equal(p.bs.find((c) => c.num === "112").artist, "");
});

test("parse: número repetido fica com o nome impresso e empresta a imagem da outra linha", () => {
  const qc7 = parseHpjson(FIXTURE).qc.filter((c) => c.num === "7");
  assert.equal(qc7.length, 1);
  assert.equal(qc7[0].name, "Gold Cauldron");
  assert.equal(qc7[0].rarity, "Rare");                    // a linha premium do hpjson não manda
  assert.deepEqual(qc7[0].files, ["GoldenCauldron.png", "GoldCauldron.png"]);
});

test("parse: Lição tem raridade Lesson mesmo quando o hpjson diz Common", () => {
  assert.equal(parseHpjson(FIXTURE).qc.find((c) => c.num === "79").rarity, "Lesson");
});

test("build: toda rara das expansões ganha a gêmea premium, com id e nome próprios", () => {
  const cards = buildCards(snapshotDe(parseHpjson(FIXTURE)));
  const by = new Map(cards.map((c) => [c.id, c]));
  assert.equal(by.get("hp-qc-7").name, "Gold Cauldron");
  assert.equal(by.get("hp-qc-7-premium").name, "Gold Cauldron (Foil)");
  assert.equal(by.get("hp-qc-7-premium").rarity, "Foil Premium");
  assert.equal(by.get("hp-qc-15-premium").name, "Neville Longbottom (Holo)");
  assert.equal(by.get("hp-qc-15-premium").rarity, "Holo Portrait Premium");
  assert.deepEqual(by.get("hp-qc-15-premium").variants, ["Holo"]);
  assert.ok(by.has("hp-cos-1-premium"));
  assert.ok(!by.has("hp-bs-30-premium"), "no Base a premium é a própria carta 1–20");
  assert.ok(!by.has("hp-qc-79-premium"), "só rara tem premium");
  // Número impresso e total do set com as premium dentro.
  assert.equal(by.get("hp-qc-7").number, "7/80");
  assert.equal(by.get("hp-qc-7").setTotal, 5);
});

test("build: Draco #3 do booster é a versão b; a do deck inicial é a a, num set próprio", () => {
  const cards = buildCards(snapshotDe(parseHpjson(FIXTURE)));
  const by = new Map(cards.map((c) => [c.id, c]));
  assert.equal(by.get("hp-bs-3").artist, "Pete Venters");
  assert.deepEqual(by.get("hp-bs-3").variants, ["Foil"]);
  const deck = by.get("hp-da2p-bs-3");
  assert.equal(deck.name, "Draco Malfoy (Starter)");
  assert.equal(deck.artist, "Romas");
  assert.equal(deck.rarity, "Rare");
  assert.equal(deck.number, "3/116");
  assert.equal(deck.setKind, "deck");
  const norbert = by.get("hp-da2p-bs-30");
  assert.equal(norbert.name, "Norbert (Foil)");
  assert.deepEqual(norbert.variants, ["Foil"]);
  assert.ok(!cards.some((c) => /^hp-bs-3[ab]$/.test(c.id)), "a letra do hpjson não vira id");
});

test("imagem: wsrv com 440px; o Chamber of Secrets (scan de 250px) não estica", () => {
  assert.equal(imageUrl("https://accio.cards/cardimages/Bludger.png", "qc"), "https://wsrv.nl/?url=accio.cards%2Fcardimages%2FBludger.png&w=440&output=webp");
  assert.match(imageUrl("https://accio.cards/cardimages/AngelinaJohnson.png", "cos"), /&we&/);
  assert.equal(imageUrl("", "qc"), "");
});

test("artista: lista vira texto, NaN some", () => {
  assert.equal(artistOf(["Kevin McCann", "Michael Collins"]), "Kevin McCann, Michael Collins");
  assert.equal(artistOf(null), "");
  assert.equal(artistOf("NaN"), "");
});

test("tabelas: VERSAO e EXTRAS apontam pra sets que existem", () => {
  const codes = new Set(SETS.map((s) => s.code));
  for (const k of Object.keys(VERSAO)) assert.ok(codes.has(k.split("-")[0]), k);
  for (const ex of EXTRAS) for (const e of ex.cards) assert.ok(codes.has(e.from), `${ex.code}: ${e.from}`);
});

test("snapshot versionado: ids estáveis e únicos, nenhum set fan-made", () => {
  const snap = JSON.parse(readFileSync(new URL("../data/vintage/hptcg.json", import.meta.url), "utf8"));
  const cards = buildCards(snap);
  const ids = cards.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "id duplicado");
  assert.ok(ids.every((id) => /^hp-[a-z0-9]+-[a-z]*-?\d+(-premium)?$/.test(id)), "formato de id");
  for (const def of SETS) assert.ok(cards.some((c) => c.setId === `hp-${def.code}`), def.code);
  // Totais impressos: 116 + 80×3 + 140 cartas de booster, mais as premium.
  const booster = cards.filter((c) => SETS.some((s) => c.setId === `hp-${s.code}`) && !/-premium$/.test(c.id));
  assert.equal(booster.length, 116 + 80 * 3 + 140);
  assert.equal(cards.filter((c) => /-premium$/.test(c.id)).length, 30 * 3 + 55);
  // Todo extra vira carta (origem achada no snapshot).
  const extras = EXTRAS.reduce((n, ex) => n + ex.cards.length, 0);
  assert.equal(cards.filter((c) => EXTRAS.some((ex) => c.setId === `hp-${ex.code}`)).length, extras);
});

test("extras: promo com raridade Promo e o número da carta de origem; League com o número dela, sem total", () => {
  const snap = JSON.parse(readFileSync(new URL("../data/vintage/hptcg.json", import.meta.url), "utf8"));
  const by = new Map(buildCards(snap).map((c) => [c.id, c]));
  const promo = by.get("hp-promo-bs-48");
  assert.equal(promo.name, "Diagon Alley (Promo)");
  assert.equal(promo.rarity, "Promo");
  assert.equal(promo.number, "48/116");
  const league = by.get("hp-league-qc-35");
  assert.equal(league.name, "Diffindo (League Foil)");
  assert.equal(league.number, "1");
  assert.equal(league.setTotal, "");
  assert.deepEqual(league.variants, ["Foil"]);
  const chimaera = by.get("hp-cos2p-aah-57");
  assert.equal(chimaera.rarity, "Common", "foil de deck mantém o símbolo da carta de origem");
  assert.equal(chimaera.setKind, "deck");
});
