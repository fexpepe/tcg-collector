// Espelho de imagens no R2 (img.sleevu.app). O que está travado: (1) as
// VARIANTES que o job copia são exatamente as que o cliente pede de cada
// fonte — senão a grade cai no 404 do espelho; (2) a regra da URL espelhada é
// a MESMA no build (scripts/lib/img-mirror.mjs) e no cliente (src/shared.js,
// mirrorImageUrl); (3) na cadeia do <img>, o espelho vem na frente e a origem
// logo atrás — uma carta ainda não espelhada continua aparecendo.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared } from "./lib/shared-sandbox.mjs";
import { ESPELHO, ORDEM, chaveDe, urlEspelho, variantesDe, versaoDe } from "../scripts/lib/img-mirror.mjs";

const sb = loadShared("window.__test = { mirrorImageUrl };");
const { mirrorImageUrl } = sb.window.__test;
const { localizedImg } = sb.window.TCGShared;
const cadeia = (html) => { const m = html.match(/data-img-fallbacks="([^"]*)"/); return m ? m[1].split("|") : []; };
const src = (html) => html.match(/ src="([^"]*)"/)[1];
const srcset = (html) => { const m = html.match(/ srcset="([^"]*)"/); return m ? m[1] : ""; };

const TCGDEX = "https://assets.tcgdex.net/en/base/base1/4/high.png";
const TCGP = "https://tcgplayer-cdn.tcgplayer.com/product/81834_in_1000x1000.jpg";
const LORCAST = "https://cards.lorcast.io/card/digital/large/crd_x.avif";
const SCRY = "https://cards.scryfall.io/normal/front/7/a/7a5cd03c.jpg?1783943085";

test("variantes: o que o job copia é o que o site pede de cada fonte", () => {
  assert.deepEqual(variantesDe(TCGDEX), [
    "https://assets.tcgdex.net/en/base/base1/4/low.webp",
    "https://assets.tcgdex.net/en/base/base1/4/high.webp"
  ]);
  assert.deepEqual(variantesDe(TCGP), ["https://tcgplayer-cdn.tcgplayer.com/product/81834_in_400x400.jpg", TCGP]);
  // Catálogo já na 400x400 (promos JP do Pokémon): uma variante só, sem duplicar.
  assert.deepEqual(variantesDe("https://tcgplayer-cdn.tcgplayer.com/product/108589_in_400x400.jpg"),
    ["https://tcgplayer-cdn.tcgplayer.com/product/108589_in_400x400.jpg"]);
  assert.deepEqual(variantesDe(LORCAST), ["https://cards.lorcast.io/card/digital/normal/crd_x.avif", LORCAST]);
  assert.deepEqual(variantesDe(SCRY), [SCRY]);
  assert.deepEqual(variantesDe("https://images.pokemontcg.io/base1/4.png"), []);   // só fallback: não se espelha
  assert.deepEqual(variantesDe("assets/games/game_pokemon.webp"), []);
});

test("chave = host + caminho; a query do Scryfall é a versão, não parte da chave", () => {
  assert.equal(chaveDe(SCRY), "cards.scryfall.io/normal/front/7/a/7a5cd03c.jpg");
  assert.equal(versaoDe(SCRY), "1783943085");
  assert.equal(versaoDe(TCGDEX), "");
});

test("URL espelhada: só host COMPLETO, e da TCGdex só webp — igual no build e no cliente", () => {
  const casos = [
    [TCGDEX, ["assets.tcgdex.net"], ""],   // png não mora no espelho
    ["https://assets.tcgdex.net/en/base/base1/4/low.webp", ["assets.tcgdex.net"], `${ESPELHO}assets.tcgdex.net/en/base/base1/4/low.webp`],
    ["https://assets.tcgdex.net/en/base/base1/4/low.webp", ["cards.scryfall.io"], ""],
    [TCGP, ORDEM, `${ESPELHO}tcgplayer-cdn.tcgplayer.com/product/81834_in_1000x1000.jpg`],
    [SCRY, ORDEM, `${ESPELHO}cards.scryfall.io/normal/front/7/a/7a5cd03c.jpg`],
    [LORCAST, [], ""],
    ["https://images.pokemontcg.io/base1/4.png", ORDEM, ""],
    ["assets/games/game_pokemon.webp", ORDEM, ""],
    ["", ORDEM, ""]
  ];
  for (const [u, hosts, esperado] of casos) {
    assert.equal(urlEspelho(u, hosts), esperado, `build: ${u}`);
    sb.SLEEVU = { imgMirrorHosts: hosts };
    assert.equal(mirrorImageUrl(u), esperado, `cliente: ${u}`);
  }
  delete sb.SLEEVU;
});

test("sem hosts espelhados o <img> sai exatamente como antes", () => {
  delete sb.SLEEVU;
  const html = localizedImg(TCGDEX, { thumb: true });
  assert.equal(src(html), "https://assets.tcgdex.net/en/base/base1/4/low.webp");
  assert.ok(!html.includes("img.sleevu.app"));
});

test("TCGdex espelhada: src e srcset no espelho, origem logo atrás na cadeia", () => {
  sb.SLEEVU = { imgMirrorHosts: ["assets.tcgdex.net"] };
  const html = localizedImg(TCGDEX, { thumb: true, sizes: "100px" });
  assert.equal(src(html), `${ESPELHO}assets.tcgdex.net/en/base/base1/4/low.webp`);
  assert.equal(srcset(html), `${ESPELHO}assets.tcgdex.net/en/base/base1/4/low.webp 245w, ${ESPELHO}assets.tcgdex.net/en/base/base1/4/high.webp 600w`);
  const c = cadeia(html);
  assert.equal(c[0], "https://assets.tcgdex.net/en/base/base1/4/low.webp");   // a origem EXATA do que falhou
  assert.ok(c.includes(TCGDEX));                                                 // depois o png de origem
  assert.ok(!c.some((u) => u.includes("img.sleevu.app") && u.endsWith(".png")));  // png nunca aponta pro espelho
  // Popup (sem thumb): high.webp espelhada, high.webp e high.png de origem atrás.
  const grande = localizedImg(TCGDEX, {});
  assert.equal(src(grande), `${ESPELHO}assets.tcgdex.net/en/base/base1/4/high.webp`);
  assert.deepEqual(cadeia(grande).slice(0, 2), ["https://assets.tcgdex.net/en/base/base1/4/high.webp", TCGDEX]);
  delete sb.SLEEVU;
});

test("TCGplayer espelhada: miniatura e grande no espelho, depois as duas de origem", () => {
  sb.SLEEVU = { imgMirrorHosts: ["tcgplayer-cdn.tcgplayer.com"] };
  const html = localizedImg(TCGP, { thumb: true });
  assert.equal(src(html), `${ESPELHO}tcgplayer-cdn.tcgplayer.com/product/81834_in_400x400.jpg`);
  assert.deepEqual(cadeia(html), [
    `${ESPELHO}tcgplayer-cdn.tcgplayer.com/product/81834_in_1000x1000.jpg`,
    "https://tcgplayer-cdn.tcgplayer.com/product/81834_in_400x400.jpg",
    TCGP
  ]);
  delete sb.SLEEVU;
});

test("host fora da lista segue na origem mesmo com outros hosts espelhados", () => {
  sb.SLEEVU = { imgMirrorHosts: ["cards.scryfall.io"] };
  const html = localizedImg(LORCAST, { thumb: true });
  assert.equal(src(html), "https://cards.lorcast.io/card/digital/normal/crd_x.avif");
  assert.ok(!html.includes("img.sleevu.app"));
  delete sb.SLEEVU;
});
