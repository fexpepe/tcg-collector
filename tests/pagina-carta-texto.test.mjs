// O texto da página da carta com o que é DELA (2026-11-11).
//
// O relatório de Páginas de 10/11 (docs/SEO.md) tinha 9.626 cartas
// "rastreadas, mas não indexadas": o parágrafo "Sobre esta carta" era quase
// todo frase-molde, e pesavam mais as ~42 mil japonesas e chinesas do
// Pokémon, cuja página não dizia que a carta é japonesa ou chinesa. O que se
// trava aqui:
//   - a edição (japonesa, chinês simplificado/tradicional, português) no
//     parágrafo das três línguas e na descrição;
//   - o nome em inglês junto do japonês/chinês no parágrafo;
//   - o que a carta é no jogo (Pokémon, estágio, tipo, nº da Pokédex;
//     treinador; energia), só no Pokémon, com o catálogo em inglês ou em pt;
//   - carta secreta (número além do total), só no Pokémon;
//   - o mercado da carta: preço, posição no set (só entre as da mesma
//     edição), preço por acabamento e PSA, no lugar da frase-molde;
//   - a ficha em português ("Tipo: Pokémon", "Série: Espada e Escudo (剣と盾)").
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { pecasDaCarta, textoDaCarta, edicaoDaCarta, especieDaCarta, eSecreta, mercadoDaCarta, serieDaCarta } from "../functions/_lib/pagina-carta.js";
import { slugsDasCartas } from "../functions/_lib/slug-carta.js";
import { jogoDaUrl } from "../functions/_lib/jogos.js";

const pokemon = jogoDaUrl("pokemon");
const set = { slug: "spacejuggler", nome: "スペースジャグラー" };
// Uma página de set japonês: o nome em japonês com o inglês em nameEn (como a
// Bulbapedia deixa), a espécie, o estágio e o tipo em inglês, como o catálogo
// guarda as japonesas.
const jp = [
  { id: "S10P-071-ja", name: "オリジンパルキアV", nameEn: "Origin Forme Palkia V", pokemonName: "Palkia", category: "Pokemon", stage: "Basic", types: "Water", dexId: 484,
    number: "071", setTotal: 67, set: "スペースジャグラー", setId: "S10P", language: "ja", rarity: "SR", artist: "Oswaldo KATO",
    setSerieId: "S", setSerieName: "剣と盾", setReleaseDate: "2022-04-08", variants: ["Holo"] },
  { id: "S10P-010-ja", name: "Kricketune", pokemonName: "Kricketune", category: "Pokemon", stage: "Stage1", types: "Grass", dexId: 402,
    number: "010", setTotal: 67, set: "スペースジャグラー", setId: "S10P", language: "ja", setSerieId: "S", setSerieName: "剣と盾" },
  { id: "S10P-060-ja", name: "ネストボール", pokemonName: "ネストボール", category: "Trainer", trainerType: "Item",
    number: "060", setTotal: 67, set: "スペースジャグラー", setId: "S10P", language: "ja" },
  { id: "S10P-067-ja", name: "Basic Water Energy", category: "Energy", energyType: "Normal",
    number: "067", setTotal: 67, set: "スペースジャグラー", setId: "S10P", language: "ja" }
];
const precos = {
  "S10P-071-ja": { u: 86.78, g: { "10": { s: 210, n: 12 }, "9": { s: 95.5, n: 1 } } },
  "S10P-010-ja": { u: 0.3, v: { Normal: 0.3, Reverse: 0.55 } },
  "S10P-060-ja": { u: 1.2 }
};
const precoDe = (c) => precos[c.id] || null;
const slugs = slugsDasCartas(jp);
const pagina = (card, opts = {}) => {
  const p = precoDe(card);
  return pecasDaCarta({ card, jogo: pokemon, set, cartas: jp, slugs, preco: p ? p.u : 0, precoDe, ...opts });
};
const paragrafo = (p) => (/<p class="seo-carta-texto">([^<]*)<\/p>/.exec(p.corpoHtml) || [])[1] || "";
const template = (p, l) => (new RegExp(`<template data-texto-carta="${l}">([^<]*)</template>`).exec(p.corpoHtml) || [])[1] || "";

