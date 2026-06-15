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

  // Stores da coleção/desejo/preços: usados pelo resumo (Tenho/Faltando),
  // pelo "marcar tudo" e pela busca por coleção/desejo no editor.
  const ownedStore = shared.createCollectionStore();
  const wishlistStore = shared.createWishlistStore();
  const pricesStore = shared.createPriceStore();

  const GRIDS = {
    "2x2": { cols: 2, rows: 2 },
    "3x3": { cols: 3, rows: 3 },
    "4x4": { cols: 4, rows: 4 },
    "5x5": { cols: 5, rows: 5 }
  };
  const GRID_ORDER = ["2x2", "3x3", "4x4", "5x5"];
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
      description: "",
      color: "",
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

  // Define o número de páginas direto (campo na configuração). Encolher apaga
  // as páginas finais e as fotos das cartas delas.
  function setPages(binder, n) {
    n = Math.max(1, Math.min(200, Math.floor(Number(n)) || 1));
    const per = slotCount(binder.grid);
    const newTotal = per * n;
    if (Array.isArray(binder.slots) && binder.slots.length > newTotal) {
      binder.slots.slice(newTotal).forEach((slot) => { if (slot && slot.photoId) deletePhoto(slot.photoId); });
    }
    binder.pages = n;
    normalizeSlots(binder);
    setCurrentPage(binder, currentPage(binder));
    binder.updatedAt = Date.now();
    save();
  }

  // Marca todas as cartas do binder (slots com cardId) como tendo/não tendo na
  // coleção. Slots de foto/rótulo livre são ignorados (não têm carta vinculada).
  function markAll(binder, owned) {
    (binder.slots || []).forEach((slot) => {
      if (!slot || !slot.cardId) return;
      const variant = slot.variant || DEFAULT_CONDITION;
      const has = ownedStore.variantTotal(slot.cardId, variant) > 0;
      if (owned && !has) ownedStore.toggleVariant(slot.cardId, variant);
      else if (!owned && has) ownedStore.toggleVariant(slot.cardId, variant);
    });
  }

  // Resumo do binder: páginas, cartas (slots com cartas do catálogo), quantas
  // você tem e quantas faltam, com o percentual de progresso.
  function binderStats(binder) {
    const cardSlots = (binder.slots || []).filter((slot) => slot && slot.cardId);
    const cards = cardSlots.length;
    const owned = cardSlots.filter((slot) => ownedStore.has(slot.cardId)).length;
    return {
      pages: pageCount(binder),
      cards,
      owned,
      missing: cards - owned,
      pct: cards ? Math.round((owned / cards) * 100) : 0
    };
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
      const coll = ownedStore.toObject();
      collectionIds = new Set(Object.keys(coll).filter((id) => {
        const variants = coll[id] || {};
        return Object.keys(variants).some((v) => Object.values(variants[v] || {}).some((q) => q > 0));
      }));
    } catch (error) { collectionIds = new Set(); }
    try {
      const wish = wishlistStore.toObject();
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

    const pageControls = `
      <span class="binder-pagenav">
        <button type="button" class="secondary binder-page-btn" data-page-prev aria-label="${escapeAttribute(t("binders.page.prev"))}"${page <= 0 ? " disabled" : ""}>‹</button>
        <span class="binder-page-indicator">${escapeHtml(t("binders.page.indicator", { n: page + 1, total: pages }))}</span>
        <button type="button" class="secondary binder-page-btn" data-page-next aria-label="${escapeAttribute(t("binders.page.next"))}"${page >= pages - 1 ? " disabled" : ""}>›</button>
      </span>
      <button type="button" class="secondary binder-page-add" data-page-add>+ ${escapeHtml(t("binders.page.add"))}</button>
      ${pages > 1 ? `<button type="button" class="secondary binder-page-remove" data-page-remove aria-label="${escapeAttribute(t("binders.page.remove"))}">${escapeHtml(t("binders.page.remove"))}</button>` : ""}`;

    const stats = binderStats(binder);
    const colorStyle = binder.color ? ` style="--binder-color:${escapeAttribute(binder.color)}"` : "";

    return `
      <article class="binder${binder.color ? " has-color" : ""}" data-binder-id="${escapeAttribute(binder.id)}"${colorStyle}>
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
            ${pageControls}
            <button type="button" class="secondary" data-binder-settings aria-expanded="false">${escapeHtml(t("binders.settings"))}</button>
            <button type="button" class="secondary" data-binder-export>${escapeHtml(t("binders.exportImage"))}</button>
            <button type="button" class="secondary binder-delete" data-binder-delete>${escapeHtml(t("binders.delete"))}</button>
          </div>
        </header>
        <div class="binder-summary">
          ${statCell(stats.pages, t("binders.stat.pages"))}
          ${statCell(stats.cards, t("binders.stat.cards"))}
          ${statCell(stats.owned, t("binders.stat.owned"), "is-owned")}
          ${statCell(stats.missing, t("binders.stat.missing"), "is-missing")}
          <div class="binder-progress">
            <div class="binder-progress-head"><span>${escapeHtml(t("binders.stat.progress"))}</span><strong>${stats.pct}%</strong></div>
            <div class="progress-bar"><span style="width:${stats.pct}%"></span></div>
          </div>
        </div>
        ${binderSettingsHtml(binder)}
        <div class="binder-grid" style="--cols:${g.cols}">${slots}</div>
      </article>`;
  }

  function statCell(value, label, cls) {
    return `<div class="binder-stat${cls ? " " + cls : ""}"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`;
  }

  // Painel de configurações (recolhível): detalhes, marcar tudo e imprimir.
  function binderSettingsHtml(binder) {
    const printOpts = [
      ["images", "binders.print.optImages"], ["price", "binders.print.optPrice"],
      ["set", "binders.print.optSet"], ["variant", "binders.print.optVariant"],
      ["owned", "binders.print.optOwned"]
    ].map(([key, k]) =>
      `<label class="binder-print-opt"><input type="checkbox" data-print-opt="${key}" checked> ${escapeHtml(t(k))}</label>`
    ).join("");

    return `
      <div class="binder-settings" hidden>
        <div class="binder-settings-section">
          <h4>${escapeHtml(t("binders.settings.details"))}</h4>
          <label class="binder-field">${escapeHtml(t("binders.settings.description"))}
            <input type="text" data-set-description value="${escapeAttribute(binder.description || "")}" placeholder="${escapeAttribute(t("binders.settings.descriptionPlaceholder"))}">
          </label>
          <div class="binder-field-row">
            <label class="binder-field binder-field-narrow">${escapeHtml(t("binders.settings.pages"))}
              <input type="number" min="1" max="200" data-set-pages value="${pageCount(binder)}">
            </label>
            <label class="binder-field binder-field-narrow">${escapeHtml(t("binders.settings.color"))}
              <input type="color" data-set-color value="${escapeAttribute(binder.color || "#39c79b")}">
            </label>
            <button type="button" class="secondary" data-settings-save>${escapeHtml(t("binders.settings.save"))}</button>
          </div>
        </div>
        <div class="binder-settings-section">
          <h4>${escapeHtml(t("binders.settings.whole"))}</h4>
          <div class="binder-field-row">
            <button type="button" class="secondary" data-mark-all="owned">${escapeHtml(t("binders.settings.markOwned"))}</button>
            <button type="button" class="secondary" data-mark-all="missing">${escapeHtml(t("binders.settings.markMissing"))}</button>
          </div>
        </div>
        <div class="binder-settings-section">
          <h4>${escapeHtml(t("binders.print.title"))}</h4>
          <div class="binder-print-layouts">
            <label class="binder-print-opt"><input type="radio" name="print-layout-${escapeAttribute(binder.id)}" data-print-layout value="grid" checked> ${escapeHtml(t("binders.print.grid"))}</label>
            <label class="binder-print-opt"><input type="radio" name="print-layout-${escapeAttribute(binder.id)}" data-print-layout value="pictures"> ${escapeHtml(t("binders.print.pictures"))}</label>
            <label class="binder-print-opt"><input type="radio" name="print-layout-${escapeAttribute(binder.id)}" data-print-layout value="checklist"> ${escapeHtml(t("binders.print.checklist"))}</label>
          </div>
          <div class="binder-print-opts">${printOpts}</div>
          <button type="button" class="secondary" data-binder-print>${escapeHtml(t("binders.print.go"))}</button>
        </div>
      </div>`;
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
  // Imprimir binder: abre uma janela pronta para impressão (3 layouts).
  // ---------------------------------------------------------------------------
  function slotPhotoDataUrl(photoId) {
    return getPhotoBlob(photoId).then((blob) => {
      if (!blob) return "";
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve("");
        reader.readAsDataURL(blob);
      });
    }).catch(() => "");
  }

  async function resolveSlotForPrint(slot) {
    if (!slot) return null;
    const item = { name: "", code: "", set: "", variant: "", owned: false, price: 0, img: "" };
    if (slot.cardId) {
      const card = cardsById.get(slot.cardId);
      item.name = slot.name || (card ? card.name : "");
      item.code = slot.code || (card ? cardCode(card) : "");
      item.set = card ? card.set : "";
      item.variant = slot.variant || "";
      item.owned = ownedStore.has(slot.cardId);
      const pv = pricesStore.valueFor(slot.cardId, slot.variant || DEFAULT_CONDITION, DEFAULT_CONDITION);
      item.price = pv && pv.value ? pv.value : 0;
      item.img = slot.image || (card ? cardImageSources(card).url : "");
    } else if (slot.label) {
      item.name = slot.label;
    }
    if (slot.photoId) item.img = await slotPhotoDataUrl(slot.photoId);
    return item;
  }

  async function printBinder(binder, layout, opts, button) {
    const label = button ? button.textContent : "";
    if (button) { button.disabled = true; button.textContent = "…"; }
    const esc = escapeHtml;
    try {
      await ensureCatalog();
      const g = GRIDS[binder.grid] || GRIDS[DEFAULT_GRID];
      const per = slotCount(binder.grid);
      let body = "";

      if (layout === "grid") {
        for (let p = 0; p < pageCount(binder); p++) {
          const resolved = await Promise.all(binder.slots.slice(p * per, p * per + per).map(resolveSlotForPrint));
          const cells = resolved.map((item) => {
            if (!item) return `<div class="cell empty"></div>`;
            const img = opts.images && item.img ? `<img src="${item.img}" alt="">` : "";
            const lines = [`<div class="nm">${esc(item.name)}${item.code ? ` <span class="cd">${esc(item.code)}</span>` : ""}</div>`];
            if (opts.set && item.set) lines.push(`<div class="sm">${esc(item.set)}</div>`);
            if (opts.variant && item.variant) lines.push(`<div class="sm">${esc(item.variant)}</div>`);
            if (opts.price && item.price) lines.push(`<div class="sm">R$ ${esc(fmtPrice(item.price))}</div>`);
            if (opts.owned) lines.push(`<div class="ow ${item.owned ? "y" : "n"}">${item.owned ? "✓" : "✗"}</div>`);
            return `<div class="cell">${img}<div class="meta">${lines.join("")}</div></div>`;
          }).join("");
          body += `<section class="page" style="--cols:${g.cols}">${cells}</section>`;
        }
      } else {
        const all = (await Promise.all(binder.slots.map(resolveSlotForPrint))).filter(Boolean);
        if (layout === "pictures") {
          body = `<div class="plist">${all.map((item) => {
            const img = opts.images && item.img ? `<img src="${item.img}" alt="">` : "";
            const sub = [];
            if (opts.set && item.set) sub.push(esc(item.set));
            if (opts.variant && item.variant) sub.push(esc(item.variant));
            if (opts.price && item.price) sub.push("R$ " + esc(fmtPrice(item.price)));
            if (opts.owned) sub.push(item.owned ? t("binders.print.ownedYes") : t("binders.print.ownedNo"));
            return `<div class="prow">${img}<div><strong>${esc(item.name)}</strong>${item.code ? ` <span class="cd">${esc(item.code)}</span>` : ""}<div class="sm">${sub.join(" · ")}</div></div></div>`;
          }).join("")}</div>`;
        } else { // checklist
          const cols = [];
          if (opts.owned) cols.push({ h: "✓", get: (i) => i.owned ? "✓" : "" });
          cols.push({ h: t("binders.print.colName"), get: (i) => esc(i.name) });
          cols.push({ h: t("binders.print.colCode"), get: (i) => esc(i.code) });
          if (opts.set) cols.push({ h: t("binders.print.colSet"), get: (i) => esc(i.set) });
          if (opts.variant) cols.push({ h: t("binders.print.colVariant"), get: (i) => esc(i.variant) });
          if (opts.price) cols.push({ h: t("binders.print.colPrice"), get: (i) => i.price ? "R$ " + esc(fmtPrice(i.price)) : "" });
          const head = `<tr>${cols.map((c) => `<th>${esc(c.h)}</th>`).join("")}</tr>`;
          const rows = all.map((item) => `<tr>${cols.map((c) => `<td>${c.get(item)}</td>`).join("")}</tr>`).join("");
          body = `<table class="checklist">${head}${rows}</table>`;
        }
      }

      const styles = `
        * { box-sizing: border-box; }
        body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #111; margin: 16px; }
        h1 { font-size: 20px; margin: 0 0 4px; }
        .desc { color: #555; margin: 0 0 16px; }
        .page { display: grid; grid-template-columns: repeat(var(--cols,3), 1fr); gap: 8px; margin-bottom: 16px; ${opts.images ? "" : ""} }
        .cell { border: 1px solid #ddd; border-radius: 6px; padding: 6px; text-align: center; min-height: 60px; }
        .cell.empty { border-style: dashed; }
        .cell img { width: 100%; height: auto; border-radius: 4px; }
        .meta { font-size: 11px; }
        .nm { font-weight: 700; } .cd { color: #777; font-weight: 400; }
        .sm { color: #555; font-size: 10px; }
        .ow.y { color: #1a8a5a; font-weight: 700; } .ow.n { color: #b33; }
        .plist .prow { display: flex; gap: 10px; align-items: center; border-bottom: 1px solid #eee; padding: 6px 0; }
        .plist img { width: 48px; height: auto; border-radius: 4px; }
        .checklist { width: 100%; border-collapse: collapse; font-size: 12px; }
        .checklist th, .checklist td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; }
        .checklist th { background: #f3f3f3; }
        @media print { ${opts.onePagePerPrint !== false && layout === "grid" ? ".page { break-after: page; }" : ""} }
      `;
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(binder.name || "Binder")}</title><style>${styles}</style></head><body><h1>${esc(binder.name || "")}</h1>${binder.description ? `<p class="desc">${esc(binder.description)}</p>` : ""}${body}</body></html>`;

      const win = window.open("", "_blank");
      if (!win) { alert(t("binders.print.blocked")); return; }
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.onload = () => setTimeout(() => { win.focus(); win.print(); }, 300);
    } catch (error) {
      alert(t("binders.print.error"));
    } finally {
      if (button) { button.disabled = false; button.textContent = label; }
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
    // Abre/fecha o painel de configurações.
    const settingsBtn = event.target.closest("[data-binder-settings]");
    if (settingsBtn) {
      const panel = settingsBtn.closest("[data-binder-id]").querySelector(".binder-settings");
      if (panel) {
        const open = panel.hidden;
        panel.hidden = !open;
        settingsBtn.setAttribute("aria-expanded", String(open));
      }
      return;
    }
    // Salva detalhes (descrição, nº de páginas, cor).
    const saveBtn = event.target.closest("[data-settings-save]");
    if (saveBtn) {
      const article = saveBtn.closest("[data-binder-id]");
      const binder = getBinder(article.dataset.binderId);
      if (binder) {
        const desc = article.querySelector("[data-set-description]");
        const pagesInput = article.querySelector("[data-set-pages]");
        const colorInput = article.querySelector("[data-set-color]");
        if (desc) binder.description = desc.value.trim();
        if (colorInput) binder.color = colorInput.value;
        if (pagesInput) setPages(binder, pagesInput.value);
        binder.updatedAt = Date.now();
        save();
        render();
      }
      return;
    }
    // Marcar todas / nenhuma como tenho.
    const markBtn = event.target.closest("[data-mark-all]");
    if (markBtn) {
      const binder = getBinder(markBtn.closest("[data-binder-id]").dataset.binderId);
      if (binder) { markAll(binder, markBtn.dataset.markAll === "owned"); render(); }
      return;
    }
    // Imprimir binder.
    const printBtn = event.target.closest("[data-binder-print]");
    if (printBtn) {
      const article = printBtn.closest("[data-binder-id]");
      const binder = getBinder(article.dataset.binderId);
      if (binder) {
        const layoutEl = article.querySelector("[data-print-layout]:checked");
        const opts = {};
        article.querySelectorAll("[data-print-opt]").forEach((cb) => { opts[cb.dataset.printOpt] = cb.checked; });
        printBinder(binder, layoutEl ? layoutEl.value : "grid", opts, printBtn);
      }
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

  // Exportar/Importar coleção: disponível no header de todas as páginas. Opera
  // sobre a coleção/desejo/preços (não sobre os binders). O JSON funciona na
  // hora; o catálogo é carregado em segundo plano para o CSV ter os nomes.
  const exportButton = document.getElementById("exportButton");
  const importInput = document.getElementById("importInput");
  if (exportButton && importInput) {
    shared.bindCollectionTransfer({
      exportButton,
      importInput,
      store: shared.createCollectionStore(),
      wishlist: shared.createWishlistStore(),
      prices: shared.createPriceStore(),
      cards: () => allCards,
      onChange: () => {}
    });
    ensureCatalog();
  }

  render();
})();
