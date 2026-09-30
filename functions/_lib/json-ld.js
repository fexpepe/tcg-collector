// JSON-LD das páginas pré-renderizadas (prerender-catalog.mjs) e das montadas
// na borda (functions/blog/), escapado pra viver DENTRO de um <script>.
//
// O bug que motivou (29/09/2026): os blocos de JSON-LD do prerender escreviam
// `${JSON.stringify(obj)}` cru. O JSON.stringify não escapa "<" nem ">", e o
// HTML não sabe que ali dentro é JSON: o parser fecha o <script> no primeiro
// "</script" que encontrar, mesmo no meio de uma string. O nome do deck da
// comunidade (tabela shares: qualquer conta publica, corte em 60 caracteres)
// vai pro headline do Article, e um deck chamado
//   </script><meta http-equiv=refresh content=0;url=//x.yz>
// fechava o bloco. O <meta> virava HTML de verdade no <head> de
// sleevu.app/deck/<slug>, um redirecionamento aberto justo na página que recebe
// o tráfego do Google. A CSP do _headers barra script inline, mas não barra
// <meta refresh>. O autor do deck (30 caracteres) tinha o mesmo caminho. Os
// nomes de set, carta e artista (TCGdex, TCGCSV, Scryfall, Lorcast) também,
// com risco menor por virem de API de terceiros.
//
// A saída continua sendo JSON válido e com o MESMO valor: "\u003c" é "<" pro
// JSON.parse e pro Google. Os caracteres trocados só aparecem dentro de string
// (a sintaxe do JSON não usa nenhum deles):
//   < >        não sobra "</script", "<!--" nem "<script" no texto. Escapar
//              só o "</" não bastaria: "<!--<script" não fecha nada, mas põe o
//              parser num estado em que o "</script>" de verdade deixa de
//              fechar o bloco, e o resto da página vira JSON.
//   &          no <script> do HTML5 não faz diferença (lá dentro não existe
//              entidade), mas faz se a página for lida como XHTML.
//   U+2028/9   o JSON aceita, o JavaScript anterior ao ES2019 não: se o bloco
//              um dia virar script executável, a string não quebra.
// É o mesmo conjunto que o encoding/json do Go e o json_escape do Rails
// escapam. Texto sem nenhum desses caracteres sai idêntico ao JSON.stringify.
//
// Mora em functions/ (e não em scripts/lib/, onde nasceu) desde 2026-09-30:
// as Functions do blog (functions/blog/) montam o JSON-LD do post na borda, e o
// deploy apaga scripts/ antes de o wrangler empacotar as Functions. O
// scripts/lib/json-ld.mjs ficou como reexport pro prerender e os testes. As
// outras Functions (detail.js, users/) só trocam atributo e texto pelo
// HTMLRewriter, que escapa sozinho.
export function jsonLdSeguro(obj) {
  return JSON.stringify(obj).replace(/[<>&\u2028\u2029]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}
