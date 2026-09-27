(function () {
  const shared = window.TCGShared;
  const { t, tn, debounce, matchesCardQuery, escapeHtml } = shared;

  // Explorar GLOBAL (estilo Collectr): uma busca só para TODOS os jogos. A
  // página é neutra (sessão hub, sem catálogo injetado); o catálogo inteiro dos
  // jogos é carregado SOB DEMANDA na primeira busca (pill de loading do shared).
  const elements = {
    search: document.getElementById("exploreSearch"),
    grid: document.getElementById("exploreGrid"),
    intro: document.getElementById("exploreIntro"),
    empty: document.getElementById("exploreEmpty"),
    resultsHeader: document.getElementById("exploreResultsHeader"),
    resultsTitle: document.querySelector("#exploreResultsHeader h2"),
    resultCount: document.getElementById("exploreResultCount"),
    note: document.getElementById("exploreNote"),
    gameFilter: document.getElementById("exploreGameSelect"),
    sortSelect: document.getElementById("exploreSortSelect"),
    viewToggle: document.getElementById("exploreViewToggle"),
    filtersBtn: document.getElementById("exploreFiltersBtn"),
    filters: document.getElementById("exploreFilters"),
    setFilter: document.getElementById("exploreSetFilter"),
    langFilter: document.getElementById("exploreLangFilter"),
    rarityFilter: document.getElementById("exploreRarityFilter"),
    priceMin: document.getElementById("explorePriceMin"),
    priceMax: document.getElementById("explorePriceMax")
  };

  // "relevance" (27/09/2026) é o padrão: a carta que TEM o nome buscado vem
  // antes da que só começa com ele ("mew": Mew antes de Mewtwo), e dentro do
  // mesmo nível a mais valiosa primeiro. Quem já escolheu outra ordem guarda
  // a escolha (a chave só é gravada quando o seletor muda).
  const SORTS = ["relevance", "value-desc", "value-asc", "rarity-desc", "rarity-asc", "release", "num-asc"];
  let sort = SORTS.includes(localStorage.getItem("tcg-explore-sort")) ? localStorage.getItem("tcg-explore-sort") : "relevance";
  let gameFilter = "all";
  // Visualização da grade (grade/lista/compacta/fichário) — o MESMO alternador
  // da Coleção, do /cartas e da página do set, com preferência por página.
  let cardsView = shared.gridViewValue(localStorage.getItem("tcg-explore-view"));
  // Fichário: o mesmo módulo das outras grades. `root` é a própria grade — é
  // dentro dela que o binderView põe as setas, o seletor de página e a trilha.
  const binderView = window.TCGBinderView
    ? window.TCGBinderView.createBinderView({ root: elements.grid, grid: elements.grid, storageKey: "tcg-explore-binder-pockets" })
    : null;

  // Stores por jogo + fachadas mescladas (mesmo padrão da Coleção): posse,
  // desejo e preços funcionam pra qualquer carta de qualquer jogo.
  const { cardGameMap, owned, wishlist, prices } = shared.createCrossGameStores();
  // Preferência "agrupar versões" (ver cardVariantPairs no shared.js):
  // uma carta = um tile nas grades de catálogo; o + abre o card pra escolher.
  let agrupaVersoes = shared.groupVariantsEnabled();
  shared.initGroupVariantsChip((on) => { agrupaVersoes = on; render({ resetCount: true }); });

  let cards = [];
  let cardsById = new Map();
  let catalogPromise = null;
  let catalogPronto = false; // resolvido de verdade (a promise existir só diz que está DESCENDO)
  function ensureCatalog() {
    if (!catalogPromise) {
      catalogPromise = shared.loadAllGamesCatalog().then((catalog) => {
        cards = catalog.cards || [];
        cards.forEach((card) => cardGameMap.set(card.id, card.game));
        cardsById = new Map(cards.map((card) => [card.id, card]));
        catalogPronto = true;
        // ?card=<id>: reabre o popup da carta (ver collection.js). Aqui e não no
        // renderFromCatalog porque a promise é MEMOIZADA — roda uma vez só, então
        // buscar de novo depois de fechar o popup não o traz de volta.
        preview.openFromUrl();
        return cards;
      }).catch((error) => {
        // Era a ÚNICA página de catálogo sem catch: a promise memoizada rejeitava
        // e os esqueletos ficavam na tela pra sempre. Espelha o cards.js — limpa,
        // mostra o erro e zera a promise pra permitir nova tentativa.
        catalogPromise = null;
        elements.intro.hidden = true;
        elements.grid.innerHTML = "";
        shared.mostraErroDeCatalogo(elements.empty, error);
        elements.empty.hidden = false;
        if (elements.resultsHeader) elements.resultsHeader.hidden = true;
        throw error;
      });
    }
    return catalogPromise;
  }

  // Carrega o catálogo e redesenha; o catch existe só pra não vazar a rejeição
  // (o ensureCatalog já pintou o erro na tela).
  function renderFromCatalog() {
    ensureCatalog().then(() => render({ resetCount: true })).catch(() => { /* erro já exibido */ });
  }

  const pager = shared.createPager({ grid: elements.grid, pageSize: 60 });

  const preview = shared.createCardPreview({
    getCard: (cardId) => cardsById.get(cardId),
    store: owned,
    prices,
    wishlist,
    onOwnedChange: () => refreshOwnership()
  });
  elements.grid.addEventListener("click", (event) => {
    // + de tile agrupado: menu de versões (adicionar direto, sem abrir o card).
    if (shared.handleGroupedAddClick(event, owned, wishlist, refreshOwnership)) return;
    const opener = event.target.closest("[data-preview-card-id]");
    if (opener) { preview.open(opener.dataset.previewCardId, opener.dataset.previewVariant); return; }
    if (shared.handleWantTileClick(event, wishlist)) { refreshOwnership(); return; }
    if (shared.handleRemoveOneTileClick(event, owned)) { refreshOwnership(); return; }
    // Como na busca por jogo: "+" soma +1 por clique com o feedback ✓ de 2s.
    const addButton = shared.handleAddTileClick(event, owned, wishlist);
    if (addButton) { refreshOwnership(); shared.flashTileAdded(addButton, owned); }
  });

  const term = () => String(elements.search.value || "").trim();
  const isSearching = () => term().length >= 2;

  // "Mais vistas pela comunidade" (antes na home): estado INICIAL do Explorar,
  // estilo Collectr. Top do contador anônimo de views (card_views) de todos os
  // jogos; só aparece com dados suficientes (>= 4 cartas com 2+ views) e some
  // enquanto há busca ativa (render() controla o hidden).
  // "Mais vistas pela comunidade": estado INICIAL do Explorar (em vez de vazio).
  // Puxa o top do contador anônimo (card_views) de TODOS os jogos, resolve as
  // cartas e mostra ~4-5 fileiras no GRID (tiles normais, com preview e +). Ao
  // digitar, o render() troca pros resultados da busca. O mini-row antigo
  // (exploreTopViewed) some — as mais-vistas agora vivem no grid.
  let topViewedReady = false;
  let topViewedPairs = [];
  (async function loadTopViewed() {
    if (!shared.fetchTopViewed) return;
    try {
      const games = shared.GAME_SLUGS || ["pokemon", "lorcana"];
      const perGame = await Promise.all(games.map((g) => shared.fetchTopViewed(g, 6)));
      const tops = games.flatMap((g, i) => perGame[i].map((x) => ({ id: x.card_id, views: x.views, game: g })))
        .filter((x) => x.views >= 2)
        .sort((a, b) => b.views - a.views)
        .slice(0, 30);
      if (tops.length < 4) return;
      const idsByGame = {};
      games.forEach((g) => { idsByGame[g] = tops.filter((x) => x.game === g).map((x) => x.id); });
      const catalog = await shared.loadOwnedAcrossGames(idsByGame);
      const byId = new Map((catalog.cards || []).map((c) => [c.id, c]));
      const pairs = [];
      for (const { id } of tops) {
        const card = byId.get(id);
        if (!card) continue;
        // registra pro preview/posse funcionarem antes da 1ª busca (o
        // ensureCatalog depois reescreve cardsById com o catálogo completo).
        cardGameMap.set(card.id, card.game);
        cardsById.set(card.id, card);
        pairs.push({ card, variant: shared.defaultVariant(card) });
      }
      topViewedPairs = pairs;
      topViewedReady = pairs.length >= 4;
      if (topViewedReady && !isSearching()) render({ resetCount: true });
    } catch (e) { /* seção é opcional */ }
  })();

  function sortComparator() {
    const priceOf = shared.memoValue((p) => shared.cardValue(p.card, p.variant, prices, shared.DEFAULT_CONDITION).value || 0);
    const byNum = (a, b) => shared.compareCardNumbers(a.card.number, b.card.number);
    if (sort === "relevance") {
      const q = term();
      const relOf = shared.memoValue((card) => shared.searchRelevance(card, q));
      return (a, b) => (relOf(b.card) - relOf(a.card)) || (priceOf(b) - priceOf(a));
    }
    if (sort === "num-asc") return byNum;
    if (sort === "value-asc") return (a, b) => {
      const pa = priceOf(a), pb = priceOf(b);
      if (!pa && !pb) return 0; if (!pa) return 1; if (!pb) return -1; return pa - pb;
    };
    if (sort === "rarity-desc") return (a, b) => shared.rarityRank(b.card.rarity) - shared.rarityRank(a.card.rarity) || byNum(a, b);
    if (sort === "rarity-asc") return (a, b) => shared.rarityRank(a.card.rarity) - shared.rarityRank(b.card.rarity) || byNum(a, b);
    if (sort === "release") return (a, b) => String(b.card.setReleaseDate || "").localeCompare(String(a.card.setReleaseDate || ""));
    return (a, b) => priceOf(b) - priceOf(a); // value-desc (padrão)
  }

  // --- Barra de filtros (Set · Idioma · Raridade · Preço) -------------------
  // Refinam o que está NA GRADE — o resultado da busca, ou as "mais vistas"
  // antes dela. As opções saem dessa mesma lista: o Explorar não tem "catálogo
  // da página" pra listar set e raridade de antemão (o catálogo dos 14 jogos
  // só desce quando precisa), e um <select> com todos os sets seria ilegível.
  function parsePrice(el) {
    if (!el) return null;
    const v = parseFloat(String(el.value || "").replace(/[^\d.,]/g, "").replace(",", "."));
    return Number.isFinite(v) && v >= 0 ? v : null;
  }
  const valorDe = shared.memoValue((card) =>
    (shared.cardValue(card, shared.defaultVariant(card), prices, shared.DEFAULT_CONDITION) || {}).value || 0);
  const campo = (el) => (el ? el.value : "");
  const temFiltro = () => !!(campo(elements.setFilter) || campo(elements.langFilter) || campo(elements.rarityFilter)
    || parsePrice(elements.priceMin) != null || parsePrice(elements.priceMax) != null);

  function passaNosFiltros(card) {
    const set = campo(elements.setFilter);
    if (set && card.set !== set) return false;
    const idioma = campo(elements.langFilter);
    if (idioma && shared.normalizeCardLanguage(card.language) !== idioma) return false;
    const raridade = campo(elements.rarityFilter);
    if (raridade && card.rarity !== raridade) return false;
    const pMin = parsePrice(elements.priceMin), pMax = parsePrice(elements.priceMax);
    if (pMin != null || pMax != null) {
      const v = valorDe(card);
      if (pMin != null && v < pMin) return false;
      if (pMax != null && (v > pMax || v <= 0)) return false; // sem preço não entra em "até X"
    }
    return true;
  }

  // Reconstrói um <select> mantendo a 1ª opção ("Todos") e a seleção atual, se
  // ela ainda existir no conjunto novo (o mesmo fillFilter da Coleção).
  function preencheFiltro(select, valores, rotulo) {
    if (!select) return;
    const anterior = select.value;
    while (select.options.length > 1) select.remove(1);
    shared.addOptions(select, valores, rotulo);
    select.value = valores.includes(anterior) ? anterior : "";
  }
  // As opções saem da lista ANTES dos filtros: escolher um set não pode apagar
  // os outros do seletor, senão não dá pra voltar atrás.
  function atualizaOpcoes(lista) {
    const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));
    preencheFiltro(elements.setFilter, uniq(lista.map((c) => c.set)).sort((a, b) => a.localeCompare(b)));
    preencheFiltro(elements.langFilter, uniq(lista.map((c) => shared.normalizeCardLanguage(c.language))), (v) => shared.cardLanguageLabel(v));
    preencheFiltro(elements.rarityFilter, uniq(lista.map((c) => c.rarity)).sort((a, b) => a.localeCompare(b)));
  }

  // Um tile no modo de visualização atual: o compacto muda o HTML (sem <img>),
  // não só a classe da grade.
  const tileDe = ({ card, variant }) => shared.variantTile(card, variant, owned, wishlist, prices,
    { addMode: true, grouped: agrupaVersoes, compact: cardsView === "compact" });

  // Pinta a grade. No fichário quem monta é o binderView (páginas de bolsos),
  // então o pager entra vazio antes — é ele que limpa a grade e tira o
  // "carregar mais", que não faz sentido em página de fichário.
  function pintaGrade(pares, options) {
    shared.applyGridViewClasses(elements.grid, cardsView);
    if (cardsView === "binder" && binderView) {
      pager.render([], () => document.createComment(""), { resetCount: true });
      binderView.render(pares, tileDe);
    } else {
      pager.render(pares, tileDe, options || {});
    }
    if (elements.viewToggle) {
      elements.viewToggle.querySelectorAll("[data-grid-view]").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.gridView === cardsView));
      });
      if (binderView) binderView.paintToggle(elements.viewToggle.querySelector('[data-grid-view="binder"]'));
    }
  }

  // Número no formato do idioma ("8.283", "8,283"): o contador é o que diz se
  // a busca veio inteira, e "8283 resultados" é difícil de ler.
  const numero = (n) => {
    try { return Number(n).toLocaleString(shared.getLocale ? shared.getLocale() : undefined); } catch (e) { return String(n); }
  };

  // Aviso de resultado CORTADO: a borda devolve no máximo 10 mil cartas (as
  // mais relevantes). Acima disso a busca não é de UMA carta ("dragon" em 13
  // jogos) e o aviso diz quantas existem e como chegar no resto.
  function pintaAviso(base) {
    if (!elements.note) return;
    const cortado = !!(base && base.truncated && base.total > base.list.length);
    elements.note.hidden = !cortado;
    elements.note.textContent = cortado
      ? t("explore.truncated", { shown: numero(base.list.length), total: numero(base.total) })
      : "";
  }

  // Última lista base pintada e o termo dela (ver o comentário no render),
  // com o total da borda e se ela veio cortada.
  let ultimaBase = { q: "", game: "", list: null, total: 0, truncated: false };
  function render(options) {
    const searching = isSearching();
    if (!searching) {
      const showTop = topViewedReady && topViewedPairs.length >= 4;
      elements.intro.hidden = showTop;
      elements.resultCount.textContent = "";
      pintaAviso(null);
      elements.resultsHeader.hidden = !showTop;
      if (elements.filters) elements.filters.hidden = !showTop;
      if (!showTop) {
        elements.empty.hidden = true;
        pintaGrade([], { resetCount: true });
        return;
      }
      if (elements.resultsTitle) elements.resultsTitle.textContent = t("home.topViewed");
      atualizaOpcoes(topViewedPairs.map((par) => par.card));
      const visiveis = topViewedPairs.filter((par) => passaNosFiltros(par.card));
      elements.empty.hidden = visiveis.length > 0;
      if (!visiveis.length) elements.empty.textContent = t("empty.pokedex");
      pintaGrade(visiveis, { resetCount: true });
      return;
    }
    elements.intro.hidden = true;
    elements.resultsHeader.hidden = false;
    if (elements.filters) elements.filters.hidden = false;
    if (elements.resultsTitle) elements.resultsTitle.textContent = t("results.heading.cards");
    // Filtra ANTES de gerar pares carta×variante (barato mesmo com ~60k cartas).
    // options.list = resultado COMPLETO da borda (apiApply): já filtrado por
    // jogo e casado por palavra, só entra no funil daqui.
    const q = term();
    // A base é a lista da borda (options.list) quando ela veio, o catálogo
    // completo quando ele chegou — e, no meio do caminho, a ÚLTIMA lista
    // pintada pra este mesmo termo e jogo. Sem essa memória, qualquer
    // re-render sem options (trocar a vista, mexer num filtro, ligar o
    // "Agrupar") caía no `cards` ainda vazio e esvaziava a grade com um "nada
    // encontrado".
    let base;
    if (options && options.list) {
      base = { q, game: gameFilter, list: options.list, total: options.total || options.list.length, truncated: !!options.truncated };
    } else if (!catalogPronto && ultimaBase.list && ultimaBase.q === q && ultimaBase.game === gameFilter) {
      base = ultimaBase;
    } else {
      const list = cards.filter((card) => shared.cardMatchesGameFilter(card, gameFilter) && matchesCardQuery(card, q));
      base = { q, game: gameFilter, list, total: list.length, truncated: false };
    }
    ultimaBase = base;
    const matched = base.list;
    pintaAviso(base);
    atualizaOpcoes(matched);
    const pairs = shared.cardVariantPairs(matched.filter(passaNosFiltros), { group: agrupaVersoes });
    const cmp = sortComparator();
    pairs.sort((a, b) =>
      (Number(shared.cardHasImage(b.card)) - Number(shared.cardHasImage(a.card))) || cmp(a, b));
    pintaGrade(pairs, options || {});
    elements.empty.hidden = pairs.length > 0;
    // "Nenhuma carta em nenhum jogo" é resposta da BUSCA; com filtro ligado o
    // que sobrou de fora foi a barra, e a mensagem tem que dizer isso.
    if (!pairs.length) elements.empty.textContent = t(temFiltro() && matched.length ? "empty.pokedex" : "explore.empty");
    elements.resultCount.textContent = tn("results.count", pairs.length, { n: numero(pairs.length) });
  }

  // Rótulos dos tiles JÁ na tela depois que as cartas da borda ganham o
  // setTotal (enrichSetTotals): o título passa de "Mewtwo (063)" pra
  // "Mewtwo (063/197)" sem redesenhar a grade — recriar o tile faria a imagem
  // piscar e devolveria quem rolou pro começo.
  function atualizaRotulos() {
    elements.grid.querySelectorAll(".card-tile").forEach((tile) => {
      const card = cardsById.get(tile.dataset.tileCardId);
      const h3 = card && tile.querySelector(".tile-info h3");
      if (h3) h3.textContent = shared.cardLabel(card);
    });
  }

  function refreshOwnership() {
    elements.grid.querySelectorAll(".card-tile").forEach((tile) => {
      shared.refreshTileOwnership(tile, owned, wishlist, { addMode: true });
    });
  }

  // ?q= compartilhável (e escrito de volta a cada busca, sem recarregar).
  function writeUrl() {
    const sp = new URLSearchParams(window.location.search);
    const q = term();
    if (q) sp.set("q", q); else sp.delete("q");
    try { history.replaceState(null, "", `${window.location.pathname}${sp.toString() ? `?${sp}` : ""}`); } catch (e) { /* ignora */ }
  }

  // Busca pela BORDA: a /api/search em modo COMPLETO (&full=1) devolve TODAS
  // as cartas que casam em todos os jogos (até 10 mil, as mais relevantes
  // primeiro), já prontas pra grade e com o preço de cada uma — então a
  // contagem, a ordenação (por valor, raridade…), os filtros e a rolagem
  // valem sobre o resultado INTEIRO.
  //
  // Até 27/09/2026 esta ponte pedia 60 cartas, sem ordem nenhuma (a SQL não
  // tinha ORDER BY), e o catálogo completo só descia com a borda fora do ar:
  // "mew" mostrava "60 resultados" — 60 cartas quaisquer das 370, com o
  // "maior valor" ordenando só esses 60 — e não havia rolagem que trouxesse o
  // resto. De quebra, hidratar as 60 pelos chunks baixava o manifest e o
  // índice inteiro de cada jogo (2,9 MB só o do Pokémon); a resposta completa
  // de "mew" são 9 KB comprimidos.
  //
  // O catálogo inteiro — o maior download do site, dezenas de MB — só desce
  // se a borda estiver fora ou responder vazio (ver abaixo). Depois que ele
  // chegou, a busca local segue valendo: instantânea e sem rede.
  let apiSeq = 0;
  let urlCardTentado = false;
  const VINTAGE_GAMES = ["pokemon", "onepiece", "naruto", "hxh"]; // os que têm carta vintage (ver isVintageCard)
  // Qualquer erro no caminho da borda cai no catálogo local em vez de deixar
  // a página muda: uma exceção aqui era uma rejeição sem ninguém ouvindo, a
  // grade ficava como estava (as "mais vistas", ou os esqueletos) e a busca
  // parecia travada — digitar de novo, Enter, nada; só o F5 "resolvia", e
  // resolvia por acaso. Foi um ReferenceError num `q` que não existia neste
  // escopo (o termo é lido uma vez, no começo, e vale pro pedido inteiro).
  async function apiApply() {
    try { await apiApplyInner(); }
    catch (e) { renderFromCatalog(); }
  }
  async function apiApplyInner() {
    const seq = ++apiSeq;
    const q = term();
    const filtro = gameFilter;
    if (!elements.grid.querySelector(".card-tile")) shared.showSkeletons(elements.grid, "card", 8);
    // "Vintage" não existe na borda (é corte por carta, não coluna do D1):
    // busca nos jogos que TÊM linha vintage e peneira as cartas com
    // isVintageCard, mais abaixo.
    const vintage = filtro === shared.VINTAGE_FILTER;
    const jogos = vintage ? VINTAGE_GAMES : [filtro === "all" ? "all" : filtro];
    const respostas = await Promise.all(jogos.map((g) => shared.searchApiFull(g, q)));
    if (seq !== apiSeq || catalogPronto) return; // o catálogo chegou no meio: o render dele já cobre
    // null = borda desligada/soluço (ou Function sem o modo completo): o
    // catálogo local responde. Um jogo do vintage falhar também — resultado
    // pela metade com contagem de inteiro é o que esta página não pode dar.
    if (respostas.some((r) => !r)) { renderFromCatalog(); return; }
    let found = [].concat(...respostas.map((r) => r.cards));
    // VAZIO não é resposta final — só o catálogo local pode afirmar "essa
    // carta não existe": ele casa por pedaço de palavra ("kachu" acha
    // Pikachu), a borda só por começo de palavra; e a borda responde vazio
    // quando o banco está em recarga (deploy).
    // Enquanto o catálogo confirma, a grade não pode seguir mostrando o
    // resultado da busca ANTERIOR (trocar pra um jogo sem a carta deixava as
    // cartas do outro jogo na tela, com a contagem velha): esqueletos no lugar.
    if (!found.length) {
      pintaGrade([], { resetCount: true });
      shared.showSkeletons(elements.grid, "card", 8);
      elements.resultCount.textContent = "";
      pintaAviso(null);
      renderFromCatalog();
      return;
    }
    // Os preços vêm na mesma resposta: entram na tabela da sessão, que é onde
    // o cardValue procura (união, como o loadAcrossGames faz — outra busca
    // desta página já pode ter posto preço de outras cartas ali).
    window.TCG_PRICING = Object.assign({}, window.TCG_PRICING, ...respostas.map((r) => r.pricing));
    if (vintage) found = found.filter((card) => shared.isVintageCard(card));
    // registra pro preview/posse/preço funcionarem igual ao caminho completo
    found.forEach((card) => {
      cardGameMap.set(card.id, card.game);
      cardsById.set(card.id, card);
    });
    const total = vintage ? found.length : respostas[0].total;
    const truncated = respostas.some((r) => r.truncated);
    render({ resetCount: true, list: found, total, truncated });
    // ?card=<id> (link de carta aberto a partir de uma busca): reabre o popup
    // UMA vez, na primeira resposta — o caminho do catálogo faz o mesmo no
    // ensureCatalog, mas com a borda respondendo ele nunca roda, e o link
    // compartilhado abria só a grade.
    if (!urlCardTentado) { urlCardTentado = true; preview.openFromUrl(); }
    // O código impresso completo ("063/197") depende do total do set, que a
    // borda não guarda: vem do manifest do jogo, em 2º plano.
    shared.enrichSetTotals(found).then((mudou) => {
      if (mudou && seq === apiSeq) atualizaRotulos();
    }).catch(() => { /* sem manifest: fica o número sozinho */ });
  }

  const apply = () => {
    writeUrl();
    if (catalogPronto) { render({ resetCount: true }); return; }
    if (!isSearching()) { render({ resetCount: true }); return; }
    // Catálogo ainda descendo (ou nem começou): a ponte responde JÁ — antes,
    // qualquer busca depois da primeira ficava presa esperando o download
    // inteiro (`if (catalogPromise)` mandava pro caminho lento). Se o download
    // está em andamento, religa o re-render de quando ele chegar.
    apiApply();
    if (catalogPromise) renderFromCatalog();
  };
  elements.search.addEventListener("input", debounce(apply, 250));

  // Jogo é um <select> ao lado do Ordenar (eram 13 chips numa faixa inteira).
  // Opções reconstruídas de GAME_SLUGS: jogo novo no registro aparece sozinho,
  // mesma garantia que os chips antigos tinham via initGameFilterChips.
  if (elements.gameFilter) {
    elements.gameFilter.innerHTML = `<option value="all">${shared.escapeHtml(shared.t("filter.gameAll"))}</option>`
      + shared.GAME_SLUGS.map((g) => `<option value="${g}">${shared.escapeHtml(shared.gameLabel(g))}</option>`).join("")
      // "Vintage" no fim: o corte agnóstico de jogo (isVintageCard), com a
      // explicação no title da opção.
      + `<option value="${shared.VINTAGE_FILTER}" title="${shared.escapeAttribute(shared.t("filter.vintageHint"))}">${shared.escapeHtml(shared.t("filter.gameVintage"))}</option>`;
    elements.gameFilter.value = gameFilter;
    elements.gameFilter.addEventListener("change", () => {
      const v = elements.gameFilter.value;
      gameFilter = shared.GAME_SLUGS.includes(v) || v === shared.VINTAGE_FILTER ? v : "all";
      shared.applyGameAccent(gameFilter);
      if (isSearching()) apply();
    });
  }

  elements.sortSelect.value = sort;
  elements.sortSelect.addEventListener("change", () => {
    sort = SORTS.includes(elements.sortSelect.value) ? elements.sortSelect.value : "value-desc";
    try { localStorage.setItem("tcg-explore-sort", sort); } catch (e) { /* ignora */ }
    // Reordena o que JÁ está na mão (o resultado inteiro veio da borda) —
    // não é uma busca nova, então não volta à rede.
    if (isSearching()) render({ resetCount: true });
  });

  // Visualização: grade ↔ lista é só a classe da grade; compacta e fichário
  // reconstroem (o HTML do tile muda, e o fichário monta a grade em páginas).
  // Clicar no fichário com ele JÁ ativo troca o nº de bolsos, como nas outras
  // telas. resetCount: false — trocar de vista não devolve quem já rolou a
  // grade pro começo.
  if (elements.viewToggle) {
    shared.applyGridViewClasses(elements.grid, cardsView);
    elements.viewToggle.querySelectorAll("[data-grid-view]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.gridView === cardsView));
    });
    if (binderView) binderView.paintToggle(elements.viewToggle.querySelector('[data-grid-view="binder"]'));
    elements.viewToggle.addEventListener("click", (event) => {
      const button = event.target.closest("[data-grid-view]");
      if (!button) return;
      const eraCompacto = cardsView === "compact";
      const eraBinder = cardsView === "binder";
      const querBinder = button.dataset.gridView === "binder";
      if (querBinder && eraBinder && binderView) binderView.cycle();
      cardsView = shared.gridViewValue(button.dataset.gridView);
      try { localStorage.setItem("tcg-explore-view", cardsView); } catch (e) { /* ignora */ }
      if (eraCompacto !== (cardsView === "compact") || eraBinder || querBinder) { render({ resetCount: false }); return; }
      shared.applyGridViewClasses(elements.grid, cardsView);
      elements.viewToggle.querySelectorAll("[data-grid-view]").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.gridView === cardsView));
      });
    });
  }

  // Barra de filtros recolhível em QUALQUER largura, pelo botão da linha do
  // título — mesmo desenho e MESMA chave de preferência da Coleção: quem gosta
  // de ver a barra aberta lá quer ela aberta aqui.
  if (elements.filtersBtn) {
    let aberta = false;
    try { aberta = localStorage.getItem("tcg-collector-filters-open") === "1"; } catch (e) { /* ignora */ }
    const pintaFiltros = () => {
      if (elements.filters) elements.filters.classList.toggle("is-collapsed", !aberta);
      elements.filtersBtn.setAttribute("aria-expanded", String(aberta));
    };
    elements.filtersBtn.addEventListener("click", () => {
      aberta = !aberta;
      try { localStorage.setItem("tcg-collector-filters-open", aberta ? "1" : "0"); } catch (e) { /* ignora */ }
      pintaFiltros();
    });
    pintaFiltros();
  }

  // Campos da barra: refazem a GRADE, não a busca (a lista base é a mesma).
  [elements.setFilter, elements.langFilter, elements.rarityFilter].forEach((el) => {
    if (el) el.addEventListener("change", () => render({ resetCount: true }));
  });
  [elements.priceMin, elements.priceMax].forEach((el) => {
    if (el) el.addEventListener("input", debounce(() => render({ resetCount: true }), 250));
  });

  // Deep-link: /explore?q=pikachu já abre buscando (skeletons + pill do shared).
  const q0 = new URLSearchParams(window.location.search).get("q");
  if (q0) {
    elements.search.value = q0;
    if (isSearching()) {
      shared.showSkeletons(elements.grid, "card", 12);
      apply(); // mesma régua da digitação: borda primeiro, catálogo só se precisar
    }
  }
})();
