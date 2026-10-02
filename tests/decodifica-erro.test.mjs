// scripts/decodifica-erro.mjs: a ponte entre a "fonte" que o /admin mostra
// (arquivo minificado com hash, linha:coluna) e o código do repositório. Um
// erro de uma casa no VLQ ou na base (o navegador conta coluna a partir de 1,
// o source map a partir de 0) aponta a linha VIZINHA — e a investigação vai
// pro lugar errado com toda a confiança. Por isso as contas são travadas aqui
// contra um mapa montado à mão, sem rede.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodificaVlq, linhasDoMapa, localiza, extraiPosicoes } from "../scripts/decodifica-erro.mjs";

// Codificador de referência (o inverso do que o script decodifica).
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function vlq(n) {
  let v = n < 0 ? ((-n) << 1) | 1 : n << 1, s = "";
  do { let d = v & 31; v >>>= 5; if (v > 0) d |= 32; s += B64[d]; } while (v > 0);
  return s;
}
// Segmentos ABSOLUTOS por linha gerada → string `mappings` (deltas).
function monta(linhas) {
  let f = 0, l = 0, c = 0, n = 0;
  return linhas.map((segs) => {
    let g = 0;
    return segs.map(([gc, sf, sl, sc, sn]) => {
      const partes = [gc - g, sf - f, sl - l, sc - c];
      g = gc; f = sf; l = sl; c = sc;
      if (sn != null) { partes.push(sn - n); n = sn; }
      return partes.map(vlq).join("");
    }).join(",");
  }).join(";");
}

test("VLQ: ida e volta com números grandes e negativos", () => {
  for (const n of [0, 1, -1, 15, 16, -16, 31, 32, 1000, -1000, 123456, -987654]) {
    assert.deepEqual(decodificaVlq(vlq(n)), [n], `falhou em ${n}`);
  }
  assert.deepEqual(decodificaVlq("AAAA"), [0, 0, 0, 0]);
  assert.deepEqual(decodificaVlq("SAAS"), [9, 0, 0, 9]);
  assert.throws(() => decodificaVlq("A*A"));
});

test("linhasDoMapa acumula fonte/linha/coluna pelo arquivo e recomeça a coluna gerada por linha", () => {
  const abs = [
    [[0, 0, 0, 0], [10, 0, 2, 4, 0]],
    [],
    [[3, 1, 40, 2], [20, 0, 7, 0, 1]]
  ];
  assert.deepEqual(linhasDoMapa(monta(abs)), [
    [[0, 0, 0, 0, -1], [10, 0, 2, 4, 0]],
    [],
    // segmento sem o 5º campo não tem nome, mesmo depois de um que tinha
    [[3, 1, 40, 2, -1], [20, 0, 7, 0, 1]]
  ]);
});

test("localiza: coluna do navegador (base 1) cai no último segmento que começa antes dela", () => {
  const mapa = {
    sources: ["shared.js", "app.js"],
    names: ["mandaEvento", "render"],
    sourcesContent: ["linha 1\nlinha 2\n  fetch(eventos)\n", "a\nb"],
    mappings: monta([[[0, 0, 0, 0], [100, 0, 2, 2, 0], [200, 1, 1, 0, 1]]])
  };
  const linhas = linhasDoMapa(mapa.mappings);
  // coluna 101 no navegador = 100 no mapa: exatamente o início do 2º segmento
  assert.deepEqual(localiza(mapa, linhas, 1, 101), { arquivo: "shared.js", linha: 3, coluna: 3, nome: "mandaEvento", texto: "fetch(eventos)" });
  // coluna 100 ainda é o 1º segmento (o 2º começa depois)
  assert.equal(localiza(mapa, linhas, 1, 100).linha, 1);
  assert.equal(localiza(mapa, linhas, 1, 250).arquivo, "app.js");
  assert.equal(localiza(mapa, linhas, 2, 1), null, "linha sem mapeamento");
});

test("extraiPosicoes entende a pilha do Chrome, do Safari/Firefox e a posição solta", () => {
  assert.deepEqual(extraiPosicoes("    at No (https://sleevu.app/src/shared.a9fc7e26.js:93:2765)"),
    [{ url: "https://sleevu.app/src/shared.a9fc7e26.js", linha: 93, coluna: 2765 }]);
  assert.deepEqual(extraiPosicoes("No@https://sleevu.app/src/shared.a9fc7e26.js:93:2765"),
    [{ url: "https://sleevu.app/src/shared.a9fc7e26.js", linha: 93, coluna: 2765 }]);
  assert.deepEqual(extraiPosicoes("https://sleevu.app/sw.js:1:500 e https://sleevu.app/src/app.f88583a3.js?v=2:4:10"), [
    { url: "https://sleevu.app/sw.js", linha: 1, coluna: 500 },
    { url: "https://sleevu.app/src/app.f88583a3.js", linha: 4, coluna: 10 }
  ]);
  assert.deepEqual(extraiPosicoes("promise"), []);
});
