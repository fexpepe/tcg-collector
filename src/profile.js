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

  function render() {
    const user = shared.currentUser();
    if (!user) {
      root.innerHTML = `<section class="profile-card profile-empty">
        <p>${esc(t("profile.loggedOut"))}</p>
        <a class="primary" href="login.html">${esc(t("profile.signIn"))}</a>
      </section>`;
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
      </section>`;

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
