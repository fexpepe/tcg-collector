// Preferências que precisam valer ANTES da primeira pintura — script SÍNCRONO
// no <head> (o CSP 'self' impede inline). O toggle e a persistência ficam no
// shared.js. Regra dos dois: preferência salva vence; sem escolha, segue o
// sistema/navegador (como os apps nativos).
(function () {
  // --- Tema: salvo > prefers-color-scheme ---------------------------------
  try {
    var saved = localStorage.getItem("tcg-collector-theme-v1");
    var theme = (saved === "light" || saved === "dark")
      ? saved
      : (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    }
  } catch (e) { /* ignora */ }

  // --- Idioma da interface: salvo > idioma do navegador -------------------
  // Roda AQUI (e não só no shared.js) pra o <html lang> já nascer certo: o
  // shared.js é `defer`, então até ele rodar o documento anunciaria pt-BR mesmo
  // numa página que vai ser renderizada em inglês — leitor de tela e buscador
  // leem esse atributo antes.
  // NÃO grava nada: só a escolha explícita do usuário é persistida, senão
  // "detectado" viraria indistinguível de "escolhido" e a detecção nunca mais
  // acompanharia uma troca de idioma do navegador.
  try {
    var LANGS = { pt: "pt-BR", en: "en" };
    var savedLang = localStorage.getItem("tcg-collector-ui-lang-v1");
    var lang = LANGS[savedLang] ? savedLang : detectLang();
    window.SLEEVU_LANG = lang;
    document.documentElement.setAttribute("lang", LANGS[lang]);
  } catch (e) { /* ignora: fica o lang do HTML */ }

  // Varre a lista NA ORDEM de preferência do usuário: ["es","pt"] cai em pt
  // (temos português), ["en-US","pt-BR"] cai em inglês (ele prefere inglês).
  // Idioma que não é pt nem en -> inglês, que é a versão internacional.
  function detectLang() {
    var list = (navigator.languages && navigator.languages.length)
      ? navigator.languages
      : [navigator.language || ""];
    for (var i = 0; i < list.length; i++) {
      var code = String(list[i] || "").toLowerCase();
      if (code.indexOf("pt") === 0) return "pt";
      if (code.indexOf("en") === 0) return "en";
    }
    return "en";
  }
})();
