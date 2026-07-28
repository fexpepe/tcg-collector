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

  // Volta pelo bfcache (botão VOLTAR depois de logar): o navegador restaura a
  // página congelada sem rodar nenhum script. Dois estragos vistos em produção:
  // o usuário logado vê o formulário de login (o redirect lá embaixo não roda de
  // novo) e o api.js do Turnstile re-renderiza um widget novo AO LADO do velho
  // expirado — aparecia "Falha na verificação" e "Sucesso!" lado a lado, e o
  // submit lia o token do widget errado. Reload resolve os dois: a página
  // renasce, o script roda e ou redireciona (logado) ou monta UM widget novo.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
  });

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

  // Google: uma navegação e mais nada. O Supabase devolve os tokens no mesmo
  // hash do link mágico, e o initAuth do shared.js consome na volta — por isso
  // não há callback nem tratamento de sessão aqui. Desabilita o botão porque a
  // navegação leva um instante e o segundo clique só atrapalharia.
  const googleBtn = document.getElementById("loginGoogle");
  if (googleBtn) {
    googleBtn.addEventListener("click", () => {
      googleBtn.disabled = true;
      showMsg(t("login.redirecting"), "ok");
      shared.oauthSignIn("google");
    });
  }

  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = (emailInput.value || "").trim();
      if (!email.includes("@")) return;
      // Token do Turnstile (se o widget estiver na página). O widget marca
      // sozinho na maioria dos casos; se o desafio ainda não terminou, avisa.
      // querySelectorAll + último NÃO-VAZIO: se por qualquer motivo houver mais
      // de um widget no form (já houve, via bfcache), o válido é o mais novo —
      // pegar o primeiro mandava token vazio/expirado e o Supabase recusava.
      const tsFields = form.querySelectorAll('[name="cf-turnstile-response"]');
      let captchaToken = "";
      tsFields.forEach((f) => { if (f.value) captchaToken = f.value; });
      if (tsFields.length && !captchaToken) { showMsg(t("login.captcha"), "err"); return; }
      if (submit) { submit.disabled = true; submit.textContent = t("login.sending"); }
      const r = await shared.sendMagicLink(email, captchaToken);
      if (submit) { submit.disabled = false; submit.textContent = t("login.submit"); }
      if (r.ok) {
        form.hidden = true;
        showMsg(t("login.sent"), "ok");
      } else if (r.code === "captcha_failed") {
        // Falha na VALIDAÇÃO do captcha (não no widget): ou o token expirou na
        // digitação, ou o secret do Turnstile no painel do Supabase está errado
        // — foi este segundo caso que derrubou o login do site inteiro uma vez,
        // mascarado pela mensagem genérica. O widget é resetado pra gerar token
        // novo; se persistir, o texto aponta o captcha, não o e-mail.
        try { if (window.turnstile) window.turnstile.reset(); } catch (e) { /* sem widget */ }
        showMsg(t("login.captchaRejected"), "err");
      } else if (r.code === "over_email_send_rate_limit" || r.status === 429) {
        showMsg(t("login.rateLimited"), "err");
      } else {
        showMsg(t("login.error"), "err");
      }
    });
  }
})();
