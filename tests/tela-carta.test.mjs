// Tela da carta (2026-10-13): o popup virou a PÁGINA da carta. Duas formas da
// mesma tela — camada por cima da grade (clique) e página no fluxo (o endereço
// /games/<jogo>/<set>/<carta>, que é o que o Google e quem recebe o link veem).
// Estes testes seguram as regras que, se quebrarem, não dão erro nenhum: só
// devolvem o set com o popup por cima, a ação cortada no celular ou as notas
// PSA em dobro.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shared = readFileSync(new URL("../src/shared.js", import.meta.url), "utf8");
const detail = readFileSync(new URL("../src/detail.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function regra(seletor, desde = 0) {
  const i = css.indexOf(seletor + " {", desde);
  assert.ok(i >= 0, `sumiu a regra ${seletor}`);
  return css.slice(i, css.indexOf("}", i));
}

test("o endereço da carta abre a carta como PÁGINA, sem o set por baixo", () => {
  // A classe sai cedo (antes do catálogo) pra o set não piscar na tela...
  assert.ok(detail.includes('document.body.classList.add("carta-pagina");'));
  // ...e é ela que esconde o resto da tela do set.
  assert.ok(css.includes("body.carta-pagina main > :not(#cardPreviewModal):not(.cs-more):not(.cs-esqueleto) { display: none; }"));
  // Carta que não está no set, ou catálogo que não chegou: o set volta.
  assert.ok(detail.includes("saiDaPaginaDaCarta(); // a carta do endereço não está no set: mostra o set"));
  assert.ok(detail.includes("saiDaPaginaDaCarta(); // e o erro aparece no lugar do set"));
});

test("no modo página a tela não fecha, não trava a rolagem e não empilha histórico", () => {
  assert.ok(shared.includes("const empilha = !modoPagina && gestoDeVolta()"), "voltar sai da página, não fecha a carta");
  assert.ok(shared.includes("if (!modoPagina) close(); // a página não fecha"), "Esc não apaga a página");
  const abre = shared.indexOf("    function open(cardId, variant, opts) {");
  const trava = shared.indexOf('document.body.classList.add("preview-open");', abre);
  assert.ok(abre > 0 && shared.lastIndexOf("if (!modoPagina) {", trava) > abre, "preview-open (trava a rolagem) só na camada");
});

test("celular: a fileira −/Tenho/+ fica presa no pé, com folga do gesto de home", () => {
  const ini = css.indexOf("/* TELA DA CARTA no celular");
  assert.ok(ini > 0);
  const barra = regra("  #cardPreviewModal .preview-content > .preview-actions", ini);
  assert.ok(barra.includes("order: 99;"), "última da coluna (é ela que gruda no pé)");
  assert.ok(barra.includes("position: sticky;") && barra.includes("bottom: 0;"));
  // O piso do max() vale no PWA do iOS, onde o env() vem zero (check-mobile).
  assert.ok(barra.includes("max(12px, var(--tabbar-lift, 12px))"));
});

test("as notas PSA aparecem uma vez só (na seção de graduadas)", () => {
  assert.ok(!shared.includes("gradedHtml("), "a cotação não monta mais o bloco graded");
  assert.ok(shared.includes('<section class="cs-sec graded-price" data-graded-price hidden></section>'));
});

test("o ‹ › da página anda pelo set em ordem de número; a camada, pela grade", () => {
  assert.ok(shared.includes("if (modoPagina && listaDaTela) {"));
  assert.ok(shared.includes('document.querySelectorAll(".image-open[data-preview-card-id], .tile-name[data-preview-card-id]")'));
  assert.ok(detail.includes(".sort((a, b) => shared.compareCardNumbers(a.number, b.number))"));
});

test("desktop: o clique leva à PÁGINA da carta; celular segue na camada", () => {
  // 2026-10-14: a folha por cima ficou estranha no desktop. Acima do corte do
  // celular o open() vai pra página — e o ‹ ›, a troca de versão/idioma e o
  // próprio modo página não podem navegar (virariam um laço de recarga).
  assert.ok(shared.includes('if (window.matchMedia("(max-width: 720px)").matches) return false;'));
  assert.ok(shared.includes("if (!(opts && (opts.pagina || opts.nav || opts.versao)) && lookupCard(cardId)"));
  assert.ok(shared.includes("/_id/${encodeURIComponent(card.id)}?setName="), "o mesmo link do compartilhar");
  // Na tela do set a troca é no próprio documento, e o voltar devolve a grade.
  assert.ok(detail.includes('history.pushState({ sleevuCarta: 1 }, "", caminho);'));
  assert.ok(detail.includes("if (!m[1]) { if (naPagina) voltaPraGrade(); return; }"));
  assert.ok(detail.includes("window.scrollTo(0, scrollDaGrade);"));
});

test("o valor em destaque é o MESMO cardValue do tile", () => {
  const i = shared.indexOf("function precoHeroiHtml() {");
  const corpo = shared.slice(i, shared.indexOf("\n    }\n", i));
  assert.ok(corpo.includes("cardValue(activeCard, v, prices)"));
});
