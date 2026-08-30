// "Mercado do jogo" na página de Sets (sets.html): fileira de altas/quedas do
// dia + sparkline do índice de 30 dias.
//
// ARQUIVO PRÓPRIO, e não mais um bloco no shared.js, por dois motivos: só esta
// página usa, e o shared.js está a 96% do orçamento de peso (check-size.mjs) —
// ele viaja em TODAS as páginas do site.
//
// Lê UM arquivo já hidratado (data/<jogo>/market.generated.json, do
// scripts/build-market.mjs). Nada de baixar chunk pra descobrir o nome da carta:
// esta é uma página pública, que precisa aparecer rápido pra quem vem do Google.
//
// Decisão de produto (aval do Fernando, 2026-08-30): o trilho e o sparkline
// entram nas superfícies PÚBLICAS de jogo; as páginas /mercado/<jogo> ficaram
// FORA. A visão financeira da COLEÇÃO segue concentrada no Portfólio — aqui é o
// mercado do jogo, não o patrimônio de ninguém.
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const host = document.getElementById("marketRail");
  if (!host) return;
  const { t, escapeHtml, escapeAttribute } = shared;

  const dir = (window.SLEEVU && window.SLEEVU.dataDir) || "data/";
  const jogo = (window.SLEEVU && window.SLEEVU.game) || "pokemon";

  // Sparkline sem biblioteca: uma <polyline> num viewBox de 100×30 e o CSS
  // estica. preserveAspectRatio="none" de propósito — a forma da curva importa,
  // a proporção não, e assim ela ocupa a largura que tiver.
  function sparkline(pontos) {
    const vals = pontos.filter((v) => v != null);
    if (vals.length < 2) return "";
    const min = Math.min(...vals), max = Math.max(...vals);
    const amp = max - min || 1;
    const passo = 100 / (pontos.length - 1);
    let d = "";
    pontos.forEach((v, i) => {
      if (v == null) return;
      const x = (i * passo).toFixed(2);
      const y = (28 - ((v - min) / amp) * 26).toFixed(2);
      d += `${d ? " " : ""}${x},${y}`;
    });
    const subiu = vals[vals.length - 1] >= vals[0];
    return `<svg class="mkt-spark${subiu ? " is-up" : " is-down"}" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${d}"/></svg>`;
  }

  function pctTxt(p) {
    const n = Math.abs(p).toLocaleString(shared.getLocale(), { maximumFractionDigits: 1 });
    return `${p >= 0 ? "+" : "−"}${n}%`;
  }

  function cartao(item, lado) {
    const url = shared.detailUrl("set", item.s, "", jogo, { card: item.id, setId: item.sid });
    const img = item.img
      ? shared.localizedImg(item.img, { alt: "", loading: "lazy", thumb: true, className: "mkt-img" })
      : `<span class="mkt-img mkt-img-vazia" aria-hidden="true"></span>`;
    return `<a class="mkt-card is-${lado}" href="${escapeAttribute(url)}" title="${escapeAttribute(`${item.n} · ${item.s} ${item.num}`)}">
      ${img}
      <span class="mkt-card-nome">${escapeHtml(item.n)}</span>
      <span class="mkt-card-pct">${escapeHtml(pctTxt(item.pct))}</span>
    </a>`;
  }

  function fileira(titulo, itens, lado) {
    if (!itens.length) return "";
    return `<div class="mkt-linha">
      <h3 class="mkt-linha-tit">${escapeHtml(titulo)}</h3>
      <div class="mkt-rail">${itens.map((i) => cartao(i, lado)).join("")}</div>
    </div>`;
  }

  function pinta(dados) {
    const partes = [];
    const idx = dados.idx;
    if (idx && idx.i && idx.i.length >= 2) {
      const vals = idx.i.filter((v) => v != null);
      const varPct = vals.length >= 2 ? ((vals[vals.length - 1] - vals[0]) / vals[0]) * 100 : 0;
      const dias = idx.d.length;
      partes.push(`<div class="mkt-idx">
        <div class="mkt-idx-txt">
          <strong class="mkt-idx-pct${varPct >= 0 ? " is-up" : " is-down"}">${escapeHtml(pctTxt(varPct))}</strong>
          <span class="mkt-idx-legenda">${escapeHtml(t("mkt.indexLegend", { d: dias, n: (idx.n || 0).toLocaleString(shared.getLocale()) }))}</span>
        </div>
        ${sparkline(idx.i)}
      </div>`);
    }
    partes.push(fileira(t("mkt.up"), dados.up || [], "up"));
    partes.push(fileira(t("mkt.down"), dados.down || [], "down"));
    const corpo = partes.filter(Boolean).join("");
    if (!corpo) return;

    host.innerHTML = `
      <h2 class="mkt-tit">${escapeHtml(t("mkt.title"))}</h2>
      ${corpo}
      <p class="mkt-nota">${escapeHtml(t("mkt.note"))}</p>`;
    host.hidden = false;
  }

  fetch(dir + "market.generated.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d) pinta(d); })
    .catch(() => { /* sem arquivo: a seção simplesmente não existe */ });
})();
