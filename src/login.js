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
  // A tela de "entrando" é acesa pelo login-boot.js (no <head>, antes da
  // primeira pintura). Aqui só se APAGA: no instante em que esta página decide
  // mostrar o formulário, a marca tem que sumir — senão um logout, ou um sinal
  // frouxo do boot, deixaria a página presa em "Entrando…" pra sempre.
  function mostraFormulario() {
    document.documentElement.removeAttribute("data-entering");
    try { sessionStorage.removeItem("sleevu-entrando"); } catch (e) { /* ignora */ }
  }
  function returnTarget() {
    let ret = null;
    try { ret = localStorage.getItem("tcg-login-return"); localStorage.removeItem("tcg-login-return"); } catch (e) { /* ignora */ }
    // Só caminhos internos (evita open-redirect); "//host" é URL absoluta
    // protocolo-relativa, então a 2ª barra é proibida. A query entra na regra
    // (o destino é gravado com ela): quem foi barrado em `collection?game=magic`
    // voltava pra Coleção sem o jogo. Senão, o Hub pessoal — quem acabou de
    // logar quer as SUAS coisas, e a home é a landing de quem ainda não entrou.
    return ret && /^\/(?!\/)[a-zA-Z0-9._\/-]*(\?[a-zA-Z0-9._~%!$&'()*+,;=:@/?-]*)?$/.test(ret) ? ret : "/dashboard";
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

  // Volta do provedor COM ERRO. O Supabase devolve na URL (no hash quando a
  // recusa vem do OAuth, na query quando vem antes dele):
  //   #error=server_error&error_code=…&error_description=…
  // Sem ler isso, a página renascia limpa e o clique no "Continuar com Google"
  // parecia não fazer nada — o motivo real (provedor Google desligado no painel
  // do Supabase, redirect_to fora da allow-list, consentimento negado) ficava
  // escondido na barra de endereço. Mostrar o texto do provedor é o que
  // transforma "não funciona" em algo acionável.
  (function mostraErroOauth() {
    const url = new URL(window.location.href);
    const doHash = new URLSearchParams(url.hash.slice(1));
    const fonte = doHash.get("error") ? doHash : (url.searchParams.get("error") ? url.searchParams : null);
    if (!fonte) return;
    mostraFormulario(); // deu errado: ninguém está entrando
    const motivo = fonte.get("error_description") || fonte.get("error_code") || fonte.get("error");
    // Limpa a URL: um F5 não pode repetir a mensagem (nem deixar o erro colado
    // no endereço que o usuário eventualmente compartilha).
    ["error", "error_code", "error_description"].forEach((k) => { doHash.delete(k); url.searchParams.delete(k); });
    const sobra = doHash.toString();
    history.replaceState(null, "", url.pathname + url.search + (sobra ? `#${sobra}` : ""));
    showMsg(`${t("login.oauthFailed")} ${motivo}`, "err");
  })();

  // NÃO dá pra olhar o #access_token aqui: o shared.js roda antes deste arquivo
  // e limpa o hash logo no começo do boot (history.replaceState), então a esta
  // altura a URL já está limpa — era por isso que a volta do e-mail caía no
  // formulário como se nada tivesse acontecido. Quem viu o hash a tempo foi o
  // login-boot.js, no <head>: é o atributo dele que manda aqui.
  const entrando = document.documentElement.hasAttribute("data-entering");

  // Já logado: redireciona pra onde veio (ou home). Segue "entrando" na tela —
  // é um pulo instantâneo, e o formulário aqui só piscaria.
  if (shared.getSession && shared.getSession()) {
    document.documentElement.setAttribute("data-entering", "1");
    window.location.replace(returnTarget());
    return;
  }

  if (entrando) {
    // Login em andamento: o shared.js está criando a sessão e sincronizando a
    // coleção (o trecho mais demorado), e recarrega a página no fim. A sessão é
    // gravada ANTES do sync, então a checagem lá embaixo distingue "ainda
    // sincronizando" (tem sessão: continua esperando) de "o token foi recusado"
    // — link mágico expirado, o caso em que ninguém viria salvar a tela e o
    // usuário ficaria presto no spinner pra sempre.
    if (form) form.hidden = true;
    setTimeout(() => {
      if (shared.getSession && shared.getSession()) return; // sync longo: deixa rolar
      mostraFormulario();
      if (form) form.hidden = false;
      showMsg(t("login.enteringFailed"), "err");
    }, 20000);
  } else {
    // Página de login de verdade: formulário à vista.
    mostraFormulario();
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

  // Atalho da ÚLTIMA CONTA usada neste navegador. Sem ele, quem volta ao site
  // depois de sair (ou depois de o refresh_token expirar) encara a mesma tela
  // fria de sempre: "Entrar", botão genérico do Google, seletor de conta do
  // Google, e só então a coleção. Com o e-mail à vista é UM clique — o mesmo
  // "Continuar como fulano" que o próprio Google mostra por aí.
  //
  // Só aparece pra quem entrou PELO GOOGLE (o shared grava o `via`): oferecer o
  // Google a quem só usa link mágico empurraria a pessoa pra um fluxo que ela
  // nunca fez. Pra esses, o e-mail lembrado vai pro campo do formulário — que é
  // a mesma ideia ("já sei quem você é"), no caminho que eles usam.
  //
  // É dado LOCAL: nada aqui consulta o Google nem o Supabase. Num navegador
  // novo, ou depois de limpar os dados do site, simplesmente não aparece.
  const lastBtn = document.getElementById("loginLast");
  const otherBtn = document.getElementById("loginOther");
  const conta = shared.getLastAccount ? shared.getLastAccount() : null;

  if (conta && conta.via === "google" && lastBtn && otherBtn && googleBtn) {
    // textContent (nunca innerHTML): nome e e-mail são dado de usuário.
    lastBtn.querySelector(".login-last-avatar").textContent = (conta.nome || conta.email).charAt(0).toUpperCase();
    lastBtn.querySelector(".login-last-name").textContent = conta.nome ? t("login.lastAs", { nome: conta.nome }) : t("login.google");
    lastBtn.querySelector(".login-last-mail").textContent = conta.email;
    lastBtn.hidden = false;
    otherBtn.hidden = false;
    googleBtn.hidden = true; // um só botão do Google na tela: o personalizado

    lastBtn.addEventListener("click", () => {
      lastBtn.disabled = true;
      showMsg(t("login.redirecting"), "ok");
      // login_hint: o Google já abre com esta conta escolhida e, pra quem segue
      // logado lá, nem mostra o seletor — é o que transforma o atalho em um
      // clique de verdade. Se o hint for ignorado, cai no seletor de sempre.
      shared.oauthSignIn("google", { login_hint: conta.email });
    });

    // "Entrar com outra conta": ESQUECE a lembrança (é o único jeito de tirar o
    // e-mail da tela — importa em computador compartilhado) e devolve o botão
    // genérico, que abre o seletor do Google normalmente.
    otherBtn.addEventListener("click", () => {
      if (shared.forgetLastAccount) shared.forgetLastAccount();
      lastBtn.hidden = true;
      otherBtn.hidden = true;
      googleBtn.hidden = false;
      if (emailInput) emailInput.focus();
    });
  } else if (conta && emailInput && !emailInput.value) {
    // Entrou por link mágico da última vez: o campo já vem preenchido, então
    // pedir um link novo é só apertar o botão.
    emailInput.value = conta.email;
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

  // Encaixa a caixa do Turnstile na largura do formulário. O iframe do widget
  // tem largura fixa (300px, e o "flexible" tem esse valor como mínimo), então
  // no celular ele nascia mais largo que o campo de e-mail e vazava pela borda
  // do cartão. A conta é feita aqui, e não no CSS, porque só o navegador sabe
  // quanto o cartão realmente tem: o CSS sozinho não consegue transformar
  // "largura do contêiner ÷ 300px" num fator de escala.
  const tsBox = document.querySelector(".login-turnstile");
  if (tsBox && window.ResizeObserver && window.MutationObserver) {
    const fit = () => {
      const frame = tsBox.querySelector("iframe");
      if (!frame) return;
      // Zera a escala ANTES de medir. Não dá pra dividir a medida atual pela
      // escala em vigor: no tamanho flexible o widget acompanha o contêiner,
      // então essa conta devolveria sempre a escala anterior e o widget ficaria
      // preso no tamanho pequeno depois de girar a tela pra paisagem.
      // A leitura força o layout, então o valor abaixo já é sem zoom.
      tsBox.style.setProperty("--ts-scale", "1");
      const natural = frame.getBoundingClientRect().width;
      const espaco = tsBox.clientWidth;
      if (!natural || !espaco) return;
      // Nunca AUMENTA o widget: onde couber, quem manda é o próprio flexible.
      const escala = Math.min(1, espaco / natural);
      tsBox.style.setProperty("--ts-scale", String(Math.round(escala * 1000) / 1000));
    };
    // O iframe chega depois (o api.js é async e o reset troca o widget), daí o
    // MutationObserver; o ResizeObserver cobre giro de tela e janela redimensionada.
    new MutationObserver(fit).observe(tsBox, { childList: true, subtree: true });
    new ResizeObserver(fit).observe(tsBox);
  }
})();
