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

  const SORTS = ["value-desc", "value-asc", "rarity-desc", "rarity-asc", "release", "num-asc"];
  let sort = SORTS.includes(localStorage.getItem("tcg-explore-sort")) ? localStorage.getItem("tcg-explore-sort") : "value-desc";
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
    ensureCatalog().then(() => render({ resetCount: true })).catch(() => { /* erro já exibido */ });
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
      const catalog = await shared.loadOwnedAcrossGames(idsByGame);
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
  // da página" pra listar set e raridade de antemão (o catálogo dos 14 jogos
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

  // Um tile no modo de visualização atual: o compacto muda o HTML (sem <img>),
  // não só a classe da grade.
  const tileDe = ({ card, variant }) => shared.variantTile(card, variant, owned, wishlist, prices,
    { addMode: true, grouped: agrupaVersoes, compact: cardsView === "compact" });

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

  // Última lista base pintada e o termo dela (ver o comentário no render).
  let ultimaBase = { q: "", list: null };
  function render(options) {
    const searching = isSearching();
    if (!searching) {
      const showTop = topViewedReady && topViewedPairs.length >= 4;
      elements.intro.hidden = showTop;
      elements.resultCount.textContent = "";
      elements.resultsHeader.hidden = !showTop;
      if (elements.filters) elements.filters.hidden = !showTop;
      if (!showTop) {
        elements.empty.hidden = true;
        pintaGrade([], { resetCount: true });
        return;
      }
      if (elements.resultsTitle) elements.resultsTitle.textContent = t("home.topViewed");
      atualizaOpcoes(topViewedPairs.map((par) => par.card));
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
    // options.list = resultados já resolvidos pela API da borda (apiApply):
    // vêm filtrados por jogo e casados por palavra, só entram no funil daqui.
    const q = term();
    // A base é a lista da borda (options.list) quando ela veio, o catálogo
    // completo quando ele chegou — e, no meio do caminho, a ÚLTIMA lista
    // pintada pra este mesmo termo. Sem essa memória, qualquer re-render sem
    // options (trocar a vista, mexer num filtro, ligar o "Agrupar") caía no
    // `cards` ainda vazio e esvaziava a grade com um "nada encontrado".
    const matched = (options && options.list)
      || ((!catalogPronto && ultimaBase.list && ultimaBase.q === q) ? ultimaBase.list
        : cards.filter((card) => shared.cardMatchesGameFilter(card, gameFilter) && matchesCardQuery(card, q)));
    ultimaBase = { q, list: matched };
    atualizaOpcoes(matched);
    const pairs = shared.cardVariantPairs(matched.filter(passaNosFiltros), { group: agrupaVersoes });
    const cmp = sortComparator();
    pairs.sort((a, b) =>
      (Number(shared.cardHasImage(b.card)) - Number(shared.cardHasImage(a.card))) || cmp(a, b));
    pintaGrade(pairs, options || {});
    elements.empty.hidden = pairs.length > 0;
    // "Nenhuma carta em nenhum jogo" é resposta da BUSCA; com filtro ligado o
    // que sobrou de fora foi a barra, e a mensagem tem que dizer isso.
    if (!pairs.length) elements.empty.textContent = t(temFiltro() && matched.length ? "empty.pokedex" : "explore.empty");
    elements.resultCount.textContent = tn("results.count", pairs.length);
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

  // Busca pela BORDA enquanto o catálogo completo não desceu: a /api/search
  // responde nome/set/número/artista de TODOS os jogos em poucos KB e só as
  // ≤60 cartas exibidas são hidratadas (os chunks dos sets delas). O catálogo
  // inteiro — o maior download do site, dezenas de MB — só desce se a API
  // estiver desligada. Depois que ele chegou (catalogPromise existe), a busca
  // local de sempre segue valendo: instantânea, sem rede e sem teto de 60.
  let apiSeq = 0;
  const VINTAGE_GAMES = ["pokemon", "onepiece", "naruto", "hxh"]; // os que têm carta vintage (ver isVintageCard)
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
    if (!elements.grid.querySelector(".card-tile")) shared.showSkeletons(elements.grid, "card", 8);
    // "Vintage" não existe na borda (é corte por carta, não coluna do D1):
    // busca nos jogos que TÊM linha vintage e peneira as cartas hidratadas
    // com isVintageCard, mais abaixo.
    const vintage = gameFilter === shared.VINTAGE_FILTER;
    const hits = vintage
      ? (await Promise.all(VINTAGE_GAMES.map((g) => shared.searchApi(g, q, 60)))).flat().filter(Boolean)
      : await shared.searchApi(gameFilter === "all" ? "all" : gameFilter, q, 60);
    if (seq !== apiSeq || catalogPronto) return; // o catálogo chegou no meio: o render dele já cobre
    // VAZIO não é resposta final — só o catálogo local pode afirmar "essa
    // carta não existe". A borda responde vazio quando o banco está em recarga
    // (deploy) ou quando um vazio antigo ficou preso em cache; antes isto
    // virava um "nenhum resultado" definitivo na cara do usuário, sem nunca
    // consultar o catálogo. null (desligada/soluço) cai no mesmo caminho.
    if (!hits || !hits.length) { renderFromCatalog(); return; }
    const idsByGame = Object.create(null); // g vem do D1, mas null-proto evita surpresa com "constructor" etc.
    hits.forEach((h) => { const g = h.g || "pokemon"; (idsByGame[g] = idsByGame[g] || []).push(h.i); });
    let catalog = { cards: [] };
    try { catalog = await shared.loadOwnedAcrossGames(idsByGame); }
    catch (e) { renderFromCatalog(); return; }
    if (seq !== apiSeq || catalogPronto) return;
    const byId = new Map((catalog.cards || []).map((c) => [c.id, c]));
    const found = [];
    hits.forEach((h) => {
      const card = byId.get(h.i);
      if (!card || (vintage && !shared.isVintageCard(card))) return;
      // registra pro preview/posse/preço funcionarem igual ao caminho completo
      cardGameMap.set(card.id, card.game);
      cardsById.set(card.id, card);
      found.push(card);
    });
    // Hits sem carta na hidratação (índice da borda à frente dos chunks, ou
    // vice-versa): mesma regra do vazio — o catálogo decide.
    if (!found.length) { renderFromCatalog(); return; }
    // A borda casa por PALAVRA (número e total soltos): "009/094" traz também
    // a EB03-009 de um set de 94 cartas. Com a carta inteira na mão, a régua
    // do cliente (token inteiro) peneira; se ela rejeitar tudo, é gap da
    // régua e não da borda — fica com os hits como vieram.
    const precisos = found.filter((card) => matchesCardQuery(card, q));
    render({ resetCount: true, list: precisos.length ? precisos : found });
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

  elements.sortSelect.value = sort;
  elements.sortSelect.addEventListener("change", () => {
    sort = SORTS.includes(elements.sortSelect.value) ? elements.sortSelect.value : "value-desc";
    try { localStorage.setItem("tcg-explore-sort", sort); } catch (e) { /* ignora */ }
    if (isSearching()) apply();
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
