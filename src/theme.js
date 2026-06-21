// Aplica o tema salvo (claro/escuro) o quanto antes — script SÍNCRONO no <head>
// pra não piscar (o CSP 'self' impede inline). Padrão é escuro; só o claro
// precisa do atributo. O toggle e a persistência ficam no shared.js.
(function () {
  try {
    if (localStorage.getItem("tcg-collector-theme-v1") === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    }
  } catch (e) { /* ignora */ }
})();
