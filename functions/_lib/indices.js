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

// Textos fixos dos índices no idioma de quem lê (2026-11-22). A borda escreve
// em português, que é o que o robô lê; o cliente traduz o que tem data-i18n
// (applyTranslations varre o documento todo e troca o textContent do elemento).
// Por isso o data-i18n vai num <span> só na parte FIXA da frase, e a variável
// (nome do jogo, do set, o N) fica fora dele: dentro, a tradução a apagaria.
// Sem JS ou sem tradução, o span some na leitura e a frase sai em português.
// (O summary dos índices é flex: o espaço antes do "(N)" some na tela, e o
// `gap` do CSS dele o devolve. No jogo, que não é flex, o espaço do texto basta.)
export const verLista = (n) => `<span data-i18n="idx.viewList">Ver a lista</span> (${n})`;
// "1 carta" / "N cartas": a palavra concorda com o N também na tradução.
export const nCartas = (n) => n === 1
  ? `${n} <span data-i18n="idx.cardWord">carta</span>`
  : `${n} <span data-i18n="idx.cardsWord">cartas</span>`;

// `esperando`: os seletores (no <main>, antes do índice) do conteúdo que a
// tela ainda não desenhou.
// `chaveDoTitulo`: a chave do i18n do título (que é todo ele fixo). `extraHtml`
// de cada item chega pronto: quem monta escapa o que for texto de dado.
function indice({ esperando, titulo, chaveDoTitulo, itens }) {
  if (!itens.length) return "";
  const espera = esperando.map((sel) => `html[data-game] ${sel}~.indice-paginas`).join(",");
  return `<section class="indice-paginas">
        <style>${espera}{display:none}.indice-paginas{margin:40px 0 8px}.indice-paginas h2{font-size:1.05rem;margin:0 0 8px}.indice-paginas summary{cursor:pointer;color:var(--muted,#9aa0aa);min-height:44px;display:flex;align-items:center;gap:.3em}.indice-paginas ul{list-style:none;padding:0;margin:12px 0 0;columns:3 220px;column-gap:24px}.indice-paginas li{margin:0 0 6px;break-inside:avoid}.indice-paginas a{color:var(--accent,#e63946);text-decoration:none}.indice-paginas small{color:var(--muted,#9aa0aa)}</style>
        <h2 data-i18n="${chaveDoTitulo}">${escapeHtml(titulo)}</h2>
        <details><summary>${verLista(itens.length)}</summary><ul>${itens.map((x) =>
          `<li><a href="${escapeAttr(x.href)}">${escapeHtml(x.nome)}</a>${x.extraHtml ? ` <small>${x.extraHtml}</small>` : ""}</li>`).join("")}</ul></details>
      </section>`;
}

// Linhas do mapa do build: [slug, nome, extra]. Slug fora da régua sai (o
// endereço é montado daqui).
const linhas = (lista) => (Array.isArray(lista) ? lista : [])
  .filter((x) => Array.isArray(x) && SLUG.test(String(x[0])) && x[1]);

// data/game-pages/artistas.json: [slug, nome, nº de cartas].
export function indiceDeArtistas(lista) {
  const itens = linhas(lista).map(([slug, nome, n]) => ({
    href: `/artist/${slug}`, nome: String(nome), extraHtml: Number(n) > 0 ? nCartas(Number(n)) : ""
  }));
  return indice({ esperando: ["#cardGrid:empty", "#cardGrid:has(.skel)"], titulo: "Artistas com página no Sleevu", chaveDoTitulo: "idx.artistsTitle", itens });
}

// data/game-pages/decks.json: [slug, nome, jogo]. A galeria começa só com o
// <noscript> dentro e passa pelo esqueleto.
export function indiceDeDecks(lista) {
  const itens = linhas(lista).map(([slug, nome, jogo]) => ({ href: `/deck/${slug}`, nome: String(nome), extraHtml: jogo ? escapeHtml(String(jogo)) : "" }));
  return indice({ esperando: ["#deckCommunity:not(:has(> :not(noscript)))", "#deckCommunity:has(.skel)"], titulo: "Decks da comunidade com página própria", chaveDoTitulo: "idx.decksTitle", itens });
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
