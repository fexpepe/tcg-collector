// Retrato instantâneo do patrimônio (shared.valueSnapshot): o número que pinta
// Hub/Dashboard/Portfólio ANTES de qualquer catálogo descer. Fontes, na ordem:
// último ponto do history-v2 do jogo (sincronizado na nuvem) e, sem ele, o
// cookie sleevu_pf_<game>. Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

function fresh(seed, cookie) {
  const ls = makeLocalStorage(seed || {});
  const sb = loadShared(
    "window.__test = { valueSnapshot, portfolioValueTotal };",
    { localStorage: ls }
  );
  sb.document.cookie = cookie || "";
  return sb.window.__test;
}

// Mesma coisa, mas expondo o lado da GRAVAÇÃO e o localStorage, pra conferir o
// que ficou escrito.
function freshWriter(seed) {
  const ls = makeLocalStorage(seed || {});
  const sb = loadShared(
    "window.__test = { recordValueSnapshot, valueHistory };",
    { localStorage: ls }
  );
  sb.document.cookie = "";
  return { api: sb.window.__test, ls, sb };
}
const HOJE = new Date().toISOString().slice(0, 10);
const KEY_PK = "tcg-collector-pokemon-history-v2";

test("valueSnapshot: soma o último ponto do history-v2 de cada jogo", () => {
  const api = fresh({
    "tcg-collector-pokemon-history-v2": JSON.stringify([
      { d: "2026-07-01", c: 100, b: 10, w: 5 },
      { d: "2026-08-01", c: 200, b: 20, w: 8 }   // só o ÚLTIMO ponto conta
    ]),
    "tcg-collector-lorcana-history-v2": JSON.stringify([{ d: "2026-08-01", c: 50, b: 0, w: 2 }])
  });
  const s = api.valueSnapshot();
  assert.equal(s.raw, 250);
  assert.equal(s.graded, 20);
  assert.equal(s.wish, 10);
  assert.equal(s.total, 270);
});

test("valueSnapshot: cookie cobre jogo SEM histórico; histórico vence quando há os dois", () => {
  const api = fresh(
    { "tcg-collector-pokemon-history-v2": JSON.stringify([{ d: "2026-08-01", c: 300, b: 0, w: 0 }]) },
    // pokemon também tem cookie (valor velho: NÃO pode contar em dobro nem vencer)
    "sleevu_pf_pokemon=" + encodeURIComponent(JSON.stringify({ c: 111, b: 0, w: 0 }))
    + "; sleevu_pf_onepiece=" + encodeURIComponent(JSON.stringify({ c: 40, b: 5, w: 1 }))
  );
  const s = api.valueSnapshot();
  assert.equal(s.raw, 340);     // 300 (histórico) + 40 (cookie do onepiece)
  assert.equal(s.graded, 5);
  assert.equal(s.total, 345);
});

test("valueSnapshot: sem fonte nenhuma devolve null (a UI mantém o placeholder)", () => {
  const api = fresh({}, "");
  assert.equal(api.valueSnapshot(), null);
  assert.equal(api.portfolioValueTotal(), null);
});

test("valueSnapshot: histórico corrompido não derruba — cai pro cookie", () => {
  const api = fresh(
    { "tcg-collector-pokemon-history-v2": "{nao-e-json" },
    "sleevu_pf_pokemon=" + encodeURIComponent(JSON.stringify({ c: 77, b: 3, w: 0 }))
  );
  const s = api.valueSnapshot();
  assert.equal(s.raw, 77);
  assert.equal(s.graded, 3);
});

test("portfolioValueTotal: sem tabela de câmbio devolve o total em BRL mesmo", () => {
  const api = fresh({
    "tcg-collector-pokemon-history-v2": JSON.stringify([{ d: "2026-08-01", c: 90, b: 10, w: 0 }])
  });
  assert.equal(api.portfolioValueTotal(), 100);
});

// ── Gravação (recordValueSnapshot) ─────────────────────────────────────────
// O ponto do dia passou a ser gravado também pelo Hub e pela Coleção, que sabem
// o patrimônio mas NÃO os desejos. É daí que vem a regra que estes testes
// protegem: campo ausente preserva, zero explícito grava.

