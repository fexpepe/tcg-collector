// Vitrine — o espaço de anúncio das páginas de catálogo (docs/PLANO-ADS.md).
//
// FASE 0 (2026-09-27): o espaço existe, é medido e mostra só conteúdo do
// próprio Sleevu ("casa": apoie, crie sua conta, anuncie) e, quando
// houver, de lojas parceiras (venda direta). Nenhum script de terceiro. A
// fase 1 pluga o AdSense como mais um fornecedor desta mesma cadeia — as
// páginas não mudam.
//
// Quem pode ter vitrine é decidido NO HTML: só as páginas de catálogo carregam
// este arquivo (<script defer src="src/ads.js" data-grade="#seletor">), e o
// check.mjs barra o script nas páginas pessoais (coleção, portfólio, binders…)
// — decisão de 2026-09-27: onde a pessoa trabalha não tem anúncio. Popup e
// modal nunca recebem espaço: a faixa só entra DENTRO da grade da página.
//
// O que liga, desliga e escolhe mora em /data/ads.json (ver configValida):
// `"ativo": false` apaga tudo no próximo carregamento (é o kill switch).
// JSON quebrado, fetch que falha ou este arquivo bloqueado por adblock = a
// página fica exatamente como era; nada aqui é dependência de ninguém.
//
// Três regras de UX que moldam o código (docs/PLANO-ADS.md, seção 4):
//   - nada salta: a faixa entra no MESMO quadro em que a grade é desenhada
//     (o MutationObserver roda antes da pintura) e sempre abaixo da 1ª tela;
//   - pouco e espaçado: começo de linha, 1ª só depois de N telas, intervalo
//     de M telas, teto por página (regras no JSON, por aparelho);
//   - a casa tem teto por dia: o "apoie" na 30ª página do dia vira ruído, então
//     cada criativo da casa some depois de `porDia` vezes VISTO.
//
// FASE 1 (2026-09-28): o AdSense entra como fornecedor da mesma cadeia
// ("parceiro" → "adsense" → "casa"), DORMENTE até o data/ads.json ter o
// ca-pub e os IDs dos blocos. Mesmo com os IDs, ele só chama a rede quando
// TUDO isto vale (adsenseLiberado): a pessoa ACEITOU anúncio personalizado
// (recusou = nem o script do Google carrega — decisão de 27/09), a página veio
// com a CSP de nonce da borda (functions/_vitrine-csp.js, que também carimba
// <html data-pais>), o país não é da UE/Reino Unido/Suíça (lá o Google exige
// CMP certificado, que não temos) e a economia de dados está desligada. Bloco
// é MANUAL e de tamanho fixo (728×90, 300×250, 160×600): nada de Auto ads,
// vinheta ou âncora, e a altura reservada é a do anúncio (nada salta).
// Anúncio já pedido NUNCA é recarregado sozinho — ver viraCasa.
//
// Medição (migração 20260927a): UM `ad_view` por página, com o que foi servido
// e o que foi visto (metade na tela por 1 s), mandado quando a aba some — um
// evento por espaço estouraria os 60/min do events_guard em quem navega rápido.
// Clique é `ad_click`. Os dois passam pelo mesmo consentimento de estatística
// do resto do analytics (logEvento).
(function () {
  "use strict";

  // ── Regras puras (tests/vitrine.test.mjs) ─────────────────────────────────

  // Onde entram as faixas numa grade. `tops`: o topo de cada item visível, em
  // px, JÁ SEM a altura das faixas postas antes dele — assim a resposta não
  // depende de onde as faixas estão agora (sem o desconto, mover a 1ª mudava a
  // conta da 2ª e a posição oscilava a cada re-render). Só começo de LINHA
  // serve: faixa no meio de uma linha quebraria a grade. A 1ª não entra antes
  // de `primeira` telas do topo da grade e cada seguinte guarda `intervalo`
  // telas da anterior. Devolve os índices dos itens que cada faixa precede.
  // Medir em telas (e não em linhas) é o que faz a mesma regra valer na grade
  // de 5 colunas, na de 2 e na lista de uma carta por linha.
  // `permitido[i] === false` veta a posição — é o item logo depois de um
  // cabeçalho (mês nos Lançamentos, série em Sets): faixa ali separaria o
  // título do que ele titula.
  function posicoesNaGrade(tops, alturaTela, regra, permitido) {
    const out = [];
    if (!(alturaTela > 0) || !regra || !(regra.max > 0) || !tops || tops.length < 2) return out;
    let alvo = tops[0] + regra.primeira * alturaTela;
    for (let i = 1; i < tops.length && out.length < regra.max; i++) {
      if (!(tops[i] > tops[i - 1] + 1)) continue; // mesma linha
      if (tops[i] < alvo) continue;
      if (permitido && permitido[i] === false) continue;
      out.push(i);
      alvo = tops[i] + regra.intervalo * alturaTela;
    }
    return out;
  }

  // Normaliza o /data/ads.json. Tudo o que foge do formato é DESCARTADO (ou
  // vira o padrão): config errada nunca quebra a página, e o pior caso de um
  // JSON torto é o espaço não aparecer. null = vitrine desligada.
  const ID_OK = /^[a-z0-9-]{1,24}$/;           // o mesmo padrão que a RPC admin_vitrine aceita
  const DATA_OK = /^\d{4}-\d{2}-\d{2}$/;
  // Sem "instale o app": o convite de instalação já existe (shared.js,
  // initInstallInvite) e aparece UMA vez, só pra quem tem 10+ cartas — de
  // propósito. Repetir o pedido na vitrine desfaria essa decisão.
  const CASA = ["apoie", "conta", "anuncie"];
  const FORNECEDORES = ["parceiro", "casa", "adsense"];
  // AdSense: ca-pub de 16 dígitos e data-ad-slot numérico (10 dígitos hoje).
  const CLIENTE_OK = /^ca-pub-\d{16}$/;
  const BLOCO_OK = /^\d{8,12}$/;
  const FORMATOS = ["faixa", "quadrado", "trilho"];
  function adsenseValido(a) {
    if (!a || typeof a !== "object" || !CLIENTE_OK.test(String(a.cliente || ""))) return null;
    const b = a.blocos && typeof a.blocos === "object" ? a.blocos : {};
    const blocos = {};
    FORMATOS.forEach((f) => { if (BLOCO_OK.test(String(b[f] || ""))) blocos[f] = String(b[f]); });
    return Object.keys(blocos).length ? { cliente: a.cliente, blocos } : null;
  }
  // Imagem de parceiro mora no próprio site: é o que mantém o img-src 'self'
  // da CSP e o "sem rastreio" (pixel de terceiro não entra por aqui).
  const IMG_OK = /^\/assets\/partners\/[\w.-]+\.(webp|png|jpe?g|avif)$/;
  function numero(v, min, max, padrao) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
  }
  function regraValida(r, padrao) {
    const o = r && typeof r === "object" ? r : {};
    return {
      primeira: numero(o.primeira, 1, 20, padrao.primeira),
      intervalo: numero(o.intervalo, 2, 40, padrao.intervalo),
      max: Math.round(numero(o.max, 0, 3, padrao.max))
    };
  }
  function lista(v, re) {
    return Array.isArray(v) ? v.filter((x) => typeof x === "string" && re.test(x)) : [];
  }
  function parceiroValido(c) {
    const im = c.imagens && typeof c.imagens === "object" ? c.imagens : {};
    if (!/^https:\/\/[^\s"'<>]+$/.test(String(c.href || ""))) return null;
    if (!IMG_OK.test(String(im.faixa || "")) || !IMG_OK.test(String(im.quadrado || ""))) return null;
    return {
      id: c.id, tipo: "parceiro", peso: numero(c.peso, 1, 100, 1),
      href: c.href, alt: String(c.alt || "").slice(0, 140),
      imagens: { faixa: im.faixa, quadrado: im.quadrado, trilho: IMG_OK.test(String(im.trilho || "")) ? im.trilho : "" },
      jogos: lista(c.jogos, /^[a-z]{2,16}$/), idiomas: lista(c.idiomas, /^(pt|en|es)$/),
      desde: DATA_OK.test(String(c.desde || "")) ? c.desde : "", ate: DATA_OK.test(String(c.ate || "")) ? c.ate : ""
    };
  }
  function configValida(cfg) {
    if (!cfg || typeof cfg !== "object" || cfg.ativo !== true) return null;
    const vistos = new Set();
    const criativos = (Array.isArray(cfg.criativos) ? cfg.criativos : []).map((c) => {
      if (!c || typeof c !== "object" || !ID_OK.test(String(c.id || "")) || vistos.has(c.id)) return null;
      vistos.add(c.id);
      if (c.tipo === "casa") return CASA.indexOf(c.id) >= 0 ? { id: c.id, tipo: "casa", peso: numero(c.peso, 1, 100, 1) } : null;
      if (c.tipo === "parceiro") return parceiroValido(c);
      return null;
    }).filter(Boolean);
    const adsense = adsenseValido(cfg.adsense);
    // Sem ca-pub e bloco válidos o AdSense sai da cadeia: é o estado "dormente"
    // (e é o que impede o aviso de consentimento de aparecer à toa).
    const fornecedores = lista(cfg.fornecedores, /^[a-z]+$/)
      .filter((f, i, a) => FORNECEDORES.indexOf(f) >= 0 && a.indexOf(f) === i && (f !== "adsense" || adsense));
    const regras = cfg.regras && typeof cfg.regras === "object" ? cfg.regras : {};
    return {
      fornecedores: fornecedores.length ? fornecedores : ["parceiro", "casa"],
      adsense,
      regras: {
        desktop: regraValida(regras.desktop, { primeira: 1.6, intervalo: 4.4, max: 3 }),
        celular: regraValida(regras.celular, { primeira: 2, intervalo: 4, max: 3 })
      },
      trilho: cfg.trilho !== false,
      porDia: Math.round(numero(cfg.porDia, 1, 50, 4)),
      pix: typeof cfg.pix === "string" && /^[\w.@+-]{8,80}$/.test(cfg.pix) ? cfg.pix : "",
      kofi: /^https:\/\/ko-fi\.com\/[\w-]+$/.test(String(cfg.kofi || "")) ? cfg.kofi : "",
      contato: /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(String(cfg.contato || "")) ? cfg.contato : "",
      criativos
    };
  }

  // Quais criativos a página mostra, um por espaço e sem repetir. A ordem dos
  // tipos segue `fornecedores` (parceiro antes da casa: é quem paga); dentro do
  // mesmo tipo, sorteio pelo peso. `ctx`: jogo, idioma, hoje (AAAA-MM-DD),
  // logado, temKofi, vistosHoje ({id: n}) e porDia. `sorteio` é injetável
  // pro teste ser determinístico.
  function escolheCriativos(criativos, ctx, n, ordem, sorteio) {
    const rnd = sorteio || Math.random;
    const elegivel = (c) => {
      if (c.tipo === "parceiro") {
        if (c.jogos.length && c.jogos.indexOf(ctx.jogo) < 0) return false;
        if (c.idiomas.length && c.idiomas.indexOf(ctx.idioma) < 0) return false;
        if (c.desde && ctx.hoje < c.desde) return false;
        if (c.ate && ctx.hoje > c.ate) return false;
        return true;
      }
      if (c.id === "conta" && ctx.logado) return false;       // já tem conta
      if (c.id === "apoie" && ctx.idioma !== "pt" && !ctx.temKofi) return false; // Pix é só do Brasil
      return (ctx.vistosHoje[c.id] || 0) < ctx.porDia;
    };
    const out = [];
    (ordem || ["parceiro", "casa"]).forEach((tipo) => {
      // A rede não tem estoque finito: liberada, ela ocupa todo espaço que o
      // parceiro deixou — a casa vira reserva (bloco não preenchido, recusa).
      if (tipo === "adsense") {
        while (ctx.adsense && out.length < n) out.push({ id: "adsense", tipo: "adsense" });
        return;
      }
      const resto = criativos.filter((c) => c.tipo === tipo && elegivel(c));
      while (resto.length && out.length < n) {
        const total = resto.reduce((s, c) => s + c.peso, 0);
        let r = rnd() * total;
        let i = 0;
        while (i < resto.length - 1 && r >= resto[i].peso) { r -= resto[i].peso; i++; }
        out.push(resto.splice(i, 1)[0]);
      }
    });
    return out;
  }

  // UE (27) + EEE (Islândia, Liechtenstein, Noruega) + Reino Unido + Suíça:
  // anúncio personalizado lá exige CMP certificado pelo Google (IAB TCF), que o
  // Sleevu não tem. Não chamar a rede é o jeito mais simples de estar certo.
  const PAISES_SEM_REDE = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
    "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "GB", "CH"]);
  // A rede só é chamada com TUDO isto (ver o cabeçalho do arquivo). `pais`
  // vazio = a página não veio pela borda com nonce (dev, ou a Function falhou)
  // — e aí a CSP do _headers bloquearia o script do Google de qualquer jeito.
  function adsenseLiberado({ cfg, consentiu, pais, economia }) {
    return !!(cfg && cfg.adsense && cfg.fornecedores.indexOf("adsense") >= 0
      && consentiu && !economia && /^[A-Z]{2}$/.test(pais || "") && !PAISES_SEM_REDE.has(pais));
  }
  // Qual bloco cabe na faixa: o 728×90 precisa de ~760 px de largura útil;
  // abaixo disso (celular, tablet em pé, janela estreita) vai o 300×250.
  function formatoDaFaixa(largura) { return largura >= 760 ? "faixa" : "quadrado"; }

  // Apoiador sem anúncio (decisão 3 do plano, valor fechado em 2026-09-28:
  // cada apoio de R$ 10+ = 30 dias, somando). A data vem do banco
  // (`apoio_status`, migração 20260928c) e vale até o FIM do dia gravado.
  // "AAAA-MM-DD" compara certo como texto.
  function apoioVigente(ate, dia) {
    return typeof ate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ate) && ate >= dia;
  }
  // O que dá pra decidir só com o que está guardado neste aparelho, sem rede.
  //   apoia    — some com tudo JÁ, sem esperar ninguém
  //   confere  — perguntar ao banco. Com apoia=false, a página ESPERA a
  //              resposta (senão quem acabou de apoiar veria anúncio na
  //              primeira página); com apoia=true, confere em segundo plano
  //              (pro caso de o apoio ter sido encerrado no /admin).
  // "Não apoia" é reconferido a cada hora; "apoia", a cada 6 h.
  const HORA = 60 * 60 * 1000;
  function apoioDoCache(cache, uid, dia, agora) {
    if (!uid) return { apoia: false, confere: false };
    const c = cache && cache.u === uid ? cache : null;
    const idade = c ? agora - (Number(c.ts) || 0) : Infinity;
    if (c && apoioVigente(c.ate, dia)) return { apoia: true, confere: idade > 6 * HORA };
    return { apoia: false, confere: !(idade >= 0 && idade < HORA) };
  }

  window.TCGVitrine = { posicoesNaGrade, configValida, escolheCriativos, adsenseLiberado, formatoDaFaixa, apoioVigente, apoioDoCache };

  // ── Página ────────────────────────────────────────────────────────────────
  const S = window.TCGShared;
  const tag = document.currentScript;
  if (!S || !tag || !document.body || typeof fetch !== "function") return;

  const t = S.t;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CELULAR = window.matchMedia ? matchMedia("(max-width: 700px)") : { matches: false };
  // 1888 = 1440 do conteúdo (--content-w) + 2 × (184 do trilho — o 160×600
  // padrão + 12 de moldura de cada lado — + 24 de folga até a grade + 16 até
  // a borda). Abaixo disso o trilho encostaria na grade ou vazaria da tela,
  // então ele simplesmente não existe (o CSS usa o mesmo número).
  const LARGA = window.matchMedia ? matchMedia("(min-width: 1888px)") : { matches: false };
  const aparelho = () => { try { return matchMedia("(pointer: coarse)").matches ? "m" : "d"; } catch (e) { return "d"; } };

  // Teto por dia da casa: contador de VISTOS por criativo, zerado na virada.
  const DIA_KEY = "sleevu-vitrine-v1";
  function hoje() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function lerDia() {
    try {
      const o = JSON.parse(localStorage.getItem(DIA_KEY) || "null");
      return o && o.d === hoje() && o.n && typeof o.n === "object" ? o.n : {};
    } catch (e) { return {}; }
  }
  function somaDia(id) {
    try {
      const n = lerDia();
      n[id] = (n[id] || 0) + 1;
      localStorage.setItem(DIA_KEY, JSON.stringify({ d: hoje(), n }));
    } catch (e) { /* sem storage: sem teto, e tudo bem */ }
  }

  // Ícones em traço (currentColor), como o resto do site — nunca emoji.
  const svg = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONE = {
    apoie: svg('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>'),
    conta: svg('<rect x="8" y="3" width="12" height="16" rx="2"/><path d="M5 7v12a2 2 0 0 0 2 2h9"/><path d="M12 9h4M12 13h4"/>'),
    anuncie: svg('<path d="M3 9l1.6-5h14.8L21 9"/><path d="M4 9v11h16V9"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M10 20v-5h4v5"/>')
  };

  function corpoCasa(c, cfg) {
    const k = c.id;
    const idioma = S.getLanguage();
    let acoes = "";
    if (k === "apoie") {
      // Pix na frente em português (é o jeito brasileiro); fora dele, só o Ko-fi.
      const pix = idioma === "pt" && cfg.pix ? `<button type="button" class="vtr-cta" data-vitrine-acao="pix">${esc(t("home.support.pix"))}</button>` : "";
      const kofi = cfg.kofi ? `<a class="vtr-cta${pix ? " vtr-cta-sec" : ""}" href="${esc(cfg.kofi)}" target="_blank" rel="noopener">${esc(t("vitrine.apoie.kofi"))}</a>` : "";
      acoes = pix + kofi;
    } else if (k === "conta") {
      acoes = `<a class="vtr-cta" href="/login">${esc(t("vitrine.conta.cta"))}</a>`;
    } else if (k === "anuncie" && cfg.contato) {
      acoes = `<a class="vtr-cta vtr-cta-sec" href="mailto:${esc(cfg.contato)}?subject=${encodeURIComponent("Anunciar no Sleevu")}">${esc(t("vitrine.anuncie.cta"))}</a>`;
    }
    return `<div class="vtr-casa"><span class="vtr-ico">${ICONE[k] || ""}</span>`
      + `<div class="vtr-txt"><strong>${esc(t(`vitrine.${k}.titulo`))}</strong><span>${esc(t(`vitrine.${k}.texto`))}</span></div>`
      + `<div class="vtr-acoes">${acoes}</div></div>`;
  }

  // Parceiro: uma imagem do próprio site e um link rel="sponsored". Tamanhos
  // fixos no <img> reservam a caixa antes de a imagem chegar (nada salta).
  const TAMANHO = { faixa: [728, 90], quadrado: [300, 250], trilho: [160, 600] };
  function corpoParceiro(c, formato) {
    const [w, h] = TAMANHO[formato];
    return `<a class="vtr-parceiro" href="${esc(c.href)}" target="_blank" rel="sponsored noopener">`
      + `<img src="${esc(c.imagens[formato])}" alt="${esc(c.alt)}" width="${w}" height="${h}" loading="lazy" decoding="async"></a>`;
  }

  // Rede (AdSense): o espaço nasce com a ALTURA DO ANÚNCIO reservada e vazio.
  // O <ins> só entra quando o espaço chega perto da tela (observadorRede) — é
  // o que faz o push() preencher ESTE bloco: o adsbygoogle preenche o primeiro
  // <ins> ainda não processado da página, na ordem do DOM, e um <ins> lá
  // embaixo pegaria o anúncio que era do de cima.
  function corpoRede(formato) {
    return `<div class="vtr-rede vtr-rede-${formato}" data-vitrine-formato="${formato}"></div>`;
  }
  let redeCarregada = false, redeFalhou = false;
  function carregaRede(cliente) {
    if (redeCarregada) return;
    redeCarregada = true;
    // Criado por um script com nonce: a CSP da borda ('strict-dynamic') deixa
    // rodar sem nonce próprio.
    const s = document.createElement("script");
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(cliente)}`;
    // Script barrado (adblock — comum no público do site — ou rede fora):
    // todo espaço da rede vira casa, em vez de uma caixa vazia de 90/250 px.
    s.onerror = () => {
      redeFalhou = true;
      document.querySelectorAll('.vtr-espaco[data-vitrine-tipo="adsense"]').forEach(viraCasa);
    };
    (document.head || document.documentElement).appendChild(s);
  }
  // Bloco que não recebeu resposta nenhuma do Google (nem "filled" nem
  // "unfilled") nesse tempo também vira casa: é o sintoma do script
  // bloqueado sem erro de rede, ou de um bloco mal configurado no painel.
  const ESPERA_REDE_MS = 10000;
  function preencheRede(el) {
    const caixa = el.querySelector(".vtr-rede");
    if (!caixa || el.dataset.vitrinePedido || !config || !config.adsense) return;
    const formato = caixa.dataset.vitrineFormato;
    const [w, h] = TAMANHO[formato];
    el.dataset.vitrinePedido = "1";
    const ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.style.cssText = `display:inline-block;width:${w}px;height:${h}px`;
    ins.setAttribute("data-ad-client", config.adsense.cliente);
    ins.setAttribute("data-ad-slot", config.adsense.blocos[formato]);
    caixa.appendChild(ins);
    // Sem anúncio pra este espaço (o Google marca data-ad-status="unfilled"):
    // entra a casa, na mesma altura reservada.
    new MutationObserver(() => {
      if (ins.getAttribute("data-ad-status") === "unfilled" && ins.isConnected) viraCasa(el);
    }).observe(ins, { attributes: true, attributeFilter: ["data-ad-status"] });
    if (redeFalhou) { viraCasa(el); return; }
    carregaRede(config.adsense.cliente);
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { viraCasa(el); return; }
    setTimeout(() => {
      if (ins.isConnected && !ins.getAttribute("data-ad-status") && el.dataset.vitrinePedido) viraCasa(el);
    }, ESPERA_REDE_MS);
  }
  const observadorRede = "IntersectionObserver" in window ? new IntersectionObserver((entradas) => {
    entradas.forEach((e) => { if (e.isIntersecting) { observadorRede.unobserve(e.target); preencheRede(e.target); } });
  }, { rootMargin: "400px 0px" }) : null;

  // A casa como reserva: pra bloco não preenchido e pra anúncio que teria de
  // ser RECARREGADO. Prefere um criativo que ainda não está na página; ignora
  // o teto por dia (é um caminho raro, e espaço vazio seria pior).
  let config = null, contexto = null;
  const emUso = new Set();
  function casaReserva() {
    if (!config || !contexto) return null;
    const todas = escolheCriativos(config.criativos, Object.assign({}, contexto, { porDia: Infinity }), 9, ["casa"], () => 0);
    return todas.find((c) => !emUso.has(c.id)) || todas[0] || null;
  }
  // Troca um espaço da rede pela casa, NO LUGAR (mesma caixa, mesma altura).
  // Tirar o <ins> é o que garante que o anúncio já pedido não seja recarregado:
  // um iframe que sai do DOM e volta (re-render da grade, reposicionamento no
  // resize) refaz o pedido sozinho, e anúncio atualizado sem ação da pessoa é
  // contra a política do AdSense.
  function viraCasa(el) {
    if (observadorRede) observadorRede.unobserve(el);
    const c = casaReserva();
    const caixa = el.querySelector(".vtr-rede");
    if (!c || !caixa) { el.dataset.vitrineMorta = "1"; el.remove(); return; }
    emUso.add(c.id);
    delete el.dataset.vitrinePedido;
    el.dataset.vitrineTipo = "casa";
    el.dataset.vitrineCriativo = c.id;
    const rotulo = t("vitrine.rotulo.casa");
    el.setAttribute("aria-label", rotulo);
    const r = el.querySelector(".vtr-rotulo");
    if (r) r.textContent = rotulo;
    caixa.innerHTML = corpoCasa(c, config);
    marcaServida(el);
  }

  // ── Medição ───────────────────────────────────────────────────────────────
  const servidas = [], vistas = [];
  const jaServida = new Set(), jaVista = new Set();
  const temporizador = new WeakMap();
  const observador = "IntersectionObserver" in window ? new IntersectionObserver((entradas) => {
    entradas.forEach((e) => {
      const el = e.target;
      clearTimeout(temporizador.get(el));
      if (e.intersectionRatio >= 0.5) temporizador.set(el, setTimeout(() => marcaVista(el), 1000));
    });
  }, { threshold: [0, 0.5] }) : null;
  const chave = (el) => `${el.dataset.vitrinePos}:${el.dataset.vitrineCriativo}`;
  function marcaServida(el) {
    const k = chave(el);
    if (jaServida.has(k)) return;
    jaServida.add(k);
    servidas.push(k);
    if (observador) observador.observe(el);
  }
  function marcaVista(el) {
    const k = chave(el);
    if (jaVista.has(k) || !el.isConnected) return;
    jaVista.add(k);
    vistas.push(k);
    if (el.dataset.vitrineTipo === "casa") somaDia(el.dataset.vitrineCriativo);
  }
  function envia() {
    if (!servidas.length && !vistas.length) return;
    S.logEvento("ad_view", { sv: servidas.splice(0), v: vistas.splice(0), d: aparelho() });
  }
  window.addEventListener("pagehide", envia);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") envia(); });

  // ── O espaço ──────────────────────────────────────────────────────────────
  function criaEspaco(pos, c, formato, cfg) {
    // Rede sem bloco pra este formato: a faixa larga tenta o 300×250 (cabe em
    // qualquer largura); sem nenhum, o espaço é da casa.
    if (c.tipo === "adsense") {
      const blocos = cfg.adsense.blocos;
      if (!blocos[formato] && formato === "faixa" && blocos.quadrado) formato = "quadrado";
      if (!blocos[formato]) c = casaReserva();
      if (!c) return null;
    }
    if (c.tipo === "casa") emUso.add(c.id);
    const el = document.createElement("aside");
    el.className = `vtr-espaco vtr-${formato === "trilho" ? "trilho" : "faixa"}`;
    el.dataset.vitrinePos = pos;
    el.dataset.vitrineCriativo = c.id;
    el.dataset.vitrineTipo = c.tipo;
    // "Publicidade" é o rótulo que o AdSense aceita (ou "Links patrocinados").
    const rotulo = t(c.tipo === "adsense" ? "vitrine.rotulo.anuncio" : c.tipo === "parceiro" ? "vitrine.rotulo.parceiro" : "vitrine.rotulo.casa");
    el.setAttribute("aria-label", rotulo);
    // As grades são aria-live: sem isto, cada re-render leria o espaço em voz
    // alta junto com as cartas.
    el.setAttribute("aria-live", "off");
    el.innerHTML = `<div class="vtr-topo"><span class="vtr-rotulo">${esc(rotulo)}</span><a class="vtr-sobre" href="/faq#anuncios">${esc(t("vitrine.sobre"))}</a></div>`
      + (c.tipo === "adsense" ? corpoRede(formato) : c.tipo === "parceiro" ? corpoParceiro(c, formato) : corpoCasa(c, cfg));
    if (c.tipo === "adsense" && observadorRede) observadorRede.observe(el);
    el.addEventListener("click", (e) => aoClicar(e, el, cfg));
    el.addEventListener("auxclick", (e) => { if (e.button === 1) aoClicar(e, el, cfg); });
    return el;
  }

  function aoClicar(e, el, cfg) {
    const alvo = e.target.closest("a, button");
    if (!alvo || alvo.classList.contains("vtr-sobre")) return;
    S.logEvento("ad_click", { s: el.dataset.vitrinePos, c: el.dataset.vitrineCriativo, d: aparelho() });
    // O clique do meio (abrir link em outra aba) só CONTA; ação de botão, só no clique.
    if (e.type === "click" && alvo.dataset.vitrineAcao === "pix") copiaPix(alvo, cfg.pix);
  }

  async function copiaPix(botao, pix) {
    try {
      await navigator.clipboard.writeText(pix);
    } catch (_err) {
      // Mesmo plano B da home: navegador sem Clipboard API (ou fora de HTTPS).
      const campo = document.createElement("textarea");
      campo.value = pix;
      campo.style.position = "fixed";
      campo.style.opacity = "0";
      document.body.appendChild(campo);
      campo.select();
      try { document.execCommand("copy"); } catch (_e2) { /* ignora */ }
      campo.remove();
    }
    const antes = botao.textContent;
    botao.textContent = t("home.support.pixDone");
    setTimeout(() => { botao.textContent = antes; }, 2000);
  }

  // Faixas numa grade. As páginas redesenham a grade inteira a cada filtro,
  // ordem ou "carregar mais" (grid.innerHTML = "" + appends do createPager):
  // o MutationObserver recoloca as MESMAS faixas (os elementos ficam guardados
  // aqui), no mesmo quadro — o callback roda antes da pintura. Fase 1: bloco
  // do AdSense recolocado recarrega o iframe; lá, faixa removida por re-render
  // vira bloco novo só em mudança pedida pela pessoa (filtro), nunca sozinha.
  // Título de grupo dentro da lista: <h2> do mês (Lançamentos), .set-series-head
  // (Sets). A faixa pode vir ANTES dele, nunca logo depois.
  const ehCabecalho = (el) => /^H[1-6]$/.test(el.tagName) || /(^|\s)[\w-]+-(head|month)(\s|$)/.test(el.getAttribute("class") || "");
  function montaGrade(grade, criativos, cfg) {
    const faixas = [];
    const mo = new MutationObserver(posiciona);
    function posiciona() {
      try {
        const regra = CELULAR.matches ? cfg.regras.celular : cfg.regras.desktop;
        const filhos = Array.prototype.slice.call(grade.children);
        const carregando = filhos.some((f) => f.classList.contains("skel"));
        const itens = [], tops = [], permitido = [];
        let desconto = 0;
        const gap = parseFloat(getComputedStyle(grade).rowGap) || 0;
        filhos.forEach((f) => {
          if (f.classList.contains("vtr-espaco")) {
            if (f.offsetParent !== null) desconto += f.offsetHeight + gap;
            return;
          }
          if (f.hidden || f.offsetParent === null || f.classList.contains("grid-sentinel")) return;
          permitido.push(!itens.length || !ehCabecalho(itens[itens.length - 1]));
          itens.push(f);
          tops.push(f.offsetTop - desconto);
        });
        // Grade escondida (modo fichário do set), vazia ou em esqueleto: sem faixa.
        const idx = carregando || !itens.length ? [] : posicoesNaGrade(tops, window.innerHeight, regra, permitido).slice(0, criativos.length);
        // Largura útil da faixa (a grade menos a moldura de 16 px de cada lado).
        const formato = formatoDaFaixa(grade.clientWidth - 32);
        idx.forEach((i, k) => {
          if (faixas[k] === undefined) faixas[k] = criaEspaco(`f${k + 1}`, criativos[k], formato, cfg);
          const el = faixas[k];
          if (!el || el.dataset.vitrineMorta) return;
          if (el.parentNode !== grade || el.nextElementSibling !== itens[i]) {
            // Anúncio já pedido não se move: vira casa ANTES (ver viraCasa).
            if (el.dataset.vitrinePedido) viraCasa(el);
            if (el.dataset.vitrineMorta) return;
            grade.insertBefore(el, itens[i]);
          }
          marcaServida(el);
        });
        for (let k = idx.length; k < faixas.length; k++) {
          const el = faixas[k];
          if (!el || !el.parentNode) continue;
          if (el.dataset.vitrinePedido) viraCasa(el); // sai da página: não pode voltar recarregando
          el.remove();
        }
      } finally {
        mo.takeRecords(); // as mudanças que a própria faixa fez não disparam de novo
      }
    }
    mo.observe(grade, { childList: true });
    posiciona();
    let espera = 0;
    window.addEventListener("resize", () => { clearTimeout(espera); espera = setTimeout(posiciona, 200); });
  }

  // Trilho: fixo na margem que o conteúdo de 1440 px deixa vazia em tela
  // larga. Só nasce (e só conta como servido) quando a tela é larga de fato.
  function montaTrilho(c, cfg) {
    let el = null;
    const aplica = () => {
      if (!LARGA.matches || el) return;
      el = criaEspaco("t", c, "trilho", cfg);
      if (!el) return;
      document.body.appendChild(el);
      marcaServida(el);
    };
    aplica();
    if (LARGA.addEventListener) LARGA.addEventListener("change", aplica);
  }

  // Aviso de consentimento (LGPD, docs/PLANO-ADS.md seção 9). Só aparece quando
  // a cadeia tem um fornecedor que usa cookie de terceiro — na fase 0 não tem,
  // então ele não aparece. Aceitar e recusar têm o mesmo peso (o guia da ANPD
  // pede "recusar" tão fácil quanto "aceitar"), e a escolha fica editável em
  // Configurações → Privacidade. `adsDecidido` separa "recusou" de "nunca
  // respondeu", que o ads:false sozinho não distingue.
  function mostraAviso() {
    if (S.hasConsent("adsDecidido") || document.querySelector(".vtr-aviso")) return;
    const el = document.createElement("div");
    el.className = "vtr-aviso";
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", t("vitrine.aviso.titulo"));
    el.innerHTML = `<strong>${esc(t("vitrine.aviso.titulo"))}</strong>`
      + `<p>${esc(t("vitrine.aviso.texto"))} <a href="/privacy#anuncios">${esc(t("vitrine.aviso.saiba"))}</a></p>`
      + `<div class="vtr-aviso-acoes"><button type="button" class="vtr-cta vtr-cta-sec" data-aviso="0">${esc(t("vitrine.aviso.recusar"))}</button>`
      + `<button type="button" class="vtr-cta vtr-cta-sec" data-aviso="1">${esc(t("vitrine.aviso.aceitar"))}</button></div>`;
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-aviso]");
      if (!b) return;
      S.setConsent("ads", b.dataset.aviso === "1");
      S.setConsent("adsDecidido", true);
      el.remove();
    });
    document.body.appendChild(el);
  }

  function inicia(cfg) {
    // Economia de dados ligada: nada de rede de anúncio (fase 1) — a casa e o
    // parceiro são leves e locais, esses ficam.
    const economia = !!(navigator.connection && navigator.connection.saveData);
    const pais = document.documentElement.getAttribute("data-pais") || "";
    // O aviso só faz sentido onde a rede PODERIA rodar (mesmas condições, sem
    // o consentimento — que é justamente a pergunta).
    if (adsenseLiberado({ cfg, consentiu: true, pais, economia })) mostraAviso();
    const liberado = adsenseLiberado({ cfg, consentiu: S.hasConsent("ads"), pais, economia });
    const ordem = cfg.fornecedores;

    const grade = tag.getAttribute("data-grade") ? document.querySelector(tag.getAttribute("data-grade")) : null;
    const nFaixas = grade ? (CELULAR.matches ? cfg.regras.celular : cfg.regras.desktop).max : 0;
    const trilho = cfg.trilho && LARGA.matches;
    const ctx = {
      jogo: (window.SLEEVU && window.SLEEVU.game) || "",
      idioma: S.getLanguage(),
      hoje: hoje(),
      logado: !!S.getSession(),
      temKofi: !!cfg.kofi,
      vistosHoje: lerDia(),
      porDia: cfg.porDia,
      adsense: liberado
    };
    config = cfg;
    contexto = ctx;
    const escolhidos = escolheCriativos(cfg.criativos, ctx, nFaixas + (trilho ? 1 : 0), ordem);
    // Tela larga: o trilho fica com o 1º criativo — na margem ele não
    // interrompe nada, então é o lugar preferido; as faixas ficam com o resto.
    // Parceiro sem arte vertical não serve pro trilho.
    let noTrilho = null;
    if (trilho) {
      const i = escolhidos.findIndex((c) => c.tipo === "casa" || (c.tipo === "parceiro" && c.imagens.trilho) || (c.tipo === "adsense" && cfg.adsense.blocos.trilho));
      if (i >= 0) noTrilho = escolhidos.splice(i, 1)[0];
    }
    if (noTrilho) montaTrilho(noTrilho, cfg);
    if (grade && escolhidos.length) montaGrade(grade, escolhidos.slice(0, nFaixas), cfg);
  }

  // Quem apoia não vê espaço nenhum — nem AdSense, nem trilho, nem a casa
  // pedindo apoio a quem já apoiou (não tem aviso de consentimento, não mede
  // ad_view). A resposta do banco fica guardada por conta neste aparelho
  // (apoioDoCache decide quando reconferir), então a partir da 2ª página a
  // decisão é instantânea. Deslogado não tem como ser apoiador.
  const APOIO_KEY = "sleevu-apoio-v1";
  function apoioAgora() {
    const sessao = S.getSession && S.getSession();
    const uid = sessao && sessao.user && sessao.user.id;
    let cache = null;
    try { cache = JSON.parse(localStorage.getItem(APOIO_KEY) || "null"); } catch (e) { /* sem storage: pergunta sempre */ }
    const d = apoioDoCache(cache, uid, hoje(), Date.now());
    if (!d.confere || !S.adminRpc) return Promise.resolve(d.apoia);
    // undefined = a RPC ainda não existe (migração 20260928c pendente) e null
    // = não apoia (ou a chamada falhou): os dois viram "não apoia" por 1 h.
    const busca = S.adminRpc("apoio_status", 0, {}).then((ate) => {
      try { localStorage.setItem(APOIO_KEY, JSON.stringify({ u: uid, ate: typeof ate === "string" ? ate : "", ts: Date.now() })); } catch (e) { /* ignora */ }
      return apoioVigente(ate, hoje());
    }, () => false);
    if (d.apoia) return Promise.resolve(true);
    // Banco lento não segura a página: passou disso, segue como "não apoia".
    return Promise.race([busca, new Promise((ok) => setTimeout(() => ok(false), 2500))]);
  }

  // Config por fetch (e não embutida): o JSON muda sem mexer em código e o
  // `"ativo": false` desliga tudo. Passa pelo service worker como dado
  // (stale-while-revalidate), então chega rápido a partir da 2ª página. A
  // pergunta "apoia?" vai junto, em paralelo.
  const config$ = fetch("/data/ads.json").then((r) => (r.ok ? r.json() : null)).then(configValida);
  Promise.all([config$, Promise.resolve().then(apoioAgora).catch(() => false)]).then(([cfg, apoia]) => {
    if (cfg && !apoia) inicia(cfg);
  }).catch(() => { /* sem config, sem vitrine: a página segue igual */ });
})();
