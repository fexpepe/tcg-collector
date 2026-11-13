// Migração do Miracle Battle pro jogo mbc (src/migra-mbc.js, 2026-10-01): a
// carta op-mb-/nrt-mb-/hxh-mb- que a pessoa marcou quando ela era linha do
// One Piece, do Naruto ou do HxH muda de gaveta sem se perder, e a cópia velha
// (da nuvem, de outro aparelho) não ressuscita no jogo da marca.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

const migraSrc = readFileSync(new URL("../src/migra-mbc.js", import.meta.url), "utf8");
const k = (base, g) => `tcg-collector-${g}-${base}`;

function roda(seed) {
  const ls = makeLocalStorage(Object.fromEntries(Object.entries(seed).map(([kk, v]) => [kk, JSON.stringify(v)])));
  const sb = loadShared("window.__test = { mergeCollection: (...a) => mergeCollection(...a) };", { localStorage: ls });
  vm.runInContext(migraSrc, sb);
  const jogos = sb.TCGMigraMbc();
  const ler = (kk) => JSON.parse(ls.getItem(kk) || "null");
  return { jogos, ler, sb };
}

test("coleção: a carta vai pro mbc com o carimbo dela, e fica tombstone no jogo da marca", () => {
  const { jogos, ler, sb } = roda({
    [k("collection-v3", "onepiece")]: { "op-mb-op01-23": { Normal: { NM: 2 } }, "op-123": { Normal: { NM: 1 } } },
    [k("collection-meta-v1", "onepiece")]: { mod: { "op-mb-op01-23": 1000, "op-123": 2000 }, del: {} },
    [k("collection-v3", "naruto")]: { "nrt-mb-nr01-7": { Normal: { LP: 1 } } }
  });
  assert.deepEqual([...jogos].sort(), ["mbc", "naruto", "onepiece"]);
  assert.deepEqual(ler(k("collection-v3", "mbc")), { "op-mb-op01-23": { Normal: { NM: 2 } }, "nrt-mb-nr01-7": { Normal: { LP: 1 } } });
  assert.equal(ler(k("collection-meta-v1", "mbc")).mod["op-mb-op01-23"], 1000);
  // O resto do One Piece fica intacto.
  assert.deepEqual(ler(k("collection-v3", "onepiece")), { "op-123": { Normal: { NM: 1 } } });
  const metaOp = ler(k("collection-meta-v1", "onepiece"));
  assert.equal(metaOp.mod["op-123"], 2000);
  assert.ok(metaOp.del["op-mb-op01-23"] > 1000, "sem tombstone a cópia da nuvem voltava");
  // E a cópia velha da nuvem (carimbo antigo) NÃO volta pro One Piece no merge.
  const nuvem = { "op-mb-op01-23": { Normal: { NM: 2 } } };
  const r = sb.__test.mergeCollection(ler(k("collection-v3", "onepiece")), metaOp, nuvem, { mod: { "op-mb-op01-23": 1000 }, del: {} });
  assert.ok(!r.collection["op-mb-op01-23"]);
});

test("conflito: o que o mbc já tem e é mais novo vence a cópia velha do jogo da marca", () => {
  const { ler } = roda({
    [k("collection-v3", "onepiece")]: { "op-mb-op01-23": { Normal: { NM: 2 } } },
    [k("collection-meta-v1", "onepiece")]: { mod: { "op-mb-op01-23": 1000 }, del: {} },
    [k("collection-v3", "mbc")]: { "op-mb-op01-23": { Normal: { NM: 5 } } },
    [k("collection-meta-v1", "mbc")]: { mod: { "op-mb-op01-23": 9000 }, del: {} }
  });
  assert.deepEqual(ler(k("collection-v3", "mbc"))["op-mb-op01-23"], { Normal: { NM: 5 } });
});

test("conflito: carta apagada no mbc depois não ressuscita pela cópia velha", () => {
  const { ler } = roda({
    [k("collection-v3", "hxh")]: { "hxh-mb-hh01-3": { Normal: { NM: 1 } } },
    [k("collection-meta-v1", "hxh")]: { mod: { "hxh-mb-hh01-3": 1000 }, del: {} },
    [k("collection-meta-v1", "mbc")]: { mod: {}, del: { "hxh-mb-hh01-3": 5000 } }
  });
  assert.ok(!(ler(k("collection-v3", "mbc")) || {})["hxh-mb-hh01-3"]);
  assert.ok(!ler(k("collection-v3", "hxh"))["hxh-mb-hh01-3"]);
});

