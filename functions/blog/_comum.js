// Peças comuns das Functions do blog: /blog (index.js) e /blog/<slug> ([slug].js).
// Sem handler exportado (onRequest*), então esta rota não existe — é só um
// módulo, como o functions/api/_search-sql.js.
//
// O post vem do Supabase (tabela posts, leitura anônima: a RLS só entrega o
// que está publicado e com data que já passou) e as cartas citadas vêm do D1,
// pelas mesmas consultas da /api/collection. O HTML sai do src/blog-render.js,
// o MESMO arquivo que o editor usa na prévia.
import "../../src/blog-render.js";
import { buildCards, buildPrices, idsComBase, basePricingId, LOTE_IDS } from "../api/_search-sql.js";

export const B = globalThis.SleevuBlog;

export const SUPABASE_URL = "https://dlnalopazitfdgnmdguu.supabase.co";
export const SUPABASE_KEY = "sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL";
export const ORIGEM = "https://sleevu.app";

// Colunas pedidas SEMPRE por nome (nunca select=*): se um dia a tabela ganhar
// coluna que anon não pode ler, o * quebraria a página inteira.
export const COLUNAS_LISTA = "slug,title,subtitle,excerpt,cover_url,cover_alt,game,category,tags,lang,featured,author_name,reading_min,published_at,updated_at";
export const COLUNAS_POST = "id," + COLUNAS_LISTA + ",body_md,seo_title,seo_desc,card_refs";

// Leitura anônima no PostgREST. null = a tabela ainda não existe (migração
// 20260930b pendente: o PostgREST responde 404) — a página trata como "nenhum
// post". Outra falha (rede, 5xx) LANÇA: quem chama decide entre 503 e degradar.
// `env.BLOG_SUPABASE_URL` existe só pra teste local (wrangler pages dev contra
// um servidor de mentira); em produção a variável não existe.
export async function supabase(env, caminho) {
  const base = (env && env.BLOG_SUPABASE_URL) || SUPABASE_URL;
  const r = await fetch(base + caminho, { headers: { apikey: SUPABASE_KEY, Accept: "application/json" } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("supabase " + r.status);
  return r.json();
}

// Cartas citadas no post → Map "jogo/id" → { name, set, setId, number, image, price }.
// Consulta por PK no D1, em lotes (mesmo teto de parâmetros da /api/collection).
// Sem o binding (ou com o banco fora), devolve vazio: o post sai sem as cartas
// em vez de não sair — e o navegador ainda tenta de novo pela /api/collection.
const MAX_REFS = 300;
export async function cartasDoD1(env, refs, lang) {
  const mapa = new Map();
  if (!env || !env.DB || !Array.isArray(refs) || !refs.length) return mapa;
  const porJogo = {};
  refs.slice(0, MAX_REFS).forEach((ref) => {
    if (!B.REF_RE.test(ref)) return;
    const barra = ref.indexOf("/");
    const game = ref.slice(0, barra);
    if (!B.GAMES[game]) return;
    (porJogo[game] = porJogo[game] || []).push(ref.slice(barra + 1));
  });
  const fatias = (lista) => {
    const out = [];
    for (let i = 0; i < lista.length; i += LOTE_IDS) out.push(lista.slice(i, i + LOTE_IDS));
    return out;
  };
  try {
    await Promise.all(Object.keys(porJogo).map(async (game) => {
      const ids = [...new Set(porJogo[game])];
      const consultas = [];
      for (const lote of fatias(ids)) {
        const q = buildCards(game, lote);
        if (q) consultas.push(env.DB.prepare(q.sql).bind(...q.params).all().then((r) => ({ cartas: r.results || [] })));
      }
      for (const lote of fatias(idsComBase(ids))) {
        const q = buildPrices(game, lote);
        if (q) consultas.push(env.DB.prepare(q.sql).bind(...q.params).all().then((r) => ({ precos: r.results || [] })));
      }
      const partes = await Promise.all(consultas);
      const precos = {};
      partes.forEach((p) => (p.precos || []).forEach((l) => { try { precos[l.id] = JSON.parse(l.j); } catch (e) { /* entrada corrompida */ } }));
      partes.forEach((p) => (p.cartas || []).forEach((l) => {
        mapa.set(game + "/" + l.id, {
          name: l.name, set: l.set_name, setId: l.set_id, number: l.number, image: l.image,
          price: B.precoTexto(precos[l.id] || precos[basePricingId(l.id)], lang)
        });
      }));
    }));
  } catch (e) { /* banco fora: segue sem cartas */ }
  return mapa;
}

// ── HTMLRewriter ────────────────────────────────────────────────────────────
export const setMeta = (content) => ({ element(el) { el.setAttribute("content", content); } });
export const setHref = (href) => ({ element(el) { el.setAttribute("href", href); } });
export const setText = (content) => ({ element(el) { el.removeAttribute("data-i18n"); el.setInnerContent(content, { html: false }); } });
export const remove = { element(el) { el.remove(); } };
// HTML que JÁ SAIU do renderizador (tudo escapado lá) ou JSON do jsonLdSeguro.
export const setHtml = (html) => ({ element(el) { el.setInnerContent(html, { html: true }); } });

// 404 de verdade (a 404.html com o status certo), como o functions/users/.
export async function naoAchou(env, request) {
  const page = await env.ASSETS.fetch(new URL("/404.html", request.url));
  return new Response(page.body, {
    status: 404,
    headers: { "content-type": page.headers.get("content-type") || "text/html; charset=utf-8", "cache-control": "no-store" }
  });
}

// Resposta final: os cabeçalhos da casca (a CSP do _headers vem junto — a
// casca é um asset) e o cache dividido em dois: o navegador revalida sempre
// (max-age=0), a borda guarda `segundosNaBorda` (s-maxage) pra não consultar
// o Supabase e o D1 a cada visita. Publicar/editar aparece em até esse tempo;
// o editor usa ?fresco=1 pra ver na hora (e renovar a cópia da borda).
export function respostaFinal(transformada, status, segundosNaBorda) {
  const headers = new Headers(transformada.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set("Cache-Control", segundosNaBorda > 0 ? `public, max-age=0, s-maxage=${segundosNaBorda}, must-revalidate` : "no-store");
  return new Response(transformada.body, { status: status || 200, headers });
}

// Cache de borda (caches.default) com chave fixa por caminho: ?utm_… e afins
// não criam cópia nova. `fresco` força remontar (e regrava a cópia).
export async function daBorda(chave, fresco) {
  if (fresco) return null;
  try { return (await caches.default.match(chave)) || null; } catch (e) { return null; }
}
export function guardaNaBorda(waitUntil, chave, resposta) {
  try {
    const copia = resposta.clone();
    const p = caches.default.put(chave, copia).catch(() => {});
    if (typeof waitUntil === "function") waitUntil(p);
  } catch (e) { /* sem cache disponível */ }
}
