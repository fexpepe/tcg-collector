(function () {
  const shared = window.TCGShared;
  const { addOptions, detailUrl, unique, normalize, escapeHtml, escapeAttribute, speciesName, debounce } = shared;

  let cards = [];
  let cardsById = new Map();
  let indexes = null;
  const owned = shared.createCollectionStore();

  const elements = {
    grid: document.getElementById("cardGrid"),
    empty: document.getElementById("emptyState"),
    search: document.getElementById("searchInput"),
    generationChips: document.getElementById("generationChips"),
    setFilter: document.getElementById("setFilter"),
    languageFilter: document.getElementById("languageFilter"),
    ownedFilter: document.getElementById("ownedFilter"),
    ownedCount: document.getElementById("ownedCount"),
    totalCount: document.getElementById("totalCount"),
    completionRate: document.getElementById("completionRate"),
    resultCount: document.getElementById("resultCount"),
    exportButton: document.getElementById("exportButton"),
    importInput: document.getElementById("importInput")
  };
  const view = elements.grid.dataset.view || "pokedex";
  const pager = shared.createPager({ grid: elements.grid, pageSize: 60 });
  let selectedGeneration = "";

  const preview = shared.createCardPreview({
    getCard: (cardId) => cardsById.get(cardId),
    store: owned,
    onOwnedChange: () => render()
  });

  shared.loadCatalog()
    .then((catalog) => {
      cards = catalog.cards;
      cardsById = new Map(cards.map((card) => [card.id, card]));
      indexes = catalog.indexes || buildIndexes(cards);
      owned.migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId)));
      init();
    })
    .catch((error) => {
      elements.empty.textContent = `Não foi possível carregar o catálogo: ${error.message}`;
      elements.empty.hidden = false;
    });

  function init() {
    hydrateFilters();
    bindEvents();
    render();
  }

  function hydrateFilters() {
    addOptions(elements.setFilter, unique(cards.map((card) => card.set)));
    addOptions(elements.languageFilter, unique(cards.map((card) => card.language)));
    buildGenerationChips();
  }

  function buildGenerationChips() {
    if (!elements.generationChips) return;

    const generations = unique(cards.map((card) => card.generation).filter(Boolean))
      .sort((a, b) => Number(a) - Number(b));
    const options = [{ value: "", label: "Todas" }]
      .concat(generations.map((value) => ({ value: String(value), label: `Gen ${toRoman(value)}` })));

    elements.generationChips.innerHTML = "";
    options.forEach((option) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.dataset.generation = option.value;
      chip.textContent = option.label;
      chip.setAttribute("aria-pressed", option.value === selectedGeneration ? "true" : "false");
      elements.generationChips.appendChild(chip);
    });
  }

  function bindEvents() {
    const applyFilters = () => render({ resetCount: true });
    elements.search.addEventListener("input", debounce(applyFilters, 200));
    [elements.setFilter, elements.languageFilter, elements.ownedFilter].filter(Boolean).forEach((element) => {
      element.addEventListener("input", applyFilters);
    });

    if (elements.generationChips) {
      elements.generationChips.addEventListener("click", (event) => {
        const chip = event.target.closest("[data-generation]");
        if (!chip) return;
        selectedGeneration = chip.dataset.generation;
        Array.from(elements.generationChips.children).forEach((node) => {
          node.setAttribute("aria-pressed", node === chip ? "true" : "false");
        });
        applyFilters();
      });
    }

    elements.grid.addEventListener("click", (event) => {
      const imageButton = event.target.closest("[data-preview-card-id]");
      if (imageButton) {
        preview.open(imageButton.dataset.previewCardId);
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
    const items = getViewItems(visibleCards);
    pager.render(items, createViewItem, { resetCount });

    elements.empty.hidden = items.length > 0;
    elements.resultCount.textContent = `${items.length} resultado${items.length === 1 ? "" : "s"}`;
    elements.ownedCount.textContent = owned.size;
    elements.totalCount.textContent = cards.length;
    elements.completionRate.textContent = cards.length ? `${Math.round((owned.size / cards.length) * 100)}%` : "0%";
  }

  function getViewItems(visibleCards) {
    const visibleIds = new Set(visibleCards.map((card) => card.id));

    if (view === "sets") {
      return indexedGroupsToItems(indexes.sets, visibleIds, toSetItem);
    }

    if (view === "artists") {
      return indexedGroupsToItems(indexes.artists, visibleIds, toGroupItem);
    }

    return indexedGroupsToItems(indexes.pokedex, visibleIds, toPokedexItem);
  }

  function indexedGroupsToItems(indexGroups, visibleIds, mapper) {
    return (indexGroups || [])
      .map((group) => ({
        name: group.name,
        cards: group.cardIds.map((id) => cardsById.get(id)).filter((card) => card && visibleIds.has(card.id))
      }))
      .filter((group) => group.cards.length > 0)
      .map(mapper)
      .sort(sortByName);
  }

  function createViewItem(item) {
    if (item.type === "pokedex") {
      return createPokedexCard(item);
    }

    if (item.type === "set") {
      return createSetCard(item);
    }

    return createGroupCard(item);
  }

  function filterCards() {
    const query = normalize(elements.search.value);
    const generationValue = selectedGeneration;
    const setValue = elements.setFilter.value;
    const languageValue = elements.languageFilter.value;
    const ownedValue = elements.ownedFilter.value;

    return cards.filter((card) => {
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
      const matchesGeneration = !generationValue || String(card.generation) === generationValue;
      const matchesSet = !setValue || card.set === setValue;
      const matchesLanguage = !languageValue || card.language === languageValue;
      const isOwned = owned.has(card.id);
      const matchesOwned = ownedValue === "all" || (ownedValue === "owned" && isOwned) || (ownedValue === "missing" && !isOwned);

      return matchesQuery && matchesGeneration && matchesSet && matchesLanguage && matchesOwned;
    });
  }

  function createPokedexCard(item) {
    const article = document.createElement("article");
    article.className = "pokedex-card";
    const image = item.image
      ? `<img loading="lazy" src="${escapeAttribute(item.image)}" alt="${escapeAttribute(item.name)}">`
      : `<span class="image-placeholder">Sem imagem</span>`;
    const progress = item.totalCount ? Math.round((item.ownedCount / item.totalCount) * 100) : 0;

    article.innerHTML = `
      <a class="pokedex-link" href="${escapeAttribute(detailUrl("pokemon", item.name))}">
        <div class="pokedex-number">#${String(item.dexId || "?").padStart(4, "0")}</div>
        <div class="pokedex-image">${image}</div>
        <div class="pokedex-info">
          <h3>${escapeHtml(item.name)}</h3>
          <p>Geração ${escapeHtml(item.generation || "-")}</p>
        </div>
        <div class="progress-bar" aria-label="Progresso de ${escapeAttribute(item.name)}">
          <span style="width: ${progress}%"></span>
        </div>
        <div class="set-footer">
          <strong>${progress}%</strong>
          <span>${item.ownedCount}/${item.totalCount} cartas</span>
        </div>
      </a>
    `;

    return article;
  }

  function createGroupCard(item) {
    const article = document.createElement("article");
    article.className = "group-card";
    const type = view === "artists" ? "artist" : view;
    const progress = item.totalCount ? Math.round((item.ownedCount / item.totalCount) * 100) : 0;

    article.innerHTML = `
      <div class="group-card-header">
        <div>
          <h3>${escapeHtml(item.name)}</h3>
          <p>${item.totalCount} carta${item.totalCount === 1 ? "" : "s"} · ${item.ownedCount} marcada${item.ownedCount === 1 ? "" : "s"}</p>
        </div>
        <span class="tag">${progress}%</span>
      </div>
      <div class="progress-bar" aria-label="Progresso de ${escapeAttribute(item.name)}">
        <span style="width: ${progress}%"></span>
      </div>
      <div class="mini-card-list">${item.cards.map(createMiniCard).join("")}</div>
      <a class="details-link" href="${escapeAttribute(detailUrl(type, item.name))}">Ver cartas</a>
    `;

    return article;
  }

  function createSetCard(item) {
    const article = document.createElement("article");
    article.className = "set-card";
    article.dataset.href = detailUrl("set", item.name);
    const progress = item.totalCount ? Math.round((item.ownedCount / item.totalCount) * 100) : 0;
    const logo = item.logo
      ? `<img class="set-logo" loading="lazy" src="${escapeAttribute(item.logo)}" alt="${escapeAttribute(item.name)}">`
      : `<span class="set-logo-placeholder">${escapeHtml(item.name)}</span>`;
    const symbol = item.symbol
      ? `<img class="set-symbol" loading="lazy" src="${escapeAttribute(item.symbol)}" alt="">`
      : "";

    article.innerHTML = `
      <div class="set-art">
        ${logo}
        ${symbol}
      </div>
      <div class="set-body">
        <div class="set-title-row">
          <h3>${escapeHtml(item.name)}</h3>
          <span class="tag">${escapeHtml(item.languageLabel)}</span>
        </div>
        <div class="set-meta">
          <span>${item.officialTotal || item.totalCount} cartas oficiais</span>
          <span>${item.totalCount} no catálogo local</span>
          <span>${item.ownedCount} marcadas</span>
        </div>
        <div class="progress-bar" aria-label="Progresso de ${escapeAttribute(item.name)}">
          <span style="width: ${progress}%"></span>
        </div>
        <div class="set-footer">
          <strong>${progress}%</strong>
          <span>${item.ownedCount}/${item.totalCount}</span>
        </div>
        <a class="details-link" href="${escapeAttribute(detailUrl("set", item.name))}">Ver set</a>
      </div>
    `;

    return article;
  }

  function createMiniCard(card) {
    const total = owned.totalForCard(card.id);
    const isOwned = total > 0;
    return `
      <div class="mini-card">
        <div>
          <strong>${escapeHtml(card.name)}</strong>
          <span>${escapeHtml(card.number)} · ${escapeHtml(card.set)} · ${escapeHtml(card.language.toUpperCase())}</span>
        </div>
        <button class="owned-toggle compact" data-card-id="${escapeAttribute(card.id)}" aria-pressed="${isOwned}">
          ${isOwned ? (total > 1 ? `Tenho ×${total}` : "Tenho") : "Falta"}
        </button>
      </div>
    `;
  }

  function buildIndexes(sourceCards) {
    return {
      pokedex: groupToIndex(sourceCards, (card) => card.pokemonName || speciesName(card.name)),
      sets: groupToIndex(sourceCards, (card) => card.set),
      artists: groupToIndex(sourceCards, (card) => card.artist || "Artista desconhecido")
    };
  }

  function groupToIndex(sourceCards, getKey) {
    const groups = new Map();
    sourceCards.forEach((card) => {
      const key = getKey(card) || "Sem grupo";
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(card.id);
    });
    return Array.from(groups, ([name, cardIds]) => ({ name, cardIds: cardIds.sort() }))
      .sort(sortByName);
  }

  function toGroupItem(group) {
    const sortedCards = group.cards.slice().sort((a, b) => a.name.localeCompare(b.name));
    return {
      type: "group",
      name: group.name,
      cards: sortedCards,
      totalCount: sortedCards.length,
      ownedCount: sortedCards.filter((card) => owned.has(card.id)).length
    };
  }

  function toSetItem(group) {
    const sortedCards = group.cards.slice().sort((a, b) => a.number.localeCompare(b.number));
    const sample = sortedCards[0] || {};
    return {
      type: "set",
      name: group.name,
      cards: sortedCards,
      totalCount: sortedCards.length,
      ownedCount: sortedCards.filter((card) => owned.has(card.id)).length,
      officialTotal: sample.setTotal || sortedCards.length,
      logo: sample.setLogo || "",
      symbol: sample.setSymbol || "",
      languageLabel: unique(sortedCards.map((card) => card.language.toUpperCase())).join("/")
    };
  }

  function toPokedexItem(group) {
    const sortedCards = group.cards.slice().sort((a, b) => a.set.localeCompare(b.set) || a.number.localeCompare(b.number));
    const sample = sortedCards.slice().sort((a, b) => (a.dexId || 9999) - (b.dexId || 9999))[0] || {};
    return {
      type: "pokedex",
      name: group.name,
      cards: sortedCards,
      totalCount: sortedCards.length,
      ownedCount: sortedCards.filter((card) => owned.has(card.id)).length,
      dexId: sample.dexId || "",
      generation: sample.generation || "",
      image: sample.pokemonImage || "",
      sets: unique(sortedCards.map((card) => card.set)).slice(0, 3),
      artists: unique(sortedCards.map((card) => card.artist)).slice(0, 3),
      variants: unique(sortedCards.flatMap((card) => card.variants || [])).slice(0, 8)
    };
  }

  function sortByName(a, b) {
    return a.name.localeCompare(b.name);
  }

  function toRoman(value) {
    const numerals = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];
    return numerals[Number(value)] || String(value);
  }
})();
