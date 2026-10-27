// One Piece Collection (onepiececollection.fr) — fã-site francês com scan
// carta a carta das linhas vintage japonesas. Usado onde o Grand Line Wiki não
// tem scan: o Carddass Hyper Battle (mirror-vintage-images.mjs) e o One Piece
// Card Game de 2002–2005 (scans-onepiece-2002.mjs).
//
// Cada linha é uma categoria (idc: 19 = Carddass Hyper Battle, 2 = Card Game),
// e cada set dela é uma página cartes.php?idc=<idc>&ids=<set>. Nela, cada carta
// é um <td class="bloc_carte"> com o número em .bc_texte_numero e o caminho do
// scan em afficher_detail('<id>','<idc>/<set>/h400_<id>'); a imagem fica em
// cartes/<caminho>_carte.jpg. O maior scan publicado tem 400 px de altura
// (~270 de largura) e vem com a marca d'água do site no canto — o Fernando
// aceitou assim em 2026-10-27, melhor que o placeholder. Só HTTP.
import { sleep } from "./sync-common.mjs";

export const OPC = "www.onepiececollection.fr";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };

// Mesmo número escrito igual nas duas fontes: "S09" × "S9", "FP01" × "FP1".
// Números com hífen ("LK-C01") passam só pelo maiúsculo.
export const numKey = (n) => String(n).trim().toUpperCase().replace(/^([A-Z]*)0*(\d+)$/, "$1$2");

// URL do scan pelo wsrv.nl (o mesmo proxy dos outros vintages; o espelho do
// R2 copia daí). Sem ampliar (&we): o scan já é menor que 440.
export const opcImageUrl = (path) => `https://wsrv.nl/?url=${encodeURIComponent(`${OPC}/cartes/${path}_carte.jpg`)}&w=440&we&output=webp`;

async function page(q) {
  try {
    const r = await fetch(`http://${OPC}/cartes.php?${q}`, { headers: UA, signal: AbortSignal.timeout(20000) });
    return r.ok ? await r.text() : "";
  } catch { return ""; }
}

// Os sets de uma linha, na ordem do site: [{ ids, cards: [{ num, path }] }].
// Corta por carta antes de casar: carta sem scan não pode herdar o da vizinha.
// Uma carta pode aparecer duas vezes no mesmo set (normal e foil, mesma arte,
// sem marca no HTML que diga qual é qual) — as duas vêm, na ordem do site.
export async function opcSeries(idc) {
  const index = await page(`idc=${idc}`);
  const ids = [...new Set([...index.matchAll(new RegExp(`cartes\\.php\\?idc=${idc}&ids=(\\d+)`, "g"))].map((m) => m[1]))];
  const series = [];
  for (const id of ids) {
    const cards = [];
    for (const block of (await page(`idc=${idc}&ids=${id}`)).split('class="bloc_carte"').slice(1)) {
      const num = (block.match(/bc_texte_numero">([^<]+)</) || [])[1];
      const path = (block.match(/afficher_detail\('\d+',\s*'([^']+)'\)/) || [])[1];
      if (num && path) cards.push({ num: num.trim(), path });
    }
    series.push({ ids: id, cards });
    await sleep(400); // fã-site: uma página por vez
  }
  return series;
}

// Número -> caminho, pela 1ª ocorrência na ordem do site (reimpressão em set
// posterior e a 2ª cópia normal/foil ficam de fora).
export function firstByNum(series) {
  const map = new Map();
  for (const s of series) for (const c of s.cards) if (!map.has(numKey(c.num))) map.set(numKey(c.num), c.path);
  return map;
}
