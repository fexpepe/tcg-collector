// Registro de endereços dos jogos (functions/_lib/jogos.js, 2026-09-30): a
// tela de Sets de cada jogo mora em /games/<url>. O que se trava aqui:
//   - a cópia do navegador (src/game.js) é IGUAL à do servidor: se as duas
//     divergissem, o hub e a aba Sets levariam pra um endereço que a borda não
//     conhece (404), ou a tela abriria o jogo errado;
//   - as linhas e os prefixos são os do GAME_LINES do shared.js;
//   - todo jogo do app tem endereço, e todo tile do hub aponta pra um;
//   - apelido (swu, ygo, nrt-dc…) leva pro endereço oficial;
//   - endereço é sempre minúsculo, em inglês e sem colidir com as rotas
//     reservadas da árvore (/games/<jogo>/_id/).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { JOGOS_URL, APELIDOS, jogoDaUrl, urlOficial, urlDoJogo, urlDoSet } from "../functions/_lib/jogos.js";
import { loadShared } from "./lib/shared-sandbox.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => readFileSync(join(raiz, p), "utf8");

// O game.js num navegador de mentira, só pra ler o registro que ele expõe.
function gameJs(pathname = "/hub") {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const sandbox = {
    location: { pathname, search: "", hash: "", href: `https://sleevu.app${pathname}` },
    history: { state: null, replaceState() {} },
    localStorage: storage,
    document: { documentElement: { setAttribute() {} }, head: { appendChild() {} }, currentScript: null, createElement: () => ({}) },
    fetch: () => Promise.reject(new Error("sem rede"))
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(ler("src/game.js"), sandbox);
  return sandbox.window.SLEEVU;
}

test("endereço oficial: minúsculo, com hífen, único e fora das rotas reservadas", () => {
  const vistos = new Set();
  for (const j of JOGOS_URL) {
    assert.match(j.url, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, j.url);
    assert.ok(!vistos.has(j.url), `endereço repetido: ${j.url}`);
    vistos.add(j.url);
    assert.notEqual(j.url, "_id");
    assert.ok(!/^legado-/.test(j.url), "legado-* é nome de mapa em data/game-pages/");
    assert.ok(!Object.prototype.hasOwnProperty.call(APELIDOS, j.url), `${j.url} é oficial e apelido ao mesmo tempo`);
  }
});

test("o game.js leva a mesma lista (url, jogo, linha e prefixos)", () => {
  const S = gameJs();
  for (const j of JOGOS_URL) {
    assert.equal(S.urlDoJogo(j.game, j.linha || ""), `/games/${j.url}`, `${j.game} ${j.linha || ""}`);
    for (const p of j.prefixos || []) assert.equal(S.urlDoSet(j.game, `${p}01`), `/games/${j.url}`, p);
  }
  // E nada a mais do lado do navegador.
  const fonte = ler("src/game.js");
  const noGameJs = [...fonte.slice(fonte.indexOf("var URL_DOS_JOGOS"), fonte.indexOf("var LINHA_APELIDO")).matchAll(/\["([a-z0-9-]+)", "([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(noGameJs.sort(), JOGOS_URL.map((j) => j.url).sort());
});

test("o game.js tira o jogo e a linha do endereço", () => {
  assert.equal(gameJs("/games/star-wars-unlimited").game, "swu");
  const dc = gameJs("/games/naruto-data-carddass");
  assert.equal(dc.game, "naruto");
  assert.equal(dc.line, "nrt-dc");
  assert.equal(gameJs("/games/naruto-card-game-2002").line, "");
});

test("linhas e prefixos batem com o GAME_LINES do shared.js", () => {
  const { GAME_LINES } = loadShared("").window.TCGShared;
  const doRegistro = JOGOS_URL.filter((j) => j.linha);
  const doShared = Object.entries(GAME_LINES).flatMap(([game, linhas]) => Object.entries(linhas).map(([linha, def]) => ({ game, linha, prefixos: def.prefixes || [def.prefix] })));
  assert.equal(doRegistro.length, doShared.length, "linha sem endereço (ou endereço de linha que o shared não conhece)");
  for (const s of doShared) {
    const r = doRegistro.find((j) => j.game === s.game && j.linha === s.linha);
    assert.ok(r, `${s.game}/${s.linha} sem endereço`);
    assert.deepEqual([...r.prefixos].sort(), [...s.prefixos].sort(), `${s.game}/${s.linha}: prefixos diferentes`);
  }
});

test("todo jogo do app tem endereço", () => {
  const { GAME_SLUGS } = loadShared("").window.TCGShared;
  for (const g of GAME_SLUGS) assert.ok(urlDoJogo(g, ""), `${g} sem /games/<url>`);
});

test("os tiles do hub apontam pro registro, e todo endereço tem tile", () => {
  const hub = ler("hub.html");
  const tiles = [...hub.matchAll(/<a class="hub-tile" href="([^"]+)" data-game="([a-z]+)">/g)];
  assert.equal(tiles.length, JOGOS_URL.length, "tile sem endereço ou endereço sem tile");
  for (const [, href, game] of tiles) {
    const m = /^\/games\/([a-z0-9-]+)$/.exec(href);
    assert.ok(m, `tile com link fora de /games: ${href}`);
    const j = jogoDaUrl(m[1]);
    assert.ok(j, `tile pra endereço desconhecido: ${href}`);
    assert.equal(j.game, game, `${href}: data-game ${game}, registro ${j.game}`);
  }
  assert.doesNotMatch(hub, /href="sets\?game=/, "sobrou tile no endereço antigo");
});

test("apelido leva pro endereço oficial; desconhecido não leva a nada", () => {
  assert.equal(urlOficial("swu"), "star-wars-unlimited");
  assert.equal(urlOficial("SWU"), "star-wars-unlimited");
  assert.equal(urlOficial("mtg"), "magic-the-gathering");
  assert.equal(urlOficial("nrt-dc"), "naruto-data-carddass");
  assert.equal(urlOficial("nrt-nf"), "naruto-data-carddass");
  assert.equal(urlOficial("pokemon"), "pokemon");
  assert.equal(urlOficial("constructor"), null);
  assert.equal(urlOficial("nao-existe"), null);
  for (const destino of Object.values(APELIDOS)) assert.ok(jogoDaUrl(destino), `apelido pra endereço inexistente: ${destino}`);
});

test("urlDoJogo e urlDoSet: linha pelo prefixo do setId, jogo principal no resto", () => {
  assert.equal(urlDoJogo("onepiece", ""), "one-piece-card-game");
  assert.equal(urlDoJogo("onepiece", "opcd"), "one-piece-carddass");
  assert.equal(urlDoJogo("naruto", "nrt-nx"), "naruto-data-carddass");
  assert.equal(urlDoJogo("onepiece", "linha-que-nao-existe"), "one-piece-card-game");
  assert.equal(urlDoJogo("jogo-que-nao-existe", ""), null);
  assert.equal(urlDoSet("onepiece", "OP01"), "one-piece-card-game");
  assert.equal(urlDoSet("onepiece", "op-mb-01"), "one-piece-miracle-battle");
  assert.equal(urlDoSet("naruto", "nrt-nf-03"), "naruto-data-carddass");
  assert.equal(urlDoSet("naruto", "nrt-s01"), "naruto-card-game-2002");
  assert.equal(urlDoSet("pokemon", "sv03.5"), "pokemon");
});
