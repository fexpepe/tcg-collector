// Página da carta (functions/_lib/pagina-carta.js). Desde 2026-10-01 o
// endereço da carta é a tela do set do APP com o popup dela aberto, e a borda
// põe nessa tela as peças que saem daqui (título, descrição, canonical, JSON-LD
// e o texto da carta). Função pura: recebe a carta, o set e as vizinhas. O que
// se trava aqui:
//   - canonical e trilha no endereço /games/…;
//   - preço e oferta só quando há preço;
//   - nome de carta hostil não fecha o <script> do JSON-LD nem vira HTML;
//   - outras impressões e vizinhas de número apontam pras páginas certas;
//   - o título não corta o nome da carta.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { pecasDaCarta, precoUSD, tituloDaCarta } from "../functions/_lib/pagina-carta.js";
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
  assert.equal(p.h1, "151", "o h1 da tela é o do set: a carta abre no popup");
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
  const semPreco = pecas(cartas[1], 0);
  assert.equal(jsonLds(semPreco)[0].offers, undefined);
  assert.doesNotMatch(semPreco.corpoHtml, /seo-carta-preco">/);
  assert.equal(precoUSD({ u: 10 }), 10);
  assert.ok(Math.abs(precoUSD({ e: 10 }) - 11) < 1e-9, "sem US$, o do Cardmarket com a margem");
  assert.equal(precoUSD(null), 0);
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
  const p = pecasDaCarta({ card: hostil, jogo, set, cartas: [hostil], slugs: slugsDasCartas([hostil]), preco: 0 });
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

test("a rota no <head>: o caminho, o set e a carta, escapados", () => {
  const cabeca = cabecaDaRota({ alternates: [{ hreflang: "pt-BR", href: "https://sleevu.app/games/x/y" }] },
    { caminho: "/games/x/y/z", game: "pokemon", set: 'Set "A" & <B>', card: "id-1" });
  assert.match(cabeca, /<link rel="alternate" hreflang="pt-BR" href="https:\/\/sleevu\.app\/games\/x\/y">/);
  assert.match(cabeca, /<meta name="sleevu-rota" content="\/games\/x\/y\/z" data-game="pokemon" data-set="Set &quot;A&quot; &amp; &lt;B&gt;" data-card="id-1">/);
  // Sem carta (tela do set): o atributo nem aparece.
  assert.doesNotMatch(cabecaDaRota({}, { caminho: "/games/x/y", set: "Y" }), /data-card/);
});
