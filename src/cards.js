(function () {
  const shared = window.TCGShared;
  const { addOptions, unique, debounce, t, tn } = shared;

  let cards = [];
  let cardsById = new Map();
  const owned = shared.createCollectionStore();
  const wishlist = shared.createWishlistStore();
  const prices = shared.createPriceStore();

  // Ordenação/visualização da grade (persistidas, chaves próprias da página de
  // busca — independentes da Coleção). Critérios, rótulos e comparação no
  // src/ordenar.js; as famílias oferecidas são o data-ordenar do cards.html.
  const ordenar = window.TCGOrdenar;
  const CARDS_SORTS = (document.getElementById("cardsSortSelect") || document.body).getAttribute("data-ordenar");
  let cardsSort = ordenar.valida(localStorage.getItem("tcg-cards-sort"), CARDS_SORTS);
  let cardsView = shared.gridViewValue(localStorage.getItem("tcg-cards-view"));

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
    cardsViewToggle: document.getElementById("cardsViewToggle"),
    filtersBtn: document.getElementById("cardsFiltersBtn"),
    filtersBar: document.getElementById("cardsFilters")
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
    if (sort) {
      cardsSort = ordenar.valida(sort, CARDS_SORTS, cardsSort);
      if (elements.cardsSortSelect) elements.cardsSortSelect.value = cardsSort;
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
  // Agora: o intro sobe na hora (as "mais vistas" vêm pela borda, só aquelas
  // ~40 cartas), a busca digitada é respondida pela borda (ver carregaParcial)
  // e o catálogo completo só desce quando só ele responde. Quem cai aqui pelo
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
        shared.mostraErroDeCatalogo(elements.empty, error);
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
  const temDeepLink = !!(sp0.get("q") || sp0.get("card") || URL_FILTERS.some(([param]) => sp0.get(param)));
  // Deep-link com busca/filtro: no boot, o mesmo caminho da interação (borda,
  // chunk do set ou catálogo inteiro, ver carregaParcial). ?card= (popup
  // compartilhado) resolve SÓ aquela carta pela borda (abreCartaDaUrl).
  // Skeleton só no deep-link de verdade: com o catálogo em memória não há espera.
  if (temDeepLink && elements.grid) shared.showSkeletons(elements.grid, "card", 12);

  // Declarada ANTES do boot de propósito: hydrateFiltersDoManifest() (logo
  // abaixo) chama reidratando(), que lê esta lista. Como `const` não é hoisted,
  // deixá-la lá embaixo junto da função estourava ReferenceError (TDZ) e matava
  // o módulo inteiro — a página ficava sem NENHUM listener.
  // O erro só aparecia em PRODUÇÃO: sem manifest (dev), hydrateFiltersDoManifest
  // volta na primeira linha e nunca chega no reidratando.
  const FILTER_SELECTS = ["setFilter", "languageFilter", "rarityFilter"];

  // ── Busca pela BORDA, catálogo inteiro só quando nada mais responde ────────
  // (2026-10-08) Tocar no campo de busca baixava o jogo INTEIRO — medido em
  // produção no Pokémon: 1.506 pedidos e 5,4 MB, heap em 54 MB, sem digitar
  // nada —, e a primeira busca também; a borda só fazia uma ponte de 60
  // cartas enquanto isso. Agora a busca digitada é respondida pela
  // /api/search completa (full=1: TODAS as cartas que casam, já com preço,
  // como no Explorar), e os filtros e a ordenação valem sobre esse resultado.
  // Filtro de set sem texto baixa só os chunks daquele set. O catálogo inteiro
  // só desce quando nada disso responde: raridade ou faixa de preço sem texto
  // nem set, borda fora do ar, ou busca com mais de 10 mil cartas.
  let parcial = null; // { chave, cards }: a base enquanto o catálogo inteiro não está em memória
  let parcialSeq = 0;
  const chaveDaBusca = () => `${elements.search.value.trim()}|${elements.setFilter.value}`;
  const parcialValida = () => !!(parcial && parcial.chave === chaveDaBusca());
  function precisaDoCatalogo() {
    return isSearching() && elements.search.value.trim().length < 2 && !elements.setFilter.value;
  }
  async function carregaParcial() {
    const seq = ++parcialSeq;
    const chave = chaveDaBusca();
    const q = elements.search.value.trim();
    const game = (window.SLEEVU && window.SLEEVU.game) || "pokemon";
    const scope = shared.lineScope(game, shared.lineParamOf());
    let achadas = null;
    if (q.length >= 2) {
      const r = await shared.searchApiFull(game, q);
      if (r && !r.truncated) {
        Object.assign(window.TCG_PRICING = window.TCG_PRICING || {}, r.pricing);
        achadas = r.cards.filter((card) => scope.includes(card.setId));
        shared.enrichSetTotals(achadas).then((mudou) => { if (mudou && parcialValida()) render(); });
      }
    } else if (elements.setFilter.value) {
      const manifest = window.TCG_MANIFEST;
      const doSet = manifest && Array.isArray(manifest.sets)
        ? manifest.sets.filter((s) => s.name === elements.setFilter.value && scope.includes(s.id)) : [];
      if (doSet.length) { try { achadas = await shared.fetchSetChunks(doSet); } catch (e) { achadas = null; } }
    }
    if (seq !== parcialSeq || catalogPronto) return;
    if (!achadas) {
      // Borda fora do ar (ou na pausa depois de um erro), busca grande demais,
      // set sem chunk: o catálogo inteiro responde, como antes.
      ensureCatalog().then(() => render({ resetCount: true })).catch(() => { /* erro já exibido */ });
      return;
    }
    achadas.forEach((card) => cardsById.set(card.id, card));
    priceMemo = new Map();
    parcial = { chave, cards: achadas };
    hydrateFiltersDoManifest(achadas); // raridades do resultado: o filtro funciona sem o catálogo
    render({ resetCount: true });
  }

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
    catalogoEmMemoria ? ensureCatalog().catch(() => { /* erro já exibido */ }) : Promise.resolve()
  ]).then(() => {
    if (!catalogPronto && isSearching()) {
      if (precisaDoCatalogo()) ensureCatalog().then(() => render({ resetCount: true })).catch(() => { /* erro já exibido */ });
      else carregaParcial();
    }
    render();
    loadTopViewed();
    abreCartaDaUrl();
  });

  // ?card=<id>: o popup compartilhado precisa da carta. Antes isso baixava o
  // catálogo inteiro do jogo; agora só ela, pela borda (com os chunks do set
  // de reserva, dentro do loadOwnedFast).
  async function abreCartaDaUrl() {
    const id = new URLSearchParams(window.location.search).get("card");
    if (id && !cardsById.has(id)) {
      const game = (window.SLEEVU && window.SLEEVU.game) || "pokemon";
      try {
        const r = await shared.loadOwnedFast({ [game]: [id] });
        (r.cards || []).forEach((card) => { if (!cardsById.has(card.id)) cardsById.set(card.id, card); });
      } catch (e) { /* sem a carta: o popup não abre, a página segue */ }
    }
    preview.openFromUrl();
  }

  // Os filtros são hidratados DUAS vezes: primeiro com o que o manifest dá, e
  // de novo quando o catálogo completo chega. Um <select> descarta o `value`
  // quando a <option> correspondente some, então toda hidratação perderia a
  // seleção — inclusive a do deep-link ?set=..., que nem chega a "pegar" na
  // primeira vez (é lida antes de existir qualquer opção).
  // A reposição sai da URL, não do estado do select: writeFiltersToUrl grava lá
  // a cada mudança, então a URL é sempre o espelho fiel da escolha atual.
  // (FILTER_SELECTS vive lá em cima, antes do boot — ver o comentário de lá.)
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
  // `raridadesDe` (opcional): cartas de onde tirar as raridades — o resultado
  // da busca pela borda, enquanto o catálogo inteiro não está em memória.
  function hydrateFiltersDoManifest(raridadesDe) {
    const manifest = window.TCG_MANIFEST;
    if (!manifest || !Array.isArray(manifest.sets)) return;
    const scope = shared.lineScope((window.SLEEVU && window.SLEEVU.game) || "pokemon", shared.lineParamOf());
    const sets = manifest.sets.filter((s) => scope.includes(s.id));
    reidratando(() => {
      addOptions(elements.setFilter, unique(sets.map((s) => s.name)));
      addOptions(elements.languageFilter, unique(sets.map((s) => shared.normalizeCardLanguage(s.language))), (value) => shared.cardLanguageLabel(value));
      applyCardLangDefault(elements.languageFilter);
      if (raridadesDe) addOptions(elements.rarityFilter, unique(raridadesDe.map((card) => card.rarity).filter(Boolean)));
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
      if (!catalogPronto && isSearching()) {
        if (precisaDoCatalogo()) ensureCatalog().then(() => render({ resetCount: true })).catch(() => { /* erro já exibido */ });
        else if (!parcialValida()) carregaParcial();
      }
      render({ resetCount: true });
    };
    // Focar a RARIDADE ou a faixa de PREÇO sem texto nem set na busca adianta
    // o catálogo: é o único caso em que só ele responde (e a raridade só tem
    // opções com cartas em memória). Focar a busca não adianta mais nada — a
    // borda responde o que for digitado.
    const adiantar = () => { if (!parcialValida() && !elements.search.value.trim() && !elements.setFilter.value) ensureCatalog().catch(() => { /* erro já exibido */ }); };
    [elements.rarityFilter, elements.priceMin, elements.priceMax].forEach((element) => {
      if (element) element.addEventListener("focus", adiantar);
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
    // Barra de filtros recolhível atrás do botão da linha do título (mesmo
    // padrão e mesma pref da Coleção/set: quem abre costuma manter aberto).
    if (elements.filtersBtn && elements.filtersBar) {
      let filtersOpen = false;
      try { filtersOpen = localStorage.getItem("tcg-collector-filters-open") === "1"; } catch (e) { /* ignora */ }
      const paintFilters = () => {
        elements.filtersBar.classList.toggle("is-collapsed", !filtersOpen);
        elements.filtersBtn.setAttribute("aria-expanded", String(filtersOpen));
      };
      elements.filtersBtn.addEventListener("click", () => {
        filtersOpen = !filtersOpen;
        try { localStorage.setItem("tcg-collector-filters-open", filtersOpen ? "1" : "0"); } catch (e) { /* ignora */ }
        paintFilters();
      });
      paintFilters();
    }
    if (elements.cardsViewToggle) {
      applyCardsView();
      elements.cardsViewToggle.addEventListener("click", (event) => {
        const button = event.target.closest("[data-grid-view]");
        if (!button) return;
        // Compacto muda o HTML do tile (sem <img>), não só a classe da grade:
        // entrar ou sair dele exige reconstruir a grade. grid<->lista é só CSS.
        const eraCompacto = cardsView === "compact";
        cardsView = shared.gridViewValue(button.dataset.gridView);
        localStorage.setItem("tcg-cards-view", cardsView);
        const virouCompacto = cardsView === "compact";
        applyCardsView();
        if (eraCompacto !== virouCompacto) render({ resetCount: false });
      });
    }

    elements.grid.addEventListener("click", (event) => {
      // + de tile agrupado: menu de versões (adicionar direto, sem abrir o card).
      if (shared.handleGroupedAddClick(event, owned, wishlist, refreshOwnership)) return;
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
    // Sem o catálogo inteiro em memória, a base é o resultado da busca pela
    // borda (ou os chunks do set filtrado) — os filtros e a ordenação valem
    // IGUAL sobre ela. A chave guarda texto e set: apagar "pikachu" pra "p" não
    // pode seguir filtrando sobre o resultado de "pikachu".
    const base = catalogPronto ? cards : (parcialValida() ? parcial.cards : []);
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
  // (o + abre o card pra escolher Normal/Foil…). O chip "Versões: Agrupar" da
  // barra de filtros religa ao vivo; o switch das Configurações grava a mesma
  // chave e vale na próxima carga.
  let agrupaVersoes = shared.groupVariantsEnabled();
  shared.initGroupVariantsChip((on) => { agrupaVersoes = on; render({ resetCount: true }); });

  function tilePairs() {
    const pairs = shared.cardVariantPairs(filterCards(), { group: agrupaVersoes });
    const cmp = sortComparator();
    // Critério primário: carta com imagem antes (sem-imagem sempre por último);
    // secundário: a ordenação escolhida pelo usuário.
    pairs.sort((a, b) =>
      (Number(shared.cardHasImage(b.card)) - Number(shared.cardHasImage(a.card))) || cmp(a, b));
    return pairs;
  }

  // Comparador do Ordenar (src/ordenar.js, o mesmo de toda grade). O preço é
  // o do tile; variação e popularidade chegam depois e repintam a grade.
  function sortComparator() {
    return ordenar.compara(cardsSort, {
      preco: (p) => shared.cardValue(p.card, p.variant, prices, shared.DEFAULT_CONDITION).value || 0,
      depois: () => render()
    });
  }

  // Alterna grade/lista (mesma classe .is-list do detalhe/coleção) e reflete nos botões.
  function applyCardsView() {
    shared.applyGridViewClasses(elements.grid, cardsView);
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
      // Só as cartas em destaque, pela borda (/api/collection: um pedido com os
      // ~40 ids, já com preço). Antes vinham os chunks INTEIROS dos sets delas —
      // ~75 pedidos e 415 KB medidos no Pokémon só pra montar esta fileira. Borda
      // fora do ar: os chunks, dentro do loadOwnedFast.
      if (!catalogPronto) {
        const r = await shared.loadOwnedFast({ [game]: top.map((row) => row.card_id) });
        (r.cards || []).forEach((card) => { if (!cardsById.has(card.id)) cardsById.set(card.id, card); });
        shared.enrichSetTotals(r.cards || []).then((mudou) => { if (mudou && !isSearching()) render(); });
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
      // A linha do título fica SEMPRE visível: é nela que moram Ordenar,
      // Visualização e o botão Filtros (sem ela a pessoa não abria os filtros
      // antes de buscar). Só o título muda: "Mais vistas" quando há o que
      // mostrar, "Cartas" (com o contador vazio) quando não há.
      elements.resultsHeader.hidden = false;
      if (elements.resultsTitle) elements.resultsTitle.textContent = t(showTop ? "home.topViewed" : "results.heading.cards");
      if (showTop) {
        pager.render(topViewedPairs, ({ card, variant }) => shared.variantTile(card, variant, owned, wishlist, prices, { addMode: true, grouped: agrupaVersoes, compact: cardsView === "compact", lists: true }), { resetCount: true });
      } else {
        pager.render([], () => document.createComment(""), { resetCount: true });
      }
      return;
    }
    elements.intro.hidden = true;
    elements.resultsHeader.hidden = false;
    if (elements.resultsTitle) elements.resultsTitle.textContent = t("results.heading.cards");
    // Sem o catálogo inteiro e sem a resposta desta busca ainda: skeletons em
    // vez de "nenhum resultado" — a página não afirma que a carta não existe
    // antes de alguém responder. Com a resposta da borda na mão, ela É o
    // resultado (vazio inclusive, como no Explorar).
    if (!catalogPronto && !parcialValida()) {
      elements.empty.hidden = true;
      elements.resultCount.textContent = "";
      shared.showSkeletons(elements.grid, "card", 12);
      return;
    }
    const tiles = tilePairs();
    pager.render(tiles, ({ card, variant }) => shared.variantTile(card, variant, owned, wishlist, prices, { addMode: true, grouped: agrupaVersoes, compact: cardsView === "compact", lists: true }), options || {});
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
