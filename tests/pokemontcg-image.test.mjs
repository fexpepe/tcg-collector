// URL da pokemontcg.io no build (scripts/lib/pokemontcg-image.mjs) tem de ser
// a MESMA que o cliente monta (src/shared.js#pokemontcgImageUrl): é por ela que
// o espelho de imagens (mirror-r2) copia as cartas que a TCGdex cataloga sem
// scan, e a chave do R2 é host + caminho da URL — divergência = 404 no espelho
// e a carta caindo na origem sem ninguém perceber. Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared } from "./lib/shared-sandbox.mjs";
import { pokemontcgImageUrl, pokemontcgSetId, lerSetIdMap } from "../scripts/lib/pokemontcg-image.mjs";

const RAIZ = new URL("../", import.meta.url);
const map = await lerSetIdMap(RAIZ);
const sb = loadShared("window.__test = { pokemontcgImageUrl };");
sb.TCG_SET_ID_MAP = map; // o cliente lê window.TCG_SET_ID_MAP na hora da chamada
const cliente = sb.window.__test.pokemontcgImageUrl;

const CASOS = [
  { id: "base1-4", language: "en", setId: "base1", number: "4" },
  { id: "tk-xy-b-1", language: "en", setId: "tk-xy-b", number: "1" },
  { id: "2021swsh-25", language: "en", setId: "2021swsh", number: "25" },      // McDonald's: id só no de-para
  { id: "sv03.5-199", language: "en", setId: "sv03.5", number: "199" },       // set duplo SV (regra geral)
  { id: "sv01-001", language: "en", setId: "sv01", number: "001" },           // zero à esquerda some
  { id: "ecard1-H07", language: "en", setId: "ecard1", number: "H07" },       // holo e-card: H7 lá
  { id: "swsh12.5tg-TG05", language: "en", setId: "swsh12.5tg", number: "TG05" }, // TG mantém o zero
  { id: "smp-SM240", language: "en", setId: "smp", number: "SM240" },
  { id: "mep-070-pt", language: "pt", setId: "mep", number: "070" },          // PT espelha a EN
  { id: "S12-001-ja", language: "ja", setId: "S12", number: "001" },          // JA: nunca
  { id: "x", language: "en", setId: "sv01", number: "9/94" },                 // número com total
  { id: "y", language: "en", setId: "sv01", number: "" },
  { id: "z", language: "en", setId: "", number: "1" }
];

test("o de-para versionado é lido do data/set-id-map.js", () => {
  assert.ok(Object.keys(map).length > 10, "mapa vazio");
  assert.equal(map["2021swsh"], "mcd21");
  assert.equal(pokemontcgSetId("2021swsh", map), "mcd21");
  assert.equal(pokemontcgSetId("sv03.5", map), "sv3pt5");
  assert.equal(pokemontcgSetId("sv01", {}), "sv1");
  assert.equal(pokemontcgSetId("", map), "");
});

test("build e cliente montam a MESMA URL (normal e hires), caso a caso", () => {
  for (const c of CASOS) {
    for (const hires of [false, true]) {
      assert.equal(pokemontcgImageUrl(c, map, hires), cliente(c, hires), `${c.id} hires=${hires}`);
    }
  }
  assert.equal(pokemontcgImageUrl(CASOS[0], map, false), "https://images.pokemontcg.io/base1/4.png");
  assert.equal(pokemontcgImageUrl(CASOS[0], map, true), "https://images.pokemontcg.io/base1/4_hires.png");
  assert.equal(pokemontcgImageUrl(CASOS[2], map, false), "https://images.pokemontcg.io/mcd21/25.png");
  assert.equal(pokemontcgImageUrl(CASOS[5], map, false), "https://images.pokemontcg.io/ecard1/H7.png");
  assert.equal(pokemontcgImageUrl(CASOS[9], map, false), "");
  assert.equal(pokemontcgImageUrl(null, map, false), "");
});
