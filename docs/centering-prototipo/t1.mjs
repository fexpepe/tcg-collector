import { sintetica } from "./sint.mjs";
import { refinaCorte, detectaMiolo } from "./medir.mjs";
import { squareToQuad, dlt, ap, inv3 } from "./geo.mjs";
const deg = Math.PI / 180;
let t0 = Date.now();
const S = sintetica({ w: 1500, h: 2000, f: 1500, D: 100, pitch: 15 * deg, yaw: -12 * deg, roll: 4 * deg, sigma: 1.0, ruido: 3, seed: 3 });
console.log("render ms", Date.now() - t0, "verdade", S.verdade.LR.toFixed(3), S.verdade.TB.toFixed(3));
console.log("cantos", S.cantos.map(p => p.map(v => v.toFixed(1)).join(",")).join(" | "));
// homografia: fechada x DLT
const q = S.cantos, Hq = squareToQuad(q), Hd = dlt([[0,0],[1,0],[1,1],[0,1]], q);
console.log("dif fechada x DLT", Math.max(...[[0.3,0.7],[0.5,0.5],[0.9,0.1]].map(([u,v]) => { const a = ap(Hq,u,v), b = ap(Hd,u,v); return Math.hypot(a[0]-b[0], a[1]-b[1]); })));
// cantos perturbados +-12 px
const r = () => (Math.random() * 2 - 1) * 12;
let c = q.map(([x, y]) => [x + r(), y + r()]);
t0 = Date.now();
c = refinaCorte(S, c, 30); c = refinaCorte(S, c, 6);
console.log("refino ms", Date.now() - t0, "erro canto px", c.map((p, i) => Math.hypot(p[0] - q[i][0], p[1] - q[i][1]).toFixed(3)).join(" "));
t0 = Date.now();
const m = detectaMiolo(S, c);
console.log("miolo ms", Date.now() - t0, "LR", m.LR.toFixed(3), "TB", m.TB.toFixed(3), "erro pp", (m.LR - S.verdade.LR).toFixed(3), (m.TB - S.verdade.TB).toFixed(3));
console.log(JSON.stringify(m.res));
// ingenuo: medir na foto (pixels) na linha do meio, sem corrigir perspectiva
const H = S.H, W = 63, Hc = 88, v = S.verdade;
const P = (X, Y) => ap(H, X, Y);
const xs = [P(-W/2, 0), P(-W/2 + v.Lm, 0), P(W/2 - v.Rm, 0), P(W/2, 0)];
const d = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1]);
const lrN = 100 * d(xs[0], xs[1]) / (d(xs[0], xs[1]) + d(xs[2], xs[3]));
const ys = [P(0, -Hc/2), P(0, -Hc/2 + v.Tm), P(0, Hc/2 - v.Bm), P(0, Hc/2)];
const tbN = 100 * d(ys[0], ys[1]) / (d(ys[0], ys[1]) + d(ys[2], ys[3]));
console.log("ingenuo LR", lrN.toFixed(2), "TB", tbN.toFixed(2), "erro pp", (lrN - v.LR).toFixed(2), (tbN - v.TB).toFixed(2));
