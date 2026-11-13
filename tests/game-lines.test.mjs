// Testes do escopo por LINHA de jogo (GAME_LINES/lineScope/lineParamOf em
// src/shared.js). O que está travado aqui nasceu em 2026-09-30, quando o
// Formation e o Cross deixaram de ser linhas próprias e viraram seções da
// linha Data Carddass (nrt-dc) do Naruto:
//
// - uma linha pode ter VÁRIOS prefixos de setId (as cartas não trocam de id);
// - o jogo principal continua EXCLUINDO todos eles (senão o Data Carddass
//   vazava pra página do Naruto Card Game 2002~2006);
// - o ?line= antigo (nrt-nf/nrt-nx) abre a linha nova, em vez de cair no jogo
//   principal sem aviso;
// - todo link ?line= do hub aponta pra uma linha que existe de verdade.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadShared } from "./lib/shared-sandbox.mjs";

const loc = (search) => ({ pathname: "/sets", search, hash: "", origin: "http://x", hostname: "localhost", href: `http://x/sets${search}` });
const sharedCom = (search = "") => loadShared("", { location: loc(search) }).window.TCGShared;
const { lineScope } = sharedCom();

test("Data Carddass: a linha nrt-dc cobre os quatro títulos do arcade", () => {
  const dc = lineScope("naruto", "nrt-dc");
  assert.equal(dc.line, "nrt-dc");
  for (const setId of ["nrt-dc-s01", "nrt-dc-s10", "nrt-dc-s11", "nrt-dc-s16", "nrt-nf-s01", "nrt-nf-s26", "nrt-nx-s14", "nrt-nx-s25"]) {
    assert.ok(dc.includes(setId), `${setId} devia estar na linha nrt-dc`);
  }
  for (const setId of ["nrt-s01", "nrt-promo", "nrt-ccg-s01", "nrt-ncg-promo"]) {
    assert.ok(!dc.includes(setId), `${setId} não é Data Carddass`);
  }
});

test("jogo principal do Naruto exclui TODOS os prefixos das linhas", () => {
  const principal = lineScope("naruto", "");
  assert.equal(principal.def, null);
  for (const setId of ["nrt-s01", "nrt-s17", "nrt-promo", "nrt-extra"]) {
    assert.ok(principal.includes(setId), `${setId} é do Card Game 2002~2006`);
  }
  for (const setId of ["nrt-dc-s01", "nrt-nf-s01", "nrt-nx-s14", "nrt-ccg-s01", "nrt-scg-s01", "nrt-scg-promo", "nrt-tc-ecc1", "nrt-tc-ntz1"]) {
    assert.ok(!principal.includes(setId), `${setId} tem página própria (?line=)`);
  }
});

// O NARUTO CARD GAME de 2027 foi a linha nrt-ncg até 11/11/2026 e virou o jogo
// narutocg: o ?line= antigo não é mais linha do naruto, e o game.js o leva pro
// jogo novo (LINHA_VIROU_JOGO).
test("nrt-ncg não é mais linha do naruto: virou o jogo narutocg", () => {
  assert.equal(lineScope("naruto", "nrt-ncg").line, null);
  const gameJs = readFileSync(new URL("../src/game.js", import.meta.url), "utf8");
  assert.match(gameJs, /var LINHA_VIROU_JOGO = \{[^}]*"nrt-ncg": "narutocg"/);
  assert.match(gameJs, /\["naruto-card-game", "narutocg"\]/);
});

// O 疾風伝 カードゲーム (2007–2008, 2026-11-04) é outro jogo, não um volume a
// mais do de 2002: o setId nrt-scg-s01 começa com "nrt-s" como os volumes de
// 2002 (nrt-s01), e o escopo não pode confundir os dois.
test("linha nrt-scg: só o 疾風伝 Card Game, e os volumes de 2002 ficam fora", () => {
  const scg = lineScope("naruto", "nrt-scg");
  assert.equal(scg.line, "nrt-scg");
  for (const setId of ["nrt-scg-s01", "nrt-scg-st1", "nrt-scg-gaku", "nrt-scg-promo"]) assert.ok(scg.includes(setId), setId);
  for (const setId of ["nrt-s01", "nrt-promo", "nrt-ccg-s01", "nrt-dc-s11"]) assert.ok(!scg.includes(setId), setId);
  assert.equal(sharedCom("?game=naruto&line=nrt-scg").lineParamOf(), "nrt-scg");
});

