(function () {
  const shared = window.TCGShared;
  const { addOptions, unique, normalize, escapeHtml, escapeAttribute, speciesName, debounce, t, tn, localizedImg, toRoman } = shared;

  let cards = [];
  let cardsById = new Map();
  let pageCards = [];
  // "o nome pedido não existe neste jogo" (ver o curto-circuito em
  // fetchCardsForPage): muda o estado vazio de "nenhuma carta" para uma saída.
  let nomeForaDoIndice = false;
  const owned = shared.createCollectionStore();
  const favorites = shared.createFavoritesStore();
  const dexOwned = shared.createDexOwnedStore(); // Pokédex "já tenho" (por dexId)
  const wishlist = shared.createWishlistStore();
  const prices = shared.createPriceStore();
  // Preferência "agrupar versões" (ver cardVariantPairs no shared.js):
  // uma carta = um tile nas grades de catálogo; o + abre o card pra escolher.
  let agrupaVersoes = shared.groupVariantsEnabled();
  shared.initGroupVariantsChip((on) => { agrupaVersoes = on; render({ resetCount: true }); });

  const TYPE_COLORS = shared.TYPE_COLORS;
  const REGION_BY_GENERATION = shared.REGION_BY_GENERATION;

  const FORM_WORDS = {
    mega: "Mega",
    gmax: "Gigantamax",
    alola: "Alola",
    galar: "Galar",
    hisui: "Hisui",
    paldea: "Paldea"
  };

  const params = new URLSearchParams(window.location.search);
  const detailType = params.get("type") || "";
  // `let`: a página de SET aceita URL só com ?setId= (sem ?name=) — o nome é
  // resolvido do catálogo em resolveSetNameFromId(), assim que ele chega.
  let detailName = params.get("name") || "";
  // Desambiguação da página de SET (ver scopeToEdition): o nome sozinho pode
  // casar com mais de uma edição. A lista de Sets carrega estes dois no link
  // quando precisa; ausentes, valem os padrões.
  const detailSetId = params.get("setId") || "";
  const detailRegion = params.get("region") || "";
  // Nome fora do ASCII imprimível (japonês, acento): na barra de endereço ele
  // aparece bonito, mas o Ctrl+C entrega a URL codificada (%E3%82%B8…). Pra
  // esses sets a URL passa a se identificar pelo setId — ver limpaUrlDoSet().
  const nomeLegivelNaUrl = (nome) => /^[ -~]*$/.test(nome);
  // scope=collection: versão "dentro da sua coleção" (cartas que você não tem
  // aparecem em preto e branco; o resto da página funciona igual ao catálogo).
  const collectionScope = params.get("scope") === "collection";

  const elements = {
    type: document.getElementById("detailType"),
    title: document.getElementById("detailTitle"),
    hero: document.getElementById("detailHero"),
    grid: document.getElementById("detailGrid"),
    empty: document.getElementById("emptyState"),
    search: document.getElementById("searchInput"),
    languageFilter: document.getElementById("languageFilter"),
    ownedChips: document.getElementById("ownedChips"),
    viewToggle: document.getElementById("viewToggle"),
    rarityField: document.getElementById("rarityField"),
    rarityFilter: document.getElementById("rarityFilter"),
    facets: document.getElementById("detailFacets"),
    sortSelect: document.getElementById("sortSelect"),
    ownedCount: document.getElementById("ownedCount"),
    totalCount: document.getElementById("totalCount"),
    completionRate: document.getElementById("completionRate"),
    completionFill: document.getElementById("completionFill"),
    completionBar: document.getElementById("completionBar"),
    detailValues: document.getElementById("detailValues"),
    valueTotal: document.getElementById("valueTotal"),
    valueOwned: document.getElementById("valueOwned"),
    valueToBuy: document.getElementById("valueToBuy"),
    resultCount: document.getElementById("resultCount"),
    insights: document.getElementById("setInsights"),
    progressModes: document.getElementById("progressModes"),
    modeMaster: document.getElementById("modeMaster"),
    modeAnyLang: document.getElementById("modeAnyLang")
  };

  // Cabeçalho de texto: tipo e nome saem os DOIS da URL, então são escritos
  // aqui, no boot, e não no init(). O init só roda quando o catálogo chega, e
  // até lá a faixa pintava "Carregando" (ou, nos sets, um título gigante que
  // depois some) — a coluna da esquerda mudava de tamanho com a página já na
  // tela e levava a busca junto, porque agora a faixa é UMA fileira só (ver
  // .page-head-bar no styles.css). Nos sets o hero logo abaixo já traz o nome:
  // repetir eyebrow + título era ruído, e some antes do primeiro paint.
  if (elements.type) elements.type.textContent = collectionScope
    ? `${t("detail.scopeCollection")} · ${typeLabel(detailType)}`
    : typeLabel(detailType);
  if (elements.title) elements.title.textContent = detailName || t("detail.label");
  if (detailType === "set") {
    if (elements.type) elements.type.hidden = true;
    if (elements.title) elements.title.hidden = true;
  }

  // --- Modos de contagem do progresso (páginas de set) ---
  // Master set: cada VARIANTE (Normal/Reverse/Holo…) é um slot próprio, como no
  // tcgcollector.com. Qualquer idioma: a carta conta se QUALQUER versão de
  // língua do mesmo slot for sua (EN/PT compartilham o id base "sv03.5-198" —
  // quem mistura línguas fecha o set numa progressão só; o tile continua
  // mostrando exatamente qual língua você tem). Preferências GLOBAIS.
  const MASTER_KEY = "tcg-progress-master-v1";
  const ANYLANG_KEY = "tcg-progress-anylang-v1";
  let masterMode = localStorage.getItem(MASTER_KEY) === "1";
  let anyLangMode = localStorage.getItem(ANYLANG_KEY) === "1";
  // Índice base->ids POSSUÍDOS (qualquer língua), reconstruído a cada contagem
  // (barato: percorre só o que você tem).
  function ownedBaseIndex() {
    const map = new Map();
    owned.knownCardIds().forEach((id) => {
      if (!owned.has(id)) return;
      const b = shared.basePricingId(id);
      if (!map.has(b)) map.set(b, []);
      map.get(b).push(id);
    });
    return map;
  }
  function initProgressModes() {
    if (detailType !== "set" || !elements.progressModes) return;
    elements.progressModes.hidden = false;
    elements.modeMaster.checked = masterMode;
    elements.modeAnyLang.checked = anyLangMode;
    elements.modeMaster.addEventListener("change", () => {
      masterMode = elements.modeMaster.checked;
      try { localStorage.setItem(MASTER_KEY, masterMode ? "1" : "0"); } catch (e) { /* ignora */ }
      updateHeaderStats();
    });
    elements.modeAnyLang.addEventListener("change", () => {
      anyLangMode = elements.modeAnyLang.checked;
      try { localStorage.setItem(ANYLANG_KEY, anyLangMode ? "1" : "0"); } catch (e) { /* ignora */ }
      updateHeaderStats();
    });
  }

  // --- Celebração de set 100% ---
  // (A seção "Continuar de onde parou" do Hub, que lia os últimos sets
  // visitados daqui, saiu em 2026-09-14 a pedido — nada mais grava a lista.)
  const CELEBRATED_KEY = "tcg-set-celebrated-v1";
  const paginaGame = () => (window.SLEEVU && window.SLEEVU.game) || "pokemon";
  const setChave = () => `${paginaGame()}:${detailSetId || detailName}`;
  // Completar um set é O momento do hobby e passava em silêncio (as badges dão
  // o prêmio durável; isto é o instante). Uma vez por set POR NAVEGADOR — a
  // festa repetida vira ruído — e nada além do estado dourado com
  // prefers-reduced-motion. A transição compara CONTAGEM exata (ownedN/totalN),
  // não o % arredondado: 149/150 arredonda pra 100 e engoliria a festa real.
  let estavaCompleto = null;
  function celebraSetCompleto() {
    let vistos = {};
    try { vistos = JSON.parse(localStorage.getItem(CELEBRATED_KEY) || "{}") || {}; } catch (e) { /* recomeça */ }
    const chave = setChave();
    if (vistos[chave]) return;
    vistos[chave] = 1;
    try { localStorage.setItem(CELEBRATED_KEY, JSON.stringify(vistos)); } catch (e) { /* ignora */ }
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    shared.vibrar(30); // o momento do hobby merece um toque mais longo que o do add
    if (elements.completionBar) {
      elements.completionBar.classList.remove("celebrate");
      void elements.completionBar.offsetWidth; // reinicia a animação do pulso
      elements.completionBar.classList.add("celebrate");
    }
    const cores = ["var(--gold)", "#2ecc71", "#5aa9e6", "#e8553c", "#d98fd9"];
    const caixa = document.createElement("div");
    caixa.className = "confetti";
    caixa.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 28; i++) {
      const p = document.createElement("i");
      p.style.left = `${Math.random() * 100}%`;
      p.style.background = cores[i % cores.length];
      p.style.animationDelay = `${Math.random() * 0.5}s`;
      p.style.animationDuration = `${1 + Math.random() * 0.8}s`;
      caixa.appendChild(p);
    }
    document.body.appendChild(caixa);
    setTimeout(() => caixa.remove(), 2600);
  }

  const pager = shared.createPager({ grid: elements.grid, pageSize: 60 });
  let selectedLanguage = "";
  let selectedOwned = "all";
  let selectedSort = "value-desc";
  let gridView = shared.gridViewValue(localStorage.getItem("tcg-detail-view"));
  let selectedRarity = ""; // "" = todas; senão "base" | "special"
  // Fichário: quantos BOLSOS por página. A sequência é a de clicar de novo no
  // botão com o modo já ativo (9 → 12 → 16 → 4 → 9…); nasce em 9 (3×3), que é
  // o fichário mais comum. Preferência global, como o modo de visualização.
  const BINDER_POCKETS = [9, 12, 16, 4];
  const BINDER_KEY = "tcg-detail-binder-pockets";
  let binderPockets = Number(localStorage.getItem(BINDER_KEY));
  if (!BINDER_POCKETS.includes(binderPockets)) binderPockets = 9;

  // Ordena os pares carta×variante conforme o select de ordenação. Diferente
  // dos outros filtros: não esconde nada, só reordena a grade.
  function sortTiles(pairs) {
    // Mesmo valor exibido no tile (preço manual ou, na falta, referência de
    // mercado), para a ordenação por preço bater com o que se vê. Memoizado.
    const priceOf = shared.memoValue((p) => shared.cardValue(p.card, p.variant, prices, shared.DEFAULT_CONDITION).value || 0);
    const byNum = (a, b) => shared.compareCardNumbers(a.card.number, b.card.number);
    if (selectedSort === "num-asc") {
      pairs.sort(byNum);
    } else if (selectedSort === "num-desc") {
      pairs.sort((a, b) => byNum(b, a));
    } else if (selectedSort === "rarity-desc") {
      pairs.sort((a, b) => shared.rarityRank(b.card.rarity) - shared.rarityRank(a.card.rarity) || byNum(a, b));
    } else if (selectedSort === "rarity-asc") {
      pairs.sort((a, b) => shared.rarityRank(a.card.rarity) - shared.rarityRank(b.card.rarity) || byNum(a, b));
    } else if (selectedSort === "value-desc") {
      pairs.sort((a, b) => priceOf(b) - priceOf(a));
    } else if (selectedSort === "value-asc") {
      // Cartas sem preço registrado vão para o fim (não na frente como "0").
      pairs.sort((a, b) => {
        const pa = priceOf(a);
        const pb = priceOf(b);
        if (!pa && !pb) return 0;
        if (!pa) return 1;
        if (!pb) return -1;
        return pa - pb;
      });
    } else {
      // release: mais recente primeiro (data ISO ordena como string).
      pairs.sort((a, b) => String(b.card.setReleaseDate || "").localeCompare(String(a.card.setReleaseDate || "")));
    }
    return pairs;
  }

  // Dois buckets só: "Comuns e raras" (o miolo do set) e "Especiais" — que
  // condensa as melhores cartas do Pokémon/busca: Double Rare (ex), Ultra Rare,
  // Illustration Rare, Special Illustration Rare (SAR), Full Art, Holo,
  // Secreta/Rainbow/Hyper, Shiny, ACE SPEC e as antigas raras que valem muito.
  // Tudo que não está no conjunto fechado de "base" cai em "special".
  const RARITY_BUCKET_ORDER = ["base", "special"];
  const RARITY_BASE = new Set(["", "common", "uncommon", "rare", "none", "comum", "incomum", "rara"]);

  // Jogos cujo filtro lista as raridades REAIS do catálogo em vez dos dois
  // baldes. Os baldes existem por causa do Pokémon (~30 strings de raridade,
  // listar tudo vira um select-quilômetro) — mas no Gundam são 11 valores
  // limpos e o colecionador pensa "quero só as LR+", não "quero especiais".
  // NÃO é global de propósito: o One Piece tem 147 strings (glifos vintage
  // japoneses); entrar aqui é decisão por jogo, medida no catálogo.
  // A ordem é a escada de raridade do jogo (o select sai nessa ordem; valor
  // fora da lista vai pro fim, em ordem alfabética).
  const RARITY_LISTED_GAMES = {
    gundam: ["Common", "C+", "C++", "Uncommon", "U+", "Rare", "R+", "Legend Rare", "LR+", "LR++", "Promo"]
  };
  const rarityListOrder = RARITY_LISTED_GAMES[(window.SLEEVU && window.SLEEVU.game) || ""] || null;

  // Facetas do jogo (Cor, Tipo, Seleção… — ver GAME_FACETS no shared.js) e a
  // seleção do usuário: { chaveDaFaceta: Set(valores) }. Dentro de uma faceta
  // vale OU (marcar Azul e Verde mostra os dois); entre facetas, E.
  const facetDefs = (shared.gameFacets && shared.gameFacets((window.SLEEVU && window.SLEEVU.game) || "")) || [];
  const facetSel = {};
  facetDefs.forEach((f) => { facetSel[f.key] = new Set(); });
  // Quais caixas estão ABERTAS. Marcar uma opção re-renderiza o painel inteiro
  // (as contagens das outras facetas mudam), e sem guardar isto a caixa fechava
  // a cada clique — impossível marcar duas cores seguidas.
  const facetOpen = new Set();
  // Quando o jogo tem faceta de raridade, o <select> de raridade sai de cena —
  // dois controles pra mesma coisa é armadilha.
  const rarityAsFacet = facetDefs.some((f) => f.key === "rarity");

  // Carta "secreta": número acima do total oficial do set (full art, SAR, SR,
  // hiper/rainbow...). Em sets japoneses essas cartas frequentemente vêm sem
  // raridade ("None"/""), então sem isto cairiam em "Comuns e raras".
  function isSecretCard(card) {
    const num = parseInt(String(card.number || "").replace(/\D/g, ""), 10);
    const total = parseInt(String(card.setTotal || "").replace(/\D/g, ""), 10);
    return Number.isFinite(num) && Number.isFinite(total) && total > 0 && num > total;
  }

  function rarityBucket(card) {
    const r = normalize(card.rarity);
    if (RARITY_BASE.has(r)) {
      // Sem raridade + número acima do total = secreta/full art → Especiais.
      if ((r === "" || r === "none") && isSecretCard(card)) return "special";
      return "base";
    }
    return "special";
  }

  const preview = shared.createCardPreview({
    getCard: (cardId) => cardsById.get(cardId),
    store: owned,
    prices,
    wishlist,
    onOwnedChange: () => refreshOwnership()
  });

  // Esqueleto enquanto o chunk do set desce: esta é a tela mais aberta do
  // catálogo e era a ÚNICA grade sem ele — no 4G a pessoa via o hero com os
  // números zerados e a grade vazia por segundos, que lê como "set sem cartas".
  if (elements.grid) shared.showSkeletons(elements.grid, "card", 12);

  Promise.all([resolveCards(), shared.loadFxRates()])
    .then(([resolvedCards]) => {
      cards = resolvedCards;
      cardsById = new Map(cards.map((card) => [card.id, card]));
      owned.migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId)));
      pageCards = getPageCards();
      limpaUrlDoSet();
      // Set vazio = provável link de OUTRO jogo (links antigos circulando sem
      // ?game=; o site caía no jogo da sessão e mostrava a página oca). Procura
      // o set nos outros catálogos e redireciona com o jogo certo.
      if (!pageCards.length && detailType === "set" && (detailName || detailSetId)) {
        rescueWrongGame();
      }
      init();
      // ?card=<id>: reabre o popup da carta — é onde o link compartilhado do
      // modal e as páginas /card/<slug>.html do Google aterrissam.
      preview.openFromUrl();
    })
    .catch((error) => {
      shared.mostraErroDeCatalogo(elements.empty, error);
      elements.empty.hidden = false;
    });

  // Procura o set pelo NOME nos outros jogos (fatia indexes-sets de cada um,
  // JSON leve) e, achando exatamente um dono, troca o ?game= da URL e recarrega.
  // Sequencial e com parada no primeiro match: é caminho raro (só link errado),
  // não vale abrir 11 requisições em paralelo.
  async function rescueWrongGame() {
    const atual = (window.SLEEVU && window.SLEEVU.game) || "pokemon";
    const manifestMode = !!(window.SLEEVU && window.SLEEVU.manifest);
    for (const slug of shared.GAME_SLUGS) {
      if (slug === atual) continue;
      try {
        const dir = shared.gameDataDir(slug);
        const r = await fetch(dir + (manifestMode ? "indexes-sets.generated.json" : "indexes-sets.json"));
        if (!r.ok) continue;
        const sets = await r.json();
        if (!Array.isArray(sets) || !sets.some((s) => (detailName && s.name === detailName) || (detailSetId && s.id === detailSetId))) continue;
        const url = new URL(location.href);
        url.searchParams.set("game", slug);
        // replace, não assign: a URL quebrada não fica no histórico do "voltar".
        location.replace(url);
        return;
      } catch (e) { /* jogo sem fatia: segue procurando */ }
    }
  }

  function init() {
    if (collectionScope) elements.grid.classList.add("scope-collection");
    renderHero();
    // Com hero (Pokémon/set): a coluna da direita passa a ser os valores (R$) e
    // os stats de cartas/progresso entram, compactos, dentro do próprio hero —
    // assim some a faixa de valores embaixo e ganha-se espaço de tela.
    if (!elements.hero.hidden) {
      const summary = document.querySelector(".detail-summary");
      if (summary) summary.classList.add("has-hero");
      const stats = document.querySelector(".detail-stats");
      if (stats) elements.hero.appendChild(stats);
      // Página de POKÉMON sem os valores (Valor total / Já gasto / Falta):
      // pedido do Fernando (2026-09) — quem abre um Pokémon quer ver as cartas,
      // e os três caixotes só empurravam a grade pra baixo. Tirar o nó (e não
      // só esconder) evita que updateValueStats() o traga de volta a cada
      // render. Set, artista e treinador seguem com a faixa.
      if (detailType === "pokemon" && elements.detailValues) {
        elements.detailValues.remove();
        elements.detailValues = null;
      }
      placeValues(summary);
    }
    renderInsights();
    initBackLink();
    hydrateFilters();
    if (elements.sortSelect) elements.sortSelect.value = selectedSort; // padrão: maior preço
    bindEvents();
    bindBinderNav();
    initProgressModes();
    initCollapsibles();
    applyGridView();
    render();
  }

  // Onde moram os VALORES (R$) na página de SET, por largura de tela:
  //   desktop -> irmãos do hero, na coluna própria à direita dele;
  //   celular -> DENTRO do hero, à direita do logo do set.
  // No celular a faixa de largura cheia custava ~90px de altura e as três
  // cápsulas saíam com larguras desiguais (a do meio encolhe quando "Já gasto"
  // está vazio). Ao lado do logo elas ficam iguais e o resumo encurta ~65px.
  // Mover o NÓ (em vez de duplicar) mantém uma fonte só pros ids de valor.
  // Só no set: a página de Pokémon nem tem mais os valores (ver init).
  // Seguro porque renderHero() roda uma vez e os valores são atualizados por
  // textContent — nada reescreve o innerHTML do hero depois daqui.
  const VALUES_MQ = "(max-width: 600px)";
  function placeValues(summary) {
    if (detailType !== "set" || !elements.detailValues || !summary) return;
    const mq = window.matchMedia(VALUES_MQ);
    const place = () => {
      const alvo = mq.matches ? elements.hero : summary;
      if (alvo && elements.detailValues.parentElement !== alvo) alvo.appendChild(elements.detailValues);
    };
    place();
    mq.addEventListener("change", place);
  }

  // Filtros atrás de um botão (mesmo padrão da Coleção); compartilha a pref do
  // colapso mobile (quem abre quer manter aberto).
  function initCollapsibles() {
    const wire = (btnId, el, key) => {
      const btn = document.getElementById(btnId);
      if (!btn || !el) return null;
      let open = false;
      try { open = localStorage.getItem(key) === "1"; } catch (e) { /* ignora */ }
      const paint = () => { el.classList.toggle("is-collapsed", !open); btn.setAttribute("aria-expanded", String(open)); };
      btn.addEventListener("click", () => {
        open = !open;
        try { localStorage.setItem(key, open ? "1" : "0"); } catch (e) { /* ignora */ }
        paint();
      });
      paint();
      return btn;
    };
    wire("detailFiltersBtn", document.getElementById("detailFilters"), "tcg-collector-filters-open");
  }

  // "Voltar" no cabeçalho aponta para a listagem de origem (ou Coleção no modo
  // coleção): Pokédex / Sets / Artistas / Treinadores.
  function initBackLink() {
    const back = document.getElementById("detailBack");
    if (!back) return;
    if (collectionScope) { back.href = "collection"; return; }
    const map = { pokemon: "pokedex", set: "sets", artist: "artists", trainer: "trainers" };
    back.href = map[detailType] || "pokedex";
  }

  // Alterna a grade entre grade (cards) e lista (linhas), guardando a preferência.
  function applyGridView() {
    shared.applyGridViewClasses(elements.grid, gridView);
    if (elements.viewToggle) {
      elements.viewToggle.querySelectorAll("[data-grid-view]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.gridView === gridView));
      });
      // O botão do fichário diz quantos bolsos tem (número no canto + título):
      // é ele que troca o tamanho, então precisa mostrar o estado atual.
      const binderBtn = elements.viewToggle.querySelector('[data-grid-view="binder"]');
      if (binderBtn) {
        const badge = binderBtn.querySelector("[data-binder-badge]");
        if (badge) badge.textContent = String(binderPockets);
        const rotulo = t("view.binderPockets", { n: binderPockets });
        binderBtn.title = rotulo;
        binderBtn.setAttribute("aria-label", rotulo);
        binderBtn.removeAttribute("data-i18n-title");
        binderBtn.removeAttribute("data-i18n-aria");
      }
    }
  }

  // URL só com ?setId= (sem ?name=): acha o nome no catálogo já carregado —
  // manifest (produção) ou cards.js (dev). Tudo abaixo continua chaveado pelo
  // nome, como sempre foi; só a entrada ganhou uma porta a mais.
  function resolveSetNameFromId() {
    if (detailType !== "set" || detailName || !detailSetId) return;
    const manifest = window.TCG_MANIFEST;
    const entry = manifest && Array.isArray(manifest.sets) ? manifest.sets.find((set) => set.id === detailSetId) : null;
    if (entry) { detailName = entry.name; return; }
    const card = Array.isArray(window.TCG_CARDS) ? window.TCG_CARDS.find((c) => c.setId === detailSetId) : null;
    if (card) detailName = card.set;
  }

  // Barra de endereço LIMPA pros sets de nome não-ASCII: troca ?name=<japonês>
  // por ?setId=<id>, sem entrada no histórico (replaceState). É o que o Ctrl+C
  // na barra copia — sleevu.app/detail?type=set&setId=hxh-hb-jf02&game=hxh em
  // vez de 140 caracteres de %E3%82%B8. Só depois de o set resolver: uma URL
  // trocada antes de saber se o id existe seria pior do que a feia.
  function limpaUrlDoSet() {
    if (detailType !== "set" || !pageCards.length || nomeLegivelNaUrl(detailName)) return;
    const id = detailSetId || pageCards[0].setId;
    if (!id || !params.has("name")) return;
    try {
      const sp = new URLSearchParams(window.location.search);
      sp.delete("name");
      sp.set("setId", id);
      history.replaceState(history.state, "", `${window.location.pathname}?${sp.toString()}`);
    } catch (e) { /* replaceState negado (iframe/sandbox): a URL feia ainda funciona */ }
  }

  // No modo manifest, baixa apenas os chunks de set necessários para esta página.
  async function resolveCards() {
    await shared.awaitCatalog();
    resolveSetNameFromId();
    if (Array.isArray(window.TCG_CARDS) && window.TCG_CARDS.length) {
      return window.TCG_CARDS;
    }

    const manifest = window.TCG_MANIFEST;
    if (!manifest || !Array.isArray(manifest.sets)) {
      return [];
    }

    if (detailType === "set") {
      let entries = manifest.sets.filter((set) => set.name === detailName);
      // O link da lista já diz QUAL edição abrir (?setId=/?region=): baixa só o
      // chunk dela. Sem isso, um nome que existe em duas línguas puxava os dois
      // chunks pra usar um. Link solto (sem os parâmetros) segue trazendo os
      // candidatos — é o pickSetEdition que escolhe, e ele precisa vê-los.
      if (entries.length > 1 && (detailSetId || detailRegion)) {
        const daEdicao = entries.filter((set) => (!detailSetId || set.id === detailSetId)
          && (!detailRegion || shared.cardLanguageRegion(set.language) === detailRegion));
        if (daEdicao.length) entries = daEdicao;
      }
      return entries.length ? shared.fetchSetChunks(entries) : [];
    }

    const indexes = window.TCG_INDEXES;
    const groups = detailType === "artist" ? indexes?.artists
      : detailType === "trainer" ? indexes?.trainers
      : indexes?.pokedex;
    const group = (groups || []).find((candidate) => candidate.name === detailName);
    if (!group) {
      // Índice CARREGADO e o nome não está nele = o nome não existe neste jogo
      // (link antigo, grafia trocada, URL digitada à mão). O índice sai do
      // MESMO build que os chunks, então varrer o catálogo atrás dele acharia
      // nada — só que baixando 507+ chunks no Pokémon (dezenas de MB) pra
      // terminar na mesma página vazia, e ainda lavando o cache de dados do
      // service worker no caminho. Vale para o índice vazio também: ele é
      // gerado a partir do próprio catálogo, então vazio ali = sem esse dado
      // neste jogo (Digimon/YGO/Riftbound/Union Arena não têm artista).
      //
      // A varredura fica só para o caso em que o ÍNDICE é que não chegou
      // (rede caiu no fetch da fatia) — aí ela é mesmo a única fonte.
      if (Array.isArray(groups)) {
        nomeForaDoIndice = true;
        return [];
      }
      return shared.fetchSetChunks(manifest.sets);
    }

    const setIds = manifest.sets.map((set) => set.id);
    const neededSetIds = new Set(group.cardIds.map((cardId) => shared.setIdForCard(cardId, setIds)));
    return shared.fetchSetChunks(manifest.sets.filter((set) => neededSetIds.has(set.id)));
  }

  function getPageCards() {
    if (detailType === "set") {
      // O NOME do set não é chave única no catálogo — ver pickSetEdition no
      // shared.js. A página abre UMA edição (setId + região de idioma).
      return shared.pickSetEdition(cards.filter((card) => card.set === detailName), detailSetId, detailRegion);
    }

    if (detailType === "artist") {
      return cards.filter((card) => (card.artist || "Artista desconhecido") === detailName);
    }

    if (detailType === "pokemon") {
      return cards.filter((card) => (card.pokemonName || speciesName(card.name)) === detailName);
    }

    if (detailType === "trainer") {
      return cards.filter((card) => card.category === "Trainer" && card.name === detailName);
    }

    return [];
  }

  function renderHero() {
    const sample = pageCards[0];
    if (!sample) return;

    if (detailType === "set") {
      // Vintage japonês: o título vai em inglês (igual à lista) e o nome
      // ORIGINAL aparece logo abaixo — é aqui, ao abrir o set, que ele importa.
      const nomeExibido = shared.setDisplayName(sample.setId, sample.set, sample.language);
      const nomeOriginal = shared.setOriginalName(sample.setId, sample.set, sample.language);
      const logo = sample.setLogo
        ? localizedImg(sample.setLogo, { alt: nomeExibido, className: "set-logo", priority: "high" })
        : `<span class="set-logo-placeholder">${escapeHtml(nomeExibido)}</span>`;
      const symbol = sample.setSymbol
        ? localizedImg(sample.setSymbol, { className: "set-symbol" })
        : "";
      // Custo pra completar: mercado das cartas que faltam (piso "≥" se alguma
      // faltante não tem preço). Só aparece com coleção iniciada no set.
      const missing = pageCards.filter((card) => !owned.has(card.id));
      const ownedHere = pageCards.length - missing.length;
      let missingHtml = "";
      if (ownedHere > 0 && missing.length > 0) {
        const sum = shared.sumCardsValue(missing, prices);
        if (sum.value > 0) {
          const cost = `${sum.unpriced > 0 ? "≥ " : "≈ "}${shared.formatMoney(shared.getCurrency(), sum.value)}`;
          const hint = t("set.missingHint", { n: missing.length }) + (sum.unpriced > 0 ? " " + t("set.missingUnpriced", { u: sum.unpriced }) : "");
          missingHtml = `<p class="set-missing" title="${escapeAttribute(hint)}">${escapeHtml(t("set.missingCost", { n: missing.length, v: cost }))}</p>`;
        }
      }
      // "N cartas oficiais · N no catálogo local" só aparece quando os dois
      // números DIVERGEM — aí ele informa que o catálogo está incompleto (ex.:
      // vintage com 66 de 80). Iguais, era a mesma contagem que o stat "cartas
      // nessa página" já dá logo ao lado: repetição ocupando uma linha inteira.
      const totalOficial = sample.setTotal || pageCards.length;
      const contagemHtml = totalOficial === pageCards.length ? "" :
        `<p>${escapeHtml(`${t("set.officialCards", { n: totalOficial })} · ${t("set.inLocalCatalog", { n: pageCards.length })}`)}</p>`;
      elements.hero.innerHTML = `
        <div class="set-art detail-set-art">${logo}${symbol}</div>
        <div class="detail-set-info">
          <h2>${escapeHtml(nomeExibido)}</h2>
          ${nomeOriginal ? `<p class="set-original-name" lang="ja">${escapeHtml(nomeOriginal)}</p>` : ""}
          ${contagemHtml}
          ${missingHtml}
        </div>
      `;
      elements.hero.hidden = false;
      return;
    }

    if (detailType === "pokemon") {
      renderPokemonHero(sample);
    }
  }

  // Navegação Pokémon anterior/próximo (dexId ±1) como cartões com sprite, nº e
  // nome — abaixo da imagem do hero. Preserva o modo coleção.
  function pokemonStepCard(d, dir) {
    const names = window.TCG_POKEMON_NAMES || {};
    const nm = names[d];
    if (!nm) return `<span class="pokemon-step pokemon-step-empty" aria-hidden="true"></span>`;
    const scope = collectionScope ? "collection" : undefined;
    const sprite = shared.spriteUrl(d);
    return `<a class="pokemon-step pokemon-step-${dir}" href="${escapeAttribute(shared.detailUrl("pokemon", nm, scope))}" title="${escapeAttribute(nm)}">
      <img class="pokemon-step-sprite" src="${escapeAttribute(sprite)}" alt="" loading="lazy">
      <span class="pokemon-step-text">
        <span class="pokemon-step-num">#${d}</span>
        <span class="pokemon-step-name">${escapeHtml(nm)}</span>
      </span>
    </a>`;
  }
  function pokemonStepsHtml(dex) {
    if (!Number.isFinite(dex)) return "";
    return `<nav class="pokemon-hero-steps" aria-label="${escapeAttribute(t("detail.navAria"))}">${pokemonStepCard(dex - 1, "prev")}${pokemonStepCard(dex + 1, "next")}</nav>`;
  }

  function renderPokemonHero(sample) {
    const dexId = sample.dexId || "";
    const region = REGION_BY_GENERATION[Number(sample.generation)] || "";
    const generationLabel = sample.generation ? t("card.generation", { g: toRoman(sample.generation) }) : "";
    const isFavorite = favorites.has(String(dexId));
    const isDexOwned = dexOwned.has(String(dexId));
    const pokemonImage = sample.pokemonImage
      ? `<img class="pokemon-hero-image" src="${escapeAttribute(sample.pokemonImage)}" alt="${escapeAttribute(detailName)}">`
      : "";

    // A fileira "Mais valiosas" que ficava à direita saiu (2026-09, pedido do
    // Fernando): as mesmas cartas já aparecem na grade logo abaixo, ordenada
    // por maior preço, e o hero volta ao layout padrão (arte | infos | stats).
    elements.hero.innerHTML = `
      <div class="pokemon-hero-left">
        <div class="pokemon-hero-art">${pokemonImage}</div>
        ${pokemonStepsHtml(Number(dexId))}
      </div>
      <div class="pokemon-hero-info">
        <h2 class="pokemon-hero-title">
          <span class="dex-num">#${String(dexId || "?").padStart(4, "0")}</span>
          <span class="pokemon-hero-name">${escapeHtml(detailName)}</span>
        </h2>
        <div class="type-badges" data-type-badges aria-label="Tipos"></div>
        <div class="pokemon-meta-row">
          ${region ? `<span class="meta-pill">${escapeHtml(region)}</span>` : ""}
          ${generationLabel ? `<span class="meta-pill">${escapeHtml(generationLabel)}</span>` : ""}
        </div>
        <div class="pokemon-hero-actions">
          <button class="favorite-button dex-hero-button" data-dex-toggle aria-pressed="${isDexOwned}">${dexHaveLabel(isDexOwned)}</button>
          <button class="favorite-button" data-favorite-toggle aria-pressed="${isFavorite}">${favoriteLabel(isFavorite)}</button>
          <button class="forms-toggle" data-forms-toggle aria-expanded="false" hidden></button>
        </div>
        <div class="forms-list" data-forms-list hidden></div>
        <p class="pokemon-hero-count">${escapeHtml(tn("hero.cardsInCatalog", pageCards.length))}</p>
      </div>
    `;
    elements.hero.hidden = false;

    bindHeroActions(dexId);
    fillPokemonMeta(dexId);
  }

  function bindHeroActions(dexId) {
    const dexButton = elements.hero.querySelector("[data-dex-toggle]");
    if (dexButton) {
      dexButton.addEventListener("click", () => {
        dexOwned.toggle(String(dexId));
        const isDexOwned = dexOwned.has(String(dexId));
        dexButton.setAttribute("aria-pressed", String(isDexOwned));
        dexButton.textContent = dexHaveLabel(isDexOwned);
      });
    }

    // Pokédex automática (carta adicionada aqui com a opção ligada): o botão
    // do herói acompanha sem recarregar.
    document.addEventListener("sleevu:dex-marked", () => {
      if (!dexButton) return;
      const on = dexOwned.has(String(dexId));
      dexButton.setAttribute("aria-pressed", String(on));
      dexButton.textContent = dexHaveLabel(on);
    });

    const favButton = elements.hero.querySelector("[data-favorite-toggle]");
    if (favButton) {
      favButton.addEventListener("click", () => {
        favorites.toggle(String(dexId));
        const isFavorite = favorites.has(String(dexId));
        favButton.setAttribute("aria-pressed", String(isFavorite));
        favButton.innerHTML = favoriteLabel(isFavorite);
      });
    }

    const formsToggle = elements.hero.querySelector("[data-forms-toggle]");
    const formsList = elements.hero.querySelector("[data-forms-list]");
    if (formsToggle && formsList) {
      formsToggle.addEventListener("click", () => {
        const show = formsList.hidden;
        formsList.hidden = !show;
        formsToggle.setAttribute("aria-expanded", String(show));
      });
    }
  }

  async function fillPokemonMeta(dexId) {
    const meta = await shared.fetchPokemonMeta(dexId);

    const badges = elements.hero.querySelector("[data-type-badges]");
    if (badges && meta.types.length) {
      badges.innerHTML = meta.types.map(typeBadge).join("");
    }

    const formsToggle = elements.hero.querySelector("[data-forms-toggle]");
    const formsList = elements.hero.querySelector("[data-forms-list]");
    if (formsToggle && formsList && meta.forms.length) {
      formsToggle.textContent = tn("forms.toggle", meta.forms.length);
      formsToggle.hidden = false;
      formsList.innerHTML = meta.forms
        .map((form) => `<span class="form-chip">${escapeHtml(formatFormName(form, detailName))}</span>`)
        .join("");
    }
  }

  function favoriteLabel(isFavorite) {
    return isFavorite ? t("favorite.active") : t("favorite.add");
  }

  function dexHaveLabel(marked) {
    return marked ? t("dex.haveActive") : t("dex.have");
  }

  function typeBadge(slug) {
    const color = TYPE_COLORS[slug] || "#6b7280";
    const translated = t(`type.${slug}`);
    const label = translated === `type.${slug}` ? slug : translated;
    return `<span class="type-badge" style="--type-color: ${color}">${escapeHtml(label)}</span>`;
  }

  function formatFormName(varietyName, species) {
    const speciesSlug = normalize(species).replace(/\s+/g, "-");
    let rest = varietyName;
    if (rest.startsWith(`${speciesSlug}-`)) {
      rest = rest.slice(speciesSlug.length + 1);
    }
    return rest
      .split("-")
      .map((word) => FORM_WORDS[word] || (word.charAt(0).toUpperCase() + word.slice(1)))
      .join(" ");
  }


  function hydrateFilters() {
    // Idioma: lista suspensa (igual à Coleção), em vez de botões por língua.
    const linguas = unique(pageCards.map((card) => shared.normalizeCardLanguage(card.language)));
    addOptions(elements.languageFilter, linguas, (value) => shared.cardLanguageLabel(value));
    // Com UMA língua só, o campo é peso morto e SOME. É o caso de toda página
    // de set — ela abre uma edição só (pickSetEdition), então o idioma já foi
    // decidido na LISTA de sets (chips de região) antes de chegar aqui — e das
    // páginas de artista/espécie nos jogos só-inglês (Magic, Lorcana…). Onde
    // línguas se misturam de verdade (um Pokémon com impressões EN/PT/JA, com
    // preferência "todos"), o filtro continua aparecendo. Escondê-lo abre
    // espaço na barra pro chip "Versões: Agrupar" respirar.
    const campoIdioma = elements.languageFilter.closest("div");
    if (campoIdioma) campoIdioma.hidden = linguas.length <= 1;
    if (linguas.length <= 1) {
      elements.languageFilter.value = "";
      selectedLanguage = "";
    } else {
      // Idioma de carta preferido vira o filtro padrão (se houver cartas dele aqui).
      const pref = shared.getCardLang();
      if (pref !== "all" && Array.from(elements.languageFilter.options).some((option) => option.value === pref)) {
        elements.languageFilter.value = pref;
      }
      selectedLanguage = elements.languageFilter.value;
    }

    renderSegmented(elements.ownedChips, [
      { value: "all", label: t("filter.all.f") },
      { value: "owned", label: t("filter.owned") },
      { value: "missing", label: t("filter.missing") },
      { value: "wanted", label: t("filter.wanted") }
    ], selectedOwned);

    renderRarityFilter();
    renderFacets();
  }

  // Raridade como lista suspensa. Dois modos:
  //   - baldes (padrão): Todas / Comuns e raras / Especiais;
  //   - lista real (jogos em RARITY_LISTED_GAMES): cada raridade do catálogo
  //     vira uma opção, na escada do jogo. O rótulo é a string crua do catálogo
  //     (como a página Todas as cartas já faz) — é vocabulário do JOGO, não da
  //     interface, então não passa pelo i18n.
  // Nos dois modos: só o que está presente nesta página, e o filtro some com
  // menos de 2 opções (filtro de opção única não filtra nada).
  // Painel de facetas do jogo. As opções e as CONTAGENS saem das cartas desta
  // página: faceta sem valor (ou com um só) não aparece — filtro de opção única
  // não filtra nada. A contagem de cada opção respeita as OUTRAS facetas (como
  // em loja: marcar "Criaturas" recalcula quantas são azuis), mas não a própria,
  // senão marcar uma opção zeraria as irmãs.
  function renderFacets() {
    const box = elements.facets;
    if (!box) return;
    // Some/aparece pelo WRAPPER (#facetsField): é ele que carrega o título
    // "Filtros" — esconder só o miolo deixaria o rótulo sozinho na barra.
    const campo = document.getElementById("facetsField") || box;
    if (!facetDefs.length) { campo.hidden = true; return; }

    const passaFacetas = (card, exceto) => facetDefs.every((f) => {
      if (f.key === exceto) return true;
      const sel = facetSel[f.key];
      if (!sel.size) return true;
      return f.of(card).some((v) => sel.has(v));
    });

    const grupos = facetDefs.map((f) => {
      const contagem = new Map();
      pageCards.forEach((card) => {
        if (!passaFacetas(card, f.key)) return;
        f.of(card).forEach((v) => contagem.set(v, (contagem.get(v) || 0) + 1));
      });
      // Valor marcado que zerou continua na lista (senão a pessoa não consegue
      // desmarcar o filtro que ela mesma pôs).
      facetSel[f.key].forEach((v) => { if (!contagem.has(v)) contagem.set(v, 0); });
      const ordem = f.order || [];
      const pos = (v) => { const i = ordem.indexOf(v); return i < 0 ? ordem.length : i; };
      // Opção que casa com TODAS as cartas da página não filtra nada — marcar
      // deixa a grade igual. Vale pra qualquer faceta e resolve sozinha o caso
      // que apareceu no Magic: `universesbeyond` está nas 854 cartas do LTR, e
      // um set inteiro de raridade única faria o mesmo. Só some quando NÃO está
      // marcada (senão a pessoa não conseguiria desmarcar o próprio filtro) e
      // quando há mais de uma opção — se é a única, sumir esconderia a faceta.
      const inutil = (v) => contagem.get(v) === pageCards.length
        && contagem.size > 1
        && !facetSel[f.key].has(v);
      const valores = [...contagem.keys()].filter((v) => !inutil(v))
        .sort((a, b) => (pos(a) - pos(b)) || String(a).localeCompare(String(b)));
      if (valores.length < 2) return "";
      const itens = valores.map((v) => {
        const marcado = facetSel[f.key].has(v);
        return `<label class="facet-opt${marcado ? " on" : ""}">`
          + `<input type="checkbox" data-facet="${escapeAttribute(f.key)}" value="${escapeAttribute(v)}"${marcado ? " checked" : ""}>`
          + `<span class="facet-opt-label">${escapeHtml(f.label(v))}</span>`
          + `<span class="facet-opt-n">${contagem.get(v)}</span></label>`;
      }).join("");
      // Caixa com DROPDOWN, igual aos outros filtros da barra — a diferença é
      // que dentro dela dá pra MARCAR várias. <details> nativo: abre/fecha e
      // navega por teclado sem JS (mesmo padrão do menu "View" dos decks).
      // O resumo mostra quantas estão marcadas, senão o filtro ativo ficaria
      // escondido dentro da caixa fechada.
      const n = facetSel[f.key].size;
      const resumo = escapeHtml(t(f.labelKey)) + (n ? ` <span class="facet-sum-n">${n}</span>` : "");
      return `<details class="facet-drop${n ? " has-sel" : ""}"${facetOpen.has(f.key) ? " open" : ""} data-facet-drop="${escapeAttribute(f.key)}">
        <summary>${resumo}</summary>
        <div class="facet-pop">${itens}</div>
      </details>`;
    }).filter(Boolean).join("");

    box.innerHTML = grupos;
    campo.hidden = !grupos;
  }

  function renderRarityFilter() {
    if (!elements.rarityFilter || !elements.rarityField) return;
    // Jogo com faceta de raridade (Magic): o select some — quem manda é a faceta.
    if (rarityAsFacet) { elements.rarityField.hidden = true; selectedRarity = ""; return; }
    if (rarityListOrder) {
      const present = [...new Set(pageCards.map((card) => String(card.rarity || "")).filter((r) => r && r !== "None"))];
      const pos = (r) => { const i = rarityListOrder.indexOf(r); return i < 0 ? rarityListOrder.length : i; };
      present.sort((a, b) => (pos(a) - pos(b)) || a.localeCompare(b));
      if (present.length < 2) {
        elements.rarityField.hidden = true;
        selectedRarity = "";
        return;
      }
      elements.rarityField.hidden = false;
      elements.rarityFilter.innerHTML = `<option value="">${escapeHtml(t("filter.all.f"))}</option>`
        + present.map((r) => `<option value="${escapeAttribute(r)}">${escapeHtml(r)}</option>`).join("");
      if (!present.includes(selectedRarity)) selectedRarity = "";
      elements.rarityFilter.value = selectedRarity;
      return;
    }
    const present = new Set(pageCards.map((card) => rarityBucket(card)));
    const buckets = RARITY_BUCKET_ORDER.filter((key) => present.has(key));
    if (buckets.length < 2) {
      elements.rarityField.hidden = true;
      selectedRarity = "";
      return;
    }
    elements.rarityField.hidden = false;
    elements.rarityFilter.innerHTML = `<option value="">${escapeHtml(t("filter.all.f"))}</option>`
      + buckets.map((key) => {
          const title = t(`rarity.${key}.title`);
          const titleAttr = title !== `rarity.${key}.title` ? ` title="${escapeAttribute(title)}"` : "";
          return `<option value="${key}"${titleAttr}>${escapeHtml(t(`rarity.${key}`))}</option>`;
        }).join("");
    if (!buckets.includes(selectedRarity)) selectedRarity = "";
    elements.rarityFilter.value = selectedRarity;
  }

  function renderSegmented(container, options, selectedValue) {
    if (!container) return;
    container.innerHTML = "";
    options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "segmented-option";
      button.dataset.value = option.value;
      button.textContent = option.label;
      button.setAttribute("aria-pressed", String(option.value === selectedValue));
      container.appendChild(button);
    });
  }

  function bindSegmented(container, onSelect) {
    if (!container) return;
    container.addEventListener("click", (event) => {
      const button = event.target.closest(".segmented-option");
      if (!button) return;
      onSelect(button.dataset.value);
      Array.from(container.children).forEach((node) => {
        node.setAttribute("aria-pressed", String(node === button));
      });
      render({ resetCount: true });
    });
  }

  function bindEvents() {
    const applyFilters = () => render({ resetCount: true });
    elements.search.addEventListener("input", debounce(applyFilters, 200));
    elements.languageFilter.addEventListener("input", () => { selectedLanguage = elements.languageFilter.value; applyFilters(); });
    // Facetas: delegação (o painel é reescrito a cada render). Depois de marcar,
    // re-renderiza o painel pras contagens das outras facetas acompanharem.
    if (elements.facets) elements.facets.addEventListener("change", (event) => {
      const cb = event.target.closest("[data-facet]");
      if (!cb) return;
      const sel = facetSel[cb.dataset.facet];
      if (!sel) return;
      if (cb.checked) sel.add(cb.value); else sel.delete(cb.value);
      applyFilters();
      renderFacets();
    });
    // Estado aberto/fechado de cada caixa (o `toggle` do <details> não borbulha,
    // então escuta na fase de captura). Uma caixa aberta FECHA as outras: duas
    // gavetas abertas se sobrepõem.
    if (elements.facets) elements.facets.addEventListener("toggle", (event) => {
      const d = event.target.closest ? event.target.closest("[data-facet-drop]") : null;
      if (!d) return;
      const key = d.dataset.facetDrop;
      if (d.open) {
        facetOpen.clear();
        facetOpen.add(key);
        elements.facets.querySelectorAll("[data-facet-drop]").forEach((o) => { if (o !== d) o.open = false; });
      } else {
        facetOpen.delete(key);
      }
    }, true);
    // Fecha ao clicar fora e no Esc — <details> não faz nenhum dos dois sozinho.
    document.addEventListener("click", (event) => {
      if (!elements.facets || event.target.closest("[data-facet-drop]")) return;
      facetOpen.clear();
      elements.facets.querySelectorAll("[data-facet-drop][open]").forEach((d) => { d.open = false; });
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !elements.facets) return;
      facetOpen.clear();
      elements.facets.querySelectorAll("[data-facet-drop][open]").forEach((d) => { d.open = false; });
    });
    bindSegmented(elements.ownedChips, (value) => { selectedOwned = value; });
    // Outra aba mexeu na coleção, ou uma gravação falhou e o store voltou ao
    // disco (ver registerCrossTabStore no shared): redesenha posse e progresso
    // in-place, sem reconstruir a grade.
    document.addEventListener("sleevu:data-rehydrated", () => { if (pageCards.length) refreshOwnership(); });

    if (elements.viewToggle) {
      elements.viewToggle.addEventListener("click", (event) => {
        const button = event.target.closest("[data-grid-view]");
        if (!button) return;
        // Compacto muda o HTML do tile (sem <img>), não só a classe da grade:
        // entrar ou sair dele exige reconstruir a grade. grid<->lista é só CSS.
        // O fichário monta a grade do seu jeito (páginas), então entrar, sair
        // e trocar o nº de bolsos também reconstroem.
        const eraCompacto = gridView === "compact";
        const eraBinder = gridView === "binder";
        const querBinder = button.dataset.gridView === "binder";
        if (querBinder && eraBinder) {
          // Já no fichário: o clique troca o tamanho (9 → 12 → 16 → 4 → 9…).
          binderPockets = BINDER_POCKETS[(BINDER_POCKETS.indexOf(binderPockets) + 1) % BINDER_POCKETS.length];
          try { localStorage.setItem(BINDER_KEY, String(binderPockets)); } catch (e) { /* ignora */ }
          delete elements.grid.dataset.binderPage; // página 2 de 9 bolsos não é a de 16: recomeça

        }
        gridView = shared.gridViewValue(button.dataset.gridView);
        localStorage.setItem("tcg-detail-view", gridView);
        const virouCompacto = gridView === "compact";
        applyGridView();
        if (eraCompacto !== virouCompacto || eraBinder || querBinder) render();
      });
    }

    if (elements.sortSelect) {
      elements.sortSelect.addEventListener("change", () => {
        selectedSort = elements.sortSelect.value;
        render({ resetCount: true });
      });
    }

    if (elements.rarityFilter) {
      elements.rarityFilter.addEventListener("input", () => {
        selectedRarity = elements.rarityFilter.value;
        render({ resetCount: true });
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

      if (shared.handleWantTileClick(event, wishlist)) {
        refreshOwnership();
        return;
      }

      if (shared.handleRemoveOneTileClick(event, owned)) { refreshOwnership(); return; }

      // Quick-add: cada clique no "+" soma +1 e pisca "✓ Adicionada!" por 2s
      // (igual ao Explorar).
      const addButton = shared.handleAddTileClick(event, owned, wishlist);
      if (addButton) {
        refreshOwnership();
        shared.flashTileAdded(addButton, owned);
      }
    });
  }

  function render({ resetCount = false } = {}) {
    const visibleCards = filterCards();
    const tiles = sortTiles(shared.cardVariantPairs(visibleCards, { group: agrupaVersoes }));
    // Cartas sem imagem vão para o fim (sort estável preserva a ordem da ordenação escolhida).
    tiles.sort((a, b) => Number(shared.cardHasImage(b.card)) - Number(shared.cardHasImage(a.card)));
    const tileOf = ({ card, variant }) => shared.variantTile(card, variant, owned, wishlist, prices, { addMode: true, grouped: agrupaVersoes, compact: gridView === "compact", lists: true });
    if (gridView === "binder") renderBinder(tiles, tileOf);
    else pager.render(tiles, tileOf, { resetCount });

    elements.empty.hidden = tiles.length > 0;
    // Beco sem saída vira caminho: em vez de "nenhuma carta encontrada" (que
    // parece defeito), diz que o nome não existe aqui e leva pra busca.
    if (!tiles.length && nomeForaDoIndice && !elements.empty.dataset.semSaida) {
      elements.empty.dataset.semSaida = "1";
      elements.empty.removeAttribute("data-i18n");
      elements.empty.innerHTML = t("empty.detailUnknown", {
        name: escapeHtml(detailName),
        url: `explore?q=${encodeURIComponent(detailName)}`,
      });
    }
    elements.resultCount.textContent = tn("results.count", tiles.length);
    updateHeaderStats();
  }

  // ── Fichário ─────────────────────────────────────────────────────────────
  // A grade vira um fichário: páginas de N bolsos (2×2, 3×3, 3×4, 4×4) numa
  // trilha que ROLA DE LADO com scroll-snap — no celular é o dedo, no desktop as
  // setas, o <select> de página ou a rolagem horizontal. Só a imagem da carta
  // aparece (nome, número, botões somem por CSS em .is-binder; clicar na carta
  // abre o card, como sempre). Os tiles são os MESMOS do variantTile — o
  // refreshOwnership e os handlers da grade seguem valendo sem saber do modo.
  //
  // Cada página nasce com os N bolsos VAZIOS (caixas na proporção da carta) e
  // só recebe os tiles quando fica a 1 página de distância da atual: o set
  // grande (YGO passa de 1000 impressões) não paga o DOM inteiro de uma vez, e
  // a altura da trilha não pula porque os bolsos já ocupam o lugar.
  const BINDER_ICONS = {
    first: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>',
    last: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>',
    book: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 3v18"/></svg>'
  };
  let binder = null; // { rail, pages, tiles, tileOf, current, per, rendered:Set }
  function renderBinder(tiles, tileOf) {
    // Limpa a grade pelo pager (tira também a sentinela e o botão "mais N").
    pager.render([], () => document.createDocumentFragment());
    const per = binderPockets;
    const cols = per === 4 ? 2 : per === 16 ? 4 : 3;
    // Linhas entram no CSS pra limitar a largura da trilha de modo que a
    // PÁGINA INTEIRA caiba na altura da tela no desktop (ver .binder-rail).
    elements.grid.style.setProperty("--binder-rows", String(per / cols));
    const pageCount = Math.max(1, Math.ceil(tiles.length / per));
    const grid = elements.grid;
    grid.style.setProperty("--binder-cols", String(cols));
    const nav = document.createElement("div");
    nav.className = "binder-nav";
    const opcoes = Array.from({ length: pageCount }, (_, i) => `<option value="${i}">${escapeHtml(t("binder.page", { n: i + 1 }))}</option>`).join("");
    nav.innerHTML = `
      <button type="button" class="binder-btn" data-binder-go="first" aria-label="${escapeAttribute(t("binder.first"))}" title="${escapeAttribute(t("binder.first"))}">${BINDER_ICONS.first}</button>
      <button type="button" class="binder-btn" data-binder-go="prev" aria-label="${escapeAttribute(t("binder.prev"))}" title="${escapeAttribute(t("binder.prev"))}">${BINDER_ICONS.prev}</button>
      <label class="binder-page-pick">${BINDER_ICONS.book}<span class="sr-only">${escapeHtml(t("binder.pickPage"))}</span><select data-binder-select>${opcoes}</select><span class="binder-page-total">/ ${pageCount}</span></label>
      <button type="button" class="binder-btn" data-binder-go="next" aria-label="${escapeAttribute(t("binder.next"))}" title="${escapeAttribute(t("binder.next"))}">${BINDER_ICONS.next}</button>
      <button type="button" class="binder-btn" data-binder-go="last" aria-label="${escapeAttribute(t("binder.last"))}" title="${escapeAttribute(t("binder.last"))}">${BINDER_ICONS.last}</button>`;
    const rail = document.createElement("div");
    rail.className = "binder-rail";
    rail.setAttribute("aria-label", t("binder.railAria"));
    const pages = [];
    for (let p = 0; p < pageCount; p++) {
      const page = document.createElement("section");
      page.className = "binder-page";
      page.dataset.binderPage = String(p);
      page.setAttribute("aria-label", t("binder.pageOf", { n: p + 1, t: pageCount }));
      for (let i = 0; i < per; i++) {
        const pocket = document.createElement("div");
        pocket.className = "binder-pocket";
        page.appendChild(pocket);
      }
      rail.appendChild(page);
      pages.push(page);
    }
    // Bolinhas de página (como no app Dex). Acima de 24 páginas viram ruído —
    // o <select> e as setas já navegam; as bolinhas somem.
    const dots = document.createElement("div");
    dots.className = "binder-dots";
    if (pageCount > 1 && pageCount <= 24) {
      dots.innerHTML = Array.from({ length: pageCount }, (_, i) => `<button type="button" class="binder-dot" data-binder-dot="${i}" aria-label="${escapeAttribute(t("binder.page", { n: i + 1 }))}"></button>`).join("");
    }
    grid.append(nav, rail, dots);
    binder = { rail, pages, tiles, tileOf, per, current: 0, rendered: new Set(), pageCount, nav, dots };
    // A página lembrada sobrevive à troca de filtro/ordenação enquanto existir
    // (mudou o nº de páginas: volta pro início).
    const lembrada = Number(grid.dataset.binderPage || 0);
    binder.current = lembrada < pageCount ? lembrada : 0;
    ensureBinderPages(binder.current);
    paintBinderNav();
    if (binder.current > 0) {
      // Sem animação: a página já abre no lugar certo (e o `scrollTo` com
      // behavior instant não dispara o scroll-snap do meio do caminho).
      requestAnimationFrame(() => { rail.scrollLeft = binder.current * rail.clientWidth; });
    }
    let raf = 0;
    rail.addEventListener("scroll", () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!binder || !rail.clientWidth) return;
        const idx = Math.max(0, Math.min(binder.pageCount - 1, Math.round(rail.scrollLeft / rail.clientWidth)));
        if (idx !== binder.current) {
          binder.current = idx;
          grid.dataset.binderPage = String(idx);
          paintBinderNav();
        }
        // Pré-monta a vizinha pra qual o dedo está indo.
        ensureBinderPages(idx);
      });
    }, { passive: true });
  }
  function ensureBinderPages(idx) {
    if (!binder) return;
    for (let p = idx - 1; p <= idx + 1; p++) {
      if (p < 0 || p >= binder.pageCount || binder.rendered.has(p)) continue;
      binder.rendered.add(p);
      const pockets = binder.pages[p].children;
      for (let i = 0; i < binder.per; i++) {
        const item = binder.tiles[p * binder.per + i];
        if (!item) break;
        pockets[i].appendChild(binder.tileOf(item));
        pockets[i].classList.add("is-filled");
      }
    }
  }
  function paintBinderNav() {
    if (!binder) return;
    const { current, pageCount, nav, dots } = binder;
    const sel = nav.querySelector("[data-binder-select]");
    if (sel && Number(sel.value) !== current) sel.value = String(current);
    nav.querySelector('[data-binder-go="first"]').disabled = current <= 0;
    nav.querySelector('[data-binder-go="prev"]').disabled = current <= 0;
    nav.querySelector('[data-binder-go="next"]').disabled = current >= pageCount - 1;
    nav.querySelector('[data-binder-go="last"]').disabled = current >= pageCount - 1;
    dots.querySelectorAll("[data-binder-dot]").forEach((d) => {
      d.setAttribute("aria-current", Number(d.dataset.binderDot) === current ? "page" : "false");
    });
  }
  function goBinderPage(idx) {
    if (!binder) return;
    const alvo = Math.max(0, Math.min(binder.pageCount - 1, idx));
    ensureBinderPages(alvo);
    binder.rail.scrollTo({ left: alvo * binder.rail.clientWidth, behavior: "smooth" });
    // O evento de scroll acerta current/nav quando a rolagem chegar; aqui só
    // pra resposta imediata nos botões (clicar rápido em › › ›).
    binder.current = alvo;
    elements.grid.dataset.binderPage = String(alvo);
    paintBinderNav();
  }
  function bindBinderNav() {
    elements.grid.addEventListener("click", (event) => {
      if (!binder) return;
      const go = event.target.closest("[data-binder-go]");
      if (go) {
        const { current, pageCount } = binder;
        const dir = go.dataset.binderGo;
        goBinderPage(dir === "first" ? 0 : dir === "prev" ? current - 1 : dir === "next" ? current + 1 : pageCount - 1);
        return;
      }
      const dot = event.target.closest("[data-binder-dot]");
      if (dot) goBinderPage(Number(dot.dataset.binderDot));
    });
    elements.grid.addEventListener("change", (event) => {
      const sel = event.target.closest("[data-binder-select]");
      if (sel && binder) goBinderPage(Number(sel.value));
    });
    // Setas do teclado quando o foco está no fichário (ou nas setas dele).
    elements.grid.addEventListener("keydown", (event) => {
      if (!binder || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      if (event.target.closest("select")) return; // o select usa as setas pra si
      event.preventDefault();
      goBinderPage(binder.current + (event.key === "ArrowLeft" ? -1 : 1));
    });
  }

  // ── Resumo visual do set (cartões de insight) ────────────────────────────
  // Três cartões, molde do app Dex (pedido de 2026-09-14): distribuição por
  // GRUPO de raridade, distribuição por TIPO de carta e o trio conjunto /
  // lançamento / valor de mercado com um anel de progresso. Os dois gráficos
  // saem das cartas da página (não mudam com a coleção) e são montados uma
  // vez; o terceiro é atualizado pelo updateHeaderStats/updateValueStats.
  //
  // Grupos de raridade: quatro degraus fixos (comum · rara · ultra · secreta)
  // em cima do rarityRank, que já é a régua de raridade de TODOS os jogos —
  // listar cada string (~30 no Pokémon) viraria um gráfico ilegível. A cor
  // acompanha o DEGRAU (cinza → azul → roxo → laranja), como o Dex faz; o
  // número em cima da barra fica na cor de texto.
  const RARITY_GROUPS = ["common", "rare", "ultra", "secret"];
  const RARITY_GROUP_ICONS = {
    common: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="6"/></svg>',
    rare: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9-4.3-4.1 5.9-.8z"/></svg>',
    ultra: '<svg viewBox="0 0 24 24" width="22" height="18" fill="currentColor" aria-hidden="true"><path d="M8 4l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 13.8l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/><path d="M17 9l1.5 3 3.3.5-2.4 2.3.6 3.3-3-1.6-3 1.6.6-3.3-2.4-2.3 3.3-.5z"/></svg>',
    secret: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9-4.3-4.1 5.9-.8z"/></svg>'
  };
  function rarityGroup(rarity) {
    // Mítica (Magic) não casa com nenhuma régua do rarityRank (cai em
    // "exótica", abaixo da comum) — e é o degrau acima da rara.
    if (/mythic|mitica|mítica/.test(normalize(rarity))) return "ultra";
    const rank = shared.rarityRank(rarity);
    if (rank >= 60) return "secret";
    if (rank >= 40) return "ultra";
    if (rank >= 30) return "rare";
    return "common";
  }
  // Tipo de carta: o mesmo agrupamento das listas de deck (cardTypeGroup), que
  // no Magic reduz a type_line ao tipo principal. Pokémon/Treinador/Energia
  // ganham tradução; o resto é vocabulário do jogo e sai cru.
  function cardTypeLabel(key) {
    const k = `cardType.${key}`;
    const r = t(k);
    return r === k ? key : r;
  }
  // Uma barra por valor, altura proporcional ao maior. Rótulo (contagem) em
  // cima, ícone/nome embaixo. `min-height` no CSS garante que o 2 de 158 ainda
  // apareça como uma linha, e não suma.
  function barsHtml(itens, { icons } = {}) {
    const max = Math.max(1, ...itens.map((i) => i.n));
    return `<div class="insight-bars" role="img" aria-label="${escapeAttribute(itens.map((i) => `${i.label}: ${i.n}`).join(", "))}">${itens.map((i) => `
      <div class="insight-bar-col" title="${escapeAttribute(`${i.label}: ${i.n}`)}">
        <span class="insight-bar-n">${i.n}</span>
        <span class="insight-bar" style="--h: ${Math.round((i.n / max) * 100)}%; --bar: ${i.color}"></span>
        <span class="insight-bar-label">${icons && i.icon ? i.icon : escapeHtml(i.label)}</span>
      </div>`).join("")}</div>`;
  }
  function renderInsights() {
    const box = elements.insights;
    if (!box || detailType !== "set" || !pageCards.length) return;
    // Raridade — só grupos presentes; some com um grupo só (não distribui nada).
    const porGrupo = new Map();
    pageCards.forEach((c) => { const g = rarityGroup(c.rarity); porGrupo.set(g, (porGrupo.get(g) || 0) + 1); });
    const cores = { common: "var(--insight-common)", rare: "var(--insight-rare)", ultra: "var(--insight-ultra)", secret: "var(--insight-secret)" };
    const raridades = RARITY_GROUPS.filter((g) => porGrupo.has(g)).map((g) => ({
      label: t(`rarity.group.${g}`), n: porGrupo.get(g), color: cores[g], icon: RARITY_GROUP_ICONS[g]
    }));
    const raridadeHtml = raridades.length > 1 ? `
      <article class="insight-card">
        <h3>${escapeHtml(t("insights.rarity"))}</h3>
        ${barsHtml(raridades, { icons: true })}
      </article>` : "";
    // Tipo de carta — cores categóricas em ordem FIXA (a 1ª cor é sempre do
    // tipo mais numeroso); mais de 6 tipos: os menores viram "Outros".
    const jogo = paginaGame();
    const porTipo = new Map();
    pageCards.forEach((c) => {
      let g = shared.cardTypeGroup(jogo, c);
      // Pokémon sem `category` no catálogo (o campo só entra em algumas
      // impressões): quem tem nº de Pokédex é carta de Pokémon.
      if (!g.key && c.dexId) g = { key: "Pokemon", label: "Pokemon" };
      if (!g.key) return;
      const atual = porTipo.get(g.key) || { n: 0, label: g.label };
      atual.n++;
      porTipo.set(g.key, atual);
    });
    let tipos = [...porTipo.entries()].map(([key, v]) => ({ key, n: v.n, label: cardTypeLabel(v.label) }))
      .sort((a, b) => b.n - a.n);
    if (tipos.length > 6) {
      const resto = tipos.slice(5).reduce((s, x) => s + x.n, 0);
      tipos = tipos.slice(0, 5).concat({ key: "other", n: resto, label: t("insights.other") });
    }
    tipos.forEach((x, i) => { x.color = `var(--insight-cat-${i + 1})`; });
    const tipoHtml = tipos.length ? `
      <article class="insight-card">
        <h3>${escapeHtml(t("insights.cardType"))}</h3>
        ${barsHtml(tipos)}
      </article>` : "";
    // Conjunto / lançamento / valor + anel de progresso.
    const lanc = pageCards[0].setReleaseDate ? formatInsightDate(pageCards[0].setReleaseDate) : t("insights.na");
    const resumoHtml = `
      <article class="insight-card insight-summary">
        <dl>
          <div><dt>${escapeHtml(t("insights.complete"))}</dt><dd data-insight-complete>—</dd></div>
          <div><dt>${escapeHtml(t("insights.release"))}</dt><dd>${escapeHtml(lanc)}</dd></div>
          <div><dt>${escapeHtml(t("insights.marketValue"))}</dt><dd data-insight-value>${escapeHtml(t("insights.na"))}</dd></div>
        </dl>
        <svg class="insight-ring" viewBox="0 0 120 120" role="img" data-insight-ring aria-label="0%">
          <circle class="insight-ring-track" cx="60" cy="60" r="50"/>
          <circle class="insight-ring-fill" cx="60" cy="60" r="50" pathLength="100" stroke-dasharray="0 100"/>
          <text x="60" y="60" text-anchor="middle" dominant-baseline="central" data-insight-pct>0%</text>
        </svg>
      </article>`;
    box.innerHTML = `<div class="set-insights-rail">${raridadeHtml}${tipoHtml}${resumoHtml}</div>`;
    box.hidden = false;
  }
  function formatInsightDate(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString(shared.getLocale(), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }
  // Parte VIVA do 3º cartão: conjunto (N de T) e o anel. A contagem é a mesma
  // dos stats (respeita master set / qualquer idioma), então vem de lá.
  function updateInsightsProgress(ownedN, totalN, pct) {
    const box = elements.insights;
    if (!box || box.hidden) return;
    const comp = box.querySelector("[data-insight-complete]");
    if (comp) comp.textContent = t("insights.completeValue", { n: ownedN, t: totalN });
    const fill = box.querySelector(".insight-ring-fill");
    if (fill) fill.setAttribute("stroke-dasharray", `${Math.max(0, Math.min(100, pct))} 100`);
    const ring = box.querySelector("[data-insight-ring]");
    if (ring) {
      ring.setAttribute("aria-label", `${pct}%`);
      ring.classList.toggle("complete", totalN > 0 && ownedN >= totalN);
    }
    const txt = box.querySelector("[data-insight-pct]");
    if (txt) txt.textContent = `${pct}%`;
  }
  function updateInsightsValue(total) {
    const box = elements.insights;
    if (!box || box.hidden) return;
    const el = box.querySelector("[data-insight-value]");
    if (el) el.textContent = total > 0 ? shared.formatMoney(shared.getCurrency(), total) : t("insights.na");
  }

  // Atualiza tiles e contadores no DOM existente, sem reconstruir a grade
  // (reconstruir faria todas as imagens piscarem).
  function refreshOwnership() {
    elements.grid.querySelectorAll(".card-tile").forEach((tile) => shared.refreshTileOwnership(tile, owned, wishlist, { addMode: true }));
    updateHeaderStats();
  }

  function updateHeaderStats() {
    const useModes = detailType === "set" && (masterMode || anyLangMode);
    let ownedN, totalN;
    if (!useModes) {
      ownedN = pageCards.filter((card) => owned.has(card.id)).length;
      totalN = pageCards.length;
    } else {
      // "Qualquer idioma": donos por id BASE (EN/PT do mesmo slot contam juntas).
      const baseIdx = anyLangMode ? ownedBaseIndex() : null;
      const idsOf = (card) => {
        if (!anyLangMode) return [card.id];
        return baseIdx.get(shared.basePricingId(card.id)) || [];
      };
      const cardOwned = (card) => (anyLangMode ? idsOf(card).length > 0 : owned.has(card.id));
      if (!masterMode) {
        ownedN = pageCards.filter(cardOwned).length;
        totalN = pageCards.length;
      } else {
        // Master set: cada variante é um slot; possuída se qualquer id (da
        // língua certa ou de qualquer uma, conforme o modo) tem a variante.
        ownedN = 0; totalN = 0;
        pageCards.forEach((card) => {
          const variants = (card.variants && card.variants.length) ? card.variants : [shared.defaultVariant(card)];
          totalN += variants.length;
          const ids = anyLangMode ? idsOf(card) : [card.id];
          variants.forEach((v) => {
            if (ids.some((id) => owned.variantTotal(id, v) > 0)) ownedN++;
          });
        });
      }
    }
    const pct = totalN ? Math.round((ownedN / totalN) * 100) : 0;
    updateInsightsProgress(ownedN, totalN, pct);
    elements.ownedCount.textContent = ownedN;
    elements.totalCount.textContent = totalN;
    elements.completionRate.textContent = `${pct}%`;
    // Rótulos acompanham o modo (variantes ≠ cartas).
    const ownedLabel = elements.ownedCount.nextElementSibling;
    const totalLabel = elements.totalCount.nextElementSibling;
    if (ownedLabel) ownedLabel.textContent = t(masterMode && detailType === "set" ? "master.slotsOwned" : "stats.owned");
    if (totalLabel) totalLabel.textContent = t(masterMode && detailType === "set" ? "master.slotsTotal" : "stats.pageTotal");
    if (elements.completionFill) elements.completionFill.style.width = `${pct}%`;
    if (elements.completionBar) {
      elements.completionBar.setAttribute("aria-valuenow", String(pct));
      // A 0% a barra é uma cápsula vazia sem rótulo nenhum entre duas seções —
      // parecia enfeite quebrado (o Fernando perguntou o que era). Sem nada
      // marcado ela não informa, então some; volta no primeiro registro.
      elements.completionBar.hidden = pct <= 0;
      // Set fechado: a barra fica DOURADA (o mesmo ouro da Pokédex e dos
      // cards de set 100%) — completo por contagem exata, não pelo arredondado.
      elements.completionBar.classList.toggle("complete", totalN > 0 && ownedN >= totalN);
    }
    // Página de SET do catálogo: celebra a TRANSIÇÃO pra 100% (nunca a
    // página que já abre completa — pctAnterior null cobre o primeiro render).
    if (detailType === "set" && !collectionScope && totalN > 0) {
      const completo = ownedN >= totalN;
      if (estavaCompleto === false && completo) celebraSetCompleto();
      estavaCompleto = completo;
    }
    updateValueStats();
  }

  // Três números com naturezas DIFERENTES — e é isso que explica por que eles
  // não somam mais um no outro:
  //   Valor total  = quanto vale o set COMPLETO (uma de cada, variante padrão);
  //   Falta        = quanto vale o que ainda não tenho (uma de cada);
  //   Já gasto     = quanto valem AS MINHAS cartas de verdade.
  //
  // O "já gasto" contava 1 por carta, na variante padrão: 10 cópias de R$ 10
  // apareciam como R$ 10. Agora usa a mesma conta da Coleção (ownedMarketValue):
  // percorre variante × condição × QUANTIDADE, então duplicata soma e a foil
  // vale o que a foil vale.
  //
  // "Falta" passa a ser calculado das cartas que faltam, e não como
  // total − já gasto: com duplicatas o "já gasto" pode passar do valor do set
  // inteiro, e a subtração daria zero (ou negativo) num set longe de completo.
  function updateValueStats() {
    if (!elements.detailValues) return;
    let total = 0;
    let toBuy = 0;
    let ownedValue = 0;
    pageCards.forEach((card) => {
      const ref = shared.cardValue(card, shared.defaultVariant(card), prices).value || 0;
      total += ref;
      // Posse pelo id exato, como antes. O modo "qualquer idioma" não entra
      // aqui de propósito: a quantidade vive por id, então a cópia em outra
      // língua está sob outro id — misturar daria um "já gasto" que não bate
      // com o que a Coleção mostra.
      if (!owned.has(card.id)) { toBuy += ref; return; }
      shared.cardVariants(card).forEach((variant) => {
        owned.conditionBreakdown(card.id, variant).forEach(({ condition, quantity }) => {
          const v = shared.cardValue(card, variant, prices, condition).value;
          if (v) ownedValue += v * quantity;
        });
      });
    });
    updateInsightsValue(total);
    if (total <= 0) { elements.detailValues.hidden = true; return; }
    const cur = shared.getCurrency();
    elements.detailValues.hidden = false;
    elements.valueTotal.textContent = shared.formatMoney(cur, total);
    elements.valueOwned.textContent = shared.formatMoney(cur, ownedValue);
    elements.valueToBuy.textContent = shared.formatMoney(cur, toBuy);
  }

  function filterCards() {
    const languageValue = selectedLanguage;
    const ownedValue = selectedOwned;

    return pageCards.filter((card) => {
      const matchesQuery = shared.matchesCardQuery(card, elements.search.value);
      const matchesLanguage = !languageValue || shared.normalizeCardLanguage(card.language) === languageValue;
      const isOwned = owned.has(card.id);
      const matchesOwned = ownedValue === "all"
        || (ownedValue === "owned" && isOwned)
        || (ownedValue === "missing" && !isOwned)
        || (ownedValue === "wanted" && wishlist.hasCard(card.id));
      const matchesRarity = !selectedRarity || (rarityListOrder
        ? String(card.rarity || "") === selectedRarity
        : rarityBucket(card) === selectedRarity);
      // Facetas do jogo: OU dentro de cada uma, E entre elas.
      const matchesFacets = facetDefs.every((f) => {
        const sel = facetSel[f.key];
        if (!sel.size) return true;
        return f.of(card).some((v) => sel.has(v));
      });

      return matchesQuery && matchesLanguage && matchesOwned && matchesRarity && matchesFacets;
    });
  }


  function typeLabel(type) {
    const key = `detail.label.${type}`;
    const translated = t(key);
    return translated === key ? t("detail.label") : translated;
  }
})();
