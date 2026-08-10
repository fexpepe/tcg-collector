// Complementa o scripts/test-sync-merge.mjs, que já cobre a SEMÂNTICA do merge
// (LWW, tombstones, união, wishlist, decks). O que falta lá — e é o que este
// arquivo trava — são as duas premissas em que as mudanças de performance do
// merge se apoiam:
//
//   1. ISOLAMENTO. A cópia de cada entrada deixou de ser
//      JSON.parse(JSON.stringify(...)) e virou uma cópia de dois níveis escrita
//      à mão (copiaEntrada, no src/shared.js). Se um dia ela virar cópia rasa
//      ou referência, o merge passa a ESCREVER no snapshot de origem: o passo
//      de empate muta o objeto que copiou, e a corrupção só apareceria como
//      quantidade errada na coleção de alguém, um sync depois.
//
//   2. REMOTO VAZIO NÃO MUDA NADA. O boot pula o merge do jogo que não tem
//      linha na nuvem (a maioria: quase ninguém joga os 13). O atalho só é
//      válido enquanto mergeData(local, {}) for igual a mergeData(local, …)
//      com remoto vazio.
//
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

function api() {
  const sb = loadShared(
    "window.__test = { mergeCollection, mergeData };",
    { localStorage: makeLocalStorage() }
  );
  return sb.window.__test;
}
const meta = (mod = {}, del = {}) => ({ mod, del });
const AGORA = Date.now(); // tombstone vale 1 ano: timestamp tem de ser de agora

test("merge: a entrada devolvida é cópia, não o objeto de origem", () => {
  const { mergeCollection } = api();
  const local = { "x-1": { Normal: { NM: 1 } } };
  const nuvem = { "y-2": { Holo: { NM: 5 } } };
  const r = mergeCollection(local, meta({ "x-1": AGORA }), nuvem, meta({ "y-2": AGORA }));

  // nem o objeto da carta, nem o de condições dentro dele
  assert.notEqual(r.collection["x-1"], local["x-1"]);
  assert.notEqual(r.collection["x-1"].Normal, local["x-1"].Normal);
  assert.notEqual(r.collection["y-2"].Holo, nuvem["y-2"].Holo);

  r.collection["x-1"].Normal.NM = 99;
  r.collection["x-1"].Foil = { NM: 7 };
  assert.equal(local["x-1"].Normal.NM, 1, "a origem não pode ser alterada");
  assert.equal(local["x-1"].Foil, undefined);
});

test("merge: no empate (o caminho que MUTA), nenhum dos dois lados é tocado", () => {
  const { mergeCollection } = api();
  const a = { "x-1": { Normal: { NM: 2 } } };
  const b = { "x-1": { Normal: { PL: 3 } } };
  const r = mergeCollection(a, meta({ "x-1": AGORA }), b, meta({ "x-1": AGORA }));

  assert.equal(JSON.stringify(r.collection["x-1"]), JSON.stringify({ Normal: { NM: 2, PL: 3 } }));
  r.collection["x-1"].Normal.NM = 42;
  assert.equal(a["x-1"].Normal.NM, 2);
  assert.equal(b["x-1"].Normal.PL, 3);
});

test("boot: remoto vazio (ou nulo) não muda nada — premissa do atalho do laço", () => {
  const { mergeData } = api();
  const local = {
    collection: { "x-1": { Normal: { NM: 2 } } },
    collectionMeta: { mod: { "x-1": AGORA }, del: {} },
    wishlist: { "y-2": { Holo: true } }
  };
  const base = JSON.stringify(mergeData(local, {}));
  assert.equal(JSON.stringify(mergeData(local, {})), base);
  assert.equal(JSON.stringify(mergeData(local, null)), base, "null (falha de rede) idem");
});
