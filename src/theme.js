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
    var LANGS = { pt: "pt-BR", en: "en", es: "es" };
    var savedLang = localStorage.getItem("tcg-collector-ui-lang-v1");
    var lang = LANGS[savedLang] ? savedLang : detectLang();
    window.SLEEVU_LANG = lang;
    document.documentElement.setAttribute("lang", LANGS[lang]);
  } catch (e) { /* ignora: fica o lang do HTML */ }

  // --- i18n por idioma (só em produção) -----------------------------------
  // O deploy (scripts/split-i18n.mjs) reparte cada src/i18n*.js em um arquivo
  // por idioma, troca as tags estáticas por um data-i18n-packs="i18n,i18n-docs" no
  // <html> e preenche o mapa abaixo com os NOMES REAIS (literais, porque o
  // hash-assets reescreve referência por regex — nome concatenado viraria 404
  // imutável). Aqui a página carrega só o idioma ativo: document.write de um
  // script same-origin durante o parse vira um defer normal, que executa antes
  // do shared.js — a mesma posição que o monólito ocupava.
  // Em dev o mapa é null e o atributo não existe: as tags estáticas dos
  // monólitos seguem valendo e este bloco não faz nada.
  var I18N = null; /* SLEEVU_I18N */
  try {
    // data-i18n-packs: "data-i18n" puro é o marcador de elemento traduzível do
    // shared.js — usado no <html>, o aplicador apagaria a página inteira.
    var pacotes = document.documentElement.getAttribute("data-i18n-packs");
    if (I18N && pacotes) {
      var uiLang = window.SLEEVU_LANG || "pt";
      pacotes.split(",").forEach(function (base) {
        var arq = I18N[base] && (I18N[base][uiLang] || I18N[base].pt);
        if (arq) document.write('<script defer src="' + arq + '"><\/script>');
      });
    }
  } catch (e) { /* i18n quebrado é melhor que página quebrada: t() devolve a chave */ }

  // Varre a lista NA ORDEM de preferência do usuário: ["es","pt"] cai em
  // espanhol (temos), ["en-US","pt-BR"] cai em inglês (ele prefere inglês).
  // Idioma que não temos -> inglês, que é a versão internacional.
  function detectLang() {
    var list = (navigator.languages && navigator.languages.length)
      ? navigator.languages
      : [navigator.language || ""];
    for (var i = 0; i < list.length; i++) {
      var code = String(list[i] || "").toLowerCase();
      if (code.indexOf("pt") === 0) return "pt";
      if (code.indexOf("en") === 0) return "en";
      if (code.indexOf("es") === 0) return "es";
    }
    return "en";
  }
})();
