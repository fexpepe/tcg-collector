// Página de Configurações (settings.html). Por ora: o toggle de "cores por jogo"
// (liga/desliga o accent vermelho/roxo por jogo — pref local, em shared.js).
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const root = document.getElementById("settingsRoot");
  const toggle = document.getElementById("gameColorsToggle");
  if (!root || !toggle) return;

  function sync() {
    const on = shared.gameColorsEnabled();
    toggle.setAttribute("aria-checked", String(on));
    root.classList.toggle("colors-off", !on); // esmaece as amostras de cor
  }
  sync();

  toggle.addEventListener("click", () => {
    shared.setGameColors(!shared.gameColorsEnabled());
    sync();
  });
})();
