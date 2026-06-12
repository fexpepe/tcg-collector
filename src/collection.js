(function () {
  const shared = window.TCGShared;
  const { addOptions, unique, normalize, speciesName, debounce, t, tn } = shared;

  let cards = [];
  let cardsById = new Map();
  const owned = shared.createCollectionStore();

  const elements = {
    grid: document.getElementById("cardGrid"),
    empty: document.getElementById("emptyState"),
    search: document.getElementById("searchInput"),
    pokemonFilter: document.getElementById("pokemonFilter"),
    setFilter: document.getElementById("setFilter"),
    languageFilter: document.getElementById("languageFilter"),
    rarityFilter: document.getElementById("rarityFilter"),
    distinctCount: document.getElementById("distinctCount"),
    copiesCount: document.getElementById("copiesCount"),
    setsCount: document.getElementById("setsCount"),
    resultCount: document.getElementById("resultCount"),
    exportButton: document.getElementById("exportButton"),
    importInput: document.getElementById("importInput")
  };

  const pager = shared.createPager({ grid: elements.grid, pageSize: 60 });

  const preview = shared.createCardPreview({
    getCard: (cardId) => cardsById.get(cardId),
    store: owned,
    onOwnedChange: () => render()
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

  function ownedCards() {
    return cards.filter((card) => owned.has(card.id));
  }

  function hydrateFilters() {
    const myCards = ownedCards();
    addOptions(elements.pokemonFilter, unique(myCards.map((card) => card.pokemonName || speciesName(card.name))));
    addOptions(elements.setFilter, unique(myCards.map((card) => card.set)));
    addOptions(elements.languageFilter, unique(myCards.map((card) => card.language)));
    addOptions(elements.rarityFilter, unique(myCards.map((card) => card.rarity)));
  }

  function bindEvents() {
    const applyFilters = () => render({ resetCount: true });
    elements.search.addEventListener("input", debounce(applyFilters, 200));
    [elements.pokemonFilter, elements.setFilter, elements.languageFilter, elements.rarityFilter].forEach((element) => {
      element.addEventListener("input", applyFilters);
    });

    elements.grid.addEventListener("click", (event) => {
      const imageButton = event.target.closest("[data-preview-card-id]");
      if (imageButton) {
        preview.open(imageButton.dataset.previewCardId);
        return;
      }

      if (shared.handleQuantityClick(event, owned)) {
        render();
        return;
      }

      const button = event.target.closest("[data-card-id]");
      if (!button) return;
      const card = cardsById.get(button.dataset.cardId);
      if (!card) return;
      owned.toggle(card);
      render();
    });

    shared.bindCollectionTransfer({
      exportButton: elements.exportButton,
      importInput: elements.importInput,
      store: owned,
      cards,
      onChange: () => render()
    });
  }

  function render({ resetCount = false } = {}) {
    const visibleCards = filterCards();
    pager.render(visibleCards, (card) => shared.cardElement(card, owned), { resetCount });

    const myCards = ownedCards();
    elements.empty.hidden = visibleCards.length > 0;
    elements.resultCount.textContent = tn("results.count", visibleCards.length);
    elements.distinctCount.textContent = myCards.length;
    elements.copiesCount.textContent = owned.totalQuantity();
    elements.setsCount.textContent = unique(myCards.map((card) => card.set)).length;
  }

  function filterCards() {
    const query = normalize(elements.search.value);
    const pokemonValue = elements.pokemonFilter.value;
    const setValue = elements.setFilter.value;
    const languageValue = elements.languageFilter.value;
    const rarityValue = elements.rarityFilter.value;

    return ownedCards().filter((card) => {
      const matchesQuery = !query || normalize([
        card.name,
        card.pokemonName,
        card.dexId,
        card.number,
        card.set,
        card.artist,
        card.rarity,
        card.language,
        ...(card.variants || [])
      ].join(" ")).includes(query);
      const matchesPokemon = !pokemonValue || (card.pokemonName || speciesName(card.name)) === pokemonValue;
      const matchesSet = !setValue || card.set === setValue;
      const matchesLanguage = !languageValue || card.language === languageValue;
      const matchesRarity = !rarityValue || card.rarity === rarityValue;

      return matchesQuery && matchesPokemon && matchesSet && matchesLanguage && matchesRarity;
    });
  }
})();
