// Espelho de imagens de carta no R2 (img.sleevu.app) — a parte PURA e
// compartilhada: quais hosts se espelha, quais VARIANTES de cada URL o site
// pede (é isso que vai pro bucket, byte a byte — nada é redimensionado aqui),
// a chave no bucket e a URL espelhada. Usada pelo job (scripts/mirror-r2.mjs),
// pelo passo do deploy (scripts/apply-img-mirror.mjs) e pelos testes. O
// cliente (src/shared.js, mirrorImageUrl) tem a SUA cópia da regra da URL —
// sem bundler não dá pra importar — e tests/img-mirror.test.mjs trava as duas
// no mesmo resultado.
//
// Por que "variantes": o cliente não exibe a URL do catálogo como está. Da
// TCGdex ele pede low.webp (grade) e high.webp (popup); do TCGplayer, a
// _in_400x400 na grade e a _in_1000x1000 no popup; do Lorcast, /normal/ e
// /large/. Espelhar só a URL do catálogo deixaria a grade inteira no 404 do
// espelho. A chave é host + caminho: a URL espelhada carrega o host de origem
// no caminho, então os `indexOf("assets.tcgdex.net")` do cliente continuam
// reconhecendo a fonte e derivando as variantes do jeito de sempre.
export const ESPELHO = "https://img.sleevu.app/";

const RE_TCGDEX = /(?:\/(?:low|high))?\.(?:png|webp|jpg)$/;

// concorrencia/intervaloMs: educação com a fonte (o Scryfall pede no máximo
// 10 req/s; os outros não publicam limite, mas são CDNs de terceiros que não
// devem nada à gente). `mutavel`: a origem troca a arte NA MESMA URL — o
// TCGplayer publica a carta com arte provisória e substitui quando o scan
// chega (caso Gundam documentado no sw.js) — então cartas de set recente são
// conferidas de novo por um tempo.
export const FONTES = {
  // Vintage (Naruto, Hunter × Hunter, One Piece Carddass/2002, Miracle
  // Battle): os scans vivem em fã-sites e wikis e o site os pede
  // redimensionados pelo proxy wsrv.nl (440px webp). A URL é toda query, e a
  // chave sai do parâmetro `url` (ver chaveWsrv). Primeiro na ordem: são ~5
  // mil objetos, e é o caso em que o espelho mais vale — fã-site morre sem
  // aviso, e o proxy é ponto único de falha de 3 jogos. Concorrência baixa:
  // é um serviço gratuito de terceiro fazendo o resize por nós.
  "wsrv.nl": {
    concorrencia: 2, intervaloMs: 300,
    variantes: (u) => [u]
  },
  "cards.lorcast.io": {
    concorrencia: 3, intervaloMs: 100,
    variantes: (u) => [u.replace("/card/digital/large/", "/card/digital/normal/"), u]
  },
  "tcgplayer-cdn.tcgplayer.com": {
    concorrencia: 6, intervaloMs: 50, mutavel: true,
    variantes: (u) => [u.replace("_in_1000x1000.jpg", "_in_400x400.jpg"), u]
  },
  "assets.tcgdex.net": {
    concorrencia: 6, intervaloMs: 50,
    variantes: (u) => [u.replace(RE_TCGDEX, "/low.webp"), u.replace(RE_TCGDEX, "/high.webp")]
  },
  "cards.scryfall.io": {
    concorrencia: 2, intervaloMs: 200,
    variantes: (u) => [u]
  }
};
// Ordem do rollout (docs/PLANO-UX-2.md, P2): Lorcana e One Piece primeiro —
// host único sem fallback, e o "exportar imagem" depende de um proxy de CORS
// pra eles — e o Scryfall por último (o maior, e a CDN mais confiável).
export const ORDEM = Object.keys(FONTES);

export function hostDe(u) { try { return new URL(u).host; } catch { return ""; } }
// wsrv.nl: a chave é wsrv.nl/w<largura>/<host e caminho de ORIGEM>, tirados
// do parâmetro `url` (os syncs o codificam com encodeURIComponent; aqui
// decodifica de volta pra virar caminho de verdade no bucket). Só o formato
// que os syncs produzem (url + w [+ we] + output=webp) — outra query é outra
// imagem e fica de fora. Mesma regra no cliente (mirrorImageUrl).
const RE_WSRV = /^https:\/\/wsrv\.nl\/\?url=([^&]+)&w=(\d+)(?:&we)?&output=webp$/;
export function chaveWsrv(u) {
  const m = RE_WSRV.exec(String(u || ""));
  return m ? `wsrv.nl/w${m[2]}/${decodeURIComponent(m[1]).replace(/^https?:\/\//, "")}` : "";
}
// Chave no bucket: host + caminho, SEM query. A query do Scryfall (?1783943085)
// é um carimbo de versão da arte: fica no índice como `versao`, e quando muda
// o objeto é baixado de novo.
export function chaveDe(u) { const x = new URL(u); return x.host === "wsrv.nl" ? chaveWsrv(u) : x.host + x.pathname; }
export function versaoDe(u) { const x = new URL(u); return x.host === "wsrv.nl" ? "" : x.search.replace(/^\?/, ""); }
export function variantesDe(u) {
  const f = FONTES[hostDe(u)];
  if (!f) return [];
  if (hostDe(u) === "wsrv.nl" && !chaveWsrv(u)) return [];   // query fora do formato dos syncs
  return [...new Set(f.variantes(u))];
}
// URL espelhada de uma URL de origem, se o host estiver na lista dos
// COMPLETOS (o deploy injeta a lista no game.js). Mesma regra do cliente.
export function urlEspelho(u, hosts) {
  const m = /^https:\/\/([^/?#]+)(\/[^?#]*)/.exec(String(u || ""));
  if (!m || !hosts || hosts.indexOf(m[1]) < 0) return "";
  // wsrv.nl: caminho no bucket vem da query (encodeURI: espaço e kana do
  // fã-site viram %XX, barra fica — o mesmo que o navegador faria com o src).
  if (m[1] === "wsrv.nl") { const k = chaveWsrv(u); return k ? ESPELHO + encodeURI(k) : ""; }
  // Da TCGdex só as variantes webp moram no espelho (é o que o site pede); o
  // png original fica na cadeia de fallback, apontando pra origem.
  if (m[1] === "assets.tcgdex.net" && !/\.webp$/.test(m[2])) return "";
  return ESPELHO + m[1] + m[2];
}
