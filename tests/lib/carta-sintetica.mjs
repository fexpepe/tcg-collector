// Foto SINTÉTICA de carta pro Centering Tool (2026-10-01), portada do
// protótipo docs/centering-prototipo/sint.mjs com o que ele não tinha:
//
// - ESPESSURA: a carta é um bloco de 0,30 mm (configurável por jogo). Com a
//   câmera inclinada, a parede do lado mais perto aparece por fora do corte,
//   na cor do miolo do papelão — é o viés de paralaxe da §6.8, que a
//   homografia (do plano da face) não corrige;
// - LUZ LINEAR: antialias e borrão acontecem em intensidade linear e só no fim
//   a imagem vira sRGB de 8 bits, como numa câmera. O protótipo borrava em
//   sRGB, o que esconde (e inverte) o viés de gama do estimador.
//
// Câmera pinhole: H = K·[r1 r2 t] leva a carta (mm, origem no centro) à foto;
// a face de trás (Z = espessura) usa K·[r1 r2 t + e·r3]. Não termina em
// .test.mjs, então o glob do CI não o roda sozinho.

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

export const linear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
export const srgb = (l) => (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055) * 255;
const lin3 = (c) => c.map(linear);

function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C;
  return [A, c * h - b * i, b * f - c * e, B, a * i - c * g, c * d - a * f, C, b * g - a * h, a * e - b * d].map((v) => v / det);
}
const ap = (m, x, y) => { const w = m[6] * x + m[7] * y + m[8]; return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w]; };
const mul = (A, B) => { const r = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]); return r; };
const deg = Math.PI / 180;

// R = Rz(roll)·Ry(yaw)·Rx(pitch), ângulos em GRAUS; t = (tx, ty, D) em mm.
export function camera({ w, h, f, D, pitch = 0, yaw = 0, roll = 0, tx = 0, ty = 0 }) {
  const cx = Math.cos(pitch * deg), sx = Math.sin(pitch * deg), cy = Math.cos(yaw * deg), sy = Math.sin(yaw * deg), cz = Math.cos(roll * deg), sz = Math.sin(roll * deg);
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx], Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy], Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  const R = mul(Rz, mul(Ry, Rx)), t = [tx, ty, D], K = [f, 0, w / 2, 0, f, h / 2, 0, 0, 1];
  const Hz = (e) => mul(K, [R[0], R[1], t[0] + e * R[2], R[3], R[4], t[1] + e * R[5], R[6], R[7], t[2] + e * R[8]]);
  const r3 = [R[2], R[5], R[8]];
  // câmera no referencial da carta (centro): C = −Rᵀ·t
  const C = [0, 1, 2].map((j) => -(R[j] * t[0] + R[3 + j] * t[1] + R[6 + j] * t[2]));
  const nt = Math.sqrt(t[0] * t[0] + t[1] * t[1] + t[2] * t[2]);
  const pose = Math.acos(Math.abs(r3[0] * t[0] + r3[1] * t[1] + r3[2] * t[2]) / nt) / deg;
  return { K, R, t, H: Hz(0), Hz, C, pose };
}