test("?line= antigo do Formation e do Cross abre a linha Data Carddass", () => {
  assert.equal(sharedCom("?game=naruto&line=nrt-nf").lineParamOf(), "nrt-dc");
  assert.equal(sharedCom("?game=naruto&line=nrt-nx").lineParamOf(), "nrt-dc");
  assert.equal(sharedCom("?game=naruto&line=nrt-ccg").lineParamOf(), "nrt-ccg");
  assert.equal(sharedCom("?game=naruto").lineParamOf(), "");
  // As páginas passam o valor JÁ resolvido pro lineScope (app.js e cards.js
  // leem a linha pelo lineParamOf) — e ele abre o arcade inteiro.
  const aberto = lineScope("naruto", sharedCom("?game=naruto&line=nrt-nx").lineParamOf());
  assert.equal(aberto.line, "nrt-dc");
  assert.ok(aberto.includes("nrt-nx-s18") && aberto.includes("nrt-dc-s01"));
});

test("chave de protótipo no ?line= não vira linha", () => {
  for (const line of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    const escopo = lineScope("naruto", line);
    assert.equal(escopo.def, null, `?line=${line} virou linha`);
    assert.ok(escopo.includes("nrt-s01"), `?line=${line} devia cair no jogo principal`);
  }
});

test("Gundam Carddass é jogo (gcd), não linha: o gundam não tem linhas", () => {
  assert.equal(lineScope("gundam", "gcd").line, null);
  assert.ok(lineScope("gundam", "").includes("GD01"));
  assert.ok(lineScope("gcd", "").includes("gcd-wd01"));
});

test("linhas de prefixo único e jogos sem linha seguem iguais", () => {
  const opcd = lineScope("onepiece", "opcd");
  assert.ok(opcd.includes("opcd-01"));
  assert.ok(!opcd.includes("op2002-01"));
  // O Miracle Battle deixou de ser linha (virou o jogo mbc, 2026-10-01): o HxH
  // não tem linha nenhuma, e ?line=hxh-mb solto não filtra nada.
  assert.equal(lineScope("hxh", "hxh-mb").line, null);
  assert.ok(lineScope("mbc", "").includes("hxh-mb-hh01"));
  // Pokémon não tem linhas: tudo passa, com ou sem ?line=.
  assert.ok(lineScope("pokemon", "nrt-dc").includes("sv08"));
  assert.ok(lineScope("pokemon", "").includes("base1"));
});

// Desde 2026-09-30 o tile leva pro endereço do jogo (/games/<url>), e a linha
// sai do registro de endereços (functions/_lib/jogos.js).
// Desde 2026-11-12 as linhas vintage moram no vintage.html (uma .vt-linha por
// jogo); o hub.html ficou com os jogos em atividade.
test("todo tile de linha (hub e Vintage) aponta pra uma linha registrada (e não pra um apelido)", async () => {
  const { jogoDaUrl } = await import("../functions/_lib/jogos.js");
  const hub = readFileSync(new URL("../hub.html", import.meta.url), "utf8") + readFileSync(new URL("../vintage.html", import.meta.url), "utf8");
  const tiles = [...hub.matchAll(/<a class="(?:hub-tile|vt-linha)" href="\/games\/([a-z0-9-]+)" data-game="([a-z]+)">/g)];
  const linhas = tiles.map(([, url, game]) => ({ url, game, jogo: jogoDaUrl(url) })).filter((t) => t.jogo && t.jogo.linha);
  assert.ok(linhas.length >= 5, `achei só ${linhas.length} tiles de linha no hub — o regex quebrou?`);
  for (const { url, game, jogo } of linhas) {
    assert.equal(jogo.game, game, `hub: /games/${url} é de ${jogo.game}, o tile diz ${game}`);
    assert.equal(lineScope(game, jogo.linha).line, jogo.linha, `hub: /games/${url} leva à linha ${jogo.linha}, que não é registrada`);
  }
  assert.ok(!linhas.some(({ jogo }) => jogo.linha === "nrt-nf" || jogo.linha === "nrt-nx"), "Formation/Cross voltaram a ter tile próprio");
});
