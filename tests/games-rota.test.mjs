// Rotas da árvore /games e os 301 dos endereços antigos (2026-09-30). O
// encanamento da borda (HTMLRewriter, env.ASSETS, caches) não roda em node; o
// que tem regra de verdade é exportado e testado aqui:
//   - o que cada endereço é (tela do jogo, tela do set, carta, 301, 404);
//   - o destino de /sets?game=, /set/<slug> e /card/<slug>;
//   - o título, a descrição e o índice da tela do jogo e da tela do set;
//   - o build que a borda lê da casca carimbada pelo deploy.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideRota, listaDeSets, metaDoJogo, buildDaCasca } from "../functions/games/[[path]].js";
import { pecasDoSet } from "../functions/_lib/pagina-set.js";
import { cabecaDaRota } from "../functions/_lib/decora-app.js";
import { slugsDasCartas } from "../functions/_lib/slug-carta.js";
import { destinoDoSets } from "../functions/sets.js";
import { destinoDoSetAntigo } from "../functions/set/[slug].js";
import { destinoDaCartaAntiga, arquivoDaCartaAntiga } from "../functions/card/[slug].js";
import { setRenomeado, fatiaDoLegado } from "../functions/_lib/borda.js";
import { jogoDaUrl } from "../functions/_lib/jogos.js";

const rota = (caminho, pathname) => decideRota(caminho, pathname || `/games/${[].concat(caminho).join("/")}`);

test("/games é estática; /games/<jogo> é a tela do jogo; /games/<jogo>/<set> é a tela do set", () => {
  assert.deepEqual(rota([], "/games"), { tipo: "estatica" });
  assert.deepEqual(rota(undefined, "/games/"), { tipo: "estatica" });
  const jogo = rota(["star-wars-unlimited"]);
  assert.equal(jogo.tipo, "jogo");
  assert.equal(jogo.jogo.game, "swu");
  const set = rota(["pokemon", "base-set"]);
  assert.equal(set.tipo, "set");
  assert.equal(set.set, "base-set");
  assert.equal(set.jogo.game, "pokemon");
  // A variante -en também chega como "set": quem decide entre a página
  // estática em inglês e a tela do app é o mapa do jogo (um set cujo nome
  // termine em "-en" não pode virar a variante de outro).
  assert.equal(rota(["pokemon", "base-set-en"]).tipo, "set");
});

test("carta e link de compartilhar", () => {
  const c = rota(["pokemon", "base-set", "charizard-4-102"]);
  assert.equal(c.tipo, "carta");
  assert.equal(c.set, "base-set");
  assert.equal(c.carta, "charizard-4-102");
  const id = rota(["naruto-card-game-2002", "_id", "nrt-S-001"]);
  assert.equal(id.tipo, "id");
  assert.equal(id.id, "nrt-S-001"); // o id fica como é (tem maiúscula)
});

test("apelido, maiúscula, barra no fim e .html viram 301 pro endereço oficial", () => {
  assert.deepEqual(rota(["swu"]), { tipo: "redirect", destino: "/games/star-wars-unlimited" });
  assert.deepEqual(rota(["nrt-dc", "algum-set"]), { tipo: "redirect", destino: "/games/naruto-data-carddass/algum-set" });
  assert.deepEqual(rota(["Pokemon", "Base-Set"]), { tipo: "redirect", destino: "/games/pokemon/base-set" });
  assert.deepEqual(rota(["pokemon"], "/games/pokemon/"), { tipo: "redirect", destino: "/games/pokemon" });
  assert.deepEqual(rota(["pokemon", "base-set.html"]), { tipo: "redirect", destino: "/games/pokemon/base-set" });
});

test("o resto é 404, inclusive a casca da carta", () => {
  for (const c of [["nao-existe"], ["card-template"], ["card-template.html"], ["pokemon", "a", "b", "c"], ["pokemon", "set com espaço"], ["pokemon", "_id", "id/../x"], ["constructor"], ["__proto__"]]) {
    assert.equal(rota(c).tipo, "404", JSON.stringify(c));
  }
});

