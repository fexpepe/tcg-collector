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

export async function onRequestGet(context) {
  const { params, env, request } = context;
  const handle = String(params.handle || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);

  // Sempre serve a mesma shell (a SPA hidrata pelo caminho).
  const shell = await env.ASSETS.fetch(new URL("/collection.html", request.url));

  let prof = null;
  if (handle) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/public_profiles?handle=eq.${encodeURIComponent(handle)}&select=display_name,show_values,data`, {
        headers: { apikey: SUPABASE_KEY }, cf: { cacheTtl: 60 }
      });
      if (r.ok) { const rows = await r.json(); prof = rows && rows[0]; }
    } catch (e) { /* sem perfil: serve a shell sem OG dinâmico */ }
  }
  if (!prof || !prof.data) return shell;

  const name = (prof.display_name || ("@" + handle)).trim();
  const items = (prof.data.collection && Array.isArray(prof.data.collection.items)) ? prof.data.collection.items : [];
  const copies = items.reduce((s, it) => s + (it.q || 1), 0);
  const distinct = items.length;
  const value = prof.show_values ? items.reduce((s, it) => s + (Number(it.vbrl) || 0) * (it.q || 1), 0) : 0;
  const url = "https://sleevu.app/users/" + handle;

  const title = `${name} (@${handle}) · Sleevu`;
  let desc = `${distinct} cartas`;
  if (value > 0) desc += ` · ${moneyBR(value)}`;
  desc += ` — veja a coleção${(prof.data.sales && prof.data.sales.items && prof.data.sales.items.length) ? " e a lista de Vendas e Trocas" : ""} de ${name} no Sleevu.`;

  const setMeta = (sel, content) => ({
    element(el) { el.setAttribute("content", content); }
  });
  const setText = (content) => ({
    element(el) { el.removeAttribute("data-i18n"); el.setInnerContent(content, { html: false }); }
  });
  const setHref = (href) => ({
    element(el) { el.setAttribute("href", href); }
  });

  return new HTMLRewriter()
    .on("title", setText(title))
    .on('meta[property="og:title"]', setMeta(null, title))
    .on('meta[name="twitter:title"]', setMeta(null, title))
    .on('meta[name="description"]', setMeta(null, desc))
    .on('meta[property="og:description"]', setMeta(null, desc))
    .on('meta[name="twitter:description"]', setMeta(null, desc))
    .on('meta[property="og:url"]', setMeta(null, url))
    .on('link[rel="canonical"]', setHref(url))
    .transform(shell);
}
