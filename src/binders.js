// Binders: fichários visuais de cartas. Página única (binders.html) com:
//  - Galeria: criar binders e listá-los (grid/lista); clicar abre um binder.
//  - Detalhe (?id=): um binder aberto, com abas Cartas/Resumo/Editar/Imprimir.
// Cada binder tem um tipo: "collection" (cartas que você tem) ou "sale"
// (vitrine com foto/preço/condição). Sem inline handlers (CSP script-src 'self').
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const root = document.getElementById("binderGallery");
  if (!root) return;

  const {
    t, escapeHtml, escapeAttribute, localizedImg, cardImageSources, cardLabel,
    cardCode, matchesCardQuery, loadCatalog, defaultVariant, getLocale,
    CARD_CONDITIONS, DEFAULT_CONDITION, debounce
  } = shared;

  // Tipo do binder agora é por-binder ("collection" | "sale"). `isSale` é
  // ajustado conforme o binder em foco (detalhe/editor/exportar/imprimir).
  function isSaleBinder(binder) { return !!binder && binder.type === "sale"; }
  let isSale = false;
  // ?id= abre um binder específico (modo detalhe); sem id mostra a galeria.
  // ?s= abre um binder compartilhado (somente leitura, vindo da nuvem).
  const openId = new URLSearchParams(window.location.search).get("id");
  const shareId = new URLSearchParams(window.location.search).get("s");

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

  // Pokédex Nacional #1–151 (Kanto). Os nomes não são traduzidos em PT-BR, então
  // a mesma lista serve para os dois idiomas. Usados como "placeholders" no
  // template: cada slot mostra o Pokémon e, ao clicar, abre o catálogo já
  // filtrado por aquele nome.
  const POKEDEX_151 = [
    "Bulbasaur", "Ivysaur", "Venusaur", "Charmander", "Charmeleon", "Charizard",
    "Squirtle", "Wartortle", "Blastoise", "Caterpie", "Metapod", "Butterfree",
    "Weedle", "Kakuna", "Beedrill", "Pidgey", "Pidgeotto", "Pidgeot", "Rattata",
    "Raticate", "Spearow", "Fearow", "Ekans", "Arbok", "Pikachu", "Raichu",
    "Sandshrew", "Sandslash", "Nidoran♀", "Nidorina", "Nidoqueen", "Nidoran♂",
    "Nidorino", "Nidoking", "Clefairy", "Clefable", "Vulpix", "Ninetales",
    "Jigglypuff", "Wigglytuff", "Zubat", "Golbat", "Oddish", "Gloom", "Vileplume",
    "Paras", "Parasect", "Venonat", "Venomoth", "Diglett", "Dugtrio", "Meowth",
    "Persian", "Psyduck", "Golduck", "Mankey", "Primeape", "Growlithe", "Arcanine",
    "Poliwag", "Poliwhirl", "Poliwrath", "Abra", "Kadabra", "Alakazam", "Machop",
    "Machoke", "Machamp", "Bellsprout", "Weepinbell", "Victreebel", "Tentacool",
    "Tentacruel", "Geodude", "Graveler", "Golem", "Ponyta", "Rapidash", "Slowpoke",
    "Slowbro", "Magnemite", "Magneton", "Farfetch'd", "Doduo", "Dodrio", "Seel",
    "Dewgong", "Grimer", "Muk", "Shellder", "Cloyster", "Gastly", "Haunter",
    "Gengar", "Onix", "Drowzee", "Hypno", "Krabby", "Kingler", "Voltorb",
    "Electrode", "Exeggcute", "Exeggutor", "Cubone", "Marowak", "Hitmonlee",
    "Hitmonchan", "Lickitung", "Koffing", "Weezing", "Rhyhorn", "Rhydon",
    "Chansey", "Tangela", "Kangaskhan", "Horsea", "Seadra", "Goldeen", "Seaking",
    "Staryu", "Starmie", "Mr. Mime", "Scyther", "Jynx", "Electabuzz", "Magmar",
    "Pinsir", "Tauros", "Magikarp", "Gyarados", "Lapras", "Ditto", "Eevee",
    "Vaporeon", "Jolteon", "Flareon", "Porygon", "Omanyte", "Omastar", "Kabuto",
    "Kabutops", "Aerodactyl", "Snorlax", "Articuno", "Zapdos", "Moltres",
    "Dratini", "Dragonair", "Dragonite", "Mewtwo", "Mew"
  ];

  // Monta os slots-placeholder de um template a partir de uma lista de nomes.
  function templateSlotsFromNames(names, grid) {
    const per = slotCount(grid);
    const pages = Math.max(1, Math.ceil(names.length / per));
    const slots = new Array(pages * per).fill(null);
    names.forEach((name, i) => {
      const dex = i + 1;
      slots[i] = {
        template: true,
        name,
        // Símbolos de gênero não casam na busca do catálogo; usa o nome-base.
        query: name.replace(/[♀♂]/g, "").trim(),
        dexId: dex,
        image: shared.spriteUrl(dex),
        label: ""
      };
    });
    return { slots, pages };
  }

  const TEMPLATES = {
    pokedex151: { labelKey: "binders.template.151", build: (grid) => templateSlotsFromNames(POKEDEX_151, grid) }
  };
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
  // IndexedDB pode faltar (modo privado em alguns navegadores). Detecta cedo
  // para esconder os controles de foto em vez de falhar no upload.
  const PHOTOS_ENABLED = (() => {
    try { return typeof indexedDB !== "undefined" && !!indexedDB; } catch (error) { return false; }
  })();

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        dbPromise = null; // não envenena: permite nova tentativa depois
        reject(error);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
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
  // Revoga todos os object URLs ao sair da página (evita acúmulo de Blobs em
  // memória em sessões longas com muitas fotos).
  window.addEventListener("pagehide", () => {
    urlCache.forEach((url) => URL.revokeObjectURL(url));
    urlCache.clear();
  });

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
  // Migração: junta os antigos arrays collection/sale num único `binders`,
  // marcando o tipo de cada um.
  if (!Array.isArray(data.binders)) {
    data.binders = [];
    if (Array.isArray(data.collection)) data.collection.forEach((b) => { b.type = b.type || "collection"; data.binders.push(b); });
    if (Array.isArray(data.sale)) data.sale.forEach((b) => { b.type = b.type || "sale"; data.binders.push(b); });
  }
  delete data.collection;
  delete data.sale;
  data.binders.forEach((b) => { if (b.type !== "sale") b.type = "collection"; });
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      // QuotaExceededError: avisa em vez de perder dados em silêncio.
      alert(t("binders.storageFull"));
    }
  }
  save(); // persiste a migração para o novo formato unificado
  function list() { return data.binders; }
  function getBinder(id) { return list().find((b) => b.id === id); }
  // Acha o binder dono de um elemento de evento (delegação). Null-safe: devolve
  // null se não houver [data-binder-id] acima do elemento.
  function eventBinder(el) {
    const article = el && el.closest("[data-binder-id]");
    return article ? getBinder(article.dataset.binderId) : null;
  }
  // Apaga as fotos (IndexedDB) de um conjunto de slots — usado ao encolher
  // grade/páginas e ao remover binder/página (evita blobs órfãos).
  function deleteSlotsPhotos(slots) {
    (slots || []).forEach((slot) => { if (slot && slot.photoId) deletePhoto(slot.photoId); });
  }

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

  // Aba ativa de cada binder (Cartas | Resumo | Editar | Imprimir).
  const tabState = new Map();
  function currentTab(binder) { return tabState.get(binder.id) || "summary"; }
  function setTab(binder, tab) { tabState.set(binder.id, tab); }

  function createBinder(name, grid, type) {
    const binder = {
      id: uid("b_"),
      name: name || t("binders.new"),
      type: type === "sale" ? "sale" : "collection",
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
  // Preenche um binder recém-criado com os placeholders de um template.
  function applyTemplate(binder, templateId) {
    const tpl = TEMPLATES[templateId];
    if (!tpl) return;
    const { slots, pages } = tpl.build(binder.grid);
    binder.slots = slots;
    binder.pages = pages;
    binder.updatedAt = Date.now();
    save();
  }
  function removeBinder(id) {
    const binder = getBinder(id);
    if (!binder) return;
    deleteSlotsPhotos(binder.slots);
    data.binders = list().filter((b) => b.id !== id);
    // Tombstone pra exclusão propagar na sincronização (senão volta de outro device).
    data.deleted = data.deleted || {};
    data.deleted[id] = Date.now();
    pageState.delete(id);
    save();
  }
  // Duplica um binder (copia as fotos no IndexedDB para não compartilhar blobs).
  async function duplicateBinder(id) {
    const src = getBinder(id);
    if (!src) return;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uid("b_");
    copy.name = `${src.name} ${t("binders.copySuffix")}`;
    copy.updatedAt = Date.now();
    for (const slot of copy.slots) {
      if (slot && slot.photoId) {
        try {
          const blob = await getPhotoBlob(slot.photoId);
          slot.photoId = blob ? await putPhotoBlob(blob) : null;
        } catch (error) { slot.photoId = null; }
      }
    }
    list().unshift(copy);
    save();
  }
  function setGrid(binder, grid) {
    if (!GRIDS[grid]) return;
    const newTotal = slotCount(grid) * pageCount(binder);
    // Ao encolher, apaga as fotos dos slots que serão descartados (sem órfãos).
    if (Array.isArray(binder.slots) && binder.slots.length > newTotal) {
      deleteSlotsPhotos(binder.slots.slice(newTotal));
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
    deleteSlotsPhotos(binder.slots.slice(start, start + per));
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
      deleteSlotsPhotos(binder.slots.slice(newTotal));
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
    // Valor (na moeda escolhida): total, já gasto (cartas que tenho) e a comprar.
    let valueTotal = 0;
    let valueOwned = 0;
    cardSlots.forEach((slot) => {
      const v = shared.cardValue({ id: slot.cardId }, slot.variant || DEFAULT_CONDITION, pricesStore).value;
      if (!v) return;
      valueTotal += v;
      if (ownedStore.has(slot.cardId)) valueOwned += v;
    });
    return {
      pages: pageCount(binder),
      cards,
      owned,
      missing: cards - owned,
      pct: cards ? Math.round((owned / cards) * 100) : 0,
      valueTotal,
      valueOwned,
      valueToBuy: Math.max(0, valueTotal - valueOwned)
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
    gallery: document.getElementById("binderGallery"),
    galleryGrid: document.getElementById("binderList"),
    detail: document.getElementById("binderDetail"),
    list: document.getElementById("binderDetailBody"), // container do binder aberto
    empty: document.getElementById("binderEmpty"),
    nameInput: document.getElementById("binderName"),
    typeSelect: document.getElementById("binderType"),
    templateSelect: document.getElementById("binderTemplate"),
    gridSelect: document.getElementById("binderGrid"),
    sortSelect: document.getElementById("binderSort"),
    createButton: document.getElementById("binderCreate"),
    viewToggle: document.querySelector(".binder-view-toggle")
  };

  // Visualização (grid/lista) e ordenação da galeria — preferência guardada.
  let galleryView = localStorage.getItem("tcg-collector-binder-view") === "list" ? "list" : "grid";
  let gallerySort = localStorage.getItem("tcg-collector-binder-sort") || "newest";

  function gridOptionsHtml(selected) {
    return GRID_ORDER.map((key) =>
      `<option value="${key}"${key === selected ? " selected" : ""}>${escapeHtml(t(`binders.grid.${key}`))}</option>`
    ).join("");
  }

  // Dispatcher: com ?id válido mostra o binder aberto; senão, a galeria.
  function render() {
    const binder = openId ? getBinder(openId) : null;
    if (binder) renderDetail(binder);
    else renderGallery();
  }

  // --- Galeria de binders (criar + lista/grid) ---
  function sortedBinders() {
    const arr = list().slice();
    if (gallerySort === "name") arr.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    else if (gallerySort === "cards") arr.sort((a, b) => binderStats(b).cards - binderStats(a).cards);
    else arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); // newest
    return arr;
  }

  function galleryCardHtml(binder) {
    const stats = binderStats(binder);
    const colorStyle = binder.color ? ` style="--binder-color:${escapeAttribute(binder.color)}"` : "";
    const cover = (binder.slots || []).find((s) => s && (s.image || s.photoId));
    let coverHtml = `<span class="binder-card-cover-empty">${escapeHtml((binder.name || "?").charAt(0).toUpperCase())}</span>`;
    if (cover) {
      if (cover.photoId) coverHtml = `<img class="binder-card-cover-img" data-photo-id="${escapeAttribute(cover.photoId)}" alt="">`;
      else if (cover.image) coverHtml = localizedImg(cover.image, { className: "binder-card-cover-img", alt: "", fallback: cover.fallback || "", loading: "lazy" });
    }
    const typeTag = `<span class="binder-card-type">${escapeHtml(t(isSaleBinder(binder) ? "binders.type.sale" : "binders.type.collection"))}</span>`;
    return `
      <article class="binder-card${binder.color ? " has-color" : ""}" data-open-id="${escapeAttribute(binder.id)}"${colorStyle}>
        <div class="binder-card-cover">${coverHtml}</div>
        <div class="binder-card-body">
          <div class="binder-card-titlerow"><strong class="binder-card-name">${escapeHtml(binder.name)}</strong>${typeTag}</div>
          <div class="binder-card-meta"><span>${escapeHtml(t("binders.ownedOf", { o: stats.owned, t: stats.cards }))}</span><span>${stats.pct}%</span></div>
          <div class="progress-bar"><span style="width:${stats.pct}%"></span></div>
        </div>
        <div class="binder-card-acts">
          <button type="button" class="binder-card-act" data-open-id="${escapeAttribute(binder.id)}" aria-label="${escapeAttribute(t("binders.open"))}" title="${escapeAttribute(t("binders.open"))}">✎</button>
          <button type="button" class="binder-card-act" data-duplicate-id="${escapeAttribute(binder.id)}" aria-label="${escapeAttribute(t("binders.duplicate"))}" title="${escapeAttribute(t("binders.duplicate"))}">⧉</button>
          <button type="button" class="binder-card-act danger" data-delete-id="${escapeAttribute(binder.id)}" aria-label="${escapeAttribute(t("binders.delete"))}" title="${escapeAttribute(t("binders.delete"))}">🗑</button>
        </div>
      </article>`;
  }

  function renderGallery() {
    elements.detail.hidden = true;
    elements.gallery.hidden = false;
    const binders = sortedBinders();
    elements.empty.hidden = binders.length > 0;
    elements.galleryGrid.className = `binder-gallery ${galleryView === "list" ? "is-list" : "is-grid"}`;
    elements.galleryGrid.innerHTML = binders.map(galleryCardHtml).join("");
    elements.galleryGrid.querySelectorAll("img[data-photo-id]").forEach((img) => {
      photoURL(img.dataset.photoId).then((url) => { if (url) img.src = url; });
    });
    if (elements.viewToggle) {
      elements.viewToggle.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === galleryView)));
    }
  }

  // --- Detalhe de um binder aberto ---
  function renderDetail(binder) {
    isSale = isSaleBinder(binder);
    elements.gallery.hidden = true;
    elements.detail.hidden = false;
    elements.list.innerHTML = binderHtml(binder);
    elements.list.querySelectorAll("img[data-photo-id]").forEach((img) => {
      photoURL(img.dataset.photoId).then((url) => { if (url) img.src = url; });
    });
  }

  function binderHtml(binder) {
    const g = GRIDS[binder.grid] || GRIDS[DEFAULT_GRID];
    const per = slotCount(binder.grid);
    const pages = pageCount(binder);
    const page = currentPage(binder);
    // Mostra um "par de páginas" (como um fichário aberto): a página da esquerda
    // (sempre o índice par) e a seguinte, separadas por uma marcação no meio.
    const spreadStart = page - (page % 2);
    const hasSecond = spreadStart + 1 < pages;
    // "filled" = cartas reais; placeholders de template não contam.
    const filled = (binder.slots || []).filter((s) => s && !s.template);
    const pageSlots = (p) => {
      const s = p * per;
      return (binder.slots || []).slice(s, s + per).map((slot, i) => slotHtml(slot, s + i)).join("");
    };
    // Cada página é uma grade própria (cols×rows). No "fichário aberto" elas
    // ficam lado a lado; sozinha, ocupa a largura toda (cartas maiores).
    const pageBlock = (p) => `<div class="binder-page">
      <div class="binder-page-cap">${escapeHtml(t("binders.page.indicator", { n: p + 1, total: pages }))}</div>
      <div class="binder-grid" style="--cols:${g.cols}">${pageSlots(p)}</div>
    </div>`;
    const spread = hasSecond
      ? `<div class="binder-spread">${pageBlock(spreadStart)}<div class="binder-spread-divider" aria-hidden="true"></div>${pageBlock(spreadStart + 1)}</div>`
      : `<div class="binder-spread is-single">${pageBlock(spreadStart)}</div>`;
    const saleTotal = isSale
      ? filled.reduce((sum, slot) => sum + (Number(slot.price) || 0), 0)
      : 0;
    const meta = isSale && saleTotal > 0
      ? `<span class="binder-meta">${escapeHtml(t("binders.saleTotal"))}: R$ ${escapeHtml(fmtPrice(saleTotal))}</span>`
      : `<span class="binder-meta">${escapeHtml(t("binders.cardsCount", { n: filled.length }))}</span>`;

    const indicatorText = hasSecond
      ? t("binders.page.indicatorRange", { a: spreadStart + 1, b: spreadStart + 2, total: pages })
      : t("binders.page.indicator", { n: spreadStart + 1, total: pages });
    const pageControls = `
      <span class="binder-pagenav">
        <button type="button" class="secondary binder-page-btn" data-page-prev aria-label="${escapeAttribute(t("binders.page.prev"))}"${spreadStart <= 0 ? " disabled" : ""}>‹</button>
        <span class="binder-page-indicator">${escapeHtml(indicatorText)}</span>
        <button type="button" class="secondary binder-page-btn" data-page-next aria-label="${escapeAttribute(t("binders.page.next"))}"${spreadStart + 2 >= pages ? " disabled" : ""}>›</button>
      </span>
      <button type="button" class="secondary binder-page-add" data-page-add>+ ${escapeHtml(t("binders.page.add"))}</button>
      ${pages > 1 ? `<button type="button" class="secondary binder-page-remove" data-page-remove aria-label="${escapeAttribute(t("binders.page.remove"))}">${escapeHtml(t("binders.page.remove"))}</button>` : ""}`;

    const stats = binderStats(binder);
    const colorStyle = binder.color ? ` style="--binder-color:${escapeAttribute(binder.color)}"` : "";
    const tab = currentTab(binder);
    // Sem aba "Cartas": a grade fica sempre visível embaixo; as abas só trocam
    // o conteúdo do cabeçalho. Resumo é o cabeçalho principal (padrão).
    const TABS = [["summary", "binders.tab.summary"], ["edit", "binders.tab.edit"], ["print", "binders.tab.print"]];
    const tabbar = `<div class="binder-tabbar" role="tablist">${TABS.map(([k, key]) =>
      `<button type="button" class="binder-tab${tab === k ? " active" : ""}" data-binder-tab-btn="${k}" role="tab" aria-selected="${tab === k}">${escapeHtml(t(key))}</button>`
    ).join("")}</div>`;
    const panel = (k, inner) => `<div class="binder-tabpanel" data-binder-tab="${k}"${tab === k ? "" : " hidden"}>${inner}</div>`;

    const money = (v) => (v > 0 ? shared.formatMoney(shared.getCurrency(), v) : "—");
    const summaryPanel = panel("summary", `
      <div class="binder-summary">
        ${statCell(stats.pages, t("binders.stat.pages"))}
        ${statCell(stats.cards, t("binders.stat.cards"))}
        ${statCell(stats.owned, t("binders.stat.owned"), "is-owned")}
        ${statCell(stats.missing, t("binders.stat.missing"), "is-missing")}
        ${statCell(money(stats.valueTotal), t("value.total"))}
        ${statCell(money(stats.valueOwned), t("value.owned"), "is-owned")}
        ${statCell(money(stats.valueToBuy), t("value.toBuy"), "is-missing")}
        <div class="binder-progress">
          <div class="binder-progress-head"><span>${escapeHtml(t("binders.stat.progress"))}</span><strong>${stats.pct}%</strong></div>
          <div class="progress-bar"><span style="width:${stats.pct}%"></span></div>
        </div>
      </div>
      <div class="binder-resumo-controls">
        <div class="binder-pagenav">${pageControls}</div>
        <button type="button" class="secondary binder-export-img" data-binder-export>${escapeHtml(t("binders.exportImage"))}</button>
      </div>`);

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
          ${tabbar}
        </header>
        ${summaryPanel}
        ${panel("edit", binderEditPanelHtml(binder))}
        ${panel("print", binderPrintPanelHtml(binder))}
        ${spread}
      </article>`;
  }

  function statCell(value, label, cls) {
    return `<div class="binder-stat${cls ? " " + cls : ""}"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`;
  }

  // Aba "Editar": formato, detalhes, marcar tudo e excluir o binder.
  function binderEditPanelHtml(binder) {
    return `
      <div class="binder-settings">
        <div class="binder-settings-section">
          <h4>${escapeHtml(t("binders.settings.details"))}</h4>
          <label class="binder-field">${escapeHtml(t("binders.grid"))}
            <select data-binder-grid>${gridOptionsHtml(binder.grid)}</select>
          </label>
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
          <h4>${escapeHtml(t("binders.settings.danger"))}</h4>
          <button type="button" class="secondary binder-delete" data-binder-delete>${escapeHtml(t("binders.delete"))}</button>
        </div>
      </div>`;
  }

  // Aba "Imprimir": layout + opções + botão imprimir.
  function binderPrintPanelHtml(binder) {
    const printOpts = [
      ["realSize", "binders.print.optRealSize"], ["images", "binders.print.optImages"],
      ["price", "binders.print.optPrice"], ["set", "binders.print.optSet"],
      ["variant", "binders.print.optVariant"], ["owned", "binders.print.optOwned"]
    ].map(([key, k]) =>
      `<label class="binder-print-opt"><input type="checkbox" data-print-opt="${key}" checked> ${escapeHtml(t(k))}</label>`
    ).join("");
    return `
      <div class="binder-settings binder-print-settings">
        <div class="binder-settings-section binder-print">
          <h4>${escapeHtml(t("binders.print.title"))}</h4>
          <div class="binder-print-row">
            <span class="binder-print-label">${escapeHtml(t("binders.print.formatLabel"))}</span>
            <div class="binder-print-layouts">
              <label class="binder-print-opt"><input type="radio" name="print-layout-${escapeAttribute(binder.id)}" data-print-layout value="grid" checked> ${escapeHtml(t("binders.print.grid"))}</label>
              <label class="binder-print-opt"><input type="radio" name="print-layout-${escapeAttribute(binder.id)}" data-print-layout value="pictures"> ${escapeHtml(t("binders.print.pictures"))}</label>
              <label class="binder-print-opt"><input type="radio" name="print-layout-${escapeAttribute(binder.id)}" data-print-layout value="checklist"> ${escapeHtml(t("binders.print.checklist"))}</label>
            </div>
          </div>
          <div class="binder-print-row">
            <span class="binder-print-label">${escapeHtml(t("binders.print.includeLabel"))}</span>
            <div class="binder-print-opts">${printOpts}</div>
          </div>
          <button type="button" class="primary binder-print-go" data-binder-print>${escapeHtml(t("binders.print.go"))}</button>
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
    // Placeholder de template: mostra o Pokémon (sprite + nome). Clicar abre o
    // editor já no catálogo, filtrado por esse nome, para escolher a carta.
    if (slot.template) {
      const num = slot.dexId ? String(slot.dexId).padStart(3, "0") : "";
      return `<button type="button" class="binder-slot binder-slot-template" data-slot-index="${index}" title="${escapeAttribute(slot.name)}">
        ${num ? `<span class="binder-slot-tplnum">Nº ${escapeHtml(num)}</span>` : ""}
        <img class="binder-slot-sprite" src="${escapeAttribute(slot.image)}" alt="" loading="lazy">
        <span class="binder-slot-tplname">${escapeHtml(slot.name)}</span>
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

    // Posse (só binder de coleção, só cartas do catálogo): colorida se você tem,
    // preto e branco se não tem. No hover, botão para marcar tenho/não tenho.
    const ownable = !isSale && !!slot.cardId;
    const owned = ownable ? ownedStore.has(slot.cardId) : true;
    const ownBtn = ownable
      ? `<span class="binder-slot-own${owned ? " owned" : ""}" role="button" tabindex="0" data-slot-own="${index}" aria-pressed="${owned}" aria-label="${escapeAttribute(owned ? t("binders.slot.markMissing") : t("binders.slot.markOwned"))}">${owned ? "✓ " + escapeHtml(t("binders.slot.ownedShort")) : "+ " + escapeHtml(t("binders.slot.markOwned"))}</span>`
      : "";

    // Coração na carta que você não tem: adiciona/remove da lista de desejo
    // direto do binder (igual aos tiles normais).
    const variant = slot.variant || DEFAULT_CONDITION;
    const wanted = ownable ? wishlistStore.has(slot.cardId, variant) : false;
    const wantBtn = (ownable && !owned)
      ? `<span class="binder-slot-want${wanted ? " wanted" : ""}" role="button" tabindex="0" data-slot-want="${index}" aria-pressed="${wanted}" aria-label="${escapeAttribute(wanted ? t("tile.unwantAria", { variant }) : t("tile.wantAria", { variant }))}" title="${escapeAttribute(wanted ? t("tile.wanted") : t("tile.want"))}">${heartSvg(wanted)}</span>`
      : "";

    return `<button type="button" class="binder-slot binder-slot-filled${ownable && !owned ? " not-owned" : ""}" data-slot-index="${index}" draggable="true" title="${escapeAttribute(title)}">
      <span class="binder-slot-media">${media}</span>
      ${ownBtn}
      ${wantBtn}
      ${priceTag}
    </button>`;
  }

  function heartSvg(filled) {
    return `<svg viewBox="0 0 24 24" width="15" height="15" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>`;
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
    const isTemplate = !!(existing && existing.template);
    editing = {
      binderId,
      index,
      draft,
      picks: [], // cartas selecionadas (em ordem de clique) para preencher slots
      originalPhotoId: existing ? existing.photoId || null : null,
      // Slot de template abre direto no catálogo, já com o nome buscado.
      tab: isTemplate ? "catalog" : "collection",
      query: isTemplate ? (existing.query || existing.name || "") : "",
      sort: "release"
    };
    refreshUserSources();
    renderEditor();
    ensureCatalog().then(() => {
      if (editing) renderSearchResults(editing.query || "");
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

    const SORTS = [
      ["release", "sort.releaseDate"], ["value-desc", "sort.valueDesc"],
      ["value-asc", "sort.valueAsc"], ["num-desc", "sort.numDesc"], ["num-asc", "sort.numAsc"]
    ];
    const sortOptions = SORTS.map(([v, k]) =>
      `<option value="${v}"${v === (editing.sort || "release") ? " selected" : ""}>${escapeHtml(t(k))}</option>`
    ).join("");

    modal.innerHTML = `
      <div class="card-preview-backdrop" data-edit-close></div>
      <div class="card-preview-panel binder-editor-panel" role="dialog" aria-modal="true" aria-label="${escapeAttribute(t("binders.editor.title"))}">
        <button type="button" class="preview-close" data-edit-close aria-label="${escapeAttribute(t("binders.cancel"))}">×</button>
        <div class="binder-editor-body">
          <h2>${escapeHtml(t("binders.editor.title"))}</h2>
          <div class="binder-editor-tabs" role="tablist">
            <button type="button" class="chip${tab === "collection" ? " active" : ""}" data-edit-tab="collection" aria-pressed="${tab === "collection"}">${escapeHtml(t("binders.editor.tabCollection"))}</button>
            <button type="button" class="chip${tab === "wishlist" ? " active" : ""}" data-edit-tab="wishlist" aria-pressed="${tab === "wishlist"}">${escapeHtml(t("binders.editor.tabWishlist"))}</button>
            <button type="button" class="chip${tab === "catalog" ? " active" : ""}" data-edit-tab="catalog" aria-pressed="${tab === "catalog"}">${escapeHtml(t("binders.editor.tabCatalog"))}</button>
          </div>

          <div class="binder-editor-tabpanel"${searchTab ? "" : " hidden"}>
            <div class="binder-editor-searchbar">
              <input type="search" class="binder-editor-search" data-edit-search placeholder="${escapeAttribute(t("binders.editor.search"))}" value="${escapeAttribute(editing.query || "")}">
              <label class="binder-editor-sort"><span>${escapeHtml(t("sort.label"))}</span>
                <select data-edit-sort>${sortOptions}</select>
              </label>
            </div>
            <div class="binder-editor-results" data-edit-results>
              <p class="binder-editor-hint">${escapeHtml(t("binders.editor.loadingCatalog"))}</p>
            </div>
          </div>

          ${draft.cardId ? `<p class="binder-editor-selected">${escapeHtml(cardLabelFromSlot(draft))}</p>` : ""}

          ${saleFields}

          <div class="binder-editor-footer">
            <button type="button" class="primary" data-edit-save>${escapeHtml(t("binders.editor.save"))}</button>
            <button type="button" class="secondary" data-edit-clear>${escapeHtml(t("binders.editor.clear"))}</button>
            <button type="button" class="secondary" data-edit-close>${escapeHtml(t("binders.cancel"))}</button>
            <span class="binder-pick-info" data-pick-info></span>
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

  // Ordena os resultados da busca como na página de set: lançamento, valor ou
  // número da carta. Cartas sem preço vão para o fim no "valor crescente".
  function sortEditorMatches(matches) {
    const s = (editing && editing.sort) || "release";
    const priceOf = (card) => shared.cardValue(card, defaultVariant(card), pricesStore).value || 0;
    const byNum = (a, b) => shared.compareCardNumbers(a.number, b.number);
    if (s === "num-asc") matches.sort(byNum);
    else if (s === "num-desc") matches.sort((a, b) => byNum(b, a));
    else if (s === "value-desc") matches.sort((a, b) => priceOf(b) - priceOf(a));
    else if (s === "value-asc") matches.sort((a, b) => {
      const pa = priceOf(a), pb = priceOf(b);
      if (!pa && !pb) return 0;
      if (!pa) return 1;
      if (!pb) return -1;
      return pa - pb;
    });
    else matches.sort((a, b) => String(b.setReleaseDate || "").localeCompare(String(a.setReleaseDate || "")));
    return matches;
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
      matches = pool.filter((card) => matchesCardQuery(card, term));
    } else if (editing.tab === "catalog") {
      // Catálogo tem ~48k cartas: só busca sob demanda (não lista tudo).
      container.innerHTML = `<p class="binder-editor-hint">${escapeHtml(t("binders.editor.search"))}</p>`;
      return;
    } else {
      // Coleção/Desejo: já mostra as cartas do usuário sem precisar digitar.
      matches = pool.slice();
    }
    // Ordena conforme o seletor (igual à página de set) e limita a 48 resultados.
    sortEditorMatches(matches);
    matches = matches.slice(0, 48);
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
      const pickIdx = editing.picks ? editing.picks.indexOf(card.id) : -1;
      const sel = pickIdx >= 0;
      // Bandeira (nacionalidade) + valor de referência da carta, na moeda atual.
      const flagHtml = shared.cardFlag(card.language);
      const val = shared.cardValue(card, defaultVariant(card), pricesStore);
      const priceHtml = val && val.value
        ? `<span class="binder-result-price">${escapeHtml((val.estimated ? "≈ " : "") + shared.formatMoney(val.currency, val.value))}</span>`
        : `<span class="binder-result-price binder-result-price-none">—</span>`;
      return `<button type="button" class="binder-result${sel ? " selected" : ""}" data-result-id="${escapeAttribute(card.id)}" aria-pressed="${sel}">
        <span class="binder-result-media">${thumb}${sel ? `<span class="binder-result-badge">${pickIdx + 1}</span>` : ""}<span class="binder-result-flag">${flagHtml}</span></span>
        <span class="binder-result-label">${escapeHtml(cardLabel(card))}</span>
        <span class="binder-result-meta">${priceHtml}</span>
      </button>`;
    }).join("");
  }

  // Seleção múltipla: clicar liga/desliga a carta na lista de escolhidas (na
  // ordem dos cliques). "Adicionar" preenche os slots a partir do clicado.
  function selectCard(cardId) {
    if (!editing || !cardsById.get(cardId)) return;
    const i = editing.picks.indexOf(cardId);
    if (i >= 0) editing.picks.splice(i, 1);
    else editing.picks.push(cardId);
    refreshResultBadges(); // atualiza no lugar (sem recriar/recarregar imagens)
    updatePickCount();
  }

  // Atualiza marca de seleção e numeração dos resultados sem reconstruir o DOM.
  function refreshResultBadges() {
    const modal = document.getElementById("binderEditor");
    if (!modal || !editing) return;
    modal.querySelectorAll(".binder-result").forEach((el) => {
      const pickIdx = editing.picks.indexOf(el.dataset.resultId);
      const sel = pickIdx >= 0;
      el.classList.toggle("selected", sel);
      el.setAttribute("aria-pressed", String(sel));
      const media = el.querySelector(".binder-result-media");
      let badge = el.querySelector(".binder-result-badge");
      if (sel) {
        if (!badge && media) { badge = document.createElement("span"); badge.className = "binder-result-badge"; media.appendChild(badge); }
        if (badge) badge.textContent = String(pickIdx + 1);
      } else if (badge) {
        badge.remove();
      }
    });
  }

  function updatePickCount() {
    const modal = document.getElementById("binderEditor");
    if (!modal || !editing) return;
    const n = editing.picks.length;
    const btn = modal.querySelector("[data-edit-save]");
    if (btn) btn.textContent = n > 1 ? `${t("binders.editor.save")} (${n})` : t("binders.editor.save");
    const info = modal.querySelector("[data-pick-info]");
    if (info) info.textContent = n ? t("binders.editor.selectedCount", { n }) : "";
  }

  // Preenche os slots a partir de startIndex com as cartas (cria páginas se
  // passar do fim). Mostra a página do primeiro slot ao terminar.
  function placeCardsFromIndex(binder, startIndex, cardIds) {
    let idx = startIndex;
    cardIds.forEach((cardId) => {
      const card = cardsById.get(cardId);
      if (!card) return;
      while (idx >= binder.slots.length) addPage(binder);
      const old = binder.slots[idx];
      if (old && old.photoId) deletePhoto(old.photoId);
      const sources = cardImageSources(card);
      binder.slots[idx] = {
        cardId: card.id, variant: defaultVariant(card), name: card.name,
        code: cardCode(card), image: sources.url, fallback: sources.fallback || "", label: ""
      };
      idx++;
    });
    setCurrentPage(binder, Math.floor(startIndex / slotCount(binder.grid)));
    binder.updatedAt = Date.now();
    save();
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

    // Seleção múltipla (abas de carta): preenche os slots a partir do clicado.
    if (editing.tab !== "free" && editing.picks && editing.picks.length) {
      // Descarta foto pendente desta sessão (as cartas escolhidas a substituem).
      if (editing.draft.photoId && editing.draft.photoId !== editing.originalPhotoId) {
        deletePhoto(editing.draft.photoId);
      }
      placeCardsFromIndex(binder, editing.index, editing.picks);
      editing = null;
      if (modal) modal.remove();
      document.body.classList.remove("preview-open");
      render();
      return;
    }

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
    isSale = isSaleBinder(binder);
    const g = GRIDS[binder.grid] || GRIDS[DEFAULT_GRID];
    const label = button ? button.textContent : "";
    if (button) { button.disabled = true; button.textContent = "…"; }

    // A4 retrato, fundo branco (economiza tinta), cartas em tamanho real
    // (63×88mm) — reduzidas só se a grade não couber no A4. Preto e branco das
    // cartas que você não tem é preservado no export.
    const PPM = 8; // px por mm (~203 dpi)
    const A4W = 210, A4H = 297, MARGIN = 6, CWmm = 63, CHmm = 88, GAPmm = 3;
    const fnt = (mm, w) => `${w || 400} ${Math.round(mm * PPM)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    const headerMM = binder.name ? 11 : 0;
    const availW = A4W - MARGIN * 2;
    const availH = A4H - MARGIN * 2 - headerMM;
    const gridWmm = g.cols * CWmm + (g.cols - 1) * GAPmm;
    const gridHmm = g.rows * CHmm + (g.rows - 1) * GAPmm;
    const fit = Math.min(1, availW / gridWmm, availH / gridHmm);
    const CARD_W = CWmm * fit * PPM, CARD_H = CHmm * fit * PPM, GAP = GAPmm * fit * PPM;
    const radius = 3 * fit * PPM;

    const width = Math.round(A4W * PPM);
    const height = Math.round(A4H * PPM);
    const gridW = g.cols * CARD_W + (g.cols - 1) * GAP;
    const gridH = g.rows * CARD_H + (g.rows - 1) * GAP;
    const startX = (width - gridW) / 2;
    const topArea = (MARGIN + headerMM) * PPM;
    const startY = topArea + ((height - topArea - MARGIN * PPM) - gridH) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    // Fundo branco
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    // Título (texto escuro, pouca tinta)
    if (binder.name) {
      ctx.fillStyle = "#111111";
      ctx.font = fnt(6.5, 700);
      ctx.textBaseline = "top";
      ctx.fillText(binder.name, MARGIN * PPM, MARGIN * PPM, width - MARGIN * 2 * PPM);
    }

    // Exporta a página atual do binder.
    const exportOffset = currentPage(binder) * slotCount(binder.grid);
    const lineW = Math.max(1, 0.3 * PPM);
    for (let i = 0; i < g.cols * g.rows; i++) {
      const col = i % g.cols;
      const row = Math.floor(i / g.cols);
      const x = startX + col * (CARD_W + GAP);
      const y = startY + row * (CARD_H + GAP);
      const slot = binder.slots[exportOffset + i];

      if (slot) {
        ctx.save();
        roundRect(ctx, x, y, CARD_W, CARD_H, radius);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.clip();

        // Preto e branco para cartas (de coleção) que você não tem.
        const grayscale = !isSale && !!slot.cardId && !ownedStore.has(slot.cardId);
        let img = null;
        if (slot.photoId) {
          img = await loadImage(await photoURL(slot.photoId), false);
        } else if (slot.image) {
          img = await loadImage(slot.image, true);
          if (!img && slot.fallback) img = await loadImage(slot.fallback, true);
        }
        if (img) {
          if (grayscale) ctx.filter = "grayscale(1)";
          drawCover(ctx, img, x, y, CARD_W, CARD_H);
          ctx.filter = "none";
        } else {
          ctx.fillStyle = "#555555";
          ctx.font = fnt(3.2, 600);
          ctx.textBaseline = "middle";
          ctx.textAlign = "center";
          const text = slot.cardId ? cardLabelFromSlot(slot) : (slot.label || "");
          ctx.fillText(text.slice(0, 22), x + CARD_W / 2, y + CARD_H / 2, CARD_W - 20);
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
        }
        // Faixa de preço (venda) — fundo claro, texto escuro.
        if (isSale && Number(slot.price)) {
          const barH = 5 * PPM * fit;
          ctx.fillStyle = "rgba(255,255,255,0.92)";
          ctx.fillRect(x, y + CARD_H - barH, CARD_W, barH);
          ctx.fillStyle = "#111111";
          ctx.font = fnt(3, 700);
          ctx.textBaseline = "middle";
          ctx.fillText(`R$ ${fmtPrice(slot.price)}${slot.condition ? `  ${slot.condition}` : ""}`, x + 8, y + CARD_H - barH / 2, CARD_W - 16);
          ctx.textBaseline = "top";
        }
        ctx.restore();
        // Contorno leve da carta.
        ctx.save();
        roundRect(ctx, x, y, CARD_W, CARD_H, radius);
        ctx.strokeStyle = "#cccccc";
        ctx.lineWidth = lineW;
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.save();
        roundRect(ctx, x + 1, y + 1, CARD_W - 2, CARD_H - 2, radius);
        ctx.strokeStyle = "#dddddd";
        ctx.lineWidth = lineW;
        ctx.setLineDash([8, 8]);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Rodapé / marca (cinza claro)
    ctx.fillStyle = "#999999";
    ctx.font = fnt(2.6, 400);
    ctx.textBaseline = "alphabetic";
    ctx.fillText("TCG Collector", MARGIN * PPM, height - MARGIN * PPM);

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
    isSale = isSaleBinder(binder);
    const label = button ? button.textContent : "";
    if (button) { button.disabled = true; button.textContent = "…"; }
    const esc = escapeHtml;
    try {
      await ensureCatalog();
      const g = GRIDS[binder.grid] || GRIDS[DEFAULT_GRID];
      const per = slotCount(binder.grid);
      let body = "";
      let extraStyles = "";
      let showHeader = true;
      // Grade em "tamanho real": A4 retrato com cartas a 63×88mm (tamanho real
      // de carta), uma página de binder por folha. Salvar como PDF no diálogo
      // de impressão dá o tamanho exato. Grades grandes (4×4/5×5) que não cabem
      // no A4 são reduzidas proporcionalmente para caber.
      const realGrid = layout === "grid" && opts.realSize !== false;

      if (realGrid) {
        showHeader = false;
        const CW = 63, CH = 88, GAP = 2, PW = 198, PH = 285; // mm (A4 menos margem 6mm)
        const gw = g.cols * CW + (g.cols - 1) * GAP;
        const gh = g.rows * CH + (g.rows - 1) * GAP;
        const s = Math.min(1, PW / gw, PH / gh);
        const cw = (CW * s).toFixed(2), ch = (CH * s).toFixed(2), gp = (GAP * s).toFixed(2);
        for (let p = 0; p < pageCount(binder); p++) {
          const resolved = await Promise.all(binder.slots.slice(p * per, p * per + per).map(resolveSlotForPrint));
          const cells = resolved.map((item) => {
            if (!item) return `<div class="card empty"></div>`;
            if (item.img) return `<div class="card"><img src="${escapeAttribute(item.img)}" alt=""></div>`;
            return `<div class="card"><span class="freelbl">${esc(item.name)}</span></div>`;
          }).join("");
          body += `<section class="sheet"><div class="rgrid">${cells}</div></section>`;
        }
        extraStyles = `
          @page { size: A4 portrait; margin: 6mm; }
          html, body { margin: 0; }
          .sheet { display: flex; align-items: center; justify-content: center; break-after: page; }
          .sheet:last-child { break-after: auto; }
          .rgrid { display: grid; grid-template-columns: repeat(${g.cols}, ${cw}mm); grid-auto-rows: ${ch}mm; gap: ${gp}mm; }
          .rgrid .card { width: ${cw}mm; height: ${ch}mm; overflow: hidden; border-radius: 2.5mm; }
          .rgrid .card img { width: 100%; height: 100%; object-fit: cover; display: block; }
          .rgrid .card.empty { border: 0.3mm dashed #bbb; }
          .rgrid .freelbl { display: flex; align-items: center; justify-content: center; height: 100%; font-size: 9pt; text-align: center; padding: 2mm; color: #333; }
        `;
      } else if (layout === "grid") {
        for (let p = 0; p < pageCount(binder); p++) {
          const resolved = await Promise.all(binder.slots.slice(p * per, p * per + per).map(resolveSlotForPrint));
          const cells = resolved.map((item) => {
            if (!item) return `<div class="cell empty"></div>`;
            const img = opts.images && item.img ? `<img src="${escapeAttribute(item.img)}" alt="">` : "";
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
            const img = opts.images && item.img ? `<img src="${escapeAttribute(item.img)}" alt="">` : "";
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
        @media print { ${layout === "grid" && !realGrid ? ".page { break-after: page; }" : ""} }
        ${extraStyles}
      `;
      const header = showHeader
        ? `<h1>${esc(binder.name || "")}</h1>${binder.description ? `<p class="desc">${esc(binder.description)}</p>` : ""}`
        : "";
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(binder.name || "Binder")}</title><style>${styles}</style></head><body>${header}${body}</body></html>`;

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
  if (elements.typeSelect) {
    elements.typeSelect.innerHTML = `<option value="collection">${escapeHtml(t("binders.type.collection"))}</option><option value="sale">${escapeHtml(t("binders.type.sale"))}</option>`;
  }
  if (elements.templateSelect) {
    elements.templateSelect.innerHTML =
      `<option value="">${escapeHtml(t("binders.template.none"))}</option>` +
      Object.entries(TEMPLATES).map(([k, v]) => `<option value="${k}">${escapeHtml(t(v.labelKey))}</option>`).join("");
  }
  if (elements.sortSelect) {
    elements.sortSelect.innerHTML = [["newest", "binders.sort.newest"], ["name", "binders.sort.name"], ["cards", "binders.sort.cards"]]
      .map(([v, k]) => `<option value="${v}"${v === gallerySort ? " selected" : ""}>${escapeHtml(t(k))}</option>`).join("");
  }

  if (elements.createButton) {
    elements.createButton.addEventListener("click", () => {
      const name = (elements.nameInput.value || "").trim() || t("binders.new");
      const grid = elements.gridSelect.value || DEFAULT_GRID;
      const type = elements.typeSelect ? elements.typeSelect.value : "collection";
      const binder = createBinder(name, grid, type);
      const template = elements.templateSelect ? elements.templateSelect.value : "";
      if (template) applyTemplate(binder, template);
      elements.nameInput.value = "";
      // Abre o binder recém-criado direto.
      window.location.href = `binders.html?id=${encodeURIComponent(binder.id)}`;
    });
  }
  if (elements.nameInput) {
    elements.nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") elements.createButton.click();
    });
  }

  // Galeria: abrir / duplicar / excluir + alternar visualização e ordenação.
  if (elements.galleryGrid) {
    elements.galleryGrid.addEventListener("click", (event) => {
      const dup = event.target.closest("[data-duplicate-id]");
      if (dup) { event.stopPropagation(); duplicateBinder(dup.dataset.duplicateId).then(render); return; }
      const del = event.target.closest("[data-delete-id]");
      if (del) { event.stopPropagation(); if (confirm(t("binders.deleteConfirm"))) { removeBinder(del.dataset.deleteId); render(); } return; }
      const open = event.target.closest("[data-open-id]");
      if (open) { window.location.href = `binders.html?id=${encodeURIComponent(open.dataset.openId)}`; }
    });
  }
  if (elements.viewToggle) {
    elements.viewToggle.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-view]");
      if (!btn) return;
      galleryView = btn.dataset.view === "list" ? "list" : "grid";
      localStorage.setItem("tcg-collector-binder-view", galleryView);
      renderGallery();
    });
  }
  if (elements.sortSelect) {
    elements.sortSelect.addEventListener("change", () => {
      gallerySort = elements.sortSelect.value;
      localStorage.setItem("tcg-collector-binder-sort", gallerySort);
      renderGallery();
    });
  }

  // Delegação na lista de binders
  elements.list.addEventListener("click", (event) => {
    // Marcar tenho/não tenho (no hover do slot): tem precedência sobre abrir o
    // editor. Marcar como não tenho coloca a carta na lista de desejo.
    const ownToggle = event.target.closest("[data-slot-own]");
    if (ownToggle) {
      event.stopPropagation();
      const binder = eventBinder(ownToggle);
      const slot = binder && binder.slots[Number(ownToggle.dataset.slotOwn)];
      if (slot && slot.cardId) {
        const variant = slot.variant || DEFAULT_CONDITION;
        const had = ownedStore.variantTotal(slot.cardId, variant) > 0;
        ownedStore.toggleVariant(slot.cardId, variant);
        if (had) {
          // passou a NÃO ter → entra na lista de desejo (se ainda não estiver).
          if (!wishlistStore.has(slot.cardId, variant)) wishlistStore.toggle(slot.cardId, variant);
        } else {
          // passou a ter → sai da lista de desejo.
          wishlistStore.remove(slot.cardId, variant);
        }
        render();
      }
      return;
    }
    // Coração: adiciona/remove da lista de desejo, sem mexer na posse.
    const wantToggle = event.target.closest("[data-slot-want]");
    if (wantToggle) {
      event.stopPropagation();
      const binder = eventBinder(wantToggle);
      const slot = binder && binder.slots[Number(wantToggle.dataset.slotWant)];
      if (slot && slot.cardId) {
        wishlistStore.toggle(slot.cardId, slot.variant || DEFAULT_CONDITION);
        render();
      }
      return;
    }
    const slotBtn = event.target.closest("[data-slot-index]");
    if (slotBtn) {
      const article = slotBtn.closest("[data-binder-id]");
      openEditor(article.dataset.binderId, Number(slotBtn.dataset.slotIndex));
      return;
    }
    // Navegação de páginas
    const pagePrev = event.target.closest("[data-page-prev]");
    if (pagePrev) {
      const binder = eventBinder(pagePrev);
      // Navega por pares de páginas (o par começa sempre num índice par).
      if (binder) { const p = currentPage(binder); setCurrentPage(binder, (p - (p % 2)) - 2); render(); }
      return;
    }
    const pageNext = event.target.closest("[data-page-next]");
    if (pageNext) {
      const binder = eventBinder(pageNext);
      if (binder) { const p = currentPage(binder); setCurrentPage(binder, (p - (p % 2)) + 2); render(); }
      return;
    }
    const pageAdd = event.target.closest("[data-page-add]");
    if (pageAdd) {
      const binder = eventBinder(pageAdd);
      if (binder) { addPage(binder); render(); }
      return;
    }
    const pageRemove = event.target.closest("[data-page-remove]");
    if (pageRemove) {
      const binder = eventBinder(pageRemove);
      if (binder && confirm(t("binders.page.removeConfirm"))) { removePage(binder, currentPage(binder)); render(); }
      return;
    }
    // Troca de aba (Cartas | Resumo | Editar | Imprimir).
    const tabBtn = event.target.closest("[data-binder-tab-btn]");
    if (tabBtn) {
      const binder = eventBinder(tabBtn);
      if (binder) { setTab(binder, tabBtn.dataset.binderTabBtn); render(); }
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
      const binder = eventBinder(markBtn);
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
        window.location.href = "binders.html"; // volta para a galeria
      }
    }
  });

  elements.list.addEventListener("change", (event) => {
    const gridSelect = event.target.closest("[data-binder-grid]");
    if (gridSelect) {
      const binder = eventBinder(gridSelect);
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
      const binder = eventBinder(renameInput);
      if (binder) { binder.name = renameInput.value.trim() || t("binders.new"); binder.updatedAt = Date.now(); save(); }
      return;
    }
    const subtitleInput = event.target.closest("[data-binder-subtitle]");
    if (subtitleInput) {
      const binder = eventBinder(subtitleInput);
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
    if (tabBtn) { editing.tab = tabBtn.dataset.editTab; renderEditor(); if (editing.tab !== "free") renderSearchResults(editing.query || ""); return; }
    const result = event.target.closest("[data-result-id]");
    if (result) { selectCard(result.dataset.resultId); return; }
  });

  const onSearchInput = debounce((value) => renderSearchResults(value), 180);
  document.addEventListener("input", (event) => {
    if (!editing) return;
    const search = event.target.closest("[data-edit-search]");
    if (search) { editing.query = search.value; onSearchInput(search.value); }
  });

  document.addEventListener("change", (event) => {
    if (!editing) return;
    const sortSel = event.target.closest("[data-edit-sort]");
    if (sortSel) { editing.sort = sortSel.value; renderSearchResults(editing.query || ""); return; }
    const photoInput = event.target.closest("[data-edit-photo]");
    if (photoInput && photoInput.files && photoInput.files[0]) {
      handlePhotoUpload(photoInput.files[0]);
      photoInput.value = "";
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && editing) closeEditor();
  });

  // Botão "Salvar binder": os dados já são salvos automaticamente, mas isto dá
  // a confirmação explícita de que está tudo registrado.
  const saveBtn = document.getElementById("binderSaveBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      save();
      const original = t("binders.save");
      saveBtn.textContent = t("binders.saved");
      saveBtn.disabled = true;
      setTimeout(() => { saveBtn.textContent = original; saveBtn.disabled = false; }, 1500);
    });
  }

  // Botão "Compartilhar": publica o binder aberto na nuvem e copia o link.
  const shareBtn = document.getElementById("binderShareBtn");
  if (shareBtn) {
    shareBtn.addEventListener("click", async () => {
      const binder = openId ? getBinder(openId) : null;
      if (!binder) return;
      const original = t("binders.share");
      shareBtn.disabled = true; shareBtn.textContent = t("binders.share.creating");
      const res = await shared.createShare("binder", binder.name, binder);
      shareBtn.disabled = false;
      if (res && res.id) {
        const link = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}binders.html?s=${res.id}`;
        try { await navigator.clipboard.writeText(link); shareBtn.textContent = t("binders.share.copied"); }
        catch (e) { window.prompt(t("binders.share.copyManual"), link); shareBtn.textContent = original; }
      } else {
        alert(res && res.error === "auth" ? t("binders.share.needLogin") : t("binders.share.error"));
        shareBtn.textContent = original;
      }
      setTimeout(() => { shareBtn.textContent = original; }, 2500);
    });
  }

  if (shareId) {
    renderSharedView(shareId);
  } else {
    if (shareBtn) shareBtn.hidden = !openId; // só faz sentido com um binder aberto
    render();
    // Com o câmbio carregado, re-renderiza para preencher os valores em moeda.
    shared.loadFxRates().then(() => render());
  }

  // --- Binder compartilhado (somente leitura, vindo da nuvem) ---
  function sharedSlotHtml(slot) {
    if (!slot) return `<div class="binder-slot binder-slot-empty" aria-hidden="true"></div>`;
    if (slot.template) {
      return `<div class="binder-slot binder-slot-template">
        <img class="binder-slot-sprite" src="${escapeAttribute(slot.image || "")}" alt="" loading="lazy">
        <span class="binder-slot-tplname">${escapeHtml(slot.name || "")}</span>
      </div>`;
    }
    const title = slot.cardId ? cardLabelFromSlot(slot) : (slot.label || "");
    const media = slot.image
      ? localizedImg(slot.image, { className: "binder-slot-img", alt: title, fallback: slot.fallback || "", loading: "lazy" })
      : `<span class="binder-slot-free">${escapeHtml(title || "—")}</span>`;
    return `<div class="binder-slot binder-slot-filled" title="${escapeAttribute(title)}">${media}</div>`;
  }
  // Mesmo layout do "fichário aberto" editável: páginas em pares lado a lado
  // (ou uma centralizada), pra qualquer formato. Aqui mostra todos os pares.
  function sharedSpreadsHtml(binder) {
    const g = GRIDS[binder.grid] || GRIDS[DEFAULT_GRID];
    const per = slotCount(binder.grid);
    const pages = Math.max(1, binder.pages || Math.ceil((binder.slots || []).length / per));
    const pageBlock = (p) => {
      const s = p * per;
      const cells = (binder.slots || []).slice(s, s + per).map(sharedSlotHtml).join("");
      return `<div class="binder-page">
        <div class="binder-page-cap">${escapeHtml(t("binders.page.indicator", { n: p + 1, total: pages }))}</div>
        <div class="binder-grid" style="--cols:${g.cols}">${cells}</div>
      </div>`;
    };
    let out = "";
    for (let p = 0; p < pages; p += 2) {
      out += (p + 1 < pages)
        ? `<div class="binder-spread">${pageBlock(p)}<div class="binder-spread-divider" aria-hidden="true"></div>${pageBlock(p + 1)}</div>`
        : `<div class="binder-spread is-single">${pageBlock(p)}</div>`;
    }
    return out;
  }
  async function renderSharedView(id) {
    elements.gallery.hidden = true;
    elements.detail.hidden = false;
    if (shareBtn) shareBtn.hidden = true;
    const saveBtn = document.getElementById("binderSaveBtn");
    if (saveBtn) saveBtn.hidden = true;
    elements.list.innerHTML = `<p class="empty-state">${escapeHtml(t("binders.shared.loading"))}</p>`;
    const share = await shared.fetchShare(id);
    if (!share || share.kind !== "binder" || !share.data || !Array.isArray(share.data.slots)) {
      elements.list.innerHTML = `<p class="empty-state">${escapeHtml(t("binders.shared.notFound"))}</p>`;
      return;
    }
    const binder = share.data;
    const filled = binder.slots.filter((s) => s && !s.template).length;
    elements.list.innerHTML = `
      <div class="binder-shared-banner">
        <div class="binder-shared-info">
          <strong>${escapeHtml(binder.name || share.title || "Binder")}</strong>
          <span>${escapeHtml(t("binders.shared.banner", { n: filled }))}</span>
        </div>
        <a class="primary" href="binders.html">${escapeHtml(t("binders.shared.cta"))}</a>
      </div>
      ${sharedSpreadsHtml(binder)}`;
  }
})();
