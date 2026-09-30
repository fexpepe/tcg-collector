// A árvore /games (2026-09-30). O porquê da estrutura e o registro dos jogos
// estão em functions/_lib/jogos.js; o nome de cada carta no endereço, em
// functions/_lib/slug-carta.js.
//
// UMA Function pra árvore inteira, e não uma por nível: a Cloudflare aciona
// Function por prefixo (/games/*) de qualquer jeito, porque o _routes.json não
// sabe dizer "só o 2º nível". Então esta decide o que cada endereço é:
//   /games                       -> página estática games.html (next())
//   /games/<jogo>                -> a tela de Sets do jogo: o sets.html com a
//                                   vitrine, mais título, descrição, canonical
//                                   e índice de sets DO JOGO
//   /games/<jogo>/<set>          -> página estática do set (next())
//   /games/<jogo>/<set>/<carta>  -> página da carta, montada aqui
//   /games/<jogo>/_id/<id>?setName=  -> 301 pra página da carta (é o link
//                                   que o "compartilhar" do app gera: o app
//                                   sabe o id e o set, não o nome no endereço;
//                                   ?set= não, que o robots.txt barra)
//   /games/<apelido>/…           -> 301 pro endereço oficial (/games/swu)
//   o resto                      -> 404 de verdade
//
// As páginas estáticas passarem por aqui custa uma execução de Function por
// visita (a conta é Workers Paid desde 10/09/2026).
import { buscaPagina, comVitrine } from "../_vitrine-csp.js";
import { jogoDaUrl, urlOficial } from "../_lib/jogos.js";
import { slugsDasCartas, cartasDoSet } from "../_lib/slug-carta.js";
import { paginaDaCarta, precoUSD, escapeHtml, escapeAttr, ORIGEM } from "../_lib/pagina-carta.js";
import { naoAchou, redireciona, jsonDoSite, daBorda, guardaNaBorda, hasOwn } from "../_lib/borda.js";
import { basePricingId } from "../api/_search-sql.js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
// Página da carta guardada na borda por um dia: o catálogo e os preços mudam
// no build diário, e a chave do cache leva o id do build (ver cartaNaBorda).
const BORDA_CARTA_S = 86400;

// O que o endereço é. Pura: tests/games-rota.test.mjs cobre cada caso.
// `caminho` é o context.params.path (array de segmentos; vazio em /games).
export function decideRota(caminho, pathname) {
  const segs = (Array.isArray(caminho) ? caminho : [caminho]).map((s) => String(s == null ? "" : s)).filter(Boolean);
  if (!segs.length) return { tipo: "estatica" };
  if (segs.length > 3) return { tipo: "404" };
  // Barra no fim duplica o endereço (/games/pokemon e /games/pokemon/).
  if (/\/$/.test(String(pathname || ""))) return { tipo: "redirect", destino: `/games/${segs.join("/")}` };
  const [bruto, ...resto] = segs;
  const oficial = jogoDaUrl(bruto) ? bruto : urlOficial(bruto);
  if (!oficial) return { tipo: "404" };
  const jogo = jogoDaUrl(oficial);
  // Apelido (/games/swu) ou maiúscula (/games/Pokemon): 301 pro oficial. O
  // resto do caminho vai junto, com os slugs em minúsculo (o id fica como é).
  const restoOk = resto[0] === "_id" ? resto : resto.map((s) => s.toLowerCase());
  if (oficial !== bruto || restoOk.some((s, i) => s !== resto[i])) {
    return { tipo: "redirect", destino: `/games/${[oficial, ...restoOk].join("/")}` };
  }
  if (!resto.length) return { tipo: "jogo", jogo };
  if (resto.length === 1) {
    // /set/x.html sempre levou pro endereço limpo (o Pages faz isso com todo
    // .html); aqui a Function responde antes dele, então faz igual.
    const semHtml = resto[0].replace(/\.html$/, "");
    if (semHtml !== resto[0] && SLUG.test(semHtml)) return { tipo: "redirect", destino: `/games/${oficial}/${semHtml}` };
    return SLUG.test(resto[0]) ? { tipo: "estatica" } : { tipo: "404" };
  }
  if (resto[0] === "_id") return ID.test(resto[1]) ? { tipo: "id", jogo, id: resto[1] } : { tipo: "404" };
  if (!SLUG.test(resto[0]) || !SLUG.test(resto[1])) return { tipo: "404" };
  return { tipo: "carta", jogo, set: resto[0], carta: resto[1] };
}

// ── Tela de Sets do jogo ────────────────────────────────────────────────────
// Sets do mapa do build, mais novos primeiro (é a ordem em que a pessoa
// procura), com o nome como desempate.
export function listaDeSets(mapa) {
  const s = (mapa && mapa.s) || {};
  return Object.keys(s).map((slug) => ({ slug, nome: s[slug].n, cartas: s[slug].c || 0, data: s[slug].d || "" }))
    .sort((a, b) => String(b.data).localeCompare(String(a.data)) || a.nome.localeCompare(b.nome));
}

