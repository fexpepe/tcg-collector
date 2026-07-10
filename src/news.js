// Página de Novidades: renderiza data/changelog.json (curado, versionado no
// repo) agrupado por dia, no idioma da interface. Visitar a página marca tudo
// como visto (a bolinha "novo" do menu some — ver shared.js#initNewsBadge).
(function () {
  const shared = window.TCGShared;
  const list = document.getElementById("newsList");
  if (!shared || !list) return;
  const t = shared.t;

  const fmtDate = (iso) => {
    try {
      return new Date(iso + "T00:00:00").toLocaleDateString(shared.getLocale(), { day: "numeric", month: "long", year: "numeric" });
    } catch (e) { return iso; }
  };

  fetch("data/changelog.json")
    .then((r) => (r.ok ? r.json() : []))
    .then((items) => {
      if (!Array.isArray(items) || !items.length) {
        list.innerHTML = `<p class="empty-state">${t("news.empty")}</p>`;
        return;
      }
      const lang = shared.getLanguage && shared.getLanguage() === "en" ? "en" : "pt";
      const byDay = new Map();
      items.forEach((it) => {
        if (!it || !it.d) return;
        if (!byDay.has(it.d)) byDay.set(it.d, []);
        byDay.get(it.d).push(it[lang] || it.pt || "");
      });
      list.innerHTML = [...byDay.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([d, notes]) => `<article class="news-day">
            <h2 class="news-date">${fmtDate(d)}</h2>
            <ul>${notes.map((n) => `<li>${shared.escapeHtml(n)}</li>`).join("")}</ul>
          </article>`)
        .join("");
      // Marca como visto: a bolinha do menu usa a data mais nova do changelog.
      try { localStorage.setItem("tcg-news-seen-v1", items.map((i) => i.d).sort().pop() || ""); } catch (e) { /* ignora */ }
    })
    .catch(() => { list.innerHTML = `<p class="empty-state">${t("news.empty")}</p>`; });
})();
