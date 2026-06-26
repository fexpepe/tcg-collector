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
  const ownedByGame = { pokemon: shared.createCollectionStore("pokemon"), lorcana: shared.createCollectionStore("lorcana") };
  const wishlistByGame = { pokemon: shared.createWishlistStore("pokemon"), lorcana: shared.createWishlistStore("lorcana") };
  const pricesByGame = { pokemon: shared.createPriceStore("pokemon"), lorcana: shared.createPriceStore("lorcana") };
  const cardGameMap = new Map();
  const gameOf = (id) => cardGameMap.get(id) || "pokemon";
  const owned = shared.mergedCollectionStore(ownedByGame, gameOf);
  const wishlist = shared.mergedWishlistStore(wishlistByGame, gameOf);
  const prices = shared.mergedPriceStore(pricesByGame, gameOf);

  // Vendas: cartas à venda, cada uma com um PREÇO DE VENDA + condição. Global
  // cross-game, por cardId|variant. Local + sync (carimba updatedAt p/ merge LWW).
  const sales = createSalesStore();
  function createSalesStore() {
    const KEY = "tcg-collector-collection-sales-v1";
    let data = { sales: {}, order: [], updatedAt: 0 };
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (raw && raw.sales && typeof raw.sales === "object") data = raw;
    } catch (e) { /* corrompido: começa vazio */ }
    if (!Array.isArray(data.order)) data.order = [];
    const save = () => { data.updatedAt = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* quota: ignora */ } };
    const keyOf = (cardId, variant) => `${cardId}|${variant}`;
    return {
      has: (cardId, variant) => !!data.sales[keyOf(cardId, variant)],
      priceOf: (cardId, variant) => { const e = data.sales[keyOf(cardId, variant)]; return e ? (Number(e.price) || 0) : 0; },
      condOf: (cardId, variant) => { const e = data.sales[keyOf(cardId, variant)]; return (e && e.cond) || "NM"; },
      any: () => Object.keys(data.sales).length > 0,
      // Itens na ordem do usuário (só os que ainda existem).
      list: () => data.order.filter((k) => data.sales[k]).map((k) => {
        const i = k.indexOf("|"); return { key: k, cardId: k.slice(0, i), variant: k.slice(i + 1), price: Number(data.sales[k].price) || 0, cond: data.sales[k].cond || "NM" };
      }),
      add(cardId, variant) { const k = keyOf(cardId, variant); if (!data.sales[k]) { data.sales[k] = { price: 0, cond: "NM" }; data.order.push(k); save(); } },
      setPrice(cardId, variant, price) {
        const k = keyOf(cardId, variant), p = Number(price) || 0, cond = (data.sales[k] && data.sales[k].cond) || "NM";
        // Preço vazio/0 numa carta JÁ na venda = tira da venda; senão atualiza/insere (preservando a condição).
        if (p <= 0 && data.sales[k]) { delete data.sales[k]; data.order = data.order.filter((x) => x !== k); }
        else if (p > 0) { if (!data.sales[k]) data.order.push(k); data.sales[k] = { price: Math.round(p * 100) / 100, cond }; }
        save();
      },
      setCond(cardId, variant, cond) { const k = keyOf(cardId, variant); if (data.sales[k]) { data.sales[k].cond = cond; save(); } },
      remove(cardId, variant) { const k = keyOf(cardId, variant); if (data.sales[k]) { delete data.sales[k]; data.order = data.order.filter((x) => x !== k); save(); } }
    };
  }

  const elements = {
    gameFilter: document.getElementById("gameFilter"),
    grid,
    salesEmpty: document.getElementById("salesEmpty"),
    salesAddBtn: document.getElementById("salesAddBtn"),
    salesShareBtn: document.getElementById("salesShareBtn"),
    salesExportBtn: document.getElementById("salesExportBtn"),
    dashboard: document.getElementById("salesDashboard"),
    dashValue: document.getElementById("salesDashValue"),
    dashCount: document.getElementById("salesDashCount"),
    dashTopList: document.getElementById("salesDashTop"),
    dashDist: document.getElementById("salesDashDist")
  };

  const preview = shared.createCardPreview({
    getCard: (cardId) => cardsById.get(cardId),
    store: owned,
    prices,
    wishlist,
    // Campo "Vender por R$" no preview (põe/tira a carta da lista de vendas).
    sale: {
      priceOf: (cardId, variant) => sales.priceOf(cardId, variant),
      onChange: (cardId, variant, price) => { sales.setPrice(cardId, variant, price); render(); }
    }
  });

  function inGameFilter(card) { return gameFilter === "all" || card.game === gameFilter; }

  // Símbolo da moeda atual (R$/$/€…) extraído do formatMoney.
  function currencySymbol() {
    return shared.formatMoney(shared.getCurrency(), 0).replace(/[\d.,\s ]/g, "") || shared.getCurrency();
  }

  function distBarsHtml(rows) {
    const shown = rows.filter((r) => r.n > 0);
    if (!shown.length) return `<p class="dash-empty">${escapeHtml(t("dash.empty"))}</p>`;
    const max = Math.max(1, ...shown.map((r) => r.n));
    return shown.map((r) => `<div class="dash-dist-row">
        <span class="dash-dist-label">${r.label}</span>
        <span class="dash-dist-track"><span class="dash-dist-fill" style="width:${Math.round((r.n / max) * 100)}%;background:${r.color}"></span></span>
        <span class="dash-dist-n">${r.n}</span>
      </div>`).join("");
  }

  // Itens à venda (já resolvidos pra carta) respeitando o filtro de jogo.
  function saleItems() {
    return sales.list()
      .map((it) => ({ it, card: cardsById.get(it.cardId) }))
      .filter((x) => x.card && inGameFilter(x.card));
  }

  function render() {
    renderDashboard();
    renderSales();
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
    elements.dashDist.innerHTML = distBarsHtml([
      { label: t("filter.gamePokemon"), n: byGame.pokemon || 0, color: "#d9a300" },
      { label: t("filter.gameLorcana"), n: byGame.lorcana || 0, color: "#3f3d96" }
    ]);
  }

  function renderSales() {
    const items = saleItems();
    elements.salesEmpty.hidden = items.length > 0;
    const sym = currencySymbol();
    elements.grid.innerHTML = items.map(({ it, card }) => saleTileHtml(card, it.variant, it.price, sym, it.cond)).join("");
    const hasPriced = items.some((x) => x.it.price > 0);
    if (elements.salesShareBtn) elements.salesShareBtn.disabled = !hasPriced;
    if (elements.salesExportBtn) elements.salesExportBtn.disabled = !hasPriced;
  }

  // Tile de venda: imagem (→ preview) + campo de preço editável + condição + ✕ remover.
  function saleTileHtml(card, variant, price, sym, cond) {
    const src = shared.cardImageSources(card);
    const img = shared.localizedImg(src.url, { alt: card.name, fallback: src.fallback, loading: "lazy", thumb: true });
    const priceStr = price > 0 ? String(price).replace(".", ",") : "";
    const current = cond || "NM";
    const condOpts = shared.CARD_CONDITIONS.map((c) => `<option value="${c}"${c === current ? " selected" : ""}>${c}</option>`).join("");
    return `<article class="card-tile sale-tile" data-sale-card="${escapeAttribute(card.id)}" data-sale-variant="${escapeAttribute(variant)}">
      <div class="card-image">
        <button type="button" class="image-open" data-preview-card-id="${escapeAttribute(card.id)}" data-preview-variant="${escapeAttribute(variant)}" aria-label="${escapeAttribute(t("card.zoom", { name: card.name }))}">${img}</button>
        <button type="button" class="sale-remove" data-sale-remove title="${escapeAttribute(t("sales.remove"))}" aria-label="${escapeAttribute(t("sales.remove"))}">✕</button>
      </div>
      <div class="tile-info">
        <h3>${escapeHtml(card.name)}</h3>
        <p class="tile-variant">${shared.cardFlag(card.language)}<span>${escapeHtml(variant)}</span></p>
        <div class="sale-fields">
          <label class="sale-price-field"><span class="sale-cur">${escapeHtml(sym)}</span><input type="text" inputmode="decimal" class="sale-price" data-sale-price value="${escapeAttribute(priceStr)}" placeholder="0,00"></label>
          <select class="sale-cond" data-sale-cond aria-label="${escapeAttribute(t("sales.condition"))}" title="${escapeAttribute(t("sales.condition"))}">${condOpts}</select>
        </div>
      </div>
    </article>`;
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
      const html = pairs.map(({ card, variant }) => {
        const src = shared.cardImageSources(card);
        const img = shared.localizedImg(src.url, { alt: card.name, fallback: src.fallback, loading: "lazy", thumb: true });
        return `<div class="sales-pick${sales.has(card.id, variant) ? " is-added" : ""}" role="button" tabindex="0" data-pick-card="${escapeAttribute(card.id)}" data-pick-variant="${escapeAttribute(variant)}">
          <span class="sales-pick-img">${img}<span class="sales-pick-check">✓</span></span>
          <span class="sales-pick-name">${escapeHtml(card.name)}</span>
          <span class="sales-pick-var">${shared.cardFlag(card.language)}<span>${escapeHtml(variant)}</span></span>
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
            <button type="button" class="chip" data-pick-game="pokemon" aria-pressed="${pickGame === "pokemon"}">${escapeHtml(t("filter.gamePokemon"))}</button>
            <button type="button" class="chip" data-pick-game="lorcana" aria-pressed="${pickGame === "lorcana"}">${escapeHtml(t("filter.gameLorcana"))}</button>
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
        if (sales.has(id, v)) { sales.remove(id, v); pick.classList.remove("is-added"); }
        else { sales.add(id, v); pick.classList.add("is-added"); }
        updateCount();
      }
    });
  }

  // Itens das cartas à venda pro share — cada um leva o preço de venda (sp), a
  // condição (cond) e a moeda (cur). A view ?s= (somente leitura) vive na
  // collection.html, então o link aponta pra lá.
  function buildSaleShareData() {
    const cur = shared.getCurrency();
    const items = [];
    sales.list().forEach(({ cardId, variant, price, cond }) => {
      if (price <= 0) return;
      const card = cardsById.get(cardId);
      if (!card) return;
      const src = shared.cardImageSources(card);
      items.push({
        id: card.id, n: card.name, s: card.set, num: card.number, lang: card.language,
        g: card.game, v: variant, q: 1, sp: price, cond: cond || "NM", cur, img: src.url, fb: src.fallback || ""
      });
    });
    return { items, scope: "sale", cur };
  }

  async function shareSales(btn) {
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
      let img = await loadImage(bust(src.url), true);
      if (!img && src.fallback) img = await loadImage(bust(src.fallback), true);
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
      ctx.fillStyle = "#111111"; ctx.font = `800 26px ${FONT}`; ctx.textAlign = "left";
      ctx.fillText(`${sym} ${it.price.toFixed(2).replace(".", ",")}`, x + 2, by + 27, CARD_W - chipW - 12);
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
      const rm = event.target.closest("[data-sale-remove]");
      if (rm) { const tile = rm.closest(".sale-tile"); if (tile) { sales.remove(tile.dataset.saleCard, tile.dataset.saleVariant); render(); } }
    });
    // Editar preço / condição inline
    elements.grid.addEventListener("change", (event) => {
      const condSel = event.target.closest("[data-sale-cond]");
      if (condSel) {
        const tile = condSel.closest(".sale-tile");
        if (tile) sales.setCond(tile.dataset.saleCard, tile.dataset.saleVariant, condSel.value);
        return;
      }
      const input = event.target.closest("[data-sale-price]");
      if (!input) return;
      const tile = input.closest(".sale-tile");
      if (!tile) return;
      const text = String(input.value).trim();
      const amount = Number(text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text) || 0;
      sales.setPrice(tile.dataset.saleCard, tile.dataset.saleVariant, amount);
      render(); // o tile pode sumir (preço 0) e o dashboard muda
    });
    if (elements.salesAddBtn) elements.salesAddBtn.addEventListener("click", openSalesPicker);
    if (elements.salesShareBtn) elements.salesShareBtn.addEventListener("click", () => shareSales(elements.salesShareBtn));
    if (elements.salesExportBtn) elements.salesExportBtn.addEventListener("click", () => exportSalesImage(elements.salesExportBtn));
  }

  // Boot: liga os controles já (independem do catálogo) e carrega as cartas que
  // você tem dos dois jogos.
  bindEvents();
  Promise.all([
    shared.loadOwnedAcrossGames({
      pokemon: ownedByGame.pokemon.knownCardIds(),
      lorcana: ownedByGame.lorcana.knownCardIds()
    }),
    shared.loadFxRates()
  ])
    .then(([catalog]) => {
      cards = catalog.cards;
      cards.forEach((card) => cardGameMap.set(card.id, card.game));
      cardsById = new Map(cards.map((card) => [card.id, card]));
      Object.keys(ownedByGame).forEach((g) =>
        ownedByGame[g].migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId))));
      render();
    })
    .catch((error) => {
      if (elements.salesEmpty) { elements.salesEmpty.textContent = t("error.catalog", { message: error.message }); elements.salesEmpty.hidden = false; }
    });
})();
