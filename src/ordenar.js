// Ordenar — UM bloco pra toda grade de cartas (2026-09-30).
//
// Antes, cada tela (Cartas, página do set, Explorar, Coleção, perfil público,
// Desejos, Vendas, os seletores do Graded e das Vendas, o editor do fichário e
// as Pastas) tinha a SUA lista de <option> e o SEU comparador: onze cópias que
// já tinham divergido (o set sem "Adição", o Explorar sem "Nº maior → menor",
// o "sem preço vai pro fim" só em metade delas). Agora a lista de critérios, os
// rótulos, a comparação e o menu moram aqui; a página só diz QUAIS famílias
// oferece (`data-ordenar="value num name"`) e qual é o padrão dela.
//
// Molde: o menu de ordenação do Collectr — pares "Critério: sentido" (Preço:
// menor para maior / maior para menor, Número da carta, Nome, Data de adição,
// Variação de preço, Variação %, Popularidade), o critério forte e o sentido
// apagado, ✓ no escolhido. O padrão continua sendo Preço: maior para menor.
//
// O <select> continua no DOM e continua sendo a fonte da verdade: a página lê
// .value e ouve "change" como sempre. Este arquivo só troca o que ABRE: o
// .srt-host (o rótulo + o select) ganha um ::after por cima que recebe o toque,
// e em vez da lista nativa — que não pinta meia linha em negrito — abre o menu
// abaixo. No teclado, as teclas que abririam a lista nativa abrem o menu.
(function () {
  const shared = window.TCGShared;
  const { t, escapeHtml, escapeAttribute } = shared;

  // [chave, critério, sentido] na ORDEM do menu (a do Collectr, com os nossos
  // no fim). Sentido ausente = rótulo único ("Mais relevantes", só na busca).
  const CRITERIOS = [
    ["relevance", "sort.relevance"],
    ["value-asc", "sort.k.price", "sort.d.up"],
    ["value-desc", "sort.k.price", "sort.d.down"],
    ["change-asc", "sort.k.change", "sort.d.up"],
    ["change-desc", "sort.k.change", "sort.d.down"],
    ["num-asc", "sort.k.number", "sort.d.up"],
    ["num-desc", "sort.k.number", "sort.d.down"],
    ["name-asc", "sort.k.name", "sort.d.az"],
    ["name-desc", "sort.k.name", "sort.d.za"],
    ["added-asc", "sort.k.added", "sort.d.oldest"],
    ["added-desc", "sort.k.added", "sort.d.newest"],
    ["pct-asc", "sort.k.pct", "sort.d.up"],
    ["pct-desc", "sort.k.pct", "sort.d.down"],
    ["views-asc", "sort.k.views", "sort.d.least"],
    ["views-desc", "sort.k.views", "sort.d.most"],
    ["rarity-asc", "sort.k.rarity", "sort.d.up"],
    ["rarity-desc", "sort.k.rarity", "sort.d.down"],
    ["release-asc", "sort.k.release", "sort.d.oldest"],
    ["release-desc", "sort.k.release", "sort.d.newest"],
    ["grade-asc", "sort.k.grade", "sort.d.up"],
    ["grade-desc", "sort.k.grade", "sort.d.down"]
  ];
  const PADRAO = "value-desc";
  // Valores gravados (localStorage) antes da unificação -> chave de hoje.
  const APELIDOS = { release: "release-desc", "valor-desc": "value-desc", "valor-asc": "value-asc", added: "added-asc" };
  const familia = (k) => k.replace(/-(asc|desc)$/, "");

  // "value num name" -> as chaves dessas famílias, na ordem do menu.
  function chaves(familias) {
    const quer = new Set(String(familias || "").split(/[\s,]+/).filter(Boolean));
    return CRITERIOS.map((c) => c[0]).filter((k) => quer.has(familia(k)));
  }
  // Valor gravado ou vindo da URL -> chave válida pra estas famílias; senão o
  // padrão da tela (que nem sempre é o preço: a busca abre por relevância, a
  // pasta na ordem em que as cartas entraram).
  function valida(valor, familias, padrao) {
    const v = APELIDOS[valor] || valor;
    return chaves(familias).includes(v) ? v : (padrao || PADRAO);
  }
  function rotulo(chave) {
    const c = CRITERIOS.find((x) => x[0] === (APELIDOS[chave] || chave));
    if (!c) return chave;
    return c[2] ? `${t(c[1])}: ${t(c[2])}` : t(c[1]);
  }
  function opcoes(familias, atual) {
    const sel = APELIDOS[atual] || atual;
    return chaves(familias).map((k) =>
      `<option value="${k}"${k === sel ? " selected" : ""}>${escapeHtml(rotulo(k))}</option>`).join("");
  }
  // <select data-ordenar="familias"> vazio no HTML estático ganha as opções
  // aqui — antes do script da página, que vem depois e só escolhe o valor.
  function preenche(select) {
    const fams = select.getAttribute("data-ordenar");
    if (fams && !select.options.length) select.innerHTML = opcoes(fams, PADRAO);
  }

  // ── Dados que não vêm com a carta ─────────────────────────────────────────
  // Variação de preço (o price-deltas-7d do build: % em ~7 dias, o mesmo do
  // aviso de queda da Lista de Desejos) e popularidade (o contador anônimo de
  // views, card_views — o acumulado; o do dia não é público). Um pedido por
  // jogo, só quando alguém escolhe um desses critérios. Enquanto não chega a
  // carta conta 0, e a grade repinta quando chegar (o `depois` da página).
  // Falha vira Map vazio e fica no cache: nada de repintar em laço.
  const extras = { pct: {}, views: {} };
  const pendentes = new Set();
  function extra(tipo, jogo) {
    const cache = extras[tipo];
    if (cache[jogo] instanceof Map) return cache[jogo];
    if (!cache[jogo]) {
      const pedido = tipo === "pct"
        ? shared.loadPriceDeltas7d(jogo).then((d) => new Map(Object.entries((d && d.c) || {})))
        : shared.fetchTopViewed(jogo, 1000).then((rows) => new Map((rows || []).map((r) => [r.card_id, Number(r.views) || 0])));
      cache[jogo] = pedido.catch(() => new Map()).then((m) => { cache[jogo] = m; return m; });
    }
    pendentes.add(cache[jogo]);
    return null;
  }
  // Um repinte só por leva de pedidos, mesmo que a tela ordene várias listas
  // no mesmo render (o perfil ordena uma por grupo): vale o último `depois`.
  // O timer espera o sort inteiro terminar — aí já passaram todos os jogos.
  let repinta = null;
  let timer = null;
  function agenda(depois) {
    repinta = depois;
    if (timer) return;
    timer = setTimeout(() => {
      const leva = Array.from(pendentes);
      pendentes.clear();
      Promise.all(leva).then(() => {
        timer = null;
        const f = repinta;
        repinta = null;
        if (f) f();
      });
    }, 0);
  }

  // Comparador da chave. `o` diz como ler o item da tela:
  //   carta(x)      -> a carta ({ id, name, number, rarity, set, setReleaseDate, game });
  //                    padrão x.card || x
  //   preco(x)      -> o valor EXIBIDO no tile (na moeda atual)
  //   adicao(x)     -> posição de entrada (menor = mais antiga; sem = Infinity)
  //   nota(x)       -> nota do slab (0 = carta solta)
  //   relevancia(x) -> nota de busca (só "relevance")
  //   mercado(x)    -> false quando a variação de mercado não vale pro item (slab)
  //   depois()      -> repinta quando os dados extras chegarem
  // Desempate em todas: número da carta, depois nome — a mesma ordem estável
  // em toda grade (antes cada tela deixava o empate na ordem do catálogo).
  function compara(chave, o) {
    o = o || {};
    const k = APELIDOS[chave] || chave;
    const desc = /-desc$/.test(k);
    const fam = familia(k);
    const carta = shared.memoValue(o.carta || ((x) => x.card || x));
    const preco = shared.memoValue(o.preco || (() => 0));
    const locale = shared.getLocale();
    const nomeDe = (x) => String(carta(x).name || "");
    const porNum = (a, b) => shared.compareCardNumbers(carta(a).number, carta(b).number);
    const porNome = (a, b) => nomeDe(a).localeCompare(nomeDe(b), locale, { sensitivity: "base", numeric: true });
    const desempate = (a, b) => porNum(a, b) || porNome(a, b);
    // Número com "desconhecido vai pro fim" nos dois sentidos: carta sem preço
    // não é "a mais barata", é uma que a gente não sabe.
    const conhecidoPrimeiro = (va, vb, a, b) => {
      if (!va && !vb) return desempate(a, b);
      if (!va) return 1;
      if (!vb) return -1;
      return (desc ? vb - va : va - vb) || desempate(a, b);
    };

    if (fam === "relevance") {
      const rel = shared.memoValue(o.relevancia || (() => 0));
      return (a, b) => (rel(b) - rel(a)) || (preco(b) - preco(a)) || desempate(a, b);
    }
    if (fam === "value") return (a, b) => conhecidoPrimeiro(preco(a), preco(b), a, b);
    if (fam === "num") return (a, b) => (desc ? porNum(b, a) : porNum(a, b)) || porNome(a, b);
    if (fam === "name") return (a, b) => (desc ? porNome(b, a) : porNome(a, b)) || porNum(a, b);
    if (fam === "rarity") {
      const rr = shared.memoValue((x) => shared.rarityRank(carta(x).rarity));
      return (a, b) => (desc ? rr(b) - rr(a) : rr(a) - rr(b)) || desempate(a, b);
    }
    if (fam === "release") {
      // Data ISO ordena como texto; sem data vai pro fim. Empate (mesmo dia):
      // o set, e dentro dele o número — o set sai em bloco, não intercalado.
      const dia = (x) => String(carta(x).setReleaseDate || "");
      return (a, b) => {
        const da = dia(a), db = dia(b);
        if (!da !== !db) return da ? -1 : 1;
        return (desc ? db.localeCompare(da) : da.localeCompare(db))
          || String(carta(a).set || "").localeCompare(String(carta(b).set || "")) || desempate(a, b);
      };
    }
    if (fam === "added") {
      const pos = shared.memoValue((x) => { const r = o.adicao ? o.adicao(x) : Infinity; return r == null ? Infinity : r; });
      return (a, b) => {
        const pa = pos(a), pb = pos(b);
        if (pa === Infinity || pb === Infinity) return (pa === Infinity) - (pb === Infinity) || desempate(a, b);
        return desc ? pb - pa : pa - pb;
      };
    }
    if (fam === "grade") {
      // Carta solta (nota 0) vai pro fim nos dois sentidos; empate de nota,
      // o slab que vale mais primeiro.
      const nota = shared.memoValue(o.nota || (() => 0));
      return (a, b) => {
        const na = nota(a), nb = nota(b);
        if (!na !== !nb) return na ? -1 : 1;
        return (desc ? nb - na : na - nb) || (preco(b) - preco(a)) || desempate(a, b);
      };
    }

    // Variação de preço / %, popularidade: dado por jogo, sob demanda.
    let faltou = false;
    // Carta sem .game (catálogo de um jogo só): o jogo da página, como o
    // currentGame() do shared.js (que não é exportado).
    const jogoDe = (x) => shared.normalizeGame(carta(x).game || (window.SLEEVU && window.SLEEVU.game) || "pokemon");
    const dado = (tipo, x) => { const m = extra(tipo, jogoDe(x)); if (!m) faltou = true; return m; };
    let valor;
    if (fam === "views") {
      valor = shared.memoValue((x) => {
        const m = dado("views", x);
        return m ? (m.get(carta(x).id) || 0) : 0;
      });
    } else if (fam === "pct" || fam === "change") {
      const pct = shared.memoValue((x) => {
        if (o.mercado && o.mercado(x) === false) return 0;
        const m = dado("pct", x);
        if (!m) return 0;
        const id = carta(x).id;
        const p = m.has(id) ? m.get(id) : m.get(shared.basePricingId(id));
        return Number(p) || 0;
      });
      // Variação em dinheiro, na moeda da tela: o preço de hoje menos o de
      // antes (hoje / (1 + pct)). É o que separa a carta que foi de R$ 2 pra
      // R$ 4 (+100%, +R$ 2) da que foi de R$ 818 pra R$ 900 (+10%, +R$ 82).
      valor = fam === "pct" ? pct : shared.memoValue((x) => {
        const p = pct(x);
        return p && p > -100 ? preco(x) * p / (100 + p) : 0;
      });
    } else {
      return (a, b) => conhecidoPrimeiro(preco(a), preco(b), a, b); // chave desconhecida: preço
    }
    let agendado = false;
    return (a, b) => {
      const r = (desc ? valor(b) - valor(a) : valor(a) - valor(b)) || desempate(a, b);
      if (faltou && !agendado && o.depois) { agendado = true; agenda(o.depois); }
      return r;
    };
  }

  // ── O menu ─────────────────────────────────────────────────────────────────
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  let aberto = null; // { select, menu, veu, teclado }

  function linha(op) {
    const txt = op.textContent;
    const i = txt.indexOf(": ");
    const miolo = i > 0
      ? `<span class="srt-k">${escapeHtml(txt.slice(0, i + 1))}</span> <span class="srt-d">${escapeHtml(txt.slice(i + 2))}</span>`
      : `<span class="srt-k">${escapeHtml(txt)}</span>`;
    const sel = op.selected;
    return `<button type="button" class="srt-opt" role="option" aria-selected="${sel}" data-v="${escapeAttribute(op.value)}">${miolo}${sel ? CHECK : ""}</button>`;
  }

  // Desktop: pendurado no select (abaixo; em cima se embaixo não cabe),
  // alinhado pela esquerda ou, se estourar a tela, pela direita. Celular:
  // folha presa no rodapé, largura da tela (o .is-sheet do CSS).
  function posiciona(select, menu) {
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    if (vw <= 600) { menu.classList.add("is-sheet"); return; }
    const r = select.getBoundingClientRect();
    menu.style.minWidth = `${Math.round(r.width)}px`;
    const w = menu.offsetWidth;
    const h = menu.scrollHeight;
    let left = r.left;
    if (left + w > vw - 8) left = r.right - w;
    menu.style.left = `${Math.max(8, Math.min(left, vw - w - 8))}px`;
    const abaixo = vh - r.bottom - 12;
    const acima = r.top - 12;
    // Abre pra baixo, rolando por dentro, enquanto couberem ~7 linhas; só sobe
    // quando embaixo aperta de verdade (select colado no rodapé da tela).
    const sobe = abaixo < Math.min(h, 280) && acima > abaixo;
    menu.style.maxHeight = `${Math.max(160, sobe ? acima : abaixo)}px`;
    if (sobe) menu.style.bottom = `${vh - r.top + 4}px`;
    else menu.style.top = `${r.bottom + 4}px`;
  }

  function abre(select, teclado) {
    fecha();
    const ops = Array.from(select.options).filter((op) => !op.hidden && !op.disabled);
    if (!ops.length) return;
    const veu = document.createElement("div");
    veu.className = "srt-veu";
    const menu = document.createElement("div");
    menu.className = "srt-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", t("sort.label").replace(/:\s*$/, ""));
    menu.innerHTML = ops.map(linha).join("");
    document.body.append(veu, menu);
    posiciona(select, menu);
    aberto = { select, menu, veu, teclado };
    const atual = menu.querySelector('[aria-selected="true"]') || menu.querySelector(".srt-opt");
    menu.scrollTop = Math.max(0, atual.offsetTop - (menu.clientHeight - atual.offsetHeight) / 2);
    // Foco só no teclado: no toque, mover o foco pra dentro da folha não
    // ajuda ninguém e, no iPhone, o foco de volta num <select> abre a roleta.
    if (teclado) atual.focus();
  }

  function fecha(devolveFoco) {
    if (!aberto) return;
    const { select, menu, veu } = aberto;
    aberto = null;
    menu.remove();
    veu.remove();
    if (devolveFoco && select.isConnected) select.focus();
  }

  function escolhe(valor) {
    const { select, teclado } = aberto;
    fecha(teclado);
    if (select.value === valor) return;
    select.value = valor;
    // Os mesmos eventos da lista nativa, na mesma ordem.
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  document.addEventListener("click", (e) => {
    if (aberto) {
      const op = e.target.closest(".srt-opt");
      if (op && aberto.menu.contains(op)) escolhe(op.dataset.v);
      else if (e.target.closest(".srt-veu")) fecha();
      return;
    }
    const host = e.target.closest(".srt-host");
    const select = host && host.querySelector("select[data-ordenar]");
    if (!select || select.disabled) return;
    // Num <label>, o clique seguiria pro <select> — e no iPhone abriria a
    // roleta nativa por baixo do menu.
    e.preventDefault();
    abre(select, e.detail === 0);
  });

  document.addEventListener("keydown", (e) => {
    if (aberto) {
      const itens = Array.from(aberto.menu.querySelectorAll(".srt-opt"));
      const i = itens.indexOf(document.activeElement);
      if (e.key === "Escape" || e.key === "Tab") {
        // O Esc fecha SÓ o menu: o seletor de Vendas (um modal) também ouve
        // Esc no document, e este listener, registrado antes, vem primeiro.
        e.preventDefault();
        e.stopImmediatePropagation();
        fecha(true);
        return;
      }
      let j = -1;
      if (e.key === "ArrowDown") j = i < 0 ? 0 : (i + 1) % itens.length;
      else if (e.key === "ArrowUp") j = i < 0 ? itens.length - 1 : (i - 1 + itens.length) % itens.length;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = itens.length - 1;
      if (j >= 0) { e.preventDefault(); itens[j].focus(); }
      return;
    }
    const s = e.target;
    if (!(s instanceof HTMLSelectElement) || !s.hasAttribute("data-ordenar") || e.ctrlKey || e.metaKey) return;
    if (e.key === " " || e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "F4") {
      e.preventDefault();
      abre(s, true);
    }
  });

  // A grade andou por baixo ou a janela mudou: o menu pendurado ficaria solto.
  window.addEventListener("scroll", () => fecha(), { passive: true });
  window.addEventListener("resize", () => fecha());

  document.querySelectorAll("select[data-ordenar]").forEach(preenche);

  window.TCGOrdenar = { PADRAO, chaves, valida, rotulo, opcoes, compara };
})();
