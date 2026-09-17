// Árvore dos Lendários (lore.html) — o "quem veio de quem" do universo Pokémon,
// montado a partir do que os JOGOS dizem (Pokédex, mitos de Sinnoh, diários da
// Mansão, Torre Latão, o dragão de Unova…). Não é a árvore de evolução: é a
// linhagem de criação e as relações que a própria série afirma.
//
// Regra que vale pra cada elo: se o jogo AFIRMA, o traço é cheio; se é lenda
// contada dentro do jogo ("dizem que…", mitos de aldeia), o traço é pontilhado
// e o nó leva o selo de mito. Foi a única forma de incluir coisas como "Lugia
// comanda as aves lendárias" sem vender folclore como fato.
//
// Cada Pokémon vira link pra página dele (detail?type=pokemon&name=…) — mas só
// quando ele EXISTE no índice da Pokédex deste catálogo: linkar pra uma página
// vazia é pior que não linkar. Nós conceituais (o Ovo, "todos os Pokémon", os
// humanos) nunca têm link: não são Pokémon.
//
// Sem build: os dados são este arquivo, os textos vivem no src/i18n-lore.js
// (pt/en/es, como o resto do site) e o desenho é uma <ul> aninhada com os
// traços em CSS — nada de biblioteca de gráfico.
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const { t, escapeHtml, escapeAttribute, detailUrl, localizedImg } = shared;

  // Arte oficial do PokéAPI pelo número da Pokédex — a MESMA fonte que o
  // catálogo usa no campo pokemonImage, então o espelho de imagem do site
  // (img.sleevu.app) também vale aqui, via localizedImg.
  const arte = (dex) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${dex}.png`;

  // Ícones dos nós conceituais (SVG inline, traço, currentColor — nunca emoji).
  const ICONES = {
    ovo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 3c3.2 0 6 4.7 6 9a6 6 0 0 1-12 0c0-4.3 2.8-9 6-9z"/></svg>',
    mundo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15 0 18M12 3C9.5 5.7 9.5 18 12 21"/></svg>',
    todos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="9" cy="9" r="4"/><circle cx="16" cy="14" r="4"/><path d="M4 20c1-2.6 3-4 5-4"/></svg>',
    humano: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="7.5" r="3.5"/><path d="M4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/></svg>',
    dragao: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M3 14c3-6 9-9 18-9-2 4-4 6-7 7 1 3 0 6-3 7-2 .7-4 0-5-1.5"/></svg>',
    espada: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M19 3l-9 9M6 15l3 3M5 19l2-2M14 8l2 2"/><path d="M4 20l4-1 9-9 2-4-4 2-9 9z"/></svg>',
    vento: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 8h10a3 3 0 1 0-3-3M3 12h14a3 3 0 1 1-3 3M3 16h8"/></svg>',
    meteoro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M5 19l6-6M4 14l3 3M9 9l3 3"/><circle cx="16" cy="8" r="4"/></svg>'
  };

  // ── A ÁRVORE ───────────────────────────────────────────────────────────────
  // Cada nó: { id, dex?, nome?, icone?, mito?, filhos? }.
  //   dex + nome -> Pokémon (vira link se estiver no índice da Pokédex)
  //   icone      -> nó conceitual, sem link
  //   mito       -> o elo com o PAI é lenda contada no jogo, não fato afirmado
  // O texto de cada nó é a chave lore.n.<id> no src/i18n-lore.js.
  const SECOES = [
    {
      id: "origem",
      raizes: [{
        id: "ovo", icone: "ovo",
        filhos: [{
          id: "arceus", dex: 493, nome: "Arceus",
          filhos: [
            { id: "dialga", dex: 483, nome: "Dialga" },
            { id: "palkia", dex: 484, nome: "Palkia" },
            { id: "giratina", dex: 487, nome: "Giratina" },
            { id: "uxie", dex: 480, nome: "Uxie" },
            { id: "mesprit", dex: 481, nome: "Mesprit" },
            { id: "azelf", dex: 482, nome: "Azelf" }
          ]
        }]
      }]
    },
    {
      id: "vida",
      raizes: [
        {
          id: "mew", dex: 151, nome: "Mew",
          filhos: [
            { id: "todos", icone: "todos", mito: true },
            { id: "mewtwo", dex: 150, nome: "Mewtwo" }
          ]
        },
        { id: "celebi", dex: 251, nome: "Celebi" },
        { id: "jirachi", dex: 385, nome: "Jirachi" },
        { id: "deoxys", dex: 386, nome: "Deoxys" }
      ]
    },
    {
      id: "colossos",
      raizes: [{
        id: "regigigas", dex: 486, nome: "Regigigas",
        filhos: [
          { id: "regirock", dex: 377, nome: "Regirock", mito: true },
          { id: "regice", dex: 378, nome: "Regice", mito: true },
          { id: "registeel", dex: 379, nome: "Registeel", mito: true },
          { id: "regieleki", dex: 894, nome: "Regieleki", mito: true },
          { id: "regidrago", dex: 895, nome: "Regidrago", mito: true }
        ]
      }]
    },
    {
      id: "clima",
      raizes: [{
        id: "mundo", icone: "mundo",
        filhos: [
          { id: "groudon", dex: 383, nome: "Groudon" },
          { id: "kyogre", dex: 382, nome: "Kyogre" },
          { id: "rayquaza", dex: 384, nome: "Rayquaza" }
        ]
      }]
    },
    {
      id: "johto",
      raizes: [
        {
          id: "hooh", dex: 250, nome: "Ho-Oh",
          filhos: [
            { id: "raikou", dex: 243, nome: "Raikou" },
            { id: "entei", dex: 244, nome: "Entei" },
            { id: "suicune", dex: 245, nome: "Suicune" }
          ]
        },
        {
          id: "lugia", dex: 249, nome: "Lugia",
          filhos: [
            { id: "articuno", dex: 144, nome: "Articuno", mito: true },
            { id: "zapdos", dex: 145, nome: "Zapdos", mito: true },
            { id: "moltres", dex: 146, nome: "Moltres", mito: true }
          ]
        }
      ]
    },
    {
      id: "unova",
      raizes: [
        {
          id: "dragao", icone: "dragao",
          filhos: [
            { id: "reshiram", dex: 643, nome: "Reshiram" },
            { id: "zekrom", dex: 644, nome: "Zekrom" },
            { id: "kyurem", dex: 646, nome: "Kyurem" }
          ]
        },
        {
          id: "espadas", icone: "espada",
          filhos: [
            { id: "cobalion", dex: 638, nome: "Cobalion" },
            { id: "terrakion", dex: 639, nome: "Terrakion" },
            { id: "virizion", dex: 640, nome: "Virizion" },
            { id: "keldeo", dex: 647, nome: "Keldeo" }
          ]
        },
        {
          id: "forcas", icone: "vento",
          filhos: [
            { id: "tornadus", dex: 641, nome: "Tornadus" },
            { id: "thundurus", dex: 642, nome: "Thundurus" },
            { id: "landorus", dex: 645, nome: "Landorus" },
            { id: "enamorus", dex: 905, nome: "Enamorus" }
          ]
        }
      ]
    },
    {
      id: "kalos",
      raizes: [
        { id: "xerneas", dex: 716, nome: "Xerneas" },
        { id: "yveltal", dex: 717, nome: "Yveltal" },
        { id: "zygarde", dex: 718, nome: "Zygarde" }
      ]
    },
    {
      id: "alola",
      raizes: [
        {
          id: "cosmog", dex: 789, nome: "Cosmog",
          filhos: [{
            id: "cosmoem", dex: 790, nome: "Cosmoem",
            filhos: [
              { id: "solgaleo", dex: 791, nome: "Solgaleo" },
              { id: "lunala", dex: 792, nome: "Lunala" }
            ]
          }]
        },
        { id: "necrozma", dex: 800, nome: "Necrozma" },
        {
          id: "typenull", dex: 772, nome: "Type: Null",
          filhos: [{ id: "silvally", dex: 773, nome: "Silvally" }]
        }
      ]
    },
    {
      id: "galar",
      raizes: [
        {
          id: "eternatus", dex: 890, nome: "Eternatus", icone: "meteoro",
          filhos: [
            { id: "zacian", dex: 888, nome: "Zacian" },
            { id: "zamazenta", dex: 889, nome: "Zamazenta" }
          ]
        },
        {
          id: "calyrex", dex: 898, nome: "Calyrex",
          filhos: [
            { id: "glastrier", dex: 896, nome: "Glastrier" },
            { id: "spectrier", dex: 897, nome: "Spectrier" }
          ]
        }
      ]
    },
    {
      id: "paldea",
      raizes: [
        { id: "koraidon", dex: 1007, nome: "Koraidon" },
        { id: "miraidon", dex: 1008, nome: "Miraidon" },
        { id: "terapagos", dex: 1024, nome: "Terapagos" }
      ]
    }
  ];

  // ── Render ─────────────────────────────────────────────────────────────────
  const raiz = document.getElementById("loreRoot");
  if (!raiz) return;

  // Nomes que EXISTEM no catálogo deste site (índice da Pokédex): só eles viram
  // link. O índice é o mesmo da página Pokédex e desce em poucos KB.
  function nomesNoCatalogo() {
    const idx = (window.TCG_INDEXES && window.TCG_INDEXES.pokedex) || [];
    const porDex = new Map();
    idx.forEach((e) => { if (e && e.dexId) porDex.set(Number(e.dexId), e.name); });
    return porDex;
  }

  function noHtml(no, porDex, nivel) {
    const nome = no.nome || t(`lore.t.${no.id}`);
    const nota = t(`lore.n.${no.id}`);
    // Nó de Pokémon com carta no catálogo: link pra página dele. Sem carta (ou
    // nó conceitual), fica um cartão morto de propósito — link pra página vazia
    // é pior do que link nenhum.
    const doCatalogo = no.dex && porDex.get(no.dex);
    const href = doCatalogo ? detailUrl("pokemon", porDex.get(no.dex), "", "pokemon") : "";
    const midia = no.dex
      ? localizedImg(arte(no.dex), { alt: nome, loading: "lazy", className: "lore-art" })
      : `<span class="lore-icon" aria-hidden="true">${ICONES[no.icone] || ICONES.mundo}</span>`;
    const selo = no.mito ? `<span class="lore-mito">${escapeHtml(t("lore.legendTag"))}</span>` : "";
    const miolo = `
      <span class="lore-media">${midia}</span>
      <span class="lore-nome">${escapeHtml(nome)}</span>
      <span class="lore-nota">${escapeHtml(nota)}</span>
      ${selo}`;
    const classe = `lore-card${no.dex ? "" : " is-conceito"}${nivel === 0 ? " is-raiz" : ""}${href ? "" : " is-mudo"}`;
    return href
      ? `<a class="${classe}" href="${escapeAttribute(href)}">${miolo}</a>`
      : `<div class="${classe}">${miolo}</div>`;
  }

  function galhoHtml(no, porDex, nivel) {
    const filhos = (no.filhos || []).map((f) => galhoHtml(f, porDex, nivel + 1)).join("");
    return `<li${no.mito ? ' class="is-mito"' : ""}>${noHtml(no, porDex, nivel)}${filhos ? `<ul>${filhos}</ul>` : ""}</li>`;
  }

  // Cada seção abre CENTRADA na própria raiz. A árvore é mais larga que o
  // celular, e a rolagem nasce em zero: sem isto a tela abria na ponta
  // esquerda, que é justamente o espaço vazio acima da primeira fileira de
  // filhos — parecia que a seção não tinha carregado.
  function centralizaTrilhos() {
    raiz.querySelectorAll(".lore-canvas").forEach((c) => {
      const sobra = c.scrollWidth - c.clientWidth;
      if (sobra > 0) c.scrollLeft = sobra / 2;
    });
  }

  function render() {
    const porDex = nomesNoCatalogo();
    raiz.innerHTML = SECOES.map((sec) => `
      <section class="lore-sec">
        <h2>${escapeHtml(t(`lore.sec.${sec.id}`))}</h2>
        <p class="lore-sec-sub">${escapeHtml(t(`lore.sub.${sec.id}`))}</p>
        <div class="lore-canvas">
          <ul class="lore-tree">${sec.raizes.map((r) => galhoHtml(r, porDex, 0)).join("")}</ul>
        </div>
      </section>`).join("");
    centralizaTrilhos();
  }

  // O índice da Pokédex decide quais nós viram link; sem ele a árvore ainda
  // aparece (só toda muda), então desenha já e repinta quando o catálogo chega.
  render();
  window.addEventListener("resize", shared.debounce(centralizaTrilhos, 150));
  if (window.SLEEVU && window.SLEEVU.catalogReady) {
    window.SLEEVU.catalogReady.then(render).catch(() => { /* fica a versão sem link */ });
  }
})();
