// Testes da busca da LigaPokémon (ligaPokemonQuery em src/shared.js) pras
// cartas dos 30 anos que a Liga cataloga do jeito dela (27/09/2026):
//  • Mew RGB (carta bônus): só o nome, que já traz o código — "Mew - B/RGB".
//    Ia "Mew - B/RGB (B/128)" e a Liga não achava;
//  • Classic Collection (30th-c): número da carta ANTIGA + total do set —
//    "Lugia (149/30)". Ia a numeração sequencial da TCGdex, "Lugia (029/030)".
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadShared } from "./lib/shared-sandbox.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const api = loadShared("window.__test = { brMarketplaces, ligaPokemonQuery, LIGA_CLASSIC_NUMBERS };").window.__test;
const lerJson = (p) => JSON.parse(readFileSync(join(here, "..", p), "utf8"));

function links(card) {
  return Object.fromEntries(api.brMarketplaces("pokemon").map((m) => [m.key, decodeURIComponent(m.url(card))]));
}

const mewB = { id: "30th-B", name: "Mew - B/RGB", pokemonName: "Mew", number: "B", setId: "30th", setTotal: 128, language: "en" };
const lugia = { id: "30th-c-029", name: "Lugia", pokemonName: "Lugia", number: "029", setId: "30th-c", setTotal: 30, language: "en" };

test("Mew RGB vai pra Liga só com o nome (o código já está nele)", () => {
  assert.equal(api.ligaPokemonQuery(mewB), "Mew - B/RGB");
  assert.ok(links(mewB).liga.endsWith("card=Mew - B/RGB"), links(mewB).liga);
  // A versão PT é a mesma carta na Liga.
  assert.equal(api.ligaPokemonQuery({ ...mewB, id: "30th-B-pt", language: "pt" }), "Mew - B/RGB");
});

test("Classic Collection: número da carta antiga + /30, sem zero no total", () => {
  assert.equal(api.ligaPokemonQuery(lugia), "Lugia (149/30)");
  assert.ok(links(lugia).liga.endsWith("card=Lugia (149/30)"), links(lugia).liga);
  const charizard = { ...lugia, id: "30th-c-001", name: "Charizard", pokemonName: "Charizard", number: "001" };
  assert.equal(api.ligaPokemonQuery(charizard), "Charizard (4/30)");
  // PT ("Coleção Clássica de 30 Anos") tem o mesmo setId e a mesma numeração.
  assert.equal(api.ligaPokemonQuery({ ...lugia, id: "30th-c-029-pt", language: "pt" }), "Lugia (149/30)");
});

test("o resto segue como era: set principal dos 30 anos e set comum", () => {
  const exeggcute = { id: "30th-001", name: "Exeggcute", number: "001", setId: "30th", setTotal: 128, language: "en" };
  assert.equal(api.ligaPokemonQuery(exeggcute), "Exeggcute (001/128)");
  const gwynn = { id: "sv08-078", name: "Gwynn", number: "78", setId: "sv08", setTotal: 84, language: "en" };
  assert.equal(api.ligaPokemonQuery(gwynn), "Gwynn (078/084)");
  // Mew RGB japonês (M6a) não mudou: nome em inglês + JP colado no número.
  const mewJp = { id: "M6a-B-ja", name: "Mew - B/RGB", pokemonName: "Mew", number: "B", setId: "M6a", language: "ja" };
  assert.equal(api.ligaPokemonQuery(mewJp), "Mew (BJP)");
});

test("MYP não mudou (a regra é da Liga)", () => {
  assert.ok(links(lugia).myp.endsWith("=Lugia (029/30)"), links(lugia).myp);
  assert.ok(links(mewB).myp.endsWith("=Mew - B/RGB (B/128)"), links(mewB).myp);
});

// A tabela de números originais foi escrita à mão; o de-para cel30cc -> 30th-c
// (id antigo = número do TCGplayer, que é o impresso) é a fonte que confirma.
test("tabela da Classic Collection bate com o de-para do data/card-id-merges.json", () => {
  const merges = lerJson("data/card-id-merges.json").cards;
  const tabela = api.LIGA_CLASSIC_NUMBERS["30th-c"];
  const pares = Object.entries(merges).filter(([antigo]) => antigo.startsWith("cel30cc-"));
  assert.equal(pares.length, 30);
  assert.equal(tabela.length, 30);
  for (const [antigo, novo] of pares) {
    const original = antigo.slice("cel30cc-".length).split("-")[0];
    const i = parseInt(novo.slice("30th-c-".length), 10) - 1;
    assert.equal(tabela[i], original, `${novo} devia ser ${original}`);
  }
  // E toda carta do set (EN e PT) cai numa linha da tabela.
  for (const lang of ["en", "pt"]) {
    for (const card of lerJson(`data/sets/${lang}/30th-c.json`)) {
      assert.match(api.ligaPokemonQuery(card), /\(\d+\/30\)$/, card.id);
    }
  }
});
