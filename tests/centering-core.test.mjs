// Núcleo de medição do Centering Tool (src/centering-core.js), §10.1 do
// docs/PLANO-CENTERING-V2.md. É aqui que se decide se "esq 57,5" é verdade: a
// homografia, o estimador de aresta sem viés de fase, a reta robusta, o ímã, a
// sugestão das linhas e o "±" honesto, tudo contra fotos SINTÉTICAS de verdade
// conhecida (tests/lib/carta-sintetica.mjs, com a espessura de 0,30 mm).
// O núcleo roda num vm, sem DOM, como roda no navegador. Alvo: ~10 s (os
// casos de sleeve justo e de borda clara, de 2026-10-02, são metade disso).
// Roda com: node --test tests/centering-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { cartaSintetica, degrauSintetico, camera, rng } from "./lib/carta-sintetica.mjs";

const here = dirname(fileURLToPath(import.meta.url));
function carrega() {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(here, "..", "src", "centering-core.js"), "utf8"), sandbox);
  return sandbox.window.TCGCenteringCore;
}
const C = carrega();
// O vm é outro realm: arrays e objetos de lá não passam no deepStrictEqual
// contra literais daqui. JSON resolve.
const js = (x) => JSON.parse(JSON.stringify(x));
const ap = (m, x, y) => { const w = m[6] * x + m[7] * y + m[8]; return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w]; };
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

// Cantos com erro de ±frac da altura da carta, sementes fixas.
function erra(S, frac, seed) {
  const r = rng(seed), e = frac * S.img.h * 0.75;
  return S.cantos.map(([x, y]) => [x + (r() * 2 - 1) * e, y + (r() * 2 - 1) * e]);
}
// O caminho da interface: cantos → refino → linhas sugeridas → medida.
function mede(S, cantos, extra = {}) {
  const rc = C.refinaCantos(S.img, cantos, { janelaPx: 24 });
  const sug = C.sugereLinhas(S.img, rc.cantos);
  const pose = C.poseGraus(rc.cantos, S.img.w, S.img.h, S.focal35);
  const med = C.medir({ ext: sug.ext, int: sug.int }, {
    sigma: sug.sigma, preset: C.PRESETS["63x88"], cantos: rc.cantos, sigmaCantoPx: rc.sigmaPx,
    poseGraus: pose, foto: { w: S.img.w, h: S.img.h, focal35: S.focal35 }, ...extra,
  });
  return { rc, sug, pose, med };
}

// ---------------------------------------------------------------------------
// 1. Homografia
// ---------------------------------------------------------------------------
function dlt(src, dst) { // DLT 8×8 com pivô parcial — só pra conferir a forma fechada
  const A = [], b = [];
  for (let k = 0; k < 4; k++) {
    const [x, y] = src[k], [u, v] = dst[k];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < 8; r++) { const k = A[r][c] / A[c][c]; for (let j = c; j < 8; j++) A[r][j] -= k * A[c][j]; b[r] -= k * b[c]; }
  }
  const x = new Array(8);
  for (let r = 7; r >= 0; r--) { let s = b[r]; for (let j = r + 1; j < 8; j++) s -= A[r][j] * x[j]; x[r] = s / A[r][r]; }
  return [...x, 1];
}

test("homografia: cantos exatos, ida e volta pela inversa e igual ao DLT 8×8", () => {
  const quads = [
    [[412.3, 301.7], [1544.9, 388.2], [1489.1, 2010.4], [355.6, 1950.8]], // perspectiva
    [[100, 100], [700, 100], [700, 940], [100, 940]], // afim (caminho sem g, h)
  ];
  const sq = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const q of quads) {
    const m = C.squareToQuad(q), mi = C.inverte(m), d = dlt(sq, q);
    sq.forEach(([u, v], i) => assert.ok(dist(C.aplica(m, u, v), q[i]) < 1e-9, `canto ${i}`));
    for (const [u, v] of [[0.3, 0.7], [0.5, 0.5], [0.9, 0.1], [0.15, 0.85]]) {
      const p = C.aplica(m, u, v), back = C.aplica(mi, p[0], p[1]);
      assert.ok(Math.abs(back[0] - u) < 1e-12 && Math.abs(back[1] - v) < 1e-12, "ida e volta");
      assert.ok(dist(p, ap(d, u, v)) < 1e-8, "forma fechada = DLT");
    }
  }
});

// ---------------------------------------------------------------------------
// 2. Estimador de aresta sem viés de fase
// ---------------------------------------------------------------------------
test("aresta: |viés| ≤ 0,05 px em toda fase 0,0–0,9, ângulos 0/0,3/2/10° e borrão σ 0,6–3", () => {
  // Degrau amostrado por ÁREA, gama sRGB, 8 bits. Com a fase fixa (ângulo 0)
  // todos os perfis erram igual e nada se anula: é o caso que pegava o
  // travamento de fase do pico+parábola e o bug de 0,7 px da convenção k+½.
  let pior = 0, onde = "";
  for (const angulo of [0, 0.3, 2, 10]) for (const sigma of [0.6, 1, 1.5, 2, 3]) for (let f = 0; f < 10; f++) {
    const d = degrauSintetico({ x0: 36 + f / 10, angulo, sigma });
    // reta inicial meio px fora, como a pessoa soltaria
    const fit = C.interno.retaBorda(d.img, [d.xEm(0) + 0.6, 0], [d.xEm(64) + 0.6, 64], { janelaPx: 8 });
    assert.ok(fit, `sem reta: ${angulo}° σ${sigma} fase ${f / 10}`);
    const y = 32, x = fit.cx - ((y - fit.cy) * fit.ny) / fit.nx;
    const vies = Math.abs((x - d.xEm(y)) * d.normal[0]);
    if (vies > pior) { pior = vies; onde = `${angulo}° σ${sigma} fase ${f / 10}`; }
  }
  assert.ok(pior <= 0.05, `pior viés ${pior.toFixed(4)} px em ${onde}`);
});