test("a edição da carta no parágrafo das três línguas e na descrição", () => {
  const p = pagina(jp[0]);
  assert.match(paragrafo(p), /^オリジンパルキアV \(Origin Forme Palkia V\) é uma carta de raridade SR da edição japonesa do set スペースジャグラー \(S10P\)/);
  assert.match(template(p, "en"), /is a card from the Japanese edition of the スペースジャグラー \(S10P\) set of Pokémon TCG/);
  assert.match(template(p, "es"), /es una carta de la edición japonesa del set スペースジャグラー/);
  assert.match(p.desc, /^オリジンパルキアV \(Origin Forme Palkia V\) 071\/067 \(71\/67\) \(S10P\) da edição japonesa do set スペースジャグラー/);
  assert.equal(edicaoDaCarta({ language: "zh-tw" }), "zh-tw");
  assert.equal(edicaoDaCarta({ language: "zh-cn" }), "zh-cn");
  assert.equal(edicaoDaCarta({ language: "en" }), "");
  assert.equal(edicaoDaCarta({}), "");
  const tw = { ...jp[1], id: "x-tw", language: "zh-tw" };
  assert.match(paragrafo(pecasDaCarta({ card: tw, jogo: pokemon, set, cartas: [tw], slugs: slugsDasCartas([tw]) })), /da edição em chinês tradicional do set/);
  // A carta inglesa não ganha edição: é a padrão do catálogo.
  const en = { ...jp[1], id: "x-en", language: "en" };
  assert.match(paragrafo(pecasDaCarta({ card: en, jogo: pokemon, set, cartas: [en], slugs: slugsDasCartas([en]) })), /^Kricketune é uma carta do set/);
});

test("o que a carta é no jogo: Pokémon, treinador e energia, nas três línguas", () => {
  const p = pagina(jp[1]);
  assert.match(paragrafo(p), /É um Pokémon Estágio 1 do tipo Planta, o nº 402 da Pokédex\./);
  assert.match(template(p, "en"), /It is a Stage 1 Grass-type Pokémon, No\. 402 in the Pokédex\./);
  assert.match(template(p, "es"), /Es un Pokémon Fase 1 de tipo Planta, el n\.º 402 de la Pokédex\./);
  assert.match(paragrafo(pagina(jp[2])), /É uma carta de Treinador do tipo Item\./);
  assert.match(template(pagina(jp[2]), "en"), /It is a Trainer card \(Item\)\./);
  assert.match(paragrafo(pagina(jp[3])), /É uma carta de Energia Básica\./);
  assert.match(template(pagina(jp[3]), "en"), /It is a Basic Energy card\./);
  // O catálogo em português (TCGdex pt) dá a mesma frase; dois tipos no plural.
  const pt = { category: "Pokémon", stage: "Básico", types: "Sombrio;Metal", dexId: 6, pokemonName: "Charizard" };
  const e = especieDaCarta(pt, "pokemon");
  assert.deepEqual([e.estagio, e.tipos], ["basic", ["darkness", "metal"]]);
  const f = { nome: "Mega Charizard X ex", nomes: ["Mega Charizard X ex"], acab: [], alt: [], especie: e, setNome: "S", setBit: "S", jogo: "Pokémon TCG" };
  assert.match(textoDaCarta("pt", f), /É um Pokémon Básico dos tipos Sombrio e Metal, o nº 6 da Pokédex\./);
  // O es é o da TCGdex es ("Oscura", "Metálica"), e o VSTAR vira V-ASTRO.
  assert.match(textoDaCarta("es", f), /Es un Pokémon Básico de tipos Oscura y Metálica, el n\.º 6 de la Pokédex\./);
  const vstar = { ...f, especie: especieDaCarta({ category: "Pokemon", stage: "VSTAR", types: "Water", dexId: 9 }, "pokemon") };
  assert.match(textoDaCarta("pt", vstar), /É um Pokémon V-ASTRO do tipo Água/);
  assert.match(textoDaCarta("en", vstar), /It is a VSTAR Water-type Pokémon/);
  // A espécie entre parênteses só quando o nome da carta não a traz.
  assert.match(textoDaCarta("pt", { ...f, nome: "Rocket's Lizardon", nomes: ["Rocket's Lizardon"] }), /o nº 6 da Pokédex \(Charizard\)\./);
  // Estágio interno do catálogo ("exspecial", "Legend2") não vira texto.
  assert.equal(especieDaCarta({ category: "Pokemon", stage: "exspecial", types: "Fire" }, "pokemon").estagio, "");
  // Fora do Pokémon esses campos querem dizer outra coisa: nada de frase.
  assert.equal(especieDaCarta({ category: "Pokemon", types: "Fire" }, "onepiece"), null);
});

