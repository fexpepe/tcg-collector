// Deteccao GROSSA da carta (sem ML, sem OpenCV): reduz a ~480 px, gradiente de
// cor (Sobel por canal, canal mais forte), Hough (1 grau x 1 px) com supressao
// de nao-maximos, monta quadrilateros com 2 retas de cada familia e pontua
// pelo suporte de borda ao longo do perimetro. Devolve candidatos ordenados.
import { intersec, squareToQuad, ap } from "./geo.mjs";

export function reduz(im, maxLado = 480) {
  const s = Math.max(1, Math.max(im.w, im.h) / maxLado), w = Math.floor(im.w / s), h = Math.floor(im.h / s);
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = [0, 0, 0], n = 0;
    const x0 = Math.floor(x * s), x1 = Math.floor((x + 1) * s), y0 = Math.floor(y * s), y1 = Math.floor((y + 1) * s);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const k = (yy * im.w + xx) * 3; a[0] += im.img[k]; a[1] += im.img[k + 1]; a[2] += im.img[k + 2]; n++; }
    const k = (y * w + x) * 3; out[k] = a[0] / n; out[k + 1] = a[1] / n; out[k + 2] = a[2] / n;
  }
  return { w, h, img: out, s };
}

function gradiente(r) {
  const { w, h, img } = r, mag = new Float32Array(w * h), gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    let best = -1, bx = 0, by = 0;
    for (let c = 0; c < 3; c++) {
      const p = (dx, dy) => img[((y + dy) * w + x + dx) * 3 + c];
      const sx = (p(1, -1) + 2 * p(1, 0) + p(1, 1)) - (p(-1, -1) + 2 * p(-1, 0) + p(-1, 1));
      const sy = (p(-1, 1) + 2 * p(0, 1) + p(1, 1)) - (p(-1, -1) + 2 * p(0, -1) + p(1, -1));
      const m = sx * sx + sy * sy; if (m > best) { best = m; bx = sx; by = sy; }
    }
    const k = y * w + x; mag[k] = Math.sqrt(best); gx[k] = bx; gy[k] = by;
  }
  return { mag, gx, gy };
}