// Opções (todas com padrão): w, h (px); f (px, padrão = w ≈ 26 mm-eq em 4:3);
// D (mm) ou ocupa (fração da altura da foto tomada pela carta, 0,75);
// pitch/yaw/roll (graus); tx/ty (mm); W/H (mm, 63×88); raio (3 mm);
// L/R/T/B (margens em mm); alfa (graus, giro da arte impressa); moldura (mm);
// fullArt; espessura (mm, 0,30); corParede/borda/corMoldura (sRGB);
// toploader {mx, my} (folga em mm, serve de sleeve com folga pequena);
// faixas [{de, ate, cor}] (faixas da ARTE, em mm pra dentro da moldura impressa:
// a borda clara com arte clara da One Piece, com o elemento escuro adiante);
// reflexo {x, y, rad} (px); k1 (distorção radial); sigma (borrão, px);
// ruido (σ em níveis de 8 bits); ss (supersample por eixo); seed.
export function cartaSintetica(o = {}) {
  const w = o.w || 800, h = o.h || 1066, f = o.f || w;
  const W = o.W || 63, Hc = o.H || 88, rc = o.raio ?? 3;
  const D = o.D || (f * Hc) / (h * (o.ocupa || 0.75));
  const cam = camera({ w, h, f, D, pitch: o.pitch || 0, yaw: o.yaw || 0, roll: o.roll || 0, tx: o.tx || 0, ty: o.ty || 0 });
  const esp = o.espessura ?? 0.3;
  const Hi = inv3(cam.H), Hb = inv3(cam.Hz(esp));
  const L = o.L ?? 3.2, R = o.R ?? 2.6, T = o.T ?? 3.0, B = o.B ?? 3.4, alfa = (o.alfa || 0) * deg, mold = o.moldura ?? 1.5;
  const ca = Math.cos(alfa), sa = Math.sin(alfa);
  const cBorda = lin3(o.borda || [236, 196, 48]), cMold = lin3(o.corMoldura || [170, 172, 180]), cPar = lin3(o.corParede || [218, 214, 202]);
  const faixas = (o.faixas || []).map((f) => ({ de: f.de, ate: f.ate, cor: lin3(f.cor) }));
  const top = o.toploader, k1 = o.k1 || 0, half = Math.sqrt(w * w + h * h) / 2, ss = o.ss || 3;
  const dentroCarta = (X, Y) => {
    const ax = Math.abs(X), ay = Math.abs(Y);
    if (ax > W / 2 || ay > Hc / 2) return false;
    if (ax > W / 2 - rc && ay > Hc / 2 - rc) { const dx = ax - (W / 2 - rc), dy = ay - (Hc / 2 - rc); return dx * dx + dy * dy <= rc * rc; }
    return true;
  };
  // Supersample ESTRATIFICADO com jitter (padrão): numa grade fixa 2×2, uma
  // aresta alinhada ao eixo só tem 3 níveis de cobertura e a "verdade" da
  // imagem anda até ¼ px — o erro seria do gerador, não do estimador.
  const img = new Float32Array(w * h * 3), c = [0, 0, 0], fundo = [0, 0, 0], jit = o.jitter === false ? null : rng((o.seed || 1) * 7919 + 13);
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = Hi, [b0, b1, b2, b3, b4, b5, b6, b7, b8] = Hb;
  for (let py = 0; py < h; py++) {
    const fase = Math.sin((py + 0.5) * 0.013) * 3, faixa = 12 * Math.sin((py + 0.5) * 0.11);
    for (let px = 0; px < w; px++) {
    // fundo (mesa/madeira), em linear, avaliado uma vez por pixel
    const v = (110 + 25 * Math.sin((px + 0.5) * 0.021 + fase) + faixa) / 255;
    fundo[0] = (v * 0.95) ** 2; fundo[1] = (v * 0.85) ** 2; fundo[2] = (v * 0.7) ** 2;
    if (o.bagunca) for (const bb of o.bagunca) {
      const dx = px - bb.cx, dy = py - bb.cy, c2 = Math.cos(bb.ang), s2 = Math.sin(bb.ang);
      if (Math.abs(dx * c2 + dy * s2) < bb.w / 2 && Math.abs(-dx * s2 + dy * c2) < bb.h / 2) { const l = lin3(bb.cor); fundo[0] = l[0]; fundo[1] = l[1]; fundo[2] = l[2]; }
    }
    let a0 = 0, a1 = 0, a2 = 0;
    for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
      let x = px + (i + (jit ? jit() : 0.5)) / ss, y = py + (j + (jit ? jit() : 0.5)) / ss;
      if (k1) { const dx = x - w / 2, dy = y - h / 2, rr = (dx * dx + dy * dy) / (half * half); x = w / 2 + dx * (1 + k1 * rr); y = h / 2 + dy * (1 + k1 * rr); }
      const iw = 1 / (h6 * x + h7 * y + h8), X = (h0 * x + h1 * y + h2) * iw, Y = (h3 * x + h4 * y + h5) * iw;
      if (dentroCarta(X, Y)) {
        const Xr = ca * X + sa * Y, Yr = -sa * X + ca * Y;
        const dentro = o.fullArt || (Xr >= -W / 2 + L && Xr <= W / 2 - R && Yr >= -Hc / 2 + T && Yr <= Hc / 2 - B);
        if (dentro) {
          const dIn = o.fullArt ? 99 : Math.min(Xr - (-W / 2 + L), W / 2 - R - Xr, Yr - (-Hc / 2 + T), Hc / 2 - B - Yr);
          const fx = faixas.length ? faixas.find((f) => dIn >= f.de && dIn < f.ate) : null;
          if (dIn < mold) { c[0] = cMold[0]; c[1] = cMold[1]; c[2] = cMold[2]; }
          else if (fx) { c[0] = fx.cor[0]; c[1] = fx.cor[1]; c[2] = fx.cor[2]; }
          else {
            const q0 = (90 + 70 * Math.sin(X * 0.9) * Math.cos(Y * 0.6)) / 255, q1 = (110 + 60 * Math.sin(Y * 1.3 + X * 0.2)) / 255, q2 = (140 + 50 * Math.cos(X * 0.4 - Y * 0.7)) / 255;
            c[0] = q0 * q0; c[1] = q1 * q1; c[2] = q2 * q2;
          }
        } else { c[0] = cBorda[0]; c[1] = cBorda[1]; c[2] = cBorda[2]; }
      } else {
        // Fora da face: a parede da carta, se o raio a cruza antes de chegar
        // no plano de trás (só acontece do lado perto da câmera).
        const ib = 1 / (b6 * x + b7 * y + b8);
        if (esp > 0 && dentroCarta((b0 * x + b1 * y + b2) * ib, (b3 * x + b4 * y + b5) * ib)) { c[0] = cPar[0]; c[1] = cPar[1]; c[2] = cPar[2]; }
        else {
          c[0] = fundo[0]; c[1] = fundo[1]; c[2] = fundo[2];
          if (top) {
            const ax = Math.abs(X), ay = Math.abs(Y), tx = W / 2 + top.mx, ty = Hc / 2 + top.my;
            if (ax <= tx && ay <= ty) {
              const borda = ax > tx - 0.4 || ay > ty - 0.4;
              for (let k = 0; k < 3; k++) { const s = srgb(c[k]) + 18 + (borda ? 60 : 0); c[k] = linear(Math.min(255, s)); }
            }
          }
        }
      }
      a0 += c[0]; a1 += c[1]; a2 += c[2];
    }
    const k = (py * w + px) * 3, n = ss * ss;
    img[k] = a0 / n; img[k + 1] = a1 / n; img[k + 2] = a2 / n;
    }
  }
  if (o.sigma ?? 1) blur(img, w, h, o.sigma ?? 1);
  if (o.reflexo) {
    const { x, y, rad } = o.reflexo;
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const g = 1.3 * Math.exp(-((px + 0.5 - x) ** 2 + (py + 0.5 - y) ** 2) / (2 * rad * rad));
      if (g > 1e-4) { const k = (py * w + px) * 3; img[k] += g; img[k + 1] += g; img[k + 2] += g; }
    }
  }
  const r = rng(o.seed || 1), ns = o.ruido ?? 2, data = new Uint8ClampedArray(w * h * 4);
  let par = 0, temPar = false; // Box–Muller dá dois normais por sorteio
  const normal = () => {
    if (temPar) { temPar = false; return par; }
    const a = Math.sqrt(-2 * Math.log(r() + 1e-12)), t = 2 * Math.PI * r();
    par = a * Math.sin(t); temPar = true;
    return a * Math.cos(t);
  };
  for (let p = 0, q = 0; p < w * h; p++, q += 3) {
    for (let k = 0; k < 3; k++) data[p * 4 + k] = Math.round(codifica(img[q + k]) + (ns ? ns * normal() : 0));
    data[p * 4 + 3] = 255;
  }
  // Verdade: margens da arte girada alfa, na FACE (a espessura não muda a
  // carta, só o que a foto mostra). LR em função de v, TB em função de u.
  const mL = (Y) => (-W / 2 + L - sa * Y) / ca + W / 2, mR = (Y) => W / 2 - (W / 2 - R - sa * Y) / ca;
  const mT = (X) => (-Hc / 2 + T + sa * X) / ca + Hc / 2, mB = (X) => Hc / 2 - (Hc / 2 - B + sa * X) / ca;
  const em = (t) => {
    const Y = (t - 0.5) * Hc, X = (t - 0.5) * W;
    return { LR: (100 * mL(Y)) / (mL(Y) + mR(Y)), TB: (100 * mT(X)) / (mT(X) + mB(X)) };
  };
  const canto = (X, Y) => ap(cam.H, X, Y);
  return {
    img: { data, w, h },
    cantos: [canto(-W / 2, -Hc / 2), canto(W / 2, -Hc / 2), canto(W / 2, Hc / 2), canto(-W / 2, Hc / 2)],
    verdade: { ...em(0.5), em, mm: { L: mL(0), R: mR(0), T: mT(0), B: mB(0) } },
    H: cam.H,
    focal35: (f * 43.2666) / Math.sqrt(w * w + h * h),
    pose: cam.pose,
    camera: { C: [cam.C[0] + W / 2, cam.C[1] + Hc / 2, cam.C[2]] }, // origem no TL, como o núcleo
    pxPorMm: h * (o.ocupa || 0.75) / Hc,
  };
}

