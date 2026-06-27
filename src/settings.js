// Página de Configurações (settings.html). Espelha as preferências que também
// ficam no topo (tema/idioma/moeda) + toggles próprios (cores por jogo, modo
// sensível). Toda a lógica/persistência vive no shared.js; aqui só liga os controles.
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const root = document.getElementById("settingsRoot");
  if (!root) return;

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
