// SEO do vintage (2026-11-16): o Sleevu quer ser a referência de busca pra
// carta vintage. O que a página de set e a de carta dizem ao robô, com a carta
// de verdade do Dragon Ball Carddass (o 本弾 特別弾 de 1997):
//   - a data do set vintage, que vem só com o mês ou só com o ano, e sumia;
//   - o ano no título do set vintage;
//   - o nome do jogo no título da carta vintage;
//   - o nome japonês impresso (nameJp) no texto, na descrição e no JSON-LD;
//   - o CreativeWork da carta sem preço.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { pecasDaCarta, tituloDaCarta, dataNaLingua, naData, partesDaData } from "../functions/_lib/pagina-carta.js";
import { pecasDoSet, SET_L10N, nomeDoSetNoTitulo } from "../functions/_lib/pagina-set.js";
import { slugsDasCartas } from "../functions/_lib/slug-carta.js";
import { jogoDaUrl } from "../functions/_lib/jogos.js";

const dbc = jogoDaUrl("dragon-ball-carddass");
const pokemon = jogoDaUrl("pokemon");
const goku = { id: "dbc-h31-1", name: "Goku", nameJp: "孫悟空", set: "本弾 特別弾", setId: "dbc-h31", number: "1", setTotal: 81,
  setReleaseDate: "1997-09", rarity: "Normal", artist: "", language: "ja", variants: ["Normal"], vintage: true,
  image: "https://wsrv.nl/?url=www.dbzcollection.fr%2F2v2%2Fcartes%2F137%2F104%2Fh3000_5017_carte.jpg&w=440&output=webp" };
const cartas = [goku, { ...goku, id: "dbc-h31-2", number: "2", nameJp: "孫悟空" }];
const slugs = slugsDasCartas(cartas);
const set = { slug: "dbc-h31", nome: "本弾 特別弾" };

test("data do set: dia, só o mês ou só o ano, nas três línguas, com a preposição certa", () => {
  assert.deepEqual(partesDaData("1997-09"), { ano: "1997", mes: 9, dia: 0 });
  assert.deepEqual(partesDaData("1999"), { ano: "1999", mes: 0, dia: 0 });
  assert.equal(partesDaData("abc"), null);
  const tudo = (iso) => ["pt", "en", "es"].map((l) => naData(dataNaLingua(iso, l), l));
  assert.deepEqual(tudo("2024-11-08"), ["em 8 de novembro de 2024", "on November 8, 2024", "el 8 de noviembre de 2024"]);
  assert.deepEqual(tudo("1997-09"), ["em setembro de 1997", "in September 1997", "en septiembre de 1997"]);
  assert.deepEqual(tudo("1999"), ["em 1999", "in 1999", "en 1999"]);
  assert.deepEqual(tudo(""), ["", "", ""]);
  // A variante -en do set (prerender) e a pt (borda) usam a mesma régua.
  assert.equal(SET_L10N.en.fmtDate("1997-09"), "September 1997");
  assert.match(SET_L10N.en.desc(81, "X", "Dragon Ball Carddass", "September 1997"), /, released in September 1997\./);
  assert.match(SET_L10N.en.desc(81, "X", "Pokémon TCG", "November 8, 2024"), /, released on November 8, 2024\./);
});

test("set vintage: o ano no título e a data na descrição; o moderno, como antes", () => {
  const p = pecasDoSet({ jogo: dbc, slug: "dbc-h31", nome: "本弾 特別弾", cartas, slugs });
  assert.equal(p.titulo, "本弾 特別弾 (1997) — lista de cartas de Dragon Ball Carddass | Sleevu");
  assert.equal(p.h1, "本弾 特別弾", "o h1 segue com o nome puro");
  assert.match(p.desc, /, lançado em setembro de 1997\./);
  // Nome que já traz o ano não ganha outro; jogo moderno não ganha ano.
  assert.equal(nomeDoSetNoTitulo("Part 1 (1991)", { setReleaseDate: "1991-07" }, dbc), "Part 1 (1991)");
  assert.equal(nomeDoSetNoTitulo("151", { setReleaseDate: "2023-09-22" }, pokemon), "151");
});

test("carta vintage: o jogo no título, o nome japonês no texto e na descrição", () => {
  const p = pecasDaCarta({ card: goku, jogo: dbc, set, cartas, slugs, preco: 0 });
  assert.equal(p.titulo, "Goku 1/81 · 本弾 特別弾 · Dragon Ball Carddass | Sleevu");
  assert.equal(p.h1, "Goku 1/81");
  assert.match(p.desc, /^Goku \(孫悟空\) 1\/81/);
  assert.match(p.corpoHtml, /Goku \(孫悟空\) é uma carta de raridade Normal da edição japonesa/);
  assert.match(p.corpoHtml, /O set 本弾 特別弾 foi lançado em setembro de 1997 e reúne 81 cartas\./);
  assert.match(p.corpoHtml, /The 本弾 特別弾 set was released in September 1997 and has 81 cards\./);
  assert.match(p.corpoHtml, /El set 本弾 特別弾 salió en septiembre de 1997 y reúne 81 cartas\./);
  assert.match(p.corpoHtml, /<dt>Lançamento do set<\/dt><dd>setembro de 1997<\/dd>/);
});

