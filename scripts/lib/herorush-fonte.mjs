// Marvel Hero Rush: a API pública do site oficial (marvelherorush.com), a
// mesma que a lista de cartas e a página de produtos do site chamam, sem
// login. Usada pelo sync (scripts/sync-herorush.mjs) e pelo espelho de imagens
// (scripts/mirror-r2.mjs). Conferida em 2026-11-19.
//
// A IMAGEM É ASSINADA: a API devolve cada imagem com `?e=<validade>&token=…`,
// e o link vence em cerca de um dia. Sem a assinatura o CDN
// (marvel-tcg.janime.cn) responde 403 — medido em 19/11/2026. Então o catálogo
// não pode guardar a URL da fonte: guarda a CHAVE do arquivo (`image.key`, que
// não muda) no formato das fontes sem hotlink (wsrv.nl), e a imagem só existe
// no nosso espelho. Quem baixa é o job do espelho, que pede a assinatura nova
// aqui no começo de cada rodada (matrizesAssinadas).
import { fetchJsonRetry, sleep } from "./sync-common.mjs";

export const API = "https://server.marvelherorush.com/marvel";
export const HOST_IMAGEM = "marvel-tcg.janime.cn";
const HEADERS = { "User-Agent": "Sleevu (sleevu.app) catalog sync", Accept: "application/json" };
const POR_PAGINA = 100;

// Todas as cartas de um idioma ("en" ou "id"; o chinês não sai por esta API).
// A lista vem paginada, e uma carta pode repetir entre duas páginas (em
// 19/11/2026 a LP01-081 C veio duas vezes): quem usa tira a repetição pelo `id`.
export async function listaCartas({ idioma = "en", fetchImpl, pausaMs = 400 } = {}) {
  const cartas = [];
  for (let pagina = 1, paginas = 1; pagina <= paginas; pagina++) {
    const j = await fetchJsonRetry(`${API}/card/list?page=${pagina}&page_size=${POR_PAGINA}&language=${idioma}`, { headers: HEADERS, retries: 3, fetchImpl });
    if (!j || !Array.isArray(j.list)) throw new Error(`resposta sem lista na página ${pagina}`);
    cartas.push(...j.list);
    paginas = Math.min(Number(j.page_count) || 1, 200);
    if (pagina < paginas) await sleep(pausaMs);
  }
  return cartas;
}

// Os produtos (sets): código (`series`), nome, categoria ("base" = Starter
// Deck, "supplement" = Expansion Pack, "other" = Others, nos rótulos do
// próprio site) e `start_time`, que a página de produtos mostra como "Release
// Date".
export async function listaProdutos({ idioma = "en", fetchImpl } = {}) {
  const j = await fetchJsonRetry(`${API}/product/list?page=1&page_size=${POR_PAGINA}&language=${idioma}`, { headers: HEADERS, retries: 3, fetchImpl });
  if (!j || !Array.isArray(j.list)) throw new Error("resposta sem a lista de produtos");
  return j.list;
}

// URL do catálogo pra uma chave de imagem: o formato do wsrv.nl, que o site
// e o espelho já conhecem (a chave do espelho sai do parâmetro `url`). Pedida
// direto ao wsrv.nl ela NÃO abre (a origem recusa sem assinatura): até o
// espelho gerar a carta, o site mostra o verso, como em toda fonte que cai.
export function urlDoCatalogo(chave) {
  const k = String(chave || "").trim();
  return /^[0-9a-f]{16,40}$/i.test(k) ? `https://wsrv.nl/?url=${encodeURIComponent(`${HOST_IMAGEM}/${k}`)}&w=440&output=webp` : "";
}

// Base da chave do espelho (chaveBase do img-mirror.mjs) -> chave da imagem,
// ou "" quando a base não é do Hero Rush.
const PREFIXO_ESPELHO = `wsrv.nl/${HOST_IMAGEM}/`;
export function chaveDaBase(base) {
  const b = String(base || "");
  return b.startsWith(PREFIXO_ESPELHO) ? b.slice(PREFIXO_ESPELHO.length) : "";
}

// Chave da imagem -> URL assinada do arquivo original (PNG de 744×1040), pras
// cartas que a API lista agora. É o que o job do espelho baixa.
export function assinadasDe(cartas) {
  const mapa = new Map();
  for (const c of cartas || []) {
    const img = c && c.image;
    if (!img || !img.key) continue;
    const original = (img.variants && img.variants.original && img.variants.original.url) || img.url;
    if (original) mapa.set(String(img.key), original);
  }
  return mapa;
}

// Troca, no alvo do espelho (base -> carta), a matriz das cartas do Hero Rush
// pela URL assinada de agora. Carta sem assinatura nesta rodada SAI do alvo:
// se ficasse, o job pediria a URL sem assinatura, levaria 403 e a marcaria
// como "não existe na origem" por 30 dias. Fora do alvo ela só espera a
// rodada seguinte. `cartas`: a lista da API, ou null quando a API não
// respondeu (aí saem todas).
export function aplicaAssinadas(alvo, cartas) {
  const assinadas = cartas ? assinadasDe(cartas) : new Map();
  let trocadas = 0, adiadas = 0;
  for (const [base, o] of alvo) {
    const chave = chaveDaBase(base);
    if (!chave) continue;
    const url = assinadas.get(chave);
    if (url) { o.matriz = url; trocadas++; } else { alvo.delete(base); adiadas++; }
  }
  return { trocadas, adiadas };
}
