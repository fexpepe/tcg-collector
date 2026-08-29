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
    caps: document.getElementById("dhCaps"),
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

  // ── Distribuição por marca (chips) ─────────────────────────────────────────
  const dist = shared.GAME_SLUGS
    .map((g) => ({ g, n: distinctOf(g) }))
    .filter((x) => x.n > 0);
  el.games.innerHTML = dist.length
    ? dist.map(({ g, n }) =>
        // CHAPADO na cor do jogo, mesmo idioma visual do .game-tag da Coleção:
        // cor cheia, canto reto, texto escolhido por textOnColor (que garante
        // 4.5:1 nos 12 jogos, inclusive nos claros como o prata do DBFW).
        //
        // O "véu" da contagem é o INVERSO do texto, não uma cor fixa: sobre um
        // jogo escuro escurece (e o texto branco ganha contraste), sobre um jogo
        // claro clareia (e o texto preto ganha). Um rgba(0,0,0,…) fixo faria a
        // contagem sumir justamente nos jogos claros.
        // ?filter=<jogo>: o chip leva pra Coleção JÁ FILTRADA naquele jogo.
        // Clicar em "Lorcana · 42" e cair numa Coleção em "Todos" obrigava a
        // pessoa a refazer na mão o filtro que ela acabou de escolher.
        ((cor, fg) =>
          `<a class="dash-game-chip" href="collection?filter=${escapeAttribute(g)}" style="--gc:${cor};--gc-fg:${fg};--gc-veil:${fg === "#000000" ? "rgba(255,255,255,.5)" : "rgba(0,0,0,.26)"}">
            <span class="dash-game-name">${escapeHtml(shared.gameLabel(g))}</span>
            <span class="dash-game-count">${n}</span>
          </a>`
        )(shared.GAME_COLOR[g] || shared.GAME_COLOR.pokemon,
          shared.textOnColor(shared.GAME_COLOR[g] || shared.GAME_COLOR.pokemon))).join("")
    : `<p class="empty-state">${escapeHtml(t("dash.empty"))}</p>`;

  // ── Atalhos (HUB) ───────────────────────────────────────────────────────────
  const IC = {
    collection: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="12" height="16" rx="2" transform="rotate(-8 10 14)"/><rect x="9" y="4" width="12" height="16" rx="2" transform="rotate(6 15 12)"/></svg>',
    graded: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><rect x="8" y="8" width="8" height="10" rx="1"/><path d="M8 5.5h8"/></svg>',
    wishlist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 8.6c0-2.5-2-4.6-4.5-4.6-1.9 0-3.5 1.1-4.3 2.8-.8-1.7-2.4-2.8-4.3-2.8C5.2 4 3.2 6.1 3.2 8.6c0 5 8.8 10.4 8.8 10.4s8.8-5.4 8.8-10.4Z"/></svg>',
    binders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>',
    sales: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-5L9 3 4 7H3v13h17V7Z"/><path d="M12 11v5"/><path d="M9.5 13.5h5"/></svg>',
    portfolio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18"/><path d="m4 15 5-6 4 3 6-8"/></svg>',
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
    { href: "portfolio", icon: "portfolio", key: "nav.portfolio", stat: pf != null ? shared.formatMoney(shared.getCurrency(), pf) : "" },
    { href: "badges", icon: "badges", key: "dash.badges", stat: t("dash.badgesHint") }
    // Explorar e Jogos saíram daqui: já são itens fixos do menu do header, então
    // repetir na dashboard era redundante.
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

    // Mais valiosas (top 3 por valor unitário, como era na Coleção)
    // A variante MAIS VALIOSA entre as que você tem, não a primeira da lista:
    // quem tem a Normal e a Foil era rankeado pela Normal, e o "top" daqui
    // discordava do da tabela do Portfólio (que ranqueia por lote).
    const top = myCards.map((card) => {
      const minhas = shared.cardVariants(card).filter((v) => owned.variantTotal(card.id, v) > 0);
      const val = minhas.reduce((max, v) => Math.max(max, shared.cardValue(card, v, prices).value || 0), 0);
      return { card, val };
    }).filter((x) => x.val > 0).sort((a, b) => b.val - a.val).slice(0, 3);
    el.topList.innerHTML = top.length
      ? top.map(({ card, val }) => {
          const src = shared.cardImageSources(card);
          const thumb = shared.localizedImg(src.url, { alt: "", fallback: src.fallback, loading: "lazy", thumb: true });
          return `<li><a href="${escapeAttribute(shared.detailUrl("set", card.set, "", card.game, { card: card.id, setId: card.setId }))}"><span class="dash-top-thumb">${thumb}</span>
            <span class="dash-top-info"><strong>${escapeHtml(card.name)}</strong><span class="dash-top-set">${escapeHtml(card.set)}</span></span>
            <span class="dash-top-val">${escapeHtml(shared.formatMoney(shared.getCurrency(), val))}</span></a></li>`;
        }).join("")
      : `<li class="dash-empty">${escapeHtml(t("dash.empty"))}</li>`;

    // A "Distribuição por jogo" que morava aqui saiu (proposta de 2026-08-25):
    // era a MESMA contagem da fileira de chips #dhGames, repetida na tela.

    // Distribuição por região/idioma (flag SVG como na Coleção)
    const byRegion = {};
    myCards.forEach((card) => { const r = shared.cardLanguageRegion(card.language); byRegion[r] = (byRegion[r] || 0) + 1; });
    const regions = [
      { region: "english", lang: "en", color: "#2aa3df" },
      { region: "japanese", lang: "ja", color: "#d23b4e" },
      { region: "portuguese", lang: "pt", color: "#1f9d77" },
      { region: "chinese", lang: "zh", color: "#e0992f" }
    ];
    el.region.innerHTML = shared.distBarsHtml(regions.map((r) => ({
      label: `${shared.cardFlag(r.lang)}<span>${escapeHtml(t("setRegion." + r.region).replace(/\s*\(.*/, ""))}</span>`,
      n: byRegion[r.region] || 0, color: r.color
    })));

    el.caps.hidden = false;
  }).catch(() => { /* rede: o resto do dashboard já está renderizado */ });
})();