test("/sets?game= vai pro endereço do jogo, com a linha e o resto da query", () => {
  assert.equal(destinoDoSets("https://sleevu.app/sets?game=swu"), "/games/star-wars-unlimited");
  assert.equal(destinoDoSets("https://sleevu.app/sets?game=onepiece&line=opcd"), "/games/one-piece-carddass");
  assert.equal(destinoDoSets("https://sleevu.app/sets?game=naruto&line=nrt-nf"), "/games/naruto-data-carddass");
  assert.equal(destinoDoSets("https://sleevu.app/sets?game=pokemon&serie=sv"), "/games/pokemon?serie=sv");
  // Sem jogo, jogo que não existe ou "hub": a tela segue em /sets (sessão).
  assert.equal(destinoDoSets("https://sleevu.app/sets"), null);
  assert.equal(destinoDoSets("https://sleevu.app/sets?game=hub"), null);
  assert.equal(destinoDoSets("https://sleevu.app/sets?game=constructor"), null);
});

test("/set/<slug> antigo acha o endereço novo, inclusive a variante em inglês", () => {
  const mapa = { "base-set": "pokemon/base-set", "unleashed-2": "riftbound/unleashed" };
  assert.equal(destinoDoSetAntigo(mapa, "base-set"), "/games/pokemon/base-set");
  assert.equal(destinoDoSetAntigo(mapa, "base-set-en"), "/games/pokemon/base-set-en");
  assert.equal(destinoDoSetAntigo(mapa, "unleashed-2"), "/games/riftbound/unleashed");
  assert.equal(destinoDoSetAntigo(mapa, "BASE-SET.html"), "/games/pokemon/base-set");
  assert.equal(destinoDoSetAntigo(mapa, "nao-existe"), null);
  assert.equal(destinoDoSetAntigo(mapa, "constructor"), null);
  assert.equal(destinoDoSetAntigo(null, "base-set"), null);
});

// Os Starter Decks do One Piece mudaram de nome no TCGCSV em 30/09/2026 ("ST-11
// Starter Deck 11: Uta") e o /set/ antigo deles dava 404 (68 endereços do
// sitemap de julho, com as -en): o mapa sai do nome de hoje.
test("/set/<slug> antigo de set renomeado: prefixo novo e os que mudaram no meio", () => {
  const mapa = {
    "st-11-starter-deck-11-uta": "one-piece-card-game/st-11-starter-deck-11-uta",
    "st-21-starter-deck-21-ex-gear-5": "one-piece-card-game/st-21-starter-deck-21-ex-gear-5",
    "st-01-starter-deck-1-straw-hat-crew": "one-piece-card-game/st-01-starter-deck-1-straw-hat-crew",
    "st-01-starter-deck-1-straw-hat-crew-super-pre-release-edition": "one-piece-card-game/st-01-starter-deck-1-straw-hat-crew-super-pre-release-edition"
  };
  assert.equal(destinoDoSetAntigo(mapa, "starter-deck-11-uta"), "/games/one-piece-card-game/st-11-starter-deck-11-uta");
  assert.equal(destinoDoSetAntigo(mapa, "starter-deck-11-uta-en"), "/games/one-piece-card-game/st-11-starter-deck-11-uta-en");
  assert.equal(destinoDoSetAntigo(mapa, "starter-deck-ex-gear-5"), "/games/one-piece-card-game/st-21-starter-deck-21-ex-gear-5");
  assert.equal(destinoDoSetAntigo(mapa, "starter-deck-1-straw-hat-crew"), "/games/one-piece-card-game/st-01-starter-deck-1-straw-hat-crew");
  assert.equal(destinoDoSetAntigo(mapa, "super-pre-release-starter-deck-1-straw-hat-crew-en"),
    "/games/one-piece-card-game/st-01-starter-deck-1-straw-hat-crew-super-pre-release-edition-en");
  assert.equal(destinoDoSetAntigo(mapa, "starter-deck-99-ninguem"), null);
});

