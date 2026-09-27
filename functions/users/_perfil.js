// Perfil público na borda — o que as duas rotas de /users/ dividem:
//   /users/<handle>                  -> [handle].js
//   /users/<handle>/vendas/<pasta>   -> [handle]/vendas/[pasta].js (2026-09-27)
// Um lugar só: a consulta tem TRÊS desfechos (achou / não existe / falhou) e as
// duas rotas precisam separar os dois últimos do mesmo jeito — senão um soluço
// do Supabase vira 404 num link de pasta que alguém acabou de mandar no grupo.
// Sem handler exportado de propósito: não vira rota (mesmo desenho do
// functions/api/_search-sql.js).
export const SUPABASE_URL = "https://dlnalopazitfdgnmdguu.supabase.co";
export const SUPABASE_KEY = "sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL";

// @ válido: minúsculas, números e _ (a mesma régua do normalizeHandle do shared.js).
export function normalizaHandle(raw) {
  return String(raw || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
}

// { prof, falhou }:
//   achou           -> { prof: linha do perfil, falhou: false }
//   não existe      -> { prof: null, falhou: false }  (quem chama responde 404)
//   consulta falhou -> { prof: null, falhou: true }   (shell degradada + noindex:
//                      indisponibilidade temporária do Supabase não é "esse
//                      handle não existe" — responder 404 aqui apagaria perfis
//                      REAIS do índice a cada soluço da borda)
// RPC de leitura pontual (a tabela não é paginável por anon — anti-scraping).
// GET (a função é STABLE) pra manter o cacheTtl da borda, que POST não tem.
// Fallback pro SELECT direto enquanto a RPC não existir no banco — o 404 do
// PostgREST aqui é FUNÇÃO ausente, não handle ausente (handle sem perfil volta
// 200 com lista vazia).
export async function buscaPerfil(handle, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(`${SUPABASE_URL}/rest/v1/rpc/get_public_profile?p_handle=${encodeURIComponent(handle)}`, {
      headers: { apikey: SUPABASE_KEY }, cf: { cacheTtl: 60 }
    });
    if (r.ok) { const rows = await r.json(); return { prof: (rows && rows[0]) || null, falhou: false }; }
    if (r.status === 404) {
      const f = await fetchImpl(`${SUPABASE_URL}/rest/v1/public_profiles?handle=eq.${encodeURIComponent(handle)}&select=display_name,show_values,data`, {
        headers: { apikey: SUPABASE_KEY }, cf: { cacheTtl: 60 }
      });
      if (f.ok) { const rows = await f.json(); return { prof: (rows && rows[0]) || null, falhou: false }; }
    }
    return { prof: null, falhou: true };
  } catch (e) { return { prof: null, falhou: true }; }
}

// Pedaços do HTMLRewriter (a API da borda) que as duas rotas usam.
export const setMeta = (content) => ({
  element(el) { el.setAttribute("content", content); }
});
export const setText = (content) => ({
  element(el) { el.removeAttribute("data-i18n"); el.setInnerContent(content, { html: false }); }
});
export const setHref = (href) => ({
  element(el) { el.setAttribute("href", href); }
});
export const remove = { element(el) { el.remove(); } };
export const addNoindex = {
  element(el) { el.append('<meta name="robots" content="noindex">', { html: true }); }
};

// 404 DE VERDADE: a 404.html do site com o status certo. env.ASSETS.fetch devolve
// 200 pro caminho pedido, então o status é reescrito aqui. Sem isto, handle
// inexistente respondia 200 com a casca vazia da coleção — que é a definição de
// "soft 404" pro Google (e era reportado como tal no Search Console).
// Cabeçalho montado à mão em vez de copiar os do asset: repassar um
// content-encoding junto de um corpo já decodificado quebra a resposta.
export async function notFound(env, request) {
  const page = await env.ASSETS.fetch(new URL("/404.html", request.url));
  return new Response(page.body, {
    status: 404,
    headers: { "content-type": page.headers.get("content-type") || "text/html; charset=utf-8" }
  });
}

// ABSOLUTIZA o caminho da imagem: img pode ser relativo (ex.: data/onepiece/
// vintage-images/x.webp) e og:image relativo é ignorado pelos crawlers.
export const absImg = (u) => /^https?:\/\//i.test(u) ? u : "https://sleevu.app/" + String(u).replace(/^\/+/, "");

// og:image a partir de itens JÁ ordenados do mais pro menos valioso: pula .avif
// (Lorcana), que WhatsApp/Facebook não renderizam como preview, e prefere
// png/jpg (webp ainda falha no preview do WhatsApp); senão o primeiro não-avif.
export function ogImagem(items) {
  const usable = (items || []).filter((it) => it && it.img && !/\.avif(\?|$)/i.test(it.img));
  const pick = usable.find((it) => /\.(png|jpe?g)(\?|$)/i.test(it.img)) || usable[0];
  return pick ? absImg(pick.img) : null;
}
