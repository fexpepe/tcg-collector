// Decks: capas e miniaturas pelo espelho de imagens (2026-11-22).
//
// A galeria e o visualizador pediam a URL crua da origem (Scryfall, Lorcast...)
// em tamanho único. Agora toda <img> de carta do decks.js passa por
// shared.localizedImg (espelho na frente, origem na reserva) e as previews de
// hover por shared.hoverThumb. O que se trava aqui é a forma, que uma edição
// futura quebra sem perceber: voltar a montar <img src="${escA(url)}"> de carta
// a mão, ou usar `thumb` sem `sizes` (sem sizes o navegador assume 100vw e
// baixaria a de 600 px até numa miniatura de 26 px).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadShared } from "./lib/shared-sandbox.mjs";

const src = readFileSync(new URL("../src/decks.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("nenhum <img> de carta com a URL crua sobra no decks.js", () => {
  assert.equal(/<img[^>]*src="\$\{escA\(/.test(src), false, "ainda há <img src=\"${escA(...)}\"> de carta");
  assert.equal(/\.setAttribute\("src", card\.image\)/.test(src), false, "hover do editor ainda grava a URL crua");
  assert.equal(/img\.src = art/.test(src), false, "hover do visualizador ainda grava a URL crua");
});

test("as previews de hover usam hoverThumb (nó novo por carta, espelho na frente)", () => {
  assert.equal((src.match(/shared\.hoverThumb\(/g) || []).length, 2);
});

test("miniatura com thumb sempre leva sizes", () => {
  const miniaturas = src.match(/imgMini\(/g) || [];
  assert.ok(miniaturas.length >= 8, "pontos de miniatura esperados");
  // imgMini só liga thumb junto com sizes.
  assert.match(src, /Object\.assign\(\{ thumb: true, sizes: sizes \}, opts\)/);
  assert.equal(/thumb: true(?!, sizes: sizes)/.test(src), false, "thumb sem sizes");
});

// A regra de verdade (usaThumb, tirada do fonte do decks.js) contra a cadeia
// de verdade (shared.cardImgChain, com os hosts do espelho como em produção).
// O que se trava: a foto do deck nunca chega menor do que a URL de origem
// entregava antes do espelho — nem com o espelho falhando. Com `thumb` a
// cadeia de reserva passa pela variante reduzida do host (TCGdex low 245 px,
// Lorcast normal 488, TCGplayer 400x400) antes da origem; por isso a
// miniatura grande só usa thumb onde isso não existe e a origem é menor que a
// candidata de 600 (Scryfall normal, 488 px).
const HOSTS = ["wsrv.nl", "cards.lorcast.io", "tcgplayer-cdn.tcgplayer.com", "assets.tcgdex.net", "cards.scryfall.io", "images.pokemontcg.io"];
const AMOSTRAS = {
  scryfall: "https://cards.scryfall.io/normal/front/7/a/7a5cd03c-4227-4551-aa4b-7d119f0468b5.jpg?1783943085",
  lorcast: "https://cards.lorcast.io/card/digital/large/crd_d2a5bd5b6ea44a9ea4a0d1b6cb0e2a37.avif",
  tcgplayer: "https://tcgplayer-cdn.tcgplayer.com/product/81834_in_1000x1000.jpg",
  tcgdex: "https://assets.tcgdex.net/en/base/base1/4/high.png",
  pokemontcg: "https://images.pokemontcg.io/base1/4_hires.png",
};
const REDUZIDA = /\/low\.webp$|\/card\/digital\/normal\/|_in_400x400\.jpg$/;

function usaThumbDoFonte() {
  const m = src.match(/\n  const MENOR_RESERVA = [^\n]+\n  const ORIGEM_ABAIXO_DE_600 = [^\n]+\n(?:  \/\/[^\n]*\n)*  const usaThumb = [^\n]+\n/);
  assert.ok(m, "usaThumb não encontrado no decks.js (ou mudou de forma)");
  return new Function(`${m[0]}\nreturn usaThumb;`)();
}
function sharedComEspelho() {
  const sb = loadShared("");
  sb.SLEEVU = { imgMirrorHosts: HOSTS };
  return sb.window.TCGShared;
}

test("miniatura grande: depois do espelho vem a origem inteira, nunca a variante reduzida do host", () => {
  const usaThumb = usaThumbDoFonte();
  const shared = sharedComEspelho();
  for (const [host, url] of Object.entries(AMOSTRAS)) {
    for (const maxCss of [172, 184, 200]) {
      const opts = usaThumb(url, maxCss) ? { thumb: true, sizes: "200px" } : {};
      const { src: primeiro, chain } = shared.cardImgChain(url, opts);
      assert.match(primeiro, /^https:\/\/img\.sleevu\.app\//, `${host}: o espelho não veio na frente`);
      assert.equal(chain.some((u) => REDUZIDA.test(u)), false, `${host} a ${maxCss} px cairia numa variante reduzida: ${chain.join(" | ")}`);
      assert.ok(chain.includes(url), `${host}: a URL de origem saiu da cadeia de reserva`);
    }
  }
  // Só o Scryfall usa a candidata de 600 em miniatura grande.
  assert.equal(usaThumb(AMOSTRAS.scryfall, 200), true);
  for (const host of ["lorcast", "tcgplayer", "tcgdex", "pokemontcg"]) {
    assert.equal(usaThumb(AMOSTRAS[host], 200), false, `${host} não pode usar thumb em miniatura grande`);
  }
});

test("a premissa da regra: com thumb, a cadeia passa mesmo pela variante reduzida nesses hosts", () => {
  // Se o shared.js deixar de fazer isso, a regra do decks.js pode ser relaxada
  // (e este teste avisa); enquanto fizer, relaxar a regra piora a foto.
  const shared = sharedComEspelho();
  for (const host of ["lorcast", "tcgplayer", "tcgdex"]) {
    const { chain } = shared.cardImgChain(AMOSTRAS[host], { thumb: true, sizes: "200px" });
    assert.ok(chain.some((u) => REDUZIDA.test(u)), `${host}: a variante reduzida saiu da cadeia do thumb`);
  }
  for (const host of ["scryfall", "pokemontcg"]) {
    const { chain } = shared.cardImgChain(AMOSTRAS[host], { thumb: true, sizes: "200px" });
    assert.equal(chain.some((u) => REDUZIDA.test(u)), false, `${host}: apareceu variante reduzida na cadeia`);
  }
});

test("miniatura pequena (26 e 34 px) usa thumb em todo host: a menor reserva cobre a tela 3x", () => {
  const usaThumb = usaThumbDoFonte();
  for (const [host, url] of Object.entries(AMOSTRAS)) {
    for (const px of [26, 34]) assert.equal(usaThumb(url, px), true, `${host} a ${px} px`);
  }
  // 34 px × 3 = 102, e a menor variante da reserva é a low da TCGdex (245 px).
  assert.ok(34 * 3 <= 245);
});

test("data-art e data-capa seguem guardando a URL de ORIGEM (não a do espelho)", () => {
  assert.match(src, /data-art="\$\{escA\(card\.image\)\}"/);
  assert.match(src, /data-capa="\$\{escA\(capa\)\}"/);
  assert.equal(/img\.sleevu\.app/.test(src.replace(/\/\/.*$/gm, "")), false, "URL do espelho montada a mão no decks.js");
});
