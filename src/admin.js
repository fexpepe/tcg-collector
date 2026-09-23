// Painel de admin (admin.html): números agregados/anônimos do site, com
// período de 7/30/90 dias. Só o dono lê: todas as RPCs admin_* só respondem se
// is_admin; senão devolvem null.
//
// v2 (2026-09-23, migração 20260923a): cinco GRUPOS com sub-abas — Visão geral
// (Resumo, Crescimento, Para parceiros), Aquisição (Audiência, Canais),
// Engajamento (Retenção, Funil, Produto), Mercado (Lojas, Demanda, Conteúdo) e
// Técnico (Qualidade) — e tabelas longas paginadas. Cada aba busca só as RPCs
// de que precisa (NEEDS), uma vez por período.
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

  // ── Helpers puros do v2 (testados em tests/admin-charts.test.mjs) ─────────
  // Página de uma lista: nunca devolve página fora do intervalo, mesmo quando
  // a lista encolheu (troca de período) e a página guardada ficou grande.
  function pageSlice(rows, page, per) {
    const n = (rows || []).length, p = Math.max(1, per || 10);
    const pages = Math.max(1, Math.ceil(n / p));
    const pg = Math.min(Math.max(1, Math.floor(page) || 1), pages);
    const from = n ? (pg - 1) * p : 0, to = Math.min(n, pg * p);
    return { rows: (rows || []).slice(from, to), page: pg, pages, from: n ? from + 1 : 0, to, total: n };
  }

  // CSV com separador ";" e BOM: é o que o Excel em pt-BR abre certo com um
  // duplo clique (com "," e sem BOM, vira uma coluna só e acento quebra).
  function toCsv(rows, cols) {
    const cel = (v) => {
      const t = v == null ? "" : String(v);
      return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const head = cols.map((c) => cel(c.t)).join(";");
    const body = (rows || []).map((r) => cols.map((c) => cel(typeof c.k === "function" ? c.k(r) : r[c.k])).join(";"));
    return "\ufeff" + [head].concat(body).join("\r\n");
  }

  // Série diária (metrics_daily) → um ponto por MÊS. Estoques (MAU, contas,
  // colecionadores, cópias) valem o ÚLTIMO dia do mês com dado; fluxos
  // (ativações, cliques, contas novas) somam. Crescimento é mês contra mês
  // anterior, no estoque — é a conta que investidor faz.
  function monthly(serie) {
    const ESTOQUE = ["mau", "mau_users", "contas", "colecionadores", "copias"];
    const FLUXO = ["novos", "contas_novas", "ativacoes", "cliques_loja", "cartas_add", "scans", "shares_criados"];
    const meses = new Map();
    (serie || []).forEach((d) => {
      const m = String(d.day || "").slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(m)) return;
      const o = meses.get(m) || { mes: m, dias: 0 };
      o.dias += 1;
      ESTOQUE.forEach((k) => { if (d[k] != null) o[k] = Number(d[k]) || 0; });
      FLUXO.forEach((k) => { o[k] = (o[k] || 0) + (Number(d[k]) || 0); });
      meses.set(m, o);
    });
    const out = Array.from(meses.values()).sort((a, b) => (a.mes < b.mes ? -1 : 1));
    out.forEach((o, i) => {
      const ant = out[i - 1];
      o.cresc_mau = ant && ant.mau ? (o.mau - ant.mau) / ant.mau : null;
    });
    return out;
  }

  window.TCGAdminCharts = { squarify, treemap, donut, dailyBars, lines, columns, hbars, funnel, esc, fmt, pct, pageSlice, toCsv, monthly };

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

  const STORE = {
    liga: "Liga", ligabra: "LigaBRA", myp: "MYP", ebay: "eBay", ebaysold: "eBay (vendidos)",
    tcgplayer: "TCGplayer", pricecharting: "PriceCharting", "?": "—"
  };
  const STORES_BR = ["liga", "ligabra", "myp"];
  const CANAL = {
    direto: "Direto / app", busca: "Busca (Google…)", social: "Redes sociais",
    ia: "IA (ChatGPT…)", site: "Outros sites", campanha: "Campanha (utm)"
  };
  const SHARE_KIND = { collection: "Coleção", binder: "Fichário", deck: "Deck", "?": "—" };

  // Navegação em DOIS níveis (2026-09-23). Com o v2 o painel passou de 5 pra
  // 12 telas, e uma fileira de 12 chips quebrava em três linhas no celular sem
  // ordem nenhuma. Os GRUPOS são as perguntas (quanta gente? de onde vem?
  // fica? o que procura? está tudo bem?); as ABAS são os recortes de cada uma.
  const GROUPS = [
    ["visao", "Visão geral", [["geral", "Resumo"], ["crescimento", "Crescimento"], ["parceiros", "Para parceiros"]]],
    ["aquisicao", "Aquisição", [["audiencia", "Audiência"], ["canais", "Canais"]]],
    ["engajamento", "Engajamento", [["retencao", "Retenção"], ["funil", "Funil"], ["produto", "Produto"]]],
    ["mercado", "Mercado", [["lojas", "Lojas"], ["demanda", "Demanda"], ["conteudo", "Conteúdo"]]],
    ["tecnico", "Técnico", [["qualidade", "Qualidade"]]]
  ];
  const TAB_GROUP = {};
  GROUPS.forEach(([g, , tabs]) => tabs.forEach(([t]) => { TAB_GROUP[t] = g; }));
  // Quais RPCs cada aba precisa. `dash` = admin_dashboard (20260914a),
  // `funnel` = admin_funnel (20260919a, recriada na 20260923a); o resto é da
  // 20260923a. Cada uma é buscada só quando uma aba que a usa abre.
  const NEEDS = {
    geral: ["dash"], audiencia: ["dash"], conteudo: ["dash"], produto: ["dash"], qualidade: ["dash"],
    crescimento: ["growth"], parceiros: ["dash", "retention", "stores", "demand", "growth"],
    canais: ["retention", "growth"], retencao: ["retention"], funil: ["funnel", "retention"],
    lojas: ["stores"], demanda: ["demand"]
  };
  const RPC = { retention: "admin_retention", stores: "admin_stores", growth: "admin_growth", demand: "admin_demand" };
  const PERIODS = [7, 30, 90];
  const state = { tab: "geral", days: 30, cache: {}, inflight: {}, errors: undefined, pages: {}, names: {} };
  // Hash antigo (#produto, #qualidade…) continua valendo: link salvo não quebra.
  const hashTab = (location.hash || "").replace(/^#/, "");
  if (TAB_GROUP[hashTab]) state.tab = hashTab;

  const ICON = {
    prev: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>`,
    next: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>`,
    down: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/></svg>`,
    print: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6"/><rect x="6" y="14" width="12" height="7" rx="1"/><path d="M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2"/></svg>`
  };

  const stat = (label, val, hint) => `<div class="admin-stat"><span class="admin-stat-val">${esc(val)}</span><span class="admin-stat-label">${esc(label)}</span>${hint ? `<span class="admin-stat-hint">${esc(hint)}</span>` : ""}</div>`;
  const section = (title, body, note) => `<section class="admin-section"><h2>${esc(title)}</h2>${body}${note ? `<p class="admin-note">${esc(note)}</p>` : ""}</section>`;
  const table = (heads, rows) => rows.length
    ? `<div class="adm-scroll"><table class="admin-table"><thead><tr>${heads.map((h) => `<th${h.num ? ' class="num"' : ""}>${esc(h.t)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
    : `<p class="admin-empty">—</p>`;
  // Tabela PAGINADA. Ranking comprido (60 cartas, 15 origens, todas as buscas)
  // numa tabela só empurrava o resto da aba pra longe — no celular, 60 linhas
  // são 20 telas de rolagem. As linhas ficam num registro por id e só o bloco
  // da tabela é redesenhado ao trocar de página; a página de cada tabela fica
  // guardada enquanto o painel está aberto.
  const PAGED = {};
  function paged(id, heads, rows, per) {
    PAGED[id] = { heads, rows, per: per || 10 };
    return `<div class="adm-paged" data-paged="${esc(id)}">${pagedInner(id)}</div>`;
  }
  function pagedInner(id) {
    const tb = PAGED[id];
    if (!tb) return "";
    const pg = pageSlice(tb.rows, state.pages[id] || 1, tb.per);
    state.pages[id] = pg.page;
    if (!pg.total) return `<p class="admin-empty">Sem dados no período.</p>`;
    const nav = pg.pages > 1
      ? `<nav class="adm-pager" aria-label="Paginação">
          <button type="button" class="chip" data-page="${esc(id)}" data-dir="-1" aria-label="Página anterior"${pg.page <= 1 ? " disabled" : ""}>${ICON.prev}</button>
          <span class="adm-pager-info">${esc(fmt(pg.from))}–${esc(fmt(pg.to))} de ${esc(fmt(pg.total))}</span>
          <button type="button" class="chip" data-page="${esc(id)}" data-dir="1" aria-label="Próxima página"${pg.page >= pg.pages ? " disabled" : ""}>${ICON.next}</button>
        </nav>`
      : "";
    return table(tb.heads, pg.rows) + nav;
  }
  const sinal = (x) => (x == null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(100 * x).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
  const lastDef = (serie, k) => { for (let i = (serie || []).length - 1; i >= 0; i--) if (serie[i][k] != null) return serie[i][k]; return null; };
  // Nome da carta quando o catálogo já resolveu (resolveNames), senão o id.
  const nameOf = (g, id) => state.names[`${g}:${id}`];
  const cardCell = (g, id) => {
    const n = nameOf(g, id);
    return `<a href="${esc(cardLink(g, id))}">${n ? esc(n) : `<span class="adm-mono">${esc(id)}</span>`}</a>${n ? `<br><small class="adm-mono">${esc(id)}</small>` : ""}`;
  };
  const cardLink = (g, id) => `cards?game=${encodeURIComponent(g)}&card=${encodeURIComponent(id)}`;
  const gameChip = (g) => `<span class="adm-game" style="--g:${esc(gameColor(g))}">${esc(gameName(g))}</span>`;
  const cardRow = (c, cols) => `<tr><td>${gameChip(c.game)}</td><td>${cardCell(c.game, c.card_id)}</td>${cols.map((k) => `<td class="num">${esc(fmt(c[k]))}</td>`).join("")}</tr>`;

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

  // ── Funil de ativação (RPC admin_funnel, migração 20260919a) ──────────────
  // As "Ações concluídas" abaixo dizem quantos TERMINARAM algo. Não dizem onde
  // a pessoa desiste — e é a queda entre dois passos que aponta o que consertar.
  // Cada passo é subconjunto do anterior, então a porcentagem é sempre contra o
  // passo de cima, nunca contra o total.
  function funilPassos(f) {
    const sc = (f && f.scan) || {};
    // O funil conta TENTATIVAS DE LEITURA, e começa nelas — não nas aberturas
    // do scanner. Aberturas e tentativas não são conjuntos aninhados (uma
    // sessão tem N leituras), então pôr as duas na mesma escada dava "428% do
    // passo anterior" e uma barra transbordando: número que só pode confundir.
    // As aberturas viram contexto nos cartões de cima, onde são comparáveis
    // com pessoas e sessões.
    const passos = [
      ["Tentou ler uma carta", sc.tentativas || 0, "disparos da câmera"],
      ["Leu o código", sc.leu || 0, "o OCR extraiu um código da carta"],
      ["Achou no catálogo", sc.achou || 0, "o código casou com uma carta"],
      ["Adicionou à coleção", sc.adicionou || 0, "virou carta na coleção"]
    ];
    const topo = passos[0][1] || 0;
    const linhas = passos.map(([label, n, hint], i) => {
      const ant = i ? passos[i - 1][1] : n;
      const pct = ant > 0 ? Math.min(100, Math.round((n / ant) * 100)) : 0;
      const larg = topo > 0 ? Math.min(100, Math.max(2, Math.round((n / topo) * 100))) : 0;
      return `<div class="adm-funil-passo">
        <div class="adm-funil-head"><span>${esc(label)}</span><strong>${esc(fmt(n))}</strong></div>
        <div class="adm-funil-barra"><span style="width:${larg}%"></span></div>
        <div class="adm-funil-hint">${i ? `${pct}% do passo anterior · ` : ""}${esc(hint)}</div>
      </div>`;
    }).join("");
    const secas = sc.secas || 0;
    const nota = sc.sessoes
      ? `${fmt(sc.aberturas || 0)} aberturas do scanner por ${fmt(sc.pessoas || 0)} pessoas geraram estas ${fmt(sc.tentativas || 0)} leituras. ${fmt(secas)} de ${fmt(sc.sessoes)} sessões fecharam sem adicionar nenhuma carta (${Math.round((secas / sc.sessoes) * 100)}%).`
      : "Nenhuma sessão de scanner no período.";
    return `<div class="adm-funil">${linhas}</div><p class="admin-note">${esc(nota)}</p>`;
  }

  function tabFunil(f, ret) {
    const cad = f.cadastro || [];
    const VIA = { ui: "Busca e tiles", scan: "Scanner", csv: "Importação CSV", lista: "Listas" };
    const totalCartas = cad.reduce((n, x) => n + (x.cartas || 0), 0);
    const melhorRitmo = cad.reduce((m, x) => (x.cartas_min > (m ? m.cartas_min : 0) ? x : m), null);
    const j = (ret && ret.jornada) || {};
    const t1 = f.scan_t1_ms ? `${Math.round(f.scan_t1_ms / 1000)}s` : "—";
    const jogos = f.scan_jogos || [];
    const pctInt = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "—");
    return `
      <div class="admin-stats">
        ${stat("Ativados", fmt(f.ativados || 0), "cadastraram a 1ª carta da vida")}
        ${stat("Abriram o scanner", fmt((f.scan || {}).pessoas || 0), `${fmt((f.scan || {}).aberturas || 0)} aberturas`)}
        ${stat("Até a 1ª carta", t1, "mediana: câmera aberta → carta na coleção")}
        ${stat("Cartas cadastradas", fmt(totalCartas), "cartas novas, não cópias a mais")}
        ${stat("Ritmo do scanner", (() => { const r = cad.find((x) => x.via === "scan"); return r && r.cartas_min ? `${r.cartas_min}/min` : "—"; })(), "mediana de cartas por minuto")}
        ${stat("Contas novas", fmt((f.signups || []).reduce((n, x) => n + x.n, 0)), (f.signups || []).map((x) => `${x.m}: ${fmt(x.n)}`).join(" · ") || "nenhuma no período")}
      </div>
      ${section(`Jornada de quem chegou nos últimos ${f.days} dias`, funnel([
        { label: "visitantes novos", value: j.visitantes, color: "var(--accent)" },
        { label: "engajaram", value: j.engajados, color: "#d97706", hint: "2+ páginas vistas" },
        { label: "ativaram", value: j.ativados, color: "#16a34a", hint: "puseram a 1ª carta na coleção" },
        { label: "10+ cartas", value: j.dez, color: "#0891b2", hint: "somando todas as rajadas de cadastro" },
        { label: "entraram com conta", value: j.contas, color: "#2563eb", hint: "criaram conta ou visitaram logados" },
        { label: "voltaram 7+ dias depois", value: j.voltaram, color: "#7c3aed", hint: `só ${fmt(j.el7)} deles chegaram há 7+ dias — é o teto deste passo` },
        { label: "criaram deck ou link", value: j.criaram, color: "#db2777", hint: "conteúdo que outras pessoas veem" }
      ]), "A porcentagem é sempre contra os visitantes novos do topo, e os passos não são uma escada: dá pra criar conta sem ter ativado. A unidade é o navegador (uuid anônimo), então quem usa celular e computador conta duas vezes.")}
      ${section(`Funil do scanner (${f.days} dias)`, funilPassos(f),
        "Cada passo é subconjunto do anterior. A maior queda entre dois passos é onde o produto está perdendo a pessoa.")}
      ${section("Scanner por jogo", table(
        [{ t: "Jogo" }, { t: "Sessões", num: true }, { t: "Leu o código", num: true }, { t: "Achou a carta", num: true }, { t: "Sessões secas", num: true }],
        jogos.map((x) => `<tr><td>${gameChip(x.game)}</td><td class="num">${esc(fmt(x.sessoes))}</td><td class="num">${esc(pctInt(x.leu, x.tentativas))}</td><td class="num">${esc(pctInt(x.achou, x.leu))}</td><td class="num">${esc(pctInt(x.secas, x.sessoes))}</td></tr>`)),
        "\"Leu\" = leituras que extraíram código ÷ tentativas; \"achou\" = códigos que casaram com o catálogo ÷ lidos. Jogo com leitura boa e achou ruim é buraco no catálogo, não no OCR.")}
      ${section("Ritmo de cadastro por caminho", table(
        [{ t: "Caminho" }, { t: "Cartas", num: true }, { t: "Rajadas", num: true }, { t: "Pessoas", num: true }, { t: "Cartas/min", num: true }],
        cad.map((x) => `<tr><td>${esc(VIA[x.via] || x.via)}</td><td class="num">${esc(fmt(x.cartas))}</td><td class="num">${esc(fmt(x.rajadas))}</td><td class="num">${esc(fmt(x.pessoas))}</td><td class="num">${esc(x.cartas_min == null ? "—" : String(x.cartas_min))}</td></tr>`)),
        `Uma "rajada" é uma sequência de cadastros sem 20s de pausa. Cartas/min é a mediana entre rajadas de 5+ cartas.${melhorRitmo && melhorRitmo.cartas_min ? ` Hoje o caminho mais rápido é "${VIA[melhorRitmo.via] || melhorRitmo.via}", com ${melhorRitmo.cartas_min} cartas/min.` : ""}`)}
      <div class="adm-grid-2">
        ${section("Onde o login barrou", hbars((f.gate_paginas || []).map((x) => ({ label: pageName(x.pagina), value: x.n }))),
          `${fmt(f.gate_pessoas || 0)} pessoas bateram no portão; ${fmt(f.gate_conv || 0)} (${pctInt(f.gate_conv || 0, f.gate_pessoas || 0)}) entraram depois — criaram conta ou voltaram logadas.`)}
        ${section("App instalado", `<div class="admin-stats">${stat("Instalações", fmt(f.instalacoes || 0), `nos ${f.days} dias`)}</div>`,
          "Evento appinstalled do navegador (Android/desktop). No iPhone a instalação é pelo menu Compartilhar e o navegador não avisa — lá o sinal é a visita já aberta como app (aba Retenção).")}
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

  // ── Crescimento (admin_growth: série diária da metrics_daily) ────────────
  function tabCrescimento(g) {
    const serie = g.serie || [];
    if (!serie.length) return `<p class="admin-empty">A série ainda está vazia.</p>`;
    const ult = serie[serie.length - 1] || {};
    const mes = monthly(serie);
    const atual = mes[mes.length - 1] || {};
    const d30 = serie.length > 30 ? serie[serie.length - 31] : null;
    const cresc30 = d30 && d30.mau ? (ult.mau - d30.mau) / d30.mau : null;
    const inicioColecao = serie.find((d) => d.colecionadores != null);
    const ult120 = serie.slice(-120);
    return `
      <div class="admin-stats">
        ${stat("Visitantes 30 dias", fmt(ult.mau), cresc30 == null ? "a série ainda não tem 30 dias" : `${sinal(cresc30)} contra 30 dias atrás`)}
        ${stat("Logados 30 dias", fmt(ult.mau_users))}
        ${stat("Contas", fmt(ult.contas), `${fmt(atual.contas_novas || 0)} novas neste mês`)}
        ${stat("Colecionadores", fmt(lastDef(serie, "colecionadores")), "contas com carta na nuvem")}
        ${stat("Cópias catalogadas", fmt(lastDef(serie, "copias")), "somando todas as contas")}
        ${stat("Ativações no mês", fmt(atual.ativacoes || 0), "1ª carta da vida")}
      </div>
      ${section("Visitantes únicos, janela móvel", lines(ult120, [
        { key: "mau", label: "Últimos 30 dias", color: "var(--accent)" },
        { key: "wau", label: "Últimos 7 dias", color: "#2563eb" },
        { key: "dau", label: "No dia", color: "#16a34a" }
      ], Object.assign(CW(), { aria: "Visitantes únicos em janelas de 30, 7 e 1 dia" })),
        "Cada ponto é quantos visitantes únicos houve nos 30/7/1 dias até aquele dia. É a curva que investidor pede: MAU subindo e a distância entre MAU e DAU diminuindo (hábito).")}
      ${section("Por dia: ativações, contas novas e cliques em loja", lines(serie.slice(-90), [
        { key: "ativacoes", label: "Ativações", color: "#16a34a" },
        { key: "contas_novas", label: "Contas novas", color: "#2563eb" },
        { key: "cliques_loja", label: "Cliques em loja", color: "#d97706" }
      ], Object.assign(CW(), { aria: "Ativações, contas novas e cliques em loja por dia" })))}
      ${section("Mês a mês", paged("mes", [
        { t: "Mês" }, { t: "Visitantes 30d", num: true }, { t: "Crescimento", num: true }, { t: "Contas", num: true },
        { t: "Contas novas", num: true }, { t: "Ativações", num: true }, { t: "Cartas cadastradas", num: true }, { t: "Cliques em loja", num: true }
      ], mes.slice().reverse().map((m) => `<tr><td>${esc(m.mes)}${m.dias < 28 ? ` <small>(${m.dias} dias)</small>` : ""}</td><td class="num">${esc(fmt(m.mau))}</td><td class="num">${esc(sinal(m.cresc_mau))}</td><td class="num">${esc(fmt(m.contas))}</td><td class="num">${esc(fmt(m.contas_novas))}</td><td class="num">${esc(fmt(m.ativacoes))}</td><td class="num">${esc(fmt(m.cartas_add))}</td><td class="num">${esc(fmt(m.cliques_loja))}</td></tr>`), 12),
        `Estoques (visitantes 30d, contas) são o último dia do mês; fluxos somam o mês. A série vem da tabela metrics_daily: o que vem de eventos foi reconstruído 120 dias pra trás; colecionadores e cópias só existem desde ${inicioColecao ? new Date(inicioColecao.day + "T12:00:00").toLocaleDateString("pt-BR") : "o primeiro retrato"} (são fotografados no dia, não dá pra reconstruir).`)}`;
  }

  // ── Para parceiros: a página que se imprime pra loja/investidor ──────────
  // Só agregados, só números que se sustentam sozinhos. Nada que identifique
  // pessoa, e as tabelas de carta usam o índice de demanda (não contagem de
  // coleção de alguém).
  function tabParceiros(dash, ret, st, dm, gr) {
    const o = dash.overview || {}, tx = ret.taxas || {}, stk = ret.stickiness || {}, j = ret.jornada || {};
    const serie = gr.serie || [];
    const ult = serie[serie.length - 1] || {};
    const d30 = serie.length > 30 ? serie[serie.length - 31] : null;
    const cresc30 = d30 && d30.mau ? (ult.mau - d30.mau) / d30.mau : null;
    const jogos = ((dash.games && dash.games.views) || []).filter((x) => x.game && x.game !== "hub").slice(0, 6);
    const totJogos = jogos.reduce((n, x) => n + (x.visitors || 0), 0);
    const canais = ((ret.grupos || {}).canal || []);
    const totCanais = canais.reduce((n, x) => n + x.n, 0);
    const lojas = st.lojas || [];
    const hoje = new Date().toLocaleDateString("pt-BR");
    return `
      <div class="adm-kit-head">
        <div>
          <h2>Sleevu em números</h2>
          <p class="admin-note">Últimos ${esc(String(st.days))} dias, até ${esc(hoje)}. Medição própria, anônima e agregada — nenhum número aqui identifica uma pessoa.</p>
        </div>
        <button type="button" class="chip adm-noprint" data-print>${ICON.print}<span>Imprimir / PDF</span></button>
      </div>
      ${section("Audiência", `<div class="admin-stats">
        ${stat("Visitantes únicos (30d)", fmt(o.mau), cresc30 == null ? "" : `${sinal(cresc30)} em 30 dias`)}
        ${stat("Contas", fmt(o.total_users))}
        ${stat("Colecionadores ativos", fmt(o.collections_users), "com coleção na nuvem")}
        ${stat("Cópias catalogadas", fmt(lastDef(serie, "copias")))}
        ${stat("DAU/MAU", stk.mau ? pct(stk.dau_medio, stk.mau) : "—", "quanto do público do mês aparece num dia comum")}
      </div>`)}
      ${section("Engajamento", `<div class="admin-stats">
        ${stat("Voltam na 2ª semana", pct(tx.d7, tx.el7), "retenção D7")}
        ${stat("Voltam no 2º mês", pct(tx.d30, tx.el30), "retenção D30")}
        ${stat("Ativam", pct(j.ativados, j.visitantes), "põem a 1ª carta na coleção")}
        ${stat("Decks publicados", fmt(o.decks))}
        ${stat("Preços da comunidade", fmt(o.price_points), "contribuições")}
      </div>`)}
      ${section("Tráfego enviado para lojas", `<div class="admin-stats">
        ${stat("Cliques de saída", fmt(st.total), `${fmt(st.pessoas)} pessoas`)}
        ${stat("Para lojas brasileiras", fmt(st.br), "Liga, LigaBRA, MYP")}
        ${stat("Taxa de saída", pct(st.total, st.views_carta), "cliques ÷ cartas abertas")}
        ${stat("Cartas diferentes", fmt(st.cartas))}
      </div>${hbars(lojas.map((x) => ({ label: STORE[x.s] || x.s, value: x.cliques, sub: `${fmt(x.pessoas)} pessoas`, color: STORES_BR.indexOf(x.s) >= 0 ? "var(--accent)" : "#9aa3ae" })))}`,
        "Cada clique é uma pessoa saindo da página da carta direto pra busca daquela carta na loja. Só conta quem aceitou a medição, então é um piso.")}
      <div class="adm-grid-2">
        ${section("Jogos", hbars(jogos.map((x) => ({ label: gameName(x.game), value: x.visitors, color: gameColor(x.game), sub: pct(x.visitors, totJogos) }))), "Visitantes únicos por jogo no período.")}
        ${section("De onde vêm", hbars(canais.map((x) => ({ label: CANAL[x.k] || x.k, value: x.n, sub: pct(x.n, totCanais) }))), "Canal da primeira visita.")}
      </div>
      ${section("Cartas mais procuradas", table(
        [{ t: "Jogo" }, { t: "Carta" }, { t: "Views", num: true }, { t: "Cliques em loja", num: true }, { t: "Na wishlist", num: true }],
        (dm.top || []).slice(0, 10).map((x) => `<tr><td>${gameChip(x.game)}</td><td>${cardCell(x.game, x.card_id)}</td><td class="num">${esc(fmt(x.views))}</td><td class="num">${esc(fmt(x.cliques))}</td><td class="num">${esc(fmt(x.desejos))}</td></tr>`)),
        "Ordenadas pelo índice de demanda (views + 5 × cliques em loja + 10 × contas com a carta na wishlist).")}`;
  }

  // Tabela de recorte (canal, aparelho, jogo…) com as taxas que importam.
  function recorteTable(id, rows, label) {
    return paged(id, [
      { t: label }, { t: "Visitantes", num: true }, { t: "Ativaram", num: true }, { t: "10+ cartas", num: true },
      { t: "Conta", num: true }, { t: "D7", num: true }
    ], (rows || []).map((x) => `<tr><td>${esc(x.label || x.k)}</td><td class="num">${esc(fmt(x.n))}</td><td class="num">${esc(pct(x.ativou, x.n))}</td><td class="num">${esc(pct(x.dez, x.n))}</td><td class="num">${esc(pct(x.contas, x.n))}</td><td class="num" title="${esc(`${fmt(x.d7)} de ${fmt(x.el7)} que já tinham 14 dias`)}">${esc(x.el7 ? pct(x.d7, x.el7) : "—")}</td></tr>`), 8);
  }

  // ── Canais: de onde vem quem FICA ─────────────────────────────────────────
  function tabCanais(ret, gr) {
    const gp = ret.grupos || {};
    const v = gr.viral || {};
    const k = v.compartilhadores ? (v.novos / v.compartilhadores) : null;
    return `
      ${section(`Canal da primeira visita (quem chegou nos últimos ${ret.days} dias)`, recorteTable("canal", (gp.canal || []).map((x) => Object.assign({ label: CANAL[x.k] || x.k }, x)), "Canal"),
        "Direto inclui app instalado, favoritos e links abertos de dentro de apps que escondem a origem (WhatsApp, Instagram no celular). Pra medir uma campanha de verdade, use links com ?utm_source=instagram&utm_campaign=nome — viram \"Campanha\" aqui e a origem aparece abaixo.")}
      ${section("Origem (site ou campanha)", recorteTable("origem", gp.origem || [], "Origem"))}
      ${section("Viralidade dos links compartilhados", `<div class="admin-stats">
        ${stat("Links abertos", fmt(v.aberturas), `nos ${gr.days} dias`)}
        ${stat("Por gente nova", fmt(v.novos), "primeira visita ao site foi pelo link")}
        ${stat("Que ativaram", fmt(v.ativados), "puseram a 1ª carta na coleção")}
        ${stat("Quem compartilhou", fmt(v.compartilhadores), "criaram link no período")}
        ${stat("Novos por quem compartilha", k == null ? "—" : k.toLocaleString("pt-BR", { maximumFractionDigits: 2 }), "acima de 1, o site cresce sozinho")}
      </div>${hbars((v.por_tipo || []).map((x) => ({ label: SHARE_KIND[x.k] || x.k, value: x.n, sub: `${fmt(x.novos)} por gente nova` })))}`)}`;
  }

  // ── Retenção: coortes e recortes ──────────────────────────────────────────
  function tabRetencao(ret) {
    const tx = ret.taxas || {}, stk = ret.stickiness || {}, gp = ret.grupos || {};
    const cohorts = ret.cohorts || [];
    const maxK = cohorts.reduce((m, c) => Math.max(m, (c.ret || []).length), 0);
    const heads = `<tr><th>Semana de entrada</th><th class="num">Pessoas</th>${Array.from({ length: Math.max(0, maxK - 1) }, (_, i) => `<th class="num">S${i + 1}</th>`).join("")}</tr>`;
    const rows = cohorts.slice().reverse().map((c) => {
      const base = (c.ret || [])[0] || 0;
      const cells = Array.from({ length: Math.max(0, maxK - 1) }, (_, i) => {
        const v = (c.ret || [])[i + 1];
        if (v == null) return `<td class="adm-heat"></td>`;
        const p = base ? v / base : 0;
        // Teto de 55% na mistura: acima disso o texto escuro some no fundo.
        return `<td class="num adm-heat" style="--p:${Math.round(Math.min(0.55, p * 2) * 100)}%" title="${esc(`${fmt(v)} de ${fmt(base)}`)}">${esc(pct(v, base))}</td>`;
      }).join("");
      return `<tr><td>${esc(new Date(c.semana + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }))}</td><td class="num">${esc(fmt(base))}</td>${cells}</tr>`;
    }).join("");
    const lbl = { ativou: "Ativou (1ª carta)", nao: "Não ativou", app: "App instalado", navegador: "Navegador", m: "Toque (celular/tablet)", d: "Ponteiro (desktop)", "?": "Sem info" };
    const comLabel = (arr, f) => (arr || []).map((x) => Object.assign({ label: f ? f(x.k) : (lbl[x.k] || x.k) }, x));
    return `
      <div class="admin-stats">
        ${stat("Voltam no dia seguinte", pct(tx.d1, tx.el1), `D1 · ${fmt(tx.el1)} visitantes`)}
        ${stat("Voltam na 2ª semana", pct(tx.d7, tx.el7), `D7 · dias 7 a 13`)}
        ${stat("Voltam no 2º mês", pct(tx.d30, tx.el30), `D30 · dias 30 a 59`)}
        ${stat("DAU/MAU", stk.mau ? pct(stk.dau_medio, stk.mau) : "—", `${fmt(stk.dau_medio)} por dia de ${fmt(stk.mau)} no mês`)}
      </div>
      ${section("Coortes semanais", cohorts.length ? `<div class="adm-scroll"><table class="admin-table adm-cohort"><thead>${heads}</thead><tbody>${rows}</tbody></table></div>` : `<p class="admin-empty">Sem visitantes nas últimas 10 semanas.</p>`,
        "Cada linha é quem chegou naquela semana (segunda a domingo); S1, S2… é a fração que voltou 1, 2… semanas depois. Cor mais forte = mais gente voltando. Taxas D1/D7/D30 acima usam quem entrou nos últimos 120 dias e já teve tempo de voltar. Nas tabelas abaixo, D7 = voltou entre o 7º e o 13º dia, só entre quem chegou há 14+ dias.")}
      <div class="adm-grid-2 adm-grid-wide">
        ${section("Ativar muda a retenção?", recorteTable("r-ativ", comLabel(gp.ativacao), "Recorte"), "Se quem ativa volta muito mais, o trabalho é levar gente à 1ª carta mais rápido.")}
        ${section("App instalado × navegador", recorteTable("r-app", comLabel(gp.app), "Recorte"))}
        ${section("Aparelho da 1ª visita", recorteTable("r-dev", comLabel(gp.device), "Aparelho"))}
        ${section("Jogo da 1ª visita", recorteTable("r-game", comLabel(gp.game, gameName), "Jogo"))}
      </div>`;
  }

  // ── Lojas: cliques de saída ───────────────────────────────────────────────
  function tabLojas(st) {
    const lojas = st.lojas || [];
    const lj = st.lojas_jogo || [];
    const brLojas = lojas.filter((x) => STORES_BR.indexOf(x.s) >= 0);
    return `
      <div class="admin-stats">
        ${stat("Cliques em lojas", fmt(st.total), `${fmt(st.pessoas)} pessoas`)}
        ${stat("Lojas brasileiras", fmt(st.br), pct(st.br, st.total) + " dos cliques")}
        ${stat("Taxa de saída", pct(st.total, st.views_carta), `${fmt(st.views_carta)} cartas abertas`)}
        ${stat("Cartas diferentes", fmt(st.cartas))}
        ${stat("De graduadas", fmt(st.graduadas), "PSA, BGS, CGC…")}
        ${stat("No celular", pct(st.celular, st.total))}
      </div>
      ${section(`Cliques por dia (${st.days} dias)`, dailyBars(st.daily || [], Object.assign(CW(), { keyA: "br", keyB: "fora", labelA: "Lojas BR", labelB: "Internacionais", aria: "Cliques em lojas por dia" })))}
      <div class="adm-grid-2">
        ${section("Por loja", hbars(lojas.map((x) => ({ label: STORE[x.s] || x.s, value: x.cliques, sub: `${fmt(x.pessoas)} pessoas · ${fmt(x.cartas)} cartas`, color: STORES_BR.indexOf(x.s) >= 0 ? "var(--accent)" : "#9aa3ae" }))))}
        ${section("Loja × jogo", paged("lj", [{ t: "Loja" }, { t: "Jogo" }, { t: "Cliques", num: true }, { t: "Pessoas", num: true }],
          lj.map((x) => `<tr><td>${esc(STORE[x.s] || x.s)}</td><td>${gameChip(x.g)}</td><td class="num">${esc(fmt(x.cliques))}</td><td class="num">${esc(fmt(x.pessoas))}</td></tr>`), 8))}
      </div>
      ${section("Cartas que mais levam pra loja", paged("lt", [{ t: "Jogo" }, { t: "Carta" }, { t: "Cliques", num: true }, { t: "Pessoas", num: true }, { t: "Lojas BR", num: true }, { t: "Internacionais", num: true }],
        (st.top || []).map((x) => `<tr><td>${gameChip(x.game)}</td><td>${cardCell(x.game, x.card_id)}</td><td class="num">${esc(fmt(x.cliques))}</td><td class="num">${esc(fmt(x.pessoas))}</td><td class="num">${esc(fmt(x.br))}</td><td class="num">${esc(fmt(x.fora))}</td></tr>`), 10))}
      ${section("Relatório para a loja", `<div class="adm-actions">${(brLojas.length ? brLojas : STORES_BR.map((s) => ({ s }))).map((x) => `<button type="button" class="chip" data-csv="${esc(x.s)}">${ICON.down}<span>CSV · ${esc(STORE[x.s] || x.s)}</span></button>`).join("")}<button type="button" class="chip" data-csv="*">${ICON.down}<span>CSV · todas</span></button></div>`,
        `Uma linha por carta: jogo, carta, cliques e pessoas no período. Cartas com menos de ${MIN_PESSOAS_CSV} pessoas entram somadas numa linha "outras" por jogo — relatório que sai daqui não pode permitir adivinhar o que uma pessoa específica procurou. Os links pras lojas BR levam utm_source=sleevu, então a loja também vê esse tráfego no analytics dela.`)}`;
  }

  // ── Demanda: o que está sendo procurado ───────────────────────────────────
  function tabDemanda(dm) {
    const jogos = dm.jogos || [];
    const byGame = {};
    (dm.by_game || []).forEach((x) => { (byGame[x.game] = byGame[x.game] || []).push(x); });
    const ordem = jogos.map((x) => x.game).filter((g) => byGame[g]);
    const varPct = (a, b) => (b ? sinal((a - b) / b) : a ? "novo" : "—");
    return `
      ${section("Por jogo", table(
        [{ t: "Jogo" }, { t: "Cartas abertas", num: true }, { t: "Contra o período anterior", num: true }, { t: "Cliques em loja", num: true }, { t: "Na wishlist", num: true }],
        jogos.map((x) => `<tr><td>${gameChip(x.game)}</td><td class="num">${esc(fmt(x.views))}</td><td class="num">${esc(varPct(x.views, x.views_antes))}</td><td class="num">${esc(fmt(x.cliques))}</td><td class="num">${esc(fmt(x.desejos))}</td></tr>`)),
        "Cartas abertas vêm do contador por dia (card_views_daily), que começou a contar com a migração 20260923a — antes dela não há histórico por dia.")}
      ${section("Índice de demanda", paged("dm", [{ t: "Jogo" }, { t: "Carta" }, { t: "Índice", num: true }, { t: "Views", num: true }, { t: "Cliques em loja", num: true }, { t: "Na wishlist", num: true }],
        (dm.top || []).map((x) => `<tr><td>${gameChip(x.game)}</td><td>${cardCell(x.game, x.card_id)}</td><td class="num"><strong>${esc(fmt(x.indice))}</strong></td><td class="num">${esc(fmt(x.views))}</td><td class="num">${esc(fmt(x.cliques))}</td><td class="num">${esc(fmt(x.desejos))}</td></tr>`), 15),
        "Índice = views + 5 × cliques em loja + 10 × contas com a carta na wishlist. Olhar é barato, sair pra comprar é intenção forte, wishlist é intenção declarada. É uma ORDEM, não uma medida: os três números vão junto.")}
      <div class="adm-grid-2">
        ${section("Em alta (7 dias contra os 7 anteriores)", paged("alta", [{ t: "Jogo" }, { t: "Carta" }, { t: "Agora", num: true }, { t: "Antes", num: true }, { t: "Variação", num: true }],
          (dm.em_alta || []).map((x) => `<tr><td>${gameChip(x.game)}</td><td>${cardCell(x.game, x.card_id)}</td><td class="num">${esc(fmt(x.agora))}</td><td class="num">${esc(fmt(x.antes))}</td><td class="num">${esc(varPct(x.agora, x.antes))}</td></tr>`), 8),
          "Só cartas com 5+ views na semana, pra 1 → 3 não virar \"+200%\".")}
        ${section(`Buscas sem resultado (${fmt(dm.buscas_total)})`, paged("bv", [{ t: "Termo" }, { t: "Jogo" }, { t: "Vezes", num: true }, { t: "Pessoas", num: true }],
          (dm.buscas || []).map((x) => `<tr><td>${esc(x.q)}</td><td>${x.game ? gameChip(x.game) : "<small>todos</small>"}</td><td class="num">${esc(fmt(x.n))}</td><td class="num">${esc(fmt(x.pessoas))}</td></tr>`), 8),
          "O que alguém procurou e a busca não achou: carta que falta no catálogo, apelido que a busca não entende, ou jogo que ainda não temos.")}
      </div>
      ${section("Top por jogo", ordem.length ? `<div class="adm-grid-3">${ordem.map((g) => `<div class="adm-sub"><h3>${gameChip(g)}</h3>${hbars(byGame[g].map((x) => ({ label: nameOf(g, x.card_id) || x.card_id, value: x.indice, href: cardLink(g, x.card_id), color: gameColor(g), sub: `${fmt(x.views)} views · ${fmt(x.cliques)} cliques` })))}</div>`).join("")}</div>` : `<p class="admin-empty">Sem dados no período.</p>`)}`;
  }

  const MIN_PESSOAS_CSV = 3;
  // Monta o CSV de uma loja (ou de todas). Resolve os nomes das cartas antes,
  // porque pra loja o id interno não diz nada.
  async function exportaLoja(loja) {
    const st = state.cache[`stores:${state.days}`];
    if (!st) return;
    const linhas = (st.export || []).filter((x) => loja === "*" || x.s === loja);
    await resolveNames(linhas.map((x) => ({ game: x.game, card_id: x.card_id })));
    const out = [], outras = {};
    linhas.forEach((x) => {
      if (x.pessoas >= MIN_PESSOAS_CSV) { out.push(x); return; }
      const k = `${x.s}|${x.game}`;
      const o = outras[k] || (outras[k] = { s: x.s, game: x.game, card_id: "", outras: true, cliques: 0, pessoas: 0 });
      o.cliques += x.cliques;
    });
    const rows = out.concat(Object.values(outras));
    const csv = toCsv(rows, [
      { t: "Loja", k: (r) => STORE[r.s] || r.s },
      { t: "Jogo", k: (r) => gameName(r.game) },
      { t: "Carta", k: (r) => (r.outras ? `(outras cartas, menos de ${MIN_PESSOAS_CSV} pessoas cada)` : (nameOf(r.game, r.card_id) || r.card_id)) },
      { t: "Id Sleevu", k: "card_id" },
      { t: "Cliques", k: "cliques" },
      { t: "Pessoas", k: (r) => (r.outras ? "" : r.pessoas) }
    ]);
    const nome = `sleevu-cliques-${loja === "*" ? "todas" : loja}-${state.days}d-${new Date().toISOString().slice(0, 10)}.csv`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // Nomes das cartas: o painel só recebe ids (o banco não tem catálogo). O
  // catálogo estático resolve — o mesmo loadOwnedAcrossGames do Explorar.
  // Teto de 400 ids por chamada pra não baixar meio catálogo de uma vez.
  async function resolveNames(pares) {
    if (!shared.loadOwnedAcrossGames) return false;
    const falta = {};
    let n = 0;
    (pares || []).forEach((x) => {
      if (!x || !x.game || !x.card_id || n >= 400) return;
      const k = `${x.game}:${x.card_id}`;
      if (k in state.names) return;
      state.names[k] = "";   // marca como "tentado": id que não resolve não é buscado de novo
      (falta[x.game] = falta[x.game] || []).push(x.card_id);
      n += 1;
    });
    if (!n) return false;
    try {
      const cat = await shared.loadOwnedAcrossGames(falta);
      (cat.cards || []).forEach((c) => {
        const g = c.game || Object.keys(falta).find((gg) => falta[gg].indexOf(c.id) >= 0);
        if (!g) return;
        state.names[`${g}:${c.id}`] = [c.name, c.set && c.number ? `${c.set} ${c.number}` : c.set || c.number].filter(Boolean).join(" · ");
      });
      return true;
    } catch (e) { return false; }
  }
  // Quais cartas cada aba mostra (pra resolver nome depois de pintar).
  function cartasDaAba(tab, data) {
    const st = data.stores || {}, dm = data.demand || {};
    if (tab === "lojas") return st.top || [];
    if (tab === "demanda") return (dm.top || []).concat(dm.em_alta || [], dm.by_game || []);
    if (tab === "parceiros") return (dm.top || []).slice(0, 10);
    if (tab === "conteudo") { const c = (data.dash || {}).cards || {}; return (c.top || []).concat(c.wanted || [], c.viewed || []); }
    return [];
  }

  const RENDER = {
    geral: (x) => tabGeral(x.dash), audiencia: (x) => tabAudiencia(x.dash), conteudo: (x) => tabConteudo(x.dash),
    produto: (x) => tabProduto(x.dash), qualidade: (x) => tabQualidade(x.dash),
    crescimento: (x) => tabCrescimento(x.growth),
    parceiros: (x) => tabParceiros(x.dash, x.retention, x.stores, x.demand, x.growth),
    canais: (x) => tabCanais(x.retention, x.growth), retencao: (x) => tabRetencao(x.retention),
    funil: (x) => tabFunil(x.funnel, x.retention), lojas: (x) => tabLojas(x.stores), demanda: (x) => tabDemanda(x.demand)
  };

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
  // Cada RPC é buscada uma vez por período, só quando uma aba que a usa abre
  // (NEEDS). undefined = a RPC não existe no banco (migração pendente); null =
  // sem acesso ou falha — esse não fica no cache, tenta de novo na próxima.
  function need(key) {
    const ck = `${key}:${state.days}`;
    if (ck in state.cache) return Promise.resolve(state.cache[ck]);
    if (state.inflight[ck]) return state.inflight[ck];
    const days = state.days;
    const p = (key === "dash" ? shared.adminDashboard(days)
      : key === "funnel" ? shared.adminFunnel(days)
      : shared.adminRpc(RPC[key], days)
    ).then((v) => {
      delete state.inflight[ck];
      if (v !== null) state.cache[ck] = v;
      return v;
    });
    state.inflight[ck] = p;
    return p;
  }
  const MIGRACAO = {
    dash: "20260914a_admin_dashboard.sql",
    funnel: "20260919a_funil_ativacao.sql e depois 20260923a_analytics_v2.sql",
    retention: "20260923a_analytics_v2.sql", stores: "20260923a_analytics_v2.sql",
    demand: "20260923a_analytics_v2.sql", growth: "20260923a_analytics_v2.sql"
  };
  function pendente(keys) {
    const arqs = Array.from(new Set(keys.map((k) => MIGRACAO[k])));
    const rpcs = keys.map((k) => (k === "dash" ? "admin_dashboard" : k === "funnel" ? "admin_funnel" : RPC[k]));
    return `<p class="adm-banner">${rpcs.map((r) => `A RPC <code>${esc(r)}</code> ainda não existe no banco`).join("; ")}: aplique <code>supabase/migrations/${arqs.map(esc).join("</code>, <code>supabase/migrations/")}</code> no SQL Editor. <strong>Enquanto a 20260923a não for aplicada, os eventos novos (clique em loja, conta nova, busca vazia, link aberto, app instalado) são descartados pelo banco sem erro</strong> — aplique o SQL ANTES de subir o JS.</p>`;
  }

  function nav() {
    const grupo = TAB_GROUP[state.tab];
    const abas = (GROUPS.find((g) => g[0] === grupo) || GROUPS[0])[2];
    return `<div class="adm-nav">
        <div class="adm-groups" role="tablist" aria-label="Seções">${GROUPS.map(([id, label]) => `<button type="button" class="chip" role="tab" data-group="${id}" aria-selected="${grupo === id}">${esc(label)}</button>`).join("")}</div>
        ${abas.length > 1 ? `<div class="adm-tabs" role="tablist" aria-label="Painéis de ${esc((GROUPS.find((g) => g[0] === grupo) || [])[1] || "")}">${abas.map(([id, label]) => `<button type="button" class="chip" role="tab" data-tab="${id}" aria-selected="${state.tab === id}">${esc(label)}</button>`).join("")}</div>` : ""}
      </div>
      <div class="adm-period" role="group" aria-label="Período">${PERIODS.map((p) => `<button type="button" class="chip" data-days="${p}" aria-pressed="${state.days === p}">${p} dias</button>`).join("")}</div>`;
  }

  function onClick(e) {
    const t = e.target.closest("button, a");
    if (!t || !root.contains(t)) return;
    if (t.dataset.group) {
      const g = GROUPS.find((x) => x[0] === t.dataset.group);
      if (g && TAB_GROUP[state.tab] !== g[0]) go(g[2][0][0]);
    } else if (t.dataset.tab) {
      if (t.dataset.tab !== state.tab) go(t.dataset.tab);
    } else if (t.dataset.days) {
      state.days = Number(t.dataset.days) || 30;
      state.pages = {};
      render();
    } else if (t.dataset.page) {
      const id = t.dataset.page;
      state.pages[id] = (state.pages[id] || 1) + Number(t.dataset.dir || 0);
      const box = root.querySelector(`[data-paged="${CSS.escape(id)}"]`);
      if (box) box.innerHTML = pagedInner(id);
    } else if (t.dataset.csv) {
      t.disabled = true;
      exportaLoja(t.dataset.csv).finally(() => { t.disabled = false; });
    } else if (t.hasAttribute("data-print")) {
      window.print();
    }
  }
  function go(tab) {
    state.tab = tab;
    try { history.replaceState(null, "", `#${tab}`); } catch (err) { /* ignora */ }
    render();
  }

  let seq = 0;
  async function render() {
    const my = ++seq;
    if (!document.getElementById("admBody")) {
      // 1ª pintura: a admin_dashboard decide se é admin e se o banco está no
      // 20260914a (senão cai no painel legado).
      const d = await need("dash");
      if (my !== seq) return;
      if (d === undefined) {
        const old = await shared.analyticsSummary(30);
        root.innerHTML = old ? renderLegado(old) : `<p class="empty-state">Acesso restrito — entre com a conta de admin.</p>`;
        return;
      }
      if (!d) {
        root.innerHTML = `<p class="empty-state">Acesso restrito — entre com a conta de admin.</p>`;
        return;
      }
      root.innerHTML = `<div class="adm-toolbar" id="admToolbar"></div><div id="admBody"></div><p class="admin-note" id="admNote"></p>`;
      root.addEventListener("click", onClick);
    }
    document.getElementById("admToolbar").innerHTML = nav();
    const body = document.getElementById("admBody");
    body.innerHTML = `<p class="empty-state">Carregando…</p>`;
    body.setAttribute("aria-busy", "true");

    if (state.tab === "qualidade" && state.errors === undefined) {
      shared.errorSummary(7).then((errs) => { state.errors = errs; if (state.tab === "qualidade") render(); });
    }
    const keys = NEEDS[state.tab] || ["dash"];
    const vals = await Promise.all(keys.map(need));
    if (my !== seq) return;           // trocou de aba/período no meio
    body.removeAttribute("aria-busy");
    const data = {};
    keys.forEach((k, i) => { data[k] = vals[i]; });
    const faltam = keys.filter((k) => data[k] === undefined);
    const falhou = keys.filter((k) => data[k] === null);
    if (faltam.length) body.innerHTML = pendente(faltam);
    else if (falhou.length) body.innerHTML = `<p class="empty-state">Não consegui carregar esta aba (${esc(falhou.join(", "))}). Tente de novo em instantes.</p>`;
    else {
      body.innerHTML = RENDER[state.tab](data);
      // Nomes das cartas chegam depois (catálogo estático): pinta com id e
      // repinta com nome, sem segurar a aba esperando o catálogo.
      const tab = state.tab;
      resolveNames(cartasDaAba(tab, data)).then((novo) => {
        if (novo && my === seq && state.tab === tab) body.innerHTML = RENDER[tab](data);
      });
    }
    const d = state.cache[`dash:${state.days}`];
    document.getElementById("admNote").textContent = d
      ? `Atualizado em ${new Date(d.generated_at).toLocaleString("pt-BR")} · janela de ${d.days} dias desde ${new Date(d.since).toLocaleDateString("pt-BR")}. "Gente" = pageview com JS executado, user-agent de navegador e sem webdriver; visitantes contam uuid anônimo first-party (só com consentimento de medição), logados contam a conta pelo JWT. O Cloudflare Web Analytics mede o resto: país, navegador, Core Web Vitals e o tráfego que nem chega a rodar JS.`
      : "";
  }
  render();
})();
