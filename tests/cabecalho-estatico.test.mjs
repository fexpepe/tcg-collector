// Cabeçalho das páginas estáticas (functions/_lib/cabecalho-estatico.js,
// 2026-09-30). No celular o styles.css desenha o cabeçalho do APP, que conta
// com o hambúrguer e o shared.js: nas páginas estáticas a marca sumia e os
// links viravam uma coluna de 38px à direita. O que se trava aqui:
//   - a marcação do app com o modificador, e rótulo hostil não vira HTML;
//   - o CSS: marca de volta, uma linha só que rola de lado, 44px de toque;
//   - a faixa do conserto cobre a faixa em que o app empilha o menu e esconde
//     a marca (se o styles.css trocar o 860 ou o 700, sobraria um buraco);
//   - todo molde (set, artista, /games e carta) usa o módulo: um cabeçalho
//     escrito à mão num molde volta ao defeito sem ninguém ver no desktop.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ESTILO_DO_CABECALHO, cabecalhoEstatico } from "../functions/_lib/cabecalho-estatico.js";
import { paginaDaCarta } from "../functions/_lib/pagina-carta.js";
import { slugsDasCartas } from "../functions/_lib/slug-carta.js";
import { jogoDaUrl } from "../functions/_lib/jogos.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
// Sem o CRLF da checkout do Windows: as regex daqui casam \n.
const ler = (f) => readFileSync(join(raiz, f), "utf8").replace(/\r\n/g, "\n");

// max-width do @media que ENVOLVE a primeira regra que casa com `re`. Os
// comentários viram espaço (mesmo tamanho, pros índices não andarem): alguns
// citam CSS com chave dentro e desmontariam a contagem.
function faixaDaRegra(css, re) {
  const i = css.search(re);
  assert.ok(i >= 0, `styles.css sem ${re}`);
  let faixa = null;
  for (const m of css.matchAll(/@media \(max-width: (\d+)px\)\s*\{/g)) {
    if (m.index > i) break;
    let nivel = 0, k = m.index + m[0].length - 1;
    for (; k < css.length; k++) {
      if (css[k] === "{") nivel++;
      else if (css[k] === "}" && --nivel === 0) break;
    }
    if (k > i) faixa = Number(m[1]);
  }
  return faixa;
}

// Corpo de uma regra dentro do bloco do celular do módulo.
function regra(seletor) {
  const bloco = /@media \(max-width: 860px\) \{([\s\S]*?)\n      \}/.exec(ESTILO_DO_CABECALHO);
  assert.ok(bloco, "o CSS do cabeçalho perdeu o bloco do celular");
  const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`${escapado} \\{([^}]*)\\}`).exec(bloco[1]);
  assert.ok(m, `o CSS do cabeçalho perdeu a regra ${seletor}`);
  return m[1];
}

test("a marcação é a do app, com o modificador e os links escapados", () => {
  const html = cabecalhoEstatico([["/games/pokemon", "Sets"], ["/x?a=1&b=2", "<b>Coleção</b>"]], "Pages");
  assert.match(html, /^<header class="app-header app-header--estatica">/);
  assert.match(html, /<a class="brand" href="\/">Sleevu<\/a>/);
  assert.match(html, /<nav class="page-nav" data-i18n-aria="aria\.pages" aria-label="Pages">/);
  assert.match(html, /<a href="\/games\/pokemon">Sets<\/a>/);
  assert.match(html, /<a href="\/x\?a=1&amp;b=2">&lt;b&gt;Coleção&lt;\/b&gt;<\/a>/);
  assert.doesNotMatch(html, /<b>/);
  assert.match(cabecalhoEstatico([["/", "Início"]]), /aria-label="Páginas"/, "o rótulo padrão é o português");
});

test("no celular: marca de volta, uma linha só que rola de lado e 44px de toque", () => {
  assert.match(regra(".app-header--estatica .app-header-inner .brand"), /display: inline-block;.*height: 44px/);
  const nav = regra(".app-header--estatica .app-header-inner .page-nav");
  for (const d of ["flex-direction: row", "flex-wrap: nowrap", "min-width: 0", "overflow-x: auto"]) {
    assert.ok(nav.includes(d), `o menu perdeu "${d}"`);
  }
  assert.match(regra(".app-header--estatica .app-header-inner .page-nav > a"), /min-height: 44px/);
  // O menu rola, então o contorno do foco tem que ficar DENTRO do link.
  assert.match(regra(".app-header--estatica .app-header-inner .page-nav > a:focus-visible"), /outline-offset: -\d+px/);
});

test("a faixa do conserto cobre a faixa em que o app empilha o menu e esconde a marca", () => {
  const css = ler("styles.css").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const empilha = faixaDaRegra(css, /\.app-header-inner \.page-nav \{\s*flex-direction: column/);
  const escondeMarca = faixaDaRegra(css, /\.app-header-inner \.brand \{ display: none; \}/);
  const nossa = Number(/@media \(max-width: (\d+)px\)/.exec(ESTILO_DO_CABECALHO)[1]);
  assert.ok(empilha && escondeMarca, "as regras do app não estão mais dentro de um @media (max-width)");
  assert.ok(nossa >= empilha, `o app empilha o menu até ${empilha}px e o conserto só vai até ${nossa}px`);
  assert.ok(nossa >= escondeMarca, `o app esconde a marca até ${escondeMarca}px e o conserto só vai até ${nossa}px`);
});

test("os moldes de set, artista, /games e carta usam o cabeçalho do módulo", () => {
  const prerender = ler("scripts/prerender-catalog.mjs");
  assert.doesNotMatch(prerender, /<header class="app-header"/, "cabeçalho escrito à mão no prerender");
  assert.equal((prerender.match(/cabecalhoEstatico\(/g) || []).length, 3, "esperava set, artista e /games");
  assert.match(prerender, /const PR_STYLE = `\s*<style>\n\$\{ESTILO_DO_CABECALHO\}/);

  // A carta é montada na borda: confere a saída de verdade.
  const cartas = [{ id: "base1-4", name: "Charizard", number: "4", setTotal: 102, set: "Base Set", setId: "base1", language: "en" }];
  const html = paginaDaCarta({ card: cartas[0], jogo: jogoDaUrl("pokemon"), set: { slug: "base-set", nome: "Base Set" }, cartas, slugs: slugsDasCartas(cartas), preco: 0, assets: {} });
  assert.match(html, /<header class="app-header app-header--estatica">/);
  assert.ok(html.includes(ESTILO_DO_CABECALHO), "o <style> da carta sem o CSS do cabeçalho");
  assert.match(html, /<a href="\/games\/pokemon">Sets<\/a>/);
});