test("título da carta: o jogo só no vintage; quando não cabe tudo, fica o set, senão o jogo; não repete", () => {
  // Moderno: sem o jogo, como sempre.
  assert.equal(tituloDaCarta("Charizard ex", "006/165", "", "151"), "Charizard ex 006/165 · 151 | Sleevu");
  // Set que já diz o jogo não o repete.
  assert.equal(tituloDaCarta("Goku", "1/81", "", "Dragon Ball Carddass Part 1", "Dragon Ball Carddass"), "Goku 1/81 · Dragon Ball Carddass Part 1 | Sleevu");
  // Set + jogo não cabe, o set sozinho cabe: fica o set.
  assert.equal(tituloDaCarta("Harry Potter", "12/80", "", "Chamber of Secrets", "Harry Potter Trading Card Game"),
    "Harry Potter 12/80 · Chamber of Secrets | Sleevu");
  // Nem o set cabe: fica o jogo, que é mais curto.
  assert.equal(tituloDaCarta("Um Nome Bem Comprido", "12/140", "", "Um Set De Nome Muito Comprido", "Harry Potter TCG"),
    "Um Nome Bem Comprido 12/140 · Harry Potter TCG | Sleevu");
  assert.ok(tituloDaCarta("Goku", "1/81", "", "本弾 特別弾", "Dragon Ball Carddass").length <= 65);
});

test("carta sem preço: CreativeWork com os outros nomes, a data, a edição, o set e o jogo", () => {
  const p = pecasDaCarta({ card: { ...goku, artist: "Akira Toriyama" }, jogo: dbc, set, cartas, slugs, preco: 0 });
  const [obra, trilha] = p.jsonLds;
  assert.equal(obra["@type"], "CreativeWork");
  assert.equal(trilha["@type"], "BreadcrumbList");
  assert.equal(obra.name, "Goku 1/81 — 本弾 特別弾");
  assert.deepEqual(obra.alternateName, ["孫悟空"]);
  assert.equal(obra.datePublished, "1997-09");
  assert.equal(obra.inLanguage, "ja");
  assert.equal(obra.identifier, "1/81");
  assert.deepEqual(obra.creator, { "@type": "Person", name: "Akira Toriyama" });
  assert.equal(obra.isPartOf.url, "https://sleevu.app/games/dragon-ball-carddass/dbc-h31");
  assert.deepEqual(obra.isPartOf.isPartOf, { "@type": "Game", name: "Dragon Ball Carddass", url: "https://sleevu.app/games/dragon-ball-carddass" });
  assert.equal(obra.url, p.canonical);
  // Com preço, o Product (e não o CreativeWork) é o bloco da carta.
  const comPreco = pecasDaCarta({ card: goku, jogo: dbc, set, cartas, slugs, preco: 12 });
  assert.deepEqual(comPreco.jsonLds.map((o) => o["@type"]), ["Product", "BreadcrumbList"]);
});

// O h1 da tela de cada jogo (2026-11-16): o nome do jogo é TEXTO no h1, não
// mais um ::before do CSS (que pro robô deixava o h1 de /games/<jogo> em
// "Sets"). A borda preenche o .h1-jogo; o shared.js preenche nas outras telas;
// as vistas de série e de linha (app.js) trocam só o .h1-titulo.
test("h1 das telas de explorar: nome do jogo em texto, título traduzível à parte", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["sets.html", "pokedex.html", "lore.html", "artists.html", "trainers.html", "cards.html"]) {
    const html = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.match(html, /<h1><span class="h1-jogo" hidden><\/span> <span class="h1-titulo" data-i18n="[a-zA-Z.]+">[^<]+<\/span><\/h1>/, f);
  }
  const borda = readFileSync(new URL("../functions/games/[[path]].js", import.meta.url), "utf8");
  assert.match(borda, /\.on\("\.page-head h1 \.h1-jogo", \{ element\(el\) \{ el\.setInnerContent\(jogo\.nome\); el\.removeAttribute\("hidden"\); \} \}\)/);
  assert.doesNotMatch(borda, /\.on\("\.page-head h1", atributo\("data-game"/, "o data-game no h1 desenharia o nome duas vezes");
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.equal((app.match(/const titulo = h1\.querySelector\("\.h1-titulo"\) \|\| h1;/g) || []).length, 2, "série e linha trocam só o título");
});
