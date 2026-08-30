// Calendário de lançamentos (lancamentos.html). Lê UM arquivo pequeno gerado no
// build — data/releases.generated.json, do scripts/build-releases.mjs — em vez
// dos 13 manifests, que somam megabytes pra desenhar ~40 linhas. O mesmo passo
// publica o lancamentos.ics, então a página e o calendário assinado nunca
// divergem.
//
// A data já existia em `release` na entrada de cada set do manifest: nenhuma
// fonte nova, nenhuma chamada externa.
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const lista = document.getElementById("relList");
  if (!lista) return;
  const { t, escapeHtml, escapeAttribute } = shared;
  const chips = document.getElementById("relGames");

  let sets = [];
  let jogo = "";

  const hojeISO = () => new Date().toISOString().slice(0, 10);

  // Diferença em DIAS DE CALENDÁRIO, não em horas: "falta 1 dia" tem que valer
  // pra amanhã de manhã e pra amanhã à noite igual.
  function diasAte(iso) {
    const a = Date.UTC(...hojeISO().split("-").map((n, i) => (i === 1 ? +n - 1 : +n)));
    const b = Date.UTC(...iso.split("-").map((n, i) => (i === 1 ? +n - 1 : +n)));
    return Math.round((b - a) / 86400000);
  }

  function selo(iso) {
    const d = diasAte(iso);
    if (d < 0) return { txt: t("rel.out"), cls: " is-out" };
    if (d === 0) return { txt: t("rel.today"), cls: " is-today" };
    if (d === 1) return { txt: t("rel.tomorrow"), cls: " is-soon" };
    return { txt: t("rel.inDays", { n: d }), cls: d <= 14 ? " is-soon" : "" };
  }

  // Nome no idioma da pessoa quando a fonte tem; senão o que veio.
  function nomeDo(s) {
    const lang = shared.getLanguage ? shared.getLanguage() : "pt";
    return (s.nomes && (s.nomes[lang] || s.nomes.en)) || s.n || s.id;
  }

  function mesDe(iso) {
    const d = new Date(iso + "T12:00:00Z");
    const txt = d.toLocaleDateString(shared.getLocale(), { month: "long", year: "numeric", timeZone: "UTC" });
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }
  function diaDe(iso) {
    return new Date(iso + "T12:00:00Z")
      .toLocaleDateString(shared.getLocale(), { day: "2-digit", month: "short", timeZone: "UTC" });
  }

  function pintaChips() {
    if (!chips) return;
    const jogos = shared.GAME_SLUGS.filter((g) => sets.some((s) => s.g === g));
    if (jogos.length < 2) { chips.innerHTML = ""; return; }
    const botao = (valor, rotulo) =>
      `<button type="button" class="chip${valor === jogo ? " active" : ""}" data-rel-game="${escapeAttribute(valor)}" aria-pressed="${valor === jogo}">${escapeHtml(rotulo)}</button>`;
    chips.innerHTML = botao("", t("filter.all.m")) + jogos.map((g) => botao(g, shared.gameLabel(g))).join("");
  }

  function pinta() {
    const visiveis = sets.filter((s) => !jogo || s.g === jogo);
    if (!visiveis.length) {
      lista.innerHTML = `<p class="empty-state">${escapeHtml(t(sets.length ? "rel.emptyGame" : "rel.empty"))}</p>`;
      return;
    }
    let mesAtual = "";
    const partes = [];
    visiveis.forEach((s) => {
      const mes = mesDe(s.d);
      if (mes !== mesAtual) { mesAtual = mes; partes.push(`<h2 class="rel-month">${escapeHtml(mes)}</h2>`); }
      const sl = selo(s.d);
      const nome = nomeDo(s);
      // Link pro set: o detalhe já sabe abrir por nome+setId+jogo. Set que ainda
      // não saiu costuma não ter carta no catálogo, e a própria página de
      // detalhe trata isso (mensagem + busca) desde o P8.
      const href = shared.detailUrl("set", nome, "", s.g, { setId: s.id });
      const logo = s.logo
        ? `<span class="rel-logo">${shared.localizedImg(s.logo, { alt: "", loading: "lazy" })}</span>`
        : "";
      partes.push(`<a class="rel-row${sl.cls}" href="${escapeAttribute(href)}">
        <span class="rel-date">${escapeHtml(diaDe(s.d))}</span>
        ${logo}
        <span class="rel-info">
          <strong class="rel-name">${escapeHtml(nome)}</strong>
          <span class="rel-meta">${escapeHtml(shared.gameLabel(s.g))}${s.total ? escapeHtml(` · ${t("rel.cards", { n: s.total })}`) : ""}</span>
        </span>
        <span class="rel-badge">${escapeHtml(sl.txt)}</span>
      </a>`);
    });
    lista.innerHTML = partes.join("");
  }

  if (chips) {
    chips.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-rel-game]");
      if (!b) return;
      jogo = b.dataset.relGame;
      pintaChips();
      pinta();
    });
  }

  fetch("data/releases.generated.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((dados) => {
      // Ordena de novo no cliente: o arquivo é gerado uma vez por deploy, e o
      // "já saiu" de ontem tem que descer sozinho no dia seguinte sem redeploy.
      sets = ((dados && dados.sets) || []).slice().sort((a, b) => a.d.localeCompare(b.d));
      pintaChips();
      pinta();
    })
    .catch(() => { lista.innerHTML = `<p class="empty-state">${escapeHtml(t("rel.empty"))}</p>`; });
})();
