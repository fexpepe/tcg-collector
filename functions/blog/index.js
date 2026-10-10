// Cloudflare Pages Function: /blog — a lista de posts, montada na borda.
//
// Os cartões saem no HTML (o Google indexa a lista e os links pros posts, e a
// página aparece pronta no 4G). Os mesmos posts vão num JSON ao lado, pro
// src/blog.js filtrar por categoria/jogo/assunto sem recarregar e pedir mais
// quando a lista passar de uma página.
//
// ?cat= / ?jogo= / ?tag= (os links da trilha e das etiquetas do post) já saem
// filtrados daqui. A canonical é sempre /blog: filtro é navegação, não página
// nova pro Google.
import { B, supabase, COLUNAS_LISTA, setHtml, respostaFinal, daBorda, guardaNaBorda, chaveDaBorda } from "./_comum.js";
import { jsonLdSeguro } from "../_lib/json-ld.js";

export const POR_PAGINA = 36;
const SEGUNDOS_NA_BORDA = 120;

// Filtros válidos da URL (o resto é ignorado — inclusive na chave do cache).
export function filtrosDaUrl(url) {
  const cat = url.searchParams.get("cat") || "";
  const jogo = url.searchParams.get("jogo") || "";
  const tag = (url.searchParams.get("tag") || "").trim().slice(0, 40);
  return {
    cat: B.CATEGORIAS[cat] ? cat : "",
    jogo: B.GAMES[jogo] ? jogo : "",
    tag
  };
}
export function aplicaFiltros(posts, f) {
  const tag = f.tag.toLowerCase();
  return (posts || []).filter((p) => (!f.cat || p.category === f.cat)
    && (!f.jogo || p.game === f.jogo)
    && (!tag || (p.tags || []).some((t) => String(t).toLowerCase() === tag)));
}

export async function onRequestGet(context) {
  const { env, request, waitUntil } = context;
  const url = new URL(request.url);
  const f = filtrosDaUrl(url);
  const q = new URLSearchParams();
  if (f.cat) q.set("cat", f.cat);
  if (f.jogo) q.set("jogo", f.jogo);
  if (f.tag) q.set("tag", f.tag);
  // A casca primeiro: o build dela entra na chave do cache (ver chaveDaBorda).
  const cascaResp = await env.ASSETS.fetch(new URL("/blog", request.url));
  if (!cascaResp.ok) return cascaResp;
  const cascaHtml = await cascaResp.text();
  const chave = chaveDaBorda(url.origin, "/blog" + (q.toString() ? "?" + q : ""), cascaHtml);
  const guardada = await daBorda(chave, url.searchParams.has("fresco"));
  if (guardada) return guardada;
  const shell = new Response(cascaHtml, cascaResp);

  let posts = [];
  let falhou = false;
  try {
    // Uma a mais que a página: é o que diz se existe "carregar mais".
    posts = (await supabase(env, `/rest/v1/posts?select=${COLUNAS_LISTA}&order=published_at.desc&limit=${POR_PAGINA + 1}`)) || [];
  } catch (e) { falhou = true; }
  const temMais = posts.length > POR_PAGINA;
  posts = posts.slice(0, POR_PAGINA);

  // Supabase fora: a casca vai sem lista e sem JSON; o src/blog.js busca do
  // navegador. Sem cache, pra próxima visita tentar de novo.
  if (falhou) return respostaFinal(shell, 200, 0);

  const visiveis = aplicaFiltros(posts, f);
  const dados = { posts, temMais, filtros: f };
  // Lista vazia: o aviso sai com data-i18n, e o i18n do navegador põe no
  // idioma de quem lê (o texto aqui é o fallback em pt, igual ao do dicionário).
  const vazio = posts.length
    ? '<p class="empty-state" data-i18n="blog.emptyFilter">Nenhum post com esse filtro.</p>'
    : '<p class="empty-state" data-i18n="blog.empty">Nenhum post por aqui ainda. Volte em breve.</p>';
  let rw = new HTMLRewriter()
    .on("#blogList", setHtml(B.listaHtml(visiveis) || vazio))
    .on("#blogData", setHtml(jsonLdSeguro(dados)));
  // Blog sem post nenhum (2026-10-10): a página só diz "volte em breve", e
  // tela assim conta como site em construção — o AdSense reprovou o site por
  // "Low value content". Fica no ar, fora do índice, até o primeiro post (o
  // build também o tira do sitemap). Com post e filtro sem resultado, não:
  // a canonical é o /blog, que tem post.
  if (!posts.length) rw = rw.on("head", { element(el) { el.append('<meta name="robots" content="noindex, follow">', { html: true }); } });
  const resposta = respostaFinal(rw.transform(shell), 200, SEGUNDOS_NA_BORDA);
  guardaNaBorda(waitUntil, chave, resposta);
  return resposta;
}
