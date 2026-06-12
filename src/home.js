(function () {
  const cards = Array.isArray(window.TCG_CARDS) ? window.TCG_CARDS : [];
  const locale = window.TCGShared ? window.TCGShared.getLocale() : "pt-BR";

  function distinct(getKey) {
    return new Set(cards.map(getKey).filter(Boolean)).size;
  }

  function setStat(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value.toLocaleString(locale);
  }

  if (cards.length) {
    setStat("statPokemon", distinct((card) => card.pokemonName || card.name));
    setStat("statCards", cards.length);
    setStat("statSets", distinct((card) => card.set));
    setStat("statArtists", distinct((card) => card.artist));
  } else if (window.TCG_MANIFEST && window.TCG_INDEXES) {
    // Modo manifest: estatísticas vêm dos índices, sem baixar o catálogo.
    setStat("statPokemon", window.TCG_INDEXES.pokedex.length);
    setStat("statCards", window.TCG_MANIFEST.sets.reduce((sum, set) => sum + (set.count || 0), 0));
    setStat("statSets", window.TCG_INDEXES.sets.length);
    setStat("statArtists", window.TCG_INDEXES.artists.length);
  }

  // Apoio: copiar a chave Pix para a área de transferência com feedback no botão.
  const t = window.TCGShared ? window.TCGShared.t : (key) => key;
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