test("set renomeado: o endereço antigo é o fim do novo, com um candidato só", () => {
  const chaves = ["st-11-starter-deck-11-uta", "black-star-promos", "xy-black-star-promos", "base-set"];
  assert.equal(setRenomeado(chaves, "starter-deck-11-uta"), "st-11-starter-deck-11-uta");
  // Dois candidatos: não chuta.
  assert.equal(setRenomeado(chaves, "star-promos"), null);
  // Pedaço curto ou sem hífen não casa com nada.
  assert.equal(setRenomeado(chaves, "promos"), null);
  assert.equal(setRenomeado(chaves, "set"), null);
  // A própria chave não é renomeação dela mesma (quem chama já olhou o mapa).
  assert.equal(setRenomeado(chaves, "base-set"), null);
  assert.equal(setRenomeado(null, "starter-deck-11-uta"), null);
});

// O link que o "compartilhar" do app gera passa por /games/<jogo>/_id/<id> com
// o nome do set na query. Se o parâmetro cair num Disallow do robots.txt (o
// ?set= do filtro do Explorar cairia), o robô do X não lê a página e o link
// sai sem prévia; o Google também não segue o 301 até a carta.
test("o link de compartilhar do app não cai num Disallow do robots.txt", () => {
  const ler = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const m = /\/_id\/\$\{[^}]+\}\?([A-Za-z_]+)=/.exec(ler("src/shared.js"));
  assert.ok(m, "o link de compartilhar some do shared.js? ajuste este teste");
  const exemplo = `/games/pokemon/_id/base1-4?${m[1]}=Base%20Set`;
  const barrados = ler("robots.txt").split("\n").map((l) => /^Disallow:\s*(\S+)/i.exec(l)).filter(Boolean).map((d) => d[1]);
  assert.ok(barrados.includes("/*?set="), "a regra que motivou o teste segue no robots.txt");
  // Sintaxe do robots: * é qualquer coisa, $ no fim ancora; o resto é literal.
  const paraRegex = (regra) => {
    const ancora = regra.endsWith("$");
    const corpo = (ancora ? regra.slice(0, -1) : regra).split("*")
      .map((p) => p.replace(/[.?+^$()[\]{}|\\]/g, (c) => `\\${c}`)).join(".*");
    return new RegExp(`^${corpo}${ancora ? "$" : ""}`);
  };
  for (const regra of barrados) assert.doesNotMatch(exemplo, paraRegex(regra), `barrado por "Disallow: ${regra}"`);
  // Contraprova: o ?set= antigo cairia.
  assert.match("/games/pokemon/_id/base1-4?set=Base", paraRegex("/*?set="));
});

test("/card/<slug> antigo acha a página nova da carta", () => {
  const mapa = { "charizard-4": "pokemon/base-set/charizard-4-102" };
  assert.equal(destinoDaCartaAntiga(mapa, "charizard-4"), "/games/pokemon/base-set/charizard-4-102");
  assert.equal(destinoDaCartaAntiga(mapa, "Charizard-4.html"), "/games/pokemon/base-set/charizard-4-102");
  assert.equal(destinoDaCartaAntiga(mapa, "toString"), null);
  assert.equal(destinoDaCartaAntiga(mapa, "sumiu-1"), null);
});

// O mapa das cartas antigas é fatiado pela 1ª letra: o prerender escreve e a
// borda lê com a mesma régua (fatiaDoLegado), senão o 301 procura no arquivo
// errado e dá 404 sem erro nenhum.
test("/card/<slug> antigo: a borda lê a fatia que o prerender escreveu", () => {
  assert.equal(arquivoDaCartaAntiga("charizard-4"), `/data/game-pages/legado-cartas/${fatiaDoLegado("charizard-4")}.json`);
  assert.equal(arquivoDaCartaAntiga("Charizard-4.html"), "/data/game-pages/legado-cartas/c.json");
  assert.equal(arquivoDaCartaAntiga("151-pikachu"), "/data/game-pages/legado-cartas/1.json");
  assert.equal(arquivoDaCartaAntiga("../x"), null);
  assert.equal(arquivoDaCartaAntiga(""), null);
  const prerender = readFileSync(new URL("../scripts/prerender-catalog.mjs", import.meta.url), "utf8");
  assert.match(prerender, /fatiaDoLegado\(slug\)/, "o prerender fatia o mapa com a mesma régua");
  assert.match(prerender, /"legado-cartas", `\$\{f\}\.json`/, "e grava cada fatia em legado-cartas/<letra>.json");
});

