// Medidor de centralização (E1). Carrega uma foto da carta, você arrasta quatro
// guias até a borda INTERNA da moldura, e ele diz os percentuais — 55/45,
// 60/40 — que as graduadoras usam pra pontuar centralização.
//
// A FOTO NUNCA SAI DO NAVEGADOR. Nem upload, nem canvas, nem IndexedDB: a
// imagem vira um object URL local e é revogada ao fechar. Isso não é detalhe
// de implementação, é a feature — Shiny e PriceCharting COBRAM por isto, e o
// argumento do Sleevu é que aqui é grátis e a foto não viaja.
//
// ARQUIVO PRÓPRIO, carregado só na página de Graded: o shared.js está a 97% do
// orçamento de peso e viaja em todas as páginas do site.
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const { t, escapeHtml, escapeAttribute } = shared;

  // Guias em FRAÇÃO da imagem (0..1), não em pixel: assim elas sobrevivem a
  // rotação de tela e a redimensionamento da janela sem sair do lugar.
  const INICIAL = { esq: 0.10, dir: 0.90, topo: 0.10, base: 0.90 };
  const LADOS = ["esq", "dir", "topo", "base"];

  function pct(a, b) {
    const tot = a + b;
    if (tot <= 0) return [50, 50];
    const x = Math.round((a / tot) * 100);
    return [x, 100 - x];
  }

  function abrir() {
    let url = "";
    let g = Object.assign({}, INICIAL);
    let arrastando = null;
    let arrastou = false;

    const wrap = document.createElement("div");
    wrap.className = "list-modal ctr-modal";
    document.body.appendChild(wrap);
    document.body.classList.add("preview-open");

    function medidas() {
      // Margem esquerda = da borda da carta até a guia; direita = da guia até a
      // borda oposta. A foto tem que estar RECORTADA na carta — é o que o texto
      // de instrução pede, e o que torna a conta honesta.
      const [le, ld] = pct(g.esq, 1 - g.dir);
      const [lt, lb] = pct(g.topo, 1 - g.base);
      return { le, ld, lt, lb };
    }

    function pinta() {
      const m = medidas();
      const linha = (lado) => {
        const vertical = lado === "esq" || lado === "dir";
        const estilo = vertical ? `left:${(g[lado] * 100).toFixed(2)}%` : `top:${(g[lado] * 100).toFixed(2)}%`;
        return `<button type="button" class="ctr-guia ctr-${vertical ? "v" : "h"}" style="${estilo}" data-ctr-guia="${lado}" aria-label="${escapeAttribute(t("ctr.guide." + lado))}"></button>`;
      };
      wrap.innerHTML = `
        <div class="list-modal-box ctr-box" role="dialog" aria-modal="true" aria-label="${escapeAttribute(t("ctr.title"))}">
          <h2>${escapeHtml(t("ctr.title"))}</h2>
          ${url ? "" : `<p class="list-modal-hint">${escapeHtml(t("ctr.intro"))}</p>`}
          ${url ? `
            <p class="list-modal-hint">${escapeHtml(t("ctr.howto"))}</p>
            <div class="ctr-palco">
              <img class="ctr-foto" src="${escapeAttribute(url)}" alt="">
              ${LADOS.map(linha).join("")}
            </div>
            <div class="ctr-res">
              <span><strong>${m.le}/${m.ld}</strong> ${escapeHtml(t("ctr.horizontal"))}</span>
              <span><strong>${m.lt}/${m.lb}</strong> ${escapeHtml(t("ctr.vertical"))}</span>
            </div>
            <p class="ctr-nota">${escapeHtml(t("ctr.note"))}</p>
          ` : ""}
          <div class="list-modal-foot">
            <label class="cta ctr-file">${escapeHtml(t(url ? "ctr.other" : "ctr.pick"))}
              <input type="file" accept="image/*" data-ctr-input hidden>
            </label>
            ${url ? `<button type="button" class="lst-mini" data-ctr-reset>${escapeHtml(t("ctr.reset"))}</button>` : ""}
            <button type="button" class="lst-mini" data-ctr-close>${escapeHtml(t("export.close"))}</button>
          </div>
        </div>`;
    }

    const fechar = () => {
      if (url) URL.revokeObjectURL(url); // a foto sai da memória junto com a janela
      wrap.remove();
      document.body.classList.remove("preview-open");
      document.removeEventListener("keydown", tecla);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", solta);
    };
    const tecla = (ev) => { if (ev.key === "Escape") fechar(); };

    // Arrastar com pointer events: um caminho só pro dedo e pro mouse.
    function move(ev) {
      if (!arrastando) return;
      const palco = wrap.querySelector(".ctr-palco");
      if (!palco) return;
      const r = palco.getBoundingClientRect();
      const vertical = arrastando === "esq" || arrastando === "dir";
      const f = vertical ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
      // Trava de 1%..99% e impede que as guias se cruzem — guia invertida daria
      // percentual negativo, que não quer dizer nada.
      const limpo = Math.min(0.99, Math.max(0.01, f));
      if (arrastando === "esq") g.esq = Math.min(limpo, g.dir - 0.02);
      else if (arrastando === "dir") g.dir = Math.max(limpo, g.esq + 0.02);
      else if (arrastando === "topo") g.topo = Math.min(limpo, g.base - 0.02);
      else g.base = Math.max(limpo, g.topo + 0.02);
      arrastou = true;
      posiciona();
      ev.preventDefault();
    }
    // Repinta SÓ as guias e o número enquanto arrasta: reconstruir o innerHTML
    // a cada pointermove trocaria o <img> de lugar e faria a foto piscar.
    function posiciona() {
      LADOS.forEach((lado) => {
        const el = wrap.querySelector(`[data-ctr-guia="${lado}"]`);
        if (!el) return;
        if (lado === "esq" || lado === "dir") el.style.left = `${(g[lado] * 100).toFixed(2)}%`;
        else el.style.top = `${(g[lado] * 100).toFixed(2)}%`;
      });
      const m = medidas();
      const res = wrap.querySelectorAll(".ctr-res strong");
      if (res[0]) res[0].textContent = `${m.le}/${m.ld}`;
      if (res[1]) res[1].textContent = `${m.lt}/${m.lb}`;
    }
    const solta = () => { arrastando = null; };

    document.addEventListener("keydown", tecla);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", solta);

    wrap.addEventListener("pointerdown", (ev) => {
      const guia = ev.target.closest("[data-ctr-guia]");
      if (guia) { arrastando = guia.dataset.ctrGuia; arrastou = false; ev.preventDefault(); }
    });
    wrap.addEventListener("click", (ev) => {
      // Uma guia arrastada até fora da caixa solta o dedo no FUNDO do modal, e
      // o click que nasce daí tem o fundo como alvo — ou seja, o gesto de medir
      // fechava a janela e jogava a foto fora. Engole o click que veio de um
      // arrasto.
      if (arrastou) { arrastou = false; return; }
      if (ev.target === wrap || ev.target.closest("[data-ctr-close]")) { fechar(); return; }
      if (ev.target.closest("[data-ctr-reset]")) { g = Object.assign({}, INICIAL); posiciona(); }
    });
    wrap.addEventListener("change", (ev) => {
      const inp = ev.target.closest("[data-ctr-input]");
      if (!inp || !inp.files || !inp.files[0]) return;
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(inp.files[0]);
      g = Object.assign({}, INICIAL);
      pinta();
    });
    // Teclado: as guias são <button>, então seta move de 0,5% em 0,5%.
    wrap.addEventListener("keydown", (ev) => {
      const guia = ev.target.closest("[data-ctr-guia]");
      if (!guia) return;
      const lado = guia.dataset.ctrGuia;
      const vertical = lado === "esq" || lado === "dir";
      const d = (ev.key === (vertical ? "ArrowLeft" : "ArrowUp")) ? -0.005
        : (ev.key === (vertical ? "ArrowRight" : "ArrowDown")) ? 0.005 : 0;
      if (!d) return;
      const alvo = Math.min(0.99, Math.max(0.01, g[lado] + d));
      if (lado === "esq") g.esq = Math.min(alvo, g.dir - 0.02);
      else if (lado === "dir") g.dir = Math.max(alvo, g.esq + 0.02);
      else if (lado === "topo") g.topo = Math.min(alvo, g.base - 0.02);
      else g.base = Math.max(alvo, g.topo + 0.02);
      posiciona();
      ev.preventDefault();
    });

    pinta();
  }

  // O script é `defer` e só existe na página de Graded: quando ele roda, o
  // documento já está parseado e o botão está no DOM.
  const botao = document.getElementById("gradedCenteringBtn");
  if (botao) botao.addEventListener("click", abrir);

  window.TCGCentering = { abrir, pct };
})();
