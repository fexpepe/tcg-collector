(function () {
  function createIdStore(storageKey) {
    let ids = load();

    function load() {
      try {
        return new Set(JSON.parse(localStorage.getItem(storageKey) || "[]"));
      } catch (error) {
        return new Set();
      }
    }

    function save() {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(ids)));
    }

    return {
      has(id) {
        return ids.has(id);
      },
      get size() {
        return ids.size;
      },
      toggle(id) {
        if (ids.has(id)) {
          ids.delete(id);
        } else {
          ids.add(id);
        }
        save();
      },
      replace(newIds) {
        ids = new Set(newIds);
        save();
      },
      toArray() {
        return Array.from(ids);
      }
    };
  }

  function defaultVariant(card) {
    return (card && card.variants && card.variants[0]) || "Normal";
  }

  // Coleção v2: cardId -> { variante: quantidade }. O formato v1 (lista de ids)
  // é migrado uma única vez via migrateLegacy, depois que o catálogo carrega.
  function createCollectionStore() {
    const storageKey = "tcg-collector-collection-v2";
    const legacyKey = "tcg-collector-owned-v1";
    let collection = load();
    let initialized = collection !== null;
    if (!initialized) collection = {};

    function load() {
      try {
        const parsed = JSON.parse(localStorage.getItem(storageKey) || "null");
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
      } catch (error) {
        return null;
      }
    }

    function save() {
      localStorage.setItem(storageKey, JSON.stringify(collection));
      initialized = true;
    }

    function totalForCard(cardId) {
      const entry = collection[cardId];
      if (!entry) return 0;
      return Object.values(entry).reduce((sum, qty) => sum + qty, 0);
    }

    return {
      migrateLegacy(getDefaultVariant) {
        if (initialized) return;
        let legacyIds = [];
        try {
          legacyIds = JSON.parse(localStorage.getItem(legacyKey) || "[]");
        } catch (error) {
          legacyIds = [];
        }
        if (Array.isArray(legacyIds)) {
          legacyIds.forEach((cardId) => {
            collection[cardId] = { [getDefaultVariant(cardId)]: 1 };
          });
        }
        save();
      },
      has(cardId) {
        return totalForCard(cardId) > 0;
      },
      get size() {
        return Object.keys(collection).filter((cardId) => totalForCard(cardId) > 0).length;
      },
      getQuantity(cardId, variant) {
        return (collection[cardId] && collection[cardId][variant]) || 0;
      },
      totalForCard,
      add(cardId, variant, delta) {
        const entry = collection[cardId] || {};
        const quantity = Math.max(0, (entry[variant] || 0) + delta);
        if (quantity > 0) {
          entry[variant] = quantity;
          collection[cardId] = entry;
        } else {
          delete entry[variant];
          if (Object.keys(entry).length === 0) {
            delete collection[cardId];
          } else {
            collection[cardId] = entry;
          }
        }
        save();
      },
      toggle(card) {
        if (this.has(card.id)) {
          delete collection[card.id];
        } else {
          collection[card.id] = { [defaultVariant(card)]: 1 };
        }
        save();
      },
      replace(newCollection) {
        collection = newCollection;
        save();
      },
      toObject() {
        return collection;
      }
    };
  }

  function createFavoritesStore() {
    return createIdStore("tcg-collector-favorites-v1");
  }

  // Busca tipos e formas de um Pokémon na PokéAPI (por dexId), com cache em localStorage.
  // Degrada silenciosamente se a rede falhar — chamador deve tratar { types: [], forms: [] }.
  async function fetchPokemonMeta(dexId) {
    const empty = { types: [], forms: [] };
    if (!dexId) return empty;

    const cacheKey = `tcg-pokeapi-meta-${dexId}`;
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (cached) return cached;
    } catch (error) {
      // cache inválido: segue para buscar
    }

    try {
      const [pokemon, species] = await Promise.all([
        fetch(`https://pokeapi.co/api/v2/pokemon/${dexId}`).then((response) => (response.ok ? response.json() : null)),
        fetch(`https://pokeapi.co/api/v2/pokemon-species/${dexId}`).then((response) => (response.ok ? response.json() : null))
      ]);

      const meta = {
        types: pokemon ? pokemon.types.map((entry) => entry.type.name) : [],
        forms: species ? species.varieties.filter((variety) => !variety.is_default).map((variety) => variety.pokemon.name) : []
      };

      try {
        localStorage.setItem(cacheKey, JSON.stringify(meta));
      } catch (error) {
        // localStorage cheio: ok, só não cacheia
      }
      return meta;
    } catch (error) {
      return empty;
    }
  }

  function createCardPreview({ getCard, store, onOwnedChange }) {
    let activeCard = null;

    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        close();
      }
    });

    function open(cardId) {
      activeCard = getCard(cardId);
      if (!activeCard) return;

      let modal = document.getElementById("cardPreviewModal");
      if (!modal) {
        modal = document.createElement("div");
        modal.id = "cardPreviewModal";
        modal.className = "card-preview-modal";
        document.body.appendChild(modal);
      }

      const isOwned = store.has(activeCard.id);

      modal.innerHTML = `
        <div class="card-preview-backdrop" data-preview-close></div>
        <section class="card-preview-panel" role="dialog" aria-modal="true" aria-label="${escapeAttribute(activeCard.name)}">
          <button class="preview-close" data-preview-close aria-label="Fechar">×</button>
          <div class="preview-image-wrap">
            <img src="${escapeAttribute(activeCard.image)}" alt="${escapeAttribute(activeCard.name)}">
          </div>
          <div class="preview-content">
            <div>
              <p class="eyebrow">${escapeHtml(activeCard.set)}</p>
              <h2>${escapeHtml(activeCard.name)}</h2>
              <p class="preview-subtitle">${escapeHtml(activeCard.number)} · ${escapeHtml(activeCard.language.toUpperCase())}</p>
            </div>
            <div class="preview-details">
              <h3>Card Details</h3>
              <dl>
                <div><dt>Rarity</dt><dd>${escapeHtml(activeCard.rarity || "-")}</dd></div>
                <div><dt>Artist</dt><dd>${escapeHtml(activeCard.artist || "Artista desconhecido")}</dd></div>
                <div><dt>Set</dt><dd>${escapeHtml(activeCard.set || "-")}</dd></div>
                <div><dt>Card ID</dt><dd>${escapeHtml(activeCard.id)}</dd></div>
              </dl>
            </div>
            <div class="variant-quantities">${variantQuantityRows(activeCard, store)}</div>
            <button class="owned-toggle preview-owned" data-card-id="${escapeAttribute(activeCard.id)}" aria-pressed="${isOwned}">
              ${isOwned ? "Tenho na coleção" : "Marcar como tenho"}
            </button>
          </div>
        </section>
      `;

      document.body.classList.add("preview-open");
    }

    function close() {
      const modal = document.getElementById("cardPreviewModal");
      if (modal) modal.remove();
      activeCard = null;
      document.body.classList.remove("preview-open");
    }

    function handleClick(event) {
      if (event.target.closest("[data-preview-close]")) {
        close();
        return;
      }

      if (event.target.closest("#cardPreviewModal") && handleQuantityClick(event, store)) {
        onOwnedChange();
        if (activeCard) open(activeCard.id);
        return;
      }

      const modalToggle = event.target.closest("#cardPreviewModal [data-card-id]");
      if (modalToggle) {
        store.toggle(getCard(modalToggle.dataset.cardId) || { id: modalToggle.dataset.cardId });
        onOwnedChange();
        if (activeCard) open(activeCard.id);
      }
    }

    return { open, close };
  }

  // Linhas de quantidade por variante (stepper − qtd +) para uma carta.
  function variantQuantityRows(card, store) {
    const variants = card.variants && card.variants.length ? card.variants : [defaultVariant(card)];
    return variants.map((variant) => {
      const quantity = store.getQuantity(card.id, variant);
      return `
        <div class="variant-row${quantity > 0 ? " owned" : ""}">
          <span class="variant-row-name">${escapeHtml(variant)}</span>
          <div class="qty-stepper" aria-label="Quantidade de ${escapeAttribute(variant)}">
            <button type="button" data-qty-action="dec" data-qty-card-id="${escapeAttribute(card.id)}" data-qty-variant="${escapeAttribute(variant)}" aria-label="Remover uma ${escapeAttribute(variant)}" ${quantity === 0 ? "disabled" : ""}>−</button>
            <span class="qty-value">${quantity}</span>
            <button type="button" data-qty-action="inc" data-qty-card-id="${escapeAttribute(card.id)}" data-qty-variant="${escapeAttribute(variant)}" aria-label="Adicionar uma ${escapeAttribute(variant)}">+</button>
          </div>
        </div>
      `;
    }).join("");
  }

  // Trata cliques nos steppers de variante. Retorna true se o evento foi consumido.
  function handleQuantityClick(event, store) {
    const button = event.target.closest("[data-qty-action]");
    if (!button || button.disabled) return false;
    const delta = button.dataset.qtyAction === "inc" ? 1 : -1;
    store.add(button.dataset.qtyCardId, button.dataset.qtyVariant, delta);
    return true;
  }

  function bindCollectionTransfer({ exportButton, importInput, store, cards, onChange }) {
    const cardsById = new Map(cards.map((card) => [card.id, card]));

    exportButton.addEventListener("click", () => {
      const payload = {
        version: 2,
        exportedAt: new Date().toISOString(),
        collection: store.toObject()
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "tcg-collection.json";
      link.click();
      URL.revokeObjectURL(url);
    });

    importInput.addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;

      try {
        const payload = JSON.parse(await file.text());
        store.replace(parseImportedCollection(payload, cardsById));
        onChange();
      } catch (error) {
        alert("Não foi possível importar esse arquivo de coleção.");
      } finally {
        event.target.value = "";
      }
    });
  }

  function parseImportedCollection(payload, cardsById) {
    // Formato v1: lista de ids -> 1ª variante com quantidade 1.
    if (Array.isArray(payload.ownedCardIds)) {
      const collection = {};
      payload.ownedCardIds.forEach((cardId) => {
        if (cardsById.has(cardId)) {
          collection[cardId] = { [defaultVariant(cardsById.get(cardId))]: 1 };
        }
      });
      return collection;
    }

    if (!payload.collection || typeof payload.collection !== "object" || Array.isArray(payload.collection)) {
      throw new Error("Arquivo sem collection ou ownedCardIds.");
    }

    const collection = {};
    Object.entries(payload.collection).forEach(([cardId, variants]) => {
      if (!cardsById.has(cardId) || !variants || typeof variants !== "object") return;
      const entry = {};
      Object.entries(variants).forEach(([variant, quantity]) => {
        const parsed = Math.floor(Number(quantity));
        if (parsed > 0) entry[variant] = parsed;
      });
      if (Object.keys(entry).length) collection[cardId] = entry;
    });
    return collection;
  }

  async function loadCatalog() {
    if (Array.isArray(window.TCG_CARDS) && window.TCG_CARDS.length) {
      return { cards: window.TCG_CARDS, indexes: window.TCG_INDEXES || null, manifest: window.TCG_MANIFEST || null };
    }

    const manifest = window.TCG_MANIFEST;
    if (manifest && Array.isArray(manifest.sets)) {
      const cards = await fetchSetChunks(manifest.sets);
      return { cards, indexes: window.TCG_INDEXES || null, manifest };
    }

    return { cards: [], indexes: null, manifest: null };
  }

  async function fetchSetChunks(entries) {
    const chunks = await Promise.all(entries.map(async (entry) => {
      const response = await fetch(entry.file);
      if (!response.ok) {
        throw new Error(`Falha ao carregar ${entry.file}: ${response.status}`);
      }
      return response.json();
    }));
    return chunks.flat();
  }

  function setIdForCard(cardId, setIds) {
    let match = "";
    setIds.forEach((setId) => {
      if (cardId.startsWith(`${setId}-`) && setId.length > match.length) {
        match = setId;
      }
    });
    return match || cardId.slice(0, cardId.lastIndexOf("-"));
  }

  function createPager({ grid, pageSize = 60 }) {
    let items = [];
    let renderItem = null;
    let renderedCount = 0;

    const sentinel = document.createElement("div");
    sentinel.className = "grid-sentinel";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary load-more";
    button.addEventListener("click", renderMore);

    const observer = "IntersectionObserver" in window
      ? new IntersectionObserver((observedEntries) => {
          if (observedEntries.some((observed) => observed.isIntersecting)) {
            renderMore();
          }
        }, { rootMargin: "400px" })
      : null;

    function render(newItems, newRenderItem, { resetCount = false } = {}) {
      const target = resetCount ? pageSize : Math.max(pageSize, renderedCount);
      items = newItems;
      renderItem = newRenderItem;
      renderedCount = 0;
      grid.innerHTML = "";
      appendUpTo(Math.min(target, items.length));
    }

    function renderMore() {
      appendUpTo(Math.min(renderedCount + pageSize, items.length));
    }

    function appendUpTo(target) {
      const fragment = document.createDocumentFragment();
      for (; renderedCount < target; renderedCount++) {
        fragment.appendChild(renderItem(items[renderedCount]));
      }
      grid.appendChild(fragment);
      updateControls();
    }

    function updateControls() {
      if (observer) observer.disconnect();
      sentinel.remove();
      button.remove();

      const remaining = items.length - renderedCount;
      if (remaining <= 0) return;

      button.textContent = `Mostrar mais (${remaining} restante${remaining === 1 ? "" : "s"})`;
      grid.after(sentinel, button);
      if (observer) observer.observe(sentinel);
    }

    return { render };
  }

  function debounce(fn, wait) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function addOptions(select, values, formatLabel) {
    if (!select) return;
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = formatLabel ? formatLabel(value) : value;
      select.appendChild(option);
    });
  }

  function detailUrl(type, name) {
    const params = new URLSearchParams({ type, name });
    return `detail.html?${params.toString()}`;
  }

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  function speciesName(name) {
    return String(name || "")
      .replace(/\b(VMAX|VSTAR|ex|EX|GX|V-UNION|V)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  window.TCGShared = {
    createCollectionStore,
    createFavoritesStore,
    defaultVariant,
    variantQuantityRows,
    handleQuantityClick,
    fetchPokemonMeta,
    createCardPreview,
    bindCollectionTransfer,
    loadCatalog,
    fetchSetChunks,
    setIdForCard,
    createPager,
    debounce,
    addOptions,
    detailUrl,
    unique,
    normalize,
    escapeHtml,
    escapeAttribute,
    speciesName
  };
})();
