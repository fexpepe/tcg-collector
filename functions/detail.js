// Cloudflare Pages Function: /detail (a casca do app)
//
// Serve detail.html como sempre — só que, quando o link é de um SET, injeta
// título, descrição, Open Graph e <link rel="canonical"> do set de verdade.
//
// Por que existe: /detail?type=set&name=... é o que a pessoa COPIA da barra de
// endereço pra mandar pro amigo, e era a pior URL possível pra isso. A casca
// não tem conteúdo nenhum no HTML, então:
//   - colada no WhatsApp/Discord/X aparecia como uma URL pelada, sem prévia —
//     o link parecia quebrado antes mesmo de alguém clicar;
//   - é `noindex` (o conteúdo indexável mora em /games/<jogo>/<set>, pré-renderizado),
//     então todo link que alguém compartilhava nascia sem valor de busca.
// Agora o link colado mostra o logo do set, o nome e "154 cartas", e aponta
// (canonical) pra página estática equivalente, que é a que o Google indexa.
//
// Mesmo padrão do functions/users/[handle].js: HTMLRewriter por cima do asset.
// Qualquer erro cai no asset original — a página do app não pode depender disto.
//
// O mapa set -> página estática vem do build (prerender-catalog.mjs escreve
// data/set-pages/<jogo>.json): [caminho, nome, imagem, nº de cartas, lançamento],
// com o caminho em /games/ ("star-wars-unlimited/spark-of-rebellion") desde
// 2026-09-30; antes era o slug do diretório plano /set/.
//
// 301 pro endereço do set e da carta (2026-10-12). Desde 2026-10-01 a tela do
// set e a da carta TÊM endereço (/games/<jogo>/<set>[/<carta>], a mesma tela
// do app montada pela borda), mas o app segue linkando /detail?type=set&…: as
// Impressões do popup (~45 links por carta), o nome do set no popup, a grade
// de Sets, a home. O Googlebot renderiza o JS, segue esses links e caía numa
// casca `noindex`: no relatório de Páginas de 12/10 a linha "Excluída pela tag
// noindex" foi de 1.875 (08/10) pra 5.427 em quatro dias, rastreio gasto em
// página que nunca entra, com ~296 mil cartas esperando na fila. E cada link
// desses, que podia ser um voto pra página de outra carta, morria na casca.
// Com o 301, o mesmo link leva o robô (e o Google transfere o link) pra página
// indexável. Quem navega no app quase não vê: dentro da sessão o service worker
// responde /detail?… com a cópia guardada, sem ir à rede (navigationFast).
// Só o link de set "puro" redireciona (ver pedidoDeSet); o resto, e o que não
// dá pra resolver com certeza, segue na casca de sempre.
import { buscaPagina, comVitrine } from "./_vitrine-csp.js";
import { JOGOS_URL, urlDoSet } from "./_lib/jogos.js";
import { jsonDoSite, redireciona } from "./_lib/borda.js";
import { slugsDasCartas, cartasDoSet } from "./_lib/slug-carta.js";

const ORIGIN = "https://sleevu.app";

const setMeta = (content) => ({ element(el) { el.setAttribute("content", content); } });
const setHref = (href) => ({ element(el) { el.setAttribute("href", href); } });
const setText = (content) => ({
  element(el) { el.removeAttribute("data-i18n"); el.setInnerContent(content, { html: false }); }
});

// Só slug de jogo do registro (o nome do arquivo vem daqui: nada de "../").
const JOGOS = [
  "pokemon", "lorcana", "onepiece", "magic", "fab", "gundam", "swu", "cyberpunk", "sorcery", "dbfw", "ygo",
  "digimon", "riftbound", "unionarena", "naruto", "hxh", "dbc", "wow", "lotr", "harrypotter", "weiss", "mbc", "jump"
];

function dataBR(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
    "agosto", "setembro", "outubro", "novembro", "dezembro"];
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

// Metadados do set a partir do mapa do build. Separado (e exportado) porque é
// a única parte com regra de verdade — a de cima é encanamento da borda, que
// não roda em node; ver tests/detail-og.test.mjs.
export function metaDoSet(mapa, setId, nome) {
  const id = String(setId || "");
  // Pelo id é direto; só com o nome varre o mapa (são centenas de entradas, não
  // milhares, e é uma vez por link compartilhado).
  let linha = id && Object.prototype.hasOwnProperty.call(mapa, id) ? mapa[id] : null;
  if (!linha && nome) linha = Object.values(mapa).find((l) => l[1] === String(nome)) || null;
  if (!Array.isArray(linha)) return null;
  const [slug, setNome, imagem, total, lancamento] = linha;
  if (!slug || !setNome) return null;
  const quando = dataBR(lancamento);
  return {
    slug,
    setNome,
    imagem: imagem || "",
    canonical: `${ORIGIN}/games/${slug}`,
    titulo: `${setNome} — lista de cartas | Sleevu`,
    desc: `Lista completa das ${total} cartas do set ${setNome}${quando ? `, lançado em ${quando}` : ""}. Veja imagens, números e raridades e marque a sua coleção no Sleevu.`
  };
}