test("carta secreta: número além do total, só no Pokémon", () => {
  assert.match(paragrafo(pagina(jp[0])), /O número dela \(071\) passa do total impresso do set \(67\): é uma carta secreta/);
  assert.doesNotMatch(paragrafo(pagina(jp[1])), /secreta/);
  assert.equal(eSecreta({ number: "201", setTotal: 173 }, "pokemon"), true);
  assert.equal(eSecreta({ number: "173", setTotal: 173 }, "pokemon"), false);
  assert.equal(eSecreta({ number: "TG05", setTotal: 30 }, "pokemon"), false);
  assert.equal(eSecreta({ number: "5", setTotal: 0 }, "pokemon"), false, "sem total, não há o que comparar");
  assert.equal(eSecreta({ number: "400", setTotal: 280 }, "magic"), false, "no Magic, número além do total é variante de colecionador");
});

test("o mercado da carta no lugar da frase-molde do preço", () => {
  const top = paragrafo(pagina(jp[0]));
  assert.match(top, /O preço de referência dela é US\$ 86,78, no mercado americano\. É a mais valiosa das 3 cartas do set com preço\./);
  assert.match(top, /Graduada pela PSA, a última venda registrada no eBay foi de US\$ 210,00 na nota 10 \(12 vendas\) e US\$ 95,50 na nota 9 \(1 venda\)\./);
  assert.doesNotMatch(top, /aparece convertido em reais/, "a frase-molde sai quando há os números da carta");
  const meio = pagina(jp[2]);
  assert.match(paragrafo(meio), /Entre as 3 cartas do set com preço, é a 2ª mais valiosa; a primeira é オリジンパルキアV \(Origin Forme Palkia V\) 071\/067 \(US\$ 86,78\)\./);
  assert.match(template(meio, "en"), /Among the 3 cards in the set with a price, it ranks 2nd; the most valuable is .* \(US\$86\.78\)\./);
  assert.match(template(meio, "es"), /Entre las 3 cartas del set con precio, es la 2\.ª más valiosa/);
  // Preço por acabamento: a frase dos acabamentos sem preço não se repete.
  const acab = pagina({ ...jp[1], variants: ["Normal", "Reverse"] });
  assert.match(paragrafo(acab), /Por acabamento: Normal US\$ 0,30 e Reverse Holo US\$ 0,55\./);
  assert.doesNotMatch(paragrafo(acab), /cotados separadamente/);
  // Sem preço, nada de mercado (e nada inventado).
  assert.doesNotMatch(paragrafo(pagina(jp[3])), /preço de referência|mais valiosa|PSA/);
  // Quem chama sem o chunk de preço (precoDe) fica com a frase de antes.
  assert.match(paragrafo(pecasDaCarta({ card: jp[2], jogo: pokemon, set, cartas: jp, slugs, preco: 1.2 })), /O preço de referência é apurado no mercado americano/);
});

