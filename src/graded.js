// Cartas Graded: página dedicada (graded.html) pra catalogar suas cartas
// GRADUADAS (slabs) — cada uma com graduadora (PSA/BGS/CGC/SGC/TAG) + nota +
// (opcional) nº do certificado + valor. O valor de mercado graded vem automático
// da PPT (por graduadora+nota, em USD do eBay sold → moeda atual) e pode ser
// sobrescrito à mão. Sem foto: a carta do catálogo é renderizada DENTRO de um
// "slab" sintetizado (moldura + etiqueta colorida da graduadora). Reaproveita o
// catálogo "owned", a store de preços/preview e o export em canvas das Vendas.
// Sem inline handlers (CSP script-src 'self').
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const grid = document.getElementById("gradedGrid");
  if (!grid) return;

  const { detailUrl, unique, t, debounce, escapeHtml, escapeAttribute } = shared;

  // Graduadoras suportadas: código + rótulo + cores da etiqueta do slab (fundo/
  // texto) e da barra do dashboard. PSA vermelho, BGS preto/dourado, CGC azul,
  // SGC preto/branco (tuxedo), TAG azul-teal. PPT cobre PSA/BGS/CGC/SGC (auto);
  // TAG não tem dado → valor manual.
  const GRADERS = [
    { code: "psa", label: "PSA", bg: "#c8102e", fg: "#ffffff" },
    { code: "bgs", label: "BGS", bg: "#15171d", fg: "#e8c46a", pristine: true },
    { code: "cgc", label: "CGC", bg: "#0a3d91", fg: "#ffffff", pristine: true },
    { code: "sgc", label: "SGC", bg: "#101216", fg: "#ffffff" },
    { code: "tag", label: "TAG", bg: "#0b0b0d", fg: "#ffffff", pristine: true }
  ];
  const graderOf = (code) => GRADERS.find((x) => x.code === code) || GRADERS[0];

  let cards = [];
  let cardsById = new Map();
  let gameFilter = "all"; // all | pokemon | lorcana

  // Stores por jogo + facades (despacham por jogo pelo cardGameMap). A página só
  // lê cartas que você TEM (pra o picker), igual à de Vendas.
  const ownedByGame = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, shared.createCollectionStore(g)]));
  const wishlistByGame = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, shared.createWishlistStore(g)]));
  const pricesByGame = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, shared.createPriceStore(g)]));
  const cardGameMap = new Map();
  const gameOf = (id) => cardGameMap.get(id) || "pokemon";
  const owned = shared.mergedCollectionStore(ownedByGame, gameOf);
  const wishlist = shared.mergedWishlistStore(wishlistByGame, gameOf);
  const prices = shared.mergedPriceStore(pricesByGame, gameOf);

  // Graded: cada slab é um item ÚNICO (id gerado) — dá pra ter dois PSA 10 da
  // mesma carta. Global cross-game, sincronizado via collections.data (LWW do
  // bloco pelo updatedAt). `value` = override manual (>0); vazio = usa o auto.
  const graded = createGradedStore();
  function createGradedStore() {
    const KEY = "tcg-collector-collection-graded-v1";
    let data = { items: {}, order: [], updatedAt: 0 };
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (raw && raw.items && typeof raw.items === "object") data = raw;
    } catch (e) { /* corrompido: começa vazio */ }
    if (!Array.isArray(data.order)) data.order = [];
    const newId = () => "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const save = () => { data.updatedAt = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* quota: ignora */ } };
    return {
      any: () => Object.keys(data.items).length > 0,
      countOf: (cardId, variant) => data.order.reduce((n, gid) => { const e = data.items[gid]; return n + (e && e.cardId === cardId && e.variant === variant ? 1 : 0); }, 0),
      list: () => data.order.filter((gid) => data.items[gid]).map((gid) => {
        const e = data.items[gid];
        return { gid, cardId: e.cardId, variant: e.variant, company: e.company || "psa", grade: e.grade || "", pristine: !!e.pristine, cert: e.cert || "", value: Number(e.value) || 0 };
      }),
      // Adiciona um slab novo (1 por chamada). company/grade padrão; value 0 = auto.
      add(cardId, variant, company, grade) {
        const gid = newId();
        data.items[gid] = { cardId, variant, company: company || "psa", grade: grade || "10", pristine: false, cert: "", value: 0 };
        data.order.push(gid); save();
        return gid;
      },
      setCompany(gid, company) { const e = data.items[gid]; if (e) { e.company = company; save(); } },
      setPristine(gid, pristine) { const e = data.items[gid]; if (e) { e.pristine = !!pristine; save(); } },
      setGrade(gid, grade) { const e = data.items[gid]; if (e) { e.grade = grade; save(); } },
      setCert(gid, cert) { const e = data.items[gid]; if (e) { e.cert = cert; save(); } },
      setValue(gid, value) { const e = data.items[gid]; if (e) { e.value = Number(value) || 0; save(); } },
      remove(gid) { if (data.items[gid]) { delete data.items[gid]; data.order = data.order.filter((x) => x !== gid); save(); } }
    };
  }

  const elements = {
    gameFilter: document.getElementById("gameFilter"),
    grid,
    empty: document.getElementById("gradedEmpty"),
    addBtn: document.getElementById("gradedAddBtn"),
    shareBtn: document.getElementById("gradedShareBtn"),
    exportBtn: document.getElementById("gradedExportBtn"),
    sort: document.getElementById("gradedSortSelect"),
    dashboard: document.getElementById("gradedDashboard"),
    dashValue: document.getElementById("gradedDashValue"),
    dashCount: document.getElementById("gradedDashCount"),
    dashTopList: document.getElementById("gradedDashTop"),
    dashDist: document.getElementById("gradedDashDist")
  };

  const preview = shared.createCardPreview({
    getCard: (cardId) => cardsById.get(cardId),
    store: owned,
    prices,
    wishlist
  });

  function inGameFilter(card) { return gameFilter === "all" || card.game === gameFilter; }

  const currencySymbol = shared.currencySymbol;

  // Valor efetivo de um slab: override manual (>0) ou o valor de mercado graded
  // da PPT (só PSA 9/10). Recalcula pelo grade/graduadora atual quando é automático.
  // `n` = nº de vendas eBay (90d) que embasam o auto; `trend` = 1 alta / -1 baixa.
  function effectiveValue(it, card) {
    if (it.value > 0) return { value: it.value, auto: false, n: 0, trend: 0 };
    const gv = shared.gradedValue(card, it.company, it.grade);
    return { value: gv.value || 0, auto: true, n: gv.n || 0, trend: gv.trend || 0 };
  }
  // Nota numérica pra ordenação ("9.5" → 9.5; vazio → 0).
  const gradeNum = (g) => { const n = parseFloat(String(g).replace(",", ".")); return isFinite(n) ? n : 0; };

  // Versão compartilhada NÃO escapa o label (chamadas aqui usam rótulos fixos).
  const distBarsHtml = shared.distBarsHtml;

  const GRADED_SORTS = ["value-desc", "value-asc", "grade-desc", "num-asc", "num-desc", "release", "added-desc", "added-asc"];
  let gradedSort = GRADED_SORTS.includes(localStorage.getItem("tcg-graded-sort")) ? localStorage.getItem("tcg-graded-sort") : "added-asc";

  function sortItems(arr) {
    const rankOf = new Map(graded.list().map((x, i) => [x.gid, i]));
    const rank = (x) => { const r = rankOf.get(x.it.gid); return r == null ? Infinity : r; };
    const a = arr.slice();
    if (gradedSort === "num-asc") a.sort((x, y) => shared.compareCardNumbers(x.card.number, y.card.number));
    else if (gradedSort === "num-desc") a.sort((x, y) => shared.compareCardNumbers(y.card.number, x.card.number));
    else if (gradedSort === "release") a.sort((x, y) => String(y.card.setReleaseDate || "").localeCompare(String(x.card.setReleaseDate || "")));
    else if (gradedSort === "grade-desc") a.sort((x, y) => gradeNum(y.it.grade) - gradeNum(x.it.grade));
    else if (gradedSort === "value-desc") a.sort((x, y) => y.val - x.val);
    else if (gradedSort === "value-asc") a.sort((x, y) => { if (!x.val && !y.val) return 0; if (!x.val) return 1; if (!y.val) return -1; return x.val - y.val; });
    else if (gradedSort === "added-desc") a.sort((x, y) => rank(y) - rank(x));
    else a.sort((x, y) => rank(x) - rank(y)); // added-asc
    return a;
  }

  // Slabs resolvidos (carta + valor efetivo) respeitando filtro de jogo + ordenação.
  function gradedItems() {
    return sortItems(graded.list()
      .map((it) => { const card = cardsById.get(it.cardId); return { it, card, val: card ? effectiveValue(it, card).value : 0 }; })
      .filter((x) => x.card && inGameFilter(x.card)));
  }

  function render() {
    shared.applyGameAccent(gameFilter);
    renderDashboard();
    renderGraded();
  }

  function renderDashboard() {
    if (!elements.dashboard) return;
    const items = gradedItems();
    elements.dashboard.hidden = false;
    const cur = shared.getCurrency();
    const total = items.reduce((sum, x) => sum + (x.val || 0), 0);
    elements.dashValue.textContent = total > 0 ? shared.formatMoney(cur, total) : "—";
    elements.dashCount.textContent = items.length;

    const top = items.filter((x) => x.val > 0).sort((a, b) => b.val - a.val).slice(0, 3);
    elements.dashTopList.innerHTML = top.length
      ? top.map(({ it, card, val }) => {
          const src = shared.cardImageSources(card);
          const thumb = shared.localizedImg(src.url, { alt: "", fallback: src.fallback, loading: "lazy", thumb: true });
          const g = graderOf(it.company);
          return `<li><a href="${escapeAttribute(detailUrl("set", card.set))}"><span class="dash-top-thumb">${thumb}</span>
            <span class="dash-top-info"><strong>${escapeHtml(card.name)}</strong><span class="dash-top-set">${escapeHtml(g.label)} ${escapeHtml(it.grade)} · ${escapeHtml(card.set)}</span></span>
            <span class="dash-top-val">${escapeHtml(shared.formatMoney(cur, val))}</span></a></li>`;
        }).join("")
      : `<li class="dash-empty">${escapeHtml(t("dash.empty"))}</li>`;

    // Distribuição por graduadora.
    const byCo = {};
    items.forEach(({ it }) => { byCo[it.company] = (byCo[it.company] || 0) + 1; });
    elements.dashDist.innerHTML = distBarsHtml(GRADERS.map((g) => ({ label: g.label, n: byCo[g.code] || 0, color: g.bg })));
  }

  function renderGraded() {
    const items = gradedItems();
    elements.empty.hidden = items.length > 0;
    const sym = currencySymbol();
    elements.grid.innerHTML = items.map(({ it, card }) => gradedTileHtml(card, it, sym)).join("");
    const hasValued = items.some((x) => x.val > 0);
    if (elements.shareBtn) elements.shareBtn.disabled = !graded.any();
    if (elements.exportBtn) elements.exportBtn.disabled = !items.length;
  }

  // Tile (editor): imagem limpa em cima (= carta normal) + Nome, Coleção · nº e os
  // campos (graduadora, nota, valor, cert). Coeso com as cartas comuns.
  function gradedTileHtml(card, it, sym) {
    const src = shared.cardImageSources(card);
    const img = shared.localizedImg(src.url, { alt: card.name, fallback: src.fallback, loading: "lazy", thumb: true });
    const eff = effectiveValue(it, card);
    const isAuto = eff.auto && eff.value > 0;
    const autoCls = isAuto ? " is-auto" : "";
    const valStr = it.value > 0 ? String(it.value).replace(".", ",") : (isAuto ? eff.value.toFixed(2).replace(".", ",") : "");
    const valTitle = isAuto ? t("graded.autoHint", { n: eff.n }) : t("graded.value");
    const companyOpts = GRADERS.map((g) => `<option value="${g.code}"${g.code === it.company ? " selected" : ""}>${escapeHtml(g.label)}</option>`).join("");
    const canPristine = !!graderOf(it.company).pristine; // BGS/CGC/TAG têm "Pristine"
    const pristineRow = canPristine
      ? `<label class="graded-pristine" title="${escapeAttribute(t("graded.pristineHint"))}"><input type="checkbox" data-graded-pristine${it.pristine ? " checked" : ""} aria-label="${escapeAttribute(t("graded.pristine"))}"><span>${escapeHtml(t("graded.pristine"))}</span></label>`
      : "";
    return `<article class="card-tile graded-tile" data-graded-gid="${escapeAttribute(it.gid)}">
      <div class="card-image">
        <button type="button" class="image-open" data-preview-card-id="${escapeAttribute(card.id)}" data-preview-variant="${escapeAttribute(it.variant)}" data-graded-company="${escapeAttribute(it.company)}" data-graded-grade="${escapeAttribute(it.grade)}" data-graded-pristine="${it.pristine ? "1" : ""}" aria-label="${escapeAttribute(t("card.zoom", { name: card.name }))}">${img}</button>
        <button type="button" class="sale-remove" data-graded-remove title="${escapeAttribute(t("graded.remove"))}" aria-label="${escapeAttribute(t("graded.remove"))}">✕</button>
      </div>
      <div class="tile-info">
        <h3>${escapeHtml(card.name)}</h3>
        <p class="tile-variant">${shared.cardFlag(card.language)}<span>${escapeHtml(card.set)} · ${escapeHtml(card.number)}</span></p>
        <div class="graded-fields">
          <div class="graded-row">
            <select class="graded-company" data-graded-company aria-label="${escapeAttribute(t("graded.company"))}" title="${escapeAttribute(t("graded.company"))}">${companyOpts}</select>
            <input type="text" inputmode="decimal" class="graded-grade" data-graded-grade value="${escapeAttribute(it.grade)}" maxlength="4" placeholder="10" aria-label="${escapeAttribute(t("graded.grade"))}" title="${escapeAttribute(t("graded.grade"))}">
          </div>
          ${pristineRow}
          <label class="sale-price-field${autoCls}" title="${escapeAttribute(valTitle)}"><span class="sale-cur">${escapeHtml(sym)}</span><input type="text" inputmode="decimal" class="sale-price${autoCls}" data-graded-value value="${escapeAttribute(valStr)}" placeholder="0,00" aria-label="${escapeAttribute(t("graded.value"))}"></label>
        </div>
        <input type="text" class="graded-cert" data-graded-cert value="${escapeAttribute(it.cert)}" placeholder="${escapeAttribute(t("graded.certPlaceholder"))}" aria-label="${escapeAttribute(t("graded.cert"))}">
      </div>
    </article>`;
  }

  // Picker pra adicionar slabs: filtro de jogo + busca + grade das cartas que você
  // TEM. Cada toque ADICIONA um slab novo (PSA 10 por padrão; edite depois). O
  // badge mostra quantos slabs daquela carta já existem.
  function openPicker() {
    let modal = document.getElementById("gradedPickerModal");
    if (!modal) { modal = document.createElement("div"); modal.id = "gradedPickerModal"; modal.className = "sales-picker-modal"; document.body.appendChild(modal); }
    let pickGame = gameFilter;
    let pickRarity = "";
    let pickSort = "value-desc";
    const updateCount = () => { const el = modal.querySelector(".sales-picker-count"); if (el) el.textContent = t("graded.pickerCount", { n: graded.list().length }); };
    const priceOf = (card, variant) => shared.cardValue(card, variant, prices, shared.DEFAULT_CONDITION).value || 0;
    const sortPairs = (pairs) => {
      if (pickSort === "num-asc") return pairs.sort((a, b) => shared.compareCardNumbers(a.card.number, b.card.number));
      if (pickSort === "num-desc") return pairs.sort((a, b) => shared.compareCardNumbers(b.card.number, a.card.number));
      if (pickSort === "release") return pairs.sort((a, b) => String(b.card.setReleaseDate || "").localeCompare(String(a.card.setReleaseDate || "")));
      if (pickSort === "value-asc") return pairs.sort((a, b) => { const pa = priceOf(a.card, a.variant), pb = priceOf(b.card, b.variant); if (!pa && !pb) return 0; if (!pa) return 1; if (!pb) return -1; return pa - pb; });
      return pairs.sort((a, b) => priceOf(b.card, b.variant) - priceOf(a.card, a.variant));
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
        const n = graded.countOf(card.id, variant);
        const count = n > 0 ? `<span class="sales-pick-cond">${n}</span>` : "";
        const cls = n > 0 ? " is-partial" : "";
        return `<div class="sales-pick${cls}" role="button" tabindex="0" data-pick-card="${escapeAttribute(card.id)}" data-pick-variant="${escapeAttribute(variant)}">
          <span class="sales-pick-img">${img}<span class="sales-pick-check">+</span></span>
          <span class="sales-pick-name">${escapeHtml(card.name)}</span>
          <span class="sales-pick-var">${shared.cardFlag(card.language)}<span>${escapeHtml(variant)}</span>${count}</span>
        </div>`;
      }).join("") || `<p class="empty-state">${escapeHtml(t("graded.pickerEmpty"))}</p>`;
      modal.querySelector(".sales-picker-results").innerHTML = html;
    };
    const ownedPool = cards.filter((c) => owned.has(c.id));
    const rarityOpts = `<option value="">${escapeHtml(t("filter.all.f"))}</option>`
      + unique(ownedPool.map((c) => c.rarity).filter(Boolean)).sort().map((r) => `<option value="${escapeAttribute(r)}">${escapeHtml(r)}</option>`).join("");
    const sortOpts = [["value-desc", "sort.valueDesc"], ["value-asc", "sort.valueAsc"], ["num-asc", "sort.numAsc"], ["num-desc", "sort.numDesc"], ["release", "sort.releaseDate"]]
      .map(([v, k]) => `<option value="${v}"${v === pickSort ? " selected" : ""}>${escapeHtml(t(k))}</option>`).join("");
    modal.innerHTML = `<div class="sales-picker-backdrop" data-graded-picker-close></div>
      <section class="sales-picker-panel" role="dialog" aria-modal="true" aria-label="${escapeAttribute(t("graded.add"))}">
        <header class="sales-picker-head"><strong>${escapeHtml(t("graded.add"))}</strong>
          <button type="button" class="preview-close" data-graded-picker-close aria-label="${escapeAttribute(t("modal.close"))}">×</button></header>
        <div class="sales-picker-controls">
          <div class="chip-filter game-filter" id="gradedPickerGame" role="group" aria-label="Jogo">
            <button type="button" class="chip" data-pick-game="all" aria-pressed="${pickGame === "all"}">${escapeHtml(t("filter.gameAll"))}</button>
            ${shared.GAME_SLUGS.map((g) => `<button type="button" class="chip" data-pick-game="${g}" aria-pressed="${pickGame === g}">${escapeHtml(t(g === "lorcana" ? "filter.gameLorcana" : g === "onepiece" ? "filter.gameOnePiece" : "filter.gamePokemon"))}</button>`).join("")}
          </div>
          <input type="search" class="sales-picker-search" placeholder="${escapeAttribute(t("search.placeholder.cards"))}">
          <label class="sales-picker-field"><span>${escapeHtml(t("toolbar.rarity"))}</span>
            <select class="sales-picker-select" id="gradedPickerRarity">${rarityOpts}</select></label>
          <label class="sales-picker-field"><span>${escapeHtml(t("sort.label"))}</span>
            <select class="sales-picker-select" id="gradedPickerSort">${sortOpts}</select></label>
        </div>
        <p class="sales-picker-hint">${escapeHtml(t("graded.pickerHint"))}</p>
        <div class="sales-picker-results"></div>
        <footer class="sales-picker-foot">
          <span class="sales-picker-count"></span>
          <button type="button" class="primary" data-graded-picker-close>${escapeHtml(t("sales.pickerDone"))}</button>
        </footer>
      </section>`;
    document.body.classList.add("preview-open");
    renderList(); updateCount();
    modal.querySelector(".sales-picker-search").addEventListener("input", debounce(renderList, 200));
    modal.addEventListener("change", (event) => {
      const rar = event.target.closest("#gradedPickerRarity");
      if (rar) { pickRarity = rar.value; renderList(); return; }
      const srt = event.target.closest("#gradedPickerSort");
      if (srt) { pickSort = srt.value; renderList(); }
    });
    modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-graded-picker-close]")) { modal.remove(); document.body.classList.remove("preview-open"); render(); return; }
      const gameChip = event.target.closest("[data-pick-game]");
      if (gameChip) {
        pickGame = gameChip.dataset.pickGame;
        modal.querySelectorAll("#gradedPickerGame .chip").forEach((c) => c.setAttribute("aria-pressed", String(c === gameChip)));
        renderList(); return;
      }
      const pick = event.target.closest("[data-pick-card]");
      if (pick) {
        const id = pick.dataset.pickCard, v = pick.dataset.pickVariant;
        graded.add(id, v, "psa", "10");
        const n = graded.countOf(id, v);
        pick.classList.add("is-partial");
        let countEl = pick.querySelector(".sales-pick-cond");
        if (!countEl) { countEl = document.createElement("span"); countEl.className = "sales-pick-cond"; pick.querySelector(".sales-pick-var").appendChild(countEl); }
        countEl.textContent = String(n);
        updateCount();
      }
    });
  }

  // Itens pro share: cada slab leva graduadora (co), nota (gr), valor graded (gv).
  function buildGradedShareData() {
    const cur = shared.getCurrency();
    const sorted = sortItems(graded.list()
      .map((it) => { const card = cardsById.get(it.cardId); return { it, card, val: card ? effectiveValue(it, card).value : 0 }; })
      .filter((x) => x.card));
    const items = sorted.map(({ it, card, val }) => {
      const src = shared.cardImageSources(card);
      return {
        id: card.id, n: card.name, s: card.set, num: card.number, lang: card.language,
        g: card.game, v: it.variant, q: 1, co: it.company, gr: it.grade, pr: it.pristine ? 1 : 0, gv: val, cur, img: src.url, fb: src.fallback || ""
      };
    });
    return { items, scope: "graded", cur };
  }

  async function shareGraded(btn) {
    const live = shared.publicProfileUrl("graded");
    if (live) {
      try { await navigator.clipboard.writeText(live); alert(t("collection.share.copiedLive")); }
      catch (e) { window.prompt(t("collection.share.copyManual"), live); }
      return;
    }
    const data = buildGradedShareData();
    if (!data.items.length) { alert(t("graded.shareEmpty")); return; }
    if (btn) btn.disabled = true;
    const res = await shared.createShare("collection", t("graded.shared.label"), data);
    if (btn) btn.disabled = false;
    if (res && res.id) {
      const link = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}collection.html?s=${res.id}`;
      try { await navigator.clipboard.writeText(link); alert(t("collection.share.copied")); }
      catch (e) { window.prompt(t("collection.share.copyManual"), link); }
    } else {
      alert(res && res.error === "auth" ? t("collection.share.needLogin") : t("collection.share.error"));
    }
  }

  // Imagem (PNG) das cartas graded: cada carta dentro de um slab (etiqueta da
  // graduadora em cima) + valor embaixo. Canvas puro (CSP-safe, sem lib).
  async function exportImage(button) {
    const sym = currencySymbol();
    const list = gradedItems();
    if (!list.length) { alert(t("graded.shareEmpty")); return; }
    const label = button ? button.textContent : "";
    if (button) { button.disabled = true; button.textContent = "…"; }

    const cols = list.length <= 4 ? list.length : (list.length <= 12 ? 4 : 5);
    const rows = Math.ceil(list.length / cols);
    const CARD_W = 280, CARD_H = Math.round(CARD_W * 1.396), GAP = 18, MARGIN = 32, TITLE_H = 56, FOOTER_H = 38, RADIUS = 14;
    const LABEL_H = 40; // etiqueta da graduadora ACIMA da carta
    const BAND_H = 48;  // valor ABAIXO da carta
    const CELL_H = LABEL_H + CARD_H + BAND_H;
    const width = MARGIN * 2 + cols * CARD_W + (cols - 1) * GAP;
    const height = MARGIN + TITLE_H + rows * CELL_H + (rows - 1) * GAP + FOOTER_H + MARGIN;
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    const FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#111111"; ctx.font = `800 30px ${FONT}`; ctx.textBaseline = "top";
    ctx.fillText(t("graded.shared.label"), MARGIN, MARGIN);

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
      const { it, card, val } = list[i];
      const g = graderOf(it.company);
      const x = MARGIN + (i % cols) * (CARD_W + GAP);
      const y = MARGIN + TITLE_H + Math.floor(i / cols) * (CELL_H + GAP);
      // Etiqueta da graduadora (barra colorida) acima da carta
      roundRect(x, y, CARD_W, LABEL_H, 10); ctx.fillStyle = g.bg; ctx.fill();
      ctx.fillStyle = g.fg; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.font = `800 19px ${FONT}`; ctx.fillText(g.label, x + 14, y + LABEL_H / 2 + 1);
      ctx.textAlign = "right"; ctx.font = `800 21px ${FONT}`;
      ctx.fillText(shared.gradedGradeText(it.grade, it.pristine) || "—", x + CARD_W - 14, y + LABEL_H / 2 + 1);
      // Carta
      const cy = y + LABEL_H;
      ctx.save();
      roundRect(x, cy, CARD_W, CARD_H, RADIUS); ctx.fillStyle = "#eceff3"; ctx.fill(); ctx.clip();
      const src = shared.cardImageSources(card);
      const lor = card.game === "lorcana" || card.game === "onepiece"; // hosts sem CORS → proxy
      let img;
      if (lor) {
        img = await loadImage(`https://wsrv.nl/?url=${encodeURIComponent(src.url)}&output=webp`, true);
      } else {
        img = await loadImage(bust(src.url), true);
        if (!img && src.fallback) img = await loadImage(bust(src.fallback), true);
      }
      if (img) drawCover(img, x, cy, CARD_W, CARD_H);
      ctx.restore();
      ctx.save(); roundRect(x, cy, CARD_W, CARD_H, RADIUS); ctx.strokeStyle = g.bg; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
      // Valor abaixo
      const by = cy + CARD_H;
      if (val > 0) {
        const priceText = `${sym} ${val.toFixed(2).replace(".", ",")}`;
        let pfs = 24; ctx.font = `800 ${pfs}px ${FONT}`;
        while (pfs > 14 && ctx.measureText(priceText).width > CARD_W - 8) { pfs -= 1; ctx.font = `800 ${pfs}px ${FONT}`; }
        ctx.fillStyle = "#111111"; ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillText(priceText, x + 2, by + 14, CARD_W - 4);
      }
      ctx.textAlign = "left"; ctx.textBaseline = "top";
    }
    ctx.fillStyle = "#9aa3b0"; ctx.font = `600 18px ${FONT}`; ctx.textBaseline = "alphabetic";
    ctx.fillText("Sleevu · sleevu.app", MARGIN, height - MARGIN + 4);

    const finish = () => { if (button) { button.disabled = false; button.textContent = label; } };
    try {
      canvas.toBlob((blob) => {
        if (!blob) { alert(t("graded.exportTainted")); finish(); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "graded-sleevu.png";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        finish();
      }, "image/png");
    } catch (e) { alert(t("graded.exportTainted")); finish(); }
  }

  function bindEvents() {
    if (elements.gameFilter) {
      elements.gameFilter.addEventListener("click", (event) => {
        const chip = event.target.closest("[data-game-filter]");
        if (!chip || chip.dataset.gameFilter === gameFilter) return;
        gameFilter = chip.dataset.gameFilter;
        Array.from(elements.gameFilter.children).forEach((node) => node.setAttribute("aria-pressed", node === chip ? "true" : "false"));
        render();
      });
    }
    elements.grid.addEventListener("click", (event) => {
      const imageButton = event.target.closest("[data-preview-card-id]");
      if (imageButton) { const co = imageButton.dataset.gradedCompany; preview.open(imageButton.dataset.previewCardId, imageButton.dataset.previewVariant, co ? { graded: { company: co, grade: imageButton.dataset.gradedGrade, pristine: imageButton.dataset.gradedPristine === "1" } } : undefined); return; }
      const rm = event.target.closest("[data-graded-remove]");
      if (rm) { const tile = rm.closest(".graded-tile"); if (tile) { const restore = shared.snapshotKeys(["tcg-collector-collection-graded-v1"]); graded.remove(tile.dataset.gradedGid); render(); shared.toastUndo(t("undo.slabRemoved"), restore); } }
    });
    elements.grid.addEventListener("change", (event) => {
      const tile = event.target.closest(".graded-tile");
      if (!tile) return;
      const gid = tile.dataset.gradedGid;
      const co = event.target.closest("[data-graded-company]");
      if (co) { graded.setCompany(gid, co.value); if (!graderOf(co.value).pristine) graded.setPristine(gid, false); render(); return; }
      const pr = event.target.closest("[data-graded-pristine]");
      if (pr) { graded.setPristine(gid, pr.checked); render(); return; }
      const cert = event.target.closest("[data-graded-cert]");
      if (cert) { graded.setCert(gid, cert.value.trim()); return; }
      const gr = event.target.closest("[data-graded-grade]");
      if (gr) { graded.setGrade(gid, gr.value.trim().replace(",", ".")); render(); return; }
      const val = event.target.closest("[data-graded-value]");
      if (val) {
        const text = String(val.value).trim();
        const amount = shared.parseMoney(text);
        graded.setValue(gid, amount);
        render();
      }
    });
    if (elements.addBtn) elements.addBtn.addEventListener("click", openPicker);
    if (elements.shareBtn) elements.shareBtn.addEventListener("click", () => shareGraded(elements.shareBtn));
    if (elements.exportBtn) elements.exportBtn.addEventListener("click", () => exportImage(elements.exportBtn));
    if (elements.sort) {
      elements.sort.value = gradedSort;
      elements.sort.addEventListener("change", () => {
        gradedSort = elements.sort.value;
        localStorage.setItem("tcg-graded-sort", gradedSort);
        render();
      });
    }
  }

  bindEvents();
  Promise.all([
    shared.loadOwnedAcrossGames(Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, ownedByGame[g].knownCardIds()]))),
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
      if (elements.empty) { elements.empty.textContent = t("error.catalog", { message: error.message }); elements.empty.hidden = false; }
    });
})();