test("desejos e preço manual também mudam de jogo", () => {
  const { ler } = roda({
    [k("wishlist-v1", "naruto")]: { "nrt-mb-nr05-40": ["Normal"], "nrt-s01-1": ["Normal"] },
    [k("wishlist-meta-v1", "naruto")]: { mod: { "nrt-mb-nr05-40": 3000 }, del: {} },
    [k("collection-v3", "naruto")]: { "nrt-mb-nr05-40": { Normal: { NM: 1 } } },
    [k("prices-v1", "naruto")]: { "nrt-mb-nr05-40": { Normal: { prices: { NM: 12 }, at: { NM: "2026-09-01T10:00:00Z" }, source: "manual", updatedAt: "2026-09-01" } } }
  });
  assert.deepEqual(ler(k("wishlist-v1", "mbc")), { "nrt-mb-nr05-40": ["Normal"] });
  assert.deepEqual(ler(k("wishlist-v1", "naruto")), { "nrt-s01-1": ["Normal"] });
  assert.ok(ler(k("wishlist-meta-v1", "naruto")).del["nrt-mb-nr05-40"]);
  assert.equal(ler(k("prices-v1", "mbc"))["nrt-mb-nr05-40"].Normal.prices.NM, 12);
  assert.deepEqual(ler(k("prices-v1", "naruto")), {});
});

test("lista só de Miracle Battle vira mbc; misturada fica sem jogo; venda realizada aponta pro mbc", () => {
  const { ler } = roda({
    [k("collection-v3", "onepiece")]: { "op-mb-op01-23": { Normal: { NM: 1 } } },
    "tcg-collector-lists-all-v1": { deleted: {}, lists: [
      { id: "a", game: "onepiece", entries: [{ id: "op-mb-op01-23", v: "Normal" }], updatedAt: 1 },
      { id: "b", game: "onepiece", entries: [{ id: "op-mb-op01-23" }, { id: "op-123" }], updatedAt: 1 },
      { id: "c", game: "onepiece", entries: [{ id: "op-123" }], updatedAt: 1 }
    ] },
    "tcg-collector-collection-sold-v1": { order: ["s1", "s2"], updatedAt: 1, items: {
      s1: { cardId: "op-mb-op01-23", game: "onepiece" }, s2: { cardId: "op-123", game: "onepiece" }
    } }
  });
  const listas = ler("tcg-collector-lists-all-v1").lists;
  assert.equal(listas[0].game, "mbc");
  assert.equal(listas[1].game, null);
  assert.equal(listas[2].game, "onepiece");
  assert.ok(listas[0].updatedAt > 1, "sem carimbo novo o merge das listas trazia o jogo velho de volta");
  assert.equal(listas[2].updatedAt, 1);
  const vendidas = ler("tcg-collector-collection-sold-v1");
  assert.equal(vendidas.items.s1.game, "mbc");
  assert.equal(vendidas.items.s2.game, "onepiece");
  assert.ok(vendidas.updatedAt > 1);
});

test("Gundam Carddass: carta gcd- marcada no gundam vai pro jogo gcd, e a do Gundam Card Game fica", () => {
  const { jogos, ler } = roda({
    [k("collection-v3", "gundam")]: { "gcd-wd01-1": { Normal: { NM: 1 } }, "gcg-616678": { Normal: { NM: 3 } } },
    [k("collection-meta-v1", "gundam")]: { mod: { "gcd-wd01-1": 1000, "gcg-616678": 2000 }, del: {} },
    [k("wishlist-v1", "gundam")]: { "gcd-gd01-1": ["Normal"] },
    [k("collection-v3", "onepiece")]: { "op-mb-op01-23": { Normal: { NM: 2 } } }
  });
  assert.deepEqual([...jogos].sort(), ["gcd", "gundam", "mbc", "onepiece"]);
  assert.deepEqual(ler(k("collection-v3", "gcd")), { "gcd-wd01-1": { Normal: { NM: 1 } } });
  assert.equal(ler(k("collection-meta-v1", "gcd")).mod["gcd-wd01-1"], 1000);
  assert.deepEqual(ler(k("collection-v3", "gundam")), { "gcg-616678": { Normal: { NM: 3 } } });
  assert.ok(ler(k("collection-meta-v1", "gundam")).del["gcd-wd01-1"] > 1000);
  assert.ok(ler(k("wishlist-v1", "gcd"))["gcd-gd01-1"]);
  // cada destino recebe só o seu
  assert.deepEqual(Object.keys(ler(k("collection-v3", "mbc"))), ["op-mb-op01-23"]);
});

