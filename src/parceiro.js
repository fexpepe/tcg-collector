// Portal da loja (parceiro.html, Analytics 2.1): o relatório que uma loja
// parceira abre pelo link privado criado em /admin › Mercado › Portal da loja.
// Mostra SÓ o tráfego que o Sleevu mandou pra ela: cliques, pessoas, valor das
// cartas, jogos e as cartas mais procuradas. Quem responde é a RPC anônima
// partner_report (migração 20260928a), com a credencial no ?t= da URL; carta
// com menos de 3 pessoas já chega somada em "outras".
//
// Os gráficos e as classes visuais são os do /admin (TCGAdminCharts, carregado
// pelo src/admin.js — que sem o #adminRoot só expõe os gráficos e sai).
(function () {
  "use strict";
  const shared = window.TCGShared;
  const C = window.TCGAdminCharts;
  const root = document.getElementById("partnerRoot");
  if (!shared || !C || !root) return;
  const { t } = shared;
  const { esc, fmt, hbars, dailyBars } = C;

  const token = new URLSearchParams(location.search).get("t") || "";
  const LOJA = { liga: "Liga", ligabra: "LigaBRA", myp: "MYP", ebay: "eBay", tcgplayer: "TCGplayer", pricecharting: "PriceCharting", cardmarket: "Cardmarket" };
  const brl = (v) => `R$ ${Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
  const gameLabel = (g) => { try { return shared.gameLabel ? shared.gameLabel(g) : g; } catch (e) { return g; } };
  const gameColor = (g) => (shared.GAME_COLOR || {})[g] || "#9aa3ae";
  const stat = (label, val, hint) => `<div class="admin-stat"><span class="admin-stat-val">${esc(val)}</span><span class="admin-stat-label">${esc(label)}</span>${hint ? `<span class="admin-stat-hint">${esc(hint)}</span>` : ""}</div>`;
  const section = (title, body, note) => `<section class="admin-section"><h2>${esc(title)}</h2>${body}${note ? `<p class="admin-note">${esc(note)}</p>` : ""}</section>`;
  const largura = () => ((root.clientWidth || 800) < 700 ? { w: 360, h: 200 } : { w: 960, h: 220 });

  const state = { days: 30, nomes: {} };

  // Nome da carta pelo catálogo estático (o banco só tem o id).
  async function resolveNomes(cartas) {
    if (!shared.loadOwnedAcrossGames) return;
    const pedido = {};
    cartas.forEach((c) => { if (!(`${c.game}:${c.card_id}` in state.nomes)) (pedido[c.game] = pedido[c.game] || []).push(c.card_id); });
    if (!Object.keys(pedido).length) return;
    Object.keys(pedido).forEach((g) => pedido[g].forEach((id) => { state.nomes[`${g}:${id}`] = ""; }));
    try {
      const cat = await shared.loadOwnedAcrossGames(pedido);
      (cat.cards || []).forEach((c) => { if (c.game) state.nomes[`${c.game}:${c.id}`] = [c.name, c.set && c.number ? `${c.set} ${c.number}` : ""].filter(Boolean).join(" · "); });
    } catch (e) { /* segue com o id */ }
  }

  function pinta(r) {
    const loja = LOJA[r.loja] || r.loja;
    const cartas = r.cartas || [];
    const outras = r.outras || {};
    const periodos = [7, 30, 90].map((d) => `<button type="button" class="chip" data-days="${d}" aria-pressed="${state.days === d}">${esc(t("ptn.days", { n: d }))}</button>`).join("");
    const linhas = cartas.map((c) => {
      const nome = state.nomes[`${c.game}:${c.card_id}`];
      return `<tr><td><span class="adm-game" style="--g:${esc(gameColor(c.game))}">${esc(gameLabel(c.game))}</span></td><td>${nome ? esc(nome) : `<span class="adm-mono">${esc(c.card_id)}</span>`}</td><td class="num">${esc(fmt(c.cliques))}</td><td class="num">${esc(fmt(c.pessoas))}</td><td class="num">${esc(brl(c.valor))}</td></tr>`;
    }).join("");
    root.innerHTML = `
      <p class="collection-subtitle">${esc(t("ptn.lead", { loja }))}${r.rotulo ? ` <small>(${esc(r.rotulo)})</small>` : ""}</p>
      <div class="adm-toolbar"><div class="adm-period" role="group" aria-label="${esc(t("ptn.period"))}">${periodos}</div></div>
      <div class="admin-stats">
        ${stat(t("ptn.clicks"), fmt(r.cliques))}
        ${stat(t("ptn.people"), fmt(r.pessoas))}
        ${stat(t("ptn.value"), brl(r.valor), t("ptn.valueHint"))}
      </div>
      ${r.cliques ? `
        ${section(t("ptn.perDay"), dailyBars(r.daily || [], Object.assign(largura(), { keyA: "cliques", keyB: "__none", labelA: t("ptn.clicks"), aria: t("ptn.perDay") })))}
        ${section(t("ptn.byGame"), hbars((r.jogos || []).map((x) => ({ label: gameLabel(x.game), value: x.cliques, color: gameColor(x.game), sub: `${fmt(x.pessoas)} · ${brl(x.valor)}` }))))}
        ${section(t("ptn.topCards"), cartas.length ? `<div class="adm-scroll"><table class="admin-table"><thead><tr><th>${esc(t("ptn.game"))}</th><th>${esc(t("ptn.card"))}</th><th class="num">${esc(t("ptn.clicks"))}</th><th class="num">${esc(t("ptn.people"))}</th><th class="num">${esc(t("ptn.value"))}</th></tr></thead><tbody>${linhas}</tbody></table></div>` : "",
          outras.cartas ? t("ptn.others", { n: fmt(outras.cartas), c: fmt(outras.cliques) }) : "")}`
        : `<p class="empty-state">${esc(t("ptn.empty"))}</p>`}
      <p class="admin-note">${esc(t("ptn.method"))}</p>
      <p class="admin-note">${esc(t("ptn.updated", { data: new Date(r.gerado).toLocaleString() }))}</p>`;
  }

  async function carrega() {
    root.setAttribute("aria-busy", "true");
    const r = await shared.partnerReport(token, state.days);
    root.removeAttribute("aria-busy");
    if (r === null) { root.innerHTML = `<p class="empty-state">${esc(t("ptn.invalid"))}</p>`; return; }
    if (r === undefined || typeof r !== "object") { root.innerHTML = `<p class="empty-state">${esc(t("ptn.error"))}</p>`; return; }
    pinta(r);
    await resolveNomes(r.cartas || []);
    pinta(r);
  }

  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-days]");
    if (!b) return;
    state.days = Number(b.dataset.days) || 30;
    carrega();
  });
  carrega();
})();
