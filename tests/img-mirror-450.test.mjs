// Largura intermediária do espelho, a 450 (14/11/2026). O que está travado:
// (1) o job gera as quatro larguras na carta nova e ganha a 450 das que já
// existem a partir da 1000 do bucket, sem bater nas fontes; (2) o status só
// libera a 450 de um host quando TODA carta da geração servida a tem; (3) o
// deploy e o app injetam a lista no game.js; (4) o cliente só põe a 450 no
// srcset dos hosts liberados, e o `sizes` do celular deixa o 2x pegá-la.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadShared } from "./lib/shared-sandbox.mjs";
import { ESPELHO, INTERMEDIARIA, LARGURAS, injetaEspelho, intermediariaDoHost, statusDoEspelho, webpDe } from "../scripts/lib/img-mirror.mjs";
import { transformaGameJs } from "../scripts/lib/app-web.mjs";

const ler = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sb = loadShared("window.__test = { mirrorImg, SIZES_CARD_TILE };");
const { mirrorImg, SIZES_CARD_TILE } = sb.window.__test;
const { localizedImg } = sb.window.TCGShared;
const des = (s) => s.replace(/&amp;/g, "&");
const srcset = (html) => { const m = html.match(/ srcset="([^"]*)"/); return m ? des(m[1]) : ""; };

const SCRY = "https://cards.scryfall.io/normal/front/7/a/7a5cd03c.jpg?1783943085";
const TCGP = "https://tcgplayer-cdn.tcgplayer.com/product/81834_in_1000x1000.jpg";

test("a 450 é uma das larguras da carta, entre a 300 e a 600, com a qualidade da grade", () => {
  assert.equal(INTERMEDIARIA, 450);
  assert.deepEqual(LARGURAS, [300, 450, 600, 1000]);
  assert.deepEqual(webpDe(INTERMEDIARIA), { quality: 80 });
});

test("status: a 450 só vale pros hosts completos que a declaram", () => {
  const st = { hosts: {
    "cards.lorcast.io": { esquema: 2, completo: true, geracao: 2, intermediaria: true },
    "cards.scryfall.io": { esquema: 2, completo: true, geracao: 2, intermediaria: false },
    "wsrv.nl": { esquema: 2, completo: false, geracao: 2, intermediaria: true },          // não fechou: fora de tudo
    "tcgplayer-cdn.tcgplayer.com": { esquema: 2, completo: true, geracao: 2 }              // status de antes da 450
  } };
  assert.deepEqual(statusDoEspelho(st).intermediaria, ["cards.lorcast.io"]);
});

test("job: geração que fecha libera a 450 só com TODAS as cartas; geração em curso herda a da servida", () => {
  assert.equal(intermediariaDoHost({ fechou: true, ok: 100, com450: 100 }), true);
  assert.equal(intermediariaDoHost({ fechou: true, ok: 100, com450: 99 }), false);
  assert.equal(intermediariaDoHost({ fechou: true, ok: 0, com450: 0 }), false);
  // Geração nova em curso: o site segue na anterior, e a 450 dela vale o que valia.
  const antes = { geracao: 2, intermediaria: true };
  assert.equal(intermediariaDoHost({ fechou: false, ok: 10, com450: 10, antes, servida: 2 }), true);
  assert.equal(intermediariaDoHost({ fechou: false, ok: 10, com450: 10, antes: { geracao: 2 }, servida: 2 }), false);
  assert.equal(intermediariaDoHost({ fechou: false, ok: 10, com450: 10, antes, servida: 0 }), false);
});

