// Troca de idioma da carta no popup (24/09/2026): a mesma carta do lançamento
// internacional mora em dois ids (30th-151 e 30th-151-pt) e cada cópia em um
// deles. O "mover" leva UMA cópia por vez, com variante e condição — quem tem
// 3 EN + 2 PT chega lá clique a clique, sem um seletor que jogue tudo pra um
// lado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

const EXPOSE = "window.__test = { moveOneCopy, createCollectionStore };";

function monta(colecao) {
  const sb = loadShared(EXPOSE, { localStorage: makeLocalStorage({
    "tcg-collector-pokemon-collection-v3": JSON.stringify(colecao)
  }) });
  const api = sb.window.__test;
  return { api, owned: api.createCollectionStore() };
}
const obj = (x) => JSON.parse(JSON.stringify(x));

test("move uma cópia com a variante e a condição, NM primeiro", () => {
  const { api, owned } = monta({ "30th-151": { Holo: { NM: 2, HP: 1 } } });
  assert.equal(api.moveOneCopy(owned, "30th-151", "30th-151-pt", "Holo"), true);
  assert.deepEqual(obj(owned.toObject()), {
    "30th-151": { Holo: { NM: 1, HP: 1 } },
    "30th-151-pt": { Holo: { NM: 1 } }
  });
  // Sem NM sobrando, vai a pior condição (mesma régua do removeOneCopy).
  api.moveOneCopy(owned, "30th-151", "30th-151-pt", "Holo");
  api.moveOneCopy(owned, "30th-151", "30th-151-pt", "Holo");
  assert.deepEqual(obj(owned.toObject()), { "30th-151-pt": { Holo: { NM: 2, HP: 1 } } });
});

test("sem cópia da variante (ou mesmo id) não move nada", () => {
  const { api, owned } = monta({ "30th-151": { Holo: { NM: 1 } } });
  assert.equal(api.moveOneCopy(owned, "30th-151", "30th-151-pt", "Normal"), false);
  assert.equal(api.moveOneCopy(owned, "30th-151", "30th-151", "Holo"), false);
  assert.deepEqual(obj(owned.toObject()), { "30th-151": { Holo: { NM: 1 } } });
});
