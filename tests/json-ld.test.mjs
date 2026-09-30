// JSON-LD escapado pra dentro do <script> (scripts/lib/json-ld.mjs).
//
// O achado de 29/09/2026: o prerender-catalog.mjs escrevia o JSON-LD com o
// JSON.stringify cru, e um deck da comunidade chamado "</script><meta ...>"
// fechava o bloco e injetava um redirecionamento no <head> de /deck/<slug>.
// O prerender roda o build inteiro ao ser importado (await main() no topo, com
// rede e disco), então o teste fica no helper e numa conferência do PRÓPRIO
// template: todo bloco de JSON-LD de lá tem de passar por ele.
//
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { jsonLdSeguro } from "../scripts/lib/json-ld.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

// O ataque do achado: cabe no corte de 60 caracteres do nome do deck.
const ATAQUE = "</script><meta http-equiv=refresh content=0;url=//x.yz>";

// O Article do deckPageHtml, com o nome e o autor que vêm da tabela shares.
const articleDoDeck = (nome, autor) => ({
  "@context": "https://schema.org",
  "@type": "Article",
  headline: `${nome} — deck de Pokémon TCG`,
  datePublished: "2026-09-29T12:00:00Z",
  author: { "@type": "Person", name: autor },
  publisher: { "@type": "Organization", name: "Sleevu" },
  url: "https://sleevu.app/deck/ataque-pokemon-0badc0de"
});

// O que fica DENTRO do bloco quando o parser de HTML lê a página: ele fecha o
// <script> no primeiro "</script" seguido de espaço, "/" ou ">", sem olhar
// maiúscula (estado "script data" do HTML5), esteja onde estiver.
function conteudoDoBloco(json) {
  const pagina = `<script type="application/ld+json">${json}</script>\n<title>Deck</title>`;
  const abre = pagina.indexOf(">") + 1;
  return pagina.slice(abre, pagina.search(/<\/script[\s/>]/i));
}

test("nome de deck com </script> não fecha o bloco, e o JSON.parse devolve o nome original", () => {
  const ld = articleDoDeck(ATAQUE, "</script><b>");
  // O controle: com o JSON.stringify cru, o bloco fecha no meio do headline.
  assert.notEqual(conteudoDoBloco(JSON.stringify(ld)), JSON.stringify(ld));

  const texto = jsonLdSeguro(ld);
  assert.doesNotMatch(texto, /<\/script/i);
  assert.equal(conteudoDoBloco(texto), texto, "o bloco só pode fechar na própria tag de fechamento");
  const volta = JSON.parse(texto);
  assert.equal(volta.headline, `${ATAQUE} — deck de Pokémon TCG`);
  assert.equal(volta.author.name, "</script><b>");
  assert.deepEqual(volta, ld);
});

test("as outras formas que o parser aceita também ficam presas no bloco", () => {
  // Maiúscula e espaço ou barra depois do nome da tag fecham igual. "<!--<script"
  // não fecha, mas faz o "</script>" de verdade deixar de fechar (o resto da
  // página vira JSON). A barra invertida antes do "<" confere que o escape não
  // se confunde com um escape que já estava na string.
  for (const nome of ["</SCRIPT >", "</ScRiPt/", "<!--<script>", "--><b>", "\\</script>"]) {
    const texto = jsonLdSeguro({ name: nome });
    assert.doesNotMatch(texto, /[<>]/, `${JSON.stringify(nome)} -> ${texto}`);
    assert.equal(JSON.parse(texto).name, nome);
  }
});

test("& e U+2028/U+2029 saem escapados, com o valor intacto", () => {
  const nome = "Sword & Shield\u2028Scarlet & Violet\u2029";
  const texto = jsonLdSeguro({ name: nome });
  assert.equal(texto, '{"name":"Sword \\u0026 Shield\\u2028Scarlet \\u0026 Violet\\u2029"}');
  assert.equal(JSON.parse(texto).name, nome);
});

test("texto sem esses caracteres sai idêntico ao JSON.stringify", () => {
  // É o caso de quase toda página: acento, CJK, URL e número não mudam, então o
  // HTML publicado só muda onde havia algo a escapar.
  const ld = {
    "@type": "Product",
    name: "Pokémon ex 161/131 — ブラッキーex",
    image: "https://assets.tcgdex.net/ja/sv/sv8a/217/high.png",
    offers: { "@type": "AggregateOffer", lowPrice: "12.50", offerCount: 1 },
    sku: undefined // o JSON.stringify some com a chave, e o helper também
  };
  assert.equal(jsonLdSeguro(ld), JSON.stringify(ld));
});

test("todo bloco de JSON-LD do prerender passa pelo helper", () => {
  const fonte = readFileSync(join(RAIZ, "scripts", "prerender-catalog.mjs"), "utf8");
  // <script> com conteúdo, numa linha só (os de src="" vêm vazios).
  const blocos = [...fonte.matchAll(/<script\b[^>]*>(.*?)<\/script>/g)].filter((m) => m[1].trim());
  // Hoje são cinco: set, artista, deck e carta (Product + BreadcrumbList).
  assert.ok(blocos.length >= 5, `achei ${blocos.length} blocos; o formato do template mudou?`);
  for (const [bloco, conteudo] of blocos) {
    assert.match(conteudo, /^\$\{jsonLdSeguro\(\w+\)\}$/, `bloco sem o helper: ${bloco}`);
  }
  // Um bloco montado de outro jeito (em várias linhas, por concatenação) não
  // passa pelo filtro de cima, mas aparece aqui.
  const mencoes = (fonte.match(/application\/ld\+json/g) || []).length;
  assert.equal(mencoes, blocos.length, "há JSON-LD no prerender fora do formato conferido acima");
});
