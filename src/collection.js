(function () {
  const shared = window.TCGShared;
  const { addOptions, detailUrl, unique, normalize, speciesName, debounce, t, tn, escapeHtml, escapeAttribute } = shared;

  let cards = [];
  let cardsById = new Map();
  let indexes = null;
  let gameFilter = "all"; // all | pokemon | lorcana

  // Coleção UNIFICADA: stores por jogo + facades que despacham por jogo (resolvido
  // pelo cardGameMap, populado quando o catálogo carrega). Assim variantTile/
  // preview/handlers funcionam sem saber que há vários jogos.
  const ownedByGame = { pokemon: shared.createCollectionStore("pokemon"), lorcana: shared.createCollectionStore("lorcana") };
  const wishlistByGame = { pokemon: shared.createWishlistStore("pokemon"), lorcana: shared.createWishlistStore("lorcana") };
  const pricesByGame = { pokemon: shared.createPriceStore("pokemon"), lorcana: shared.createPriceStore("lorcana") };
  const cardGameMap = new Map();
  const gameOf = (id) => cardGameMap.get(id) || "pokemon";
  const owned = shared.mergedCollectionStore(ownedByGame, gameOf);
  const wishlist = shared.mergedWishlistStore(wishlistByGame, gameOf);
  const prices = shared.mergedPriceStore(pricesByGame, gameOf);

  let activeTab = "cards";
  let sortMode = "dex";

  const GROUP_TABS = {
    pokemon: {
      getKey: (card) => card.pokemonName || speciesName(card.name),
      detailType: "pokemon",
      defaultSort: "dex",
      sorts: ["dex", "name", "progress"]
    },
    artists: {
      getKey: (card) => card.artist || "Artista desconhecido",
      detailType: "artist",
      defaultSort: "name",
      sorts: ["name", "progress"]
    },
    sets: {
      getKey: (card) => card.set,
      detailType: "set",
      defaultSort: "name",
      sorts: ["name", "progress"]
    }
  };

  const elements = {
    gameFilter: document.getElementById("gameFilter"),
    tabs: document.getElementById("collectionTabs"),
    groupsView: document.getElementById("groupsView"),
    groupSummaryText: document.getElementById("groupSummaryText"),
    groupSummaryPct: document.getElementById("groupSummaryPct"),
    groupSummaryBar: document.getElementById("groupSummaryBar"),
    sortChips: document.getElementById("sortChips"),
    groupList: document.getElementById("groupList"),
    groupsEmpty: document.getElementById("groupsEmpty"),
    cardsView: document.getElementById("cardsView"),
    grid: document.getElementById("cardGrid"),
    empty: document.getElementById("emptyState"),
    search: document.getElementById("searchInput"),
    pokemonFilter: document.getElementById("pokemonFilter"),
    setFilter: document.getElementById("setFilter"),
    languageFilter: document.getElementById("languageFilter"),
    rarityFilter: document.getElementById("rarityFilter"),
    resultCount: document.getElementById("resultCount"),
    dashboard: document.getElementById("collectionDashboard"),
    dashCopies: document.getElementById("dashCopies"),
    dashDistinct: document.getElementById("dashDistinct"),
    dashSets: document.getElementById("dashSets"),
    dashValue: document.getElementById("dashValue"),
    dashTopList: document.getElementById("dashTopList"),
    dashDist: document.getElementById("dashDist")
  };

  const pager = shared.createPager({ grid: elements.grid, pageSize: 60 });

  const preview = shared.createCardPreview({
    getCard: (cardId) => cardsById.get(cardId),
    store: owned,
    prices,
    wishlist,
    onOwnedChange: () => refreshOwnershipCards()
  });

  // ?s=<id>: visualização pública (somente leitura) de uma coleção compartilhada.
  // Os dados vêm desnormalizados no share, então não precisa carregar o catálogo.
  const shareId = new URLSearchParams(window.location.search).get("s");

  if (shareId) {
    shared.loadFxRates().then(() => renderSharedCollection(shareId));
  } else {
    // Coleção unificada: carrega as cartas que você tem dos DOIS jogos (cada uma
    // marcada com card.game) e mescla. Cada jogo lê só os seus ids.
    // Liga os controles JÁ (filtro de jogo, abas, busca) — independem do catálogo.
    // Assim os botões nunca ficam "mortos" se o carregamento demorar/falhar.
    bindEvents();
    Promise.all([
      shared.loadOwnedAcrossGames({
        pokemon: ownedByGame.pokemon.knownCardIds(),
        lorcana: ownedByGame.lorcana.knownCardIds()
      }),
      shared.loadFxRates()
    ])
      .then(([catalog]) => {
        cards = catalog.cards;
        cards.forEach((card) => cardGameMap.set(card.id, card.game));
        indexes = mergeIndexes(catalog.indexesByGame);
        cardsById = new Map(cards.map((card) => [card.id, card]));
        Object.keys(ownedByGame).forEach((g) =>
          ownedByGame[g].migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId))));
        hydrateFilters();
        bindShareButton();
        render();
      })
      .catch((error) => {
        elements.groupsEmpty.textContent = t("error.catalog", { message: error.message });
        elements.groupsEmpty.hidden = false;
      });
  }

  // Une os índices dos jogos (cada entrada marcada com .game) p/ os totais de
  // progresso das abas de grupo respeitarem o filtro de jogo.
  function mergeIndexes(byGame) {
    const sets = [];
    const artists = [];
    let pokemonTotals = {};
    Object.keys(byGame || {}).forEach((g) => {
      const idx = byGame[g];
      if (!idx) return;
      (idx.sets || []).forEach((s) => sets.push(Object.assign({ game: g }, s)));
      (idx.artists || []).forEach((a) => artists.push(Object.assign({ game: g }, a)));
      if (idx.pokemonTotals) pokemonTotals = Object.assign(pokemonTotals, idx.pokemonTotals);
    });
    return { sets, artists, pokemonTotals };
  }

  function inGameFilter(card) {
    return gameFilter === "all" || card.game === gameFilter;
  }

  function ownedCards() {
    return cards.filter((card) => inGameFilter(card) && owned.has(card.id));
  }

  function hydrateFilters() {
    const myCards = ownedCards();
    addOptions(elements.pokemonFilter, unique(myCards.map((card) => card.pokemonName || speciesName(card.name))));
    addOptions(elements.setFilter, unique(myCards.map((card) => card.set)));
    addOptions(elements.languageFilter, unique(myCards.map((card) => card.language)), (value) => shared.cardLanguageLabel(value));
    applyCardLangDefault(elements.languageFilter);
    addOptions(elements.rarityFilter, unique(myCards.map((card) => card.rarity)));
  }

  // Aplica o idioma de carta preferido como valor inicial do filtro de idioma,
  // se esse idioma estiver entre as opções (senão fica em "Todos").
  function applyCardLangDefault(select) {
    const pref = shared.getCardLang();
    if (pref !== "all" && Array.from(select.options).some((option) => option.value === pref)) {
      select.value = pref;
    }
  }

  function bindEvents() {
    elements.gameFilter.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-game-filter]");
      if (!chip || chip.dataset.gameFilter === gameFilter) return;
      gameFilter = chip.dataset.gameFilter;
      Array.from(elements.gameFilter.children).forEach((node) => {
        node.setAttribute("aria-pressed", node === chip ? "true" : "false");
      });
      render({ resetCount: true });
    });

    elements.tabs.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-tab]");
      if (!chip || chip.dataset.tab === activeTab) return;
      activeTab = chip.dataset.tab;
      if (GROUP_TABS[activeTab]) {
        sortMode = GROUP_TABS[activeTab].defaultSort;
      }
      Array.from(elements.tabs.children).forEach((node) => {
        node.setAttribute("aria-pressed", node === chip ? "true" : "false");
      });
      render();
    });

    elements.sortChips.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-sort]");
      if (!chip) return;
      sortMode = chip.dataset.sort;
      render();
    });

    const applyFilters = () => render({ resetCount: true });
    elements.search.addEventListener("input", debounce(applyFilters, 200));
    [elements.pokemonFilter, elements.setFilter, elements.languageFilter, elements.rarityFilter].forEach((element) => {
      element.addEventListener("input", applyFilters);
    });

    elements.grid.addEventListener("click", (event) => {
      const imageButton = event.target.closest("[data-preview-card-id]");
      if (imageButton) {
        preview.open(imageButton.dataset.previewCardId, imageButton.dataset.previewVariant);
        return;
      }

      if (shared.handleWantTileClick(event, wishlist)) {
        refreshOwnershipCards();
        return;
      }

      if (shared.handleOwnedTileClick(event, owned, wishlist)) {
        refreshOwnershipCards();
      }
    });
  }

  function render(options) {
    const isCardsTab = activeTab === "cards";
    elements.groupsView.hidden = isCardsTab;
    elements.cardsView.hidden = !isCardsTab;

    renderDashboard();
    if (isCardsTab) {
      renderCards(options || {});
    } else {
      renderGroups();
    }
  }

  // Dashboard de resumo no topo (estilo "perfil"): stats + mais valiosas +
  // distribuição por jogo. Reflete o filtro de jogo atual.
  function renderDashboard() {
    if (!elements.dashboard) return;
    elements.dashboard.hidden = false;
    const myCards = ownedCards();

    // Stats
    let copies = 0;
    myCards.forEach((card) => { copies += owned.totalForCard(card.id); });
    elements.dashCopies.textContent = copies;
    elements.dashDistinct.textContent = myCards.length;
    elements.dashSets.textContent = unique(myCards.map((card) => card.set)).length;
    const value = ownedMarketValue(myCards);
    elements.dashValue.textContent = value > 0 ? shared.formatMoney(shared.getCurrency(), value) : "—";

    // Mais valiosas (top 3 por valor unitário)
    const top = myCards.map((card) => {
      const variant = (card.variants || []).find((v) => owned.variantTotal(card.id, v) > 0) || shared.defaultVariant(card);
      return { card, variant, val: shared.cardValue(card, variant, prices).value || 0 };
    }).filter((x) => x.val > 0).sort((a, b) => b.val - a.val).slice(0, 3);
    elements.dashTopList.innerHTML = top.length
      ? top.map(({ card, val }) => {
          const src = shared.cardImageSources(card);
          const thumb = shared.localizedImg(src.url, { alt: "", fallback: src.fallback, loading: "lazy", thumb: true });
          return `<li><a href="${escapeAttribute(detailUrl("set", card.set))}"><span class="dash-top-thumb">${thumb}</span>
            <span class="dash-top-info"><strong>${escapeHtml(card.name)}</strong><span class="dash-top-set">${escapeHtml(card.set)}</span></span>
            <span class="dash-top-val">${escapeHtml(shared.formatMoney(shared.getCurrency(), val))}</span></a></li>`;
        }).join("")
      : `<li class="dash-empty">${escapeHtml(t("dash.empty"))}</li>`;

    // Distribuição por jogo (Pokémon × Lorcana), entre as cartas filtradas.
    const byGame = {};
    myCards.forEach((card) => { byGame[card.game] = (byGame[card.game] || 0) + 1; });
    const order = [
      { game: "pokemon", label: t("filter.gamePokemon"), color: "#d9a300" },
      { game: "lorcana", label: t("filter.gameLorcana"), color: "#3f3d96" }
    ].filter((g) => byGame[g.game]);
    const max = Math.max(1, ...order.map((g) => byGame[g.game]));
    elements.dashDist.innerHTML = order.length
      ? order.map((g) => `<div class="dash-dist-row">
          <span class="dash-dist-label">${escapeHtml(g.label)}</span>
          <span class="dash-dist-track"><span class="dash-dist-fill" style="width:${Math.round((byGame[g.game] / max) * 100)}%;background:${g.color}"></span></span>
          <span class="dash-dist-n">${byGame[g.game]}</span>
        </div>`).join("")
      : `<p class="dash-empty">${escapeHtml(t("dash.empty"))}</p>`;
  }

  // Valor de mercado das cartas que você tem (na moeda atual): soma cada cópia
  // pela condição que ela tem.
  function ownedMarketValue(myCards) {
    let total = 0;
    myCards.forEach((card) => {
      (card.variants || [shared.defaultVariant(card)]).forEach((variant) => {
        owned.conditionBreakdown(card.id, variant).forEach(({ condition, quantity }) => {
          const v = shared.cardValue(card, variant, prices, condition).value;
          if (v) total += v * quantity;
        });
      });
    });
    return total;
  }

  // --- Aba de cartas (grade com filtros) ---

  function renderCards({ resetCount = false } = {}) {
    const tiles = ownedTilePairs();
    pager.render(tiles, ({ card, variant }) => shared.variantTile(card, variant, owned, wishlist, prices), { resetCount });
    updateCardsStats(tiles.length);
  }

  function ownedTilePairs() {
    return shared.cardVariantPairs(filterCards())
      .filter(({ card, variant }) => owned.variantTotal(card.id, variant) > 0)
      // Cartas sem imagem por último (sort estável preserva a ordem restante).
      .sort((a, b) => Number(shared.cardHasImage(b.card)) - Number(shared.cardHasImage(a.card)));
  }

  // Atualiza tiles e contadores no DOM existente, sem reconstruir a grade
  // (reconstruir faria todas as imagens piscarem). Tiles zerados saem da vista.
  function refreshOwnershipCards() {
    if (activeTab !== "cards") {
      render();
      return;
    }
    elements.grid.querySelectorAll(".card-tile").forEach((tile) => {
      const quantity = owned.variantTotal(tile.dataset.tileCardId, tile.dataset.tileVariant);
      if (quantity > 0) {
        shared.refreshTileOwnership(tile, owned, wishlist);
      } else {
        tile.remove();
      }
    });
    updateCardsStats(ownedTilePairs().length);
  }

  function updateCardsStats(tileCount) {
    elements.empty.hidden = tileCount > 0;
    elements.resultCount.textContent = tn("results.count", tileCount);
  }

  function filterCards() {
    const pokemonValue = elements.pokemonFilter.value;
    const setValue = elements.setFilter.value;
    const languageValue = elements.languageFilter.value;
    const rarityValue = elements.rarityFilter.value;

    return ownedCards().filter((card) => {
      const matchesQuery = shared.matchesCardQuery(card, elements.search.value);
      const matchesPokemon = !pokemonValue || (card.pokemonName || speciesName(card.name)) === pokemonValue;
      const matchesSet = !setValue || card.set === setValue;
      const matchesLanguage = !languageValue || card.language === languageValue;
      const matchesRarity = !rarityValue || card.rarity === rarityValue;

      return matchesQuery && matchesPokemon && matchesSet && matchesLanguage && matchesRarity;
    });
  }

  // --- Abas de grupos (Pokémon / Artistas / Sets / Idiomas) ---

  function renderGroups() {
    const tab = GROUP_TABS[activeTab];
    const groups = buildGroups(tab);

    renderSortChips(tab);

    const ownedSum = groups.reduce((sum, group) => sum + group.ownedCount, 0);
    const totalSum = groups.reduce((sum, group) => sum + group.totalCount, 0);
    const overallPct = totalSum ? formatPct((ownedSum / totalSum) * 100) : 0;

    elements.groupSummaryText.textContent = tn(`collection.summary.${activeTab}`, groups.length, { o: ownedSum, t: totalSum });
    elements.groupSummaryPct.textContent = `${overallPct}%`;
    elements.groupSummaryBar.style.width = `${Math.min(100, totalSum ? (ownedSum / totalSum) * 100 : 0)}%`;

    sortGroups(groups);

    elements.groupList.innerHTML = groups.map((group) => groupRow(group, tab)).join("");
    elements.groupsEmpty.hidden = groups.length > 0;
  }

  // Totais por grupo (denominador do progresso), no catálogo inteiro. Saem dos
  // índices mesclados (cada entrada marcada com .game, respeitando o filtro de
  // jogo). Sem índices, conta as cartas carregadas. Chaves = tab.getKey.
  function totalsForTab() {
    const map = new Map();
    const matchGame = (g) => gameFilter === "all" || g === gameFilter;
    const hasIndex = indexes && ((indexes.sets && indexes.sets.length) || Object.keys(indexes.pokemonTotals || {}).length || (indexes.artists && indexes.artists.length));
    if (hasIndex) {
      if (activeTab === "sets") {
        (indexes.sets || []).forEach((g) => { if (matchGame(g.game)) map.set(g.name, (map.get(g.name) || 0) + g.cardIds.length); });
      } else if (activeTab === "artists") {
        (indexes.artists || []).forEach((g) => { if (matchGame(g.game)) map.set(g.name, (map.get(g.name) || 0) + g.cardIds.length); });
      } else if (activeTab === "pokemon") {
        if (matchGame("pokemon")) Object.entries(indexes.pokemonTotals || {}).forEach(([name, n]) => map.set(name, n));
      }
      return map;
    }
    cards.filter(inGameFilter).forEach((card) => {
      const key = GROUP_TABS[activeTab].getKey(card) || "—";
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }

  function buildGroups(tab) {
    const totals = totalsForTab();
    // Agrupa as cartas que você tem (já são só dos sets carregados em modo
    // manifest); o total vem de `totals` (catálogo inteiro).
    const map = new Map();
    ownedCards().forEach((card) => {
      const key = tab.getKey(card) || "—";
      let group = map.get(key);
      if (!group) {
        group = { name: key, totalCount: totals.get(key) || 0, ownedCount: 0, sample: card };
        map.set(key, group);
      }
      group.ownedCount++;
    });
    // Defensivo: nunca deixa o total abaixo do que você tem.
    map.forEach((group) => { if (group.totalCount < group.ownedCount) group.totalCount = group.ownedCount; });
    return Array.from(map.values());
  }

  function sortGroups(groups) {
    if (sortMode === "progress") {
      groups.sort((a, b) => (b.ownedCount / b.totalCount) - (a.ownedCount / a.totalCount) || a.name.localeCompare(b.name));
    } else if (sortMode === "dex") {
      groups.sort((a, b) => (a.sample.dexId || 9999) - (b.sample.dexId || 9999) || a.name.localeCompare(b.name));
    } else {
      groups.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  function renderSortChips(tab) {
    elements.sortChips.innerHTML = "";
    tab.sorts.forEach((sort) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.dataset.sort = sort;
      chip.textContent = t(`sort.${sort}`);
      chip.setAttribute("aria-pressed", sort === sortMode ? "true" : "false");
      elements.sortChips.appendChild(chip);
    });
  }

  function groupRow(group, tab) {
    const pct = formatPct((group.ownedCount / group.totalCount) * 100);
    const art = groupArt(group, tab);
    const dexTag = activeTab === "pokemon" && group.sample.dexId
      ? `<span class="dex-tag">#${group.sample.dexId}</span>`
      : "";
    const body = `
      <div class="progress-row-art">${art}</div>
      <div class="progress-row-body">
        <div class="progress-row-title">
          <strong>${escapeHtml(group.name)}</strong>
          ${dexTag}
          <span class="row-count">${group.ownedCount}/${group.totalCount}</span>
        </div>
        <div class="progress-bar" aria-label="${escapeAttribute(t("progress.aria", { name: group.name }))}">
          <span style="width: ${Math.min(100, (group.ownedCount / group.totalCount) * 100)}%"></span>
        </div>
        <p class="progress-row-meta">${escapeHtml(`${tn("count.cards", group.totalCount)} · ${pct}%`)}</p>
      </div>
    `;

    if (tab.detailType) {
      return `<a class="progress-row" href="${escapeAttribute(detailUrl(tab.detailType, group.name, "collection"))}">${body}</a>`;
    }
    return `<div class="progress-row">${body}</div>`;
  }

  function groupArt(group, tab) {
    const sample = group.sample;
    if (activeTab === "pokemon" && sample.pokemonImage) {
      return `<img loading="lazy" src="${escapeAttribute(sample.pokemonImage)}" alt="">`;
    }
    if (activeTab === "sets" && (sample.setSymbol || sample.setLogo)) {
      return shared.localizedImg(sample.setSymbol || sample.setLogo, { loading: "lazy" });
    }
    return `<span class="progress-row-initial">${escapeHtml(group.name.charAt(0).toUpperCase())}</span>`;
  }

  function formatPct(value) {
    if (!value) return 0;
    return value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  }

  // ---------------------------------------------------------------------------
  // Compartilhar coleção por link público (mesma tabela `shares`).
  // ---------------------------------------------------------------------------
  const fromBRL = (v) => { const r = shared.convertMoney(v, "BRL", shared.getCurrency()); return r == null ? v : r; };

  // Desnormaliza as cartas que você tem num snapshot leve (nome, set, imagem,
  // valor em BRL) — o viewer renderiza sem precisar do catálogo.
  function buildShareData() {
    const items = [];
    shared.cardVariantPairs(ownedCards()).forEach(({ card, variant }) => {
      const qty = owned.variantTotal(card.id, variant);
      if (qty <= 0) return;
      const src = shared.cardImageSources(card);
      const unit = shared.cardValue(card, variant, prices).value || 0;
      const vbrl = shared.convertMoney(unit, shared.getCurrency(), "BRL");
      items.push({
        id: card.id, n: card.name, s: card.set, num: card.number, lang: card.language,
        v: variant, q: qty, vbrl: vbrl == null ? 0 : Math.round(vbrl * 100) / 100,
        img: src.url, fb: src.fallback || ""
      });
    });
    items.sort((a, b) => (b.vbrl * b.q) - (a.vbrl * a.q));
    return { items };
  }

  function bindShareButton() {
    const btn = document.getElementById("collectionShareBtn");
    if (!btn) return;
    btn.hidden = ownedCards().length === 0;
    btn.addEventListener("click", async () => {
      const original = t("collection.share");
      btn.disabled = true; btn.textContent = t("collection.share.creating");
      const res = await shared.createShare("collection", null, buildShareData());
      btn.disabled = false;
      if (res && res.id) {
        const link = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}collection.html?s=${res.id}`;
        try { await navigator.clipboard.writeText(link); btn.textContent = t("collection.share.copied"); }
        catch (e) { window.prompt(t("collection.share.copyManual"), link); btn.textContent = original; }
      } else {
        alert(res && res.error === "auth" ? t("collection.share.needLogin") : t("collection.share.error"));
        btn.textContent = original;
      }
      setTimeout(() => { btn.textContent = original; }, 2500);
    });
  }

  function sharedTile(it) {
    const img = shared.localizedImg(it.img, { alt: it.n, fallback: it.fb, loading: "lazy", thumb: true });
    const val = fromBRL(it.vbrl || 0);
    const flag = shared.cardFlag(it.lang);
    return `<article class="card-tile shared-tile">
      <div class="card-image"><span class="image-open">${img}</span></div>
      <div class="tile-info">
        <h3>${escapeHtml(it.n)}</h3>
        <p class="tile-set"><span>${escapeHtml(it.s)} · ${escapeHtml(it.num)}</span></p>
        <p class="tile-variant">${flag}<span>${escapeHtml(it.v)}${it.q > 1 ? ` ×${it.q}` : ""}</span></p>
        ${val > 0 ? `<p class="tile-price">${escapeHtml(shared.formatMoney(shared.getCurrency(), val))}</p>` : ""}
      </div>
    </article>`;
  }

  async function renderSharedCollection(id) {
    // Esconde toda a UI normal da coleção; mostra só o container compartilhado.
    ["page-search", "collection-subtitle", "collection-toolbar", "collection-dashboard"].forEach((c) => { const el = document.querySelector("." + c); if (el) el.hidden = true; });
    [elements.tabs, elements.groupsView, elements.cardsView, elements.dashboard, document.getElementById("collectionShareBtn")].forEach((el) => { if (el) el.hidden = true; });
    const sv = document.getElementById("sharedCollection");
    if (!sv) return;
    sv.hidden = false;
    sv.innerHTML = `<p class="empty-state">${escapeHtml(t("collection.shared.loading"))}</p>`;
    const share = await shared.fetchShare(id);
    if (!share || share.kind !== "collection" || !share.data || !Array.isArray(share.data.items)) {
      sv.innerHTML = `<p class="empty-state">${escapeHtml(t("collection.shared.notFound"))}</p>`;
      return;
    }
    const items = share.data.items;
    const total = items.reduce((s, it) => s + fromBRL(it.vbrl || 0) * (it.q || 1), 0);
    sv.innerHTML = `
      <div class="binder-shared-banner">
        <div class="binder-shared-info">
          <strong>${escapeHtml(share.title || t("collection.shared.title"))}</strong>
          <span>${escapeHtml(tn("collection.shared.banner", items.length))} · ${escapeHtml(shared.formatMoney(shared.getCurrency(), total))}</span>
        </div>
        <a class="primary" href="collection.html">${escapeHtml(t("collection.shared.cta"))}</a>
      </div>
      <div class="card-grid">${items.map(sharedTile).join("")}</div>`;
  }
})();