// Título, descrição, canonical e o índice de sets em HTML. O índice é o que o
// robô que não roda JS encontra (a grade da tela é desenhada no navegador), e
// é por ele que a página do jogo linka as páginas de set. Fica recolhido num
// <details> pra não competir com a grade. data-indice-jogo deixa o app.js
// tirar o índice se uma cópia guardada chegar pra OUTRO jogo (o service
// worker guarda cada /games/<jogo> na entrada dele; é só uma garantia).
export function metaDoJogo(jogo, sets) {
  const n = sets.length;
  const titulo = (() => {
    const t = `${jogo.nome} — sets e cartas | Sleevu`;
    return t.length <= 65 ? t : `${jogo.nome} | Sleevu`;
  })();
  const anos = sets.map((s) => String(s.data).slice(0, 4)).filter((a) => /^\d{4}$/.test(a)).sort();
  const periodo = anos.length > 1 && anos[0] !== anos[anos.length - 1] ? `, de ${anos[0]} a ${anos[anos.length - 1]}` : "";
  const desc = n
    ? `Todos os ${n} sets de ${jogo.nome}${periodo}, com a lista de cartas de cada um. Acompanhe preços e o progresso da sua coleção no Sleevu, grátis.`
    : `Sets e cartas de ${jogo.nome} no Sleevu: acompanhe preços e o progresso da sua coleção, grátis.`;
  const indiceHtml = n ? `<section class="jogo-indice" data-indice-jogo="${escapeAttr(jogo.url)}">
        <style>.jogo-indice{margin:40px 0 8px}.jogo-indice h2{font-size:1.05rem;margin:0 0 8px}.jogo-indice summary{cursor:pointer;color:var(--muted,#9aa0aa)}.jogo-indice ul{list-style:none;padding:0;margin:12px 0 0;columns:3 220px;column-gap:24px}.jogo-indice li{margin:0 0 6px;break-inside:avoid}.jogo-indice a{color:var(--accent,#e63946);text-decoration:none}.jogo-indice small{color:var(--muted,#9aa0aa)}</style>
        <h2>Todos os sets de ${escapeHtml(jogo.nome)}</h2>
        <details><summary>Ver a lista (${n})</summary><ul>${sets.map((s) =>
          `<li><a href="/games/${escapeAttr(jogo.url)}/${escapeAttr(s.slug)}">${escapeHtml(s.nome)}</a>${s.cartas ? ` <small>${s.cartas} cartas</small>` : ""}</li>`).join("")}</ul></details>
      </section>` : "";
  return { titulo, desc, canonical: `${ORIGEM}/games/${jogo.url}`, ogTitulo: `${jogo.nome} — Sleevu`, indiceHtml };
}

const atributo = (nome, valor) => ({ element(el) { el.setAttribute(nome, valor); } });
// O <title> da tela vem com data-i18n: sem tirar o atributo, a tradução do
// cliente trocava o título do jogo por "Sets - Sleevu" (o mesmo cuidado do
// functions/detail.js).
const texto = (valor) => ({ element(el) { el.removeAttribute("data-i18n"); el.setInnerContent(valor, { html: false }); } });

async function telaDoJogo(context, jogo) {
  const { env, request } = context;
  try {
    const [casca, mapa] = await Promise.all([
      buscaPagina(env, request, "/sets.html"),
      jsonDoSite(env, request, `/data/game-pages/${jogo.url}.json`)
    ]);
    const meta = metaDoJogo(jogo, listaDeSets(mapa));
    const rw = new HTMLRewriter()
      .on("title", texto(meta.titulo))
      .on('meta[name="description"]', atributo("content", meta.desc))
      .on('link[rel="canonical"]', atributo("href", meta.canonical))
      .on('meta[property="og:url"]', atributo("content", meta.canonical))
      .on('meta[property="og:title"]', atributo("content", meta.ogTitulo))
      .on('meta[property="og:description"]', atributo("content", meta.desc))
      .on('meta[name="twitter:title"]', atributo("content", meta.ogTitulo))
      .on('meta[name="twitter:description"]', atributo("content", meta.desc))
      // O nome do jogo no H1 já no HTML (o CSS o desenha antes de "Sets"): sem
      // esperar o JS, a tela não pisca de "Sets" pra "Star Wars: Unlimited Sets".
      .on(".page-head h1", atributo("data-game", jogo.nome))
      .on("main", { element(el) { if (meta.indiceHtml) el.append(meta.indiceHtml, { html: true }); } });
    return comVitrine(rw.transform(casca), request);
  } catch (e) {
    // A tela sem os dados do jogo continua funcionando: o game.js lê o jogo do
    // endereço.
    return env.ASSETS.fetch(new URL("/sets.html", request.url));
  }
}