test("job: carta nova sai com as quatro larguras; a 450 das antigas sai da 1000 do bucket", () => {
  const job = ler("scripts/mirror-r2.mjs");
  assert.ok(job.includes("const saidas = await Promise.all(LARGURAS.map((w) =>"), "a geração usa a lista inteira (com a 450)");
  assert.ok(job.includes("idx.objetos[base] = [matriz.length, o.versao, HOJE, GERACAO, fonte, 1];"), "o 6º campo marca a 450");
  const passo = job.slice(job.indexOf("async function processaIntermediaria("), job.indexOf("// ── 6. Status por host"));
  assert.ok(passo.includes("await r2.get(chaveDe(o.url, 1000, GERACAO))"), "lê a 1000 do bucket");
  assert.ok(!/fetch\(o\.matriz|fetch\(o\.alt/.test(passo), "não baixa nada das fontes");
  assert.ok(passo.includes("geracaoDe(tem) === GERACAO && !tem450(tem)"), "só a geração atual, só quem não tem");
  assert.ok(passo.includes("r2.put(chaveDe(o.url, INTERMEDIARIA, GERACAO)"));
  assert.ok(job.indexOf("await processaIntermediaria(h)") > job.indexOf("await processa(h, h.regeracao"), "depois da manutenção e da regeração");
  assert.ok(job.includes("intermediariaDoHost({ fechou, ok, com450, antes, servida })"), "o status sai da regra testada acima");
});

test("deploy e app: o game.js leva a lista da 450, e falta do marcador para o build", () => {
  const game = ler("src/game.js");
  assert.match(game, /imgMirror450: IMG_MIRROR_450/);
  const out = injetaEspelho(game, { hosts: ["cards.lorcast.io"], geracoes: { "cards.lorcast.io": 2 }, intermediaria: ["cards.lorcast.io"] });
  assert.match(out, /var IMG_MIRROR_450 = \["cards\.lorcast\.io"\]; \/\* SLEEVU_IMG_MIRROR_450 \*\//);
  assert.match(injetaEspelho(game, {}), /var IMG_MIRROR_450 = \[\]; \/\* SLEEVU_IMG_MIRROR_450 \*\//, "sem lista = vazia");
  assert.throws(() => injetaEspelho(game.replace(/var IMG_MIRROR_450[^\n]*/, ""), {}), /SLEEVU_IMG_MIRROR_450/);
  const { texto } = transformaGameJs(game, { origem: "https://sleevu.app", hostsEspelho: ["wsrv.nl"], geracoesEspelho: {}, intermediariaEspelho: ["wsrv.nl"] });
  assert.match(texto, /var IMG_MIRROR_450 = \["wsrv\.nl"\]; \/\* SLEEVU_IMG_MIRROR_450 \*\//);
  assert.ok(ler("scripts/apply-img-mirror.mjs").includes("intermediaria: []"), "o deploy sem espelho injeta a lista vazia");
});

test("cliente: a 450 entra no srcset da grade só nos hosts liberados", () => {
  sb.SLEEVU = { imgMirrorHosts: ["cards.scryfall.io", "tcgplayer-cdn.tcgplayer.com"], imgMirrorGen: { "cards.scryfall.io": 2, "tcgplayer-cdn.tcgplayer.com": 2 }, imgMirror450: ["cards.scryfall.io"] };
  assert.equal(srcset(localizedImg(SCRY, { thumb: true, sizes: "100px" })),
    `${mirrorImg(SCRY, 300)} 300w, ${mirrorImg(SCRY, 450)} 450w, ${mirrorImg(SCRY, 600)} 600w`);
  assert.equal(mirrorImg(SCRY, 450), `${ESPELHO}cards.scryfall.io/normal/front/7/a/7a5cd03c.jpg@450.g2.webp`);
  // Host espelhado sem a 450 liberada: o srcset de antes.
  assert.equal(srcset(localizedImg(TCGP, { thumb: true, sizes: "100px" })), `${mirrorImg(TCGP, 300)} 300w, ${mirrorImg(TCGP, 600)} 600w`);
  // Sem a lista (game.js de antes, ou app velho): idem.
  sb.SLEEVU = { imgMirrorHosts: ["cards.scryfall.io"] };
  assert.equal(srcset(localizedImg(SCRY, { thumb: true, sizes: "100px" })), `${mirrorImg(SCRY, 300)} 300w, ${mirrorImg(SCRY, 600)} 600w`);
  delete sb.SLEEVU;
});

// Escolha do Chrome: a MENOR candidata com densidade >= DPR (medido em
// 12/11/2026, sem média geométrica). Com o `sizes` do celular em 54vw, o 2x de
// 390 px pede 421 px e pega a 450; o 3x pede 632 e fica na 600.
test("sizes da grade: celular 2x e notebook a 125% pegam a 450; 1x a 300; 3x a 600", () => {
  const larguras = [300, 450, 600];
  const escolhe = (cssPx, dpr) => larguras.find((w) => w / cssPx >= dpr) || larguras[larguras.length - 1];
  const sizesEm = (vw) => {
    for (const parte of SIZES_CARD_TILE.split(",").map((p) => p.trim())) {
      const m = /^\(max-width: (\d+)px\) (\d+)vw$/.exec(parte);
      if (m) { if (vw <= Number(m[1])) return (Number(m[2]) / 100) * vw; continue; }
      return Number(parte.replace("px", ""));
    }
  };
  assert.equal(escolhe(sizesEm(390), 2), 450, "celular 2x");
  assert.equal(escolhe(sizesEm(390), 3), 600, "celular 3x");
  assert.equal(escolhe(sizesEm(390), 1), 300, "celular 1x");
  assert.equal(escolhe(sizesEm(1440), 1), 300, "desktop 100%");
  assert.equal(escolhe(sizesEm(1440), 1.25), 450, "desktop 125%");
  assert.equal(escolhe(sizesEm(1440), 1.5), 450, "desktop 150%");
  assert.equal(escolhe(sizesEm(1440), 2), 600, "desktop 2x");
  // E a imagem escolhida nunca fica menor que o tile real (39,6–41,3vw até 460 px).
  for (const [vw, dpr] of [[390, 2], [390, 3], [460, 2], [360, 2]]) {
    assert.ok(escolhe(sizesEm(vw), dpr) >= 0.413 * vw * dpr * 0.99 || escolhe(sizesEm(vw), dpr) === 600, `${vw}@${dpr}`);
  }
});
