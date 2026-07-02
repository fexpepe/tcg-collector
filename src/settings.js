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

    // Status do @ (disponível / em uso / salvo) + sincroniza o perfil na nuvem.
    const handleStatus = document.getElementById("handleStatus");
    function setStatus(key, kind) {
      if (!handleStatus) return;
      handleStatus.textContent = key ? shared.t(key) : "";
      handleStatus.className = "setting-field-status" + (kind ? " is-" + kind : "");
    }
    let profT;
    function scheduleSync() { clearTimeout(profT); profT = setTimeout(runSync, 600); }
    async function runSync() {
      const h = shared.getProfile().handle;
      if (!h) { setStatus("", ""); return; }
      if (h.length < 3) { setStatus("settings.handleShort", "warn"); return; }
      setStatus("settings.handleChecking", "");
      const avail = await shared.handleAvailable(h);
      if (avail === false) { setStatus("settings.handleTaken", "bad"); return; }
      const res = await shared.pushProfile();
      if (res && res.ok) { setStatus("settings.handleSaved", "good"); }
      else if (res && res.error === "taken") { setStatus("settings.handleTaken", "bad"); }
      else if (res && res.error === "auth") { setStatus("settings.handleLogin", "warn"); }
      else { setStatus(avail === true ? "settings.handleAvailable" : "", avail === true ? "good" : ""); }
    }

    nameInput.addEventListener("input", () => { shared.setProfile({ displayName: nameInput.value }); refreshProfile(); scheduleSync(); });
    handleInput.addEventListener("input", () => {
      const norm = shared.normalizeHandle(handleInput.value);
      if (handleInput.value !== norm) handleInput.value = norm; // descarta caracteres inválidos
      shared.setProfile({ handle: norm });
      refreshProfile();
      scheduleSync();
    });
    publicToggle.addEventListener("click", () => { shared.setProfile({ isPublic: !shared.getProfile().isPublic }); refreshProfile(); scheduleSync(); });
    showValuesToggle.addEventListener("click", () => { shared.setProfile({ showValues: !shared.getProfile().showValues }); refreshProfile(); scheduleSync(); });
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

  // Notificações: aviso semanal de quedas da wishlist (web push; precisa de conta
  // e da permissão do navegador). O estado real vem da assinatura do SW.
  const pushToggle = document.getElementById("pushWishToggle");
  if (pushToggle && shared.pushWishlist) {
    const syncPush = async () => pushToggle.setAttribute("aria-checked", String(await shared.pushWishlist.isOn()));
    if (!shared.pushWishlist.supported()) {
      pushToggle.disabled = true;
      pushToggle.title = shared.t("settings.pushUnsupported");
    } else {
      syncPush();
      pushToggle.addEventListener("click", async () => {
        pushToggle.disabled = true;
        try {
          const on = await shared.pushWishlist.isOn();
          const r = on ? await shared.pushWishlist.disable() : await shared.pushWishlist.enable();
          if (r === "auth") alert(shared.t("settings.pushNeedLogin"));
          else if (r === "denied") alert(shared.t("settings.pushDenied"));
          else if (r === "error") alert(shared.t("settings.pushError"));
          await syncPush();
        } finally {
          pushToggle.disabled = false; // nunca deixa o switch travado
        }
      });
    }
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
