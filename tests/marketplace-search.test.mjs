// Testes do texto de busca das lojas internacionais (usSearchText/usMarketplaces
// em src/shared.js). O que está travado aqui: carta VINTAGE (flag `vintage` do
// cards.js) leva o ANO do set no fim da busca — no eBay/PriceCharting os
// anúncios dos Carddass têm o ano no título e "nome + código" sozinho não acha
// nada. Carta atual (Pokémon, One Piece OPCG…) segue sem ano: o código já
// discrimina e o ano só esconderia anúncio sem ele no título.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared } from "./lib/shared-sandbox.mjs";

const api = loadShared("window.__test = { usSearchText, usMarketplaces, vintageSearchYear };").window.__test;

const gon = { id: "hxh-hb-p1-c01", name: "Gon Freecss", number: "C01", setTotal: 42, setReleaseDate: "1999-12-01", vintage: true, game: "hxh" };

test("vintage: o ano do set entra no fim da busca", () => {
  assert.equal(api.vintageSearchYear(gon), "1999");
  assert.equal(api.usSearchText(gon, "hxh"), "hunter x hunter carddass Gon Freecss C01 1999");
});

test("vintage sem data de lançamento: busca fica como era (sem ano)", () => {
  const semData = { ...gon, id: "hxh-mb-hhs01-02", name: "ゴン", number: "02", setTotal: 10, setReleaseDate: "" };
  assert.equal(api.vintageSearchYear(semData), "");
  assert.equal(api.usSearchText(semData, "hxh"), "hunter x hunter carddass ゴン 02/10"); // sem ano, sem mudança: cardCode como sempre
});

test("carta atual (não vintage) NÃO ganha ano, mesmo com data", () => {
  const charizard = { id: "base1-4", name: "Charizard", number: "4", setTotal: 102, setReleaseDate: "1999-01-09", game: "pokemon" };
  assert.equal(api.usSearchText(charizard, "pokemon"), "pokemon Charizard 4/102");
  const luffy = { id: "OP01-001", name: "Monkey.D.Luffy", number: "OP01-001", setReleaseDate: "2022-07-08", game: "onepiece" };
  assert.equal(api.usSearchText(luffy, "onepiece"), "one piece Monkey.D.Luffy OP01-001");
});

test("os links do eBay/PriceCharting levam o ano (e o tag graded vem depois dele)", () => {
  const links = Object.fromEntries(api.usMarketplaces("hxh", "PSA 9").map((m) => [m.key, m.url(gon)]));
  const q = encodeURIComponent("hunter x hunter carddass Gon Freecss C01 1999 PSA 9");
  assert.ok(links.ebay.endsWith(`_nkw=${q}`), links.ebay);
  assert.ok(links.ebaysold.includes(`_nkw=${q}&LH_Sold=1`), links.ebaysold);
  assert.ok(links.pricecharting.endsWith(`q=${q}`), links.pricecharting);
  assert.equal(links.tcgplayer, undefined); // Carddass JP não existe no TCGplayer
});
