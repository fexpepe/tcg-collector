// Pastas (pastas.html) — as antigas Listas, renomeadas em 2026-09-16. Uma
// página, duas vistas:
//   sem ?id=  -> galeria das minhas pastas
//   com ?id=  -> a pasta aberta, com a cara da Toda Coleção: cartão-herói em
//                cima (nome, valor, contagens, ações: adicionar, exportar,
//                compartilhar, excluir) e as cartas em grade embaixo. O painel
//                "Adicionar cartas" (linha por carta, sem imagem — o modo rápido
//                de cadastrar) abre por cima da grade quando a pessoa pede.
// (mesmo padrão do my-decks.html). O STORE vive no shared.js, porque o botão
// de pasta do tile e o bloco do popup do card também precisam dele. As chaves
// de i18n e o store continuam `lists`/`ls_` por dentro: renomear dado de
// usuário e três idiomas de chave não muda nada pra quem usa. Ver docs/LISTAS.md.
(function () {
  "use strict";
  const shared = window.TCGShared;
  if (!shared) return;
  const t = shared.t;
  const tn = shared.tn;
  const esc = shared.escapeHtml;
  const escA = shared.escapeAttribute;
  const store = shared.createListStore();

  // Paleta da pasta: o azul da primeira posição é o padrão de quem nasce sem
  // cor (ver createListStore). São tons que funcionam nos dois temas e se
  // distinguem entre si na bolinha pequena da galeria.
  const LIST_COLORS = ["#3b6fe0", "#8b5cf6", "#ec4899", "#e8553c", "#f59e0b", "#2ecc71", "#14b8a6", "#64748b"];

  const el = {
    gallery: document.getElementById("listGallery"),
    editor: document.getElementById("listEditor")
  };
  if (!el.gallery || !el.editor) return;

  function show(which) {
    el.gallery.hidden = which !== "gallery";
    el.editor.hidden = which !== "editor";
  }

  // Ícones das ações do cartão-herói: os MESMOS da Toda Coleção (collection.html),
  // pra "exportar a pasta" e "compartilhar a pasta" terem a mesma cara que
  // "exportar/compartilhar a coleção". Inline (CSP 'self', currentColor).
  const IC = {
    add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    export: '<svg class="icon-btn-main" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v11"/><path d="m8 10.5 4 4 4-4"/><path d="M4.5 16.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2"/></svg>',
    share: '<svg class="icon-btn-main" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5.5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="18.5" r="2.6"/><path d="m8.4 10.8 7.2-4M8.4 13.2l7.2 4"/></svg><svg class="icon-btn-ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    trash: '<svg class="icon-btn-main" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12"/><path d="M10 11v6M14 11v6"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    // Contagens do cartão-herói: cópias = cartas empilhadas; distintas = uma
    // carta; sets = grade; valor = moeda (os mesmos do collection.html).
    money: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.2v9.6M14.4 9.6c0-1-1.1-1.6-2.4-1.6s-2.4.6-2.4 1.6 1 1.5 2.4 1.9 2.5 1 2.5 2-1.1 1.7-2.5 1.7-2.5-.7-2.5-1.7"/></svg>',
    copies: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="3" width="12" height="16" rx="2"/><path d="M4 7v12a2 2 0 0 0 2 2h9"/></svg>',
    distinct: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8.5h6M9 12h6M9 15.5h3"/></svg>',
    sets: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/></svg>',
    minus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    remove: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12"/></svg>'
  };

  // ---------------------------------------------------------------------------
  // Catálogo do jogo da pasta (pode ser != do jogo da sessão). Nunca baixa o
  // catálogo inteiro: só os chunks dos sets das cartas pedidas — Yu-Gi-Oh! tem
  // 46k cartas e Magic 97k. Mesmo desenho do editor de decks.
  // ---------------------------------------------------------------------------
  const catalogCache = {};
  async function ensureCards(game, ids) {
    const entry = catalogCache[game] || (catalogCache[game] = { byId: {} });
    const need = (ids || []).filter((id) => !entry.byId[id]);
    if (!need.length) return entry;
    const r = await shared.loadGameCatalog(game, shared.gameDataDir(game), need);
    (r.cards || []).forEach((c) => { c.game = game; entry.byId[c.id] = c; });
    // cardValue lê window.TCG_PRICING; loadGameCatalog restaura o da sessão, então
    // mescla o do jogo da pasta pra o preço não sair zerado.
    if (r.pricing) window.TCG_PRICING = Object.assign({}, window.TCG_PRICING || {}, r.pricing);
    return entry;
  }

  // Hidratação que aceita pasta SEM jogo (migrada de tag cross-game, game null).
  // O jogo de cada id sai da coleção local (a tag marcava carta que a pessoa
  // tem); id que não está em coleção nenhuma fica sem carta — o tile mostra o
  // id cru, porque chutar um catálogo era o bug (carregava o do Pokémon e, pior,
  // a adição vinculada gravava na coleção do jogo da SESSÃO).
  // Devolve sempre a MESMA entrada mutável (`__mista` no cache) pra carta achada
  // depois — pela busca, por ex. — aparecer na grade sem re-hidratar.
  async function hydrateList(game, ids) {
    if (game) return ensureCards(game, ids);
    const entry = catalogCache.__mista || (catalogCache.__mista = { byId: {} });
    const porJogo = {};
    (ids || []).forEach((id) => {
      if (entry.byId[id]) return;
      const g = shared.GAME_SLUGS.find((s) => ownedFor(s).has(id));
      if (g) (porJogo[g] = porJogo[g] || []).push(id);
    });
    await Promise.all(Object.keys(porJogo).map(async (g) => {
      const c = await ensureCards(g, porJogo[g]);
      porJogo[g].forEach((id) => { if (c.byId[id]) entry.byId[id] = c.byId[id]; });
    }));
    return entry;
  }

  // Índice de sets do jogo ([{ name, cardIds }]): leve, e é o que dá a lista de
  // sets do wizard E os ids do checklist, sem tocar o catálogo.
  const setsCache = {};
  function setsOf(game) {
    if (!setsCache[game]) {
      setsCache[game] = shared.loadGameIndexSlice(game, "sets").then((s) => (Array.isArray(s) ? s : []));
    }
    return setsCache[game];
  }

  // Stores por jogo, criados UMA vez cada (leem e parseiam o localStorage inteiro).
  const ownedCache = {}, priceCache = {};
  const ownedFor = (g) => ownedCache[g] || (ownedCache[g] = shared.createCollectionStore(g));
  const pricesFor = (g) => priceCache[g] || (priceCache[g] = shared.createPriceStore(g));

  // Mesma normalização do resto do site: minúsculas + NFD sem acento latino
  // (preserva japonês/chinês, que não usam essa faixa de combinantes).
  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  function listName(list) { return list.name || t("lists.untitled"); }
  function entryQty(entry) { return entry.q == null ? 1 : entry.q; }
  function entryVariant(entry, card) { return entry.v || (card ? shared.defaultVariant(card) : "Normal"); }
  // Valor UNITÁRIO da entrada (a grade mostra o unitário; o total sai no herói).
  function entryUnit(list, entry, card) {
    if (!card) return 0;
    // Jogo da CARTA primeiro: pasta migrada de tag pode não ter jogo (null
    // cairia no store de preços manuais do jogo da sessão).
    return (shared.cardValue(card, entryVariant(entry, card), pricesFor(card.game || list.game), entry.c) || {}).value || 0;
  }
  function listValue(list, byId) {
    return list.entries.reduce((s, e) => s + entryUnit(list, e, byId[e.id]) * entryQty(e), 0);
  }

  // ===========================================================================
  // Galeria
  // ===========================================================================
  function listCardHtml(list) {
    const n = store.countOf(list.id);
    const badge = list.linked ? t("lists.linkedBadge") : t("lists.standaloneBadge");
    return `
      <a class="list-card" href="pastas?id=${encodeURIComponent(list.id)}" style="--lc:${escA(list.color)}">
        <span class="list-card-bar" aria-hidden="true"></span>
        <span class="list-card-body">
          <strong>${esc(listName(list))}</strong>
          <span class="list-card-meta">
            ${list.game ? shared.gameTagHtml(list.game) : ""}
            <span class="list-card-count">${esc(tn("lists.count", n))}</span>
          </span>
        </span>
        <span class="list-card-badge${list.linked ? " is-linked" : ""}">${esc(badge)}</span>
      </a>`;
  }

  function renderGallery() {
    show("gallery");
    const lists = store.list();
    el.gallery.innerHTML = `
      <div class="page-head dash-head">
        <div>
          <h1>${esc(t("nav.lists"))}</h1>
          <p class="page-head-sub">${esc(t("lists.intro"))}</p>
        </div>
        <a href="dashboard" class="serie-back">${esc(t("nav.backDashboard"))}</a>
      </div>
      <div class="list-actions">
        <button type="button" class="cta" data-list-new>+ ${esc(t("lists.new"))}</button>
      </div>
      ${lists.length
        ? `<div class="list-grid">${lists.map(listCardHtml).join("")}</div>`
        : `<p class="empty-state">${esc(t("lists.empty"))}<br><span class="empty-hint">${esc(t("lists.emptyHint"))}</span></p>`}`;
  }

  // ===========================================================================
  // Wizard: nome+tipo -> jogo -> set (opcional)
  // ===========================================================================
  function openWizard() {
    if (store.atLimit()) { alert(t("lists.limit", { n: store.LIST_LIMIT })); return; }
    const wrap = document.createElement("div");
    wrap.className = "list-modal";
    document.body.appendChild(wrap);
    document.body.classList.add("preview-open"); // trava a rolagem do fundo (body+html)

    const draft = { name: "", linked: false, game: null, set: null };

    // A ação primária do passo entra no rodapé, junto do Cancelar — mesmo
    // arranjo dos modais de exportar/aplicar, pra ação nunca boiar no corpo.
    function box(inner, foot = "") {
      wrap.innerHTML = `<div class="list-modal-box" role="dialog" aria-modal="true" aria-label="${escA(t("lists.new"))}">${inner}
        <div class="list-modal-foot">${foot}<button type="button" class="lst-mini" data-wz-cancel>${esc(t("lists.cancel"))}</button></div>
      </div>`;
    }

    // Passo 1: nome + o que a pasta faz. O tipo nasce AVULSO: gravar na coleção
    // de quem só queria anotar cartas é o erro caro; o contrário é um clique.
    function stepName() {
      box(`
        <h2>${esc(t("lists.wizard.name"))}</h2>
        <input type="text" id="wzName" class="list-input" maxlength="40"
               placeholder="${escA(t("lists.wizard.namePlaceholder"))}" value="${escA(draft.name)}">
        <h3>${esc(t("lists.wizard.type"))}</h3>
        <div class="list-type-pick">
          <button type="button" class="list-type${draft.linked ? "" : " is-on"}" data-wz-linked="0">
            <strong>${esc(t("lists.standalone"))}</strong><span>${esc(t("lists.standaloneHint"))}</span>
          </button>
          <button type="button" class="list-type${draft.linked ? " is-on" : ""}" data-wz-linked="1">
            <strong>${esc(t("lists.linked"))}</strong><span>${esc(t("lists.linkedHint"))}</span>
          </button>
        </div>`,
        `<button type="button" class="cta" data-wz-next>${esc(t("lists.next"))}</button>`);
      const input = wrap.querySelector("#wzName");
      if (input) {
        input.focus();
        input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { draft.name = input.value; stepGame(); } });
      }
    }

    function stepGame() {
      const input = wrap.querySelector("#wzName");
      if (input) draft.name = input.value;
      // data-wz-game (e não data-game): o <html> carrega data-game com o jogo da
      // SESSÃO, e um closest("[data-game]") casaria com ele — qualquer clique no
      // modal viraria "escolheu o jogo da sessão".
      const games = shared.GAME_SLUGS.map((g) =>
        `<button type="button" class="lst-game-pick" data-wz-game="${escA(g)}">${shared.gameTagHtml(g)}</button>`).join("");
      box(`<h2>${esc(t("lists.wizard.game"))}</h2><div class="lst-game-list">${games}</div>`);
    }

    async function stepSet(game) {
      box(`<h2>${esc(t("lists.wizard.set"))}</h2>
        <p class="list-modal-hint">${esc(t("lists.wizard.setHint"))}</p>
        <input type="search" id="wzSetSearch" class="list-input" placeholder="${escA(t("lists.wizard.setSearch"))}">
        <div class="list-set-picks" id="wzSets"><p class="empty-state">${esc(t("lists.loading"))}</p></div>`,
        `<button type="button" class="lst-mini" data-wz-skipset>${esc(t("lists.wizard.setSkip"))}</button>`);
      const sets = await setsOf(game);
      const box2 = wrap.querySelector("#wzSets");
      if (!box2) return;                                  // fechou o modal enquanto carregava
      const render = (q) => {
        const nq = norm(q);
        const hits = sets.filter((s) => !nq || norm(s.name).includes(nq)).slice(0, 60);
        box2.innerHTML = hits.length
          ? hits.map((s) => `<button type="button" class="list-set-pick" data-wz-set="${escA(s.name)}">
              <span>${esc(s.name)}</span><small>${esc(tn("lists.count", (s.cardIds || []).length))}</small>
            </button>`).join("")
          : `<p class="empty-state">${esc(t("lists.wizard.setEmpty"))}</p>`;
      };
      render("");
      const si = wrap.querySelector("#wzSetSearch");
      if (si) { si.addEventListener("input", () => render(si.value)); si.focus(); }
    }

    function go() {
      const list = store.create(draft);
      wrap.remove(); document.body.classList.remove("preview-open");
      if (!list) { alert(t("lists.limit", { n: store.LIST_LIMIT })); return; }
      location.href = `pastas?id=${encodeURIComponent(list.id)}`;
    }

    stepName();
    wrap.addEventListener("click", (ev) => {
      if (ev.target === wrap || ev.target.closest("[data-wz-cancel]")) { wrap.remove(); document.body.classList.remove("preview-open"); return; }
      const ty = ev.target.closest("[data-wz-linked]");
      if (ty) {
        const input = wrap.querySelector("#wzName");
        if (input) draft.name = input.value;
        draft.linked = ty.dataset.wzLinked === "1";
        stepName();
        return;
      }
      if (ev.target.closest("[data-wz-next]")) { stepGame(); return; }
      const g = ev.target.closest("[data-wz-game]");
      if (g) { draft.game = g.dataset.wzGame; stepSet(draft.game); return; }
      const s = ev.target.closest("[data-wz-set]");
      if (s) { draft.set = s.dataset.wzSet; go(); return; }
      if (ev.target.closest("[data-wz-skipset]")) { draft.set = null; go(); }
    });
  }

  // ===========================================================================
  // Pasta aberta
  // ===========================================================================
  let current = null;      // pasta aberta
  let cat = null;          // { byId } do jogo da pasta
  let sourceCards = [];    // cartas do painel "Adicionar" (set inteiro ou busca)
  let sourceLoading = false;
  // Busca cross-game (pasta sem jogo) que não pôde ser feita: a ponte é o único
  // caminho aqui, então "não deu" precisa aparecer diferente de "não achei".
  let buscaIndisponivel = false;
  let query = "";
  let openPicker = null;   // cardId com o seletor de variante aberto
  let addOpen = false;     // painel "Adicionar cartas" aberto?
  let lastCondition = shared.DEFAULT_CONDITION;  // lembrada na sessão: cadastrar
                                                 // um set inteiro é quase sempre
                                                 // na mesma condição
  let preview = null;      // popup do card (createCardPreview), montado uma vez

  // Popup do card ao clicar na imagem do tile — o MESMO da Toda Coleção. A
  // pasta pode misturar jogos (migrada de tag), então os stores são os
  // "mesclados" por jogo da carta, como no Hub. O +/− de dentro do popup mexe
  // na COLEÇÃO (é o popup do card, não da pasta); a quantidade NA PASTA é o
  // stepper do tile.
  function ensurePreview() {
    if (preview) return;
    const ownedByGame = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, ownedFor(g)]));
    const pricesByGame = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, pricesFor(g)]));
    const gameOf = (id) => ((cat && cat.byId[id]) || {}).game || (current && current.game) || "pokemon";
    preview = shared.createCardPreview({
      getCard: (id) => (cat ? cat.byId[id] : null),
      store: shared.mergedCollectionStore(ownedByGame, gameOf),
      prices: shared.mergedPriceStore(pricesByGame, gameOf),
      onOwnedChange: () => {}
    });
  }

  async function openEditor(list) {
    current = list;
    show("editor");
    el.editor.innerHTML = `<p class="empty-state">${esc(t("lists.loading"))}</p>`;
    try {
      // loadFxRates é OBRIGATÓRIO antes de calcular valor: sem as taxas,
      // convertMoney devolve null e cardValue cai pra 0 — o herói sairia zerado
      // mesmo com preço no catálogo.
      // Pasta de set: dispara o índice de sets JÁ (o loadSource espera o cache
      // — antes eram 3 idas à rede em série no primeiro abrir).
      if (list.set) setsOf(list.game);
      const [c] = await Promise.all([
        hydrateList(list.game, store.cardIdsOf(list.id)),
        shared.loadFxRates()
      ]);
      cat = c;
    } catch (e) {
      el.editor.innerHTML = `<p class="empty-state">${esc(t("lists.loadError"))}</p>`;
      return;
    }
    ensurePreview();
    // Pasta vazia abre JÁ com o painel de adicionar: é a única coisa a fazer
    // nela. Com cartas, a grade é o que a pessoa veio ver.
    addOpen = !list.entries.length;
    renderEditor();
    loadSource();
  }

  // --- Painel "Adicionar cartas": a fonte das cartas -------------------------
  async function loadSource() {
    if (!current) return;
    if (current.set) {
      sourceLoading = true;
      renderSource();
      try {
        const sets = await setsOf(current.game);
        const found = sets.find((s) => s.name === current.set);
        const ids = (found && found.cardIds) || [];
        const c = await ensureCards(current.game, ids);
        sourceCards = ids.map((id) => c.byId[id]).filter(Boolean);
      } catch (e) { sourceCards = []; }
      sourceLoading = false;
      renderSource();
      return;
    }
    runSearch();
  }

  let searchSeq = 0;
  async function runSearch() {
    const q = query.trim();
    if (q.length < 2) { sourceCards = []; renderSource(); return; }
    const seq = ++searchSeq;
    sourceLoading = true;
    buscaIndisponivel = false;
    renderSource();
    let hits = null;
    const jogo = current.game;
    if (!jogo) {
      // Pasta sem jogo (migrada de tag cross-game): só a borda busca em todos
      // os catálogos de uma vez (game=all, cada hit traz o jogo em h.g). O
      // índice local é por jogo — usar um seria chutar o catálogo errado, que
      // era exatamente o bug (mandava game=null: 400 + pausa da bridge).
      // Este é o ÚNICO caminho de busca do site que depende 100% da borda (o
      // índice local é por jogo e a pasta não tem um). searchApi devolve null
      // quando a ponte falhou ou está em pausa — diferente de [], que é
      // "procurei e não achei". Sem separar os dois, a pasta dizia "nada
      // encontrado" com a busca simplesmente fora do ar.
      const resposta = await shared.searchApi("all", q, 60);
      if (seq !== searchSeq) return;
      buscaIndisponivel = resposta == null;
      hits = resposta || [];
    } else {
      // Caminho frio: a borda responde em KB enquanto o índice (8 MB no Magic)
      // baixa em segundo plano. Depois que ele está na memória, a busca local é
      // instantânea e sem rede.
      if (!shared.searchIndexLoaded(jogo)) {
        const pApi = shared.searchApi(jogo, q, 60);
        shared.loadSearchIndex(jogo).catch(() => { /* o local reporta */ });
        hits = await pApi;
        if (seq !== searchSeq) return;
      }
      // VAZIO não é resposta final (mesma regra do explore.js): a borda devolve
      // [] com o banco em recarga de deploy, e um vazio antigo pode ficar preso
      // em cache — só o índice local pode afirmar "essa carta não existe".
      if (!hits || !hits.length) {
        const idx = await shared.loadSearchIndex(jogo).catch(() => []);
        if (seq !== searchSeq) return;
        // Número em todas as escritas ("9" acha "009" e vice-versa); a fração
        // digitada ("009/094") casa pela parte antes da barra — o índice
        // estático não guarda o total do set.
        const nq = norm(q);
        const nqNum = nq.replace(/[()#]/g, " ").trim().split("/")[0].trim();
        hits = idx.filter((e) => norm(e.n).includes(nq)
          || shared.numberSearchForms(e.u).some((f) => norm(f) === nq || norm(f) === nqNum)).slice(0, 60);
      }
    }
    try {
      let c;
      if (jogo) {
        c = await ensureCards(jogo, hits.map((h) => h.i));
      } else {
        // Hidrata por jogo (h.g vem do D1) e acumula na mesma entrada mista da
        // hidratação inicial — a grade enxerga a carta na hora.
        const porJogo = {};
        hits.forEach((h) => { const g = h.g || "pokemon"; (porJogo[g] = porJogo[g] || []).push(h.i); });
        const mista = catalogCache.__mista || (catalogCache.__mista = { byId: {} });
        await Promise.all(Object.keys(porJogo).map(async (g) => {
          const cg = await ensureCards(g, porJogo[g]);
          porJogo[g].forEach((id) => { if (cg.byId[id]) mista.byId[id] = cg.byId[id]; });
        }));
        c = mista;
      }
      if (seq !== searchSeq) return;
      sourceCards = hits.map((h) => c.byId[h.i]).filter(Boolean);
    } catch (e) { sourceCards = []; }
    sourceLoading = false;
    renderSource();
  }

  // --- HTML ------------------------------------------------------------------
  function condOptions(selected) {
    return shared.CARD_CONDITIONS.map((c) =>
      `<option value="${escA(c)}"${c === selected ? " selected" : ""}>${esc(c)}</option>`).join("");
  }

  // Linha do painel de adicionar: SEM imagem (é o ponto do modo). O nome carrega
  // a URL da carta em data-thumb; o hover mostra a miniatura flutuante.
  // Pertencimento no nível da CARTA, calculado UMA vez por render (o has() do
  // store é uma varredura linear das entradas — chamado por linha, o painel
  // virava O(linhas × entradas) a cada repintura).
  function idsNaLista() {
    return new Set(store.entriesOf(current.id).map((e) => e.id));
  }
  function sourceRowHtml(card, dentro) {
    const naLista = dentro.has(card.id);
    const variants = shared.cardVariants(card);
    const img = shared.cardImageSources(card) || {};
    const picker = openPicker === card.id ? variantPickerHtml(card, variants) : "";
    return `
      <div class="lst-row${naLista ? " is-in" : ""}" data-src-card="${escA(card.id)}">
        <button type="button" class="lst-name" data-thumb="${escA(img.url || "")}" data-thumb-fb="${escA(img.fallback || "")}" data-src-open="${escA(card.id)}">
          ${esc(card.name)}
        </button>
        <span class="lst-num">${esc(card.number || "")}</span>
        <span class="lst-rar">${esc(card.rarity || "")}</span>
        <button type="button" class="lst-add" data-src-add="${escA(card.id)}" title="${escA(t("lists.addOne"))}">+</button>
        ${picker}
      </div>`;
  }

  // Seletor inline de versão/condição/quantidade — na própria linha, sem modal:
  // abrir uma janela por carta destruiria a velocidade que é o motivo da tela.
  function variantPickerHtml(card, variants) {
    const chips = variants.map((v, i) =>
      `<button type="button" class="lst-chip${i === 0 ? " is-on" : ""}" data-pick-variant="${escA(v)}">${esc(v)}</button>`).join("");
    return `
      <div class="lst-picker" data-picker-for="${escA(card.id)}">
        <div class="lst-chips">${chips}</div>
        <label class="lst-field">${esc(t("lists.condition"))}
          <select data-pick-cond>${condOptions(lastCondition)}</select>
        </label>
        <label class="lst-field">${esc(t("lists.qty"))}
          <input type="number" min="1" max="99" value="1" data-pick-qty>
        </label>
        <button type="button" class="cta lst-confirm" data-pick-confirm="${escA(card.id)}">${esc(t("lists.addOne"))}</button>
      </div>`;
  }

  // Tile de uma entrada da pasta: o MESMO .card-tile da Coleção (imagem, nome,
  // versão, set · número, preço), com o rodapé trocado — em vez de ♥/−/+ da
  // posse, o stepper da quantidade NA PASTA e o "tirar da pasta". A imagem abre
  // o popup do card (data-preview-card-id, como em toda grade).
  function entryTileHtml(entry) {
    const card = cat.byId[entry.id];
    const name = card ? card.name : entry.id;
    const variant = entryVariant(entry, card);
    const q = entryQty(entry);
    const unit = entryUnit(current, entry, card);
    const img = (card && shared.cardImageSources(card)) || {};
    const image = img.url
      ? shared.localizedImg(img.url, { alt: name, fallback: img.fallback || "", loading: "lazy", thumb: true })
      : "";
    const varLabel = card ? shared.variantDisplayLabel(card, variant) : variant;
    return `
      <article class="card-tile pasta-tile" data-entry="${escA(entry.id)}" data-entry-variant="${escA(entry.v || "")}">
        <div class="card-image">${card
          ? `<button class="image-open" data-preview-card-id="${escA(card.id)}" data-preview-variant="${escA(variant)}" aria-label="${escA(t("card.zoom", { name }))}">${image}</button>`
          : `<span class="pasta-noimg" aria-hidden="true"></span>`}</div>
        <div class="tile-info">
          <h3>${esc(name)}</h3>
          <p class="tile-variant">${card ? shared.cardFlag(card.language) : ""}<span>${esc(varLabel)}${entry.c ? ` · ${esc(entry.c)}` : ""}</span></p>
          <p class="tile-set"><span>${card ? `${esc(card.set || "")} · ${esc(card.number || "")}` : ""}</span></p>
          ${unit ? `<p class="tile-price">${esc(shared.formatMoney(shared.getCurrency(), unit))}</p>` : ""}
          <div class="tile-foot">
            <div class="tile-actions pasta-qty">
              <button type="button" class="tile-btn pasta-del" data-entry-del aria-label="${escA(t("lists.removeEntry"))}" title="${escA(t("lists.removeEntry"))}">${IC.remove}</button>
              <button type="button" class="tile-btn" data-entry-dec aria-label="${escA(t("lists.qtyMinus"))}" title="${escA(t("lists.qtyMinus"))}">${IC.minus}</button>
              <span class="pasta-qty-n" aria-live="polite">×${q}</span>
              <button type="button" class="tile-btn" data-entry-inc aria-label="${escA(t("lists.qtyPlus"))}" title="${escA(t("lists.qtyPlus"))}">${IC.plus}</button>
            </div>
          </div>
        </div>
      </article>`;
  }

  // Números do cartão-herói: as MESMAS três contagens da Toda Coleção (cópias,
  // distintas, sets) + valor de mercado — a pasta é "uma coleção só dela".
  function stats() {
    const list = current;
    let copies = 0;
    const ids = new Set(), sets = new Set();
    list.entries.forEach((e) => {
      copies += entryQty(e);
      ids.add(e.id);
      const card = cat.byId[e.id];
      if (card && card.set) sets.add(card.set);
    });
    return { copies, distinct: ids.size, sets: sets.size, value: listValue(list, cat.byId) };
  }

  function statHtml(icon, id, value, label, extra) {
    return `<div${extra || ""}><span class="dash-stat-ic" aria-hidden="true">${icon}</span><span class="dash-stat-txt"><span class="dash-stat-val" id="${id}">${value}</span><span class="dash-stat-label">${esc(label)}</span></span></div>`;
  }

  function renderEditor() {
    const list = current;
    const s = stats();
    const money = s.value > 0 ? shared.formatMoney(shared.getCurrency(), s.value) : "—";
    el.editor.innerHTML = `
      <div class="page-head dash-head lst-head" style="--lc:${escA(list.color)}">
        <div>
          <h1><input type="text" id="lstName" class="lst-title" maxlength="40" value="${escA(listName(list))}" aria-label="${escA(t("lists.wizard.name"))}"></h1>
        </div>
        <a href="pastas" class="serie-back">${esc(t("lists.backToLists"))}</a>
      </div>

      <!-- Cartão-herói: o MESMO DOM da Toda Coleção (collection.html) — a
           identidade da pasta (cor + jogo/set + tipo) à esquerda, o valor na
           caixa fixa, as ações na ponta; as 3 contagens embaixo. -->
      <section class="collection-dashboard collection-dashboard-hero pasta-dashboard" style="--lc:${escA(list.color)}">
        <article class="dash-card dash-stats dash-stats-hero">
          <div class="dash-stats-head">
            <div class="dash-profile pasta-identity">
              <div class="dash-profile-who">
                <span class="dash-avatar pasta-avatar" aria-hidden="true"><span class="dash-avatar-in">${IC.folder}</span></span>
                <div class="dash-profile-id">
                  <span class="pasta-meta">
                    ${list.game ? shared.gameTagHtml(list.game) : ""}
                    ${list.set ? `<span class="lst-setname">${esc(list.set)}</span>` : ""}
                    <span class="list-card-badge${list.linked ? " is-linked" : ""}">${esc(list.linked ? t("lists.linkedBadge") : t("lists.standaloneBadge"))}</span>
                  </span>
                  <span class="pasta-meta">
                    <label class="lst-linked"><input type="checkbox" data-list-linked${list.linked ? " checked" : ""}> ${esc(t("lists.linked"))}</label>
                    <!-- COR da pasta: a store já tinha setColor desde o começo e
                         nada chamava, então toda pasta nascia e morria no azul
                         padrão — mesmo com a cor aparecendo na galeria e neste
                         cabeçalho, que é justamente o que faz uma pasta se
                         distinguir da outra. -->
                    <span class="lst-colors" role="group" aria-label="${escA(t("lists.color"))}">
                      ${LIST_COLORS.map((c) => `<button type="button" class="lst-color${c === list.color ? " is-on" : ""}"
                        data-list-color="${escA(c)}" style="--c:${escA(c)}" aria-label="${escA(c)}"
                        aria-pressed="${c === list.color}"></button>`).join("")}
                    </span>
                  </span>
                </div>
              </div>
            </div>
            ${statHtml(IC.money, "pastaValue", esc(money), t("dash.value"), ' class="dash-stat-money"')}
            <div class="collection-toolbar-actions pasta-actions" role="group" aria-label="${escA(t("nav.lists"))}">
              <button type="button" class="secondary pasta-add-btn" data-list-add aria-expanded="${addOpen}" aria-controls="pastaAddPanel">${IC.add}<span>${esc(t("lists.addCards"))}</span></button>
              <button type="button" class="secondary icon-btn" data-list-export title="${escA(t("lists.export"))}">${IC.export}<span>${esc(t("lists.export"))}</span></button>
              <button type="button" class="secondary icon-btn collection-share-btn" data-list-share title="${escA(t("lists.share"))}">${IC.share}<span aria-live="polite">${esc(t("lists.share"))}</span></button>
              <button type="button" class="secondary icon-btn pasta-del-btn" data-list-del title="${escA(t("lists.delete"))}">${IC.trash}<span>${esc(t("lists.delete"))}</span></button>
            </div>
          </div>
          <div class="dash-stats-counts">
            ${statHtml(IC.copies, "pastaCopies", s.copies, t("stats.copies"))}
            ${statHtml(IC.distinct, "pastaDistinct", s.distinct, t("stats.distinct"))}
            ${statHtml(IC.sets, "pastaSets", s.sets, t("stats.setsCovered"))}
          </div>
        </article>
      </section>

      <!-- Painel "Adicionar cartas": linha por carta, sem imagem (o modo rápido
           de cadastrar). Abre por cima da grade quando a pessoa pede — ou
           sozinho, numa pasta vazia. -->
      <section class="lst-panel pasta-add" id="pastaAddPanel"${addOpen ? "" : " hidden"}>
        <header class="lst-panel-head">
          <h2>${list.set ? esc(t("lists.sourceSet", { setName: list.set })) : esc(t("lists.source"))}</h2>
          <button type="button" class="lst-mini" data-list-add-close>${esc(t("lists.addCardsHide"))}</button>
        </header>
        <input type="search" id="lstSearch" class="list-input"
               placeholder="${escA(list.set ? t("lists.setFilter") : t("lists.searchPlaceholder", { listGame: shared.gameLabel(list.game) }))}"
               value="${escA(query)}">
        <div class="lst-rows" data-source></div>
        <p class="lst-keys">${esc(t("lists.keysHint"))}</p>
      </section>

      <section class="results-header pasta-results">
        <h2>${esc(t("lists.cardsTitle"))} <span class="pasta-count" data-pasta-count>${esc(tn("lists.count", s.copies))}</span></h2>
        <div class="results-actions">
          ${list.linked ? "" : `<button type="button" class="lst-mini" data-list-apply>${esc(t("lists.applyToCollection"))}</button>`}
          ${list.game ? `<button type="button" class="lst-mini" data-list-deck>${esc(t("lists.makeDeck"))}</button>` : ""}
        </div>
      </section>
      <div class="card-grid pasta-grid" data-entries>
        ${list.entries.length
          ? list.entries.map(entryTileHtml).join("")
          : `<p class="empty-state">${esc(t("lists.editorEmpty"))}</p>`}
      </div>
      <img class="lst-thumb" alt="" hidden>`;
    renderSource();
    ajustaValorHero();
  }

  // O valor de mercado mora numa caixa de largura FIXA no herói (a mesma da
  // Coleção): se o número não cabe, encolhe a fonte até caber, em vez de
  // empurrar as ações. Cópia enxuta do ajustaValorHero do collection.js.
  function ajustaValorHero() {
    const v = el.editor.querySelector(".dash-stat-money .dash-stat-val");
    if (!v) return;
    v.style.fontSize = "";
    let size = parseFloat(getComputedStyle(v).fontSize) || 22;
    let guard = 12;
    while (v.scrollWidth > v.clientWidth && size > 11 && guard--) {
      size -= 1;
      v.style.fontSize = size + "px";
    }
  }
  window.addEventListener("resize", shared.debounce(ajustaValorHero, 120));

  // Grade atualizada por TILE: cada +/−/adicionar repintava a tela inteira —
  // centenas de linhas do set + até 5000 cartas, com preço, conversão e imagem
  // por tile, a cada clique. É a tela de cadastro em série, o custo aparecia
  // exatamente onde não podia (e o re-render derrubava o foco do teclado, que
  // recomeçava do topo depois de cada adição).
  function updateTotals() {
    const s = stats();
    const put = (id, v) => { const n = el.editor.querySelector("#" + id); if (n) n.textContent = v; };
    put("pastaValue", s.value > 0 ? shared.formatMoney(shared.getCurrency(), s.value) : "—");
    put("pastaCopies", s.copies);
    put("pastaDistinct", s.distinct);
    put("pastaSets", s.sets);
    const c = el.editor.querySelector("[data-pasta-count]");
    if (c) c.textContent = tn("lists.count", s.copies);
    ajustaValorHero();
  }
  // Repinta/insere/remove UM tile da grade e atualiza os totais.
  function patchEntryRow(id, variant) {
    const box = el.editor.querySelector("[data-entries]");
    if (!box) return;
    const sel = `[data-entry="${CSS.escape(id)}"][data-entry-variant="${CSS.escape(variant || "")}"]`;
    const row = box.querySelector(sel);
    const entry = store.entry(current.id, id, variant || null);
    if (entry) {
      const html = entryTileHtml(entry);
      if (row) { row.outerHTML = html; }
      else {
        const vazio = box.querySelector(".empty-state");
        if (vazio) vazio.remove();
        box.insertAdjacentHTML("beforeend", html); // addEntry põe no FIM — mesma ordem do render cheio
      }
    } else if (row) {
      row.remove();
      if (!current.entries.length) box.innerHTML = `<p class="empty-state">${esc(t("lists.editorEmpty"))}</p>`;
    }
    updateTotals();
  }
  // Repinta UMA linha do painel de adicionar (seletor abriu/fechou, carta
  // entrou/saiu da pasta). O painel inteiro só re-renderiza quando a PRÓPRIA
  // lista de cartas muda (busca, troca de fonte, aplicar em massa).
  function patchSourceRow(cardId) {
    if (!cardId) return;
    const box = el.editor.querySelector("[data-source]");
    const row = box && box.querySelector(`[data-src-card="${CSS.escape(cardId)}"]`);
    const card = (cat.byId || {})[cardId];
    if (!row || !card) return;
    const tinhaFoco = row.classList.contains("is-focus");
    row.outerHTML = sourceRowHtml(card, idsNaLista());
    if (tinhaFoco) {
      const novo = box.querySelector(`[data-src-card="${CSS.escape(cardId)}"]`);
      if (novo) novo.classList.add("is-focus");
    }
  }

  function renderSource() {
    const box = el.editor.querySelector("[data-source]");
    if (!box) return;
    if (sourceLoading) { box.innerHTML = `<p class="empty-state">${esc(t("lists.loading"))}</p>`; return; }
    let cards = sourceCards;
    // No modo set o filtro é local (o chunk já está na memória) — sem ida à rede.
    if (current.set && query.trim()) {
      const nq = norm(query);
      cards = cards.filter((c) => norm(c.name).includes(nq) || String(c.number || "").includes(query.trim()));
    }
    if (!cards.length) {
      let msg;
      if (!current.set && query.trim().length < 2) msg = t("lists.searchHint");
      else if (buscaIndisponivel) msg = t("lists.searchOffline");
      else msg = t("lists.searchEmpty");
      box.innerHTML = `<p class="empty-state">${esc(msg)}</p>`;
      return;
    }
    const dentro = idsNaLista();
    box.innerHTML = cards.map((c) => sourceRowHtml(c, dentro)).join("");
  }

  // Abre/fecha o painel de adicionar sem redesenhar o resto (a grade pode ter
  // centenas de tiles). Ao abrir, o foco vai pra busca: é o que a pessoa vai
  // usar em seguida.
  function setAddOpen(open) {
    addOpen = !!open;
    const panel = el.editor.querySelector("#pastaAddPanel");
    const btn = el.editor.querySelector("[data-list-add]");
    if (panel) panel.hidden = !addOpen;
    // O botão do herói não muda de rótulo: aberto, ele só acende
    // (aria-expanded) — o "fechar" explícito é o do próprio painel.
    if (btn) btn.setAttribute("aria-expanded", String(addOpen));
    if (addOpen) {
      const busca = el.editor.querySelector("#lstSearch");
      if (busca) busca.focus();
      if (panel) panel.scrollIntoView({ block: "nearest" });
    }
  }

  // --- Adicionar -------------------------------------------------------------
  // Pasta VINCULADA grava na coleção do jogo no mesmo clique: é o "cadastrar
  // minha coleção rápido". Remover da pasta nunca desfaz isso — tirar da pasta
  // não é dizer que não tenho a carta.
  function addToList(card, variant, condition, qty) {
    const entry = store.addEntry(current.id, card.id, { v: variant, c: condition, q: qty });
    if (!entry) { alert(t("lists.entryLimit", { n: store.LIST_ENTRIES_LIMIT })); return; }
    // O jogo vem da CARTA, não da pasta: pasta migrada de tag pode não ter jogo
    // (null caía no jogo da sessão via gameKey e gravava na coleção errada).
    if (current.linked) ownedFor(card.game || current.game).add(card.id, variant, condition, qty);
    lastCondition = condition;
    patchEntryRow(card.id, variant);
    patchSourceRow(card.id);
  }

  function flash(node) {
    if (!node) return;
    node.classList.remove("is-added");
    void node.offsetWidth;                 // reinicia a animação em cliques seguidos
    node.classList.add("is-added");
    setTimeout(() => node.classList.remove("is-added"), 900);
  }

  // ===========================================================================
  // Exportar a pasta — o MESMO modal da Toda Coleção e da Lista de Desejo
  // (export-ui.js), com as linhas vindas desta pasta. Ver docs/LISTAS.md §6.
  // ===========================================================================
  function entradasExport(jogo) {
    return current.entries
      .filter((e) => !jogo || ((cat.byId[e.id] || {}).game || current.game) === jogo)
      .map((e) => ({ id: e.id, q: entryQty(e), c: e.c, v: e.v }));
  }
  function jogosDaPasta() {
    const set = new Set();
    current.entries.forEach((e) => { const g = (cat.byId[e.id] || {}).game || current.game; if (g) set.add(g); });
    return shared.GAME_SLUGS.filter((g) => set.has(g));
  }
  function openExportModal() {
    const ex = window.TCGExportLiga, ui = window.TCGExportUI;
    if (!ex || !ui) return;
    const jogos = jogosDaPasta();
    ui.abrir({
      titulo: t("lists.export"),
      jogos,
      rotuloJogo: shared.gameLabel,
      // Liga é POR JOGO (o modal manda o escolhido); texto/CSV saem com tudo.
      texto: (formato, jogo) => ex.exportar(formato, entradasExport(jogo), cat.byId, jogo || (jogos.length === 1 ? jogos[0] : "")),
      escopo: (n) => t("lists.exportScope", { n }),
      arquivo: `pasta-${(listName(current) || "sleevu").replace(/[^\w-]+/g, "-").toLowerCase()}`,
      vazio: t("lists.exportEmpty")
    });
  }

  // ===========================================================================
  // Compartilhar a pasta por link — o MESMO fluxo do botão da Toda Coleção
  // (createShare + copiar): snapshot desnormalizado (nome, set, imagem, valor
  // em BRL) que o viewer ?s= da Coleção renderiza sem catálogo. scope "pasta"
  // faz o viewer rotular como pasta e oferecer "salvar como pasta".
  // ===========================================================================
  function shareItems() {
    const items = [];
    current.entries.forEach((e) => {
      const card = cat.byId[e.id];
      if (!card) return;   // id fora do catálogo: sem nome nem imagem, não tem o que mostrar
      const variant = entryVariant(e, card);
      const src = shared.cardImageSources(card) || {};
      const unit = entryUnit(current, e, card);
      const vbrl = shared.convertMoney(unit, shared.getCurrency(), "BRL");
      items.push({
        id: card.id, n: card.name, s: card.set, num: card.number, lang: card.language,
        g: card.game, v: variant, q: entryQty(e), c: e.c || shared.DEFAULT_CONDITION,
        vbrl: vbrl == null ? 0 : Math.round(vbrl * 100) / 100,
        img: src.url, fb: src.fallback || ""
      });
    });
    return items;
  }
  async function sharePasta(btn) {
    const items = shareItems();
    if (!items.length) { shared.toastSimples(t("lists.shareEmpty")); return; }
    const original = t("lists.share");
    // Botão SÓ-ÍCONE: o rótulo vive num <span> escondido (leitor de tela +
    // aria-live); o feedback VISUAL de sucesso é o ✓ no lugar do ícone.
    const setLabel = (txt) => { const s = btn && btn.querySelector("span"); if (s) s.textContent = txt; };
    const setOk = (on) => { if (btn) btn.classList.toggle("is-ok", !!on); };
    if (btn) btn.disabled = true;
    setLabel(t("collection.share.creating"));
    const data = { items, scope: "pasta", color: current.color, linked: !!current.linked };
    const res = await shared.createShare("collection", listName(current), data, current.game || undefined);
    if (btn) btn.disabled = false;
    if (res && res.id) {
      const link = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}collection?s=${res.id}`;
      try { await navigator.clipboard.writeText(link); setLabel(t("collection.share.copied")); setOk(true); }
      catch (e) { shared.caixaDeTexto({ titulo: t("collection.share.copyManual"), valor: link, leitura: true }); setLabel(original); }
    } else {
      alert(res && res.error === "auth" ? t("collection.share.needLogin") : t("collection.share.error"));
      setLabel(original);
    }
    setTimeout(() => { setLabel(original); setOk(false); }, 2500);
  }

  // "Aplicar à coleção" (só nas avulsas): mostra o delta ANTES de gravar, no
  // mesmo espírito da prévia do import de CSV — escrever na coleção de alguém
  // sem mostrar o que vai mudar é o tipo de coisa que não dá pra desfazer no olho.
  function openApplyModal() {
    const owned = ownedFor(current.game);
    const linhas = current.entries.map((e) => {
      const card = cat.byId[e.id];
      const variant = entryVariant(e, card);
      const cond = e.c || shared.DEFAULT_CONDITION;
      return {
        e, card, variant, cond,
        q: entryQty(e),
        atual: owned.getQuantity(e.id, variant, cond)
      };
    });
    const wrap = document.createElement("div");
    wrap.className = "list-modal";
    document.body.appendChild(wrap);
    document.body.classList.add("preview-open"); // trava a rolagem do fundo (body+html)
    let modo = "somar";   // somar = +q; definir = deixa exatamente q (idempotente)

    function pinta() {
      const corpo = linhas.map((l) => {
        const fim = modo === "somar" ? l.atual + l.q : l.q;
        return `<div class="lst-apply-row">
          <span class="lst-apply-name">${esc(l.card ? l.card.name : l.e.id)}</span>
          <span class="lst-apply-var">${esc(l.variant)} · ${esc(l.cond)}</span>
          <span class="lst-apply-delta">${l.atual} → <b>${fim}</b></span>
        </div>`;
      }).join("");
      wrap.innerHTML = `
        <div class="list-modal-box" role="dialog" aria-modal="true" aria-label="${escA(t("lists.applyToCollection"))}">
          <h2>${esc(t("lists.applyToCollection"))}</h2>
          <div class="lst-chips">
            <button type="button" class="lst-chip${modo === "somar" ? " is-on" : ""}" data-mode="somar">${esc(t("lists.applyAdd"))}</button>
            <button type="button" class="lst-chip${modo === "definir" ? " is-on" : ""}" data-mode="definir">${esc(t("lists.applySet"))}</button>
          </div>
          <p class="list-modal-hint">${esc(t(modo === "somar" ? "lists.applyAddHint" : "lists.applySetHint"))}</p>
          <div class="lst-apply-list">${corpo || `<p class="empty-state">${esc(t("lists.editorEmpty"))}</p>`}</div>
          <div class="list-modal-foot">
            <button type="button" class="cta" data-ap-go>${esc(tn("lists.applyConfirm", linhas.length))}</button>
            <button type="button" class="lst-mini" data-wz-cancel>${esc(t("lists.cancel"))}</button>
          </div>
        </div>`;
    }
    pinta();

    wrap.addEventListener("click", (ev) => {
      if (ev.target === wrap || ev.target.closest("[data-wz-cancel]")) { wrap.remove(); document.body.classList.remove("preview-open"); return; }
      const m = ev.target.closest("[data-mode]");
      if (m) { modo = m.dataset.mode; pinta(); return; }
      if (ev.target.closest("[data-ap-go]")) {
        // Snapshot ANTES de escrever (senão o desfazer restauraria o estado já
        // alterado) e flush logo depois: sem ele, a escrita adiada dispararia
        // após o restore e regravaria por cima o que o usuário acabou de desfazer.
        const desfazer = shared.snapshotKeys([
          shared.gameKey("collection-v3", current.game),
          shared.gameKey("collection-meta-v1", current.game)
        ]);
        linhas.forEach((l) => {
          const delta = modo === "somar" ? l.q : l.q - l.atual;
          if (delta) owned.add(l.e.id, l.variant, l.cond, delta);
        });
        shared.flushPendingWrites();
        wrap.remove(); document.body.classList.remove("preview-open");
        renderSource();
        shared.toastUndo(tn("lists.applied", linhas.length), desfazer);
      }
    });
  }

  // ===========================================================================
  // "Criar deck desta pasta" — a pasta como ponto de partida do construtor.
  // Escreve direto no store dos decks (mesma chave global, formato do decks.js);
  // as REGRAS dizem em que zona cada carta entra, senão um líder de One Piece
  // cairia no deck principal e o deck nasceria inválido.
  // ===========================================================================
  const DECKS_KEY = "tcg-collector-decks-all-v1";
  function criarDeckDaLista() {
    // Deck tem UM jogo; pasta migrada mista (game null) não vira deck — o botão
    // nem é renderizado nesse caso, isto é só o cinto de segurança.
    if (!current || !current.game) return;
    const rules = window.TCGDeckRules;
    const pack = rules ? rules.packFor(current.game, null) : null;
    const zones = {};
    if (pack) (pack.zones || []).forEach((z) => { zones[z.key] = []; });
    else zones.main = [];

    current.entries.forEach((e) => {
      const card = cat.byId[e.id];
      const zona = (pack && card && rules.zoneForCard(pack, card)) || "main";
      if (!zones[zona]) zones[zona] = [];
      zones[zona].push({ id: e.id, qty: entryQty(e), variant: entryVariant(e, card) });
    });

    let data;
    try { data = JSON.parse(localStorage.getItem(DECKS_KEY) || "null"); } catch (err) { data = null; }
    if (!data || !Array.isArray(data.decks)) data = { decks: [], deleted: {} };
    const deck = {
      id: "dk_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3),
      game: current.game,
      format: null,
      name: listName(current),
      coverCardId: current.entries.length ? current.entries[0].id : undefined,
      zones: zones,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    data.decks.unshift(deck);
    try { localStorage.setItem(DECKS_KEY, JSON.stringify(data)); shared.marcaSuja(DECKS_KEY); }
    catch (err) { if (shared.notifyStorageFull) shared.notifyStorageFull(); return; }
    location.href = `my-decks?id=${encodeURIComponent(deck.id)}`;
  }

  // --- Eventos da pasta aberta (delegação) ----------------------------------
  el.editor.addEventListener("click", (ev) => {
    if (!current) return;

    // Cor da pasta: repinta o cabeçalho e os marcadores na hora (o --lc mora no
    // .lst-head e no herói), sem redesenhar a tela inteira — a grade pode ter
    // centenas de tiles e a pessoa está só escolhendo uma cor.
    const cor = ev.target.closest("[data-list-color]");
    if (cor) {
      const nova = cor.dataset.listColor;
      store.setColor(current.id, nova);
      current.color = nova;
      el.editor.querySelectorAll(".lst-head, .pasta-dashboard").forEach((n) => n.style.setProperty("--lc", nova));
      el.editor.querySelectorAll("[data-list-color]").forEach((b) => {
        const on = b.dataset.listColor === nova;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", String(on));
      });
      return;
    }

    // Imagem do tile: abre o popup do card (como em toda grade do site).
    const pv = ev.target.closest("[data-preview-card-id]");
    if (pv && preview) { preview.open(pv.dataset.previewCardId, pv.dataset.previewVariant || undefined); return; }

    if (ev.target.closest("[data-list-add]")) { setAddOpen(!addOpen); return; }
    if (ev.target.closest("[data-list-add-close]")) { setAddOpen(false); return; }

    // Adicionar: 1 variante entra direto; várias abrem o seletor na linha.
    const add = ev.target.closest("[data-src-add]");
    if (add) {
      const card = (cat.byId || {})[add.dataset.srcAdd];
      if (!card) return;
      const variants = shared.cardVariants(card);
      if (variants.length > 1) {
        const prev = openPicker;
        openPicker = prev === card.id ? null : card.id;
        if (prev && prev !== card.id) patchSourceRow(prev); // fecha o que estava aberto
        patchSourceRow(card.id);
        return;
      }
      addToList(card, variants[0], lastCondition, 1);
      flash(el.editor.querySelector(`[data-src-card="${CSS.escape(card.id)}"]`));
      return;
    }

    // Nome da carta na fonte: abre o seletor (mesmo com 1 variante, pra poder
    // escolher condição/quantidade sem sair da linha).
    const openRow = ev.target.closest("[data-src-open]");
    if (openRow) {
      const prev = openPicker;
      openPicker = prev === openRow.dataset.srcOpen ? null : openRow.dataset.srcOpen;
      if (prev && prev !== openRow.dataset.srcOpen) patchSourceRow(prev);
      patchSourceRow(openRow.dataset.srcOpen);
      return;
    }

    const chip = ev.target.closest("[data-pick-variant]");
    if (chip) {
      chip.parentElement.querySelectorAll("[data-pick-variant]").forEach((b) => b.classList.remove("is-on"));
      chip.classList.add("is-on");
      return;
    }

    const confirm = ev.target.closest("[data-pick-confirm]");
    if (confirm) {
      const card = (cat.byId || {})[confirm.dataset.pickConfirm];
      const picker = confirm.closest(".lst-picker");
      if (!card || !picker) return;
      const chosen = picker.querySelector("[data-pick-variant].is-on");
      const variant = chosen ? chosen.dataset.pickVariant : shared.defaultVariant(card);
      const cond = (picker.querySelector("[data-pick-cond]") || {}).value || shared.DEFAULT_CONDITION;
      const qty = Math.max(1, Math.min(99, Number((picker.querySelector("[data-pick-qty]") || {}).value) || 1));
      openPicker = null;
      addToList(card, variant, cond, qty);
      flash(el.editor.querySelector(`[data-src-card="${CSS.escape(card.id)}"]`));
      return;
    }

    // Tiles da grade: quantidade na pasta e remoção.
    const row = ev.target.closest("[data-entry]");
    if (row) {
      const id = row.dataset.entry;
      const variant = row.dataset.entryVariant || null;
      const entry = store.entry(current.id, id, variant);
      if (!entry) return;
      const q = entryQty(entry);
      if (ev.target.closest("[data-entry-inc]")) { store.setEntryQty(current.id, id, variant, q + 1); patchEntryRow(id, variant); return; }
      if (ev.target.closest("[data-entry-dec]")) { store.setEntryQty(current.id, id, variant, q - 1); patchEntryRow(id, variant); patchSourceRow(id); return; }
      if (ev.target.closest("[data-entry-del]")) { store.removeEntry(current.id, id, variant); patchEntryRow(id, variant); patchSourceRow(id); return; }
    }

    if (ev.target.closest("[data-list-export]")) { openExportModal(); return; }
    if (ev.target.closest("[data-list-share]")) { sharePasta(ev.target.closest("[data-list-share]")); return; }
    if (ev.target.closest("[data-list-apply]")) { openApplyModal(); return; }
    if (ev.target.closest("[data-list-deck]")) { criarDeckDaLista(); return; }

    if (ev.target.closest("[data-list-del]")) {
      // Toast com desfazer, como o resto do site — nada de confirm() bloqueante.
      // Volta pra galeria trocando de VISTA (não navegando): um location.href
      // recarregaria a página e levaria o toast junto, sem chance de desfazer.
      const undo = shared.snapshotKeys([store.STORAGE_KEY]);
      store.remove(current.id);
      current = null;
      history.replaceState(null, "", "pastas");
      renderGallery();
      shared.toastUndo(t("lists.deleted"), undo);
    }
  });

  el.editor.addEventListener("input", (ev) => {
    if (!current) return;
    if (ev.target.id === "lstName") { store.rename(current.id, ev.target.value); return; }
    if (ev.target.id === "lstSearch") {
      query = ev.target.value;
      if (current.set) renderSource();          // filtro local, sem debounce
      else { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 180); }
    }
  });
  let searchTimer = 0;

  el.editor.addEventListener("change", (ev) => {
    if (!current) return;
    if (ev.target.matches("[data-list-linked]")) {
      store.setLinked(current.id, ev.target.checked);
      current.linked = ev.target.checked;
      // O selo Vinculada/Avulsa e o "Aplicar à coleção" (só nas avulsas)
      // dependem do tipo: repinta os dois sem mexer na grade.
      const badge = el.editor.querySelector(".pasta-identity .list-card-badge");
      if (badge) {
        badge.textContent = current.linked ? t("lists.linkedBadge") : t("lists.standaloneBadge");
        badge.classList.toggle("is-linked", current.linked);
      }
      const acoes = el.editor.querySelector(".pasta-results .results-actions");
      const aplicar = acoes && acoes.querySelector("[data-list-apply]");
      if (acoes && current.linked && aplicar) aplicar.remove();
      if (acoes && !current.linked && !aplicar) acoes.insertAdjacentHTML("afterbegin", `<button type="button" class="lst-mini" data-list-apply>${esc(t("lists.applyToCollection"))}</button>`);
    }
  });

  // Teclado: cadastrar um set inteiro é uma tarefa de duas mãos — uma na busca,
  // outra adicionando. Sem isto, cada carta custa um movimento até o mouse.
  //   /     foca a busca      ↑ ↓   anda pelas linhas da fonte
  //   Enter adiciona a linha em foco (com 1 versão) ou abre o seletor
  //   Esc   fecha o seletor aberto / devolve o foco à busca
  el.editor.addEventListener("keydown", (ev) => {
    if (!current) return;
    const busca = el.editor.querySelector("#lstSearch");

    // "/" não pode roubar a tecla de quem está digitando (inclusive um nome de
    // carta que tenha barra). Com o painel fechado, "/" o abre — é o atalho
    // pra começar a cadastrar.
    const digitando = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName);
    if (ev.key === "/" && !digitando) { ev.preventDefault(); if (!addOpen) setAddOpen(true); else if (busca) busca.focus(); return; }
    if (!addOpen) return;

    if (ev.key === "Escape") {
      if (openPicker) { const prev = openPicker; openPicker = null; patchSourceRow(prev); ev.preventDefault(); }
      else if (busca) busca.focus();
      return;
    }

    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp" && ev.key !== "Enter") return;
    // Enter dentro de um campo do seletor confirma aquele seletor, não a linha.
    if (ev.key === "Enter" && digitando && ev.target.closest(".lst-picker")) {
      const btn = ev.target.closest(".lst-picker").querySelector("[data-pick-confirm]");
      if (btn) { ev.preventDefault(); btn.click(); }
      return;
    }
    // Enter no nome da pasta é só "terminei de digitar", não "adicionar".
    if (ev.key === "Enter" && ev.target.id === "lstName") return;

    const linhas = [...el.editor.querySelectorAll("[data-source] .lst-row")];
    if (!linhas.length) return;
    const atual = linhas.findIndex((l) => l.classList.contains("is-focus"));

    if (ev.key === "Enter") {
      if (atual < 0) return;
      ev.preventDefault();
      const btn = linhas[atual].querySelector("[data-src-add]");
      if (btn) btn.click();
      return;
    }
    ev.preventDefault();
    const proximo = ev.key === "ArrowDown"
      ? Math.min(linhas.length - 1, atual + 1)
      : Math.max(0, atual <= 0 ? 0 : atual - 1);
    linhas.forEach((l) => l.classList.remove("is-focus"));
    linhas[proximo].classList.add("is-focus");
    linhas[proximo].scrollIntoView({ block: "nearest" });
  });

  // Miniatura no hover: a linha do painel de adicionar não tem imagem (é o
  // ponto do modo), mas passar o mouse no nome mostra a carta. Mesmo mecanismo
  // da seção Impressões do popup — propriedade, não addEventListener, pra não
  // empilhar handler a cada render.
  el.editor.onmouseover = (ev) => {
    const name = ev.target.closest("[data-thumb]");
    let thumb = el.editor.querySelector(".lst-thumb");
    if (!thumb) return;
    if (!name || !name.dataset.thumb) { thumb.hidden = true; return; }
    // Cadeia de fallback da imagem (webp → png → pokemontcg.io → outra língua),
    // e não a URL crua: carta que a TCGdex não tem saía como imagem quebrada.
    thumb = shared.hoverThumb(thumb, name.dataset.thumb, { fallback: name.dataset.thumbFb || "" });
    thumb.hidden = false;
    const r = name.getBoundingClientRect();
    thumb.style.top = Math.max(8, Math.min(window.innerHeight - 300, r.top)) + "px";
    thumb.style.left = Math.min(window.innerWidth - 220, r.right + 12) + "px";
  };

  // ===========================================================================
  // Boot
  // ===========================================================================
  el.gallery.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-list-new]")) openWizard();
  });

  const id = new URLSearchParams(location.search).get("id");
  if (id) {
    const list = store.get(id);
    if (list) openEditor(list);
    else {
      show("gallery");
      el.gallery.innerHTML = `<p class="empty-state">${esc(t("lists.notFound"))}</p>`;
    }
  } else {
    renderGallery();
  }
})();
