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
      localStorage.setItem(storageKey, JSON.stringify(collection));
      initialized = true;
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
      localStorage.setItem(storageKey, JSON.stringify(wishlist));
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
      localStorage.setItem(storageKey, JSON.stringify(prices));
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

  const MESSAGES = {
    pt: {
      "lang.aria": "Idioma do site",
      "nav.pokemon": "Pokémon",
      "nav.home": "Início",
      "nav.pokedex": "Pokédex",
      "nav.sets": "Sets",
      "nav.artists": "Artistas",
      "nav.trainers": "Treinadores",
      "header.tagline": "Local-first MVP",
      "header.export": "Exportar",
      "header.import": "Importar",
      "title.home": "TCG Collector — sua coleção de Pokémon TCG, grátis",
      "title.pokedex": "Pokédex - TCG Collector",
      "title.sets": "Sets - TCG Collector",
      "title.artists": "Artistas - TCG Collector",
      "title.trainers": "Treinadores - TCG Collector",
      "title.detail": "Detalhe - TCG Collector",
      "nav.collection": "Coleção",
      "title.collection": "Coleção - TCG Collector",
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
      "tile.want": "Quero essa carta",
      "tile.wanted": "Está na lista de desejos",
      "tile.wantAria": "Adicionar {variant} à lista de desejos",
      "tile.unwantAria": "Remover {variant} da lista de desejos",
      "nav.wishlist": "Quero",
      "title.wishlist": "Quero - TCG Collector",
      "wishlist.subtitle": "As cartas que você marcou como \"eu quero\". Marque uma como tenho para movê-la pra coleção.",
      "wishlist.stats.distinct": "cartas na lista",
      "wishlist.stats.sets": "sets desejados",
      "wishlist.results": "Cartas que eu quero",
      "wishlist.markOwned": "Comprei!",
      "empty.wishlist": "Sua lista de desejos está vazia. <a href=\"pokedex.html\">Explore a Pokédex</a> e toque no ♡ das cartas que você quer.",
      "empty.wishlistFiltered": "Nenhuma carta da sua lista de desejos com esses filtros.",
      "price.rowLabel": "Preço BR (R$)",
      "price.updatedAt": "atualizado em {date}",
      "price.inputAria": "Preço em reais de {variant} {condition}",
      "price.checkAt": "Conferir preço:",
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
      "sort.label": "Ordenar por:",
      "sort.dex": "Nº Dex",
      "sort.name": "Nome",
      "sort.progress": "Progresso",
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
      "filter.wanted": "Quero",
      "rarity.base": "Comuns e raras",
      "rarity.base.title": "Comum, Incomum, Rara, Double Rare",
      "rarity.discontinued": "Descontinuadas",
      "rarity.discontinued.title": "Holo Rare, Rainbow/Hyper Rare, Secret Rare e outras antigas",
      "rarity.ultra": "Ultra Rare",
      "rarity.illustration": "Illustration Rare",
      "rarity.special": "Special Illustration",
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
      "set.officialCards": "{n} cartas oficiais",
      "set.inLocalCatalog": "{n} no catálogo local",
      "set.marked": "{n} marcadas",
      "card.viewCards": "Ver cartas",
      "card.viewSet": "Ver set",
      "card.have": "Tenho",
      "card.haveTimes": "Tenho ×{n}",
      "card.missing": "Falta",
      "card.inCollection": "Tenho na coleção",
      "card.inCollectionTimes": "Tenho na coleção (×{n})",
      "card.markOwned": "Marcar como tenho",
      "card.noImage": "Sem imagem",
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
      "detail.loading": "Carregando",
      "detail.label": "Detalhe",
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
      "home.eyebrow": "Grátis · open source · em português",
      "home.title": "Sua coleção de Pokémon TCG, <span class=\"accent\">organizada</span>.",
      "home.sub": "Uma alternativa brasileira e de código aberto aos rastreadores pagos. Acompanhe cada carta por variante e quantidade — Holo, Reverse, 1st Edition — navegando por Pokédex, sets e artistas. Tudo direto no navegador: seus dados não saem daqui.",
      "home.ctaPokedex": "Abrir a Pokédex",
      "home.ctaSets": "Explorar sets",
      "home.note": "Sem cadastro, sem plano pago. Exporte e importe sua coleção em JSON quando quiser.",
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
      "home.feature4.title": "Grátis e open source",
      "home.feature4.body": "Sem anúncios, sem recursos travados, sem plano \"pro\". O código é aberto no GitHub.",
      "home.how.title": "Como funciona",
      "home.step1.title": "Explore",
      "home.step1.body": "Busque por nome, número da Pokédex, set, artista ou raridade.",
      "home.step2.title": "Marque",
      "home.step2.body": "Registre cada variante que você tem, com a quantidade exata.",
      "home.step3.title": "Complete",
      "home.step3.body": "Acompanhe o progresso por Pokémon, por set e por artista.",
      "home.why.title": "Por que esse app existe",
      "home.why.lead": "Colecionar carta de Pokémon no Brasil é caro o bastante sem precisar pagar assinatura pra anotar o que você já tem. Este projeto nasceu como um backlog local, online e em português — pra registrar cartas, montar coleções e criar listas de \"eu quero\", sem entregar seus dados pra ninguém.",
      "home.why.pill1.title": "Local e seu",
      "home.why.pill1.body": "A coleção fica no seu navegador. Exporte em JSON quando quiser e leve pra onde for. O código é aberto, dá pra auditar.",
      "home.why.pill2.title": "Em português, com preços daqui",
      "home.why.pill2.body": "Catálogo PT-BR, condições na escala usada no Brasil e valores em R$, além de USD e EUR — para você saber quanto a coleção vale na sua realidade.",
      "home.why.pill3.title": "Grátis de verdade",
      "home.why.pill3.body": "Sem anúncio, sem recurso travado, sem plano \"pro\". No futuro, só o salvar na nuvem poderá ser um extra pago opcional — porque servidor custa. Todo o resto continua livre.",
      "home.roadmap.title": "Roadmap aberto",
      "home.roadmap.sub": "Em construção, à vista de todos. Sugira e acompanhe no GitHub.",
      "home.roadmap.item1.title": "Listas \"Eu quero\"",
      "home.roadmap.item1.body": "Wishlist por variante e prioridade, com atalho \"comprei!\" que move pra coleção.",
      "home.roadmap.item2.title": "Binders 2×2 e 3×3",
      "home.roadmap.item2.body": "Fichários visuais de \"tenho\" e \"quero\", com exportar como imagem pra compartilhar.",
      "home.roadmap.item3.title": "Portfólio em R$",
      "home.roadmap.item3.body": "Valor estimado da coleção em R$, USD e EUR, com preço manual e cartas mais valiosas.",
      "home.roadmap.item4.title": "Nuvem opcional",
      "home.roadmap.item4.body": "Backup e sincronização entre dispositivos — opcional e pago, sem travar nada do app grátis.",
      "home.roadmap.link": "Acompanhe no GitHub →",
      "home.support.title": "Gostou? Me paga um café ☕",
      "home.support.body": "Esse projeto é mantido por uma pessoa só, nas horas livres. Se ele te ajudou, um cafezinho ajuda a manter o site no ar e a continuar melhorando. Apoiar é 100% opcional — o app é e vai continuar grátis.",
      "home.support.pix": "Copiar chave Pix",
      "home.support.pixDone": "Chave Pix copiada!",
      "home.support.kofi": "Ko-fi · café internacional",
      "home.support.star": "⭐ Dar uma estrela no GitHub",
      "home.support.note": "Prefere ajudar de graça? Uma estrela no GitHub e compartilhar com quem coleciona já faz diferença.",
      "home.footer.line1": "Grátis e open source — <a href=\"https://github.com/fexpepe/tcg-collector\">código no GitHub</a>",
      "home.footer.line2": "Dados de cartas por <a href=\"https://tcgdex.dev\">TCGdex</a> · informações de Pokémon pela <a href=\"https://pokeapi.co\">PokéAPI</a>. Pokémon e Pokémon TCG são marcas de Nintendo / Creatures / GAME FREAK; este projeto não tem afiliação.",
      "footer.rights": "© {year} TCG Collector · Projeto open source, sem afiliação com Nintendo, Game Freak, Creatures, Niantic ou The Pokémon Company. Pokémon e Pokémon TCG são marcas registradas dos respectivos titulares.",
      "footer.credits": "Código no <a href=\"https://github.com/fexpepe/tcg-collector\">GitHub</a> · cartas por <a href=\"https://tcgdex.dev\">TCGdex</a> · Pokémon pela <a href=\"https://pokeapi.co\">PokéAPI</a>."
    },
    en: {
      "lang.aria": "Site language",
      "nav.pokemon": "Pokémon",
      "nav.home": "Home",
      "nav.pokedex": "Pokédex",
      "nav.sets": "Sets",
      "nav.artists": "Artists",
      "nav.trainers": "Trainers",
      "header.tagline": "Local-first MVP",
      "header.export": "Export",
      "header.import": "Import",
      "title.home": "TCG Collector — your Pokémon TCG collection, free",
      "title.pokedex": "Pokédex - TCG Collector",
      "title.sets": "Sets - TCG Collector",
      "title.artists": "Artists - TCG Collector",
      "title.trainers": "Trainers - TCG Collector",
      "title.detail": "Detail - TCG Collector",
      "nav.collection": "Collection",
      "title.collection": "Collection - TCG Collector",
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
      "nav.wishlist": "Want",
      "title.wishlist": "Want - TCG Collector",
      "wishlist.subtitle": "The cards you marked as \"want\". Mark one as owned to move it into your collection.",
      "wishlist.stats.distinct": "cards on the list",
      "wishlist.stats.sets": "sets wanted",
      "wishlist.results": "Cards I want",
      "wishlist.markOwned": "Got it!",
      "empty.wishlist": "Your wishlist is empty. <a href=\"pokedex.html\">Browse the Pokédex</a> and tap the ♡ on cards you want.",
      "empty.wishlistFiltered": "No cards from your wishlist match these filters.",
      "price.rowLabel": "BR price (R$)",
      "price.updatedAt": "updated {date}",
      "price.inputAria": "Price in BRL for {variant} {condition}",
      "price.checkAt": "Check price:",
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
      "sort.label": "Sort by:",
      "sort.dex": "Dex #",
      "sort.name": "Name",
      "sort.progress": "Progress",
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
      "filter.wanted": "Want",
      "rarity.base": "Common & Rare",
      "rarity.base.title": "Common, Uncommon, Rare, Double Rare",
      "rarity.discontinued": "Discontinued",
      "rarity.discontinued.title": "Holo Rare, Rainbow/Hyper Rare, Secret Rare and other older rarities",
      "rarity.ultra": "Ultra Rare",
      "rarity.illustration": "Illustration Rare",
      "rarity.special": "Special Illustration",
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
      "set.officialCards": "{n} official cards",
      "set.inLocalCatalog": "{n} in local catalog",
      "set.marked": "{n} owned",
      "card.viewCards": "View cards",
      "card.viewSet": "View set",
      "card.have": "Owned",
      "card.haveTimes": "Owned ×{n}",
      "card.missing": "Missing",
      "card.inCollection": "In my collection",
      "card.inCollectionTimes": "In my collection (×{n})",
      "card.markOwned": "Mark as owned",
      "card.noImage": "No image",
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
      "detail.loading": "Loading",
      "detail.label": "Detail",
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
      "home.eyebrow": "Free · open source · multilingual",
      "home.title": "Your Pokémon TCG collection, <span class=\"accent\">organized</span>.",
      "home.sub": "A free, open-source alternative to paid trackers. Track every card by variant and quantity — Holo, Reverse, 1st Edition — browsing by Pokédex, sets and artists. All in your browser: your data never leaves it.",
      "home.ctaPokedex": "Open the Pokédex",
      "home.ctaSets": "Browse sets",
      "home.note": "No sign-up, no paid plan. Export and import your collection as JSON anytime.",
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
      "home.feature4.title": "Free and open source",
      "home.feature4.body": "No ads, no locked features, no \"pro\" plan. The code is open on GitHub.",
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
      "home.why.pill1.body": "Your collection lives in your browser. Export it as JSON anytime and take it anywhere. The code is open — audit it yourself.",
      "home.why.pill2.title": "Localized prices",
      "home.why.pill2.body": "Multilingual catalog, condition scales, and values in BRL, USD and EUR — so you know what your collection is worth in your own market.",
      "home.why.pill3.title": "Genuinely free",
      "home.why.pill3.body": "No ads, no locked features, no \"pro\" plan. Down the road, only optional cloud saving may be a paid extra — because servers cost money. Everything else stays free.",
      "home.roadmap.title": "Open roadmap",
      "home.roadmap.sub": "Built in the open. Suggest and follow along on GitHub.",
      "home.roadmap.item1.title": "\"Want\" lists",
      "home.roadmap.item1.body": "Wishlist by variant and priority, with a \"got it!\" shortcut that moves a card into your collection.",
      "home.roadmap.item2.title": "2×2 and 3×3 binders",
      "home.roadmap.item2.body": "Visual binders for owned and wanted cards, with export-as-image to share.",
      "home.roadmap.item3.title": "Portfolio value",
      "home.roadmap.item3.body": "Estimated collection value in BRL, USD and EUR, with manual pricing and your most valuable cards.",
      "home.roadmap.item4.title": "Optional cloud",
      "home.roadmap.item4.body": "Backup and sync across devices — optional and paid, never locking anything in the free app.",
      "home.roadmap.link": "Follow on GitHub →",
      "home.support.title": "Like it? Buy me a coffee ☕",
      "home.support.body": "This project is maintained by one person, in spare time. If it helped you, a coffee helps keep the site online and improving. Supporting is 100% optional — the app is and will stay free.",
      "home.support.pix": "Copy Pix key",
      "home.support.pixDone": "Pix key copied!",
      "home.support.kofi": "Ko-fi · international coffee",
      "home.support.star": "⭐ Star it on GitHub",
      "home.support.note": "Rather help for free? A GitHub star and sharing with fellow collectors already goes a long way.",
      "home.footer.line1": "Free and open source — <a href=\"https://github.com/fexpepe/tcg-collector\">code on GitHub</a>",
      "home.footer.line2": "Card data by <a href=\"https://tcgdex.dev\">TCGdex</a> · Pokémon info from <a href=\"https://pokeapi.co\">PokéAPI</a>. Pokémon and Pokémon TCG are trademarks of Nintendo / Creatures / GAME FREAK; this project is not affiliated.",
      "footer.rights": "© {year} TCG Collector · Open-source project, not affiliated with Nintendo, Game Freak, Creatures, Niantic or The Pokémon Company. Pokémon and Pokémon TCG are trademarks of their respective owners.",
      "footer.credits": "Code on <a href=\"https://github.com/fexpepe/tcg-collector\">GitHub</a> · cards by <a href=\"https://tcgdex.dev\">TCGdex</a> · Pokémon from <a href=\"https://pokeapi.co\">PokéAPI</a>."
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
      const type = new URLSearchParams(window.location.search).get("type");
      active = type === "set" ? "sets" : type === "artist" ? "artists" : type === "trainer" ? "trainers" : "pokedex";
    }
    const groupActive = ["pokedex", "trainers", "sets", "artists"].includes(active);

    const link = (href, key, page) => `<a href="${href}"${page === active ? ' class="active"' : ""}>${escapeHtml(t(key))}</a>`;

    nav.innerHTML = `
      ${link("index.html", "nav.home", "home")}
      <div class="nav-group">
        <button type="button" class="nav-group-toggle${groupActive ? " active" : ""}" aria-expanded="false" aria-haspopup="true">
          ${escapeHtml(t("nav.pokemon"))}<span class="nav-caret" aria-hidden="true">▾</span>
        </button>
        <div class="nav-dropdown" hidden>
          ${link("pokedex.html", "nav.pokedex", "pokedex")}
          ${link("trainers.html", "nav.trainers", "trainers")}
          ${link("sets.html", "nav.sets", "sets")}
          ${link("artists.html", "nav.artists", "artists")}
        </div>
      </div>
      ${link("collection.html", "nav.collection", "collection")}
      ${link("wishlist.html", "nav.wishlist", "wishlist")}
      ${link("portfolio.html", "nav.portfolio", "portfolio")}
    `;

    const toggle = nav.querySelector(".nav-group-toggle");
    const dropdown = nav.querySelector(".nav-dropdown");

    function close() {
      dropdown.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    }

    toggle.addEventListener("click", () => {
      const willOpen = dropdown.hidden;
      dropdown.hidden = !willOpen;
      toggle.setAttribute("aria-expanded", String(willOpen));
    });

    document.addEventListener("click", (event) => {
      if (!dropdown.hidden && !event.target.closest(".nav-group")) {
        close();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !dropdown.hidden) {
        close();
      }
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

  function initLanguageSwitcher() {
    const select = document.getElementById("languageSwitcher");
    if (!select) return;
    UI_LANGUAGES.forEach(({ code, label }) => {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = label;
      select.appendChild(option);
    });
    select.value = currentLanguage;
    select.setAttribute("aria-label", t("lang.aria"));
    select.addEventListener("change", () => {
      localStorage.setItem(languageStorageKey, select.value);
      window.location.reload();
    });
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
    return translated === `cardLang.${code}` ? String(language || "").toUpperCase() : translated;
  }

  function cardFlag(language) {
    const code = normalizeCardLanguage(language);
    const label = cardLanguageLabel(language);
    const svg = CARD_FLAG_SVGS[code];
    if (!svg) {
      return `<span class="card-flag card-flag-text" title="${escapeAttribute(label)}">${escapeHtml(String(language || "").toUpperCase())}</span>`;
    }
    return `<span class="card-flag" title="${escapeAttribute(label)}" role="img" aria-label="${escapeAttribute(label)}">${svg}</span>`;
  }

  function localizeAssetUrl(url) {
    if (!url) return url;
    return url.replace(/(assets\.tcgdex\.net\/)[a-z-]+(\/)/, `$1${currentLanguage}$2`);
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
        img.onerror = null;
        img.removeAttribute("data-img-fallbacks");
        return;
      }
      if (list.length) img.setAttribute("data-img-fallbacks", list.join("|"));
      else img.removeAttribute("data-img-fallbacks");
      img.src = next;
    }
  };
  window.TCGImg = TCGImg;

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
      ? ` data-img-fallbacks="${escapeAttribute(chain.join("|"))}" onerror="window.TCGImg&&TCGImg.fallback(this)"`
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

  function createCardPreview({ getCard, store, onOwnedChange, prices }) {
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

      modal.innerHTML = `
        <div class="card-preview-backdrop" data-preview-close></div>
        <section class="card-preview-panel" role="dialog" aria-modal="true" aria-label="${escapeAttribute(activeCard.name)}">
          <button class="preview-close" data-preview-close aria-label="${escapeAttribute(t("modal.close"))}">×</button>
          <div class="preview-image-wrap">
            ${(function () {
              const img = cardImageSources(activeCard, true);
              return img.url
                ? localizedImg(img.url, { alt: activeCard.name, fallback: img.fallback })
                : `<span class="image-placeholder">${escapeHtml(t("card.noImage"))}</span>`;
            })()}
          </div>
          <div class="preview-content">
            <div>
              <p class="eyebrow">${escapeHtml(activeCard.set)}</p>
              <h2>${escapeHtml(cardLabel(activeCard))}</h2>
              <p class="preview-subtitle">${cardFlag(activeCard.language)}<span>${escapeHtml(activeCard.number)} · ${escapeHtml(activeCard.language.toUpperCase())}</span></p>
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
            ${prices ? brMarketplaceLinks(activeCard) : ""}
            <button class="owned-toggle preview-owned" data-card-id="${escapeAttribute(activeCard.id)}"${activeVariant ? ` data-variant="${escapeAttribute(activeVariant)}"` : ""} aria-pressed="${isOwned}">
              ${isOwned ? t("card.inCollection") : t("card.markOwned")}
            </button>
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

    return { open, close };
  }

  // Busca da carta nos marketplaces brasileiros (não têm API pública; o link
  // abre a busca pra conferir o preço e digitar no campo manual).
  const BR_MARKETPLACES = [
    { key: "liga", label: "LigaPokémon", url: (q) => `https://www.ligapokemon.com.br/?view=cards/search&card=${q}` },
    { key: "ligabra", label: "LigaBRA", url: (q) => `https://ligabra.com/filter-products/${q}` },
    { key: "myp", label: "MYP", url: (q) => `https://mypcards.com/pokemon?ProdutoSearch%5Bquery%5D=${q}` }
  ];

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

  // Texto pesquisável de uma carta (nome, espécie, número, código, set, artista,
  // raridade, idioma e variantes), normalizado.
  function cardSearchHaystack(card) {
    return normalize([
      card.name, card.pokemonName, card.dexId, card.number, cardCode(card),
      card.set, card.artist, card.rarity, card.language, ...(card.variants || [])
    ].join(" "));
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

  function brMarketplaceLinks(card) {
    const query = encodeURIComponent(cardSearchQuery(card));
    const links = BR_MARKETPLACES
      .map(({ key, label, url }) => `<a class="br-link br-link-${key}" href="${escapeAttribute(url(query))}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`)
      .join("");
    return `<div class="br-links"><span class="br-links-label">${escapeHtml(t("price.checkAt"))}</span>${links}</div>`;
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
    heartFilled: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>'
  };

  function variantSlug(variant) {
    return normalize(variant).replace(/\s+/g, "-");
  }

  // Tile minimalista (imagem em destaque + nome, variante, set·número e ações).
  // Um tile por variante; quantidades além de 1 são ajustadas no preview da carta.
  function variantTile(card, variant, store, wishlist) {
    const quantity = store.variantTotal(card.id, variant);
    const isOwned = quantity > 0;
    const isWanted = wishlist ? wishlist.has(card.id, variant) : false;
    const article = document.createElement("article");
    article.className = `card-tile${isOwned ? " owned" : ""}${isWanted ? " wanted" : ""}`;
    article.dataset.tileCardId = card.id;
    article.dataset.tileVariant = variant;
    const img = cardImageSources(card, false);
    const image = img.url
      ? `<button class="image-open" data-preview-card-id="${escapeAttribute(card.id)}" data-preview-variant="${escapeAttribute(variant)}" aria-label="${escapeAttribute(t("card.zoom", { name: card.name }))}">${localizedImg(img.url, { alt: card.name, loading: "lazy", thumb: true, fallback: img.fallback })}</button>`
      : `<span class="image-placeholder">${escapeHtml(t("card.noImage"))}</span>`;
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
        <p class="tile-variant variant-${escapeAttribute(variantSlug(variant))}">${escapeHtml(variant)}</p>
        <div class="tile-bottom">
          <p class="tile-set">${cardFlag(card.language)}<span>${escapeHtml(card.set)} · ${escapeHtml(card.number)}</span></p>
          <div class="tile-actions">
            ${wantButton}
            <button type="button" class="tile-btn tile-own${isOwned ? " active" : ""}" data-own-card-id="${escapeAttribute(card.id)}" data-own-variant="${escapeAttribute(variant)}" aria-pressed="${isOwned}" aria-label="${escapeAttribute(ownAria)}">
              ${isOwned ? TILE_ICONS.check : TILE_ICONS.plus}${qtyBadge}
            </button>
          </div>
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

  function bindCollectionTransfer({ exportButton, importInput, store, wishlist, prices, cards, onChange }) {
    const cardsById = new Map(cards.map((card) => [card.id, card]));

    exportButton.addEventListener("click", () => {
      const payload = {
        version: 3,
        exportedAt: new Date().toISOString(),
        collection: store.toObject()
      };
      if (wishlist) payload.wishlist = wishlist.toObject();
      if (prices) payload.prices = prices.toObject();
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
        if (wishlist) wishlist.replace(parseImportedWishlist(payload, cardsById));
        if (prices) prices.replace(parseImportedPrices(payload, cardsById));
        onChange();
      } catch (error) {
        alert(t("error.import"));
      } finally {
        event.target.value = "";
      }
    });
  }

  // Preços BR do backup: mantém só valores numéricos positivos de cartas conhecidas.
  function parseImportedPrices(payload, cardsById) {
    const source = payload && payload.prices;
    if (!source || typeof source !== "object" || Array.isArray(source)) return {};
    const result = {};
    Object.entries(source).forEach(([cardId, variants]) => {
      if (!cardsById.has(cardId) || !variants || typeof variants !== "object") return;
      Object.entries(variants).forEach(([variant, entry]) => {
        if (!entry || typeof entry !== "object" || !entry.prices) return;
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
    const wishlist = {};
    Object.entries(source).forEach(([cardId, variants]) => {
      const card = cardsById.get(cardId);
      if (!card || !Array.isArray(variants)) return;
      const known = card.variants && card.variants.length ? card.variants : [defaultVariant(card)];
      const list = variants.filter((variant) => known.includes(variant));
      if (list.length) wishlist[cardId] = list;
    });
    return wishlist;
  }

  function parseImportedCollection(payload, cardsById) {
    // Formato v1: lista de ids -> 1ª variante, NM ×1.
    if (Array.isArray(payload.ownedCardIds)) {
      const collection = {};
      payload.ownedCardIds.forEach((cardId) => {
        if (cardsById.has(cardId)) {
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
      if (!cardsById.has(cardId) || !variants || typeof variants !== "object") return;
      const entry = {};
      Object.entries(variants).forEach(([variant, value]) => {
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

  function detailUrl(type, name) {
    const params = new URLSearchParams({ type, name });
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
    bindCollectionTransfer,
    t,
    tn,
    getLanguage,
    getLocale,
    applyTranslations,
    POKEMON_TYPES,
    TYPE_COLORS,
    REGION_BY_GENERATION,
    typeLabel,
    regionForGeneration,
    typesForDex,
    cardFlag,
    cardLanguageLabel,
    cardLanguageRegion,
    localizeAssetUrl,
    localizedImg,
    pokemontcgImageUrl,
    cardHasImage,
    cardCode,
    cardLabel,
    matchesCardQuery,
    loadCatalog,
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

  applyTranslations();
  initLanguageSwitcher();
  initPageNav();
  initSiteFooter();

  // Service worker: cacheia as imagens já vistas para sobreviverem a um outage
  // do CDN. Caminho relativo funciona tanto na raiz local quanto sob /tcg-collector/.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => { /* SW é só otimização: ignora falha */ });
    });
  }
})();
