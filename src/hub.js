(function () {
  // HUB: grade de jogos do Sleevu. Os hrefs dos tiles (sets.html?game=...) ficam
  // direto no HTML — assim NÃO dependem deste JS (um hub.js velho em cache não
  // consegue reescrever pra link antigo). Aqui só revelamos o logo de cada jogo
  // e pintamos cada tile com a cor do próprio jogo.

  // Revela o logo do jogo quando o arquivo existe (assets/games/). Se faltar ou
  // falhar, fica o nome em texto — sem ícone de imagem quebrada. (Inline onerror
  // não dá por causa do CSP script-src 'self'.)
  //
  // O invisível-até-carregar é por CLASSE (opacity no CSS), não pelo atributo
  // `hidden`: hidden é display:none, e um <img loading="lazy"> sem caixa de
  // layout NUNCA é considerado "perto do viewport" — o navegador não baixa, o
  // load não dispara e o logo ficava em texto pra sempre (galinha-e-ovo que
  // deixou metade da grade sem logo, com os arquivos no servidor o tempo todo;
  // só os 6 primeiros, sem lazy, apareciam).
  //
  // --r = proporção do arquivo (largura/altura). É dela que o CSS tira o
  // tamanho de cada logo pro equilíbrio óptico da prateleira (ver .hub-logo no
  // styles.css). Gravada ANTES do is-loaded: o logo já aparece no tamanho final.
  document.querySelectorAll(".hub-logo").forEach(function (img) {
    var reveal = function () {
      if (img.naturalWidth > 0) {
        img.style.setProperty("--r", (img.naturalWidth / img.naturalHeight).toFixed(3));
        img.classList.add("is-loaded");
        var text = img.parentElement && img.parentElement.querySelector(".hub-logo-text");
        if (text) text.hidden = true;
      }
    };
    img.addEventListener("load", reveal);
    if (img.complete) reveal();
  });

  // Cor do jogo por TILE: o carimbo data-game-accent faz o --accent daquele
  // tile virar o do jogo do link (o anel do hover e o contorno do foco saem
  // nessa cor — a mesma das páginas do jogo depois do clique). O jogo sai do
  // próprio href, que é a fonte da verdade do tile; os vintage herdam a cor do
  // jogo-pai (?game=onepiece&line=opcd -> onepiece). Respeita a preferência
  // "cores por jogo" das Configurações: desligada, nada é carimbado e o tile
  // segue no neutro da página.
  var shared = window.TCGShared;
  var colorsOn = !(shared && shared.gameColorsEnabled) || shared.gameColorsEnabled();
  if (!colorsOn) return;
  document.querySelectorAll("a.hub-tile").forEach(function (a) {
    var game = "";
    try { game = new URL(a.href).searchParams.get("game") || ""; } catch (e) { /* href estranho: fica neutro */ }
    if (/^[a-z]+$/.test(game)) a.setAttribute("data-game-accent", game);
  });
})();
