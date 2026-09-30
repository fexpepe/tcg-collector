// Página da carta montada na borda (functions/_lib/pagina-carta.js,
// 2026-09-30). Função pura: recebe a carta, o set, as vizinhas e os arquivos da
// casca e devolve o HTML. O que se trava aqui:
//   - canonical, trilha e links no endereço /games/…;
//   - o carimbo de build e os arquivos com hash da casca (sem eles o service
//     worker nunca guardaria a página pra offline);
//   - preço e oferta só quando há preço;
//   - o botão pro app abre a carta no set certo;
//   - nome de carta hostil não fecha o <script> do JSON-LD nem vira HTML;
//   - outras impressões e vizinhas de número apontam pras páginas certas.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { paginaDaCarta, precoUSD, tituloDaCarta } from "../functions/_lib/pagina-carta.js";
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
const ASSETS = { build: "84296a7d", js: "/src/theme.0650627e.js", css: "/styles.3217f239.css" };
const monta = (card, preco = 0, extra = {}) => paginaDaCarta({ card, jogo, set, cartas, slugs, preco, assets: ASSETS, ...extra });
const jsonLds = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

test("endereço, trilha e carimbo do build", () => {
  const html = monta(cartas[2], 120.5);
  assert.match(html, /<link rel="canonical" href="https:\/\/sleevu\.app\/games\/pokemon\/sv03-5-151\/charizard-ex-006-165">/);
  assert.match(html, /<meta name="sleevu-build" content="84296a7d">/);
  assert.match(html, /<script src="\/src\/theme\.0650627e\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\/styles\.3217f239\.css">/);
  assert.match(html, /<html lang="pt-BR" data-idioma-fixo>/);
  const [, trilha] = jsonLds(html);
  assert.deepEqual(trilha.itemListElement.map((i) => i.item), [
    "https://sleevu.app/games",
    "https://sleevu.app/games/pokemon",
    "https://sleevu.app/games/pokemon/sv03-5-151",
    "https://sleevu.app/games/pokemon/sv03-5-151/charizard-ex-006-165"
  ]);
  assert.match(html, /<a href="\/games\/pokemon">Sets<\/a>/);
  // Trilha visível com link relativo (no preview do Pages, não pula pra produção).
  assert.match(html, /<nav class="prc-trilha"[^>]*><a href="\/games">Jogos<\/a>/);
  assert.match(html, /Ver o set completo: <a href="\/games\/pokemon\/sv03-5-151">151<\/a>/);
});

test("preço e oferta só quando há preço", () => {
  const [produto] = jsonLds(monta(cartas[2], 120.5));
  assert.equal(produto.offers.lowPrice, "120.50");
  assert.equal(produto.offers.priceCurrency, "USD");
  assert.equal(produto.brand.name, "Pokémon TCG");
  const semPreco = monta(cartas[1], 0);
  assert.equal(jsonLds(semPreco)[0].offers, undefined);
  assert.doesNotMatch(semPreco, /<p class="prc-price">/);
  assert.equal(precoUSD({ u: 10 }), 10);
  assert.ok(Math.abs(precoUSD({ e: 10 }) - 11) < 1e-9, "sem US$, o do Cardmarket com a margem");
  assert.equal(precoUSD(null), 0);
});

test("o botão abre a carta no app, no set e no jogo certos", () => {
  const html = monta(cartas[3]);
  const m = /<a class="prc-cta" href="([^"]+)">/.exec(html);
  const u = new URL(m[1].replace(/&amp;/g, "&"), "https://sleevu.app");
  assert.equal(u.pathname, "/detail");
  assert.equal(u.searchParams.get("type"), "set");
  assert.equal(u.searchParams.get("name"), "151");
  assert.equal(u.searchParams.get("setId"), "sv03.5");
  assert.equal(u.searchParams.get("game"), "pokemon");
  assert.equal(u.searchParams.get("card"), "sv03.5-006-pt");
});

test("outras impressões e vizinhas de número apontam pras páginas certas", () => {
  const html = monta(cartas[2]);
  assert.match(html, /Outras impressões desta carta[\s\S]*href="\/games\/pokemon\/sv03-5-151\/charizard-ex-006-165-pt">Charizard ex 006\/165 \(Português\)/);
  assert.match(html, /Mais cartas de 151[\s\S]*href="\/games\/pokemon\/sv03-5-151\/charmander-004-165"/);
  // A própria carta não aparece nas listas dela.
  assert.doesNotMatch(html, /<li><a href="\/games\/pokemon\/sv03-5-151\/charizard-ex-006-165">/);
});

test("nome hostil não fecha o <script> do JSON-LD nem vira HTML", () => {
  const hostil = { ...cartas[1], id: "x-1", name: "</script><img src=x onerror=alert(1)>" };
  const html = paginaDaCarta({ card: hostil, jogo, set, cartas: [hostil], slugs: slugsDasCartas([hostil]), preco: 0, assets: ASSETS });
  assert.doesNotMatch(html, /<img src=x/);
  assert.equal((html.match(/<\/script>/g) || []).length, 3, "um </script> a mais fecharia o bloco antes da hora");
  assert.equal(jsonLds(html)[0].name.startsWith("</script>"), true, "o JSON continua com o nome certo");
});

test("título: o nome da carta nunca é cortado, o nome do set é o primeiro a sair", () => {
  assert.equal(tituloDaCarta("Charizard ex", "006/165", "", "151"), "Charizard ex 006/165 · 151 | Sleevu");
  const longo = tituloDaCarta("Um Nome De Carta Bem Comprido Mesmo", "OP16-119", "OP16", "Um Set Com Nome Enorme Também");
  assert.equal(longo, "Um Nome De Carta Bem Comprido Mesmo OP16-119 OP16 | Sleevu");
});
