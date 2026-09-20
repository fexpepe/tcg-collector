// URL da carta na pokemontcg.io — o ESPELHO, no build, da regra do cliente
// (src/shared.js: pokemontcgSetId / pokemontcgImageUrl). O cliente usa a
// pokemontcg.io como imagem PRINCIPAL das cartas EN/PT que a TCGdex cataloga
// sem scan (Trainer Kits, McDonald's, energias, metade do Celebrations —
// ~780 cartas em 20/09/2026) e como fallback das demais. Só que o espelho de
// imagens (scripts/mirror-r2.mjs) enumera o que copiar pela URL `image` do
// catálogo, e nessas cartas ela é vazia: a única imagem que a pessoa vê era
// também a única que nunca chegava ao R2. Aqui o build monta a MESMA URL que
// o cliente montaria, pra o job espelhar. O shared.js não importa módulo;
// tests/pokemontcg-image.test.mjs roda os dois lado a lado.
import { readFile } from "node:fs/promises";

export function pokemontcgSetId(setId, map) {
  if (!setId) return "";
  const m = map || {};
  if (m[setId]) return m[setId];
  return String(setId).toLowerCase()
    .replace(/^sv0*(\d+)\.(\d+)$/, "sv$1pt$2")
    .replace(/^sv0+(\d+)$/, "sv$1");
}

// Só EN e PT (os sets PT espelham a numeração EN); JA/ZH têm numeração própria
// e imagem errada é pior que o verso. O número vai como impresso, inclusive
// prefixos de letra (H29, SM240, TG12), sem zeros à esquerda quando é só
// dígito; nos e-card a pokemontcg.io não zero-preenche os holos H (H07 -> H7).
export function pokemontcgImageUrl(card, map, hires) {
  if (!card || (card.language !== "en" && card.language !== "pt")) return "";
  const setId = pokemontcgSetId(card.setId, map);
  let number = String(card.number || "").split("/")[0].trim();
  if (/^\d+$/.test(number)) number = number.replace(/^0+/, "");
  if (/^ecard\d$/.test(setId)) number = number.replace(/^([A-Za-z]+)0+(?=\d)/, "$1");
  if (!setId || !number || !/^[A-Za-z]*\d+[A-Za-z]?$/.test(number)) return "";
  return `https://images.pokemontcg.io/${setId}/${number}${hires ? "_hires" : ""}.png`;
}

// O de-para versionado (data/set-id-map.js, `window.TCG_SET_ID_MAP = {...};`).
// {} quando o arquivo não existe: a regra geral cobre os ids iguais.
export async function lerSetIdMap(raiz) {
  try {
    const t = await readFile(new URL("data/set-id-map.js", raiz), "utf8");
    const m = /window\.TCG_SET_ID_MAP\s*=\s*(\{[\s\S]*?\});?\s*$/.exec(t);
    return m ? JSON.parse(m[1]) : {};
  } catch { return {}; }
}
