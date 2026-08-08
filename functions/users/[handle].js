// Cloudflare Pages Function: /users/<handle>
//
// Serve a SPA (collection.html), mas injeta Open Graph + título + canonical
// DINÂMICOS com os dados do perfil público — pra o link mostrar nome/@/stats ao
// ser colado no WhatsApp/Discord e pra o perfil ser indexável (SEO). O cliente
// (collection.js) hidrata normalmente lendo o handle do caminho.
//
// Roda na borda; substitui o rewrite estático do _redirects p/ esta rota.
const SUPABASE_URL = "https://dlnalopazitfdgnmdguu.supabase.co";
const SUPABASE_KEY = "sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL";

function moneyBR(v) {
  try { return "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  catch (e) { return "R$ " + (Math.round(v * 100) / 100); }
}

const setMeta = (content) => ({
  element(el) { el.setAttribute("content", content); }
});
const setText = (content) => ({
  element(el) { el.removeAttribute("data-i18n"); el.setInnerContent(content, { html: false }); }
});
const setHref = (href) => ({
  element(el) { el.setAttribute("href", href); }
});
const remove = { element(el) { el.remove(); } };
const addNoindex = {
  element(el) { el.append('<meta name="robots" content="noindex">', { html: true }); }
};

// 404 DE VERDADE: a 404.html do site com o status certo. env.ASSETS.fetch devolve
// 200 pro caminho pedido, então o status é reescrito aqui. Sem isto, handle
// inexistente respondia 200 com a casca vazia da coleção — que é a definição de
// "soft 404" pro Google (e era reportado como tal no Search Console).
// Cabeçalho montado à mão em vez de copiar os do asset: repassar um
// content-encoding junto de um corpo já decodificado quebra a resposta.
async function notFound(env, request) {
  const page = await env.ASSETS.fetch(new URL("/404.html", request.url));
  return new Response(page.body, {
    status: 404,
    headers: { "content-type": page.headers.get("content-type") || "text/html; charset=utf-8" }
  });
}

export async function onRequestGet(context) {
  const { params, env, request } = context;
  const handle = String(params.handle || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
  const url = "https://sleevu.app/users/" + handle;
  if (!handle) return notFound(env, request);

  // A consulta tem TRÊS desfechos, e separar os dois últimos é o que importa:
  //   achou           -> shell com título/OG/canonical do perfil (200)
  //   não existe      -> 404 de verdade
  //   consulta falhou -> shell degradada + noindex. Indisponibilidade temporária
  //                      do Supabase não é "esse handle não existe": responder
  //                      404 aqui apagaria perfis REAIS do índice a cada soluço
  //                      da borda, e o dono veria a página de erro sem motivo.
  let prof = null;
  let lookupFailed = false;
  try {
    // RPC de leitura pontual (a tabela não é paginável por anon — anti-scraping).
    // GET (a função é STABLE) pra manter o cacheTtl da borda, que POST não tem.
    // Fallback pro SELECT direto enquanto a RPC não existir no banco — o 404 do
    // PostgREST aqui é FUNÇÃO ausente, não handle ausente (handle sem perfil
    // volta 200 com lista vazia).
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_profile?p_handle=${encodeURIComponent(handle)}`, {
      headers: { apikey: SUPABASE_KEY }, cf: { cacheTtl: 60 }
    });
    if (r.ok) { const rows = await r.json(); prof = rows && rows[0]; }
    else if (r.status === 404) {
      const f = await fetch(`${SUPABASE_URL}/rest/v1/public_profiles?handle=eq.${encodeURIComponent(handle)}&select=display_name,show_values,data`, {
        headers: { apikey: SUPABASE_KEY }, cf: { cacheTtl: 60 }
      });
      if (f.ok) { const rows = await f.json(); prof = rows && rows[0]; }
      else lookupFailed = true;
    } else lookupFailed = true;
  } catch (e) { lookupFailed = true; }

  if (!lookupFailed && !prof) return notFound(env, request);

  // Sempre serve a mesma shell (a SPA hidrata pelo caminho).
  const shell = await env.ASSETS.fetch(new URL("/collection.html", request.url));

  // Consulta falhou, ou o perfil existe mas não publicou nada. A shell CRUA traz
  // a canonical de /collection — e isso dobrava TODO perfil nessa URL, que o
  // próprio robots.txt bloqueia (o Search Console reportava "página alternativa
  // com tag canônica adequada"). Aponta a canonical pra si mesma e marca
  // noindex: não há conteúdo pra indexar, mas a página segue servindo quem abriu.
  if (lookupFailed || !prof.data) {
    return new HTMLRewriter()
      .on('link[rel="canonical"]', setHref(url))
      .on('meta[property="og:url"]', setMeta(url))
      .on("head", addNoindex)
      .transform(shell);
  }

  const name = (prof.display_name || ("@" + handle)).trim();
  const items = (prof.data.collection && Array.isArray(prof.data.collection.items)) ? prof.data.collection.items : [];
  const slabs = (prof.data.graded && Array.isArray(prof.data.graded.items)) ? prof.data.graded.items : [];
  const distinct = items.length;
  // Valor = cartas raw (vbrl sempre BRL) + slabs em BRL (gv tem moeda própria;
  // sem câmbio na borda, moeda diferente fica de fora — aproxima a menor).
  let value = 0;
  if (prof.show_values) {
    value = items.reduce((s, it) => s + (Number(it.vbrl) || 0) * (it.q || 1), 0)
      + slabs.reduce((s, it) => s + (((it.cur || "BRL") === "BRL" ? Number(it.gv) : 0) || 0), 0);
  }

  const title = `${name} (@${handle}) · Sleevu`;
  let desc = `${distinct} cartas`;
  if (slabs.length) desc += ` · ${slabs.length} slab${slabs.length > 1 ? "s" : ""}`;
  if (value > 0) desc += ` · ${moneyBR(value)}`;
  desc += ` — veja a coleção${(prof.data.sales && prof.data.sales.items && prof.data.sales.items.length) ? " e a lista de Vendas e Trocas" : ""} de ${name} no Sleevu.`;

  // og:image = carta mais valiosa do perfil (items já vem ordenado por valor desc),
  // pulando .avif (Lorcana) que WhatsApp/Facebook não renderizam como preview.
  // Imagem real → renderiza em todo lugar, ao contrário do .svg genérico.
  // ABSOLUTIZA o caminho: img pode ser relativo (ex.: data/onepiece/vintage-images/
  // x.webp) e og:image relativo é ignorado pelos crawlers — o preview sumia
  // justamente pra quem tem uma vintage como carta mais valiosa. Preferência por
  // png/jpg (webp ainda falha no preview do WhatsApp); senão o primeiro não-avif.
  const absImg = (u) => /^https?:\/\//i.test(u) ? u : "https://sleevu.app/" + String(u).replace(/^\/+/, "");
  const usable = items.filter((it) => it.img && !/\.avif(\?|$)/i.test(it.img));
  const ogPick = usable.find((it) => /\.(png|jpe?g)(\?|$)/i.test(it.img)) || usable[0];
  const ogImage = ogPick ? absImg(ogPick.img) : null;

  let rw = new HTMLRewriter()
    .on("title", setText(title))
    .on('meta[property="og:title"]', setMeta(title))
    .on('meta[name="twitter:title"]', setMeta(title))
    .on('meta[name="description"]', setMeta(desc))
    .on('meta[property="og:description"]', setMeta(desc))
    .on('meta[name="twitter:description"]', setMeta(desc))
    .on('meta[property="og:url"]', setMeta(url))
    .on('link[rel="canonical"]', setHref(url));
  if (ogImage) {
    rw = rw
      .on('meta[property="og:image"]', setMeta(ogImage))
      .on('meta[name="twitter:image"]', setMeta(ogImage))
      // dimensões fixas (1200x630) do .svg genérico não valem pra carta (retrato).
      .on('meta[property="og:image:width"]', remove)
      .on('meta[property="og:image:height"]', remove);
  }
  return rw.transform(shell);
}
