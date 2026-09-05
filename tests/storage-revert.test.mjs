// Gravação que falha (cota cheia) e duas abas sobre a mesma coleção, via
// sandbox de vm (tests/lib/shared-sandbox.mjs). Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

const EXPOSE = "window.__test = { createCollectionStore, createWishlistStore, rehydrateCrossTab, get Date() { return Date; } };";
const COL = "tcg-collector-pokemon-collection-v3";
function aba(ls) {
  const sb = loadShared(EXPOSE, { localStorage: ls });
  return { api: sb.window.__test, flush: sb.__flushTimers, sb };
}

test("gravação que falha: o store volta ao disco e a página é avisada (a interface só mostra o que foi salvo)", () => {
  const ls = makeLocalStorage({ [COL]: JSON.stringify({ A: { Holo: { NM: 1 } } }) });
  const { api, flush, sb } = aba(ls);
  const eventos = [];
  sb.document.dispatchEvent = (ev) => { eventos.push(ev); };
  const st = api.createCollectionStore("pokemon");
  const setItem = ls.setItem;
  ls.setItem = (k, v) => { if (k === COL) { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; } return setItem(k, v); };

  st.add("B", "Holo", "NM", 1);
  assert.equal(st.has("B"), true, "em memória, antes do flush");
  flush();
  assert.equal(st.has("B"), false, "gravação falhou: a alteração é desfeita");
  assert.equal(st.has("A"), true, "o que estava no disco continua");
  assert.deepEqual(JSON.parse(ls.getItem(COL)), { A: { Holo: { NM: 1 } } });
  assert.equal(eventos.length, 1, "página avisada pra redesenhar");

  // Espaço liberado: a próxima alteração volta a persistir normalmente.
  ls.setItem = setItem;
  st.add("C", "Holo", "NM", 1);
  flush();
  assert.deepEqual(Object.keys(JSON.parse(ls.getItem(COL))).sort(), ["A", "C"]);
});

test("gravação que falha na wishlist também reverte", () => {
  const ls = makeLocalStorage();
  const { api, flush } = aba(ls);
  const wl = api.createWishlistStore("pokemon");
  const setItem = ls.setItem;
  ls.setItem = (k, v) => { if (k.includes("wishlist-v1")) throw new Error("quota"); return setItem(k, v); };
  wl.toggle("A", "Holo");
  assert.equal(wl.hasCard("A"), true);
  flush();
  assert.equal(wl.hasCard("A"), false);
});

test("duas abas: marcar cartas diferentes preserva ambas; desmarcar sincroniza; a última gravação vence na mesma carta", () => {
  const ls = makeLocalStorage();
  const A = aba(ls), B = aba(ls);
  const sa = A.api.createCollectionStore("pokemon");
  const sb = B.api.createCollectionStore("pokemon");
  // Relógio monotônico compartilhado: no teste tudo cabe no mesmo milissegundo,
  // e empate de carimbo é o caminho de migração (união) — não o de duas abas,
  // onde cada clique tem o seu instante.
  let relogio = Date.now();
  const tick = () => (relogio += 10);
  A.api.Date.now = tick; B.api.Date.now = tick;

  // A marca X e grava; B (que abriu antes e não viu X) marca Y e grava por cima.
  sa.add("X", "Holo", "NM", 1); A.flush();
  sb.add("Y", "Holo", "NM", 1); B.flush();
  assert.deepEqual(Object.keys(JSON.parse(ls.getItem(COL))), ["Y"], "sem o evento storage, B sobrescreveu (é o que o merge conserta)");
  // O evento `storage` chega em A: remescla disco + memória, e o próximo save de A leva as duas.
  A.api.rehydrateCrossTab(COL);
  assert.equal(sa.has("X") && sa.has("Y"), true);
  sa.add("Z", "Holo", "NM", 1); A.flush();
  assert.deepEqual(Object.keys(JSON.parse(ls.getItem(COL))).sort(), ["X", "Y", "Z"]);
  B.api.rehydrateCrossTab(COL);
  assert.equal(sb.has("X") && sb.has("Z"), true, "B também vê o que A marcou");

  // Desmarcar em A propaga pra B (tombstone mais novo que o mod de B).
  sa.add("Y", "Holo", "NM", -1); A.flush();
  B.api.rehydrateCrossTab(COL);
  assert.equal(sb.has("Y"), false, "desmarcar também sincroniza");

  // Mesma carta nas duas abas: prevalece a última gravação.
  sa.add("X", "Holo", "NM", 4); A.flush(); // X = 5 em A
  sb.add("X", "Holo", "NM", 1); B.flush(); // B ainda tinha X = 1 → 2, gravado por último
  A.api.rehydrateCrossTab(COL);
  assert.equal(sa.variantTotal("X", "Holo"), 2, "última gravação vence");
});
