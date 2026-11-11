// Links de set direto no endereço /games/<jogo>/<set> (2026-11-10).
//
// O /detail?type=set&… responde 301 pro endereço do set desde 12/10
// (functions/detail.js), mas o app seguia montando o link assim: cada tile da
// tela de Sets e o nome do set na página de cada carta eram uma "Página com
// redirecionamento" no relatório do Search Console (529 em 12/10, 4.936 em
// 10/11), e o robô gastava dois pedidos por set. Agora:
// - a tela de Sets lê o endereço de cada set do índice que a borda já põe na
//   página (metaDoJogo, .jogo-indice), sem pedido a mais;
// - a página da carta troca o link do próprio set pelo endereço da tela.
// O que fica no /detail (e no 301): set de nome ambíguo (duas edições na
// mesma página), a casca crua do /sets, o app e as Impressões.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { metaDoJogo } from "../functions/games/[[path]].js";
import { jogoDaUrl } from "../functions/_lib/jogos.js";

const ler = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const app = ler("src/app.js");
const detail = ler("src/detail.js");

test("o índice da borda dá nome -> endereço, com o nome como texto do link", () => {
  const sets = [
    { slug: "base-set", nome: "Base Set", cartas: 102, data: "1999-01-09" },
    { slug: "altaria-latios", nome: "Altaria & Latios", cartas: 64, data: "2025-09-12" }
  ];
  const { indiceHtml } = metaDoJogo(jogoDaUrl("pokemon"), sets);
  assert.match(indiceHtml, /class="jogo-indice"/);
  const links = [...indiceHtml.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[2], m[1]]);
  // O app lê o textContent, que desfaz o escape: "Altaria &amp; Latios" vira o nome.
  assert.deepEqual(links, [["Base Set", "/games/pokemon/base-set"], ["Altaria &amp; Latios", "/games/pokemon/altaria-latios"]]);
});

test("tela de Sets: o tile sai com o endereço do índice, e o ambíguo e o app ficam no /detail", () => {
  assert.ok(app.includes('document.querySelectorAll(".jogo-indice a[href]").forEach((a) => enderecosDoIndice.set(a.textContent, a.getAttribute("href")));'));
  assert.ok(app.includes("if (window.SLEEVU_APP) return \"\";"), "no app o endereço /games é 301 que só a borda resolve");
  const ini = app.indexOf("function setDetailUrl(item) {");
  const corpo = app.slice(ini, app.indexOf("\n  }\n", ini));
  assert.ok(corpo.indexOf("!ambiguousSetNames.has(item.name) && enderecoDoSet(item.name)") > 0, "nome com duas edições não tem endereço próprio por edição");
  assert.ok(corpo.indexOf("if (proprio) return proprio;") < corpo.indexOf('detailUrl("set"'), "o endereço direto vem antes do /detail");
  // O índice de OUTRO jogo (cópia do service worker) sai antes de ser lido.
  assert.ok(app.indexOf('document.querySelectorAll("[data-indice-jogo]")') < app.indexOf("function enderecoDoSet(nome)"));
});

test("página da carta: o link do próprio set vira o endereço da tela", () => {
  assert.ok(detail.includes("aoAbrir: (card, pagina) => { linkDoSetNoEndereco(card); maisDoSet(card, pagina); },"));
  const ini = detail.indexOf("function linkDoSetNoEndereco(card) {");
  const corpo = detail.slice(ini, detail.indexOf("\n  }\n", ini));
  assert.ok(ini > 0);
  assert.match(corpo, /card\.set !== detailName/, "carta de outro set (tela de artista, Pokémon) segue pelo link antigo");
  assert.match(corpo, /window\.SLEEVU_APP/);
  assert.match(corpo, /a\.preview-set-link/);
});
