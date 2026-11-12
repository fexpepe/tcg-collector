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
//   /games/<jogo>/<set>          -> a tela do set do APP (detail.html), com
//                                   título, JSON-LD e índice de cartas DO SET
//                                   (2026-10-01; antes era uma página estática
//                                   à parte, e o app seguia em /detail?…)
//   /games/<jogo>/<set>-en       -> a variante em inglês, estática (next())
//   /games/<jogo>/<set>/<carta>  -> a mesma casca, com a CARTA como página
//                                   (2026-10-13) e o SEO da carta
//   /games/<jogo>/_id/<id>?setName=  -> 301 pra página da carta (é o link
//                                   que o "compartilhar" do app gera: o app
//                                   sabe o id e o set, não o nome no endereço;
//                                   ?set= não, que o robots.txt barra)
//   /games/<apelido>/…           -> 301 pro endereço oficial (/games/swu)
//   set ou carta que mudou de    -> 301 pro endereço de hoje (o total do set
//   endereço                        cresceu, o set ganhou ou perdeu prefixo no
//                                   nome, a carta foi pra outro set…; ver
//                                   cartaParecida, setRenomeado, setDoDePara
//                                   e cartaQueMudouDeSet)
//   o resto                      -> 404 de verdade
//
// As páginas estáticas passarem por aqui custa uma execução de Function por
// visita (a conta é Workers Paid desde 10/09/2026).
import { buscaPagina, comVitrine } from "../_vitrine-csp.js";
import { jogoDaUrl, urlOficial } from "../_lib/jogos.js";
import { slugify, slugsDasCartas, cartasDoSet, cartaParecida } from "../_lib/slug-carta.js";
import { pecasDaCarta, precoDeReferencia, escapeHtml, escapeAttr, ORIGEM } from "../_lib/pagina-carta.js";
import { pecasDoSet } from "../_lib/pagina-set.js";
import { decoraApp } from "../_lib/decora-app.js";
import { naoAchou, redireciona, jsonDoSite, daBorda, guardaNaBorda, hasOwn, setRenomeado, setDoDePara } from "../_lib/borda.js";
import { jsonLdSeguro } from "../_lib/json-ld.js";
import { basePricingId } from "../api/_search-sql.js";
// O "Sobre" dos jogos vintage: o MESMO renderizador que o navegador usa (ver o
// cabeçalho do src/sobre-jogo.js). Script clássico: pendura globalThis.SleevuSobre.
import "../../src/sobre-jogo.js";

const SOBRE = globalThis.SleevuSobre;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
// Tela decorada (set ou carta) guardada na borda por um dia: o catálogo e os
// preços mudam no build diário, e a chave do cache leva o id do build (ver
// telaDoSet).
const BORDA_S = 86400;

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
    // Set do app ou a variante -en estática: quem sabe é o mapa do jogo (um
    // set cujo nome termine em "-en" não pode virar a variante de outro).
    return SLUG.test(resto[0]) ? { tipo: "set", jogo, set: resto[0] } : { tipo: "404" };
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
// <details> pra não competir com a grade.
// Com JS, ele espera a grade (html[data-game] + grade vazia = escondido): antes
// dela ficava na primeira dobra e descia quando os sets chegavam — CLS de 0,8
// no celular (2026-10-03, docs/PLANO-TECNICO.md S3). O robô sem JS não tem o
// data-game e vê o índice como sempre. data-indice-jogo deixa o app.js
// tirar o índice se uma cópia guardada chegar pra OUTRO jogo (o service
// worker guarda cada /games/<jogo> na entrada dele; é só uma garantia).
//
// Jogo vintage com "Sobre" (data/sobre/<url>.json, `sobre` aqui): o bloco vai
// pro HTML em pt (sobreHtml, antes da contagem de sets), com o JSON-LD do jogo
// (jsonLd), e o título e a descrição passam a falar da história. A descrição
// é o resumo do bloco: é o texto que diz o que o jogo FOI, e o Google mostra.
export function metaDoJogo(jogo, sets, sobre) {
  const n = sets.length;
  const titulo = (() => {
    const t = sobre ? `${jogo.nome} — história, sets e cartas | Sleevu` : `${jogo.nome} — sets e cartas | Sleevu`;
    if (t.length <= 65) return t;
    const curto = `${jogo.nome} — sets e cartas | Sleevu`;
    return curto.length <= 65 ? curto : `${jogo.nome} | Sleevu`;
  })();
  const anos = sets.map((s) => String(s.data).slice(0, 4)).filter((a) => /^\d{4}$/.test(a)).sort();
  const periodo = anos.length > 1 && anos[0] !== anos[anos.length - 1] ? `, de ${anos[0]} a ${anos[anos.length - 1]}` : "";
  const resumo = sobre ? String(SOBRE.tx(sobre.resumo, "pt") || "").trim() : "";
  const desc = resumo
    ? resumo
    : n
    ? `Todos os ${n} sets de ${jogo.nome}${periodo}, com a lista de cartas de cada um. Acompanhe preços e o progresso da sua coleção no Sleevu, grátis.`
    : `Sets e cartas de ${jogo.nome} no Sleevu: acompanhe preços e o progresso da sua coleção, grátis.`;
  const canonical = `${ORIGEM}/games/${jogo.url}`;
  const sobreHtml = sobre ? SOBRE.html(sobre, "pt") : "";
  const jsonLd = sobre ? `<script type="application/ld+json">${jsonLdSeguro(SOBRE.jsonLd(sobre, canonical, "pt"))}</script>` : "";
  const indiceHtml = n ? `<section class="jogo-indice" data-indice-jogo="${escapeAttr(jogo.url)}">
        <style>html[data-game] #cardGrid:empty~.jogo-indice{display:none}.jogo-indice{margin:40px 0 8px}.jogo-indice h2{font-size:1.05rem;margin:0 0 8px}.jogo-indice summary{cursor:pointer;color:var(--muted,#9aa0aa)}.jogo-indice ul{list-style:none;padding:0;margin:12px 0 0;columns:3 220px;column-gap:24px}.jogo-indice li{margin:0 0 6px;break-inside:avoid}.jogo-indice a{color:var(--accent,#e63946);text-decoration:none}.jogo-indice small{color:var(--muted,#9aa0aa)}</style>
        <h2>Todos os sets de ${escapeHtml(jogo.nome)}</h2>
        <details><summary>Ver a lista (${n})</summary><ul>${sets.map((s) =>
          `<li><a href="/games/${escapeAttr(jogo.url)}/${escapeAttr(s.slug)}">${escapeHtml(s.nome)}</a>${s.cartas ? ` <small>${s.cartas} cartas</small>` : ""}</li>`).join("")}</ul></details>
      </section>` : "";
  return { titulo, desc, canonical, ogTitulo: `${jogo.nome} — Sleevu`, indiceHtml, sobreHtml, jsonLd };
}

