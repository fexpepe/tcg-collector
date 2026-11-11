// O que separa uma carta das outras do set que sairiam com o MESMO título
// (2026-11-11).
//
// Duas cartas com o mesmo nome e número no mesmo set saíam com o mesmo
// título, o mesmo h1 e a mesma descrição: a impressão em português na página
// do set inglês ("Charizard ex 006/165 · 151", endereço com "-pt"), a de
// chinês simplificado e a de tradicional, que dividem a página do set
// ("Budew 001/187", endereços "-zh" e "-zh-2"), a Common e a Ultra Rare do
// Yu-Gi-Oh!. O relatório de Páginas de 10/11 (docs/SEO.md) contou 113 delas
// em "Cópia, o Google escolheu uma canônica diferente": com o mesmo título e
// quase o mesmo texto, o Google fica com uma e larga a outra, que é outra
// carta, com outro preço.
//
// Aqui sai o rótulo que a página põe ao lado do número ("português",
// "chinês tradicional", "Ultra Rare"). O endereço não muda: o Google já tem
// esses endereços.
//
// Medido em 11/11 com todos os jogos (350 mil cartas): 3.112 cartas dividiam
// o título com outra da mesma página de set; com o rótulo, 122. Essas 122 são
// a mesma carta guardada duas vezes no catálogo (as promos chinesas S-PC e
// SM-PC, que a lista da Bulbapedia traz em dobro; repetidas da The List do
// Magic; Gundam War, Carddass e WoW em que só a imagem muda): sem um fato que
// as separe, ficam como estão, sem rótulo inventado.
import { cardCode } from "./card-code.js";

// Edição no rótulo, em português (o texto da página é em português). Os
// outros idiomas separam o endereço ("-jp", "-pt"), mas não o título; zh-cn
// e zh-tw nem o endereço ("-zh" os dois).
const EDICAO = {
  "zh-cn": "chinês simplificado",
  "zh-tw": "chinês tradicional",
  "zh-hk": "chinês tradicional",
  ja: "japonês",
  ko: "coreano",
  pt: "português",
  en: "inglês"
};
function edicao(card) {
  const l = String((card && card.language) || "en").toLowerCase();
  return EDICAO[l] || EDICAO[l.slice(0, 2)] || l;
}
function raridade(card) {
  const r = String((card && card.rarity) || "").trim();
  return r && r !== "None" ? r : "";
}
function acabamentos(card) {
  return Array.isArray(card && card.variants) ? card.variants.filter(Boolean).join(", ") : "";
}

// Dentro da mesma edição, o que pode separar, na ordem em que o colecionador diz.
const FATOS = [raridade, acabamentos];

// O rótulo desta carta, ou "" quando ela já tem título próprio ou quando
// nada no catálogo a separa das outras. "Iguais" são as cartas do set com o
// mesmo nome e o mesmo número impresso, que é o que o título mostra (o
// endereço pode até ser outro: a impressão em português mora na página do
// set inglês, com "-pt" no endereço e o mesmo título).
// Primeiro a edição: separa das iguais de outro idioma. A inglesa é a padrão
// do catálogo e não ganha rótulo; as outras ganham ("português", "chinês
// tradicional"). Dentro da mesma edição, a raridade ou o acabamento; numa
// edição que não é a inglesa e que divide o título com outra edição, os
// dois juntos ("português, Double Rare"), senão a portuguesa e a inglesa de
// mesma raridade sairiam iguais de novo.
export function rotuloDoDesempate(card, cartas) {
  if (!card) return "";
  const nome = String(card.name || "");
  const codigo = cardCode(card);
  const iguais = (cartas || []).filter((c) => c && c.id !== card.id &&
    String(c.name || "") === nome && cardCode(c) === codigo);
  if (!iguais.length) return "";
  const minha = edicao(card);
  const mesmaEdicao = iguais.filter((c) => edicao(c) === minha);
  const rotuloDaEdicao = minha === EDICAO.en ? "" : minha;
  if (!mesmaEdicao.length) return rotuloDaEdicao;
  for (const fato of FATOS) {
    const meu = fato(card);
    if (!meu || !mesmaEdicao.every((c) => fato(c) !== meu)) continue;
    const outraEdicao = mesmaEdicao.length < iguais.length;
    return rotuloDaEdicao && outraEdicao ? `${rotuloDaEdicao}, ${meu}` : meu;
  }
  return "";
}
