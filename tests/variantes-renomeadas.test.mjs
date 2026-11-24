// Versão renomeada de carta já publicada (src/shared.js: VARIANTES_RENOMEADAS,
// remapVariantesDeep, migraVariantesRenomeadas). A PR忍-1-R do Naruto 2002 era
// "Normal" e passou a "Foil" em 23/11/2026; as cópias guardadas no nome antigo
// ficaram órfãs e a carta dizia "Tenho 6" enquanto o resto do site dizia 3
// (24/11). Estes testes travam o caminho de volta: aparelho, nuvem e cada
// formato de store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

const EXPOR = "window.__test = { varianteRenomeada, remapVariantesDeep, mergeData, VARIANTES_RENOMEADAS, VARIANTES_RENOMEADAS_KEY };";
const ID = "nrt-PRN-001R";
const json = (x) => JSON.parse(JSON.stringify(x)); // objeto do sandbox é de outro realm

// O catálogo de cada id da tabela. Id de outro jogo entra aqui junto.
const CATALOGO_POR_PREFIXO = { "nrt-": "../data/naruto/cards.js" };
const lerCatalogo = (arquivo) => {
  const s = readFileSync(new URL(arquivo, import.meta.url), "utf8");
  return JSON.parse(s.slice(s.indexOf("["), s.lastIndexOf("]") + 1));
};

test("tabela: cada entrada leva de uma versão que a carta não tem mais pra uma que ela tem", () => {
  const { __test: t } = loadShared(EXPOR);
  const tabela = json(t.VARIANTES_RENOMEADAS);
  assert.ok(Object.keys(tabela).length > 0);
  for (const [id, trocas] of Object.entries(tabela)) {
    const prefixo = Object.keys(CATALOGO_POR_PREFIXO).find((p) => id.startsWith(p));
    assert.ok(prefixo, `${id}: diga em CATALOGO_POR_PREFIXO onde está o catálogo do jogo`);
    const carta = lerCatalogo(CATALOGO_POR_PREFIXO[prefixo]).find((c) => c.id === id);
    assert.ok(carta, `${id} não está no catálogo`);
    for (const [de, para] of Object.entries(trocas)) {
      assert.ok(!carta.variants.includes(de), `${id}: "${de}" ainda é versão da carta`);
      assert.ok(carta.variants.includes(para), `${id}: "${para}" não é versão da carta`);
    }
  }
});

test("a PR忍-1-R: Normal vira Foil, e só ela", () => {
  const { __test: t } = loadShared(EXPOR);
  assert.equal(t.varianteRenomeada(ID, "Normal"), "Foil");
  assert.equal(t.varianteRenomeada(ID, "Foil"), "");
  assert.equal(t.varianteRenomeada("nrt-PRN-001", "Normal"), ""); // a PR忍-1 segue Normal
  assert.equal(t.varianteRenomeada("__proto__", "Normal"), "");
  assert.equal(t.varianteRenomeada(ID, "constructor"), "");
});

test("cada formato de store: chave de versão, lista de versões, chave composta e objeto com versão", () => {
  const { __test: t } = loadShared(EXPOR);
  const r = t.remapVariantesDeep({
    colecao: { [ID]: { Normal: { NM: 2, SP: 1 } }, "nrt-PRN-001": { Normal: { NM: 1 } } },
    desejos: { [ID]: ["Normal"] },
    custos: { costs: { [`${ID}|Normal`]: { v: 30, cur: "BRL" }, "nrt-PRN-001|Normal": { v: 10, cur: "BRL" } } },
    vendas: [`${ID}|Normal`],
    pasta: { slots: [{ cardId: ID, variant: "Normal", name: "Naruto" }, { cardId: "nrt-PRN-001", variant: "Normal" }] },
    lista: { itens: [{ id: ID, v: "Normal" }, { id: ID, v: null }] }
  });
  assert.equal(r.mudou, true);
  assert.deepEqual(json(r.v), {
    colecao: { [ID]: { Foil: { NM: 2, SP: 1 } }, "nrt-PRN-001": { Normal: { NM: 1 } } },
    desejos: { [ID]: ["Foil"] },
    custos: { costs: { [`${ID}|Foil`]: { v: 30, cur: "BRL" }, "nrt-PRN-001|Normal": { v: 10, cur: "BRL" } } },
    vendas: [`${ID}|Foil`],
    pasta: { slots: [{ cardId: ID, variant: "Foil", name: "Naruto" }, { cardId: "nrt-PRN-001", variant: "Normal" }] },
    lista: { itens: [{ id: ID, v: "Foil" }, { id: ID, v: null }] }
  });
  const nada = t.remapVariantesDeep({ "nrt-PRN-001": { Normal: { NM: 1 } }, x: ["Normal"], y: "Normal" });
  assert.equal(nada.mudou, false);
});

