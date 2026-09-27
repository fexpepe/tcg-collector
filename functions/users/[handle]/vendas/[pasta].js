// Cloudflare Pages Function: /users/<handle>/vendas/<pasta>
//
// O link público de UMA pasta de venda (2026-09-27) — o que a pessoa copia no
// "Compartilhar" da pasta e cola no grupo de troca. Serve a mesma SPA do perfil
// (collection.html; o collection.js abre a aba Vendas com a pasta aberta, pelo
// caminho), mas com título, descrição e imagem DA PASTA: sem isto a prévia no
// WhatsApp mostrava o cartão genérico da Coleção, e ninguém sabia o que era o
// link antes de abrir.
//
// <pasta> é o slug do nome ("Cartas Raras" → cartas-raras), o mesmo que o
// payload do perfil grava em sales.groups[].id (shared.saleFolderSlugs).
// Sem esta Function a rota caía no rewrite do _redirects (/users/* →
// /collection) e continuava funcionando, só com a prévia genérica.
import { normalizaHandle, buscaPerfil, notFound, setMeta, setText, setHref, remove, addNoindex, ogImagem } from "../../_perfil.js";

function dinheiro(cur, v) {
  try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur || "BRL" }).format(v); }
  catch (e) { return `${cur || "R$"} ${Math.round(v * 100) / 100}`; }
}

// Título/descrição/canonical/imagem da pasta, ou null se a pasta não existe no
// perfil publicado (renomeada, apagada, ou perfil anterior às pastas).
// Exportada pro teste: o HTMLRewriter não roda em node, a regra roda.
export function metaDaPastaDeVenda(prof, handle, pasta) {
  const sales = prof && prof.data && prof.data.sales;
  if (!sales || !Array.isArray(sales.groups) || !Array.isArray(sales.items)) return null;
  const grupo = sales.groups.find((g) => g && g.id === pasta);
  if (!grupo) return null;
  const itens = sales.items.filter((it) => it && it.sg === grupo.id);
  if (!itens.length) return null;
  const nome = String(prof.display_name || ("@" + handle)).trim();
  const pastaNome = String(grupo.name || grupo.id).trim();
  const total = itens.reduce((s, it) => s + (Number(it.sp) || 0), 0);
  const titulo = `${pastaNome} · Vendas de ${nome} (@${handle}) · Sleevu`;
  let desc = `${itens.length} ${itens.length === 1 ? "carta" : "cartas"} à venda`;
  if (total > 0) desc += ` · ${dinheiro(sales.cur, total)}`;
  desc += ` — preço e condição de cada carta da pasta "${pastaNome}" de ${nome} no Sleevu.`;
  // A imagem é a carta mais cara da pasta (a que vende o link).
  const porPreco = itens.slice().sort((a, b) => (Number(b.sp) || 0) - (Number(a.sp) || 0));
  return {
    titulo,
    desc,
    canonical: `https://sleevu.app/users/${handle}/vendas/${encodeURIComponent(grupo.id)}`,
    imagem: ogImagem(porPreco)
  };
}

export async function onRequestGet(context) {
  const { params, env, request } = context;
  const handle = normalizaHandle(params.handle);
  // Slug: minúsculas, números e hífen (a régua do saleFolderSlugs).
  const pasta = String(params.pasta || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 80);
  if (!handle) return notFound(env, request);

  const { prof, falhou } = await buscaPerfil(handle);
  if (!falhou && !prof) return notFound(env, request);

  const shell = await env.ASSETS.fetch(new URL("/collection.html", request.url));
  const meta = !falhou && prof.data ? metaDaPastaDeVenda(prof, handle, pasta) : null;

  // Consulta falhou, ou a pasta não existe mais (renomeada/apagada): a SPA
  // segue servindo quem abriu — o collection.js cai na aba Vendas, com as
  // pastas que existem — e a canonical aponta pra aba, com noindex.
  if (!meta) {
    const aba = `https://sleevu.app/users/${handle}/vendas`;
    return new HTMLRewriter()
      .on('link[rel="canonical"]', setHref(aba))
      .on('meta[property="og:url"]', setMeta(aba))
      .on("head", addNoindex)
      .transform(shell);
  }

  let rw = new HTMLRewriter()
    .on("title", setText(meta.titulo))
    .on('meta[property="og:title"]', setMeta(meta.titulo))
    .on('meta[name="twitter:title"]', setMeta(meta.titulo))
    .on('meta[name="description"]', setMeta(meta.desc))
    .on('meta[property="og:description"]', setMeta(meta.desc))
    .on('meta[name="twitter:description"]', setMeta(meta.desc))
    .on('meta[property="og:url"]', setMeta(meta.canonical))
    .on('link[rel="canonical"]', setHref(meta.canonical));
  if (meta.imagem) {
    rw = rw
      .on('meta[property="og:image"]', setMeta(meta.imagem))
      .on('meta[name="twitter:image"]', setMeta(meta.imagem))
      // dimensões fixas (1200x630) da imagem genérica não valem pra carta (retrato).
      .on('meta[property="og:image:width"]', remove)
      .on('meta[property="og:image:height"]', remove);
  }
  return rw.transform(shell);
}
