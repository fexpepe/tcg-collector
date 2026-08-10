(function () {
  const shared = window.TCGShared;
  const { addOptions, detailUrl, unique, normalize, escapeHtml, escapeAttribute, speciesName, debounce, t, tn, localizedImg, gameLogoUrl, toRoman } = shared;

  let cards = [];
  let cardsById = new Map();
  let indexes = null;
  let manifest = null;
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
    resultCount: document.getElementById("resultCount"),
    setsViewToggle: document.getElementById("setsViewToggle")
  };
  const view = elements.grid.dataset.view || "pokedex";
  // Visão grade/lista dos Sets (só na página de Sets). Mesma UI e persistência
  // da página de Cartas; a classe .is-list na grade faz o CSS virar linhas.
  let setsView = localStorage.getItem("tcg-sets-view") === "list" ? "list" : "grid";
  // Página de Sets filtrada por uma série específica (?serie=id).
  const serieParam = new URLSearchParams(window.location.search).get("serie") || "";
  // ?line=opcd|op2002 (atalho vintage do hub): mostra SÓ os sets daquela linha do
  // jogo-pai (One Piece), com o prefixo de setId correspondente.
  const lineParam = new URLSearchParams(window.location.search).get("line") || "";
  // Escopo por linha de jogo (registro no shared): ?line= conhecida = página da
  // linha; sem line = jogo principal (as linhas vintage têm páginas próprias).
  const lineScope = shared.lineScope((window.SLEEVU && window.SLEEVU.game) || "pokemon", lineParam);
  const lineDef = lineScope.def;
  const linePrefix = lineDef ? lineDef.prefix : "";
  const pager = shared.createPager({
    grid: elements.grid,
    pageSize: 60,
    // Scroll infinito: reaplica o estado recolhido aos cards recém-inseridos.
    onAppend: () => { if (view === "sets") { applyCollapsed(); refineVisibleSets(); } }
  });
  let selectedGeneration = "";
  // Região padrão segue a preferência de idioma de carta; sem preferência ("all")
  // mantém o comportamento antigo (Inglês). Com preferência, os chips de região
  // somem (o seletor global de idioma passa a governar) — ver init().
  const isPokemonGame = () => ((window.SLEEVU && window.SLEEVU.game) || "pokemon") === "pokemon";
  let selectedLangRegion = shared.getCardLang() !== "all"
    ? shared.cardLanguageRegion(shared.getCardLang())
    : "english";

  // Valor total por set memoizado (a busca da página de Sets recalculava o
  // catálogo INTEIRO a cada tecla). Invalidado quando algo muda no preview
  // (posse/preço manual) — o único caminho de edição nesta página.
  const setValueMemo = new Map();
  // Custo pra completar (valor das cartas que FALTAM): depende da posse, então
  // é invalidado junto no onOwnedChange.
  const setMissingMemo = new Map();

  const preview = shared.createCardPreview({
    getCard: (cardId) => cardsById.get(cardId),
    store: owned,
    prices,
    wishlist,
    onOwnedChange: () => {
      setValueMemo.clear();
      setMissingMemo.clear();
      ownedCountMemo.clear();
      refinedSets.clear();
      refining.clear();
      // Se a grade tem tiles de carta, atualiza posse in-place (re-renderizar
      // tudo fazia as imagens piscarem/recarregarem a cada +/− no preview).
      const tiles = elements.grid.querySelectorAll(".card-tile");
      if (tiles.length) {
        tiles.forEach((tile) => shared.refreshTileOwnership(tile, owned, wishlist));
        if (elements.ownedCount) elements.ownedCount.textContent = owned.size;
      } else {
        render();
      }
    }
  });

  const cardLang = shared.getCardLang();
  const langMatch = (value) => cardLang === "all" || shared.normalizeCardLanguage(value) === cardLang;

  // Pokédex e SETS rodam só com índices + manifest: nenhuma das duas telas
  // mostra dado de carta, e baixar o catálogo pra elas era o gargalo da tela de
  // sets (43 MB no Magic). As demais visões (artistas/treinadores/cartas) ainda
  // precisam das cartas e baixam só os chunks do idioma escolhido.
  // Artistas e Treinadores entram na mesma lista: a cápsula deles mostra só
  // nome, total e quantas você tem (createGroupCard nem imagem usa), e as três
  // coisas saem do índice `{ name, cardIds }` — mas a página baixava o catálogo
  // INTEIRO pra depois jogar as cartas fora. No Magic isso eram 238 requisições
  // e 2,4 MB comprimidos (8 MB depois de descomprimir) pra desenhar 60 cápsulas.
  //
  // O catálogo não some: a busca daqui casa contra as CARTAS de propósito
  // ("Artista, carta, set, número…"), então ele é carregado no primeiro caractere
  // digitado — ver garanteCartas(). Quem só abre a página e clica num artista
  // não paga nada disso; quem busca paga o mesmo de antes, uma vez.
  const soIndices = view === "pokedex" || view === "sets" || view === "artists" || view === "trainers";
  const catalogPromise = soIndices
    ? Promise.resolve(shared.loadIndexesOnly())
    : shared.loadCatalog(cardLang);
  // Skeletons enquanto os chunks baixam (a Pokédex é instantânea: só índices).
  if (view !== "pokedex" && elements.grid) shared.showSkeletons(elements.grid, view === "sets" ? "set" : "card", 12);

  // Na página de Sets, carrega o câmbio junto (pro valor total do set já sair
  // convertido na moeda escolhida).
  Promise.all([catalogPromise, view === "sets" ? shared.loadFxRates() : Promise.resolve()])
    .then(([catalog]) => {
      cards = catalog.cards;
      cardsById = new Map(cards.map((card) => [card.id, card]));
      indexes = catalog.indexes || buildIndexes(cards);
      manifest = catalog.manifest || null;
      totalCatalogCount = cards.length
        ? cards.filter((card) => langMatch(card.language)).length
        : (catalog.manifest ? catalog.manifest.sets.filter((set) => langMatch(set.language)).reduce((sum, set) => sum + (set.count || 0), 0) : 0);
      // Só com as cartas em mãos a migração acerta a variante padrão; sem elas
      // (sets/pokedex, que rodam por índice) fica pra outra página do jogo.
      if (cards.length) owned.migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId)));
      if (view === "sets") indexAmbiguousSetNames();
      init();
      preview.openFromUrl(); // ?card=<id> compartilhado: reabre o popup
    })
    .catch((error) => {
      elements.empty.textContent = t("error.catalog", { message: error.message });
      elements.empty.hidden = false;
    });

  // Traz as CARTAS pra uma tela que abriu só com índices (artistas/treinadores).
  // Chamada no primeiro caractere digitado na busca — é ali que os campos de
  // carta (nome, set, número) passam a ser necessários. Uma vez só por sessão de
  // página; enquanto baixa, a tela segue mostrando o resultado por índice.
  let cartasPromise = null;
  function garanteCartas() {
    if (cards.length) return Promise.resolve(true);
    if (!cartasPromise) {
      cartasPromise = shared.loadCatalog(cardLang).then((catalog) => {
        cards = catalog.cards || [];
        cardsById = new Map(cards.map((card) => [card.id, card]));
        if (catalog.indexes) indexes = catalog.indexes;
        if (cards.length) owned.migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId)));
        return true;
      }).catch(() => false);
    }
    return cartasPromise;
  }

  function init() {
    // Com preferência de idioma de carta, o filtro de região vira redundante
    // (só aquele idioma é carregado) — esconde pra não conflitar. Também some
    // fora do Pokémon: região (EN/JP/CN/PT do MESMO set) é conceito de Pokémon;
    // no One Piece/Lorcana cada carta tem sua região (ex.: vintage Carddass = JP),
    // e filtrar por região esconderia o vintage por baixo do padrão "english".
    if (elements.setRegionChips && (shared.getCardLang() !== "all" || !isPokemonGame())) {
      elements.setRegionChips.hidden = true;
    }
    // Índice nome→cardIds: só serve pra contar quantas cartas SUAS estão em cada
    // set, então é buscado DEPOIS do primeiro paint e só se houver coleção neste
    // jogo. Quem chega sem coleção não paga o download (1,3 MB no Magic).
    if (manifestMode() && owned.size > 0) {
      shared.loadIndexSlice("sets").then((slice) => {
        if (!slice) return;
        indexes = indexes || {};
        indexes.sets = slice;
        indexCardIdsByEntry();
        ownedCountMemo.clear();
        render();
      });
    }
    if (view === "sets" && serieParam) applySerieTitle();
    if (view === "sets" && linePrefix) applyLineTitle();
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
      // No PAI DO H1, não no .page-head: desde que o título dividiu a faixa com
      // a busca, o h1 vive dentro de .page-head-bar-text e não é mais filho
      // direto do .page-head. insertBefore com um nó que não é filho LANÇA, e a
      // exceção subia até o .catch() do boot — a página da série (e a da linha
      // vintage) ficava em branco com "não foi possível carregar o catálogo".
      h1.parentElement.insertBefore(back, h1);
    }
  }

  // Atalho de linha (?line=): título com a etiqueta da linha + link de volta ao
  // jogo. A etiqueta padrão é VINTAGE (todas as linhas clássicas); uma linha
  // pode trocar via tagKey — ex.: o NARUTO CARD GAME novo usa "Em breve".
  function applyLineTitle() {
    const head = document.querySelector(".page-head");
    const h1 = head && head.querySelector("h1");
    if (!h1) return;
    h1.removeAttribute("data-i18n");
    h1.innerHTML = `${escapeHtml(t(lineDef.titleKey))} <span class="line-tag">${escapeHtml(t(lineDef.tagKey || "hub.vintageTagShort"))}</span>`;
    if (!head.querySelector(".serie-back")) {
      const back = document.createElement("a");
      back.className = "serie-back";
      back.href = `sets.html?game=${(window.SLEEVU && window.SLEEVU.game) || "pokemon"}`;
      back.textContent = `← ${(window.SLEEVU && window.SLEEVU.name) || ""}`;
      // No PAI DO H1, não no .page-head: desde que o título dividiu a faixa com
      // a busca, o h1 vive dentro de .page-head-bar-text e não é mais filho
      // direto do .page-head. insertBefore com um nó que não é filho LANÇA, e a
      // exceção subia até o .catch() do boot — a página da série (e a da linha
      // vintage) ficava em branco com "não foi possível carregar o catálogo".
      h1.parentElement.insertBefore(back, h1);
    }
  }

  function hydrateFilters() {
    if (elements.setFilter) addOptions(elements.setFilter, unique(cards.map((card) => card.set)));
    if (elements.languageFilter) addOptions(elements.languageFilter, unique(cards.map((card) => shared.normalizeCardLanguage(card.language))), (value) => shared.cardLanguageLabel(value));
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

  // Grade ↔ lista dos Sets: só alterna a classe .is-list na grade (CSS faz o
  // resto), reflete nos botões e persiste. Sem re-render — é layout puro.
  function applySetsView() {
    if (elements.grid) elements.grid.classList.toggle("is-list", setsView === "list");
    if (elements.setsViewToggle) {
      elements.setsViewToggle.querySelectorAll("[data-grid-view]").forEach((b) => {
        b.setAttribute("aria-pressed", b.dataset.gridView === setsView ? "true" : "false");
      });
    }
  }

  function bindEvents() {
    const applyFilters = () => render({ resetCount: true });
    elements.search.addEventListener("input", debounce(() => {
      // Artistas/Treinadores abrem sem as cartas (ver soIndices). A busca aqui
      // procura também por nome de carta, set e número, então o primeiro texto
      // digitado é o gatilho pra buscá-las. Desenha o que já dá pra desenhar e
      // repinta quando elas chegam — sem isto, a primeira busca ficaria muda.
      if (soIndices && view !== "sets" && view !== "pokedex" && elements.search.value.trim() && !cards.length) {
        garanteCartas().then(() => render({ resetCount: true }));
      }
      applyFilters();
    }, 200));
    [elements.typeFilter, elements.setFilter, elements.languageFilter, elements.ownedFilter].filter(Boolean).forEach((element) => {
      element.addEventListener("input", applyFilters);
    });

    if (elements.setsViewToggle) {
      applySetsView(); // estado inicial (antes do primeiro render) a partir da pref salva
      elements.setsViewToggle.addEventListener("click", (event) => {
        const button = event.target.closest("[data-grid-view]");
        if (!button) return;
        setsView = button.dataset.gridView === "list" ? "list" : "grid";
        localStorage.setItem("tcg-sets-view", setsView);
        applySetsView();
      });
    }

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
        return;
      }
      // Recolher/expandir uma seção de sets (série do Pokémon ou categoria do
      // Lorcana/One Piece). O "X sets →" da série continua sendo um link normal.
      const toggle = event.target.closest(".cat-toggle, .set-category-head");
      if (toggle) {
        const head = toggle.closest(".set-series-head");
        if (head && head.dataset.cat) { toggleCategory(head.dataset.cat); return; }
      }
      // Card de set compacto: clicar em qualquer lugar (menos num link) navega.
      const setCard = event.target.closest(".set-card");
      if (setCard && setCard.dataset.href && !event.target.closest("a")) {
        window.location.href = setCard.dataset.href;
      }
    });
  }

  // Categorias de sets recolhíveis (Lorcana/One Piece: Principais/Promos/Vintage…).
  // Estado por (jogo + categoria) no localStorage — persiste entre visitas.
  const COLLAPSE_KEY = "tcg-sets-collapsed";
  function collapsedSet() {
    try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]")); } catch (e) { return new Set(); }
  }
  function catKey(name) { return `${(window.SLEEVU && window.SLEEVU.game) || "pokemon"}:${name}`; }
  function isCategoryCollapsed(name) { return collapsedSet().has(catKey(name)); }
  function toggleCategory(name) {
    const set = collapsedSet();
    const k = catKey(name);
    if (set.has(k)) set.delete(k); else set.add(k);
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set])); } catch (e) { /* ignora */ }
    applyCollapsed();
  }
  // Percorre a grade em ordem, marca cada card com a categoria vigente e esconde
  // os das categorias recolhidas (+ atualiza a seta e o estado do cabeçalho).
  function applyCollapsed() {
    const collapsed = collapsedSet();
    let cur = null, hidden = false;
    for (const node of elements.grid.children) {
      if (node.classList.contains("set-series-head")) {
        cur = node.dataset.cat || "";
        hidden = collapsed.has(catKey(cur));
        node.classList.toggle("is-collapsed", hidden);
        const btn = node.querySelector(".cat-toggle") || node;
        btn.setAttribute("aria-expanded", String(!hidden));
        const caret = node.querySelector(".cat-caret");
        if (caret) caret.textContent = hidden ? "▸" : "▾";
      } else if (node.classList.contains("set-card")) {
        if (cur != null) node.dataset.cat = cur;
        node.hidden = hidden;
      }
    }
  }

  function render({ resetCount = false } = {}) {
    // Pokédex não filtra cartas (roda por espécie via índices); as outras
    // visões partem das cartas visíveis após os filtros.
    // filterCards() varre o catálogo; sets e pokedex não têm catálogo carregado
    // (e não precisam) — passam direto.
    const items = view === "pokedex" ? pokedexViewItems()
      : getViewItems(manifestMode() ? [] : filterCards());
    pager.render(items, createViewItem, { resetCount }); // onAppend reaplica o recolhido
    if (view === "sets") { applyCollapsed(); refineVisibleSets(); }

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
      // Escopo da linha: página de linha mostra SÓ os sets dela; o jogo
      // principal exclui as linhas (cada uma tem página própria via hub).
      // Com manifest, os tiles saem dele (sem baixar carta) — ver manifestSetItems.
      const setItems = manifestMode()
        ? manifestSetItems()
        : indexedGroupsToItems(indexes.sets, visibleIds, toSetItem, null, splitGroupsBySetId).filter((set) => lineScope.includes(set.setId));
      // Linha vintage (?line=): sempre do mais antigo pro mais novo.
      if (linePrefix) return setItems.sort(sortByReleaseAsc);
      // Página de uma série (?serie=id): só os sets dela, sem cabeçalhos.
      if (serieParam) return setItems.filter((set) => set.serieId === serieParam).sort(sortByReleaseDesc);
      // Lorcana não tem séries: separa em 2 categorias (Principais + Promos).
      if ((window.SLEEVU && window.SLEEVU.game) === "lorcana") return groupLorcanaSets(setItems);
      // One Piece: Boosters (OP01…) + Starter Decks (ST-…) + o resto (promos etc.).
      if ((window.SLEEVU && window.SLEEVU.game) === "onepiece") return groupOnePieceSets(setItems);
      if ((window.SLEEVU && window.SLEEVU.game) === "naruto") return groupNarutoSets(setItems);
      if ((window.SLEEVU && window.SLEEVU.game) === "hxh") return groupHxhSets(setItems);
      // Página de Sets: agrupada por série (coleção).
      return groupSetsBySeries(setItems);
    }

    // Sem as cartas em mãos (abertura da página — ver soIndices), as cápsulas
    // saem direto dos ids do índice. Assim que a busca traz o catálogo, o
    // caminho volta a ser o de sempre, com os filtros todos valendo.
    if (view === "artists") {
      return cards.length
        ? indexedGroupsToItems(indexes.artists, visibleIds, toGroupItem)
        : groupItemsFromIds(indexes.artists);
    }

    if (view === "trainers") {
      return cards.length
        ? indexedGroupsToItems(indexes.trainers, visibleIds, toGroupItem)
        : groupItemsFromIds(indexes.trainers);
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

  // ── LISTA de sets a partir do MANIFEST ─────────────────────────────────────
  // Um tile de set mostra logo, símbolo, nome, data, série, quantas cartas o set
  // tem, quantas são suas e quanto ele vale. Nada disso é dado de CARTA: ou é
  // metadado do set (igual em todas) ou é uma soma. Mesmo assim a lista baixava
  // o catálogo inteiro do jogo pra montar os tiles — 647 chunks e 43 MB no
  // Magic, 452 e 29 MB no Pokémon, ANTES do primeiro tile aparecer. Era o motivo
  // de "a tela de sets demora demais".
  //
  // Agora o metadado e a soma de preço viajam no próprio manifest (~100 KB, que
  // a página já baixa) — ver setManifestMeta em scripts/lib/sync-common.mjs. O
  // que sobra de específico seu:
  //   · quantas cartas você tem no set — interseção do índice nome→cardIds com
  //     a sua coleção, memoizada;
  //   · o custo pra completar, que precisa saber QUAIS faltam. É o único número
  //     que ainda pede o chunk, e ele é buscado depois do primeiro paint, só
  //     pros sets em que você já tem alguma carta (o tile nem mostra o custo nos
  //     outros) e só pros que estão na tela.
  //
  // Sem manifest (modo local, window.TCG_CARDS de amostra) nada disso vale: o
  // caminho antigo, por cartas, continua inteiro logo abaixo.
  const manifestMode = () => Boolean(view === "sets" && manifest && Array.isArray(manifest.sets) && manifest.sets.length);
  const entryKey = (entry) => `${entry.id}|${entry.language}`;
  // Idioma EXATO do id (zh-cn e zh-tw são entradas distintas do manifest, então
  // aqui não pode normalizar pra "zh" como o cardLanguageFromId faz).
  const langFromId = (id) => (String(id).match(/-(pt|ja|zh-cn|zh-tw)$/) || [null, "en"])[1];

  // cardIds do índice (que agrupa por NOME) distribuídos entre as entradas do
  // manifest com aquele nome. Um nome = uma entrada é o caso de quase todo set:
  // atalho direto. Quando o nome tem várias entradas, decide pelo idioma do id;
  // e só quando duas edições do MESMO idioma dividem o nome (レイジングサーフ =
  // SV3a e SV4a) é que o setId embutido no id entra pra desempatar — jogos cujo
  // id não carrega o setId ("mtg-msc-1") nunca chegam nesse ramo.
  let cardIdsByEntry = new Map();
  function indexCardIdsByEntry() {
    cardIdsByEntry = new Map();
    const byName = new Map();
    manifest.sets.forEach((entry) => {
      if (!byName.has(entry.name)) byName.set(entry.name, []);
      byName.get(entry.name).push(entry);
    });
    const setIds = manifest.sets.map((entry) => entry.id);
    const push = (entry, id) => {
      const key = entryKey(entry);
      if (!cardIdsByEntry.has(key)) cardIdsByEntry.set(key, []);
      cardIdsByEntry.get(key).push(id);
    };
    (indexes && indexes.sets ? indexes.sets : []).forEach((group) => {
      const entries = byName.get(group.name);
      if (!entries || !entries.length) return;
      if (entries.length === 1) { cardIdsByEntry.set(entryKey(entries[0]), group.cardIds || []); return; }
      (group.cardIds || []).forEach((id) => {
        const lang = langFromId(id);
        const sameLang = entries.filter((entry) => entry.language === lang);
        if (!sameLang.length) return;
        if (sameLang.length === 1) { push(sameLang[0], id); return; }
        const setId = shared.setIdForCard(id, setIds);
        push(sameLang.find((entry) => entry.id === setId) || sameLang[0], id);
      });
    });
  }

  // Quantas cartas do set você tem. Memoizado: a busca re-renderiza a cada
  // tecla e isso varre os cardIds de TODOS os sets do jogo.
  const ownedCountMemo = new Map();
  function entryOwnedCount(entry) {
    const key = entryKey(entry);
    if (!ownedCountMemo.has(key)) {
      const ids = cardIdsByEntry.get(key) || [];
      let n = 0;
      ids.forEach((id) => { if (owned.has(id)) n++; });
      ownedCountMemo.set(key, n);
    }
    return ownedCountMemo.get(key);
  }

  // Soma de preço do manifest (por moeda de ORIGEM) convertida pra moeda atual.
  // Sem câmbio, convertMoney devolve null e a parcela fica de fora — mesmo
  // comportamento do cardValue carta a carta.
  function entryRefValue(entry) {
    const cur = shared.getCurrency();
    let total = 0;
    [["vb", "BRL"], ["vu", "USD"], ["ve", "EUR"]].forEach(([field, from]) => {
      if (!entry[field]) return;
      const value = shared.convertMoney(entry[field], from, cur);
      if (value != null) total += value;
    });
    return total;
  }

  // Valor/custo EXATOS de um set já refinado (chunk baixado): entram no lugar
  // dos números do manifest, que não conhecem preço manual seu.
  const refinedSets = new Map();

  function toManifestSetItem(entry) {
    const key = entryKey(entry);
    const refined = refinedSets.get(key);
    const serieId = entry.serieId || deriveSerieId(entry.id);
    return {
      type: "set",
      name: entry.name,
      setId: entry.id,
      entryKey: key,
      cards: [],
      totalCount: entry.count,
      ownedCount: entryOwnedCount(entry),
      officialTotal: entry.total || entry.count,
      value: refined ? refined.value : entryRefValue(entry),
      missing: refined ? refined.missing : null,
      logo: entry.logo || "",
      displayName: shared.setDisplayName(entry.id, entry.name),
      symbol: entry.symbol || "",
      releaseDate: entry.release || "",
      serieId,
      serieName: entry.serieName || serieDisplayName(serieId),
      languageLabel: shared.cardLangSigla(entry.language)
    };
  }

  // Busca da tela de Sets filtra SETS (nome, sigla do id e série) — procurar
  // CARTA é papel do Buscar/Explorar. Antes ela varria as cartas do jogo
  // inteiro, o que só era possível porque a página baixava tudo.
  function entryMatchesQuery(entry, query) {
    if (!query) return true;
    return normalize(`${entry.name} ${shared.setDisplayName(entry.id, entry.name)} ${entry.id} ${entry.serieName || ""}`).includes(query);
  }

  function manifestSetItems() {
    const query = normalize(elements.search.value);
    // O eixo de idioma vale SEMPRE que a página tem os chips de região — mesmo
    // quando eles estão escondidos. Escondidos é o caso de quem tem preferência
    // de idioma de carta: aí quem governa é a preferência (o selectedLangRegion
    // já nasce dela), e não o chip. Testar `.hidden` aqui desligava o filtro
    // justamente nesse caso, e a tela de Sets do Pokémon virava 453 entradas em
    // quatro idiomas — cada set repetido em EN e PT, mais as séries japonesas e
    // chinesas. Enquanto a lista saía das CARTAS isso não aparecia: o catálogo
    // já vinha só no idioma escolhido. Do manifest vêm todos, então o corte tem
    // de ser explícito.
    const porRegiao = isPokemonGame() && elements.setRegionChips;
    return manifest.sets
      .filter((entry) => (!porRegiao || shared.cardLanguageRegion(entry.language) === selectedLangRegion)
        && lineScope.includes(entry.id)
        && entryMatchesQuery(entry, query))
      .map(toManifestSetItem)
      .sort(sortByName);
  }

  // Custo pra completar dos sets VISÍVEIS em que você já tem alguma carta — o
  // único número que ainda precisa das cartas. Roda depois do paint, um chunk
  // por set, e re-renderiza quando termina. Set sem carta sua não entra: o tile
  // não mostra custo nesse caso.
  const refining = new Set();
  async function refineVisibleSets() {
    if (!manifestMode()) return;
    const visiveis = new Set(Array.from(elements.grid.querySelectorAll(".set-card"))
      .map((node) => node.dataset.entryKey).filter(Boolean));
    const pendentes = manifest.sets.filter((entry) => {
      const key = entryKey(entry);
      return visiveis.has(key) && !refinedSets.has(key) && !refining.has(key) && entryOwnedCount(entry) > 0;
    });
    if (!pendentes.length) return;
    pendentes.forEach((entry) => refining.add(entryKey(entry)));
    let mudou = false;
    for (const entry of pendentes) {
      try {
        const chunk = await shared.fetchSetChunks([entry]);
        const missing = chunk.filter((card) => !owned.has(card.id));
        const somaTudo = shared.sumCardsValue(chunk, prices);
        const somaFalta = shared.sumCardsValue(missing, prices);
        refinedSets.set(entryKey(entry), {
          value: somaTudo.value,
          missing: { count: missing.length, value: somaFalta.value, unpriced: somaFalta.unpriced }
        });
        mudou = true;
      } catch (error) {
        refining.delete(entryKey(entry)); // rede caiu: tenta de novo no próximo render
      }
    }
    if (mudou) render();
  }

  // Cápsulas de artista/treinador a partir SÓ do índice `{ name, cardIds }`.
  // Tudo que createGroupCard desenha (nome, total, quantas você tem, barra de
  // progresso) sai daqui — nenhum campo de carta é lido.
  // O idioma vem do SUFIXO do id (cardLanguageFromId: -pt/-ja/-zh; en não tem),
  // que é a mesma verdade que o card.language traria. O filtro de busca não é
  // aplicado neste caminho de propósito: digitar carrega as cartas e a próxima
  // renderização já usa o caminho completo (ver bindEvents).
  function groupItemsFromIds(indexGroups) {
    const filtraLingua = cardLang !== "all";
    // Chips de região (Treinadores no Pokémon): o mesmo recorte que o
    // matchesLangRegion do filterCards faz, só que a partir do id.
    const porRegiao = isPokemonGame() && elements.setRegionChips && !elements.setRegionChips.hidden;
    const passa = (id) => {
      const lingua = shared.cardLanguageFromId(id);
      if (filtraLingua && lingua !== cardLang) return false;
      if (porRegiao && shared.cardLanguageRegion(lingua) !== selectedLangRegion) return false;
      return true;
    };
    return (indexGroups || [])
      .map((group) => {
        const ids = (filtraLingua || porRegiao)
          ? (group.cardIds || []).filter(passa)
          : (group.cardIds || []);
        return {
          type: "group",
          name: group.name,
          cards: [],
          totalCount: ids.length,
          ownedCount: ids.reduce((n, id) => n + (owned.has(id) ? 1 : 0), 0)
        };
      })
      .filter((item) => item.totalCount > 0)
      .sort(sortByName);
  }

  function indexedGroupsToItems(indexGroups, visibleIds, mapper, sortFn, splitFn) {
    const groups = (indexGroups || [])
      .map((group) => ({
        name: group.name,
        cards: group.cardIds.map((id) => cardsById.get(id)).filter((card) => card && visibleIds.has(card.id))
      }))
      .filter((group) => group.cards.length > 0);
    return (splitFn ? splitFn(groups) : groups)
      .map(mapper)
      .sort(sortFn || sortByName);
  }

  // O índice agrupa sets por NOME, e nome não é chave única: レイジングサーフ é
  // SV3a E SV4a, "Pokémon GO" é swsh10.5 e S10b. Fundidos, viravam um tile só
  // com a soma das duas edições (452 cartas) e um valor total somando as duas.
  // O eixo de língua já é resolvido antes, pelo filtro de REGIÃO; aqui sobra
  // separar por setId. Set de nome único devolve um grupo só — nada muda.
  function splitGroupsBySetId(groups) {
    const out = [];
    groups.forEach((group) => {
      const bySetId = new Map();
      group.cards.forEach((card) => {
        const key = card.setId || "";
        if (!bySetId.has(key)) bySetId.set(key, []);
        bySetId.get(key).push(card);
      });
      bySetId.forEach((list) => out.push({ name: group.name, cards: list }));
    });
    return out;
  }

  // Nomes de set que casam com mais de uma edição (setId × região) no catálogo
  // carregado. Só nesses o link precisa carregar ?setId=/?region= — o resto
  // continua com a URL limpa de sempre. Calculado uma vez, depois da carga.
  let ambiguousSetNames = new Set();
  function indexAmbiguousSetNames() {
    const byName = new Map();
    const add = (name, key) => {
      if (!name) return;
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name).add(key);
    };
    if (manifestMode()) manifest.sets.forEach((entry) => add(entry.name, `${entry.id}|${shared.cardLanguageRegion(entry.language)}`));
    else cards.forEach((card) => add(card.set, `${card.setId || ""}|${shared.cardLanguageRegion(card.language)}`));
    ambiguousSetNames = new Set(Array.from(byName).filter(([, keys]) => keys.size > 1).map(([name]) => name));
  }

  function setDetailUrl(item) {
    if (!ambiguousSetNames.has(item.name)) return detailUrl("set", item.name);
    return detailUrl("set", item.name, "", "", { setId: item.setId, region: selectedLangRegion });
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
    // O nome (com seta) recolhe/expande a série; o "X sets →" navega pra sub-página.
    const head = document.createElement("div");
    head.className = "set-series-head";
    head.dataset.cat = item.name;
    head.innerHTML = `<button type="button" class="cat-toggle" aria-expanded="${!isCategoryCollapsed(item.name)}"><span class="cat-caret" aria-hidden="true">▾</span><span class="set-series-name">${escapeHtml(item.name)}</span></button><a class="set-series-count" href="sets.html?serie=${escapeAttribute(item.serieId)}">${item.count} sets →</a>`;
    return head;
  }

  // Cabeçalho de categoria (Lorcana: Principais/Promos). Igual ao de série, mas
  // sem link/seta — é só um rótulo de seção, não navega pra lugar nenhum.
  function createCategoryHead(item) {
    const head = document.createElement("button");
    head.type = "button";
    head.className = "set-series-head set-category-head";
    head.dataset.cat = item.name;
    head.setAttribute("aria-expanded", String(!isCategoryCollapsed(item.name)));
    head.innerHTML = `<span class="set-series-name"><span class="cat-caret" aria-hidden="true">▾</span>${escapeHtml(item.name)}</span><span class="set-series-count">${item.count} sets</span>`;
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
      const matchesLanguage = !languageValue || shared.normalizeCardLanguage(card.language) === languageValue;
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
          <h3 title="${escapeAttribute(item.name)}">${escapeHtml(item.name)}</h3>
          <p>${escapeHtml(t("card.generation", { g: item.generation || "-" }))}</p>
        </div>
        <div class="progress-bar" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeAttribute(t("progress.aria", { name: item.name }))}">
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
        <div class="progress-bar" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeAttribute(t("progress.aria", { name: item.name }))}">
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
    article.dataset.href = setDetailUrl(item);
    if (item.entryKey) article.dataset.entryKey = item.entryKey;
    const progress = item.totalCount ? Math.round((item.ownedCount / item.totalCount) * 100) : 0;
    // Set sem logo próprio: usa o logo do JOGO no lugar do texto (e, quando o
    // set tem logo, o do jogo vira o último fallback se ele quebrar). Jogo sem
    // arquivo de logo (fab/jump) cai no placeholder de texto, como antes.
    // Sem logo próprio -> NOME DO SET como título preto sobre o chip claro.
    // Antes caía no logo do JOGO, e aí todo set de Gundam/YGO/Digimon ficava
    // com a mesma figura: a tela virava uma parede de tiles idênticos, sem nada
    // que diferenciasse um set do outro. O nome identifica de verdade.
    // (O logo do jogo continua como fallback de ERRO do <img>: se o arquivo do
    // logo existir mas quebrar no carregamento, é melhor que um ícone quebrado.)
    const gameLogo = gameLogoUrl((window.SLEEVU && window.SLEEVU.game) || "pokemon");
    const logo = item.logo
      ? localizedImg(item.logo, { alt: item.displayName, className: "set-logo", loading: "lazy", fallback: gameLogo })
      : `<span class="set-logo-placeholder">${escapeHtml(item.displayName)}</span>`;
    const symbol = item.symbol
      ? localizedImg(item.symbol, { className: "set-symbol", loading: "lazy" })
      : "";
    const releaseBadge = item.releaseDate
      ? `<span class="set-release" title="${escapeAttribute(formatReleaseDate(item.releaseDate, "long"))}">${escapeHtml(formatReleaseDate(item.releaseDate))}</span>`
      : "";

    // Layout COMPACTO (estilo Collectr): logo, nome, uma linha de progresso
    // (possuídas/total + %) e o valor só quando houver. O card inteiro navega
    // (handler na grade); a arte segue como <a> pra middle-click/acessibilidade.
    const valueHtml = item.value > 0
      ? `<span class="set-value">${escapeHtml(shared.formatMoney(shared.getCurrency(), item.value))}</span>`
      : "";
    // Custo pra completar: só em set INCOMPLETO com faltante precificado. Com
    // cartas sem preço na conta, o valor é um piso ("≥").
    const m = item.missing;
    let missingHtml = "";
    if (m && m.count > 0 && item.ownedCount > 0 && m.value > 0) {
      const cost = `${m.unpriced > 0 ? "≥ " : "≈ "}${shared.formatMoney(shared.getCurrency(), m.value)}`;
      const hint = t("set.missingHint", { n: m.count }) + (m.unpriced > 0 ? " " + t("set.missingUnpriced", { u: m.unpriced }) : "");
      missingHtml = `<div class="set-missing" title="${escapeAttribute(hint)}">${escapeHtml(t("set.missingCost", { n: m.count, v: cost }))}</div>`;
    }
    // Nos vintages japoneses o título em inglês SUBSTITUI o japonês na lista
    // (antes vinha numa linha extra acima da arte, e o japonês continuava sendo
    // o título — duas linhas dizendo a mesma coisa, uma delas ilegível pra
    // maioria). O nome original aparece ao abrir o set.
    article.innerHTML = `
      <a class="set-art-link" href="${escapeAttribute(setDetailUrl(item))}" aria-label="${escapeAttribute(item.displayName)}">
        <div class="set-art">
          ${releaseBadge}
          ${logo}
          ${symbol}
        </div>
      </a>
      <div class="set-body">
        <div class="set-title-row">
          <h3>${escapeHtml(item.displayName)}</h3>
          ${item.languageLabel ? `<span class="tag">${escapeHtml(item.languageLabel)}</span>` : ""}
        </div>
        <div class="progress-bar" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeAttribute(t("progress.aria", { name: item.name }))}">
          <span style="width: ${progress}%"></span>
        </div>
        <div class="set-footer">
          <span class="set-count">${item.ownedCount}/${item.totalCount} · ${progress}%</span>
          ${valueHtml}
          ${item.releaseDate ? `<span class="set-date-list" title="${escapeAttribute(formatReleaseDate(item.releaseDate, "long"))}">${escapeHtml(formatReleaseDate(item.releaseDate))}</span>` : ""}
        </div>
        ${missingHtml}
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

  function memoSetValue(name, sortedCards) {
    if (!setValueMemo.has(name)) setValueMemo.set(name, shared.sumCardsValue(sortedCards, prices).value);
    return setValueMemo.get(name);
  }

  // Custo pra completar: soma do mercado das cartas que você NÃO tem no set.
  function memoSetMissing(name, sortedCards) {
    if (!setMissingMemo.has(name)) {
      const missing = sortedCards.filter((card) => !owned.has(card.id));
      const sum = shared.sumCardsValue(missing, prices);
      setMissingMemo.set(name, { count: missing.length, value: sum.value, unpriced: sum.unpriced });
    }
    return setMissingMemo.get(name);
  }

  function toSetItem(group) {
    const sortedCards = group.cards.slice().sort((a, b) => shared.compareCardNumbers(a.number, b.number));
    const sample = sortedCards[0] || {};
    const serieId = sample.setSerieId || deriveSerieId(sample.setId);
    // Chave do memo = EDIÇÃO (setId + região), não o nome: com sets homônimos o
    // nome fazia o segundo devolver o valor já calculado do primeiro.
    const memoKey = `${sample.setId || group.name}|${selectedLangRegion}`;
    return {
      type: "set",
      name: group.name,
      setId: sample.setId || "",
      cards: sortedCards,
      totalCount: sortedCards.length,
      ownedCount: sortedCards.filter((card) => owned.has(card.id)).length,
      officialTotal: sample.setTotal || sortedCards.length,
      value: memoSetValue(memoKey, sortedCards),
      missing: memoSetMissing(memoKey, sortedCards),
      logo: sample.setLogo || "",
      // Nome de EXIBIÇÃO: tradução em inglês nos vintages japoneses, original no
      // resto. `name` (acima) continua sendo o original — é a chave de link,
      // busca e agrupamento; só o que aparece na tela muda.
      displayName: shared.setDisplayName(sample.setId, group.name),
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
    // Linhas vintage NÃO aparecem aqui: cada uma tem página própria (?line=,
    // tiles no hub) — o escopo em getViewItems já as filtrou.
    const isMain = (set) => /^OP\d+$/i.test(String(set.setId || "").trim());
    const isDeck = (set) => /^ST/i.test(String(set.setId || "").trim());
    const rest = setItems;
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
    return items;
  }

  // Naruto (jogo principal = Card Game 2002-2006): volumes, depois promos e
  // extras. As linhas Data Carddass/Miracle Battle têm páginas próprias.
  function groupNarutoSets(setItems) {
    const isMain = (set) => /^nrt-s\d+$/i.test(String(set.setId || "").trim());
    const main = setItems.filter(isMain).sort(sortByReleaseAsc);
    const extras = setItems.filter((s) => !isMain(s)).sort(sortByReleaseAsc);
    const items = [];
    if (main.length) {
      items.push({ type: "category-head", name: t("sets.category.main"), count: main.length });
      main.forEach((set) => items.push(set));
    }
    if (extras.length) {
      items.push({ type: "category-head", name: t("sets.category.promos"), count: extras.length });
      extras.forEach((set) => items.push(set));
    }
    return items;
  }

  // Hunter × Hunter (principal = Carddass Hyper Battle): as 6 partes numeradas
  // primeiro, em ordem CRESCENTE — é uma série linear, lê-se como checklist —,
  // e depois as promos (Jump Festa, Game Boy). O Miracle Battle é ?line=hxh-mb.
  function groupHxhSets(setItems) {
    const idOf = (set) => String(set.setId || "").trim().toLowerCase();
    const isPart = (set) => /-p\d+$/.test(idOf(set));
    const parts = setItems.filter(isPart).sort((a, b) => idOf(a).localeCompare(idOf(b), "en", { numeric: true }));
    const promos = setItems.filter((s) => !isPart(s)).sort(sortByReleaseAsc);
    const items = [];
    const section = (list, key) => {
      if (!list.length) return;
      items.push({ type: "category-head", name: t(key), count: list.length });
      list.forEach((set) => items.push(set));
    };
    section(parts, "sets.category.main");
    section(promos, "sets.category.promos");
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
    // Ambos sem data (linhas vintage sem data oficial): o setId sequencial do
    // sync (ex.: nrt-s01..s22) preserva a ordem cronológica da checklist.
    return String(a.setId || "").localeCompare(String(b.setId || "")) || a.name.localeCompare(b.name);
  }

  // Sets do mais ANTIGO para o mais novo — usado só nas linhas VINTAGE, que se
  // leem como checklist cronológica (parte 1, 2, 3…) em vez de "novidades
  // primeiro". Nos jogos modernos o padrão continua sendo o mais novo no topo.
  function sortByReleaseAsc(a, b) {
    if (a.releaseDate && b.releaseDate) {
      return a.releaseDate.localeCompare(b.releaseDate) || a.name.localeCompare(b.name);
    }
    if (a.releaseDate) return -1;
    if (b.releaseDate) return 1;
    return String(a.setId || "").localeCompare(String(b.setId || ""), "en", { numeric: true }) || a.name.localeCompare(b.name);
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
