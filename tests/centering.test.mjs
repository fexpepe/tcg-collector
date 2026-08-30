// A conta do medidor de centralização (src/centering.js). É uma função de duas
// linhas, mas é o produto inteiro: a pessoa vai olhar 55/45 e decidir se manda
// a carta pra gradear. Errar o arredondamento aqui dá um número que não fecha
// em 100 — e um número que não fecha em 100 destrói a confiança na ferramenta.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
function load() {
  const sandbox = { console, document: { getElementById: () => null } };
  sandbox.window = sandbox;
  sandbox.window.TCGShared = { t: (k) => k, escapeHtml: String, escapeAttribute: String };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(here, "..", "src", "centering.js"), "utf8"), sandbox);
  return sandbox.window.TCGCentering;
}
const C = load();
// O módulo roda em outro realm do vm, então o Array que ele devolve não é o
// Array DESTE realm e deepStrictEqual reprova por protótipo. Copiar resolve.
const pct = (a, b) => Array.from(C.pct(a, b));

test("margens iguais dão 50/50", () => {
  assert.deepEqual(pct(0.1, 0.1), [50, 50]);
});

test("os dois lados sempre somam 100, mesmo com arredondamento torto", () => {
  // 1/3 arredonda pra 33; se o outro lado também arredondasse sozinho daria
  // 67 — mas 0,666… arredonda pra 67 e 33+67 = 100 só por sorte. Com 1/6 a
  // sorte acaba: 17 e 83. Por isso o segundo lado é 100 menos o primeiro.
  for (const [a, b] of [[1, 2], [1, 5], [1, 6], [7, 13], [0.13, 0.07], [0.119, 0.071]]) {
    const [x, y] = pct(a, b);
    assert.equal(x + y, 100, `${a}/${b} deu ${x}+${y}`);
  }
});

test("a proporção é o que manda, não o tamanho absoluto", () => {
  assert.deepEqual(pct(0.12, 0.08), pct(120, 80));
  assert.deepEqual(pct(0.12, 0.08), [60, 40]);
});

test("carta fora de centro: 40 de margem contra 20 dá 67/33", () => {
  assert.deepEqual(pct(40 / 300, 20 / 300), [67, 33]);
});

test("total zero não divide por zero — devolve 50/50", () => {
  assert.deepEqual(pct(0, 0), [50, 50]);
  assert.deepEqual(pct(-1, 1), [50, 50]);
});