// linear → sRGB 0..255 por tabela de 16.385 pontos com interpolação: erro
// < 0,001 nível (o pow por canal por pixel era metade do tempo do gerador).
const TAB = new Float64Array(16385);
for (let i = 0; i <= 16384; i++) TAB[i] = srgb(i / 16384);
function codifica(l) {
  if (!(l > 0)) return 0;
  if (l >= 1) return 255;
  const x = l * 16384, i = Math.floor(x);
  return TAB[i] + (TAB[i + 1] - TAB[i]) * (x - i);
}

function blur(img, w, h, s) {
  const rad = Math.ceil(3 * s), k = [];
  let sum = 0;
  for (let i = -rad; i <= rad; i++) { const v = Math.exp((-i * i) / (2 * s * s)); k.push(v); sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(img.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let a = 0;
    for (let i = -rad; i <= rad; i++) { const xx = Math.min(w - 1, Math.max(0, x + i)); a += k[i + rad] * img[(y * w + xx) * 3 + c]; }
    tmp[(y * w + x) * 3 + c] = a;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let a = 0;
    for (let i = -rad; i <= rad; i++) { const yy = Math.min(h - 1, Math.max(0, y + i)); a += k[i + rad] * tmp[(yy * w + x) * 3 + c]; }
    img[(y * w + x) * 3 + c] = a;
  }
}

// ---------------------------------------------------------------------------
// Degrau reto pro teste de FASE do estimador (§10.1, item 2): uma aresta só,
// borrada por gaussiana σ em luz linear, amostrada por ÁREA (integral exata em
// x, 16 sub-linhas em y), sRGB de 8 bits. A aresta passa por (x0, h/2) e
// pende `angulo` graus da vertical; d = (x − x0)·cos α − (y − h/2)·sen α.
// ---------------------------------------------------------------------------
function erf(x) { // Abramowitz–Stegun 7.1.26 (erro < 1,5e-7)
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const PHI = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
const phi = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
const G = (z) => z * PHI(z) + phi(z); // primitiva de Φ

export function degrauSintetico({ w = 72, h = 64, x0 = 36, angulo = 0, sigma = 1, cor0 = [40, 36, 32], cor1 = [236, 196, 48], ruido = 0, seed = 1 } = {}) {
  const ca = Math.cos(angulo * deg), sa = Math.sin(angulo * deg), l0 = lin3(cor0), l1 = lin3(cor1), SUB = 16;
  const data = new Uint8ClampedArray(w * h * 4), r = rng(seed);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let acc = 0;
    for (let s = 0; s < SUB; s++) {
      const y = j + (s + 0.5) / SUB, K = x0 * ca + (y - h / 2) * sa;
      // ∫_i^{i+1} Φ((x·cos α − K)/σ) dx = σ/cos α · [G(z1) − G(z0)]
      const z0 = (i * ca - K) / sigma, z1 = ((i + 1) * ca - K) / sigma;
      acc += (sigma / ca) * (G(z1) - G(z0));
    }
    const fr = acc / SUB, p = (j * w + i) * 4;
    for (let k = 0; k < 3; k++) data[p + k] = Math.round(srgb(l0[k] + (l1[k] - l0[k]) * fr) + (ruido ? ruido * gauss(r) : 0));
    data[p + 3] = 255;
  }
  // x da aresta numa linha de centro y: x0 + (y − h/2)·tan α
  return { img: { data, w, h }, xEm: (y) => x0 + (y - h / 2) * (sa / ca), normal: [ca, -sa] };
}
