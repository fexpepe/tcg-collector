// Analisador de troca (F1 do docs/PLANO-UX.md) — a ferramenta-assinatura do
// Collectr, na versão Sleevu: dois painéis (Eu dou / Eu recebo), cada linha
// com condição × quantidade × valor, veredito de equilíbrio, histórico local
// e export como imagem pros grupos.
//
// Valores: cotação de mercado pela MESMA fórmula do site (shared.cardValue,
// com o fator de condição), pré-preenchida e SEMPRE editável — troca se fecha
// no preço combinado, não no teórico. Editar marca a linha (vm) e o valor
// manual passa a mandar; mudar a condição só recalcula quem não foi editado.
//
// A busca acha carta de QUALQUER jogo pela borda (/api/search) e hidrata pelos
// chunks; com a borda desligada (dev/soluço), cai no índice estático de busca
// do jogo da sessão (página neutra não tem catálogo pro loadCatalog devolver).
// Depois de adicionar, um loadOwnedFast com TODOS os ids da mesa refaz a
// união de preços (window.TCG_PRICING) — é o que dá preço a carta de jogo
// diferente do da sessão.
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const { t, tn, escapeHtml, escapeAttribute, debounce } = shared;
  const GAMES = shared.GAME_SLUGS;
  const money = (v) => shared.formatMoney(shared.getCurrency(), v);
  const HKEY = "tcg-trade-checks-v1";

  const cardsById = new Map();
  const gameOf = (id) => (cardsById.get(id) || {}).game || "pokemon";
  const pricesByGame = Object.fromEntries(GAMES.map((g) => [g, shared.createPriceStore(g)]));
  const prices = shared.mergedPriceStore(pricesByGame, gameOf);

  // Um item por (carta, lado): { id, variant, cond, q, v, vm } — v = valor
  // UNITÁRIO na moeda atual; vm = true quando a pessoa digitou (não recalcula).
  const lados = { give: [], get: [] };

  const el = {
    itens: { give: document.getElementById("tradeItemsGive"), get: document.getElementById("tradeItemsGet") },
    totais: { give: document.getElementById("tradeTotalGive"), get: document.getElementById("tradeTotalGet") },
    buscas: { give: document.getElementById("tradeSearchGive"), get: document.getElementById("tradeSearchGet") },
    resultados: { give: document.getElementById("tradeResultsGive"), get: document.getElementById("tradeResultsGet") },
    verdict: document.getElementById("tradeVerdict"),
    save: document.getElementById("tradeSave"),
    export: document.getElementById("tradeExport"),
    clear: document.getElementById("tradeClear"),
    history: document.getElementById("tradeHistory"),
    balance: document.getElementById("tradeBalance"),
    historyList: document.getElementById("tradeHistoryList")
  };
  if (!el.itens.give) return;

  // Aceita "1.234,56" e "1234.56" (mesma régua do cadastro de itens manuais).
  const numDeTexto = (s) => {
    let x = String(s || "").trim();
    if (x.includes(",")) x = x.replace(/\./g, "").replace(",", ".");
    const v = parseFloat(x);
    return isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : 0;
  };
  const fmtNum = (v) => (Number(v) > 0 ? String(Math.round(Number(v) * 100) / 100).replace(".", ",") : "");

  function valorCalculado(item) {
    const card = cardsById.get(item.id);
    if (!card) return 0;
    return shared.cardValue(card, item.variant, prices, item.cond).value || 0;
  }
  const totalDe = (side) => lados[side].reduce((s, it) => s + (Number(it.v) || 0) * (Number(it.q) || 1), 0);

  // ── Busca ──────────────────────────────────────────────────────────────────
  // Devolve a lista de cartas OU o marcador INDISPONIVEL. A distinção importa:
  // o searchApi devolve null em qualquer falha (rede, 404, pausa de rate
  // limit), e tratar isso como lista vazia fazia a tela dizer "Nada
  // encontrado" — a pessoa conclui que o Sleevu não TEM a carta da troca dela,
  // quando o que houve foi a busca não ter respondido.
  const INDISPONIVEL = Symbol("busca indisponível");
  async function busca(q) {
    const hits = await shared.searchApi("all", q, 20);
    if (hits && hits.length) {
      const idsByGame = Object.create(null);
      hits.forEach((h) => { const g = h.g || "pokemon"; (idsByGame[g] = idsByGame[g] || []).push(h.i); });
      const catalog = await shared.loadOwnedAcrossGames(idsByGame).catch(() => ({ cards: [] }));
      const byId = new Map((catalog.cards || []).map((c) => [c.id, c]));
      return hits.map((h) => byId.get(h.i)).filter(Boolean);
    }
    // Borda desligada (dev/soluço): índice estático do jogo da sessão (mesma
    // régua do listas.js — carregar o índice de TODOS os jogos seria pesado
    // demais; o do Magic sozinho tem 8 MB).
    try {
      const bruto = (window.SLEEVU && window.SLEEVU.game) || "pokemon";
      const jogo = bruto === "hub" ? "pokemon" : bruto;
      const idx = await shared.loadSearchIndex(jogo);
      if (!idx) return INDISPONIVEL; // nem a borda nem o índice responderam
      const nq = shared.normalize(q);
      const achados = (idx || []).filter((e) => shared.normalize(e.n).includes(nq) || shared.normalize(e.u) === nq).slice(0, 20);
      if (!achados.length) return [];
      const catalog = await shared.loadOwnedAcrossGames({ [jogo]: achados.map((e) => e.i) });
      const byId = new Map((catalog.cards || []).map((c) => [c.id, c]));
      return achados.map((e) => byId.get(e.i)).filter(Boolean);
    } catch (e) { return INDISPONIVEL; }
  }

  function renderResultados(side, cards) {
    const box = el.resultados[side];
    if (!box) return;
    if (cards === INDISPONIVEL) {
      box.innerHTML = `<p class="trade-none">${escapeHtml(t("trade.searchDown"))}</p>`;
      box.hidden = false;
      return;
    }
    if (!cards.length) {
      box.innerHTML = `<p class="trade-none">${escapeHtml(t("trade.none"))}</p>`;
      box.hidden = false;
      return;
    }
    box.innerHTML = cards.map((c) => `
      <button type="button" class="trade-hit" data-hit-id="${escapeAttribute(c.id)}">
        <span class="trade-hit-name">${escapeHtml(c.name)}</span>
        <span class="trade-hit-meta">${escapeHtml(`${c.set || ""} · ${c.number || ""}`)} <em>${escapeHtml(shared.gameLabel(c.game || "pokemon"))}</em></span>
      </button>`).join("");
    box.hidden = false;
  }
  function fechaResultados() {
    el.resultados.give.hidden = true;
    el.resultados.get.hidden = true;
  }

  ["give", "get"].forEach((side) => {
    el.buscas[side].addEventListener("input", debounce(async () => {
      const q = el.buscas[side].value.trim();
      if (q.length < 2) { el.resultados[side].hidden = true; return; }
      const achadas = await busca(q);
      achadas.forEach((c) => cardsById.set(c.id, c));
      if (el.buscas[side].value.trim() === q) renderResultados(side, achadas);
    }, 300));
    el.resultados[side].addEventListener("click", (e) => {
      const hit = e.target.closest("[data-hit-id]");
      if (!hit) return;
      adiciona(side, hit.dataset.hitId);
      el.buscas[side].value = "";
      fechaResultados();
    });
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".trade-search")) fechaResultados(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") fechaResultados(); });

  async function adiciona(side, id) {
    const card = cardsById.get(id);
    if (!card) return;
    const item = {
      id,
      variant: shared.defaultVariant(card),
      cond: shared.DEFAULT_CONDITION,
      q: 1,
      v: 0,
      vm: false
    };
    lados[side].push(item);
    render();
    // União de preços com TODOS os ids da mesa: é o que dá cotação a carta de
    // jogo diferente do da sessão (o loadOwnedFast regrava window.TCG_PRICING).
    const idsByGame = {};
    [].concat(lados.give, lados.get).forEach((it) => {
      const g = gameOf(it.id);
      (idsByGame[g] = idsByGame[g] || []).push(it.id);
    });
    try { await shared.loadOwnedFast(idsByGame); } catch (e) { /* segue com o que há */ }
    lados.give.concat(lados.get).forEach((it) => { if (!it.vm) it.v = valorCalculado(it); });
    render();
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function linhaHtml(side, item, i) {
    const card = cardsById.get(item.id) || { name: "?", set: "", number: "" };
    const conds = shared.CARD_CONDITIONS.map((c) => `<option value="${c}"${c === item.cond ? " selected" : ""}>${c}</option>`).join("");
    return `<div class="trade-item" data-side="${side}" data-i="${i}">
      <span class="trade-item-name"><strong>${escapeHtml(card.name)}</strong><span>${escapeHtml(`${card.set || ""} · ${card.number || ""}`)}</span></span>
      <select class="trade-cond" data-tr-cond aria-label="${escapeAttribute(t("trade.cond"))}">${conds}</select>
      <input class="trade-qty" data-tr-qty type="number" min="1" step="1" value="${Number(item.q) || 1}" aria-label="${escapeAttribute(t("trade.qty"))}">
      <input class="trade-val sensitive-value" data-tr-val type="text" inputmode="decimal" value="${escapeAttribute(fmtNum(item.v))}" aria-label="${escapeAttribute(t("trade.value"))}">
      <button type="button" class="trade-rm" data-tr-rm title="${escapeAttribute(t("trade.remove"))}" aria-label="${escapeAttribute(t("trade.remove"))}">×</button>
    </div>`;
  }
  function render() {
    ["give", "get"].forEach((side) => {
      el.itens[side].innerHTML = lados[side].length
        ? lados[side].map((it, i) => linhaHtml(side, it, i)).join("")
        : `<p class="trade-empty">${escapeHtml(t("trade.empty"))}</p>`;
      el.totais[side].textContent = lados[side].length ? money(totalDe(side)) : "—";
    });
    renderVerdict();
    const tem = lados.give.length || lados.get.length;
    el.save.disabled = !tem;
    el.export.disabled = !tem;
    el.clear.disabled = !tem;
  }
  function renderVerdict() {
    const dou = totalDe("give"), recebo = totalDe("get");
    if (!lados.give.length && !lados.get.length) { el.verdict.hidden = true; return; }
    const diff = recebo - dou;
    const base = Math.max(dou, recebo);
    // Equilibrada: diferença até 5% do lado maior (ou centavos, em troca miúda).
    const justa = base <= 0 || Math.abs(diff) <= Math.max(1, base * 0.05);
    const pct = base > 0 ? Math.abs(diff / base) * 100 : 0;
    const pctTxt = pct.toLocaleString(shared.getLocale(), { maximumFractionDigits: 1 });
    let classe = "is-fair", texto = t("trade.fair");
    if (!justa && diff > 0) { classe = "is-you"; texto = t("trade.you", { v: money(diff), p: pctTxt }); }
    if (!justa && diff < 0) { classe = "is-them"; texto = t("trade.them", { v: money(-diff), p: pctTxt }); }
    el.verdict.className = `trade-verdict ${classe}`;
    el.verdict.textContent = texto;
    el.verdict.hidden = false;
  }

  // Edição inline (delegação nos dois painéis).
  ["give", "get"].forEach((side) => {
    el.itens[side].addEventListener("change", (e) => {
      const row = e.target.closest(".trade-item");
      if (!row) return;
      const item = lados[side][Number(row.dataset.i)];
      if (!item) return;
      if (e.target.closest("[data-tr-cond]")) {
        item.cond = e.target.value;
        if (!item.vm) item.v = valorCalculado(item);
      }
      if (e.target.closest("[data-tr-qty]")) item.q = Math.max(1, parseInt(e.target.value, 10) || 1);
      if (e.target.closest("[data-tr-val]")) { item.v = numDeTexto(e.target.value); item.vm = true; }
      render();
    });
    el.itens[side].addEventListener("click", (e) => {
      const row = e.target.closest(".trade-item");
      if (!row || !e.target.closest("[data-tr-rm]")) return;
      lados[side].splice(Number(row.dataset.i), 1);
      render();
    });
  });

  el.clear.addEventListener("click", () => { lados.give = []; lados.get = []; render(); });

  // ── Histórico local (cap 20; resumo, não reabre — v1) ──────────────────────
  const leHistorico = () => { try { return JSON.parse(localStorage.getItem(HKEY) || "[]") || []; } catch (e) { return []; } };
  function renderHistorico() {
    const lista = leHistorico();
    el.history.hidden = !lista.length;
    if (!lista.length) return;
    const loc = shared.getLocale();
    // Saldo acumulado: o histórico guardava os dois totais de cada troca e só
    // pintava linha por linha — a soma, que é a pergunta óbvia ("no fim das
    // contas eu saí ganhando?"), ninguém fazia. Rotulado como "neste aparelho"
    // porque a chave é local (não entra no sync).
    if (el.balance) {
      const saldo = lista.reduce((s2, h) => s2 + ((Number(h.tr) || 0) - (Number(h.tg) || 0)), 0);
      const sinal = saldo > 0 ? "+" : "";
      el.balance.innerHTML = `<strong class="sensitive-value">${escapeHtml(sinal + money(Math.abs(saldo) < 0.005 ? 0 : saldo))}</strong> `
        + escapeHtml(tn("trade.balance", lista.length));
      el.balance.hidden = false;
    }
    el.historyList.innerHTML = lista.map((h, i) => {
      const data = new Date(h.t).toLocaleDateString(loc, { day: "2-digit", month: "2-digit", year: "2-digit" });
      const diff = (Number(h.tr) || 0) - (Number(h.tg) || 0);
      const seta = Math.abs(diff) <= Math.max(1, Math.max(h.tg, h.tr) * 0.05) ? "=" : (diff > 0 ? "▲" : "▼");
      return `<div class="trade-hrow">
        <span class="trade-hdate">${escapeHtml(data)}</span>
        <span class="trade-hsum">${escapeHtml(tn("trade.nCards", (h.give || []).length))} → ${escapeHtml(tn("trade.nCards", (h.get || []).length))}</span>
        <span class="trade-hvals sensitive-value">${escapeHtml(`${money(h.tg)} × ${money(h.tr)}`)}</span>
        <span class="trade-hverdict">${seta}</span>
        <button type="button" class="trade-rm" data-h-rm="${i}" title="${escapeAttribute(t("trade.remove"))}" aria-label="${escapeAttribute(t("trade.remove"))}">×</button>
      </div>`;
    }).join("");
  }
  el.historyList.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-h-rm]");
    if (!rm) return;
    const lista = leHistorico();
    lista.splice(Number(rm.dataset.hRm), 1);
    try { localStorage.setItem(HKEY, JSON.stringify(lista)); } catch (err) { /* ignora */ }
    renderHistorico();
  });
  el.save.addEventListener("click", () => {
    const resumo = (side) => lados[side].map((it) => {
      const c = cardsById.get(it.id) || {};
      return { n: c.name || "?", q: it.q, v: it.v };
    });
    const lista = leHistorico();
    lista.unshift({ t: Date.now(), cur: shared.getCurrency(), give: resumo("give"), get: resumo("get"), tg: totalDe("give"), tr: totalDe("get") });
    try { localStorage.setItem(HKEY, JSON.stringify(lista.slice(0, 20))); } catch (err) { /* ignora */ }
    renderHistorico();
  });

  // ── Export como imagem (texto puro: nunca tainta o canvas) ─────────────────
  el.export.addEventListener("click", () => {
    const W = 1080, H = 1350;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const FONTE = "system-ui, -apple-system, 'Segoe UI', sans-serif";
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#141828"); bg.addColorStop(1, "#0b0d14");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.fillStyle = "#f4f6fb";
    ctx.font = `800 56px ${FONTE}`;
    ctx.fillText(t("trade.title"), W / 2, 110);
    const coluna = (side, x, titulo) => {
      ctx.textAlign = "left";
      ctx.fillStyle = "#8b93a7";
      ctx.font = `800 34px ${FONTE}`;
      ctx.fillText(titulo, x, 220);
      ctx.font = `600 30px ${FONTE}`;
      const linhas = lados[side].slice(0, 10);
      linhas.forEach((it, i) => {
        const c = cardsById.get(it.id) || {};
        ctx.fillStyle = "#d7dbe6";
        const nome = `${it.q > 1 ? it.q + "× " : ""}${c.name || "?"}`;
        ctx.fillText(nome.length > 24 ? nome.slice(0, 23) + "…" : nome, x, 280 + i * 56, 420);
        ctx.fillStyle = "#8b93a7";
        ctx.textAlign = "right";
        ctx.fillText(money((Number(it.v) || 0) * (Number(it.q) || 1)), x + 460, 280 + i * 56);
        ctx.textAlign = "left";
      });
      if (lados[side].length > 10) {
        ctx.fillStyle = "#5d6472";
        ctx.fillText(`+${lados[side].length - 10}…`, x, 280 + 10 * 56);
      }
      ctx.fillStyle = "#f4f6fb";
      ctx.font = `800 40px ${FONTE}`;
      ctx.fillText(money(totalDe(side)), x, 940);
    };
    coluna("give", 60, t("trade.give"));
    coluna("get", 590, t("trade.get"));
    ctx.strokeStyle = "#2a2f42"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2, 190); ctx.lineTo(W / 2, 960); ctx.stroke();
    const dou = totalDe("give"), recebo = totalDe("get");
    const diff = recebo - dou, base = Math.max(dou, recebo);
    const justa = base <= 0 || Math.abs(diff) <= Math.max(1, base * 0.05);
    ctx.textAlign = "center";
    ctx.fillStyle = justa ? "#2ecc71" : (diff > 0 ? "#2ecc71" : "#e8553c");
    ctx.font = `800 44px ${FONTE}`;
    const pctTxt = base > 0 ? (Math.abs(diff / base) * 100).toLocaleString(shared.getLocale(), { maximumFractionDigits: 1 }) : "0";
    ctx.fillText(justa ? t("trade.fair") : (diff > 0 ? t("trade.you", { v: money(diff), p: pctTxt }) : t("trade.them", { v: money(-diff), p: pctTxt })), W / 2, 1090, W - 100);
    ctx.fillStyle = "#5d6472";
    ctx.font = `700 30px ${FONTE}`;
    ctx.fillText("sleevu.app", W / 2, H - 64);
    shared.baixarCanvasPng(canvas, "troca-sleevu.png", { share: true });
  });

  renderHistorico();
  render();
})();
