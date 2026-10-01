import { sintetica, rng } from "./sint.mjs";
import { refinaCorte, detectaMiolo } from "./medir.mjs";
import { detectaGrosso } from "./detecta.mjs";
import { rotula } from "./rotula.mjs";
const deg = Math.PI / 180;
const [w, h, nT, extra] = [+process.argv[2] || 1200, +process.argv[3] || 1600, +process.argv[4] || 20, process.argv[5] || ""];
const R = rng(+process.argv[6] || 5), U = (a, b) => a + (b - a) * R();
let okCanto = 0, okMed = 0, semQuad = 0; const tT = [], errs = [];
for (let k = 0; k < nT; k++) {
  const fill = U(0.55, 0.85), D = w * 88 / (h * fill);
  const bag = []; for (let i = 0; i < 4; i++) bag.push({ cx: U(0, w), cy: U(0, h), w: U(0.1, 0.5) * w, h: U(0.05, 0.3) * h, ang: U(-0.5, 0.5), cor: [U(20, 240), U(20, 240), U(20, 240)] });
  const o = { w, h, f: w, D, pitch: U(-20, 20) * deg, yaw: U(-20, 20) * deg, roll: U(-12, 12) * deg, tx: U(-5, 5), ty: U(-5, 5), sigma: U(0.6, 1.4), ruido: U(2, 6), seed: 500 + k,
    L: U(1.5, 4.5), R: U(1.5, 4.5), T: U(1.5, 4.5), B: U(1.5, 4.5), bagunca: extra.includes("bag") ? bag : null, ss: 2 };
  if (extra.includes("top")) o.toploader = { mx: U(2, 5), my: U(2, 5) };
  if (extra.includes("refl")) o.reflexo = { x: U(0.3, 0.7) * w, y: U(0.3, 0.7) * h, rad: U(0.02, 0.05) * w };
  const S = sintetica(o), q = S.cantos;
  const t0 = performance.now();
  const g = detectaGrosso(S);
  if (!g.candidatos.length) { semQuad++; errs.push("semquad"); continue; }
  let r = null; for (const cq of g.candidatos.slice(0, +process.env.K || 1)) { const rr = rotula(S, cq.q); if (rr && rr.cantos && (!r || rr.melhor.nOk > r.melhor.nOk || (rr.melhor.nOk === r.melhor.nOk && rr.melhor.unifSum < r.melhor.unifSum))) r = rr; }
  if (!r || !r.cantos) { errs.push("semrotulo"); continue; }
  let c = refinaCorte(S, r.cantos, 6);
  const m = detectaMiolo(S, c);
  tT.push(performance.now() - t0);
  const eC = Math.max(...c.map((p, i) => Math.hypot(p[0] - q[i][0], p[1] - q[i][1])));
  const e = Math.max(Math.abs(m.LR - S.verdade.LR), Math.abs(m.TB - S.verdade.TB));
  if (eC < 2) okCanto++; if (e < 0.5) okMed++;
  errs.push(e.toFixed(2));
}
const s = [...tT].sort((a, b) => a - b);
console.log(`${w}x${h} n=${nT} [${extra}] cantos<2px ${okCanto}/${nT}  medicao<0,5pp ${okMed}/${nT}  sem quad ${semQuad}  tempo total ms mediana ${s[s.length >> 1].toFixed(0)} max ${s[s.length - 1].toFixed(0)}\n  erros: ${errs.join(" ")}`);
