import { sintetica, rng } from "./sint.mjs";
import { refinaCorte, detectaMiolo } from "./medir.mjs";
import { ap } from "./geo.mjs";
const deg = Math.PI / 180;
const [w, h, nT, f0, extra] = [+process.argv[2] || 1500, +process.argv[3] || 2000, +process.argv[4] || 20, +process.argv[5] || 0, process.argv[6] || ""];
const R = rng(99);
const U = (a, b) => a + (b - a) * R();
const eLR = [], eTB = [], nLR = [], nTB = [], eC = [], incl = [], tms = [];
let falhas = 0;
for (let k = 0; k < nT; k++) {
  const f = f0 || w;            // ~26 mm equivalente
  const fill = U(0.6, 0.85);    // fracao da ALTURA da foto ocupada pela carta
  const D = f * 88 / (h * fill);
  const o = { w, h, f, D, pitch: U(-20, 20) * deg, yaw: U(-20, 20) * deg, roll: U(-8, 8) * deg, tx: U(-6, 6), ty: U(-6, 6),
    sigma: U(0.6, 1.4), ruido: U(2, 6), seed: 1000 + k, L: U(1.5, 4.5), R: U(1.5, 4.5), T: U(1.5, 4.5), B: U(1.5, 4.5), alfa: U(-0.4, 0.4) * deg, ss: w > 1000 ? 3 : 4 };
  if (extra.includes("k1")) o.k1 = U(-0.03, 0.03);
  if (extra.includes("top")) o.toploader = { mx: U(2, 6), my: U(2, 6) };
  if (extra.includes("refl")) o.reflexo = { x: U(0.2, 0.8) * w, y: U(0.2, 0.8) * h, rad: U(0.02, 0.05) * w };
  const S = sintetica(o);
  const q = S.cantos, pert = 0.012 * h; // erro inicial dos cantos ~1,2% da foto
  let c = q.map(([x, y]) => [x + U(-pert, pert), y + U(-pert, pert)]);
  const t0 = performance.now();
  try {
    c = refinaCorte(S, c, Math.max(12, 2.5 * pert)); c = refinaCorte(S, c, 6);
    const m = detectaMiolo(S, c);
    tms.push(performance.now() - t0);
    eC.push(Math.max(...c.map((p, i) => Math.hypot(p[0] - q[i][0], p[1] - q[i][1]))));
    eLR.push(m.LR - S.verdade.LR); eTB.push(m.TB - S.verdade.TB);
    incl.push(Math.max(...Object.values(m.res).map(r => Math.abs(r.incl))));
  } catch (e) { falhas++; }
  const v = S.verdade, H = S.H, P = (X, Y) => ap(H, X, Y), d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const xs = [P(-31.5, 0), P(-31.5 + v.Lm, 0), P(31.5 - v.Rm, 0), P(31.5, 0)], ys = [P(0, -44), P(0, -44 + v.Tm), P(0, 44 - v.Bm), P(0, 44)];
  nLR.push(100 * d(xs[0], xs[1]) / (d(xs[0], xs[1]) + d(xs[2], xs[3])) - v.LR); nTB.push(100 * d(ys[0], ys[1]) / (d(ys[0], ys[1]) + d(ys[2], ys[3])) - v.TB);
}
const st = (a) => { const s = a.map(Math.abs).sort((x, y) => x - y); return `media ${(s.reduce((p, q) => p + q, 0) / s.length).toFixed(3)} p95 ${s[Math.floor(0.95 * (s.length - 1))].toFixed(3)} max ${s[s.length - 1].toFixed(3)}`; };
console.log(`${w}x${h} n=${nT} ${extra} falhas=${falhas}`);
console.log(" erro LR pp:", st(eLR)); console.log(" erro TB pp:", st(eTB));
console.log(" erro canto px (pior dos 4):", st(eC));
console.log(" ingenuo LR pp:", st(nLR)); console.log(" ingenuo TB pp:", st(nTB));
console.log(" tempo medicao ms:", st(tms));
