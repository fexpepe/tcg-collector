(function () {
  // Logo dos jogos (seção "Mais de um jogo"): o <img> começa hidden. Se o arquivo
  // existir e carregar, mostra o logo e esconde o nome em texto (o logo já diz o
  // nome). Se faltar/falhar, fica o fallback de texto — sem ícone de imagem
  // quebrada. (Inline onerror não dá: CSP script-src 'self'.)
  document.querySelectorAll(".game-logo").forEach((img) => {
    const reveal = () => {
      if (img.naturalWidth > 0) {
        img.hidden = false;
        const name = img.parentElement && img.parentElement.querySelector(".game-name");
        if (name) name.hidden = true;
      }
    };
    img.addEventListener("load", reveal);
    if (img.complete) reveal();
  });

  // Apoio: copiar a chave Pix para a área de transferência com feedback no botão.
  const t = window.TCGShared ? window.TCGShared.t : (key) => key;

  // Hero game-aware. No HTML o hero é do Pokémon (Pokédex + cartas de Pokémon).
  const game = (window.SLEEVU && window.SLEEVU.game) || "pokemon";
  if (game === "hub") {
    // Apex/HUB: hero do ecossistema; o CTA rola pros jogos. Sem cartas/CTA de set.
    const h1 = document.querySelector(".hero h1");
    if (h1) h1.innerHTML = t("home.hubTitle");
    const sub = document.querySelector(".hero-sub");
    if (sub) sub.textContent = t("home.hubSub");
    const cta = document.querySelector(".hero-actions .cta:not(.secondary-cta)");
    if (cta) { cta.setAttribute("href", "#games"); cta.textContent = t("home.hubCta"); }
    const sec = document.querySelector(".hero-actions .secondary-cta");
    if (sec) sec.remove();
    document.querySelectorAll(".hero-cards img").forEach((i) => i.remove());
    const games = document.querySelector(".home-games");
    if (games) games.id = "games";
    // No hub, o tile do Pokémon vai pro subdomínio (em dev, ?game=pokemon).
    const pokeTile = document.querySelector('.home-games .game-tile[href="pokedex.html"]');
    if (pokeTile) pokeTile.setAttribute("href", /(^|\.)sleevu\.app$/i.test(location.hostname) ? "https://poke.sleevu.app/" : "index.html?game=pokemon");
  } else if (game !== "pokemon") {
    const cta = document.querySelector(".hero-actions .cta:not(.secondary-cta)");
    if (cta) { cta.setAttribute("href", "cards.html"); cta.textContent = t("home.ctaCards"); }
    const heroImgs = [...document.querySelectorAll(".hero-cards img")];
    const ready = window.SLEEVU && window.SLEEVU.catalogReady;
    if (heroImgs.length && ready) {
      ready.then(() => {
        const withImg = (window.TCG_CARDS || []).filter((c) => c && c.image);
        if (!withImg.length) { heroImgs.forEach((i) => i.remove()); return; }
        const picks = [withImg[0], withImg[Math.floor(withImg.length / 2)], withImg[withImg.length - 1]];
        heroImgs.forEach((img, i) => { if (picks[i]) img.src = picks[i].image; else img.remove(); });
      });
    }
  }
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
