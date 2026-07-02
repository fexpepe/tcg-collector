(function () {
  const shared = window.TCGShared;
  const { addOptions, unique, debounce, t, tn } = shared;

  let cards = [];
  let cardsById = new Map();
  const owned = shared.createCollectionStore();
  const wishlist = shared.createWishlistStore();
  const prices = shared.createPriceStore();

  // Ordenação/visualização da grade (persistidas, chaves próprias da página de
  // busca — independentes da Coleção). Mesmas opções dos dois lugares.
  const CARDS_SORTS = ["value-desc", "value-asc", "num-asc", "num-desc", "release"];
  let cardsSort = CARDS_SORTS.includes(localStorage.getItem("tcg-cards-sort")) ? localStorage.getItem("tcg-cards-sort") : "value-desc";
  let cardsView = localStorage.getItem("tcg-cards-view") === "list" ? "list" : "grid";

  const elements = {
    grid: document.getElementById("cardGrid"),
    empty: document.getElementById("emptyState"),
    intro: document.getElementById("cardsIntro"),
    resultsHeader: document.getElementById("resultsHeader"),
    resultCount: document.getElementById("resultCount"),
    search: document.getElementById("searchInput"),
    setFilter: document.getElementById("setFilter"),
    languageFilter: document.getElementById("languageFilter"),
    rarityFilter: document.getElementById("rarityFilter"),
    cardsSortSelect: document.getElementById("cardsSortSelect"),
    cardsViewToggle: document.getElementById("cardsViewToggle")
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
      // Deep-link de busca (?q=...): usado pela busca global (Ctrl+K) de outras páginas.
      const q = new URLSearchParams(window.location.search).get("q");
      if (q && elements.search) elements.search.value = q;
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

    if (elements.cardsSortSelect) {
      elements.cardsSortSelect.value = cardsSort;
      elements.cardsSortSelect.addEventListener("change", () => {
        cardsSort = elements.cardsSortSelect.value;
        localStorage.setItem("tcg-cards-sort", cardsSort);
        render({ resetCount: true });
      });
    }
    if (elements.cardsViewToggle) {
      applyCardsView();
      elements.cardsViewToggle.addEventListener("click", (event) => {
        const button = event.target.closest("[data-grid-view]");
        if (!button) return;
        cardsView = button.dataset.gridView === "list" ? "list" : "grid";
        localStorage.setItem("tcg-cards-view", cardsView);
        applyCardsView();
      });
    }

    elements.grid.addEventListener("click", (event) => {
      const imageButton = event.target.closest("[data-preview-card-id]");
      if (imageButton) {
        preview.open(imageButton.dataset.previewCardId, imageButton.dataset.previewVariant);
        return;
      }
      if (shared.handleWantTileClick(event, wishlist)) { refreshOwnership(); return; }
      // Na busca, o "+" soma +1 a cada clique e pisca "✓ Adicionada!" por 2s,
      // pra cadastrar várias cópias da mesma carta sem abrir o card.
      const addButton = shared.handleAddTileClick(event, owned, wishlist);
      if (addButton) { refreshOwnership(); shared.flashTileAdded(addButton, owned); }
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
    const pairs = shared.cardVariantPairs(filterCards());
    const cmp = sortComparator();
    // Critério primário: carta com imagem antes (sem-imagem sempre por último);
    // secundário: a ordenação escolhida pelo usuário.
    pairs.sort((a, b) =>
      (Number(shared.cardHasImage(b.card)) - Number(shared.cardHasImage(a.card))) || cmp(a, b));
    return pairs;
  }

  // Comparador do seletor de ordenação (mesma lógica da Coleção/detalhe).
  function sortComparator() {
    // Memoizado: no Explorar são ~8k cartas — sem cache seriam O(n log n) lookups.
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

  // Alterna grade/lista (mesma classe .is-list do detalhe/coleção) e reflete nos botões.
  function applyCardsView() {
    if (elements.grid) elements.grid.classList.toggle("is-list", cardsView === "list");
    if (elements.cardsViewToggle) {
      elements.cardsViewToggle.querySelectorAll("[data-grid-view]").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.gridView === cardsView));
      });
    }
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
    pager.render(tiles, ({ card, variant }) => shared.variantTile(card, variant, owned, wishlist, prices, { addMode: true }), options || {});
    elements.empty.hidden = tiles.length > 0;
    elements.resultCount.textContent = tn("results.count", tiles.length);
  }

  // Atualiza posse/desejo dos tiles no DOM existente, sem reconstruir a grade.
  function refreshOwnership() {
    elements.grid.querySelectorAll(".card-tile").forEach((tile) => {
      shared.refreshTileOwnership(tile, owned, wishlist, { addMode: true });
    });
  }
})();
