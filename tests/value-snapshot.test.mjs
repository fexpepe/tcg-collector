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
