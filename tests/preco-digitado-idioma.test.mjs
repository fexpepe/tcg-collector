// Dinheiro DIGITADO segue o idioma da interface (src/shared.js: parseMoney e
// moneyInput). Até 2026-11-22 toda vírgula era a decimal, em qualquer idioma:
// com o site em inglês, "1,250" gravava 1.25 e "$2,000" gravava 2 — preço de
// venda, pago, alvo da wishlist, slab e preço manual 1000× menores. E o campo
// já nascia com vírgula ("12,5", placeholder "0,00") também em inglês, o que
// convidava a digitar por cima no formato errado.
// O que está travado aqui:
//   - a régua do parseMoney nos três idiomas (pt e es: vírgula decimal; en:
//     ponto), e que o pt segue dando o que sempre deu;
//   - o campo escreve no decimal do idioma, e o que ele escreve o parseMoney
//     lê de volta no mesmo número (ida e volta);
//   - nenhuma tela voltou a ter o "0,00" fixo nem a conta própria de vírgula.
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

// O shared.js inteiro, com o idioma da interface escolhido como o site
// escolhe: a chave do seletor de idioma no localStorage. Usa o export público
// (window.TCGShared) de propósito — sales.js, graded-ui.js e as outras telas
// chamam shared.parseMoney e shared.moneyInput, então a chave sumir do export
// tem que quebrar aqui.
function noIdioma(lang) {
  const sb = loadShared("", { localStorage: makeLocalStorage({ "tcg-collector-ui-lang-v1": lang }) });
  const { parseMoney, moneyInput, getLanguage } = sb.window.TCGShared;
  assert.equal(getLanguage(), lang, "o sandbox não subiu no idioma pedido");
  return { parseMoney, moneyInput };
}
const pt = noIdioma("pt");
const en = noIdioma("en");
const es = noIdioma("es");

// [texto digitado, número esperado]
function confere(api, casos) {
  for (const [texto, esperado] of casos) {
    assert.equal(api.parseMoney(texto), esperado, `parseMoney(${JSON.stringify(texto)})`);
  }
}

// Vírgula decimal: pt e es dão o MESMO resultado em tudo.
const VIRGULA_DECIMAL = [
  // só o decimal do idioma, uma vez: é decimal (o pt de sempre)
  ["12,50", 12.5],
  ["1,250", 1.25],
  ["0,5", 0.5],
  [",5", 0.5],
  // só o decimal do idioma, várias vezes: é milhar
  ["1,234,567", 1234567],
  // só o OUTRO separador: milhar se fechar grupos de 3...
  ["1.500", 1500],
  ["12.345.678", 12345678],
  ["-1.500", -1500],
  // ...senão é decimal (quem digita no costume do inglês)
  ["1.5", 1.5],
  ["12.50", 12.5],
  ["1250.5", 1250.5],
  // nem grupos de 3 nem um decimal só: lixo, dá 0
  ["1.2.3", 0],
  // sem separador
  ["1250", 1250],
  ["0", 0]
];

// Ponto decimal: o espelho da tabela de cima.
const PONTO_DECIMAL = [
  ["12.50", 12.5],
  ["1.500", 1.5],
  ["0.5", 0.5],
  [".5", 0.5],
  ["12.345.678", 12345678],
  // o bug: em inglês a vírgula é MILHAR
  ["1,250", 1250],
  ["2,000", 2000],
  ["1,234,567", 1234567],
  ["-1,500", -1500],
  // fora de grupos de 3 é decimal (quem digita no costume do pt)
  ["1,25", 1.25],
  ["12,5", 12.5],
  ["1,2,3", 0],
  ["1250", 1250],
  ["0", 0]
];

// Os dois separadores juntos: o ÚLTIMO é o decimal, em qualquer idioma.
const DOIS_SEPARADORES = [
  ["1.250,50", 1250.5],
  ["1,250.50", 1250.5],
  ["1.234.567,89", 1234567.89],
  ["1,234,567.89", 1234567.89],
  ["-1.250,50", -1250.5],
  // três casas depois do último não viram milhar: ele é o decimal
  ["1.250,500", 1250.5],
  ["1,250.500", 1250.5]
];

// Símbolo e espaço saem antes; vazio e lixo dão 0, em qualquer idioma.
const LIMPEZA = [
  ["", 0],
  ["   ", 0],
  ["abc", 0],
  ["-", 0],
  [".", 0],
  [",", 0],
  [null, 0],
  [undefined, 0],
  ["  42  ", 42],
  ["€ 7", 7]
];

test("pt: vírgula é a decimal, ponto em grupos de 3 é milhar (como sempre foi)", () => {
  confere(pt, VIRGULA_DECIMAL);
  confere(pt, [["R$ 1.250,00", 1250], ["R$ 12,50", 12.5], ["US$ 2.000", 2000]]);
});

test("es: mesma régua do pt (es-ES também escreve vírgula decimal)", () => {
  confere(es, VIRGULA_DECIMAL);
  confere(es, [["€ 1.250,00", 1250], ["US$ 12,50", 12.5]]);
});

