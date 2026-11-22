// Página da carta (functions/_lib/pagina-carta.js). Desde 2026-10-01 o
// endereço da carta é a tela do set do APP com o popup dela aberto, e a borda
// põe nessa tela as peças que saem daqui (título, descrição, canonical, JSON-LD
// e o texto da carta). Função pura: recebe a carta, o set e as vizinhas. O que
// se trava aqui:
//   - canonical e trilha no endereço /games/…;
//   - preço e Product (com a oferta) só quando há preço;
//   - o parágrafo que o popup copia (.seo-carta-texto);
//   - nome de carta hostil não fecha o <script> do JSON-LD nem vira HTML;
//   - outras impressões e vizinhas de número apontam pras páginas certas;
//   - o título não corta o nome da carta.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pecasDaCarta, precoUSD, precoDeReferencia, tituloDaCarta, esqueletoDaCarta } from "../functions/_lib/pagina-carta.js";
import { cabecaDaRota } from "../functions/_lib/decora-app.js";
import { slugsDasCartas } from "../functions/_lib/slug-carta.js";
import { jogoDaUrl } from "../functions/_lib/jogos.js";

const jogo = jogoDaUrl("pokemon");
const set = { slug: "sv03-5-151", nome: "151" };
const cartas = [
  { id: "sv03.5-004", name: "Charmander", number: "004", setTotal: 165, set: "151", setId: "sv03.5", language: "en", rarity: "Common", artist: "Mizue", image: "https://assets.tcgdex.net/en/sv/sv03.5/004/high.png", setReleaseDate: "2023-09-22" },
  { id: "sv03.5-005", name: "Charmeleon", number: "005", setTotal: 165, set: "151", setId: "sv03.5", language: "en" },
  { id: "sv03.5-006", name: "Charizard ex", number: "006", setTotal: 165, set: "151", setId: "sv03.5", language: "en", variants: ["Normal", "Holo"] },
  { id: "sv03.5-006-pt", name: "Charizard ex", number: "006", setTotal: 165, set: "151", setId: "sv03.5", language: "pt" }
];
const slugs = slugsDasCartas(cartas);
const pecas = (card, preco = 0) => pecasDaCarta({ card, jogo, set, cartas, slugs, preco });
// O JSON-LD como sai no <head> da tela (é o cabecaDaRota que escreve os blocos).
const jsonLds = (p) => [...cabecaDaRota(p, { caminho: "/x" }).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

test("canonical, trilha e o que vai pro <head>", () => {
  const p = pecas(cartas[2], 120.5);
  assert.equal(p.canonical, "https://sleevu.app/games/pokemon/sv03-5-151/charizard-ex-006-165");
  assert.equal(p.titulo, "Charizard ex 006/165 · 151 | Sleevu");
  assert.equal(p.h1, "Charizard ex 006/165", "o h1 é o da carta: o endereço dela mostra a carta como página");
  assert.equal(p.ogImagem, "", "carta sem imagem não inventa og:image");
  const [, trilha] = jsonLds(p);
  assert.deepEqual(trilha.itemListElement.map((i) => i.item), [
    "https://sleevu.app/games",
    "https://sleevu.app/games/pokemon",
    "https://sleevu.app/games/pokemon/sv03-5-151",
    "https://sleevu.app/games/pokemon/sv03-5-151/charizard-ex-006-165"
  ]);
  assert.match(p.corpoHtml, /data-seo-carta="\/games\/pokemon\/sv03-5-151\/charizard-ex-006-165"/);
  assert.match(p.corpoHtml, /Ver o set completo: <a href="\/games\/pokemon\/sv03-5-151">151<\/a>/);
  assert.equal(pecas(cartas[0]).ogImagem, "https://assets.tcgdex.net/en/sv/sv03.5/004/high.png");
});

test("preço e oferta só quando há preço", () => {
  const [produto] = jsonLds(pecas(cartas[2], 120.5));
  assert.equal(produto.offers.lowPrice, "120.50");
  assert.equal(produto.offers.priceCurrency, "USD");
  assert.equal(produto.brand.name, "Pokémon TCG");
  // Sem preço não sai Product nenhum: Product sem offers/review/aggregateRating
  // é item inválido no Search Console (2026-10-02). Desde 2026-11-16 sai um
  // CreativeWork no lugar (nada de oferta nele), com a trilha.
  const semPreco = pecas(cartas[1], 0);
  assert.deepEqual(jsonLds(semPreco).map((o) => o["@type"]), ["CreativeWork", "BreadcrumbList"]);
  assert.doesNotMatch(JSON.stringify(jsonLds(semPreco)), /offers|Offer|priceCurrency/);
  assert.doesNotMatch(semPreco.corpoHtml, /seo-carta-preco">/);
  assert.equal(precoUSD({ u: 10 }), 10);
  assert.ok(Math.abs(precoUSD({ e: 10 }) - 11) < 1e-9, "sem US$, o do Cardmarket com a margem");
  assert.equal(precoUSD(null), 0);
});

// Até 2026-10-13 a carta só com Cardmarket saía como "US$" (o euro × 1,1) no
// texto e como USD no JSON-LD: um preço que não existe em mercado nenhum.
test("preço só do Cardmarket sai em euro, sem conversão", () => {
  assert.deepEqual(precoDeReferencia({ u: 10, e: 8 }), { valor: 10, moeda: "USD" });
  assert.deepEqual(precoDeReferencia({ e: 8 }), { valor: 8, moeda: "EUR" });
  assert.equal(precoDeReferencia({}), null);
  assert.equal(precoDeReferencia(null), null);
  const p = pecasDaCarta({ card: cartas[2], jogo, set, cartas, slugs, preco: 1234.5, moeda: "EUR" });
  const [produto] = jsonLds(p);
  assert.equal(produto.offers.priceCurrency, "EUR");
  assert.equal(produto.offers.lowPrice, "1234.50", "o JSON-LD segue com ponto");
  assert.match(p.desc, /Preço de referência: € 1\.234,50\./);
  assert.match(p.corpoHtml, /seo-carta-preco">€ 1\.234,50</);
  assert.doesNotMatch(p.desc + p.corpoHtml, /US\$/);
  // O padrão continua dólar, no formato daqui.
  assert.match(pecas(cartas[2], 120.5).desc, /US\$ 120,50\./);
});

// AdSense "Low value content" (2026-10-10): o detail.js copia este parágrafo
// pra dentro do popup da carta (textoDaCartaNoPopup) e o acha pela classe.
test("o parágrafo da carta leva a classe que o detail.js copia pro popup", () => {
  assert.match(pecas(cartas[0], 1.5).corpoHtml, /<p class="seo-carta-texto">Charmander é uma carta de raridade Common do set 151/);
  assert.equal((pecas(cartas[1]).corpoHtml.match(/seo-carta-texto/g) || []).length, 1, "um parágrafo só, também sem preço nem imagem");
});

// 2026-10-13: o mesmo parágrafo em inglês e espanhol, em <template> (não
// aparece na página nem conta como texto dela), pro popup de quem usa o site
// nesses idiomas; e o nome da carta também no <h2> do bloco (o h1, desde
// 2026-10-13, é o da carta).
test("o parágrafo da carta vem também em en e es, e o nome dela num h2", () => {
  const { corpoHtml } = pecas(cartas[0], 1.5);
  assert.match(corpoHtml, /<template data-texto-carta="en">Charmander is a card from the 151 set of Pokémon TCG, rarity Common, numbered 004\/165[^<]*September 22, 2023[^<]*US market[^<]*<\/template>/);
  assert.match(corpoHtml, /<template data-texto-carta="es">Charmander es una carta del set 151, de Pokémon TCG, de rareza Common[^<]*22 de septiembre de 2023[^<]*<\/template>/);
  assert.match(corpoHtml, /<summary><h2>Sobre esta carta: Charmander 004\/165<\/h2><\/summary>/);
  const hostil = { ...cartas[1], id: "x-2", name: "<b>x</b>" };
  const h = pecasDaCarta({ card: hostil, jogo, set, cartas: [hostil], slugs: slugsDasCartas([hostil]), preco: 0 }).corpoHtml;
  assert.doesNotMatch(h, /<b>x<\/b>/, "o template também sai escapado");
});

// O esqueleto no HTML (2026-11-22): a borda manda a tela da carta com o NOME
// (texto: bloco de fundo não conta como primeira pintura) e, com o host da
// imagem espelhado, a imagem de 300 px, a mesma URL que o popup pede.
test("esqueleto da carta: nome em texto, imagem só com host espelhado, tudo escapado", () => {
  const esp = (u, w) => (/^https:\/\/assets\.tcgdex\.net\//.test(u || "") ? `https://img.sleevu.app/assets.tcgdex.net/x@${w}.webp` : "");
  const com = esqueletoDaCarta(cartas[0], "Charmander 004/165", esp);
  assert.match(com, /^<div class="cs-esqueleto" aria-hidden="true">/, "a classe é a que o CSS que esconde o set poupa");
  assert.match(com, /<p>Charmander 004\/165<\/p>/);
  assert.match(com, /<img src="https:\/\/img\.sleevu\.app\/assets\.tcgdex\.net\/x@300\.webp" fetchpriority="high" alt="" decoding="async">/);
  assert.equal((com.match(/<img /g) || []).length, 1);
  assert.doesNotMatch(com, /<h1/, "o #detailTitle já é o h1");
  // Host fora do espelho (ou carta sem imagem): só o nome, nenhuma <img>.
  const fora = esqueletoDaCarta({ image: "https://cards.scryfall.io/normal/a.jpg" }, "Carta", esp);
  assert.doesNotMatch(fora, /<img/);
  assert.match(fora, /<p>Carta<\/p>/);
  assert.doesNotMatch(esqueletoDaCarta({}, "Sem imagem", esp), /<img/);
  // Nome hostil não vira HTML.
  const hostil = esqueletoDaCarta(cartas[0], "<img src=x onerror=alert(1)>", esp);
  assert.doesNotMatch(hostil, /<img src=x/);
  assert.match(hostil, /&lt;img src=x onerror=alert\(1\)&gt;/);
  // pecasDaCarta devolve o campo, com o nome do h1; sem o carimbo do deploy a
  // lista de hosts é vazia e a borda não monta imagem (a página sai como sempre).
  const p = pecas(cartas[2], 120.5);
  assert.match(p.esqueletoHtml, /<p>Charizard ex 006\/165<\/p>/);
  assert.doesNotMatch(p.esqueletoHtml, /<img/);
});

test("o decoraApp põe o esqueleto no COMEÇO do main e o texto no fim", () => {
  const src = readFileSync(new URL("../functions/_lib/decora-app.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const i = src.indexOf("el.prepend(pecas.esqueletoHtml");
  assert.ok(i > 0, "sumiu o prepend do esqueleto");
  assert.ok(src.indexOf("el.append(pecas.corpoHtml") > i);
});

test("o detail.js não insere um segundo esqueleto quando a borda já mandou o dela", () => {
  const src = readFileSync(new URL("../src/detail.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(src.includes('if (main && !main.querySelector(".cs-esqueleto")) main.insertAdjacentHTML("afterbegin"'));
  // Cópia guardada que chegue pra OUTRA carta (a rota do <meta> não bate): o esqueleto dela sai.
  assert.ok(src.includes('if (main && !rotaDaBorda) main.querySelectorAll(".cs-esqueleto").forEach((el) => el.remove());'));
});

test("outras impressões e vizinhas de número apontam pras páginas certas", () => {
  const { corpoHtml } = pecas(cartas[2]);
  assert.match(corpoHtml, /Outras impressões desta carta[\s\S]*href="\/games\/pokemon\/sv03-5-151\/charizard-ex-006-165-pt">Charizard ex 006\/165 \(Português\)/);
  assert.match(corpoHtml, /Mais cartas de 151[\s\S]*href="\/games\/pokemon\/sv03-5-151\/charmander-004-165"/);
  // A própria carta não aparece nas listas dela.
  assert.doesNotMatch(corpoHtml, /<li><a href="\/games\/pokemon\/sv03-5-151\/charizard-ex-006-165">/);
});

test("nome hostil não fecha o <script> do JSON-LD nem vira HTML", () => {
  const hostil = { ...cartas[1], id: "x-1", name: "</script><img src=x onerror=alert(1)>" };
  // Com preço, pra sair também o Product (o nome vai nos dois blocos).
  const p = pecasDaCarta({ card: hostil, jogo, set, cartas: [hostil], slugs: slugsDasCartas([hostil]), preco: 5 });
  const cabeca = cabecaDaRota(p, { caminho: "/x", set: "151", card: "x-1" });
  assert.doesNotMatch(cabeca + p.corpoHtml, /<img src=x/);
  assert.equal((cabeca.match(/<\/script>/g) || []).length, 2, "um </script> a mais fecharia o bloco antes da hora");
  assert.equal(jsonLds(p)[0].name.startsWith("</script>"), true, "o JSON continua com o nome certo");
});

test("título: o nome da carta nunca é cortado, o nome do set é o primeiro a sair", () => {
  assert.equal(tituloDaCarta("Charizard ex", "006/165", "", "151"), "Charizard ex 006/165 · 151 | Sleevu");
  const longo = tituloDaCarta("Um Nome De Carta Bem Comprido Mesmo", "OP16-119", "OP16", "Um Set Com Nome Enorme Também");
  assert.equal(longo, "Um Nome De Carta Bem Comprido Mesmo OP16-119 OP16 | Sleevu");
});

// Os dados do set pedidos mais cedo (2026-11-22): um preload por arquivo do
// set no <head>, em modo CORS (o fetch do cliente é CORS: sem o crossorigin o
// preload não casa e o arquivo desce duas vezes), no máximo 3, e nenhum
// quando a tela estreita a lista (?setId=/?region=).
test("preload dos arquivos do set: 1, 3 e 5 arquivos, e nenhum quando a tela estreita", () => {
  const preloads = (arquivos, extra = {}) => [...cabecaDaRota({}, { caminho: "/games/pokemon/151", arquivos, ...extra })
    .matchAll(/<link rel="preload" as="fetch" crossorigin href="([^"]*)">/g)].map((m) => m[1]);
  const f = ["data/sets/en/a.json", "data/sets/ja/a.json", "data/sets/pt/a.json", "data/sets/zh-cn/a.json", "data/sets/zh-tw/a.json"];
  assert.deepEqual(preloads(f.slice(0, 1)), ["/data/sets/en/a.json"], "o href é absoluto: é o que o cliente pede com o <base href=\"/\">");
  assert.deepEqual(preloads(f.slice(0, 3)), f.slice(0, 3).map((x) => "/" + x));
  assert.deepEqual(preloads(f), f.slice(0, 3).map((x) => "/" + x), "no máximo 3");
  assert.deepEqual(preloads(f, { estreita: true }), [], "?setId=/?region=: o cliente baixa uma edição só");
  assert.deepEqual(preloads([]), []);
  assert.deepEqual(preloads(undefined), [], "rota sem arquivos (a tela do jogo, o teste antigo) não emite nada");
  assert.match(preloads(['data/sets/"x".json'])[0], /&quot;/, "escapado");
  // O preload vai depois do <meta> da rota, no mesmo acréscimo ao <head>.
  const cabeca = cabecaDaRota({}, { caminho: "/games/x/y", arquivos: f.slice(0, 1) });
  assert.ok(cabeca.indexOf('<meta name="sleevu-rota"') < cabeca.indexOf('<link rel="preload"'));
  // A borda passa o `f` do mapa e a marca de lista estreita, e a resposta
  // estreita não lê nem grava o cache (a chave dele não leva a query).
  const borda = readFileSync(new URL("../functions/games/[[path]].js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(borda.includes("arquivos: entrada.f, estreita }"));
  assert.ok(borda.includes("const estreita = /[?&](setId|region)=/.test(busca);"));
  assert.ok(borda.includes("estreita ? null : await daBorda(chave)") && borda.includes("if (!estreita) guardaNaBorda("));
});

test("o detail.js reaproveita as cartas da tela no preparaEnderecos e pede o mapa com prioridade baixa", () => {
  const src = readFileSync(new URL("../src/detail.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(src.includes("let doSet = detailSetId || detailRegion ? [] : cards.filter((c) => c && c.set === entrada.n && !c.retired);"));
  assert.ok(src.includes("if (!doSet.length) {\n      const listas = await Promise.all((entrada.f || []).map((f) => fetch(f)"), "sem cartas na tela, busca como antes");
  assert.ok(src.includes("fetch(`data/game-pages/${url}.json`, { priority: \"low\" })"));
});

test("a rota no <head>: o caminho, o set e a carta, escapados", () => {
  const cabeca = cabecaDaRota({ alternates: [{ hreflang: "pt-BR", href: "https://sleevu.app/games/x/y" }] },
    { caminho: "/games/x/y/z", game: "pokemon", set: 'Set "A" & <B>', card: "id-1" });
  assert.match(cabeca, /<link rel="alternate" hreflang="pt-BR" href="https:\/\/sleevu\.app\/games\/x\/y">/);
  assert.match(cabeca, /<meta name="sleevu-rota" content="\/games\/x\/y\/z" data-game="pokemon" data-set="Set &quot;A&quot; &amp; &lt;B&gt;" data-card="id-1">/);
  // Sem carta (tela do set): o atributo nem aparece.
  assert.doesNotMatch(cabecaDaRota({}, { caminho: "/games/x/y", set: "Y" }), /data-card/);
});
