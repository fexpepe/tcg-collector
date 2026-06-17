(function () {
  // Escrita coalescida no localStorage: várias mutações em sequência (ex.: vários
  // cliques no stepper +/−) viram UM único JSON.stringify + setItem, agendado para
  // o fim do task. Sempre faz flush no pagehide/aba oculta para não perder dado se
  // a página for fechada antes do timer disparar.
  const pendingWrites = new Map(); // storageKey -> () => string
  let writeScheduled = false;
  function flushWrites() {
    writeScheduled = false;
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
      scheduleWrite(storageKey, () => JSON.stringify(Array.from(ids)));
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
  function createCollectionStore() {
    const storageKey = "tcg-collector-collection-v3";
    const v2Key = "tcg-collector-collection-v2";
    const v1Key = "tcg-collector-owned-v1";
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
        save();
      },
      toggle(card) {
        if (this.has(card.id)) {
          delete collection[card.id];
        } else {
          collection[card.id] = { [defaultVariant(card)]: { [DEFAULT_CONDITION]: 1 } };
        }
        save();
      },
      replace(newCollection) {
        collection = newCollection;
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

  function createFavoritesStore() {
    return createIdStore("tcg-collector-favorites-v1");
  }

  // Lista "Eu quero": cardId -> [variantes desejadas]. Sem condição nem
  // quantidade — é só uma lista de desejos por variante, guardada à parte da
  // coleção. Quando a carta passa a ser possuída, ela sai daqui ("comprei!").
  function createWishlistStore() {
    const storageKey = "tcg-collector-wishlist-v1";
    let wishlist = readObject(storageKey) || {};

    function save() {
      scheduleWrite(storageKey, () => JSON.stringify(wishlist));
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
        save();
        return list.includes(variant);
      },
      remove(cardId, variant) {
        setVariants(cardId, variantsOf(cardId).filter((entry) => entry !== variant));
        save();
      },
      replace(next) {
        wishlist = next && typeof next === "object" && !Array.isArray(next) ? next : {};
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
  function createPriceStore() {
    const storageKey = "tcg-collector-prices-v1";
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
      if (ref.u > 0) { const v = convertMoney(ref.u, "USD", cur); if (v != null) return { value: v, currency: cur, source: "ref", estimated: true }; }
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

  const MESSAGES = {
    pt: {
      "lang.aria": "Idioma do site",
      "cardLang.aria": "Idioma das cartas",
      "cardLang.all": "Todas as línguas",
      "nav.pokemon": "Pokémon",
      "nav.explore": "Explorar",
      "nav.allCards": "Todas as cartas",
      "nav.home": "Início",
      "nav.pokedex": "Pokédex",
      "nav.sets": "Sets",
      "nav.artists": "Artistas",
      "nav.trainers": "Treinadores",
      "header.tagline": "Local-first MVP",
      "auth.signIn": "Entrar",
      "auth.signOut": "Sair",
      "auth.emailPrompt": "Seu e-mail para entrar (enviamos um link de acesso):",
      "auth.linkSent": "Link de acesso enviado! Confira seu e-mail (e o spam).",
      "auth.error": "Não foi possível enviar o link. Tente de novo.",
      "auth.account": "Conta",
      "auth.exportJson": "Exportar backup (.json)",
      "auth.exportCsv": "Exportar planilha (.csv)",
      "auth.import": "Importar backup",
      "title.home": "TCG Collector — sua coleção de Pokémon TCG, grátis",
      "title.pokedex": "Pokédex - TCG Collector",
      "title.sets": "Sets - TCG Collector",
      "title.artists": "Artistas - TCG Collector",
      "title.trainers": "Treinadores - TCG Collector",
      "title.detail": "Detalhe - TCG Collector",
      "nav.collection": "Coleção",
      "nav.collectionMine": "Minha coleção",
      "nav.binderCollection": "Binders · Coleção",
      "nav.binderSale": "Binders · Venda",
      "title.collection": "Coleção - TCG Collector",
      "title.cards": "Todas as cartas - TCG Collector",
      "cards.subtitle": "Busque em todo o catálogo de cartas, com os filtros de sempre.",
      "cards.intro": "Use a busca ou os filtros acima para encontrar qualquer carta do catálogo. Em breve: cartas <strong>em alta</strong> no site.",
      "search.placeholder.cards": "Carta, Pokémon, set, artista, número...",
      "results.heading.cards": "Cartas",
      "stats.distinct": "cartas distintas",
      "stats.copies": "cópias no total",
      "stats.setsCovered": "sets representados",
      "toolbar.pokemon": "Pokémon",
      "toolbar.rarity": "Raridade",
      "empty.collection": "Nenhuma carta da sua coleção com esses filtros. <a href=\"pokedex.html\">Explore a Pokédex</a> e marque o que você tem.",
      "collection.subtitle": "Pokémon, artistas, sets e idiomas que você está colecionando.",
      "collection.tab.pokemon": "Pokémon",
      "collection.tab.artists": "Artistas",
      "collection.tab.sets": "Sets",
      "collection.tab.languages": "Idiomas",
      "collection.tab.cards": "Cartas",
      "collection.summary.pokemon.one": "{o} / {t} cartas marcadas em {n} Pokémon",
      "collection.summary.pokemon.other": "{o} / {t} cartas marcadas em {n} Pokémon",
      "collection.summary.artists.one": "{o} / {t} cartas marcadas de {n} artista",
      "collection.summary.artists.other": "{o} / {t} cartas marcadas de {n} artistas",
      "collection.summary.sets.one": "{o} / {t} cartas marcadas em {n} set",
      "collection.summary.sets.other": "{o} / {t} cartas marcadas em {n} sets",
      "collection.summary.languages.one": "{o} / {t} cartas marcadas em {n} idioma",
      "collection.summary.languages.other": "{o} / {t} cartas marcadas em {n} idiomas",
      "tile.addAria": "Adicionar {variant} à coleção",
      "tile.removeAria": "Remover {variant} da coleção",
      "tile.binder": "Adicionar a um binder (em breve)",
      "tile.want": "Desejo essa carta",
      "tile.wanted": "Está na lista de desejos",
      "tile.wantAria": "Adicionar {variant} à lista de desejos",
      "tile.unwantAria": "Remover {variant} da lista de desejos",
      "nav.menu": "Abrir menu",
      "nav.wishlist": "Lista de Desejo",
      "title.wishlist": "Lista de Desejo - TCG Collector",
      "wishlist.subtitle": "As cartas que você marcou como \"eu desejo\". Marque uma como tenho para movê-la pra coleção.",
      "wishlist.stats.distinct": "cartas na lista",
      "wishlist.stats.sets": "sets desejados",
      "wishlist.results": "Cartas que eu desejo",
      "wishlist.markOwned": "Comprei!",
      "empty.wishlist": "Sua lista de desejos está vazia. <a href=\"pokedex.html\">Explore a Pokédex</a> e toque no ♡ das cartas que você quer.",
      "empty.wishlistFiltered": "Nenhuma carta da sua lista de desejos com esses filtros.",
      "price.rowLabel": "Preço BR (R$)",
      "currency.aria": "Moeda dos valores",
      "price.refTitle": "Valor de referência (TCGdex), convertido",
      "price.manualTitle": "Preço que você cadastrou",
      "value.total": "Valor total",
      "value.owned": "Já gasto (tenho)",
      "value.toBuy": "Falta (a comprar)",
      "portfolio.bindersValue": "valor dos binders",
      "portfolio.grandTotal": "total (coleção + binders)",
      "price.updatedAt": "atualizado em {date}",
      "price.inputAria": "Preço em reais de {variant} {condition}",
      "price.checkAt": "Conferir preço:",
      "price.checkBr": "Mercado brasileiro:",
      "price.checkUs": "Mercado EUA:",
      "market.title": "Cotação de mercado",
      "market.nonfoil": "Não-foil",
      "market.foil": "Foil",
      "market.min": "MÍN",
      "market.median": "MEDIANA",
      "market.max": "MÁX",
      "market.us": "EUA · TCGplayer",
      "market.eu": "Europa · Cardmarket",
      "market.br": "Brasil",
      "market.brSource": "MYP",
      "market.updated": "atualizado em {date}",
      "market.source": "Fontes: TCGdex (TCGplayer/EUA e Cardmarket/Europa) e MYP (Brasil). Valores convertidos para a moeda escolhida pelo câmbio do dia.",
      "market.loading": "Carregando cotação…",
      "nav.portfolio": "Portfólio",
      "title.portfolio": "Portfólio - TCG Collector",
      "portfolio.subtitle": "Valor estimado da sua coleção em reais, a partir dos preços que você registrou nas cartas.",
      "portfolio.total": "valor da coleção",
      "portfolio.pricedCopies": "cópias precificadas",
      "portfolio.wishlistTotal": "custo da wishlist",
      "portfolio.topCards": "Cartas mais valiosas",
      "portfolio.col.card": "Carta",
      "portfolio.col.variant": "Variante",
      "portfolio.col.condition": "Cond.",
      "portfolio.col.qty": "Qtd.",
      "portfolio.col.unit": "Unitário",
      "portfolio.col.total": "Total",
      "portfolio.estimated": "estimado pelo NM",
      "portfolio.empty": "Nenhuma carta com preço ainda. Abra uma carta da sua <a href=\"collection.html\">coleção</a>, confira o valor nos sites (Liga, LigaBRA, MYP) e registre no campo \"Preço BR\".",
      "portfolio.note": "Valores em R$ registrados manualmente por você. Condições sem preço próprio são estimadas a partir do NM (SP 85%, MP 70%, HP 50%, D 30%).",
      "nav.binders": "Binders",
      "nav.bindersCollection": "Coleção",
      "nav.bindersSale": "Venda",
      "title.binders": "Binders - TCG Collector",
      "title.bindersCollection": "Binders da coleção - TCG Collector",
      "title.bindersSale": "Binders de venda - TCG Collector",
      "binders.heading": "Binders",
      "binders.subtitle": "Monte fichários visuais das suas cartas, organize em páginas e exporte como imagem ou PDF.",
      "binders.collection.heading": "Binders da coleção",
      "binders.sale.heading": "Binders de venda",
      "binders.collection.subtitle": "Monte fichários visuais das suas cartas, no estilo 2×2 ou 3×3, e exporte como imagem para compartilhar.",
      "binders.sale.subtitle": "Monte vitrines das cartas que você está vendendo: foto sua, preço, condição e observação por carta. As fotos ficam só no seu navegador.",
      "binders.type": "Tipo",
      "binders.type.collection": "Coleção",
      "binders.type.sale": "Venda",
      "binders.template": "Template",
      "binders.template.none": "Nenhum",
      "binders.template.151": "Pokédex 151 (Kanto)",
      "binders.sort": "Ordenar",
      "binders.sort.newest": "Mais recentes",
      "binders.sort.name": "Nome",
      "binders.sort.cards": "Mais cartas",
      "binders.back": "Binders",
      "binders.save": "Salvar binder",
      "binders.saved": "Salvo ✓",
      "binders.open": "Abrir",
      "binders.duplicate": "Duplicar",
      "binders.copySuffix": "(cópia)",
      "binders.ownedOf": "{o}/{t} na coleção",
      "binders.new": "Novo binder",
      "binders.namePlaceholder": "Nome do binder",
      "binders.create": "Criar",
      "binders.cancel": "Cancelar",
      "binders.empty": "Você ainda não criou nenhum binder. Crie o primeiro acima.",
      "binders.grid": "Formato",
      "binders.grid.2x2": "2×2",
      "binders.grid.3x3": "3×3",
      "binders.grid.4x4": "4×4",
      "binders.grid.5x5": "5×5",
      "binders.page.add": "Nova página",
      "binders.page.indicator": "Página {n} de {total}",
      "binders.page.indicatorRange": "Páginas {a}–{b} de {total}",
      "binders.page.prev": "Página anterior",
      "binders.page.next": "Próxima página",
      "binders.page.remove": "Remover página",
      "binders.page.removeConfirm": "Remover esta página e as cartas dela?",
      "binders.settings": "Configurações",
      "binders.tab.cards": "Cartas",
      "binders.tab.summary": "Resumo",
      "binders.tab.edit": "Editar",
      "binders.tab.print": "Imprimir",
      "binders.settings.danger": "Excluir binder",
      "binders.settings.details": "Detalhes do binder",
      "binders.settings.description": "Descrição",
      "binders.settings.descriptionPlaceholder": "Opcional",
      "binders.settings.pages": "Número de páginas",
      "binders.settings.color": "Cor",
      "binders.settings.save": "Salvar detalhes",
      "binders.settings.whole": "Binder inteiro",
      "binders.settings.markOwned": "Marcar todas como tenho",
      "binders.settings.markMissing": "Marcar nenhuma como tenho",
      "binders.stat.pages": "Páginas",
      "binders.stat.cards": "Cartas",
      "binders.stat.owned": "Tenho",
      "binders.stat.missing": "Faltando",
      "binders.stat.progress": "Progresso da coleção",
      "binders.print.title": "Imprimir binder",
      "binders.print.formatLabel": "Formato:",
      "binders.print.includeLabel": "Incluir:",
      "binders.print.grid": "Grade do binder",
      "binders.print.pictures": "Lista com foto",
      "binders.print.checklist": "Checklist (texto)",
      "binders.print.optRealSize": "Tamanho real A4 (cartas 63×88mm)",
      "binders.print.optImages": "Imagens",
      "binders.print.optPrice": "Preço",
      "binders.print.optSet": "Set",
      "binders.print.optVariant": "Variante",
      "binders.print.optOwned": "Status (tenho)",
      "binders.print.go": "Imprimir",
      "binders.print.colName": "Carta",
      "binders.print.colCode": "Código",
      "binders.print.colSet": "Set",
      "binders.print.colVariant": "Variante",
      "binders.print.colPrice": "Preço",
      "binders.print.ownedYes": "Tenho",
      "binders.print.ownedNo": "Não tenho",
      "binders.print.blocked": "Permita pop-ups para abrir a página de impressão.",
      "binders.print.error": "Não foi possível gerar a impressão.",
      "binders.rename": "Renomear",
      "binders.delete": "Excluir",
      "binders.deleteConfirm": "Excluir este binder e as fotos dele? Esta ação não pode ser desfeita.",
      "binders.exportImage": "Exportar como imagem",
      "binders.exportTainted": "Não foi possível exportar (uma imagem do catálogo bloqueou o canvas). Tente um binder só com fotos suas.",
      "binders.slotEmpty": "Adicionar",
      "binders.slot.markOwned": "Tenho",
      "binders.slot.markMissing": "Marcar como não tenho",
      "binders.slot.ownedShort": "Tenho",
      "binders.cardsCount": "{n} carta(s)",
      "binders.saleTotal": "Total da vitrine",
      "binders.editor.title": "Editar slot",
      "binders.editor.tabCatalog": "Do catálogo",
      "binders.editor.tabCollection": "Da coleção",
      "binders.editor.tabWishlist": "Da lista de desejo",
      "binders.editor.search": "Buscar por nome, número (4/102)...",
      "binders.editor.loadingCatalog": "Carregando catálogo…",
      "binders.editor.noResults": "Nenhuma carta encontrada.",
      "binders.editor.selectedCount": "{n} selecionada(s) — preenchem os slots em ordem",
      "binders.editor.emptyCollection": "Sua coleção está vazia. Marque cartas como suas primeiro.",
      "binders.editor.emptyWishlist": "Sua lista de desejos está vazia.",
      "binders.editor.price": "Preço (R$)",
      "binders.editor.condition": "Condição",
      "binders.editor.note": "Observação",
      "binders.editor.notePlaceholder": "Ex.: vinco leve no canto",
      "binders.editor.save": "Adicionar",
      "binders.editor.clear": "Esvaziar slot",
      "binders.photoLimit": "Limite de {n} fotos atingido. Remova alguma para enviar outra.",
      "binders.photoError": "Não foi possível processar a imagem. Tente outra foto.",
      "binders.storageFull": "Armazenamento cheio: não foi possível salvar. Apague alguns binders ou fotos e tente de novo.",
      "sort.label": "Ordenar:",
      "sort.dex": "Nº Dex",
      "sort.name": "Nome",
      "sort.progress": "Progresso",
      "sort.releaseDate": "Lançamento",
      "sort.valueDesc": "Valor (maior → menor)",
      "sort.valueAsc": "Valor (menor → maior)",
      "sort.numDesc": "Nº da carta (maior → menor)",
      "sort.numAsc": "Nº da carta (menor → maior)",
      "stats.owned": "cartas marcadas",
      "stats.total": "cartas no catálogo",
      "stats.progress": "progresso",
      "stats.pageTotal": "cartas nessa página",
      "toolbar.search": "Busca",
      "toolbar.region": "Local",
      "toolbar.type": "Tipo",
      "cardLang.en": "Inglês",
      "cardLang.ja": "Japonês",
      "cardLang.zh": "Chinês (Tradicional)",
      "cardLang.pt": "Português (BR)",
      "setRegion.english": "Inglês",
      "setRegion.portuguese": "Português",
      "setRegion.japanese": "Japonês",
      "setRegion.chinese": "Chinês (Tradicional)",
      "toolbar.set": "Set",
      "toolbar.language": "Idioma",
      "toolbar.collection": "Coleção",
      "filter.all.f": "Todas",
      "filter.all.m": "Todos",
      "filter.owned": "Tenho",
      "filter.missing": "Faltando",
      "filter.wanted": "Lista de Desejo",
      "rarity.base": "Comuns e raras",
      "rarity.base.title": "Comum, Incomum e Rara",
      "rarity.special": "Especiais",
      "rarity.special.title": "As melhores cartas: Double Rare (ex), Ultra Rare, Illustration Rare, SAR, Full Art, Holo, Secreta/Rainbow/Hyper, Shiny e antigas raras",
      "search.title": "Procurar:",
      "toolbar.view": "Visualização",
      "view.grid": "Grade",
      "view.list": "Lista",
      "search.placeholder.pokedex": "Nome ou número da Pokédex...",
      "search.placeholder.sets": "Set, carta, artista, número...",
      "search.placeholder.artists": "Artista, carta, set, número...",
      "search.placeholder.trainers": "Treinador, set, número...",
      "search.placeholder.detail": "Carta, set, artista, número...",
      "results.heading.pokedex": "Pokémon",
      "results.heading.sets": "Sets",
      "results.heading.artists": "Artistas",
      "results.heading.trainers": "Treinadores",
      "results.heading.detail": "Cartas",
      "results.count.one": "{n} resultado",
      "results.count.other": "{n} resultados",
      "empty.pokedex": "Nenhuma carta encontrada com esses filtros.",
      "empty.sets": "Nenhum set encontrado com esses filtros.",
      "empty.artists": "Nenhum artista encontrado com esses filtros.",
      "empty.trainers": "Nenhum treinador encontrado com esses filtros.",
      "empty.detail": "Nenhuma carta encontrada nessa página.",
      "pager.more.one": "Mostrar mais ({n} restante)",
      "pager.more.other": "Mostrar mais ({n} restantes)",
      "chip.allGenerations": "Todas",
      "card.generation": "Geração {g}",
      "count.cards.one": "{n} carta",
      "count.cards.other": "{n} cartas",
      "count.marked.one": "{n} marcada",
      "count.marked.other": "{n} marcadas",
      "count.ofCards": "{o}/{t} cartas",
      "set.totalCardsLabel": "Total de cartas:",
      "set.totalValueLabel": "Valor total:",
      "set.officialCards": "{n} cartas oficiais",
      "set.inLocalCatalog": "{n} no catálogo local",
      "set.value": "≈ {v} no total",
      "set.valueTitle": "Soma estimada do valor de todas as cartas do set (preço de referência, na moeda escolhida).",
      "card.viewCards": "Ver cartas",
      "card.viewSet": "Ver set",
      "card.have": "Tenho",
      "card.haveTimes": "Tenho ×{n}",
      "card.missing": "Falta",
      "card.inCollection": "Tenho na coleção",
      "card.inCollectionTimes": "Tenho na coleção (×{n})",
      "card.markOwned": "Marcar como tenho",
      "card.noImage": "Sem imagem",
      "card.noImageFound": "Imagem não Encontrada",
      "card.unknownArtist": "Artista desconhecido",
      "card.zoom": "Ampliar {name}",
      "progress.aria": "Progresso de {name}",
      "qty.aria": "Quantidade de {variant}",
      "qty.addAria": "Adicionar uma {variant}",
      "qty.removeAria": "Remover uma {variant}",
      "qty.addCondAria": "Adicionar uma {variant} {condition}",
      "qty.removeCondAria": "Remover uma {variant} {condition}",
      "condition.M": "Mint (perfeita)",
      "condition.NM": "Near Mint (quase perfeita)",
      "condition.SP": "Slightly Played (pouco jogada)",
      "condition.MP": "Moderately Played (jogada)",
      "condition.HP": "Heavily Played (muito jogada)",
      "condition.D": "Damaged (danificada)",
      "modal.details": "Detalhes da carta",
      "modal.rarity": "Raridade",
      "modal.artist": "Artista",
      "modal.set": "Set",
      "modal.cardId": "ID da carta",
      "modal.close": "Fechar",
      "modal.share": "Compartilhar",
      "modal.shareCopied": "Link copiado!",
      "modal.want": "Lista de Desejo",
      "modal.wanted": "Na wishlist",
      "detail.loading": "Carregando",
      "detail.label": "Detalhe",
      "detail.scopeCollection": "Sua coleção",
      "detail.navAria": "Navegação entre Pokémon",
      "detail.back": "← Voltar",
      "detail.prevPokemon": "‹ Anterior",
      "detail.nextPokemon": "Próximo ›",
      "detail.label.pokemon": "Pokédex",
      "detail.label.set": "Set",
      "detail.label.artist": "Artista",
      "detail.label.trainer": "Treinador",
      "hero.cardsInCatalog.one": "{n} carta no catálogo local",
      "hero.cardsInCatalog.other": "{n} cartas no catálogo local",
      "favorite.add": "♡ Favoritar Pokémon",
      "favorite.active": "♥ Pokémon favoritado",
      "forms.toggle.one": "Ver a {n} forma desse Pokémon",
      "forms.toggle.other": "Ver as {n} formas desse Pokémon",
      "error.catalog": "Não foi possível carregar o catálogo: {message}",
      "error.cards": "Não foi possível carregar as cartas: {message}",
      "error.import": "Não foi possível importar esse arquivo de coleção.",
      "type.normal": "Normal",
      "type.fire": "Fogo",
      "type.water": "Água",
      "type.electric": "Elétrico",
      "type.grass": "Planta",
      "type.ice": "Gelo",
      "type.fighting": "Lutador",
      "type.poison": "Veneno",
      "type.ground": "Terra",
      "type.flying": "Voador",
      "type.psychic": "Psíquico",
      "type.bug": "Inseto",
      "type.rock": "Pedra",
      "type.ghost": "Fantasma",
      "type.dragon": "Dragão",
      "type.dark": "Sombrio",
      "type.steel": "Aço",
      "type.fairy": "Fada",
      "home.eyebrow": "Grátis · conta opcional · pra sempre",
      "home.title": "Sua coleção de Pokémon TCG, <span class=\"accent\">organizada</span>.",
      "home.sub": "Uma alternativa gratuita aos rastreadores pagos. Acompanhe cada carta por variante e quantidade — Holo, Reverse, 1st Edition — navegando por Pokédex, sets e artistas. Tudo direto no navegador: seus dados não saem daqui.",
      "home.ctaPokedex": "Abrir a Pokédex",
      "home.ctaSets": "Explorar sets",
      "home.note": "Todas as features são — e sempre serão — grátis: o que outros trackers cobram como \"pro\", aqui é 100% livre. Exporte e importe sua coleção em JSON quando quiser.",
      "home.cta": "Começar",
      "home.stats.pokemon": "Pokémon",
      "home.stats.cards": "cartas",
      "home.stats.sets": "sets",
      "home.stats.artists": "artistas",
      "home.features.title": "Feito para quem coleciona de verdade",
      "home.feature1.title": "Variantes e quantidades",
      "home.feature1.body": "Não é só \"tenho ou não tenho\": registre Holo ×2, Reverse ×1, 1st Edition ×1 — cada cópia conta.",
      "home.feature2.title": "Três jeitos de navegar",
      "home.feature2.body": "Pokédex com filtro por geração, sets com progresso de conclusão e cartas agrupadas por artista.",
      "home.feature3.title": "Seus dados são seus",
      "home.feature3.body": "A coleção fica no seu navegador, sem conta e sem nuvem obrigatória. Backup em JSON com um clique.",
      "home.feature4.title": "Grátis para sempre",
      "home.feature4.body": "Todas as features liberadas, incluindo o que outros cobram como \"pro\". O site se mantém com doações e parcerias de lojas — sem paywall, sem travar nada.",
      "home.how.title": "Como funciona",
      "home.step1.title": "Explore",
      "home.step1.body": "Busque por nome, número da Pokédex, set, artista ou raridade.",
      "home.step2.title": "Marque",
      "home.step2.body": "Registre cada variante que você tem, com a quantidade exata.",
      "home.step3.title": "Complete",
      "home.step3.body": "Acompanhe o progresso por Pokémon, por set e por artista.",
      "home.why.title": "Por que esse app existe",
      "home.why.lead": "Colecionar Pokémon TCG já é caro o bastante sem precisar pagar assinatura só pra anotar o que você já tem. Este projeto nasceu como um backlog local e gratuito — pra registrar cartas, montar coleções e criar listas de \"eu quero\", sem entregar seus dados pra ninguém.",
      "home.why.pill1.title": "Local e seu",
      "home.why.pill1.body": "A coleção fica no seu navegador. Exporte em JSON quando quiser e leve pra onde for.",
      "home.why.pill2.title": "Bilíngue e multimoeda",
      "home.why.pill2.body": "Catálogo em português e inglês, condições e valores em R$, USD e EUR — para você saber quanto a coleção vale na sua moeda.",
      "home.why.pill3.title": "Grátis de verdade",
      "home.why.pill3.body": "Sem recurso travado, sem plano \"pro\", sem paywall — até a sincronização na nuvem é grátis. O custo de servidor é coberto por doações e parcerias de lojas, nunca cobrando de você.",
      "home.roadmap.title": "Roadmap aberto",
      "home.roadmap.sub": "Em construção, melhorando sempre.",
      "home.roadmap.item1.title": "Listas \"Eu quero\"",
      "home.roadmap.item1.body": "Wishlist por variante e prioridade, com atalho \"comprei!\" que move pra coleção.",
      "home.roadmap.item2.title": "Binders 2×2 e 3×3",
      "home.roadmap.item2.body": "Fichários visuais de \"tenho\" e \"quero\", com exportar como imagem pra compartilhar.",
      "home.roadmap.item3.title": "Portfólio em R$",
      "home.roadmap.item3.body": "Valor estimado da coleção em R$, USD e EUR, com preço manual e cartas mais valiosas.",
      "home.roadmap.item4.title": "Sincronização na nuvem",
      "home.roadmap.item4.body": "Backup e sincronização entre dispositivos — grátis e opcional, sem travar nada.",
      "home.roadmap.link": "Veja o que vem por aí →",
      "home.support.title": "Gostou? Me paga um café ☕",
      "home.support.body": "Esse projeto é mantido por uma pessoa só, nas horas livres. Se ele te ajudou, um cafezinho ajuda a manter o site no ar e a continuar melhorando. Apoiar é 100% opcional — o app é e vai continuar grátis.",
      "home.support.pix": "Copiar chave Pix",
      "home.support.pixDone": "Chave Pix copiada!",
      "home.support.kofi": "Ko-fi · café internacional",
      "home.support.star": "⭐ Compartilhar com quem coleciona",
      "home.support.note": "Prefere ajudar de graça? Compartilhar com quem coleciona já faz diferença.",
      "home.footer.line1": "Grátis · sem conta · seus dados ficam no navegador.",
      "home.footer.line2": "Dados de cartas por <a href=\"https://tcgdex.dev\">TCGdex</a> · informações de Pokémon pela <a href=\"https://pokeapi.co\">PokéAPI</a>. Pokémon e Pokémon TCG são marcas de Nintendo / Creatures / GAME FREAK; este projeto não tem afiliação.",
      "footer.rights": "© {year} TCG Collector · Sem afiliação com Nintendo, Game Freak, Creatures, Niantic ou The Pokémon Company. Pokémon e Pokémon TCG são marcas registradas dos respectivos titulares.",
      "footer.credits": "Cartas por <a href=\"https://tcgdex.dev\">TCGdex</a> · Pokémon pela <a href=\"https://pokeapi.co\">PokéAPI</a>."
    },
    en: {
      "lang.aria": "Site language",
      "cardLang.aria": "Card language",
      "cardLang.all": "All languages",
      "nav.pokemon": "Pokémon",
      "nav.explore": "Explore",
      "nav.allCards": "All cards",
      "nav.home": "Home",
      "nav.pokedex": "Pokédex",
      "nav.sets": "Sets",
      "nav.artists": "Artists",
      "nav.trainers": "Trainers",
      "header.tagline": "Local-first MVP",
      "auth.signIn": "Sign in",
      "auth.signOut": "Sign out",
      "auth.emailPrompt": "Your email to sign in (we'll send a magic link):",
      "auth.linkSent": "Magic link sent! Check your email (and spam).",
      "auth.error": "Couldn't send the link. Please try again.",
      "auth.account": "Account",
      "auth.exportJson": "Export backup (.json)",
      "auth.exportCsv": "Export spreadsheet (.csv)",
      "auth.import": "Import backup",
      "title.home": "TCG Collector — your Pokémon TCG collection, free",
      "title.pokedex": "Pokédex - TCG Collector",
      "title.sets": "Sets - TCG Collector",
      "title.artists": "Artists - TCG Collector",
      "title.trainers": "Trainers - TCG Collector",
      "title.detail": "Detail - TCG Collector",
      "nav.collection": "Collection",
      "nav.collectionMine": "My collection",
      "nav.binderCollection": "Binders · Collection",
      "nav.binderSale": "Binders · Sale",
      "title.collection": "Collection - TCG Collector",
      "title.cards": "All cards - TCG Collector",
      "cards.subtitle": "Search the entire card catalog, with the usual filters.",
      "cards.intro": "Use the search or the filters above to find any card in the catalog. Coming soon: <strong>trending</strong> cards on the site.",
      "search.placeholder.cards": "Card, Pokémon, set, artist, number...",
      "results.heading.cards": "Cards",
      "stats.distinct": "distinct cards",
      "stats.copies": "total copies",
      "stats.setsCovered": "sets covered",
      "toolbar.pokemon": "Pokémon",
      "toolbar.rarity": "Rarity",
      "empty.collection": "No cards from your collection match these filters. <a href=\"pokedex.html\">Browse the Pokédex</a> and mark what you own.",
      "collection.subtitle": "Pokémon, artists, sets and languages you are actively collecting.",
      "collection.tab.pokemon": "Pokémon",
      "collection.tab.artists": "Artists",
      "collection.tab.sets": "Sets",
      "collection.tab.languages": "Languages",
      "collection.tab.cards": "Cards",
      "collection.summary.pokemon.one": "{o} / {t} cards collected across {n} Pokémon",
      "collection.summary.pokemon.other": "{o} / {t} cards collected across {n} Pokémon",
      "collection.summary.artists.one": "{o} / {t} cards collected from {n} artist",
      "collection.summary.artists.other": "{o} / {t} cards collected from {n} artists",
      "collection.summary.sets.one": "{o} / {t} cards collected across {n} set",
      "collection.summary.sets.other": "{o} / {t} cards collected across {n} sets",
      "collection.summary.languages.one": "{o} / {t} cards collected across {n} language",
      "collection.summary.languages.other": "{o} / {t} cards collected across {n} languages",
      "tile.addAria": "Add {variant} to collection",
      "tile.removeAria": "Remove {variant} from collection",
      "tile.binder": "Add to a binder (coming soon)",
      "tile.want": "Want this card",
      "tile.wanted": "On your wishlist",
      "tile.wantAria": "Add {variant} to wishlist",
      "tile.unwantAria": "Remove {variant} from wishlist",
      "nav.menu": "Open menu",
      "nav.wishlist": "Wishlist",
      "title.wishlist": "Wishlist - TCG Collector",
      "wishlist.subtitle": "The cards you marked as \"want\". Mark one as owned to move it into your collection.",
      "wishlist.stats.distinct": "cards on the list",
      "wishlist.stats.sets": "sets wanted",
      "wishlist.results": "Cards I want",
      "wishlist.markOwned": "Got it!",
      "empty.wishlist": "Your wishlist is empty. <a href=\"pokedex.html\">Browse the Pokédex</a> and tap the ♡ on cards you want.",
      "empty.wishlistFiltered": "No cards from your wishlist match these filters.",
      "price.rowLabel": "BR price (R$)",
      "currency.aria": "Display currency",
      "price.refTitle": "Reference value (TCGdex), converted",
      "price.manualTitle": "Price you set",
      "value.total": "Total value",
      "value.owned": "Owned value",
      "value.toBuy": "Left to buy",
      "portfolio.bindersValue": "binders value",
      "portfolio.grandTotal": "total (collection + binders)",
      "price.updatedAt": "updated {date}",
      "price.inputAria": "Price in BRL for {variant} {condition}",
      "price.checkAt": "Check price:",
      "price.checkBr": "Brazil market:",
      "price.checkUs": "US market:",
      "market.title": "Market quote",
      "market.nonfoil": "Non-foil",
      "market.foil": "Foil",
      "market.min": "MIN",
      "market.median": "MEDIAN",
      "market.max": "MAX",
      "market.us": "USA · TCGplayer",
      "market.eu": "Europe · Cardmarket",
      "market.br": "Brazil",
      "market.brSource": "MYP",
      "market.updated": "updated {date}",
      "market.source": "Sources: TCGdex (TCGplayer/USA and Cardmarket/Europe) and MYP (Brazil). Converted to the chosen currency at today's rate.",
      "market.loading": "Loading quote…",
      "nav.portfolio": "Portfolio",
      "title.portfolio": "Portfolio - TCG Collector",
      "portfolio.subtitle": "Estimated value of your collection in BRL, from the prices you registered on cards.",
      "portfolio.total": "collection value",
      "portfolio.pricedCopies": "priced copies",
      "portfolio.wishlistTotal": "wishlist cost",
      "portfolio.topCards": "Most valuable cards",
      "portfolio.col.card": "Card",
      "portfolio.col.variant": "Variant",
      "portfolio.col.condition": "Cond.",
      "portfolio.col.qty": "Qty",
      "portfolio.col.unit": "Unit",
      "portfolio.col.total": "Total",
      "portfolio.estimated": "estimated from NM",
      "portfolio.empty": "No priced cards yet. Open a card from your <a href=\"collection.html\">collection</a>, check its value on the BR marketplaces and register it in the \"BR price\" field.",
      "portfolio.note": "BRL values registered manually by you. Conditions without their own price are estimated from NM (SP 85%, MP 70%, HP 50%, D 30%).",
      "nav.binders": "Binders",
      "nav.bindersCollection": "Collection",
      "nav.bindersSale": "For sale",
      "title.binders": "Binders - TCG Collector",
      "title.bindersCollection": "Collection binders - TCG Collector",
      "title.bindersSale": "Sale binders - TCG Collector",
      "binders.heading": "Binders",
      "binders.subtitle": "Build visual binders of your cards, organize them in pages and export as image or PDF.",
      "binders.collection.heading": "Collection binders",
      "binders.sale.heading": "Sale binders",
      "binders.collection.subtitle": "Build visual 2×2 or 3×3 binders of your cards and export them as an image to share.",
      "binders.sale.subtitle": "Build showcases of the cards you're selling: your own photo, price, condition and a note per card. Photos stay only in your browser.",
      "binders.type": "Type",
      "binders.type.collection": "Collection",
      "binders.type.sale": "For sale",
      "binders.template": "Template",
      "binders.template.none": "None",
      "binders.template.151": "Pokédex 151 (Kanto)",
      "binders.sort": "Sort",
      "binders.sort.newest": "Newest",
      "binders.sort.name": "Name",
      "binders.sort.cards": "Most cards",
      "binders.back": "Binders",
      "binders.save": "Save binder",
      "binders.saved": "Saved ✓",
      "binders.open": "Open",
      "binders.duplicate": "Duplicate",
      "binders.copySuffix": "(copy)",
      "binders.ownedOf": "{o}/{t} owned",
      "binders.new": "New binder",
      "binders.namePlaceholder": "Binder name",
      "binders.create": "Create",
      "binders.cancel": "Cancel",
      "binders.empty": "You haven't created any binders yet. Create your first one above.",
      "binders.grid": "Layout",
      "binders.grid.2x2": "2×2",
      "binders.grid.3x3": "3×3",
      "binders.grid.4x4": "4×4",
      "binders.grid.5x5": "5×5",
      "binders.page.add": "New page",
      "binders.page.indicator": "Page {n} of {total}",
      "binders.page.indicatorRange": "Pages {a}–{b} of {total}",
      "binders.page.prev": "Previous page",
      "binders.page.next": "Next page",
      "binders.page.remove": "Remove page",
      "binders.page.removeConfirm": "Remove this page and its cards?",
      "binders.settings": "Settings",
      "binders.tab.cards": "Cards",
      "binders.tab.summary": "Summary",
      "binders.tab.edit": "Edit",
      "binders.tab.print": "Print",
      "binders.settings.danger": "Delete binder",
      "binders.settings.details": "Binder details",
      "binders.settings.description": "Description",
      "binders.settings.descriptionPlaceholder": "Optional",
      "binders.settings.pages": "Number of pages",
      "binders.settings.color": "Color",
      "binders.settings.save": "Save details",
      "binders.settings.whole": "Entire binder",
      "binders.settings.markOwned": "Mark all owned",
      "binders.settings.markMissing": "Mark all not owned",
      "binders.stat.pages": "Pages",
      "binders.stat.cards": "Cards",
      "binders.stat.owned": "Owned",
      "binders.stat.missing": "Missing",
      "binders.stat.progress": "Collection progress",
      "binders.print.title": "Print binder",
      "binders.print.formatLabel": "Format:",
      "binders.print.includeLabel": "Include:",
      "binders.print.grid": "Binder grid",
      "binders.print.pictures": "Picture list",
      "binders.print.checklist": "Checklist (text)",
      "binders.print.optRealSize": "Real size A4 (cards 63×88mm)",
      "binders.print.optImages": "Images",
      "binders.print.optPrice": "Price",
      "binders.print.optSet": "Set",
      "binders.print.optVariant": "Version",
      "binders.print.optOwned": "Owned status",
      "binders.print.go": "Print",
      "binders.print.colName": "Card",
      "binders.print.colCode": "Code",
      "binders.print.colSet": "Set",
      "binders.print.colVariant": "Version",
      "binders.print.colPrice": "Price",
      "binders.print.ownedYes": "Owned",
      "binders.print.ownedNo": "Not owned",
      "binders.print.blocked": "Allow pop-ups to open the print page.",
      "binders.print.error": "Couldn't generate the printout.",
      "binders.rename": "Rename",
      "binders.delete": "Delete",
      "binders.deleteConfirm": "Delete this binder and its photos? This can't be undone.",
      "binders.exportImage": "Export as image",
      "binders.exportTainted": "Couldn't export (a catalog image tainted the canvas). Try a binder with only your own photos.",
      "binders.slotEmpty": "Add",
      "binders.slot.markOwned": "Own it",
      "binders.slot.markMissing": "Mark as not owned",
      "binders.slot.ownedShort": "Owned",
      "binders.cardsCount": "{n} card(s)",
      "binders.saleTotal": "Showcase total",
      "binders.editor.title": "Edit slot",
      "binders.editor.tabCatalog": "From catalog",
      "binders.editor.tabCollection": "From collection",
      "binders.editor.tabWishlist": "From wishlist",
      "binders.editor.search": "Search by name, number (4/102)...",
      "binders.editor.loadingCatalog": "Loading catalog…",
      "binders.editor.noResults": "No cards found.",
      "binders.editor.selectedCount": "{n} selected — fill slots in order",
      "binders.editor.emptyCollection": "Your collection is empty. Mark cards as owned first.",
      "binders.editor.emptyWishlist": "Your wishlist is empty.",
      "binders.editor.price": "Price (R$)",
      "binders.editor.condition": "Condition",
      "binders.editor.note": "Note",
      "binders.editor.notePlaceholder": "e.g. light corner crease",
      "binders.editor.save": "Add",
      "binders.editor.clear": "Empty slot",
      "binders.photoLimit": "Photo limit of {n} reached. Remove one to upload another.",
      "binders.photoError": "Couldn't process the image. Try another photo.",
      "binders.storageFull": "Storage is full: couldn't save. Delete some binders or photos and try again.",
      "sort.label": "Sort:",
      "sort.dex": "Dex #",
      "sort.name": "Name",
      "sort.progress": "Progress",
      "sort.releaseDate": "Release Date",
      "sort.valueDesc": "Value (High → Low)",
      "sort.valueAsc": "Value (Low → High)",
      "sort.numDesc": "Card # (High → Low)",
      "sort.numAsc": "Card # (Low → High)",
      "stats.owned": "cards owned",
      "stats.total": "cards in catalog",
      "stats.progress": "progress",
      "stats.pageTotal": "cards on this page",
      "toolbar.search": "Search",
      "toolbar.region": "Region",
      "toolbar.type": "Type",
      "cardLang.en": "English",
      "cardLang.ja": "Japanese",
      "cardLang.zh": "Chinese (Traditional)",
      "cardLang.pt": "Brazilian Portuguese",
      "setRegion.english": "English",
      "setRegion.portuguese": "Portuguese",
      "setRegion.japanese": "Japanese",
      "setRegion.chinese": "Chinese (Traditional)",
      "toolbar.set": "Set",
      "toolbar.language": "Language",
      "toolbar.collection": "Collection",
      "filter.all.f": "All",
      "filter.all.m": "All",
      "filter.owned": "Owned",
      "filter.missing": "Missing",
      "filter.wanted": "Wishlist",
      "rarity.base": "Common & Rare",
      "rarity.base.title": "Common, Uncommon and Rare",
      "rarity.special": "Specials",
      "rarity.special.title": "The best cards: Double Rare (ex), Ultra Rare, Illustration Rare, SAR, Full Art, Holo, Secret/Rainbow/Hyper, Shiny and old chase rarities",
      "search.title": "Search:",
      "toolbar.view": "View",
      "view.grid": "Grid",
      "view.list": "List",
      "search.placeholder.pokedex": "Name or Pokédex number...",
      "search.placeholder.sets": "Set, card, artist, number...",
      "search.placeholder.artists": "Artist, card, set, number...",
      "search.placeholder.trainers": "Trainer, set, number...",
      "search.placeholder.detail": "Card, set, artist, number...",
      "results.heading.pokedex": "Pokémon",
      "results.heading.sets": "Sets",
      "results.heading.artists": "Artists",
      "results.heading.trainers": "Trainers",
      "results.heading.detail": "Cards",
      "results.count.one": "{n} result",
      "results.count.other": "{n} results",
      "empty.pokedex": "No cards match these filters.",
      "empty.sets": "No sets match these filters.",
      "empty.artists": "No artists match these filters.",
      "empty.trainers": "No trainers match these filters.",
      "empty.detail": "No cards found on this page.",
      "pager.more.one": "Show more ({n} left)",
      "pager.more.other": "Show more ({n} left)",
      "chip.allGenerations": "All",
      "card.generation": "Generation {g}",
      "count.cards.one": "{n} card",
      "count.cards.other": "{n} cards",
      "count.marked.one": "{n} owned",
      "count.marked.other": "{n} owned",
      "count.ofCards": "{o}/{t} cards",
      "set.totalCardsLabel": "Total Cards:",
      "set.totalValueLabel": "Total Value:",
      "set.officialCards": "{n} official cards",
      "set.inLocalCatalog": "{n} in local catalog",
      "set.value": "≈ {v} total",
      "set.valueTitle": "Estimated sum of all cards in the set (reference price, in the chosen currency).",
      "card.viewCards": "View cards",
      "card.viewSet": "View set",
      "card.have": "Owned",
      "card.haveTimes": "Owned ×{n}",
      "card.missing": "Missing",
      "card.inCollection": "In my collection",
      "card.inCollectionTimes": "In my collection (×{n})",
      "card.markOwned": "Mark as owned",
      "card.noImage": "No image",
      "card.noImageFound": "Image Not Found",
      "card.unknownArtist": "Unknown artist",
      "card.zoom": "Zoom into {name}",
      "progress.aria": "Progress for {name}",
      "qty.aria": "{variant} quantity",
      "qty.addAria": "Add one {variant}",
      "qty.removeAria": "Remove one {variant}",
      "qty.addCondAria": "Add one {condition} {variant}",
      "qty.removeCondAria": "Remove one {condition} {variant}",
      "condition.M": "Mint",
      "condition.NM": "Near Mint",
      "condition.SP": "Slightly Played",
      "condition.MP": "Moderately Played",
      "condition.HP": "Heavily Played",
      "condition.D": "Damaged",
      "modal.details": "Card details",
      "modal.rarity": "Rarity",
      "modal.artist": "Artist",
      "modal.set": "Set",
      "modal.cardId": "Card ID",
      "modal.close": "Close",
      "modal.share": "Share",
      "modal.shareCopied": "Link copied!",
      "modal.want": "Wishlist",
      "modal.wanted": "On wishlist",
      "detail.loading": "Loading",
      "detail.label": "Detail",
      "detail.scopeCollection": "Your collection",
      "detail.navAria": "Pokémon navigation",
      "detail.back": "← Back",
      "detail.prevPokemon": "‹ Previous",
      "detail.nextPokemon": "Next ›",
      "detail.label.pokemon": "Pokédex",
      "detail.label.set": "Set",
      "detail.label.artist": "Artist",
      "detail.label.trainer": "Trainer",
      "hero.cardsInCatalog.one": "{n} card in local catalog",
      "hero.cardsInCatalog.other": "{n} cards in local catalog",
      "favorite.add": "♡ Favorite this Pokémon",
      "favorite.active": "♥ Favorited",
      "forms.toggle.one": "See this Pokémon's {n} form",
      "forms.toggle.other": "See this Pokémon's {n} forms",
      "error.catalog": "Could not load the catalog: {message}",
      "error.cards": "Could not load the cards: {message}",
      "error.import": "Could not import this collection file.",
      "type.normal": "Normal",
      "type.fire": "Fire",
      "type.water": "Water",
      "type.electric": "Electric",
      "type.grass": "Grass",
      "type.ice": "Ice",
      "type.fighting": "Fighting",
      "type.poison": "Poison",
      "type.ground": "Ground",
      "type.flying": "Flying",
      "type.psychic": "Psychic",
      "type.bug": "Bug",
      "type.rock": "Rock",
      "type.ghost": "Ghost",
      "type.dragon": "Dragon",
      "type.dark": "Dark",
      "type.steel": "Steel",
      "type.fairy": "Fairy",
      "home.eyebrow": "Free · account optional · forever",
      "home.title": "Your Pokémon TCG collection, <span class=\"accent\">organized</span>.",
      "home.sub": "A free alternative to paid trackers. Track every card by variant and quantity — Holo, Reverse, 1st Edition — browsing by Pokédex, sets and artists. All in your browser: your data never leaves it.",
      "home.ctaPokedex": "Open the Pokédex",
      "home.ctaSets": "Browse sets",
      "home.note": "Every feature is — and always will be — free: what other trackers charge for as \"pro\" is 100% free here. Export and import your collection as JSON anytime.",
      "home.cta": "Get started",
      "home.stats.pokemon": "Pokémon",
      "home.stats.cards": "cards",
      "home.stats.sets": "sets",
      "home.stats.artists": "artists",
      "home.features.title": "Built for real collectors",
      "home.feature1.title": "Variants and quantities",
      "home.feature1.body": "It's not just \"have it or not\": log Holo ×2, Reverse ×1, 1st Edition ×1 — every copy counts.",
      "home.feature2.title": "Three ways to browse",
      "home.feature2.body": "Pokédex with generation filters, sets with completion progress, and cards grouped by artist.",
      "home.feature3.title": "Your data is yours",
      "home.feature3.body": "Your collection lives in your browser — no account, no mandatory cloud. One-click JSON backup.",
      "home.feature4.title": "Free forever",
      "home.feature4.body": "Every feature unlocked, including what others charge for as \"pro\". The site runs on donations and store partnerships — no paywall, nothing locked.",
      "home.how.title": "How it works",
      "home.step1.title": "Browse",
      "home.step1.body": "Search by name, Pokédex number, set, artist or rarity.",
      "home.step2.title": "Track",
      "home.step2.body": "Log every variant you own, with exact quantities.",
      "home.step3.title": "Complete",
      "home.step3.body": "Track progress per Pokémon, per set and per artist.",
      "home.why.title": "Why this app exists",
      "home.why.lead": "Collecting Pokémon cards is expensive enough without paying a subscription just to log what you own. This project started as a local, online backlog — to register cards, build collections and create \"want\" lists, without handing your data to anyone.",
      "home.why.pill1.title": "Local and yours",
      "home.why.pill1.body": "Your collection lives in your browser. Export it as JSON anytime and take it anywhere.",
      "home.why.pill2.title": "Bilingual & multi-currency",
      "home.why.pill2.body": "Catalog in English and Portuguese, with values in BRL, USD and EUR — so you know what your collection is worth in your own currency.",
      "home.why.pill3.title": "Genuinely free",
      "home.why.pill3.body": "No locked features, no \"pro\" plan, no paywall — even cloud sync is free. Server costs are covered by donations and store partnerships, never by charging you.",
      "home.roadmap.title": "Open roadmap",
      "home.roadmap.sub": "Always improving.",
      "home.roadmap.item1.title": "\"Want\" lists",
      "home.roadmap.item1.body": "Wishlist by variant and priority, with a \"got it!\" shortcut that moves a card into your collection.",
      "home.roadmap.item2.title": "2×2 and 3×3 binders",
      "home.roadmap.item2.body": "Visual binders for owned and wanted cards, with export-as-image to share.",
      "home.roadmap.item3.title": "Portfolio value",
      "home.roadmap.item3.body": "Estimated collection value in BRL, USD and EUR, with manual pricing and your most valuable cards.",
      "home.roadmap.item4.title": "Cloud sync",
      "home.roadmap.item4.body": "Backup and sync across devices — free and optional, never locking anything.",
      "home.roadmap.link": "See what's coming →",
      "home.support.title": "Like it? Buy me a coffee ☕",
      "home.support.body": "This project is maintained by one person, in spare time. If it helped you, a coffee helps keep the site online and improving. Supporting is 100% optional — the app is and will stay free.",
      "home.support.pix": "Copy Pix key",
      "home.support.pixDone": "Pix key copied!",
      "home.support.kofi": "Ko-fi · international coffee",
      "home.support.star": "⭐ Share with fellow collectors",
      "home.support.note": "Rather help for free? Sharing with fellow collectors already goes a long way.",
      "home.footer.line1": "Free · no account · your data stays in your browser.",
      "home.footer.line2": "Card data by <a href=\"https://tcgdex.dev\">TCGdex</a> · Pokémon info from <a href=\"https://pokeapi.co\">PokéAPI</a>. Pokémon and Pokémon TCG are trademarks of Nintendo / Creatures / GAME FREAK; this project is not affiliated.",
      "footer.rights": "© {year} TCG Collector · Not affiliated with Nintendo, Game Freak, Creatures, Niantic or The Pokémon Company. Pokémon and Pokémon TCG are trademarks of their respective owners.",
      "footer.credits": "Cards by <a href=\"https://tcgdex.dev\">TCGdex</a> · Pokémon from <a href=\"https://pokeapi.co\">PokéAPI</a>."
    }
  };

  function t(key, vars) {
    const table = MESSAGES[currentLanguage] || MESSAGES.pt;
    let text = table[key] != null ? table[key] : MESSAGES.pt[key];
    if (text == null) return key;
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
    const exploreActive = ["pokedex", "trainers", "sets", "artists", "cards"].includes(active);
    const collectionActive = ["collection", "wishlist", "binders"].includes(active);

    const link = (href, key, page) => `<a href="${href}"${page === active ? ' class="active"' : ""}>${escapeHtml(t(key))}</a>`;
    const group = (key, isActive, links) => `
      <div class="nav-group">
        <button type="button" class="nav-group-toggle${isActive ? " active" : ""}" aria-expanded="false" aria-haspopup="true">
          ${escapeHtml(t(key))}<span class="nav-caret" aria-hidden="true">▾</span>
        </button>
        <div class="nav-dropdown" hidden>${links}</div>
      </div>`;

    nav.innerHTML = `
      ${link("index.html", "nav.home", "home")}
      ${group("nav.explore", exploreActive, `
          ${link("pokedex.html", "nav.pokemon", "pokedex")}
          ${link("trainers.html", "nav.trainers", "trainers")}
          ${link("sets.html", "nav.sets", "sets")}
          ${link("artists.html", "nav.artists", "artists")}
          ${link("cards.html", "nav.allCards", "cards")}`)}
      ${group("nav.collection", collectionActive, `
          ${link("collection.html", "nav.collectionMine", "collection")}
          ${link("binders.html", "nav.binders", "binders")}
          ${link("wishlist.html", "nav.wishlist", "wishlist")}`)}
      ${link("portfolio.html", "nav.portfolio", "portfolio")}
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
  function initSiteFooter() {
    if (document.querySelector(".site-footer")) return;
    const footer = document.createElement("footer");
    footer.className = "site-footer";
    footer.innerHTML = `
      <div class="site-footer-inner">
        <p>${escapeHtml(t("footer.rights", { year: new Date().getFullYear() }))}</p>
        <p>${t("footer.credits")}</p>
      </div>
    `;
    document.body.appendChild(footer);
  }

  // Dropdown de bandeira reutilizável: colapsado mostra só a bandeira do item
  // atual; aberto, lista bandeira + sigla (o <select> nativo não estiliza bem
  // no dark e não mostra bandeira). `items`: [{ value, flag, sigla }].
  function createFlagDropdown({ id, current, items, ariaLabel, onSelect }) {
    const dd = document.createElement("div");
    dd.className = "lang-dd";
    dd.id = id;
    const currentItem = items.find((item) => item.value === current) || items[0];
    dd.innerHTML = `
      <button type="button" class="lang-dd-toggle" aria-haspopup="listbox" aria-expanded="false" aria-label="${escapeAttribute(ariaLabel)}" title="${escapeAttribute(ariaLabel)}">
        ${currentItem.flag}
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
  // falha (webp → png do mesmo host → fonte alternativa de outro host).
  const TCGImg = {
    fallback(img) {
      const list = (img.getAttribute("data-img-fallbacks") || "").split("|").filter(Boolean);
      const next = list.shift();
      if (!next) {
        img.removeAttribute("data-img-fallbacks");
        return;
      }
      if (list.length) img.setAttribute("data-img-fallbacks", list.join("|"));
      else img.removeAttribute("data-img-fallbacks");
      img.src = next;
    }
  };
  window.TCGImg = TCGImg;

  // Delegação em fase de captura: eventos "error" de <img> não borbulham, mas
  // são capturáveis. Dispara a cadeia de fallback sem onerror inline (que a CSP
  // script-src 'self' bloquearia).
  document.addEventListener("error", (event) => {
    const img = event.target;
    if (img && img.tagName === "IMG" && img.hasAttribute("data-img-fallbacks")) {
      TCGImg.fallback(img);
    }
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
    return `<img${classAttr}${loadingAttr} decoding="async" src="${escapeAttribute(src)}" alt="${escapeAttribute(alt)}"${fallbackAttr}>`;
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

  function marketQuoteHtml(pricing, fx, card) {
    const data = pricing ? marketQuoteData(pricing, card) : { nonfoil: null, foil: null, updated: "" };
    const tcgdex = marketFinishRow(t("market.nonfoil"), data.nonfoil, fx) + marketFinishRow(t("market.foil"), data.foil, fx);
    const br = marketBrRow(card, fx);
    if (!tcgdex && !br) return "";
    const updated = data.updated ? `<span class="market-updated">${escapeHtml(t("market.updated", { date: data.updated }))}</span>` : "";
    return `<div class="market-quote-head"><h3>${escapeHtml(t("market.title"))}</h3>${updated}</div>`
      + tcgdex
      + br
      + `<p class="market-source">${escapeHtml(t("market.source"))}</p>`;
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

  function createCardPreview({ getCard, store, onOwnedChange, prices, wishlist }) {
    let activeCard = null;
    let activeVariant = null;
    let openerElement = null;

    document.addEventListener("click", handleClick);
    // Salva o preço BR digitado ao sair do campo (change = blur ou Enter).
    // Aceita vírgula ou ponto como decimal ("12,50", "12.50", "1.250,00").
    document.addEventListener("change", (event) => {
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
      if (wrap) wrap.innerHTML = variantQuantityRows(activeCard, store, prices, activeVariant);
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
  const BR_MARKETPLACES = [
    { key: "liga", label: "LigaPokémon", url: (card) => `https://www.ligapokemon.com.br/?view=cards/search&card=${enc(paddedCardQuery(card, true))}` },
    { key: "ligabra", label: "LigaBRA", url: (card) => `https://ligabra.com/filter-products/${enc(cardSearchQuery(card))}` },
    { key: "myp", label: "MYP", url: (card) => `https://mypcards.com/pokemon?ProdutoSearch%5Bquery%5D=${enc(paddedCardQuery(card, false))}` }
  ];

  // Mercado internacional/EUA. TCGdex não tem página de carta linkável (é a
  // própria fonte da "Cotação de mercado" acima), então uso PriceCharting
  // (vendas reais) no lugar.
  const US_MARKETPLACES = [
    { key: "ebay", label: "eBay", url: (card) => `https://www.ebay.com/sch/i.html?_nkw=${enc(usSearchText(card))}` },
    { key: "tcgplayer", label: "TCGplayer", url: (card) => `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${enc(usSearchText(card))}` },
    { key: "pricecharting", label: "PriceCharting", url: (card) => `https://www.pricecharting.com/search-products?type=prices&q=${enc(usSearchText(card))}` }
  ];

  function usSearchText(card) {
    return `pokemon ${card.name} ${cardCode(card)}`.trim();
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
    return `<div class="market-links">`
      + marketplaceRow("price.checkBr", BR_MARKETPLACES, card)
      + marketplaceRow("price.checkUs", US_MARKETPLACES, card)
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
      return `
        <div class="variant-conditions${total > 0 ? " owned" : ""}">
          <div class="variant-conditions-head">
            <span class="variant-row-name variant-${escapeAttribute(variantSlug(variant))}">${escapeHtml(variant)}</span>
            ${total > 0 ? `<span class="variant-total">×${total}</span>` : ""}
          </div>
          <div class="condition-grid">${conditions}</div>
          ${prices ? variantPriceRow(card, variant, prices) : ""}
        </div>
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

  function variantTile(card, variant, store, wishlist, prices) {
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
    const ownAria = isOwned ? t("tile.removeAria", { variant }) : t("tile.addAria", { variant });
    const qtyBadge = quantity > 1 ? `<span class="tile-qty">×${quantity}</span>` : "";
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
          <button type="button" class="tile-btn tile-own${isOwned ? " active" : ""}" data-own-card-id="${escapeAttribute(card.id)}" data-own-variant="${escapeAttribute(variant)}" aria-pressed="${isOwned}" aria-label="${escapeAttribute(ownAria)}">
            ${isOwned ? TILE_ICONS.check : TILE_ICONS.plus}${qtyBadge}
          </button>
        </div>
        <p class="tile-conditions" data-tile-conditions>${escapeHtml(summary)}</p>
      </div>
    `;

    return article;
  }

  // Atualiza o estado de posse de um tile no DOM existente, sem recriar a
  // imagem — evita o "piscar" de recarregar a grade inteira.
  function refreshTileOwnership(tile, store, wishlist) {
    const cardId = tile.dataset.tileCardId;
    const variant = tile.dataset.tileVariant;
    if (!cardId) return;
    const quantity = store.variantTotal(cardId, variant);
    const isOwned = quantity > 0;
    tile.classList.toggle("owned", isOwned);

    const button = tile.querySelector(".tile-own");
    if (button) {
      button.classList.toggle("active", isOwned);
      button.setAttribute("aria-pressed", String(isOwned));
      button.setAttribute("aria-label", isOwned ? t("tile.removeAria", { variant }) : t("tile.addAria", { variant }));
      button.innerHTML = `${isOwned ? TILE_ICONS.check : TILE_ICONS.plus}${quantity > 1 ? `<span class="tile-qty">×${quantity}</span>` : ""}`;
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

  // `cardLang` opcional ("all" ou um idioma): no modo manifest baixa só os
  // chunks daquele idioma (corta o download — ex.: PT ~14k em vez de 48k);
  // no modo local filtra a amostra já carregada.
  async function loadCatalog(cardLang) {
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
  function loadIndexesOnly() {
    return {
      cards: Array.isArray(window.TCG_CARDS) ? window.TCG_CARDS : [],
      indexes: window.TCG_INDEXES || null,
      manifest: window.TCG_MANIFEST || null
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
    handleOwnedTileClick,
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
    cardValue,
    formatMoney: fmtMoney,
    cardLanguageFromId,
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
    loadCatalog,
    loadCatalogForCardIds,
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
    collection: "tcg-collector-collection-v3",
    wishlist: "tcg-collector-wishlist-v1",
    prices: "tcg-collector-prices-v1",
    binders: "tcg-collector-binders-v1"
  };

  function authHeaders(token) {
    const h = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }
  function getSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; } }
  function setSession(s) { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); }

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
  async function refreshSession() {
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
    } catch (e) { return s; }
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
  function mergeCollection(a, b) {
    const out = JSON.parse(JSON.stringify(a || {}));
    Object.entries(b || {}).forEach(([cardId, variants]) => {
      out[cardId] = out[cardId] || {};
      Object.entries(variants || {}).forEach(([variant, conds]) => {
        out[cardId][variant] = out[cardId][variant] || {};
        Object.entries(conds || {}).forEach(([cond, qty]) => {
          out[cardId][variant][cond] = Math.max(Number(out[cardId][variant][cond]) || 0, Number(qty) || 0);
        });
      });
    });
    return out;
  }
  function mergeWishlist(a, b) {
    const out = JSON.parse(JSON.stringify(a || {}));
    Object.entries(b || {}).forEach(([cardId, list]) => {
      const set = new Set([].concat(out[cardId] || [], Array.isArray(list) ? list : []));
      if (set.size) out[cardId] = Array.from(set);
    });
    return out;
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
    const byId = new Map();
    al.concat(bl).forEach((bind) => {
      if (!bind || !bind.id) return;
      const prev = byId.get(bind.id);
      if (!prev || (Number(bind.updatedAt) || 0) > (Number(prev.updatedAt) || 0)) byId.set(bind.id, bind);
    });
    return { binders: Array.from(byId.values()) };
  }
  function mergeData(localD, remoteD) {
    const a = localD || {}, b = remoteD || {};
    return {
      collection: mergeCollection(a.collection, b.collection),
      wishlist: mergeWishlist(a.wishlist, b.wishlist),
      prices: mergePrices(a.prices, b.prices),
      binders: mergeBinders(a.binders, b.binders)
    };
  }
  async function pullRemote(token, uid) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/collections?user_id=eq.${uid}&select=data`, { headers: authHeaders(token) });
      if (!r.ok) return null;
      const rows = await r.json();
      return rows && rows[0] ? rows[0].data : {};
    } catch (e) { return null; }
  }
  async function pushRemote(token, uid, data, keepalive) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/collections?on_conflict=user_id`, {
        method: "POST",
        headers: Object.assign(authHeaders(token), { Prefer: "resolution=merge-duplicates,return=minimal" }),
        body: JSON.stringify({ user_id: uid, data, updated_at: new Date().toISOString() }),
        keepalive: !!keepalive
      });
    } catch (e) { /* ignora; tenta de novo no próximo ciclo */ }
  }

  let lastPushed = "";
  function startSyncLoop(session) {
    const push = (keepalive) => {
      const snap = localSnapshot();
      const json = JSON.stringify(snap);
      if (json === lastPushed) return;
      lastPushed = json;
      pushRemote(session.access_token, session.user.id, snap, keepalive);
    };
    setInterval(() => push(false), 20000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") push(true); });
    window.addEventListener("pagehide", () => push(true));
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
        window.location.reload();
      } catch (e) { alert(t("error.import")); }
    }

    // Itens de dados (export/import), comuns ao menu logado e deslogado.
    const dataItems = `<li class="auth-sep" aria-hidden="true"></li>
      <li class="lang-dd-option" role="menuitem" data-export-json>${escapeHtml(t("auth.exportJson"))}</li>
      <li class="lang-dd-option" role="menuitem" data-export-csv>${escapeHtml(t("auth.exportCsv"))}</li>
      <li class="lang-dd-option" role="menuitem" data-import>${escapeHtml(t("auth.import"))}</li>`;
    const fileInput = `<input type="file" accept="application/json" data-import-input hidden>`;

    function wireDropdown() {
      const dd = slot.querySelector("#authDd");
      if (!dd) return;
      const toggle = dd.querySelector("[aria-haspopup]");
      const menu = dd.querySelector(".lang-dd-menu");
      toggle.addEventListener("click", () => { const open = menu.hidden; menu.hidden = !open; toggle.setAttribute("aria-expanded", String(open)); });
      document.addEventListener("click", (e) => { if (!menu.hidden && !e.target.closest("#authDd")) menu.hidden = true; });
    }

    function renderLoggedOut() {
      slot.innerHTML = `<div class="lang-dd auth-dd" id="authDd">
        <button type="button" class="secondary auth-acct" aria-haspopup="menu" aria-expanded="false">${escapeHtml(t("auth.account"))}<span class="lang-dd-caret" aria-hidden="true">▾</span></button>
        <ul class="lang-dd-menu auth-menu" role="menu" hidden>
          <li class="lang-dd-option" role="menuitem" data-auth-login>${escapeHtml(t("auth.signIn"))}</li>
          ${dataItems}
        </ul>
        ${fileInput}
      </div>`;
      wireDropdown();
    }
    function renderLoggedIn(session) {
      const email = (session.user && session.user.email) || "conta";
      const initial = (email.trim().charAt(0) || "?").toUpperCase();
      slot.innerHTML = `<div class="lang-dd auth-dd" id="authDd">
        <button type="button" class="auth-avatar" aria-haspopup="menu" aria-expanded="false" aria-label="${escapeAttribute(email)}" title="${escapeAttribute(email)}">${escapeHtml(initial)}</button>
        <ul class="lang-dd-menu auth-menu" role="menu" hidden>
          <li class="lang-dd-option auth-email">${escapeHtml(email)}</li>
          ${dataItems}
          <li class="auth-sep" aria-hidden="true"></li>
          <li class="lang-dd-option" role="menuitem" data-auth-logout>${escapeHtml(t("auth.signOut"))}</li>
        </ul>
        ${fileInput}
      </div>`;
      wireDropdown();
    }

    slot.addEventListener("click", async (event) => {
      if (event.target.closest("[data-auth-login]")) {
        const email = window.prompt(t("auth.emailPrompt"));
        if (!email || !email.includes("@")) return;
        const ok = await sendMagicLink(email.trim());
        window.alert(ok ? t("auth.linkSent") : t("auth.error"));
        return;
      }
      if (event.target.closest("[data-export-json]")) { exportJson(); return; }
      if (event.target.closest("[data-export-csv]")) { exportCsv(); return; }
      if (event.target.closest("[data-import]")) { const inp = slot.querySelector("[data-import-input]"); if (inp) inp.click(); return; }
      if (event.target.closest("[data-auth-logout]")) { authSignOut(); }
    });
    slot.addEventListener("change", (event) => {
      const inp = event.target.closest("[data-import-input]");
      if (inp && inp.files && inp.files[0]) { importJson(inp.files[0]); inp.value = ""; }
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
      startSyncLoop(session);
    })();
  }

  // Título "Procurar:" acima do campo de busca (presente em todas as páginas).
  function initSearchLabel() {
    const section = document.querySelector(".page-search");
    if (!section) return;
    const prev = section.previousElementSibling;
    if (prev && prev.classList.contains("page-search-label")) return;
    const label = document.createElement("div");
    label.className = "page-search-label";
    label.textContent = t("search.title");
    section.parentNode.insertBefore(label, section);
  }

  applyTranslations();
  initLanguageSwitcher();
  initCurrencySwitcher();
  initSearchLabel();
  initPageNav();
  initMobileMenu();
  initSiteFooter();
  initAuth();

  // Service worker: cacheia as imagens já vistas para sobreviverem a um outage
  // do CDN. Caminho relativo funciona tanto na raiz local quanto sob /tcg-collector/.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => { /* SW é só otimização: ignora falha */ });
    });
  }
})();