test("tela do jogo: sets mais novos primeiro, título no orçamento, índice com os links", () => {
  const mapa = { s: {
    "spark-of-rebellion": { n: "Spark of Rebellion", c: 252, d: "2024-03-08" },
    "legends-of-the-force": { n: "Legends of the Force", c: 264, d: "2025-07-11" },
    "sem-data": { n: "Sem Data", c: 5, d: "" }
  } };
  const sets = listaDeSets(mapa);
  assert.deepEqual(sets.map((s) => s.slug), ["legends-of-the-force", "spark-of-rebellion", "sem-data"]);
  const jogo = jogoDaUrl("star-wars-unlimited");
  const m = metaDoJogo(jogo, sets);
  assert.equal(m.titulo, "Star Wars: Unlimited — sets e cartas | Sleevu");
  assert.ok(m.titulo.length <= 65);
  assert.equal(m.canonical, "https://sleevu.app/games/star-wars-unlimited");
  assert.match(m.desc, /Todos os 3 sets de Star Wars: Unlimited, de 2024 a 2025/);
  assert.match(m.indiceHtml, /data-indice-jogo="star-wars-unlimited"/);
  assert.match(m.indiceHtml, /<a href="\/games\/star-wars-unlimited\/spark-of-rebellion">Spark of Rebellion<\/a>/);
  // Sem sets (jogo "em breve"): descrição sem número e sem índice.
  const vazio = metaDoJogo(jogoDaUrl("naruto-card-game"), []);
  assert.equal(vazio.indiceHtml, "");
  assert.doesNotMatch(vazio.desc, /Todos os 0/);
  // Nome longo perde a parte descritiva, nunca o nome (a regra de título do
  // site: o que a pessoa digitou não é cortado).
  assert.equal(metaDoJogo({ nome: "X".repeat(60), url: "x" }, []).titulo, `${"X".repeat(60)} | Sleevu`);
});

test("nome de set com HTML sai escapado no índice", () => {
  const m = metaDoJogo(jogoDaUrl("pokemon"), [{ slug: "x", nome: "<img src=x onerror=alert(1)>", cartas: 1, data: "" }]);
  assert.doesNotMatch(m.indiceHtml, /<img src=x/);
  assert.match(m.indiceHtml, /&lt;img src=x/);
});

