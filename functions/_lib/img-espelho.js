// A URL do espelho de imagens (R2, img.sleevu.app) calculada NA BORDA
// (2026-11-22), pra página da carta já levar a imagem no HTML.
//
// Quem chega do Google numa carta só descobria a imagem depois de o
// JavaScript montar o popup (7,3 s no 4G lento). Com a URL no HTML, o
// navegador a pede junto do CSS. Pra isso a borda precisa saber QUAIS hosts de
// origem já estão completos no espelho: é a mesma lista que o deploy carimba
// no src/game.js, e o scripts/apply-img-mirror.mjs passa a carimbar este
// arquivo também, nos MESMOS marcadores (SLEEVU_IMG_MIRROR, _GEN e _450). Sem
// o carimbo (dev, ou espelho fora do ar no deploy) as listas ficam vazias e a
// borda não monta imagem nenhuma: a página sai como sempre.
//
// A função é CÓPIA de propósito de `urlEspelho` (scripts/lib/img-mirror.mjs)
// e do `mirrorImg` do cliente (src/shared.js): o deploy apaga `scripts/` antes
// do `wrangler pages deploy`, então a borda não pode importar de lá. O
// tests/img-mirror.test.mjs trava as três contra os mesmos casos; mudou a regra
// num lugar, tem de mudar nos três.
const ESPELHO = "https://img.sleevu.app/";
var IMG_MIRROR_HOSTS = []; /* SLEEVU_IMG_MIRROR */
var IMG_MIRROR_GEN = {}; /* SLEEVU_IMG_MIRROR_GEN */
var IMG_MIRROR_450 = []; /* SLEEVU_IMG_MIRROR_450 */

// Base da chave: host + caminho, sem query. No wsrv.nl a URL é toda query e a
// base sai do parâmetro `url` (host e caminho de ORIGEM, decodificados).
function chaveBase(u) {
  const x = new URL(u);
  if (x.host !== "wsrv.nl") return x.host + x.pathname;
  const q = /[?&]url=([^&]+)/.exec(u);
  return q ? `wsrv.nl/${decodeURIComponent(q[1]).replace(/^https?:\/\//, "")}` : "";
}

// A regra pura, com as listas por parâmetro (o teste passa as suas).
// `geracoes`: host -> n; ausente = 1 (sem sufixo na chave).
export function urlDoEspelhoCom(u, w, hosts, geracoes) {
  const m = /^https:\/\/([^/?#]+)(\/[^?#]*)/.exec(String(u || ""));
  if (!m || !hosts || hosts.indexOf(m[1]) < 0) return "";
  let b;
  try { b = chaveBase(u); } catch (e) { return ""; }
  if (!b) return "";
  const g = (geracoes && geracoes[m[1]]) || 1;
  return `${ESPELHO}${m[1] === "wsrv.nl" ? encodeURI(b) : b}@${w}${g > 1 ? `.g${g}` : ""}.webp`;
}

// URL espelhada de `u` na largura `w` com a lista que o deploy carimbou, ou ""
// se o host não está (ainda) completo no espelho.
export function urlDoEspelho(u, w) {
  return urlDoEspelhoCom(u, w, IMG_MIRROR_HOSTS, IMG_MIRROR_GEN);
}
