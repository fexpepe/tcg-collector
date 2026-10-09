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
  assert.deepEqual(d, { novos: ["base1-6"], palavras: ["base1-3"], linha: ["base1-4"], acrescentar: [], remover: ["base1-5"], jaTem: new Map() });
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

// ── Palavras EXTRAS (réguas, ver cardRows): só acréscimo ─────────────────────
// O banco remoto foi carregado numa régua ANTERIOR de palavras. `remoto` grava
// cada carta como ela estaria lá: as n primeiras palavras e a impressão
// daquela régua. `qual(c)` escolhe a régua de cada carta — um item de
// c.anteriores, ou null pra carta já em dia.
function remoto(cards, qual) {
  const db = banco();
  const ins = db.prepare(`INSERT INTO cards (${COLUNAS.join(",")}) VALUES (${COLUNAS.map(() => "?").join(",")})`);
  const insW = db.prepare("INSERT INTO card_words (game,word,id) VALUES (?,?,?)");
  for (const c of cards) {
    const a = qual(c);
    ins.run(...COLUNAS.map((k) => (k === "hw" && a ? a.hw : c.linha[k])));
    for (const w of a ? c.words.slice(0, a.n) : c.words) insW.run(w.game, w.word, w.id);
  }
  return db;
}
// A régua ORIGINAL (a da carga inicial, sem extra nenhuma).
const legado = (cards) => remoto(cards, (c) => c.anteriores[0] || null);

const comTotal = (id, name) => carta(id, name, { setTotal: 102 });
const VT = [comTotal("base1-1", "Alakazam"), comTotal("base1-2", "Blastoise"), comTotal("base1-4", "Charizard")];

test("extras: carta com total tem a régua original como anterior; sem total, nenhuma", () => {
  const c = comTotal("x-1", "Pikachu");
  assert.deepEqual(c.extras.map((w) => w.word), ["102"]);
  assert.deepEqual(c.anteriores.map((a) => a.n), [c.words.length - 1]);
  assert.notEqual(c.anteriores[0].hw, c.hw);
  assert.deepEqual(carta("x-1", "Pikachu").anteriores, []);
  // A régua legada é EXATAMENTE a de antes: mesma impressão que a carta sem total.
  assert.equal(c.anteriores[0].hw, carta("x-1", "Pikachu").hw);
});

test("extras: banco na régua legada só recebe as palavras novas (sem reescrever as demais)", () => {
  const db = legado(VT);
  const d = diffCartas(mapa(VT), remotosCartas(db));
  assert.deepEqual(d.acrescentar, VT.map((c) => c.linha.id));
  assert.deepEqual(d.palavras, []);
  const p = planoV(db, VT);
  // Custo = linha + 1 palavra por carta — não 2× todas as palavras.
  assert.equal(p.custo, VT.length * (CUSTO.carta + CUSTO.palavra));
  assert.ok(p.custo < VT.length * (CUSTO.carta + CUSTO.palavra * 2 * VT[0].words.length) / 3);
  // Nenhum DELETE genérico das palavras da carta (só o das extras).
  for (const s of p.statements) {
    if (/^DELETE FROM card_words/.test(s)) assert.match(s, /word IN \('102'\)/, s);
  }
  aplica(db, p.statements);
  assert.deepEqual(estado(db).cards, estado(total(VT, [])).cards);
  assert.deepEqual(estado(db).words, estado(total(VT, [])).words);
  assert.equal(planoV(db, VT).statements.length, 0);
});

test("extras: interrupção em qualquer statement não duplica palavra nem deixa carta pronta sem elas", () => {
  const completo = planoV(legado(VT), VT).statements;
  for (let k = 0; k < completo.length; k++) {
    const db = legado(VT);
    aplica(db, completo.slice(0, k));
    aplica(db, planoV(db, VT).statements);
    assert.deepEqual(estado(db).cards, estado(total(VT, [])).cards, `parou em ${k}`);
    assert.deepEqual(estado(db).words, estado(total(VT, [])).words, `parou em ${k}`);
  }
});

test("extras: orçamento pequeno converge em rodadas sem perder nada", () => {
  const db = legado(VT);
  let rodadas = 0;
  for (;;) {
    const p = planoV(db, VT, CUSTO.carta + CUSTO.palavra);
    if (!p.statements.length) break;
    aplica(db, p.statements);
    if (++rodadas > 10) assert.fail("não convergiu");
  }
  assert.equal(rodadas, VT.length);
  assert.deepEqual(estado(db).words, estado(total(VT, [])).words);
});

