// Página de artista do Magic não pode sair vazia (2026-10-08).
//
// As telas de grupo (artista, Pokémon, treinador) pegam os cardIds do índice e
// baixam os chunks dos sets deles, achando o set pelo começo do id. O id do
// Magic não começa pelo setId ("mtg-10e-1", set "10e"): o setIdForCard
// devolvia "mtg-10e", que não existe no manifest, nenhum chunk descia e a
// página abria vazia — os 2.520 artistas do Magic (visto em produção: "Pete
// Venters", 567 cartas no índice, 0 na tela). O detail.js tenta de novo sem o
// prefixo do jogo.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadShared } from "./lib/shared-sandbox.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const shared = loadShared("window.__test = { setIdForCard };").window.__test;

// A função do detail.js, tirada do próprio arquivo.
function setDoIdDoDetail(setIds) {
  const fonte = readFileSync(join(raiz, "src/detail.js"), "utf8");
  const ini = fonte.indexOf("const setDoId = (cardId) => {");
  const fim = fonte.indexOf("};", ini) + 2;
  assert.ok(ini > 0, "o detail.js perdeu o setDoId");
  const corpo = fonte.slice(ini, fim);
  return new Function("shared", "setIds", "conhecidos", `${corpo}\nreturn setDoId;`)(shared, setIds, new Set(setIds));
}

test("cartas do Magic acham o set (id mtg-<set>-<n>), e as do Pokémon seguem iguais", () => {
  const dirMagic = join(raiz, "data/magic/sets");
  const setsMagic = readdirSync(dirMagic).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  const setDoId = setDoIdDoDetail(setsMagic);
  // Amostra real: as primeiras cartas de alguns chunks versionados.
  for (const set of ["10e", "lea", setsMagic[setsMagic.length - 1]]) {
    const cartas = JSON.parse(readFileSync(join(dirMagic, `${set}.json`), "utf8")).slice(0, 5);
    for (const c of cartas) assert.equal(setDoId(c.id), c.setId, `${c.id} devia cair no set ${c.setId}`);
  }
  const setsPokemon = ["base1", "sv03.5", "swsh12pt5", "sv01"];
  const pokemon = setDoIdDoDetail(setsPokemon);
  assert.equal(pokemon("sv03.5-199"), "sv03.5");
  assert.equal(pokemon("base1-4"), "base1");
});
