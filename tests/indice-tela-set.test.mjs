// A tela de set não baixa índice (2026-10-08).
//
// O detail.html declara `indexes:auto`, e o game.js escolhia a fatia pelo
// ?type= da URL. A tela de SET não lê fatia nenhuma (resolve pelo manifest e
// pelo chunk do set), mas pedia a `sets` (102 KB no Pokémon) e, no endereço
// /games/<jogo>/<set> — sem ?type= —, a `pokedex` (224 KB, 926 KB de JSON). O
// catalogReady espera todos os arquivos, então o chunk do set só descia depois
// dela: +1,1 s no primeiro tile no 4G lento, medido em produção. A mesma falta
// do ?type= acendia a aba Pokédex na tela de set (o shared.js lê o
// window.SLEEVU.tipo que o game.js agora deduz pelo caminho).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const GAME = readFileSync(join(raiz, "src/game.js"), "utf8");
const CATALOGO_DO_DETAIL = /src="src\/game\.js" data-catalog="([^"]+)"/.exec(readFileSync(join(raiz, "detail.html"), "utf8"))[1];

// Roda o game.js como no <head> do detail.html e devolve o que ele pediu.
function pedidos(pathname, search = "") {
  const scripts = [], fetches = [];
  const attrs = new Map();
  const el = () => ({ setAttribute() {}, getAttribute: () => null, appendChild: (x) => x, style: {}, dataset: {} });
  const head = { appendChild: (s) => { if (s && s.src) scripts.push(s.src); return s; } };
  const document = {
    currentScript: { getAttribute: (n) => (n === "data-catalog" ? CATALOGO_DO_DETAIL : null) },
    documentElement: { setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null), hasAttribute: (k) => attrs.has(k), removeAttribute: (k) => attrs.delete(k), classList: { add() {}, remove() {} }, style: {}, dataset: {} },
    head, createElement: () => el(), querySelector: () => null, addEventListener() {}, cookie: ""
  };
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const sandbox = {
    document, localStorage: storage, sessionStorage: storage,
    location: { pathname, search, hash: "", origin: "https://sleevu.app", href: "https://sleevu.app" + pathname + search, replace() {} },
    history: { state: null, replaceState() {} },
    navigator: { language: "pt-BR", languages: ["pt-BR"] },
    fetch: (u) => { fetches.push(String(u)); return new Promise(() => {}); },
    URLSearchParams, URL, matchMedia: () => ({ matches: false }), addEventListener() {},
    setTimeout: () => 0 // o teto do catalogReady (30 s) não dispara aqui
  };
  sandbox.window = sandbox;
  vm.runInNewContext(GAME, sandbox);
  return { scripts, fetches, tipo: sandbox.SLEEVU && sandbox.SLEEVU.tipo };
}

test("tela de set no endereço /games/<jogo>/<set>: nenhuma fatia de índice nem nomes de espécie", () => {
  for (const caminho of ["/games/pokemon/sv03-5-151", "/games/pokemon/sv03-5-151/charizard-ex-199"]) {
    const r = pedidos(caminho);
    assert.deepEqual(r.fetches.filter((u) => /indexes-/.test(u)), [], `${caminho} baixou fatia de índice`);
    assert.ok(!r.scripts.some((u) => /pokemon-names/.test(u)), `${caminho} baixou os nomes das espécies`);
    assert.equal(r.tipo, "set");
  }
});

test("tela de set pelo link antigo /detail?type=set também não baixa índice", () => {
  const r = pedidos("/detail", "?type=set&name=151&game=pokemon");
  assert.deepEqual(r.fetches.filter((u) => /indexes-/.test(u)), []);
  assert.equal(r.tipo, "set");
});

test("as telas que LEEM índice seguem pedindo a fatia delas", () => {
  assert.ok(pedidos("/detail", "?type=pokemon&name=Pikachu&game=pokemon").fetches.some((u) => /indexes-pokedex/.test(u)));
  assert.ok(pedidos("/detail", "?type=artist&name=Ken%20Sugimori&game=pokemon").fetches.some((u) => /indexes-artists/.test(u)));
  assert.ok(pedidos("/detail", "?type=trainer&name=Misty&game=pokemon").fetches.some((u) => /indexes-trainers/.test(u)));
  assert.ok(pedidos("/detail", "?type=pokemon&name=Pikachu&game=pokemon").scripts.some((u) => /pokemon-names/.test(u)), "o hero do Pokémon usa os nomes (anterior/próximo)");
});

test("o shared.js acende a aba pelo tipo que o game.js deduziu", () => {
  const shared = readFileSync(join(raiz, "src/shared.js"), "utf8");
  assert.ok(shared.includes("const type = (window.SLEEVU && window.SLEEVU.tipo) || sp.get(\"type\");"));
});
