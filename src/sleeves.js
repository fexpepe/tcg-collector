// Sleeves e fichários (sleeves.html, 2026-10-01): quanto de proteção comprar —
// sleeve no tamanho certo (padrão 63×88 ou japonês 59×86), inner pro sleeve
// duplo, folhas de fichário, fichários, penny sleeves e toploaders.
// Ver docs/FERRAMENTAS.md.
//
// A conta é pura e não grava nada. Os dois atalhos leem o que a pessoa já tem:
// "Usar minha coleção" separa as cópias soltas por valor (as caras vão pro
// toploader, o resto pro fichário — slab não entra, já está protegido) e
// "Usar meus decks" soma as cartas de todas as zonas de cada deck salvo. O
// valor de cada carta vem da mesma carga do HUB (a borda devolve só as cartas
// que a pessoa tem), então a única rede aqui é essa.
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const { t, tn, escapeHtml: esc } = shared;

  // Medidas de referência (mm) das marcas mais comuns. Inner = "perfect fit".
  const TAM = {
    padrao: { rot: "slv.std", carta: [63, 88], inner: [64, 89], sleeve: [66, 91], jogos: "slv.stdGames" },
    jp: { rot: "slv.jp", carta: [59, 86], inner: [60, 87], sleeve: [62, 89], jogos: "slv.jpGames" }
  };
  // Pacote de referência de cada item — só pra dar a ordem de grandeza.
  const PACOTE = { sleeve: 100, inner: 100, penny: 100, top: 25 };
  const BOLSOS = [4, 9, 12];
  const DECKS_KEY = "tcg-collector-decks-all-v1"; // o store global do decks.js

  // A conta inteira, sem DOM: o tests/ferramentas.test.mjs bate nela.
  function conta(s) {
    const cap = s.bolsos * (s.doisLados ? 2 : 1);
    const folhas = s.fich > 0 ? Math.ceil(s.fich / cap) : 0;
    // Bolsos ocupados na ÚLTIMA folha (cheia = cap).
    const resto = s.fich > 0 ? (s.fich % cap || cap) : 0;
    const sleeves = s.decks * s.porDeck;
    return {
      cap, folhas, resto, sleeves,
      inner: s.duplo ? sleeves : 0,
      fichs: folhas ? Math.ceil(folhas / Math.max(1, s.folhasFich)) : 0
    };
  }
  // Pacotes pra cobrir `qtd` e quanto sobra do último.
  function pacotes(qtd, por) {
    if (!qtd) return null;
    const n = Math.ceil(qtd / por);
    return { n, sobra: n * por - qtd };
  }
  // Decks salvos: quantos e quantas cartas no total (todas as zonas — o lado,
  // o líder e o extra também vão de sleeve).
  function cartasDosDecks(dados) {
    const decks = (dados && Array.isArray(dados.decks)) ? dados.decks : [];
    let cartas = 0;
    decks.forEach((d) => {
      Object.values((d && d.zones) || {}).forEach((zona) => {
        (Array.isArray(zona) ? zona : []).forEach((e) => { cartas += Math.max(0, Number(e && e.qty) || 0); });
      });
    });
    return { decks: decks.length, cartas };
  }
  // Quantas cópias valem `limite` ou mais: linhas = [unitário, quantidade].
  function separaPorValor(linhas, limite) {
    let top = 0;
    linhas.forEach(([unit, qtd]) => { if (unit >= limite) top += qtd; });
    return top;
  }

  const num = (n) => Number(n).toLocaleString(shared.getLocale());
  const ic = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    sleeve: ic('<path d="M4 7v13a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V7"/><rect x="6.5" y="3" width="11" height="15" rx="1.5"/>'),
    inner: ic('<rect x="5" y="3" width="14" height="18" rx="1.5" stroke-dasharray="2.5 2"/><rect x="7.5" y="5.5" width="9" height="13" rx="1"/>'),
    folha: ic('<rect x="4" y="3" width="16" height="18"/><path d="M9.3 3v18M14.7 3v18M4 9h16M4 15h16"/>'),
    fichario: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'),
    penny: ic('<rect x="6" y="3" width="12" height="18" rx="1"/><path d="M6 6.5h12"/>'),
    top: ic('<rect x="5" y="2.5" width="14" height="19"/><rect x="7.5" y="6.5" width="9" height="12.5" rx="1"/><path d="M5 4.5h14"/>'),
    carrinho: ic('<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.4a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L21 7H6"/>'),
    colecao: ic('<rect x="4" y="6" width="12" height="16" rx="2" transform="rotate(-8 10 14)"/><rect x="9" y="4" width="12" height="16" rx="2" transform="rotate(6 15 12)"/>'),
    decks: ic('<rect x="7" y="3" width="12" height="16" rx="2"/><path d="M4.5 6.5v12a2 2 0 0 0 2 2h9"/>'),
    menos: ic('<path d="M5 12h14"/>'),
    mais: ic('<path d="M12 5v14M5 12h14"/>'),
    copia: ic('<rect x="9" y="9" width="12" height="12"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>')
  };

  // Carta, inner e sleeve EM ESCALA (1 unidade = 1 mm), centrados num quadro
  // fixo de 70×95: trocar pro japonês encolhe o desenho de verdade.
  function desenho(tam) {
    const r = ([w, h], cls, rx) => `<rect class="${cls}" x="${(70 - w) / 2}" y="${(95 - h) / 2}" width="${w}" height="${h}" rx="${rx}"/>`;
    const [cw, ch] = tam.carta;
    return `<svg viewBox="0 0 70 95" aria-hidden="true">${r(tam.sleeve, "slv-sl-out", 1)}${r(tam.inner, "slv-sl-in", 1)}${r(tam.carta, "slv-sl-card", 3)}<rect class="slv-sl-art" x="${(70 - cw) / 2 + 5}" y="${(95 - ch) / 2 + 8}" width="${cw - 10}" height="${(ch * 0.42).toFixed(1)}"/></svg>`;
  }

  function stepper(chave, valor, rotulo, curto) {
    return `<div class="slv-num${curto ? " is-sm" : ""}">
        <button type="button" data-slv-d="-1" data-slv-k="${chave}" aria-label="${esc(`${t("slv.less")}: ${rotulo}`)}">${IC.menos}</button>
        <input type="number" inputmode="numeric" min="0" max="99999" value="${valor}" data-slv-in="${chave}" aria-label="${esc(rotulo)}">
        <button type="button" data-slv-d="1" data-slv-k="${chave}" aria-label="${esc(`${t("slv.more")}: ${rotulo}`)}">${IC.mais}</button>
      </div>`;
  }

  // Símbolo da moeda da pessoa (R$, US$, €) pro campo do valor mínimo.
  function simboloMoeda() {
    try {
      const parte = new Intl.NumberFormat(shared.getLocale(), { style: "currency", currency: shared.getCurrency() }).formatToParts(1).find((p) => p.type === "currency");
      return parte ? parte.value : shared.getCurrency();
    } catch (e) { return shared.getCurrency(); }
  }

  function iniciar(app) {
    const s = { tam: "padrao", fich: 0, bolsos: 9, doisLados: true, folhasFich: 20, decks: 1, porDeck: 60, duplo: true, top: 0, limite: 20 };
    const PASSO = { fich: 10, top: 1, decks: 1, porDeck: 1, folhasFich: 1, limite: 5 };
    const MINIMO = { folhasFich: 1, decks: 0, porDeck: 0, fich: 0, top: 0, limite: 0 };
    // Coleção: as cópias soltas e o [unitário, quantidade] de cada linha com
    // preço, guardados pra o valor mínimo mudar sem recarregar nada.
    const col = { ligado: false, carregando: false, copias: 0, linhas: null };

    function itens() {
      const c = conta(s);
      const tam = TAM[s.tam];
      const pk = (qtd, por) => {
        const p = pacotes(qtd, por);
        if (!p) return "";
        return tn("slv.pack", p.n, { p: por }) + (p.sobra ? ` · ${t("slv.left", { n: num(p.sobra) })}` : "");
      };
      return [
        { ic: "sleeve", nome: t("slv.i.sleeve", { d: tam.sleeve.join("×") }), q: c.sleeves, det: [tn("slv.d.decks", s.decks, { n: num(s.decks), c: num(s.porDeck) }), pk(c.sleeves, PACOTE.sleeve)], pacote: pk(c.sleeves, PACOTE.sleeve) },
        s.duplo && { ic: "inner", nome: t("slv.i.inner", { d: tam.inner.join("×") }), q: c.inner, det: [t("slv.d.inner"), pk(c.inner, PACOTE.inner)], pacote: pk(c.inner, PACOTE.inner) },
        { ic: "folha", nome: t("slv.i.pages", { n: s.bolsos }), q: c.folhas, det: [t("slv.d.pages", { n: num(s.fich), p: c.cap }) + (s.doisLados ? ` (${t("slv.d.both")})` : "")] },
        { ic: "fichario", nome: t("slv.i.binders", { n: s.folhasFich }), q: c.fichs, det: [t("slv.d.binders", { n: num(s.folhasFich * c.cap) })] },
        { ic: "penny", nome: t(s.tam === "jp" ? "slv.i.pennyJp" : "slv.i.penny"), q: s.top, det: [t("slv.d.penny"), pk(s.top, PACOTE.penny)], pacote: pk(s.top, PACOTE.penny) },
        { ic: "top", nome: t("slv.i.top"), q: s.top, det: [pk(s.top, PACOTE.top) || t("slv.d.thick")], pacote: pk(s.top, PACOTE.top) }
      ].filter(Boolean);
    }

    // A última folha desenhada, frente (e verso): quantos bolsos ocupados.
    function ultimaFolha() {
      const c = conta(s);
      if (!c.folhas) return "";
      const cols = s.bolsos === 4 ? 2 : s.bolsos === 12 ? 4 : 3;
      const lado = (ocup) => `<div class="slv-page-grid" style="grid-template-columns:repeat(${cols},14px)">${Array.from({ length: s.bolsos }, (_, i) => `<i${i < ocup ? ' class="is-on"' : ""}></i>`).join("")}</div>`;
      const verso = s.doisLados ? lado(Math.max(0, c.resto - s.bolsos)) : "";
      const texto = c.resto === c.cap
        ? esc(t("slv.pageFull", { f: num(c.folhas) }))
        : esc(t("slv.page", { f: "@f", r: "@r", c: c.cap, x: c.cap - c.resto }))
          .replace("@f", `<strong>${num(c.folhas)}</strong>`).replace("@r", `<strong>${c.resto}</strong>`);
      return `<div class="slv-page">${lado(Math.min(c.resto, s.bolsos))}${verso}<p>${texto}</p></div>`;
    }

    function pintaLista() {
      const lista = app.querySelector("[data-slv-lista]");
      lista.innerHTML = `
        <h2 class="slv-list-h">${IC.carrinho}${esc(t("slv.list"))}</h2>
        <ul class="slv-items">${itens().map((it) => `
          <li class="slv-item${it.q ? "" : " is-zero"}">
            <span class="slv-ico">${IC[it.ic]}</span>
            <span class="slv-item-b"><strong>${esc(it.nome)}</strong><span>${esc(it.det.filter(Boolean).join(" · "))}</span></span>
            <span class="slv-qty">${num(it.q)}</span>
          </li>`).join("")}
        </ul>
        ${ultimaFolha()}
        <div class="slv-list-foot">
          <button type="button" class="primary fer-btn" data-slv-copia>${IC.copia}<span>${esc(t("slv.copy"))}</span></button>
        </div>`;
      // Celular: a lista fica embaixo do formulário, então uma faixa presa no
      // rodapé repete os números principais enquanto a pessoa mexe nos campos.
      const c = conta(s);
      const res = [[c.sleeves, "slv.s.sleeves"], [c.folhas, "slv.s.pages"], [c.fichs, "slv.s.binders"], [s.top, "slv.s.top"]].filter(([q]) => q);
      app.querySelector("[data-slv-resumo]").innerHTML = res.length
        ? `<span class="slv-resumo-txt">${res.map(([q, k]) => `<b>${num(q)}</b> ${esc(tn(k, q))}`).join(" · ")}</span><span class="slv-resumo-go">${esc(t("slv.seeList"))}</span>`
        : "";
    }

    function pintaTamanho() {
      const tam = TAM[s.tam];
      app.querySelector("[data-slv-svg]").innerHTML = desenho(tam);
      app.querySelector("[data-slv-dims]").innerHTML = `${esc(t("slv.dims", { c: "@c", i: "@i", s: "@s" }))
        .replace("@c", `<b>${tam.carta.join("×")}</b>`).replace("@i", `<b>${tam.inner.join("×")}</b>`).replace("@s", `<b>${tam.sleeve.join("×")}</b>`)}<br>${esc(t(tam.jogos))}`;
      app.querySelectorAll("[data-slv-tam]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.slvTam === s.tam)));
    }

    function pinta() {
      app.innerHTML = `
        <div class="slv-grid">
          <div class="fer-card slv-form">
            <section class="slv-sec">
              <h2 class="slv-sec-h">${esc(t("slv.size"))}</h2>
              <div class="slv-size">
                <div data-slv-svg></div>
                <div>
                  <div class="slv-seg" role="group" aria-label="${esc(t("slv.size"))}">${Object.entries(TAM).map(([k, tam]) => `
                    <button type="button" data-slv-tam="${k}" aria-pressed="false">${esc(t(tam.rot))}<small>${tam.carta.join("×")} mm</small></button>`).join("")}
                  </div>
                  <p class="slv-dims" data-slv-dims></p>
                </div>
              </div>
            </section>
            <section class="slv-sec">
              <h2 class="slv-sec-h">${esc(t("slv.binder"))}
                <button type="button" class="slv-from" data-slv-colecao aria-pressed="false">${IC.colecao}${esc(t("slv.fromColl"))}</button></h2>
              <p class="slv-note" data-slv-nota-col hidden></p>
              <div class="slv-row"><span class="slv-row-lb">${esc(t("slv.inBinder"))}</span>${stepper("fich", s.fich, t("slv.inBinder"))}</div>
              <div class="slv-opts">
                <span class="slv-pockets" role="group" aria-label="${esc(t("slv.pocketsAria"))}">${BOLSOS.map((b) => `<button type="button" data-slv-bolsos="${b}" aria-pressed="${b === s.bolsos}">${esc(t("slv.pockets", { n: b }))}</button>`).join("")}</span>
                <label class="slv-check"><input type="checkbox" data-slv-lados${s.doisLados ? " checked" : ""}> ${esc(t("slv.bothSides"))}</label>
              </div>
              <div class="slv-row"><span class="slv-row-lb">${esc(t("slv.pagesPer"))}<small>${esc(t("slv.pagesPerHint"))}</small></span>${stepper("folhasFich", s.folhasFich, t("slv.pagesPer"), true)}</div>
            </section>
            <section class="slv-sec">
              <h2 class="slv-sec-h">${esc(t("slv.decks"))}
                <button type="button" class="slv-from" data-slv-decks>${IC.decks}${esc(t("slv.fromDecks"))}</button></h2>
              <p class="slv-note" data-slv-nota-decks hidden></p>
              <div class="slv-row slv-row-deck"><span class="slv-row-lb">${esc(t("slv.decksRow"))}</span>${stepper("decks", s.decks, t("slv.decksAria"), true)}<span class="slv-x" aria-hidden="true">×</span>${stepper("porDeck", s.porDeck, t("slv.perDeckAria"), true)}</div>
              <div class="slv-opts"><label class="slv-check"><input type="checkbox" data-slv-duplo${s.duplo ? " checked" : ""}> ${esc(t("slv.double"))}</label></div>
            </section>
            <section class="slv-sec">
              <h2 class="slv-sec-h">${esc(t("slv.valueSec"))}</h2>
              <div class="slv-row"><span class="slv-row-lb">${esc(t("slv.top"))}<small>${esc(t("slv.topHint"))}</small></span>${stepper("top", s.top, t("slv.top"))}</div>
              <div class="slv-row" data-slv-limite hidden><span class="slv-row-lb">${esc(t("slv.threshold"))} (${esc(simboloMoeda())})<small>${esc(t("slv.thresholdHint"))}</small></span>${stepper("limite", s.limite, t("slv.threshold"), true)}</div>
            </section>
          </div>
          <aside class="fer-card slv-list" data-slv-lista aria-live="polite"></aside>
        </div>
        <button type="button" class="slv-resumo" data-slv-resumo aria-label="${esc(t("slv.seeList"))}"></button>
        <p class="fer-fine">${esc(t("slv.fine"))}</p>`;
      pintaTamanho();
      pintaLista();
    }

    const poe = (chave, v, manual) => {
      s[chave] = Math.max(MINIMO[chave], Math.min(99999, Math.round(Number(v) || 0)));
      const inp = app.querySelector(`[data-slv-in="${chave}"]`);
      if (inp && document.activeElement !== inp) inp.value = s[chave];
      // Mexer na mão no fichário ou no toploader desliga o "Usar minha coleção":
      // os números deixaram de ser os da coleção.
      if (manual && col.ligado && (chave === "fich" || chave === "top")) ligaColecao(false);
      if (chave === "limite" && col.ligado && col.linhas) aplicaColecao();
      pintaLista();
    };

    function notaColecao(texto) {
      const el = app.querySelector("[data-slv-nota-col]");
      el.textContent = texto || "";
      el.hidden = !texto;
    }
    function ligaColecao(ligado) {
      col.ligado = ligado;
      const b = app.querySelector("[data-slv-colecao]");
      b.setAttribute("aria-pressed", String(ligado));
      b.classList.toggle("is-on", ligado);
      app.querySelector("[data-slv-limite]").hidden = !ligado;
      if (!ligado) notaColecao("");
    }
    // Com as linhas de valor na mão: as caras pro toploader, o resto pro fichário.
    function aplicaColecao() {
      const top = separaPorValor(col.linhas, s.limite);
      s.top = top;
      s.fich = Math.max(0, col.copias - top);
      ["top", "fich"].forEach((k) => { const inp = app.querySelector(`[data-slv-in="${k}"]`); if (inp) inp.value = s[k]; });
      notaColecao(t("slv.collNote", { n: num(col.copias), t: num(top) }));
    }
    function usarColecao() {
      if (col.ligado) { ligaColecao(false); return; }
      col.copias = shared.collectionCounts().copies;
      if (!col.copias) { notaColecao(t("slv.collEmpty")); return; }
      ligaColecao(true);
      if (col.linhas) { aplicaColecao(); pintaLista(); return; }
      // Primeiro, o que dá pra saber sem rede: tudo no fichário. O valor de cada
      // carta chega depois, pela mesma carga do HUB.
      poe("fich", col.copias);
      if (col.carregando) return;
      col.carregando = true;
      notaColecao(t("slv.loading"));
      const porJogo = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, shared.createCollectionStore(g)]));
      const precos = Object.fromEntries(shared.GAME_SLUGS.map((g) => [g, shared.createPriceStore(g)]));
      const jogoDe = new Map();
      const gameOf = (id) => jogoDe.get(id) || "pokemon";
      Promise.all([shared.loadOwnedFast(shared.collectionLoadIds(porJogo)), shared.loadFxRates()]).then(([catalogo]) => {
        const cartas = (catalogo && catalogo.cards) || [];
        cartas.forEach((c) => jogoDe.set(c.id, c.game));
        const owned = shared.mergedCollectionStore(porJogo, gameOf);
        const prices = shared.mergedPriceStore(precos, gameOf);
        col.linhas = shared.collectionValueLines(cartas, owned, prices, {}).lines.map((l) => [l.unit, l.quantity]);
        col.carregando = false;
        if (col.ligado) { aplicaColecao(); pintaLista(); }
      }, () => {
        // Sem a carga (rede caiu): fica o "tudo no fichário", que já é verdade.
        col.carregando = false;
        col.linhas = [];
        if (col.ligado) notaColecao(t("slv.collNote", { n: num(col.copias), t: 0 }));
      });
    }

    function usarDecks() {
      let dados = null;
      try { dados = JSON.parse(localStorage.getItem(DECKS_KEY) || "null"); } catch (e) { /* corrompido: trata como vazio */ }
      const d = cartasDosDecks(dados);
      const nota = app.querySelector("[data-slv-nota-decks]");
      nota.hidden = false;
      if (!d.decks || !d.cartas) { nota.textContent = t("slv.decksEmpty"); return; }
      nota.textContent = tn("slv.decksNote", d.decks, { n: num(d.decks), c: num(d.cartas) });
      // Decks de tamanhos diferentes (60 e 100, por ex.): a média arredonda pra
      // CIMA, que é o lado certo de errar na hora de comprar.
      poe("decks", d.decks);
      poe("porDeck", Math.ceil(d.cartas / d.decks));
    }

    app.addEventListener("click", (ev) => {
      const alvo = ev.target;
      const d = alvo.closest("[data-slv-d]");
      if (d) { const k = d.dataset.slvK; return poe(k, s[k] + Number(d.dataset.slvD) * PASSO[k], true); }
      const tam = alvo.closest("[data-slv-tam]");
      if (tam) { s.tam = tam.dataset.slvTam; pintaTamanho(); return pintaLista(); }
      const b = alvo.closest("[data-slv-bolsos]");
      if (b) {
        s.bolsos = Number(b.dataset.slvBolsos);
        app.querySelectorAll("[data-slv-bolsos]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        return pintaLista();
      }
      if (alvo.closest("[data-slv-colecao]")) return usarColecao();
      if (alvo.closest("[data-slv-decks]")) return usarDecks();
      if (alvo.closest("[data-slv-resumo]")) return app.querySelector("[data-slv-lista]").scrollIntoView({ behavior: "smooth", block: "start" });
      const cp = alvo.closest("[data-slv-copia]");
      if (cp && navigator.clipboard) {
        const txt = [t("slv.copyHead")].concat(itens().filter((it) => it.q).map((it) => `- ${num(it.q)} × ${it.nome}${it.pacote ? ` (${it.pacote})` : ""}`)).join("\n");
        navigator.clipboard.writeText(txt).then(() => {
          cp.querySelector("span").textContent = t("export.copied");
        }, () => { /* sem permissão: a lista segue na tela */ });
      }
    });
    app.addEventListener("input", (ev) => {
      const inp = ev.target.closest("[data-slv-in]");
      if (inp) poe(inp.dataset.slvIn, inp.value, true);
    });
    app.addEventListener("change", (ev) => {
      if (ev.target.matches("[data-slv-lados]")) { s.doisLados = ev.target.checked; pintaLista(); }
      if (ev.target.matches("[data-slv-duplo]")) { s.duplo = ev.target.checked; pintaLista(); }
      const inp = ev.target.closest("[data-slv-in]");
      if (inp) inp.value = s[inp.dataset.slvIn]; // normaliza o que foi digitado (vazio, negativo)
    });

    pinta();

    // A faixa do rodapé some quando a própria lista está na tela.
    if ("IntersectionObserver" in window) {
      const resumo = app.querySelector("[data-slv-resumo]");
      new IntersectionObserver((entradas) => {
        resumo.classList.toggle("is-hidden", entradas.some((e) => e.isIntersecting));
      }).observe(app.querySelector("[data-slv-lista]"));
    }
  }

  const app = document.getElementById("slvApp");
  if (app) iniciar(app);

  // Exposto pro tests/ferramentas.test.mjs.
  window.TCGSleeves = { TAM, PACOTE, conta, pacotes, cartasDosDecks, separaPorValor };
})();
