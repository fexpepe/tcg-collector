// Carga incremental do D1 (scripts/lib/d1-delta.mjs) num SQLite REAL: o plano
// da diferença, aplicado em cima do banco da versão anterior, tem que deixar
// o banco IGUAL a uma carga total da versão nova — inteiro, em rodadas de
// orçamento, ou retomado depois de uma interrupção em qualquer statement.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA, SCHEMA_PRICES, cardRows } from "../functions/api/_search-sql.js";
import { COLUNAS, impressaoCarta, impressaoPreco } from "../scripts/lib/d1-catalogo.mjs";
import { CUSTO, diffCartas, diffPrecos, planoCartas, planoPrecos } from "../scripts/lib/d1-delta.mjs";

const G = "pokemon";
const carta = (id, name, extra = {}) => impressaoCarta(cardRows(G, {
  id, name, set: "Base Set", number: id.split("-")[1], artist: "Arita", setId: "base1",
  language: "en", image: `https://img/${id}.png`, variants: ["Normal"], setReleaseDate: "1999-01-09", ...extra
}));
const preco = (id, j) => impressaoPreco({ game: G, id, j: JSON.stringify(j) });

const V1 = [
  carta("base1-1", "Alakazam"), carta("base1-2", "Blastoise"), carta("base1-3", "Chansey"),
  carta("base1-4", "Charizard"), carta("base1-5", "Clefairy")
];
// v2: Chansey renomeada (palavras mudam), Charizard com outra imagem (só a
// linha), Clefairy some, Gyarados entra, Alakazam e Blastoise iguais.
const V2 = [
  carta("base1-1", "Alakazam"), carta("base1-2", "Blastoise"), carta("base1-3", "Chansey ex"),
  carta("base1-4", "Charizard", { image: "https://img/base1-4-v2.png" }), carta("base1-6", "Gyarados")
];
const P1 = [preco("base1-1", { u: 1 }), preco("base1-2", { u: 2 }), preco("base1-4", { u: 300 })];
const P2 = [preco("base1-1", { u: 1 }), preco("base1-2", { u: 2.5 }), preco("base1-6", { u: 40 })];

function banco() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA); db.exec(SCHEMA_PRICES);
  return db;
}
// Referência: carga total, inserida direto (sem passar pelo plano).
function total(cards, precos) {
  const db = banco();
  const ins = db.prepare(`INSERT INTO cards (${COLUNAS.join(",")}) VALUES (${COLUNAS.map(() => "?").join(",")})`);
  const insW = db.prepare("INSERT INTO card_words (game,word,id) VALUES (?,?,?)");
  for (const c of cards) {
    ins.run(...COLUNAS.map((k) => c.linha[k]));
    for (const w of c.words) insW.run(w.game, w.word, w.id);
  }
  const insP = db.prepare("INSERT INTO prices (game,id,j,h) VALUES (?,?,?,?)");
  for (const p of precos) insP.run(p.game, p.id, p.j, p.h);
  return db;
}
const estado = (db) => ({
  cards: db.prepare(`SELECT ${COLUNAS.join(",")} FROM cards ORDER BY game, id`).all(),
  words: db.prepare("SELECT game, word, id FROM card_words ORDER BY game, id, word").all(),
  prices: db.prepare("SELECT game, id, j, h FROM prices ORDER BY game, id").all()
});
const remotosCartas = (db) => new Map(db.prepare("SELECT id, h, hw FROM cards WHERE game = ?").all(G).map((l) => [l.id, l]));
const remotosPrecos = (db) => new Map(db.prepare("SELECT id, h FROM prices WHERE game = ?").all(G).map((l) => [l.id, l.h]));
const mapa = (lista) => new Map(lista.map((x) => [x.id || x.linha.id, x]));
const aplica = (db, statements) => { if (statements.length) db.exec(statements.join("\n")); };

function planoV(db, cards, orcamento = Infinity) {
  return planoCartas(G, diffCartas(mapa(cards), remotosCartas(db)), mapa(cards), orcamento);
}
function planoP(db, precos, orcamento = Infinity) {
  return planoPrecos(G, diffPrecos(new Map(precos.map((p) => [p.id, p.h])), remotosPrecos(db)), mapa(precos), orcamento);
}

test("impressões: linha e palavras têm hashes independentes", () => {
  const a = carta("x-1", "Pikachu"), b = carta("x-1", "Pikachu", { image: "outra" }), c = carta("x-1", "Raichu");
  assert.notEqual(a.h, b.h); assert.equal(a.hw, b.hw);   // só a linha
  assert.notEqual(a.hw, c.hw);                           // as palavras
  assert.equal(a.linha.h, a.h); assert.equal(a.linha.hw, a.hw);
});

test("diferença: classifica novas, palavras, linha e sumidas; hw nulo conta como palavras", () => {
  const db = total(V1, []);
  const d = diffCartas(mapa(V2), remotosCartas(db));
  assert.deepEqual(d, { novos: ["base1-6"], palavras: ["base1-3"], linha: ["base1-4"], remover: ["base1-5"] });
  db.prepare("UPDATE cards SET hw = NULL WHERE id = 'base1-1'").run();
  assert.deepEqual(diffCartas(mapa(V2), remotosCartas(db)).palavras, ["base1-1", "base1-3"]);
});

