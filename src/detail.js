(function () {
  const shared = window.TCGShared;
  const { addOptions, unique, normalize, escapeHtml, escapeAttribute, speciesName, debounce, t, tn, localizedImg } = shared;

  let cards = [];
  let cardsById = new Map();
  let pageCards = [];
  const owned = shared.createCollectionStore();
  const favorites = shared.createFavoritesStore();
  const wishlist = shared.createWishlistStore();
  const prices = shared.createPriceStore();

  const TYPE_COLORS = shared.TYPE_COLORS;
  const REGION_BY_GENERATION = shared.REGION_BY_GENERATION;

  const FORM_WORDS = {
    mega: "Mega",
    gmax: "Gigantamax",
    alola: "Alola",
    galar: "Galar",
    hisui: "Hisui",
    paldea: "Paldea"
  };

  const params = new URLSearchParams(window.location.search);
  const detailType = params.get("type") || "";
  const detailName = params.get("name") || "";

  const elements = {
    type: document.getElementById("detailType"),
    title: document.getElementById("detailTitle"),
    hero: document.getElementById("detailHero"),
    grid: document.getElementById("detailGrid"),
    empty: document.getElementById("emptyState"),
    search: document.getElementById("searchInput"),
    setFilter: document.getElementById("setFilter"),
    languageChips: document.getElementById("languageChips"),
    ownedChips: document.getElementById("ownedChips"),
    ownedCount: document.getElementById("ownedCount"),
    totalCount: document.getElementById("totalCount"),
    completionRate: document.getElementById("completionRate"),
    resultCount: document.getElementById("resultCount"),
    exportButton: document.getElementById("exportButton"),
    importInput: document.getElementById("importInput")
  };

  const pager = shared.createPager({ grid: elements.grid, pageSize: 60 });
  let selectedLanguage = "";
  let selectedOwned = "all";

  const preview = shared.createCardPreview({
    getCard: (cardId) => cardsById.get(cardId),
    store: owned,
    prices,
    onOwnedChange: () => refreshOwnership()
  });

  resolveCards()
    .then((resolvedCards) => {
      cards = resolvedCards;
      cardsById = new Map(cards.map((card) => [card.id, card]));
      owned.migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId)));
      pageCards = getPageCards();
      init();
    })
    .catch((error) => {
      elements.empty.textContent = t("error.cards", { message: error.message });
      elements.empty.hidden = false;
    });

  function init() {
    elements.type.textContent = typeLabel(detailType);
    elements.title.textContent = detailName || t("detail.label");
    renderHero();
    hydrateFilters();
    bindEvents();
    render();
  }

  // No modo manifest, baixa apenas os chunks de set necessários para esta página.
  async function resolveCards() {
    if (Array.isArray(window.TCG_CARDS) && window.TCG_CARDS.length) {
      return window.TCG_CARDS;
    }

    const manifest = window.TCG_MANIFEST;
    if (!manifest || !Array.isArray(manifest.sets)) {
      return [];
    }

    if (detailType === "set") {
      const entries = manifest.sets.filter((set) => set.name === detailName);
      return entries.length ? shared.fetchSetChunks(entries) : [];
    }

    const indexes = window.TCG_INDEXES;
    const groups = detailType === "artist" ? indexes?.artists
      : detailType === "trainer" ? indexes?.trainers
      : indexes?.pokedex;
    const group = (groups || []).find((candidate) => candidate.name === detailName);
    if (!group) {
      return shared.fetchSetChunks(manifest.sets);
    }

    const setIds = manifest.sets.map((set) => set.id);
    const neededSetIds = new Set(group.cardIds.map((cardId) => shared.setIdForCard(cardId, setIds)));
    return shared.fetchSetChunks(manifest.sets.filter((set) => neededSetIds.has(set.id)));
  }

  function getPageCards() {
    if (detailType === "set") {
      return cards.filter((card) => card.set === detailName);
    }

    if (detailType === "artist") {
      return cards.filter((card) => (card.artist || "Artista desconhecido") === detailName);
    }

    if (detailType === "pokemon") {
      return cards.filter((card) => (card.pokemonName || speciesName(card.name)) === detailName);
    }

    if (detailType === "trainer") {
      return cards.filter((card) => card.category === "Trainer" && card.name === detailName);
    }

    return [];
  }

  function renderHero() {
    const sample = pageCards[0];
    if (!sample) return;

    if (detailType === "set") {
      const logo = sample.setLogo
        ? localizedImg(sample.setLogo, { alt: sample.set, className: "set-logo" })
        : `<strong>${escapeHtml(sample.set)}</strong>`;
      const symbol = sample.setSymbol
        ? localizedImg(sample.setSymbol, { className: "set-symbol" })
        : "";
      elements.hero.innerHTML = `
        <div class="set-art detail-set-art">${logo}${symbol}</div>
        <div>
          <h2>${escapeHtml(sample.set)}</h2>
          <p>${escapeHtml(`${t("set.officialCards", { n: sample.setTotal || pageCards.length })} · ${t("set.inLocalCatalog", { n: pageCards.length })}`)}</p>
        </div>
      `;
      elements.hero.hidden = false;
      return;
    }

    if (detailType === "pokemon") {
      renderPokemonHero(sample);
    }
  }

  function renderPokemonHero(sample) {
    const dexId = sample.dexId || "";
    const region = REGION_BY_GENERATION[Number(sample.generation)] || "";
    const generationLabel = sample.generation ? t("card.generation", { g: toRoman(sample.generation) }) : "";
    const isFavorite = favorites.has(String(dexId));
    const pokemonImage = sample.pokemonImage
      ? `<img class="pokemon-hero-image" src="${escapeAttribute(sample.pokemonImage)}" alt="${escapeAttribute(detailName)}">`
      : "";

    elements.hero.innerHTML = `
      <div class="pokemon-hero-art">${pokemonImage}</div>
      <div class="pokemon-hero-info">
        <h2 class="pokemon-hero-title">
          <span class="dex-num">#${String(dexId || "?").padStart(4, "0")}</span>
          <span class="pokemon-hero-name">${escapeHtml(detailName)}</span>
        </h2>
        <div class="type-badges" data-type-badges aria-label="Tipos"></div>
        <div class="pokemon-meta-row">
          ${region ? `<span class="meta-pill">${escapeHtml(region)}</span>` : ""}
          ${generationLabel ? `<span class="meta-pill">${escapeHtml(generationLabel)}</span>` : ""}
        </div>
        <div class="pokemon-hero-actions">
          <button class="favorite-button" data-favorite-toggle aria-pressed="${isFavorite}">${favoriteLabel(isFavorite)}</button>
          <button class="forms-toggle" data-forms-toggle aria-expanded="false" hidden></button>
        </div>
        <div class="forms-list" data-forms-list hidden></div>
        <p class="pokemon-hero-count">${escapeHtml(tn("hero.cardsInCatalog", pageCards.length))}</p>
      </div>
    `;
    elements.hero.hidden = false;

    bindHeroActions(dexId);
    fillPokemonMeta(dexId);
  }

  function bindHeroActions(dexId) {
    const favButton = elements.hero.querySelector("[data-favorite-toggle]");
    if (favButton) {
      favButton.addEventListener("click", () => {
        favorites.toggle(String(dexId));
        const isFavorite = favorites.has(String(dexId));
        favButton.setAttribute("aria-pressed", String(isFavorite));
        favButton.innerHTML = favoriteLabel(isFavorite);
      });
    }

    const formsToggle = elements.hero.querySelector("[data-forms-toggle]");
    const formsList = elements.hero.querySelector("[data-forms-list]");
    if (formsToggle && formsList) {
      formsToggle.addEventListener("click", () => {
        const show = formsList.hidden;
        formsList.hidden = !show;
        formsToggle.setAttribute("aria-expanded", String(show));
      });
    }
  }

  async function fillPokemonMeta(dexId) {
    const meta = await shared.fetchPokemonMeta(dexId);

    const badges = elements.hero.querySelector("[data-type-badges]");
    if (badges && meta.types.length) {
      badges.innerHTML = meta.types.map(typeBadge).join("");
    }

    const formsToggle = elements.hero.querySelector("[data-forms-toggle]");
    const formsList = elements.hero.querySelector("[data-forms-list]");
    if (formsToggle && formsList && meta.forms.length) {
      formsToggle.textContent = tn("forms.toggle", meta.forms.length);
      formsToggle.hidden = false;
      formsList.innerHTML = meta.forms
        .map((form) => `<span class="form-chip">${escapeHtml(formatFormName(form, detailName))}</span>`)
        .join("");
    }
  }

  function favoriteLabel(isFavorite) {
    return isFavorite ? t("favorite.active") : t("favorite.add");
  }

  function typeBadge(slug) {
    const color = TYPE_COLORS[slug] || "#6b7280";
    const translated = t(`type.${slug}`);
    const label = translated === `type.${slug}` ? slug : translated;
    return `<span class="type-badge" style="--type-color: ${color}">${escapeHtml(label)}</span>`;
  }

  function formatFormName(varietyName, species) {
    const speciesSlug = normalize(species).replace(/\s+/g, "-");
    let rest = varietyName;
    if (rest.startsWith(`${speciesSlug}-`)) {
      rest = rest.slice(speciesSlug.length + 1);
    }
    return rest
      .split("-")
      .map((word) => FORM_WORDS[word] || (word.charAt(0).toUpperCase() + word.slice(1)))
      .join(" ");
  }

  function toRoman(value) {
    const numerals = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];
    return numerals[Number(value)] || String(value);
  }

  function hydrateFilters() {
    addOptions(elements.setFilter, unique(pageCards.map((card) => card.set)));

    const languages = unique(pageCards.map((card) => card.language)).sort();
    renderSegmented(elements.languageChips, [{ value: "", label: t("filter.all.m") }]
      .concat(languages.map((language) => ({ value: language, label: language.toUpperCase() }))), selectedLanguage);

    renderSegmented(elements.ownedChips, [
      { value: "all", label: t("filter.all.f") },
      { value: "owned", label: t("filter.owned") },
      { value: "missing", label: t("filter.missing") }
    ], selectedOwned);
  }

  function renderSegmented(container, options, selectedValue) {
    if (!container) return;
    container.innerHTML = "";
    options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "segmented-option";
      button.dataset.value = option.value;
      button.textContent = option.label;
      button.setAttribute("aria-pressed", String(option.value === selectedValue));
      container.appendChild(button);
    });
  }

  function bindSegmented(container, onSelect) {
    if (!container) return;
    container.addEventListener("click", (event) => {
      const button = event.target.closest(".segmented-option");
      if (!button) return;
      onSelect(button.dataset.value);
      Array.from(container.children).forEach((node) => {
        node.setAttribute("aria-pressed", String(node === button));
      });
      render({ resetCount: true });
    });
  }

  function bindEvents() {
    const applyFilters = () => render({ resetCount: true });
    elements.search.addEventListener("input", debounce(applyFilters, 200));
    elements.setFilter.addEventListener("input", applyFilters);
    bindSegmented(elements.languageChips, (value) => { selectedLanguage = value; });
    bindSegmented(elements.ownedChips, (value) => { selectedOwned = value; });

    elements.grid.addEventListener("click", (event) => {
      const imageButton = event.target.closest("[data-preview-card-id]");
      if (imageButton) {
        preview.open(imageButton.dataset.previewCardId);
        return;
      }

      if (shared.handleWantTileClick(event, wishlist)) {
        refreshOwnership();
        return;
      }

      if (shared.handleOwnedTileClick(event, owned, wishlist)) {
        refreshOwnership();
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

  function render({ resetCount = false } = {}) {
    const visibleCards = filterCards();
    const tiles = shared.cardVariantPairs(visibleCards);
    pager.render(tiles, ({ card, variant }) => shared.variantTile(card, variant, owned, wishlist), { resetCount });

    elements.empty.hidden = tiles.length > 0;
    elements.resultCount.textContent = tn("results.count", tiles.length);
    updateHeaderStats();
  }

  // Atualiza tiles e contadores no DOM existente, sem reconstruir a grade
  // (reconstruir faria todas as imagens piscarem).
  function refreshOwnership() {
    elements.grid.querySelectorAll(".card-tile").forEach((tile) => shared.refreshTileOwnership(tile, owned, wishlist));
    updateHeaderStats();
  }

  function updateHeaderStats() {
    const ownedInPage = pageCards.filter((card) => owned.has(card.id)).length;
    elements.ownedCount.textContent = ownedInPage;
    elements.totalCount.textContent = pageCards.length;
    elements.completionRate.textContent = pageCards.length ? `${Math.round((ownedInPage / pageCards.length) * 100)}%` : "0%";
  }

  function filterCards() {
    const query = normalize(elements.search.value);
    const setValue = elements.setFilter.value;
    const languageValue = selectedLanguage;
    const ownedValue = selectedOwned;

    return pageCards.filter((card) => {
      const matchesQuery = !query || normalize([
        card.name,
        card.number,
        card.set,
        card.artist,
        card.rarity,
        card.language,
        ...(card.variants || [])
      ].join(" ")).includes(query);
      const matchesSet = !setValue || card.set === setValue;
      const matchesLanguage = !languageValue || card.language === languageValue;
      const isOwned = owned.has(card.id);
      const matchesOwned = ownedValue === "all" || (ownedValue === "owned" && isOwned) || (ownedValue === "missing" && !isOwned);

      return matchesQuery && matchesSet && matchesLanguage && matchesOwned;
    });
  }


  function typeLabel(type) {
    const key = `detail.label.${type}`;
    const translated = t(key);
    return translated === key ? t("detail.label") : translated;
  }
})();
