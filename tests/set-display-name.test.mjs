// Testes do setDisplayName/setOriginalName/setSerieDisplayName (src/shared.js):
// o nome de EXIBIÇÃO do set. Dois mapas alimentam a mesma função e eles têm
// regras diferentes de casamento — é isso que está travado aqui.
//
// VINTAGE_SET_EN usa ids que só existem no jogo deles (nrt-*, op-mb-*, hxh-mb-*)
// e casa por id, ponto. JA_SET_EN NÃO pode fazer isso: `neo1`..`neo4` são ids
// de verdade tanto no catálogo japonês quanto no INGLÊS (Neo Genesis, Neo
// Discovery…), e uma dúzia de SV é compartilhada com o chinês. Sem o corte por
// idioma, traduzir 金、銀、新世界へ... renomeava o Neo Genesis junto.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import { loadShared } from "./lib/shared-sandbox.mjs";

// As tabelas moram em src/nomes-sets.js desde 2026-10-08 (saíram do núcleo pra
// abrir espaço no orçamento); as páginas que mostram nome de set carregam o
// arquivo junto do shared.js, e os getters leem dele na hora da chamada.
const NOMES = readFileSync(new URL("../src/nomes-sets.js", import.meta.url), "utf8");
const EXPOE = "window.__test = { setDisplayName, setOriginalName, setSerieDisplayName };";
const comNomes = loadShared(EXPOE);
vm.runInContext(NOMES, comNomes);
const api = comNomes.window.__test;

test("neo1: o mesmo id vira nome diferente em ja e em en", () => {
  assert.equal(api.setDisplayName("neo1", "Neo Genesis", "en"), "Neo Genesis");
  assert.equal(api.setDisplayName("neo1", "金、銀、新世界へ...", "ja"), "Gold, Silver, to a New World...");
});

test("id compartilhado com o chinês não é traduzido (o mapa é só do ja)", () => {
  assert.equal(api.setDisplayName("SV9", "對戰搭檔", "zh-tw"), "對戰搭檔");
  assert.equal(api.setDisplayName("SV9", "バトルパートナーズ", "ja"), "Battle Partners");
});

test("vintage (Naruto/One Piece/HxH) casa só por id, sem idioma", () => {
  assert.equal(api.setDisplayName("nrt-s01", "ナルト カードゲーム 巻ノ一"), "Vol. 1");
  // Miracle Battle (jogo mbc desde 2026-10-01): as séries dividem o jogo, então
  // o nome leva a franquia; as séries novas (mb-) também têm nome.
  assert.equal(api.setDisplayName("op-mb-op01", "ブースターパック1"), "One Piece Booster Pack 1");
  assert.equal(api.setDisplayName("mb-db01", "Miracle Battle DB01 — ブースターパック 第1弾"), "Dragon Ball Kai Booster Pack 1");
});

test("sem entrada no mapa, o nome do catálogo passa direto", () => {
  assert.equal(api.setDisplayName("sv08", "Surging Sparks", "en"), "Surging Sparks");
  assert.equal(api.setDisplayName("MBG", "MEGA Starter Set Mega Gengar ex", "ja"), "MEGA Starter Set Mega Gengar ex");
  assert.equal(api.setDisplayName("nao-existe", "", "ja"), "");
});

test("o nome ORIGINAL só aparece quando difere do exibido", () => {
  assert.equal(api.setOriginalName("M1S", "メガシンフォニア", "ja"), "メガシンフォニア");
  assert.equal(api.setOriginalName("neo1", "Neo Genesis", "en"), "");   // en não traduz: nada a mostrar
  assert.equal(api.setOriginalName("sv08", "Surging Sparks", "en"), "");
});

test("série: traduz pelo nome japonês, não pelo id (que também colide)", () => {
  assert.equal(api.setSerieDisplayName("ポケモンカード★neo", "ja"), "Pokémon Card Neo");
  assert.equal(api.setSerieDisplayName("Neo", "en"), "Neo");
  assert.equal(api.setSerieDisplayName("PCG", "ja"), "PCG"); // já vem em latim da TCGdex
  assert.equal(api.setSerieDisplayName("", "ja"), "");
});

test("sem o src/nomes-sets.js (outra página, ou o arquivo não chegou), vale o nome original", () => {
  const semNomes = loadShared(EXPOE).window.__test;
  assert.equal(semNomes.setDisplayName("neo1", "金、銀、新世界へ...", "ja"), "金、銀、新世界へ...");
  assert.equal(semNomes.setDisplayName("nrt-s01", "ナルト カードゲーム 巻ノ一"), "ナルト カードゲーム 巻ノ一");
  assert.equal(semNomes.setOriginalName("M1S", "メガシンフォニア", "ja"), "");
  assert.equal(semNomes.setSerieDisplayName("ポケモンカード★neo", "ja"), "ポケモンカード★neo");
});

test("toda página que mostra nome de set carrega o src/nomes-sets.js antes do shared.js", () => {
  const raiz = new URL("../", import.meta.url);
  const paginas = readdirSync(raiz).filter((f) => f.endsWith(".html"));
  const usam = paginas.filter((f) => /src="src\/(app|detail|collection)\.js"/.test(readFileSync(new URL(f, raiz), "utf8")));
  assert.ok(usam.includes("sets.html") && usam.includes("detail.html") && usam.includes("collection.html"), `páginas: ${usam.join(", ")}`);
  for (const f of usam) {
    const html = readFileSync(new URL(f, raiz), "utf8");
    const nomes = html.indexOf('src="src/nomes-sets.js"');
    assert.ok(nomes > 0, `${f} usa setDisplayName (app/detail/collection.js) mas não carrega src/nomes-sets.js`);
    assert.ok(nomes < html.indexOf('src="src/shared.js"'), `${f}: o src/nomes-sets.js tem de vir antes do shared.js`);
  }
  assert.match(readFileSync(new URL("sw.js", raiz), "utf8"), /"src\/nomes-sets\.js"/, "sw.js sem o src/nomes-sets.js no SHELL_ASSETS (offline a lista volta pro japonês)");
});
