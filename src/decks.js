// Construtor de decks (my-decks.html). Uma página, duas vistas:
//   sem ?id=  -> galeria dos meus decks
//   com ?id=  -> editor daquele deck
// (mesmo padrão do binders.html). As REGRAS de cada jogo vivem em deck-rules.js;
// aqui fica o store, a UI e o cálculo de valor. Ver docs/DECKS.md.
(function () {
  "use strict";
  const shared = window.TCGShared;
  const rules = window.TCGDeckRules;
  if (!shared || !rules) return;
  const t = shared.t;
  const esc = shared.escapeHtml;
  const escA = shared.escapeAttribute;

  // ---------------------------------------------------------------------------
  // Store — GLOBAL (cross-game), igual aos binders: uma lista só, cada deck
  // carrega o próprio `game`. Entra de graça no sync da nuvem depois.
  // ---------------------------------------------------------------------------
  const STORAGE_KEY = "tcg-collector-decks-all-v1";

  function readData() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.decks)) {
        if (!parsed.deleted || typeof parsed.deleted !== "object") parsed.deleted = {};
        return parsed;
      }
    } catch (e) { /* corrompido: começa limpo */ }
    return { decks: [], deleted: {} };
  }
  // `deleted` = tombstones (id -> quando foi apagado). O sync na nuvem precisa
  // deles: sem tombstone, um deck apagado no celular volta do PC no próximo
  // merge (a união por id não sabe distinguir "não existe" de "foi apagado").
  const data = readData();

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      // Cota estourada: avisa em vez de perder o deck em silêncio.
      if (shared.notifyStorageFull) shared.notifyStorageFull();
      else alert(t("decks.storageFull"));
      return false;
    }
  }

  function newId() {
    return "dk_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }
  function list() { return data.decks; }
  function getDeck(id) { return data.decks.find((d) => d.id === id); }

  function createDeck(game, format, name) {
    const pack = rules.packFor(game, format);
    const zones = {};
    (pack.zones || []).forEach((z) => { zones[z.key] = []; });
    const deck = {
      id: newId(), game: game, format: format || null, name: name || t("decks.untitled"),
      zones: zones, createdAt: Date.now(), updatedAt: Date.now()
    };
    data.decks.unshift(deck);
    save();
    return deck;
  }
  // Pacote do deck (jogo + formato) — um lugar só, pra não esquecer o formato.
  function packOf(deck) { return rules.packFor(deck.game, deck.format); }

  function touch(deck) { deck.updatedAt = Date.now(); save(); }

  // ---------------------------------------------------------------------------
  // Helpers de deck
  // ---------------------------------------------------------------------------
  function allEntries(deck) {
    return Object.keys(deck.zones || {}).flatMap((k) => (deck.zones[k] || []).map((e) => ({ zone: k, entry: e })));
  }
  function totalCards(deck) {
    return allEntries(deck).reduce((s, x) => s + (x.entry.qty || 0), 0);
  }
  function deckCardIds(deck) {
    return [...new Set(allEntries(deck).map((x) => x.entry.id))];
  }

  // Soma/subtrai cópias de uma carta numa zona. qty<=0 remove a entrada.
  function addCard(deck, zoneKey, card, delta) {
    deck.zones[zoneKey] = deck.zones[zoneKey] || [];
    const arr = deck.zones[zoneKey];
    const found = arr.find((e) => e.id === card.id);
    if (found) {
      found.qty = (found.qty || 0) + delta;
      if (found.qty <= 0) arr.splice(arr.indexOf(found), 1);
    } else if (delta > 0) {
      arr.push({ id: card.id, qty: delta, variant: shared.defaultVariant(card) });
    }
    if (!deck.coverCardId && delta > 0) deck.coverCardId = card.id;
    touch(deck);
  }

  // Adiciona 1 cópia — SEMPRE. Quando a jogada sai do comum (2º comandante,
  // cópia além do limite, zona cheia) a carta é adicionada e o aviso aparece:
  // barrar era pior, porque o Magic tem carta que autoriza justamente isso
  // (Partner, Relentless Rats) e o site brigava com quem estava certo. O painel
  // de validação continua descrevendo o deck pronto.
  // `alvo` é o elemento que recebe o destaque (o resultado da busca ou a carta
  // já no deck); o motivo vai no title, então quem parar o mouse lê o porquê.
  function tryAdd(deck, zoneKey, card, alvo) {
    const r = rules.canAdd(deck, zoneKey, card, cat.byId);
    addCard(deck, zoneKey, card, 1);
    if (!r.warn) return true;
    // A zona vai traduzida ("Principal"), não com a chave crua ("main").
    const vals = Object.assign({}, r.warn.vals || {});
    if (vals.zone) vals.zone = t("decks.zone." + vals.zone);
    const motivo = t("decks.blocked." + r.warn.code, vals);
    if (alvo) {
      alvo.classList.remove("deck-warned");
      void alvo.offsetWidth;              // reinicia a animação em cliques seguidos
      alvo.classList.add("deck-warned");
      alvo.setAttribute("title", motivo);
      setTimeout(() => alvo.classList.remove("deck-warned"), 1400);
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Catálogo do jogo do deck (pode ser != do jogo da sessão). Cache em memória
  // por jogo: reabrir o editor no mesmo jogo não baixa de novo.
  // ---------------------------------------------------------------------------
  // Cartas COMPLETAS já carregadas, por jogo. Nunca baixa o catálogo inteiro: só
  // os chunks dos sets das cartas pedidas (loadGameCatalog com ids). Yu-Gi-Oh!
  // tem 46k cartas e Magic 97k — baixar tudo pra abrir um deck de 60 era inviável.
  const catalogCache = {};
  async function ensureCards(game, ids) {
    const entry = catalogCache[game] || (catalogCache[game] = { byId: {}, all: false });
    if (entry.all) return entry;
    const need = ids ? ids.filter((id) => !entry.byId[id]) : null;
    if (ids && !need.length) return entry;                    // tudo em cache
    const r = await shared.loadGameCatalog(game, shared.gameDataDir(game), need);
    (r.cards || []).forEach((c) => { c.game = game; entry.byId[c.id] = c; });
    if (!ids) entry.all = true;
    // cardValue lê window.TCG_PRICING; loadGameCatalog restaura o da sessão, então
    // mescla o do jogo do deck pra o preço não sair zerado.
    if (r.pricing) window.TCG_PRICING = Object.assign({}, window.TCG_PRICING || {}, r.pricing);
    return entry;
  }

  // Índice de busca: só id/nome/set/número + facetas (gerado no build por
  // writeGameCatalog). É o que permite buscar no jogo inteiro sem baixá-lo.
  // Cacheia a PROMESSA (não o resultado): o download em segundo plano e um
  // await do fallback no meio dele não podem baixar o índice duas vezes —
  // no Magic são 8 MB cada.
  const indexCache = {};
  const indexReady = {};   // jogo -> true quando o índice JÁ está na memória
  function searchIndexFor(game) {
    if (indexCache[game]) return indexCache[game];
    const p = (async () => {
      try {
        const r = await fetch(shared.gameDataDir(game) + "search-index.json");
        if (r.ok) {
          const raw = await r.json();
          // Formato compacto: { d: dicionários, c: cartas com índices }. Re-expande
          // aqui (uma vez) pra o resto do código ver strings normais.
          const d = raw.d || {};
          const back = (key, i) => (i == null ? "" : ((d[key] || [])[i] || ""));
          return (raw.c || []).map((e) => ({
            i: e.i, n: e.n, u: e.u, c: e.c,
            s: back("s", e.s), t: back("t", e.t), r: back("r", e.r), k: back("k", e.k)
          }));
        }
      } catch (e) { /* sem índice: cai no fallback abaixo */ }
      // Local/dev (o índice é gerado no build): monta a partir do catálogo, que
      // aqui é a amostra pequena. Mesma forma de dado, então a busca não sabe a
      // diferença.
      const cat = await ensureCards(game, null);
      return Object.values(cat.byId).map((c) => ({
        i: c.id, n: c.name, s: c.set, u: c.number,
        t: c.cardType, c: c.cost, r: c.rarity,
        k: c.ink || c.opColor || c.color || c.colorId || c.types || c.attribute
      }));
    })();
    indexCache[game] = p;
    p.then(
      () => { indexReady[game] = true; },
      () => { if (indexCache[game] === p) delete indexCache[game]; }  // erro: a próxima busca tenta de novo
    );
    return p;
  }

  // A busca na borda em si (shared.searchApi) é compartilhada com o Explorar:
  // mesmos campos do índice, mesma regra de desligar no primeiro não-ok.

  // Dispara o download do índice SEM esperar por ele; quando chegar, liga a UI
  // de facetas (as opções saem do índice inteiro — a API não as fornece).
  function preloadIndexFor(game) {
    searchIndexFor(game).then((idx) => {
      if (!current || current.game !== game) return;
      const had = !!facetOptsCache[game];
      facetOptions(game, idx);
      const fbox = document.getElementById("deckFacets");
      if (fbox && !had) fbox.innerHTML = facetsHtml(game);
    }).catch(() => { /* o próximo renderResults reporta o erro se precisar */ });
  }

  // ---------------------------------------------------------------------------
  // Valor: total, o que já tenho e o que falta comprar (o número que importa).
  // ---------------------------------------------------------------------------
  // Stores por jogo, criados UMA vez cada: createCollectionStore/PriceStore leem
  // e parseiam o localStorage inteiro, e isto é chamado por carta a cada render.
  const ownedCache = {}, priceCache = {};
  const ownedFor = (g) => ownedCache[g] || (ownedCache[g] = shared.createCollectionStore(g));
  const pricesFor = (g) => priceCache[g] || (priceCache[g] = shared.createPriceStore(g));

  function computeValue(deck, byId) {
    const owned = ownedFor(deck.game);
    const prices = pricesFor(deck.game);
    let total = 0, have = 0, missing = 0, missingCards = 0, proxyCards = 0;
    allEntries(deck).forEach(({ entry }) => {
      const card = byId[entry.id];
      if (!card) return;
      const variant = entry.variant || shared.defaultVariant(card);
      const unit = (shared.cardValue(card, variant, prices) || {}).value || 0;
      const qty = entry.qty || 0;
      total += qty * unit;
      // Marcada como PROXY: sai da conta de "falta comprar" — é justamente o
      // que a pessoa decidiu NÃO comprar. Continua no total (o deck vale
      // aquilo) e vira uma linha própria no painel.
      if (entry.px) { proxyCards += qty; return; }
      // Posse conta QUALQUER variante: uma Charizard foil joga como Charizard.
      const inColl = owned.totalForCard ? owned.totalForCard(entry.id) : 0;
      const hv = Math.min(qty, inColl);
      have += hv * unit;
      missing += (qty - hv) * unit;
      missingCards += (qty - hv);
    });
    return { total, have, missing, missingCards, proxyCards };
  }
  function ownedCountOf(deck, cardId) {
    const owned = ownedFor(deck.game);
    return owned.totalForCard ? owned.totalForCard(cardId) : 0;
  }

  const money = (v) => shared.formatMoney(shared.getCurrency(), v);

  // ---------------------------------------------------------------------------
  // Vistas
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Página PÚBLICA (decks.html): galeria da comunidade + viewer (?s=<id>).
  // Vive na tabela `shares` que JÁ existe (kind="deck") — sem mudança de banco.
  // Leitura é anônima (RLS de SELECT já era público, o fetchShare dependia
  // disso); publicar/copiar é que exigem conta.
  // ATENÇÃO: título/autor/nomes vêm de USUÁRIO — escapar TUDO ao renderizar.
  // ---------------------------------------------------------------------------
  // Estes helpers de GRÁFICO (cores, curva, barras) precisam viver ANTES do
  // early-return da página pública logo abaixo: o viewer público também os
  // usa, e como o módulo RETORNA cedo em decks.html, qualquer const declarada
  // depois fica em TDZ pra sempre — foi exatamente o crash 'Cannot access
  // inkColor before initialization' que pendurava o deck publicado no
  // "Carregando…".
  // Cor de cada tinta/cor pra pintar a curva e a distribuição. Chave em minúscula
  // porque os catálogos variam ("Amber", "W", "Red"). Fora da tabela cai no
  // accent do tema — jogo novo nunca fica sem cor.
  const INK_HEX = {
    // Lorcana
    amber: "#f0b84b", amethyst: "#a78bfa", emerald: "#34a06a", ruby: "#e05252", sapphire: "#60a5fa", steel: "#9ba4b3",
    // Magic (letras do color identity)
    w: "#efe3bd", u: "#4a9ff0", b: "#7d7f89", r: "#e05252", g: "#34a06a",
    // Bandai/Riot (Digimon, Gundam, DBFW, One Piece)
    red: "#e05252", blue: "#4a9ff0", green: "#34a06a", yellow: "#f0b84b", purple: "#a78bfa",
    black: "#6b7280", white: "#e3e7ee",
    // Pokémon (types)
    fire: "#f0803c", water: "#4a9ff0", grass: "#34a06a", lightning: "#f0c93c", psychic: "#c77dd6",
    fighting: "#c56a3a", darkness: "#5b6270", metal: "#9ba4b3", fairy: "#e77fb3", dragon: "#b8933c", colorless: "#c8ccd4",
    // Buckets sintéticos da curva
    multi: "#d4a017", none: "#4a5160"
  };
  const inkColor = (key) => INK_HEX[String(key || "").toLowerCase()] || "var(--accent)";
  // Rótulo legível: os catálogos trazem valores crus ("Super_rare" no Lorcana,
  // "double_faced" etc.) — underscore vira espaço e a 1ª letra sobe.
  function prettyLabel(key) {
    if (key === "multi") return t("decks.multicolor");
    if (key === "none") return t("decks.colorless");
    const s = String(key || "").replace(/[_-]+/g, " ").trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }
  const inkLabel = prettyLabel;

  // Curva de custo: COLUNAS verticais empilhadas por cor (padrão dos deck
  // builders). Sem lib — altura em % via flex.
  function curveHtml(rows) {
    if (!rows || !rows.length) return "";
    const max = Math.max(...rows.map((r) => r.n)) || 1;
    const cols = rows.map((r) => {
      const stack = (r.parts || []).map((p) =>
        `<span class="deck-cv-seg" style="height:${(p.n / r.n) * 100}%;background:${escA(inkColor(p.key))}" title="${escA(inkLabel(p.key) + ": " + p.n)}"></span>`).join("");
      return `<div class="deck-cv-col">
        <span class="deck-cv-n">${esc(String(r.n))}</span>
        <span class="deck-cv-bar" style="height:${(r.n / max) * 100}%">${stack}</span>
        <span class="deck-cv-x">${esc(r.label)}</span>
      </div>`;
    }).join("");
    return `<div class="deck-an-block"><h4>${esc(t("decks.curve"))}</h4><div class="deck-cv">${cols}</div></div>`;
  }

  // Barras simples (distribuição / raridade). Sem lib: largura em %.
  function barsHtml(title, rows, colored) {
    if (!rows || !rows.length) return "";
    const max = Math.max(...rows.map((r) => r.n)) || 1;
    return `<div class="deck-an-block"><h4>${esc(title)}</h4>` + rows.map((r) => {
      const bg = colored ? `;background:${escA(inkColor(r.label))}` : "";
      return `<div class="deck-bar"><span class="deck-bar-lbl">${esc(inkLabel(r.label))}</span>
        <span class="deck-bar-track"><span class="deck-bar-fill" style="width:${Math.round((r.n / max) * 100)}%${bg}"></span></span>
        <span class="deck-bar-n">${esc(String(r.n))}</span></div>`;
    }).join("") + `</div>`;
  }


  // Declarada ANTES da chamada: initPublicPage roda já na linha de baixo, e um
  // `let` depois dela ficaria em TDZ — a exceção travava o "Carregando…".
  let communityGame = "";                       // filtro ativo ("" = todos)
  // Ordenação da galeria (preferência do usuário, lembrada).
  let communitySort = (function () {
    try {
      const v = localStorage.getItem("tcg-deck-community-sort");
      return ["recent", "cards", "name"].includes(v) ? v : "recent";
    } catch (e) { return "recent"; }
  })();
  const pubBox = document.getElementById("deckCommunity");
  if (pubBox) { initPublicPage(pubBox); return; }

  function initPublicPage(box) {
    const logged = !!(shared.getSession && shared.getSession());
    const sharedId = new URLSearchParams(location.search).get("s");
    if (sharedId) { renderPublicDeck(box, sharedId, logged); return; }
    renderCommunity(box, logged);
  }

  // "por @{author}" com o autor clicável -> perfil público. O marcador \u0001
  // preserva a posição do placeholder em qualquer idioma. Usado só no VIEWER:
  // o card da galeria é um <a> inteiro, e <a> dentro de <a> é HTML inválido.
  function authorHtml(author) {
    const raw = t("decks.byAuthor", { author: "\u0001" });
    const i = raw.indexOf("\u0001");
    const h = String(author).slice(0, 30);
    if (i < 0) return esc(t("decks.byAuthor", { author: h }));
    return `${esc(raw.slice(0, i))}<a class="dkc-author-link" href="/users/${escA(h)}">${esc(h)}</a>${esc(raw.slice(i + 1))}`;
  }

  // Payload de share pode vir adulterado: só aceita o shape v1 e com limites.
  function sanitizeDeckPayload(raw) {
    if (!raw || typeof raw !== "object" || raw.v !== 1) return null;
    const game = shared.normalizeGame(String(raw.game || ""));
    if (!shared.GAME_SLUGS.includes(game)) return null;
    const zones = {};
    let total = 0;
    Object.keys(raw.zones && typeof raw.zones === "object" ? raw.zones : {}).slice(0, 6).forEach((k) => {
      if (!/^[a-z]{1,12}$/.test(k) || !Array.isArray(raw.zones[k])) return;
      zones[k] = raw.zones[k].slice(0, 300).map((e) => ({
        id: String(e && e.id || "").slice(0, 60),
        qty: Math.max(1, Math.min(99, Math.floor(Number(e && e.qty) || 1)))
      })).filter((e) => e.id);
      total += zones[k].reduce((s, e) => s + e.qty, 0);
    });
    if (!total) return null;
    return {
      game, zones, total,
      name: String(raw.name || "").slice(0, 60) || t("decks.untitled"),
      format: raw.format ? String(raw.format).slice(0, 20) : null,
      author: raw.author ? String(raw.author).slice(0, 30) : null
    };
  }

  // ---------- Galeria da comunidade (com filtro por jogo) ----------
  async function renderCommunity(box, logged) {
    box.innerHTML = `<p class="deck-hint">${esc(t("decks.loading"))}</p>`;
    const rows = await shared.listShares("deck", communityGame || null, 60);
    // Visitas dos decks listados, numa chamada só (tabela deck_views). Sem a
    // migration aplicada volta {} — e aí a popularidade simplesmente não existe:
    // o destaque cai pro primeiro da ordem e a opção "mais vistos" não aparece.
    const views = await shared.fetchDeckViews(rows.map((r) => r.id));
    const nViews = (r) => Number(views[r.id]) || 0;
    const temViews = Object.keys(views).length > 0;
    // Ordenação no CLIENTE: a lista vem limitada a 60 do servidor (mais
    // recentes), então reordenar aqui é barato e não gasta round-trip.
    const nCards = (r) => Number(r.total) || 0;
    if (communitySort === "cards") rows.sort((a, b) => nCards(b) - nCards(a));
    else if (communitySort === "name") rows.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
    else if (communitySort === "views") rows.sort((a, b) => nViews(b) - nViews(a));
    // Filtros: chips por jogo — sempre TODOS os jogos com a cor deles (o
    // usuário pediu filtros; jogo sem deck fica com o chip mesmo assim, senão
    // o filtro "some" conforme o conteúdo).
    const chips = `<div class="dkc-filters">
      <button type="button" class="dkc-filter${communityGame === "" ? " on" : ""}" data-dkc-game="">${esc(t("decks.filterAll"))}</button>
      ${shared.GAME_SLUGS.map((g) => `<button type="button" class="dkc-filter${communityGame === g ? " on" : ""}" data-dkc-game="${escA(g)}">${shared.gameTagHtml(g)}</button>`).join("")}
    </div>`;
    const topCta = logged
      ? `<a class="cta secondary-cta" href="my-decks.html">${esc(t("decks.goMine"))}</a>`
      : `<a class="cta" href="login.html">${esc(t("decks.publicCta"))}</a>`;
    // "Mais vistos" só entra quando HÁ contagem: sem a tabela de visitas a opção
    // ordenaria por nada e pareceria quebrada.
    const sortOpts = ["recent", "cards", "name"].concat(temViews ? ["views"] : []);
    const sortSel = `<label class="dkc-sort"><span>${esc(t("decks.sortBy"))}</span>
      <select class="deck-view-sel" data-dkc-sort>
        ${sortOpts.map((s) => `<option value="${escA(s)}"${communitySort === s ? " selected" : ""}>${esc(t("decks.sortCom." + s))}</option>`).join("")}
      </select></label>`;
    // Ícones das seções (SVG inline: a CSP é 'self' e são dois).
    const IC_STAR = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.7l5.8-.8z"/></svg>';
    const IC_CLOCK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.2 2"/></svg>';
    const IC_FILTER = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M7.5 12h9M10.5 18h3"/></svg>';

    // Linha de metadados de um deck. Só entra o que o registro TEM: a galeria lê
    // campos por path (sem baixar as zonas), então cada número aqui existe de
    // verdade — nada de placeholder. `cost` é retrato do publicar (decks antigos
    // não têm) e vem em BRL: converte pra moeda do header.
    const metaHtml = (r) => {
      const n = Number(r.total) || 0;
      const custoBRL = Number(r.cost) || 0;
      const custo = custoBRL > 0
        ? (shared.convertMoney(custoBRL, "BRL", shared.getCurrency()) == null ? custoBRL : shared.convertMoney(custoBRL, "BRL", shared.getCurrency()))
        : 0;
      const quando = r.created_at ? new Date(r.created_at).toLocaleDateString(shared.getLocale()) : "";
      const vis = nViews(r);
      return [
        n ? `<span class="dkc-meta-item"><span class="dkc-meta-k">${esc(t("decks.cardsWord"))}</span><strong>${esc(String(n))}</strong></span>` : "",
        vis > 0 ? `<span class="dkc-meta-item"><span class="dkc-meta-k">${esc(t("decks.viewsWord"))}</span><strong>${esc(String(vis))}</strong></span>` : "",
        custo > 0 ? `<span class="dkc-meta-item"><span class="dkc-meta-k">${esc(t("decks.costEstimated"))}</span><strong>${esc(shared.formatMoney(shared.getCurrency(), custo))}</strong></span>` : "",
        r.author ? `<span class="dkc-meta-item"><span class="dkc-meta-k">${esc(t("decks.authorWord"))}</span><strong>${esc(String(r.author).slice(0, 30))}</strong></span>` : "",
        quando ? `<span class="dkc-meta-item"><span class="dkc-meta-k">${esc(t("decks.publishedWord"))}</span><strong>${esc(quando)}</strong></span>` : ""
      ].filter(Boolean).join("");
    };
    const capaHtml = (r) => r.cover
      ? `<img src="${escA(r.cover)}" alt="" loading="lazy">`
      : `<span class="deck-noimg"></span>`;

    let body;
    if (!rows.length) {
      body = `<section class="empty-state"><h2>${esc(t("decks.emptyCommunityTitle"))}</h2>
        <p>${esc(t(communityGame ? "decks.emptyCommunityGame" : "decks.emptyCommunity"))}</p></section>`;
    } else {
      // DESTAQUE = o mais VISITADO (tabela deck_views) — destaque de verdade,
      // por engajamento. Sem contagem nenhuma (migration não aplicada, ou
      // galeria recém-nascida), cai pro primeiro da ordem escolhida e o rótulo
      // muda pra "Último publicado": prefiro dizer o que é a mostrar um ranking
      // inventado. O hero SAI da lista de baixo pra não aparecer duas vezes.
      const popular = temViews
        ? rows.slice().sort((a, b) => nViews(b) - nViews(a))[0]
        : null;
      const hero = (popular && nViews(popular) > 0) ? popular : rows[0];
      const destaqueReal = hero === popular && nViews(hero) > 0;
      const resto = rows.filter((r) => r.id !== hero.id);
      const gHero = shared.normalizeGame(hero.game || "pokemon");
      const heroHtml = `<section class="dkc-sec">
        <h2 class="dkc-sec-h">${IC_STAR}<span>${esc(t(destaqueReal ? "decks.featured" : "decks.spotlight"))}</span></h2>
        <p class="dkc-sec-sub">${esc(t(destaqueReal ? "decks.featuredSub" : "decks.spotlightSub"))}</p>
        <a class="dkc-hero" href="decks.html?s=${encodeURIComponent(hero.id)}">
          <span class="dkc-hero-cover">${capaHtml(hero)}</span>
          <span class="dkc-hero-body">
            <span class="dkc-hero-name">${esc(String(hero.title || t("decks.untitled")).slice(0, 60))}</span>
            <span class="dkc-hero-tags">${shared.gameTagHtml(gHero)}${hero.format ? `<span class="dkc-fmt">${esc(t("decks.format." + hero.format))}</span>` : ""}</span>
            <span class="dkc-hero-meta">${metaHtml(hero)}</span>
          </span>
        </a>
      </section>`;

      const listaHtml = resto.length ? `<section class="dkc-sec">
        <h2 class="dkc-sec-h">${IC_CLOCK}<span>${esc(t(communitySort === "recent" ? "decks.recentTitle" : "decks.allTitle"))}</span></h2>
        <p class="dkc-sec-sub">${esc(t(communitySort === "recent" ? "decks.recentSub" : "decks.allSub"))}</p>
        <div class="dkc-rows">` + resto.map((r) => {
          const g = shared.normalizeGame(r.game || "pokemon");
          return `<a class="dkc-row" href="decks.html?s=${encodeURIComponent(r.id)}">
            <span class="dkc-row-cover">${capaHtml(r)}</span>
            <span class="dkc-row-main">
              <span class="dkc-row-name">${esc(String(r.title || t("decks.untitled")).slice(0, 60))}</span>
              <span class="dkc-row-tags">${shared.gameTagHtml(g)}${r.format ? `<span class="dkc-fmt">${esc(t("decks.format." + r.format))}</span>` : ""}</span>
            </span>
            <span class="dkc-row-meta">${metaHtml(r)}</span>
          </a>`;
        }).join("") + `</div></section>` : "";
      body = heroHtml + listaHtml;
    }

    // Coluna da direita: filtros/ordenação + atalho pros decks do usuário.
    // O filtro por JOGO fica nos chips lá em cima (padrão do site) — repetir
    // como select aqui daria dois controles pra mesma coisa.
    const aside = `<aside class="dkc-aside">
      <section class="dkc-panel">
        <h2 class="dkc-panel-h">${IC_FILTER}<span>${esc(t("decks.filtersTitle"))}</span></h2>
        ${sortSel}
      </section>
      <section class="dkc-panel dkc-mine">
        <h2 class="dkc-panel-h"><span>${esc(t("decks.mineTitle"))}</span></h2>
        <p>${esc(t(logged ? "decks.mineSub" : "decks.mineSubOut"))}</p>
        ${topCta}
      </section>
    </aside>`;

    box.innerHTML = `<div class="dkc-head">${chips}</div>
      <div class="dkc-layout"><div class="dkc-main">${body}</div>${aside}</div>`;
    box.querySelectorAll("[data-dkc-game]").forEach((b) => b.addEventListener("click", () => {
      communityGame = b.dataset.dkcGame;
      renderCommunity(box, logged);
    }));
    const sel = box.querySelector("[data-dkc-sort]");
    if (sel) sel.addEventListener("change", () => {
      communitySort = sel.value;
      try { localStorage.setItem("tcg-deck-community-sort", communitySort); } catch (e) { /* ignora */ }
      renderCommunity(box, logged);
    });
  }

  // ---------- Viewer de um deck publicado ----------
  async function renderPublicDeck(box, id, logged) {
    try { await renderPublicDeckInner(box, id, logged); }
    catch (e) {
      // Erro aqui era rejection MUDA: a página ficava pendurada no "Carregando…"
      // pra sempre, sem pista. Agora loga e mostra o estado de erro.
      console.error("renderPublicDeck:", e);
      box.innerHTML = `<section class="empty-state"><p>${esc(t("decks.loadError"))}</p></section>`;
    }
  }
  async function renderPublicDeckInner(box, id, logged) {
    box.innerHTML = `<p class="deck-hint">${esc(t("decks.loading"))}</p>`;
    const row = await shared.fetchShare(id);
    const deck = row && row.kind === "deck" ? sanitizeDeckPayload(row.data) : null;
    if (!deck) { box.innerHTML = `<section class="empty-state"><p>${esc(t("decks.sharedGone"))}</p></section>`; return; }
    // Conta a visita (1 por deck por sessão, só em produção): é o que alimenta
    // o "Em destaque" da galeria. Depois de confirmar que o deck EXISTE, senão
    // link quebrado inflaria o contador.
    shared.logDeckView(id);

    // Catálogo + preços do jogo do deck, só das cartas dele.
    const ids = [...new Set(Object.values(deck.zones).flat().map((e) => e.id))];
    let byId = {}, priceOk = false;
    try {
      const [r] = await Promise.all([shared.loadGameCatalog(deck.game, shared.gameDataDir(deck.game), ids), shared.loadFxRates()]);
      (r.cards || []).forEach((c) => { byId[c.id] = c; });
      if (r.pricing) { window.TCG_PRICING = Object.assign({}, window.TCG_PRICING || {}, r.pricing); }
      priceOk = true;
    } catch (e) { /* sem catálogo: mostra ids mesmo */ }

    // Valor pro VISITANTE: total e quanto falta pra ELE (coleção local dele).
    const prices = shared.createPriceStore(deck.game);
    const owned = shared.createCollectionStore(deck.game);
    let total = 0, missing = 0;
    Object.values(deck.zones).flat().forEach((e) => {
      const card = byId[e.id];
      if (!card) return;
      const unit = (shared.cardValue(card, shared.defaultVariant(card), prices) || {}).value || 0;
      const have = owned.totalForCard ? owned.totalForCard(e.id) : 0;
      total += unit * e.qty;
      missing += unit * Math.max(0, e.qty - have);
    });
    const money = (v) => shared.formatMoney(shared.getCurrency(), v);

    // ANÁLISE (curva de custo, cores, raridade) pra quem VÊ o deck publicado —
    // é o contexto que decide se vale copiar. Calculada aqui no cliente, a
    // partir do catálogo que esta página já baixou: não vai no payload do
    // publicar, então não incha a linha da tabela nem congela num retrato
    // velho — deck antigo passa a exibir a análise sem republicar.
    const an = rules.analyze({ game: deck.game, format: deck.format, zones: deck.zones }, byId);
    const analiseHtml = (an.curve || an.dist || an.rarity)
      ? `<section class="deck-analysis dkc-analysis">
          <h3>${esc(t("decks.analysis"))}</h3>
          ${curveHtml(an.curve)}
          ${barsHtml(t("decks.dist"), an.dist, true)}
          ${barsHtml(t("decks.rarity"), an.rarity)}
        </section>`
      : "";

    // O nome do deck vira o título da aba — é o que aparece no histórico e em
    // quem cola o link em chat (as páginas /deck/ pré-renderizadas cuidam do OG).
    try { document.title = `${deck.name} — Sleevu`; } catch (e) { /* ignora */ }

    const totalCartas = Object.values(deck.zones).flat().reduce((s, e) => s + e.qty, 0);
    const unitOf = (e) => {
      const card = byId[e.id];
      return card ? ((shared.cardValue(card, shared.defaultVariant(card), prices) || {}).value || 0) : 0;
    };
    const haveOf = (e) => (owned.totalForCard ? owned.totalForCard(e.id) : 0);

    // ── Grade × Lista ──────────────────────────────────────────────────────
    // A grade mostra a ARTE; a lista mostra os DADOS (qtd, set·nº, preço
    // unitário, se você já tem) — padrão Dreamborn/Limitless, e o formato que
    // quem vai comprar as cartas realmente usa. Preferência lembrada.
    const VIEW_KEY = "tcg-deck-public-view";
    let pubView = "grid";
    try { if (localStorage.getItem(VIEW_KEY) === "list") pubView = "list"; } catch (e) { /* ignora */ }

    const zonesHtml = () => Object.keys(deck.zones).map((zk) => {
      const list = deck.zones[zk];
      if (!list.length) return "";
      const label = t("decks.zone." + zk);
      const head = `<h3>${esc(label === "decks.zone." + zk ? zk : label)} <span class="deck-zone-n">${esc(String(list.reduce((s, e) => s + e.qty, 0)))}</span></h3>`;
      if (pubView === "list") {
        return `<section class="deck-zone">${head}<ul class="deck-list dkc-list">` + list.map((e) => {
          const card = byId[e.id];
          const unit = unitOf(e);
          const have = haveOf(e);
          const thumb = card && card.image ? `<img src="${escA(card.image)}" alt="" loading="lazy">` : `<span class="deck-noimg"></span>`;
          return `<li class="deck-row dkc-row">
            <span class="deck-qty">${esc(String(e.qty))}×</span>
            <span class="dkc-row-thumb">${thumb}</span>
            <span class="dkc-row-body">
              <span class="deck-row-name">${esc((card && card.name) || e.id)}</span>
              <span class="dkc-row-meta">${esc(card ? `${card.set || ""} ${card.number || ""}`.trim() : "")}</span>
            </span>
            ${logged && have >= e.qty ? `<span class="deck-own ok">${esc(t("decks.ownHave"))}</span>` : logged && have > 0 ? `<span class="deck-own part">${esc(t("decks.ownPartial").replace("{n}", String(have)))}</span>` : ""}
            ${unit > 0 ? `<span class="dkc-row-price">${esc(money(unit))}</span>` : ""}
          </li>`;
        }).join("") + `</ul></section>`;
      }
      return `<section class="deck-zone">${head}<div class="deck-tiles">` + list.map((e) => {
        const card = byId[e.id];
        const img = card && card.image ? `<img src="${escA(card.image)}" alt="${escA(card.name || "")}" loading="lazy">` : `<span class="deck-noimg"></span>`;
        return `<div class="deck-tile" title="${escA((card && card.name) || e.id)}">
          <span class="deck-tile-img">${img}</span>
          <span class="deck-tile-qty">${esc(String(e.qty))}×</span>
        </div>`;
      }).join("") + `</div></section>`;
    }).join("");

    // Data de publicação (created_at do share) — contexto de "quão atual é isto".
    let quando = "";
    try { if (row.created_at) quando = new Date(row.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); } catch (e) { /* ignora */ }
    const formatLabel = deck.format ? `<span class="dkc-meta-item">${esc(t("decks.format." + deck.format))}</span>` : "";

    const paint = () => {
      box.innerHTML = `
      <div class="dkc-view-head">
        <a href="decks.html" class="serie-back">${esc(t("decks.backCommunity"))}</a>
        <div class="dkc-view-title">
          <h2 class="dkc-view-name">${esc(deck.name)}</h2>
          <div class="dkc-view-meta">
            ${shared.gameTagHtml(deck.game)}
            ${formatLabel}
            <span class="dkc-meta-item">${esc(t("decks.cardsCount", { n: totalCartas }))}</span>
            ${an.avgCost != null ? `<span class="dkc-meta-item">${esc(t("decks.avgCost"))}: ${esc(String(an.avgCost))}</span>` : ""}
            ${deck.author ? `<span class="dkc-author">${authorHtml(deck.author)}</span>` : ""}
            ${quando ? `<span class="dkc-meta-item dkc-meta-date">${esc(quando)}</span>` : ""}
          </div>
        </div>
        <div class="dkc-view-acts">
          <div class="deck-lays dkc-lays" role="group" aria-label="Layout">
            <button type="button" class="deck-lay${pubView === "grid" ? " on" : ""}" data-dkc-view="grid" aria-pressed="${pubView === "grid"}" title="${escA(t("decks.layout.grid"))}"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg></button>
            <button type="button" class="deck-lay${pubView === "list" ? " on" : ""}" data-dkc-view="list" aria-pressed="${pubView === "list"}" title="${escA(t("decks.layout.list"))}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
          </div>
          <button type="button" class="cta" data-dkc-copy>${esc(t(logged ? "decks.copyToMine" : "decks.loginToCopy"))}</button>
        </div>
      </div>
      <div class="dkc-view-cols">
        <div class="dkc-view-main">${zonesHtml()}</div>
        <aside class="dkc-view-side">
          ${priceOk ? `<section class="deck-value dkc-value">
            <h3>${esc(t("decks.value"))}</h3>
            <div class="deck-value-row"><span>${esc(t("decks.valueTotal"))}</span><strong>${esc(money(total))}</strong></div>
            <div class="deck-value-row"><span>${esc(t("decks.valueHave"))}</span><strong class="have">${esc(money(total - missing))}</strong></div>
            <div class="deck-value-row missing"><span>${esc(t("decks.valueMissingYou"))}</span><strong>${esc(money(missing))}</strong></div>
          </section>` : ""}
          ${analiseHtml}
        </aside>
      </div>`;
      bind();
    };

    function bind() {
      box.querySelectorAll("[data-dkc-view]").forEach((b) => b.addEventListener("click", () => {
        pubView = b.dataset.dkcView === "list" ? "list" : "grid";
        try { localStorage.setItem(VIEW_KEY, pubView); } catch (e) { /* ignora */ }
        paint();
      }));
      bindCopy();
    }

    paint();

    function bindCopy() {
      box.querySelector("[data-dkc-copy]").addEventListener("click", () => {
        if (!logged) { location.href = "login.html"; return; }
        // Fork: entra no MEU store local com id novo (o sync sobe no próximo ciclo).
        const zones = {};
        Object.keys(deck.zones).forEach((k) => { zones[k] = deck.zones[k].map((e) => ({ id: e.id, qty: e.qty, variant: "Normal" })); });
        const novo = {
          id: newId(), game: deck.game, format: deck.format, name: deck.name,
          zones, forkedFrom: id, createdAt: Date.now(), updatedAt: Date.now()
        };
        data.decks.unshift(novo);
        if (save()) location.href = "my-decks.html?id=" + encodeURIComponent(novo.id);
      });
    }
  }

  const el = {
    gallery: document.getElementById("deckGallery"),
    editor: document.getElementById("deckEditor")
  };
  if (!el.gallery || !el.editor) return;

  // Preview da carta — o MESMO modal do Explorar/Binder. Criado UMA vez (ele
  // registra listeners no document; recriar empilharia handlers), mas o jogo
  // muda por deck: os proxies encaminham pro store do deck aberto.
  const curGame = () => (current && current.game) || "pokemon";
  // Encaminha qualquer acesso pro store do jogo do deck ABERTO no momento
  // (métodos vêm ligados ao store certo).
  function liveStore(factory) {
    return new Proxy({}, {
      get(_t, prop) {
        const s = factory(curGame());
        const v = s[prop];
        return typeof v === "function" ? v.bind(s) : v;
      }
    });
  }
  const cardPreview = shared.createCardPreview({
    getCard: (cardId) => (cat && cat.byId ? cat.byId[cardId] : null),
    // Proxy em vez de listar os métodos na mão: o preview chama helpers que usam
    // outros métodos do store (getQuantity, conditionBreakdown…), e enumerar
    // quebraria de novo a cada método novo. O Proxy encaminha tudo.
    store: liveStore(ownedFor),
    prices: liveStore(pricesFor),
    // Mexer na posse pelo preview muda o selo "tenho/falta" e o valor do deck.
    onOwnedChange: () => { if (current && cat) renderEditor(); }
  });

  function show(view) {
    el.gallery.hidden = view !== "gallery";
    el.editor.hidden = view !== "editor";
  }

  // Etiqueta preenchida na cor do jogo (mesmo idioma visual da Coleção). O
  // "pontinho + texto" sumia em lista densa.
  function gameTag(game) { return shared.gameTagHtml(game); }

  // ---------- Galeria ----------
  function renderGallery() {
    const decks = list();
    const head = `
      <div class="deck-gal-head">
        <h2 class="dash-section-head">${esc(t("decks.mine"))}</h2>
        <button type="button" class="cta" id="deckNew">${esc(t("decks.new"))}</button>
      </div>`;
    if (!decks.length) {
      el.gallery.innerHTML = head + `<p class="empty-state">${esc(t("decks.emptyMine"))}</p>`;
      return;
    }
    el.gallery.innerHTML = head + `<div class="deck-grid">` + decks.map((d) => {
      const n = totalCards(d);
      return `<article class="deck-card" data-deck-id="${escA(d.id)}">
        <a class="deck-card-open" href="my-decks.html?id=${encodeURIComponent(d.id)}">
          <span class="deck-card-name">${esc(d.name)}</span>
          <span class="deck-card-meta">${gameTag(d.game)}${d.format ? "<span>" + esc(t("decks.format." + d.format)) + "</span>" : ""}<span>${esc(String(n))} ${esc(t("decks.cardsWord"))}</span></span>
        </a>
        <div class="deck-card-actions">
          <button type="button" class="deck-mini" data-deck-dup="${escA(d.id)}">${esc(t("decks.duplicate"))}</button>
          <button type="button" class="deck-mini danger" data-deck-del="${escA(d.id)}">${esc(t("decks.delete"))}</button>
        </div>
      </article>`;
    }).join("") + `</div>` + `<div id="deckPublished"></div>`;
    renderPublished();
  }

  // ── Meus decks PUBLICADOS ────────────────────────────────────────────────
  // Lista as linhas de `shares` do usuário, não os decks locais. Existe porque
  // uma publicação pode ficar ÓRFÃ: antes da policy de UPDATE, republicar criava
  // uma linha nova e o publishedId do deck passava a apontar só pra ela — a
  // anterior seguia pública e sem nenhum botão que a alcançasse. Aqui ela
  // aparece e pode ser despublicada.
  async function renderPublished() {
    const box = document.getElementById("deckPublished");
    if (!box || !(shared.getSession && shared.getSession())) return;
    const rows = await shared.listMyShares("deck");
    if (!rows.length) { box.innerHTML = ""; return; }
    // Marca as publicações que nenhum deck local referencia.
    const ligados = new Set(list().map((d) => d.publishedId).filter(Boolean));
    box.innerHTML = `
      <h2 class="dash-section-head deck-pub-head">${esc(t("decks.publishedMine"))}</h2>
      <p class="deck-hint">${esc(t("decks.publishedMineHint"))}</p>
      <div class="deck-pub-list">` + rows.map((r) => {
        const orfao = !ligados.has(r.id);
        const quando = r.created_at ? new Date(r.created_at).toLocaleDateString(shared.getLocale()) : "";
        return `<div class="deck-pub-row">
          <a class="deck-pub-name" href="decks.html?s=${encodeURIComponent(r.id)}">${esc(String(r.title || t("decks.untitled")))}</a>
          <span class="deck-pub-meta">${shared.gameTagHtml(shared.normalizeGame(r.game || "pokemon"))}${r.total ? `<span>${esc(t("decks.cardsCount", { n: Number(r.total) }))}</span>` : ""}<span>${esc(quando)}</span></span>
          ${orfao ? `<span class="deck-pub-orphan" title="${escA(t("decks.orphanHint"))}">${esc(t("decks.orphan"))}</span>` : ""}
          <button type="button" class="deck-mini deck-unpub" data-pub-del="${escA(r.id)}">${esc(t("decks.unpublish"))}</button>
        </div>`;
      }).join("") + `</div>`;
    box.querySelectorAll("[data-pub-del]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm(t("decks.confirmUnpublish").replace("{name}", b.closest(".deck-pub-row").querySelector(".deck-pub-name").textContent))) return;
      b.disabled = true;
      const r = await shared.deleteShare(b.dataset.pubDel);
      b.disabled = false;
      if (r && r.ok) {
        // Solta o vínculo do deck local que apontava pra este share.
        list().forEach((d) => { if (d.publishedId === b.dataset.pubDel) { d.publishedId = null; d.publishedAt = null; touch(d); } });
        save();
        renderGallery();
      } else {
        alert(t(r && r.error === "auth" ? "decks.publishAuth" : "decks.unpublishFail"));
      }
    }));
  }

  // ---------------------------------------------------------------------------
  // Export / import de lista em TEXTO — o formato que todo mundo usa
  // (Moxfield, Limitless, Dreamborn, Discord): "4 Nome da Carta" por linha,
  // com cabeçalho por zona. É o que permite trazer um deck pronto sem
  // redigitar 60 cartas.
  // ---------------------------------------------------------------------------
  function deckToText(deck) {
    const pack = packOf(deck);
    const out = [];
    (pack.zones || []).forEach((z) => {
      const entries = deck.zones[z.key] || [];
      if (!entries.length) return;
      // Zona única (a maioria dos jogos) dispensa cabeçalho — assim o texto cola
      // limpo em qualquer lugar.
      if ((pack.zones || []).length > 1) { if (out.length) out.push(""); out.push(t("decks.zone." + z.key)); }
      sortEntries(deck, entries).forEach((e) => {
        const card = cat && cat.byId[e.id];
        out.push(`${e.qty} ${card ? card.name : e.id}`);
      });
    });
    return out.join("\n");
  }

  // Lê "4 Nome", "4x Nome", "Nome" (=1) e ignora linha vazia/comentário. O
  // cabeçalho de zona é reconhecido pelo rótulo traduzido; o que não casa vira
  // carta (uma lista sem cabeçalho continua funcionando).
  function parseDeckText(text, pack) {
    const zoneByLabel = {};
    (pack.zones || []).forEach((z) => { zoneByLabel[norm(t("decks.zone." + z.key))] = z.key; });
    const first = (pack.zones && pack.zones[0] && pack.zones[0].key) || "main";
    let zone = first;
    const rows = [];
    String(text || "").split(/\r?\n/).forEach((raw) => {
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.startsWith("//")) return;
      const asZone = zoneByLabel[norm(line.replace(/[:\-–—]+$/, "").trim())];
      if (asZone) { zone = asZone; return; }
      const m = line.match(/^(\d+)\s*[xX]?\s+(.+)$/);
      const qty = m ? Math.min(Number(m[1]) || 1, 99) : 1;   // teto: linha corrompida não vira 9999 cópias
      let name = (m ? m[2] : line).trim();
      // Sufixos comuns dos outros sites: "(SET) 123" / "[SET]" / "· 4/102".
      name = name.replace(/\s*[\(\[][^\)\]]*[\)\]]\s*\d*$/, "").replace(/\s+·.*$/, "").trim();
      if (name) rows.push({ zone, qty, name });
    });
    return rows;
  }

  // Casa os nomes com o índice do jogo (nome exato, sem acento/caixa). Devolve
  // o que casou e o que não achou — a lista de "não encontradas" é mostrada, não
  // engolida: importar 58 de 60 em silêncio seria pior que falhar.
  async function importText(deck, text) {
    const pack = packOf(deck);
    const rows = parseDeckText(text, pack);
    if (!rows.length) return { added: 0, missing: [] };
    const index = await searchIndexFor(deck.game);
    const byName = new Map();
    index.forEach((e) => { const k = norm(e.n); if (!byName.has(k)) byName.set(k, e); });
    const hits = [], missing = [];
    rows.forEach((r) => {
      const e = byName.get(norm(r.name));
      if (e) hits.push({ zone: r.zone, qty: r.qty, id: e.i });
      else missing.push(r.name);
    });
    if (hits.length) {
      cat = await ensureCards(deck.game, hits.map((h) => h.id));
      hits.forEach((h) => {
        const card = cat.byId[h.id];
        if (!card) return;
        // A zona do texto só vale se a carta couber nela (líder não vai pro deck).
        const ok = rules.zonesForCard(pack, card);
        const zone = ok.includes(h.zone) ? h.zone : rules.zoneForCard(pack, card);
        if (zone) addCard(deck, zone, card, h.qty);
      });
    }
    return { added: hits.length, missing };
  }

  function openImportModal() {
    const wrap = document.createElement("div");
    wrap.className = "deck-modal";
    wrap.innerHTML = `
      <div class="deck-modal-box" role="dialog" aria-modal="true" aria-label="${escA(t("decks.import"))}">
        <h2>${esc(t("decks.import"))}</h2>
        <p class="deck-modal-hint">${esc(t("decks.importHint"))}</p>
        <textarea id="deckImportText" class="deck-import-area" rows="12" placeholder="4 Charizard&#10;2 Blastoise"></textarea>
        <p id="deckImportMsg" class="deck-modal-hint"></p>
        <div class="deck-modal-foot">
          <button type="button" class="deck-mini" data-deck-cancel>${esc(t("decks.cancel"))}</button>
          <button type="button" class="cta" data-import-go>${esc(t("decks.importGo"))}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", async (ev) => {
      if (ev.target === wrap || ev.target.closest("[data-deck-cancel]")) { wrap.remove(); return; }
      if (!ev.target.closest("[data-import-go]")) return;
      const msg = wrap.querySelector("#deckImportMsg");
      msg.textContent = t("decks.loading");
      try {
        const res = await importText(current, wrap.querySelector("#deckImportText").value);
        if (!res.added && !res.missing.length) { msg.textContent = t("decks.importEmpty"); return; }
        wrap.remove();
        renderEditor();
        if (res.missing.length) {
          alert(t("decks.importMissing", { n: res.missing.length }) + "\n\n" + res.missing.slice(0, 20).join("\n"));
        }
      } catch (e) { msg.textContent = t("decks.loadError"); }
    });
    setTimeout(() => { const a = wrap.querySelector("#deckImportText"); if (a) a.focus(); }, 0);
  }

  async function copyDeckText() {
    const text = deckToText(current);
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      // Sem Clipboard API (contexto inseguro): cai no textarea + execCommand.
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  // ---------- Modal: novo deck (jogo -> formato, quando o jogo tem mais de um) ----------
  function openNewDeckModal() {
    const wrap = document.createElement("div");
    wrap.className = "deck-modal";
    document.body.appendChild(wrap);

    function stepGame() {
      // data-pick-game (e não data-game): o <html> carrega data-game com o jogo
      // da SESSÃO, então um closest("[data-game]") casaria com ele e qualquer
      // clique no modal viraria "escolheu o jogo da sessão".
      const games = shared.GAME_SLUGS.map((g) =>
        `<button type="button" class="deck-game-pick" data-pick-game="${escA(g)}">${gameTag(g)}</button>`).join("");
      wrap.innerHTML = `
        <div class="deck-modal-box" role="dialog" aria-modal="true" aria-label="${escA(t("decks.new"))}">
          <h2>${esc(t("decks.pickGame"))}</h2>
          <div class="deck-game-list">${games}</div>
          <button type="button" class="deck-mini" data-deck-cancel>${esc(t("decks.cancel"))}</button>
        </div>`;
    }
    function stepFormat(game, formats) {
      const opts = formats.map((f) =>
        `<button type="button" class="deck-game-pick" data-format="${escA(f)}">${esc(t("decks.format." + f))}</button>`).join("");
      wrap.innerHTML = `
        <div class="deck-modal-box" role="dialog" aria-modal="true" aria-label="${escA(t("decks.new"))}">
          <h2>${esc(t("decks.pickFormat", { deckGame: shared.gameLabel(game) }))}</h2>
          <div class="deck-game-list">${opts}</div>
          <button type="button" class="deck-mini" data-deck-cancel>${esc(t("decks.cancel"))}</button>
        </div>`;
    }
    function go(game, format) {
      const deck = createDeck(game, format, "");
      wrap.remove();
      location.href = `my-decks.html?id=${encodeURIComponent(deck.id)}`;
    }

    let chosenGame = null;
    stepGame();
    wrap.addEventListener("click", (ev) => {
      if (ev.target === wrap || ev.target.closest("[data-deck-cancel]")) { wrap.remove(); return; }
      const g = ev.target.closest("[data-pick-game]");
      if (g) {
        chosenGame = g.dataset.pickGame;
        const formats = rules.formatsOf(chosenGame);
        // Jogo de formato único pula o passo — sem clique à toa.
        if (formats.length > 1) stepFormat(chosenGame, formats);
        else go(chosenGame, formats[0] || null);
        return;
      }
      const f = ev.target.closest("[data-format]");
      if (f && chosenGame) go(chosenGame, f.dataset.format);
    });
  }

  // ---------- Editor ----------
  let current = null;      // deck aberto
  let cat = null;          // { cards, byId } do jogo do deck
  let query = "";
  // Aba ativa no MOBILE ("deck" | "find" | "stats"). No desktop as 3 áreas
  // aparecem juntas e o CSS ignora isto.
  let mobTab = "deck";

  async function openEditor(deck) {
    current = deck;
    show("editor");
    el.editor.innerHTML = `<p class="empty-state">${esc(t("decks.loading"))}</p>`;
    try {
      // loadFxRates é OBRIGATÓRIO antes de calcular valor: sem as taxas,
      // convertMoney devolve null e cardValue cai pra 0 — o painel inteiro
      // sairia zerado mesmo com preço no catálogo.
      // Só as cartas DESTE deck: abrir um deck de 60 não pode baixar 46k.
      const [c] = await Promise.all([ensureCards(deck.game, deckCardIds(deck)), shared.loadFxRates()]);
      cat = c;
    } catch (e) {
      el.editor.innerHTML = `<p class="empty-state">${esc(t("decks.loadError"))}</p>`;
      return;
    }
    renderEditor();
  }

  function issueText(iss) {
    const v = iss.vals || {};
    const zone = v.zone ? t("decks.zone." + v.zone) : "";
    return t("decks.issue." + iss.code)
      .replace("{zone}", zone).replace("{n}", v.n).replace("{min}", v.min)
      .replace("{max}", v.max).replace("{name}", v.name || "").replace("{qty}", v.qty)
      .replace("{list}", v.list || "");
  }

  // ---------------------------------------------------------------------------
  // View: layout (grade/lista/pilha), agrupamento e ordenação. Preferência é do
  // USUÁRIO, não do deck — vale pra todos, então vive na própria chave.
  // ---------------------------------------------------------------------------
  const VIEW_KEY = "tcg-collector-deck-view-v1";
  const SORTS = ["cost", "set", "nameAsc", "nameDesc", "priceAsc", "priceDesc"];
  const GROUPS = ["none", "type", "cost", "color", "rarity"];
  const LAYOUTS = ["grid", "list", "stack"];
  // Padrão: GRADE, sem agrupamento, por custo — deck se lê pela arte, não por
  // uma lista de nomes. Quem já escolheu outra coisa mantém a sua (só entra
  // aqui quando não há preferência salva).
  const VIEW_DEFAULT = { layout: "grid", group: "type", sort: "cost" };
  let view = (function readView() {
    try {
      const v = JSON.parse(localStorage.getItem(VIEW_KEY) || "null") || {};
      return {
        layout: LAYOUTS.includes(v.layout) ? v.layout : VIEW_DEFAULT.layout,
        group: GROUPS.includes(v.group) ? v.group : VIEW_DEFAULT.group,
        sort: SORTS.includes(v.sort) ? v.sort : VIEW_DEFAULT.sort
      };
    } catch (e) { return Object.assign({}, VIEW_DEFAULT); }
  })();
  function saveView() { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch (e) { /* ignora */ } }

  // Preço unitário da entrada (usado por "Preço: menor/maior" e pela linha).
  function unitPrice(deck, entry) {
    const card = cat.byId[entry.id];
    if (!card) return 0;
    const prices = pricesFor(deck.game);
    return (shared.cardValue(card, entry.variant || shared.defaultVariant(card), prices) || {}).value || 0;
  }

  function sortEntries(deck, entries) {
    const c = (e) => cat.byId[e.id] || {};
    const num = (e) => { const m = String(c(e).number || "").match(/\d+/); return m ? Number(m[0]) : 1e9; };
    const cost = (e) => { const v = Number(c(e).cost); return Number.isFinite(v) ? v : 1e9; };
    const name = (e) => String(c(e).name || e.id);
    const arr = entries.slice();
    const byName = (a, b) => name(a).localeCompare(name(b), shared.getLocale ? shared.getLocale() : "pt-BR");
    switch (view.sort) {
      // Desempate por nome em todos: ordem estável e previsível entre re-renders.
      case "set": arr.sort((a, b) => String(c(a).setId || "").localeCompare(String(c(b).setId || "")) || (num(a) - num(b)) || byName(a, b)); break;
      case "nameAsc": arr.sort(byName); break;
      case "nameDesc": arr.sort((a, b) => byName(b, a)); break;
      case "priceAsc": arr.sort((a, b) => unitPrice(deck, a) - unitPrice(deck, b) || byName(a, b)); break;
      case "priceDesc": arr.sort((a, b) => unitPrice(deck, b) - unitPrice(deck, a) || byName(a, b)); break;
      default: arr.sort((a, b) => cost(a) - cost(b) || byName(a, b)); break;
    }
    return arr;
  }

  // Chave de agrupamento. Devolve "" quando o jogo não tem o dado (ex.: custo no
  // Pokémon) — aí o grupo vira "Sem categoria" em vez de sumir com a carta.
  function groupKeyOf(deck, entry) {
    const card = cat.byId[entry.id] || {};
    const pack = packOf(deck);
    // TIPO principal, não a type_line crua: no Magic ela traz os subtipos
    // ("Artifact Creature — Golem"), então cada criatura virava um grupo só
    // dela. O rótulo já vem traduzido e serve de chave (é único por tipo).
    if (view.group === "type") return shared.cardTypeGroup(deck.game, card).label;
    if (view.group === "cost") return card.cost == null || card.cost === "" ? "" : String(card.cost);
    if (view.group === "color") return pack.dist ? String(card[pack.dist] || "") : "";
    if (view.group === "rarity") return String(card.rarity || "");
    return "";
  }
  function groupEntries(deck, entries) {
    if (view.group === "none") return [{ label: null, entries: entries }];
    const map = new Map();
    entries.forEach((e) => {
      const k = groupKeyOf(deck, e);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    });
    // Ordem dos grupos: o MAIOR primeiro (soma de cópias, não de linhas). Num
    // deck de Lorcana os 52 personagens são o assunto principal e ficavam
    // embaixo de "Action 4" só porque A vem antes de C no alfabeto — obrigando a
    // rolar pra ver o miolo do deck. Empate desempata por nome, e os grupos sem
    // valor ("") vão sempre pro fim.
    const total = (list) => list.reduce((s, e) => s + (e.qty || 0), 0);
    return [...map.entries()]
      .sort((a, b) => {
        if (a[0] === "") return 1;
        if (b[0] === "") return -1;
        return total(b[1]) - total(a[1])
          || String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true });
      })
      .map(([k, list]) => ({ label: k === "" ? t("decks.groupNone") : prettyLabel(k), entries: list }));
  }

  // Menu "View": layout + agrupar + ordenar. <details> nativo — abre/fecha e
  // fecha no Esc sem JS, e é acessível por teclado de graça.
  const LAYOUT_ICON = {
    grid: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>',
    list: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
    stack: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/></svg>'
  };
  function viewMenuHtml() {
    const layouts = LAYOUTS.map((l) =>
      `<button type="button" class="deck-lay${view.layout === l ? " on" : ""}" data-layout="${escA(l)}" aria-pressed="${view.layout === l}" title="${escA(t("decks.layout." + l))}" aria-label="${escA(t("decks.layout." + l))}">${LAYOUT_ICON[l]}</button>`).join("");
    const opts = (name, values, cur) => values.map((v) =>
      `<option value="${escA(v)}"${v === cur ? " selected" : ""}>${esc(t("decks." + name + "." + v))}</option>`).join("");
    return `<details class="deck-view">
      <summary class="deck-mini">${esc(t("decks.view"))} <span aria-hidden="true">▾</span></summary>
      <div class="deck-view-panel">
        <label class="deck-view-lbl">${esc(t("decks.layoutLabel"))}</label>
        <div class="deck-lay-row">${layouts}</div>
        <label class="deck-view-lbl" for="deckGroupBy">${esc(t("decks.groupBy"))}</label>
        <select id="deckGroupBy" class="deck-view-sel">${opts("group", GROUPS, view.group)}</select>
        <label class="deck-view-lbl" for="deckSortBy">${esc(t("decks.sortBy"))}</label>
        <select id="deckSortBy" class="deck-view-sel">${opts("sort", SORTS, view.sort)}</select>
      </div>
    </details>`;
  }

  function renderEditor() {
    const deck = current;
    const pack = packOf(deck);
    const viewOpenEl = el.editor.querySelector(".deck-view");
    const viewWasOpen = !!(viewOpenEl && viewOpenEl.open);
    const val = computeValue(deck, cat.byId);
    const issues = rules.validate(deck, cat.byId);
    const an = rules.analyze(deck, cat.byId);

    // PROXY (`px` na entrada): "vou jogar esta com proxy". Serve pra montar o
    // deck inteiro e enxergar o que ainda falta comprar de verdade — o selo de
    // posse diz o que você TEM, o proxy diz o que você decidiu não comprar
    // agora. Some do cálculo de "falta" no painel de valor.
    const proxyBtn = (e) => `<button type="button" class="deck-mini deck-proxy${e.px ? " on" : ""}" data-proxy aria-pressed="${!!e.px}" title="${escA(t(e.px ? "decks.proxyOff" : "decks.proxyOn"))}" aria-label="${escA(t(e.px ? "decks.proxyOff" : "decks.proxyOn"))}">P</button>`;

    // Selo de posse — compartilhado pelos 3 layouts.
    const ownBadge = (e) => {
      if (e.px) return `<span class="deck-own proxy">${esc(t("decks.proxyTag"))}</span>`;
      const have = ownedCountOf(deck, e.id);
      return have >= (e.qty || 0)
        ? `<span class="deck-own ok">${esc(t("decks.ownHave"))}</span>`
        : have > 0
          ? `<span class="deck-own part">${esc(t("decks.ownPartial").replace("{n}", String(have)))}</span>`
          : `<span class="deck-own no">${esc(t("decks.ownNone"))}</span>`;
    };
    const imgOf = (card) => (card && card.image)
      ? `<img src="${escA(card.image)}" alt="" loading="lazy">`
      : `<span class="deck-noimg"></span>`;

    function entriesHtml(zoneKey, list) {
      if (view.layout === "grid" || view.layout === "stack") {
        const cls = view.layout === "grid" ? "deck-tiles" : "deck-pile";
        return `<div class="${cls}">` + list.map((e) => {
          const card = cat.byId[e.id];
          return `<div class="deck-tile${e.px ? " is-proxy" : ""}" data-zone="${escA(zoneKey)}" data-card="${escA(e.id)}" title="${escA((card && card.name) || e.id)}">
            <span class="deck-tile-img">${imgOf(card)}</span>
            <span class="deck-tile-qty">${esc(String(e.qty))}×</span>
            ${e.px ? `<span class="deck-tile-proxy">${esc(t("decks.proxyTag"))}</span>` : ""}
            <span class="deck-tile-btns">
              <button type="button" class="deck-mini" data-dec>−</button>
              ${proxyBtn(e)}
              <button type="button" class="deck-mini" data-inc>+</button>
            </span>
          </div>`;
        }).join("") + `</div>`;
      }
      return `<ul class="deck-list">` + list.map((e) => {
        const card = cat.byId[e.id];
        // Preço unitário na linha (padrão Dreamborn): quem monta já vê o custo
        // de cada escolha sem abrir o card.
        const unit = card ? ((shared.cardValue(card, shared.defaultVariant(card), pricesFor(deck.game)) || {}).value || 0) : 0;
        return `<li class="deck-row${e.px ? " is-proxy" : ""}" data-zone="${escA(zoneKey)}" data-card="${escA(e.id)}">
          <span class="deck-qty">${esc(String(e.qty))}×</span>
          <span class="deck-row-name">${esc((card && card.name) || e.id)}</span>
          ${unit > 0 ? `<span class="dkc-row-price">${esc(money(unit))}</span>` : ""}
          ${ownBadge(e)}
          <span class="deck-row-btns">
            <button type="button" class="deck-mini" data-dec>−</button>
            ${proxyBtn(e)}
            <button type="button" class="deck-mini" data-inc>+</button>
          </span>
        </li>`;
      }).join("") + `</ul>`;
    }

    const zonesHtml = (pack.zones || []).map((z) => {
      const entries = deck.zones[z.key] || [];
      const n = rules.countIn(deck, z.key);
      const limit = z.max ? `${n}/${z.max}` : (z.min ? `${n}/${z.min}` : String(n));
      let body;
      if (!entries.length) {
        body = `<ul class="deck-list"><li class="deck-empty">${esc(t("decks.zoneEmpty"))}</li></ul>`;
      } else {
        // Ordena DENTRO de cada grupo: agrupar antes tornaria a ordenação
        // global inútil (os grupos já separam).
        body = groupEntries(deck, entries).map((g) => {
          const inner = entriesHtml(z.key, sortEntries(deck, g.entries));
          const qty = g.entries.reduce((s, e) => s + (e.qty || 0), 0);
          return g.label == null ? inner
            : `<div class="deck-group"><h4>${esc(g.label)} <span>${esc(String(qty))}</span></h4>${inner}</div>`;
        }).join("");
      }
      return `<section class="deck-zone">
        <h3>${esc(t("decks.zone." + z.key))} <span class="deck-zone-n">${esc(limit)}</span></h3>
        ${body}
      </section>`;
    }).join("");

    const issuesHtml = issues.length
      ? `<ul class="deck-issues">` + issues.map((i) => `<li>${esc(issueText(i))}</li>`).join("") + `</ul>`
      : `<p class="deck-legal">${esc(pack.free ? t("decks.freeMode") : t("decks.legal"))}</p>`;

    el.editor.innerHTML = `
      <div class="deck-ed-head">
        <a href="my-decks.html" class="serie-back">${esc(t("decks.backList"))}</a>
        <input id="deckName" class="deck-name-input" value="${escA(deck.name)}" aria-label="${escA(t("decks.nameLabel"))}">
        <span class="deck-ed-game">${gameTag(deck.game)}${pack.format ? "<span>" + esc(t("decks.format." + pack.format)) + "</span>" : ""}</span>
        <button type="button" class="deck-mini" data-deck-import>${esc(t("decks.import"))}</button>
        <button type="button" class="deck-mini" data-deck-copy>${esc(t("decks.copyList"))}</button>
        <button type="button" class="deck-mini" data-deck-publish>${esc(t(deck.publishedId ? "decks.savePublic" : "decks.publish"))}</button>
        ${deck.publishedId ? `<button type="button" class="deck-mini deck-unpub" data-deck-unpublish>${esc(t("decks.unpublish"))}</button>` : ""}
        ${viewMenuHtml()}
      </div>
      ${issuesHtml}
      <!-- Abas SÓ no mobile (CSS esconde no desktop, onde as 2 colunas cabem):
           sem elas, a busca fica embaixo do deck inteiro e cada carta
           adicionada exige rolar até o fim e voltar. -->
      <div class="deck-tabs" role="tablist">
        <button type="button" class="deck-tab" data-tab="deck" role="tab" aria-selected="${mobTab === "deck"}">${esc(t("decks.tab.deck"))}</button>
        <button type="button" class="deck-tab" data-tab="find" role="tab" aria-selected="${mobTab === "find"}">${esc(t("decks.tab.find"))}</button>
        <button type="button" class="deck-tab" data-tab="stats" role="tab" aria-selected="${mobTab === "stats"}">${esc(t("decks.tab.stats"))}</button>
      </div>
      <div class="deck-ed-cols" data-mobtab="${escA(mobTab)}">
        <!-- ESQUERDA: só as cartas do deck. -->
        <div class="deck-ed-left">
          ${zonesHtml}
        </div>
        <!-- DIREITA: busca + números do deck (valor e análise). -->
        <div class="deck-ed-right">
          <div class="deck-find">
            <h3>${esc(t("decks.addCards"))}</h3>
            <input id="deckSearch" class="deck-search" type="search" placeholder="${escA(t("decks.searchPlaceholder", { deckGame: shared.gameLabel(deck.game) }))}" value="${escA(query)}">
            <div id="deckFacets">${facetsHtml(deck.game)}</div>
            <div id="deckResults" class="deck-results"></div>
          </div>
          <div class="deck-stats">
          <section class="deck-value">
            <h3>${esc(t("decks.value"))}</h3>
            <div class="deck-value-row"><span>${esc(t("decks.valueTotal"))}</span><strong>${esc(money(val.total))}</strong></div>
            <div class="deck-value-row"><span>${esc(t("decks.valueHave"))}</span><strong class="have">${esc(money(val.have))}</strong></div>
            <div class="deck-value-row missing"><span>${esc(t("decks.valueMissing"))}</span><strong>${esc(money(val.missing))}</strong></div>
            <p class="deck-value-note">${esc(t("decks.missingCount").replace("{n}", String(val.missingCards)))}</p>
            ${val.proxyCards ? `<p class="deck-value-note is-proxy">${esc(t("decks.proxyCount").replace("{n}", String(val.proxyCards)))}</p>` : ""}
          </section>
          ${(an.curve || an.dist || an.rarity) ? `<section class="deck-analysis">
            <h3>${esc(t("decks.analysis"))}${an.avgCost != null ? ` <span class="deck-avg">${esc(t("decks.avgCost"))}: ${esc(String(an.avgCost))}</span>` : ""}</h3>
            ${curveHtml(an.curve)}
            ${barsHtml(t("decks.dist"), an.dist, true)}
            ${barsHtml(t("decks.rarity"), an.rarity)}
          </section>` : ""}
          </div>
        </div>
      </div>`;

    // O editor re-renderiza inteiro a cada ajuste; sem isto o painel de View
    // fecharia sozinho ao trocar "agrupar por" — ninguém consegue mexer em dois
    // controles seguidos.
    if (viewWasOpen) { const d = el.editor.querySelector(".deck-view"); if (d) d.open = true; }

    renderResults();
    const nameInput = document.getElementById("deckName");
    nameInput.addEventListener("input", () => { deck.name = nameInput.value.trim() || t("decks.untitled"); touch(deck); });
    const search = document.getElementById("deckSearch");
    let timer = null;
    search.addEventListener("input", () => {
      query = search.value;
      clearTimeout(timer);
      timer = setTimeout(renderResults, 180); // debounce: catálogo grande
    });
  }

  // Normaliza pra busca (sem acento/caixa) — o índice guarda o nome cru.
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  // ---------------------------------------------------------------------------
  // Índice de PREFIXO (3 letras -> cartas). Varrer o índice inteiro a cada tecla
  // custava ~2,5s no Magic (97k) no desktop e bem mais no celular. Aqui o custo
  // é pago UMA vez por jogo e cada busca vira uma consulta a um Map.
  // ---------------------------------------------------------------------------
  const PREFIX_LEN = 3;
  const prefixCache = {};
  function buildPrefix(game, index) {
    if (prefixCache[game]) return prefixCache[game];
    const map = new Map();
    index.forEach((e) => {
      // Indexa por PALAVRA: "Ariel - Spectacular Singer" entra em ari/spe/sin,
      // então buscar "singer" acha sem varrer tudo.
      const seen = new Set();
      norm(e.n).split(/[^a-z0-9]+/).forEach((w) => {
        if (w.length < PREFIX_LEN) return;
        const p = w.slice(0, PREFIX_LEN);
        if (seen.has(p)) return;
        seen.add(p);
        let arr = map.get(p);
        if (!arr) { arr = []; map.set(p, arr); }
        arr.push(e);
      });
    });
    prefixCache[game] = map;
    return map;
  }
  // Universo a percorrer: o menor balde entre os termos. Termo com menos de 3
  // letras (ou sem balde) cai no índice inteiro — correção acima de velocidade.
  function prefixCandidates(game, index, terms) {
    const map = buildPrefix(game, index);
    let melhor = null;
    for (const tm of terms) {
      if (tm.length < PREFIX_LEN) continue;
      const arr = map.get(tm.slice(0, PREFIX_LEN));
      if (!arr) return [];                       // nenhum nome começa assim
      if (!melhor || arr.length < melhor.length) melhor = arr;
    }
    return melhor || index;
  }

  // ---------------------------------------------------------------------------
  // Filtros por faceta. As opções saem do PRÓPRIO índice do jogo (não de uma
  // lista fixa): jogo sem custo não ganha filtro de custo, e nenhum jogo precisa
  // ser cadastrado à mão. Chaves do índice: k=cor, c=custo, t=tipo, r=raridade.
  // ---------------------------------------------------------------------------
  let facetSel = { k: "", c: "", t: "", r: "" };
  const facetOptsCache = {};
  function facetOptions(game, index) {
    if (facetOptsCache[game]) return facetOptsCache[game];
    const uniq = { k: new Set(), c: new Set(), t: new Set(), r: new Set() };
    index.forEach((e) => {
      rules.multi(e.k).forEach((v) => uniq.k.add(v));            // "Amber/Steel" -> 2 cores
      if (e.c != null && e.c !== "") uniq.c.add(String(e.c));
      // TIPO: no Magic o campo é a type_line inteira, então a lista crua virava
      // CENTENAS de opções ("Artifact // Artifact Creature — Golem"). O balde do
      // shared.js devolve o tipo de verdade (Criatura, Feitiço…).
      if (e.t) uniq.t.add(typeFacetValue(game, e.t));
      if (e.r) uniq.r.add(String(e.r));
    });
    const opts = {
      k: [...uniq.k].sort(),
      c: [...uniq.c].sort((a, b) => Number(a) - Number(b)),
      t: [...uniq.t].sort(),
      r: [...uniq.r].sort()
    };
    // Faceta com um valor só não filtra nada — não vira UI.
    Object.keys(opts).forEach((k) => { if (opts[k].length < 2) opts[k] = []; });
    facetOptsCache[game] = opts;
    return opts;
  }
  // Valor da faceta TIPO pra uma type_line — mesmo balde do agrupamento, então
  // a opção escolhida no filtro casa com o grupo mostrado na lista.
  function typeFacetValue(game, typeLine) {
    return shared.cardTypeGroup(game, { cardType: typeLine }).label || String(typeLine || "");
  }
  function passesFacets(e) {
    if (facetSel.k && !rules.multi(e.k).includes(facetSel.k)) return false;
    if (facetSel.c && String(e.c) !== facetSel.c) return false;
    if (facetSel.t && typeFacetValue(curGame(), e.t) !== facetSel.t) return false;
    if (facetSel.r && String(e.r || "") !== facetSel.r) return false;
    return true;
  }
  function facetsHtml(game) {
    const opts = facetOptsCache[game];
    if (!opts) return "";                                    // índice ainda não chegou
    const chips = (key, values, label) => {
      if (!values.length) return "";
      return `<div class="deck-facet"><span class="deck-facet-lbl">${esc(label)}</span>
        <div class="deck-facet-chips">` + values.map((v) =>
          `<button type="button" class="deck-facet-chip${facetSel[key] === v ? " on" : ""}" data-facet="${escA(key)}" data-facet-val="${escA(v)}"${key === "k" ? ` style="--fc:${escA(inkColor(v))}"` : ""}>${esc(prettyLabel(v))}</button>`).join("") + `</div></div>`;
    };
    const sel = (key, values, label) => {
      if (!values.length) return "";
      return `<div class="deck-facet"><span class="deck-facet-lbl">${esc(label)}</span>
        <select class="deck-facet-sel" data-facet-sel="${escA(key)}">
          <option value="">${esc(t("decks.facet.any"))}</option>
          ${values.map((v) => `<option value="${escA(v)}"${facetSel[key] === v ? " selected" : ""}>${esc(prettyLabel(v))}</option>`).join("")}
        </select></div>`;
    };
    const body = chips("k", opts.k, t("decks.facet.color"))
      + chips("c", opts.c, t("decks.facet.cost"))
      + sel("t", opts.t, t("decks.facet.type"))          // tipo pode ter 90+ valores: select
      + sel("r", opts.r, t("decks.facet.rarity"));
    if (!body) return "";
    const ativo = Object.keys(facetSel).some((k) => facetSel[k]);
    return `<div class="deck-facets">${body}${ativo ? `<button type="button" class="deck-mini" data-facet-clear>${esc(t("decks.facet.clear"))}</button>` : ""}</div>`;
  }

  // Resultados da busca — SEMPRE do jogo do deck (nunca mistura catálogo).
  // Varre o ÍNDICE (leve) e só depois baixa os chunks das ≤60 cartas exibidas.
  let searchSeq = 0;
  async function renderResults() {
    const box = document.getElementById("deckResults");
    if (!box) return;
    const deck = current;
    const q = query.trim();
    if (q.length < 2) { box.innerHTML = `<p class="deck-hint">${esc(t("decks.searchHint"))}</p>`; return; }
    const seq = ++searchSeq;                    // descarta resposta de busca velha
    // Índice do jogo ainda não chegou (8 MB no Magic numa 3G): a API na borda
    // responde JÁ, e o índice desce em paralelo — facetas e busca por
    // set/número continuam vindo dele. Com o índice na memória a busca local é
    // instantânea e sem rede, então a borda só serve o começo frio. As facetas
    // nunca estão ativas neste caminho: a UI delas nasce do próprio índice.
    let found = null;
    if (!indexReady[deck.game]) {
      const pApi = shared.searchApi(deck.game, q, 60);
      preloadIndexFor(deck.game);
      const daApi = await pApi;
      if (seq !== searchSeq) return;
      if (daApi && daApi.length) found = daApi.filter(passesFacets).slice(0, 60);
    }
    // Caminho estático: índice já presente, API desligada, ou zero resultados
    // dela (a borda busca por prefixo de palavra do NOME; número de
    // colecionador e nome do set só o índice acha).
    if (!found || !found.length) {
      let index;
      try { index = await searchIndexFor(deck.game); }
      catch (e) { box.innerHTML = `<p class="deck-hint">${esc(t("decks.loadError"))}</p>`; return; }
      if (seq !== searchSeq) return;
      // As opções de filtro saem do índice; ele chega assíncrono, então a UI de
      // facetas só existe a partir daqui.
      const hadOpts = !!facetOptsCache[deck.game];
      facetOptions(deck.game, index);
      const fbox = document.getElementById("deckFacets");
      if (fbox && !hadOpts) fbox.innerHTML = facetsHtml(deck.game);

      const terms = norm(q).split(/\s+/).filter(Boolean);
      // Candidatos pelo ÍNDICE DE PREFIXO em vez de varrer as 97k entradas do
      // Magic a cada tecla (2,5s no desktop, pior no celular). O prefixo de 3
      // letras do termo mais longo corta a busca pra algumas centenas.
      const pool = prefixCandidates(deck.game, index, terms);
      found = [];
      for (const e of pool) {
        // O haystack normalizado é memoizado no próprio item (`_h`): sem isso a
        // normalização (NFD + regex) rodava de novo a cada tecla digitada.
        const hay = e._h || (e._h = norm(e.n + " " + (e.s || "") + " " + (e.u || "")));
        if (terms.every((tm) => hay.includes(tm)) && passesFacets(e)) found.push(e);
        if (found.length >= 60) break;          // teto: o índice tem o jogo inteiro
      }
    }
    if (!found.length) { box.innerHTML = `<p class="deck-hint">${esc(t("decks.noResults"))}</p>`; return; }

    // Hidrata só os resultados exibidos (≤60): baixa os chunks dos sets deles.
    box.innerHTML = `<p class="deck-hint">${esc(t("decks.loading"))}</p>`;
    try { cat = await ensureCards(deck.game, found.map((e) => e.i)); }
    catch (e) { box.innerHTML = `<p class="deck-hint">${esc(t("decks.loadError"))}</p>`; return; }
    if (seq !== searchSeq) return;
    const hits = found.map((e) => cat.byId[e.i]).filter(Boolean);
    if (!hits.length) { box.innerHTML = `<p class="deck-hint">${esc(t("decks.noResults"))}</p>`; return; }
    const pack = packOf(deck);
    box.innerHTML = hits.map((c) => {
      const have = ownedCountOf(deck, c.id);
      const zones = rules.zonesForCard(pack, c);       // todas as que aceitam
      const def = rules.zoneForCard(pack, c);          // a padrão do "+"
      const img = c.image ? `<img src="${escA(c.image)}" alt="" loading="lazy">` : `<span class="deck-noimg"></span>`;
      // Mais de uma zona possível (main × side, main × commander): mostra um
      // botão por zona em vez de escolher pelo usuário.
      const btns = zones.length > 1
        ? zones.map((z) => `<button type="button" class="deck-mini" data-add="${escA(c.id)}" data-zone="${escA(z)}">${esc(t("decks.zone." + z))}</button>`).join("")
        : `<button type="button" class="deck-mini" data-add="${escA(c.id)}" data-zone="${escA(def || "")}"${def ? "" : " disabled"}>+</button>`;
      // O resultado INTEIRO adiciona (não só o "+"): alvo grande é o que se
      // espera ao montar deck. Com várias zonas possíveis, o clique no corpo vai
      // pra zona padrão e os botões seguem lá pra escolher explicitamente —
      // o closest("[data-add]") pega o botão antes do container.
      const clickable = def ? ` data-add="${escA(c.id)}" data-zone="${escA(def)}" title="${escA(t("decks.clickToAdd"))}"` : "";
      return `<div class="deck-hit${def ? " is-clickable" : (zones.length ? "" : " is-off")}"${clickable}>
        <span class="deck-hit-img">${img}</span>
        <span class="deck-hit-body">
          <span class="deck-hit-name">${esc(c.name)}</span>
          <span class="deck-hit-meta">${esc(c.set || "")} ${esc(c.number || "")}${printTags(c)}</span>
        </span>
        ${have ? `<span class="deck-own ok">${esc(t("decks.ownHave"))} ${esc(String(have))}</span>` : ""}
        <span class="deck-hit-btns">${btns}</span>
      </div>`;
    }).join("");
  }

  // Etiquetas da IMPRESSÃO no resultado da busca. Sem elas, procurar "Kuja" no
  // Magic devolvia cinco linhas idênticas ("Final Fantasy 232", "…399", "…497")
  // e não havia como saber qual é a versão que a pessoa tem na mão.
  // Só usa dado que EXISTE no catálogo:
  //   raridade  — 100% das cartas do Magic (e a maioria dos outros jogos);
  //   foil      — a variante Foil está na lista de variantes da carta;
  //   promo     — número com sufixo de letra (o "252s" do Scryfall é promo/
  //               special; número puro é a impressão normal do set);
  //   tratamento— `treat` (Extended Art, Borderless, Surge Foil…), que aparece
  //               depois do primeiro build completo do Magic.
  function printTags(card) {
    const tags = [];
    const r = String(card.rarity || "");
    if (r) {
      const k = `mtg.rarity.${r}`;
      const rot = t(k);
      tags.push(`<span class="deck-hit-tag rar-${escA(r)}">${esc(rot === k ? r : rot)}</span>`);
    }
    String(card.treat || "").split(";").filter(Boolean).forEach((tok) => {
      const k = `mtg.treat.${tok}`;
      const rot = t(k);
      tags.push(`<span class="deck-hit-tag is-treat">${esc(rot === k ? tok.charAt(0).toUpperCase() + tok.slice(1) : rot)}</span>`);
    });
    if (/[a-z]$/i.test(String(card.number || ""))) tags.push(`<span class="deck-hit-tag is-promo">${esc(t("decks.tag.promo"))}</span>`);
    if ((card.variants || []).some((v) => /foil/i.test(v))) tags.push(`<span class="deck-hit-tag is-foil">${esc(t("decks.tag.foil"))}</span>`);
    return tags.length ? ` ${tags.join("")}` : "";
  }

  // ---------------------------------------------------------------------------
  // Eventos (delegação — a UI é re-renderizada inteira a cada mudança)
  // ---------------------------------------------------------------------------
  el.gallery.addEventListener("click", (ev) => {
    if (ev.target.closest("#deckNew")) { openNewDeckModal(); return; }
    const dup = ev.target.closest("[data-deck-dup]");
    if (dup) {
      const src = getDeck(dup.dataset.deckDup);
      if (src) {
        const copy = JSON.parse(JSON.stringify(src));
        copy.id = newId(); copy.name = src.name + " " + t("decks.copySuffix");
        copy.createdAt = copy.updatedAt = Date.now();
        data.decks.unshift(copy); save(); renderGallery();
      }
      return;
    }
    const del = ev.target.closest("[data-deck-del]");
    if (del) {
      const d = getDeck(del.dataset.deckDel);
      if (d && confirm(t("decks.confirmDelete").replace("{name}", d.name))) {
        data.decks.splice(data.decks.indexOf(d), 1);
        data.deleted[d.id] = Date.now();     // tombstone: a exclusão precisa propagar
        save(); renderGallery();
      }
    }
  });

  el.editor.addEventListener("click", (ev) => {
    const add = ev.target.closest("[data-add]");
    if (add && !add.disabled) {
      const card = cat.byId[add.dataset.add];
      if (card && add.dataset.zone) {
        if (!tryAdd(current, add.dataset.zone, card, ev.target.closest(".deck-hit") || add)) return;
        renderEditor();
      }
      return;
    }
    // Abas do mobile: troca sem re-render (o DOM já tem as 3 áreas; o CSS
    // decide qual mostrar). Re-renderizar perderia o texto digitado na busca.
    const tab = ev.target.closest("[data-tab]");
    if (tab) {
      mobTab = tab.dataset.tab;
      el.editor.querySelector(".deck-ed-cols").dataset.mobtab = mobTab;
      el.editor.querySelectorAll(".deck-tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === mobTab)));
      if (mobTab === "find") { const s = document.getElementById("deckSearch"); if (s) s.focus(); }
      return;
    }

    // Despublicar: tira o deck da galeria (apaga a linha do share). O deck
    // continua no "Meus Decks" — só deixa de ser público.
    const unpub = ev.target.closest("[data-deck-unpublish]");
    if (unpub) {
      (async () => {
        if (!confirm(t("decks.confirmUnpublish").replace("{name}", current.name))) return;
        unpub.disabled = true;
        const r = await shared.deleteShare(current.publishedId);
        unpub.disabled = false;
        if (r && r.ok) {
          current.publishedId = null;
          current.publishedAt = null;
          touch(current);
          renderEditor();
        } else {
          alert(t(r && r.error === "auth" ? "decks.publishAuth" : "decks.unpublishFail"));
        }
      })();
      return;
    }

    // Publicar na comunidade (tabela shares, kind="deck"). Exige login; o botão
    // fica sempre visível pra função ser DESCOBRÍVEL — sem conta, explica.
    const pub = ev.target.closest("[data-deck-publish]");
    if (pub) {
      (async () => {
        if (!totalCards(current)) { alert(t("decks.publishEmpty")); return; }
        pub.disabled = true;
        const zones = {};
        Object.keys(current.zones || {}).forEach((k) => {
          zones[k] = (current.zones[k] || []).map((e) => ({ id: e.id, qty: e.qty }));
        });
        const handle = (shared.getProfile && (shared.getProfile() || {}).handle) || null;
        // `total` e `cover` vão GRAVADOS no payload pra galeria mostrar contagem
        // e capa sem baixar a lista de cartas de cada deck (o listShares pede só
        // estes campos via JSON path). Sem eles, a galeria teria que puxar as
        // zonas de 60 decks — dezenas de KB pra desenhar um card.
        // A capa é a URL da imagem, não o id: assim a galeria não precisa do
        // catálogo de cada jogo só pra resolver uma miniatura.
        const capa = current.coverCardId && cat.byId[current.coverCardId];
        // `cost`: RETRATO do valor do deck no momento de publicar. A galeria lê
        // por path (data->>cost), do mesmo jeito que total/cover — ela NÃO baixa
        // as zonas dos 60 decks (seriam dezenas de KB só pra desenhar cards), e
        // sem o retrato não teria como mostrar "custo estimado" na lista.
        // Em BRL, a moeda-base dos preços; quem lê converte pra moeda do header.
        // Deck publicado antes disto volta sem o campo e o card omite a linha.
        const custo = computeValue(current, cat.byId);
        const payload = {
          v: 1, name: current.name, game: current.game, format: current.format || null,
          author: handle, zones,
          total: totalCards(current),
          cost: Math.round((custo.total || 0) * 100) / 100,
          cover: (capa && capa.image) || null
        };
        // Já publicado -> ATUALIZA a mesma linha ("salvar público"): o id do
        // share não muda, então o link já compartilhado continua valendo e a
        // página /deck/<slug> mantém o endereço. Antes isto inseria de novo e
        // o mesmo deck aparecia DUPLICADO na galeria, sem como apagar o antigo.
        // Se o share sumiu (apagado por fora) ou a policy de UPDATE ainda não
        // foi aplicada, o update devolve "missing" e caímos no publicar normal.
        let res = null;
        if (current.publishedId) {
          res = await shared.updateShare(current.publishedId, current.name, payload);
          if (res && res.error === "missing") res = null;
        }
        if (!res) res = await shared.createShare("deck", current.name, payload, current.game);
        pub.disabled = false;
        if (res && res.id) {
          current.publishedId = res.id;
          current.publishedAt = Date.now();
          touch(current);
          const url = `${location.origin}${location.pathname.replace(/[^/]*$/, "")}decks.html?s=${res.id}`;
          try { await navigator.clipboard.writeText(url); } catch (e) { /* sem clipboard: o prompt abaixo cobre */ }
          window.prompt(t("decks.publishOk"), url);
          renderEditor();
        } else if (res && res.error === "auth") {
          alert(t("decks.publishAuth"));
        } else {
          // Anexa o motivo do servidor quando houver: "tente de novo em
          // instantes" é enganoso pra erro que NUNCA vai passar sozinho (foi o
          // caso do CHECK de `kind` sem 'deck' — ver 20260727a).
          const detalhe = res && (res.message || res.code) ? `\n\n(${res.code || res.status}: ${res.message || ""})` : "";
          alert(t("decks.publishFail") + detalhe);
        }
      })();
      return;
    }

    // Importar / copiar lista em texto
    if (ev.target.closest("[data-deck-import]")) { openImportModal(); return; }
    const cp = ev.target.closest("[data-deck-copy]");
    if (cp) {
      copyDeckText().then((ok) => {
        const before = cp.textContent;
        cp.textContent = t(ok ? "decks.copied" : "decks.copyFail");
        setTimeout(() => { cp.textContent = before; }, 1800);
      });
      return;
    }

    // Layout (grade/lista/pilha)
    const lay = ev.target.closest("[data-layout]");
    if (lay) { view.layout = lay.dataset.layout; saveView(); renderEditor(); return; }

    // Filtros por faceta: clicar no chip ativo desliga (toggle).
    const fc = ev.target.closest("[data-facet]");
    if (fc) {
      const k = fc.dataset.facet;
      facetSel[k] = facetSel[k] === fc.dataset.facetVal ? "" : fc.dataset.facetVal;
      refreshFacets();
      return;
    }
    if (ev.target.closest("[data-facet-clear]")) {
      facetSel = { k: "", c: "", t: "", r: "" };
      refreshFacets();
      return;
    }

    // +/− vale nos 3 layouts: linha (.deck-row) e miniatura (.deck-tile).
    const item = ev.target.closest(".deck-row, .deck-tile");
    if (!item) return;
    const card = cat.byId[item.dataset.card];
    if (!card) return;
    if (ev.target.closest("[data-inc]")) {
      if (!tryAdd(current, item.dataset.zone, card, item)) return;
      renderEditor();
    }
    else if (ev.target.closest("[data-dec]")) { addCard(current, item.dataset.zone, card, -1); renderEditor(); }
    else if (ev.target.closest("[data-proxy]")) {
      // Liga/desliga o proxy da entrada. `px` só existe quando true — entrada
      // sem a marca é o caso normal e não paga bytes no payload sincronizado.
      const entry = (current.zones[item.dataset.zone] || []).find((e) => e.id === card.id);
      if (entry) {
        if (entry.px) delete entry.px; else entry.px = 1;
        touch(current);
        renderEditor();
      }
    }
    else {
      // Clique fora do +/−: abre o card completo (texto, preço, marcar posse).
      hideHover();                                   // senão o preview de hover fica por cima
      const entry = (current.zones[item.dataset.zone] || []).find((e) => e.id === card.id);
      cardPreview.open(card.id, (entry && entry.variant) || shared.defaultVariant(card));
    }
  });

  // Redesenha só o bloco de facetas + resultados (não o editor inteiro: perderia
  // o foco do campo de busca no meio da digitação).
  function refreshFacets() {
    const fbox = document.getElementById("deckFacets");
    if (fbox && current) fbox.innerHTML = facetsHtml(current.game);
    renderResults();
  }

  // Agrupar / ordenar / facetas em <select> (não disparam "click" útil)
  el.editor.addEventListener("change", (ev) => {
    if (ev.target.id === "deckGroupBy") { view.group = ev.target.value; saveView(); renderEditor(); }
    else if (ev.target.id === "deckSortBy") { view.sort = ev.target.value; saveView(); renderEditor(); }
    else if (ev.target.dataset && ev.target.dataset.facetSel) {
      facetSel[ev.target.dataset.facetSel] = ev.target.value;
      refreshFacets();
    }
  });

  // ---------------------------------------------------------------------------
  // Preview no hover — SÓ na visão de lista (grade e pilha já mostram a arte).
  // Na lista você lê nomes; a imagem é o que faz reconhecer a carta rápido.
  // ---------------------------------------------------------------------------
  const HOVER_W = 244;                 // largura do preview (proporção 63/88)
  const HOVER_H = Math.round(HOVER_W * 88 / 63);
  const canHover = !window.matchMedia || window.matchMedia("(hover: hover)").matches;
  let hoverEl = null;

  function hoverBox() {
    if (hoverEl) return hoverEl;
    hoverEl = document.createElement("div");
    hoverEl.className = "deck-hover";
    hoverEl.setAttribute("aria-hidden", "true"); // decorativo: o nome já está na linha
    hoverEl.hidden = true;
    hoverEl.innerHTML = '<img alt="">';
    document.body.appendChild(hoverEl);
    return hoverEl;
  }
  // Segue o CURSOR. (Ancorar na linha deixava o preview sempre no mesmo X, já que
  // todas as linhas terminam na mesma borda — parecia preso no meio da tela.)
  function placeHover(x, y) {
    const box = hoverBox();
    const pad = 18;
    // À direita do cursor; se não couber, vai pra esquerda dele.
    let left = x + pad;
    if (left + HOVER_W > window.innerWidth - 8) left = x - pad - HOVER_W;
    if (left < 8) left = 8;
    // Centrado no cursor, preso à janela — nunca sai da tela.
    let top = y - HOVER_H / 2;
    top = Math.max(8, Math.min(top, window.innerHeight - HOVER_H - 8));
    box.style.left = left + "px";
    box.style.top = top + "px";
  }
  // Sem cursor (foco por teclado): usa a linha como referência.
  function placeHoverAtRow(row) {
    const r = row.getBoundingClientRect();
    placeHover(r.right, r.top + r.height / 2);
  }
  function showHover(card, x, y) {
    if (!card || !card.image) return hideHover();
    const box = hoverBox();
    const img = box.querySelector("img");
    if (img.getAttribute("src") !== card.image) img.setAttribute("src", card.image);
    box.hidden = false;
    placeHover(x, y);
  }
  function hideHover() { if (hoverEl) hoverEl.hidden = true; }

  if (canHover) {
    el.editor.addEventListener("mouseover", (ev) => {
      // Só linha de lista: nas miniaturas a arte já está à vista.
      const row = ev.target.closest(".deck-row[data-card]");
      if (!row) return;
      showHover(cat && cat.byId ? cat.byId[row.dataset.card] : null, ev.clientX, ev.clientY);
    });
    // Acompanha o cursor enquanto anda pela linha.
    el.editor.addEventListener("mousemove", (ev) => {
      if (hoverEl && !hoverEl.hidden && ev.target.closest(".deck-row[data-card]")) placeHover(ev.clientX, ev.clientY);
    });
    el.editor.addEventListener("mouseout", (ev) => {
      const to = ev.relatedTarget;
      if (!to || !to.closest || !to.closest(".deck-row[data-card]")) hideHover();
    });
    // Teclado: quem navega por Tab cai nos botões +/− da linha e também vê a arte.
    el.editor.addEventListener("focusin", (ev) => {
      const row = ev.target.closest(".deck-row[data-card]");
      if (!row) return hideHover();
      const card = cat && cat.byId ? cat.byId[row.dataset.card] : null;
      if (!card || !card.image) return hideHover();
      const box = hoverBox();
      const img = box.querySelector("img");
      if (img.getAttribute("src") !== card.image) img.setAttribute("src", card.image);
      box.hidden = false;
      placeHoverAtRow(row);
    });
    // Rolar/sair da aba com o preview aberto deixaria ele "solto" na tela.
    window.addEventListener("scroll", hideHover, { passive: true });
    window.addEventListener("blur", hideHover);
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  const id = new URLSearchParams(location.search).get("id");
  const deck = id ? getDeck(id) : null;
  if (deck) openEditor(deck);
  else { show("gallery"); renderGallery(); }
})();
