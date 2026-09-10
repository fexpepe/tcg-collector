// Espelho de imagens de carta no R2 (img.sleevu.app) — a parte PURA e
// compartilhada: quais hosts se espelha, qual é a MELHOR imagem de cada fonte
// (a "matriz"), as larguras geradas a partir dela e a URL espelhada. Usada
// pelo job (scripts/mirror-r2.mjs), pelo passo do deploy
// (scripts/apply-img-mirror.mjs) e pelos testes. O cliente (src/shared.js,
// mirrorImg) tem a SUA cópia da regra da URL — sem bundler não dá pra
// importar — e tests/img-mirror.test.mjs trava as duas no mesmo resultado.
//
// Esquema 2 (10/09/2026): o espelho gera as PRÓPRIAS variantes. A primeira
// versão copiava byte a byte as variantes que cada fonte publica, e cada
// fonte publica um tamanho diferente: o Scryfall só tinha a 488px (grande
// demais na grade, pequena no popup), o TCGplayer pulava de 400 pra 1000, os
// vintages tinham só 440. Agora o job baixa a matriz uma vez, gera WebP em
// três larguras — 300 (grade em tela comum), 600 (grade em tela 2x/3x) e
// 1000 (popup) — e o site usa srcset em TODAS as fontes, como já fazia só na
// TCGdex. Nunca amplia: matriz menor que a largura pedida sai no tamanho
// que tem (a chave continua a mesma, pra não haver 404 no srcset).
//
// Chave: <host><caminho da URL do catálogo>@<largura>.webp. A URL do catálogo
// é a que os syncs gravam (a que o job vê em `image`), então o cliente monta
// a chave a partir dela sem saber qual variante o job baixou como matriz.
export const ESPELHO = "https://img.sleevu.app/";
export const ESQUEMA_ESPELHO = 2;
export const LARGURAS = [300, 600, 1000];
export const QUALIDADE_WEBP = 80;

const RE_TCGDEX = /(?:\/(?:low|high))?\.(?:png|webp|jpg)$/;

// `matriz(u)`: a melhor imagem que a fonte publica pra URL do catálogo `u` —
// é o que o job baixa. concorrencia/intervaloMs: educação com a fonte (o
// Scryfall pede no máximo 10 req/s; os outros não publicam limite, mas são
// CDNs de terceiros que não devem nada à gente). `mutavel`: a origem troca a
// arte NA MESMA URL — o TCGplayer publica a carta com arte provisória e
// substitui quando o scan chega (caso Gundam documentado no sw.js) — então
// cartas de set recente são conferidas de novo por um tempo.
export const FONTES = {
  // Vintage (Naruto, Hunter × Hunter, One Piece Carddass/2002, Miracle
  // Battle): scans de fã-sites e wikis, pedidos via proxy wsrv.nl. A matriz
  // é o mesmo proxy a 1000px (ele faz o resize pesado do scan de 7 MB por
  // nós; daí as três larguras saem daqui). Primeiro na ordem: são ~5 mil
  // cartas, e é onde o espelho mais vale — fã-site morre sem aviso.
  "wsrv.nl": {
    concorrencia: 2, intervaloMs: 300,
    matriz: (u) => { const q = /[?&]url=([^&]+)/.exec(u); return q ? `https://wsrv.nl/?url=${q[1]}&w=1000&output=webp` : ""; }
  },
  "cards.lorcast.io": {
    concorrencia: 3, intervaloMs: 100,
    matriz: (u) => u.replace("/card/digital/normal/", "/card/digital/large/")
  },
  "tcgplayer-cdn.tcgplayer.com": {
    concorrencia: 6, intervaloMs: 50, mutavel: true,
    matriz: (u) => u.replace("_in_400x400.jpg", "_in_1000x1000.jpg")
  },
  // high.webp tem 600×825, a mesma resolução do high.png com 1/6 do peso.
  "assets.tcgdex.net": {
    concorrencia: 6, intervaloMs: 50,
    matriz: (u) => u.replace(RE_TCGDEX, "/high.webp")
  },
  // large = 672×936 (o png de 745×1040 pesa 1 MB por carta e não muda nada
  // numa saída de no máximo 1000px).
  "cards.scryfall.io": {
    concorrencia: 2, intervaloMs: 200,
    matriz: (u) => u.replace("/normal/", "/large/")
  }
};
// Ordem do rollout: vintages, Lorcana e One Piece primeiro (host único sem
// fallback, e o "exportar imagem" depende de proxy de CORS pra eles), Scryfall
// por último (o maior, e a CDN mais confiável).
export const ORDEM = Object.keys(FONTES);

export function hostDe(u) { try { return new URL(u).host; } catch { return ""; } }
// Base da chave: host + caminho, SEM query. No wsrv.nl a URL é toda query e a
// base sai do parâmetro `url` (host e caminho de ORIGEM, decodificados).
export function chaveBase(u) {
  const x = new URL(u);
  if (x.host !== "wsrv.nl") return x.host + x.pathname;
  const q = /[?&]url=([^&]+)/.exec(u);
  return q ? `wsrv.nl/${decodeURIComponent(q[1]).replace(/^https?:\/\//, "")}` : "";
}
export const chaveDe = (u, w) => { const b = chaveBase(u); return b ? `${b}@${w}.webp` : ""; };
// Versão: a query do Scryfall (?1783943085) é um carimbo da arte — muda,
// baixa de novo. Os outros não têm.
export function versaoDe(u) { const x = new URL(u); return x.host === "wsrv.nl" ? "" : x.search.replace(/^\?/, ""); }
export function matrizDe(u) {
  const f = FONTES[hostDe(u)];
  return f && chaveBase(u) ? f.matriz(u) : "";
}
// URL espelhada da URL do catálogo `u` na largura `w`, se o host estiver na
// lista dos COMPLETOS (o deploy injeta a lista no game.js). Mesma regra do
// cliente. encodeURI só no wsrv: espaço e kana dos fã-sites viram %XX (o que
// o navegador faria com o src); os outros caminhos já são ASCII limpo.
export function urlEspelho(u, hosts, w) {
  const m = /^https:\/\/([^/?#]+)(\/[^?#]*)/.exec(String(u || ""));
  if (!m || !hosts || hosts.indexOf(m[1]) < 0) return "";
  const b = chaveBase(u);
  if (!b) return "";
  return `${ESPELHO}${m[1] === "wsrv.nl" ? encodeURI(b) : b}@${w}.webp`;
}
