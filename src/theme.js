// Aplica o tema salvo (claro/escuro) o quanto antes — script SÍNCRONO no <head>
// pra não piscar (o CSP 'self' impede inline). O toggle e a persistência ficam no
// shared.js. Padrão por jogo: Lorcana abre no CLARO (dia), o resto no escuro;
// preferência salva pelo usuário sempre vence. (game.js ainda não rodou aqui,
// então detecta o jogo pelo hostname/?game, do mesmo jeito que ele.)
(function () {
  try {
    var saved = localStorage.getItem("tcg-collector-theme-v1");
    // Padrão CLARO (dia) em todo o ecossistema (hub/poke/lorcana). Preferência
    // salva pelo usuário sempre vence.
    var theme = (saved === "light" || saved === "dark") ? saved : "light";
    if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    }
  } catch (e) { /* ignora */ }
})();
