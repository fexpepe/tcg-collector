// Ponte do app (Capacitor) — o PRIMEIRO script de toda página do pacote web.
//
// O scripts/app-web.mjs copia este arquivo pra www/src/app-nativo.js,
// preenche ORIGEM e PAGINAS e põe a tag logo depois do <head> de cada página
// (com data-pagina = o nome do arquivo). No site ele não existe.
//
// O app roda o MESMO código do site, servido de dentro do aparelho
// (capacitor://localhost no iOS, https://localhost no Android). O que no site
// a borda da Cloudflare faz, aqui é feito à mão:
//
//   1. Avisa o Capgo que o pacote subiu (notifyAppReady). Tem que ser antes de
//      qualquer rede: sem o aviso em 10 s o Capgo desfaz o live update e volta
//      pra versão anterior.
//   2. Endereço bonito (/sets, /games/…, /users/…). O Capacitor serve o
//      index.html pra todo caminho cujo último pedaço não tem ponto, e não
//      deixa trocar isso (o RouteProcessor do Android nem recebe o caminho).
//      Então o index.html, quando abre fora da raiz, descobre a página certa e
//      vai pra ela (location.replace, levando o endereço em ?__rota=); a
//      página nova põe o endereço bonito de volta na barra
//      (history.replaceState) ANTES do game.js ler o location.pathname — e o
//      resto do site segue achando que está no sleevu.app.
//   3. Pedido ao servidor (catálogo em /data, APIs da borda em /api) sai pra
//      ORIGEM: no aparelho não existe servidor. fetch, XHR e sendBeacon.
//   4. Sem service worker e sem Web Push: quem atualiza o código é o Capgo, e
//      um SW servindo o shell velho do cache brigaria com ele. Push no app,
//      quando vier, é nativo.
//
// window.SLEEVU_APP diz ao site que ele está no app (o game.js lê a origem
// pública dali pros links de compartilhar; o shared.js, se é produção).
(function () {
  "use strict";
  var ORIGEM = "https://sleevu.app"; /* SLEEVU_APP_ORIGEM */
  var PAGINAS = []; /* SLEEVU_APP_PAGINAS */
  // O que só existe no servidor: o catálogo, as APIs da borda e o calendário
  // de lançamentos (gerado no deploy).
  var SERVIDOR = /^\/(?:data\/|api\/|lancamentos\.ics$)/;

  var cap = window.Capacitor;
  var nativo = !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
  var plataforma = nativo && typeof cap.getPlatform === "function" ? cap.getPlatform() : "web";
  var eu = document.currentScript;
  var pagina = (eu && eu.getAttribute("data-pagina")) || "";

  // ── 1. Capgo ───────────────────────────────────────────────────────────────
  // nativePromise é o canal do próprio Capacitor (é o que o registerPlugin do
  // @capacitor/core usa por baixo); o site não tem bundler pra importar o
  // plugin. Falha aqui não pode derrubar a página.
  if (nativo && typeof cap.nativePromise === "function") {
    try { cap.nativePromise("CapacitorUpdater", "notifyAppReady", {}).catch(function () {}); } catch (e) { /* segue */ }
  }

  // ── 2. Endereço bonito ─────────────────────────────────────────────────────
  var temPagina = function (nome) { return PAGINAS.indexOf(nome) !== -1; };
  // Caminho -> a página que a borda serviria, ou null (raiz, ou endereço que
  // não existe no app). Espelha o _redirects e as Functions (functions/games,
  // functions/users, functions/blog). `arquivo` é a página do pacote, `busca`
  // o que ela recebe na query, e `bonito` o endereço que fica na barra quando
  // a borda REDIRECIONA (301) em vez de reescrever (200) — nos rewrites fica o
  // endereço que a pessoa abriu.
  function destino(caminho) {
    var p = String(caminho || "/").replace(/\/+$/, "") || "/";
    if (p === "/" || p === "/index" || p === "/index.html") return null;
    var s = p.split("/").slice(1);
    // /users/<handle>[/…]: a coleção pública (o collection.js lê o handle do caminho).
    if (s[0] === "users" && s.length > 1) return { arquivo: "collection" };
    if (s[0] === "games") {
      // /games é o índice de jogos estático do deploy; no app, o HUB faz esse papel.
      if (s.length === 1) return { arquivo: "hub", bonito: "/hub" };
      // /games/<jogo>: a tela de Sets do jogo.
      if (s.length === 2) return { arquivo: "sets" };
      // /games/<jogo>/<set>[/<carta>]: a tela do set (e o popup da carta). O
      // /games/<jogo>/_id/<id> do "compartilhar" é um 301 que só a borda sabe
      // resolver (o nome da carta no endereço sai do índice do servidor).
      if ((s.length === 3 || s.length === 4) && s[2] !== "_id") return { arquivo: "detail" };
      return null;
    }
    if (s[0] === "blog") return { arquivo: s.length > 1 ? "blog-post" : "blog" };
    // 301s do _redirects.
    if (p === "/graded") return { arquivo: "collection", busca: "tab=graded", bonito: "/collection" };
    if (p === "/ferramentas") return { arquivo: "tools", bonito: "/tools" };
    if (p === "/condicao") return { arquivo: "condition", bonito: "/condition" };
    // URL limpa da Cloudflare: /sets serve o sets.html.
    if (s.length === 1 && temPagina(s[0])) return { arquivo: s[0] };
    return null;
  }

  var url = new URL(location.href);
  var d = pagina === "index" ? destino(url.pathname) : null;
  if (d) {
    var q = new URLSearchParams(url.search);
    if (d.busca) new URLSearchParams(d.busca).forEach(function (v, k) { if (!q.has(k)) q.set(k, v); });
    var resto = q.toString();
    // O que volta pra barra: o endereço aberto (rewrite) ou o novo (301), com
    // a query que a página de fato recebeu.
    q.set("__rota", (d.bonito ? d.bonito + (resto ? "?" + resto : "") : url.pathname + url.search) + url.hash);
    location.replace("/" + d.arquivo + ".html?" + q.toString());
    // O resto do index.html não pode rodar: a navegação acima só vale quando o
    // documento novo chegar, e até lá o theme.js/shared.js da landing
    // executariam à toa (o theme.js ainda manda quem tem sessão pro
    // /dashboard, o que brigaria com o replace). <plaintext> faz o parser
    // engolir o resto do arquivo como texto: nada mais executa nem baixa.
    document.write('<plaintext style="display:none">');
    return;
  }
  if (pagina === "index" && url.pathname !== "/" && !/^\/index(\.html)?$/.test(url.pathname)) {
    // Endereço que o app não conhece (link velho, página só do servidor): a
    // página de erro do próprio site, que tem saída pra Início.
    if (temPagina("404")) {
      location.replace("/404.html");
      document.write('<plaintext style="display:none">');
      return;
    }
  }
  if (url.searchParams.has("__rota")) {
    var rota = url.searchParams.get("__rota") || "";
    // Só caminho do próprio app (começa com uma barra só): nada de //host.
    if (/^\/(?!\/)/.test(rota)) {
      try { history.replaceState(history.state, "", rota); } catch (e) { /* segue com o .html na barra */ }
    }
  }

  // ── 3. Pedido ao servidor -> ORIGEM ───────────────────────────────────────
  // Só o que é do mesmo endereço do app E cai num caminho do servidor; o resto
  // (Supabase, imagens de outros hosts, arquivos do próprio pacote) passa reto.
  // Resolve como o próprio navegador resolveria: contra a base do documento
  // (o <base href="/"> das telas que moram em caminho fundo — set, carta,
  // perfil, post), não contra o endereço da barra — que, depois do
  // replaceState, é /games/<jogo>/<set>/… e faria "data/x.json" virar
  // /games/<jogo>/data/x.json aqui e /data/x.json no fetch.
  function paraOrigem(alvo) {
    try {
      var u = new URL(String(alvo), document.baseURI);
      if (u.origin !== location.origin || !SERVIDOR.test(u.pathname)) return null;
      return ORIGEM + u.pathname + u.search + u.hash;
    } catch (e) { return null; }
  }
  var fetchOriginal = window.fetch;
  if (typeof fetchOriginal === "function") {
    window.fetch = function (entrada, opcoes) {
      if (typeof entrada === "string" || entrada instanceof URL) {
        var novo = paraOrigem(entrada);
        if (novo) return fetchOriginal.call(this, novo, opcoes);
      } else if (entrada && typeof entrada.url === "string") {
        var novoReq = paraOrigem(entrada.url);
        if (novoReq) return fetchOriginal.call(this, new Request(novoReq, entrada), opcoes);
      }
      return fetchOriginal.apply(this, arguments);
    };
  }
  var abrirOriginal = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (metodo, alvo) {
    var novo = paraOrigem(alvo);
    if (novo) {
      var args = Array.prototype.slice.call(arguments);
      args[1] = novo;
      return abrirOriginal.apply(this, args);
    }
    return abrirOriginal.apply(this, arguments);
  };
  if (navigator.sendBeacon) {
    var beaconOriginal = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (alvo, dados) { return beaconOriginal(paraOrigem(alvo) || alvo, dados); };
  }

  // Imagem (e script/link) com endereço relativo do servidor: o logo do set e
  // as imagens vintage moram em data/ e chegam DENTRO do catálogo como
  // "data/set-logos/…", que o site joga em innerHTML ou em img.src. Sem isto
  // o aparelho pede o arquivo a si mesmo e dá 404. Os pontos por onde um
  // endereço vira pedido são poucos: os setters de src/srcset/href, o
  // setAttribute e o HTML montado em string (innerHTML, outerHTML,
  // insertAdjacentHTML). O teste barato (indexOf) vem antes de qualquer regex:
  // a grade monta centenas de tiles por segundo.
  var ATRIBUTO_URL = /^(?:src|srcset|href|poster)$/i;
  function trocaSrcset(v) {
    return String(v).split(",").map(function (c) {
      var m = /^(\s*)(\S+)(.*)$/.exec(c);
      if (!m) return c;
      return m[1] + (paraOrigem(m[2]) || m[2]) + m[3];
    }).join(",");
  }
  function trocaAtributo(nome, v) {
    if (v == null) return v;
    var s = String(v);
    if (s.indexOf("data/") === -1 && s.indexOf("api/") === -1) return v;
    return /^srcset$/i.test(nome) ? trocaSrcset(s) : (paraOrigem(s) || v);
  }
  var EM_HTML = /(\s(?:src|srcset|href|poster)\s*=\s*)(["'])([^"']*)\2/gi;
  function trocaHtml(html) {
    if (typeof html !== "string" || (html.indexOf("data/") === -1 && html.indexOf("api/") === -1)) return html;
    return html.replace(EM_HTML, function (todo, ini, aspa, valor) {
      var novo = trocaAtributo(/srcset/i.test(ini) ? "srcset" : "src", valor);
      return novo === valor ? todo : ini + aspa + novo + aspa;
    });
  }
  function embrulhaSetter(proto, prop, troca) {
    var d = proto && Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.set) return;
    Object.defineProperty(proto, prop, {
      configurable: true, enumerable: d.enumerable, get: d.get,
      set: function (v) { d.set.call(this, troca(v)); }
    });
  }
  var porAtributo = function (nome) { return function (v) { return trocaAtributo(nome, v); }; };
  [[window.HTMLImageElement, ["src", "srcset"]], [window.HTMLSourceElement, ["src", "srcset"]],
    [window.HTMLScriptElement, ["src"]], [window.HTMLLinkElement, ["href"]], [window.HTMLVideoElement, ["poster"]]
  ].forEach(function (par) {
    if (!par[0]) return;
    par[1].forEach(function (prop) { embrulhaSetter(par[0].prototype, prop, porAtributo(prop)); });
  });
  embrulhaSetter(Element.prototype, "innerHTML", trocaHtml);
  embrulhaSetter(Element.prototype, "outerHTML", trocaHtml);
  var adjacenteOriginal = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function (onde, html) { return adjacenteOriginal.call(this, onde, trocaHtml(html)); };
  var setAttributeOriginal = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (nome, valor) {
    return setAttributeOriginal.call(this, nome, ATRIBUTO_URL.test(nome) ? trocaAtributo(nome, valor) : valor);
  };

  // ── 4. Sem service worker e sem Web Push ──────────────────────────────────
  // O site guarda pelo OBJETO (`if (navigator.serviceWorker)`) e o Web Push
  // por `"PushManager" in window`: sumir com os dois desliga os dois caminhos.
  try { Object.defineProperty(navigator, "serviceWorker", { value: undefined, configurable: true }); } catch (e) { /* segue */ }
  try { delete window.PushManager; } catch (e) { /* segue */ }
  // E sem o convite de "instalar o app" (no iOS ele aparece pra todo mundo,
  // com o passo a passo do Safari): já é o app. O site pergunta por
  // navigator.standalone (o mesmo sinal do PWA aberto da tela de início), e o
  // pageview passa a contar a visita como de app instalado.
  if (nativo) {
    try { Object.defineProperty(navigator, "standalone", { value: true, configurable: true }); } catch (e) { /* segue */ }
  }

  window.SLEEVU_APP = {
    nativo: nativo,
    plataforma: plataforma,
    origem: ORIGEM,
    // Testes (tests/app-web.test.mjs) leem a mesma régua que o app usa.
    _destino: destino,
    _paraOrigem: paraOrigem,
    _trocaHtml: trocaHtml
  };
})();
