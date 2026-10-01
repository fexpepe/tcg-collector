// Modelo de 8 linhas no espaco retificado: externa (corte) E interna (miolo)
// medidas nos mesmos perfis. Testa a sensibilidade a erro de canto SEM refino.
import { sintetica, rng } from "./sint.mjs";
import { amostra } from "./medir.mjs";
import { squareToQuad, ap, parab, retaRobusta } from "./geo.mjs";
const deg = Math.PI / 180;
function oito(im, cantos, aplicaExterna) {
  const H = squareToQuad(cantos), c = [0, 0, 0], rnd = rng(1);
  const largPx = Math.hypot(cantos[1][0] - cantos[0][0], cantos[1][1] - cantos[0][1]), altPx = Math.hypot(cantos[3][0] - cantos[0][0], cantos[3][1] - cantos[0][1]);
  const out = {};
  for (const lado of ["L", "R", "T", "B"]) {
    const horiz = lado === "L" || lado === "R", esc = horiz ? largPx : altPx, du = 0.5 / esc, d0 = -0.03, n = Math.ceil((0.16 - d0) / du);
    const ext = [], int = [];
    for (let k = 0; k < 41; k++) {
      const t = 0.15 + 0.7 * k / 40, P = new Float32Array(n * 3), G = new Float32Array(n);
      for (let i = 0; i < n; i++) { const d = d0 + i * du; const [u, v] = lado === "L" ? [d, t] : lado === "R" ? [1 - d, t] : lado === "T" ? [t, d] : [t, 1 - d]; amostra(im, ...ap(H, u, v), c); P.set(c, i * 3); }
      for (let i = 2; i < n - 2; i++) G[i] = Math.hypot(P[(i + 2) * 3] - P[(i - 2) * 3], P[(i + 2) * 3 + 1] - P[(i - 2) * 3 + 1], P[(i + 2) * 3 + 2] - P[(i - 2) * 3 + 2]);
      // externa: pico mais forte em [-3%, +1%]; interna: 1o pico forte depois dela + 6 px
      let be = -1, bv = 0; const iz = Math.round(-d0 / du), j1 = Math.round((0.01 - d0) / du);
      for (let i = 3; i < j1; i++) if (G[i] > bv) { bv = G[i]; be = i; }
      let mx = 0; for (let i = be + 12; i < n - 3; i++) mx = Math.max(mx, G[i]);
      let bi = -1; for (let i = be + 12; i < n - 3; i++) if (G[i] >= 0.5 * mx && G[i] >= G[i - 1] && G[i] >= G[i + 1]) { bi = i; break; }
      const sub = (b) => d0 + (b + parab(G[b - 1], G[b], G[b + 1])) * du;
      ext.push([t * (horiz ? altPx : largPx), sub(be) * esc]); int.push([t * (horiz ? altPx : largPx), sub(bi) * esc]);
    }
    const at = (pts) => { const r = retaRobusta(pts, 0.8, 120, rnd); const m = (horiz ? altPx : largPx) / 2; return (r.p[1] + (m - r.p[0]) * r.d[1] / r.d[0]) / esc; };
    out[lado] = at(int) - (aplicaExterna ? at(ext) : 0);
  }
  return { LR: 100 * out.L / (out.L + out.R), TB: 100 * out.T / (out.T + out.B) };
}
const R = rng(42), U = (a, b) => a + (b - a) * R(), G = () => Math.sqrt(-2 * Math.log(R() + 1e-12)) * Math.cos(2 * Math.PI * R());
const res = { 1: [[], []], 3: [[], []], 6: [[], []], 12: [[], []] };
for (let k = 0; k < 10; k++) {
  const S = sintetica({ w: 1200, h: 1600, f: 1200, D: 1200 * 88 / (1600 * U(0.6, 0.85)), pitch: U(-20, 20) * deg, yaw: U(-20, 20) * deg, roll: U(-8, 8) * deg, sigma: 1, ruido: 3, seed: k + 70, L: U(1.5, 4.5), R: U(1.5, 4.5), T: U(1.5, 4.5), B: U(1.5, 4.5), ss: 2 });
  for (const sg of [1, 3, 6, 12]) {
    const c = S.cantos.map(([x, y]) => [x + sg * G(), y + sg * G()]);
    const a = oito(S, c, false), b = oito(S, c, true);
    res[sg][0].push(Math.max(Math.abs(a.LR - S.verdade.LR), Math.abs(a.TB - S.verdade.TB)));
    res[sg][1].push(Math.max(Math.abs(b.LR - S.verdade.LR), Math.abs(b.TB - S.verdade.TB)));
  }
}
const md = (a) => (a.reduce((x, y) => x + y) / a.length).toFixed(2) + " (max " + Math.max(...a).toFixed(2) + ")";
for (const sg of [1, 3, 6, 12]) console.log(`canto com erro sigma=${sg}px (carta ~1000 px): externa = borda do quad -> ${md(res[sg][0])} pp | externa MEDIDA (8 linhas) -> ${md(res[sg][1])} pp`);