// ---------------------------------------------------------------------------
// 3. Reta robusta
// ---------------------------------------------------------------------------
test("reta robusta: 30% de outliers (reflexo) não tiram a reta mais que 0,2 px; semente fixa repete", () => {
  const r = rng(77), xs = [], ys = [];
  // reta x = 500 + 0,02·(y − 800), ruído 0,15 px; 30% dos pontos a 3–25 px
  for (let i = 0; i < 60; i++) {
    const y = 300 + i * 17, fora = i % 10 < 3;
    xs.push(500 + 0.02 * (y - 800) + (fora ? 3 + 22 * r() : 0.15 * (r() * 2 - 1))); ys.push(y);
  }
  const f = C.interno.ajustaReta(xs, ys);
  for (const y of [300, 800, 1300]) {
    const x = f.cx - ((y - f.cy) * f.ny) / f.nx;
    assert.ok(Math.abs(x - (500 + 0.02 * (y - 800))) < 0.2, `em y=${y}: ${x}`);
  }
  assert.equal(f.inl, 42);
  const g = C.interno.ajustaReta(xs, ys);
  assert.deepEqual([g.cx, g.cy, g.nx, g.ny, g.s2], [f.cx, f.cy, f.nx, f.ny, f.s2]);
});

// ---------------------------------------------------------------------------
// 4. Formatação
// ---------------------------------------------------------------------------
test("formatação: 1 casa, soma 100,0 sempre; vírgula em pt/es e ponto em en", () => {
  const r = rng(5);
  for (let i = 0; i < 2000; i++) {
    const p = 100 * r(), [a, b] = js(C.par(p));
    assert.equal(Math.round(a * 10), a * 10);
    assert.equal(Math.round((a + b) * 10) / 10, 100, `${p} → ${a}+${b}`);
    assert.ok(Math.abs(a - p) <= 0.05 + 1e-9);
  }
  assert.deepEqual(js(C.par(57.46)), [57.5, 42.5]);
  assert.deepEqual(js(C.par(55.05)), [55.1, 44.9]); // o binário guarda 55,0499…
  assert.equal(C.arred1(54.95), 55);
  assert.equal(C.fmt(57.5, "pt"), "57,5");
  assert.equal(C.fmt(57.5, "es"), "57,5");
  assert.equal(C.fmt(57.5, "en"), "57.5");
  assert.equal(C.fmt(-0.04, "pt"), "0,0");
  assert.equal(C.fmt(2.345, "pt", 2), "2,35");
});

test("formatação: as entradas degeneradas da v1 (0/0 → 50/50, negativo → 0/100)", () => {
  assert.deepEqual(js(C.par(NaN)), [50, 50]);
  assert.deepEqual(js(C.par(-3)), [0, 100]);
  assert.deepEqual(js(C.par(130)), [100, 0]);
  const L = (c) => ({ c, k: 0 });
  const zero = C.medir({ ext: { l: L(0), r: L(1), t: L(0), b: L(1) }, int: { l: L(0), r: L(1), t: L(0), b: L(1) } });
  assert.equal(zero.lr.meio, 50);
  const neg = C.medir({ ext: { l: L(0), r: L(1), t: L(0), b: L(1) }, int: { l: L(-0.01), r: L(0.95), t: L(0.04), b: L(0.96) } });
  assert.equal(neg.lr.meio, 0);
});

// ---------------------------------------------------------------------------
// 5. Proporção da carta
// ---------------------------------------------------------------------------
test("proporção: 63×88 e 59×86 dão a mesma razão; o giro da moldura sai igual nos dois", () => {
  const ext = { l: { c: 0.002, k: 0.001 }, r: { c: 0.999, k: -0.002 }, t: { c: 0.001, k: 0 }, b: { c: 0.998, k: 0.001 } };
  const int = { l: { c: 0.05, k: 0.004 }, r: { c: 0.955, k: 0.001 }, t: { c: 0.04, k: -0.003 }, b: { c: 0.962, k: 0 } };
  const a = C.medir({ ext, int }, { preset: C.PRESETS["63x88"] }), b = C.medir({ ext, int }, { preset: C.PRESETS["59x86"] });
  for (const ax of ["lr", "tb"]) for (const k of ["meio", "pior", "usado"]) assert.equal(a[ax][k], b[ax][k], `${ax}.${k}`);
  const reto = { l: { c: 0.05, k: 0 }, r: { c: 0.95, k: 0 }, t: { c: 0.04, k: 0 }, b: { c: 0.96, k: 0 } };
  for (const p of [C.PRESETS["63x88"], C.PRESETS["59x86"]]) {
    const g = C.giraMoldura(reto, 1.5, p);
    // ângulo MÉTRICO (horário na tela, y pra baixo): verticais dX/dY = k·W/H =
    // −tan θ; horizontais dY/dX = k·H/W = tan θ
    for (const l of ["l", "r"]) assert.ok(Math.abs((Math.atan(-g[l].k * p.W / p.H) * 180) / Math.PI - 1.5) < 1e-9, `${p.W}×${p.H} ${l}`);
    for (const l of ["t", "b"]) assert.ok(Math.abs((Math.atan(g[l].k * p.H / p.W) * 180) / Math.PI - 1.5) < 1e-9, `${p.W}×${p.H} ${l}`);
    const volta = C.giraMoldura(g, -1.5, p);
    for (const l of ["l", "r", "t", "b"]) assert.ok(Math.abs(volta[l].c - reto[l].c) < 1e-12 && Math.abs(volta[l].k) < 1e-12);
  }
});

// ---------------------------------------------------------------------------
// 6. Fim a fim sintético (800×1066, espessura 0,30 mm)
// ---------------------------------------------------------------------------
test("fim a fim: de frente erra < 0,15 pp a partir de cantos a ±1%", () => {
  const S = cartaSintetica({ seed: 7, roll: 0.7, ss: 2 });
  const { rc, sug, med } = mede(S, erra(S, 0.01, 3));
  assert.ok(rc.ok);
  assert.deepEqual(js(sug.confere), []);
  assert.ok(Math.abs(med.lr.meio - S.verdade.LR) < 0.15, `LR ${med.lr.meio} × ${S.verdade.LR}`);
  assert.ok(Math.abs(med.tb.meio - S.verdade.TB) < 0.15, `TB ${med.tb.meio} × ${S.verdade.TB}`);
  assert.ok(med.lr.sigma >= 0.2 && med.lr.sigma < 0.5, `σ ${med.lr.sigma}`);
});

