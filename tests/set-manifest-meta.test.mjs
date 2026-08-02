// setManifestMeta / setValueBuckets (scripts/lib/sync-common.mjs): o que faz a
// LISTA de sets viver sem baixar carta nenhuma. Antes, desenhar os tiles custava
// o catálogo inteiro do jogo — 647 chunks e 43 MB no Magic. Se a soma daqui sair
// errada, o "Valor total" da lista sai errado em todo set do site, então ela
// segue a MESMA precedência de moeda do cardValue (BR > USD > EUR).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { setManifestMeta, setValueBuckets } from "../scripts/lib/sync-common.mjs";

const carta = (id, extra) => Object.assign({ id, set: "Set X", setId: "sx" }, extra);

test("precedência de moeda: BR ganha do USD, que ganha do EUR", () => {
  const cards = [carta("sx-1"), carta("sx-2"), carta("sx-3")];
  const buckets = setValueBuckets(cards, {
    "sx-1": { b: { md: 30 }, u: 5, e: 4 },   // tem BR -> vai pro BRL
    "sx-2": { u: 5, e: 4 },                  // sem BR -> USD
    "sx-3": { e: 4 }                         // só EUR
  });
  assert.deepEqual(buckets, { vb: 30, vu: 5, ve: 4 });
});

test("variante padrão foil usa o preço foil (uf), como o cardValue", () => {
  const cards = [carta("sx-1", { variants: ["Foil"] }), carta("sx-2", { variants: ["Normal", "Foil"] })];
  const buckets = setValueBuckets(cards, { "sx-1": { u: 2, uf: 40 }, "sx-2": { u: 2, uf: 40 } });
  assert.equal(buckets.vu, 42); // 40 (foil) + 2 (normal)
});

test("carta localizada cai no preço da carta base (mesmo id sem o sufixo)", () => {
  const buckets = setValueBuckets([carta("sx-1-pt"), carta("sx-2-zh-tw")], { "sx-1": { u: 7 }, "sx-2": { u: 3 } });
  assert.equal(buckets.vu, 10);
});

test("sem preço nenhum a carta entra em vn (é o que vira o piso ≥ na tela)", () => {
  const buckets = setValueBuckets([carta("sx-1"), carta("sx-2")], { "sx-1": { u: 0, e: 0 } });
  assert.equal(buckets.vn, 2);
  assert.equal(buckets.vu, undefined); // bucket zerado não viaja no manifest
});

test("metadados saem da primeira carta; total oficial cai pra contagem se faltar", () => {
  const meta = setManifestMeta([
    carta("sx-1", { setTotal: 84, setLogo: "L", setSymbol: "S", setReleaseDate: "2026-07-17", setSerieId: "me", setSerieName: "Mega Evolution" }),
    carta("sx-2")
  ], {});
  assert.equal(meta.total, 84);
  assert.equal(meta.logo, "L");
  assert.equal(meta.release, "2026-07-17");
  assert.equal(meta.serieName, "Mega Evolution");

  const semTotal = setManifestMeta([carta("sx-1"), carta("sx-2"), carta("sx-3")], {});
  assert.equal(semTotal.total, 3);
  assert.equal(semTotal.logo, undefined); // campo ausente não ocupa espaço
});
