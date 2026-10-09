// Carga INCREMENTAL do D1: impressão digital por linha, diferença contra o
// remoto e plano de escrita dentro de um orçamento de linhas.
//
// Por que existe: no plano grátis do D1 a cota é de 100 mil linhas ESCRITAS
// por dia (reset 00:00 UTC), e índice conta — cada palavra inserida são 4
// escritas (linha + 3 índices), cada carta 2 (linha + PK). A carga total
// reescrevia 254 mil cartas e 2,1 milhões de palavras (6,8M de escritas) toda
// vez que UMA carta mudava, mais 469 mil de preços a cada sync — 72 vezes a
// cota, todo dia, com e-mail da Cloudflare de brinde. O que muda de um dia pro
// outro são centenas de cartas e alguns milhares de preços; é isso que se
// grava agora.
//
// O contrato é ser IDEMPOTENTE e RETOMÁVEL: a diferença é calculada contra o
// que está no banco (não contra o que o deploy anterior ACHA que gravou), e a
// ordem dos statements garante que uma carga interrompida no meio (cota
// estourada, rede) deixa a carta ou inteira ou detectável como pendente na
// próxima rodada — nunca "linha certa sem palavras", que a busca não acharia
// e a impressão digital daria por pronta. Tudo aqui é função pura: o teste em
// tests/d1-delta.test.mjs aplica os planos num SQLite real e confere que o
// banco termina IGUAL a uma carga total do mesmo catálogo.
import { COLUNAS, aspas, insertsEmLotes, listasEmLotes, valoresCarta, valoresPalavra, valoresPreco } from "./d1-catalogo.mjs";

// Custo ESTIMADO em linhas escritas (o D1 conta índice como linha). Só serve
// pra decidir quanto tentar numa rodada; o gasto real vem do próprio D1 depois
// e é ele que fica registrado. Estimar pra cima é o lado seguro.
export const CUSTO = {
  carta: 2,            // linha + índice da PK
  palavra: 4,          // linha + idx_card_words + idx_words_global + idx_words_id
  preco: 2,            // linha + PK (o upsert em linha existente gasta menos)
  palavrasSemDado: 8   // carta remota que sumiu: não sabemos quantas palavras tinha
};

// Diferença entre o catálogo local e as impressões remotas de UM jogo.
// locais: Map id -> {h, hw, anteriores}; remotos: Map id -> {h, hw} (hw pode
// vir null de uma linha gravada pela metade — conta como "palavras mudaram").
// `jaTem`: id -> quantas palavras a carta remota já tem, pras de `acrescentar`.
export function diffCartas(locais, remotos) {
  const novos = [], linha = [], palavras = [], acrescentar = [], remover = [];
  const jaTem = new Map();
  for (const [id, l] of locais) {
    const r = remotos.get(id);
    if (!r) { novos.push(id); continue; }
    // Remota parada numa RÉGUA anterior (ver cardRows/impressaoCarta): faltam
    // só as palavras das réguas seguintes — insere-as, sem apagar e reescrever
    // as que ela já tem. Vale de qualquer régua: a carta da carga original
    // recebe todas as extras; a que já tinha o total do set, só a espécie.
    const anterior = r.hw !== l.hw && (l.anteriores || []).find((a) => a.hw === r.hw);
    if (anterior) { acrescentar.push(id); jaTem.set(id, anterior.n); }
    else if (r.hw !== l.hw) palavras.push(id);   // pode ter mudado a linha também: o upsert cobre
    else if (r.h !== l.h) linha.push(id);
  }
  for (const id of remotos.keys()) if (!locais.has(id)) remover.push(id);
  return { novos, palavras, linha, acrescentar, remover, jaTem };
}

