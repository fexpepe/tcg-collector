(function () {
  const shared = window.TCGShared;
  const { escapeHtml, escapeAttribute, t, getLocale, detailUrl } = shared;

  let cards = [];
  let cardsById = new Map();
  const owned = shared.createCollectionStore();
  const wishlist = shared.createWishlistStore();
  const prices = shared.createPriceStore();

  const elements = {
    totalValue: document.getElementById("totalValue"),
    pricedCopies: document.getElementById("pricedCopies"),
    wishlistValue: document.getElementById("wishlistValue"),
    bindersValue: document.getElementById("bindersValue"),
    grandTotal: document.getElementById("grandTotal"),
    topCards: document.getElementById("topCards"),
    empty: document.getElementById("emptyState"),
    exportButton: document.getElementById("exportButton"),
    importInput: document.getElementById("importInput")
  };

  Promise.all([shared.loadCatalog(), shared.loadFxRates()])
    .then(([catalog]) => {
      cards = catalog.cards;
      cardsById = new Map(cards.map((card) => [card.id, card]));
      owned.migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId)));
      bindEvents();
      render();
    })
    .catch((error) => {
      elements.empty.textContent = t("error.catalog", { message: error.message });
      elements.empty.hidden = false;
    });

  function bindEvents() {
    shared.bindCollectionTransfer({
      exportButton: elements.exportButton,
      importInput: elements.importInput,
      store: owned,
      wishlist,
      prices,
      cards,
      onChange: () => render()
    });
  }

  // Tudo na moeda escolhida no header. O valor de cada carta sai do preço manual
  // (convertido) ou, na falta, da referência TCGdex (também convertida).
  function money(value) {
    return value > 0 ? shared.formatMoney(shared.getCurrency(), value) : shared.formatMoney(shared.getCurrency(), 0);
  }

  // Cada linha é um lote carta×variante×condição da coleção, com valor unitário
  // do preço registrado (ou referência TCGdex), na moeda escolhida.
  function collectionLines() {
    const lines = [];
    let totalCopies = 0;
    cards.forEach((card) => {
      const variants = card.variants && card.variants.length ? card.variants : [shared.defaultVariant(card)];
      variants.forEach((variant) => {
        owned.conditionBreakdown(card.id, variant).forEach(({ condition, quantity }) => {
          totalCopies += quantity;
          const val = shared.cardValue(card, variant, prices, condition);
          if (val.value > 0) {
            lines.push({ card, variant, condition, quantity, unit: val.value, total: val.value * quantity, estimated: val.estimated });
          }
        });
      });
    });
    return { lines, totalCopies };
  }

  function wishlistTotal() {
    let total = 0;
    cards.forEach((card) => {
      wishlist.variants(card.id).forEach((variant) => {
        total += shared.cardValue(card, variant, prices).value;
      });
    });
    return total;
  }

  // Valor de todos os binders (slots com carta do catálogo), na moeda escolhida.
  function bindersTotal() {
    let total = 0;
    try {
      const data = JSON.parse(localStorage.getItem("tcg-collector-binders-v1") || "null");
      const binders = data && Array.isArray(data.binders) ? data.binders : [];
      binders.forEach((binder) => (binder.slots || []).forEach((slot) => {
        if (slot && slot.cardId) total += shared.cardValue({ id: slot.cardId }, slot.variant || shared.DEFAULT_CONDITION, prices).value;
      }));
    } catch (error) { /* sem binders */ }
    return total;
  }

  function render() {
    const { lines, totalCopies } = collectionLines();
    const total = lines.reduce((sum, line) => sum + line.total, 0);
    const pricedCount = lines.reduce((sum, line) => sum + line.quantity, 0);

    const binders = bindersTotal();
    elements.totalValue.textContent = money(total);
    elements.pricedCopies.textContent = `${pricedCount}/${totalCopies}`;
    elements.wishlistValue.textContent = money(wishlistTotal());
    if (elements.bindersValue) elements.bindersValue.textContent = money(binders);
    if (elements.grandTotal) elements.grandTotal.textContent = money(total + binders);

    lines.sort((a, b) => b.total - a.total);
    const top = lines.slice(0, 15);

    elements.empty.hidden = top.length > 0;
    if (!top.length) {
      elements.topCards.innerHTML = "";
      return;
    }

    const rows = top.map((line) => {
      const name = `${line.card.name} · ${line.card.set} ${line.card.number}`;
      const unit = `${money(line.unit)}${line.estimated ? ` <span class="price-estimated" title="${escapeAttribute(t("portfolio.estimated"))}">≈</span>` : ""}`;
      const href = detailUrl("set", line.card.set);
      return `
        <tr>
          <td><a href="${escapeAttribute(href)}">${escapeHtml(name)}</a></td>
          <td>${escapeHtml(line.variant)}</td>
          <td>${escapeHtml(line.condition)}</td>
          <td class="num">${line.quantity}</td>
          <td class="num">${unit}</td>
          <td class="num"><strong>${money(line.total)}</strong></td>
        </tr>
      `;
    }).join("");

    elements.topCards.innerHTML = `
      <table class="portfolio-table">
        <thead>
          <tr>
            <th>${escapeHtml(t("portfolio.col.card"))}</th>
            <th>${escapeHtml(t("portfolio.col.variant"))}</th>
            <th>${escapeHtml(t("portfolio.col.condition"))}</th>
            <th class="num">${escapeHtml(t("portfolio.col.qty"))}</th>
            <th class="num">${escapeHtml(t("portfolio.col.unit"))}</th>
            <th class="num">${escapeHtml(t("portfolio.col.total"))}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }
})();