test("a posição no set conta só a mesma edição", () => {
  // A impressão em português herda o preço da inglesa (basePricingId): contar
  // as duas seria contar a mesma carta duas vezes.
  const misto = [
    { id: "a-1", name: "A", number: "1", setTotal: 3, set: "S", language: "en" },
    { id: "a-1-pt", name: "A", number: "1", setTotal: 3, set: "S", language: "pt" },
    { id: "a-2", name: "B", number: "2", setTotal: 3, set: "S", language: "en" }
  ];
  const tab = { "a-1": { u: 10 }, "a-2": { u: 2 } };
  const de = (c) => tab[c.id] || tab[c.id.replace(/-pt$/, "")] || null;
  const m = mercadoDaCarta(misto[2], misto, de, (c) => c.name);
  assert.deepEqual([m.posicao, m.comPreco, m.edicaoDoRanking], [2, 2, ""]);
  const p = pecasDaCarta({ card: misto[2], jogo: pokemon, set: { slug: "s", nome: "S" }, cartas: misto, slugs: slugsDasCartas(misto), preco: 2, precoDe: de });
  assert.match(paragrafo(p), /Entre as 2 cartas em inglês do set com preço, é a 2ª mais valiosa; a primeira é A 1\/3 \(US\$ 10,00\)\./);
  assert.equal(mercadoDaCarta(misto[0], misto, null, (c) => c.name), null, "sem tabela de preço, sem mercado");
});

test("a ficha em português: tipo, estágio, tipos e série", () => {
  const { corpoHtml } = pagina(jp[1]);
  assert.match(corpoHtml, /<dt>Tipo<\/dt><dd>Pokémon<\/dd>/);
  assert.match(corpoHtml, /<dt>Estágio<\/dt><dd>Estágio 1<\/dd>/);
  assert.match(corpoHtml, /<dt>Tipos<\/dt><dd>Planta<\/dd>/);
  assert.match(corpoHtml, /<dt>Série<\/dt><dd>Espada e Escudo \(剣と盾\)<\/dd>/);
  assert.match(pagina(jp[2]).corpoHtml, /<dt>Tipo<\/dt><dd>Treinador \(Item\)<\/dd>/);
  assert.match(pagina(jp[3]).corpoHtml, /<dt>Tipo<\/dt><dd>Energia \(Básica\)<\/dd>/);
  assert.equal(serieDaCarta({ setSerieId: "swsh", setSerieName: "Sword & Shield" }), "Espada e Escudo");
  assert.equal(serieDaCarta({ setSerieId: "ADV", setSerieName: "ADV" }), "ADV", "série sem tradução sai como veio");
  // A nota-molde do preço saiu do bloco (o parágrafo diz de onde vem o preço).
  assert.doesNotMatch(corpoHtml, /seo-carta-nota/);
  // Chinês simplificado e tradicional são impressões diferentes.
  const tw = { ...jp[1], id: "y-tw", language: "zh-tw" };
  assert.match(pecasDaCarta({ card: tw, jogo: pokemon, set, cartas: [tw], slugs: slugsDasCartas([tw]) }).corpoHtml, /<dt>Idioma<\/dt><dd>Chinês tradicional<\/dd>/);
});

test("fora do Pokémon o texto não ganha espécie, secreta nem série", () => {
  const op = jogoDaUrl("one-piece-card-game");
  const carta = { id: "OP01-120", name: "Shanks", number: "OP01-120", setTotal: 100, set: "Romance Dawn", setId: "OP01", language: "ja",
    category: "Pokemon", types: "Fire", setSerieId: "m", setSerieName: "Main" };
  const p = pecasDaCarta({ card: carta, jogo: op, set: { slug: "romance-dawn", nome: "Romance Dawn" }, cartas: [carta], slugs: slugsDasCartas([carta]) });
  assert.match(paragrafo(p), /^Shanks é uma carta da edição japonesa do set Romance Dawn/);
  assert.doesNotMatch(paragrafo(p), /Pokémon|secreta|série/);
  assert.match(p.corpoHtml, /<dt>Série<\/dt><dd>Main<\/dd>/, "a série do jogo sai como veio");
});
