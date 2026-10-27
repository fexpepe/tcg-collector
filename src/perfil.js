// Perfil do celular (account.html) — redesenho de 2026-10-26. A lista de
// links mora no HTML; este módulo liga só o que depende do estado:
//   · o cartão do topo (quem está logado, com a sincronização, ou o convite
//     pra entrar);
//   · as preferências, que mudam na hora (moeda e idioma recarregam a página,
//     como sempre — todo preço e texto é desenhado no boot);
//   · Instalar app, Sair e o que só vale com conta.
// Só o account.html carrega este arquivo (e a folha "perfil" do split-css).
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const { t, escapeHtml } = shared;

  const quem = document.getElementById("accQuem");
  if (!quem) return;

  // ── Cartão do topo ──────────────────────────────────────────────────────
  // Logado: avatar em monograma, nome, @ e e-mail, e a última sincronização.
  // Tocar abre o Meu perfil. Deslogado: o convite pra entrar, e o aviso de
  // que, sem conta, tudo fica só neste aparelho.
  function desenhaQuem() {
    const sessao = shared.getSession();
    document.querySelectorAll("[data-so-logado]").forEach((el) => { el.hidden = !sessao; });
    if (!sessao) {
      quem.innerHTML = `<div class="acc-convite">
        <strong>${escapeHtml(t("acc.guest.title"))}</strong>
        <p>${escapeHtml(t("acc.guest.sub"))}</p>
        <a class="primary acc-entrar" href="login">${escapeHtml(t("auth.signIn"))}</a>
        <small>${escapeHtml(t("acc.guest.local"))}</small>
      </div>`;
      return;
    }
    const p = shared.getProfile();
    const email = (sessao.user && sessao.user.email) || "";
    const nome = (p.displayName || "").trim() || (p.handle ? `@${p.handle}` : email);
    const inicial = (nome.replace(/^@/, "").charAt(0) || "?").toUpperCase();
    const linha = [p.handle && nome !== `@${p.handle}` ? `@${p.handle}` : "", email !== nome ? email : ""].filter(Boolean).join(" · ");
    quem.innerHTML = `<a class="acc-cartao" href="profile">
      <span class="acc-avatar" aria-hidden="true">${escapeHtml(inicial)}</span>
      <span class="acc-id">
        <strong>${escapeHtml(nome)}</strong>
        ${linha ? `<span>${escapeHtml(linha)}</span>` : ""}
        <span class="acc-sync" id="accSync"></span>
      </span>
      <span class="acc-seta" aria-hidden="true"></span>
    </a>`;
    atualizaSync();
  }

  // "Sincronizado há 5 minutos": o shared.js grava o resultado de cada
  // pull/push (tcg-sync-status); aqui ele vira texto relativo, refeito de
  // tempos em tempos enquanto a tela está aberta.
  function atualizaSync() {
    const el = document.getElementById("accSync");
    if (!el) return;
    const st = shared.getSyncStatus();
    let cls = "";
    let txt = t("acc.sync.idle");
    if (st && !st.ok) { cls = "is-falha"; txt = t("acc.sync.fail"); }
    else if (st) {
      cls = "is-ok";
      const seg = Math.max(0, Math.round((Date.now() - st.ts) / 1000));
      if (seg < 60) txt = t("acc.sync.now");
      else {
        let quando = "";
        try {
          const rtf = new Intl.RelativeTimeFormat(shared.getLocale(), { numeric: "auto" });
          quando = seg < 3600 ? rtf.format(-Math.round(seg / 60), "minute")
            : seg < 86400 ? rtf.format(-Math.round(seg / 3600), "hour")
              : rtf.format(-Math.round(seg / 86400), "day");
        } catch (e) { /* navegador sem RelativeTimeFormat: fica sem o "quando" */ }
        txt = quando ? t("acc.sync.ok", { quando }) : t("acc.sync.now");
      }
    }
    el.className = `acc-sync ${cls}`.trim();
    el.textContent = txt;
  }

  // ── Preferências ────────────────────────────────────────────────────────
  function ligaPreferencias() {
    const moeda = document.getElementById("accMoeda");
    const idioma = document.getElementById("accIdioma");
    const valor = (sel, alvo) => {
      const el = document.getElementById(alvo);
      const opt = sel.options[sel.selectedIndex];
      if (el && opt) el.textContent = opt.textContent;
    };
    if (moeda) {
      moeda.value = shared.getCurrency();
      valor(moeda, "accMoedaValor");
      moeda.addEventListener("change", () => shared.setCurrency(moeda.value));
    }
    if (idioma) {
      idioma.value = shared.getLanguage();
      valor(idioma, "accIdiomaValor");
      idioma.addEventListener("change", () => shared.setLanguage(idioma.value));
    }

    // Tema: Auto segue o sistema (limpa a escolha salva), Claro/Escuro fixam.
    const tema = document.getElementById("accTema");
    const marcaTema = () => {
      const atual = shared.getThemePref();
      tema.querySelectorAll("[data-tema]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tema === atual)));
    };
    if (tema) {
      marcaTema();
      tema.addEventListener("click", (event) => {
        const b = event.target.closest("[data-tema]");
        if (b) shared.setTheme(b.dataset.tema);
      });
      document.addEventListener("sleevu:theme", marcaTema);
    }

    // Esconder preços = o Modo Colecionador do olho do topo do desktop.
    const precos = document.getElementById("accPrecos");
    const marcaPrecos = () => precos.setAttribute("aria-checked", String(shared.collectorModeEnabled()));
    if (precos) {
      marcaPrecos();
      precos.addEventListener("click", () => shared.setCollectorMode(!shared.collectorModeEnabled()));
      document.addEventListener("sleevu:collector", marcaPrecos);
    }
  }

  // ── Instalar app e Sair ─────────────────────────────────────────────────
  // Instalar só aparece quando dá (prompt do Android/desktop ou dica do iOS)
  // e nunca dentro do app das lojas (data-iab="app", carimbado no theme.js).
  function ligaAcoes() {
    const instalar = document.getElementById("accInstalar");
    const nativo = document.documentElement.getAttribute("data-iab") === "app";
    const mostraInstalar = () => { if (instalar) instalar.hidden = nativo || !shared.canInstallPWA(); };
    if (instalar) {
      mostraInstalar();
      document.addEventListener("sleevu:installable", mostraInstalar);
      instalar.addEventListener("click", async () => { await shared.pwaInstallFlow(); mostraInstalar(); });
    }
    const sair = document.getElementById("accSair");
    if (sair) sair.addEventListener("click", () => shared.authSignOut());
  }

  desenhaQuem();
  ligaPreferencias();
  ligaAcoes();

  // O login do shared.js decide de verdade depois do boot (token renovado,
  // ou sessão recusada pela nuvem): ele redesenha o slot de conta escondido,
  // e o cartão acompanha.
  const acoes = document.querySelector(".header-actions");
  if (acoes && window.MutationObserver) {
    new MutationObserver(desenhaQuem).observe(acoes, { childList: true, subtree: true });
  }
  setInterval(atualizaSync, 20000);
})();