test("da casca carimbada sai o build (a chave do cache da borda)", () => {
  const casca = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <meta name="sleevu-build" content="84296a7d"></head><body></body></html>`;
  assert.equal(buildDaCasca(casca), "84296a7d");
  assert.equal(buildDaCasca(""), "", "sem casca: sem build (a chave cai em \"dev\")");
});

// A tela do set em /games/<jogo>/<set> (2026-10-01): a tela do app, com o que
// a página estática pt tinha de SEO posto pela borda.
test("tela do set: título, descrição, canonical, hreflang, JSON-LD e índice das cartas", () => {
  const jogo = jogoDaUrl("pokemon");
  const cartas = [
    { id: "base1-10", name: "Mewtwo", number: "10", setTotal: 102, set: "Base Set", setId: "base1", language: "en", setReleaseDate: "1999-01-09", setLogo: "data/set-logos/en/base1.webp" },
    { id: "base1-4", name: "Charizard", number: "4", setTotal: 102, set: "Base Set", setId: "base1", language: "en", setReleaseDate: "1999-01-09" },
    { id: "base1-4-pt", name: "Charizard", number: "4", setTotal: 102, set: "Base Set", setId: "base1", language: "pt" }
  ];
  const p = pecasDoSet({ jogo, slug: "base-set", nome: "Base Set", cartas, slugs: slugsDasCartas(cartas) });
  assert.equal(p.titulo, "Base Set — cartas do set Pokémon TCG | Sleevu");
  assert.equal(p.desc, "Lista completa das 2 cartas do set Base Set de Pokémon TCG, lançado em 9 de janeiro de 1999. Veja imagens, números e raridades e monte sua coleção no Sleevu.");
  assert.equal(p.canonical, "https://sleevu.app/games/pokemon/base-set");
  assert.equal(p.h1, "Base Set");
  assert.equal(p.ogImagem, "https://sleevu.app/data/set-logos/en/base1.webp", "og:image precisa de URL absoluta");
  assert.deepEqual(p.alternates.map((a) => `${a.hreflang} ${a.href}`), [
    "pt-BR https://sleevu.app/games/pokemon/base-set",
    "en https://sleevu.app/games/pokemon/base-set-en",
    "x-default https://sleevu.app/games/pokemon/base-set"
  ]);
  const [colecao, trilha] = [...cabecaDaRota(p, { caminho: "/games/pokemon/base-set" })
    .matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.equal(colecao["@type"], "CollectionPage");
  // Uma carta por número, na língua da página (a PT no lugar da EN), em ordem de número.
  assert.deepEqual(colecao.mainEntity.itemListElement.map((i) => `${i.name} ${i.url}`), [
    "Charizard 4/102 https://sleevu.app/games/pokemon/base-set/charizard-4-102-pt",
    "Mewtwo 10/102 https://sleevu.app/games/pokemon/base-set/mewtwo-10-102"
  ]);
  assert.equal(trilha.itemListElement.length, 3);
  assert.match(p.corpoHtml, /data-indice-set="\/games\/pokemon\/base-set"/);
  assert.match(p.corpoHtml, /<a href="\/games\/pokemon\/base-set\/mewtwo-10-102">Mewtwo<\/a> <small>10\/102<\/small>/);
  // Set sem cartas: sem índice (e sem quebrar).
  assert.equal(pecasDoSet({ jogo, slug: "x", nome: "X", cartas: [], slugs: new Map() }).corpoHtml, "");
});

test("tela do set: nome de set com HTML sai escapado no índice e no <head>", () => {
  const jogo = jogoDaUrl("pokemon");
  const nome = "<img src=x onerror=alert(1)>";
  const cartas = [{ id: "x-1", name: "A", number: "1", set: nome, language: "en" }];
  const p = pecasDoSet({ jogo, slug: "img-src-x", nome, cartas, slugs: slugsDasCartas(cartas) });
  assert.doesNotMatch(p.corpoHtml, /<img src=x/);
  assert.doesNotMatch(cabecaDaRota(p, { caminho: "/games/pokemon/img-src-x", set: nome }), /<img src=x/);
});

// Set gigante (o "The List" do Magic tem 5,6 mil cartas): o JSON-LD no <head>
// leva só as primeiras MAX_ITENS_LD, com o total no numberOfItems; o índice no
// pé da tela (o caminho do robô até cada página de carta) segue completo.
test("set gigante: o ItemList do JSON-LD para no teto, o índice do pé não", async () => {
  const { pecasDoSet: pecas, MAX_ITENS_LD } = await import("../functions/_lib/pagina-set.js");
  const jogo = { url: "magic-the-gathering", nome: "Magic: The Gathering", game: "magic" };
  const cartas = Array.from({ length: MAX_ITENS_LD + 50 }, (_, i) => ({ id: `mtg-plst-${i + 1}`, name: `Carta ${i + 1}`, number: String(i + 1), set: "The List", setId: "plst", language: "en" }));
  const p = pecas({ jogo, slug: "the-list", nome: "The List", cartas, slugs: slugsDasCartas(cartas) });
  const [colecao] = [...cabecaDaRota(p, { caminho: "/games/magic-the-gathering/the-list" })
    .matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.equal(colecao.mainEntity.numberOfItems, MAX_ITENS_LD + 50);
  assert.equal(colecao.mainEntity.itemListElement.length, MAX_ITENS_LD);
  assert.equal((p.corpoHtml.match(/<li>/g) || []).length, MAX_ITENS_LD + 50, "o índice do pé leva todas");
});
