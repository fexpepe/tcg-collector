(function () {
  const shared = window.TCGShared;
  const { escapeHtml, escapeAttribute, t, getLocale, detailUrl } = shared;

  // Tudo na moeda escolhida no header.
  function money(value) {
    return shared.formatMoney(shared.getCurrency(), value > 0 ? value : 0);
  }

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
    const COLORS = { pokemon: "#e23030", lorcana: "#3f3d96" };
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

    // Gráfico: uma linha por jogo (valor coleção+graded no tempo, moeda do header).
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

  // ===========================================================================
  // Portfólio por jogo (não-hub): visão FINANCEIRA da Minha Coleção. O total tem
  // que BATER com a Coleção -> mesma fonte e mesma fórmula:
  //   patrimônio = cartas raw (todos os jogos) + slabs graded.
  // Binders e wishlist são VISÕES (filtros), não somam ao patrimônio.
  // Coleção unificada igual à collection.js (stores por jogo + facades).
  // ===========================================================================
  const GAMES = ["pokemon", "lorcana"];
  const GAME_COLOR = { pokemon: "#e23030", lorcana: "#3f3d96" };
  const ownedByGame = { pokemon: shared.createCollectionStore("pokemon"), lorcana: shared.createCollectionStore("lorcana") };
  const wishlistByGame = { pokemon: shared.createWishlistStore("pokemon"), lorcana: shared.createWishlistStore("lorcana") };
  const pricesByGame = { pokemon: shared.createPriceStore("pokemon"), lorcana: shared.createPriceStore("lorcana") };
  const cardGameMap = new Map();
  const gameOf = (id) => cardGameMap.get(id) || "pokemon";
  const owned = shared.mergedCollectionStore(ownedByGame, gameOf);
  const wishlist = shared.mergedWishlistStore(wishlistByGame, gameOf);
  const prices = shared.mergedPriceStore(pricesByGame, gameOf);
  // Modo investidor (opcional): custo pago por carta + vendas realizadas.
  const costsStore = shared.createCostsStore();
  const soldStore = shared.createSoldStore();

  let cards = [];
  let cardsById = new Map();
  let gameFilter = "all";
  let breakdownMode = "set"; // set | rarity

  const elements = {
    grandTotal: document.getElementById("grandTotal"),
    rawValue: document.getElementById("rawValue"),
    gradedValue: document.getElementById("gradedValue"),
    pricedCopies: document.getElementById("pricedCopies"),
    wishlistValue: document.getElementById("wishlistValue"),
    composition: document.getElementById("pfComposition"),
    breakdown: document.getElementById("pfBreakdown"),
    breakdownTabs: document.getElementById("pfBreakdownTabs"),
    breakdownBody: document.getElementById("pfBreakdownBody"),
    gameFilter: document.getElementById("pfGameFilter"),
    topCards: document.getElementById("topCards"),
    empty: document.getElementById("emptyState")
  };

  const inGameId = (g) => gameFilter === "all" || (g || "pokemon") === gameFilter;

  // Maiores altas/quedas do MERCADO (price-movers do build semanal). Busca antes
  // do catálogo pra incluir os ids dos movers no carregamento (podem não ser seus).
  const moversByGame = { pokemon: null, lorcana: null };
  const fetchMovers = (dir) => fetch(dir + "price-movers.generated.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);

  Promise.all([fetchMovers("data/"), fetchMovers("data/lorcana/")])
    .then(([pk, lc]) => {
      moversByGame.pokemon = pk; moversByGame.lorcana = lc;
      const idsOf = (m) => m ? (m.up || []).concat(m.down || []).map((x) => x.id) : [];
      return Promise.all([
        shared.loadOwnedAcrossGames({
          pokemon: ownedByGame.pokemon.knownCardIds().concat(idsOf(pk)),
          lorcana: ownedByGame.lorcana.knownCardIds().concat(idsOf(lc))
        }),
        shared.loadFxRates()
      ]);
    })
    .then(([catalog]) => {
      cards = catalog.cards;
      cards.forEach((card) => cardGameMap.set(card.id, card.game));
      cardsById = new Map(cards.map((card) => [card.id, card]));
      GAMES.forEach((g) => ownedByGame[g].migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId))));
      bindGameFilter();
      bindBreakdown();
      render();
    })
    .catch((error) => {
      elements.empty.textContent = t("error.catalog", { message: error.message });
      elements.empty.hidden = false;
    });

  function bindGameFilter() {
    if (!elements.gameFilter) return;
    elements.gameFilter.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-pf-game]");
      if (!chip || chip.dataset.pfGame === gameFilter) return;
      gameFilter = chip.dataset.pfGame;
      Array.from(elements.gameFilter.children).forEach((node) =>
        node.setAttribute("aria-pressed", String(node === chip)));
      shared.applyGameAccent(gameFilter);
      render();
    });
  }

  function bindBreakdown() {
    if (!elements.breakdownTabs) return;
    elements.breakdownTabs.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-bd]");
      if (!tab || tab.dataset.bd === breakdownMode) return;
      breakdownMode = tab.dataset.bd;
      Array.from(elements.breakdownTabs.children).forEach((node) =>
        node.classList.toggle("active", node === tab));
      render();
    });
  }

  // ---- Fontes de valor (moeda atual), filtráveis por jogo --------------------

  // Cada linha é um lote carta×variante×condição da coleção, com valor unitário.
  function collectionLines(gf) {
    const lines = [];
    let totalCopies = 0, pricedCopies = 0;
    cards.forEach((card) => {
      if (gf && gf !== "all" && card.game !== gf) return;
      const variants = card.variants && card.variants.length ? card.variants : [shared.defaultVariant(card)];
      variants.forEach((variant) => {
        owned.conditionBreakdown(card.id, variant).forEach(({ condition, quantity }) => {
          totalCopies += quantity;
          const val = shared.cardValue(card, variant, prices, condition);
          if (val.value > 0) {
            pricedCopies += quantity;
            lines.push({ card, variant, condition, quantity, unit: val.value, total: val.value * quantity, estimated: val.estimated, source: val.source });
          }
        });
      });
    });
    return { lines, totalCopies, pricedCopies };
  }

  function gradedSlabs(gf) {
    return shared.gradedSlabsValued(gameOf).filter((s) => !gf || gf === "all" || s.game === gf);
  }

  function wishlistTotal(gf) {
    let total = 0;
    cards.forEach((card) => {
      if (gf && gf !== "all" && card.game !== gf) return;
      wishlist.variants(card.id).forEach((variant) => { total += shared.cardValue(card, variant, prices).value; });
    });
    return total;
  }

  // "Desejos do binder": slots de cartas que você NÃO tem (faltantes), por jogo.
  function binderWishTotal(gf) {
    let total = 0;
    try {
      const data = JSON.parse(localStorage.getItem("tcg-collector-binders-v1") || "null");
      const binders = data && Array.isArray(data.binders) ? data.binders : [];
      binders.forEach((binder) => (binder.slots || []).forEach((slot) => {
        if (!slot || !slot.cardId) return;
        if (owned.has(slot.cardId)) return; // já é da coleção -> não é desejo
        if (gf && gf !== "all" && gameOf(slot.cardId) !== gf) return;
        total += shared.cardValue({ id: slot.cardId }, slot.variant || shared.DEFAULT_CONDITION, prices).value;
      }));
    } catch (error) { /* sem binders */ }
    return total;
  }

  // ---- Render ---------------------------------------------------------------

  function render() {
    const { lines, totalCopies, pricedCopies } = collectionLines(gameFilter);
    const rawTotal = lines.reduce((sum, line) => sum + line.total, 0);
    const slabs = gradedSlabs(gameFilter);
    const gradedTotal = slabs.reduce((sum, s) => sum + (s.value || 0), 0);
    const networth = rawTotal + gradedTotal;
    const wish = wishlistTotal(gameFilter) + binderWishTotal(gameFilter);

    if (elements.grandTotal) elements.grandTotal.textContent = money(networth);
    if (elements.rawValue) elements.rawValue.textContent = money(rawTotal);
    if (elements.gradedValue) elements.gradedValue.textContent = money(gradedTotal);
    if (elements.pricedCopies) elements.pricedCopies.textContent = `${pricedCopies}/${totalCopies}`;
    if (elements.wishlistValue) elements.wishlistValue.textContent = money(wish);

    renderComposition(rawTotal, gradedTotal);
    renderBreakdown(lines, slabs);
    renderInvest();
    renderMovers();
    renderTop(lines, slabs);
    updateChart();
  }

  // Maiores altas e quedas da semana (mercado — do histórico de preços do build).
  // Só aparece quando há >= 2 snapshots (a partir da 2ª semana no ar).
  function renderMovers() {
    const sec = document.getElementById("pfMovers");
    if (!sec) return;
    const pool = gameFilter === "all" ? ["pokemon", "lorcana"] : [gameFilter];
    let up = [], down = [], from = null;
    pool.forEach((g) => {
      const m = moversByGame[g];
      if (!m) return;
      if (m.from) from = from || m.from;
      up = up.concat(m.up || []); down = down.concat(m.down || []);
    });
    const resolve = (arr) => arr
      .map((x) => ({ x, card: cardsById.get(x.id) }))
      .filter((r) => r.card)
      .sort((a, b) => Math.abs(b.x.pct) - Math.abs(a.x.pct))
      .slice(0, 8);
    const ups = resolve(up), downs = resolve(down);
    if (!ups.length && !downs.length) { sec.hidden = true; sec.innerHTML = ""; return; }
    const loc = getLocale();
    const row = ({ x, card }) => {
      const src = shared.cardImageSources(card);
      const thumb = shared.localizedImg(src.url, { alt: "", fallback: src.fallback, loading: "lazy", thumb: true });
      const ownedTag = owned.has(card.id) ? `<span class="pf-mover-owned">${escapeHtml(t("portfolio.movers.owned"))}</span>` : "";
      const pct = `${x.pct > 0 ? "+" : "−"}${Math.abs(x.pct).toLocaleString(loc, { maximumFractionDigits: 1 })}%`;
      return `<a class="pf-mover" href="${escapeAttribute(detailUrl("set", card.set))}">
        <span class="pf-mover-thumb">${thumb}</span>
        <span class="pf-mover-info"><strong>${escapeHtml(card.name)}</strong><span>${escapeHtml(card.set)} · ${escapeHtml(card.number)}</span>${ownedTag}</span>
        <span class="pf-mover-pct ${x.pct > 0 ? "is-up" : "is-down"}">${x.pct > 0 ? "▲" : "▼"} ${escapeHtml(pct)}</span>
      </a>`;
    };
    const col = (title, arr) => arr.length ? `<div class="pf-movers-col"><h3>${escapeHtml(title)}</h3>${arr.map(row).join("")}</div>` : "";
    sec.innerHTML = `<h2 class="pf-invest-title">${escapeHtml(t("portfolio.movers.title"))}${from ? ` <span class="pf-movers-since">${escapeHtml(t("market.deltaSince", { date: from }))}</span>` : ""}</h2>
      <div class="pf-movers-grid">${col(t("portfolio.movers.up"), ups)}${col(t("portfolio.movers.down"), downs)}</div>`;
    sec.hidden = false;
  }

  // --- Investimento (opcional): só aparece pra quem preenche custo ou vende ---
  // Posições = cartas COM custo que você ainda tem: pago (unitário × qtd) vs
  // valor atual, com lucro/prejuízo não realizado. Vendas realizadas entram como
  // resultado REALIZADO (vendido − pago; só registros com custo contam no P&L).
  function renderInvest() {
    const sec = document.getElementById("pfInvest");
    if (!sec) return;
    const inG = (id) => gameFilter === "all" || gameOf(id) === gameFilter;
    // Posições abertas (custo preenchido + ainda na coleção).
    const positions = [];
    let invested = 0, currentTotal = 0;
    costsStore.entries().forEach((e) => {
      if (!inG(e.cardId)) return;
      const card = cardsById.get(e.cardId);
      const qty = owned.variantTotal(e.cardId, e.variant);
      if (!card || qty <= 0) return;
      const paidUnit = shared.moneyToCurrent(e.v, e.cur);
      let now = 0;
      owned.conditionBreakdown(e.cardId, e.variant).forEach(({ condition, quantity }) => {
        now += (shared.cardValue(card, e.variant, prices, condition).value || 0) * quantity;
      });
      const paid = paidUnit * qty;
      positions.push({ card, variant: e.variant, qty, paid, now, delta: now - paid });
      invested += paid; currentTotal += now;
    });
    // Realizado (vendas): total vendido + resultado das que têm custo.
    const soldItems = soldStore.list().filter((it) => inG(it.cardId));
    let soldTotal = 0, realized = 0, realizedCount = 0;
    soldItems.forEach((it) => {
      const price = shared.moneyToCurrent(it.price, it.cur);
      soldTotal += price;
      if (it.paid > 0) { realized += price - shared.moneyToCurrent(it.paid, it.cur); realizedCount++; }
    });
    if (!positions.length && !soldItems.length) { sec.hidden = true; sec.innerHTML = ""; return; }

    const unreal = currentTotal - invested;
    const pct = invested > 0 ? (unreal / invested) * 100 : 0;
    const sign = (v) => (v >= 0 ? "+" : "−");
    const cls = (v) => (v > 0.005 ? "is-up" : (v < -0.005 ? "is-down" : ""));
    const statCard = (label, value, extra, klass) =>
      `<article class="pf-insight ${klass || ""}"><span class="pf-insight-label">${escapeHtml(label)}</span>
        <span class="pf-insight-pct">${value}</span>${extra ? `<span class="pf-insight-abs">${extra}</span>` : ""}</article>`;
    let html = `<h2 class="pf-invest-title">${escapeHtml(t("portfolio.invest.title"))}</h2><div class="pf-insights">`;
    if (positions.length) {
      html += statCard(t("portfolio.invest.paid"), escapeHtml(money(invested)));
      html += statCard(t("portfolio.invest.now"), escapeHtml(money(currentTotal)));
      html += statCard(t("portfolio.invest.unreal"),
        `${sign(unreal)}${escapeHtml(money(Math.abs(unreal)))}`,
        `${sign(unreal)}${Math.abs(pct).toFixed(1)}%`, `pf-insight-${cls(unreal) === "is-up" ? "up" : cls(unreal) === "is-down" ? "down" : "flat"}`);
    }
    if (soldItems.length) {
      html += statCard(t("portfolio.invest.soldTotal"), escapeHtml(money(soldTotal)), escapeHtml(t("portfolio.invest.soldCount", { n: soldItems.length })));
      if (realizedCount) html += statCard(t("portfolio.invest.realized"),
        `${sign(realized)}${escapeHtml(money(Math.abs(realized)))}`,
        escapeHtml(t("portfolio.invest.realizedNote", { n: realizedCount })), `pf-insight-${realized >= 0 ? "up" : "down"}`);
    }
    html += `</div>`;
    if (positions.length) {
      positions.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      const rows = positions.slice(0, 12).map((p) => {
        const dPct = p.paid > 0 ? (p.delta / p.paid) * 100 : 0;
        return `<tr>
          <td><a href="${escapeAttribute(detailUrl("set", p.card.set))}">${escapeHtml(`${p.card.name} · ${p.card.set} ${p.card.number}`)}</a></td>
          <td>${escapeHtml(p.variant)}</td>
          <td class="num">${p.qty}</td>
          <td class="num">${escapeHtml(money(p.paid))}</td>
          <td class="num">${escapeHtml(money(p.now))}</td>
          <td class="num pf-pnl ${cls(p.delta)}"><strong>${sign(p.delta)}${escapeHtml(money(Math.abs(p.delta)))}</strong> <span class="pf-pnl-pct">${sign(p.delta)}${Math.abs(dPct).toFixed(0)}%</span></td>
        </tr>`;
      }).join("");
      html += `<div class="portfolio-table-wrap"><table class="portfolio-table">
        <thead><tr>
          <th>${escapeHtml(t("portfolio.col.card"))}</th><th>${escapeHtml(t("portfolio.col.variant"))}</th>
          <th class="num">${escapeHtml(t("portfolio.col.qty"))}</th>
          <th class="num">${escapeHtml(t("portfolio.invest.col.paid"))}</th>
          <th class="num">${escapeHtml(t("portfolio.invest.col.now"))}</th>
          <th class="num">${escapeHtml(t("portfolio.invest.col.delta"))}</th>
        </tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    sec.innerHTML = html;
    sec.hidden = false;
  }

  // Agrega valor (cartas raw + slabs graded) por uma chave da carta (set, raridade…).
  function breakdownBy(lines, slabs, keyFn) {
    const map = new Map();
    lines.forEach((l) => { const k = keyFn(l.card); if (!k) return; map.set(k, (map.get(k) || 0) + l.total); });
    slabs.forEach((s) => { const c = cardsById.get(s.cardId); if (!c || !(s.value > 0)) return; const k = keyFn(c); if (!k) return; map.set(k, (map.get(k) || 0) + s.value); });
    return Array.from(map.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }

  // Detalhamento: valor por set (top 12) ou por raridade (todas). Barras rankeadas.
  function renderBreakdown(lines, slabs) {
    const sec = elements.breakdown;
    if (!sec) return;
    const rows = breakdownMode === "rarity"
      ? breakdownBy(lines, slabs, (c) => c.rarity)
      : breakdownBy(lines, slabs, (c) => c.set);
    const shown = breakdownMode === "rarity" ? rows : rows.slice(0, 12);
    if (!shown.length) { sec.hidden = true; return; }
    const max = Math.max(1, ...shown.map((r) => r.value));
    elements.breakdownBody.innerHTML = shown.map((r) =>
      `<div class="pf-comp-row"><span class="pf-comp-label pf-bd-name" title="${escapeAttribute(r.label)}">${escapeHtml(r.label)}</span>
        <span class="pf-comp-track"><span class="pf-comp-fill" style="width:${Math.round((r.value / max) * 100)}%;background:var(--accent)"></span></span>
        <span class="pf-comp-val">${escapeHtml(money(r.value))}</span></div>`).join("");
    sec.hidden = false;
  }

  // Composição: cartas (raw) × graded; e por jogo (só no filtro "Todos").
  function renderComposition(rawTotal, gradedTotal) {
    const sec = elements.composition;
    if (!sec) return;
    const bars = (title, rows) => {
      const max = Math.max(1, ...rows.map((r) => r.value));
      const body = rows.filter((r) => r.value > 0).map((r) =>
        `<div class="pf-comp-row"><span class="pf-comp-label">${escapeHtml(r.label)}</span>
          <span class="pf-comp-track"><span class="pf-comp-fill" style="width:${Math.round((r.value / max) * 100)}%;background:${r.color}"></span></span>
          <span class="pf-comp-val">${escapeHtml(money(r.value))}</span></div>`).join("");
      return body ? `<div class="pf-comp-block"><h3>${escapeHtml(title)}</h3>${body}</div>` : "";
    };
    let html = bars(t("portfolio.comp.type"), [
      { label: t("portfolio.rawValue"), value: rawTotal, color: "#2dd4bf" },
      { label: t("portfolio.gradedValue"), value: gradedTotal, color: "#e8c46a" }
    ]);
    if (gameFilter === "all") {
      const byGame = GAMES.map((g) => ({
        label: g === "pokemon" ? t("filter.gamePokemon") : t("filter.gameLorcana"),
        color: GAME_COLOR[g],
        value: collectionLines(g).lines.reduce((s, l) => s + l.total, 0) + gradedSlabs(g).reduce((s, x) => s + (x.value || 0), 0)
      }));
      if (byGame.filter((r) => r.value > 0).length > 1) html += bars(t("portfolio.comp.game"), byGame);
    }
    sec.innerHTML = html;
    sec.hidden = !html;
  }

  // Mais valiosas: raw + graded juntos, por valor do lote/slab (top 15).
  function renderTop(lines, slabs) {
    const rows = lines.map((line) => ({
      name: `${line.card.name} · ${line.card.set} ${line.card.number}`,
      href: detailUrl("set", line.card.set),
      kind: line.variant,
      cond: line.condition,
      estTitle: line.source === "ref" ? t("portfolio.estRef") : line.source === "myp" ? t("portfolio.estMyp") : t("portfolio.estimated"),
      estimated: line.estimated,
      qty: line.quantity, unit: line.unit, total: line.total
    }));
    slabs.forEach((s) => {
      const card = cardsById.get(s.cardId);
      if (!card || !(s.value > 0)) return;
      rows.push({
        name: `${card.name} · ${card.set} ${card.number}`,
        href: detailUrl("set", card.set),
        kind: `${String(s.company || "").toUpperCase()} ${shared.gradedGradeText(s.grade, s.pristine)}`,
        cond: t("nav.graded"), graded: true,
        estimated: false, qty: 1, unit: s.value, total: s.value
      });
    });
    rows.sort((a, b) => b.total - a.total);
    const top = rows.slice(0, 15);

    elements.empty.hidden = top.length > 0;
    if (!top.length) { elements.topCards.innerHTML = ""; return; }

    const body = top.map((r) => {
      const unit = `${money(r.unit)}${r.estimated ? ` <span class="price-estimated" title="${escapeAttribute(r.estTitle)}">≈</span>` : ""}`;
      const kind = r.graded ? `<span class="pf-graded-tag">${escapeHtml(r.kind)}</span>` : escapeHtml(r.kind);
      return `<tr>
        <td><a href="${escapeAttribute(r.href)}">${escapeHtml(r.name)}</a></td>
        <td>${kind}</td>
        <td>${escapeHtml(r.cond)}</td>
        <td class="num">${r.qty}</td>
        <td class="num">${unit}</td>
        <td class="num"><strong>${money(r.total)}</strong></td>
      </tr>`;
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
        <tbody>${body}</tbody>
      </table>`;
  }

  // ---------------------------------------------------------------------------
  // Progressão — snapshot diário POR JOGO (em BRL), pro gráfico local somar/filtrar
  // e pros cookies do hub ficarem corretos por jogo. Esquema do ponto: {d, c, b, w}
  // = raw, graded, desejos (em BRL). combined = c+b = patrimônio do jogo.
  // ---------------------------------------------------------------------------
  const SERIES = {
    combined: { color: "#34d399", get: (p) => (p.c || 0) + (p.b || 0) },
    collection: { color: "#2dd4bf", get: (p) => p.c || 0 },
    graded: { color: "#e8c46a", get: (p) => p.b || 0 },
    wishlist: { color: "#f5a524", get: (p) => p.w || 0 }
  };
  const SERIES_ORDER = ["combined", "collection", "graded", "wishlist"];
  const RANGES = [["1d", 1], ["7d", 7], ["1m", 30], ["3m", 90], ["6m", 180], ["max", 1e9]];
  let activeSeries = new Set(["combined"]);
  let activeRange = "1m";
  let controlsBound = false;

  const toBRL = (v) => { const r = shared.convertMoney(v, shared.getCurrency(), "BRL"); return r == null ? v : Math.round(r * 100) / 100; };
  const fromBRL = (v) => { const r = shared.convertMoney(v, "BRL", shared.getCurrency()); return r == null ? v : r; };
  const histKey = (g) => shared.gameKey("history-v2", g);

  function loadHist(g) {
    try { const a = JSON.parse(localStorage.getItem(histKey(g)) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  // Migra o histórico antigo (v1, por jogo de sessão: c=coleção, b=binders, w=wishlist)
  // pro v2 do mesmo jogo, mapeando c e w; graded (b) começa do zero (antes nem existia).
  function migrateV1(g) {
    if (loadHist(g).length) return;
    try {
      const old = JSON.parse(localStorage.getItem(shared.gameKey("history-v1", g)) || "[]");
      if (Array.isArray(old) && old.length) {
        const v2 = old.map((p) => ({ d: p.d, c: p.c || 0, b: 0, w: p.w || 0 }));
        localStorage.setItem(histKey(g), JSON.stringify(v2));
      }
    } catch (e) { /* ignora */ }
  }

  // Grava o ponto de hoje de UM jogo (substitui se já houver hoje).
  function recordSnapshot(g, raw, graded, wish) {
    migrateV1(g);
    const hist = loadHist(g);
    const d = new Date().toISOString().slice(0, 10);
    const point = { d, c: toBRL(raw), b: toBRL(graded), w: toBRL(wish) };
    if (hist.length && hist[hist.length - 1].d === d) hist[hist.length - 1] = point;
    else hist.push(point);
    if (hist.length > 800) hist.splice(0, hist.length - 800);
    try { localStorage.setItem(histKey(g), JSON.stringify(hist)); } catch (e) { /* quota: ignora */ }
    return hist;
  }

  // Série do gráfico conforme o filtro: "all" soma os jogos por data; senão um só.
  function chartHistory() {
    if (gameFilter !== "all") return loadHist(gameFilter);
    const byDate = new Map();
    GAMES.forEach((g) => loadHist(g).forEach((p) => {
      const cur = byDate.get(p.d) || { d: p.d, c: 0, b: 0, w: 0 };
      cur.c += p.c || 0; cur.b += p.b || 0; cur.w += p.w || 0;
      byDate.set(p.d, cur);
    }));
    return Array.from(byDate.values()).sort((a, b) => a.d.localeCompare(b.d));
  }

  function updateChart() {
    const section = document.getElementById("portfolioChart");
    if (!section) return;
    section.hidden = false;
    // Snapshot de CADA jogo (não só o filtrado) -> cookies/hist do hub corretos.
    GAMES.forEach((g) => {
      const raw = collectionLines(g).lines.reduce((s, l) => s + l.total, 0);
      const graded = gradedSlabs(g).reduce((s, x) => s + (x.value || 0), 0);
      const wish = wishlistTotal(g) + binderWishTotal(g);
      if (raw <= 0 && graded <= 0 && wish <= 0 && !loadHist(g).length) return; // jogo vazio: não polui
      const hist = recordSnapshot(g, raw, graded, wish);
      writePortfolioCookie(g, hist);
    });
    if (!controlsBound) { bindControls(); controlsBound = true; }
    renderControls();
    const hist = chartHistory();
    renderChart(hist);
    renderInsights(hist);
  }

  // Insights: variação do patrimônio (c+b) em 7d / 30d / desde o início (BRL).
  function renderInsights(hist) {
    const sec = document.getElementById("portfolioInsights");
    if (!sec) return;
    if (!hist || hist.length < 2) { sec.hidden = true; return; }
    const valOf = (p) => (p.c || 0) + (p.b || 0);
    const last = hist[hist.length - 1];
    const now = valOf(last);
    const todayMs = new Date(last.d + "T00:00:00").getTime();
    const valueDaysAgo = (n) => {
      const cutoff = todayMs - n * 864e5;
      let chosen = null;
      for (const p of hist) { if (new Date(p.d + "T00:00:00").getTime() <= cutoff) chosen = p; else break; }
      return chosen ? valOf(chosen) : valOf(hist[0]);
    };
    const card = (key, then) => {
      const deltaBRL = now - then;
      const pct = then > 0 ? (deltaBRL / then) * 100 : 0;
      const dir = deltaBRL > 0.005 ? "up" : (deltaBRL < -0.005 ? "down" : "flat");
      const sign = dir === "up" ? "+" : (dir === "down" ? "−" : "");
      const arrow = dir === "up" ? "▲" : (dir === "down" ? "▼" : "→");
      return `<article class="pf-insight pf-insight-${dir}">
        <span class="pf-insight-label">${escapeHtml(t("portfolio.delta." + key))}</span>
        <span class="pf-insight-pct">${arrow} ${sign}${Math.abs(pct).toFixed(1)}%</span>
        <span class="pf-insight-abs">${sign}${escapeHtml(money(Math.abs(fromBRL(deltaBRL))))}</span>
      </article>`;
    };
    sec.innerHTML = card("7d", valueDaysAgo(7)) + card("30d", valueDaysAgo(30)) + card("total", valOf(hist[0]));
    sec.hidden = false;
  }

  // Espelha o resumo de UM jogo num cookie .sleevu.app pro HUB somar sem iframe.
  // c=raw, b=graded, w=desejos (BRL). h = histórico do patrimônio (c+b) do jogo.
  function writePortfolioCookie(g, hist) {
    const last = hist[hist.length - 1] || {};
    const h = hist.slice(-50).map((p) => [p.d, Math.round(((p.c || 0) + (p.b || 0)) * 100) / 100]);
    const payload = { c: last.c || 0, b: last.b || 0, w: last.w || 0, ts: Date.now(), h: h };
    try {
      let c = "sleevu_pf_" + g + "=" + encodeURIComponent(JSON.stringify(payload)) + "; Path=/; Max-Age=" + (180 * 24 * 3600) + "; SameSite=Lax";
      if (/(^|\.)sleevu\.app$/i.test(location.hostname)) c += "; Secure; Domain=.sleevu.app";
      document.cookie = c;
    } catch (e) { /* ignora */ }
  }

  function bindControls() {
    const seriesEl = document.getElementById("pfSeries");
    const rangeEl = document.getElementById("pfRanges");
    if (seriesEl) seriesEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-series]"); if (!b) return;
      const k = b.dataset.series;
      if (activeSeries.has(k)) { if (activeSeries.size > 1) activeSeries.delete(k); } else activeSeries.add(k);
      renderControls(); renderChart(chartHistory());
    });
    if (rangeEl) rangeEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-range]"); if (!b) return;
      activeRange = b.dataset.range;
      renderControls(); renderChart(chartHistory());
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
    const W = 820, H = 252, PL = 6, PR = 6, PT = 14, PB = 28;
    let yMin = Infinity, yMax = -Infinity;
    pts.forEach((p) => active.forEach((k) => { const v = fromBRL(SERIES[k].get(p)); if (v < yMin) yMin = v; if (v > yMax) yMax = v; }));
    if (!isFinite(yMin)) { yMin = 0; yMax = 1; }
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const padY = (yMax - yMin) * 0.12; yMin -= padY; yMax += padY;
    const plotW = W - PL - PR, plotH = H - PT - PB;
    const baseY = PT + plotH;
    const X = (i) => PL + (pts.length === 1 ? plotW / 2 : (i / (pts.length - 1)) * plotW);
    const Y = (v) => PT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
    const loc = getLocale();
    const money = (v) => shared.formatMoney(shared.getCurrency(), v);
    const fmtDay = (s) => { const dt = new Date(s + "T00:00:00"); return ("0" + dt.getDate()).slice(-2) + "/" + ("0" + (dt.getMonth() + 1)).slice(-2); };

    // Grade horizontal + rótulos do eixo Y.
    let grid = "";
    for (let g = 0; g <= 3; g++) {
      const v = yMin + (g / 3) * (yMax - yMin), y = Y(v);
      grid += `<line class="pf-grid" x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}"/>`;
      grid += `<text class="pf-axis" x="${PL + 2}" y="${(y - 4).toFixed(1)}">${escapeHtml(Math.round(v).toLocaleString(loc))}</text>`;
    }
    // Régua de datas (eixo X): ~6 marcações.
    const T = Math.min(6, pts.length);
    let xaxis = "";
    for (let j = 0; j < T; j++) {
      const i = Math.round((j / (T - 1)) * (pts.length - 1));
      const x = X(i), anchor = j === 0 ? "start" : (j === T - 1 ? "end" : "middle");
      xaxis += `<text class="pf-xaxis" x="${x.toFixed(1)}" y="${(H - 8).toFixed(1)}" text-anchor="${anchor}">${escapeHtml(fmtDay(pts[i].d))}</text>`;
    }
    // Área (gradiente) + linha + ponta de cada série.
    let defs = "", areas = "", lines = "";
    active.forEach((k) => {
      const gid = "pfg-" + k;
      defs += `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${SERIES[k].color}" stop-opacity="0.28"/><stop offset="100%" stop-color="${SERIES[k].color}" stop-opacity="0"/></linearGradient>`;
      const linePts = pts.map((p, i) => `${X(i).toFixed(1)},${Y(fromBRL(SERIES[k].get(p))).toFixed(1)}`).join(" ");
      areas += `<polygon class="pf-area" points="${X(0).toFixed(1)},${baseY.toFixed(1)} ${linePts} ${X(pts.length - 1).toFixed(1)},${baseY.toFixed(1)}" fill="url(#${gid})"/>`;
      lines += `<polyline class="pf-line" points="${linePts}" stroke="${SERIES[k].color}"/>`;
      lines += `<circle cx="${X(pts.length - 1).toFixed(1)}" cy="${Y(fromBRL(SERIES[k].get(pts[pts.length - 1]))).toFixed(1)}" r="3.5" fill="${SERIES[k].color}"/>`;
    });
    // Alta/Baixa da série principal (combinada, se ativa).
    const primary = active.indexOf("combined") >= 0 ? "combined" : active[0];
    const vals = pts.map((p) => fromBRL(SERIES[primary].get(p)));
    let maxI = 0, minI = 0;
    vals.forEach((v, i) => { if (v > vals[maxI]) maxI = i; if (v < vals[minI]) minI = i; });
    const pill = (i, label, color, above) => {
      const x = X(i), y = Y(vals[i]), txt = `${label} ${money(vals[i])}`;
      const w = 14 + txt.length * 6.1, h = 19;
      let bx = Math.max(PL, Math.min(W - PR - w, x - w / 2));
      const by = above ? y - h - 10 : y + 10;
      return `<g class="pf-hilo"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${color}"/>
        <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${w.toFixed(1)}" height="${h}" rx="6"/>
        <text x="${(bx + w / 2).toFixed(1)}" y="${(by + h / 2 + 3.6).toFixed(1)}" text-anchor="middle">${escapeHtml(txt)}</text></g>`;
    };
    const hilo = maxI !== minI ? pill(maxI, t("portfolio.chart.high"), "#a78bfa", true) + pill(minI, t("portfolio.chart.low"), "#f0883e", false) : "";

    body.innerHTML = `<div class="pf-chart-rel">
      <svg viewBox="0 0 ${W} ${H}" class="pf-svg" role="img" aria-label="${escapeAttribute(t("portfolio.chart.title"))}">
        <defs>${defs}</defs>${grid}${areas}${lines}${xaxis}${hilo}
        <g class="pf-hover" style="display:none"></g>
      </svg>
      <div class="pf-tip" hidden></div>
    </div>`;

    // Hover: guia vertical + pontos + tooltip com o valor do dia.
    const svg = body.querySelector(".pf-svg");
    const hoverG = body.querySelector(".pf-hover");
    const tip = body.querySelector(".pf-tip");
    function onMove(ev) {
      const r = svg.getBoundingClientRect();
      if (!r.width) return;
      const clientX = ev.touches && ev.touches[0] ? ev.touches[0].clientX : ev.clientX;
      const vx = (clientX - r.left) * (W / r.width);
      let i = Math.round((vx - PL) / plotW * (pts.length - 1));
      i = Math.max(0, Math.min(pts.length - 1, i));
      const x = X(i);
      let g = `<line class="pf-guide" x1="${x.toFixed(1)}" y1="${PT}" x2="${x.toFixed(1)}" y2="${baseY.toFixed(1)}"/>`;
      active.forEach((k) => { g += `<circle class="pf-hover-dot" cx="${x.toFixed(1)}" cy="${Y(fromBRL(SERIES[k].get(pts[i]))).toFixed(1)}" r="3.6" fill="${SERIES[k].color}"/>`; });
      hoverG.innerHTML = g; hoverG.style.display = "";
      const rows = active.map((k) => `<span class="pf-tip-row"><span class="pf-tip-dot" style="background:${SERIES[k].color}"></span>${escapeHtml(t("portfolio.series." + k))}: <strong>${escapeHtml(money(fromBRL(SERIES[k].get(pts[i]))))}</strong></span>`).join("");
      tip.innerHTML = `<span class="pf-tip-date">${escapeHtml(fmtDay(pts[i].d))}</span>${rows}`;
      tip.hidden = false;
      const leftPx = (x / W) * r.width;
      tip.style.left = Math.max(0, Math.min(r.width - tip.offsetWidth, leftPx - tip.offsetWidth / 2)) + "px";
      const topPx = (Y(vals[i]) / H) * r.height - tip.offsetHeight - 12;
      tip.style.top = Math.max(0, topPx) + "px";
    }
    function onLeave() { hoverG.style.display = "none"; tip.hidden = true; }
    svg.addEventListener("mousemove", onMove);
    svg.addEventListener("mouseleave", onLeave);
    svg.addEventListener("touchstart", onMove, { passive: true });
    svg.addEventListener("touchmove", onMove, { passive: true });
  }
})();
