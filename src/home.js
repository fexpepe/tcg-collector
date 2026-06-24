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
