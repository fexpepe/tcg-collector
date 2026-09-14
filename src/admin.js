// Painel de admin 2.0 (admin.html): números agregados/anônimos do site em
// cinco abas (Visão geral, Audiência, Conteúdo, Produto, Qualidade), com
// período de 7/30/90 dias. Só o dono lê: a RPC admin_dashboard (migração
// 20260914a) só responde se is_admin; senão devolve null.
//
// Gráficos em SVG inline, desenhados aqui mesmo — sem biblioteca, como o resto
// do site (sem build, sem bundler). São quatro formas: barras por dia (gente ×
// robô empilhados), linhas (visitantes × logados), rosca (proporções) e
// mosaico/treemap (tamanho = volume). Cor vem das variáveis do tema, e a cor de
// cada jogo é a mesma da marca no resto do site (GAME_COLOR).
//
// Texto em pt fixo — é uma página interna.
(function () {
  "use strict";

  // ── Gráficos (puros: entram números, sai string SVG/HTML) ─────────────────
  // Ficam ANTES do guard do TCGShared de propósito: os testes
  // (tests/admin-charts.test.mjs) carregam este arquivo sem o shared.js e
  // exercitam só isto via window.TCGAdminCharts.
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmt(n) { return n == null ? "—" : Number(n).toLocaleString("pt-BR"); }
  function pct(n, d) { return d ? `${(100 * n / d).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—"; }
  // Paleta neutra pra categorias que não são jogo (dispositivo, idioma…).
  const PALETTE = ["#dc2626", "#2563eb", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#9aa3ae", "#7a4a2b"];
  const colorAt = (i) => PALETTE[i % PALETTE.length];

  // Treemap "squarified" (Bruls, Huizing & van Wijk): cada retângulo tem área
  // proporcional ao valor e a razão de aspecto fica perto de 1. Devolve
  // [{i, x, y, w, h}] no mesmo índice dos valores de entrada (zeros somem).
  function squarify(values, x, y, w, h) {
    const total = values.reduce((s, v) => s + (v > 0 ? v : 0), 0);
    const out = [];
    if (!(total > 0) || !(w > 0) || !(h > 0)) return out;
    const items = values.map((v, i) => ({ i, a: v > 0 ? (v / total) * w * h : 0 })).filter((o) => o.a > 0);
    items.sort((a, b) => b.a - a.a);
    let rx = x, ry = y, rw = w, rh = h;
    const worst = (row, len) => {
      const s = row.reduce((t, o) => t + o.a, 0);
      const mx = Math.max(...row.map((o) => o.a)), mn = Math.min(...row.map((o) => o.a));
      return Math.max((len * len * mx) / (s * s), (s * s) / (len * len * mn));
    };
    const layoutRow = (row) => {
      const s = row.reduce((t, o) => t + o.a, 0);
      if (rw >= rh) {
        const cw = s / rh; let cy = ry;
        row.forEach((o) => { const ch = o.a / cw; out.push({ i: o.i, x: rx, y: cy, w: cw, h: ch }); cy += ch; });
        rx += cw; rw -= cw;
      } else {
        const ch = s / rw; let cx = rx;
        row.forEach((o) => { const cw = o.a / ch; out.push({ i: o.i, x: cx, y: ry, w: cw, h: ch }); cx += cw; });
        ry += ch; rh -= ch;
      }
    };
    let row = [];
    items.forEach((o) => {
      const len = Math.max(1e-9, Math.min(rw, rh));
      if (row.length && worst(row, len) < worst(row.concat(o), len)) { layoutRow(row); row = [o]; }
      else row.push(o);
    });
    if (row.length) layoutRow(row);
    return out;
  }

  // Mosaico: items = [{label, value, color, hint}]. Rótulo só cabe quando o
  // retângulo é grande o bastante; o resto fica no <title> (hover) e na legenda.
  function treemap(items, opts) {
    const o = Object.assign({ w: 640, h: 320, gap: 3 }, opts || {});
    const rects = squarify(items.map((it) => Number(it.value) || 0), 0, 0, o.w, o.h);
    if (!rects.length) return `<p class="admin-empty">Sem dados no período.</p>`;
    const total = items.reduce((s, it) => s + (Number(it.value) || 0), 0);
    const cells = rects.map((r) => {
      const it = items[r.i];
      const g = o.gap / 2;
      const w = Math.max(0, r.w - o.gap), h = Math.max(0, r.h - o.gap);
      const fill = it.color || colorAt(r.i);
      const ink = it.text || "#fff";
      const cabe = w > Math.max(56, String(it.label).length * 7.2 + 12);
      const label = cabe && h > 26 ? `<text x="${(r.x + g + 6).toFixed(1)}" y="${(r.y + g + 16).toFixed(1)}" class="adm-tm-label" fill="${esc(ink)}">${esc(it.label)}</text>` : "";
      const val = cabe && h > 42 ? `<text x="${(r.x + g + 6).toFixed(1)}" y="${(r.y + g + 32).toFixed(1)}" class="adm-tm-val" fill="${esc(ink)}">${esc(fmt(it.value))} · ${esc(pct(it.value, total))}</text>` : "";
      return `<g><rect x="${(r.x + g).toFixed(1)}" y="${(r.y + g).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="6" fill="${esc(fill)}"><title>${esc(it.label)}: ${esc(fmt(it.value))} (${esc(pct(it.value, total))})${it.hint ? " · " + esc(it.hint) : ""}</title></rect>${label}${val}</g>`;
    }).join("");
    return `<div class="adm-treemap"><svg viewBox="0 0 ${o.w} ${o.h}" role="img" aria-label="${esc(o.aria || "Mosaico")}">${cells}</svg></div>`;
  }

  // Rosca: items = [{label, value, color}]. Feita com stroke-dasharray num
  // círculo só — sem trigonometria de arco (e sem o caso degenerado de 100%).
  function donut(items, opts) {
    const o = Object.assign({ size: 140, thick: 22, center: null }, opts || {});
    const vals = items.map((it) => Number(it.value) || 0);
    const total = vals.reduce((s, v) => s + v, 0);
    if (!(total > 0)) return `<p class="admin-empty">Sem dados no período.</p>`;
    const R = (o.size - o.thick) / 2, C = 2 * Math.PI * R, c = o.size / 2;
    let acc = 0;
    const arcs = items.map((it, i) => {
      const v = vals[i]; if (!(v > 0)) return "";
      const len = (v / total) * C;
      const s = `<circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="${esc(it.color || colorAt(i))}" stroke-width="${o.thick}" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 ${c} ${c})"><title>${esc(it.label)}: ${esc(fmt(v))} (${esc(pct(v, total))})</title></circle>`;
      acc += len;
      return s;
    }).join("");
    const centro = o.center != null ? o.center : fmt(total);
    const legend = items.map((it, i) => vals[i] > 0
      ? `<li><span class="adm-swatch" style="background:${esc(it.color || colorAt(i))}"></span><span class="adm-legend-label">${esc(it.label)}</span><span class="adm-legend-val">${esc(fmt(vals[i]))}</span><span class="adm-legend-pct">${esc(pct(vals[i], total))}</span></li>`
      : "").join("");
    return `<div class="adm-donut"><svg viewBox="0 0 ${o.size} ${o.size}" role="img" aria-label="${esc(o.aria || "Proporção")}">${arcs}<text x="${c}" y="${c}" class="adm-donut-center" text-anchor="middle" dominant-baseline="central">${esc(centro)}</text></svg><ul class="adm-legend">${legend}</ul></div>`;
  }

  // Barras por dia, empilhadas: gente (accent) embaixo, robô (cinza) em cima.
  function dailyBars(daily, opts) {
    const o = Object.assign({ w: 720, h: 200, keyA: "views", keyB: "bots", labelA: "Gente", labelB: "Robôs", classA: "adm-bar-a", swatchA: "adm-swatch-a" }, opts || {});
    if (!daily || !daily.length) return `<p class="admin-empty">Sem pageviews registrados ainda.</p>`;
    const P = { l: 40, r: 8, t: 10, b: 22 };
    const iw = o.w - P.l - P.r, ih = o.h - P.t - P.b, n = daily.length;
    const max = Math.max(1, ...daily.map((d) => (Number(d[o.keyA]) || 0) + (Number(d[o.keyB]) || 0)));
    const bw = iw / n;
    const y = (v) => P.t + ih - (v / max) * ih;
    const grid = [0.5, 1].map((f) => {
      const v = Math.round(max * f);
      return `<line x1="${P.l}" x2="${o.w - P.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="adm-grid"/><text x="${P.l - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="adm-axis">${esc(fmt(v))}</text>`;
    }).join("");
    const step = n > 45 ? 14 : n > 14 ? 7 : 1;
    const bars = daily.map((d, i) => {
      const a = Number(d[o.keyA]) || 0, b = Number(d[o.keyB]) || 0;
      const x = P.l + i * bw + 1, w = Math.max(1, bw - 2);
      const ya = y(a), yb = y(a + b);
      const t = `<title>${esc(d.day)}: ${esc(fmt(a))} ${esc(o.labelA.toLowerCase())} · ${esc(fmt(b))} ${esc(o.labelB.toLowerCase())}${d.visitors != null ? ` · ${esc(fmt(d.visitors))} visitantes` : ""}</title>`;
      const lab = (i % step === 0 || i === n - 1) && (n <= 14 || i % step === 0)
        ? `<text x="${(x + w / 2).toFixed(1)}" y="${o.h - 6}" text-anchor="middle" class="adm-axis">${esc(String(d.day).slice(5))}</text>` : "";
      return `<g>${t}<rect x="${x.toFixed(1)}" y="${ya.toFixed(1)}" width="${w.toFixed(1)}" height="${(P.t + ih - ya).toFixed(1)}" rx="2" class="${esc(o.classA)}"/>${b > 0 ? `<rect x="${x.toFixed(1)}" y="${yb.toFixed(1)}" width="${w.toFixed(1)}" height="${(ya - yb).toFixed(1)}" rx="2" class="adm-bar-b"/>` : ""}${lab}</g>`;
    }).join("");
    return `<div class="admin-chart adm-chart-tall"><svg viewBox="0 0 ${o.w} ${o.h}" role="img" aria-label="${esc(o.aria || "Por dia")}">${grid}${bars}</svg></div>
      <ul class="adm-legend adm-legend-row"><li><span class="adm-swatch ${esc(o.swatchA)}"></span>${esc(o.labelA)}</li>${o.keyB && o.keyB !== "__none" ? `<li><span class="adm-swatch adm-swatch-b"></span>${esc(o.labelB)}</li>` : ""}</ul>`;
  }

  // Linhas: series = [{key, label, color}] sobre a mesma série diária.
  function lines(daily, series, opts) {
    const o = Object.assign({ w: 720, h: 160 }, opts || {});
    if (!daily || !daily.length) return `<p class="admin-empty">Sem dados no período.</p>`;
    const P = { l: 40, r: 8, t: 10, b: 22 };
    const iw = o.w - P.l - P.r, ih = o.h - P.t - P.b, n = daily.length;
    const max = Math.max(1, ...daily.map((d) => Math.max(...series.map((s) => Number(d[s.key]) || 0))));
    const x = (i) => P.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v) => P.t + ih - (v / max) * ih;
    const grid = [0.5, 1].map((f) => {
      const v = Math.round(max * f);
      return `<line x1="${P.l}" x2="${o.w - P.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="adm-grid"/><text x="${P.l - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="adm-axis">${esc(fmt(v))}</text>`;
    }).join("");
    const paths = series.map((s, si) => {
      const pts = daily.map((d, i) => `${x(i).toFixed(1)},${y(Number(d[s.key]) || 0).toFixed(1)}`).join(" ");
      const dots = daily.map((d, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(Number(d[s.key]) || 0).toFixed(1)}" r="2.5" fill="${esc(s.color || colorAt(si))}"><title>${esc(d.day)}: ${esc(fmt(d[s.key]))} ${esc(s.label.toLowerCase())}</title></circle>`).join("");
      return `<polyline points="${pts}" fill="none" stroke="${esc(s.color || colorAt(si))}" stroke-width="2" stroke-linejoin="round"/>${dots}`;
    }).join("");
    const step = n > 45 ? 14 : n > 14 ? 7 : 1;
    const labs = daily.map((d, i) => (i % step === 0 || (n <= 14 && i === n - 1)) ? `<text x="${x(i).toFixed(1)}" y="${o.h - 6}" text-anchor="middle" class="adm-axis">${esc(String(d.day).slice(5))}</text>` : "").join("");
    const legend = series.map((s, si) => `<li><span class="adm-swatch" style="background:${esc(s.color || colorAt(si))}"></span>${esc(s.label)}</li>`).join("");
    return `<div class="admin-chart adm-chart-tall"><svg viewBox="0 0 ${o.w} ${o.h}" role="img" aria-label="${esc(o.aria || "Linhas")}">${grid}${paths}${labs}</svg></div><ul class="adm-legend adm-legend-row">${legend}</ul>`;
  }

  // Colunas simples (hora do dia, dia da semana): items = [{label, value}].
  function columns(items, opts) {
    const o = Object.assign({ w: 480, h: 120 }, opts || {});
    if (!items || !items.length) return `<p class="admin-empty">Sem dados no período.</p>`;
    const P = { l: 6, r: 6, t: 8, b: 18 };
    const iw = o.w - P.l - P.r, ih = o.h - P.t - P.b, n = items.length;
    const max = Math.max(1, ...items.map((it) => Number(it.value) || 0));
    const bw = iw / n;
    const cols = items.map((it, i) => {
      const v = Number(it.value) || 0, hh = (v / max) * ih;
      const x = P.l + i * bw + 1, w = Math.max(1, bw - 2);
      const lab = (n <= 8 || i % 3 === 0) ? `<text x="${(x + w / 2).toFixed(1)}" y="${o.h - 5}" text-anchor="middle" class="adm-axis">${esc(it.label)}</text>` : "";
      return `<g><title>${esc(it.title || it.label)}: ${esc(fmt(v))}</title><rect x="${x.toFixed(1)}" y="${(P.t + ih - hh).toFixed(1)}" width="${w.toFixed(1)}" height="${hh.toFixed(1)}" rx="2" class="adm-bar-a"/>${lab}</g>`;
    }).join("");
    return `<div class="admin-chart adm-chart-short"><svg viewBox="0 0 ${o.w} ${o.h}" role="img" aria-label="${esc(o.aria || "Colunas")}">${cols}</svg></div>`;
  }

  // Barras horizontais em HTML (ranking): items = [{label, value, color, href, sub}].
  function hbars(items, opts) {
    const o = Object.assign({ max: null, suffix: "" }, opts || {});
    if (!items || !items.length) return `<p class="admin-empty">Sem dados no período.</p>`;
    const max = o.max || Math.max(1, ...items.map((it) => Number(it.value) || 0));
    return `<ul class="adm-hbars">${items.map((it, i) => {
      const v = Number(it.value) || 0;
      const label = it.href ? `<a href="${esc(it.href)}">${esc(it.label)}</a>` : esc(it.label);
      return `<li><span class="adm-hbar-label">${label}${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</span><span class="adm-hbar-track"><span class="adm-hbar-fill" style="width:${((100 * v) / max).toFixed(1)}%;background:${esc(it.color || "var(--accent)")}"></span></span><span class="adm-hbar-val">${esc(fmt(v))}${esc(o.suffix)}</span></li>`;
    }).join("")}</ul>`;
  }

  // Funil: cada passo mostra o valor e a % em relação ao primeiro.
  function funnel(steps) {
    if (!steps || !steps.length) return "";
    const base = Number(steps[0].value) || 0;
    return `<ol class="adm-funnel">${steps.map((s, i) => {
      const v = Number(s.value) || 0;
      const w = base ? Math.max(4, (100 * v) / base) : 0;
      return `<li><span class="adm-funnel-bar" style="width:${w.toFixed(1)}%;background:${esc(s.color || colorAt(i))}"></span><span class="adm-funnel-txt"><strong>${esc(fmt(v))}</strong> ${esc(s.label)} <em>${esc(pct(v, base))}</em>${s.hint ? `<small>${esc(s.hint)}</small>` : ""}</span></li>`;
    }).join("")}</ol>`;
  }

  window.TCGAdminCharts = { squarify, treemap, donut, dailyBars, lines, columns, hbars, funnel, esc, fmt, pct };

  // ── Página ────────────────────────────────────────────────────────────────
  const shared = window.TCGShared;
  if (!shared) return;
  const root = document.getElementById("adminRoot");
  if (!root) return;

  // viewBox dos gráficos de linha/barra segue a largura real: com 720 fixos, no
  // desktop o SVG sobrava margem dos dois lados (preserva a proporção) e no
  // celular encolhia até o texto do eixo virar 5px.
  const NARROW = () => (root.clientWidth || 800) < 700;
  const CW = () => (NARROW() ? { w: 360, h: 200 } : { w: 960, h: 220 });
  const CWS = () => (NARROW() ? { w: 360, h: 120 } : { w: 480, h: 120 });
  const CWT = () => (NARROW() ? { w: 360, h: 300 } : { w: 640, h: 320 });
  const GAME_COLOR = shared.GAME_COLOR || {};
  const gameColor = (g) => GAME_COLOR[g] || "#9aa3ae";
  const gameInk = (g) => { try { return shared.textOnColor ? shared.textOnColor(gameColor(g)) : "#fff"; } catch (e) { return "#fff"; } };
  const gameName = (g) => {
    if (!g || g === "hub" || g === "?") return g === "hub" ? "Hub" : "—";
    try { return shared.gameLabel ? shared.gameLabel(g) : g; } catch (e) { return g; }
  };
  const PAGE_NAME = {
    home: "Início", hub: "Hub", cards: "Cartas", sets: "Sets", search: "Busca", detail: "Detalhe",
    collection: "Coleção", wishlist: "Desejos", portfolio: "Portfólio", binders: "Fichários", decks: "Decks",
    "my-decks": "Meus decks", explore: "Explorar", pokedex: "Pokédex", artists: "Artistas", trainers: "Treinadores",
    dashboard: "Painel", sales: "Vendas", graded: "Graded", badges: "Conquistas", profile: "Perfil",
    settings: "Config.", account: "Conta", login: "Login", backup: "Backup", listas: "Listas", troca: "Trocas",
    comparar: "Comparar", lancamentos: "Lançamentos", novidades: "Novidades", faq: "FAQ", help: "Ajuda",
    about: "Sobre", privacy: "Privacidade", terms: "Termos", users: "Perfil público", card: "Carta (SEO)",
    set: "Set (SEO)", admin: "Admin"
  };
  const pageName = (p) => PAGE_NAME[p] || p;
  const EVENT_NAME = {
    export_done: "Exportações", import_done: "Importações", deck_created: "Decks criados",
    backup_done: "Backups", share_created: "Links compartilhados"
  };
  const DEVICE = { m: "Toque (celular/tablet)", d: "Ponteiro (desktop)", "?": "Sem info (beacon antigo)" };
  const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const LANG = { pt: "Português", en: "Inglês", es: "Espanhol", ja: "Japonês", fr: "Francês", de: "Alemão", it: "Italiano", "?": "Sem info" };

  const TABS = [
    ["geral", "Visão geral"], ["audiencia", "Audiência"], ["conteudo", "Conteúdo"],
    ["produto", "Produto"], ["qualidade", "Qualidade"]
  ];
  const PERIODS = [7, 30, 90];
  const state = { tab: "geral", days: 30, cache: {}, errors: undefined };
  const hashTab = (location.hash || "").replace(/^#/, "");
  if (TABS.some((t) => t[0] === hashTab)) state.tab = hashTab;

  const stat = (label, val, hint) => `<div class="admin-stat"><span class="admin-stat-val">${esc(val)}</span><span class="admin-stat-label">${esc(label)}</span>${hint ? `<span class="admin-stat-hint">${esc(hint)}</span>` : ""}</div>`;
  const section = (title, body, note) => `<section class="admin-section"><h2>${esc(title)}</h2>${body}${note ? `<p class="admin-note">${esc(note)}</p>` : ""}</section>`;
  const table = (heads, rows) => rows.length
    ? `<div class="adm-scroll"><table class="admin-table"><thead><tr>${heads.map((h) => `<th${h.num ? ' class="num"' : ""}>${esc(h.t)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
    : `<p class="admin-empty">—</p>`;
  const cardLink = (g, id) => `cards?game=${encodeURIComponent(g)}&card=${encodeURIComponent(id)}`;
  const gameChip = (g) => `<span class="adm-game" style="--g:${esc(gameColor(g))}">${esc(gameName(g))}</span>`;
  const cardRow = (c, cols) => `<tr><td>${gameChip(c.game)}</td><td><a class="adm-mono" href="${esc(cardLink(c.game, c.card_id))}">${esc(c.card_id)}</a></td>${cols.map((k) => `<td class="num">${esc(fmt(c[k]))}</td>`).join("")}</tr>`;

  // ── Abas ──────────────────────────────────────────────────────────────────
  function tabGeral(d) {
    const o = d.overview || {}, daily = d.daily || [];
    const totalViews = (o.pageviews || 0) + (o.pageviews_bot || 0);
    const gamesViews = (d.games && d.games.views) || [];
    return `
      <div class="admin-stats">
        ${stat("Visitantes hoje", fmt(o.dau), "gente, anônimo")}
        ${stat("Visitantes 7 dias", fmt(o.wau))}
        ${stat("Visitantes 30 dias", fmt(o.mau))}
        ${stat("Logados hoje", fmt(o.dau_users), "contas ativas")}
        ${stat("Logados 7 dias", fmt(o.wau_users))}
        ${stat("Logados 30 dias", fmt(o.mau_users))}
      </div>
      <div class="admin-stats">
        ${stat(`Pageviews (${d.days}d)`, fmt(o.pageviews), "só gente")}
        ${stat("Orgânico", pct(o.pageviews, totalViews), `${fmt(o.pageviews_bot)} de robô`)}
        ${stat("Contas", fmt(o.total_users), `${fmt(o.new_users)} novas no período`)}
        ${stat("Com coleção na nuvem", fmt(o.collections_users))}
        ${stat("Login nos últimos 30d", fmt(o.signed_in_30d), "pelo Supabase")}
        ${stat("Perfis públicos", fmt(o.public_profiles))}
      </div>
      ${section(`Pageviews por dia (${d.days} dias)`, dailyBars(daily, Object.assign(CW(), { aria: "Pageviews por dia, gente e robôs" })))}
      ${section("Visitantes × logados por dia", lines(daily, [
        { key: "visitors", label: "Visitantes", color: "var(--accent)" },
        { key: "users", label: "Logados", color: "#2563eb" },
        { key: "signups", label: "Contas novas", color: "#16a34a" }
      ], Object.assign(CW(), { aria: "Visitantes, logados e contas novas por dia" })))}
      <div class="adm-grid-2">
        ${section("Pageviews por jogo", treemap(gamesViews.map((g) => ({ label: gameName(g.game), value: g.views, color: gameColor(g.game), text: gameInk(g.game), hint: `${fmt(g.visitors)} visitantes` })), Object.assign(CWT(), { aria: "Mosaico de pageviews por jogo" })))}
        ${section("Páginas mais acessadas", hbars(((d.paths && d.paths.top) || []).slice(0, 12).map((p) => ({ label: pageName(p.path), value: p.views, sub: `${fmt(p.visitors)} visitantes` }))))}
      </div>`;
  }

  function tabAudiencia(d) {
    const a = d.audience || {}, r = d.retention || {};
    const hours = Array.from({ length: 24 }, (_, h) => ({ label: `${h}h`, title: `${h}h–${h + 1}h`, value: ((a.hours || []).find((x) => x.h === h) || {}).views || 0 }));
    const dows = DOW.map((n, i) => ({ label: n, value: ((a.weekdays || []).find((x) => x.dow === i) || {}).views || 0 }));
    return `
      <div class="admin-stats">
        ${stat("Visitantes no período", fmt(r.visitors))}
        ${stat("Novos", fmt(r.new_visitors), "primeira visita no período")}
        ${stat("Voltaram em outro dia", pct(r.returning, r.visitors), `${fmt(r.returning)} visitantes`)}
        ${stat("Retenção 7 dias", pct(r.cohort_back7, r.cohort), `${fmt(r.cohort_back7)} de ${fmt(r.cohort)} voltaram 7+ dias depois`)}
      </div>
      ${section("Funil: visitante → conta", funnel([
        { label: "visitantes (gente)", value: r.visitors, color: "var(--accent)" },
        { label: "engajados", value: r.engaged, color: "#d97706", hint: "2+ pageviews ou uma ação de produto" },
        { label: "logados", value: r.logged, color: "#2563eb", hint: "visitaram com sessão ativa" },
        { label: "contas novas", value: r.signups, color: "#16a34a", hint: "cadastros no período (Supabase)" }
      ]), "Retenção compara a primeira visita de cada uuid anônimo com as seguintes. Quem limpa o navegador vira visitante novo.")}
      <div class="adm-grid-3">
        ${section("Dispositivo", donut((a.devices || []).map((x, i) => ({ label: DEVICE[x.k] || x.k, value: x.views, color: colorAt(i) })), { aria: "Pageviews por tipo de dispositivo" }))}
        ${section("Idioma do navegador", donut((a.langs || []).map((x, i) => ({ label: LANG[x.k] || x.k, value: x.views, color: colorAt(i) })), { aria: "Pageviews por idioma" }))}
        ${section("De onde vêm", hbars((a.referrers || []).map((x) => ({ label: x.k, value: x.views, sub: `${fmt(x.visitors)} visitantes` }))), "Só o domínio de origem quando vem de fora. Acesso direto, app instalado e buscas sem referrer não aparecem.")}
      </div>
      <div class="adm-grid-2">
        ${section("Hora do dia (Brasília)", columns(hours, Object.assign(CWS(), { aria: "Pageviews por hora do dia" })))}
        ${section("Dia da semana", columns(dows, Object.assign(CWS(), { aria: "Pageviews por dia da semana" })))}
      </div>`;
  }

  function tabConteudo(d) {
    const g = d.games || {}, c = d.cards || {};
    const col = g.collection || [], wl = g.wishlist || [];
    const wantsOf = (game) => (wl.find((x) => x.game === game) || {}).wants;
    const byGame = {};
    (c.by_game || []).forEach((x) => { (byGame[x.game] = byGame[x.game] || []).push(x); });
    const gamesOrder = col.map((x) => x.game).filter((x) => byGame[x]);
    return `
      <div class="adm-grid-2">
        ${section("Cópias cadastradas por jogo", treemap(col.map((x) => ({ label: gameName(x.game), value: x.copies, color: gameColor(x.game), text: gameInk(x.game), hint: `${fmt(x.users)} usuários · ${fmt(x.cards)} cartas distintas` })), Object.assign(CWT(), { aria: "Mosaico de cópias por jogo" })), "Lê o save sincronizado de cada conta (só quem tem conta entra).")}
        ${section("Usuários por jogo", donut(col.map((x) => ({ label: gameName(x.game), value: x.users, color: gameColor(x.game) })), { aria: "Usuários com coleção por jogo" }))}
      </div>
      ${section("Coleção por jogo", table(
        [{ t: "Jogo" }, { t: "Usuários", num: true }, { t: "Cartas distintas", num: true }, { t: "Cópias", num: true }, { t: "Na wishlist", num: true }],
        col.map((x) => `<tr><td>${gameChip(x.game)}</td><td class="num">${esc(fmt(x.users))}</td><td class="num">${esc(fmt(x.cards))}</td><td class="num">${esc(fmt(x.copies))}</td><td class="num">${esc(fmt(wantsOf(x.game)))}</td></tr>`)
      ))}
      ${section("Cartas mais cadastradas (todas as contas)", table(
        [{ t: "Jogo" }, { t: "Carta" }, { t: "Usuários", num: true }, { t: "Cópias", num: true }],
        (c.top || []).map((x) => cardRow(x, ["users", "copies"]))
      ), "Ordenado por quantas contas têm a carta; o id abre a carta no catálogo.")}
      ${section("Top por jogo", gamesOrder.length ? `<div class="adm-grid-3">${gamesOrder.map((game) => `<div class="adm-sub"><h3>${gameChip(game)}</h3>${hbars(byGame[game].map((x) => ({ label: x.card_id, value: x.users, href: cardLink(game, x.card_id), color: gameColor(game), sub: `${fmt(x.copies)} cópias` })))}</div>`).join("")}</div>` : `<p class="admin-empty">—</p>`)}
      <div class="adm-grid-2">
        ${section("Mais desejadas (wishlist)", table(
          [{ t: "Jogo" }, { t: "Carta" }, { t: "Usuários", num: true }],
          (c.wanted || []).map((x) => cardRow(x, ["users"]))
        ))}
        ${section("Mais visitadas (contador público)", table(
          [{ t: "Jogo" }, { t: "Carta" }, { t: "Visitas", num: true }],
          (c.viewed || []).map((x) => cardRow(x, ["views"]))
        ), "Contador de card_views: inclui visitantes sem conta e sem consentimento de medição.")}
      </div>`;
  }

  function tabProduto(d) {
    const o = d.overview || {}, p = d.product || [], dk = d.decks || {}, g = d.games || {};
    const ev = (n) => p.find((x) => x.name === n) || {};
    return `
      <div class="admin-stats">
        ${Object.keys(EVENT_NAME).map((n) => stat(EVENT_NAME[n], fmt(ev(n).n || 0), ev(n).n ? `${fmt(ev(n).visitors)} visitantes · ${fmt(ev(n).users)} logados` : `nenhuma nos ${d.days}d`)).join("")}
      </div>
      <div class="admin-stats">
        ${stat("Decks publicados", fmt(o.decks), "na galeria")}
        ${stat("Visitas em decks", fmt(o.deck_views), "acumulado")}
        ${stat("Links compartilhados", fmt(o.shares), "coleções, fichários e decks")}
        ${stat("Preços da comunidade", fmt(o.price_points), "pontos contribuídos")}
        ${stat("Assinaturas de push", fmt(o.push_subs))}
      </div>
      ${section(`Ações concluídas (${d.days} dias)`, hbars(p.map((x) => ({ label: EVENT_NAME[x.name] || x.name, value: x.n, sub: `${fmt(x.visitors)} visitantes` }))), "Cada evento é uma ação que a pessoa terminou (importou, exportou, criou deck…), não um clique de caminho.")}
      <div class="adm-grid-2">
        ${section("Decks mais vistos", table(
          [{ t: "Deck" }, { t: "Jogo" }, { t: "Visitas", num: true }],
          (dk.top || []).map((x) => `<tr><td><a href="decks?s=${esc(encodeURIComponent(x.id))}">${esc(x.title || "(sem título)")}</a><br><small>${esc(x.created_at ? new Date(x.created_at).toLocaleDateString("pt-BR") : "")}</small></td><td>${gameChip(x.game)}</td><td class="num">${esc(fmt(x.views))}</td></tr>`)
        ))}
        <div class="adm-col">
          ${section("Decks publicados por jogo", donut((g.decks || []).map((x) => ({ label: gameName(x.game), value: x.decks, color: gameColor(x.game) })), { aria: "Decks por jogo" }))}
          ${section("Links por tipo", donut((dk.by_kind || []).map((x, i) => ({ label: { collection: "Coleção", binder: "Fichário", deck: "Deck" }[x.kind] || x.kind, value: x.n, color: colorAt(i + 1) })), { aria: "Compartilhamentos por tipo" }))}
        </div>
      </div>`;
  }

  function tabQualidade(d) {
    const o = d.overview || {}, daily = d.daily || [];
    const errs = state.errors;
    const errRows = Array.isArray(errs) ? errs.map((x) => `<tr><td>${esc(x.message)}<br><small>${esc(x.source || "")}</small></td><td class="num">${esc(fmt(x.hits))}</td><td class="num">${esc(fmt(x.users))}</td><td>${esc(x.last_seen ? new Date(x.last_seen).toLocaleString("pt-BR") : "—")}</td></tr>`) : [];
    return `
      <div class="admin-stats">
        ${stat("Pageviews de gente", fmt(o.pageviews))}
        ${stat("Pageviews de robô", fmt(o.pageviews_bot), "executaram JS e mesmo assim se denunciaram")}
        ${stat("Orgânico", pct(o.pageviews, (o.pageviews || 0) + (o.pageviews_bot || 0)))}
        ${stat("Erros de JS", fmt(o.errors), `no período`)}
      </div>
      <div class="adm-grid-2">
        ${section("Gente × robôs", donut([
          { label: "Gente", value: o.pageviews, color: "var(--accent)" },
          { label: "Robôs", value: o.pageviews_bot, color: "#9aa3ae" }
        ], { aria: "Proporção de pageviews de gente e de robôs" }), "Robô = user-agent de crawler/monitor, navegador sem user-agent ou navigator.webdriver ligado. Crawler que não executa JS nunca chega aqui — o Cloudflare (Security › Bots) é que vê esse.")}
        ${section("Páginas mais batidas por robô", hbars(((d.paths && d.paths.bots) || []).map((p) => ({ label: pageName(p.path), value: p.views, color: "#9aa3ae" }))))}
      </div>
      ${section("Robôs por dia", dailyBars(daily, Object.assign(CW(), { keyA: "bots", keyB: "__none", labelA: "Robôs", classA: "adm-bar-b", swatchA: "adm-swatch-b", aria: "Pageviews de robôs por dia" })))}
      ${section("Erros de JS (7 dias)", errs === undefined
        ? `<p class="admin-empty">Carregando…</p>`
        : errRows.length ? table([{ t: "Erro" }, { t: "Vezes", num: true }, { t: "Usuários", num: true }, { t: "Último" }], errRows) : `<p class="admin-empty">Nenhum erro registrado.</p>`)}`;
  }

  const RENDER = { geral: tabGeral, audiencia: tabAudiencia, conteudo: tabConteudo, produto: tabProduto, qualidade: tabQualidade };

  // ── Painel legado (enquanto a migração 20260914a não for aplicada) ───────
  function renderLegado(d) {
    const games = (d.by_game || []).map((g) => `<tr><td>${gameChip(g.game)}</td><td class="num">${esc(fmt(g.users))}</td><td class="num">${esc(fmt(g.cards))}</td></tr>`);
    const paths = (d.top_paths || []).map((p) => ({ label: pageName(p.path), value: p.views }));
    return `
      <p class="adm-banner">A RPC <code>admin_dashboard</code> ainda não existe no banco: aplique a migração <code>supabase/migrations/20260914a_admin_dashboard.sql</code> no SQL Editor pra liberar as abas novas. Abaixo, o painel antigo.</p>
      <div class="admin-stats">
        ${stat("DAU (hoje)", fmt(d.dau))}${stat("WAU (7 dias)", fmt(d.wau))}${stat("MAU (30 dias)", fmt(d.mau))}
        ${stat("Pageviews (30d)", fmt(d.pageviews))}${stat("Usuários (sync)", fmt(d.total_users))}
        ${stat("Perfis públicos", fmt(d.public_profiles))}${stat("Compartilhamentos", fmt(d.shares))}
      </div>
      ${section("Pageviews por dia (30 dias)", dailyBars(d.daily || [], Object.assign(CW(), { keyB: "__none", labelA: "Pageviews" })))}
      ${section("Páginas mais acessadas (30d)", hbars(paths))}
      ${section("Cartas por jogo", table([{ t: "Jogo" }, { t: "Usuários", num: true }, { t: "Cartas distintas", num: true }], games))}`;
  }

  // ── Orquestração ──────────────────────────────────────────────────────────
  function toolbar() {
    return `<div class="adm-toolbar">
      <div class="adm-tabs" role="tablist" aria-label="Painéis">${TABS.map(([id, label]) => `<button type="button" class="chip" role="tab" data-tab="${id}" aria-selected="${state.tab === id}">${esc(label)}</button>`).join("")}</div>
      <div class="adm-period" role="group" aria-label="Período">${PERIODS.map((p) => `<button type="button" class="chip" data-days="${p}" aria-pressed="${state.days === p}">${p} dias</button>`).join("")}</div>
    </div>`;
  }
  async function load(days) {
    if (state.cache[days]) return state.cache[days];
    const d = await shared.adminDashboard(days);
    if (d) state.cache[days] = d;
    return d;
  }
  async function render() {
    const body = document.getElementById("admBody");
    if (body) body.innerHTML = `<p class="empty-state">Carregando…</p>`;
    const d = await load(state.days);
    if (d === undefined) {
      // RPC nova ausente: cai pro resumo antigo (se a conta for admin).
      const old = await shared.analyticsSummary(30);
      root.innerHTML = old ? renderLegado(old) : `<p class="empty-state">Acesso restrito — entre com a conta de admin.</p>`;
      return;
    }
    if (!d) {
      root.innerHTML = `<p class="empty-state">Acesso restrito — entre com a conta de admin.</p>`;
      return;
    }
    if (!document.getElementById("admBody")) {
      root.innerHTML = `${toolbar()}<div id="admBody"></div><p class="admin-note" id="admNote"></p>`;
      root.querySelector(".adm-tabs").addEventListener("click", (e) => {
        const b = e.target.closest("[data-tab]"); if (!b) return;
        state.tab = b.dataset.tab;
        try { history.replaceState(null, "", `#${state.tab}`); } catch (err) { /* ignora */ }
        syncToolbar(); render();
      });
      root.querySelector(".adm-period").addEventListener("click", (e) => {
        const b = e.target.closest("[data-days]"); if (!b) return;
        state.days = Number(b.dataset.days) || 30;
        syncToolbar(); render();
      });
    }
    if (state.tab === "qualidade" && state.errors === undefined) {
      shared.errorSummary(7).then((errs) => { state.errors = errs; if (state.tab === "qualidade") render(); });
    }
    document.getElementById("admBody").innerHTML = (RENDER[state.tab] || tabGeral)(d);
    document.getElementById("admNote").textContent = `Atualizado em ${new Date(d.generated_at).toLocaleString("pt-BR")} · janela de ${d.days} dias desde ${new Date(d.since).toLocaleDateString("pt-BR")}. "Gente" = pageview com JS executado, user-agent de navegador e sem webdriver; visitantes contam uuid anônimo first-party (só com consentimento de medição), logados contam a conta pelo JWT. O Cloudflare Web Analytics (painel do Cloudflare) mede o resto: país, navegador, Core Web Vitals e o tráfego que nem chega a rodar JS.`;
  }
  function syncToolbar() {
    root.querySelectorAll("[data-tab]").forEach((b) => { const on = b.dataset.tab === state.tab; b.setAttribute("aria-selected", on); });
    root.querySelectorAll("[data-days]").forEach((b) => b.setAttribute("aria-pressed", Number(b.dataset.days) === state.days));
  }
  render();
})();
