// Pontuação do "em destaque" da galeria de decks. PURA (sem rede, sem disco),
// pra poder ser testada linha a linha em tests/decks-hot.test.mjs — o mesmo
// padrão do export-liga.js.
//
//   hot = views / (idadeEmDias + AMORTECEDOR) ^ GRAVIDADE
//
// GRAVIDADE 1.5 é o meio-termo: com 1.0 um deck antigo e muito visto ainda
// segura o topo por semanas; com 2.0 qualquer deck de ontem ganha de tudo e o
// destaque vira "o mais recente", que a galeria já mostra logo abaixo.
//
// O AMORTECEDOR de 2 dias impede que um deck de HORAS com 3 visitas exploda
// (dividir por algo perto de zero) e passe na frente de um deck bom de ontem.
export const GRAVIDADE = 1.5;
export const AMORTECEDOR = 2;

// decks: [{ id, created_at }] · views: [{ share_id, views }]
// Devolve [[id, score], …] em ordem decrescente. Deck sem visita não disputa
// destaque; data inválida fica de fora (score de idade desconhecida é chute).
export function pontuaDecks(decks, views, agora = Date.now()) {
  const porId = new Map();
  for (const v of views || []) if (v && v.share_id) porId.set(v.share_id, Number(v.views) || 0);
  const out = [];
  for (const d of decks || []) {
    if (!d || !d.id) continue;
    const n = porId.get(d.id) || 0;
    if (n <= 0) continue;
    const nascimento = Date.parse(d.created_at || "");
    if (Number.isNaN(nascimento)) continue;
    const dias = Math.max(0, (agora - nascimento) / 86400000);
    out.push([d.id, Math.round((n / Math.pow(dias + AMORTECEDOR, GRAVIDADE)) * 1000) / 1000]);
  }
  out.sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  return out;
}
