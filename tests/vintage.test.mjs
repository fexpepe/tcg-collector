// Página Vintage (vintage.html + src/vintage.js, 2026-11-12): o acervo dos
// jogos que saíram de linha, em linha do tempo e por marca. Os vintage
// moravam numa seção no pé do hub.html.
//
// A lista da página é HTML escrito à mão (o link não depende do JS, e o
// buscador lê a lista inteira), então o que não pode quebrar calado é ela
// divergir das fontes:
//   1. cada linha é um jogo vintage do registro (functions/_lib/jogos.js), com
//      o nome, o logo e os anos de lá;
//   2. o começo e o fim de cada barra são o `periodo` do "Sobre" do jogo
//      (data/sobre/<endereço>.json), que é a data com fonte;
//   3. a ordem do HTML é a de lançamento (é a que vale sem JS);
//   4. toda marca citada numa linha existe no src/vintage.js, e o jogo "que
//      continua hoje" de cada marca é um jogo em atividade do registro;
//   5. a régua dos anos e a ordenação fazem a conta certa;
//   6. o menu, a tabbar e o hub levam até a página.
//
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import "../src/vintage.js";
import { JOGOS_URL, jogoDaUrl } from "../functions/_lib/jogos.js";
import { AREAS } from "../scripts/lib/css-areas.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
// Normaliza CRLF: a checkout Windows do repo usa core.autocrlf=true.
const ler = (p) => readFileSync(join(RAIZ, p), "utf8").replace(/\r\n/g, "\n");
const V = globalThis.SleevuVintage;
const html = ler("vintage.html");

// As linhas do HTML, na ordem em que estão escritas.
const linhas = html.split('<li class="vt-jogo"').slice(1).map((trecho) => {
  const bloco = trecho.slice(0, trecho.indexOf("</li>"));
  const attr = (nome) => (new RegExp(`${nome}="([^"]*)"`).exec(bloco) || [])[1];
  return {
    inicio: attr("data-inicio"), fim: attr("data-fim"), pais: attr("data-pais"),
    marcas: String(attr("data-marcas") || "").split(/\s+/).filter(Boolean),
    url: (/<a class="vt-linha" href="\/games\/([a-z0-9-]+)" data-game="[a-z]+">/.exec(bloco) || [])[1],
    game: (/data-game="([a-z]+)"/.exec(bloco) || [])[1],
    logo: (/<img class="vt-logo" src="([^"]+)"/.exec(bloco) || [])[1],
    nome: (/<span class="vt-nome">([^<]+)<\/span>/.exec(bloco) || [])[1],
    anos: (/<span class="game-badge vintage vt-anos">([^<]+)<\/span>/.exec(bloco) || [])[1],
    varias: bloco.includes('data-i18n="vt.multi"')
  };
});

test("cada linha da página é um jogo vintage do registro, com o nome, o logo e os anos de lá", () => {
  const vintage = JOGOS_URL.filter((j) => j.vintage);
  assert.ok(linhas.length >= 16, `achei só ${linhas.length} linhas — o recorte do HTML quebrou?`);
  assert.deepEqual(linhas.map((l) => l.url).sort(), vintage.map((j) => j.url).sort(), "vintage do registro sem linha (ou linha sem registro)");
  for (const l of linhas) {
    const j = jogoDaUrl(l.url);
    assert.equal(l.game, j.game, `${l.url}: data-game`);
    assert.equal(l.nome, j.nome, `${l.url}: nome`);
    assert.equal(l.logo, j.logo, `${l.url}: logo`);
    assert.ok(existsSync(join(RAIZ, l.logo)), `${l.url}: o logo ${l.logo} não existe`);
    assert.equal(l.anos, j.vintage, `${l.url}: os anos do selo são o \`vintage\` do registro`);
    assert.ok(["jp", "us"].includes(l.pais), `${l.url}: data-pais ${l.pais} (a página só tem os símbolos vt-jp e vt-us)`);
  }
});

test("o começo e o fim de cada barra são o período do \"Sobre\" do jogo", () => {
  for (const l of linhas) {
    const sobre = JSON.parse(ler(`data/sobre/${l.url}.json`));
    assert.equal(l.inicio, sobre.periodo.inicio, `${l.url}: data-inicio`);
    assert.equal(l.fim, sobre.periodo.fim, `${l.url}: data-fim`);
    // O selo mostra os mesmos anos que a barra cobre.
    const anos = l.anos.split(/[–~]/);
    assert.equal(anos[0], l.inicio.slice(0, 4), `${l.url}: o selo começa em outro ano`);
    assert.equal(anos[anos.length - 1], l.fim.slice(0, 4), `${l.url}: o selo termina em outro ano`);
  }
});

