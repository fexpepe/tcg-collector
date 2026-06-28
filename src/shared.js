(function () {
  // Escrita coalescida no localStorage: várias mutações em sequência (ex.: vários
  // cliques no stepper +/−) viram UM único JSON.stringify + setItem, agendado para
  // o fim do task. Sempre faz flush no pagehide/aba oculta para não perder dado se
  // a página for fechada antes do timer disparar.
  const pendingWrites = new Map(); // storageKey -> () => string
  let writeScheduled = false;
  let dataWiped = false; // após "apagar dados": não regrava nada (nem no pagehide)
  function flushWrites() {
    writeScheduled = false;
    if (dataWiped) { pendingWrites.clear(); return; }
    pendingWrites.forEach((getString, key) => {
      try { localStorage.setItem(key, getString()); } catch (error) { /* quota cheia: ignora */ }
    });
    pendingWrites.clear();
  }
  function scheduleWrite(key, getString) {
    pendingWrites.set(key, getString);
    if (!writeScheduled) {
      writeScheduled = true;
      setTimeout(flushWrites, 250);
    }
  }
  window.addEventListener("pagehide", flushWrites);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushWrites(); });

  // ── Dados POR JOGO ─────────────────────────────────────────────────────────
  // Site único (sleevu.app): Pokémon e Lorcana dividem o MESMO localStorage, então
  // coleção/wishlist/preços/binders/histórico de cada jogo precisam de prefixo do
  // jogo. Prefs GLOBAIS (tema, idioma, moeda, câmbio, sessão de login) NÃO usam.
  function currentGameSlug() {
    const g = (window.SLEEVU && window.SLEEVU.game) || "pokemon";
    return g === "hub" ? "pokemon" : g; // hub não tem dados próprios
  }
  // `game` opcional: por padrão usa o jogo da sessão. As páginas unificadas
  // (Coleção/Wishlist/Binders) passam o jogo explícito pra ler os dois.
  function gameKey(base, game) {
    const g = game || currentGameSlug();
    return "tcg-collector-" + (g === "hub" ? "pokemon" : g) + "-" + base;
  }

  // Migração one-time: dados antigos (sem prefixo de jogo, de quando o app rodava
  // só Pokémon nesta origem) passam pro namespace do Pokémon, sem apagar o
  // original. Roda uma vez por navegador.
  (function migrateLegacyGameKeys() {
    try {
      if (localStorage.getItem("tcg-collector-ns-migrated-v1")) return;
      [
        ["tcg-collector-collection-v3",      "tcg-collector-pokemon-collection-v3"],
        ["tcg-collector-collection-meta-v1", "tcg-collector-pokemon-collection-meta-v1"],
        ["tcg-collector-collection-v2",      "tcg-collector-pokemon-collection-v2"],
        ["tcg-collector-owned-v1",           "tcg-collector-pokemon-owned-v1"],
        ["tcg-collector-wishlist-v1",        "tcg-collector-pokemon-wishlist-v1"],
        ["tcg-collector-wishlist-meta-v1",   "tcg-collector-pokemon-wishlist-meta-v1"],
        ["tcg-collector-prices-v1",          "tcg-collector-pokemon-prices-v1"],
        ["tcg-collector-binders-v1",         "tcg-collector-pokemon-binders-v1"],
        ["tcg-portfolio-history-v1",         "tcg-collector-pokemon-history-v1"]
      ].forEach((pair) => {
        const old = localStorage.getItem(pair[0]);
        if (old != null && localStorage.getItem(pair[1]) == null) localStorage.setItem(pair[1], old);
      });
      localStorage.setItem("tcg-collector-ns-migrated-v1", "1");
    } catch (e) { /* storage bloqueado: ignora */ }
  })();

  // ── PWA (instalar na tela inicial) ────────────────────────────────────────
  // Captura o prompt de instalação cedo (Android/desktop disparam beforeinstall-
  // prompt). Guardamos pra um botão próprio no menu de conta. iOS não tem o
  // evento — lá mostramos a dica de "Compartilhar → Adicionar à Tela de Início".
  let deferredInstallPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    document.dispatchEvent(new CustomEvent("sleevu:installable"));
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    document.dispatchEvent(new CustomEvent("sleevu:installable"));
  });
  function isIOSDevice() { return /iphone|ipad|ipod/i.test(navigator.userAgent || ""); }
  function isStandalonePWA() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  }
  // Mostra o botão quando dá pra instalar: tem o prompt (Android/desktop) ou é
  // iOS (dica manual) — e o app ainda não está instalado/aberto em standalone.
  function canInstallPWA() { return !isStandalonePWA() && (!!deferredInstallPrompt || isIOSDevice()); }

  function createIdStore(storageKey, metaKey) {
    let ids = load();

    function load() {
      try {
        return new Set(JSON.parse(localStorage.getItem(storageKey) || "[]"));
      } catch (error) {
        return new Set();
      }
    }

    function save() {
      scheduleWrite(storageKey, () => JSON.stringify(Array.from(ids)));
      // Carimba o updatedAt (meta) pra o sync resolver por LWW — assim
      // desfavoritar também propaga (e não só somar, como na união).
      if (metaKey) scheduleWrite(metaKey, () => JSON.stringify({ updatedAt: Date.now() }));
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

  // Condições no padrão LigaPokémon (melhor -> pior). NM é o default ao adicionar.
  const CARD_CONDITIONS = ["M", "NM", "SP", "MP", "HP", "D"];
  const DEFAULT_CONDITION = "NM";

  // Desconto padrão sobre o preço NM quando a condição não tem preço próprio
  // (aproximação usual do mercado; o valor exato sempre pode ser digitado).
  const CONDITION_MULTIPLIERS = { M: 1, NM: 1, SP: 0.85, MP: 0.7, HP: 0.5, D: 0.3 };

  // Coleção v3: cardId -> variante -> condição -> quantidade. Cada cópia é
  // distinguida por condição (para o futuro cálculo de valor do portfólio).
  // Migra do v2 (cardId -> variante -> quantidade; cópias viram NM) e do v1.
  function createCollectionStore(game) {
    const storageKey = gameKey("collection-v3", game);
    const metaKey = gameKey("collection-meta-v1", game);
    const v2Key = gameKey("collection-v2", game);
    const v1Key = gameKey("owned-v1", game);
    let collection = load();
    let initialized = collection !== null;
    if (!initialized) collection = {};
    // Timestamps por carta para o sync resolver exclusões (LWW + tombstone):
    // mod[id] = última vez que a carta passou a existir/foi editada; del[id] =
    // última vez que foi removida. Sem isso, o merge "máximo" ressuscitava cartas
    // apagadas em outro dispositivo. Ver mergeCollection.
    let meta = normalizeMeta(readObject(metaKey));

    function load() {
      try {
        const parsed = JSON.parse(localStorage.getItem(storageKey) || "null");
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
      } catch (error) {
        return null;
      }
    }

    function persistMeta() {
      scheduleWrite(metaKey, () => JSON.stringify(meta));
    }
    // Carimba o estado atual da carta: presente -> mod=agora; ausente -> del=agora.
    function stamp(cardId) {
      const now = Date.now();
      if (totalForCard(cardId) > 0) { meta.mod[cardId] = now; delete meta.del[cardId]; }
      else { meta.del[cardId] = now; delete meta.mod[cardId]; }
      persistMeta();
    }

    function save() {
      initialized = true;
      scheduleWrite(storageKey, () => JSON.stringify(collection));
    }

    function variantTotal(cardId, variant) {
      const conditions = collection[cardId] && collection[cardId][variant];
      if (!conditions) return 0;
      return Object.values(conditions).reduce((sum, qty) => sum + qty, 0);
    }

    function totalForCard(cardId) {
      const entry = collection[cardId];
      if (!entry) return 0;
      return Object.keys(entry).reduce((sum, variant) => sum + variantTotal(cardId, variant), 0);
    }

    function cleanup(cardId, variant) {
      const entry = collection[cardId];
      if (!entry) return;
      if (entry[variant] && Object.keys(entry[variant]).length === 0) delete entry[variant];
      if (Object.keys(entry).length === 0) delete collection[cardId];
    }

    return {
      // Migra v2/v1 para v3 uma única vez (cópias antigas entram como NM).
      migrateLegacy(getDefaultVariant) {
        if (initialized) return;
        const v2 = readObject(v2Key);
        if (v2) {
          Object.entries(v2).forEach(([cardId, variants]) => {
            Object.entries(variants).forEach(([variant, qty]) => {
              const quantity = Math.floor(Number(qty));
              if (quantity > 0) {
                collection[cardId] = collection[cardId] || {};
                collection[cardId][variant] = { [DEFAULT_CONDITION]: quantity };
              }
            });
          });
        } else {
          let legacyIds = [];
          try {
            legacyIds = JSON.parse(localStorage.getItem(v1Key) || "[]");
          } catch (error) {
            legacyIds = [];
          }
          if (Array.isArray(legacyIds)) {
            legacyIds.forEach((cardId) => {
              collection[cardId] = { [getDefaultVariant(cardId)]: { [DEFAULT_CONDITION]: 1 } };
            });
          }
        }
        const now = Date.now();
        Object.keys(collection).forEach((id) => { meta.mod[id] = now; });
        persistMeta();
        save();
      },
      has(cardId) {
        return totalForCard(cardId) > 0;
      },
      get size() {
        return Object.keys(collection).filter((cardId) => totalForCard(cardId) > 0).length;
      },
      getQuantity(cardId, variant, condition) {
        return (collection[cardId] && collection[cardId][variant] && collection[cardId][variant][condition]) || 0;
      },
      variantTotal,
      totalForCard,
      totalQuantity() {
        return Object.keys(collection).reduce((sum, cardId) => sum + totalForCard(cardId), 0);
      },
      // Detalhamento por condição de uma variante: [{ condition, quantity }].
      conditionBreakdown(cardId, variant) {
        const conditions = (collection[cardId] && collection[cardId][variant]) || {};
        return CARD_CONDITIONS
          .filter((condition) => conditions[condition] > 0)
          .map((condition) => ({ condition, quantity: conditions[condition] }));
      },
      add(cardId, variant, condition, delta) {
        const entry = collection[cardId] || (collection[cardId] = {});
        const conditions = entry[variant] || (entry[variant] = {});
        const quantity = Math.max(0, (conditions[condition] || 0) + delta);
        if (quantity > 0) {
          conditions[condition] = quantity;
        } else {
          delete conditions[condition];
        }
        cleanup(cardId, variant);
        stamp(cardId);
        save();
      },
      // Liga/desliga a variante inteira a partir do tile: adiciona 1 NM se vazia,
      // ou remove todas as condições daquela variante.
      toggleVariant(cardId, variant) {
        if (variantTotal(cardId, variant) > 0) {
          if (collection[cardId]) delete collection[cardId][variant];
          cleanup(cardId, variant);
        } else {
          collection[cardId] = collection[cardId] || {};
          collection[cardId][variant] = { [DEFAULT_CONDITION]: 1 };
        }
        stamp(cardId);
        save();
      },
      toggle(card) {
        if (this.has(card.id)) {
          delete collection[card.id];
        } else {
          collection[card.id] = { [defaultVariant(card)]: { [DEFAULT_CONDITION]: 1 } };
        }
        stamp(card.id);
        save();
      },
      replace(newCollection) {
        collection = newCollection && typeof newCollection === "object" ? newCollection : {};
        // Importação/restauração: tudo que veio passa a existir "agora" (zera
        // tombstones antigos pra não reapagar o que o usuário acabou de importar).
        const now = Date.now();
        meta = { mod: {}, del: {} };
        Object.keys(collection).forEach((id) => { meta.mod[id] = now; });
        persistMeta();
        save();
      },
      toObject() {
        return collection;
      },
      // Ids referenciados (v3, ou legados v2/v1) sem disparar a migração. Usado
      // para a carga direcionada de catálogo antes de ter o catálogo em mãos.
      knownCardIds() {
        if (Object.keys(collection).length) return Object.keys(collection);
        const v2 = readObject(v2Key);
        if (v2) return Object.keys(v2);
        try {
          const v1 = JSON.parse(localStorage.getItem(v1Key) || "[]");
          return Array.isArray(v1) ? v1 : [];
        } catch (error) {
          return [];
        }
      }
    };
  }

  function readObject(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  // Meta de sync ({ mod: {id: ts}, del: {id: ts} }): garante o formato.
  function normalizeMeta(raw) {
    const m = raw && typeof raw === "object" ? raw : {};
    return {
      mod: m.mod && typeof m.mod === "object" && !Array.isArray(m.mod) ? m.mod : {},
      del: m.del && typeof m.del === "object" && !Array.isArray(m.del) ? m.del : {}
    };
  }

  function createFavoritesStore() {
    return createIdStore("tcg-collector-favorites-v1", "tcg-collector-favorites-meta-v1");
  }

  // Lista "Eu quero": cardId -> [variantes desejadas]. Sem condição nem
  // quantidade — é só uma lista de desejos por variante, guardada à parte da
  // coleção. Quando a carta passa a ser possuída, ela sai daqui ("comprei!").
  function createWishlistStore(game) {
    const storageKey = gameKey("wishlist-v1", game);
    const metaKey = gameKey("wishlist-meta-v1", game);
    let wishlist = readObject(storageKey) || {};
    // Mesma meta de sync da coleção (mod/del por carta) — ver mergeWishlist.
    let meta = normalizeMeta(readObject(metaKey));

    function save() {
      scheduleWrite(storageKey, () => JSON.stringify(wishlist));
    }
    function persistMeta() {
      scheduleWrite(metaKey, () => JSON.stringify(meta));
    }
    function stamp(cardId) {
      const now = Date.now();
      if (variantsOf(cardId).length > 0) { meta.mod[cardId] = now; delete meta.del[cardId]; }
      else { meta.del[cardId] = now; delete meta.mod[cardId]; }
      persistMeta();
    }
    function variantsOf(cardId) {
      const list = wishlist[cardId];
      return Array.isArray(list) ? list : [];
    }
    function setVariants(cardId, list) {
      if (list.length) wishlist[cardId] = list;
      else delete wishlist[cardId];
    }

    return {
      has(cardId, variant) {
        return variantsOf(cardId).includes(variant);
      },
      hasCard(cardId) {
        return variantsOf(cardId).length > 0;
      },
      variants: variantsOf,
      get size() {
        return Object.keys(wishlist).filter((id) => variantsOf(id).length > 0).length;
      },
      toggle(cardId, variant) {
        const list = variantsOf(cardId).slice();
        const idx = list.indexOf(variant);
        if (idx >= 0) list.splice(idx, 1);
        else list.push(variant);
        setVariants(cardId, list);
        stamp(cardId);
        save();
        return list.includes(variant);
      },
      remove(cardId, variant) {
        setVariants(cardId, variantsOf(cardId).filter((entry) => entry !== variant));
        stamp(cardId);
        save();
      },
      replace(next) {
        wishlist = next && typeof next === "object" && !Array.isArray(next) ? next : {};
        const now = Date.now();
        meta = { mod: {}, del: {} };
        Object.keys(wishlist).forEach((id) => { meta.mod[id] = now; });
        persistMeta();
        save();
      },
      toObject() {
        return wishlist;
      },
      // Ids desejados (para a carga direcionada de catálogo).
      knownCardIds() {
        return Object.keys(wishlist);
      }
    };
  }

  // Preços BR por carta/variante: cardId -> variante -> { prices: { NM: 12.5 },
  // source: "manual", updatedAt: ISO }. Valores em R$. A fonte fica registrada
  // para o futuro preenchimento automático (worker LigaBRA/Liga) — que grava
  // nos mesmos campos e continua editável.
  function createPriceStore(game) {
    const storageKey = gameKey("prices-v1", game);
    let prices = readObject(storageKey) || {};

    function save() {
      scheduleWrite(storageKey, () => JSON.stringify(prices));
    }
    function entryOf(cardId, variant) {
      return (prices[cardId] && prices[cardId][variant]) || null;
    }

    return {
      entry: entryOf,
      getPrice(cardId, variant, condition) {
        const entry = entryOf(cardId, variant);
        return (entry && entry.prices && entry.prices[condition]) || 0;
      },
      // Valor de uma cópia: preço exato da condição se existir, senão estima a
      // partir do NM com o desconto padrão. { value, estimated }.
      valueFor(cardId, variant, condition) {
        const entry = entryOf(cardId, variant);
        if (!entry || !entry.prices) return { value: 0, estimated: false };
        const exact = entry.prices[condition];
        if (exact > 0) return { value: exact, estimated: false };
        const nm = entry.prices[DEFAULT_CONDITION];
        if (nm > 0) return { value: nm * (CONDITION_MULTIPLIERS[condition] || 1), estimated: true };
        return { value: 0, estimated: false };
      },
      setPrice(cardId, variant, condition, value, source) {
        const amount = Number(value);
        const card = prices[cardId] || (prices[cardId] = {});
        const entry = card[variant] || (card[variant] = { prices: {}, source: source || "manual", updatedAt: "" });
        if (amount > 0) {
          entry.prices[condition] = Math.round(amount * 100) / 100;
        } else {
          delete entry.prices[condition];
        }
        entry.source = source || "manual";
        entry.updatedAt = new Date().toISOString().slice(0, 10);
        if (!Object.keys(entry.prices).length) {
          delete card[variant];
          if (!Object.keys(card).length) delete prices[cardId];
        }
        save();
      },
      replace(next) {
        prices = next && typeof next === "object" && !Array.isArray(next) ? next : {};
        save();
      },
      toObject() {
        return prices;
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Idioma do site: controla os textos da interface e o idioma das imagens das
  // cartas (assets da TCGdex levam o idioma na URL; se a imagem não existir no
  // idioma escolhido, um onerror volta para a URL original do catálogo).
  // ---------------------------------------------------------------------------
  const UI_LANGUAGES = [
    { code: "pt", label: "Português (BR)", htmlLang: "pt-BR", locale: "pt-BR" },
    { code: "en", label: "English", htmlLang: "en", locale: "en-US" }
  ];
  const languageStorageKey = "tcg-collector-ui-lang-v1";
  const currentLanguage = (function () {
    const saved = localStorage.getItem(languageStorageKey);
    return UI_LANGUAGES.some((entry) => entry.code === saved) ? saved : "pt";
  })();
  const currentLanguageMeta = UI_LANGUAGES.find((entry) => entry.code === currentLanguage);

  // Idioma das CARTAS (separado do idioma da interface). "all" = todas; ou um
  // código de idioma de carta (pt/en/ja/zh-tw). É o eixo padrão das listas e do
  // progresso — quem coleciona em PT vê e conta só PT, sem o ruído das 4 línguas.
  const CARD_LANGUAGES = ["pt", "en", "ja", "zh-tw"];
  const cardLangStorageKey = "tcg-collector-card-lang-v1";
  const currentCardLang = (function () {
    const saved = localStorage.getItem(cardLangStorageKey);
    return saved === "all" || CARD_LANGUAGES.includes(saved) ? saved : "all";
  })();

  function getCardLang() {
    return currentCardLang;
  }

  // Idioma de uma carta a partir do id (en não tem sufixo; demais terminam em
  // -pt / -ja / -zh-tw — o -zh do catálogo de exemplo também conta como zh-tw).
  // Usado onde só há ids (Pokédex roda só com índices, sem as cartas).
  function cardLanguageFromId(id) {
    const value = String(id || "");
    if (value.endsWith("-pt")) return "pt";
    if (value.endsWith("-ja")) return "ja";
    if (value.endsWith("-zh-tw") || value.endsWith("-zh")) return "zh-tw";
    return "en";
  }

  // Sprite pixel (~1KB) do Pokémon pela PokéAPI (liberado no CSP img-src). Usado
  // na Pokédex, nos placeholders de template e na navegação anterior/próximo.
  function spriteUrl(dexId) {
    return dexId ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${dexId}.png` : "";
  }

  function matchesCardLang(language) {
    return currentCardLang === "all" || language === currentCardLang;
  }

  // Moeda de exibição dos valores (global, ao lado da bandeira de idioma).
  const CURRENCIES = ["BRL", "USD", "EUR"];
  const currencyStorageKey = "tcg-collector-currency-v1";
  const currentCurrency = (function () {
    const saved = localStorage.getItem(currencyStorageKey);
    return CURRENCIES.includes(saved) ? saved : "BRL";
  })();
  function getCurrency() {
    return currentCurrency;
  }

  // Câmbio USD/EUR -> BRL em memória (lido do cache; atualizado por loadFxRates).
  let fxRates = (function () {
    try {
      const cached = JSON.parse(localStorage.getItem("tcg-fx-brl-v1") || "null");
      return cached && cached.r ? cached.r : null;
    } catch (error) { return null; }
  })();
  function loadFxRates() {
    return fetchFxRatesBRL().then((rates) => { if (rates) fxRates = rates; return fxRates; }).catch(() => fxRates);
  }
  // Converte um valor entre BRL/USD/EUR. Sem as taxas (1ª visita) devolve null
  // quando a conversão exige câmbio (BRL->BRL sempre funciona).
  function convertMoney(value, from, to) {
    const v = Number(value);
    if (!v) return 0;
    if (from === to) return v;
    const toBRL = from === "BRL" ? v : (fxRates && fxRates[from] ? v * fxRates[from] : null);
    if (toBRL == null) return null;
    if (to === "BRL") return toBRL;
    return (fxRates && fxRates[to]) ? toBRL / fxRates[to] : null;
  }

  // Valor de UMA cópia da carta/variante na moeda escolhida. Fonte: preço manual
  // (em R$) se houver; senão a referência de mercado da TCGdex (window.TCG_PRICING,
  // por id, em USD do TCGplayer / EUR do Cardmarket), convertida. `estimated` =
  // veio de referência ou de estimativa por condição. Retorna value 0 se nada.
  // ID base da carta sem o sufixo de idioma (-pt/-ja/-zh-tw/-zh), para buscar
  // o preço de referência internacional quando a versão localizada não tem.
  function basePricingId(cardId) {
    return String(cardId || "").replace(/-(pt|ja|zh-tw|zh)$/, "");
  }

  function cardValue(card, variant, prices, condition) {
    const cur = currentCurrency;
    const cardId = card && card.id;
    const cond = condition || DEFAULT_CONDITION;
    if (prices && cardId) {
      const manual = prices.valueFor(cardId, variant, cond);
      if (manual.value > 0) {
        const v = convertMoney(manual.value, "BRL", cur);
        if (v != null) return { value: v, currency: cur, source: "manual", estimated: manual.estimated };
      }
    }
    // Referência de mercado (USD/EUR → moeda atual). Cartas localizadas (-pt,
    // -ja, -zh-tw) sem preço próprio reaproveitam o preço da carta base — é a
    // mesma "conversão do preço americano/europeu" que vale para as brasileiras.
    const table = window.TCG_PRICING;
    const ref = cardId && table && (table[cardId] || table[basePricingId(cardId)]);
    if (ref) {
      // Preço BR (MYP) tem prioridade sobre a referência internacional.
      if (ref.b && ref.b.md > 0) { const v = convertMoney(ref.b.md, "BRL", cur); if (v != null) return { value: v, currency: cur, source: "myp", estimated: true }; }
      // Acabamento: Foil tem preço próprio (ex.: Lorcana ref.uf); senão o normal.
      const usd = /foil/i.test(variant || "") && ref.uf > 0 ? ref.uf : ref.u;
      if (usd > 0) { const v = convertMoney(usd, "USD", cur); if (v != null) return { value: v, currency: cur, source: "ref", estimated: true }; }
      if (ref.e > 0) { const v = convertMoney(ref.e, "EUR", cur); if (v != null) return { value: v, currency: cur, source: "ref", estimated: true }; }
    }
    return { value: 0, currency: cur, source: null, estimated: false };
  }

  // Soma o valor (variante padrão, NM) de uma lista de cartas, na moeda atual.
  function sumCardsValue(cards, prices) {
    let total = 0;
    (cards || []).forEach((card) => {
      const v = cardValue(card, defaultVariant(card), prices, DEFAULT_CONDITION);
      if (v && v.value) total += v.value;
    });
    return { value: total, currency: currentCurrency };
  }

  const MESSAGES = window.TCG_MESSAGES || {};

  function t(key, vars) {
    const table = MESSAGES[currentLanguage] || MESSAGES.pt;
    let text = table[key] != null ? table[key] : MESSAGES.pt[key];
    if (text == null) return key;
    // Multi-TCG: {game} vira o nome do jogo atual (Pokémon / Lorcana), pra uma
    // mesma chave servir todos os jogos (ex.: "Sua coleção de {game}").
    if (text.indexOf("{game}") >= 0) {
      text = text.split("{game}").join((window.SLEEVU && window.SLEEVU.name) || "Pokémon");
    }
    if (vars) {
      Object.entries(vars).forEach(([name, value]) => {
        text = text.split(`{${name}}`).join(value);
      });
    }
    return text;
  }

  function tn(key, n, vars) {
    return t(`${key}.${n === 1 ? "one" : "other"}`, Object.assign({ n }, vars));
  }

  function getLanguage() {
    return currentLanguage;
  }

  function getLocale() {
    return currentLanguageMeta.locale;
  }

  function applyTranslations(root) {
    const scope = root || document;
    document.documentElement.lang = currentLanguageMeta.htmlLang;
    scope.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    // ATENÇÃO (segurança): data-i18n-html injeta HTML sem escape. Só use com
    // chaves cujo valor é HTML CONSTANTE e confiável (ex.: textos com <a>). Nunca
    // passe dado de usuário/catálogo por aqui — para texto dinâmico use data-i18n
    // (textContent) ou interpole via escapeHtml antes.
    scope.querySelectorAll("[data-i18n-html]").forEach((element) => {
      element.innerHTML = t(element.dataset.i18nHtml);
    });
    scope.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
      element.placeholder = t(element.dataset.i18nPlaceholder);
    });
    scope.querySelectorAll("[data-i18n-title]").forEach((element) => {
      element.setAttribute("title", t(element.dataset.i18nTitle));
    });
  }

  // Constrói a navegação das páginas: Início | Pokémon ▾ (Pokédex, Sets,
  // Artistas) | Coleção. O HTML só informa a página ativa via data-active-page.
  function initPageNav() {
    const nav = document.querySelector(".page-nav[data-active-page]");
    if (!nav) return;

    let active = nav.dataset.activePage;
    if (active === "detail") {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get("scope") === "collection") {
        active = "collection";
      } else {
        const type = sp.get("type");
        active = type === "set" ? "sets" : type === "artist" ? "artists" : type === "trainer" ? "trainers" : "pokedex";
      }
    }
    const exploreActive = ["pokedex", "trainers", "sets", "artists", "cards", "hub"].includes(active);
    const collectionActive = ["collection", "wishlist", "binders", "sales"].includes(active);

    const link = (href, key, page) => `<a href="${escapeAttribute(href)}"${page === active ? ' class="active"' : ""}>${escapeHtml(t(key))}</a>`;
    const group = (key, isActive, links) => `
      <div class="nav-group">
        <button type="button" class="nav-group-toggle${isActive ? " active" : ""}" aria-expanded="false" aria-haspopup="true">
          ${escapeHtml(t(key))}<span class="nav-caret" aria-hidden="true">▾</span>
        </button>
        <div class="nav-dropdown" hidden>${links}</div>
      </div>`;

    // Site único (sleevu.app): tudo é relativo. Menu ÚNICO e idêntico em todas as
    // páginas (sem ramo hub-vs-jogo). O jogo é a sessão do site; os links de
    // Explorar carregam ?game= pra ENTRAR no jogo escolhido.
    const apexUrl = "index.html";
    const brand = document.querySelector(".brand");
    if (brand) brand.setAttribute("href", apexUrl);

    // "Explorar" = mega-menu com uma coluna por jogo + atalho pra grade de jogos.
    // Substitui o antigo item "HUB" e o antigo dropdown "Explorar" por jogo.
    const exploreLink = (href, key) => `<a href="${escapeAttribute(href)}">${escapeHtml(t(key))}</a>`;
    const exploreMega = `
      <div class="nav-group">
        <button type="button" class="nav-group-toggle${exploreActive ? " active" : ""}" aria-expanded="false" aria-haspopup="true">
          ${escapeHtml(t("nav.explore"))}<span class="nav-caret" aria-hidden="true">▾</span>
        </button>
        <div class="nav-dropdown nav-mega" hidden>
          <a class="nav-mega-all" href="hub.html">${escapeHtml(t("nav.exploreAll"))}</a>
          <div class="nav-mega-cols">
            <div class="nav-mega-col">
              <span class="nav-mega-head">${escapeHtml(t("nav.gamePokemon"))}</span>
              ${exploreLink("cards.html?game=pokemon", "nav.allCards")}
              ${exploreLink("sets.html?game=pokemon", "nav.sets")}
              ${exploreLink("pokedex.html?game=pokemon", "nav.pokedex")}
              ${exploreLink("trainers.html?game=pokemon", "nav.trainers")}
              ${exploreLink("artists.html?game=pokemon", "nav.artists")}
            </div>
            <div class="nav-mega-col">
              <span class="nav-mega-head">${escapeHtml(t("nav.gameLorcana"))}</span>
              ${exploreLink("cards.html?game=lorcana", "nav.allCards")}
              ${exploreLink("sets.html?game=lorcana", "nav.sets")}
              ${exploreLink("artists.html?game=lorcana", "nav.artists")}
            </div>
          </div>
        </div>
      </div>`;

    nav.innerHTML = `
      ${link(apexUrl, "nav.home", "home")}
      ${exploreMega}
      ${group("nav.collection", collectionActive, `
          ${link("collection.html", "nav.collectionMine", "collection")}
          ${link("binders.html", "nav.binders", "binders")}
          ${link("wishlist.html", "nav.wishlist", "wishlist")}
          ${link("sales.html", "nav.sales", "sales")}`)}
      ${link("portfolio.html?game=hub", "nav.portfolio", "portfolio")}
    `;

    const groups = Array.from(nav.querySelectorAll(".nav-group")).map((groupEl) => ({
      el: groupEl,
      toggle: groupEl.querySelector(".nav-group-toggle"),
      dropdown: groupEl.querySelector(".nav-dropdown")
    }));

    function closeAll(except) {
      groups.forEach(({ toggle, dropdown }) => {
        if (dropdown === except) return;
        dropdown.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
      });
    }

    groups.forEach(({ toggle, dropdown }) => {
      toggle.addEventListener("click", () => {
        const willOpen = dropdown.hidden;
        closeAll(dropdown);
        dropdown.hidden = !willOpen;
        toggle.setAttribute("aria-expanded", String(willOpen));
      });
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest(".nav-group")) closeAll();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeAll();
    });
  }

  // Menu hambúrguer no mobile: agrupa a navegação e as ações num drawer
  // suspenso, aberto pelo botão de 3 tracinhos no canto direito do header.
  function initMobileMenu() {
    const inner = document.querySelector(".app-header-inner");
    if (!inner || inner.querySelector(".menu-toggle")) return;
    const nav = inner.querySelector(".page-nav");
    const actions = inner.querySelector(".header-actions");
    if (!nav && !actions) return;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "menu-toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", t("nav.menu"));
    toggle.innerHTML = '<span class="menu-toggle-bars" aria-hidden="true"></span>';

    // display:contents no drawer mantém o grid do header intacto no desktop;
    // no mobile o CSS o transforma num painel suspenso.
    const drawer = document.createElement("div");
    drawer.className = "nav-drawer";
    if (nav) drawer.appendChild(nav);
    if (actions) drawer.appendChild(actions);

    const brand = inner.querySelector(".brand");
    if (brand && brand.nextSibling) inner.insertBefore(toggle, brand.nextSibling);
    else inner.appendChild(toggle);
    inner.appendChild(drawer);

    function close() {
      inner.classList.remove("menu-open");
      toggle.setAttribute("aria-expanded", "false");
    }

    toggle.addEventListener("click", () => {
      const open = !inner.classList.contains("menu-open");
      inner.classList.toggle("menu-open", open);
      toggle.setAttribute("aria-expanded", String(open));
    });

    // Fecha ao tocar num link de navegação ou ao clicar fora do header.
    drawer.addEventListener("click", (event) => {
      if (event.target.closest(".page-nav a")) close();
    });
    document.addEventListener("click", (event) => {
      if (inner.classList.contains("menu-open") && !event.target.closest(".app-header-inner")) close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });
  }

  // Rodapé global (em todas as páginas): direitos/aviso de marcas + créditos.
  // Banner de parceria (loja): imagem + link servidos do PRÓPRIO site — sem
  // scripts ou rastreio de terceiros, então NÃO muda o CSP nem a privacidade.
  // Configure o parceiro aqui; com enabled:false (ou sem imagem/link) nada é
  // exibido. A imagem deve ser hospedada no repo (ex.: "partners/loja.png") pra
  // continuar valendo o img-src 'self' do CSP.
  const PARTNER_AD = {
    enabled: false,
    position: "bottom",   // "bottom" (acima do rodapé) ou "top" (abaixo do header)
    image: "",            // ex.: "partners/minha-loja.png"
    href: "",             // ex.: "https://loja-parceira.com"
    alt: ""               // ex.: "Loja Parceira — cartas Pokémon"
  };
  function initPartnerBanner(config) {
    const ad = config || PARTNER_AD;
    if (!ad.enabled || !ad.image || !ad.href) return;
    if (document.querySelector(".partner-ad")) return;
    const a = document.createElement("a");
    a.className = "partner-ad partner-ad-" + (ad.position === "top" ? "top" : "bottom");
    a.href = ad.href;
    a.target = "_blank";
    a.rel = "sponsored noopener"; // sponsored: sinaliza link patrocinado (SEO/honestidade)
    a.setAttribute("aria-label", ad.alt || t("ad.label"));
    a.innerHTML = `<span class="partner-ad-label">${escapeHtml(t("ad.label"))}</span>`
      + `<img src="${escapeAttribute(ad.image)}" alt="${escapeAttribute(ad.alt || "")}" loading="lazy">`;
    if (ad.position === "top") {
      const header = document.querySelector(".app-header");
      if (header) header.parentNode.insertBefore(a, header.nextSibling);
      else document.body.insertBefore(a, document.body.firstChild);
    } else {
      const footer = document.querySelector(".site-footer");
      if (footer) footer.parentNode.insertBefore(a, footer);
      else document.body.appendChild(a);
    }
  }

  function initSiteFooter() {
    if (document.querySelector(".site-footer")) return;
    const footer = document.createElement("footer");
    footer.className = "site-footer";
    footer.innerHTML = `
      <div class="site-footer-inner">
        <nav class="site-footer-links" aria-label="${escapeAttribute(t("footer.linksLabel"))}">
          <a href="about.html">${escapeHtml(t("footer.about"))}</a>
          <a href="faq.html">${escapeHtml(t("footer.faq"))}</a>
          <a href="help.html">${escapeHtml(t("footer.help"))}</a>
          <a href="settings.html">${escapeHtml(t("footer.settings"))}</a>
          <a href="privacy.html">${escapeHtml(t("footer.privacy"))}</a>
          <a href="terms.html">${escapeHtml(t("footer.terms"))}</a>
        </nav>
        <p>${escapeHtml(t("footer.rights", { year: new Date().getFullYear() }))}</p>
        <p>${t("footer.credits")}</p>
      </div>
    `;
    document.body.appendChild(footer);
  }

  // --- Tema (claro/escuro) ---
  const THEME_KEY = "tcg-collector-theme-v1";
  const THEME_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>';
  const THEME_MOON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  function getTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch (e) { /* ignora */ }
    return "light"; // padrão claro (dia) em todo o ecossistema
  }
  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === "light") root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f4f6f9" : "#0d0e12");
  }
  // Botão de tema ao lado do perfil (mostra o ícone do tema PRA ONDE vai trocar).
  function initThemeToggle() {
    const actions = document.querySelector(".header-actions");
    if (!actions || document.getElementById("themeToggle")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "themeToggle";
    btn.className = "theme-toggle";
    const render = () => {
      const light = getTheme() === "light";
      btn.innerHTML = light ? THEME_MOON : THEME_SUN;
      btn.setAttribute("aria-label", t("theme.toggle"));
      btn.title = t("theme.toggle");
    };
    render();
    document.addEventListener("sleevu:theme", render); // sincroniza com a tela de Configurações
    btn.addEventListener("click", () => setTheme(getTheme() === "light" ? "dark" : "light"));
    actions.appendChild(btn);
  }
  // Troca o tema (claro/escuro) e avisa quem reflete o estado (botão do topo +
  // a tela de Configurações). Usado pelo toggle do topo e pelo seletor de Settings.
  function setTheme(theme) {
    const v = theme === "light" ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, v); } catch (e) { /* ignora */ }
    applyTheme(v);
    document.dispatchEvent(new CustomEvent("sleevu:theme"));
  }
  // Idioma e moeda recarregam (re-renderizam tudo); os setters abaixo são usados
  // tanto pelos dropdowns do topo quanto pela tela de Configurações.
  function getLanguage() { return currentLanguage; }
  function setLanguage(code) {
    try { localStorage.setItem(languageStorageKey, code); } catch (e) { /* ignora */ }
    window.location.reload();
  }
  function setCurrency(code) {
    try { localStorage.setItem(currencyStorageKey, code); } catch (e) { /* ignora */ }
    window.location.reload();
  }

  // --- Modo sensível: esconde (borra) valores de portfólio/coleção pra dar print
  // sem revelar quanto a coleção vale. Pref local; marca data-sensitive no <html>;
  // o CSS borra os totais. Ligado/desligado na tela de Configurações.
  const SENSITIVE_PREF = "tcg-collector-pref-sensitive";
  function sensitiveEnabled() {
    try { return localStorage.getItem(SENSITIVE_PREF) === "on"; } catch (e) { return false; }
  }
  function applySensitive() {
    if (sensitiveEnabled()) document.documentElement.setAttribute("data-sensitive", "on");
    else document.documentElement.removeAttribute("data-sensitive");
  }
  function setSensitive(on) {
    try { localStorage.setItem(SENSITIVE_PREF, on ? "on" : "off"); } catch (e) { /* ignora */ }
    applySensitive();
  }

  // --- Perfil (nome de exibição + @handle + visibilidade). Por ora LOCAL; o
  // backend (unicidade do @ + leitura pública da coleção) entra na etapa 2.
  // updatedAt já carimbado pra futuro sync LWW.
  const PROFILE_KEY = "tcg-collector-profile-v1";
  const PROFILE_DEFAULTS = { displayName: "", handle: "", isPublic: false, showValues: false };
  function getProfile() {
    try { return Object.assign({}, PROFILE_DEFAULTS, JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}")); }
    catch (e) { return Object.assign({}, PROFILE_DEFAULTS); }
  }
  function setProfile(patch) {
    const next = Object.assign(getProfile(), patch, { updatedAt: Date.now() });
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(next)); } catch (e) { /* ignora */ }
    return next;
  }
  // @ válido: minúsculas, números e _ (vira slug de URL). Máx. 24.
  function normalizeHandle(raw) {
    return String(raw || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
  }
  // Link VIVO do perfil público (sempre atualizado) se o usuário é público + tem
  // @; senão null (cai no snapshot). tab="sales" abre direto na aba Vendas.
  function publicProfileUrl(tab) {
    const p = getProfile();
    if (!(p.isPublic && p.handle && p.handle.length >= 3)) return null;
    return "https://sleevu.app/users/" + p.handle + (tab === "sales" ? "?t=sales" : "");
  }

  // --- Analytics first-party: ANÔNIMO e agregado (sem cookie de rastreio, sem
  // terceiro). Loga 1 pageview por carregamento na tabela `events`; o id anônimo é
  // um uuid first-party no localStorage só p/ contar visitante único (DAU/MAU). ---
  function anonId() {
    try {
      let id = localStorage.getItem("sleevu-anon-v1");
      if (!id) {
        id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
          : (Date.now().toString(36) + Math.random().toString(36).slice(2));
        localStorage.setItem("sleevu-anon-v1", id);
      }
      return id;
    } catch (e) { return null; }
  }
  // Página normalizada (1º segmento, sem .html/query/handle) — sem PII.
  function analyticsPath() {
    const seg = location.pathname.replace(/^\/+|\/+$/g, "").split("/")[0].replace(/\.html$/, "");
    return seg || "home";
  }
  function logPageview() {
    if (!AUTH_ENABLED) return;
    try {
      fetch(`${SUPABASE_URL}/rest/v1/events`, {
        method: "POST",
        headers: Object.assign(authHeaders(), { Prefer: "return=minimal" }),
        body: JSON.stringify({ name: "pageview", path: analyticsPath(), anon: anonId(), game: currentGame() }),
        keepalive: true
      });
    } catch (e) { /* analytics nunca quebra a página */ }
  }
  // Cloudflare Web Analytics: agregado e cookieless (tráfego/origem/países/web vitals).
  // Pages não injeta sozinho, então plugamos o beacon aqui. SÓ em produção
  // (sleevu.app) pra não contar localhost/preview. CSP já libera o host.
  function injectCfBeacon() {
    if (!/(^|\.)sleevu\.app$/i.test(location.hostname)) return;
    if (document.querySelector("script[data-cf-beacon]")) return;
    const s = document.createElement("script");
    s.defer = true;
    s.src = "https://static.cloudflareinsights.com/beacon.min.js";
    s.setAttribute("data-cf-beacon", '{"token":"bbd254728c214168ab583464d013e2a7"}');
    document.head.appendChild(s);
  }
  // Números agregados (tráfego + produto). Só retorna p/ admin (gate no servidor);
  // senão null. Usado pela página /admin.
  async function analyticsSummary(days) {
    let s = getSession();
    if (!s) return null;
    if (Date.now() - (s.ts || 0) > 50 * 60 * 1000) s = (await refreshSession()) || s;
    if (!s) return null;
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/analytics_summary`, {
        method: "POST", headers: authHeaders(s.access_token), body: JSON.stringify({ days: days || 30 })
      });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }
  // Usuário logado (enxuto) pra páginas que só precisam de email/id. null = deslogado.
  function currentUser() {
    const s = getSession();
    return s && s.user ? { email: s.user.email || "", id: s.user.id } : null;
  }
  // Contagem rápida da coleção (cópias + cartas distintas) SEM o catálogo: lê o
  // localStorage cru dos dois jogos. {cardId:{variant:qty}}. Usado no perfil/hub.
  function collectionCounts() {
    let copies = 0, distinct = 0;
    ["pokemon", "lorcana"].forEach((g) => {
      try {
        const raw = JSON.parse(localStorage.getItem(gameKey("collection-v3", g)) || "{}");
        Object.keys(raw).forEach((cardId) => {
          const total = Object.values(raw[cardId] || {}).reduce((s, q) => s + (Number(q) || 0), 0);
          if (total > 0) { distinct += 1; copies += total; }
        });
      } catch (e) { /* ignora */ }
    });
    return { copies, distinct };
  }
  // Valor total do portfólio (coleção+binders) somando os jogos, lido do cookie
  // sleevu_pf_<game> (escrito pelo Portfólio) — sem catálogo. Na moeda atual.
  function portfolioValueTotal() {
    let brl = 0; let has = false;
    ["pokemon", "lorcana"].forEach((g) => {
      const m = document.cookie.match(new RegExp("(?:^|; )sleevu_pf_" + g + "=([^;]*)"));
      if (!m) return;
      try { const d = JSON.parse(decodeURIComponent(m[1])); brl += (d.c || 0) + (d.b || 0); has = true; } catch (e) { /* ignora */ }
    });
    if (!has) return null;
    const v = convertMoney(brl, "BRL", getCurrency());
    return v == null ? brl : v;
  }

  // Dropdown de bandeira reutilizável: colapsado mostra só a bandeira do item
  // atual; aberto, lista bandeira + sigla (o <select> nativo não estiliza bem
  // no dark e não mostra bandeira). `items`: [{ value, flag, sigla }].
  function createFlagDropdown({ id, current, items, ariaLabel, onSelect, siglaInToggle }) {
    const dd = document.createElement("div");
    dd.className = "lang-dd";
    dd.id = id;
    const currentItem = items.find((item) => item.value === current) || items[0];
    dd.innerHTML = `
      <button type="button" class="lang-dd-toggle" aria-haspopup="listbox" aria-expanded="false" aria-label="${escapeAttribute(ariaLabel)}" title="${escapeAttribute(ariaLabel)}">
        ${currentItem.flag}
        ${siglaInToggle ? `<span class="lang-dd-toggle-sigla">${escapeHtml(currentItem.sigla)}</span>` : ""}
        <span class="lang-dd-caret" aria-hidden="true">▾</span>
      </button>
      <ul class="lang-dd-menu" role="listbox" hidden>
        ${items.map((item) => `<li role="option" data-value="${escapeAttribute(item.value)}" aria-selected="${item.value === current}" class="lang-dd-option${item.value === current ? " active" : ""}">${item.flag}<span>${escapeHtml(item.sigla)}</span></li>`).join("")}
      </ul>
    `;
    const toggle = dd.querySelector(".lang-dd-toggle");
    const menu = dd.querySelector(".lang-dd-menu");
    const close = () => { menu.hidden = true; toggle.setAttribute("aria-expanded", "false"); };
    toggle.addEventListener("click", () => {
      const willOpen = menu.hidden;
      menu.hidden = !willOpen;
      toggle.setAttribute("aria-expanded", String(willOpen));
    });
    menu.addEventListener("click", (event) => {
      const option = event.target.closest("[data-value]");
      if (option) onSelect(option.dataset.value);
    });
    document.addEventListener("click", (event) => {
      if (!menu.hidden && !event.target.closest(`#${id}`)) close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !menu.hidden) close();
    });
    return dd;
  }

  // Idioma do SITE: dropdown de bandeira (só bandeira colapsado; bandeira+sigla
  // no menu) no lugar do <select> nativo.
  function initLanguageSwitcher() {
    const select = document.getElementById("languageSwitcher");
    if (!select) return;
    const SITE_SIGLA = { pt: "PT-BR", en: "EN" };
    const items = UI_LANGUAGES.map(({ code }) => ({ value: code, flag: cardFlag(code), sigla: SITE_SIGLA[code] || code.toUpperCase() }));
    const dd = createFlagDropdown({
      id: "siteLangDd",
      current: currentLanguage,
      items,
      ariaLabel: t("lang.aria"),
      onSelect: (value) => { localStorage.setItem(languageStorageKey, value); window.location.reload(); }
    });
    select.replaceWith(dd);
  }

  // Moeda dos valores: dropdown (R$/US$/€) ao lado da bandeira de idioma.
  function initCurrencySwitcher() {
    const actions = document.querySelector(".header-actions");
    if (!actions || document.getElementById("currencyDd")) return;
    const badge = (sym) => `<span class="lang-dd-cur" aria-hidden="true">${sym}</span>`;
    const items = [
      { value: "BRL", flag: badge("R$"), sigla: "BRL" },
      { value: "USD", flag: badge("US$"), sigla: "USD" },
      { value: "EUR", flag: badge("€"), sigla: "EUR" }
    ];
    const dd = createFlagDropdown({
      id: "currencyDd",
      current: currentCurrency,
      items,
      ariaLabel: t("currency.aria"),
      siglaInToggle: true, // mostra a sigla (BRL/USD/EUR) ao lado do símbolo na HUD
      onSelect: (value) => { localStorage.setItem(currencyStorageKey, value); window.location.reload(); }
    });
    actions.insertBefore(dd, actions.firstChild);
  }

  // Bandeiras SVG inline por idioma da carta (renderizam em qualquer SO, ao
  // contrário de emoji de bandeira no Windows).
  const CARD_FLAG_SVGS = {
    en: '<svg viewBox="0 0 20 14"><rect width="20" height="14" fill="#b22234"/><g fill="#fff"><rect y="2" width="20" height="2"/><rect y="6" width="20" height="2"/><rect y="10" width="20" height="2"/></g><rect width="9" height="8" fill="#3c3b6e"/><g fill="#fff"><circle cx="2" cy="2" r=".7"/><circle cx="4.5" cy="2" r=".7"/><circle cx="7" cy="2" r=".7"/><circle cx="3.2" cy="4" r=".7"/><circle cx="5.7" cy="4" r=".7"/><circle cx="2" cy="6" r=".7"/><circle cx="4.5" cy="6" r=".7"/><circle cx="7" cy="6" r=".7"/></g></svg>',
    ja: '<svg viewBox="0 0 20 14"><rect width="20" height="14" fill="#fff"/><circle cx="10" cy="7" r="4" fill="#bc002d"/></svg>',
    zh: '<svg viewBox="0 0 20 14"><rect width="20" height="14" fill="#de2910"/><polygon points="10,3 10.94,5.71 13.8,5.76 11.52,7.49 12.35,10.24 10,8.6 7.65,10.24 8.48,7.49 6.2,5.76 9.06,5.71" fill="#ffde00"/></svg>',
    pt: '<svg viewBox="0 0 20 14"><rect width="20" height="14" fill="#009b3a"/><polygon points="10,1.6 18.4,7 10,12.4 1.6,7" fill="#fedf00"/><circle cx="10" cy="7" r="2.6" fill="#002776"/></svg>'
  };

  // Emoji da bandeira (pra usar em <option>, que não aceita SVG/HTML). Casa com
  // os flags SVG: en=EUA, ja=Japão, zh=China, pt=Brasil.
  const CARD_FLAG_EMOJI = { en: "🇺🇸", ja: "🇯🇵", zh: "🇨🇳", pt: "🇧🇷" };
  function cardFlagEmoji(language) {
    return CARD_FLAG_EMOJI[normalizeCardLanguage(language)] || "";
  }

  function normalizeCardLanguage(language) {
    const code = String(language || "").toLowerCase();
    if (code.startsWith("pt")) return "pt";
    if (code.startsWith("ja") || code === "jp") return "ja";
    if (code.startsWith("zh")) return "zh";
    if (code.startsWith("en")) return "en";
    return code;
  }

  // Origem de lançamento da carta: japonês, chinês ou internacional (inglês e
  // demais idiomas ocidentais, que compartilham os mesmos sets).
  function cardLanguageRegion(language) {
    const code = normalizeCardLanguage(language);
    if (code === "ja") return "japanese";
    if (code === "zh") return "chinese";
    if (code === "pt") return "portuguese";
    return "english";
  }

  function cardLanguageLabel(language) {
    const code = normalizeCardLanguage(language);
    const translated = t(`cardLang.${code}`);
    return translated === `cardLang.${code}` ? cardLangSigla(language) : translated;
  }

  // Sigla curta de exibição do idioma. "ja" é o código interno (TCGdex/IDs),
  // mas mostramos "JP" para o usuário. Padroniza o rótulo curto em todo o site.
  const LANG_SIGLA = { ja: "JP", zh: "ZH", pt: "PT", en: "EN" };
  function cardLangSigla(language) {
    const code = normalizeCardLanguage(language);
    return LANG_SIGLA[code] || String(language || "").toUpperCase();
  }

  function cardFlag(language) {
    const code = normalizeCardLanguage(language);
    const label = cardLanguageLabel(language);
    const svg = CARD_FLAG_SVGS[code];
    if (!svg) {
      return `<span class="card-flag card-flag-text" title="${escapeAttribute(label)}">${escapeHtml(cardLangSigla(language))}</span>`;
    }
    return `<span class="card-flag" title="${escapeAttribute(label)}" role="img" aria-label="${escapeAttribute(label)}">${svg}</span>`;
  }

  // Variante de qualidade/formato de um asset da TCGdex. Cartas aceitam
  // qualidade ("low" ≈17KB / "high" ≈68KB em webp; o high.png tem ~970KB) e
  // logos/símbolos aceitam só o formato. URLs de outros domínios passam direto.
  function tcgdexAssetUrl(url, quality) {
    if (!url || !url.includes("assets.tcgdex.net")) return url;
    return url.replace(/(?:\/(low|high))?\.(png|webp|jpg)$/, (match, currentQuality) => {
      const finalQuality = quality || currentQuality;
      return `${finalQuality ? `/${finalQuality}` : ""}.webp`;
    });
  }

  // Avança o <img> para a próxima URL da cadeia de fallback quando a atual
  // falha (webp → png do mesmo host → fonte alternativa de outro host). Quando a
  // cadeia esgota, RE-TENTA a cadeia inteira após um backoff: abrir uma coleção
  // grande dispara muitas imagens de uma vez e algumas falham por rate-limit /
  // limite de conexões — o retry dispensa o "ficar dando F5". Para no fim com o
  // placeholder cinza (sem ícone de imagem quebrada).
  const IMG_MAX_RETRIES = 4;
  const TCGImg = {
    fallback(img) {
      // Guarda o estado original na 1ª falha, p/ reiniciar a cadeia no retry.
      if (!img.hasAttribute("data-img-orig")) {
        img.setAttribute("data-img-orig", img.getAttribute("src") || "");
        img.setAttribute("data-img-orig-fb", img.getAttribute("data-img-fallbacks") || "");
      }
      const list = (img.getAttribute("data-img-fallbacks") || "").split("|").filter(Boolean);
      const next = list.shift();
      if (next) {
        if (list.length) img.setAttribute("data-img-fallbacks", list.join("|"));
        else img.removeAttribute("data-img-fallbacks");
        img.src = next;
        return;
      }
      // Cadeia esgotada: reagenda a cadeia inteira (backoff + jitter p/ não
      // saturar todas as imagens ao mesmo tempo de novo).
      img.removeAttribute("data-img-fallbacks");
      const tries = +img.getAttribute("data-img-retries") || 0;
      if (tries >= IMG_MAX_RETRIES) return; // desiste: fica o placeholder cinza
      img.setAttribute("data-img-retries", String(tries + 1));
      const orig = img.getAttribute("data-img-orig") || "";
      const origFb = img.getAttribute("data-img-orig-fb") || "";
      if (!orig) return;
      const delay = 1000 * (tries + 1) + Math.random() * 1500;
      setTimeout(() => {
        if (!img.isConnected || img.classList.contains("is-loaded")) return; // já apareceu/saiu da tela
        if (origFb) img.setAttribute("data-img-fallbacks", origFb);
        // Cache-buster força um fetch novo (a mesma URL não re-dispara load).
        img.src = orig + (orig.indexOf("?") >= 0 ? "&" : "?") + "_r=" + (tries + 1);
      }, delay);
    }
  };
  window.TCGImg = TCGImg;

  // Delegação em fase de captura: eventos "error" de <img> não borbulham, mas
  // são capturáveis. Dispara a cadeia de fallback sem onerror inline (que a CSP
  // script-src 'self' bloquearia).
  document.addEventListener("error", (event) => {
    const img = event.target;
    // data-card-img: continua elegível mesmo depois da cadeia esgotar (p/ o retry).
    if (img && img.tagName === "IMG" && (img.hasAttribute("data-img-fallbacks") || img.hasAttribute("data-card-img"))) {
      TCGImg.fallback(img);
    }
  }, true);
  // Fade-in das imagens de carta: aparecem por cima do placeholder cinza conforme
  // carregam (em vez de tudo de uma vez / piscar). "load" não borbulha → captura.
  document.addEventListener("load", (event) => {
    const img = event.target;
    if (img && img.tagName === "IMG") img.classList.add("is-loaded");
  }, true);

  // setId da pokemontcg.io a partir do da TCGdex. Primeiro consulta o de-para
  // versionado (data/set-id-map.js, gerado por scripts/build-set-id-map.mjs),
  // que cobre os casos onde os ids divergem (promos, McDonald's, sets novos);
  // se não houver entrada, aplica a regra geral (minúsculo + sets duplos SV).
  function pokemontcgSetId(setId) {
    if (!setId) return "";
    const map = window.TCG_SET_ID_MAP || {};
    if (map[setId]) return map[setId];
    return String(setId).toLowerCase()
      .replace(/^sv0*(\d+)\.(\d+)$/, "sv$1pt$2")
      .replace(/^sv0+(\d+)$/, "sv$1");
  }

  // URL da carta na pokemontcg.io (fallback para cartas EN durante um outage
  // da TCGdex). Só vale para cartas EN com número puramente numérico; sets/
  // numerações que não batem simplesmente não geram fallback.
  function pokemontcgImageUrl(card, hires) {
    if (!card || card.language !== "en") return "";
    const setId = pokemontcgSetId(card.setId);
    const number = String(card.number || "").split("/")[0].replace(/^0+/, "");
    if (!setId || !number || !/^\d+$/.test(number)) return "";
    return `https://images.pokemontcg.io/${setId}/${number}${hires ? "_hires" : ""}.png`;
  }

  // Tem alguma imagem exibível? (asset da TCGdex ou fallback EN do pokemontcg.io).
  // Usado para jogar as cartas sem imagem para o fim das grades.
  function cardHasImage(card) {
    return Boolean(card && (card.image || pokemontcgImageUrl(card, false)));
  }

  // Imagem primária de uma carta: o asset da TCGdex se existir, senão a da
  // pokemontcg.io (cartas EN). Retorna { url, fallback } para o localizedImg.
  function cardImageSources(card, hires) {
    const ptcg = pokemontcgImageUrl(card, hires);
    const url = card.image || ptcg;
    return { url, fallback: card.image ? ptcg : "" };
  }

  // Verso de carta para quando NENHUMA API tem imagem (ex.: promos, McDonald's,
  // sets novos). Mantém a estrutura/tamanho de uma carta e avisa "Imagem não
  // Encontrada" no topo. Motivo pokébola próprio do app (o verso oficial é
  // protegido). Essas cartas ficam por último na grade (cardHasImage = false).
  const CARD_BACK_BALL = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="#e6e9ee"/><path d="M5 50a45 45 0 0 1 90 0z" fill="#d23b3b"/><rect x="5" y="46" width="90" height="8" fill="#10203f"/><circle cx="50" cy="50" r="15" fill="#10203f"/><circle cx="50" cy="50" r="8.5" fill="#fff"/><circle cx="50" cy="50" r="4" fill="#10203f"/></svg>';

  function cardBackPlaceholder() {
    return `<div class="card-back" role="img" aria-label="${escapeAttribute(t("card.noImageFound"))}">`
      + `<span class="card-back-label">${escapeHtml(t("card.noImageFound"))}</span>`
      + `<span class="card-back-art">${CARD_BACK_BALL}</span>`
      + `</div>`;
  }

  // <img> dos assets do catálogo. Para URLs da TCGdex usa webp (muito menor
  // que o png), com cadeia de fallback no onerror: se a variante webp não
  // existir cai no png do mesmo host, e `fallback` permite uma fonte de outro
  // host (ex.: pokemontcg.io) caso a TCGdex inteira esteja fora do ar.
  // `thumb: true` baixa a qualidade "low" (para grades de cartas).
  // Cada carta/set já tem a imagem no seu próprio idioma (indicado pela
  // bandeira), então a imagem é renderizada como veio do catálogo — sem trocar
  // o idioma da URL pelo idioma da interface.
  function localizedImg(url, options) {
    if (!url) return "";
    const { alt = "", className = "", loading = "", thumb = false, fallback = "" } = options || {};
    const classAttr = className ? ` class="${escapeAttribute(className)}"` : "";
    const loadingAttr = loading ? ` loading="${loading}"` : "";
    const src = tcgdexAssetUrl(url, thumb ? "low" : "");
    const chain = [];
    if (src !== url) chain.push(url); // webp -> png original (mesmo host)
    (Array.isArray(fallback) ? fallback : [fallback]).forEach((entry) => { if (entry) chain.push(entry); });
    const fallbackAttr = chain.length
      ? ` data-img-fallbacks="${escapeAttribute(chain.join("|"))}"`
      : "";
    return `<img${classAttr}${loadingAttr} decoding="async" data-card-img src="${escapeAttribute(src)}" alt="${escapeAttribute(alt)}"${fallbackAttr}>`;
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

  // --- Cotação de mercado (preços internacionais da TCGdex, ao vivo) ----------
  // Referência da carta na API da TCGdex: id sem o sufixo de idioma + o idioma.
  function tcgdexCardRef(card) {
    return {
      lang: card.language || "en",
      id: String(card.id || "").replace(/-(pt|ja|zh-tw|zh)$/, "")
    };
  }

  // Preço da carta direto da API da TCGdex (atualizado diariamente), com cache
  // de 24h no localStorage. Retorna o objeto `pricing` ou null.
  async function fetchCardPricing(card) {
    const ref = tcgdexCardRef(card);
    const cacheKey = `tcg-pricing-${ref.lang}-${ref.id}`;
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (cached && Date.now() - cached.t < 86400000) return cached.p;
    } catch (error) { /* cache inválido */ }
    try {
      const response = await fetch(`https://api.tcgdex.net/v2/${ref.lang}/cards/${encodeURIComponent(ref.id)}`);
      if (!response.ok) return null;
      const json = await response.json();
      const pricing = json && json.pricing ? json.pricing : null;
      try { localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), p: pricing })); } catch (e) { /* cheio */ }
      return pricing;
    } catch (error) {
      return null;
    }
  }

  // Câmbio USD/EUR -> BRL (AwesomeAPI, sem chave), cache diário. { USD, EUR }.
  async function fetchFxRatesBRL() {
    const cacheKey = "tcg-fx-brl-v1";
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (cached && Date.now() - cached.t < 86400000) return cached.r;
    } catch (error) { /* ignora */ }
    try {
      const response = await fetch("https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL");
      if (!response.ok) return null;
      const json = await response.json();
      const rates = { USD: Number(json.USDBRL && json.USDBRL.bid) || 0, EUR: Number(json.EURBRL && json.EURBRL.bid) || 0 };
      try { localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), r: rates })); } catch (e) { /* ignora */ }
      return rates;
    } catch (error) {
      return null;
    }
  }

  // Estrutura o `pricing` da TCGdex em não-foil/foil com {min, med, max} por
  // moeda. USD vem do TCGplayer (low/market/high); EUR do Cardmarket (low/avg;
  // Cardmarket não tem "máx", então fica vazio).
  function marketQuoteData(pricing, card) {
    const cm = pricing.cardmarket || {};
    const tp = pricing.tcgplayer || {};
    const num = (v) => (typeof v === "number" && v > 0 ? v : null);
    const tpVariant = (keys) => keys.map((k) => tp[k]).find(Boolean) || null;
    const usdFrom = (v) => (v ? { min: num(v.lowPrice), med: num(v.marketPrice) || num(v.midPrice), max: num(v.highPrice) } : null);
    const eurFrom = (low, avg) => (num(low) || num(avg) ? { min: num(low), med: num(avg), max: null } : null);
    const has = (q) => q && (q.min || q.med || q.max);

    // Só mostra os acabamentos que a carta REALMENTE tem (pelas variantes). O
    // Cardmarket reporta um preço único por carta: os campos -holo são o foil;
    // a "base" é o não-foil quando há os dois, mas numa carta só-foil a base é
    // o próprio preço do foil (e não deve virar uma seção "não-foil" fantasma).
    const variants = card && card.variants && card.variants.length ? card.variants : ["Normal"];
    const isFoil = (v) => /holo|revers/i.test(v);
    const hasFoil = variants.some(isFoil);
    const hasNonFoil = variants.some((v) => !isFoil(v));

    const cmBase = eurFrom(cm.low, cm.avg);
    const cmHolo = eurFrom(cm["low-holo"], cm["avg-holo"]);
    const nonfoil = hasNonFoil ? { usd: usdFrom(tpVariant(["normal"])), eur: cmBase } : null;
    const foil = hasFoil ? {
      usd: usdFrom(tpVariant(["holofoil", "reverse-holofoil", "reverseHolofoil", "1stEditionHolofoil"])),
      eur: cmHolo || (hasNonFoil ? null : cmBase)
    } : null;

    return {
      nonfoil: nonfoil && (has(nonfoil.usd) || has(nonfoil.eur)) ? nonfoil : null,
      foil: foil && (has(foil.usd) || has(foil.eur)) ? foil : null,
      updated: String(cm.updated || tp.updated || "").slice(0, 10)
    };
  }

  function fmtMoney(currency, value) {
    if (!value) return "—";
    const n = value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return currency === "BRL" ? `R$ ${n}` : currency === "USD" ? `US$ ${n}` : `€ ${n}`;
  }

  // Converte um valor (em USD/EUR/BRL) para a moeda escolhida no site, usando o
  // câmbio {USD, EUR} (BRL por unidade) buscado junto com a cotação.
  function toChosenCurrency(value, srcCur, fx) {
    if (!value) return null;
    const cur = currentCurrency;
    if (srcCur === cur) return value;
    if (!fx) return null;
    const brl = srcCur === "BRL" ? value : srcCur === "USD" ? value * (fx.USD || 0) : value * (fx.EUR || 0);
    if (!brl) return null;
    if (cur === "BRL") return brl;
    const rate = cur === "USD" ? fx.USD : fx.EUR;
    return rate ? brl / rate : null;
  }

  // Um "card" de fonte (EUA / Europa / Brasil) com MÍN/MEDIANA/MÁX já na moeda
  // escolhida no site. `source` é o rótulo (ex.: "EUA · TCGplayer").
  function marketSourceCard(source, q) {
    const cur = currentCurrency;
    const cell = (label, key) => `<div class="market-cell${key === "med" ? " med" : ""}"><span>${label}</span><strong>${fmtMoney(cur, q[key])}</strong></div>`;
    return `<div class="market-card"><span class="market-card-cur">${escapeHtml(source)}</span><div class="market-cells">${cell(t("market.min"), "min")}${cell(t("market.median"), "med")}${cell(t("market.max"), "max")}</div></div>`;
  }

  // Linha de um acabamento (não-foil/foil): EUA (TCGplayer/USD) e Europa
  // (Cardmarket/EUR) são mercados distintos, então ficam em 2 cards — ambos
  // convertidos para a moeda escolhida. (BR vem do MYP, à parte.)
  function marketFinishRow(label, finish, fx) {
    if (!finish) return "";
    const has = (q) => q && (q.min || q.med || q.max);
    const conv = (q, src) => (q ? { min: toChosenCurrency(q.min, src, fx), med: toChosenCurrency(q.med, src, fx), max: toChosenCurrency(q.max, src, fx) } : null);
    const us = conv(finish.usd, "USD");
    const eu = conv(finish.eur, "EUR");
    const cards = [
      has(us) ? marketSourceCard(t("market.us"), us) : "",
      has(eu) ? marketSourceCard(t("market.eu"), eu) : ""
    ].join("");
    if (!cards) return "";
    return `<div class="market-finish"><span class="market-finish-label">${escapeHtml(label)}</span><div class="market-cards">${cards}</div></div>`;
  }

  // Bloco "Brasil (MYP)" a partir do preço BR salvo no catálogo (TCG_PRICING.b =
  // { mn, md, mx } em BRL, vindo do sync do MYP). Vazio se não houver.
  function marketBrRow(card, fx) {
    const table = window.TCG_PRICING;
    if (!table) return "";
    const ref = (card && card.id && (table[card.id] || table[basePricingId(card.id)])) || null;
    const b = ref && ref.b;
    if (!b || !(b.mn || b.md || b.mx)) return "";
    const q = { min: toChosenCurrency(b.mn, "BRL", fx), med: toChosenCurrency(b.md, "BRL", fx), max: toChosenCurrency(b.mx, "BRL", fx) };
    return `<div class="market-finish"><span class="market-finish-label">${escapeHtml(t("market.br"))}</span><div class="market-cards">${marketSourceCard(t("market.brSource"), q)}</div></div>`;
  }

  // Graded (eBay por nota PSA), do catálogo (TCG_PRICING.g). Mostra PSA 10 e 9
  // com Mercado (smart) + Recente (7d) + Mediana (90d), em USD convertido.
  function gradedCardHtml(grade, g, fx) {
    const cur = currentCurrency;
    const cell = (label, v, cls) => v ? `<div class="market-cell${cls ? " " + cls : ""}"><span>${label}</span><strong>${fmtMoney(cur, toChosenCurrency(v, "USD", fx))}</strong></div>` : "";
    const cells = cell(t("graded.smart"), g.s, "med") + cell(t("graded.recent"), g.r) + cell(t("graded.median"), g.m);
    const trend = g.t === 1 ? ' <span class="graded-trend up" aria-hidden="true">▲</span>' : g.t === -1 ? ' <span class="graded-trend down" aria-hidden="true">▼</span>' : "";
    const sales = g.n ? ` · ${tn("graded.sales", g.n)}` : "";
    return `<div class="market-card graded-card"><span class="market-card-cur">PSA ${grade}${trend}${sales}</span><div class="market-cells">${cells}</div></div>`;
  }
  function gradedHtml(card, fx) {
    const table = window.TCG_PRICING;
    if (!table) return "";
    const ref = (card && card.id && (table[card.id] || table[basePricingId(card.id)])) || null;
    const g = ref && ref.g;
    if (!g) return "";
    const cards = ["10", "9"].map((grade) => g[grade] ? gradedCardHtml(grade, g[grade], fx) : "").join("");
    if (!cards) return "";
    return `<div class="market-finish graded-finish"><span class="market-finish-label">${escapeHtml(t("graded.label"))}</span><div class="market-cards">${cards}</div></div>`;
  }

  // Cotação do Lorcana: o preço vem da Lorcast (mercado TCGplayer) — só market
  // por acabamento (não tem MÍN/MEDIANA/MÁX nem Cardmarket). u = não-foil, uf =
  // foil; mostra só os acabamentos que a carta tem (Enchanted/Iconic = só foil).
  function lorcanaMarketHtml(card, fx) {
    const table = window.TCG_PRICING;
    const ref = (table && card && card.id && table[card.id]) || null;
    if (!ref) return "";
    const cur = currentCurrency;
    const vars = card.variants || [];
    const cell = (label, usd) => usd > 0 ? `<div class="market-cell"><span>${escapeHtml(label)}</span><strong>${fmtMoney(cur, toChosenCurrency(usd, "USD", fx))}</strong></div>` : "";
    const cells = (vars.indexOf("Normal") >= 0 ? cell(t("market.nonfoil"), ref.u) : "")
      + (vars.indexOf("Foil") >= 0 ? cell(t("market.foil"), ref.uf > 0 ? ref.uf : ref.u) : "");
    if (!cells) return "";
    return `<div class="market-finish"><span class="market-finish-label">${escapeHtml(t("market.us"))}</span>`
      + `<div class="market-cards"><div class="market-card"><span class="market-card-cur">TCGplayer</span><div class="market-cells">${cells}</div></div></div></div>`;
  }

  function marketQuoteHtml(pricing, fx, card) {
    // Formato segue o jogo da CARTA, não a sessão: carta Lorcana mostra a cotação
    // Lorcana (LigaLorcana etc.) mesmo numa sessão Pokémon, e vice-versa.
    if ((card.game || currentGame()) === "lorcana") {
      const lor = lorcanaMarketHtml(card, fx);
      if (!lor) return "";
      return `<div class="market-quote-head"><h3>${escapeHtml(t("market.title"))}</h3></div>`
        + lor + `<p class="market-source">${escapeHtml(t("market.lorcanaSource"))}</p>`;
    }
    const data = pricing ? marketQuoteData(pricing, card) : { nonfoil: null, foil: null, updated: "" };
    const tcgdex = marketFinishRow(t("market.nonfoil"), data.nonfoil, fx) + marketFinishRow(t("market.foil"), data.foil, fx);
    const br = marketBrRow(card, fx);
    const graded = gradedHtml(card, fx);
    if (!tcgdex && !br && !graded) return "";
    const updated = data.updated ? `<span class="market-updated">${escapeHtml(t("market.updated", { date: data.updated }))}</span>` : "";
    const srcMarket = (tcgdex || br) ? `<p class="market-source">${escapeHtml(t("market.source"))}</p>` : "";
    const srcGraded = graded ? `<p class="market-source">${escapeHtml(t("graded.source"))}</p>` : "";
    return `<div class="market-quote-head"><h3>${escapeHtml(t("market.title"))}</h3>${updated}</div>`
      + tcgdex
      + br
      + srcMarket
      + graded
      + srcGraded;
  }

  // Busca cotação + câmbio e preenche a seção no modal (some se não houver).
  async function fillMarketQuote(card) {
    const section = document.querySelector("#cardPreviewModal [data-market-quote]");
    if (!section) return;
    const [pricing, fx] = await Promise.all([fetchCardPricing(card), fetchFxRatesBRL()]);
    if (!section.isConnected) return;
    const html = marketQuoteHtml(pricing, fx, card);
    if (html) {
      section.innerHTML = html;
      section.hidden = false;
    } else {
      section.hidden = true;
    }
  }

  // Símbolo da moeda atual (R$/$/€…) — pro campo "Vender por".
  function saleCurrencySymbol() {
    return fmtMoney(getCurrency(), 0).replace(/[\d.,\s ]/g, "") || getCurrency();
  }
  function createCardPreview({ getCard, store, onOwnedChange, prices, wishlist, folders, sale }) {
    let activeCard = null;
    let activeVariant = null;
    let openerElement = null;

    document.addEventListener("click", handleClick);
    // Salva o preço BR digitado ao sair do campo (change = blur ou Enter).
    // Aceita vírgula ou ponto como decimal ("12,50", "12.50", "1.250,00").
    document.addEventListener("change", (event) => {
      const saleInput = event.target.closest("#cardPreviewModal [data-preview-sale]");
      if (saleInput && sale && activeCard) {
        const text = String(saleInput.value).trim();
        const amount = Number(text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text) || 0;
        sale.onChange(activeCard.id, activeVariant || defaultVariant(activeCard), amount);
        return;
      }
      const folderSelect = event.target.closest("#cardPreviewModal [data-preview-folder]");
      if (folderSelect && folders && activeCard) {
        folders.onChange(activeCard.id, folderSelect.value || null);
        return;
      }
      const input = event.target.closest("#cardPreviewModal input[data-price-card-id]");
      if (!input || !prices) return;
      const text = String(input.value).trim();
      const amount = Number(text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text) || 0;
      prices.setPrice(input.dataset.priceCardId, input.dataset.priceVariant, input.dataset.priceCondition, amount, "manual");
      const saved = prices.getPrice(input.dataset.priceCardId, input.dataset.priceVariant, input.dataset.priceCondition);
      input.value = saved > 0 ? String(saved).replace(".", ",") : "";
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        close();
      }
    });

    function open(cardId, variant) {
      activeCard = getCard(cardId);
      if (!activeCard) return;
      const variants = activeCard.variants && activeCard.variants.length ? activeCard.variants : [defaultVariant(activeCard)];
      activeVariant = variant && variants.includes(variant) ? variant : null;

      let modal = document.getElementById("cardPreviewModal");
      if (!modal) {
        modal = document.createElement("div");
        modal.id = "cardPreviewModal";
        modal.className = "card-preview-modal";
        document.body.appendChild(modal);
      }

      const isOwned = activeVariant ? store.variantTotal(activeCard.id, activeVariant) > 0 : store.has(activeCard.id);
      const wantVariant = activeVariant || defaultVariant(activeCard);
      const isWanted = wishlist ? wishlist.has(activeCard.id, wantVariant) : false;

      modal.innerHTML = `
        <div class="card-preview-backdrop" data-preview-close></div>
        <section class="card-preview-panel" role="dialog" aria-modal="true" aria-label="${escapeAttribute(activeCard.name)}">
          <button class="preview-close" data-preview-close aria-label="${escapeAttribute(t("modal.close"))}">×</button>
          <div class="preview-image-wrap">
            ${(function () {
              const img = cardImageSources(activeCard, true);
              return img.url
                ? localizedImg(img.url, { alt: activeCard.name, fallback: img.fallback })
                : cardBackPlaceholder();
            })()}
          </div>
          <div class="preview-content">
            <div>
              <p class="eyebrow">${escapeHtml(activeCard.set)}</p>
              <h2>${escapeHtml(cardLabel(activeCard))}</h2>
              <p class="preview-subtitle">${(function () {
                const year = String(activeCard.setReleaseDate || "").slice(0, 4);
                return /^\d{4}$/.test(year) ? `<span class="preview-year">${year}</span>` : "";
              })()}${cardFlag(activeCard.language)}<span>${escapeHtml(activeCard.number)} · ${escapeHtml(cardLangSigla(activeCard.language))}</span></p>
            </div>
            <div class="preview-actions">
              <div class="preview-actions-row">
                <button type="button" class="secondary preview-share" data-preview-share>${TILE_ICONS.share}<span>${escapeHtml(t("modal.share"))}</span></button>
                ${wishlist ? `<button type="button" class="secondary preview-want${isWanted ? " active" : ""}" data-preview-want aria-pressed="${isWanted}">${isWanted ? TILE_ICONS.heartFilled : TILE_ICONS.heart}<span>${escapeHtml(isWanted ? t("modal.wanted") : t("modal.want"))}</span></button>` : ""}
              </div>
              <button class="owned-toggle preview-owned" data-card-id="${escapeAttribute(activeCard.id)}"${activeVariant ? ` data-variant="${escapeAttribute(activeVariant)}"` : ""} aria-pressed="${isOwned}">
                ${isOwned ? t("card.inCollection") : t("card.markOwned")}
              </button>
              ${(folders && folders.list().length) ? `<label class="preview-folder-row"><span>${escapeHtml(t("folders.assign"))}</span>
                <select class="preview-folder" data-preview-folder>
                  <option value="">${escapeHtml(t("folders.none"))}</option>
                  ${folders.list().map((f) => `<option value="${escapeAttribute(f.id)}"${folders.currentOf(activeCard.id) === f.id ? " selected" : ""}>${escapeHtml(f.name || t("folders.untitled"))}</option>`).join("")}
                </select></label>` : ""}
              ${sale ? `<label class="preview-sale-row"><span>${escapeHtml(t("sales.sell"))}</span><span class="preview-sale-cur">${escapeHtml(saleCurrencySymbol())}</span>
                <input type="text" inputmode="decimal" class="preview-sale-price" data-preview-sale value="${escapeAttribute((function () { const p = sale.priceOf(activeCard.id, activeVariant || defaultVariant(activeCard)); return p > 0 ? String(p).replace(".", ",") : ""; })())}" placeholder="0,00"></label>` : ""}
            </div>
            <div class="preview-details">
              <h3>${escapeHtml(t("modal.details"))}</h3>
              <dl>
                <div><dt>${escapeHtml(t("modal.rarity"))}</dt><dd>${escapeHtml(activeCard.rarity || "-")}</dd></div>
                <div><dt>${escapeHtml(t("modal.artist"))}</dt><dd>${escapeHtml(activeCard.artist || t("card.unknownArtist"))}</dd></div>
                <div><dt>${escapeHtml(t("modal.set"))}</dt><dd>${escapeHtml(activeCard.set || "-")}</dd></div>
                <div><dt>${escapeHtml(t("modal.cardId"))}</dt><dd>${escapeHtml(activeCard.id)}</dd></div>
              </dl>
            </div>
            <div class="variant-quantities">${variantQuantityRows(activeCard, store, prices, activeVariant)}</div>
            <section class="market-quote" data-market-quote><p class="market-loading">${escapeHtml(t("market.loading"))}</p></section>
            ${prices ? brMarketplaceLinks(activeCard) : ""}
          </div>
        </section>
      `;

      // Focus trap: guarda quem abriu (só na primeira abertura, não nos
      // re-renders após toggle), foca o fechar e prende o Tab dentro do modal.
      if (!document.body.classList.contains("preview-open")) {
        openerElement = document.activeElement;
      }
      document.body.classList.add("preview-open");

      const closeButton = modal.querySelector(".preview-close");
      if (closeButton) closeButton.focus();

      modal.onkeydown = (event) => {
        if (event.key !== "Tab") return;
        const focusables = Array.from(modal.querySelectorAll("button, a[href], input, select")).filter((el) => !el.disabled);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          last.focus();
          event.preventDefault();
        } else if (!event.shiftKey && document.activeElement === last) {
          first.focus();
          event.preventDefault();
        }
      };

      // Cotação de mercado (TCGdex ao vivo + câmbio): carrega assíncrono.
      fillMarketQuote(activeCard);
    }

    function close() {
      const modal = document.getElementById("cardPreviewModal");
      if (modal) modal.remove();
      activeCard = null;
      document.body.classList.remove("preview-open");
      if (openerElement && document.contains(openerElement)) {
        openerElement.focus();
      }
      openerElement = null;
    }

    function handleClick(event) {
      if (event.target.closest("[data-preview-close]")) {
        close();
        return;
      }

      if (event.target.closest("[data-preview-share]")) {
        shareCard();
        return;
      }

      if (event.target.closest("[data-preview-want]") && wishlist && activeCard) {
        const variant = activeVariant || defaultVariant(activeCard);
        wishlist.toggle(activeCard.id, variant);
        refreshWishlistButton();
        onOwnedChange();
        return;
      }

      // Stepper de condição: atualiza só a seção de quantidades (não recria a
      // imagem grande, evitando o flicker a cada clique).
      if (event.target.closest("#cardPreviewModal") && handleQuantityClick(event, store)) {
        onOwnedChange();
        refreshQuantities();
        return;
      }

      const modalToggle = event.target.closest("#cardPreviewModal [data-card-id]");
      if (modalToggle) {
        // Quando o preview foi aberto de um tile de variante específica, o
        // botão liga/desliga só aquela variante; senão a carta inteira.
        if (modalToggle.dataset.variant) {
          store.toggleVariant(modalToggle.dataset.cardId, modalToggle.dataset.variant);
        } else {
          store.toggle(getCard(modalToggle.dataset.cardId) || { id: modalToggle.dataset.cardId });
        }
        onOwnedChange();
        refreshQuantities();
      }
    }

    function refreshQuantities() {
      const modal = document.getElementById("cardPreviewModal");
      if (!modal || !activeCard) return;
      const wrap = modal.querySelector(".variant-quantities");
      if (wrap) {
        // Preserva quais variantes estavam expandidas (o <details> recriado volta
        // fechado por padrão; sem isto, cada +/- colapsaria o editor).
        const openNames = new Set([...wrap.querySelectorAll(".variant-conditions[open]")]
          .map((d) => d.querySelector(".variant-row-name") && d.querySelector(".variant-row-name").textContent));
        wrap.innerHTML = variantQuantityRows(activeCard, store, prices, activeVariant);
        wrap.querySelectorAll(".variant-conditions").forEach((d) => {
          const nm = d.querySelector(".variant-row-name");
          if (nm && openNames.has(nm.textContent)) d.open = true;
        });
      }
      const ownedButton = modal.querySelector(".preview-owned");
      if (ownedButton) {
        const isOwned = activeVariant ? store.variantTotal(activeCard.id, activeVariant) > 0 : store.has(activeCard.id);
        ownedButton.setAttribute("aria-pressed", String(isOwned));
        ownedButton.textContent = isOwned ? t("card.inCollection") : t("card.markOwned");
      }
    }

    function refreshWishlistButton() {
      const modal = document.getElementById("cardPreviewModal");
      if (!modal || !activeCard || !wishlist) return;
      const button = modal.querySelector(".preview-want");
      if (!button) return;
      const variant = activeVariant || defaultVariant(activeCard);
      const isWanted = wishlist.has(activeCard.id, variant);
      button.classList.toggle("active", isWanted);
      button.setAttribute("aria-pressed", String(isWanted));
      button.innerHTML = `${isWanted ? TILE_ICONS.heartFilled : TILE_ICONS.heart}<span>${escapeHtml(isWanted ? t("modal.wanted") : t("modal.want"))}</span>`;
    }

    // Compartilha a carta: usa o menu nativo (navigator.share) no celular e,
    // sem suporte, copia o link pra área de transferência com feedback rápido.
    function shareCard() {
      if (!activeCard) return;
      const label = cardLabel(activeCard);
      const text = `${label} · ${activeCard.set} ${activeCard.number}`;
      const url = location.href;
      if (navigator.share) {
        navigator.share({ title: label, text, url }).catch(() => {});
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(`${text} — ${url}`).then(() => {
          const span = document.querySelector("#cardPreviewModal .preview-share span");
          if (!span) return;
          const original = span.textContent;
          span.textContent = t("modal.shareCopied");
          setTimeout(() => { span.textContent = original; }, 1600);
        }).catch(() => {});
      }
    }

    return { open, close };
  }

  // Busca da carta nos marketplaces brasileiros (não têm API pública; o link
  // abre a busca pra conferir o preço e digitar no campo manual). Cada um tem
  // sua própria formatação de número (ver as helpers de query abaixo).
  const enc = (s) => encodeURIComponent(s);
  // Marketplaces por jogo (a rede "Liga" tem um site por TCG — ligapokemon /
  // ligalorcana — mesma plataforma de busca). No Lorcana só a LigaLorcana (BR);
  // LigaBRA/MYP são focados em Pokémon.
  function brMarketplaces(game) {
    if (game === "lorcana") {
      // Busca SÓ pelo nome (que já inclui a versão, ex.: "Hades - Looking for a
      // Deal"). A raridade entre parênteses — "(Legendary)", "(Enchanted)" — fazia
      // a busca da LigaLorcana não retornar nada; sem ela casa certo.
      return [
        { key: "liga", label: "LigaLorcana", url: (card) => `https://www.ligalorcana.com.br/?view=cards/search&card=${enc(card.name)}` }
      ];
    }
    return [
      { key: "liga", label: "LigaPokémon", url: (card) => `https://www.ligapokemon.com.br/?view=cards/search&card=${enc(paddedCardQuery(card, true))}` },
      { key: "ligabra", label: "LigaBRA", url: (card) => `https://ligabra.com/filter-products/${enc(cardSearchQuery(card))}` },
      { key: "myp", label: "MYP", url: (card) => `https://mypcards.com/pokemon?ProdutoSearch%5Bquery%5D=${enc(paddedCardQuery(card, false))}` }
    ];
  }

  // Mercado internacional/EUA — funciona pros dois jogos (eBay/TCGplayer/
  // PriceCharting têm Lorcana). A linha do TCGplayer e o texto de busca seguem o
  // jogo atual.
  function usMarketplaces(game) {
    const line = game === "lorcana" ? "lorcana" : "pokemon";
    return [
      { key: "ebay", label: "eBay", url: (card) => `https://www.ebay.com/sch/i.html?_nkw=${enc(usSearchText(card, game))}` },
      { key: "tcgplayer", label: "TCGplayer", url: (card) => `https://www.tcgplayer.com/search/${line}/product?productLineName=${line}&q=${enc(usSearchText(card, game))}` },
      { key: "pricecharting", label: "PriceCharting", url: (card) => `https://www.pricecharting.com/search-products?type=prices&q=${enc(usSearchText(card, game))}` }
    ];
  }

  function usSearchText(card, game) {
    const prefix = game === "lorcana" ? "lorcana" : "pokemon";
    return `${prefix} ${card.name} ${cardCode(card)}`.trim();
  }

  // Separa número e total ("4/102" -> {4,102}; ou number "4" + setTotal "102").
  function splitNumberTotal(card) {
    const raw = String(card.number || "").trim();
    let num = raw;
    let total = String(card.setTotal || "").trim();
    if (raw.includes("/")) {
      const parts = raw.split("/");
      num = parts[0].trim();
      if (!total) total = (parts[1] || "").trim();
    }
    return { num, total };
  }

  // "Nome (001/048)" pra Liga (padTotal=true) e "Nome (001/48)" pro MYP
  // (padTotal=false): esses sites zeram à esquerda o número (e a Liga o total).
  // Largura mínima 3 dígitos (ou a do total). Números não-numéricos ficam como vêm.
  function paddedCardQuery(card, padTotal) {
    const { num, total } = splitNumberTotal(card);
    if (!num) return card.name;
    if (!total) return `${card.name} (${num})`;
    const width = Math.max(3, total.length);
    const numPadded = /^\d+$/.test(num) ? num.padStart(width, "0") : num;
    const totalOut = padTotal && /^\d+$/.test(total) ? total.padStart(width, "0") : total;
    return `${card.name} (${numPadded}/${totalOut})`;
  }

  // Código da carta: "4/102" (número/total do set). Alguns catálogos já trazem
  // o número como "4/102"; nesse caso não duplica o total.
  function cardCode(card) {
    const number = String(card.number || "").trim();
    if (!number) return "";
    const total = String(card.setTotal || "").trim();
    if (number.includes("/") || !total) return number;
    return `${number}/${total}`;
  }

  // Nome exibido com o código: "Charizard (4/102)". Diferencia cartas com o
  // mesmo nome e é o formato Nome (número/total) que Liga e MYP usam nos títulos
  // dos produtos, então a busca nesses sites cai direto na carta certa.
  function cardLabel(card) {
    const code = cardCode(card);
    return code ? `${card.name} (${code})` : card.name;
  }

  function cardSearchQuery(card) {
    return cardLabel(card);
  }

  // Escapa um campo para CSV: usa ; como separador (amigável ao Excel pt-BR) e
  // protege valores com ; aspas ou quebra de linha.
  function csvCell(value) {
    const s = value == null ? "" : String(value);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // Monta o CSV do inventário: uma linha por carta/variante/condição com a
  // quantidade e o preço BR (quando houver). Preço com vírgula decimal pra
  // abrir certinho no Excel brasileiro.
  function buildCollectionCsv(store, prices, cardsById) {
    const collection = store.toObject();
    const priceData = prices ? prices.toObject() : {};
    const headers = ["ID", "Nome", "Código", "Set", "Número", "Raridade", "Idioma", "Variante", "Condição", "Quantidade", "Preço BR (R$)"];
    const rows = [headers];
    Object.keys(collection).sort().forEach((cardId) => {
      const card = cardsById.get(cardId) || { id: cardId };
      const variants = collection[cardId] || {};
      Object.keys(variants).forEach((variant) => {
        const conditions = variants[variant] || {};
        Object.keys(conditions).forEach((condition) => {
          const qty = conditions[condition];
          if (!(qty > 0)) return;
          const entry = priceData[cardId] && priceData[cardId][variant];
          const priceVal = entry && entry.prices && entry.prices[condition];
          const price = priceVal > 0 ? String(priceVal).replace(".", ",") : "";
          rows.push([
            cardId, card.name || "", cardCode(card), card.set || "", card.number || "",
            card.rarity || "", card.language || "", variant, condition, qty, price
          ]);
        });
      });
    });
    return rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
  }

  // Texto pesquisável de uma carta (nome, espécie, número, código, set, artista,
  // raridade, idioma e variantes), normalizado. Memoizado na própria carta — a
  // busca varre o catálogo inteiro (ex.: Sets/Artistas) a cada tecla, então
  // construir o texto uma vez só evita refazer ~48k normalizações por busca.
  function cardSearchHaystack(card) {
    if (card._haystack) return card._haystack;
    card._haystack = normalize([
      card.name, card.pokemonName, card.dexId, card.number, cardCode(card),
      card.set, card.artist, card.rarity, card.language, ...(card.variants || [])
    ].join(" "));
    return card._haystack;
  }

  // Busca tolerante: separa a query em termos e exige que TODOS estejam no
  // texto da carta. Assim funciona por nome ("bulbasaur"), por código ("95/165"
  // ou só "95") e por nome + código ("bulbasaur 95/165"). Parênteses são
  // ignorados, então colar "Bulbasaur (95/165)" também casa.
  function matchesCardQuery(card, rawQuery) {
    const query = normalize(rawQuery || "").replace(/[()]/g, " ").trim();
    if (!query) return true;
    const haystack = cardSearchHaystack(card);
    return query.split(/\s+/).every((term) => haystack.includes(term));
  }

  // Uma linha do grid: rótulo na 1ª coluna, chips na 2ª (os chips alinham entre
  // as linhas porque a coluna do rótulo tem a largura do maior rótulo).
  function marketplaceRow(labelKey, list, card) {
    const links = list
      .map(({ key, label, url }) => `<a class="br-link br-link-${key}" href="${escapeAttribute(url(card))}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`)
      .join("");
    return `<span class="br-links-label">${escapeHtml(t(labelKey))}</span><div class="br-links-chips">${links}</div>`;
  }

  function brMarketplaceLinks(card) {
    // O jogo vem da PRÓPRIA carta (card.game), não da sessão: uma carta Pokémon
    // mostra LigaPokémon mesmo numa sessão Lorcana, e vice-versa. Fallback pra
    // sessão só pra cartas sem tag (catálogos antigos).
    const game = card.game || currentGame();
    return `<div class="market-links">`
      + marketplaceRow("price.checkBr", brMarketplaces(game), card)
      + marketplaceRow("price.checkUs", usMarketplaces(game), card)
      + `</div>`;
  }

  // Grade de preços BR por condição de uma variante (inputs editáveis).
  function variantPriceRow(card, variant, prices) {
    const entry = prices.entry(card.id, variant);
    const cells = CARD_CONDITIONS.map((condition) => {
      const value = prices.getPrice(card.id, variant, condition);
      const display = value > 0 ? String(value).replace(".", ",") : "";
      return `
        <label class="price-cell">
          <span>${condition}</span>
          <input type="text" inputmode="decimal" placeholder="–" value="${escapeAttribute(display)}"
            data-price-card-id="${escapeAttribute(card.id)}" data-price-variant="${escapeAttribute(variant)}" data-price-condition="${condition}"
            aria-label="${escapeAttribute(t("price.inputAria", { variant, condition: t(`condition.${condition}`) }))}">
        </label>
      `;
    }).join("");
    const updated = entry && entry.updatedAt
      ? `<span class="price-updated">${escapeHtml(t("price.updatedAt", { date: entry.updatedAt }))}</span>`
      : "";
    return `
      <div class="price-row">
        <div class="price-row-head">
          <span class="price-row-label">${escapeHtml(t("price.rowLabel"))}</span>
          ${updated}
        </div>
        <div class="price-cells">${cells}</div>
      </div>
    `;
  }

  // Por variante: nome + total e um stepper por condição (M, NM, SP, MP, HP, D).
  // Cada cópia fica distinguida por condição para o cálculo futuro do portfólio.
  // Se `only` for informado, renderiza apenas aquela variante (o preview é
  // aberto a partir de um tile específico carta×variante, não da carta inteira).
  function variantQuantityRows(card, store, prices, only) {
    const all = card.variants && card.variants.length ? card.variants : [defaultVariant(card)];
    const variants = only && all.includes(only) ? [only] : all;
    return variants.map((variant) => {
      const total = store.variantTotal(card.id, variant);
      const conditions = CARD_CONDITIONS.map((condition) => {
        const quantity = store.getQuantity(card.id, variant, condition);
        const conditionName = t(`condition.${condition}`);
        return `
          <div class="condition-stepper${quantity > 0 ? " owned" : ""}">
            <span class="condition-label" title="${escapeAttribute(conditionName)}">${condition}</span>
            <div class="qty-stepper" aria-label="${escapeAttribute(conditionName)}">
              <button type="button" data-qty-action="dec" data-qty-card-id="${escapeAttribute(card.id)}" data-qty-variant="${escapeAttribute(variant)}" data-qty-condition="${condition}" aria-label="${escapeAttribute(t("qty.removeCondAria", { variant, condition: conditionName }))}" ${quantity === 0 ? "disabled" : ""}>−</button>
              <span class="qty-value">${quantity}</span>
              <button type="button" data-qty-action="inc" data-qty-card-id="${escapeAttribute(card.id)}" data-qty-variant="${escapeAttribute(variant)}" data-qty-condition="${condition}" aria-label="${escapeAttribute(t("qty.addCondAria", { variant, condition: conditionName }))}">+</button>
            </div>
          </div>
        `;
      }).join("");
      // Colapsado por padrão (<details>): a linha-resumo já mostra o que você tem
      // ("NM ×2 · M ×1"); expandir revela os steppers por condição + o Preço BR.
      // Economiza muito espaço vertical no preview.
      const breakdown = total > 0 ? conditionSummary(store, card.id, variant) : "";
      return `
        <details class="variant-conditions${total > 0 ? " owned" : ""}">
          <summary class="variant-conditions-head">
            <span class="variant-row-name variant-${escapeAttribute(variantSlug(variant))}">${escapeHtml(variant)}</span>
            ${breakdown
              ? `<span class="variant-breakdown">${escapeHtml(breakdown)}</span>`
              : `<span class="variant-breakdown variant-breakdown-empty">${escapeHtml(t("variant.manage"))}</span>`}
            <span class="variant-chevron" aria-hidden="true">▾</span>
          </summary>
          <div class="condition-grid">${conditions}</div>
          ${prices ? variantPriceRow(card, variant, prices) : ""}
        </details>
      `;
    }).join("");
  }

  // Resumo curto das condições de uma variante ("NM ×2 · M ×1") para o tile.
  function conditionSummary(store, cardId, variant) {
    return store.conditionBreakdown(cardId, variant)
      .map(({ condition, quantity }) => `${condition} ×${quantity}`)
      .join(" · ");
  }

  // Expande as cartas em pares carta×variante — cada par vira um tile na grade.
  function cardVariantPairs(sourceCards) {
    return sourceCards.flatMap((card) => {
      const variants = card.variants && card.variants.length ? card.variants : [defaultVariant(card)];
      return variants.map((variant) => ({ card, variant }));
    });
  }

  const TILE_ICONS = {
    binder: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    heart: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    heartFilled: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>'
  };

  function variantSlug(variant) {
    return normalize(variant).replace(/\s+/g, "-");
  }

  // Tile minimalista (imagem em destaque + nome, variante, set·número e ações).
  // Um tile por variante; quantidades além de 1 são ajustadas no preview da carta.
  // Snippet de preço do tile na moeda escolhida (vazio se sem valor). `≈` quando
  // vem da referência TCGdex ou de estimativa por condição.
  function tilePriceHtml(card, variant, prices) {
    const val = cardValue(card, variant, prices);
    if (!val.value) return "";
    const cls = val.source === "ref" ? "tile-price tile-price-ref" : "tile-price";
    const prefix = val.estimated ? "≈ " : "";
    const title = val.source === "ref" ? t("price.refTitle") : t("price.manualTitle");
    return `<p class="${cls}" title="${escapeAttribute(title)}">${escapeHtml(prefix + fmtMoney(val.currency, val.value))}</p>`;
  }

  function variantTile(card, variant, store, wishlist, prices, opts) {
    // addMode (página de busca): o botão sempre é "+" e cada clique soma +1 (com
    // feedback de ✓ por 2s). Fora dele, o botão alterna posse (liga/desliga).
    const addMode = !!(opts && opts.addMode);
    const quantity = store.variantTotal(card.id, variant);
    const isOwned = quantity > 0;
    const isWanted = wishlist ? wishlist.has(card.id, variant) : false;
    const article = document.createElement("article");
    article.className = `card-tile${isOwned ? " owned" : ""}${isWanted ? " wanted" : ""}`;
    article.dataset.tileCardId = card.id;
    article.dataset.tileVariant = variant;
    const img = cardImageSources(card, false);
    const imageInner = img.url
      ? localizedImg(img.url, { alt: card.name, loading: "lazy", thumb: true, fallback: img.fallback })
      : cardBackPlaceholder();
    const image = `<button class="image-open" data-preview-card-id="${escapeAttribute(card.id)}" data-preview-variant="${escapeAttribute(variant)}" aria-label="${escapeAttribute(t("card.zoom", { name: card.name }))}">${imageInner}</button>`;
    const ownAria = addMode
      ? (isOwned ? t("tile.addAnotherAria", { variant }) : t("tile.addAria", { variant }))
      : (isOwned ? t("tile.removeAria", { variant }) : t("tile.addAria", { variant }));
    // No addMode, mostra a contagem assim que tem 1 (o botão é sempre "+", então
    // o badge é o sinal de posse); fora dele, só destaca quando há mais de uma.
    const qtyBadge = quantity > (addMode ? 0 : 1) ? `<span class="tile-qty">×${quantity}</span>` : "";
    const ownIcon = addMode ? TILE_ICONS.plus : (isOwned ? TILE_ICONS.check : TILE_ICONS.plus);
    const ownActive = !addMode && isOwned ? " active" : "";
    const summary = conditionSummary(store, card.id, variant);
    const wantButton = wishlist
      ? `<button type="button" class="tile-btn tile-want${isWanted ? " active" : ""}" data-want-card-id="${escapeAttribute(card.id)}" data-want-variant="${escapeAttribute(variant)}" aria-pressed="${isWanted}" aria-label="${escapeAttribute(isWanted ? t("tile.unwantAria", { variant }) : t("tile.wantAria", { variant }))}" title="${escapeAttribute(isWanted ? t("tile.wanted") : t("tile.want"))}">${isWanted ? TILE_ICONS.heartFilled : TILE_ICONS.heart}</button>`
      : `<button type="button" class="tile-btn" disabled title="${escapeAttribute(t("tile.binder"))}" aria-label="${escapeAttribute(t("tile.binder"))}">${TILE_ICONS.binder}</button>`;

    article.innerHTML = `
      <div class="card-image">${image}</div>
      <div class="tile-info">
        <h3>${escapeHtml(cardLabel(card))}</h3>
        <p class="tile-variant variant-${escapeAttribute(variantSlug(variant))}">${cardFlag(card.language)}<span>${escapeHtml(variant)}</span></p>
        <p class="tile-set"><span>${escapeHtml(card.set)} · ${escapeHtml(card.number)}</span></p>
        ${tilePriceHtml(card, variant, prices)}
        <div class="tile-actions">
          ${wantButton}
          <button type="button" class="tile-btn tile-own${ownActive}" data-own-card-id="${escapeAttribute(card.id)}" data-own-variant="${escapeAttribute(variant)}" aria-pressed="${!addMode && isOwned}" aria-label="${escapeAttribute(ownAria)}">
            ${ownIcon}${qtyBadge}
          </button>
        </div>
        <p class="tile-conditions" data-tile-conditions>${escapeHtml(summary)}</p>
      </div>
    `;

    return article;
  }

  // Atualiza o estado de posse de um tile no DOM existente, sem recriar a
  // imagem — evita o "piscar" de recarregar a grade inteira.
  function refreshTileOwnership(tile, store, wishlist, opts) {
    const addMode = !!(opts && opts.addMode);
    const cardId = tile.dataset.tileCardId;
    const variant = tile.dataset.tileVariant;
    if (!cardId) return;
    const quantity = store.variantTotal(cardId, variant);
    const isOwned = quantity > 0;
    tile.classList.toggle("owned", isOwned);

    const button = tile.querySelector(".tile-own");
    // Em addMode, não toca num botão em pleno feedback de "✓ Adicionada!" (a flag
    // .added é removida pelo próprio timer do flash, que então restaura o "+").
    if (button && !(addMode && button.classList.contains("added"))) {
      if (addMode) {
        button.classList.remove("active");
        button.setAttribute("aria-pressed", "false");
        button.setAttribute("aria-label", isOwned ? t("tile.addAnotherAria", { variant }) : t("tile.addAria", { variant }));
        button.innerHTML = `${TILE_ICONS.plus}${quantity > 0 ? `<span class="tile-qty">×${quantity}</span>` : ""}`;
      } else {
        button.classList.toggle("active", isOwned);
        button.setAttribute("aria-pressed", String(isOwned));
        button.setAttribute("aria-label", isOwned ? t("tile.removeAria", { variant }) : t("tile.addAria", { variant }));
        button.innerHTML = `${isOwned ? TILE_ICONS.check : TILE_ICONS.plus}${quantity > 1 ? `<span class="tile-qty">×${quantity}</span>` : ""}`;
      }
    }

    if (wishlist) {
      const isWanted = wishlist.has(cardId, variant);
      tile.classList.toggle("wanted", isWanted);
      const wantButton = tile.querySelector(".tile-want");
      if (wantButton) {
        wantButton.classList.toggle("active", isWanted);
        wantButton.setAttribute("aria-pressed", String(isWanted));
        wantButton.setAttribute("aria-label", isWanted ? t("tile.unwantAria", { variant }) : t("tile.wantAria", { variant }));
        wantButton.setAttribute("title", isWanted ? t("tile.wanted") : t("tile.want"));
        wantButton.innerHTML = isWanted ? TILE_ICONS.heartFilled : TILE_ICONS.heart;
      }
    }

    const summaryEl = tile.querySelector("[data-tile-conditions]");
    if (summaryEl) summaryEl.textContent = conditionSummary(store, cardId, variant);
  }

  // Trata o clique no botão +/✓ de um tile (liga/desliga a variante; default NM).
  // Com wishlist, ao passar a ter a carta ela sai da lista de desejos ("comprei!").
  function handleOwnedTileClick(event, store, wishlist) {
    const button = event.target.closest("[data-own-card-id]");
    if (!button) return false;
    const cardId = button.dataset.ownCardId;
    const variant = button.dataset.ownVariant;
    store.toggleVariant(cardId, variant);
    if (wishlist && store.variantTotal(cardId, variant) > 0) {
      wishlist.remove(cardId, variant);
    }
    return true;
  }

  // Quick-add (página de busca): cada clique soma +1 NM da variante (nunca
  // remove — a remoção é na coleção/no preview). Retorna o botão clicado pra
  // dar o feedback visual, ou null se o clique não foi num botão de posse.
  function handleAddTileClick(event, store, wishlist) {
    const button = event.target.closest("[data-own-card-id]");
    if (!button) return null;
    const cardId = button.dataset.ownCardId;
    const variant = button.dataset.ownVariant;
    store.add(cardId, variant, DEFAULT_CONDITION, 1);
    if (wishlist && store.variantTotal(cardId, variant) > 0) wishlist.remove(cardId, variant);
    return button;
  }

  // Pisca o botão em "✓ Adicionada!" por 2s e depois volta ao "+", deixando o
  // badge ×N atualizado — assim dá pra clicar de novo e somar mais uma cópia.
  function flashTileAdded(button, store) {
    const variant = button.dataset.ownVariant;
    const qty = store.variantTotal(button.dataset.ownCardId, variant);
    const badge = qty > 0 ? `<span class="tile-qty">×${qty}</span>` : "";
    button.classList.add("added");
    button.setAttribute("title", t("tile.added"));
    button.innerHTML = `${TILE_ICONS.check}${badge}`;
    clearTimeout(button._flashTimer);
    button._flashTimer = window.setTimeout(() => {
      button.classList.remove("added");
      button.removeAttribute("title");
      const now = store.variantTotal(button.dataset.ownCardId, variant);
      button.innerHTML = `${TILE_ICONS.plus}${now > 0 ? `<span class="tile-qty">×${now}</span>` : ""}`;
    }, 2000);
  }

  // Trata o clique no botão de coração de um tile (liga/desliga "Eu quero").
  function handleWantTileClick(event, wishlist) {
    const button = event.target.closest("[data-want-card-id]");
    if (!button || !wishlist) return false;
    wishlist.toggle(button.dataset.wantCardId, button.dataset.wantVariant);
    return true;
  }

  // Trata cliques nos steppers de condição. Retorna true se o evento foi consumido.
  function handleQuantityClick(event, store) {
    const button = event.target.closest("[data-qty-action]");
    if (!button || button.disabled) return false;
    const delta = button.dataset.qtyAction === "inc" ? 1 : -1;
    store.add(button.dataset.qtyCardId, button.dataset.qtyVariant, button.dataset.qtyCondition || DEFAULT_CONDITION, delta);
    return true;
  }

  // Chaves perigosas num backup importado: bloqueia prototype pollution ao usar
  // o cardId/variante (vindos de arquivo não confiável) como chave de objeto.
  const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
  function isUnsafeKey(key) {
    return UNSAFE_KEYS.has(key);
  }

  // Preços BR do backup: mantém só valores numéricos positivos de cartas conhecidas.
  function parseImportedPrices(payload, cardsById) {
    const source = payload && payload.prices;
    if (!source || typeof source !== "object" || Array.isArray(source)) return {};
    const acceptAll = cardsById.size === 0; // sem catálogo: aceita como vem
    const result = {};
    Object.entries(source).forEach(([cardId, variants]) => {
      if (isUnsafeKey(cardId) || (!acceptAll && !cardsById.has(cardId)) || !variants || typeof variants !== "object") return;
      Object.entries(variants).forEach(([variant, entry]) => {
        if (isUnsafeKey(variant) || !entry || typeof entry !== "object" || !entry.prices) return;
        const clean = {};
        Object.entries(entry.prices).forEach(([condition, value]) => {
          const amount = Number(value);
          if (amount > 0 && CARD_CONDITIONS.includes(condition)) clean[condition] = Math.round(amount * 100) / 100;
        });
        if (Object.keys(clean).length) {
          result[cardId] = result[cardId] || {};
          result[cardId][variant] = {
            prices: clean,
            source: typeof entry.source === "string" ? entry.source : "manual",
            updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : ""
          };
        }
      });
    });
    return result;
  }

  // Lista de desejos do backup: cardId -> [variantes válidas da carta].
  function parseImportedWishlist(payload, cardsById) {
    const source = payload && payload.wishlist;
    if (!source || typeof source !== "object" || Array.isArray(source)) return {};
    const acceptAll = cardsById.size === 0; // sem catálogo: aceita como vem
    const wishlist = {};
    Object.entries(source).forEach(([cardId, variants]) => {
      if (isUnsafeKey(cardId)) return;
      const card = cardsById.get(cardId);
      if ((!card && !acceptAll) || !Array.isArray(variants)) return;
      const known = card && card.variants && card.variants.length ? card.variants : null;
      const list = known ? variants.filter((variant) => known.includes(variant)) : variants.filter(Boolean);
      if (list.length) wishlist[cardId] = list;
    });
    return wishlist;
  }

  function parseImportedCollection(payload, cardsById) {
    // Sem catálogo carregado (ex.: página Pokédex, que roda só com índices) não
    // dá para validar contra o catálogo — aceita os ids do backup como vêm.
    const acceptAll = cardsById.size === 0;

    // Formato v1: lista de ids -> 1ª variante, NM ×1.
    if (Array.isArray(payload.ownedCardIds)) {
      const collection = {};
      payload.ownedCardIds.forEach((cardId) => {
        if (!isUnsafeKey(cardId) && (acceptAll || cardsById.has(cardId))) {
          collection[cardId] = { [defaultVariant(cardsById.get(cardId))]: { [DEFAULT_CONDITION]: 1 } };
        }
      });
      return collection;
    }

    if (!payload.collection || typeof payload.collection !== "object" || Array.isArray(payload.collection)) {
      throw new Error("Arquivo sem collection ou ownedCardIds.");
    }

    const isV3 = payload.version >= 3;
    const collection = {};
    Object.entries(payload.collection).forEach(([cardId, variants]) => {
      if (isUnsafeKey(cardId) || (!acceptAll && !cardsById.has(cardId)) || !variants || typeof variants !== "object") return;
      const entry = {};
      Object.entries(variants).forEach(([variant, value]) => {
        if (isUnsafeKey(variant)) return;
        if (isV3 && value && typeof value === "object") {
          // v3: variante -> condição -> quantidade
          const conditions = {};
          Object.entries(value).forEach(([condition, quantity]) => {
            const parsed = Math.floor(Number(quantity));
            if (parsed > 0 && CARD_CONDITIONS.includes(condition)) conditions[condition] = parsed;
          });
          if (Object.keys(conditions).length) entry[variant] = conditions;
        } else {
          // v2: variante -> quantidade (vira NM)
          const parsed = Math.floor(Number(value));
          if (parsed > 0) entry[variant] = { [DEFAULT_CONDITION]: parsed };
        }
      });
      if (Object.keys(entry).length) collection[cardId] = entry;
    });
    return collection;
  }

  // Espera o catálogo do jogo (window.TCG_*) terminar de carregar. O game.js
  // injeta os scripts em runtime e resolve window.SLEEVU.catalogReady — sem isto
  // os globais ainda não existem. Fallback p/ páginas sem game.js (ex.: login).
  function awaitCatalog() {
    return (window.SLEEVU && window.SLEEVU.catalogReady) || Promise.resolve();
  }

  // `cardLang` opcional ("all" ou um idioma): no modo manifest baixa só os
  // chunks daquele idioma (corta o download — ex.: PT ~14k em vez de 48k);
  // no modo local filtra a amostra já carregada.
  async function loadCatalog(cardLang) {
    await awaitCatalog();
    const lang = cardLang || "all";
    const matches = (value) => lang === "all" || value === lang;

    if (Array.isArray(window.TCG_CARDS) && window.TCG_CARDS.length) {
      const cards = window.TCG_CARDS.filter((card) => matches(card.language));
      return { cards, indexes: window.TCG_INDEXES || null, manifest: window.TCG_MANIFEST || null };
    }

    const manifest = window.TCG_MANIFEST;
    if (manifest && Array.isArray(manifest.sets)) {
      const sets = manifest.sets.filter((set) => matches(set.language));
      const cards = await fetchSetChunks(sets);
      return { cards, indexes: window.TCG_INDEXES || null, manifest };
    }

    return { cards: [], indexes: null, manifest: null };
  }

  // Carga direcionada: baixa apenas os chunks dos sets que contêm os cardIds
  // informados (em vez do catálogo inteiro). Usada pela Coleção — que só precisa
  // das cartas que você tem. No modo local (amostra em window.TCG_CARDS) ou sem
  // manifest, cai no loadCatalog normal.
  async function loadCatalogForCardIds(cardIds) {
    await awaitCatalog();
    if (Array.isArray(window.TCG_CARDS) && window.TCG_CARDS.length) {
      return loadCatalog();
    }
    const manifest = window.TCG_MANIFEST;
    if (!manifest || !Array.isArray(manifest.sets)) return loadCatalog();
    const setIds = manifest.sets.map((set) => set.id);
    const needed = new Set();
    (cardIds || []).forEach((id) => {
      const setId = setIdForCard(id, setIds);
      if (setId) needed.add(setId);
    });
    const sets = manifest.sets.filter((set) => needed.has(set.id));
    const cards = await fetchSetChunks(sets);
    return { cards, indexes: window.TCG_INDEXES || null, manifest };
  }

  // Catálogo só com índices (sem baixar os chunks de carta). A Pokédex roda
  // com isto — espécies, contadores e progresso saem dos índices + coleção,
  // sem o custo de baixar dezenas de MB de cartas. No modo local o
  // window.TCG_CARDS (amostra pequena) já está presente e é reaproveitado.
  async function loadIndexesOnly() {
    await awaitCatalog();
    return {
      cards: Array.isArray(window.TCG_CARDS) ? window.TCG_CARDS : [],
      indexes: window.TCG_INDEXES || null,
      manifest: window.TCG_MANIFEST || null
    };
  }

  // ── Carga MULTI-JOGO (Coleção/Wishlist/Binders unificadas) ─────────────────
  // O catálogo é single-game: game.js carrega só o jogo da sessão nos globals
  // window.TCG_*. Pra ver os dois jogos numa página só, carregamos o catálogo de
  // CADA jogo (das cartas que você tem), marcando card.game, e unimos as tabelas
  // de preço de referência (os cardIds não colidem entre jogos).
  const DATA_GAMES = [
    { game: "pokemon", dataDir: "data/" },
    { game: "lorcana", dataDir: "data/lorcana/" }
  ];

  function injectScript(src) {
    return new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = false;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      (document.head || document.documentElement).appendChild(s);
    });
  }

  // Carrega o catálogo das cartas que você tem de UM jogo. Se for o jogo da
  // sessão, os globals já estão prontos — reaproveita. Senão, injeta os dados do
  // outro jogo em globals temporários, lê, e restaura os da sessão no fim.
  // `ids`: array de cardIds a carregar (carga direcionada) — ou null pro catálogo
  // INTEIRO daquele jogo (usado pelo seletor do Binder).
  async function loadGameCatalog(game, dataDir, ids) {
    const run = () => (ids == null ? loadCatalog() : loadCatalogForCardIds(ids));
    if ((window.SLEEVU && window.SLEEVU.game) === game) {
      const r = await run();
      return { cards: r.cards, indexes: r.indexes, pricing: window.TCG_PRICING || null };
    }
    const saved = {
      cards: window.TCG_CARDS, indexes: window.TCG_INDEXES, manifest: window.TCG_MANIFEST,
      pricing: window.TCG_PRICING, setIdMap: window.TCG_SET_ID_MAP
    };
    window.TCG_CARDS = window.TCG_INDEXES = window.TCG_MANIFEST = window.TCG_PRICING = undefined;
    const manifestMode = !!(window.SLEEVU && window.SLEEVU.manifest);
    const files = manifestMode
      ? ["manifest.generated.js", "indexes.generated.js", "pricing.generated.js", "set-id-map.js"]
      : ["cards.js", "indexes.js", "pricing.js", "set-id-map.js"];
    for (const f of files) await injectScript(dataDir + f);
    let r, pricing;
    try {
      r = await run();
      pricing = window.TCG_PRICING || null;
    } finally {
      window.TCG_CARDS = saved.cards; window.TCG_INDEXES = saved.indexes;
      window.TCG_MANIFEST = saved.manifest; window.TCG_PRICING = saved.pricing;
      window.TCG_SET_ID_MAP = saved.setIdMap;
    }
    return { cards: r.cards, indexes: r.indexes, pricing };
  }

  // Une catálogos dos jogos, cada carta marcada com card.game; window.TCG_PRICING
  // vira a UNIÃO das tabelas (pra cardValue achar a referência de qualquer jogo).
  async function loadAcrossGames(idsByGame) {
    await awaitCatalog(); // garante os globals do jogo da sessão antes de salvar/restaurar
    const cards = [];
    const indexesByGame = {};
    const mergedPricing = {};
    for (const { game, dataDir } of DATA_GAMES) {
      const ids = idsByGame ? (idsByGame[game] || []) : null; // null = catálogo inteiro
      // Resiliência: um jogo falhar (soluço de rede num chunk) não pode derrubar a
      // página toda — cai vazio só pra aquele jogo e segue.
      let r;
      try { r = await loadGameCatalog(game, dataDir, ids); }
      catch (e) { r = { cards: [], indexes: null, pricing: null }; }
      (r.cards || []).forEach((c) => { c.game = game; cards.push(c); });
      indexesByGame[game] = r.indexes || null;
      if (r.pricing) Object.assign(mergedPricing, r.pricing);
    }
    window.TCG_PRICING = mergedPricing;
    return { cards, indexesByGame };
  }

  // Só as cartas que você tem (Coleção/Wishlist): carga direcionada por jogo.
  function loadOwnedAcrossGames(idsByGame) { return loadAcrossGames(idsByGame || {}); }
  // Catálogo INTEIRO dos dois jogos (seletor do Binder).
  function loadAllGamesCatalog() { return loadAcrossGames(null); }

  // Facade que despacha cada método por jogo (resolvido por gameOf(cardId));
  // agregados (size/totalQuantity/...) somam os jogos. Deixa Coleção/Wishlist/
  // Binders usarem variantTile/preview/handlers sem saber que há vários jogos.
  function mergedCollectionStore(byGame, gameOf) {
    const list = () => Object.keys(byGame).map((g) => byGame[g]);
    const pick = (id) => byGame[gameOf(id)] || list()[0];
    return {
      has: (id) => pick(id).has(id),
      variantTotal: (id, v) => pick(id).variantTotal(id, v),
      totalForCard: (id) => pick(id).totalForCard(id),
      getQuantity: (id, v, c) => pick(id).getQuantity(id, v, c),
      conditionBreakdown: (id, v) => pick(id).conditionBreakdown(id, v),
      add: (id, v, c, d) => pick(id).add(id, v, c, d),
      toggleVariant: (id, v) => pick(id).toggleVariant(id, v),
      toggle: (card) => pick(card.id).toggle(card),
      toObject: () => { const o = {}; list().forEach((s) => Object.assign(o, s.toObject())); return o; },
      totalQuantity: () => list().reduce((sum, s) => sum + s.totalQuantity(), 0),
      get size() { return list().reduce((sum, s) => sum + s.size, 0); }
    };
  }

  function mergedWishlistStore(byGame, gameOf) {
    const list = () => Object.keys(byGame).map((g) => byGame[g]);
    const pick = (id) => byGame[gameOf(id)] || list()[0];
    return {
      has: (id, v) => pick(id).has(id, v),
      hasCard: (id) => pick(id).hasCard(id),
      toggle: (id, v) => pick(id).toggle(id, v),
      remove: (id, v) => pick(id).remove(id, v),
      variants: (id) => pick(id).variants(id),
      toObject: () => { const o = {}; list().forEach((s) => Object.assign(o, s.toObject())); return o; },
      get size() { return list().reduce((sum, s) => sum + s.size, 0); }
    };
  }

  function mergedPriceStore(byGame, gameOf) {
    const list = () => Object.keys(byGame).map((g) => byGame[g]);
    const pick = (id) => byGame[gameOf(id)] || list()[0];
    return {
      valueFor: (id, v, c) => pick(id).valueFor(id, v, c),
      getPrice: (id, v, c) => pick(id).getPrice(id, v, c),
      setPrice: (id, v, c, val, src) => pick(id).setPrice(id, v, c, val, src),
      entry: (id, v) => pick(id).entry(id, v)
    };
  }

  // Baixa os chunks de set com concorrência limitada (não 400+ fetches de uma
  // vez): o navegador serializa em ~6 por host de qualquer forma, e o limite
  // evita estourar memória/conexões em catálogos grandes.
  async function fetchSetChunks(entries, concurrency = 8) {
    const list = entries.slice();
    const chunks = [];
    async function worker() {
      while (list.length) {
        const entry = list.shift();
        const response = await fetch(entry.file);
        if (!response.ok) {
          throw new Error(`Falha ao carregar ${entry.file}: ${response.status}`);
        }
        chunks.push(...(await response.json()));
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
    return chunks;
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

      button.textContent = tn("pager.more", remaining);
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

  function detailUrl(type, name, scope) {
    const params = new URLSearchParams({ type, name });
    if (scope) params.set("scope", scope);
    return `detail.html?${params.toString()}`;
  }

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b)));
  }

  // Compara números de carta ("4/102", "199/165", "TG12/TG30") numericamente
  // pelo primeiro inteiro — localeCompare ordenaria "10" antes de "4".
  function compareCardNumbers(a, b) {
    const numA = parseInt(String(a).match(/\d+/), 10);
    const numB = parseInt(String(b).match(/\d+/), 10);
    if (!Number.isNaN(numA) && !Number.isNaN(numB) && numA !== numB) {
      return numA - numB;
    }
    return String(a).localeCompare(String(b));
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

  // Tipos de Pokémon (slugs em inglês, na ordem canônica) e cores associadas.
  const POKEMON_TYPES = [
    "normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison",
    "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy"
  ];

  const TYPE_COLORS = {
    normal: "#9fa19f", fire: "#e62829", water: "#2980ef", electric: "#fac000",
    grass: "#3fa129", ice: "#3dcef3", fighting: "#ff8000", poison: "#9141cb",
    ground: "#915121", flying: "#81b9ef", psychic: "#ef4179", bug: "#91a119",
    rock: "#afa981", ghost: "#704170", dragon: "#5060e1", dark: "#50413f",
    steel: "#60a1b8", fairy: "#ef70ef"
  };

  const REGION_BY_GENERATION = {
    1: "Kanto", 2: "Johto", 3: "Hoenn", 4: "Sinnoh", 5: "Unova",
    6: "Kalos", 7: "Alola", 8: "Galar", 9: "Paldea"
  };

  function typeLabel(slug) {
    const translated = t(`type.${slug}`);
    return translated === `type.${slug}` ? slug : translated;
  }

  function regionForGeneration(generation) {
    return REGION_BY_GENERATION[Number(generation)] || "";
  }

  // Numeral romano de 0–9 (gerações Pokémon). Fora desse intervalo devolve o
  // próprio número como texto.
  function toRoman(value) {
    const numerals = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];
    return numerals[Number(value)] || String(value);
  }

  function typesForDex(dexId) {
    const map = window.TCG_POKEMON_TYPES || {};
    return map[dexId] || [];
  }

  window.TCGShared = {
    createCollectionStore,
    createFavoritesStore,
    createWishlistStore,
    createPriceStore,
    brMarketplaceLinks,
    defaultVariant,
    CARD_CONDITIONS,
    CONDITION_MULTIPLIERS,
    DEFAULT_CONDITION,
    variantQuantityRows,
    cardVariantPairs,
    variantTile,
    refreshTileOwnership,
    gameKey,
    handleOwnedTileClick,
    handleAddTileClick,
    flashTileAdded,
    handleWantTileClick,
    handleQuantityClick,
    fetchPokemonMeta,
    createCardPreview,
    t,
    tn,
    getLanguage,
    getLocale,
    getCardLang,
    getCurrency,
    loadFxRates,
    sumCardsValue,
    formatMoney: fmtMoney,
    convertMoney,
    applyGameAccent,
    gameColorsEnabled,
    setGameColors,
    getTheme,
    setTheme,
    getLanguage,
    setLanguage,
    setCurrency,
    sensitiveEnabled,
    setSensitive,
    getProfile,
    setProfile,
    normalizeHandle,
    currentUser,
    collectionCounts,
    portfolioValueTotal,
    publicProfileUrl,
    analyticsSummary,
    pushProfile,
    pullProfile,
    handleAvailable,
    fetchPublicProfile,
    pushPublicProfile,
    deletePublicProfile,
    publishProfile,
    sendMagicLink,
    getSession,
    createShare,
    fetchShare,
    cardValue,
    formatMoney: fmtMoney,
    cardLanguageFromId,
    spriteUrl,
    matchesCardLang,
    applyTranslations,
    POKEMON_TYPES,
    TYPE_COLORS,
    REGION_BY_GENERATION,
    typeLabel,
    regionForGeneration,
    toRoman,
    typesForDex,
    cardFlag,
    cardFlagEmoji,
    cardLanguageLabel,
    cardLangSigla,
    cardLanguageRegion,
    localizedImg,
    cardImageSources,
    pokemontcgImageUrl,
    cardHasImage,
    cardCode,
    cardLabel,
    matchesCardQuery,
    awaitCatalog,
    loadCatalog,
    loadCatalogForCardIds,
    loadOwnedAcrossGames,
    loadAllGamesCatalog,
    mergedCollectionStore,
    mergedWishlistStore,
    mergedPriceStore,
    loadIndexesOnly,
    fetchSetChunks,
    setIdForCard,
    createPager,
    debounce,
    addOptions,
    detailUrl,
    unique,
    compareCardNumbers,
    normalize,
    escapeHtml,
    escapeAttribute,
    speciesName
  };

  // ===========================================================================
  // Login + sync na nuvem (Supabase), OPCIONAL. Sem SDK (CSP script-src 'self'):
  // tudo via fetch nos endpoints Auth (GoTrue) e REST (PostgREST). A URL e a
  // anon key são públicas (a segurança é a RLS por usuário). Local-first segue
  // sendo o padrão: sem login, nada muda.
  // ===========================================================================
  const SUPABASE_URL = "https://dlnalopazitfdgnmdguu.supabase.co";
  const SUPABASE_KEY = "sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL";
  const AUTH_ENABLED = /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(SUPABASE_URL) && !!SUPABASE_KEY;
  const SESSION_KEY = "tcg-supabase-session-v1";
  // Stores sincronizados (binders ficam de fora por ora: têm fotos no IndexedDB,
  // que não sobem pra nuvem).
  const SYNC_KEYS = {
    collection: gameKey("collection-v3"),
    collectionMeta: gameKey("collection-meta-v1"),
    wishlist: gameKey("wishlist-v1"),
    wishlistMeta: gameKey("wishlist-meta-v1"),
    prices: gameKey("prices-v1"),
    binders: "tcg-collector-binders-all-v1", // binders são globais (cross-game)
    folders: "tcg-collector-collection-folders-v1", // pastas da coleção (globais)
    sales: "tcg-collector-collection-sales-v1", // cartas à venda (globais)
    favorites: "tcg-collector-favorites-v1", // Pokémon favoritados (globais)
    favoritesMeta: "tcg-collector-favorites-meta-v1", // updatedAt p/ LWW dos favoritos
    history: gameKey("history-v1")
  };

  function authHeaders(token) {
    const h = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }
  // Sessão de login num cookie (em vez de só localStorage). O domínio fica em
  // .sleevu.app — hoje o site é único (sleevu.app), mas escopar no domínio-pai é
  // inócuo e evita ter que re-logar caso uma área sob *.sleevu.app volte a existir.
  // Fora de *.sleevu.app (localhost, *.pages.dev) cai no localStorage — um cookie
  // .sleevu.app nem setaria ali. O cookie NÃO é HttpOnly (o cliente roda em JS,
  // como a localStorage de hoje), mas é Secure + SameSite=Lax e o CSP 'self' limita
  // XSS. Guardamos só o essencial (user enxuto p/ id+email) pra caber bem abaixo
  // do teto de 4KB do cookie.
  const COOKIE_NAME = "sleevu_session";
  const COOKIE_MAX_AGE = 60 * 24 * 3600; // ~60 dias; renovado a cada setSession
  function sharedCookieDomain() {
    return /(^|\.)sleevu\.app$/i.test(location.hostname) ? ".sleevu.app" : null;
  }
  function readCookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function writeSessionCookie(value, domain) {
    let c = COOKIE_NAME + "=" + encodeURIComponent(value)
      + "; Path=/; Max-Age=" + COOKIE_MAX_AGE + "; SameSite=Lax; Secure";
    if (domain) c += "; Domain=" + domain;
    document.cookie = c;
  }
  function clearSessionCookie(domain) {
    let c = COOKIE_NAME + "=; Path=/; Max-Age=0; SameSite=Lax; Secure";
    if (domain) c += "; Domain=" + domain;
    document.cookie = c;
  }
  function readLocalSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; }
  }
  function getSession() {
    if (sharedCookieDomain()) {
      const raw = readCookie(COOKIE_NAME);
      if (raw) { try { return JSON.parse(raw); } catch (e) { /* cookie corrompido */ } }
      return readLocalSession(); // migração: usuário já logado tinha no localStorage
    }
    return readLocalSession();
  }
  function setSession(s) {
    const domain = sharedCookieDomain();
    if (s) {
      // Enxuga o user (só id+email são usados) pra o cookie caber com folga.
      const trimmed = {
        access_token: s.access_token,
        refresh_token: s.refresh_token,
        user: s.user ? { id: s.user.id, email: s.user.email } : s.user,
        ts: s.ts || Date.now()
      };
      if (domain) {
        writeSessionCookie(JSON.stringify(trimmed), domain);
        // Só descarta o localStorage legado se o cookie REALMENTE pegou — senão
        // um usuário já logado correria risco de cair (cookie = fonte única).
        if (readCookie(COOKIE_NAME)) { try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignora */ } }
      } else {
        try { localStorage.setItem(SESSION_KEY, JSON.stringify(trimmed)); } catch (e) { /* ignora */ }
      }
    } else {
      if (domain) clearSessionCookie(domain);
      try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignora */ }
    }
  }

  async function sendMagicLink(email) {
    const redirect = window.location.origin + window.location.pathname;
    const res = await fetch(`${SUPABASE_URL}/auth/v1/otp?redirect_to=${encodeURIComponent(redirect)}`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ email, create_user: true })
    });
    return res.ok;
  }
  async function fetchAuthUser(token) {
    try { const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: authHeaders(token) }); return r.ok ? r.json() : null; } catch (e) { return null; }
  }
  // Single-flight: o refresh_token do Supabase é de uso único (rotaciona). Se dois
  // refresh disparassem juntos (loop de 20s + visibilitychange), o segundo
  // receberia invalid_grant e deslogaria o usuário. Aqui um refresh em andamento
  // é compartilhado.
  let refreshInFlight = null;
  function refreshSession() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const s = getSession();
      if (!s || !s.refresh_token) return null;
      try {
        const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
          method: "POST", headers: authHeaders(), body: JSON.stringify({ refresh_token: s.refresh_token })
        });
        if (!r.ok) { setSession(null); return null; }
        const j = await r.json();
        const ns = { access_token: j.access_token, refresh_token: j.refresh_token, user: j.user, ts: Date.now() };
        setSession(ns);
        return ns;
      } catch (e) { return s; } // erro de rede: mantém a sessão, tenta de novo depois
    })();
    return refreshInFlight.finally(() => { refreshInFlight = null; });
  }
  async function authSignOut() {
    const s = getSession();
    if (s) { try { await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: "POST", headers: authHeaders(s.access_token) }); } catch (e) { /* ignora */ } }
    setSession(null);
    window.location.reload();
  }
  // Volta do e-mail: tokens vêm no hash (#access_token=...&refresh_token=...).
  async function consumeAuthRedirect() {
    if (!window.location.hash || window.location.hash.indexOf("access_token") < 0) return null;
    const p = new URLSearchParams(window.location.hash.slice(1));
    const access_token = p.get("access_token");
    const refresh_token = p.get("refresh_token");
    history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!access_token) return null;
    const user = await fetchAuthUser(access_token);
    if (!user) return null;
    const s = { access_token, refresh_token, user, ts: Date.now() };
    setSession(s);
    return s;
  }

  // --- Sync (merge sem perder dados) ---
  function localSnapshot() {
    const out = {};
    Object.entries(SYNC_KEYS).forEach(([k, key]) => {
      try { const v = JSON.parse(localStorage.getItem(key) || "null"); if (v) out[k] = v; } catch (e) { /* ignora */ }
    });
    return out;
  }
  function writeSnapshot(data) {
    if (!data) return;
    Object.entries(SYNC_KEYS).forEach(([k, key]) => { if (data[k] != null) localStorage.setItem(key, JSON.stringify(data[k])); });
  }
  // LWW-element-set por carta: para cada id, compara o "presente mais novo"
  // (mod) com o "apagado mais novo" (del); se a exclusão for mais recente que a
  // última edição, a carta fica de fora (e o tombstone é mantido pra propagar).
  // Uma edição com mod > del "revive". Cartas legadas sem timestamp contam como
  // mod=0 (sobrevivem até serem apagadas explicitamente em algum dispositivo).
  const TOMBSTONE_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 ano
  const TOMBSTONE_MAX = 4000;
  function pruneTombstones(del) {
    const cutoff = Date.now() - TOMBSTONE_TTL_MS;
    let ids = Object.keys(del).filter((id) => (Number(del[id]) || 0) >= cutoff);
    if (ids.length > TOMBSTONE_MAX) {
      ids = ids.sort((x, y) => (Number(del[y]) || 0) - (Number(del[x]) || 0)).slice(0, TOMBSTONE_MAX);
    }
    const out = {};
    ids.forEach((id) => { out[id] = Number(del[id]) || 0; });
    return out;
  }
  // Decide, por carta, se ela vive (e com qual mod-ts) ou morre. presentTs só
  // conta para lados que de fato têm a carta. Retorna { live, mod } ou null.
  function resolveCard(aHas, aMod, bHas, bMod, aDel, bDel) {
    const presentTs = Math.max(aHas ? aMod : 0, bHas ? bMod : 0);
    const delTs = Math.max(aDel, bDel);
    if (delTs > 0 && delTs > presentTs) return null; // exclusão vence
    return { live: true, mod: presentTs };
  }
  function mergeCollection(aCol, aMeta, bCol, bMeta) {
    aCol = aCol || {}; bCol = bCol || {};
    aMeta = normalizeMeta(aMeta); bMeta = normalizeMeta(bMeta);
    const ids = new Set([].concat(Object.keys(aCol), Object.keys(bCol), Object.keys(aMeta.del), Object.keys(bMeta.del)));
    const collection = {}; const mod = {}; const del = {};
    ids.forEach((id) => {
      const aHas = !!aCol[id], bHas = !!bCol[id];
      const r = resolveCard(aHas, Number(aMeta.mod[id]) || 0, bHas, Number(bMeta.mod[id]) || 0, Number(aMeta.del[id]) || 0, Number(bMeta.del[id]) || 0);
      if (!r) { del[id] = Math.max(Number(aMeta.del[id]) || 0, Number(bMeta.del[id]) || 0); return; }
      let entry;
      if (aHas && bHas) {
        entry = JSON.parse(JSON.stringify(aCol[id]));
        Object.entries(bCol[id]).forEach(([variant, conds]) => {
          entry[variant] = entry[variant] || {};
          Object.entries(conds || {}).forEach(([cond, qty]) => {
            entry[variant][cond] = Math.max(Number(entry[variant][cond]) || 0, Number(qty) || 0);
          });
        });
      } else {
        entry = JSON.parse(JSON.stringify(aHas ? aCol[id] : bCol[id]));
      }
      if (entry && Object.keys(entry).length) { collection[id] = entry; if (r.mod > 0) mod[id] = r.mod; }
    });
    return { collection, meta: { mod, del: pruneTombstones(del) } };
  }
  function mergeWishlist(aW, aMeta, bW, bMeta) {
    aW = aW || {}; bW = bW || {};
    aMeta = normalizeMeta(aMeta); bMeta = normalizeMeta(bMeta);
    const ids = new Set([].concat(Object.keys(aW), Object.keys(bW), Object.keys(aMeta.del), Object.keys(bMeta.del)));
    const wishlist = {}; const mod = {}; const del = {};
    ids.forEach((id) => {
      const aList = Array.isArray(aW[id]) ? aW[id] : [];
      const bList = Array.isArray(bW[id]) ? bW[id] : [];
      const r = resolveCard(!!aList.length, Number(aMeta.mod[id]) || 0, !!bList.length, Number(bMeta.mod[id]) || 0, Number(aMeta.del[id]) || 0, Number(bMeta.del[id]) || 0);
      if (!r) { del[id] = Math.max(Number(aMeta.del[id]) || 0, Number(bMeta.del[id]) || 0); return; }
      const set = new Set([].concat(aList, bList));
      if (set.size) { wishlist[id] = Array.from(set); if (r.mod > 0) mod[id] = r.mod; }
    });
    return { wishlist, meta: { mod, del: pruneTombstones(del) } };
  }
  function mergePrices(a, b) {
    const out = JSON.parse(JSON.stringify(a || {}));
    Object.entries(b || {}).forEach(([cardId, variants]) => {
      out[cardId] = out[cardId] || {};
      Object.entries(variants || {}).forEach(([variant, entry]) => {
        const cur = out[cardId][variant];
        // Mantém o registro com updatedAt mais recente.
        if (!cur || String(entry && entry.updatedAt) > String(cur.updatedAt)) out[cardId][variant] = entry;
      });
    });
    return out;
  }
  // Binders ({ binders: [...] }): une por id, mantendo o de updatedAt mais novo.
  // (As fotos ficam só no IndexedDB local; só a estrutura/cartas sincroniza.)
  function mergeBinders(a, b) {
    const al = (a && Array.isArray(a.binders)) ? a.binders : [];
    const bl = (b && Array.isArray(b.binders)) ? b.binders : [];
    // Tombstones de exclusão (id -> deletedAt). A exclusão mais nova vence; uma
    // edição com updatedAt > deletedAt "revive" o binder (deleção não propaga
    // sobre uma edição posterior). Resolve "binder apagado volta de outro device".
    const deleted = {};
    [a, b].forEach((side) => {
      const d = side && side.deleted;
      if (d && typeof d === "object") Object.keys(d).forEach((id) => {
        const ts = Number(d[id]) || 0;
        if (ts > (deleted[id] || 0)) deleted[id] = ts;
      });
    });
    const byId = new Map();
    al.concat(bl).forEach((bind) => {
      if (!bind || !bind.id) return;
      const prev = byId.get(bind.id);
      if (!prev || (Number(bind.updatedAt) || 0) > (Number(prev.updatedAt) || 0)) byId.set(bind.id, bind);
    });
    const binders = Array.from(byId.values()).filter((bind) => (deleted[bind.id] || 0) < (Number(bind.updatedAt) || 0));
    return { binders, deleted };
  }
  // Pastas da coleção ({ folders, assign, order, updatedAt }): LWW do BLOCO todo
  // pelo updatedAt (carimbado a cada mudança). É uma organização pessoal, quase
  // sempre editada num device por vez — o último a salvar vence. (Edição
  // concorrente nos dois ao mesmo tempo: a sincronizada por último ganha.)
  // LWW do bloco pelo updatedAt. Ambos ausentes → undefined (NÃO null): o
  // JSON.stringify OMITE undefined, então `merged` bate com o localSnapshot (que
  // também omite a chave) e o boot não entra em loop de reload. (null seria
  // mantido no JSON e nunca gravado pelo writeSnapshot → diff eterno = F5 infinito.)
  function mergeFolders(a, b) {
    if (a && b) return ((Number(b.updatedAt) || 0) > (Number(a.updatedAt) || 0)) ? b : a;
    return a || b || undefined;
  }
  // Vendas ({ sales, order, updatedAt }): mesmo LWW do bloco que as pastas.
  function mergeSales(a, b) {
    if (a && b) return ((Number(b.updatedAt) || 0) > (Number(a.updatedAt) || 0)) ? b : a;
    return a || b || undefined;
  }
  // Histórico do portfólio ([{ d, c, b, w }]): une por dia; em conflito o local
  // vence (foi recém-calculado a partir da coleção já mesclada). Teto de 800 dias.
  function mergeHistory(a, b) {
    const byDate = new Map();
    (Array.isArray(b) ? b : []).forEach((p) => { if (p && p.d) byDate.set(p.d, p); });
    (Array.isArray(a) ? a : []).forEach((p) => { if (p && p.d) byDate.set(p.d, p); });
    const out = Array.from(byDate.values()).sort((x, y) => String(x.d).localeCompare(String(y.d)));
    return out.length > 800 ? out.slice(out.length - 800) : out;
  }
  // Favoritos (lista de ids): LWW pelo updatedAt do meta — o lado com a mudança
  // MAIS RECENTE vence inteiro, então desfavoritar TAMBÉM propaga. Empate (ex.:
  // dados antigos sem timestamp, ts=0) → UNIÃO, pra nunca perder favorito na
  // migração. Mantém a ordem do local quando ele vence (não dispara reload à toa);
  // ausente nos dois → undefined (o JSON omite, evitando diff eterno).
  function mergeFavorites(a, aMeta, b, bMeta) {
    const arrA = Array.isArray(a) ? a : null;
    const arrB = Array.isArray(b) ? b : null;
    if (!arrA && !arrB) return { favorites: undefined, meta: undefined };
    const tsA = (aMeta && Number(aMeta.updatedAt)) || 0;
    const tsB = (bMeta && Number(bMeta.updatedAt)) || 0;
    if (tsA > tsB) return { favorites: arrA || [], meta: aMeta };
    if (tsB > tsA) return { favorites: arrB || [], meta: bMeta };
    return { favorites: Array.from(new Set([...(arrA || []), ...(arrB || [])])), meta: aMeta || bMeta };
  }
  function mergeData(localD, remoteD) {
    const a = localD || {}, b = remoteD || {};
    const col = mergeCollection(a.collection, a.collectionMeta, b.collection, b.collectionMeta);
    const wl = mergeWishlist(a.wishlist, a.wishlistMeta, b.wishlist, b.wishlistMeta);
    const fav = mergeFavorites(a.favorites, a.favoritesMeta, b.favorites, b.favoritesMeta);
    return {
      collection: col.collection,
      collectionMeta: col.meta,
      wishlist: wl.wishlist,
      wishlistMeta: wl.meta,
      prices: mergePrices(a.prices, b.prices),
      binders: mergeBinders(a.binders, b.binders),
      folders: mergeFolders(a.folders, b.folders),
      sales: mergeSales(a.sales, b.sales),
      favorites: fav.favorites,
      favoritesMeta: fav.meta,
      history: mergeHistory(a.history, b.history)
    };
  }
  // Observabilidade do sync: registra o resultado de cada pull/push (no console
  // e em localStorage) para a UI mostrar e o dev diagnosticar em produção.
  const SYNC_STATUS_KEY = "tcg-sync-status";
  function recordSync(op, ok, detail) {
    const status = { ts: Date.now(), op, ok: !!ok };
    if (!ok) { status.detail = String(detail || ""); console.warn(`[sync] ${op} falhou:`, detail); }
    try { localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(status)); } catch (e) { /* ignora */ }
  }
  function getSyncStatus() {
    try { return JSON.parse(localStorage.getItem(SYNC_STATUS_KEY) || "null"); } catch (e) { return null; }
  }
  // Jogo atual (multi-TCG): a coleção na nuvem é por (user_id, game), então
  // Pokémon e Lorcana não colidem na mesma conta. O jogo vem da sessão do site
  // (game.js); sem ele, "pokemon" (default do backend).
  function currentGame() { return (window.SLEEVU && window.SLEEVU.game) || "pokemon"; }

  async function pullRemote(token, uid) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/collections?user_id=eq.${uid}&game=eq.${currentGame()}&select=data`, { headers: authHeaders(token) });
      if (!r.ok) { recordSync("pull", false, `HTTP ${r.status}`); return null; }
      const rows = await r.json();
      recordSync("pull", true);
      return rows && rows[0] ? rows[0].data : {};
    } catch (e) { recordSync("pull", false, e && e.message); return null; }
  }
  async function pushRemote(token, uid, data, keepalive) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/collections?on_conflict=user_id,game`, {
        method: "POST",
        headers: Object.assign(authHeaders(token), { Prefer: "resolution=merge-duplicates,return=minimal" }),
        body: JSON.stringify({ user_id: uid, game: currentGame(), data, updated_at: new Date().toISOString() }),
        keepalive: !!keepalive
      });
      recordSync("push", r.ok, r.ok ? "" : `HTTP ${r.status}`);
    } catch (e) { recordSync("push", false, e && e.message); /* tenta de novo no próximo ciclo */ }
  }

  // --- Compartilhamento por link público (tabela `shares`) ---
  // Escrita exige login (RLS: auth.uid() = user_id); leitura é pública pelo id.
  async function createShare(kind, title, data) {
    let s = getSession();
    if (!s) return { error: "auth" };
    if (Date.now() - (s.ts || 0) > 50 * 60 * 1000) s = (await refreshSession()) || s;
    const body = JSON.stringify({ kind, game: currentGame(), title: title || null, data });
    const post = (tok) => fetch(`${SUPABASE_URL}/rest/v1/shares`, {
      method: "POST", body,
      headers: Object.assign(authHeaders(tok), { Prefer: "return=representation" })
    });
    try {
      let r = await post(s.access_token);
      if (r.status === 401) { const ns = await refreshSession(); if (ns) r = await post(ns.access_token); }
      if (!r.ok) return { error: "http" };
      const rows = await r.json();
      return rows && rows[0] && rows[0].id ? { id: rows[0].id } : { error: "empty" };
    } catch (e) { return { error: "net" }; }
  }
  async function fetchShare(id) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/shares?id=eq.${encodeURIComponent(id)}&select=kind,title,data,created_at`, { headers: authHeaders() });
      if (!r.ok) return null;
      const rows = await r.json();
      return rows && rows[0] ? rows[0] : null;
    } catch (e) { return null; }
  }
  // --- Perfil na nuvem (tabelas `profiles` + `public_profiles`) ---
  // Sobe o perfil (handle/nome/visibilidade). Exige login. 409 = @ já em uso.
  async function pushProfile() {
    let s = getSession();
    if (!s) return { error: "auth" };
    if (Date.now() - (s.ts || 0) > 50 * 60 * 1000) s = (await refreshSession()) || s;
    if (!s) return { error: "auth" };
    const p = getProfile();
    if (!p.handle) return { error: "no-handle" };
    const body = JSON.stringify({
      user_id: s.user.id, handle: p.handle, display_name: p.displayName || null,
      is_public: !!p.isPublic, show_values: !!p.showValues,
      updated_at: new Date(p.updatedAt || Date.now()).toISOString()
    });
    const post = (tok) => fetch(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=user_id`, {
      method: "POST", body,
      headers: Object.assign(authHeaders(tok), { Prefer: "resolution=merge-duplicates,return=minimal" })
    });
    try {
      let r = await post(s.access_token);
      if (r.status === 401) { const ns = await refreshSession(); if (ns) r = await post(ns.access_token); }
      if (r.status === 409) return { error: "taken" };
      return r.ok ? { ok: true } : { error: "http", status: r.status };
    } catch (e) { return { error: "net" }; }
  }
  // Puxa o próprio perfil da nuvem e mescla no local (LWW por updated_at). Boot.
  async function pullProfile() {
    const s = getSession();
    if (!s) return;
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${s.user.id}&select=handle,display_name,is_public,show_values,updated_at`, { headers: authHeaders(s.access_token) });
      if (!r.ok) return;
      const rows = await r.json();
      const remote = rows && rows[0];
      if (!remote) return;
      const rt = Date.parse(remote.updated_at) || 0;
      if (rt > (getProfile().updatedAt || 0)) {
        setProfile({ handle: remote.handle || "", displayName: remote.display_name || "", isPublic: !!remote.is_public, showValues: !!remote.show_values });
        const merged = getProfile(); merged.updatedAt = rt; // mantém o ts remoto p/ LWW
        try { localStorage.setItem(PROFILE_KEY, JSON.stringify(merged)); } catch (e) { /* ignora */ }
      }
    } catch (e) { /* ignora */ }
  }
  // @ disponível? (rpc security definer; ignora o próprio @). true/false | null=erro.
  async function handleAvailable(handle) {
    const s = getSession();
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/handle_available`, {
        method: "POST", headers: authHeaders(s && s.access_token), body: JSON.stringify({ p_handle: handle })
      });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }
  // Lê um perfil público pelo handle (anon). {handle,display_name,show_values,data}|null.
  async function fetchPublicProfile(handle) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/public_profiles?handle=eq.${encodeURIComponent(handle)}&select=handle,display_name,show_values,data,updated_at`, { headers: authHeaders() });
      if (!r.ok) return null;
      const rows = await r.json();
      return rows && rows[0] ? rows[0] : null;
    } catch (e) { return null; }
  }
  // Publica/atualiza o payload curado (coleção + vendas). Exige login + handle.
  async function pushPublicProfile(data) {
    let s = getSession();
    if (!s) return { error: "auth" };
    if (Date.now() - (s.ts || 0) > 50 * 60 * 1000) s = (await refreshSession()) || s;
    if (!s) return { error: "auth" };
    const p = getProfile();
    if (!p.handle) return { error: "no-handle" };
    const body = JSON.stringify({
      user_id: s.user.id, handle: p.handle, display_name: p.displayName || null,
      show_values: !!p.showValues, data: data || {}, updated_at: new Date().toISOString()
    });
    const post = (tok) => fetch(`${SUPABASE_URL}/rest/v1/public_profiles?on_conflict=user_id`, {
      method: "POST", body,
      headers: Object.assign(authHeaders(tok), { Prefer: "resolution=merge-duplicates,return=minimal" })
    });
    try {
      let r = await post(s.access_token);
      if (r.status === 401) { const ns = await refreshSession(); if (ns) r = await post(ns.access_token); }
      return r.ok ? { ok: true } : { error: "http", status: r.status };
    } catch (e) { return { error: "net" }; }
  }
  // Remove o perfil público (quando o usuário volta a privado).
  async function deletePublicProfile() {
    let s = getSession();
    if (!s) return;
    if (Date.now() - (s.ts || 0) > 50 * 60 * 1000) s = (await refreshSession()) || s;
    if (!s) return;
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/public_profiles?user_id=eq.${s.user.id}`, {
        method: "DELETE", headers: authHeaders(s.access_token)
      });
    } catch (e) { /* ignora */ }
  }

  // Lê a lista de vendas direto do localStorage (global), pra montar o payload
  // público sem depender da store da página de Vendas.
  function readSalesList() {
    try {
      const data = JSON.parse(localStorage.getItem(SYNC_KEYS.sales) || "{}");
      const map = data.sales || {};
      const order = Array.isArray(data.order) ? data.order : Object.keys(map);
      return order.filter((k) => map[k]).map((k) => {
        const e = map[k];
        return { cardId: e.cardId, variant: e.variant, price: Number(e.price) || 0, cond: e.cond || "NM" };
      });
    } catch (e) { return []; }
  }
  // Lê as Coleções (pastas) do localStorage global, p/ a vitrine do perfil público.
  function readFoldersData() {
    try {
      const d = JSON.parse(localStorage.getItem(SYNC_KEYS.folders) || "{}");
      return { folders: Array.isArray(d.folders) ? d.folders : [], assign: (d.assign && typeof d.assign === "object") ? d.assign : {} };
    } catch (e) { return { folders: [], assign: {} }; }
  }
  // Monta o payload CURADO do perfil público: coleção (valor de mercado só se
  // showValues) + lista de vendas + as Coleções (vitrine). Auto-contido (embute
  // detalhe da carta). `cards`=catálogo, `owned`=store da página, `prices`=preços.
  function buildPublicPayload(cards, owned, prices, showValues, currency) {
    const cur = currency || "BRL";
    const colItems = [];
    cardVariantPairs((cards || []).filter((c) => owned.has(c.id))).forEach(({ card, variant }) => {
      const qty = owned.variantTotal(card.id, variant);
      if (qty <= 0) return;
      const src = cardImageSources(card);
      let vbrl = 0;
      if (showValues) {
        const unit = cardValue(card, variant, prices).value || 0;
        const c = convertMoney(unit, cur, "BRL");
        vbrl = c == null ? 0 : Math.round(c * 100) / 100;
      }
      colItems.push({ id: card.id, n: card.name, s: card.set, num: card.number, lang: card.language, g: card.game, v: variant, q: qty, vbrl, img: src.url, fb: src.fallback || "" });
    });
    colItems.sort((a, b) => (b.vbrl * b.q) - (a.vbrl * a.q));
    const byId = new Map((cards || []).map((c) => [c.id, c]));
    const saleItems = [];
    readSalesList().forEach((it) => {
      const card = byId.get(it.cardId);
      if (!card) return;
      const src = cardImageSources(card);
      saleItems.push({ id: card.id, n: card.name, s: card.set, num: card.number, lang: card.language, g: card.game, v: it.variant, q: 1, sp: it.price, cond: it.cond || "NM", cur, img: src.url, fb: src.fallback || "" });
    });
    // Coleções (vitrine): marca cada carta com a sua coleção (f) e lista as
    // coleções que têm cartas (nome/estrelas/capa), na ordem do dono.
    const fdata = readFoldersData();
    colItems.forEach((it) => { const fid = fdata.assign[it.id]; if (fid) it.f = fid; });
    const used = new Set(colItems.map((it) => it.f).filter(Boolean));
    const pubFolders = fdata.folders
      .filter((f) => used.has(f.id))
      .map((f) => ({ id: f.id, name: f.name || "", stars: f.stars || 0, cover: f.cover || null }));

    return { collection: { items: colItems }, sales: { items: saleItems, cur, scope: "sale" }, folders: pubFolders, showValues: !!showValues };
  }
  // Publica/atualiza (ou apaga) o perfil público conforme is_public. Debounced e
  // só re-envia se o payload mudou. Chamado pelas páginas (coleção/vendas).
  let lastPublished = null;
  let publishT = null;
  function publishProfile(cards, owned, prices) {
    clearTimeout(publishT);
    publishT = setTimeout(async () => {
      const p = getProfile();
      if (!getSession() || !p.handle || p.handle.length < 3) return;
      if (!p.isPublic) {
        if (lastPublished !== "DELETED") { lastPublished = "DELETED"; await deletePublicProfile(); }
        return;
      }
      const payload = buildPublicPayload(cards, owned, prices, p.showValues, getCurrency());
      const json = JSON.stringify({ h: p.handle, n: p.displayName, sv: p.showValues, d: payload });
      if (json === lastPublished) return;
      lastPublished = json;
      await pushPublicProfile(payload);
    }, 1500);
  }

  // Apaga a conta na nuvem (RPC `delete_account` com security definer: remove
  // collections + shares + o usuário do auth). Retorna true se deu certo.
  async function deleteAccount() {
    let s = getSession();
    if (!s) return true;
    if (Date.now() - (s.ts || 0) > 50 * 60 * 1000) s = (await refreshSession()) || s;
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/delete_account`, {
        method: "POST", headers: authHeaders(s.access_token), body: "{}"
      });
      return r.ok;
    } catch (e) { return false; }
  }

  let lastPushed = "";
  // Lê a sessão na hora de cada push (pega o token renovado) e renova de forma
  // preguiçosa antes de expirar (token do Supabase dura ~1h) — sem isso o sync
  // morre silenciosamente depois de uma hora.
  async function syncPush(keepalive) {
    let s = getSession();
    if (!s) return;
    if (Date.now() - (s.ts || 0) > 50 * 60 * 1000) {
      s = (await refreshSession()) || getSession();
      if (!s) return;
    }
    const snap = localSnapshot();
    const json = JSON.stringify(snap);
    if (json === lastPushed) return;
    lastPushed = json;
    pushRemote(s.access_token, s.user.id, snap, keepalive);
  }
  function startSyncLoop() {
    setInterval(() => syncPush(false), 20000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") syncPush(true); });
    window.addEventListener("pagehide", () => syncPush(true));
  }

  // --- Troubleshooting (suporte): versão + limpar cache + forçar sync ---
  // Versão do app pro suporte saber o que o usuário está rodando. Bump junto com
  // o SHELL_CACHE do sw.js quando sair algo relevante.
  const APP_VERSION = "1.0.0";

  // Limpa SÓ os caches do app (Service Worker: código/catálogo/imagens) e
  // desregistra o SW — a coleção no localStorage fica intacta. Resolve "código
  // velho preso" / glitches sem perder dados. Recarrega no fim pra reinstalar.
  async function clearDataCache() {
    if (!window.confirm(t("ts.clearConfirm"))) return;
    try {
      if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); }
      if (navigator.serviceWorker) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map((r) => r.unregister())); }
    } catch (e) { /* best-effort: recarrega de qualquer jeito */ }
    window.location.reload();
  }

  // Puxa a versão mais recente da nuvem e mescla (mesmo fluxo do boot). Precisa
  // estar logado. Recarrega no fim pra refletir.
  async function forceSync(btn) {
    let session = getSession();
    if (!session) { window.alert(t("ts.syncNeedsLogin")); return; }
    const label = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "…"; }
    const fail = (msg) => { if (btn) { btn.disabled = false; btn.textContent = label; } window.alert(msg); };
    session = (await refreshSession()) || session;
    if (!getSession()) { fail(t("ts.syncNeedsLogin")); return; }
    const remote = await pullRemote(session.access_token, session.user.id);
    if (remote == null) { fail(t("ts.syncError")); return; }
    const merged = mergeData(localSnapshot(), remote);
    writeSnapshot(merged);
    await pushRemote(session.access_token, session.user.id, merged);
    window.location.reload();
  }

  // Modal de Troubleshooting (aberto pelo menu da conta e por qualquer
  // [data-open-troubleshoot], ex.: a página de Ajuda).
  function openTroubleshooting() {
    let modal = document.getElementById("troubleshootModal");
    if (!modal) { modal = document.createElement("div"); modal.id = "troubleshootModal"; modal.className = "ts-modal"; document.body.appendChild(modal); }
    const loggedIn = !!getSession();
    modal.innerHTML = `
      <div class="ts-backdrop" data-ts-close></div>
      <section class="ts-panel" role="dialog" aria-modal="true" aria-labelledby="tsTitle">
        <button type="button" class="ts-close" data-ts-close aria-label="${escapeAttribute(t("modal.close"))}">×</button>
        <h2 id="tsTitle">${escapeHtml(t("ts.title"))}</h2>
        <p class="ts-intro">${escapeHtml(t("ts.intro", { version: APP_VERSION }))}</p>
        <p class="ts-hint">${escapeHtml(t("ts.cacheHint"))}</p>
        <button type="button" class="secondary ts-action" data-ts-clear>${escapeHtml(t("ts.clearCache"))}</button>
        <p class="ts-hint">${escapeHtml(t("ts.syncHint"))}</p>
        <button type="button" class="secondary ts-action" data-ts-sync${loggedIn ? "" : " disabled"}>${escapeHtml(t("ts.forceSync"))}</button>
        ${loggedIn ? "" : `<p class="ts-note">${escapeHtml(t("ts.syncNeedsLogin"))}</p>`}
        <p class="ts-contact">${escapeHtml(t("ts.contact"))}
          <a href="mailto:contato@sleevu.app">contato@sleevu.app</a></p>
      </section>`;
    document.body.classList.add("preview-open");
    const close = () => { modal.remove(); document.body.classList.remove("preview-open"); };
    modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-ts-close]")) { close(); return; }
      if (event.target.closest("[data-ts-clear]")) { clearDataCache(); return; }
      if (event.target.closest("[data-ts-sync]")) { forceSync(event.target.closest("[data-ts-sync]")); return; }
    });
    document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); } });
  }

  // Qualquer link/botão com [data-open-troubleshoot] abre o modal (ex.: Ajuda).
  function initTroubleshootTriggers() {
    document.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-open-troubleshoot]");
      if (trigger) { event.preventDefault(); openTroubleshooting(); }
    });
  }

  function initAuth() {
    if (!AUTH_ENABLED) return;
    const actions = document.querySelector(".header-actions");
    if (!actions) return;

    const slot = document.createElement("div");
    slot.className = "auth-slot";
    actions.appendChild(slot);

    // --- Export/Import (agora vivem no menu da conta) ---
    function dl(content, filename, type) {
      const blob = new Blob([content], { type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    }
    function backupObject() {
      const payload = {
        version: 3, exportedAt: new Date().toISOString(),
        collection: createCollectionStore().toObject(),
        wishlist: createWishlistStore().toObject(),
        prices: createPriceStore().toObject()
      };
      try { const b = JSON.parse(localStorage.getItem(SYNC_KEYS.binders) || "null"); if (b) payload.binders = b; } catch (e) { /* ignora */ }
      try { const f = JSON.parse(localStorage.getItem(SYNC_KEYS.folders) || "null"); if (f) payload.folders = f; } catch (e) { /* ignora */ }
      try { const sa = JSON.parse(localStorage.getItem(SYNC_KEYS.sales) || "null"); if (sa) payload.sales = sa; } catch (e) { /* ignora */ }
      try { const fav = JSON.parse(localStorage.getItem(SYNC_KEYS.favorites) || "null"); if (Array.isArray(fav)) payload.favorites = fav; } catch (e) { /* ignora */ }
      return payload;
    }
    function exportJson() { dl(JSON.stringify(backupObject(), null, 2), "tcg-collection.json", "application/json"); }
    async function exportCsv() {
      let byId = new Map();
      try { const cat = await loadCatalog(); byId = new Map((cat.cards || []).map((c) => [c.id, c])); } catch (e) { /* CSV sem nomes */ }
      dl("﻿" + buildCollectionCsv(createCollectionStore(), createPriceStore(), byId), "tcg-collection.csv", "text/csv;charset=utf-8");
    }
    async function importJson(file) {
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) { alert(t("error.import")); return; }
      try {
        const payload = JSON.parse(await file.text());
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid");
        const byId = new Map();
        createCollectionStore().replace(parseImportedCollection(payload, byId));
        createWishlistStore().replace(parseImportedWishlist(payload, byId));
        createPriceStore().replace(parseImportedPrices(payload, byId));
        if (payload.binders && typeof payload.binders === "object") localStorage.setItem(SYNC_KEYS.binders, JSON.stringify(payload.binders));
        if (payload.folders && typeof payload.folders === "object") localStorage.setItem(SYNC_KEYS.folders, JSON.stringify(payload.folders));
        if (payload.sales && typeof payload.sales === "object") localStorage.setItem(SYNC_KEYS.sales, JSON.stringify(payload.sales));
        if (Array.isArray(payload.favorites)) localStorage.setItem(SYNC_KEYS.favorites, JSON.stringify(payload.favorites));
        window.location.reload();
      } catch (e) { alert(t("error.import")); }
    }

    // Importa o CSV exportado pelo Dex (dextcg.com). Formato: UTF-16, separado
    // por ";", colunas Type;Category;Locale;Series;Set;Id;Name;Variant;Rarity;
    // Quantity;Price. Os IDs são TCGdex (iguais aos do Sleevu), então é só casar
    // id+variante e gravar na coleção do Pokémon. Idempotente (re-importar dá o
    // mesmo resultado): cada (id, variante) fica com a quantidade do CSV.
    function mapDexVariant(v) {
      const s = String(v || "").toLowerCase().trim();
      if (!s || s === "normal") return "Normal";
      if (s.indexOf("1st edition") >= 0) return "1st Edition";
      if (s.indexOf("reverse") >= 0) return "Reverse";
      if (s.indexOf("holo") >= 0) return "Holo";
      return "Normal"; // promos diversos → carta base (Normal)
    }
    async function importDexCsv(file) {
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) { alert(t("error.import")); return; }
      try {
        const buf = await file.arrayBuffer();
        const b = new Uint8Array(buf);
        let text;
        if (b[0] === 0xFF && b[1] === 0xFE) text = new TextDecoder("utf-16le").decode(buf);
        else if (b[0] === 0xFE && b[1] === 0xFF) text = new TextDecoder("utf-16be").decode(buf);
        else text = new TextDecoder("utf-8").decode(buf);
        text = text.replace(/^﻿/, "");
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2) { alert(t("dex.empty")); return; }
        const header = lines[0].split(";").map((s) => s.trim().toLowerCase());
        const iType = header.indexOf("type"), iId = header.indexOf("id");
        const iVar = header.indexOf("variant"), iQty = header.indexOf("quantity");
        if (iId < 0 || iQty < 0) { alert(t("dex.badFormat")); return; }
        const agg = {}; // id -> variante -> qty
        let copies = 0;
        lines.slice(1).forEach((line) => {
          const r = line.split(";");
          if (iType >= 0 && String(r[iType] || "").trim().toLowerCase() !== "collection") return;
          const id = String(r[iId] || "").trim();
          const qty = parseInt(String(r[iQty] || "0").trim(), 10) || 0;
          if (!id || qty <= 0) return;
          const variant = mapDexVariant(r[iVar]);
          agg[id] = agg[id] || {};
          agg[id][variant] = (agg[id][variant] || 0) + qty;
        });
        const ids = Object.keys(agg);
        if (!ids.length) { alert(t("dex.empty")); return; }
        // Dex é Pokémon: grava na coleção do jogo pokemon.
        const store = createCollectionStore("pokemon");
        ids.forEach((id) => {
          Object.keys(agg[id]).forEach((variant) => {
            const target = agg[id][variant];
            const cur = store.getQuantity(id, variant, DEFAULT_CONDITION);
            store.add(id, variant, DEFAULT_CONDITION, target - cur); // seta = target
            copies += target;
          });
        });
        flushWrites(); // garante a persistência antes de navegar
        alert(t("dex.done", { cards: ids.length, copies }));
        window.location.href = "collection.html?game=pokemon";
      } catch (e) { alert(t("error.import")); }
    }

    // Instalar como app (PWA): só aparece quando dá pra instalar.
    const installItem = `<li class="lang-dd-option auth-install" role="menuitem" data-pwa-install hidden>${escapeHtml(t("pwa.install"))}</li>`;
    function updateInstallItem() {
      const el = slot.querySelector("[data-pwa-install]");
      if (el) el.hidden = !canInstallPWA();
    }
    async function pwaInstall() {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        try { await deferredInstallPrompt.userChoice; } catch (e) { /* ignora */ }
        deferredInstallPrompt = null;
        updateInstallItem();
      } else if (isIOSDevice()) {
        window.alert(t("pwa.iosHint"));
      }
    }
    document.addEventListener("sleevu:installable", updateInstallItem);

    // Atalhos de navegação (relativos — site único).
    const navItems = `<li class="auth-sep" aria-hidden="true"></li>
      <a class="lang-dd-option auth-link" role="menuitem" href="collection.html">${escapeHtml(t("nav.collection"))}</a>
      <a class="lang-dd-option auth-link" role="menuitem" href="portfolio.html?game=hub">${escapeHtml(t("nav.portfolio"))}</a>
      <a class="lang-dd-option auth-link" role="menuitem" href="hub.html">${escapeHtml(t("nav.explore"))}</a>`;
    // Apoiar (lugar do "assine" dos concorrentes — aqui é grátis, só doação).
    const supportItem = `<li class="auth-sep" aria-hidden="true"></li>
      <a class="lang-dd-option auth-link auth-support" role="menuitem" href="https://ko-fi.com/fernandopepe" target="_blank" rel="noopener">${escapeHtml(t("auth.support"))}</a>`;
    // Dados (export/import + importar do Dex).
    const dataItems = `<li class="auth-sep" aria-hidden="true"></li>
      <li class="lang-dd-option" role="menuitem" data-export-json>${escapeHtml(t("auth.exportJson"))}</li>
      <li class="lang-dd-option" role="menuitem" data-export-csv>${escapeHtml(t("auth.exportCsv"))}</li>
      <li class="lang-dd-option" role="menuitem" data-import>${escapeHtml(t("auth.import"))}</li>
      <li class="lang-dd-option" role="menuitem" data-import-dex>${escapeHtml(t("dex.import"))}</li>`;
    // Sobre (ajuda + troubleshooting + privacidade/termos).
    const aboutItems = `<li class="auth-sep" aria-hidden="true"></li>
      <a class="lang-dd-option auth-link" role="menuitem" href="settings.html">${escapeHtml(t("footer.settings"))}</a>
      <a class="lang-dd-option auth-link" role="menuitem" href="help.html">${escapeHtml(t("footer.help"))}</a>
      <li class="lang-dd-option" role="menuitem" data-troubleshoot>${escapeHtml(t("ts.title"))}</li>
      <a class="lang-dd-option auth-link" role="menuitem" href="privacy.html">${escapeHtml(t("footer.privacy"))}</a>
      <a class="lang-dd-option auth-link" role="menuitem" href="terms.html">${escapeHtml(t("footer.terms"))}</a>`;
    // Apagar dados (zona de perigo).
    const deleteItem = `<li class="auth-sep" aria-hidden="true"></li>
      <li class="lang-dd-option auth-danger" role="menuitem" data-delete-account>${escapeHtml(t("auth.deleteData"))}</li>`;

    // Apaga conta+nuvem (logado) ou só os dados locais (deslogado), e zera tudo.
    async function deleteAccountFlow() {
      const session = getSession();
      if (!window.confirm(session ? t("auth.deleteConfirmAccount") : t("auth.deleteConfirmLocal"))) return;
      if (session) {
        const ok = await deleteAccount();
        if (!ok) { window.alert(t("auth.deleteError")); return; }
      }
      // Bloqueia qualquer regravação pendente (stores em memória / flush no pagehide).
      dataWiped = true;
      pendingWrites.clear();
      try { Object.keys(localStorage).filter((k) => /^tcg-/.test(k)).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignora */ }
      try { if (window.indexedDB) indexedDB.deleteDatabase("tcg-collector"); } catch (e) { /* fotos de binder */ }
      window.location.replace(window.location.pathname);
    }
    const fileInput = `<input type="file" accept="application/json" data-import-input hidden aria-label="${escapeAttribute(t("auth.import"))}">
      <input type="file" accept=".csv,text/csv" data-import-dex-input hidden aria-label="${escapeAttribute(t("dex.import"))}">`;

    function wireDropdown() {
      const dd = slot.querySelector("#authDd");
      if (!dd) return;
      const toggle = dd.querySelector("[aria-haspopup]");
      const menu = dd.querySelector(".lang-dd-menu");
      toggle.addEventListener("click", () => { const open = menu.hidden; if (open) refreshSyncStatus(); menu.hidden = !open; toggle.setAttribute("aria-expanded", String(open)); });
      document.addEventListener("click", (e) => { if (!menu.hidden && !e.target.closest("#authDd")) menu.hidden = true; });
    }

    function renderLoggedOut() {
      // Deslogado: só o botão "Entrar" (vai direto pro login). Sem submenu —
      // o menu de conta só existe quando há sessão.
      slot.innerHTML = `<button type="button" class="secondary auth-acct auth-signin" data-auth-login>${escapeHtml(t("auth.signIn"))}</button>`;
    }
    function renderLoggedIn(session) {
      const email = (session.user && session.user.email) || "conta";
      const initial = (email.trim().charAt(0) || "?").toUpperCase();
      // Atalho pro hub de perfil do dono (profile.html). De lá se vê o perfil público.
      const profileItem = `<a class="lang-dd-option auth-link" role="menuitem" href="profile.html">${escapeHtml(t("profile.heading"))}</a>`;
      slot.innerHTML = `<div class="lang-dd auth-dd" id="authDd">
        <button type="button" class="auth-avatar" aria-haspopup="menu" aria-expanded="false" aria-label="${escapeAttribute(email)}" title="${escapeAttribute(email)}">${escapeHtml(initial)}</button>
        <ul class="lang-dd-menu auth-menu" role="menu" hidden>
          <li class="lang-dd-option auth-email">${escapeHtml(email)}</li>
          <li class="auth-sync" data-auth-sync></li>
          ${profileItem}
          ${installItem}
          ${navItems}
          ${supportItem}
          ${dataItems}
          ${aboutItems}
          ${deleteItem}
          <li class="auth-sep" aria-hidden="true"></li>
          <li class="lang-dd-option" role="menuitem" data-auth-logout>${escapeHtml(t("auth.signOut"))}</li>
        </ul>
        ${fileInput}
      </div>`;
      wireDropdown();
      updateInstallItem();
      refreshSyncStatus();
    }
    // Mostra o estado da última sincronização (lido na hora de abrir o menu).
    function refreshSyncStatus() {
      const el = slot.querySelector("[data-auth-sync]");
      if (!el) return;
      const s = getSyncStatus();
      if (!s) { el.textContent = t("auth.syncIdle"); el.className = "auth-sync"; return; }
      el.textContent = s.ok ? t("auth.syncOk") : t("auth.syncFail");
      el.className = "auth-sync " + (s.ok ? "ok" : "fail");
    }

    slot.addEventListener("click", async (event) => {
      if (event.target.closest("[data-auth-login]")) {
        // Página de login dedicada; guarda de onde veio pra voltar depois.
        try { localStorage.setItem("tcg-login-return", window.location.pathname); } catch (e) { /* ignora */ }
        window.location.href = "login.html";
        return;
      }
      if (event.target.closest("[data-pwa-install]")) { pwaInstall(); return; }
      if (event.target.closest("[data-export-json]")) { exportJson(); return; }
      if (event.target.closest("[data-export-csv]")) { exportCsv(); return; }
      if (event.target.closest("[data-import]")) { const inp = slot.querySelector("[data-import-input]"); if (inp) inp.click(); return; }
      if (event.target.closest("[data-import-dex]")) { const inp = slot.querySelector("[data-import-dex-input]"); if (inp) inp.click(); return; }
      if (event.target.closest("[data-troubleshoot]")) { openTroubleshooting(); return; }
      if (event.target.closest("[data-delete-account]")) { deleteAccountFlow(); return; }
      if (event.target.closest("[data-auth-logout]")) { authSignOut(); }
    });
    slot.addEventListener("change", (event) => {
      const inp = event.target.closest("[data-import-input]");
      if (inp && inp.files && inp.files[0]) { importJson(inp.files[0]); inp.value = ""; return; }
      const dexInp = event.target.closest("[data-import-dex-input]");
      if (dexInp && dexInp.files && dexInp.files[0]) { importDexCsv(dexInp.files[0]); dexInp.value = ""; }
    });

    (async function boot() {
      // 1) Acabou de voltar do e-mail? Cria sessão, sincroniza e recarrega.
      const fresh = await consumeAuthRedirect();
      if (fresh) {
        renderLoggedIn(fresh);
        const remote = await pullRemote(fresh.access_token, fresh.user.id);
        const merged = mergeData(localSnapshot(), remote);
        writeSnapshot(merged);
        await pushRemote(fresh.access_token, fresh.user.id, merged);
        await pullProfile();
        window.location.reload();
        return;
      }
      // 2) Sessão existente: renova, puxa o remoto e mescla (recarrega se mudou).
      let session = getSession();
      if (!session) { renderLoggedOut(); return; }
      session = await refreshSession() || session;
      if (!getSession()) { renderLoggedOut(); return; }
      renderLoggedIn(session);
      const remote = await pullRemote(session.access_token, session.user.id);
      if (remote) {
        const before = JSON.stringify(localSnapshot());
        const merged = mergeData(localSnapshot(), remote);
        const after = JSON.stringify(merged);
        if (after !== before) {
          writeSnapshot(merged);
          await pushRemote(session.access_token, session.user.id, merged);
          window.location.reload();
          return;
        }
        lastPushed = before;
      }
      pullProfile(); // sincroniza o perfil (handle/visibilidade) sem bloquear
      startSyncLoop();
    })();
  }

  // Título "Procurar:" acima do campo de busca (presente em todas as páginas).
  // É um <label> de verdade ligado ao campo (a11y: leitor de tela anuncia o
  // rótulo, e clicar nele foca a busca) — antes era só uma <div> decorativa.
  function initSearchLabel() {
    const section = document.querySelector(".page-search");
    if (!section) return;
    const prev = section.previousElementSibling;
    if (prev && prev.classList.contains("page-search-label")) return;
    const input = section.querySelector('input[type="search"], input[type="text"], input:not([type])');
    const label = document.createElement(input ? "label" : "div");
    label.className = "page-search-label";
    label.textContent = t("search.title");
    if (input) {
      if (!input.id) input.id = "pageSearchInput";
      label.setAttribute("for", input.id);
    }
    section.parentNode.insertBefore(label, section);
  }

  // Prefixa o título (H1) das páginas de explorar (Sets, Pokédex, Artistas,
  // Treinadores, Todas as cartas) com o nome do jogo que está sendo visto
  // (Pokémon/Lorcana), pra não confundir. Usa data-game + ::before (CSS), que
  // sobrevive ao re-translate do data-i18n (que reescreve só o textContent).
  function initPageGameTitle() {
    const nav = document.querySelector(".page-nav[data-active-page]");
    if (!nav) return;
    const GAME_TITLE_PAGES = ["pokedex", "sets", "artists", "trainers", "cards"];
    if (!GAME_TITLE_PAGES.includes(nav.dataset.activePage)) return;
    const game = (window.SLEEVU && window.SLEEVU.game) || "pokemon";
    const name = window.SLEEVU && window.SLEEVU.name;
    if (game === "hub" || !name) return;
    const h1 = document.querySelector(".page-head h1") || document.querySelector("main h1");
    if (h1) h1.dataset.game = name;
  }

  // Accent por contexto de jogo: vermelho (Pokémon), roxo (Lorcana), neutro (all).
  // Marca data-game-accent no <html>; o CSS troca --accent + tints. As páginas
  // unificadas (Coleção/Vendas) chamam applyGameAccent(filtro) ao trocar o jogo.
  // Pode ser DESLIGADO nas Configurações (pref local) — aí fica sempre neutro.
  const GAME_COLORS_PREF = "tcg-collector-pref-game-colors";
  function gameColorsEnabled() {
    try { return localStorage.getItem(GAME_COLORS_PREF) !== "off"; } catch (e) { return true; }
  }
  function applyGameAccent(value) {
    const v = gameColorsEnabled() && (value === "pokemon" || value === "lorcana") ? value : "all";
    document.documentElement.dataset.gameAccent = v;
  }
  function setGameColors(on) {
    try { localStorage.setItem(GAME_COLORS_PREF, on ? "on" : "off"); } catch (e) { /* ignora */ }
    initGameAccent(); // re-aplica o accent da página atual respeitando a pref
  }
  function initGameAccent() {
    const nav = document.querySelector(".page-nav[data-active-page]");
    const active = nav ? nav.dataset.activePage : "";
    // Páginas de um jogo só (explorar + detalhe da carta): seguem o jogo da sessão.
    const GAME_PAGES = ["pokedex", "sets", "artists", "trainers", "cards", "detail"];
    const g = (window.SLEEVU && window.SLEEVU.game) || "";
    applyGameAccent(GAME_PAGES.includes(active) ? g : "all");
  }

  applyTranslations();
  initLanguageSwitcher();
  initCurrencySwitcher();
  initSearchLabel();
  initPageNav();
  initPageGameTitle();
  initGameAccent();
  applySensitive();
  logPageview(); // analytics anônimo first-party (1 pageview por carregamento)
  injectCfBeacon(); // Cloudflare Web Analytics (só em produção)
  initMobileMenu();
  initSiteFooter();
  initPartnerBanner();
  initThemeToggle();
  initTroubleshootTriggers();
  initAuth();

  // Service worker: cacheia as imagens já vistas para sobreviverem a um outage
  // do CDN. Caminho relativo funciona tanto na raiz local quanto sob /tcg-collector/.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => { /* SW é só otimização: ignora falha */ });
    });
  }
})();
