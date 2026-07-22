(function () {
  const shared = window.TCGShared;
  const { addOptions, unique, normalize, escapeHtml, escapeAttribute, speciesName, debounce, t, tn, localizedImg, toRoman } = shared;

  let cards = [];
  let cardsById = new Map();
  let pageCards = [];
  const owned = shared.createCollectionStore();
  const favorites = shared.createFavoritesStore();
  const wishlist = shared.createWishlistStore();
  const prices = shared.createPriceStore();

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
  const detailName = params.get("name") || "";
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
    sortSelect: document.getElementById("sortSelect"),
    ownedCount: document.getElementById("ownedCount"),
    totalCount: document.getElementById("totalCount"),
    completionRate: document.getElementById("completionRate"),
    completionFill: document.getElementById("completionFill"),
    completionBar: document.getElementById("completionBar"),
    quickAdd: document.getElementById("quickAdd"),
    quickAddInput: document.getElementById("quickAddInput"),
    quickAddLog: document.getElementById("quickAddLog"),
    detailValues: document.getElementById("detailValues"),
    valueTotal: document.getElementById("valueTotal"),
    valueOwned: document.getElementById("valueOwned"),
    valueToBuy: document.getElementById("valueToBuy"),
    resultCount: document.getElementById("resultCount"),
    progressModes: document.getElementById("progressModes"),
    modeMaster: document.getElementById("modeMaster"),
    modeAnyLang: document.getElementById("modeAnyLang")
  };

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

  const pager = shared.createPager({ grid: elements.grid, pageSize: 60 });
  let selectedLanguage = "";
  let selectedOwned = "all";
  let selectedSort = "value-desc";
  let gridView = localStorage.getItem("tcg-detail-view") === "list" ? "list" : "grid";
  let selectedRarity = ""; // "" = todas; senão "base" | "special"

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

  Promise.all([resolveCards(), shared.loadFxRates()])
    .then(([resolvedCards]) => {
      cards = resolvedCards;
      cardsById = new Map(cards.map((card) => [card.id, card]));
      owned.migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId)));
      pageCards = getPageCards();
      init();
    })
    .catch((error) => {
      elements.empty.textContent = t("error.cards", { message: error.message });
      elements.empty.hidden = false;
    });

  function init() {
    elements.type.textContent = collectionScope
      ? `${t("detail.scopeCollection")} · ${typeLabel(detailType)}`
      : typeLabel(detailType);
    elements.title.textContent = detailName || t("detail.label");
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
    }
    initBackLink();
    hydrateFilters();
    if (elements.sortSelect) elements.sortSelect.value = selectedSort; // padrão: maior preço
    bindEvents();
    initQuickAdd();
    initProgressModes();
    applyGridView();
    render();
  }

  // ---------------------------------------------------------------------------
  // Adição rápida por número (modo checklist, estilo TCGCollector): digite o
  // número da carta e Enter — cada entrada adiciona 1 cópia (variante padrão,
  // NM). Aceita lista colada ("4, 7, 23, TG05"). Só em páginas de SET (o número
  // é único dentro do set). Cada chip de feedback desfaz a adição ao ser tocado.
  // ---------------------------------------------------------------------------
  function initQuickAdd() {
    const box = elements.quickAdd, input = elements.quickAddInput, log = elements.quickAddLog;
    if (!box || !input || !log) return;
    if (detailType !== "set" || !pageCards.length) { box.hidden = true; return; }
    box.hidden = false;
    input.placeholder = t("quickadd.placeholder");
    // "4/102" -> "4", "TG05/TG30" -> "tg5", "015a" -> "15a": prefixo/sufixo
    // alfabético preservados, zeros à esquerda fora (mesma norma do build).
    const norm = (s) => {
      const p = String(s || "").split("/")[0].trim().toLowerCase();
      const m = p.match(/^([a-z]*)0*(\d+)([a-z]*)$/);
      return m ? m[1] + m[2] + m[3] : p;
    };
    const byNum = new Map();
    pageCards.forEach((card) => { const k = norm(card.number); if (k && !byNum.has(k)) byNum.set(k, card); });

    const MAX_CHIPS = 8;
    function chip(html, cls, data) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `quick-add-chip ${cls || ""}`;
      el.innerHTML = html;
      if (data) { el.dataset.cardId = data.cardId; el.dataset.variant = data.variant; el.title = t("quickadd.undo"); }
      else { el.disabled = true; }
      log.prepend(el);
      while (log.children.length > MAX_CHIPS) log.lastElementChild.remove();
    }
    function addOne(token) {
      const card = byNum.get(norm(token));
      if (!card) { chip(`✗ ${escapeHtml(token)}`, "is-miss"); return; }
      const variant = shared.defaultVariant(card);
      owned.add(card.id, variant, shared.DEFAULT_CONDITION, 1);
      const qty = owned.variantTotal(card.id, variant);
      chip(`✓ ${escapeHtml(String(card.number).split("/")[0])} ${escapeHtml(card.name)}${qty > 1 ? ` ×${qty}` : ""}`, "is-hit", { cardId: card.id, variant });
    }
    function commit() {
      const tokens = String(input.value).split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
      if (!tokens.length) return;
      tokens.forEach(addOne);
      input.value = "";
      refreshOwnership();
      input.focus();
    }
    input.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); commit(); } });
    // Colar uma lista: processa na hora (o change/Enter não dispara em paste).
    input.addEventListener("paste", () => setTimeout(commit, 0));
    // Tocar num chip ✓ desfaz aquela adição (remove 1 cópia).
    log.addEventListener("click", (event) => {
      const c = event.target.closest(".quick-add-chip.is-hit");
      if (!c || !c.dataset.cardId) return;
      owned.add(c.dataset.cardId, c.dataset.variant, shared.DEFAULT_CONDITION, -1);
      c.classList.add("is-undone");
      c.disabled = true;
      refreshOwnership();
      input.focus();
    });
  }

  // "Voltar" no cabeçalho aponta para a listagem de origem (ou Coleção no modo
  // coleção): Pokédex / Sets / Artistas / Treinadores.
  function initBackLink() {
    const back = document.getElementById("detailBack");
    if (!back) return;
    if (collectionScope) { back.href = "collection.html"; return; }
    const map = { pokemon: "pokedex.html", set: "sets.html", artist: "artists.html", trainer: "trainers.html" };
    back.href = map[detailType] || "pokedex.html";
  }

  // Alterna a grade entre grade (cards) e lista (linhas), guardando a preferência.
  function applyGridView() {
    if (elements.grid) elements.grid.classList.toggle("is-list", gridView === "list");
    if (elements.viewToggle) {
      elements.viewToggle.querySelectorAll("[data-grid-view]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.gridView === gridView));
      });
    }
  }

  // No modo manifest, baixa apenas os chunks de set necessários para esta página.
  async function resolveCards() {
    await shared.awaitCatalog();
    if (Array.isArray(window.TCG_CARDS) && window.TCG_CARDS.length) {
      return window.TCG_CARDS;
    }

    const manifest = window.TCG_MANIFEST;
    if (!manifest || !Array.isArray(manifest.sets)) {
      return [];
    }

    if (detailType === "set") {
      const entries = manifest.sets.filter((set) => set.name === detailName);
      return entries.length ? shared.fetchSetChunks(entries) : [];
    }

    const indexes = window.TCG_INDEXES;
    const groups = detailType === "artist" ? indexes?.artists
      : detailType === "trainer" ? indexes?.trainers
      : indexes?.pokedex;
    const group = (groups || []).find((candidate) => candidate.name === detailName);
    if (!group) {
      return shared.fetchSetChunks(manifest.sets);
    }

    const setIds = manifest.sets.map((set) => set.id);
    const neededSetIds = new Set(group.cardIds.map((cardId) => shared.setIdForCard(cardId, setIds)));
    return shared.fetchSetChunks(manifest.sets.filter((set) => neededSetIds.has(set.id)));
  }

  function getPageCards() {
    if (detailType === "set") {
      return cards.filter((card) => card.set === detailName);
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
      elements.hero.classList.remove("has-featured");
      const logo = sample.setLogo
        ? localizedImg(sample.setLogo, { alt: sample.set, className: "set-logo" })
        : `<strong>${escapeHtml(sample.set)}</strong>`;
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
      elements.hero.innerHTML = `
        <div class="set-art detail-set-art">${logo}${symbol}</div>
        <div>
          <h2>${escapeHtml(sample.set)}</h2>
          <p>${escapeHtml(`${t("set.officialCards", { n: sample.setTotal || pageCards.length })} · ${t("set.inLocalCatalog", { n: pageCards.length })}`)}</p>
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

  // "Em destaque": as cartas MAIS VALIOSAS deste Pokémon (proxy de popularidade —
  // não rastreamos visualizações). Fileira à direita do hero, clicável (preview).
  function pokemonFeaturedHtml() {
    const ranked = pageCards
      .map((card) => ({ card, variant: shared.defaultVariant(card), val: shared.cardValue(card, shared.defaultVariant(card), prices, shared.DEFAULT_CONDITION).value || 0 }))
      .filter((x) => x.val > 0)
      .sort((a, b) => b.val - a.val)
      .slice(0, 4);
    if (ranked.length < 2) return ""; // pouca cotação: não vale a seção
    const cur = shared.getCurrency();
    const cards = ranked.map(({ card, variant, val }) => {
      const src = shared.cardImageSources(card);
      const img = shared.localizedImg(src.url, { alt: card.name, fallback: src.fallback, loading: "lazy", thumb: true });
      return `<button type="button" class="pkmn-feat-card" data-preview-card-id="${escapeAttribute(card.id)}" data-preview-variant="${escapeAttribute(variant)}" title="${escapeAttribute(card.name + " · " + card.set)}">
        <span class="pkmn-feat-img">${img}</span>
        <span class="pkmn-feat-price">${escapeHtml(shared.formatMoney(cur, val))}</span>
      </button>`;
    }).join("");
    return `<div class="pokemon-hero-featured">
      <h3 class="pokemon-hero-featured-title">${escapeHtml(t("hero.featured"))}</h3>
      <div class="pokemon-hero-featured-row">${cards}</div>
    </div>`;
  }

  function renderPokemonHero(sample) {
    const dexId = sample.dexId || "";
    const region = REGION_BY_GENERATION[Number(sample.generation)] || "";
    const generationLabel = sample.generation ? t("card.generation", { g: toRoman(sample.generation) }) : "";
    const isFavorite = favorites.has(String(dexId));
    const pokemonImage = sample.pokemonImage
      ? `<img class="pokemon-hero-image" src="${escapeAttribute(sample.pokemonImage)}" alt="${escapeAttribute(detailName)}">`
      : "";

    const featuredHtml = pokemonFeaturedHtml();
    elements.hero.classList.toggle("has-featured", !!featuredHtml);
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
          <button class="favorite-button" data-favorite-toggle aria-pressed="${isFavorite}">${favoriteLabel(isFavorite)}</button>
          <button class="forms-toggle" data-forms-toggle aria-expanded="false" hidden></button>
        </div>
        <div class="forms-list" data-forms-list hidden></div>
        <p class="pokemon-hero-count">${escapeHtml(tn("hero.cardsInCatalog", pageCards.length))}</p>
      </div>
      ${featuredHtml}
    `;
    elements.hero.hidden = false;

    bindHeroActions(dexId);
    fillPokemonMeta(dexId);
  }

  function bindHeroActions(dexId) {
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
    addOptions(elements.languageFilter, unique(pageCards.map((card) => shared.normalizeCardLanguage(card.language))), (value) => shared.cardLanguageLabel(value));
    // Idioma de carta preferido vira o filtro padrão (se houver cartas dele aqui).
    const pref = shared.getCardLang();
    if (pref !== "all" && Array.from(elements.languageFilter.options).some((option) => option.value === pref)) {
      elements.languageFilter.value = pref;
    }
    selectedLanguage = elements.languageFilter.value;

    renderSegmented(elements.ownedChips, [
      { value: "all", label: t("filter.all.f") },
      { value: "owned", label: t("filter.owned") },
      { value: "missing", label: t("filter.missing") },
      { value: "wanted", label: t("filter.wanted") }
    ], selectedOwned);

    renderRarityFilter();
  }

  // Raridade como lista suspensa (Todas / Comuns e raras / Especiais). Mostra só
  // os grupos presentes nesta página e esconde o filtro se houver menos de 2.
  function renderRarityFilter() {
    if (!elements.rarityFilter || !elements.rarityField) return;
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
    bindSegmented(elements.ownedChips, (value) => { selectedOwned = value; });

    if (elements.viewToggle) {
      elements.viewToggle.addEventListener("click", (event) => {
        const button = event.target.closest("[data-grid-view]");
        if (!button) return;
        gridView = button.dataset.gridView === "list" ? "list" : "grid";
        localStorage.setItem("tcg-detail-view", gridView);
        applyGridView();
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

    // Cartas em destaque (no hero) abrem o mesmo preview.
    if (elements.hero) elements.hero.addEventListener("click", (event) => {
      const feat = event.target.closest(".pkmn-feat-card[data-preview-card-id]");
      if (feat) preview.open(feat.dataset.previewCardId, feat.dataset.previewVariant);
    });

    elements.grid.addEventListener("click", (event) => {
      const imageButton = event.target.closest("[data-preview-card-id]");
      if (imageButton) {
        preview.open(imageButton.dataset.previewCardId, imageButton.dataset.previewVariant);
        return;
      }

      if (shared.handleWantTileClick(event, wishlist)) {
        refreshOwnership();
        return;
      }

      // Quick-add: cada clique no "+" soma +1 e pisca "✓ Adicionada!" por 2s
      // (igual ao Explorar). Remover é no preview da carta.
      const addButton = shared.handleAddTileClick(event, owned, wishlist);
      if (addButton) {
        refreshOwnership();
        shared.flashTileAdded(addButton, owned);
      }
    });
  }

  function render({ resetCount = false } = {}) {
    const visibleCards = filterCards();
    const tiles = sortTiles(shared.cardVariantPairs(visibleCards));
    // Cartas sem imagem vão para o fim (sort estável preserva a ordem da ordenação escolhida).
    tiles.sort((a, b) => Number(shared.cardHasImage(b.card)) - Number(shared.cardHasImage(a.card)));
    pager.render(tiles, ({ card, variant }) => shared.variantTile(card, variant, owned, wishlist, prices, { addMode: true }), { resetCount });

    elements.empty.hidden = tiles.length > 0;
    elements.resultCount.textContent = tn("results.count", tiles.length);
    updateHeaderStats();
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
    elements.ownedCount.textContent = ownedN;
    elements.totalCount.textContent = totalN;
    elements.completionRate.textContent = `${pct}%`;
    // Rótulos acompanham o modo (variantes ≠ cartas).
    const ownedLabel = elements.ownedCount.nextElementSibling;
    const totalLabel = elements.totalCount.nextElementSibling;
    if (ownedLabel) ownedLabel.textContent = t(masterMode && detailType === "set" ? "master.slotsOwned" : "stats.owned");
    if (totalLabel) totalLabel.textContent = t(masterMode && detailType === "set" ? "master.slotsTotal" : "stats.pageTotal");
    if (elements.completionFill) elements.completionFill.style.width = `${pct}%`;
    if (elements.completionBar) elements.completionBar.setAttribute("aria-valuenow", String(pct));
    updateValueStats();
  }

  // Valor total da página (set/artista/pokémon), o já gasto (cartas que tenho) e
  // o que falta (a comprar). Um valor representativo por carta (variante padrão).
  function updateValueStats() {
    if (!elements.detailValues) return;
    let total = 0;
    let ownedValue = 0;
    pageCards.forEach((card) => {
      const v = shared.cardValue(card, shared.defaultVariant(card), prices).value;
      if (!v) return;
      total += v;
      if (owned.has(card.id)) ownedValue += v;
    });
    if (total <= 0) { elements.detailValues.hidden = true; return; }
    const cur = shared.getCurrency();
    elements.detailValues.hidden = false;
    elements.valueTotal.textContent = shared.formatMoney(cur, total);
    elements.valueOwned.textContent = shared.formatMoney(cur, ownedValue);
    elements.valueToBuy.textContent = shared.formatMoney(cur, Math.max(0, total - ownedValue));
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
      const matchesRarity = !selectedRarity || rarityBucket(card) === selectedRarity;

      return matchesQuery && matchesLanguage && matchesOwned && matchesRarity;
    });
  }


  function typeLabel(type) {
    const key = `detail.label.${type}`;
    const translated = t(key);
    return translated === key ? t("detail.label") : translated;
  }
})();
