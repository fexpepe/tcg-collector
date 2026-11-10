// ACHAR A CARTA NO QUADRO (acharCarta, src/scan.js, 2026-11-10). Até aqui o
// scanner nunca soube onde a carta estava: tudo era fração da moldura-guia.
// O detector acha as quatro bordas por retas, sem biblioteca, numa amostra de
// ~150 px, e serve a duas coisas MEDIDAS na bancada (139 cartas reais):
//
//   - a foto como verificador: com a carta endireitada entre as assinaturas
//     do quadro, a semelhança da carta CERTA sobe de 0,59-0,98 pra 0,72-1,00
//     na foto simulada, e a da errada não mexe (0,44);
//   - o disparo automático: sem carta achada, o laço espera mais antes de
//     gastar uma leitura numa mesa vazia.
//
// O que NÃO entrou, e por quê: recortar o OCR relativo à carta. No
// laboratório isso leu 34 códigos contra 35 do recorte pela moldura — o
// limite ali é o Tesseract em texto miúdo, não o lugar da faixa.
//
// As fotos são sintéticas, de verdade conhecida (tests/lib/carta-sintetica.mjs,
// a mesma do Centering Tool): carta menor que o quadro, girada, com a câmera
// inclinada, borda clara ou escura, sobre a "mesa" com veios.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { cartaSintetica, rng } from "./lib/carta-sintetica.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scanSrc = readFileSync(join(here, "..", "src", "scan.js"), "utf8");
function load() {
  const sandbox = {
    console,
    document: { querySelector: () => null, getElementById: () => null },
    location: { origin: "https://sleevu.app" }
  };
  sandbox.window = sandbox;
  sandbox.window.TCGShared = { t: (k) => k, escapeHtml: String, escapeAttribute: String };
  vm.createContext(sandbox);
  vm.runInContext(scanSrc, sandbox);
  return sandbox.window.TCGScan;
}
const S = load();
const W = 150, H = 210;
const BORDAS = [[236, 196, 48], [30, 30, 34], [240, 240, 240], [40, 70, 150]]; // amarela, preta, branca, azul

// Erro do detector: o pior canto, em fração da largura do quadro.
function erro(o) {
  const c = cartaSintetica(Object.assign({ w: W, h: H, ss: 2 }, o));
  const r = S.acharCarta(S.cinzaDe(c.img.data), W, H, 0.24);
  if (!r) return null;
  return { e: Math.max(...r.cantos.map((p, k) => Math.hypot(p[0] - c.cantos[k][0], p[1] - c.cantos[k][1]))) / W, r };
}

test("acha a carta de frente, com os cantos no lugar e o giro certo", () => {
  for (const borda of BORDAS) {
    const x = erro({ ocupa: 0.86, roll: 0, borda, seed: 5 });
    assert.ok(x, `borda ${borda}: não achou`);
    assert.ok(x.e < 0.045, `borda ${borda}: erro de ${(x.e * 100).toFixed(1)} % da largura`);
    assert.ok(Math.abs(x.r.angulo) < 1.5);
  }
  // Girada: o ângulo acompanha (horário positivo), e os cantos também.
  for (const roll of [-5, -2.5, 2.5, 5]) {
    const x = erro({ ocupa: 0.84, roll, borda: BORDAS[0], seed: 9 });
    assert.ok(x, `giro ${roll}: não achou`);
    assert.ok(Math.abs(x.r.angulo - roll) <= 1.5, `giro ${roll}: achou ${x.r.angulo.toFixed(1)}°`);
    assert.ok(x.e < 0.045, `giro ${roll}: erro de ${(x.e * 100).toFixed(1)} %`);
  }
});

