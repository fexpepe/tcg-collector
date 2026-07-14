(function () {
  const shared = window.TCGShared;
  const { t, escapeHtml } = shared;

  // ═══════════════════════════════════════════════════════════════════════════
  // BADGES (gamification V1): medalhas do colecionador, quase todas GLOBAIS
  // (qualquer jogo conta — quem coleciona uma marca só desbloqueia igual).
  //
  // Duas ondas de cálculo:
  //   1) INSTANTÂNEA: stores locais + cookie do Portfólio (sem catálogo);
  //   2) HIDRATADA: carrega só as suas cartas (pill do shared) pra medalhas de
  //      set completo, idiomas, raridade e vintage.
  // Desbloqueios já vistos ficam em localStorage -> medalha nova ganha ✨.
  // ═══════════════════════════════════════════════════════════════════════════
  const SEEN_KEY = "tcg-badges-seen-v1";
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]") || []; } catch (e) { seen = []; }
  const seenSet = new Set(seen);

  const el = {
    earned: document.getElementById("bdgEarned"),
    total: document.getElementById("bdgTotal"),
    bar: document.getElementById("bdgScoreBar"),
    grid: document.getElementById("bdgGrid"),
    fun: document.getElementById("bdgFun"),
    funLine: document.getElementById("bdgFunLine"),
    funBars: document.getElementById("bdgFunBars")
  };

  // ── Métricas instantâneas ───────────────────────────────────────────────────
  const games = shared.GAME_SLUGS;
  const stores = games.map((g) => shared.createCollectionStore(g));
  const counts = shared.collectionCounts();
  const copies = counts.copies;
  const distinct = counts.distinct;
  const gamesWith = stores.filter((st) => st.size > 0).length;
  const rawJson = (key) => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } };
  const gradedData = rawJson("tcg-collector-collection-graded-v1");
  const slabs = gradedData && Array.isArray(gradedData.order) ? gradedData.order.length : 0;
  const salesData = rawJson("tcg-collector-collection-sales-v1");
  const selling = salesData && Array.isArray(salesData.order) ? salesData.order.length : 0;
  const sold = shared.readSoldList().length;
  const wishes = games.reduce((s, g) => s + shared.createWishlistStore(g).size, 0);
  const targets = shared.createWishTargetsStore().entries().length;
  const bindersCount = games.reduce((s, g) => {
    const d = rawJson(`tcg-collector-${g}-binders-v1`);
    return s + (d && Array.isArray(d.folders) ? d.folders.length : (d && Array.isArray(d.list) ? d.list.length : 0));
  }, 0);
  const value = shared.portfolioValueTotal() || 0;
  const valueBRL = Math.floor(shared.convertMoney(value, shared.getCurrency(), "BRL") ?? value);

  // ── Definições (id, emoji, alvo, valor atual; hidratadas começam nulas) ────
  // key/desc no i18n: badge.<id> / badge.<id>.d
  const defs = [
    // Coleção (globais)
    { id: "first", emoji: "🃏", cur: copies, target: 1 },
    { id: "c100", emoji: "📦", cur: copies, target: 100 },
    { id: "c500", emoji: "🗃️", cur: copies, target: 500 },
    { id: "c1000", emoji: "🏛️", cur: copies, target: 1000 },
    { id: "c2500", emoji: "🏰", cur: copies, target: 2500 },
    { id: "d100", emoji: "🎴", cur: distinct, target: 100 },
    { id: "d250", emoji: "🎨", cur: distinct, target: 250 },
    { id: "d500", emoji: "🖼️", cur: distinct, target: 500 },
    // Marcas
    { id: "games2", emoji: "🎮", cur: gamesWith, target: 2 },
    { id: "games4", emoji: "🌍", cur: gamesWith, target: games.length },
    // Graded
    { id: "slab1", emoji: "💎", cur: slabs, target: 1 },
    { id: "slab5", emoji: "🏆", cur: slabs, target: 5 },
    { id: "slab25", emoji: "👑", cur: slabs, target: 25 },
    // Wishlist
    { id: "wish10", emoji: "⭐", cur: wishes, target: 10 },
    { id: "target1", emoji: "🎯", cur: targets, target: 1 },
    // Vendas
    { id: "sale1", emoji: "🏪", cur: selling, target: 1 },
    { id: "sold1", emoji: "🤝", cur: sold, target: 1 },
    { id: "sold10", emoji: "📈", cur: sold, target: 10 },
    // Organização
    { id: "binder1", emoji: "📒", cur: bindersCount, target: 1 },
    // Patrimônio (BRL)
    { id: "v1k", emoji: "💰", cur: valueBRL, target: 1000 },
    { id: "v10k", emoji: "🪙", cur: valueBRL, target: 10000 },
    { id: "v50k", emoji: "🐉", cur: valueBRL, target: 50000 },
    // Hidratadas (catálogo das suas cartas)
    { id: "set100", emoji: "🧩", cur: null, target: 1 },
    { id: "sets5", emoji: "🗺️", cur: null, target: 5 },
    { id: "lang2", emoji: "🌎", cur: null, target: 2 },
    { id: "lang4", emoji: "🗣️", cur: null, target: 4 },
    { id: "secret1", emoji: "✨", cur: null, target: 1 },
    { id: "vintage1", emoji: "🕰️", cur: null, target: 1 },
    { id: "old2005", emoji: "📼", cur: null, target: 1 }
  ];

  // ── Render ──────────────────────────────────────────────────────────────────
  function badgeHtml(d) {
    const pending = d.cur == null;
    const done = !pending && d.cur >= d.target;
    const isNew = done && !seenSet.has(d.id);
    const pct = pending ? 0 : Math.min(100, (d.cur / d.target) * 100);
    const progress = done
      ? `<span class="bdg-done-tag">✓</span>`
      : pending
        ? `<span class="bdg-progress">…</span>`
        : `<span class="bdg-progress">${Math.min(d.cur, d.target).toLocaleString(shared.getLocale())}/${d.target.toLocaleString(shared.getLocale())}</span>`;
    return `<article class="bdg${done ? " is-done" : ""}${isNew ? " is-new" : ""}" data-badge="${d.id}">
      ${isNew ? '<span class="bdg-new">✨</span>' : ""}
      <span class="bdg-emoji" aria-hidden="true">${d.emoji}</span>
      <strong class="bdg-name">${escapeHtml(t(`badge.${d.id}`))}</strong>
      <span class="bdg-desc">${escapeHtml(t(`badge.${d.id}.d`))}</span>
      <div class="progress-bar bdg-bar"><span style="width:${pct}%"></span></div>
      ${progress}
    </article>`;
  }
  function render() {
    const ready = defs.filter((d) => d.cur != null);
    const earned = ready.filter((d) => d.cur >= d.target);
    el.earned.textContent = String(earned.length);
    el.total.textContent = String(defs.length);
    el.bar.style.width = `${Math.min(100, (earned.length / defs.length) * 100)}%`;
    // Desbloqueadas primeiro (novas na frente), depois as mais próximas do alvo.
    const sorted = defs.slice().sort((a, b) => {
      const da = a.cur != null && a.cur >= a.target, db = b.cur != null && b.cur >= b.target;
      if (da !== db) return da ? -1 : 1;
      const na = da && !seenSet.has(a.id), nb = db && !seenSet.has(b.id);
      if (na !== nb) return na ? -1 : 1;
      const pa = a.cur == null ? 0 : a.cur / a.target, pb = b.cur == null ? 0 : b.cur / b.target;
      return pb - pa;
    });
    el.grid.innerHTML = sorted.map(badgeHtml).join("");
  }
  render();

  // ── Torre de cartas (cápsula divertida, estilo Flighty) ────────────────────
  // Carta padrão ~0,305mm de espessura e ~1,73g. Comparações com barras de
  // multiplicador (✕), como o "Around Earth" do Flighty.
  if (copies > 0) {
    const stackM = (copies * 0.000305);
    const weightKg = (copies * 1.73) / 1000;
    const fmt = (n) => n.toLocaleString(shared.getLocale(), { maximumFractionDigits: n >= 10 ? 0 : 1 });
    const stackTxt = stackM >= 1 ? `${fmt(stackM)} m` : `${fmt(stackM * 100)} cm`;
    const weightTxt = weightKg >= 1 ? `${fmt(weightKg)} kg` : `${fmt(weightKg * 1000)} g`;
    el.funLine.innerHTML = t("badges.funLine", { stack: `<strong>${stackTxt}</strong>`, weight: `<strong>${weightTxt}</strong>` });
    const refs = [
      { key: "badges.fun.giraffe", h: 5.5, emoji: "🦒" },
      { key: "badges.fun.christ", h: 38, emoji: "🗽" },
      { key: "badges.fun.eiffel", h: 330, emoji: "🗼" }
    ];
    el.funBars.innerHTML = refs.map((r) => {
      const ratio = stackM / r.h;
      const pct = Math.min(100, ratio * 100);
      const times = ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10;
      return `<div class="bdg-fun-bar"><span class="bdg-fun-ic" aria-hidden="true">${r.emoji}</span>
        <div class="bdg-fun-track"><span style="width:${Math.max(2, pct)}%"></span></div>
        <span class="bdg-fun-x"><strong>${times.toLocaleString(shared.getLocale())}×</strong> ${escapeHtml(t(r.key))}</span></div>`;
    }).join("");
    el.fun.hidden = false;
  }

  // ── Hidratação (medalhas de catálogo) ──────────────────────────────────────
  const ownedByGame = Object.fromEntries(games.map((g, i) => [g, stores[i]]));
  const idsByGame = Object.fromEntries(games.map((g) => [g, ownedByGame[g].knownCardIds()]));
  const finish = () => {
    // marca tudo que está desbloqueado como visto (o ✨ desta visita permanece)
    const earnedIds = defs.filter((d) => d.cur != null && d.cur >= d.target).map((d) => d.id);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(earnedIds)); } catch (e) { /* quota */ }
  };
  if (!Object.values(idsByGame).some((ids) => ids.length)) {
    defs.forEach((d) => { if (d.cur == null) d.cur = 0; });
    render(); finish();
    return;
  }
  shared.loadOwnedAcrossGames(idsByGame).then((catalog) => {
    const cards = catalog.cards || [];
    const cardGameMap = new Map(cards.map((c) => [c.id, c.game]));
    const owned = shared.mergedCollectionStore(ownedByGame, (id) => cardGameMap.get(id) || "pokemon");
    const seenIds = new Set();
    const mine = cards.filter((card) => {
      if (seenIds.has(card.id)) return false;
      seenIds.add(card.id);
      return (card.variants || ["Normal"]).some((v) => owned.variantTotal(card.id, v) > 0);
    });

    // Sets 100%: cartas possuídas por set vs total oficial do set (qualquer jogo)
    const bySet = new Map();
    mine.forEach((c) => {
      const k = `${c.game}:${c.set}`;
      const e = bySet.get(k) || { have: 0, total: Number(c.setTotal) || 0 };
      e.have += 1;
      e.total = Math.max(e.total, Number(c.setTotal) || 0);
      bySet.set(k, e);
    });
    const complete = [...bySet.values()].filter((e) => e.total > 0 && e.have >= e.total).length;
    const langs = new Set(mine.map((c) => shared.cardLanguageRegion(c.language)));
    const topRarity = mine.some((c) => shared.rarityRank(c.rarity) >= 70);
    const hasVintage = mine.some((c) => c.vintage);
    const hasOld = mine.some((c) => (c.setReleaseDate || "9999") < "2005");

    const set = (id, cur) => { const d = defs.find((x) => x.id === id); if (d) d.cur = cur; };
    set("set100", complete >= 1 ? 1 : 0);
    set("sets5", complete);
    set("lang2", langs.size);
    set("lang4", langs.size);
    set("secret1", topRarity ? 1 : 0);
    set("vintage1", hasVintage ? 1 : 0);
    set("old2005", hasOld ? 1 : 0);
    render(); finish();
  }).catch(() => {
    defs.forEach((d) => { if (d.cur == null) d.cur = 0; });
    render(); finish();
  });
})();
