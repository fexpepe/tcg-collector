// Cadeia de fallback das imagens de carta (localizedImg do src/shared.js).
// A TCGdex publica os scans por LÍNGUA e não no mesmo dia: o Pitch Black
// (me05) abriu com as cartas EN no verso cinza enquanto as PT apareciam, e o
// espelho da pokemontcg.io não cobre o set. A última tentativa passa a ser a
// mesma carta na outra língua do par EN/PT — mesma ilustração, mesma numeração.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared } from "./lib/shared-sandbox.mjs";

const { localizedImg } = loadShared().window.TCGShared;

// A cadeia sai no atributo data-img-fallbacks, separada por "|".
function cadeia(html) {
  const m = html.match(/data-img-fallbacks="([^"]*)"/);
  return m ? m[1].split("|").map((u) => u.replace(/&amp;/g, "&")) : [];
}
function src(html) {
  return html.match(/ src="([^"]*)"/)[1];
}

const EN = "https://assets.tcgdex.net/en/me/me05/001/high.png";
const PT = "https://assets.tcgdex.net/pt/me/me05/001/high.png";

test("carta EN termina tentando o scan PT da mesma carta", () => {
  const html = localizedImg(EN, { thumb: true });
  assert.equal(src(html), "https://assets.tcgdex.net/en/me/me05/001/low.webp");
  const chain = cadeia(html);
  assert.equal(chain[chain.length - 1], PT);
  // O scan da língua certa continua vindo ANTES — a troca de língua é o último
  // recurso, e sai de cena sozinha quando a TCGdex publicar o que falta.
  assert.ok(chain.indexOf(EN) >= 0 && chain.indexOf(EN) < chain.length - 1);
});

test("carta PT termina tentando o scan EN (simétrico)", () => {
  const chain = cadeia(localizedImg(PT, { thumb: true }));
  assert.equal(chain[chain.length - 1], EN);
});

test("o espelho da pokemontcg.io vem antes da troca de língua", () => {
  const ptcg = "https://images.pokemontcg.io/me5/1.png";
  const chain = cadeia(localizedImg(EN, { thumb: true, fallback: ptcg }));
  assert.ok(chain.indexOf(ptcg) < chain.indexOf(PT));
  assert.equal(chain[chain.length - 1], PT);
});

test("JA/ZH não trocam de língua (numeração própria: a URL não casaria)", () => {
  const ja = "https://assets.tcgdex.net/ja/sv/SV3a/001/high.png";
  assert.ok(!cadeia(localizedImg(ja, { thumb: true })).some((u) => /\/(en|pt)\//.test(u)));
});

test("URL fora da TCGdex passa batido", () => {
  const lorcast = "https://cards.lorcast.io/card/digital/large/crd_x.avif";
  assert.deepEqual(cadeia(localizedImg(lorcast, {})), []);
  assert.deepEqual(cadeia(localizedImg("assets/games/game_pokemon.webp", {})), []);
});

test("sem URL não gera <img>", () => {
  assert.equal(localizedImg("", {}), "");
});
