// Contas de uma VENDA REALIZADA (shared.soldValues) — a fórmula que a página de
// Vendas e o Portfólio compartilham. Duas regras a proteger:
//   1. o valor em BRL é CONGELADO na data da venda (resultado realizado não pode
//      mudar quando o câmbio muda: o dinheiro já entrou);
//   2. taxa/frete saem do preço antes do lucro (líquido = preço − taxa;
//      resultado = líquido − pago).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

function api(seed) {
  const sb = loadShared(
    "window.__test = { soldValues, getSaleFeePct, setSaleFeePct, createSoldStore };",
    { localStorage: makeLocalStorage(seed || {}) }
  );
  return sb.window.__test;
}

test("soldValues: taxa sai do preço e o resultado desconta o custo", () => {
  const { soldValues } = api();
  const v = soldValues({ price: 300, paid: 100, fee: 30, cur: "BRL", brl: 300, paidBrl: 100, feeBrl: 30 });
  assert.equal(v.price, 300);
  assert.equal(v.fee, 30);
  assert.equal(v.net, 270, "líquido = preço − taxa");
  assert.equal(v.pnl, 170, "resultado = líquido − pago");
  assert.equal(v.hasCost, true);
});

test("soldValues: sem custo informado não entra no resultado", () => {
  const { soldValues } = api();
  const v = soldValues({ price: 400, paid: 0, fee: 40, cur: "BRL", brl: 400, feeBrl: 40 });
  assert.equal(v.hasCost, false, "quem consome usa isso pra contar a COBERTURA");
  assert.equal(v.net, 360, "o líquido existe mesmo sem custo");
});

test("soldValues: prefere o BRL congelado à conversão de hoje", () => {
  // Venda feita em dólar quando o dólar valia outra coisa: o registro guarda os
  // R$ 500 da época. Sem câmbio carregado no sandbox, converter US$ 100 hoje
  // devolveria 100 — o congelado é o que impede o resultado de mudar sozinho.
  const { soldValues } = api();
  const v = soldValues({ price: 100, paid: 40, fee: 10, cur: "USD", brl: 500, paidBrl: 200, feeBrl: 50 });
  assert.equal(v.price, 500);
  assert.equal(v.paid, 200);
  assert.equal(v.fee, 50);
  assert.equal(v.pnl, 250, "500 − 50 − 200");
});

test("soldValues: registro ANTIGO (sem o congelado) cai na moeda original", () => {
  // Vendas gravadas antes deste campo não podem sumir nem virar zero.
  const { soldValues } = api();
  const v = soldValues({ price: 250, paid: 100, fee: 0, cur: "BRL" });
  assert.equal(v.price, 250);
  assert.equal(v.pnl, 150);
});

test("soldValues: venda no prejuízo devolve resultado negativo", () => {
  const { soldValues } = api();
  const v = soldValues({ price: 250, paid: 300, fee: 25, cur: "BRL", brl: 250, paidBrl: 300, feeBrl: 25 });
  assert.equal(v.pnl, -75);
});

test("createSoldStore.add: congela o BRL e guarda a taxa", () => {
  const { createSoldStore } = api();
  const store = createSoldStore();
  store.add({ cardId: "x-1", variant: "Normal", cond: "NM", price: 300, paid: 100, fee: 30, cur: "BRL", date: "2026-08-16" });
  const it = store.list()[0];
  assert.equal(it.fee, 30);
  assert.equal(it.brl, 300, "sem o congelado o resultado passa a depender do câmbio de hoje");
  assert.equal(it.paidBrl, 100);
  assert.equal(it.feeBrl, 30);
});

test("taxa padrão: lembrada entre vendas, e limitada a valores plausíveis", () => {
  const { getSaleFeePct, setSaleFeePct } = api();
  assert.equal(getSaleFeePct(), 0, "sem preferência, sem taxa sugerida");
  setSaleFeePct(10.5);
  assert.equal(getSaleFeePct(), 10.5);
  setSaleFeePct(0);
  assert.equal(getSaleFeePct(), 0, "zerar apaga a preferência");
  setSaleFeePct(150);
  assert.equal(getSaleFeePct(), 99, "taxa de 150% seria erro de digitação");
});
