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
    resultsTitle: document.querySelector("#resultsHeader h2"),
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

  // ── Carga do catálogo: SOB INTENÇÃO, não no boot ───────────────────────────
  // Esta página filtra sobre o catálogo inteiro em memória (busca, set, idioma,
  // raridade, faixa de preço, 7 ordenações), então quando o usuário busca ela
  // realmente precisa de tudo. O problema era PAGAR isso sempre: no Pokémon são
  // 234 chunks / ~15MB, e nada renderizava antes de o último chegar — inclusive
  // a tela inicial, que nem grade tem (é o intro + "mais vistas").
  // Agora: o intro sobe na hora (as "mais vistas" vêm por loadCatalogForCardIds,
  // que baixa só os chunks daquelas ~40 cartas), e o catálogo completo só começa
  // a descer quando o usuário demonstra intenção de buscar. Quem cai aqui pelo
  // Google e não busca não baixa mais o catálogo inteiro à toa.
  let catalogPromise = null;
  let catalogPronto = false;
  function ensureCatalog() {
    if (!catalogPromise) {
      catalogPromise = shared.loadCatalog().then((catalog) => {
        // Escopo por linha de jogo: a página de uma linha vintage (?line=) só vê
        // as cartas dela; o jogo principal exclui as linhas (páginas próprias).
        const scope = shared.lineScope((window.SLEEVU && window.SLEEVU.game) || "pokemon", shared.lineParamOf());
        cards = (catalog.cards || []).filter((card) => scope.includes(card.setId));
        // Mantém as cartas que já vieram pelo caminho das "mais vistas" — o
        // preview e os tiles do intro dependem do cardsById.
        const merged = new Map(cardsById);
        cards.forEach((card) => merged.set(card.id, card));
        cardsById = merged;
        priceMemo = new Map();
        owned.migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId)));
        hydrateFilters();
        catalogPronto = true;
        return catalog;
      }).catch((error) => {
        catalogPromise = null; // deixa tentar de novo na próxima interação
        elements.intro.hidden = true;
        elements.empty.textContent = t("error.catalog", { message: error.message });
        elements.empty.hidden = false;
        throw error;
      });
    }
    return catalogPromise;
  }

  // Carrega de cara quando adiar não economiza nada:
  //  - deep-link com busca/filtro na URL: o usuário já chegou buscando;
  //  - modo dev (MANIFEST=false): o game.js já injetou o catálogo inteiro como
  //    <script>, então window.TCG_CARDS está em memória e loadCatalog() resolve
  //    sem tocar na rede — adiar só deixaria os filtros vazios à toa.
  const sp0 = new URLSearchParams(window.location.search);
  const catalogoEmMemoria = Array.isArray(window.TCG_CARDS) && window.TCG_CARDS.length > 0;
  // ?card= (popup de carta compartilhado) também é intenção: precisa do catálogo
  // pra resolver o id e reabrir o modal.
  const temDeepLink = !!(sp0.get("q") || sp0.get("card") || URL_FILTERS.some(([param]) => sp0.get(param)));
  const carregarNoBoot = temDeepLink || catalogoEmMemoria;
  // Skeleton só no deep-link de verdade: com o catálogo em memória não há espera.
  if (temDeepLink && elements.grid) shared.showSkeletons(elements.grid, "card", 12);

  // Ordem importa: as opções primeiro, o valor da URL depois. Um <select> não
  // aceita um value cuja <option> ainda não existe.
  hydrateFiltersDoManifest(); // set/idioma saem do manifest (46KB, já carregado)
  const q0 = sp0.get("q");
  if (q0 && elements.search) elements.search.value = q0;
  readFiltersFromUrl();
  bindEvents();

  // Câmbio e catálogo são INDEPENDENTES — vão juntos, não em fila. (Encadeados,
  // um câmbio lento segurava o catálogo e vice-versa.) Cada um com seu catch:
  // falha no câmbio não pode impedir a página de listar cartas.
  Promise.all([
    shared.loadFxRates().catch(() => { /* sem conversão: cai no preço cru */ }),
    carregarNoBoot ? ensureCatalog().catch(() => { /* erro já exibido */ }) : Promise.resolve()
  ]).then(() => { render(); loadTopViewed(); preview.openFromUrl(); });

  // Os filtros são hidratados DUAS vezes: primeiro com o que o manifest dá, e
  // de novo quando o catálogo completo chega. Um <select> descarta o `value`
  // quando a <option> correspondente some, então toda hidratação perderia a
  // seleção — inclusive a do deep-link ?set=..., que nem chega a "pegar" na
  // primeira vez (é lida antes de existir qualquer opção).
  // A reposição sai da URL, não do estado do select: writeFiltersToUrl grava lá
  // a cada mudança, então a URL é sempre o espelho fiel da escolha atual.
  const FILTER_SELECTS = ["setFilter", "languageFilter", "rarityFilter"];
  function reidratando(fn) {
    FILTER_SELECTS.forEach((k) => {
      const select = elements[k];
      if (select) while (select.options.length > 1) select.remove(1); // mantém o "Todos"
    });
    fn();
    readFiltersFromUrl();
  }

  // Hidratação IMEDIATA, só com o que o manifest já traz (nome e idioma de cada
  // set — 46KB que o game.js carregou junto com a página). Cobre 2 dos 3 filtros
  // sem tocar em nenhum chunk; a raridade só existe na carta, então espera o
  // catálogo. Assim os selects não abrem vazios enquanto ninguém buscou ainda.
  function hydrateFiltersDoManifest() {
    const manifest = window.TCG_MANIFEST;
    if (!manifest || !Array.isArray(manifest.sets)) return;
    const scope = shared.lineScope((window.SLEEVU && window.SLEEVU.game) || "pokemon", shared.lineParamOf());
    const sets = manifest.sets.filter((s) => scope.includes(s.id));
    reidratando(() => {
      addOptions(elements.setFilter, unique(sets.map((s) => s.name)));
      addOptions(elements.languageFilter, unique(sets.map((s) => shared.normalizeCardLanguage(s.language))), (value) => shared.cardLanguageLabel(value));
      applyCardLangDefault(elements.languageFilter);
    });
  }

  function hydrateFilters() {
    reidratando(() => {
      addOptions(elements.setFilter, unique(cards.map((card) => card.set)));
      addOptions(elements.languageFilter, unique(cards.map((card) => shared.normalizeCardLanguage(card.language))), (value) => shared.cardLanguageLabel(value));
      applyCardLangDefault(elements.languageFilter);
      addOptions(elements.rarityFilter, unique(cards.map((card) => card.rarity)));
    });
  }

  // Idioma de carta preferido como valor inicial do filtro (se existir nas opções).
  function applyCardLangDefault(select) {
    const pref = shared.getCardLang();
    if (pref !== "all" && Array.from(select.options).some((option) => option.value === pref)) {
      select.value = pref;
    }
  }

  function bindEvents() {
    // Toda interação de busca/filtro passa por aqui: garante o catálogo (baixa
    // na 1ª vez, reaproveita depois) e só então filtra. Enquanto desce, o
    // render mostra os skeletons — o campo continua digitável.
    const apply = () => {
      writeFiltersToUrl();
      render({ resetCount: true });
      if (!catalogPronto && isSearching()) {
        apiBridge(); // resultados JÁ, pela borda, enquanto o catálogo desce
        ensureCatalog().then(() => render({ resetCount: true })).catch(() => { /* erro já exibido */ });
      }
    };
    // Focar a busca ou os filtros JÁ é intenção: adianta o download em vez de
    // esperar a primeira tecla, senão o usuário digita e encara o skeleton.
    const adiantar = () => { ensureCatalog().catch(() => { /* erro já exibido */ }); };
    [elements.search, elements.setFilter, elements.languageFilter, elements.rarityFilter,
      elements.priceMin, elements.priceMax].forEach((element) => {
      if (element) element.addEventListener("focus", adiantar, { once: true });
    });

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
      if (shared.handleRemoveOneTileClick(event, owned)) { refreshOwnership(); return; }
      // Na busca, o "+" soma +1 a cada clique e pisca "✓ Adicionada!" por 2s,
      // pra cadastrar várias cópias da mesma carta sem abrir o card.
      const addButton = shared.handleAddTileClick(event, owned, wishlist);
      if (addButton) { refreshOwnership(); shared.flashTileAdded(addButton, owned); }
    });
  }

  // PONTE pela borda enquanto o catálogo completo (15MB no Pokémon) desce: a
  // /api/search do jogo da sessão responde a busca digitada em poucos KB, os
  // ≤60 resultados são hidratados pelos chunks dos sets deles e entram como
  // BASE do filterCards — os filtros de set/idioma/raridade/preço e a
  // ordenação valem igual. Quando o catálogo chega, o render de sempre assume.
  // API desligada/sem resultado: nada muda — o fluxo atual já cobre.
  let apiResultado = null;
  let apiSeq = 0;
  async function apiBridge() {
    const q = elements.search.value.trim();
    if (q.length < 2) return; // filtro sem texto: só o catálogo inteiro responde
    const seq = ++apiSeq;
    const game = (window.SLEEVU && window.SLEEVU.game) || "pokemon";
    const hits = await shared.searchApi(game, q, 60);
    if (seq !== apiSeq || catalogPronto || !hits || !hits.length) return;
    let r;
    try { r = await shared.loadCatalogForCardIds(hits.map((h) => h.i)); } catch (e) { return; }
    if (seq !== apiSeq || catalogPronto) return;
    // Mesmo escopo de linha da página (vintage não vaza pro jogo principal).
    const scope = shared.lineScope(game, shared.lineParamOf());
    apiResultado = (r.cards || []).filter((card) => scope.includes(card.setId));
    apiResultado.forEach((card) => cardsById.set(card.id, card));
    render({ resetCount: true });
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
    // Enquanto o catálogo completo não chegou, a base é o que a API da borda
    // trouxe (apiBridge) — os filtros e a ordenação valem IGUAL sobre ela, só
    // que sobre ≤60 cartas em vez de 48k. Com o catálogo pronto, a base volta a
    // ser tudo e a ponte é ignorada.
    const base = (!catalogPronto && apiResultado) || cards;
    return base.filter((card) => {
      if (!shared.matchesCardQuery(card, elements.search.value)) return false;
      if (setValue && card.set !== setValue) return false;
      if (languageValue && shared.normalizeCardLanguage(card.language) !== languageValue) return false;
      if (rarityValue && card.rarity !== rarityValue) return false;
      if (pMin != null || pMax != null) {
        const v = priceOf(card);
        if (pMin != null && v < pMin) return false;
        if (pMax != null && (v > pMax || v <= 0)) return false; // sem preço não entra em "até X"
      }
      return true;
    });
  }

  // Preferência "agrupar versões": nas grades de catálogo, uma carta = um tile
  // (o + abre o card pra escolher Normal/Foil…). Lida uma vez por carga — quem
  // troca a preferência nas Configurações volta pra cá com a página nova.
  const agrupaVersoes = shared.groupVariantsEnabled();

  function tilePairs() {
    const pairs = shared.cardVariantPairs(filterCards(), { group: agrupaVersoes });
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

  // Mais vistas pela comunidade: estado INICIAL da página (em vez de vazia). Puxa
  // o top do contador anônimo (card_views) DESTE jogo, resolve nas cartas já
  // carregadas (cardsById já é filtrado por escopo/linha) e mostra ~4-5 fileiras.
  // Ao digitar/filtrar, o render troca pros resultados da busca.
  let topViewedPairs = [];
  async function loadTopViewed() {
    try {
      if (!shared.fetchTopViewed) return;
      const game = (window.SLEEVU && window.SLEEVU.game) || "pokemon";
      const top = await shared.fetchTopViewed(game, 40);
      if (!top.length) return;
      // Só os chunks das cartas em destaque (~40 ids => punhado de sets), em vez
      // do catálogo inteiro. É isto que deixa o intro subir sem esperar os 15MB.
      if (!catalogPronto) {
        const r = await shared.loadCatalogForCardIds(top.map((row) => row.card_id));
        (r.cards || []).forEach((card) => { if (!cardsById.has(card.id)) cardsById.set(card.id, card); });
      }
      const seen = new Set();
      const picked = [];
      for (const row of top) {
        const card = cardsById.get(row.card_id);
        if (!card || seen.has(card.id)) continue;
        seen.add(card.id);
        picked.push({ card, variant: shared.defaultVariant(card) });
        if (picked.length >= 30) break;
      }
      topViewedPairs = picked;
      if (topViewedPairs.length >= 4 && !isSearching()) render({ resetCount: true });
    } catch (e) { /* seção é opcional */ }
  }

  function render(options) {
    const searching = isSearching();
    if (!searching) {
      const showTop = topViewedPairs.length >= 4;
      elements.intro.hidden = showTop;
      elements.empty.hidden = true;
      elements.resultCount.textContent = "";
      if (showTop) {
        elements.resultsHeader.hidden = false;
        if (elements.resultsTitle) elements.resultsTitle.textContent = t("home.topViewed");
        pager.render(topViewedPairs, ({ card, variant }) => shared.variantTile(card, variant, owned, wishlist, prices, { addMode: true, grouped: agrupaVersoes }), { resetCount: true });
      } else {
        elements.resultsHeader.hidden = true;
        pager.render([], () => document.createComment(""), { resetCount: true });
      }
      return;
    }
    elements.intro.hidden = true;
    elements.resultsHeader.hidden = false;
    if (elements.resultsTitle) elements.resultsTitle.textContent = t("results.heading.cards");
    // Buscando com o catálogo ainda a caminho: a PONTE da borda (apiBridge)
    // renderiza o que já achou; sem ela, skeletons em vez de "nenhum
    // resultado" — a página não pode afirmar que a carta não existe só porque
    // os chunks não chegaram. O `render` é chamado de novo quando eles chegam,
    // e aí a base volta a ser o catálogo inteiro.
    if (!catalogPronto) {
      elements.empty.hidden = true;
      const ponte = apiResultado ? tilePairs() : [];
      if (!ponte.length) {
        elements.resultCount.textContent = "";
        shared.showSkeletons(elements.grid, "card", 12);
        return;
      }
      pager.render(ponte, ({ card, variant }) => shared.variantTile(card, variant, owned, wishlist, prices, { addMode: true, grouped: agrupaVersoes }), options || {});
      elements.resultCount.textContent = tn("results.count", ponte.length);
      return;
    }
    const tiles = tilePairs();
    pager.render(tiles, ({ card, variant }) => shared.variantTile(card, variant, owned, wishlist, prices, { addMode: true, grouped: agrupaVersoes }), options || {});
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
