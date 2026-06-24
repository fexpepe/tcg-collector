(function () {
  // HUB: grade de jogos do Sleevu. Site único — cada tile leva aos SETS daquele
  // jogo com ?game=, que ENTRA na sessão daquele jogo (lida pelas próximas páginas).
  function setsUrl(game) {
    return "sets.html?game=" + game;
  }
  document.querySelectorAll(".hub-tile[data-game]").forEach(function (tile) {
    tile.setAttribute("href", setsUrl(tile.dataset.game));
  });

  // Revela o logo do jogo quando o arquivo existe (assets/games/). Se faltar ou
  // falhar, fica o nome em texto — sem ícone de imagem quebrada. (Inline onerror
  // não dá por causa do CSP script-src 'self'.)
  document.querySelectorAll(".hub-logo").forEach(function (img) {
    var reveal = function () {
      if (img.naturalWidth > 0) {
        img.hidden = false;
        var text = img.parentElement && img.parentElement.querySelector(".hub-logo-text");
        if (text) text.hidden = true;
      }
    };
    img.addEventListener("load", reveal);
    if (img.complete) reveal();
  });
})();
