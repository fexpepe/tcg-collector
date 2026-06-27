// Página de Configurações (settings.html). Espelha as preferências que também
// ficam no topo (tema/idioma/moeda) + toggles próprios (cores por jogo, modo
// sensível). Toda a lógica/persistência vive no shared.js; aqui só liga os controles.
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const root = document.getElementById("settingsRoot");
  if (!root) return;

  // --- Perfil (nome + @handle + visibilidade). Por ora local (sem backend). ---
  const nameInput = document.getElementById("profileName");
  const handleInput = document.getElementById("profileHandle");
  const nameCount = document.getElementById("nameCount");
  const handleCount = document.getElementById("handleCount");
  const publicToggle = document.getElementById("publicToggle");
  const showValuesToggle = document.getElementById("showValuesToggle");
  const showValuesRow = document.getElementById("showValuesRow");
  const urlRow = document.getElementById("profileUrlRow");
  const urlInput = document.getElementById("profileUrl");
  const urlCopy = document.getElementById("profileUrlCopy");
  if (nameInput && handleInput) {
    const p0 = shared.getProfile();
    nameInput.value = p0.displayName || "";
    handleInput.value = p0.handle || "";

    function refreshProfile() {
      const p = shared.getProfile();
      if (nameCount) nameCount.textContent = (p.displayName || "").length + "/24";
      if (handleCount) handleCount.textContent = (p.handle || "").length + "/24";
      publicToggle.setAttribute("aria-checked", String(p.isPublic));
      showValuesToggle.setAttribute("aria-checked", String(p.showValues));
      showValuesRow.hidden = !p.isPublic;
      const ready = p.isPublic && !!p.handle;
      urlRow.hidden = !ready;
      if (ready) urlInput.value = "https://sleevu.app/users/" + p.handle;
    }

    nameInput.addEventListener("input", () => { shared.setProfile({ displayName: nameInput.value }); refreshProfile(); });
    handleInput.addEventListener("input", () => {
      const norm = shared.normalizeHandle(handleInput.value);
      if (handleInput.value !== norm) handleInput.value = norm; // descarta caracteres inválidos
      shared.setProfile({ handle: norm });
      refreshProfile();
    });
    publicToggle.addEventListener("click", () => { shared.setProfile({ isPublic: !shared.getProfile().isPublic }); refreshProfile(); });
    showValuesToggle.addEventListener("click", () => { shared.setProfile({ showValues: !shared.getProfile().showValues }); refreshProfile(); });
    if (urlCopy) urlCopy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(urlInput.value);
        const old = urlCopy.textContent; urlCopy.textContent = "✓";
        setTimeout(() => { urlCopy.textContent = old; }, 1200);
      } catch (e) { /* ignora */ }
    });
    refreshProfile();
  }

  // Tema — aplica na hora; o botão do topo se sincroniza via evento "sleevu:theme".
  const theme = document.getElementById("settingTheme");
  if (theme) {
    theme.value = shared.getTheme();
    theme.addEventListener("change", () => shared.setTheme(theme.value));
    document.addEventListener("sleevu:theme", () => { theme.value = shared.getTheme(); });
  }

  // Idioma e moeda — recarregam (re-renderizam tudo).
  const lang = document.getElementById("settingLang");
  if (lang) {
    lang.value = shared.getLanguage();
    lang.addEventListener("change", () => shared.setLanguage(lang.value));
  }
  const currency = document.getElementById("settingCurrency");
  if (currency) {
    currency.value = shared.getCurrency();
    currency.addEventListener("change", () => shared.setCurrency(currency.value));
  }

  // Cores por jogo — liga/desliga o accent por jogo (pref local).
  const gameColors = document.getElementById("gameColorsToggle");
  if (gameColors) {
    const sync = () => {
      const on = shared.gameColorsEnabled();
      gameColors.setAttribute("aria-checked", String(on));
      root.classList.toggle("colors-off", !on); // esmaece as amostras de cor
    };
    sync();
    gameColors.addEventListener("click", () => { shared.setGameColors(!shared.gameColorsEnabled()); sync(); });
  }

  // Modo sensível — borra os valores de portfólio/coleção.
  const sensitive = document.getElementById("sensitiveToggle");
  if (sensitive) {
    const sync = () => sensitive.setAttribute("aria-checked", String(shared.sensitiveEnabled()));
    sync();
    sensitive.addEventListener("click", () => { shared.setSensitive(!shared.sensitiveEnabled()); sync(); });
  }
})();
