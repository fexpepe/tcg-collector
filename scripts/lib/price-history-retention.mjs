// Retenção em FAIXAS do histórico de preços — o que substituiu o teto seco de
// 60 pontos do sync-price-history.mjs.
//
// O problema que isto resolve: `MAX_POINTS = 60` era uma JANELA ROLANTE. Todo
// build empurrava o ponto mais antigo pra fora, então em dois meses a série se
// repunha inteira e, daqui a um ano, o Sleevu teria exatamente os mesmos dois
// meses de histórico que tem hoje. O acervo que o concorrente cobra (histórico
// de 5 anos atrás do plano pago) nunca começava a existir — e preço de ontem
// não se compra depois: ou se guarda no dia, ou se perde pra sempre. A própria
// /comparar registrava isso ("aqui são 60 pontos, e vender isso como vantagem
// seria mentira"). Decisão de 19/09/2026: passa a guardar, com resolução que
// diminui com a idade.
//
// As faixas (a mesma ideia do RRD e do downsampling do Prometheus):
//   - DIÁRIO   nos últimos DIAS_DIARIO dias  -> a janela de hoje, intacta;
//   - SEMANAL  daí até DIAS_SEMANAL dias     -> guarda o ÚLTIMO ponto da semana;
//   - MENSAL   antes disso                   -> guarda o ÚLTIMO ponto do mês.
//
// Por que "o último de cada semana/mês" e não "um a cada 7": a regra tem de ser
// uma função PURA das datas, senão ela decide diferente a cada build e a linha
// do gráfico treme sozinha. E é estável pra frente: a série só recebe datas
// NOVAS, então quem já é o último ponto da sua semana nunca deixa de ser — um
// ponto só desce de faixa (diário -> semanal -> mensal) e, ao descer, ou é o
// representante daquele balde ou sai. Aplicar duas vezes dá o mesmo resultado
// (o teste trava a idempotência).
//
// Crescimento: 60 diários + ~44 semanais (o resto do 1º ano) + 12 por ano
// depois. Cinco anos dão ~150 pontos, contra os 60 de hoje — e o custo por ano
// vira 12 pontos, não 365. O price-history.generated.json é o maior JSON do
// site, então a faixa diária é o que não pode crescer, e ela não cresce.

import { resolveMergedId } from "./set-supersede.mjs";

export const DIAS_DIARIO = 60;    // ~2 meses: a janela que os deltas 1d/7d e os movers usam
export const DIAS_SEMANAL = 365;  // até 1 ano vira 1 ponto por semana

// ── ID APOSENTADO DENTRO DO ACERVO ──────────────────────────────────────────
// O acervo é chaveado por cardId. Quando um set importado é aposentado
// (scripts/retire-imported-sets.mjs: cel30-001 virou 30th-001 em 18/09/2026),
// a coleção de quem marcou migra pelo data/card-id-merges.json — mas a série
// de preço ficava pra trás: o id velho recebia null até sumir, e o id novo
// nascia do zero no dia em que apareceu. A carta perdia o gráfico, os deltas
// e a parcela no índice do set. Aqui a série muda de chave junto com a conta.
//   serie: { d: [datas], c: { id: { s, p[] } } } (raw) ou { id: { nota: [] } } (graded)
//   merges: o JSON do data/card-id-merges.json ({ prefixes, cards })
// Id novo SEM série: a velha é renomeada. Id novo COM série (a carta já
// apareceu no pricing pelo id da TCGdex): os buracos da nova são preenchidos
// com os pontos da velha — só na MESMA fonte no raw (moedas diferentes não se
// misturam), sempre por nota no graded. Devolve quantas séries migraram.
export function migrarIdsDoHistorico(serie, merges, porNota) {
  const c = serie && serie.c;
  if (!c || !merges) return 0;
  let migradas = 0;
  for (const velho of Object.keys(c)) {
    const novo = resolveMergedId(velho, merges);
    if (!novo || novo === velho) continue;
    const de = c[velho], para = c[novo];
    if (!para) c[novo] = de;
    else if (porNota) {
      for (const nota of Object.keys(de)) {
        if (Array.isArray(para[nota])) preencherNulos(para[nota], de[nota]);
        else para[nota] = de[nota];
      }
    } else if (para.s === de.s) preencherNulos(para.p, de.p);
    delete c[velho];
    migradas++;
  }
  return migradas;
}
function preencherNulos(alvo, fonte) {
  for (let i = 0; i < (fonte || []).length; i++) {
    while (alvo.length < i) alvo.push(null);
    if (alvo[i] == null && fonte[i] != null) alvo[i] = fonte[i];
  }
}

// Entre várias cópias do MESMO acervo (R2, produção, cache do runner), a mais
// ADIANTADA: última data maior; empate, mais pontos. Existe porque as cópias
// podem divergir por um dia (uma gravação que falhou) e escolher a errada
// perderia o ponto daquele dia. null quando nenhuma serve.
export function serieMaisAdiantada(series) {
  let melhor = null;
  for (const s of series || []) {
    if (!s || !Array.isArray(s.d) || !s.c) continue;
    if (!melhor) { melhor = s; continue; }
    const a = s.d[s.d.length - 1] || "", b = melhor.d[melhor.d.length - 1] || "";
    if (a > b || (a === b && s.d.length > melhor.d.length)) melhor = s;
  }
  return melhor;
}