// Os parâmetros que o link de set do app leva: o detailUrl do shared.js
// (name, setId, game, card) e o ?region= que desambigua a edição. Com qualquer
// outro (scope=collection, filtros, utm…) a tela é outra coisa e fica na casca.
const PARAMS_DO_SET = new Set(["type", "name", "setId", "game", "card", "region"]);

// O pedido de set a resolver, ou null quando o link não é um set puro.
export function pedidoDeSet(params) {
  if (params.get("type") !== "set") return null;
  for (const k of params.keys()) if (!PARAMS_DO_SET.has(k)) return null;
  const name = params.get("name") || "";
  const setId = params.get("setId") || "";
  if (!name && !setId) return null;
  return {
    game: params.get("game") || "pokemon",
    name,
    setId,
    region: params.get("region") || "",
    card: params.get("card") || ""
  };
}

// Os /games/<url> onde o set pode morar, o mais provável primeiro: o da linha
// cujo prefixo casa com o setId (urlDoSet), depois os outros do mesmo jogo
// (link sem setId de um set de linha vintage).
export function urlsDoJogo(game, setId) {
  const primeira = urlDoSet(game, setId);
  if (!primeira) return [];
  return [primeira, ...JOGOS_URL.filter((j) => j.game === game && j.url !== primeira).map((j) => j.url)];
}

// Pasta do idioma no chunk do Pokémon (data/sets/<pasta>/<setId>.json) de
// cada região do ?region= (cardLanguageRegion do shared.js). Os outros jogos
// guardam em data/<jogo>/sets/<setId>.json, sem pasta de idioma.
const PASTA_DA_REGIAO = {
  english: (d) => d === "en",
  portuguese: (d) => d === "pt",
  japanese: (d) => d === "ja",
  chinese: (d) => d.indexOf("zh") === 0
};

function chunkDoSetId(arquivo, setId, region) {
  const f = String(arquivo);
  if (!f.endsWith(`/${setId}.json`)) return false;
  const pasta = /data\/sets\/([^/]+)\/[^/]+$/.exec(f);
  const ok = PASTA_DA_REGIAO[region];
  return !pasta || !ok || ok(pasta[1]);
}

// Os sets do mapa do jogo (data/game-pages/<url>.json, campo s: endereço ->
// { n: nome, f: chunks }) que podem ser o do link. Pelo NOME, que é a chave
// da borda (é por ele que a tela agrupa as cartas): um só.
export function setsPeloNome(sets, name) {
  const achou = name && sets ? Object.keys(sets).find((k) => sets[k] && sets[k].n === name) : null;
  return achou ? [achou] : [];
}
// Sem nome (o detailUrl tira o nome não-ASCII e deixa o setId), ou nome que
// não tem página: pelo chunk do setId, na pasta da região quando ela vem. Pode
// dar mais de um: o mesmo setId serve a várias edições (a PT usa o id da EN, a
// chinesa o da japonesa), e quem desempata é a carta do link (enderecoLimpo).
export function setsPeloId(sets, setId, region) {
  if (!setId || !sets) return [];
  return Object.keys(sets).filter((k) => ((sets[k] && sets[k].f) || []).some((f) => chunkDoSetId(f, setId, region)));
}

// O endereço /games/… do link de set, ou null (fica na casca). O nome é
// procurado em todos os mapas do jogo antes do setId: um set de linha vintage
// linkado sem setId não pode casar pelo id no mapa de outra linha. Com &card=,
// o nome da carta no endereço sai da mesma conta da borda (slugsDasCartas
// sobre as cartas da página do set), e só vale o set que tem a carta. Set sem
// carta com mais de um candidato, ou carta que não está em nenhum, seguem na
// casca, que resolve o set e a carta do jeito de sempre.
async function enderecoLimpo(env, request, params) {
  const pedido = pedidoDeSet(params);
  if (!pedido) return null;
  const urls = urlsDoJogo(pedido.game, pedido.setId);
  const lidos = await Promise.all(urls.map((url) => jsonDoSite(env, request, `/data/game-pages/${url}.json`)));
  const mapas = urls.map((url, i) => ({ url, sets: lidos[i] && lidos[i].s })).filter((m) => m.sets);
  const busca = [
    ...mapas.map((m) => ({ ...m, candidatos: setsPeloNome(m.sets, pedido.name) })),
    ...mapas.map((m) => ({ ...m, candidatos: setsPeloId(m.sets, pedido.setId, pedido.region) }))
  ];
  const achou = busca.find((b) => b.candidatos.length);
  if (!achou) return null;
  const { url, sets, candidatos } = achou;
  if (!pedido.card) return candidatos.length === 1 ? `/games/${url}/${candidatos[0]}` : null;
  // Empate de edição: no máximo 4 sets lidos (o caso real é JA × chinesa).
  const achados = [];
  for (const slug of candidatos.slice(0, 4)) {
    const entrada = sets[slug];
    const listas = await Promise.all((entrada.f || []).map((f) => jsonDoSite(env, request, "/" + f)));
    const cartas = cartasDoSet([].concat(...listas.filter(Array.isArray)), entrada.n);
    const daCarta = slugsDasCartas(cartas).get(pedido.card);
    if (daCarta) achados.push(`/games/${url}/${slug}/${daCarta}`);
  }
  return achados.length === 1 ? achados[0] : null;
}

