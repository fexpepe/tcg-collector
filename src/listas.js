// Listas (listas.html). Uma página, duas vistas:
//   sem ?id=  -> galeria das minhas listas
//   com ?id=  -> editor daquela lista
// (mesmo padrão do my-decks.html). O STORE vive no shared.js, porque o botão de
// lista do tile e o bloco do popup do card também precisam dele. Ver docs/LISTAS.md.
(function () {
  "use strict";
  const shared = window.TCGShared;
  if (!shared) return;
  const t = shared.t;
  const tn = shared.tn;
  const esc = shared.escapeHtml;
  const escA = shared.escapeAttribute;
  const store = shared.createListStore();

  const el = {
    gallery: document.getElementById("listGallery"),
    editor: document.getElementById("listEditor")
  };
  if (!el.gallery || !el.editor) return;

  function show(which) {
    el.gallery.hidden = which !== "gallery";
    el.editor.hidden = which !== "editor";
  }

  // ---------------------------------------------------------------------------
  // Catálogo do jogo da lista (pode ser != do jogo da sessão). Nunca baixa o
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
    // mescla o do jogo da lista pra o preço não sair zerado.
    if (r.pricing) window.TCG_PRICING = Object.assign({}, window.TCG_PRICING || {}, r.pricing);
    return entry;
  }

  // Hidratação que aceita lista SEM jogo (migrada de tag cross-game, game null).
  // O jogo de cada id sai da coleção local (a tag marcava carta que a pessoa
  // tem); id que não está em coleção nenhuma fica sem carta — a linha mostra o
  // id cru, porque chutar um catálogo era o bug (carregava o do Pokémon e, pior,
  // a adição vinculada gravava na coleção do jogo da SESSÃO).
  // Devolve sempre a MESMA entrada mutável (`__mista` no cache) pra carta achada
  // depois — pela busca, por ex. — aparecer no painel de entradas sem re-hidratar.
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
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  function listName(list) { return list.name || t("lists.untitled"); }
  function entryValue(list, entry, card) {
    if (!card) return 0;
    const variant = entry.v || shared.defaultVariant(card);
    // Jogo da CARTA primeiro: lista migrada de tag pode não ter jogo (null
    // cairia no store de preços manuais do jogo da sessão).
    const unit = (shared.cardValue(card, variant, pricesFor(card.game || list.game), entry.c) || {}).value || 0;
    return unit * (entry.q == null ? 1 : entry.q);
  }
  function listValue(list, byId) {
    return list.entries.reduce((s, e) => s + entryValue(list, e, byId[e.id]), 0);
  }

  // ===========================================================================
  // Galeria
  // ===========================================================================
  function listCardHtml(list) {
    const n = store.countOf(list.id);
    const badge = list.linked ? t("lists.linkedBadge") : t("lists.standaloneBadge");
    return `
      <a class="list-card" href="listas.html?id=${encodeURIComponent(list.id)}" style="--lc:${escA(list.color)}">
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
        <a href="dashboard.html" class="serie-back">${esc(t("nav.backDashboard"))}</a>
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

    // Passo 1: nome + o que a lista faz. O tipo nasce AVULSO: gravar na coleção
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
      location.href = `listas.html?id=${encodeURIComponent(list.id)}`;
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
  // Editor
  // ===========================================================================
  let current = null;      // lista aberta
  let cat = null;          // { byId } do jogo da lista
  let sourceCards = [];    // cartas do painel direito (set inteiro ou busca)
  let sourceLoading = false;
  let query = "";
  let openPicker = null;   // cardId com o seletor de variante aberto
  let lastCondition = shared.DEFAULT_CONDITION;  // lembrada na sessão: cadastrar
                                                 // um set inteiro é quase sempre
                                                 // na mesma condição

  async function openEditor(list) {
    current = list;
    show("editor");
    el.editor.innerHTML = `<p class="empty-state">${esc(t("lists.loading"))}</p>`;
    try {
      // loadFxRates é OBRIGATÓRIO antes de calcular valor: sem as taxas,
      // convertMoney devolve null e cardValue cai pra 0 — o painel sairia zerado
      // mesmo com preço no catálogo.
      const [c] = await Promise.all([
        hydrateList(list.game, store.cardIdsOf(list.id)),
        shared.loadFxRates()
      ]);
      cat = c;
    } catch (e) {
      el.editor.innerHTML = `<p class="empty-state">${esc(t("lists.loadError"))}</p>`;
      return;
    }
    renderEditor();
    loadSource();
  }

  // --- Painel direito: a fonte das cartas -----------------------------------
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
    renderSource();
    let hits = null;
    const jogo = current.game;
    if (!jogo) {
      // Lista sem jogo (migrada de tag cross-game): só a borda busca em todos
      // os catálogos de uma vez (game=all, cada hit traz o jogo em h.g). O
      // índice local é por jogo — usar um seria chutar o catálogo errado, que
      // era exatamente o bug (mandava game=null: 400 + pausa da bridge).
      hits = (await shared.searchApi("all", q, 60)) || [];
      if (seq !== searchSeq) return;
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
        const nq = norm(q);
        hits = idx.filter((e) => norm(e.n).includes(nq) || norm(e.u) === nq).slice(0, 60);
      }
    }
    try {
      let c;
      if (jogo) {
        c = await ensureCards(jogo, hits.map((h) => h.i));
      } else {
        // Hidrata por jogo (h.g vem do D1) e acumula na mesma entrada mista da
        // hidratação inicial — o painel de entradas enxerga a carta na hora.
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

  // Linha do painel direito: SEM imagem (é o ponto do modo). O nome carrega a URL
  // da carta em data-thumb; o hover mostra a miniatura flutuante.
  function sourceRowHtml(card) {
    const naLista = store.has(current.id, card.id, null)
      || shared.cardVariants(card).some((v) => store.has(current.id, card.id, v));
    const variants = shared.cardVariants(card);
    const img = (shared.cardImageSources(card) || {}).url || "";
    const picker = openPicker === card.id ? variantPickerHtml(card, variants) : "";
    return `
      <div class="lst-row${naLista ? " is-in" : ""}" data-src-card="${escA(card.id)}">
        <button type="button" class="lst-name" data-thumb="${escA(img)}" data-src-open="${escA(card.id)}">
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

  function entryRowHtml(entry) {
    const card = cat.byId[entry.id];
    const name = card ? card.name : entry.id;
    const img = card ? ((shared.cardImageSources(card) || {}).url || "") : "";
    const val = entryValue(current, entry, card);
    return `
      <div class="lst-row lst-entry" data-entry="${escA(entry.id)}" data-entry-variant="${escA(entry.v || "")}">
        <button type="button" class="lst-name" data-thumb="${escA(img)}">${esc(name)}</button>
        <span class="lst-num">${esc(card ? (card.number || "") : "")}</span>
        <span class="lst-var">${esc(entry.v || "—")}</span>
        <span class="lst-cond">${esc(entry.c || "")}</span>
        <span class="lst-qty">
          <button type="button" class="lst-step" data-entry-dec aria-label="-">−</button>
          <b>${entry.q == null ? 1 : entry.q}</b>
          <button type="button" class="lst-step" data-entry-inc aria-label="+">+</button>
        </span>
        <span class="lst-val">${val ? esc(shared.formatMoney(shared.getCurrency(), val)) : ""}</span>
        <button type="button" class="lst-del" data-entry-del title="${escA(t("lists.removeEntry"))}">×</button>
      </div>`;
  }

  function renderEditor() {
    const list = current;
    const total = store.countOf(list.id);
    const val = listValue(list, cat.byId);
    el.editor.innerHTML = `
      <div class="page-head dash-head lst-head" style="--lc:${escA(list.color)}">
        <div>
          <h1><input type="text" id="lstName" class="lst-title" maxlength="40" value="${escA(listName(list))}"></h1>
          <p class="page-head-sub">
            ${list.game ? shared.gameTagHtml(list.game) : ""}
            ${list.set ? `<span class="lst-setname">${esc(list.set)}</span>` : ""}
            <label class="lst-linked"><input type="checkbox" data-list-linked${list.linked ? " checked" : ""}> ${esc(t("lists.linked"))}</label>
          </p>
        </div>
        <a href="listas.html" class="serie-back">${esc(t("lists.backToLists"))}</a>
      </div>

      <div class="lst-panels">
        <section class="lst-panel">
          <header class="lst-panel-head">
            <h2>${esc(listName(list))}</h2>
            <span class="lst-totals">${esc(tn("lists.count", total))}${val ? " · " + esc(shared.formatMoney(shared.getCurrency(), val)) : ""}</span>
          </header>
          <div class="lst-rows" data-entries>
            ${list.entries.length
              ? list.entries.map(entryRowHtml).join("")
              : `<p class="empty-state">${esc(t("lists.editorEmpty"))}</p>`}
          </div>
          <footer class="lst-panel-foot">
            <button type="button" class="lst-mini" data-list-export>${esc(t("lists.export"))}</button>
            ${list.linked ? "" : `<button type="button" class="lst-mini" data-list-apply>${esc(t("lists.applyToCollection"))}</button>`}
            ${list.game ? `<button type="button" class="lst-mini" data-list-deck>${esc(t("lists.makeDeck"))}</button>` : ""}
            <button type="button" class="lst-mini danger" data-list-del>${esc(t("lists.delete"))}</button>
          </footer>
        </section>

        <section class="lst-panel">
          <header class="lst-panel-head">
            <h2>${list.set ? esc(t("lists.sourceSet", { setName: list.set })) : esc(t("lists.source"))}</h2>
          </header>
          <input type="search" id="lstSearch" class="list-input"
                 placeholder="${escA(list.set ? t("lists.setFilter") : t("lists.searchPlaceholder", { listGame: shared.gameLabel(list.game) }))}"
                 value="${escA(query)}">
          <div class="lst-rows" data-source></div>
          <p class="lst-keys">${esc(t("lists.keysHint"))}</p>
        </section>
      </div>
      <img class="lst-thumb" alt="" hidden>`;
    renderSource();
  }

  // Re-render só do painel esquerdo (o direito não muda ao mexer nas entradas).
  function renderEntries() {
    const box = el.editor.querySelector("[data-entries]");
    if (!box) return;
    box.innerHTML = current.entries.length
      ? current.entries.map(entryRowHtml).join("")
      : `<p class="empty-state">${esc(t("lists.editorEmpty"))}</p>`;
    const tot = el.editor.querySelector(".lst-totals");
    if (tot) {
      const val = listValue(current, cat.byId);
      tot.textContent = tn("lists.count", store.countOf(current.id))
        + (val ? " · " + shared.formatMoney(shared.getCurrency(), val) : "");
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
      const msg = (!current.set && query.trim().length < 2) ? t("lists.searchHint") : t("lists.searchEmpty");
      box.innerHTML = `<p class="empty-state">${esc(msg)}</p>`;
      return;
    }
    box.innerHTML = cards.map(sourceRowHtml).join("");
  }

  // --- Adicionar -------------------------------------------------------------
  // Lista VINCULADA grava na coleção do jogo no mesmo clique: é o "cadastrar
  // minha coleção rápido". Remover da lista nunca desfaz isso — tirar da lista
  // não é dizer que não tenho a carta.
  function addToList(card, variant, condition, qty) {
    const entry = store.addEntry(current.id, card.id, { v: variant, c: condition, q: qty });
    if (!entry) { alert(t("lists.entryLimit", { n: store.LIST_ENTRIES_LIMIT })); return; }
    // O jogo vem da CARTA, não da lista: lista migrada de tag pode não ter jogo
    // (null caía no jogo da sessão via gameKey e gravava na coleção errada).
    if (current.linked) ownedFor(card.game || current.game).add(card.id, variant, condition, qty);
    lastCondition = condition;
    renderEntries();
    renderSource();
  }

  function flash(node) {
    if (!node) return;
    node.classList.remove("is-added");
    void node.offsetWidth;                 // reinicia a animação em cliques seguidos
    node.classList.add("is-added");
    setTimeout(() => node.classList.remove("is-added"), 900);
  }

  // ===========================================================================
  // Export (Liga / texto / CSV) — ver docs/LISTAS.md §6
  // ===========================================================================
  const FORMATOS = ["liga", "texto", "csv"];
  let formatoAtual = "liga";

  function textoExportado() {
    const ex = window.TCGExportLiga;
    if (!ex) return "";
    return ex.exportar(formatoAtual, current.entries, cat.byId, current.game);
  }

  function openExportModal() {
    const wrap = document.createElement("div");
    wrap.className = "list-modal";
    document.body.appendChild(wrap);
    document.body.classList.add("preview-open"); // trava a rolagem do fundo (body+html)

    function pinta() {
      const abas = FORMATOS.map((f) =>
        `<button type="button" class="lst-chip${f === formatoAtual ? " is-on" : ""}" data-fmt="${escA(f)}">${esc(t("lists.format." + f))}</button>`).join("");
      wrap.innerHTML = `
        <div class="list-modal-box" role="dialog" aria-modal="true" aria-label="${escA(t("lists.export"))}">
          <h2>${esc(t("lists.export"))}</h2>
          <div class="lst-chips">${abas}</div>
          <p class="list-modal-hint">${esc(t("lists.format." + formatoAtual + ".hint"))}</p>
          <textarea class="lst-export" readonly rows="12">${esc(textoExportado())}</textarea>
          <div class="list-modal-foot">
            <button type="button" class="cta" data-ex-copy>${esc(t("lists.copy"))}</button>
            <button type="button" class="lst-mini" data-ex-dl>${esc(t("lists.download"))}</button>
            <button type="button" class="lst-mini" data-wz-cancel>${esc(t("lists.cancel"))}</button>
          </div>
        </div>`;
    }
    pinta();

    wrap.addEventListener("click", (ev) => {
      if (ev.target === wrap || ev.target.closest("[data-wz-cancel]")) { wrap.remove(); document.body.classList.remove("preview-open"); return; }
      const f = ev.target.closest("[data-fmt]");
      if (f) { formatoAtual = f.dataset.fmt; pinta(); return; }

      if (ev.target.closest("[data-ex-copy]")) {
        const ta = wrap.querySelector(".lst-export");
        // navigator.clipboard exige contexto seguro; o fallback do textarea
        // cobre http:// e navegador antigo (mesmo caminho do copyDeckText).
        const done = () => { const b = wrap.querySelector("[data-ex-copy]"); if (b) b.textContent = t("lists.copied"); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(ta.value).then(done, () => { ta.select(); document.execCommand("copy"); done(); });
        } else { ta.select(); document.execCommand("copy"); done(); }
        return;
      }

      if (ev.target.closest("[data-ex-dl]")) {
        const ext = formatoAtual === "csv" ? "csv" : "txt";
        const tipo = formatoAtual === "csv" ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8";
        // BOM só no CSV (é o que faz o Excel pt-BR abrir com acento certo).
        const conteudo = (formatoAtual === "csv" ? "﻿" : "") + textoExportado();
        const blob = new Blob([conteudo], { type: tipo });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${(listName(current) || "lista").replace(/[^\w-]+/g, "-").toLowerCase()}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
      }
    });
  }

  // "Aplicar à coleção" (só nas avulsas): mostra o delta ANTES de gravar, no
  // mesmo espírito da prévia do import de CSV — escrever na coleção de alguém
  // sem mostrar o que vai mudar é o tipo de coisa que não dá pra desfazer no olho.
  function openApplyModal() {
    const owned = ownedFor(current.game);
    const linhas = current.entries.map((e) => {
      const card = cat.byId[e.id];
      const variant = e.v || (card ? shared.defaultVariant(card) : "Normal");
      const cond = e.c || shared.DEFAULT_CONDITION;
      return {
        e, card, variant, cond,
        q: e.q == null ? 1 : e.q,
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
  // "Criar deck desta lista" — a lista como ponto de partida do construtor.
  // Escreve direto no store dos decks (mesma chave global, formato do decks.js);
  // as REGRAS dizem em que zona cada carta entra, senão um líder de One Piece
  // cairia no deck principal e o deck nasceria inválido.
  // ===========================================================================
  const DECKS_KEY = "tcg-collector-decks-all-v1";
  function criarDeckDaLista() {
    // Deck tem UM jogo; lista migrada mista (game null) não vira deck — o botão
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
      zones[zona].push({ id: e.id, qty: e.q == null ? 1 : e.q, variant: e.v || (card ? shared.defaultVariant(card) : "Normal") });
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
    location.href = `my-decks.html?id=${encodeURIComponent(deck.id)}`;
  }

  // --- Eventos do editor (delegação) ----------------------------------------
  el.editor.addEventListener("click", (ev) => {
    if (!current) return;

    // Adicionar: 1 variante entra direto; várias abrem o seletor na linha.
    const add = ev.target.closest("[data-src-add]");
    if (add) {
      const card = (cat.byId || {})[add.dataset.srcAdd];
      if (!card) return;
      const variants = shared.cardVariants(card);
      if (variants.length > 1) {
        openPicker = openPicker === card.id ? null : card.id;
        renderSource();
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
      openPicker = openPicker === openRow.dataset.srcOpen ? null : openRow.dataset.srcOpen;
      renderSource();
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

    // Linhas da lista: quantidade e remoção.
    const row = ev.target.closest(".lst-entry");
    if (row) {
      const id = row.dataset.entry;
      const variant = row.dataset.entryVariant || null;
      const entry = store.entry(current.id, id, variant);
      if (!entry) return;
      const q = entry.q == null ? 1 : entry.q;
      if (ev.target.closest("[data-entry-inc]")) { store.setEntryQty(current.id, id, variant, q + 1); renderEntries(); return; }
      if (ev.target.closest("[data-entry-dec]")) { store.setEntryQty(current.id, id, variant, q - 1); renderEntries(); renderSource(); return; }
      if (ev.target.closest("[data-entry-del]")) { store.removeEntry(current.id, id, variant); renderEntries(); renderSource(); return; }
    }

    if (ev.target.closest("[data-list-export]")) { openExportModal(); return; }
    if (ev.target.closest("[data-list-apply]")) { openApplyModal(); return; }
    if (ev.target.closest("[data-list-deck]")) { criarDeckDaLista(); return; }

    if (ev.target.closest("[data-list-del]")) {
      // Toast com desfazer, como o resto do site — nada de confirm() bloqueante.
      // Volta pra galeria trocando de VISTA (não navegando): um location.href
      // recarregaria a página e levaria o toast junto, sem chance de desfazer.
      const undo = shared.snapshotKeys([store.STORAGE_KEY]);
      store.remove(current.id);
      current = null;
      history.replaceState(null, "", "listas.html");
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
    if (ev.target.matches("[data-list-linked]")) store.setLinked(current.id, ev.target.checked);
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
    // carta que tenha barra).
    const digitando = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName);
    if (ev.key === "/" && !digitando) { ev.preventDefault(); if (busca) busca.focus(); return; }

    if (ev.key === "Escape") {
      if (openPicker) { openPicker = null; renderSource(); ev.preventDefault(); }
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

  // Miniatura no hover: a linha não tem imagem (é o ponto do modo), mas passar o
  // mouse no nome mostra a carta. Mesmo mecanismo da seção Impressões do popup —
  // propriedade, não addEventListener, pra não empilhar handler a cada render.
  el.editor.onmouseover = (ev) => {
    const name = ev.target.closest("[data-thumb]");
    const thumb = el.editor.querySelector(".lst-thumb");
    if (!thumb) return;
    if (!name || !name.dataset.thumb) { thumb.hidden = true; return; }
    thumb.src = name.dataset.thumb;
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
