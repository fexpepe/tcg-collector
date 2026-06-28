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

  // Pastas: organização leve (seções colapsáveis) DENTRO da coleção. GLOBAL
  // cross-game (uma pasta pode misturar Pokémon e Lorcana). Exclusivo: cada carta
  // fica em no máximo 1 pasta; o resto cai em "Sem pasta". Local-only por ora
  // (não sincroniza entre dispositivos). Escreve direto no localStorage — são
  // ações pontuais do usuário, sem necessidade de coalescer.
  const folders = createFolderStore();
  function createFolderStore() {
    const KEY = "tcg-collector-collection-folders-v1";
    let data = { folders: [], assign: {}, order: {} };
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (raw && Array.isArray(raw.folders) && raw.assign && typeof raw.assign === "object") data = raw;
    } catch (e) { /* corrompido: começa vazio */ }
    if (!data.order || typeof data.order !== "object") data.order = {}; // ordem manual por bucket (folderId|"__none__")
    // Carimbo pra sincronização (LWW do bloco todo): toda mudança atualiza o ts.
    const save = () => { data.updatedAt = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* quota: ignora */ } };
    const uid = () => "f_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const byId = (id) => data.folders.find((f) => f.id === id) || null;
    return {
      list: () => data.folders.slice(),
      any: () => data.folders.length > 0,
      get: byId,
      create(name) { const f = { id: uid(), name: name || "", collapsed: false, cover: null, stars: 0 }; data.folders.push(f); save(); return f; },
      rename(id, name) { const f = byId(id); if (f) { f.name = name; save(); } },
      setCover(id, cardId) { const f = byId(id); if (f) { f.cover = cardId || null; save(); } },
      setStars(id, n) { const f = byId(id); if (f) { f.stars = Math.max(0, Math.min(3, n | 0)); save(); } },
      remove(id) {
        data.folders = data.folders.filter((f) => f.id !== id);
        Object.keys(data.assign).forEach((cid) => { if (data.assign[cid] === id) delete data.assign[cid]; });
        delete data.order[id];
        save();
      },
      toggleCollapse(id) { const f = byId(id); if (f) { f.collapsed = !f.collapsed; save(); } },
      move(id, dir) { // -1 sobe, +1 desce
        const i = data.folders.findIndex((f) => f.id === id), j = i + dir;
        if (i < 0 || j < 0 || j >= data.folders.length) return;
        const [f] = data.folders.splice(i, 1); data.folders.splice(j, 0, f); save();
      },
      assign(cardId, folderId) {
        if (folderId && byId(folderId)) data.assign[cardId] = folderId; else delete data.assign[cardId];
        // Tira da ordem manual de qualquer bucket (vai ser anexada no novo).
        Object.keys(data.order).forEach((b) => { data.order[b] = (data.order[b] || []).filter((id) => id !== cardId); });
        save();
      },
      folderOf(cardId) { const id = data.assign[cardId]; return id && byId(id) ? id : null; },
      // Ordem manual por bucket (folderId ou "__none__"): lista de cardIds.
      orderOf(bucket) { return (data.order[bucket] || []).slice(); },
      setOrder(bucket, ids) { data.order[bucket] = ids.slice(); save(); }
    };
  }

  let activeTab = "cards";
  let sortMode = "dex";

  // Aba "Cartas": ordenação + grade/lista (preferências guardadas).
  const CARDS_SORTS = ["value-desc", "value-asc", "num-asc", "num-desc", "release", "added-desc", "added-asc"];
  let cardsSort = CARDS_SORTS.includes(localStorage.getItem("tcg-collection-sort")) ? localStorage.getItem("tcg-collection-sort") : "value-desc";
  let cardsView = localStorage.getItem("tcg-collection-view") === "list" ? "list" : "grid";

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
    folderSections: document.getElementById("folderSections"),
    newFolderBtn: document.getElementById("newFolderBtn"),
    empty: document.getElementById("emptyState"),
    search: document.getElementById("searchInput"),
    pokemonFilter: document.getElementById("pokemonFilter"),
    setFilter: document.getElementById("setFilter"),
    languageFilter: document.getElementById("languageFilter"),
    rarityFilter: document.getElementById("rarityFilter"),
    cardsSortSelect: document.getElementById("cardsSortSelect"),
    cardsViewToggle: document.getElementById("cardsViewToggle"),
    resultCount: document.getElementById("resultCount"),
    dashboard: document.getElementById("collectionDashboard"),
    dashCopies: document.getElementById("dashCopies"),
    dashDistinct: document.getElementById("dashDistinct"),
    dashSets: document.getElementById("dashSets"),
    dashValue: document.getElementById("dashValue"),
    dashTopList: document.getElementById("dashTopList"),
    dashDist: document.getElementById("dashDist"),
    dashRegion: document.getElementById("dashRegion"),
    dashFoldersCard: document.getElementById("dashFoldersCard"),
    dashFolders: document.getElementById("dashFolders"),
    dashCarouselTrack: document.getElementById("dashCarouselTrack"),
    dashCarouselPrev: document.getElementById("dashCarouselPrev"),
    dashCarouselNext: document.getElementById("dashCarouselNext")
  };

  // Atualiza as setas do carrossel da dashboard (definido em initCarousel).
  let updateCarousel = function () {};

  const pager = shared.createPager({ grid: elements.grid, pageSize: 60 });

  const preview = shared.createCardPreview({
    getCard: (cardId) => cardsById.get(cardId),
    store: owned,
    prices,
    wishlist,
    onOwnedChange: () => refreshOwnershipCards(),
    // Seletor de pasta dentro do preview (atribui a carta a uma pasta).
    folders: {
      list: () => folders.list(),
      currentOf: (cardId) => folders.folderOf(cardId),
      onChange: (cardId, folderId) => { folders.assign(cardId, folderId); renderDashboard(); renderCards(); }
    }
  });

  // ?s=<id>: visualização pública (somente leitura) de uma coleção compartilhada.
  // Os dados vêm desnormalizados no share, então não precisa carregar o catálogo.
  const collParams = new URLSearchParams(window.location.search);
  const shareId = collParams.get("s");
  // Perfil público: o handle vem do caminho /users/<handle> (servido aqui via
  // _redirects 200) ou, como fallback, de ?u=<handle> (links diretos).
  const profileHandle = (location.pathname.match(/\/users\/([a-z0-9_]{1,24})/i) || [])[1] || collParams.get("u");

  if (shareId) {
    shared.loadFxRates().then(() => renderSharedCollection(shareId));
  } else if (profileHandle) {
    shared.loadFxRates().then(() => renderPublicProfile(profileHandle));
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
        shared.publishProfile(cards, owned, prices); // publica o perfil público se for o caso
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
    refreshFilters();
    applyCardLangDefault(elements.languageFilter);
  }

  // Reconstrói um <select> de filtro mantendo a 1ª opção ("Todos") e preservando
  // a seleção atual se ela ainda existir no novo conjunto.
  function fillFilter(select, values, formatLabel) {
    if (!select) return;
    const prev = select.value;
    while (select.options.length > 1) select.remove(1); // tira tudo menos "Todos/Todas"
    addOptions(select, values, formatLabel);
    select.value = values.includes(prev) ? prev : "";
  }

  // Os filtros (Pokémon, Set, Idioma, Raridade) seguem o filtro de jogo: só
  // Pokémon, só Lorcana, ou os dois no "Todos". ownedCards() já respeita o
  // gameFilter, então é só reconstruir a partir dele ao trocar de jogo.
  function refreshFilters() {
    const myCards = ownedCards();
    fillFilter(elements.pokemonFilter, unique(myCards.map((card) => card.pokemonName || speciesName(card.name))));
    fillFilter(elements.setFilter, unique(myCards.map((card) => card.set)));
    fillFilter(elements.languageFilter, unique(myCards.map((card) => card.language)), (value) => langOptionLabel(value));
    fillFilter(elements.rarityFilter, unique(myCards.map((card) => card.rarity).filter(Boolean)).sort());
  }

  // Rótulo do filtro de idioma com a bandeirinha (emoji) antes do nome.
  function langOptionLabel(value) {
    const emoji = shared.cardFlagEmoji(value);
    return (emoji ? emoji + " " : "") + shared.cardLanguageLabel(value);
  }

  // O 1º filtro agrupa por espécie (Pokémon) / personagem (Lorcana): o rótulo
  // acompanha o jogo selecionado.
  function updatePokemonFilterLabel() {
    const label = document.querySelector('label[for="pokemonFilter"]');
    if (label) label.textContent = gameFilter === "lorcana" ? t("toolbar.characters") : t("toolbar.pokemon");
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
    if (elements.cardsSortSelect) {
      elements.cardsSortSelect.value = cardsSort;
      elements.cardsSortSelect.addEventListener("change", () => {
        cardsSort = elements.cardsSortSelect.value;
        localStorage.setItem("tcg-collection-sort", cardsSort);
        render({ resetCount: true });
      });
    }
    if (elements.cardsViewToggle) {
      applyCardsView();
      elements.cardsViewToggle.addEventListener("click", (event) => {
        const button = event.target.closest("[data-grid-view]");
        if (!button) return;
        cardsView = button.dataset.gridView === "list" ? "list" : "grid";
        localStorage.setItem("tcg-collection-view", cardsView);
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
      refreshFilters(); // Pokémon/Set/Idioma/Raridade do jogo escolhido (todos no "Todos")
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

    // Cliques nos tiles: vale pra grade plana (#cardGrid) E pras seções de pasta.
    const handleTileClick = (event) => {
      // Modo "trocar capa": clicar numa carta da coleção a define como capa.
      if (coverPickId) {
        const sec = event.target.closest("[data-folder-id]");
        const tile = event.target.closest(".card-tile");
        if (sec && tile && sec.dataset.folderId === coverPickId) {
          folders.setCover(coverPickId, tile.dataset.tileCardId);
          coverPickId = null;
          renderCards();
          return;
        }
      }
      const imageButton = event.target.closest("[data-preview-card-id]");
      if (imageButton) {
        preview.open(imageButton.dataset.previewCardId, imageButton.dataset.previewVariant);
        return;
      }
      if (shared.handleWantTileClick(event, wishlist)) {
        refreshOwnershipCards();
        return;
      }
      // Quick-add: o "+" soma +1 a cada clique e pisca "✓ Adicionada!" por 2s,
      // pra cadastrar várias cópias sem abrir o card (igual ao Explorar). Pra
      // remover, é no preview da carta (clique na imagem).
      const addButton = shared.handleAddTileClick(event, owned, wishlist);
      if (addButton) {
        refreshOwnershipCards();
        renderDashboard();
        shared.flashTileAdded(addButton, owned);
      }
    };
    elements.grid.addEventListener("click", handleTileClick);
    elements.folderSections.addEventListener("click", handleTileClick);

    // --- Pastas: criar / colapsar / renomear / mover / excluir / compartilhar ---
    if (elements.newFolderBtn) elements.newFolderBtn.addEventListener("click", () => {
      const f = folders.create("");
      render();
      const input = elements.folderSections.querySelector(`[data-folder-id="${f.id}"] [data-folder-rename]`);
      if (input) input.focus();
    });

    elements.folderSections.addEventListener("click", (event) => {
      const section = event.target.closest("[data-folder-id]");
      const fid = section && section.dataset.folderId;
      const moveTile = event.target.closest("[data-tile-move]");
      if (moveTile) {
        const tile = moveTile.closest(".card-tile");
        if (tile && section) moveCardInFolder(section, tile.dataset.tileCardId, Number(moveTile.dataset.tileMove));
        return;
      }
      const starBtn = event.target.closest("[data-folder-star]");
      if (starBtn) {
        if (fid) {
          const n = Number(starBtn.dataset.folderStar);
          const cur = (folders.get(fid) || {}).stars || 0;
          folders.setStars(fid, n === cur ? n - 1 : n); // clicar a estrela atual zera (toggle)
          renderCards();
        }
        return;
      }
      if (event.target.closest("[data-folder-cover]")) {
        if (fid) { coverPickId = coverPickId === fid ? null : fid; renderCards(); }
        return;
      }
      if (event.target.closest("[data-folder-collapse]")) { if (fid) { folders.toggleCollapse(fid); coverPickId = null; renderCards(); } return; }
      const moveBtn = event.target.closest("[data-folder-move]");
      if (moveBtn) { if (fid) { folders.move(fid, Number(moveBtn.dataset.folderMove)); renderCards(); } return; }
      if (event.target.closest("[data-folder-delete]")) { if (fid && window.confirm(t("folders.deleteConfirm"))) { folders.remove(fid); render(); } return; }
      if (event.target.closest("[data-folder-share]")) { if (fid) shareFolder(fid, event.target.closest("[data-folder-share]")); return; }
    });

    // Renomear: salva ao sair do campo (blur) ou Enter; atualiza o dashboard.
    elements.folderSections.addEventListener("change", (event) => {
      const input = event.target.closest("[data-folder-rename]");
      if (!input) return;
      const section = input.closest("[data-folder-id]");
      if (section) { folders.rename(section.dataset.folderId, input.value.trim()); renderDashboard(); }
    });
    elements.folderSections.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.closest("[data-folder-rename]")) event.target.blur();
    });

    bindFolderDrag();
    initCarousel();
  }

  // Carrossel das distribuições: setas rolam o track por ~1 card; as setas
  // somem nas pontas (e quando não há overflow, ex.: sem pasta = 2 cards = sem
  // rolagem). updateCarousel é chamado também ao fim de cada renderDashboard.
  function initCarousel() {
    const track = elements.dashCarouselTrack;
    if (!track) return;
    const step = () => { const card = track.querySelector(".dash-card:not([hidden])"); return card ? card.offsetWidth + 14 : 220; };
    // Rola por ~1 card (scrollLeft direto, salto instantâneo). Evita
    // scroll-behavior:smooth/scrollBy({behavior:"smooth"}) de propósito: o
    // headless do preview os ignora (vira no-op) e o salto direto funciona igual
    // em todo lugar.
    const scrollCards = (delta) => {
      track.scrollLeft = Math.max(0, Math.min(track.scrollLeft + delta, track.scrollWidth - track.clientWidth));
      updateCarousel();
    };
    if (elements.dashCarouselNext) elements.dashCarouselNext.addEventListener("click", () => scrollCards(step()));
    if (elements.dashCarouselPrev) elements.dashCarouselPrev.addEventListener("click", () => scrollCards(-step()));
    updateCarousel = function () {
      const maxScroll = track.scrollWidth - track.clientWidth - 2;
      if (elements.dashCarouselPrev) elements.dashCarouselPrev.hidden = track.scrollLeft <= 2;
      if (elements.dashCarouselNext) elements.dashCarouselNext.hidden = maxScroll <= 0 || track.scrollLeft >= maxScroll;
    };
    track.addEventListener("scroll", updateCarousel);
    window.addEventListener("resize", updateCarousel);
    updateCarousel();
  }

  // Aba "Pokémon"/"Personagens" (agrupa por espécie/personagem) segue o filtro de
  // jogo: vira "Personagens" no Lorcana e SOME no "Todos" (misturar espécies de
  // Pokémon com personagens de Lorcana não faz sentido). Se a aba ativa sumir,
  // volta pra "Cartas".
  function syncGameTabs() {
    const tab = elements.tabs.querySelector('[data-tab="pokemon"]');
    if (!tab) return;
    const hide = gameFilter === "all";
    tab.hidden = hide;
    if (!hide) tab.textContent = gameFilter === "lorcana" ? t("toolbar.characters") : t("toolbar.pokemon");
    if (hide && activeTab === "pokemon") {
      activeTab = "cards";
      Array.from(elements.tabs.children).forEach((n) => n.setAttribute("aria-pressed", n.dataset.tab === "cards" ? "true" : "false"));
    }
  }

  function render(options) {
    shared.applyGameAccent(gameFilter); // accent vermelho/roxo/neutro conforme o jogo
    syncGameTabs();
    // "Cartas" (grade plana) e "Pastas" (seções) usam a MESMA toolbar de filtros.
    const isCardsLike = activeTab === "cards" || activeTab === "folders";
    elements.groupsView.hidden = isCardsLike;
    elements.cardsView.hidden = !isCardsLike;

    renderDashboard();
    updatePokemonFilterLabel();
    if (isCardsLike) {
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
    elements.dashDist.innerHTML = distBarsHtml([
      { label: t("filter.gamePokemon"), n: byGame.pokemon || 0, color: "#d9a300" },
      { label: t("filter.gameLorcana"), n: byGame.lorcana || 0, color: "#3f3d96" }
    ]);

    // Distribuição por região/idioma das cartas (com bandeirinha).
    const byRegion = {};
    myCards.forEach((card) => { const r = shared.cardLanguageRegion(card.language); byRegion[r] = (byRegion[r] || 0) + 1; });
    const regions = [
      { region: "english", lang: "en", color: "#2aa3df" },
      { region: "japanese", lang: "ja", color: "#d23b4e" },
      { region: "portuguese", lang: "pt", color: "#1f9d77" },
      { region: "chinese", lang: "zh", color: "#e0992f" }
    ];
    if (elements.dashRegion) {
      // Flag SVG (renderiza em qualquer SO; emoji de bandeira falha no Windows) +
      // nome curto da região.
      elements.dashRegion.innerHTML = distBarsHtml(regions.map((r) => ({
        label: `${shared.cardFlag(r.lang)}<span>${escapeHtml(t("setRegion." + r.region).replace(/\s*\(.*/, ""))}</span>`,
        n: byRegion[r.region] || 0, color: r.color
      })));
    }

    // Distribuição por pasta (só quando há pastas): cartas distintas por pasta +
    // "Sem pasta". Nome da pasta é do usuário → ESCAPAR (distBarsHtml não escapa).
    if (elements.dashFoldersCard && elements.dashFolders) {
      if (folders.any()) {
        const byFolder = {};
        myCards.forEach((card) => { const k = folders.folderOf(card.id) || "__none__"; byFolder[k] = (byFolder[k] || 0) + 1; });
        const palette = ["#d9a300", "#3f3d96", "#2aa3df", "#d23b4e", "#1f9d77", "#e0992f", "#9b59b6", "#16a085"];
        const rows = folders.list().map((f, i) => ({ label: `<span>${escapeHtml(f.name || t("folders.untitled"))}</span>`, n: byFolder[f.id] || 0, color: palette[i % palette.length] }));
        if (byFolder.__none__) rows.push({ label: `<span>${escapeHtml(t("folders.none"))}</span>`, n: byFolder.__none__, color: "#8a93a3" });
        elements.dashFolders.innerHTML = distBarsHtml(rows);
        elements.dashFoldersCard.hidden = false;
      } else {
        elements.dashFoldersCard.hidden = true;
      }
    }

    // Recalcula as setas do carrossel (o card "Por pasta" pode ter entrado/saído).
    updateCarousel();
  }

  // Barras horizontais de distribuição: [{label, n, color}]. `label` pode ter HTML
  // confiável (flag SVG); textos vêm do i18n (sem HTML do usuário). Zeradas saem.
  function distBarsHtml(rows) {
    const shown = rows.filter((r) => r.n > 0);
    if (!shown.length) return `<p class="dash-empty">${escapeHtml(t("dash.empty"))}</p>`;
    const max = Math.max(1, ...shown.map((r) => r.n));
    return shown.map((r) => `<div class="dash-dist-row">
        <span class="dash-dist-label">${r.label}</span>
        <span class="dash-dist-track"><span class="dash-dist-fill" style="width:${Math.round((r.n / max) * 100)}%;background:${r.color}"></span></span>
        <span class="dash-dist-n">${r.n}</span>
      </div>`).join("");
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

  // Mesmo ícone de compartilhar dos tiles (shared.TILE_ICONS.share).
  const SHARE_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>';
  const COVER_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 15l5-4 4 3 3-2 6 5"/><circle cx="9" cy="9" r="1.4"/></svg>';
  // Coleção em "modo trocar capa": clicar numa carta da seção a define como capa.
  let coverPickId = null;

  // variantTile devolve um NÓ do DOM (não string) — usado tanto no pager (flat)
  // quanto via appendChild nas seções de pasta.
  function makeTile({ card, variant }) {
    return shared.variantTile(card, variant, owned, wishlist, prices, { addMode: true });
  }

  function renderCards({ resetCount = false } = {}) {
    const tiles = ownedTilePairs();
    updateCardsStats(tiles.length);
    // "Cartas" = sempre grade plana (sem divisões); "Pastas" = seções por pasta.
    const useFolders = activeTab === "folders";
    elements.grid.hidden = useFolders;
    elements.folderSections.hidden = !useFolders;
    if (elements.newFolderBtn) elements.newFolderBtn.hidden = !useFolders;
    if (!useFolders) {
      elements.folderSections.innerHTML = "";
      pager.render(tiles, makeTile, { resetCount });
      return;
    }
    renderFolderSections(tiles);
  }

  // Agrupa os pares carta×variante por pasta (folderOf por cardId) e renderiza
  // uma seção por pasta (na ordem do usuário) + "Sem pasta" (só se tiver cartas).
  // A estrutura (headers + grades vazias) vai por innerHTML; os tiles (que são
  // NÓS) entram por appendChild em cada grade.
  function renderFolderSections(tiles) {
    const groups = new Map();
    tiles.forEach((pair) => {
      const key = folders.folderOf(pair.card.id) || "__none__";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(pair);
    });
    // Jogos de cada pasta (de TODAS as cartas, ignorando o filtro) = a TAG.
    // Pastas que não contêm o jogo filtrado somem (pokemon → some lorcana-only;
    // vazias mostram sempre, pra você poder enchê-las).
    const folderGames = computeFolderGames();
    const visible = folders.list().filter((f) => {
      if (gameFilter === "all") return true;
      const gs = folderGames.get(f.id);
      return !gs || gs.size === 0 || gs.has(gameFilter);
    });
    const sections = visible.map((f) => ({ folder: f, games: folderGames.get(f.id), pairs: applyFolderOrder(f.id, groups.get(f.id) || []) }));
    const noneTiles = applyFolderOrder("__none__", groups.get("__none__") || []);
    if (noneTiles.length) sections.push({ folder: null, games: null, pairs: noneTiles });
    elements.folderSections.innerHTML = sections.map(({ folder, pairs, games }) => folderSectionHtml(folder, pairs, games)).join("");
    sections.forEach(({ folder, pairs }) => {
      const sel = folder ? `[data-folder-id="${folder.id}"]` : ".folder-none";
      const grid = elements.folderSections.querySelector(`${sel} .card-grid`);
      if (!grid) return;
      pairs.forEach((pair) => {
        const node = makeTile(pair);
        node.draggable = true;
        // Setas ‹ › sobre a imagem (bordas, centralizadas; só no hover no desktop).
        (node.querySelector(".card-image") || node).appendChild(reorderControl());
        grid.appendChild(node);
      });
    });
  }

  // Controle ‹ › por carta pra reordenar no TOUCH (o arraste é só desktop). Move
  // a carta uma posição pra trás/frente dentro da pasta. Nas pontas, no-op.
  function reorderControl() {
    const c = document.createElement("div");
    c.className = "tile-reorder";
    c.innerHTML = `<button type="button" class="tile-reorder-btn" data-tile-move="-1" aria-label="${escapeAttribute(t("folders.moveBack"))}" title="${escapeAttribute(t("folders.moveBack"))}">‹</button>`
      + `<button type="button" class="tile-reorder-btn" data-tile-move="1" aria-label="${escapeAttribute(t("folders.moveFwd"))}" title="${escapeAttribute(t("folders.moveFwd"))}">›</button>`;
    return c;
  }

  function moveCardInFolder(section, cardId, dir) {
    const ids = sectionCardIds(section);
    const i = ids.indexOf(cardId), j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
    folders.setOrder(section.dataset.folderId || "__none__", ids);
    render();
  }

  // Jogos de cada pasta (de TODAS as cartas que você tem, sem o filtro de jogo):
  // folderId -> Set<game>. Define a tag (1 jogo = aquele jogo; 2 = misto).
  function computeFolderGames() {
    const map = new Map();
    cards.forEach((card) => {
      if (!owned.has(card.id)) return;
      const fid = folders.folderOf(card.id);
      if (!fid) return;
      if (!map.has(fid)) map.set(fid, new Set());
      map.get(fid).add(card.game);
    });
    return map;
  }

  // Chip da tag da pasta: Pokémon / Lorcana / Misto (vazia = sem chip). Cor no
  // pontinho (gold/indigo/cinza). Nome é texto fixo do i18n.
  function folderTagHtml(games) {
    if (!games || games.size === 0) return "";
    let label, color;
    if (games.size > 1) { label = t("folders.tag.mixed"); color = "#8a93a3"; }
    else if (games.has("lorcana")) { label = t("filter.gameLorcana"); color = "#3f3d96"; }
    else { label = t("filter.gamePokemon"); color = "#d9a300"; }
    return `<span class="folder-tag" style="--tag:${color}">${escapeHtml(label)}</span>`;
  }

  // Reordena os pares de um bucket pela ordem manual (se houver). Cards fora da
  // ordem vão pro fim, preservando a ordenação do seletor (cardsSort). Estável.
  function applyFolderOrder(bucket, pairs) {
    const ord = folders.orderOf(bucket);
    if (!ord.length) return pairs;
    const idx = new Map(ord.map((id, i) => [id, i]));
    const rank = (id) => (idx.has(id) ? idx.get(id) : ord.length + 1);
    return pairs.map((p, i) => [p, i])
      .sort((a, b) => (rank(a[0].card.id) - rank(b[0].card.id)) || (a[1] - b[1]))
      .map((x) => x[0]);
  }

  // cardIds únicos de uma seção, na ordem visual atual (multi-variante dedupado).
  function sectionCardIds(section) {
    const seen = new Set(); const ids = [];
    section.querySelectorAll(".card-tile").forEach((tile) => {
      const id = tile.dataset.tileCardId;
      if (id && !seen.has(id)) { seen.add(id); ids.push(id); }
    });
    return ids;
  }

  function folderValue(pairs) {
    let total = 0;
    pairs.forEach((p) => {
      const v = shared.cardValue(p.card, p.variant, prices, shared.DEFAULT_CONDITION).value || 0;
      total += v * owned.variantTotal(p.card.id, p.variant);
    });
    return total;
  }

  // Carta da CAPA da coleção: a escolhida (folder.cover) se ainda existir na pasta;
  // senão a mais valiosa (capa automática). null se a pasta está vazia.
  function folderCoverCard(folder, pairs) {
    if (folder.cover) { const p = pairs.find((x) => x.card.id === folder.cover); if (p) return p.card; }
    let best = null, bestV = -1;
    pairs.forEach((p) => {
      const v = shared.cardValue(p.card, p.variant, prices, shared.DEFAULT_CONDITION).value || 0;
      if (v > bestV) { bestV = v; best = p.card; }
    });
    return best;
  }

  // Estrelas de preferência (0–3), clicáveis. data-stars no container, data-star no botão.
  function starsHtml(n) {
    let h = "";
    for (let i = 1; i <= 3; i++) h += `<button type="button" class="coll-star${i <= n ? " on" : ""}" data-folder-star="${i}" aria-label="${i}">★</button>`;
    return `<span class="coll-stars" data-folder-stars title="${escapeAttribute(t("folders.starsHint"))}">${h}</span>`;
  }

  function folderSectionHtml(folder, pairs, games) {
    const isNone = !folder;
    const collapsed = !isNone && folder.collapsed;
    const value = folderValue(pairs);
    const meta = `${pairs.length}${value > 0 ? " · " + shared.formatMoney(shared.getCurrency(), value) : ""}`;
    const listCls = cardsView === "list" ? " is-list" : "";

    // MINIMIZADA → card de coleção (vitrine): capa + nome + meta + estrelas.
    if (collapsed) {
      const cover = folderCoverCard(folder, pairs);
      const coverImg = cover
        ? shared.localizedImg(shared.cardImageSources(cover).url, { alt: "", fallback: shared.cardImageSources(cover).fallback, loading: "lazy", thumb: true })
        : `<span class="coll-card-empty">${escapeHtml(t("folders.empty"))}</span>`;
      return `<section class="folder-section is-collapsed coll-card" data-folder-id="${escapeAttribute(folder.id)}">
        <button type="button" class="coll-card-cover" data-folder-collapse aria-label="${escapeAttribute(t("folders.toggle"))}">${coverImg}</button>
        <div class="coll-card-body">
          <strong class="coll-card-name">${escapeHtml(folder.name || t("folders.untitled"))}</strong>
          <div class="coll-card-meta-row">
            <span class="coll-card-meta">${escapeHtml(meta)}</span>
            ${folderTagHtml(games)}
          </div>
          <div class="coll-card-foot">
            ${starsHtml(folder.stars || 0)}
            <span class="coll-card-acts">
              <button type="button" class="folder-act" data-folder-move="-1" title="${escapeAttribute(t("folders.moveUp"))}" aria-label="${escapeAttribute(t("folders.moveUp"))}">↑</button>
              <button type="button" class="folder-act" data-folder-move="1" title="${escapeAttribute(t("folders.moveDown"))}" aria-label="${escapeAttribute(t("folders.moveDown"))}">↓</button>
              <button type="button" class="folder-act folder-share-btn" data-folder-share title="${escapeAttribute(t("folders.share"))}" aria-label="${escapeAttribute(t("folders.share"))}">${SHARE_ICON}</button>
              <button type="button" class="folder-act folder-act-danger" data-folder-delete title="${escapeAttribute(t("folders.delete"))}" aria-label="${escapeAttribute(t("folders.delete"))}">✕</button>
            </span>
          </div>
        </div>
      </section>`;
    }

    // ABERTA → como antes (cabeçalho + grade), agora com estrelas + "trocar capa".
    const tilesHtml = pairs.length ? "" : `<p class="folder-empty">${escapeHtml(t("folders.empty"))}</p>`;
    const nameHtml = isNone
      ? `<span class="folder-name">${escapeHtml(t("folders.none"))}</span>`
      : `<input class="folder-name-input" data-folder-rename type="text" maxlength="24" value="${escapeAttribute(folder.name)}" placeholder="${escapeAttribute(t("folders.untitled"))}" aria-label="${escapeAttribute(t("folders.rename"))}">`;
    const actions = isNone ? "" : `<span class="folder-actions">
        ${starsHtml(folder.stars || 0)}
        ${pairs.length ? `<button type="button" class="folder-act" data-folder-cover title="${escapeAttribute(t("folders.cover"))}" aria-label="${escapeAttribute(t("folders.cover"))}">${COVER_ICON}<span>${escapeHtml(t("folders.cover"))}</span></button>` : ""}
        <button type="button" class="folder-act folder-share-btn" data-folder-share title="${escapeAttribute(t("folders.share"))}" aria-label="${escapeAttribute(t("folders.share"))}">${SHARE_ICON}<span>${escapeHtml(t("folders.shareBtn"))}</span></button>
        <button type="button" class="folder-act folder-act-danger" data-folder-delete title="${escapeAttribute(t("folders.delete"))}" aria-label="${escapeAttribute(t("folders.delete"))}">✕</button>
      </span>`;
    const pickHint = (!isNone && coverPickId === folder.id) ? `<p class="coll-cover-hint">${escapeHtml(t("folders.coverPick"))}</p>` : "";
    return `<section class="folder-section${isNone ? " folder-none" : ""}${(!isNone && coverPickId === folder.id) ? " is-cover-pick" : ""}" data-folder-id="${escapeAttribute(isNone ? "" : folder.id)}">
      <header class="folder-head">
        <button type="button" class="folder-collapse" data-folder-collapse aria-expanded="true" aria-label="${escapeAttribute(t("folders.toggle"))}">▾</button>
        ${nameHtml}
        ${isNone ? "" : folderTagHtml(games)}
        <span class="folder-meta">${escapeHtml(meta)}</span>
        ${actions}
      </header>
      ${pickHint}
      <div class="card-grid${listCls}">${tilesHtml}</div>
    </section>`;
  }

  // Arrastar uma carta (desktop, HTML5 DnD):
  //  - soltar numa seção DIFERENTE → muda de pasta (reatribui);
  //  - soltar dentro da MESMA seção, em cima de outra carta → REORDENA (ordem
  //    manual da pasta; metade direita do alvo = solta depois dele).
  // Touch usa o seletor de pasta no preview (reordenar é desktop).
  function bindFolderDrag() {
    const sections = elements.folderSections;
    let draggingId = null;
    sections.addEventListener("dragstart", (event) => {
      const tile = event.target.closest(".card-tile");
      if (!tile) return;
      draggingId = tile.dataset.tileCardId;
      event.dataTransfer.effectAllowed = "move";
      try { event.dataTransfer.setData("text/plain", draggingId); } catch (e) { /* alguns browsers exigem o try */ }
      sections.classList.add("folder-dragging");
    });
    sections.addEventListener("dragend", () => {
      draggingId = null;
      sections.classList.remove("folder-dragging");
      sections.querySelectorAll(".folder-section.dragover").forEach((s) => s.classList.remove("dragover"));
    });
    sections.addEventListener("dragover", (event) => {
      const section = event.target.closest(".folder-section");
      if (!section || draggingId == null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      sections.querySelectorAll(".folder-section.dragover").forEach((s) => { if (s !== section) s.classList.remove("dragover"); });
      section.classList.add("dragover");
    });
    sections.addEventListener("drop", (event) => {
      const section = event.target.closest(".folder-section");
      const cardId = draggingId || (event.dataTransfer && event.dataTransfer.getData("text/plain"));
      if (!section || !cardId) return;
      event.preventDefault();
      const targetBucket = section.dataset.folderId || "__none__";
      const sourceBucket = folders.folderOf(cardId) || "__none__";
      if (targetBucket === sourceBucket) {
        // Mesma pasta → reordenar. Posição = antes do tile-alvo (ou depois, se
        // soltar na metade direita); fora de um tile = vai pro fim.
        const targetTile = event.target.closest(".card-tile");
        if (!targetTile || targetTile.dataset.tileCardId !== cardId) {
          const ids = sectionCardIds(section);
          let beforeId = targetTile ? targetTile.dataset.tileCardId : null;
          if (beforeId) {
            const rect = targetTile.getBoundingClientRect();
            if (event.clientX > rect.left + rect.width / 2) beforeId = ids[ids.indexOf(beforeId) + 1] || null;
          }
          const arr = ids.filter((id) => id !== cardId);
          const at = beforeId ? arr.indexOf(beforeId) : arr.length;
          arr.splice(at < 0 ? arr.length : at, 0, cardId);
          folders.setOrder(targetBucket, arr);
          render();
        }
      } else {
        // Pasta diferente → reatribui ("" = Sem pasta → remove da pasta).
        folders.assign(cardId, section.dataset.folderId || null);
        render();
      }
      draggingId = null;
    });
  }

  function ownedTilePairs() {
    const pairs = shared.cardVariantPairs(filterCards())
      .filter(({ card, variant }) => owned.variantTotal(card.id, variant) > 0);
    return sortTiles(pairs);
  }

  // Ordena os pares carta×variante conforme o seletor (mesma lógica do detalhe).
  function sortTiles(pairs) {
    const priceOf = (p) => shared.cardValue(p.card, p.variant, prices, shared.DEFAULT_CONDITION).value || 0;
    const byNum = (a, b) => shared.compareCardNumbers(a.card.number, b.card.number);
    if (cardsSort === "num-asc") pairs.sort(byNum);
    else if (cardsSort === "num-desc") pairs.sort((a, b) => byNum(b, a));
    else if (cardsSort === "value-desc") pairs.sort((a, b) => priceOf(b) - priceOf(a));
    else if (cardsSort === "value-asc") pairs.sort((a, b) => {
      const pa = priceOf(a), pb = priceOf(b);
      if (!pa && !pb) return 0; if (!pa) return 1; if (!pb) return -1; return pa - pb;
    });
    else if (cardsSort === "added-asc" || cardsSort === "added-desc") {
      // Ordem de adição na coleção = ordem de inserção das chaves no objeto
      // (preservada em JS/JSON). asc = primeira→última; desc = última→primeira.
      const order = Object.keys(owned.toObject());
      const rankOf = new Map(order.map((id, i) => [id, i]));
      const rank = (p) => { const r = rankOf.get(p.card.id); return r == null ? Infinity : r; };
      pairs.sort((a, b) => cardsSort === "added-asc" ? rank(a) - rank(b) : rank(b) - rank(a));
    }
    else pairs.sort((a, b) => String(b.card.setReleaseDate || "").localeCompare(String(a.card.setReleaseDate || "")));
    return pairs;
  }

  // Alterna grade/lista (mesma classe .is-list do detalhe) e reflete nos botões.
  function applyCardsView() {
    if (elements.grid) elements.grid.classList.toggle("is-list", cardsView === "list");
    // Em modo pastas, cada seção tem sua própria grade.
    if (elements.folderSections) elements.folderSections.querySelectorAll(".card-grid").forEach((g) => g.classList.toggle("is-list", cardsView === "list"));
    if (elements.cardsViewToggle) {
      elements.cardsViewToggle.querySelectorAll("[data-grid-view]").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.gridView === cardsView));
      });
    }
  }

  // Atualiza tiles e contadores no DOM existente, sem reconstruir a grade
  // (reconstruir faria todas as imagens piscarem). Tiles zerados saem da vista.
  function refreshOwnershipCards() {
    if (activeTab !== "cards") {
      render();
      return;
    }
    // Atualiza in-place os tiles visíveis (grade plana OU seções de pasta), sem
    // reconstruir — preserva o flash do quick-add e não pisca as imagens.
    elements.cardsView.querySelectorAll(".card-tile").forEach((tile) => {
      const quantity = owned.variantTotal(tile.dataset.tileCardId, tile.dataset.tileVariant);
      if (quantity > 0) {
        shared.refreshTileOwnership(tile, owned, wishlist, { addMode: true });
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
  // `accept(card)` opcional: filtra as cartas (ex.: só as de uma pasta). Sem ele,
  // monta a coleção inteira (respeitando o filtro de jogo, como sempre).
  function buildShareData(accept) {
    const items = [];
    const src0 = accept ? ownedCards().filter(accept) : ownedCards();
    shared.cardVariantPairs(src0).forEach(({ card, variant }) => {
      const qty = owned.variantTotal(card.id, variant);
      if (qty <= 0) return;
      const src = shared.cardImageSources(card);
      const unit = shared.cardValue(card, variant, prices).value || 0;
      const vbrl = shared.convertMoney(unit, shared.getCurrency(), "BRL");
      items.push({
        id: card.id, n: card.name, s: card.set, num: card.number, lang: card.language,
        g: card.game, v: variant, q: qty, vbrl: vbrl == null ? 0 : Math.round(vbrl * 100) / 100,
        img: src.url, fb: src.fallback || ""
      });
    });
    items.sort((a, b) => (b.vbrl * b.q) - (a.vbrl * a.q));
    return { items };
  }

  // Compartilha SÓ as cartas de uma pasta (nome da pasta vira o título do share).
  // Reaproveita o mesmo fluxo do botão da coleção inteira (createShare + copiar).
  async function shareFolder(folderId, btn) {
    const folder = folders.get(folderId);
    if (!folder) return;
    const data = buildShareData((card) => folders.folderOf(card.id) === folderId);
    if (!data.items.length) { alert(t("folders.shareEmpty")); return; }
    data.scope = "folder"; // marca como pasta (a view ?s= mostra rótulo + "salvar")
    if (btn) btn.disabled = true;
    const res = await shared.createShare("collection", folder.name || t("folders.untitled"), data);
    if (btn) btn.disabled = false;
    if (res && res.id) {
      const link = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}collection.html?s=${res.id}`;
      try { await navigator.clipboard.writeText(link); alert(t("collection.share.copied")); }
      catch (e) { window.prompt(t("collection.share.copyManual"), link); }
    } else {
      alert(res && res.error === "auth" ? t("collection.share.needLogin") : t("collection.share.error"));
    }
  }

  function bindShareButton() {
    const btn = document.getElementById("collectionShareBtn");
    if (!btn) return;
    btn.hidden = ownedCards().length === 0;
    btn.addEventListener("click", async () => {
      const original = t("collection.share");
      // Perfil público: compartilha o link VIVO (sempre atualizado) em vez de um
      // snapshot. Sem perfil público, cai no snapshot de sempre.
      const live = shared.publicProfileUrl();
      if (live) {
        try { await navigator.clipboard.writeText(live); btn.textContent = t("collection.share.copiedLive"); }
        catch (e) { window.prompt(t("collection.share.copyManual"), live); }
        setTimeout(() => { btn.textContent = original; }, 2500);
        return;
      }
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
    const flag = shared.cardFlag(it.lang);
    // Venda: mostra o PREÇO DE VENDA (sp) na moeda do vendedor. Senão, valor de mercado.
    let priceHtml = "";
    if (it.sp != null && it.sp > 0) {
      priceHtml = `<p class="tile-price sale-price-tag">${escapeHtml(shared.formatMoney(it.cur || "BRL", it.sp))}</p>`;
    } else {
      const val = fromBRL(it.vbrl || 0);
      if (val > 0) priceHtml = `<p class="tile-price">${escapeHtml(shared.formatMoney(shared.getCurrency(), val))}</p>`;
    }
    return `<article class="card-tile shared-tile">
      <div class="card-image"><button type="button" class="image-open" data-preview-card-id="${escapeAttribute(it.id)}" data-preview-variant="${escapeAttribute(it.v)}" aria-label="${escapeAttribute(t("card.zoom", { name: it.n }))}">${img}</button></div>
      <div class="tile-info">
        <h3>${escapeHtml(it.n)}</h3>
        <p class="tile-set"><span>${escapeHtml(it.s)} · ${escapeHtml(it.num)}</span></p>
        <p class="tile-variant">${flag}<span>${escapeHtml(it.v)}${it.q > 1 ? ` ×${it.q}` : ""}</span>${it.sp > 0 && it.cond ? `<span class="cond-badge">${escapeHtml(it.cond)}</span>` : ""}</p>
        ${priceHtml}
      </div>
    </article>`;
  }

  // Prepara o container de leitura (esconde a UI normal da coleção).
  function prepareSharedView() {
    ["page-search", "collection-subtitle", "collection-toolbar", "collection-dashboard"].forEach((c) => { const el = document.querySelector("." + c); if (el) el.hidden = true; });
    [elements.tabs, elements.groupsView, elements.cardsView, elements.dashboard, document.getElementById("collectionShareBtn")].forEach((el) => { if (el) el.hidden = true; });
    const sv = document.getElementById("sharedCollection");
    if (sv) { sv.hidden = false; sv.innerHTML = `<p class="empty-state">${escapeHtml(t("collection.shared.loading"))}</p>`; }
    return sv;
  }

  // `id` pode ser o id do share (?s=) OU um objeto share já montado (perfil
  // público). `profileNav` injeta o cabeçalho @handle + o link Coleção↔Vendas.
  async function renderSharedCollection(id, profileNav) {
    const sv = prepareSharedView();
    if (!sv) return;
    const share = typeof id === "string" ? await shared.fetchShare(id) : id;
    if (!share || share.kind !== "collection" || !share.data || !Array.isArray(share.data.items)) {
      sv.innerHTML = `<p class="empty-state">${escapeHtml(t("collection.shared.notFound"))}</p>`;
      return;
    }
    const allItems = share.data.items;
    const isFolder = share.data.scope === "folder"; // compartilhamento de UMA pasta
    const isSale = share.data.scope === "sale";      // lista de vendas
    const saleCur = share.data.cur || "BRL";
    // Total: venda soma os preços de venda (sp) na moeda do vendedor; senão valor de mercado.
    const bannerTotal = isSale
      ? allItems.reduce((s, it) => s + (Number(it.sp) || 0) * (it.q || 1), 0)
      : allItems.reduce((s, it) => s + fromBRL(it.vbrl || 0) * (it.q || 1), 0);
    const bannerMoney = isSale ? shared.formatMoney(saleCur, bannerTotal) : shared.formatMoney(shared.getCurrency(), bannerTotal);
    const kindLabel = isSale ? t("sales.shared.label") : (isFolder ? t("folders.shared.label") : "");

    // Filtro de jogo (Todos/Pokémon/Lorcana) — igual à página da coleção. Só
    // aparece quando o share tem MAIS DE UM jogo, pra quem está vendo conseguir
    // separar as coleções. O dashboard e a grade reagem ao filtro.
    const gamesPresent = [...new Set(allItems.map((it) => it.g).filter(Boolean))];
    let sharedFilter = "all";
    const filterHtml = gamesPresent.length > 1
      ? `<div class="collection-toolbar"><div id="sharedGameFilter" class="chip-filter game-filter" role="group" aria-label="Jogo">
          <button type="button" class="chip" data-game-filter="all" aria-pressed="true">${escapeHtml(t("filter.gameAll"))}</button>
          <button type="button" class="chip" data-game-filter="pokemon" aria-pressed="false">${escapeHtml(t("filter.gamePokemon"))}</button>
          <button type="button" class="chip" data-game-filter="lorcana" aria-pressed="false">${escapeHtml(t("filter.gameLorcana"))}</button>
        </div></div>`
      : "";

    // Perfil (aba Coleção): SEM banner — o cabeçalho (nome/@/botão Vendas) vai pro
    // card de stats. Demais casos (vendas do perfil, pasta, share normal) usam banner.
    const banner = (profileNav && profileNav.identityInDash) ? "" : `
      <div class="binder-shared-banner">
        <div class="binder-shared-info">
          ${kindLabel ? `<span class="shared-kind">${escapeHtml(kindLabel)}</span>` : ""}
          ${profileNav ? `<span class="shared-kind">@${escapeHtml(profileNav.handle)}</span>` : ""}
          ${profileNav ? "" : `<strong>${escapeHtml(share.title || t("collection.shared.title"))}</strong>`}
          <span>${escapeHtml(tn("collection.shared.banner", allItems.length))} · ${escapeHtml(bannerMoney)}</span>
        </div>
        ${profileNav && profileNav.label
          ? `<button type="button" class="secondary" data-profile-nav>${escapeHtml(profileNav.label)}</button>`
          : (isFolder ? `<button type="button" class="primary" id="sharedSaveBtn">${escapeHtml(t("folders.shared.save"))}</button>` : "")}
      </div>`;
    sv.innerHTML = `${banner}${filterHtml}<div id="sharedBody"></div>`;

    // "Salvar na minha coleção": importa a pasta — cria uma pasta com o mesmo
    // nome, marca as cartas como suas e atribui a ela. Local (sem login).
    if (isFolder) {
      const saveBtn = document.getElementById("sharedSaveBtn");
      if (saveBtn) saveBtn.addEventListener("click", () => {
        const name = share.title || t("folders.untitled");
        if (!window.confirm(t("folders.shared.saveConfirm", { n: allItems.length, name }))) return;
        const f = folders.create(name);
        allItems.forEach((it) => {
          const store = ownedByGame[it.g] || ownedByGame.pokemon;
          if (store) store.add(it.id, it.v, shared.DEFAULT_CONDITION, it.q || 1);
          folders.assign(it.id, f.id);
        });
        alert(t("folders.shared.saved"));
        window.location.href = "collection.html"; // abre a coleção da pessoa
      });
    }

    // (Re)desenha dashboard + grade conforme o filtro de jogo ativo. Venda não
    // tem dashboard (é só a lista de cartas + preços).
    function paintShared() {
      const items = sharedFilter === "all" ? allItems : allItems.filter((it) => (it.g || "pokemon") === sharedFilter);
      const total = items.reduce((s, it) => s + fromBRL(it.vbrl || 0) * (it.q || 1), 0);
      const dash = isSale ? "" : sharedDashboardHtml(items, total, profileNav);
      document.getElementById("sharedBody").innerHTML =
        `${dash}<div class="card-grid">${items.map(sharedTile).join("")}</div>`;
    }
    paintShared();

    const filterEl = document.getElementById("sharedGameFilter");
    if (filterEl) filterEl.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-game-filter]");
      if (!chip || chip.dataset.gameFilter === sharedFilter) return;
      sharedFilter = chip.dataset.gameFilter;
      Array.from(filterEl.children).forEach((node) => node.setAttribute("aria-pressed", node === chip ? "true" : "false"));
      paintShared();
    });

    // Clicar na carta abre o preview (mesmo modal da coleção). O share é
    // desnormalizado, então carregamos as cartas DESSE share (por id, por jogo)
    // pra o preview ter o detalhe completo (raridade, artista, mercado…). Os
    // controles de posse/desejo agem na coleção de QUEM está vendo. (Delegado em
    // sv, então segue funcionando após o paintShared recriar a grade.)
    // Delegação ligada UMA vez no container (sobrevive aos re-renders do corpo).
    if (!sv.dataset.previewBound) {
      sv.dataset.previewBound = "1";
      sv.addEventListener("click", (event) => {
        const nav = event.target.closest("[data-profile-nav]");
        if (nav && sv._profileNav) { sv._profileNav(); return; }
        const btn = event.target.closest("[data-preview-card-id]");
        if (btn) preview.open(btn.dataset.previewCardId, btn.dataset.previewVariant);
      });
    }
    sv._profileNav = profileNav && profileNav.onNav ? profileNav.onNav : null;
    const idsByGame = {};
    allItems.forEach((it) => { const g = it.g || "pokemon"; (idsByGame[g] = idsByGame[g] || []).push(it.id); });
    try {
      const catalog = await shared.loadOwnedAcrossGames(idsByGame);
      (catalog.cards || []).forEach((card) => { cardsById.set(card.id, card); cardGameMap.set(card.id, card.game); });
    } catch (e) { /* sem catálogo: tiles seguem, só o preview não abre */ }
  }

  // Perfil público (/users/<handle> → ?u=). Lê o payload curado e mostra a
  // Coleção, com um link pra alternar pra Vendas e Trocas (e voltar). Reusa toda
  // a renderização de leitura (renderSharedCollection) com um cabeçalho @handle.
  async function renderPublicProfile(handle) {
    const sv = prepareSharedView();
    if (!sv) return;
    const prof = await shared.fetchPublicProfile(handle);
    if (!prof || !prof.data) {
      sv.innerHTML = `<p class="empty-state">${escapeHtml(t("profile.notFound"))}</p>`;
      return;
    }
    const name = prof.display_name || ("@" + prof.handle);
    document.title = name + " · Sleevu";
    const col = (prof.data.collection && Array.isArray(prof.data.collection.items)) ? prof.data.collection : { items: [] };
    const sale = (prof.data.sales && Array.isArray(prof.data.sales.items)) ? prof.data.sales : { items: [], cur: "BRL" };
    const hasSales = sale.items.length > 0;
    // ?t=sales abre direto na aba Vendas (link vivo de "compartilhar vendas").
    let mode = (hasSales && collParams.get("t") === "sales") ? "sale" : "collection";
    function show() {
      if (mode === "sale") {
        const share = { kind: "collection", title: name, data: { items: sale.items, scope: "sale", cur: sale.cur || "BRL" } };
        renderSharedCollection(share, { handle: prof.handle, name, label: t("profile.viewCollection"), onNav: () => { mode = "collection"; show(); } });
      } else {
        const share = { kind: "collection", title: name, data: { items: col.items } };
        // identityInDash: o nome+@ vão no card de stats (não no banner), evitando repetir.
        renderSharedCollection(share, { handle: prof.handle, name, identityInDash: true, label: hasSales ? t("profile.viewSales") : "", onNav: hasSales ? () => { mode = "sale"; show(); } : null });
      }
    }
    show();
  }

  // Mesmo dashboard da coleção, porém a partir dos itens desnormalizados do share
  // (sem catálogo). Distribuição por jogo só aparece se o share trouxe `g`
  // (shares antigos não têm — degrada sem quebrar).
  function sharedDashboardHtml(items, total, profileNav) {
    const copies = items.reduce((s, it) => s + (it.q || 1), 0);
    const distinct = new Set(items.map((it) => it.id)).size;
    const sets = new Set(items.map((it) => it.s)).size;

    const top = items.slice()
      .map((it) => ({ it, unit: fromBRL(it.vbrl || 0) }))
      .filter((x) => x.unit > 0)
      .sort((a, b) => b.unit - a.unit)
      .slice(0, 3)
      .map(({ it, unit }) => {
        const thumb = shared.localizedImg(it.img, { alt: "", fallback: it.fb, loading: "lazy", thumb: true });
        return `<li><div class="dash-top-row"><span class="dash-top-thumb">${thumb}</span>
          <span class="dash-top-info"><strong>${escapeHtml(it.n)}</strong><span class="dash-top-set">${escapeHtml(it.s)}</span></span>
          <span class="dash-top-val">${escapeHtml(shared.formatMoney(shared.getCurrency(), unit))}</span></div></li>`;
      }).join("");

    const seen = new Set();
    const byGame = {};
    items.forEach((it) => { if (it.g && !seen.has(it.id)) { seen.add(it.id); byGame[it.g] = (byGame[it.g] || 0) + 1; } });
    const distOrder = [
      { game: "pokemon", label: t("filter.gamePokemon"), color: "#d9a300" },
      { game: "lorcana", label: t("filter.gameLorcana"), color: "#3f3d96" }
    ].filter((g) => byGame[g.game]);
    const max = Math.max(1, ...distOrder.map((g) => byGame[g.game]));
    const distHtml = distOrder.length
      ? distOrder.map((g) => `<div class="dash-dist-row">
          <span class="dash-dist-label">${escapeHtml(g.label)}</span>
          <span class="dash-dist-track"><span class="dash-dist-fill" style="width:${Math.round((byGame[g.game] / max) * 100)}%;background:${g.color}"></span></span>
          <span class="dash-dist-n">${byGame[g.game]}</span>
        </div>`).join("")
      : "";

    const profHead = (profileNav && profileNav.name)
      ? `<div class="dash-profile">
          <div class="dash-profile-id">
            <strong class="dash-profile-name">${escapeHtml(profileNav.name)}</strong>
            <span class="dash-profile-handle">@${escapeHtml(profileNav.handle)}</span>
          </div>
          ${profileNav.label ? `<button type="button" class="secondary dash-profile-nav" data-profile-nav>${escapeHtml(profileNav.label)}</button>` : ""}
        </div>`
      : "";
    return `<section class="collection-dashboard">
      <article class="dash-card dash-stats">
        ${profHead}
        <div class="dash-stats-counts">
          <div><span class="dash-stat-val">${copies}</span><span class="dash-stat-label">${escapeHtml(t("stats.copies"))}</span></div>
          <div><span class="dash-stat-val">${distinct}</span><span class="dash-stat-label">${escapeHtml(t("stats.distinct"))}</span></div>
          <div><span class="dash-stat-val">${sets}</span><span class="dash-stat-label">${escapeHtml(t("stats.setsCovered"))}</span></div>
        </div>
        <div class="dash-stat-money"><span class="dash-stat-val">${escapeHtml(total > 0 ? shared.formatMoney(shared.getCurrency(), total) : "—")}</span><span class="dash-stat-label">${escapeHtml(t("dash.value"))}</span></div>
      </article>
      <article class="dash-card dash-top">
        <h3>${escapeHtml(t("dash.topTitle"))}</h3>
        <ol class="dash-top-list">${top || `<li class="dash-empty">—</li>`}</ol>
      </article>
      ${distHtml ? `<article class="dash-card dash-dist"><h3>${escapeHtml(t("dash.distTitle"))}</h3><div class="dash-dist-bars">${distHtml}</div></article>` : ""}
    </section>`;
  }
})();