test("fim a fim: a ~10° de inclinação erra < 0,3 pp", () => {
  const S = cartaSintetica({ seed: 8, pitch: 7, yaw: -7, roll: 3, ss: 2 });
  const { med, pose } = mede(S, erra(S, 0.01, 4));
  assert.ok(Math.abs(pose - S.pose) < 1.5);
  assert.ok(Math.abs(med.lr.meio - S.verdade.LR) < 0.3, `LR ${med.lr.meio} × ${S.verdade.LR}`);
  assert.ok(Math.abs(med.tb.meio - S.verdade.TB) < 0.3, `TB ${med.tb.meio} × ${S.verdade.TB}`);
});

test("fim a fim: a 20° (2×) o viés da espessura aparece do lado perto e fica dentro do ± exibido", () => {
  // 2× (f = 2w): a câmera fica mais longe e enxerga a parede do lado perto. De
  // perto (1×, ~9 cm) ela fica "dentro" da carta e não vê parede nenhuma.
  const S = cartaSintetica({ seed: 9, yaw: -20, roll: 2, f: 1600, ss: 2 });
  const { med } = mede(S, erra(S, 0.01, 5));
  const err = med.lr.meio - S.verdade.LR, prev = med.lr.partes.paralaxe;
  assert.ok(Math.abs(err) <= med.lr.sigma, `erro ${err} × σ ${med.lr.sigma}`);
  assert.ok(prev > 0.2, `paralaxe prevista ${prev}`);
  // a parede aparece à esquerda quando a câmera está à esquerda da carta
  assert.equal(Math.sign(err), S.camera.C[0] < 0 ? 1 : -1);
  assert.ok(Math.abs(err) > 0.3 * prev && Math.abs(err) < 1.3 * prev, `erro ${err} × previsto ${prev}`);
  assert.ok(Math.abs(med.tb.meio - S.verdade.TB) <= med.tb.sigma);
});

// §6.8: o σ da linha posta à mão é POR LINHA (o zoom de quando ela foi posta).
// Com um número só, a última linha ajustada ditava o ± das 8.
test("σ manual por linha: um mapa {ext, int} vale linha a linha; um número segue valendo pras 8", () => {
  const S = cartaSintetica({ seed: 7, w: 400, h: 533, roll: 0.7, ss: 1 });
  const v = S.verdade.mm, R = (c) => ({ c, k: 0 });
  const linhas = { ext: { l: R(0), r: R(1), t: R(0), b: R(1) }, int: { l: R(v.L / 63), r: R(1 - v.R / 63), t: R(v.T / 88), b: R(1 - v.B / 88) } };
  const base = { cantos: S.cantos, sigmaCantoPx: [0.2, 0.2, 0.2, 0.2], poseGraus: 3 };
  const todos = (x) => ({ ext: { l: x, r: x, t: x, b: x }, int: { l: x, r: x, t: x, b: x } });
  const fino = C.medir(linhas, { ...base, sigmaManualPx: todos(0.3) });
  const misto = todos(0.3);
  misto.int.l = 2.5; // posta na visão geral do celular (~4 px da foto por px de tela)
  const comUma = C.medir(linhas, { ...base, sigmaManualPx: misto });
  assert.ok(comUma.lr.sigma > fino.lr.sigma + 0.1, `${comUma.lr.sigma} × ${fino.lr.sigma}`);
  assert.equal(comUma.tb.sigma, fino.tb.sigma, "a linha da esquerda não mexe no T/B");
  // o número: igual ao mapa com o mesmo valor em todas
  assert.equal(C.medir(linhas, { ...base, sigmaManualPx: 0.3 }).lr.sigma, fino.lr.sigma);
  // sem nada (ou linha fora do mapa): 0,5 px, o padrão de sempre
  const sem = C.medir(linhas, base);
  assert.equal(C.medir(linhas, { ...base, sigmaManualPx: { ext: {}, int: {} } }).lr.sigma, sem.lr.sigma);
  assert.equal(C.medir(linhas, { ...base, sigmaManualPx: 0.5 }).lr.sigma, sem.lr.sigma);
});
test("paralaxe: a conta bate com a tabela da §6.8 (50/50, bordas de 2,5 mm, 20°)", () => {
  const w = 3000, h = 4000, f = 3000, focal35 = (f * 43.2666) / Math.hypot(w, h);
  const L = 2.5 / 63, T = 2.5 / 88, R = (c) => ({ c, k: 0 });
  const linhas = { ext: { l: R(0), r: R(1), t: R(0), b: R(1) }, int: { l: R(L), r: R(1 - L), t: R(T), b: R(1 - T) } };
  for (const [D, tabela] of [[150, 50.42], [250, 50.68], [400, 50.83]]) {
    const cam = camera({ w, h, f, D, yaw: 20 });
    const cantos = [ap(cam.H, -31.5, -44), ap(cam.H, 31.5, -44), ap(cam.H, 31.5, 44), ap(cam.H, -31.5, 44)];
    const r = C.medir(linhas, { cantos, foto: { w, h, focal35 } });
    assert.ok(Math.abs(50 + r.lr.partes.paralaxe - tabela) < 0.05, `${D} mm: ${50 + r.lr.partes.paralaxe}`);
  }
  // sem focal: limite ortográfico pelo ângulo (51,07); sem ângulo, o pior caso de 20°
  const o = C.medir(linhas, { poseGraus: 20 }), sem = C.medir(linhas, {});
  assert.ok(Math.abs(50 + o.lr.partes.paralaxe - 51.07) < 0.05);
  assert.equal(sem.lr.partes.paralaxe, o.lr.partes.paralaxe);
});

test("fim a fim: reflexo saturado sobre a borda erra < 0,2 pp", () => {
  const S = cartaSintetica({ seed: 10, pitch: 5, roll: 1, ss: 2, reflexo: { x: 150, y: 520, rad: 28 } });
  const { med } = mede(S, erra(S, 0.01, 6));
  assert.ok(Math.abs(med.lr.meio - S.verdade.LR) < 0.2, `LR ${med.lr.meio} × ${S.verdade.LR}`);
  assert.ok(Math.abs(med.tb.meio - S.verdade.TB) < 0.2, `TB ${med.tb.meio} × ${S.verdade.TB}`);
});

test("fim a fim: borda de 1,5 mm numa foto pequena dispara o aviso de resolução (< 12 px)", () => {
  const S = cartaSintetica({ seed: 11, w: 600, h: 800, roll: 1, ss: 2, L: 1.5, R: 1.5, T: 1.5, B: 1.5 });
  const { med } = mede(S, erra(S, 0.01, 7));
  assert.ok(med.bordaPx < 12, `borda ${med.bordaPx} px`);
  assert.ok(Math.abs(med.lr.meio - 50) < 0.3);
});

