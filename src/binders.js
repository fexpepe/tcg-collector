// Binders: fichários visuais de cartas, em duas categorias (páginas separadas):
//  - Coleção: mostrar as cartas que você tem, no estilo 2×2/3×3/4×4.
//  - Venda: vitrine das cartas à venda (foto sua + preço + condição + nota),
//    com exportar como imagem para postar em grupos — inspirado no cardgrid.
// Um único motor, configurado pelo atributo data-binder-mode da <main>.
// Sem inline handlers (CSP script-src 'self'): tudo via addEventListener.
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const root = document.querySelector("[data-binder-mode]");
  if (!root) return;

  const {
    t, escapeHtml, escapeAttribute, localizedImg, cardImageSources, cardLabel,
    cardCode, matchesCardQuery, loadCatalog, defaultVariant, getLocale,
    CARD_CONDITIONS, DEFAULT_CONDITION, debounce
  } = shared;

  const mode = root.dataset.binderMode === "sale" ? "sale" : "collection";
  const isSale = mode === "sale";

  const GRIDS = {
    "2x2": { cols: 2, rows: 2 },
    "3x3": { cols: 3, rows: 3 },
    "4x4": { cols: 4, rows: 4 }
  };
  const GRID_ORDER = ["2x2", "3x3", "4x4"];
  const DEFAULT_GRID = "3x3";
  const MAX_PHOTOS = 150;       // teto de fotos no IndexedDB (limite pedido)
  const PHOTO_MAX_DIM = 900;    // redimensiona o lado maior antes de guardar
  const PHOTO_QUALITY = 0.82;   // WebP

  function slotCount(grid) {
    const g = GRIDS[grid] || GRIDS[DEFAULT_GRID];
    return g.cols * g.rows;
  }
  function uid(prefix) {
    const rnd = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    return `${prefix}${rnd}`;
  }
  function fmtPrice(value) {
    const n = Number(value);
    if (!n) return "";
    return n.toLocaleString(getLocale ? getLocale() : "pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ---------------------------------------------------------------------------
  // Fotos: IndexedDB (Blob comprimido). 100% local — nunca sai do navegador.
  // ---------------------------------------------------------------------------
  const DB_NAME = "tcg-collector";
  const DB_VERSION = 1;
  const PHOTO_STORE = "binderPhotos";
  let dbPromise = null;
  const urlCache = new Map();

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        reject(error);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  function idbDo(storeMode, fn) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, storeMode);
      const store = tx.objectStore(PHOTO_STORE);
      let result;
      const request = fn(store);
      if (request) request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }
  function putPhotoBlob(blob) {
    const id = uid("p_");
    return idbDo("readwrite", (store) => store.put(blob, id)).then(() => id);
  }
  function getPhotoBlob(id) {
    return idbDo("readonly", (store) => store.get(id));
  }
  function deletePhoto(id) {
    if (!id) return Promise.resolve();
    const cached = urlCache.get(id);
    if (cached) { URL.revokeObjectURL(cached); urlCache.delete(id); }
    return idbDo("readwrite", (store) => store.delete(id)).catch(() => {});
  }
  function countPhotos() {
    return idbDo("readonly", (store) => store.count()).catch(() => 0);
  }
  function photoURL(id) {
    if (!id) return Promise.resolve("");
    if (urlCache.has(id)) return Promise.resolve(urlCache.get(id));
    return getPhotoBlob(id).then((blob) => {
      if (!blob) return "";
      const url = URL.createObjectURL(blob);
      urlCache.set(id, url);
      return url;
    }).catch(() => "");
  }

  // Redimensiona/comprime a foto enviada para WebP antes de guardar.
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("read"));
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, PHOTO_MAX_DIM / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("blob")), "image/webp", PHOTO_QUALITY);
        };
        img.onerror = () => reject(new Error("decode"));
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ---------------------------------------------------------------------------
  // Store dos binders (localStorage). { collection: [...], sale: [...] }
  // ---------------------------------------------------------------------------
  const STORAGE_KEY = "tcg-collector-binders-v1";
  function readData() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch (error) { /* ignora */ }
    return {};
  }
  const data = readData();
  if (!Array.isArray(data.collection)) data.collection = [];
  if (!Array.isArray(data.sale)) data.sale = [];
  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
  function list() { return data[mode]; }
  function getBinder(id) { return list().find((b) => b.id === id); }

  // Um binder tem N páginas, cada uma com slotCount(grid) slots. Os slots ficam
  // num único array achatado (length = pages × slotCount), indexado globalmente.
  function pageCount(binder) { return Math.max(1, binder.pages || 1); }
  function normalizeSlots(binder) {
    if (!GRIDS[binder.grid]) binder.grid = DEFAULT_GRID;
    const per = slotCount(binder.grid);
    if (!Number.isInteger(binder.pages) || binder.pages < 1) {
      // Migração de binders antigos (sem páginas): deriva das slots existentes.
      binder.pages = Math.max(1, Math.ceil((Array.isArray(binder.slots) ? binder.slots.length : 0) / per) || 1);
    }
    const n = per * binder.pages;
    if (!Array.isArray(binder.slots)) binder.slots = [];
    if (binder.slots.length < n) binder.slots = binder.slots.concat(Array(n - binder.slots.length).fill(null));
    else if (binder.slots.length > n) binder.slots = binder.slots.slice(0, n);
    return binder;
  }
  list().forEach(normalizeSlots);

  // Página atual de cada binder (em memória; não precisa persistir).
  const pageState = new Map();
  function currentPage(binder) { return Math.min(pageState.get(binder.id) || 0, pageCount(binder) - 1); }
  function setCurrentPage(binder, idx) { pageState.set(binder.id, Math.max(0, Math.min(idx, pageCount(binder) - 1))); }

  function createBinder(name, grid) {
    const binder = {
      id: uid("b_"),
      name: name || t("binders.new"),
      subtitle: "",
      grid: GRIDS[grid] ? grid : DEFAULT_GRID,
      pages: 1,
      slots: Array(slotCount(grid)).fill(null),
      updatedAt: Date.now()
    };
    list().unshift(binder);
    save();
    return binder;
  }
  function removeBinder(id) {
    const binder = getBinder(id);
    if (!binder) return;
    (binder.slots || []).forEach((slot) => { if (slot && slot.photoId) deletePhoto(slot.photoId); });
    data[mode] = list().filter((b) => b.id !== id);
    pageState.delete(id);
    save();
  }
  function setGrid(binder, grid) {
    if (!GRIDS[grid]) return;
    const newTotal = slotCount(grid) * pageCount(binder);
    // Ao encolher, apaga as fotos dos slots que serão descartados (sem órfãos).
    if (Array.isArray(binder.slots) && binder.slots.length > newTotal) {
      binder.slots.slice(newTotal).forEach((slot) => { if (slot && slot.photoId) deletePhoto(slot.photoId); });
    }
    binder.grid = grid;
    normalizeSlots(binder);
    setCurrentPage(binder, currentPage(binder));
    binder.updatedAt = Date.now();
    save();
  }

  // Adiciona uma página em branco no fim e pula para ela.
  function addPage(binder) {
    binder.pages = pageCount(binder) + 1;
    normalizeSlots(binder);
    setCurrentPage(binder, binder.pages - 1);
    binder.updatedAt = Date.now();
    save();
  }
  // Remove a página informada (e as fotos das cartas dela). Mantém ao menos uma.
  function removePage(binder, pageIdx) {
    if (pageCount(binder) <= 1) return;
    const per = slotCount(binder.grid);
    const start = pageIdx * per;
    binder.slots.slice(start, start + per).forEach((slot) => { if (slot && slot.photoId) deletePhoto(slot.photoId); });
    binder.slots.splice(start, per);
    binder.pages = pageCount(binder) - 1;
    setCurrentPage(binder, Math.min(pageIdx, pageCount(binder) - 1));
    binder.updatedAt = Date.now();
    save();
  }

  // Arrastar e soltar: troca o conteúdo dos slots. Se o destino estiver vazio,
  // vira uma simples movimentação (a origem fica vazia).
  function moveSlot(binder, from, to) {
    if (from === to) return;
    const slots = binder.slots;
    if (from < 0 || to < 0 || from >= slots.length || to >= slots.length) return;
    const tmp = slots[to];
    slots[to] = slots[from];
    slots[from] = tmp;
    binder.updatedAt = Date.now();
    save();
  }

  // ---------------------------------------------------------------------------
  // Catálogo (carregado sob demanda — só ao abrir o editor e buscar).
  // ---------------------------------------------------------------------------
  let catalogPromise = null;
  let cardsById = new Map();
  let allCards = [];
  function ensureCatalog() {
    if (!catalogPromise) {
      catalogPromise = loadCatalog().then((catalog) => {
        allCards = catalog.cards || [];
        cardsById = new Map(allCards.map((card) => [card.id, card]));
        return allCards;
      });
    }
    return catalogPromise;
  }

  // Fontes do usuário ("Coleção" e "Desejo"): conjuntos de cardId lidos do
  // localStorage a cada abertura do editor, usados para filtrar o catálogo.
  let collectionIds = new Set();
  let wishlistIds = new Set();
  function refreshUserSources() {
    try {
      const coll = shared.createCollectionStore().toObject();
      collectionIds = new Set(Object.keys(coll).filter((id) => {
        const variants = coll[id] || {};
        return Object.keys(variants).some((v) => Object.values(variants[v] || {}).some((q) => q > 0));
      }));
    } catch (error) { collectionIds = new Set(); }
    try {
      const wish = shared.createWishlistStore().toObject();
      wishlistIds = new Set(Object.keys(wish).filter((id) => Array.isArray(wish[id]) && wish[id].length));
    } catch (error) { wishlistIds = new Set(); }
  }
  // Lista-base de cartas para a aba de busca atual.
  function baseListForTab() {
    if (editing && editing.tab === "collection") return allCards.filter((card) => collectionIds.has(card.id));
    if (editing && editing.tab === "wishlist") return allCards.filter((card) => wishlistIds.has(card.id));
    return allCards;
  }

  // ---------------------------------------------------------------------------
  // Render da lista de binders
  // ---------------------------------------------------------------------------
  const elements = {
    list: document.getElementById("binderList"),
    empty: document.getElementById("binderEmpty"),
    nameInput: document.getElementById("binderName"),
    gridSelect: document.getElementById("binderGrid"),
    createButton: document.getElementById("binderCreate")
  };

  function gridOptionsHtml(selected) {
    return GRID_ORDER.map((key) =>
      `<option value="${key}"${key === selected ? " selected" : ""}>${escapeHtml(t(`binders.grid.${key}`))}</option>`
    ).join("");
  }

  function render() {
    const binders = list();
    elements.empty.hidden = binders.length > 0;
    elements.list.innerHTML = binders.map(binderHtml).join("");
    // Preenche as fotos (IndexedDB é assíncrono).
    elements.list.querySelectorAll("img[data-photo-id]").forEach((img) => {
      photoURL(img.dataset.photoId).then((url) => { if (url) img.src = url; });
    });
  }

  function binderHtml(binder) {
    const g = GRIDS[binder.grid] || GRIDS[DEFAULT_GRID];
    const per = slotCount(binder.grid);
    const pages = pageCount(binder);
    const page = currentPage(binder);
    const start = page * per;
    const filled = (binder.slots || []).filter(Boolean);
    const slots = (binder.slots || []).slice(start, start + per)
      .map((slot, i) => slotHtml(slot, start + i)).join("");
    const saleTotal = isSale
      ? filled.reduce((sum, slot) => sum + (Number(slot.price) || 0), 0)
      : 0;
    const meta = isSale && saleTotal > 0
      ? `<span class="binder-meta">${escapeHtml(t("binders.saleTotal"))}: R$ ${escapeHtml(fmtPrice(saleTotal))}</span>`
      : `<span class="binder-meta">${escapeHtml(t("binders.cardsCount", { n: filled.length }))}</span>`;

    const pageNav = `
      <div class="binder-pagenav">
        <button type="button" class="secondary binder-page-btn" data-page-prev aria-label="${escapeAttribute(t("binders.page.prev"))}"${page <= 0 ? " disabled" : ""}>‹</button>
        <span class="binder-page-indicator">${escapeHtml(t("binders.page.indicator", { n: page + 1, total: pages }))}</span>
        <button type="button" class="secondary binder-page-btn" data-page-next aria-label="${escapeAttribute(t("binders.page.next"))}"${page >= pages - 1 ? " disabled" : ""}>›</button>
        <button type="button" class="secondary binder-page-add" data-page-add>+ ${escapeHtml(t("binders.page.add"))}</button>
        ${pages > 1 ? `<button type="button" class="secondary binder-page-remove" data-page-remove aria-label="${escapeAttribute(t("binders.page.remove"))}">${escapeHtml(t("binders.page.remove"))}</button>` : ""}
      </div>`;

    return `
      <article class="binder" data-binder-id="${escapeAttribute(binder.id)}">
        <header class="binder-head">
          <div class="binder-titles">
            <input class="binder-name-input" type="text" value="${escapeAttribute(binder.name)}"
              data-binder-rename aria-label="${escapeAttribute(t("binders.rename"))}">
            ${isSale ? `<input class="binder-subtitle-input" type="text" value="${escapeAttribute(binder.subtitle || "")}"
              data-binder-subtitle placeholder="${escapeAttribute(t("binders.editor.notePlaceholder"))}" aria-label="contato">` : ""}
            ${meta}
          </div>
          <div class="binder-actions">
            <label class="binder-grid-label">${escapeHtml(t("binders.grid"))}
              <select data-binder-grid>${gridOptionsHtml(binder.grid)}</select>
            </label>
            <button type="button" class="secondary" data-binder-export>${escapeHtml(t("binders.exportImage"))}</button>
            <button type="button" class="secondary binder-delete" data-binder-delete>${escapeHtml(t("binders.delete"))}</button>
          </div>
        </header>
        ${pageNav}
        <div class="binder-grid" style="--cols:${g.cols}">${slots}</div>
      </article>`;
  }

  function slotHtml(slot, index) {
    if (!slot) {
      return `<button type="button" class="binder-slot binder-slot-empty" data-slot-index="${index}">
        <span class="binder-slot-plus" aria-hidden="true">+</span>
        <span>${escapeHtml(t("binders.slotEmpty"))}</span>
      </button>`;
    }
    const title = slot.cardId ? cardLabelFromSlot(slot) : (slot.label || "");
    let media;
    if (slot.photoId) {
      media = `<img class="binder-slot-img" data-photo-id="${escapeAttribute(slot.photoId)}" alt="${escapeAttribute(title)}">`;
    } else if (slot.image) {
      media = localizedImg(slot.image, { className: "binder-slot-img", alt: title, fallback: slot.fallback || "", loading: "lazy" });
    } else {
      media = `<span class="binder-slot-free">${escapeHtml(title || "—")}</span>`;
    }
    const priceTag = isSale && Number(slot.price)
      ? `<span class="binder-slot-price">R$ ${escapeHtml(fmtPrice(slot.price))}${slot.condition ? ` · ${escapeHtml(slot.condition)}` : ""}</span>`
      : "";
    return `<button type="button" class="binder-slot binder-slot-filled" data-slot-index="${index}" draggable="true" title="${escapeAttribute(title)}">
      <span class="binder-slot-media">${media}</span>
      ${priceTag}
    </button>`;
  }

  function cardLabelFromSlot(slot) {
    return slot.code ? `${slot.name} (${slot.code})` : slot.name || "";
  }

  // ---------------------------------------------------------------------------
  // Editor de slot (modal)
  // ---------------------------------------------------------------------------
  let editing = null; // { binderId, index, draft, originalPhotoId, tab }

  function openEditor(binderId, index) {
    const binder = getBinder(binderId);
    if (!binder) return;
    const existing = binder.slots[index];
    const draft = existing ? Object.assign({}, existing) : {
      cardId: null, variant: "", name: "", code: "", image: "", fallback: "",
      photoId: null, price: 0, condition: DEFAULT_CONDITION, note: ""
    };
    editing = {
      binderId,
      index,
      draft,
      originalPhotoId: existing ? existing.photoId || null : null,
      tab: draft.cardId || !draft.label ? "catalog" : "free"
    };
    refreshUserSources();
    renderEditor();
    ensureCatalog().then(() => {
      if (editing) renderSearchResults("");
    });
  }

  function editorModal() {
    let modal = document.getElementById("binderEditor");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "binderEditor";
      modal.className = "card-preview-modal binder-editor";
      document.body.appendChild(modal);
    }
    return modal;
  }

  function renderEditor() {
    if (!editing) return;
    const { draft, tab } = editing;
    const searchTab = tab === "catalog" || tab === "collection" || tab === "wishlist";
    const modal = editorModal();
    const conditionOptions = CARD_CONDITIONS.map((c) =>
      `<option value="${c}"${c === (draft.condition || DEFAULT_CONDITION) ? " selected" : ""}>${escapeHtml(c)} — ${escapeHtml(t(`condition.${c}`))}</option>`
    ).join("");

    const saleFields = isSale ? `
      <div class="binder-editor-sale">
        <label>${escapeHtml(t("binders.editor.price"))}
          <input type="text" inputmode="decimal" data-edit-price value="${escapeAttribute(draft.price ? String(draft.price).replace(".", ",") : "")}">
        </label>
        <label>${escapeHtml(t("binders.editor.condition"))}
          <select data-edit-condition>${conditionOptions}</select>
        </label>
        <label class="binder-editor-note">${escapeHtml(t("binders.editor.note"))}
          <input type="text" data-edit-note value="${escapeAttribute(draft.note || "")}" placeholder="${escapeAttribute(t("binders.editor.notePlaceholder"))}">
        </label>
      </div>` : "";

    const photoState = draft.photoId
      ? `<img class="binder-editor-photo" data-photo-id="${escapeAttribute(draft.photoId)}" alt="">`
      : "";

    modal.innerHTML = `
      <div class="card-preview-backdrop" data-edit-close></div>
      <div class="card-preview-panel binder-editor-panel" role="dialog" aria-modal="true" aria-label="${escapeAttribute(t("binders.editor.title"))}">
        <button type="button" class="preview-close" data-edit-close aria-label="${escapeAttribute(t("binders.cancel"))}">×</button>
        <div class="binder-editor-body">
          <h2>${escapeHtml(t("binders.editor.title"))}</h2>
          <div class="binder-editor-tabs" role="tablist">
            <button type="button" class="chip${tab === "catalog" ? " active" : ""}" data-edit-tab="catalog" aria-pressed="${tab === "catalog"}">${escapeHtml(t("binders.editor.tabCatalog"))}</button>
            <button type="button" class="chip${tab === "collection" ? " active" : ""}" data-edit-tab="collection" aria-pressed="${tab === "collection"}">${escapeHtml(t("binders.editor.tabCollection"))}</button>
            <button type="button" class="chip${tab === "wishlist" ? " active" : ""}" data-edit-tab="wishlist" aria-pressed="${tab === "wishlist"}">${escapeHtml(t("binders.editor.tabWishlist"))}</button>
            <button type="button" class="chip${tab === "free" ? " active" : ""}" data-edit-tab="free" aria-pressed="${tab === "free"}">${escapeHtml(t("binders.editor.tabFree"))}</button>
          </div>

          <div class="binder-editor-tabpanel"${searchTab ? "" : " hidden"}>
            <input type="search" class="binder-editor-search" data-edit-search placeholder="${escapeAttribute(t("binders.editor.search"))}" value="">
            <div class="binder-editor-results" data-edit-results>
              <p class="binder-editor-hint">${escapeHtml(t("binders.editor.loadingCatalog"))}</p>
            </div>
          </div>

          <div class="binder-editor-tabpanel"${tab === "free" ? "" : " hidden"}>
            <label class="binder-editor-field">${escapeHtml(t("binders.editor.label"))}
              <input type="text" data-edit-label value="${escapeAttribute(draft.cardId ? "" : (draft.label || ""))}" placeholder="${escapeAttribute(t("binders.editor.labelPlaceholder"))}">
            </label>
          </div>

          ${draft.cardId || (!draft.cardId && draft.label) ? `<p class="binder-editor-selected">${escapeHtml(draft.cardId ? cardLabelFromSlot(draft) : (draft.label || ""))}</p>` : ""}

          ${tab === "collection" ? "" : `<div class="binder-editor-photo-row">
            <span class="binder-editor-photo-wrap">${photoState}</span>
            <div class="binder-editor-photo-actions">
              <label class="secondary file-button">
                <span>${escapeHtml(draft.photoId ? t("binders.editor.photoChange") : t("binders.editor.photoAdd"))}</span>
                <input type="file" accept="image/*" data-edit-photo>
              </label>
              ${draft.photoId ? `<button type="button" class="secondary" data-edit-photo-remove>${escapeHtml(t("binders.editor.photoRemove"))}</button>` : ""}
              <p class="binder-editor-hint">${escapeHtml(t("binders.editor.photoHint"))}</p>
            </div>
          </div>`}

          ${saleFields}

          <div class="binder-editor-footer">
            <button type="button" class="primary" data-edit-save>${escapeHtml(t("binders.editor.save"))}</button>
            <button type="button" class="secondary" data-edit-clear>${escapeHtml(t("binders.editor.clear"))}</button>
            <button type="button" class="secondary" data-edit-close>${escapeHtml(t("binders.cancel"))}</button>
          </div>
        </div>
      </div>`;

    document.body.classList.add("preview-open");
    modal.querySelectorAll("img[data-photo-id]").forEach((img) => {
      photoURL(img.dataset.photoId).then((url) => { if (url) img.src = url; });
    });
    const search = modal.querySelector("[data-edit-search]");
    if (search && searchTab) search.focus();
  }

  function renderSearchResults(query) {
    if (!editing) return;
    const modal = document.getElementById("binderEditor");
    if (!modal) return;
    const container = modal.querySelector("[data-edit-results]");
    if (!container) return;
    const term = String(query || "").trim();
    const pool = baseListForTab();
    let matches;
    if (term) {
      matches = pool.filter((card) => matchesCardQuery(card, term)).slice(0, 48);
    } else if (editing.tab === "catalog") {
      // Catálogo tem ~48k cartas: só busca sob demanda (não lista tudo).
      container.innerHTML = `<p class="binder-editor-hint">${escapeHtml(t("binders.editor.search"))}</p>`;
      return;
    } else {
      // Coleção/Desejo: já mostra as cartas do usuário sem precisar digitar.
      matches = pool.slice(0, 48);
    }
    if (!matches.length) {
      const emptyKey = !term && editing.tab === "collection" ? "binders.editor.emptyCollection"
        : !term && editing.tab === "wishlist" ? "binders.editor.emptyWishlist"
        : "binders.editor.noResults";
      container.innerHTML = `<p class="binder-editor-hint">${escapeHtml(t(emptyKey))}</p>`;
      return;
    }
    container.innerHTML = matches.map((card) => {
      const sources = cardImageSources(card);
      const thumb = localizedImg(sources.url, { className: "binder-result-thumb", alt: "", fallback: sources.fallback, loading: "lazy", thumb: true });
      return `<button type="button" class="binder-result" data-result-id="${escapeAttribute(card.id)}">
        <span class="binder-result-media">${thumb}</span>
        <span class="binder-result-label">${escapeHtml(cardLabel(card))}</span>
      </button>`;
    }).join("");
  }

  function selectCard(cardId) {
    if (!editing) return;
    const card = cardsById.get(cardId);
    if (!card) return;
    const sources = cardImageSources(card);
    Object.assign(editing.draft, {
      cardId: card.id,
      variant: defaultVariant(card),
      name: card.name,
      code: cardCode(card),
      image: sources.url,
      fallback: sources.fallback || "",
      label: ""
    });
    renderEditor();
    const search = document.querySelector("#binderEditor [data-edit-search]");
    if (search) { search.value = ""; }
    renderSearchResults("");
  }

  function closeEditor() {
    const modal = document.getElementById("binderEditor");
    // Descarta foto enviada nesta sessão se o usuário cancelou sem salvar.
    if (editing && editing.draft.photoId && editing.draft.photoId !== editing.originalPhotoId) {
      deletePhoto(editing.draft.photoId);
    }
    editing = null;
    if (modal) modal.remove();
    document.body.classList.remove("preview-open");
  }

  function saveEditor() {
    if (!editing) return;
    const binder = getBinder(editing.binderId);
    if (!binder) { closeEditor(); return; }
    const draft = editing.draft;
    const modal = document.getElementById("binderEditor");

    if (editing.tab === "free") {
      const labelInput = modal && modal.querySelector("[data-edit-label]");
      draft.label = labelInput ? labelInput.value.trim() : (draft.label || "");
      draft.cardId = null;
      draft.image = "";
      draft.fallback = "";
      draft.name = "";
      draft.code = "";
    }
    if (isSale && modal) {
      const priceInput = modal.querySelector("[data-edit-price]");
      const condSelect = modal.querySelector("[data-edit-condition]");
      const noteInput = modal.querySelector("[data-edit-note]");
      if (priceInput) {
        const text = priceInput.value.trim();
        const amount = Number(text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text) || 0;
        draft.price = amount > 0 ? Math.round(amount * 100) / 100 : 0;
      }
      if (condSelect) draft.condition = condSelect.value;
      if (noteInput) draft.note = noteInput.value.trim();
    }

    const hasContent = draft.cardId || draft.label || draft.photoId || (isSale && draft.price);
    // Apaga a foto antiga que foi substituída.
    if (editing.originalPhotoId && editing.originalPhotoId !== draft.photoId) {
      deletePhoto(editing.originalPhotoId);
    }
    binder.slots[editing.index] = hasContent ? draft : null;
    binder.updatedAt = Date.now();
    save();
    editing = null;
    if (modal) modal.remove();
    document.body.classList.remove("preview-open");
    render();
  }

  function clearSlot() {
    if (!editing) return;
    const binder = getBinder(editing.binderId);
    if (binder) {
      const existing = binder.slots[editing.index];
      if (existing && existing.photoId) deletePhoto(existing.photoId);
      binder.slots[editing.index] = null;
      binder.updatedAt = Date.now();
      save();
    }
    // Também descarta foto nova não salva.
    if (editing.draft.photoId && editing.draft.photoId !== editing.originalPhotoId) {
      deletePhoto(editing.draft.photoId);
    }
    editing = null;
    const modal = document.getElementById("binderEditor");
    if (modal) modal.remove();
    document.body.classList.remove("preview-open");
    render();
  }

  async function handlePhotoUpload(file) {
    if (!editing || !file) return;
    const count = await countPhotos();
    const replacing = Boolean(editing.draft.photoId);
    if (!replacing && count >= MAX_PHOTOS) {
      alert(t("binders.photoLimit", { n: MAX_PHOTOS }));
      return;
    }
    let blob;
    try {
      blob = await compressImage(file);
    } catch (error) {
      alert(t("binders.photoError"));
      return;
    }
    let newId;
    try {
      newId = await putPhotoBlob(blob);
    } catch (error) {
      alert(t("binders.photoError"));
      return;
    }
    // Descarta foto anterior desta sessão (não a original — essa só sai ao salvar).
    if (editing.draft.photoId && editing.draft.photoId !== editing.originalPhotoId) {
      deletePhoto(editing.draft.photoId);
    }
    editing.draft.photoId = newId;
    renderEditor();
  }

  // ---------------------------------------------------------------------------
  // Exportar binder como imagem (canvas) — o "produto" da página de venda.
  // ---------------------------------------------------------------------------
  function loadImage(src, cross) {
    return new Promise((resolve) => {
      if (!src) { resolve(null); return; }
      const img = new Image();
      if (cross) img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  function drawCover(ctx, img, x, y, w, h) {
    const ratio = Math.max(w / img.width, h / img.height);
    const dw = img.width * ratio;
    const dh = img.height * ratio;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  async function exportBinder(binderId, button) {
    const binder = getBinder(binderId);
    if (!binder) return;
    const g = GRIDS[binder.grid] || GRIDS[DEFAULT_GRID];
    const label = button ? button.textContent : "";
    if (button) { button.disabled = true; button.textContent = "…"; }

    const CARD_W = 260;
    const CARD_H = 364;
    const GAP = 18;
    const PAD = 28;
    const headerH = 84;
    const footerH = 30;
    const width = PAD * 2 + g.cols * CARD_W + (g.cols - 1) * GAP;
    const height = PAD + headerH + g.rows * CARD_H + (g.rows - 1) * GAP + footerH + PAD;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    // Fundo
    ctx.fillStyle = "#0d0e12";
    ctx.fillRect(0, 0, width, height);

    // Cabeçalho
    ctx.fillStyle = "#f4f5f7";
    ctx.font = "700 34px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(binder.name || "", PAD, PAD, width - PAD * 2);
    if (binder.subtitle) {
      ctx.fillStyle = "#aab1bd";
      ctx.font = "400 20px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText(binder.subtitle, PAD, PAD + 44, width - PAD * 2);
    }

    // Exporta a página atual do binder.
    const exportOffset = currentPage(binder) * slotCount(binder.grid);
    const gridTop = PAD + headerH;
    for (let i = 0; i < g.cols * g.rows; i++) {
      const col = i % g.cols;
      const row = Math.floor(i / g.cols);
      const x = PAD + col * (CARD_W + GAP);
      const y = gridTop + row * (CARD_H + GAP);
      const slot = binder.slots[exportOffset + i];

      ctx.save();
      roundRect(ctx, x, y, CARD_W, CARD_H, 12);
      ctx.fillStyle = "#171a21";
      ctx.fill();
      ctx.clip();

      if (slot) {
        let img = null;
        if (slot.photoId) {
          const url = await photoURL(slot.photoId);
          img = await loadImage(url, false);
        } else if (slot.image) {
          img = await loadImage(slot.image, true);
          if (!img && slot.fallback) img = await loadImage(slot.fallback, true);
        }
        if (img) {
          drawCover(ctx, img, x, y, CARD_W, CARD_H);
        } else {
          ctx.fillStyle = "#aab1bd";
          ctx.font = "600 18px system-ui, sans-serif";
          ctx.textBaseline = "middle";
          ctx.textAlign = "center";
          const text = slot.cardId ? cardLabelFromSlot(slot) : (slot.label || "");
          ctx.fillText(text.slice(0, 22), x + CARD_W / 2, y + CARD_H / 2, CARD_W - 20);
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
        }
        // Faixa de preço (venda) / legenda
        if (isSale && Number(slot.price)) {
          const barH = 44;
          ctx.fillStyle = "rgba(10,12,18,0.82)";
          ctx.fillRect(x, y + CARD_H - barH, CARD_W, barH);
          ctx.fillStyle = "#ffd45e";
          ctx.font = "700 22px system-ui, sans-serif";
          ctx.textBaseline = "middle";
          const priceText = `R$ ${fmtPrice(slot.price)}${slot.condition ? `  ${slot.condition}` : ""}`;
          ctx.fillText(priceText, x + 12, y + CARD_H - barH / 2, CARD_W - 24);
          ctx.textBaseline = "top";
        }
      } else {
        ctx.restore();
        ctx.save();
        ctx.strokeStyle = "#2a2f3a";
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 8]);
        roundRect(ctx, x + 1, y + 1, CARD_W - 2, CARD_H - 2, 12);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Rodapé / marca
    ctx.fillStyle = "#6b7280";
    ctx.font = "400 16px system-ui, sans-serif";
    ctx.fillText("TCG Collector", PAD, height - PAD - 4);

    const finish = () => { if (button) { button.disabled = false; button.textContent = label; } };
    try {
      canvas.toBlob((blob) => {
        if (!blob) { alert(t("binders.exportTainted")); finish(); return; }
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        const pageSuffix = pageCount(binder) > 1 ? `_p${currentPage(binder) + 1}` : "";
        link.download = `${(binder.name || "binder").replace(/[^\w-]+/g, "_").slice(0, 40)}${pageSuffix}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        finish();
      }, "image/png");
    } catch (error) {
      // Canvas "tainted" por imagem cross-origin sem CORS: toBlob lança SecurityError.
      alert(t("binders.exportTainted"));
      finish();
    }
  }

  // ---------------------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------------------
  if (elements.gridSelect) elements.gridSelect.innerHTML = gridOptionsHtml(DEFAULT_GRID);

  if (elements.createButton) {
    elements.createButton.addEventListener("click", () => {
      const name = (elements.nameInput.value || "").trim() || t("binders.new");
      const grid = elements.gridSelect.value || DEFAULT_GRID;
      createBinder(name, grid);
      elements.nameInput.value = "";
      render();
    });
  }
  if (elements.nameInput) {
    elements.nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") elements.createButton.click();
    });
  }

  // Delegação na lista de binders
  elements.list.addEventListener("click", (event) => {
    const slotBtn = event.target.closest("[data-slot-index]");
    if (slotBtn) {
      const article = slotBtn.closest("[data-binder-id]");
      openEditor(article.dataset.binderId, Number(slotBtn.dataset.slotIndex));
      return;
    }
    // Navegação de páginas
    const pagePrev = event.target.closest("[data-page-prev]");
    if (pagePrev) {
      const binder = getBinder(pagePrev.closest("[data-binder-id]").dataset.binderId);
      if (binder) { setCurrentPage(binder, currentPage(binder) - 1); render(); }
      return;
    }
    const pageNext = event.target.closest("[data-page-next]");
    if (pageNext) {
      const binder = getBinder(pageNext.closest("[data-binder-id]").dataset.binderId);
      if (binder) { setCurrentPage(binder, currentPage(binder) + 1); render(); }
      return;
    }
    const pageAdd = event.target.closest("[data-page-add]");
    if (pageAdd) {
      const binder = getBinder(pageAdd.closest("[data-binder-id]").dataset.binderId);
      if (binder) { addPage(binder); render(); }
      return;
    }
    const pageRemove = event.target.closest("[data-page-remove]");
    if (pageRemove) {
      const binder = getBinder(pageRemove.closest("[data-binder-id]").dataset.binderId);
      if (binder && confirm(t("binders.page.removeConfirm"))) { removePage(binder, currentPage(binder)); render(); }
      return;
    }
    const exportBtn = event.target.closest("[data-binder-export]");
    if (exportBtn) {
      exportBinder(exportBtn.closest("[data-binder-id]").dataset.binderId, exportBtn);
      return;
    }
    const deleteBtn = event.target.closest("[data-binder-delete]");
    if (deleteBtn) {
      if (confirm(t("binders.deleteConfirm"))) {
        removeBinder(deleteBtn.closest("[data-binder-id]").dataset.binderId);
        render();
      }
    }
  });

  elements.list.addEventListener("change", (event) => {
    const gridSelect = event.target.closest("[data-binder-grid]");
    if (gridSelect) {
      const binder = getBinder(gridSelect.closest("[data-binder-id]").dataset.binderId);
      if (binder) { setGrid(binder, gridSelect.value); render(); }
    }
  });

  // Arrastar e soltar entre slots do MESMO binder (desktop). Mover para um slot
  // vazio reposiciona; soltar sobre um slot cheio troca os dois.
  let dragSrc = null;
  function slotAt(event) {
    const slot = event.target.closest(".binder-slot[data-slot-index]");
    if (!slot) return null;
    const article = slot.closest("[data-binder-id]");
    if (!article) return null;
    return { slot, binderId: article.dataset.binderId, index: Number(slot.dataset.slotIndex) };
  }
  function clearDragOver() {
    elements.list.querySelectorAll(".binder-slot-dragover").forEach((el) => el.classList.remove("binder-slot-dragover"));
  }

  elements.list.addEventListener("dragstart", (event) => {
    const filled = event.target.closest(".binder-slot-filled[data-slot-index]");
    if (!filled) return;
    const article = filled.closest("[data-binder-id]");
    dragSrc = { binderId: article.dataset.binderId, index: Number(filled.dataset.slotIndex) };
    event.dataTransfer.effectAllowed = "move";
    try { event.dataTransfer.setData("text/plain", String(dragSrc.index)); } catch (error) { /* ignora */ }
    filled.classList.add("binder-slot-dragging");
  });

  elements.list.addEventListener("dragend", () => {
    elements.list.querySelectorAll(".binder-slot-dragging").forEach((el) => el.classList.remove("binder-slot-dragging"));
    clearDragOver();
    dragSrc = null;
  });

  elements.list.addEventListener("dragover", (event) => {
    if (!dragSrc) return;
    const target = slotAt(event);
    if (!target || target.binderId !== dragSrc.binderId) return;
    event.preventDefault(); // habilita o drop
    event.dataTransfer.dropEffect = "move";
    if (!target.slot.classList.contains("binder-slot-dragover")) {
      clearDragOver();
      if (target.index !== dragSrc.index) target.slot.classList.add("binder-slot-dragover");
    }
  });

  elements.list.addEventListener("drop", (event) => {
    if (!dragSrc) return;
    const target = slotAt(event);
    if (!target || target.binderId !== dragSrc.binderId) return;
    event.preventDefault();
    const binder = getBinder(dragSrc.binderId);
    const from = dragSrc.index;
    dragSrc = null;
    clearDragOver();
    if (binder && from !== target.index) { moveSlot(binder, from, target.index); render(); }
  });

  // Renomear / subtítulo: salva ao sair do campo (sem re-render, pra não perder foco).
  elements.list.addEventListener("blur", (event) => {
    const renameInput = event.target.closest("[data-binder-rename]");
    if (renameInput) {
      const binder = getBinder(renameInput.closest("[data-binder-id]").dataset.binderId);
      if (binder) { binder.name = renameInput.value.trim() || t("binders.new"); binder.updatedAt = Date.now(); save(); }
      return;
    }
    const subtitleInput = event.target.closest("[data-binder-subtitle]");
    if (subtitleInput) {
      const binder = getBinder(subtitleInput.closest("[data-binder-id]").dataset.binderId);
      if (binder) { binder.subtitle = subtitleInput.value.trim(); binder.updatedAt = Date.now(); save(); }
    }
  }, true);

  // Delegação no modal do editor (criado/dinâmico em document)
  document.addEventListener("click", (event) => {
    if (!editing) return;
    if (event.target.closest("[data-edit-close]")) { closeEditor(); return; }
    if (event.target.closest("[data-edit-save]")) { saveEditor(); return; }
    if (event.target.closest("[data-edit-clear]")) { clearSlot(); return; }
    if (event.target.closest("[data-edit-photo-remove]")) {
      if (editing.draft.photoId && editing.draft.photoId !== editing.originalPhotoId) deletePhoto(editing.draft.photoId);
      editing.draft.photoId = null;
      renderEditor();
      return;
    }
    const tabBtn = event.target.closest("[data-edit-tab]");
    if (tabBtn) { editing.tab = tabBtn.dataset.editTab; renderEditor(); if (editing.tab !== "free") renderSearchResults(""); return; }
    const result = event.target.closest("[data-result-id]");
    if (result) { selectCard(result.dataset.resultId); return; }
  });

  const onSearchInput = debounce((value) => renderSearchResults(value), 180);
  document.addEventListener("input", (event) => {
    if (!editing) return;
    const search = event.target.closest("[data-edit-search]");
    if (search) onSearchInput(search.value);
  });

  document.addEventListener("change", (event) => {
    if (!editing) return;
    const photoInput = event.target.closest("[data-edit-photo]");
    if (photoInput && photoInput.files && photoInput.files[0]) {
      handlePhotoUpload(photoInput.files[0]);
      photoInput.value = "";
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && editing) closeEditor();
  });

  render();
})();
