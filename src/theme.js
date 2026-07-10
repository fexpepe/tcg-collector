// Aplica o tema o quanto antes — script SÍNCRONO no <head> pra não piscar (o
// CSP 'self' impede inline). O toggle e a persistência ficam no shared.js.
// Preferência salva vence; sem escolha = AUTO (segue o tema do sistema, como
// os apps nativos). O shared.js escuta a mudança do sistema quando em auto.
(function () {
  try {
    var saved = localStorage.getItem("tcg-collector-theme-v1");
    var theme = (saved === "light" || saved === "dark")
      ? saved
      : (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    }
  } catch (e) { /* ignora */ }
})();
