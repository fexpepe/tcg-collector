import { sintetica, rng } from "./sint.mjs";
import { detectaGrosso } from "./detecta.mjs";
const deg = Math.PI / 180, w = 1200, h = 1600;
const R = rng(5), U = (a, b) => a + (b - a) * R();
for (let k = 0; k < 5; k++) {
  const fill = U(0.55, 0.85), D = w * 88 / (h * fill);
  const bag = []; for (let i = 0; i < 4; i++) bag.push({ cx: U(0, w), cy: U(0, h), w: U(0.1, 0.5) * w, h: U(0.05, 0.3) * h, ang: U(-0.5, 0.5), cor: [U(20, 240), U(20, 240), U(20, 240)] });
  const o = { w, h, f: w, D, pitch: U(-20, 20) * deg, yaw: U(-20, 20) * deg, roll: U(-12, 12) * deg, tx: U(-5, 5), ty: U(-5, 5), sigma: U(0.6, 1.4), ruido: U(2, 6), seed: 500 + k, L: U(1.5, 4.5), R: U(1.5, 4.5), T: U(1.5, 4.5), B: U(1.5, 4.5), bagunca: bag, ss: 2 };
  if (k !== 1) continue;
  const S = sintetica(o), q = S.cantos;
  const g = detectaGrosso(S, { faixa: true });
  console.log("verdade", q.map(p => p.map(Math.round).join(",")).join(" "));
  g.candidatos.slice(0, 6).forEach((c, i) => console.log(i, c.q.map(p => p.map(Math.round).join(",")).join(" "), "sMed", c.sMed.toFixed(2), "sMin", c.sMin.toFixed(2), "faixa", c.faixa.toFixed(2), "area", Math.round(c.area), c.comp.join(" ")));
}
