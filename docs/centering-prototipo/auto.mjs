import { sintetica, rng } from "./sint.mjs";
import { refinaCorte, detectaMiolo } from "./medir.mjs";
import { detectaGrosso } from "./detecta.mjs";
const deg = Math.PI / 180;
const [w, h, nT, extra] = [+process.argv[2] || 1200, +process.argv[3] || 1600, +process.argv[4] || 20, process.argv[5] || ""];
const R = rng(+process.argv[6] || 5), U = (a, b) => a + (b - a) * R();
let ok = 0, okMed = 0, tDet = [], err = [], pos = [];
for (let k = 0; k < nT; k++) {
  const fill = U(0.55, 0.85), D = w * 88 / (h * fill);
  const bag = [];
  for (let i = 0; i < 4; i++) bag.push({ cx: U(0, w), cy: U(0, h), w: U(0.1, 0.5) * w, h: U(0.05, 0.3) * h, ang: U(-0.5, 0.5), cor: [U(20, 240), U(20, 240), U(20, 240)] });
  const o = { w, h, f: w, D, pitch: U(-20, 20) * deg, yaw: U(-20, 20) * deg, roll: U(-12, 12) * deg, tx: U(-5, 5), ty: U(-5, 5), sigma: U(0.6, 1.4), ruido: U(2, 6), seed: 500 + k,
    L: U(1.5, 4.5), R: U(1.5, 4.5), T: U(1.5, 4.5), B: U(1.5, 4.5), bagunca: extra.includes("bag") ? bag : null, ss: 2 };
  if (extra.includes("top")) o.toploader = { mx: U(2, 5), my: U(2, 5) };
  const S = sintetica(o), q = S.cantos;
  const t0 = performance.now();
  const g = detectaGrosso(S, { faixa: extra.includes("faixa"), nRetas: extra.includes("n24") ? 24 : 16 });
  tDet.push(performance.now() - t0);
  // posicao do candidato certo na lista (cantos a < 2% da foto)
  const idx = g.candidatos.findIndex((c) => c.q.every((p, i) => Math.hypot(p[0] - q[i][0], p[1] - q[i][1]) < 0.02 * h));
  pos.push(idx);
  if (idx === 0) ok++;
  if (idx >= 0) {
    let c = g.candidatos[idx].q; c = refinaCorte(S, c, 0.03 * h); c = refinaCorte(S, c, 6);
    const m = detectaMiolo(S, c), e = Math.max(Math.abs(m.LR - S.verdade.LR), Math.abs(m.TB - S.verdade.TB));
    err.push(e); if (e < 0.5) okMed++;
  }
}
const st = (a) => { const s = [...a].sort((x, y) => x - y); return `mediana ${s[Math.floor(s.length / 2)].toFixed(1)} max ${s[s.length - 1].toFixed(1)}`; };
console.log(`${w}x${h} n=${nT} ${extra}: carta certa em 1o lugar ${ok}/${nT}; posicoes ${JSON.stringify(pos)}; medicao <0,5pp ${okMed}/${err.length}; tempo deteccao ms ${st(tDet)}`);
