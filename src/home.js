(function () {
  // Apoio: copiar a chave Pix para a área de transferência com feedback no botão.
  const t = window.TCGShared ? window.TCGShared.t : (key) => key;

  // A landing (lp-*) já nasce pronta no HTML — os textos vêm do i18n via
  // data-i18n; aqui só fica o comportamento (Pix) e os números da ilustração.
  //
  // Celular ilustrativo e mini-gráfico do portfólio: o HTML nasce em reais e
  // no formato brasileiro (é o que o robô sem JS lê), e aqui os números passam
  // pra moeda do site e o formato do idioma de quem abre. Em inglês o desenho
  // dizia "R$ 12.480,00" ao lado de um topo todo em dólar (2026-10-27). São os
  // MESMOS números em toda moeda: é desenho, não cotação. O símbolo sai do
  // formatMoney (mesmo truque do saleCurrencySymbol do shared.js), pra ficar
  // igual ao do resto do site.
  const shared = window.TCGShared;
  if (shared && shared.getCurrency) {
    const cur = shared.getCurrency();
    const locale = shared.getLocale();
    const num = (v, casas) => v.toLocaleString(locale, { minimumFractionDigits: casas, maximumFractionDigits: casas });
    const simbolo = shared.formatMoney(cur, 1).replace(/[\d.,\s]/g, "") || cur;
    const dinheiro = (v, casas) => `${simbolo} ${num(v, casas)}`;
    const pct = (v) => `${num(Math.abs(v), 1)}%`;
    document.querySelectorAll("[data-lp-moeda]").forEach((el) => { el.textContent = `${simbolo} ${cur}`; });
    document.querySelectorAll("[data-lp-valor]").forEach((el) => {
      el.textContent = dinheiro(Number(el.dataset.lpValor), Number(el.dataset.lpCasas || 2));
    });
    document.querySelectorAll("[data-lp-delta]").forEach((el) => {
      el.textContent = `+${dinheiro(Number(el.dataset.lpDelta), 2)} (${pct(Number(el.dataset.lpDeltaPct))})`;
    });
    document.querySelectorAll("[data-lp-pct]").forEach((el) => {
      const v = Number(el.dataset.lpPct);
      el.textContent = `${v < 0 ? "−" : "+"}${pct(v)}`;
    });
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
