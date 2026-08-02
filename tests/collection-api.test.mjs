// Contrato do /api/collection: as queries que a borda roda pra devolver as
// cartas e os preços de quem coleciona. Banco real (node:sqlite) montado com o
// MESMO esquema que vai pro D1. Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  SCHEMA, SCHEMA_PRICES, buildCards, buildPrices, idsComBase,
  basePricingId, LOTE_IDS
} from "../functions/api/_search-sql.js";
import { loadShared } from "./lib/shared-sandbox.mjs";

function banco() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  db.exec(SCHEMA_PRICES);
  const carta = db.prepare(`INSERT INTO cards
    (game,id,name,set_name,number,card_type,cost,rarity,color,set_id,artist,language,image,variants,released)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  // base1-4 (EN, com variantes) e sua versão -pt (sem preço próprio)
  carta.run("pokemon", "base1-4", "Charizard", "Base Set", "4", "", "", "Rare", "Fire",
    "base1", "Mitsuhiro Arita", "en", "https://img/4.png", JSON.stringify(["1st Edition", "Holo"]), "1999-01-09");
  carta.run("pokemon", "base1-4-pt", "Charizard", "Base Set", "4", "", "", "Rare", "Fire",
    "base1", "Mitsuhiro Arita", "pt", "https://img/4pt.png", JSON.stringify(["Holo"]), "1999-01-09");
  carta.run("lorcana", "tfc-1", "Ariel", "The First Chapter", "1", "", "", "Common", "Amber",
    "tfc", "X", "en", "https://img/a.png", JSON.stringify(["Normal", "Foil"]), "2023-08-18");
  const preco = db.prepare("INSERT INTO prices (game,id,j) VALUES (?,?,?)");
  preco.run("pokemon", "base1-4", JSON.stringify({ u: 320.5, e: 290, uf: 900, g: { 10: { s: 9999, n: 3 } } }));
  preco.run("lorcana", "tfc-1", JSON.stringify({ u: 1.5 }));
  return db;
}

const roda = (db, q) => (q ? db.prepare(q.sql).all(...q.params) : []);

test("buildCards devolve a carta no contrato do chunk (com variantes e imagem)", () => {
  const db = banco();
  const linhas = roda(db, buildCards("pokemon", ["base1-4"]));
  assert.equal(linhas.length, 1);
  const c = linhas[0];
  assert.equal(c.name, "Charizard");
  assert.equal(c.set_name, "Base Set");
  assert.equal(c.set_id, "base1");
  assert.equal(c.artist, "Mitsuhiro Arita");
  assert.equal(c.image, "https://img/4.png");
  assert.equal(c.language, "en");
  assert.equal(c.released, "1999-01-09");
  // variantes viajam como JSON — é o que decide de qual preço a cópia vale
  assert.deepEqual(JSON.parse(c.variants), ["1st Edition", "Holo"]);
});

test("buildCards não vaza carta de outro jogo", () => {
  const db = banco();
  assert.equal(roda(db, buildCards("pokemon", ["tfc-1"])).length, 0);
  assert.equal(roda(db, buildCards("lorcana", ["tfc-1"])).length, 1);
});

test("buildPrices traz o preço da carta BASE pra localizada sem preço próprio", () => {
  const db = banco();
  // A -pt não tem linha de preço; o cardValue cai na base. Sem os ids base na
  // consulta, o Portfólio somaria MENOS que a tela que usa chunk.
  const ids = idsComBase(["base1-4-pt"]);
  assert.ok(ids.includes("base1-4"), "id base incluído");
  const linhas = roda(db, buildPrices("pokemon", ids));
  const porId = Object.fromEntries(linhas.map((l) => [l.id, JSON.parse(l.j)]));
  assert.equal(porId["base1-4"].u, 320.5);
  assert.equal(porId["base1-4"].uf, 900);
  // O preço volta VERBATIM: o graded aninhado tem de sobreviver ao trajeto.
  assert.equal(porId["base1-4"].g["10"].s, 9999);
});

test("idsComBase não duplica quando o id já é base", () => {
  assert.deepEqual(idsComBase(["base1-4", "base1-4"]), ["base1-4"]);
  assert.deepEqual(idsComBase(["x-1-ja"]).sort(), ["x-1", "x-1-ja"]);
});

test("basePricingId da borda casa com o do cliente (mesma régua dos dois lados)", () => {
  const sb = loadShared("window.__test = { basePricingId };");
  const doCliente = sb.window.__test.basePricingId;
  for (const id of ["base1-4", "base1-4-pt", "sv3-1-ja", "x-9-zh-cn", "y-2-zh-tw", "z-3-zh", "w-4-en"]) {
    assert.equal(basePricingId(id), doCliente(id), `divergiu em ${id}`);
  }
});

test("um lote cabe no teto de parâmetros do D1", () => {
  const ids = Array.from({ length: LOTE_IDS }, (_, i) => `c-${i}`);
  const q = buildCards("pokemon", ids);
  assert.equal(q.params.length, LOTE_IDS + 1);       // + o jogo
  assert.ok(q.params.length <= 100, "dentro do teto de 100 do D1");
});

test("lista vazia não vira query (nem SELECT sem filtro)", () => {
  assert.equal(buildCards("pokemon", []), null);
  assert.equal(buildPrices("pokemon", []), null);
});
