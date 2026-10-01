// Rotulagem por lado: a partir de um quad GROSSO (que pode ser o corte, o
// miolo ou uma mistura), varre cada lado de -15% a +15% com perfis
// perpendiculares, tira o perfil MEDIANO de cor, acha as arestas e escolhe a
// FAIXA DA BORDA: segmento uniforme, de largura plausivel e da MESMA cor nos 4
// lados. Corte = aresta de fora da faixa; miolo = aresta de dentro.
import { squareToQuad, ap, parab, retaRobusta, intersec } from "./geo.mjs";
import { amostra } from "./medir.mjs";
import { rng } from "./sint.mjs";

const LADOS = 4;
// d > 0 = pra dentro da carta; d < 0 = pra fora. t ao longo do lado.
const uvDe = (lado, t, d) => lado === 0 ? [t, d] : lado === 1 ? [1 - d, t] : lado === 2 ? [1 - t, 1 - d] : [d, 1 - t];

export function rotula(im, q, o = {}) {
  const H = squareToQuad(q), c = [0, 0, 0];
  const larg = (Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) + Math.hypot(q[2][0] - q[3][0], q[2][1] - q[3][1])) / 2;
  const alt = (Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]) + Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1])) / 2;
  const NP = 31, ext = o.ext || 0.15;
  const lados = [];
  for (let lado = 0; lado < LADOS; lado++) {
    const esc = lado % 2 === 0 ? alt : larg; // px por unidade de d
    const dd = 0.75 / esc, n = Math.ceil((2 * ext) / dd) + 1;
    const perfis = [];
    for (let k = 0; k < NP; k++) {
      const t = 0.2 + 0.6 * k / (NP - 1), P = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const [u, v] = uvDe(lado, t, -ext + i * dd); const [x, y] = ap(H, u, v); amostra(im, x, y, c); P[i * 3] = c[0]; P[i * 3 + 1] = c[1]; P[i * 3 + 2] = c[2]; }
      perfis.push(P);
    }
    // perfil mediano (por canal) — robusto a reflexo e a detalhe da arte
    const M = new Float32Array(n * 3), col = new Float32Array(NP);
    for (let i = 0; i < n * 3; i++) { for (let k = 0; k < NP; k++) col[k] = perfis[k][i]; col.sort(); M[i] = col[NP >> 1]; }
    // arestas do perfil mediano: |M(i+2)-M(i-2)| com picos acima de 30
    const G = new Float32Array(n);
    for (let i = 2; i < n - 2; i++) G[i] = Math.hypot(M[(i + 2) * 3] - M[(i - 2) * 3], M[(i + 2) * 3 + 1] - M[(i - 2) * 3 + 1], M[(i + 2) * 3 + 2] - M[(i - 2) * 3 + 2]);
    const arestas = [];
    for (let i = 3; i < n - 3; i++) if (G[i] > 30 && G[i] >= G[i - 1] && G[i] > G[i + 1]) {
      if (arestas.length && i - arestas[arestas.length - 1].i < 6) { if (G[i] > arestas[arestas.length - 1].g) arestas[arestas.length - 1] = { i, g: G[i] }; continue; }
      arestas.push({ i, g: G[i] });
    }
    // segmentos entre arestas consecutivas = faixas candidatas
    const faixas = [];
    for (let a = 0; a + 1 < arestas.length; a++) {
      const i0 = arestas[a].i + 4, i1 = arestas[a + 1].i - 4; if (i1 <= i0) continue;
      const larguraD = (arestas[a + 1].i - arestas[a].i) * dd;
      if (larguraD < 0.008 || larguraD > 0.10) continue;
      let cm = [0, 0, 0], nn = 0; for (let i = i0; i <= i1; i++) { cm[0] += M[i * 3]; cm[1] += M[i * 3 + 1]; cm[2] += M[i * 3 + 2]; nn++; } cm = cm.map((v) => v / nn);
      // uniformidade: desvio medio das amostras de TODOS os perfis no segmento
      let dv = 0, nd = 0; for (const P of perfis) for (let i = i0; i <= i1; i += 2) { dv += Math.hypot(P[i * 3] - cm[0], P[i * 3 + 1] - cm[1], P[i * 3 + 2] - cm[2]); nd++; }
      faixas.push({ fora: arestas[a].i, dentro: arestas[a + 1].i, cor: cm, unif: dv / nd, larguraD });
    }
    lados.push({ esc, dd, n, ext, perfis, faixas, arestas });
  }
  // escolha conjunta: cor da borda presente nos 4 lados, faixa uniforme
  let melhor = null;
  for (const f0 of lados.flatMap((l) => l.faixas)) {
    if (f0.unif > 25) continue;
    const esc = lados.map((l) => {
      const ok = l.faixas.filter((f) => f.unif <= 25 && Math.hypot(f.cor[0] - f0.cor[0], f.cor[1] - f0.cor[1], f.cor[2] - f0.cor[2]) < 40);
      // se tiver mais de uma faixa dessa cor no lado, a de FORA (menor indice)
      return ok.sort((a, b) => a.fora - b.fora)[0] || null;
    });
    const nOk = esc.filter(Boolean).length, unifSum = esc.reduce((s, f) => s + (f ? f.unif : 50), 0);
    const foraMed = esc.reduce((s2, f, i) => s2 + (f ? -lados[i].ext + f.fora * lados[i].dd : 0), 0) / Math.max(1, nOk);
    const sc = nOk * 1000 - unifSum * 0.5 - foraMed * 1000; // mais lados > mais de FORA > mais uniforme
    if (!melhor || sc > melhor.sc) melhor = { sc, esc, nOk, cor: f0.cor, unifSum };
  }
  if (!melhor) return null;
  // cantos finos: perfis individuais perto da aresta de fora escolhida -> retas
  const rnd = rng(3), retasCorte = [], miolo = [];
  for (let lado = 0; lado < LADOS; lado++) {
    const L = lados[lado], f = melhor.esc[lado];
    if (!f) { retasCorte.push(null); miolo.push(null); continue; }
    const pts = [], ptsIn = [];
    for (let k = 0; k < L.perfis.length; k++) {
      const P = L.perfis[k], t = 0.2 + 0.6 * k / (L.perfis.length - 1);
      const pico = (alvo) => {
        let b = -1, bv = 0;
        for (let i = Math.max(2, alvo - 10); i <= Math.min(L.n - 3, alvo + 10); i++) { const g = Math.hypot(P[(i + 1) * 3] - P[(i - 1) * 3], P[(i + 1) * 3 + 1] - P[(i - 1) * 3 + 1], P[(i + 1) * 3 + 2] - P[(i - 1) * 3 + 2]); if (g > bv) { bv = g; b = i; } }
        if (b < 0) return null;
        const g = (i) => Math.hypot(P[(i + 1) * 3] - P[(i - 1) * 3], P[(i + 1) * 3 + 1] - P[(i - 1) * 3 + 1], P[(i + 1) * 3 + 2] - P[(i - 1) * 3 + 2]);
        return -L.ext + (b + parab(g(b - 1), g(b), g(b + 1))) * L.dd;
      };
      const dc = pico(f.fora); if (dc !== null) { const [u, v] = uvDe(lado, t, dc); pts.push(ap(H, u, v)); }
    }
    retasCorte.push(retaRobusta(pts, 0.8, 150, rnd));
  }
  if (retasCorte.some((r) => !r)) return { melhor, cantos: null };
  const cantos = [intersec(retasCorte[3], retasCorte[0]), intersec(retasCorte[0], retasCorte[1]), intersec(retasCorte[1], retasCorte[2]), intersec(retasCorte[2], retasCorte[3])];
  return { melhor, cantos, nFaixas: lados.map((l) => l.faixas.length) };
}