test("vendas: a chave por cópia (id|versão|índice) e o item dela mudam juntos", () => {
  // Formato do src/sales.js: chave `${cardId}|${variant}|${idx}` e o item
  // repete cardId e variant. Trocar só um dos dois deixaria a venda sem dono.
  const { __test: t } = loadShared(EXPOR);
  const r = t.remapVariantesDeep({
    [`${ID}|Normal|0`]: { cardId: ID, variant: "Normal", idx: 0, price: 50 },
    [`${ID}|Normal|1`]: { cardId: ID, variant: "Normal", idx: 1, price: 55 },
    "nrt-PRN-001|Normal|0": { cardId: "nrt-PRN-001", variant: "Normal", idx: 0, price: 20 }
  });
  assert.deepEqual(json(r.v), {
    [`${ID}|Foil|0`]: { cardId: ID, variant: "Foil", idx: 0, price: 50 },
    [`${ID}|Foil|1`]: { cardId: ID, variant: "Foil", idx: 1, price: 55 },
    "nrt-PRN-001|Normal|0": { cardId: "nrt-PRN-001", variant: "Normal", idx: 0, price: 20 }
  });
});

test("as duas marcadas: vale o Foil que já estava, em qualquer ordem, sem somar", () => {
  // O caso do Fernando: 3 no Normal de antes de 23/11 e as mesmas 3 de novo no Foil.
  const { __test: t } = loadShared(EXPOR);
  for (const colecao of [
    { [ID]: { Normal: { NM: 3 }, Foil: { NM: 2, SP: 1 } } },
    { [ID]: { Foil: { NM: 2, SP: 1 }, Normal: { NM: 3 } } }
  ]) {
    assert.deepEqual(json(t.remapVariantesDeep(colecao).v), { [ID]: { Foil: { NM: 2, SP: 1 } } });
  }
  assert.deepEqual(json(t.remapVariantesDeep({ [ID]: ["Normal", "Foil"] }).v), { [ID]: ["Foil"] });
  assert.deepEqual(json(t.remapVariantesDeep({ [`${ID}|Normal`]: 1, [`${ID}|Foil`]: 2 }).v), { [`${ID}|Foil`]: 2 });
});

test("aparelho: a carta passa a dizer 3, e a migração se marca pra não rodar de novo", () => {
  const localStorage = makeLocalStorage({
    "tcg-collector-naruto-collection-v3": JSON.stringify({ [ID]: { Normal: { NM: 3 }, Foil: { NM: 3 } }, "nrt-PRN-001": { Normal: { NM: 1 } } }),
    "tcg-collector-naruto-collection-meta-v1": JSON.stringify({ mod: { [ID]: 7 }, del: {} }),
    "tcg-collector-naruto-wishlist-v1": JSON.stringify({ [ID]: ["Normal"] }),
    "outro-app-qualquer": JSON.stringify({ [ID]: { Normal: 1 } })
  });
  const sandbox = loadShared(EXPOR, { localStorage });
  const store = sandbox.window.TCGShared.createCollectionStore("naruto");
  assert.equal(store.totalForCard(ID), 3);
  assert.equal(store.variantTotal(ID, "Foil"), 3);
  assert.equal(store.variantTotal(ID, "Normal"), 0);
  assert.equal(store.totalForCard("nrt-PRN-001"), 1);
  const d = localStorage._dump();
  assert.deepEqual(JSON.parse(d["tcg-collector-naruto-wishlist-v1"]), { [ID]: ["Foil"] });
  // O timestamp do LWW fica como estava, e chave de outro app não é tocada.
  assert.deepEqual(JSON.parse(d["tcg-collector-naruto-collection-meta-v1"]), { mod: { [ID]: 7 }, del: {} });
  assert.deepEqual(JSON.parse(d["outro-app-qualquer"]), { [ID]: { Normal: 1 } });
  assert.equal(d[sandbox.window.__test.VARIANTES_RENOMEADAS_KEY], JSON.stringify(json(sandbox.window.__test.VARIANTES_RENOMEADAS)));
});

test("aparelho que só tinha o Normal: as cópias mudam de nome, nenhuma se perde", () => {
  const localStorage = makeLocalStorage({
    "tcg-collector-naruto-collection-v3": JSON.stringify({ [ID]: { Normal: { NM: 2, HP: 1 } } })
  });
  const store = loadShared(EXPOR, { localStorage }).window.TCGShared.createCollectionStore("naruto");
  assert.equal(store.getQuantity(ID, "Foil", "NM"), 2);
  assert.equal(store.getQuantity(ID, "Foil", "HP"), 1);
  assert.equal(store.totalForCard(ID), 3);
});

test("nuvem com o nome antigo (aparelho que não migrou): reescrito antes do merge", () => {
  const { __test: t } = loadShared(EXPOR);
  const local = { collection: { [ID]: { Foil: { NM: 3 } } }, collectionMeta: { mod: { [ID]: 500 }, del: {} } };
  const remoto = {
    collection: { [ID]: { Normal: { NM: 3 }, Foil: { NM: 3 } } },
    collectionMeta: { mod: { [ID]: 900 }, del: {} },
    wishlist: { [ID]: ["Normal"] }
  };
  const m = json(t.mergeData(local, remoto));
  assert.deepEqual(m.collection, { [ID]: { Foil: { NM: 3 } } }); // o remoto vence pelo LWW, já sem o Normal
  // Só o remoto tinha a carta, e só no Normal: chega como Foil.
  const s = json(t.mergeData({}, { collection: { [ID]: { Normal: { NM: 2 } } }, collectionMeta: { mod: { [ID]: 1 }, del: {} } }));
  assert.deepEqual(s.collection, { [ID]: { Foil: { NM: 2 } } });
});