export function detectaGrosso(im, o = {}) {
  const r = reduz(im, o.maxLado || 480), { w, h } = r, { mag, gx, gy } = gradiente(r);
  // limiar: percentil 90 da magnitude
  const ord = Float32Array.from(mag).sort(), lim = Math.max(20, ord[Math.floor(0.9 * ord.length)]);
  const NT = 180, diag = Math.ceil(Math.hypot(w, h)), NR = 2 * diag + 1, acc = new Float32Array(NT * NR);
  const cs = [], sn = []; for (let t = 0; t < NT; t++) { cs.push(Math.cos(t * Math.PI / NT)); sn.push(Math.sin(t * Math.PI / NT)); }
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const k = y * w + x; if (mag[k] < lim) continue;
    // vota so nos angulos perto da normal do gradiente (+-6 graus): 15x mais rapido e menos lixo
    let th = Math.atan2(gy[k], gx[k]); if (th < 0) th += Math.PI; const t0 = Math.round(th / Math.PI * NT);
    for (let dt = -6; dt <= 6; dt++) { const t = (t0 + dt + NT) % NT; const rho = Math.round(x * cs[t] + y * sn[t]) + diag; acc[t * NR + rho] += mag[k]; }
  }
  // picos com supressao de nao-maximos (+-4 graus, +-6 px)
  const picos = [];
  for (let t = 0; t < NT; t++) for (let p = 0; p < NR; p++) {
    const v = acc[t * NR + p]; if (v <= 0) continue;
    let ok = true;
    for (let dt = -4; dt <= 4 && ok; dt++) for (let dp = -6; dp <= 6; dp++) {
      if (!dt && !dp) continue; let tt = t + dt, pp = p + dp;
      if (tt < 0) { tt += NT; pp = 2 * diag - pp; } else if (tt >= NT) { tt -= NT; pp = 2 * diag - pp; }
      if (pp < 0 || pp >= NR) continue;
      if (acc[tt * NR + pp] > v) { ok = false; break; }
    }
    if (ok) picos.push({ t, rho: p - diag, v });
  }
  picos.sort((a, b) => b.v - a.v);
  const top = picos.slice(0, o.nRetas || 16).map((q) => {
    const th = q.t * Math.PI / NT, c = Math.cos(th), s = Math.sin(th);
    return { th, p: [c * q.rho, s * q.rho], d: [-s, c], v: q.v };
  });
  // familias: ~vertical (|th| perto de 0/180) e ~horizontal (th perto de 90)
  const ehVert = (l) => { const a = l.th * 180 / Math.PI; return a < 35 || a > 145; };
  const ehHor = (l) => { const a = l.th * 180 / Math.PI; return a > 55 && a < 125; };
  const V = top.filter(ehVert), Hz = top.filter(ehHor);
  const suporte = (A, B) => { // fracao de amostras no segmento com gradiente forte e normal alinhada
    const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L; let ok = 0, n = 0;
    for (let i = 0; i <= 40; i++) {
      const t = 0.1 + 0.8 * i / 40, x = Math.round(A[0] + dx * t), y = Math.round(A[1] + dy * t); n++;
      let bom = false;
      for (let s = -1; s <= 1 && !bom; s++) { const xx = Math.round(x + nx * s), yy = Math.round(y + ny * s); if (xx < 1 || yy < 1 || xx >= w - 1 || yy >= h - 1) continue; const k = yy * w + xx; if (mag[k] >= lim && Math.abs(gx[k] * nx + gy[k] * ny) > 0.85 * mag[k]) bom = true; }
      if (bom) ok++;
    }
    return ok / n;
  };
  const cand = [];
  for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) for (let a = 0; a < Hz.length; a++) for (let b = a + 1; b < Hz.length; b++) {
    let [l1, l2] = [V[i], V[j]], [t1, t2] = [Hz[a], Hz[b]];
    // ordena: esquerda/direita pela posicao no meio da imagem, topo/base idem
    const xAt = (l) => intersec(l, { p: [0, h / 2], d: [1, 0] })[0], yAt = (l) => intersec(l, { p: [w / 2, 0], d: [0, 1] })[1];
    if (xAt(l1) > xAt(l2)) [l1, l2] = [l2, l1]; if (yAt(t1) > yAt(t2)) [t1, t2] = [t2, t1];
    const q = [intersec(l1, t1), intersec(l2, t1), intersec(l2, t2), intersec(l1, t2)];
    if (q.some(([x, y]) => !isFinite(x) || x < -0.05 * w || y < -0.05 * h || x > 1.05 * w || y > 1.05 * h)) continue;
    let area = 0; for (let k = 0; k < 4; k++) { const [x1, y1] = q[k], [x2, y2] = q[(k + 1) % 4]; area += x1 * y2 - x2 * y1; } area = Math.abs(area) / 2;
    if (area < 0.12 * w * h) continue;
    const lado = (m, n2) => Math.hypot(q[m][0] - q[n2][0], q[m][1] - q[n2][1]);
    const larg = (lado(0, 1) + lado(3, 2)) / 2, alt = (lado(0, 3) + lado(1, 2)) / 2, asp = Math.min(larg, alt) / Math.max(larg, alt);
    if (asp < 0.5 || asp > 0.92) continue;
    const sup = [suporte(q[0], q[1]), suporte(q[1], q[2]), suporte(q[2], q[3]), suporte(q[3], q[0])];
    const sMin = Math.min(...sup), sMed = sup.reduce((x, y) => x + y) / 4;
    if (sMin < 0.5) continue;
    cand.push({ q: q.map(([x, y]) => [x * r.s, y * r.s]), area, sMed, sMin });
  }
  // Escolha: entre os bem suportados (sMed >= 85% do melhor), o de MAIOR area
  // (o miolo impresso e um retangulo forte tambem, mas aninhado por dentro).
  // Os outros ficam como candidatos pra pessoa alternar (toploader/sleeve/miolo).
  if (!cand.length) return { candidatos: [] };
  if (o.faixa) {
    // Pista da BORDA IMPRESSA: logo por dentro do corte vem uma faixa de cor
    // uniforme e IGUAL nos 4 lados (amarelo Pokemon, preto Magic...); logo por
    // fora vem o fundo, que e outra cor. Clutter retangular nao tem isso.
    const H = (qq) => squareToQuad(qq.map(([x, y]) => [x / r.s, y / r.s]));
    const cor = (x, y) => { const xx = Math.min(w - 1, Math.max(0, Math.round(x))), yy = Math.min(h - 1, Math.max(0, Math.round(y))), k = (yy * w + xx) * 3; return [r.img[k], r.img[k + 1], r.img[k + 2]]; };
    for (const c of cand) {
      const Hq = H(c.q), med = [], difs = [];
      let varTot = 0;
      for (let lado = 0; lado < 4; lado++) {
        const dentro = [], fora = [];
        for (let i = 0; i < 20; i++) {
          const t = 0.15 + 0.7 * i / 19;
          const uv = (d) => lado === 0 ? [t, d] : lado === 1 ? [1 - d, t] : lado === 2 ? [t, 1 - d] : [d, t];
          dentro.push(cor(...ap(Hq, ...uv(0.012)))); fora.push(cor(...ap(Hq, ...uv(-0.015))));
        }
        const m = [0, 1, 2].map((ch) => dentro.map((p) => p[ch]).sort((a, b) => a - b)[10]);
        const mf = [0, 1, 2].map((ch) => fora.map((p) => p[ch]).sort((a, b) => a - b)[10]);
        varTot += dentro.reduce((s, p) => s + Math.hypot(p[0] - m[0], p[1] - m[1], p[2] - m[2]), 0) / 20;
        med.push(m); difs.push(Math.hypot(m[0] - mf[0], m[1] - mf[1], m[2] - mf[2]));
      }
      let entre = 0; for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) entre += Math.hypot(med[a][0] - med[b][0], med[a][1] - med[b][1], med[a][2] - med[b][2]);
      // 0..1: faixa uniforme, igual nos 4 lados e diferente do lado de fora
      c.comp = [(varTot/4).toFixed(1), (entre/6).toFixed(1), Math.min(...difs).toFixed(1), JSON.stringify(med.map(m=>m.map(Math.round)))];
      c.faixa = Math.exp(-(varTot / 4) / 25) * Math.exp(-(entre / 6) / 30) * Math.min(1, Math.min(...difs) / 40);
      c.score = c.sMed + c.faixa;
    }
    cand.sort((a, b) => b.score - a.score || b.area - a.area);
    const uniq = [];
    for (const c of cand) if (!uniq.some((u) => u.q.every((p, k) => Math.hypot(p[0] - c.q[k][0], p[1] - c.q[k][1]) < 0.015 * Math.max(im.w, im.h)))) uniq.push(c);
    return { candidatos: uniq, nRetas: top.length };
  }
  const melhor = Math.max(...cand.map((c) => c.sMed));
  const bons = cand.filter((c) => c.sMed >= 0.85 * melhor).sort((a, b) => b.area - a.area);
  // remove duplicados (cantos a < 1,5% da foto)
  const uniq = [];
  for (const c of bons) if (!uniq.some((u) => u.q.every((p, k) => Math.hypot(p[0] - c.q[k][0], p[1] - c.q[k][1]) < 0.015 * Math.max(im.w, im.h)))) uniq.push(c);
  return { candidatos: uniq, nRetas: top.length };
}
