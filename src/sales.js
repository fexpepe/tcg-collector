// Vendas e Trocas: página dedicada (sales.html) pra montar a lista de cartas à
// venda/troca com preço e condição, ver o VALOR TOTAL da lista, e mandar pros
// grupos (link público ou imagem). Reaproveita o catálogo "owned" (só cartas que
// você tem), a store de preços/preview e a store de vendas (global, cross-game,
// sincronizada via collections.data). Sem inline handlers (CSP script-src 'self').
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const grid = document.getElementById("salesGrid");
  if (!grid) return;

  const { addOptions, detailUrl, unique, t, debounce, escapeHtml, escapeAttribute } = shared;

  let cards = [];
  let cardsById = new Map();
  let gameFilter = "all"; // all | pokemon | lorcana

  // Stores por jogo + facades (despacham por jogo pelo cardGameMap). Igual às
  // outras páginas: a página de vendas só lê cartas que você TEM.
  const ownedByGame = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, shared.createCollectionStore(g)]));
  const wishlistByGame = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, shared.createWishlistStore(g)]));
  const pricesByGame = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, shared.createPriceStore(g)]));
  const cardGameMap = new Map();
  const gameOf = (id) => cardGameMap.get(id) || "pokemon";
  const gameLabelOf = (g) => t(g === "lorcana" ? "filter.gameLorcana" : g === "onepiece" ? "filter.gameOnePiece" : g === "naruto" ? "filter.gameNaruto" : "filter.gamePokemon");
  const owned = shared.mergedCollectionStore(ownedByGame, gameOf);
  const wishlist = shared.mergedWishlistStore(wishlistByGame, gameOf);
  const prices = shared.mergedPriceStore(pricesByGame, gameOf);

  // Vendas: cartas à venda, cada uma com um PREÇO DE VENDA + condição. Global
  // cross-game, por cardId|variant. Local + sync (carimba updatedAt p/ merge LWW).
  const sales = createSalesStore();
  // Modo investidor: vendas REALIZADAS (histórico) + custo pago (pro P&L).
  const sold = shared.createSoldStore();
  const costs = shared.createCostsStore();
  function createSalesStore() {
    const KEY = "tcg-collector-collection-sales-v1";
    let data = { sales: {}, order: [], updatedAt: 0 };
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (raw && raw.sales && typeof raw.sales === "object") data = raw;
    } catch (e) { /* corrompido: começa vazio */ }
    if (!Array.isArray(data.order)) data.order = [];
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
      if (changed) localStorage.setItem(KEY, JSON.stringify(data)); // persiste sem bumpar updatedAt
    })();
    const save = () => { data.updatedAt = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* quota: ignora */ } };
    return {
      has: (cardId, variant, idx) => !!data.sales[keyOf(cardId, variant, idx)],
      priceOf: (cardId, variant, idx) => { const e = data.sales[keyOf(cardId, variant, idx)]; return e ? (Number(e.price) || 0) : 0; },
      condOf: (cardId, variant, idx) => { const e = data.sales[keyOf(cardId, variant, idx)]; return (e && e.cond) || "NM"; },
      // Quantas cópias deste card+variant já estão na venda.
      countOf: (cardId, variant) => data.order.reduce((n, k) => { const e = data.sales[k]; return n + (e && e.cardId === cardId && e.variant === variant ? 1 : 0); }, 0),
      any: () => Object.keys(data.sales).length > 0,
      // Itens na ordem do usuário (só os que ainda existem).
      // `auto`: o preço veio do valor de mercado (TCGplayer) e NÃO foi editado à mão
      // — usado pra colorir (laranja = automático, preto = revisado pelo usuário).
      list: () => data.order.filter((k) => data.sales[k]).map((k) => {
        const e = data.sales[k];
        return { key: k, cardId: e.cardId, variant: e.variant, idx: e.idx, price: Number(e.price) || 0, cond: e.cond || "NM", auto: !!e.auto };
      }),
      // Ao adicionar, já pré-preenche o preço de venda com o valor de mercado
      // (TCGplayer) — fica `auto` até o usuário digitar. 0 se não houver cotação.
      add(cardId, variant, idx, initialPrice, initialCond) {
        const k = keyOf(cardId, variant, idx);
        if (!data.sales[k]) {
          const p = Number(initialPrice) || 0;
          data.sales[k] = { cardId, variant, idx, price: p > 0 ? Math.round(p * 100) / 100 : 0, cond: initialCond || "NM", auto: true };
          data.order.push(k); save();
        }
      },
      setPrice(cardId, variant, idx, price) {
        const k = keyOf(cardId, variant, idx), p = Number(price) || 0, e = data.sales[k];
        // Editar o preço à mão = não é mais automático (auto: false).
        if (p <= 0 && e) { delete data.sales[k]; data.order = data.order.filter((x) => x !== k); }
        else if (p > 0) {
          if (!e) { data.sales[k] = { cardId, variant, idx, price: Math.round(p * 100) / 100, cond: "NM", auto: false }; data.order.push(k); }
          else { e.price = Math.round(p * 100) / 100; e.auto = false; }
        }
        save();
      },
      setCond(cardId, variant, idx, cond) { const e = data.sales[keyOf(cardId, variant, idx)]; if (e) { e.cond = cond; save(); } },
      remove(cardId, variant, idx) { const k = keyOf(cardId, variant, idx); if (data.sales[k]) { delete data.sales[k]; data.order = data.order.filter((x) => x !== k); save(); } },
      // Markup global (% sobre a REFERÊNCIA de mercado): -10 = vender a 10% abaixo.
      // Fica salvo pra aparecer no dashboard e valer pras cartas adicionadas depois.
      getMarkup: () => Number(data.markup) || 0,
      // Aplica o markup a TODAS as cartas: preço = referência(condição) × (1 + pct/100).
      // refFn(cardId, variant, cond) -> valor de mercado. Mantém o item mesmo sem
      // cotação (preço 0). Marca auto (derivado da referência, não digitado à mão).
      applyMarkup(pct, refFn) {
        data.markup = Number(pct) || 0;
        const f = 1 + data.markup / 100;
        data.order.forEach((k) => {
          const e = data.sales[k]; if (!e) return;
          const ref = (refFn && refFn(e.cardId, e.variant, e.cond)) || 0;
          e.price = ref > 0 ? Math.round(ref * f * 100) / 100 : 0;
          e.auto = true;
        });
        save();
      }
    };
  }

  const elements = {
    gameFilter: document.getElementById("gameFilter"),
    grid,
    salesEmpty: document.getElementById("salesEmpty"),
    salesAddBtn: document.getElementById("salesAddBtn"),
    salesShareBtn: document.getElementById("salesShareBtn"),
    salesExportBtn: document.getElementById("salesExportBtn"),
    salesSort: document.getElementById("salesSortSelect"),
    batch: document.querySelector(".sales-batch"),
    batchInput: document.getElementById("salesBatchPct"),
    batchApply: document.getElementById("salesBatchApply"),
    dashboard: document.getElementById("salesDashboard"),
    dashValue: document.getElementById("salesDashValue"),
    dashMarkup: document.getElementById("salesDashMarkup"),
    dashCount: document.getElementById("salesDashCount"),
    dashTopList: document.getElementById("salesDashTop"),
    dashDist: document.getElementById("salesDashDist")
  };

  const preview = shared.createCardPreview({
    getCard: (cardId) => cardsById.get(cardId),
    store: owned,
    prices,
    wishlist,
    // Campo "Vender por R$" no preview: mexe na 1ª cópia (idx 0). A gestão de
    // várias cópias com condições diferentes é no picker + na grade de vendas.
    sale: {
      priceOf: (cardId, variant) => sales.priceOf(cardId, variant, 0),
      onChange: (cardId, variant, price) => { sales.setPrice(cardId, variant, 0, price); render(); }
    }
  });

  function inGameFilter(card) { return gameFilter === "all" || card.game === gameFilter; }

  // Referência de mercado de um item (por condição) — base do markup em lote.
  function refValue(cardId, variant, cond) {
    const card = cardsById.get(cardId);
    return card ? (shared.cardValue(card, variant, prices, cond).value || 0) : 0;
  }
  // Texto do markup pro dashboard: "−10% da referência" / "+5% da referência".
  function markupLabel(pct) {
    if (!pct) return t("sales.batch.atMarket");
    const sign = pct > 0 ? "+" : "−";
    return t("sales.batch.badge", { pct: sign + Math.abs(pct) });
  }
  // Aplica o markup e re-renderiza (sincroniza o input).
  function applyMarkup(pct) {
    const p = Math.max(-95, Math.min(500, Math.round(Number(pct) || 0)));
    sales.applyMarkup(p, refValue);
    if (elements.batchInput) elements.batchInput.value = p ? String(p) : "";
    render();
  }

  const currencySymbol = shared.currencySymbol;
  const distBarsHtml = shared.distBarsHtml;

  // Ordenação da lista de vendas (mesmas opções da Coleção). Persistida.
  const SALES_SORTS = ["value-desc", "value-asc", "num-asc", "num-desc", "rarity-desc", "rarity-asc", "release", "added-desc", "added-asc"];
  let salesSort = SALES_SORTS.includes(localStorage.getItem("tcg-sales-sort")) ? localStorage.getItem("tcg-sales-sort") : "added-asc";

  // Ordena itens [{it, card}]. "Valor" = preço de VENDA; "Adição" = ordem em que
  // entraram na lista de vendas (sales.list = data.order).
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

  // Itens à venda (já resolvidos pra carta) respeitando o filtro de jogo + ordenação.
  function saleItems() {
    return sortSaleItems(sales.list()
      .map((it) => ({ it, card: cardsById.get(it.cardId) }))
      .filter((x) => x.card && inGameFilter(x.card)));
  }

  function render() {
    shared.applyGameAccent(gameFilter); // accent vermelho/roxo/neutro conforme o jogo
    renderDashboard();
    renderSales();
    renderSold();
  }

  // Dashboard de resumo: valor total da lista + quantidade + mais caras + por jogo.
  function renderDashboard() {
    if (!elements.dashboard) return;
    const items = saleItems();
    elements.dashboard.hidden = false;
    const cur = shared.getCurrency();
    const total = items.reduce((sum, { it }) => sum + (it.price || 0), 0);
    elements.dashValue.textContent = total > 0 ? shared.formatMoney(cur, total) : "—";
    elements.dashCount.textContent = items.length;
    // Badge do markup: evidencia que a lista está, ex., 10% abaixo da referência.
    if (elements.dashMarkup) {
      const mk = sales.getMarkup();
      elements.dashMarkup.textContent = markupLabel(mk);
      elements.dashMarkup.hidden = !mk;
      elements.dashMarkup.classList.toggle("is-down", mk < 0);
      elements.dashMarkup.classList.toggle("is-up", mk > 0);
    }

    // Mais caras (top 3 pelo preço de venda).
    const top = items.filter(({ it }) => it.price > 0).sort((a, b) => b.it.price - a.it.price).slice(0, 3);
    elements.dashTopList.innerHTML = top.length
      ? top.map(({ it, card }) => {
          const src = shared.cardImageSources(card);
          const thumb = shared.localizedImg(src.url, { alt: "", fallback: src.fallback, loading: "lazy", thumb: true });
          return `<li><a href="${escapeAttribute(detailUrl("set", card.set))}"><span class="dash-top-thumb">${thumb}</span>
            <span class="dash-top-info"><strong>${escapeHtml(card.name)}</strong><span class="dash-top-set">${escapeHtml(it.cond)} · ${escapeHtml(card.set)}</span></span>
            <span class="dash-top-val">${escapeHtml(shared.formatMoney(cur, it.price))}</span></a></li>`;
        }).join("")
      : `<li class="dash-empty">${escapeHtml(t("dash.empty"))}</li>`;

    // Distribuição por jogo (Pokémon × Lorcana) das cartas à venda.
    const byGame = {};
    items.forEach(({ card }) => { byGame[card.game] = (byGame[card.game] || 0) + 1; });
    elements.dashDist.innerHTML = distBarsHtml(shared.GAME_SLUGS.map((g) => ({ label: gameLabelOf(g), n: byGame[g] || 0, color: shared.GAME_COLOR[g] })));
  }

  function renderSales() {
    const items = saleItems();
    elements.salesEmpty.hidden = items.length > 0;
    const sym = currencySymbol();
    elements.grid.innerHTML = items.map(({ it, card }) => saleTileHtml(card, it.variant, it.idx, it.price, sym, it.cond, it.auto)).join("");
    const hasPriced = items.some((x) => x.it.price > 0);
    if (elements.salesShareBtn) elements.salesShareBtn.disabled = !hasPriced;
    if (elements.salesExportBtn) elements.salesExportBtn.disabled = !hasPriced;
  }

  // Tile de venda: imagem (→ preview) + campo de preço editável + condição + ✕ remover.
  // idx = índice da cópia (várias cópias da mesma carta podem estar à venda).
  function saleTileHtml(card, variant, idx, price, sym, cond, auto) {
    const src = shared.cardImageSources(card);
    const img = shared.localizedImg(src.url, { alt: card.name, fallback: src.fallback, loading: "lazy", thumb: true });
    const priceStr = price > 0 ? String(price).replace(".", ",") : "";
    const current = cond || "NM";
    const condOpts = shared.CARD_CONDITIONS.map((c) => `<option value="${c}"${c === current ? " selected" : ""}>${c}</option>`).join("");
    // Preço automático (TCGplayer, não editado) = laranja; revisado à mão = preto.
    const autoCls = auto && price > 0 ? " is-auto" : "";
    return `<article class="card-tile sale-tile" data-sale-card="${escapeAttribute(card.id)}" data-sale-variant="${escapeAttribute(variant)}" data-sale-idx="${idx}">
      <div class="card-image">
        <button type="button" class="image-open" data-preview-card-id="${escapeAttribute(card.id)}" data-preview-variant="${escapeAttribute(variant)}" aria-label="${escapeAttribute(t("card.zoom", { name: card.name }))}">${img}</button>
        <button type="button" class="sale-remove" data-sale-remove title="${escapeAttribute(t("sales.remove"))}" aria-label="${escapeAttribute(t("sales.remove"))}">✕</button>
      </div>
      <div class="tile-info">
        <h3>${escapeHtml(card.name)}</h3>
        <p class="tile-variant">${shared.cardFlag(card.language)}<span>${escapeHtml(variant)}</span></p>
        <div class="sale-fields">
          <label class="sale-price-field${autoCls}"><span class="sale-cur">${escapeHtml(sym)}</span><input type="text" inputmode="decimal" class="sale-price${autoCls}" data-sale-price value="${escapeAttribute(priceStr)}" placeholder="0,00"></label>
          <select class="sale-cond" data-sale-cond aria-label="${escapeAttribute(t("sales.condition"))}" title="${escapeAttribute(t("sales.condition"))}">${condOpts}</select>
        </div>
        <button type="button" class="sale-sold-btn" data-sale-sold title="${escapeAttribute(t("sales.sold.hint"))}">${escapeHtml(t("sales.sold.btn"))}</button>
      </div>
    </article>`;
  }

  // Duplicatas → venda em 1 clique: todo card×variante com mais de 1 cópia entra
  // na lista com as cópias EXCEDENTES (mantém 1 na coleção), cada uma com a sua
  // condição real e o preço de mercado. Respeita o filtro de jogo e o que já
  // está à venda (não duplica itens).
  function addDuplicatesToSale() {
    const priceOf = (card, variant) => shared.cardValue(card, variant, prices, shared.DEFAULT_CONDITION).value || 0;
    let added = 0;
    cards.filter((c) => inGameFilter(c) && owned.has(c.id)).forEach((card) => {
      (card.variants && card.variants.length ? card.variants : [shared.defaultVariant(card)]).forEach((variant) => {
        const total = owned.variantTotal(card.id, variant);
        if (total <= 1) return;
        const conds = [];
        owned.conditionBreakdown(card.id, variant).forEach(({ condition, quantity }) => { for (let i = 0; i < quantity; i++) conds.push(condition); });
        const sellable = total - 1; // 1 fica na coleção
        const inSale = sales.countOf(card.id, variant);
        for (let i = inSale; i < sellable; i++) {
          if (!sales.has(card.id, variant, i)) { sales.add(card.id, variant, i, priceOf(card, variant), conds[i + 1] || "NM"); added++; }
        }
      });
    });
    if (!added) { alert(t("sales.dup.none")); return; }
    render();
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
    const src = shared.cardImageSources(card);
    const img = shared.localizedImg(src.url, { alt: card.name, fallback: src.fallback, thumb: true });
    modal.innerHTML = `<div class="sales-picker-backdrop" data-sold-close></div>
      <section class="sales-picker-panel sold-confirm-panel" role="dialog" aria-modal="true" aria-label="${escapeAttribute(t("sales.sold.title"))}">
        <header class="sales-picker-head"><strong>${escapeHtml(t("sales.sold.title"))}</strong>
          <button type="button" class="preview-close" data-sold-close aria-label="${escapeAttribute(t("modal.close"))}">×</button></header>
        <div class="sold-confirm-body">
          <div class="sold-confirm-card">
            <span class="sold-confirm-thumb">${img}</span>
            <span class="sold-confirm-info"><strong>${escapeHtml(card.name)}</strong>
              <span>${escapeHtml(card.set)} · ${escapeHtml(card.number)} · ${escapeHtml(variant)} · ${escapeHtml(cond)}</span></span>
          </div>
          <label class="sold-confirm-field"><span>${escapeHtml(t("sales.sold.price"))}</span>
            <span class="sale-price-field"><span class="sale-cur">${escapeHtml(sym)}</span>
            <input type="text" inputmode="decimal" class="sale-price" id="soldPriceInput" value="${escapeAttribute(price > 0 ? price.toFixed(2).replace(".", ",") : "")}" placeholder="0,00"></span></label>
          <label class="sold-confirm-field"><span>${escapeHtml(t("sales.sold.date"))}</span>
            <input type="date" id="soldDateInput" value="${new Date().toISOString().slice(0, 10)}"></label>
          ${paidNow > 0 ? `<p class="sold-confirm-paid">${escapeHtml(t("sales.sold.paidInfo", { v: shared.formatMoney(shared.getCurrency(), paidNow) }))}</p>` : ""}
          <p class="sold-confirm-note">${escapeHtml(t("sales.sold.removeNote"))}</p>
        </div>
        <footer class="sales-picker-foot">
          <button type="button" class="secondary" data-sold-close>${escapeHtml(t("modal.close"))}</button>
          <button type="button" class="primary" data-sold-confirm>${escapeHtml(t("sales.sold.confirm"))}</button>
        </footer>
      </section>`;
    document.body.classList.add("preview-open");
    const close = () => { modal.remove(); document.body.classList.remove("preview-open"); };
    modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-sold-close]")) { close(); return; }
      if (!event.target.closest("[data-sold-confirm]")) return;
      const text = String(modal.querySelector("#soldPriceInput").value).trim();
      const amount = shared.parseMoney(text);
      const date = modal.querySelector("#soldDateInput").value || new Date().toISOString().slice(0, 10);
      sold.add({ cardId, variant, cond, price: amount, paid: paidNow, cur: shared.getCurrency(), date });
      sales.remove(cardId, variant, idx);
      removeCopyFromCollection(cardId, variant, cond);
      close();
      render();
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

  // Histórico de vendas realizadas: linhas com data, carta, pago, vendido e
  // resultado (vendido − pago, quando há custo). PRIVADO (não vai no share).
  function renderSold() {
    const section = document.getElementById("soldSection");
    const listEl = document.getElementById("soldList");
    const sumEl = document.getElementById("soldSummary");
    if (!section || !listEl) return;
    const items = sold.list()
      .map((it) => ({ it, card: cardsById.get(it.cardId) }))
      .filter((x) => x.card && inGameFilter(x.card));
    section.hidden = !items.length;
    if (!items.length) { listEl.innerHTML = ""; if (sumEl) sumEl.textContent = ""; return; }
    const cur = shared.getCurrency();
    const fmtDate = (s) => { const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : s; };
    let totalSold = 0, totalPnl = 0, pnlCount = 0;
    const rows = items.map(({ it, card }) => {
      const price = shared.moneyToCurrent(it.price, it.cur);
      const paid = shared.moneyToCurrent(it.paid, it.cur);
      totalSold += price;
      const hasPnl = it.paid > 0;
      const pnl = price - paid;
      if (hasPnl) { totalPnl += pnl; pnlCount++; }
      const src = shared.cardImageSources(card);
      const thumb = shared.localizedImg(src.url, { alt: "", fallback: src.fallback, loading: "lazy", thumb: true });
      const pnlHtml = hasPnl
        ? `<span class="sold-pnl ${pnl >= 0 ? "is-up" : "is-down"}">${pnl >= 0 ? "+" : "−"}${escapeHtml(shared.formatMoney(cur, Math.abs(pnl)))}</span>`
        : `<span class="sold-pnl is-na">—</span>`;
      return `<div class="sold-row" data-sid="${escapeAttribute(it.sid)}">
        <span class="sold-date">${escapeHtml(fmtDate(it.date))}</span>
        <span class="sold-thumb">${thumb}</span>
        <span class="sold-info"><strong>${escapeHtml(card.name)}</strong><span>${escapeHtml(card.set)} · ${escapeHtml(it.variant)} · ${escapeHtml(it.cond)}</span></span>
        <span class="sold-paid">${it.paid > 0 ? escapeHtml(shared.formatMoney(cur, paid)) : "—"}</span>
        <span class="sold-price">${escapeHtml(shared.formatMoney(cur, price))}</span>
        ${pnlHtml}
        <button type="button" class="sale-remove sold-del" data-sold-del title="${escapeAttribute(t("sales.sold.delete"))}" aria-label="${escapeAttribute(t("sales.sold.delete"))}">✕</button>
      </div>`;
    }).join("");
    listEl.innerHTML = `<div class="sold-row sold-row-head">
        <span class="sold-date">${escapeHtml(t("sales.sold.date"))}</span><span></span><span></span>
        <span class="sold-paid">${escapeHtml(t("cost.label"))}</span>
        <span class="sold-price">${escapeHtml(t("sales.sold.priceShort"))}</span>
        <span class="sold-pnl">${escapeHtml(t("sales.sold.result"))}</span><span></span>
      </div>` + rows;
    if (sumEl) {
      let s = `${items.length} · ${shared.formatMoney(cur, totalSold)}`;
      if (pnlCount) s += ` · ${t("sales.sold.result")} ${totalPnl >= 0 ? "+" : "−"}${shared.formatMoney(cur, Math.abs(totalPnl))}`;
      sumEl.textContent = s;
    }
  }

  // Picker pra adicionar/tirar cartas da venda em lote: filtro de jogo + busca +
  // grade das cartas que você TEM. Tocar alterna (✓ = está na venda). O rodapé
  // mostra quantas estão na venda; ao fechar, a lista reflete. Tudo persiste na
  // hora (cada toque grava na store).
  function openSalesPicker() {
    let modal = document.getElementById("salesPickerModal");
    if (!modal) { modal = document.createElement("div"); modal.id = "salesPickerModal"; modal.className = "sales-picker-modal"; document.body.appendChild(modal); }
    let pickGame = gameFilter; // começa no filtro atual; dá pra trocar
    let pickRarity = "";          // filtro de raridade (vazio = todas)
    let pickSort = "value-desc";  // ordenação (mesma lógica da aba Cartas)
    const updateCount = () => { const el = modal.querySelector(".sales-picker-count"); if (el) el.textContent = t("sales.pickerCount", { n: sales.list().length }); };
    const priceOf = (card, variant) => shared.cardValue(card, variant, prices, shared.DEFAULT_CONDITION).value || 0;
    // Condições de cada cópia que você tem desse card+variant (ex.: [NM, D, D]),
    // pra pré-preencher a condição da venda. Completa com NM se faltar.
    const copyConds = (cardId, variant) => {
      const total = owned.variantTotal(cardId, variant);
      const conds = [];
      owned.conditionBreakdown(cardId, variant).forEach(({ condition, quantity }) => { for (let i = 0; i < quantity; i++) conds.push(condition); });
      while (conds.length < total) conds.push("NM");
      return conds.slice(0, total);
    };
    const sortPairs = (pairs) => {
      if (pickSort === "num-asc") return pairs.sort((a, b) => shared.compareCardNumbers(a.card.number, b.card.number));
      if (pickSort === "num-desc") return pairs.sort((a, b) => shared.compareCardNumbers(b.card.number, a.card.number));
      if (pickSort === "release") return pairs.sort((a, b) => String(b.card.setReleaseDate || "").localeCompare(String(a.card.setReleaseDate || "")));
      if (pickSort === "value-asc") return pairs.sort((a, b) => { const pa = priceOf(a.card, a.variant), pb = priceOf(b.card, b.variant); if (!pa && !pb) return 0; if (!pa) return 1; if (!pb) return -1; return pa - pb; });
      return pairs.sort((a, b) => priceOf(b.card, b.variant) - priceOf(a.card, a.variant)); // value-desc (padrão)
    };
    const renderList = () => {
      const q = modal.querySelector(".sales-picker-search").value;
      const base = cards.filter((c) => owned.has(c.id) && (pickGame === "all" || c.game === pickGame));
      const pairs = sortPairs(shared.cardVariantPairs(base)
        .filter(({ card, variant }) => owned.variantTotal(card.id, variant) > 0)
        .filter(({ card }) => !pickRarity || card.rarity === pickRarity)
        .filter(({ card }) => !q.trim() || shared.matchesCardQuery(card, q)))
        .slice(0, 200);
      // 1 tile por carta+variante, com a quantidade que você tem (×N). Tocar
      // adiciona TODAS as cópias de uma vez (cada uma vira um item separado na
      // venda, com a condição que ela tem na coleção). Tocar de novo tira todas.
      const html = pairs.map(({ card, variant }) => {
        const src = shared.cardImageSources(card);
        const img = shared.localizedImg(src.url, { alt: card.name, fallback: src.fallback, loading: "lazy", thumb: true });
        const total = copyConds(card.id, variant).length;
        const added = sales.countOf(card.id, variant);
        const cls = added >= total ? " is-added" : (added > 0 ? " is-partial" : "");
        const qty = total > 1 ? `<span class="sales-pick-qty">×${total}</span>` : "";
        const count = added > 0 ? `<span class="sales-pick-cond">${added}/${total}</span>` : "";
        return `<div class="sales-pick${cls}" role="button" tabindex="0" data-pick-card="${escapeAttribute(card.id)}" data-pick-variant="${escapeAttribute(variant)}">
          <span class="sales-pick-img">${img}<span class="sales-pick-check">✓</span>${qty}</span>
          <span class="sales-pick-name">${escapeHtml(card.name)}</span>
          <span class="sales-pick-var">${shared.cardFlag(card.language)}<span>${escapeHtml(variant)}</span>${count}</span>
        </div>`;
      }).join("") || `<p class="empty-state">${escapeHtml(t("sales.pickerEmpty"))}</p>`;
      modal.querySelector(".sales-picker-results").innerHTML = html;
    };
    const ownedPool = cards.filter((c) => owned.has(c.id));
    const rarityOpts = `<option value="">${escapeHtml(t("filter.all.f"))}</option>`
      + unique(ownedPool.map((c) => c.rarity).filter(Boolean)).sort().map((r) => `<option value="${escapeAttribute(r)}">${escapeHtml(r)}</option>`).join("");
    const sortOpts = [["value-desc", "sort.valueDesc"], ["value-asc", "sort.valueAsc"], ["num-asc", "sort.numAsc"], ["num-desc", "sort.numDesc"], ["release", "sort.releaseDate"]]
      .map(([v, k]) => `<option value="${v}"${v === pickSort ? " selected" : ""}>${escapeHtml(t(k))}</option>`).join("");
    modal.innerHTML = `<div class="sales-picker-backdrop" data-sales-picker-close></div>
      <section class="sales-picker-panel" role="dialog" aria-modal="true" aria-label="${escapeAttribute(t("sales.add"))}">
        <header class="sales-picker-head"><strong>${escapeHtml(t("sales.add"))}</strong>
          <button type="button" class="preview-close" data-sales-picker-close aria-label="${escapeAttribute(t("modal.close"))}">×</button></header>
        <div class="sales-picker-controls">
          <div class="chip-filter game-filter" id="salesPickerGame" role="group" aria-label="Jogo">
            <button type="button" class="chip" data-pick-game="all" aria-pressed="${pickGame === "all"}">${escapeHtml(t("filter.gameAll"))}</button>
            ${shared.GAME_SLUGS.map((g) => `<button type="button" class="chip" data-pick-game="${g}" aria-pressed="${pickGame === g}">${escapeHtml(gameLabelOf(g))}</button>`).join("")}
          </div>
          <input type="search" class="sales-picker-search" placeholder="${escapeAttribute(t("search.placeholder.cards"))}">
          <label class="sales-picker-field"><span>${escapeHtml(t("toolbar.rarity"))}</span>
            <select class="sales-picker-select" id="salesPickerRarity">${rarityOpts}</select></label>
          <label class="sales-picker-field"><span>${escapeHtml(t("sort.label"))}</span>
            <select class="sales-picker-select" id="salesPickerSort">${sortOpts}</select></label>
        </div>
        <div class="sales-picker-results"></div>
        <footer class="sales-picker-foot">
          <span class="sales-picker-count"></span>
          <button type="button" class="primary" data-sales-picker-close>${escapeHtml(t("sales.pickerDone"))}</button>
        </footer>
      </section>`;
    document.body.classList.add("preview-open");
    renderList(); updateCount();
    modal.querySelector(".sales-picker-search").addEventListener("input", debounce(renderList, 200));
    modal.addEventListener("change", (event) => {
      const rar = event.target.closest("#salesPickerRarity");
      if (rar) { pickRarity = rar.value; renderList(); return; }
      const srt = event.target.closest("#salesPickerSort");
      if (srt) { pickSort = srt.value; renderList(); }
    });
    modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-sales-picker-close]")) { modal.remove(); document.body.classList.remove("preview-open"); render(); return; }
      const gameChip = event.target.closest("[data-pick-game]");
      if (gameChip) {
        pickGame = gameChip.dataset.pickGame;
        modal.querySelectorAll("#salesPickerGame .chip").forEach((c) => c.setAttribute("aria-pressed", String(c === gameChip)));
        renderList(); return;
      }
      const pick = event.target.closest("[data-pick-card]");
      if (pick) {
        const id = pick.dataset.pickCard, v = pick.dataset.pickVariant;
        const conds = copyConds(id, v), total = conds.length;
        if (sales.countOf(id, v) >= total) {
          // todas já à venda → tira todas
          for (let i = 0; i < total; i++) sales.remove(id, v, i);
        } else {
          // adiciona TODAS as cópias que faltam, cada uma com sua condição + preço de
          // mercado JÁ com o markup ativo (pra ficar consistente com a lista).
          const f = 1 + sales.getMarkup() / 100;
          const mkt = priceOf(cardsById.get(id), v) * f;
          conds.forEach((cond, i) => { if (!sales.has(id, v, i)) sales.add(id, v, i, mkt, cond); });
        }
        // atualiza o tile no lugar (sem re-render, pra não perder a rolagem)
        const added = sales.countOf(id, v);
        pick.classList.toggle("is-added", added >= total);
        pick.classList.toggle("is-partial", added > 0 && added < total);
        let countEl = pick.querySelector(".sales-pick-cond");
        if (added > 0) {
          if (!countEl) { countEl = document.createElement("span"); countEl.className = "sales-pick-cond"; pick.querySelector(".sales-pick-var").appendChild(countEl); }
          countEl.textContent = `${added}/${total}`;
        } else if (countEl) { countEl.remove(); }
        updateCount();
      }
    });
  }

  // Itens das cartas à venda pro share — cada um leva o preço de venda (sp), a
  // condição (cond) e a moeda (cur). A view ?s= (somente leitura) vive na
  // collection.html, então o link aponta pra lá.
  function buildSaleShareData() {
    const cur = shared.getCurrency();
    // Compartilha todas as cartas precificadas, NA ORDEM do seletor de ordenação.
    const sorted = sortSaleItems(sales.list()
      .map((it) => ({ it, card: cardsById.get(it.cardId) }))
      .filter((x) => x.card && x.it.price > 0));
    const items = sorted.map(({ it, card }) => {
      const src = shared.cardImageSources(card);
      return {
        id: card.id, n: card.name, s: card.set, num: card.number, lang: card.language,
        g: card.game, v: it.variant, q: 1, sp: it.price, cond: it.cond || "NM", cur, img: src.url, fb: src.fallback || ""
      };
    });
    return { items, scope: "sale", cur };
  }

  async function shareSales(btn) {
    // Perfil público: link VIVO da aba Vendas (sempre atualizado) no lugar do snapshot.
    const live = shared.publicProfileUrl("sales");
    if (live) {
      try { await navigator.clipboard.writeText(live); alert(t("collection.share.copiedLive")); }
      catch (e) { window.prompt(t("collection.share.copyManual"), live); }
      return;
    }
    const data = buildSaleShareData();
    if (!data.items.length) { alert(t("sales.shareEmpty")); return; }
    if (btn) btn.disabled = true;
    const res = await shared.createShare("collection", t("sales.shared.label"), data);
    if (btn) btn.disabled = false;
    if (res && res.id) {
      const link = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}collection.html?s=${res.id}`;
      try { await navigator.clipboard.writeText(link); alert(t("collection.share.copied")); }
      catch (e) { window.prompt(t("collection.share.copyManual"), link); }
    } else {
      alert(res && res.error === "auth" ? t("collection.share.needLogin") : t("collection.share.error"));
    }
  }

  // Gera a imagem (PNG) das cartas à venda + preços, pra mandar nos grupos.
  // Canvas puro (CSP-safe, sem lib). O preço vai numa banda ABAIXO da carta
  // (arte 100% visível) com o chip da condição.
  async function exportSalesImage(button) {
    const sym = currencySymbol();
    const list = saleItems().filter((x) => x.it.price > 0);
    if (!list.length) { alert(t("sales.shareEmpty")); return; }
    const label = button ? button.textContent : "";
    if (button) { button.disabled = true; button.textContent = "…"; }

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
    ctx.fillText(t("sales.shared.label"), MARGIN, MARGIN);

    // Cache-buster: o tile/preview pode ter carregado a MESMA imagem SEM
    // crossOrigin, poluindo o cache — e aí a carga com crossOrigin reusa a versão
    // poluída e "taint"a o canvas. Uma query nova força um fetch CORS limpo.
    const bust = (u) => u ? u + (u.indexOf("?") >= 0 ? "&" : "?") + "sx=1" : u;
    const loadImage = (url, cross) => new Promise((res) => {
      if (!url) return res(null);
      const im = new Image(); if (cross) im.crossOrigin = "anonymous";
      im.onload = () => res(im); im.onerror = () => res(null); im.src = url;
    });
    const drawCover = (img, x, y, w, h) => {
      const ir = img.width / img.height, rr = w / h; let sw, sh, sx, sy;
      if (ir > rr) { sh = img.height; sw = sh * rr; sx = (img.width - sw) / 2; sy = 0; }
      else { sw = img.width; sh = sw / rr; sx = 0; sy = (img.height - sh) / 2; }
      ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    };
    const roundRect = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };

    for (let i = 0; i < list.length; i++) {
      const { it, card } = list[i];
      const x = MARGIN + (i % cols) * (CARD_W + GAP);
      const y = MARGIN + TITLE_H + Math.floor(i / cols) * (CELL_H + GAP);
      // Carta (arte inteira, sem barra por cima)
      ctx.save();
      roundRect(x, y, CARD_W, CARD_H, RADIUS); ctx.fillStyle = "#eceff3"; ctx.fill(); ctx.clip();
      const src = shared.cardImageSources(card);
      // Lorcana (cards.lorcast.io) e One Piece (tcgplayer-cdn) NÃO mandam CORS →
      // o crossOrigin falhava e caía no fallback (que é uma URL de Pokémon!).
      // Roteia pela wsrv.nl (proxy com CORS) e NÃO usa o fallback de Pokémon.
      // Pokémon segue direto pela tcgdex (tem CORS).
      const lor = card.game === "lorcana" || card.game === "onepiece";
      let img;
      if (lor) {
        img = await loadImage(`https://wsrv.nl/?url=${encodeURIComponent(src.url)}&output=webp`, true);
      } else {
        img = await loadImage(bust(src.url), true);
        if (!img && src.fallback) img = await loadImage(bust(src.fallback), true);
      }
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

    const finish = () => { if (button) { button.disabled = false; button.textContent = label; } };
    try {
      canvas.toBlob((blob) => {
        if (!blob) { alert(t("sales.exportTainted")); finish(); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "vendas-sleevu.png";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        finish();
      }, "image/png");
    } catch (e) { alert(t("sales.exportTainted")); finish(); }
  }

  function bindEvents() {
    // Filtro de jogo
    if (elements.gameFilter) {
      elements.gameFilter.addEventListener("click", (event) => {
        const chip = event.target.closest("[data-game-filter]");
        if (!chip || chip.dataset.gameFilter === gameFilter) return;
        gameFilter = chip.dataset.gameFilter;
        Array.from(elements.gameFilter.children).forEach((node) => node.setAttribute("aria-pressed", node === chip ? "true" : "false"));
        render();
      });
    }
    // Abrir o preview ao tocar na imagem
    elements.grid.addEventListener("click", (event) => {
      const imageButton = event.target.closest("[data-preview-card-id]");
      if (imageButton) { preview.open(imageButton.dataset.previewCardId, imageButton.dataset.previewVariant); return; }
      const sb = event.target.closest("[data-sale-sold]");
      if (sb) { const tile = sb.closest(".sale-tile"); if (tile) openSoldConfirm(tile.dataset.saleCard, tile.dataset.saleVariant, Number(tile.dataset.saleIdx) || 0); return; }
      const rm = event.target.closest("[data-sale-remove]");
      if (rm) { const tile = rm.closest(".sale-tile"); if (tile) { sales.remove(tile.dataset.saleCard, tile.dataset.saleVariant, Number(tile.dataset.saleIdx) || 0); render(); } }
    });
    // Histórico de vendas realizadas: remover um registro (a carta NÃO volta).
    const soldList = document.getElementById("soldList");
    if (soldList) soldList.addEventListener("click", (event) => {
      const del = event.target.closest("[data-sold-del]");
      if (!del) return;
      const row = del.closest(".sold-row");
      if (row) { const restore = shared.snapshotKeys(["tcg-collector-collection-sold-v1"]); sold.remove(row.dataset.sid); render(); shared.toastUndo(t("undo.soldRemoved"), restore); }
    });
    // Editar preço / condição inline (por cópia, via data-sale-idx)
    elements.grid.addEventListener("change", (event) => {
      const tile = event.target.closest(".sale-tile");
      if (!tile) return;
      const id = tile.dataset.saleCard, v = tile.dataset.saleVariant, idx = Number(tile.dataset.saleIdx) || 0;
      const condSel = event.target.closest("[data-sale-cond]");
      if (condSel) { sales.setCond(id, v, idx, condSel.value); return; }
      const input = event.target.closest("[data-sale-price]");
      if (!input) return;
      const text = String(input.value).trim();
      const amount = shared.parseMoney(text);
      sales.setPrice(id, v, idx, amount);
      render(); // o tile pode sumir (preço 0) e o dashboard muda
    });
    // Batch: chips de % rápido + campo custom. Aplica o markup pela referência.
    if (elements.batch) {
      elements.batch.addEventListener("click", (event) => {
        const chip = event.target.closest("[data-batch-pct]");
        if (chip) { applyMarkup(Number(chip.dataset.batchPct)); }
      });
    }
    if (elements.batchApply) elements.batchApply.addEventListener("click", () => applyMarkup(elements.batchInput ? elements.batchInput.value : 0));
    if (elements.batchInput) elements.batchInput.addEventListener("keydown", (event) => { if (event.key === "Enter") applyMarkup(elements.batchInput.value); });
    if (elements.salesAddBtn) elements.salesAddBtn.addEventListener("click", openSalesPicker);
    const dupBtn = document.getElementById("salesDupBtn");
    if (dupBtn) dupBtn.addEventListener("click", addDuplicatesToSale);
    if (elements.salesShareBtn) elements.salesShareBtn.addEventListener("click", () => shareSales(elements.salesShareBtn));
    if (elements.salesExportBtn) elements.salesExportBtn.addEventListener("click", () => exportSalesImage(elements.salesExportBtn));
    if (elements.salesSort) {
      elements.salesSort.value = salesSort;
      elements.salesSort.addEventListener("change", () => {
        salesSort = elements.salesSort.value;
        localStorage.setItem("tcg-sales-sort", salesSort);
        render();
      });
    }
  }

  // Boot: liga os controles já (independem do catálogo) e carrega as cartas que
  // você tem dos dois jogos.
  bindEvents();
  // Cartas VENDIDAS já saíram da coleção, mas o histórico precisa delas no
  // catálogo — inclui os ids nos dois jogos (id de outro jogo é no-op no loader).
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
      if (elements.batchInput) { const mk = sales.getMarkup(); elements.batchInput.value = mk ? String(mk) : ""; }
      render();
      shared.publishProfile(cards, owned, prices); // republica o perfil público (vendas atualizadas)
    })
    .catch((error) => {
      if (elements.salesEmpty) { elements.salesEmpty.textContent = t("error.catalog", { message: error.message }); elements.salesEmpty.hidden = false; }
    });
})();