// ── 2ª régua: a espécie (pokemonName, 08/10/2026) ───────────────────────────
// Produção está na 1ª régua (total do set + nameEn): o banco de HOJE é a carga
// total do mesmo catálogo sem a espécie. A carta japonesa sem nameEn só ganha
// a palavra da espécie, sem apagar e reescrever as que já tem. Medido no
// catálogo do Pokémon: 16.509 das 16.513 cartas que ganham a espécie já têm o
// total do set — pela reescrita seriam ~950 mil escritas (o orçamento do dia
// inteiro); acrescentando, ~100 mil.
const CRUAS_JA = [
  { id: "M2-116-ja", name: "メガリザードンXex", pokemonName: "Charizard" },
  { id: "M2-4-ja", name: "リザードン", pokemonName: "Charizard" },
  { id: "M2-25-ja", name: "ピカチュウ", pokemonName: "Pikachu" },
  { id: "M2-1-ja", name: "フシギダネ", pokemonName: "Bulbasaur", nameEn: "Bulbasaur" },   // o nameEn já traz a espécie
  { id: "M2-30-ja", name: "ミスター・バリヤード", pokemonName: "Mr. Mime" }                  // espécie de duas palavras
];
const ja = ({ id, name, ...extra }) => carta(id, name, { language: "ja", setTotal: 80, ...extra });
const VJ = CRUAS_JA.map(ja);
const HOJE = CRUAS_JA.map(({ pokemonName, ...c }) => ja(c));   // o catálogo antes da 2ª régua

test("2ª régua: a régua anterior da carta é EXATAMENTE a impressão que está em produção", () => {
  assert.deepEqual(VJ[0].extras.map((w) => w.word), ["80", "charizard"]);
  assert.deepEqual(VJ[4].extras.map((w) => w.word), ["80", "mr", "mime"]);
  for (const [i, c] of VJ.entries()) {
    if (i === 3) continue;
    assert.deepEqual(c.anteriores.map((a) => a.hw), [carta(c.linha.id, c.linha.name, { language: "ja" }).hw, HOJE[i].hw], c.linha.id);
    assert.equal(c.anteriores[1].n, HOJE[i].words.length);
  }
  // Espécie que já era palavra (nameEn, ou o nome da carta EN): nada muda.
  assert.equal(VJ[3].hw, HOJE[3].hw);
  assert.deepEqual(VJ[3].anteriores.map((a) => a.n), [VJ[3].words.length - 2]);   // só a original (sem total e nameEn)
  const en = (extra) => carta("sv3-125", "Charizard ex", { setTotal: 197, ...extra });
  assert.equal(en({ pokemonName: "Charizard" }).hw, en().hw);
});

test("2ª régua: produção recebe só a espécie, sem reescrever as palavras das cartas", () => {
  const db = total(HOJE, []);
  const d = diffCartas(mapa(VJ), remotosCartas(db));
  assert.deepEqual(d.acrescentar, ["M2-116-ja", "M2-4-ja", "M2-25-ja", "M2-30-ja"]);
  assert.deepEqual([d.novos, d.palavras, d.linha, d.remover], [[], [], [], []]);
  const p = planoV(db, VJ);
  // Custo = linha + as palavras da espécie (charizard ×2, pikachu, mr + mime) —
  // não 2× todas as palavras.
  assert.equal(p.custo, 4 * CUSTO.carta + 5 * CUSTO.palavra);
  // Só o DELETE das palavras que faltam (sobra de tentativa interrompida), um
  // por conjunto: as duas Charizard juntas.
  const deletes = p.statements.filter((s) => /^DELETE FROM card_words/.test(s));
  assert.equal(deletes.length, 3);
  for (const s of deletes) assert.match(s, /word IN \(('charizard'|'pikachu'|'mr','mime')\) AND id IN/, s);
  aplica(db, p.statements);
  assert.deepEqual(estado(db).cards, estado(total(VJ, [])).cards);
  assert.deepEqual(estado(db).words, estado(total(VJ, [])).words);
  assert.equal(planoV(db, VJ).statements.length, 0);
});