test("fim a fim: full art (sem faixa) manda conferir os 4 lados, com a moldura a 4,5%", () => {
  const S = cartaSintetica({ seed: 12, w: 600, h: 800, roll: 1, ss: 2, fullArt: true });
  const sug = C.sugereLinhas(S.img, S.cantos);
  assert.deepEqual(js(sug.confere).sort(), ["b", "l", "r", "t"]);
  assert.ok(Math.abs(sug.int.l.c - sug.ext.l.c - 0.045) < 1e-12);
  assert.equal(sug.sigma.int.l, null);
});

test("toploader: o refino a partir de cantos a ±1% acha o CORTE, não o plástico", () => {
  for (const [seed, top] of [[13, { mx: 3, my: 3 }], [14, { mx: 2, my: 2.5 }], [15, { mx: 1.4, my: 1.1 }]]) {
    const S = cartaSintetica({ seed, w: 600, h: 800, pitch: -6, yaw: 3, roll: -1, ss: 2, toploader: top });
    const rc = C.refinaCantos(S.img, erra(S, 0.01, seed), { janelaPx: 18 });
    assert.ok(rc.ok);
    const e = Math.max(...rc.cantos.map((p, i) => dist(p, S.cantos[i])));
    assert.ok(e < 1, `seed ${seed}: canto a ${e.toFixed(2)} px`);
  }
});

// Sleeve JUSTO (perfect fit, folga de 0,3–0,7 mm): a aresta de dentro do
// plástico se funde com o corte e a de fora fica sem par, parecendo degrau. Até
// 2026-10-02 o refino levava os 4 cantos pro plástico com ok:true (≈ PSA 10
// numa carta PSA 9), a sugestão punha o corte na aresta de fora e, com a borda
// preta, a busca de ±5 px por perfil pulava pra aresta interna do plástico.
// 1200×1600 (~14 px/mm): é a faixa da foto comprimida (WhatsApp) ou da carta
// pequena no quadro, onde a falha aparecia.
test("sleeve justo: o refino, a sugestão e o ímã acham o corte, não o plástico", () => {
  const casos = [
    [{ mx: 0.5, my: 0.5 }, undefined, 0.3],
    [{ mx: 0.5, my: 0.5 }, [245, 245, 240], 0.6], // borda branca: ~0,5 px de ótica no corte
    [{ mx: 0.3, my: 0.3 }, undefined, 0.3],
    [{ mx: 0.7, my: 0.7 }, [30, 30, 30], 0.3], // borda preta: a busca pulava pro plástico
  ];
  for (const [toploader, borda, tolExt] of casos) {
    const S = cartaSintetica({ w: 1200, h: 1600, seed: 41, roll: 0.6, ss: 1, toploader, ...(borda ? { borda } : {}) });
    const rot = `folga ${toploader.mx}${borda ? ` borda ${borda[0]}` : ""}`;
    {
      const { rc, sug, med } = mede(S, erra(S, 0.01, 41));
      assert.ok(rc.ok, `${rot}: refino recusado`);
      const e = Math.max(...rc.cantos.map((p, i) => dist(p, S.cantos[i])));
      assert.ok(e < 1, `${rot}: canto a ${e.toFixed(2)} px`);
      assert.deepEqual(js(sug.confere), [], rot);
      assert.ok(Math.abs(med.lr.meio - S.verdade.LR) < 0.3, `${rot}: LR ${med.lr.meio} × ${S.verdade.LR}`);
      assert.ok(Math.abs(med.tb.meio - S.verdade.TB) < 0.3, `${rot}: TB ${med.tb.meio} × ${S.verdade.TB}`);
    }
    // a partir dos cantos certos: as externas no corte (a busca não pula pra
    // aresta de fora) e o ímã solto EXATAMENTE no corte, com janela de 3 px,
    // não sai dele (saía 4 px, pra fora da própria janela)
    const sug = C.sugereLinhas(S.img, S.cantos), und = { l: 63, r: 63, t: 88, b: 88 };
    for (const l of ["l", "r", "t", "b"]) {
      const u = und[l] * S.pxPorMm, borda0 = l === "l" || l === "t" ? 0 : 1;
      assert.ok(Math.abs(sug.ext[l].c - borda0) * u < tolExt, `${rot} ${l}: externa a ${((sug.ext[l].c - borda0) * u).toFixed(2)} px`);
      const r = C.ima(S.img, S.cantos, { lado: l, tipo: "ext", c: borda0, k: 0 }, { janela: 3 / u });
      assert.ok(r && Math.abs(r.c - borda0) * u < tolExt, `${rot} ${l}: ímã a ${r ? ((r.c - borda0) * u).toFixed(2) : "null"} px`);
    }
  }
});

// §10.1 item 6 ("acha o corte, não o plástico") também fora das configurações
// favoráveis: folga pequena, borda preta e branca. Vale acertar ou recusar
// (ok:false) — nunca um número confiante no plástico.
test("folga pequena a 600×800: o refino acerta o corte ou recusa, nunca o plástico com ok:true", () => {
  const bordas = { amarela: [236, 196, 48], preta: [30, 30, 30], branca: [245, 245, 245] };
  for (const [mx, nomes] of [[0.5, ["amarela", "preta", "branca"]], [0.7, ["amarela"]]]) for (const nome of nomes) {
    const S = cartaSintetica({ seed: 13, w: 600, h: 800, pitch: -6, yaw: 3, roll: -1, ss: 2, toploader: { mx, my: mx }, borda: bordas[nome] });
    const rc = C.refinaCantos(S.img, erra(S, 0.01, 13), { janelaPx: 18 });
    if (!rc.ok) continue; // recusa explícita vale
    const e = Math.max(...rc.cantos.map((p, i) => dist(p, S.cantos[i])));
    assert.ok(e < 1, `folga ${mx} borda ${nome}: canto a ${e.toFixed(2)} px com ok:true`);
  }
});
// ---------------------------------------------------------------------------
// 7. Ímã
// ---------------------------------------------------------------------------
test("ímã: linha solta a ±8 px encaixa a < 0,2 px; sem aresta fica onde foi solta", () => {
  const S = cartaSintetica({ seed: 16, w: 600, h: 800, roll: 0.6, ss: 2 });
  const v = S.verdade.mm, px = S.pxPorMm, mm = { l: 63, r: 63, t: 88, b: 88 };
  const certo = { ext: { l: 0, r: 1, t: 0, b: 1 }, int: { l: v.L / 63, r: 1 - v.R / 63, t: v.T / 88, b: 1 - v.B / 88 } };
  let pior = 0;
  for (const tipo of ["ext", "int"]) for (const lado of ["l", "r", "t", "b"]) for (const d of [-8, 8]) {
    const und = mm[lado] * px;
    const r = C.ima(S.img, S.cantos, { lado, tipo, c: certo[tipo][lado] + d / und, k: 0 }, { janela: 10 / und, ref: tipo === "int" ? certo.ext[lado] : undefined });
    assert.ok(r, `${tipo} ${lado} ${d}`);
    pior = Math.max(pior, Math.abs(r.c - certo[tipo][lado]) * und);
  }
  assert.ok(pior < 0.2, `pior encaixe ${pior.toFixed(3)} px`);
  // no meio da borda lisa, janela que não alcança nem o corte nem a moldura
  const und = 63 * px;
  assert.equal(C.ima(S.img, S.cantos, { lado: "l", tipo: "ext", c: (0.5 * v.L) / 63, k: 0 }, { janela: 4 / und }), null);
});

