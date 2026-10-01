// Gerador de foto SINTETICA de carta: camera pinhole + homografia exata,
// supersampling 3x3 (antialias), blur gaussiano, ruido, distorcao radial,
// reflexo, toploader. Devolve a imagem RGB Float32 e a VERDADE (cantos, margens).
import { inv3, ap } from "./geo.mjs";

export function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }

export function camera({ w, h, f, D, pitch = 0, yaw = 0, roll = 0, tx = 0, ty = 0 }) {
  const cx = Math.cos(pitch), sx = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw), cz = Math.cos(roll), sz = Math.sin(roll);
  // R = Rz * Ry * Rx
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx], Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy], Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  const m = (A, B) => { const r = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]); return r; };
  const R = m(Rz, m(Ry, Rx));
  // H = K [r1 r2 t]
  const M = [R[0], R[1], tx, R[3], R[4], ty, R[6], R[7], D];
  const K = [f, 0, w / 2, 0, f, h / 2, 0, 0, 1];
  return m(K, M); // card mm (X,Y) -> image px
}

export function sintetica(o) {
  const r = rng(o.seed || 1);
  const W = 63, Hc = 88, rc = o.raio ?? 3;
  const { w, h } = o;
  const L = o.L ?? 3.2, R = o.R ?? 2.6, T = o.T ?? 3.0, B = o.B ?? 3.4, alfa = o.alfa ?? 0;
  const Hm = camera(o), Hi = inv3(Hm);
  const k1 = o.k1 || 0, half = Math.hypot(w, h) / 2;
  const ca = Math.cos(alfa), sa = Math.sin(alfa);
  const borda = o.borda || [236, 196, 48];
  const top = o.toploader; // {mx,my} folga em mm alem da carta
  function cor(X, Y, px, py, out) {
    // fundo: textura em pixels (madeira/mesa) + listras
    const fundo = () => { const v = 110 + 25 * Math.sin(px * 0.021 + Math.sin(py * 0.013) * 3) + 12 * Math.sin(py * 0.11); out[0] = v * 0.95; out[1] = v * 0.85; out[2] = v * 0.7;
      if (o.bagunca) for (const b of o.bagunca) { const dx = px - b.cx, dy = py - b.cy, ca2 = Math.cos(b.ang), sa2 = Math.sin(b.ang); if (Math.abs(dx * ca2 + dy * sa2) < b.w / 2 && Math.abs(-dx * sa2 + dy * ca2) < b.h / 2) { out[0] = b.cor[0]; out[1] = b.cor[1]; out[2] = b.cor[2]; } } };
    const ax = Math.abs(X), ay = Math.abs(Y);
    let dentro = ax <= W / 2 && ay <= Hc / 2;
    if (dentro && ax > W / 2 - rc && ay > Hc / 2 - rc) dentro = Math.hypot(ax - (W / 2 - rc), ay - (Hc / 2 - rc)) <= rc;
    if (!dentro) {
      fundo();
      if (top) { // toploader: plastico um pouco mais claro + aresta brilhante de 0,4 mm
        const tx = W / 2 + top.mx, ty = Hc / 2 + top.my;
        if (ax <= tx && ay <= ty) { out[0] += 18; out[1] += 18; out[2] += 22; if (ax > tx - 0.4 || ay > ty - 0.4) { out[0] += 60; out[1] += 60; out[2] += 60; } }
      }
      return;
    }
    const Xr = ca * X + sa * Y, Yr = -sa * X + ca * Y; // miolo girado alfa
    if (Xr >= -W / 2 + L && Xr <= W / 2 - R && Yr >= -Hc / 2 + T && Yr <= Hc / 2 - B) {
      // moldura colorida de 1,5 mm e arte texturizada por dentro
      const dIn = Math.min(Xr - (-W / 2 + L), (W / 2 - R) - Xr, Yr - (-Hc / 2 + T), (Hc / 2 - B) - Yr);
      if (dIn < 1.5) { out[0] = 170; out[1] = 172; out[2] = 180; return; }
      out[0] = 90 + 70 * Math.sin(X * 0.9) * Math.cos(Y * 0.6); out[1] = 110 + 60 * Math.sin(Y * 1.3 + X * 0.2); out[2] = 140 + 50 * Math.cos(X * 0.4 - Y * 0.7);
      return;
    }
    out[0] = borda[0]; out[1] = borda[1]; out[2] = borda[2];
  }
  const img = new Float32Array(w * h * 3), c = [0, 0, 0];
  const ss = o.ss || 3;
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    let a0 = 0, a1 = 0, a2 = 0;
    for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
      let x = px + (i + 0.5) / ss, y = py + (j + 0.5) / ss;
      if (k1) { const dx = x - w / 2, dy = y - h / 2, rr = (dx * dx + dy * dy) / (half * half); x = w / 2 + dx * (1 + k1 * rr); y = h / 2 + dy * (1 + k1 * rr); }
      const [X, Y] = ap(Hi, x, y);
      cor(X, Y, x, y, c); a0 += c[0]; a1 += c[1]; a2 += c[2];
    }
    const k = (py * w + px) * 3, n = ss * ss; img[k] = a0 / n; img[k + 1] = a1 / n; img[k + 2] = a2 / n;
  }
  if (o.sigma) blur(img, w, h, o.sigma);
  if (o.reflexo) { const { x, y, rad } = o.reflexo; for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) { const g = Math.exp(-((px - x) ** 2 + (py - y) ** 2) / (2 * rad * rad)) * 260; const k = (py * w + px) * 3; img[k] += g; img[k + 1] += g; img[k + 2] += g; } }
  const ns = o.ruido ?? 3;
  for (let k = 0; k < img.length; k++) img[k] = Math.max(0, Math.min(255, Math.round(img[k] + ns * gauss(r))));
  // verdade
  const canto = (X, Y) => { let [x, y] = ap(Hm, X, Y); return [x, y]; };
  const Lm = (-W / 2 + L) / ca + W / 2, Rm = W / 2 - (W / 2 - R) / ca, Tm = (-Hc / 2 + T) / ca + Hc / 2, Bm = Hc / 2 - (Hc / 2 - B) / ca;
  return {
    w, h, img, H: Hm,
    cantos: [canto(-W / 2, -Hc / 2), canto(W / 2, -Hc / 2), canto(W / 2, Hc / 2), canto(-W / 2, Hc / 2)],
    verdade: { LR: 100 * Lm / (Lm + Rm), TB: 100 * Tm / (Tm + Bm), Lm, Rm, Tm, Bm },
  };
}

function blur(img, w, h, s) {
  const rad = Math.ceil(3 * s), k = []; let sum = 0;
  for (let i = -rad; i <= rad; i++) { const v = Math.exp(-i * i / (2 * s * s)); k.push(v); sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(img.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { let a = 0; for (let i = -rad; i <= rad; i++) { const xx = Math.min(w - 1, Math.max(0, x + i)); a += k[i + rad] * img[(y * w + xx) * 3 + c]; } tmp[(y * w + x) * 3 + c] = a; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { let a = 0; for (let i = -rad; i <= rad; i++) { const yy = Math.min(h - 1, Math.max(0, y + i)); a += k[i + rad] * tmp[(yy * w + x) * 3 + c]; } img[(y * w + x) * 3 + c] = a; }
}
