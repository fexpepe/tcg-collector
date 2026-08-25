(function () {
  // Apoio: copiar a chave Pix para a área de transferência com feedback no botão.
  const t = window.TCGShared ? window.TCGShared.t : (key) => key;

  // A landing (lp-*) já nasce pronta no HTML — os textos vêm do i18n via
  // data-i18n; aqui só fica o comportamento (Pix).
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

  // Logos das MARKETPLACES: mesmo padrão do hub.js — o <img> fica invisível
  // por opacity (nunca `hidden`: display:none tira a caixa e um loading="lazy"
  // sem caixa não é baixado nunca) e é revelado quando o arquivo carrega; sem
  // arquivo em assets/shops/, fica o nome em texto, sem ícone quebrado.
  document.querySelectorAll(".lp-shop-logo").forEach((img) => {
    const reveal = () => {
      if (img.naturalWidth > 0) {
        img.classList.add("is-loaded");
        const box = img.closest(".lp-shop-box");
        if (box) {
          box.classList.add("has-logo");
          const text = box.querySelector(".lp-shop-text");
          if (text) text.hidden = true;
        }
      }
    };
    img.addEventListener("load", reveal);
    if (img.complete) reveal();
  });
})();