// Balde de uma data dentro de cada faixa. Semana ancorada na SEGUNDA (ISO),
// calculada em UTC porque as datas da série são "YYYY-MM-DD" sem fuso — usar
// hora local faria o balde mudar conforme a máquina que roda o build.
function baldeSemana(iso) {
  const t = Date.parse(iso + "T00:00:00Z");
  const dow = (new Date(t).getUTCDay() + 6) % 7; // 0 = segunda
  return new Date(t - dow * 86400000).toISOString().slice(0, 10);
}
const baldeMes = (iso) => iso.slice(0, 7);

/**
 * Decide quais datas FICAM. Pura: mesma entrada, mesma saída.
 * @param {string[]} datas  ISO "YYYY-MM-DD", em ordem crescente.
 * @param {string} [hoje]   referência da idade (padrão: a última data da série).
 * @returns {boolean[]} paralelo a `datas`: true = mantém.
 */
export function marcarMantidos(datas, hoje) {
  if (!Array.isArray(datas) || !datas.length) return [];
  const ref = Date.parse((hoje || datas[datas.length - 1]) + "T00:00:00Z");
  const idade = (iso) => Math.floor((ref - Date.parse(iso + "T00:00:00Z")) / 86400000);

  // Último índice de cada balde: percorre uma vez e sobrescreve, então sobra o
  // mais recente de cada semana e de cada mês.
  const ultimoDaSemana = new Map();
  const ultimoDoMes = new Map();
  datas.forEach((d, i) => { ultimoDaSemana.set(baldeSemana(d), i); ultimoDoMes.set(baldeMes(d), i); });

  return datas.map((d, i) => {
    const dias = idade(d);
    // Data no futuro (relógio do runner atrasado num dia, fuso) nunca é
    // descartada: idade negativa cai aqui e fica.
    if (dias <= DIAS_DIARIO) return true;
    if (dias <= DIAS_SEMANAL) return ultimoDaSemana.get(baldeSemana(d)) === i;
    return ultimoDoMes.get(baldeMes(d)) === i;
  });
}

/**
 * Aplica a retenção no acumulador do price-history, NO LUGAR.
 * Formato: { d: [datas], c: { id: { s, p: [valores] } } } — `p` é paralelo a `d`.
 * @returns {number} quantos pontos saíram.
 */
export function podarHistorico(hist, hoje) {
  const manter = marcarMantidos(hist.d, hoje);
  const removidos = manter.filter((m) => !m).length;
  if (!removidos) return 0;
  hist.d = hist.d.filter((_, i) => manter[i]);
  Object.values(hist.c).forEach((c) => { c.p = c.p.filter((_, i) => manter[i]); });
  return removidos;
}

/**
 * Idem pro acumulador GRADED, que tem uma série por NOTA.
 * Formato: { d: [datas], c: { id: { "10": [valores], "9": [...] } } }
 * @returns {number} quantos pontos saíram.
 */
export function podarGraded(gh, hoje) {
  const manter = marcarMantidos(gh.d, hoje);
  const removidos = manter.filter((m) => !m).length;
  if (!removidos) return 0;
  gh.d = gh.d.filter((_, i) => manter[i]);
  Object.values(gh.c).forEach((c) =>
    Object.keys(c).forEach((nota) => { c[nota] = c[nota].filter((_, i) => manter[i]); }));
  return removidos;
}

// Teto de BYTES do acervo. O Cloudflare Pages recusa arquivo individual acima
// de 25 MiB, e o price-history é o maior JSON do site: deixar a retenção
// acumular sem teto é marcar um deploy quebrado pra daqui a alguns anos — e ele
// quebraria no dia em que ninguém está olhando, levando junto o catálogo e os
// preços do build inteiro. O orçamento fica bem abaixo do limite porque o
// arquivo também cresce por CARTA (catálogo novo), não só por ponto.
//
// Quando morder, some o ponto mais ANTIGO primeiro: perde-se a ponta do acervo,
// nunca a janela recente de que os deltas e os movers dependem. E o log grita,
// porque a solução de verdade não é podar mais — é parar de servir a série
// inteira num arquivo só (chunk por set, como o catálogo já faz).
export const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Derruba os pontos mais antigos até o acervo caber no orçamento.
 * @param {object} serie  { d, c } — raw ({id:{s,p}}) ou graded ({id:{nota:[]}}).
 * @param {boolean} porNota  true pro acumulador graded.
 * @param {number} [maxBytes]
 * @returns {{removidos: number, bytes: number, estourou: boolean}}
 */
export function caberEmBytes(serie, porNota, maxBytes = MAX_BYTES) {
  let bytes = JSON.stringify(serie).length;
  if (bytes <= maxBytes) return { removidos: 0, bytes, estourou: false };
  let removidos = 0;
  // Um ponto por vez seria O(n) serializações de um JSON de dezenas de MB.
  // Corta em blocos proporcionais ao excesso e reavalia.
  while (bytes > maxBytes && serie.d.length > 2) {
    const passo = Math.max(1, Math.ceil(serie.d.length * (1 - maxBytes / bytes)));
    serie.d.splice(0, passo);
    Object.values(serie.c).forEach((v) => {
      if (porNota) Object.keys(v).forEach((nota) => v[nota].splice(0, passo));
      else v.p.splice(0, passo);
    });
    removidos += passo;
    bytes = JSON.stringify(serie).length;
  }
  return { removidos, bytes, estourou: true };
}