test("recordValueSnapshot: campo AUSENTE preserva o valor já gravado", () => {
  // O Hub manda só raw+graded; o `w` que o Portfólio registrou tem que sobreviver.
  const { api, ls } = freshWriter({
    [KEY_PK]: JSON.stringify([{ d: "2026-08-01", c: 3410, b: 1200, w: 777 }])
  });
  api.recordValueSnapshot({ pokemon: { raw: 5000, graded: 2000 } });
  const ponto = JSON.parse(ls.getItem(KEY_PK)).find((p) => p.d === HOJE);
  assert.equal(ponto.c, 5000);
  assert.equal(ponto.b, 2000);
  assert.equal(ponto.w, 777, "desejos não podem ser zerados por quem não os calcula");
});

test("recordValueSnapshot: zero EXPLÍCITO é dado real e sobrescreve", () => {
  // Vender tudo é diferente de não saber — aqui o 0 tem que entrar.
  const { api, ls } = freshWriter({
    [KEY_PK]: JSON.stringify([{ d: "2026-08-01", c: 3410, b: 1200, w: 777 }])
  });
  api.recordValueSnapshot({ pokemon: { raw: 0, graded: 0, wish: 0 } });
  const ponto = JSON.parse(ls.getItem(KEY_PK)).find((p) => p.d === HOJE);
  assert.deepEqual([ponto.c, ponto.b, ponto.w], [0, 0, 0]);
});

test("recordValueSnapshot: duas gravações no mesmo dia SUBSTITUEM o ponto", () => {
  const { api, ls } = freshWriter({
    [KEY_PK]: JSON.stringify([{ d: "2026-08-01", c: 10, b: 0, w: 0 }])
  });
  api.recordValueSnapshot({ pokemon: { raw: 100, graded: 0, wish: 0 } });
  api.recordValueSnapshot({ pokemon: { raw: 200, graded: 0, wish: 0 } });
  const hist = JSON.parse(ls.getItem(KEY_PK));
  assert.equal(hist.length, 2, "o dia de hoje é um ponto só, não um por visita");
  assert.equal(hist[hist.length - 1].c, 200);
});

test("recordValueSnapshot: jogo vazio e sem histórico não cria entrada", () => {
  // 13 jogos × um ponto de zeros por dia poluiria o storage e o sync de quem
  // coleciona um só.
  const { api, ls } = freshWriter({});
  api.recordValueSnapshot({ ygo: { raw: 0, graded: 0, wish: 0 } });
  assert.equal(ls.getItem("tcg-collector-ygo-history-v2"), null);
});

test("recordValueSnapshot: grava o cookie do hub com o ponto do dia", () => {
  const { api, sb } = freshWriter({});
  api.recordValueSnapshot({ pokemon: { raw: 90, graded: 10, wish: 5 } });
  const m = String(sb.document.cookie).match(/sleevu_pf_pokemon=([^;]*)/);
  assert.ok(m, "o hub soma pelos cookies; sem ele o Hub mostra valor velho");
  const payload = JSON.parse(decodeURIComponent(m[1]));
  assert.equal(payload.c, 90);
  assert.equal(payload.b, 10);
  assert.equal(payload.h[payload.h.length - 1][1], 100, "a série do cookie é o patrimônio (c+b)");
});

test("recordValueSnapshot: histórico v1 é migrado antes de receber o ponto novo", () => {
  const { api, ls } = freshWriter({
    "tcg-collector-pokemon-history-v1": JSON.stringify([{ d: "2026-07-01", c: 500, w: 40 }])
  });
  api.recordValueSnapshot({ pokemon: { raw: 600, graded: 0 } });
  const hist = JSON.parse(ls.getItem(KEY_PK));
  assert.equal(hist.length, 2, "o ponto antigo do v1 não pode ser perdido");
  assert.deepEqual([hist[0].c, hist[0].b, hist[0].w], [500, 0, 40]);
  assert.equal(hist[1].c, 600);
});
