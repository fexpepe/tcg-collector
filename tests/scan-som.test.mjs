// Som e vibração por FAIXA DE PREÇO no scanner (src/scan.js) — o que o
// ManaBox tem de melhor pra triar bulk sem olhar a tela, com as faixas na
// moeda do site e um som próprio pra carta da wishlist.
//
// O que se trava aqui:
//   - a faixa de cada preço, com as faixas padrão por moeda;
//   - a configuração guardada é tolerante: lixo, faixa invertida ou negativa
//     voltam ao padrão, e a faixa de uma moeda nunca vale pra outra;
//   - os avisos sobem com o valor (mais notas e mais agudas, mais pulsos);
//   - o aviso sai da leitura, e o áudio é liberado dentro do toque.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const scanSrc = readFileSync(join(here, "..", "src", "scan.js"), "utf8");
function load() {
  const sandbox = {
    console,
    document: { querySelector: () => null, getElementById: () => null },
    location: { origin: "https://sleevu.app" }
  };
  sandbox.window = sandbox;
  sandbox.window.TCGShared = { t: (k) => k, escapeHtml: String, escapeAttribute: String };
  vm.createContext(sandbox);
  vm.runInContext(scanSrc, sandbox);
  return sandbox.window.TCGScan;
}
const S = load();
const arr = (x) => JSON.parse(JSON.stringify(x));

test("faixa do preço: sem preço, barata, média e boa", () => {
  const [b, a] = [5, 50];
  assert.equal(S.faixaDePreco(0, b, a), -1);
  assert.equal(S.faixaDePreco(undefined, b, a), -1);
  assert.equal(S.faixaDePreco(0.3, b, a), 0);
  assert.equal(S.faixaDePreco(4.99, b, a), 0);
  assert.equal(S.faixaDePreco(5, b, a), 1);  // o limite de baixo já é média
  assert.equal(S.faixaDePreco(49.9, b, a), 1);
  assert.equal(S.faixaDePreco(50, b, a), 2); // o de cima já é boa
  assert.equal(S.faixaDePreco(1200, b, a), 2);
});

test("configuração: padrão por moeda, e o que está guardado vale só se fizer sentido", () => {
  // Nada guardado: ligado, com o padrão da moeda (R$ 5/50, US$ e € 1/10).
  assert.deepEqual(arr(S.configSom(null, "BRL")), { on: true, faixas: { BRL: [5, 50] } });
  assert.deepEqual(arr(S.configSom("", "USD").faixas.USD), [1, 10]);
  assert.deepEqual(arr(S.configSom(null, "EUR").faixas.EUR), [1, 10]);
  // Lixo no storage não quebra o scanner.
  assert.deepEqual(arr(S.configSom("{nao é json", "BRL")), { on: true, faixas: { BRL: [5, 50] } });
  // Guardado válido: vale, e o "desligado" é respeitado.
  const ok = JSON.stringify({ on: false, faixas: { BRL: [10, 100] } });
  assert.deepEqual(arr(S.configSom(ok, "BRL")), { on: false, faixas: { BRL: [10, 100] } });
  // Invertida, negativa ou não numérica: volta ao padrão.
  for (const par of [[100, 10], [5, 5], [-1, 10], ["x", 10], [5]]) {
    assert.deepEqual(arr(S.configSom(JSON.stringify({ faixas: { BRL: par } }), "BRL").faixas.BRL), [5, 50], JSON.stringify(par));
  }
  // A faixa em reais não vira faixa em dólar quando a moeda do site muda —
  // e continua guardada pra quando ela voltar.
  const c = S.configSom(JSON.stringify({ faixas: { BRL: [20, 200] } }), "USD");
  assert.deepEqual(arr(c.faixas.USD), [1, 10]);
  assert.deepEqual(arr(c.faixas.BRL), [20, 200]);
});

test("os avisos sobem com o valor, e a wishlist é o maior", () => {
  const maxHz = (k) => Math.max.apply(null, S.SONS[k].map((n) => n[0]));
  const notas = (k) => S.SONS[k].length;
  assert.ok(maxHz(0) < maxHz(1) && maxHz(1) < maxHz(2) && maxHz(2) <= maxHz("wl"));
  assert.ok(notas(0) < notas(1) && notas(1) < notas(2) && notas(2) <= notas("wl"));
  const pulsos = (k) => [].concat(S.VIBRA[k]).length;
  assert.ok(pulsos(0) < pulsos(1) && pulsos(1) < pulsos(2) && pulsos(2) <= pulsos("wl"));
  // Sem preço também avisa (leu a carta), e curto.
  assert.ok(S.SONS["-1"].length === 1 && S.VIBRA["-1"] > 0);
  // Todo aviso é curto: nada passa de meio segundo.
  for (const k of Object.keys(S.SONS)) {
    const fim = Math.max.apply(null, S.SONS[k].map(([, ini, dur]) => ini + dur));
    assert.ok(fim <= 0.5, `som ${k} dura ${fim}s`);
  }
});

test("o aviso sai da leitura, e o áudio é liberado no toque", () => {
  assert.match(scanSrc, /if \(achados\.length\) \{ avisar\(achados\[0\]\); return; \}/);
  // Safari: o AudioContext tem de nascer/voltar dentro de um gesto.
  assert.match(scanSrc, /btnLer\.addEventListener\("click", async \(\) => \{[\s\S]{0,160}?contextoAudio\(\)/);
  // Preferência do aparelho, com o storage protegido.
  assert.match(scanSrc, /const CHAVE_SOM = "tcg-scan-som-v1";/);
  assert.match(scanSrc, /try \{ localStorage\.setItem\(CHAVE_SOM/);
  assert.match(scanSrc, /try \{ tx = localStorage\.getItem\(CHAVE_SOM\); \}/);
});
