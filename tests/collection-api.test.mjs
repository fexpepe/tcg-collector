// Contrato do /api/collection: as queries que a borda roda pra devolver as
// cartas e os preços de quem coleciona. Banco real (node:sqlite) montado com o
// MESMO esquema que vai pro D1. Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  SCHEMA, SCHEMA_PRICES, buildCards, buildPrices, buildSearch, idsComBase,
  basePricingId, LOTE_IDS, cardRows, formasNumericas
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

// Palavras de busca pro banco de teste (o banco() só põe as cartas).
function comPalavras(db) {
  const w = db.prepare("INSERT INTO card_words (game,word,id) VALUES (?,?,?)");
  [["pokemon", "charizard", "base1-4"], ["pokemon", "base", "base1-4"],
    ["pokemon", "charizard", "base1-4-pt"], ["pokemon", "base", "base1-4-pt"],
    ["lorcana", "ariel", "tfc-1"], ["lorcana", "chapter", "tfc-1"]].forEach((l) => w.run(...l));
  return db;
}

test("busca por prefixo USA o índice — NOCASE + sem ESCAPE travados no plano", () => {
  // As duas condições da otimização do LIKE (word COLLATE NOCASE no SCHEMA e
  // query sem cláusula ESCAPE) degradam pra VARREDURA em silêncio se alguém
  // desfizer qualquer uma — foi assim que a global passou a ler 1,7M linhas
  // por palavra e estourou a cota do D1. Este teste quebra na hora.
  const db = comPalavras(banco());
  for (const q of [buildSearch("pokemon", "chari", 10), buildSearch("all", "chari", 10)]) {
    const plano = db.prepare("EXPLAIN QUERY PLAN " + q.sql).all(...q.params).map((r) => r.detail).join(" | ");
    assert.match(plano, /word>\?/, `plano sem range de prefixo: ${plano}`);
    assert.doesNotMatch(plano, /SCAN card_words/, `varredura completa: ${plano}`);
  }
});

test("busca acha por prefixo e interseção de palavras", () => {
  const db = comPalavras(banco());
  // "chari base" = charizard* ∩ base* — as DUAS versões (en e -pt) da carta
  const hits = roda(db, buildSearch("pokemon", "chari base", 10));
  assert.deepEqual(hits.map((h) => h.id).sort(), ["base1-4", "base1-4-pt"]);
  // global: acha em qualquer jogo e diz de qual veio (g na resposta da Function)
  const g = roda(db, buildSearch("all", "ariel", 10));
  assert.deepEqual(g.map((h) => [h.game, h.id]), [["lorcana", "tfc-1"]]);
});

