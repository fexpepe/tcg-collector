// Filtro de faixa de preço de Cartas e do Explorar lê o número no idioma da
// interface (2026-11-22). Os dois tinham um parsePrice próprio em que toda
// vírgula era decimal: com o site em inglês, "1,000" no mínimo filtrava por 1,
// não por mil. O parseMoney do shared.js (travado em preco-digitado-idioma)
// já lê na régua do idioma; falta só as duas telas usarem ele.
// O que está travado aqui:
//   - cards.js e explore.js leem o campo pelo shared.parseMoney, sem a conta
//     própria de vírgula;
//   - o parsePrice DE VERDADE (extraído do fonte e rodado com o shared.js real
//     no idioma pedido): "1,000" = mil em inglês, "1.000" = mil em pt/es,
//     "1.5" e "1,5" = um e meio, e campo vazio segue "sem limite" (null) — o
//     parseMoney devolve 0 pra vazio, e 0 aqui seria um filtro de verdade.
// Roda com: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
// Checkout do Windows vem em CRLF (core.autocrlf): normaliza na leitura.
const ler = (rel) => readFileSync(join(raiz, rel), "utf8").replace(/\r\n/g, "\n");
const semComentario = (js) => js.replace(/\/\/[^\n]*/g, "");
const TELAS = ["cards", "explore"];

// O parsePrice que está no fonte da tela, isolado (vai da assinatura até o
// primeiro "}" na margem de 2 espaços) e ligado ao shared.js real no idioma.
function parsePriceDe(tela, lang) {
  const js = ler(`src/${tela}.js`);
  const m = js.match(/\n  function parsePrice\(el\) \{\n[\s\S]*?\n  \}\n/);
  assert.ok(m, `${tela}.js: parsePrice não encontrado (ou mudou de forma)`);
  const sb = loadShared("", { localStorage: makeLocalStorage({ "tcg-collector-ui-lang-v1": lang }) });
  const shared = sb.window.TCGShared;
  assert.equal(shared.getLanguage(), lang, "o sandbox não subiu no idioma pedido");
  const parsePrice = new Function("shared", `${m[0]}\nreturn parsePrice;`)(shared);
  return (texto) => parsePrice({ value: texto });
}

test("as duas telas leem a faixa de preço pelo shared.parseMoney", () => {
  for (const tela of TELAS) {
    const js = semComentario(ler(`src/${tela}.js`));
    assert.ok(js.includes("shared.parseMoney("), `${tela}.js não lê o preço pelo shared.parseMoney`);
    assert.ok(!/parseFloat\([^)]*replace\(/.test(js), `${tela}.js voltou à conta própria de vírgula`);
    assert.ok(!/\.replace\(\s*(["'],["']|\/,\/g?)\s*,\s*["']\.["']\s*\)/.test(js), `${tela}.js voltou a trocar vírgula por ponto na mão`);
  }
});

for (const tela of TELAS) {
  test(`${tela}: em inglês a vírgula é milhar e o ponto é decimal`, () => {
    const parsePrice = parsePriceDe(tela, "en");
    assert.equal(parsePrice("1,000"), 1000, "o bug: filtrava por 1");
    assert.equal(parsePrice("2,500.50"), 2500.5);
    assert.equal(parsePrice("1.5"), 1.5);
    assert.equal(parsePrice("12"), 12);
  });

  test(`${tela}: em pt e es o ponto em grupos de 3 é milhar e a vírgula é decimal`, () => {
    for (const lang of ["pt", "es"]) {
      const parsePrice = parsePriceDe(tela, lang);
      assert.equal(parsePrice("1.000"), 1000, lang);
      assert.equal(parsePrice("1.250,50"), 1250.5, lang);
      assert.equal(parsePrice("1,5"), 1.5, lang);
      assert.equal(parsePrice("12"), 12, lang);
    }
  });

  test(`${tela}: campo vazio, sem dígito, negativo e lixo = sem limite (null); só o "0" digitado vale 0`, () => {
    // Lixo com dígito: o parseMoney dá 0 (pt/es "1.2.3", en "1,2,3" — o separador
    // do OUTRO idioma repetido, que não fecha grupos de 3).
    const lixo = { pt: "1.2.3", es: "1.2.3", en: "1,2,3" };
    for (const lang of ["pt", "en", "es"]) {
      const parsePrice = parsePriceDe(tela, lang);
      for (const sem of ["", "   ", "abc", "-", ".", ",", "R$", "-5", lixo[lang]]) {
        assert.equal(parsePrice(sem), null, `${lang}: ${JSON.stringify(sem)} deveria ser sem limite`);
      }
      assert.equal(parsePrice("0"), 0, `${lang}: "0" digitado é um filtro de verdade`);
      assert.equal(parsePrice("0,5"), 0.5, lang);
      assert.equal(parsePrice("0.5"), 0.5, lang);
      assert.equal(parsePrice(undefined), null, `${lang}: value indefinido`);
    }
  });

  test(`${tela}: sem o campo na página (elemento ausente) é sem limite`, () => {
    const js = ler(`src/${tela}.js`);
    const m = js.match(/\n  function parsePrice\(el\) \{\n[\s\S]*?\n  \}\n/);
    const sb = loadShared("", { localStorage: makeLocalStorage({ "tcg-collector-ui-lang-v1": "pt" }) });
    const parsePrice = new Function("shared", `${m[0]}\nreturn parsePrice;`)(sb.window.TCGShared);
    assert.equal(parsePrice(null), null);
    assert.equal(parsePrice(undefined), null);
  });
}
