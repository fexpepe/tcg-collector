// Rotas da árvore /games e os 301 dos endereços antigos (2026-09-30). O
// encanamento da borda (HTMLRewriter, env.ASSETS, caches) não roda em node; o
// que tem regra de verdade é exportado e testado aqui:
//   - o que cada endereço é (tela do jogo, set estático, carta, 301, 404);
//   - o destino de /sets?game=, /set/<slug> e /card/<slug>;
//   - o título, a descrição e o índice da tela do jogo;
//   - o que a borda lê da casca carimbada pelo deploy.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideRota, listaDeSets, metaDoJogo, assetsDaCasca } from "../functions/games/[[path]].js";
import { destinoDoSets } from "../functions/sets.js";
import { destinoDoSetAntigo } from "../functions/set/[slug].js";
import { destinoDaCartaAntiga } from "../functions/card/[slug].js";
import { jogoDaUrl } from "../functions/_lib/jogos.js";

const rota = (caminho, pathname) => decideRota(caminho, pathname || `/games/${[].concat(caminho).join("/")}`);

test("/games e /games/<jogo>/<set> são estáticas; /games/<jogo> é a tela do jogo", () => {
  assert.deepEqual(rota([], "/games"), { tipo: "estatica" });
  assert.deepEqual(rota(undefined, "/games/"), { tipo: "estatica" });
  const jogo = rota(["star-wars-unlimited"]);
  assert.equal(jogo.tipo, "jogo");
  assert.equal(jogo.jogo.game, "swu");
  assert.deepEqual(rota(["pokemon", "base-set"]), { tipo: "estatica" });
  assert.deepEqual(rota(["pokemon", "base-set-en"]), { tipo: "estatica" });
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
  assert.equal(destinoDaCartaAntiga(mapa, "toString"), null);
  assert.equal(destinoDaCartaAntiga(mapa, "sumiu-1"), null);
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

test("da casca carimbada saem o build e os arquivos com hash", () => {
  const casca = `<!doctype html><html lang="pt-BR" data-idioma-fixo><head><meta charset="utf-8">
    <meta name="sleevu-build" content="84296a7d">
    <script src="/src/theme.0650627e.js"></script>
    <link rel="stylesheet" href="/styles.3217f239.css"></head><body></body></html>`;
  assert.deepEqual(assetsDaCasca(casca), { build: "84296a7d", js: "/src/theme.0650627e.js", css: "/styles.3217f239.css" });
  // Sem casca (falhou a leitura): a página sai com os nomes sem hash, sem build.
  assert.deepEqual(assetsDaCasca(""), { build: "", js: "/src/theme.js", css: "/styles.css" });
});