// ── Página da carta ─────────────────────────────────────────────────────────
// O que a casca (games/card-template.html, gerada pelo prerender e carimbada
// pelo deploy) aponta: o build e os arquivos com hash do tema e do CSS. É por
// ela que a página montada aqui sai com o mesmo carimbo de build das estáticas
// (sem ele o service worker nunca a guardaria pra offline).
export function assetsDaCasca(html) {
  const s = String(html || "");
  const build = (/<meta name="sleevu-build" content="([^"]*)"/.exec(s) || [])[1] || "";
  const js = (/<script src="([^"]*theme[^"]*\.js)"/.exec(s) || [])[1] || "/src/theme.js";
  const css = (/<link rel="stylesheet" href="([^"]*styles[^"]*\.css)"/.exec(s) || [])[1] || "/styles.css";
  return { build, js, css };
}

// As cartas da página do set: os chunks listados no mapa (os mesmos que o app
// baixa), filtrados pelo nome do set. `arquivo` diz de qual chunk cada carta
// veio, pra achar o preço no chunk de preço irmão.
async function cartasDaPagina(env, request, entrada) {
  const arquivos = Array.isArray(entrada.f) ? entrada.f : [];
  const listas = await Promise.all(arquivos.map((f) => jsonDoSite(env, request, "/" + f)));
  const arquivo = new Map();
  const todas = [];
  listas.forEach((lista, i) => {
    if (!Array.isArray(lista)) return;
    for (const c of lista) { arquivo.set(c, arquivos[i]); todas.push(c); }
  });
  return { cartas: cartasDoSet(todas, entrada.n), arquivo };
}

async function precoDaCarta(env, request, card, arquivo) {
  if (!arquivo) return 0;
  const tabela = await jsonDoSite(env, request, "/" + arquivo.replace("/sets/", "/pricing-chunks/"));
  if (!tabela) return 0;
  const id = String(card.id);
  return precoUSD(hasOwn(tabela, id) ? tabela[id] : tabela[basePricingId(id)]);
}

async function cartaNaBorda(context, rota) {
  const { env, request } = context;
  const casca = await env.ASSETS.fetch(new URL("/games/card-template", request.url));
  const assets = assetsDaCasca(casca.ok ? await casca.text() : "");
  const endereco = `/games/${rota.jogo.url}/${rota.set}/${rota.carta}`;
  // O build na chave: depois de um deploy, a cópia velha (com o carimbo e os
  // arquivos do build anterior) deixa de ser achada.
  const chave = new Request(`${ORIGEM}${endereco}?b=${encodeURIComponent(assets.build || "dev")}`);
  const guardada = await daBorda(chave);
  if (guardada) return guardada;
  const mapa = await jsonDoSite(env, request, `/data/game-pages/${rota.jogo.url}.json`);
  const entrada = mapa && mapa.s && hasOwn(mapa.s, rota.set) ? mapa.s[rota.set] : null;
  if (!entrada) return naoAchou(env, request);
  const { cartas, arquivo } = await cartasDaPagina(env, request, entrada);
  const slugs = slugsDasCartas(cartas);
  const card = cartas.find((c) => slugs.get(String(c.id)) === rota.carta);
  if (!card) return naoAchou(env, request);
  const preco = await precoDaCarta(env, request, card, arquivo.get(card));
  const html = paginaDaCarta({ card, jogo: rota.jogo, set: { slug: rota.set, nome: entrada.n }, cartas, slugs, preco, assets });
  // Os cabeçalhos da casca trazem a CSP e o resto do _headers (resposta montada
  // do zero numa Function não os herdaria).
  const headers = new Headers(casca.ok ? casca.headers : undefined);
  for (const h of ["content-length", "etag", "last-modified", "content-encoding"]) headers.delete(h);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", `public, max-age=0, s-maxage=${BORDA_CARTA_S}, must-revalidate`);
  const resposta = new Response(html, { status: 200, headers });
  guardaNaBorda(context.waitUntil, chave, resposta);
  return resposta;
}

// Link de compartilhar do app: /games/<jogo>/_id/<id>?setName=<nome do set>.
// O parâmetro não é ?set=: o robots.txt barra /*?set= (filtro do Explorar), e
// o robô do X respeita o robots — o link sairia sem prévia.
async function cartaPeloId(context, rota) {
  const { env, request } = context;
  const nomeDoSet = new URL(request.url).searchParams.get("setName") || "";
  const mapa = await jsonDoSite(env, request, `/data/game-pages/${rota.jogo.url}.json`);
  const achado = mapa && mapa.s ? Object.keys(mapa.s).find((slug) => mapa.s[slug].n === nomeDoSet) : null;
  if (!achado) return redireciona(request, `/games/${rota.jogo.url}`, 302);
  const { cartas } = await cartasDaPagina(env, request, mapa.s[achado]);
  const slug = slugsDasCartas(cartas).get(rota.id);
  return slug
    ? redireciona(request, `/games/${rota.jogo.url}/${achado}/${slug}`, 301)
    : redireciona(request, `/games/${rota.jogo.url}/${achado}`, 302);
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const rota = decideRota(params && params.path, url.pathname);
  switch (rota.tipo) {
    case "estatica": return context.next();
    case "redirect": return redireciona(request, rota.destino + url.search, 301);
    case "jogo": return telaDoJogo(context, rota.jogo);
    case "carta": return cartaNaBorda(context, rota);
    case "id": return cartaPeloId(context, rota);
    default: return naoAchou(env, request);
  }
}
