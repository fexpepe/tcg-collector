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
    resultCount: document.getElementById("exploreResultCount"),
    gameFilter: document.getElementById("exploreGameFilter"),
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
      });
    }
    return catalogPromise;
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
  let topViewedReady = false;
  (async function renderTopViewed() {
    if (!elements.topViewed || !elements.topViewedRow || !shared.fetchTopViewed) return;
    try {
      const games = shared.GAME_SLUGS || ["pokemon", "lorcana"];
      const perGame = await Promise.all(games.map((g) => shared.fetchTopViewed(g, 8)));
      const tops = games.flatMap((g, i) => perGame[i].map((x) => ({ id: x.card_id, views: x.views, game: g })))
        .filter((x) => x.views >= 2)
        .sort((a, b) => b.views - a.views)
        .slice(0, 6);
      if (tops.length < 4) return;
      const idsByGame = {};
      games.forEach((g) => { idsByGame[g] = tops.filter((x) => x.game === g).map((x) => x.id); });
      const catalog = await shared.loadOwnedAcrossGames(idsByGame);
      const byId = new Map((catalog.cards || []).map((c) => [c.id, c]));
      const html = tops.map(({ id, views }) => {
        const card = byId.get(id);
        if (!card) return "";
        const src = shared.cardImageSources(card);
        const img = shared.localizedImg(src.url, { alt: card.name, fallback: src.fallback, loading: "lazy", thumb: true });
        return `<a class="home-top-card" href="${shared.escapeAttribute(shared.detailUrl("set", card.set, "", card.game))}">
          <span class="home-top-img">${img}</span>
          <strong>${shared.escapeHtml(card.name)}</strong>
          <span class="home-top-views">${shared.escapeHtml(String(views))} 👁</span>
        </a>`;
      }).join("");
      if (!html) return;
      elements.topViewedRow.innerHTML = html;
      topViewedReady = true;
      elements.topViewed.hidden = isSearching();
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
    elements.intro.hidden = searching;
    if (elements.topViewed) elements.topViewed.hidden = searching || !topViewedReady;
    elements.resultsHeader.hidden = !searching;
    if (!searching) {
      pager.render([], () => document.createComment(""), { resetCount: true });
      elements.empty.hidden = true;
      elements.resultCount.textContent = "";
      return;
    }
    // Filtra ANTES de gerar pares carta×variante (barato mesmo com ~60k cartas).
    const q = term();
    const matched = cards.filter((card) =>
      (gameFilter === "all" || card.game === gameFilter) && matchesCardQuery(card, q));
    const pairs = shared.cardVariantPairs(matched);
    const cmp = sortComparator();
    pairs.sort((a, b) =>
      (Number(shared.cardHasImage(b.card)) - Number(shared.cardHasImage(a.card))) || cmp(a, b));
    pager.render(pairs, ({ card, variant }) => shared.variantTile(card, variant, owned, wishlist, prices, { addMode: true }), options || {});
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

  const apply = () => { writeUrl(); ensureCatalog().then(() => render({ resetCount: true })); };
  elements.search.addEventListener("input", debounce(apply, 250));

  elements.gameFilter.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-game-filter]");
    if (!chip) return;
    gameFilter = chip.dataset.gameFilter;
    elements.gameFilter.querySelectorAll(".chip").forEach((b) =>
      b.setAttribute("aria-pressed", String(b === chip)));
    shared.applyGameAccent(gameFilter);
    if (isSearching()) apply();
  });

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
      ensureCatalog().then(() => render({ resetCount: true }));
    }
  }
})();
