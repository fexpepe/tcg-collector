(function () {
  // HUB: grade de jogos do Sleevu. Os hrefs dos tiles (sets.html?game=...) ficam
  // direto no HTML — assim NÃO dependem deste JS (um hub.js velho em cache não
  // consegue reescrever pra link antigo). Aqui só revelamos o logo de cada jogo.

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
  document.querySelectorAll(".hub-logo").forEach(function (img) {
    var reveal = function () {
      if (img.naturalWidth > 0) {
        img.classList.add("is-loaded");
        var text = img.parentElement && img.parentElement.querySelector(".hub-logo-text");
        if (text) text.hidden = true;
      }
    };
    img.addEventListener("load", reveal);
    if (img.complete) reveal();
  });
})();