const atributo = (nome, valor) => ({ element(el) { el.setAttribute(nome, valor); } });
// O <title> da tela vem com data-i18n: sem tirar o atributo, a tradução do
// cliente trocava o título do jogo por "Sets - Sleevu" (o mesmo cuidado do
// functions/detail.js).
const texto = (valor) => ({ element(el) { el.removeAttribute("data-i18n"); el.setInnerContent(valor, { html: false }); } });

async function telaDoJogo(context, jogo) {
  const { env, request } = context;
  try {
    // O "Sobre" só de quem tem (SOBRE.tem): os outros jogos não pagam o pedido.
    // Sem o arquivo (null), a tela sai como a dos modernos.
    const [casca, mapa, sobre] = await Promise.all([
      buscaPagina(env, request, "/sets.html"),
      jsonDoSite(env, request, `/data/game-pages/${jogo.url}.json`),
      SOBRE.tem(jogo.url) ? jsonDoSite(env, request, `/data/sobre/${jogo.url}.json`) : null
    ]);
    const meta = metaDoJogo(jogo, listaDeSets(mapa), sobre);
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
      // O "Sobre" entra logo acima da contagem de sets: é o topo da tela, no
      // lugar do destaque do "Último set" (que o app.js não desenha nesses jogos).
      .on("section.results-header", { element(el) { if (meta.sobreHtml) el.before(meta.sobreHtml, { html: true }); } })
      .on("head", { element(el) { if (meta.jsonLd) el.append(meta.jsonLd, { html: true }); } })
      .on("main", { element(el) { if (meta.indiceHtml) el.append(meta.indiceHtml, { html: true }); } });
    return comVitrine(rw.transform(casca), request);
  } catch (e) {
    // A tela sem os dados do jogo continua funcionando: o game.js lê o jogo do
    // endereço.
    return provisoria(await env.ASSETS.fetch(new URL("/sets.html", request.url)));
  }
}

// A casca crua num endereço indexado, quando a decoração falha. Ela traz o
// canonical pra /sets (e a do detail.html, noindex): com 200, um erro
// passageiro dizia ao Google que a página do jogo, do set ou da carta não
// era pra indexar. 503 com Retry-After diz "volte depois" (2026-10-13). A
// pessoa vê a mesma tela (o navegador mostra o corpo de qualquer status, e o
// service worker, com cópia guardada, prefere a cópia num 5xx).
export function provisoria(resposta) {
  const headers = new Headers(resposta.headers);
  headers.set("retry-after", "3600");
  headers.set("cache-control", "no-store");
  return new Response(resposta.body, { status: resposta.ok ? 503 : resposta.status, headers });
}

