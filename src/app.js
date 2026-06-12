(function () {
  const shared = window.TCGShared;
  const { addOptions, detailUrl, unique, normalize, escapeHtml, escapeAttribute, speciesName, debounce, t, tn, localizedImg } = shared;

  let cards = [];
  let cardsById = new Map();
  let indexes = null;
  const owned = shared.createCollectionStore();

  const elements = {
    grid: document.getElementById("cardGrid"),
    empty: document.getElementById("emptyState"),
    search: document.getElementById("searchInput"),
    generationChips: document.getElementById("generationChips"),
    setRegionChips: document.getElementById("setRegionChips"),
    typeFilter: document.getElementById("typeFilter"),
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
  let selectedLangRegion = "english";

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
      elements.empty.textContent = t("error.catalog", { message: error.message });
      elements.empty.hidden = false;
    });

  function init() {
    hydrateFilters();
    bindEvents();
    render();
  }

  function hydrateFilters() {
    if (elements.setFilter) addOptions(elements.setFilter, unique(cards.map((card) => card.set)));
    if (elements.languageFilter) addOptions(elements.languageFilter, unique(cards.map((card) => card.language)));
    hydrateTypeFilter();
    buildGenerationChips();
  }

  function hydrateTypeFilter() {
    if (!elements.typeFilter) return;
    const present = view === "pokedex" && window.TCG_POKEMON_NAMES
      ? new Set(Object.values(window.TCG_POKEMON_TYPES || {}).flat())
      : new Set(cards.flatMap((card) => shared.typesForDex(card.dexId)));
    shared.POKEMON_TYPES.filter((type) => present.has(type)).forEach((type) => {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = shared.typeLabel(type);
      elements.typeFilter.appendChild(option);
    });
  }

  function buildGenerationChips() {
    if (!elements.generationChips) return;

    // Na Pokédex completa as 9 gerações sempre existem, com ou sem carta.
    const generations = view === "pokedex" && window.TCG_POKEMON_NAMES
      ? [1, 2, 3, 4, 5, 6, 7, 8, 9]
      : unique(cards.map((card) => card.generation).filter(Boolean)).sort((a, b) => Number(a) - Number(b));
    const options = [{ value: "", label: t("chip.allGenerations") }]
      .concat(generations.map((value) => {
        const region = shared.regionForGeneration(value);
        return { value: String(value), label: region ? `Gen ${toRoman(value)} · ${region}` : `Gen ${toRoman(value)}` };
      }));

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
    [elements.typeFilter, elements.setFilter, elements.languageFilter, elements.ownedFilter].filter(Boolean).forEach((element) => {
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

    if (elements.setRegionChips) {
      elements.setRegionChips.addEventListener("click", (event) => {
        const chip = event.target.closest("[data-lang-region]");
        if (!chip) return;
        selectedLangRegion = chip.dataset.langRegion;
        Array.from(elements.setRegionChips.children).forEach((node) => {
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
    elements.resultCount.textContent = tn("results.count", items.length);
    elements.ownedCount.textContent = owned.size;
    elements.totalCount.textContent = cards.length;
    elements.completionRate.textContent = cards.length ? `${Math.round((owned.size / cards.length) * 100)}%` : "0%";
  }

  function getViewItems(visibleCards) {
    const visibleIds = new Set(visibleCards.map((card) => card.id));

    if (view === "sets") {
      return indexedGroupsToItems(indexes.sets, visibleIds, toSetItem, sortByReleaseDesc);
    }

    if (view === "artists") {
      return indexedGroupsToItems(indexes.artists, visibleIds, toGroupItem);
    }

    if (view === "trainers") {
      return indexedGroupsToItems(indexes.trainers, visibleIds, toGroupItem);
    }

    return pokedexViewItems(visibleIds);
  }

  // Pokédex nacional completa: uma entrada por espécie em ordem de número,
  // mesmo sem carta no catálogo (aí com 0/0). TCG_POKEMON_NAMES garante as
  // 1025 espécies e o nome canônico; índices antigos sem dexId herdam o da
  // primeira carta do grupo.
  function pokedexEntries() {
    const byDex = new Map();

    (indexes.pokedex || []).forEach((group) => {
      const firstCard = cardsById.get((group.cardIds || [])[0]) || {};
      const dexId = Math.trunc(Number(group.dexId)) || Math.trunc(Number(firstCard.dexId)) || 0;
      if (!dexId) return;
      const entry = byDex.get(dexId) || { dexId, name: group.name, cardIds: [] };
      entry.cardIds = entry.cardIds.concat(group.cardIds || []);
      byDex.set(dexId, entry);
    });

    Object.entries(window.TCG_POKEMON_NAMES || {}).forEach(([id, name]) => {
      const dexId = Number(id);
      const entry = byDex.get(dexId);
      if (entry) entry.name = name;
      else byDex.set(dexId, { dexId, name, cardIds: [] });
    });

    return Array.from(byDex.values()).sort((a, b) => a.dexId - b.dexId);
  }

  // Espécie aparece se os filtros de espécie (geração/tipo) batem e, havendo
  // busca, se o nome/número bate ou se alguma carta visível dela bate.
  function pokedexViewItems(visibleIds) {
    const query = normalize(elements.search.value);
    const typeValue = elements.typeFilter ? elements.typeFilter.value : "";

    return pokedexEntries()
      .map((entry) => ({
        ...entry,
        cards: entry.cardIds.map((id) => cardsById.get(id)).filter((card) => card && visibleIds.has(card.id))
      }))
      .filter((entry) => {
        if (selectedGeneration && String(generationFromDexId(entry.dexId)) !== selectedGeneration) return false;
        if (typeValue && !shared.typesForDex(entry.dexId).includes(typeValue)) return false;
        return !query || normalize(`${entry.name} ${entry.dexId}`).includes(query) || entry.cards.length > 0;
      })
      .map(toPokedexItem);
  }

  function indexedGroupsToItems(indexGroups, visibleIds, mapper, sortFn) {
    return (indexGroups || [])
      .map((group) => ({
        name: group.name,
        cards: group.cardIds.map((id) => cardsById.get(id)).filter((card) => card && visibleIds.has(card.id))
      }))
      .filter((group) => group.cards.length > 0)
      .map(mapper)
      .sort(sortFn || sortByName);
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
    const typeValue = elements.typeFilter ? elements.typeFilter.value : "";
    const setValue = elements.setFilter ? elements.setFilter.value : "";
    const languageValue = elements.languageFilter ? elements.languageFilter.value : "";
    const ownedValue = elements.ownedFilter ? elements.ownedFilter.value : "all";

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
      const matchesType = !typeValue || shared.typesForDex(card.dexId).includes(typeValue);
      const matchesLangRegion = !elements.setRegionChips || shared.cardLanguageRegion(card.language) === selectedLangRegion;
      const matchesSet = !setValue || card.set === setValue;
      const matchesLanguage = !languageValue || card.language === languageValue;
      const isOwned = owned.has(card.id);
      const matchesOwned = ownedValue === "all" || (ownedValue === "owned" && isOwned) || (ownedValue === "missing" && !isOwned);

      return matchesQuery && matchesGeneration && matchesType && matchesLangRegion && matchesSet && matchesLanguage && matchesOwned;
    });
  }

  function createPokedexCard(item) {
    const article = document.createElement("article");
    article.className = "pokedex-card";
    const image = item.image
      ? `<img loading="lazy" src="${escapeAttribute(item.image)}" alt="${escapeAttribute(item.name)}">`
      : `<span class="image-placeholder">${escapeHtml(t("card.noImage"))}</span>`;
    const progress = item.totalCount ? Math.round((item.ownedCount / item.totalCount) * 100) : 0;

    article.innerHTML = `
      <a class="pokedex-link" href="${escapeAttribute(detailUrl("pokemon", item.name))}">
        <div class="pokedex-number">#${String(item.dexId || "?").padStart(4, "0")}</div>
        <div class="pokedex-image">${image}</div>
        <div class="pokedex-info">
          <h3>${escapeHtml(item.name)}</h3>
          <p>${escapeHtml(t("card.generation", { g: item.generation || "-" }))}</p>
        </div>
        <div class="progress-bar" aria-label="${escapeAttribute(t("progress.aria", { name: item.name }))}">
          <span style="width: ${progress}%"></span>
        </div>
        <div class="set-footer">
          <strong>${progress}%</strong>
          <span>${escapeHtml(t("count.ofCards", { o: item.ownedCount, t: item.totalCount }))}</span>
        </div>
      </a>
    `;

    return article;
  }

  // Cápsula compacta e clicável (estilo Pokédex): abre a página do grupo com
  // as cartas filtradas — sem listar todas as cartas aqui dentro.
  function createGroupCard(item) {
    const link = document.createElement("a");
    link.className = "group-card";
    const type = view === "artists" ? "artist" : view === "trainers" ? "trainer" : view;
    link.href = detailUrl(type, item.name);
    const progress = item.totalCount ? Math.round((item.ownedCount / item.totalCount) * 100) : 0;

    // Sem imagem de carta na cápsula (deixaria a lista pesada): só a inicial.
    // As cartas aparecem ao abrir a página do grupo.
    link.innerHTML = `
      <div class="group-card-body">
        <div class="group-card-head">
          <span class="group-card-initial">${escapeHtml(item.name.charAt(0).toUpperCase())}</span>
          <h3>${escapeHtml(item.name)}</h3>
        </div>
        <p>${escapeHtml(`${tn("count.cards", item.totalCount)} · ${tn("count.marked", item.ownedCount)}`)}</p>
        <div class="progress-bar" aria-label="${escapeAttribute(t("progress.aria", { name: item.name }))}">
          <span style="width: ${progress}%"></span>
        </div>
        <div class="set-footer">
          <strong>${progress}%</strong>
          <span>${item.ownedCount}/${item.totalCount}</span>
        </div>
      </div>
    `;

    return link;
  }

  function createSetCard(item) {
    const article = document.createElement("article");
    article.className = "set-card";
    article.dataset.href = detailUrl("set", item.name);
    const progress = item.totalCount ? Math.round((item.ownedCount / item.totalCount) * 100) : 0;
    const logo = item.logo
      ? localizedImg(item.logo, { alt: item.name, className: "set-logo", loading: "lazy" })
      : `<span class="set-logo-placeholder">${escapeHtml(item.name)}</span>`;
    const symbol = item.symbol
      ? localizedImg(item.symbol, { className: "set-symbol", loading: "lazy" })
      : "";
    const releaseBadge = item.releaseDate
      ? `<span class="set-release" title="${escapeAttribute(formatReleaseDate(item.releaseDate, "long"))}">${escapeHtml(formatReleaseDate(item.releaseDate))}</span>`
      : "";

    article.innerHTML = `
      <div class="set-art">
        ${releaseBadge}
        ${logo}
        ${symbol}
      </div>
      <div class="set-body">
        <div class="set-title-row">
          <h3>${escapeHtml(item.name)}</h3>
          <span class="tag">${escapeHtml(item.languageLabel)}</span>
        </div>
        <div class="set-meta">
          <span>${escapeHtml(t("set.officialCards", { n: item.officialTotal || item.totalCount }))}</span>
          <span>${escapeHtml(t("set.inLocalCatalog", { n: item.totalCount }))}</span>
          <span>${escapeHtml(t("set.marked", { n: item.ownedCount }))}</span>
        </div>
        <div class="progress-bar" aria-label="${escapeAttribute(t("progress.aria", { name: item.name }))}">
          <span style="width: ${progress}%"></span>
        </div>
        <div class="set-footer">
          <strong>${progress}%</strong>
          <span>${item.ownedCount}/${item.totalCount}</span>
        </div>
        <a class="details-link" href="${escapeAttribute(detailUrl("set", item.name))}">${escapeHtml(t("card.viewSet"))}</a>
      </div>
    `;

    return article;
  }

  function buildIndexes(sourceCards) {
    return {
      pokedex: pokedexIndexFromCards(sourceCards),
      trainers: groupToIndex(sourceCards.filter((card) => card.category === "Trainer"), (card) => card.name),
      sets: groupToIndex(sourceCards, (card) => card.set),
      artists: groupToIndex(sourceCards, (card) => card.artist || "Artista desconhecido")
    };
  }

  // Espécies agrupadas por dexId (não por nome): nomes de carta variam
  // ("M Absol", "Pikachu VMAX"), o número nacional não.
  function pokedexIndexFromCards(sourceCards) {
    const byDex = new Map();
    sourceCards.forEach((card) => {
      const dexId = Math.trunc(Number(card.dexId));
      if (!dexId) return;
      const entry = byDex.get(dexId) || { dexId, name: card.pokemonName || speciesName(card.name), cardIds: [] };
      entry.cardIds.push(card.id);
      byDex.set(dexId, entry);
    });
    return Array.from(byDex.values()).sort((a, b) => a.dexId - b.dexId);
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
    const sortedCards = group.cards.slice().sort((a, b) => shared.compareCardNumbers(a.number, b.number));
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
      releaseDate: sample.setReleaseDate || "",
      languageLabel: unique(sortedCards.map((card) => card.language.toUpperCase())).join("/")
    };
  }

  function toPokedexItem(group) {
    const sortedCards = group.cards.slice().sort((a, b) => a.set.localeCompare(b.set) || shared.compareCardNumbers(a.number, b.number));
    const sample = sortedCards[0] || {};
    const dexId = group.dexId || sample.dexId || "";
    return {
      type: "pokedex",
      name: group.name,
      cards: sortedCards,
      totalCount: sortedCards.length,
      ownedCount: sortedCards.filter((card) => owned.has(card.id)).length,
      dexId,
      generation: sample.generation || generationFromDexId(dexId),
      image: sample.pokemonImage || pokemonImageUrl(dexId),
      sets: unique(sortedCards.map((card) => card.set)).slice(0, 3),
      artists: unique(sortedCards.map((card) => card.artist)).slice(0, 3),
      variants: unique(sortedCards.flatMap((card) => card.variants || [])).slice(0, 8)
    };
  }

  function pokemonImageUrl(dexId) {
    return dexId ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${dexId}.png` : "";
  }

  function generationFromDexId(dexId) {
    const id = Number(dexId);
    if (!id) return "";
    if (id <= 151) return 1;
    if (id <= 251) return 2;
    if (id <= 386) return 3;
    if (id <= 493) return 4;
    if (id <= 649) return 5;
    if (id <= 721) return 6;
    if (id <= 809) return 7;
    if (id <= 905) return 8;
    return 9;
  }

  function sortByName(a, b) {
    return a.name.localeCompare(b.name);
  }

  // Sets do mais recente para o mais antigo (releaseDate em ISO ordena
  // cronologicamente como string); sets sem data vão para o fim.
  function sortByReleaseDesc(a, b) {
    if (a.releaseDate && b.releaseDate) {
      return b.releaseDate.localeCompare(a.releaseDate) || a.name.localeCompare(b.name);
    }
    if (a.releaseDate) return -1;
    if (b.releaseDate) return 1;
    return a.name.localeCompare(b.name);
  }

  function toRoman(value) {
    const numerals = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];
    return numerals[Number(value)] || String(value);
  }

  // Data de lançamento do set: badge compacto (mês/ano) e tooltip completo.
  function formatReleaseDate(value, style) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const options = style === "long"
      ? { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }
      : { month: "short", year: "numeric", timeZone: "UTC" };
    return date.toLocaleDateString(shared.getLocale(), options);
  }
})();
