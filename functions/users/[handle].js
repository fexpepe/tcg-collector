// Cloudflare Pages Function: /users/<handle>
//
// Serve a SPA (collection.html), mas injeta Open Graph + título + canonical
// DINÂMICOS com os dados do perfil público — pra o link mostrar nome/@/stats ao
// ser colado no WhatsApp/Discord e pra o perfil ser indexável (SEO). O cliente
// (collection.js) hidrata normalmente lendo o handle do caminho.
//
// Roda na borda; substitui o rewrite estático do _redirects p/ esta rota.
// A consulta do perfil, o 404 de verdade e os pedaços do HTMLRewriter moram
// no _perfil.js desde 2026-09-27: o link de uma pasta de venda
// ([handle]/vendas/[pasta].js) faz a MESMA leitura.
import { normalizaHandle, buscaPerfil, notFound, setMeta, setText, setHref, remove, addNoindex, ogImagem } from "./_perfil.js";

function moneyBR(v) {
  try { return "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  catch (e) { return "R$ " + (Math.round(v * 100) / 100); }
}

export async function onRequestGet(context) {
  const { params, env, request } = context;
  const handle = normalizaHandle(params.handle);
  const url = "https://sleevu.app/users/" + handle;
  if (!handle) return notFound(env, request);

  // A consulta tem TRÊS desfechos, e separar os dois últimos é o que importa:
  //   achou           -> shell com título/OG/canonical do perfil (200)
  //   não existe      -> 404 de verdade
  //   consulta falhou -> shell degradada + noindex. Indisponibilidade temporária
  //                      do Supabase não é "esse handle não existe": responder
  //                      404 aqui apagaria perfis REAIS do índice a cada soluço
  //                      da borda, e o dono veria a página de erro sem motivo.
  const { prof, falhou: lookupFailed } = await buscaPerfil(handle);

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

  // og:image = carta mais valiosa do perfil (items já vem ordenado por valor
  // desc) — ver ogImagem no _perfil.js. Imagem real → renderiza em todo lugar,
  // ao contrário do .svg genérico.
  const ogImage = ogImagem(items);

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