// ── Tela do set (e da carta) ────────────────────────────────────────────────
// Build da casca: o carimbo que o deploy põe em toda página. Vai na chave do
// cache da borda, e assim, depois de um deploy, a cópia decorada do build
// anterior (que aponta arquivos com hash já apagados) deixa de ser achada.
export function buildDaCasca(html) {
  return (/<meta name="sleevu-build" content="([^"]*)"/.exec(String(html || "")) || [])[1] || "";
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

// Os preços da página: carta -> entrada do chunk de preço irmão ({ u, e, v, g })
// ou null. Desde 2026-11-11 a página da carta usa os preços das OUTRAS cartas
// do set também (a posição dela no set, ver mercadoDaCarta), então lê o chunk
// de preço de cada arquivo da página, e não só o da carta. Quase todo set é
// um arquivo só: é a mesma leitura de antes.
async function precosDaPagina(env, request, arquivo) {
  const arquivos = [...new Set(arquivo.values())];
  const tabelas = new Map(await Promise.all(arquivos.map(async (f) =>
    [f, await jsonDoSite(env, request, "/" + f.replace("/sets/", "/pricing-chunks/"))])));
  return (card) => {
    const tabela = tabelas.get(arquivo.get(card));
    if (!tabela || !card) return null;
    const id = String(card.id);
    return (hasOwn(tabela, id) ? tabela[id] : tabela[basePricingId(id)]) || null;
  };
}

// Carta que mudou de SET (2026-11-02): o endereço de hoje ("<jogo>/<set>/
// <carta>", sem o /games/), ou null. Vem pronto no mapa do jogo (campo "m",
// escrito pelo prerender a partir do data/cartas-movidas.json): o
// cartaParecida só procura no set do endereço, e procurar nos outros sets
// leria um chunk a mais por set em cada 404. O prerender nunca põe ali um
// endereço que hoje é de outra carta, então a consulta vem antes de tudo.
export function cartaQueMudouDeSet(mapa, set, carta) {
  const m = mapa && mapa.m;
  const chave = `${set}/${carta}`;
  if (!m || !hasOwn(m, chave)) return null;
  const destino = String(m[chave] || "");
  return /^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+$/.test(destino) ? destino : null;
}

