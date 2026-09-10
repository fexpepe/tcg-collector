// Espelho de imagens no R2 (img.sleevu.app). O que está travado: (1) a
// MATRIZ que o job baixa é a melhor imagem de cada fonte; (2) a regra da URL
// espelhada (<host><caminho>@<largura>.webp) é a MESMA no build
// (scripts/lib/img-mirror.mjs) e no cliente (src/shared.js, mirrorImg),
// inclusive no wsrv.nl, cuja base vem da query; (3) na cadeia do <img> o
// espelho vem na frente com srcset 300w/600w em TODA fonte, e a origem logo
// atrás — uma carta ainda não espelhada continua aparecendo.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared } from "./lib/shared-sandbox.mjs";
import { ESPELHO, LARGURAS, ORDEM, chaveBase, chaveDe, matrizDe, urlEspelho, versaoDe } from "../scripts/lib/img-mirror.mjs";

const sb = loadShared("window.__test = { mirrorImg };");
const { mirrorImg } = sb.window.__test;
const { localizedImg } = sb.window.TCGShared;
// Atributos saem escapados (& vira &amp;): desfaz pra comparar com a URL crua.
const des = (s) => s.replace(/&amp;/g, "&");
const cadeia = (html) => { const m = html.match(/data-img-fallbacks="([^"]*)"/); return m ? des(m[1]).split("|") : []; };
const src = (html) => des(html.match(/ src="([^"]*)"/)[1]);
const srcset = (html) => { const m = html.match(/ srcset="([^"]*)"/); return m ? des(m[1]) : ""; };

const TCGDEX = "https://assets.tcgdex.net/en/base/base1/4/high.png";
const TCGP = "https://tcgplayer-cdn.tcgplayer.com/product/81834_in_1000x1000.jpg";
const TCGP400 = "https://tcgplayer-cdn.tcgplayer.com/product/108589_in_400x400.jpg";
const LORCAST = "https://cards.lorcast.io/card/digital/large/crd_x.avif";
const SCRY = "https://cards.scryfall.io/normal/front/7/a/7a5cd03c.jpg?1783943085";
const WSRV = "https://wsrv.nl/?url=static.wikia.nocookie.net%2Fhunterxhunter%2Fimages%2Fb%2Fbe%2FHyper_battle_part_1_card_c01.png&w=440&output=webp";
const WSRV_WE = "https://wsrv.nl/?url=www.tv-tokyo.co.jp%2Fanime%2Fnaruto2002%2Fgoods%2Fcardimg%2Fa%20b.jpg&w=440&we&output=webp";

test("matriz: a melhor imagem que cada fonte publica", () => {
  assert.equal(matrizDe(TCGDEX), "https://assets.tcgdex.net/en/base/base1/4/high.webp");
  assert.equal(matrizDe(TCGP400), TCGP.replace("81834", "108589"));
  assert.equal(matrizDe(TCGP), TCGP);
  assert.equal(matrizDe(LORCAST), LORCAST);
  assert.equal(matrizDe(LORCAST.replace("/large/", "/normal/")), LORCAST);
  assert.equal(matrizDe(SCRY), SCRY.replace("/normal/", "/large/"));
  assert.equal(matrizDe(WSRV), "https://wsrv.nl/?url=static.wikia.nocookie.net%2Fhunterxhunter%2Fimages%2Fb%2Fbe%2FHyper_battle_part_1_card_c01.png&w=1000&output=webp");
  assert.equal(matrizDe("https://images.pokemontcg.io/base1/4.png"), "");   // só fallback: não se espelha
  assert.equal(matrizDe("assets/games/game_pokemon.webp"), "");
  assert.deepEqual(LARGURAS, [300, 600, 1000]);
  assert.equal(ORDEM[0], "wsrv.nl");
});

test("chave = host + caminho do catálogo @largura; no wsrv a base vem da query; a query do Scryfall é a versão", () => {
  assert.equal(chaveDe(SCRY, 300), "cards.scryfall.io/normal/front/7/a/7a5cd03c.jpg@300.webp");
  assert.equal(versaoDe(SCRY), "1783943085");
  assert.equal(versaoDe(TCGDEX), "");
  assert.equal(chaveBase(WSRV), "wsrv.nl/static.wikia.nocookie.net/hunterxhunter/images/b/be/Hyper_battle_part_1_card_c01.png");
  assert.equal(chaveDe(WSRV_WE, 600), "wsrv.nl/www.tv-tokyo.co.jp/anime/naruto2002/goods/cardimg/a b.jpg@600.webp");
  assert.equal(chaveBase("https://wsrv.nl/?w=440&output=webp"), "");
});

