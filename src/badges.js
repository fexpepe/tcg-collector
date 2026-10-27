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
  // Desbloqueios já vistos ficam em localStorage -> medalha nova ganha o selo
  // de novidade (a estrelinha no canto).
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
  // Decks, listas, trocas e favoritos: quatro stores que o usuário já enche e
  // que nenhuma medalha olhava. Contam só o que existe de fato — deck apagado
  // vira tombstone em `deleted` e não pode continuar valendo medalha.
  const decksData = rawJson("tcg-collector-decks-all-v1");
  const decksCount = decksData && Array.isArray(decksData.decks)
    ? decksData.decks.filter((d) => d && d.id && !(decksData.deleted || {})[d.id]).length : 0;
  const listsData = rawJson("tcg-collector-lists-all-v1");
  const listsCount = listsData && Array.isArray(listsData.lists)
    ? listsData.lists.filter((l) => l && l.id && !(listsData.deleted || {})[l.id]).length : 0;
  const trades = (() => { const t = rawJson("tcg-trade-checks-v1"); return Array.isArray(t) ? t.length : 0; })();
  const favs = (() => { const f = rawJson("tcg-collector-favorites-v1"); return Array.isArray(f) ? f.length : 0; })();
  // Pokédex: capturados (marcados OU com carta) pelo cache da página da
  // Pokédex; sem ele, só os marcados à mão. Kanto = geração 1 (dex 1..151).
  const dexProg = shared.readDexProgress();
  const dexMarked = shared.createDexOwnedStore().toArray();
  const dexCount = Math.max(dexProg ? dexProg.c : 0, dexMarked.length);
  const kanto = dexProg && dexProg.gen && dexProg.gen["1"]
    ? dexProg.gen["1"].c
    : dexMarked.filter((id) => Number(id) >= 1 && Number(id) <= 151).length;
  const value = shared.portfolioValueTotal() || 0;
  const valueBRL = Math.floor(shared.convertMoney(value, shared.getCurrency(), "BRL") ?? value);

  // ── Ícones (SVG de traço, 24×24) ─────────────────────────────────────────────
  // Eram emoji até 2026-10-27 (a regra do site é SVG): cada sistema desenhava
  // um, o Windows trocava cor por contorno e a imagem de compartilhar saía com
  // a fonte de emoji de quem gerava. Um traço só por ícone (o "d" de um
  // <path>), pra servir aos três lugares: o <svg> da grade, o Path2D do canvas
  // de compartilhar e o resumo que o perfil mostra (tcg-badges-summary-v1).
  const roda = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
  const IC = {
    first: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM10.5 9.5 12 8v8M10 16h4",
    c100: "M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9",
    c500: "M3 4h18v4H3zM5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4",
    c1000: "M4 13h7v7H4zM13 13h7v7h-7zM8.5 5h7v8h-7z",
    c2500: "M4 21V8h2.5v2H9V8h2v2h2V8h2v2h2.5V8H20v13zM10 21v-4a2 2 0 0 1 4 0v4",
    d100: "M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
    d250: "M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6" + roda(16, 9, 1.5),
    d500: "M3 21h18M5 18h14M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 3l8 5H4z",
    games2: "M6 11h4M8 9v4M15 12h.01M18 10h.01M17.3 5H6.7a4 4 0 0 0-3.98 3.59L2 15a3 3 0 0 0 5.36 2.02L9 15h6l1.64 2.02A3 3 0 0 0 22 15l-.72-6.41A4 4 0 0 0 17.3 5z",
    games4: roda(12, 12, 9) + "M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z",
    slab1: "M6 2h12a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM5 7h14M8.5 10h7v9h-7z",
    slab5: "M3 5h5v12H3zM9.5 5h5v12h-5zM16 5h5v12h-5zM2 21h20",
    slab25: "M3 4h18v15H3zM6 19v2M18 19v2M12 8v1M12 14v1M8.5 11.5h1M14.5 11.5h1" + roda(12, 11.5, 3.5),
    wish10: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z",
    target1: roda(12, 12, 9) + roda(12, 12, 5) + roda(12, 12, 1),
    sale1: "M3 9l1.5-5h15L21 9zM4 9v11h16V9M9 20v-6h6v6",
    sold1: "M3 3h8l10 10-8 8L3 11z" + roda(7.5, 7.5, 1.5),
    sold10: "M3 17l6-6 4 4 8-8M14 7h7v7",
    binder1: "M7 3h12v18H7zM4 7.5h5M4 12h5M4 16.5h5",
    list1: "M9 3h6v3H9zM7 4.5H5v16h14v-16h-2M8 10h8M8 14h8M8 18h5",
    deck1: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z",
    deck5: "M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2",
    trade1: "M4 7h13M14 4l3 3-3 3M20 17H7M10 14l-3 3 3 3",
    trade10: "M12 3v18M7 21h10M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2M16 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1zM2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z",
    fav10: "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z",
    dex50: roda(12, 12, 9) + roda(12, 12, 3) + "M3 12h6M15 12h6",
    dex151: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14",
    dex500: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5",
    dex1025: "M8.5 2 12 8l3.5-6" + roda(12, 15, 6) + roda(12, 15, 2.5),
    v1k: "M2 6h20v12H2zM6 12h.01M18 12h.01" + roda(12, 12, 2.5),
    v10k: roda(8, 8, 6) + "M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82",
    v50k: "M6 3h12l4 6-10 13L2 9zM11 3 8 9l4 13 4-13-3-6M2 9h20",
    set100: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 17.5l2 2 4-4",
    sets5: roda(12, 12, 9) + "M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36z",
    lang2: "M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6",
    lang4: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM8 9h8M8 13h5",
    secret1: "M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8zM18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z",
    vintage1: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2",
    old2005: "M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM10 11h4M6 19l2-4h8l2 4" + roda(8, 11, 2) + roda(16, 11, 2),
    season90: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2zM9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5",
    seasonYear: "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01",
    // Torre de cartas (as barras de comparação) e os dois selos do card.
    giraffe: "M4 15v-4h8l3-7 4 1v1.5l-2.5.5L14 15zM5.5 15v6M12.5 15v6M15.5 4.2V2.2",
    christ: roda(12, 4, 1.6) + "M3 8.5h18M10.5 8.5 9.2 19h5.6L13.5 8.5M7.5 19h9v3h-9z",
    eiffel: "M12 2v3M10.5 5h3M10.5 5 6 22M13.5 5 18 22M8.4 12h7.2M5 22h4M15 22h4M9.5 22a2.5 2.5 0 0 1 5 0",
    novo: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
    feito: "M5 12.5l4.5 4.5L19 7.5"
  };
  const svg = (d, size) => `<svg viewBox="0 0 24 24"${size ? ` width="${size}" height="${size}"` : ""} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

  // ── Definições (id, alvo, valor atual; hidratadas começam nulas) ─────────────
  // O ícone de cada uma é IC[id].
  // key/desc no i18n: badge.<id> / badge.<id>.d
  // tier = dificuldade CURADA (comum/rara/épica/lendária). Porcentagem real de
  // jogadores exigiria agregação no backend — quando houver, o tier vira %.
  const YEAR = String(new Date().getFullYear());
  const defs = [
    // Coleção (globais)
    { id: "first", cur: copies, target: 1, tier: "common" },
    { id: "c100", cur: copies, target: 100, tier: "common" },
    { id: "c500", cur: copies, target: 500, tier: "rare" },
    { id: "c1000", cur: copies, target: 1000, tier: "epic" },
    { id: "c2500", cur: copies, target: 2500, tier: "legendary" },
    { id: "d100", cur: distinct, target: 100, tier: "common" },
    { id: "d250", cur: distinct, target: 250, tier: "rare" },
    { id: "d500", cur: distinct, target: 500, tier: "epic" },
    // Marcas
    { id: "games2", cur: gamesWith, target: 2, tier: "common" },
    { id: "games4", cur: gamesWith, target: games.length, tier: "epic" },
    // Graded
    { id: "slab1", cur: slabs, target: 1, tier: "common" },
    { id: "slab5", cur: slabs, target: 5, tier: "rare" },
    { id: "slab25", cur: slabs, target: 25, tier: "legendary" },
    // Wishlist
    { id: "wish10", cur: wishes, target: 10, tier: "common" },
    { id: "target1", cur: targets, target: 1, tier: "rare" },
    // Vendas
    { id: "sale1", cur: selling, target: 1, tier: "common" },
    { id: "sold1", cur: sold, target: 1, tier: "rare" },
    { id: "sold10", cur: sold, target: 10, tier: "epic" },
    // Organização
    { id: "binder1", cur: bindersCount, target: 1, tier: "common" },
    { id: "list1", cur: listsCount, target: 1, tier: "common" },
    // Decks
    { id: "deck1", cur: decksCount, target: 1, tier: "common" },
    { id: "deck5", cur: decksCount, target: 5, tier: "rare" },
    // Trocas (o histórico é deste aparelho — ver troca.html)
    { id: "trade1", cur: trades, target: 1, tier: "common" },
    { id: "trade10", cur: trades, target: 10, tier: "rare" },
    // Pokédex
    { id: "fav10", cur: favs, target: 10, tier: "common" },
    { id: "dex50", cur: dexCount, target: 50, tier: "common" },
    { id: "dex151", cur: kanto, target: 151, tier: "epic" },
    { id: "dex500", cur: dexCount, target: 500, tier: "rare" },
    { id: "dex1025", cur: dexCount, target: 1025, tier: "legendary" },
    // Patrimônio (BRL)
    { id: "v1k", cur: valueBRL, target: 1000, tier: "rare" },
    { id: "v10k", cur: valueBRL, target: 10000, tier: "epic" },
    { id: "v50k", cur: valueBRL, target: 50000, tier: "legendary" },
    // Hidratadas (catálogo das suas cartas)
    { id: "set100", cur: null, target: 1, tier: "epic" },
    { id: "sets5", cur: null, target: 5, tier: "legendary" },
    { id: "lang2", cur: null, target: 2, tier: "common" },
    { id: "lang4", cur: null, target: 4, tier: "epic" },
    { id: "secret1", cur: null, target: 1, tier: "rare" },
    { id: "vintage1", cur: null, target: 1, tier: "rare" },
    { id: "old2005", cur: null, target: 1, tier: "epic" },
    // Sazonais (rotacionam com o calendário; recalculadas a cada visita)
    { id: "season90", cur: null, target: 1, tier: "common", seasonal: true },
    { id: "seasonYear", cur: null, target: 10, tier: "rare", seasonal: true, nameArgs: { year: YEAR } }
  ];

  // ── Render ──────────────────────────────────────────────────────────────────
  function badgeHtml(d) {
    const pending = d.cur == null;
    const done = !pending && d.cur >= d.target;
    const isNew = done && !seenSet.has(d.id);
    const pct = pending ? 0 : Math.min(100, (d.cur / d.target) * 100);
    const progress = done
      ? `<span class="bdg-done-tag">${svg(IC.feito)}</span>`
      : pending
        ? `<span class="bdg-progress">…</span>`
        : `<span class="bdg-progress">${Math.min(d.cur, d.target).toLocaleString(shared.getLocale())}/${d.target.toLocaleString(shared.getLocale())}</span>`;
    const tier = d.tier || "common";
    return `<article class="bdg${done ? " is-done" : ""}${isNew ? " is-new" : ""}" data-badge="${d.id}" data-tier="${tier}">
      ${isNew ? `<span class="bdg-new">${svg(IC.novo)}</span>` : ""}
      ${done ? `<button type="button" class="bdg-share" data-share-badge="${d.id}" title="${escapeHtml(t("badges.share"))}" aria-label="${escapeHtml(t("badges.share"))}"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg></button>` : ""}
      <span class="bdg-ic">${svg(IC[d.id])}</span>
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

  // ── Compartilhar medalha como imagem (canvas 1080², CSP-safe: o ícone é o
  //    mesmo traço do SVG, desenhado com Path2D, e texto — nenhuma imagem remota). navigator.share com arquivo no mobile; senão PNG.
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
    // Ícone: o traço 24×24 em escala 10 (240px), na cor da raridade.
    ctx.save();
    ctx.translate(W / 2 - 120, 330 - 120);
    ctx.scale(10, 10);
    ctx.strokeStyle = tier; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.stroke(new Path2D(IC[d.id]));
    ctx.restore();
    ctx.textAlign = "center";
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
      { key: "badges.fun.giraffe", h: 5.5, ic: IC.giraffe },
      { key: "badges.fun.christ", h: 38, ic: IC.christ },
      { key: "badges.fun.eiffel", h: 330, ic: IC.eiffel }
    ];
    el.funBars.innerHTML = refs.map((r) => {
      const ratio = stackM / r.h;
      const pct = Math.min(100, ratio * 100);
      const times = ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10;
      return `<div class="bdg-fun-bar"><span class="bdg-fun-ic">${svg(r.ic)}</span>
        <div class="bdg-fun-track"><span style="width:${Math.max(2, pct)}%"></span></div>
        <span class="bdg-fun-x"><strong>${times.toLocaleString(shared.getLocale())}×</strong> ${escapeHtml(t(r.key))}</span></div>`;
    }).join("");
    el.fun.hidden = false;
  }

  // ── Hidratação (medalhas de catálogo) ──────────────────────────────────────
  const ownedByGame = Object.fromEntries(games.map((g, i) => [g, stores[i]]));
  const idsByGame = Object.fromEntries(games.map((g) => [g, ownedByGame[g].knownCardIds()]));
  const finish = () => {
    // marca tudo que está desbloqueado como visto (o selo de novo desta visita permanece)
    const earnedDefs = defs.filter((d) => d.cur != null && d.cur >= d.target);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(earnedDefs.map((d) => d.id))); } catch (e) { /* quota */ }
    // Resumo pro card de Badges do perfil (profile.js) — UMA fonte de verdade:
    // o perfil só exibe o último cálculo feito aqui, nunca recalcula sozinho.
    // `icones` leva o traço de cada uma (o perfil não carrega este arquivo);
    // era `emojis` até 2026-10-27 — resumo antigo só mostra a contagem até a
    // próxima visita aqui.
    try {
      localStorage.setItem("tcg-badges-summary-v1", JSON.stringify({
        earned: earnedDefs.length, total: defs.length, icones: earnedDefs.map((d) => IC[d.id])
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
      return shared.cardVariants(card).some((v) => owned.variantTotal(card.id, v) > 0);
    });

    // Sets 100%: cartas possuídas por set vs total oficial do set (qualquer jogo)
    const bySet = new Map();
    mine.forEach((c) => {
      if (shared.isBonusCard(c)) return; // bônus não é preciso pra fechar o set
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
    // Catálogo não veio (soluço de rede/CDN): NÃO zerar. Zerar pintava todas as
    // medalhas de catálogo como "0/target" e o usuário via progresso PERDIDO. Deixar
    // cur == null as mantém no estado pending ("…", barra vazia) — "ainda não calculado",
    // que é a verdade. As medalhas que não dependem de catálogo já têm cur e aparecem.
    render(); finish();
  });
})();