// A tela do set do app no endereço do set; com `rota.carta`, a mesma casca com
// a página da carta (o detail.js lê a rota do <meta> que vai no HTML).
// Exceção na decoração (um chunk ou mapa fora do formato, um caso que as peças
// não previram) virava a página de erro da Cloudflare (2026-10-08). A casca
// crua abre a mesma tela: o detail.js acha o set e a carta pelo endereço — a
// tela do jogo (telaDoJogo) já fazia assim. Com 503 (ver provisoria).
async function telaDoSet(context, rota) {
  try {
    return await telaDoSetDecorada(context, rota);
  } catch (e) {
    return provisoria(await context.env.ASSETS.fetch(new URL("/detail.html", context.request.url)));
  }
}
async function telaDoSetDecorada(context, rota) {
  const { env, request } = context;
  const mapa = await jsonDoSite(env, request, `/data/game-pages/${rota.jogo.url}.json`);
  const sets = (mapa && mapa.s) || {};
  const busca = new URL(request.url).search;
  const movida = rota.carta ? cartaQueMudouDeSet(mapa, rota.set, rota.carta) : null;
  if (movida) return redireciona(request, `/games/${movida}${busca}`, 301);
  if (!hasOwn(sets, rota.set)) {
    // A variante em inglês (<set>-en) é página estática do prerender.
    if (!rota.carta && /-en$/.test(rota.set) && hasOwn(sets, rota.set.slice(0, -3))) return context.next();
    // Set renomeado: 301 pro nome de hoje, com a carta junto (se o nome dela
    // também mudou, o próximo pedido resolve). Primeiro o de-para do build
    // (setDoDePara), depois o prefixo ganho (setRenomeado).
    const chaves = Object.keys(sets);
    const novo = setDoDePara(mapa, rota.set) || setRenomeado(chaves, rota.set);
    if (novo) return redireciona(request, `/games/${rota.jogo.url}/${novo}${rota.carta ? `/${rota.carta}` : ""}${busca}`, 301);
    const en = !rota.carta && /^(.+)-en$/.exec(rota.set);
    const novoEn = en && (setDoDePara(mapa, en[1]) || setRenomeado(chaves, en[1]));
    if (novoEn) return redireciona(request, `/games/${rota.jogo.url}/${novoEn}-en${busca}`, 301);
    return naoAchou(env, request);
  }
  const entrada = sets[rota.set];
  const caminho = `/games/${rota.jogo.url}/${rota.set}${rota.carta ? `/${rota.carta}` : ""}`;
  const casca = await buscaPagina(env, request, "/detail.html");
  // Só a casca inteira (200) é decorada e vai pro cache da borda.
  if (casca.status !== 200) return casca;
  const cascaHtml = await casca.text();
  const chave = new Request(`${ORIGEM}${caminho}?b=${encodeURIComponent(buildDaCasca(cascaHtml) || "dev")}`);
  const guardada = await daBorda(chave);
  if (guardada) return comVitrine(guardada, request);

  const { cartas, arquivo } = await cartasDaPagina(env, request, entrada);
  const slugs = slugsDasCartas(cartas);
  let pecas;
  let card = null;
  if (rota.carta) {
    card = cartas.find((c) => slugs.get(String(c.id)) === rota.carta) || null;
    if (!card) {
      // Endereço de antes da carta (o total do set mudou, o nome mudou…).
      const hoje = cartaParecida(cartas, slugs, rota.carta);
      return hoje
        ? redireciona(request, `/games/${rota.jogo.url}/${rota.set}/${hoje}${busca}`, 301)
        : naoAchou(env, request);
    }
    const precoDe = await precosDaPagina(env, request, arquivo);
    const preco = precoDeReferencia(precoDe(card));
    pecas = pecasDaCarta({ card, jogo: rota.jogo, set: { slug: rota.set, nome: entrada.n }, cartas, slugs,
      preco: preco ? preco.valor : 0, moeda: preco ? preco.moeda : "USD", precoDe });
  } else {
    pecas = pecasDoSet({ jogo: rota.jogo, slug: rota.set, nome: entrada.n, cartas, slugs });
  }
  const decorada = decoraApp(new Response(cascaHtml, casca), pecas,
    { caminho, game: rota.jogo.game, set: entrada.n, card: card ? String(card.id) : "" });
  // Os cabeçalhos da casca trazem a CSP e o resto do _headers; o comVitrine
  // troca a CSP pela com nonce a cada resposta, por isso o que vai pro cache
  // da borda é a página ANTES dele.
  const headers = new Headers(casca.headers);
  for (const h of ["content-length", "etag", "last-modified", "content-encoding"]) headers.delete(h);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", `public, max-age=0, s-maxage=${BORDA_S}, must-revalidate`);
  const resposta = new Response(await decorada.text(), { status: 200, headers });
  guardaNaBorda(context.waitUntil, chave, resposta);
  return comVitrine(resposta, request);
}

// Link de compartilhar do app: /games/<jogo>/_id/<id>?setName=<nome do set>.
// O parâmetro não é ?set=: o robots.txt barra /*?set= (filtro do Explorar), e
// o robô do X respeita o robots — o link sairia sem prévia.
async function cartaPeloId(context, rota) {
  const { env, request } = context;
  const nomeDoSet = new URL(request.url).searchParams.get("setName") || "";
  const mapa = await jsonDoSite(env, request, `/data/game-pages/${rota.jogo.url}.json`);
  // Link compartilhado antes de o set ser renomeado leva o nome antigo: o
  // slug dele é a chave do de-para.
  const achado = mapa && mapa.s
    ? Object.keys(mapa.s).find((slug) => mapa.s[slug].n === nomeDoSet) || setDoDePara(mapa, slugify(nomeDoSet))
    : null;
  if (!achado) return redireciona(request, `/games/${rota.jogo.url}`, 302);
  const { cartas } = await cartasDaPagina(env, request, mapa.s[achado]);
  const slug = slugsDasCartas(cartas).get(rota.id);
  return slug
    ? redireciona(request, `/games/${rota.jogo.url}/${achado}/${slug}`, 301)
    : redireciona(request, `/games/${rota.jogo.url}/${achado}`, 302);
}

// HEAD: a mesma resposta do GET, sem o corpo. Sem isto a Function não
// respondia HEAD e o Pages caía no 404 (não há arquivo nesses endereços):
// verificador de link, monitor de uptime e robô que pergunta antes de baixar
// viam a tela do jogo e a do set como quebradas.
export async function onRequestHead(context) {
  const resposta = await onRequestGet(context);
  return new Response(null, { status: resposta.status, headers: resposta.headers });
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const rota = decideRota(params && params.path, url.pathname);
  switch (rota.tipo) {
    case "estatica": return context.next();
    case "redirect": return redireciona(request, rota.destino + url.search, 301);
    case "jogo": return telaDoJogo(context, rota.jogo);
    case "set":
    case "carta": return telaDoSet(context, rota);
    case "id": return cartaPeloId(context, rota);
    default: return naoAchou(env, request);
  }
}
