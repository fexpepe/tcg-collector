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
import { loadShared } from "./lib/shared-sandbox.mjs";

const api = loadShared("window.__test = { setDisplayName, setOriginalName, setSerieDisplayName };").window.__test;

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
  assert.equal(api.setDisplayName("op-mb-op01", "ブースターパック1"), "Booster Pack 1");
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
