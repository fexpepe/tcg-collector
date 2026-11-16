// Nome japonês de carta de Naruto -> inglês, pelo mapa que o
// translate-naruto-names.mjs já usa (scripts/data/naruto-names-en.json). Pros
// syncs que traduzem na hora de montar a carta, e não no passo do deploy: o
// Carddass Masters do filme mora no jogo cdm (fora do catálogo do Naruto), e
// a 忍術大全 monta o nome com duas partes ("jutsu (quem usa)"), que o mapa não
// tem como chave.
import { readFileSync } from "node:fs";

let mapaLido = null;
export function mapaNaruto() {
  if (!mapaLido) {
    try { mapaLido = JSON.parse(readFileSync(new URL("../data/naruto-names-en.json", import.meta.url), "utf8")); } catch (e) { mapaLido = {}; }
  }
  return mapaLido;
}

// O nome inteiro pelo mapa; senão, "A＆B＆C" com todas as partes no mapa vira
// "A & B & C". Não divide no "・": ele faz parte de nome (ロック・リー,
// マイト・ガイ). null = sem tradução (quem chama fica com o japonês).
export function nomeEn(ja, mapa = mapaNaruto()) {
  const s = String(ja || "").trim();
  if (!s) return null;
  if (mapa[s]) return mapa[s];
  const partes = s.split(/[＆&]/).map((p) => p.trim()).filter(Boolean);
  if (partes.length > 1 && partes.every((p) => mapa[p])) return partes.map((p) => mapa[p]).join(" & ");
  return null;
}

// Nome do SET em inglês (14/11/2026, decisão do Fernando: traduzir, como as
// cartas). A fonte é o VINTAGE_SET_EN do src/nomes-sets.js — o mesmo mapa que
// a tela já usava pra exibir —, lido pelo texto num vm, pra não existir uma
// segunda lista que divirja da primeira. Chave = setId.
let setsLidos = null;
export function mapaDeSetsEn() {
  if (!setsLidos) {
    try {
      const fonte = readFileSync(new URL("../../src/nomes-sets.js", import.meta.url), "utf8");
      const janela = {};
      new Function("window", fonte)(janela);
      setsLidos = (janela.SLEEVU_NOMES_SETS && janela.SLEEVU_NOMES_SETS.vintage) || {};
    } catch (e) { setsLidos = {}; }
  }
  return setsLidos;
}

const temCjk = (s) => /[぀-ヿ一-鿿]/.test(String(s || ""));

// Traduz o set da carta NO LUGAR: `set` vira o inglês e o japonês vai pro
// `setJp`. Idempotente pelo mesmo truque do nome da carta: a chave é
// `setJp || set`, então rodar de novo sobre o snapshot já traduzido não muda
// nada. Set sem tradução no mapa fica em japonês (devolve false).
export function traduzSet(carta, mapa = mapaDeSetsEn()) {
  const original = carta.setJp || carta.set;
  if (!temCjk(original)) return false;
  const en = mapa[carta.setId];
  if (!en) return false;
  carta.setJp = original;
  carta.set = en;
  return true;
}
