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
