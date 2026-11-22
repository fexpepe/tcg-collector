// Um setId = um set (2026-11-22).
//
// Os syncs da TCGCSV tiram o setId da abreviação do grupo do TCGplayer
// (`g.abbreviation || String(g.groupId)`). Quando DOIS grupos têm a mesma
// abreviação, as cartas dos dois caíam no mesmo setId. O manifesto grava uma
// entrada por setId, com o nome da primeira carta, e a tela do set filtra por
// nome: um dos sets ficava sem cartão na tela de Sets. Em 21/11/2026 eram 27
// sets e 1.847 cartas escondidos assim (Yu-Gi-Oh! 19, Flesh and Blood 6,
// Digimon 1, Fusion World 1). Conferido em produção no Digimon: o manifesto
// tinha uma entrada "BT-26" chamada "Timeless Bonds Release Event Cards" (49
// cartas) e o arquivo trazia também as 136 do booster "Timeless Bonds".
//
// REGRA: entre os grupos COM CARTA que dividem um setId, o de MENOR groupId
// fica com ele e os outros viram `<setId>-<groupId>`. Não é a regra do
// sync-swu.mjs (lá todo grupo repetido ganha o sufixo), de propósito:
//  - o set que já está publicado com o id limpo não muda de id (o link
//    antigo detail?type=set&setId=… e o código do cartão seguem valendo);
//  - o repinSetIdsRenomeados do sync-common.mjs só re-fixa um set quando o
//    setId antigo SUMIU do catálogo. Com todo mundo ganhando sufixo ele
//    sumiria, e a re-fixação juntaria os dois de novo, desfazendo a correção.
// O groupId é a chave por ser imutável: a data do grupo flutua (a TCGCSV
// carimba a hora da própria atualização nos grupos sem data) e a contagem de
// cartas muda a cada reprint.
//
// `fixos` ({ groupId: setId }) vence a regra: é pro caso em que o desempate
// daria um id feio ao set (um evento de lançamento virar "BT-26-24824" e
// perder o selo do código) ou em que a abreviação da fonte está errada. Grupo
// fixado sai da disputa. Mesmo papel do ABREV_FIXA do sync-onepiece.mjs.
//
// Uso, em cada sync: dentro do laço dos grupos, logo depois de calcular o
// setId, `marcas.push({ groupId: g.groupId, setId, de: cards.length })`; e
// depois do laço, ANTES de qualquer sort ou concat, `desempataSetIds(cards,
// marcas, FIXOS)`. As cartas de um grupo são as que entraram em `cards` entre
// a marca dele e a seguinte (grupo só com selados fica com faixa vazia e não
// disputa nada).

export function desempataSetIds(cards, marcas, fixos = {}, log = console.log) {
  const faixas = marcas
    .map((m, i) => ({ groupId: m.groupId, setId: m.setId, de: m.de, ate: i + 1 < marcas.length ? marcas[i + 1].de : cards.length }))
    .filter((f) => f.ate > f.de);

  const porId = new Map();
  for (const f of faixas) {
    const fixo = fixos[f.groupId];
    if (fixo) { f.final = String(fixo); continue; }
    if (!porId.has(f.setId)) porId.set(f.setId, []);
    porId.get(f.setId).push(f);
  }
  for (const [setId, lista] of porId) {
    lista.sort((a, b) => Number(a.groupId) - Number(b.groupId));
    lista.forEach((f, i) => { f.final = i === 0 ? setId : `${setId}-${f.groupId}`; });
  }

  // Dois grupos no mesmo id final (um pin que bate num id vivo, ou um sufixo
  // que coincidisse com uma abreviação) é o próprio bug voltando: para o sync.
  const dono = new Map();
  for (const f of faixas) {
    if (dono.has(f.final)) {
      throw new Error(`setId "${f.final}" ficaria com dois grupos (${dono.get(f.final)} e ${f.groupId}): revise os setIds fixos deste sync.`);
    }
    dono.set(f.final, f.groupId);
  }

  const mudados = [];
  for (const f of faixas) {
    if (f.final === f.setId) continue;
    for (let i = f.de; i < f.ate; i++) cards[i].setId = f.final;
    mudados.push({ groupId: f.groupId, de: f.setId, para: f.final, cartas: f.ate - f.de });
    log(`  setId desempatado: grupo ${f.groupId} "${f.setId}" -> "${f.final}" (${f.ate - f.de} cartas)`);
  }
  return mudados;
}
