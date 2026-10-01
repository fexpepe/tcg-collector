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

test("nada a mover: não escreve nada", () => {
  const { jogos, ler } = roda({ [k("collection-v3", "onepiece")]: { "op-123": { Normal: { NM: 1 } } } });
  assert.equal(jogos.length, 0); // array do sandbox (outro realm): compara o tamanho
  assert.equal(ler(k("collection-v3", "mbc")), null);
});

test("o detector do shared.js só baixa a migração quando há id Miracle Battle no jogo da marca", () => {
  const src = readFileSync(new URL("../src/shared.js", import.meta.url), "utf8");
  assert.match(src, /async function moveMiracleBattle\(subir\)/);
  assert.match(src, /injectScript\("\/src\/migra-mbc\.js"\)/);
  // Os três ganchos: login, abertura com sessão e "Forçar sincronização".
  assert.equal((src.match(/moveMiracleBattle\((mesclado|aSubir)\)/g) || []).length, 3);
});