test("en: a vírgula é milhar — \"1,250\" é 1250 e \"$2,000\" é 2000, não 1.25 e 2", () => {
  confere(en, PONTO_DECIMAL);
  confere(en, [["$2,000", 2000], ["US$ 1,250.00", 1250], ["$ 12.50", 12.5], ["R$ 1,250", 1250]]);
});

test("os dois separadores juntos: o último é o decimal, nos três idiomas", () => {
  for (const api of [pt, en, es]) confere(api, DOIS_SEPARADORES);
});

test("símbolo e espaço saem; vazio e lixo dão 0, nos três idiomas", () => {
  for (const api of [pt, en, es]) confere(api, LIMPEZA);
});

test("moneyInput: o campo escreve no decimal do idioma, sem símbolo nem milhar", () => {
  for (const api of [pt, es]) {
    assert.equal(api.moneyInput(12.5), "12,5");
    assert.equal(api.moneyInput(12.5, 1), "12,50");
    assert.equal(api.moneyInput(1250), "1250");
    assert.equal(api.moneyInput(1250, 1), "1250,00");
    assert.equal(api.moneyInput(1234567.89, 1), "1234567,89");
    assert.equal(api.moneyInput(0, 1, 1), "0,00", "o placeholder");
    assert.equal(api.moneyInput(0, 0, 1), "0");
  }
  assert.equal(en.moneyInput(12.5), "12.5");
  assert.equal(en.moneyInput(12.5, 1), "12.50");
  assert.equal(en.moneyInput(1250), "1250");
  assert.equal(en.moneyInput(1250, 1), "1250.00");
  assert.equal(en.moneyInput(1234567.89, 1), "1234567.89");
  assert.equal(en.moneyInput(0, 1, 1), "0.00", "o placeholder");
  assert.equal(en.moneyInput(0, 0, 1), "0");
});

test("moneyInput: sem valor o campo fica vazio (é o placeholder que aparece)", () => {
  for (const api of [pt, en, es]) {
    for (const vazio of [0, null, undefined, "", NaN, -3]) {
      assert.equal(api.moneyInput(vazio), "", `moneyInput(${String(vazio)})`);
      assert.equal(api.moneyInput(vazio, 1), "", `moneyInput(${String(vazio)}, 1)`);
    }
    // o "2" é o data-price-fmt do atalho "Preço NM" (string, direto do dataset)
    assert.equal(api.parseMoney(api.moneyInput(7, "2")), 7);
  }
});

test("ida e volta: o que o campo escreve, o parseMoney lê no mesmo número", () => {
  // 1.234 e 0.125 são o caso traiçoeiro: três casas depois do separador
  // parecem um grupo de milhar, e NÃO podem ser lidas como 1234 e 125.
  const valores = [0.01, 0.5, 1.5, 9.99, 12.5, 100, 999.99, 1000, 1250, 1250.5, 1.234, 0.125, 12345.67, 1234567.89];
  for (const [nome, api] of [["pt", pt], ["en", en], ["es", es]]) {
    for (const v of valores) {
      assert.equal(api.parseMoney(api.moneyInput(v)), v, `${nome}: ${v} cru`);
      assert.equal(api.parseMoney(api.moneyInput(v, 1)), Number(v.toFixed(2)), `${nome}: ${v} com duas casas`);
    }
  }
});

// As telas com campo de dinheiro. O texto delas não roda aqui (pedem DOM e
// catálogo): lê-se o fonte, sem os comentários, que citam os formatos velhos.
const TELAS = ["shared", "sales", "graded-ui", "binders", "wishlist", "portfolio", "troca", "scan"];
const semComentario = (js) => js.replace(/\/\/[^\n]*/g, "");

test("nenhum campo de dinheiro voltou a ter o placeholder \"0,00\" fixo", () => {
  const comFixo = TELAS.filter((nome) => /placeholder="0[.,]00"/.test(semComentario(ler(`src/${nome}.js`))));
  assert.deepEqual(comFixo, [], "placeholder de dinheiro sai do shared.moneyInput(0, 1, 1), que segue o idioma");
});

test("as telas leem dinheiro pelo shared.parseMoney, sem conta própria de vírgula", () => {
  // Alvo da wishlist, selados do Portfólio, valor da troca e faixas de som do
  // scanner tinham cada um a sua conta (vírgula = decimal, sempre) — o mesmo
  // bug do parseMoney antigo, em quatro lugares.
  for (const nome of ["wishlist", "portfolio", "troca", "scan"]) {
    const js = semComentario(ler(`src/${nome}.js`));
    assert.ok(js.includes("shared.parseMoney("), `${nome}.js não lê o valor pelo shared.parseMoney`);
    assert.ok(!/\.replace\(\s*(["'],["']|\/,\/g?)\s*,\s*["']\.["']\s*\)/.test(js), `${nome}.js voltou a trocar vírgula por ponto na mão`);
  }
});
