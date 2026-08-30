// "Testar mão" (goldfish) do editor de decks: embaralha, compra a mão inicial,
// deixa dar mulligan e comprar mais uma.
//
// É o brinquedo que faz gente abrir Moxfield e Archidekt todo dia — e aqui era
// o item mais barato da lista, porque `deck.zones.main` já é bem definido e
// embaralhável em TODOS os pacotes de regra, e o tamanho da mão inicial é dado
// de REGRA (`pack.hand`, em src/deck-rules.js), não número chutado na tela.
//
// ARQUIVO PRÓPRIO, carregado só nas duas páginas do editor: o shared.js está a
// 97% do orçamento de peso e viaja em todas as páginas do site.
//
// Puro cliente. Não grava nada, não fala com a rede, não altera o deck.
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const { t, escapeHtml, escapeAttribute } = shared;

  // Fisher-Yates. Math.random basta: isto é um brinquedo de treino, não sorteio
  // — e um PRNG "melhor" só adicionaria código sem mudar o que a pessoa sente.
  function embaralha(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // O deck guarda ENTRADAS com quantidade ("4× Raio"); a pilha precisa das
  // cópias soltas, senão embaralhar não significaria nada.
  function pilhaDe(deck, pack, byId) {
    const fora = new Set();
    // Zonas que NÃO entram na pilha: quem começa em jogo (Leader) e quem tem
    // pilha própria (Digi-Egg, Extra, Side, Maybe). Sem isso o Leader do One
    // Piece apareceria na mão, que é justamente o erro que confunde quem testa.
    (pack.zones || []).forEach((z) => {
      if (z.key !== "main") fora.add(z.key);
    });
    const out = [];
    Object.keys(deck.zones || {}).forEach((zona) => {
      if (fora.has(zona)) return;
      (deck.zones[zona] || []).forEach((e) => {
        const card = byId[e.id];
        const n = Math.max(0, Math.min(Number(e.qty) || 0, 200)); // trava de sanidade
        for (let i = 0; i < n; i++) out.push(card || { id: e.id, name: e.id });
      });
    });
    return out;
  }

  function abrir(deck, pack, byId) {
    const base = pilhaDe(deck, pack, byId);
    if (!base.length) { shared.toastSimples(t("gf.empty")); return; }
    const tamanho = Math.max(1, Number(pack && pack.hand) || 7);

    let pilha = [];
    let mao = [];
    let mulligans = 0;

    const novaMao = (contaMulligan) => {
      if (contaMulligan) mulligans++;
      pilha = embaralha(base.slice());
      mao = pilha.splice(0, Math.min(tamanho, pilha.length));
      pinta();
    };
    const compra = () => {
      if (!pilha.length) return;
      mao.push(pilha.shift());
      pinta();
    };

    const wrap = document.createElement("div");
    wrap.className = "list-modal gf-modal";
    document.body.appendChild(wrap);
    document.body.classList.add("preview-open");

    function cartaHtml(card) {
      const src = shared.cardImageSources ? shared.cardImageSources(card) : null;
      const img = src && src.url
        ? shared.localizedImg(src.url, { alt: card.name || "", fallback: src.fallback, thumb: true, sizes: shared.SIZES_CARD_TILE })
        : `<span class="gf-noimg">${escapeHtml(card.name || card.id || "")}</span>`;
      return `<li class="gf-card" title="${escapeAttribute(card.name || card.id || "")}">${img}</li>`;
    }

    function pinta() {
      // A contagem do que sobrou no deck é metade da informação: "abri sem
      // terreno" só quer dizer algo junto de "e ainda tenho 53 cartas".
      const resumo = t("gf.count", { n: mao.length, resto: pilha.length })
        + (mulligans ? ` · ${t("gf.mulligans", { n: mulligans })}` : "");
      wrap.innerHTML = `
        <div class="list-modal-box gf-box" role="dialog" aria-modal="true" aria-label="${escapeAttribute(t("gf.title"))}">
          <h2>${escapeHtml(t("gf.title"))}</h2>
          <p class="list-modal-hint">${escapeHtml(resumo)}</p>
          <ul class="gf-hand">${mao.map(cartaHtml).join("")}</ul>
          <div class="list-modal-foot">
            <button type="button" class="cta" data-gf-mull>${escapeHtml(t("gf.mulligan"))}</button>
            <button type="button" class="lst-mini" data-gf-draw${pilha.length ? "" : " disabled"}>${escapeHtml(t("gf.draw"))}</button>
            <button type="button" class="lst-mini" data-gf-close>${escapeHtml(t("export.close"))}</button>
          </div>
        </div>`;
    }

    const fechar = () => {
      wrap.remove();
      document.body.classList.remove("preview-open");
      document.removeEventListener("keydown", tecla);
    };
    const tecla = (ev) => { if (ev.key === "Escape") fechar(); };
    document.addEventListener("keydown", tecla);
    wrap.addEventListener("click", (ev) => {
      if (ev.target === wrap || ev.target.closest("[data-gf-close]")) { fechar(); return; }
      if (ev.target.closest("[data-gf-mull]")) { novaMao(true); return; }
      if (ev.target.closest("[data-gf-draw]")) { compra(); }
    });

    novaMao(false);
  }

  window.TCGGoldfish = { abrir, pilhaDe, embaralha };
})();
