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
    topViewed: document.getElementById("exploreTopViewed"),
    topViewedRow: document.getElementById("exploreTopViewedRow")
  };

  const SORTS = ["value-desc", "value-asc", "rarity-desc", "rarity-asc", "release", "num-asc"];
  let sort = SORTS.includes(localStorage.getItem("tcg-explore-sort")) ? localStorage.getItem("tcg-explore-sort") : "value-desc";
  let gameFilter = "all";

  // Stores por jogo + fachadas mescladas (mesmo padrão da Coleção): posse,
  // desejo e preços funcionam pra qualquer carta de qualquer jogo.
  const ownedByGame = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, shared.createCollectionStore(g)]));
  const wishlistByGame = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, shared.createWishlistStore(g)]));
  const pricesByGame = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, shared.createPriceStore(g)]));
  const cardGameMap = new Map();
  const gameOf = (id) => cardGameMap.get(id) || "pokemon";
  const owned = shared.mergedCollectionStore(ownedByGame, gameOf);
  const wishlist = shared.mergedWishlistStore(wishlistByGame, gameOf);
  const prices = shared.mergedPriceStore(pricesByGame, gameOf);
  // Preferência "agrupar versões" (ver cardVariantPairs no shared.js):
  // uma carta = um tile nas grades de catálogo; o + abre o card pra escolher.
  const agrupaVersoes = shared.groupVariantsEnabled();

  let cards = [];
  let cardsById = new Map();
  let catalogPromise = null;
  function ensureCatalog() {
    if (!catalogPromise) {
      catalogPromise = shared.loadAllGamesCatalog().then((catalog) => {
        cards = catalog.cards || [];
        cards.forEach((card) => cardGameMap.set(card.id, card.game));
        cardsById = new Map(cards.map((card) => [card.id, card]));
        return cards;
      }).catch((error) => {
        // Era a ÚNICA página de catálogo sem catch: a promise memoizada rejeitava
        // e os esqueletos ficavam na tela pra sempre. Espelha o cards.js — limpa,
        // mostra o erro e zera a promise pra permitir nova tentativa.
        catalogPromise = null;
        elements.intro.hidden = true;
        elements.grid.innerHTML = "";
        elements.empty.textContent = shared.t("error.catalog", { message: error.message });
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
    if (elements.topViewed) elements.topViewed.hidden = true;
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

  function render(options) {
    const searching = isSearching();
    if (elements.topViewed) elements.topViewed.hidden = true; // mini-row aposentado: vai no grid
    if (!searching) {
      const showTop = topViewedReady && topViewedPairs.length >= 4;
      elements.intro.hidden = showTop;
      elements.empty.hidden = true;
      elements.resultCount.textContent = "";
      if (showTop) {
        elements.resultsHeader.hidden = false;
        if (elements.resultsTitle) elements.resultsTitle.textContent = t("home.topViewed");
        pager.render(topViewedPairs, ({ card, variant }) => shared.variantTile(card, variant, owned, wishlist, prices, { addMode: true, grouped: agrupaVersoes }), { resetCount: true });
      } else {
        elements.resultsHeader.hidden = true;
        pager.render([], () => document.createComment(""), { resetCount: true });
      }
      return;
    }
    elements.intro.hidden = true;
    elements.resultsHeader.hidden = false;
    if (elements.resultsTitle) elements.resultsTitle.textContent = t("results.heading.cards");
    // Filtra ANTES de gerar pares carta×variante (barato mesmo com ~60k cartas).
    // options.list = resultados já resolvidos pela API da borda (apiApply):
    // vêm filtrados por jogo e casados por palavra, só entram no funil daqui.
    const q = term();
    const matched = (options && options.list) || cards.filter((card) =>
      (gameFilter === "all" || card.game === gameFilter) && matchesCardQuery(card, q));
    const pairs = shared.cardVariantPairs(matched, { group: agrupaVersoes });
    const cmp = sortComparator();
    pairs.sort((a, b) =>
      (Number(shared.cardHasImage(b.card)) - Number(shared.cardHasImage(a.card))) || cmp(a, b));
    pager.render(pairs, ({ card, variant }) => shared.variantTile(card, variant, owned, wishlist, prices, { addMode: true, grouped: agrupaVersoes }), options || {});
    elements.empty.hidden = pairs.length > 0;
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
  async function apiApply() {
    const seq = ++apiSeq;
    if (!elements.grid.querySelector(".card-tile")) shared.showSkeletons(elements.grid, "card", 8);
    const hits = await shared.searchApi(gameFilter === "all" ? "all" : gameFilter, term(), 60);
    if (seq !== apiSeq) return;
    if (!hits) { renderFromCatalog(); return; } // API desligada: caminho de sempre
    const idsByGame = Object.create(null); // g vem do D1, mas null-proto evita surpresa com "constructor" etc.
    hits.forEach((h) => { const g = h.g || "pokemon"; (idsByGame[g] = idsByGame[g] || []).push(h.i); });
    let catalog = { cards: [] };
    if (hits.length) {
      try { catalog = await shared.loadOwnedAcrossGames(idsByGame); }
      catch (e) { renderFromCatalog(); return; }
    }
    if (seq !== apiSeq) return;
    const byId = new Map((catalog.cards || []).map((c) => [c.id, c]));
    const found = [];
    hits.forEach((h) => {
      const card = byId.get(h.i);
      if (!card) return;
      // registra pro preview/posse/preço funcionarem igual ao caminho completo
      cardGameMap.set(card.id, card.game);
      cardsById.set(card.id, card);
      found.push(card);
    });
    render({ resetCount: true, list: found });
  }

  const apply = () => {
    writeUrl();
    if (catalogPromise) { renderFromCatalog(); return; }
    if (!isSearching()) { render({ resetCount: true }); return; }
    apiApply();
  };
  elements.search.addEventListener("input", debounce(apply, 250));

  // Jogo é um <select> ao lado do Ordenar (eram 13 chips numa faixa inteira).
  // Opções reconstruídas de GAME_SLUGS: jogo novo no registro aparece sozinho,
  // mesma garantia que os chips antigos tinham via initGameFilterChips.
  if (elements.gameFilter) {
    elements.gameFilter.innerHTML = `<option value="all">${shared.escapeHtml(shared.t("filter.gameAll"))}</option>`
      + shared.GAME_SLUGS.map((g) => `<option value="${g}">${shared.escapeHtml(shared.gameLabel(g))}</option>`).join("");
    elements.gameFilter.value = gameFilter;
    elements.gameFilter.addEventListener("change", () => {
      gameFilter = shared.GAME_SLUGS.includes(elements.gameFilter.value) ? elements.gameFilter.value : "all";
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