test("ímã: com corte e sleeve na janela de visão geral, encaixa no corte", () => {
  // 800×1066 (~9 px/mm): a 600×800 a aresta interna do sleeve fica a ~2,5 px
  // do corte e os dois borrões se fundem sem vale — sobra ~0,25 px de viés
  // que é ótica, não escolha errada. Foto de 12 MP tem ~30 px/mm.
  const S = cartaSintetica({ seed: 17, roll: 0.6, ss: 2, toploader: { mx: 0.8, my: 0.8 } });
  const px = S.pxPorMm;
  for (const [lado, und, borda] of [["l", 63 * px, 0], ["t", 88 * px, 0], ["r", 63 * px, 1]]) {
    const s = lado === "r" ? 1 : -1; // solta 6 px pra FORA, do lado do sleeve
    const r = C.ima(S.img, S.cantos, { lado, tipo: "ext", c: borda + (s * 6) / und, k: 0 }, { janela: 30 / und });
    assert.ok(r, lado);
    assert.ok(Math.abs(r.c - borda) * und < 0.2, `${lado}: ${((r.c - borda) * und).toFixed(3)} px`);
  }
});

// O teste acima só passava porque, na borda amarela, o corte tem D maior que a
// aresta do plástico. Com a borda preta o ímã grudava no plástico (3,5 px pra
// fora, com um candidato só) e, com folga de 0,5 mm, na aresta de FORA dele. A
// janela é a da interface: 30% da margem (§5.5). Vale acertar ou não grudar
// (null); a sugestão, acertar ou mandar conferir.
test("ímã e sugestão com sleeve: bordas amarela/preta/branca, folgas 0,5 e 0,8 mm", () => {
  const bordas = { amarela: [236, 196, 48], preta: [30, 30, 30], branca: [245, 245, 245] };
  for (const mx of [0.5, 0.8]) for (const [nome, borda] of Object.entries(bordas)) {
    if (mx === 0.8 && nome === "amarela") continue; // é o teste de cima
    const S = cartaSintetica({ seed: 17, roll: 0.6, ss: 2, toploader: { mx, my: mx }, borda });
    const px = S.pxPorMm, v = S.verdade.mm, sug = C.sugereLinhas(S.img, S.cantos);
    // folga 0,5: ~0,35 px de ótica com o plástico claro colado no corte branco
    const tol = mx < 0.6 ? 0.4 : 0.25;
    for (const [lado, und, borda0, mm] of [["l", 63 * px, 0, v.L], ["t", 88 * px, 0, v.T], ["r", 63 * px, 1, v.R], ["b", 88 * px, 1, v.B]]) {
      const s = lado === "r" || lado === "b" ? 1 : -1, janela = Math.max(4, 0.3 * mm * px);
      const r = C.ima(S.img, S.cantos, { lado, tipo: "ext", c: borda0 + (s * 6) / und, k: 0 }, { janela: janela / und });
      assert.ok(r === null || Math.abs(r.c - borda0) * und < tol, `folga ${mx} ${nome} ${lado}: ímã a ${r && ((r.c - borda0) * und).toFixed(2)} px`);
      assert.ok(Math.abs(sug.ext[lado].c - borda0) * und < 1 || sug.confere.includes(lado), `folga ${mx} ${nome} ${lado}: sugestão a ${((sug.ext[lado].c - borda0) * und).toFixed(2)} px sem "confira"`);
    }
  }
});

