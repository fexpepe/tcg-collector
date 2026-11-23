// Decks: capas e miniaturas pelo espelho de imagens (2026-11-22).
//
// A galeria e o visualizador pediam a URL crua da origem (Scryfall, Lorcast...)
// em tamanho único. Agora toda <img> de carta do decks.js passa por
// shared.localizedImg (espelho na frente, origem na reserva) e as previews de
// hover por shared.hoverThumb. O que se trava aqui é a forma, que uma edição
// futura quebra sem perceber: voltar a montar <img src="${escA(url)}"> de carta
// a mão, ou usar `thumb` sem `sizes` (sem sizes o navegador assume 100vw e
// baixaria a de 600 px até numa miniatura de 26 px).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/decks.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("nenhum <img> de carta com a URL crua sobra no decks.js", () => {
  assert.equal(/<img[^>]*src="\$\{escA\(/.test(src), false, "ainda há <img src=\"${escA(...)}\"> de carta");
  assert.equal(/\.setAttribute\("src", card\.image\)/.test(src), false, "hover do editor ainda grava a URL crua");
  assert.equal(/img\.src = art/.test(src), false, "hover do visualizador ainda grava a URL crua");
});

test("as previews de hover usam hoverThumb (nó novo por carta, espelho na frente)", () => {
  assert.equal((src.match(/shared\.hoverThumb\(/g) || []).length, 2);
});

test("miniatura com thumb sempre leva sizes (e a regra do host reduzido existe)", () => {
  const miniaturas = src.match(/imgMini\(/g) || [];
  assert.ok(miniaturas.length >= 8, "pontos de miniatura esperados");
  // imgMini só liga thumb junto com sizes.
  assert.match(src, /Object\.assign\(\{ thumb: true, sizes: sizes \}, opts\)/);
  assert.equal(/thumb: true(?!, sizes: sizes)/.test(src), false, "thumb sem sizes");
  assert.match(src, /MINIATURA_REDUZIDA/);
});

test("data-art e data-capa seguem guardando a URL de ORIGEM (não a do espelho)", () => {
  assert.match(src, /data-art="\$\{escA\(card\.image\)\}"/);
  assert.match(src, /data-capa="\$\{escA\(capa\)\}"/);
  assert.equal(/img\.sleevu\.app/.test(src.replace(/\/\/.*$/gm, "")), false, "URL do espelho montada a mão no decks.js");
});
