// Busca COMPLETA do Explorar (27/09/2026): a Function /api/search com &full=1
// devolve TODAS as cartas que casam, no formato do chunk e com os preços; o
// cliente (searchApiFull/searchRelevance/enrichSetTotals, no shared.js) usa
// isso pra contar, ordenar e rolar o resultado inteiro.
//
// O que motivou: o Explorar pedia 60 cartas sem ordem nenhuma e dizia "60
// resultados" pra "mew" (370 no catálogo); "blue eyes" voltava vazio da borda.
// Banco real (node:sqlite) com o MESMO esquema do D1 e um D1 falso por cima
// (prepare/bind/all/batch), pra rodar a Function como ela roda na borda.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA, SCHEMA_PRICES, cardRows } from "../functions/api/_search-sql.js";
import { onRequestGet } from "../functions/api/search.js";
import { loadShared } from "./lib/shared-sandbox.mjs";

function banco() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  db.exec(SCHEMA_PRICES);
  const carta = db.prepare(`INSERT INTO cards
    (game,id,name,set_name,number,card_type,cost,rarity,color,set_id,artist,language,image,variants,released)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const w = db.prepare("INSERT INTO card_words (game,word,id) VALUES (?,?,?)");
  const poe = (game, c) => {
    const r = cardRows(game, c).linha;
    carta.run(game, r.id, r.name, r.set_name, r.number, r.card_type, r.cost, r.rarity, r.color,
      r.set_id, r.artist, r.language, r.image, r.variants, r.released);
    for (const p of cardRows(game, c).words) w.run(p.game, p.word, p.id);
  };
  poe("pokemon", { id: "sv3pt5-151", name: "Mew", set: "151", setId: "sv3pt5", number: "151", language: "en", variants: ["Normal", "Holo"], setReleaseDate: "2023-09-22", image: "https://img/151.png" });
  poe("pokemon", { id: "sv3pt5-151-pt", name: "Mew", set: "151", setId: "sv3pt5", number: "151", language: "pt", variants: ["Holo"], setReleaseDate: "2023-09-22" });
  poe("pokemon", { id: "sv3pt5-150", name: "Mewtwo", set: "151", setId: "sv3pt5", number: "150", language: "en", setReleaseDate: "2023-09-22" });
  poe("magic", { id: "mtg-1", name: "Mewling Horror", set: "X", setId: "x", number: "1", language: "en", variants: ["Normal", "Foil"], setReleaseDate: "2010-01-01" });
  const preco = db.prepare("INSERT INTO prices (game,id,j) VALUES (?,?,?)");
  preco.run("pokemon", "sv3pt5-151", JSON.stringify({ u: 12.5, v: { Holo: 20 } }));
  preco.run("pokemon", "sv3pt5-150", JSON.stringify({ u: 3 }));
  preco.run("magic", "mtg-1", JSON.stringify({ u: 0.25, uf: 1 }));
  return db;
}

// D1 falso: a API que a Function usa (prepare → bind → all; batch).
function d1(db) {
  return {
    prepare(sql) {
      return {
        bind(...params) { this.params = params; return this; },
        params: [],
        async all() { return { results: db.prepare(sql).all(...this.params) }; }
      };
    },
    async batch(stmts) { return Promise.all(stmts.map((s) => s.all())); }
  };
}

globalThis.caches = { default: { async match() { return null; }, async put() {} } };

async function chama(db, qs) {
  const res = await onRequestGet({ env: { DB: d1(db) }, request: new Request(`https://x/api/search?${qs}`), waitUntil() {} });
  return { status: res.status, corpo: await res.json(), cache: res.headers.get("Cache-Control") };
}

