(function () {
  const shared = window.TCGShared;
  const { addOptions, unique, debounce, t, tn } = shared;

  let cards = [];
  let cardsById = new Map();
  const owned = shared.createCollectionStore();
  const wishlist = shared.createWishlistStore();
  const prices = shared.createPriceStore();

  const elements = {
    grid: document.getElementById("cardGrid"),
    empty: document.getElementById("emptyState"),
    intro: document.getElementById("cardsIntro"),
    resultsHeader: document.getElementById("resultsHeader"),
    resultCount: document.getElementById("resultCount"),
    search: document.getElementById("searchInput"),
    setFilter: document.getElementById("setFilter"),
    languageFilter: document.getElementById("languageFilter"),
    rarityFilter: document.getElementById("rarityFilter")
  };

  const pager = shared.createPager({ grid: elements.grid, pageSize: 60 });

  const preview = shared.createCardPreview({
    getCard: (cardId) => cardsById.get(cardId),
    store: owned,
    prices,
    wishlist,
    onOwnedChange: () => refreshOwnership()
  });

  // Catálogo inteiro (em produção, baixado dos chunks do manifest, como na
  // Pokédex). A página só renderiza cartas quando há busca/filtro ativo.
  Promise.all([shared.loadCatalog(), shared.loadFxRates()])
    .then(([catalog]) => {
      cards = catalog.cards || [];
      cardsById = new Map(cards.map((card) => [card.id, card]));
      owned.migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId)));
      hydrateFilters();
      bindEvents();
      render();
    })
    .catch((error) => {
      elements.intro.hidden = true;
      elements.empty.textContent = t("error.catalog", { message: error.message });
      elements.empty.hidden = false;
    });

  function hydrateFilters() {
    addOptions(elements.setFilter, unique(cards.map((card) => card.set)));
    addOptions(elements.languageFilter, unique(cards.map((card) => card.language)), (value) => shared.cardLanguageLabel(value));
    applyCardLangDefault(elements.languageFilter);
    addOptions(elements.rarityFilter, unique(cards.map((card) => card.rarity)));
  }

  // Idioma de carta preferido como valor inicial do filtro (se existir nas opções).
  function applyCardLangDefault(select) {
    const pref = shared.getCardLang();
    if (pref !== "all" && Array.from(select.options).some((option) => option.value === pref)) {
      select.value = pref;
    }
  }

  function bindEvents() {
    const apply = () => render({ resetCount: true });
    elements.search.addEventListener("input", debounce(apply, 200));
    [elements.setFilter, elements.languageFilter, elements.rarityFilter].forEach((element) => {
      element.addEventListener("input", apply);
    });

    elements.grid.addEventListener("click", (event) => {
      const imageButton = event.target.closest("[data-preview-card-id]");
      if (imageButton) {
        preview.open(imageButton.dataset.previewCardId, imageButton.dataset.previewVariant);
        return;
      }
      if (shared.handleWantTileClick(event, wishlist)) { refreshOwnership(); return; }
      if (shared.handleOwnedTileClick(event, owned, wishlist)) { refreshOwnership(); }
    });
  }

  // Só busca quando há texto na busca ou um filtro de set/raridade ativo. Sem
  // isso, a página fica "vazia" (placeholder do futuro "em alta").
  function isSearching() {
    return !!(elements.search.value.trim() || elements.setFilter.value || elements.rarityFilter.value);
  }

  function filterCards() {
    const setValue = elements.setFilter.value;
    const languageValue = elements.languageFilter.value;
    const rarityValue = elements.rarityFilter.value;
    return cards.filter((card) => {
      return shared.matchesCardQuery(card, elements.search.value)
        && (!setValue || card.set === setValue)
        && (!languageValue || card.language === languageValue)
        && (!rarityValue || card.rarity === rarityValue);
    });
  }

  function tilePairs() {
    return shared.cardVariantPairs(filterCards())
      // Cartas sem imagem por último (sort estável preserva o resto).
      .sort((a, b) => Number(shared.cardHasImage(b.card)) - Number(shared.cardHasImage(a.card)));
  }

  function render(options) {
    const searching = isSearching();
    elements.intro.hidden = searching;
    elements.resultsHeader.hidden = !searching;
    if (!searching) {
      pager.render([], () => document.createComment(""), { resetCount: true });
      elements.empty.hidden = true;
      elements.resultCount.textContent = "";
      return;
    }
    const tiles = tilePairs();
    pager.render(tiles, ({ card, variant }) => shared.variantTile(card, variant, owned, wishlist, prices), options || {});
    elements.empty.hidden = tiles.length > 0;
    elements.resultCount.textContent = tn("results.count", tiles.length);
  }

  // Atualiza posse/desejo dos tiles no DOM existente, sem reconstruir a grade.
  function refreshOwnership() {
    elements.grid.querySelectorAll(".card-tile").forEach((tile) => {
      shared.refreshTileOwnership(tile, owned, wishlist);
    });
  }
})();
