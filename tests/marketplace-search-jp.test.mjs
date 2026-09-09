// Testes da busca das lojas BR (brMarketplaces/paddedCardQuery em src/shared.js)
// pra carta JAPONESA. O que está travado aqui: a Liga cataloga a versão JP com
// o nome em INGLÊS e "JP" grudado no número, antes da barra —
// "Snorlax (181JP/165)". Antes ia "カビゴン (181/165)": o kana não casava com
// nada e só o número sobrava, que no 151 em inglês é o Dragonair 181/165.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared } from "./lib/shared-sandbox.mjs";

const api = loadShared("window.__test = { brMarketplaces, paddedCardQuery, cardSearchQuery };").window.__test;

const snorlaxJp = { id: "SV2a-181-ja", name: "カビゴン", pokemonName: "Snorlax", number: "181", setTotal: 165, language: "ja", game: "pokemon" };
const snorlaxEn = { id: "sv3pt5-143", name: "Snorlax", number: "143", setTotal: 165, language: "en", game: "pokemon" };

function links(card) {
  return Object.fromEntries(api.brMarketplaces("pokemon").map((m) => [m.key, decodeURIComponent(m.url(card))]));
}

test("carta JP na Liga: nome em inglês e JP antes da barra", () => {
  assert.equal(api.paddedCardQuery(snorlaxJp, true, "JP"), "Snorlax (181JP/165)");
  assert.ok(links(snorlaxJp).liga.endsWith("card=Snorlax (181JP/165)"), links(snorlaxJp).liga);
});

test("carta JP com número curto: zera à esquerda e mantém o JP colado", () => {
  const pikachu = { ...snorlaxJp, id: "SV2a-025-ja", name: "ピカチュウ", pokemonName: "Pikachu", number: "25" };
  assert.equal(api.paddedCardQuery(pikachu, true, "JP"), "Pikachu (025JP/165)");
});

test("LigaBRA e MYP também vão com o nome em inglês (sem o JP, que é convenção da Liga)", () => {
  const l = links(snorlaxJp);
  assert.ok(l.ligabra.endsWith("/Snorlax (181/165)"), l.ligabra);
  assert.ok(l.myp.endsWith("=Snorlax (181/165)"), l.myp);
  assert.equal(api.cardSearchQuery(snorlaxJp), "Snorlax (181/165)");
});

test("carta em inglês segue como era: sem JP e com o próprio nome", () => {
  const l = links(snorlaxEn);
  assert.ok(l.liga.endsWith("card=Snorlax (143/165)"), l.liga);
  assert.ok(l.myp.endsWith("=Snorlax (143/165)"), l.myp);
  assert.equal(api.paddedCardQuery(snorlaxEn, true), "Snorlax (143/165)");
});

test("carta JP sem pokemonName cai no name (não quebra)", () => {
  const semEn = { ...snorlaxJp, pokemonName: "" };
  assert.equal(api.paddedCardQuery(semEn, true, "JP"), "カビゴン (181JP/165)");
});
