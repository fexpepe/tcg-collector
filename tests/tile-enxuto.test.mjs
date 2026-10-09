// O tile de carta com metade dos nós (2026-10-08). Cada tile tinha ~67 nós
// (69 medidos no Base Set): 17 eram o SVG inline da bandeira dos EUA e 17,
// nós de texto da indentação do template. Numa grade de 60 cartas, ~2 mil nós
// a mais pra estilo, layout e memória do celular. Agora a bandeira é UMA
// <img> de data: URI e o template sai sem a indentação: 36 nós por tile,
// conferido em produção, com o tile do mesmo tamanho (372 px no celular).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared } from "./lib/shared-sandbox.mjs";

test("bandeira de idioma é uma <img> de data: URI (SVG com xmlns), com rótulo no span", () => {
  const { TCGShared } = loadShared();
  const html = TCGShared.cardFlag("en");
  assert.match(html, /^<span class="card-flag" title="[^"]+" role="img" aria-label="[^"]+"><img src="data:image\/svg\+xml,[^"]+" alt="" width="20" height="14"><\/span>$/);
  const uri = decodeURIComponent(/src="data:image\/svg\+xml,([^"]+)"/.exec(html)[1]);
  assert.ok(uri.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox='), "SVG como imagem precisa do xmlns");
  assert.ok(!html.includes("<svg"), "nada de SVG inline no tile");
  // Idioma sem bandeira segue em texto.
  assert.match(TCGShared.cardFlag("ko"), /card-flag-text/);
});

test("o HTML do tile sai sem a indentação do template", () => {
  const sandbox = loadShared("window.__t = { semEspacos };");
  const { semEspacos } = sandbox.__t;
  assert.equal(semEspacos("\n  <div>\n    <p>a</p>\n    <p>b <b>c</b></p>\n  </div>\n"), "<div><p>a</p><p>b <b>c</b></p></div>");
  // Espaço de verdade entre dois elementos na MESMA linha fica.
  assert.equal(semEspacos("<span>Holo</span> <span>1st</span>"), "<span>Holo</span> <span>1st</span>");
});
