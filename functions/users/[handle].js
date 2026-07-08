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
  const slabs = (prof.data.graded && Array.isArray(prof.data.graded.items)) ? prof.data.graded.items : [];
  const distinct = items.length;
  // Valor = cartas raw (vbrl sempre BRL) + slabs em BRL (gv tem moeda própria;
  // sem câmbio na borda, moeda diferente fica de fora — aproxima a menor).
  let value = 0;
  if (prof.show_values) {
    value = items.reduce((s, it) => s + (Number(it.vbrl) || 0) * (it.q || 1), 0)
      + slabs.reduce((s, it) => s + (((it.cur || "BRL") === "BRL" ? Number(it.gv) : 0) || 0), 0);
  }
  const url = "https://sleevu.app/users/" + handle;

  const title = `${name} (@${handle}) · Sleevu`;
  let desc = `${distinct} cartas`;
  if (slabs.length) desc += ` · ${slabs.length} slab${slabs.length > 1 ? "s" : ""}`;
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
  const remove = { element(el) { el.remove(); } };

  let rw = new HTMLRewriter()
    .on("title", setText(title))
    .on('meta[property="og:title"]', setMeta(null, title))
    .on('meta[name="twitter:title"]', setMeta(null, title))
    .on('meta[name="description"]', setMeta(null, desc))
    .on('meta[property="og:description"]', setMeta(null, desc))
    .on('meta[name="twitter:description"]', setMeta(null, desc))
    .on('meta[property="og:url"]', setMeta(null, url))
    .on('link[rel="canonical"]', setHref(url));
  if (ogImage) {
    rw = rw
      .on('meta[property="og:image"]', setMeta(null, ogImage))
      .on('meta[name="twitter:image"]', setMeta(null, ogImage))
      // dimensões fixas (1200x630) do .svg genérico não valem pra carta (retrato).
      .on('meta[property="og:image:width"]', remove)
      .on('meta[property="og:image:height"]', remove);
  }
  return rw.transform(shell);
}
