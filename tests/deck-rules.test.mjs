// Regras de deck (src/deck-rules.js) — 488 linhas de lógica pura que decide se
// um deck é LEGAL (tamanho de zona, limite de cópias, singleton, a conta do
// Commander) e não tinha teste nenhum, sendo o arquivo mais mexido do repo. Uma
// regressão aqui marca deck ilegal como legal (ou o contrário) sem nada acusar.
//
// deck-rules.js é uma IIFE que só encosta em `window` no fim — carrega num vm
// mínimo, sem stub de DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));

function loadDeckRules() {
  const src = readFileSync(join(here, "..", "src", "deck-rules.js"), "utf8");
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.TCGDeckRules;
}

const R = loadDeckRules();

// Monta um cardById a partir de uma lista de cartas.
const byId = (cards) => Object.fromEntries(cards.map((c) => [c.id, c]));

test("multi: separa por ; (Magic/OP) e por / (tinta dupla Lorcana)", () => {
  // spread pra trazer o array do realm do vm pro realm do teste (senão o
  // deepStrictEqual reprova pelo protótipo de Array diferente).
  assert.deepEqual([...R.multi("Green;Red")], ["Green", "Red"]);
  assert.deepEqual([...R.multi("Amber/Steel")], ["Amber", "Steel"]);
  assert.equal(R.multi("").length, 0);
  assert.equal(R.multi(null).length, 0);
});

test("countIn: soma as quantidades da zona; zona ausente = 0", () => {
  const deck = { zones: { main: [{ id: "a", qty: 2 }, { id: "b", qty: 3 }] } };
  assert.equal(R.countIn(deck, "main"), 5);
  assert.equal(R.countIn(deck, "side"), 0);
  assert.equal(R.countIn({}, "main"), 0);
});

test("Commander: 1 comandante pede 99 no main (sizeWith = 100 − comandantes)", () => {
  const main = Array.from({ length: 99 }, (_, i) => ({ id: `c${i}`, qty: 1 }));
  const cards = main.map((e) => ({ id: e.id, name: e.id, cardType: "Creature", colorId: "" }));
  cards.push({ id: "cmd", name: "Cmd", cardType: "Legendary Creature", colorId: "" });
  const deck = { game: "magic", format: "commander", zones: { commander: [{ id: "cmd", qty: 1 }], main } };
  const size = R.validate(deck, byId(cards)).filter((i) => i.code === "zoneMin" || i.code === "zoneMax");
  assert.equal(size.length, 0, "99 main + 1 comandante = deck de 100, sem erro de tamanho");
});

test("Commander: 98 no main com 1 comandante acusa zoneMin (faltou 1)", () => {
  const main = Array.from({ length: 98 }, (_, i) => ({ id: `c${i}`, qty: 1 }));
  const cards = main.map((e) => ({ id: e.id, name: e.id, cardType: "Creature", colorId: "" }));
  cards.push({ id: "cmd", name: "Cmd", cardType: "Legendary Creature", colorId: "" });
  const deck = { game: "magic", format: "commander", zones: { commander: [{ id: "cmd", qty: 1 }], main } };
  const min = R.validate(deck, byId(cards)).filter((i) => i.code === "zoneMin" && i.vals.zone === "main");
  assert.equal(min.length, 1, "target 99, tem 98 → zoneMin");
});

test("Commander/Partner: 2 comandantes baixam o alvo do main pra 98", () => {
  const main = Array.from({ length: 98 }, (_, i) => ({ id: `c${i}`, qty: 1 }));
  const cards = main.map((e) => ({ id: e.id, name: e.id, cardType: "Creature", colorId: "" }));
  cards.push({ id: "cmd1", name: "Cmd1", cardType: "Legendary Creature", colorId: "" });
  cards.push({ id: "cmd2", name: "Cmd2", cardType: "Legendary Creature", colorId: "" });
  const deck = { game: "magic", format: "commander", zones: { commander: [{ id: "cmd1", qty: 1 }, { id: "cmd2", qty: 1 }], main } };
  const size = R.validate(deck, byId(cards)).filter((i) => i.code === "zoneMin" || i.code === "zoneMax");
  assert.equal(size.length, 0, "100 − 2 comandantes = 98, e o main tem 98");
});

test("Singleton: 2 cópias da mesma carta acusam; terreno básico é isento", () => {
  const cards = [
    { id: "sol", name: "Sol Ring", cardType: "Artifact", colorId: "" },
    { id: "forest", name: "Forest", cardType: "Basic Land — Forest", colorId: "" },
    { id: "cmd", name: "Cmd", cardType: "Legendary Creature", colorId: "" }
  ];
  const deck = {
    game: "magic", format: "commander",
    zones: { commander: [{ id: "cmd", qty: 1 }], main: [{ id: "sol", qty: 2 }, { id: "forest", qty: 30 }] }
  };
  const issues = R.validate(deck, byId(cards));
  assert.equal(issues.filter((i) => i.code === "singleton" && i.cardId === "sol").length, 1, "2 Sol Ring = singleton");
  assert.equal(issues.filter((i) => i.code === "singleton" && i.cardId === "forest").length, 0, "30 Forest = isento");
});

test("canAdd: adicionar a 2ª cópia num singleton avisa (mas nunca barra)", () => {
  const card = { id: "sol", name: "Sol Ring", cardType: "Artifact", colorId: "" };
  const deck = { game: "magic", format: "commander", zones: { main: [{ id: "sol", qty: 1 }] } };
  const r = R.canAdd(deck, "main", card, byId([card]));
  assert.equal(r.ok, true);
  assert.ok(r.warn && r.warn.code === "singleton", "avisa singleton na 2ª cópia");
});

test("Modo livre (jogo sem pacote): validate não acusa nada", () => {
  const deck = { game: "jump", zones: { main: [{ id: "x", qty: 99 }] } };
  assert.equal(R.validate(deck, byId([{ id: "x", name: "X" }])).length, 0);
});
