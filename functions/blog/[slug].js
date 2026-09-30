// Cloudflare Pages Function: /blog/<slug> — a página do post, montada na borda.
//
// Publicar é instantâneo: o editor grava na tabela posts e a próxima visita já
// sai daqui com o texto, as cartas (D1) e o SEO (título, Open Graph, JSON-LD)
// no HTML — o Google recebe o artigo pronto, não a casca da SPA. A casca é o
// blog-post.html (passa pelos mesmos passos de build de toda página: i18n por
// idioma, CSS por área, hash), e o miolo vem do src/blog-render.js, o MESMO que
// o editor usa na prévia.
//
// Caminhos:
//   - post publicado      → 200 com o artigo (borda guarda 2 min; ?fresco=1 remonta)
//   - endereço antigo     → 301 pro atual (post_redirects, gravada pelo trigger)
//   - não existe/rascunho → 404 de verdade (a RLS esconde rascunho e agendado)
//   - Supabase fora       → 503 com a casca vazia: o src/blog.js tenta buscar o
//                            post do navegador, e o Google volta depois.
import { B, supabase, cartasDoD1, COLUNAS_POST, COLUNAS_LISTA, ORIGEM,
  setMeta, setHref, setText, remove, setHtml, naoAchou, respostaFinal, daBorda, guardaNaBorda } from "./_comum.js";
import { jsonLdSeguro } from "../_lib/json-ld.js";

const SEGUNDOS_NA_BORDA = 120;
const TITULO_MAX = 65;

// Título, descrição, imagem e JSON-LD do post. Puro (testado em
// tests/blog-function.test.mjs); o encanamento do HTMLRewriter não roda em node.
export function metaDoPost(post) {
  const lang = B.ROTULOS[post.lang] ? post.lang : "pt";
  const L = B.rotulos(lang);
  const canonical = ORIGEM + B.URL_DO_POST(post.slug);
  const base = (post.seo_title || post.title || "").trim();
  const titulo = base.length + 9 <= TITULO_MAX ? base + " | Sleevu" : base;
  const desc = (post.seo_desc || post.excerpt || B.resumo(post.body_md, 155) || "").trim();
  const capa = B.safeImg(post.cover_url);
  const imagem = capa && /^https:\/\//.test(capa) ? capa : "";
  const categoria = B.nomeCategoria(post.category, lang);
  const autor = post.author_name
    ? { "@type": "Person", name: post.author_name }
    : { "@type": "Organization", name: "Sleevu", url: ORIGEM + "/" };
  const artigo = {
    "@type": "BlogPosting",
    headline: (post.title || "").slice(0, 110),
    description: desc,
    mainEntityOfPage: canonical,
    url: canonical,
    inLanguage: L.locale,
    datePublished: post.published_at || undefined,
    dateModified: post.updated_at || post.published_at || undefined,
    author: autor,
    publisher: { "@type": "Organization", name: "Sleevu", url: ORIGEM + "/", logo: { "@type": "ImageObject", url: ORIGEM + "/icon-512.png" } }
  };
  if (imagem) artigo.image = [imagem];
  if (categoria) artigo.articleSection = categoria;
  if (post.tags && post.tags.length) artigo.keywords = post.tags.join(", ");
  const trilha = [{ "@type": "ListItem", position: 1, name: "Blog", item: ORIGEM + "/blog" }];
  if (categoria) trilha.push({ "@type": "ListItem", position: 2, name: categoria, item: ORIGEM + "/blog?cat=" + post.category });
  trilha.push({ "@type": "ListItem", position: trilha.length + 1, name: post.title || "" });
  return {
    lang, titulo, desc, imagem, canonical,
    jsonLd: { "@context": "https://schema.org", "@graph": [artigo, { "@type": "BreadcrumbList", itemListElement: trilha }] }
  };
}

// "Leia também": até 3, do mesmo jogo primeiro, completando com os mais novos.
export function escolheRelacionados(post, lista) {
  const outros = (lista || []).filter((p) => p.slug !== post.slug);
  const mesmoJogo = post.game ? outros.filter((p) => p.game === post.game) : [];
  const resto = outros.filter((p) => mesmoJogo.indexOf(p) < 0);
  return mesmoJogo.concat(resto).slice(0, 3);
}

async function casca(env, request) {
  const r = await env.ASSETS.fetch(new URL("/blog-post", request.url));
  return r.ok ? r : null;
}

