(function () {
  const shared = window.TCGShared;
  const { t, tn, debounce, matchesCardQuery, escapeHtml } = shared;

  // Explorar GLOBAL (estilo Collectr): uma busca só para TODOS os jogos. A
  // página é neutra (sessão hub, sem catálogo injetado); o catálogo inteiro dos
  // jogos é carregado SOB DEMANDA na primeira busca (pill de loading do shared).
  const elements = {
    search: document.getElementById("exploreSearch"),
    grid: document.getElementById("exploreGrid"),
    intro: document.getElementById("exploreIntro"),
    empty: document.getElementById("exploreEmpty"),
    resultsHeader: document.getElementById("exploreResultsHeader"),
    resultsTitle: document.querySelector("#exploreResultsHeader h2"),
    resultCount: document.getElementById("exploreResultCount"),
    note: document.getElementById("exploreNote"),
    facets: document.getElementById("exploreFacets"),
    gameFilter: document.getElementById("exploreGameSelect"),
    sortSelect: document.getElementById("exploreSortSelect"),
    viewToggle: document.getElementById("exploreViewToggle"),
    filtersBtn: document.getElementById("exploreFiltersBtn"),
    filters: document.getElementById("exploreFilters"),
    setFilter: document.getElementById("exploreSetFilter"),
    langFilter: document.getElementById("exploreLangFilter"),
    rarityFilter: document.getElementById("exploreRarityFilter"),
    priceMin: document.getElementById("explorePriceMin"),
    priceMax: document.getElementById("explorePriceMax")
  };

  // "relevance" (27/09/2026) é o padrão: a carta que TEM o nome buscado vem
  // antes da que só começa com ele ("mew": Mew antes de Mewtwo), e dentro do
  // mesmo nível a mais valiosa primeiro. Quem já escolheu outra ordem guarda
  // a escolha (a chave só é gravada quando o seletor muda).
  const SORTS = ["relevance", "value-desc", "value-asc", "rarity-desc", "rarity-asc", "release", "num-asc"];
  let sort = SORTS.includes(localStorage.getItem("tcg-explore-sort")) ? localStorage.getItem("tcg-explore-sort") : "relevance";
  let gameFilter = "all";
  // Visualização da grade (grade/lista/compacta/fichário) — o MESMO alternador
  // da Coleção, do /cartas e da página do set, com preferência por página.
  let cardsView = shared.gridViewValue(localStorage.getItem("tcg-explore-view"));
  // Fichário: o mesmo módulo das outras grades. `root` é a própria grade — é
  // dentro dela que o binderView põe as setas, o seletor de página e a trilha.
  const binderView = window.TCGBinderView
    ? window.TCGBinderView.createBinderView({ root: elements.grid, grid: elements.grid, storageKey: "tcg-explore-binder-pockets" })
    : null;

  // Stores por jogo + fachadas mescladas (mesmo padrão da Coleção): posse,
  // desejo e preços funcionam pra qualquer carta de qualquer jogo.
  const { cardGameMap, owned, wishlist, prices } = shared.createCrossGameStores();

  // Câmbio (28/09/2026): os preços de referência vêm em USD/EUR, e o cardValue
  // só converte com a cotação na mão. Esta era a única grade de catálogo que
  // nunca pedia a cotação — quem chegava DIRETO no Explorar (link, busca do
  // Google, primeira visita) via todas as cartas sem preço, e junto iam a
  // ordem por valor, o desempate por valor do "Mais relevantes" e o filtro de
  // preço (tudo lia 0). Só funcionava pra quem tinha passado antes por uma
  // página que grava a cotação no cache. Um pedido só, no boot: quem pinta
  // valor espera por ele — com cache resolve na hora; sem, o loadFxRates tem
  // prazo de 2,5s e a grade sai sem preço se estourar (o evento abaixo
  // completa depois).
  const cambioPronto = shared.loadFxRates().catch(() => null);
  const temCambio = () => shared.convertMoney(1, "USD", "BRL") != null;
  // Preferência "agrupar versões" (ver cardVariantPairs no shared.js):
  // uma carta = um tile nas grades de catálogo; o + abre o card pra escolher.
  let agrupaVersoes = shared.groupVariantsEnabled();
  shared.initGroupVariantsChip((on) => { agrupaVersoes = on; render({ resetCount: true }); });

  let cards = [];
  let cardsById = new Map();
  let catalogPromise = null;
  let catalogPronto = false; // resolvido de verdade (a promise existir só diz que está DESCENDO)
  function ensureCatalog() {
    if (!catalogPromise) {
      catalogPromise = shared.loadAllGamesCatalog().then((catalog) => {
        cards = catalog.cards || [];
        cards.forEach((card) => cardGameMap.set(card.id, card.game));
        cardsById = new Map(cards.map((card) => [card.id, card]));
        catalogPronto = true;
        // ?card=<id>: reabre o popup da carta (ver collection.js). Aqui e não no
        // renderFromCatalog porque a promise é MEMOIZADA — roda uma vez só, então
        // buscar de novo depois de fechar o popup não o traz de volta.
        preview.openFromUrl();
        return cards;
      }).catch((error) => {
        // Era a ÚNICA página de catálogo sem catch: a promise memoizada rejeitava
        // e os esqueletos ficavam na tela pra sempre. Espelha o cards.js — limpa,
        // mostra o erro e zera a promise pra permitir nova tentativa.
        catalogPromise = null;
        elements.intro.hidden = true;
        elements.grid.innerHTML = "";
        shared.mostraErroDeCatalogo(elements.empty, error);
        elements.empty.hidden = false;
        if (elements.resultsHeader) elements.resultsHeader.hidden = true;
        throw error;
      });
    }
    return catalogPromise;
  }

  // Carrega o catálogo e redesenha; o catch existe só pra não vazar a rejeição
  // (o ensureCatalog já pintou o erro na tela).
  function renderFromCatalog() {
    ensureCatalog().then(() => cambioPronto).then(() => render({ resetCount: true })).catch(() => { /* erro já exibido */ });
  }

  const pager = shared.createPager({ grid: elements.grid, pageSize: 60 });

  const preview = shared.createCardPreview({
    getCard: (cardId) => cardsById.get(cardId),
    store: owned,
    prices,
    wishlist,
    onOwnedChange: () => refreshOwnership()
  });
  elements.grid.addEventListener("click", (event) => {
    // + de tile agrupado: menu de versões (adicionar direto, sem abrir o card).
    if (shared.handleGroupedAddClick(event, owned, wishlist, refreshOwnership)) return;
    const opener = event.target.closest("[data-preview-card-id]");
    if (opener) { preview.open(opener.dataset.previewCardId, opener.dataset.previewVariant); return; }
    if (shared.handleWantTileClick(event, wishlist)) { refreshOwnership(); return; }
    if (shared.handleRemoveOneTileClick(event, owned)) { refreshOwnership(); return; }
    // Como na busca por jogo: "+" soma +1 por clique com o feedback ✓ de 2s.
    const addButton = shared.handleAddTileClick(event, owned, wishlist);
    if (addButton) { refreshOwnership(); shared.flashTileAdded(addButton, owned); }
  });

  const term = () => String(elements.search.value || "").trim();
  const isSearching = () => term().length >= 2;

  // "Mais vistas pela comunidade" (antes na home): estado INICIAL do Explorar,
  // estilo Collectr. Top do contador anônimo de views (card_views) de todos os
  // jogos; só aparece com dados suficientes (>= 4 cartas com 2+ views) e some
  // enquanto há busca ativa (render() controla o hidden).
  // "Mais vistas pela comunidade": estado INICIAL do Explorar (em vez de vazio).
  // Puxa o top do contador anônimo (card_views) de TODOS os jogos, resolve as
  // cartas e mostra ~4-5 fileiras no GRID (tiles normais, com preview e +). Ao
  // digitar, o render() troca pros resultados da busca. O mini-row antigo
  // (exploreTopViewed) some — as mais-vistas agora vivem no grid.
  let topViewedReady = false;
  let topViewedPairs = [];
  (async function loadTopViewed() {
    if (!shared.fetchTopViewed) return;
    try {
      const games = shared.GAME_SLUGS || ["pokemon", "lorcana"];
      const perGame = await Promise.all(games.map((g) => shared.fetchTopViewed(g, 6)));
      const tops = games.flatMap((g, i) => perGame[i].map((x) => ({ id: x.card_id, views: x.views, game: g })))
        .filter((x) => x.views >= 2)
        .sort((a, b) => b.views - a.views)
        .slice(0, 30);
      if (tops.length < 4) return;
      const idsByGame = {};
      games.forEach((g) => { idsByGame[g] = tops.filter((x) => x.game === g).map((x) => x.id); });
      const [catalog] = await Promise.all([shared.loadOwnedAcrossGames(idsByGame), cambioPronto]);
      const byId = new Map((catalog.cards || []).map((c) => [c.id, c]));
      const pairs = [];
      for (const { id } of tops) {
        const card = byId.get(id);
        if (!card) continue;
        // registra pro preview/posse funcionarem antes da 1ª busca (o
        // ensureCatalog depois reescreve cardsById com o catálogo completo).
        cardGameMap.set(card.id, card.game);
        cardsById.set(card.id, card);
        pairs.push({ card, variant: shared.defaultVariant(card) });
      }
      topViewedPairs = pairs;
      topViewedReady = pairs.length >= 4;
      if (topViewedReady && !isSearching()) render({ resetCount: true });
    } catch (e) { /* seção é opcional */ }
  })();

  function sortComparator() {
    const priceOf = shared.memoValue((p) => shared.cardValue(p.card, p.variant, prices, shared.DEFAULT_CONDITION).value || 0);
    const byNum = (a, b) => shared.compareCardNumbers(a.card.number, b.card.number);
    if (sort === "relevance") {
      const q = term();
      const relOf = shared.memoValue((card) => shared.searchRelevance(card, q));
      return (a, b) => (relOf(b.card) - relOf(a.card)) || (priceOf(b) - priceOf(a));
    }
    if (sort === "num-asc") return byNum;
    if (sort === "value-asc") return (a, b) => {
      const pa = priceOf(a), pb = priceOf(b);
      if (!pa && !pb) return 0; if (!pa) return 1; if (!pb) return -1; return pa - pb;
    };
    if (sort === "rarity-desc") return (a, b) => shared.rarityRank(b.card.rarity) - shared.rarityRank(a.card.rarity) || byNum(a, b);
    if (sort === "rarity-asc") return (a, b) => shared.rarityRank(a.card.rarity) - shared.rarityRank(b.card.rarity) || byNum(a, b);
    if (sort === "release") return (a, b) => String(b.card.setReleaseDate || "").localeCompare(String(a.card.setReleaseDate || ""));
    return (a, b) => priceOf(b) - priceOf(a); // value-desc (padrão)
  }

  // --- Barra de filtros (Set · Idioma · Raridade · Preço) -------------------
  // Refinam o que está NA GRADE — o resultado da busca, ou as "mais vistas"
  // antes dela. As opções saem dessa mesma lista: o Explorar não tem "catálogo
  // da página" pra listar set e raridade de antemão (o catálogo dos 15 jogos
  // só desce quando precisa), e um <select> com todos os sets seria ilegível.
  function parsePrice(el) {
    if (!el) return null;
    const v = parseFloat(String(el.value || "").replace(/[^\d.,]/g, "").replace(",", "."));
    return Number.isFinite(v) && v >= 0 ? v : null;
  }
  const valorDe = shared.memoValue((card) =>
    (shared.cardValue(card, shared.defaultVariant(card), prices, shared.DEFAULT_CONDITION) || {}).value || 0);
  const campo = (el) => (el ? el.value : "");
  const temFiltro = () => !!(campo(elements.setFilter) || campo(elements.langFilter) || campo(elements.rarityFilter)
    || parsePrice(elements.priceMin) != null || parsePrice(elements.priceMax) != null);

  function passaNosFiltros(card) {
    const set = campo(elements.setFilter);
    if (set && card.set !== set) return false;
    const idioma = campo(elements.langFilter);
    if (idioma && shared.normalizeCardLanguage(card.language) !== idioma) return false;
    const raridade = campo(elements.rarityFilter);
    if (raridade && card.rarity !== raridade) return false;
    const pMin = parsePrice(elements.priceMin), pMax = parsePrice(elements.priceMax);
    if (pMin != null || pMax != null) {
      const v = valorDe(card);
      if (pMin != null && v < pMin) return false;
      if (pMax != null && (v > pMax || v <= 0)) return false; // sem preço não entra em "até X"
    }
    return true;
  }

  // Reconstrói um <select> mantendo a 1ª opção ("Todos") e a seleção atual, se
  // ela ainda existir no conjunto novo (o mesmo fillFilter da Coleção).
  function preencheFiltro(select, valores, rotulo) {
    if (!select) return;
    const anterior = select.value;
    while (select.options.length > 1) select.remove(1);
    shared.addOptions(select, valores, rotulo);
    select.value = valores.includes(anterior) ? anterior : "";
  }
  // As opções saem da lista ANTES dos filtros: escolher um set não pode apagar
  // os outros do seletor, senão não dá pra voltar atrás.
  function atualizaOpcoes(lista) {
    const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));
    preencheFiltro(elements.setFilter, uniq(lista.map((c) => c.set)).sort((a, b) => a.localeCompare(b)));
    preencheFiltro(elements.langFilter, uniq(lista.map((c) => shared.normalizeCardLanguage(c.language))), (v) => shared.cardLanguageLabel(v));
    preencheFiltro(elements.rarityFilter, uniq(lista.map((c) => c.rarity)).sort((a, b) => a.localeCompare(b)));
  }

  // Decididos pelo render ANTES de pintar (o pager chama o tileDe item a item,
  // inclusive na rolagem, sem contexto): a posição de cada carta no ranking
  // das mais vistas (só no estado inicial) e se a grade mistura jogos.
  let rankDe = null;
  let misturaJogos = false;

  // Um tile no modo de visualização atual: o compacto muda o HTML (sem <img>),
  // não só a classe da grade.
  //
  // Etiqueta do jogo (28/09/2026): numa grade que mistura jogos, "Base Set ·
  // 4/102" não diz de que jogo a carta é — "dragon" traz Magic, Yu-Gi-Oh!,
  // Dragon Ball e mais sete, e o nome do set só ajuda quem já conhece o set.
  // É o gameTag do variantTile (o .game-tag da Coleção e dos Decks), ligado só
  // quando a grade mistura jogos — com um jogo só repetiria a mesma palavra.
  //
  // Posição nas mais vistas: o estado inicial é um RANKING (card_views), mas
  // saía como uma grade qualquer, sem dizer por que aquelas cartas estavam
  // ali. O número vai no canto da imagem; a posição é a ORIGINAL (filtrar não
  // renumera: a 3ª mais vista continua sendo a 3ª).
  const tileDe = ({ card, variant }) => {
    const tile = shared.variantTile(card, variant, owned, wishlist, prices,
      { addMode: true, grouped: agrupaVersoes, compact: cardsView === "compact", gameTag: misturaJogos });
    const pos = rankDe && rankDe.get(card.id);
    const moldura = pos && tile.querySelector(".card-image");
    if (moldura) {
      // O número à vista é só o dígito; o leitor de tela ouve "3ª mais vista"
      // (aria-label em <span> sem papel é ignorado — daí o texto escondido).
      moldura.insertAdjacentHTML("afterbegin",
        `<span class="xpl-rank${pos <= 3 ? " is-top" : ""}"><span class="sr-only">${escapeHtml(t("explore.rankSr", { n: pos }))}</span><span aria-hidden="true">${pos}</span></span>`);
    }
    return tile;
  };

  // Pinta a grade. No fichário quem monta é o binderView (páginas de bolsos),
  // então o pager entra vazio antes — é ele que limpa a grade e tira o
  // "carregar mais", que não faz sentido em página de fichário.
  function pintaGrade(pares, options) {
    shared.applyGridViewClasses(elements.grid, cardsView);
    if (cardsView === "binder" && binderView) {
      pager.render([], () => document.createComment(""), { resetCount: true });
      binderView.render(pares, tileDe);
    } else {
      pager.render(pares, tileDe, options || {});
    }
    if (elements.viewToggle) {
      elements.viewToggle.querySelectorAll("[data-grid-view]").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.gridView === cardsView));
      });
      if (binderView) binderView.paintToggle(elements.viewToggle.querySelector('[data-grid-view="binder"]'));
    }
  }

  // Número no formato do idioma ("8.283", "8,283"): o contador é o que diz se
  // a busca veio inteira, e "8283 resultados" é difícil de ler.
  const numero = (n) => {
    try { return Number(n).toLocaleString(shared.getLocale ? shared.getLocale() : undefined); } catch (e) { return String(n); }
  };

  // Aviso de resultado CORTADO: a borda devolve no máximo 10 mil cartas (as
  // mais relevantes). Acima disso a busca não é de UMA carta ("dragon" em 13
  // jogos) e o aviso diz quantas existem e como chegar no resto.
  function pintaAviso(base) {
    if (!elements.note) return;
    const cortado = !!(base && base.truncated && base.total > base.list.length);
    elements.note.hidden = !cortado;
    elements.note.textContent = cortado
      ? t("explore.truncated", { shown: numero(base.list.length), total: numero(base.total) })
      : "";
  }

  // "Nenhuma carta" diz ONDE não achou: com o jogo filtrado, "em nenhum jogo"
  // era mentira — e, desde que o vazio da borda virou a resposta final (sem
  // baixar o catálogo pra confirmar), é esta frase que a pessoa lê. Ela
  // aponta a saída óbvia: buscar em todos os jogos.
  function textoSemResultado() {
    if (gameFilter === "all") return t("explore.empty");
    const escopo = gameFilter === shared.VINTAGE_FILTER ? t("filter.gameVintage") : shared.gameLabel(gameFilter);
    return t("explore.emptyIn", { scope: escopo });
  }

  // Por jogo (28/09/2026): na busca em TODOS os jogos, um chip por jogo com
  // quantas cartas dele a grade tem, do maior pro menor — "dragon" cai em dez
  // jogos, e o seletor lá em cima não dizia onde estava o grosso nem que o
  // jogo que a pessoa queria tinha só 12. Clicar é escolher o jogo no próprio
  // seletor (mesmo caminho: nova busca na borda, só daquele jogo). Com um jogo
  // já escolhido sobra UM chip, com ×, que volta pra todos — a saída fica
  // onde o olho está, não só no seletor do topo.
  // Visual do .dash-game-chip do painel: cor chapada do jogo + contagem num
  // véu, o mesmo "de relance" das etiquetas de jogo. `pares` null = esconde.
  const ICONE_FECHAR = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  function chipDeJogo(destino, cor, rotulo, miolo, titulo) {
    const fg = shared.textOnColor(cor);
    const veu = fg === "#000000" ? "rgba(255,255,255,.5)" : "rgba(0,0,0,.26)";
    return `<button type="button" class="xpl-facet" data-facet-game="${shared.escapeAttribute(destino)}"`
      + ` style="--gc:${cor};--gc-fg:${fg};--gc-veil:${veu}" title="${shared.escapeAttribute(titulo)}" aria-label="${shared.escapeAttribute(titulo)}">`
      + `<span class="xpl-facet-name">${escapeHtml(rotulo)}</span><span class="xpl-facet-count">${miolo}</span></button>`;
  }
  function pintaFacetas(pares) {
    const el = elements.facets;
    if (!el) return;
    let html = "";
    if (pares && gameFilter === "all") {
      const porJogo = new Map();
      pares.forEach(({ card }) => { if (card.game) porJogo.set(card.game, (porJogo.get(card.game) || 0) + 1); });
      if (porJogo.size > 1) {
        html = Array.from(porJogo.entries())
          .sort((a, b) => (b[1] - a[1]) || shared.gameLabel(a[0]).localeCompare(shared.gameLabel(b[0])))
          .map(([g, n]) => {
            const nome = shared.gameLabel(g);
            return chipDeJogo(g, shared.GAME_COLOR[g] || shared.GAME_COLOR.pokemon, nome, numero(n),
              t("explore.facetOnly", { game: nome, n: numero(n) }));
          }).join("");
      }
    } else if (pares) {
      const vintage = gameFilter === shared.VINTAGE_FILTER;
      const nome = vintage ? t("filter.gameVintage") : shared.gameLabel(gameFilter);
      const cor = vintage ? shared.VINTAGE_COLOR : (shared.GAME_COLOR[gameFilter] || shared.GAME_COLOR.pokemon);
      html = chipDeJogo("all", cor, nome, ICONE_FECHAR, t("explore.facetClear", { game: nome }));
    }
    el.innerHTML = html;
    el.hidden = !html;
    el.scrollLeft = 0;
    requestAnimationFrame(marcaRolagemFacetas);
  }
  // Com mais jogos do que cabe no vão, a fileira rola de lado: marca a ponta
  // em que a rolagem está e o CSS desbota o lado que ainda tem chip (o mesmo
  // aviso da subnav do Explorar, ver initSubnavScrollHint no shared.js). A
  // leitura de geometria vai num rAF, depois do layout que o innerHTML pediu.
  function marcaRolagemFacetas() {
    const el = elements.facets;
    if (!el || el.hidden) return;
    const sobra = el.scrollWidth - el.clientWidth;
    if (sobra < 4) { el.removeAttribute("data-scroll"); return; }
    const x = el.scrollLeft;
    el.dataset.scroll = x < 4 ? "start" : (x >= sobra - 4 ? "end" : "middle");
  }
  if (elements.facets) {
    elements.facets.addEventListener("scroll", marcaRolagemFacetas, { passive: true });
    window.addEventListener("resize", marcaRolagemFacetas);
  }

  // Última lista base pintada e o termo dela (ver o comentário no render),
  // com o total da borda e se ela veio cortada.
  let ultimaBase = { q: "", game: "", list: null, total: 0, truncated: false };
  // A grade saiu sem cotação? (ver o sleevu:fx-updated lá embaixo)
  let pintouSemCambio = false;
  function render(options) {
    const searching = isSearching();
    pintouSemCambio = !temCambio();
    if (!searching) {
      const showTop = topViewedReady && topViewedPairs.length >= 4;
      elements.intro.hidden = showTop;
      elements.resultCount.textContent = "";
      pintaAviso(null);
      pintaFacetas(null);
      elements.resultsHeader.hidden = !showTop;
      if (elements.filters) elements.filters.hidden = !showTop;
      if (!showTop) {
        elements.empty.hidden = true;
        pintaGrade([], { resetCount: true });
        return;
      }
      if (elements.resultsTitle) elements.resultsTitle.textContent = t("home.topViewed");
      atualizaOpcoes(topViewedPairs.map((par) => par.card));
      rankDe = new Map(topViewedPairs.map((par, i) => [par.card.id, i + 1]));
      misturaJogos = new Set(topViewedPairs.map((par) => par.card.game)).size > 1;
      const visiveis = topViewedPairs.filter((par) => passaNosFiltros(par.card));
      elements.empty.hidden = visiveis.length > 0;
      if (!visiveis.length) elements.empty.textContent = t("empty.pokedex");
      pintaGrade(visiveis, { resetCount: true });
      return;
    }
    elements.intro.hidden = true;
    elements.resultsHeader.hidden = false;
    if (elements.filters) elements.filters.hidden = false;
    if (elements.resultsTitle) elements.resultsTitle.textContent = t("results.heading.cards");
    // Filtra ANTES de gerar pares carta×variante (barato mesmo com ~60k cartas).
    // options.list = resultado COMPLETO da borda (apiApply): já filtrado por
    // jogo e casado por palavra, só entra no funil daqui.
    const q = term();
    // A base é a lista da borda (options.list) quando ela veio, o catálogo
    // completo quando ele chegou — e, no meio do caminho, a ÚLTIMA lista
    // pintada pra este mesmo termo e jogo. Sem essa memória, qualquer
    // re-render sem options (trocar a vista, mexer num filtro, ligar o
    // "Agrupar") caía no `cards` ainda vazio e esvaziava a grade com um "nada
    // encontrado".
    let base;
    if (options && options.list) {
      base = { q, game: gameFilter, list: options.list, total: options.total || options.list.length, truncated: !!options.truncated };
    } else if (!catalogPronto && ultimaBase.list && ultimaBase.q === q && ultimaBase.game === gameFilter) {
      base = ultimaBase;
    } else {
      const list = cards.filter((card) => shared.cardMatchesGameFilter(card, gameFilter) && matchesCardQuery(card, q));
      base = { q, game: gameFilter, list, total: list.length, truncated: false };
    }
    ultimaBase = base;
    const matched = base.list;
    pintaAviso(base);
    atualizaOpcoes(matched);
    const pairs = shared.cardVariantPairs(matched.filter(passaNosFiltros), { group: agrupaVersoes });
    const cmp = sortComparator();
    pairs.sort((a, b) =>
      (Number(shared.cardHasImage(b.card)) - Number(shared.cardHasImage(a.card))) || cmp(a, b));
    rankDe = null;
    // Pela lista INTEIRA (não só a 1ª página): a etiqueta não pode aparecer
    // no meio da rolagem porque a 61ª carta é de outro jogo.
    misturaJogos = pairs.some((par) => par.card.game !== pairs[0].card.game);
    pintaFacetas(pairs);
    pintaGrade(pairs, options || {});
    elements.empty.hidden = pairs.length > 0;
    // "Nenhuma carta em nenhum jogo" é resposta da BUSCA; com filtro ligado o
    // que sobrou de fora foi a barra, e a mensagem tem que dizer isso.
    if (!pairs.length) elements.empty.textContent = temFiltro() && matched.length ? t("empty.pokedex") : textoSemResultado();
    elements.resultCount.textContent = tn("results.count", pairs.length, { n: numero(pairs.length) });
  }

  // Rótulos dos tiles JÁ na tela depois que as cartas da borda ganham o
  // setTotal (enrichSetTotals): o título passa de "Mewtwo (063)" pra
  // "Mewtwo (063/197)" sem redesenhar a grade — recriar o tile faria a imagem
  // piscar e devolveria quem rolou pro começo.
  function atualizaRotulos() {
    elements.grid.querySelectorAll(".card-tile").forEach((tile) => {
      const card = cardsById.get(tile.dataset.tileCardId);
      const h3 = card && tile.querySelector(".tile-info h3");
      if (h3) h3.textContent = shared.cardLabel(card);
    });
  }

  function refreshOwnership() {
    elements.grid.querySelectorAll(".card-tile").forEach((tile) => {
      shared.refreshTileOwnership(tile, owned, wishlist, { addMode: true });
    });
  }

  // ?q= compartilhável (e escrito de volta a cada busca, sem recarregar).
  function writeUrl() {
    const sp = new URLSearchParams(window.location.search);
    const q = term();
    if (q) sp.set("q", q); else sp.delete("q");
    try { history.replaceState(null, "", `${window.location.pathname}${sp.toString() ? `?${sp}` : ""}`); } catch (e) { /* ignora */ }
  }

  // Busca pela BORDA: a /api/search em modo COMPLETO (&full=1) devolve TODAS
  // as cartas que casam em todos os jogos (até 10 mil, as mais relevantes
  // primeiro), já prontas pra grade e com o preço de cada uma — então a
  // contagem, a ordenação (por valor, raridade…), os filtros e a rolagem
  // valem sobre o resultado INTEIRO.
  //
  // Até 27/09/2026 esta ponte pedia 60 cartas, sem ordem nenhuma (a SQL não
  // tinha ORDER BY), e o catálogo completo só descia com a borda fora do ar:
  // "mew" mostrava "60 resultados" — 60 cartas quaisquer das 370, com o
  // "maior valor" ordenando só esses 60 — e não havia rolagem que trouxesse o
  // resto. De quebra, hidratar as 60 pelos chunks baixava o manifest e o
  // índice inteiro de cada jogo (2,9 MB só o do Pokémon); a resposta completa
  // de "mew" são 9 KB comprimidos.
  //
  // O catálogo inteiro — o maior download do site, dezenas de MB — só desce
  // se a borda estiver FORA (ver abaixo; resposta vazia não baixa nada).
  // Depois que ele chegou, a busca local segue valendo: instantânea e sem rede.
  let apiSeq = 0;
  let urlCardTentado = false;
  const VINTAGE_GAMES = ["pokemon", "onepiece", "naruto", "hxh", "dbc"]; // os que têm carta vintage (ver isVintageCard)
  // Qualquer erro no caminho da borda cai no catálogo local em vez de deixar
  // a página muda: uma exceção aqui era uma rejeição sem ninguém ouvindo, a
  // grade ficava como estava (as "mais vistas", ou os esqueletos) e a busca
  // parecia travada — digitar de novo, Enter, nada; só o F5 "resolvia", e
  // resolvia por acaso. Foi um ReferenceError num `q` que não existia neste
  // escopo (o termo é lido uma vez, no começo, e vale pro pedido inteiro).
  async function apiApply() {
    try { await apiApplyInner(); }
    catch (e) { renderFromCatalog(); }
  }
  async function apiApplyInner() {
    const seq = ++apiSeq;
    const q = term();
    const filtro = gameFilter;
    if (!elements.grid.querySelector(".card-tile")) shared.showSkeletons(elements.grid, "card", 8);
    // "Vintage" não existe na borda (é corte por carta, não coluna do D1):
    // busca nos jogos que TÊM linha vintage e peneira as cartas com
    // isVintageCard, mais abaixo.
    const vintage = filtro === shared.VINTAGE_FILTER;
    const jogos = vintage ? VINTAGE_GAMES : [filtro === "all" ? "all" : filtro];
    // A cotação vai JUNTO com a busca (não em fila): a borda responde em
    // centenas de ms e, com o câmbio em cache, a espera extra é zero.
    const [respostas] = await Promise.all([Promise.all(jogos.map((g) => shared.searchApiFull(g, q))), cambioPronto]);
    if (seq !== apiSeq || catalogPronto) return; // o catálogo chegou no meio: o render dele já cobre
    // null = borda desligada/soluço (ou Function sem o modo completo): o
    // catálogo local responde. Um jogo do vintage falhar também — resultado
    // pela metade com contagem de inteiro é o que esta página não pode dar.
    if (respostas.some((r) => !r)) { renderFromCatalog(); return; }
    let found = [].concat(...respostas.map((r) => r.cards));
    // VAZIO É a resposta (27/09/2026, decisão do Fernando): "nenhuma carta"
    // na hora. Até aqui um vazio da borda mandava baixar o catálogo INTEIRO
    // dos 13 jogos (dezenas de MB, minutos no celular) só pra confirmar — um
    // erro de digitação custava o maior download do site. Isso vinha de
    // quando a borda mentia vazio (o teto por palavra fazia "blue eyes"
    // voltar sem nada); com a busca completa, vazio quer dizer que nenhuma
    // carta tem uma palavra começando por cada termo. O que se perde, de
    // propósito: pedaço do MEIO de palavra ("kachu" achava Pikachu pelo
    // catálogo local) e campos que a borda não indexa (raridade, variante,
    // idioma). Borda FORA (null, acima) continua caindo no catálogo local —
    // aí não há outra resposta possível.
    // Os preços vêm na mesma resposta: entram na tabela da sessão, que é onde
    // o cardValue procura (união, como o loadAcrossGames faz — outra busca
    // desta página já pode ter posto preço de outras cartas ali).
    window.TCG_PRICING = Object.assign({}, window.TCG_PRICING, ...respostas.map((r) => r.pricing));
    if (vintage) found = found.filter((card) => shared.isVintageCard(card));
    // registra pro preview/posse/preço funcionarem igual ao caminho completo
    found.forEach((card) => {
      cardGameMap.set(card.id, card.game);
      cardsById.set(card.id, card);
    });
    const total = vintage ? found.length : respostas[0].total;
    const truncated = respostas.some((r) => r.truncated);
    render({ resetCount: true, list: found, total, truncated });
    // ?card=<id> (link de carta aberto a partir de uma busca): reabre o popup
    // UMA vez, na primeira resposta — o caminho do catálogo faz o mesmo no
    // ensureCatalog, mas com a borda respondendo ele nunca roda, e o link
    // compartilhado abria só a grade.
    if (!urlCardTentado && found.length) { urlCardTentado = true; preview.openFromUrl(); }
    // O código impresso completo ("063/197") depende do total do set, que a
    // borda não guarda: vem do manifest do jogo, em 2º plano.
    shared.enrichSetTotals(found).then((mudou) => {
      if (mudou && seq === apiSeq) atualizaRotulos();
    }).catch(() => { /* sem manifest: fica o número sozinho */ });
  }

  const apply = () => {
    writeUrl();
    if (catalogPronto) { render({ resetCount: true }); return; }
    if (!isSearching()) { render({ resetCount: true }); return; }
    // Catálogo ainda descendo (ou nem começou): a ponte responde JÁ — antes,
    // qualquer busca depois da primeira ficava presa esperando o download
    // inteiro (`if (catalogPromise)` mandava pro caminho lento). Se o download
    // está em andamento, religa o re-render de quando ele chegar.
    apiApply();
    if (catalogPromise) renderFromCatalog();
  };
  elements.search.addEventListener("input", debounce(apply, 250));

  // Jogo é um <select> ao lado do Ordenar (eram 13 chips numa faixa inteira).
  // Opções reconstruídas de GAME_SLUGS: jogo novo no registro aparece sozinho,
  // mesma garantia que os chips antigos tinham via initGameFilterChips.
  if (elements.gameFilter) {
    elements.gameFilter.innerHTML = `<option value="all">${shared.escapeHtml(shared.t("filter.gameAll"))}</option>`
      + shared.GAME_SLUGS.map((g) => `<option value="${g}">${shared.escapeHtml(shared.gameLabel(g))}</option>`).join("")
      // "Vintage" no fim: o corte agnóstico de jogo (isVintageCard), com a
      // explicação no title da opção.
      + `<option value="${shared.VINTAGE_FILTER}" title="${shared.escapeAttribute(shared.t("filter.vintageHint"))}">${shared.escapeHtml(shared.t("filter.gameVintage"))}</option>`;
    elements.gameFilter.value = gameFilter;
    elements.gameFilter.addEventListener("change", () => {
      const v = elements.gameFilter.value;
      gameFilter = shared.GAME_SLUGS.includes(v) || v === shared.VINTAGE_FILTER ? v : "all";
      shared.applyGameAccent(gameFilter);
      if (isSearching()) apply();
    });
  }

  // Chip de jogo = escolher no seletor (ver pintaFacetas). No TECLADO o foco
  // vai pro seletor: o chip acionado some na repintura, e quem navega por
  // teclado cai no controle que agora mostra o jogo (e desfaz a escolha, se
  // quiser). Só no teclado (detail 0 = Enter/Espaço): no iPhone um focus()
  // num <select> durante o toque abre a roleta de opções, e no mouse deixaria
  // o anel de foco aceso no seletor sem ninguém ter ido até ele.
  if (elements.facets && elements.gameFilter) {
    elements.facets.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-facet-game]");
      if (!chip) return;
      elements.gameFilter.value = chip.dataset.facetGame;
      elements.gameFilter.dispatchEvent(new Event("change"));
      if (event.detail === 0) elements.gameFilter.focus();
    });
  }

  elements.sortSelect.value = sort;
  elements.sortSelect.addEventListener("change", () => {
    sort = SORTS.includes(elements.sortSelect.value) ? elements.sortSelect.value : "value-desc";
    try { localStorage.setItem("tcg-explore-sort", sort); } catch (e) { /* ignora */ }
    // Reordena o que JÁ está na mão (o resultado inteiro veio da borda) —
    // não é uma busca nova, então não volta à rede.
    if (isSearching()) render({ resetCount: true });
  });

  // Visualização: grade ↔ lista é só a classe da grade; compacta e fichário
  // reconstroem (o HTML do tile muda, e o fichário monta a grade em páginas).
  // Clicar no fichário com ele JÁ ativo troca o nº de bolsos, como nas outras
  // telas. resetCount: false — trocar de vista não devolve quem já rolou a
  // grade pro começo.
  if (elements.viewToggle) {
    shared.applyGridViewClasses(elements.grid, cardsView);
    elements.viewToggle.querySelectorAll("[data-grid-view]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.gridView === cardsView));
    });
    if (binderView) binderView.paintToggle(elements.viewToggle.querySelector('[data-grid-view="binder"]'));
    elements.viewToggle.addEventListener("click", (event) => {
      const button = event.target.closest("[data-grid-view]");
      if (!button) return;
      const eraCompacto = cardsView === "compact";
      const eraBinder = cardsView === "binder";
      const querBinder = button.dataset.gridView === "binder";
      if (querBinder && eraBinder && binderView) binderView.cycle();
      cardsView = shared.gridViewValue(button.dataset.gridView);
      try { localStorage.setItem("tcg-explore-view", cardsView); } catch (e) { /* ignora */ }
      if (eraCompacto !== (cardsView === "compact") || eraBinder || querBinder) { render({ resetCount: false }); return; }
      shared.applyGridViewClasses(elements.grid, cardsView);
      elements.viewToggle.querySelectorAll("[data-grid-view]").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.gridView === cardsView));
      });
    });
  }

  // Barra de filtros recolhível em QUALQUER largura, pelo botão da linha do
  // título — mesmo desenho e MESMA chave de preferência da Coleção: quem gosta
  // de ver a barra aberta lá quer ela aberta aqui.
  if (elements.filtersBtn) {
    let aberta = false;
    try { aberta = localStorage.getItem("tcg-collector-filters-open") === "1"; } catch (e) { /* ignora */ }
    const pintaFiltros = () => {
      if (elements.filters) elements.filters.classList.toggle("is-collapsed", !aberta);
      elements.filtersBtn.setAttribute("aria-expanded", String(aberta));
    };
    elements.filtersBtn.addEventListener("click", () => {
      aberta = !aberta;
      try { localStorage.setItem("tcg-collector-filters-open", aberta ? "1" : "0"); } catch (e) { /* ignora */ }
      pintaFiltros();
    });
    pintaFiltros();
  }

  // Campos da barra: refazem a GRADE, não a busca (a lista base é a mesma).
  [elements.setFilter, elements.langFilter, elements.rarityFilter].forEach((el) => {
    if (el) el.addEventListener("change", () => render({ resetCount: true }));
  });
  [elements.priceMin, elements.priceMax].forEach((el) => {
    if (el) el.addEventListener("input", debounce(() => render({ resetCount: true }), 250));
  });

  // Cotação que chegou DEPOIS da grade (o fetch estourou os 2,5s e a nova
  // tentativa, sem prazo, respondeu): repinta pros preços aparecerem. Só se
  // a grade saiu SEM cotação — a atualização de fundo de um cache de ontem
  // também dispara o evento, e aí os valores já estão na tela: refazer os
  // tiles só faria as imagens piscarem por centavos de diferença.
  document.addEventListener("sleevu:fx-updated", () => {
    if (!pintouSemCambio || !elements.grid.querySelector(".card-tile")) return;
    // Busca nova a caminho (o termo mudou e a borda ainda não respondeu): um
    // render sem lista cairia no catálogo ainda vazio e piscaria "nenhuma
    // carta". A resposta dela já vem com a cotação.
    if (isSearching() && !catalogPronto && (ultimaBase.q !== term() || ultimaBase.game !== gameFilter)) return;
    render({ resetCount: false });
  });

  // Deep-link: /explore?q=pikachu já abre buscando (skeletons + pill do shared).
  const q0 = new URLSearchParams(window.location.search).get("q");
  if (q0) {
    elements.search.value = q0;
    if (isSearching()) {
      shared.showSkeletons(elements.grid, "card", 12);
      apply(); // mesma régua da digitação: borda primeiro, catálogo só se precisar
    }
  }
})();