test("a ordem do HTML é a de lançamento (a que vale sem JS)", () => {
  const jogos = linhas.map((l, pos) => ({ url: l.url, nome: l.nome, pos, ini: V.instante(l.inicio, false), end: V.instante(l.fim, true) }));
  assert.deepEqual(V.ordena(jogos, "inicio").map((j) => j.url), linhas.map((l) => l.url));
});

test("toda marca de uma linha existe no vintage.js; jogo de várias marcas leva a etiqueta", () => {
  const usadas = new Set();
  for (const l of linhas) {
    assert.ok(l.marcas.length >= 1, `${l.url}: sem data-marcas`);
    for (const m of l.marcas) {
      assert.ok(Object.prototype.hasOwnProperty.call(V.MARCAS, m), `${l.url}: marca "${m}" fora de MARCAS (src/vintage.js)`);
      usadas.add(m);
    }
    assert.equal(l.varias, l.marcas.length > 1, `${l.url}: a etiqueta "Várias marcas" é de quem tem mais de uma marca`);
  }
  assert.deepEqual(Object.keys(V.MARCAS).filter((m) => !usadas.has(m)), [], "marca sem nenhum jogo na página");
});

test("o jogo que continua hoje é um jogo em atividade do registro", () => {
  const citados = new Set();
  for (const [slug, m] of Object.entries(V.MARCAS)) {
    assert.ok(m.nome, `${slug}: sem nome`);
    if (!m.hoje) continue;
    citados.add(m.hoje);
    const copia = V.HOJE[m.hoje];
    assert.ok(copia, `${slug}: ${m.hoje} não está em HOJE`);
    const j = jogoDaUrl(m.hoje);
    assert.ok(j && !j.vintage && !j.linha, `${slug}: ${m.hoje} não é um jogo em atividade do registro`);
    assert.deepEqual(copia, [j.game, j.nome, j.logo], `${m.hoje}: a cópia do vintage.js saiu do registro`);
  }
  assert.deepEqual(Object.keys(V.HOJE).sort(), [...citados].sort(), "HOJE com jogo que nenhuma marca cita");
});

test("instante: sem mês, o começo é o início do ano e o fim é o fim do ano", () => {
  assert.equal(V.instante("1988", false), 1988);
  assert.equal(V.instante("1997", true), 1998);
  assert.equal(V.instante("1988-11", false), 1988 + 10 / 12);
  assert.equal(V.instante("1997-09", true), 1997 + 9 / 12);
  assert.equal(V.instante("2013-12", true), 2014);
  assert.ok(Number.isNaN(V.instante("", false)));
  assert.ok(Number.isNaN(V.instante("abc", true)));
});

test("escala: a régua começa e termina em ano redondo do passo", () => {
  const j = (inicio, fim) => ({ ini: V.instante(inicio, false), end: V.instante(fim, true) });
  // O acervo inteiro (1988–2014): de 5 em 5 anos.
  assert.deepEqual(V.escala([j("1988", "1997"), j("2009-12", "2014-08")]), { inicio: 1985, fim: 2015, passo: 5, divisoes: 6 });
  // Uma marca (Naruto, 2002–2014): de 2 em 2.
  assert.deepEqual(V.escala([j("2002-12", "2006-09"), j("2009-12", "2014-08")]), { inicio: 2002, fim: 2016, passo: 2, divisoes: 7 });
  // Um jogo curto (Harry Potter, 2001–2002): ano a ano.
  assert.deepEqual(V.escala([j("2001-08", "2002-10")]), { inicio: 2001, fim: 2003, passo: 1, divisoes: 2 });
  assert.equal(V.escala([]), null);
  // Toda barra cabe na régua.
  const todos = linhas.map((l) => j(l.inicio, l.fim));
  const e = V.escala(todos);
  for (const x of todos) assert.ok(x.ini >= e.inicio && x.end <= e.fim);
});

