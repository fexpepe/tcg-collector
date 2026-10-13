// Espelho de imagens no R2 (img.sleevu.app). O que está travado: (1) a
// MATRIZ que o job baixa é a melhor imagem de cada fonte; (2) a regra da URL
// espelhada (<host><caminho>@<largura>[.g<geração>].webp) é a MESMA no build
// (scripts/lib/img-mirror.mjs) e no cliente (src/shared.js, mirrorImg),
// inclusive no wsrv.nl, cuja base vem da query; (3) na cadeia do <img> o
// espelho vem na frente com srcset 300w/600w em TODA fonte, e a origem logo
// atrás — uma carta ainda não espelhada continua aparecendo.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared } from "./lib/shared-sandbox.mjs";
import { ESPELHO, GERACAO, LARGURAS, ORDEM, chaveBase, chaveDe, injetaEspelho, matrizDe, statusDoEspelho, urlEspelho, versaoDe, webpDe } from "../scripts/lib/img-mirror.mjs";
import { readFileSync } from "node:fs";

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
  // high.png, sem perdas: o high.webp já vem comprimido pela TCGdex e o job
  // comprimia por cima (geração 2, 13/10/2026).
  assert.equal(matrizDe(TCGDEX), "https://assets.tcgdex.net/en/base/base1/4/high.png");
  assert.equal(matrizDe(TCGDEX.replace("high.png", "low.webp")), TCGDEX);
  assert.equal(matrizDe(TCGP400), TCGP.replace("81834", "108589"));
  assert.equal(matrizDe(TCGP), TCGP);
  assert.equal(matrizDe(LORCAST), LORCAST);
  assert.equal(matrizDe(LORCAST.replace("/large/", "/normal/")), LORCAST);
  assert.equal(matrizDe(SCRY), SCRY.replace("/normal/", "/large/"));
  assert.equal(matrizDe(WSRV), "https://wsrv.nl/?url=static.wikia.nocookie.net%2Fhunterxhunter%2Fimages%2Fb%2Fbe%2FHyper_battle_part_1_card_c01.png&w=1000&output=webp");
  // pokemontcg.io entrou em 20/09/2026: é a imagem principal das cartas sem scan na TCGdex.
  assert.equal(matrizDe("https://images.pokemontcg.io/base1/4.png"), "https://images.pokemontcg.io/base1/4_hires.png");
  assert.equal(matrizDe("https://images.pokemontcg.io/base1/4_hires.png"), "https://images.pokemontcg.io/base1/4_hires.png");
  assert.equal(chaveDe("https://images.pokemontcg.io/mcd21/25.png", 300), "images.pokemontcg.io/mcd21/25.png@300.webp");
  assert.equal(urlEspelho("https://images.pokemontcg.io/mcd21/25.png", ["images.pokemontcg.io"], 1000), `${ESPELHO}images.pokemontcg.io/mcd21/25.png@1000.webp`);
  assert.ok(ORDEM.indexOf("images.pokemontcg.io") > ORDEM.indexOf("assets.tcgdex.net"), "pokemontcg.io depois da TCGdex no rollout");
  // Bulbagarden Archives (vintages japoneses): thumb volta pro upload original; original fica como está.
  assert.equal(matrizDe("https://archives.bulbagarden.net/media/upload/thumb/3/3a/OddishExpansionPack68.jpg/300px-OddishExpansionPack68.jpg"), "https://archives.bulbagarden.net/media/upload/3/3a/OddishExpansionPack68.jpg");
  assert.equal(matrizDe("https://archives.bulbagarden.net/media/upload/3/3a/OddishExpansionPack68.jpg"), "https://archives.bulbagarden.net/media/upload/3/3a/OddishExpansionPack68.jpg");
  assert.equal(chaveDe("https://archives.bulbagarden.net/media/upload/3/3a/OddishExpansionPack68.jpg", 300), "archives.bulbagarden.net/media/upload/3/3a/OddishExpansionPack68.jpg@300.webp");
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
    // pokemontcg.io espelhada desde 20/09/2026 (imagem principal das cartas sem scan na TCGdex).
    ["https://images.pokemontcg.io/base1/4.png", ORDEM, 300, `${ESPELHO}images.pokemontcg.io/base1/4.png@300.webp`],
    ["https://images.pokemontcg.io/base1/4.png", ["assets.tcgdex.net"], 300, ""],
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

