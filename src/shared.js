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
      "header.tagline": "Local-first MVP",
      "header.export": "Exportar",
      "header.import": "Importar",
      "title.home": "TCG Collector — sua coleção de Pokémon TCG, grátis",
      "title.pokedex": "Pokédex - TCG Collector",
      "title.sets": "Sets - TCG Collector",
      "title.artists": "Artistas - TCG Collector",
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
      "cardLang.zh": "Chinês",
      "cardLang.pt": "Português (BR)",
      "setRegion.international": "Internacional",
      "setRegion.japanese": "Japonês",
      "setRegion.chinese": "Chinês",
      "toolbar.set": "Set",
      "toolbar.language": "Idioma",
      "toolbar.collection": "Coleção",
      "filter.all.f": "Todas",
      "filter.all.m": "Todos",
      "filter.owned": "Tenho",
      "filter.missing": "Faltando",
      "search.placeholder.pokedex": "Nome ou número da Pokédex...",
      "search.placeholder.sets": "Set, carta, artista, número...",
      "search.placeholder.artists": "Artista, carta, set, número...",
      "search.placeholder.detail": "Carta, set, artista, número...",
      "results.heading.pokedex": "Pokémon",
      "results.heading.sets": "Sets",
      "results.heading.artists": "Artistas",
      "results.heading.detail": "Cartas",
      "results.count.one": "{n} resultado",
      "results.count.other": "{n} resultados",
      "empty.pokedex": "Nenhuma carta encontrada com esses filtros.",
      "empty.sets": "Nenhum set encontrado com esses filtros.",
      "empty.artists": "Nenhum artista encontrado com esses filtros.",
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
      "home.eyebrow": "Grátis · sem conta · local-first",
      "home.title": "Sua coleção de Pokémon TCG, <span class=\"accent\">organizada</span>.",
      "home.sub": "Acompanhe cada carta por variante e quantidade — Holo, Reverse, 1st Edition — navegando por Pokédex, sets e artistas. Tudo direto no navegador: seus dados não saem daqui.",
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
      "header.tagline": "Local-first MVP",
      "header.export": "Export",
      "header.import": "Import",
      "title.home": "TCG Collector — your Pokémon TCG collection, free",
      "title.pokedex": "Pokédex - TCG Collector",
      "title.sets": "Sets - TCG Collector",
      "title.artists": "Artists - TCG Collector",
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
      "cardLang.zh": "Chinese",
      "cardLang.pt": "Brazilian Portuguese",
      "setRegion.international": "International",
      "setRegion.japanese": "Japanese",
      "setRegion.chinese": "Chinese",
      "toolbar.set": "Set",
      "toolbar.language": "Language",
      "toolbar.collection": "Collection",
      "filter.all.f": "All",
      "filter.all.m": "All",
      "filter.owned": "Owned",
      "filter.missing": "Missing",
      "search.placeholder.pokedex": "Name or Pokédex number...",
      "search.placeholder.sets": "Set, card, artist, number...",
      "search.placeholder.artists": "Artist, card, set, number...",
      "search.placeholder.detail": "Card, set, artist, number...",
      "results.heading.pokedex": "Pokémon",
      "results.heading.sets": "Sets",
      "results.heading.artists": "Artists",
      "results.heading.detail": "Cards",
      "results.count.one": "{n} result",
      "results.count.other": "{n} results",
      "empty.pokedex": "No cards match these filters.",
      "empty.sets": "No sets match these filters.",
      "empty.artists": "No artists match these filters.",
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
      "home.eyebrow": "Free · no account · local-first",
      "home.title": "Your Pokémon TCG collection, <span class=\"accent\">organized</span>.",
      "home.sub": "Track every card by variant and quantity — Holo, Reverse, 1st Edition — browsing by Pokédex, sets and artists. All in your browser: your data never leaves it.",
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
      active = type === "set" ? "sets" : type === "artist" ? "artists" : "pokedex";
    }
    const groupActive = ["pokedex", "sets", "artists"].includes(active);

    const link = (href, key, page) => `<a href="${href}"${page === active ? ' class="active"' : ""}>${escapeHtml(t(key))}</a>`;

    nav.innerHTML = `
      ${link("index.html", "nav.home", "home")}
      <div class="nav-group">
        <button type="button" class="nav-group-toggle${groupActive ? " active" : ""}" aria-expanded="false" aria-haspopup="true">
          ${escapeHtml(t("nav.pokemon"))}<span class="nav-caret" aria-hidden="true">▾</span>
        </button>
        <div class="nav-dropdown" hidden>
          ${link("pokedex.html", "nav.pokedex", "pokedex")}
          ${link("sets.html", "nav.sets", "sets")}
          ${link("artists.html", "nav.artists", "artists")}
        </div>
      </div>
      ${link("collection.html", "nav.collection", "collection")}
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
    return "international";
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

  // <img> com a URL localizada e fallback para a URL original do catálogo
  // caso o asset não exista no idioma escolhido.
  // Cada carta/set já tem a imagem no seu próprio idioma (indicado pela
  // bandeira), então a imagem é renderizada como veio do catálogo — sem trocar
  // o idioma da URL pelo idioma da interface.
  function localizedImg(url, options) {
    if (!url) return "";
    const { alt = "", className = "", loading = "" } = options || {};
    const classAttr = className ? ` class="${escapeAttribute(className)}"` : "";
    const loadingAttr = loading ? ` loading="${loading}"` : "";
    return `<img${classAttr}${loadingAttr} src="${escapeAttribute(url)}" alt="${escapeAttribute(alt)}">`;
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
    let openerElement = null;

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
          <button class="preview-close" data-preview-close aria-label="${escapeAttribute(t("modal.close"))}">×</button>
          <div class="preview-image-wrap">
            ${localizedImg(activeCard.image, { alt: activeCard.name })}
          </div>
          <div class="preview-content">
            <div>
              <p class="eyebrow">${escapeHtml(activeCard.set)}</p>
              <h2>${escapeHtml(activeCard.name)}</h2>
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
            <div class="variant-quantities">${variantQuantityRows(activeCard, store)}</div>
            <button class="owned-toggle preview-owned" data-card-id="${escapeAttribute(activeCard.id)}" aria-pressed="${isOwned}">
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
        store.toggle(getCard(modalToggle.dataset.cardId) || { id: modalToggle.dataset.cardId });
        onOwnedChange();
        refreshQuantities();
      }
    }

    function refreshQuantities() {
      const modal = document.getElementById("cardPreviewModal");
      if (!modal || !activeCard) return;
      const wrap = modal.querySelector(".variant-quantities");
      if (wrap) wrap.innerHTML = variantQuantityRows(activeCard, store);
      const ownedButton = modal.querySelector(".preview-owned");
      if (ownedButton) {
        const isOwned = store.has(activeCard.id);
        ownedButton.setAttribute("aria-pressed", String(isOwned));
        ownedButton.textContent = isOwned ? t("card.inCollection") : t("card.markOwned");
      }
    }

    return { open, close };
  }

  // Por variante: nome + total e um stepper por condição (M, NM, SP, MP, HP, D).
  // Cada cópia fica distinguida por condição para o cálculo futuro do portfólio.
  function variantQuantityRows(card, store) {
    const variants = card.variants && card.variants.length ? card.variants : [defaultVariant(card)];
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
    check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>'
  };

  function variantSlug(variant) {
    return normalize(variant).replace(/\s+/g, "-");
  }

  // Tile minimalista (imagem em destaque + nome, variante, set·número e ações).
  // Um tile por variante; quantidades além de 1 são ajustadas no preview da carta.
  function variantTile(card, variant, store) {
    const quantity = store.variantTotal(card.id, variant);
    const isOwned = quantity > 0;
    const article = document.createElement("article");
    article.className = `card-tile${isOwned ? " owned" : ""}`;
    article.dataset.tileCardId = card.id;
    article.dataset.tileVariant = variant;
    const image = card.image
      ? `<button class="image-open" data-preview-card-id="${escapeAttribute(card.id)}" aria-label="${escapeAttribute(t("card.zoom", { name: card.name }))}">${localizedImg(card.image, { alt: card.name, loading: "lazy" })}</button>`
      : `<span class="image-placeholder">${escapeHtml(t("card.noImage"))}</span>`;
    const ownAria = isOwned ? t("tile.removeAria", { variant }) : t("tile.addAria", { variant });
    const qtyBadge = quantity > 1 ? `<span class="tile-qty">×${quantity}</span>` : "";
    const summary = conditionSummary(store, card.id, variant);

    article.innerHTML = `
      <div class="card-image">${image}</div>
      <div class="tile-info">
        <h3>${escapeHtml(card.name)}</h3>
        <p class="tile-variant variant-${escapeAttribute(variantSlug(variant))}">${escapeHtml(variant)}</p>
        <div class="tile-bottom">
          <p class="tile-set">${cardFlag(card.language)}<span>${escapeHtml(card.set)} · ${escapeHtml(card.number)}</span></p>
          <div class="tile-actions">
            <button type="button" class="tile-btn" disabled title="${escapeAttribute(t("tile.binder"))}" aria-label="${escapeAttribute(t("tile.binder"))}">${TILE_ICONS.binder}</button>
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
  function refreshTileOwnership(tile, store) {
    const cardId = tile.dataset.tileCardId;
    const variant = tile.dataset.tileVariant;
    if (!cardId) return;
    const quantity = store.variantTotal(cardId, variant);
    const isOwned = quantity > 0;
    tile.classList.toggle("owned", isOwned);

    const button = tile.querySelector(".tile-own");
    if (!button) return;
    button.classList.toggle("active", isOwned);
    button.setAttribute("aria-pressed", String(isOwned));
    button.setAttribute("aria-label", isOwned ? t("tile.removeAria", { variant }) : t("tile.addAria", { variant }));
    button.innerHTML = `${isOwned ? TILE_ICONS.check : TILE_ICONS.plus}${quantity > 1 ? `<span class="tile-qty">×${quantity}</span>` : ""}`;

    const summaryEl = tile.querySelector("[data-tile-conditions]");
    if (summaryEl) summaryEl.textContent = conditionSummary(store, cardId, variant);
  }

  // Trata o clique no botão +/✓ de um tile (liga/desliga a variante; default NM).
  function handleOwnedTileClick(event, store) {
    const button = event.target.closest("[data-own-card-id]");
    if (!button) return false;
    store.toggleVariant(button.dataset.ownCardId, button.dataset.ownVariant);
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

  function bindCollectionTransfer({ exportButton, importInput, store, cards, onChange }) {
    const cardsById = new Map(cards.map((card) => [card.id, card]));

    exportButton.addEventListener("click", () => {
      const payload = {
        version: 3,
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
        alert(t("error.import"));
      } finally {
        event.target.value = "";
      }
    });
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
    defaultVariant,
    CARD_CONDITIONS,
    variantQuantityRows,
    cardVariantPairs,
    variantTile,
    refreshTileOwnership,
    handleOwnedTileClick,
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
})();
