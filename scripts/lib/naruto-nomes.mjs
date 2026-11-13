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
