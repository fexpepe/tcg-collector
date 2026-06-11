(function () {
  const shared = window.TCGShared;
  const { addOptions, unique, normalize, escapeHtml, escapeAttribute, speciesName, debounce } = shared;

  let cards = [];
  let cardsById = new Map();
  let pageCards = [];
  const owned = shared.createCollectionStore();
  const favorites = shared.createFavoritesStore();

  const TYPE_META = {
    normal: { label: "Normal", color: "#9fa19f" },
    fire: { label: "Fogo", color: "#e62829" },
    water: { label: "Água", color: "#2980ef" },
    electric: { label: "Elétrico", color: "#fac000" },
    grass: { label: "Planta", color: "#3fa129" },
    ice: { label: "Gelo", color: "#3dcef3" },
    fighting: { label: "Lutador", color: "#ff8000" },
    poison: { label: "Veneno", color: "#9141cb" },
    ground: { label: "Terra", color: "#915121" },
    flying: { label: "Voador", color: "#81b9ef" },
    psychic: { label: "Psíquico", color: "#ef4179" },
    bug: { label: "Inseto", color: "#91a119" },
    rock: { label: "Pedra", color: "#afa981" },
    ghost: { label: "Fantasma", color: "#704170" },
    dragon: { label: "Dragão", color: "#5060e1" },
    dark: { label: "Sombrio", color: "#50413f" },
    steel: { label: "Aço", color: "#60a1b8" },
    fairy: { label: "Fada", color: "#ef70ef" }
  };

  const REGION_BY_GENERATION = {
    1: "Kanto",
    2: "Johto",
    3: "Hoenn",
    4: "Sinnoh",
    5: "Unova",
    6: "Kalos",
    7: "Alola",
    8: "Galar",
    9: "Paldea"
  };

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
    languageFilter: document.getElementById("languageFilter"),
    ownedFilter: document.getElementById("ownedFilter"),
    ownedCount: document.getElementById("ownedCount"),
    totalCount: document.getElementById("totalCount"),
    completionRate: document.getElementById("completionRate"),
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

  resolveCards()
    .then((resolvedCards) => {
      cards = resolvedCards;
      cardsById = new Map(cards.map((card) => [card.id, card]));
      owned.migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId)));
      pageCards = getPageCards();
      init();
    })
    .catch((error) => {
      elements.empty.textContent = `Não foi possível carregar as cartas: ${error.message}`;
      elements.empty.hidden = false;
    });

  function init() {
    elements.type.textContent = typeLabel(detailType);
    elements.title.textContent = detailName || "Detalhe";
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
      const entry = manifest.sets.find((set) => set.name === detailName);
      return entry ? shared.fetchSetChunks([entry]) : [];
    }

    const indexes = window.TCG_INDEXES;
    const groups = detailType === "artist" ? indexes?.artists : indexes?.pokedex;
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

    return [];
  }

  function renderHero() {
    const sample = pageCards[0];
    if (!sample) return;

    if (detailType === "set") {
      const logo = sample.setLogo
        ? `<img class="set-logo" src="${escapeAttribute(sample.setLogo)}" alt="${escapeAttribute(sample.set)}">`
        : `<strong>${escapeHtml(sample.set)}</strong>`;
      const symbol = sample.setSymbol
        ? `<img class="set-symbol" src="${escapeAttribute(sample.setSymbol)}" alt="">`
        : "";
      elements.hero.innerHTML = `
        <div class="set-art detail-set-art">${logo}${symbol}</div>
        <div>
          <h2>${escapeHtml(sample.set)}</h2>
          <p>${sample.setTotal || pageCards.length} cartas oficiais · ${pageCards.length} no catálogo local</p>
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
    const generationLabel = sample.generation ? `Geração ${toRoman(sample.generation)}` : "";
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
        <p class="pokemon-hero-count">${pageCards.length} carta${pageCards.length === 1 ? "" : "s"} no catálogo local</p>
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
      formsToggle.textContent = `Ver as ${meta.forms.length} forma${meta.forms.length === 1 ? "" : "s"} desse Pokémon`;
      formsToggle.hidden = false;
      formsList.innerHTML = meta.forms
        .map((form) => `<span class="form-chip">${escapeHtml(formatFormName(form, detailName))}</span>`)
        .join("");
    }
  }

  function favoriteLabel(isFavorite) {
    return isFavorite ? "♥ Pokémon favoritado" : "♡ Favoritar Pokémon";
  }

  function typeBadge(slug) {
    const meta = TYPE_META[slug] || { label: slug, color: "#6b7280" };
    return `<span class="type-badge" style="--type-color: ${meta.color}">${escapeHtml(meta.label)}</span>`;
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
    addOptions(elements.languageFilter, unique(pageCards.map((card) => card.language)));
  }

  function bindEvents() {
    const applyFilters = () => render({ resetCount: true });
    elements.search.addEventListener("input", debounce(applyFilters, 200));
    [elements.setFilter, elements.languageFilter, elements.ownedFilter].forEach((element) => {
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
    const ownedInPage = pageCards.filter((card) => owned.has(card.id)).length;
    pager.render(visibleCards, createCard, { resetCount });

    elements.empty.hidden = visibleCards.length > 0;
    elements.resultCount.textContent = `${visibleCards.length} resultado${visibleCards.length === 1 ? "" : "s"}`;
    elements.ownedCount.textContent = ownedInPage;
    elements.totalCount.textContent = pageCards.length;
    elements.completionRate.textContent = pageCards.length ? `${Math.round((ownedInPage / pageCards.length) * 100)}%` : "0%";
  }

  function filterCards() {
    const query = normalize(elements.search.value);
    const setValue = elements.setFilter.value;
    const languageValue = elements.languageFilter.value;
    const ownedValue = elements.ownedFilter.value;

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

  function createCard(card) {
    const article = document.createElement("article");
    article.className = "card";
    const total = owned.totalForCard(card.id);
    const isOwned = total > 0;
    const image = card.image
      ? `<button class="image-open" data-preview-card-id="${escapeAttribute(card.id)}" aria-label="Ampliar ${escapeAttribute(card.name)}"><img loading="lazy" src="${escapeAttribute(card.image)}" alt="${escapeAttribute(card.name)}"></button>`
      : `<span class="image-placeholder">Sem imagem</span>`;

    article.innerHTML = `
      <div class="card-image">${image}</div>
      <div class="card-body">
        <div class="card-title-row">
          <h3>${escapeHtml(card.name)}</h3>
          <span class="tag">${escapeHtml(card.language.toUpperCase())}</span>
        </div>
        <div class="meta">
          ${escapeHtml(card.set)}<br>
          ${escapeHtml(card.number)} · ${escapeHtml(card.rarity)}<br>
          ${escapeHtml(card.artist || "Artista desconhecido")}
        </div>
        <div class="variant-quantities">${shared.variantQuantityRows(card, owned)}</div>
        <button class="owned-toggle" data-card-id="${escapeAttribute(card.id)}" aria-pressed="${isOwned}">
          ${isOwned ? `Tenho na coleção${total > 1 ? ` (×${total})` : ""}` : "Marcar como tenho"}
        </button>
      </div>
    `;

    return article;
  }

  function typeLabel(type) {
    const labels = {
      pokemon: "Pokédex",
      set: "Set",
      artist: "Artista"
    };
    return labels[type] || "Detalhe";
  }
})();
