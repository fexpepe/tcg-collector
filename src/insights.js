// Cartões de RESUMO (gráficos de barras por raridade e por tipo de carta) —
// compartilhados entre a página do set (detail.js) e a Minha Coleção
// (collection.js). Nasceram no detail.js em 2026-09-14 (molde do app Dex) e
// vieram pra cá em 2026-09-16, quando o Fernando pediu o mesmo trilho de
// cartões no topo da Coleção. Módulo próprio, e não o shared.js, por causa do
// teto de peso do shared (viaja em toda página); este só entra nas duas telas.
//
// Grupos de raridade: quatro degraus fixos (comum · rara · ultra · secreta)
// em cima do rarityRank, que já é a régua de raridade de TODOS os jogos —
// listar cada string (~30 no Pokémon) viraria um gráfico ilegível. A cor
// acompanha o DEGRAU (cinza → azul → roxo → laranja), como o Dex faz; o
// número em cima da barra fica na cor de texto.
(function () {
  const shared = window.TCGShared;
  const { normalize, escapeHtml, escapeAttribute, t } = shared;

  const RARITY_GROUPS = ["common", "rare", "ultra", "secret"];
  const RARITY_GROUP_ICONS = {
    common: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="6"/></svg>',
    rare: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9-4.3-4.1 5.9-.8z"/></svg>',
    ultra: '<svg viewBox="0 0 24 24" width="22" height="18" fill="currentColor" aria-hidden="true"><path d="M8 4l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 13.8l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/><path d="M17 9l1.5 3 3.3.5-2.4 2.3.6 3.3-3-1.6-3 1.6.6-3.3-2.4-2.3 3.3-.5z"/></svg>',
    secret: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9-4.3-4.1 5.9-.8z"/></svg>'
  };
  const RARITY_COLORS = { common: "var(--insight-common)", rare: "var(--insight-rare)", ultra: "var(--insight-ultra)", secret: "var(--insight-secret)" };

  function rarityGroup(rarity) {
    // Mítica (Magic) não casa com nenhuma régua do rarityRank (cai em
    // "exótica", abaixo da comum) — e é o degrau acima da rara.
    if (/mythic|mitica|mítica/.test(normalize(rarity))) return "ultra";
    const rank = shared.rarityRank(rarity);
    if (rank >= 60) return "secret";
    if (rank >= 40) return "ultra";
    if (rank >= 30) return "rare";
    return "common";
  }
  // Tipo de carta: o mesmo agrupamento das listas de deck (cardTypeGroup), que
  // no Magic reduz a type_line ao tipo principal. Pokémon/Treinador/Energia
  // ganham tradução; o resto é vocabulário do jogo e sai cru.
  function cardTypeLabel(key) {
    const k = `cardType.${key}`;
    const r = t(k);
    return r === k ? key : r;
  }
  // Uma barra por valor, altura proporcional ao maior (--p = fração 0…1; o CSS
  // faz a conta em cima da faixa livre entre número e rótulo). Rótulo
  // (contagem) em cima, ícone/nome embaixo. O mínimo de 4px do CSS garante que
  // o 2 de 158 ainda apareça como uma linha, e não suma.
  function barsHtml(itens, { icons } = {}) {
    const max = Math.max(1, ...itens.map((i) => i.n));
    return `<div class="insight-bars" role="img" aria-label="${escapeAttribute(itens.map((i) => `${i.label}: ${i.n}`).join(", "))}">${itens.map((i) => `
      <div class="insight-bar-col" title="${escapeAttribute(`${i.label}: ${i.n}`)}">
        <span class="insight-bar-n">${i.n}</span>
        <span class="insight-bar" style="--p: ${(i.n / max).toFixed(3)}; --bar: ${i.color}"></span>
        <span class="insight-bar-label">${icons && i.icon ? i.icon : escapeHtml(i.label)}</span>
      </div>`).join("")}</div>`;
  }
  const card = (titulo, miolo) => `<article class="insight-card"><h3>${escapeHtml(titulo)}</h3>${miolo}</article>`;

  // Distribuição por GRUPO de raridade — só grupos presentes; vazio com um
  // grupo só (não distribui nada). Devolve o <article> pronto, ou "".
  function rarityCard(cards) {
    const porGrupo = new Map();
    cards.forEach((c) => { const g = rarityGroup(c.rarity); porGrupo.set(g, (porGrupo.get(g) || 0) + 1); });
    const itens = RARITY_GROUPS.filter((g) => porGrupo.has(g)).map((g) => ({
      label: t(`rarity.group.${g}`), n: porGrupo.get(g), color: RARITY_COLORS[g], icon: RARITY_GROUP_ICONS[g]
    }));
    return itens.length > 1 ? card(t("insights.rarity"), barsHtml(itens, { icons: true })) : "";
  }
  // Distribuição por TIPO de carta — cores categóricas em ordem FIXA (a 1ª cor
  // é sempre do tipo mais numeroso); mais de 6 tipos: os menores viram
  // "Outros". `gameOf(card)` diz o jogo de cada carta (na Coleção há vários).
  function typeCard(cards, gameOf) {
    if (typeof shared.cardTypeGroup !== "function") return ""; // página sem o facets.js
    const porTipo = new Map();
    cards.forEach((c) => {
      let g = shared.cardTypeGroup(gameOf(c), c);
      // Pokémon sem `category` no catálogo (o campo só entra em algumas
      // impressões): quem tem nº de Pokédex é carta de Pokémon.
      if (!g.key && c.dexId) g = { key: "Pokemon", label: "Pokemon" };
      if (!g.key) return;
      const atual = porTipo.get(g.key) || { n: 0, label: g.label };
      atual.n++;
      porTipo.set(g.key, atual);
    });
    let tipos = [...porTipo.entries()].map(([key, v]) => ({ key, n: v.n, label: cardTypeLabel(v.label) }))
      .sort((a, b) => b.n - a.n);
    if (tipos.length > 6) {
      const resto = tipos.slice(5).reduce((s, x) => s + x.n, 0);
      tipos = tipos.slice(0, 5).concat({ key: "other", n: resto, label: t("insights.other") });
    }
    tipos.forEach((x, i) => { x.color = `var(--insight-cat-${i + 1})`; });
    return tipos.length ? card(t("insights.cardType"), barsHtml(tipos)) : "";
  }

  window.TCGInsights = { RARITY_GROUPS, RARITY_GROUP_ICONS, rarityGroup, cardTypeLabel, barsHtml, rarityCard, typeCard };
})();
