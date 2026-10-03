// Erros de JS — o ENVIO (jserror v2, 2026-10-03; docs/PLANO-TECNICO.md, D1).
//
// Como o caminho se divide:
//   theme.js  — 1º script síncrono de toda página: registra os ouvintes e
//               enfileira em window.__sleevuErros. Assim entra também o que
//               quebra ANTES do shared.js (o próprio boot, o i18n).
//   shared.js — liga a fila ao envio: no primeiro erro, injeta ESTE arquivo
//               e chama despeja() com o que só ele sabe (URL, cabeçalhos,
//               anon, jogo, página, logado, app instalado).
//   erros.js  — monta o contexto, filtra o ruído e manda.
//
// Sob demanda porque página sem erro é quase toda página: o shared.js estava
// colado no teto do orçamento de peso, e a montagem do contexto (família do
// navegador, app embutido, quadros da pilha) é bloco frio.
//
// O que vai em props, além do m/s de sempre (que o error_summary antigo lê):
//   k   tipo: js | promise | recurso | csp | terceiro | armazenamento
//   f   até 3 quadros da pilha SEM o hash do arquivo — o mesmo bug numa linha
//       só entre levas (com o hash, o painel abria uma linha por deploy)
//   v   build da página (<meta name="sleevu-build">): "corrigido?" por leva
//   d   m = toque (celular/tablet), d = ponteiro — a mesma régua do pageview
//   b   família + versão maior do navegador; o   sistema
//   iab app que embutiu o navegador (instagram, facebook, tiktok…) — é onde o
//       anúncio pago abre, e onde o login do Google é recusado
//   lg  logado; pwa  app instalado; vw  largura da janela (de 10 em 10)
// Sem user-agent cru, sem query, sem IP: o mesmo grão agregável do pageview.
(function () {
  "use strict";

  const EXTENSAO = /(^|\()(chrome|moz|safari|safari-web|ms-browser)-extension:|webkit-masked-url:/i;
  const RUIDO = /ResizeObserver loop/i;
  const TETO_SESSAO = 15;
  const CHAVE_SESSAO = "sleevu-jserror-n";
  const vistos = new Set();

  // Família do navegador, sistema e app embutido, a partir do user-agent.
  // Ordem importa: Samsung, Edge e Opera também dizem "Chrome"; o Chrome e o
  // Firefox do iPhone dizem "Safari" e carregam o motor do Safari.
  function familia(ua, toqueNoMac) {
    const u = String(ua || "");
    const ver = (re) => { const m = re.exec(u); return m ? Number(m[1]) : 0; };
    const iab = /Instagram/.test(u) ? "instagram"
      : /FBAN|FBAV|FB_IAB|FBIOS/.test(u) ? "facebook"
        : /musical_ly|BytedanceWebview|TikTok/i.test(u) ? "tiktok"
          : /\bLine\//.test(u) ? "line"
            : /Snapchat/.test(u) ? "snapchat"
              : /Pinterest/.test(u) ? "pinterest"
                : /LinkedInApp/.test(u) ? "linkedin"
                  : /; wv\)/.test(u) ? "webview" : "";
    const o = /iPhone|iPad|iPod/.test(u) || (/Macintosh/.test(u) && toqueNoMac) ? "ios"
      : /Android/.test(u) ? "android"
        : /Windows/.test(u) ? "windows"
          : /CrOS/.test(u) ? "chromeos"
            : /Mac OS X/.test(u) ? "mac"
              : /Linux/.test(u) ? "linux" : "outro";
    let b;
    if (/SamsungBrowser\//.test(u)) b = `samsung ${ver(/SamsungBrowser\/(\d+)/)}`;
    else if (/Edg(A|iOS)?\//.test(u)) b = `edge ${ver(/Edg(?:A|iOS)?\/(\d+)/)}`;
    else if (/OPR\/|Opera/.test(u)) b = `opera ${ver(/OPR\/(\d+)/)}`;
    else if (/Firefox\/|FxiOS\//.test(u)) b = `firefox ${ver(/(?:Firefox|FxiOS)\/(\d+)/)}`;
    else if (/CriOS\//.test(u)) b = `chrome ${ver(/CriOS\/(\d+)/)}`;
    else if (/Chrome\//.test(u)) b = `chrome ${ver(/Chrome\/(\d+)/)}`;
    else if (/Version\/\d+.*Safari/.test(u)) b = `safari ${ver(/Version\/(\d+)/)}`;
    else if (o === "ios") b = `webkit ${ver(/OS (\d+)_/)}`; // app embutido no iOS: vale a versão do sistema
    else b = "outro";
    return iab ? { b, o, iab } : { b, o };
  }

  // Quadros da pilha (Chrome: "at fn (url:l:c)"; Safari/Firefox: "fn@url:l:c")
  // como "src/shared.js:93:2765": sem origem quando é do site, sem o hash da
  // leva. O primeiro quadro CRU (com hash) também volta, pro decodificador.
  function quadros(pilha, origem) {
    const crus = [];
    const re = /(https?:\/\/[^\s()@]+?):(\d+):(\d+)/g;
    let m;
    while ((m = re.exec(String(pilha || ""))) && crus.length < 3) crus.push(`${m[1]}:${m[2]}:${m[3]}`);
    const limpo = (q) => {
      let x = q;
      if (origem && x.indexOf(origem + "/") === 0) x = x.slice(origem.length + 1);
      return x.replace(/\.[0-9a-f]{8}\.(js|css)(?=:)/, ".$1").slice(0, 120);
    };
    return { cru: crus[0] || "", f: crus.map(limpo) };
  }

  // Um item da fila → props do evento, ou null quando é ruído.
  function monta(item, ctx) {
    const it = item || {};
    const m = String(it.m == null ? "" : it.m).slice(0, 300);
    const fonte = String(it.s || "");
    if (!m || RUIDO.test(m)) return null;
    if (EXTENSAO.test(fonte) || EXTENSAO.test(String(it.p || ""))) return null;
    const pilha = quadros(it.p || fonte, ctx.origem);
    let k = it.k || "js";
    // Script de outro domínio: o navegador esconde o detalhe ("Script error.",
    // sem arquivo) ou a pilha é toda de fora (AdSense, Turnstile, beacon).
    const deFora = (q) => q && /^https?:\/\//.test(q) && (!ctx.origem || q.indexOf(ctx.origem + "/") !== 0);
    if ((k === "js" || k === "promise") && (/^Script error\.?$/i.test(m) || (pilha.f.length && pilha.f.every(deFora)))) k = "terceiro";
    const props = { m, s: (pilha.cru || fonte || (k === "promise" ? "promise" : "")).slice(0, 200), k };
    if (pilha.f.length) props.f = pilha.f;
    Object.assign(props, ctx.aparelho);
    if (ctx.v) props.v = ctx.v;
    if (ctx.lg) props.lg = 1;
    if (ctx.pwa) props.pwa = 1;
    if (ctx.vw) props.vw = ctx.vw;
    return props;
  }

  function contexto() {
    let d = "d";
    try { d = window.matchMedia && matchMedia("(pointer: coarse)").matches ? "m" : "d"; } catch (e) { /* sem matchMedia */ }
    const toqueNoMac = !!(navigator.maxTouchPoints > 1); // iPad se declara Mac
    const meta = document.querySelector('meta[name="sleevu-build"]');
    return {
      origem: location.origin,
      aparelho: Object.assign({ d }, familia(navigator.userAgent, toqueNoMac)),
      v: (meta && meta.getAttribute("content")) || "",
      vw: Math.round((window.innerWidth || 0) / 10) * 10
    };
  }

  // Esvazia a fila mandando cada erro novo. `envio` vem do shared.js:
  // { url, headers, anon, game, path, lg, pwa }.
  function despeja(envio) {
    const fila = window.__sleevuErros;
    if (!fila || !fila.length || !envio) return;
    const ctx = Object.assign(contexto(), { lg: envio.lg, pwa: envio.pwa });
    let n = 0;
    try { n = Number(sessionStorage.getItem(CHAVE_SESSAO)) || 0; } catch (e) { /* sem storage: só o teto da página */ }
    while (fila.length) {
      const props = monta(fila.shift(), ctx);
      if (!props) continue;
      const chave = `${props.k}|${props.m}`;
      if (vistos.has(chave) || vistos.size >= 8 || n >= TETO_SESSAO) continue;
      vistos.add(chave);
      n += 1;
      // .catch: falha de rede no envio do erro não pode virar outro erro.
      fetch(envio.url, {
        method: "POST",
        headers: envio.headers,
        body: JSON.stringify({ name: "jserror", path: envio.path, anon: envio.anon, game: envio.game, props }),
        keepalive: true
      }).catch(() => {});
    }
    try { sessionStorage.setItem(CHAVE_SESSAO, String(n)); } catch (e) { /* idem */ }
  }

  window.TCGErros = { familia, quadros, monta, despeja };
})();
