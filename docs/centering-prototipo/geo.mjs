// Geometria pura: homografia quadrado->quad (Heckbert), inversa (adjunta),
// aplicacao, DLT 8x8 (pra comparar), ajuste de reta robusto, pico sub-pixel.
export function squareToQuad(q) { // q: [[x,y]*4] = TL,TR,BR,BL  <- (0,0),(1,0),(1,1),(0,1)
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let a, b, c, d, e, f, g, h;
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) {
    a = x1 - x0; b = x3 - x0; c = x0; d = y1 - y0; e = y3 - y0; f = y0; g = 0; h = 0;
  } else {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den; h = (dx1 * sy - sx * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
  }
  return [a, b, c, d, e, f, g, h, 1];
}
export function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const r = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d];
  return r.map((v) => v / det);
}
export function mul3(m, n) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = m[i * 3] * n[j] + m[i * 3 + 1] * n[3 + j] + m[i * 3 + 2] * n[6 + j];
  return r;
}
export function ap(m, x, y) {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}
// DLT generico 4 pontos (8x8, eliminacao com pivo parcial) — so pra conferir.
export function dlt(src, dst) {
  const A = [], bb = [];
  for (let k = 0; k < 4; k++) {
    const [x, y] = src[k], [u, v] = dst[k];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); bb.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); bb.push(v);
  }
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [bb[c], bb[p]] = [bb[p], bb[c]];
    for (let r = c + 1; r < n; r++) { const k = A[r][c] / A[c][c]; for (let j = c; j < n; j++) A[r][j] -= k * A[c][j]; bb[r] -= k * bb[c]; }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = bb[r]; for (let j = r + 1; j < n; j++) s -= A[r][j] * x[j]; x[r] = s / A[r][r]; }
  return [...x, 1];
}
// pico sub-pixel por parabola em 3 amostras
export function parab(gm, g0, gp) { const den = gm - 2 * g0 + gp; return den === 0 ? 0 : Math.max(-0.5, Math.min(0.5, 0.5 * (gm - gp) / den)); }
// reta robusta: RANSAC (2 pontos) + minimos quadrados totais nos inliers.
// pontos [x,y]; devolve {p:[cx,cy], d:[dx,dy]} (direcao unitaria) e inliers
export function retaRobusta(pts, tol, iters = 120, rnd = Math.random) {
  if (pts.length < 2) return null;
  let melhor = null, nMelhor = -1;
  for (let it = 0; it < iters; it++) {
    const a = pts[(rnd() * pts.length) | 0], b = pts[(rnd() * pts.length) | 0];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    if (L < 1e-9) continue;
    const nx = -dy / L, ny = dx / L;
    let n = 0; for (const p of pts) if (Math.abs((p[0] - a[0]) * nx + (p[1] - a[1]) * ny) < tol) n++;
    if (n > nMelhor) { nMelhor = n; melhor = [a, nx, ny]; }
  }
  const [a, nx, ny] = melhor;
  const inl = pts.filter((p) => Math.abs((p[0] - a[0]) * nx + (p[1] - a[1]) * ny) < tol);
  return { ...tls(inl), inliers: inl.length, total: pts.length };
}
export function tls(pts) {
  let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= pts.length; cy /= pts.length;
  let sxx = 0, sxy = 0, syy = 0; for (const p of pts) { const dx = p[0] - cx, dy = p[1] - cy; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { p: [cx, cy], d: [Math.cos(th), Math.sin(th)] };
}
export function intersec(l1, l2) {
  const [x1, y1] = l1.p, [dx1, dy1] = l1.d, [x2, y2] = l2.p, [dx2, dy2] = l2.d;
  const den = dx1 * dy2 - dy1 * dx2;
  const t = ((x2 - x1) * dy2 - (y2 - y1) * dx2) / den;
  return [x1 + t * dx1, y1 + t * dy1];
}
