// Busca por CÓDIGO de carta (src/shared.js: cardCode, cardCodeForms,
// numberSearchForms, matchesCardQuery, cmdkCardsByCode). O que está travado:
// o código como a carta IMPRIME ("009/094") acha a carta seja como for que o
// catálogo guarde o número ("9" + total 94, "009" + 94, "4/102"), e o
// contrário também — é o padrão de mercado de pesquisa (nome + código) e o que
// o scanner lê na borda da carta. A cópia do build (scripts/lib/card-code.mjs,
// que o prerender usa no <title>/description) tem de dar o MESMO resultado.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared } from "./lib/shared-sandbox.mjs";
import * as build from "../scripts/lib/card-code.mjs";

const sb = loadShared("window.__test = { cardCode, cardCodeForms, numberSearchForms, matchesCardQuery, cmdkCardsByCode, cardLabel };");
const raw = sb.window.__test;
// Arrays nascidos no sandbox (vm) têm outro Array.prototype: copia pro realm
// do teste pra deepEqual comparar conteúdo, não protótipo.
const api = {
  ...raw,
  cardCodeForms: (c) => Array.from(raw.cardCodeForms(c)),
  numberSearchForms: (n) => Array.from(raw.numberSearchForms(n)),
  cmdkCardsByCode: async (q) => Array.from(await raw.cmdkCardsByCode(q))
};

const nymble = { id: "x-9", name: "Nymble", number: "9", setTotal: 94, setId: "x" };
const nymbleJp = { id: "x-9-ja", name: "ヤミラミ", number: "009", setTotal: 94, setId: "x" };
const charizard = { id: "base1-4", name: "Charizard", number: "4/102", setId: "base1" };
const lillia = { id: "rb-1", name: "Lillia", number: "001/003", setTotal: 3, setId: "SGN" };
const luffy = { id: "op-1", name: "Monkey.D.Luffy", number: "OP05-119", setId: "OP-05" };

test("cardCode: total na largura do número zero-preenchido (o impresso), sem mexer no resto", () => {
  assert.equal(api.cardCode(nymbleJp), "009/094");   // antes saía "009/94"
  assert.equal(api.cardCode(nymble), "9/94");
  assert.equal(api.cardCode(charizard), "4/102");
  assert.equal(api.cardCode({ number: "4", setTotal: 102 }), "4/102");
  assert.equal(api.cardCode(lillia), "001/003");
  assert.equal(api.cardCode(luffy), "OP05-119");
  assert.equal(api.cardCode({ number: "" }), "");
  assert.equal(api.cardLabel(nymbleJp), "ヤミラミ (009/094)");
});

test("cardCodeForms: todas as escritas — com/sem zeros, com/sem total", () => {
  const f = api.cardCodeForms(nymble);
  for (const esperado of ["9", "009", "9/94", "009/094"]) assert.ok(f.includes(esperado), `${esperado} em ${f}`);
  const g = api.cardCodeForms(nymbleJp);
  for (const esperado of ["009", "9", "009/094", "9/94"]) assert.ok(g.includes(esperado), `${esperado} em ${g}`);
  const r = api.cardCodeForms(lillia);
  for (const esperado of ["001/003", "1/3", "1", "001"]) assert.ok(r.includes(esperado), `${esperado} em ${r}`);
  assert.deepEqual(api.cardCodeForms(luffy), ["OP05-119", "OP5-119"]);
  assert.ok(api.cardCodeForms({ number: "H01", setTotal: 42 }).includes("H1"));   // vintage One Piece
  assert.deepEqual(api.cardCodeForms({}), []);
});

test("numberSearchForms: número solto (índice estático de decks/listas)", () => {
  assert.deepEqual(api.numberSearchForms("009"), ["009", "9"]);
  assert.deepEqual(api.numberSearchForms("9"), ["9", "009"]);
  assert.deepEqual(api.numberSearchForms("H01"), ["H01", "H1"]);
  assert.deepEqual(api.numberSearchForms("BT1-001"), ["BT1-001"]);
  assert.deepEqual(api.numberSearchForms(""), []);
});

test("matchesCardQuery: código impresso, código cru, nome + código, parênteses e #", () => {
  for (const q of ["009/094", "9/94", "009", "9", "94", "nymble 009/094", "Nymble (009/094)", "nymble #9", "009/094 nymble", "NYMBLE 9/94"]) {
    assert.ok(api.matchesCardQuery(nymble, q), `"${q}" deveria achar a Nymble guardada como 9/94`);
    assert.ok(api.matchesCardQuery(nymbleJp, q.replace(/nymble/i, "ヤミラミ")), `"${q}" deveria achar a guardada como 009/94`);
  }
  for (const q of ["10/94", "9/95", "090/094", "pikachu 9/94"]) {
    assert.ok(!api.matchesCardQuery(nymble, q), `"${q}" NÃO deveria achar a Nymble`);
  }
  assert.ok(api.matchesCardQuery(charizard, "charizard 004/102"));
  assert.ok(api.matchesCardQuery(charizard, "4/102"));
  assert.ok(api.matchesCardQuery(lillia, "1/3"));
  assert.ok(api.matchesCardQuery(luffy, "op05-119"));
  assert.ok(api.matchesCardQuery(luffy, "OP5-119"));
});

test("paleta/scanner: fração 'número/total' resolve a carta pelo total do set (dev: catálogo em memória)", async () => {
  sb.SLEEVU = { game: "pokemon" };
  sb.TCG_CARDS = [nymble, nymbleJp, charizard, { id: "y-9", name: "Outra", number: "9", setTotal: 95, setId: "y" }];
  const ids = (hits) => hits.map((h) => h.card.id).sort();
  assert.deepEqual(ids(await api.cmdkCardsByCode("009/094")), ["x-9", "x-9-ja"]);
  assert.deepEqual(ids(await api.cmdkCardsByCode("9/94")), ["x-9", "x-9-ja"]);
  assert.deepEqual(ids(await api.cmdkCardsByCode("004/102")), ["base1-4"]);
  assert.deepEqual(ids(await api.cmdkCardsByCode("9/95")), ["y-9"]);
  assert.deepEqual(await api.cmdkCardsByCode("9/96"), []);
  // O caminho set + número segue como era.
  assert.deepEqual(ids(await api.cmdkCardsByCode("base1 4")), ["base1-4"]);
});

test("a cópia do build (scripts/lib/card-code.mjs) dá o mesmo resultado que o shared.js", () => {
  const cartas = [nymble, nymbleJp, charizard, lillia, luffy,
    { number: "4", setTotal: 102 }, { number: "H01", setTotal: 42 }, { number: "RC1", setTotal: 113 },
    { number: "TG09", setTotal: 30 }, { number: "0123", setTotal: 281 }, { number: "" }, {}];
  for (const c of cartas) {
    assert.equal(build.cardCode(c), api.cardCode(c), `cardCode divergiu em ${JSON.stringify(c)}`);
    assert.deepEqual(build.cardCodeForms(c), api.cardCodeForms(c), `cardCodeForms divergiu em ${JSON.stringify(c)}`);
  }
  for (const n of ["9", "009", "H01", "BT1-001", ""]) assert.deepEqual(build.numberSearchForms(n), api.numberSearchForms(n));
  // Escritas alternativas pro SEO: o que difere do código principal.
  assert.deepEqual(build.alternateCodes(nymble), ["009/094"]);
  assert.deepEqual(build.alternateCodes(nymbleJp), ["9/94"]);
  assert.deepEqual(build.alternateCodes(charizard), ["004/102"]);
  assert.deepEqual(build.alternateCodes(luffy), []);
});
