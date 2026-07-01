(function () {
  const shared = window.TCGShared;
  const { addOptions, unique, normalize, speciesName, debounce, t, tn } = shared;

  let cards = [];
  let cardsById = new Map();
  let gameFilter = "all"; // all | pokemon | lorcana

  // Ordenação + grade/lista (paridade com a Coleção), persistidas em chaves
  // próprias da wishlist.
  const CARDS_SORTS = ["value-desc", "value-asc", "num-asc", "num-desc", "release"];
  let cardsSort = CARDS_SORTS.includes(localStorage.getItem("tcg-wishlist-sort")) ? localStorage.getItem("tcg-wishlist-sort") : "value-desc";
  let cardsView = localStorage.getItem("tcg-wishlist-view") === "list" ? "list" : "grid";

  // Wishlist UNIFICADA: stores por jogo + facades que despacham por jogo (cardGameMap).
  const ownedByGame = { pokemon: shared.createCollectionStore("pokemon"), lorcana: shared.createCollectionStore("lorcana") };
  const wishlistByGame = { pokemon: shared.createWishlistStore("pokemon"), lorcana: shared.createWishlistStore("lorcana") };
  const pricesByGame = { pokemon: shared.createPriceStore("pokemon"), lorcana: shared.createPriceStore("lorcana") };
  const cardGameMap = new Map();
  const gameOf = (id) => cardGameMap.get(id) || "pokemon";
  const owned = shared.mergedCollectionStore(ownedByGame, gameOf);
  const wishlist = shared.mergedWishlistStore(wishlistByGame, gameOf);
  const prices = shared.mergedPriceStore(pricesByGame, gameOf);

  const elements = {
    gameFilter: document.getElementById("gameFilter"),
    grid: document.getElementById("cardGrid"),
    empty: document.getElementById("emptyState"),
    search: document.getElementById("searchInput"),
    pokemonFilter: document.getElementById("pokemonFilter"),
    setFilter: document.getElementById("setFilter"),
    languageFilter: document.getElementById("languageFilter"),
    cardsSortSelect: document.getElementById("cardsSortSelect"),
    cardsViewToggle: document.getElementById("cardsViewToggle"),
    distinctCount: document.getElementById("distinctCount"),
    setsCount: document.getElementById("setsCount"),
    wishlistValue: document.getElementById("wishlistValue"),
    resultCount: document.getElementById("resultCount")
  };

  const pager = shared.createPager({ grid: elements.grid, pageSize: 60 });

  const preview = shared.createCardPreview({
    getCard: (cardId) => cardsById.get(cardId),
    store: owned,
    prices,
    wishlist,
    onOwnedChange: () => refresh()
  });

  // Wishlist unificada: carrega as desejadas (+ as possuídas, pra migração e pro
  // indicador "tenho") dos DOIS jogos, marcando card.game.
  const idsFor = (g) => [...new Set([...wishlistByGame[g].knownCardIds(), ...ownedByGame[g].knownCardIds()])];
  // Liga os controles JÁ (filtro/busca) — não dependem do catálogo; assim os
  // botões nunca ficam "mortos" se o carregamento demorar/falhar.
  bindEvents();
  Promise.all([
    shared.loadOwnedAcrossGames({ pokemon: idsFor("pokemon"), lorcana: idsFor("lorcana") }),
    shared.loadFxRates()
  ])
    .then(([catalog]) => {
      cards = catalog.cards;
      cards.forEach((card) => cardGameMap.set(card.id, card.game));
      cardsById = new Map(cards.map((card) => [card.id, card]));
      Object.keys(ownedByGame).forEach((g) =>
        ownedByGame[g].migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId))));
      hydrateFilters();
      render();
    })
    .catch((error) => {
      elements.empty.textContent = t("error.catalog", { message: error.message });
      elements.empty.hidden = false;
    });

  function inGameFilter(card) {
    return gameFilter === "all" || card.game === gameFilter;
  }

  // Cartas com pelo menos uma variante na lista de desejos.
  function wantedCards() {
    return cards.filter((card) => inGameFilter(card) && wishlist.hasCard(card.id));
  }

  function hydrateFilters() {
    const myCards = wantedCards();
    addOptions(elements.pokemonFilter, unique(myCards.map((card) => card.pokemonName || speciesName(card.name))));
    addOptions(elements.setFilter, unique(myCards.map((card) => card.set)));
    addOptions(elements.languageFilter, unique(myCards.map((card) => card.language)), (value) => {
      const emoji = shared.cardFlagEmoji(value);
      return (emoji ? emoji + " " : "") + shared.cardLanguageLabel(value);
    });
    const pref = shared.getCardLang();
    if (pref !== "all" && Array.from(elements.languageFilter.options).some((option) => option.value === pref)) {
      elements.languageFilter.value = pref;
    }
  }

  // 1º filtro: Pokémon (espécie) / Personagens (Lorcana), conforme o jogo.
  function updatePokemonFilterLabel() {
    const label = document.querySelector('label[for="pokemonFilter"]');
    if (label) label.textContent = gameFilter === "lorcana" ? t("toolbar.characters") : t("toolbar.pokemon");
  }

  function bindEvents() {
    if (elements.cardsSortSelect) {
      elements.cardsSortSelect.value = cardsSort;
      elements.cardsSortSelect.addEventListener("change", () => {
        cardsSort = elements.cardsSortSelect.value;
        localStorage.setItem("tcg-wishlist-sort", cardsSort);
        render({ resetCount: true });
      });
    }
    if (elements.cardsViewToggle) {
      applyCardsView();
      elements.cardsViewToggle.addEventListener("click", (event) => {
        const button = event.target.closest("[data-grid-view]");
        if (!button) return;
        cardsView = button.dataset.gridView === "list" ? "list" : "grid";
        localStorage.setItem("tcg-wishlist-view", cardsView);
        applyCardsView();
      });
    }

    elements.gameFilter.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-game-filter]");
      if (!chip || chip.dataset.gameFilter === gameFilter) return;
      gameFilter = chip.dataset.gameFilter;
      Array.from(elements.gameFilter.children).forEach((node) => {
        node.setAttribute("aria-pressed", node === chip ? "true" : "false");
      });
      render({ resetCount: true });
    });

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
  }

  // Pares carta×variante que estão na lista de desejos e batem nos filtros.
  // Critério primário: carta com imagem antes; secundário: a ordenação escolhida.
  function wantedPairs() {
    const cmp = sortComparator();
    return shared.cardVariantPairs(filterCards())
      .filter(({ card, variant }) => wishlist.has(card.id, variant))
      .sort((a, b) =>
        (Number(shared.cardHasImage(b.card)) - Number(shared.cardHasImage(a.card))) || cmp(a, b));
  }

  // Comparador do seletor de ordenação (mesma lógica da Coleção/Explorar).
  function sortComparator() {
    const priceOf = shared.memoValue((p) => shared.cardValue(p.card, p.variant, prices, shared.DEFAULT_CONDITION).value || 0);
    const byNum = (a, b) => shared.compareCardNumbers(a.card.number, b.card.number);
    if (cardsSort === "num-asc") return byNum;
    if (cardsSort === "num-desc") return (a, b) => byNum(b, a);
    if (cardsSort === "value-asc") return (a, b) => {
      const pa = priceOf(a), pb = priceOf(b);
      if (!pa && !pb) return 0; if (!pa) return 1; if (!pb) return -1; return pa - pb;
    };
    if (cardsSort === "release") return (a, b) => String(b.card.setReleaseDate || "").localeCompare(String(a.card.setReleaseDate || ""));
    return (a, b) => priceOf(b) - priceOf(a); // value-desc (padrão)
  }

  // Alterna grade/lista (mesma classe .is-list) e reflete nos botões.
  function applyCardsView() {
    if (elements.grid) elements.grid.classList.toggle("is-list", cardsView === "list");
    if (elements.cardsViewToggle) {
      elements.cardsViewToggle.querySelectorAll("[data-grid-view]").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.gridView === cardsView));
      });
    }
  }

  function render({ resetCount = false } = {}) {
    updatePokemonFilterLabel();
    const tiles = wantedPairs();
    pager.render(tiles, ({ card, variant }) => shared.variantTile(card, variant, owned, wishlist, prices), { resetCount });
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
    if (elements.wishlistValue) {
      let total = 0;
      myCards.forEach((card) => {
        wishlist.variants(card.id).forEach((variant) => {
          total += shared.cardValue(card, variant, prices).value;
        });
      });
      elements.wishlistValue.textContent = total > 0 ? shared.formatMoney(shared.getCurrency(), total) : "—";
    }
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
