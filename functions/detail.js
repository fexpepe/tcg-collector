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
//   - é `noindex` (o conteúdo indexável mora em /set/<slug>, pré-renderizado),
//     então todo link que alguém compartilhava nascia sem valor de busca.
// Agora o link colado mostra o logo do set, o nome e "154 cartas", e aponta
// (canonical) pra página estática equivalente, que é a que o Google indexa.
//
// Mesmo padrão do functions/users/[handle].js: HTMLRewriter por cima do asset.
// Qualquer erro cai no asset original — a página do app não pode depender disto.
//
// O mapa set -> página estática vem do build (prerender-catalog.mjs escreve
// data/set-pages/<jogo>.json): [slug, nome, imagem, nº de cartas, lançamento].
const ORIGIN = "https://sleevu.app";

const setMeta = (content) => ({ element(el) { el.setAttribute("content", content); } });
const setHref = (href) => ({ element(el) { el.setAttribute("href", href); } });
const setText = (content) => ({
  element(el) { el.removeAttribute("data-i18n"); el.setInnerContent(content, { html: false }); }
});

// Só slug de jogo do registro (o nome do arquivo vem daqui: nada de "../").
const JOGOS = [
  "pokemon", "lorcana", "onepiece", "magic", "fab", "gundam", "dbfw", "ygo",
  "digimon", "riftbound", "unionarena", "naruto", "hxh", "dbc", "jump"
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
    canonical: `${ORIGIN}/set/${slug}`,
    titulo: `${setNome} — lista de cartas | Sleevu`,
    desc: `Lista completa das ${total} cartas do set ${setNome}${quando ? `, lançado em ${quando}` : ""}. Veja imagens, números e raridades e marque a sua coleção no Sleevu.`
  };
}

export async function onRequestGet(context) {
  const { env, request } = context;
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

  const shell = await env.ASSETS.fetch(new URL("/detail.html", request.url));
  try {
    const p = url.searchParams;
    if (p.get("type") !== "set") return shell;
    const game = String(p.get("game") || "pokemon");
    if (!JOGOS.includes(game)) return shell;

    const mapaRes = await env.ASSETS.fetch(new URL(`/data/set-pages/${game}.json`, request.url));
    if (!mapaRes.ok) return shell;
    const mapa = await mapaRes.json();

    const meta = metaDoSet(mapa, p.get("setId"), p.get("name"));
    if (!meta) return shell;
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
