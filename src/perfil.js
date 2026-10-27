// Perfil do celular (account.html) — redesenho de 2026-10-26. Os atalhos
// moram no HTML; este módulo liga só o que depende do estado:
//   · o cartão do topo (quem está logado, com a sincronização e os botões
//     de perfil, ou o convite pra entrar);
//   · os quatro controles rápidos (moeda e idioma recarregam a página, como
//     sempre — todo preço e texto é desenhado no boot; tema e preços mudam
//     na hora);
//   · Instalar app, Sair e o que só vale com conta.
// Só o account.html carrega este arquivo (e a folha "perfil" do split-css).
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const { t, escapeHtml, escapeAttribute } = shared;

  const quem = document.getElementById("accQuem");
  if (!quem) return;

  // ── Cartão do topo ──────────────────────────────────────────────────────
  // Logado: monograma, nome, @ e e-mail, a última sincronização e os dois
  // caminhos do perfil (o seu e o público, quando existe). Deslogado: o
  // convite pra entrar, e o aviso de que sem conta tudo fica no aparelho.
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
    // Link do perfil público só quando ele É público (link pra "não
    // encontrado" confunde) — a mesma regra do cartão da Coleção.
    const publico = p.handle && p.isPublic
      ? `<a class="acc-botao" href="/users/${escapeAttribute(p.handle)}">${escapeHtml(t("acc.publicProfile"))}</a>`
      : "";
    quem.innerHTML = `<div class="acc-cartao">
      <div class="acc-cartao-topo">
        <span class="acc-avatar" aria-hidden="true">${escapeHtml(inicial)}</span>
        <span class="acc-id">
          <strong>${escapeHtml(nome)}</strong>
          ${linha ? `<span>${escapeHtml(linha)}</span>` : ""}
          <span class="acc-sync" id="accSync"></span>
        </span>
      </div>
      <div class="acc-cartao-botoes">
        <a class="acc-botao" href="profile">${escapeHtml(t("profile.heading"))}</a>
        ${publico}
      </div>
    </div>`;
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

  // ── Controles rápidos ───────────────────────────────────────────────────
  const TEMAS = ["auto", "light", "dark"];
  function ligaRapidos() {
    const escreve = (id, texto) => { const el = document.getElementById(id); if (el) el.textContent = texto; };
    const moeda = document.getElementById("accMoeda");
    if (moeda) {
      moeda.value = shared.getCurrency();
      escreve("accMoedaValor", moeda.value);
      moeda.addEventListener("change", () => shared.setCurrency(moeda.value));
    }
    const idioma = document.getElementById("accIdioma");
    if (idioma) {
      idioma.value = shared.getLanguage();
      const opt = idioma.options[idioma.selectedIndex];
      escreve("accIdiomaValor", opt ? opt.dataset.sigla : "");
      idioma.addEventListener("change", () => shared.setLanguage(idioma.value));
    }

    // Tema: cada toque passa pro próximo (Auto → Claro → Escuro). Auto segue
    // o sistema (limpa a escolha salva); Claro/Escuro fixam.
    const tema = document.getElementById("accTema");
    const marcaTema = () => {
      const nome = t(`acc.theme.${shared.getThemePref()}`);
      escreve("accTemaValor", nome);
      tema.setAttribute("aria-label", `${t("acc.theme")}: ${nome}`);
    };
    if (tema) {
      marcaTema();
      tema.addEventListener("click", () => {
        const i = TEMAS.indexOf(shared.getThemePref());
        shared.setTheme(TEMAS[(i + 1) % TEMAS.length]);
      });
      document.addEventListener("sleevu:theme", marcaTema);
    }

    // Preços = o Modo Colecionador do olho do topo do desktop.
    const precos = document.getElementById("accPrecos");
    const marcaPrecos = () => {
      const escondidos = shared.collectorModeEnabled();
      precos.setAttribute("aria-pressed", String(escondidos));
      escreve("accPrecosValor", t(escondidos ? "acc.prices.hidden" : "acc.prices.shown"));
    };
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
  ligaRapidos();
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