// Borda clara com arte clara (One Piece: borda branca, céu quase branco no topo
// da arte, o círculo do custo e o "2000" logo abaixo): a aresta borda→arte é
// FRACA e o "primeiro pico forte" pulava pra 1ª aresta forte de dentro — 7 a
// 16 px de erro, sem "confira" (conferência visual de 2026-10-02). A moldura é
// onde a cor SAI da faixa da borda; o lado vai pro "confira" com o aviso de
// arte clara (fraca).
test("borda clara com arte clara: a moldura é a saída da faixa da borda, não a 1ª aresta forte", () => {
  // borda branca de 2,5 mm, faixa clara de 1 mm logo depois da moldura (a
  // "moldura" do gerador, num azul quase branco) e um elemento escuro forte
  // 2,5–3,5 mm adiante
  const S = cartaSintetica({
    seed: 23, roll: 0.6, ss: 2, L: 2.5, R: 2.8, T: 2.5, B: 2.3,
    borda: [246, 246, 242], moldura: 1, corMoldura: [212, 226, 238], faixas: [{ de: 2.5, ate: 3.5, cor: [30, 22, 26] }],
  });
  const px = S.pxPorMm, v = S.verdade.mm, und = { l: 63 * px, r: 63 * px, t: 88 * px, b: 88 * px };
  const certo = { l: v.L / 63, r: 1 - v.R / 63, t: v.T / 88, b: 1 - v.B / 88 };
  const sug = C.sugereLinhas(S.img, S.cantos);
  for (const l of ["l", "r", "t", "b"]) {
    const e = (sug.int[l].c - certo[l]) * und[l];
    assert.ok(Math.abs(e) < 0.3, `${l}: moldura a ${e.toFixed(2)} px`);
  }
  assert.deepEqual(js(sug.confere).sort(), ["b", "l", "r", "t"], "aresta fraca: confira");
  assert.deepEqual(js(sug.fraca).sort(), ["b", "l", "r", "t"], "o aviso é o de arte clara");
  // o ímã da moldura: solta 4 px pra dentro, janela de 30% da margem (alcança
  // a aresta forte da faixa clara → arte, 1 mm adiante)
  for (const l of ["l", "r", "t", "b"]) {
    const s = l === "l" || l === "t" ? 1 : -1, ref = l === "l" || l === "t" ? 0 : 1;
    const r = C.ima(S.img, S.cantos, { lado: l, tipo: "int", c: certo[l] + (s * 4) / und[l], k: 0 }, { janela: 7 / und[l], ref });
    assert.ok(r && Math.abs(r.c - certo[l]) * und[l] < 0.3, `ímã ${l}: ${r ? ((r.c - certo[l]) * und[l]).toFixed(2) : "null"} px`);
  }
  // fim a fim, a partir de cantos a ±1%
  const { med } = mede(S, erra(S, 0.01, 23));
  assert.ok(Math.abs(med.lr.meio - S.verdade.LR) < 0.15, `LR ${med.lr.meio} × ${S.verdade.LR}`);
  assert.ok(Math.abs(med.tb.meio - S.verdade.TB) < 0.15, `TB ${med.tb.meio} × ${S.verdade.TB}`);
});

// Moldura FINA (0,4 mm ≈ 3,6 px a 800×1066): a busca de ±5 px por perfil levava
// a interna da aresta borda→moldura pra moldura→arte, sem "confira".
test("moldura fina (0,4 mm): a interna fica na aresta borda→moldura", () => {
  const S = cartaSintetica({ seed: 18, roll: 0.6, ss: 2, moldura: 0.4, corMoldura: [200, 200, 200] });
  const px = S.pxPorMm, v = S.verdade.mm, und = { l: 63 * px, r: 63 * px, t: 88 * px, b: 88 * px };
  const certo = { l: v.L / 63, r: 1 - v.R / 63, t: v.T / 88, b: 1 - v.B / 88 };
  const sug = C.sugereLinhas(S.img, S.cantos);
  for (const l of ["l", "r", "t", "b"]) {
    const e = (sug.int[l].c - certo[l]) * und[l];
    assert.ok(Math.abs(e) < 0.3, `${l}: interna a ${e.toFixed(2)} px`);
  }
  assert.deepEqual(js(sug.confere), []);
});

// ---------------------------------------------------------------------------
// 8. Pior ponto × meio
// ---------------------------------------------------------------------------
test("pior ponto: moldura girada 0,4° decide pelo pior; 50/50 com ruído fica no meio", () => {
  const G = cartaSintetica({ seed: 18, w: 600, h: 800, roll: 0.5, alfa: 0.4, L: 3, R: 3, T: 3, B: 3, ss: 2 });
  const g = mede(G, erra(G, 0.01, 8)).med;
  assert.equal(g.lr.decide, "pior");
  assert.equal(g.lr.usado, g.lr.pior);
  assert.ok(Math.abs(g.lr.pior - G.verdade.em(g.lr.tPior).LR) < 0.2, `pior ${g.lr.pior} × ${G.verdade.em(g.lr.tPior).LR}`);
  assert.ok(Math.abs(g.lr.meio - 50) < 0.2);

  const P = cartaSintetica({ seed: 19, w: 600, h: 800, roll: 0.8, L: 3, R: 3, T: 3, B: 3, ruido: 4, ss: 2 });
  const p = mede(P, erra(P, 0.01, 9)).med;
  for (const ax of ["lr", "tb"]) {
    assert.equal(p[ax].decide, "meio", ax);
    // o "compatível com 50/50" decide pelo meio ± max(0,5; 2σ) (§4.6)
    assert.ok(Math.abs(p[ax].usado - 50) <= Math.max(0.5, 2 * p[ax].sigma), `${ax} ${p[ax].usado}`);
  }
});

// ---------------------------------------------------------------------------
// 9 e 10. Determinismo e tempo
// ---------------------------------------------------------------------------
test("determinismo e tempo: mesma foto dá o mesmo número bit a bit; 1200×1600 mede em < 50 ms", () => {
  const S = cartaSintetica({ seed: 20, w: 1200, h: 1600, pitch: 6, roll: 2, ss: 1 });
  const c0 = erra(S, 0.01, 10);
  const a = js(mede(S, c0)), b = js(mede(S, c0));
  assert.deepEqual(a, b);
  const ts = [];
  for (let i = 0; i < 3; i++) { const t0 = performance.now(); mede(S, c0); ts.push(performance.now() - t0); }
  ts.sort((x, y) => x - y);
  assert.ok(ts[1] < 50, `mediana ${ts[1].toFixed(1)} ms`);
  const ti = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    C.ima(S.img, a.rc.cantos, { lado: "l", tipo: "int", c: 0.05, k: 0 }, { janela: 0.01, ref: 0 });
    ti.push(performance.now() - t0);
  }
  ti.sort((x, y) => x - y);
  assert.ok(ti[2] < 3, `ímã ${ti[2].toFixed(2)} ms`);
});

// ---------------------------------------------------------------------------
// 12. Quadrilátero
// ---------------------------------------------------------------------------
test("quadrilátero: gravata, côncavo e perspectiva extrema caem; w nunca cruza zero nos válidos", () => {
  assert.equal(C.quadValido([[100, 100], [500, 120], [480, 700], [90, 680]]), true);
  assert.equal(C.quadValido([[100, 100], [480, 700], [500, 120], [90, 680]]), false, "gravata");
  assert.equal(C.quadValido([[100, 100], [500, 100], [200, 200], [100, 500]]), false, "côncavo");
  assert.equal(C.quadValido([[0, 0], [1000, 0], [520, 40], [480, 40]]), false, "perspectiva extrema");
  assert.equal(C.quadValido([[100, 100], [100, 100], [480, 700], [90, 680]]), false, "degenerado");
  assert.equal(C.quadValido([[100, 100], [90, 680], [480, 700], [500, 120]]), false, "anti-horário");
  const r = rng(21);
  for (let i = 0; i < 200; i++) {
    const cam = camera({ w: 1200, h: 1600, f: 1200, D: 150 + 150 * r(), pitch: 70 * r() - 35, yaw: 70 * r() - 35, roll: 360 * r() });
    const q = [ap(cam.H, -31.5, -44), ap(cam.H, 31.5, -44), ap(cam.H, 31.5, 44), ap(cam.H, -31.5, 44)];
    if (!C.quadValido(q)) continue;
    const m = C.squareToQuad(q);
    for (let u = 0; u <= 1; u += 0.25) for (let v = 0; v <= 1; v += 0.25) assert.ok(m[6] * u + m[7] * v + m[8] > 0);
  }
});