test("carta menor, deslocada, torta e com a câmera inclinada: acha quase sempre, e perto", () => {
  // O que o scanner vê de verdade: a carta ENTRE as duas molduras. 20 fotos
  // sorteadas (semente fixa). A régua é a que os usos toleram: a assinatura
  // compara também com a grade de recortes, e 5 % de erro é a moldura
  // impressa no lugar da borda — o erro típico quando a borda da carta quase
  // não contrasta com a mesa. (20 fotos, e não mais: gerar foto sintética é
  // caro, os arquivos de teste rodam em paralelo, e o teste de TEMPO do
  // Centering falhava no CI com a máquina ocupada por este.)
  const R = rng(7), U = (a, b) => a + (b - a) * R();
  const erros = [];
  let nulos = 0;
  for (let i = 0; i < 20; i++) {
    const x = erro({
      ocupa: U(0.76, 0.93), roll: U(-6, 6), pitch: U(-4, 4), yaw: U(-4, 4), tx: U(-2, 2), ty: U(-2, 2),
      sigma: U(0.4, 1.2), ruido: U(1, 5), seed: 100 + i, borda: BORDAS[i % 4]
    });
    if (x) erros.push(x.e); else nulos++;
  }
  erros.sort((a, b) => a - b);
  assert.ok(nulos <= 1, `${nulos} de 20 sem carta achada`);
  assert.ok(erros[erros.length >> 1] < 0.03, `mediana de ${(erros[erros.length >> 1] * 100).toFixed(1)} %`);
  assert.ok(erros.filter((e) => e <= 0.07).length >= 18, `só ${erros.filter((e) => e <= 0.07).length} de 20 a até 7 %`);
});

test("sem carta, não inventa uma: mesa vazia, quadro liso, retângulo de outra proporção", () => {
  // Mesa com veios e ruído.
  const R = rng(3);
  const mesa = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) mesa[y * W + x] = 110 + 25 * Math.sin(x * 0.07 + y * 0.013) + 12 * Math.sin(y * 0.31) + (R() - 0.5) * 10;
  assert.equal(S.acharCarta(mesa, W, H, 0.24), null);
  assert.equal(S.acharCarta(new Uint8Array(W * H).fill(128), W, H, 0.24), null);
  // Um quadrado claro no meio (um porta-copos, a tela de outro celular):
  // tem quatro bordas retas, mas não a proporção de carta.
  const quadrado = new Uint8Array(W * H).fill(60);
  for (let y = 40; y < 170; y++) for (let x = 10; x < 140; x++) quadrado[y * W + x] = 220;
  assert.equal(S.acharCarta(quadrado, W, H, 0.24), null);
  // Entrada pequena demais ou vazia não derruba.
  assert.equal(S.acharCarta(null, W, H), null);
  assert.equal(S.acharCarta(new Uint8Array(100), 10, 10), null);
});

test("prefere a BORDA da carta à moldura impressa dela, que contrasta mais", () => {
  // Borda preta na mesa média: a linha mais forte é a de dentro (preto
  // contra o miolo claro). A geometria escolhe o retângulo de fora.
  const c = cartaSintetica({ w: W, h: H, ss: 2, ocupa: 0.84, borda: [30, 30, 34], seed: 21 });
  const r = S.acharCarta(S.cinzaDe(c.img.data), W, H, 0.24);
  assert.ok(r);
  const larg = Math.hypot(r.cantos[1][0] - r.cantos[0][0], r.cantos[1][1] - r.cantos[0][1]);
  const real = Math.hypot(c.cantos[1][0] - c.cantos[0][0], c.cantos[1][1] - c.cantos[0][1]);
  assert.ok(larg > real * 0.97, `achou ${larg.toFixed(1)} px de largura; a carta tem ${real.toFixed(1)}`);
});

test("o disparo automático espera mais quando não há carta no quadro", () => {
  const parada = { movimento: 1, contraste: 40, brilho: 120 };
  const roda = (m, n) => { let st = { armado: true, parados: 0 }, i = 0; for (; i < n; i++) { const r = S.passoAuto(st, m); st = r.st; if (r.disparar) return i + 1; } return 0; };
  // Com carta (ou sem o campo, como antes): na terceira amostra parada.
  assert.equal(roda(Object.assign({ carta: true }, parada), 40), S.AUTO.quadros);
  assert.equal(roda(parada, 40), S.AUTO.quadros);
  // Sem carta achada: só depois de `semCarta` amostras — e sai, não fica mudo.
  assert.equal(roda(Object.assign({ carta: false }, parada), 40), S.AUTO.semCarta);
  assert.ok(S.AUTO.semCarta > S.AUTO.quadros);
  // No scanner: a carta é procurada com o laço armado e entra nas assinaturas da foto.
  assert.match(scanSrc, /m\.carta = !!acharCarta\(cinzaDe\(ctxCarta\.getImageData\(0, 0, 96, 132\)\.data\), 96, 132, 0\.22\);/);
  assert.match(scanSrc, /const carta = cartaNoQuadro\(fonte, rec\);[\s\S]{0,120}?const fotos = fotosDoQuadro\(fonte, rec, carta\);/);
});