export async function onRequestGet(context) {
  const { env, request } = context;
  // A página de set tem vitrine (src/ads.js): TODO caminho de volta passa pela
  // CSP com nonce (functions/_vitrine-csp.js). O redirect do &amp; não é HTML
  // e o comVitrine o devolve intacto.
  return comVitrine(await montaDetail(env, request), request);
}

async function montaDetail(env, request) {
  const url = new URL(request.url);

  // Link ESCAPADO como HTML (&amp; no lugar de &) — alguns apps de mensagem e
  // clientes de e-mail fazem isso. O navegador leria um parâmetro só (type) e
  // a página abriria vazia. Redireciona pra URL limpa: o crawler da prévia e a
  // pessoa passam a ver a mesma coisa. (O theme.js também desfaz isso no
  // cliente, pro caso de o link cair direto em /detail.html.)
  if (url.search.includes("&amp;")) {
    let q = url.search;
    for (let i = 0; i < 3 && q.includes("&amp;"); i++) q = q.replace(/&amp;/g, "&");
    return Response.redirect(`${url.origin}${url.pathname}${q}${url.hash}`, 301);
  }

  // Link de set com endereço próprio: 301 pra ele (ver o topo do arquivo).
  try {
    const destino = await enderecoLimpo(env, request, url.searchParams);
    if (destino) return redireciona(request, destino, 301);
  } catch (e) { /* segue na casca: o app não depende disto */ }

  const shell = await buscaPagina(env, request, "/detail.html");
  // Tela que não é de set conhecido (Pokémon, artista, treinador…): a casca
  // traz og:url = /sets, e o Facebook usa o og:url como o link da prévia —
  // a página do Pikachu compartilhada abria a de Sets. Fica o próprio
  // endereço (a casca segue noindex; isto é só pra quem compartilha).
  const proprio = () => new HTMLRewriter()
    .on('meta[property="og:url"]', setMeta(`${ORIGIN}${url.pathname}${url.search}`))
    .transform(shell);
  try {
    const p = url.searchParams;
    if (p.get("type") !== "set") return proprio();
    const game = String(p.get("game") || "pokemon");
    if (!JOGOS.includes(game)) return proprio();

    const mapaRes = await env.ASSETS.fetch(new URL(`/data/set-pages/${game}.json`, request.url));
    if (!mapaRes.ok) return proprio();
    const mapa = await mapaRes.json();

    const meta = metaDoSet(mapa, p.get("setId"), p.get("name"));
    if (!meta) return proprio();
    const { canonical, titulo, desc, imagem, setNome } = meta;

    let rw = new HTMLRewriter()
      .on("title", setText(titulo))
      .on('meta[name="description"]', setMeta(desc))
      .on('meta[property="og:title"]', setMeta(`${setNome} — Sleevu`))
      .on('meta[property="og:description"]', setMeta(desc))
      .on('meta[property="og:url"]', setMeta(canonical))
      .on('meta[name="twitter:title"]', setMeta(`${setNome} — Sleevu`))
      .on('meta[name="twitter:description"]', setMeta(desc))
      // A canonical aponta pra PÁGINA ESTÁTICA do set, não pra si mesma: é ela
      // que tem o conteúdo e que o Google indexa. Assim um link compartilhado
      // do app soma pra ela em vez de se perder numa casca `noindex`.
      .on('link[rel="canonical"]', setHref(canonical));
    if (imagem) {
      rw = rw
        .on('meta[property="og:image"]', setMeta(imagem))
        .on('meta[name="twitter:image"]', setMeta(imagem))
        // O logo do set não é 1200x630 (as dimensões do og-image genérico):
        // anunciar tamanho errado corta a prévia.
        .on('meta[property="og:image:width"]', { element: (el) => el.remove() })
        .on('meta[property="og:image:height"]', { element: (el) => el.remove() });
    }
    return rw.transform(shell);
  } catch (e) {
    return shell; // a casca original sempre serve: o app não depende disto
  }
}
