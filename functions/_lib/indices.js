// Índices das páginas estáticas que o app não linka (2026-10-13): as de
// artista (/artist/<slug>) e as de deck (/deck/<slug>), que o prerender gera.
// O app abre o artista em /detail?type=artist (noindex) e o deck em
// /decks?s=<id> (canonical /decks): nenhum link do site chegava nelas, só o
// sitemap — e página que só o sitemap conhece é a última da fila de rastreio.
// A borda põe o índice no pé de /artists e /decks (functions/artists.js e
// decks.js), recolhido num <details>, no molde do índice de sets da tela do
// jogo (metaDoJogo). Com JS, ele espera o conteúdo da tela: aparecendo antes,
// pularia pra baixo quando a grade enchesse (CLS). O robô sem JS não tem o
// data-game e vê o índice como sempre. Funções puras (o HTMLRewriter não roda
// em node; tests/indices.test.mjs testa daqui).
import { escapeHtml, escapeAttr } from "./pagina-carta.js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// `esperando`: os seletores (no <main>, antes do índice) do conteúdo que a
// tela ainda não desenhou.
function indice({ esperando, titulo, itens }) {
  if (!itens.length) return "";
  const espera = esperando.map((sel) => `html[data-game] ${sel}~.indice-paginas`).join(",");
  return `<section class="indice-paginas">
        <style>${espera}{display:none}.indice-paginas{margin:40px 0 8px}.indice-paginas h2{font-size:1.05rem;margin:0 0 8px}.indice-paginas summary{cursor:pointer;color:var(--muted,#9aa0aa);min-height:44px;display:flex;align-items:center}.indice-paginas ul{list-style:none;padding:0;margin:12px 0 0;columns:3 220px;column-gap:24px}.indice-paginas li{margin:0 0 6px;break-inside:avoid}.indice-paginas a{color:var(--accent,#e63946);text-decoration:none}.indice-paginas small{color:var(--muted,#9aa0aa)}</style>
        <h2>${escapeHtml(titulo)}</h2>
        <details><summary>Ver a lista (${itens.length})</summary><ul>${itens.map((x) =>
          `<li><a href="${escapeAttr(x.href)}">${escapeHtml(x.nome)}</a>${x.extra ? ` <small>${escapeHtml(x.extra)}</small>` : ""}</li>`).join("")}</ul></details>
      </section>`;
}

// Linhas do mapa do build: [slug, nome, extra]. Slug fora da régua sai (o
// endereço é montado daqui).
const linhas = (lista) => (Array.isArray(lista) ? lista : [])
  .filter((x) => Array.isArray(x) && SLUG.test(String(x[0])) && x[1]);

// data/game-pages/artistas.json: [slug, nome, nº de cartas].
export function indiceDeArtistas(lista) {
  const itens = linhas(lista).map(([slug, nome, n]) => ({
    href: `/artist/${slug}`, nome: String(nome), extra: Number(n) > 0 ? `${Number(n)} cartas` : ""
  }));
  return indice({ esperando: ["#cardGrid:empty", "#cardGrid:has(.skel)"], titulo: "Artistas com página no Sleevu", itens });
}

// data/game-pages/decks.json: [slug, nome, jogo]. A galeria começa só com o
// <noscript> dentro e passa pelo esqueleto.
export function indiceDeDecks(lista) {
  const itens = linhas(lista).map(([slug, nome, jogo]) => ({ href: `/deck/${slug}`, nome: String(nome), extra: jogo ? String(jogo) : "" }));
  return indice({ esperando: ["#deckCommunity:not(:has(> :not(noscript)))", "#deckCommunity:has(.skel)"], titulo: "Decks da comunidade com página própria", itens });
}

// O decora do paginaComVitrine: o índice no fim do <main>, se o mapa existir.
export function comIndice(caminhoDoMapa, monta) {
  return async (casca, { env, request }) => {
    let lista = null;
    try {
      const r = await env.ASSETS.fetch(new URL(caminhoDoMapa, request.url));
      lista = r.ok ? await r.json() : null;
    } catch (e) { /* sem mapa: sem índice */ }
    const html = monta(lista);
    if (!html) return casca;
    return new HTMLRewriter().on("main", { element(el) { el.append(html, { html: true }); } }).transform(casca);
  };
}
