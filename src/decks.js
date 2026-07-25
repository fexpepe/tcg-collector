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
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.decks)) return parsed;
    } catch (e) { /* corrompido: começa limpo */ }
    return { decks: [] };
  }
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

  // ---------------------------------------------------------------------------
  // Catálogo do jogo do deck (pode ser != do jogo da sessão). Cache em memória
  // por jogo: reabrir o editor no mesmo jogo não baixa de novo.
  // ---------------------------------------------------------------------------
  const catalogCache = {};
  async function catalogFor(game) {
    if (catalogCache[game]) return catalogCache[game];
    const dir = shared.gameDataDir(game);
    const r = await shared.loadGameCatalog(game, dir, null);
    const cards = r.cards || [];
    const byId = {};
    cards.forEach((c) => { c.game = game; byId[c.id] = c; });
    // cardValue lê window.TCG_PRICING; loadGameCatalog restaura o da sessão, então
    // mescla o do jogo do deck pra o preço não sair zerado.
    if (r.pricing) window.TCG_PRICING = Object.assign({}, window.TCG_PRICING || {}, r.pricing);
    catalogCache[game] = { cards, byId };
    return catalogCache[game];
  }

  // ---------------------------------------------------------------------------
  // Valor: total, o que já tenho e o que falta comprar (o número que importa).
  // ---------------------------------------------------------------------------
  function computeValue(deck, byId) {
    const owned = shared.createCollectionStore(deck.game);
    const prices = shared.createPriceStore(deck.game);
    let total = 0, have = 0, missing = 0, missingCards = 0;
    allEntries(deck).forEach(({ entry }) => {
      const card = byId[entry.id];
      if (!card) return;
      const variant = entry.variant || shared.defaultVariant(card);
      const unit = (shared.cardValue(card, variant, prices) || {}).value || 0;
      const qty = entry.qty || 0;
      // Posse conta QUALQUER variante: uma Charizard foil joga como Charizard.
      const inColl = owned.totalForCard ? owned.totalForCard(entry.id) : 0;
      const hv = Math.min(qty, inColl);
      total += qty * unit;
      have += hv * unit;
      missing += (qty - hv) * unit;
      missingCards += (qty - hv);
    });
    return { total, have, missing, missingCards };
  }
  function ownedCountOf(deck, cardId) {
    const owned = shared.createCollectionStore(deck.game);
    return owned.totalForCard ? owned.totalForCard(cardId) : 0;
  }

  const money = (v) => shared.formatMoney(shared.getCurrency(), v);

  // ---------------------------------------------------------------------------
  // Vistas
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Página PÚBLICA (decks.html): só a listagem da comunidade está pendente — o
  // construtor já existe. Logado, o CTA "Criar conta" não faz sentido (a pessoa
  // já tem conta) e não havia caminho nenhum pro editor. Troca por "Meus Decks".
  // ---------------------------------------------------------------------------
  const publicCta = document.getElementById("decksCta");
  if (publicCta) {
    if (shared.getSession && shared.getSession()) {
      publicCta.setAttribute("href", "my-decks.html");
      publicCta.removeAttribute("data-i18n");          // senão o i18n reescreve
      publicCta.textContent = t("decks.goMine");
      const txt = document.getElementById("decksSoonText");
      if (txt) { txt.removeAttribute("data-i18n"); txt.textContent = t("decks.publicSoonAuth"); }
    }
    return; // a página pública não tem galeria/editor
  }

  const el = {
    gallery: document.getElementById("deckGallery"),
    editor: document.getElementById("deckEditor")
  };
  if (!el.gallery || !el.editor) return;

  function show(view) {
    el.gallery.hidden = view !== "gallery";
    el.editor.hidden = view !== "editor";
  }

  function gameDot(game) {
    return `<span class="deck-dot" style="background:${escA(shared.GAME_COLOR[game] || "#888")}"></span>`;
  }

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
          <span class="deck-card-meta">${gameDot(d.game)}${esc(shared.gameLabel(d.game))}${d.format ? " · " + esc(t("decks.format." + d.format)) : ""} · ${esc(String(n))} ${esc(t("decks.cardsWord"))}</span>
        </a>
        <div class="deck-card-actions">
          <button type="button" class="deck-mini" data-deck-dup="${escA(d.id)}">${esc(t("decks.duplicate"))}</button>
          <button type="button" class="deck-mini danger" data-deck-del="${escA(d.id)}">${esc(t("decks.delete"))}</button>
        </div>
      </article>`;
    }).join("") + `</div>`;
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
        `<button type="button" class="deck-game-pick" data-pick-game="${escA(g)}">${gameDot(g)}${esc(shared.gameLabel(g))}</button>`).join("");
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

  async function openEditor(deck) {
    current = deck;
    show("editor");
    el.editor.innerHTML = `<p class="empty-state">${esc(t("decks.loading"))}</p>`;
    try {
      // loadFxRates é OBRIGATÓRIO antes de calcular valor: sem as taxas,
      // convertMoney devolve null e cardValue cai pra 0 — o painel inteiro
      // sairia zerado mesmo com preço no catálogo.
      const [c] = await Promise.all([catalogFor(deck.game), shared.loadFxRates()]);
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

  function renderEditor() {
    const deck = current;
    const pack = packOf(deck);
    const val = computeValue(deck, cat.byId);
    const issues = rules.validate(deck, cat.byId);
    const an = rules.analyze(deck, cat.byId);

    const zonesHtml = (pack.zones || []).map((z) => {
      const entries = deck.zones[z.key] || [];
      const n = rules.countIn(deck, z.key);
      const limit = z.max ? `${n}/${z.max}` : (z.min ? `${n}/${z.min}` : String(n));
      const rows = entries.map((e) => {
        const card = cat.byId[e.id];
        const name = card ? card.name : e.id;
        const have = ownedCountOf(deck, e.id);
        const badge = have >= (e.qty || 0)
          ? `<span class="deck-own ok">${esc(t("decks.ownHave"))}</span>`
          : have > 0
            ? `<span class="deck-own part">${esc(t("decks.ownPartial").replace("{n}", String(have)))}</span>`
            : `<span class="deck-own no">${esc(t("decks.ownNone"))}</span>`;
        return `<li class="deck-row" data-zone="${escA(z.key)}" data-card="${escA(e.id)}">
          <span class="deck-qty">${esc(String(e.qty))}×</span>
          <span class="deck-row-name">${esc(name)}</span>
          ${badge}
          <span class="deck-row-btns">
            <button type="button" class="deck-mini" data-dec>−</button>
            <button type="button" class="deck-mini" data-inc>+</button>
          </span>
        </li>`;
      }).join("");
      return `<section class="deck-zone">
        <h3>${esc(t("decks.zone." + z.key))} <span class="deck-zone-n">${esc(limit)}</span></h3>
        <ul class="deck-list">${rows || `<li class="deck-empty">${esc(t("decks.zoneEmpty"))}</li>`}</ul>
      </section>`;
    }).join("");

    const issuesHtml = issues.length
      ? `<ul class="deck-issues">` + issues.map((i) => `<li>${esc(issueText(i))}</li>`).join("") + `</ul>`
      : `<p class="deck-legal">${esc(pack.free ? t("decks.freeMode") : t("decks.legal"))}</p>`;

    el.editor.innerHTML = `
      <div class="deck-ed-head">
        <a href="my-decks.html" class="serie-back">${esc(t("decks.backList"))}</a>
        <input id="deckName" class="deck-name-input" value="${escA(deck.name)}" aria-label="${escA(t("decks.nameLabel"))}">
        <span class="deck-ed-game">${gameDot(deck.game)}${esc(shared.gameLabel(deck.game))}${pack.format ? " · " + esc(t("decks.format." + pack.format)) : ""}</span>
      </div>
      <div class="deck-ed-cols">
        <div class="deck-ed-left">
          ${zonesHtml}
          ${issuesHtml}
          <section class="deck-value">
            <h3>${esc(t("decks.value"))}</h3>
            <div class="deck-value-row"><span>${esc(t("decks.valueTotal"))}</span><strong>${esc(money(val.total))}</strong></div>
            <div class="deck-value-row"><span>${esc(t("decks.valueHave"))}</span><strong class="have">${esc(money(val.have))}</strong></div>
            <div class="deck-value-row missing"><span>${esc(t("decks.valueMissing"))}</span><strong>${esc(money(val.missing))}</strong></div>
            <p class="deck-value-note">${esc(t("decks.missingCount").replace("{n}", String(val.missingCards)))}</p>
          </section>
          ${(an.curve || an.dist || an.rarity) ? `<section class="deck-analysis">
            <h3>${esc(t("decks.analysis"))}</h3>
            ${curveHtml(an.curve)}
            ${barsHtml(t("decks.dist"), an.dist, true)}
            ${barsHtml(t("decks.rarity"), an.rarity)}
          </section>` : ""}
        </div>
        <div class="deck-ed-right">
          <h3>${esc(t("decks.addCards"))}</h3>
          <input id="deckSearch" class="deck-search" type="search" placeholder="${escA(t("decks.searchPlaceholder", { deckGame: shared.gameLabel(deck.game) }))}" value="${escA(query)}">
          <div id="deckResults" class="deck-results"></div>
        </div>
      </div>`;

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

  // Resultados da busca — SEMPRE do jogo do deck (nunca mistura catálogo).
  function renderResults() {
    const box = document.getElementById("deckResults");
    if (!box) return;
    const deck = current;
    const q = query.trim();
    if (q.length < 2) { box.innerHTML = `<p class="deck-hint">${esc(t("decks.searchHint"))}</p>`; return; }
    const hits = [];
    for (const card of cat.cards) {
      if (shared.matchesCardQuery(card, q)) hits.push(card);
      if (hits.length >= 60) break;             // teto: catálogo pode ter 46k
    }
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
      return `<div class="deck-hit${def || zones.length ? "" : " is-off"}">
        <span class="deck-hit-img">${img}</span>
        <span class="deck-hit-body">
          <span class="deck-hit-name">${esc(c.name)}</span>
          <span class="deck-hit-meta">${esc(c.set || "")} ${esc(c.number || "")}</span>
        </span>
        ${have ? `<span class="deck-own ok">${esc(t("decks.ownHave"))} ${esc(String(have))}</span>` : ""}
        <span class="deck-hit-btns">${btns}</span>
      </div>`;
    }).join("");
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
        data.decks.splice(data.decks.indexOf(d), 1); save(); renderGallery();
      }
    }
  });

  el.editor.addEventListener("click", (ev) => {
    const add = ev.target.closest("[data-add]");
    if (add && !add.disabled) {
      const card = cat.byId[add.dataset.add];
      if (card && add.dataset.zone) { addCard(current, add.dataset.zone, card, 1); renderEditor(); }
      return;
    }
    const row = ev.target.closest(".deck-row");
    if (!row) return;
    const card = cat.byId[row.dataset.card];
    if (!card) return;
    if (ev.target.closest("[data-inc]")) { addCard(current, row.dataset.zone, card, 1); renderEditor(); }
    else if (ev.target.closest("[data-dec]")) { addCard(current, row.dataset.zone, card, -1); renderEditor(); }
  });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  const id = new URLSearchParams(location.search).get("id");
  const deck = id ? getDeck(id) : null;
  if (deck) openEditor(deck);
  else { show("gallery"); renderGallery(); }
})();
