// Peças comuns das Functions de /games, /set e /card (2026-09-30). As do blog
// (functions/blog/_comum.js) fazem o mesmo, mas aquele módulo carrega o
// renderizador inteiro do blog ao ser importado.

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export { hasOwn };

// 404 de verdade: a 404.html com o status certo (Pages só dá 404 sozinho pra
// arquivo que não existe; aqui a Function responde antes).
export async function naoAchou(env, request) {
  const page = await env.ASSETS.fetch(new URL("/404.html", request.url));
  return new Response(page.body, {
    status: 404,
    headers: { "content-type": page.headers.get("content-type") || "text/html; charset=utf-8", "cache-control": "no-store" }
  });
}

// Redirecionamento com a query junto quando ela vem no destino. 301 é o
// endereço que MUDOU (o Google transfere); 302, o que só leva pra perto.
export function redireciona(request, destino, status) {
  return Response.redirect(new URL(destino, request.url).href, status || 301);
}

// JSON publicado junto do site (data/…), lido direto do armazenamento dos
// arquivos (env.ASSETS não passa por Function nem custa requisição externa).
// Qualquer falha vira null: quem chama decide entre 404 e seguir sem o dado.
export async function jsonDoSite(env, request, caminho) {
  try {
    const r = await env.ASSETS.fetch(new URL(caminho, request.url));
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

// Cache da borda (caches.default). Resposta de Function não entra no cache da
// Cloudflare sozinha: o s-maxage só vale com o put explícito.
export async function daBorda(chave) {
  try { return (await caches.default.match(chave)) || null; } catch (e) { return null; }
}
export function guardaNaBorda(waitUntil, chave, resposta) {
  try {
    const p = caches.default.put(chave, resposta.clone()).catch(() => {});
    if (typeof waitUntil === "function") waitUntil(p);
  } catch (e) { /* sem cache disponível: segue sem guardar */ }
}
