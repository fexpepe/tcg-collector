// Gráfico do histórico de preço na tela da carta (revisão de 2026-11-12).
//
// O Fernando pediu o gráfico no molde do Collectr: embutido num painel, com
// os períodos 1M/3M/6M/1A à mão, os VALORES do lado e as DATAS embaixo (o
// título seguiu o mesmo). Saiu do shared.js nessa revisão e desce sob demanda:
// o núcleo estava a 12 B do teto do check-size, e o desenho só roda quando
// uma carta com série é aberta.
//
// Divisão de trabalho: o shared.js (fillPriceHistory) segue dono do DADO —
// busca o fragmento, tira a série da carta e converte a moeda. Este arquivo
// só desenha e cuida da leitura ponto a ponto.
//
// Decisões de leitura:
// - O eixo Y começa no ZERO. Antes ia do mínimo ao máximo da janela, e uma
//   variação de 1% (R$ 8.286 → R$ 8.206) ocupava a altura inteira: parecia
//   um tombo. Com o zero e os valores do lado, a altura é proporcional ao
//   preço, como no Collectr, e a área sombreada não mente; o detalhe fino
//   fica no crosshair.
// - O eixo X é por TEMPO (eixoTemporal, a régua única dos gráficos do card,
//   no shared.js): o histórico envelhece por faixas e os pontos não são
//   equidistantes.
// - Os quatro períodos ficam SEMPRE no lugar. O que não mostraria nada novo
//   (o histórico é mais curto que o período anterior) aparece apagado, com a
//   data de início no title, e acende sozinho conforme o acumulador cresce.
//   "Tudo" só entra quando a série passa de um ano.
(function () {
  const S = window.TCGShared;
  if (!S || !S._nucleo) return;
  const { t, escapeHtml, escapeAttribute, getLocale, formatMoney } = S;
  const { eixoTemporal } = S._nucleo;
  const DIA = 864e5;
  // viewBox: o svg estica (preserveAspectRatio=none), então todo TEXTO fica
  // fora dele, em HTML posicionado por %, e não deforma em largura nenhuma.
  const W = 600, H = 200, P = 4;
  const ROT = { 30: "cs.r30", 90: "cs.r90", 180: "cs.r180", 365: "cs.r365", 0: "cs.rAll" };
  // Id do degradê por desenho: `url(#id)` acha o PRIMEIRO do documento, e um
  // segundo gráfico (verde × laranja) pintaria a área com a cor do outro.
  let seq = 0;
  // O mesmo traço do selo "vintage1" (badges.js): relógio voltando.
  const ICONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2"/></svg>';
  const f1 = (v) => v.toFixed(1);
  const ms = (d) => Date.parse(d + "T00:00:00Z");
  // "6 set" / "Sep 6" / "6 sept" (com ano no title e no tooltip). O Intl do pt
  // e do es escreve "6 de set."; o ponto e o "de" só ocupam espaço no eixo.
  const DIA_MES = { day: "numeric", month: "short" };
  const COM_ANO = { day: "numeric", month: "short", year: "numeric" };
  const data = (v, opc) => new Date(v).toLocaleDateString(getLocale(), Object.assign({ timeZone: "UTC" }, opc)).replace(/\.|\s+de(?=\s)/g, "");

  // Passo "redondo" do eixo Y (1, 2, 2,5 ou 5 × 10^k), de 3 a 5 intervalos do
  // zero ao primeiro múltiplo acima do máximo: vence o topo mais JUSTO (a
  // linha usa a altura) e, no empate, o de menos linhas. Sempre há candidato:
  // a faixa aceita [máx/5, máx/2) é mais larga que o maior salto da lista.
  function escala(max) {
    const pot = Math.pow(10, Math.floor(Math.log10(max / 5)));
    let melhor = null;
    for (const m of [1, 2, 2.5, 5, 10, 20, 25, 50]) {
      const passo = m * pot, n = Math.ceil(max / passo - 1e-9);
      if (n >= 3 && n <= 5 && (!melhor || n * passo <= melhor.n * melhor.passo * (1 + 1e-9))) melhor = { passo, n };
    }
    return melhor;
  }

  // Curva monotônica (Fritsch–Carlson, a curveMonotoneX do d3): suaviza como
  // a do Collectr sem passar do ponto — nunca inventa um pico ou um vale que
  // a série não tem, e um patamar continua reto.
  function curva(xs, ys) {
    const n = xs.length, d = [], m = [];
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1));
    for (let i = 0; i < n; i++) {
      if (!i || i === n - 1) { m.push(d[i ? i - 1 : 0]); continue; }
      const h0 = xs[i] - xs[i - 1], h1 = xs[i + 1] - xs[i], s0 = d[i - 1], s1 = d[i];
      const p = (s0 * h1 + s1 * h0) / (h0 + h1 || 1);
      m.push(s0 * s1 <= 0 ? 0 : 2 * Math.sign(s0) * Math.min(Math.abs(s0), Math.abs(s1), Math.abs(p) / 2));
    }
    let s = `M${f1(xs[0])},${f1(ys[0])}`;
    for (let i = 0; i < n - 1; i++) {
      const h = (xs[i + 1] - xs[i]) / 3;
      s += `C${f1(xs[i] + h)},${f1(ys[i] + m[i] * h)} ${f1(xs[i + 1] - h)},${f1(ys[i + 1] - m[i + 1] * h)} ${f1(xs[i + 1])},${f1(ys[i + 1])}`;
    }
    return s;
  }

  // bloco: o .price-history vazio que o shared.js pôs no lugar do gráfico.
  // pts: [[data ISO, valor JÁ na moeda escolhida]], em ordem, 3+ pontos.
  window.TCGGraficoPreco = function (bloco, pts, cur) {
    const ini = ms(pts[0][0]), fim = ms(pts[pts.length - 1][0]);
    const dias = (fim - ini) / DIA;
    // Um período só acende se mostrar algo que o anterior não mostra.
    const faixas = [30, 90, 180, 365].map((d, k, a) => ({ d, ok: !k || dias > a[k - 1] }));
    if (dias > 365) faixas.push({ d: 0, ok: true });
    // Abre na série inteira (o maior período aceso), como antes.
    let faixa = faixas.filter((x) => x.ok).pop().d;
    const desde = t("cs.rSince", { date: data(ini, COM_ANO) });

    function desenha() {
      let sel = faixa ? pts.filter((p) => fim - ms(p[0]) <= faixa * DIA) : pts;
      if (sel.length < 2) sel = pts.slice(-2); // 1M com buraco na coleta
      const vals = sel.map((p) => p[1]);
      const { passo, n } = escala(Math.max.apply(null, vals));
      const topo = n * passo;
      const { X, pontoEmX } = eixoTemporal(sel.map((p) => p[0]), W, P);
      const Y = (v) => H - (v / topo) * H;
      const xs = vals.map((_, i) => X(i)), ys = vals.map(Y);
      const linha = curva(xs, ys);
      const cor = vals[vals.length - 1] >= vals[0] ? "#34d399" : "#f0883e";
      // Eixo Y: inteiro abaixo de 10 mil, compacto ("15 mil", "15K") a partir
      // dele; casas decimais só quando o passo pede (cartas de centavos).
      let dec = 0;
      while (topo < 1e4 && dec < 3 && Math.abs(Math.round(passo * 10 ** dec) - passo * 10 ** dec) > 1e-6) dec++;
      const nf = new Intl.NumberFormat(getLocale(), topo >= 1e4 ? { notation: "compact", maximumFractionDigits: 1 } : { minimumFractionDigits: dec, maximumFractionDigits: dec });
      let yLab = "", grade = "";
      for (let i = 0; i <= n; i++) {
        yLab += `<span>${i ? escapeHtml(nf.format(i * passo)) : "0"}</span>`;
        grade += `<line x1="0" x2="${W}" y1="${f1(Y(i * passo))}" y2="${f1(Y(i * passo))}"/>`;
      }
      // Eixo X: 5 marcas espaçadas no TEMPO, das pontas pro meio. Janela de
      // mais de 10 meses troca o dia pelo ano.
      const a = ms(sel[0][0]), b = ms(sel[sel.length - 1][0]);
      let xLab = "", ant = "";
      for (let k = 0; k <= 4; k++) {
        const txt = data(a + ((b - a) * k) / 4, b - a > 300 * DIA ? { month: "short", year: "numeric" } : DIA_MES);
        if (txt !== ant) xLab += `<span style="left:${f1(((P + (k / 4) * (W - 2 * P)) / W) * 100)}%">${escapeHtml(txt)}</span>`;
        ant = txt;
      }
      // Dias COBERTOS, não pontos: o histórico envelhece pra semanal/mensal, e
      // 74 pontos podem ser 500 dias.
      const rotulo = t("market.history", { n: Math.round((b - a) / DIA) + 1 });
      const ult = vals.length - 1;
      bloco.innerHTML = `<div class="ph-head"><h3 class="ph-tit">${ICONE}<span>${escapeHtml(rotulo)}</span></h3>
        <span class="ph-ranges" role="group">${faixas.map((x) => `<button type="button" class="ph-range${x.d === faixa ? " is-on" : ""}" data-ph-range="${x.d}" aria-pressed="${x.d === faixa}"${x.ok ? "" : ` aria-disabled="true" title="${escapeAttribute(desde)}"`}>${escapeHtml(t(ROT[x.d]))}</button>`).join("")}</span></div>
        <div class="ph-grafico">
          <div class="ph-y" aria-hidden="true">${yLab}</div>
          <div class="ph-plot">
            <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${escapeAttribute(rotulo)}">
              <defs><linearGradient id="phg${++seq}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${cor}" stop-opacity="0.16"/><stop offset="1" stop-color="${cor}" stop-opacity="0"/></linearGradient></defs>
              <g class="ph-grade">${grade}</g>
              <path d="${linha}L${f1(xs[ult])},${H}L${f1(xs[0])},${H}Z" fill="url(#phg${seq})"/>
              <path d="${linha}" fill="none" stroke="${cor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
            </svg>
            <span class="ph-fim" style="left:${f1((xs[ult] / W) * 100)}%;top:${f1((ys[ult] / H) * 100)}%;background:${cor}"></span>
          </div>
          <div class="ph-x" aria-hidden="true">${xLab}</div>
        </div>`;
      ponteiro(bloco.querySelector(".ph-plot"), sel, vals, X, Y, pontoEmX, cur);
    }
    bloco.addEventListener("click", (e) => {
      const b = e.target.closest("[data-ph-range]");
      if (b && b.getAttribute("aria-disabled") !== "true") { faixa = Number(b.dataset.phRange); desenha(); }
    });
    desenha();
  };

  // Crosshair + tooltip. Overlay em HTML (não dentro do SVG): o viewBox estica
  // com preserveAspectRatio=none e distorceria o raio do ponto; posições em %
  // ficam certas em qualquer largura. O overlay mora no .ph-plot, que envolve
  // SÓ o svg, então o `top` em % é fração da mesma altura do viewBox.
  function ponteiro(plot, pts, vals, X, Y, pontoEmX, cur) {
    plot.insertAdjacentHTML("beforeend", '<div class="ph-cross" hidden></div><div class="ph-dot" hidden></div><div class="ph-tip" hidden></div>');
    const cross = plot.querySelector(".ph-cross");
    const dot = plot.querySelector(".ph-dot");
    const tip = plot.querySelector(".ph-tip");
    const svg = plot.querySelector("svg");
    function show(clientX) {
      const r = svg.getBoundingClientRect();
      if (!r.width) return;
      const i = pontoEmX(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * W);
      const left = (X(i) / W) * 100;
      cross.style.left = dot.style.left = tip.style.left = left + "%";
      dot.style.top = (Y(vals[i]) / H) * 100 + "%";
      tip.textContent = `${data(ms(pts[i][0]), COM_ANO)} · ${formatMoney(cur, vals[i])}`;
      // O tooltip troca de lado no meio pra nunca sair do gráfico.
      tip.classList.toggle("is-flip", left > 55);
      cross.hidden = dot.hidden = tip.hidden = false;
    }
    function hide() { cross.hidden = dot.hidden = tip.hidden = true; }
    // Pointer Events cobrem mouse E toque. touch-action: pan-y (no CSS) deixa o
    // arraste HORIZONTAL ler o gráfico sem sequestrar a rolagem vertical.
    svg.addEventListener("pointerdown", (e) => { svg.setPointerCapture(e.pointerId); show(e.clientX); });
    svg.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" || e.pressure > 0) show(e.clientX); });
    svg.addEventListener("pointerup", hide);
    svg.addEventListener("pointercancel", hide);
    svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
  }
})();
