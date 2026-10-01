// Pipeline de medicao: refino da borda de corte (perfis 1D perpendiculares +
// pico sub-pixel + RANSAC) e deteccao do miolo impresso no espaco retificado
// (perfis amostrados NA FOTO de resolucao cheia via H, sem reamostrar a imagem).
import { squareToQuad, ap, parab, retaRobusta, intersec, rng } from "./util.mjs";

export function amostra(im, x, y, out) {
  const { w, h, img } = im; x -= 0.5; y -= 0.5; // centro do pixel k mora em k+0,5
  if (x < 0) x = 0; if (y < 0) y = 0; if (x > w - 1.001) x = w - 1.001; if (y > h - 1.001) y = h - 1.001;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
  const k00 = (y0 * w + x0) * 3, k10 = k00 + 3, k01 = k00 + w * 3, k11 = k01 + 3;
  for (let c = 0; c < 3; c++) {
    const a = img[k00 + c] + (img[k10 + c] - img[k00 + c]) * fx, b = img[k01 + c] + (img[k11 + c] - img[k01 + c]) * fx;
    out[c] = a + (b - a) * fy;
  }
}
// gradiente de cor ao longo de um perfil ja amostrado (derivada central em
// distancia 2 amostras, norma euclidiana nos 3 canais)
function gradPerfil(P, n) {
  const G = new Float32Array(n);
  for (let i = 2; i < n - 2; i++) {
    const a = (i - 2) * 3, b = (i + 2) * 3;
    const d0 = P[b] - P[a], d1 = P[b + 1] - P[a + 1], d2 = P[b + 2] - P[a + 2];
    G[i] = Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
  }
  return G;
}

// Refino da borda de corte. cantos TL,TR,BR,BL (px). S = raio de busca (px).
export function refinaCorte(im, cantos, S = 30, N = 48, passo = 0.5, seed = 7) {
  const rnd = rng(seed), c = [0, 0, 0];
  const n = Math.round((2 * S) / passo) + 1, P = new Float32Array(n * 3);
  const retas = [];
  for (let lado = 0; lado < 4; lado++) {
    const A = cantos[lado], B = cantos[(lado + 1) % 4];
    const dx = B[0] - A[0], dy = B[1] - A[1], Ln = Math.hypot(dx, dy);
    const ux = dx / Ln, uy = dy / Ln, nx = uy, ny = -ux; // normal pra FORA (horario, y pra baixo)
    const pts = [];
    for (let k = 0; k < N; k++) {
      const t = 0.12 + 0.76 * k / (N - 1);
      const px = A[0] + dx * t, py = A[1] + dy * t;
      for (let i = 0; i < n; i++) { const s = -S + i * passo; amostra(im, px + nx * s, py + ny * s, c); P[i * 3] = c[0]; P[i * 3 + 1] = c[1]; P[i * 3 + 2] = c[2]; }
      const G = gradPerfil(P, n);
      // Corte = a aresta MAIS DE FORA com forca >= 50% do maximo do perfil
      // (por dentro dela vem a moldura impressa, que tambem e forte).
      let mx = 0; for (let i = 0; i < n; i++) if (G[i] > mx) mx = G[i];
      let best = -1;
      for (let i = n - 3; i >= 2; i--) if (G[i] >= 0.5 * mx && G[i] >= G[i - 1] && G[i] >= G[i + 1]) { best = i; break; }
      if (best < 0) continue;
      const off = parab(G[best - 1], G[best], G[best + 1]);
      const s = -S + (best + off) * passo;
      pts.push([px + nx * s, py + ny * s]);
    }
    retas.push(retaRobusta(pts, 0.8, 150, rnd));
  }
  // cantos = intersecao das retas vizinhas: TL = esq(3) x topo(0) ...
  return [intersec(retas[3], retas[0]), intersec(retas[0], retas[1]), intersec(retas[1], retas[2]), intersec(retas[2], retas[3])];
}

