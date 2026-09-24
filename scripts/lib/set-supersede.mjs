// Um set que ENTROU POR IMPORT (pin `enImport` da TCGCSV, ou import JP inteiro)
// e depois foi publicado pela TCGdex com OUTRO setId: a fonte canônica passa a
// ter o set, o nosso vira duplicata e as duas entradas aparecem na tela de Sets.
//
// Por que isto existe (18/09/2026): o "30th Celebration" entrou em 16/09 pelo
// pin `enImport` como `cel30` + `cel30cc` — o id foi um chute editorial
// (modelado no cel25/cel25cc de 2021, com a aposta declarada de que a TCGdex
// usaria o mesmo). Ela batizou de `30th` e `30th-c`. O pin só sabia comparar o
// id EXATO (`ourIds.has(entry.setId)`), então os chunks da TCGdex nasceram ao
// LADO dos nossos: 4 coleções de 30 anos na tela onde só existem 2. O ajuste de
// numeração da mesma rodada (ids com o número como impresso, `cel30-001`) evita
// duplicar CARTA dentro do mesmo set — não serve pra nada quando o `setId`
// difere.
//
// A régua daqui não usa nome de set (a TCGdex escreve "30th Classic Collection"
// e o TCGplayer "ME: 30th Celebration Classic Collection") nem data: usa o NOME
// DAS CARTAS, em MÃO DUPLA. Metade dos nomes de A em B *e* metade dos de B em A.
// A mão dupla é o que impede um Classic Collection de casar com o set original
// que ele reimprime: `cel25cc` (25 cartas) tem quase todos os nomes dentro do
// `base1` (102), mas o `base1` não tem metade dos seus nomes lá.
//
// Sem rede e sem fs de propósito — é o que os testes travam
// (tests/set-supersede.test.mjs).

