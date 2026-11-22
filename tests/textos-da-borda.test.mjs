// Os textos que a borda escreve em português seguem o idioma de quem lê
// (2026-11-22, pacote 2C da revisão de novembro). Estes testes leem a FONTE do
// cliente (o navegador não roda aqui): travam as linhas novas no lugar certo.
// As funções puras da borda têm teste em games-rota.test.mjs e indices.test.mjs.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ler = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("título da aba: o cliente troca pelo data-titulo-<idioma> da borda, sem pôr data-i18n no <title>", () => {
  const app = ler("src/app.js");
  const i = app.indexOf("data-titulo-${shared.getLanguage()}");
  assert.ok(i > 0, "a tela de sets (app.js) lê o atributo do idioma");
  assert.match(app.slice(i, i + 200), /document\.title = tituloNoIdioma/);

  const det = ler("src/detail.js");
  const corpo = det.slice(det.indexOf("function acertaTituloDaAba()"));
  const atributo = corpo.indexOf("data-titulo-${shared.getLanguage()}");
  const saida = corpo.indexOf("if (!detailName || rotaDaBorda");
  assert.ok(atributo > 0 && saida > 0, "as duas linhas existem em acertaTituloDaAba");
  assert.ok(atributo < saida, "o atributo é lido ANTES da saída antecipada da página da borda");
  assert.match(corpo.slice(0, saida), /rotaDaBorda/, "só vale pra página montada pra este endereço");

  // O título da borda nunca volta a ter data-i18n (o robô indexaria "Sets - Sleevu").
  const dec = ler("functions/_lib/decora-app.js");
  assert.match(dec, /el\.removeAttribute\("data-i18n"\)/);
  assert.doesNotMatch(dec, /setAttribute\("data-i18n"/);
});