test("URL espelhada: só host COMPLETO — igual no build e no cliente", () => {
  const casos = [
    [TCGDEX, ["assets.tcgdex.net"], 300, `${ESPELHO}assets.tcgdex.net/en/base/base1/4/high.png@300.webp`],
    [TCGDEX, ["cards.scryfall.io"], 300, ""],
    [TCGP, ORDEM, 1000, `${ESPELHO}tcgplayer-cdn.tcgplayer.com/product/81834_in_1000x1000.jpg@1000.webp`],
    [SCRY, ORDEM, 600, `${ESPELHO}cards.scryfall.io/normal/front/7/a/7a5cd03c.jpg@600.webp`],
    [WSRV_WE, ["wsrv.nl"], 300, `${ESPELHO}wsrv.nl/www.tv-tokyo.co.jp/anime/naruto2002/goods/cardimg/a%20b.jpg@300.webp`],
    ["https://wsrv.nl/?w=440&output=webp", ["wsrv.nl"], 300, ""],
    [LORCAST, [], 300, ""],
    ["https://images.pokemontcg.io/base1/4.png", ORDEM, 300, ""],
    ["assets/games/game_pokemon.webp", ORDEM, 300, ""],
    ["", ORDEM, 300, ""]
  ];
  for (const [u, hosts, w, esperado] of casos) {
    assert.equal(urlEspelho(u, hosts, w), esperado, `build: ${u}`);
    sb.SLEEVU = { imgMirrorHosts: hosts };
    assert.equal(mirrorImg(u, w), esperado, `cliente: ${u}`);
  }
  delete sb.SLEEVU;
});

test("sem hosts espelhados o <img> sai exatamente como antes", () => {
  delete sb.SLEEVU;
  const html = localizedImg(TCGDEX, { thumb: true });
  assert.equal(src(html), "https://assets.tcgdex.net/en/base/base1/4/low.webp");
  assert.ok(!html.includes("img.sleevu.app"));
});

test("grade espelhada: 300 com srcset 300w/600w em QUALQUER fonte, origem logo atrás", () => {
  for (const [u, host, origemThumb] of [
    [TCGDEX, "assets.tcgdex.net", "https://assets.tcgdex.net/en/base/base1/4/low.webp"],
    [SCRY, "cards.scryfall.io", SCRY],
    [TCGP, "tcgplayer-cdn.tcgplayer.com", "https://tcgplayer-cdn.tcgplayer.com/product/81834_in_400x400.jpg"],
    [WSRV, "wsrv.nl", WSRV]
  ]) {
    sb.SLEEVU = { imgMirrorHosts: [host] };
    const html = localizedImg(u, { thumb: true, sizes: "100px" });
    assert.equal(src(html), mirrorImg(u, 300), u);
    assert.equal(srcset(html), `${mirrorImg(u, 300)} 300w, ${mirrorImg(u, 600)} 600w`, u);
    assert.equal(cadeia(html)[0], origemThumb, u);   // a origem EXATA do que o site mostrava
  }
  // Sem `sizes` não há srcset (o navegador assumiria 100vw): só o src de 300.
  sb.SLEEVU = { imgMirrorHosts: ["cards.scryfall.io"] };
  assert.equal(srcset(localizedImg(SCRY, { thumb: true })), "");
  delete sb.SLEEVU;
});

test("popup espelhado: 1000, sem srcset, origem grande e png atrás", () => {
  sb.SLEEVU = { imgMirrorHosts: ["assets.tcgdex.net"] };
  const html = localizedImg(TCGDEX, {});
  assert.equal(src(html), `${ESPELHO}assets.tcgdex.net/en/base/base1/4/high.png@1000.webp`);
  assert.equal(srcset(html), "");
  assert.deepEqual(cadeia(html).slice(0, 2), ["https://assets.tcgdex.net/en/base/base1/4/high.webp", TCGDEX]);
  delete sb.SLEEVU;
});

test("host fora da lista segue na origem mesmo com outros hosts espelhados", () => {
  sb.SLEEVU = { imgMirrorHosts: ["cards.scryfall.io"] };
  const html = localizedImg(LORCAST, { thumb: true });
  assert.equal(src(html), "https://cards.lorcast.io/card/digital/normal/crd_x.avif");
  assert.ok(!html.includes("img.sleevu.app"));
  delete sb.SLEEVU;
});
