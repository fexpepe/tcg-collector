(function () {
  const shared = window.TCGShared;
  const { t, tn, escapeHtml, escapeAttribute } = shared;

  // Dashboard do jogador: o HUB pessoal. Renderiza INSTANTÂNEO só com
  // localStorage + cookie do Portfólio (sem catálogo); a seção "mais valiosas"
  // hidrata depois, carregando apenas as cartas que o usuário tem.
  const el = {
    profile: document.getElementById("dashProfileLine"),
    value: document.getElementById("dhValue"),
    copies: document.getElementById("dhCopies"),
    distinct: document.getElementById("dhDistinct"),
    wish: document.getElementById("dhWish"),
    slabs: document.getElementById("dhSlabs"),
    games: document.getElementById("dhGames"),
    links: document.getElementById("dhLinks"),
    caps: document.getElementById("dhCaps"),
    topList: document.getElementById("dhTopList"),
    dist: document.getElementById("dhDist"),
    region: document.getElementById("dhRegion")
  };

  // ── Leituras locais (read-only, defensivas) ─────────────────────────────────
  const rawJson = (key) => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } };
  const gradedCount = () => {
    const d = rawJson("tcg-collector-collection-graded-v1");
    return d && Array.isArray(d.order) ? d.order.length : 0;
  };
  const salesCount = () => {
    const d = rawJson("tcg-collector-collection-sales-v1");
    return d && Array.isArray(d.order) ? d.order.length : 0;
  };

  const ownedByGame = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, shared.createCollectionStore(g)]));
  const wishlistByGame = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, shared.createWishlistStore(g)]));

  // Cartas distintas (qty > 0) de um jogo, direto do store.
  function distinctOf(game) {
    const obj = ownedByGame[game].toObject();
    let n = 0;
    Object.keys(obj).forEach((cardId) => {
      const hasQty = Object.values(obj[cardId] || {}).some((conds) =>
        Object.values(conds || {}).some((q) => Number(q) > 0));
      if (hasQty) n += 1;
    });
    return n;
  }

  // ── Resumo instantâneo ──────────────────────────────────────────────────────
  const counts = shared.collectionCounts();
  el.copies.textContent = String(counts.copies);
  el.distinct.textContent = String(counts.distinct);
  const wishTotal = shared.GAME_SLUGS.reduce((n, g) => n + wishlistByGame[g].knownCardIds().length, 0);
  el.wish.textContent = String(wishTotal);
  const slabs = gradedCount();
  el.slabs.textContent = String(slabs);

  const pf = shared.portfolioValueTotal();
  el.value.textContent = pf != null ? shared.formatMoney(shared.getCurrency(), pf) : "—";
  if (pf == null) el.value.parentElement.title = t("dash.pfHint");

  // Perfil (nome/handle + link do perfil público quando existe)
  const profile = shared.getProfile();
  if (profile.displayName || profile.handle) {
    const who = profile.displayName || `@${profile.handle}`;
    const link = profile.handle && profile.isPublic
      ? ` · <a href="/users/${escapeAttribute(profile.handle)}">${escapeHtml(t("dash.publicProfile"))}</a>`
      : "";
    el.profile.innerHTML = `${escapeHtml(who)}${link}`;
    el.profile.hidden = false;
  }

  // ── Distribuição por marca (chips) ─────────────────────────────────────────
  const gameLabel = (g) => shared.gameLabel(g);
  const dist = shared.GAME_SLUGS
    .map((g) => ({ g, n: distinctOf(g) }))
    .filter((x) => x.n > 0);
  el.games.innerHTML = dist.length
    ? dist.map(({ g, n }) =>
        `<a class="dash-game-chip" href="collection.html" style="--chip:${shared.GAME_COLOR[g]}"><span class="dash-game-dot" aria-hidden="true"></span>${escapeHtml(gameLabel(g))}<strong>${n}</strong></a>`).join("")
    : `<p class="empty-state">${escapeHtml(t("dash.empty"))}</p>`;

  // ── Atalhos (HUB) ───────────────────────────────────────────────────────────
  const IC = {
    collection: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="12" height="16" rx="2" transform="rotate(-8 10 14)"/><rect x="9" y="4" width="12" height="16" rx="2" transform="rotate(6 15 12)"/></svg>',
    graded: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><rect x="8" y="8" width="8" height="10" rx="1"/><path d="M8 5.5h8"/></svg>',
    wishlist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 8.6c0-2.5-2-4.6-4.5-4.6-1.9 0-3.5 1.1-4.3 2.8-.8-1.7-2.4-2.8-4.3-2.8C5.2 4 3.2 6.1 3.2 8.6c0 5 8.8 10.4 8.8 10.4s8.8-5.4 8.8-10.4Z"/></svg>',
    binders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>',
    sales: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-5L9 3 4 7H3v13h17V7Z"/><path d="M12 11v5"/><path d="M9.5 13.5h5"/></svg>',
    portfolio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18"/><path d="m4 15 5-6 4 3 6-8"/></svg>',
    explore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
    games: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/></svg>',
    badges: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="6"/><path d="m8.5 14-2 7 5.5-3 5.5 3-2-7"/></svg>'
  };
  const soldTotal = shared.readSoldList().length;
  const links = [
    { href: "collection.html", icon: "collection", key: "nav.collectionMine", stat: tn("count.cards", counts.distinct) },
    { href: "graded.html", icon: "graded", key: "nav.graded", stat: tn("dash.slabsCount", slabs) },
    { href: "wishlist.html", icon: "wishlist", key: "nav.wishlist", stat: tn("dash.wishCount", wishTotal) },
    { href: "binders.html", icon: "binders", key: "nav.binders", stat: "" },
    { href: "sales.html", icon: "sales", key: "nav.sales", stat: tn("dash.salesCount", salesCount()) + (soldTotal ? ` · ${tn("dash.soldCount", soldTotal)}` : "") },
    { href: "portfolio.html", icon: "portfolio", key: "nav.portfolio", stat: pf != null ? shared.formatMoney(shared.getCurrency(), pf) : "" },
    { href: "badges.html", icon: "badges", key: "dash.badges", stat: t("dash.badgesHint") },
    { href: "explore.html", icon: "explore", key: "nav.explore", stat: t("dash.exploreHint") },
    { href: "hub.html", icon: "games", key: "nav.games", stat: t("dash.gamesHint") }
  ];
  el.links.innerHTML = links.map((l) =>
    `<a class="dash-link" href="${escapeAttribute(l.href)}">
      <span class="dash-link-ic" aria-hidden="true">${IC[l.icon]}</span>
      <span class="dash-link-body"><strong>${escapeHtml(t(l.key))}</strong>${l.stat ? `<span>${escapeHtml(l.stat)}</span>` : ""}</span>
      <span class="dash-link-go" aria-hidden="true">→</span>
    </a>`).join("");

  // ── Cápsulas detalhadas (hidratam depois; só as cartas que você tem) ───────
  // Mesmo visual da antiga dashboard da Coleção (que ficou só com os stats):
  // Mais valiosas (top 3 por valor unitário) + distribuição por jogo e região.
  const idsByGame = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, ownedByGame[g].knownCardIds()]));
  if (!Object.values(idsByGame).some((ids) => ids.length)) return;
  const pricesByGame = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, shared.createPriceStore(g)]));
  const cardGameMap = new Map();
  const gameOf = (id) => cardGameMap.get(id) || "pokemon";
  const prices = shared.mergedPriceStore(pricesByGame, gameOf);

  Promise.all([shared.loadOwnedAcrossGames(idsByGame), shared.loadFxRates()]).then(([catalog]) => {
    const cards = catalog.cards || [];
    cards.forEach((c) => cardGameMap.set(c.id, c.game));
    const owned = shared.mergedCollectionStore(ownedByGame, gameOf);
    const seen = new Set();
    const myCards = cards.filter((card) => {
      if (seen.has(card.id)) return false;
      seen.add(card.id);
      return (card.variants || ["Normal"]).some((v) => owned.variantTotal(card.id, v) > 0);
    });
    if (!myCards.length) return;

    // Mais valiosas (top 3 por valor unitário, como era na Coleção)
    const top = myCards.map((card) => {
      const variant = (card.variants || []).find((v) => owned.variantTotal(card.id, v) > 0) || shared.defaultVariant(card);
      return { card, val: shared.cardValue(card, variant, prices).value || 0 };
    }).filter((x) => x.val > 0).sort((a, b) => b.val - a.val).slice(0, 3);
    el.topList.innerHTML = top.length
      ? top.map(({ card, val }) => {
          const src = shared.cardImageSources(card);
          const thumb = shared.localizedImg(src.url, { alt: "", fallback: src.fallback, loading: "lazy", thumb: true });
          return `<li><a href="${escapeAttribute(shared.detailUrl("set", card.set, "", card.game))}"><span class="dash-top-thumb">${thumb}</span>
            <span class="dash-top-info"><strong>${escapeHtml(card.name)}</strong><span class="dash-top-set">${escapeHtml(card.set)}</span></span>
            <span class="dash-top-val">${escapeHtml(shared.formatMoney(shared.getCurrency(), val))}</span></a></li>`;
        }).join("")
      : `<li class="dash-empty">${escapeHtml(t("dash.empty"))}</li>`;

    // Distribuição por jogo
    const byGame = {};
    myCards.forEach((card) => { byGame[card.game] = (byGame[card.game] || 0) + 1; });
    el.dist.innerHTML = shared.distBarsHtml(shared.GAME_SLUGS.map((g) => ({ label: gameLabel(g), n: byGame[g] || 0, color: shared.GAME_COLOR[g] })));

    // Distribuição por região/idioma (flag SVG como na Coleção)
    const byRegion = {};
    myCards.forEach((card) => { const r = shared.cardLanguageRegion(card.language); byRegion[r] = (byRegion[r] || 0) + 1; });
    const regions = [
      { region: "english", lang: "en", color: "#2aa3df" },
      { region: "japanese", lang: "ja", color: "#d23b4e" },
      { region: "portuguese", lang: "pt", color: "#1f9d77" },
      { region: "chinese", lang: "zh", color: "#e0992f" }
    ];
    el.region.innerHTML = shared.distBarsHtml(regions.map((r) => ({
      label: `${shared.cardFlag(r.lang)}<span>${escapeHtml(t("setRegion." + r.region).replace(/\s*\(.*/, ""))}</span>`,
      n: byRegion[r.region] || 0, color: r.color
    })));

    el.caps.hidden = false;
  }).catch(() => { /* rede: o resto do dashboard já está renderizado */ });
})();
