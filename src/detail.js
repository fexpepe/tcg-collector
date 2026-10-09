(function () {
  const shared = window.TCGShared;
  const { addOptions, unique, normalize, escapeHtml, escapeAttribute, speciesName, debounce, t, tn, localizedImg, toRoman } = shared;

  // (veio do shared.js em 2026-09-14: só esta página consulta a PokéAPI.)
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

  // Endereço do set (2026-10-01): /games/<jogo>/<set>[/<carta>] é esta mesma
  // tela, servida pela borda (functions/games/). A rota vem num <meta> que a
  // borda escreve (nome do set, jogo e carta) e faz aqui o papel da query de
  // /detail?type=set&name=…. O content do <meta> é o próprio caminho: uma cópia
  // guardada pelo service worker que chegue pra OUTRO endereço não abre o set
  // errado. Aí, e na cópia de reserva (sem <meta>), o nome do set sai do mapa
  // do jogo e a carta, do nome dela no endereço (ver rotaPeloMapa).
  const caminhoLimpo = /^\/games\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?\/?$/.exec(location.pathname);
  const metaDaRota = document.querySelector('meta[name="sleevu-rota"]');
  const rotaDaBorda = caminhoLimpo && metaDaRota && metaDaRota.content === location.pathname.replace(/\/+$/, "")
    ? metaDaRota.dataset : null;
  const params = new URLSearchParams(window.location.search);
  if (caminhoLimpo) {
    params.set("type", "set");
    params.delete("scope"); // a tela "dentro da coleção" não tem endereço próprio
    if (rotaDaBorda && rotaDaBorda.set) params.set("name", rotaDaBorda.set);
    if (rotaDaBorda && rotaDaBorda.card) params.set("card", rotaDaBorda.card);
  }
  // O endereço desta tela (/games/<jogo>/<set>), o nome de cada carta nele e o
  // mapa do jogo de onde os dois saem (ver preparaEnderecos). Aqui em cima, e
  // não junto das funções: o rotaPeloMapa já roda no carregamento, e um `let`
  // declarado abaixo de quem o lê na hora é erro de TDZ, calado dentro da
  // promessa (a tela ficaria em "não foi possível carregar o catálogo").
  let mapaDoJogo = null;
  let enderecoDoSet = rotaDaBorda ? `/games/${caminhoLimpo[1]}/${caminhoLimpo[2]}` : "";
  let slugsDoSet = null;
  // Blocos que a borda põe no pé da tela (índice do set, texto da carta) são
  // do endereço em que foram montados: numa cópia que chegue pra outro, saem.
  document.querySelectorAll("[data-indice-set], [data-seo-carta]").forEach((el) => {
    const alvo = el.getAttribute("data-indice-set") || el.getAttribute("data-seo-carta") || "";
    if (!alvo || location.pathname.indexOf(alvo) !== 0) el.remove();
  });
  const detailType = params.get("type") || "";
  // Link de set APOSENTADO: o set entrou pelo import com um setId escolhido à
  // mão e a TCGdex depois publicou o mesmo set com outro (cel30 -> 30th,
  // 18/09/2026). Quem compartilhou o link nesses dois dias cairia numa página
  // vazia. Segue pro id novo — e o ?name= do link velho é DESCARTADO, porque o
  // nome também pode ter mudado ("30th Celebration Classic Collection" virou
  // "30th Classic Collection"): sem nome, resolveSetNameFromId() pega o do
  // catálogo.
  const setIdPedido = params.get("setId") || "";
  const setIdAposentado = shared.mergedSetId(setIdPedido);
  // `let`: a página de SET aceita URL só com ?setId= (sem ?name=) — o nome é
  // resolvido do catálogo em resolveSetNameFromId(), assim que ele chega.
  let detailName = setIdAposentado ? "" : (params.get("name") || "");
  // Desambiguação da página de SET (ver scopeToEdition): o nome sozinho pode
  // casar com mais de uma edição. A lista de Sets carrega estes dois no link
  // quando precisa; ausentes, valem os padrões.
  const detailSetId = setIdAposentado || setIdPedido;
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
    completionFillAlt: document.getElementById("completionFillAlt"),
    altLangNote: document.getElementById("altLangNote"),
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
  acertaTituloDaAba();
  if (detailType === "set") {
    if (elements.type) elements.type.hidden = true;
    if (elements.title) elements.title.hidden = true;
  }

  // Endereço limpo sem a rota da borda: o nome do set sai do mapa do jogo antes
  // de o catálogo ser consultado (o resolveCards espera por isto).
  const rotaPendente = caminhoLimpo && !rotaDaBorda ? rotaPeloMapa() : null;

  // --- Modos de contagem do progresso (páginas de set) ---
  // Master set: cada VARIANTE (Normal/Reverse/Holo…) é um slot próprio, como no
  // tcgcollector.com. Qualquer idioma: a carta conta se a MESMA carta em outra
  // língua for sua (EN↔PT; JA↔chinês — ver shared.sameCardKey). Quem mistura
  // línguas fecha o set numa progressão só, e o tile mostra qual língua você
  // tem (selo âmbar com a bandeira). Vem LIGADO desde 2026-09-29.
  // Preferências GLOBAIS (a de idioma vale também pra lista de sets).
  const MASTER_KEY = "tcg-progress-master-v1";
  let masterMode = localStorage.getItem(MASTER_KEY) === "1";
  let anyLangMode = shared.getAnyLangProgress();
  // Só página de SET: na de Pokémon/artista a grade já mistura as línguas e
  // cada impressão é uma carta própria.
  const contaOutraLingua = () => detailType === "set" && anyLangMode;
  // Índice chave→ids possuídos (todas as línguas). Guardado até a coleção
  // mudar: o tile consulta ele carta a carta, e a grade tem centenas.
  let sameCardIdx = null;
  function sameCardIndex() {
    if (!sameCardIdx) sameCardIdx = shared.ownedSameCardIndex(owned);
    return sameCardIdx;
  }
  // Língua em que você tem a carta fora desta edição ("" = não tem, ou modo
  // desligado). `variants` null = qualquer versão.
  function outraLingua(cardId, variants) {
    return contaOutraLingua() ? shared.otherLanguageOwned(sameCardIndex(), owned, cardId, variants || null) : "";
  }
  // Estado "tenho em outra língua" do tile: classe .other-lang (véu âmbar na
  // imagem, ver styles.css) + selo com a bandeira da língua que você TEM. Mora
  // aqui e não no variantTile do shared.js porque só esta página usa, e o
  // shared.js viaja em todo o site (teto de peso no CI). Roda depois do
  // variantTile (tileOf) e do refreshTileOwnership (refreshOwnership), e
  // desligar o modo apaga os selos (outraLingua devolve "").
  // O selo fica fora da .card-image (senão herdaria o filtro dela): solto no
  // canto do tile; no compacto, colado no nome.
  function marcaOutraLingua(tile) {
    const cardId = tile.dataset.tileCardId;
    const versoes = tile.dataset.tileGrouped ? tile.dataset.tileGrouped.split("|") : [tile.dataset.tileVariant];
    const tem = versoes.some((v) => owned.variantTotal(cardId, v) > 0);
    const lang = tem ? "" : outraLingua(cardId, versoes);
    if ((tile.dataset.altLang || "") === lang) return;
    tile.classList.toggle("other-lang", !!lang);
    const velho = tile.querySelector(".tile-alt-lang");
    if (velho) velho.remove();
    if (!lang) { delete tile.dataset.altLang; return; }
    tile.dataset.altLang = lang;
    const texto = t("tile.otherLang", { lang: shared.cardLanguageLabel(lang) });
    const selo = document.createElement("span");
    selo.className = "tile-alt-lang";
    selo.title = texto;
    selo.setAttribute("role", "img");
    selo.setAttribute("aria-label", texto);
    selo.innerHTML = `<span class="tile-alt-lang-in" aria-hidden="true">${shared.cardFlag(lang)}${escapeHtml(shared.cardLangSigla(lang))}</span>`;
    const nome = tile.classList.contains("tile-compact") ? tile.querySelector(".tile-name") : null;
    if (nome) nome.appendChild(selo);
    else tile.prepend(selo);
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
      shared.setAnyLangProgress(anyLangMode);
      // Filtro Tenho/Faltando ativo muda de resultado (a carta âmbar troca de
      // lado): aí reconstrói a grade. Sem filtro, só re-pinta os tiles.
      if (selectedOwned === "owned" || selectedOwned === "missing") render({ resetCount: true });
      else refreshOwnership();
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
  // Fichário: motor compartilhado com a Minha Coleção (src/binder-view.js). A
  // chave guarda quantos bolsos por página (preferência global, como o modo de
  // visualização); o motor cuida das páginas, da navegação e do teclado.
  const binderView = window.TCGBinderView.createBinderView({ root: elements.grid, grid: elements.grid, storageKey: "tcg-detail-binder-pockets" });

  // Ordena os pares carta×variante conforme o Ordenar (src/ordenar.js, o
  // mesmo de toda grade). Diferente dos outros filtros: não esconde nada, só
  // reordena. O preço é o exibido no tile (manual ou, na falta, referência de
  // mercado), pra a ordem bater com o que se vê.
  function sortTiles(pairs) {
    return pairs.sort(window.TCGOrdenar.compara(selectedSort, {
      preco: (p) => shared.cardValue(p.card, p.variant, prices, shared.DEFAULT_CONDITION).value || 0,
      depois: () => render()
    }));
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
    gundam: ["Common", "C+", "C++", "Uncommon", "U+", "Rare", "R+", "Legend Rare", "LR+", "LR++", "Promo"],
    // Star Wars: Unlimited: 5 raridades limpas no catálogo (30/09/2026).
    swu: ["Common", "Uncommon", "Rare", "Legendary", "Special"],
    // Cyberpunk TCG: 9 raridades limpas (30/09/2026). "Iconic *" são as
    // alt-arts e "Nova Rare" é a das promos/box toppers.
    cyberpunk: ["Common", "Uncommon", "Rare", "Epic", "Secret", "Iconic Legend", "Iconic Other", "Iconic Secret", "Nova Rare"],
    // World of Warcraft TCG (30/09/2026): as 4 do booster, Loot (os loots com
    // código do jogo online) e o "F" que o TCGplayer dá às cartas do raid de
    // Onyxia, que vai pro fim por estar fora da lista.
    wow: ["Common", "Uncommon", "Rare", "Epic", "Loot"],
    // LOTR TCG da Decipher: as raridades do banco do Player's Council
    // (sync-lotr.mjs). Tengwar, Legends e Masterworks são as impressões
    // especiais; os quatro últimos moram nos sets de promo.
    lotr: ["Common", "Uncommon", "Rare", "Rare Plus", "Starter", "Premium", "Tengwar", "Legends", "Masterwork", "Promo",
      "Megasized Promo", "Digital Promo", "W-Series", "April Fool's", "St. Patrick's Day"],
    // Sorcery: Contested Realm (01/10/2026): as 4 da carta (Ordinary até
    // Unique) e Promo, que o TCGplayer dá às impressões de loja e de evento. O
    // Avatar e os tokens não têm raridade.
    sorcery: ["Ordinary", "Exceptional", "Elite", "Unique", "Promo"],
    // Harry Potter TCG: os símbolos do jogo, mais as duas premium (30/09/2026).
    harrypotter: ["Common", "Uncommon", "Rare", "Lesson", "Foil Premium", "Holo Portrait Premium", "Promo"],
    // Weiß Schwarz (01/10/2026): a escada do booster, as paralelas (SP/SSP/
    // OFR/SEC) e as fora do booster. São ~65 strings no jogo, mas um set tem
    // uns 12; as raras temáticas de um set só ("Persona Rare", "Band Rare")
    // vão pro fim, em ordem alfabética.
    weiss: ["Common", "Uncommon", "Rare", "Double Rare", "Triple Rare", "Super Rare", "Special Rare",
      "Super Special Rare", "Over-Frame Rare", "Secret Rare", "Climax Common", "Climax Rare", "Trial Deck", "Promo", "Reprint"]
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
    onOwnedChange: () => refreshOwnership(),
    cardPath: caminhoDaCarta
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
      // O popup da carta abre ANTES da grade (2026-10-08): quem pousa na rota
      // de uma carta veio ver a CARTA, e a imagem grande dela entrava na fila
      // depois das imagens eager da grade. Aberto antes, ele sai primeiro e a
      // grade nasce sem eager (o pager vê o popup aberto).
      // ?card=<id>: reabre o popup da carta — é onde o link compartilhado do
      // modal e as páginas /card/<slug>.html do Google aterrissam.
      preview.openFromUrl();
      // /games/<jogo>/<set>/<carta> com a rota da borda: a carta já veio no
      // <meta>, e o nome dela no endereço já é conhecido.
      const cartaDaRota = caminhoLimpo && caminhoLimpo[3] && rotaDaBorda && rotaDaBorda.card;
      if (cartaDaRota && cardsById.has(cartaDaRota)) {
        slugsDoSet = new Map([[cartaDaRota, caminhoLimpo[3]]]);
        preview.open(cartaDaRota, undefined, { semHistorico: true });
      }
      init();
      preparaEnderecos();
    })
    .catch((error) => {
      setPronto(); // sem catálogo, sem trilho: o lugar reservado sai
      shared.mostraErroDeCatalogo(elements.empty, error);
      elements.empty.hidden = false;
    });

  // Procura o set pelo NOME nos outros jogos (fatia indexes-sets de cada um,
  // JSON leve) e, achando exatamente um dono, troca o ?game= da URL e recarrega.
  // Sequencial e com parada no primeiro match: é caminho raro (só link errado),
  // não vale abrir 11 requisições em paralelo.
  async function rescueWrongGame() {
    if (caminhoLimpo) return;
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
    }
    renderInsights();
    placeSetHero();
    initBackLink();
    hydrateFilters();
    if (elements.sortSelect) elements.sortSelect.value = selectedSort; // padrão: maior preço
    bindEvents();
    initProgressModes();
    initCollapsibles();
    applyGridView();
    render();
    setPronto();
  }
  // Fim da reserva de lugar do trilho do set (ver data-set-pronto no styles.css):
  // daqui pra frente vale o que o init desenhou — trilho, ou o hero no resumo.
  function setPronto() { document.documentElement.setAttribute("data-set-pronto", ""); }

  // Página de SET (2026-09-16): o hero (logo + nome) vira o PRIMEIRO cartão do
  // trilho de resumo, ao lado de raridade / tipo / conjunto completo — no
  // desktop e no celular, tudo na mesma fileira. Pedido do Fernando: a linha
  // de cima (hero + coluna de valores à direita) repetia o que os cartões já
  // dizem — "Valor total" é o "Valor de mercado do set", e cartas marcadas /
  // nessa página / progresso são o "N de T" com o anel — e sobrava um slot na
  // fileira dos cartões. O que NÃO é redundante ("Já gasto" e "Falta") entra
  // dentro do cartão do hero, embaixo do nome, e a barra de progresso vai
  // junto (é ela que faz o pulso quando o set fecha). Os stats e o "Valor
  // total" seguem no DOM (os ids continuam sendo atualizados por textContent)
  // mas escondidos pelo CSS (.insight-hero). Mover o NÓ, e não duplicar,
  // mantém uma fonte só pros ids de valor.
  // O .detail-summary fica vazio e some — senão sobrava a margem dele.
  // Sem trilho (set sem cartas no catálogo local) nada muda: o hero fica onde
  // sempre ficou.
  function placeSetHero() {
    if (detailType !== "set" || elements.hero.hidden) return;
    const rail = elements.insights && !elements.insights.hidden
      ? elements.insights.querySelector(".set-insights-rail") : null;
    if (!rail) return;
    elements.hero.classList.add("insight-card", "insight-hero");
    if (elements.detailValues) elements.hero.appendChild(elements.detailValues);
    if (elements.completionBar) elements.hero.appendChild(elements.completionBar);
    if (elements.altLangNote) elements.hero.appendChild(elements.altLangNote);
    rail.prepend(elements.hero);
    const summary = document.querySelector(".detail-summary");
    if (summary) summary.hidden = true;
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
    // Set: o Voltar leva pra tela do jogo no endereço dele (/games/<jogo>,
    // desde 2026-09-30), não pro /sets da sessão.
    const urlDoJogo = window.SLEEVU && window.SLEEVU.urlDoJogo;
    if (detailType === "set" && urlDoJogo) back.href = urlDoJogo(paginaGame(), "") || back.href;
    // Set de uma LINHA da marca (Carddass Hyper Battle, One Piece 2002,
    // Miracle Battle, Data Carddass…): o Voltar e as abas Cartas/Sets voltam
    // pra página DA LINHA. A subnav do shared.js só conhece a linha pelo
    // ?line= da URL, e nenhum link de set carrega isso (nem o tile da própria
    // lista da linha, nem o popup da carta, a Coleção ou a página do Google):
    // o botão Sets de um set vintage abria o One Piece moderno (2026-09-30).
    // A linha sai do PRÓPRIO set, pelo prefixo do setId — vale pra qualquer
    // porta de entrada, inclusive o link só com ?name=, cujo id só se sabe
    // agora, com o catálogo carregado.
    const line = linhaDoSet();
    trilhaDoSet(line);
    if (!line) return;
    const sufixo = `?game=${paginaGame()}&line=${line}`;
    const telaDaLinha = urlDoJogo && urlDoJogo(paginaGame(), line);
    back.href = telaDaLinha || `sets${sufixo}`;
    document.querySelectorAll(".explore-subnav a").forEach((a) => {
      const href = a.getAttribute("href");
      // A aba Sets já é o endereço do jogo (/games/…): vira o da linha, em vez
      // de levar um ?line= pendurado que o endereço contradiria.
      a.setAttribute("href", telaDaLinha && href.indexOf("/games/") === 0 ? telaDaLinha : `${href.split("?")[0]}${sufixo}`);
    });
  }
  // Trilha do set no desktop (2026-09-30): Jogos › <jogo> › [<linha> ›] <set>,
  // cada nível um link — dá pra voltar pro jogo OU direto pra tela de jogos.
  // O nome é o mesmo do hero (setDisplayName: vintage japonês em inglês). Só
  // em set e fora do modo coleção: lá o "← Voltar" leva à Coleção, e a
  // trilha do catálogo levaria pra outro lugar. No celular segue o Voltar.
  function trilhaDoSet(line) {
    const sample = pageCards[0];
    const nome = window.SLEEVU && window.SLEEVU.name;
    if (detailType !== "set" || !sample || !nome) return;
    const jogo = paginaGame();
    // Cada nível no endereço da tela dele (/games/<jogo>, /games/<linha>); o
    // /sets?game= só se o game.js não carregou o registro dos endereços.
    const urlDoJogo = window.SLEEVU.urlDoJogo;
    const tela = (l) => (urlDoJogo && urlDoJogo(jogo, l)) || `sets?game=${jogo}${l ? `&line=${l}` : ""}`;
    const itens = [{ label: nome, href: tela("") }];
    const def = line && (shared.GAME_LINES[jogo] || {})[line];
    if (def) itens.push({ label: t(def.titleKey), href: tela(line) });
    itens.push({ label: shared.setDisplayName(sample.setId, sample.set, sample.language) });
    shared.setCrumbs(itens);
  }
  function linhaDoSet() {
    if (detailType !== "set") return "";
    const setId = (pageCards[0] && pageCards[0].setId) || detailSetId;
    const jogo = paginaGame();
    return Object.keys(shared.GAME_LINES[jogo] || {}).find((line) => shared.lineScope(jogo, line).includes(setId)) || "";
  }

  // Alterna a grade entre grade (cards) e lista (linhas), guardando a preferência.
  function applyGridView() {
    shared.applyGridViewClasses(elements.grid, gridView);
    if (elements.viewToggle) {
      elements.viewToggle.querySelectorAll("[data-grid-view]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.gridView === gridView));
      });
      // O botão do fichário diz quantos bolsos tem (número no canto + título).
      binderView.paintToggle(elements.viewToggle.querySelector('[data-grid-view="binder"]'));
    }
  }

  // Região de idioma que a página deve abrir quando a URL NÃO traz o nome (o
  // id sozinho não diz qual edição é: "30th-c" é a inglesa e a portuguesa,
  // "SV9" é a japonesa e a chinesa). Na ordem: o ?region= do link, que sabe de
  // qual tile saiu; a língua do ?card= compartilhado (30th-c-001-pt já diz
  // "português"); a preferência de idioma de carta. Nada disso = "" e vale a
  // ordem do manifest, como era antes.
  // Mesma régua do pickSetEdition (shared.js), que resolve o mesmo empate
  // quando o link vem pelo NOME.
  function regiaoPedida() {
    if (detailRegion) return detailRegion;
    const cardId = params.get("card") || "";
    if (cardId) return shared.cardLanguageRegion(shared.cardLanguageFromId(cardId));
    const pref = shared.getCardLang();
    return pref && pref !== "all" ? shared.cardLanguageRegion(pref) : "";
  }

  // URL só com ?setId= (sem ?name=): acha o nome no catálogo já carregado —
  // manifest (produção) ou cards.js (dev). Tudo abaixo continua chaveado pelo
  // nome, como sempre foi; só a entrada ganhou uma porta a mais.
  //
  // O nome sai da EDIÇÃO da região pedida, não da primeira entrada com esse id:
  // o manifest é mesclado na ordem "en ja zh-cn zh-tw pt", então pegar a
  // primeira abria a "Coleção Clássica de 30 Anos" como "30th Classic
  // Collection", em inglês (20/09/2026) — e todo set chinês como o japonês
  // irmão. Sem edição na região pedida (link PT pra um set que só existe em
  // inglês) fica a primeira, como antes.
  function resolveSetNameFromId() {
    if (detailType !== "set" || detailName || !detailSetId) return;
    const regiao = regiaoPedida();
    const daRegiao = (language) => !regiao || shared.cardLanguageRegion(language) === regiao;
    const manifest = window.TCG_MANIFEST;
    const entries = manifest && Array.isArray(manifest.sets) ? manifest.sets.filter((set) => set.id === detailSetId) : [];
    const entry = entries.find((set) => daRegiao(set.language)) || entries[0];
    if (entry) { detailName = entry.name; pintaTituloDoSet(); return; }
    const doSet = Array.isArray(window.TCG_CARDS) ? window.TCG_CARDS.filter((c) => c.setId === detailSetId) : [];
    const card = doSet.find((c) => daRegiao(c.language)) || doSet[0];
    if (card) { detailName = card.set; pintaTituloDoSet(); }
  }
  // O título é pintado no começo da página, quando `detailName` ainda pode estar
  // VAZIO: a URL só com ?setId= resolve o nome depois de o catálogo chegar. Sem
  // repintar aqui, o set abria com o rótulo genérico no lugar do nome — vale pros
  // sets de nome japonês (que a lista linka por id) e pro link de set APOSENTADO,
  // que segue pro id novo e por isso entra sem ?name=.
  function pintaTituloDoSet() {
    if (elements.title && detailName) elements.title.textContent = detailName;
    acertaTituloDaAba();
  }
  // A aba com o nome da página (set, Pokémon, artista, treinador). A borda já
  // manda o título certo do set; isto é pra cópia que o service worker guardou
  // de OUTRA página (a entrada do detail.html é uma só pra todo /detail?… e é a
  // reserva dos endereços /games/…) e pra casca crua: sem isto a aba mostrava o
  // set visto antes, ou "Detalhe". Página montada pela borda PRA ESTE endereço
  // (rotaDaBorda) nunca é tocada: o título da carta de nome longo nem leva o
  // nome do set, e é o que o Google lê.
  function acertaTituloDaAba() {
    if (!detailName || rotaDaBorda || document.title.indexOf(detailName) >= 0) return;
    const el = document.querySelector("title");
    if (el) el.removeAttribute("data-i18n");
    document.title = `${detailName} | Sleevu`;
  }

  // Barra de endereço LIMPA pros sets de nome não-ASCII: troca ?name=<japonês>
  // por ?setId=<id>, sem entrada no histórico (replaceState). É o que o Ctrl+C
  // na barra copia — sleevu.app/detail?type=set&setId=hxh-hb-jf02&game=hxh em
  // vez de 140 caracteres de %E3%82%B8. Só depois de o set resolver: uma URL
  // trocada antes de saber se o id existe seria pior do que a feia.
  function limpaUrlDoSet() {
    if (caminhoLimpo) return; // o endereço do set já é legível
    if (detailType !== "set" || !pageCards.length || nomeLegivelNaUrl(detailName)) return;
    const id = detailSetId || pageCards[0].setId;
    if (!id || !params.has("name")) return;
    try {
      const sp = new URLSearchParams(window.location.search);
      sp.delete("name");
      sp.set("setId", id);
      // Trocar o nome pelo id PERDE a edição quando o id é dividido (a PT usa o
      // mesmo id da EN, a chinesa o da japonesa): a URL limpa abriria a outra
      // língua num F5. Por isso a região vai junto — só nesses, pra URL do set
      // de id único continuar tão curta quanto era.
      if (idComVariasEdicoes(id)) sp.set("region", shared.cardLanguageRegion(pageCards[0].language));
      history.replaceState(history.state, "", `${window.location.pathname}?${sp.toString()}`);
    } catch (e) { /* replaceState negado (iframe/sandbox): a URL feia ainda funciona */ }
  }

  // Mais de uma edição (região de idioma) sob o mesmo setId no catálogo desta
  // página — é quando o id sozinho não identifica o set.
  function idComVariasEdicoes(setId) {
    const manifest = window.TCG_MANIFEST;
    const fonte = manifest && Array.isArray(manifest.sets)
      ? manifest.sets.filter((set) => set.id === setId)
      : (Array.isArray(window.TCG_CARDS) ? window.TCG_CARDS.filter((c) => c.setId === setId) : []);
    const regioes = new Set(fonte.map((item) => shared.cardLanguageRegion(item.language)));
    return regioes.size > 1;
  }

  // ── Endereço do set e de cada carta (2026-10-01) ─────────────────────────
  // O mapa de cada /games/<jogo> (data/game-pages/<jogo>.json, gerado pelo
  // prerender): set no endereço -> nome, chunks, total. É o mesmo que a borda
  // lê pra montar esta tela; uma leitura por página.
  function carregaMapa(url) {
    if (!mapaDoJogo) {
      mapaDoJogo = fetch(`data/game-pages/${url}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    }
    return mapaDoJogo;
  }
  // Endereço limpo sem a rota da borda (cópia de reserva do service worker,
  // offline): o nome do set sai do mapa. A variante -en estática que caia aqui
  // (offline, sem cópia própria) abre a tela do set, que é o que dá pra abrir.
  async function rotaPeloMapa() {
    const mapa = await carregaMapa(caminhoLimpo[1]);
    const sets = (mapa && mapa.s) || {};
    const temSet = (k) => Object.prototype.hasOwnProperty.call(sets, k);
    const slug = temSet(caminhoLimpo[2]) ? caminhoLimpo[2]
      : (/-en$/.test(caminhoLimpo[2]) && temSet(caminhoLimpo[2].slice(0, -3)) ? caminhoLimpo[2].slice(0, -3) : "");
    if (!slug) return;
    detailName = sets[slug].n;
    pintaTituloDoSet();
  }

  // Nome de cada carta no endereço: a MESMA conta da borda, sobre as MESMAS
  // cartas (os chunks que o mapa lista pra este set). Cópia de
  // functions/_lib/slug-carta.js (este arquivo é script clássico e não importa
  // módulo); tests/slug-carta-cliente.test.mjs roda as duas nas mesmas cartas.
  // <slug-carta>
  const ACENTOS_SLUG = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");
  const CJK_SLUG = new RegExp("[" + String.fromCharCode(0x3000) + "-" + String.fromCharCode(0x9fff) +
    String.fromCharCode(0xac00) + "-" + String.fromCharCode(0xd7af) +
    String.fromCharCode(0xff00) + "-" + String.fromCharCode(0xffef) + "]");
  function slugify(texto) {
    return String(texto == null ? "" : texto)
      .normalize("NFKD").replace(ACENTOS_SLUG, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
  function baseDoSlug(card) {
    const nome = String((card && card.name) || "");
    const nomeNoEndereco = CJK_SLUG.test(nome) ? (slugify(card.nameEn || card.pokemonName || "") || slugify(nome)) : slugify(nome);
    let numero = String((card && card.number) || "").trim();
    const total = String((card && card.setTotal) || "").trim();
    if (numero && /^\d+$/.test(numero) && /^\d+$/.test(total)) numero = `${numero}-${/^0\d+$/.test(numero) ? total.padStart(numero.length, "0") : total}`;
    const l = String((card && card.language) || "en").toLowerCase().slice(0, 2);
    const idioma = !l || l === "en" ? "" : (l === "ja" ? "jp" : l);
    return slugify([nomeNoEndereco, numero, idioma].filter(Boolean).join("-")) || "card";
  }
  function slugsDasCartas(lista) {
    const porId = [...(lista || [])].filter((c) => c && c.id != null)
      .sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
    const usados = new Set();
    const mapa = new Map();
    for (const c of porId) {
      const id = String(c.id);
      if (mapa.has(id)) continue;
      const base = baseDoSlug(c);
      let slug = base;
      let i = 2;
      while (usados.has(slug)) slug = `${base}-${i++}`;
      usados.add(slug);
      mapa.set(id, slug);
    }
    return mapa;
  }
  // </slug-carta>

  // O popup pergunta aqui o caminho da carta aberta (e o da tela, ao fechar).
  // Só com a barra já no endereço limpo: em /detail?… o popup segue no ?card=.
  function caminhoDaCarta(id) {
    if (!enderecoDoSet || location.pathname.indexOf("/games/") !== 0) return null;
    const slug = id && slugsDoSet && slugsDoSet.get(String(id));
    return slug ? `${enderecoDoSet}/${slug}` : enderecoDoSet;
  }
  // Acha o set no mapa pelo NOME (a chave da borda), conta os nomes das cartas
  // e passa a barra pro endereço limpo: quem entrou por /detail?type=set&… (a
  // grade de Sets, a busca, um link antigo) passa a ver, copiar e compartilhar
  // o endereço do set. replaceState: o "voltar" continua indo pra onde ia.
  async function preparaEnderecos() {
    if (detailType !== "set" || collectionScope || !pageCards.length) return;
    const urlDoSet = window.SLEEVU && window.SLEEVU.urlDoSet;
    const baseDoJogo = caminhoLimpo ? `/games/${caminhoLimpo[1]}` : ((urlDoSet && urlDoSet(paginaGame(), pageCards[0].setId)) || "");
    if (!baseDoJogo) return;
    const mapa = await carregaMapa(baseDoJogo.slice("/games/".length));
    const sets = (mapa && mapa.s) || {};
    const slugDoSet = Object.keys(sets).find((k) => sets[k].n === detailName);
    if (!slugDoSet) return;
    const entrada = sets[slugDoSet];
    const listas = await Promise.all((entrada.f || []).map((f) => fetch(f)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])));
    const doSet = [].concat(...listas.map((l) => (Array.isArray(l) ? l : [])))
      .filter((c) => c && c.set === entrada.n && !c.retired);
    const semente = slugsDoSet;
    slugsDoSet = slugsDasCartas(doSet);
    // A carta aberta pela rota da borda segue achável mesmo se o chunk não veio.
    if (semente) semente.forEach((slug, id) => { if (!slugsDoSet.has(id)) slugsDoSet.set(id, slug); });
    enderecoDoSet = `${baseDoJogo}/${slugDoSet}`;
    if (caminhoLimpo) {
      // Cópia de reserva (sem a rota da borda): a carta do endereço abre agora.
      if (caminhoLimpo[3] && !rotaDaBorda) {
        let id = "";
        slugsDoSet.forEach((slug, cardId) => { if (!id && slug === caminhoLimpo[3]) id = cardId; });
        if (id && cardsById.has(id)) preview.open(id, undefined, { semHistorico: true });
      }
      return;
    }
    try {
      const u = new URL(location.href);
      const aberta = u.searchParams.get("card");
      const slugDaCarta = aberta && slugsDoSet.get(aberta);
      ["type", "name", "setId", "game", "card"].forEach((k) => u.searchParams.delete(k));
      if (aberta && !slugDaCarta) u.searchParams.set("card", aberta);
      history.replaceState(history.state, "", (slugDaCarta ? `${enderecoDoSet}/${slugDaCarta}` : enderecoDoSet) + u.search + u.hash);
    } catch (e) { /* history bloqueado: fica o endereço antigo, que funciona igual */ }
  }

  // No modo manifest, baixa apenas os chunks de set necessários para esta página.
  // O manifest.generated.js de novo, por um <script> com query nova: fura o
  // cache HTTP e a entrada do service worker (a chave leva a query). O arquivo
  // reatribui window.TCG_MANIFEST; devolve ele (ou null se não carregou).
  let manifestRecarregado = null;
  function recarregaManifest() {
    const sleevu = window.SLEEVU || {};
    if (!sleevu.manifest || !sleevu.dataDir) return Promise.resolve(null);
    if (!manifestRecarregado) {
      manifestRecarregado = new Promise((resolve) => {
        const s = document.createElement("script");
        s.src = `${sleevu.dataDir}manifest.generated.js?v=${Date.now()}`;
        s.onload = () => resolve(window.TCG_MANIFEST && Array.isArray(window.TCG_MANIFEST.sets) ? window.TCG_MANIFEST : null);
        s.onerror = () => resolve(null);
        (document.head || document.documentElement).appendChild(s);
      });
    }
    return manifestRecarregado;
  }

  async function resolveCards() {
    if (rotaPendente) await rotaPendente;
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
      // Chunk congelado de set aposentado (`retired`) só quando o link pede o
      // id dele — e mesmo esse link já foi mandado pro set novo (mergedSetId).
      const doSet = (m) => m.sets.filter((set) => set.name === detailName && (!set.retired || set.id === detailSetId));
      let entries = doSet(manifest);
      // Set que o manifest guardado NÃO conhece (2026-10-08): no dia do
      // lançamento, quem já usa o app tem o manifest de ontem no service worker
      // (stale-while-revalidate) e no cache HTTP (1 h + 1 dia de stale), e a
      // tela dizia "Nenhuma carta encontrada" pro set novo — reproduzido em
      // produção. Antes de concluir, busca o manifest de novo furando os dois
      // caches (a query nova é outra chave nos dois) e procura outra vez. Uma
      // vez por página: nome que não existe mesmo paga só esse pedido.
      if (!entries.length && detailName) {
        const fresco = await recarregaManifest();
        if (fresco) entries = doSet(fresco);
      }
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
      // neste jogo (Digimon/YGO/Riftbound/Union Arena/Star Wars/Cyberpunk/Sorcery não têm artista).
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
    const conhecidos = new Set(setIds);
    // Id que NÃO começa pelo setId (Magic: "mtg-10e-1", set "10e"): o
    // setIdForCard devolvia "mtg-10e", que não existe no manifest, e a página
    // do artista abria VAZIA — os 2.520 artistas do Magic (visto em produção
    // em 2026-10-08: "Pete Venters", 567 cartas no índice, 0 na tela). Sem o
    // prefixo do jogo, o set aparece.
    const setDoId = (cardId) => {
      const direto = shared.setIdForCard(cardId, setIds);
      return conhecidos.has(direto) ? direto : shared.setIdForCard(cardId.replace(/^[a-z0-9]+-/i, ""), setIds);
    };
    const neededSetIds = new Set(group.cardIds.map(setDoId));
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
      // Custo pra completar: preenchido pelo updateMissingCost (muda com a
      // coleção e com o "contar qualquer idioma").
      const missingHtml = `<p class="set-missing" data-set-missing hidden></p>`;
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
          <div class="set-bonus" data-set-bonus hidden></div>
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
    const meta = await fetchPokemonMeta(dexId);

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
        // Já no fichário: o clique troca o tamanho (9 → 12 → 16 → 4 → 9…).
        if (querBinder && eraBinder) binderView.cycle();
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
    sameCardIdx = null;
    const visibleCards = filterCards();
    const tiles = sortTiles(shared.cardVariantPairs(visibleCards, { group: agrupaVersoes }));
    // Cartas sem imagem vão para o fim (sort estável preserva a ordem da ordenação escolhida).
    tiles.sort((a, b) => Number(shared.cardHasImage(b.card)) - Number(shared.cardHasImage(a.card)));
    const tileOf = ({ card, variant }) => {
      const tile = shared.variantTile(card, variant, owned, wishlist, prices, { addMode: true, grouped: agrupaVersoes, compact: gridView === "compact", lists: true });
      marcaOutraLingua(tile);
      return tile;
    };
    if (gridView === "binder") { pager.render([], tileOf); binderView.render(tiles, tileOf); }
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
    // O "N resultados" saiu da tela (2026-09-17); o elemento some, a conta não
    // precisa morrer junto — quem quiser o número de volta só repõe o <p>.
    if (elements.resultCount) elements.resultCount.textContent = tn("results.count", tiles.length);
    updateHeaderStats();
  }

  // ── Resumo visual do set (cartões de insight) ────────────────────────────
  // Três cartões, molde do app Dex (pedido de 2026-09-14): distribuição por
  // GRUPO de raridade, distribuição por TIPO de carta e o trio conjunto /
  // lançamento / valor de mercado com um anel de progresso. Os dois gráficos
  // saem das cartas da página (não mudam com a coleção) e são montados uma
  // vez pelo módulo compartilhado src/insights.js (a Minha Coleção usa os
  // mesmos); o terceiro é atualizado pelo updateHeaderStats/updateValueStats.
  function renderInsights() {
    const box = elements.insights;
    if (!box || detailType !== "set" || !pageCards.length) return;
    const jogo = paginaGame();
    const raridadeHtml = window.TCGInsights.rarityCard(pageCards);
    const tipoHtml = window.TCGInsights.typeCard(pageCards, () => jogo);
    // Conjunto / lançamento / valor + anel de progresso. Com título, como os
    // outros dois, e em SEGUNDO (logo depois do hero, que o placeSetHero põe
    // na frente): pedido do Fernando, 2026-09-16 — é o cartão que responde
    // "como estou nesse set", e vinha por último.
    // Cartas bônus (Mew RGB da 30th / M6a): existem no set mas ficam fora do
    // "Conjunto completo" — sem esta linha o cartão dizia "N de 158" e não
    // contava que o set tem mais 3 (25/09/2026). O "n de 3" vem do
    // updateBonusStat, junto com o selo do hero.
    const temBonus = pageCards.some((card) => shared.isBonusCard(card));
    const lanc = pageCards[0].setReleaseDate ? formatInsightDate(pageCards[0].setReleaseDate) : t("insights.na");
    const resumoHtml = `
      <article class="insight-card insight-summary">
        <h3>${escapeHtml(t("insights.overview"))}</h3>
        <dl>
          <div><dt>${escapeHtml(t("insights.complete"))}</dt><dd data-insight-complete>—</dd></div>
          <div><dt>${escapeHtml(t("insights.release"))}</dt><dd>${escapeHtml(lanc)}</dd></div>
          <div><dt>${escapeHtml(t("insights.marketValue"))}</dt><dd data-insight-value>${escapeHtml(t("insights.na"))}</dd></div>
          ${temBonus ? `<div title="${escapeAttribute(t("set.bonusHint"))}"><dt>${escapeHtml(t("insights.bonus"))}</dt><dd data-insight-bonus>—</dd></div>` : ""}
        </dl>
        <svg class="insight-ring" viewBox="0 0 120 120" role="img" data-insight-ring aria-label="0%">
          <circle class="insight-ring-track" cx="60" cy="60" r="50"/>
          <circle class="insight-ring-fill" cx="60" cy="60" r="50" pathLength="100" stroke-dasharray="0 100"/>
          <circle class="insight-ring-alt" cx="60" cy="60" r="50" pathLength="100" stroke-dasharray="0 100"/>
          <text x="60" y="60" text-anchor="middle" dominant-baseline="central" data-insight-pct>0%</text>
        </svg>
      </article>`;
    box.innerHTML = `<div class="set-insights-rail">${resumoHtml}${raridadeHtml}${tipoHtml}</div>`;
    box.hidden = false;
  }
  function formatInsightDate(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString(shared.getLocale(), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }
  // Parte VIVA do 3º cartão: conjunto (N de T) e o anel. A contagem é a mesma
  // dos stats (respeita master set / qualquer idioma), então vem de lá.
  // `altPct` = fatia do `pct` que vem de outra língua: o anel desenha ela como
  // um segundo arco âmbar logo depois do arco principal.
  function updateInsightsProgress(ownedN, totalN, pct, altPct) {
    const box = elements.insights;
    if (!box || box.hidden) return;
    const comp = box.querySelector("[data-insight-complete]");
    if (comp) comp.textContent = t("insights.completeValue", { n: ownedN, t: totalN });
    const alt = Math.max(0, Math.min(100, altPct || 0));
    const aqui = Math.max(0, Math.min(100, pct) - alt);
    const fill = box.querySelector(".insight-ring-fill");
    if (fill) fill.setAttribute("stroke-dasharray", `${aqui} 100`);
    const fillAlt = box.querySelector(".insight-ring-alt");
    if (fillAlt) {
      fillAlt.setAttribute("stroke-dasharray", `${alt} 100`);
      fillAlt.setAttribute("stroke-dashoffset", String(-aqui));
    }
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
    sameCardIdx = null; // a coleção mudou (ou o modo): o índice de línguas refaz
    elements.grid.querySelectorAll(".card-tile").forEach((tile) => {
      shared.refreshTileOwnership(tile, owned, wishlist, { addMode: true });
      marcaOutraLingua(tile);
    });
    updateHeaderStats();
  }

  function updateHeaderStats() {
    // Cartas bônus (Mew RGB da 30th Celebration…) aparecem na grade mas não
    // entram no 100% do set — nem no denominador, nem no numerador. Quem tem
    // ganha o selo de bônus no hero (updateBonusStat). Só na página de SET: na
    // do Pokémon/artista a carta conta como qualquer outra.
    const contaveis = detailType === "set" ? pageCards.filter((card) => !shared.isBonusCard(card)) : pageCards;
    // Duas parcelas: `aquiN` = tenho NESTA edição; `altN` = falta aqui mas
    // tenho a mesma carta em outra língua (só com "qualquer idioma"). O
    // progresso é a soma; a barra e o anel desenham as duas separadas.
    const master = masterMode && detailType === "set";
    let aquiN = 0, altN = 0, totalN = 0;
    const linguasAlt = new Set();
    contaveis.forEach((card) => {
      // Master set: cada variante é um slot (a Reverse em EN não cobre a
      // Normal em PT). Sem ele, a carta é um slot só, qualquer versão.
      const slots = master
        ? ((card.variants && card.variants.length) ? card.variants : [shared.defaultVariant(card)]).map((v) => [v])
        : [null];
      slots.forEach((vs) => {
        totalN++;
        const aqui = vs ? owned.variantTotal(card.id, vs[0]) > 0 : owned.has(card.id);
        if (aqui) { aquiN++; return; }
        const lingua = outraLingua(card.id, vs);
        if (lingua) { altN++; linguasAlt.add(lingua); }
      });
    });
    const ownedN = aquiN + altN;
    const pct = totalN ? Math.round((ownedN / totalN) * 100) : 0;
    // Parcela âmbar em % da barra: a diferença dos arredondados, pra que as
    // duas somem exatamente o `pct` mostrado.
    const pctAqui = totalN ? Math.round((aquiN / totalN) * 100) : 0;
    updateAltLangNote(altN, linguasAlt);
    updateInsightsProgress(ownedN, totalN, pct, pct - pctAqui);
    elements.ownedCount.textContent = ownedN;
    elements.totalCount.textContent = totalN;
    elements.completionRate.textContent = `${pct}%`;
    // Rótulos acompanham o modo (variantes ≠ cartas).
    const ownedLabel = elements.ownedCount.nextElementSibling;
    const totalLabel = elements.totalCount.nextElementSibling;
    if (ownedLabel) ownedLabel.textContent = t(masterMode && detailType === "set" ? "master.slotsOwned" : "stats.owned");
    if (totalLabel) totalLabel.textContent = t(masterMode && detailType === "set" ? "master.slotsTotal" : "stats.pageTotal");
    // Barra em duas cores: accent = nesta língua; hachurado âmbar = o que
    // completa com a outra. A parcela âmbar vem por último, colada na primeira.
    if (elements.completionFill) elements.completionFill.style.width = `${pctAqui}%`;
    if (elements.completionFillAlt) {
      elements.completionFillAlt.style.width = `${pct - pctAqui}%`;
      elements.completionFillAlt.hidden = altN <= 0;
    }
    if (elements.completionBar) {
      elements.completionBar.classList.toggle("has-alt", altN > 0);
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
    updateBonusStat(ownedN, totalN);
    updateMissingCost();
    updateValueStats();
  }

  // Custo pra completar: mercado das cartas que faltam (piso "≥" se alguma
  // faltante não tem preço). Só aparece com coleção iniciada no set.
  // Carta bônus (shared.isBonusCard) não falta pra ninguém: fica fora. Com
  // "qualquer idioma", a carta que você tem em outra língua também não falta
  // (a mesma régua da barra). Nascia fixo no renderHero; agora acompanha.
  function updateMissingCost() {
    const el = elements.hero && elements.hero.querySelector("[data-set-missing]");
    if (!el) return;
    const paraCompletar = pageCards.filter((card) => !shared.isBonusCard(card));
    const missing = paraCompletar.filter((card) => !owned.has(card.id) && !outraLingua(card.id, null));
    const ownedHere = paraCompletar.length - missing.length;
    el.hidden = true;
    if (!(ownedHere > 0 && missing.length > 0)) return;
    const sum = shared.sumCardsValue(missing, prices);
    if (!(sum.value > 0)) return;
    const cost = `${sum.unpriced > 0 ? "≥ " : "≈ "}${shared.formatMoney(shared.getCurrency(), sum.value)}`;
    el.title = t("set.missingHint", { n: missing.length }) + (sum.unpriced > 0 ? " " + t("set.missingUnpriced", { u: sum.unpriced }) : "");
    el.textContent = t("set.missingCost", { n: missing.length, v: cost });
    el.hidden = false;
  }

  // "Inclui 12 em inglês": diz de onde veio a parte âmbar da barra. Some
  // quando nada vem de outra língua (ou o modo está desligado).
  function updateAltLangNote(altN, linguas) {
    const el = elements.altLangNote;
    if (!el) return;
    if (!altN) { el.hidden = true; el.textContent = ""; return; }
    const siglas = [...linguas].map((code) => shared.cardLangSigla(code)).join(" / ");
    el.textContent = t("progress.altNote", { n: altN, lang: siglas });
    el.hidden = false;
  }

  // Selo de bônus no hero do set: "Cartas bônus 1 de 3". Com o set fechado E
  // todas as bônus, vira dourado ("Set completo + bônus") — é o prêmio a mais
  // de quem tem as cartas que o 100% não exige. Posse por id exato, ou pela
  // mesma carta em outra língua no modo "qualquer idioma" (a régua do progresso).
  function updateBonusStat(ownedN, totalN) {
    const el = elements.hero && elements.hero.querySelector("[data-set-bonus]");
    if (!el) return;
    const bonus = detailType === "set" ? pageCards.filter((card) => shared.isBonusCard(card)) : [];
    if (!bonus.length) { el.hidden = true; return; }
    const tem = (card) => owned.has(card.id) || !!outraLingua(card.id, null);
    const n = bonus.filter(tem).length;
    const tudo = n >= bonus.length && totalN > 0 && ownedN >= totalN;
    const noResumo = elements.insights && elements.insights.querySelector("[data-insight-bonus]");
    if (noResumo) noResumo.textContent = t("insights.completeValue", { n, t: bonus.length });
    el.hidden = false;
    el.classList.toggle("has", n > 0);
    el.classList.toggle("complete", tudo);
    el.title = t("set.bonusHint");
    el.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg><span>${escapeHtml(tudo ? t("set.bonusComplete") : t("set.bonusCount", { n, t: bonus.length }))}</span>`;
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
      // Bônus fica fora do "set completo" e do "falta" (não é preciso pra
      // fechar o set — um Mew RGB de US$ 20 mil inflaria os dois), mas o que
      // você TEM dela entra no "já gasto" normalmente.
      const bonus = detailType === "set" && shared.isBonusCard(card);
      if (!bonus) total += ref;
      // "Já gasto" é posse pelo id exato: a quantidade vive por id, e somar
      // a cópia em outra língua daria um valor que não bate com a Coleção.
      // Já o "Falta" segue a régua do progresso: com "qualquer idioma", a
      // carta que você tem em EN não é compra pendente do set em PT.
      if (!owned.has(card.id)) { if (!bonus && !outraLingua(card.id, null)) toBuy += ref; return; }
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
      // Com "qualquer idioma", a carta que você tem em outra língua é "Tenho"
      // (não aparece no "Faltando") — a mesma régua da contagem.
      const isOwned = owned.has(card.id) || !!outraLingua(card.id, null);
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
