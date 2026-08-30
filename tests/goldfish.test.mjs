// Pilha do "testar mão" (src/goldfish.js): a parte que erra CALADA. Se o Leader
// do One Piece ou o Digi-Egg entrarem na pilha, a mão sai errada e nada acusa —
// a pessoa só conclui que o simulador é ruim.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
function load() {
  const sandbox = { console, document: { createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, addEventListener() {}, appendChild() {} }) } };
  sandbox.window = sandbox;
  // O módulo só precisa do TCGShared pra existir; a pilha não usa nada dele.
  sandbox.window.TCGShared = { t: (k) => k, escapeHtml: String, escapeAttribute: String };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(here, "..", "src", "goldfish.js"), "utf8"), sandbox);
  return sandbox.window.TCGGoldfish;
}
const G = load();

const byId = { a: { id: "a", name: "A" }, b: { id: "b", name: "B" }, L: { id: "L", name: "Líder" }, e: { id: "e", name: "Ovo" } };

test("expande a quantidade: 4× vira quatro cópias soltas", () => {
  const deck = { zones: { main: [{ id: "a", qty: 4 }, { id: "b", qty: 2 }] } };
  const pack = { zones: [{ key: "main" }] };
  const p = G.pilhaDe(deck, pack, byId);
  assert.equal(p.length, 6);
  assert.equal(p.filter((c) => c.id === "a").length, 4);
});

test("zona que NÃO é a main fica de fora — Leader e Digi-Egg começam em jogo", () => {
  const deck = { zones: { leader: [{ id: "L", qty: 1 }], main: [{ id: "a", qty: 3 }] } };
  const pack = { zones: [{ key: "leader" }, { key: "main" }] };
  const p = G.pilhaDe(deck, pack, byId);
  assert.equal(p.length, 3);
  assert.ok(!p.some((c) => c.id === "L"), "o Leader não pode aparecer na mão");
});

test("side e maybe também ficam de fora", () => {
  const deck = { zones: { main: [{ id: "a", qty: 2 }], side: [{ id: "b", qty: 5 }], maybe: [{ id: "b", qty: 9 }] } };
  const pack = { zones: [{ key: "main" }, { key: "side" }, { key: "maybe" }] };
  assert.equal(G.pilhaDe(deck, pack, byId).length, 2);
});

test("carta que sumiu do catálogo não derruba a pilha", () => {
  const deck = { zones: { main: [{ id: "fantasma", qty: 2 }] } };
  const p = G.pilhaDe(deck, { zones: [{ key: "main" }] }, byId);
  assert.equal(p.length, 2);
  assert.equal(p[0].id, "fantasma");
});

test("quantidade absurda ou inválida não trava o navegador", () => {
  const deck = { zones: { main: [{ id: "a", qty: 99999 }, { id: "b", qty: -3 }, { id: "b", qty: "x" }] } };
  const p = G.pilhaDe(deck, { zones: [{ key: "main" }] }, byId);
  assert.equal(p.length, 200); // teto de sanidade; negativo e NaN viram 0
});

test("embaralhar preserva o multiconjunto (nada some, nada duplica)", () => {
  const antes = ["a", "a", "b", "c", "d", "e", "f"];
  const depois = G.embaralha(antes.slice()).slice().sort();
  assert.deepEqual(depois, antes.slice().sort());
});

test("deck vazio devolve pilha vazia (a UI mostra o aviso, não uma mão em branco)", () => {
  assert.equal(G.pilhaDe({ zones: { main: [] } }, { zones: [{ key: "main" }] }, byId).length, 0);
  assert.equal(G.pilhaDe({}, { zones: [] }, byId).length, 0);
});