// Cartas com NÚMERO indexado como o cardRows faz hoje: número + total do set.
// A Nymble é guardada como "9" + 94 (Pokémon antigo/TCGdex), a Spewpa como
// "009" + 198 (Pokémon moderno, já zero-preenchido).
function comNumeros(db) {
  const carta = db.prepare(`INSERT INTO cards
    (game,id,name,set_name,number,card_type,cost,rarity,color,set_id,artist,language,image,variants,released)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  carta.run("pokemon", "x-9", "Nymble", "Set X", "9", "", "", "Common", "", "x", "", "en", "", "[]", "2024-01-01");
  carta.run("pokemon", "sv01-009", "Spewpa", "Scarlet & Violet", "009", "", "", "Common", "", "sv01", "", "en", "", "[]", "2023-03-31");
  const w = db.prepare("INSERT INTO card_words (game,word,id) VALUES (?,?,?)");
  for (const c of [{ id: "x-9", name: "Nymble", set: "Set X", number: "9", setTotal: 94 },
    { id: "sv01-009", name: "Spewpa", set: "Scarlet & Violet", number: "009", setTotal: 198 }]) {
    for (const p of cardRows("pokemon", c).words) w.run(p.game, p.word, p.id);
  }
  return db;
}

test("cardRows: o total do set entra como palavra EXTRA; número com barra não duplica", () => {
  const r = cardRows("pokemon", { id: "x-9", name: "Nymble", set: "Set X", number: "9", setTotal: 94 });
  assert.deepEqual(r.extras.map((w) => w.word), ["94"]);
  assert.deepEqual(r.legado.map((w) => w.word), ["nymble", "set", "x", "9"]);
  assert.deepEqual(r.words.map((w) => w.word), ["nymble", "set", "x", "9", "94"]);
  const barra = cardRows("pokemon", { id: "base1-4", name: "Charizard", set: "Base Set", number: "4/102", setTotal: 102 });
  assert.deepEqual(barra.extras, []);
  assert.ok(barra.words.some((w) => w.word === "102"));
  // Total repetido no nome/set não entra duas vezes (Set "2024" com total 2024 é raro, mas o dedupe é a regra).
  const rep = cardRows("pokemon", { id: "y-1", name: "Carta 94", set: "S", number: "1", setTotal: 94 });
  assert.deepEqual(rep.extras, []);
});

test("número casa por IGUALDADE nas suas escritas: 009/094, 9/94, nome + número", () => {
  const db = comNumeros(banco());
  const ids = (q) => roda(db, buildSearch("pokemon", q, 10)).map((h) => h.id).sort();
  assert.deepEqual(ids("009/094"), ["x-9"]);          // o impresso acha a guardada como "9"
  assert.deepEqual(ids("9/94"), ["x-9"]);
  assert.deepEqual(ids("nymble 9"), ["x-9"]);
  assert.deepEqual(ids("Nymble (009/094)"), ["x-9"]);
  assert.deepEqual(ids("spewpa 9"), ["sv01-009"]);    // "9" acha a guardada como "009"
  assert.deepEqual(ids("009"), ["sv01-009", "x-9"]);  // número solto: todas as 9/009
  assert.deepEqual(ids("9/198"), ["sv01-009"]);
  assert.deepEqual(ids("94"), ["x-9"]);               // "94" não vira prefixo de "940"…
  assert.deepEqual(ids("10/94"), []);
  // global também
  assert.deepEqual(roda(db, buildSearch("all", "009/094", 10)).map((h) => [h.game, h.id]), [["pokemon", "x-9"]]);
});

test("termo numérico usa o índice (igualdade, sem varredura) e o teto maior", () => {
  const db = comNumeros(banco());
  for (const q of [buildSearch("pokemon", "009/094", 10), buildSearch("all", "nymble 9", 10)]) {
    const plano = db.prepare("EXPLAIN QUERY PLAN " + q.sql).all(...q.params).map((r) => r.detail).join(" | ");
    assert.doesNotMatch(plano, /SCAN card_words/, `varredura completa: ${plano}`);
    assert.match(plano, /word=\?/, `sem igualdade no índice: ${plano}`);
  }
  const q = buildSearch("pokemon", "nymble 9", 10);
  assert.match(q.sql, /word IN \(\?,\?\) LIMIT 6000/);
  assert.match(q.sql, /word LIKE \? LIMIT 2000/);
  assert.deepEqual(q.params, ["pokemon", "nymble%", "9", "009"]);
  assert.deepEqual(buildSearch("pokemon", "0001", 10).params, ["pokemon", "0001", "1", "001"]);
});

test("formasNumericas da borda = numberSearchForms do cliente (mesma régua dos dois lados)", () => {
  const sb = loadShared("window.__test = { numberSearchForms };");
  const doCliente = sb.window.__test.numberSearchForms;
  for (const n of ["9", "009", "94", "094", "0001", "123", "1000"]) {
    assert.deepEqual(new Set(formasNumericas(n)), new Set(doCliente(n)), `divergiu em ${n}`);
  }
});

test("termo repetido não vira operando duplicado (linha lida é linha cobrada)", () => {
  const db = comPalavras(banco());
  // "chari chari" descreve a MESMA restrição de "chari": mesmo resultado, mas
  // sem o dedupe eram dois operandos idênticos no INTERSECT — o dobro de
  // linhas lidas no D1 por uma repetição que o usuário nem percebe que digitou.
  const uma = buildSearch("pokemon", "chari", 10);
  const duas = buildSearch("pokemon", "chari chari", 10);
  assert.equal(duas.params.length, uma.params.length);
  assert.equal((duas.sql.match(/INTERSECT/g) || []).length, 0);
  assert.deepEqual(roda(db, duas).map((h) => h.id).sort(), roda(db, uma).map((h) => h.id).sort());
});
