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
  const { GRADERS, graderOf } = window.TCGGradedUI;

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
  const graded = window.TCGGradedUI.createGradedStore();

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
  const effectiveValue = (it, card) => window.TCGGradedUI.effectiveValue(shared, it, card);
  // Nota numérica pra ordenação ("9.5" → 9.5; vazio → 0).
  const gradeNum = (g) => { const n = parseFloat(String(g).replace(",", ".")); return isFinite(n) ? n : 0; };

  // Versão compartilhada NÃO escapa o label (chamadas aqui usam rótulos fixos).
  const distBarsHtml = shared.distBarsHtml;

  const GRADED_SORTS = ["value-desc", "value-asc", "grade-desc", "num-asc", "num-desc", "rarity-desc", "rarity-asc", "release", "added-desc", "added-asc"];
  let gradedSort = GRADED_SORTS.includes(localStorage.getItem("tcg-graded-sort")) ? localStorage.getItem("tcg-graded-sort") : "added-asc";

  function sortItems(arr) {
    const rankOf = new Map(graded.list().map((x, i) => [x.gid, i]));
    const rank = (x) => { const r = rankOf.get(x.it.gid); return r == null ? Infinity : r; };
    const a = arr.slice();
    if (gradedSort === "num-asc") a.sort((x, y) => shared.compareCardNumbers(x.card.number, y.card.number));
    else if (gradedSort === "num-desc") a.sort((x, y) => shared.compareCardNumbers(y.card.number, x.card.number));
    else if (gradedSort === "release") a.sort((x, y) => String(y.card.setReleaseDate || "").localeCompare(String(x.card.setReleaseDate || "")));
    else if (gradedSort === "rarity-desc") a.sort((x, y) => shared.rarityRank(y.card.rarity) - shared.rarityRank(x.card.rarity) || shared.compareCardNumbers(x.card.number, y.card.number));
    else if (gradedSort === "rarity-asc") a.sort((x, y) => shared.rarityRank(x.card.rarity) - shared.rarityRank(y.card.rarity) || shared.compareCardNumbers(x.card.number, y.card.number));
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
          return `<li><a href="${escapeAttribute(detailUrl("set", card.set, "", card.game))}"><span class="dash-top-thumb">${thumb}</span>
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

  const uiCtx = () => ({ shared, graded, owned, prices, cards: () => cards, cardsById: () => cardsById, gameFilter: () => gameFilter, onChange: render });
  const gradedTileHtml = (card, it, sym) => window.TCGGradedUI.editableTileHtml(uiCtx(), card, it, sym);

  const openPicker = () => window.TCGGradedUI.openPicker(uiCtx());

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
      if (imageButton) { const co = imageButton.dataset.gradedCompany; preview.open(imageButton.dataset.previewCardId, imageButton.dataset.previewVariant, co ? { graded: { company: co, grade: imageButton.dataset.gradedGrade, pristine: imageButton.dataset.gradedPristine === "1" } } : undefined); }
    });
    window.TCGGradedUI.bindGridEvents(uiCtx(), elements.grid);
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