export async function onRequestGet(context) {
  const { params, env, request, waitUntil } = context;
  const bruto = String(params.slug || "");
  const slug = bruto.toLowerCase();
  if (slug.length > 100 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return naoAchou(env, request);

  const url = new URL(request.url);
  // Endereço com maiúscula (link digitado à mão, colado de outro lugar): 301
  // pro canônico, em vez de responder a mesma página em duas URLs.
  if (bruto !== slug) return new Response(null, { status: 301, headers: { Location: url.origin + B.URL_DO_POST(slug), "Cache-Control": "public, max-age=3600" } });
  const chave = new Request(url.origin + "/blog/" + slug, { method: "GET" });
  const fresco = url.searchParams.has("fresco");
  const guardada = await daBorda(chave, fresco);
  if (guardada) return guardada;

  let post;
  try {
    const linhas = await supabase(env, `/rest/v1/posts?slug=eq.${slug}&select=${COLUNAS_POST}&limit=1`);
    post = linhas && linhas[0];
  } catch (e) {
    // Supabase fora: a casca sem miolo, com 503. O src/blog.js percebe o miolo
    // vazio e busca o post do navegador.
    const vazia = await casca(env, request);
    if (!vazia) return naoAchou(env, request);
    const r = respostaFinal(vazia, 503, 0);
    r.headers.set("Retry-After", "60");
    return r;
  }

  if (!post) {
    // Endereço antigo de um post que mudou de endereço?
    try {
      const red = await supabase(env, `/rest/v1/post_redirects?old_slug=eq.${slug}&select=post_id&limit=1`);
      if (red && red[0] && /^[0-9a-f-]{36}$/.test(red[0].post_id)) {
        const atual = await supabase(env, `/rest/v1/posts?id=eq.${red[0].post_id}&select=slug&limit=1`);
        if (atual && atual[0] && atual[0].slug && atual[0].slug !== slug) {
          return new Response(null, { status: 301, headers: { Location: url.origin + B.URL_DO_POST(atual[0].slug), "Cache-Control": "public, max-age=300" } });
        }
      }
    } catch (e) { /* sem redirect: segue pro 404 */ }
    return naoAchou(env, request);
  }

  const lang = B.ROTULOS[post.lang] ? post.lang : "pt";
  const [cartas, lista, shell] = await Promise.all([
    cartasDoD1(env, post.card_refs || [], lang),
    supabase(env, `/rest/v1/posts?select=${COLUNAS_LISTA}&order=published_at.desc&limit=12`).catch(() => []),
    casca(env, request)
  ]);
  if (!shell) return naoAchou(env, request);

  const card = (ref) => cartas.get(ref) || null;
  const r = B.render(post.body_md, { lang, card, ancora: B.URL_DO_POST(post.slug) });
  const miolo = B.paginaDoPostHtml(post, r, { card }) + B.relacionadosHtml(escolheRelacionados(post, lista), lang);
  const meta = metaDoPost(post);
  // O que o navegador precisa pra acordar a página (preço na moeda de quem lê,
  // Tenho/Quero, editar) sem reparsear o HTML.
  const dados = { id: post.id, slug: post.slug, lang, game: post.game || "", refs: r.refs };

  let rw = new HTMLRewriter()
    .on("html", { element(el) { el.setAttribute("lang", B.rotulos(lang).locale); } })
    .on("title", setText(meta.titulo))
    .on('meta[name="description"]', setMeta(meta.desc))
    .on('meta[name="robots"]', remove)
    .on('link[rel="canonical"]', setHref(meta.canonical))
    .on('meta[property="og:type"]', setMeta("article"))
    .on('meta[property="og:url"]', setMeta(meta.canonical))
    .on('meta[property="og:title"]', setMeta(post.seo_title || post.title || ""))
    .on('meta[property="og:description"]', setMeta(meta.desc))
    .on('meta[name="twitter:title"]', setMeta(post.seo_title || post.title || ""))
    .on('meta[name="twitter:description"]', setMeta(meta.desc))
    .on("head", {
      element(el) {
        el.append('<meta property="article:published_time" content="' + B.esc(post.published_at || "") + '">', { html: true });
        el.append('<script type="application/ld+json">' + jsonLdSeguro(meta.jsonLd) + "</script>", { html: true });
      }
    })
    .on("#blogPost", setHtml(miolo))
    .on("#blogPostData", setHtml(jsonLdSeguro(dados)));
  if (meta.imagem) {
    rw = rw
      .on('meta[property="og:image"]', setMeta(meta.imagem))
      .on('meta[name="twitter:image"]', setMeta(meta.imagem))
      // As medidas fixas (1200x630) do og-image.png genérico não valem pra capa.
      .on('meta[property="og:image:width"]', remove)
      .on('meta[property="og:image:height"]', remove);
  }

  const resposta = respostaFinal(rw.transform(shell), 200, SEGUNDOS_NA_BORDA);
  guardaNaBorda(waitUntil, chave, resposta);
  return resposta;
}
