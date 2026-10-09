(function () {
  const shared = window.TCGShared;
  const { escapeHtml, escapeAttribute, t, tn, getLocale, detailUrl } = shared;

  // Tudo na moeda escolhida no header.
  function money(value) {
    return shared.formatMoney(shared.getCurrency(), value > 0 ? value : 0);
  }
  // Variação, lucro e resultado andam sempre com os três juntos: sinal, valor
  // absoluto e a classe da cor. A seta vai ALÉM da cor (verde/vermelho sozinho
  // não serve a quem não distingue as duas).
  const sign = (v) => (v >= 0 ? "+" : "−");
  const cls = (v) => (v > 0.005 ? "is-up" : (v < -0.005 ? "is-down" : ""));
  const seta = (v) => (v > 0.005 ? "▲" : (v < -0.005 ? "▼" : "→"));
  const signedMoney = (v) => sign(v) + money(Math.abs(v));
  // Porcentagem pelo locale (vírgula em pt/es, ponto em en).
  const pctTxt = (v, casas) => {
    const c = casas == null ? 1 : casas;
    return Math.abs(v).toLocaleString(getLocale(), { minimumFractionDigits: c, maximumFractionDigits: c }) + "%";
  };

  // ===========================================================================
  // Portfólio: visão FINANCEIRA da Minha Coleção — TODOS os jogos, com filtro
  // por jogo dentro da página (#gameFilter, o mesmo das outras telas, pra herdar
  // os 13 jogos e a gaveta do mobile). O total tem que BATER com a
  // Coleção -> mesma fonte e mesma fórmula:
  //   patrimônio = cartas raw (todos os jogos) + slabs graded.
  // Binders e wishlist são VISÕES (filtros), não somam ao patrimônio.
  // Coleção unificada igual à collection.js (stores por jogo + facades).
  // A página é NEUTRA (sessão "hub", ver isNeutralPage no game.js): nada aqui
  // depende do jogo da sessão.
  //
  // PORTFÓLIO 3.0 (2026-10-09) — o que mudou no desenho, e por quê:
  // - UM número grande: o patrimônio é o cabeçalho do gráfico (o scrub move
  //   ele). Antes eram dois, o do gráfico e o do cartão, que no celular ficavam
  //   a um polegar de distância.
  // - Seis cartões do mesmo tamanho (patrimônio, cartas, graded, custo,
  //   desejos, cópias precificadas) viraram um RESUMO de quatro peças que se
  //   adapta a quem você é: com custo informado entra o lucro potencial; com
  //   venda, o resultado; sem os dois, as peças "fora do patrimônio". A
  //   cobertura de preço virou rodapé — é confiança no número, não um número.
  // - "Composição por tipo", "Por jogo" e o detalhamento por set/raridade/
  //   artista eram três blocos com três desenhos. Agora é UMA seção, "Onde está
  //   o valor", com abas, barra empilhada e linhas com %.
  // - Movimentos: as SUAS cartas na semana (price-deltas-7d, o mesmo arquivo do
  //   Hub), com o efeito em dinheiro. A aba "Mercado" saiu: altas do mercado
  //   inteiro não respondem "o que aconteceu com o meu patrimônio", e o
  //   painel de mercado da tela de Sets já mostra.
  // - Tabelas viraram LINHAS com a arte da carta (no celular as colunas
  //   "Atual" e "Lucro" ficavam fora da tela). Cada seção é um cartão com
  //   cabeçalho, abas e "Ver mais" — o mesmo molde de lista agrupada que o
  //   app nativo vai usar (ver docs/PORTFOLIO.md, seção 10).
  // ===========================================================================
  const GAMES = shared.GAME_SLUGS;
  const GAME_COLOR = shared.GAME_COLOR;
  const { ownedByGame, wishlistByGame, cardGameMap, gameOf, owned, wishlist, prices } = shared.createCrossGameStores();
  // Preço-alvo da wishlist ("me avisa quando chegar a R$X"): global, anotado na
  // página de Wishlist. Aqui ele vira a linha que diz o quanto falta cair.
  const wishTargets = shared.createWishTargetsStore();
  // Modo investidor (opcional): custo pago por carta + vendas realizadas.
  const costsStore = shared.createCostsStore();
  const soldStore = shared.createSoldStore();
  const listStore = shared.createListStore();

  let cards = [];
  let cardsById = new Map();
  let gameFilter = "all";
  // Aba ativa e "Ver mais" de cada seção. Trocar de aba redesenha SÓ a seção
  // (redesenhaSecao) — o gráfico e o resto da tela não piscam.
  const aba = { alloc: null, invest: null, goals: null };
  const aberta = { alloc: false, movers: false, top: false, invest: false, goals: false };
  // Patrimônio fresco do último render: é o número grande "parado". O scrub do
  // gráfico troca pelo do dia sob o dedo e, ao soltar, volta a este.
  let networthAgora = null;

  const elements = {
    grandTotal: document.getElementById("grandTotal"),
    rawValue: document.getElementById("rawValue"),
    rawCopies: document.getElementById("rawCopies"),
    gradedValue: document.getElementById("gradedValue"),
    gradedCount: document.getElementById("gradedCount"),
    pricedCopies: document.getElementById("pricedCopies"),
    kpis: document.getElementById("pfKpis"),
    alloc: document.getElementById("pfAlloc"),
    movers: document.getElementById("pfMovers"),
    top: document.getElementById("pfTop"),
    invest: document.getElementById("pfInvest"),
    goals: document.getElementById("pfGoals"),
    gameFilter: document.getElementById("gameFilter"),
    export: document.getElementById("pfExport"),
    empty: document.getElementById("emptyState")
  };

  // ÍNDICE DE MERCADO por jogo (build): { d: [datas], i: [valores base 1000] }.
  // É o benchmark do gráfico — a resposta pra "isso é a minha coleção ou é o
  // mercado inteiro?". Arquivo minúsculo (centenas de bytes), buscado só quando
  // o modo % está ligado, que é o único em que ele faz sentido.
  const indexByGame = Object.fromEntries(GAMES.map((g) => [g, null]));
  let indexPedido = false;
  function hidrataIndices() {
    if (indexPedido) return Promise.resolve();
    indexPedido = true;
    return Promise.all(GAMES.map((g) =>
      fetch(shared.gameDataDir(g) + "market-index.generated.json")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((j) => { indexByGame[g] = j && Array.isArray(j.d) && Array.isArray(j.i) ? j : null; })
    )).then(() => { renderControls(); renderChart(chartHistory()); });
  }

  // RETRATO INSTANTÂNEO antes de qualquer rede (estilo Collectr): o último
  // valor conhecido (histórico sincronizado ou cookie, via shared.valueSnapshot)
  // pinta os números NA HORA, esmaecido de leve; o cálculo fresco do render()
  // troca os números e tira o esmaecido quando os chunks chegam. Quem abre o
  // Portfólio abre pra ver o número — ele não pode esperar 50 requisições.
  const SNAP_ELS = ["grandTotal", "rawValue", "gradedValue"];
  // Ponto de partida do patrimônio "assentando" (ver pintaPatrimonio): é o
  // valor do retrato que o usuário JÁ está vendo — contar a partir do zero
  // animaria um número que nunca foi verdade.
  let snapStart = null;
  (function paintSnapshot() {
    const snap = shared.valueSnapshot();
    if (!snap) return;
    const fromBRL = (v) => { const r = shared.convertMoney(v, "BRL", shared.getCurrency()); return r == null ? v : r; };
    const pinta = (el, v) => { if (el) { el.textContent = money(fromBRL(v)); el.style.opacity = "0.55"; } };
    snapStart = fromBRL(snap.total);
    pinta(elements.grandTotal, snap.total);
    pinta(elements.rawValue, snap.raw);
    pinta(elements.gradedValue, snap.graded);
  })();

  // O patrimônio PRIMEIRO, só com as suas cartas; o mercado (variações da
  // semana) e as cartas de listas/binders que você não tem são segundas
  // etapas, que só re-renderizam a própria seção quando chegam.
  // loadOwnedFast: pede à borda (/api/collection) exatamente as cartas que você
  // tem, em vez de baixar os chunks INTEIROS de cada set em que tem alguma.
  // Possuídas + DESEJADAS: wishlistTotal varre `cards`, então a carta que você
  // quer (e por definição não tem) precisa estar lá pra ser somada.
  // collectionLoadIds soma ainda os ids que estão em SLAB: graduar e tirar a
  // cópia raw (o certo — senão a carta conta duas vezes) tirava o id de
  // knownCardIds, e o slab ficava sem carta: sumia da Graded, perdia o valor
  // automático PSA e caía no jogo errado na composição.
  const idsOwned = shared.collectionLoadIds(
    ownedByGame,
    Object.fromEntries(GAMES.map((g) => [g, wishlistByGame[g].knownCardIds()]))
  );
  // ANTES de esperar catálogo e cotações: o layout do celular (ações na
  // linha do select de jogo) tem que estar montado no primeiro paint — quando
  // rodava só depois dos dados, a tela abria com o cabeçalho antigo e "pulava"
  // pro novo segundos depois (2026-09-20).
  initMobileToolbar();
  Promise.all([shared.loadOwnedFast(idsOwned), shared.loadFxRates()])
    .then(([catalog]) => {
      indexaCartas(catalog.cards);
      // Carga incompleta (ver fetchCollectionApi e loadAcrossGames — os dois
      // caminhos marcam `parcial`): os totais desta sessão estão
      // subestimados, então NÃO grava o ponto do dia — ele substituiria o de
      // hoje e o gráfico mostraria uma queda que não houve. Vale pra sessão
      // inteira: as cargas seguintes (listas, binders) não completam o que
      // faltou aqui.
      if (catalog.parcial) cargaParcial = true;
      GAMES.forEach((g) => ownedByGame[g].migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId))));
      const escopo = escopoDeJogos();
      shared.setGameFilterScope(escopo);
      // ?filter=<jogo> na URL: abre já filtrado (o chip do Hub manda assim, e é
      // o que faz o refresh/compartilhamento não perderem o filtro).
      const pedido = shared.gameFilterFromUrl();
      if (pedido && escopo.includes(pedido)) {
        gameFilter = pedido;
        shared.markGameFilterChip(pedido);
        shared.applyGameAccent(pedido);
      }
      bindGameFilter();
      bindSecoes();
      bindExport();
      render();
      hidrataListas();
      hidrataVariacoes();
    })
    .catch((error) => {
      shared.mostraErroDeCatalogo(elements.empty, error);
      elements.empty.hidden = false;
    });

  function indexaCartas(lista) {
    // Dedupe por id: uma carga extra pode repetir carta que já veio na das
    // suas — e carta repetida na lista seria valor contado duas vezes.
    const porId = new Map();
    (lista || []).forEach((card) => { if (!porId.has(card.id)) porId.set(card.id, card); });
    cards = Array.from(porId.values());
    limpaMemo(); // as cartas mudaram: as contas memoizadas do render anterior morrem
    snapshotGravado = false; // com carta nova, o ponto do dia merece ser regravado
    cards.forEach((card) => cardGameMap.set(card.id, card.game));
    cardsById = porId;
  }

  // 2ª etapa das Listas/Binders: as cartas de uma lista de COMPRA não estão na
  // sua coleção, então não vieram na carga inicial — sem elas a lista valeria
  // zero. Buscamos só os ids que faltam.
  //
  // O jogo de um id desconhecido não dá pra adivinhar (o id não carrega a marca),
  // então: usa o `game` da lista quando ele existe e, no resto, pede o id a todos
  // os jogos — id de outro jogo é no-op no loader (mesmo padrão do sales.js).
  // O TETO existe porque esse "no resto" multiplica por 13: uma lista gigante sem
  // jogo viraria uma carga maior que a da própria coleção.
  const TETO_IDS_SEM_JOGO = 300;
  function hidrataListas() {
    const porJogo = Object.fromEntries(GAMES.map((g) => [g, []]));
    const semJogo = [];
    const querido = (id, jogo) => {
      if (!id || cardsById.has(id)) return;           // já veio na carga inicial
      if (jogo && porJogo[jogo]) porJogo[jogo].push(id);
      else semJogo.push(id);
    };
    listStore.list().forEach((l) => (l.entries || []).forEach((e) => querido(e && e.id, l.game)));
    lerBinders().forEach((b) => (b.slots || []).forEach((s) => querido(s && s.cardId, null)));
    const orfaos = [...new Set(semJogo)].slice(0, TETO_IDS_SEM_JOGO);
    GAMES.forEach((g) => { porJogo[g] = [...new Set(porJogo[g].concat(orfaos))]; });
    if (!Object.values(porJogo).some((ids) => ids.length)) { renderGoals(); return Promise.resolve(); }
    return shared.loadOwnedAcrossGames(porJogo)
      .then((extra) => { indexaCartas(cards.concat(extra.cards || [])); renderGoals(); })
      .catch(() => { renderGoals(); }); // sem as extras a seção ainda mostra o que dá
  }

  // Variação de 7 dias das SUAS cartas: price-deltas-7d do build, o MESMO
  // arquivo do "Maiores movimentos" do Hub — as duas telas contam a mesma
  // semana. Só dos jogos em que você tem carta: quem coleciona um jogo baixa
  // um arquivo, não treze. Falhar aqui não estraga nada: a seção não aparece.
  const deltasByGame = {};
  function hidrataVariacoes() {
    const meus = GAMES.filter((g) => ownedByGame[g].size > 0);
    return Promise.all(meus.map((g) => shared.loadPriceDeltas7d(g)
      .then((d) => { deltasByGame[g] = d && d.c ? d : null; })
      .catch(() => { deltasByGame[g] = null; })))
      .then(() => renderMovers());
  }

  // Um caminho só pra trocar o filtro de jogo — o clique no chip, a linha do
  // jogo em "Onde está o valor" e o ?filter= da URL fazem a mesma coisa.
  function aplicaFiltroDeJogo(slug) {
    if (!slug || slug === gameFilter) return;
    gameFilter = slug;
    shared.markGameFilterChip(slug);
    shared.applyGameAccent(slug);
    shared.stampGameFilter(slug);
    render();
    if (elements.gameFilter) elements.gameFilter.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function bindGameFilter() {
    if (!elements.gameFilter) return;
    elements.gameFilter.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-game-filter]");
      if (!chip || chip.dataset.gameFilter === gameFilter) return;
      gameFilter = chip.dataset.gameFilter;
      Array.from(elements.gameFilter.children).forEach((node) =>
        node.setAttribute("aria-pressed", String(node === chip)));
      shared.applyGameAccent(gameFilter);
      // Na URL: refresh mantém o filtro e o link do Portfólio filtrado pode ser
      // compartilhado (ver shared.stampGameFilter).
      shared.stampGameFilter(gameFilter);
      render();
    });
  }

  // Reduz os chips aos jogos em que você TEM alguma coisa — cartas, slabs,
  // desejos ou histórico já gravado. Com menos de dois, o shared esconde a barra
  // inteira (um jogo só e "Todos" são o mesmo conjunto). O histórico entra na
  // conta pra um jogo que você zerou não sumir do filtro enquanto a linha dele
  // ainda aparece no gráfico.
  function escopoDeJogos() {
    return GAMES.filter((g) =>
      ownedByGame[g].size > 0
      || gradedSlabs(g).length > 0
      || wishlistByGame[g].knownCardIds().length > 0
      || loadHist(g).length > 0);
  }

  // Abas, "Ver mais" e as linhas de jogo de todas as seções: UM ouvinte no
  // <main>, delegado — as seções são reescritas a cada render e perderiam
  // ouvintes próprios.
  function bindSecoes() {
    const main = document.querySelector(".pf-main");
    if (!main) return;
    main.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-pf-tab]");
      if (tab) {
        const grupo = tab.dataset.pfTab;
        if (aba[grupo] === tab.dataset.k) return;
        aba[grupo] = tab.dataset.k;
        aberta[grupo] = false;
        redesenhaSecao(grupo);
        return;
      }
      const mais = event.target.closest("[data-pf-more]");
      if (mais) {
        const grupo = mais.dataset.pfMore;
        aberta[grupo] = !aberta[grupo];
        redesenhaSecao(grupo);
        // Ao FECHAR uma lista longa, a seção pode ter ficado lá em cima: traz o
        // cabeçalho dela de volta pra vista em vez de deixar a pessoa perdida.
        if (!aberta[grupo]) {
          const sec = mais.closest(".pf-card");
          if (sec && sec.getBoundingClientRect().top < 0) sec.scrollIntoView({ block: "start", behavior: "smooth" });
        }
        return;
      }
      const jogo = event.target.closest("[data-comp-game]");
      if (jogo) { event.preventDefault(); aplicaFiltroDeJogo(jogo.dataset.compGame); }
    });
  }
  function redesenhaSecao(grupo) {
    if (grupo === "alloc") renderAlloc();
    else if (grupo === "movers") renderMovers();
    else if (grupo === "top") renderTop();
    else if (grupo === "invest") renderInvest();
    else if (grupo === "goals") renderGoals();
  }

  // ---- Peças de desenho compartilhadas pelas seções -------------------------
  // Cabeçalho de seção: título, complemento curto e (opcional) um valor à
  // direita — o mesmo molde em todas, que é o que faz a tela ler como uma só.
  function cabecalho(titulo, sub, direita) {
    return `<header class="pf-sec-head"><h2>${escapeHtml(titulo)}</h2>${sub ? `<small>${escapeHtml(sub)}</small>` : ""}${direita || ""}</header>`;
  }
  // Abas de uma seção (segmentado). aria-pressed e não role=tab: são filtros
  // do conteúdo logo abaixo, como os chips de jogo.
  function abas(grupo, itens, ativa) {
    if (itens.length < 2) return "";
    return `<div class="pf-tabs" role="group">${itens.map(([k, rotulo]) =>
      `<button type="button" class="pf-tab" data-pf-tab="${grupo}" data-k="${escapeAttribute(k)}" aria-pressed="${k === ativa}">${escapeHtml(rotulo)}</button>`).join("")}</div>`;
  }
  // "Ver mais 23" (quantas faltam), e não "Ver todas (33)": serve a cartas,
  // sets e movimentos sem brigar com o gênero de cada um.
  function botaoMais(grupo, faltam, aberto) {
    return `<button type="button" class="pf-more" data-pf-more="${grupo}" aria-expanded="${aberto}">${escapeHtml(aberto ? t("portfolio.less") : t("portfolio.more", { n: faltam }))}</button>`;
  }
  // "2 de out" no lugar do 2026-10-02 cru do arquivo do build.
  const diaCurto = (iso) => new Date(iso + "T00:00:00").toLocaleDateString(getLocale(), { day: "numeric", month: "short" }).replace(".", "");
  function thumbDe(card) {
    const src = shared.cardImageSources(card);
    return `<span class="pf-thumb">${shared.localizedImg(src.url, { alt: "", fallback: src.fallback, loading: "lazy", thumb: true })}</span>`;
  }
  const cardHref = (card) => detailUrl("set", card.set, "", card.game, { card: card.id, setId: card.setId });
  // Linha de carta: arte, nome, linha de apoio e o valor à direita. É a célula
  // das listas de Mais valiosas, Movimentos, Posições e Desejos.
  function linhaCarta({ card, href, rank, sub, tags, valor, apoio, apoioCls }) {
    return `<li><a class="pf-row" href="${escapeAttribute(href || cardHref(card))}">
      ${rank != null ? `<span class="pf-rank">${rank}</span>` : ""}
      ${thumbDe(card)}
      <span class="pf-row-main"><strong>${escapeHtml(card.name)}</strong><span class="pf-row-sub">${escapeHtml(sub || shared.dotJoin(card.set, card.number))}</span>${tags ? `<span class="pf-tags">${tags}</span>` : ""}</span>
      <span class="pf-row-end">${valor}${apoio ? `<small class="${apoioCls || ""}">${apoio}</small>` : ""}</span>
    </a></li>`;
  }
  // ---- Export CSV do portfólio (snapshot financeiro, respeita o filtro de jogo).
  // Diferente do CSV do menu da conta (inventário do jogo da sessão, preço manual):
  // aqui vai TODO o patrimônio precificado — cartas raw com valor de mercado por
  // condição + slabs graded — em todos os jogos, na moeda do topo.
  // Coluna "Jogo": o nome completo do registro do game.js (window.SLEEVU.games),
  // que já nasce com todo jogo novo. Até 2026-09-30 era um mapa fixo aqui que só
  // os jogos vintage lembraram de atualizar: os 9 do TCGCSV/Scryfall (Magic,
  // Yu-Gi-Oh!, Star Wars…) saíam como slug cru ("ygo", "swu").
  // Naruto e HxH ficam com a grafia que o CSV sempre escreveu: o "Card Game" e o
  // "×" do registro mudariam a coluna de quem já filtra ou soma por ela.
  const CSV_GAME_LEGACY = { naruto: "Naruto", hxh: "Hunter x Hunter" };
  function csvGameName(g) {
    const reg = (window.SLEEVU && window.SLEEVU.games) || {};
    return CSV_GAME_LEGACY[g] || (reg[g] && reg[g].name) || g;
  }
  function csvCell(value) {
    const s = value == null ? "" : String(value);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const csvNum = (v) => (Math.round((v || 0) * 100) / 100).toFixed(2).replace(".", ",");
  function exportPortfolioCsv() {
    const cur = shared.getCurrency();
    const { lines } = collectionLines(gameFilter);
    const rows = [t("portfolio.csv.header").split(";")];
    lines.forEach((l) => rows.push([
      t("portfolio.csv.card"), csvGameName(l.card.game), l.card.name, l.card.set,
      l.card.number, l.card.language || "", l.variant, l.condition, l.quantity, csvNum(l.unit), csvNum(l.total), cur
    ]));
    gradedSlabs(gameFilter).forEach((s) => {
      const card = cardsById.get(s.cardId);
      if (!card) return;
      rows.push([
        t("portfolio.csv.slab"), csvGameName(card.game), card.name, card.set,
        card.number, card.language || "", s.variant || "", `${String(s.company || "").toUpperCase()} ${shared.gradedGradeText(s.grade, s.pristine)}`,
        1, csvNum(s.value), csvNum(s.value), cur
      ]);
    });
    // BOM: o Excel só reconhece UTF-8 (acentos) com ele.
    const csv = "﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sleevu-portfolio-${new Date().toISOString().slice(0, 10)}${gameFilter !== "all" ? "-" + gameFilter : ""}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  // Liga-desliga do modo privacidade. A preferência é a MESMA das Configurações
  // (shared.setSensitive), não uma segunda: dois interruptores pro mesmo estado
  // é como se descobre, no print, que só um deles estava ligado.
  function bindPrivacy() {
    const btn = document.getElementById("pfPrivacy");
    if (!btn) return;
    const pinta = () => {
      const on = shared.sensitiveEnabled();
      btn.hidden = false;
      btn.setAttribute("aria-pressed", String(on));
      // Só-ícone: o rótulo vive no <span> escondido (leitor de tela) e o
      // title diz o que o clique faz; escrever no textContent apagaria os SVGs.
      btn.querySelector("span").textContent = on ? t("portfolio.privacy.on") : t("portfolio.privacy.off");
      btn.title = `${on ? t("portfolio.privacy.on") : t("portfolio.privacy.off")} · ${t("portfolio.privacy.hint")}`;
    };
    pinta();
    btn.addEventListener("click", () => { shared.setSensitive(!shared.sensitiveEnabled()); pinta(); });
  }

  // CELULAR (pedido de 2026-09-20): o título "Portfólio" e o "← Hub" somem
  // (a tabbar já tem Hub e Portfólio) e as três ações (olho, retrospectiva,
  // exportar) vão pra MESMA linha do select de jogo, à direita dele. MOVE o
  // .pf-head-actions (não clona: os botões têm listeners por id) pra dentro
  // de um embrulho .pf-mobile-toolbar junto do filtro de jogo; ao alargar a
  // tela devolve tudo ao lugar. O select-espelho do shared.js é o
  // nextElementSibling do #gameFilter — ou do .chip-scroll que o embrulha —
  // e tem que continuar sendo, senão o syncGameFilterSelect cria outro. Por
  // isso o embrulho leva [filtro][select][ações], nessa ordem.
  function initMobileToolbar() {
    const actions = document.querySelector(".pf-head-actions");
    const filter = document.getElementById("gameFilter");
    if (!actions || !filter) return;
    const casa = actions.parentElement;
    const mq = window.matchMedia("(max-width: 600px)");
    let bar = null;
    const aplicar = () => {
      if (mq.matches && !bar) {
        const alvo = filter.parentElement.classList.contains("chip-scroll") ? filter.parentElement : filter;
        const sel = alvo.nextElementSibling && alvo.nextElementSibling.classList.contains("game-filter-select") ? alvo.nextElementSibling : null;
        bar = document.createElement("div");
        bar.className = "pf-mobile-toolbar";
        alvo.parentElement.insertBefore(bar, alvo);
        bar.appendChild(alvo);
        if (sel) bar.appendChild(sel);
        bar.appendChild(actions);
      } else if (!mq.matches && bar) {
        casa.appendChild(actions);
        bar.replaceWith(...bar.childNodes);
        bar = null;
      }
    };
    aplicar();
    mq.addEventListener("change", aplicar);
  }

  function bindExport() {
    bindPrivacy();
    const recap = document.getElementById("pfRecap");
    if (recap) {
      // Só oferece quando há histórico pra contar uma história (2+ pontos).
      recap.hidden = chartHistory().length < 2;
      recap.querySelector("span").textContent = t("portfolio.recap.button");
      recap.title = t("portfolio.recap.button");
      recap.addEventListener("click", () => exportRetrospectiva(recap));
    }
    if (!elements.export) return;
    elements.export.hidden = false;
    elements.export.addEventListener("click", exportPortfolioCsv);
  }
  // ---- Retrospectiva do ano (PNG pra compartilhar) ---------------------------
  // O "Unpacked" do Dragon Shield mostrou que retrospectiva é o conteúdo que o
  // colecionador posta sozinho. Aqui ela sai do dado que a tela já tem: o
  // histórico por jogo, as vendas e a coleção. Canvas puro (CSP: sem lib) e sem
  // rede — nenhuma imagem de carta entra, então nunca "taint"a o canvas nem
  // depende de CDN. Só aparece com histórico suficiente pra dizer algo.
  function dadosDaRetrospectiva() {
    const ano = new Date().getFullYear();
    const inicioAno = `${ano}-01-01`;
    const hist = chartHistory();
    if (hist.length < 2) return null;
    const noAno = hist.filter((p) => p.d >= inicioAno);
    const base = noAno.length >= 2 ? noAno[0] : hist[0];
    const fim = hist[hist.length - 1];
    const valOf = (p) => fromBRL((p.c || 0) + (p.b || 0));
    const de = valOf(base), para = valOf(fim);
    const vendas = soldStore.list().filter((it) => String(it.date || "").slice(0, 4) === String(ano));
    let vendido = 0, resultado = 0;
    vendas.forEach((it) => { const v = shared.soldValues(it); vendido += v.net; if (v.hasCost) resultado += v.pnl; });
    // Jogo com maior patrimônio hoje (o "seu jogo do ano").
    const porJogo = GAMES.map((g) => ({ g, v: collectionLines(g).total + gradedSlabs(g).reduce((s, x) => s + (x.value || 0), 0) }))
      .filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    const { totalCopies } = collectionLines("all");
    return {
      ano, de, para, cresceu: para - de, pct: de > 0 ? ((para - de) / de) * 100 : 0,
      vendas: vendas.length, vendido, resultado,
      jogoTop: porJogo[0] ? shared.gameLabel(porJogo[0].g) : "",
      corTop: porJogo[0] ? GAME_COLOR[porJogo[0].g] : "#34d399",
      copias: totalCopies, desde: base.d
    };
  }

  function exportRetrospectiva(btn) {
    const d = dadosDaRetrospectiva();
    if (!d) { alert(t("portfolio.recap.tooEarly")); return; }
    const rotulo = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "…"; }
    const W = 1080, H = 1350; // 4:5, o formato que rende no feed
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    // Fundo escuro fixo (não segue o tema do site): a imagem vai viver fora
    // daqui, onde o tema de quem vê não tem nada a ver com o seu.
    ctx.fillStyle = "#101218"; ctx.fillRect(0, 0, W, H);
    const faixa = ctx.createLinearGradient(0, 0, W, 420);
    faixa.addColorStop(0, d.corTop); faixa.addColorStop(1, "#101218");
    ctx.globalAlpha = 0.22; ctx.fillStyle = faixa; ctx.fillRect(0, 0, W, 420); ctx.globalAlpha = 1;

    const texto = (s, x, y, size, weight, cor, align) => {
      ctx.font = `${weight} ${size}px ${FONT}`;
      ctx.fillStyle = cor; ctx.textAlign = align || "left"; ctx.textBaseline = "alphabetic";
      ctx.fillText(s, x, y);
    };
    texto(t("portfolio.recap.title", { ano: d.ano }), 80, 150, 40, 700, "#99a3b2");
    texto(t("portfolio.recap.headline"), 80, 220, 62, 800, "#ffffff");

    // O número grande: quanto o patrimônio cresceu (ou caiu) no ano.
    const subiu = d.cresceu >= 0;
    const corDelta = subiu ? "#4ade80" : "#f87171";
    texto(money(d.para), 80, 380, 92, 800, "#ffffff");
    texto(`${subiu ? "▲" : "▼"} ${subiu ? "+" : "−"}${money(Math.abs(d.cresceu))} (${subiu ? "+" : "−"}${Math.abs(d.pct).toFixed(1)}%)`,
      80, 440, 40, 800, corDelta);
    texto(t("portfolio.recap.since", { data: d.desde }), 80, 486, 26, 600, "#7c8698");

    // Cartões de número. Só entram os que têm o que dizer — um bloco vazio num
    // print é pior do que não existir.
    const cartoes = [
      { rot: t("portfolio.recap.copies"), val: String(d.copias) },
      { rot: t("portfolio.recap.topGame"), val: d.jogoTop }
    ];
    if (d.vendas > 0) cartoes.push({ rot: tn("portfolio.invest.soldCount", d.vendas), val: money(d.vendido) });
    if (d.resultado !== 0) cartoes.push({ rot: t("portfolio.sales.realized"), val: `${d.resultado >= 0 ? "+" : "−"}${money(Math.abs(d.resultado))}`, cor: d.resultado >= 0 ? "#4ade80" : "#f87171" });

    const CW = (W - 160 - 30) / 2, CH = 190;
    cartoes.slice(0, 4).forEach((c, i) => {
      const x = 80 + (i % 2) * (CW + 30), y = 580 + Math.floor(i / 2) * (CH + 30);
      ctx.fillStyle = "#181c25";
      ctx.beginPath(); ctx.roundRect(x, y, CW, CH, 22); ctx.fill();
      texto(c.rot.toUpperCase(), x + 32, y + 62, 22, 700, "#7c8698");
      // Encolhe a fonte até o valor caber — nome de jogo longo e patrimônio de 7
      // dígitos não podem vazar do cartão.
      let fs = 52;
      ctx.font = `800 ${fs}px ${FONT}`;
      while (fs > 24 && ctx.measureText(c.val).width > CW - 64) { fs -= 2; ctx.font = `800 ${fs}px ${FONT}`; }
      texto(c.val, x + 32, y + 132, fs, 800, c.cor || "#ffffff");
    });

    texto("Sleevu · sleevu.app", 80, H - 70, 30, 700, "#7c8698");
    shared.baixarCanvasPng(canvas, `sleevu-retrospectiva-${d.ano}.png`, {
      share: true,
      onFinish: () => { if (btn) { btn.disabled = false; btn.textContent = rotulo; } }
    });
  }

  // ---- Fontes de valor (moeda atual), filtráveis por jogo --------------------

  // MEMO POR RENDER. collectionValueLines varre a coleção inteira e
  // gradedSlabsValued re-parseia o blob de graded do localStorage — e um único
  // render chamava os dois UMA VEZ POR JOGO em três lugares (composição,
  // gráfico e snapshot), ~27 varreduras completas a cada clique de filtro ou
  // troca de aba do detalhamento. Com 5 mil cartas isso é centenas de ms no
  // celular pra recalcular exatamente o mesmo número. O cache é zerado no
  // começo de cada render (e quando as cartas mudam), então nada envelhece.
  let memoLinhas = new Map();
  let memoSlabs = null;
  let snapshotGravado = false; // ponto do dia: uma vez por carga, ver updateChart
  let cargaParcial = false;    // borda devolveu menos carta do que se pediu
  function limpaMemo() { memoLinhas = new Map(); memoSlabs = null; }

  // Cada linha é um lote carta×variante×condição da coleção, com valor unitário.
  // A conta vive no shared (collectionValueLines): é a MESMA da Coleção e do Hub.
  function collectionLines(gf) {
    const chave = gf || "all";
    if (!memoLinhas.has(chave)) {
      memoLinhas.set(chave, shared.collectionValueLines(cards, owned, prices, { gameFilter: gf }));
    }
    return memoLinhas.get(chave);
  }

  function gradedSlabs(gf) {
    if (!memoSlabs) memoSlabs = shared.gradedSlabsValued(gameOf);
    return memoSlabs.filter((s) => !gf || gf === "all" || s.game === gf);
  }

  function wishlistTotal(gf) {
    let total = 0;
    cards.forEach((card) => {
      if (gf && gf !== "all" && card.game !== gf) return;
      wishlist.variants(card.id).forEach((variant) => { total += shared.cardValue(card, variant, prices).value; });
    });
    return total;
  }

  // Binders vivos (chave unificada multi-jogo; a antiga fica de reserva pra quem
  // ainda não abriu a página de binders, que é quem faz a migração).
  function lerBinders() {
    try {
      const data = JSON.parse(localStorage.getItem("tcg-collector-binders-all-v1") || localStorage.getItem("tcg-collector-binders-v1") || "null");
      const deleted = (data && data.deleted) || {};
      return (data && Array.isArray(data.binders) ? data.binders : []).filter((b) => b && !deleted[b.id]);
    } catch (error) { return []; }
  }

  // Valor de um binder em duas metades, que respondem perguntas diferentes:
  //   `tem`    = o que as cartas que você JÁ tem naquele binder valem;
  //   `falta`  = quanto custa comprar os slots vazios (o "custo pra completar",
  //              que no TCG Collector é recurso pago).
  // `semPreco` conta as cartas que ficaram de fora por não ter cotação — é o que
  // faz a soma virar um piso "≥" na tela em vez de fingir precisão.
  function valorDoBinder(binder, gf) {
    let tem = 0, falta = 0, nTem = 0, nFalta = 0, semPreco = 0;
    (binder.slots || []).forEach((slot) => {
      if (!slot || !slot.cardId) return;
      if (gf && gf !== "all" && gameOf(slot.cardId) !== gf) return;
      const card = cardsById.get(slot.cardId) || { id: slot.cardId };
      const v = shared.cardValue(card, slot.variant || "Normal", prices).value || 0;
      if (owned.has(slot.cardId)) { tem += v; nTem++; } else { falta += v; nFalta++; }
      if (!v) semPreco++;
    });
    return { tem, falta, nTem, nFalta, semPreco, slots: nTem + nFalta };
  }

  // "Desejos do binder": só a metade que FALTA, somada. Mesma função do painel
  // de binders — uma conta só, pra os dois números não divergirem.
  function binderWishTotal(gf) {
    return lerBinders().reduce((s, b) => s + valorDoBinder(b, gf).falta, 0);
  }

  // Valor de uma lista: cada entrada é carta×variante×condição×quantidade, os
  // mesmos quatro eixos da Coleção — então a conta é a MESMA (shared.cardValue).
  function valorDaLista(lista, gf) {
    let total = 0, itens = 0, semPreco = 0;
    (lista.entries || []).forEach((e) => {
      if (!e || !e.id) return;
      if (gf && gf !== "all" && gameOf(e.id) !== gf) return;
      const card = cardsById.get(e.id) || { id: e.id };
      const q = e.q == null ? 1 : Math.max(1, Number(e.q) || 1);
      const variante = e.v || shared.defaultVariant(card);
      const v = shared.cardValue(card, variante, prices, e.c || undefined).value || 0;
      itens += q;
      if (v > 0) total += v * q; else semPreco += q;
    });
    return { total, itens, semPreco };
  }

  // ---- Render ---------------------------------------------------------------

  function render() {
    limpaMemo(); // ver collectionLines: um render inteiro reusa as mesmas contas
    const { totalCopies, pricedCopies, total: rawTotal } = collectionLines(gameFilter);
    const slabs = gradedSlabs(gameFilter);
    const gradedTotal = slabs.reduce((sum, s) => sum + (s.value || 0), 0);
    networthAgora = rawTotal + gradedTotal;

    // Números frescos: substituem o retrato instantâneo e tiram o esmaecido.
    SNAP_ELS.forEach((k) => { if (elements[k]) elements[k].style.opacity = ""; });
    if (elements.grandTotal) pintaPatrimonio(networthAgora);
    if (elements.rawValue) elements.rawValue.textContent = money(rawTotal);
    if (elements.rawCopies) elements.rawCopies.textContent = tn("portfolio.kpi.copies", totalCopies);
    if (elements.gradedValue) elements.gradedValue.textContent = money(gradedTotal);
    if (elements.gradedCount) elements.gradedCount.textContent = tn("portfolio.kpi.slabs", slabs.length);
    // As duas peças fixas levam às telas das cartas (com o filtro de jogo).
    const sufixo = gameFilter !== "all" ? `?filter=${encodeURIComponent(gameFilter)}` : "";
    const linkRaw = elements.rawValue && elements.rawValue.closest("a");
    const linkGraded = elements.gradedValue && elements.gradedValue.closest("a");
    if (linkRaw) linkRaw.href = "collection" + sufixo;
    if (linkGraded) linkGraded.href = "graded" + sufixo;
    // Cobertura da avaliação: rodapé do resumo, não um cartão do tamanho do
    // patrimônio. É CONFIANÇA no número ("43 de 43 cópias com preço").
    if (elements.pricedCopies) {
      elements.pricedCopies.hidden = !totalCopies;
      elements.pricedCopies.textContent = totalCopies ? t("portfolio.coverage", { n: pricedCopies, total: totalCopies }) : "";
    }
    renderKpisExtras();
    renderAlloc();
    renderMovers();
    renderTop();
    renderInvest();
    renderGoals();
    renderManual();
    updateChart();
  }

  // Resumo: cartas e graded são fixas; as outras DUAS peças dependem de quem
  // você é. Com custo informado entra o lucro potencial; com venda, o
  // resultado. Sem os dois (a maioria), entram as peças "fora do patrimônio"
  // — desejos e selados —, pra a grade nunca ter um "—" ocupando lugar.
  function renderKpisExtras() {
    const box = elements.kpis;
    if (!box) return;
    box.querySelectorAll("[data-extra]").forEach((n) => n.remove());
    const peca = (rotulo, valorHtml, sub, href) =>
      `<a class="pf-kpi" data-extra href="${escapeAttribute(href)}"><span class="pf-kpi-label">${escapeHtml(rotulo)}</span>
        <strong class="pf-kpi-value sensitive-value">${valorHtml}</strong><small class="pf-kpi-sub">${escapeHtml(sub)}</small></a>`;
    const pecas = [];
    const { positions, invested, currentTotal } = investPositions();
    if (positions.length) {
      const pnl = currentTotal - invested;
      const pct = invested > 0 ? (pnl / invested) * 100 : 0;
      pecas.push(peca(t("portfolio.kpi.pnl"), `<span class="${cls(pnl)}">${escapeHtml(signedMoney(pnl))}</span>`,
        `${sign(pnl)}${pctTxt(pct)} · ${t("portfolio.kpi.pnlOn", { v: money(invested) })}`, "#pfInvest"));
    }
    const vs = resumoVendas();
    if (vs && vs.comCusto) {
      pecas.push(peca(t("portfolio.kpi.realized"), `<span class="${cls(vs.realizado)}">${escapeHtml(signedMoney(vs.realizado))}</span>`,
        `${tn("portfolio.invest.soldCount", vs.vendas.length)} · ${t("portfolio.kpi.roi", { pct: sign(vs.roi) + pctTxt(vs.roi, 0) })}`, "#pfInvest"));
    } else if (vs) {
      pecas.push(peca(t("portfolio.invest.sales"), escapeHtml(money(vs.liquido)), tn("portfolio.invest.soldCount", vs.vendas.length), "#pfInvest"));
    }
    const fora = [];
    const desejos = wishlistTotal(gameFilter) + binderWishTotal(gameFilter);
    if (desejos > 0) fora.push(peca(t("portfolio.kpi.wish"), escapeHtml(money(desejos)), t("portfolio.kpi.outside"), "#pfGoals"));
    const selados = manualTotal(gameFilter);
    if (selados > 0) fora.push(peca(t("pfmi.title"), escapeHtml(money(selados)), t("portfolio.kpi.outside"), "#pfManual"));
    while (pecas.length < 2 && fora.length) pecas.push(fora.shift());
    box.insertAdjacentHTML("beforeend", pecas.join(""));
    box.dataset.n = String(2 + pecas.length);
  }

  // O patrimônio ASSENTA no valor fresco em vez de trocar seco: anima do
  // retrato instantâneo (que o usuário já estava vendo) até o número novo, uma
  // vez por carga. Iguais, sem retrato ou com prefers-reduced-motion: troca
  // direta — a animação é tempero, nunca requisito.
  let patrimonioAssentou = false;
  let assentando = false; // enquanto anima, o cabeçalho do gráfico não pinta o número
  const podeAnimar = !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  function pintaPatrimonio(alvo) {
    const el = elements.grandTotal;
    const de = patrimonioAssentou ? null : snapStart;
    patrimonioAssentou = true; // trocas de filtro pintam direto: não é o mercado se mexendo
    if (de == null || !podeAnimar || Math.abs(alvo - de) < 0.01) { el.textContent = money(alvo); return; }
    const t0 = performance.now(), dur = 600;
    assentando = true;
    const passo = (agora) => {
      const p = Math.min(1, (agora - t0) / dur);
      el.textContent = money(de + (alvo - de) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(passo); else { assentando = false; el.textContent = money(networthAgora); }
    };
    requestAnimationFrame(passo);
  }

  // Variação do DIA embaixo do patrimônio — o gancho diário da corretora
  // (valor grande + quanto mexeu hoje, o padrão que o Collectr consagrou).
  // Calculada dos MESMOS pontos do gráfico (chartHistory), nunca por um segundo
  // caminho. O rótulo só diz "hoje" quando o ponto anterior é de ontem; visita
  // mais espaçada mostra a data ("variação desde …") — o número não finge ser
  // mais fresco do que é.
  function pintaDeltaDoDia(pts) {
    const el = document.getElementById("grandDelta");
    if (!el) return;
    const hoje = pts[pts.length - 1];
    const antes = pts[pts.length - 2];
    const v0 = antes ? (antes.c || 0) + (antes.b || 0) : 0;
    if (!antes || !(v0 > 0)) { el.hidden = true; el.innerHTML = ""; return; }
    const delta = ((hoje.c || 0) + (hoje.b || 0)) - v0;
    const pct = (delta / v0) * 100;
    const ontem = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const quando = antes.d >= ontem ? t("portfolio.deltaToday") : t("market.deltaSince", { date: antes.d });
    // Dinheiro no .pf-cash próprio (o modo privacidade borra SÓ ele e preserva
    // a porcentagem). O histórico é gravado em BRL — converte pra moeda do
    // header como o renderChart faz (fromBRL).
    el.innerHTML = `<span class="pf-when">${escapeHtml(quando)}</span> <span class="${cls(delta)}">${seta(delta)} <span class="pf-cash">${escapeHtml(signedMoney(fromBRL(delta)))}</span> <span class="pf-pct">(${escapeHtml(sign(pct) + pctTxt(pct))})</span></span>`;
    el.hidden = false;
  }

  // ---- Movimentos da semana (as SUAS cartas) ---------------------------------
  // Ordenados pelo EFEITO no seu bolso (variação × valor × cópias), não pelo %
  // puro: uma carta de R$ 2 que subiu 80% mexe menos no patrimônio que uma de
  // R$ 900 que subiu 5% — e é essa a pergunta desta tela. A conta é a do Hub
  // (lote × p / (100 + p): quanto do valor de HOJE veio da variação), pra os
  // dois números baterem.
  function renderMovers() {
    const sec = elements.movers;
    if (!sec) return;
    const pool = gameFilter === "all" ? GAMES : [gameFilter];
    const comDado = pool.filter((g) => deltasByGame[g]);
    if (!comDado.length) { sec.hidden = true; sec.innerHTML = ""; return; }
    let desde = null;
    comDado.forEach((g) => { const f = deltasByGame[g].from; if (f && (!desde || f < desde)) desde = f; });
    // O lote de cada carta sai das MESMAS linhas do patrimônio (valor por
    // variante × condição): uma LP não pode mexer como se fosse NM.
    const lotes = new Map();
    collectionLines(gameFilter).lines.forEach((l) => {
      const x = lotes.get(l.card.id) || { card: l.card, lote: 0, qtd: 0 };
      x.lote += l.total; x.qtd += l.quantity;
      lotes.set(l.card.id, x);
    });
    const linhas = [];
    let efeito = 0, subiram = 0, cairam = 0;
    lotes.forEach(({ card, lote, qtd }) => {
      const g = card.game || "pokemon";
      if (!deltasByGame[g] || !(lote > 0)) return;
      const p = Number(deltasByGame[g].c[card.id]);
      if (!p) return;
      const chg = (lote * p) / (100 + p);
      if (Math.abs(chg) < 0.01) return;
      efeito += chg;
      if (chg > 0) subiram++; else cairam++;
      linhas.push({ card, p, chg, qtd });
    });
    const sub = desde ? t("portfolio.moves.sub", { date: diaCurto(desde) }) : "";
    if (!linhas.length) {
      sec.innerHTML = cabecalho(t("portfolio.moves.title"), sub) + `<p class="pf-empty">${escapeHtml(t("portfolio.movers.noneMine"))}</p>`;
      sec.hidden = false;
      return;
    }
    linhas.sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg));
    const LIM = 5;
    const visiveis = aberta.movers ? linhas.slice(0, 30) : linhas.slice(0, LIM);
    const loc = getLocale();
    const resumo = `<p class="pf-moves-sum"><strong class="${cls(efeito)}"><span class="sensitive-value">${escapeHtml(signedMoney(efeito))}</span></strong>
      <span>${escapeHtml(t("portfolio.moves.net"))}</span>
      <span class="pf-moves-count"><span class="is-up">▲ ${subiram}</span> <span class="is-down">▼ ${cairam}</span></span></p>`;
    const corpo = visiveis.map(({ card, p, chg, qtd }) => linhaCarta({
      card,
      sub: shared.dotJoin(card.set, card.number) + (qtd > 1 ? ` · ×${qtd}` : ""),
      valor: `<strong class="${cls(chg)}"><span class="sensitive-value">${escapeHtml(signedMoney(chg))}</span></strong>`,
      apoio: `${p > 0 ? "▲" : "▼"} ${escapeHtml(Math.abs(p).toLocaleString(loc, { maximumFractionDigits: 1 }))}%`,
      apoioCls: cls(p)
    })).join("");
    sec.innerHTML = cabecalho(t("portfolio.moves.title"), sub) + resumo
      + `<ul class="pf-rows">${corpo}</ul>`
      + (linhas.length > LIM ? botaoMais("movers", linhas.length - LIM, aberta.movers) : "");
    sec.hidden = false;
  }

  // --- Investimento (opcional): só tem número pra quem preenche custo ou vende ---
  // Posições abertas (custo preenchido + carta ainda na coleção). Fica FORA do
  // renderInvest porque o resumo lá em cima também mostra o lucro potencial:
  // duas somas separadas divergiriam mais cedo ou mais tarde — é a mesma razão
  // de o patrimônio ter uma fórmula só.
  function investPositions() {
    const inG = (id) => gameFilter === "all" || gameOf(id) === gameFilter;
    const positions = [];
    let invested = 0, currentTotal = 0;
    costsStore.entries().forEach((e) => {
      if (!inG(e.cardId)) return;
      const card = cardsById.get(e.cardId);
      const qty = owned.variantTotal(e.cardId, e.variant);
      if (!card || qty <= 0) return;
      const paidUnit = shared.moneyToCurrent(e.v, e.cur);
      let now = 0;
      owned.conditionBreakdown(e.cardId, e.variant).forEach(({ condition, quantity }) => {
        now += (shared.cardValue(card, e.variant, prices, condition).value || 0) * quantity;
      });
      const paid = paidUnit * qty;
      positions.push({ card, variant: e.variant, qty, paid, now, delta: now - paid });
      invested += paid; currentTotal += now;
    });
    return { positions, invested, currentTotal };
  }

  // Vendas (o que já virou dinheiro). As contas de UMA venda vivem no shared
  // (soldValues: líquido = preço − taxa; resultado = líquido − pago, com o BRL
  // congelado na data); aqui só se soma. Mesma razão do investPositions: o
  // resumo lá em cima e a seção leem a mesma função.
  function resumoVendas() {
    const inG = (id) => gameFilter === "all" || gameOf(id) === gameFilter;
    const vendas = soldStore.list().filter((it) => inG(it.cardId));
    if (!vendas.length) return null;
    let bruto = 0, taxas = 0, realizado = 0, comCusto = 0, pagoNasComCusto = 0, melhor = null;
    vendas.forEach((it) => {
      const v = shared.soldValues(it);
      bruto += v.price; taxas += v.fee;
      if (v.hasCost) {
        realizado += v.pnl; comCusto++; pagoNasComCusto += v.paid;
        if (!melhor || v.pnl > melhor.pnl) melhor = { pnl: v.pnl, it };
      }
    });
    // ROI sobre o que foi PAGO nas vendas com custo — só faz sentido nesse
    // subconjunto, que é o mesmo do resultado realizado.
    const roi = pagoNasComCusto > 0 ? (realizado / pagoNasComCusto) * 100 : 0;
    return { vendas, bruto, taxas, liquido: bruto - taxas, realizado, comCusto, melhor, roi };
  }

  // Faixa de números de uma seção (Pago | Atual | Lucro…).
  const numeros = (itens) => `<div class="pf-stats">${itens.map(({ rotulo, valor, extra, klass }) =>
    `<div class="pf-stat"><span>${escapeHtml(rotulo)}</span><strong class="${klass || ""}"><span class="sensitive-value">${valor}</span></strong>${extra ? `<small>${extra}</small>` : ""}</div>`).join("")}</div>`;

  // Posições (o que você TEM, com lucro potencial) e Vendas (o que já virou
  // dinheiro, com resultado realizado) são abas da mesma seção: "potencial" ×
  // "realizado" é a distinção que todo app de investimento separa (o Card
  // Ladder chama a primeira de "Potential Profit" justamente pra fugir de
  // "não realizado"). Sem nenhum dos dois, a seção EXPLICA como ligar — o
  // modo investidor era invisível pra quem nunca achou o campo "Paguei".
  function renderInvest() {
    const sec = elements.invest;
    if (!sec) return;
    const pos = investPositions();
    const vs = resumoVendas();
    const temPos = pos.positions.length > 0;
    if (!temPos && !vs) {
      sec.innerHTML = cabecalho(t("portfolio.invest.title"))
        + `<p class="pf-empty">${escapeHtml(t("portfolio.invest.empty"))} <a href="collection">${escapeHtml(t("portfolio.invest.emptyCta"))}</a></p>`;
      sec.hidden = false;
      return;
    }
    const opcoes = [];
    if (temPos) opcoes.push(["positions", t("portfolio.invest.positions")]);
    if (vs) opcoes.push(["sales", t("portfolio.invest.sales")]);
    if (!opcoes.some(([k]) => k === aba.invest)) aba.invest = opcoes[0][0];
    let corpo = "";
    if (aba.invest === "positions") {
      const pnl = pos.currentTotal - pos.invested;
      const pct = pos.invested > 0 ? (pnl / pos.invested) * 100 : 0;
      corpo += numeros([
        { rotulo: t("portfolio.invest.paid"), valor: escapeHtml(money(pos.invested)) },
        { rotulo: t("portfolio.invest.now"), valor: escapeHtml(money(pos.currentTotal)) },
        { rotulo: t("portfolio.kpi.pnl"), valor: escapeHtml(signedMoney(pnl)), extra: escapeHtml(sign(pnl) + pctTxt(pct)), klass: cls(pnl) }
      ]);
      // Quanto da coleção TEM custo informado. Sem isso o lucro parece o da
      // coleção inteira, quando é só o das cartas em que você anotou o
      // "Paguei" — a pesquisa de 2026-10 não achou concorrente que diga isso.
      const { totalCopies, total: rawTotal } = collectionLines(gameFilter);
      const comCusto = pos.positions.reduce((n, p) => n + p.qty, 0);
      if (comCusto < totalCopies) {
        corpo += `<p class="pf-coverage">${escapeHtml(t("portfolio.invest.costCoverage", {
          n: comCusto, total: totalCopies, pct: rawTotal > 0 ? Math.round((pos.currentTotal / rawTotal) * 100) : 0
        }))}</p>`;
      }
      const lista = pos.positions.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      const LIM = 6;
      const visiveis = aberta.invest ? lista : lista.slice(0, LIM);
      corpo += `<ul class="pf-rows">${visiveis.map((p) => {
        const dPct = p.paid > 0 ? (p.delta / p.paid) * 100 : 0;
        return linhaCarta({
          card: p.card,
          sub: `${p.variant} · ×${p.qty} · ${t("pfmi.paid", { v: money(p.paid) })}`,
          valor: `<strong><span class="sensitive-value">${escapeHtml(money(p.now))}</span></strong>`,
          apoio: `<span class="sensitive-value">${escapeHtml(signedMoney(p.delta))}</span> (${escapeHtml(sign(p.delta) + pctTxt(dPct, 0))})`,
          apoioCls: cls(p.delta)
        });
      }).join("")}</ul>`;
      if (lista.length > LIM) corpo += botaoMais("invest", lista.length - LIM, aberta.invest);
    } else {
      const itens = [{ rotulo: t("portfolio.sales.gross"), valor: escapeHtml(money(vs.bruto)), extra: escapeHtml(tn("portfolio.invest.soldCount", vs.vendas.length)) }];
      if (vs.taxas > 0) itens.push({ rotulo: t("portfolio.sales.fees"), valor: `− ${escapeHtml(money(vs.taxas))}`, extra: escapeHtml(t("portfolio.sales.net", { v: money(vs.liquido) })) });
      if (vs.comCusto) itens.push({ rotulo: t("portfolio.sales.realized"), valor: escapeHtml(signedMoney(vs.realizado)), extra: escapeHtml(t("portfolio.sales.roi", { pct: `${sign(vs.roi)}${Math.abs(vs.roi).toFixed(0)}` })), klass: cls(vs.realizado) });
      if (vs.melhor) {
        const card = cardsById.get(vs.melhor.it.cardId);
        itens.push({ rotulo: t("portfolio.sales.best"), valor: `+${escapeHtml(money(vs.melhor.pnl))}`, extra: escapeHtml(card ? card.name : ""), klass: "is-up" });
      }
      corpo += numeros(itens);
      // COBERTURA: dizer quantas vendas entram no resultado, e dar o caminho pra
      // corrigir. É o padrão "flag-then-fix" (Quicken, CoinLedger): nunca chutar
      // um custo em silêncio, nunca deixar o usuário achar que o número cobre tudo.
      if (vs.comCusto < vs.vendas.length) {
        corpo += `<p class="pf-coverage">${escapeHtml(t("portfolio.sales.coverage", { n: vs.comCusto, total: vs.vendas.length }))}
          <a href="sales">${escapeHtml(t("portfolio.sales.fixCosts"))}</a></p>`;
      }
      corpo += renderVendasPorMes(vs.vendas);
    }
    sec.innerHTML = cabecalho(t("portfolio.invest.title"), "", `<a class="pf-sec-link" href="sales">${escapeHtml(t("portfolio.invest.openSales"))}</a>`)
      + abas("invest", opcoes, aba.invest) + corpo;
    sec.hidden = false;
  }

  // Barras de venda por mês (12 meses) — responde "quanto eu vendi este ano?"
  // sem exportar CSV. Usa o LÍQUIDO, que é o que entrou de verdade.
  function renderVendasPorMes(vendas) {
    const agora = new Date();
    const meses = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
      meses.push({ chave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, d, v: 0 });
    }
    const porChave = new Map(meses.map((m) => [m.chave, m]));
    let noAno = 0;
    vendas.forEach((it) => {
      const chave = String(it.date || "").slice(0, 7);
      const alvo = porChave.get(chave);
      const v = shared.soldValues(it);
      if (alvo) alvo.v += v.net;
      if (String(it.date || "").slice(0, 4) === String(agora.getFullYear())) noAno += v.net;
    });
    if (!meses.some((m) => m.v > 0)) return "";
    const max = Math.max(...meses.map((m) => m.v));
    const loc = getLocale();
    const nomeMes = (d) => d.toLocaleDateString(loc, { month: "short" }).replace(".", "");
    // Barras em HTML (não SVG): são 12 blocos com rótulo, e o CSS já sabe
    // posicionar isso melhor do que coordenadas fixas num viewBox.
    const barras = meses.map((m) => {
      const alt = max > 0 ? Math.max(2, Math.round((m.v / max) * 100)) : 2;
      const titulo = `${nomeMes(m.d)} · ${money(m.v)}`;
      return `<span class="pf-mbar" title="${escapeAttribute(titulo)}">
        <span class="pf-mbar-fill" style="height:${alt}%"></span>
        <span class="pf-mbar-lbl">${escapeHtml(nomeMes(m.d))}</span></span>`;
    }).join("");
    return `<div class="pf-months">
        <div class="pf-months-head"><strong>${escapeHtml(t("portfolio.sales.byMonth"))}</strong>
          <span class="sensitive-value">${escapeHtml(t("portfolio.sales.thisYear", { v: money(noAno) }))}</span></div>
        <div class="pf-mbars">${barras}</div>
      </div>`;
  }

  // ---- Metas: desejos + pastas e binders (FORA do patrimônio) ---------------
  // O total tem que bater com a Coleção no centavo, então nada aqui soma lá em
  // cima — a seção diz isso no próprio cabeçalho, porque é a primeira pergunta
  // de quem vê os números. "Custo pra completar" um binder é o recurso que o
  // TCG Collector cobra; aqui sai junto e ainda serve as listas de compra.
  function linhasDeDesejo() {
    const linhas = [];
    cards.forEach((card) => {
      if (gameFilter !== "all" && card.game !== gameFilter) return;
      wishlist.variants(card.id).forEach((variante) => {
        const valor = shared.cardValue(card, variante, prices).value || 0;
        const alvo = wishTargets.get(card.id);
        linhas.push({ card, variante, valor, alvo: alvo ? shared.convertMoney(alvo.v, alvo.cur || "BRL", shared.getCurrency()) : null });
      });
    });
    return linhas.sort((a, b) => b.valor - a.valor);
  }
  function linhasDeListas() {
    const linhas = [];
    listStore.list().forEach((l) => {
      const { total, itens, semPreco } = valorDaLista(l, gameFilter);
      if (!itens) return; // lista vazia, ou toda de outro jogo que o filtro cortou
      linhas.push({
        nome: l.name || t("lists.untitled"), cor: l.color || "var(--accent)",
        // Abre a PASTA (a página é pastas?id=).
        href: `pastas?id=${encodeURIComponent(l.id)}`,
        meta: tn("portfolio.lists.cards", itens), total, semPreco
      });
    });
    lerBinders().forEach((b) => {
      const v = valorDoBinder(b, gameFilter);
      if (!v.slots) return;
      linhas.push({
        // `lists.untitled` e não `binders.new`: aquela vive no pacote i18n dos
        // binders, que esta página não carrega (o check.mjs pega isso).
        nome: b.name || t("lists.untitled"), cor: b.color || "#8b5cf6",
        href: `binders#${encodeURIComponent(b.id)}`,
        meta: t("portfolio.lists.slots", { tem: v.nTem, total: v.slots }),
        total: v.tem, semPreco: v.semPreco, completar: v.falta
      });
    });
    return linhas.sort((a, b) => b.total - a.total);
  }
  function renderGoals() {
    const sec = elements.goals;
    if (!sec) return;
    const desejos = linhasDeDesejo();
    const listas = linhasDeListas();
    const wishOnly = wishlistTotal(gameFilter);
    const binderGap = binderWishTotal(gameFilter);
    if (!desejos.length && !listas.length) { sec.hidden = true; sec.innerHTML = ""; return; }
    const opcoes = [];
    if (desejos.length || binderGap > 0) opcoes.push(["wish", t("portfolio.bd.wish")]);
    if (listas.length) opcoes.push(["lists", t("portfolio.lists.title")]);
    if (!opcoes.some(([k]) => k === aba.goals)) aba.goals = opcoes[0][0];
    const total = wishOnly + binderGap;
    const direita = total > 0 ? `<strong class="pf-sec-total"><span class="sensitive-value">${escapeHtml(money(total))}</span></strong>` : "";
    let corpo = "";
    if (aba.goals === "wish") {
      // Desejos vinham somados num número só e ninguém sabia o que era o quê —
      // "R$ 890" pode ser wishlist inteira ou buraco de binder, e as duas coisas
      // levam a ações diferentes. A abertura só aparece com as duas metades.
      if (wishOnly > 0 && binderGap > 0) {
        corpo += `<p class="pf-split sensitive-value">${escapeHtml(`${t("portfolio.wish.list")} ${money(wishOnly)} · ${t("portfolio.wish.binder")} ${money(binderGap)}`)}</p>`;
      }
      if (!desejos.length) corpo += `<p class="pf-empty">${escapeHtml(t("portfolio.bd.wishNone"))}</p>`;
      const LIM = 5;
      const visiveis = aberta.goals ? desejos.slice(0, 60) : desejos.slice(0, LIM);
      corpo += `<ul class="pf-rows">${visiveis.map((r) => {
        // Alvo já batido = oportunidade agora; senão mostra a distância que falta.
        let alvo = "", alvoCls = "";
        if (r.alvo != null && r.alvo > 0) {
          const bateu = r.valor > 0 && r.valor <= r.alvo;
          const falta = r.valor > 0 ? ((r.valor - r.alvo) / r.valor) * 100 : 0;
          alvo = bateu ? t("portfolio.bd.wishHit", { v: money(r.alvo) }) : t("portfolio.bd.wishTarget", { v: money(r.alvo), pct: Math.round(falta) });
          alvoCls = bateu ? "is-up" : "";
        }
        return linhaCarta({
          card: r.card,
          sub: shared.dotJoin(r.card.set, r.variante),
          valor: `<strong><span class="sensitive-value">${escapeHtml(r.valor > 0 ? money(r.valor) : "—")}</span></strong>`,
          apoio: alvo ? escapeHtml(alvo) : "",
          apoioCls: alvoCls
        });
      }).join("")}</ul>`;
      if (desejos.length > LIM) corpo += botaoMais("goals", desejos.length - LIM, aberta.goals);
    } else {
      corpo += `<ul class="pf-rows">${listas.map((r) => {
        // "≥" quando alguma carta ficou sem cotação: a soma é um PISO. Dizer isso é
        // mais útil que um número redondo que o usuário não consegue auditar.
        const piso = r.semPreco > 0
          ? `<span class="pf-list-floor" title="${escapeAttribute(tn("portfolio.lists.noPrice", r.semPreco))}">≥</span> ` : "";
        const completar = r.completar > 0
          ? `<small class="pf-list-gap"><span class="sensitive-value">${escapeHtml(t("portfolio.lists.toComplete", { v: money(r.completar) }))}</span></small>` : "";
        return `<li><a class="pf-row pf-list-row" href="${escapeAttribute(r.href)}">
          <span class="pf-list-dot" style="background:${escapeAttribute(r.cor)}"></span>
          <span class="pf-row-main"><strong>${escapeHtml(r.nome)}</strong><span class="pf-row-sub">${escapeHtml(r.meta)}</span></span>
          <span class="pf-row-end"><strong>${piso}<span class="sensitive-value">${escapeHtml(money(r.total))}</span></strong>${completar}</span>
        </a></li>`;
      }).join("")}</ul>`;
    }
    sec.innerHTML = cabecalho(t("portfolio.goals.title"), t("portfolio.kpi.outside"), direita)
      + abas("goals", opcoes, aba.goals) + corpo;
    sec.hidden = false;
  }
  // ── Selados e itens MANUAIS (F4 do PLANO-UX) ───────────────────────────────
  // Booster box, ETB, lata ou item fora do catálogo, com preço 100% manual.
  // FORA do patrimônio de propósito (a nota na tela diz): somar tocaria a
  // fórmula única "Portfólio = Coleção no centavo", decisão do Fernando.
  const manualStore = shared.createManualItemsStore();
  // Aceita "1.234,56" (pt) e "1234.56" (en): vírgula presente decide o papel
  // do ponto.
  const numDeTexto = (s) => {
    let x = String(s || "").trim();
    if (x.includes(",")) x = x.replace(/\./g, "").replace(",", ".");
    const v = parseFloat(x);
    return isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0;
  };
  const manuaisDoFiltro = (gf) => {
    const todos = manualStore.list();
    return !gf || gf === "all" ? todos : todos.filter((x) => (x.g || "") === gf);
  };
  const totalDoManual = (x) => shared.moneyToCurrent(x.v, x.cur) * (Number(x.q) || 1);
  function manualTotal(gf) {
    return manuaisDoFiltro(gf).reduce((s, x) => s + totalDoManual(x), 0);
  }
  // Lápis de editar em SVG (traço, currentColor), como o X de remover — era o
  // glifo ✎, que cada sistema desenha de um jeito.
  const LAPIS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>';
  function renderManual() {
    const sec = document.getElementById("pfManual");
    if (!sec) return;
    const itens = manuaisDoFiltro(gameFilter);
    const linha = (x) => {
      const cor = GAME_COLOR[x.g] || "#8b93a7";
      const jogo = x.g
        ? `<span class="pf-mi-game" style="--gc:${cor};--gc-fg:${shared.textOnColor(cor)}">${escapeHtml(shared.gameLabel(x.g))}</span>`
        : "";
      const pago = Number(x.c) > 0
        ? `<span class="pf-mi-cost sensitive-value">${escapeHtml(t("pfmi.paid", { v: money(shared.moneyToCurrent(x.c, x.ccur) * (Number(x.q) || 1)) }))}</span>`
        : "";
      return `<li class="pf-mi-row" data-mi-id="${escapeAttribute(x.id)}">
        <span class="pf-row-main"><strong>${escapeHtml(x.n)}</strong><span class="pf-row-sub">${jogo}<span>×${Number(x.q) || 1}</span>${pago}</span></span>
        <strong class="pf-mi-val sensitive-value">${escapeHtml(money(totalDoManual(x)))}</strong>
        <span class="pf-mi-actions">
          <button type="button" class="pf-mi-btn" data-mi-edit title="${escapeAttribute(t("pfmi.edit"))}" aria-label="${escapeAttribute(t("pfmi.edit"))}">${LAPIS}</button>
          <button type="button" class="pf-mi-btn" data-mi-remove title="${escapeAttribute(t("pfmi.remove"))}" aria-label="${escapeAttribute(t("pfmi.remove"))}">${shared.CLOSE_ICON}</button>
        </span>
      </li>`;
    };
    const totalGeral = itens.reduce((s, x) => s + totalDoManual(x), 0);
    const direita = itens.length ? `<strong class="pf-sec-total"><span class="sensitive-value">${escapeHtml(money(totalGeral))}</span></strong>` : "";
    sec.innerHTML = cabecalho(t("pfmi.title"), t("portfolio.kpi.outside"), direita)
      + (itens.length
        ? `<ul class="pf-rows pf-mi-rows">${itens.map(linha).join("")}</ul>`
        : `<p class="pf-empty">${escapeHtml(t("pfmi.empty"))}</p>`)
      + `<div class="pf-mi-foot"><button type="button" class="secondary pf-mi-add" data-mi-add>${escapeHtml(t("pfmi.add"))}</button>
        <p class="pf-mi-note">${escapeHtml(t("pfmi.note"))}</p></div>`;
  }
  function abreManualModal(id) {
    const it = id ? manualStore.get(id) : null;
    const old = document.querySelector(".pfmi-modal");
    if (old) old.remove();
    const wrap = document.createElement("div");
    wrap.className = "ts-modal pfmi-modal";
    const fmtNum = (v) => (Number(v) > 0 ? String(Math.round(Number(v) * 100) / 100).replace(".", ",") : "");
    const opcoes = ['<option value="">—</option>']
      .concat(GAMES.map((g) => `<option value="${g}"${it && it.g === g ? " selected" : ""}>${escapeHtml(shared.gameLabel(g))}</option>`)).join("");
    const cur = shared.getCurrency();
    wrap.innerHTML = `<div class="ts-backdrop" data-pfmi-close></div>
      <div class="ts-panel">
        <h3>${escapeHtml(t(it ? "pfmi.edit" : "pfmi.add2"))}</h3>
        <div class="pf-mi-form">
          <label>${escapeHtml(t("pfmi.name"))}<input type="text" id="pfmiName" maxlength="80" value="${escapeAttribute(it ? it.n : "")}"></label>
          <label>${escapeHtml(t("pfmi.game"))}<select id="pfmiGame">${opcoes}</select></label>
          <label>${escapeHtml(t("pfmi.qty"))}<input type="number" id="pfmiQty" min="1" step="1" value="${it ? Number(it.q) || 1 : 1}"></label>
          <label>${escapeHtml(t("pfmi.value", { cur }))}<input type="text" inputmode="decimal" id="pfmiVal" value="${escapeAttribute(it ? fmtNum(shared.moneyToCurrent(it.v, it.cur)) : "")}"></label>
          <label>${escapeHtml(t("pfmi.cost", { cur }))}<input type="text" inputmode="decimal" id="pfmiCost" value="${escapeAttribute(it && Number(it.c) > 0 ? fmtNum(shared.moneyToCurrent(it.c, it.ccur)) : "")}"></label>
        </div>
        <div class="ts-actions">
          <button type="button" class="secondary" data-pfmi-close>${escapeHtml(t("pfmi.cancel"))}</button>
          <button type="button" class="primary" data-pfmi-save>${escapeHtml(t("pfmi.save"))}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", (e) => {
      if (e.target.closest("[data-pfmi-close]")) { wrap.remove(); return; }
      if (!e.target.closest("[data-pfmi-save]")) return;
      const nome = (document.getElementById("pfmiName").value || "").trim();
      const valor = numDeTexto(document.getElementById("pfmiVal").value);
      if (!nome || !(valor > 0)) return; // nome + valor são o mínimo de um item
      // Editar regrava na moeda ATUAL (o campo mostra o valor já convertido) —
      // mesmo contrato do custo pago por carta.
      const patch = {
        n: nome,
        g: document.getElementById("pfmiGame").value || "",
        q: Math.max(1, parseInt(document.getElementById("pfmiQty").value, 10) || 1),
        v: valor, cur,
        c: numDeTexto(document.getElementById("pfmiCost").value), ccur: cur
      };
      if (it && id) manualStore.update(id, patch);
      else manualStore.add(Object.assign({ t: Date.now() }, patch));
      wrap.remove();
      renderManual();
      renderKpisExtras(); // a peça "Selados" do resumo pode ter nascido ou mudado
    });
  }
  (function bindManual() {
    const sec = document.getElementById("pfManual");
    if (!sec) return;
    sec.addEventListener("click", (e) => {
      if (e.target.closest("[data-mi-add]")) { abreManualModal(null); return; }
      const row = e.target.closest("[data-mi-id]");
      if (!row) return;
      if (e.target.closest("[data-mi-edit]")) { abreManualModal(row.dataset.miId); return; }
      if (e.target.closest("[data-mi-remove]")) {
        const item = manualStore.get(row.dataset.miId);
        if (!item) return;
        // Mesmo raciocínio do deck: apaga na hora e dá 6s pra voltar. O item
        // manual é digitado à mão, então perdê-lo por engano custa retrabalho —
        // e é justamente por isso que o desfazer serve melhor que o confirm.
        const undo = shared.snapshotKeys([manualStore.STORAGE_KEY]);
        manualStore.remove(row.dataset.miId);
        renderManual();
        if (cards.length) renderKpisExtras();
        shared.toastUndo(t("undo.manualRemoved"), undo);
      }
    });
    renderManual(); // independe do catálogo: aparece já no primeiro paint
  })();

  // ---- Onde está o valor -----------------------------------------------------
  // Era três blocos com três desenhos (composição por tipo, barras por jogo e o
  // detalhamento por set/raridade/artista). Virou UMA seção com abas: a mesma
  // pergunta ("onde está o meu dinheiro?") cortada de cinco jeitos, com a barra
  // empilhada no topo e as linhas com a fatia em % — o formato do "Onde está o
  // valor" do Hub, pra quem vem de lá reconhecer.
  // Paleta das fatias que não são jogo (set, raridade, artista): 8 tons que se
  // distinguem nos dois temas; da 9ª fatia em diante tudo vira "Outros", cinza.
  const PALETA = ["#5b8def", "#2dd4bf", "#e8c46a", "#f472b6", "#a78bfa", "#fb923c", "#4ade80", "#38bdf8"];
  // Agrega valor (cartas raw + slabs graded) e cópias por uma chave da carta.
  function fatiasPor(lines, slabs, keyFn) {
    const map = new Map();
    const soma = (k, v, n) => { const f = map.get(k) || { label: k, value: 0, n: 0 }; f.value += v; f.n += n; map.set(k, f); };
    lines.forEach((l) => { const k = keyFn(l.card); if (k) soma(k, l.total, l.quantity); });
    slabs.forEach((s) => { const c = cardsById.get(s.cardId); if (!c || !(s.value > 0)) return; const k = keyFn(c); if (k) soma(k, s.value, 1); });
    return Array.from(map.values()).filter((f) => f.value > 0).sort((a, b) => b.value - a.value);
  }
  function fatiasPorJogo() {
    return GAMES.map((g) => {
      const l = collectionLines(g), sl = gradedSlabs(g);
      return {
        label: shared.gameLabel(g), color: GAME_COLOR[g], game: g,
        value: l.total + sl.reduce((s, x) => s + (x.value || 0), 0),
        n: l.totalCopies + sl.length
      };
    }).filter((f) => f.value > 0).sort((a, b) => b.value - a.value);
  }
  function renderAlloc() {
    const sec = elements.alloc;
    if (!sec) return;
    const { lines, total: rawTotal, totalCopies } = collectionLines(gameFilter);
    const slabs = gradedSlabs(gameFilter);
    const gradedTotal = slabs.reduce((s, x) => s + (x.value || 0), 0);
    const total = rawTotal + gradedTotal;
    if (!(total > 0)) { sec.hidden = true; sec.innerHTML = ""; return; }
    const porJogo = gameFilter === "all" ? fatiasPorJogo() : [];
    const opcoes = [];
    // "Jogo" só no filtro Todos e com 2+ jogos: com um só, a barra seria 100%.
    if (porJogo.length > 1) opcoes.push(["game", t("portfolio.alloc.game")]);
    if (slabs.some((s) => s.value > 0) && rawTotal > 0) opcoes.push(["type", t("portfolio.alloc.type")]);
    opcoes.push(["set", t("portfolio.alloc.set")], ["rarity", t("portfolio.alloc.rarity")], ["artist", t("portfolio.alloc.artist")]);
    if (!opcoes.some(([k]) => k === aba.alloc)) aba.alloc = opcoes[0][0];
    let fatias;
    if (aba.alloc === "game") fatias = porJogo;
    else if (aba.alloc === "type") {
      fatias = [
        { label: t("portfolio.series.collection"), value: rawTotal, n: totalCopies, color: "#2dd4bf" },
        { label: t("portfolio.series.graded"), value: gradedTotal, n: slabs.length, color: "#e8c46a" }
      ].filter((f) => f.value > 0);
    } else {
      const chave = aba.alloc === "rarity" ? (c) => c.rarity : aba.alloc === "artist" ? (c) => c.artist : (c) => c.set;
      fatias = fatiasPor(lines, slabs, chave);
    }
    fatias.forEach((f, i) => { if (!f.color) f.color = i < PALETA.length ? PALETA[i] : "var(--subtle)"; });
    const loc = getLocale();
    const pctDe = (v) => {
      const p = (v / total) * 100;
      // Fatia minúscula não é "0%": ela existe, só não chega a 0,1%.
      if (p > 0 && p < 0.1) return "<" + (0.1).toLocaleString(loc) + "%";
      return (p >= 10 ? Math.round(p) : p.toLocaleString(loc, { maximumFractionDigits: 1 })) + "%";
    };
    // A soma das fatias pode ficar abaixo do total (carta sem raridade, slab sem
    // carta no catálogo): a barra é proporcional ao TOTAL, e o que não tem
    // chave fica de fora em vez de esticar as outras.
    const LIM = 6;
    const visiveis = aberta.alloc ? fatias.slice(0, 40) : fatias.slice(0, LIM);
    const resto = fatias.slice(visiveis.length);
    const restoValor = resto.reduce((s, f) => s + f.value, 0);
    const naBarra = fatias.slice(0, PALETA.length);
    const barraResto = fatias.slice(PALETA.length).reduce((s, f) => s + f.value, 0);
    const barra = `<div class="pf-alloc-bar" aria-hidden="true">${naBarra.map((f) =>
      `<span style="width:${((f.value / total) * 100).toFixed(2)}%;background:${f.color}" title="${escapeAttribute(`${f.label} · ${pctDe(f.value)}`)}"></span>`).join("")}${barraResto > 0 ? `<span style="width:${((barraResto / total) * 100).toFixed(2)}%;background:var(--line)"></span>` : ""}</div>`;
    const miolo = (f) => `<span class="pf-dot" style="background:${f.color}"></span>
      <span class="pf-alloc-name" title="${escapeAttribute(f.label)}">${escapeHtml(f.label)}</span>
      <span class="pf-alloc-n">${escapeHtml(tn("portfolio.kpi.copies", f.n))}</span>
      <span class="pf-alloc-pct">${pctDe(f.value)}</span>
      <span class="pf-alloc-val sensitive-value">${escapeHtml(money(f.value))}</span>`;
    // Jogo -> aplica o filtro (a pergunta seguinte a "quanto é Magic?" é "me
    // mostra o Magic"); set -> Coleção já filtrada naquele set. Raridade e
    // artista não têm filtro equivalente na Coleção e ficam estáticos.
    const linha = (f) => {
      if (aba.alloc === "game") {
        return `<li><button type="button" class="pf-alloc-row" data-comp-game="${escapeAttribute(f.game)}" title="${escapeAttribute(t("portfolio.comp.filterHint", { game: f.label }))}">${miolo(f)}</button></li>`;
      }
      if (aba.alloc === "set") {
        const params = new URLSearchParams({ set: f.label });
        if (gameFilter !== "all") params.set("filter", gameFilter);
        return `<li><a class="pf-alloc-row" href="collection?${params.toString()}" title="${escapeAttribute(t("portfolio.bd.openSet", { set: f.label }))}">${miolo(f)}</a></li>`;
      }
      return `<li><div class="pf-alloc-row">${miolo(f)}</div></li>`;
    };
    let corpo;
    if (!fatias.length) corpo = `<p class="pf-empty">${escapeHtml(t("portfolio.bd.none"))}</p>`;
    else {
      const outros = resto.length
        ? `<li><div class="pf-alloc-row is-rest">${miolo({ label: t("portfolio.alloc.others", { n: resto.length }), value: restoValor, n: resto.reduce((s, f) => s + f.n, 0), color: "var(--line)" })}</div></li>`
        : "";
      corpo = barra + `<ul class="pf-alloc-list">${visiveis.map(linha).join("")}${outros}</ul>`
        + (fatias.length > LIM ? botaoMais("alloc", fatias.length - LIM, aberta.alloc) : "");
    }
    sec.innerHTML = cabecalho(t("portfolio.alloc.title")) + abas("alloc", opcoes, aba.alloc) + corpo;
    sec.hidden = false;
  }

  // ---- Cartas mais valiosas ---------------------------------------------------
  // Raw + graded juntos, por valor do lote/slab. Era uma tabela de seis colunas
  // que no celular rolava de lado; agora é a lista com a arte, e o lote
  // (variante, condição, nota) vira etiqueta. A concentração ("as 10 mais
  // valiosas são 82% do patrimônio") é o dado de risco que nenhum concorrente
  // mostra: diz o quanto o seu patrimônio depende de poucas cartas.
  function linhasDoTopo() {
    const { lines } = collectionLines(gameFilter);
    const rows = lines.map((line) => ({
      card: line.card,
      tags: [line.variant, line.condition],
      estTitle: line.source === "ref" ? t("portfolio.estRef") : line.source === "myp" ? t("portfolio.estMyp") : t("portfolio.estimated"),
      estimated: line.estimated,
      qty: line.quantity, unit: line.unit, total: line.total
    }));
    gradedSlabs(gameFilter).forEach((s) => {
      const card = cardsById.get(s.cardId);
      if (!card || !(s.value > 0)) return;
      rows.push({
        card, grade: `${String(s.company || "").toUpperCase()} ${shared.gradedGradeText(s.grade, s.pristine)}`,
        estimated: false, qty: 1, unit: s.value, total: s.value
      });
    });
    return rows.filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
  }
  function renderTop() {
    const sec = elements.top;
    if (!sec) return;
    const rows = linhasDoTopo();
    elements.empty.hidden = rows.length > 0;
    if (!rows.length) { sec.hidden = true; sec.innerHTML = ""; return; }
    const total = rows.reduce((s, r) => s + r.total, 0);
    const LIM = 10;
    const visiveis = aberta.top ? rows.slice(0, 200) : rows.slice(0, LIM);
    let sub = "";
    if (rows.length > LIM && total > 0) {
      const topo = rows.slice(0, LIM).reduce((s, r) => s + r.total, 0);
      sub = t("portfolio.top.share", { n: LIM, pct: Math.round((topo / total) * 100) });
    }
    const corpo = visiveis.map((r, i) => {
      const tags = r.grade
        ? `<span class="pf-tag pf-tag-grade">${escapeHtml(r.grade)}</span>`
        : r.tags.filter(Boolean).map((x) => `<span class="pf-tag">${escapeHtml(x)}</span>`).join("");
      const est = r.estimated ? ` <span class="price-estimated" title="${escapeAttribute(r.estTitle)}">≈</span>` : "";
      return linhaCarta({
        card: r.card, rank: i + 1, tags,
        valor: `<strong><span class="sensitive-value">${escapeHtml(money(r.total))}</span>${est}</strong>`,
        apoio: r.qty > 1
          ? `×${r.qty} · <span class="sensitive-value">${escapeHtml(t("portfolio.top.each", { v: money(r.unit) }))}</span>`
          : escapeHtml(t("portfolio.top.ofTotal", { pct: pctTxt((r.total / total) * 100) }))
      });
    }).join("");
    sec.innerHTML = cabecalho(t("portfolio.topCards"), sub)
      // --pf-linhas: no desktop largo a lista vira duas colunas que enchem de
      // cima pra baixo (1–5 na esquerda, 6–10 na direita), e a grade precisa
      // saber quantas linhas cabem em cada uma.
      + `<ol class="pf-rows pf-top-list" style="--pf-linhas:${Math.ceil(visiveis.length / 2)}">${corpo}</ol>`
      + (rows.length > LIM ? botaoMais("top", rows.length - LIM, aberta.top) : "");
    sec.hidden = false;
  }
  // ---------------------------------------------------------------------------
  // Progressão — snapshot diário POR JOGO (em BRL), pro gráfico local somar/filtrar.
  // Esquema do ponto: {d, c, b, w} = raw, graded, desejos (em BRL).
  // combined = c+b = patrimônio do jogo.
  // ---------------------------------------------------------------------------
  // "Desejos" saiu das linhas do gráfico (3.0): não é patrimônio, e no mesmo
  // eixo do dinheiro que você TEM ele achatava a escala ou se lia como parte
  // dele. O `w` segue sendo gravado no histórico (a retrospectiva e o Hub leem);
  // o valor vive na seção Metas.
  const SERIES = {
    combined: { color: "#34d399", get: (p) => (p.c || 0) + (p.b || 0) },
    collection: { color: "#2dd4bf", get: (p) => p.c || 0 },
    graded: { color: "#e8c46a", get: (p) => p.b || 0 }
  };
  const SERIES_ORDER = ["combined", "collection", "graded"];
  // "1D" saiu: o ponto é DIÁRIO, então um dia de faixa nunca tem os 2 pontos que
  // o gráfico exige pra desenhar. No lugar entrou "1A", que faltava entre 6M e MÁX.
  const RANGES = [["7d", 7], ["1m", 30], ["3m", 90], ["6m", 180], ["1a", 365], ["max", 1e9]];
  // O patrimônio está SEMPRE na tela (é o número grande); cartas e graded são
  // linhas opcionais por cima dele.
  let activeSeries = new Set(["combined"]);
  let activeRange = "1m";
  let controlsBound = false;
  // Modo do gráfico: "series" (o total) ou "games" (uma LINHA POR JOGO).
  // Nenhum concorrente tem o segundo — e o dado já estava aqui, porque o
  // histórico sempre foi gravado por jogo. `pctMode` normaliza cada linha a 100
  // no início da faixa: sem isso um jogo grande achata os pequenos e o gráfico
  // só conta quem é maior, não quem está subindo.
  const MODE_KEY = "tcg-pf-chart-mode", PCT_KEY = "tcg-pf-chart-pct";
  const lePref = (k, def) => { try { return localStorage.getItem(k) || def; } catch (e) { return def; } };
  const gravaPref = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignora */ } };
  const BENCH_KEY = "tcg-pf-chart-bench";
  let chartMode = lePref(MODE_KEY, "series") === "games" ? "games" : "series";
  let pctMode = lePref(PCT_KEY, "off") === "on";
  let benchOn = lePref(BENCH_KEY, "on") === "on"; // nasce ligado: é o contexto
  let activeGames = null; // Set de jogos ligados; null = ainda não inicializado

  const fromBRL = (v) => { const r = shared.convertMoney(v, "BRL", shared.getCurrency()); return r == null ? v : r; };
  // O histórico (leitura, gravação, migração do v1) vive no shared: o Hub e a
  // Coleção também gravam o ponto do dia, então quem nunca abre esta tela não
  // fica com buracos no gráfico.
  const loadHist = (g) => shared.valueHistory(g);
  const jogosComHistorico = () => GAMES.filter((g) => loadHist(g).length > 0);

  // Linha do tempo unificada de um conjunto de jogos: a UNIÃO das datas, com o
  // último ponto conhecido de cada jogo CARREGADO PRA FRENTE.
  //
  // O "carregar pra frente" conserta um erro silencioso do somatório antigo, que
  // agrupava os pontos por data e somava só quem tinha ponto naquele dia: se o
  // Pokémon registrou na terça e o Lorcana não, a terça saía valendo só o
  // Pokémon — e a linha do patrimônio DESPENCAVA num dia em que nada aconteceu.
  // Não ter medido não é valer zero: é continuar valendo o que valia.
  // ANTES do primeiro ponto de um jogo o valor é `null`, não zero: zero é "não
  // tenho nada", null é "ainda não media isso".
  function serieUnificada(games) {
    const datas = [...new Set(games.flatMap((g) => loadHist(g).map((p) => p.d)))].sort();
    const cursor = Object.fromEntries(games.map((g) => [g, 0]));
    const ultimo = Object.fromEntries(games.map((g) => [g, null]));
    return datas.map((d) => {
      const porJogo = {};
      games.forEach((g) => {
        const h = loadHist(g);
        while (cursor[g] < h.length && h[cursor[g]].d <= d) { ultimo[g] = h[cursor[g]]; cursor[g]++; }
        porJogo[g] = ultimo[g];
      });
      return { d, porJogo };
    });
  }

  // Pontos do gráfico no formato {d, c, b, w} (soma dos jogos do filtro) + o
  // detalhe por jogo pendurado, que o modo "por jogo" usa. No SOMATÓRIO o jogo
  // ainda não medido entra como 0 — o patrimônio da época de fato não o incluía.
  function chartHistory() {
    const games = gameFilter === "all" ? jogosComHistorico() : [gameFilter];
    return serieUnificada(games).map(({ d, porJogo }) => {
      const p = { d, c: 0, b: 0, w: 0, porJogo };
      games.forEach((g) => {
        const q = porJogo[g];
        if (q) { p.c += q.c || 0; p.b += q.b || 0; p.w += q.w || 0; }
      });
      return p;
    });
  }

  function updateChart() {
    const section = document.getElementById("portfolioChart");
    if (!section) return;
    // Snapshot de CADA jogo (não só o filtrado) -> histórico do hub correto.
    // Esta é a única tela que sabe os DESEJOS (wishlist + faltantes de binder),
    // então é a única que manda o `w`.
    //
    // UMA VEZ por carga, não a cada render: os números não mudam quando você
    // troca o chip de jogo ou a aba de uma seção, e gravar de novo custava 13
    // varreduras da coleção + escrita no localStorage (que ainda acorda o sync)
    // em todo clique. Se chegarem cartas novas (listas, binders), o
    // indexaCartas libera outro registro.
    if (!snapshotGravado && !cargaParcial) {
      snapshotGravado = true;
      shared.recordValueSnapshot(Object.fromEntries(GAMES.map((g) => {
        const linhas = collectionLines(g);
        return [g, {
          raw: linhas.total,
          graded: gradedSlabs(g).reduce((s, x) => s + (x.value || 0), 0),
          wish: wishlistTotal(g) + binderWishTotal(g),
          // Cobertura da avaliação (cópias precificadas/total): é com ela que o
          // recordValueSnapshot separa "o mercado caiu" de "o preço não veio"
          // — ver a guarda de queda falsa no shared.js.
          priced: linhas.pricedCopies,
          copies: linhas.totalCopies
        }];
      })));
    }
    if (!controlsBound) { bindControls(); controlsBound = true; }
    renderControls();
    // Uma leitura só do histórico pro gráfico E pro chip do dia — o chip é
    // pintado aqui (não no render) porque o ponto de HOJE acabou de ser gravado
    // logo acima; pintá-lo antes compararia contra um histórico defasado.
    const pts = chartHistory();
    pintaDeltaDoDia(pts);
    renderChart(pts);
    if (pctMode) hidrataIndices(); // preferência já vinha ligada de outra visita
  }

  // O modo "por jogo" só existe no filtro "Todos": com um jogo escolhido lá em
  // cima, a linha por jogo e a do patrimônio seriam a MESMA linha.
  const podeModoJogos = () => gameFilter === "all" && jogosComHistorico().length > 1;

  // Jogos ligados no modo "por jogo". Começa com todos os que têm histórico.
  function gamesAtivos() {
    const disponiveis = jogosComHistorico();
    if (!activeGames) activeGames = new Set(disponiveis);
    const vivos = disponiveis.filter((g) => activeGames.has(g));
    return vivos.length ? vivos : disponiveis;
  }

  function redesenha() { renderControls(); renderChart(chartHistory()); }

  function bindControls() {
    const seriesEl = document.getElementById("pfSeries");
    const rangeEl = document.getElementById("pfRanges");
    const modeEl = document.getElementById("pfChartModes");
    if (seriesEl) seriesEl.addEventListener("click", (e) => {
      const s = e.target.closest("[data-series]");
      if (s) {
        const k = s.dataset.series;
        if (k === "combined") return; // o patrimônio não desliga: é o número grande
        if (activeSeries.has(k)) activeSeries.delete(k); else activeSeries.add(k);
        redesenha(); return;
      }
      // "Todos os jogos": liga tudo; se já estava tudo ligado, é um jeito rápido
      // de voltar a UMA linha só (o 1º jogo) em vez de desligar 12 chips na mão.
      const todos = e.target.closest("[data-games-all]");
      if (todos) {
        const disponiveis = jogosComHistorico();
        const tudoLigado = disponiveis.every((g) => activeGames && activeGames.has(g));
        activeGames = new Set(tudoLigado ? disponiveis.slice(0, 1) : disponiveis);
        redesenha(); return;
      }
      const chip = e.target.closest("[data-game-series]");
      if (chip) {
        const g = chip.dataset.gameSeries;
        gamesAtivos(); // garante o Set inicializado
        if (activeGames.has(g)) { if (activeGames.size > 1) activeGames.delete(g); } else activeGames.add(g);
        redesenha();
      }
    });
    if (rangeEl) rangeEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-range]"); if (!b) return;
      activeRange = b.dataset.range;
      redesenha();
    });
    if (modeEl) modeEl.addEventListener("click", (e) => {
      const m = e.target.closest("[data-chart-mode]");
      if (m) { chartMode = m.dataset.chartMode; gravaPref(MODE_KEY, chartMode); redesenha(); return; }
      const p = e.target.closest("[data-chart-pct]");
      if (p) {
        pctMode = !pctMode;
        gravaPref(PCT_KEY, pctMode ? "on" : "off");
        redesenha();
        if (pctMode) hidrataIndices(); // o benchmark só existe aqui: busca sob demanda
        return;
      }
      const b = e.target.closest("[data-chart-bench]");
      if (b) { benchOn = !benchOn; gravaPref(BENCH_KEY, benchOn ? "on" : "off"); redesenha(); }
    });
    // O gráfico é desenhado na LARGURA REAL do cartão (ver renderChart): ao
    // girar o celular ou redimensionar a janela, redesenha — senão o texto dos
    // eixos voltaria a encolher junto com o SVG.
    const body = document.getElementById("pfChartBody");
    if (body && window.ResizeObserver) {
      let largura = body.clientWidth, agendado = false;
      new ResizeObserver(() => {
        if (agendado || Math.abs(body.clientWidth - largura) < 8) return;
        agendado = true;
        requestAnimationFrame(() => { agendado = false; largura = body.clientWidth; renderChart(chartHistory()); });
      }).observe(body);
    }
  }

  function renderControls() {
    const seriesEl = document.getElementById("pfSeries");
    const rangeEl = document.getElementById("pfRanges");
    const modeEl = document.getElementById("pfChartModes");
    const emJogos = chartMode === "games" && podeModoJogos();
    if (seriesEl) {
      if (emJogos) {
        const disponiveis = jogosComHistorico();
        const ligados = new Set(gamesAtivos());
        const tudo = disponiveis.every((g) => ligados.has(g));
        seriesEl.innerHTML =
          `<button type="button" class="pf-chip pf-games-all${tudo ? " active" : ""}" data-games-all aria-pressed="${tudo}">${escapeHtml(t("portfolio.series.allGames"))}</button>`
          + disponiveis.map((g) =>
            `<button type="button" class="pf-chip${ligados.has(g) ? " active" : ""}" data-game-series="${escapeAttribute(g)}" aria-pressed="${ligados.has(g)}" style="--pf-color:${GAME_COLOR[g]}">
               <span class="pf-dot"></span>${escapeHtml(shared.gameLabel(g))}
             </button>`).join("");
      } else {
        // Patrimônio fixo (legenda), cartas e graded como liga-desliga.
        seriesEl.innerHTML = SERIES_ORDER.map((k) => k === "combined"
          ? `<span class="pf-chip pf-chip-fixed active" style="--pf-color:${SERIES[k].color}"><span class="pf-dot"></span>${escapeHtml(t("portfolio.series.combined"))}</span>`
          : `<button type="button" class="pf-chip${activeSeries.has(k) ? " active" : ""}" data-series="${k}" aria-pressed="${activeSeries.has(k)}" style="--pf-color:${SERIES[k].color}">
               <span class="pf-dot"></span>${escapeHtml(t(`portfolio.series.${k}`))}
             </button>`).join("");
      }
    }
    if (rangeEl) rangeEl.innerHTML = RANGES.map(([k]) =>
      `<button type="button" class="pf-seg-btn${k === activeRange ? " active" : ""}" data-range="${k}" aria-pressed="${k === activeRange}">${escapeHtml(t(`portfolio.range.${k}`))}</button>`).join("");
    if (modeEl) {
      // Total × Por jogo só com 2+ jogos com histórico; o % e o Mercado valem
      // pra todo mundo com histórico — "o mercado caiu 10%, você caiu 7%" serve
      // também a quem coleciona um jogo só.
      const temHistorico = chartHistory().length >= 2;
      modeEl.hidden = !temHistorico;
      modeEl.innerHTML = !temHistorico ? "" :
        (podeModoJogos()
          ? `<span class="pf-seg"><button type="button" class="pf-seg-btn${emJogos ? "" : " active"}" data-chart-mode="series" aria-pressed="${!emJogos}">${escapeHtml(t("portfolio.chart.total"))}</button><button type="button" class="pf-seg-btn${emJogos ? " active" : ""}" data-chart-mode="games" aria-pressed="${emJogos}">${escapeHtml(t("portfolio.chart.modeGames"))}</button></span>`
          : "")
        + `<button type="button" class="pf-toggle${pctMode ? " active" : ""}" data-chart-pct aria-pressed="${pctMode}" title="${escapeAttribute(t("portfolio.chart.pctHint"))}">%</button>`
        // O benchmark só aparece com o % ligado — é lá que ele é comparável.
        + (pctMode ? `<button type="button" class="pf-toggle pf-toggle-bench${benchOn ? " active" : ""}" data-chart-bench aria-pressed="${benchOn}" title="${escapeAttribute(t("portfolio.chart.marketHint"))}">${escapeHtml(t("portfolio.chart.market"))}</button>` : "");
    }
  }

  // Índice do mercado alinhado às datas do gráfico. O índice tem a régua de
  // datas DELE (os dias de build), então cada ponto do gráfico pega o último
  // valor do índice até aquela data — carregar pra frente é o tratamento certo
  // pra um índice: entre duas medições ele não "vale zero", vale a última.
  // Buraco no COMEÇO fica null e a linha só nasce quando o índice nasce.
  function serieDoMercado(pts) {
    const jogos = (gameFilter === "all" ? GAMES : [gameFilter]).filter((g) => indexByGame[g]);
    if (!jogos.length) return null;
    const serieDe = (g) => {
      const src = indexByGame[g];
      let cursor = 0, ultimo = null;
      return pts.map((p) => {
        while (cursor < src.d.length && src.d[cursor] <= p.d) {
          if (src.i[cursor] != null) ultimo = src.i[cursor];
          cursor++;
        }
        return ultimo;
      });
    };
    const series = jogos.map(serieDe);
    if (series.length === 1) return series[0];
    // Vários jogos: média simples dos índices disponíveis em cada data — cada
    // mercado pesa igual, senão o índice do jogo com mais cartas viraria "o
    // mercado" sozinho.
    return pts.map((_, i) => {
      const vs = series.map((s) => s[i]).filter((v) => v != null);
      return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
    });
  }

  // Cabeçalho = o TOPO da tela: o número grande e a variação embaixo dele.
  // Sem argumento, apaga a variação (histórico curto). `valor` null mantém o
  // patrimônio fresco no número grande — só o scrub passa um valor.
  function setHero(d) {
    const elDelta = document.getElementById("pfChartDelta");
    if (elements.grandTotal && !assentando && networthAgora != null) {
      elements.grandTotal.textContent = d && d.valor != null ? d.valor : money(networthAgora);
    }
    if (!elDelta) return;
    // O dinheiro vai num <span> próprio pro modo privacidade borrar SÓ ele: a
    // porcentagem continua legível, que é o ponto do modo.
    elDelta.innerHTML = d
      ? `<span class="${d.dir}">${escapeHtml(d.seta)} <span class="pf-cash">${escapeHtml(d.cash)}</span> <span class="pf-pct">(${escapeHtml(d.pct)})</span></span> <span class="pf-when">${escapeHtml(d.quando)}</span>`
      : "";
  }

  function renderChart(history) {
    const body = document.getElementById("pfChartBody");
    if (!body) return;
    const days = (RANGES.find((r) => r[0] === activeRange) || ["1m", 30])[1];
    const cutoff = Date.now() - days * 86400000;
    const pts = days >= 1e9 ? history.slice() : history.filter((p) => new Date(p.d + "T00:00:00").getTime() >= cutoff);
    if (pts.length < 2) {
      body.innerHTML = `<p class="pf-chart-empty">${escapeHtml(t("portfolio.chart.startsToday"))}</p>`;
      setHero(null);
      return;
    }
    // TRAÇOS: o gráfico não conhece "séries" nem "jogos", só uma lista de
    // linhas {chave, rótulo, cor, vals[]} sobre o mesmo eixo de datas. Foi o que
    // permitiu o modo por jogo caber sem um segundo renderizador.
    const emJogos = chartMode === "games" && podeModoJogos();
    const traces = emJogos
      ? gamesAtivos().map((g) => ({
          key: g, label: shared.gameLabel(g), color: GAME_COLOR[g],
          // null antes do 1º ponto do jogo (ver serieUnificada): a linha nasce
          // onde a medição nasceu, em vez de vir rastejando pelo chão.
          vals: pts.map((p) => {
            const q = p.porJogo && p.porJogo[g];
            return q ? fromBRL((q.c || 0) + (q.b || 0)) : null;
          })
        }))
      : SERIES_ORDER.filter((k) => activeSeries.has(k)).map((k) => ({
          key: k, label: t("portfolio.series." + k), color: SERIES[k].color,
          vals: pts.map((p) => fromBRL(SERIES[k].get(p)))
        }));
    // `from` = índice do 1º valor real do traço. Os nulos só aparecem no COMEÇO
    // (depois do 1º ponto o valor é sempre carregado pra frente).
    traces.forEach((tr) => {
      tr.from = tr.vals.findIndex((v) => v != null);
      if (tr.from < 0) tr.from = tr.vals.length; // traço sem dado nenhum na faixa
    });
    // Traço sem nenhum ponto na faixa escolhida não vira linha invisível: sai.
    const vivos = traces.filter((tr) => tr.from < tr.vals.length);
    traces.length = 0; vivos.forEach((tr) => traces.push(tr));
    if (!traces.length) {
      body.innerHTML = `<p class="pf-chart-empty">${escapeHtml(t("portfolio.chart.startsToday"))}</p>`;
      setHero(null);
      return;
    }
    const money = (v) => shared.formatMoney(shared.getCurrency(), v);
    const loc = getLocale();
    const fmtPct = (v) => v.toLocaleString(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
    // BENCHMARK: a linha do mercado, só no modo % (comparar um índice base 1000
    // com reais não diz nada). "O mercado caiu 10%, você caiu 7%" põe o
    // resultado em perspectiva em vez de parecer erro seu.
    if (pctMode && benchOn) {
      const serie = serieDoMercado(pts);
      if (serie) traces.push({ key: "bench", label: t("portfolio.chart.market"), color: "#8b93a7", bench: true, vals: serie, from: serie.findIndex((v) => v != null) });
    }
    // Modo %: cada linha vira "quanto rendeu desde o início da faixa" (base 100).
    // A base é o 1º valor REAL do traço (não o do eixo), senão um jogo que
    // entrou depois normalizaria por zero.
    if (pctMode) {
      traces.forEach((tr) => {
        const base = tr.vals[tr.from];
        tr.brutos = tr.vals;
        tr.vals = tr.vals.map((v) => (v == null ? null : (base > 0 ? (v / base) * 100 : 100)));
      });
    }
    const fmtVal = (v) => (v == null ? "—" : (pctMode ? fmtPct(v) : money(v)));
    // LARGURA REAL do cartão como viewBox (3.0): com o viewBox fixo de 820 px,
    // no celular o SVG encolhia pra ~350 px e levava o texto junto — rótulos
    // de eixo de 4–5 px, ilegíveis. Desenhando na largura de verdade, 11 px é
    // 11 px em qualquer tela; o ResizeObserver redesenha quando ela muda.
    const W = Math.max(280, Math.round(body.clientWidth || 820));
    const H = W < 560 ? 196 : 260;
    const PL = 4, PR = 4, PT = 16, PB = 26;
    let yMin = Infinity, yMax = -Infinity;
    traces.forEach((tr) => tr.vals.forEach((v) => { if (v == null) return; if (v < yMin) yMin = v; if (v > yMax) yMax = v; }));
    if (!isFinite(yMin)) { yMin = 0; yMax = 1; }
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const padY = (yMax - yMin) * 0.14; yMin -= padY; yMax += padY;
    // A folga embaixo puxava o eixo pra baixo de zero em coleção pequena, e
    // "−1.134" num eixo de dinheiro é um valor que não existe.
    if (yMin < 0) yMin = 0;
    const plotW = W - PL - PR, plotH = H - PT - PB;
    const baseY = PT + plotH;
    // Eixo X pelo TEMPO, não pela posição na lista: quem passava 20 dias sem
    // abrir o site via esse intervalo ocupar a mesma largura de um dia.
    const msDe = (p) => new Date(p.d + "T00:00:00").getTime();
    const t0 = msDe(pts[0]), t1 = msDe(pts[pts.length - 1]);
    const spanMs = t1 - t0;
    const X = (i) => PL + (spanMs <= 0 ? plotW / 2 : ((msDe(pts[i]) - t0) / spanMs) * plotW);
    const Y = (v) => PT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
    const fmtDay = (s) => new Date(s + "T00:00:00").toLocaleDateString(loc, { day: "2-digit", month: "short" }).replace(".", "");
    const pontoEmX = (vx) => {
      let melhor = 0, dist = Infinity;
      for (let i = 0; i < pts.length; i++) { const d = Math.abs(X(i) - vx); if (d < dist) { dist = d; melhor = i; } }
      return melhor;
    };

    // Grade horizontal + rótulos do eixo Y em notação COMPACTA ("36,5 mil"):
    // o número inteiro competia com a linha e não cabia no celular.
    const compacto = new Intl.NumberFormat(loc, { notation: "compact", maximumFractionDigits: 1 });
    let grid = "";
    for (let g = 0; g <= 3; g++) {
      const v = yMin + (g / 3) * (yMax - yMin), y = Y(v);
      grid += `<line class="pf-grid" x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}"/>`;
      if (g === 0) continue; // o rótulo do chão encostaria nas datas
      const rotulo = pctMode ? Math.round(v).toLocaleString(loc) + "%" : compacto.format(v);
      grid += `<text class="pf-axis" x="${W - PR - 2}" y="${(y - 5).toFixed(1)}" text-anchor="end">${escapeHtml(rotulo)}</text>`;
    }
    // Régua de datas: marcações espaçadas no TEMPO — 3 no celular, 5 no desktop.
    const T = Math.min(W < 560 ? 3 : 5, pts.length);
    let xaxis = "";
    const marcados = new Set();
    for (let j = 0; j < T; j++) {
      const alvo = PL + (T === 1 ? plotW / 2 : (j / (T - 1)) * plotW);
      const i = pontoEmX(alvo);
      if (marcados.has(i)) continue;
      marcados.add(i);
      const x = X(i), anchor = j === 0 ? "start" : (j === T - 1 ? "end" : "middle");
      xaxis += `<text class="pf-xaxis" x="${x.toFixed(1)}" y="${(H - 7).toFixed(1)}" text-anchor="${anchor}">${escapeHtml(fmtDay(pts[i].d))}</text>`;
    }
    // MENOR distância entre dois pontos vizinhos, em px — decide se cabe
    // marcador por ponto.
    let dotSpacing = plotW;
    for (let i = 1; i < pts.length; i++) dotSpacing = Math.min(dotSpacing, X(i) - X(i - 1));
    let defs = "", areas = "", lines = "";
    // A área embaixo da linha só ajuda com POUCAS linhas: com 13 jogos ligados,
    // treze gradientes empilhados viram uma sopa. Acima de 4, fica só o traço.
    // No total ela fica só no patrimônio — cartas e graded são linhas de apoio.
    const meusTracos = traces.filter((tr) => !tr.bench);
    const comArea = meusTracos.length <= 4;
    traces.forEach((tr) => {
      const gid = "pfg-" + tr.key;
      const linePts = tr.vals.slice(tr.from)
        .map((v, j) => `${X(tr.from + j).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
      const area = comArea && !tr.bench && (emJogos || tr.key === "combined");
      if (area) {
        defs += `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${tr.color}" stop-opacity="0.26"/><stop offset="100%" stop-color="${tr.color}" stop-opacity="0"/></linearGradient>`;
        areas += `<polygon class="pf-area" points="${X(tr.from).toFixed(1)},${baseY.toFixed(1)} ${linePts} ${X(pts.length - 1).toFixed(1)},${baseY.toFixed(1)}" fill="url(#${gid})"/>`;
      }
      // O mercado vai TRACEJADO: é referência, não uma coleção sua.
      lines += `<polyline class="pf-line${tr.bench ? " pf-line-bench" : ""}${!emJogos && tr.key !== "combined" && !tr.bench ? " pf-line-sub" : ""}" points="${linePts}" stroke="${tr.color}"/>`;
      if (dotSpacing >= 14 && comArea && !tr.bench) {
        lines += tr.vals.map((v, i) => (v == null ? "" :
          `<circle class="pf-dot" cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3" stroke="${tr.color}"/>`)).join("");
      }
      // Ponta do traço: bolinha CHEIA — é o valor de hoje.
      lines += `<circle cx="${X(pts.length - 1).toFixed(1)}" cy="${Y(tr.vals[tr.vals.length - 1]).toFixed(1)}" r="3.5" fill="${tr.color}"/>`;
    });
    // Alta/Baixa do traço PRINCIPAL: o patrimônio no total; no modo por jogo, o
    // de maior valor hoje (a linha que o olho segue). Comparação pelo valor em
    // DINHEIRO mesmo no modo %.
    const ultimoBruto = (tr) => { const a = tr.brutos || tr.vals; return a[a.length - 1] || 0; };
    const principal = meusTracos.find((tr) => tr.key === "combined")
      || meusTracos.slice().sort((a, b) => ultimoBruto(b) - ultimoBruto(a))[0] || traces[0];
    const vals = principal.vals;
    let maxI = principal.from, minI = principal.from;
    vals.forEach((v, i) => {
      if (v == null) return;
      if (v > vals[maxI]) maxI = i;
      if (v < vals[minI]) minI = i;
    });
    const pill = (i, label, color, above) => {
      const x = X(i), y = Y(vals[i]), txt = `${label} ${fmtVal(vals[i])}`;
      const w = 14 + txt.length * 6.2, h = 20;
      const bx = Math.max(PL, Math.min(W - PR - w, x - w / 2));
      const by = above ? Math.max(0, y - h - 9) : Math.min(baseY - h, y + 9);
      return `<g class="pf-hilo"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${color}"/>
        <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${w.toFixed(1)}" height="${h}"/>
        <text x="${(bx + w / 2).toFixed(1)}" y="${(by + h / 2 + 3.8).toFixed(1)}" text-anchor="middle">${escapeHtml(txt)}</text></g>`;
    };
    const hilo = maxI !== minI ? pill(maxI, t("portfolio.chart.high"), "#a78bfa", true) + pill(minI, t("portfolio.chart.low"), "#f0883e", false) : "";

    // O número grande é SEMPRE o patrimônio (do filtro), em qualquer modo:
    // no "por jogo" as linhas são os pedaços dele, e o tooltip diz cada um.
    // Parado, ele mostra o valor FRESCO (o mesmo do resumo) e a variação desde
    // o início da faixa; arrastando, o dia sob o dedo — o scrub do Robinhood.
    // A variação vai no formato combinado "+R$ 120,00 (3,4%)", como o Collectr.
    const patri = pts.map((p) => fromBRL((p.c || 0) + (p.b || 0)));
    const base = patri.find((v) => v > 0) || 0;
    function pintaCabecalho(i) {
      const parado = i == null;
      const valor = parado ? (networthAgora != null ? networthAgora : patri[patri.length - 1]) : patri[i];
      const delta = valor - base;
      const pct = base > 0 ? (delta / base) * 100 : 0;
      setHero({
        valor: parado ? null : money(valor),
        seta: seta(delta),
        cash: signedMoney(delta),
        pct: sign(pct) + pctTxt(pct),
        dir: cls(delta),
        quando: parado ? t("portfolio.chart.win." + activeRange) : fmtDay(pts[i].d)
      });
    }
    pintaCabecalho();

    body.innerHTML = `<div class="pf-chart-rel">
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="pf-svg" role="img" aria-label="${escapeAttribute(t("portfolio.chart.title"))}">
        <defs>${defs}</defs>${grid}${areas}${lines}${xaxis}${hilo}
        <g class="pf-hover" style="display:none"></g>
      </svg>
      <div class="pf-tip" hidden></div>
    </div>`;

    // Hover/toque: guia vertical + pontos + tooltip com o valor do dia.
    const svg = body.querySelector(".pf-svg");
    const hoverG = body.querySelector(".pf-hover");
    const tip = body.querySelector(".pf-tip");
    function onMove(ev) {
      const r = svg.getBoundingClientRect();
      if (!r.width) return;
      const clientX = ev.touches && ev.touches[0] ? ev.touches[0].clientX : ev.clientX;
      const vx = (clientX - r.left) * (W / r.width);
      const i = pontoEmX(vx);
      const x = X(i);
      pintaCabecalho(i); // scrub: o número grande acompanha o dia sob o dedo
      let g = `<line class="pf-guide" x1="${x.toFixed(1)}" y1="${PT}" x2="${x.toFixed(1)}" y2="${baseY.toFixed(1)}"/>`;
      traces.forEach((tr) => {
        if (tr.vals[i] == null) return; // jogo ainda não medido nessa data
        g += `<circle class="pf-hover-dot" cx="${x.toFixed(1)}" cy="${Y(tr.vals[i]).toFixed(1)}" r="3.6" fill="${tr.color}"/>`;
      });
      hoverG.innerHTML = g; hoverG.style.display = "";
      // Linhas ordenadas por valor DESCENDO: no topo está sempre quem mais pesa.
      const rows = traces.filter((tr) => tr.vals[i] != null)
        .sort((a, b) => b.vals[i] - a.vals[i])
        .map((tr) => `<span class="pf-tip-row"><span class="pf-tip-dot" style="background:${tr.color}"></span>${escapeHtml(tr.label)}: <strong>${escapeHtml(fmtVal(tr.vals[i]))}</strong></span>`).join("");
      tip.innerHTML = `<span class="pf-tip-date">${escapeHtml(fmtDay(pts[i].d))}</span>${rows}`;
      tip.hidden = false;
      const leftPx = (x / W) * r.width;
      tip.style.left = Math.max(0, Math.min(r.width - tip.offsetWidth, leftPx - tip.offsetWidth / 2)) + "px";
      const topPx = (Y(vals[i] == null ? yMax : vals[i]) / H) * r.height - tip.offsetHeight - 12;
      tip.style.top = Math.max(0, topPx) + "px";
    }
    function onLeave() { hoverG.style.display = "none"; tip.hidden = true; pintaCabecalho(); }
    svg.addEventListener("mousemove", onMove);
    svg.addEventListener("mouseleave", onLeave);
    svg.addEventListener("touchstart", onMove, { passive: true });
    svg.addEventListener("touchmove", onMove, { passive: true });
    // No toque não existe "mouseleave": ao soltar o dedo, o número volta.
    svg.addEventListener("touchend", onLeave);
    svg.addEventListener("touchcancel", onLeave);
  }
})();
