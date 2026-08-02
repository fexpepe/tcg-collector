// Testes do pickSetEdition (src/shared.js): a página de um set precisa abrir
// UMA edição, porque o NOME do set não é chave única no catálogo. Sem isso o
// "151" abria com as 207 cartas EN + as 207 PT e o "Valor total"/"Falta
// comprar" saíam no dobro — a carta PT reaproveita a referência de preço da EN.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

const EXPOSE = "window.__test = { pickSetEdition };";

// Catálogo mínimo no formato que a página usa: id, setId e language.
function edicao(setId, language, n, sufixo) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${setId}-${i + 1}${sufixo || ""}`,
    set: "nome-compartilhado",
    setId,
    language
  }));
}

function api(cardLang) {
  const seed = cardLang ? { "tcg-collector-card-lang-v1": cardLang } : {};
  return loadShared(EXPOSE, { localStorage: makeLocalStorage(seed) }).window.__test.pickSetEdition;
}

test("mesmo setId em duas línguas: fica só uma edição (Inglês por padrão)", () => {
  const pick = api();
  const todas = edicao("sv03.5", "en", 207).concat(edicao("sv03.5", "pt", 207, "-pt"));
  const escolhida = pick(todas, "", "");
  assert.equal(escolhida.length, 207);
  assert.ok(escolhida.every((c) => c.language === "en"));
});

test("região pedida no link vence o padrão", () => {
  const pick = api();
  const todas = edicao("sv03.5", "en", 207).concat(edicao("sv03.5", "pt", 207, "-pt"));
  const escolhida = pick(todas, "sv03.5", "portuguese");
  assert.equal(escolhida.length, 207);
  assert.ok(escolhida.every((c) => c.language === "pt"));
});

test("sets HOMÔNIMOS com setIds diferentes: o setId do link decide", () => {
  const pick = api();
  // レイジングサーフ é SV3a (92 cartas) e SV4a (360), as duas em japonês.
  const todas = edicao("SV3a", "ja", 92).concat(edicao("SV4a", "ja", 360));
  assert.equal(pick(todas, "SV3a", "japanese").length, 92);
  assert.equal(pick(todas, "SV4a", "japanese").length, 360);
});

test("link sem setId/região numa edição que não existe em Inglês: cai na maior", () => {
  const pick = api();
  const todas = edicao("SV3a", "ja", 92).concat(edicao("SV4a", "ja", 360));
  const escolhida = pick(todas, "", "");
  assert.equal(escolhida.length, 360);
  assert.equal(escolhida[0].setId, "SV4a");
});

test("preferência de idioma de carta serve de padrão quando o link não diz nada", () => {
  const pick = api("pt");
  const todas = edicao("sv03.5", "en", 207).concat(edicao("sv03.5", "pt", 207, "-pt"));
  const escolhida = pick(todas, "", "");
  assert.ok(escolhida.every((c) => c.language === "pt"));
});

test("zh-cn e zh-tw são a MESMA região (Chinês único do site): não se separam", () => {
  const pick = api();
  const todas = edicao("SV8a", "zh-cn", 237).concat(edicao("SV8a", "zh-tw", 237, "-zh-tw"));
  assert.equal(pick(todas, "SV8a", "chinese").length, 474);
});

test("set de nome único passa intacto", () => {
  const pick = api();
  const todas = edicao("sv09", "en", 120);
  assert.equal(pick(todas, "", "").length, 120);
  assert.equal(pick([], "", "").length, 0);
});
