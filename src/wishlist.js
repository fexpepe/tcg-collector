(function () {
  const shared = window.TCGShared;
  const { addOptions, unique, normalize, speciesName, debounce, t, tn } = shared;

  let cards = [];
  let cardsById = new Map();
  const owned = shared.createCollectionStore();
  const wishlist = shared.createWishlistStore();
  const prices = shared.createPriceStore();

  const elements = {
    grid: document.getElementById("cardGrid"),
    empty: document.getElementById("emptyState"),
    search: document.getElementById("searchInput"),
    pokemonFilter: document.getElementById("pokemonFilter"),
    setFilter: document.getElementById("setFilter"),
    languageFilter: document.getElementById("languageFilter"),
    distinctCount: document.getElementById("distinctCount"),
    setsCount: document.getElementById("setsCount"),
    resultCount: document.getElementById("resultCount"),
    exportButton: document.getElementById("exportButton"),
    importInput: document.getElementById("importInput")
  };

  const pager = shared.createPager({ grid: elements.grid, pageSize: 60 });

  const preview = shared.createCardPreview({
    getCard: (cardId) => cardsById.get(cardId),
    store: owned,
    prices,
    wishlist,
    onOwnedChange: () => refresh()
  });

  shared.loadCatalog()
    .then((catalog) => {
      cards = catalog.cards;
      cardsById = new Map(cards.map((card) => [card.id, card]));
      owned.migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId)));
      hydrateFilters();
      bindEvents();
      render();
    })
    .catch((error) => {
      elements.empty.textContent = t("error.catalog", { message: error.message });
      elements.empty.hidden = false;
    });

  // Cartas com pelo menos uma variante na lista de desejos.
  function wantedCards() {
    return cards.filter((card) => wishlist.hasCard(card.id));
  }

  function hydrateFilters() {
    const myCards = wantedCards();
    addOptions(elements.pokemonFilter, unique(myCards.map((card) => card.pokemonName || speciesName(card.name))));
    addOptions(elements.setFilter, unique(myCards.map((card) => card.set)));
    addOptions(elements.languageFilter, unique(myCards.map((card) => card.language)), (value) => shared.cardLanguageLabel(value));
    const pref = shared.getCardLang();
    if (pref !== "all" && Array.from(elements.languageFilter.options).some((option) => option.value === pref)) {
      elements.languageFilter.value = pref;
    }
  }

  function bindEvents() {
    const applyFilters = () => render({ resetCount: true });
    elements.search.addEventListener("input", debounce(applyFilters, 200));
    [elements.pokemonFilter, elements.setFilter, elements.languageFilter].forEach((element) => {
      element.addEventListener("input", applyFilters);
    });

    elements.grid.addEventListener("click", (event) => {
      const imageButton = event.target.closest("[data-preview-card-id]");
      if (imageButton) {
        preview.open(imageButton.dataset.previewCardId, imageButton.dataset.previewVariant);
        return;
      }

      // Remover do desejo (♥) ou marcar como tenho ("comprei!") — ambos tiram
      // a variante da lista, então o tile sai da grade.
      if (shared.handleWantTileClick(event, wishlist) || shared.handleOwnedTileClick(event, owned, wishlist)) {
        refresh();
      }
    });

    shared.bindCollectionTransfer({
      exportButton: elements.exportButton,
      importInput: elements.importInput,
      store: owned,
      wishlist,
      prices,
      cards,
      onChange: () => render()
    });
  }

  // Pares carta×variante que estão na lista de desejos e batem nos filtros.
  function wantedPairs() {
    return shared.cardVariantPairs(filterCards())
      .filter(({ card, variant }) => wishlist.has(card.id, variant))
      // Cartas sem imagem por último (sort estável preserva a ordem restante).
      .sort((a, b) => Number(shared.cardHasImage(b.card)) - Number(shared.cardHasImage(a.card)));
  }

  function render({ resetCount = false } = {}) {
    const tiles = wantedPairs();
    pager.render(tiles, ({ card, variant }) => shared.variantTile(card, variant, owned, wishlist), { resetCount });
    updateStats(tiles.length);
  }

  // Remove do DOM os tiles cuja variante saiu do desejo, sem reconstruir a
  // grade inteira (evita o "piscar" das imagens). Se a lista esvaziar com os
  // filtros atuais, mostra o estado vazio adequado.
  function refresh() {
    elements.grid.querySelectorAll(".card-tile").forEach((tile) => {
      if (wishlist.has(tile.dataset.tileCardId, tile.dataset.tileVariant)) {
        shared.refreshTileOwnership(tile, owned, wishlist);
      } else {
        tile.remove();
      }
    });
    updateStats(wantedPairs().length);
  }

  function updateStats(tileCount) {
    const myCards = wantedCards();
    elements.empty.hidden = tileCount > 0;
    if (!tileCount) {
      elements.empty.dataset.i18nHtml = wishlist.size ? "empty.wishlistFiltered" : "empty.wishlist";
      elements.empty.innerHTML = t(elements.empty.dataset.i18nHtml);
    }
    elements.resultCount.textContent = tn("results.count", tileCount);
    elements.distinctCount.textContent = myCards.length;
    elements.setsCount.textContent = unique(myCards.map((card) => card.set)).length;
  }

  function filterCards() {
    const pokemonValue = elements.pokemonFilter.value;
    const setValue = elements.setFilter.value;
    const languageValue = elements.languageFilter.value;

    return wantedCards().filter((card) => {
      const matchesQuery = shared.matchesCardQuery(card, elements.search.value);
      const matchesPokemon = !pokemonValue || (card.pokemonName || speciesName(card.name)) === pokemonValue;
      const matchesSet = !setValue || card.set === setValue;
      const matchesLanguage = !languageValue || card.language === languageValue;

      return matchesQuery && matchesPokemon && matchesSet && matchesLanguage;
    });
  }
})();
