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
    // Versão "Carteira" (2026-10-08): cartas × graded embaixo do número e a
    // composição do patrimônio por jogo ao lado.
    split: document.getElementById("dhSplit"),
    delta: document.getElementById("dhDelta"),
    movers: document.getElementById("dhMovers"),
    alloc: document.getElementById("dhAlloc"),
    allocBar: document.getElementById("dhAllocBar"),
    allocList: document.getElementById("dhAllocList")
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
  // Desejos e slabs saíram da faixa de números na revisão da "Carteira"
  // (2026-10-08): o número mora no subtítulo do atalho deles.
  if (el.wish) el.wish.textContent = String(wishTotal);
  const slabs = gradedCount();
  if (el.slabs) el.slabs.textContent = String(slabs);
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
    val.textContent = `${captured}/${p ? p.t : 1025}`;
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
    // Na faixa de números: "+61" grande e "cartas entraram em outubro"
    // embaixo; o "a última hoje" vai no title (não cabe na faixa).
    num.textContent = "+" + noMes.toLocaleString(shared.getLocale());
    linha.textContent = tn("dash.freshMonth", noMes, { month: mes });
    cartao.title = quando;
    cartao.hidden = false;
  })();

  // Carimbo de cada carta (meta.mod, ms): desempata a vitrine da Minha Coleção
  // quando falta preço (a mexida mais recente vem antes). Lido uma vez por jogo.
  const modPorJogo = {};
  const modOf = (card) => {
    const g = card.game || "pokemon";
    if (!(g in modPorJogo)) {
      const meta = rawJson(`tcg-collector-${g}-collection-meta-v1`);
      modPorJogo[g] = meta && meta.mod && typeof meta.mod === "object" ? meta.mod : {};
    }
    return Number(modPorJogo[g][card.id]) || 0;
  };

  // ── Onde está o valor (versão "Carteira") ──────────────────────────────────
  // A composição do patrimônio por jogo, em DINHEIRO (o "Por jogo" lá embaixo
  // conta cartas). O primeiro paint sai do último ponto do histórico de cada
  // jogo — o mesmo retrato que já pinta o número grande, sem rede —, e a
  // hidratação troca pela conta fresca. Barra empilhada + as cinco maiores
  // fatias; seis ou mais jogos juntam o resto numa linha "mais N jogos".
  const money = (v) => shared.formatMoney(shared.getCurrency(), v);
  function renderAlloc(porJogo) {
    if (!el.alloc) return;
    const rows = porJogo.filter((x) => x.val > 0).sort((a, b) => b.val - a.val);
    const total = rows.reduce((n, x) => n + x.val, 0);
    if (!total) { el.alloc.hidden = true; return; }
    const pct = (v) => {
      const p = (v / total) * 100;
      return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
    };
    const linha = (x) => `<li><a class="hb-alloc-row" href="collection?filter=${escapeAttribute(x.g)}">
        <span class="hb-dot" style="background:${x.cor}"></span>
        <span class="hb-alloc-name">${escapeHtml(x.label)}</span>
        <span class="hb-alloc-n">${escapeHtml(tn("count.cards", x.n))}</span>
        <span class="hb-alloc-pct">${pct(x.val)}</span>
        <span class="hb-alloc-val hb-money sensitive-value">${escapeHtml(money(x.val))}</span></a></li>`;
    // 4 fatias + "mais N jogos": o patrimônio divide o topo com os atalhos,
    // então a lista é a versão condensada.
    const MAX = 4;
    const vis = rows.length > MAX + 1 ? rows.slice(0, MAX) : rows;
    const resto = rows.slice(vis.length);
    const restoVal = resto.reduce((n, x) => n + x.val, 0);
    el.allocBar.innerHTML = rows.map((x) =>
      `<span style="flex-grow:${(x.val / total).toFixed(4)};background:${x.cor}" title="${escapeAttribute(`${x.label} · ${pct(x.val)}`)}"></span>`).join("");
    el.allocList.innerHTML = vis.map(linha).join("") + (resto.length
      ? `<li><a class="hb-alloc-row hb-alloc-rest" href="collection">
          <span class="hb-dot"></span>
          <span class="hb-alloc-name">${escapeHtml(tn("dash.a.moreGames", resto.length))}</span>
          <span class="hb-alloc-n"></span>
          <span class="hb-alloc-pct">${pct(restoVal)}</span>
          <span class="hb-alloc-val hb-money sensitive-value">${escapeHtml(money(restoVal))}</span></a></li>`
      : "");
    el.alloc.hidden = false;
  }
  // Cartas R$ X · Graded R$ Y embaixo do número: o "(cartas + graded)" do
  // rótulo antigo, agora com os dois valores. Graded zerado não aparece.
  function renderSplit(raw, graded) {
    if (!el.split) return;
    if (!(raw > 0) || !(graded > 0)) { el.split.hidden = true; return; }
    el.split.innerHTML = `${escapeHtml(t("dash.a.cards"))} <strong class="sensitive-value">${escapeHtml(money(raw))}</strong>`
      + ` · ${escapeHtml(t("dash.a.graded"))} <strong class="sensitive-value">${escapeHtml(money(graded))}</strong>`;
    el.split.hidden = false;
  }
  // Variação do patrimônio em ~7 dias, em TEXTO (a sparkline que saiu em
  // 2026-08-25 não volta). A base é o histórico do Portfólio: por jogo, o
  // último ponto com data até 7 dias atrás (jogo que ainda não existia conta
  // zero — o que entrou depois É crescimento do patrimônio). Sem ponto tão
  // velho, vale o mais antigo, desde que tenha 2 dias ou mais: com menos, a
  // "variação" seria só a carga de hoje contra a de ontem à noite.
  const DIA = 86400000;
  function renderDelta(agora) {
    if (!el.delta) return;
    const hojeMs = Date.parse(new Date().toISOString().slice(0, 10));
    const hists = shared.GAME_SLUGS.map((g) => shared.valueHistory(g)).filter((h) => h.length);
    const datas = hists.map((h) => h[0].d).sort();
    if (!datas.length) return;
    const alvo = new Date(hojeMs - 7 * DIA).toISOString().slice(0, 10);
    const base = datas[0] <= alvo ? alvo : datas[0];
    const dias = Math.round((hojeMs - Date.parse(base)) / DIA);
    let antes = 0;
    hists.forEach((h) => {
      for (let i = h.length - 1; i >= 0; i--) {
        if (h[i].d <= base) { antes += (Number(h[i].c) || 0) + (Number(h[i].b) || 0); break; }
      }
    });
    antes = shared.moneyToCurrent(antes, "BRL");
    const dif = agora - antes;
    const pctTxt = antes > 0 ? ` (${dif >= 0 ? "+" : "−"}${Math.abs((dif / antes) * 100).toLocaleString(shared.getLocale(), { maximumFractionDigits: 1 })}%)` : "";
    if (dias < 2 || !(antes > 0) || Math.abs(dif) < 0.01) { el.delta.hidden = true; return; }
    const sobe = dif > 0;
    el.delta.className = `hb-delta hb-money ${sobe ? "is-up" : "is-down"}`;
    el.delta.innerHTML = `<span class="sensitive-value">${sobe ? "▲" : "▼"} ${sobe ? "+" : "−"}${escapeHtml(money(Math.abs(dif)))}</span>${escapeHtml(pctTxt)} <small>${escapeHtml(tn("dash.a.inDays", dias))}</small>`;
    el.delta.hidden = false;
  }
  const corDe = (g) => shared.GAME_COLOR[g] || shared.GAME_COLOR.pokemon;
  (function allocInstantaneo() {
    let raw = 0, graded = 0;
    const porJogo = shared.GAME_SLUGS.map((g) => {
      const h = shared.valueHistory(g);
      const p = h.length ? h[h.length - 1] : null;
      const c = p ? shared.moneyToCurrent(Number(p.c) || 0, "BRL") : 0;
      const b = p ? shared.moneyToCurrent(Number(p.b) || 0, "BRL") : 0;
      raw += c; graded += b;
      return { g, label: shared.gameLabel(g), cor: corDe(g), n: distinctOf(g), val: c + b };
    });
    renderAlloc(porJogo);
    renderSplit(raw, graded);
    renderDelta(raw + graded);
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
  // Versão "Carteira": azulejo de ícone (o "→" de texto saiu — a regra da casa
  // é ícone em SVG). No desktop é ícone + nome + subtítulo em linha; no
  // celular vira grade de 4 com o ícone em cima e só o nome (styles.css, hb-).
  const linkInner = (l) => `<span class="hb-app-ic" aria-hidden="true">${IC[l.icon]}</span>
      <span class="hb-app-body"><strong>${escapeHtml(t(l.key))}</strong>${l.stat ? `<span>${escapeHtml(l.stat)}</span>` : ""}</span>`;
  const linkHtml = (l) => `<a class="hb-app" href="${escapeAttribute(l.href)}">${linkInner(l)}</a>`;
  // HTML velho em cache (sem a seção #dhTools) com este JS: as ferramentas
  // voltam pro fim do "Ir para" em vez de sumir do HUB.
  el.links.innerHTML = (el.tools ? links : links.concat(tools)).map(linkHtml).join("");
  if (el.tools) el.tools.innerHTML = tools.map(linkHtml).join("");

  // ── Cápsulas detalhadas (hidratam depois; só as cartas que você tem) ───────
  // Mesmo visual da antiga dashboard da Coleção (que ficou só com os stats):
  // Mais valiosas (top 3 por valor unitário) + distribuição por jogo e região.
  // Inclui os ids em slab (ver shared.collectionLoadIds): quem tem só cartas
  // graduadas — raw zerada — não tinha carta nenhuma pra carregar aqui e ficava
  // com o valor congelado do cookie pra sempre.
  const idsByGame = shared.collectionLoadIds(ownedByGame);
  if (!Object.values(idsByGame).some((ids) => ids.length)) return;
  // A vitrine da Minha Coleção guarda o lugar com cartas fantasma enquanto a
  // carga anda: aparecer do nada logo abaixo do patrimônio empurraria o resto
  // da página. Se a carga falhar, ela some. 7 cartas + o azulejo "+N" = uma
  // fileira de 8 no desktop.
  const TOP_N = 7;
  el.topList.innerHTML = Array.from({ length: TOP_N }, () =>
    '<li class="hb-skel" aria-hidden="true"><span class="hb-card-img skel-img"></span><span class="skel-line"></span><span class="skel-line short"></span></li>').join("");
  el.top.hidden = false;
  const someTop = () => { el.top.hidden = true; el.topList.innerHTML = ""; };
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
    if (!myCards.length && !shared.gradedCardIds().length) { someTop(); return; }

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
    // A mesma conta por jogo alimenta o histórico E a composição do topo — duas
    // somas separadas divergiriam (a regra do patrimônio: uma fórmula só).
    const valoresPorJogo = shared.GAME_SLUGS.map((g) => {
      const linhas = shared.collectionValueLines(myCards, owned, prices, { gameFilter: g });
      return { g, raw: linhas.total, graded: shared.gradedTotalValue(gameOf, g), priced: linhas.pricedCopies, copies: linhas.totalCopies };
    });
    if (!catalog.parcial) {
      shared.recordValueSnapshot(Object.fromEntries(valoresPorJogo.map((x) => [x.g, {
        raw: x.raw, graded: x.graded, priced: x.priced, copies: x.copies
      }])));
    }
    renderAlloc(valoresPorJogo.map((x) => ({ g: x.g, label: shared.gameLabel(x.g), cor: corDe(x.g), n: distinctOf(x.g), val: x.raw + x.graded })));
    renderSplit(valoresPorJogo.reduce((n, x) => n + x.raw, 0), valoresPorJogo.reduce((n, x) => n + x.graded, 0));
    if (patrimonio > 0) renderDelta(patrimonio);

    // Mexeram na sua coleção (7 dias): o price-deltas-7d de cada jogo em que
    // você tem carta (o mesmo arquivo do "Ordenar por variação" e do aviso de
    // queda da Lista de Desejos), cruzado com as SUAS cartas. Ordena pelo
    // efeito no seu lote em dinheiro, não pela %: a carta de R$ 0,50 que
    // dobrou não passa na frente da de R$ 400 que subiu 5%. O efeito é exato
    // (valor de hoje × p/(100+p)), não o valor × p do Portfólio.
    const jogosMeus = shared.unique(myCards.map((c) => c.game));
    Promise.all(jogosMeus.map((g) => shared.loadPriceDeltas7d(g).then((d) => [g, d]).catch(() => [g, null]))).then((lista) => {
      const pct = new Map();
      lista.forEach(([g, d]) => { if (d && d.c) Object.keys(d.c).forEach((id) => pct.set(`${g}|${id}`, Number(d.c[id]) || 0)); });
      const linhas = myCards.map((card) => {
        const p = pct.get(`${card.game}|${card.id}`);
        if (!p) return null;
        const lote = shared.cardVariants(card).reduce((n, v) => n + (shared.cardValue(card, v, prices).value || 0) * owned.variantTotal(card.id, v), 0);
        return { card, p, chg: (lote * p) / (100 + p) };
      }).filter((x) => x && Math.abs(x.chg) >= 0.01);
      const ups = linhas.filter((x) => x.chg > 0).sort((a, b) => b.chg - a.chg).slice(0, 3);
      const downs = linhas.filter((x) => x.chg < 0).sort((a, b) => a.chg - b.chg).slice(0, 3);
      if (!el.movers || (!ups.length && !downs.length)) return;
      const loc = shared.getLocale();
      const linha = ({ card, p, chg }) => {
        const src = shared.cardImageSources(card);
        const thumb = shared.localizedImg(src.url, { alt: "", fallback: src.fallback, loading: "lazy", thumb: true });
        const sobe = chg > 0;
        return `<li><a class="hb-mv" href="${escapeAttribute(shared.detailUrl("set", card.set, "", card.game, { card: card.id, setId: card.setId }))}">
          <span class="hb-mv-img">${thumb}</span>
          <span class="hb-mv-info"><strong>${escapeHtml(card.name)}</strong><span>${escapeHtml(shared.dotJoin(card.set, card.number))}</span></span>
          <span class="hb-mv-chg ${sobe ? "is-up" : "is-down"}"><span class="sensitive-value">${sobe ? "+" : "−"}${escapeHtml(money(Math.abs(chg)))}</span><small>${sobe ? "▲" : "▼"} ${Math.abs(p).toLocaleString(loc, { maximumFractionDigits: 1 })}%</small></span></a></li>`;
      };
      document.getElementById("dhMvUp").innerHTML = ups.map(linha).join("");
      document.getElementById("dhMvDown").innerHTML = downs.map(linha).join("");
      // Coluna vazia (nada caiu) some com o título, e a outra ocupa a largura.
      document.getElementById("dhMvUp").parentElement.hidden = !ups.length;
      document.getElementById("dhMvDown").parentElement.hidden = !downs.length;
      el.movers.hidden = false;
    });

    // Minha Coleção: as cartas PRINCIPAIS em vitrine (imagem grande, nome e
    // valor — o set vai no title). Principal = a de maior valor; sem preço, a
    // mexida mais recente (carimbo meta.mod), pra quem não usa preço também
    // ver a coleção aqui. No desktop é uma fileira; no celular, um trilho que
    // rola de lado (o padrão do Collectr). O último azulejo é o "+N cartas",
    // que leva à Coleção.
    // A variante MAIS VALIOSA entre as que você tem, não a primeira da lista:
    // quem tem a Normal e a Foil era rankeado pela Normal, e o "top" daqui
    // discordava do da tabela do Portfólio (que ranqueia por lote).
    const top = myCards.map((card) => {
      const minhas = shared.cardVariants(card).filter((v) => owned.variantTotal(card.id, v) > 0);
      const val = minhas.reduce((max, v) => Math.max(max, shared.cardValue(card, v, prices).value || 0), 0);
      return { card, val, mod: modOf(card) };
    }).sort((a, b) => b.val - a.val || b.mod - a.mod).slice(0, TOP_N);
    if (!top.length) someTop();
    else {
      const resto = Math.max(0, counts.distinct - top.length);
      el.topList.innerHTML = top.map(({ card, val }) => {
        const src = shared.cardImageSources(card);
        const thumb = shared.localizedImg(src.url, { alt: "", fallback: src.fallback, loading: "lazy", thumb: true });
        return `<li><a class="hb-card" href="${escapeAttribute(shared.detailUrl("set", card.set, "", card.game, { card: card.id, setId: card.setId }))}" title="${escapeAttribute(`${card.name} · ${card.set}`)}"><span class="hb-card-img">${thumb}</span>
            <strong>${escapeHtml(card.name)}</strong>
            ${val > 0 ? `<span class="hb-card-val hb-money sensitive-value">${escapeHtml(money(val))}</span>` : ""}</a></li>`;
      }).join("") + (resto > 0
        ? `<li><a class="hb-card hb-card-more" href="collection"><span class="hb-card-img"><strong>+${resto.toLocaleString(shared.getLocale())}</strong><span>${escapeHtml(tn("dash.a.cardsWord", resto))}</span></span>
            <strong>${escapeHtml(t("dash.a.seeCollection"))}</strong></a></li>`
        : "");
    }

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

    el.dist.hidden = false;
  }).catch(() => { someTop(); /* rede: o resto do dashboard já está renderizado */ });
})();
