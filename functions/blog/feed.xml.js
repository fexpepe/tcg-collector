// Cloudflare Pages Function: /blog/feed.xml — o RSS do blog.
//
// Leitor de feed, agregador e o próprio Google Discover acham post novo por
// aqui sem esperar o sitemap (que só é regerado no deploy diário). Mesma
// leitura anônima da lista (a RLS só entrega o publicado com data passada).
// Rota estática: vence o [slug].js pro caminho /blog/feed.xml.
import { B, supabase, ORIGEM } from "./_comum.js";

const MAX_ITENS = 30;
const SEGUNDOS_NA_BORDA = 600;

const xml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

// RSS 2.0 a partir das linhas da tabela posts (as mais novas primeiro). Puro —
// testado em tests/blog-function.test.mjs.
export function rssDoBlog(posts, agora) {
  const itens = (posts || []).slice(0, MAX_ITENS).map((p) => {
    const url = ORIGEM + B.URL_DO_POST(p.slug);
    const lang = B.ROTULOS[p.lang] ? p.lang : "pt";
    const cat = B.nomeCategoria(p.category, lang);
    const capa = B.safeImg(p.cover_url);
    return "    <item>\n"
      + `      <title>${xml(p.title)}</title>\n`
      + `      <link>${xml(url)}</link>\n`
      + `      <guid isPermaLink="true">${xml(url)}</guid>\n`
      + (p.published_at ? `      <pubDate>${new Date(p.published_at).toUTCString()}</pubDate>\n` : "")
      + (p.excerpt || p.subtitle ? `      <description>${xml(p.excerpt || p.subtitle)}</description>\n` : "")
      + (cat ? `      <category>${xml(cat)}</category>\n` : "")
      + (p.game && B.GAMES[p.game] ? `      <category>${xml(B.GAMES[p.game][0])}</category>\n` : "")
      + (p.author_name ? `      <dc:creator>${xml(p.author_name)}</dc:creator>\n` : "")
      + (capa && /^https:\/\//.test(capa) ? `      <media:content url="${xml(capa)}" medium="image"/>\n` : "")
      + "    </item>";
  });
  const maisNovo = (posts && posts[0] && posts[0].published_at) || agora;
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">\n'
    + "  <channel>\n"
    + "    <title>Blog do Sleevu</title>\n"
    + `    <link>${ORIGEM}/blog</link>\n`
    + `    <atom:link href="${ORIGEM}/blog/feed.xml" rel="self" type="application/rss+xml"/>\n`
    + "    <description>Guias, mercado e a história das cartas colecionáveis.</description>\n"
    + "    <language>pt-BR</language>\n"
    + `    <lastBuildDate>${new Date(maisNovo).toUTCString()}</lastBuildDate>\n`
    + (itens.length ? itens.join("\n") + "\n" : "")
    + "  </channel>\n"
    + "</rss>\n";
}

export async function onRequestGet(context) {
  const { env } = context;
  let posts;
  try {
    posts = (await supabase(env, `/rest/v1/posts?select=slug,title,subtitle,excerpt,cover_url,game,category,lang,author_name,published_at&order=published_at.desc&limit=${MAX_ITENS}`)) || [];
  } catch (e) {
    return new Response("feed indisponível", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "300", "Cache-Control": "no-store" } });
  }
  return new Response(rssDoBlog(posts, new Date().toISOString()), {
    status: 200,
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": `public, max-age=300, s-maxage=${SEGUNDOS_NA_BORDA}`
    }
  });
}
