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
    top: document.getElementById("dhTop"),
    dist: document.getElementById("dhDist"),
    topList: document.getElementById("dhTopList"),
    region: document.getElementById("dhRegion"),
    priced: document.getElementById("dhPriced")
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

  // ── Continuar de onde parou ────────────────────────────────────────────────
  // Últimos sets visitados, gravados pelo detail.js com o progresso DA VISITA
  // (recalcular aqui exigiria os índices dos 13 jogos; a próxima visita
  // atualiza o número de graça). Só links internos de /detail entram — a chave
  // é local, mas render de URL gravada pede a mesma desconfiança do login.
  // Novidades na coleção. Cada add/edição carimba meta.mod[cardId] desde a era
  // v3 — e o ÚNICO leitor disso era o merge de sync. O dado estava ali,
  // sincronizado entre aparelhos, sem nunca virar nada na tela.
  //
  // Agregado e não lista de cartas: o Hub é página neutra e não carrega
  // catálogo (ver game.js), então mostrar NOME de carta custaria os chunks dos
  // 13 jogos. A contagem responde a mesma pergunta sem baixar nada.
  (function renderNovidades() {
    const linha = document.getElementById("dhFresh");
    const head = document.getElementById("dhFreshHead");
    if (!linha) return;
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
    linha.innerHTML = `<strong>+${noMes.toLocaleString(shared.getLocale())}</strong> `
      + escapeHtml(tn("dash.freshMonth", noMes, { month: mes })) + " · " + escapeHtml(quando);
    linha.hidden = false;
    if (head) head.hidden = false;
  })();

  (function renderRecentes() {
    const sec = document.getElementById("dhRecent");
    const head = document.getElementById("dhRecentHead");
    if (!sec) return;
    const lista = rawJson("tcg-recent-sets-v1");
    if (!Array.isArray(lista)) return;
    // O pathname gravado é "/detail" em produção (URL bonita) e "/detail.html"
    // no http-server local — as duas formas valem.
    const linhas = lista.filter((r) => r && typeof r.u === "string" && /^\/detail(\.html)?\?/.test(r.u) && r.n).slice(0, 4);
    if (!linhas.length) return;
    sec.innerHTML = linhas.map((r) => {
      const pct = Math.max(0, Math.min(100, Number(r.pct) || 0));
      const cor = shared.GAME_COLOR[r.g] || shared.GAME_COLOR.pokemon;
      // Cor CHAPADA + textOnColor, o mesmo idioma do .game-tag/.dash-game-chip:
      // texto colorido sobre o painel falharia contraste nos jogos claros.
      const fg = shared.textOnColor(cor);
      return `<a class="dash-recent-card" href="${escapeAttribute(r.u)}">
        <span class="dash-recent-top">
          <span class="dash-recent-game" style="--gc:${cor};--gc-fg:${fg}">${escapeHtml(shared.gameLabel(r.g))}</span>
          <strong>${escapeHtml(r.n)}</strong>
        </span>
        <div class="progress-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeAttribute(t("progress.aria", { name: r.n }))}">
          <span style="width: ${pct}%"></span>
        </div>
        <span class="dash-recent-count">${Number(r.own) || 0}/${Number(r.tot) || 0} · ${pct}%</span>
      </a>`;
    }).join("");
    sec.hidden = false;
    if (head) head.hidden = false;
  })();

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
    // Listas: linhas com marcador — o oposto visual do binder/deck (que são
    // cartas), porque a lista é justamente a visão sem imagem.
    lists: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h12"/><path d="M8 12h12"/><path d="M8 18h12"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/></svg>',
    // Troca: duas setas em sentidos opostos (dou ⇄ recebo).
    trade: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h13"/><path d="m14 4 3 3-3 3"/><path d="M20 17H7"/><path d="m10 14-3 3 3 3"/></svg>'
  };
  const soldTotal = shared.readSoldList().length;
  const links = [
    { href: "collection", icon: "collection", key: "nav.collectionMine", stat: tn("count.cards", counts.distinct) },
    { href: "graded", icon: "graded", key: "nav.graded", stat: tn("dash.slabsCount", slabs) },
    { href: "wishlist", icon: "wishlist", key: "nav.wishlist", stat: tn("dash.wishCount", wishTotal) },
    { href: "binders", icon: "binders", key: "nav.binders", stat: "" },
    { href: "my-decks", icon: "decks", key: "nav.myDecks", stat: t("dash.decksHint") },
    { href: "listas", icon: "lists", key: "nav.lists", stat: t("dash.listsHint") },
    { href: "sales", icon: "sales", key: "nav.sales", stat: tn("dash.salesCount", salesCount()) + (soldTotal ? ` · ${tn("dash.soldCount", soldTotal)}` : "") },
    { href: "troca", icon: "trade", key: "trade.title", stat: t("dash.tradeHint") },
    { href: "badges", icon: "badges", key: "dash.badges", stat: t("dash.badgesHint") }
    // Explorar, Jogos e Portfólio saíram daqui: já são itens fixos do menu do
    // header, então repetir na dashboard era redundante. O patrimônio continua
    // no cartão grande lá em cima, que também leva ao Portfólio.
  ];
  el.links.innerHTML = links.map((l) =>
    `<a class="dash-link" href="${escapeAttribute(l.href)}">
      <span class="dash-link-ic" aria-hidden="true">${IC[l.icon]}</span>
      <span class="dash-link-body"><strong>${escapeHtml(t(l.key))}</strong>${l.stat ? `<span>${escapeHtml(l.stat)}</span>` : ""}</span>
      <span class="dash-link-go" aria-hidden="true">→</span>
    </a>`).join("");

  // ── Cápsulas detalhadas (hidratam depois; só as cartas que você tem) ───────
  // Mesmo visual da antiga dashboard da Coleção (que ficou só com os stats):
  // Mais valiosas (top 3 por valor unitário) + distribuição por jogo e região.
  // Inclui os ids em slab (ver shared.collectionLoadIds): quem tem só cartas
  // graduadas — raw zerada — não tinha carta nenhuma pra carregar aqui e ficava
  // com o valor congelado do cookie pra sempre.
  const idsByGame = shared.collectionLoadIds(ownedByGame);
  if (!Object.values(idsByGame).some((ids) => ids.length)) return;
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
    if (!myCards.length && !shared.gradedCardIds().length) return;

    // Vintage no "Por jogo": conta agora (a regra precisa da carta), guarda
    // pro próximo primeiro paint e redesenha só se o número mudou.
    const vintageAgora = myCards.filter(shared.isVintageCard).length;
    if (vintageAgora !== vintageN) {
      vintageN = vintageAgora;
      try { localStorage.setItem(VINTAGE_CACHE, JSON.stringify({ n: vintageN, t: Date.now() })); } catch (e) { /* conveniência */ }
      buildDist();
      renderGames();
    }

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

    // Mais valiosas: top 6 por valor unitário, em grade 3×2 com a imagem
    // grande (é o card que mais se olha), nome e valor — o set vai no title.
    // A variante MAIS VALIOSA entre as que você tem, não a primeira da lista:
    // quem tem a Normal e a Foil era rankeado pela Normal, e o "top" daqui
    // discordava do da tabela do Portfólio (que ranqueia por lote).
    const top = myCards.map((card) => {
      const minhas = shared.cardVariants(card).filter((v) => owned.variantTotal(card.id, v) > 0);
      const val = minhas.reduce((max, v) => Math.max(max, shared.cardValue(card, v, prices).value || 0), 0);
      return { card, val };
    }).filter((x) => x.val > 0).sort((a, b) => b.val - a.val).slice(0, 6);
    el.topList.innerHTML = top.length
      ? top.map(({ card, val }) => {
          const src = shared.cardImageSources(card);
          const thumb = shared.localizedImg(src.url, { alt: "", fallback: src.fallback, loading: "lazy", thumb: true });
          return `<li><a href="${escapeAttribute(shared.detailUrl("set", card.set, "", card.game, { card: card.id, setId: card.setId }))}" title="${escapeAttribute(`${card.name} · ${card.set}`)}"><span class="dash-top-thumb">${thumb}</span>
            <strong>${escapeHtml(card.name)}</strong>
            <span class="dash-top-val">${escapeHtml(shared.formatMoney(shared.getCurrency(), val))}</span></a></li>`;
        }).join("")
      : `<li class="dash-empty">${escapeHtml(t("dash.empty"))}</li>`;

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

    el.top.hidden = false;
    el.dist.hidden = false;
  }).catch(() => { /* rede: o resto do dashboard já está renderizado */ });
})();