// ---------------------------------------------------------------------------
// 13. Cabeçalho (bytes de fixture montados aqui)
// ---------------------------------------------------------------------------
const B = {
  u16: (v, le) => (le ? [v & 255, (v >> 8) & 255] : [(v >> 8) & 255, v & 255]),
  u32: (v, le) => (le ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255] : [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255]),
  txt: (s) => [...s].map((c) => c.charCodeAt(0)),
};
// pixelX/pixelY (opcionais): o PixelX/YDimension do sub-IFD (0xA002/0xA003),
// o quadro que a câmera gravou — o que denuncia um recorte com o EXIF mantido.
function tiff(le, orient, focal35, pixelX, pixelY) {
  const { u16, u32 } = B;
  const px = pixelX > 0 && pixelY > 0;
  return [
    ...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42, le), ...u32(8, le),
    ...u16(2, le),
    ...u16(0x0112, le), ...u16(3, le), ...u32(1, le), ...u16(orient, le), 0, 0,
    ...u16(0x8769, le), ...u16(4, le), ...u32(1, le), ...u32(38, le),
    ...u32(0, le),
    ...u16(px ? 3 : 1, le),
    ...u16(0xa405, le), ...u16(3, le), ...u32(1, le), ...u16(focal35, le), 0, 0,
    ...(px ? [...u16(0xa002, le), ...u16(4, le), ...u32(1, le), ...u32(pixelX, le),
      ...u16(0xa003, le), ...u16(4, le), ...u32(1, le), ...u32(pixelY, le)] : []),
    ...u32(0, le),
  ];
}
function jpeg({ w, h, le = true, orient = 1, focal35 = 26, exif = true, pixelX = 0, pixelY = 0 }) {
  const out = [0xff, 0xd8];
  if (exif) {
    const t = tiff(le, orient, focal35, pixelX, pixelY), corpo = [...B.txt("Exif"), 0, 0, ...t];
    out.push(0xff, 0xe1, ...B.u16(corpo.length + 2, false), ...corpo);
  }
  out.push(0xff, 0xdb, 0, 4, 0, 0); // DQT de enfeite antes do SOF
  out.push(0xff, 0xc0, 0, 17, 8, ...B.u16(h, false), ...B.u16(w, false), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  out.push(0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0);
  return new Uint8Array(out);
}

test("cabeçalho: JPEG com EXIF (orientação 1–8, focal 35 mm-eq) nas duas ordens de bytes", () => {
  for (const le of [true, false]) for (let o = 1; o <= 8; o++) {
    const r = js(C.lerCabecalho(jpeg({ w: 4032, h: 3024, le, orient: o, focal35: 26 })));
    const [w, h] = o >= 5 ? [3024, 4032] : [4032, 3024];
    assert.deepEqual(r, { tipo: "jpeg", w, h, orientacao: o, focal35: 26 }, `${le ? "II" : "MM"} ${o}`);
  }
  assert.deepEqual(js(C.lerCabecalho(jpeg({ w: 1600, h: 1200, exif: false }))), { tipo: "jpeg", w: 1600, h: 1200, orientacao: 1, focal35: null });
  assert.equal(C.lerCabecalho(jpeg({ w: 1600, h: 1200, focal35: 0 })).focal35, null, "0 = desconhecida");
  const cortado = jpeg({ w: 1600, h: 1200 }).slice(0, 40);
  assert.equal(C.lerCabecalho(cortado).tipo, "jpeg");
});

// Foto RECORTADA no app de fotos com o EXIF da câmera mantido: a focal é do
// quadro inteiro, e a pose a aplicava à diagonal do recorte (20° viravam 10°,
// a paralaxe zerava e o aviso de ângulo sumia). §6.3/§6.4: recortada é
// "ângulo desconhecido" — focal null, e o medir usa o pior caso de 20°.
test("cabeçalho: foto recortada com o EXIF mantido perde a focal (ângulo desconhecido)", () => {
  for (const le of [true, false]) {
    // recorte em volta da carta: o PixelX diz 4032×3024, o SOF 1176×1409
    assert.equal(C.lerCabecalho(jpeg({ w: 1176, h: 1409, le, pixelX: 4032, pixelY: 3024 })).focal35, null, "PixelX antigo");
    // app que reescreve o PixelX junto, ou que nem grava: pela proporção
    assert.equal(C.lerCabecalho(jpeg({ w: 1176, h: 1409, le, pixelX: 1176, pixelY: 1409 })).focal35, null, "PixelX reescrito");
    assert.equal(C.lerCabecalho(jpeg({ w: 1176, h: 1409, le })).focal35, null, "sem PixelX");
    // as fotos inteiras seguem com a focal, inclusive giradas (orientação 6)
    assert.equal(C.lerCabecalho(jpeg({ w: 4032, h: 3024, le, pixelX: 4032, pixelY: 3024 })).focal35, 26);
    assert.equal(C.lerCabecalho(jpeg({ w: 4032, h: 3024, le, orient: 6, pixelX: 4032, pixelY: 3024 })).focal35, 26);
    assert.equal(C.lerCabecalho(jpeg({ w: 3024, h: 4032, le, pixelX: 4032, pixelY: 3024 })).focal35, 26, "eixos trocados no PixelX");
    assert.equal(C.lerCabecalho(jpeg({ w: 4032, h: 2268, le })).focal35, 26, "16:9");
    assert.equal(C.lerCabecalho(jpeg({ w: 3024, h: 3024, le })).focal35, 26, "1:1");
  }
  // sem focal, o medir cai no pior caso de 20° (a paralaxe não zera)
  const R = (c) => ({ c, k: 0 }), L = 2.5 / 63, T = 2.5 / 88;
  const linhas = { ext: { l: R(0), r: R(1), t: R(0), b: R(1) }, int: { l: R(L), r: R(1 - L), t: R(T), b: R(1 - T) } };
  const cantos = [[300, 200], [900, 210], [905, 1050], [295, 1040]];
  const m = C.medir(linhas, { cantos, foto: { w: 1176, h: 1409, focal35: null } });
  assert.ok(Math.abs(m.lr.partes.paralaxe - C.medir(linhas, { poseGraus: 20 }).lr.partes.paralaxe) < 1e-9);
  assert.ok(m.lr.partes.paralaxe > 0.5);
});

test("cabeçalho: PNG (IHDR), WebP (VP8, VP8L, VP8X), HEIC pela assinatura, AVIF e lixo como desconhecidos", () => {
  const { u16, u32, txt } = B;
  const png = new Uint8Array([0x89, ...txt("PNG"), 13, 10, 26, 10, ...u32(13, false), ...txt("IHDR"), ...u32(1170, false), ...u32(2532, false), 8, 6, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(js(C.lerCabecalho(png)), { tipo: "png", w: 1170, h: 2532, orientacao: 1, focal35: null });
  const riff = (chunk, dados) => new Uint8Array([...txt("RIFF"), ...u32(4 + 8 + dados.length, true), ...txt("WEBP"), ...txt(chunk), ...u32(dados.length, true), ...dados]);
  const vp8 = riff("VP8 ", [0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, ...u16(1600, true), ...u16(1200, true), 0, 0]);
  assert.deepEqual(js(C.lerCabecalho(vp8)), { tipo: "webp", w: 1600, h: 1200, orientacao: 1, focal35: null });
  const bits = (1599 | (1199 << 14)) >>> 0;
  assert.deepEqual(js(C.lerCabecalho(riff("VP8L", [0x2f, ...u32(bits, true), 0, 0]))), { tipo: "webp", w: 1600, h: 1200, orientacao: 1, focal35: null });
  const vp8x = riff("VP8X", [0x08, 0, 0, 0, 1599 & 255, 1599 >> 8, 0, 1199 & 255, 1199 >> 8, 0]);
  assert.deepEqual(js(C.lerCabecalho(vp8x)), { tipo: "webp", w: 1600, h: 1200, orientacao: 1, focal35: null });
  const ftyp = (marca, compat) => new Uint8Array([...u32(16 + 4 * compat.length, false), ...txt("ftyp"), ...txt(marca), 0, 0, 0, 0, ...compat.flatMap(txt)]);
  assert.equal(C.lerCabecalho(ftyp("heic", ["mif1", "heic"])).tipo, "heic");
  assert.equal(C.lerCabecalho(ftyp("mif1", ["mif1", "heic"])).tipo, "heic");
  assert.equal(C.lerCabecalho(ftyp("avif", ["mif1", "avif"])).tipo, null);
  assert.deepEqual(js(C.lerCabecalho(new Uint8Array(64).fill(7))), { tipo: null, w: 0, h: 0, orientacao: 1, focal35: null });
  assert.equal(C.lerCabecalho(null).tipo, null);
});

// ---------------------------------------------------------------------------
// 14. Pose
// ---------------------------------------------------------------------------
test("pose: 5°, 10° e 20° saem a ±1,5° com a focal certa; sem focal é desconhecida", () => {
  const w = 4000, h = 3000, f = 3100, focal35 = (f * 43.2666) / Math.hypot(w, h);
  for (const o of [{ pitch: 5 }, { yaw: 10 }, { pitch: 20 }, { pitch: 12, yaw: -15, roll: 30 }, { yaw: 10, tx: 30, ty: -20 }]) {
    const cam = camera({ w, h, f, D: 220, ...o });
    const q = [ap(cam.H, -31.5, -44), ap(cam.H, 31.5, -44), ap(cam.H, 31.5, 44), ap(cam.H, -31.5, 44)];
    const p = C.poseGraus(q, w, h, focal35);
    assert.ok(Math.abs(p - cam.pose) < 1.5, `${JSON.stringify(o)}: ${p} × ${cam.pose}`);
    // canto com erro de ~1 px continua dentro
    const r = rng(3), qe = q.map(([x, y]) => [x + r() - 0.5, y + r() - 0.5]);
    assert.ok(Math.abs(C.poseGraus(qe, w, h, focal35) - cam.pose) < 1.5);
  }
  const cam = camera({ w, h, f, D: 220, pitch: 10 });
  const q = [ap(cam.H, -31.5, -44), ap(cam.H, 31.5, -44), ap(cam.H, 31.5, 44), ap(cam.H, -31.5, 44)];
  assert.equal(C.poseGraus(q, w, h, null), null);
  assert.equal(C.poseGraus(q, w, h, 0), null);
});

// ---------------------------------------------------------------------------
// Pixels: convenção de centro e achatamento
// ---------------------------------------------------------------------------
test("amostra: o centro do pixel k mora em k + ½; achata devolve a carta e deixa transparente fora da foto", () => {
  const w = 4, h = 3, data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 10 * i; data[i * 4 + 1] = 200 - 10 * i; data[i * 4 + 2] = 7; data[i * 4 + 3] = 255; }
  const img = { data, w, h };
  assert.deepEqual(js(C.amostra(img, 2.5, 1.5)), [60, 140, 7]);
  assert.deepEqual(js(C.amostra(img, 2.0, 1.5)), [55, 145, 7]);
  const S = cartaSintetica({ seed: 22, w: 400, h: 533, roll: 1, ss: 1, ruido: 0 });
  const m = C.squareToQuad(S.cantos), out = C.achata(S.img, m, { w: 63, h: 88 });
  assert.equal(out.length, 63 * 88 * 4);
  const p = (44 * 63 + 1) * 4; // 1 mm pra dentro da esquerda, no meio: a borda amarela
  assert.ok(Math.abs(out[p] - 236) < 6 && Math.abs(out[p + 1] - 196) < 6 && Math.abs(out[p + 2] - 48) < 8, js([...out.slice(p, p + 3)]).join());
  const fora = C.achata(S.img, m, { u0: -5, v0: -5, u1: -4, v1: -4, w: 4, h: 4 });
  assert.ok(fora.every((v) => v === 0));
});
