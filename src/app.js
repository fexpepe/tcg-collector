(function () {
  const shared = window.TCGShared;
  const { addOptions, detailUrl, unique, normalize, escapeHtml, escapeAttribute, speciesName, debounce, t, tn, localizedImg, toRoman } = shared;

  let cards = [];
  let cardsById = new Map();
  let indexes = null;
  let totalCatalogCount = 0;
  const owned = shared.createCollectionStore();
  const wishlist = shared.createWishlistStore();
  const prices = shared.createPriceStore();

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
    resultCount: document.getElementById("resultCount")
  };
  const view = elements.grid.dataset.view || "pokedex";
  // Página de Sets filtrada por uma série específica (?serie=id).
  const serieParam = new URLSearchParams(window.location.search).get("serie") || "";
  const pager = shared.createPager({ grid: elements.grid, pageSize: 60 });
  let selectedGeneration = "";
  // Região padrão segue a preferência de idioma de carta; sem preferência ("all")
  // mantém o comportamento antigo (Inglês). Com preferência, os chips de região
  // somem (o seletor global de idioma passa a governar) — ver init().
  const isPokemonGame = () => ((window.SLEEVU && window.SLEEVU.game) || "pokemon") === "pokemon";
  let selectedLangRegion = shared.getCardLang() !== "all"
    ? shared.cardLanguageRegion(shared.getCardLang())
    : "english";

  const preview = shared.createCardPreview({
    getCard: (cardId) => cardsById.get(cardId),
    store: owned,
    prices,
    wishlist,
    onOwnedChange: () => render()
  });

  const cardLang = shared.getCardLang();
  const langMatch = (value) => cardLang === "all" || value === cardLang;

  // A Pokédex roda só com índices (não baixa os chunks de carta); as outras
  // visões (sets/artistas/treinadores) baixam só os chunks do idioma escolhido
  // (corta o download quando há preferência de idioma de carta).
  const catalogPromise = view === "pokedex"
    ? Promise.resolve(shared.loadIndexesOnly())
    : shared.loadCatalog(cardLang);

  // Na página de Sets, carrega o câmbio junto (pro valor total do set já sair
  // convertido na moeda escolhida).
  Promise.all([catalogPromise, view === "sets" ? shared.loadFxRates() : Promise.resolve()])
    .then(([catalog]) => {
      cards = catalog.cards;
      cardsById = new Map(cards.map((card) => [card.id, card]));
      indexes = catalog.indexes || buildIndexes(cards);
      totalCatalogCount = cards.length
        ? cards.filter((card) => langMatch(card.language)).length
        : (catalog.manifest ? catalog.manifest.sets.filter((set) => langMatch(set.language)).reduce((sum, set) => sum + (set.count || 0), 0) : 0);
      owned.migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId)));
      init();
    })
    .catch((error) => {
      elements.empty.textContent = t("error.catalog", { message: error.message });
      elements.empty.hidden = false;
    });

  function init() {
    // Com preferência de idioma de carta, o filtro de região vira redundante
    // (só aquele idioma é carregado) — esconde pra não conflitar. Também some
    // fora do Pokémon: região (EN/JP/CN/PT do MESMO set) é conceito de Pokémon;
    // no One Piece/Lorcana cada carta tem sua região (ex.: vintage Carddass = JP),
    // e filtrar por região esconderia o vintage por baixo do padrão "english".
    if (elements.setRegionChips && (shared.getCardLang() !== "all" || !isPokemonGame())) {
      elements.setRegionChips.hidden = true;
    }
    if (view === "sets" && serieParam) applySerieTitle();
    hydrateFilters();
    bindEvents();
    render();
  }

  // Na página de uma série, troca o título "Sets" pelo nome da série e põe um
  // link de volta pra lista completa.
  function applySerieTitle() {
    const head = document.querySelector(".page-head");
    const h1 = head && head.querySelector("h1");
    if (!h1) return;
    h1.removeAttribute("data-i18n");
    h1.textContent = serieDisplayName(serieParam);
    if (!head.querySelector(".serie-back")) {
      const back = document.createElement("a");
      back.className = "serie-back";
      back.href = "sets.html";
      back.textContent = `← ${t("nav.sets")}`;
      head.insertBefore(back, h1);
    }
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
        preview.open(imageButton.dataset.previewCardId, imageButton.dataset.previewVariant);
      }
    });
  }

  function render({ resetCount = false } = {}) {
    // Pokédex não filtra cartas (roda por espécie via índices); as outras
    // visões partem das cartas visíveis após os filtros.
    const items = view === "pokedex" ? pokedexViewItems() : getViewItems(filterCards());
    pager.render(items, createViewItem, { resetCount });

    // Cabeçalhos de série não contam como resultado.
    const realCount = items.filter((item) => item.type !== "series-head" && item.type !== "category-head").length;
    elements.empty.hidden = realCount > 0;
    elements.resultCount.textContent = tn("results.count", realCount);
    if (elements.ownedCount) elements.ownedCount.textContent = owned.size;
    if (elements.totalCount) elements.totalCount.textContent = totalCatalogCount;
    if (elements.completionRate) {
      elements.completionRate.textContent = totalCatalogCount ? `${Math.round((owned.size / totalCatalogCount) * 100)}%` : "0%";
    }
  }

  function getViewItems(visibleCards) {
    const visibleIds = new Set(visibleCards.map((card) => card.id));

    if (view === "sets") {
      const setItems = indexedGroupsToItems(indexes.sets, visibleIds, toSetItem);
      // Página de uma série (?serie=id): só os sets dela, sem cabeçalhos.
      if (serieParam) return setItems.filter((set) => set.serieId === serieParam).sort(sortByReleaseDesc);
      // Lorcana não tem séries: separa em 2 categorias (Principais + Promos).
      if ((window.SLEEVU && window.SLEEVU.game) === "lorcana") return groupLorcanaSets(setItems);
      // One Piece: Boosters (OP01…) + Starter Decks (ST-…) + o resto (promos etc.).
      if ((window.SLEEVU && window.SLEEVU.game) === "onepiece") return groupOnePieceSets(setItems);
      // Página de Sets: agrupada por série (coleção).
      return groupSetsBySeries(setItems);
    }

    if (view === "artists") {
      return indexedGroupsToItems(indexes.artists, visibleIds, toGroupItem);
    }

    if (view === "trainers") {
      return indexedGroupsToItems(indexes.trainers, visibleIds, toGroupItem);
    }

    return pokedexViewItems();
  }

  // Pokédex nacional completa: uma entrada por espécie em ordem de número.
  // TCG_POKEMON_NAMES garante as 1025 espécies e o nome canônico; os cardIds
  // por espécie vêm do índice (sem precisar das cartas em si).
  // Invariante após o init (depende só de indexes.pokedex + TCG_POKEMON_NAMES):
  // memoiza para não reconstruir o Map+sort de ~1000 espécies a cada tecla.
  let pokedexEntriesCache = null;
  function pokedexEntries() {
    if (pokedexEntriesCache) return pokedexEntriesCache;
    const byDex = new Map();

    (indexes.pokedex || []).forEach((group) => {
      const dexId = Math.trunc(Number(group.dexId)) || 0;
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

    pokedexEntriesCache = Array.from(byDex.values()).sort((a, b) => a.dexId - b.dexId);
    return pokedexEntriesCache;
  }

  // Espécie aparece se os filtros (geração/tipo) batem e, havendo busca, se o
  // nome ou o número da Pokédex bate. Tudo derivado do dexId + índice — não
  // depende de ter as cartas carregadas.
  function pokedexViewItems() {
    const query = normalize(elements.search.value);
    const typeValue = elements.typeFilter ? elements.typeFilter.value : "";

    return pokedexEntries()
      .filter((entry) => {
        if (selectedGeneration && String(generationFromDexId(entry.dexId)) !== selectedGeneration) return false;
        if (typeValue && !shared.typesForDex(entry.dexId).includes(typeValue)) return false;
        return !query || normalize(`${entry.name} ${entry.dexId}`).includes(query);
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
    if (item.type === "series-head") {
      return createSeriesHead(item);
    }

    if (item.type === "category-head") {
      return createCategoryHead(item);
    }

    if (item.type === "pokedex") {
      return createPokedexCard(item);
    }

    if (item.type === "set") {
      return createSetCard(item);
    }

    return createGroupCard(item);
  }

  // Cabeçalho de série na grade de Sets (ocupa a linha toda); clicável → abre a
  // página daquela série (sets.html?serie=id).
  function createSeriesHead(item) {
    const link = document.createElement("a");
    link.className = "set-series-head";
    link.href = `sets.html?serie=${encodeURIComponent(item.serieId)}`;
    link.innerHTML = `<span class="set-series-name">${escapeHtml(item.name)}</span><span class="set-series-count">${item.count} sets →</span>`;
    return link;
  }

  // Cabeçalho de categoria (Lorcana: Principais/Promos). Igual ao de série, mas
  // sem link/seta — é só um rótulo de seção, não navega pra lugar nenhum.
  function createCategoryHead(item) {
    const head = document.createElement("div");
    head.className = "set-series-head set-category-head";
    head.innerHTML = `<span class="set-series-name">${escapeHtml(item.name)}</span><span class="set-series-count">${item.count} sets</span>`;
    return head;
  }

  function filterCards() {
    const generationValue = selectedGeneration;
    const typeValue = elements.typeFilter ? elements.typeFilter.value : "";
    const setValue = elements.setFilter ? elements.setFilter.value : "";
    const languageValue = elements.languageFilter ? elements.languageFilter.value : "";
    const ownedValue = elements.ownedFilter ? elements.ownedFilter.value : "all";

    return cards.filter((card) => {
      const matchesQuery = shared.matchesCardQuery(card, elements.search.value);
      const matchesGeneration = !generationValue || String(card.generation) === generationValue;
      const matchesType = !typeValue || shared.typesForDex(card.dexId).includes(typeValue);
      const matchesLangRegion = !isPokemonGame() || !elements.setRegionChips || shared.cardLanguageRegion(card.language) === selectedLangRegion;
      const matchesSet = !setValue || card.set === setValue;
      const matchesLanguage = !languageValue || card.language === languageValue;
      const isOwned = owned.has(card.id);
      const matchesOwned = ownedValue === "all" || (ownedValue === "owned" && isOwned) || (ownedValue === "missing" && !isOwned);

      return matchesQuery && matchesGeneration && matchesType && matchesLangRegion && matchesSet && matchesLanguage && matchesOwned;
    });
  }

  function createPokedexCard(item) {
    const article = document.createElement("article");
    // Contorno dourado quando já há ao menos uma carta desse Pokémon na coleção
    // (feedback rápido pra quem está completando a Pokédex).
    article.className = `pokedex-card${item.ownedCount > 0 ? " owned" : ""}`;
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
      <a class="set-art-link" href="${escapeAttribute(detailUrl("set", item.name))}" aria-label="${escapeAttribute(item.name)}">
        <div class="set-art">
          ${releaseBadge}
          ${logo}
          ${symbol}
        </div>
      </a>
      <div class="set-body">
        <div class="set-title-row">
          <h3>${escapeHtml(item.name)}</h3>
          <span class="tag">${escapeHtml(item.languageLabel)}</span>
        </div>
        <div class="set-meta">
          <span class="set-pill"><span class="set-pill-label">${escapeHtml(t("set.totalCardsLabel"))}</span> <strong>${escapeHtml(String(item.totalCount))}</strong></span>
          ${item.value > 0 ? `<span class="set-pill" title="${escapeAttribute(t("set.valueTitle"))}"><span class="set-pill-label">${escapeHtml(t("set.totalValueLabel"))}</span> <strong class="set-value">${escapeHtml(shared.formatMoney(shared.getCurrency(), item.value))}</strong></span>` : ""}
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
    const serieId = sample.setSerieId || deriveSerieId(sample.setId);
    return {
      type: "set",
      name: group.name,
      setId: sample.setId || "",
      cards: sortedCards,
      totalCount: sortedCards.length,
      ownedCount: sortedCards.filter((card) => owned.has(card.id)).length,
      officialTotal: sample.setTotal || sortedCards.length,
      value: shared.sumCardsValue(sortedCards, prices).value,
      logo: sample.setLogo || "",
      symbol: sample.setSymbol || "",
      releaseDate: sample.setReleaseDate || "",
      serieId,
      serieName: sample.setSerieName || serieDisplayName(serieId),
      languageLabel: unique(sortedCards.map((card) => shared.cardLangSigla(card.language))).join("/")
    };
  }

  // Séries (coleções) da TCGdex. Usado para agrupar a página de Sets e como
  // fallback quando a carta ainda não traz a série (catálogo antigo/amostra):
  // deriva pelo prefixo do setId.
  const SERIES_DEFS = [
    ["base", "Base"], ["gym", "Gym"], ["neo", "Neo"], ["lc", "Legendary Collection"],
    ["ecard", "E-Card"], ["ex", "EX"], ["pop", "POP"], ["tk", "Trainer Kits"],
    ["dp", "Diamond & Pearl"], ["pl", "Platinum"], ["hgss", "HeartGold & SoulSilver"],
    ["col", "Call of Legends"], ["bw", "Black & White"], ["xy", "XY"], ["sm", "Sun & Moon"],
    ["swsh", "Sword & Shield"], ["sv", "Scarlet & Violet"], ["me", "Mega Evolution"],
    ["mc", "McDonald's Collection"], ["tcgp", "Pokémon TCG Pocket"]
  ];
  const SERIES_BY_PREFIX = SERIES_DEFS.slice().sort((a, b) => b[0].length - a[0].length);

  function deriveSerieId(setId) {
    const id = String(setId || "").toLowerCase();
    const hit = SERIES_BY_PREFIX.find(([prefix]) => id.startsWith(prefix));
    return hit ? hit[0] : "misc";
  }

  function serieDisplayName(id) {
    const hit = SERIES_DEFS.find(([prefix]) => prefix === id);
    return hit ? hit[1] : (id === "misc" ? "Outros" : String(id).toUpperCase());
  }

  // Agrupa os sets por série, em itens achatados [cabeçalho, ...sets, ...] para
  // o pager. Séries em ordem do set mais recente; sets por lançamento desc.
  function groupSetsBySeries(setItems) {
    const bySerie = new Map();
    setItems.forEach((set) => {
      const key = set.serieId || "misc";
      if (!bySerie.has(key)) bySerie.set(key, { serieId: key, serieName: set.serieName, sets: [] });
      bySerie.get(key).sets.push(set);
    });
    const groups = Array.from(bySerie.values()).map((group) => {
      group.sets.sort(sortByReleaseDesc);
      group.newest = group.sets[0] ? group.sets[0].releaseDate || "" : "";
      return group;
    }).sort((a, b) => (b.newest || "").localeCompare(a.newest || ""));

    const items = [];
    groups.forEach((group) => {
      items.push({ type: "series-head", name: group.serieName || serieDisplayName(group.serieId), serieId: group.serieId, count: group.sets.length });
      group.sets.forEach((set) => items.push(set));
    });
    return items;
  }

  // Lorcana: 2 categorias, com cabeçalho simples (sem página de série). "Promos"
  // = sets de código não-numérico (P1/P2/P3 promo, cp/C2 challenge, D23/DIS
  // coleções de evento); os sets principais têm código numérico (1..12).
  function groupLorcanaSets(setItems) {
    const isPromo = (set) => !/^\d+$/.test(String(set.setId || "").trim());
    const main = setItems.filter((set) => !isPromo(set)).sort(sortByReleaseDesc);
    const promos = setItems.filter(isPromo).sort(sortByReleaseDesc);
    const items = [];
    if (main.length) {
      items.push({ type: "category-head", name: t("sets.category.main"), count: main.length });
      main.forEach((set) => items.push(set));
    }
    if (promos.length) {
      items.push({ type: "category-head", name: t("sets.category.promos"), count: promos.length });
      promos.forEach((set) => items.push(set));
    }
    return items;
  }

  // One Piece: boosters principais têm setId "OP<nn>"; starter decks "ST-…"; o
  // resto (pre-release, demo, promos) vai numa categoria final.
  function groupOnePieceSets(setItems) {
    const isCarddass = (set) => /^opcd-/i.test(String(set.setId || "").trim());
    const isOp2002 = (set) => /^op2002-/i.test(String(set.setId || "").trim());
    const isMain = (set) => /^OP\d+$/i.test(String(set.setId || "").trim());
    const isDeck = (set) => /^ST/i.test(String(set.setId || "").trim());
    const carddass = setItems.filter(isCarddass).sort(sortByReleaseDesc);
    const op2002 = setItems.filter(isOp2002).sort(sortByReleaseDesc);
    const rest = setItems.filter((s) => !isCarddass(s) && !isOp2002(s));
    const main = rest.filter(isMain).sort(sortByReleaseDesc);
    const decks = rest.filter((s) => !isMain(s) && isDeck(s)).sort(sortByReleaseDesc);
    const promos = rest.filter((s) => !isMain(s) && !isDeck(s)).sort(sortByReleaseDesc);
    const items = [];
    if (main.length) {
      items.push({ type: "category-head", name: t("sets.category.main"), count: main.length });
      main.forEach((set) => items.push(set));
    }
    if (decks.length) {
      items.push({ type: "category-head", name: t("sets.category.decks"), count: decks.length });
      decks.forEach((set) => items.push(set));
    }
    if (promos.length) {
      items.push({ type: "category-head", name: t("sets.category.promos"), count: promos.length });
      promos.forEach((set) => items.push(set));
    }
    // Duas linhas VINTAGE, cada uma na sua categoria no fim, em ordem crescente de
    // lançamento: Carddass Hyper Battle (1999–2002) e o One Piece Card Game de 2002–2005.
    if (carddass.length) {
      items.push({ type: "category-head", name: t("sets.category.vintage"), count: carddass.length });
      carddass.slice().reverse().forEach((set) => items.push(set));
    }
    if (op2002.length) {
      items.push({ type: "category-head", name: t("sets.category.op2002"), count: op2002.length });
      op2002.slice().reverse().forEach((set) => items.push(set));
    }
    return items;
  }

  function toPokedexItem(entry) {
    // Conta só as cartas do idioma escolhido (idioma vem do sufixo do id).
    const ids = entry.cardIds.filter((id) => langMatch(shared.cardLanguageFromId(id)));
    return {
      type: "pokedex",
      name: entry.name,
      dexId: entry.dexId,
      totalCount: ids.length,
      ownedCount: ids.filter((id) => owned.has(id)).length,
      generation: generationFromDexId(entry.dexId),
      image: pokemonImageUrl(entry.dexId)
    };
  }

  // Sprite pequeno (~1KB) para o grid da Pokédex — a arte grande (~145KB) só é
  // usada no hero da página do Pokémon. Renderizado com image-rendering crisp.
  function pokemonImageUrl(dexId) {
    return shared.spriteUrl(dexId);
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
