// Vendas e Trocas (sales.html): cartas à venda/troca com preço e condição,
// organizadas em PASTAS DE VENDA (2026-09-27). Uma página, duas vistas:
//   sem ?id=  -> a galeria das pastas (cards em pilha, o molde do Showcase da
//                Coleção) com o resumo de tudo e o histórico de vendas
//   com ?id=  -> a pasta aberta, no molde da pasta da Coleção: cartão-herói
//                (link público, valor, ações), "Visão geral", preço em lote e a
//                grade de cartas com preço e condição editáveis.
// Antes era uma lista corrida só, com filtro de jogo e UM link pra tudo — não
// dava pra mandar "as raras" pra um grupo e "as baratas" pra outro. Agora cada
// pasta tem nome, preço em lote e link público próprios:
// /users/<handle>/vendas/<slug do nome> (shared.saleFolderSlugs).
// Reaproveita o catálogo "owned" (só cartas que você tem), a store de
// preços/preview e a store de vendas (global, cross-game, sincronizada via
// collections.data). Sem inline handlers (CSP script-src 'self').
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const view = document.getElementById("salesView");
  if (!view) return;

  const { unique, t, tn, debounce, escapeHtml, escapeAttribute } = shared;
  const esc = escapeHtml, escA = escapeAttribute;

  let cards = [];
  let cardsById = new Map();
  let pronto = false;   // catálogo carregado (antes disso não há o que pintar)
  let openId = null;    // pasta aberta (null = galeria)

  // Stores por jogo + facades (despacham por jogo pelo cardGameMap). Igual às
  // outras páginas: a página de vendas só lê cartas que você TEM.
  const { ownedByGame, cardGameMap, owned, wishlist, prices } = shared.createCrossGameStores();
  const gameLabelOf = (g) => shared.gameLabel(g);

  // Vendas: cartas à venda, cada uma com um PREÇO DE VENDA + condição, dentro
  // de uma pasta. Global cross-game, por cardId|variant|idx. Local + sync
  // (carimba updatedAt p/ merge LWW do bloco).
  const sales = createSalesStore();
  // Modo investidor: vendas REALIZADAS (histórico) + custo pago (pro P&L).
  const sold = shared.createSoldStore();
  const costs = shared.createCostsStore();
  // Nome da pasta que nasce sozinha. O nome é GRAVADO: se o pacote de textos
  // (i18n-vendas.js) não tivesse carregado, o t() devolveria a chave crua e a
  // pasta ficaria chamada "sales.folders.defaultName" pra sempre.
  function nomePadrao() {
    const n = t("sales.folders.defaultName");
    return n && n !== "sales.folders.defaultName" ? n : "Minhas vendas";
  }
  function createSalesStore() {
    const KEY = "tcg-collector-collection-sales-v1";
    // Id FIXO da pasta que a migração cria (ver normaliza): dois aparelhos que
    // migram a mesma lista chegam no MESMO resultado sem conversar — com um id
    // aleatório cada um criaria a sua, e o LWW do bloco jogaria uma fora.
    const PADRAO = "vd_padrao";
    let data = { sales: {}, order: [], groups: [], updatedAt: 0 };
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (raw && raw.sales && typeof raw.sales === "object") data = raw;
    } catch (e) { /* corrompido: começa vazio */ }
    if (!Array.isArray(data.order)) data.order = [];
    if (!Array.isArray(data.groups)) data.groups = [];
    const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); shared.marcaSuja(KEY); } catch (e) { shared.notifyStorageFull(); } };
    // Cada CÓPIA é um item próprio (cardId|variant|idx) com seu preço e condição —
    // assim dá pra vender 3 da mesma carta com condições diferentes (1 NM, 2 D).
    const keyOf = (cardId, variant, idx) => `${cardId}|${variant}|${idx}`;
    // Migra o formato antigo ("cardId|variant" -> {price,cond}) pra cópia idx 0.
    (function migrate() {
      let changed = false;
      Object.keys(data.sales).forEach((k) => {
        const e = data.sales[k];
        if (!e || e.cardId != null) return; // já no formato novo
        const i = k.indexOf("|");
        if (i < 0) { delete data.sales[k]; changed = true; return; }
        const cardId = k.slice(0, i), variant = k.slice(i + 1);
        const nk = keyOf(cardId, variant, 0);
        data.sales[nk] = { cardId, variant, idx: 0, price: Number(e.price) || 0, cond: e.cond || "NM" };
        if (nk !== k) { delete data.sales[k]; data.order = data.order.map((x) => (x === k ? nk : x)); }
        changed = true;
      });
      if (changed) persist(); // persiste sem bumpar updatedAt
    })();
    // Pastas (2026-09-27): todo item mora numa pasta (`g`). Item sem pasta — a
    // lista de antes das pastas, o "Pôr à venda" em lote da Coleção, pasta
    // apagada em outro aparelho — vai pra PRIMEIRA. Sem pasta nenhuma, nasce
    // "Minhas vendas" herdando o markup global antigo. É determinístico (id
    // fixo, nada de Date.now), então grava SEM bumpar updatedAt, como a
    // migração de cima: não é edição de ninguém.
    (function normaliza() {
      data.groups = data.groups.filter((g) => g && g.id);
      const ids = new Set(data.groups.map((g) => g.id));
      const orfas = data.order.filter((k) => data.sales[k] && !ids.has(data.sales[k].g));
      if (!orfas.length) return;
      if (!data.groups.length) data.groups.push({ id: PADRAO, name: nomePadrao(), markup: Number(data.markup) || 0 });
      orfas.forEach((k) => { data.sales[k].g = data.groups[0].id; });
      persist();
    })();
    const save = () => { data.updatedAt = Date.now(); persist(); };
    const grupo = (id) => data.groups.find((g) => g.id === id) || null;
    const limpaNome = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 40);
    const doItem = (k) => {
      const e = data.sales[k];
      // `auto`: o preço veio do valor de mercado (TCGplayer) e NÃO foi editado à
      // mão — usado pra colorir (laranja = automático, preto = revisado).
      return { key: k, cardId: e.cardId, variant: e.variant, idx: e.idx, price: Number(e.price) || 0, cond: e.cond || "NM", auto: !!e.auto, g: e.g };
    };
    const tira = (k) => { delete data.sales[k]; data.order = data.order.filter((x) => x !== k); };
    const chavesDe = (cardId, variant, g) => data.order.filter((k) => {
      const e = data.sales[k];
      return e && e.cardId === cardId && e.variant === variant && (!g || e.g === g);
    });
    return {
      // --- Pastas ---
      groups: () => data.groups.slice(),
      group: grupo,
      createGroup(name) {
        const g = { id: "vd_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: limpaNome(name) || t("sales.folders.untitled"), markup: 0 };
        data.groups.push(g);
        save();
        return g;
      },
      renameGroup(id, name) {
        const g = grupo(id), nome = limpaNome(name);
        if (!g || !nome || nome === g.name) return false;
        g.name = nome;
        save();
        return true;
      },
      moveGroup(id, delta) {
        const i = data.groups.findIndex((g) => g.id === id), j = i + delta;
        if (i < 0 || j < 0 || j >= data.groups.length) return;
        const [g] = data.groups.splice(i, 1);
        data.groups.splice(j, 0, g);
        save();
      },
      // Apagar a pasta tira as cartas dela da VENDA — nunca da coleção.
      deleteGroup(id) {
        data.groups = data.groups.filter((g) => g.id !== id);
        data.order.filter((k) => data.sales[k] && data.sales[k].g === id).forEach(tira);
        save();
      },
      // --- Itens ---
      has: (cardId, variant, idx) => !!data.sales[keyOf(cardId, variant, idx)],
      priceOf: (cardId, variant, idx) => { const e = data.sales[keyOf(cardId, variant, idx)]; return e ? (Number(e.price) || 0) : 0; },
      condOf: (cardId, variant, idx) => { const e = data.sales[keyOf(cardId, variant, idx)]; return (e && e.cond) || "NM"; },
      // Quantas cópias deste card+variant estão à venda (numa pasta, ou em todas).
      countOf: (cardId, variant, g) => chavesDe(cardId, variant, g).length,
      // Pastas em que as cópias deste card+variant estão (sem repetir).
      foldersOf: (cardId, variant) => unique(chavesDe(cardId, variant).map((k) => data.sales[k].g)),
      // Itens na ordem do usuário (só os que ainda existem), de uma pasta ou de todas.
      list: (g) => data.order.filter((k) => data.sales[k] && (!g || data.sales[k].g === g)).map(doItem),
      // Ao adicionar, já pré-preenche o preço de venda com o valor de mercado
      // (TCGplayer) — fica `auto` até o usuário digitar. 0 se não houver cotação.
      add(cardId, variant, idx, initialPrice, initialCond, g) {
        const k = keyOf(cardId, variant, idx);
        if (data.sales[k]) return;
        const p = Number(initialPrice) || 0;
        data.sales[k] = { cardId, variant, idx, price: p > 0 ? Math.round(p * 100) / 100 : 0, cond: initialCond || "NM", auto: true, g };
        data.order.push(k);
        save();
      },
      // Editar o preço à mão = não é mais automático (auto: false). Preço 0 tira
      // da venda. `g` só vale quando o item nasce aqui (o campo do popup).
      setPrice(cardId, variant, idx, price, g) {
        const k = keyOf(cardId, variant, idx), p = Number(price) || 0, e = data.sales[k];
        if (p <= 0 && e) tira(k);
        else if (p > 0) {
          if (!e) { data.sales[k] = { cardId, variant, idx, price: Math.round(p * 100) / 100, cond: "NM", auto: false, g }; data.order.push(k); }
          else { e.price = Math.round(p * 100) / 100; e.auto = false; }
        }
        save();
      },
      setCond(cardId, variant, idx, cond) { const e = data.sales[keyOf(cardId, variant, idx)]; if (e) { e.cond = cond; save(); } },
      remove(cardId, variant, idx) { const k = keyOf(cardId, variant, idx); if (data.sales[k]) { tira(k); save(); } },
      // Tira da venda todas as cópias do card+variant DESTA pasta.
      removeFrom(cardId, variant, g) { const ks = chavesDe(cardId, variant, g); if (ks.length) { ks.forEach(tira); save(); } },
      // Traz pra esta pasta as cópias que estão em outras (preço e condição vão junto).
      moveTo(cardId, variant, g) {
        const ks = chavesDe(cardId, variant).filter((k) => data.sales[k].g !== g);
        if (!ks.length) return;
        ks.forEach((k) => { data.sales[k].g = g; });
        save();
      },
      // Markup da pasta (% sobre a REFERÊNCIA de mercado): -10 = vender a 10%
      // abaixo. Fica salvo pra aparecer no resumo e valer pras cartas que
      // entrarem depois nesta pasta.
      getMarkup: (g) => { const x = grupo(g); return x ? (Number(x.markup) || 0) : 0; },
      // Aplica o markup a TODAS as cartas da pasta: preço = referência(condição)
      // × (1 + pct/100). refFn(cardId, variant, cond) -> valor de mercado.
      // Mantém o item mesmo sem cotação (preço 0). Marca auto (derivado da
      // referência, não digitado à mão).
      applyMarkup(g, pct, refFn) {
        const x = grupo(g);
        if (!x) return;
        x.markup = Number(pct) || 0;
        const f = 1 + x.markup / 100;
        data.order.forEach((k) => {
          const e = data.sales[k];
          if (!e || e.g !== g) return;
          const ref = (refFn && refFn(e.cardId, e.variant, e.cond)) || 0;
          e.price = ref > 0 ? Math.round(ref * f * 100) / 100 : 0;
          e.auto = true;
        });
        save();
      }
    };
  }

  // Ícones (SVG inline, traço, currentColor — CSP 'self'). Os do cartão-herói
  // e do card em pilha são os MESMOS da Coleção e das Pastas.
  const svg = (inner, extra) => `<svg${extra || ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const IC = {
    plus: svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
    share: svg('<circle cx="18" cy="5.5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="18.5" r="2.6"/><path d="m8.4 10.8 7.2-4M8.4 13.2l7.2 4"/>', ' class="icon-btn-main"')
      + svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', ' class="icon-btn-ok"'),
    shareSm: svg('<circle cx="18" cy="5.5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="18.5" r="2.6"/><path d="m8.4 10.8 7.2-4M8.4 13.2l7.2 4"/>', ' width="15" height="15"'),
    chat: svg('<path d="M20 11.5a8 8 0 0 1-11.7 7.1L4 20l1.4-4.1A8 8 0 1 1 20 11.5z"/><path d="M8.5 10h7M8.5 13.5h4.5"/>'),
    image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'),
    dup: svg('<rect x="8" y="3" width="12" height="16" rx="2"/><path d="M4 7v12a2 2 0 0 0 2 2h9"/><path d="M14 8v6M11 11h6"/>'),
    trash: svg('<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12"/><path d="M10 11v6M14 11v6"/>'),
    trashSm: svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>', ' width="15" height="15"'),
    tag: svg('<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>'),
    swap: svg('<path d="M4 7h15l-4-4M20 17H5l4 4"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    x: svg('<path d="M6 6l12 12M18 6 6 18"/>', ' width="14" height="14"'),
    up: svg('<path d="M12 19V5M5 12l7-7 7 7"/>', ' width="15" height="15"'),
    down: svg('<path d="M12 5v14M5 12l7 7 7-7"/>', ' width="15" height="15"'),
    more: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    cards: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="3" width="12" height="16" rx="2"/><path d="M4 7v12a2 2 0 0 0 2 2h9"/></svg>',
    money: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.2v9.6M14.4 9.6c0-1-1.1-1.6-2.4-1.6s-2.4.6-2.4 1.6 1 1.5 2.4 1.9 2.5 1 2.5 2-1.1 1.7-2.5 1.7-2.5-.7-2.5-1.7"/></svg>'
  };

  const el = {
    title: document.getElementById("salesTitle"),
    back: document.getElementById("salesBack"),
    search: document.getElementById("searchInput"),
    soldSection: document.getElementById("soldSection"),
    soldList: document.getElementById("soldList"),
    soldSummary: document.getElementById("soldSummary")
  };

  const preview = shared.createCardPreview({
    getCard: (cardId) => cardsById.get(cardId),
    store: owned,
    prices,
    wishlist,
    // Campo "Vender por R$" no preview: mexe na 1ª cópia (idx 0). A gestão de
    // várias cópias com condições diferentes é no picker + na grade da pasta.
    // Item que NASCE por aqui entra na pasta aberta (ou na 1ª, na galeria).
    sale: {
      priceOf: (cardId, variant) => sales.priceOf(cardId, variant, 0),
      onChange: (cardId, variant, price) => { sales.setPrice(cardId, variant, 0, price, pastaDeDestino()); mudou(); }
    }
  });

  function pastaDeDestino() {
    if (openId && sales.group(openId)) return openId;
    const primeira = sales.groups()[0];
    return (primeira || sales.createGroup(nomePadrao())).id;
  }

  // Referência de mercado de um item (por condição) — base do markup em lote.
  function refValue(cardId, variant, cond) {
    const card = cardsById.get(cardId);
    return card ? (shared.cardValue(card, variant, prices, cond).value || 0) : 0;
  }
  const priceOf = (card, variant) => shared.cardValue(card, variant, prices, shared.DEFAULT_CONDITION).value || 0;
  const money = (v) => shared.formatMoney(shared.getCurrency(), v);
  const currencySymbol = shared.currencySymbol;
  // Condições de cada cópia que você tem desse card+variant (ex.: [NM, D, D]),
  // pra pré-preencher a condição da venda. Completa com NM se faltar.
  function copyConds(cardId, variant) {
    const total = owned.variantTotal(cardId, variant);
    const conds = [];
    owned.conditionBreakdown(cardId, variant).forEach(({ condition, quantity }) => { for (let i = 0; i < quantity; i++) conds.push(condition); });
    while (conds.length < total) conds.push("NM");
    return conds.slice(0, total);
  }
  // Texto do markup: "−10% da referência" / "+5% da referência".
  function markupLabel(pct) {
    if (!pct) return t("sales.batch.atMarket");
    return t("sales.batch.badge", { pct: (pct > 0 ? "+" : "−") + Math.abs(pct) });
  }
  const slugDe = (id) => shared.saleFolderSlugs(sales.groups()).get(id);
  const hrefDe = (id) => `sales?id=${encodeURIComponent(id)}`;

  // Ordenação da grade da pasta (mesmas opções da Coleção). Persistida.
  const SALES_SORTS = ["value-desc", "value-asc", "num-asc", "num-desc", "rarity-desc", "rarity-asc", "release", "added-desc", "added-asc"];
  const lerPref = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  let salesSort = SALES_SORTS.includes(lerPref("tcg-sales-sort")) ? lerPref("tcg-sales-sort") : "added-asc";

  // Ordena itens [{it, card}]. "Valor" = preço de VENDA; "Adição" = ordem em que
  // entraram na lista de vendas (a ordem do store).
  function sortSaleItems(arr) {
    const rankOf = new Map(sales.list().map((x, i) => [x.key, i]));
    const rank = (x) => { const r = rankOf.get(x.it.key); return r == null ? Infinity : r; };
    const a = arr.slice();
    if (salesSort === "num-asc") a.sort((x, y) => shared.compareCardNumbers(x.card.number, y.card.number));
    else if (salesSort === "num-desc") a.sort((x, y) => shared.compareCardNumbers(y.card.number, x.card.number));
    else if (salesSort === "release") a.sort((x, y) => String(y.card.setReleaseDate || "").localeCompare(String(x.card.setReleaseDate || "")));
    else if (salesSort === "rarity-desc") a.sort((x, y) => shared.rarityRank(y.card.rarity) - shared.rarityRank(x.card.rarity) || shared.compareCardNumbers(x.card.number, y.card.number));
    else if (salesSort === "rarity-asc") a.sort((x, y) => shared.rarityRank(x.card.rarity) - shared.rarityRank(y.card.rarity) || shared.compareCardNumbers(x.card.number, y.card.number));
    else if (salesSort === "value-desc") a.sort((x, y) => y.it.price - x.it.price);
    else if (salesSort === "value-asc") a.sort((x, y) => { const px = x.it.price, py = y.it.price; if (!px && !py) return 0; if (!px) return 1; if (!py) return -1; return px - py; });
    else if (salesSort === "added-desc") a.sort((x, y) => rank(y) - rank(x));
    else a.sort((x, y) => rank(x) - rank(y)); // added-asc (padrão)
    return a;
  }

  // Itens à venda já resolvidos pra carta — de uma pasta, ou de todas (g vazio).
  function resolvidos(g) {
    return sales.list(g).map((it) => ({ it, card: cardsById.get(it.cardId) })).filter((x) => x.card);
  }
  const itensDaPasta = (g) => sortSaleItems(resolvidos(g));

  // Busca do topo: na galeria acha a PASTA (pelo nome ou por uma carta dentro)
  // e peneira o histórico; na pasta aberta, peneira as cartas dela. O share, o
  // texto e a imagem seguem a pasta COMPLETA (a busca é só visual).
  const termo = () => ((el.search && el.search.value) || "").trim();
  const matchesSearch = (card) => { const q = termo(); return !q || shared.matchesCardQuery(card, q); };
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  // ===========================================================================
  // Navegação: galeria <-> pasta sem recarregar (o catálogo já está na
  // memória). A URL é o estado: ?id= abre a pasta, e o voltar do navegador
  // funciona.
  // ===========================================================================
  function lerUrl() {
    const id = new URLSearchParams(location.search).get("id");
    return id && sales.group(id) ? id : null;
  }
  function vaiPara(id) {
    openId = id && sales.group(id) ? id : null;
    const url = openId ? hrefDe(openId) : "sales";
    try { history.pushState({ vnd: openId }, "", url); } catch (e) { /* ignora */ }
    if (el.search) el.search.value = "";
    renderView();
    window.scrollTo(0, 0);
  }
  window.addEventListener("popstate", () => {
    openId = lerUrl();
    if (el.search) el.search.value = "";
    renderView();
  });

  // Depois de QUALQUER mudança no store: repinta o que depende dela e agenda a
  // republicação do perfil público (debounced no shared), pra o link da pasta
  // mostrar o que está na tela.
  function mudou() {
    if (!pronto) return;
    if (openId && sales.group(openId)) { pintaGrade(); pintaNumeros(); }
    else renderView();
    shared.publishProfile(cards, owned, prices);
  }

  function renderView() {
    if (!pronto) return;
    if (openId && !sales.group(openId)) openId = null; // apagada (outra aba, sync)
    shared.applyGameAccent("all"); // página de todos os jogos: accent neutro
    renderHead();
    if (openId) renderFolder(); else renderGallery();
    renderSold();
  }

  // Faixa do título: na galeria, "Vendas e Trocas" + "← Hub"; na pasta, o NOME
  // da pasta como título editável + "← Vendas e Trocas". O data-i18n sai
  // enquanto a pasta está aberta — senão uma retradução escreveria o título
  // da página por cima do nome.
  function renderHead() {
    const pasta = openId && sales.group(openId);
    if (pasta) {
      el.title.removeAttribute("data-i18n");
      let input = el.title.querySelector("input");
      if (!input) {
        el.title.innerHTML = `<input type="text" class="lst-title vnd-title" id="salesFolderName" maxlength="40" aria-label="${escA(t("sales.folders.rename"))}">`;
        input = el.title.querySelector("input");
      }
      if (document.activeElement !== input) input.value = pasta.name;
      el.back.removeAttribute("data-i18n");
      el.back.href = "sales";
      el.back.textContent = t("sales.folders.back");
      if (el.search) el.search.placeholder = t("sales.folders.searchFolder");
      document.title = `${pasta.name} · ${t("title.sales")}`;
    } else {
      el.title.setAttribute("data-i18n", "nav.sales");
      el.title.textContent = t("nav.sales");
      el.back.setAttribute("data-i18n", "nav.backDashboard");
      el.back.href = "dashboard";
      el.back.textContent = t("nav.backDashboard");
      if (el.search) el.search.placeholder = t("sales.folders.searchGallery");
      document.title = t("title.sales");
    }
  }

  const linha = (dt, dd, id) => `<div><dt>${esc(dt)}</dt><dd${id ? ` id="${id}"` : ""}>${esc(String(dd))}</dd></div>`;
  const moneyHtml = (valor, rotulo, extra) => `<div class="dash-stat-money"><span class="dash-stat-ic" aria-hidden="true">${IC.money}</span><span class="dash-stat-txt"><span class="dash-stat-val" data-vnd-value>${esc(valor > 0 ? money(valor) : "—")}</span><span class="dash-stat-label">${esc(rotulo)}</span>${extra || ""}</span></div>`;

  // O valor mora numa caixa de largura FIXA no herói (a mesma da Coleção): se
  // o número não cabe, encolhe a fonte até caber em vez de empurrar as ações.
  // Cópia enxuta do ajustaValorHero das Pastas.
  function ajustaValorHero() {
    const v = view.querySelector(".dash-stat-money .dash-stat-val");
    if (!v) return;
    v.style.fontSize = "";
    let size = parseFloat(getComputedStyle(v).fontSize) || 22;
    let guard = 12;
    while (v.scrollWidth > v.clientWidth && size > 11 && guard--) {
      size -= 1;
      v.style.fontSize = size + "px";
    }
  }
  window.addEventListener("resize", debounce(ajustaValorHero, 120));

  // ===========================================================================
  // Galeria das pastas
  // ===========================================================================
  // Chip do jogo sobre a capa: o jogo das cartas da pasta, ou "Misto" (a mesma
  // pastilha do Showcase da Coleção).
  function jogoTagHtml(itens) {
    const jogos = new Set(itens.map((x) => x.card.game).filter(Boolean));
    if (!jogos.size) return "";
    const um = jogos.size === 1 ? jogos.values().next().value : null;
    const cor = um ? (shared.GAME_COLOR[um] || shared.GAME_COLOR.pokemon) : "#5a6473";
    return `<span class="coll-pile-tag"><span class="folder-tag" style="--tag:${escA(cor)}">${esc(um ? gameLabelOf(um) : t("folders.tag.mixed"))}</span></span>`;
  }

  // Card de pasta em PILHA — o MESMO card do Showcase da Coleção: as 3 cartas
  // mais caras em leque na capa, jogo + contagem sobre ela, nome e valor
  // embaixo, Compartilhar + "⋯" (mover, copiar link, excluir) no rodapé.
  function folderCardHtml(g, itens) {
    const valor = itens.reduce((s, x) => s + (x.it.price || 0), 0);
    const fan = [], vistos = new Set();
    itens.slice().sort((a, b) => b.it.price - a.it.price).forEach((x) => {
      if (fan.length < 3 && !vistos.has(x.card.id)) { vistos.add(x.card.id); fan.push(x.card); }
    });
    const img = (c) => { const src = shared.cardImageSources(c); return shared.localizedImg(src.url, { alt: "", fallback: src.fallback, loading: "lazy", thumb: true }); };
    // Ordem no DOM = ordem de empilhamento: as de trás primeiro, a capa por último.
    const pile = fan.length
      ? `${fan[1] ? `<span class="coll-pile-card coll-pile-l">${img(fan[1])}</span>` : ""}${fan[2] ? `<span class="coll-pile-card coll-pile-r">${img(fan[2])}</span>` : ""}<span class="coll-pile-card coll-pile-front">${img(fan[0])}</span>`
      : `<span class="coll-card-empty">${esc(t("sales.folders.emptyFolder"))}</span>`;
    const item = (attr, icon, label, extra) => `<button type="button" class="folder-act${extra || ""}" ${attr} role="menuitem">${icon}<span>${esc(label)}</span></button>`;
    const href = escA(hrefDe(g.id));
    return `<section class="coll-card coll-card-pile vnd-folder" data-vnd-folder="${escA(g.id)}">
      <a class="coll-card-cover coll-pile" href="${href}" data-vnd-open="${escA(g.id)}" aria-label="${escA(t("sales.folders.open", { name: g.name }))}">
        ${pile}${jogoTagHtml(itens)}<span class="coll-pile-count">${IC.cards}${itens.length}</span>
      </a>
      <div class="coll-card-body">
        <div class="coll-card-title-row"><a class="coll-card-name vnd-folder-name" href="${href}" data-vnd-open="${escA(g.id)}" title="${escA(g.name)}">${esc(g.name)}</a></div>
        <div class="coll-card-foot">
          <span class="coll-card-meta">${esc(valor > 0 ? money(valor) : tn("sales.folders.count", itens.length))}</span>
          <span class="coll-card-acts">
            <button type="button" class="folder-act" data-vnd-share title="${escA(t("sales.folders.copyLink"))}" aria-label="${escA(t("sales.folders.copyLink"))}">${IC.shareSm}</button>
            <button type="button" class="folder-act" data-vnd-menu aria-haspopup="menu" aria-expanded="false" title="${escA(t("folders.more"))}" aria-label="${escA(t("folders.more"))}">${IC.more}</button>
          </span>
        </div>
        <div class="coll-card-menu" role="menu">
          ${item('data-vnd-move="-1"', IC.up, t("folders.moveUp"))}
          ${item('data-vnd-move="1"', IC.down, t("folders.moveDown"))}
          ${item("data-vnd-share", IC.shareSm, t("sales.folders.copyLink"))}
          <span class="coll-card-menu-sep" role="separator"></span>
          ${item("data-vnd-delete", IC.trashSm, t("sales.folders.delete"), " folder-act-danger")}
        </div>
      </div>
    </section>`;
  }

  function renderGallery() {
    const grupos = sales.groups();
    const todos = resolvidos();
    const porPasta = new Map(grupos.map((g) => [g.id, []]));
    todos.forEach((x) => { const arr = porPasta.get(x.it.g); if (arr) arr.push(x); });
    const total = todos.reduce((s, x) => s + (x.it.price || 0), 0);
    // LÍQUIDO (já sem taxa/frete): é o que de fato entrou. O bruto continua
    // visível no histórico, linha a linha.
    const vendido = sold.list().reduce((s, it) => s + shared.soldValues(it).net, 0);
    const q = termo(), nq = norm(q);
    const visiveis = grupos.filter((g) => !q || norm(g.name).includes(nq) || porPasta.get(g.id).some((x) => shared.matchesCardQuery(x.card, q)));
    // "Mais valiosas à venda": as 3 de maior preço, cada linha levando à pasta
    // dela — o mesmo cartão "Mais valiosas" do resumo da Coleção.
    const top = todos.filter((x) => x.it.price > 0).sort((a, b) => b.it.price - a.it.price).slice(0, 3).map(({ it, card }) => {
      const src = shared.cardImageSources(card);
      const thumb = shared.localizedImg(src.url, { alt: "", fallback: src.fallback, loading: "lazy", thumb: true });
      const pasta = sales.group(it.g);
      return `<li><a href="${escA(hrefDe(it.g))}" data-vnd-open="${escA(it.g)}"><span class="dash-top-thumb">${thumb}</span>
          <span class="dash-top-info"><strong>${esc(card.name)}</strong><span class="dash-top-set">${esc(pasta ? pasta.name : card.set)}</span></span>
          <span class="dash-top-val">${esc(money(it.price))}</span></a></li>`;
    }).join("");
    const vazio = !grupos.length
      ? `<p class="empty-state vnd-empty">${esc(t("sales.folders.empty"))}<br><span class="empty-hint">${esc(t("sales.folders.emptyHint"))}</span></p>`
      : (q && !visiveis.length ? `<p class="empty-state vnd-empty">${esc(t("collection.noResults"))}</p>` : "");
    // "Nova pasta" como o último card da fileira: a ação mora onde a pasta
    // nova vai aparecer. Some durante a busca (não é resultado).
    const novo = q ? "" : `<button type="button" class="coll-card coll-card-pile vnd-new-card" data-vnd-new>
        <span class="vnd-new-ic" aria-hidden="true">${IC.plus}</span>
        <strong>${esc(t("sales.folders.new"))}</strong>
        <span>${esc(t("sales.folders.newHint"))}</span>
      </button>`;
    view.innerHTML = `
      <section class="collection-dashboard collection-dashboard-hero set-insights vnd-insights" aria-label="${escA(t("aria.sumSales"))}">
        <div class="set-insights-rail">
          <article class="insight-card insight-hero coll-hero vnd-hero">
            <div class="dash-profile" data-vnd-profile hidden></div>
            ${moneyHtml(total, t("sales.dash.valueAll"))}
            <div class="collection-toolbar-actions vnd-actions" role="group" aria-label="${escA(t("nav.sales"))}">
              <button type="button" class="secondary vnd-act vnd-act-wide vnd-act-main" data-vnd-new>${IC.plus}<span>${esc(t("sales.folders.new"))}</span></button>
              <a class="secondary vnd-act vnd-act-wide" href="troca">${IC.swap}<span>${esc(t("trade.open"))}</span></a>
            </div>
          </article>
          <article class="insight-card insight-summary coll-overview">
            <h3>${esc(t("insights.overview"))}</h3>
            <dl>
              ${linha(t("sales.dash.count"), todos.length)}
              ${linha(t("sales.folders.stat.folders"), grupos.length)}
              ${linha(t("sales.dash.sold"), vendido > 0 ? money(vendido) : "—")}
            </dl>
          </article>
          <article class="insight-card vnd-top">
            <h3>${esc(t("sales.folders.top"))}</h3>
            <ol class="dash-top-list">${top || `<li class="dash-empty">—</li>`}</ol>
          </article>
        </div>
      </section>
      <section class="results-header vnd-gallery-head"><h2>${esc(t("sales.folders.heading"))}</h2></section>
      ${vazio}
      <div class="coll-vitrine vnd-folders">${visiveis.map((g) => folderCardHtml(g, porPasta.get(g.id))).join("")}${novo}</div>`;
    shared.renderDashProfile(view.querySelector("[data-vnd-profile]"));
    ajustaValorHero();
  }

  function fechaMenus() {
    view.querySelectorAll(".coll-card.is-menu-open").forEach((c) => {
      c.classList.remove("is-menu-open");
      const b = c.querySelector("[data-vnd-menu]");
      if (b) b.setAttribute("aria-expanded", "false");
    });
  }

  async function novaPasta() {
    const nome = await shared.caixaDeTexto({
      titulo: t("sales.folders.newTitle"),
      placeholder: t("sales.folders.namePlaceholder"),
      ok: t("sales.folders.create")
    });
    if (nome == null) return;
    const g = sales.createGroup(nome);
    vaiPara(g.id);
    shared.publishProfile(cards, owned, prices);
    // Pasta nova e vazia: o próximo passo é sempre pôr cartas nela.
    openSalesPicker(g.id);
  }

  // Apagar a pasta tira as cartas dela da VENDA (a coleção não muda). Sem
  // confirm() bloqueante: apaga na hora e o toast dá 6s pra desfazer (o padrão
  // de ação destrutiva do site).
  function apagaPasta(id) {
    const g = sales.group(id);
    if (!g) return;
    const restaura = shared.snapshotKeys(["tcg-collector-collection-sales-v1"]);
    const n = sales.list(id).length;
    sales.deleteGroup(id);
    if (openId === id) vaiPara(null); else renderView();
    shared.publishProfile(cards, owned, prices);
    shared.toastUndo(tn("sales.folders.deleted", n), restaura);
  }

  // ===========================================================================
  // Pasta aberta
  // ===========================================================================
  const BATCH = [-15, -10, -5, 0, 5, 10];
  function renderFolder() {
    const g = sales.group(openId);
    const mk = sales.getMarkup(g.id);
    const sortOpts = [["value-desc", "sort.valueDesc"], ["value-asc", "sort.valueAsc"], ["num-asc", "sort.numAsc"], ["num-desc", "sort.numDesc"], ["rarity-desc", "sort.rarityDesc"], ["rarity-asc", "sort.rarityAsc"], ["release", "sort.releaseDate"], ["added-desc", "sort.addedDesc"], ["added-asc", "sort.addedAsc"]]
      .map(([v, k]) => `<option value="${v}"${v === salesSort ? " selected" : ""}>${esc(t(k))}</option>`).join("");
    const chip = (p) => `<button type="button" class="vnd-batch-chip" data-batch-pct="${p}" aria-pressed="${mk === p}">${p === 0 ? esc(t("sales.batch.market")) : (p > 0 ? "+" : "−") + Math.abs(p) + "%"}</button>`;
    // Ações: as duas com rótulo largo em cima (Adicionar / Compartilhar — as
    // mais usadas), e as quatro do dia a dia embaixo, em colunas iguais. Grade
    // de 4 colunas: tudo alinha na mesma régua, em qualquer largura do cartão.
    const act = (attr, icon, label, extra) => `<button type="button" class="secondary vnd-act${extra || ""}" ${attr} title="${escA(label.title || label)}">${icon}<span>${esc(label.text || label)}</span></button>`;
    view.innerHTML = `
      <section class="collection-dashboard collection-dashboard-hero set-insights vnd-insights" aria-label="${escA(t("sales.folders.summary"))}">
        <div class="set-insights-rail">
          <article class="insight-card insight-hero coll-hero vnd-hero">
            <div class="dash-profile pasta-identity">
              <div class="dash-profile-who">
                <span class="dash-avatar pasta-avatar" aria-hidden="true"><span class="dash-avatar-in">${IC.tag}</span></span>
                <div class="dash-profile-id vnd-identity" data-vnd-link></div>
              </div>
            </div>
            ${moneyHtml(0, t("sales.folders.value"), `<span class="vnd-markup" data-vnd-markup hidden></span>`)}
            <div class="collection-toolbar-actions vnd-actions" role="group" aria-label="${escA(g.name)}">
              <button type="button" class="secondary vnd-act vnd-act-wide vnd-act-main" data-vnd-add>${IC.plus}<span>${esc(t("sales.add"))}</span></button>
              <button type="button" class="secondary vnd-act vnd-act-wide" data-vnd-share data-vnd-priced title="${escA(t("sales.folders.shareTitle"))}">${IC.share}<span aria-live="polite">${esc(t("sales.folders.share"))}</span></button>
              ${act("data-vnd-text data-vnd-priced", IC.chat, { text: t("sales.folders.whatsShort"), title: t("sales.text") })}
              ${act("data-vnd-image data-vnd-priced", IC.image, { text: t("sales.folders.imageShort"), title: t("sales.export") })}
              ${act("data-vnd-dup", IC.dup, { text: t("sales.folders.dupShort"), title: t("sales.dup.hint") })}
              ${act("data-vnd-delete", IC.trash, { text: t("sales.folders.deleteShort"), title: t("sales.folders.delete") }, " vnd-act-danger")}
            </div>
          </article>
          <article class="insight-card insight-summary coll-overview">
            <h3>${esc(t("insights.overview"))}</h3>
            <dl>
              ${linha(t("sales.folders.stat.cards"), 0, "vndCount")}
              ${linha(t("sales.folders.stat.unpriced"), 0, "vndUnpriced")}
              ${linha(t("sales.folders.stat.market"), "—", "vndMarket")}
            </dl>
          </article>
          <article class="insight-card vnd-batch">
            <h3>${esc(t("sales.batch.title"))}</h3>
            <div class="vnd-batch-chips" role="group" aria-label="${escA(t("sales.batch.title"))}">${BATCH.map(chip).join("")}</div>
            <div class="vnd-batch-custom">
              <input type="number" id="salesBatchPct" step="1" inputmode="numeric" placeholder="0" value="${mk && !BATCH.includes(mk) ? mk : ""}" aria-label="${escA(t("aria.percent"))}">
              <span class="vnd-batch-pct" aria-hidden="true">%</span>
              <button type="button" id="salesBatchApply" class="primary">${esc(t("sales.batch.apply"))}</button>
            </div>
            <p class="vnd-batch-hint">${esc(t("sales.batch.hint"))}</p>
          </article>
        </div>
      </section>
      <section class="results-header vnd-results">
        <p class="vnd-hint">${esc(t("sales.hint"))}</p>
        <div class="results-actions">
          <div class="sort-select vnd-sort">
            <label for="salesSortSelect">${esc(t("sort.label"))}</label>
            <select id="salesSortSelect">${sortOpts}</select>
          </div>
        </div>
      </section>
      <section id="salesGrid" class="card-grid"></section>
      <p id="salesEmpty" class="empty-state" hidden></p>`;
    pintaGrade();
    pintaNumeros();
  }

  // Grade da pasta (respeita a busca e a ordenação).
  function pintaGrade() {
    const grid = view.querySelector("#salesGrid");
    const vazio = view.querySelector("#salesEmpty");
    if (!grid || !openId) return;
    const todos = itensDaPasta(openId);
    const itens = todos.filter(({ card }) => matchesSearch(card));
    const sym = currencySymbol();
    grid.innerHTML = itens.map(({ it, card }) => saleTileHtml(card, it, sym)).join("");
    if (vazio) {
      vazio.hidden = itens.length > 0;
      if (!todos.length) vazio.innerHTML = t("sales.empty");
      else vazio.textContent = t("collection.noResults");
    }
  }

  // Números do herói e da "Visão geral", o link público e o estado dos botões
  // que precisam de carta com preço — tudo NO LUGAR, sem redesenhar o trilho
  // (no celular ele rola na horizontal, e redesenhar zerava a rolagem).
  function pintaNumeros() {
    const g = openId && sales.group(openId);
    if (!g) return;
    const itens = resolvidos(g.id);
    const total = itens.reduce((s, x) => s + (x.it.price || 0), 0);
    const ref = itens.reduce((s, x) => s + refValue(x.it.cardId, x.it.variant, x.it.cond), 0);
    const semPreco = itens.filter((x) => !(x.it.price > 0)).length;
    const put = (sel, v) => { const n = view.querySelector(sel); if (n) n.textContent = v; };
    put("[data-vnd-value]", total > 0 ? money(total) : "—");
    put("#vndCount", itens.length);
    put("#vndUnpriced", semPreco);
    put("#vndMarket", ref > 0 ? money(ref) : "—");
    // Badge do markup: evidencia que a pasta está, ex., 10% abaixo da referência.
    const mk = sales.getMarkup(g.id);
    const badge = view.querySelector("[data-vnd-markup]");
    if (badge) {
      badge.textContent = markupLabel(mk);
      badge.hidden = !mk;
      badge.classList.toggle("is-down", mk < 0);
      badge.classList.toggle("is-up", mk > 0);
    }
    view.querySelectorAll("[data-batch-pct]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.batchPct) === mk)));
    const temPreco = itens.some((x) => x.it.price > 0);
    view.querySelectorAll("[data-vnd-priced]").forEach((b) => { b.disabled = !temPreco; });
    // Link público da pasta: o endereço que o "Compartilhar" copia. Sem perfil
    // público, o convite pra ligar (o share cai no link de snapshot).
    const box = view.querySelector("[data-vnd-link]");
    if (box) {
      const link = shared.publicProfileUrl("sales", slugDe(g.id));
      box.innerHTML = `<span class="vnd-link-label">${IC.link}${esc(t("sales.folders.linkLabel"))}</span>`
        + (link
          // <wbr> depois de cada "/": no celular o link quebra entre as partes
          // do caminho, não no meio de "vendas".
          ? `<a class="vnd-link" href="${escA(link)}" target="_blank" rel="noopener">${esc(link.replace(/^https?:\/\//, "")).replace(/\//g, "/<wbr>")}</a>`
          : `<a class="vnd-link is-off" href="settings">${esc(t("sales.folders.linkOff"))}</a>`);
    }
    ajustaValorHero();
  }

  // Tile de venda: imagem (→ preview) + campo de preço editável + condição +
  // remover. idx = índice da cópia (várias cópias da mesma carta podem estar à venda).
  function saleTileHtml(card, it, sym) {
    const src = shared.cardImageSources(card);
    const img = shared.localizedImg(src.url, { alt: card.name, fallback: src.fallback, loading: "lazy", thumb: true, sizes: shared.SIZES_CARD_TILE });
    const price = it.price;
    const priceStr = price > 0 ? String(price).replace(".", ",") : "";
    const current = it.cond || "NM";
    const condOpts = shared.CARD_CONDITIONS.map((c) => `<option value="${c}"${c === current ? " selected" : ""}>${c}</option>`).join("");
    // Preço automático (TCGplayer, não editado) = laranja; revisado à mão = preto.
    const autoCls = it.auto && price > 0 ? " is-auto" : "";
    return `<article class="card-tile sale-tile" data-sale-card="${escA(card.id)}" data-sale-variant="${escA(it.variant)}" data-sale-idx="${it.idx}">
      <div class="card-image">
        <button type="button" class="image-open" data-preview-card-id="${escA(card.id)}" data-preview-variant="${escA(it.variant)}" aria-label="${escA(t("card.zoom", { name: card.name }))}">${img}</button>
        <button type="button" class="sale-remove" data-sale-remove title="${escA(t("sales.remove"))}" aria-label="${escA(t("sales.remove"))}">${IC.x}</button>
      </div>
      <div class="tile-info">
        <h3>${esc(card.name)}</h3>
        <p class="tile-variant">${shared.cardFlag(card.language)}<span>${esc(it.variant)}</span></p>
        <div class="sale-fields">
          <label class="sale-price-field${autoCls}"><span class="sale-cur">${esc(sym)}</span><input type="text" inputmode="decimal" class="sale-price${autoCls}" data-sale-price value="${escA(priceStr)}" placeholder="0,00" aria-label="${escA(t("sales.sell"))}"></label>
          <select class="sale-cond" data-sale-cond aria-label="${escA(t("sales.condition"))}" title="${escA(t("sales.condition"))}">${condOpts}</select>
        </div>
        <button type="button" class="sale-sold-btn" data-sale-sold title="${escA(t("sales.sold.hint"))}">${esc(t("sales.sold.btn"))}</button>
      </div>
    </article>`;
  }

  // Aplica o markup da pasta e repinta (sincroniza o campo custom).
  function applyMarkup(pct) {
    if (!openId) return;
    const p = Math.max(-95, Math.min(500, Math.round(Number(pct) || 0)));
    sales.applyMarkup(openId, p, refValue);
    const input = view.querySelector("#salesBatchPct");
    if (input) input.value = p && !BATCH.includes(p) ? String(p) : "";
    mudou();
  }

  // Duplicatas → venda em 1 clique: todo card×variante com mais de 1 cópia
  // entra NESTA pasta com as cópias EXCEDENTES (mantém 1 na coleção — a cópia
  // 0, a primeira da condição), cada uma com a sua condição real e o preço de
  // mercado já com o markup da pasta. Não duplica o que já está à venda em
  // pasta nenhuma.
  function addDuplicatesToSale() {
    if (!openId) return;
    const f = 1 + sales.getMarkup(openId) / 100;
    let added = 0;
    cards.filter((c) => owned.has(c.id)).forEach((card) => {
      (card.variants && card.variants.length ? card.variants : [shared.defaultVariant(card)]).forEach((variant) => {
        const total = owned.variantTotal(card.id, variant);
        if (total <= 1) return;
        const conds = copyConds(card.id, variant);
        let falta = (total - 1) - sales.countOf(card.id, variant);
        for (let i = 1; i < total && falta > 0; i++) {
          if (sales.has(card.id, variant, i)) continue;
          sales.add(card.id, variant, i, priceOf(card, variant) * f, conds[i] || "NM", openId);
          added++; falta--;
        }
      });
    });
    if (!added) { alert(t("sales.dup.none")); return; }
    mudou();
    alert(t("sales.dup.done", { n: added }));
  }

  // --- VENDA (venda realizada) ---------------------------------------------
  // Confirma o valor num popup; ao confirmar: registra no histórico (sold),
  // tira da lista de vendas e REMOVE a cópia da coleção (vendeu = não tem mais).
  function openSoldConfirm(cardId, variant, idx) {
    const card = cardsById.get(cardId);
    if (!card) return;
    let modal = document.getElementById("soldConfirmModal");
    if (!modal) { modal = document.createElement("div"); modal.id = "soldConfirmModal"; modal.className = "sales-picker-modal"; document.body.appendChild(modal); }
    const sym = currencySymbol();
    const price = sales.priceOf(cardId, variant, idx);
    const cond = sales.condOf(cardId, variant, idx);
    const cost = costs.get(cardId, variant);
    const paidNow = cost ? shared.moneyToCurrent(cost.v, cost.cur) : 0;
    const feePct = shared.getSaleFeePct();
    const feeInicial = feePct > 0 ? Math.round(price * (feePct / 100) * 100) / 100 : 0;
    const src = shared.cardImageSources(card);
    const img = shared.localizedImg(src.url, { alt: card.name, fallback: src.fallback, thumb: true });
    modal.innerHTML = `<div class="sales-picker-backdrop" data-sold-close></div>
      <section class="sales-picker-panel sold-confirm-panel" role="dialog" aria-modal="true" aria-label="${escA(t("sales.sold.title"))}">
        <header class="sales-picker-head"><strong>${esc(t("sales.sold.title"))}</strong>
          <button type="button" class="preview-close" data-sold-close aria-label="${escA(t("modal.close"))}">×</button></header>
        <div class="sold-confirm-body">
          <div class="sold-confirm-card">
            <span class="sold-confirm-thumb">${img}</span>
            <span class="sold-confirm-info"><strong>${esc(card.name)}</strong>
              <span>${esc(card.set)} · ${esc(card.number)} · ${esc(variant)} · ${esc(cond)}</span></span>
          </div>
          <label class="sold-confirm-field"><span>${esc(t("sales.sold.price"))}</span>
            <span class="sale-price-field"><span class="sale-cur">${esc(sym)}</span>
            <input type="text" inputmode="decimal" class="sale-price" id="soldPriceInput" value="${escA(price > 0 ? price.toFixed(2).replace(".", ",") : "")}" placeholder="0,00"></span></label>
          <label class="sold-confirm-field"><span>${esc(t("sales.sold.date"))}</span>
            <input type="date" id="soldDateInput" value="${new Date().toISOString().slice(0, 10)}"></label>
          <!-- Taxa/frete: a comissão do marketplace (a Liga fica com ~10%) e o
               envio saem do SEU bolso, então sem eles o "resultado" é bruto e
               otimista. O % é lembrado (shared.getSaleFeePct) e recalcula o
               valor sozinho; quem preferir digita direto em dinheiro. -->
          <label class="sold-confirm-field"><span>${esc(t("sales.sold.fee"))}</span>
            <span class="sold-fee-fields">
              <span class="sale-price-field sold-fee-pct"><input type="text" inputmode="decimal" class="sale-price" id="soldFeePctInput" value="${escA(feePct > 0 ? String(feePct).replace(".", ",") : "")}" placeholder="0"><span class="sale-cur">%</span></span>
              <span class="sale-price-field"><span class="sale-cur">${esc(sym)}</span>
              <input type="text" inputmode="decimal" class="sale-price" id="soldFeeInput" value="${escA(feeInicial > 0 ? feeInicial.toFixed(2).replace(".", ",") : "")}" placeholder="0,00"></span>
            </span></label>
          <!-- Custo EDITÁVEL na hora da venda. Antes era só um texto informativo:
               quem não tinha preenchido o custo na Coleção vendia com paid=0 e a
               venda sumia do lucro do Portfólio sem avisar. Vem pré-preenchido
               com o custo da carta, quando existe. -->
          <label class="sold-confirm-field"><span>${esc(t("sales.sold.paid"))}</span>
            <span class="sale-price-field"><span class="sale-cur">${esc(sym)}</span>
            <input type="text" inputmode="decimal" class="sale-price" id="soldPaidInput" value="${escA(paidNow > 0 ? paidNow.toFixed(2).replace(".", ",") : "")}" placeholder="0,00"></span></label>
          <p class="sold-confirm-hint">${esc(t("sales.sold.paidHint"))}</p>
          <p class="sold-confirm-note">${esc(t("sales.sold.removeNote"))}</p>
        </div>
        <footer class="sales-picker-foot">
          <button type="button" class="secondary" data-sold-close>${esc(t("modal.close"))}</button>
          <button type="button" class="primary" data-sold-confirm>${esc(t("sales.sold.confirm"))}</button>
        </footer>
      </section>`;
    document.body.classList.add("preview-open");
    const close = () => { modal.remove(); document.body.classList.remove("preview-open"); };
    // Os dois campos de taxa são a MESMA taxa em unidades diferentes: mexer no %
    // recalcula o dinheiro; mexer no dinheiro recalcula o %. Sem esse espelho,
    // um dos dois fica mentindo na tela até o usuário fechar o modal.
    const lerPreco = () => shared.parseMoney(String(modal.querySelector("#soldPriceInput").value).trim());
    modal.addEventListener("input", (event) => {
      const pctEl = modal.querySelector("#soldFeePctInput");
      const feeEl = modal.querySelector("#soldFeeInput");
      if (!pctEl || !feeEl) return;
      const preco = lerPreco();
      if (event.target === pctEl || event.target.id === "soldPriceInput") {
        const pct = shared.parseMoney(String(pctEl.value).trim());
        if (pct > 0 && preco > 0) feeEl.value = (preco * (pct / 100)).toFixed(2).replace(".", ",");
      } else if (event.target === feeEl) {
        const fee = shared.parseMoney(String(feeEl.value).trim());
        pctEl.value = preco > 0 && fee > 0 ? (Math.round((fee / preco) * 1000) / 10).toString().replace(".", ",") : "";
      }
    });
    modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-sold-close]")) { close(); return; }
      if (!event.target.closest("[data-sold-confirm]")) return;
      const text = String(modal.querySelector("#soldPriceInput").value).trim();
      const amount = shared.parseMoney(text);
      const date = modal.querySelector("#soldDateInput").value || new Date().toISOString().slice(0, 10);
      const paidAmount = shared.parseMoney(String(modal.querySelector("#soldPaidInput").value).trim());
      const feeAmount = shared.parseMoney(String(modal.querySelector("#soldFeeInput").value).trim());
      // Lembra o % pra próxima venda (é sempre o mesmo marketplace, na prática).
      const pctDigitado = shared.parseMoney(String(modal.querySelector("#soldFeePctInput").value).trim());
      if (pctDigitado > 0) shared.setSaleFeePct(pctDigitado);
      else if (feeAmount > 0 && amount > 0) shared.setSaleFeePct((feeAmount / amount) * 100);
      // Corrigiu/informou o custo aqui? Guarda na carta também: as cópias que
      // sobraram passam a ter o custo certo, e não se digita de novo na próxima.
      if (paidAmount > 0 && paidAmount !== paidNow) costs.set(cardId, variant, paidAmount, shared.getCurrency());
      // `game` da CARTA (não o da sessão): a venda é global e o Preço da
      // Comunidade agrega por jogo — vender uma carta de Magic numa sessão
      // Pokémon mandaria o ponto pro jogo errado.
      const cardGame = (cardsById.get(cardId) || {}).game;
      sold.add({ cardId, variant, cond, price: amount, paid: paidAmount, fee: feeAmount, cur: shared.getCurrency(), date, game: cardGame });
      sales.remove(cardId, variant, idx);
      removeCopyFromCollection(cardId, variant, cond);
      close();
      mudou();
    });
    setTimeout(() => { const i = modal.querySelector("#soldPriceInput"); if (i) { i.focus(); i.select(); } }, 0);
  }

  // Remove UMA cópia da coleção: primeiro a condição da venda; se ela não tiver
  // estoque (condição editada só na venda), cai na primeira condição com cópias.
  function removeCopyFromCollection(cardId, variant, cond) {
    if (owned.getQuantity(cardId, variant, cond) > 0) { owned.add(cardId, variant, cond, -1); return; }
    const bd = owned.conditionBreakdown(cardId, variant);
    if (bd.length) owned.add(cardId, variant, bd[0].condition, -1);
  }

  // Histórico de vendas realizadas (só na galeria — é de todas as pastas):
  // linhas com data, carta, pago, vendido e resultado (vendido − pago, quando
  // há custo). PRIVADO (não vai no share).
  function renderSold() {
    const section = el.soldSection, listEl = el.soldList, sumEl = el.soldSummary;
    if (!section || !listEl) return;
    const items = openId ? [] : sold.list()
      .map((it) => ({ it, card: cardsById.get(it.cardId) }))
      .filter((x) => x.card && matchesSearch(x.card));
    section.hidden = !items.length;
    if (!items.length) { listEl.innerHTML = ""; if (sumEl) sumEl.textContent = ""; return; }
    const cur = shared.getCurrency();
    const fmtDate = (s) => { const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : s; };
    let totalSold = 0, totalPnl = 0, pnlCount = 0, totalFee = 0;
    const rows = items.map(({ it, card }) => {
      // shared.soldValues: mesma fórmula do Portfólio, com o câmbio congelado na
      // data e a taxa descontada (líquido = preço − taxa; pnl = líquido − pago).
      const v = shared.soldValues(it);
      const price = v.price, paid = v.paid;
      totalSold += price; totalFee += v.fee;
      const hasPnl = v.hasCost;
      const pnl = v.pnl;
      if (hasPnl) { totalPnl += pnl; pnlCount++; }
      const src = shared.cardImageSources(card);
      const thumb = shared.localizedImg(src.url, { alt: "", fallback: src.fallback, loading: "lazy", thumb: true });
      const pnlHtml = hasPnl
        ? `<span class="sold-pnl ${pnl >= 0 ? "is-up" : "is-down"}">${pnl >= 0 ? "+" : "−"}${esc(shared.formatMoney(cur, Math.abs(pnl)))}</span>`
        : `<span class="sold-pnl is-na">—</span>`;
      return `<div class="sold-row" data-sid="${escA(it.sid)}">
        <span class="sold-date">${esc(fmtDate(it.date))}</span>
        <span class="sold-thumb">${thumb}</span>
        <span class="sold-info"><strong>${esc(card.name)}</strong><span>${esc(card.set)} · ${esc(it.variant)} · ${esc(it.cond)}</span></span>
        <span class="sold-paid">${it.paid > 0 ? esc(shared.formatMoney(cur, paid)) : "—"}</span>
        <span class="sold-price">${esc(shared.formatMoney(cur, price))}${v.fee > 0
          ? `<small class="sold-fee" title="${escA(t("sales.sold.feeHint", { v: shared.formatMoney(cur, v.fee) }))}">−${esc(shared.formatMoney(cur, v.fee))}</small>` : ""}</span>
        ${pnlHtml}
        <button type="button" class="sale-remove sold-del" data-sold-del title="${escA(t("sales.sold.delete"))}" aria-label="${escA(t("sales.sold.delete"))}">${IC.x}</button>
      </div>`;
    }).join("");
    listEl.innerHTML = `<div class="sold-row sold-row-head">
        <span class="sold-date">${esc(t("sales.sold.date"))}</span><span></span><span></span>
        <span class="sold-paid">${esc(t("cost.label"))}</span>
        <span class="sold-price">${esc(t("sales.sold.priceShort"))}</span>
        <span class="sold-pnl">${esc(t("sales.sold.result"))}</span><span></span>
      </div>` + rows;
    if (sumEl) {
      let s = `${items.length} · ${shared.formatMoney(cur, totalSold)}`;
      if (totalFee > 0) s += ` · ${t("sales.sold.feeShort")} −${shared.formatMoney(cur, totalFee)}`;
      if (pnlCount) s += ` · ${t("sales.sold.result")} ${totalPnl >= 0 ? "+" : "−"}${shared.formatMoney(cur, Math.abs(totalPnl))}`;
      sumEl.textContent = s;
    }
  }

  // ===========================================================================
  // Picker "Adicionar cartas" (da pasta aberta): jogo + busca + raridade +
  // ordenação sobre as cartas que você TEM. Um tile por carta+variante com a
  // quantidade (×N). Tocar:
  //   - tem cópia fora da venda  -> entram TODAS as que faltam, nesta pasta
  //   - todas já estão nesta     -> saem desta pasta (da venda)
  //   - todas estão em OUTRA     -> vêm pra esta (preço e condição vão junto)
  // É pelo último caso que se reorganiza: não existe "mover" separado.
  // Tudo persiste na hora (cada toque grava na store).
  // ===========================================================================
  function openSalesPicker(gid) {
    if (!gid || !sales.group(gid)) return;
    let modal = document.getElementById("salesPickerModal");
    if (!modal) { modal = document.createElement("div"); modal.id = "salesPickerModal"; modal.className = "sales-picker-modal"; document.body.appendChild(modal); }
    const ownedPool = cards.filter((c) => owned.has(c.id));
    // Jogo num menu (e não 13 chips): só os jogos em que você TEM carta.
    const jogos = shared.GAME_SLUGS.filter((g) => ownedPool.some((c) => c.game === g));
    let pickGame = "all";
    let pickRarity = "";          // filtro de raridade (vazio = todas)
    let pickSort = "value-desc";  // ordenação (mesma lógica da aba Cartas)
    const updateCount = () => { const n = modal.querySelector(".sales-picker-count"); if (n) n.textContent = t("sales.folders.pickerCount", { n: sales.list(gid).length }); };
    const sortPairs = (pairs) => {
      if (pickSort === "num-asc") return pairs.sort((a, b) => shared.compareCardNumbers(a.card.number, b.card.number));
      if (pickSort === "num-desc") return pairs.sort((a, b) => shared.compareCardNumbers(b.card.number, a.card.number));
      if (pickSort === "release") return pairs.sort((a, b) => String(b.card.setReleaseDate || "").localeCompare(String(a.card.setReleaseDate || "")));
      if (pickSort === "value-asc") return pairs.sort((a, b) => { const pa = priceOf(a.card, a.variant), pb = priceOf(b.card, b.variant); if (!pa && !pb) return 0; if (!pa) return 1; if (!pb) return -1; return pa - pb; });
      return pairs.sort((a, b) => priceOf(b.card, b.variant) - priceOf(a.card, a.variant)); // value-desc (padrão)
    };
    const pickHtml = (card, variant) => {
      const src = shared.cardImageSources(card);
      const img = shared.localizedImg(src.url, { alt: card.name, fallback: src.fallback, loading: "lazy", thumb: true });
      const total = copyConds(card.id, variant).length;
      const aqui = sales.countOf(card.id, variant, gid);
      const todas = sales.countOf(card.id, variant);
      const cls = aqui >= total ? " is-added" : (aqui > 0 ? " is-partial" : (todas >= total ? " vnd-elsewhere" : ""));
      const qty = total > 1 ? `<span class="sales-pick-qty">×${total}</span>` : "";
      const count = aqui > 0 ? `<span class="sales-pick-cond">${aqui}/${total}</span>` : "";
      // Cópias em OUTRA pasta: diz qual (ou quantas), pra o toque que "traz pra
      // cá" não ser surpresa.
      const outras = sales.foldersOf(card.id, variant).filter((g) => g !== gid);
      const onde = outras.length
        ? `<span class="vnd-pick-where">${esc(outras.length === 1 ? t("sales.folders.inFolder", { name: (sales.group(outras[0]) || {}).name || "" }) : t("sales.folders.inFolders", { n: outras.length }))}</span>`
        : "";
      return `<div class="sales-pick${cls}" role="button" tabindex="0" data-pick-card="${escA(card.id)}" data-pick-variant="${escA(variant)}">
        <span class="sales-pick-img">${img}<span class="sales-pick-check">✓</span>${qty}</span>
        <span class="sales-pick-name">${esc(card.name)}</span>
        <span class="sales-pick-var">${shared.cardFlag(card.language)}<span>${esc(variant)}</span>${count}</span>
        ${onde}
      </div>`;
    };
    const renderList = () => {
      const q = modal.querySelector(".sales-picker-search").value;
      const base = ownedPool.filter((c) => pickGame === "all" || c.game === pickGame);
      const pairs = sortPairs(shared.cardVariantPairs(base)
        .filter(({ card, variant }) => owned.variantTotal(card.id, variant) > 0)
        .filter(({ card }) => !pickRarity || card.rarity === pickRarity)
        .filter(({ card }) => !q.trim() || shared.matchesCardQuery(card, q)))
        .slice(0, 200);
      modal.querySelector(".sales-picker-results").innerHTML = pairs.map(({ card, variant }) => pickHtml(card, variant)).join("")
        || `<p class="empty-state">${esc(t("sales.pickerEmpty"))}</p>`;
    };
    const rarityOpts = `<option value="">${esc(t("filter.all.f"))}</option>`
      + unique(ownedPool.map((c) => c.rarity).filter(Boolean)).sort().map((r) => `<option value="${escA(r)}">${esc(r)}</option>`).join("");
    const sortOpts = [["value-desc", "sort.valueDesc"], ["value-asc", "sort.valueAsc"], ["num-asc", "sort.numAsc"], ["num-desc", "sort.numDesc"], ["release", "sort.releaseDate"]]
      .map(([v, k]) => `<option value="${v}"${v === pickSort ? " selected" : ""}>${esc(t(k))}</option>`).join("");
    const gameField = jogos.length > 1
      ? `<label class="sales-picker-field"><span>${esc(t("pfmi.game"))}</span>
          <select class="sales-picker-select" id="salesPickerGame"><option value="all">${esc(t("filter.gameAll"))}</option>${jogos.map((g) => `<option value="${g}">${esc(gameLabelOf(g))}</option>`).join("")}</select></label>`
      : "";
    const titulo = t("sales.folders.addTo", { name: (sales.group(gid) || {}).name || "" });
    modal.innerHTML = `<div class="sales-picker-backdrop" data-sales-picker-close></div>
      <section class="sales-picker-panel" role="dialog" aria-modal="true" aria-label="${escA(titulo)}">
        <header class="sales-picker-head"><strong>${esc(titulo)}</strong>
          <button type="button" class="preview-close" data-sales-picker-close aria-label="${escA(t("modal.close"))}">×</button></header>
        <div class="sales-picker-controls vnd-picker-controls">
          <input type="search" class="sales-picker-search" placeholder="${escA(t("search.placeholder.cards"))}" aria-label="${escA(t("search.placeholder.cards"))}">
          ${gameField}
          <label class="sales-picker-field"><span>${esc(t("toolbar.rarity"))}</span>
            <select class="sales-picker-select" id="salesPickerRarity">${rarityOpts}</select></label>
          <label class="sales-picker-field"><span>${esc(t("sort.label"))}</span>
            <select class="sales-picker-select" id="salesPickerSort">${sortOpts}</select></label>
        </div>
        <div class="sales-picker-results"></div>
        <footer class="sales-picker-foot">
          <span class="sales-picker-count"></span>
          <button type="button" class="primary" data-sales-picker-close>${esc(t("sales.pickerDone"))}</button>
        </footer>
      </section>`;
    document.body.classList.add("preview-open");
    renderList(); updateCount();
    const fecha = () => { modal.remove(); document.body.classList.remove("preview-open"); document.removeEventListener("keydown", noEsc); mudou(); };
    const noEsc = (ev) => { if (ev.key === "Escape") fecha(); };
    document.addEventListener("keydown", noEsc);
    modal.querySelector(".sales-picker-search").addEventListener("input", debounce(renderList, 200));
    modal.addEventListener("change", (event) => {
      const jogo = event.target.closest("#salesPickerGame");
      if (jogo) { pickGame = jogo.value; renderList(); return; }
      const rar = event.target.closest("#salesPickerRarity");
      if (rar) { pickRarity = rar.value; renderList(); return; }
      const srt = event.target.closest("#salesPickerSort");
      if (srt) { pickSort = srt.value; renderList(); }
    });
    const toca = (pick) => {
      const id = pick.dataset.pickCard, v = pick.dataset.pickVariant;
      const card = cardsById.get(id);
      if (!card) return;
      const conds = copyConds(id, v), total = conds.length;
      const livres = [];
      for (let i = 0; i < total; i++) if (!sales.has(id, v, i)) livres.push(i);
      if (livres.length) {
        // Cada cópia com a sua condição + preço de mercado JÁ com o markup da
        // pasta (pra ficar consistente com o resto dela).
        const mkt = priceOf(card, v) * (1 + sales.getMarkup(gid) / 100);
        livres.forEach((i) => sales.add(id, v, i, mkt, conds[i], gid));
      } else if (sales.countOf(id, v, gid)) {
        sales.removeFrom(id, v, gid);
      } else {
        const de = sales.foldersOf(id, v).map((g) => (sales.group(g) || {}).name).filter(Boolean);
        sales.moveTo(id, v, gid);
        if (de.length) shared.toastSimples(t("sales.folders.moved", { name: de.join(", ") }));
      }
      // Atualiza o tile no lugar (sem re-render, pra não perder a rolagem).
      pick.outerHTML = pickHtml(card, v);
      updateCount();
    };
    modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-sales-picker-close]")) { fecha(); return; }
      const pick = event.target.closest("[data-pick-card]");
      if (pick) toca(pick);
    });
    // Tile é role=button: Enter/Espaço também tocam.
    modal.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const pick = event.target.closest("[data-pick-card]");
      if (!pick) return;
      event.preventDefault();
      const id = pick.dataset.pickCard, v = pick.dataset.pickVariant;
      toca(pick);
      const novo = modal.querySelector(`[data-pick-card="${CSS.escape(id)}"][data-pick-variant="${CSS.escape(v)}"]`);
      if (novo) novo.focus();
    });
  }

  // ===========================================================================
  // Compartilhar / texto / imagem — sempre DA PASTA, na ordem do Ordenar.
  // ===========================================================================
  const comPreco = (g) => itensDaPasta(g).filter((x) => x.it.price > 0);

  // Snapshot (?s=) pra quem não tem perfil público: cada item leva o preço de
  // venda (sp), a condição (cond) e a moeda (cur). A view ?s= (somente
  // leitura) vive na collection.html, então o link aponta pra lá.
  function buildSaleShareData(g) {
    const cur = shared.getCurrency();
    const items = comPreco(g).map(({ it, card }) => {
      const src = shared.cardImageSources(card);
      return {
        id: card.id, n: card.name, s: card.set, num: card.number, lang: card.language,
        g: card.game, v: it.variant, q: 1, sp: it.price, cond: it.cond || "NM", cur, img: src.url, fb: src.fallback || ""
      };
    });
    return { items, scope: "sale", cur };
  }

  // Link da pasta. Com perfil público é o link VIVO e fixo
  // (/users/<h>/vendas/<slug>): antes de copiar, o perfil é publicado NA HORA
  // (sem o debounce), senão a pasta recém-criada abriria vazia. Sem perfil
  // público, cai no snapshot de antes. `btn` com <span> = feedback no próprio
  // botão (o ✓ no lugar do ícone); sem span, um toast.
  async function shareFolder(gid, btn) {
    const g = sales.group(gid);
    if (!g) return;
    if (!comPreco(gid).length) { alert(t("sales.shareEmpty")); return; }
    const span = btn && btn.querySelector("span");
    const original = span ? span.textContent : "";
    const setLabel = (txt) => { if (span) span.textContent = txt; };
    const avisa = (txt) => { if (span) { setLabel(txt); btn.classList.add("is-ok"); setTimeout(() => { setLabel(original); btn.classList.remove("is-ok"); }, 2500); } else shared.toastSimples(txt); };
    const copia = async (link, ok) => {
      try { await navigator.clipboard.writeText(link); avisa(ok); }
      catch (e) { setLabel(original); shared.caixaDeTexto({ titulo: t("collection.share.copyManual"), valor: link, leitura: true }); }
    };
    if (btn) btn.disabled = true;
    setLabel(t("collection.share.creating"));
    const live = shared.publicProfileUrl("sales", slugDe(gid));
    if (live) {
      try { await shared.publishProfile(cards, owned, prices, true); } catch (e) { /* o link segue valendo; a pasta chega na próxima publicação */ }
      if (btn) btn.disabled = false;
      await copia(live, t("sales.folders.copied"));
      return;
    }
    const res = await shared.createShare("collection", g.name, buildSaleShareData(gid));
    if (btn) btn.disabled = false;
    if (res && res.id) {
      await copia(`${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}collection?s=${res.id}`, t("collection.share.copied"));
    } else {
      setLabel(original);
      alert(res && res.error === "auth" ? t("collection.share.needLogin") : t("collection.share.error"));
    }
  }

  // ===========================================================================
  // Texto pro WhatsApp
  //
  // A imagem e o link ja existiam, e nenhum dos dois e o que se manda num grupo
  // de troca: la a lista vai em TEXTO, pra pessoa poder responder "quero a 3 e
  // a 7". Tudo local e instantaneo: nao cria share nem chama a rede. O link so
  // entra na mensagem quando o perfil publico JA existe — e agora e o da PASTA.
  // ===========================================================================
  function whatsTexto(gid) {
    const g = sales.group(gid);
    const cur = shared.getCurrency();
    const lista = comPreco(gid);
    if (!g || !lista.length) return "";
    const linhas = lista.map(({ it, card }) => {
      // Set e numero entre parenteses: e como a pessoa confere se e a carta
      // certa antes de perguntar o preco.
      const ref = [card.set, card.number].filter(Boolean).join(" ");
      const partes = [card.name];
      if (ref) partes.push(`(${ref})`);
      const detalhe = [shared.variantDisplayLabel(card, it.variant), it.cond || "NM"].filter(Boolean).join(" · ");
      return `• ${partes.join(" ")}${detalhe ? ` · ${detalhe}` : ""} — ${shared.formatMoney(cur, it.price)}`;
    });
    const total = lista.reduce((sum, x) => sum + x.it.price, 0);
    // Nome da pasta em negrito (o *…* do WhatsApp) em cima do cabeçalho.
    const partes = [`*${g.name}*`, t("sales.text.head"), "", linhas.join("\n"), "",
      t("sales.text.total", { n: lista.length, v: shared.formatMoney(cur, total) })];
    const link = shared.publicProfileUrl("sales", slugDe(gid));
    if (link) partes.push(link);
    return partes.join("\n");
  }

  function openWhatsComposer(gid) {
    const texto = whatsTexto(gid);
    if (!texto) { alert(t("sales.shareEmpty")); return; }
    const wrap = document.createElement("div");
    wrap.className = "list-modal";
    document.body.appendChild(wrap);
    document.body.classList.add("preview-open");
    // Ancora de verdade, e nao window.open: o link funciona igual no desktop
    // (web.whatsapp) e no celular (app), e nao depende de bloqueador nenhum.
    wrap.innerHTML = `
      <div class="list-modal-box" role="dialog" aria-modal="true" aria-label="${escA(t("sales.text.title"))}">
        <h2>${esc(t("sales.text.title"))}</h2>
        <p class="list-modal-hint">${esc(t("sales.text.hint"))}</p>
        <textarea class="lst-export" readonly rows="12">${esc(texto)}</textarea>
        <div class="list-modal-foot">
          <button type="button" class="cta" data-wa-copy>${esc(t("export.copy"))}</button>
          <a class="lst-mini" data-wa-open href="https://wa.me/?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener noreferrer">${esc(t("sales.text.whats"))}</a>
          <button type="button" class="lst-mini" data-wa-close>${esc(t("export.close"))}</button>
        </div>
      </div>`;

    const fechar = () => { wrap.remove(); document.body.classList.remove("preview-open"); document.removeEventListener("keydown", noEsc); };
    const noEsc = (ev) => { if (ev.key === "Escape") fechar(); };
    document.addEventListener("keydown", noEsc);
    wrap.addEventListener("click", (ev) => {
      if (ev.target === wrap || ev.target.closest("[data-wa-close]")) { fechar(); return; }
      if (ev.target.closest("[data-wa-copy]")) {
        const ta = wrap.querySelector(".lst-export");
        const ok = () => { const b = wrap.querySelector("[data-wa-copy]"); if (b) b.textContent = t("export.copied"); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(ta.value).then(ok, () => { ta.select(); document.execCommand("copy"); ok(); });
        } else { ta.select(); document.execCommand("copy"); ok(); }
      }
    });
  }

  // Gera a imagem (PNG) das cartas da pasta + preços, pra mandar nos grupos.
  // Canvas puro (CSP-safe, sem lib). O preço vai numa banda ABAIXO da carta
  // (arte 100% visível) com o chip da condição. Título = nome da pasta.
  async function exportSalesImage(gid, button) {
    const g = sales.group(gid);
    const sym = currencySymbol();
    const list = comPreco(gid);
    if (!g || !list.length) { alert(t("sales.shareEmpty")); return; }
    if (button) button.disabled = true;

    const cols = list.length <= 4 ? list.length : (list.length <= 12 ? 4 : 5);
    const rows = Math.ceil(list.length / cols);
    const CARD_W = 280, CARD_H = Math.round(CARD_W * 1.396), GAP = 18, MARGIN = 32, TITLE_H = 56, FOOTER_H = 38, RADIUS = 14;
    // Banda do preço FORA da carta (abaixo): a arte fica 100% visível pro comprador.
    const BAND_H = 52, CELL_H = CARD_H + BAND_H;
    const width = MARGIN * 2 + cols * CARD_W + (cols - 1) * GAP;
    const height = MARGIN + TITLE_H + rows * CELL_H + (rows - 1) * GAP + FOOTER_H + MARGIN;
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    const FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#111111"; ctx.font = `800 30px ${FONT}`; ctx.textBaseline = "top";
    ctx.fillText(g.name, MARGIN, MARGIN, width - MARGIN * 2);

    const { drawCover, roundRect, imagemDaCarta } = shared.canvasCardHelpers(ctx);

    for (let i = 0; i < list.length; i++) {
      const { it, card } = list[i];
      const x = MARGIN + (i % cols) * (CARD_W + GAP);
      const y = MARGIN + TITLE_H + Math.floor(i / cols) * (CELL_H + GAP);
      // Carta (arte inteira, sem barra por cima)
      ctx.save();
      roundRect(x, y, CARD_W, CARD_H, RADIUS); ctx.fillStyle = "#eceff3"; ctx.fill(); ctx.clip();
      const img = await imagemDaCarta(card);
      if (img) drawCover(img, x, y, CARD_W, CARD_H);
      ctx.restore();
      ctx.save(); roundRect(x, y, CARD_W, CARD_H, RADIUS); ctx.strokeStyle = "#d0d7e0"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
      // Banda abaixo: preço (esquerda) + chip de condição (direita)
      const by = y + CARD_H;
      const cond = it.cond || "NM";
      ctx.font = `800 17px ${FONT}`;
      const chipW = Math.round(ctx.measureText(cond).width) + 20, chipH = 30, chipX = x + CARD_W - chipW, chipY = by + 12;
      roundRect(chipX, chipY, chipW, chipH, 9); ctx.fillStyle = "#e7ebf1"; ctx.fill();
      ctx.fillStyle = "#3a4250"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(cond, chipX + chipW / 2, chipY + chipH / 2 + 1);
      // Preço: encolhe a FONTE (não espreme) até o valor inteiro caber no espaço
      // que sobra ao lado do chip de condição — assim valores grandes nunca cortam.
      const priceText = `${sym} ${it.price.toFixed(2).replace(".", ",")}`;
      const priceMaxW = CARD_W - chipW - 12;
      let pfs = 26;
      ctx.font = `800 ${pfs}px ${FONT}`;
      while (pfs > 14 && ctx.measureText(priceText).width > priceMaxW) { pfs -= 1; ctx.font = `800 ${pfs}px ${FONT}`; }
      ctx.fillStyle = "#111111"; ctx.textAlign = "left";
      ctx.fillText(priceText, x + 2, by + 27, priceMaxW);
      ctx.textAlign = "left"; ctx.textBaseline = "top";
    }
    ctx.fillStyle = "#9aa3b0"; ctx.font = `600 18px ${FONT}`; ctx.textBaseline = "alphabetic";
    ctx.fillText("Sleevu · sleevu.app", MARGIN, height - MARGIN + 4);

    shared.baixarCanvasPng(canvas, `vendas-${slugDe(gid) || "sleevu"}.png`, {
      share: true, // paridade com a vitrine da Coleção: no celular abre o sheet
      onFinish: () => { if (button) button.disabled = false; },
      onTainted: () => alert(t("sales.exportTainted"))
    });
  }

  // ===========================================================================
  // Eventos — delegados no contêiner (as vistas são recriadas a cada troca).
  // ===========================================================================
  function bindEvents() {
    // Busca do topo: na galeria refaz os cards; na pasta, só a grade.
    if (el.search) el.search.addEventListener("input", debounce(() => {
      if (!pronto) return;
      if (openId) pintaGrade(); else { renderGallery(); renderSold(); }
    }, 200));
    // "← Vendas e Trocas" dentro da pasta: volta sem recarregar.
    el.back.addEventListener("click", (event) => {
      if (!openId || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      vaiPara(null);
    });
    // Nome da pasta (o título): grava ao sair do campo / Enter.
    el.title.addEventListener("change", (event) => {
      if (!event.target.matches("#salesFolderName") || !openId) return;
      if (sales.renameGroup(openId, event.target.value)) { renderHead(); mudou(); }
      else event.target.value = (sales.group(openId) || {}).name || "";
    });
    el.title.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.matches("#salesFolderName")) event.target.blur();
    });

    view.addEventListener("click", (event) => {
      // Abrir a pasta (capa ou nome do card): sem recarregar a página.
      const abre = event.target.closest("[data-vnd-open]");
      if (abre) {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return; // nova aba: deixa o link agir
        event.preventDefault();
        vaiPara(abre.dataset.vndOpen);
        return;
      }
      if (event.target.closest("[data-vnd-new]")) { novaPasta(); return; }
      // Menu "⋯" do card da galeria.
      const menuBtn = event.target.closest("[data-vnd-menu]");
      if (menuBtn) {
        const card = menuBtn.closest(".coll-card");
        const abrir = !card.classList.contains("is-menu-open");
        fechaMenus();
        if (abrir) { card.classList.add("is-menu-open"); menuBtn.setAttribute("aria-expanded", "true"); }
        return;
      }
      const noCard = event.target.closest("[data-vnd-folder]");
      const idDoCard = noCard && noCard.dataset.vndFolder;
      const mover = event.target.closest("[data-vnd-move]");
      if (mover && idDoCard) { sales.moveGroup(idDoCard, Number(mover.dataset.vndMove)); renderView(); shared.publishProfile(cards, owned, prices); return; }
      const share = event.target.closest("[data-vnd-share]");
      if (share) { fechaMenus(); shareFolder(idDoCard || openId, idDoCard ? null : share); return; }
      if (event.target.closest("[data-vnd-delete]")) { fechaMenus(); apagaPasta(idDoCard || openId); return; }
      if (!event.target.closest(".coll-card-menu")) fechaMenus();

      // --- pasta aberta ---
      if (!openId) return;
      if (event.target.closest("[data-vnd-add]")) { openSalesPicker(openId); return; }
      if (event.target.closest("[data-vnd-dup]")) { addDuplicatesToSale(); return; }
      if (event.target.closest("[data-vnd-text]")) { openWhatsComposer(openId); return; }
      const imgBtn = event.target.closest("[data-vnd-image]");
      if (imgBtn) { exportSalesImage(openId, imgBtn); return; }
      const chip = event.target.closest("[data-batch-pct]");
      if (chip) { applyMarkup(Number(chip.dataset.batchPct)); return; }
      if (event.target.closest("#salesBatchApply")) { const i = view.querySelector("#salesBatchPct"); applyMarkup(i ? i.value : 0); return; }
      // Tiles da grade: preview, venda realizada, tirar da venda.
      const imageButton = event.target.closest("[data-preview-card-id]");
      if (imageButton) { preview.open(imageButton.dataset.previewCardId, imageButton.dataset.previewVariant); return; }
      const tile = event.target.closest(".sale-tile");
      if (!tile) return;
      const id = tile.dataset.saleCard, v = tile.dataset.saleVariant, idx = Number(tile.dataset.saleIdx) || 0;
      if (event.target.closest("[data-sale-sold]")) { openSoldConfirm(id, v, idx); return; }
      if (event.target.closest("[data-sale-remove]")) { sales.remove(id, v, idx); mudou(); }
    });
    view.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.matches("#salesBatchPct")) applyMarkup(event.target.value);
    });
    // Editar preço / condição inline (por cópia, via data-sale-idx) e ordenar.
    view.addEventListener("change", (event) => {
      if (event.target.matches("#salesSortSelect")) {
        salesSort = event.target.value;
        try { localStorage.setItem("tcg-sales-sort", salesSort); } catch (e) { /* ignora */ }
        pintaGrade();
        return;
      }
      const tile = event.target.closest(".sale-tile");
      if (!tile || !openId) return;
      const id = tile.dataset.saleCard, v = tile.dataset.saleVariant, idx = Number(tile.dataset.saleIdx) || 0;
      if (event.target.matches("[data-sale-cond]")) { sales.setCond(id, v, idx, event.target.value); pintaNumeros(); shared.publishProfile(cards, owned, prices); return; }
      if (!event.target.matches("[data-sale-price]")) return;
      sales.setPrice(id, v, idx, shared.parseMoney(String(event.target.value).trim()));
      mudou(); // o tile pode sumir (preço 0) e o resumo muda
    });
    // Clique fora / Esc fecham o "⋯" dos cards da galeria.
    document.addEventListener("click", (event) => { if (!event.target.closest(".vnd-folder")) fechaMenus(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") fechaMenus(); });
    // Histórico de vendas realizadas: remover um registro (a carta NÃO volta).
    if (el.soldList) el.soldList.addEventListener("click", (event) => {
      const del = event.target.closest("[data-sold-del]");
      if (!del) return;
      const row = del.closest(".sold-row");
      if (row) { const restore = shared.snapshotKeys(["tcg-collector-collection-sold-v1"]); sold.remove(row.dataset.sid); renderView(); shared.toastUndo(t("undo.soldRemoved"), restore); }
    });
  }

  // Boot: liga os controles já (independem do catálogo) e carrega as cartas que
  // você tem de todos os jogos.
  bindEvents();
  openId = lerUrl();
  // ?id= de pasta que não existe (apagada, link velho): cai na galeria com a URL limpa.
  if (!openId && new URLSearchParams(location.search).get("id")) {
    try { history.replaceState(null, "", "sales"); } catch (e) { /* ignora */ }
  }
  // Cartas VENDIDAS já saíram da coleção, mas o histórico precisa delas no
  // catálogo — inclui os ids em todos os jogos (id de outro jogo é no-op no loader).
  const soldIds = sold.list().map((x) => x.cardId);
  Promise.all([
    shared.loadOwnedAcrossGames(Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, ownedByGame[g].knownCardIds().concat(soldIds)]))),
    shared.loadFxRates()
  ])
    .then(([catalog]) => {
      cards = catalog.cards;
      cards.forEach((card) => cardGameMap.set(card.id, card.game));
      cardsById = new Map(cards.map((card) => [card.id, card]));
      Object.keys(ownedByGame).forEach((g) =>
        ownedByGame[g].migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId))));
      pronto = true;
      renderView();
      shared.publishProfile(cards, owned, prices); // republica o perfil público (vendas atualizadas)
      preview.openFromUrl(); // ?card=<id>: reabre o popup (ver collection.js)
    })
    .catch((error) => {
      view.innerHTML = `<p class="empty-state"></p>`;
      shared.mostraErroDeCatalogo(view.firstElementChild, error);
    });
})();
