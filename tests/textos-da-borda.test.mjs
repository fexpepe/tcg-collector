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

test("home: os números da faixa seguem o separador do idioma, no cliente, e o HTML segue em pt", () => {
  const home = ler("src/home.js");
  assert.match(home, /querySelectorAll\("\.lp-stat strong"\)/);
  assert.match(home, /toLocaleString\(locale, \{ useGrouping: "always" \}\)/);
  // O número que o robô lê continua no HTML (e o admin-charts.test o trava).
  const html = ler("index.html");
  assert.match(html, /<strong>300\.000\+<\/strong>/);
  assert.match(html, /<strong>2\.800\+<\/strong>/);
  // O que o Intl devolve pra esses números nos três idiomas (o "always" segura
  // o separador também nos 4 dígitos, onde o es o tiraria).
  const fmt = (loc, n) => n.toLocaleString(loc, { useGrouping: "always" });
  assert.equal(fmt("en-US", 300000), "300,000");
  assert.equal(fmt("es-ES", 300000), "300.000");
  assert.equal(fmt("pt-BR", 300000), "300.000");
  assert.equal(fmt("en-US", 2800), "2,800");
  assert.equal(fmt("es-ES", 2800), "2.800");
  assert.equal(fmt("pt-BR", 2800), "2.800");
  // Só número puro é reescrito, e o "+" fica onde estava (o "48" não ganha um).
  const re = /^(\d[\d.]*)(\+?)$/;
  assert.ok(re.test("300.000+") && re.test("2.800+") && re.test("48"));
  assert.ok(!re.test("R$ · $ · €"));
  assert.equal(re.exec("48")[2], "");
});

test("vendas: a data da venda segue o idioma e valor fora do formato ISO sai como veio", () => {
  const fonte = ler("src/sales.js");
  const i = fonte.indexOf("const fmtDate = (s) => {");
  assert.ok(i > 0, "sumiu o fmtDate");
  // Extrai a função e roda com um `shared` de mentira (o idioma muda o formato).
  const corpo = fonte.slice(i, fonte.indexOf("};", i) + 2);
  const monta = (locale) => new Function("shared", `${corpo}; return fmtDate;`)({ getLocale: () => locale });
  assert.match(corpo, /day: "2-digit", month: "2-digit", year: "2-digit"/);
  assert.equal(monta("pt-BR")("2026-03-04"), "04/03/26");
  assert.equal(monta("es-ES")("2026-03-04"), "04/03/26");
  assert.equal(monta("en-US")("2026-03-04"), "03/04/26");
  for (const solto of ["", "04/03/26", "2026-3-4", "2026-13-45", undefined]) {
    assert.equal(monta("en-US")(solto), solto, `${solto} sai como veio`);
  }
});

test("página de set em inglês: a trilha 'Games' aponta pro /hub, no link visível e no JSON-LD", () => {
  const fonte = ler("scripts/prerender-catalog.mjs");
  // O 1º nível da trilha: /hub em inglês, /games em português (o /games é uma
  // página estática só em português).
  assert.match(fonte, /\{ nome: isEn \? "Games" : "Jogos", url: `\$\{ORIGIN\}\$\{isEn \? "\/hub" : "\/games"\}` \}/);
  // Os dois lugares leem a MESMA lista `trilha`: link visível e BreadcrumbList.
  assert.match(fonte, /itemListElement: trilha\.map\(\(t, i\) => \(\{ "@type": "ListItem", position: i \+ 1, name: t\.nome, item: t\.url \}\)\)/);
  assert.match(fonte, /const trilhaHtml = [^\n]*\$\{trilha\.slice\(0, -1\)\s*\n?\s*\.map\(\(t\) => `<a href="\$\{escapeAttr\(t\.url\.replace\(ORIGIN, ""\)\)\}">/);
  assert.ok(ler("hub.html").length > 0, "o /hub existe (hub.html)");
});
