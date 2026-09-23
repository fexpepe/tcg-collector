// Cartas BÔNUS de set: listadas no set, fora do 100% (e do valor do "set
// completo"). ESPELHO de src/shared.js (BONUS_CARDS / isBonusCard) — o shared
// não importa módulo, e o manifest (setManifestMeta, no build) tem que excluir
// as mesmas cartas que a página do set exclui. tests/bonus-cards.test.mjs
// confere as duas tabelas; mudou uma, muda a outra.
//
// Nasceu com o Mew RGB da 30th Celebration (23/09/2026): "R/RGB", "G/RGB",
// "B/RGB" fora da numeração, tiragem desconhecida, ~US$ 20 mil cada. A regra é
// pelo id (setId + número) porque é o dado que todo contador tem.
export const BONUS_CARDS = { "30th": ["R", "G", "B"], "M6a": ["R", "G", "B"] };

export function isBonusCardId(cardId) {
  const base = String(cardId || "").replace(/-(pt|ja|zh-cn|zh-tw|zh)$/, "");
  const dash = base.lastIndexOf("-");
  if (dash <= 0) return false;
  const lista = BONUS_CARDS[base.slice(0, dash)];
  return !!lista && lista.includes(base.slice(dash + 1));
}