test("&full=1 devolve TODAS as cartas no formato do chunk, com jogo, relevância e total", async () => {
  const { status, corpo } = await chama(banco(), "game=all&q=mew&full=1");
  assert.equal(status, 200);
  assert.equal(corpo.t, 4);
  assert.equal(corpo.c.length, 4);
  // relevância: as duas Mew (palavra inteira) antes de Mewtwo e Mewling
  assert.deepEqual(corpo.c.slice(0, 2).map((c) => c.id).sort(), ["sv3pt5-151", "sv3pt5-151-pt"]);
  assert.deepEqual(corpo.c.slice(0, 2).map((c) => c.x), [1, 1]);
  const mew = corpo.c.find((c) => c.id === "sv3pt5-151");
  // contrato do chunk: o que a grade e o popup leem
  assert.equal(mew.name, "Mew");
  assert.equal(mew.set, "151");
  assert.equal(mew.setId, "sv3pt5");
  assert.equal(mew.language, "en");
  assert.equal(mew.image, "https://img/151.png");
  assert.equal(mew.setReleaseDate, "2023-09-22");
  assert.deepEqual(mew.variants, ["Normal", "Holo"]);
  assert.equal(mew.g, "pokemon");
  assert.equal(corpo.c.find((c) => c.id === "mtg-1").g, "magic");
});

test("&full=1 traz os preços por jogo, incluindo o da carta BASE da localizada", async () => {
  const { corpo } = await chama(banco(), "game=all&q=mew&full=1");
  // a -pt não tem preço próprio: vem o da base, como no /api/collection
  assert.deepEqual(Object.keys(corpo.p).sort(), ["magic", "pokemon"]);
  assert.equal(corpo.p.pokemon["sv3pt5-151"].v.Holo, 20);
  assert.equal(corpo.p.pokemon["sv3pt5-150"].u, 3);
  assert.equal(corpo.p.magic["mtg-1"].uf, 1);
});

test("busca curta (decks, listas, scanner) segue no contrato de sempre, agora com t e x", async () => {
  const { corpo } = await chama(banco(), "game=pokemon&q=mew&limit=2");
  assert.equal(corpo.t, 3);            // total antes do limite
  assert.equal(corpo.c.length, 2);
  assert.equal(corpo.p, undefined);    // sem preço: poucos KB por tecla digitada
  assert.deepEqual(Object.keys(corpo.c[0]).sort(), ["c", "g", "i", "k", "n", "r", "s", "t", "u", "x"]);
  assert.equal(corpo.c[0].n, "Mew");
});

test("vazio não vai pro cache (nem o do navegador)", async () => {
  const { corpo, cache } = await chama(banco(), "game=all&q=zzzz&full=1");
  assert.deepEqual(corpo, { t: 0, c: [], p: {} });
  assert.equal(cache, "no-store");
});

// ── Cliente ──────────────────────────────────────────────────────────────────
const sb = loadShared("window.__test = { searchRelevance, searchApiFull, enrichSetTotals, cardLabel };");
const api = sb.window.__test;

test("relevância: nome inteiro > começo de palavra > meio > fora do nome", () => {
  const c = (name, extra) => Object.assign({ id: name, name, number: "1" }, extra || {});
  const r = (card, q) => api.searchRelevance(card, q);
  assert.equal(r(c("Mew"), "mew"), 3);
  assert.equal(r(c("Mew ex"), "mew"), 3);
  assert.equal(r(c("Team Rocket's Mew"), "mew"), 3);
  assert.equal(r(c("Mewtwo"), "mew"), 2);
  assert.equal(r(c("Pikachu", { artist: "Mew Studio" }), "mew"), 0);
  assert.equal(r(c("Pikachu"), "kachu"), 1);
  // acento não conta, e o nameEn da carta japonesa entra no nome
  assert.equal(r(c("Pokémon Catcher"), "pokemon"), 3);
  assert.equal(r(c("ミュウ", { nameEn: "Mew" }), "mew"), 3);
  // duas palavras somam: "Mew ex" > "Mewtwo ex" > "Mew" (o ex só no set)
  assert.ok(r(c("Mew ex"), "mew ex") > r(c("Mewtwo ex"), "mew ex"));
  assert.ok(r(c("Mewtwo ex"), "mew ex") > r(c("Mew", { set: "EX Holon" }), "mew ex"));
});