// Miolo impresso: perfis no espaco (u,v) da carta, amostrados na foto via H.
// Devolve as 4 retas internas (u = a + b v pros lados, v = a + b u pro topo/base).
export function detectaMiolo(im, cantos, o = {}) {
  const H = squareToQuad(cantos);
  const largPx = (Math.hypot(cantos[1][0] - cantos[0][0], cantos[1][1] - cantos[0][1]) + Math.hypot(cantos[2][0] - cantos[3][0], cantos[2][1] - cantos[3][1])) / 2;
  const altPx = (Math.hypot(cantos[3][0] - cantos[0][0], cantos[3][1] - cantos[0][1]) + Math.hypot(cantos[2][0] - cantos[1][0], cantos[2][1] - cantos[1][1])) / 2;
  const N = o.N || 41, umax = o.umax || 0.16, rnd = rng(o.seed || 11), c = [0, 0, 0];
  const res = {};
  for (const lado of ["L", "R", "T", "B"]) {
    const horiz = lado === "L" || lado === "R"; // perfil anda em u
    const escala = horiz ? largPx : altPx;          // px por unidade de u (ou v)
    const du = 0.5 / escala, n = Math.ceil(umax / du);
    const P = new Float32Array(n * 3), Gs = [], agg = new Float32Array(n);
    const pos = [];
    for (let k = 0; k < N; k++) {
      const t = 0.15 + 0.7 * k / (N - 1);
      for (let i = 0; i < n; i++) {
        const d = i * du; // distancia a partir da borda de corte, pra dentro
        let u, v;
        if (lado === "L") { u = d; v = t; } else if (lado === "R") { u = 1 - d; v = t; } else if (lado === "T") { u = t; v = d; } else { u = t; v = 1 - d; }
        const [x, y] = ap(H, u, v); amostra(im, x, y, c); P[i * 3] = c[0]; P[i * 3 + 1] = c[1]; P[i * 3 + 2] = c[2];
      }
      const G = gradPerfil(P, n); Gs.push(G); pos.push(t);
      for (let i = 0; i < n; i++) agg[i] += G[i];
    }
    // pula a aresta do corte (primeiros ~6 px) e acha o PRIMEIRO pico forte do agregado
    const i0 = Math.ceil(6 / 0.5);
    let mx = 0; for (let i = i0; i < n; i++) if (agg[i] > mx) mx = agg[i];
    let ip = -1;
    for (let i = i0 + 1; i < n - 1; i++) if (agg[i] >= 0.35 * mx && agg[i] >= agg[i - 1] && agg[i] >= agg[i + 1]) { ip = i; break; }
    // refino por perfil numa janela de +-8 amostras (4 px)
    const pts = [];
    for (let k = 0; k < N; k++) {
      const G = Gs[k]; let b = -1, bv = 0;
      for (let i = Math.max(2, ip - 8); i <= Math.min(n - 3, ip + 8); i++) if (G[i] > bv) { bv = G[i]; b = i; }
      if (b < 0 || bv < 0.3 * mx / N) continue;
      const d = (b + parab(G[b - 1], G[b], G[b + 1])) * du;
      // em px pra tolerancia do RANSAC ser em px
      pts.push([pos[k] * (horiz ? altPx : largPx), d * escala]);
    }
    const reta = retaRobusta(pts.map(([s, d]) => [s, d]), 0.8, 150, rnd);
    // d em funcao de s: d = d0 + (s - p.s) * dy/dx
    const [ps, pd] = reta.p, [ds, dd] = reta.d;
    const meio = (horiz ? altPx : largPx) / 2;
    const dMeio = (pd + (meio - ps) * dd / ds) / escala; // fracao no meio do lado
    const incl = Math.atan2(dd, ds) * 180 / Math.PI;
    res[lado] = { d: dMeio, incl, inliers: reta.inliers, total: reta.total };
  }
  return { res, LR: 100 * res.L.d / (res.L.d + res.R.d), TB: 100 * res.T.d / (res.T.d + res.B.d), largPx, altPx };
}