test("NARUTO CARD GAME: a Chakra Card (nrt-ncg-) marcada no naruto vai pro narutocg, e o vintage fica", () => {
  const { jogos, ler } = roda({
    [k("collection-v3", "naruto")]: { "nrt-ncg-cp-001": { Normal: { NM: 1 } }, "nrt-s01-1": { Normal: { LP: 2 } } },
    [k("collection-meta-v1", "naruto")]: { mod: { "nrt-ncg-cp-001": 1000, "nrt-s01-1": 2000 }, del: {} },
    [k("wishlist-v1", "naruto")]: { "nrt-ncg-717838": ["Normal"] },
    [k("prices-v1", "naruto")]: { "nrt-ncg-cp-001": { Normal: { prices: { NM: 5000 }, at: { NM: "2026-10-01T10:00:00Z" }, source: "manual", updatedAt: "2026-10-01" } } }
  });
  assert.deepEqual([...jogos].sort(), ["naruto", "narutocg"]);
  assert.deepEqual(ler(k("collection-v3", "narutocg")), { "nrt-ncg-cp-001": { Normal: { NM: 1 } } });
  assert.equal(ler(k("collection-meta-v1", "narutocg")).mod["nrt-ncg-cp-001"], 1000);
  assert.deepEqual(ler(k("collection-v3", "naruto")), { "nrt-s01-1": { Normal: { LP: 2 } } });
  assert.ok(ler(k("collection-meta-v1", "naruto")).del["nrt-ncg-cp-001"] > 1000, "sem tombstone a cópia da nuvem voltava pro naruto");
  assert.ok(ler(k("wishlist-v1", "narutocg"))["nrt-ncg-717838"]);
  assert.ok(ler(k("prices-v1", "narutocg"))["nrt-ncg-cp-001"]);
  assert.deepEqual(ler(k("prices-v1", "naruto")), {});
  assert.equal(ler(k("collection-v3", "mbc")), null);
});

test("Dragon Ball Carddass: Super Battle, VA e Barcode Wars marcadas no dbc vão pros jogos delas, e o Hondan fica", () => {
  const { jogos, ler } = roda({
    [k("collection-v3", "dbc")]: { "dbc-sb01-6": { Normal: { NM: 1 } }, "dbc-h01-1": { Normal: { NM: 2 } }, "dbc-bw01-4": { Normal: { LP: 1 } } },
    [k("collection-meta-v1", "dbc")]: { mod: { "dbc-sb01-6": 1000, "dbc-h01-1": 2000, "dbc-bw01-4": 1500 }, del: {} },
    [k("wishlist-v1", "dbc")]: { "dbc-va06-37b": ["Normal"] }
  });
  assert.deepEqual([...jogos].sort(), ["dbbw", "dbc", "dbsb", "dbva"]);
  assert.deepEqual(ler(k("collection-v3", "dbsb")), { "dbc-sb01-6": { Normal: { NM: 1 } } });
  assert.deepEqual(ler(k("collection-v3", "dbbw")), { "dbc-bw01-4": { Normal: { LP: 1 } } });
  assert.equal(ler(k("collection-meta-v1", "dbsb")).mod["dbc-sb01-6"], 1000);
  assert.ok(ler(k("wishlist-v1", "dbva"))["dbc-va06-37b"]);
  assert.deepEqual(ler(k("collection-v3", "dbc")), { "dbc-h01-1": { Normal: { NM: 2 } } });
  assert.ok(ler(k("collection-meta-v1", "dbc")).del["dbc-sb01-6"] > 1000, "sem tombstone a cópia da nuvem voltava pro dbc");
});

test("nada a mover: não escreve nada", () => {
  const { jogos, ler } = roda({ [k("collection-v3", "onepiece")]: { "op-123": { Normal: { NM: 1 } } } });
  assert.equal(jogos.length, 0); // array do sandbox (outro realm): compara o tamanho
  assert.equal(ler(k("collection-v3", "mbc")), null);
});

test("o detector do shared.js só baixa a migração quando há id Miracle Battle no jogo da marca", () => {
  const src = readFileSync(new URL("../src/shared.js", import.meta.url), "utf8");
  // O detector olha os ids que mudam de jogo: Miracle Battle, gcd- e nrt-ncg-.
  const det = /\.some\(\(g\) => (\/.+?\/)\.test\(/.exec(src.slice(src.indexOf("async function moveMiracleBattle")));
  assert.ok(det, "o teste do detector mudou de forma");
  const re = new Function(`return ${det[1]}`)();
  for (const id of ["op-mb-op01-23", "nrt-mb-nr01-7", "hxh-mb-hh01-3", "gcd-wd01-1", "nrt-ncg-cp-001", "dbc-sb01-6", "dbc-va06-37b", "dbc-bw04-168"]) assert.ok(re.test(`{"${id}":1}`), id);
  for (const id of ["nrt-s01-1", "op-123", "gcg-616678", "dbc-h01-1", "dbc-h24-c1a"]) assert.ok(!re.test(`{"${id}":1}`), id);
  assert.match(src, /async function moveMiracleBattle\(subir\)/);
  assert.match(src, /injectScript\("\/src\/migra-mbc\.js"\)/);
  // Os três ganchos: login, abertura com sessão e "Forçar sincronização".
  assert.equal((src.match(/moveMiracleBattle\((mesclado|aSubir)\)/g) || []).length, 3);
});
