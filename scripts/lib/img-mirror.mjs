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
//
// Geração 2 (13/10/2026): o Fernando achou as cartas "perceptivelmente"
// borradas, e a medição deu duas causas no espelho. (1) Compressão dupla na
// TCGdex: a matriz era o high.webp, que a TCGdex já comprimiu, e o job
// comprimia de novo — SSIM 0,951 contra o high.png, contra 0,980 partindo do
// próprio png (+17% de bytes); na arte do Charizard do 151 a textura some e
// a cor empapa. (2) O popup no celular estica a imagem ~1,5x (a TCGdex não
// passa de 600 px), e o q80 sem smartSubsample é o que mais aparece esticado:
// a 1000 sai agora em q90 com smartSubsample (Scryfall 0,976 → 0,991,
// TCGplayer 0,980 → 0,992; ~+40 a 80 KB só no popup). A grade (300/600)
// continua em q80: ela sempre aparece REDUZIDA, e o ganho não se vê.
// Imagem nova não pode ir pra chave velha — navegador, service worker e borda
// guardam a velha por um ano (immutable), e a borda ignora a query — então
// cada geração tem chave própria (<…>@<largura>.g2.webp) e o site só troca
// de geração num host quando ela está COMPLETA no bucket (ver statusDoEspelho).
// A geração 1 (sem sufixo) fica no bucket: é o que o site usa até a troca.
export const ESPELHO = "https://img.sleevu.app/";
export const ESQUEMA_ESPELHO = 2;
export const GERACAO = 2;
export const LARGURAS = [300, 600, 1000];
export const QUALIDADE_WEBP = 80;
export const QUALIDADE_POPUP = 90;
// Opções do sharp por largura: o popup (1000) com mais qualidade e croma
// "inteligente" (bordas de cor do texto vermelho/azul sem sangrar).
export const webpDe = (w) => (w >= 1000 ? { quality: QUALIDADE_POPUP, smartSubsample: true } : { quality: QUALIDADE_WEBP });

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
  // high.png (600×825, sem perdas). Até a geração 1 era o high.webp, a mesma
  // resolução com 1/3 do peso — mas já comprimido pela TCGdex, e o job
  // comprimia por cima (ver Geração 2 no topo). O download maior é só do job.
  "assets.tcgdex.net": {
    concorrencia: 6, intervaloMs: 50,
    matriz: (u) => u.replace(RE_TCGDEX, "/high.png")
  },
  // large = 672×936 (o png de 745×1040 pesa 1 MB por carta e não muda nada
  // numa saída de no máximo 1000px).
  "cards.scryfall.io": {
    concorrencia: 2, intervaloMs: 200,
    matriz: (u) => u.replace("/normal/", "/large/")
  },
  // pokemontcg.io (20/09/2026): é a imagem PRINCIPAL das cartas EN/PT que a
  // TCGdex cataloga sem scan (Trainer Kits, McDonald's, energias, metade do
  // Celebrations — ~780 cartas) e o fallback das demais. O catálogo não guarda
  // essa URL (o cliente a monta pelo set-id-map); o job a recebe pronta pela
  // `reserva` do lerCatalogo (scripts/lib/pokemontcg-image.mjs) e só pra
  // quem não tem `image` — espelhar o fallback das 21 mil cartas EN seria
  // puxar 21 mil PNGs de um CDN comunitário por um caminho que quase nunca
  // roda. _hires = 734×1024; a normal tem 245×342, pequena até pra grade.
  "images.pokemontcg.io": {
    concorrencia: 3, intervaloMs: 150,
    matriz: (u) => u.replace(/(_hires)?\.png$/, "_hires.png")
  },
  // Bulbagarden Archives (20/09/2026, v2 japonês): scans das cartas japonesas
  // que nenhuma fonte com API tem — os vintages de 1996 a 2006 (PMCG, neo, VS,
  // web, e, PCG, ~2.170 cartas). A URL entra no chunk pelo enrich-ja (cache
  // da Bulbapedia) e o cliente só a vê atrás do espelho. Um wiki comunitário:
  // uma requisição por vez, um segundo entre elas. A matriz é o upload
  // original (/media/upload/x/xy/Arquivo.jpg); uma URL de thumb
  // (/thumb/x/xy/Arquivo.jpg/300px-Arquivo.jpg) volta pro original.
  "archives.bulbagarden.net": {
    concorrencia: 1, intervaloMs: 1000,
    matriz: (u) => u.replace(/\/media\/upload\/thumb\/([0-9a-f])\/([0-9a-f]{2})\/([^/]+)\/\d+px-[^/]+$/, "/media/upload/$1/$2/$3")
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
// `g`: a geração (1 = sem sufixo, a chave de sempre; ver Geração 2 no topo).
const sufixo = (g) => (g > 1 ? `.g${g}` : "");
export const chaveDe = (u, w, g = 1) => { const b = chaveBase(u); return b ? `${b}@${w}${sufixo(g)}.webp` : ""; };
// Versão: a query do Scryfall (?1783943085) é um carimbo da arte — muda,
// baixa de novo. Os outros não têm.
export function versaoDe(u) { const x = new URL(u); return x.host === "wsrv.nl" ? "" : x.search.replace(/^\?/, ""); }
export function matrizDe(u) {
  const f = FONTES[hostDe(u)];
  return f && chaveBase(u) ? f.matriz(u) : "";
}
// URL espelhada da URL do catálogo `u` na largura `w`, se o host estiver na
// lista dos COMPLETOS (o deploy injeta a lista no game.js), na geração que o
// deploy declarou pra ele (`geracoes`, host -> n; ausente = 1). Mesma regra do
// cliente. encodeURI só no wsrv: espaço e kana dos fã-sites viram %XX (o que
// o navegador faria com o src); os outros caminhos já são ASCII limpo.
export function urlEspelho(u, hosts, w, geracoes) {
  const m = /^https:\/\/([^/?#]+)(\/[^?#]*)/.exec(String(u || ""));
  if (!m || !hosts || hosts.indexOf(m[1]) < 0) return "";
  const b = chaveBase(u);
  if (!b) return "";
  return `${ESPELHO}${m[1] === "wsrv.nl" ? encodeURI(b) : b}@${w}${sufixo((geracoes && geracoes[m[1]]) || 1)}.webp`;
}

// O que o site pode usar, a partir do _index/status.json que o job publica:
// os hosts COMPLETOS no esquema atual e, de cada um, a geração completa (só
// as acima de 1 — a 1 é o padrão do cliente). Usado pelo deploy
// (apply-img-mirror.mjs) e pela montagem do app (app-web.mjs).
export function statusDoEspelho(j) {
  const hs = (j && j.hosts) || {};
  const hosts = ORDEM.filter((h) => hs[h] && hs[h].completo && hs[h].esquema === ESQUEMA_ESPELHO);
  const geracoes = {};
  for (const h of hosts) if (Number(hs[h].geracao) > 1) geracoes[h] = Number(hs[h].geracao);
  return { hosts, geracoes };
}

// Os dois marcadores do src/game.js (o mesmo padrão do MANIFEST): os hosts
// completos e a geração de cada um. Lança se faltar um: build com a lista de
// hosts e SEM a geração montaria a chave errada (404 em toda imagem do host).
const MARCA_HOSTS = /var IMG_MIRROR_HOSTS = \[[^\]]*\]; \/\* SLEEVU_IMG_MIRROR \*\//;
const MARCA_GERACOES = /var IMG_MIRROR_GEN = \{[^}]*\}; \/\* SLEEVU_IMG_MIRROR_GEN \*\//;
export function injetaEspelho(texto, { hosts = [], geracoes = {} } = {}) {
  if (!MARCA_HOSTS.test(texto)) throw new Error("marcador SLEEVU_IMG_MIRROR não encontrado no src/game.js");
  if (!MARCA_GERACOES.test(texto)) throw new Error("marcador SLEEVU_IMG_MIRROR_GEN não encontrado no src/game.js");
  return texto
    .replace(MARCA_HOSTS, () => `var IMG_MIRROR_HOSTS = ${JSON.stringify(hosts)}; /* SLEEVU_IMG_MIRROR */`)
    .replace(MARCA_GERACOES, () => `var IMG_MIRROR_GEN = ${JSON.stringify(geracoes)}; /* SLEEVU_IMG_MIRROR_GEN */`);
}
