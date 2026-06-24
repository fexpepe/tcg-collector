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
    empty: document.getElementById("emptyState")
  };

  // No HUB (apex) não há catálogo próprio. O portfólio COMBINADO soma os jogos a
  // partir do resumo que cada jogo grava num cookie .sleevu.app
  // (writePortfolioCookie): total por jogo + linha de valor, sem iframe nem
  // cross-origin. Jogo sem cookie ainda não teve o portfólio aberto -> atalho.
  if ((window.SLEEVU && window.SLEEVU.game) === "hub") {
    // Site único: o portfólio de cada jogo é a mesma página com ?game= (entra na
    // sessão daquele jogo). O combinado lê o resumo que cada jogo grava em cookie.
    const pfUrl = (g) => "portfolio.html?game=" + g;
    const readPf = (g) => {
      const m = document.cookie.match(new RegExp("(?:^|; )sleevu_pf_" + g + "=([^;]*)"));
      if (!m) return null;
      try { return JSON.parse(decodeURIComponent(m[1])); } catch (e) { return null; }
    };
    const fromBRL = (v) => { const r = shared.convertMoney(v, "BRL", shared.getCurrency()); return r == null ? v : r; };
    const COLORS = { pokemon: "#d9a300", lorcana: "#3f3d96" };
    const games = [
      { g: "pokemon", name: "Pokémon TCG", data: readPf("pokemon") },
      { g: "lorcana", name: "Disney Lorcana", data: readPf("lorcana") }
    ];
    games.forEach((x) => {
      x.color = COLORS[x.g];
      x.total = x.data ? fromBRL((x.data.c || 0) + (x.data.b || 0)) : null;
      x.pts = ((x.data && x.data.h) || []).map((p) => [p[0], fromBRL(p[1])]);
    });
    const combined = games.reduce((s, x) => s + (x.total || 0), 0);

    // Gráfico: uma linha por jogo (valor coleção+binders no tempo, moeda do header).
    const hubChart = () => {
      const withPts = games.filter((x) => x.pts && x.pts.length >= 2);
      if (!withPts.length) return "";
      const dates = Array.from(new Set([].concat.apply([], withPts.map((x) => x.pts.map((p) => p[0]))))).sort();
      if (dates.length < 2) return "";
      const allV = [].concat.apply([1], withPts.map((x) => x.pts.map((p) => p[1])));
      const maxV = Math.max.apply(null, allV);
      const W = 720, H = 200, P = 10;
      const X = (d) => P + (dates.indexOf(d) / (dates.length - 1)) * (W - 2 * P);
      const Y = (v) => H - P - (v / maxV) * (H - 2 * P);
      const lines = withPts.map((x) => {
        const pts = x.pts.map((p) => X(p[0]).toFixed(1) + "," + Y(p[1]).toFixed(1)).join(" ");
        return `<polyline points="${pts}" fill="none" stroke="${x.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
      }).join("");
      const legend = withPts.map((x) => `<span class="pf-hub-leg"><span class="pf-hub-dot" style="background:${x.color}"></span>${escapeHtml(x.name)}</span>`).join("");
      return `<div class="pf-hub-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${escapeAttribute(t("portfolio.hubChart"))}">${lines}</svg><div class="pf-hub-legend">${legend}</div></div>`;
    };

    const card = (x) => {
      const body = x.data
        ? `<span class="pf-hub-card-val">${money(x.total)}</span>`
        : `<span class="game-tile-desc">${escapeHtml(t("portfolio.hubVisit"))}</span>`;
      return `<li><a class="game-tile pf-hub-card" href="${escapeAttribute(pfUrl(x.g))}">`
        + `<span class="pf-hub-card-head"><span class="pf-hub-dot" style="background:${x.color}"></span>`
        + `<strong class="game-name">${escapeHtml(x.name)}</strong></span>${body}</a></li>`;
    };

    const main = document.querySelector("main");
    if (main) {
      main.innerHTML = `<div class="page-head"><h1>${escapeHtml(t("nav.portfolio"))}</h1></div>`
        + `<section class="pf-hub">`
        + `<div class="pf-hub-total"><span>${escapeHtml(t("portfolio.hubCombined"))}</span><strong>${money(combined)}</strong></div>`
        + `<ul class="home-games-grid pf-hub-games">${games.map(card).join("")}</ul>`
        + hubChart()
        + `<p class="portfolio-note">${escapeHtml(t("portfolio.hubNote"))}</p>`
        + `</section>`;
    }
    return;
  }

  Promise.all([shared.loadCatalog(), shared.loadFxRates()])
    .then(([catalog]) => {
      cards = catalog.cards;
      cardsById = new Map(cards.map((card) => [card.id, card]));
      owned.migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId)));
      render();
    })
    .catch((error) => {
      elements.empty.textContent = t("error.catalog", { message: error.message });
      elements.empty.hidden = false;
    });

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
            lines.push({ card, variant, condition, quantity, unit: val.value, total: val.value * quantity, estimated: val.estimated, source: val.source });
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
    const wish = wishlistTotal();
    elements.totalValue.textContent = money(total);
    elements.pricedCopies.textContent = `${pricedCount}/${totalCopies}`;
    elements.wishlistValue.textContent = money(wish);
    if (elements.bindersValue) elements.bindersValue.textContent = money(binders);
    if (elements.grandTotal) elements.grandTotal.textContent = money(total + binders);

    updateChart(total, binders, wish);

    lines.sort((a, b) => b.total - a.total);
    const top = lines.slice(0, 15);

    elements.empty.hidden = top.length > 0;
    if (!top.length) {
      elements.topCards.innerHTML = "";
      return;
    }

    const rows = top.map((line) => {
      const name = `${line.card.name} · ${line.card.set} ${line.card.number}`;
      const estTitle = line.source === "ref" ? t("portfolio.estRef")
        : line.source === "myp" ? t("portfolio.estMyp")
        : t("portfolio.estimated");
      const unit = `${money(line.unit)}${line.estimated ? ` <span class="price-estimated" title="${escapeAttribute(estTitle)}">≈</span>` : ""}`;
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

  // ---------------------------------------------------------------------------
  // Gráfico de progressão — snapshot diário (em BRL, moeda canônica) + SVG.
  // Não dá pra reconstruir o passado (não guardamos histórico de preços), então
  // a série começa hoje e cresce a cada visita/dia.
  // ---------------------------------------------------------------------------
  const HISTORY_KEY = shared.gameKey("history-v1");
  const SERIES = {
    combined: { color: "#34d399", get: (p) => (p.c || 0) + (p.b || 0) },
    collection: { color: "#2dd4bf", get: (p) => p.c || 0 },
    binders: { color: "#a78bfa", get: (p) => p.b || 0 },
    wishlist: { color: "#f5a524", get: (p) => p.w || 0 }
  };
  const SERIES_ORDER = ["combined", "collection", "binders", "wishlist"];
  const RANGES = [["1d", 1], ["7d", 7], ["1m", 30], ["3m", 90], ["6m", 180], ["max", 1e9]];
  let activeSeries = new Set(["combined"]);
  let activeRange = "1m";
  let controlsBound = false;

  const toBRL = (v) => { const r = shared.convertMoney(v, shared.getCurrency(), "BRL"); return r == null ? v : Math.round(r * 100) / 100; };
  const fromBRL = (v) => { const r = shared.convertMoney(v, "BRL", shared.getCurrency()); return r == null ? v : r; };
  function loadHistory() {
    try { const a = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  // Grava (ou substitui) o ponto de hoje. Valores em BRL pra não derreter com câmbio.
  function recordSnapshot(collection, binders, wishlist) {
    const hist = loadHistory();
    const d = new Date().toISOString().slice(0, 10);
    const point = { d, c: toBRL(collection), b: toBRL(binders), w: toBRL(wishlist) };
    if (hist.length && hist[hist.length - 1].d === d) hist[hist.length - 1] = point;
    else hist.push(point);
    if (hist.length > 800) hist.splice(0, hist.length - 800);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(hist)); } catch (e) { /* storage cheio: ignora */ }
    return hist;
  }

  function updateChart(collection, binders, wishlist) {
    const section = document.getElementById("portfolioChart");
    if (!section) return;
    section.hidden = false;
    const hist = recordSnapshot(collection, binders, wishlist);
    writePortfolioCookie(hist);
    if (!controlsBound) { bindControls(); controlsBound = true; }
    renderControls();
    renderChart(hist);
  }

  // Espelha o resumo do portfólio deste jogo num cookie de domínio .sleevu.app,
  // pro HUB (apex) somar todos os jogos sem precisar de iframe/cross-origin.
  // Valores em BRL (canônico); histórico compacto (combinado c+b, últimos pontos).
  function writePortfolioCookie(hist) {
    const g = (window.SLEEVU && window.SLEEVU.game) || "pokemon";
    if (g === "hub") return;
    const last = hist[hist.length - 1] || {};
    const h = hist.slice(-50).map((p) => [p.d, Math.round(((p.c || 0) + (p.b || 0)) * 100) / 100]);
    const payload = { c: last.c || 0, b: last.b || 0, w: last.w || 0, ts: Date.now(), h: h };
    try {
      let c = "sleevu_pf_" + g + "=" + encodeURIComponent(JSON.stringify(payload)) + "; Path=/; Max-Age=" + (180 * 24 * 3600) + "; SameSite=Lax";
      if (/(^|\.)sleevu\.app$/i.test(location.hostname)) c += "; Secure; Domain=.sleevu.app";
      document.cookie = c;
    } catch (e) { /* ignora */ }
  }

  // Listeners uma vez só (senão empilham a cada renderControls e o toggle dispara
  // múltiplas vezes). Delegação no container; o innerHTML pode ser recriado à vontade.
  function bindControls() {
    const seriesEl = document.getElementById("pfSeries");
    const rangeEl = document.getElementById("pfRanges");
    if (seriesEl) seriesEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-series]"); if (!b) return;
      const k = b.dataset.series;
      if (activeSeries.has(k)) { if (activeSeries.size > 1) activeSeries.delete(k); } else activeSeries.add(k);
      renderControls(); renderChart(loadHistory());
    });
    if (rangeEl) rangeEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-range]"); if (!b) return;
      activeRange = b.dataset.range;
      renderControls(); renderChart(loadHistory());
    });
  }

  function renderControls() {
    const seriesEl = document.getElementById("pfSeries");
    const rangeEl = document.getElementById("pfRanges");
    if (seriesEl) seriesEl.innerHTML = SERIES_ORDER.map((k) =>
      `<button type="button" class="pf-series-chip${activeSeries.has(k) ? " active" : ""}" data-series="${k}" style="--pf-color:${SERIES[k].color}">
         <span class="pf-dot"></span>${escapeHtml(t(`portfolio.series.${k}`))}
       </button>`).join("");
    if (rangeEl) rangeEl.innerHTML = RANGES.map(([k]) =>
      `<button type="button" class="pf-range-btn${k === activeRange ? " active" : ""}" data-range="${k}">${escapeHtml(t(`portfolio.range.${k}`))}</button>`).join("");
  }

  function renderChart(history) {
    const body = document.getElementById("pfChartBody");
    if (!body) return;
    const days = (RANGES.find((r) => r[0] === activeRange) || ["1m", 30])[1];
    const cutoff = Date.now() - days * 86400000;
    const pts = days >= 1e9 ? history.slice() : history.filter((p) => new Date(p.d + "T00:00:00").getTime() >= cutoff);
    if (pts.length < 2) {
      body.innerHTML = `<p class="pf-chart-empty">${escapeHtml(t("portfolio.chart.startsToday"))}</p>`;
      return;
    }
    const active = SERIES_ORDER.filter((k) => activeSeries.has(k));
    const W = 820, H = 240, PL = 6, PR = 6, PT = 12, PB = 20;
    let yMin = Infinity, yMax = -Infinity;
    pts.forEach((p) => active.forEach((k) => { const v = fromBRL(SERIES[k].get(p)); if (v < yMin) yMin = v; if (v > yMax) yMax = v; }));
    if (!isFinite(yMin)) { yMin = 0; yMax = 1; }
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const padY = (yMax - yMin) * 0.12; yMin -= padY; yMax += padY;
    const plotW = W - PL - PR, plotH = H - PT - PB;
    const X = (i) => PL + (pts.length === 1 ? plotW / 2 : (i / (pts.length - 1)) * plotW);
    const Y = (v) => PT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
    const loc = getLocale();
    let grid = "";
    for (let g = 0; g <= 3; g++) {
      const v = yMin + (g / 3) * (yMax - yMin), y = Y(v);
      grid += `<line class="pf-grid" x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}"/>`;
      grid += `<text class="pf-axis" x="${PL + 2}" y="${(y - 4).toFixed(1)}">${escapeHtml(Math.round(v).toLocaleString(loc))}</text>`;
    }
    let lines = "";
    active.forEach((k) => {
      const path = pts.map((p, i) => `${X(i).toFixed(1)},${Y(fromBRL(SERIES[k].get(p))).toFixed(1)}`).join(" ");
      const lastV = Y(fromBRL(SERIES[k].get(pts[pts.length - 1])));
      lines += `<polyline class="pf-line" points="${path}" stroke="${SERIES[k].color}"/>`;
      lines += `<circle cx="${X(pts.length - 1).toFixed(1)}" cy="${lastV.toFixed(1)}" r="3.5" fill="${SERIES[k].color}"/>`;
    });
    body.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="pf-svg" role="img" aria-label="${escapeAttribute(t("portfolio.chart.title"))}">${grid}${lines}</svg>`;
  }
})();
