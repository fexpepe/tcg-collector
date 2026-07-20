(function () {
  const shared = window.TCGShared;
  const { t } = shared;

  const form = document.getElementById("loginForm");
  const emailInput = document.getElementById("loginEmail");
  const msg = document.getElementById("loginMsg");
  const submit = form ? form.querySelector(".login-submit") : null;

  function showMsg(text, kind) {
    if (!msg) return;
    msg.hidden = false;
    msg.className = "login-msg" + (kind ? " " + kind : "");
    msg.textContent = text;
  }
  function returnTarget() {
    let ret = null;
    try { ret = localStorage.getItem("tcg-login-return"); localStorage.removeItem("tcg-login-return"); } catch (e) { /* ignora */ }
    // Só caminhos internos (evita open-redirect); "//host" é URL absoluta
    // protocolo-relativa, então a 2ª barra é proibida. Senão, home.
    return ret && /^\/(?!\/)[a-zA-Z0-9._\/-]*$/.test(ret) ? ret : "index.html";
  }

  // Voltando do e-mail (#access_token): o shared.js (initAuth) consome e recarrega;
  // aqui só mostra "entrando…" para não piscar o formulário.
  if (window.location.hash.indexOf("access_token") >= 0) {
    if (form) form.hidden = true;
    showMsg(t("login.entering"), "ok");
    return;
  }

  // Já logado: redireciona pra onde veio (ou home).
  if (shared.getSession && shared.getSession()) {
    window.location.replace(returnTarget());
    return;
  }

  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = (emailInput.value || "").trim();
      if (!email.includes("@")) return;
      // Token do Turnstile (se o widget estiver na página). O widget marca
      // sozinho na maioria dos casos; se o desafio ainda não terminou, avisa.
      const tsField = form.querySelector('[name="cf-turnstile-response"]');
      const captchaToken = tsField ? tsField.value : "";
      if (tsField && !captchaToken) { showMsg(t("login.captcha"), "err"); return; }
      if (submit) { submit.disabled = true; submit.textContent = t("login.sending"); }
      const ok = await shared.sendMagicLink(email, captchaToken);
      if (submit) { submit.disabled = false; submit.textContent = t("login.submit"); }
      if (ok) {
        form.hidden = true;
        showMsg(t("login.sent"), "ok");
      } else {
        showMsg(t("login.error"), "err");
      }
    });
  }
})();
