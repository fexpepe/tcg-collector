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
    const ESTOQUE = ["mau", "mau_users", "contas", "colecionadores", "copias", "valor_catalogado"];
    const FLUXO = ["novos", "contas_novas", "ativacoes", "cliques_loja", "cartas_add", "scans", "shares_criados", "valor_encaminhado"];
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

  // ── Kit para parceiros (2026-09-29) ───────────────────────────────────────
  // Teto "redondo" pro eixo Y: 5.214 → 6.000, não 10.000 (com passos 1-2-5 o
  // gráfico ficava com metade da altura vazia) nem 5.214 (a grade do meio
  // cairia em 2.607, número que ninguém lê).
  function niceMax(v) {
    if (!(v > 0)) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    const passo = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((f) => f * mag >= v - 1e-9);
    return passo * mag;
  }

  // Número curto pra cartão de destaque: "4,36 mi", "612 mil" (três dígitos
  // significativos). Abaixo de 100 mil fica exato (5.214 visitantes convence
  // mais que "5,21 mil"). `moeda` prefixa R$ — e aí o corte é em 10 mil:
  // "R$ 98,2 mil" lê melhor que "R$ 98.200" num cartão estreito.
  function compacto(n, moeda) {
    if (n == null || !isFinite(n)) return "—";
    const v = Number(n);
    const corte = moeda ? 1e4 : 1e5;
    const txt = Math.abs(v) < corte ? fmt(Math.round(v))
      : new Intl.NumberFormat("pt-BR", { notation: "compact", maximumSignificantDigits: 3 }).format(v);
    return (moeda ? "R$ " : "") + txt.replace(/\s/g, " ");
  }

  // Área (kit): série diária [{day, v}] → SVG com a área clara, a linha por
  // cima e o último ponto marcado com o valor. X rotulado no dia 1 de cada
  // mês; Y com três linhas de grade no teto redondo. Pontos sem valor saem.
  function area(pontos, opts) {
    const o = Object.assign({ w: 680, h: 190, cor: "#dc2626", aria: "Série no tempo" }, opts || {});
    const pts = (pontos || []).filter((p) => p && p.v != null && isFinite(p.v));
    if (pts.length < 2) return "";
    const P = { l: 40, r: 16, t: 16, b: 24 };
    const iw = o.w - P.l - P.r, ih = o.h - P.t - P.b, n = pts.length;
    const max = niceMax(Math.max(...pts.map((p) => Number(p.v))));
    const x = (i) => P.l + (i / (n - 1)) * iw;
    const y = (v) => P.t + ih - (Math.max(0, Number(v)) / max) * ih;
    const chao = (P.t + ih).toFixed(1);
    const linha = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join("");
    const grade = [0, 0.5, 1].map((f) => {
      const yy = y(max * f).toFixed(1);
      return `<line x1="${P.l}" x2="${o.w - P.r}" y1="${yy}" y2="${yy}" class="adm-grid"/><text x="${P.l - 8}" y="${(Number(yy) + 3.5).toFixed(1)}" text-anchor="end" class="adm-axis">${esc(compacto(max * f))}</text>`;
    }).join("");
    const meses = pts.map((p, i) => [p, i]).filter(([p]) => String(p.day).slice(8, 10) === "01").map(([p, i]) => {
      const nome = new Date(`${String(p.day).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
      return `<line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${chao}" y2="${(P.t + ih + 4).toFixed(1)}" class="adm-grid"/><text x="${x(i).toFixed(1)}" y="${o.h - 6}" text-anchor="middle" class="adm-axis">${esc(nome)}</text>`;
    }).join("");
    const ult = pts[n - 1], ux = x(n - 1), uy = y(ult.v);
    // Último valor em cima do ponto; se o ponto está no teto do eixo, embaixo
    // (em cima ele sairia da caixa e o PDF cortaria o número).
    const ly = uy - 10 < 14 ? uy + 20 : uy - 10;
    return `<svg class="adm-kit-area" viewBox="0 0 ${o.w} ${o.h}" role="img" aria-label="${esc(o.aria)}">${grade}${meses}`
      + `<path d="${linha}L${ux.toFixed(1)} ${chao}L${x(0).toFixed(1)} ${chao}Z" fill="${esc(o.cor)}" fill-opacity="0.1"/>`
      + `<path d="${linha}" fill="none" stroke="${esc(o.cor)}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`
      + `<circle cx="${ux.toFixed(1)}" cy="${uy.toFixed(1)}" r="4.5" fill="${esc(o.cor)}" stroke="#fff" stroke-width="2"/>`
      + `<text x="${(ux - 8).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="end" class="adm-kit-area-ult">${esc(fmt(ult.v))}</text></svg>`;
  }

  window.TCGAdminCharts = { squarify, treemap, donut, dailyBars, lines, columns, hbars, funnel, esc, fmt, pct, pageSlice, toCsv, monthly, niceMax, compacto, area };

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
    tcgplayer: "TCGplayer", pricecharting: "PriceCharting", cardmarket: "Cardmarket", "?": "—"
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
  // 2.1 (2026-09-28): grupo Usuários (quem são, maiores coleções, segmentos)
  // e as abas Campanhas, Tempo de uso, Experimentos, Portal, Sets e Medição.
  const GROUPS = [
    ["visao", "Visão geral", [["geral", "Resumo"], ["crescimento", "Crescimento"], ["parceiros", "Para parceiros"]]],
    ["usuarios", "Usuários", [["usuarios", "Perfil"], ["colecoes", "Maiores coleções"], ["segmentos", "Segmentos"]]],
    ["aquisicao", "Aquisição", [["audiencia", "Audiência"], ["canais", "Canais"], ["campanhas", "Campanhas"]]],
    ["engajamento", "Engajamento", [["retencao", "Retenção"], ["funil", "Funil"], ["tempo", "Tempo de uso"], ["produto", "Produto"], ["experimentos", "Experimentos"]]],
    ["mercado", "Mercado", [["lojas", "Lojas"], ["portal", "Portal da loja"], ["demanda", "Demanda"], ["sets", "Sets"], ["anuncios", "Vitrine"], ["conteudo", "Conteúdo"]]],
    ["tecnico", "Técnico", [["qualidade", "Qualidade"], ["medicao", "Medição"]]]
  ];
  const TAB_GROUP = {};
  GROUPS.forEach(([g, , tabs]) => tabs.forEach(([t]) => { TAB_GROUP[t] = g; }));
  // Quais RPCs cada aba precisa. `dash` = admin_dashboard (20260914a),
  // `funnel` = admin_funnel (20260919a, recriada na 20260923a); o resto é da
  // 20260923a. Cada uma é buscada só quando uma aba que a usa abre.
  const NEEDS = {
    geral: ["dash"], audiencia: ["dash"], conteudo: ["dash"], produto: ["dash"], qualidade: ["dash"],
    crescimento: ["growth"], parceiros: ["dash", "retention", "stores", "demand", "growth", "engagement", "users", "anuncios"],
    canais: ["retention", "growth"], retencao: ["retention"], funil: ["funnel", "retention", "engagement"],
    lojas: ["stores"], demanda: ["demand"], anuncios: ["anuncios", "apoiadores"],
    usuarios: ["users"], colecoes: ["users"], segmentos: ["users"], campanhas: ["campaigns"],
    tempo: ["engagement"], experimentos: ["experiments"], portal: ["partners", "stores"], sets: ["demand"],
    medicao: ["health", "engagement"]
  };
  const RPC = {
    retention: "admin_retention", stores: "admin_stores", growth: "admin_growth", demand: "admin_demand", anuncios: "admin_vitrine", apoiadores: "admin_apoiadores",
    users: "admin_users", campaigns: "admin_campaigns", engagement: "admin_engagement", experiments: "admin_experiments",
    partners: "admin_partner_links", health: "admin_health"
  };
  // RPCs sem parâmetro: mandar { days } a elas faz o PostgREST procurar uma
  // assinatura que não existe (404) e o painel acharia que a migração falta.
  const SEM_DIAS = ["campaigns", "partners", "health", "apoiadores"];
  // Pedaço de aba que não segura a aba inteira quando a migração dele falta:
  // a seção mostra o próprio aviso e o resto da aba pinta normal. É POR ABA:
  // no kit de parceiros, perfil de usuário e vitrine são enfeite (sem eles o
  // kit cai no plano B); nas abas Usuários e Vitrine, são a aba.
  const OPCIONAIS = { anuncios: ["apoiadores"], parceiros: ["users", "anuncios"] };
  const PERIODS = [7, 30, 90];
  const state = { tab: "geral", days: 30, cache: {}, inflight: {}, errors: undefined, pages: {}, names: {}, meta: {}, metaPendente: false, marca: null };
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

  // ── Precisão do scanner (migração 20260928b) ──────────────────────────────
  // O funil diz se a leitura ACHOU uma carta, não se era a CERTA. Quem troca o
  // 1º resultado por outra opção, ou desiste e digita o código, está dizendo
  // que o scanner errou — é a taxa de erro de verdade. "A foto escolheu" mede
  // a conferência pela imagem (src/scan.js), que desempata as cartas com o
  // mesmo código impresso (Alternate Art, Parallel, Manga). Com a RPC antiga
  // (sem as chaves novas) fica o aviso, não um "0%" que pareceria medido.
  function precisaoScanner(f) {
    const sc = (f && f.scan) || {};
    if (sc.trocou == null) return `<p class="admin-note">${esc("Aplique a migração 20260928b (supabase/migrations) pra ver a precisão do scanner.")}</p>`;
    const pctInt = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "—");
    const achou = sc.achou || 0;
    return `<div class="admin-stats">
        ${stat("1º resultado aceito", pctInt(Math.max(0, achou - (sc.trocou || 0)), achou), "leituras que acharam carta e não foram trocadas por outra opção")}
        ${stat("Com mais de uma opção", pctInt(sc.ambiguas || 0, achou), "o mesmo código casou com várias cartas")}
        ${stat("A foto escolheu", pctInt(sc.pela_foto || 0, sc.ambiguas || 0), "das leituras com várias opções, em quantas a imagem mudou a 1ª")}
        ${stat("Digitou o código", fmt(sc.digitou || 0), `buscas à mão na folha de correção (${pctInt(sc.digitou || 0, sc.tentativas || 0)} das leituras)`)}
      </div>`;
  }

  function tabFunil(f, ret, eg) {
    const ob = (eg && eg.onboarding) || {}, ps = (eg && eg.push) || {};
    const PASSO = { carta: "1ª carta na coleção", csv: "Importou uma planilha", lista: "Criou uma lista", app: "Instalou o app" };
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
      ${section("Precisão do scanner", precisaoScanner(f),
        "\"Aceito\" = leituras que acharam carta menos as em que a pessoa trocou o 1º resultado. Cartas/min (acima) é a régua de ritmo; esta é a de acerto.")}
      ${section("Scanner por jogo", table(
        [{ t: "Jogo" }, { t: "Sessões", num: true }, { t: "Leu o código", num: true }, { t: "Achou a carta", num: true }, { t: "1º aceito", num: true }, { t: "Sessões secas", num: true }],
        jogos.map((x) => `<tr><td>${gameChip(x.game)}</td><td class="num">${esc(fmt(x.sessoes))}</td><td class="num">${esc(pctInt(x.leu, x.tentativas))}</td><td class="num">${esc(pctInt(x.achou, x.leu))}</td><td class="num">${esc(x.trocou == null ? "—" : pctInt(Math.max(0, x.achou - x.trocou), x.achou))}</td><td class="num">${esc(pctInt(x.secas, x.sessoes))}</td></tr>`)),
        "\"Leu\" = leituras que extraíram código ÷ tentativas; \"achou\" = códigos que casaram com o catálogo ÷ lidos; \"1º aceito\" = achadas em que a pessoa não trocou o 1º resultado. Jogo com leitura boa e achou ruim é buraco no catálogo, não no OCR.")}
      ${section("Ritmo de cadastro por caminho", table(
        [{ t: "Caminho" }, { t: "Cartas", num: true }, { t: "Rajadas", num: true }, { t: "Pessoas", num: true }, { t: "Cartas/min", num: true }],
        cad.map((x) => `<tr><td>${esc(VIA[x.via] || x.via)}</td><td class="num">${esc(fmt(x.cartas))}</td><td class="num">${esc(fmt(x.rajadas))}</td><td class="num">${esc(fmt(x.pessoas))}</td><td class="num">${esc(x.cartas_min == null ? "—" : String(x.cartas_min))}</td></tr>`)),
        `Uma "rajada" é uma sequência de cadastros sem 20s de pausa. Cartas/min é a mediana entre rajadas de 5+ cartas.${melhorRitmo && melhorRitmo.cartas_min ? ` Hoje o caminho mais rápido é "${VIA[melhorRitmo.via] || melhorRitmo.via}", com ${melhorRitmo.cartas_min} cartas/min.` : ""}`)}
      <div class="adm-grid-2">
        ${section("Onde o login barrou", hbars((f.gate_paginas || []).map((x) => ({ label: pageName(x.pagina), value: x.n }))),
          `${fmt(f.gate_pessoas || 0)} pessoas bateram no portão; ${fmt(f.gate_conv || 0)} (${pctInt(f.gate_conv || 0, f.gate_pessoas || 0)}) entraram depois — criaram conta ou voltaram logadas.`)}
        ${section("App instalado", `<div class="admin-stats">${stat("Instalações", fmt(f.instalacoes || 0), `nos ${f.days} dias`)}</div>`,
          "Evento appinstalled do navegador (Android/desktop). No iPhone a instalação é pelo menu Compartilhar e o navegador não avisa — lá o sinal é a visita já aberta como app (aba Retenção).")}
      </div>
      <div class="adm-grid-2">
        ${section("Primeiros passos (checklist do Dashboard)", `${hbars(Object.keys(PASSO).map((k) => ({ label: PASSO[k], value: ((ob.passos || []).find((x) => x.passo === k) || {}).n || 0, sub: pct(((ob.passos || []).find((x) => x.passo === k) || {}).n || 0, ob.pessoas) })))}
          <p class="admin-note">${esc(`${fmt(ob.pessoas)} pessoas viram o checklist; ${fmt(ob.dispensou)} dispensaram. Passos concluídos: ${(ob.por_feitos || []).map((x) => `${x.f} → ${fmt(x.n)}`).join(" · ") || "—"}.`)}</p>`,
          "A foto mais recente de cada navegador no período: qual passo trava é onde o onboarding precisa de ajuda.")}
        ${section("Alertas de wishlist (push)", funnel([
          { label: "avisos enviados", value: ps.enviados, color: "var(--accent)" },
          { label: "aberturas", value: ps.aberturas, color: "#2563eb", hint: `${fmt(ps.pessoas)} pessoas` },
          { label: "clicaram numa loja em até 1h", value: ps.loja_1h, color: "#16a34a" }
        ]), "Enviados vem do robô semanal do push; abertura é a visita com utm_source=push. É o caminho mais curto até uma compra — e o argumento pra alerta patrocinado.")}
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
        ${stat("Valor catalogado", brl(lastDef(serie, "valor_catalogado")), "R$ em cartas nas coleções")}
        ${stat("Ativações no mês", fmt(atual.ativacoes || 0), "1ª carta da vida")}
        ${stat("Valor enviado às lojas", brl(atual.valor_encaminhado || 0), "neste mês")}
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
        { t: "Contas novas", num: true }, { t: "Ativações", num: true }, { t: "Cartas cadastradas", num: true }, { t: "Cliques em loja", num: true },
        { t: "Valor enviado", num: true }, { t: "Valor catalogado", num: true }
      ], mes.slice().reverse().map((m) => `<tr><td>${esc(m.mes)}${m.dias < 28 ? ` <small>(${m.dias} dias)</small>` : ""}</td><td class="num">${esc(fmt(m.mau))}</td><td class="num">${esc(sinal(m.cresc_mau))}</td><td class="num">${esc(fmt(m.contas))}</td><td class="num">${esc(fmt(m.contas_novas))}</td><td class="num">${esc(fmt(m.ativacoes))}</td><td class="num">${esc(fmt(m.cartas_add))}</td><td class="num">${esc(fmt(m.cliques_loja))}</td><td class="num">${esc(brl(m.valor_encaminhado))}</td><td class="num">${esc(m.valor_catalogado == null ? "—" : brl(m.valor_catalogado))}</td></tr>`), 12),
        `Estoques (visitantes 30d, contas) são o último dia do mês; fluxos somam o mês. A série vem da tabela metrics_daily: o que vem de eventos foi reconstruído 120 dias pra trás; colecionadores e cópias só existem desde ${inicioColecao ? new Date(inicioColecao.day + "T12:00:00").toLocaleDateString("pt-BR") : "o primeiro retrato"} (são fotografados no dia, não dá pra reconstruir).`)}`;
  }

  // ── Para parceiros: o kit que sai em PDF pra loja, anunciante e investidor ─
  // (2026-09-29) Era a própria tela impressa: sem marca, com o título "Admin -
  // Sleevu" e a URL do painel que o navegador carimba no papel, cartões
  // quebrando 5 + 1 por linha, as barras SUMINDO (são fundo, e fundo não
  // imprime por padrão) e meia página em branco antes de cada seção grande.
  // Agora é um documento A4 de quatro páginas desenhado pra papel — capa com
  // o wordmark e o que é o Sleevu, público, intenção de compra e como
  // trabalhar junto, com metodologia e contato — e a aba mostra a prévia fiel
  // do que sai. Paleta própria e fixa (.adm-kit no styles.css): o PDF é o
  // mesmo seja qual for o tema de quem imprime.
  // Continua valendo: só agregados, só números que se sustentam sozinhos.
  // Nada que identifique pessoa; as cartas vêm do índice de demanda, não da
  // coleção de alguém.
  //
  // Números do CATÁLOGO: os mesmos da .lp-stats da home (index.html) e do
  // og-image (scripts/og/og-image.html). Ao recontar, mude nos três lugares.
  const KIT_CATALOGO = { cartas: "240 mil+", sets: "2.200+" };
  // Logos dos jogos: o mesmo mapa do src/app.js (que o admin não carrega).
  const KIT_LOGO = {
    pokemon: "game_pokemon.webp", lorcana: "game_lorcana-v2.webp", onepiece: "game_onepiece.webp",
    magic: "game_magic-v2.webp", fab: "game_fab.webp", gundam: "game_gundam-v2.webp", swu: "game_swu.webp", cyberpunk: "game_cyberpunk.webp", sorcery: "game_sorcery.webp", dbfw: "game_dbfw-v2.webp",
    ygo: "game_ygo-v2.webp", digimon: "game_digimon-v2.webp", riftbound: "game_riftbound-v2.webp",
    unionarena: "game_unionarena.webp", naruto: "game_naruto.webp", hxh: "game_hxh.webp",
    dbc: "game_dbc.webp", wow: "game_wow.webp", lotr: "game_lotr.webp"
  };
  // Contato público: o mesmo da página Sobre e do data/ads.json (`contato`).
  const KIT_CONTATO = { email: "sleevuapp@gmail.com", instagram: "@sleevu.app", site: "sleevu.app" };
  const KIT_PAGINAS = 4;
  // Largura do A4 em px CSS (210 mm a 96 dpi): a prévia é desenhada nela e
  // encolhe com zoom quando a tela é mais estreita (ajustaKit).
  const KIT_LARGURA = 794;
  const KIT_CORES = { vermelho: "#dc2626", escuro: "#101218", cinza: "#9aa3ae", claro: "#c9ced6" };

  // O wordmark vem do MESMO arquivo que o site usa, inline: dentro de <img> o
  // fill="currentColor" sai preto, e a máscara CSS do .brand é fundo, que o
  // papel só imprime com print-color-adjust. `n` renomeia os ids (clipPath e
  // glifos): dois wordmarks na mesma página com o mesmo id se atropelam.
  function carregaMarca() {
    if (state.marca != null) return Promise.resolve(state.marca);
    return fetch("assets/brand/sleevu-wordmark.svg")
      .then((r) => (r.ok ? r.text() : ""))
      .catch(() => "")
      .then((t) => { state.marca = /<svg[\s>]/.test(t) ? t.replace(/<\?xml[^>]*\?>\s*/i, "").trim() : ""; return state.marca; });
  }
  function marca(n) {
    if (!state.marca) return `<span class="adm-kit-marca-txt">Sleevu</span>`;
    return state.marca
      .replace(/\bid="([^"]+)"/g, `id="$1-k${n}"`)
      .replace(/#(font_\w+|clip_\d+)\b/g, `#$1-k${n}`)
      .replace("<svg ", `<svg aria-hidden="true" focusable="false" `);
  }

  // Porcentagem do kit: inteira a partir de 10% ("63%"), uma casa abaixo
  // ("4,8%") — no papel, "63,2%" é ruído.
  const pctK = (a, b) => {
    if (!b || a == null) return "—";
    const v = (100 * a) / b;
    return `${v.toLocaleString("pt-BR", { maximumFractionDigits: v >= 10 ? 0 : 1 })}%`;
  };
  // Barras do kit: rótulo e valor em cima, a barra embaixo em largura cheia —
  // cabe nos cartões estreitos do A4 (a .adm-hbars do painel reserva 170 px só
  // pro rótulo). `v` dá o tamanho da barra; `valor` é o texto da direita.
  function kitBarras(items) {
    const lista = (items || []).filter((it) => it && it.v > 0);
    if (!lista.length) return `<p class="adm-kit-vazio">Sem dados no período.</p>`;
    const teto = Math.max(...lista.map((it) => it.v));
    return `<ul class="adm-kit-barras">${lista.map((it) => `<li><span class="adm-kit-barra-rot">${esc(it.label)}${it.sub ? ` <small>${esc(it.sub)}</small>` : ""}</span><b>${esc(it.valor)}</b><span class="adm-kit-trilho"><span style="width:${Math.max(1.5, (100 * it.v) / teto).toFixed(1)}%;background:${esc(it.cor || KIT_CORES.escuro)}"></span></span></li>`).join("")}</ul>`;
  }
  // Divisão em 100% (aparelho, idioma): uma barra fatiada e a legenda.
  function kitFatias(items) {
    const lista = (items || []).filter((it) => it && it.v > 0);
    const tot = lista.reduce((n, it) => n + it.v, 0);
    if (!tot) return `<p class="adm-kit-vazio">Sem dados no período.</p>`;
    return `<div class="adm-kit-fatias">${lista.map((it) => `<span style="width:${((100 * it.v) / tot).toFixed(2)}%;background:${esc(it.cor)}"></span>`).join("")}</div>
      <ul class="adm-kit-leg">${lista.map((it) => `<li><span class="adm-kit-sw" style="background:${esc(it.cor)}"></span>${esc(it.label)}<b>${esc(pctK(it.v, tot))}</b></li>`).join("")}</ul>`;
  }
  // Cartão de número. `delta` (fração) vira o selo verde/vermelho do lado.
  function kitNum(valor, rotulo, nota, delta) {
    const selo = delta == null ? "" : `<em class="${delta >= 0 ? "adm-kit-sobe" : "adm-kit-desce"}">${esc(sinal(delta))}</em> `;
    return `<div class="adm-kit-num"><strong>${esc(valor == null || valor === "" ? "—" : valor)}</strong><span>${esc(rotulo)}</span>${nota || selo ? `<small>${selo}${esc(nota || "")}</small>` : ""}</div>`;
  }
  const kitCard = (titulo, corpo) => `<div class="adm-kit-card"><h3>${esc(titulo)}</h3>${corpo}</div>`;

  function tabParceiros(dash, ret, st, dm, gr, eg, us, vt) {
    const o = dash.overview || {}, tx = ret.taxas || {}, stk = ret.stickiness || {};
    const ct = ((ret.contas || {}).taxas) || {};
    const tempo = (eg && eg.tempo) || {};
    const serie = gr.serie || [];
    const ult = serie[serie.length - 1] || {};
    const d30 = serie.length > 30 ? serie[serie.length - 31] : null;
    const cresc30 = d30 && d30.mau ? (ult.mau - d30.mau) / d30.mau : null;
    const dias = st.days || dash.days || state.days;
    const fim = new Date(dash.generated_at || Date.now());
    const ini = dash.since ? new Date(dash.since) : new Date(fim.getTime() - (dias - 1) * 864e5);
    const periodo = `${ini.toLocaleDateString("pt-BR")} a ${fim.toLocaleDateString("pt-BR")}`;
    const mesAno = fim.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const nJogos = (shared.GAME_SLUGS || []).length || Object.keys(KIT_LOGO).length;
    const colecionadores = lastDef(serie, "colecionadores");
    const topo = (n) => `<div class="adm-kit-topo"><span class="adm-kit-marca">${marca(n)}</span><span>Kit para parceiros · ${esc(mesAno)}</span></div>`;
    const cab = (num, titulo, lede) => `<header class="adm-kit-cab"><span class="adm-kit-cab-num">${esc(num)}</span><div><h2>${esc(titulo)}</h2>${lede ? `<p>${esc(lede)}</p>` : ""}</div></header>`;
    const rodape = (n) => `<footer class="adm-kit-rodape"><span>${esc(KIT_CONTATO.site)}</span><span>Dados de ${esc(periodo)}</span><span>${n} / ${KIT_PAGINAS}</span></footer>`;

    // ── Página 1: capa, o que é o Sleevu e os destaques ─────────────────────
    // A curva começa no dia em que a janela de 30 dias ficou CHEIA de medição:
    // antes da 1ª visita medida o MAU é zero (não havia medição, e a nota dizia
    // "de 0 para…"), e nos 29 dias seguintes ele sobe só porque a janela está
    // enchendo — as duas coisas desenhariam um crescimento que não houve.
    const comDado = serie.filter((d) => d.mau != null);
    const dia0 = (comDado.find((d) => d.mau > 0) || {}).day;
    const cheia = dia0 ? new Date(new Date(`${dia0}T12:00:00`).getTime() + 29 * 864e5).toISOString().slice(0, 10) : "9999";
    const janela = comDado.filter((d) => d.day >= cheia).slice(-120);
    const g0 = janela[0], g1 = janela[janela.length - 1];
    const cresc = g0 && g1 && g0.mau ? (g1.mau - g0.mau) / g0.mau : null;
    const grafico = janela.length >= 14
      ? kitCard("Crescimento da audiência", area(janela.map((d) => ({ day: d.day, v: d.mau })), { h: 150, aria: "Visitantes únicos em janela móvel de 30 dias" })
        + `<p class="adm-kit-nota">Visitantes únicos nos 30 dias até cada dia: de ${esc(fmt(g0.mau))} para ${esc(fmt(g1.mau))} em ${esc(String(janela.length))} dias${cresc == null ? "" : ` (${esc(sinal(cresc))})`}.</p>`)
      : "";
    const logos = Object.keys(KIT_LOGO).map((g) => `<li><img src="assets/games/${esc(KIT_LOGO[g])}" alt="${esc(gameName(g))}" loading="eager" decoding="async"></li>`).join("");
    const p1 = `<section class="adm-kit-page">
      <header class="adm-kit-hero">
        <div class="adm-kit-hero-topo"><span class="adm-kit-marca">${marca(1)}</span><span class="adm-kit-selo">Kit para parceiros</span></div>
        <p class="adm-kit-sobre">Últimos ${esc(String(dias))} dias · ${esc(periodo)}</p>
        <h1>Sleevu em números</h1>
        <p class="adm-kit-lede">O app grátis pra colecionar cartas de ${esc(String(nJogos))} jogos: catálogo, coleção, preços e comunidade num lugar só.</p>
        <div class="adm-kit-fatos">
          <div><strong>${esc(String(nJogos))} jogos</strong><span>modernos e vintage</span></div>
          <div><strong>${esc(KIT_CATALOGO.cartas)}</strong><span>cartas no catálogo</span></div>
          <div><strong>${esc(KIT_CATALOGO.sets)}</strong><span>sets, de 1996 a hoje</span></div>
          <div><strong>R$ · US$ · €</strong><span>preços em real, dólar e euro</span></div>
        </div>
      </header>
      <div class="adm-kit-corpo">
        <p class="adm-kit-pitch">Catálogo por variante e condição, scanner pela câmera, valor da coleção no tempo, decks, fichários, wishlist com alerta de preço e vendas com link público — sem plano pago e sem limite de cartas.</p>
        <ul class="adm-kit-logos">${logos}</ul>
        <h2 class="adm-kit-h2">Destaques do período</h2>
        <div class="adm-kit-nums">
          ${kitNum(fmt(o.mau), "Visitantes únicos", "nos últimos 30 dias", cresc30)}
          ${kitNum(fmt(o.pageviews), "Páginas vistas", `em ${dias} dias, sem robôs`)}
          ${kitNum(fmt(o.total_users), "Contas", o.new_users ? `+${fmt(o.new_users)} no período` : "")}
          ${kitNum(fmt(colecionadores != null ? colecionadores : o.collections_users), "Colecionadores", "com a coleção na nuvem")}
          ${kitNum(compacto(lastDef(serie, "copias")), "Cartas catalogadas", "cópias somadas nas coleções")}
          ${kitNum(compacto(lastDef(serie, "valor_catalogado"), true), "Valor em coleções", "a preço de mercado")}
          ${kitNum(fmt(st.total), "Cliques para lojas", st.valor ? `${compacto(st.valor, true)} em cartas` : "")}
          ${kitNum(dur(tempo.mediana_ms), "Tempo por visita", "mediana")}
        </div>
        ${grafico}
      </div>
      ${rodape(1)}
    </section>`;

    // ── Página 2: público ───────────────────────────────────────────────────
    const au = dash.audience || {};
    const dev = {};
    (au.devices || []).forEach((x) => { dev[x.k] = (dev[x.k] || 0) + (x.views || 0); });
    const devTot = (dev.m || 0) + (dev.d || 0);
    const LANG_KIT = { pt: "Português", en: "Inglês", es: "Espanhol" };
    const langs = au.langs || [];
    const langTop = langs.filter((x) => LANG_KIT[x.k]);
    const langOutros = langs.filter((x) => !LANG_KIT[x.k]).reduce((n, x) => n + (x.visitors || 0), 0);
    const corLang = { pt: KIT_CORES.vermelho, en: KIT_CORES.escuro, es: KIT_CORES.cinza };
    const langTot = langs.reduce((n, x) => n + (x.visitors || 0), 0);
    const pt = (langs.find((x) => x.k === "pt") || {}).visitors || 0;
    const canais = ((ret.grupos || {}).canal || []);
    const totCanais = canais.reduce((n, x) => n + x.n, 0);
    const jogos = ((dash.games && dash.games.views) || []).filter((x) => x.game && x.game !== "hub" && x.game !== "?");
    const totJogos = jogos.reduce((n, x) => n + (x.visitors || 0), 0);
    const r = (us && us.resumo) || null;
    const PERFIL_KIT = {
      cacador: ["Caçadores", "20+ cartas na wishlist ou preço-alvo"], jogador: ["Jogadores", "montam decks"],
      multijogo: ["Multi-jogo", "colecionam 2+ jogos"], investidor: ["Investidores", "graduadas ou custo anotado"],
      vendedor: ["Vendedores", "cartas à venda ou vendidas"], publico: ["Vitrine pública", "mostram a coleção no perfil"]
    };
    const perfis = r && r.contas ? (us.perfis || []).filter((x) => PERFIL_KIT[x.k] && x.n > 0).sort((a, b) => b.n - a.n) : [];
    const cardPerfil = perfis.length
      ? kitCard("Perfil de quem tem conta", kitBarras(perfis.map((x) => ({ label: PERFIL_KIT[x.k][0], sub: PERFIL_KIT[x.k][1], v: x.n, valor: pctK(x.n, r.contas), cor: KIT_CORES.vermelho })))
        + `<p class="adm-kit-nota">% das ${esc(fmt(r.contas))} contas com coleção; uma conta pode ter vários perfis.${r.valor_mediano ? ` Coleção mediana: ${esc(brl(r.valor_mediano))} e ${esc(fmt(r.copias_mediana))} cartas.` : ""}</p>`)
      : kitCard("Onde estão as coleções", kitBarras(((dash.games && dash.games.collection) || []).slice(0, 8).map((x) => ({ label: gameName(x.game), v: x.users, valor: `${fmt(x.users)} contas`, cor: gameColor(x.game) }))));
    const ledeP2 = devTot && langTot
      ? `${pctK(dev.m || 0, devTot)} das visitas vêm do celular e ${pctK(pt, langTot)} do público navega em português.`
      : "Quem visita, de onde chega e o que coleciona.";
    const p2 = `<section class="adm-kit-page">
      ${topo(2)}
      ${cab("02", "Quem usa o Sleevu", ledeP2)}
      <div class="adm-kit-corpo">
        <div class="adm-kit-grade3">
          ${kitCard("Aparelho", devTot ? `<p class="adm-kit-destaque"><strong>${esc(pctK(dev.m || 0, devTot))}</strong> no celular</p>${kitFatias([{ label: "Celular e tablet", v: dev.m || 0, cor: KIT_CORES.vermelho }, { label: "Computador", v: dev.d || 0, cor: KIT_CORES.escuro }])}` : `<p class="adm-kit-vazio">Sem dados no período.</p>`)}
          ${kitCard("Idioma do navegador", langTot ? `<p class="adm-kit-destaque"><strong>${esc(pctK(pt, langTot))}</strong> em português</p>${kitFatias(langTop.map((x) => ({ label: LANG_KIT[x.k], v: x.visitors || 0, cor: corLang[x.k] })).concat(langOutros ? [{ label: "Outros", v: langOutros, cor: KIT_CORES.claro }] : []))}` : `<p class="adm-kit-vazio">Sem dados no período.</p>`)}
          ${kitCard("Como chegam", kitBarras(canais.slice(0, 5).map((x) => ({ label: CANAL[x.k] || x.k, v: x.n, valor: pctK(x.n, totCanais), cor: KIT_CORES.escuro }))))}
        </div>
        <div class="adm-kit-grade2">
          ${kitCard("Jogos mais acessados", kitBarras(jogos.slice(0, 8).map((x) => ({ label: gameName(x.game), v: x.visitors, valor: pctK(x.visitors, totJogos), cor: gameColor(x.game) })))
            + `<p class="adm-kit-nota">Fatia de cada jogo nos visitantes de páginas de jogo (quem visita dois jogos conta nos dois).</p>`)}
          ${cardPerfil}
        </div>
        <h2 class="adm-kit-h2">Engajamento</h2>
        <div class="adm-kit-nums">
          ${kitNum(pctK(tx.d7, tx.el7), "Voltam na 2ª semana", "visitantes, retenção D7")}
          ${kitNum(pctK(ct.d30, ct.el30), "Contas ativas no 2º mês", "retenção D30 por conta")}
          ${kitNum(tempo.paginas_visita == null ? "—" : String(tempo.paginas_visita).replace(".", ","), "Páginas por visita", "média")}
          ${kitNum(stk.mau ? pctK(stk.dau_medio, stk.mau) : "—", "Hábito (DAU/MAU)", "do público do mês num dia comum")}
        </div>
        <h2 class="adm-kit-h2">Comunidade</h2>
        <div class="adm-kit-nums">
          ${kitNum(fmt(o.decks), "Decks publicados", "na galeria pública")}
          ${kitNum(fmt(o.public_profiles), "Perfis públicos", "coleções abertas pra visita")}
          ${kitNum(fmt(o.shares), "Links compartilhados", "coleções, fichários e decks")}
          ${kitNum(fmt(o.price_points), "Preços da comunidade", "cotações enviadas")}
        </div>
      </div>
      ${rodape(2)}
    </section>`;

    // ── Página 3: intenção de compra ────────────────────────────────────────
    const lojas = st.lojas || [];
    const cartas = (dm.top || []).slice(0, 10);
    const linhaCarta = (x, i) => {
      const nome = nameOf(x.game, x.card_id);
      const [titulo, ...resto] = nome ? nome.split(" · ") : [];
      return `<tr><td class="num adm-kit-pos">${i + 1}</td><td>${gameChip(x.game)}</td><td>${nome ? `<strong>${esc(titulo)}</strong>${resto.length ? ` <small>${esc(resto.join(" · "))}</small>` : ""}` : `<span class="adm-mono">${esc(x.card_id)}</span>`}</td><td class="num">${esc(fmt(x.views))}</td><td class="num">${esc(fmt(x.cliques))}</td><td class="num">${esc(fmt(x.desejos))}</td></tr>`;
    };
    const buscas = (dm.buscas_top || []).slice(0, 14);
    const p3 = `<section class="adm-kit-page">
      ${topo(3)}
      ${cab("03", "Intenção de compra", "Cada carta do Sleevu traz os links das lojas: o clique abre a busca daquela carta na loja. É tráfego de quem já sabe o que quer.")}
      <div class="adm-kit-corpo">
        <div class="adm-kit-nums">
          ${kitNum(fmt(st.total), "Cliques para lojas", `${fmt(st.pessoas)} pessoas em ${dias} dias`)}
          ${kitNum(fmt(st.br), "Para lojas brasileiras", st.total ? `${pctK(st.br, st.total)} dos cliques` : "")}
          ${kitNum(pctK(st.total, st.views_carta), "Taxa de saída", "cliques ÷ cartas abertas")}
          ${kitNum(compacto(st.valor, true), "Valor das cartas", st.com_valor ? `nos cliques · média de ${brl(st.valor / st.com_valor)}` : "somado nos cliques")}
        </div>
        <div class="adm-kit-grade2">
          ${kitCard("Cliques por loja", kitBarras(lojas.slice(0, 7).map((x) => ({ label: STORE[x.s] || x.s, sub: `${fmt(x.pessoas)} pessoas`, v: x.cliques, valor: fmt(x.cliques), cor: STORES_BR.indexOf(x.s) >= 0 ? KIT_CORES.vermelho : KIT_CORES.cinza })))
            + (lojas.length ? `<ul class="adm-kit-leg adm-kit-leg-linha"><li><span class="adm-kit-sw" style="background:${KIT_CORES.vermelho}"></span>Lojas brasileiras</li><li><span class="adm-kit-sw" style="background:${KIT_CORES.cinza}"></span>Internacionais</li></ul>` : ""))}
          ${kitCard("O que mais se busca", buscas.length ? `<ul class="adm-kit-buscas">${buscas.map((x) => `<li>${esc(x.q)}<b>${esc(fmt(x.n))}</b></li>`).join("")}</ul><p class="adm-kit-nota">Buscas que acharam carta, com o número de vezes no período.</p>` : `<p class="adm-kit-vazio">Sem dados no período.</p>`)}
        </div>
        ${kitCard("Cartas mais procuradas", cartas.length ? `<table class="adm-kit-tab"><thead><tr><th class="num">#</th><th>Jogo</th><th>Carta</th><th class="num">Visitas</th><th class="num">Cliques em loja</th><th class="num">Na wishlist</th></tr></thead><tbody>${cartas.map(linhaCarta).join("")}</tbody></table>
          <p class="adm-kit-nota">Ordem pelo índice de demanda: visitas + 5 × cliques em loja + 10 × contas com a carta na wishlist.</p>` : `<p class="adm-kit-vazio">Sem dados no período.</p>`)}
      </div>
      ${rodape(3)}
    </section>`;

    // ── Página 4: como trabalhar junto, metodologia e contato ───────────────
    const temVitrine = vt && typeof vt === "object" && vt.servidas > 0;
    const oferta = (titulo, texto, dado) => `<div class="adm-kit-oferta"><h3>${esc(titulo)}</h3><p>${esc(texto)}</p>${dado ? `<strong>${esc(dado)}</strong>` : ""}</div>`;
    // Audiência por jogo: é o que o anunciante escolhe ao segmentar a vitrine
    // (visitas e páginas) e o que a loja quer saber (clique e wishlist).
    const demJogo = {};
    (dm.jogos || []).forEach((x) => { demJogo[x.game] = x; });
    const porJogo = jogos.slice(0, 6).map((x) => {
      const d = demJogo[x.game] || {};
      return `<tr><td>${gameChip(x.game)}</td><td class="num">${esc(fmt(x.visitors))}</td><td class="num">${esc(fmt(x.views))}</td><td class="num">${esc(fmt(d.cliques || 0))}</td><td class="num">${esc(fmt(d.desejos || 0))}</td></tr>`;
    }).join("");
    const p4 = `<section class="adm-kit-page adm-kit-fim">
      ${topo(4)}
      ${cab("04", "Como trabalhar com o Sleevu", "Formatos que já funcionam hoje, medidos pelo mesmo sistema deste relatório.")}
      <div class="adm-kit-corpo">
        <div class="adm-kit-ofertas">
          ${oferta("Vitrine nas páginas de catálogo", "Faixa no feed de cartas, sets e busca e trilho lateral nas telas largas, segmentados por jogo, idioma e período — a semana de lançamento de um set, por exemplo. Nunca nas telas de coleção.",
            temVitrine ? `${fmt(vt.vistas)} espaços vistos em ${vt.days || dias} dias · ${pctK(vt.vistas, vt.servidas)} de visibilidade` : "")}
          ${oferta("Tráfego direto da carta pra loja", "Cada carta traz os links das lojas, e o clique abre a busca daquela carta. Nas lojas brasileiras o link leva utm_source=sleevu: a loja vê a origem no próprio analytics.",
            st.br ? `${fmt(st.br)} cliques para lojas brasileiras em ${dias} dias` : "")}
          ${oferta("Portal privado da loja", "Um link só-leitura com o que o Sleevu mandou pra sua loja: cliques, pessoas, valor das cartas, jogos e as cartas mais procuradas. Atualiza sozinho e pode ser revogado.", "")}
          ${oferta("Relatórios de demanda", "Quais cartas, sets e buscas estão em alta em cada jogo, cruzando visitas, cliques em loja e wishlists — em planilha, sob medida.", "")}
        </div>
        ${porJogo ? kitCard("Audiência por jogo, pra segmentar", `<table class="adm-kit-tab"><thead><tr><th>Jogo</th><th class="num">Visitantes</th><th class="num">Páginas vistas</th><th class="num">Cliques em loja</th><th class="num">Na wishlist</th></tr></thead><tbody>${porJogo}</tbody></table>`) : ""}
        <h2 class="adm-kit-h2">Como medimos</h2>
        <ul class="adm-kit-metodo">
          <li><strong>Medição própria, anônima e agregada.</strong> Os números vêm do próprio Sleevu, não de ferramenta de terceiros, e nenhum deles identifica uma pessoa.</li>
          <li><strong>Visitante é um navegador</strong> (identificador anônimo). Robôs e monitores ficam de fora; a mesma pessoa em dois aparelhos conta duas vezes.</li>
          <li><strong>Visitas e cliques são um piso.</strong> A medição vem ligada e dá pra desligar em Configurações: quem desliga não entra nessa conta.</li>
          <li><strong>Clique para loja</strong> é a saída da página da carta direto pra busca daquela carta na loja.</li>
          <li><strong>Retenção:</strong> D7 = voltou entre o 7º e o 13º dia depois da 1ª visita; D30 = entre o 30º e o 59º.</li>
          <li><strong>Valor em R$:</strong> o preço de mercado da carta (TCGplayer e Cardmarket) convertido pelo câmbio do dia, ou o preço que a pessoa anotou.</li>
        </ul>
      </div>
      <div class="adm-kit-contato">
        <div><h3>Vamos conversar?</h3><p>Parcerias, anúncios e dados sob medida.</p></div>
        <dl><div><dt>E-mail</dt><dd>${esc(KIT_CONTATO.email)}</dd></div><div><dt>Instagram</dt><dd>${esc(KIT_CONTATO.instagram)}</dd></div><div><dt>Site</dt><dd>${esc(KIT_CONTATO.site)}</dd></div></dl>
      </div>
      <footer class="adm-kit-rodape"><span>Projeto independente, sem afiliação com as empresas dos jogos; marcas e logos pertencem aos seus donos.</span><span>${KIT_PAGINAS} / ${KIT_PAGINAS}</span></footer>
    </section>`;

    return `<div class="adm-kit-barra">
        <div><strong>Kit para parceiros</strong><span>Prévia do PDF: A4, ${KIT_PAGINAS} páginas, com os números do período escolhido acima.</span></div>
        <button type="button" class="chip adm-primary" data-print>${ICON.print}<span>Imprimir / salvar PDF</span></button>
      </div>
      <div class="adm-kit-prev"><article class="adm-kit" aria-label="Kit para parceiros">${p1}${p2}${p3}${p4}</article></div>`;
  }

  // Prévia do kit: o documento é desenhado na largura do A4 e encolhe com zoom
  // pra caber na tela (celular). Na impressão o zoom volta a 1 (styles.css).
  function ajustaKit() {
    const kit = root.querySelector(".adm-kit");
    if (!kit) return;
    const larg = kit.parentElement ? kit.parentElement.clientWidth : KIT_LARGURA;
    const z = Math.min(1, larg / KIT_LARGURA);
    kit.style.zoom = z < 1 ? String(Math.floor(z * 1000) / 1000) : "";
  }
  // @page do kit: A4 sem margem (o kit tem as próprias) — e, sem margem, o
  // navegador também não carimba título, URL e data no papel. Vai num <style>
  // injetado só enquanto a aba está aberta: no styles.css valeria pra
  // impressão de qualquer página do site.
  function paginaDoKit(ligado) {
    let s = document.getElementById("admKitPage");
    if (ligado && !s) {
      s = document.createElement("style");
      s.id = "admKitPage";
      s.textContent = "@page { size: A4; margin: 0; }";
      document.head.appendChild(s);
    } else if (!ligado && s) s.remove();
  }
  // O "Salvar como PDF" sugere o <title> como nome do arquivo: sem a troca, o
  // kit ia pra loja como "Admin - Sleevu.pdf". Logo de jogo que ainda não
  // chegou sai em branco no papel, então espera as imagens (com teto).
  async function imprimeKit() {
    const kit = root.querySelector(".adm-kit");
    const imgs = kit ? Array.from(kit.querySelectorAll("img")) : [];
    await Promise.race([
      Promise.all(imgs.map((i) => (i.complete ? null : (i.decode ? i.decode().catch(() => null) : null)))),
      new Promise((res) => setTimeout(res, 2500))
    ]);
    const antes = document.title;
    document.title = `Sleevu - Kit para parceiros - ${new Date().toISOString().slice(0, 10)}`;
    window.addEventListener("afterprint", () => { document.title = antes; }, { once: true });
    window.print();
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
      </div>
      ${(() => {
        const ct = ((ret.contas || {}).taxas) || {};
        return section("Retenção por CONTA (junta celular e computador)", `<div class="admin-stats">
            ${stat("Contas na coorte", fmt(ct.coorte), "1ª visita logada nos últimos 120 dias")}
            ${stat("Voltam no dia seguinte", pct(ct.d1, ct.el1), "D1")}
            ${stat("Voltam na 2ª semana", pct(ct.d7, ct.el7), "D7")}
            ${stat("Voltam no 2º mês", pct(ct.d30, ct.el30), "D30")}
          </div>${cohortTable((ret.contas || {}).cohorts, "Semana da 1ª visita logada")}`,
          "A mesma conta em dois aparelhos é UMA pessoa aqui — nas taxas de cima (por navegador) ela conta duas vezes e cada aparelho parece 'não voltar'. Só vale pra quem entra logado, que é justamente o público que fica.");
      })()}`;
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
        ${stat("Valor encaminhado", brl(st.valor), `${brl(st.valor_br)} pras lojas BR`)}
        ${stat("Valor médio por clique", st.com_valor ? brl(st.valor / st.com_valor) : "—", `${fmt(st.com_valor)} cliques com preço`)}
      </div>
      ${section(`Cliques por dia (${st.days} dias)`, dailyBars(st.daily || [], Object.assign(CW(), { keyA: "br", keyB: "fora", labelA: "Lojas BR", labelB: "Internacionais", aria: "Cliques em lojas por dia" })))}
      <div class="adm-grid-2">
        ${section("Por loja", hbars(lojas.map((x) => ({ label: STORE[x.s] || x.s, value: x.cliques, sub: `${fmt(x.pessoas)} pessoas · ${fmt(x.cartas)} cartas · ${brl(x.valor)}`, color: STORES_BR.indexOf(x.s) >= 0 ? "var(--accent)" : "#9aa3ae" }))))}
        ${section("Loja × jogo", paged("lj", [{ t: "Loja" }, { t: "Jogo" }, { t: "Cliques", num: true }, { t: "Pessoas", num: true }],
          lj.map((x) => `<tr><td>${esc(STORE[x.s] || x.s)}</td><td>${gameChip(x.g)}</td><td class="num">${esc(fmt(x.cliques))}</td><td class="num">${esc(fmt(x.pessoas))}</td></tr>`), 8))}
      </div>
      ${section("Cartas que mais levam pra loja", paged("lt", [{ t: "Jogo" }, { t: "Carta" }, { t: "Cliques", num: true }, { t: "Pessoas", num: true }, { t: "Lojas BR", num: true }, { t: "Internacionais", num: true }, { t: "Valor da carta", num: true }],
        (st.top || []).map((x) => `<tr><td>${gameChip(x.game)}</td><td>${cardCell(x.game, x.card_id)}</td><td class="num">${esc(fmt(x.cliques))}</td><td class="num">${esc(fmt(x.pessoas))}</td><td class="num">${esc(fmt(x.br))}</td><td class="num">${esc(fmt(x.fora))}</td><td class="num">${esc(x.valor_carta ? brl(x.valor_carta) : "—")}</td></tr>`), 10),
        "Valor = preço da carta em R$ no momento do clique (o mesmo do preview: preço anotado ou o de mercado convertido). Clique antes da 2.1 não tem valor.")}
      ${section("Relatório para a loja", `<div class="adm-actions">${(brLojas.length ? brLojas : STORES_BR.map((s) => ({ s }))).map((x) => `<button type="button" class="chip" data-csv="${esc(x.s)}">${ICON.down}<span>CSV · ${esc(STORE[x.s] || x.s)}</span></button>`).join("")}<button type="button" class="chip" data-csv="*">${ICON.down}<span>CSV · todas</span></button></div>`,
        `Uma linha por carta: jogo, carta, cliques e pessoas no período. Cartas com menos de ${MIN_PESSOAS_CSV} pessoas entram somadas numa linha "outras" por jogo — relatório que sai daqui não pode permitir adivinhar o que uma pessoa específica procurou. Os links pras lojas BR levam utm_source=sleevu, então a loja também vê esse tráfego no analytics dela.`)}`;
  }

  // ── Vitrine: o espaço de anúncio (src/ads.js, migração 20260927a) ─────────
  // O id da aba é "anuncios", não "vitrine": a guarda 8 do check.mjs lê a
  // string "vitrine" como a classe .vitrine e exigiria a folha de CSS aqui.
  // Servida = o espaço entrou na página com um criativo; vista = metade dele
  // na tela por 1 s. Vistas ÷ servidas é a visibilidade que um anunciante
  // compra; páginas × vistas por página é o estoque que a fase 1 (AdSense) e
  // a venda direta vão vender. Ver docs/PLANO-ADS.md.
  const ESPACO = { f1: "1ª faixa do feed", f2: "2ª faixa do feed", f3: "3ª faixa do feed", t: "Trilho (tela ≥ 1888 px)" };
  function tabVitrine(vt, ap) {
    const heads = (primeira) => [{ t: primeira }, { t: "Servidas", num: true }, { t: "Vistas", num: true }, { t: "Visibilidade", num: true }, { t: "Cliques", num: true }, { t: "CTR", num: true }];
    const linha = (x, rotulo) => `<tr><td>${rotulo}</td><td class="num">${esc(fmt(x.servidas))}</td><td class="num">${esc(fmt(x.vistas))}</td><td class="num">${esc(pct(x.vistas, x.servidas))}</td><td class="num">${esc(fmt(x.cliques))}</td><td class="num">${esc(pct(x.cliques, x.vistas))}</td></tr>`;
    return `
      <div class="admin-stats">
        ${stat("Espaços vistos", fmt(vt.vistas), `${fmt(vt.servidas)} servidos`)}
        ${stat("Visibilidade", pct(vt.vistas, vt.servidas), "vistos ÷ servidos · meta acima de 70%")}
        ${stat("Cliques", fmt(vt.cliques), `CTR ${pct(vt.cliques, vt.vistas)}`)}
        ${stat("Páginas com vitrine", fmt(vt.paginas), `${fmt(vt.pessoas)} pessoas`)}
        ${stat("Vistos por página", vt.paginas ? (vt.vistas / vt.paginas).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—", "estoque por pageview")}
      </div>
      ${section(`Vistos e cliques por dia (${vt.days} dias)`, dailyBars(vt.daily || [], Object.assign(CW(), { keyA: "vistas", keyB: "cliques", labelA: "Vistos", labelB: "Cliques", aria: "Vitrine por dia" })))}
      <div class="adm-grid-2">
        ${section("Por criativo", table(heads("Criativo"), (vt.criativos || []).map((x) => linha(x, esc(x.c)))))}
        ${section("Por posição", table(heads("Posição"), (vt.espacos || []).map((x) => linha(x, esc(ESPACO[x.s] || x.s)))))}
      </div>
      <div class="adm-grid-2">
        ${section("Por página", table(heads("Página"), (vt.paginas_top || []).map((x) => linha(x, esc(pageName(x.path))))))}
        ${section("Por jogo", table(heads("Jogo"), (vt.jogos || []).map((x) => linha(x, gameChip(x.g)))),
          "CTR muito acima de 1–2% num espaço é sinal de clique acidental (espaço perto demais de botão), não de sucesso — é o que o Google pune na fase 1.")}
      </div>
      ${secaoApoiadores(ap)}`;
  }
  // Apoiador sem anúncio (20260928c; decisão 3 do plano): cada apoio de
  // R$ 10+ no Pix ou no Ko-fi = 30 dias sem anúncio, somando. A marcação é à
  // mão: quem apoiou manda o @ ou o e-mail da conta, e ele entra aqui.
  // undefined = a migração ainda não foi aplicada; null = falhou.
  function secaoApoiadores(ap) {
    if (ap === undefined) {
      return section("Apoiadores sem anúncio", `<p class="adm-banner">A RPC <code>admin_apoiadores</code> ainda não existe no banco: aplique <code>supabase/migrations/20260928c_apoiador.sql</code> no SQL Editor. Até lá ninguém fica sem anúncio (o site trata todo mundo como "não apoia").</p>`);
    }
    const lista = Array.isArray(ap) ? ap : [];
    const rows = lista.map((x) => `<tr><td>${esc(x.quem)}</td><td>${esc(dataBR(x.ate))}</td><td>${x.ativo ? "Sem anúncio" : "<small>Venceu</small>"}</td></tr>`);
    return `<div class="adm-grid-2">
      ${section("Marcar apoio", `<form class="adm-form" data-apoio-form>
          <label>E-mail ou @ da conta<input name="quem" required maxlength="120" placeholder="fulana@gmail.com ou @fulana" autocomplete="off"></label>
          <label>Dias sem anúncio<input name="dias" required inputmode="numeric" value="30" autocomplete="off"></label>
          <button type="submit" class="chip adm-primary">Somar dias</button>
        </form>
        <p class="admin-note" data-apoio-msg role="status" hidden></p>`,
        "R$ 10 ou mais (ou o mensal do Ko-fi) = 30 dias. Se a pessoa ainda está sem anúncio, os dias somam no fim; se já venceu, contam de hoje. 0 dias encerra hoje (pra desfazer engano). Vale na próxima página que a pessoa abrir, ou em até 1 h.")}
      ${section("Apoiadores (ativos e vencidos há até 60 dias)", ap === null ? `<p class="admin-empty">Não consegui carregar a lista.</p>` : table([{ t: "Conta" }, { t: "Sem anúncio até" }, { t: "" }], rows))}
    </div>`;
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
      ${section("Buscas mais feitas", paged("bt", [{ t: "Termo" }, { t: "Jogo" }, { t: "Vezes", num: true }, { t: "Pessoas", num: true }],
        (dm.buscas_top || []).map((x) => `<tr><td>${esc(x.q)}</td><td>${x.game ? gameChip(x.game) : "<small>todos</small>"}</td><td class="num">${esc(fmt(x.n))}</td><td class="num">${esc(fmt(x.pessoas))}</td></tr>`), 10),
        "O que o público procura ANTES de chegar na carta — nome de Pokémon, apelido, set. Começou a contar com a 2.1.")}
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
      o.valor = (o.valor || 0) + (x.valor || 0);
    });
    const rows = out.concat(Object.values(outras));
    const csv = toCsv(rows, [
      { t: "Loja", k: (r) => STORE[r.s] || r.s },
      { t: "Jogo", k: (r) => gameName(r.game) },
      { t: "Carta", k: (r) => (r.outras ? `(outras cartas, menos de ${MIN_PESSOAS_CSV} pessoas cada)` : (nameOf(r.game, r.card_id) || r.card_id)) },
      { t: "Id Sleevu", k: "card_id" },
      { t: "Cliques", k: "cliques" },
      { t: "Pessoas", k: (r) => (r.outras ? "" : r.pessoas) },
      { t: "Valor encaminhado (R$)", k: (r) => r.valor || 0 }
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
  // `teto` (2.1): a aba Sets resolve até 2.000 cartas pra agrupar por set;
  // as outras seguem com 400. Junto com o nome vem o set e a data de
  // lançamento (state.meta), que é o que a aba Sets usa.
  async function resolveNames(pares, teto) {
    if (!shared.loadOwnedAcrossGames) return false;
    const falta = {};
    let n = 0;
    const max = teto || 400;
    (pares || []).forEach((x) => {
      if (!x || !x.game || !x.card_id || n >= max) return;
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
        state.meta[`${g}:${c.id}`] = { set: c.set || "", release: c.setReleaseDate || c.releaseDate || "" };
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
    if (tab === "sets") {
      return (dm.cartas || []).map((x) => ({ game: x[0], card_id: x[1] }))
        .concat((dm.series || []).map((x) => ({ game: x[0], card_id: x[1] })));
    }
    return [];
  }

  // ══ Analytics 2.1 ═════════════════════════════════════════════════════════
  const brl = (v) => (v == null ? "—" : `R$ ${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`);
  const dur = (ms) => {
    if (ms == null) return "—";
    const s = Math.round(ms / 1000);
    if (s >= 3600) { const m = Math.round(s / 60); return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}min` : ""}`; }
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}min${s % 60 ? ` ${s % 60}s` : ""}`;
  };
  const dataBR = (d) => (d ? new Date(String(d).length === 10 ? d + "T12:00:00" : d).toLocaleDateString("pt-BR") : "—");
  const LOJAS_PORTAL = ["liga", "ligabra", "myp"];

  // Matriz de coorte (usada por visitante e por conta).
  function cohortTable(cohorts, rotulo) {
    if (!cohorts || !cohorts.length) return `<p class="admin-empty">Sem dados nas últimas 10 semanas.</p>`;
    const maxK = cohorts.reduce((m, c) => Math.max(m, (c.ret || []).length), 0);
    const heads = `<tr><th>${esc(rotulo || "Semana de entrada")}</th><th class="num">Pessoas</th>${Array.from({ length: Math.max(0, maxK - 1) }, (_, i) => `<th class="num">S${i + 1}</th>`).join("")}</tr>`;
    const rows = cohorts.slice().reverse().map((c) => {
      const base = (c.ret || [])[0] || 0;
      const cells = Array.from({ length: Math.max(0, maxK - 1) }, (_, i) => {
        const v = (c.ret || [])[i + 1];
        if (v == null) return `<td class="adm-heat"></td>`;
        const p = base ? v / base : 0;
        return `<td class="num adm-heat" style="--p:${Math.round(Math.min(0.55, p * 2) * 100)}%" title="${esc(`${fmt(v)} de ${fmt(base)}`)}">${esc(pct(v, base))}</td>`;
      }).join("");
      return `<tr><td>${esc(new Date(c.semana + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }))}</td><td class="num">${esc(fmt(base))}</td>${cells}</tr>`;
    }).join("");
    return `<div class="adm-scroll"><table class="admin-table adm-cohort"><thead>${heads}</thead><tbody>${rows}</tbody></table></div>`;
  }

  // ── P4 · Usuários ─────────────────────────────────────────────────────────
  const FAIXA_VALOR = ["Sem histórico de valor", "Até R$ 100", "R$ 100–500", "R$ 500–2 mil", "R$ 2–10 mil", "R$ 10–50 mil", "R$ 50 mil+"];
  const FAIXA_COPIAS = ["", "1–10 cópias", "11–50", "51–200", "201–1.000", "1.001–5.000", "5.000+"];
  const IDADE = ["", "Menos de 7 dias", "7–30 dias", "30–90 dias", "90+ dias"];
  const TAMANHO = ["", "Iniciante (até 49 cópias)", "Colecionador (50–499)", "Dedicado (500–2.999)", "Hardcore (3.000+)"];
  const PERFIL = {
    jogador: ["Jogador", "montou deck"], vendedor: ["Vendedor", "tem carta à venda ou vendida"],
    investidor: ["Investidor", "tem graduada ou anota custo"], cacador: ["Caçador", "20+ na wishlist ou preço-alvo"],
    multijogo: ["Multi-jogo", "coleciona 2+ jogos"], publico: ["Perfil público", "mostra a coleção pra todo mundo"]
  };
  const RECURSO = {
    desejos: "Wishlist", decks: "Decks", graded: "Graduadas", vendas: "Vendas", listas: "Listas",
    custos: "Custo pago", alvos: "Preço-alvo", manuais: "Selados/itens manuais", publico: "Perfil público"
  };

  function tabUsuarios(u) {
    const r = u.resumo || {};
    const fv = u.faixas_valor || [], fc = u.faixas_copias || [];
    const totV = fv.reduce((n, x) => n + (Number(x.valor) || 0), 0);
    const totN = fv.reduce((n, x) => n + x.n, 0);
    return `
      <div class="admin-stats">
        ${stat("Contas com coleção", fmt(r.contas), `${fmt(r.ativos)} ativas nos ${u.days} dias`)}
        ${stat("Valor catalogado", brl(r.valor_total), `${fmt(r.com_valor)} contas com histórico de valor`)}
        ${stat("Coleção mediana", brl(r.valor_mediano), `média ${brl(r.valor_medio)}`)}
        ${stat("Cópias por conta", fmt(r.copias_mediana), `mediana · média ${fmt(r.copias_media)}`)}
        ${stat("Jogos por conta", (r.jogos_medio == null ? "—" : Number(r.jogos_medio).toLocaleString("pt-BR")), "média")}
        ${stat("1% maiores coleções", pct(r.top1_valor, r.valor_total), "do valor total")}
        ${stat("10% maiores", pct(r.top10_valor, r.valor_total), "do valor total")}
      </div>
      ${section("Faixas de valor da coleção", table(
        [{ t: "Faixa" }, { t: "Contas", num: true }, { t: "% das contas", num: true }, { t: "Valor somado", num: true }, { t: "% do valor", num: true }, { t: "Ativas", num: true }, { t: "Cópias (média)", num: true }],
        fv.map((x) => `<tr><td>${esc(FAIXA_VALOR[x.fv] || x.fv)}</td><td class="num">${esc(fmt(x.n))}</td><td class="num">${esc(pct(x.n, totN))}</td><td class="num">${esc(brl(x.valor))}</td><td class="num">${esc(pct(x.valor, totV))}</td><td class="num">${esc(pct(x.ativos, x.n))}</td><td class="num">${esc(fmt(x.copias_media))}</td></tr>`)),
        "Valor = último ponto do histórico do Portfólio de cada jogo (R$, cartas + graduadas), gravado no dia em que a pessoa abriu o app pela última vez — não é o valor de hoje. \"Sem histórico\" = conta que nunca abriu Portfólio/Dashboard depois de ter coleção.")}
      <div class="adm-grid-2">
        ${section("Tamanho da coleção", table(
          [{ t: "Cópias" }, { t: "Contas", num: true }, { t: "Valor", num: true }, { t: "Ativas", num: true }],
          fc.map((x) => `<tr><td>${esc(FAIXA_COPIAS[x.fc] || x.fc)}</td><td class="num">${esc(fmt(x.n))}</td><td class="num">${esc(brl(x.valor))}</td><td class="num">${esc(pct(x.ativos, x.n))}</td></tr>`)))}
        ${section("Idade da conta", table(
          [{ t: "Conta criada há" }, { t: "Contas", num: true }, { t: "Cópias (mediana)", num: true }, { t: "Valor (mediana)", num: true }, { t: "Ativas", num: true }],
          (u.idade || []).map((x) => `<tr><td>${esc(IDADE[x.k] || x.k)}</td><td class="num">${esc(fmt(x.n))}</td><td class="num">${esc(fmt(x.copias_mediana))}</td><td class="num">${esc(brl(x.valor_mediano))}</td><td class="num">${esc(pct(x.ativos, x.n))}</td></tr>`)),
          "Mostra se a coleção cresce com o tempo de casa — ou se quem chega já chega com tudo (importação).")}
      </div>
      <div class="adm-grid-3">
        ${section("Jogos por conta", donut((u.jogos_n || []).map((x, i) => ({ label: x.k >= 4 ? "4+ jogos" : `${x.k} jogo${x.k > 1 ? "s" : ""}`, value: x.n, color: colorAt(i) })), { aria: "Contas por número de jogos" }),
          (u.jogos_n || []).map((x) => `${x.k >= 4 ? "4+" : x.k}: ${brl(x.valor_medio)} em média`).join(" · "))}
        ${section("Jogos mais colecionados", hbars((u.por_jogo || []).map((x) => ({ label: gameName(x.game), value: x.usuarios, color: gameColor(x.game) }))))}
        ${section("Combinações mais comuns", hbars((u.combos || []).map((x) => ({ label: x.combo.split("+").map(gameName).join(" + "), value: x.n }))))}
      </div>`;
  }

  function tabColecoes(u) {
    const dm = u.dormentes || {};
    const rows = (u.top || []).map((x, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td><span class="adm-mono">${esc(x.id)}</span>${x.handle ? `<br><a href="/users/${esc(encodeURIComponent(x.handle))}">@${esc(x.handle)}</a>` : ""}</td>
      <td><span class="adm-games">${(x.jogos || []).map(gameChip).join("")}</span></td>
      <td class="num"><strong>${esc(brl(x.valor))}</strong>${x.valor_graded ? `<br><small>${esc(brl(x.valor_graded))} graduadas</small>` : ""}</td>
      <td class="num">${esc(fmt(x.copias))}<br><small>${esc(fmt(x.distintas))} distintas</small></td>
      <td class="num">${esc(fmt(x.desejos))}</td>
      <td class="num">${esc(fmt(x.decks))}</td>
      <td class="num">${esc(fmt((x.vendas || 0) + (x.vendidas || 0)))}</td>
      <td>${x.ativo ? `<span class="adm-ok">ativa</span>` : `<small>${esc(dataBR(x.ultimo_login))}</small>`}</td>
      <td><small>${esc(dataBR(x.desde))}</small></td>
    </tr>`);
    return `
      <div class="admin-stats">
        ${stat("Maiores coleções", fmt((u.top || []).length), "ordenadas por valor")}
        ${stat("Dormentes de valor", fmt(dm.n), `${brl(dm.valor)} parados — R$ 2 mil+ sem visita há 30+ dias`)}
      </div>
      ${section("Maiores coleções", paged("colecoes", [
        { t: "#", num: true }, { t: "Conta" }, { t: "Jogos" }, { t: "Valor", num: true }, { t: "Cópias", num: true },
        { t: "Wishlist", num: true }, { t: "Decks", num: true }, { t: "Vendas", num: true }, { t: "Atividade" }, { t: "Desde" }
      ], rows, 20),
        "Identificação mínima de propósito: 8 caracteres do id da conta (pra reconhecer a mesma entre uma visita e outra ao painel) e o @ só quando o perfil é público. E-mail não aparece — pra entender comportamento não precisa, e painel que mostra e-mail é painel que vaza e-mail. \"Atividade\" = visitou logado no período; senão, o último login.")}`;
  }

  function tabSegmentos(u) {
    const r = u.resumo || {}, tm = u.tamanho || [];
    const totN = tm.reduce((n, x) => n + x.n, 0), totV = tm.reduce((n, x) => n + (Number(x.valor) || 0), 0);
    const pc = r.pct || {};
    return `
      ${section("Por tamanho (cada conta em uma faixa)", table(
        [{ t: "Segmento" }, { t: "Contas", num: true }, { t: "% das contas", num: true }, { t: "Valor", num: true }, { t: "% do valor", num: true }, { t: "Ativas", num: true }, { t: "Jogos (média)", num: true }],
        tm.map((x) => `<tr><td>${esc(TAMANHO[x.k] || x.k)}</td><td class="num">${esc(fmt(x.n))}</td><td class="num">${esc(pct(x.n, totN))}</td><td class="num">${esc(brl(x.valor))}</td><td class="num">${esc(pct(x.valor, totV))}</td><td class="num">${esc(pct(x.ativos, x.n))}</td><td class="num">${esc(x.jogos_medio == null ? "—" : String(x.jogos_medio).replace(".", ","))}</td></tr>`)),
        "Poucos hardcore concentrando o valor é o normal de colecionismo — o que importa é a faixa do meio crescer e continuar ativa.")}
      ${section("Perfis de uso (uma conta pode ter vários)", table(
        [{ t: "Perfil" }, { t: "Critério" }, { t: "Contas", num: true }, { t: "% das contas", num: true }, { t: "Valor", num: true }, { t: "Ativas", num: true }],
        (u.perfis || []).map((x) => `<tr><td><strong>${esc((PERFIL[x.k] || [x.k])[0])}</strong></td><td><small>${esc((PERFIL[x.k] || ["", ""])[1])}</small></td><td class="num">${esc(fmt(x.n))}</td><td class="num">${esc(pct(x.n, r.contas))}</td><td class="num">${esc(brl(x.valor))}</td><td class="num">${esc(pct(x.ativos, x.n))}</td></tr>`)),
        "Vendedor e investidor são o público de loja; caçador é quem compra (wishlist); jogador é quem monta deck e volta toda semana.")}
      ${section("Quem usa cada recurso", hbars(Object.keys(RECURSO).map((k) => ({ label: RECURSO[k], value: r.contas ? Math.round((100 * (pc[k] || 0)) / r.contas) : 0, sub: `${fmt(pc[k] || 0)} contas` })).sort((a, b) => b.value - a.value), { max: 100, suffix: "%" }))}`;
  }

  // ── P1 · Tempo de uso ────────────────────────────────────────────────────
  function tabTempo(e) {
    const t = e.tempo || {}, bs = e.buscas || {};
    const FAIXA = ["", "até 10s", "10s–1min", "1–5min", "5–15min", "15min+"];
    const faixas = [1, 2, 3, 4, 5].map((k) => ({ label: FAIXA[k], value: ((t.faixas || []).find((x) => x.ord === k) || {}).n || 0 }));
    return `
      <div class="admin-stats">
        ${stat("Visita mediana", dur(t.mediana_ms), "metade das visitas dura mais que isso")}
        ${stat("Visita média", dur(t.media_ms), `10% passam de ${dur(t.p90_ms)}`)}
        ${stat("Páginas por visita", t.paginas_visita == null ? "—" : String(t.paginas_visita).replace(".", ","))}
        ${stat("Visitas por pessoa", t.visitas_por_pessoa == null ? "—" : String(t.visitas_por_pessoa).replace(".", ","), `nos ${e.days} dias`)}
        ${stat("Visitas medidas", fmt(t.visitas))}
        ${stat("Buscas que acharam", pct(bs.achou, (bs.achou || 0) + (bs.vazia || 0)), `${fmt(bs.vazia)} sem resultado`)}
      </div>
      <div class="adm-grid-2">
        ${section("Duração das visitas", columns(faixas, Object.assign(CWS(), { aria: "Visitas por faixa de duração" })))}
        ${section("Por aparelho", table([{ t: "Aparelho" }, { t: "Visitas", num: true }, { t: "Mediana", num: true }],
          (t.por_aparelho || []).map((x) => `<tr><td>${esc(DEVICE[x.dv] || x.dv)}</td><td class="num">${esc(fmt(x.visitas))}</td><td class="num">${esc(dur(x.mediana_ms))}</td></tr>`)))}
      </div>
      ${section("Onde o tempo é gasto", paged("tempo-pg", [{ t: "Página" }, { t: "Vistas", num: true }, { t: "Mediana por vista", num: true }, { t: "Tempo total", num: true }],
        (t.por_pagina || []).map((x) => `<tr><td>${esc(pageName(x.path))}</td><td class="num">${esc(fmt(x.vistas))}</td><td class="num">${esc(dur(x.mediana_ms))}</td><td class="num">${esc(dur(x.total_ms))}</td></tr>`), 10),
        "Tempo VISÍVEL: aba em segundo plano não conta, e uma página esquecida aberta é cortada em 30 minutos. Uma visita = páginas do mesmo navegador sem pausa de 30 minutos. Página vista por menos de 2 segundos não é registrada.")}`;
  }

  // ── P2 · Campanhas (custo × resultado) ───────────────────────────────────
  function tabCampanhas(c) {
    const camp = c.campanhas || [];
    const por = (custo, n) => (custo > 0 && n > 0 ? brl(custo / n) : "—");
    const rows = camp.map((x) => `<tr><td><strong>${esc(x.fonte)}</strong>${x.campanha ? `<br><small>${esc(x.campanha)}</small>` : ""}</td><td><small>${esc(dataBR(x.desde))}</small></td>
      <td class="num">${esc(fmt(x.visitantes))}</td><td class="num">${esc(fmt(x.ativados))} <small>${esc(pct(x.ativados, x.visitantes))}</small></td>
      <td class="num">${esc(fmt(x.contas))} <small>${esc(pct(x.contas, x.visitantes))}</small></td><td class="num">${esc(x.el7 ? pct(x.d7, x.el7) : "—")}</td>
      <td class="num">${esc(x.custo == null ? "—" : brl(x.custo))}</td><td class="num">${esc(por(x.custo, x.visitantes))}</td><td class="num"><strong>${esc(por(x.custo, x.ativados))}</strong></td><td class="num">${esc(por(x.custo, x.contas))}</td></tr>`);
    const custos = (c.custos || []).map((x) => `<tr><td>${esc(x.fonte)}${x.campanha ? ` / ${esc(x.campanha)}` : ""}</td><td class="num">${esc(brl(x.valor))}</td><td><small>${esc(x.nota || "")}</small></td><td><small>${esc(dataBR(x.created_at))}</small></td><td><button type="button" class="chip adm-mini" data-camp-del="${esc(x.id)}" aria-label="Apagar este custo">Apagar</button></td></tr>`);
    return `
      ${section("Anotar custo de campanha", `<form class="adm-form" data-camp-form>
          <label>Fonte (utm_source)<input name="fonte" required maxlength="30" placeholder="instagram" autocomplete="off"></label>
          <label>Campanha (utm_campaign)<input name="campanha" maxlength="30" placeholder="lancamento-151" autocomplete="off"></label>
          <label>Valor gasto (R$)<input name="valor" required inputmode="decimal" placeholder="150,00" autocomplete="off"></label>
          <label>Nota<input name="nota" maxlength="200" placeholder="opcional" autocomplete="off"></label>
          <button type="submit" class="chip adm-primary">Salvar custo</button>
        </form>`,
        "Pra uma campanha aparecer aqui, o link dela precisa levar ?utm_source=…&utm_campaign=… (ex.: sleevu.app/?utm_source=instagram&utm_campaign=lancamento-151). Custo anotado várias vezes pra mesma campanha soma.")}
      ${section("Resultado por campanha (desde sempre)", paged("camp", [
        { t: "Fonte / campanha" }, { t: "Desde" }, { t: "Visitantes", num: true }, { t: "Ativaram", num: true }, { t: "Conta", num: true },
        { t: "D7", num: true }, { t: "Custo", num: true }, { t: "Por visitante", num: true }, { t: "Por ativação", num: true }, { t: "Por conta", num: true }
      ], rows, 10), "Custo por ATIVAÇÃO (1ª carta na coleção) é o número que decide se vale continuar pagando: visitante que não ativa não volta.")}
      ${section("Custos anotados", table([{ t: "Campanha" }, { t: "Valor", num: true }, { t: "Nota" }, { t: "Anotado em" }, { t: "" }], custos))}`;
  }

  // ── P3 · Experimentos ────────────────────────────────────────────────────
  function tabExperimentos(x) {
    const lista = Array.isArray(x) ? x : [];
    if (!lista.length) {
      return section("Nenhum experimento rodando", `<p class="admin-note">Um experimento é uma variante sorteada por navegador e medida contra ativação, conta, clique em loja e retorno. Pra criar um, no código da página:</p>
        <pre class="adm-code">const v = TCGShared.experimento("home_cta", ["a", "b"]);
if (v === "b") { /* versão nova */ }</pre>
        <p class="admin-note">A variante fica guardada no navegador (a pessoa não pula entre versões) e aparece aqui assim que alguém a vê.</p>`);
    }
    const porExp = {};
    lista.forEach((r) => { (porExp[r.e] = porExp[r.e] || []).push(r); });
    return Object.keys(porExp).map((e) => {
      const vs = porExp[e];
      const base = vs[0];
      const taxa = (a, b) => (b ? a / b : null);
      const dif = (r, k, den) => {
        if (r === base) return "";
        const a = taxa(r[k], r[den]), b = taxa(base[k], base[den]);
        if (a == null || b == null || !b) return "";
        return ` <small class="${a >= b ? "adm-ok" : "adm-bad"}">${sinal((a - b) / b)}</small>`;
      };
      const pouco = vs.some((r) => r.pessoas < 100);
      return section(`Experimento "${e}"`, table(
        [{ t: "Variante" }, { t: "Pessoas", num: true }, { t: "Ativaram", num: true }, { t: "Conta", num: true }, { t: "Clicou em loja", num: true }, { t: "D7", num: true }, { t: "Desde" }],
        vs.map((r) => `<tr><td><strong>${esc(r.v)}</strong>${r === base ? " <small>(base)</small>" : ""}</td><td class="num">${esc(fmt(r.pessoas))}</td>
          <td class="num">${esc(pct(r.ativou, r.pessoas))}${dif(r, "ativou", "pessoas")}</td><td class="num">${esc(pct(r.conta, r.pessoas))}${dif(r, "conta", "pessoas")}</td>
          <td class="num">${esc(pct(r.loja, r.pessoas))}${dif(r, "loja", "pessoas")}</td><td class="num">${esc(r.el7 ? pct(r.d7, r.el7) : "—")}${dif(r, "d7", "el7")}</td>
          <td><small>${esc(dataBR(r.inicio))}</small></td></tr>`)),
        pouco ? "Menos de 100 pessoas em alguma variante: diferença aqui ainda é sorte, não resultado. Espere juntar mais antes de decidir." : "Diferença relativa contra a variante base. Conta só o que a pessoa fez DEPOIS de ver a variante.");
    }).join("");
  }

  // ── P3 · Portal da loja (links privados) ─────────────────────────────────
  function tabPortal(links, st) {
    const lista = Array.isArray(links) ? links : [];
    const base = `${location.origin}/parceiro?t=`;
    const porLoja = {};
    (st.lojas || []).forEach((x) => { porLoja[x.s] = x; });
    const rows = lista.map((l) => {
      const ativo = !l.revoked_at;
      return `<tr><td><strong>${esc(STORE[l.loja] || l.loja)}</strong>${l.rotulo ? `<br><small>${esc(l.rotulo)}</small>` : ""}</td>
        <td><small>${esc(dataBR(l.created_at))}</small></td><td class="num">${esc(fmt(l.views))}</td><td><small>${esc(l.last_seen_at ? new Date(l.last_seen_at).toLocaleString("pt-BR") : "nunca aberto")}</small></td>
        <td>${ativo ? `<span class="adm-ok">ativo</span>` : `<span class="adm-bad">revogado</span>`}</td>
        <td>${ativo ? `<div class="adm-row-actions"><button type="button" class="chip adm-mini" data-portal-copy="${esc(base + l.token)}">Copiar link</button><button type="button" class="chip adm-mini" data-portal-revoke="${esc(l.id)}">Revogar</button></div>` : ""}</td></tr>`;
    });
    return `
      ${section("Criar link para uma loja", `<form class="adm-form" data-portal-form>
          <label>Loja<select name="loja">${LOJAS_PORTAL.map((s) => `<option value="${s}">${esc(STORE[s])}</option>`).join("")}</select></label>
          <label>Rótulo<input name="rotulo" maxlength="60" placeholder="ex.: Liga — contato comercial" autocomplete="off"></label>
          <button type="submit" class="chip adm-primary">Criar link</button>
        </form><p class="adm-portal-novo" data-portal-novo hidden></p>`,
        "A loja abre sleevu.app/parceiro?t=… e vê só o tráfego que o Sleevu mandou pra ELA: cliques, pessoas, valor das cartas, jogos e as cartas mais procuradas (carta com menos de 3 pessoas entra somada em \"outras\"). Quem tem o link vê — mande só pra quem deve ver, e revogue quando a conversa acabar.")}
      ${section("Links criados", table([{ t: "Loja" }, { t: "Criado" }, { t: "Acessos", num: true }, { t: "Último acesso" }, { t: "Status" }, { t: "" }], rows))}
      ${section(`O que cada loja veria agora (${st.days} dias)`, table([{ t: "Loja" }, { t: "Cliques", num: true }, { t: "Pessoas", num: true }, { t: "Valor encaminhado", num: true }],
        LOJAS_PORTAL.map((s) => { const x = porLoja[s] || {}; return `<tr><td>${esc(STORE[s])}</td><td class="num">${esc(fmt(x.cliques || 0))}</td><td class="num">${esc(fmt(x.pessoas || 0))}</td><td class="num">${esc(brl(x.valor || 0))}</td></tr>`; })))}`;
  }

  // ── P2 · Demanda por set e lançamentos ───────────────────────────────────
  function tabSets(dm) {
    const cartas = dm.cartas || [];
    const porSet = new Map();
    let semSet = 0;
    cartas.forEach(([g, id, views, cliques, desejos]) => {
      const m = state.meta[`${g}:${id}`];
      if (!m || !m.set) { semSet += 1; return; }
      const k = `${g}|${m.set}`;
      const o = porSet.get(k) || { game: g, set: m.set, release: m.release, cartas: 0, views: 0, cliques: 0, desejos: 0 };
      o.cartas += 1; o.views += views; o.cliques += cliques; o.desejos += desejos;
      porSet.set(k, o);
    });
    const sets = Array.from(porSet.values()).map((o) => Object.assign(o, { indice: o.views + 5 * o.cliques + 10 * o.desejos })).sort((a, b) => b.indice - a.indice);
    const resolvendo = cartas.length && state.metaPendente;
    // Lançamentos: sets com data nos últimos 60 dias, views por dia somadas.
    const ini = dm.series_ini ? new Date(dm.series_ini + "T12:00:00") : null;
    const limite = Date.now() - 60 * 86400000;
    const serieSet = new Map();
    (dm.series || []).forEach(([g, id, serie]) => {
      const m = state.meta[`${g}:${id}`];
      if (!m || !m.set || !m.release || new Date(m.release).getTime() < limite) return;
      const k = `${g}|${m.set}`;
      const s = serieSet.get(k) || { label: `${m.set} (${gameName(g)})`, vals: new Array((serie || []).length).fill(0) };
      (serie || []).forEach((v, i) => { s.vals[i] += Number(v) || 0; });
      serieSet.set(k, s);
    });
    const lanc = Array.from(serieSet.values()).sort((a, b) => b.vals.reduce((x, y) => x + y, 0) - a.vals.reduce((x, y) => x + y, 0)).slice(0, 4);
    const daily = ini && lanc.length ? lanc[0].vals.map((_, i) => {
      const d = new Date(ini.getTime() + i * 86400000);
      const o = { day: d.toISOString().slice(0, 10) };
      lanc.forEach((s, j) => { o[`s${j}`] = s.vals[i]; });
      return o;
    }) : [];
    return `
      ${resolvendo ? `<p class="admin-note">Resolvendo o set de ${fmt(cartas.length)} cartas no catálogo…</p>` : ""}
      ${section("Demanda por set", paged("sets", [{ t: "Jogo" }, { t: "Set" }, { t: "Lançado" }, { t: "Cartas com procura", num: true }, { t: "Views", num: true }, { t: "Cliques em loja", num: true }, { t: "Na wishlist", num: true }, { t: "Índice", num: true }],
        sets.map((o) => `<tr><td>${gameChip(o.game)}</td><td>${esc(o.set)}</td><td><small>${esc(o.release ? dataBR(o.release) : "—")}</small></td><td class="num">${esc(fmt(o.cartas))}</td><td class="num">${esc(fmt(o.views))}</td><td class="num">${esc(fmt(o.cliques))}</td><td class="num">${esc(fmt(o.desejos))}</td><td class="num"><strong>${esc(fmt(o.indice))}</strong></td></tr>`), 15),
        `Soma das ${fmt(cartas.length)} cartas com mais procura no período, agrupadas pelo set no catálogo${semSet ? ` (${fmt(semSet)} não acharam set — id antigo ou fora do catálogo)` : ""}. Índice = views + 5 × cliques em loja + 10 × wishlist.`)}
      ${section("Lançamentos: procura nos primeiros dias", daily.length
        ? lines(daily, lanc.map((s, j) => ({ key: `s${j}`, label: s.label, color: colorAt(j) })), Object.assign(CW(), { aria: "Views por dia dos sets lançados nos últimos 60 dias" }))
        : `<p class="admin-empty">Nenhum set lançado nos últimos 60 dias entre as cartas mais vistas.</p>`,
        "Views por dia (45 dias) das cartas dos sets lançados nos últimos 60 dias — a curva de interesse de um lançamento: pico, meia-vida e quando estabiliza.")}`;
  }

  // ── P1 · Medição: alarmes, consentimento, retenção de dados ─────────────
  const ALVO = {
    pageview: "Visitas", store_click: "Cliques em loja (todas)", scan_open: "Scanner aberto", scan_done: "Scanner fechado",
    card_added: "Cartas cadastradas", collection_first: "Ativações", signup: "Contas novas", login_gate: "Portão de login",
    search_empty: "Busca sem resultado", search_hit: "Busca com resultado", share_open: "Link aberto", share_created: "Link criado",
    page_time: "Tempo de página", onboard_state: "Primeiros passos", exp_view: "Experimentos", ad_view: "Vitrine vista", ad_click: "Vitrine clicada",
    pwa_install: "App instalado", export_done: "Exportações", import_done: "Importações", deck_created: "Decks criados", backup_done: "Backups"
  };
  function tabMedicao(h, e) {
    const alvos = (h.alvos || []).slice().sort((a, b) => (b.alerta - a.alerta) || (b.media_dia - a.media_dia));
    const cs = (e && e.consentimento) || {};
    const medidos = cs.visitantes_total || 0, recusas = (cs.recusou_total || 0) - (cs.reativou_total || 0);
    const cobertura = medidos ? medidos / (medidos + Math.max(0, recusas)) : null;
    const nome = (a) => { const [n, s] = String(a).split(":"); return s ? `Cliques em loja · ${STORE[s] || s}` : (ALVO[n] || n); };
    return `
      <div class="admin-stats">
        ${stat("Alarmes", fmt(alvos.filter((a) => a.alerta).length), "evento que zerou há 48h")}
        ${stat("Cobertura estimada", cobertura == null ? "—" : pct(cobertura, 1), "dos navegadores com medição ligada")}
        ${stat("Desligaram a medição", fmt(cs.recusou_total), cs.desde ? `desde ${dataBR(cs.desde)} · ${fmt(cs.reativou_total)} religaram` : "sem registro ainda")}
        ${stat("Eventos guardados", fmt(h.eventos_total), h.eventos_mais_antigo ? `desde ${dataBR(h.eventos_mais_antigo)}` : "")}
        ${stat("Agendamento (pg_cron)", h.cron === "ligado" ? "ligado" : "desligado", h.cron === "ligado" ? "retrato, resumo e limpeza automáticos" : "o painel completa a série ao abrir")}
      </div>
      ${section("Eventos: chegando ou parados?", paged("sentinela", [{ t: "Evento" }, { t: "Últimas 48h", num: true }, { t: "Média/dia (14 dias antes)", num: true }, { t: "Último" }, { t: "Status" }],
        alvos.map((a) => `<tr><td>${esc(nome(a.alvo))}</td><td class="num">${esc(fmt(a.ultimas48h))}</td><td class="num">${esc(String(a.media_dia).replace(".", ","))}</td><td><small>${esc(a.ultimo ? new Date(a.ultimo).toLocaleString("pt-BR") : "—")}</small></td><td>${a.alerta ? `<span class="adm-bad">parou</span>` : `<span class="adm-ok">ok</span>`}</td></tr>`), 12),
        "Alarme = chegava 3+ por dia e zerou nas últimas 48h. Quase sempre é medição quebrada (nome fora da whitelist, migração faltando, busca de uma loja que mudou), não falta de uso. O healthcheck diário do GitHub checa a mesma coisa e manda e-mail quando dispara.")}
      ${section("Consentimento", `<div class="admin-stats">
          ${stat("Desligaram no período", fmt(cs.recusou), `${fmt(cs.reativou)} religaram`)}
          ${stat("Visitantes medidos no período", fmt(cs.visitantes))}
        </div>`,
        "A medição é ligada por padrão e dá pra desligar em Configurações. Quem desliga some do painel — então todo número aqui é um PISO. Cobertura estimada = visitantes medidos ÷ (medidos + quem desligou). Não pega quem bloqueia por extensão, então a real é um pouco menor.")}
      ${section("Retenção dos dados", `<ul class="adm-list">
          <li>Último retrato diário (série de crescimento): <strong>${esc(dataBR(h.metrics_ultimo))}</strong></li>
          <li>Último resumo diário dos eventos: <strong>${esc(dataBR(h.rollup_ultimo))}</strong></li>
          <li>Evento bruto mais antigo guardado: <strong>${esc(dataBR(h.eventos_mais_antigo))}</strong></li>
        </ul>`,
        "O evento bruto (com o id anônimo do navegador) fica 13 meses; depois sobra só o resumo por dia e a série de crescimento. A limpeza roda no dia 1 de cada mês pelo pg_cron. Efeito colateral: quem volta depois de 13+ meses sem visitar conta como visitante novo.")}`;
  }

  const RENDER = {
    geral: (x) => tabGeral(x.dash), audiencia: (x) => tabAudiencia(x.dash), conteudo: (x) => tabConteudo(x.dash),
    produto: (x) => tabProduto(x.dash), qualidade: (x) => tabQualidade(x.dash),
    crescimento: (x) => tabCrescimento(x.growth),
    parceiros: (x) => tabParceiros(x.dash, x.retention, x.stores, x.demand, x.growth, x.engagement, x.users, x.anuncios),
    canais: (x) => tabCanais(x.retention, x.growth), retencao: (x) => tabRetencao(x.retention),
    funil: (x) => tabFunil(x.funnel, x.retention, x.engagement), lojas: (x) => tabLojas(x.stores), demanda: (x) => tabDemanda(x.demand),
    anuncios: (x) => tabVitrine(x.anuncios, x.apoiadores),
    usuarios: (x) => tabUsuarios(x.users), colecoes: (x) => tabColecoes(x.users), segmentos: (x) => tabSegmentos(x.users),
    campanhas: (x) => tabCampanhas(x.campaigns), tempo: (x) => tabTempo(x.engagement),
    experimentos: (x) => tabExperimentos(x.experiments), portal: (x) => tabPortal(x.partners, x.stores),
    sets: (x) => tabSets(x.demand), medicao: (x) => tabMedicao(x.health, x.engagement)
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
      : shared.adminRpc(RPC[key], days, SEM_DIAS.indexOf(key) >= 0 ? {} : undefined)
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
    demand: "20260923a_analytics_v2.sql", growth: "20260923a_analytics_v2.sql",
    anuncios: "20260927a_vitrine.sql", apoiadores: "20260928c_apoiador.sql",
    users: "20260928a_analytics_2_1.sql", campaigns: "20260928a_analytics_2_1.sql", engagement: "20260928a_analytics_2_1.sql",
    experiments: "20260928a_analytics_2_1.sql", partners: "20260928a_analytics_2_1.sql", health: "20260928a_analytics_2_1.sql"
  };
  function pendente(keys) {
    const arqs = Array.from(new Set(keys.map((k) => MIGRACAO[k])));
    const rpcs = keys.map((k) => (k === "dash" ? "admin_dashboard" : k === "funnel" ? "admin_funnel" : RPC[k]));
    const v21 = keys.some((k) => MIGRACAO[k] === "20260928a_analytics_2_1.sql");
    const descartados = keys.indexOf("anuncios") >= 0
      ? "Enquanto a 20260927a não for aplicada, os eventos da vitrine (espaço visto, espaço clicado) são descartados pelo banco sem erro"
      : v21
        ? "Enquanto a 20260928a não for aplicada, os eventos da 2.1 (tempo de página, busca com resultado, primeiros passos, experimentos) são descartados pelo banco sem erro"
        : "Enquanto a 20260923a não for aplicada, os eventos novos (clique em loja, conta nova, busca vazia, link aberto, app instalado) são descartados pelo banco sem erro";
    return `<p class="adm-banner">${rpcs.map((r) => `A RPC <code>${esc(r)}</code> ainda não existe no banco`).join("; ")}: aplique <code>supabase/migrations/${arqs.map(esc).join("</code>, <code>supabase/migrations/")}</code> no SQL Editor. <strong>${descartados}</strong> — aplique o SQL ANTES de subir o JS.</p>`;
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
      imprimeKit();
    } else if (t.dataset.campDel) {
      if (!window.confirm("Apagar este custo anotado?")) return;
      escreve("admin_campaign_delete", { p_id: Number(t.dataset.campDel) }, ["campaigns"]);
    } else if (t.dataset.portalRevoke) {
      if (!window.confirm("Revogar este link? A loja deixa de ver o painel na hora.")) return;
      escreve("admin_partner_link_revoke", { p_id: Number(t.dataset.portalRevoke) }, ["partners"]);
    } else if (t.dataset.portalCopy) {
      const url = t.dataset.portalCopy;
      const ok = () => { t.textContent = "Copiado"; setTimeout(() => { t.textContent = "Copiar link"; }, 1500); };
      // Sem clipboard (http, permissão negada): caixa "copie daqui".
      const manual = () => shared.caixaDeTexto && shared.caixaDeTexto({ titulo: "Copie o link", valor: url, leitura: true });
      try { navigator.clipboard.writeText(url).then(ok, manual); } catch (err) { manual(); }
    }
  }
  // Escrita no painel (custo de campanha, link de loja): chama a RPC, joga
  // fora o cache das RPCs afetadas e repinta.
  async function escreve(nome, body, invalida) {
    const r = await shared.adminRpc(nome, 0, body);
    Object.keys(state.cache).forEach((k) => { if (invalida.some((i) => k.indexOf(`${i}:`) === 0)) delete state.cache[k]; });
    await render();
    return r;
  }
  function onSubmit(e) {
    const f = e.target;
    if (f.matches("[data-camp-form]")) {
      e.preventDefault();
      const valor = Number(String(f.valor.value || "").replace(/\./g, "").replace(",", "."));
      if (!f.fonte.value.trim() || !(valor >= 0)) return;
      escreve("admin_campaign_save", { p_fonte: f.fonte.value, p_campanha: f.campanha.value, p_valor: valor, p_nota: f.nota.value || null }, ["campaigns"]);
    } else if (f.matches("[data-apoio-form]")) {
      e.preventDefault();
      const quem = String(f.quem.value || "").trim();
      const dias = Number(String(f.dias.value || "").trim());
      if (!quem || !Number.isInteger(dias) || dias < 0 || dias > 366) return;
      escreve("admin_apoiador", { p_quem: quem, p_dias: dias }, ["apoiadores"]).then((r) => {
        const box = root.querySelector("[data-apoio-msg]");
        if (!box) return;
        box.hidden = false;
        box.textContent = r && r.erro === "nao-achei" ? `Não achei nenhuma conta com "${quem}" — confira o e-mail ou o @.`
          : r && dias === 0 ? `${quem}: apoio encerrado.`
            : r && r.ate ? `${quem}: sem anúncio até ${dataBR(r.ate)}.`
              : "Não deu certo — tente de novo em instantes.";
      });
    } else if (f.matches("[data-portal-form]")) {
      e.preventDefault();
      shared.adminRpc("admin_partner_link_create", 0, { p_loja: f.loja.value, p_rotulo: f.rotulo.value || null }).then((token) => {
        Object.keys(state.cache).forEach((k) => { if (k.indexOf("partners:") === 0) delete state.cache[k]; });
        render().then(() => {
          const box = root.querySelector("[data-portal-novo]");
          if (box && typeof token === "string") {
            box.hidden = false;
            box.innerHTML = `Link criado — mande só pra quem deve ver: <code>${esc(`${location.origin}/parceiro?t=${token}`)}</code>`;
          }
        });
      });
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
      root.innerHTML = `<div class="adm-toolbar" id="admToolbar"></div><div id="admBody" class="adm-body"></div><p class="admin-note" id="admNote"></p>`;
      root.addEventListener("click", onClick);
      root.addEventListener("submit", onSubmit);
      let quadro = 0;
      window.addEventListener("resize", () => { cancelAnimationFrame(quadro); quadro = requestAnimationFrame(ajustaKit); });
    }
    document.getElementById("admToolbar").innerHTML = nav();
    const body = document.getElementById("admBody");
    body.innerHTML = `<p class="empty-state">Carregando…</p>`;
    body.setAttribute("aria-busy", "true");
    paginaDoKit(state.tab === "parceiros");

    if (state.tab === "qualidade" && state.errors === undefined) {
      shared.errorSummary(7).then((errs) => { state.errors = errs; if (state.tab === "qualidade") render(); });
    }
    const keys = NEEDS[state.tab] || ["dash"];
    // A saúde da medição vem junto em toda aba: alarme (evento que parou de
    // chegar) aparece em cima de qualquer tela, não só em Técnico › Medição.
    // O kit de parceiros espera também o wordmark (um SVG pequeno, em cache).
    const [vals, saude] = await Promise.all([Promise.all(keys.map(need)), need("health"), state.tab === "parceiros" ? carregaMarca() : null]);
    if (my !== seq) return;           // trocou de aba/período no meio
    body.removeAttribute("aria-busy");
    const data = {};
    keys.forEach((k, i) => { data[k] = vals[i]; });
    const opcionais = OPCIONAIS[state.tab] || [];
    const faltam = keys.filter((k) => data[k] === undefined && opcionais.indexOf(k) < 0);
    const falhou = keys.filter((k) => data[k] === null && opcionais.indexOf(k) < 0);
    if (faltam.length) body.innerHTML = pendente(faltam);
    else if (falhou.length) body.innerHTML = `<p class="empty-state">Não consegui carregar esta aba (${esc(falhou.join(", "))}). Tente de novo em instantes.</p>`;
    else {
      const alarmes = saude && Array.isArray(saude.alvos) ? saude.alvos.filter((a) => a.alerta) : [];
      const aviso = alarmes.length && state.tab !== "medicao"
        ? `<p class="adm-banner"><strong>${alarmes.length === 1 ? "Um evento parou" : `${alarmes.length} eventos pararam`} de chegar</strong> nas últimas 48h — normalmente é medição quebrada, não falta de uso. <button type="button" class="chip adm-mini" data-tab="medicao">Ver em Medição</button></p>`
        : "";
      const pinta = (tab) => aviso + RENDER[tab](data);
      const tab = state.tab;
      if (tab === "sets") state.metaPendente = true;
      body.innerHTML = pinta(tab);
      ajustaKit();
      // Nomes das cartas chegam depois (catálogo estático): pinta com id e
      // repinta com nome, sem segurar a aba esperando o catálogo.
      resolveNames(cartasDaAba(tab, data), tab === "sets" ? 2000 : 400).then((novo) => {
        if (tab === "sets") state.metaPendente = false;
        if ((novo || tab === "sets") && my === seq && state.tab === tab) { body.innerHTML = pinta(tab); ajustaKit(); }
      });
    }
    const d = state.cache[`dash:${state.days}`];
    document.getElementById("admNote").textContent = d
      ? `Atualizado em ${new Date(d.generated_at).toLocaleString("pt-BR")} · janela de ${d.days} dias desde ${new Date(d.since).toLocaleDateString("pt-BR")}. "Gente" = pageview com JS executado, user-agent de navegador e sem webdriver; visitantes contam uuid anônimo first-party (só com consentimento de medição), logados contam a conta pelo JWT. O Cloudflare Web Analytics mede o resto: país, navegador, Core Web Vitals e o tráfego que nem chega a rodar JS.`
      : "";
  }
  render();
})();
