(function () {
  const shared = window.TCGShared;
  const { escapeHtml, escapeAttribute, t, tn, getLocale, detailUrl } = shared;

  // Tudo na moeda escolhida no header.
  function money(value) {
    return shared.formatMoney(shared.getCurrency(), value > 0 ? value : 0);
  }

  // ===========================================================================
  // Portfólio: visão FINANCEIRA da Minha Coleção — TODOS os jogos, com filtro
  // por jogo dentro da página (#gameFilter, o mesmo das outras telas, pra herdar
  // os 13 jogos e a gaveta do mobile). O total tem que BATER com a
  // Coleção -> mesma fonte e mesma fórmula:
  //   patrimônio = cartas raw (todos os jogos) + slabs graded.
  // Binders e wishlist são VISÕES (filtros), não somam ao patrimônio.
  // Coleção unificada igual à collection.js (stores por jogo + facades).
  // A página é NEUTRA (sessão "hub", ver isNeutralPage no game.js): nada aqui
  // depende do jogo da sessão. Já houve um "portfólio combinado" separado que
  // somava por cookie sleevu_pf_<g> quando a sessão era hub — removido: esta
  // visão É a combinada, com dado real em vez de resumo de cookie. Os cookies
  // continuam sendo GRAVADOS (shared.recordValueSnapshot): o valueSnapshot do
  // shared.js ainda os lê como fallback do retrato instantâneo.
  // ===========================================================================
  const GAMES = shared.GAME_SLUGS;
  const GAME_COLOR = shared.GAME_COLOR;
  const { ownedByGame, wishlistByGame, cardGameMap, gameOf, owned, wishlist, prices } = shared.createCrossGameStores();
  // Preço-alvo da wishlist ("me avisa quando chegar a R$X"): global, anotado na
  // página de Wishlist. Aqui ele vira a coluna que diz o quanto falta cair.
  const wishTargets = shared.createWishTargetsStore();
  // Modo investidor (opcional): custo pago por carta + vendas realizadas.
  const costsStore = shared.createCostsStore();
  const soldStore = shared.createSoldStore();
  const listStore = shared.createListStore();

  let cards = [];
  let cardsById = new Map();
  let gameFilter = "all";
  let breakdownMode = "set"; // set | rarity | artist | wish
  let topShowAll = false; // "mais valiosas": top 15 ou a lista inteira

  const elements = {
    grandTotal: document.getElementById("grandTotal"),
    rawValue: document.getElementById("rawValue"),
    gradedValue: document.getElementById("gradedValue"),
    pricedCopies: document.getElementById("pricedCopies"),
    investedValue: document.getElementById("investedValue"),
    wishlistValue: document.getElementById("wishlistValue"),
    composition: document.getElementById("pfComposition"),
    breakdown: document.getElementById("pfBreakdown"),
    breakdownTabs: document.getElementById("pfBreakdownTabs"),
    breakdownBody: document.getElementById("pfBreakdownBody"),
    gameFilter: document.getElementById("gameFilter"),
    topCards: document.getElementById("topCards"),
    export: document.getElementById("pfExport"),
    empty: document.getElementById("emptyState")
  };

  const inGameId = (g) => gameFilter === "all" || (g || "pokemon") === gameFilter;

  // Maiores altas/quedas do MERCADO (price-movers do build diário).
  const moversByGame = Object.fromEntries(GAMES.map((g) => [g, null]));
  const fetchMovers = (dir) => fetch(dir + "price-movers.generated.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  // ÍNDICE DE MERCADO por jogo (build): { d: [datas], i: [valores base 1000] }.
  // É o benchmark do gráfico — a resposta pra "isso é a minha coleção ou é o
  // mercado inteiro?". Arquivo minúsculo (centenas de bytes), buscado só quando
  // o modo % está ligado, que é o único em que ele faz sentido.
  const indexByGame = Object.fromEntries(GAMES.map((g) => [g, null]));
  let indexPedido = false;
  function hidrataIndices() {
    if (indexPedido) return Promise.resolve();
    indexPedido = true;
    return Promise.all(GAMES.map((g) =>
      fetch(shared.gameDataDir(g) + "market-index.generated.json")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((j) => { indexByGame[g] = j && Array.isArray(j.d) && Array.isArray(j.i) ? j : null; })
    )).then(() => { renderControls(); renderChart(chartHistory()); });
  }

  // RETRATO INSTANTÂNEO antes de qualquer rede (estilo Collectr): o último
  // valor conhecido (histórico sincronizado ou cookie, via shared.valueSnapshot)
  // pinta os cartões NA HORA, esmaecido de leve; o cálculo fresco do render()
  // troca os números e tira o esmaecido quando os chunks chegam. Quem abre o
  // Portfólio abre pra ver o número — ele não pode esperar 50 requisições.
  const SNAP_ELS = ["grandTotal", "rawValue", "gradedValue", "wishlistValue"];
  // Ponto de partida do patrimônio "assentando" (ver pintaPatrimonio): é o
  // valor do retrato que o usuário JÁ está vendo — contar a partir do zero
  // animaria um número que nunca foi verdade.
  let snapStart = null;
  (function paintSnapshot() {
    const snap = shared.valueSnapshot();
    if (!snap) return;
    const fromBRL = (v) => { const r = shared.convertMoney(v, "BRL", shared.getCurrency()); return r == null ? v : r; };
    const pinta = (el, v) => { if (el) { el.textContent = money(fromBRL(v)); el.style.opacity = "0.55"; } };
    snapStart = fromBRL(snap.total);
    pinta(elements.grandTotal, snap.total);
    pinta(elements.rawValue, snap.raw);
    pinta(elements.gradedValue, snap.graded);
    pinta(elements.wishlistValue, snap.wish);
  })();

  // O patrimônio PRIMEIRO, só com as suas cartas. Antes esta página buscava os
  // movers dos 12 jogos ANTES de tudo e somava os ids deles à carga — o que
  // arrastava chunks de sets de jogos onde você não tem carta nenhuma, e
  // segurava o número que a pessoa abriu a página pra ver. Agora o mercado é
  // uma segunda etapa: quando chega, só re-renderiza a própria seção.
  // loadOwnedFast: pede à borda (/api/collection) exatamente as cartas que você
  // tem, em vez de baixar os chunks INTEIROS de cada set em que tem alguma —
  // era o download que segurava esta página. Sem a borda, cai nos chunks.
  // Possuídas + DESEJADAS. As desejadas entravam na conta de "desejos" mas nunca
  // eram carregadas — e wishlistTotal varre `cards`, então a carta que você quer
  // (e por definição não tem) não estava lá pra ser somada: o número saía quase
  // sempre só com os faltantes de binder. A wishlist.js já carregava as duas
  // listas juntas; aqui faltava. Mesma requisição, sem ida extra à rede.
  // collectionLoadIds soma ainda os ids que estão em SLAB: graduar e tirar a
  // cópia raw (o certo — senão a carta conta duas vezes) tirava o id de
  // knownCardIds, e o slab ficava sem carta: sumia da Graded, perdia o valor
  // automático PSA e caía no jogo errado na composição.
  const idsOwned = shared.collectionLoadIds(
    ownedByGame,
    Object.fromEntries(GAMES.map((g) => [g, wishlistByGame[g].knownCardIds()]))
  );
  Promise.all([shared.loadOwnedFast(idsOwned), shared.loadFxRates()])
    .then(([catalog]) => {
      indexaCartas(catalog.cards);
      // Carga incompleta (ver fetchCollectionApi e loadAcrossGames — os dois
      // caminhos marcam `parcial`): os totais desta sessão estão
      // subestimados, então NÃO grava o ponto do dia — ele substituiria o de
      // hoje e o gráfico mostraria uma queda que não houve. Vale pra sessão
      // inteira: as cargas seguintes (listas, binders, movers) não completam o
      // que faltou aqui.
      if (catalog.parcial) cargaParcial = true;
      GAMES.forEach((g) => ownedByGame[g].migrateLegacy((cardId) => shared.defaultVariant(cardsById.get(cardId))));
      const escopo = escopoDeJogos();
      shared.setGameFilterScope(escopo);
      // ?filter=<jogo> na URL: abre já filtrado (o chip do Hub manda assim, e é
      // o que faz o refresh/compartilhamento não perderem o filtro).
      const pedido = shared.gameFilterFromUrl();
      if (pedido && escopo.includes(pedido)) {
        gameFilter = pedido;
        shared.markGameFilterChip(pedido);
        shared.applyGameAccent(pedido);
      }
      bindGameFilter();
      bindComposition();
      bindBreakdown();
      bindExport();
      render();
      hidrataListas();
      hidrataMovers();
    })
    .catch((error) => {
      shared.mostraErroDeCatalogo(elements.empty, error);
      elements.empty.hidden = false;
    });

  function indexaCartas(lista) {
    // Dedupe por id: a carga dos movers traz o CHUNK INTEIRO do set, então pode
    // repetir carta que já veio na carga das suas — e carta repetida na lista
    // seria valor contado duas vezes nos totais.
    const porId = new Map();
    (lista || []).forEach((card) => { if (!porId.has(card.id)) porId.set(card.id, card); });
    cards = Array.from(porId.values());
    limpaMemo(); // as cartas mudaram: as contas memoizadas do render anterior morrem
    snapshotGravado = false; // com carta nova, o ponto do dia merece ser regravado
    cards.forEach((card) => cardGameMap.set(card.id, card.game));
    cardsById = porId;
  }

  // Segunda etapa: busca os movers e, se algum deles for carta que você não
  // tem, carrega SÓ esses ids antes de desenhar. Falhar aqui não pode estragar
  // a página — a seção simplesmente não aparece (o renderMovers já descarta
  // mover sem carta no catálogo).
  // 2ª etapa das Listas/Binders: as cartas de uma lista de COMPRA não estão na
  // sua coleção, então não vieram na carga inicial — sem elas a lista valeria
  // zero. Buscamos só os ids que faltam, como o hidrataMovers faz.
  //
  // O jogo de um id desconhecido não dá pra adivinhar (o id não carrega a marca),
  // então: usa o `game` da lista quando ele existe e, no resto, pede o id a todos
  // os jogos — id de outro jogo é no-op no loader (mesmo padrão do sales.js).
  // O TETO existe porque esse "no resto" multiplica por 13: uma lista gigante sem
  // jogo viraria uma carga maior que a da própria coleção.
  const TETO_IDS_SEM_JOGO = 300;
  function hidrataListas() {
    const porJogo = Object.fromEntries(GAMES.map((g) => [g, []]));
    const semJogo = [];
    const querido = (id, jogo) => {
      if (!id || cardsById.has(id)) return;           // já veio na carga inicial
      if (jogo && porJogo[jogo]) porJogo[jogo].push(id);
      else semJogo.push(id);
    };
    listStore.list().forEach((l) => (l.entries || []).forEach((e) => querido(e && e.id, l.game)));
    lerBinders().forEach((b) => (b.slots || []).forEach((s) => querido(s && s.cardId, null)));
    const orfaos = [...new Set(semJogo)].slice(0, TETO_IDS_SEM_JOGO);
    GAMES.forEach((g) => { porJogo[g] = [...new Set(porJogo[g].concat(orfaos))]; });
    if (!Object.values(porJogo).some((ids) => ids.length)) { renderListas(); return Promise.resolve(); }
    return shared.loadOwnedAcrossGames(porJogo)
      .then((extra) => { indexaCartas(cards.concat(extra.cards || [])); renderListas(); })
      .catch(() => { renderListas(); }); // sem as extras a seção ainda mostra o que dá
  }

  function hidrataMovers() {
    return Promise.all(GAMES.map((g) => fetchMovers(shared.gameDataDir(g))))
      .then((movers) => {
        GAMES.forEach((g, i) => { moversByGame[g] = movers[i]; });
        const idsOf = (m) => m ? (m.up || []).concat(m.down || []).map((x) => x.id) : [];
        const faltando = Object.fromEntries(GAMES.map((g, i) => [g, idsOf(movers[i]).filter((id) => !cardsById.has(id))]));
        if (!Object.values(faltando).some((ids) => ids.length)) { renderMovers(); return; }
        return shared.loadOwnedAcrossGames(faltando).then((extra) => {
          indexaCartas(cards.concat(extra.cards || []));
          renderMovers();
        });
      })
      .catch(() => { /* mercado é acessório: sem ele a página segue inteira */ });
  }

  // Barra da composição -> aplica o filtro do jogo (ver renderComposition).
  // Delegado no container, que é reescrito a cada render.
  function bindComposition() {
    if (!elements.composition) return;
    elements.composition.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-comp-game]");
      if (!btn) return;
      aplicaFiltroDeJogo(btn.dataset.compGame);
    });
  }

  // Um caminho só pra trocar o filtro de jogo — o clique no chip, a barra da
  // composição e o ?filter= da URL fazem exatamente a mesma coisa.
  function aplicaFiltroDeJogo(slug) {
    if (!slug || slug === gameFilter) return;
    gameFilter = slug;
    shared.markGameFilterChip(slug);
    shared.applyGameAccent(slug);
    shared.stampGameFilter(slug);
    render();
    if (elements.gameFilter) elements.gameFilter.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function bindGameFilter() {
    if (!elements.gameFilter) return;
    elements.gameFilter.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-game-filter]");
      if (!chip || chip.dataset.gameFilter === gameFilter) return;
      gameFilter = chip.dataset.gameFilter;
      Array.from(elements.gameFilter.children).forEach((node) =>
        node.setAttribute("aria-pressed", String(node === chip)));
      shared.applyGameAccent(gameFilter);
      // Na URL: refresh mantém o filtro e o link do Portfólio filtrado pode ser
      // compartilhado (ver shared.stampGameFilter).
      shared.stampGameFilter(gameFilter);
      render();
    });
  }

  // Reduz os chips aos jogos em que você TEM alguma coisa — cartas, slabs,
  // desejos ou histórico já gravado. Com menos de dois, o shared esconde a barra
  // inteira (um jogo só e "Todos" são o mesmo conjunto). O histórico entra na
  // conta pra um jogo que você zerou não sumir do filtro enquanto a linha dele
  // ainda aparece no gráfico.
  function escopoDeJogos() {
    return GAMES.filter((g) =>
      ownedByGame[g].size > 0
      || gradedSlabs(g).length > 0
      || wishlistByGame[g].knownCardIds().length > 0
      || loadHist(g).length > 0);
  }

  function bindBreakdown() {
    if (!elements.breakdownTabs) return;
    elements.breakdownTabs.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-bd]");
      if (!tab || tab.dataset.bd === breakdownMode) return;
      breakdownMode = tab.dataset.bd;
      Array.from(elements.breakdownTabs.children).forEach((node) =>
        node.classList.toggle("active", node === tab));
      render();
    });
  }

  // ---- Export CSV do portfólio (snapshot financeiro, respeita o filtro de jogo).
  // Diferente do CSV do menu da conta (inventário do jogo da sessão, preço manual):
  // aqui vai TODO o patrimônio precificado — cartas raw com valor de mercado por
  // condição + slabs graded — em todos os jogos, na moeda do topo.
  const CSV_GAME_NAMES = { pokemon: "Pokémon", lorcana: "Lorcana", onepiece: "One Piece", naruto: "Naruto", hxh: "Hunter x Hunter" };
  function csvCell(value) {
    const s = value == null ? "" : String(value);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const csvNum = (v) => (Math.round((v || 0) * 100) / 100).toFixed(2).replace(".", ",");
  function exportPortfolioCsv() {
    const cur = shared.getCurrency();
    const { lines } = collectionLines(gameFilter);
    const rows = [t("portfolio.csv.header").split(";")];
    lines.forEach((l) => rows.push([
      t("portfolio.csv.card"), CSV_GAME_NAMES[l.card.game] || l.card.game, l.card.name, l.card.set,
      l.card.number, l.card.language || "", l.variant, l.condition, l.quantity, csvNum(l.unit), csvNum(l.total), cur
    ]));
    gradedSlabs(gameFilter).forEach((s) => {
      const card = cardsById.get(s.cardId);
      if (!card) return;
      rows.push([
        t("portfolio.csv.slab"), CSV_GAME_NAMES[card.game] || card.game, card.name, card.set,
        card.number, card.language || "", s.variant || "", `${String(s.company || "").toUpperCase()} ${shared.gradedGradeText(s.grade, s.pristine)}`,
        1, csvNum(s.value), csvNum(s.value), cur
      ]);
    });
    // BOM: o Excel só reconhece UTF-8 (acentos) com ele.
    const csv = "﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sleevu-portfolio-${new Date().toISOString().slice(0, 10)}${gameFilter !== "all" ? "-" + gameFilter : ""}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  // Liga-desliga do modo privacidade. A preferência é a MESMA das Configurações
  // (shared.setSensitive), não uma segunda: dois interruptores pro mesmo estado
  // é como se descobre, no print, que só um deles estava ligado.
  function bindPrivacy() {
    const btn = document.getElementById("pfPrivacy");
    if (!btn) return;
    const pinta = () => {
      const on = shared.sensitiveEnabled();
      btn.hidden = false;
      btn.setAttribute("aria-pressed", String(on));
      btn.textContent = on ? t("portfolio.privacy.on") : t("portfolio.privacy.off");
      btn.title = t("portfolio.privacy.hint");
    };
    pinta();
    btn.addEventListener("click", () => { shared.setSensitive(!shared.sensitiveEnabled()); pinta(); });
  }

  function bindExport() {
    bindPrivacy();
    const recap = document.getElementById("pfRecap");
    if (recap) {
      // Só oferece quando há histórico pra contar uma história (2+ pontos).
      recap.hidden = chartHistory().length < 2;
      recap.textContent = t("portfolio.recap.button");
      recap.addEventListener("click", () => exportRetrospectiva(recap));
    }
    if (!elements.export) return;
    elements.export.hidden = false;
    elements.export.addEventListener("click", exportPortfolioCsv);
    // Toggle "ver todas / top 15" da tabela de mais valiosas (a tabela é
    // re-renderizada a cada render; delega no container, que é fixo).
    if (elements.topCards) elements.topCards.addEventListener("click", (event) => {
      if (!event.target.closest("[data-pf-top-toggle]")) return;
      topShowAll = !topShowAll;
      render();
    });
    // Abas Minhas/Mercado dos movers (mesma delegação: a seção é re-renderizada).
    const movers = document.getElementById("pfMovers");
    if (movers) movers.addEventListener("click", (event) => {
      const aba = event.target.closest("[data-movers-tab]");
      if (!aba) return;
      event.preventDefault();
      moversTab = aba.dataset.moversTab;
      renderMovers();
    });
  }

  // ---- Retrospectiva do ano (PNG pra compartilhar) ---------------------------
  // O "Unpacked" do Dragon Shield mostrou que retrospectiva é o conteúdo que o
  // colecionador posta sozinho. Aqui ela sai do dado que a tela já tem: o
  // histórico por jogo, as vendas e a coleção. Canvas puro (CSP: sem lib) e sem
  // rede — nenhuma imagem de carta entra, então nunca "taint"a o canvas nem
  // depende de CDN. Só aparece com histórico suficiente pra dizer algo.
  function dadosDaRetrospectiva() {
    const ano = new Date().getFullYear();
    const inicioAno = `${ano}-01-01`;
    const hist = chartHistory();
    if (hist.length < 2) return null;
    const noAno = hist.filter((p) => p.d >= inicioAno);
    const base = noAno.length >= 2 ? noAno[0] : hist[0];
    const fim = hist[hist.length - 1];
    const valOf = (p) => fromBRL((p.c || 0) + (p.b || 0));
    const de = valOf(base), para = valOf(fim);
    const vendas = soldStore.list().filter((it) => String(it.date || "").slice(0, 4) === String(ano));
    let vendido = 0, resultado = 0;
    vendas.forEach((it) => { const v = shared.soldValues(it); vendido += v.net; if (v.hasCost) resultado += v.pnl; });
    // Jogo com maior patrimônio hoje (o "seu jogo do ano").
    const porJogo = GAMES.map((g) => ({ g, v: collectionLines(g).total + gradedSlabs(g).reduce((s, x) => s + (x.value || 0), 0) }))
      .filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    const { totalCopies } = collectionLines("all");
    return {
      ano, de, para, cresceu: para - de, pct: de > 0 ? ((para - de) / de) * 100 : 0,
      vendas: vendas.length, vendido, resultado,
      jogoTop: porJogo[0] ? shared.gameLabel(porJogo[0].g) : "",
      corTop: porJogo[0] ? GAME_COLOR[porJogo[0].g] : "#34d399",
      copias: totalCopies, desde: base.d
    };
  }

  function exportRetrospectiva(btn) {
    const d = dadosDaRetrospectiva();
    if (!d) { alert(t("portfolio.recap.tooEarly")); return; }
    const rotulo = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "…"; }
    const W = 1080, H = 1350; // 4:5, o formato que rende no feed
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    // Fundo escuro fixo (não segue o tema do site): a imagem vai viver fora
    // daqui, onde o tema de quem vê não tem nada a ver com o seu.
    ctx.fillStyle = "#101218"; ctx.fillRect(0, 0, W, H);
    const faixa = ctx.createLinearGradient(0, 0, W, 420);
    faixa.addColorStop(0, d.corTop); faixa.addColorStop(1, "#101218");
    ctx.globalAlpha = 0.22; ctx.fillStyle = faixa; ctx.fillRect(0, 0, W, 420); ctx.globalAlpha = 1;

    const texto = (s, x, y, size, weight, cor, align) => {
      ctx.font = `${weight} ${size}px ${FONT}`;
      ctx.fillStyle = cor; ctx.textAlign = align || "left"; ctx.textBaseline = "alphabetic";
      ctx.fillText(s, x, y);
    };
    texto(t("portfolio.recap.title", { ano: d.ano }), 80, 150, 40, 700, "#99a3b2");
    texto(t("portfolio.recap.headline"), 80, 220, 62, 800, "#ffffff");

    // O número grande: quanto o patrimônio cresceu (ou caiu) no ano.
    const subiu = d.cresceu >= 0;
    const corDelta = subiu ? "#4ade80" : "#f87171";
    texto(money(d.para), 80, 380, 92, 800, "#ffffff");
    texto(`${subiu ? "▲" : "▼"} ${subiu ? "+" : "−"}${money(Math.abs(d.cresceu))} (${subiu ? "+" : "−"}${Math.abs(d.pct).toFixed(1)}%)`,
      80, 440, 40, 800, corDelta);
    texto(t("portfolio.recap.since", { data: d.desde }), 80, 486, 26, 600, "#7c8698");

    // Cartões de número. Só entram os que têm o que dizer — um bloco vazio num
    // print é pior do que não existir.
    const cartoes = [
      { rot: t("portfolio.recap.copies"), val: String(d.copias) },
      { rot: t("portfolio.recap.topGame"), val: d.jogoTop }
    ];
    if (d.vendas > 0) cartoes.push({ rot: tn("portfolio.invest.soldCount", d.vendas), val: money(d.vendido) });
    if (d.resultado !== 0) cartoes.push({ rot: t("portfolio.sales.realized"), val: `${d.resultado >= 0 ? "+" : "−"}${money(Math.abs(d.resultado))}`, cor: d.resultado >= 0 ? "#4ade80" : "#f87171" });

    const CW = (W - 160 - 30) / 2, CH = 190;
    cartoes.slice(0, 4).forEach((c, i) => {
      const x = 80 + (i % 2) * (CW + 30), y = 580 + Math.floor(i / 2) * (CH + 30);
      ctx.fillStyle = "#181c25";
      ctx.beginPath(); ctx.roundRect(x, y, CW, CH, 22); ctx.fill();
      texto(c.rot.toUpperCase(), x + 32, y + 62, 22, 700, "#7c8698");
      // Encolhe a fonte até o valor caber — nome de jogo longo e patrimônio de 7
      // dígitos não podem vazar do cartão.
      let fs = 52;
      ctx.font = `800 ${fs}px ${FONT}`;
      while (fs > 24 && ctx.measureText(c.val).width > CW - 64) { fs -= 2; ctx.font = `800 ${fs}px ${FONT}`; }
      texto(c.val, x + 32, y + 132, fs, 800, c.cor || "#ffffff");
    });

    texto("Sleevu · sleevu.app", 80, H - 70, 30, 700, "#7c8698");
    shared.baixarCanvasPng(canvas, `sleevu-retrospectiva-${d.ano}.png`, {
      share: true,
      onFinish: () => { if (btn) { btn.disabled = false; btn.textContent = rotulo; } }
    });
  }

  // ---- Fontes de valor (moeda atual), filtráveis por jogo --------------------

  // MEMO POR RENDER. collectionValueLines varre a coleção inteira e
  // gradedSlabsValued re-parseia o blob de graded do localStorage — e um único
  // render chamava os dois UMA VEZ POR JOGO em três lugares (composição,
  // gráfico e snapshot), ~27 varreduras completas a cada clique de filtro ou
  // troca de aba do detalhamento. Com 5 mil cartas isso é centenas de ms no
  // celular pra recalcular exatamente o mesmo número. O cache é zerado no
  // começo de cada render (e quando as cartas mudam), então nada envelhece.
  let memoLinhas = new Map();
  let memoSlabs = null;
  let snapshotGravado = false; // ponto do dia: uma vez por carga, ver updateChart
  let cargaParcial = false;    // borda devolveu menos carta do que se pediu
  function limpaMemo() { memoLinhas = new Map(); memoSlabs = null; }

  // Cada linha é um lote carta×variante×condição da coleção, com valor unitário.
  // A conta vive no shared (collectionValueLines): é a MESMA da Coleção e do Hub.
  function collectionLines(gf) {
    const chave = gf || "all";
    if (!memoLinhas.has(chave)) {
      memoLinhas.set(chave, shared.collectionValueLines(cards, owned, prices, { gameFilter: gf }));
    }
    return memoLinhas.get(chave);
  }

  function gradedSlabs(gf) {
    if (!memoSlabs) memoSlabs = shared.gradedSlabsValued(gameOf);
    return memoSlabs.filter((s) => !gf || gf === "all" || s.game === gf);
  }

  function wishlistTotal(gf) {
    let total = 0;
    cards.forEach((card) => {
      if (gf && gf !== "all" && card.game !== gf) return;
      wishlist.variants(card.id).forEach((variant) => { total += shared.cardValue(card, variant, prices).value; });
    });
    return total;
  }

  // Binders vivos (chave unificada multi-jogo; a antiga fica de reserva pra quem
  // ainda não abriu a página de binders, que é quem faz a migração).
  function lerBinders() {
    try {
      const data = JSON.parse(localStorage.getItem("tcg-collector-binders-all-v1") || localStorage.getItem("tcg-collector-binders-v1") || "null");
      const deleted = (data && data.deleted) || {};
      return (data && Array.isArray(data.binders) ? data.binders : []).filter((b) => b && !deleted[b.id]);
    } catch (error) { return []; }
  }

  // Valor de um binder em duas metades, que respondem perguntas diferentes:
  //   `tem`    = o que as cartas que você JÁ tem naquele binder valem;
  //   `falta`  = quanto custa comprar os slots vazios (o "custo pra completar",
  //              que no TCG Collector é recurso pago).
  // `semPreco` conta as cartas que ficaram de fora por não ter cotação — é o que
  // faz a soma virar um piso "≥" na tela em vez de fingir precisão.
  function valorDoBinder(binder, gf) {
    let tem = 0, falta = 0, nTem = 0, nFalta = 0, semPreco = 0;
    (binder.slots || []).forEach((slot) => {
      if (!slot || !slot.cardId) return;
      if (gf && gf !== "all" && gameOf(slot.cardId) !== gf) return;
      const card = cardsById.get(slot.cardId) || { id: slot.cardId };
      const v = shared.cardValue(card, slot.variant || "Normal", prices).value || 0;
      if (owned.has(slot.cardId)) { tem += v; nTem++; } else { falta += v; nFalta++; }
      if (!v) semPreco++;
    });
    return { tem, falta, nTem, nFalta, semPreco, slots: nTem + nFalta };
  }

  // "Desejos do binder": só a metade que FALTA, somada. Mesma função do painel
  // de binders — uma conta só, pra os dois números não divergirem.
  function binderWishTotal(gf) {
    return lerBinders().reduce((s, b) => s + valorDoBinder(b, gf).falta, 0);
  }

  // Valor de uma lista: cada entrada é carta×variante×condição×quantidade, os
  // mesmos quatro eixos da Coleção — então a conta é a MESMA (shared.cardValue).
  function valorDaLista(lista, gf) {
    let total = 0, itens = 0, semPreco = 0;
    (lista.entries || []).forEach((e) => {
      if (!e || !e.id) return;
      if (gf && gf !== "all" && gameOf(e.id) !== gf) return;
      const card = cardsById.get(e.id) || { id: e.id };
      const q = e.q == null ? 1 : Math.max(1, Number(e.q) || 1);
      const variante = e.v || shared.defaultVariant(card);
      const v = shared.cardValue(card, variante, prices, e.c || undefined).value || 0;
      itens += q;
      if (v > 0) total += v * q; else semPreco += q;
    });
    return { total, itens, semPreco };
  }

  // ---- Render ---------------------------------------------------------------

  function render() {
    limpaMemo(); // ver collectionLines: um render inteiro reusa as mesmas contas
    const { lines, totalCopies, pricedCopies, total: rawTotal } = collectionLines(gameFilter);
    const slabs = gradedSlabs(gameFilter);
    const gradedTotal = slabs.reduce((sum, s) => sum + (s.value || 0), 0);
    const networth = rawTotal + gradedTotal;
    // Desejos vinham somados num número só e ninguém sabia o que era o quê —
    // "R$ 890" pode ser wishlist inteira ou buraco de binder, e as duas coisas
    // levam a ações diferentes. Agora o card mostra a soma e abre embaixo.
    const wishOnly = wishlistTotal(gameFilter);
    const binderGap = binderWishTotal(gameFilter);
    const wish = wishOnly + binderGap;

    // Números frescos: substituem o retrato instantâneo e tiram o esmaecido.
    SNAP_ELS.forEach((k) => { if (elements[k]) elements[k].style.opacity = ""; });
    if (elements.grandTotal) pintaPatrimonio(networth);
    if (elements.rawValue) elements.rawValue.textContent = money(rawTotal);
    if (elements.gradedValue) elements.gradedValue.textContent = money(gradedTotal);
    if (elements.pricedCopies) elements.pricedCopies.textContent = `${pricedCopies}/${totalCopies}`;
    if (elements.wishlistValue) elements.wishlistValue.textContent = money(wish);
    // A abertura só aparece quando as duas metades existem — com uma só, repetir
    // o mesmo número embaixo do card não informa nada.
    const wishSplit = document.getElementById("wishlistSplit");
    if (wishSplit) {
      const mostra = wishOnly > 0 && binderGap > 0;
      wishSplit.hidden = !mostra;
      wishSplit.textContent = mostra
        ? `${t("portfolio.wish.list")} ${money(wishOnly)} · ${t("portfolio.wish.binder")} ${money(binderGap)}`
        : "";
    }
    // Total investido: mesma soma da seção "Investimento" lá embaixo (uma
    // fórmula só). Sem nenhum custo preenchido fica "—" em vez de "R$ 0,00":
    // zero investido e "não registrei custo" são coisas diferentes.
    if (elements.investedValue) {
      const { invested } = investPositions();
      elements.investedValue.textContent = invested > 0 ? money(invested) : "—";
    }

    renderComposition(rawTotal, gradedTotal);
    renderBreakdown(lines, slabs);
    renderListas();
    renderManual();
    renderInvest();
    renderVendas();
    renderMovers();
    renderTop(lines, slabs);
    updateChart();
  }

  // O patrimônio ASSENTA no valor fresco em vez de trocar seco: anima do
  // retrato instantâneo (que o usuário já estava vendo) até o número novo, uma
  // vez por carga. Iguais, sem retrato ou com prefers-reduced-motion: troca
  // direta — a animação é tempero, nunca requisito.
  let patrimonioAssentou = false;
  const podeAnimar = !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  function pintaPatrimonio(alvo) {
    const el = elements.grandTotal;
    const de = patrimonioAssentou ? null : snapStart;
    patrimonioAssentou = true; // trocas de filtro pintam direto: não é o mercado se mexendo
    if (de == null || !podeAnimar || Math.abs(alvo - de) < 0.01) { el.textContent = money(alvo); return; }
    const t0 = performance.now(), dur = 600;
    const passo = (agora) => {
      const p = Math.min(1, (agora - t0) / dur);
      el.textContent = money(de + (alvo - de) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }

  // Variação do DIA no cartão do patrimônio — o gancho diário da corretora
  // (valor grande + quanto mexeu hoje, o padrão que o Collectr consagrou).
  // Calculada dos MESMOS pontos do gráfico (chartHistory), nunca por um segundo
  // caminho — ver o aviso das cápsulas removidas, mais abaixo. O rótulo só diz
  // "hoje" quando o ponto anterior é de ontem; visita mais espaçada mostra a
  // data ("variação desde …") — o número não finge ser mais fresco do que é.
  function pintaDeltaDoDia(pts) {
    const el = document.getElementById("grandDelta");
    if (!el) return;
    const hoje = pts[pts.length - 1];
    const antes = pts[pts.length - 2];
    const v0 = antes ? (antes.c || 0) + (antes.b || 0) : 0;
    if (!antes || !(v0 > 0)) { el.hidden = true; el.innerHTML = ""; return; }
    const delta = ((hoje.c || 0) + (hoje.b || 0)) - v0;
    const pct = (delta / v0) * 100;
    const dir = delta > 0.005 ? "up" : (delta < -0.005 ? "down" : "flat");
    const seta = dir === "up" ? "▲" : (dir === "down" ? "▼" : "→");
    const sinal = dir === "up" ? "+" : (dir === "down" ? "−" : "");
    const pctTxt = Math.abs(pct).toLocaleString(getLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const ontem = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const quando = antes.d >= ontem ? t("portfolio.deltaToday") : t("market.deltaSince", { date: antes.d });
    // Dinheiro no .pf-cash próprio (o modo privacidade borra SÓ ele e preserva
    // a porcentagem), como no cabeçalho do gráfico. O histórico é gravado em
    // BRL — converte pra moeda do header como o renderChart faz (fromBRL).
    el.innerHTML = `${seta} <span class="pf-cash">${escapeHtml(sinal + money(Math.abs(fromBRL(delta))))}</span> <span class="pf-pct">(${escapeHtml(sinal + pctTxt + "%")})</span> <span class="pf-grand-when">${escapeHtml(quando)}</span>`;
    el.className = "pf-grand-delta is-" + dir;
    el.hidden = false;
  }

  // Maiores altas e quedas entre o snapshot anterior e o de hoje (builds
  // diários — o "desde {data}" do título diz a janela real), em DUAS abas:
  //   "Minhas"  — só cartas suas, ordenadas pelo IMPACTO no seu bolso
  //               (variação × quantidade que você tem), não pelo % puro. Uma
  //               carta de R$ 2 que subiu 80% mexe menos no seu patrimônio que
  //               uma de R$ 900 que subiu 5%, e é essa a pergunta aqui.
  //   "Mercado" — a visão de sempre (o que se moveu no mercado, tenha você ou não).
  // Dragon Shield, Delta e CoinStats convergem no mesmo ponto: o mover que
  // importa é o SEU. Por isso "Minhas" é a aba padrão quando você tem alguma.
  let moversTab = "mine";
  function renderMovers() {
    const sec = document.getElementById("pfMovers");
    if (!sec) return;
    const pool = gameFilter === "all" ? GAMES : [gameFilter];
    let up = [], down = [], from = null;
    pool.forEach((g) => {
      const m = moversByGame[g];
      if (!m) return;
      if (m.from) from = from || m.from;
      up = up.concat(m.up || []); down = down.concat(m.down || []);
    });
    // Quantas cópias você tem da carta (todas as variantes) — o peso do impacto.
    const copias = (card) => shared.cardVariants(card).reduce((n, v) => n + owned.variantTotal(card.id, v), 0);
    const resolve = (arr, minhas) => {
      const linhas = arr
        .map((x) => ({ x, card: cardsById.get(x.id) }))
        .filter((r) => r.card && (!minhas || owned.has(r.card.id)));
      if (!minhas) return linhas.sort((a, b) => Math.abs(b.x.pct) - Math.abs(a.x.pct)).slice(0, 8);
      // Impacto em dinheiro: o valor de hoje × a variação × as cópias. O valor
      // atual já embute o preço da carta, então isto é "quanto do seu patrimônio
      // essa carta moveu no período".
      linhas.forEach((r) => {
        const v = shared.cardValue(r.card, shared.defaultVariant(r.card), prices).value || 0;
        r.qtd = copias(r.card);
        r.impacto = v * r.qtd * (r.x.pct / 100);
      });
      return linhas.sort((a, b) => Math.abs(b.impacto) - Math.abs(a.impacto)).slice(0, 8);
    };
    const temMinhas = up.concat(down).some((x) => { const c = cardsById.get(x.id); return c && owned.has(c.id); });
    if (moversTab === "mine" && !temMinhas) moversTab = "market";
    const minhas = moversTab === "mine";
    const ups = resolve(up, minhas), downs = resolve(down, minhas);
    if (!ups.length && !downs.length && !temMinhas) { sec.hidden = true; sec.innerHTML = ""; return; }
    const loc = getLocale();
    const row = ({ x, card, impacto, qtd }) => {
      const src = shared.cardImageSources(card);
      const thumb = shared.localizedImg(src.url, { alt: "", fallback: src.fallback, loading: "lazy", thumb: true });
      // Na aba "Minhas" o selo vira a QUANTIDADE (×3) — "você tem" já é dado.
      const tag = minhas
        ? (qtd > 1 ? `<span class="pf-mover-owned">×${qtd}</span>` : "")
        : (owned.has(card.id) ? `<span class="pf-mover-owned">${escapeHtml(t("portfolio.movers.owned"))}</span>` : "");
      const pct = `${x.pct > 0 ? "+" : "−"}${Math.abs(x.pct).toLocaleString(loc, { maximumFractionDigits: 1 })}%`;
      // Na aba "Minhas", o que a variação fez com o SEU dinheiro, embaixo do %.
      const emReais = minhas && Math.abs(impacto || 0) >= 0.01
        ? `<span class="pf-mover-cash sensitive-value">${impacto > 0 ? "+" : "−"}${escapeHtml(money(Math.abs(impacto)))}</span>` : "";
      return `<a class="pf-mover" href="${escapeAttribute(detailUrl("set", card.set, "", card.game, { card: card.id, setId: card.setId }))}">
        <span class="pf-mover-thumb">${thumb}</span>
        <span class="pf-mover-info"><strong>${escapeHtml(card.name)}</strong><span>${escapeHtml(card.set)} · ${escapeHtml(card.number)}</span>${tag}</span>
        <span class="pf-mover-pct ${x.pct > 0 ? "is-up" : "is-down"}">${x.pct > 0 ? "▲" : "▼"} ${escapeHtml(pct)}${emReais}</span>
      </a>`;
    };
    const col = (title, arr) => arr.length ? `<div class="pf-movers-col"><h3>${escapeHtml(title)}</h3>${arr.map(row).join("")}</div>` : "";
    const aba = (k, rotulo, ativa) =>
      `<button type="button" class="pf-bd-tab${ativa ? " active" : ""}" data-movers-tab="${k}">${escapeHtml(rotulo)}</button>`;
    const abas = temMinhas
      ? `<div class="pf-bd-tabs pf-movers-tabs">${aba("mine", t("portfolio.movers.mine"), minhas)}${aba("market", t("portfolio.movers.market"), !minhas)}</div>`
      : "";
    const vazio = !ups.length && !downs.length
      ? `<p class="pf-bd-empty">${escapeHtml(t("portfolio.movers.noneMine"))}</p>` : "";
    sec.innerHTML = `<h2 class="pf-invest-title">${escapeHtml(t("portfolio.movers.title"))}${from ? ` <span class="pf-movers-since">${escapeHtml(t("market.deltaSince", { date: from }))}</span>` : ""}</h2>
      ${abas}${vazio}
      <div class="pf-movers-grid">${col(t("portfolio.movers.up"), ups)}${col(t("portfolio.movers.down"), downs)}</div>`;
    sec.hidden = false;
  }

  // --- Investimento (opcional): só aparece pra quem preenche custo ou vende ---
  // Posições = cartas COM custo que você ainda tem: pago (unitário × qtd) vs
  // valor atual, com lucro/prejuízo não realizado. Vendas realizadas entram como
  // resultado REALIZADO (vendido − pago; só registros com custo contam no P&L).
  // Posições abertas (custo preenchido + carta ainda na coleção). Fica FORA do
  // renderInvest porque o resumo lá em cima também mostra o total investido:
  // duas somas separadas divergiriam mais cedo ou mais tarde — é a mesma razão
  // de o patrimônio ter uma fórmula só.
  function investPositions() {
    const inG = (id) => gameFilter === "all" || gameOf(id) === gameFilter;
    const positions = [];
    let invested = 0, currentTotal = 0;
    costsStore.entries().forEach((e) => {
      if (!inG(e.cardId)) return;
      const card = cardsById.get(e.cardId);
      const qty = owned.variantTotal(e.cardId, e.variant);
      if (!card || qty <= 0) return;
      const paidUnit = shared.moneyToCurrent(e.v, e.cur);
      let now = 0;
      owned.conditionBreakdown(e.cardId, e.variant).forEach(({ condition, quantity }) => {
        now += (shared.cardValue(card, e.variant, prices, condition).value || 0) * quantity;
      });
      const paid = paidUnit * qty;
      positions.push({ card, variant: e.variant, qty, paid, now, delta: now - paid });
      invested += paid; currentTotal += now;
    });
    return { positions, invested, currentTotal };
  }

  // Posições (o que você TEM, com lucro potencial) e Vendas (o que já virou
  // dinheiro, com resultado realizado) viraram duas seções. Misturar as duas num
  // bloco só é o que tornava a leitura confusa — e "potencial" × "realizado" é a
  // distinção que todo app de investimento separa (o Card Ladder chama a primeira
  // de "Potential Profit" justamente pra fugir de "não realizado").
  const sign = (v) => (v >= 0 ? "+" : "−");
  const cls = (v) => (v > 0.005 ? "is-up" : (v < -0.005 ? "is-down" : ""));
  const statCard = (label, value, extra, klass) =>
    `<article class="pf-insight ${klass || ""}"><span class="pf-insight-label">${escapeHtml(label)}</span>
      <span class="pf-insight-pct sensitive-value">${value}</span>${extra ? `<span class="pf-insight-abs">${extra}</span>` : ""}</article>`;

  function renderInvest() {
    const sec = document.getElementById("pfInvest");
    if (!sec) return;
    const { positions, invested, currentTotal } = investPositions();
    if (!positions.length) { sec.hidden = true; sec.innerHTML = ""; return; }

    const unreal = currentTotal - invested;
    const pct = invested > 0 ? (unreal / invested) * 100 : 0;
    let html = `<h2 class="pf-invest-title">${escapeHtml(t("portfolio.invest.title"))}</h2><div class="pf-insights">`;
    html += statCard(t("portfolio.invest.paid"), escapeHtml(money(invested)));
    html += statCard(t("portfolio.invest.now"), escapeHtml(money(currentTotal)));
    html += statCard(t("portfolio.invest.unreal"),
      `${sign(unreal)}${escapeHtml(money(Math.abs(unreal)))}`,
      `${sign(unreal)}${Math.abs(pct).toFixed(1)}%`, `pf-insight-${cls(unreal) === "is-up" ? "up" : cls(unreal) === "is-down" ? "down" : "flat"}`);
    html += `</div>`;
    {
      positions.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      const rows = positions.slice(0, 12).map((p) => {
        const dPct = p.paid > 0 ? (p.delta / p.paid) * 100 : 0;
        return `<tr>
          <td><a href="${escapeAttribute(detailUrl("set", p.card.set, "", p.card.game))}">${escapeHtml(`${p.card.name} · ${p.card.set} ${p.card.number}`)}</a></td>
          <td>${escapeHtml(p.variant)}</td>
          <td class="num">${p.qty}</td>
          <td class="num">${escapeHtml(money(p.paid))}</td>
          <td class="num">${escapeHtml(money(p.now))}</td>
          <td class="num pf-pnl ${cls(p.delta)}"><strong>${sign(p.delta)}${escapeHtml(money(Math.abs(p.delta)))}</strong> <span class="pf-pnl-pct">${sign(p.delta)}${Math.abs(dPct).toFixed(0)}%</span></td>
        </tr>`;
      }).join("");
      html += `<div class="portfolio-table-wrap"><table class="portfolio-table">
        <thead><tr>
          <th>${escapeHtml(t("portfolio.col.card"))}</th><th>${escapeHtml(t("portfolio.col.variant"))}</th>
          <th class="num">${escapeHtml(t("portfolio.col.qty"))}</th>
          <th class="num">${escapeHtml(t("portfolio.invest.col.paid"))}</th>
          <th class="num">${escapeHtml(t("portfolio.invest.col.now"))}</th>
          <th class="num">${escapeHtml(t("portfolio.invest.col.delta"))}</th>
        </tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    sec.innerHTML = html;
    sec.hidden = false;
  }

  // ---- Vendas (realizado) ----------------------------------------------------
  // O Sleevu tem o que o líder da categoria não tem: o Collectr (~4M usuários)
  // não registra venda realizada, e o PriceCharting só ganhou isso em mar/2026.
  // Estava enterrado no fim de um bloco compartilhado — agora é seção própria.
  function renderVendas() {
    const sec = document.getElementById("pfSales");
    if (!sec) return;
    const inG = (id) => gameFilter === "all" || gameOf(id) === gameFilter;
    const vendas = soldStore.list().filter((it) => inG(it.cardId));
    if (!vendas.length) { sec.hidden = true; sec.innerHTML = ""; return; }

    let bruto = 0, taxas = 0, realizado = 0, comCusto = 0, melhor = null;
    vendas.forEach((it) => {
      const v = shared.soldValues(it);
      bruto += v.price; taxas += v.fee;
      if (v.hasCost) {
        realizado += v.pnl; comCusto++;
        if (!melhor || v.pnl > melhor.pnl) melhor = { pnl: v.pnl, it };
      }
    });
    const liquido = bruto - taxas;
    // ROI sobre o que foi PAGO nas vendas com custo — só faz sentido nesse
    // subconjunto, que é o mesmo do resultado realizado.
    const pagoNasComCusto = vendas.reduce((s, it) => { const v = shared.soldValues(it); return s + (v.hasCost ? v.paid : 0); }, 0);
    const roi = pagoNasComCusto > 0 ? (realizado / pagoNasComCusto) * 100 : 0;

    let html = `<h2 class="pf-invest-title">${escapeHtml(t("portfolio.sales.title"))}</h2><div class="pf-insights">`;
    html += statCard(t("portfolio.sales.gross"), escapeHtml(money(bruto)), escapeHtml(tn("portfolio.invest.soldCount", vendas.length)));
    if (taxas > 0) html += statCard(t("portfolio.sales.fees"), `− ${escapeHtml(money(taxas))}`, escapeHtml(t("portfolio.sales.net", { v: money(liquido) })));
    if (comCusto) {
      html += statCard(t("portfolio.sales.realized"),
        `${sign(realizado)}${escapeHtml(money(Math.abs(realizado)))}`,
        escapeHtml(t("portfolio.sales.roi", { pct: `${sign(roi)}${Math.abs(roi).toFixed(0)}` })),
        `pf-insight-${realizado >= 0 ? "up" : "down"}`);
    }
    if (melhor) {
      const card = cardsById.get(melhor.it.cardId);
      html += statCard(t("portfolio.sales.best"), `+${escapeHtml(money(melhor.pnl))}`,
        escapeHtml(card ? card.name : ""), "pf-insight-up");
    }
    html += `</div>`;

    // COBERTURA: dizer quantas vendas entram no resultado, e dar o caminho pra
    // corrigir. É o padrão "flag-then-fix" (Quicken, CoinLedger): nunca chutar
    // um custo em silêncio, nunca deixar o usuário achar que o número cobre tudo.
    if (comCusto < vendas.length) {
      html += `<p class="pf-coverage">${escapeHtml(t("portfolio.sales.coverage", { n: comCusto, total: vendas.length }))}
        <a href="sales">${escapeHtml(t("portfolio.sales.fixCosts"))}</a></p>`;
    }
    html += renderVendasPorMes(vendas);
    sec.innerHTML = html;
    sec.hidden = false;
  }

  // Barras de venda por mês (12 meses) — responde "quanto eu vendi este ano?"
  // sem exportar CSV. Usa o LÍQUIDO, que é o que entrou de verdade.
  function renderVendasPorMes(vendas) {
    const agora = new Date();
    const meses = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
      meses.push({ chave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, d, v: 0 });
    }
    const porChave = new Map(meses.map((m) => [m.chave, m]));
    let noAno = 0;
    vendas.forEach((it) => {
      const chave = String(it.date || "").slice(0, 7);
      const alvo = porChave.get(chave);
      const v = shared.soldValues(it);
      if (alvo) alvo.v += v.net;
      if (String(it.date || "").slice(0, 4) === String(agora.getFullYear())) noAno += v.net;
    });
    if (!meses.some((m) => m.v > 0)) return "";
    const max = Math.max(...meses.map((m) => m.v));
    const loc = getLocale();
    const nomeMes = (d) => d.toLocaleDateString(loc, { month: "short" }).replace(".", "");
    // Barras em HTML (não SVG): são 12 blocos com rótulo, e o CSS já sabe
    // posicionar isso melhor do que coordenadas fixas num viewBox.
    const barras = meses.map((m) => {
      const alt = max > 0 ? Math.max(2, Math.round((m.v / max) * 100)) : 2;
      const titulo = `${nomeMes(m.d)} · ${money(m.v)}`;
      return `<span class="pf-mbar" title="${escapeAttribute(titulo)}">
        <span class="pf-mbar-fill" style="height:${alt}%"></span>
        <span class="pf-mbar-lbl">${escapeHtml(nomeMes(m.d))}</span></span>`;
    }).join("");
    return `<div class="pf-months">
        <div class="pf-months-head"><strong>${escapeHtml(t("portfolio.sales.byMonth"))}</strong>
          <span class="sensitive-value">${escapeHtml(t("portfolio.sales.thisYear", { v: money(noAno) }))}</span></div>
        <div class="pf-mbars">${barras}</div>
      </div>`;
  }

  // ---- Listas & Binders: quanto valem as suas VISÕES -------------------------
  // Continuam fora do patrimônio (o total tem que bater com a Coleção) — a seção
  // diz isso na própria tela, porque é a primeira pergunta de quem vê os números.
  // O "custo pra completar" de um binder é o recurso que o TCG Collector cobra
  // US$ 3,99/mês; aqui sai junto e ainda serve as listas de compra da Liga.
  function renderListas() {
    const sec = document.getElementById("pfLists");
    if (!sec) return;
    const linhas = [];
    listStore.list().forEach((l) => {
      const { total, itens, semPreco } = valorDaLista(l, gameFilter);
      if (!itens) return; // lista vazia, ou toda de outro jogo que o filtro cortou
      linhas.push({
        tipo: "lista", nome: l.name || t("lists.untitled"), cor: l.color || "var(--accent)",
        href: `lists.html#${encodeURIComponent(l.id)}`,
        meta: tn("portfolio.lists.cards", itens), total, semPreco
      });
    });
    lerBinders().forEach((b) => {
      const v = valorDoBinder(b, gameFilter);
      if (!v.slots) return;
      linhas.push({
        // `lists.untitled` e não `binders.new`: aquela vive no pacote i18n dos
        // binders, que esta página não carrega (o check.mjs pega isso).
        tipo: "binder", nome: b.name || t("lists.untitled"), cor: b.color || "#8b5cf6",
        href: `binders#${encodeURIComponent(b.id)}`,
        meta: t("portfolio.lists.slots", { tem: v.nTem, total: v.slots }),
        total: v.tem, semPreco: v.semPreco, completar: v.falta
      });
    });
    if (!linhas.length) { sec.hidden = true; sec.innerHTML = ""; return; }
    linhas.sort((a, b) => b.total - a.total);
    const corpo = linhas.map((r) => {
      // "≥" quando alguma carta ficou sem cotação: a soma é um PISO. Dizer isso é
      // mais útil que um número redondo que o usuário não consegue auditar.
      const piso = r.semPreco > 0
        ? `<span class="pf-list-floor" title="${escapeAttribute(tn("portfolio.lists.noPrice", r.semPreco))}">≥</span> ` : "";
      const completar = r.completar > 0
        ? `<span class="pf-list-gap">${escapeHtml(t("portfolio.lists.toComplete", { v: money(r.completar) }))}</span>` : "";
      return `<a class="pf-list-row" href="${escapeAttribute(r.href)}">
        <span class="pf-list-dot" style="background:${escapeAttribute(r.cor)}"></span>
        <span class="pf-list-name">${escapeHtml(r.nome)}</span>
        <span class="pf-list-meta">${escapeHtml(r.meta)}</span>
        ${completar}
        <span class="pf-list-val sensitive-value">${piso}${escapeHtml(money(r.total))}</span>
      </a>`;
    }).join("");
    sec.innerHTML = `<h2 class="pf-invest-title">${escapeHtml(t("portfolio.lists.title"))}</h2>
      <p class="pf-list-note">${escapeHtml(t("portfolio.lists.note"))}</p>
      <div class="pf-list-rows">${corpo}</div>`;
    sec.hidden = false;
  }

  // ── Selados e itens MANUAIS (F4 do PLANO-UX) ───────────────────────────────
  // Booster box, ETB, lata ou item fora do catálogo, com preço 100% manual.
  // FORA do patrimônio de propósito (a nota na tela diz): somar tocaria a
  // fórmula única "Portfólio = Coleção no centavo", decisão do Fernando.
  const manualStore = shared.createManualItemsStore();
  // Aceita "1.234,56" (pt) e "1234.56" (en): vírgula presente decide o papel
  // do ponto.
  const numDeTexto = (s) => {
    let x = String(s || "").trim();
    if (x.includes(",")) x = x.replace(/\./g, "").replace(",", ".");
    const v = parseFloat(x);
    return isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0;
  };
  function renderManual() {
    const sec = document.getElementById("pfManual");
    if (!sec) return;
    const todos = manualStore.list();
    const itens = gameFilter === "all" ? todos : todos.filter((x) => (x.g || "") === gameFilter);
    const linha = (x) => {
      const cor = GAME_COLOR[x.g] || "#8b93a7";
      const unit = shared.moneyToCurrent(x.v, x.cur);
      const total = unit * (Number(x.q) || 1);
      const jogo = x.g
        ? `<span class="pf-mi-game" style="--gc:${cor};--gc-fg:${shared.textOnColor(cor)}">${escapeHtml(shared.gameLabel(x.g))}</span>`
        : "";
      const pago = Number(x.c) > 0
        ? `<span class="pf-mi-cost sensitive-value">${escapeHtml(t("pfmi.paid", { v: money(shared.moneyToCurrent(x.c, x.ccur) * (Number(x.q) || 1)) }))}</span>`
        : "";
      return `<div class="pf-mi-row" data-mi-id="${escapeAttribute(x.id)}">
        <span class="pf-mi-name"><strong>${escapeHtml(x.n)}</strong>${jogo}${pago}</span>
        <span class="pf-mi-qty">×${Number(x.q) || 1}</span>
        <strong class="pf-mi-val sensitive-value">${escapeHtml(money(total))}</strong>
        <span class="pf-mi-actions">
          <button type="button" class="pf-mi-btn" data-mi-edit title="${escapeAttribute(t("pfmi.edit"))}" aria-label="${escapeAttribute(t("pfmi.edit"))}">✎</button>
          <button type="button" class="pf-mi-btn" data-mi-remove title="${escapeAttribute(t("pfmi.remove"))}" aria-label="${escapeAttribute(t("pfmi.remove"))}">×</button>
        </span>
      </div>`;
    };
    const totalGeral = itens.reduce((s, x) => s + shared.moneyToCurrent(x.v, x.cur) * (Number(x.q) || 1), 0);
    sec.innerHTML = `<h2 class="pf-invest-title pf-mi-head">${escapeHtml(t("pfmi.title"))}
        <button type="button" class="secondary pf-mi-add" data-mi-add>${escapeHtml(t("pfmi.add"))}</button></h2>
      ${itens.length
        ? `<div class="pf-mi-rows">${itens.map(linha).join("")}</div>
           <p class="pf-mi-total">${escapeHtml(t("pfmi.total"))} <strong class="sensitive-value">${escapeHtml(money(totalGeral))}</strong></p>`
        : `<p class="pf-bd-empty">${escapeHtml(t("pfmi.empty"))}</p>`}
      <p class="pf-mi-note">${escapeHtml(t("pfmi.note"))}</p>`;
  }
  function abreManualModal(id) {
    const it = id ? manualStore.get(id) : null;
    const old = document.querySelector(".pfmi-modal");
    if (old) old.remove();
    const wrap = document.createElement("div");
    wrap.className = "ts-modal pfmi-modal";
    const fmtNum = (v) => (Number(v) > 0 ? String(Math.round(Number(v) * 100) / 100).replace(".", ",") : "");
    const opcoes = ['<option value="">—</option>']
      .concat(GAMES.map((g) => `<option value="${g}"${it && it.g === g ? " selected" : ""}>${escapeHtml(shared.gameLabel(g))}</option>`)).join("");
    const cur = shared.getCurrency();
    wrap.innerHTML = `<div class="ts-backdrop" data-pfmi-close></div>
      <div class="ts-panel">
        <h3>${escapeHtml(t(it ? "pfmi.edit" : "pfmi.add2"))}</h3>
        <div class="pf-mi-form">
          <label>${escapeHtml(t("pfmi.name"))}<input type="text" id="pfmiName" maxlength="80" value="${escapeAttribute(it ? it.n : "")}"></label>
          <label>${escapeHtml(t("pfmi.game"))}<select id="pfmiGame">${opcoes}</select></label>
          <label>${escapeHtml(t("pfmi.qty"))}<input type="number" id="pfmiQty" min="1" step="1" value="${it ? Number(it.q) || 1 : 1}"></label>
          <label>${escapeHtml(t("pfmi.value", { cur }))}<input type="text" inputmode="decimal" id="pfmiVal" value="${escapeAttribute(it ? fmtNum(shared.moneyToCurrent(it.v, it.cur)) : "")}"></label>
          <label>${escapeHtml(t("pfmi.cost", { cur }))}<input type="text" inputmode="decimal" id="pfmiCost" value="${escapeAttribute(it && Number(it.c) > 0 ? fmtNum(shared.moneyToCurrent(it.c, it.ccur)) : "")}"></label>
        </div>
        <div class="ts-actions">
          <button type="button" class="secondary" data-pfmi-close>${escapeHtml(t("pfmi.cancel"))}</button>
          <button type="button" class="primary" data-pfmi-save>${escapeHtml(t("pfmi.save"))}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", (e) => {
      if (e.target.closest("[data-pfmi-close]")) { wrap.remove(); return; }
      if (!e.target.closest("[data-pfmi-save]")) return;
      const nome = (document.getElementById("pfmiName").value || "").trim();
      const valor = numDeTexto(document.getElementById("pfmiVal").value);
      if (!nome || !(valor > 0)) return; // nome + valor são o mínimo de um item
      // Editar regrava na moeda ATUAL (o campo mostra o valor já convertido) —
      // mesmo contrato do custo pago por carta.
      const patch = {
        n: nome,
        g: document.getElementById("pfmiGame").value || "",
        q: Math.max(1, parseInt(document.getElementById("pfmiQty").value, 10) || 1),
        v: valor, cur,
        c: numDeTexto(document.getElementById("pfmiCost").value), ccur: cur
      };
      if (it && id) manualStore.update(id, patch);
      else manualStore.add(Object.assign({ t: Date.now() }, patch));
      wrap.remove();
      renderManual();
    });
  }
  (function bindManual() {
    const sec = document.getElementById("pfManual");
    if (!sec) return;
    sec.addEventListener("click", (e) => {
      if (e.target.closest("[data-mi-add]")) { abreManualModal(null); return; }
      const row = e.target.closest("[data-mi-id]");
      if (!row) return;
      if (e.target.closest("[data-mi-edit]")) { abreManualModal(row.dataset.miId); return; }
      if (e.target.closest("[data-mi-remove]")) {
        const item = manualStore.get(row.dataset.miId);
        if (!item) return;
        // Mesmo raciocínio do deck: apaga na hora e dá 6s pra voltar. O item
        // manual é digitado à mão, então perdê-lo por engano custa retrabalho —
        // e é justamente por isso que o desfazer serve melhor que o confirm.
        const undo = shared.snapshotKeys([manualStore.STORAGE_KEY]);
        manualStore.remove(row.dataset.miId);
        renderManual();
        shared.toastUndo(t("undo.manualRemoved"), undo);
      }
    });
    renderManual(); // independe do catálogo: aparece já no primeiro paint
  })();

  // Agrega valor (cartas raw + slabs graded) por uma chave da carta (set, raridade…).
  function breakdownBy(lines, slabs, keyFn) {
    const map = new Map();
    lines.forEach((l) => { const k = keyFn(l.card); if (!k) return; map.set(k, (map.get(k) || 0) + l.total); });
    slabs.forEach((s) => { const c = cardsById.get(s.cardId); if (!c || !(s.value > 0)) return; const k = keyFn(c); if (!k) return; map.set(k, (map.get(k) || 0) + s.value); });
    return Array.from(map.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }

  // Detalhamento: valor por set/artista (top 12) ou por raridade (todas). Barras
  // rankeadas. Visão sem dados (ex.: artista num jogo sem crédito de arte) mostra
  // uma nota em vez de sumir com a seção — senão as abas desapareceriam juntas.
  function renderBreakdown(lines, slabs) {
    const sec = elements.breakdown;
    if (!sec) return;
    if (breakdownMode === "wish") { renderWishBreakdown(); return; }
    const rows = breakdownMode === "rarity" ? breakdownBy(lines, slabs, (c) => c.rarity)
      : breakdownMode === "artist" ? breakdownBy(lines, slabs, (c) => c.artist)
      : breakdownBy(lines, slabs, (c) => c.set);
    const shown = breakdownMode === "rarity" ? rows : rows.slice(0, 12);
    if (!shown.length) {
      if (breakdownMode === "set") { sec.hidden = true; return; } // sem dado nenhum
      elements.breakdownBody.innerHTML = `<p class="pf-bd-empty">${escapeHtml(t("portfolio.bd.none"))}</p>`;
      sec.hidden = false;
      return;
    }
    const max = Math.max(1, ...shown.map((r) => r.value));
    // No modo SET a linha vira link pra Coleção já filtrada naquele set (e no
    // jogo do filtro atual): "meus R$ 800 em Destined Rivals" leva às cartas
    // que somam esse valor, em vez de ser um número sem saída. Raridade e
    // artista não têm filtro equivalente na Coleção, então seguem estáticos.
    elements.breakdownBody.innerHTML = shown.map((r) => {
      const miolo = `<span class="pf-comp-label pf-bd-name" title="${escapeAttribute(r.label)}">${escapeHtml(r.label)}</span>
        <span class="pf-comp-track"><span class="pf-comp-fill" style="width:${Math.round((r.value / max) * 100)}%;background:var(--accent)"></span></span>
        <span class="pf-comp-val">${escapeHtml(money(r.value))}</span>`;
      if (breakdownMode !== "set") return `<div class="pf-comp-row">${miolo}</div>`;
      const params = new URLSearchParams({ set: r.label });
      if (gameFilter && gameFilter !== "all") params.set("filter", gameFilter);
      return `<a class="pf-comp-row pf-comp-row-link" href="collection?${params.toString()}"
        title="${escapeAttribute(t("portfolio.bd.openSet", { set: r.label }))}">${miolo}</a>`;
    }).join("");
    sec.hidden = false;
  }

  // Desejos, carta a carta: o que você quer, quanto custa hoje e — quando você
  // anotou um preço-alvo na Wishlist — o quanto falta o mercado cair pra chegar
  // lá. O cartão lá em cima dá o total; esta aba responde "de onde ele vem".
  // Ordenado pelo mais caro, que é onde a decisão de compra costuma travar.
  function renderWishBreakdown() {
    const sec = elements.breakdown;
    const linhas = [];
    cards.forEach((card) => {
      if (gameFilter !== "all" && card.game !== gameFilter) return;
      wishlist.variants(card.id).forEach((variante) => {
        const valor = shared.cardValue(card, variante, prices).value || 0;
        const alvo = wishTargets.get(card.id);
        linhas.push({ card, variante, valor, alvo: alvo ? shared.convertMoney(alvo.v, alvo.cur || "BRL", shared.getCurrency()) : null });
      });
    });
    if (!linhas.length) {
      elements.breakdownBody.innerHTML = `<p class="pf-bd-empty">${escapeHtml(t("portfolio.bd.wishNone"))}</p>`;
      sec.hidden = false;
      return;
    }
    linhas.sort((a, b) => b.valor - a.valor);
    elements.breakdownBody.innerHTML = linhas.slice(0, 30).map((r) => {
      // Alvo já batido = oportunidade agora; senão mostra a distância que falta.
      let alvoHtml = "";
      if (r.alvo != null && r.alvo > 0) {
        const bateu = r.valor > 0 && r.valor <= r.alvo;
        const falta = r.valor > 0 ? ((r.valor - r.alvo) / r.valor) * 100 : 0;
        alvoHtml = bateu
          ? `<span class="pf-wish-hit">${escapeHtml(t("portfolio.bd.wishHit", { v: money(r.alvo) }))}</span>`
          : `<span class="pf-wish-target">${escapeHtml(t("portfolio.bd.wishTarget", { v: money(r.alvo), pct: Math.round(falta) }))}</span>`;
      }
      const url = detailUrl("set", r.card.set, "", r.card.game, { card: r.card.id, setId: r.card.setId });
      return `<a class="pf-comp-row pf-comp-row-link" href="${escapeAttribute(url)}">
        <span class="pf-comp-label pf-bd-name" title="${escapeAttribute(r.card.name)}">${escapeHtml(r.card.name)}</span>
        <span class="pf-wish-meta">${escapeHtml(r.card.set)} · ${escapeHtml(r.variante)}${alvoHtml ? " · " : ""}${alvoHtml}</span>
        <span class="pf-comp-val">${escapeHtml(r.valor > 0 ? money(r.valor) : "—")}</span>
      </a>`;
    }).join("");
    sec.hidden = false;
  }

  // Composição: cartas (raw) × graded; e por jogo (só no filtro "Todos").
  function renderComposition(rawTotal, gradedTotal) {
    const sec = elements.composition;
    if (!sec) return;
    // `game` na linha: a barra vira BOTÃO que aplica o filtro daquele jogo — a
    // pergunta seguinte a "quanto é Magic?" é sempre "me mostra o Magic", e a
    // barra era inerte. Sem jogo (a divisão cartas × graded), segue estática.
    const bars = (title, rows) => {
      const max = Math.max(1, ...rows.map((r) => r.value));
      const body = rows.filter((r) => r.value > 0).map((r) => {
        const miolo = `<span class="pf-comp-label">${escapeHtml(r.label)}</span>
          <span class="pf-comp-track"><span class="pf-comp-fill" style="width:${Math.round((r.value / max) * 100)}%;background:${r.color}"></span></span>
          <span class="pf-comp-val">${escapeHtml(money(r.value))}</span>`;
        return r.game
          ? `<button type="button" class="pf-comp-row pf-comp-row-btn" data-comp-game="${escapeAttribute(r.game)}"
              title="${escapeAttribute(t("portfolio.comp.filterHint", { game: r.label }))}">${miolo}</button>`
          : `<div class="pf-comp-row">${miolo}</div>`;
      }).join("");
      return body ? `<div class="pf-comp-block"><h3>${escapeHtml(title)}</h3>${body}</div>` : "";
    };
    let html = bars(t("portfolio.comp.type"), [
      { label: t("portfolio.rawValue"), value: rawTotal, color: "#2dd4bf" },
      { label: t("portfolio.gradedValue"), value: gradedTotal, color: "#e8c46a" }
    ]);
    if (gameFilter === "all") {
      const byGame = GAMES.map((g) => ({
        label: shared.gameLabel(g),
        color: GAME_COLOR[g],
        game: g,
        value: collectionLines(g).total + gradedSlabs(g).reduce((s, x) => s + (x.value || 0), 0)
      }));
      if (byGame.filter((r) => r.value > 0).length > 1) html += bars(t("portfolio.comp.game"), byGame);
    }
    sec.innerHTML = html;
    sec.hidden = !html;
  }

  // Mais valiosas: raw + graded juntos, por valor do lote/slab (top 15).
  function renderTop(lines, slabs) {
    const rows = lines.map((line) => ({
      name: `${line.card.name} · ${line.card.set} ${line.card.number}`,
      href: detailUrl("set", line.card.set, "", line.card.game),
      kind: line.variant,
      cond: line.condition,
      estTitle: line.source === "ref" ? t("portfolio.estRef") : line.source === "myp" ? t("portfolio.estMyp") : t("portfolio.estimated"),
      estimated: line.estimated,
      qty: line.quantity, unit: line.unit, total: line.total
    }));
    slabs.forEach((s) => {
      const card = cardsById.get(s.cardId);
      if (!card || !(s.value > 0)) return;
      rows.push({
        name: `${card.name} · ${card.set} ${card.number}`,
        href: detailUrl("set", card.set, "", card.game, { card: card.id, setId: card.setId }),
        kind: `${String(s.company || "").toUpperCase()} ${shared.gradedGradeText(s.grade, s.pristine)}`,
        cond: t("nav.graded"), graded: true,
        estimated: false, qty: 1, unit: s.value, total: s.value
      });
    });
    rows.sort((a, b) => b.total - a.total);
    const top = topShowAll ? rows : rows.slice(0, 15);

    elements.empty.hidden = top.length > 0;
    if (!top.length) { elements.topCards.innerHTML = ""; return; }

    const body = top.map((r) => {
      const unit = `${money(r.unit)}${r.estimated ? ` <span class="price-estimated" title="${escapeAttribute(r.estTitle)}">≈</span>` : ""}`;
      const kind = r.graded ? `<span class="pf-graded-tag">${escapeHtml(r.kind)}</span>` : escapeHtml(r.kind);
      return `<tr>
        <td><a href="${escapeAttribute(r.href)}">${escapeHtml(r.name)}</a></td>
        <td>${kind}</td>
        <td>${escapeHtml(r.cond)}</td>
        <td class="num">${r.qty}</td>
        <td class="num">${unit}</td>
        <td class="num"><strong>${money(r.total)}</strong></td>
      </tr>`;
    }).join("");

    const toggle = rows.length > 15
      ? `<div class="pf-top-more"><button type="button" class="secondary" data-pf-top-toggle>${escapeHtml(topShowAll ? t("portfolio.topLess") : t("portfolio.topAll", { n: rows.length }))}</button></div>`
      : "";
    elements.topCards.innerHTML = `
      <table class="portfolio-table">
        <thead>
          <tr>
            <th>${escapeHtml(t("portfolio.col.card"))}</th>
            <th>${escapeHtml(t("portfolio.col.variant"))}</th>
            <th>${escapeHtml(t("portfolio.col.condition"))}</th>
            <th class="num">${escapeHtml(t("portfolio.col.qty"))}</th>
            <th class="num">${escapeHtml(t("portfolio.col.unit"))}</th>
            <th class="num">${escapeHtml(t("portfolio.col.total"))}</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>${toggle}`;
  }

  // ---------------------------------------------------------------------------
  // Progressão — snapshot diário POR JOGO (em BRL), pro gráfico local somar/filtrar
  // e pros cookies do hub ficarem corretos por jogo. Esquema do ponto: {d, c, b, w}
  // = raw, graded, desejos (em BRL). combined = c+b = patrimônio do jogo.
  // ---------------------------------------------------------------------------
  const SERIES = {
    combined: { color: "#34d399", get: (p) => (p.c || 0) + (p.b || 0) },
    collection: { color: "#2dd4bf", get: (p) => p.c || 0 },
    graded: { color: "#e8c46a", get: (p) => p.b || 0 },
    wishlist: { color: "#f5a524", get: (p) => p.w || 0 }
  };
  const SERIES_ORDER = ["combined", "collection", "graded", "wishlist"];
  // "1D" saiu: o ponto é DIÁRIO, então um dia de faixa nunca tem os 2 pontos que
  // o gráfico exige pra desenhar — o botão só sabia mostrar "o histórico começa
  // hoje". No lugar entrou "1A", que faltava entre 6M e MÁX.
  const RANGES = [["7d", 7], ["1m", 30], ["3m", 90], ["6m", 180], ["1a", 365], ["max", 1e9]];
  let activeSeries = new Set(["combined"]);
  let activeRange = "1m";
  let controlsBound = false;
  // Modo do gráfico: "series" (patrimônio/cartas/graded/desejos) ou "games" (uma
  // LINHA POR JOGO). Nenhum concorrente tem o segundo — e o dado já estava aqui,
  // porque o histórico sempre foi gravado por jogo. `pctMode` normaliza cada
  // linha a 100 no início da faixa: sem isso um jogo grande achata os pequenos e
  // o gráfico só conta quem é maior, não quem está subindo.
  const MODE_KEY = "tcg-pf-chart-mode", PCT_KEY = "tcg-pf-chart-pct";
  const lePref = (k, def) => { try { return localStorage.getItem(k) || def; } catch (e) { return def; } };
  const gravaPref = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignora */ } };
  const BENCH_KEY = "tcg-pf-chart-bench";
  let chartMode = lePref(MODE_KEY, "series") === "games" ? "games" : "series";
  let pctMode = lePref(PCT_KEY, "off") === "on";
  let benchOn = lePref(BENCH_KEY, "on") === "on"; // nasce ligado: é o contexto
  let activeGames = null; // Set de jogos ligados; null = ainda não inicializado

  const fromBRL = (v) => { const r = shared.convertMoney(v, "BRL", shared.getCurrency()); return r == null ? v : r; };
  // O histórico (leitura, gravação, migração do v1 e o cookie do hub) vive no
  // shared: o Hub e a Coleção também gravam o ponto do dia, então quem nunca
  // abre esta tela não fica mais com buracos no gráfico.
  const loadHist = (g) => shared.valueHistory(g);
  const jogosComHistorico = () => GAMES.filter((g) => loadHist(g).length > 0);

  // Linha do tempo unificada de um conjunto de jogos: a UNIÃO das datas, com o
  // último ponto conhecido de cada jogo CARREGADO PRA FRENTE.
  //
  // O "carregar pra frente" conserta um erro silencioso do somatório antigo, que
  // agrupava os pontos por data e somava só quem tinha ponto naquele dia: se o
  // Pokémon registrou na terça e o Lorcana não, a terça saía valendo só o
  // Pokémon — e a linha do patrimônio DESPENCAVA num dia em que nada aconteceu.
  // Não ter medido não é valer zero: é continuar valendo o que valia.
  // ANTES do primeiro ponto de um jogo o valor é `null`, não zero. São coisas
  // diferentes: zero é "não tenho nada", null é "ainda não media isso". Quem
  // começou a acompanhar Lorcana um mês depois do Pokémon não teve a coleção
  // valendo zero naquele mês — e desenhar a linha no chão inventaria uma alta
  // gigante no dia em que ela começou a ser medida.
  function serieUnificada(games) {
    const datas = [...new Set(games.flatMap((g) => loadHist(g).map((p) => p.d)))].sort();
    const cursor = Object.fromEntries(games.map((g) => [g, 0]));
    const ultimo = Object.fromEntries(games.map((g) => [g, null]));
    return datas.map((d) => {
      const porJogo = {};
      games.forEach((g) => {
        const h = loadHist(g);
        while (cursor[g] < h.length && h[cursor[g]].d <= d) { ultimo[g] = h[cursor[g]]; cursor[g]++; }
        porJogo[g] = ultimo[g];
      });
      return { d, porJogo };
    });
  }

  // Pontos do gráfico no formato {d, c, b, w} (soma dos jogos do filtro) + o
  // detalhe por jogo pendurado, que o modo "por jogo" usa. No SOMATÓRIO o jogo
  // ainda não medido entra como 0 — o patrimônio da época de fato não o incluía.
  function chartHistory() {
    const games = gameFilter === "all" ? jogosComHistorico() : [gameFilter];
    return serieUnificada(games).map(({ d, porJogo }) => {
      const p = { d, c: 0, b: 0, w: 0, porJogo };
      games.forEach((g) => {
        const q = porJogo[g];
        if (q) { p.c += q.c || 0; p.b += q.b || 0; p.w += q.w || 0; }
      });
      return p;
    });
  }

  function updateChart() {
    const section = document.getElementById("portfolioChart");
    if (!section) return;
    section.hidden = false;
    // Snapshot de CADA jogo (não só o filtrado) -> histórico do hub correto.
    // Esta é a única tela que sabe os DESEJOS (wishlist + faltantes de binder),
    // então é a única que manda o `w`.
    //
    // UMA VEZ por carga, não a cada render: os números não mudam quando você
    // troca o chip de jogo ou a aba do detalhamento, e gravar de novo custava 13
    // varreduras da coleção + escrita no localStorage (que ainda acorda o sync)
    // em todo clique. Se chegarem cartas novas (listas, binders, movers), o
    // indexaCartas libera outro registro.
    if (!snapshotGravado && !cargaParcial) {
      snapshotGravado = true;
      shared.recordValueSnapshot(Object.fromEntries(GAMES.map((g) => {
        const linhas = collectionLines(g);
        return [g, {
          raw: linhas.total,
          graded: gradedSlabs(g).reduce((s, x) => s + (x.value || 0), 0),
          wish: wishlistTotal(g) + binderWishTotal(g),
          // Cobertura da avaliação (cópias precificadas/total): é com ela que o
          // recordValueSnapshot separa "o mercado caiu" de "o preço não veio"
          // — ver a guarda de queda falsa no shared.js.
          priced: linhas.pricedCopies,
          copies: linhas.totalCopies
        }];
      })));
    }
    if (!controlsBound) { bindControls(); controlsBound = true; }
    renderControls();
    // Uma leitura só do histórico pro gráfico E pro chip do dia — o chip é
    // pintado aqui (não no render) porque o ponto de HOJE acabou de ser gravado
    // logo acima; pintá-lo antes compararia contra um histórico defasado.
    const pts = chartHistory();
    pintaDeltaDoDia(pts);
    renderChart(pts);
    if (pctMode) hidrataIndices(); // preferência já vinha ligada de outra visita
  }

  // As três cápsulas de variação (7d / 30d / desde o início) saíram daqui: o
  // cabeçalho do gráfico agora mostra a variação da FAIXA escolhida, e as faixas
  // já incluem 7D e 1M. Eram o mesmo número duas vezes na mesma tela — e, pior,
  // calculado por outro caminho, que é como dois números que deveriam bater
  // começam a divergir.

  // O modo "por jogo" só existe no filtro "Todos": com um jogo escolhido lá em
  // cima, a linha por jogo e a do patrimônio seriam a MESMA linha.
  const podeModoJogos = () => gameFilter === "all" && jogosComHistorico().length > 1;

  // Jogos ligados no modo "por jogo". Começa com todos os que têm histórico.
  function gamesAtivos() {
    const disponiveis = jogosComHistorico();
    if (!activeGames) activeGames = new Set(disponiveis);
    const vivos = disponiveis.filter((g) => activeGames.has(g));
    return vivos.length ? vivos : disponiveis;
  }

  function redesenha() { renderControls(); renderChart(chartHistory()); }

  function bindControls() {
    const seriesEl = document.getElementById("pfSeries");
    const rangeEl = document.getElementById("pfRanges");
    const modeEl = document.getElementById("pfChartModes");
    if (seriesEl) seriesEl.addEventListener("click", (e) => {
      const s = e.target.closest("[data-series]");
      if (s) {
        const k = s.dataset.series;
        if (activeSeries.has(k)) { if (activeSeries.size > 1) activeSeries.delete(k); } else activeSeries.add(k);
        redesenha(); return;
      }
      // "Todos os jogos": liga tudo; se já estava tudo ligado, é um jeito rápido
      // de voltar a UMA linha só (o 1º jogo) em vez de desligar 12 chips na mão.
      const todos = e.target.closest("[data-games-all]");
      if (todos) {
        const disponiveis = jogosComHistorico();
        const tudoLigado = disponiveis.every((g) => activeGames && activeGames.has(g));
        activeGames = new Set(tudoLigado ? disponiveis.slice(0, 1) : disponiveis);
        redesenha(); return;
      }
      const chip = e.target.closest("[data-game-series]");
      if (chip) {
        const g = chip.dataset.gameSeries;
        gamesAtivos(); // garante o Set inicializado
        if (activeGames.has(g)) { if (activeGames.size > 1) activeGames.delete(g); } else activeGames.add(g);
        redesenha();
      }
    });
    if (rangeEl) rangeEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-range]"); if (!b) return;
      activeRange = b.dataset.range;
      redesenha();
    });
    if (modeEl) modeEl.addEventListener("click", (e) => {
      const m = e.target.closest("[data-chart-mode]");
      if (m) { chartMode = m.dataset.chartMode; gravaPref(MODE_KEY, chartMode); redesenha(); return; }
      const p = e.target.closest("[data-chart-pct]");
      if (p) {
        pctMode = !pctMode;
        gravaPref(PCT_KEY, pctMode ? "on" : "off");
        redesenha();
        if (pctMode) hidrataIndices(); // o benchmark só existe aqui: busca sob demanda
        return;
      }
      const b = e.target.closest("[data-chart-bench]");
      if (b) { benchOn = !benchOn; gravaPref(BENCH_KEY, benchOn ? "on" : "off"); redesenha(); }
    });
  }

  function renderControls() {
    const seriesEl = document.getElementById("pfSeries");
    const rangeEl = document.getElementById("pfRanges");
    const modeEl = document.getElementById("pfChartModes");
    const emJogos = chartMode === "games" && podeModoJogos();
    if (seriesEl) {
      if (emJogos) {
        const disponiveis = jogosComHistorico();
        const ligados = new Set(gamesAtivos());
        const tudo = disponiveis.every((g) => ligados.has(g));
        seriesEl.innerHTML =
          `<button type="button" class="pf-series-chip pf-games-all${tudo ? " active" : ""}" data-games-all aria-pressed="${tudo}">
             <span class="pf-tick" aria-hidden="true">${tudo ? "☑" : "☐"}</span>${escapeHtml(t("portfolio.series.allGames"))}
           </button>`
          + disponiveis.map((g) =>
            `<button type="button" class="pf-series-chip${ligados.has(g) ? " active" : ""}" data-game-series="${escapeAttribute(g)}" style="--pf-color:${GAME_COLOR[g]}">
               <span class="pf-dot"></span>${escapeHtml(shared.gameLabel(g))}
             </button>`).join("");
      } else {
        seriesEl.innerHTML = SERIES_ORDER.map((k) =>
          `<button type="button" class="pf-series-chip${activeSeries.has(k) ? " active" : ""}" data-series="${k}" style="--pf-color:${SERIES[k].color}">
             <span class="pf-dot"></span>${escapeHtml(t(`portfolio.series.${k}`))}
           </button>`).join("");
      }
    }
    if (rangeEl) rangeEl.innerHTML = RANGES.map(([k]) =>
      `<button type="button" class="pf-range-btn${k === activeRange ? " active" : ""}" data-range="${k}">${escapeHtml(t(`portfolio.range.${k}`))}</button>`).join("");
    if (modeEl) {
      // Sem 2 jogos com histórico o seletor de modo não tem o que oferecer.
      modeEl.hidden = !podeModoJogos();
      modeEl.innerHTML = modeEl.hidden ? "" :
        `<button type="button" class="pf-mode-btn${emJogos ? "" : " active"}" data-chart-mode="series">${escapeHtml(t("portfolio.chart.modeSeries"))}</button>
         <button type="button" class="pf-mode-btn${emJogos ? " active" : ""}" data-chart-mode="games">${escapeHtml(t("portfolio.chart.modeGames"))}</button>
         <button type="button" class="pf-mode-btn pf-mode-pct${pctMode ? " active" : ""}" data-chart-pct aria-pressed="${pctMode}" title="${escapeAttribute(t("portfolio.chart.pctHint"))}">%</button>`
        // O benchmark só aparece com o % ligado — é lá que ele é comparável.
        + (pctMode ? `<button type="button" class="pf-mode-btn pf-mode-bench${benchOn ? " active" : ""}" data-chart-bench aria-pressed="${benchOn}" title="${escapeAttribute(t("portfolio.chart.marketHint"))}">${escapeHtml(t("portfolio.chart.market"))}</button>` : "");
    }
  }

  // Índice do mercado alinhado às datas do gráfico. O índice tem a régua de
  // datas DELE (os dias de build), então cada ponto do gráfico pega o último
  // valor do índice até aquela data — carregar pra frente é o tratamento certo
  // pra um índice: entre duas medições ele não "vale zero", vale a última.
  // Buraco no meio (build que falhou) também é carregado; buraco no COMEÇO fica
  // null e a linha só nasce quando o índice nasce.
  function serieDoMercado(pts) {
    const jogos = (gameFilter === "all" ? GAMES : [gameFilter]).filter((g) => indexByGame[g]);
    if (!jogos.length) return null;
    const serieDe = (g) => {
      const src = indexByGame[g];
      let cursor = 0, ultimo = null;
      return pts.map((p) => {
        while (cursor < src.d.length && src.d[cursor] <= p.d) {
          if (src.i[cursor] != null) ultimo = src.i[cursor];
          cursor++;
        }
        return ultimo;
      });
    };
    const series = jogos.map(serieDe);
    if (series.length === 1) return series[0];
    // Vários jogos: média simples dos índices disponíveis em cada data — cada
    // mercado pesa igual, senão o índice do jogo com mais cartas viraria "o
    // mercado" sozinho.
    return pts.map((_, i) => {
      const vs = series.map((s) => s[i]).filter((v) => v != null);
      return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
    });
  }

  // Escreve (ou apaga, sem argumento) o cabeçalho do gráfico. Fica fora do
  // renderChart porque o caminho "histórico curto demais" também precisa dele —
  // pra não deixar o número da faixa anterior pendurado sobre um gráfico vazio.
  function setChartHead(d) {
    const elValor = document.getElementById("pfChartValue");
    const elDelta = document.getElementById("pfChartDelta");
    const elQuando = document.getElementById("pfChartWhen");
    if (!elValor) return;
    elValor.textContent = d ? d.valor : "—";
    if (elDelta) {
      // O dinheiro vai num <span> próprio pro modo privacidade borrar SÓ ele: a
      // porcentagem continua legível, que é o ponto do modo (dá pra mostrar o
      // desempenho num print sem mostrar o patrimônio).
      elDelta.innerHTML = d
        ? `${escapeHtml(d.seta)} <span class="pf-cash">${escapeHtml(d.cash)}</span> <span class="pf-pct">(${escapeHtml(d.pct)})</span>`
        : "";
      elDelta.className = "pf-head-delta" + (d ? " is-" + d.dir : "");
    }
    if (elQuando) elQuando.textContent = d ? d.quando : "";
  }

  function renderChart(history) {
    const body = document.getElementById("pfChartBody");
    if (!body) return;
    const days = (RANGES.find((r) => r[0] === activeRange) || ["1m", 30])[1];
    const cutoff = Date.now() - days * 86400000;
    const pts = days >= 1e9 ? history.slice() : history.filter((p) => new Date(p.d + "T00:00:00").getTime() >= cutoff);
    if (pts.length < 2) {
      body.innerHTML = `<p class="pf-chart-empty">${escapeHtml(t("portfolio.chart.startsToday"))}</p>`;
      setChartHead(null);
      return;
    }
    // TRAÇOS: o gráfico não conhece mais "séries" nem "jogos", só uma lista de
    // linhas {chave, rótulo, cor, vals[]} sobre o mesmo eixo de datas. Foi o que
    // permitiu o modo por jogo caber sem um segundo renderizador.
    const emJogos = chartMode === "games" && podeModoJogos();
    const traces = emJogos
      ? gamesAtivos().map((g) => ({
          key: g, label: shared.gameLabel(g), color: GAME_COLOR[g],
          // null antes do 1º ponto do jogo (ver serieUnificada): a linha nasce
          // onde a medição nasceu, em vez de vir rastejando pelo chão.
          vals: pts.map((p) => {
            const q = p.porJogo && p.porJogo[g];
            return q ? fromBRL((q.c || 0) + (q.b || 0)) : null;
          })
        }))
      : SERIES_ORDER.filter((k) => activeSeries.has(k)).map((k) => ({
          key: k, label: t("portfolio.series." + k), color: SERIES[k].color,
          vals: pts.map((p) => fromBRL(SERIES[k].get(p)))
        }));
    // `from` = índice do 1º valor real do traço. Os nulos só aparecem no COMEÇO
    // (depois do 1º ponto o valor é sempre carregado pra frente), então guardar
    // um índice basta — não é preciso quebrar a linha em pedaços.
    traces.forEach((tr) => {
      tr.from = tr.vals.findIndex((v) => v != null);
      if (tr.from < 0) tr.from = tr.vals.length; // traço sem dado nenhum na faixa
    });
    // Traço sem nenhum ponto na faixa escolhida não vira linha invisível: sai.
    const vivos = traces.filter((tr) => tr.from < tr.vals.length);
    traces.length = 0; vivos.forEach((tr) => traces.push(tr));
    if (!traces.length) {
      body.innerHTML = `<p class="pf-chart-empty">${escapeHtml(t("portfolio.chart.startsToday"))}</p>`;
      setChartHead(null);
      return;
    }
    // Modo %: cada linha vira "quanto rendeu desde o início da faixa" (base 100).
    // Sem isso, comparar YGO (46 mil cartas) com HxH (38) é comparar o tamanho
    // das coleções, não o desempenho delas. A base é o 1º valor REAL do traço
    // (não o do eixo), senão um jogo que entrou depois normalizaria por zero.
    const money = (v) => shared.formatMoney(shared.getCurrency(), v);
    const loc = getLocale();
    const fmtPct = (v) => v.toLocaleString(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
    // BENCHMARK: a linha do mercado, só no modo % (comparar um índice base 1000
    // com reais não diz nada). É o enquadramento que a literatura de UX de
    // investimento recomenda pra queda — "o mercado caiu 10%, você caiu 7%" põe
    // o resultado em perspectiva em vez de parecer erro seu.
    if (pctMode && benchOn) {
      const serie = serieDoMercado(pts);
      if (serie) traces.push({ key: "bench", label: t("portfolio.chart.market"), color: "#8b93a7", bench: true, vals: serie, from: serie.findIndex((v) => v != null) });
    }
    if (pctMode) {
      traces.forEach((tr) => {
        const base = tr.vals[tr.from];
        tr.brutos = tr.vals;                        // guarda o R$ pro cabeçalho
        tr.vals = tr.vals.map((v) => (v == null ? null : (base > 0 ? (v / base) * 100 : 100)));
      });
    }
    const fmtVal = (v) => (v == null ? "—" : (pctMode ? fmtPct(v) : money(v)));
    const W = 820, H = 252, PL = 6, PR = 6, PT = 14, PB = 28;
    let yMin = Infinity, yMax = -Infinity;
    traces.forEach((tr) => tr.vals.forEach((v) => { if (v == null) return; if (v < yMin) yMin = v; if (v > yMax) yMax = v; }));
    if (!isFinite(yMin)) { yMin = 0; yMax = 1; }
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const padY = (yMax - yMin) * 0.12; yMin -= padY; yMax += padY;
    // A folga de 12% embaixo puxava o eixo pra baixo de zero em coleção pequena,
    // e "−1.134" num eixo de dinheiro é um valor que não existe.
    if (yMin < 0) yMin = 0;
    const plotW = W - PL - PR, plotH = H - PT - PB;
    const baseY = PT + plotH;
    // Eixo X pelo TEMPO, não pela posição na lista. Os pontos eram equidistantes:
    // quem passava 20 dias sem abrir o site via esse intervalo ocupar a mesma
    // largura de um dia, e a linha mentia sobre quando as coisas aconteceram.
    // A escala vai do primeiro ao último ponto MEDIDO (e não à borda da faixa),
    // pra não sobrar uma calha vazia em quem tem histórico curto.
    const msDe = (p) => new Date(p.d + "T00:00:00").getTime();
    const t0 = msDe(pts[0]), t1 = msDe(pts[pts.length - 1]);
    const spanMs = t1 - t0;
    const X = (i) => PL + (spanMs <= 0 ? plotW / 2 : ((msDe(pts[i]) - t0) / spanMs) * plotW);
    const Y = (v) => PT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
    const fmtDay = (s) => { const dt = new Date(s + "T00:00:00"); return ("0" + dt.getDate()).slice(-2) + "/" + ("0" + (dt.getMonth() + 1)).slice(-2); };
    // Ponto mais próximo de um x do viewBox. Com o eixo temporal os pontos não
    // são mais equidistantes, então não dá pra achar o índice por regra de três.
    const pontoEmX = (vx) => {
      let melhor = 0, dist = Infinity;
      for (let i = 0; i < pts.length; i++) { const d = Math.abs(X(i) - vx); if (d < dist) { dist = d; melhor = i; } }
      return melhor;
    };

    // Grade horizontal + rótulos do eixo Y.
    let grid = "";
    for (let g = 0; g <= 3; g++) {
      const v = yMin + (g / 3) * (yMax - yMin), y = Y(v);
      grid += `<line class="pf-grid" x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}"/>`;
      // No modo % o eixo é em pontos-base 100, não em dinheiro — sem o sufixo,
      // "112" ao lado de uma linha normalizada se lê como R$ 112.
      const rotulo = pctMode ? Math.round(v).toLocaleString(loc) + "%" : Math.round(v).toLocaleString(loc);
      grid += `<text class="pf-axis" x="${PL + 2}" y="${(y - 4).toFixed(1)}">${escapeHtml(rotulo)}</text>`;
    }
    // Régua de datas (eixo X): ~6 marcações espaçadas no TEMPO (não de N em N
    // pontos — com o eixo temporal, pontos vizinhos podem estar colados e dois
    // rótulos sairiam um por cima do outro). Cada marca pega o ponto medido mais
    // próximo do instante alvo; repetidos entram uma vez só.
    const T = Math.min(6, pts.length);
    let xaxis = "";
    const marcados = new Set();
    for (let j = 0; j < T; j++) {
      const alvo = PL + (T === 1 ? plotW / 2 : (j / (T - 1)) * plotW);
      const i = pontoEmX(alvo);
      if (marcados.has(i)) continue;
      marcados.add(i);
      const x = X(i), anchor = j === 0 ? "start" : (j === T - 1 ? "end" : "middle");
      xaxis += `<text class="pf-xaxis" x="${x.toFixed(1)}" y="${(H - 8).toFixed(1)}" text-anchor="${anchor}">${escapeHtml(fmtDay(pts[i].d))}</text>`;
    }
    // MENOR distância entre dois pontos vizinhos, em unidades do viewBox — decide
    // se cabe marcador por ponto (ver o uso logo abaixo). É o mínimo, e não a
    // média, porque com o eixo temporal o espaçamento é irregular: uma média
    // folgada esconderia um trecho de dias seguidos todo grudado.
    let dotSpacing = plotW;
    for (let i = 1; i < pts.length; i++) dotSpacing = Math.min(dotSpacing, X(i) - X(i - 1));
    // Área (gradiente) + linha + ponta de cada traço.
    let defs = "", areas = "", lines = "";
    // A área embaixo da linha só ajuda quando há POUCAS linhas: com 13 jogos
    // ligados, treze gradientes empilhados viram uma sopa onde não se enxerga
    // linha nenhuma. Acima de 4, fica só o traço.
    const comArea = traces.filter((tr) => !tr.bench).length <= 4;
    traces.forEach((tr) => {
      const gid = "pfg-" + tr.key;
      // Começa no 1º ponto real do traço (tr.from), não no início do eixo.
      const linePts = tr.vals.slice(tr.from)
        .map((v, j) => `${X(tr.from + j).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
      if (comArea && !tr.bench) {
        defs += `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${tr.color}" stop-opacity="0.28"/><stop offset="100%" stop-color="${tr.color}" stop-opacity="0"/></linearGradient>`;
        areas += `<polygon class="pf-area" points="${X(tr.from).toFixed(1)},${baseY.toFixed(1)} ${linePts} ${X(pts.length - 1).toFixed(1)},${baseY.toFixed(1)}" fill="url(#${gid})"/>`;
      }
      // O mercado vai TRACEJADO: é referência, não uma coleção sua — a diferença
      // precisa ser visível também pra quem não distingue as cores.
      lines += `<polyline class="pf-line${tr.bench ? " pf-line-bench" : ""}" points="${linePts}" stroke="${tr.color}"/>`;
      // Marcador por DIA (bolinha vazada). Só quando os pontos têm folga entre
      // si: o espaçamento vai de 135px em "7D" a 4,5px em "6M", e a partir de
      // certo ponto as bolinhas se encostam e a linha vira um borrão. O corte é
      // pelo espaço REAL (não pela faixa escolhida), porque o histórico pode ter
      // buracos — 90 dias de faixa com 12 pontos medidos cabe bolinha à vontade.
      if (dotSpacing >= 12 && comArea && !tr.bench) {
        lines += tr.vals.map((v, i) => (v == null ? "" :
          `<circle class="pf-dot" cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3" stroke="${tr.color}"/>`)).join("");
      }
      // Ponta do traço: bolinha CHEIA, desenhada depois pra cobrir a vazada —
      // é o valor de hoje, o único que merece destaque na linha.
      lines += `<circle cx="${X(pts.length - 1).toFixed(1)}" cy="${Y(tr.vals[tr.vals.length - 1]).toFixed(1)}" r="3.5" fill="${tr.color}"/>`;
    });
    // Alta/Baixa do traço PRINCIPAL: o patrimônio quando ele está na tela; no
    // modo por jogo, o de maior valor hoje (a linha que o olho segue).
    // Comparação pelo valor em DINHEIRO mesmo no modo % — lá as linhas foram
    // normalizadas e "a maior" viraria "a que mais subiu", que não é a linha que
    // o olho segue no gráfico.
    const ultimoBruto = (tr) => { const a = tr.brutos || tr.vals; return a[a.length - 1] || 0; };
    // O mercado nunca é o traço principal: o número grande é o SEU dinheiro, e
    // o benchmark está ali só como régua.
    const meus = traces.filter((tr) => !tr.bench);
    const principal = meus.find((tr) => tr.key === "combined")
      || meus.slice().sort((a, b) => ultimoBruto(b) - ultimoBruto(a))[0] || traces[0];
    const vals = principal.vals;
    let maxI = principal.from, minI = principal.from;
    vals.forEach((v, i) => {
      if (v == null) return;
      if (v > vals[maxI]) maxI = i;
      if (v < vals[minI]) minI = i;
    });
    const pill = (i, label, color, above) => {
      const x = X(i), y = Y(vals[i]), txt = `${label} ${fmtVal(vals[i])}`;
      const w = 14 + txt.length * 6.1, h = 19;
      let bx = Math.max(PL, Math.min(W - PR - w, x - w / 2));
      const by = above ? y - h - 10 : y + 10;
      return `<g class="pf-hilo"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${color}"/>
        <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${w.toFixed(1)}" height="${h}" rx="6"/>
        <text x="${(bx + w / 2).toFixed(1)}" y="${(by + h / 2 + 3.6).toFixed(1)}" text-anchor="middle">${escapeHtml(txt)}</text></g>`;
    };
    const hilo = maxI !== minI ? pill(maxI, t("portfolio.chart.high"), "#a78bfa", true) + pill(minI, t("portfolio.chart.low"), "#f0883e", false) : "";

    // Cabeçalho: o valor da série principal + a variação DA FAIXA escolhida.
    // Sem argumento pinta a ponta (hoje) e o rótulo do período; com um índice,
    // pinta o dia sob o cursor — é o scrub do Robinhood, onde arrastar no gráfico
    // move o número grande junto. A variação vai no formato combinado
    // "+R$ 120,00 (3,4%)": o Collectr mostra os dois juntos em vez de oferecer um
    // toggle %/absoluto, e num cartão estreito isso economiza um controle.
    // O cabeçalho é SEMPRE em dinheiro, inclusive no modo %: quem normalizou as
    // linhas quer comparar desempenho no gráfico, não parar de saber quanto tem.
    // (No modo %, `vals` está em base 100 — daí os `brutos` guardados.)
    const valsHead = principal.brutos || vals;
    function pintaCabecalho(i) {
      const idx = i == null ? valsHead.length - 1 : Math.max(i, principal.from);
      const base = valsHead[principal.from];
      const delta = valsHead[idx] - base;
      const pct = base > 0 ? (delta / base) * 100 : 0;
      const dir = delta > 0.005 ? "up" : (delta < -0.005 ? "down" : "flat");
      // Seta ALÉM da cor: verde/vermelho sozinho não serve a quem não distingue
      // as duas (a mesma regra das cápsulas de variação).
      const seta = dir === "up" ? "▲" : (dir === "down" ? "▼" : "→");
      const sinal = dir === "up" ? "+" : (dir === "down" ? "−" : "");
      // Porcentagem pelo locale (vírgula em pt/es, ponto em en) — toFixed(1)
      // escreveria "28.6%" no site inteiro em português.
      const pctTxt = Math.abs(pct).toLocaleString(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      setChartHead({
        valor: money(valsHead[idx]),
        seta,
        cash: `${sinal}${money(Math.abs(delta))}`,
        pct: `${sinal}${pctTxt}%`,
        dir,
        // No modo por jogo, dizer QUAL linha o número grande está seguindo —
        // senão "R$ 6.015,00" sobre 5 linhas coloridas é um número órfão.
        quando: i == null
          ? (emJogos ? `${principal.label} · ${t("portfolio.chart.win." + activeRange)}` : t("portfolio.chart.win." + activeRange))
          : fmtDay(pts[idx].d)
      });
    }
    pintaCabecalho();

    body.innerHTML = `<div class="pf-chart-rel">
      <svg viewBox="0 0 ${W} ${H}" class="pf-svg" role="img" aria-label="${escapeAttribute(t("portfolio.chart.title"))}">
        <defs>${defs}</defs>${grid}${areas}${lines}${xaxis}${hilo}
        <g class="pf-hover" style="display:none"></g>
      </svg>
      <div class="pf-tip" hidden></div>
    </div>`;

    // Hover: guia vertical + pontos + tooltip com o valor do dia.
    const svg = body.querySelector(".pf-svg");
    const hoverG = body.querySelector(".pf-hover");
    const tip = body.querySelector(".pf-tip");
    function onMove(ev) {
      const r = svg.getBoundingClientRect();
      if (!r.width) return;
      const clientX = ev.touches && ev.touches[0] ? ev.touches[0].clientX : ev.clientX;
      const vx = (clientX - r.left) * (W / r.width);
      const i = pontoEmX(vx);
      const x = X(i);
      pintaCabecalho(i); // scrub: o número grande acompanha o dia sob o dedo
      let g = `<line class="pf-guide" x1="${x.toFixed(1)}" y1="${PT}" x2="${x.toFixed(1)}" y2="${baseY.toFixed(1)}"/>`;
      traces.forEach((tr) => {
        if (tr.vals[i] == null) return; // jogo ainda não medido nessa data
        g += `<circle class="pf-hover-dot" cx="${x.toFixed(1)}" cy="${Y(tr.vals[i]).toFixed(1)}" r="3.6" fill="${tr.color}"/>`;
      });
      hoverG.innerHTML = g; hoverG.style.display = "";
      // Linhas ordenadas por valor DESCENDO: com 13 jogos, achar o seu na lista
      // alfabética é procurar; no topo está sempre quem mais pesa naquele dia.
      const rows = traces.filter((tr) => tr.vals[i] != null)
        .sort((a, b) => b.vals[i] - a.vals[i])
        .map((tr) => `<span class="pf-tip-row"><span class="pf-tip-dot" style="background:${tr.color}"></span>${escapeHtml(tr.label)}: <strong>${escapeHtml(fmtVal(tr.vals[i]))}</strong></span>`).join("");
      tip.innerHTML = `<span class="pf-tip-date">${escapeHtml(fmtDay(pts[i].d))}</span>${rows}`;
      tip.hidden = false;
      const leftPx = (x / W) * r.width;
      tip.style.left = Math.max(0, Math.min(r.width - tip.offsetWidth, leftPx - tip.offsetWidth / 2)) + "px";
      // Ancora no traço principal; antes de ele existir (nulo), no topo da área.
      const topPx = (Y(vals[i] == null ? yMax : vals[i]) / H) * r.height - tip.offsetHeight - 12;
      tip.style.top = Math.max(0, topPx) + "px";
    }
    function onLeave() { hoverG.style.display = "none"; tip.hidden = true; pintaCabecalho(); }
    svg.addEventListener("mousemove", onMove);
    svg.addEventListener("mouseleave", onLeave);
    svg.addEventListener("touchstart", onMove, { passive: true });
    svg.addEventListener("touchmove", onMove, { passive: true });
  }
})();