// Geração (13/10/2026): imagem regerada vai pra chave NOVA (.g<n>) — o cache
// guarda a velha por um ano e a borda ignora a query — e o site só troca de
// geração num host quando o status diz que ela está completa.
test("geração: chave com sufixo, igual no build e no cliente; host sem geração declarada segue na 1", () => {
  assert.ok(GERACAO >= 2);
  assert.equal(chaveDe(TCGDEX, 600, 2), "assets.tcgdex.net/en/base/base1/4/high.png@600.g2.webp");
  assert.equal(chaveDe(TCGDEX, 600, 1), chaveDe(TCGDEX, 600));
  assert.equal(chaveDe(WSRV_WE, 1000, 2), "wsrv.nl/www.tv-tokyo.co.jp/anime/naruto2002/goods/cardimg/a b.jpg@1000.g2.webp");
  const geracoes = { "assets.tcgdex.net": 2, "wsrv.nl": 2 };
  const casos = [
    [TCGDEX, 300, `${ESPELHO}assets.tcgdex.net/en/base/base1/4/high.png@300.g2.webp`],
    [WSRV_WE, 600, `${ESPELHO}wsrv.nl/www.tv-tokyo.co.jp/anime/naruto2002/goods/cardimg/a%20b.jpg@600.g2.webp`],
    [SCRY, 1000, `${ESPELHO}cards.scryfall.io/normal/front/7/a/7a5cd03c.jpg@1000.webp`]   // ainda na geração 1
  ];
  for (const [u, w, esperado] of casos) {
    assert.equal(urlEspelho(u, ORDEM, w, geracoes), esperado, `build: ${u}`);
    sb.SLEEVU = { imgMirrorHosts: ORDEM, imgMirrorGen: geracoes };
    assert.equal(mirrorImg(u, w), esperado, `cliente: ${u}`);
  }
  // srcset da grade também na geração do host.
  const html = localizedImg(TCGDEX, { thumb: true, sizes: "100px" });
  assert.equal(srcset(html), `${ESPELHO}assets.tcgdex.net/en/base/base1/4/high.png@300.g2.webp 300w, ${ESPELHO}assets.tcgdex.net/en/base/base1/4/high.png@600.g2.webp 600w`);
  delete sb.SLEEVU;
});

test("status do job → o que o site usa: só host completo no esquema atual, e a geração completa dele", () => {
  const st = { hosts: {
    "assets.tcgdex.net": { esquema: 2, completo: true, geracao: 2 },
    "cards.scryfall.io": { esquema: 2, completo: true },               // status de antes da geração: 1
    "wsrv.nl": { esquema: 2, completo: true, geracao: 1 },
    "cards.lorcast.io": { esquema: 2, completo: false, geracao: 2 },   // não fechou: fora
    "tcgplayer-cdn.tcgplayer.com": { esquema: 1, completo: true }       // esquema velho: fora
  } };
  assert.deepEqual(statusDoEspelho(st), { hosts: ["wsrv.nl", "assets.tcgdex.net", "cards.scryfall.io"], geracoes: { "assets.tcgdex.net": 2 } });
  assert.deepEqual(statusDoEspelho(null), { hosts: [], geracoes: {} });
});

test("deploy: injeta hosts E geração no game.js, e para se faltar um dos marcadores", () => {
  const game = readFileSync(new URL("../src/game.js", import.meta.url), "utf8");
  const out = injetaEspelho(game, { hosts: ["assets.tcgdex.net"], geracoes: { "assets.tcgdex.net": 2 } });
  assert.match(out, /var IMG_MIRROR_HOSTS = \["assets\.tcgdex\.net"\]; \/\* SLEEVU_IMG_MIRROR \*\//);
  assert.match(out, /var IMG_MIRROR_GEN = \{"assets\.tcgdex\.net":2\}; \/\* SLEEVU_IMG_MIRROR_GEN \*\//);
  assert.match(game, /imgMirrorGen: IMG_MIRROR_GEN/, "o game.js expõe a geração pro mirrorImg");
  assert.throws(() => injetaEspelho(game.replace(/var IMG_MIRROR_GEN[^\n]*/, ""), {}), /SLEEVU_IMG_MIRROR_GEN/);
  assert.throws(() => injetaEspelho(game.replace(/var IMG_MIRROR_HOSTS[^\n]*/, ""), {}), /SLEEVU_IMG_MIRROR/);
});

test("qualidade: o popup (1000) com mais qualidade e croma inteligente; a grade como sempre", () => {
  assert.deepEqual(webpDe(300), { quality: 80 });
  assert.deepEqual(webpDe(600), { quality: 80 });
  assert.deepEqual(webpDe(1000), { quality: 90, smartSubsample: true });
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
