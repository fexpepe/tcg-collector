// Proporcao real do retangulo a partir da foto (Zhang & He 2004, "whiteboard"):
// ponto principal no centro, pixel quadrado; f sai dos 2 pontos de fuga.
import { camera, rng } from "./sint.mjs";
import { squareToQuad, ap } from "./geo.mjs";
export function aspecto(q, w, h) {
  const H = squareToQuad(q), cx = w / 2, cy = h / 2;
  // colunas h1 = direcao u, h2 = direcao v (em coordenadas centradas)
  const h1 = [H[0] - cx * H[6], H[3] - cy * H[6], H[6]], h2 = [H[1] - cx * H[7], H[4] - cy * H[7], H[7]];
  // ortogonalidade: h1x h2x + h1y h2y + f^2 h1z h2z = 0  =>  f^2 = -(h1x h2x + h1y h2y)/(h1z h2z)
  let f2 = -(h1[0] * h2[0] + h1[1] * h2[1]) / (h1[2] * h2[2]);
  const fracoPersp = !(f2 > 0) || Math.abs(h1[2] * h2[2]) < 1e-12;
  if (fracoPersp || f2 > 1e12) f2 = (Math.max(w, h)) ** 2; // perspectiva fraca: f quase nao importa
  const n1 = h1[0] ** 2 + h1[1] ** 2 + f2 * h1[2] ** 2, n2 = h2[0] ** 2 + h2[1] ** 2 + f2 * h2[2] ** 2;
  return { asp: Math.sqrt(n1 / n2), f: Math.sqrt(f2), fracoPersp };
}
const R = rng(8), U = (a, b) => a + (b - a) * R(), deg = Math.PI / 180, G = () => Math.sqrt(-2 * Math.log(R() + 1e-12)) * Math.cos(2 * Math.PI * R());
for (const sg of [0, 0.3, 1, 3]) {
  const e = [];
  for (let k = 0; k < 200; k++) {
    const w = 1200, h = 1600, Hm = camera({ w, h, f: 1200, D: 1200 * 88 / (1600 * U(0.6, 0.85)), pitch: U(-25, 25) * deg, yaw: U(-25, 25) * deg, roll: U(-10, 10) * deg });
    const q = [[-31.5, -44], [31.5, -44], [31.5, 44], [-31.5, 44]].map(([X, Y]) => ap(Hm, X, Y)).map(([x, y]) => [x + sg * G(), y + sg * G()]);
    e.push(Math.abs(aspecto(q, w, h).asp / (63 / 88) - 1) * 100);
  }
  e.sort((a, b) => a - b);
  console.log(`ruido de canto ${sg}px: erro da proporcao estimada mediana ${e[100].toFixed(2)}%  p90 ${e[180].toFixed(2)}%`);
}
