// Histórico de preço em FRAGMENTOS (2026-10-08): o popup de uma carta baixava
// o price-history.generated.json do jogo INTEIRO pra desenhar o gráfico de uma
// carta — medido em produção, 1,55 MB brotli (17,8 MB de JSON) no Pokémon,
// 1,79 MB no Magic e 1,43 MB no Yu-Gi-Oh!, com 390 a 450 ms de trava no parse
// e o arquivo mudando a cada deploy diário (a revalidação baixava tudo de novo
// no dia seguinte). No 4G lento o gráfico do Magic aparecia aos 12 s.
//
// Agora cada jogo ganha N arquivos history-shards/<k>.json, e a carta mora no
// fragmento k = fragmentoDoSet(setId, N): TODAS as cartas de um set caem no
// mesmo fragmento (quem abre várias cartas do set paga um download só), e N
// fica pequeno — um arquivo POR SET seriam mais 3 mil arquivos num deploy que
// já tem 13,5 mil, com teto de 20 mil no Pages. Cada fragmento leva, das
// cartas dos seus sets (e dos ids BASE das localizadas, que caem no preço da
// carta EN — a mesma regra dos pricing-chunks):
//   d, c    a janela do price-history (datas e séries), formato de sempre;
//   xf, x   a variação de 24 h (price-deltas: from e c);
//   gd, g   o histórico graded (graded-history: d e c), quando houver.
// O manifest ganha `hs: N`, que é como o cliente sabe que pode pular os
// arquivos inteiros (fragmentoDaCarta no shared.js).
//
// fragmentoDoSet tem uma CÓPIA no shared.js (o cliente não importa daqui); o
// teste tests/history-shards.test.mjs trava as duas no mesmo resultado.

// FNV-1a de 32 bits sobre o setId: estável, sem dependência, igual no Node e
// no navegador.
export function fragmentoDoSet(setId, n) {
  let h = 2166136261;
  for (const ch of String(setId || "")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % n;
}

// Quantos fragmentos pra um histórico de `bytes` de JSON: potência de 2 até
// ~300 KB de JSON por fragmento (~25 KB em brotli), no máximo 64. Potência de
// 2 porque o N só muda quando o arquivo DOBRA — e mudar o N muda o fragmento
// de quase toda carta.
export const MAX_FRAGMENTOS = 64;
export const BYTES_POR_FRAGMENTO = 300000;
export function fragmentosPara(bytes) {
  let n = 1;
  while (n < MAX_FRAGMENTOS && bytes / n > BYTES_POR_FRAGMENTO) n *= 2;
  return n;
}

// Monta os N fragmentos. `idsPorSet`: Map setId -> Set dos ids das cartas do
// set (o id base de cada localizada entra aqui, por basePricingId). Devolve
// { n, fragmentos: [objeto…] }, ou null sem histórico de preço (a flag `hs`
// não liga e o cliente segue nos arquivos inteiros).
export function montaFragmentos({ hist, deltas, graded, idsPorSet, basePricingId }) {
  if (!hist || !Array.isArray(hist.d) || !hist.c) return null;
  const bytes = JSON.stringify(hist).length
    + (deltas && deltas.c ? JSON.stringify(deltas.c).length : 0)
    + (graded && graded.c ? JSON.stringify(graded.c).length : 0);
  const n = fragmentosPara(bytes);
  const fragmentos = Array.from({ length: n }, () => {
    const f = { d: hist.d, c: {} };
    if (deltas && deltas.c) { f.xf = deltas.from || null; f.x = {}; }
    return f;
  });
  const temGraded = !!(graded && Array.isArray(graded.d) && graded.c && Object.keys(graded.c).length);
  for (const [setId, ids] of idsPorSet) {
    const f = fragmentos[fragmentoDoSet(setId, n)];
    for (const id of ids) {
      for (const k of id === basePricingId(id) ? [id] : [id, basePricingId(id)]) {
        if (hist.c[k]) f.c[k] = hist.c[k];
        if (f.x && deltas.c[k] != null) f.x[k] = deltas.c[k];
        if (temGraded && graded.c[k]) { f.gd = graded.d; (f.g = f.g || {})[k] = graded.c[k]; }
      }
    }
  }
  return { n, fragmentos };
}