test("carga do zero e depois a diferença: o banco fica igual à carga total", () => {
  const db = banco();
  const p0 = planoV(db, V1);
  assert.equal(p0.feitos, V1.length);
  aplica(db, p0.statements);
  assert.deepEqual(estado(db).cards, estado(total(V1, [])).cards);
  assert.deepEqual(estado(db).words, estado(total(V1, [])).words);

  const p = planoV(db, V2);
  assert.equal(p.feitos, 4); assert.equal(p.pendentes, 0);
  // Custo só das 4 cartas que mudaram — as iguais não entram.
  const w3 = V2[2].words.length, w6 = V2[4].words.length;
  assert.equal(p.custo, (CUSTO.carta + CUSTO.palavra * w6) + (CUSTO.carta + CUSTO.palavra * 2 * w3)
    + CUSTO.carta + (CUSTO.carta + CUSTO.palavra * CUSTO.palavrasSemDado));
  aplica(db, p.statements);
  assert.deepEqual(estado(db).cards, estado(total(V2, [])).cards);
  assert.deepEqual(estado(db).words, estado(total(V2, [])).words);
  // Idempotente: nada mais a fazer.
  const p2 = planoV(db, V2);
  assert.equal(p2.feitos, 0); assert.equal(p2.statements.length, 0);
});

test("orçamento: em rodadas pequenas nada se perde e cada rodada respeita o teto", () => {
  const db = total(V1, []);
  const teto = 60;   // maior que a unidade mais cara (Chansey ex: 5 palavras trocadas = 42), menor que o total
  let rodadas = 0;
  for (;;) {
    const p = planoV(db, V2, teto);
    assert.ok(p.custo <= teto, `rodada ${rodadas}: custo ${p.custo} > ${teto}`);
    if (!p.statements.length) { assert.equal(p.pendentes, 0); break; }
    aplica(db, p.statements);
    if (++rodadas > 20) assert.fail("não convergiu");
  }
  assert.ok(rodadas >= 2, "o teto era pra obrigar mais de uma rodada");
  assert.deepEqual(estado(db).cards, estado(total(V2, [])).cards);
  assert.deepEqual(estado(db).words, estado(total(V2, [])).words);
});

test("orçamento menor que a menor unidade: não grava nada e deixa tudo pendente", () => {
  const p = planoV(total(V1, []), V2, 1);
  assert.equal(p.feitos, 0); assert.equal(p.custo, 0); assert.equal(p.pendentes, 4);
  assert.equal(p.statements.length, 0);
});

test("interrupção em QUALQUER statement: a rodada seguinte conserta tudo", () => {
  const completo = planoV(total(V1, []), V2).statements;
  assert.ok(completo.length >= 4);
  for (let k = 0; k < completo.length; k++) {
    const db = total(V1, []);
    aplica(db, completo.slice(0, k));   // morreu antes do statement k
    // Nunca fica carta "pronta" (h/hw batendo) sem as suas palavras.
    for (const c of V2) {
      const r = remotosCartas(db).get(c.linha.id);
      if (r && r.h === c.h && r.hw === c.hw) {
        const n = db.prepare("SELECT COUNT(*) AS n FROM card_words WHERE game=? AND id=?").get(G, c.linha.id).n;
        assert.equal(n, c.words.length, `parou em ${k}: ${c.linha.id} pronta sem palavras`);
      }
    }
    aplica(db, planoV(db, V2).statements);
    assert.deepEqual(estado(db).cards, estado(total(V2, [])).cards, `parou em ${k}`);
    assert.deepEqual(estado(db).words, estado(total(V2, [])).words, `parou em ${k}`);
  }
});

test("preços: diferença, orçamento e idempotência", () => {
  const db = total([], P1);
  const d = diffPrecos(new Map(P2.map((p) => [p.id, p.h])), remotosPrecos(db));
  assert.deepEqual(d, { gravar: ["base1-2", "base1-6"], remover: ["base1-4"] });
  const p = planoP(db, P2, CUSTO.preco * 2);
  assert.equal(p.feitos, 2); assert.equal(p.pendentes, 1);
  aplica(db, p.statements);
  aplica(db, planoP(db, P2).statements);
  assert.deepEqual(estado(db).prices, estado(total([], P2)).prices);
  assert.equal(planoP(db, P2).statements.length, 0);
});

test("statements ficam abaixo do teto do D1 mesmo com muitas cartas", () => {
  const muitas = Array.from({ length: 3000 }, (_, i) => carta(`big-${i}`, `Carta número ${i} com nome comprido o bastante`, { image: `https://img.example/${"x".repeat(80)}/${i}.png` }));
  const p = planoV(banco(), muitas);
  for (const s of p.statements) assert.ok(s.length <= 100 * 1024, `statement de ${s.length} bytes`);
  assert.ok(p.statements.length > 3);
  const db = banco(); aplica(db, p.statements);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cards").get().n, 3000);
});
