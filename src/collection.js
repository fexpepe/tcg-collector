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
  const { ownedByGame, cardGameMap, gameOf, owned, wishlist, prices } = shared.createCrossGameStores();
  const gameLabelOf = (g) => shared.gameLabel(g);

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
    const save = () => { data.updatedAt = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(data)); shared.marcaSuja(KEY); } catch (e) { /* quota: ignora */ } };
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
      reorderTo(dragId, targetId) { // arrasta: insere dragId na posição de targetId
        const from = data.folders.findIndex((f) => f.id === dragId);
        if (from < 0 || dragId === targetId) return;
        const [f] = data.folders.splice(from, 1);
        const to = data.folders.findIndex((x) => x.id === targetId);
        if (to < 0) data.folders.push(f); else data.folders.splice(to, 0, f);
        save();
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

  // Cartas graded (slabs): a aba Graded agora GERENCIA na própria tela —
  // store completa + tiles editáveis + picker vêm do módulo compartilhado
  // src/graded-ui.js (a página graded.html usa o MESMO módulo; zero cópia).
  const gradedStore = window.TCGGradedUI ? window.TCGGradedUI.createGradedStore() : null;
  const gradedReader = { list: () => (gradedStore ? gradedStore.list() : []) };
  const gradedUiCtx = () => ({ shared, graded: gradedStore, owned, prices, cards: () => cards, cardsById: () => cardsById, gameFilter: () => gameFilter, onChange: () => renderCards() });
  // Cores da tarja por graduadora (fundo, texto) — espelha as GRADERS de graded.js.
  const GRADED_COLORS = { psa: ["#c8102e", "#ffffff"], bgs: ["#15171d", "#e8c46a"], cgc: ["#0a3d91", "#ffffff"], sgc: ["#101216", "#ffffff"], tag: ["#0b0b0d", "#ffffff"] };

  // Tags viraram LISTAS (migrateTagsToLists, no shared.js). Do store antigo
  // sobrou só a CONTAGEM, que a aba Tags mostra junto do aviso de migração —
  // ler é seguro, escrever não: o blob legado ainda sincroniza (device antigo
  // pode estar gravando nele), mas nada nesta página o edita.
  const tags = { count: contaTagsLegadas };
  function contaTagsLegadas() {
    try {
      const raw = JSON.parse(localStorage.getItem("tcg-collector-collection-tags-v1") || "null");
      return raw && Array.isArray(raw.tags) ? raw.tags.length : 0;
    } catch (e) { return 0; }
  }

  let activeTab = "cards";
  let sortMode = "dex";

  // Aba "Cartas": ordenação + grade/lista (preferências guardadas).
  const CARDS_SORTS = ["value-desc", "value-asc", "num-asc", "num-desc", "rarity-desc", "rarity-asc", "release", "added-desc", "added-asc"];
  let cardsSort = CARDS_SORTS.includes(localStorage.getItem("tcg-collection-sort")) ? localStorage.getItem("tcg-collection-sort") : "value-desc";
  let cardsView = shared.gridViewValue(localStorage.getItem("tcg-collection-view"));

  // --- Seleção em massa (aba Cartas): toque marca/desmarca; barra fixa aplica
  // showcase/tag/venda a tudo de uma vez. Seleção por carta×variante (tiles). ---
  let bulkMode = false;
  const bulkSel = new Set(); // "cardId|variant"
  const bulkPairs = () => Array.from(bulkSel).map((k) => { const i = k.lastIndexOf("|"); return { cardId: k.slice(0, i), variant: k.slice(i + 1) }; });
  const bulkCardIds = () => unique(bulkPairs().map((p) => p.cardId));
  function setBulkMode(on) {
    bulkMode = on;
    if (!on) bulkSel.clear();
    if (elements.bulkBtn) {
      elements.bulkBtn.setAttribute("aria-pressed", String(on));
      // No span, não no botão: escrever no textContent do botão apagaria o ícone.
      (elements.bulkBtn.querySelector("span") || elements.bulkBtn).textContent = t(on ? "bulk.exit" : "bulk.enter");
    }
    if (elements.grid) elements.grid.classList.toggle("bulk-mode", on);
    updateBulkBar();
  }
  function updateBulkBar() {
    let bar = document.getElementById("bulkBar");
    if (!bulkMode) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "bulkBar";
      bar.className = "bulk-bar";
      document.body.appendChild(bar);
      // Delegação no próprio bar (sobrevive aos rebuilds do innerHTML).
      bar.addEventListener("change", (event) => {
        const f = event.target.closest("[data-bulk-folder]");
        if (f && f.value) {
          const fid = f.value === "__none__" ? null : f.value;
          bulkCardIds().forEach((id) => folders.assign(id, fid));
          f.value = "";
          render();
          return;
        }
      });
      bar.addEventListener("click", (event) => {
        if (event.target.closest("[data-bulk-done]")) { setBulkMode(false); render(); return; }
        if (event.target.closest("[data-bulk-sale]")) {
          const n = bulkAddToSale(bulkPairs());
          alert(t("bulk.saleDone", { n }));
        }
      });
    }
    const n = bulkSel.size;
    const dis = n ? "" : " disabled";
    const folderOpts = `<option value="">${escapeHtml(t("bulk.toFolder"))}</option><option value="__none__">${escapeHtml(t("folders.none"))}</option>`
      + folders.list().map((f) => `<option value="${escapeAttribute(f.id)}">${escapeHtml(f.name || t("folders.untitled"))}</option>`).join("");
    // O select de tag saiu da barra: tags viraram Listas e o assign pós-migração
    // era um buraco negro (ver comentário na caixa de tags do preview, acima).
    bar.innerHTML = `<strong class="bulk-count">${escapeHtml(tn("bulk.count", n))}</strong>
      <select data-bulk-folder${dis}>${folderOpts}</select>
      <button type="button" class="bulk-bar-btn" data-bulk-sale${dis}>${escapeHtml(t("bulk.sale"))}</button>
      <button type="button" class="bulk-bar-btn is-primary" data-bulk-done>${escapeHtml(t("bulk.done"))}</button>`;
  }
  // Escreve DIRETO na store de vendas (mesmo formato do createSalesStore da página
  // de Vendas: sales["cardId|variant|idx"], order, updatedAt). Todas as cópias da
  // variante entram, com condição real + preço de mercado (auto).
  function bulkAddToSale(pairs) {
    const KEY = "tcg-collector-collection-sales-v1";
    let data;
    try { data = JSON.parse(localStorage.getItem(KEY) || "null") || {}; } catch (e) { data = {}; }
    if (!data.sales || typeof data.sales !== "object") data.sales = {};
    if (!Array.isArray(data.order)) data.order = [];
    let added = 0;
    pairs.forEach(({ cardId, variant }) => {
      const card = cardsById.get(cardId);
      if (!card) return;
      const conds = [];
      owned.conditionBreakdown(cardId, variant).forEach(({ condition, quantity }) => { for (let i = 0; i < quantity; i++) conds.push(condition); });
      if (!conds.length) return;
      const mkt = shared.cardValue(card, variant, prices, shared.DEFAULT_CONDITION).value || 0;
      for (let i = 0; i < conds.length; i++) {
        const k = `${cardId}|${variant}|${i}`;
        if (data.sales[k]) continue;
        data.sales[k] = { cardId, variant, idx: i, price: mkt > 0 ? Math.round(mkt * 100) / 100 : 0, cond: conds[i], auto: true };
        data.order.push(k);
        added++;
      }
    });
    data.updatedAt = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(data)); shared.marcaSuja(KEY); } catch (e) { /* quota: ignora */ }
    return added;
  }

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
    gradedAddBtn: document.getElementById("gradedAddBtn"),
    bulkBtn: document.getElementById("bulkSelectBtn"),
    tagsNewBtn: document.getElementById("tagsNewBtn"),
    heading: document.querySelector(".results-header h2"),
    dashProfile: document.getElementById("dashProfile"),
    empty: document.getElementById("emptyState"),
    search: document.getElementById("searchInput"),
    pokemonFilter: document.getElementById("pokemonFilter"),
    setFilter: document.getElementById("setFilter"),
    languageFilter: document.getElementById("languageFilter"),
    rarityFilter: document.getElementById("rarityFilter"),
    valueFilter: document.getElementById("valueFilter"),
    cardsSortSelect: document.getElementById("cardsSortSelect"),
    cardsViewToggle: document.getElementById("cardsViewToggle"),
    filtersBtn: document.getElementById("collectionFiltersBtn"),
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
    // "+ Graded" dentro do card. Passa o MESMO store da página (gradedStore) —
    // criar outro no preview sobrescreveria o blob, porque cada instância grava
    // a cópia que tem em memória. Sem store (graded-ui não carregado), nada é
    // passado e o botão não aparece.
    graded: gradedStore ? {
      add: (cardId, variant, company, grade) => gradedStore.add(cardId, variant, company, grade),
      countOf: (cardId, variant) => gradedStore.countOf(cardId, variant),
      onChange: () => { renderCards(); renderDashboard(); }
    } : null,
    // Seletor de pasta dentro do preview (atribui a carta a uma pasta).
    folders: {
      list: () => folders.list(),
      currentOf: (cardId) => folders.folderOf(cardId),
      onChange: (cardId, folderId) => { folders.assign(cardId, folderId); renderDashboard(); renderCards(); }
    }
    // A caixa de tags do preview FOI REMOVIDA de propósito: tags viraram Listas
    // (migrateTagsToLists) e a migração é one-shot por tag — marcar uma tag já
    // migrada aqui gravava no blob legado e não aparecia em lugar NENHUM (nem na
    // Lista, nem no perfil público, nem na aba Tags, que hoje é só um aviso).
    // Organização de carta no preview agora é pasta (acima) e "+ Lista" no tile.
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
    // Barra de stats fixa: o CSS gruda o #collectionDashboard logo abaixo do
    // header via --header-h (a altura real varia por breakpoint/idioma).
    const appHeader = document.querySelector(".app-header");
    if (appHeader) {
      const syncHeaderH = () =>
        document.documentElement.style.setProperty("--header-h", `${appHeader.offsetHeight}px`);
      syncHeaderH();
      window.addEventListener("load", syncHeaderH);
      window.addEventListener("resize", shared.debounce(syncHeaderH, 150));
    }
    // Skeletons na grade de cartas enquanto os chunks dos jogos baixam (só se
    // há algo pra carregar — coleção vazia mostra o onboarding direto).
    if (elements.grid && shared.GAME_SLUGS.some((g) => ownedByGame[g].knownCardIds().length)) {
      shared.showSkeletons(elements.grid, "card", 8);
    }
    // Filtro de jogo só com os jogos em que há carta marcada — quem coleciona
    // só Pokémon não precisa ver 12 chips (e o filtro some de vez com 1 jogo).
    // Roda aqui, antes dos catálogos: a posse vem do localStorage, não da rede.
    shared.setGameFilterScope(shared.GAME_SLUGS.filter((g) => ownedByGame[g].size > 0));
    // ?filter=<jogo>: o chip do Hub abre a Coleção já no jogo clicado, e o
    // refresh não perde o filtro. Aplicado ANTES do primeiro render.
    const filtroPedido = shared.gameFilterFromUrl();
    if (filtroPedido && ownedByGame[filtroPedido] && ownedByGame[filtroPedido].size > 0) {
      gameFilter = filtroPedido;
      shared.markGameFilterChip(filtroPedido);
    }
    // loadOwnedFast: pede à BORDA (/api/collection) só as cartas que você tem —
    // sem baixar os chunks INTEIROS dos sets nem o índice inteiro do jogo (2,86 MB
    // no Magic), que era o que fazia a Coleção demorar e esquentar o celular. As
    // cartas já vêm com setId, então nem o setIdForCard O(n²) roda. É o mesmo
    // caminho que o Portfólio e o Dashboard já usam. Se a borda estiver fora, cai
    // sozinho no caminho de chunks de sempre (viaApi=false), sem o usuário notar.
    const gamesComCarta = shared.GAME_SLUGS.filter((g) => ownedByGame[g].size > 0);
    Promise.all([
      shared.loadOwnedFast(shared.collectionLoadIds(ownedByGame)),
      shared.loadFxRates()
    ])
      .then(([result]) => {
        cards = result.cards;
        cards.forEach((card) => cardGameMap.set(card.id, card.game));
        cardsById = new Map(cards.map((card) => [card.id, card]));
        Object.keys(ownedByGame).forEach((g) =>
          ownedByGame[g].migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId))));
        hydrateFilters();
        bindShareButton();
        // Ponto do dia no histórico do Portfólio (mesmo motivo do Hub: quem vive
        // na Coleção não deixa mais buraco no gráfico). Sobre `cards` — a lista
        // INTEIRA, não o ownedCards() da tela: aquele já vem filtrado pelo chip
        // de jogo, e gravar por ele zeraria os outros jogos no dia. `wish` fica
        // de fora aqui: a tela não carrega as cartas desejadas.
        // `parcial`: a borda devolveu menos carta do que se pediu, então este
        // total está subestimado — gravá-lo marcaria uma queda que não houve.
        if (!result.parcial) {
          shared.recordValueSnapshot(Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, {
            raw: shared.collectionValueLines(cards, owned, prices, { gameFilter: g }).total,
            graded: shared.gradedTotalValue(gameOf, g)
          }])));
        }
        if (result.viaApi) {
          // Cartas na tela JÁ; os denominadores de progresso (X/Y por set/artista)
          // vêm das FATIAS de índice em 2º plano — sem esse índice, totalsForTab
          // cai no total das cartas carregadas (número válido, só sem o "de Y").
          render();
          shared.publishProfile(cards, owned, prices);
          shared.loadCollectionIndexes(gamesComCarta).then((byGame) => {
            indexes = mergeIndexes(byGame);
            render();
            shared.publishProfile(cards, owned, prices); // agora com os totais no payload
          });
        } else {
          // Fallback (borda fora): o caminho de chunks já trouxe o índice inteiro.
          indexes = mergeIndexes(result.indexesByGame);
          render();
          shared.publishProfile(cards, owned, prices);
        }
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
    // Rótulos da faixa de valor com o símbolo da moeda atual (R$/$/€…).
    if (elements.valueFilter) {
      const sym = shared.currencySymbol();
      const labels = { "0-10": `≤ ${sym} 10`, "10-50": `${sym} 10–50`, "50-200": `${sym} 50–200`, "200-": `${sym} 200+` };
      Array.from(elements.valueFilter.options).forEach((o) => { if (labels[o.value]) o.textContent = labels[o.value]; });
    }
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
    fillFilter(elements.languageFilter, unique(myCards.map((card) => shared.normalizeCardLanguage(card.language))), (value) => langOptionLabel(value));
    fillFilter(elements.rarityFilter, unique(myCards.map((card) => card.rarity).filter(Boolean)).sort());
    aplicaSetDaUrl();
  }

  // ?set=<nome> na URL: o detalhamento "Por set" do Portfólio manda pra cá com
  // o set já escolhido — antes a linha era um número morto e a pessoa tinha que
  // reencontrar o set no <select>. Roda depois de preencher o filtro (a opção
  // precisa existir) e uma vez só, pra não reimpor o set a cada troca de aba.
  let setDaUrlAplicado = false;
  function aplicaSetDaUrl() {
    if (setDaUrlAplicado || !elements.setFilter) return;
    const alvo = collParams.get("set");
    if (!alvo) { setDaUrlAplicado = true; return; }
    const existe = Array.from(elements.setFilter.options).some((o) => o.value === alvo);
    if (!existe) return; // o catálogo ainda não trouxe esse set: tenta no próximo refresh
    setDaUrlAplicado = true;
    elements.setFilter.value = alvo;
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
    if (label) label.textContent = gameFilter !== "pokemon" && gameFilter !== "all" ? t("toolbar.characters") : t("toolbar.pokemon");
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
        // Compacto muda o HTML do tile (sem <img>), não só a classe da grade:
        // entrar ou sair dele exige reconstruir a grade. grid<->lista é só CSS.
        const eraCompacto = cardsView === "compact";
        cardsView = shared.gridViewValue(button.dataset.gridView);
        localStorage.setItem("tcg-collection-view", cardsView);
        const virouCompacto = cardsView === "compact";
        applyCardsView();
        if (eraCompacto !== virouCompacto) renderCards();
      });
    }
    // Barra de filtros recolhível: o botão vive no cartão-herói e vale em
    // QUALQUER largura (no resto do site o colapso é só mobile, via
    // initFilterToggle do shared.js — aqui a barra tem data-own-toggle).
    // Mesma chave de preferência: quem abre costuma querer manter aberto.
    if (elements.filtersBtn) {
      const bar = document.getElementById("collectionFilters");
      let filtersOpen = false;
      try { filtersOpen = localStorage.getItem("tcg-collector-filters-open") === "1"; } catch (e) { /* ignora */ }
      const paintFilters = () => {
        if (bar) bar.classList.toggle("is-collapsed", !filtersOpen);
        elements.filtersBtn.setAttribute("aria-expanded", String(filtersOpen));
      };
      elements.filtersBtn.addEventListener("click", () => {
        filtersOpen = !filtersOpen;
        try { localStorage.setItem("tcg-collector-filters-open", filtersOpen ? "1" : "0"); } catch (e) { /* ignora */ }
        paintFilters();
      });
      paintFilters();
    }

    elements.gameFilter.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-game-filter]");
      if (!chip || chip.dataset.gameFilter === gameFilter) return;
      gameFilter = chip.dataset.gameFilter;
      Array.from(elements.gameFilter.children).forEach((node) => {
        node.setAttribute("aria-pressed", node === chip ? "true" : "false");
      });
      shared.stampGameFilter(gameFilter); // sobrevive ao refresh e ao compartilhamento
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
        // O link "Vendas e Trocas" (sem data-tab) não é aba: fica sem aria-pressed.
        if (node.dataset && node.dataset.tab) node.setAttribute("aria-pressed", node === chip ? "true" : "false");
      });
      render();
    });

    // Abrir uma aba específica via ?tab= (ex.: voltar da página Graded p/ "Coleções").
    const wantTab = collParams.get("tab");
    const VALID_TABS = ["cards", "folders", "tags", "graded", "pokemon", "artists", "sets"];
    if (wantTab && VALID_TABS.includes(wantTab) && wantTab !== activeTab) {
      activeTab = wantTab;
      if (GROUP_TABS[activeTab]) sortMode = GROUP_TABS[activeTab].defaultSort;
      Array.from(elements.tabs.children).forEach((node) => {
        if (node.dataset && node.dataset.tab) node.setAttribute("aria-pressed", String(node.dataset.tab === activeTab));
      });
    }

    elements.sortChips.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-sort]");
      if (!chip) return;
      sortMode = chip.dataset.sort;
      render();
    });

    const applyFilters = () => render({ resetCount: true });
    elements.search.addEventListener("input", debounce(applyFilters, 200));
    [elements.pokemonFilter, elements.setFilter, elements.languageFilter, elements.rarityFilter, elements.valueFilter].forEach((element) => {
      if (element) element.addEventListener("input", applyFilters);
    });

    // Cliques nos tiles: vale pra grade plana (#cardGrid) E pras seções de pasta.
    const handleTileClick = (event) => {
      // Modo SELEÇÃO: o toque marca/desmarca o tile (nada de preview/ações).
      if (bulkMode && activeTab === "cards") {
        const tile = event.target.closest(".card-tile");
        if (tile && !tile.classList.contains("graded-tile") && tile.dataset.tileCardId) {
          event.preventDefault();
          const k = `${tile.dataset.tileCardId}|${tile.dataset.tileVariant || ""}`;
          if (bulkSel.has(k)) bulkSel.delete(k); else bulkSel.add(k);
          tile.classList.toggle("bulk-selected", bulkSel.has(k));
          updateBulkBar();
        }
        return;
      }
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
      // Botão "Coleções" do tile: abre o menu pra atribuir a carta a uma coleção.
      const folderBtn = event.target.closest("[data-folder-card-id]");
      if (folderBtn) { openTileFolderMenu(folderBtn, folderBtn.dataset.folderCardId); return; }
      const imageButton = event.target.closest("[data-preview-card-id]");
      if (imageButton) {
        const co = imageButton.dataset.gradedCompany;
        preview.open(imageButton.dataset.previewCardId, imageButton.dataset.previewVariant, co ? { graded: { company: co, grade: imageButton.dataset.gradedGrade, pristine: imageButton.dataset.gradedPristine === "1" } } : undefined);
        return;
      }
      if (shared.handleWantTileClick(event, wishlist)) {
        refreshOwnershipCards();
        return;
      }
      // O − tira uma cópia (antes do +, senão o clique cairia no quick-add).
      if (shared.handleRemoveOneTileClick(event, owned)) {
        refreshOwnershipCards();
        renderDashboard();
        return;
      }
      // Quick-add: o "+" soma +1 a cada clique e pisca "✓ Adicionada!" por 2s,
      // pra cadastrar várias cópias sem abrir o card (igual ao Explorar).
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
      if (event.target.closest("[data-folder-collapse]")) { if (fid) { openFolderId = fid; coverPickId = null; renderCards(); } return; }
      if (event.target.closest("[data-folder-back]")) { openFolderId = null; coverPickId = null; renderCards(); return; }
      const moveBtn = event.target.closest("[data-folder-move]");
      if (moveBtn) { if (fid) { folders.move(fid, Number(moveBtn.dataset.folderMove)); renderCards(); } return; }
      if (event.target.closest("[data-folder-delete]")) { if (fid) { const restore = shared.snapshotKeys(["tcg-collector-collection-folders-v1"]); folders.remove(fid); render(); shared.toastUndo(t("undo.folderDeleted"), restore); } return; }
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

    // O "Nova tag" NÃO ganha listener: a aba Tags é só o aviso da migração e
    // criar tag nova aqui alimentaria o blob legado (buraco negro pós-migração).
    // Graded na própria aba: "+ Adicionar graded" abre o MESMO picker da página
    // dedicada, e os tiles editáveis usam os eventos do módulo compartilhado.
    if (elements.gradedAddBtn) elements.gradedAddBtn.addEventListener("click", () => { if (window.TCGGradedUI) window.TCGGradedUI.openPicker(gradedUiCtx()); });
    if (window.TCGGradedUI) window.TCGGradedUI.bindGridEvents(gradedUiCtx(), elements.grid);

    // Fecha menus/popovers ao clicar fora ou apertar Esc.
    document.addEventListener("click", (event) => {
      if (tileFolderMenu && !event.target.closest(".tile-folder-menu") && !event.target.closest("[data-folder-card-id]")) closeTileFolderMenu();
    });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeTileFolderMenu(); } });

    if (elements.bulkBtn) elements.bulkBtn.addEventListener("click", () => { setBulkMode(!bulkMode); if (!bulkMode) render(); });

    bindFolderDrag();
    bindCollectionDrag();
    setupDragAutoScroll();
    initCarousel();
  }

  // Ao arrastar uma carta/coleção, rolar a página sozinha quando o cursor chega
  // perto do topo/base da janela — assim dá pra pegar uma carta lá embaixo e levar
  // pra um showcase lá em cima. A roda do mouse também rola durante o arraste.
  function setupDragAutoScroll() {
    const EDGE = 100;      // zona (px) junto à borda que dispara o scroll
    const MAX_SPEED = 17;  // px por tick (~16ms) na borda extrema
    let pointerY = 0, timer = 0, dragging = false;
    const tick = () => {
      const h = window.innerHeight;
      let dy = 0;
      if (pointerY < EDGE) dy = -MAX_SPEED * (1 - Math.max(0, pointerY) / EDGE);
      else if (pointerY > h - EDGE) dy = MAX_SPEED * (1 - Math.max(0, h - pointerY) / EDGE);
      if (dy) window.scrollBy(0, dy);
    };
    // setInterval (não rAF): roda mesmo se o rAF estiver throttled; o arraste só
    // acontece com a aba visível, então não há desperdício em background.
    const start = () => { if (!dragging) { dragging = true; if (!timer) timer = setInterval(tick, 16); } };
    const stop = () => { dragging = false; if (timer) { clearInterval(timer); timer = 0; } };
    document.addEventListener("dragstart", (e) => { if (e.target.closest && e.target.closest(".card-tile, .coll-card")) start(); });
    document.addEventListener("dragover", (e) => { pointerY = e.clientY; }, { passive: true });
    document.addEventListener("dragend", stop);
    document.addEventListener("drop", stop);
    // Durante o DnD nativo a roda às vezes não rola; rola na mão enquanto arrasta.
    window.addEventListener("wheel", (e) => { if (dragging) window.scrollBy(0, e.deltaY); }, { passive: true });
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

  // Aba "Pokémon"/"Personagens" (agrupa por espécie/personagem) segue o filtro
  // de jogo: "Pokémon" só no filtro Pokémon; "Personagens" nos demais E no
  // "Todos" — antes ela SUMIA no Todos, e o menu mudava de proporção em relação
  // ao do perfil público (Fernando preferiu a fileira estável; o agrupamento
  // funciona por carta, então misturar jogos só muda o rótulo).
  function syncGameTabs() {
    const tab = elements.tabs.querySelector('[data-tab="pokemon"]');
    if (!tab) return;
    tab.hidden = false;
    tab.textContent = gameFilter === "pokemon" ? t("toolbar.pokemon") : t("toolbar.characters");
  }

  function render(options) {
    shared.applyGameAccent(gameFilter); // accent vermelho/roxo/neutro conforme o jogo
    syncGameTabs();
    // Onboarding de primeira visita: coleção 100% vazia (nem slabs) mostra o guia.
    const onb = document.getElementById("collectionOnboarding");
    if (onb) onb.hidden = !(owned.size === 0 && !gradedReader.list().length);
    // "Cartas", "Graded" (grade plana) e "Pastas" (seções) usam a MESMA toolbar.
    const isFolders = activeTab === "folders";
    const isGraded = activeTab === "graded";
    const isTags = activeTab === "tags";
    const isCardsLike = activeTab === "cards" || isFolders || isGraded || isTags;
    if (!isFolders) openFolderId = null; // sair das Coleções volta pra vitrine
    elements.groupsView.hidden = isCardsLike;
    elements.cardsView.hidden = !isCardsLike;
    // Título muda conforme a aba; botões contextuais (Nova coleção / gerenciar / Nova tag).
    if (elements.heading) elements.heading.textContent = t(isFolders ? "collection.heading.folders" : isGraded ? "nav.graded" : isTags ? "tags.heading" : "collection.heading.cards");
    if (elements.newFolderBtn) elements.newFolderBtn.hidden = !isFolders;
    if (elements.gradedAddBtn) elements.gradedAddBtn.hidden = !isGraded || !window.TCGGradedUI;
    // Seleção em massa só na aba Cartas; trocar de aba encerra o modo.
    if (elements.bulkBtn) {
      const wrap = elements.bulkBtn.closest(".view-toggle-field") || elements.bulkBtn;
      wrap.hidden = activeTab !== "cards";
      if (activeTab !== "cards" && bulkMode) setBulkMode(false);
    }
    if (elements.tagsNewBtn) elements.tagsNewBtn.hidden = true; // tags viraram Listas; criar aqui era buraco negro
    // Visualização (▦/≣) e Filtros, no cartão-herói, comandam a toolbar do
    // cardsView: somem nas abas de progresso (Pokémon/Artistas/Sets).
    if (elements.cardsViewToggle) elements.cardsViewToggle.hidden = !isCardsLike;
    if (elements.filtersBtn) elements.filtersBtn.hidden = !isCardsLike;

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
    // Na aba "Minhas Coleções", o dashboard mostra a identidade (nome + @) no topo
    // — espelha o perfil público (é a sua vitrine pessoal).
    if (elements.dashProfile) {
      const p = shared.getProfile ? shared.getProfile() : {};
      const nm = (p.displayName || "").trim();
      // Identidade (nome + @) no dashboard em TODA a coleção (Toda Coleção, Coleções,
      // e em qualquer filtro de jogo) — não só no perfil público. Avatar em
      // monograma, o MESMO do cabeçalho compartilhado (dash-avatar).
      const showId = nm || p.handle;
      const inicial = (nm || p.handle || "").trim().charAt(0).toUpperCase();
      elements.dashProfile.hidden = !showId;
      // @ clicável -> perfil público (prático pra abrir e copiar o link). Só
      // quando o perfil É público — link pra página "não encontrado" confunde.
      const handleHtml = p.handle
        ? (p.isPublic
          ? `<a class="dash-profile-handle" href="/users/${escapeAttribute(p.handle)}" title="${escapeAttribute(t("dash.publicProfile"))}">@${escapeHtml(p.handle)}</a>`
          : `<span class="dash-profile-handle">@${escapeHtml(p.handle)}</span>`)
        : "";
      elements.dashProfile.innerHTML = showId
        ? `<div class="dash-profile-who">
            ${inicial ? `<span class="dash-avatar" aria-hidden="true"><span class="dash-avatar-in">${escapeHtml(inicial)}</span></span>` : ""}
            <div class="dash-profile-id"><strong class="dash-profile-name">${escapeHtml(nm || ("@" + p.handle))}</strong>${handleHtml}</div>
          </div>`
        : "";
    }
    const myCards = ownedCards();

    // Stats
    let copies = 0;
    myCards.forEach((card) => { copies += owned.totalForCard(card.id); });
    elements.dashCopies.textContent = copies;
    elements.dashDistinct.textContent = myCards.length;
    elements.dashSets.textContent = unique(myCards.map((card) => card.set)).length;
    // Valor de mercado = cartas soltas + slabs graded, respeitando o filtro de
    // jogo. A conta vive no shared (collectionNetWorth) e é a MESMA do Portfólio
    // e do Hub — antes cada tela tinha a sua e elas discordavam.
    const value = shared.collectionNetWorth(myCards, owned, prices, { gameOf, gameFilter }).total;
    elements.dashValue.textContent = value > 0 ? shared.formatMoney(shared.getCurrency(), value) : "—";

    // Mais valiosas (top 3 por valor unitário)
    // A variante MAIS VALIOSA entre as suas (não a primeira da lista): quem tem
    // Normal + Foil era rankeado pela Normal e este top discordava do Portfólio.
    const top = myCards.map((card) => {
      const minhas = shared.cardVariants(card).filter((v) => owned.variantTotal(card.id, v) > 0);
      const melhor = minhas.reduce((best, v) => {
        const val = shared.cardValue(card, v, prices).value || 0;
        return val > best.val ? { variant: v, val } : best;
      }, { variant: shared.defaultVariant(card), val: 0 });
      return { card, variant: melhor.variant, val: melhor.val };
    }).filter((x) => x.val > 0).sort((a, b) => b.val - a.val).slice(0, 3);
    if (elements.dashTopList) elements.dashTopList.innerHTML = top.length
      ? top.map(({ card, val }) => {
          const src = shared.cardImageSources(card);
          const thumb = shared.localizedImg(src.url, { alt: "", fallback: src.fallback, loading: "lazy", thumb: true });
          return `<li><a href="${escapeAttribute(detailUrl("set", card.set, "", card.game, { card: card.id, setId: card.setId }))}"><span class="dash-top-thumb">${thumb}</span>
            <span class="dash-top-info"><strong>${escapeHtml(card.name)}</strong><span class="dash-top-set">${escapeHtml(card.set)}</span></span>
            <span class="dash-top-val">${escapeHtml(shared.formatMoney(shared.getCurrency(), val))}</span></a></li>`;
        }).join("")
      : `<li class="dash-empty">${escapeHtml(t("dash.empty"))}</li>`;

    // Distribuição por jogo (Pokémon × Lorcana), entre as cartas filtradas.
    const byGame = {};
    myCards.forEach((card) => { byGame[card.game] = (byGame[card.game] || 0) + 1; });
    if (elements.dashDist) elements.dashDist.innerHTML = distBarsHtml(shared.GAME_SLUGS.map((g) => ({ label: gameLabelOf(g), n: byGame[g] || 0, color: shared.GAME_COLOR[g] })));

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
  const distBarsHtml = shared.distBarsHtml;

  // Valor de mercado das cartas que você tem (na moeda atual): soma cada cópia
  // pela condição que ela tem.
  // --- Aba de cartas (grade com filtros) ---

  // Mesmo ícone de compartilhar dos tiles (shared.TILE_ICONS.share).
  const SHARE_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>';
  const COVER_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 15l5-4 4 3 3-2 6 5"/><circle cx="9" cy="9" r="1.4"/></svg>';
  const TRASH_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';
  // Coleção em "modo trocar capa": clicar numa carta da seção a define como capa.
  let coverPickId = null;
  // Coleção ABERTA (foco): mostra só ela; null = vitrine (todas como cards).
  let openFolderId = null;

  // variantTile devolve um NÓ do DOM (não string) — usado tanto no pager (flat)
  // quanto via appendChild nas seções de pasta.
  // Sem `tags`: o rodapé do tile agora é só lista/pasta/coração/−/+ (as tags
  // saíram da grade em 2026-08-03 — etiquetar é dentro do card, que já tem a
  // seção; o "+ Lista" entrou no canto oposto ao +, ver docs/LISTAS.md).
  function makeTile({ card, variant }) {
    return shared.variantTile(card, variant, owned, wishlist, prices, {
      addMode: true, lists: true, compact: cardsView === "compact",
      folders: true, inFolder: !!folders.folderOf(card.id)
    });
  }

  // Menu "Coleções" do tile (botão da pasta na grade): lista as coleções pra
  // atribuir a carta direto, sem abrir o preview. "Sem coleção" tira; "+ Nova
  // coleção" cria e já atribui. Fecha ao clicar fora, rolar ou Esc.
  let tileFolderMenu = null;
  function closeTileFolderMenu() {
    if (tileFolderMenu) { tileFolderMenu.remove(); tileFolderMenu = null; }
    document.removeEventListener("scroll", closeTileFolderMenu, true);
  }
  function openTileFolderMenu(anchor, cardId) {
    if (tileFolderMenu && tileFolderMenu.dataset.card === cardId) { closeTileFolderMenu(); return; }
    closeTileFolderMenu();
    const current = folders.folderOf(cardId);
    const menu = document.createElement("div");
    menu.className = "tile-folder-menu";
    menu.dataset.card = cardId;
    const item = (id, label, on) => `<button type="button" class="tile-folder-item${on ? " on" : ""}" data-assign="${escapeAttribute(id)}">${escapeHtml(label)}</button>`;
    menu.innerHTML = item("", t("folders.none"), !current)
      + folders.list().map((f) => item(f.id, f.name || t("folders.untitled"), current === f.id)).join("")
      + `<button type="button" class="tile-folder-item tile-folder-new" data-assign-new>+ ${escapeHtml(t("folders.new"))}</button>`;
    document.body.appendChild(menu);
    // Posiciona perto do botão (fixed), sem sair da viewport.
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    const top = r.bottom + 6 + mh > window.innerHeight ? Math.max(8, r.top - 6 - mh) : r.bottom + 6;
    menu.style.top = `${top}px`;
    menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - mw - 8))}px`;
    tileFolderMenu = menu;
    menu.addEventListener("click", (event) => {
      const newBtn = event.target.closest("[data-assign-new]");
      if (newBtn) {
        const name = (window.prompt(t("folders.new")) || "").trim().slice(0, 24);
        closeTileFolderMenu();
        if (name) { const f = folders.create(name); folders.assign(cardId, f.id); afterFolderAssign(anchor, cardId); }
        return;
      }
      const pick = event.target.closest("[data-assign]");
      if (!pick) return;
      folders.assign(cardId, pick.dataset.assign || null);
      closeTileFolderMenu();
      afterFolderAssign(anchor, cardId);
    });
    document.addEventListener("scroll", closeTileFolderMenu, true);
  }
  // Pós-atribuição: na aba Coleções a carta muda de seção (re-render); na aba
  // Cartas só atualiza o estado do botão + o dashboard (sem piscar a grade).
  function afterFolderAssign(anchor, cardId) {
    if (activeTab === "folders") { render(); return; }
    const tile = anchor.closest(".card-tile");
    const btn = tile && tile.querySelector(".tile-folder");
    if (btn) btn.classList.toggle("active", !!folders.folderOf(cardId));
    renderDashboard();
  }

  // A aba Tags virou um AVISO: as tags são migradas pra Listas na primeira vez
  // que o store de listas é lido (migrateTagsToLists, no shared.js), e manter
  // aqui uma segunda UI editando o blob antigo faria as duas telas discordarem —
  // editar a tag aqui não apareceria na lista, e vice-versa. O caminho antigo
  // (?tab=tags, links guardados) continua respondendo, só que apontando pra lá.
  function renderTags() {
    updateCardsStats(tags.count());
    elements.folderSections.innerHTML = `
      <p class="empty-state">
        ${escapeHtml(t("tags.movedToLists"))}<br>
        <a class="cta" href="listas">${escapeHtml(t("nav.lists"))}</a>
      </p>`;
  }

  // Slabs (cartas graduadas) como "pares" pro pager — filtrados por jogo + busca,
  // pra aparecerem na grade de "Toda Coleção" e na aba "Graded".
  function gradedPairs() {
    const q = ((elements.search && elements.search.value) || "").trim();
    return gradedReader.list()
      .map((it) => ({ graded: true, it, card: cardsById.get(it.cardId) }))
      .filter((p) => p.card && inGameFilter(p.card) && (!q || shared.matchesCardQuery(p.card, q)));
  }

  // Nó do slab (somente leitura) pra grade: MESMO formato da carta normal pra ficar
  // coeso — imagem limpa em cima, e embaixo Nome → bandeira+badge da graduadora/nota
  // (no lugar da variante) → Coleção · nº → Preço. O badge (ex.: "PSA 9") com a cor
  // da graduadora é o que diferencia das cartas comuns.
  function makeGradedNode(p, editable) {
    const { it, card } = p;
    // Aba Graded: tile EDITÁVEL do módulo compartilhado (mesma UI da página
    // dedicada). Na "Toda Coleção" o slab segue somente leitura.
    if (editable && window.TCGGradedUI) {
      const w = document.createElement("div");
      w.innerHTML = window.TCGGradedUI.editableTileHtml(gradedUiCtx(), card, it, shared.currencySymbol());
      return w.firstElementChild;
    }
    const [bg, fg] = GRADED_COLORS[it.company] || GRADED_COLORS.psa;
    const src = shared.cardImageSources(card);
    const img = shared.localizedImg(src.url, { alt: card.name, fallback: src.fallback, loading: "lazy", thumb: true });
    const val = it.value > 0 ? it.value : (shared.gradedValue(card, it.company, it.grade).value || 0);
    const priceHtml = val > 0 ? `<p class="tile-price sale-price-tag">${escapeHtml(shared.formatMoney(shared.getCurrency(), val))}</p>` : "";
    const badge = `<span class="graded-badge" style="--slab-bg:${bg};--slab-fg:${fg}">${escapeHtml((it.company || "").toUpperCase())} ${escapeHtml(shared.gradedGradeText(it.grade, it.pristine))}</span>`;
    const wrap = document.createElement("div");
    wrap.innerHTML = `<article class="card-tile graded-tile graded-grid-tile" data-graded-gid="${escapeAttribute(it.gid)}">
      <div class="card-image"><button type="button" class="image-open" data-preview-card-id="${escapeAttribute(card.id)}" data-preview-variant="${escapeAttribute(it.variant)}" data-graded-company="${escapeAttribute(it.company)}" data-graded-grade="${escapeAttribute(it.grade)}" data-graded-pristine="${it.pristine ? "1" : ""}" aria-label="${escapeAttribute(t("card.zoom", { name: card.name }))}">${img}</button></div>
      <div class="tile-info">
        <h3>${escapeHtml(card.name)}</h3>
        <p class="tile-variant">${shared.cardFlag(card.language)}${badge}</p>
        <p class="tile-set"><span>${escapeHtml(card.set)} · ${escapeHtml(card.number)}</span></p>
        ${priceHtml}
      </div>
    </article>`;
    return wrap.firstElementChild;
  }

  // Dispatcher do pager: slab (graded) ou carta normal (variantTile).
  function makeAnyTile(pair) {
    const el = pair.graded ? makeGradedNode(pair, activeTab === "graded") : makeTile(pair);
    // Seleção em massa sobrevive ao re-render/paginação (o pager cria tiles aos poucos).
    if (bulkMode && !pair.graded && bulkSel.has(`${pair.card.id}|${pair.variant}`)) el.classList.add("bulk-selected");
    return el;
  }

  function renderCards({ resetCount = false } = {}) {
    // Tags: vitrine de tags / foco numa tag, na mesma área das Coleções.
    if (activeTab === "tags") {
      elements.grid.hidden = true;
      elements.folderSections.hidden = false;
      renderTags();
      return;
    }
    const isGradedTab = activeTab === "graded";
    const useFolders = activeTab === "folders";
    const ownedPairs = isGradedTab ? [] : ownedTilePairs();
    // "Graded" = só os slabs; "Toda Coleção" (cards) = slabs no topo + cartas
    // normais (os slabs aparecem junto da coleção). "Pastas" não mistura graded.
    const slabs = (isGradedTab || activeTab === "cards") ? gradedPairs() : [];
    // Aba "Toda Coleção": slabs + cartas normais ordenados JUNTOS (pelo seletor),
    // não os slabs grudados no topo. ownedPairs já vem ordenado (serve pras pastas);
    // pra grade do "cards" reordena a lista combinada. Graded tab também ordena.
    const tiles = isGradedTab ? sortTiles(slabs)
      : (activeTab === "cards" ? sortTiles(slabs.concat(ownedPairs)) : ownedPairs);
    updateCardsStats(tiles.length);
    elements.grid.hidden = useFolders;
    elements.folderSections.hidden = !useFolders;
    if (elements.newFolderBtn) elements.newFolderBtn.hidden = !useFolders || !!openFolderId;
    if (!useFolders) {
      elements.folderSections.innerHTML = "";
      pager.render(tiles, makeAnyTile, { resetCount });
      return;
    }
    renderFolderSections(ownedPairs);
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
    const open = openFolderId ? folders.get(openFolderId) : null;
    let sections;
    if (open) {
      // Coleção ABERTA: só ela (foco), pra não confundir com as outras.
      sections = [{ folder: open, games: folderGames.get(open.id), pairs: applyFolderOrder(open.id, groups.get(open.id) || []) }];
    } else {
      // Vitrine: todas as coleções (cards) + "Sem coleção".
      const visible = folders.list().filter((f) => {
        if (gameFilter === "all") return true;
        const gs = folderGames.get(f.id);
        return !gs || gs.size === 0 || gs.has(gameFilter);
      });
      sections = visible.map((f) => ({ folder: f, games: folderGames.get(f.id), pairs: applyFolderOrder(f.id, groups.get(f.id) || []) }));
      // "Sem coleção" OBEDECE o seletor Ordenar (os tiles já chegam ordenados):
      // é o bucket não-curado por definição. Ordem manual (arraste/‹›) fica só
      // nas coleções de verdade — antes, uma ordem manual antiga salva aqui
      // atropelava o Ordenar pra sempre e o usuário achava que ele quebrou.
      const noneTiles = groups.get("__none__") || [];
      if (noneTiles.length) sections.push({ folder: null, games: null, pairs: noneTiles });
    }
    elements.folderSections.innerHTML = sections.map(({ folder, pairs, games }) => folderSectionHtml(folder, pairs, games)).join("");
    sections.forEach(({ folder, pairs }) => {
      const sel = folder ? `[data-folder-id="${folder.id}"]` : ".folder-none";
      const grid = elements.folderSections.querySelector(`${sel} .card-grid`);
      if (!grid) return;
      pairs.forEach((pair) => {
        const node = makeTile(pair);
        node.draggable = true; // arrastável mesmo no "Sem coleção" (pra soltar numa coleção)
        // Setas ‹ › só nas coleções (o "Sem coleção" segue o Ordenar, não tem ordem manual).
        if (folder) (node.querySelector(".card-image") || node).appendChild(reorderControl());
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
    if (!section.dataset.folderId) return; // "Sem coleção": sem ordem manual
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
  // Cor que representa o jogo (Pokémon = vermelho da marca, Lorcana = roxo; misto =
  // neutro). Usada no badge e no fundo do título dos cards de showcase.
  function gameColor(games) {
    if (!games || games.size === 0) return "";
    if (games.size > 1) return "#5a6473";
    return shared.GAME_COLOR[games.values().next().value] || shared.GAME_COLOR.pokemon;
  }
  function folderTagHtml(games) {
    if (!games || games.size === 0) return "";
    let label;
    if (games.size > 1) label = t("folders.tag.mixed");
    else label = gameLabelOf(games.values().next().value);
    return `<span class="folder-tag" style="--tag:${gameColor(games)}">${escapeHtml(label)}</span>`;
  }
  // Título do card de showcase pintado na cor do jogo (classe + style inline).
  function gameTitleHtml(name, games) {
    const c = gameColor(games);
    return `<div class="coll-card-title${c ? " coll-card-title-game" : ""}"${c ? ` style="background:${c}"` : ""}><strong class="coll-card-name">${escapeHtml(name)}</strong></div>`;
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
    const isOpen = !isNone && folder.id === openFolderId; // aberta (foco) vs card
    const value = folderValue(pairs);
    // Valor embrulhado em .cm-val: o Modo Colecionador esconde só o "· R$ X"
    // e a contagem fica (é dado de coleção, não de preço).
    const meta = `${pairs.length}${value > 0 ? `<span class="cm-val"> · ${escapeHtml(shared.formatMoney(shared.getCurrency(), value))}</span>` : ""}`;
    const listCls = cardsView === "list" ? " is-list" : "";

    // CARD de coleção (vitrine): capa + nome + meta + estrelas. (Tudo que não é a
    // coleção aberta nem a seção "Sem coleção".)
    if (!isNone && !isOpen) {
      const cover = folderCoverCard(folder, pairs);
      const coverImg = cover
        ? shared.localizedImg(shared.cardImageSources(cover).url, { alt: "", fallback: shared.cardImageSources(cover).fallback, loading: "lazy", thumb: true })
        : `<span class="coll-card-empty">${escapeHtml(t("folders.empty"))}</span>`;
      return `<section class="folder-section is-collapsed coll-card" data-folder-id="${escapeAttribute(folder.id)}" draggable="true">
        ${gameTitleHtml(folder.name || t("folders.untitled"), games)}
        <button type="button" class="coll-card-cover" data-folder-collapse aria-label="${escapeAttribute(t("folders.toggle"))}">${coverImg}</button>
        <div class="coll-card-body">
          <div class="coll-card-meta-row">
            <span class="coll-card-meta">${meta}</span>
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
        ${pairs.length ? `<button type="button" class="folder-act folder-cover-btn" data-folder-cover title="${escapeAttribute(t("folders.cover"))}" aria-label="${escapeAttribute(t("folders.cover"))}">${COVER_ICON}<span>${escapeHtml(t("folders.cover"))}</span></button>` : ""}
        <button type="button" class="folder-act folder-share-btn" data-folder-share title="${escapeAttribute(t("folders.share"))}" aria-label="${escapeAttribute(t("folders.share"))}">${SHARE_ICON}<span>${escapeHtml(t("folders.shareBtn"))}</span></button>
        <button type="button" class="folder-act folder-act-danger folder-del-btn" data-folder-delete title="${escapeAttribute(t("folders.deleteBtn"))}" aria-label="${escapeAttribute(t("folders.deleteBtn"))}">${TRASH_ICON}<span>${escapeHtml(t("folders.deleteBtn"))}</span></button>
      </span>`;
    const pickHint = (!isNone && coverPickId === folder.id) ? `<p class="coll-cover-hint">${escapeHtml(t("folders.coverPick"))}</p>` : "";
    const backBtn = isOpen ? `<button type="button" class="secondary coll-back-btn" data-folder-back>← ${escapeHtml(t("folders.back"))}</button>` : "";
    return `<section class="folder-section${isNone ? " folder-none" : ""}${(!isNone && coverPickId === folder.id) ? " is-cover-pick" : ""}" data-folder-id="${escapeAttribute(isNone ? "" : folder.id)}">
      <header class="folder-head">
        ${backBtn}
        ${nameHtml}
        ${isNone ? "" : folderTagHtml(games)}
        <span class="folder-meta">${meta}</span>
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
        // "Sem coleção" não tem ordem manual (segue o Ordenar): soltar dentro
        // dela mesma é no-op — salvar uma ordem ignorada só confundiria.
        if (targetBucket === "__none__") { draggingId = null; return; }
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

  // Arrastar uma COLEÇÃO minimizada (card) pra reordenar a vitrine (desktop; o
  // touch usa as setas ↑↓). Usa um mime PRÓPRIO (não text/plain) pra não colidir
  // com o arraste de cartas do bindFolderDrag (que reatribuiria folder-id como carta).
  function bindCollectionDrag() {
    const sections = elements.folderSections;
    let dragId = null;
    const clearHints = () => sections.querySelectorAll(".coll-card.dropbefore").forEach((c) => c.classList.remove("dropbefore"));
    sections.addEventListener("dragstart", (event) => {
      if (event.target.closest(".card-tile")) return; // arraste de carta: outro handler
      const card = event.target.closest(".coll-card");
      if (!card) return;
      dragId = card.dataset.folderId;
      event.dataTransfer.effectAllowed = "move";
      try { event.dataTransfer.setData("application/x-coll", dragId); } catch (e) { /* Firefox exige algum setData */ }
      card.classList.add("coll-dragging");
    });
    sections.addEventListener("dragend", () => {
      sections.querySelectorAll(".coll-card.coll-dragging").forEach((c) => c.classList.remove("coll-dragging"));
      clearHints();
      dragId = null;
    });
    sections.addEventListener("dragover", (event) => {
      if (!dragId) return;
      const card = event.target.closest(".coll-card");
      if (!card || card.dataset.folderId === dragId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      clearHints();
      card.classList.add("dropbefore");
    });
    sections.addEventListener("drop", (event) => {
      if (!dragId) return;
      const card = event.target.closest(".coll-card");
      if (card && card.dataset.folderId !== dragId) {
        event.preventDefault();
        folders.reorderTo(dragId, card.dataset.folderId);
        dragId = null;
        renderCards();
        return;
      }
      dragId = null; clearHints();
    });
  }

  function ownedTilePairs() {
    const pairs = shared.cardVariantPairs(filterCards())
      .filter(({ card, variant }) => owned.variantTotal(card.id, variant) > 0);
    return sortTiles(pairs);
  }

  // Ordena os pares carta×variante conforme o seletor (mesma lógica do detalhe).
  function sortTiles(pairs) {
    // priceOf precisa casar com o VALOR EXIBIDO no tile: slab graded usa o valor
    // manual ou o gradedValue (mesma expressão do makeGradedNode); carta normal usa
    // o valor de mercado. Memoizado: 1 lookup por item, não por comparação.
    const priceOf = shared.memoValue((p) => p.graded
      ? (p.it.value > 0 ? p.it.value : (shared.gradedValue(p.card, p.it.company, p.it.grade).value || 0))
      : (shared.cardValue(p.card, p.variant, prices, shared.DEFAULT_CONDITION).value || 0));
    const byNum = (a, b) => shared.compareCardNumbers(a.card.number, b.card.number);
    if (cardsSort === "rarity-desc") pairs.sort((a, b) => shared.rarityRank(b.card.rarity) - shared.rarityRank(a.card.rarity) || byNum(a, b));
    else if (cardsSort === "rarity-asc") pairs.sort((a, b) => shared.rarityRank(a.card.rarity) - shared.rarityRank(b.card.rarity) || byNum(a, b));
    else if (cardsSort === "num-asc") pairs.sort(byNum);
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
    shared.applyGridViewClasses(elements.grid, cardsView);
    // Em modo pastas, cada seção tem sua própria grade.
    if (elements.folderSections) elements.folderSections.querySelectorAll(".card-grid").forEach((g) => shared.applyGridViewClasses(g, cardsView));
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
      if (tile.classList.contains("graded-tile")) return; // slab não é da store owned
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
    // Faixa de valor ("min-max" na moeda atual; max vazio = sem teto).
    const range = (elements.valueFilter && elements.valueFilter.value) || "";
    const [vMin, vMax] = range ? range.split("-").map((x) => (x === "" ? null : Number(x))) : [null, null];
    const valueOf = shared.memoValue((card) => shared.cardValue(card, shared.defaultVariant(card), prices, shared.DEFAULT_CONDITION).value || 0);

    return ownedCards().filter((card) => {
      const matchesQuery = shared.matchesCardQuery(card, elements.search.value);
      const matchesPokemon = !pokemonValue || (card.pokemonName || speciesName(card.name)) === pokemonValue;
      const matchesSet = !setValue || card.set === setValue;
      const matchesLanguage = !languageValue || shared.normalizeCardLanguage(card.language) === languageValue;
      const matchesRarity = !rarityValue || card.rarity === rarityValue;
      const matchesValue = !range || (function () { const v = valueOf(card); return (vMin == null || v >= vMin) && (vMax == null || v <= vMax); })();

      return matchesQuery && matchesPokemon && matchesSet && matchesLanguage && matchesRarity && matchesValue;
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
    // Aba de sets: mesma regra da tela de Sets — japonês aparece traduzido. Só o
    // RÓTULO muda; group.name segue sendo a chave do link (detailUrl abaixo).
    const nome = activeTab === "sets" && group.sample
      ? shared.setDisplayName(group.sample.setId, group.name, group.sample.language)
      : group.name;
    const body = `
      <div class="progress-row-art">${art}</div>
      <div class="progress-row-body">
        <div class="progress-row-title">
          <strong>${escapeHtml(nome)}</strong>
          ${dexTag}
          <span class="row-count">${group.ownedCount}/${group.totalCount}</span>
        </div>
        <div class="progress-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeAttribute(t("progress.aria", { name: nome }))}">
          <span style="width: ${Math.min(100, (group.ownedCount / group.totalCount) * 100)}%"></span>
        </div>
        <p class="progress-row-meta">${escapeHtml(`${tn("count.cards", group.totalCount)} · ${pct}%`)}</p>
      </div>
    `;

    if (tab.detailType) {
      return `<a class="progress-row" href="${escapeAttribute(detailUrl(tab.detailType, group.name, "collection", group.sample && group.sample.game))}">${body}</a>`;
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
      const link = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}collection?s=${res.id}`;
      try { await navigator.clipboard.writeText(link); alert(t("collection.share.copied")); }
      catch (e) { window.prompt(t("collection.share.copyManual"), link); }
    } else {
      alert(res && res.error === "auth" ? t("collection.share.needLogin") : t("collection.share.error"));
    }
  }


  // --- Imagem social da coleção (canvas, CSP-safe) ---
  // Gera um PNG "vitrine" pra postar em grupo/rede: top 9 cartas por valor +
  // stats + @handle + marca. Mesmo motor do export de Vendas: Lorcana/One Piece
  // não mandam CORS -> roteia pela wsrv.nl senão o canvas fica tainted.
  // SEM GATILHO NA UI hoje: o botão "Gerar imagem" saiu do cartão-herói
  // (2026-08-03, a pedido). A função fica pronta pra um re-homing futuro
  // (ex.: dentro de um menu de compartilhar).
  async function exportCollectionImage(button) {
    const pairs = [];
    ownedCards().forEach((card) => {
      (card.variants && card.variants.length ? card.variants : [shared.defaultVariant(card)]).forEach((variant) => {
        const q = owned.variantTotal(card.id, variant);
        if (q <= 0) return;
        const v = shared.cardValue(card, variant, prices, shared.DEFAULT_CONDITION).value || 0;
        pairs.push({ card, variant, value: v * q });
      });
    });
    if (!pairs.length) { alert(t("collection.noResults")); return; }
    pairs.sort((a, b) => b.value - a.value);
    // Uma entrada por CARTA (não repetir variantes da mesma na vitrine).
    const seen = new Set();
    const top = [];
    for (const p of pairs) { if (!seen.has(p.card.id)) { seen.add(p.card.id); top.push(p); if (top.length === 9) break; } }

    // O rótulo vive num <span> ao lado do ícone (ver collection.html).
    const labelEl = button ? (button.querySelector("span") || button) : null;
    const label = labelEl ? labelEl.textContent : "";
    if (button) { button.disabled = true; labelEl.textContent = "…"; }
    const cols = 3, rows = Math.ceil(top.length / cols);
    const CARD_W = 300, CARD_H = Math.round(CARD_W * 1.396), GAP = 20, MARGIN = 40, HEADER_H = 120, FOOTER_H = 52, RADIUS = 14;
    const width = MARGIN * 2 + cols * CARD_W + (cols - 1) * GAP;
    const height = MARGIN + HEADER_H + rows * CARD_H + (rows - 1) * GAP + FOOTER_H + MARGIN;
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    const FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    // Fundo escuro (vitrine): cartas saltam mais que no branco.
    ctx.fillStyle = "#12141a"; ctx.fillRect(0, 0, width, height);

    const p = shared.getProfile();
    const who = (p.displayName || "").trim() || (p.handle ? "@" + p.handle : t("collection.shareImage.mine"));
    const copies = owned.totalQuantity();
    const totalValue = pairs.reduce((s, x) => s + x.value, 0);
    ctx.fillStyle = "#f3f5f7"; ctx.font = `800 40px ${FONT}`; ctx.textBaseline = "top";
    ctx.fillText(who, MARGIN, MARGIN);
    ctx.fillStyle = "#9ba4b3"; ctx.font = `600 22px ${FONT}`;
    ctx.fillText(`${tn("count.cards", copies)} · ${shared.formatMoney(shared.getCurrency(), totalValue)}`, MARGIN, MARGIN + 52);

    const { drawCover, roundRect, imagemDaCarta } = shared.canvasCardHelpers(ctx);

    for (let i = 0; i < top.length; i++) {
      const { card } = top[i];
      const x = MARGIN + (i % cols) * (CARD_W + GAP);
      const y = MARGIN + HEADER_H + Math.floor(i / cols) * (CARD_H + GAP);
      ctx.save();
      roundRect(x, y, CARD_W, CARD_H, RADIUS); ctx.fillStyle = "#1d2028"; ctx.fill(); ctx.clip();
      const img = await imagemDaCarta(card);
      if (img) drawCover(img, x, y, CARD_W, CARD_H);
      ctx.restore();
      ctx.save(); roundRect(x, y, CARD_W, CARD_H, RADIUS); ctx.strokeStyle = "#2d333f"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
    }
    ctx.fillStyle = "#747d8d"; ctx.font = `700 22px ${FONT}`; ctx.textBaseline = "alphabetic";
    ctx.fillText("Sleevu · sleevu.app", MARGIN, height - MARGIN + 6);

    // share: no celular manda direto pro WhatsApp/rede em vez de baixar.
    shared.baixarCanvasPng(canvas, "colecao-sleevu.png", {
      share: true,
      onFinish: () => { if (button) { button.disabled = false; labelEl.textContent = label; } },
      onTainted: () => alert(t("sales.exportTainted"))
    });
  }

  function bindShareButton() {
    const btn = document.getElementById("collectionShareBtn");
    if (!btn) return;
    btn.hidden = ownedCards().length === 0;
    btn.addEventListener("click", async () => {
      const original = t("collection.share");
      // Botão SÓ-ÍCONE: o rótulo vive num <span> escondido (leitor de tela +
      // aria-live); o feedback VISUAL de sucesso é o ✓ no lugar do ícone.
      const setLabel = (txt) => { (btn.querySelector("span") || btn).textContent = txt; };
      const setOk = (on) => btn.classList.toggle("is-ok", !!on);
      // Perfil público: compartilha o link VIVO (sempre atualizado) em vez de um
      // snapshot. Sem perfil público, cai no snapshot de sempre.
      const live = shared.publicProfileUrl();
      if (live) {
        try { await navigator.clipboard.writeText(live); setLabel(t("collection.share.copiedLive")); setOk(true); }
        catch (e) { window.prompt(t("collection.share.copyManual"), live); }
        setTimeout(() => { setLabel(original); setOk(false); }, 2500);
        return;
      }
      btn.disabled = true; setLabel(t("collection.share.creating"));
      const res = await shared.createShare("collection", null, buildShareData());
      btn.disabled = false;
      if (res && res.id) {
        const link = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}collection?s=${res.id}`;
        try { await navigator.clipboard.writeText(link); setLabel(t("collection.share.copied")); setOk(true); }
        catch (e) { window.prompt(t("collection.share.copyManual"), link); setLabel(original); }
      } else {
        alert(res && res.error === "auth" ? t("collection.share.needLogin") : t("collection.share.error"));
        setLabel(original);
      }
      setTimeout(() => { setLabel(original); setOk(false); }, 2500);
    });
  }

  function sharedTile(it) {
    const img = shared.localizedImg(it.img, { alt: it.n, fallback: it.fb, loading: "lazy", thumb: true });
    const flag = shared.cardFlag(it.lang);
    // Graded: mostra o valor graded (gv). Venda: o PREÇO DE VENDA (sp). Senão, mercado.
    let priceHtml = "";
    if (it.gv != null && it.gv > 0) {
      priceHtml = `<p class="tile-price sale-price-tag">${escapeHtml(shared.formatMoney(it.cur || "BRL", it.gv))}</p>`;
    } else if (it.sp != null && it.sp > 0) {
      priceHtml = `<p class="tile-price sale-price-tag">${escapeHtml(shared.formatMoney(it.cur || "BRL", it.sp))}</p>`;
    } else {
      const val = fromBRL(it.vbrl || 0);
      if (val > 0) priceHtml = `<p class="tile-price">${escapeHtml(shared.formatMoney(shared.getCurrency(), val))}</p>`;
    }
    // Slab graduado: MESMO visual da coleção (makeGradedNode) — imagem limpa e o
    // badge da graduadora (cor do slab) na linha da variante, em vez do overlay.
    if (it.co) {
      return `<article class="card-tile graded-tile graded-grid-tile shared-tile">
        <div class="card-image"><button type="button" class="image-open" data-preview-card-id="${escapeAttribute(it.id)}" data-preview-variant="${escapeAttribute(it.v)}" aria-label="${escapeAttribute(t("card.zoom", { name: it.n }))}">${img}</button></div>
        <div class="tile-info">
          <h3>${escapeHtml(it.n)}</h3>
          <p class="tile-variant">${flag}${shared.gradedBadgeHtml({ company: it.co, grade: it.gr, pristine: it.pr })}</p>
          <p class="tile-set"><span>${escapeHtml(it.s)} · ${escapeHtml(it.num)}</span></p>
          ${priceHtml}
        </div>
      </article>`;
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
    [elements.tabs, elements.groupsView, elements.cardsView, elements.dashboard, document.getElementById("collectionShareBtn"), document.getElementById("collectionOnboarding")].forEach((el) => { if (el) el.hidden = true; });
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
    const isTag = share.data.scope === "tag";        // lista/showcase de uma tag
    const isSale = share.data.scope === "sale";      // lista de vendas
    const isGraded = share.data.scope === "graded";  // cartas graduadas (slabs)
    const saleCur = share.data.cur || "BRL";
    // Total: venda/graded somam o valor (sp/gv) na moeda do dono; senão valor de mercado.
    const bannerTotal = isGraded
      ? allItems.reduce((s, it) => s + (Number(it.gv) || 0), 0)
      : isSale
        ? allItems.reduce((s, it) => s + (Number(it.sp) || 0) * (it.q || 1), 0)
        : allItems.reduce((s, it) => s + fromBRL(it.vbrl || 0) * (it.q || 1), 0);
    const bannerMoney = (isSale || isGraded) ? shared.formatMoney(saleCur, bannerTotal) : shared.formatMoney(shared.getCurrency(), bannerTotal);
    const kindLabel = isGraded ? t("graded.shared.label") : isSale ? t("sales.shared.label") : isTag ? t("tags.shared.label") : (isFolder ? t("folders.shared.label") : "");

    // Filtro de jogo (Todos/Pokémon/Lorcana) — igual à página da coleção. Só
    // aparece quando o share tem MAIS DE UM jogo, pra quem está vendo conseguir
    // separar as coleções. O dashboard e a grade reagem ao filtro.
    const gamesPresent = [...new Set(allItems.map((it) => it.g).filter(Boolean))];
    let sharedFilter = "all";
    const filterHtml = gamesPresent.length > 1
      ? `<div class="collection-toolbar"><div id="sharedGameFilter" class="chip-filter game-filter" role="group" aria-label="Jogo">
          <button type="button" class="chip" data-game-filter="all" aria-pressed="true">${escapeHtml(t("filter.gameAll"))}</button>
          ${shared.GAME_SLUGS.map((g) => `<button type="button" class="chip" data-game-filter="${g}" aria-pressed="false">${escapeHtml(gameLabelOf(g))}</button>`).join("")}
        </div></div>`
      : "";

    // Perfil (aba Coleção): SEM banner — o cabeçalho (nome/@/botão Vendas) vai pro
    // card de stats. Demais casos (vendas do perfil, pasta, share normal) usam banner.
    const banner = (profileNav && profileNav.identityInDash) ? "" : `
      <div class="binder-shared-banner">
        <div class="binder-shared-info">
          ${kindLabel ? `<span class="shared-kind">${escapeHtml(kindLabel)}</span>` : ""}
          ${profileNav ? `<a class="shared-kind" href="/users/${escapeAttribute(profileNav.handle)}">@${escapeHtml(profileNav.handle)}</a>` : ""}
          ${profileNav ? "" : `<strong>${isTag && share.data.color ? `<span class="tag-dot" style="--tag:${shared.safeColor(share.data.color)}"></span> ` : ""}${escapeHtml(share.title || t("collection.shared.title"))}</strong>`}
          <span>${escapeHtml(tn("collection.shared.banner", allItems.length))} · ${escapeHtml(bannerMoney)}</span>
        </div>
        ${profileNav && profileNav.label
          ? `<button type="button" class="secondary" data-profile-nav>${escapeHtml(profileNav.label)}</button>`
          : (isFolder || isTag ? `<button type="button" class="primary" id="sharedSaveBtn">${escapeHtml(t(isTag ? "tags.shared.save" : "folders.shared.save"))}</button>` : "")}
      </div>`;
    sv.innerHTML = `${(profileNav && profileNav.tabsHtml) || ""}${banner}${filterHtml}<div id="sharedBody"></div>`;

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
        window.location.href = "collection"; // abre a coleção da pessoa
      });
    }

    // "Salvar na minha coleção" de uma TAG compartilhada (links antigos: quem
    // compartilhou ainda estava na versão com tags): vira uma LISTA, não uma
    // tag. Gravar no blob legado hoje seria escrever num formato que a UI não
    // mostra mais — a migração até resgataria depois, mas por um caminho torto.
    if (isTag) {
      const saveBtn = document.getElementById("sharedSaveBtn");
      if (saveBtn) saveBtn.addEventListener("click", () => {
        const name = share.title || t("tags.untitled");
        const listas = shared.createListStore();
        if (listas.atLimit()) { alert(t("lists.limit", { n: listas.LIST_LIMIT })); return; }
        if (!window.confirm(t("tags.shared.saveConfirm", { n: allItems.length, name }))) return;
        // Vinculada: a lista compartilhada afirma posse, e as cartas entram na
        // coleção logo abaixo — é a mesma semântica da tag que ela substitui.
        const lista = listas.create({ name, color: share.data.color, linked: true });
        if (!lista) { alert(t("lists.limit", { n: listas.LIST_LIMIT })); return; }
        allItems.forEach((it) => {
          const store = ownedByGame[it.g] || ownedByGame.pokemon;
          if (store) store.add(it.id, it.v, shared.DEFAULT_CONDITION, it.q || 1);
          listas.addEntry(lista.id, it.id, { v: it.v, q: it.q || 1 });
        });
        alert(t("tags.shared.saved"));
        window.location.href = `listas?id=${encodeURIComponent(lista.id)}`;
      });
    }

    // (Re)desenha dashboard + grade conforme o filtro de jogo ativo. Venda não
    // tem dashboard (é só a lista de cartas + preços).
    function paintShared() {
      const items = sharedFilter === "all" ? allItems : allItems.filter((it) => (it.g || "pokemon") === sharedFilter);
      const total = items.reduce((s, it) => s + fromBRL(it.vbrl || 0) * (it.q || 1), 0);
      const dash = (isSale || isGraded) ? "" : sharedDashboardHtml(items, total, profileNav);
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
    // null-proto: `it.g` vem do share de OUTRO usuário. Com {} um g="constructor"
    // fazia idsByGame[g] cair no Object.prototype.constructor (função), o `.push`
    // dava TypeError FORA do try abaixo e o preview parava de abrir. Aqui não há proto.
    const idsByGame = Object.create(null);
    allItems.forEach((it) => { const g = it.g || "pokemon"; (idsByGame[g] = idsByGame[g] || []).push(it.id); });
    try {
      const catalog = await shared.loadOwnedAcrossGames(idsByGame);
      (catalog.cards || []).forEach((card) => { cardsById.set(card.id, card); cardGameMap.set(card.id, card.game); });
    } catch (e) { /* sem catálogo: tiles seguem, só o preview não abre */ }
  }

  // Perfil público (/users/<handle> → ?u=). Layout espelha a coleção do dono:
  // DASHBOARD fixo no topo (identidade + stats, persistente) → ABAS (Toda Coleção /
  // Coleções / Vendas) → conteúdo. Auto-contido (payload curado, tiles em string).
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
    const collFolders = (Array.isArray(prof.data.folders) ? prof.data.folders : [])
      .filter((f) => col.items.some((it) => it.f === f.id))
      .sort((a, b) => (b.stars || 0) - (a.stars || 0));
    const hasFolders = collFolders.length > 0;
    const gradedList = (prof.data.graded && Array.isArray(prof.data.graded.items)) ? prof.data.graded.items : [];
    const setsMeta = (prof.data.setsMeta && typeof prof.data.setsMeta === "object") ? prof.data.setsMeta : {};
    const speciesTotals = (prof.data.speciesTotals && typeof prof.data.speciesTotals === "object") ? prof.data.speciesTotals : {};
    const artistTotals = (prof.data.artistTotals && typeof prof.data.artistTotals === "object") ? prof.data.artistTotals : {};
    const tagDefs = Array.isArray(prof.data.tags) ? prof.data.tags : [];
    const hasGraded = gradedList.length > 0;
    const hasTags = tagDefs.length > 0 && col.items.some((it) => (it.tg || []).length);
    const hasArtists = col.items.some((it) => it.a);
    const hasPokemon = col.items.some((it) => (it.g || "pokemon") === "pokemon");
    const hasSets = col.items.length > 0;
    const gamesPresent = [...new Set(col.items.map((it) => it.g).filter(Boolean))];
    const GROUPED = ["vitrine", "tags", "pokemon", "artists", "sets"]; // abas de grupos
    const PROGRESS_MODES = ["pokemon", "artists", "sets"]; // grupos em linha de progresso
    // ?t= abre direto numa aba (links "ver no perfil" de Vendas/Graded).
    const tParam = collParams.get("t");
    let mode = (hasSales && tParam === "sales") ? "sale"
      : (hasGraded && tParam === "graded") ? "graded"
      : "collection";
    let openId = null; // grupo aberto (coleção/tag/artista/set)
    let gFilter = "all";
    let cardSort = "value-desc"; // ordenação (em memória)
    // Filtros da aba "Toda Coleção" (mesmos da tela de Coleção): espécie, set,
    // idioma, raridade + visualização (grade/lista). Em memória.
    let fPokemon = "", fSet = "", fLang = "", fRarity = "", cardView = "grid";
    let groupSort = "name"; // abas de progresso (Sets/Pokémon/Artistas): "name" | "progress"
    // Valor por item (na moeda atual): coleção em BRL (vbrl), graded/venda já na
    // moeda do dono (gv/sp). Dentro de cada modo os itens são homogêneos.
    const itemVal = (it) => it.vbrl != null ? fromBRL(it.vbrl) : (it.gv != null ? it.gv : (it.sp || 0));
    function sortItems(arr) {
      const c = arr.slice();
      if (cardSort === "num-asc") c.sort((a, b) => shared.compareCardNumbers(a.num, b.num));
      else if (cardSort === "num-desc") c.sort((a, b) => shared.compareCardNumbers(b.num, a.num));
      else {
        const val = shared.memoValue(itemVal); // 1 conversão de moeda por item, não por comparação
        c.sort((a, b) => {
          const pa = val(a), pb = val(b);
          if (cardSort === "value-asc") { if (!pa && !pb) return 0; if (!pa) return 1; if (!pb) return -1; return pa - pb; }
          return pb - pa;
        });
      }
      return c;
    }
    // Espécie/personagem do item (igual à Coleção): pokemonName ou derivado do nome.
    const speciesOf = (it) => it.pk || speciesName(it.n);
    // Aplica os filtros da barra (só na aba Toda Coleção).
    function applyColFilters(items) {
      return items.filter((it) =>
        (!fPokemon || speciesOf(it) === fPokemon) &&
        (!fSet || it.s === fSet) &&
        (!fLang || (it.lang || "") === fLang) &&
        (!fRarity || (it.r || "") === fRarity));
    }
    function sortGroupsByValue(groups) {
      // Soma do grupo pré-computada 1x (o reduce por comparação era O(n·g log g)).
      const gv = shared.memoValue((gp) => gp.items.reduce((s, it) => s + itemVal(it) * (it.q || 1), 0));
      return groups.slice().sort((a, b) => cardSort === "value-asc" ? gv(a) - gv(b) : gv(b) - gv(a));
    }

    function tabsHtml() {
      const tab = (m, label, on) => on ? `<button type="button" class="prof-tab${mode === m ? " is-active" : ""}" data-profile-tab="${m}">${escapeHtml(label)}</button>` : "";
      // O seletor de ordenação sai da fileira das abas e vai pra uma linha
      // própria, alinhado à direita. Dentro do .prof-tabs ele virava mais uma
      // coluna da grade — e com colunas de largura IGUAL (que é o que alinha as
      // abas de ponta a ponta) um <select> do tamanho de uma aba fica estranho
      // e ainda rouba espaço dos rótulos.
      const sortHtml = (mode !== "collection" && PROGRESS_MODES.indexOf(mode) < 0)
        ? `<div class="prof-sortrow"><select class="prof-sort" data-profile-sort aria-label="${escapeAttribute(t("sort.label"))}">
            <option value="value-desc"${cardSort === "value-desc" ? " selected" : ""}>${escapeHtml(t("sort.valueDesc"))}</option>
            <option value="value-asc"${cardSort === "value-asc" ? " selected" : ""}>${escapeHtml(t("sort.valueAsc"))}</option>
          </select></div>`
        : "";
      return `<div class="prof-tabs">
        ${tab("collection", t("nav.collection"), true)}
        ${tab("vitrine", t("collection.tab.folders"), hasFolders)}
        ${tab("graded", t("nav.graded"), hasGraded)}
        ${tab("tags", t("collection.tab.tags"), hasTags)}
        ${tab("pokemon", t("collection.tab.pokemon"), hasPokemon)}
        ${tab("artists", t("collection.tab.artists"), hasArtists)}
        ${tab("sets", t("collection.tab.sets"), hasSets)}
        ${tab("sale", t("nav.sales"), hasSales)}
      </div>${sortHtml}`;
    }

    // Barra de filtros da aba "Toda Coleção" — MESMOS filtros da tela de Coleção
    // (Pokémon/Personagem, Set, Idioma, Raridade, Ordenar, Visualização).
    function filterBarHtml() {
      if (mode !== "collection") return "";
      const pool = col.items.filter((it) => gFilter === "all" || (it.g || "pokemon") === gFilter);
      const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));
      const opts = (values, sel, fmt) => `<option value="">${escapeHtml(t("filter.all.m"))}</option>` +
        values.map((v) => `<option value="${escapeAttribute(v)}"${v === sel ? " selected" : ""}>${escapeHtml(fmt ? fmt(v) : v)}</option>`).join("");
      const pkLabel = gFilter !== "pokemon" && gFilter !== "all" ? t("toolbar.characters") : t("toolbar.pokemon");
      const species = uniq(pool.map(speciesOf)).sort((a, b) => a.localeCompare(b));
      const sets = uniq(pool.map((it) => it.s)).sort((a, b) => a.localeCompare(b));
      const langs = uniq(pool.map((it) => it.lang));
      const rarities = uniq(pool.map((it) => it.r)).sort((a, b) => a.localeCompare(b));
      const sortOpt = (v, k) => `<option value="${v}"${cardSort === v ? " selected" : ""}>${escapeHtml(t(k))}</option>`;
      return `<section class="toolbar prof-toolbar" aria-label="${escapeAttribute(t("sort.label"))}">
        <div><label>${escapeHtml(pkLabel)}</label><select data-pf-filter="pokemon">${opts(species, fPokemon)}</select></div>
        <div><label>${escapeHtml(t("toolbar.set"))}</label><select data-pf-filter="set">${opts(sets, fSet)}</select></div>
        <div><label>${escapeHtml(t("toolbar.language"))}</label><select data-pf-filter="lang">${opts(langs, fLang, langOptionLabel)}</select></div>
        <div><label>${escapeHtml(t("toolbar.rarity"))}</label><select data-pf-filter="rarity">${(`<option value="">${escapeHtml(t("filter.all.f"))}</option>` + rarities.map((v) => `<option value="${escapeAttribute(v)}"${v === fRarity ? " selected" : ""}>${escapeHtml(v)}</option>`).join(""))}</select></div>
        <div class="sort-select"><label>${escapeHtml(t("sort.label"))}</label><select data-profile-sort>
          ${sortOpt("value-desc", "sort.valueDesc")}${sortOpt("value-asc", "sort.valueAsc")}${sortOpt("num-asc", "sort.numAsc")}${sortOpt("num-desc", "sort.numDesc")}
        </select></div>
        <div class="view-toggle-field"><label>${escapeHtml(t("toolbar.view"))}</label>
          <div class="view-toggle" role="group">
            <button type="button" class="view-toggle-btn" data-pf-view="grid" aria-pressed="${cardView === "grid"}" title="${escapeAttribute(t("toolbar.view"))}">▦</button>
            <button type="button" class="view-toggle-btn" data-pf-view="list" aria-pressed="${cardView === "list"}" title="${escapeAttribute(t("toolbar.view"))}">≣</button>
          </div>
        </div>
      </section>`;
    }
    // Dashboard SEMPRE da coleção (visão geral do perfil); reage ao filtro de jogo.
    function dashHtml() {
      const items = gFilter === "all" ? col.items : col.items.filter((it) => (it.g || "pokemon") === gFilter);
      // Total = cartas raw + slabs graded (igual à Minha Coleção). gv vem na moeda
      // do dono; converte pra moeda atual. Antes o graded ficava de fora (link < coleção).
      const cur = shared.getCurrency();
      const rawTotal = items.reduce((s, it) => s + fromBRL(it.vbrl || 0) * (it.q || 1), 0);
      const gradedTotal = gradedList
        .filter((it) => gFilter === "all" || (it.g || "pokemon") === gFilter)
        .reduce((s, it) => { const v = shared.convertMoney(it.gv || 0, it.cur || "BRL", cur); return s + (v == null ? (it.gv || 0) : v); }, 0);
      return sharedDashboardHtml(items, rawTotal + gradedTotal, { name, handle: prof.handle });
    }
    function gameFilterHtml() {
      if (gamesPresent.length <= 1) return "";
      const chip = (g, label) => `<button type="button" class="chip" data-game-filter="${g}" aria-pressed="${gFilter === g}">${escapeHtml(label)}</button>`;
      return `<div class="collection-toolbar"><div id="sharedGameFilter" class="chip-filter game-filter" role="group" aria-label="Jogo">
        ${chip("all", t("filter.gameAll"))}${shared.GAME_SLUGS.map((g) => chip(g, gameLabelOf(g))).join("")}
      </div></div>`;
    }
    // Grupos das abas-vitrine (Coleções/Tags/Artistas/Sets): {id,name,color?,stars?,cover?,items}.
    function groupsFor(m) {
      const inG = (it) => gFilter === "all" || (it.g || "pokemon") === gFilter;
      if (m === "vitrine") return collFolders.map((f) => ({ id: f.id, name: f.name || t("folders.untitled"), stars: f.stars || 0, cover: f.cover, items: col.items.filter((it) => it.f === f.id && inG(it)) })).filter((gp) => gp.items.length);
      if (m === "tags") return tagDefs.map((tg) => ({ id: tg.id, name: tg.name || t("tags.untitled"), color: tg.color, items: col.items.filter((it) => (it.tg || []).indexOf(tg.id) >= 0 && inG(it)) })).filter((gp) => gp.items.length);
      if (m === "pokemon") return [...new Set(col.items.map(speciesOf).filter(Boolean))].map((sp) => ({ id: sp, name: sp, items: col.items.filter((it) => speciesOf(it) === sp && inG(it)) })).filter((gp) => gp.items.length);
      if (m === "artists") return [...new Set(col.items.map((it) => it.a).filter(Boolean))].sort().map((a) => ({ id: a, name: a, items: col.items.filter((it) => it.a === a && inG(it)) })).filter((gp) => gp.items.length);
      if (m === "sets") return [...new Set(col.items.map((it) => it.s).filter(Boolean))].sort().map((s) => ({ id: s, name: s, items: col.items.filter((it) => it.s === s && inG(it)) })).filter((gp) => gp.items.length);
      return [];
    }
    // Abas Sets/Pokémon/Artistas: MESMO visual da Coleção (linhas de progresso com
    // arte + possuídas/total + barra + %). Totais vêm do payload (setsMeta / species
    // Totals / artistTotals). Denominador = total do catálogo; se faltar, = possuídas.
    function groupsProgressHtml(mode) {
      const fmtPct = (p) => (p >= 10 ? Math.round(p) : Math.round(p * 10) / 10);
      const totalOf = (name) => mode === "sets" ? ((setsMeta[name] && setsMeta[name].t) || 0)
        : mode === "pokemon" ? (speciesTotals[name] || 0) : (artistTotals[name] || 0);
      const artOf = (gp) => {
        const initial = `<span class="progress-row-initial">${escapeHtml((gp.name || "?").charAt(0).toUpperCase())}</span>`;
        if (mode === "sets") { const sy = setsMeta[gp.name] && setsMeta[gp.name].sy; return sy ? shared.localizedImg(sy, { loading: "lazy" }) : initial; }
        if (mode === "pokemon") { const it = gp.items.find((x) => x.dx); return it ? `<img loading="lazy" src="${escapeAttribute(shared.spriteUrl(it.dx))}" alt="">` : initial; }
        return initial; // artistas
      };
      const groups = groupsFor(mode).map((gp) => {
        const ownedN = new Set(gp.items.map((it) => it.id)).size;
        const total = Math.max(ownedN, totalOf(gp.name));
        return { gp, ownedN, total, pct: total ? (ownedN / total) * 100 : 0 };
      });
      if (groupSort === "progress") groups.sort((a, b) => b.pct - a.pct || a.gp.name.localeCompare(b.gp.name));
      else groups.sort((a, b) => a.gp.name.localeCompare(b.gp.name));
      const ownedSum = groups.reduce((s, g) => s + g.ownedN, 0);
      const totalSum = groups.reduce((s, g) => s + g.total, 0);
      const overallPct = totalSum ? fmtPct((ownedSum / totalSum) * 100) : 0;
      const chip = (v, k) => `<button type="button" class="chip" data-group-sort="${v}" aria-pressed="${groupSort === v}">${escapeHtml(t(k))}</button>`;
      const rows = groups.map((g) => `<button type="button" class="progress-row" data-vitrine-open="${escapeAttribute(g.gp.id)}">
          <div class="progress-row-art">${artOf(g.gp)}</div>
          <div class="progress-row-body">
            <div class="progress-row-title"><strong>${escapeHtml(g.gp.name)}</strong><span class="row-count">${g.ownedN}/${g.total}</span></div>
            <div class="progress-bar"><span style="width:${Math.min(100, g.pct).toFixed(1)}%"></span></div>
            <p class="progress-row-meta">${escapeHtml(tn("count.cards", g.total) + " · " + fmtPct(g.pct) + "%")}</p>
          </div>
        </button>`).join("");
      return `<div class="group-summary">
          <div class="group-summary-row"><strong>${escapeHtml(tn("collection.summary." + mode, groups.length, { o: ownedSum, t: totalSum }))}</strong><span class="summary-pct">${overallPct}%</span></div>
          <div class="progress-bar"><span style="width:${Math.min(100, totalSum ? (ownedSum / totalSum) * 100 : 0).toFixed(1)}%"></span></div>
        </div>
        <div class="sort-row"><span>${escapeHtml(t("sort.label"))}</span><div class="chip-filter">${chip("name", "sort.name")}${chip("progress", "sort.progress")}</div></div>
        <div class="progress-row-list">${rows}</div>`;
    }
    // Card de grupo (somente leitura): capa + nome + meta (+ estrelas/cor quando houver).
    function groupCard(gp, mode) {
      const copies = gp.items.reduce((s, it) => s + (it.q || 1), 0);
      const val = gp.items.reduce((s, it) => s + fromBRL(it.vbrl || 0) * (it.q || 1), 0);
      const metaTxt = `${copies}${val > 0 ? `<span class="cm-val"> · ${escapeHtml(shared.formatMoney(shared.getCurrency(), val))}</span>` : ""}`;
      let cover = gp.cover ? gp.items.find((it) => it.id === gp.cover) : null;
      if (!cover) cover = gp.items.slice().sort((a, b) => (b.vbrl * b.q) - (a.vbrl * a.q))[0];
      const coverImg = cover ? shared.localizedImg(cover.img, { alt: "", fallback: cover.fb, loading: "lazy", thumb: true }) : `<span class="coll-card-empty">—</span>`;
      let stars = ""; if (gp.stars != null) for (let i = 1; i <= 3; i++) stars += `<span class="coll-star${i <= (gp.stars || 0) ? " on" : ""}">★</span>`;
      const gset = new Set(gp.items.map((it) => it.g).filter(Boolean));
      const dot = gp.color ? `<span class="tag-dot" style="background:${shared.safeColor(gp.color)}"></span>` : "";
      const gc = (mode === "vitrine" && !gp.color) ? gameColor(gset) : ""; // cor do jogo SÓ no showcase
      return `<button type="button" class="coll-card coll-card-ro${gp.color ? " tag-card" : ""}"${gp.color ? ` style="--tag:${shared.safeColor(gp.color)}"` : ""} data-vitrine-open="${escapeAttribute(gp.id)}">
        <span class="coll-card-title${gc ? " coll-card-title-game" : ""}"${gc ? ` style="background:${gc}"` : ""}>${dot}<strong class="coll-card-name">${escapeHtml(gp.name)}</strong></span>
        <span class="coll-card-cover">${coverImg}</span>
        <span class="coll-card-body">
          <span class="coll-card-meta-row"><span class="coll-card-meta">${metaTxt}</span>${folderTagHtml(gset)}</span>
          ${gp.stars != null ? `<span class="coll-stars">${stars}</span>` : ""}
        </span>
      </button>`;
    }
    function contentHtml() {
      if (mode === "graded") {
        const items = gradedList.filter((it) => gFilter === "all" || (it.g || "pokemon") === gFilter);
        return `<div class="card-grid">${sortItems(items).map(sharedTile).join("")}</div>`;
      }
      if (mode === "sale") {
        const items = sale.items.filter((it) => gFilter === "all" || (it.g || "pokemon") === gFilter);
        return `<div class="card-grid">${sortItems(items).map(sharedTile).join("")}</div>`;
      }
      if (GROUPED.indexOf(mode) >= 0) {
        const groups = groupsFor(mode);
        if (openId) { const gp = groups.find((x) => x.id === openId); return `<div class="card-grid">${sortItems(gp ? gp.items : []).map(sharedTile).join("")}</div>`; }
        if (PROGRESS_MODES.indexOf(mode) >= 0) return groupsProgressHtml(mode);
        return `<div class="coll-vitrine">${sortGroupsByValue(groups).map((gp) => groupCard(gp, mode)).join("")}</div>`;
      }
      const base = gFilter === "all" ? col.items : col.items.filter((it) => (it.g || "pokemon") === gFilter);
      const items = applyColFilters(base);
      const grid = items.length
        ? sortItems(items).map(sharedTile).join("")
        : `<p class="empty-state">${escapeHtml(t("collection.noResults"))}</p>`;
      return `<div class="card-grid${cardView === "list" ? " is-list" : ""}">${grid}</div>`;
    }

    // "Voltar" (dentro de um grupo aberto: coleção/tag/artista/set).
    function backHtml() {
      const grouped = GROUPED.indexOf(mode) >= 0 && openId;
      if (!grouped) return "";
      const openName = (groupsFor(mode).find((x) => x.id === openId) || {}).name || "";
      return `<div class="coll-open-head"><button type="button" class="secondary coll-back-btn" data-vitrine-back>${escapeHtml(t("profile.viewCollections"))}</button><strong class="coll-open-name">${escapeHtml(openName)}</strong></div>`;
    }
    // Tudo ABAIXO do dashboard (abas + barra de filtros + voltar + conteúdo). Trocar
    // de aba re-renderiza SÓ isto — o dashboard fica intacto no DOM (não "pula").
    function swapHtml() {
      return `${tabsHtml()}${filterBarHtml()}${backHtml()}<div class="prof-content">${contentHtml()}</div>`;
    }
    function render() {
      shared.applyGameAccent(gFilter); // o filtro de jogo muda as cores (accent), por isso fica no topo
      // Topo PERSISTENTE (filtro de jogo + dashboard) + bloco trocável (.prof-swap).
      sv.innerHTML = `${gameFilterHtml()}<div class="prof-dash">${dashHtml()}</div><div class="prof-swap">${swapHtml()}</div>`;
    }
    // Troca de aba / abrir grupo / voltar: reconstrói só o bloco abaixo do dashboard
    // (abas+conteúdo), mantendo o dashboard e o filtro de jogo fixos no lugar.
    function renderSwap() {
      const el = sv.querySelector(".prof-swap");
      if (el) el.innerHTML = swapHtml(); else render();
    }
    // Re-render PARCIAL: filtro/ordenação/visualização só trocam as cartas — não
    // reconstrói dashboard/abas/barra (mais rápido e preserva o foco nos selects).
    function renderContent() {
      const el = sv.querySelector(".prof-content");
      if (el) el.innerHTML = contentHtml(); else render();
    }

    // Delegação no container (sobrevive aos re-renders): abas, vitrine, filtro, preview.
    sv.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-profile-tab]");
      if (tab) { mode = tab.dataset.profileTab; openId = null; renderSwap(); return; }
      const open = event.target.closest("[data-vitrine-open]");
      if (open) { openId = open.dataset.vitrineOpen; renderSwap(); return; }
      if (event.target.closest("[data-vitrine-back]")) { openId = null; renderSwap(); return; }
      const chip = event.target.closest("[data-game-filter]");
      if (chip) { gFilter = chip.dataset.gameFilter; fPokemon = fSet = fLang = fRarity = ""; render(); return; }
      const vw = event.target.closest("[data-pf-view]");
      if (vw) {
        cardView = vw.dataset.pfView === "list" ? "list" : "grid";
        sv.querySelectorAll("[data-pf-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pfView === cardView)));
        renderContent(); return;
      }
      const ss = event.target.closest("[data-group-sort]");
      if (ss) { groupSort = ss.dataset.groupSort; renderContent(); return; }
      const card = event.target.closest("[data-preview-card-id]");
      if (card) preview.open(card.dataset.previewCardId, card.dataset.previewVariant);
    });
    sv.addEventListener("change", (event) => {
      const sortSel = event.target.closest("[data-profile-sort]");
      if (sortSel) { cardSort = sortSel.value; renderContent(); return; }
      const ff = event.target.closest("[data-pf-filter]");
      if (ff) {
        const k = ff.dataset.pfFilter;
        if (k === "pokemon") fPokemon = ff.value; else if (k === "set") fSet = ff.value;
        else if (k === "lang") fLang = ff.value; else if (k === "rarity") fRarity = ff.value;
        renderContent(); // as opções da barra não dependem dos filtros escolhidos
      }
    });
    render();

    // Catálogo das cartas do perfil, p/ o preview abrir com o detalhe completo.
    const idsByGame = {};
    col.items.concat(sale.items).forEach((it) => { const g = it.g || "pokemon"; (idsByGame[g] = idsByGame[g] || []).push(it.id); });
    try {
      const catalog = await shared.loadOwnedAcrossGames(idsByGame);
      (catalog.cards || []).forEach((card) => { cardsById.set(card.id, card); cardGameMap.set(card.id, card.game); });
    } catch (e) { /* sem catálogo: só o preview não abre */ }
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
    const distOrder = shared.GAME_SLUGS.map((g) => ({ game: g, label: gameLabelOf(g), color: shared.GAME_COLOR[g] })).filter((g) => byGame[g.game]);
    const max = Math.max(1, ...distOrder.map((g) => byGame[g.game]));
    const distHtml = distOrder.length
      ? distOrder.map((g) => `<div class="dash-dist-row">
          <span class="dash-dist-label">${escapeHtml(g.label)}</span>
          <span class="dash-dist-track"><span class="dash-dist-fill" style="width:${Math.round((byGame[g.game] / max) * 100)}%;background:${g.color}"></span></span>
          <span class="dash-dist-n">${byGame[g.game]}</span>
        </div>`).join("")
      : "";

    // Ícones da barra: SVG inline com currentColor. Inline e não sprite/arquivo
    // porque a CSP é 'self' e porque são 4 ícones — um request a mais no boot da
    // Coleção custaria mais do que os ~600 bytes que eles ocupam aqui.
    // O ícone não é enfeite: é o que deixa o olho achar "valor de mercado" sem
    // ler o rótulo de 11px, que é o problema da barra achatada de hoje.
    const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    const IC = {
      // cópias = cartas empilhadas; distintas = uma carta; sets = grade de sets
      copies: svg('<rect x="8" y="3" width="12" height="16" rx="2"/><path d="M4 7v12a2 2 0 0 0 2 2h9"/>'),
      distinct: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8.5h6M9 12h6M9 15.5h3"/>'),
      sets: svg('<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>'),
      money: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.2v9.6M14.4 9.6c0-1-1.1-1.6-2.4-1.6s-2.4.6-2.4 1.6 1 1.5 2.4 1.9 2.5 1 2.5 2-1.1 1.7-2.5 1.7-2.5-.7-2.5-1.7"/>')
    };
    const stat = (icone, valor, rotulo, extra = "") =>
      `<div${extra}><span class="dash-stat-ic">${icone}</span><span class="dash-stat-txt"><span class="dash-stat-val">${valor}</span><span class="dash-stat-label">${escapeHtml(rotulo)}</span></span></div>`;
    // Monograma como avatar — mesmo padrão do .auth-avatar do header. Sem upload
    // de foto: não existe essa infraestrutura, e a inicial já identifica.
    const inicial = (profileNav && profileNav.name || "").trim().charAt(0).toUpperCase();
    const profHead = (profileNav && profileNav.name)
      // Avatar e nome vão num grupo. O .dash-profile é space-between (identidade
      // à esquerda, botão de navegação à direita); soltar o avatar como irmão
      // fazia o space-between separar avatar e nome pras pontas opostas — era o
      // buraco no meio do cabeçalho do perfil compartilhado.
      ? `<div class="dash-profile">
          <div class="dash-profile-who">
            ${inicial ? `<span class="dash-avatar" aria-hidden="true"><span class="dash-avatar-in">${escapeHtml(inicial)}</span></span>` : ""}
            <div class="dash-profile-id">
              <strong class="dash-profile-name">${escapeHtml(profileNav.name)}</strong>
              <a class="dash-profile-handle" href="/users/${escapeAttribute(profileNav.handle)}">@${escapeHtml(profileNav.handle)}</a>
            </div>
          </div>
          ${profileNav.label ? `<button type="button" class="secondary dash-profile-nav" data-profile-nav>${escapeHtml(profileNav.label)}</button>` : ""}
        </div>`
      : "";
    // MESMO cartão-herói da Minha Coleção (.dash-stats-hero): identidade em
    // cima, contagens numa fileira de 4 com o valor na última coluna. Sem
    // identidade (share anônimo, ?s=), o cabeçalho nem entra — e sem ele as
    // contagens não ganham a divisória de cima (regra head + counts no CSS).
    return `<section class="collection-dashboard">
      <article class="dash-card dash-stats dash-stats-hero">
        ${profHead ? `<div class="dash-stats-head">${profHead}</div>` : ""}
        <div class="dash-stats-counts">
          ${stat(IC.copies, copies, t("stats.copies"))}
          ${stat(IC.distinct, distinct, t("stats.distinct"))}
          ${stat(IC.sets, sets, t("stats.setsCovered"))}
          ${stat(IC.money, escapeHtml(total > 0 ? shared.formatMoney(shared.getCurrency(), total) : "—"), t("dash.value"), ' class="dash-stat-money"')}
        </div>
      </article>
      <article class="dash-card dash-top">
        <h3>${escapeHtml(t("dash.topTitle"))}</h3>
        <ol class="dash-top-list">${top || `<li class="dash-empty">—</li>`}</ol>
      </article>
      ${distHtml ? `<article class="dash-card dash-dist"><h3>${escapeHtml(t("dash.distTitle"))}</h3><div class="dash-dist-bars">${distHtml}</div></article>` : ""}
    </section>`;
  }
})();
