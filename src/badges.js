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
  // tier = dificuldade CURADA (comum/rara/épica/lendária). Porcentagem real de
  // jogadores exigiria agregação no backend — quando houver, o tier vira %.
  const YEAR = String(new Date().getFullYear());
  const defs = [
    // Coleção (globais)
    { id: "first", emoji: "🃏", cur: copies, target: 1, tier: "common" },
    { id: "c100", emoji: "📦", cur: copies, target: 100, tier: "common" },
    { id: "c500", emoji: "🗃️", cur: copies, target: 500, tier: "rare" },
    { id: "c1000", emoji: "🏛️", cur: copies, target: 1000, tier: "epic" },
    { id: "c2500", emoji: "🏰", cur: copies, target: 2500, tier: "legendary" },
    { id: "d100", emoji: "🎴", cur: distinct, target: 100, tier: "common" },
    { id: "d250", emoji: "🎨", cur: distinct, target: 250, tier: "rare" },
    { id: "d500", emoji: "🖼️", cur: distinct, target: 500, tier: "epic" },
    // Marcas
    { id: "games2", emoji: "🎮", cur: gamesWith, target: 2, tier: "common" },
    { id: "games4", emoji: "🌍", cur: gamesWith, target: games.length, tier: "epic" },
    // Graded
    { id: "slab1", emoji: "💎", cur: slabs, target: 1, tier: "common" },
    { id: "slab5", emoji: "🏆", cur: slabs, target: 5, tier: "rare" },
    { id: "slab25", emoji: "👑", cur: slabs, target: 25, tier: "legendary" },
    // Wishlist
    { id: "wish10", emoji: "⭐", cur: wishes, target: 10, tier: "common" },
    { id: "target1", emoji: "🎯", cur: targets, target: 1, tier: "rare" },
    // Vendas
    { id: "sale1", emoji: "🏪", cur: selling, target: 1, tier: "common" },
    { id: "sold1", emoji: "🤝", cur: sold, target: 1, tier: "rare" },
    { id: "sold10", emoji: "📈", cur: sold, target: 10, tier: "epic" },
    // Organização
    { id: "binder1", emoji: "📒", cur: bindersCount, target: 1, tier: "common" },
    // Patrimônio (BRL)
    { id: "v1k", emoji: "💰", cur: valueBRL, target: 1000, tier: "rare" },
    { id: "v10k", emoji: "🪙", cur: valueBRL, target: 10000, tier: "epic" },
    { id: "v50k", emoji: "🐉", cur: valueBRL, target: 50000, tier: "legendary" },
    // Hidratadas (catálogo das suas cartas)
    { id: "set100", emoji: "🧩", cur: null, target: 1, tier: "epic" },
    { id: "sets5", emoji: "🗺️", cur: null, target: 5, tier: "legendary" },
    { id: "lang2", emoji: "🌎", cur: null, target: 2, tier: "common" },
    { id: "lang4", emoji: "🗣️", cur: null, target: 4, tier: "epic" },
    { id: "secret1", emoji: "✨", cur: null, target: 1, tier: "rare" },
    { id: "vintage1", emoji: "🕰️", cur: null, target: 1, tier: "rare" },
    { id: "old2005", emoji: "📼", cur: null, target: 1, tier: "epic" },
    // Sazonais (rotacionam com o calendário; recalculadas a cada visita)
    { id: "season90", emoji: "🚀", cur: null, target: 1, tier: "common", seasonal: true },
    { id: "seasonYear", emoji: "🗓️", cur: null, target: 10, tier: "rare", seasonal: true, nameArgs: { year: YEAR } }
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
    const tier = d.tier || "common";
    return `<article class="bdg${done ? " is-done" : ""}${isNew ? " is-new" : ""}" data-badge="${d.id}">
      ${isNew ? '<span class="bdg-new">✨</span>' : ""}
      ${done ? `<button type="button" class="bdg-share" data-share-badge="${d.id}" title="${escapeHtml(t("badges.share"))}" aria-label="${escapeHtml(t("badges.share"))}"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg></button>` : ""}
      <span class="bdg-emoji" aria-hidden="true">${d.emoji}</span>
      <strong class="bdg-name">${escapeHtml(t(`badge.${d.id}`, d.nameArgs))}</strong>
      <span class="bdg-desc">${escapeHtml(t(`badge.${d.id}.d`, d.nameArgs))}</span>
      <span class="bdg-tags">${d.seasonal ? `<span class="bdg-chip bdg-chip-season">${escapeHtml(t("badges.seasonal"))}</span>` : ""}<span class="bdg-chip" data-tier="${tier}">${escapeHtml(t(`badges.tier.${tier}`))}</span></span>
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

  // ── Compartilhar medalha como imagem (canvas 1080², CSP-safe: só emoji/texto,
  //    nenhuma imagem remota). navigator.share com arquivo no mobile; senão PNG.
  const TIER_COLORS = { common: "#8a93a3", rare: "#3b82f6", epic: "#a855f7", legendary: "#f0b84b" };
  function wrapText(ctx, text, x, y, maxW, lineH) {
    let line = "", yy = y;
    for (const w of String(text).split(" ")) {
      const probe = line ? `${line} ${w}` : w;
      if (ctx.measureText(probe).width > maxW && line) { ctx.fillText(line, x, yy); line = w; yy += lineH; }
      else line = probe;
    }
    if (line) { ctx.fillText(line, x, yy); yy += lineH; }
    return yy;
  }
  async function shareBadgeImage(d, btn) {
    const FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    const tier = TIER_COLORS[d.tier || "common"];
    const W = 1080, H = 1080;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#12141a"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = tier; ctx.lineWidth = 14; ctx.strokeRect(28, 28, W - 56, H - 56);
    // dobra de folha na quina (assinatura visual do site)
    ctx.fillStyle = tier; ctx.beginPath();
    ctx.moveTo(W - 28, H - 118); ctx.lineTo(W - 28, H - 28); ctx.lineTo(W - 118, H - 28); ctx.closePath(); ctx.fill();
    ctx.textAlign = "center";
    ctx.font = `240px ${FONT}`; ctx.textBaseline = "middle";
    ctx.fillText(d.emoji, W / 2, 330);
    ctx.textBaseline = "top";
    ctx.fillStyle = tier; ctx.font = `800 30px ${FONT}`;
    const tierLabel = `${t(`badges.tier.${d.tier || "common"}`)}${d.seasonal ? ` · ${t("badges.seasonal")}` : ""}`.toUpperCase();
    ctx.fillText(tierLabel, W / 2, 520);
    ctx.fillStyle = "#f3f5f7"; ctx.font = `800 62px ${FONT}`;
    ctx.fillText(t(`badge.${d.id}`, d.nameArgs), W / 2, 578);
    ctx.fillStyle = "#9ba4b3"; ctx.font = `500 34px ${FONT}`;
    wrapText(ctx, t(`badge.${d.id}.d`, d.nameArgs), W / 2, 680, 780, 46);
    const p = shared.getProfile();
    const who = (p.displayName || "").trim() || (p.handle ? `@${p.handle}` : "");
    ctx.fillStyle = "#f3f5f7"; ctx.font = `700 36px ${FONT}`;
    if (who) ctx.fillText(who, W / 2, 880);
    ctx.fillStyle = "#9ba4b3"; ctx.font = `700 30px ${FONT}`;
    ctx.fillText("sleevu.app", W / 2, who ? 930 : 890);
    if (btn) btn.disabled = true;
    canvas.toBlob(async (blob) => {
      if (btn) btn.disabled = false;
      if (!blob) return;
      const fname = `sleevu-badge-${d.id}.png`;
      const file = new File([blob], fname, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: t(`badge.${d.id}`, d.nameArgs) }); return; } catch (e) { /* cancelado */ }
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = fname; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  }
  el.grid.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-share-badge]");
    if (!btn) return;
    const d = defs.find((x) => x.id === btn.dataset.shareBadge);
    if (d) shareBadgeImage(d, btn);
  });

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
    const earnedDefs = defs.filter((d) => d.cur != null && d.cur >= d.target);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(earnedDefs.map((d) => d.id))); } catch (e) { /* quota */ }
    // Resumo pro card de Badges do perfil (profile.js) — UMA fonte de verdade:
    // o perfil só exibe o último cálculo feito aqui, nunca recalcula sozinho.
    try {
      localStorage.setItem("tcg-badges-summary-v1", JSON.stringify({
        earned: earnedDefs.length, total: defs.length, emojis: earnedDefs.map((d) => d.emoji)
      }));
    } catch (e) { /* quota */ }
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

    // Sazonais: contam cartas de sets pela DATA de lançamento (rotaciona sozinho
    // com o calendário — perder a condição no ano seguinte faz parte do jogo).
    const cut90 = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    const recent90 = mine.filter((c) => (c.setReleaseDate || "") >= cut90).length;
    const thisYear = mine.filter((c) => String(c.setReleaseDate || "").startsWith(YEAR)).length;

    const set = (id, cur) => { const d = defs.find((x) => x.id === id); if (d) d.cur = cur; };
    set("set100", complete >= 1 ? 1 : 0);
    set("sets5", complete);
    set("lang2", langs.size);
    set("lang4", langs.size);
    set("secret1", topRarity ? 1 : 0);
    set("vintage1", hasVintage ? 1 : 0);
    set("old2005", hasOld ? 1 : 0);
    set("season90", recent90);
    set("seasonYear", thisYear);
    render(); finish();
  }).catch(() => {
    defs.forEach((d) => { if (d.cur == null) d.cur = 0; });
    render(); finish();
  });
})();
