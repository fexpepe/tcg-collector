import { squareToQuad } from "./geo.mjs";
// Amostragem inversa bilinear: para cada pixel (i,j) da saida, (u,v) = ((i+.5)/W, (j+.5)/H)
// -> foto via H (numeradores/denominador incrementais: 1 divisao por pixel).
export function achata(src, sw, sh, H, W, Hh, out, pad = 0) {
  const [a, b, c, d, e, f, g, h] = H;
  for (let j = 0; j < Hh; j++) {
    const v = ((j + 0.5) / Hh) * (1 + 2 * pad) - pad;
    const u0 = (0.5 / W) * (1 + 2 * pad) - pad, du = (1 + 2 * pad) / W;
    let X = a * u0 + b * v + c, Y = d * u0 + e * v + f, Z = g * u0 + h * v + 1;
    const dX = a * du, dY = d * du, dZ = g * du;
    let o = j * W * 4;
    for (let i = 0; i < W; i++, X += dX, Y += dY, Z += dZ, o += 4) {
      let x = X / Z - 0.5, y = Y / Z - 0.5;
      if (x < 0 || y < 0 || x >= sw - 1 || y >= sh - 1) { out[o] = out[o + 1] = out[o + 2] = 0; out[o + 3] = 255; continue; }
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
      const k = (y0 * sw + x0) * 4, k2 = k + sw * 4;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      out[o] = src[k] * w00 + src[k + 4] * w10 + src[k2] * w01 + src[k2 + 4] * w11;
      out[o + 1] = src[k + 1] * w00 + src[k + 5] * w10 + src[k2 + 1] * w01 + src[k2 + 5] * w11;
      out[o + 2] = src[k + 2] * w00 + src[k + 6] * w10 + src[k2 + 2] * w01 + src[k2 + 6] * w11;
      out[o + 3] = 255;
    }
  }
}
const sw = 4032, sh = 3024, src = new Uint8ClampedArray(sw * sh * 4);
for (let i = 0; i < src.length; i++) src[i] = (i * 2654435761) >>> 24;
const H = squareToQuad([[900, 300], [3100, 420], [3000, 2800], [1000, 2700]]);
for (const [W, Hh] of [[1000, 1397], [2000, 2794]]) {
  const out = new Uint8ClampedArray(W * Hh * 4);
  achata(src, sw, sh, H, W, Hh, out); // aquece o JIT
  const t0 = performance.now(); for (let r = 0; r < 3; r++) achata(src, sw, sh, H, W, Hh, out, 0.04);
  const ms = (performance.now() - t0) / 3;
  console.log(`achatar ${W}x${Hh} (${(W * Hh / 1e6).toFixed(2)} MP): ${ms.toFixed(1)} ms  (${(ms * 1e6 / (W * Hh)).toFixed(1)} ns/px)`);
}
