// Cabeçalho das páginas ESTÁTICAS: a variante em inglês do set, artista e
// /games (prerender-catalog.mjs). A do set em português e a da carta são a
// tela do APP desde 2026-10-01, com o cabeçalho e o JS do app (ver
// functions/_lib/decora-app.js). A marcação é a do .app-header do
// app, mas a página não tem hambúrguer, busca, tabbar nem shared.js — só o
// styles.css e o theme.js.
//
// O styles.css desenha o cabeçalho do APP, e no celular ele conta com esse JS:
// a ≤860px o .page-nav vira a coluna do drawer que o hambúrguer abre, e a
// ≤700px a marca some (a busca com a câmera toma o lugar dela). Aqui isso dava
// marca escondida e os links empilhados à direita com 38px de altura: o
// cabeçalho fixo comia 101px da tela no /games e 143px na página de set do
// Pokémon (medido a 375px em 2026-09-30; a página de set antiga, em /set/, já
// era assim).
//
// O modificador app-header--estatica devolve marca | links numa linha só, com
// 44px de alvo de toque, sem mexer no cabeçalho do app. O CSS entra no <style>
// inline de cada página (fora do orçamento do núcleo, ver check-size.mjs) e
// mora AQUI, com a marcação, pros três moldes não divergirem.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Cada regra tem uma classe a mais (o modificador) que a regra do app que ela
// desfaz: vence o styles.css sem depender de a folha vir antes do <style>.
//  - 58px de altura, a mesma do cabeçalho do app no celular (44 + 7 + 7).
//  - A marca volta com 44px de altura: o wordmark (667x178) é desenhado com
//    mask "contain", então continua 94x25 na tela — só o alvo de toque cresce.
//  - margin-right negativo igual ao padding do último link: o TEXTO dele fecha
//    a 20px da borda da tela, a mesma distância da marca do outro lado.
//  - 15px nos links: com "Sets · Pokédex · Coleção" (a página de set do
//    Pokémon, a mais cheia) cabe numa linha a partir de 360px. Abaixo disso
//    (iPhone pequeno com Zoom de Tela, Android com a tela ampliada: 320px) o
//    menu aperta pra 14px e 7px de respiro, e ainda cabe. Se um dia não couber
//    (a variante em inglês a 320px, ou um link a mais), ele rola de lado em
//    vez de quebrar a linha.
//  - O foco por teclado desenha o contorno por DENTRO do link: o menu rolável
//    recorta o que passa das bordas dele.
export const ESTILO_DO_CABECALHO = `      @media (max-width: 860px) {
        .app-header--estatica .app-header-inner { gap: 8px; padding: 7px 0; }
        .app-header--estatica .app-header-inner .brand { display: inline-block; height: 44px; }
        .app-header--estatica .app-header-inner .page-nav { flex: 0 1 auto; flex-direction: row; flex-wrap: nowrap; width: auto; min-width: 0; gap: 0; margin-right: -10px; overflow-x: auto; scrollbar-width: none; }
        .app-header--estatica .app-header-inner .page-nav::-webkit-scrollbar { display: none; }
        .app-header--estatica .app-header-inner .page-nav > a { flex: none; width: auto; min-height: 44px; padding: 0 10px; font-size: 15px; white-space: nowrap; }
        .app-header--estatica .app-header-inner .page-nav > a:focus-visible { outline-offset: -3px; }
      }
      @media (max-width: 359px) {
        .app-header--estatica .app-header-inner { gap: 4px; }
        .app-header--estatica .app-header-inner .page-nav { margin-right: -7px; }
        .app-header--estatica .app-header-inner .page-nav > a { padding: 0 7px; font-size: 14px; }
      }`;

// links: [[href, rótulo], ...] na ordem do menu. rotuloDoMenu: o aria-label do
// <nav> no idioma da página (a variante em inglês do set dizia "Páginas").
// O data-i18n-aria é o do app e aqui fica inerte (nada traduz a página no
// cliente), mas a /games mora na RAIZ (games.html) e a guarda 3d do check.mjs
// reprova aria-label sem ele em todo HTML de lá.
export function cabecalhoEstatico(links, rotuloDoMenu = "Páginas") {
  const itens = links.map(([href, rotulo]) => `<a href="${esc(href)}">${esc(rotulo)}</a>`).join("\n          ");
  return `<header class="app-header app-header--estatica">
      <div class="app-header-inner">
        <a class="brand" href="/">Sleevu</a>
        <nav class="page-nav" data-i18n-aria="aria.pages" aria-label="${esc(rotuloDoMenu)}">
          ${itens}
        </nav>
      </div>
    </header>`;
}
