// A régua do lint-catalog (data/catalog-baseline.json) como função pura, pra
// poder ser testada — o scripts/lint-catalog.mjs tem efeito colateral no topo
// (lê o disco, roda o git, sai com process.exit) e não dá pra importar.
//
// POR QUE EXISTE: até 22/11/2026 a trava de "catálogo ZEROU" nunca disparava.
// O lint fazia `const sample = cards.length < 100` e só aplicava a régua quando
// `!sample`; zero é menor que 100, então um catálogo VAZIO caía no atalho de
// "amostra local" e passava. Pior: quando o jogo não tinha nem cards.js nem
// chunks, o readCards devolvia null e o laço pulava calado ("sem catálogo, ok
// se o jogo ainda não tem dados") — mesmo com a régua dizendo que o jogo tinha
// milhares de cartas. Um sync que falhasse e deixasse o catálogo vazio ou
// ausente (os syncs têm "|| echo" de resiliência) ia pro ar sem ninguém ver.
//
// A regra, em uma frase: com régua (base.cards > 0), catálogo VAZIO ou NÃO LIDO
// é erro duro; de 1 a 99 cartas continua valendo o atalho de amostra (é o
// Pokémon de desenvolvimento, com 13); de 100 pra cima vale a comparação normal
// (queda vs a régua é só aviso).
//
// Sem régua (jogo novo) ou com régua 0 (o JUMP, que ainda não tem catálogo),
// vazio e não lido passam: não há o que ter perdido.

// Abaixo disto o catálogo é tratado como amostra local e a régua não se aplica
// (exceto vazio/não lido, ver acima).
export const LIMITE_DE_AMOSTRA = 100;

// Conta o que a régua e o log precisam. `cards` já lido e não vazio; as cartas
// quebradas (sem id/nome/set) não entram na conta de imagem, como sempre foi.
export function medeCatalogo(cards) {
  const seen = new Set();
  let dupes = 0, broken = 0, withImage = 0;
  for (const c of cards) {
    if (!c || !c.id || !c.name || !c.set) { broken++; continue; }
    if (seen.has(c.id)) dupes++;
    seen.add(c.id);
    if (c.image) withImage++;
  }
  const sets = new Set(cards.map((c) => c.set)).size;
  const imgPct = cards.length ? Math.round((withImage / cards.length) * 100) : 0;
  return { cards: cards.length, sets, imgPct, dupes, broken };
}

// jogo: slug (só pra mensagem). cards: array lido, ou null quando não existe
// nem cards.js nem chunk. base: entrada do catalog-baseline.json ({cards, sets,
// imgPct}) ou undefined. Devolve { errors, warnings, amostra }; `amostra` diz
// que a régua não foi aplicada (o lint mantém a régua antiga no
// --update-baseline).
export function avaliaRegua(jogo, cards, base) {
  const errors = [];
  const warnings = [];
  const regua = base && base.cards > 0 ? base.cards : 0;
  const n = Array.isArray(cards) ? cards.length : 0;

  // Sem régua não há o que cobrar. (Jogo que ainda não tem dado: baseline 0.)
  if (!regua) return { errors, warnings, amostra: n < LIMITE_DE_AMOSTRA };

  if (!Array.isArray(cards)) {
    errors.push(`${jogo}: catálogo NÃO LIDO (sem cards.js nem chunks; régua: ${regua}) — o sync falhou ou o dado não veio?`);
    return { errors, warnings, amostra: false };
  }
  if (n === 0) {
    errors.push(`${jogo}: catálogo ZEROU (régua: ${regua})`);
    return { errors, warnings, amostra: false };
  }
  // 1 a 99 cartas: amostra local (Pokémon de desenvolvimento). Não aplica régua.
  if (n < LIMITE_DE_AMOSTRA) return { errors, warnings, amostra: true };

  const { sets, imgPct } = medeCatalogo(cards);
  if (n < regua) warnings.push(`${jogo}: ${n} cartas < régua ${regua} (regressão?)`);
  if (sets < base.sets) warnings.push(`${jogo}: ${sets} sets < régua ${base.sets}`);
  if (base.imgPct && imgPct < base.imgPct - 10) warnings.push(`${jogo}: imagens ${imgPct}% (régua ${base.imgPct}%)`);
  return { errors, warnings, amostra: false };
}
