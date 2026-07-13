(function () {
  // Apoio: copiar a chave Pix para a área de transferência com feedback no botão.
  const t = window.TCGShared ? window.TCGShared.t : (key) => key;

  // Home única do site (estilo Collectr/Cardmarket): a Início é SEMPRE o landing
  // do ecossistema. O hero leva pra grade de jogos (Explorar); a escolha de jogos
  // fica no mega-menu "Explorar", não mais numa seção na home.
  {
    const h1 = document.querySelector(".hero h1");
    if (h1) h1.innerHTML = t("home.hubTitle");
    const sub = document.querySelector(".hero-sub");
    if (sub) sub.textContent = t("home.hubSub");
    const cta = document.querySelector(".hero-actions .cta:not(.secondary-cta)");
    if (cta) { cta.setAttribute("href", "hub.html"); cta.textContent = t("home.hubCta"); }
    const sec = document.querySelector(".hero-actions .secondary-cta");
    if (sec) sec.remove();
    document.querySelectorAll(".hero-cards img").forEach((i) => i.remove());
  }
  // "Mais vistas pela comunidade": top do contador anônimo de views (card_views),
  // dos dois jogos, resolvendo as cartas pelo catálogo por id. Só aparece com
  // dados suficientes (>= 4 cartas com 2+ views) pra não estrear vazio.
  (async function renderTopViewed() {
    const shared = window.TCGShared;
    const sec = document.getElementById("homeTopViewed");
    const row = document.getElementById("homeTopViewedRow");
    if (!shared || !sec || !row || !shared.fetchTopViewed) return;
    try {
      const games = shared.GAME_SLUGS || ["pokemon", "lorcana"];
      const perGame = await Promise.all(games.map((g) => shared.fetchTopViewed(g, 8)));
      const tops = games.flatMap((g, i) => perGame[i].map((x) => ({ id: x.card_id, views: x.views, game: g })))
        .filter((x) => x.views >= 2)
        .sort((a, b) => b.views - a.views)
        .slice(0, 8);
      if (tops.length < 4) return;
      const idsByGame = {};
      games.forEach((g) => { idsByGame[g] = tops.filter((x) => x.game === g).map((x) => x.id); });
      const catalog = await shared.loadOwnedAcrossGames(idsByGame);
      const byId = new Map((catalog.cards || []).map((c) => [c.id, c]));
      const html = tops.map(({ id, views }) => {
        const card = byId.get(id);
        if (!card) return "";
        const src = shared.cardImageSources(card);
        const img = shared.localizedImg(src.url, { alt: card.name, fallback: src.fallback, loading: "lazy", thumb: true });
        return `<a class="home-top-card" href="${shared.escapeAttribute(shared.detailUrl("set", card.set, "", card.game))}">
          <span class="home-top-img">${img}</span>
          <strong>${shared.escapeHtml(card.name)}</strong>
          <span class="home-top-views">${shared.escapeHtml(String(views))} 👁</span>
        </a>`;
      }).join("");
      if (!html) return;
      row.innerHTML = html;
      sec.hidden = false;
    } catch (e) { /* seção é opcional */ }
  })();

  const pixButton = document.getElementById("pixButton");
  if (pixButton) {
    const defaultLabel = pixButton.textContent;
    pixButton.addEventListener("click", async () => {
      const key = pixButton.dataset.pix || "";
      try {
        await navigator.clipboard.writeText(key);
      } catch (_err) {
        // Fallback para navegadores sem Clipboard API (ou contexto não seguro).
        const field = document.createElement("textarea");
        field.value = key;
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        try { document.execCommand("copy"); } catch (_e2) { /* ignora */ }
        field.remove();
      }
      pixButton.textContent = t("home.support.pixDone");
      pixButton.classList.add("copied");
      window.setTimeout(() => {
        pixButton.textContent = defaultLabel;
        pixButton.classList.remove("copied");
      }, 2000);
    });
  }
})();
