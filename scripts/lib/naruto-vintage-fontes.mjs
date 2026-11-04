// Leitores das fontes do NARUTO カードゲーム (Bandai 2002–2006). Funções puras
// (HTML -> cartas), fora do sync pra o teste conseguir travar cada formato sem
// rodar o build inteiro. Quem usa: scripts/sync-naruto-vintage.mjs (TV Tokyo)
// e scripts/naruto-lista-oficial-bandai.mjs (lista oficial da Bandai).

// ── TV Tokyo (lista oficial dos vols. 1–13, Shift-JIS) ───────────────────────
// Cada carta na página: [<img cardimg/xNNN.jpg>] ... >忍-1< ... <font
// color="#666666">NOME</font>. Prefixos por extenso (作戦/依頼人) viram os
// curtos do jogo (作/依). Nem toda carta tem thumbnail.
//
// A página NÃO é uniforme, e até 2026-11-04 o leitor só entendia o caso
// comum. Ficavam de fora, caladas, 35 cartas (19 que nenhuma outra fonte
// tinha, entre elas 忍-202 Kisame, 忍-203 Itachi e 忍-204 Naruto & Jiraiya):
//   - prefixo em tag própria: <font color="#FFCC66">忍</font>-203
//   - nome em duas linhas:    <font color="#666666">はたけカカシ ＆<br>マイト・ガイ</font>
//   - <font> com atributo:    <font color="#666666" class="size1115">奈良シカマル</font>
//   - nome sem <font>:        <td class="size1115 style1">聖シモン</td>
// O caso comum segue com o MESMO nome de antes (o mapa de tradução e a
// raridade casam pelo nome japonês: mudar um espaço desligaria os dois). Os
// casos novos saem com `nomeSolto: true` — o nome foi montado de pedaços, e o
// sync prefere o da lista oficial da Bandai quando ela tem o número.
export const TVT_PREFIX = { "忍": "忍", "術": "術", "作戦": "作", "依頼人": "依", "騎": "騎" };

const limpaTexto = (s) => String(s)
  .replace(/\s*<br\s*\/?>\s*/gi, "")
  .replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ")
  .trim();

export function parseTvtCards(html) {
  // O prefixo pode vir embrulhado em tags (>…<font>忍</font>-203<); o \s* do
  // fim aceita o espaço que algumas linhas deixam antes do </font>.
  const numRe = />(?:<[^>]+>)*(忍|術|作戦|依頼人|騎)(<\/[^>]+>)*[-ー―−](\d+)\s*</g;
  const hits = [];
  let m;
  while ((m = numRe.exec(html))) {
    hits.push({ at: m.index, prefix: TVT_PREFIX[m[1]], n: Number(m[3]), end: numRe.lastIndex, embrulhado: !!m[2] });
  }
  const cards = [];
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    // imagem: a última cardimg ENTRE a carta anterior e esta (cada bloco tem no
    // máximo uma; carta sem thumb não acha nenhuma no seu trecho).
    const from = i > 0 ? hits[i - 1].end : 0;
    const seg = html.slice(from, h.at);
    const imgs = seg.match(/cardimg\/([a-z]+\d+\.jpg)/g);
    const img = imgs ? imgs[imgs.length - 1].replace("cardimg/", "") : "";
    // Nome só até a próxima carta (sem isso o nome de uma carta sem nome
    // seria o da vizinha).
    const ate = i + 1 < hits.length ? hits[i + 1].at : h.end + 800;
    const tail = html.slice(h.end, Math.min(ate, h.end + 800));
    // Caso comum (o de sempre): primeiro <font cinza> de uma linha só.
    const comum = tail.match(/<font color="#666666">([^<]+)<\/font>/);
    if (comum && !h.embrulhado) {
      cards.push({ num: `${h.prefix}-${h.n}`, name: comum[1].trim(), img });
      continue;
    }
    // Casos soltos: <font cinza> com atributo/<br>, ou o 1º <td> com texto.
    const fonte = tail.match(/<font color="#666666"[^>]*>([\s\S]*?)<\/font>/);
    const td = tail.match(/<td[^>]*>((?:\s|<(?!\/td)[^>]+>)*[^<\s][\s\S]*?)<\/td>/);
    const name = limpaTexto(fonte ? fonte[1] : td ? td[1] : "");
    if (!name) continue;
    cards.push({ num: `${h.prefix}-${h.n}`, name, img, nomeSolto: true });
  }
  return cards;
}

// ── Lista oficial da Bandai (carddas.com/naruto/cardlist/, Wayback) ──────────
// Site oficial do jogo (2002–2007), fora do ar; as capturas de 2006-11 a
// 2007-01 são o estado final. Uma página por produto: 1st..17th (boosters),
// st_* (starters), ex_* (folhas de expansão), bst_nin2, coin_1/2, promo.
// Cada carta é um par de <tr>:
//   <td rowspan="2" …>忍-203</td>
//   <td …><a …><font color="#990000">うちはイタチ</font></a></td>
//   <td …>巻ノ九</td>                      (収録; nas promos, o 配布方法)
//   <tr><td colspan="2">≪真の写輪眼継承者≫ …texto…</td>
// O texto da carta NÃO entra no snapshot (só número, nome e produto).
//
// Numeração: a página das promos não é coerente com ela mesma ("PR-忍-3",
// "PR忍-8" e "PR作15" na mesma tabela; "PR騎-1"). O catálogo usa a grafia do
// tcg-db, "PR忍-3" / "PR騎士-1", e normaliza tudo pra ela. As reimpressões de
// brinde do jogo de PS ("忍-1（PS）") ficam "忍-1(PS)".
export function normNumBandai(raw) {
  let n = limpaTexto(raw).replace(/\s+/g, "").replace(/[－ー―−]/g, "-").replace(/（/g, "(").replace(/）/g, ")");
  n = n.replace(/^PR-(?=\D)/, "PR");
  n = n.replace(/^(PR)?作戦-/, "$1作-").replace(/^(PR)?依頼人?-/, "$1依-");
  n = n.replace(/^PR(忍|術|作|依|騎士?)(\d)/, "PR$1-$2").replace(/^PR騎-/, "PR騎士-");
  return n;
}

export function parseBandaiCardlist(html) {
  const cards = [];
  const re = /<td\s+rowspan="2"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = re.exec(html))) {
    const num = normNumBandai(m[1]);
    if (!/\d/.test(num) || num === "No.") continue; // cabeçalho da tabela
    const name = limpaTexto(m[2]);
    if (!name) continue;
    const where = String(m[3]).replace(/<br\s*\/?>/gi, " / ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    cards.push({ num, name, where });
  }
  return cards;
}