test("relevância: carta de nome japonês vinda da borda usa o _x (sem nameEn na mão)", () => {
  // ミュウ achada pela palavra "mew" (nameEn indexado no D1): _x = 1
  assert.equal(api.searchRelevance({ id: "a", name: "ミュウ", number: "1", _x: 1 }, "mew"), 3);
  // ミュウツー achada por prefixo (mewtwo): _x = 0 — fica no nível do Mewtwo
  assert.equal(api.searchRelevance({ id: "b", name: "ミュウツー", number: "1", _x: 0 }, "mew"), 2);
  // _x conta os termos numéricos (igualdade): eles não viram ponto de nome
  assert.equal(api.searchRelevance({ id: "c", name: "ミュウ", number: "151", _x: 2 }, "mew 151"), 3 + 3);
});

test("relevância: número buscado vale quando é o NÚMERO da carta, não o total do set", () => {
  assert.equal(api.searchRelevance({ id: "a", name: "A", number: "94" }, "94"), 3);
  assert.equal(api.searchRelevance({ id: "b", name: "B", number: "9", setTotal: 94 }, "94"), 0);
  assert.equal(api.searchRelevance({ id: "c", name: "Charizard", number: "4/102" }, "charizard 4"), 6);
});

test("searchApiFull: une os preços, marca jogo e _x, e diz se veio cortado", async () => {
  sb.fetch = async (url) => {
    assert.match(String(url), /\/api\/search\?game=all&q=mew&full=1$/);
    return {
      ok: true, status: 200,
      json: async () => ({
        t: 5,
        c: [{ id: "a", name: "Mew", g: "pokemon", x: 1 }, { id: "b", name: "Mewling", g: "magic", x: 0 }],
        p: { pokemon: { a: { u: 1 } }, magic: { b: { u: 2 } } }
      })
    };
  };
  const r = await api.searchApiFull("all", "mew");
  assert.equal(r.total, 5);
  assert.equal(r.truncated, true);
  assert.deepEqual(r.cards.map((c) => [c.id, c.game, c._x, "g" in c, "x" in c]), [["a", "pokemon", 1, false, false], ["b", "magic", 0, false, false]]);
  assert.deepEqual(Object.keys(r.pricing).sort(), ["a", "b"]);
});

test("searchApiFull: resposta sem o modo completo (Function antiga) cai no caminho estático", async () => {
  sb.fetch = async () => ({ ok: true, status: 200, json: async () => ({ c: [{ i: "a", n: "Mew" }] }) });
  assert.equal(await api.searchApiFull("all", "mew"), null);
});

test("enrichSetTotals: o total do set vem do manifest (id + idioma) e o código volta a ser 063/197", async () => {
  sb.fetch = async (url) => {
    assert.match(String(url), /manifest\.generated\.js$/);
    const manifest = { sets: [
      { id: "sv3pt5", language: "en", total: 165 },
      { id: "sv3pt5", language: "pt", total: 166 }
    ] };
    return { ok: true, status: 200, text: async () => `window.TCG_MANIFEST = ${JSON.stringify(manifest)};` };
  };
  const en = { id: "sv3pt5-063", name: "Mewtwo", number: "063", setId: "sv3pt5", language: "en", game: "pokemon" };
  const pt = { id: "sv3pt5-063-pt", name: "Mewtwo", number: "063", setId: "sv3pt5", language: "pt", game: "pokemon" };
  const semSet = { id: "z", name: "Z", number: "1", setId: "nao-existe", language: "en", game: "pokemon" };
  assert.equal(api.cardLabel(en), "Mewtwo (063)");
  assert.equal(await api.enrichSetTotals([en, pt, semSet]), true);
  assert.equal(en.setTotal, 165);
  assert.equal(pt.setTotal, 166);
  assert.equal(semSet.setTotal, undefined);
  assert.equal(api.cardLabel(en), "Mewtwo (063/165)");
});
