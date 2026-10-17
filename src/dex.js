// Pokédex (pokedex.html) — redesenho de 2026-10-17. A tela era uma grade de
// cartões de 181×295 px com um sprite de 96 px no meio: 1.025 espécies viravam
// ~170 linhas no desktop e uns 2 Pokémon por tela no celular, e o "Já tenho"
// era um botão em cada cartão. Este módulo é dono do desenho; o app.js segue
// dono dos dados (índice por espécie, filtros, busca, stores) e chama daqui:
//   liga(ctx)      uma vez, com o catálogo em mãos;
//   itens(lista)   recebe as espécies filtradas e devolve o que a grade desenha;
//   desenha(item)  o elemento de cada espécie (ou cabeçalho de região);
//   pintou(grade)  depois de cada render/append.
// Só o pokedex.html carrega este arquivo (e a folha "pokedex" do split-css).
//
// Versão A, "Pokédex nacional": grade densa de sprites na ordem da Pokédex,
// cortada por região com o progresso de cada uma no cabeçalho. Tocar abre o
// Pokémon; o "Modo marcar" troca o toque por marcar/desmarcar "já tenho".
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const { t, escapeHtml, escapeAttribute, detailUrl, toRoman } = shared;

  let ctx = null;
  let marcando = false;
  // Com alguma captura, quem falta fica apagado (cinza) e quem já tem, em cor —
  // o retrato da coleção. Sem nenhuma, tudo fica em cor: uma parede cinza não
  // diz nada a quem só veio navegar.
  let algumCapturado = false;

  const fmt = (n) => Number(n || 0).toLocaleString(shared.getLocale());
  const num = (id) => `#${String(id).padStart(4, "0")}`;
  const capturado = (item) => Boolean(item.dexMarked || item.ownedCount > 0);

  const ICONE_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

  function liga(c) {
    ctx = c;
    montaModoMarcar();
  }

  // Cabeçalho de região antes da primeira espécie de cada geração. Com uma
  // geração escolhida no chip, um cabeçalho só; com busca, nenhum (a lista é
  // curta e o cabeçalho viraria ruído entre dois resultados).
  function itens(lista) {
    const progresso = ctx && ctx.progresso ? ctx.progresso() : null;
    algumCapturado = Boolean(progresso && progresso.c > 0);
    const buscando = ctx && ctx.busca ? Boolean(ctx.busca()) : false;
    if (buscando) return lista;
    const out = [];
    let atual = null;
    lista.forEach((item) => {
      if (item.generation !== atual) {
        atual = item.generation;
        const daGeracao = lista.filter((i) => i.generation === atual);
        const p = progresso && progresso.gen ? progresso.gen[String(atual)] : null;
        // doDex: o app.js manda pra cá; cabecalho: não conta como resultado.
        out.push({
          type: "regiao",
          doDex: true,
          cabecalho: true,
          geracao: atual,
          de: daGeracao[0].dexId,
          ate: daGeracao[daGeracao.length - 1].dexId,
          c: p ? p.c : 0,
          t: p ? p.t : daGeracao.length
        });
      }
      out.push(item);
    });
    return out;
  }

  function desenha(item) {
    if (item.type === "regiao") return cabecalho(item);
    return celula(item);
  }

  function cabecalho(h) {
    const el = document.createElement("div");
    el.className = "pdx-head";
    el.dataset.geracao = String(h.geracao);
    const regiao = shared.regionForGeneration(h.geracao) || "";
    const pct = h.t ? Math.round((h.c / h.t) * 100) : 0;
    el.innerHTML = `<h2 class="pdx-head-nome">${escapeHtml(regiao || `Gen ${toRoman(h.geracao)}`)}</h2>`
      + `<span class="pdx-head-sub">Gen ${escapeHtml(toRoman(h.geracao))} · ${escapeHtml(num(h.de))}–${escapeHtml(num(h.ate))}</span>`
      + `<span class="pdx-head-prog"><span class="pdx-head-n">${escapeHtml(fmt(h.c))}/${escapeHtml(fmt(h.t))}</span>`
      + `<span class="pdx-barra" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeAttribute(regiao)}"><i style="width:${pct}%"></i></span></span>`;
    return el;
  }

  function celula(item) {
    const el = document.createElement("a");
    const tem = capturado(item);
    el.className = `pdx-cel${tem ? " is-tenho" : ""}${!tem && algumCapturado ? " is-falta" : ""}`;
    el.href = detailUrl("pokemon", item.name);
    el.dataset.dex = String(item.dexId);
    el.dataset.cartas = String(item.ownedCount || 0);
    el.setAttribute("aria-label", `${num(item.dexId)} ${item.name}${tem ? `, ${t("dex.haveActive")}` : ""}`);
    // Cartas: "3/41" pra quem tem alguma; senão só o total do catálogo.
    const cartas = item.ownedCount > 0
      ? `<span class="pdx-cartas is-minhas">${escapeHtml(fmt(item.ownedCount))}/${escapeHtml(fmt(item.totalCount))}</span>`
      : `<span class="pdx-cartas">${escapeHtml(fmt(item.totalCount))}</span>`;
    el.innerHTML = `<span class="pdx-num">${escapeHtml(num(item.dexId))}</span>`
      + `<span class="pdx-check" aria-hidden="true">${ICONE_CHECK}</span>`
      + (item.image ? `<img class="pdx-sprite" loading="lazy" decoding="async" src="${escapeAttribute(item.image)}" alt="" width="96" height="96">` : `<span class="pdx-sprite"></span>`)
      + `<span class="pdx-nome">${escapeHtml(item.name)}</span>${cartas}`;
    return el;
  }

  // ── Modo marcar ─────────────────────────────────────────────────────────
  // Um interruptor no topo: ligado, tocar numa espécie marca/desmarca "já
  // tenho" (com o tremor do vibrar) em vez de abrir a página dela. É o gesto
  // de quem está ticando a Pokédex inteira; o botão em cada cartão de antes
  // obrigava a acertar um alvo pequeno 1.025 vezes.
  function montaModoMarcar() {
    const botao = document.getElementById("pdxMarcar");
    const grade = document.getElementById("cardGrid");
    if (!botao || !grade || botao.dataset.ligado) return;
    botao.dataset.ligado = "1";
    botao.addEventListener("click", () => {
      marcando = !marcando;
      botao.setAttribute("aria-pressed", String(marcando));
      grade.classList.toggle("is-marcando", marcando);
      const dica = document.getElementById("pdxDica");
      if (dica) dica.hidden = !marcando;
    });
    grade.addEventListener("click", (event) => {
      if (!marcando) return;
      const cel = event.target.closest(".pdx-cel");
      if (!cel) return;
      event.preventDefault();
      const marcado = ctx && ctx.marca ? ctx.marca(cel.dataset.dex) : false;
      shared.vibrar(12);
      // Captura = marcado OU tem carta: desmarcar quem tem carta não apaga.
      const tem = marcado || Number(cel.dataset.cartas) > 0;
      cel.classList.toggle("is-tenho", tem);
      cel.classList.toggle("is-falta", !tem);
      repintaCabecalhos();
    });
  }

  // O cabeçalho de cada região acompanha a marcação sem redesenhar a grade
  // (redesenhar faria os 1.025 sprites piscarem).
  function repintaCabecalhos() {
    const progresso = ctx && ctx.progresso ? ctx.progresso() : null;
    if (!progresso) return;
    document.querySelectorAll(".pdx-head[data-geracao]").forEach((h) => {
      const p = progresso.gen[h.dataset.geracao];
      if (!p) return;
      const pct = p.t ? Math.round((p.c / p.t) * 100) : 0;
      h.querySelector(".pdx-head-n").textContent = `${fmt(p.c)}/${fmt(p.t)}`;
      const barra = h.querySelector(".pdx-barra");
      barra.setAttribute("aria-valuenow", String(pct));
      barra.querySelector("i").style.width = `${pct}%`;
    });
  }

  function pintou() { /* o resumo é escrito pelo app.js (updatePokedexStats) */ }

  window.SleevuDex = { liga, itens, desenha, pintou };
})();
