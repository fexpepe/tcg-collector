// Núcleo COMPARTILHADO do gerenciamento de cartas graded (slabs): store,
// tile editável, picker de adição e eventos de edição. Consumido pela página
// dedicada (graded.html) e pela aba Graded da Coleção — gerenciar sem trocar
// de tela, com UMA implementação (nada de cópias que derivam).
//
// Contrato: as funções recebem um `ctx` montado pela página:
//   { shared, graded, cards(), cardsById(), owned, prices, gameFilter(), onChange() }
// `graded` vem de createGradedStore(); onChange re-renderiza a página.
(function () {
  const GRADERS = [
    { code: "psa", label: "PSA", bg: "#c8102e", fg: "#ffffff" },
    { code: "bgs", label: "BGS", bg: "#15171d", fg: "#e8c46a", pristine: true },
    { code: "cgc", label: "CGC", bg: "#0a3d91", fg: "#ffffff", pristine: true },
    { code: "sgc", label: "SGC", bg: "#101216", fg: "#ffffff" },
    { code: "tag", label: "TAG", bg: "#0b0b0d", fg: "#ffffff", pristine: true }
  ];
  const graderOf = (code) => GRADERS.find((x) => x.code === code) || GRADERS[0];

  // Store por-slab (id único → dá pra ter dois PSA 10 da mesma carta). Global
  // cross-game, sincronizada via collections.data (LWW do bloco pelo updatedAt).
  function createGradedStore() {
    const KEY = "tcg-collector-collection-graded-v1";
    let data = { items: {}, order: [], updatedAt: 0 };
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (raw && raw.items && typeof raw.items === "object") data = raw;
    } catch (e) { /* corrompido: começa vazio */ }
    if (!Array.isArray(data.order)) data.order = [];
    const newId = () => "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const save = () => { data.updatedAt = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* quota */ } };
    return {
      any: () => Object.keys(data.items).length > 0,
      countOf: (cardId, variant) => data.order.reduce((n, gid) => { const e = data.items[gid]; return n + (e && e.cardId === cardId && e.variant === variant ? 1 : 0); }, 0),
      list: () => data.order.filter((gid) => data.items[gid]).map((gid) => {
        const e = data.items[gid];
        return { gid, cardId: e.cardId, variant: e.variant, company: e.company || "psa", grade: e.grade || "", pristine: !!e.pristine, cert: e.cert || "", value: Number(e.value) || 0 };
      }),
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

  // Valor efetivo: override manual (>0) ou o valor de mercado graded automático.
  function effectiveValue(shared, it, card) {
    if (it.value > 0) return { value: it.value, auto: false, n: 0, trend: 0 };
    const gv = shared.gradedValue(card, it.company, it.grade);
    return { value: gv.value || 0, auto: true, n: gv.n || 0, trend: gv.trend || 0 };
  }

  // Tile EDITÁVEL do slab (graduadora/nota/pristine/valor/cert inline).
  function editableTileHtml(ctx, card, it, sym) {
    const { shared } = ctx;
    const { t, escapeHtml, escapeAttribute } = shared;
    const src = shared.cardImageSources(card);
    const img = shared.localizedImg(src.url, { alt: card.name, fallback: src.fallback, loading: "lazy", thumb: true });
    const eff = effectiveValue(shared, it, card);
    const isAuto = eff.auto && eff.value > 0;
    const autoCls = isAuto ? " is-auto" : "";
    const valStr = it.value > 0 ? String(it.value).replace(".", ",") : (isAuto ? eff.value.toFixed(2).replace(".", ",") : "");
    const valTitle = isAuto ? t("graded.autoHint", { n: eff.n }) : t("graded.value");
    const companyOpts = GRADERS.map((g) => `<option value="${g.code}"${g.code === it.company ? " selected" : ""}>${escapeHtml(g.label)}</option>`).join("");
    const canPristine = !!graderOf(it.company).pristine;
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

  // Eventos de EDIÇÃO/remoção dos tiles (delegados no grid). O clique de
  // preview fica com a página (cada uma tem seu preview). Idempotente por grid.
  function bindGridEvents(ctx, grid) {
    if (!grid || grid.dataset.gradedUiBound) return;
    grid.dataset.gradedUiBound = "1";
    const { shared, graded } = ctx;
    const { t } = shared;
    grid.addEventListener("click", (event) => {
      const rm = event.target.closest("[data-graded-remove]");
      if (!rm) return;
      const tile = rm.closest(".graded-tile");
      if (!tile) return;
      const restore = shared.snapshotKeys(["tcg-collector-collection-graded-v1"]);
      graded.remove(tile.dataset.gradedGid);
      ctx.onChange();
      shared.toastUndo(t("undo.slabRemoved"), restore);
    });
    grid.addEventListener("change", (event) => {
      const tile = event.target.closest(".graded-tile");
      if (!tile) return;
      const gid = tile.dataset.gradedGid;
      const co = event.target.closest("[data-graded-company]");
      if (co) { graded.setCompany(gid, co.value); if (!graderOf(co.value).pristine) graded.setPristine(gid, false); ctx.onChange(); return; }
      const pr = event.target.closest("[data-graded-pristine]");
      if (pr) { graded.setPristine(gid, pr.checked); ctx.onChange(); return; }
      const cert = event.target.closest("[data-graded-cert]");
      if (cert) { graded.setCert(gid, cert.value.trim()); return; }
      const gr = event.target.closest("[data-graded-grade]");
      if (gr) { graded.setGrade(gid, gr.value.trim().replace(",", ".")); ctx.onChange(); return; }
      const val = event.target.closest("[data-graded-value]");
      if (val) { graded.setValue(gid, shared.parseMoney(String(val.value).trim())); ctx.onChange(); }
    });
  }

  // Picker de adição: filtro de jogo + busca + raridade + ordenação sobre as
  // cartas que você TEM. Cada toque adiciona 1 slab (PSA 10; edita depois).
  function openPicker(ctx) {
    const { shared, graded, owned, prices } = ctx;
    const { t, unique, debounce, escapeHtml, escapeAttribute } = shared;
    let modal = document.getElementById("gradedPickerModal");
    if (!modal) { modal = document.createElement("div"); modal.id = "gradedPickerModal"; modal.className = "sales-picker-modal"; document.body.appendChild(modal); }
    let pickGame = ctx.gameFilter ? ctx.gameFilter() : "all";
    let pickRarity = "";
    let pickSort = "value-desc";
    const cards = ctx.cards();
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
            ${shared.GAME_SLUGS.map((g) => `<button type="button" class="chip" data-pick-game="${g}" aria-pressed="${pickGame === g}">${escapeHtml(t(g === "lorcana" ? "filter.gameLorcana" : g === "onepiece" ? "filter.gameOnePiece" : g === "naruto" ? "filter.gameNaruto" : "filter.gamePokemon"))}</button>`).join("")}
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
      if (event.target.closest("[data-graded-picker-close]")) { modal.remove(); document.body.classList.remove("preview-open"); ctx.onChange(); return; }
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

  window.TCGGradedUI = { GRADERS, graderOf, createGradedStore, effectiveValue, editableTileHtml, bindGridEvents, openPicker };
})();
