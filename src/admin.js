// Painel de admin (admin.html): números agregados/anônimos do site. Só o dono lê
// (o RPC analytics_summary só responde se is_admin; senão devolve null). Texto em
// pt fixo — é uma página interna.
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const root = document.getElementById("adminRoot");
  if (!root) return;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmt(n) { return n == null ? "—" : Number(n).toLocaleString("pt-BR"); }

  function chart(daily) {
    if (!daily || !daily.length) {
      return `<p class="admin-empty">Sem pageviews registrados ainda — o beacon começa a contar a partir do próximo deploy.</p>`;
    }
    const max = Math.max(1, ...daily.map((d) => d.views || 0));
    const W = 720, H = 160, P = 16, n = daily.length;
    const bw = (W - 2 * P) / n;
    const bars = daily.map((d, i) => {
      const h = ((d.views || 0) / max) * (H - 2 * P);
      const x = P + i * bw, y = H - P - h;
      return `<rect x="${(x + 1).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="var(--accent)"><title>${esc(d.day)}: ${fmt(d.views)} views · ${fmt(d.users)} visitantes</title></rect>`;
    }).join("");
    return `<div class="admin-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Pageviews por dia">${bars}</svg></div>`;
  }

  async function render() {
    const d = await shared.analyticsSummary(30);
    if (!d) {
      root.innerHTML = `<p class="empty-state">Acesso restrito — entre com a conta de admin.</p>`;
      return;
    }
    const stat = (label, val) => `<div class="admin-stat"><span class="admin-stat-val">${fmt(val)}</span><span class="admin-stat-label">${esc(label)}</span></div>`;
    const games = (d.by_game || []).map((g) => `<tr><td>${esc(g.game)}</td><td class="num">${fmt(g.users)}</td><td class="num">${fmt(g.cards)}</td></tr>`).join("") || `<tr><td colspan="3" class="admin-empty">—</td></tr>`;
    const paths = (d.top_paths || []).map((p) => `<tr><td>/${esc(p.path)}</td><td class="num">${fmt(p.views)}</td></tr>`).join("") || `<tr><td colspan="2" class="admin-empty">—</td></tr>`;

    root.innerHTML = `
      <div class="admin-stats">
        ${stat("DAU (hoje)", d.dau)}
        ${stat("WAU (7 dias)", d.wau)}
        ${stat("MAU (30 dias)", d.mau)}
        ${stat("Pageviews (30d)", d.pageviews)}
        ${stat("Usuários (sync)", d.total_users)}
        ${stat("Perfis públicos", d.public_profiles)}
        ${stat("Compartilhamentos", d.shares)}
      </div>
      <section class="admin-section">
        <h2>Pageviews por dia (30 dias)</h2>
        ${chart(d.daily)}
      </section>
      <section class="admin-section">
        <h2>Páginas mais acessadas (30d)</h2>
        <table class="admin-table"><thead><tr><th>Página</th><th class="num">Views</th></tr></thead><tbody>${paths}</tbody></table>
      </section>
      <section class="admin-section">
        <h2>Cartas por jogo</h2>
        <table class="admin-table"><thead><tr><th>Jogo</th><th class="num">Usuários</th><th class="num">Cartas distintas</th></tr></thead><tbody>${games}</tbody></table>
      </section>
      <p class="admin-note">Atualizado em ${esc(new Date(d.generated_at).toLocaleString("pt-BR"))}. DAU/MAU contam visitantes anônimos (uuid first-party); o resto vem do banco (usuários logados).</p>`;
  }

  render();
})();
