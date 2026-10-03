// Preferências que precisam valer ANTES da primeira pintura — script SÍNCRONO
// no <head> (o CSP 'self' impede inline). O toggle e a persistência ficam no
// shared.js. Regra dos dois: preferência salva vence; sem escolha, segue o
// sistema/navegador (como os apps nativos).
(function () {
  // --- localStorage à prova de navegador que BLOQUEIA armazenamento -------
  // No Safari com "Bloquear todos os cookies" (e em vários navegadores
  // embutidos de app), só LER `window.localStorage` já lança SecurityError —
  // não é o setItem que falha, é o acesso à propriedade. Este arquivo e o
  // game.js envolvem os seus acessos em try/catch, mas o shared.js tem ~150 e
  // pelo menos um roda no corpo do módulo: a exceção matava o módulo inteiro,
  // `window.TCGShared` nunca era definido e TODA página do site abria em
  // branco ("Cannot destructure property ... of 'shared'"). É o que acontecia
  // com quem recebia um link e abria nesse tipo de navegador: o site não abria,
  // e não havia como a pessoa saber por quê.
  //
  // Aqui, na primeira linha do primeiro script síncrono de toda página, o
  // acesso é testado UMA vez; se lançar, `localStorage` (e o `sessionStorage`)
  // viram um objeto em memória com a mesma API. O site funciona inteiro — só
  // não lembra de nada entre visitas, que é exatamente o que a pessoa pediu ao
  // bloquear o armazenamento.
  function memoria() {
    var dados = Object.create(null);
    var api = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(dados, String(k)) ? dados[String(k)] : null; },
      setItem: function (k, v) { dados[String(k)] = String(v); },
      removeItem: function (k) { delete dados[String(k)]; },
      clear: function () { dados = Object.create(null); },
      key: function (i) { return Object.keys(dados)[i] || null; }
    };
    Object.defineProperty(api, "length", { get: function () { return Object.keys(dados).length; } });
    return api;
  }
  ["localStorage", "sessionStorage"].forEach(function (nome) {
    try {
      window[nome].getItem("__sleevu");
      return; // funciona: nada a fazer
    } catch (e) { /* bloqueado: cai no substituto */ }
    try {
      Object.defineProperty(window, nome, { configurable: true, value: memoria(), writable: false });
    } catch (e) { /* nem redefinir dá: o try/catch de cada leitura segura o resto */ }
  });

  // --- Erros de JS: a fila nasce AQUI (2026-10-03) ------------------------
  // Antes os ouvintes viviam no shared.js, e tudo que quebrava antes dele (o
  // próprio boot, o i18n) — justamente o que deixa a tela em branco — nunca
  // chegava ao /admin. Aqui só se enfileira; o shared.js liga a fila ao envio
  // (window.__sleevuErroNovo) e o src/erros.js monta o contexto. Ver
  // docs/PLANO-TECNICO.md (D1/D2).
  //  - Recurso: só <script>/<link> do próprio site. Imagem de carta falha o
  //    tempo todo e tem cadeia de reserva própria.
  //  - CSP: script inline barrado é o da detecção de robô do Cloudflare, que
  //    a política recusa de propósito (functions/_vitrine-csp.js) — fica fora.
  try {
    var fila = window.__sleevuErros = [];
    var poe = window.__sleevuErroPoe = function (x) {
      if (fila.length >= 20) return;
      fila.push(x);
      if (typeof window.__sleevuErroNovo === "function") window.__sleevuErroNovo();
    };
    window.addEventListener("error", function (e) {
      var alvo = e.target;
      if (alvo && alvo !== window && alvo.tagName) {
        var u = String(alvo.src || alvo.href || "");
        if ((alvo.tagName === "SCRIPT" || alvo.tagName === "LINK") && u.indexOf(location.origin + "/") === 0) {
          poe({ k: "recurso", m: alvo.tagName.toLowerCase() + " não carregou", s: u });
        }
        return;
      }
      poe({ k: "js", m: e.message, s: e.filename ? e.filename + ":" + e.lineno + ":" + e.colno : "", p: e.error && e.error.stack });
    }, true);
    window.addEventListener("unhandledrejection", function (e) {
      var r = e && e.reason;
      poe({ k: "promise", m: r && r.message ? r.message : String(r), p: r && r.stack });
    });
    document.addEventListener("securitypolicyviolation", function (e) {
      if (e.blockedURI === "inline" || e.blockedURI === "eval") return;
      poe({ k: "csp", m: e.effectiveDirective + " " + String(e.blockedURI).replace(/^(https?:\/\/[^/]+).*$/, "$1"), s: e.sourceFile || "" });
    });
  } catch (e) { /* sem ouvinte: o site segue igual, só sem rastreio */ }

  // --- Link colado com "&amp;" (query escapada como HTML) -----------------
  // Alguns apps de mensagem e clientes de e-mail escapam a URL antes de
  // entregar, e o link chega com "&amp;" no lugar de "&":
  //   /detail?type=set&amp;name=30th+Celebration&amp;setId=cel30
  // O navegador lê UM parâmetro (type) e os outros viram "amp;name",
  // "amp;setId": a página abre vazia, como se o set não existisse. Desfazer
  // isso aqui — antes de qualquer script ler parâmetro — faz o link do amigo
  // abrir igual ao original, e ainda limpa a barra de endereço
  // (replaceState: sem entrada nova no histórico).
  try {
    if (location.search.indexOf("&amp;") >= 0) {
      var q = location.search;
      for (var i = 0; i < 3 && q.indexOf("&amp;") >= 0; i++) q = q.replace(/&amp;/g, "&");
      history.replaceState(history.state, "", location.pathname + q + location.hash);
    }
  } catch (e) { /* history bloqueado: segue com a URL como veio */ }

  // --- Navegador embutido de app (Instagram, Facebook, TikTok…) -----------
  // O anúncio abre DENTRO do app, e lá o Google recusa o login (403
  // disallowed_useragent): quem tocava em "Continuar com Google" caía numa
  // página de erro do Google e não voltava — e nada disso chegava ao /admin
  // (2026-10-03, docs/PLANO-TECNICO.md S5). Carimbado aqui, síncrono, pra o
  // /login já nascer sem o botão do Google (nada pisca nem pula) e o pageview
  // levar o app junto. Mesma lista do familia() do src/erros.js; "; wv)" é a
  // WebView do Android, que o Google também recusa.
  try {
    var ua = navigator.userAgent || "";
    var iab = /Instagram/.test(ua) ? "instagram"
      : /FBAN|FBAV|FB_IAB|FBIOS/.test(ua) ? "facebook"
        : /musical_ly|BytedanceWebview|TikTok/i.test(ua) ? "tiktok"
          : /\bLine\//.test(ua) ? "line"
            : /Snapchat/.test(ua) ? "snapchat"
              : /Pinterest/.test(ua) ? "pinterest"
                : /LinkedInApp/.test(ua) ? "linkedin"
                  : /; wv\)/.test(ua) ? "webview" : "";
    if (iab) document.documentElement.setAttribute("data-iab", iab);
  } catch (e) { /* sem user-agent: segue como navegador comum */ }

  // --- "Tentar de novo" da saída de emergência (.falha-boot) --------------
  // É um href="" (recarregar a própria tela). Nas telas com <base href="/">
  // (a de Sets e a do set, que respondem em /games/…) ele resolveria na raiz e
  // levaria pro início; data-recarrega pede a URL de verdade. Aqui, e não no
  // app, porque a saída existe justamente pra quando o app não subiu.
  try {
    document.addEventListener("DOMContentLoaded", function () {
      var retry = document.querySelector(".falha-boot [data-recarrega]");
      if (retry) retry.href = location.href;
    });
  } catch (e) { /* sem DOM de verdade: sem saída de emergência pra acertar */ }

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

  // --- Modo Colecionador: esconde valores/preços no site todo -------------
  // Carimbado AQUI (síncrono) pra CSS já nascer escondendo — se ficasse só no
  // shared.js (defer), os preços piscariam na tela antes de sumir a cada
  // navegação. O toggle (olhinho no header) vive no shared.js.
  try {
    if (localStorage.getItem("tcg-collector-pref-collector-mode") === "on") {
      document.documentElement.setAttribute("data-collector-mode", "on");
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
  //
  // Duas exceções (2026-09-30), pelo mesmo motivo: o buscador indexa o DOM
  // DEPOIS do JS, e o Google estava guardando o site em inglês.
  //  - Página de idioma FIXO (data-idioma-fixo: as pré-renderizadas de set,
  //    carta e artista). O texto já nasce no HTML, em pt-BR ou em inglês, e
  //    nada o traduz depois. Trocar o lang aqui só fazia o documento mentir: a
  //    página em português anunciava "en" pro Googlebot e pro leitor de tela
  //    de quem usa o navegador em inglês.
  //  - Robô. Ele não tem idioma: o navigator.languages do Googlebot é o
  //    padrão do servidor (en-US). Por isso a home, o hub e o FAQ entravam no
  //    índice traduzidos, com o título "Sleevu - For Collectors!", e sumiam da
  //    busca em português, que é o público do site. O robô vê o idioma que o
  //    HTML declara, o mesmo do canonical. Gente segue com a detecção.
  try {
    var LANGS = { pt: "pt-BR", en: "en", es: "es" };
    var raiz = document.documentElement;
    var doHtml = String(raiz.getAttribute("lang") || "").slice(0, 2).toLowerCase();
    if (!LANGS[doHtml]) doHtml = "pt";
    if (raiz.hasAttribute("data-idioma-fixo")) {
      window.SLEEVU_LANG = doHtml;
    } else {
      var savedLang = localStorage.getItem("tcg-collector-ui-lang-v1");
      var lang = LANGS[savedLang] ? savedLang : (pareceRobo() ? doHtml : detectLang());
      window.SLEEVU_LANG = lang;
      raiz.setAttribute("lang", LANGS[lang]);
    }
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
    // Páginas com vitrine rodam com CSP de nonce + 'strict-dynamic'
    // (functions/_vitrine-csp.js). Nesse modo, script escrito por
    // document.write conta como "do parser" e só roda com o nonce — sem isto o
    // idioma não carregava e a página inteira mostrava as chaves cruas. O
    // nonce vem do próprio script que está rodando (a borda carimba todos).
    var eu = document.currentScript;
    var nonce = (eu && (eu.nonce || eu.getAttribute("nonce"))) || "";
    if (!/^[A-Za-z0-9+\/=]+$/.test(nonce)) nonce = "";
    if (I18N && pacotes) {
      var uiLang = window.SLEEVU_LANG || "pt";
      pacotes.split(",").forEach(function (base) {
        var arq = I18N[base] && (I18N[base][uiLang] || I18N[base].pt);
        if (arq) document.write('<script defer src="' + arq + '"' + (nonce ? ' nonce="' + nonce + '"' : "") + '><\/script>');
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

  // Mesma régua do events_guard (migração 20260914a): "bot" como PALAVRA
  // (Googlebot/, bingbot/, Applebot/, YandexBot/) e não como pedaço de marca de
  // celular (CUBOT_X18). Mais os robôs do Google que não se chamam "bot": o da
  // inspeção de URL do Search Console (é ele que mostra ao Fernando o que o
  // Google viu), o do AdSense e o do Lighthouse/PageSpeed.
  function pareceRobo() {
    return /bot(\/|;|\)|\s|$)|crawl|spider|slurp|headless|lighthouse|google-inspectiontool|googleother|mediapartners-google|adsbot-google/i
      .test(String(navigator.userAgent || ""));
  }
})();