// Nome de carta comparável entre as duas fontes. O TCGplayer decora com a
// mecânica entre parênteses e a TCGdex não ("Gengar (Prime)" = "Gengar",
// "Genesect ex (Team Plasma)" = "Genesect EX", "Palkia LV.X" = "Palkia"); o
// sinal de gênero vira letra num lado e símbolo no outro ("Nidoran F" =
// "Nidoran♀") e o acento não conta ("Poke Pad" = "Poké Pad").
export function cardNameKey(name) {
  return String(name || "")
    .replace(/♀/g, " f").replace(/♂/g, " m")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s+lv\.?\s*x\b/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Cartas agrupadas por nome, cada grupo em ordem de número impresso — é essa
// ordem que desempata nome repetido dentro do set (o "Darkrai & Cresselia
// LEGEND" é uma carta em duas metades: Top antes de Bottom nas duas fontes).
function byName(cards) {
  const num = (c) => {
    const n = String(c && c.number || "").split("/")[0].replace(/\D+/g, "");
    return n ? Number(n) : Infinity;
  };
  const m = new Map();
  for (const c of cards || []) {
    const k = cardNameKey(c && c.name);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(c);
  }
  for (const list of m.values()) list.sort((a, b) => num(a) - num(b) || String(a.id).localeCompare(String(b.id)));
  return m;
}

// Quantas cartas de `a` têm nome em `b` (contando repetição: duas "Pikachu" em
// A só casam se B também tiver duas).
function intersect(a, b) {
  let n = 0;
  for (const [k, list] of a) n += Math.min(list.length, (b.get(k) || []).length);
  return n;
}

// Semelhança em MÃO DUPLA entre dois chunks: a MENOR das duas frações. Zero
// quando um dos lados é pequeno demais pra a conta dizer algo (< 5 cartas).
export function chunkSimilarity(aCards, bCards) {
  const a = (aCards || []).length, b = (bCards || []).length;
  if (a < 5 || b < 5) return 0;
  const n = intersect(byName(aCards), byName(bCards));
  return Math.min(n / a, n / b);
}

// De-para carta a carta entre o chunk importado e o da TCGdex, pelo nome (e,
// dentro do mesmo nome, pela ordem de número). Devolve também as imagens que
// só o importado tem — a TCGdex publica o set antes da arte de algumas cartas,
// e o tile ficaria em branco onde hoje tem a arte do TCGplayer.
//   { cards: { <id velho>: <id novo> }, images: { <id novo>: url }, unmatched: [ids] }
export function pairCards(oldCards, newCards) {
  const a = byName(oldCards), b = byName(newCards);
  const cards = {};
  const images = {};
  let unmatched = [];
  for (const [k, list] of a) {
    const alvo = b.get(k) || [];
    list.forEach((c, i) => {
      const novo = alvo[i];
      if (!novo) { unmatched.push(c.id); return; }
      cards[c.id] = novo.id;
      if (c.image && !novo.image) images[novo.id] = c.image;
    });
  }
  // 2º passo, pelo NÚMERO impresso — só quando a numeração se preservou entre
  // as duas fontes (80%+ dos pares por nome têm o mesmo número): aí "mesmo
  // número" É a mesma carta, e o nome que não casou foi decoração que o
  // cardNameKey não previu ("Team Rocket's Mewtwo ex" × "Mewtwo ex"). Onde a
  // numeração mudou (Classic Collection) o passo não roda: número igual seria
  // outra carta. Uma carta sem par sumia da conta de quem a marcou
  // (20/09/2026) — o que sobrar daqui vira chunk CONGELADO no
  // retire-imported-sets, nunca id perdido.
  if (unmatched.length) {
    const velhosPorId = new Map((oldCards || []).map((c) => [c.id, c]));
    const novosPorId = new Map((newCards || []).map((c) => [c.id, c]));
    const pares = Object.entries(cards);
    const preservados = pares.filter(([v, n]) => numberKey(velhosPorId.get(v)) && numberKey(velhosPorId.get(v)) === numberKey(novosPorId.get(n))).length;
    if (pares.length && preservados / pares.length >= 0.8) {
      const usados = new Set(Object.values(cards));
      const livresPorNumero = new Map();
      for (const n of newCards || []) {
        const k = numberKey(n);
        if (k && !usados.has(n.id) && !livresPorNumero.has(k)) livresPorNumero.set(k, n);
      }
      unmatched = unmatched.filter((id) => {
        const c = velhosPorId.get(id);
        const novo = livresPorNumero.get(numberKey(c));
        if (!novo || usados.has(novo.id)) return true;
        cards[id] = novo.id;
        usados.add(novo.id);
        if (c.image && !novo.image) images[novo.id] = c.image;
        return false;
      });
    }
  }
  return { cards, images, unmatched };
}
// Número impresso comparável: "001" = "1", "TG05" = "tg5"; sem o "/total".
function numberKey(c) {
  return String(c && c.number || "").split("/")[0].trim().toLowerCase().replace(/^([a-z]*)0+(?=\d)/, "$1");
}

// Chunk CONGELADO: o que sobrou de um set aposentado sem par no set da TCGdex.
// Toda carta leva `retired: <setId novo>`; o merge marca a entrada do manifest
// e o cliente esconde o set da lista, mas o id continua resolvendo — é a
// regra do catálogo inteiro ("carta indexada nunca some") valendo também aqui.
export function isRetiredChunk(cards) {
  return Array.isArray(cards) && cards.length > 0 && cards.every((c) => c && c.retired);
}

// A troca é um PREFIXO puro quando todo id velho é `<from>-<resto>` e o novo é
// `<to>-<mesmo resto>` — é o caso do set principal, onde só o id do set errou
// (cel30-001 -> 30th-001). Aí a migração do app guarda uma linha em vez de 158.
export function isPrefixSwap(cards, from, to) {
  const ids = Object.keys(cards || {});
  if (!ids.length) return false;
  return ids.every((velho) => velho.startsWith(`${from}-`)
    && cards[velho] === `${to}-${velho.slice(from.length + 1)}`);
}

// Sets importados que a TCGdex já publicou com outro id.
//   chunks: [{ lang, setId, cards }] (todos os idiomas)
//   importedIds: Set dos setIds que entraram por import (pins `enImport`)
//   minSimilarity: piso da semelhança em mão dupla (padrão 0,5)
// Devolve [{ lang, from, to, similarity, ...pairCards }], só quando o vencedor
// é ÚNICO: dois candidatos empatados no topo viram aviso de quem chama, não
// exclusão (apagar chunk é irreversível pras contas).
export function findSupersededImports(chunks, importedIds, { minSimilarity = 0.5 } = {}) {
  const importados = importedIds instanceof Set ? importedIds : new Set(importedIds || []);
  const out = [];
  for (const chunk of chunks || []) {
    if (!importados.has(chunk.setId)) continue;
    // Já aposentado e congelado (o que sobrou sem par): não é candidato de
    // nada — nem a ser aposentado de novo, nem a receber outro set.
    if (isRetiredChunk(chunk.cards)) continue;
    const pontuados = (chunks || [])
      .filter((o) => o.lang === chunk.lang && o.setId !== chunk.setId && !importados.has(o.setId) && !isRetiredChunk(o.cards))
      .map((o) => ({ o, s: chunkSimilarity(chunk.cards, o.cards) }))
      .filter((x) => x.s >= minSimilarity)
      .sort((x, y) => y.s - x.s);
    if (!pontuados.length) continue;
    if (pontuados.length > 1 && pontuados[1].s === pontuados[0].s) {
      out.push({ lang: chunk.lang, from: chunk.setId, ambiguous: pontuados.filter((x) => x.s === pontuados[0].s).map((x) => x.o.setId) });
      continue;
    }
    const alvo = pontuados[0].o;
    out.push(Object.assign(
      { lang: chunk.lang, from: chunk.setId, to: alvo.setId, similarity: pontuados[0].s },
      pairCards(chunk.cards, alvo.cards)
    ));
  }
  return out;
}

// Id novo de uma carta aposentada, pelo de-para do data/card-id-merges.json
// ({ prefixes, cards }); "" quando o id não mudou. MESMA regra do mergedCardId
// do src/shared.js — lá a tabela chega carimbada e enxuta ({ p, c }), aqui vem
// do arquivo. Usada pelo lint (id que sumiu mas tem destino não é perda).
export function resolveMergedId(id, merges) {
  const s = String(id || "");
  const m = merges || {};
  const cards = m.cards || {}, prefixes = m.prefixes || {};
  if (cards[s]) return cards[s];
  const corte = s.indexOf("-");
  if (corte > 0 && prefixes[s.slice(0, corte)]) return prefixes[s.slice(0, corte)] + s.slice(corte);
  return "";
}

// Carimbo do de-para no src/shared.js (marcador SLEEVU_ID_MERGES). Recebe o
// TEXTO do núcleo e devolve o texto novo — sem fs, pra dois passos do build
// usarem a mesma régua: o retire-imported-sets (set inteiro aposentado) e o
// merge-catalogs (id provisório que ganhou gêmea oficial). O payload é enxuto
// de propósito (a troca de prefixo cobre um set inteiro numa linha) porque vai
// no núcleo, que tem teto de peso.
//   s: de-para de setId (link de set compartilhado com o id velho);
//   p: troca de prefixo de cardId; c: cardId par a par.
export const ID_MERGES_MARCA = /const ID_MERGES = \{[^;]*\}; \/\* SLEEVU_ID_MERGES \*\//;
export function idMergesPayload(merges) {
  const m = merges || {};
  return {
    s: Object.fromEntries((m.sets || []).filter((x) => x && x.from && x.to).map((x) => [x.from, x.to])),
    p: m.prefixes || {},
    c: m.cards || {}
  };
}
export function stampIdMerges(src, merges) {
  if (!ID_MERGES_MARCA.test(src)) throw new Error("marcador SLEEVU_ID_MERGES não encontrado em src/shared.js");
  return src.replace(ID_MERGES_MARCA, `const ID_MERGES = ${JSON.stringify(idMergesPayload(merges))}; /* SLEEVU_ID_MERGES */`);
}
