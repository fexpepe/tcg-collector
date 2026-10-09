(function () {
  const shared = window.TCGShared;
  const { addOptions, detailUrl, unique, normalize, escapeHtml, escapeAttribute, speciesName, debounce, t, tn, localizedImg, toRoman } = shared;

  // (veio do shared.js em 2026-09-14: só as páginas de explorar usam o logo
  // do jogo como stand-in do logo de set.)
  // Logo do jogo (assets/games/game_<slug>.webp): usado como stand-in do logo de
  // set quando o set não tem um próprio, e como último fallback quando o logo do
  // set quebra. "" pros jogos sem arquivo de logo (jump/unionarena) — aí cai no
  // texto. Entrou o arquivo em assets/games/? Basta preencher aqui e pôr o <img>
  // no tile do hub.html (o hub revela o logo sozinho quando ele carrega).
  // Os -v2 são os mesmos logos sem o véu de alfa e sem padding interno (ver
  // assets/games/README.md) — nome novo porque /assets/* é immutable.
  const GAME_LOGO = {
    pokemon: "game_pokemon.webp", lorcana: "game_lorcana-v2.webp", onepiece: "game_onepiece.webp",
    magic: "game_magic-v2.webp", fab: "game_fab.webp", gundam: "game_gundam-v2.webp", swu: "game_swu.webp", cyberpunk: "game_cyberpunk.webp", sorcery: "game_sorcery.webp", dbfw: "game_dbfw-v2.webp",
    ygo: "game_ygo-v2.webp", digimon: "game_digimon-v2.webp", riftbound: "game_riftbound-v2.webp",
    unionarena: "game_unionarena.webp", naruto: "game_naruto.webp", hxh: "game_hxh.webp",
    dbc: "game_dbc.webp", wow: "game_wow.webp", lotr: "game_lotr.webp", weiss: "game_weiss.webp", harrypotter: "game_harrypotter.webp",
    mbc: "game_mbc.webp"
  };
  function gameLogoUrl(game) {
    const f = GAME_LOGO[game];
    return f ? "assets/games/" + f : "";
  }

  let cards = [];
  let cardsById = new Map();
  let indexes = null;
  let manifest = null;
  let totalCatalogCount = 0;
  const owned = shared.createCollectionStore();
  const wishlist = shared.createWishlistStore();
  const prices = shared.createPriceStore();
  // Pokédex "já tenho": checklist por espécie (dexId), independente de carta.
  // Sincroniza na conta e entra no backup como os favoritos (ver shared.js).
  const dexOwned = shared.createDexOwnedStore();

  const elements = {
    grid: document.getElementById("cardGrid"),
    empty: document.getElementById("emptyState"),
    search: document.getElementById("searchInput"),
    generationChips: document.getElementById("generationChips"),
    setRegionChips: document.getElementById("setRegionChips"),
    typeFilter: document.getElementById("typeFilter"),
    favFilter: document.getElementById("favFilter"),
    dexFilter: document.getElementById("dexFilter"),
    dexProgressFill: document.getElementById("dexProgressFill"),
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
  // jogo-pai (One Piece), pelos prefixos de setId dela. Lido pelo shared, que
  // resolve os apelidos (o ?line=nrt-nf antigo abre a linha nrt-dc).
  const lineParam = shared.lineParamOf();
  // Escopo por linha de jogo (registro no shared): ?line= conhecida = página da
  // linha; sem line = jogo principal (as linhas vintage têm páginas próprias).
  const lineScope = shared.lineScope((window.SLEEVU && window.SLEEVU.game) || "pokemon", lineParam);
  const lineDef = lineScope.def;
  // Endereço da tela de Sets deste jogo (/games/<jogo>, desde 2026-09-30) e o
  // do jogo sem a linha: os links de série e de "voltar" saem daqui.
  const urlDoJogo = (window.SLEEVU && window.SLEEVU.urlDoJogo) || (() => "");
  const jogoAtual = (window.SLEEVU && window.SLEEVU.game) || "pokemon";
  const telaDoJogo = urlDoJogo(jogoAtual, lineDef ? lineParam : "") || "sets";
  const telaSemLinha = urlDoJogo(jogoAtual, "") || `sets?game=${jogoAtual}`;
  // Índice de sets que a borda põe na tela de um jogo (functions/games/). O
  // service worker guarda cada /games/<jogo> na entrada dele, mas é barato
  // garantir: se uma cópia chegar com o índice de OUTRO jogo, ele sai.
  if (view === "sets") {
    document.querySelectorAll("[data-indice-jogo]").forEach((el) => {
      if (`/games/${el.getAttribute("data-indice-jogo")}` !== telaDoJogo) el.remove();
    });
  }
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

  const preview = shared.createCardPreview({
    getCard: (cardId) => cardsById.get(cardId),
    store: owned,
    prices,
    wishlist,
    onOwnedChange: () => {
      setValueMemo.clear();
      limpaContagens();
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
        : (catalog.manifest ? catalog.manifest.sets.filter((set) => langMatch(set.language) && !set.retired).reduce((sum, set) => sum + (set.count || 0), 0) : 0);
      // Só com as cartas em mãos a migração acerta a variante padrão; sem elas
      // (sets/pokedex, que rodam por índice) fica pra outra página do jogo.
      if (cards.length) owned.migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId)));
      if (view === "sets") indexAmbiguousSetNames();
      init();
      preview.openFromUrl(); // ?card=<id> compartilhado: reabre o popup
    })
    .catch((error) => {
      shared.mostraErroDeCatalogo(elements.empty, error);
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
        limpaContagens();
        render();
      });
    }
    if (view === "sets" && serieParam) applySerieTitle();
    if (view === "sets" && lineDef) applyLineTitle();
    hydrateFilters();
    // ?dex=have|missing (Hub, medalhas): abre a Pokédex já filtrada.
    if (view === "pokedex" && elements.dexFilter) {
      const dexParam = new URLSearchParams(window.location.search).get("dex") || "";
      if (dexParam === "have" || dexParam === "missing") elements.dexFilter.value = dexParam;
    }
    bindEvents();
    render();
    // Outra aba mexeu na coleção (ou uma gravação falhou e o store voltou ao
    // disco): recalcula contagens e progresso dos sets.
    document.addEventListener("sleevu:data-rehydrated", () => { limpaContagens(); render(); });
    // Pokédex automática marcou um Pokémon (carta adicionada pelo preview).
    if (view === "pokedex") document.addEventListener("sleevu:dex-marked", () => render());
  }

  // Na página de uma série, troca o título "Sets" pelo nome da série e põe um
  // link de volta pra lista completa.
  function applySerieTitle() {
    const head = document.querySelector(".page-head");
    const h1 = head && head.querySelector("h1");
    if (!h1) return;
    h1.removeAttribute("data-i18n");
    h1.textContent = serieDisplayName(serieParam);
    // Desktop: "Jogos › Pokémon › Scarlet & Violet" no lugar do "← Sets", que
    // fica só pro celular (o CSS esconde um ou outro).
    trilhaDoJogo(h1.textContent);
    if (!head.querySelector(".serie-back")) {
      const back = document.createElement("a");
      back.className = "serie-back";
      back.href = telaDoJogo;
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
    trilhaDoJogo(t(lineDef.titleKey));
    if (!head.querySelector(".serie-back")) {
      const back = document.createElement("a");
      back.className = "serie-back";
      back.href = telaSemLinha;
      back.textContent = `← ${(window.SLEEVU && window.SLEEVU.name) || ""}`;
      // No PAI DO H1, não no .page-head: desde que o título dividiu a faixa com
      // a busca, o h1 vive dentro de .page-head-bar-text e não é mais filho
      // direto do .page-head. insertBefore com um nó que não é filho LANÇA, e a
      // exceção subia até o .catch() do boot — a página da série (e a da linha
      // vintage) ficava em branco com "não foi possível carregar o catálogo".
      h1.parentElement.insertBefore(back, h1);
    }
  }

  // Trilha de 3 níveis das vistas de série e de linha: Jogos › <jogo> › <aqui>.
  // O <jogo> leva pra lista completa de sets (/games/<jogo>, sem a linha), o
  // mesmo destino do "← <jogo>" que o celular continua vendo.
  function trilhaDoJogo(aqui) {
    const nome = (window.SLEEVU && window.SLEEVU.name) || "";
    if (nome) shared.setCrumbs([{ label: nome, href: telaSemLinha }, { label: aqui }]);
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
      // Pokédex: contagem capturados/total por geração ao lado do rótulo
      // (preenchida por refreshGenerationCounts, junto com o resumo).
      if (view === "pokedex") {
        const count = document.createElement("span");
        count.className = "chip-count";
        chip.appendChild(count);
      }
      elements.generationChips.appendChild(chip);
    });
  }

  function refreshGenerationCounts(progress) {
    if (!elements.generationChips || !progress) return;
    elements.generationChips.querySelectorAll(".chip").forEach((chip) => {
      const count = chip.querySelector(".chip-count");
      if (!count) return;
      const g = chip.dataset.generation;
      const p = g ? progress.gen[g] : progress;
      count.textContent = p ? `${p.c}/${p.t}` : "";
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
    [elements.typeFilter, elements.favFilter, elements.dexFilter, elements.setFilter, elements.languageFilter, elements.ownedFilter].filter(Boolean).forEach((element) => {
      element.addEventListener("input", applyFilters);
    });
    // "Já tenho" no card da Pokédex: o botão fica FORA do <a> (botão dentro de
    // link é HTML inválido e o clique navegaria). Atualiza o card no lugar —
    // re-renderizar a grade inteira faria os sprites piscarem — e o resumo.
    if (view === "pokedex") {
      elements.grid.addEventListener("click", (event) => {
        const button = event.target.closest("[data-dex-toggle]");
        if (!button) return;
        event.preventDefault();
        const article = button.closest(".pokedex-card");
        const dexId = article ? article.dataset.dexId : "";
        if (!dexId) return;
        dexOwned.toggle(dexId);
        const marked = dexOwned.has(dexId);
        button.setAttribute("aria-pressed", String(marked));
        button.textContent = dexHaveLabel(marked);
        article.classList.toggle("owned", marked || Number(article.dataset.ownedCount) > 0);
        updatePokedexStats();
      });
      // O botão "Marcar N como já tenho" (marcar em massa os Pokémon filtrados)
      // saiu em 2026-09-14: aparecia ao tocar num chip de geração e, no
      // celular, roubava a linha do título sem ninguém pedir por ele. O "já
      // tenho" continua carta a carta, no botão de cada card.
    }

    if (elements.setsViewToggle) {
      applySetsView(); // estado inicial (antes do primeiro render) a partir da pref salva
      elements.setsViewToggle.addEventListener("click", (event) => {
        const button = event.target.closest("[data-grid-view]");
        if (!button) return;
        setsView = button.dataset.gridView === "list" ? "list" : "grid";
        localStorage.setItem("tcg-sets-view", setsView);
        applySetsView();
        refineVisibleSets(); // na lista do celular o valor aparece: agora vale refinar
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
      // Na tela de Sets a origem tem DUAS caras (chips no desktop, <select> no
      // celular — sets.html); nos Treinadores só os chips. Os dois escrevem no
      // mesmo estado e um espelha o outro, senão trocar de largura mostraria
      // um controle desatualizado.
      const regionSelect = elements.setRegionChips.querySelector("[data-lang-region-select]");
      const setLangRegion = (region) => {
        selectedLangRegion = region;
        elements.setRegionChips.querySelectorAll("[data-lang-region]").forEach((node) => {
          node.setAttribute("aria-pressed", node.dataset.langRegion === region ? "true" : "false");
        });
        if (regionSelect && regionSelect.value !== region) regionSelect.value = region;
        applyFilters();
      };
      elements.setRegionChips.addEventListener("click", (event) => {
        const chip = event.target.closest("[data-lang-region]");
        if (chip) setLangRegion(chip.dataset.langRegion);
      });
      if (regionSelect) regionSelect.addEventListener("change", () => setLangRegion(regionSelect.value));
    }

    // O chunk do set é o maior item do caminho até a primeira carta, e hoje ele
    // só começa a baixar DEPOIS de: navegação -> HTML -> game.js -> manifest ->
    // shared/detail. O toque antecede a navegação em ~100-300ms; começar por
    // aqui adianta o chunk (e o irmão de preços) nesse intervalo. O SW guarda
    // no DATA_CACHE, então a página seguinte já encontra tudo pronto.
    const prefetchados = new Set();
    function prefetchChunk(card) {
      const file = card && card.dataset.chunk;
      if (!file || prefetchados.has(file)) return;
      prefetchados.add(file);
      [file, file.includes("/sets/") ? file.replace("/sets/", "/pricing-chunks/") : ""].forEach((url) => {
        if (!url) return;
        const l = document.createElement("link");
        l.rel = "prefetch";
        l.as = "fetch";
        l.href = url;
        document.head.appendChild(l);
      });
    }
    elements.grid.addEventListener("pointerdown", (event) => {
      const card = event.target.closest(".set-card");
      if (card) prefetchChunk(card);
    }, { passive: true });

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
      // "+N" dos produtos do lançamento: abre os chips que estavam guardados.
      const maisKids = event.target.closest("[data-kids-more]");
      if (maisKids) { maisKids.parentElement.classList.add("is-open"); return; }
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

  // Quantas cartas a coleção tem, UMA conta por render: o owned.size percorre a
  // coleção inteira e aloca dois arrays por carta, e a Vitrine (2026-10-08) o
  // lia em cada cartão de set — medido em Node, 12, 76 e 338 ms por página de
  // 60 cartões com 1, 5 e 20 mil cartas no jogo, e o boot faz ao menos três
  // renders. O pager desenha cartões depois do render (rolagem): vale o mesmo.
  let tamanhoDaColecao = null;
  function colecaoTem() {
    if (tamanhoDaColecao == null) tamanhoDaColecao = owned.size;
    return tamanhoDaColecao;
  }

  function render({ resetCount = false } = {}) {
    tamanhoDaColecao = null;
    // Pokédex não filtra cartas (roda por espécie via índices); as outras
    // visões partem das cartas visíveis após os filtros.
    // filterCards() varre o catálogo; sets e pokedex não têm catálogo carregado
    // (e não precisam) — passam direto.
    const items = view === "pokedex" ? pokedexViewItems()
      : getViewItems(manifestMode() ? [] : filterCards());
    pager.render(items, createViewItem, { resetCount }); // onAppend reaplica o recolhido
    if (view === "sets") { applyCollapsed(); refineVisibleSets(); }

    // Cabeçalhos de série não contam como resultado, nem o topo da Vitrine
    // (destaque e "Continue completando"): o Yu-Gi-Oh! dizia "595 resultados"
    // com 594 sets.
    const realCount = items.filter((item) => !/^(series-head|category-head|sx-hero|sx-continue)$/.test(item.type)).length;
    elements.empty.hidden = realCount > 0;
    elements.resultCount.textContent = tn("results.count", realCount);
    if (view === "pokedex") { updatePokedexStats(); return; }
    if (elements.ownedCount) elements.ownedCount.textContent = colecaoTem();
    if (elements.totalCount) elements.totalCount.textContent = totalCatalogCount;
    if (elements.completionRate) {
      elements.completionRate.textContent = totalCatalogCount ? `${Math.round((colecaoTem() / totalCatalogCount) * 100)}%` : "0%";
    }
  }

  // Resumo da Pokédex conta ESPÉCIES, não cartas: um Pokémon está "capturado"
  // se foi marcado como "já tenho" OU se há ao menos uma carta dele na coleção
  // (no idioma escolhido). É a progressão que a pessoa vê e coleciona.
  function pokemonCaptured(entry) {
    if (dexOwned.has(String(entry.dexId))) return true;
    return entry.cardIds.some((id) => owned.has(id) && langMatch(shared.cardLanguageFromId(id)));
  }
  function updatePokedexStats() {
    const entries = pokedexEntries();
    const progress = { c: 0, t: entries.length, gen: {} };
    entries.forEach((entry) => {
      const g = String(generationFromDexId(entry.dexId));
      const p = progress.gen[g] || (progress.gen[g] = { c: 0, t: 0 });
      p.t += 1;
      if (pokemonCaptured(entry)) { p.c += 1; progress.c += 1; }
    });
    const captured = progress.c;
    const pct = entries.length ? Math.round((captured / entries.length) * 100) : 0;
    if (elements.ownedCount) elements.ownedCount.textContent = captured;
    if (elements.totalCount) elements.totalCount.textContent = entries.length;
    if (elements.completionRate) elements.completionRate.textContent = `${pct}%`;
    if (elements.dexProgressFill) {
      elements.dexProgressFill.style.width = `${pct}%`;
      const bar = elements.dexProgressFill.parentElement;
      if (bar) bar.setAttribute("aria-valuenow", String(pct));
    }
    refreshGenerationCounts(progress);
    // Hub, medalhas e perfil público leem daqui (ver readDexProgress).
    if (entries.length) shared.writeDexProgress(progress);
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
      // Página de uma série (?serie=id): só os sets dela, sem cabeçalhos — e
      // sem os decks/caixas, que a lista mostra na seção deles (o "X sets →"
      // do cabeçalho da série não os conta).
      if (serieParam) return setItems.filter((set) => set.serieId === serieParam && set.kind !== "deck").sort(sortByReleaseDesc);
      // PADRÃO da página de Sets (2026-10-09), o mesmo em todo jogo e linha —
      // até aqui só o Pokémon e o Magic tinham: os produtos de um lançamento
      // (pré-release, promos, Commander, Trainer Gallery…) moram DENTRO do
      // cartão do set (aninhaPorNome); as seções são as do jogo
      // (agrupaSetsDoJogo); e a lista inteira — sem busca — ganha no topo o
      // lançamento em destaque e, pra quem tem coleção, os sets em andamento
      // (vitrineDoTopo). Regra escrita em docs/CATALOGO.md, 3.4.
      const grupos = agrupaSetsDoJogo(aninhaPorNome(setItems));
      return normalize(elements.search.value) ? grupos : vitrineDoTopo(grupos).concat(grupos);
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
    // O coração da Pokédex sincroniza entre aparelhos desde sempre — e nada
    // lia o store: os cliques não voltavam em forma de nada. Aqui eles viram
    // filtro. O store é de dexIds (o herói da espécie, não a carta).
    const soFavoritos = elements.favFilter && elements.favFilter.value === "fav";
    const favoritos = soFavoritos ? shared.createFavoritesStore() : null;
    // "Já tenho" / "Ainda faltam": pela captura (marcado OU com carta) — é o
    // mesmo critério do resumo e do contorno dourado do card.
    const dexValue = elements.dexFilter ? elements.dexFilter.value : "";

    return pokedexEntries()
      .filter((entry) => {
        if (favoritos && !favoritos.has(String(entry.dexId))) return false;
        if (dexValue && (dexValue === "have") !== pokemonCaptured(entry)) return false;
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
      // Carta bônus (shared.isBonusCard) não conta pro progresso do set.
      ids.forEach((id) => { if (owned.has(id) && !shared.isBonusCard(id)) n++; });
      ownedCountMemo.set(key, n);
    }
    return ownedCountMemo.get(key);
  }

  // Quantas cartas do set FALTAM nesta língua mas você tem em outra (EN↔PT,
  // JA↔chinês — shared.sameCardKey), com as línguas. Só com o "contar
  // qualquer idioma" (preferência global, a mesma do checkbox da página do
  // set; vem ligada). Soma no progresso do card e vira a parte âmbar da barra.
  const altCountMemo = new Map();
  let sameCardIdx = null;
  function entryAltOwned(entry) {
    if (!shared.getAnyLangProgress()) return { n: 0, langs: [] };
    const key = entryKey(entry);
    if (!altCountMemo.has(key)) altCountMemo.set(key, altOwnedOfIds(cardIdsByEntry.get(key) || []));
    return altCountMemo.get(key);
  }
  function altOwnedOfIds(ids) {
    if (!shared.getAnyLangProgress()) return { n: 0, langs: [] };
    if (!sameCardIdx) sameCardIdx = shared.ownedSameCardIndex(owned);
    const langs = new Set();
    let n = 0;
    ids.forEach((id) => {
      if (owned.has(id) || shared.isBonusCard(id)) return;
      const lingua = shared.otherLanguageOwned(sameCardIdx, owned, id, null);
      if (lingua) { n++; langs.add(lingua); }
    });
    return { n, langs: [...langs] };
  }
  // A coleção mudou: as duas contagens e o índice de línguas refazem.
  function limpaContagens() {
    ownedCountMemo.clear();
    altCountMemo.clear();
    sameCardIdx = null;
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

  // Valor EXATO de um set já refinado (chunk baixado): entra no lugar do
  // número do manifest, que não conhece preço manual seu.
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
      // Sem as cartas bônus: o `bonus` vem do build (setManifestMeta); manifest
      // de antes dele cai na contagem pelos ids do índice.
      totalCount: entry.count - (entry.bonus != null ? entry.bonus : (cardIdsByEntry.get(key) || []).filter((id) => shared.isBonusCard(id)).length),
      ownedCount: entryOwnedCount(entry),
      alt: entryAltOwned(entry),
      officialTotal: entry.total || entry.count,
      value: refined ? refined.value : entryRefValue(entry),
      logo: entry.logo || "",
      displayName: shared.setDisplayName(entry.id, entry.name, entry.language),
      symbol: entry.symbol || "",
      releaseDate: entry.release || "",
      // Tendência agregada do set (scripts/build-set-trends.mjs). Ausente
      // quando o set tem poucas cartas com cotação ou a variação é ruído.
      dv7: entry.dv7, dv30: entry.dv30, dvn: entry.dvn,
      serieId,
      serieName: shared.setSerieDisplayName(entry.serieName, entry.language) || serieDisplayName(serieId),
      // "deck" = deck/kit/caixa (hoje só os do chinês simplificado): vai pra
      // seção própria no fim da lista, fora das séries (ver groupSetsBySeries).
      kind: entry.kind || "",
      languageLabel: shared.cardLangSigla(entry.language),
      // Região de idioma DESTA edição (não a do chip): é ela que vai no link
      // quando o link precisa dizer qual edição abrir — ver setDetailUrl.
      langRegion: shared.cardLanguageRegion(entry.language),
      // Caminho do chunk deste set: usado pra prefetch no toque (ver createSetCard).
      chunkFile: entry.file || ""
    };
  }

  // Busca da tela de Sets filtra SETS (nome, sigla do id e série) — procurar
  // CARTA é papel do Buscar/Explorar. Antes ela varria as cartas do jogo
  // inteiro, o que só era possível porque a página baixava tudo.
  function entryMatchesQuery(entry, query) {
    if (!query) return true;
    return normalize(`${entry.name} ${shared.setDisplayName(entry.id, entry.name, entry.language)} ${entry.id} ${entry.serieName || ""}`).includes(query);
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
    // `retired`: chunk CONGELADO de set aposentado (sobra sem par, ver
    // retire-imported-sets) — o id resolve, o set não é listado.
    return manifest.sets
      .filter((entry) => !entry.retired
        && (!porRegiao || shared.cardLanguageRegion(entry.language) === selectedLangRegion)
        && lineScope.includes(entry.id)
        && entryMatchesQuery(entry, query))
      .map(toManifestSetItem)
      .sort(sortByName);
  }

  // Valor exato dos sets VISÍVEIS que têm carta com PREÇO MANUAL seu — o único
  // número que ainda precisa das cartas (o do manifest é o de mercado; o preço
  // manual seu ele não conhece). Roda depois do paint, um chunk por set, e troca
  // só o texto do valor no cartão (pintaValor). Até 2026-10-08 refinava TODO set
  // com carta sua — chunk e preço de cada um, em série — e redesenhava a grade
  // inteira a cada leva, inclusive no celular, onde o valor nem aparece.
  const refining = new Set();
  function idsComPrecoManual() {
    const ids = new Set();
    Object.entries(prices.toObject()).forEach(([id, porVariante]) => {
      if (Object.values(porVariante || {}).some((e) => e && e.prices && Object.values(e.prices).some((v) => v > 0))) ids.add(id);
    });
    return ids;
  }
  // O valor some no modo colecionador e na GRADE do celular (ver .set-value no
  // @media ≤720px do styles.css); a lista (≣) mostra.
  function valorAparece() {
    if (document.documentElement.hasAttribute("data-collector-mode")) return false;
    return !(window.matchMedia && window.matchMedia("(max-width: 720px)").matches && !elements.grid.classList.contains("is-list"));
  }
  function pintaValor(key, value) {
    elements.grid.querySelectorAll(".set-card").forEach((node) => {
      if (node.dataset.entryKey !== key) return;
      let span = node.querySelector(".set-value");
      const pe = node.querySelector(".set-footer");
      if (!(value > 0) || !pe) { if (span) span.remove(); return; }
      if (!span) {
        span = document.createElement("span");
        span.className = "set-value";
        pe.insertBefore(span, pe.querySelector(".set-date-list")); // o mesmo lugar do createSetCard
      }
      span.textContent = shared.formatMoney(shared.getCurrency(), value);
    });
  }
  async function refineVisibleSets() {
    if (!manifestMode() || !valorAparece()) return;
    const manuais = idsComPrecoManual();
    if (!manuais.size) return;
    const visiveis = new Set(Array.from(elements.grid.querySelectorAll(".set-card"))
      .map((node) => node.dataset.entryKey).filter(Boolean));
    const pendentes = manifest.sets.filter((entry) => {
      const key = entryKey(entry);
      return visiveis.has(key) && !refinedSets.has(key) && !refining.has(key)
        && (cardIdsByEntry.get(key) || []).some((id) => manuais.has(id));
    });
    pendentes.forEach((entry) => refining.add(entryKey(entry)));
    for (const entry of pendentes) {
      const key = entryKey(entry);
      try {
        const chunk = await shared.fetchSetChunks([entry]);
        const value = shared.sumCardsValue(chunk.filter((card) => !shared.isBonusCard(card)), prices).value;
        refinedSets.set(key, { value });
        pintaValor(key, value);
      } catch (error) {
        refining.delete(key); // rede caiu: tenta de novo no próximo render
      }
    }
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

  // Nomes — e IDS — de set que casam com mais de uma edição (setId × região) no
  // catálogo carregado. Só nesses o link precisa carregar ?region=; o resto
  // continua com a URL limpa de sempre. Calculado uma vez, depois da carga.
  let ambiguousSetNames = new Set();
  let ambiguousSetIds = new Set();
  function indexAmbiguousSetNames() {
    const byName = new Map();
    const byId = new Map();
    const add = (mapa, chave, key) => {
      if (!chave) return;
      if (!mapa.has(chave)) mapa.set(chave, new Set());
      mapa.get(chave).add(key);
    };
    const conta = (name, setId, language) => {
      const regiao = shared.cardLanguageRegion(language);
      add(byName, name, `${setId || ""}|${regiao}`);
      add(byId, setId, regiao);
    };
    if (manifestMode()) manifest.sets.forEach((entry) => conta(entry.name, entry.id, entry.language));
    else cards.forEach((card) => conta(card.set, card.setId, card.language));
    const ambiguos = (mapa) => new Set(Array.from(mapa).filter(([, keys]) => keys.size > 1).map(([chave]) => chave));
    ambiguousSetNames = ambiguos(byName);
    ambiguousSetIds = ambiguos(byId);
  }

  function setDetailUrl(item) {
    // O setId vai SEMPRE que existe: é o que deixa o detailUrl trocar o nome
    // não-ASCII pelo id na URL. Set de nome único não muda de comportamento
    // (uma edição só, o id não filtra nada); só o ambíguo carrega a região.
    //
    // E o que identifica o set na URL NEM SEMPRE é o nome: o de nome acentuado
    // ou japonês é descartado pelo detailUrl (setLinkDropsName) e sobra o id —
    // que a edição PT divide com a EN e a chinesa com a japonesa. Sem a região
    // aqui, "Coleção Clássica de 30 Anos" virava `?setId=30th-c` puro e o
    // detail abria a edição INGLESA, porque o en vem antes do pt no manifest
    // (20/09/2026). Vale pros 38 sets PT de nome acentuado e pros chineses.
    const peloId = shared.setLinkDropsName(item.name, item.setId);
    const ambiguo = peloId ? ambiguousSetIds.has(item.setId) : ambiguousSetNames.has(item.name);
    if (!ambiguo) return detailUrl("set", item.name, "", "", { setId: item.setId });
    // A região é a DO TILE, não a do chip: nos jogos sem chips (o chip só
    // existe no Pokémon) o selectedLangRegion fica parado em "english" e
    // carimbaria a região errada num set japonês.
    const region = item.langRegion || selectedLangRegion;
    return detailUrl("set", item.name, "", "", { setId: item.setId, region });
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

    if (item.type === "sx-hero") return createHero(item);
    if (item.type === "sx-continue") return createContinue(item);

    return createGroupCard(item);
  }

  // Cabeçalho de série na grade de Sets (ocupa a linha toda); clicável → abre a
  // página daquela série (sets.html?serie=id).
  function createSeriesHead(item) {
    // O nome (com seta) recolhe/expande a série; o "X sets →" navega pra sub-página.
    const head = document.createElement("div");
    head.className = "set-series-head";
    head.dataset.cat = item.name;
    head.innerHTML = `<button type="button" class="cat-toggle" aria-expanded="${!isCategoryCollapsed(item.name)}"><span class="cat-caret" aria-hidden="true">▾</span><span class="set-series-name">${escapeHtml(item.name)}</span></button><a class="set-series-count" href="${escapeAttribute(telaDoJogo)}?serie=${escapeAttribute(item.serieId)}">${item.count} sets →</a>`;
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
    head.innerHTML = `<span class="set-series-name"><span class="cat-caret" aria-hidden="true">▾</span>${escapeHtml(item.name)}</span><span class="set-series-count">${item.count} ${item.count === 1 ? "set" : "sets"}</span>`;
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
    // Contorno dourado quando o Pokémon está capturado: marcado como "já tenho"
    // ou com ao menos uma carta dele na coleção (feedback rápido pra quem está
    // completando a Pokédex).
    article.className = `pokedex-card${item.ownedCount > 0 || item.dexMarked ? " owned" : ""}`;
    article.dataset.dexId = String(item.dexId || "");
    article.dataset.ownedCount = String(item.ownedCount || 0);
    const image = item.image
      ? `<img loading="lazy" src="${escapeAttribute(item.image)}" alt="${escapeAttribute(item.name)}">`
      : `<span class="image-placeholder">${escapeHtml(t("card.noImage"))}</span>`;

    // Rodapé só com "1/106 cartas" (2026-09-14): a barra de progresso e a
    // porcentagem saíram — na Pokédex ninguém completa as 106 cartas de um
    // Pokémon, então a barra vivia quase vazia e o "0%" só desanimava. O
    // número tenho/total é o que a pessoa lê de verdade.
    article.innerHTML = `
      <a class="pokedex-link" href="${escapeAttribute(detailUrl("pokemon", item.name))}">
        <div class="pokedex-number">#${String(item.dexId || "?").padStart(4, "0")}</div>
        <div class="pokedex-image">${image}</div>
        <div class="pokedex-info">
          <h3 title="${escapeAttribute(item.name)}">${escapeHtml(item.name)}</h3>
          <p>${escapeHtml(t("card.generation", { g: item.generation || "-" }))}</p>
        </div>
        <div class="set-footer">
          <span class="set-count">${escapeHtml(t("count.ofCards", { o: item.ownedCount, t: item.totalCount }))}</span>
        </div>
      </a>
      <button type="button" class="dex-have-button" data-dex-toggle aria-pressed="${item.dexMarked ? "true" : "false"}" aria-label="${escapeAttribute(t("dex.haveAria", { name: item.name }))}">${escapeHtml(dexHaveLabel(item.dexMarked))}</button>
    `;

    return article;
  }

  function dexHaveLabel(marked) {
    return marked ? t("dex.haveActive") : t("dex.have");
  }

  // Cápsula compacta e clicável (estilo Pokédex): abre a página do grupo com
  // as cartas filtradas — sem listar todas as cartas aqui dentro.
  function createGroupCard(item) {
    const link = document.createElement("a");
    // 100%: o mesmo dourado da Pokédex, agora pro grupo COMPLETO — por
    // contagem exata, não pelo % arredondado (149/150 mostra 99→100%).
    link.className = `group-card${item.totalCount > 0 && item.ownedCount >= item.totalCount ? " complete" : ""}`;
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
    // 100%: contorno + barra dourados (o realce que a Pokédex já tinha).
    // Cartas que faltam nesta língua mas você tem em outra (item.alt, ver
    // entryAltOwned) SOMAM no progresso — é o set de quem mistura EN e PT — e
    // aparecem como a parte hachurada âmbar da barra, com o "+N EN" do lado.
    const altN = item.alt ? item.alt.n : 0;
    const tenho = item.ownedCount + altN;
    article.className = `set-card${item.totalCount > 0 && tenho >= item.totalCount ? " complete" : ""}`;
    article.dataset.href = setDetailUrl(item);
    if (item.entryKey) article.dataset.entryKey = item.entryKey;
    if (item.chunkFile) article.dataset.chunk = item.chunkFile;
    const progress = item.totalCount ? Math.round((tenho / item.totalCount) * 100) : 0;
    const progressAqui = item.totalCount ? Math.round((item.ownedCount / item.totalCount) * 100) : 0;
    const siglasAlt = altN ? item.alt.langs.map((code) => shared.cardLangSigla(code)).join("/") : "";
    const altHtml = altN
      ? `<span class="set-alt-lang" title="${escapeAttribute(t("set.altLangHint", { n: altN, lang: item.alt.langs.map((code) => shared.cardLanguageLabel(code)).join(" / ") }))}">+${altN} ${escapeHtml(siglasAlt)}</span>`
      : "";
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

    // Tendência do set: prefere a semana (é a leitura que interessa a quem
    // acompanha) e cai pro mês quando o histórico ainda não tem 7 dias. Some
    // quando não há chip — set pequeno ou variação abaixo do ruído.
    const dv = item.dv7 != null ? item.dv7 : item.dv30;
    const dvDias = item.dv7 != null ? 7 : 30;
    const trendChip = dv != null
      ? `<span class="set-trend ${dv >= 0 ? "is-up" : "is-down"}" title="${escapeAttribute(t("trend.title", { d: dvDias, n: item.dvn || 0 }))}">${escapeHtml(`${dv >= 0 ? "▲" : "▼"} ${Math.abs(dv).toLocaleString(shared.getLocale(), { maximumFractionDigits: 1 })}%`)}</span>`
      : "";

    // Layout COMPACTO (estilo Collectr): logo, nome, uma linha de progresso
    // (possuídas/total + %) e o valor só quando houver. O "%" fica num <span>
    // próprio porque no CELULAR ele some junto com a barra, a tendência e o
    // valor (pedido de 2026-09-14: só a contagem, centralizada — ver
    // .set-card no @media ≤700px do styles.css). O card inteiro navega
    // (handler na grade); a arte segue como <a> pra middle-click/acessibilidade.
    // O custo pra completar ("Faltam N · completar V") NÃO aparece no tile —
    // aqui a barra de progresso já conta a história; o detalhe fica na página
    // do set (detail.js), pra quem clicar.
    const valueHtml = item.value > 0
      ? `<span class="set-value">${escapeHtml(shared.formatMoney(shared.getCurrency(), item.value))}</span>`
      : "";
    // Vitrine (2026-10-08): quem não tem carta NENHUMA no jogo via "0/158 ·
    // 0%" em todo cartão — ruído, não progresso. Aí vale o tamanho do set.
    const semColecao = !colecaoTem();
    // Produtos do mesmo lançamento (Commander, Promos, Trainer Gallery…), que
    // agora moram dentro do cartão do set: um chip por produto. À vista vão 4
    // no desktop e 2 no celular (CSS); o "+N" abre o resto — o N de cada
    // largura vem pronto em dois <span>, e o CSS mostra o certo.
    // Um chip por NOME: o catálogo tem Trainer Gallery em dobro (swsh10tg e
    // swsh10.5tg, mesmo nome, data e 30 cartas; idem 9, 11 e 12 — visto em
    // 08/10/2026), e "Trainer Gallery | Trainer Gallery" no cartão só confundia.
    const vistos = new Set();
    const filhos = (item.filhos || []).filter((f) => !vistos.has(f.displayName) && vistos.add(f.displayName));
    const maisKids =filhos.length > 2
      ? `<button type="button" class="sx-kid sx-kid-more${filhos.length <= 4 ? " sx-so-cel" : ""}" data-kids-more aria-label="${escapeAttribute(t("sets.sx.moreProducts"))}"><span class="sx-n-cel">+${filhos.length - 2}</span><span class="sx-n-desk">+${filhos.length - 4}</span></button>`
      : "";
    const kidsHtml = filhos.length
      ? `<div class="sx-kids">${filhos.map((f) => `<a class="sx-kid" href="${escapeAttribute(setDetailUrl(f))}" title="${escapeAttribute(`${f.displayName} · ${tn("count.cards", f.totalCount)}`)}">${escapeHtml(f.rotulo || f.displayName)}</a>`).join("")}${maisKids}</div>`
      : "";
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
        ${semColecao ? "" : `<div class="progress-bar${altN ? " has-alt" : ""}" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeAttribute(t("progress.aria", { name: item.name }))}">
          <span style="width: ${progressAqui}%"></span>${altN ? `<span class="progress-alt" style="width: ${progress - progressAqui}%"></span>` : ""}
        </div>`}
        <div class="set-footer">
          ${semColecao
            ? `<span class="set-count">${escapeHtml(tn("count.cards", item.totalCount))}</span>`
            : `<span class="set-count">${tenho}/${item.totalCount}<span class="set-pct"> · ${progress}%</span></span>`}
          ${altHtml}
          ${trendChip}
          ${valueHtml}
          ${item.releaseDate ? `<span class="set-date-list" title="${escapeAttribute(formatReleaseDate(item.releaseDate, "long"))}">${escapeHtml(formatReleaseDate(item.releaseDate))}</span>` : ""}
        </div>
        ${kidsHtml}
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

  function toSetItem(group) {
    const sortedCards = group.cards.slice().sort((a, b) => shared.compareCardNumbers(a.number, b.number));
    const sample = sortedCards[0] || {};
    const serieId = sample.setSerieId || deriveSerieId(sample.setId);
    // Chave do memo = EDIÇÃO (setId + região), não o nome: com sets homônimos o
    // nome fazia o segundo devolver o valor já calculado do primeiro.
    const memoKey = `${sample.setId || group.name}|${selectedLangRegion}`;
    // Progresso e valor do "set completo" sem as cartas bônus.
    const contaveis = sortedCards.filter((card) => !shared.isBonusCard(card));
    return {
      type: "set",
      name: group.name,
      setId: sample.setId || "",
      cards: sortedCards,
      totalCount: contaveis.length,
      ownedCount: contaveis.filter((card) => owned.has(card.id)).length,
      alt: altOwnedOfIds(contaveis.map((card) => card.id)),
      officialTotal: sample.setTotal || contaveis.length,
      value: memoSetValue(memoKey, contaveis),
      logo: sample.setLogo || "",
      // Nome de EXIBIÇÃO: tradução em inglês nos vintages japoneses, original no
      // resto. `name` (acima) continua sendo o original — é a chave de link,
      // busca e agrupamento; só o que aparece na tela muda.
      displayName: shared.setDisplayName(sample.setId, group.name, sample.language),
      symbol: sample.setSymbol || "",
      releaseDate: sample.setReleaseDate || "",
      serieId,
      serieName: shared.setSerieDisplayName(sample.setSerieName, sample.language) || serieDisplayName(serieId),
      kind: sample.setKind || "",
      languageLabel: unique(sortedCards.map((card) => shared.cardLangSigla(card.language))).join("/"),
      langRegion: shared.cardLanguageRegion(sample.language)
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
    // As séries são as do POKÉMON. Nos outros jogos o prefixo casava por acaso
    // e inventava série (medido em 08/10/2026): 19 "Duelist Pack" do Yu-Gi-Oh
    // viravam "Diamond & Pearl", "neo" do Magic virava "Neo", 13 sets do
    // Digimon viravam "EX".
    if (!isPokemonGame()) return "misc";
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
  // Decks, kits e caixas (`kind: "deck"`) saem das séries e vão pra uma seção
  // única no FIM: no chinês simplificado são 55 deles contra 27 expansões, e
  // as expansões sumiam no meio (pedido do Fernando, 28/09/2026).
  function groupSetsBySeries(setItems) {
    const decks = setItems.filter((set) => set.kind === "deck").sort(sortByReleaseDesc);
    const bySerie = new Map();
    // Trainer Gallery, Galarian Gallery, Shiny Vault e Energy já chegam DENTRO
    // do set de que fazem parte (chips no cartão) — ver aninhaPorNome.
    setItems.filter((set) => set.kind !== "deck").forEach((set) => {
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
    if (decks.length) {
      items.push(cabecalhoDeSecao("sets.category.decksBoxes", decks.length));
      decks.forEach((set) => items.push(set));
    }
    return items;
  }

  // As seções de cada jogo (2026-10-09: um lugar só, antes eram 15 `return`
  // no getViewItems). Recebe as RAÍZES do aninhaPorNome. Jogo sem agrupamento
  // próprio vai por ano (Yu-Gi-Oh!, Digimon, FAB, Gundam…).
  function agrupaSetsDoJogo(raizes) {
    // Linha vintage (?line=): do mais antigo pro mais novo, como checklist. O
    // Data Carddass do Naruto junta os quatro títulos do arcade, um por seção.
    if (lineScope.line === "nrt-dc") return groupNarutoDataCarddass(raizes);
    if (lineDef) return raizes.sort(sortByReleaseAsc);
    if (isPokemonGame()) return groupSetsBySeries(raizes);
    const porJogo = {
      magic: groupMagicSets,
      // Lorcana não tem séries: Principais + Promos.
      lorcana: groupLorcanaSets,
      // One Piece: Boosters (OP01…) + Starter Decks (ST-…) + o resto.
      onepiece: groupOnePieceSets,
      naruto: groupNarutoSets,
      hxh: groupHxhSets,
      dbc: groupDbcSets,
      swu: groupSwuSets,
      cyberpunk: groupCyberpunkSets,
      sorcery: groupSorcerySets,
      wow: groupWowSets,
      lotr: groupLotrSets,
      weiss: groupWeissSets,
      mbc: groupMbcSets,
      harrypotter: groupHarryPotterSets
    };
    return (porJogo[jogoAtual] || groupSetsByYear)(raizes);
  }

  // Cabeçalho de seção da página de Sets. Promo, deck, raid e coleção avulsa
  // ficam FORA do destaque do topo (vitrineDoTopo): o lançamento em destaque
  // é sempre um set principal — sem isto, o starter deck ou a caixa de promo
  // mais nova do One Piece/Cyberpunk/WoW roubava o lugar do booster.
  const SECOES_FORA_DO_DESTAQUE = ["sets.category.promos", "sets.category.decks", "sets.category.decksBoxes", "sets.category.wowRaids", "sets.category.mtgSpecial"];
  function cabecalhoDeSecao(key, count) {
    return { type: "category-head", name: t(key), count, foraDoDestaque: SECOES_FORA_DO_DESTAQUE.includes(key) };
  }

  // ── Topo da Vitrine (2026-10-08) ─────────────────────────────────────────
  // O padrão que a pesquisa de concorrentes achou (TCGplayer, Pokellector,
  // pkmn.gg, TCG Collector): o set mais novo em destaque e o que vem por aí.
  // Destaque = o set principal mais novo já lançado (sem promo, deck, energia
  // ou coleção do McDonald's; fora das seções de promo/deck/raid/eventos — ver
  // cabecalhoDeSecao). Ao lado, até dois "Em breve" (lançamento no futuro) e,
  // se faltar, os outros lançamentos recentes. Pra quem tem carta no jogo,
  // "Continue completando": os sets começados e não completos, do mais perto
  // do fim pro mais longe.
  // Jogo que parou (vintage, ou sem set novo há mais de um ano): o destaque
  // é o "Último set", e os do lado são "Anteriores" — "Lançamento" e
  // "Também recentes" num set de 2002 seriam mentira.
  const NAO_DESTAQUE = /promo|mcdonald|energy|trainer kit|black star/i;
  function vitrineDoTopo(grupos) {
    const hoje = new Date().toISOString().slice(0, 10);
    const sets = [];
    let foraDoDestaque = false;
    grupos.forEach((item) => {
      if (item.type === "category-head" || item.type === "series-head") foraDoDestaque = !!item.foraDoDestaque;
      else if (item.type === "set" && !foraDoDestaque && item.kind !== "deck" && !NAO_DESTAQUE.test(item.name) && item.releaseDate) sets.push(item);
    });
    const lancados = sets.filter((set) => set.releaseDate <= hoje).sort(sortByReleaseDesc);
    const futuros = sets.filter((set) => set.releaseDate > hoje).sort(sortByReleaseAsc);
    const items = [];
    if (lancados.length) {
      const lado = futuros.slice(0, 2);
      const emBreve = lado.length > 0;
      lancados.slice(1).forEach((set) => { if (lado.length < 2) lado.push(set); });
      const parado = !emBreve && Date.parse(hoje) - Date.parse(lancados[0].releaseDate) > 365 * 86400000;
      items.push({ type: "sx-hero", set: lancados[0], lado, emBreve, parado, hoje });
    }
    if (colecaoTem()) {
      const todos = [];
      grupos.forEach((item) => { if (item.type === "set") { todos.push(item); (item.filhos || []).forEach((f) => todos.push(f)); } });
      const andamento = todos.filter((set) => set.totalCount > 0 && set.ownedCount > 0 && set.ownedCount < set.totalCount)
        .sort((a, b) => b.ownedCount / b.totalCount - a.ownedCount / a.totalCount || sortByReleaseDesc(a, b)).slice(0, 6);
      if (andamento.length) items.push({ type: "sx-continue", sets: andamento });
    }
    return items;
  }

  // Arte do set no tamanho pedido: logo, ou o nome em título quando o set não
  // tem logo (a regra de todos os jogos).
  function arteDoSet(set, className) {
    return set.logo
      ? localizedImg(set.logo, { alt: set.displayName, className, loading: "lazy", fallback: gameLogoUrl(jogoAtual) })
      : `<span class="sx-nologo">${escapeHtml(set.displayName)}</span>`;
  }
  // Barra + "n/total" do set (com as cartas em outra língua somando, como no
  // cartão da grade).
  function progressoDoSet(set) {
    const tenho = set.ownedCount + (set.alt ? set.alt.n : 0);
    const pct = set.totalCount ? Math.min(100, Math.round((tenho / set.totalCount) * 100)) : 0;
    return `<span class="sx-prog"><span class="sx-bar"><span style="width:${pct}%"></span></span><span class="sx-prog-n"><b>${tenho}/${set.totalCount}</b> · ${pct}%</span></span>`;
  }
  function createHero(item) {
    const set = item.set;
    const node = document.createElement("section");
    node.className = "sx-hero";
    const dv = set.dv7 != null ? set.dv7 : set.dv30;
    const meta = [tn("count.cards", set.totalCount)];
    if (set.value > 0) meta.push(`<span class="sx-money">${escapeHtml(shared.formatMoney(shared.getCurrency(), set.value))}</span>`);
    const trend = dv != null
      ? `<span class="sx-trend ${dv >= 0 ? "is-up" : "is-down"}">${dv >= 0 ? "▲" : "▼"} ${escapeHtml(Math.abs(dv).toLocaleString(shared.getLocale(), { maximumFractionDigits: 1 }))}% <small>${escapeHtml(t("sets.sx.inDays", { d: set.dv7 != null ? 7 : 30 }))}</small></span>`
      : "";
    const mini = (s) => `<a class="sx-mini" href="${escapeAttribute(setDetailUrl(s))}">
        <span class="sx-mini-art">${arteDoSet(s, "sx-mini-logo")}</span>
        <span class="sx-mini-info"><strong>${escapeHtml(s.displayName)}</strong><span>${escapeHtml(s.releaseDate > item.hoje ? t("sets.sx.releases", { date: formatReleaseDate(s.releaseDate, "long") }) : formatReleaseDate(s.releaseDate, "long"))}</span></span></a>`;
    node.innerHTML = `
      <a class="sx-hero-main" href="${escapeAttribute(setDetailUrl(set))}">
        <span class="sx-hero-art">${arteDoSet(set, "sx-hero-logo")}</span>
        <span class="sx-hero-info">
          <span class="sx-eyebrow">${escapeHtml(t(item.parado ? "sets.sx.last" : "sets.sx.latest"))} · ${escapeHtml(formatReleaseDate(set.releaseDate, "long"))}</span>
          <strong class="sx-hero-name">${escapeHtml(set.displayName)}</strong>
          <span class="sx-hero-meta">${meta.join(" · ")}${trend ? ` · ${trend}` : ""}</span>
          ${colecaoTem() ? progressoDoSet(set) : ""}
          <span class="sx-hero-cta">${escapeHtml(t("sets.sx.open"))}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg></span>
        </span>
      </a>
      ${item.lado.length ? `<div class="sx-hero-side${item.emBreve ? "" : " sx-so-desk"}">
        <p class="sx-eyebrow">${escapeHtml(t(item.emBreve ? "sets.sx.soon" : item.parado ? "sets.sx.earlier" : "sets.sx.recent"))}</p>
        ${item.lado.map(mini).join("")}
      </div>` : ""}`;
    return node;
  }
  function createContinue(item) {
    const node = document.createElement("section");
    node.className = "sx-cont";
    node.innerHTML = `<h2 class="sx-cont-title">${escapeHtml(t("sets.sx.continue"))}</h2>
      <div class="sx-cont-rail">${item.sets.map((s) => `<a class="sx-mini sx-mini-prog" href="${escapeAttribute(setDetailUrl(s))}">
        <span class="sx-mini-art">${arteDoSet(s, "sx-mini-logo")}</span>
        <span class="sx-mini-info"><strong>${escapeHtml(s.displayName)}</strong>${progressoDoSet(s)}</span></a>`).join("")}</div>`;
    return node;
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
      items.push(cabecalhoDeSecao("sets.category.main", main.length));
      main.forEach((set) => items.push(set));
    }
    if (promos.length) {
      items.push(cabecalhoDeSecao("sets.category.promos", promos.length));
      promos.forEach((set) => items.push(set));
    }
    return items;
  }

  // Star Wars: Unlimited: expansões (Spark of Rebellion, Homeworlds, Twin
  // Suns…) e o resto — Weekly Play, Judge, convenção, campeonato, Gift Box,
  // Gamegenic. A TCGCSV não marca o tipo do grupo e os códigos não seguem
  // padrão (SOR, TS26, P26…), então quem decide é o NOME: todo grupo de promo
  // tem uma destas palavras (conferido nos 33 grupos em 30/09/2026). Sem isto
  // as 19 promos ficavam misturadas às 11 expansões num "Outros" só.
  function groupSwuSets(setItems) {
    const isPromo = (set) => /promo|exclusive|championship|gift box|weekly play/i.test(String(set.name || ""));
    const main = setItems.filter((set) => !isPromo(set)).sort(sortByReleaseDesc);
    const promos = setItems.filter(isPromo).sort(sortByReleaseDesc);
    const items = [];
    if (main.length) {
      items.push(cabecalhoDeSecao("sets.category.main", main.length));
      main.forEach((set) => items.push(set));
    }
    if (promos.length) {
      items.push(cabecalhoDeSecao("sets.category.promos", promos.length));
      promos.forEach((set) => items.push(set));
    }
    return items;
  }

  // Sorcery: Contested Realm: as edições (Alpha, Beta, Arthurian Legends,
  // Gothic e o mini set Dragonlord) e os promos. Pelo NOME: os três grupos de
  // promo da TCGCSV têm "Promo" no nome (Dust Reward, Arthurian Legends Promo,
  // Welcome Kit; conferido nos 8 grupos em 01/10/2026), e assim a próxima
  // edição já cai em "Principais".
  function groupSorcerySets(setItems) {
    const isPromo = (set) => /promo/i.test(String(set.name || ""));
    const grupos = [
      ["sets.category.main", setItems.filter((set) => !isPromo(set))],
      ["sets.category.promos", setItems.filter(isPromo)]
    ];
    const items = [];
    for (const [key, sets] of grupos) {
      if (!sets.length) continue;
      items.push(cabecalhoDeSecao(key, sets.length));
      sets.sort(sortByReleaseDesc).forEach((set) => items.push(set));
    }
    return items;
  }

  // Cyberpunk TCG: coleção (Welcome to Night City, nas edições Beta e Retail),
  // Starter Decks e o resto — box toppers, promos, pré-release e os prêmios
  // de torneio por temporada. Pelo NOME, como no Star Wars: a TCGCSV não marca
  // o tipo do grupo (conferido nos 13 grupos em 30/09/2026), e assim a
  // coleção seguinte já cai em "Principais" sem mexer aqui.
  function groupCyberpunkSets(setItems) {
    const nome = (set) => String(set.name || "");
    const isDeck = (set) => /starter deck/i.test(nome(set));
    const isPromo = (set) => !isDeck(set) && /promo|topper|pre-release|season|kit/i.test(nome(set));
    const grupos = [
      ["sets.category.main", setItems.filter((set) => !isDeck(set) && !isPromo(set))],
      ["sets.category.decks", setItems.filter(isDeck)],
      ["sets.category.promos", setItems.filter(isPromo)]
    ];
    const items = [];
    for (const [key, sets] of grupos) {
      if (!sets.length) continue;
      items.push(cabecalhoDeSecao(key, sets.length));
      sets.sort(sortByReleaseDesc).forEach((set) => items.push(set));
    }
    return items;
  }

  // World of Warcraft TCG: expansões (boosters), raids e dungeons (o deck do
  // raid e o baú de tesouro, setId "-T"), decks e o resto (loot, crafting,
  // promos de evento e de Collector's Edition). Pelo setId, que o sync-wow.mjs
  // FIXA por grupo da TCGCSV; grupo novo sem pin ("G<groupId>") cai no fim.
  // Do mais antigo pro mais novo, como as linhas vintage.
  function groupWowSets(setItems) {
    const idOf = (set) => String(set.setId || "").toUpperCase();
    const MAIN = /^(HOA|TDP|FOO|MOL|SOB|HFI|DOW|BOG|FOH|SCW|WG|ICE|WB|WOE|TOD|TOT|TWK)$/;
    const RAID = /^(ONY|MC|MAG|BT|NAX|ICC|DT)(-T)?$/;
    const DECK = /^(CSD|DKS|DOWS)$/;
    const isMain = (set) => MAIN.test(idOf(set));
    const isRaid = (set) => RAID.test(idOf(set));
    const isDeck = (set) => DECK.test(idOf(set));
    const grupos = [
      ["sets.category.main", setItems.filter(isMain)],
      ["sets.category.wowRaids", setItems.filter(isRaid)],
      ["sets.category.decks", setItems.filter(isDeck)],
      ["sets.category.promos", setItems.filter((set) => !isMain(set) && !isRaid(set) && !isDeck(set))]
    ];
    const items = [];
    for (const [key, sets] of grupos) {
      if (!sets.length) continue;
      items.push(cabecalhoDeSecao(key, sets.length));
      sets.sort(sortByReleaseAsc).forEach((set) => items.push(set));
    }
    return items;
  }

  // Weiß Schwarz: um set por anime, então a divisão é pelo TIPO de produto,
  // que o código impresso diz (o setId que o sync-weiss.mjs fixa): Extra
  // Booster (WE/SE/WXE), Power Up Set (SP/WP), Chronicle Set (SC, ou o "-RE" do
  // Fairy Tail, que reimprime com o código antigo) e os dois grupos que
  // misturam séries (PR e EVENT). O resto são os boosters. Do mais novo pro
  // mais antigo: o jogo está ativo, com set novo todo mês.
  function groupWeissSets(setItems) {
    const idOf = (set) => String(set.setId || "").toUpperCase();
    const isPromo = (set) => /^(PR|EVENT)$/.test(idOf(set));
    const isExtra = (set) => /-(WE|SE|WXE|SP|WP|SC)\d+$|-RE$/.test(idOf(set));
    const grupos = [
      ["sets.category.main", setItems.filter((set) => !isPromo(set) && !isExtra(set))],
      ["sets.category.wsExtra", setItems.filter(isExtra)],
      ["sets.category.promos", setItems.filter(isPromo)]
    ];
    const items = [];
    for (const [key, sets] of grupos) {
      if (!sets.length) continue;
      items.push(cabecalhoDeSecao(key, sets.length));
      sets.sort(sortByReleaseDesc).forEach((set) => items.push(set));
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
      items.push(cabecalhoDeSecao("sets.category.main", main.length));
      main.forEach((set) => items.push(set));
    }
    if (decks.length) {
      items.push(cabecalhoDeSecao("sets.category.decks", decks.length));
      decks.forEach((set) => items.push(set));
    }
    if (promos.length) {
      items.push(cabecalhoDeSecao("sets.category.promos", promos.length));
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
      items.push(cabecalhoDeSecao("sets.category.main", main.length));
      main.forEach((set) => items.push(set));
    }
    if (extras.length) {
      items.push(cabecalhoDeSecao("sets.category.promos", extras.length));
      extras.forEach((set) => items.push(set));
    }
    return items;
  }

  // Naruto Data Carddass (?line=nrt-dc): o arcade teve quatro títulos em
  // sequência, cada um com máquina, regras e numeração próprias — uma seção por
  // título, do mais antigo pro mais novo, como as séries do Dragon Ball
  // Carddass. O título sai do setId: Formation é nrt-nf-*, Cross é nrt-nx-*, e
  // Card Battle e Mission dividem o nrt-dc- (mesma fonte). A checklist desses
  // dois é fechada e a Mission começa no set 11 (PAGES do
  // sync-naruto-datacarddass.mjs). Sem as seções, a ordem por data jogava
  // Formation e Cross (com data) na frente de Card Battle e Mission (sem data).
  function groupNarutoDataCarddass(setItems) {
    const idOf = (set) => String(set.setId || "").trim().toLowerCase();
    const TITLES = [
      ["sets.category.dcnrCardBattle", (id) => /^nrt-dc-s(0[1-9]|10)$/.test(id)],
      ["sets.category.dcnrMission", (id) => id.startsWith("nrt-dc-")],
      ["sets.category.dcnrFormation", (id) => id.startsWith("nrt-nf-")],
      ["sets.category.dcnrCross", (id) => id.startsWith("nrt-nx-")]
    ];
    // A PRIMEIRA que casa leva o set (Card Battle antes da Mission).
    const titleOf = (set) => TITLES.findIndex(([, match]) => match(idOf(set)));
    const items = [];
    const section = (list, key) => {
      if (!list.length) return;
      items.push(cabecalhoDeSecao(key, list.length));
      list.sort(sortByReleaseAsc).forEach((set) => items.push(set));
    };
    TITLES.forEach(([key], i) => section(setItems.filter((s) => titleOf(s) === i), key));
    // Rede de segurança: prefixo novo na linha (GAME_LINES) sem título aqui
    // ainda aparece, em vez de sumir da página.
    section(setItems.filter((s) => titleOf(s) < 0), "sets.category.promos");
    return items;
  }

  // Hunter × Hunter (principal = Carddass Hyper Battle): as 6 partes numeradas
  // primeiro, em ordem CRESCENTE — é uma série linear, lê-se como checklist —,
  // e depois as promos (Jump Festa, Game Boy). O Miracle Battle, que foi linha
  // daqui até 2026-10-01, é o jogo mbc (groupMbcSets).
  function groupHxhSets(setItems) {
    const idOf = (set) => String(set.setId || "").trim().toLowerCase();
    const isPart = (set) => /-p\d+$/.test(idOf(set));
    const parts = setItems.filter(isPart).sort((a, b) => idOf(a).localeCompare(idOf(b), "en", { numeric: true }));
    const promos = setItems.filter((s) => !isPart(s)).sort(sortByReleaseAsc);
    const items = [];
    const section = (list, key) => {
      if (!list.length) return;
      items.push(cabecalhoDeSecao(key, list.length));
      list.forEach((set) => items.push(set));
    };
    section(parts, "sets.category.main");
    section(promos, "sets.category.promos");
    return items;
  }

  // Dragon Ball Carddass: uma seção por SÉRIE (Hondan, Super Battle, Visual
  // Adventure, Super Barcode Wars), cada uma em ordem crescente de parte — são
  // séries lineares, lidas como checklist. A série vem do setId (dbc-h06,
  // dbc-sb01…), que o sync-dbc-carddass.mjs fixa.
  // LOTR TCG da Decipher: os 19 sets em ordem de lançamento (vintage se lê do
  // mais antigo pro mais novo) e os promos no fim — o set 0 e os quatro que o
  // sync-lotr.mjs separou por numeração — os impressos primeiro (0P e as
  // Megasized), os que nunca foram impressos depois.
  function groupLotrSets(setItems) {
    const idOf = (set) => String(set.setId || "").trim().toLowerCase();
    const isPromo = (set) => /^lotr-00/.test(idOf(set));
    const PROMOS = ["lotr-00", "lotr-00m", "lotr-00d", "lotr-00w", "lotr-00j"];
    const porId = (a, b) => (PROMOS.indexOf(idOf(a)) - PROMOS.indexOf(idOf(b))) || idOf(a).localeCompare(idOf(b), "en", { numeric: true });
    const items = [];
    for (const [key, list] of [["sets.category.main", setItems.filter((s) => !isPromo(s))], ["sets.category.promos", setItems.filter(isPromo)]]) {
      if (!list.length) continue;
      items.push(cabecalhoDeSecao(key, list.length));
      list.sort(porId).forEach((set) => items.push(set));
    }
    return items;
  }

  function groupDbcSets(setItems) {
    const idOf = (set) => String(set.setId || "").trim().toLowerCase();
    const SERIES = [["h", "sets.category.dbcHondan"], ["sb", "sets.category.dbcSuperBattle"], ["va", "sets.category.dbcVisualAdventure"], ["bw", "sets.category.dbcBarcodeWars"]];
    const serieOf = (set) => (idOf(set).match(/^dbc-([a-z]+)\d+$/) || [])[1] || "";
    const items = [];
    for (const [code, key] of SERIES) {
      const list = setItems.filter((s) => serieOf(s) === code).sort((a, b) => idOf(a).localeCompare(idOf(b), "en", { numeric: true }));
      if (!list.length) continue;
      items.push(cabecalhoDeSecao(key, list.length));
      list.forEach((set) => items.push(set));
    }
    const rest = setItems.filter((s) => !SERIES.some(([code]) => serieOf(s) === code)).sort(sortByReleaseAsc);
    if (rest.length) {
      items.push(cabecalhoDeSecao("sets.category.promos", rest.length));
      rest.forEach((set) => items.push(set));
    }
    return items;
  }

  // Harry Potter TCG: as cinco coleções da Wizards em ordem de lançamento
  // (checklist, como nas outras vintage), depois os decks iniciais (setKind
  // "deck", gravado pelo sync-harrypotter.mjs) e as promos.
  // Miracle Battle Carddass (jogo mbc, desde 2026-10-01): o crossover da Jump
  // tem uma seção por SÉRIE (franquia), como as eras do Pokémon, na ordem em que
  // a fonte (tcg-db) lista as séries. A série sai do prefixo do setId: as três
  // que eram linha de uma marca até essa data mantêm o prefixo dela (op-mb-,
  // nrt-mb-, hxh-mb-), e as que entraram com o jogo são mb-<código>. Os sets não
  // têm data, então a ordem dentro da série vem do código impresso: boosters
  // (OP01, NR05…), decks (OPS, DBS, DAS…), os pacotes especiais (Gigant Pack,
  // Phantom Booster, os decks da revista) e as promos, que não têm número.
  // O nome em inglês leva a franquia ("One Piece Booster Pack 1", pra Coleção e
  // o popup não confundirem os três "Promotional Cards"); dentro da seção ela
  // repete o título e cortava no tile justo a parte que diferencia os sets
  // ("Dragon Ball Kai Booster P…"), então aqui ela sai.
  function groupMbcSets(setItems) {
    const idOf = (set) => String(set.setId || "").toLowerCase();
    const SERIES = [
      ["sets.category.mbDb", /^mb-dbs?\d*$/, "Dragon Ball Kai "],
      ["sets.category.mbOp", /^op-mb-/, "One Piece "],
      ["sets.category.mbTr", /^mb-tr\d*$/, "Toriko "],
      ["sets.category.mbHh", /^hxh-mb-/, "Hunter × Hunter "],
      ["sets.category.mbNr", /^nrt-mb-/, "Naruto Shippuden "],
      ["sets.category.mbKb", /^mb-kb\d*$/, "Kuroko's Basketball "],
      ["sets.category.mbJh", /^mb-(das|as|js)\d*$/, "J-Heroes "]
    ];
    const semFranquia = (set, i) => {
      const nome = String(set.displayName || ""), franquia = i >= 0 ? SERIES[i][2] : "";
      return franquia && nome.indexOf(franquia) === 0 ? Object.assign({}, set, { displayName: nome.slice(franquia.length) }) : set;
    };
    const codigo = (set) => idOf(set).replace(/^(op|nrt|hxh)-mb-|^mb-/, "");
    const tipo = (c) => (!/\d/.test(c) ? 3 : /^(dbs|ops|hhs|nrs|das)\d/.test(c) ? 1 : /^(opc|hhex|js)\d/.test(c) ? 2 : 0);
    const ordem = (a, b) => tipo(codigo(a)) - tipo(codigo(b)) || codigo(a).localeCompare(codigo(b), "en", { numeric: true });
    const serieDe = (set) => SERIES.findIndex(([, re]) => re.test(idOf(set)));
    const items = [];
    const section = (list, key) => {
      if (!list.length) return;
      items.push(cabecalhoDeSecao(key, list.length));
      list.sort(ordem).forEach((set) => items.push(set));
    };
    SERIES.forEach(([key], i) => section(setItems.filter((s) => serieDe(s) === i).map((s) => semFranquia(s, i)), key));
    // Rede de segurança: série nova no sync sem seção aqui ainda aparece.
    section(setItems.filter((s) => serieDe(s) < 0), "sets.category.promos");
    return items;
  }

  function groupHarryPotterSets(setItems) {
    const principal = (set) => /^hp-(bs|qc|da|aah|cos)$/.test(String(set.setId || ""));
    const grupos = [
      ["sets.category.main", setItems.filter(principal)],
      ["sets.category.decks", setItems.filter((set) => !principal(set) && set.kind === "deck")],
      ["sets.category.promos", setItems.filter((set) => !principal(set) && set.kind !== "deck")]
    ];
    const items = [];
    for (const [key, sets] of grupos) {
      if (!sets.length) continue;
      items.push(cabecalhoDeSecao(key, sets.length));
      sets.sort(sortByReleaseAsc).forEach((set) => items.push(set));
    }
    return items;
  }

  // Magic: The Gathering (2026-10-08). O Magic caía no groupSetsBySeries, que
  // deduz a série do Pokémon pelo COMEÇO do setId — e as siglas de três letras
  // do Magic casavam: "neo" (Kamigawa: Neon Dynasty) virava a série "Neo",
  // "pls" virava "Platinum", "exo" virava "EX". O resto (623 sets) ia todo
  // pra um "Outros" único: expansão, Commander, Promos e evento misturados.
  //
  // O manifest do Magic não traz o tipo do set (o sync usa o set_type do
  // Scryfall só pra filtrar), mas os produtos de um lançamento levam o NOME do
  // set principal: "Final Fantasy Commander", "Final Fantasy Promos", "Edge of
  // Eternities: Stellar Sights". Então o pai de um set é o set de nome mais
  // longo que é prefixo do nome dele (seguido de espaço ou dois-pontos),
  // lançado a até 400 dias — no manifest de 08/10/2026 são 175 produtos
  // aninhados em 650. Filho de filho sobe pro avô.
  // A mesma regra vale no Pokémon: "Silver Tempest Trainer Gallery", "Crown
  // Zenith Galarian Gallery", "Scarlet & Violet Energy".
  // Desde 2026-10-09 vale em TODO jogo (padrão da página de Sets): o
  // pré-release e o release event do One Piece, Digimon, DBFW e Union Arena,
  // os Weekly Play Promos do Star Wars, o Treasure dos raids do WoW. Medido
  // com os catálogos de 09/10/2026: Union Arena 77 → 48 cartões, Digimon
  // 99 → 69, One Piece 85 → 65, DBFW 49 → 29, Yu-Gi-Oh! 594 → 571.
  // Das raízes do Magic, as de evento/premiação/coleção avulsa (MagicFest,
  // Wizards Play Network, Secret Lair, The List…) vão pra seção de especiais,
  // pelo nome.
  const MAGIC_ESPECIAL =/magicfest|wizards play network|judge|secret lair|the list|mystery booster|arena league|friday night|player rewards|game day|prerelease|championship|showdown|heroes of the realm|love your lgs|pro tour|celebration|league|box topper|duel deck|from the vault|signature spellbook|premium deck|promo|gift|anniversary|launch party|release event|open house|summer magic|unique and miscellaneous|planechase|archenemy|starter|welcome deck|intro pack|spotlight|playtest|unknown event|commander collection|game night|challenger deck|global series|guild kit|clash pack|holiday/i;
  // O que sobra do nome é um NÚMERO de volume, não um produto: "Vol. 2",
  // "2", "II", "Volume II", "2019", "Round 2", e o "第1章" (capítulo) do
  // Data Carddass. É o set SEGUINTE da série, com cartão próprio — sem isto, o
  // Extra Booster Vol. 2 (EB-05) do One Piece sumia dentro do EB-03, o Hidden
  // Arsenal 2 e 3 dentro do 1, e os capítulos do Narutimate Formation dentro de
  // um cartão só.
  const VOLUME_SEGUINTE = /^(?:(?:vol(?:ume)?\.?|round)\s*)?(?:\d+|[ivx]+)$|^第.+章/i;
  // Devolve as RAÍZES (cada uma com `filhos`); os filhos ganham `rotulo`.
  // Deck/caixa (`kind: "deck"`) fica de fora dos dois lados: tem seção
  // própria (Pokémon chinês, Harry Potter).
  function aninhaPorNome(setItems) {
    const DIA = 86400000;
    const dias = (a, b) => Math.abs(Date.parse(a.releaseDate || "1970-01-01") - Date.parse(b.releaseDate || "1970-01-01")) / DIA;
    const candidatos = setItems.filter((set) => set.kind !== "deck");
    const porTamanho = candidatos.slice().sort((a, b) => a.name.length - b.name.length);
    const pai = new Map();
    candidatos.forEach((set) => {
      let melhor = null;
      for (const p of porTamanho) {
        if (p === set || p.name.length >= set.name.length) continue;
        const resto = set.name.slice(p.name.length);
        if (!set.name.startsWith(p.name) || !/^[\s:]/.test(resto)) continue;
        if (VOLUME_SEGUINTE.test(resto.replace(/^[\s:]+/, ""))) continue;
        if (dias(p, set) > 400) continue;
        if (!melhor || p.name.length > melhor.name.length) melhor = p;
      }
      if (melhor) pai.set(set, melhor);
    });
    const raizDe = (set) => { let r = set; while (pai.has(r)) r = pai.get(r); return r; };
    const raizes = setItems.filter((set) => !pai.has(set)).map((set) => Object.assign(set, { filhos: [] }));
    pai.forEach((_, set) => {
      const r = raizDe(set);
      // O rótulo do produto é o que sobra do nome ("Commander", "Stellar
      // Sights"), sem o separador ("Compendium of Rathe - Antiquity Pack") nem
      // os parênteses ("ST-01 … (Super Pre-Release Edition)"). Sai do nome de
      // EXIBIÇÃO quando ele também tem o do pai na frente: nos vintages
      // japoneses o cartão diz "Narutimate Formation", e o chip "極秘任務"
      // destoava do título em inglês.
      const exibe = set.displayName && r.displayName && set.displayName.startsWith(r.displayName);
      const resto = exibe ? set.displayName.slice(r.displayName.length) : set.name.slice(r.name.length);
      set.rotulo = resto.replace(/^[\s:]+(?:[-–—]\s+)?/, "").replace(/^\((.+)\)$/, "$1") || set.displayName;
      r.filhos.push(set);
    });
    raizes.forEach((r) => r.filhos.sort(sortByReleaseDesc));
    return raizes;
  }

  // Seções por ANO de lançamento, do mais novo pro mais antigo: o Magic e os
  // jogos sem série nem agrupamento próprio (Yu-Gi-Oh, Digimon, FAB, Gundam…),
  // que antes caíam num "Outros" único. Set sem data vai pro fim.
  function groupSetsByYear(setItems) {
    const porAno = new Map();
    setItems.slice().sort(sortByReleaseDesc).forEach((set) => {
      const ano = (set.releaseDate || "").slice(0, 4) || t("sets.category.noDate");
      if (!porAno.has(ano)) porAno.set(ano, []);
      porAno.get(ano).push(set);
    });
    const items = [];
    porAno.forEach((sets, ano) => {
      items.push({ type: "category-head", name: ano, count: sets.length });
      sets.forEach((set) => items.push(set));
    });
    return items;
  }

  // Recebe as raízes do aninhaPorNome, como todo agrupador (agrupaSetsDoJogo).
  function groupMagicSets(raizes) {
    const especiais = raizes.filter((set) => MAGIC_ESPECIAL.test(set.name)).sort(sortByReleaseDesc);
    const items = groupSetsByYear(raizes.filter((set) => !MAGIC_ESPECIAL.test(set.name)));
    if (especiais.length) {
      items.push(cabecalhoDeSecao("sets.category.mtgSpecial", especiais.length));
      especiais.forEach((set) => items.push(set));
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
      dexMarked: dexOwned.has(String(entry.dexId)),
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
  // UM formatador por estilo e idioma (2026-10-08): o toLocaleDateString com
  // opções monta o formatador a cada chamada, e cada cartão de set chama duas
  // ou três vezes (selo, lista e o title).
  // Data só com ano e mês (as vintage: "2002-10") sai sem dia — o estilo
  // longo, o do destaque do topo, inventava um "1 de outubro de 2002".
  const formatosDeData = new Map();
  function formatReleaseDate(value, style) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const longo = style === "long" ? (/^\d{4}-\d{2}$/.test(String(value)) ? "m" : "l") : "c";
    const chave = `${longo}|${shared.getLocale()}`;
    let f = formatosDeData.get(chave);
    if (!f) {
      f = new Intl.DateTimeFormat(shared.getLocale(), longo === "l"
        ? { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }
        : { month: longo === "m" ? "long" : "short", year: "numeric", timeZone: "UTC" });
      formatosDeData.set(chave, f);
    }
    return f.format(date);
  }
})();
