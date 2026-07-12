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
  const CARDS_SORTS = ["value-desc", "value-asc", "num-asc", "num-desc", "rarity-desc", "rarity-asc", "release"];
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
    priceMin: document.getElementById("priceMin"),
    priceMax: document.getElementById("priceMax"),
    cardsSortSelect: document.getElementById("cardsSortSelect"),
    cardsViewToggle: document.getElementById("cardsViewToggle")
  };

  // Faixa de preço na MOEDA DO TOPO (aceita vírgula decimal). Vazio = sem limite.
  function parsePrice(el) {
    if (!el) return null;
    const v = parseFloat(String(el.value || "").replace(/[^\d.,]/g, "").replace(",", "."));
    return Number.isFinite(v) && v >= 0 ? v : null;
  }
  // Valor de mercado memoizado por carta (ordenar/filtrar por preço varre o
  // catálogo inteiro — sem memo seria uma conversão de moeda por comparação).
  let priceMemo = new Map();
  function priceOf(card) {
    if (!priceMemo.has(card.id)) {
      priceMemo.set(card.id, shared.cardValue(card, shared.defaultVariant(card), prices).value || 0);
    }
    return priceMemo.get(card.id);
  }

  // Filtros ↔ URL (deep-link compartilhável): lê os params no boot e regrava
  // com replaceState a cada mudança. ?q= já existia (busca global).
  const URL_FILTERS = [["set", "setFilter"], ["lang", "languageFilter"], ["rarity", "rarityFilter"], ["pmin", "priceMin"], ["pmax", "priceMax"]];
  function readFiltersFromUrl() {
    const sp = new URLSearchParams(window.location.search);
    URL_FILTERS.forEach(([param, key]) => {
      const v = sp.get(param);
      if (v != null && elements[key]) elements[key].value = v;
    });
    const sort = sp.get("sort");
    if (sort && CARDS_SORTS.includes(sort)) {
      cardsSort = sort;
      if (elements.cardsSortSelect) elements.cardsSortSelect.value = sort;
    }
  }
  function writeFiltersToUrl() {
    const sp = new URLSearchParams(window.location.search);
    const q = elements.search.value.trim();
    if (q) sp.set("q", q); else sp.delete("q");
    URL_FILTERS.forEach(([param, key]) => {
      const v = elements[key] ? String(elements[key].value || "").trim() : "";
      if (v) sp.set(param, v); else sp.delete(param);
    });
    sp.set("sort", cardsSort);
    try { history.replaceState(null, "", `${window.location.pathname}?${sp}`); } catch (e) { /* ignora */ }
  }

  const pager = shared.createPager({ grid: elements.grid, pageSize: 60 });

  const preview = shared.createCardPreview({
    getCard: (cardId) => cardsById.get(cardId),
    store: owned,
    prices,
    wishlist,
    onOwnedChange: () => refreshOwnership()
  });

  // Catálogo inteiro (em produção, baixado dos chunks do manifest, como na
  // Pokédex). A página só renderiza cartas quando há busca/filtro ativo —
  // skeletons só no deep-link ?q= (senão a página abre no intro, sem grade).
  if (new URLSearchParams(window.location.search).get("q") && elements.grid) {
    shared.showSkeletons(elements.grid, "card", 12);
  }
  Promise.all([shared.loadCatalog(), shared.loadFxRates()])
    .then(([catalog]) => {
      // Escopo por linha de jogo: a página de uma linha vintage (?line=) só vê
      // as cartas dela; o jogo principal exclui as linhas (páginas próprias).
      const scope = shared.lineScope((window.SLEEVU && window.SLEEVU.game) || "pokemon", shared.lineParamOf());
      cards = (catalog.cards || []).filter((card) => scope.includes(card.setId));
      cardsById = new Map(cards.map((card) => [card.id, card]));
      owned.migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId)));
      hydrateFilters();
      bindEvents();
      // Deep-links: ?q= (busca global) + filtros/ordenação da URL (links
      // compartilháveis — os selects já têm as opções após o hydrate).
      const q = new URLSearchParams(window.location.search).get("q");
      if (q && elements.search) elements.search.value = q;
      readFiltersFromUrl();
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
    const apply = () => { writeFiltersToUrl(); render({ resetCount: true }); };
    elements.search.addEventListener("input", debounce(apply, 200));
    [elements.setFilter, elements.languageFilter, elements.rarityFilter].forEach((element) => {
      element.addEventListener("input", apply);
    });
    [elements.priceMin, elements.priceMax].forEach((element) => {
      if (element) element.addEventListener("input", debounce(apply, 300));
    });
    // (Trocar a moeda do topo recarrega a página — o memo de preço renasce.)

    if (elements.cardsSortSelect) {
      elements.cardsSortSelect.value = cardsSort;
      elements.cardsSortSelect.addEventListener("change", () => {
        cardsSort = elements.cardsSortSelect.value;
        localStorage.setItem("tcg-cards-sort", cardsSort);
        writeFiltersToUrl();
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
    return !!(elements.search.value.trim() || elements.setFilter.value || elements.rarityFilter.value
      || parsePrice(elements.priceMin) != null || parsePrice(elements.priceMax) != null);
  }

  function filterCards() {
    const setValue = elements.setFilter.value;
    const languageValue = elements.languageFilter.value;
    const rarityValue = elements.rarityFilter.value;
    const pMin = parsePrice(elements.priceMin);
    const pMax = parsePrice(elements.priceMax);
    return cards.filter((card) => {
      if (!shared.matchesCardQuery(card, elements.search.value)) return false;
      if (setValue && card.set !== setValue) return false;
      if (languageValue && card.language !== languageValue) return false;
      if (rarityValue && card.rarity !== rarityValue) return false;
      if (pMin != null || pMax != null) {
        const v = priceOf(card);
        if (pMin != null && v < pMin) return false;
        if (pMax != null && (v > pMax || v <= 0)) return false; // sem preço não entra em "até X"
      }
      return true;
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
    if (cardsSort === "rarity-desc") return (a, b) => shared.rarityRank(b.card.rarity) - shared.rarityRank(a.card.rarity) || byNum(a, b);
    if (cardsSort === "rarity-asc") return (a, b) => shared.rarityRank(a.card.rarity) - shared.rarityRank(b.card.rarity) || byNum(a, b);
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
