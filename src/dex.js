// Pokédex (pokedex.html) — redesenho de 2026-10-17. A tela era uma grade de
// cartões de 181×295 px com um sprite de 96 px no meio: 1.025 espécies viravam
// ~170 linhas no desktop e uns 2 Pokémon por tela no celular, e o "Já tenho"
// era um botão em cada cartão. Este módulo é dono do desenho; o app.js segue
// dono dos dados (índice por espécie, filtros, busca, stores) e chama daqui:
//   liga(ctx)      uma vez, com o catálogo em mãos;
//   itens(lista)   recebe as espécies filtradas e devolve o que a grade desenha;
//   desenha(item)  o elemento de cada caixa;
//   pintou(grade)  depois de cada render/append.
// Só o pokedex.html carrega este arquivo (e a folha "pokedex" do split-css).
//
// Versão B, "Caixas": a Pokédex em caixas de 30 (6×5), como as caixas do PC
// dos jogos e dos trackers de living dex. Só o sprite em cada casa; quem
// falta é silhueta; cada caixa tem o seu "18/30" e fica dourada completa.
// Tocar abre o Pokémon; o "Modo marcar" troca o toque por marcar "já tenho".
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const { t, escapeHtml, escapeAttribute, detailUrl } = shared;

  // 30 = 6 colunas × 5 linhas, o tamanho de caixa dos jogos desde Gen I/II.
  const POR_CAIXA = 30;

  let ctx = null;
  let marcando = false;
  // Com alguma captura, quem falta vira silhueta — o "ainda não registrado"
  // da Pokédex dos jogos. Sem nenhuma, tudo em cor: 35 caixas de sombras não
  // dizem nada a quem só veio navegar.
  let algumCapturado = false;

  const fmt = (n) => Number(n || 0).toLocaleString(shared.getLocale());
  const num = (id) => `#${String(id).padStart(4, "0")}`;
  const capturado = (item) => Boolean(item.dexMarked || item.ownedCount > 0);

  const ICONE_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

  function liga(c) {
    ctx = c;
    montaModoMarcar();
  }

  // A lista filtrada, fatiada em caixas POR REGIÃO ("Kanto 1", "Kanto 2"…,
  // como no guia de living dex do PokéPC): a caixa nunca mistura duas
  // gerações, então conversa com o progresso dos chips. A última de cada
  // região pode vir incompleta (Kanto 6 é só o Mew). Com filtro ("Ainda
  // faltam", tipo…), as caixas são do recorte — o que falta vira poucas
  // caixas cheias.
  function itens(lista) {
    const progresso = ctx && ctx.progresso ? ctx.progresso() : null;
    algumCapturado = Boolean(progresso && progresso.c > 0);
    const caixas = [];
    const porGeracao = new Map();
    lista.forEach((item) => {
      if (!porGeracao.has(item.generation)) porGeracao.set(item.generation, []);
      porGeracao.get(item.generation).push(item);
    });
    porGeracao.forEach((especiesDaGeracao, geracao) => {
      const regiao = shared.regionForGeneration(geracao) || `Gen ${geracao}`;
      for (let i = 0; i < especiesDaGeracao.length; i += POR_CAIXA) {
        caixas.push({ type: "caixa", doDex: true, nome: `${regiao} ${i / POR_CAIXA + 1}`, especies: especiesDaGeracao.slice(i, i + POR_CAIXA) });
      }
    });
    return caixas;
  }

  function desenha(caixa) {
    const el = document.createElement("section");
    const c = caixa.especies.filter(capturado).length;
    const total = caixa.especies.length;
    el.className = `pdx-caixa${c === total && algumCapturado ? " is-completa" : ""}`;
    el.setAttribute("aria-label", caixa.nome);
    const de = caixa.especies[0].dexId, ate = caixa.especies[total - 1].dexId;
    // "Marcar caixa" só existe com o Modo marcar ligado (o CSS esconde fora
    // dele): o marcar em massa saiu da Pokédex em 2026-09-14 justamente por
    // aparecer sem ninguém pedir.
    el.innerHTML = `<header class="pdx-caixa-head"><h2 class="pdx-caixa-nome">${escapeHtml(caixa.nome)}</h2>`
      + `<span class="pdx-caixa-faixa">${escapeHtml(num(de))}–${escapeHtml(num(ate))}</span>`
      + `<span class="pdx-caixa-n">${escapeHtml(fmt(c))}/${escapeHtml(fmt(total))}</span>`
      + `<button type="button" class="pdx-caixa-tudo">${escapeHtml(t(c === total ? "pdx.boxNone" : "pdx.boxAll"))}</button></header>`
      + `<div class="pdx-caixa-grade"></div>`;
    const grade = el.querySelector(".pdx-caixa-grade");
    caixa.especies.forEach((item) => grade.appendChild(casa(item)));
    return el;
  }

  function casa(item) {
    const el = document.createElement("a");
    const tem = capturado(item);
    el.className = `pdx-cel${tem ? " is-tenho" : ""}${!tem && algumCapturado ? " is-falta" : ""}`;
    el.href = detailUrl("pokemon", item.name);
    el.dataset.dex = String(item.dexId);
    el.dataset.cartas = String(item.ownedCount || 0);
    if (item.dexMarked) el.dataset.marcado = "1";
    // O nome não cabe na casa: vai no title (mouse) e no aria-label (leitor).
    const rotulo = `${num(item.dexId)} ${item.name}${tem ? `, ${t("dex.haveActive")}` : ""}`;
    el.title = `${num(item.dexId)} ${item.name}`;
    el.setAttribute("aria-label", rotulo);
    el.innerHTML = `<span class="pdx-num">${escapeHtml(String(item.dexId))}</span>`
      + `<span class="pdx-check" aria-hidden="true">${ICONE_CHECK}</span>`
      + (item.image ? `<img class="pdx-sprite" loading="lazy" decoding="async" src="${escapeAttribute(item.image)}" alt="" width="96" height="96">` : "");
    return el;
  }

  // ── Modo marcar ─────────────────────────────────────────────────────────
  // Um interruptor no topo: ligado, tocar numa casa marca/desmarca "já tenho"
  // (com o tremor do vibrar) em vez de abrir a página dela. É o gesto de quem
  // está ticando a Pokédex inteira, caixa por caixa.
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
      const tudo = event.target.closest(".pdx-caixa-tudo");
      if (tudo) { marcaCaixa(tudo.closest(".pdx-caixa")); return; }
      if (!marcando) return;
      const cel = event.target.closest(".pdx-cel");
      if (!cel) return;
      event.preventDefault();
      alterna(cel);
      shared.vibrar(12);
      repintaCaixa(cel.closest(".pdx-caixa"));
    });
  }

  function alterna(cel) {
    const marcado = ctx && ctx.marca ? ctx.marca(cel.dataset.dex) : false;
    if (marcado) cel.dataset.marcado = "1"; else delete cel.dataset.marcado;
    // Captura = marcado OU tem carta: desmarcar quem tem carta não apaga.
    const tem = marcado || Number(cel.dataset.cartas) > 0;
    // A primeira marcação liga o "quem falta vira silhueta" na tela toda.
    if (tem && !algumCapturado) {
      algumCapturado = true;
      document.querySelectorAll(".pdx-cel:not(.is-tenho)").forEach((c) => { if (c !== cel) c.classList.add("is-falta"); });
    }
    cel.classList.toggle("is-tenho", tem);
    cel.classList.toggle("is-falta", !tem && algumCapturado);
  }

  // "Marcar caixa": marca as 30 de uma vez (o "Mark All" dos trackers de living
  // dex). Caixa já cheia: desmarca as que foram MARCADAS — as capturadas por
  // carta continuam, porque a carta continua na coleção.
  function marcaCaixa(caixa) {
    if (!caixa) return;
    const casas = Array.from(caixa.querySelectorAll(".pdx-cel"));
    const cheia = casas.every((c) => c.classList.contains("is-tenho"));
    casas.forEach((c) => {
      if (cheia ? c.dataset.marcado === "1" : !c.classList.contains("is-tenho")) alterna(c);
    });
    shared.vibrar(24);
    repintaCaixa(caixa);
  }

  // O "18/30", o dourado e o botão da caixa acompanham a marcação no lugar
  // (redesenhar a grade faria as 30 casas piscarem).
  function repintaCaixa(caixa) {
    if (!caixa) return;
    const casas = caixa.querySelectorAll(".pdx-cel");
    const c = caixa.querySelectorAll(".pdx-cel.is-tenho").length;
    caixa.querySelector(".pdx-caixa-n").textContent = `${fmt(c)}/${fmt(casas.length)}`;
    caixa.classList.toggle("is-completa", c === casas.length);
    caixa.querySelector(".pdx-caixa-tudo").textContent = t(c === casas.length ? "pdx.boxNone" : "pdx.boxAll");
  }

  function pintou() { /* o resumo é escrito pelo app.js (updatePokedexStats) */ }

  window.SleevuDex = { liga, itens, desenha, pintou };
})();
