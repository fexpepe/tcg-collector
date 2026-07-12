(function () {
  const shared = window.TCGShared;
  const { addOptions, unique, normalize, speciesName, debounce, t, tn } = shared;

  let cards = [];
  let cardsById = new Map();
  let gameFilter = "all"; // all | pokemon | lorcana

  // Ordenação + grade/lista (paridade com a Coleção), persistidas em chaves
  // próprias da wishlist.
  const CARDS_SORTS = ["value-desc", "value-asc", "num-asc", "num-desc", "rarity-desc", "rarity-asc", "release"];
  let cardsSort = CARDS_SORTS.includes(localStorage.getItem("tcg-wishlist-sort")) ? localStorage.getItem("tcg-wishlist-sort") : "value-desc";
  let cardsView = localStorage.getItem("tcg-wishlist-view") === "list" ? "list" : "grid";

  // Wishlist UNIFICADA: stores por jogo + facades que despacham por jogo (cardGameMap).
  const ownedByGame = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, shared.createCollectionStore(g)]));
  const wishlistByGame = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, shared.createWishlistStore(g)]));
  const pricesByGame = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, shared.createPriceStore(g)]));
  const cardGameMap = new Map();
  const gameOf = (id) => cardGameMap.get(id) || "pokemon";
  const owned = shared.mergedCollectionStore(ownedByGame, gameOf);
  const wishlist = shared.mergedWishlistStore(wishlistByGame, gameOf);
  const prices = shared.mergedPriceStore(pricesByGame, gameOf);
  // Preço-alvo por carta ("me avisa quando chegar a R$X") — global, sincronizado.
  const targets = shared.createWishTargetsStore();

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
  // Skeletons enquanto os chunks baixam (se já há cartas conhecidas).
  if (elements.grid && shared.GAME_SLUGS.some((g) => idsFor(g).length)) {
    shared.showSkeletons(elements.grid, "card", 8);
  }
  Promise.all([
    shared.loadOwnedAcrossGames(Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, idsFor(g)]))),
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
      renderDropNotice(); // quedas de preço da semana (histórico do build; async)
      renderTargetNotice(); // cartas que atingiram o preço-alvo do usuário
      renderSellers();    // trade matching: quem tem suas desejadas à venda (async)
    })
    .catch((error) => {
      elements.empty.textContent = t("error.catalog", { message: error.message });
      elements.empty.hidden = false;
    });

  // Trade matching: cruza a wishlist com as LISTAS DE VENDA dos perfis públicos
  // (RPC find_sellers, que varre public_profiles — dados já públicos). Agrupa por
  // vendedor e linka a aba de vendas do perfil. O próprio usuário fica de fora.
  async function renderSellers() {
    const el = document.getElementById("wishSellers");
    if (!el || !shared.findSellers) return;
    try {
      const wishIds = [...new Set(shared.GAME_SLUGS.flatMap((g) => wishlistByGame[g].knownCardIds()))];
      if (!wishIds.length) { el.hidden = true; return; }
      const rows = await shared.findSellers(wishIds);
      const myHandle = (shared.getProfile && shared.getProfile().handle) || "";
      const bySeller = new Map();
      rows.forEach((r) => {
        if (!r || !r.handle || r.handle === myHandle) return;
        let s = bySeller.get(r.handle);
        if (!s) { s = { handle: r.handle, name: r.display_name || ("@" + r.handle), items: new Map() }; bySeller.set(r.handle, s); }
        const prev = s.items.get(r.card_id);
        if (!prev || r.price < prev.price) s.items.set(r.card_id, { price: r.price, cur: r.cur, cond: r.cond });
      });
      const sellers = [...bySeller.values()].filter((s) => s.items.size).sort((a, b) => b.items.size - a.items.size).slice(0, 5);
      if (!sellers.length) { el.hidden = true; return; }
      const blocks = sellers.map((s) => {
        const chips = [...s.items.entries()].slice(0, 6).map(([id, it]) => {
          const card = cardsById.get(id);
          const label = card ? card.name : id;
          const price = it.price > 0 ? ` · ${shared.formatMoney(it.cur || "BRL", it.price)}` : "";
          return `<span class="wish-seller-chip">${shared.escapeHtml(label)}${shared.escapeHtml(price)}</span>`;
        }).join("");
        return `<a class="wish-seller" href="collection.html?u=${shared.escapeAttribute(s.handle)}&t=sales">
          <strong>${shared.escapeHtml(s.name)}</strong>
          <span class="wish-seller-n">${shared.escapeHtml(tn("wish.sellers.count", s.items.size))}</span>
          <span class="wish-seller-chips">${chips}</span>
        </a>`;
      }).join("");
      el.innerHTML = `<h2>${shared.escapeHtml(t("wish.sellers.title"))}</h2><div class="wish-seller-list">${blocks}</div>
        <p class="wish-sellers-note">${shared.escapeHtml(t("wish.sellers.note"))}</p>`;
      el.hidden = false;
    } catch (e) { el.hidden = true; /* seção é opcional */ }
  }

  // "Notificação" serverless: cruza a wishlist com os deltas semanais de preço
  // (price-deltas do build) e avisa das QUEDAS (>= 3%) — hora boa de comprar.
  // Sem histórico ainda (primeira semana) ou sem quedas, fica invisível.
  async function renderDropNotice() {
    const el = document.getElementById("wishDrops");
    if (!el) return;
    try {
      const perGame = await Promise.all(shared.GAME_SLUGS.map((g) => shared.loadPriceDeltas(g)));
      const deltas = {};
      perGame.forEach((d) => { if (d && d.c) Object.assign(deltas, d.c); });
      const drops = [];
      cards.forEach((card) => {
        if (!wishlist.hasCard(card.id)) return;
        const pct = deltas[card.id] != null ? deltas[card.id] : deltas[shared.basePricingId(card.id)];
        if (pct != null && pct <= -3) drops.push({ card, pct });
      });
      if (!drops.length) { el.hidden = true; return; }
      drops.sort((a, b) => a.pct - b.pct);
      const loc = shared.getLocale();
      const chips = drops.slice(0, 6).map(({ card, pct }) =>
        `<a class="wish-drop-chip" href="${shared.escapeAttribute(shared.detailUrl("set", card.set))}">${shared.escapeHtml(card.name)} <span class="wish-drop-pct">▼ ${Math.abs(pct).toLocaleString(loc, { maximumFractionDigits: 1 })}%</span></a>`).join("");
      el.innerHTML = `<strong>${shared.escapeHtml(tn("wish.drops.title", drops.length))}</strong><span class="wish-drop-chips">${chips}</span>`;
      el.hidden = false;
    } catch (e) { el.hidden = true; /* aviso é opcional */ }
  }

  // --- Preço-alvo: banner das atingidas + sino por tile ---
  // Valor atual da carta (menor entre as variantes desejadas), na moeda do topo.
  function currentWishValue(card) {
    const vals = wishlist.variants(card.id)
      .map((v) => shared.cardValue(card, v, prices).value || 0)
      .filter((v) => v > 0);
    return vals.length ? Math.min(...vals) : 0;
  }
  function renderTargetNotice() {
    const el = document.getElementById("wishTargets");
    if (!el) return;
    const hits = [];
    targets.entries().forEach(({ cardId, v, cur }) => {
      const card = cardsById.get(cardId);
      if (!card || !wishlist.hasCard(cardId)) return;
      const now = currentWishValue(card);
      const targetNow = shared.moneyToCurrent(v, cur);
      if (now > 0 && targetNow > 0 && now <= targetNow) hits.push({ card, now, targetNow });
    });
    if (!hits.length) { el.hidden = true; el.innerHTML = ""; return; }
    hits.sort((a, b) => (a.now / a.targetNow) - (b.now / b.targetNow));
    const curSym = shared.getCurrency();
    const chips = hits.slice(0, 6).map(({ card, now }) =>
      `<a class="wish-drop-chip" href="${shared.escapeAttribute(shared.detailUrl("set", card.set))}">${shared.escapeHtml(card.name)} <span class="wish-target-now">🎯 ${shared.escapeHtml(shared.formatMoney(curSym, now))}</span></a>`).join("");
    el.innerHTML = `<strong>${shared.escapeHtml(tn("wish.target.hit", hits.length))}</strong><span class="wish-drop-chips">${chips}</span>`;
    el.hidden = false;
  }
  // Sino no tile: define/edita o alvo via prompt (vazio remove). Estado no botão.
  function targetBellHtml(card) {
    const cur = targets.get(card.id);
    const label = cur
      ? t("wish.target.editAria", { v: shared.formatMoney(cur.cur, cur.v) })
      : t("wish.target.setAria");
    return `<button type="button" class="wish-target-btn${cur ? " has-target" : ""}" data-wish-target="${shared.escapeAttribute(card.id)}" title="${shared.escapeAttribute(label)}" aria-label="${shared.escapeAttribute(label)}">🔔</button>`;
  }
  function decorateTile(node, card) {
    const info = node.querySelector(".tile-info") || node;
    info.insertAdjacentHTML("beforeend", targetBellHtml(card));
    return node;
  }
  function handleTargetClick(btn) {
    const cardId = btn.dataset.wishTarget;
    const card = cardsById.get(cardId);
    const cur = targets.get(cardId);
    const raw = window.prompt(
      t("wish.target.prompt", { name: card ? card.name : cardId, cur: shared.getCurrency() }),
      cur ? String(cur.v).replace(".", ",") : ""
    );
    if (raw === null) return; // cancelou
    const v = parseFloat(String(raw).replace(/[^\d.,]/g, "").replace(",", "."));
    targets.set(cardId, Number.isFinite(v) && v > 0 ? v : 0, shared.getCurrency());
    const fresh = targets.get(cardId);
    btn.classList.toggle("has-target", !!fresh);
    const label = fresh ? t("wish.target.editAria", { v: shared.formatMoney(fresh.cur, fresh.v) }) : t("wish.target.setAria");
    btn.title = label; btn.setAttribute("aria-label", label);
    renderTargetNotice();
  }

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
    if (label) label.textContent = gameFilter !== "pokemon" && gameFilter !== "all" ? t("toolbar.characters") : t("toolbar.pokemon");
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
      // Sino do preço-alvo: antes de tudo (não abre preview nem remove desejo).
      const targetBtn = event.target.closest("[data-wish-target]");
      if (targetBtn) { handleTargetClick(targetBtn); return; }

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
    if (cardsSort === "rarity-desc") return (a, b) => shared.rarityRank(b.card.rarity) - shared.rarityRank(a.card.rarity) || byNum(a, b);
    if (cardsSort === "rarity-asc") return (a, b) => shared.rarityRank(a.card.rarity) - shared.rarityRank(b.card.rarity) || byNum(a, b);
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
    pager.render(tiles, ({ card, variant }) => decorateTile(shared.variantTile(card, variant, owned, wishlist, prices), card), { resetCount });
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
