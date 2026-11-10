// Tela de SET sem o pulo da grade (2026-10-08). O trilho de resumo (hero +
// raridade + tipo + conjunto, 216 a 281 px) só aparece quando o chunk do set
// chega, no lugar do .detail-summary (stats zerados, 112 px): a barra de
// Ordenar e a grade desciam ~169 px de uma vez. Medido em produção com o
// chunk segurado: CLS 0,11 no celular e 0,08 no desktop (30th Celebration);
// num set pequeno (MagicFest 2027, 2 cartas) 0,63 no celular, porque o
// índice das cartas que a borda põe embaixo da grade subia pra dentro da tela
// quando os 12 esqueletos viravam 2 tiles. Com o lugar reservado: 0,02, e
// 0,01 no set pequeno.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(raiz, "styles.css"), "utf8");
const detail = readFileSync(join(raiz, "src/detail.js"), "utf8");

test("antes do catálogo, a tela de set esconde o resumo e o índice e guarda o lugar do trilho", () => {
  assert.match(css, /html\[data-detail="set"\]:not\(\[data-set-pronto\]\) \.detail-summary,\s*html\[data-detail="set"\]:not\(\[data-set-pronto\]\) \.set-indice \{ display: none; \}/);
  // Fora da rota de carta (2026-11-10): lá a tela do set fica escondida e o
  // !important daqui furava o display:none dela (ver o teste da rota abaixo).
  const m = /html\[data-detail="set"\]:not\(\[data-set-pronto\]\):not\(\[data-carta\]\) body:not\(\.carta-pagina\) #setInsights \{([^}]*)\}/.exec(css);
  assert.ok(m, "sumiu a reserva do trilho");
  // !important porque o [hidden] global também é !important.
  assert.match(m[1], /display: block !important;/);
  assert.match(m[1], /height: 235px;/);
});

test("o detail.js solta a reserva depois do init — e também quando o catálogo falha", () => {
  assert.ok(detail.includes('function setPronto() { document.documentElement.setAttribute("data-set-pronto", ""); }'));
  const init = detail.slice(detail.indexOf("  function init() {"), detail.indexOf("  function setPronto()"));
  assert.match(init, /render\(\);\s*setPronto\(\);\s*\}/, "o init termina soltando a reserva");
  assert.match(detail, /\.catch\(\(error\) => \{\s*setPronto\(\);/, "sem catálogo o lugar reservado tem de sair");
});

// Rota de CARTA (2026-11-10). Quem liga a página da carta é o detail.js
// (defer); até ele rodar, a tela pintava como SET, com os 235 px do trilho
// reservados, e o esqueleto da carta entrava por cima empurrando o trilho a
// tela inteira. Medido em produção e igual no ensaio local com o detail.js
// atrasado: CLS 0,23 no celular (o trilho de 168 pra 826 px) e 0,17 no
// desktop, em toda página de carta. Com o carimbo do game.js no <head>:
// 0,00 e 0,01.
test("rota de carta: o game.js carimba antes do paint, o CSS esconde o set e o detail.js assume", () => {
  const game = readFileSync(join(raiz, "src/game.js"), "utf8");
  assert.ok(game.includes('document.documentElement.setAttribute("data-carta", "");'), "o carimbo da rota de carta saiu do game.js");
  // O terceiro pedaço do endereço (a carta) é o grupo 1 do TELA_DO_SET.
  assert.ok(game.includes("if ((rotaSet && rotaSet[1])"));
  assert.match(css, /body\.carta-pagina main > :not\(#cardPreviewModal\):not\(\.cs-more\):not\(\.cs-esqueleto\),\s*html\[data-carta\] main > :not\(#cardPreviewModal\):not\(\.cs-more\):not\(\.cs-esqueleto\) \{ display: none; \}/);
  // O detail.js tira o carimbo nos dois casos (rota de carta ou não): dali em
  // diante quem manda é a classe do body, que ele liga e desliga.
  const liga = detail.indexOf('document.body.classList.add("carta-pagina");');
  const tira = detail.indexOf('document.documentElement.removeAttribute("data-carta");');
  assert.ok(liga > 0 && tira > liga && tira < detail.indexOf("function saiDaPaginaDaCarta()"), "o detail.js tem de assumir (e soltar o carimbo) no carregamento");
});
