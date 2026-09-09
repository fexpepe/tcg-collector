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
// locais: Map id -> {h, hw}; remotos: Map id -> {h, hw} (hw pode vir null de
// uma linha gravada pela metade — conta como "palavras mudaram").
export function diffCartas(locais, remotos) {
  const novos = [], linha = [], palavras = [], remover = [];
  for (const [id, l] of locais) {
    const r = remotos.get(id);
    if (!r) novos.push(id);
    else if (r.hw !== l.hw) palavras.push(id);   // pode ter mudado a linha também: o upsert cobre
    else if (r.h !== l.h) linha.push(id);
  }
  for (const id of remotos.keys()) if (!locais.has(id)) remover.push(id);
  return { novos, palavras, linha, remover };
}

// Plano de UM jogo dentro do orçamento. `cartas`: Map id -> {linha, words}.
// Prioridade: carta nova (é o set novo que a pessoa procura), depois palavra
// que mudou, linha que mudou e por fim o que sumiu (uma carta a mais no banco
// não atrapalha ninguém). O que não coube volta em `pendentes` — a próxima
// rodada recalcula a diferença e continua de onde parou.
export function planoCartas(game, diff, cartas, orcamento) {
  const custoDe = {
    novos: (id) => CUSTO.carta + CUSTO.palavra * cartas.get(id).words.length,
    palavras: (id) => CUSTO.carta + CUSTO.palavra * 2 * cartas.get(id).words.length,
    linha: () => CUSTO.carta,
    remover: () => CUSTO.carta + CUSTO.palavra * CUSTO.palavrasSemDado
  };
  const feitos = { novos: [], palavras: [], linha: [], remover: [] };
  let custo = 0, pendentes = 0;
  for (const tipo of ["novos", "palavras", "linha", "remover"]) {
    for (const id of diff[tipo]) {
      const c = custoDe[tipo](id);
      if (custo + c > orcamento) { pendentes++; continue; }
      custo += c;
      feitos[tipo].push(id);
    }
  }
  // A ORDEM abaixo é o que torna a carga retomável (ver o cabeçalho):
  //   1. apaga as palavras velhas (das que mudaram, das que sumiram e das
  //      novas — sobra de uma tentativa interrompida);
  //   2. apaga a linha das que sumiram;
  //   3. insere as palavras novas;
  //   4. por ÚLTIMO grava a linha (upsert) com h/hw novos.
  // Interrompeu entre 3 e 4? A linha remota ainda tem o hw velho e a próxima
  // rodada refaz as palavras. Interrompeu entre 1 e 3? Idem. Nunca fica uma
  // linha "pronta" apontando pra palavras que não existem.
  const statements = [];
  const g = aspas(game);
  const semPalavras = [...feitos.novos, ...feitos.palavras, ...feitos.remover];
  statements.push(...listasEmLotes(`DELETE FROM card_words WHERE game=${g} AND id IN`, semPalavras));
  statements.push(...listasEmLotes(`DELETE FROM cards WHERE game=${g} AND id IN`, feitos.remover));
  const comPalavras = [...feitos.novos, ...feitos.palavras];
  statements.push(...insertsEmLotes(
    "INSERT INTO card_words (game,word,id)",
    comPalavras.flatMap((id) => cartas.get(id).words.map(valoresPalavra))
  ));
  const gravar = [...comPalavras, ...feitos.linha];
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