test("ordena: cada ordem do seletor, com empate na ordem do HTML", () => {
  const jogos = [
    { nome: "Beta", pos: 0, ini: 1990, end: 2000 },
    { nome: "alfa", pos: 1, ini: 1995, end: 1996 },
    { nome: "Gama", pos: 2, ini: 1990, end: 2000 }
  ];
  const nomes = (ordem) => V.ordena(jogos, ordem).map((j) => j.nome);
  assert.deepEqual(nomes("inicio"), ["Beta", "Gama", "alfa"]);
  assert.deepEqual(nomes("recente"), ["alfa", "Beta", "Gama"]);
  assert.deepEqual(nomes("fim"), ["Beta", "Gama", "alfa"]);
  assert.deepEqual(nomes("duracao"), ["Beta", "Gama", "alfa"]);
  assert.deepEqual(nomes("nome"), ["alfa", "Beta", "Gama"]);
  assert.deepEqual(nomes("ordem-que-nao-existe"), ["Beta", "alfa", "Gama"]);
  assert.equal(jogos[0].nome, "Beta", "não mexe na lista recebida");
  // Toda opção do <select> é uma ordem que o script conhece.
  const opcoes = [...html.matchAll(/<option value="([a-z]+)" data-i18n="vt\.sort\./g)].map((m) => m[1]);
  assert.deepEqual(opcoes, V.ORDENS);
  const visoes = [...html.matchAll(/data-visao="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(visoes, V.VISOES);
});

test("periodoDe e grupoDe", () => {
  assert.equal(V.periodoDe([{ inicio: "1988-11", fim: "1997-09" }, { inicio: "2000", fim: "2006" }]), "1988–2006");
  assert.equal(V.periodoDe([{ inicio: "2001-08", fim: "2001-12" }]), "2001");
  assert.equal(V.periodoDe([]), "");
  assert.equal(V.grupoDe({ marcas: ["naruto"] }), "naruto");
  assert.equal(V.grupoDe({ marcas: ["naruto", "one-piece"] }), "", "jogo de várias marcas fica no grupo dele");
});

test("a página carrega os textos e o script dela, na ordem, e as duas folhas de CSS", () => {
  const scripts = [...html.matchAll(/<script defer src="src\/([a-z0-9-]+\.js)"><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(scripts, ["i18n.js", "i18n-vintage.js", "shared.js", "vintage.js"]);
  assert.match(html, /data-active-page="vintage"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/sleevu\.app\/vintage">/);
  // Em produção o CSS é repartido por prefixo de classe: a página tem de estar
  // na área do vt- (dela) e na do hub- (a faixa "Em atividade | Vintage").
  for (const nome of ["vintage", "hub"]) {
    const area = AREAS.find((a) => a.nome === nome);
    assert.ok(area && area.paginas.includes("vintage.html"), `vintage.html fora da área "${nome}" do css-areas.mjs`);
  }
  // E o service worker guarda a página, o script e o pacote de textos.
  const sw = ler("sw.js");
  for (const arq of ["vintage.html", "src/vintage.js", "src/i18n-vintage.js"]) assert.ok(sw.includes(`"${arq}"`), `sw.js sem ${arq} no SHELL_ASSETS`);
});

test("os textos da página existem nos três idiomas", () => {
  const janela = {};
  new Function("window", ler("src/i18n-vintage.js"))(janela);
  const M = janela.TCG_MESSAGES;
  const chaves = Object.keys(M.pt);
  assert.deepEqual(Object.keys(M.en).sort(), [...chaves].sort(), "en");
  assert.deepEqual(Object.keys(M.es).sort(), [...chaves].sort(), "es");
  // Toda chave vt.* que o HTML e o script pedem existe (as do plural, com .one/.other).
  const pedidas = new Set([...html.matchAll(/data-i18n(?:-aria|-title)?="((?:vt|title)\.[A-Za-z.]+)"/g)].map((m) => m[1]));
  const fonte = ler("src/vintage.js");
  for (const m of fonte.matchAll(/\bt\("(vt\.[A-Za-z.]+)"/g)) pedidas.add(m[1]);
  for (const m of fonte.matchAll(/\btn\("(vt\.[A-Za-z.]+)"/g)) { pedidas.add(`${m[1]}.one`); pedidas.add(`${m[1]}.other`); }
  for (const k of pedidas) assert.ok(k in M.pt, `chave ${k} pedida e não definida no src/i18n-vintage.js`);
  // E nenhuma sobrando.
  const usadas = new Set(pedidas);
  assert.deepEqual(chaves.filter((k) => !usadas.has(k)), [], "chave definida que a página não usa");
});

test("o menu, a tabbar e o hub levam até a página", () => {
  const shared = ler("src/shared.js");
  assert.match(shared, /<a href="vintage"\$\{vintageActive \? ' class="active"' : ""\}>/, "o item Vintage saiu do menu de cima");
  assert.match(shared, /buildMobileTabbar\(active, exploreActive \|\| vintageActive, collectionActive\)/, "no celular, Vintage acende a aba Jogos");
  const hub = ler("hub.html");
  // A faixa do topo é a mesma nas duas páginas, com a atual marcada.
  const faixa = (pagina) => [...pagina.matchAll(/<a href="(hub|vintage)"( aria-current="page")? data-i18n="hub\.(?:switchActive|vintage)">/g)].map((m) => m[1] + (m[2] ? "*" : ""));
  assert.deepEqual(faixa(hub.slice(0, hub.indexOf('<div class="page-head">'))), ["hub*", "vintage"]);
  assert.deepEqual(faixa(html.slice(0, html.indexOf('<div class="page-head'))), ["hub", "vintage*"]);
  assert.match(hub, /<a class="hub-porta" href="vintage">/, "a porta do Vintage saiu do hub");
  assert.doesNotMatch(hub, /game-badge vintage/, "sobrou tile vintage no hub");
  // A página Vintage é neutra (sem jogo de sessão no link), como o hub.
  assert.match(ler("src/game.js"), /\|hub\|vintage\|/);
});