// Plano de UM jogo dentro do orçamento. `cartas`: Map id -> {linha, words}.
// Prioridade: carta nova (é o set novo que a pessoa procura), depois palavra
// que mudou, linha que mudou e por fim o que sumiu (uma carta a mais no banco
// não atrapalha ninguém). O que não coube volta em `pendentes` — a próxima
// rodada recalcula a diferença e continua de onde parou.
export function planoCartas(game, diff, cartas, orcamento) {
  // Palavras que faltam numa carta de `acrescentar`: as que vêm depois das que
  // a remota já tem. O cardRows não repete palavra entre réguas, então elas
  // nunca coincidem com uma que a remota tem — o DELETE delas lá embaixo só
  // pega sobra de uma inserção interrompida. Sem o corte (diff que não veio
  // do diffCartas), slice(undefined) seriam TODAS as palavras inseridas por
  // cima das que a remota já tem: melhor falhar a rodada que duplicar.
  const faltam = (id) => {
    const n = diff.jaTem && diff.jaTem.get(id);
    if (!Number.isInteger(n)) throw new Error(`d1-delta: ${id} em acrescentar sem o corte da régua remota`);
    return cartas.get(id).words.slice(n);
  };
  const custoDe = {
    novos: (id) => CUSTO.carta + CUSTO.palavra * cartas.get(id).words.length,
    palavras: (id) => CUSTO.carta + CUSTO.palavra * 2 * cartas.get(id).words.length,
    linha: () => CUSTO.carta,
    acrescentar: (id) => CUSTO.carta + CUSTO.palavra * faltam(id).length,
    remover: () => CUSTO.carta + CUSTO.palavra * CUSTO.palavrasSemDado
  };
  const feitos = { novos: [], palavras: [], linha: [], acrescentar: [], remover: [] };
  let custo = 0, pendentes = 0;
  // `acrescentar` (palavras extras numa carta que não mudou) depois de tudo o
  // que é mudança de verdade: é churn de uma régua nova de busca, e não pode
  // atrasar um set novo nem uma linha corrigida. Diante do `remover` porque
  // uma carta a mais no banco não atrapalha ninguém.
  for (const tipo of ["novos", "palavras", "linha", "acrescentar", "remover"]) {
    for (const id of diff[tipo] || []) {
      const c = custoDe[tipo](id);
      if (custo + c > orcamento) { pendentes++; continue; }
      custo += c;
      feitos[tipo].push(id);
    }
  }
  // A ORDEM abaixo é o que torna a carga retomável (ver o cabeçalho):
  //   1. apaga as palavras velhas (das que mudaram, das que sumiram e das
  //      novas — sobra de uma tentativa interrompida); nas de `acrescentar`
  //      apaga SÓ as que faltam (sobra de uma inserção interrompida antes do
  //      passo 4 — sem isso a rodada seguinte as duplicaria);
  //   2. apaga a linha das que sumiram;
  //   3. insere as palavras novas (todas, ou só as que faltam);
  //   4. por ÚLTIMO grava a linha (upsert) com h/hw novos.
  // Interrompeu entre 3 e 4? A linha remota ainda tem o hw velho e a próxima
  // rodada refaz as palavras. Interrompeu entre 1 e 3? Idem. Nunca fica uma
  // linha "pronta" apontando pra palavras que não existem.
  const statements = [];
  const g = aspas(game);
  const semPalavras = [...feitos.novos, ...feitos.palavras, ...feitos.remover];
  statements.push(...listasEmLotes(`DELETE FROM card_words WHERE game=${g} AND id IN`, semPalavras));
  // Agrupadas pelo conjunto de palavras que faltam (o total do set repete-se
  // em todas as cartas do set; a espécie, em todas as cartas dela): um DELETE
  // por conjunto, com a lista de ids.
  const porFalta = new Map();
  for (const id of feitos.acrescentar) {
    const k = faltam(id).map((w) => aspas(w.word)).join(",");
    if (!k) continue;
    if (!porFalta.has(k)) porFalta.set(k, []);
    porFalta.get(k).push(id);
  }
  for (const [k, ids] of porFalta) {
    statements.push(...listasEmLotes(`DELETE FROM card_words WHERE game=${g} AND word IN (${k}) AND id IN`, ids));
  }
  statements.push(...listasEmLotes(`DELETE FROM cards WHERE game=${g} AND id IN`, feitos.remover));
  const comPalavras = [...feitos.novos, ...feitos.palavras];
  statements.push(...insertsEmLotes(
    "INSERT INTO card_words (game,word,id)",
    [
      ...comPalavras.flatMap((id) => cartas.get(id).words.map(valoresPalavra)),
      ...feitos.acrescentar.flatMap((id) => faltam(id).map(valoresPalavra))
    ]
  ));
  const gravar = [...comPalavras, ...feitos.linha, ...feitos.acrescentar];
  const sets = COLUNAS.filter((k) => k !== "game" && k !== "id").map((k) => `${k}=excluded.${k}`).join(",");
  statements.push(...insertsEmLotes(
    `INSERT INTO cards (${COLUNAS.join(",")})`,
    gravar.map((id) => valoresCarta(cartas.get(id))),
    `\n  ON CONFLICT(game,id) DO UPDATE SET ${sets}`
  ));
  const n = Object.values(feitos).reduce((s, a) => s + a.length, 0);
  return { statements, custo, feitos: n, pendentes };
}

// Preços: só linha, sem palavras. locais/remotos: Map id -> h.
export function diffPrecos(locais, remotos) {
  const gravar = [], remover = [];
  for (const [id, h] of locais) if (remotos.get(id) !== h) gravar.push(id);
  for (const id of remotos.keys()) if (!locais.has(id)) remover.push(id);
  return { gravar, remover };
}

// `precos`: Map id -> {game, id, j, h}. Mesma regra de orçamento das cartas.
export function planoPrecos(game, diff, precos, orcamento) {
  const feitos = { gravar: [], remover: [] };
  let custo = 0, pendentes = 0;
  for (const tipo of ["gravar", "remover"]) {
    for (const id of diff[tipo]) {
      if (custo + CUSTO.preco > orcamento) { pendentes++; continue; }
      custo += CUSTO.preco;
      feitos[tipo].push(id);
    }
  }
  const statements = [];
  statements.push(...listasEmLotes(`DELETE FROM prices WHERE game=${aspas(game)} AND id IN`, feitos.remover));
  statements.push(...insertsEmLotes(
    "INSERT INTO prices (game,id,j,h)",
    feitos.gravar.map((id) => valoresPreco(precos.get(id))),
    "\n  ON CONFLICT(game,id) DO UPDATE SET j=excluded.j, h=excluded.h"
  ));
  return { statements, custo, feitos: feitos.gravar.length + feitos.remover.length, pendentes };
}
