(function () {
  const shared = window.TCGShared;
  const { t, tn, escapeHtml, escapeAttribute } = shared;

  // Dashboard do jogador: o HUB pessoal. Renderiza INSTANTÂNEO só com
  // localStorage + cookie do Portfólio (sem catálogo); a seção "mais valiosas"
  // hidrata depois, carregando apenas as cartas que o usuário tem.
  const el = {
    profile: document.getElementById("dashProfileLine"),
    value: document.getElementById("dhValue"),
    copies: document.getElementById("dhCopies"),
    distinct: document.getElementById("dhDistinct"),
    wish: document.getElementById("dhWish"),
    slabs: document.getElementById("dhSlabs"),
    games: document.getElementById("dhGames"),
    links: document.getElementById("dhLinks"),
    tools: document.getElementById("dhTools"),
    top: document.getElementById("dhTop"),
    dist: document.getElementById("dhDist"),
    topList: document.getElementById("dhTopList"),
    region: document.getElementById("dhRegion"),
    priced: document.getElementById("dhPriced"),
    // Versão "Estante" (2026-10-08): sets em andamento, quase completos,
    // chegadas recentes e metas.
    cont: document.getElementById("dhCont"),
    near: document.getElementById("dhNear"),
    recent: document.getElementById("dhRecent"),
    goals: document.getElementById("dhGoalsList")
  };

  // ── Leituras locais (read-only, defensivas) ─────────────────────────────────
  const rawJson = (key) => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } };
  const gradedCount = () => {
    const d = rawJson("tcg-collector-collection-graded-v1");
    return d && Array.isArray(d.order) ? d.order.length : 0;
  };
  const salesCount = () => {
    const d = rawJson("tcg-collector-collection-sales-v1");
    return d && Array.isArray(d.order) ? d.order.length : 0;
  };

  const ownedByGame = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, shared.createCollectionStore(g)]));
  const wishlistByGame = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, shared.createWishlistStore(g)]));

  // Cartas distintas (qty > 0) de um jogo, direto do store.
  function distinctOf(game) {
    const obj = ownedByGame[game].toObject();
    let n = 0;
    Object.keys(obj).forEach((cardId) => {
      const hasQty = Object.values(obj[cardId] || {}).some((conds) =>
        Object.values(conds || {}).some((q) => Number(q) > 0));
      if (hasQty) n += 1;
    });
    return n;
  }

  // ── Resumo instantâneo ──────────────────────────────────────────────────────
  const counts = shared.collectionCounts();
  el.copies.textContent = String(counts.copies);
  el.distinct.textContent = String(counts.distinct);
  const wishTotal = shared.GAME_SLUGS.reduce((n, g) => n + wishlistByGame[g].knownCardIds().length, 0);
  el.wish.textContent = String(wishTotal);
  const slabs = gradedCount();
  el.slabs.textContent = String(slabs);
  // Pokédex: capturados/total do cache da página da Pokédex (marcados OU com
  // carta). Quem marcou pelo herói do Pokémon sem abrir a Pokédex ainda conta
  // pelo store — daí o max. Sem nada capturado, o cartão nem aparece.
  (function renderDex() {
    const card = document.getElementById("dhDexCard");
    const val = document.getElementById("dhDex");
    if (!card || !val) return;
    const p = shared.readDexProgress();
    const captured = Math.max(p ? p.c : 0, shared.createDexOwnedStore().size);
    if (!captured) return;
    const total = p ? p.t : 1025;
    val.textContent = `${captured}/${total}`;
    // Nas Metas da "Estante" a Pokédex é uma barra, como os sets.
    const barra = document.getElementById("dhDexBar");
    if (barra) barra.style.width = `${Math.min(100, (captured / Math.max(1, total)) * 100).toFixed(1)}%`;
    card.hidden = false;
  })();

  // Valor: o cookie do Portfólio é só o PRIMEIRO PAINT (ele existe pra o número
  // aparecer sem esperar catálogo). É um retrato da última vez que você abriu o
  // Portfólio daquele jogo — e não existe pro jogo que você nunca abriu lá, que
  // era exatamente por que o Hub discordava da Coleção. Logo abaixo, quando as
  // cartas chegam, ele é substituído pela MESMA conta que a Coleção e o
  // Portfólio fazem (shared.collectionNetWorth).
  const pf = shared.portfolioValueTotal();
  el.value.textContent = pf != null ? shared.formatMoney(shared.getCurrency(), pf) : "—";
  if (pf == null) el.value.parentElement.title = t("dash.pfHint");

  // A variação de 7 dias + sparkline que moravam aqui saíram (pedido de
  // 2026-08-25): a progressão do patrimônio vive no Portfólio, com gráfico de
  // verdade — no cartão do Hub o desenho miniatura mais atrapalhava o número
  // grande do que respondia alguma coisa.

  // Perfil (nome/handle + link do perfil público quando existe)
  const profile = shared.getProfile();
  if (profile.displayName || profile.handle) {
    const who = profile.displayName || `@${profile.handle}`;
    const link = profile.handle && profile.isPublic
      ? ` · <a href="/users/${escapeAttribute(profile.handle)}">${escapeHtml(t("dash.publicProfile"))}</a>`
      : "";
    el.profile.innerHTML = `${escapeHtml(who)}${link}`;
    el.profile.hidden = false;
  }

  // ── Novidades na coleção ───────────────────────────────────────────────────
  // Novidades na coleção. Cada add/edição carimba meta.mod[cardId] desde a era
  // v3 — e o ÚNICO leitor disso era o merge de sync. O dado estava ali,
  // sincronizado entre aparelhos, sem nunca virar nada na tela.
  //
  // Agregado e não lista de cartas: o Hub é página neutra e não carrega
  // catálogo (ver game.js), então mostrar NOME de carta custaria os chunks dos
  // 13 jogos. A contagem responde a mesma pergunta sem baixar nada.
  (function renderNovidades() {
    const linha = document.getElementById("dhFresh");
    const cartao = document.getElementById("dhFreshCard");
    const num = document.getElementById("dhFreshN");
    if (!linha || !cartao || !num) return;
    const agora = new Date();
    const inicioDoMes = new Date(agora.getFullYear(), agora.getMonth(), 1).getTime();
    let noMes = 0;
    let ultima = 0;
    shared.GAME_SLUGS.forEach((g) => {
      const meta = rawJson(`tcg-collector-${g}-collection-meta-v1`);
      const mod = meta && meta.mod && typeof meta.mod === "object" ? meta.mod : null;
      if (!mod) return;
      Object.keys(mod).forEach((id) => {
        const t2 = Number(mod[id]) || 0;
        if (t2 > ultima) ultima = t2;
        if (t2 >= inicioDoMes) noMes++;
      });
    });
    if (!noMes) return;
    const mes = agora.toLocaleDateString(shared.getLocale(), { month: "long" });
    const dias = Math.floor((Date.now() - ultima) / 86400000);
    const quando = dias <= 0 ? t("dash.freshToday") : tn("dash.freshDays", dias);
    // Na linha de resumo: "+61 cartas entraram em outubro"; o "a última hoje"
    // vai no title (a seção "Chegaram por último" já mostra quais e quando).
    num.textContent = "+" + noMes.toLocaleString(shared.getLocale());
    linha.textContent = tn("dash.freshMonth", noMes, { month: mes });
    cartao.title = quando;
    cartao.hidden = false;
  })();

  // Carimbo de cada carta (meta.mod, ms): o "mexeu por último" que ordena os
  // sets em andamento e as chegadas recentes. Lido uma vez por jogo.
  const modPorJogo = {};
  const modOf = (card) => {
    const g = card.game || "pokemon";
    if (!(g in modPorJogo)) {
      const meta = rawJson(`tcg-collector-${g}-collection-meta-v1`);
      modPorJogo[g] = meta && meta.mod && typeof meta.mod === "object" ? meta.mod : {};
    }
    return Number(modPorJogo[g][card.id]) || 0;
  };

  // ── Distribuição por marca: 4 formas de ver, no MESMO quadrado ──────────
  // Mosaico (treemap), cápsulas (a fileira colorida de sempre), pizza e
  // barras desenham a mesma contagem de cartas distintas por jogo. O painel
  // #dhGames é um quadrado de tamanho FIXO (CSS): trocar a forma redesenha só
  // o miolo, nunca a caixa — a página não pula. A escolha fica em
  // localStorage (tcg-dash-games-view), como o modo do gráfico do Portfólio.
  // "Vintage" entra como uma divisão A MAIS (agnóstica de jogo, ver
  // isVintageCard): as cartas dela também contam no jogo delas — é duplicado
  // de propósito, e o title do tile diz isso. A contagem precisa do catálogo
  // (flag/prefixo/ano), que só chega na hidratação; pra o primeiro paint não
  // ficar sem ela, o último valor fica em cache local.
  const VINTAGE_CACHE = "tcg-dash-vintage-v1";
  let vintageN = (() => { const c = rawJson(VINTAGE_CACHE); return c && Number(c.n) > 0 ? Number(c.n) : 0; })();
  let dist = [];
  let distTotal = 0;    // soma de TODAS as fatias (vintage inclusa): é o que fecha a rosca
  let distDistinct = 0; // cartas distintas de verdade (sem a duplicata do vintage)
  function buildDist() {
    const entrada = (g, n, cor, label, href, hint) => {
      // Cor CHAPADA + textOnColor, o mesmo idioma do .game-tag da Coleção
      // (4,5:1 garantido nos 12 jogos, inclusive nos claros como o prata do
      // DBFW). O "véu" da contagem é o INVERSO do texto: sobre jogo escuro
      // escurece, sobre jogo claro clareia — um rgba(0,0,0) fixo faria a
      // contagem sumir justamente nos jogos claros.
      const fg = shared.textOnColor(cor);
      return { g, n, cor, fg, veil: fg === "#000000" ? "rgba(255,255,255,.5)" : "rgba(0,0,0,.26)", label, href, hint };
    };
    dist = shared.GAME_SLUGS
      .map((g) => ({ g, n: distinctOf(g) }))
      .filter((x) => x.n > 0)
      // ?filter=<jogo>: leva pra Coleção JÁ FILTRADA naquele jogo. Cair numa
      // Coleção em "Todos" obrigava a refazer na mão o filtro recém-escolhido.
      .map((x) => entrada(x.g, x.n, shared.GAME_COLOR[x.g] || shared.GAME_COLOR.pokemon, shared.gameLabel(x.g), `collection?filter=${escapeAttribute(x.g)}`, ""));
    distDistinct = dist.reduce((n, x) => n + x.n, 0);
    if (vintageN > 0 && dist.length) {
      dist.push(entrada(shared.VINTAGE_FILTER, vintageN, shared.VINTAGE_COLOR, t("filter.gameVintage"), `collection?filter=${shared.VINTAGE_FILTER}`, t("filter.vintageHint")));
    }
    distTotal = dist.reduce((n, x) => n + x.n, 0);
  }
  buildDist();

  // ── Painel de distribuição: 4 formas de ver, num quadrado fixo ───────────
  // Serve o "Por jogo" e o "Por região": cada card tem o seu seletor, a sua
  // chave de preferência e o seu padrão, mas o desenho é um só. `rows` são
  // entradas { g, n, cor, fg, veil, label, labelHtml?, href?, hint? } e `ctx`
  // traz total (a soma que fecha a rosca) e distinct (o número do centro).
  const VIEW_LABEL = { treemap: "dash.viewTreemap", chips: "dash.viewChips", pie: "dash.viewPie", bars: "dash.viewBars" };
  // Seletor SÓ-ÍCONE (o .view-toggle da Coleção): quatro rótulos escritos não
  // cabem ao lado do título na largura do quadrado. O nome vai no title/aria.
  const VIEW_ICON = {
    chips: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="5" width="9" height="6"/><rect x="14" y="5" width="7" height="6"/><rect x="3" y="13" width="6" height="6"/><rect x="11" y="13" width="10" height="6"/></svg>',
    pie: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12l6.2 5.8"/></svg>',
    bars: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h15"/><path d="M4 12h10"/><path d="M4 18h6"/></svg>',
    treemap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="3" width="10" height="18"/><rect x="13" y="3" width="8" height="10"/><rect x="13" y="13" width="8" height="8"/></svg>'
  };
  const distStyle = (x) => `--gc:${x.cor};--gc-fg:${x.fg};--gc-veil:${x.veil}`;
  const nameOf = (x) => x.labelHtml || escapeHtml(x.label);
  // Entrada COM destino vira link; sem (as regiões) vira <span> com o mesmo
  // visual — um <a> sem href seria foco morto pro teclado.
  const peca = (x, cls, style, title, inner) => x.href
    ? `<a class="${cls}" href="${x.href}"${style ? ` style="${style}"` : ""} title="${title}">${inner}</a>`
    : `<span class="${cls}"${style ? ` style="${style}"` : ""} title="${title}">${inner}</span>`;

  const VIEWS = {
    // Mosaico (treemap "squarified"): a área de cada azulejo é a fatia no
    // total. Tudo em % do quadrado, então não depende do tamanho em px.
    treemap: (rows, ctx) => {
      const tiles = squarify(rows.slice().sort((a, b) => b.n - a.n).map((x) => ({ x, area: (x.n / ctx.total) * 10000 })), 0, 0, 100, 100);
      return `<div class="dash-gv dash-gv-tm">${tiles.map((tl) =>
        // Azulejo estreito ou baixo demais pro texto: some o rótulo (o title
        // continua contando) em vez de deixar letra cortada pela metade.
        peca(tl.x, `dash-tm-tile${tl.w < 17 || tl.h < 10 ? " dash-tm-s" : ""}`,
          `${distStyle(tl.x)};left:${tl.x0.toFixed(2)}%;top:${tl.y0.toFixed(2)}%;width:${tl.w.toFixed(2)}%;height:${tl.h.toFixed(2)}%`,
          ctx.title(tl.x), `<span>${nameOf(tl.x)}</span><span>${tl.x.n}</span>`)).join("")}</div>`;
    },

    chips: (rows, ctx) => `<div class="dash-gv dash-gv-chips">${rows.map((x) =>
      peca(x, "dash-game-chip", distStyle(x), ctx.title(x),
        `<span class="dash-game-name">${nameOf(x)}</span><span class="dash-game-count">${x.n}</span>`)).join("")}</div>`,

    // Rosca em SVG: cada fatia é um <circle> com stroke-dasharray (comprimento
    // da fatia, resto do perímetro) girado até o começo dela. O 2 de folga no
    // traço deixa o fundo do painel aparecer entre fatias vizinhas — é o
    // "gap de superfície" que separa cores parecidas sem borda extra. Com uma
    // fatia só, a folga some e a rosca fecha inteira.
    pie: (rows, ctx) => {
      const R = 38, C = 2 * Math.PI * R, GAP = rows.length > 1 ? 2 : 0;
      let off = 0;
      const fatias = rows.map((x) => {
        const len = (x.n / ctx.total) * C;
        const svg = `<circle r="${R}" cx="50" cy="50" fill="none" stroke="${x.cor}" stroke-width="20"
          stroke-dasharray="${Math.max(0, len - GAP).toFixed(2)} ${C.toFixed(2)}"
          transform="rotate(${((off / C) * 360 - 90).toFixed(2)} 50 50)"><title>${ctx.title(x)}</title></circle>`;
        off += len;
        return svg;
      }).join("");
      return `<div class="dash-gv dash-gv-pie">
        <svg viewBox="0 0 100 100" role="img" aria-label="${escapeAttribute(tn("count.cards", ctx.distinct))}">${fatias}
          <text x="50" y="49" text-anchor="middle" class="dash-pie-total">${ctx.distinct}</text>
          <text x="50" y="59" text-anchor="middle" class="dash-pie-sub">${escapeHtml(t("stats.distinct"))}</text>
        </svg>
        <div class="dash-pie-legend">${rows.map((x) =>
          peca(x, "dash-pie-row", "", ctx.title(x),
            `<span class="dash-pie-dot" style="background:${x.cor}"></span><span class="dash-pie-name">${nameOf(x)}</span><span class="dash-pie-n">${x.n}</span>`)).join("")}</div>
      </div>`;
    },

    // Barras: a anatomia da antiga "Distribuição por região" (.dash-dist-*),
    // ordenada do maior pro menor.
    bars: (rows, ctx) => {
      const max = Math.max(1, ...rows.map((x) => x.n));
      return `<div class="dash-gv dash-gv-bars">${rows.slice().sort((a, b) => b.n - a.n).map((x) =>
        peca(x, "dash-dist-row", "", ctx.title(x),
          `<span class="dash-dist-label">${nameOf(x)}</span>
          <span class="dash-dist-track"><span class="dash-dist-fill" style="width:${Math.round((x.n / max) * 100)}%;background:${x.cor}"></span></span>
          <span class="dash-dist-n">${x.n}</span>`)).join("")}</div>`;
    }
  };

  // Squarified treemap (Bruls, Huizing & van Wijk): preenche o retângulo em
  // fileiras ao longo do lado MENOR, aceitando itens na fileira enquanto o pior
  // aspecto (largura/altura) dela melhora. Itens já vêm em ordem decrescente.
  function squarify(items, x0, y0, w, h) {
    const out = [];
    let list = items, rx = x0, ry = y0, rw = w, rh = h;
    while (list.length) {
      const coluna = rw >= rh;          // caixa larga: a fileira é uma coluna vertical
      const lado = coluna ? rh : rw;
      const pior = (fila) => {
        const s = fila.reduce((n, it) => n + it.area, 0);
        return Math.max(...fila.map((it) => Math.max((lado * lado * it.area) / (s * s), (s * s) / (lado * lado * it.area))));
      };
      let fila = [list[0]], melhor = pior(fila);
      for (let i = 1; i < list.length; i++) {
        const cand = fila.concat(list[i]);
        const p = pior(cand);
        if (p > melhor) break;
        fila = cand; melhor = p;
      }
      const s = fila.reduce((n, it) => n + it.area, 0);
      const esp = s / lado;             // espessura da fileira
      let off = 0;
      fila.forEach((it) => {
        const len = it.area / esp;
        out.push(coluna
          ? { x: it.x, x0: rx, y0: ry + off, w: esp, h: len }
          : { x: it.x, x0: rx + off, y0: ry, w: len, h: esp });
        off += len;
      });
      if (coluna) { rx += esp; rw -= esp; } else { ry += esp; rh -= esp; }
      list = list.slice(fila.length);
    }
    return out;
  }

  // Padrão: mosaico — é a forma que preenche o quadrado inteiro.
  // Um painel = miolo quadrado + seletor + preferência salva. Trocar a forma
  // redesenha só o miolo, nunca a caixa — a página não pula.
  function distPanel(body, modes, key, padrao) {
    const readView = () => { try { const v = localStorage.getItem(key); return VIEWS[v] ? v : padrao; } catch (e) { return padrao; } };
    let view = readView();
    let ultimo = null; // { rows, ctx } do último render, pra redesenhar ao trocar a forma
    function paint() {
      if (!ultimo) return;
      body.innerHTML = ultimo.rows.length
        ? VIEWS[view](ultimo.rows, ultimo.ctx)
        : `<p class="empty-state">${escapeHtml(t("dash.empty"))}</p>`;
      if (modes) {
        modes.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
        modes.hidden = !ultimo.rows.length; // sem carta nenhuma não há o que alternar
      }
    }
    if (modes) {
      modes.innerHTML = Object.keys(VIEWS).map((v) =>
        `<button type="button" class="view-toggle-btn" data-view="${v}" aria-pressed="${v === view}" aria-label="${escapeAttribute(t(VIEW_LABEL[v]))}" title="${escapeAttribute(t(VIEW_LABEL[v]))}">${VIEW_ICON[v]}</button>`).join("");
      modes.addEventListener("click", (e) => {
        const b = e.target.closest("[data-view]");
        if (!b || b.dataset.view === view) return;
        view = b.dataset.view;
        try { localStorage.setItem(key, view); } catch (e2) { /* modo privado */ }
        paint();
      });
    }
    return { render(rows, ctx) { ultimo = { rows, ctx }; paint(); } };
  }

  // Por jogo: mosaico por padrão — é a forma que preenche o quadrado inteiro.
  const gamesPanel = distPanel(el.games, document.getElementById("dhGamesModes"), "tcg-dash-games-view", "treemap");
  function renderGames() {
    gamesPanel.render(dist, {
      total: distTotal, distinct: distDistinct,
      title: (x) => escapeAttribute(x.hint
        ? `${x.hint} · ${x.n}`
        : t("dash.gameShare", { name: x.label, n: x.n, pct: Math.round((x.n / Math.max(1, distTotal)) * 100) }))
    });
  }
  renderGames();
  // Por região: pizza por padrão (poucas fatias, é onde a proporção lê melhor).
  const regionPanel = distPanel(el.region, document.getElementById("dhRegionModes"), "tcg-dash-region-view", "pie");

  // ── Atalhos (HUB) ───────────────────────────────────────────────────────────
  const IC = {
    collection: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="12" height="16" rx="2" transform="rotate(-8 10 14)"/><rect x="9" y="4" width="12" height="16" rx="2" transform="rotate(6 15 12)"/></svg>',
    graded: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><rect x="8" y="8" width="8" height="10" rx="1"/><path d="M8 5.5h8"/></svg>',
    wishlist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 8.6c0-2.5-2-4.6-4.5-4.6-1.9 0-3.5 1.1-4.3 2.8-.8-1.7-2.4-2.8-4.3-2.8C5.2 4 3.2 6.1 3.2 8.6c0 5 8.8 10.4 8.8 10.4s8.8-5.4 8.8-10.4Z"/></svg>',
    binders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>',
    sales: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-5L9 3 4 7H3v13h17V7Z"/><path d="M12 11v5"/><path d="M9.5 13.5h5"/></svg>',
    explore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
    games: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/></svg>',
    badges: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="6"/><path d="m8.5 14-2 7 5.5-3 5.5 3-2-7"/></svg>',
    // Decks: duas cartas empilhadas em leque (monte de deck), distinto do binder
    // (que é um álbum aberto com lombada).
    decks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="3" width="12" height="16" rx="2"/><path d="M4.5 6.5v12a2 2 0 0 0 2 2h9"/></svg>',
    // Pastas (as antigas Listas, 2026-09-16): uma pasta com cartas dentro —
    // a coleção fatiada em pedaços com nome, cada um com link e export próprios.
    lists: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 11h18"/></svg>',
    // Medir centralização: a carta com as guias (uma vertical, uma horizontal).
    centering: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 12h14"/><path d="M12 3v18"/></svg>',
    // Troca: duas setas em sentidos opostos (dou ⇄ recebo).
    trade: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h13"/><path d="m14 4 3 3-3 3"/><path d="M20 17H7"/><path d="m10 14-3 3 3 3"/></svg>',
    // Guia de condição: a carta com uma lupa no canto.
    condition: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="2.5" width="12" height="17" rx="2"/><circle cx="15.5" cy="15.5" r="4"/><path d="m18.5 18.5 3 3"/></svg>',
    // Sleeves e fichários: a carta saindo de dentro da sleeve.
    sleeves: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7v13a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V7"/><rect x="6.5" y="3" width="11" height="15" rx="1.5"/></svg>'
  };
  const soldTotal = shared.readSoldList().length;
  // Ordem (pedido de 2026-09-16): Toda Coleção, Pastas (as antigas Listas —
  // a coleção fatiada, por isso logo abaixo dela) e Lista de Desejo (o que
  // tenho / o que quero). O mega-menu da Coleção no header (shared.js) segue a
  // MESMA ordem — os dois são o mesmo "Ir para", e divergir confundiria quem
  // decora a posição.
  const links = [
    { href: "collection", icon: "collection", key: "nav.collectionMine", stat: tn("count.cards", counts.distinct) },
    { href: "pastas", icon: "lists", key: "nav.lists", stat: t("dash.listsHint") },
    { href: "wishlist", icon: "wishlist", key: "nav.wishlist", stat: tn("dash.wishCount", wishTotal) },
    { href: "collection?tab=graded", icon: "graded", key: "nav.graded", stat: tn("dash.slabsCount", slabs) },
    { href: "binders", icon: "binders", key: "nav.binders", stat: "" },
    { href: "my-decks", icon: "decks", key: "nav.myDecks", stat: t("dash.decksHint") },
    { href: "sales", icon: "sales", key: "nav.sales", stat: tn("dash.salesCount", salesCount()) + (soldTotal ? ` · ${tn("dash.soldCount", soldTotal)}` : "") },
    { href: "badges", icon: "badges", key: "dash.badges", stat: t("dash.badgesHint") }
    // Explorar, Jogos e Portfólio saíram daqui: já são itens fixos do menu do
    // header, então repetir na dashboard era redundante. O patrimônio continua
    // no cartão grande lá em cima, que também leva ao Portfólio.
  ];
  // Ferramentas (2026-10-01): o que a pessoa USA, não lugar aonde vai — por
  // isso fora do "Ir para". Guia de condição e Sleeves são página própria
  // (docs/FERRAMENTAS.md), e o Centering Tool também, desde a v2
  // (centering.html; antes era o medidor em modal por cima do HUB, com
  // <button> e handler). Ao mudar a contagem de itens de uma das duas grades,
  // o .dash-links (styles.css) tem de acompanhar.
  const tools = [
    { href: "troca", icon: "trade", key: "trade.title", stat: t("dash.tradeHint") },
    { href: "centering", icon: "centering", key: "ctr.title", stat: t("dash.ctrHint") },
    { href: "condition", icon: "condition", key: "nav.condicao", stat: t("dash.condHint") },
    { href: "sleeves", icon: "sleeves", key: "nav.sleeves", stat: t("dash.slvHint") }
  ];
  // Versão "Estante": linha compacta de 44px (ícone + nome), duas por fileira
  // na lateral. O subtítulo vai no title — na lateral ele não cabe, e o "→"
  // de texto saiu (a regra da casa é ícone em SVG).
  const linkHtml = (l) => `<a class="hb-link" href="${escapeAttribute(l.href)}"${l.stat ? ` title="${escapeAttribute(l.stat)}"` : ""}>
      <span class="hb-link-ic" aria-hidden="true">${IC[l.icon]}</span><span class="hb-link-txt">${escapeHtml(t(l.key))}</span></a>`;
  // HTML velho em cache (sem a seção #dhTools) com este JS: as ferramentas
  // voltam pro fim do "Ir para" em vez de sumir do HUB.
  el.links.innerHTML = (el.tools ? links : links.concat(tools)).map(linkHtml).join("");
  if (el.tools) el.tools.innerHTML = tools.map(linkHtml).join("");
  // Metas pintam NA HORA (sets completos entram como "—" até a carga).
  renderGoals("—");
  const corDe = (g) => shared.GAME_COLOR[g] || shared.GAME_COLOR.pokemon;

  // ── Cápsulas detalhadas (hidratam depois; só as cartas que você tem) ───────
  // Mesmo visual da antiga dashboard da Coleção (que ficou só com os stats):
  // Mais valiosas (top 3 por valor unitário) + distribuição por jogo e região.
  // Inclui os ids em slab (ver shared.collectionLoadIds): quem tem só cartas
  // graduadas — raw zerada — não tinha carta nenhuma pra carregar aqui e ficava
  // com o valor congelado do cookie pra sempre.
  const idsByGame = shared.collectionLoadIds(ownedByGame);
  if (!Object.values(idsByGame).some((ids) => ids.length)) return;
  // "Continue de onde parou" guarda o lugar com sets fantasma enquanto a carga
  // anda: é a primeira coisa da coluna, e aparecer do nada empurraria o resto
  // da tela. Se a carga falhar (ou não houver set pra mostrar), some.
  const contList = document.getElementById("dhContList");
  if (el.cont && contList) {
    contList.innerHTML = Array.from({ length: 4 }, () =>
      '<li class="hb-skel" aria-hidden="true"><span class="hb-set hb-set-skel"><span class="skel-line"></span><span class="skel-line short"></span><span class="hb-bar"></span></span></li>').join("");
    el.cont.hidden = false;
  }
  const someCont = () => { if (el.cont) { el.cont.hidden = true; contList.innerHTML = ""; } };
  const pricesByGame = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, shared.createPriceStore(g)]));
  const cardGameMap = new Map();
  const gameOf = (id) => cardGameMap.get(id) || "pokemon";
  const prices = shared.mergedPriceStore(pricesByGame, gameOf);

  // Mesma carga do Portfólio: a borda devolve só as cartas que você tem, em
  // vez dos chunks inteiros dos sets delas (esta tela usa apenas catalog.cards).
  Promise.all([shared.loadOwnedFast(idsByGame), shared.loadFxRates()]).then(([catalog]) => {
    const cards = catalog.cards || [];
    cards.forEach((c) => cardGameMap.set(c.id, c.game));
    const owned = shared.mergedCollectionStore(ownedByGame, gameOf);
    const seen = new Set();
    const myCards = cards.filter((card) => {
      if (seen.has(card.id)) return false;
      seen.add(card.id);
      return shared.cardVariants(card).some((v) => owned.variantTotal(card.id, v) > 0);
    });
    // Quem só tem carta GRADUADA (raw zerada) não tem `myCards` — mas tem
    // patrimônio. Sair aqui deixava essa pessoa com o retrato velho do cookie
    // pra sempre; o collectionNetWorth abaixo já soma os slabs.
    if (!myCards.length && !shared.gradedCardIds().length) { someCont(); return; }

    // Vintage no "Por jogo": conta agora (a regra precisa da carta), guarda
    // pro próximo primeiro paint e redesenha só se o número mudou.
    const vintageAgora = myCards.filter(shared.isVintageCard).length;
    if (vintageAgora !== vintageN) {
      vintageN = vintageAgora;
      try { localStorage.setItem(VINTAGE_CACHE, JSON.stringify({ n: vintageN, t: Date.now() })); } catch (e) { /* conveniência */ }
      buildDist();
      renderGames();
    }

    renderSets(myCards).catch(someCont);
    renderRecent(myCards);

    // Valor de verdade, no lugar do retrato do cookie: mesma função da Coleção e
    // do Portfólio, sobre as mesmas cartas e a mesma tabela de preço.
    const patrimonio = shared.collectionNetWorth(myCards, owned, prices, { gameOf }).total;
    el.value.textContent = patrimonio > 0 ? shared.formatMoney(shared.getCurrency(), patrimonio) : "—";
    el.value.parentElement.removeAttribute("title");

    // Quanto do número grande é preço real e quanto é buraco: o Portfólio já
    // mostrava isso e o Hub não, então o mesmo patrimônio parecia ter precisões
    // diferentes nas duas telas. Só aparece quando falta preço em alguma cópia
    // — com tudo precificado, o aviso seria ruído.
    const contagem = shared.collectionValueLines(myCards, owned, prices, {});
    if (el.priced && contagem.totalCopies > 0 && contagem.pricedCopies < contagem.totalCopies) {
      el.priced.textContent = `${contagem.pricedCopies}/${contagem.totalCopies} ${t("dash.priced")}`;
      el.priced.hidden = false;
    }

    // Ponto do dia no histórico do Portfólio. O Hub já tem a conta na mão, então
    // quem nunca abre o Portfólio não fica mais com buracos no gráfico. Manda
    // raw e graded SEPARADOS (as duas séries do gráfico) e omite `wish`: esta
    // tela não carrega as cartas desejadas, e mandar 0 apagaria o valor que o
    // Portfólio gravou hoje — campo ausente preserva o que já está lá.
    // `parcial` (a carga veio incompleta — borda com menos carta que o pedido,
    // ou jogo/chunk que falhou no caminho de chunks): o total está subestimado
    // e gravá-lo marcaria no gráfico uma queda que não aconteceu. priced/copies:
    // cobertura de preços, pra guarda de queda falsa do recordValueSnapshot.
    if (!catalog.parcial) {
      shared.recordValueSnapshot(Object.fromEntries(shared.GAME_SLUGS.map((g) => {
        const linhas = shared.collectionValueLines(myCards, owned, prices, { gameFilter: g });
        return [g, {
          raw: linhas.total,
          graded: shared.gradedTotalValue(gameOf, g),
          priced: linhas.pricedCopies,
          copies: linhas.totalCopies
        }];
      })));
    }

    // Mais valiosas: lista curta na lateral (miniatura, nome, set e valor) —
    // na "Estante" o dinheiro é contexto, não vitrine.
    // A variante MAIS VALIOSA entre as que você tem, não a primeira da lista:
    // quem tem a Normal e a Foil era rankeado pela Normal, e o "top" daqui
    // discordava do da tabela do Portfólio (que ranqueia por lote).
    const top = myCards.map((card) => {
      const minhas = shared.cardVariants(card).filter((v) => owned.variantTotal(card.id, v) > 0);
      const val = minhas.reduce((max, v) => Math.max(max, shared.cardValue(card, v, prices).value || 0), 0);
      return { card, val };
    }).filter((x) => x.val > 0).sort((a, b) => b.val - a.val).slice(0, 5);
    el.topList.innerHTML = top.map(({ card, val }) => {
      const src = shared.cardImageSources(card);
      const thumb = shared.localizedImg(src.url, { alt: "", fallback: src.fallback, loading: "lazy", thumb: true });
      return `<li><a class="hb-top" href="${escapeAttribute(shared.detailUrl("set", card.set, "", card.game, { card: card.id, setId: card.setId }))}"><span class="hb-top-img">${thumb}</span>
            <span class="hb-top-info"><strong>${escapeHtml(card.name)}</strong><span>${escapeHtml(shared.dotJoin(card.set, card.number))}</span></span>
            <span class="hb-top-val hb-money sensitive-value">${escapeHtml(shared.formatMoney(shared.getCurrency(), val))}</span></a></li>`;
    }).join("");

    // A "Distribuição por jogo" que morava aqui saiu (proposta de 2026-08-25):
    // era a MESMA contagem da fileira de chips #dhGames, repetida na tela.

    // Distribuição por região/idioma (flag SVG como na Coleção), no mesmo
    // painel de 4 formas do "Por jogo". Sem destino: a Coleção não abre
    // filtrada por idioma pela URL.
    const byRegion = {};
    myCards.forEach((card) => { const r = shared.cardLanguageRegion(card.language); byRegion[r] = (byRegion[r] || 0) + 1; });
    const regions = [
      { region: "english", lang: "en", color: "#2aa3df" },
      { region: "japanese", lang: "ja", color: "#d23b4e" },
      { region: "portuguese", lang: "pt", color: "#1f9d77" },
      { region: "chinese", lang: "zh", color: "#e0992f" }
    ];
    const regionRows = regions.filter((r) => byRegion[r.region] > 0).map((r) => {
      const fg = shared.textOnColor(r.color);
      const label = t("setRegion." + r.region).replace(/\s*\(.*/, "");
      return {
        g: r.region, n: byRegion[r.region], cor: r.color, fg,
        veil: fg === "#000000" ? "rgba(255,255,255,.5)" : "rgba(0,0,0,.26)",
        label, labelHtml: `${shared.cardFlag(r.lang)}<span>${escapeHtml(label)}</span>`
      };
    });
    const regionTotal = regionRows.reduce((n, x) => n + x.n, 0);
    regionPanel.render(regionRows, {
      total: regionTotal, distinct: regionTotal,
      title: (x) => escapeAttribute(t("dash.gameShare", { name: x.label, n: x.n, pct: Math.round((x.n / Math.max(1, regionTotal)) * 100) }))
    });

    el.top.hidden = !top.length;
    el.dist.hidden = false;
  }).catch(() => { someCont(); /* rede: o resto do dashboard já está renderizado */ });

  // ── Sets em andamento (versão "Estante") ───────────────────────────────────
  // O MESMO denominador da aba Sets da Coleção: cartas do set no manifest do
  // jogo menos as bônus (toManifestSetItem no app.js). O manifest é o arquivo
  // leve que a busca rápida (Ctrl+K) já baixa — mesmo endereço, então costuma
  // vir do cache —, e traz também o logo do set, que as cartas da borda não
  // têm. Sem manifest (dev, ou a rede falhou), vale o total impresso na carta
  // (setTotal) e o logo da própria carta; sem total nenhum, o set fica de fora.
  const manifestCache = {};
  function manifestDe(g) {
    if (!manifestCache[g]) {
      manifestCache[g] = fetch(shared.gameDataDir(g) + "manifest.generated.js")
        .then((r) => (r.ok ? r.text() : ""))
        .then((tx) => {
          const a = tx.indexOf("{"), b = tx.lastIndexOf("}");
          return a >= 0 && b > a ? JSON.parse(tx.slice(a, b + 1)) : null;
        })
        .catch(() => null);
    }
    return manifestCache[g];
  }
  const pctTxt = (n, total) => `${Math.floor((n / Math.max(1, total)) * 100)}%`;
  function setHtml(s) {
    const pct = Math.min(100, (s.n / Math.max(1, s.total)) * 100);
    const falta = s.total - s.n;
    const href = shared.detailUrl("set", s.name, "", s.game, { setId: s.setId });
    // Sem logo próprio, o nome já é o título do cartão (a regra de todos os
    // jogos) — repetir ele no lugar da arte seria eco; ali entra a % grande.
    const arte = s.logo
      ? `<img src="${escapeAttribute(s.logo)}" alt="" decoding="async" data-pct="${pctTxt(s.n, s.total)}">`
      : `<span class="hb-set-pct">${pctTxt(s.n, s.total)}</span>`;
    return `<li><a class="hb-set" href="${escapeAttribute(href)}" style="--gc:${corDe(s.game)}" title="${escapeAttribute(s.name)}">
        <span class="hb-set-art">${arte}</span>
        <span class="hb-set-body">
          <span class="hb-set-game">${escapeHtml(shared.gameLabel(s.game))}</span>
          <strong>${escapeHtml(s.name)}</strong>
          <span class="hb-bar"><span style="width:${pct.toFixed(1)}%"></span></span>
          <span class="hb-set-n"><b>${s.n}/${s.total}</b> · ${pctTxt(s.n, s.total)}<span class="hb-set-falta">${escapeHtml(tn("dash.b.missing", falta))}</span></span>
        </span></a></li>`;
  }
  async function renderSets(myCards) {
    const porSet = new Map();
    myCards.forEach((card) => {
      if (shared.isBonusCard(card)) return;
      const g = card.game || "pokemon";
      const k = `${g}|${card.setId || card.set}|${card.language || ""}`;
      let s = porSet.get(k);
      if (!s) porSet.set(k, s = { game: g, setId: card.setId, name: card.set, lang: card.language || "", n: 0, mod: 0, total: Number(card.setTotal) || 0, logo: card.setLogo || "" });
      s.n += 1;
      s.mod = Math.max(s.mod, modOf(card));
    });
    const jogos = shared.unique([...porSet.values()].map((s) => s.game));
    const manifests = await Promise.all(jogos.map(manifestDe));
    jogos.forEach((g, i) => {
      const m = manifests[i];
      if (!m || !Array.isArray(m.sets)) return;
      const porId = new Map();
      m.sets.forEach((e) => {
        if (!e || !e.id) return;
        porId.set(`${e.id}|${e.language || ""}`, e);
        if (!porId.has(e.id)) porId.set(e.id, e);
      });
      porSet.forEach((s) => {
        if (s.game !== g) return;
        const e = porId.get(`${s.setId}|${s.lang}`) || porId.get(s.setId);
        if (!e) return;
        const n = Number(e.count) || 0;
        if (n > 0) s.total = n - (Number(e.bonus) || 0);
        if (e.logo) s.logo = e.logo;
        if (e.name) s.name = shared.setDisplayName ? shared.setDisplayName(e.id, e.name, e.language) : e.name;
      });
    });
    const sets = [...porSet.values()].filter((s) => s.total > 0).map((s) => Object.assign(s, { n: Math.min(s.n, s.total) }));
    const completos = sets.filter((s) => s.n >= s.total).length;
    const abertos = sets.filter((s) => s.n < s.total);
    // Continue: os 4 mexidos por último. Quase lá: metade ou mais, do que
    // falta menos pro que falta mais, sem repetir os de cima.
    const cont = abertos.slice().sort((a, b) => b.mod - a.mod).slice(0, 4);
    const usados = new Set(cont);
    const near = abertos.filter((s) => !usados.has(s) && s.n / s.total >= 0.5)
      .sort((a, b) => (a.total - a.n) - (b.total - b.n) || b.n / b.total - a.n / a.total).slice(0, 4);
    if (cont.length) contList.innerHTML = cont.map(setHtml).join("");
    else someCont();
    if (el.near) {
      document.getElementById("dhNearList").innerHTML = near.map(setHtml).join("");
      el.near.hidden = !near.length;
    }
    // Logo que não carrega (link quebrado na fonte, rede) vira a % grande,
    // como o set sem logo — em vez de um quadrado vazio no cartão.
    document.querySelectorAll(".hb-set-art img").forEach((img) => {
      const troca = () => { img.outerHTML = `<span class="hb-set-pct">${escapeHtml(img.dataset.pct || "")}</span>`; };
      if (img.complete && !img.naturalWidth) troca();
      else img.addEventListener("error", troca, { once: true });
    });
    renderGoals(completos);
  }

  // ── Chegaram por último ────────────────────────────────────────────────────
  // As 8 cartas com o carimbo mais recente (add OU edição — é o que o meta.mod
  // registra), com o dia embaixo.
  function quandoFoi(ms) {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const dias = Math.floor((hoje.getTime() - new Date(ms).setHours(0, 0, 0, 0)) / 86400000);
    if (dias <= 0) return t("dash.b.today");
    if (dias === 1) return t("dash.b.yesterday");
    if (dias < 7) return tn("dash.b.daysAgo", dias);
    return new Date(ms).toLocaleDateString(shared.getLocale(), { day: "numeric", month: "short" });
  }
  function renderRecent(myCards) {
    const lista = document.getElementById("dhRecentList");
    if (!el.recent || !lista) return;
    const rec = myCards.map((card) => ({ card, mod: modOf(card) })).filter((x) => x.mod > 0)
      .sort((a, b) => b.mod - a.mod).slice(0, 8);
    if (!rec.length) return;
    lista.innerHTML = rec.map(({ card, mod }) => {
      const src = shared.cardImageSources(card);
      const thumb = shared.localizedImg(src.url, { alt: "", fallback: src.fallback, loading: "lazy", thumb: true });
      return `<li><a class="hb-card" href="${escapeAttribute(shared.detailUrl("set", card.set, "", card.game, { card: card.id, setId: card.setId }))}" title="${escapeAttribute(`${card.name} · ${card.set}`)}"><span class="hb-card-img">${thumb}</span>
            <strong>${escapeHtml(card.name)}</strong>
            <span class="hb-card-when">${escapeHtml(quandoFoi(mod))}</span></a></li>`;
    }).join("");
    el.recent.hidden = false;
  }

  // ── Metas ──────────────────────────────────────────────────────────────────
  // Sets completos (depois da carga) e a lista de desejos; a Pokédex é o
  // cartão #dhDexCard, que pinta na hora.
  function renderGoals(completos) {
    if (!el.goals) return;
    // Sem número (Badges), a ponta direita leva a seta em SVG.
    const SETA = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
    const meta = (href, rotulo, valor) => `<li><a class="hb-goal hb-goal-row" href="${escapeAttribute(href)}"><span>${escapeHtml(rotulo)}</span>${valor ? `<strong>${escapeHtml(valor)}</strong>` : `<span class="hb-goal-go">${SETA}</span>`}</a></li>`;
    el.goals.innerHTML = meta("collection?tab=sets", t("dash.b.setsDone"), String(completos))
      + meta("wishlist", t("dash.b.wishGoal"), String(wishTotal))
      + meta("badges", t("dash.badges"), "");
  }
})();