test("réguas: carta ainda na régua ORIGINAL recebe o total e a espécie numa vez só", () => {
  const db = legado(VJ);
  const d = diffCartas(mapa(VJ), remotosCartas(db));
  assert.deepEqual(d.acrescentar, VJ.map((c) => c.linha.id));
  assert.deepEqual(d.palavras, []);
  const p = planoV(db, VJ);
  assert.equal(p.custo, VJ.reduce((s, c) => s + CUSTO.carta + CUSTO.palavra * c.extras.length, 0));
  for (const s of p.statements) {
    if (/^DELETE FROM card_words/.test(s)) assert.match(s, /word IN \('80',/, s);
  }
  aplica(db, p.statements);
  assert.deepEqual(estado(db).cards, estado(total(VJ, [])).cards);
  assert.deepEqual(estado(db).words, estado(total(VJ, [])).words);
});

// Banco com as cartas em réguas diferentes, mais uma renomeada, uma nova e uma
// que sumiu: o caso de um deploy de verdade.
const NOVA = ja({ id: "M2-50-ja", name: "ミュウツー", pokemonName: "Mewtwo" });
const LOCAL = [...VJ, NOVA];
function misturado() {
  const renomeada = ja({ id: "M2-30-ja", name: "バリヤード", pokemonName: "Mr. Mime" });
  const sumiu = ja({ id: "M2-99-ja", name: "ミュウ", pokemonName: "Mew" });
  // M2-116-ja na 1ª régua (produção), M2-4-ja na original, M2-25-ja e M2-1-ja em dia.
  return remoto([HOJE[0], VJ[1], VJ[2], VJ[3], renomeada, sumiu], (c) => (c === VJ[1] ? c.anteriores[0] : null));
}

test("réguas misturadas: cada carta recebe o que falta a partir da régua em que está", () => {
  const db = misturado();
  const d = diffCartas(mapa(LOCAL), remotosCartas(db));
  assert.deepEqual(d.novos, ["M2-50-ja"]);
  assert.deepEqual(d.palavras, ["M2-30-ja"]);
  assert.deepEqual(d.acrescentar, ["M2-116-ja", "M2-4-ja"]);
  assert.deepEqual([...d.jaTem], [["M2-116-ja", HOJE[0].words.length], ["M2-4-ja", VJ[1].anteriores[0].n]]);
  assert.deepEqual(d.remover, ["M2-99-ja"]);
  aplica(db, planoV(db, LOCAL).statements);
  assert.deepEqual(estado(db).cards, estado(total(LOCAL, [])).cards);
  assert.deepEqual(estado(db).words, estado(total(LOCAL, [])).words);
  assert.equal(planoV(db, LOCAL).statements.length, 0);
});

test("réguas misturadas: interrupção em QUALQUER statement — nada duplica, nada fica pronto sem palavra", () => {
  const completo = planoV(misturado(), LOCAL).statements;
  assert.ok(completo.length >= 5);
  for (let k = 0; k < completo.length; k++) {
    const db = misturado();
    aplica(db, completo.slice(0, k));
    for (const c of LOCAL) {
      const r = remotosCartas(db).get(c.linha.id);
      if (r && r.h === c.h && r.hw === c.hw) {
        const n = db.prepare("SELECT COUNT(*) AS n FROM card_words WHERE game=? AND id=?").get(G, c.linha.id).n;
        assert.equal(n, c.words.length, `parou em ${k}: ${c.linha.id} pronta sem as palavras`);
      }
    }
    aplica(db, planoV(db, LOCAL).statements);
    assert.deepEqual(estado(db).cards, estado(total(LOCAL, [])).cards, `parou em ${k}`);
    assert.deepEqual(estado(db).words, estado(total(LOCAL, [])).words, `parou em ${k}`);
  }
});

test("réguas misturadas: orçamento pequeno converge em rodadas, cada uma no teto", () => {
  const db = misturado();
  // A unidade mais cara é a renomeada (todas as palavras apagadas e regravadas).
  const teto = CUSTO.carta + CUSTO.palavra * 2 * VJ[4].words.length;
  let rodadas = 0;
  for (;;) {
    const p = planoV(db, LOCAL, teto);
    assert.ok(p.custo <= teto, `rodada ${rodadas}: custo ${p.custo} > ${teto}`);
    if (!p.statements.length) { assert.equal(p.pendentes, 0); break; }
    aplica(db, p.statements);
    if (++rodadas > 20) assert.fail("não convergiu");
  }
  assert.ok(rodadas >= 2, "o teto era pra obrigar mais de uma rodada");
  assert.deepEqual(estado(db).cards, estado(total(LOCAL, [])).cards);
  assert.deepEqual(estado(db).words, estado(total(LOCAL, [])).words);
});

test("acrescentar sem o corte da régua remota: o plano falha em vez de duplicar palavras", () => {
  const diff = { novos: [], palavras: [], linha: [], acrescentar: ["M2-116-ja"], remover: [] };
  assert.throws(() => planoCartas(G, diff, mapa(VJ), Infinity), /corte da régua remota/);
});

test("statements ficam abaixo do teto do D1 mesmo com muitas cartas", () => {
  const muitas = Array.from({ length: 3000 }, (_, i) => carta(`big-${i}`, `Carta número ${i} com nome comprido o bastante`, { image: `https://img.example/${"x".repeat(80)}/${i}.png` }));
  const p = planoV(banco(), muitas);
  for (const s of p.statements) assert.ok(s.length <= 100 * 1024, `statement de ${s.length} bytes`);
  assert.ok(p.statements.length > 3);
  const db = banco(); aplica(db, p.statements);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cards").get().n, 3000);
});
