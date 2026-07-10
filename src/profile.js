// Página de perfil do DONO logado (profile.html): o "hub" da conta — identidade
// (avatar/nome/@/email), status público/privado, stats rápidas (sem catálogo) e
// atalhos pra editar/ver o perfil público. Tudo client-side.
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const root = document.getElementById("profileRoot");
  if (!root) return;
  const t = shared.t;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // --- Conquistas (gamification, estilo Collectr goals) ---
  // 100% derivadas dos dados LOCAIS (coleção/graded/wishlist/valor gravado) —
  // sem backend, sem catálogo. Cada uma: alvo, valor atual e emoji.
  function achievements() {
    const games = shared.GAME_SLUGS;
    const stores = games.map((g) => shared.createCollectionStore(g));
    const copies = stores.reduce((s, st) => s + st.totalQuantity(), 0);
    const distinct = stores.reduce((s, st) => s + st.size, 0);
    const gamesWith = stores.filter((st) => st.size > 0).length;
    const slabs = shared.gradedSlabsValued(() => null).length;
    const wishes = games.reduce((s, g) => s + shared.createWishlistStore(g).size, 0);
    const value = shared.portfolioValueTotal() || 0;
    const valueBRL = shared.convertMoney(value, shared.getCurrency(), "BRL") ?? value;
    return [
      { id: "first", emoji: "🃏", key: "ach.first", cur: copies, target: 1 },
      { id: "c100", emoji: "📦", key: "ach.c100", cur: copies, target: 100 },
      { id: "c500", emoji: "🗃️", key: "ach.c500", cur: copies, target: 500 },
      { id: "c1000", emoji: "🏛️", key: "ach.c1000", cur: copies, target: 1000 },
      { id: "d250", emoji: "🎴", key: "ach.d250", cur: distinct, target: 250 },
      { id: "games2", emoji: "🎮", key: "ach.games2", cur: gamesWith, target: 2 },
      { id: "games3", emoji: "🌐", key: "ach.games3", cur: gamesWith, target: 3 },
      { id: "slab1", emoji: "💎", key: "ach.slab1", cur: slabs, target: 1 },
      { id: "slab5", emoji: "🏆", key: "ach.slab5", cur: slabs, target: 5 },
      { id: "wish10", emoji: "⭐", key: "ach.wish10", cur: wishes, target: 10 },
      { id: "v1k", emoji: "💰", key: "ach.v1k", cur: Math.floor(valueBRL), target: 1000 },
      { id: "v10k", emoji: "👑", key: "ach.v10k", cur: Math.floor(valueBRL), target: 10000 }
    ];
  }
  function achievementsHtml() {
    const list = achievements();
    const earned = list.filter((a) => a.cur >= a.target).length;
    const badge = (a) => {
      const done = a.cur >= a.target;
      const progress = done ? "" : `<span class="ach-progress">${Math.min(a.cur, a.target).toLocaleString(shared.getLocale())}/${a.target.toLocaleString(shared.getLocale())}</span>`;
      return `<div class="ach${done ? " is-done" : ""}" title="${esc(t(a.key))}">
        <span class="ach-emoji" aria-hidden="true">${a.emoji}</span>
        <span class="ach-label">${esc(t(a.key))}</span>${progress}
      </div>`;
    };
    return `<section class="profile-card ach-card" aria-label="${esc(t("ach.heading"))}">
      <h2 class="ach-heading">${esc(t("ach.heading"))} <span class="ach-count">${earned}/${list.length}</span></h2>
      <div class="ach-grid">${list.map(badge).join("")}</div>
    </section>`;
  }

  function render() {
    const user = shared.currentUser();
    if (!user) {
      // Local-first: as conquistas valem mesmo sem conta.
      root.innerHTML = `<section class="profile-card profile-empty">
        <p>${esc(t("profile.loggedOut"))}</p>
        <a class="primary" href="login.html">${esc(t("profile.signIn"))}</a>
      </section>` + achievementsHtml();
      return;
    }
    const p = shared.getProfile();
    const name = (p.displayName || "").trim();
    const handle = p.handle || "";
    const isPublic = !!(p.isPublic && handle && handle.length >= 3);
    const initial = (name || user.email || "?").trim().charAt(0).toUpperCase() || "?";
    const counts = shared.collectionCounts();
    const val = shared.portfolioValueTotal();
    const valStr = val == null ? "—" : shared.formatMoney(shared.getCurrency(), val);
    const publicUrl = "https://sleevu.app/users/" + handle;

    root.innerHTML = `
      <section class="profile-card">
        <div class="profile-id">
          <div class="profile-avatar" aria-hidden="true">${esc(initial)}</div>
          <div class="profile-id-text">
            <strong class="profile-name">${name ? esc(name) : "—"}</strong>
            <span class="profile-handle">${handle ? "@" + esc(handle) : esc(t("profile.noHandle"))}</span>
            <span class="profile-email">${esc(user.email)}</span>
          </div>
          <span class="profile-badge ${isPublic ? "is-public" : "is-private"}">${esc(isPublic ? t("profile.public") : t("profile.private"))}</span>
        </div>

        <div class="profile-stats">
          <div><span class="profile-stat-val">${counts.copies}</span><span class="profile-stat-label">${esc(t("stats.copies"))}</span></div>
          <div><span class="profile-stat-val">${counts.distinct}</span><span class="profile-stat-label">${esc(t("stats.distinct"))}</span></div>
          <div><span class="profile-stat-val sensitive-value">${esc(valStr)}</span><span class="profile-stat-label">${esc(t("dash.value"))}</span></div>
        </div>

        <div class="profile-actions">
          <a class="primary" href="settings.html">${esc(t("profile.edit"))}</a>
          ${isPublic ? `<a class="secondary" href="/users/${encodeURIComponent(handle)}" target="_blank" rel="noopener">${esc(t("profile.viewPublic"))}</a>` : ""}
        </div>

        ${isPublic
          ? `<div class="profile-url-row">
               <input type="text" class="setting-input" id="profileHubUrl" readonly value="${esc(publicUrl)}" aria-label="${esc(t("settings.profileUrl"))}">
               <button type="button" class="setting-copy" id="profileHubCopy" title="${esc(t("settings.copy"))}" aria-label="${esc(t("settings.copy"))}">⧉</button>
             </div>`
          : `<p class="profile-hint">${esc(handle ? t("profile.privateHint") : t("profile.setupHint"))}</p>`}
      </section>` + achievementsHtml();

    const copy = document.getElementById("profileHubCopy");
    if (copy) copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(publicUrl);
        const old = copy.textContent; copy.textContent = "✓";
        setTimeout(() => { copy.textContent = old; }, 1200);
      } catch (e) { /* ignora */ }
    });
  }

  render();
})();
