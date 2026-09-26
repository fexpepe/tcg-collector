// Fichário: a grade de cartas vira páginas de N bolsos (2×2, 3×3, 3×4, 4×4)
// numa trilha que ROLA DE LADO com scroll-snap — no celular é o dedo, no
// desktop as setas, o <select> de página ou a rolagem horizontal. Só a imagem
// da carta aparece (nome, número e botões somem por CSS em .is-binder; clicar
// na carta abre o card, como sempre). Os tiles são os MESMOS da grade normal —
// o refresh de posse e os handlers da grade seguem valendo sem saber do modo.
//
// Nasceu na página de set (detail.js, 2026-09-14) e saiu de lá em 2026-09-16,
// quando a Minha Coleção ganhou o mesmo modo: UMA implementação pras duas telas
// (e pras próximas), fora do shared.js por causa do teto de peso dele — só
// quem tem grade com fichário carrega este arquivo.
//
// Cada página nasce com os N bolsos VAZIOS (caixas na proporção da carta) e
// só recebe os tiles quando fica a 1 página de distância da atual: uma grade
// grande (YGO passa de 1000 impressões; uma coleção inteira também) não paga
// o DOM inteiro de uma vez, e a altura da trilha não pula porque os bolsos já
// ocupam o lugar.
//
// Contrato: createBinderView({ root, grid, storageKey, onPage? }) — `root` é o
// elemento que recebe os eventos (setas, select, bolinhas, teclado) e contém
// TODA grade que possa virar fichário; `grid` é a grade padrão; `storageKey`
// guarda o nº de bolsos escolhido (preferência por página, como o modo de
// visualização); `onPage(idx)` avisa quando a página aberta muda.
//   .render(tiles, tileOf, { grid?, layout?, start? })  monta o fichário
//      (limpa a grade antes). `layout: { cols, rows }` fixa o formato em vez
//      da preferência de bolsos — é o binder de verdade (binders.js), que tem
//      o formato dele (2×2 … 5×5) e não troca pelo botão; `start` abre numa
//      página específica.
//   .cycle()                            próximo tamanho (9 → 12 → 16 → 4 → 9…)
//   .paintToggle(button)                número de bolsos no botão do seletor
//   .pockets                            nº de bolsos atual
(function () {
  const shared = window.TCGShared;
  const { t, escapeHtml, escapeAttribute } = shared;

  // A sequência é a de clicar de novo no botão com o modo já ativo; nasce em 9
  // (3×3), que é o fichário mais comum.
  const POCKETS = [9, 12, 16, 4];
  const ICONS = {
    first: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>',
    last: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>',
    book: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 3v18"/></svg>'
  };

  function createBinderView({ root, grid, storageKey, onPage }) {
    let pockets = storageKey ? Number(localStorage.getItem(storageKey)) : 9;
    if (!POCKETS.includes(pockets)) pockets = 9;
    let binder = null;   // { grid, rail, pages, tiles, tileOf, per, current, rendered:Set, pageCount, nav, dots }
    let lembrada = 0;    // página aberta: sobrevive à troca de filtro/ordenação enquanto existir

    function render(tiles, tileOf, { grid: alvo, layout, start } = {}) {
      const el = alvo || grid;
      el.innerHTML = "";
      const per = layout ? layout.cols * layout.rows : pockets;
      const cols = layout ? layout.cols : per === 4 ? 2 : per === 16 ? 4 : 3;
      // Linhas entram no CSS pra limitar a largura da trilha de modo que a
      // PÁGINA INTEIRA caiba na altura da tela no desktop (ver .binder-rail).
      el.style.setProperty("--binder-rows", String(per / cols));
      el.style.setProperty("--binder-cols", String(cols));
      const pageCount = Math.max(1, Math.ceil(tiles.length / per));
      const nav = document.createElement("div");
      nav.className = "binder-nav";
      const opcoes = Array.from({ length: pageCount }, (_, i) => `<option value="${i}">${escapeHtml(t("binder.page", { n: i + 1 }))}</option>`).join("");
      nav.innerHTML = `
        <button type="button" class="binder-btn" data-binder-go="first" aria-label="${escapeAttribute(t("binder.first"))}" title="${escapeAttribute(t("binder.first"))}">${ICONS.first}</button>
        <button type="button" class="binder-btn" data-binder-go="prev" aria-label="${escapeAttribute(t("binder.prev"))}" title="${escapeAttribute(t("binder.prev"))}">${ICONS.prev}</button>
        <label class="binder-page-pick">${ICONS.book}<span class="sr-only">${escapeHtml(t("binder.pickPage"))}</span><select data-binder-select>${opcoes}</select><span class="binder-page-total">/ ${pageCount}</span></label>
        <button type="button" class="binder-btn" data-binder-go="next" aria-label="${escapeAttribute(t("binder.next"))}" title="${escapeAttribute(t("binder.next"))}">${ICONS.next}</button>
        <button type="button" class="binder-btn" data-binder-go="last" aria-label="${escapeAttribute(t("binder.last"))}" title="${escapeAttribute(t("binder.last"))}">${ICONS.last}</button>`;
      const rail = document.createElement("div");
      rail.className = "binder-rail";
      rail.setAttribute("aria-label", t("binder.railAria"));
      const pages = [];
      for (let p = 0; p < pageCount; p++) {
        const page = document.createElement("section");
        page.className = "binder-page";
        page.dataset.binderPage = String(p);
        page.setAttribute("aria-label", t("binder.pageOf", { n: p + 1, t: pageCount }));
        for (let i = 0; i < per; i++) {
          const pocket = document.createElement("div");
          pocket.className = "binder-pocket";
          page.appendChild(pocket);
        }
        rail.appendChild(page);
        pages.push(page);
      }
      // Bolinhas de página (como no app Dex). Acima de 24 páginas viram ruído —
      // o <select> e as setas já navegam; as bolinhas somem.
      const dots = document.createElement("div");
      dots.className = "binder-dots";
      if (pageCount > 1 && pageCount <= 24) {
        dots.innerHTML = Array.from({ length: pageCount }, (_, i) => `<button type="button" class="binder-dot" data-binder-dot="${i}" aria-label="${escapeAttribute(t("binder.page", { n: i + 1 }))}"></button>`).join("");
      }
      el.append(nav, rail, dots);
      binder = { grid: el, rail, pages, tiles, tileOf, per, current: 0, rendered: new Set(), pageCount, nav, dots };
      // Mudou o nº de páginas e a lembrada não existe mais: volta pro início.
      if (Number.isInteger(start)) lembrada = Math.max(0, Math.min(pageCount - 1, start));
      binder.current = lembrada < pageCount ? lembrada : 0;
      ensurePages(binder.current);
      paintNav();
      if (binder.current > 0) {
        // Sem animação: a página já abre no lugar certo (e o `scrollTo` com
        // behavior instant não dispara o scroll-snap do meio do caminho).
        requestAnimationFrame(() => { rail.scrollLeft = binder.current * rail.clientWidth; });
      }
      let raf = 0;
      rail.addEventListener("scroll", () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (!binder || binder.rail !== rail || !rail.clientWidth) return;
          const idx = Math.max(0, Math.min(binder.pageCount - 1, Math.round(rail.scrollLeft / rail.clientWidth)));
          if (idx !== binder.current) {
            binder.current = idx;
            lembrada = idx;
            paintNav();
            if (onPage) onPage(idx);
          }
          // Pré-monta a vizinha pra qual o dedo está indo.
          ensurePages(idx);
        });
      }, { passive: true });
    }

    function ensurePages(idx) {
      if (!binder) return;
      for (let p = idx - 1; p <= idx + 1; p++) {
        if (p < 0 || p >= binder.pageCount || binder.rendered.has(p)) continue;
        binder.rendered.add(p);
        const pocketsEl = binder.pages[p].children;
        for (let i = 0; i < binder.per; i++) {
          const item = binder.tiles[p * binder.per + i];
          if (!item) break;
          pocketsEl[i].appendChild(binder.tileOf(item));
          pocketsEl[i].classList.add("is-filled");
        }
      }
    }

    function paintNav() {
      if (!binder) return;
      const { current, pageCount, nav, dots } = binder;
      const sel = nav.querySelector("[data-binder-select]");
      if (sel && Number(sel.value) !== current) sel.value = String(current);
      nav.querySelector('[data-binder-go="first"]').disabled = current <= 0;
      nav.querySelector('[data-binder-go="prev"]').disabled = current <= 0;
      nav.querySelector('[data-binder-go="next"]').disabled = current >= pageCount - 1;
      nav.querySelector('[data-binder-go="last"]').disabled = current >= pageCount - 1;
      dots.querySelectorAll("[data-binder-dot]").forEach((d) => {
        d.setAttribute("aria-current", Number(d.dataset.binderDot) === current ? "page" : "false");
      });
    }

    function goTo(idx) {
      if (!binder) return;
      const alvo = Math.max(0, Math.min(binder.pageCount - 1, idx));
      ensurePages(alvo);
      binder.rail.scrollTo({ left: alvo * binder.rail.clientWidth, behavior: "smooth" });
      // O evento de scroll acerta current/nav quando a rolagem chegar; aqui só
      // pra resposta imediata nos botões (clicar rápido em › › ›).
      binder.current = alvo;
      lembrada = alvo;
      paintNav();
      if (onPage) onPage(alvo);
    }

    // O fichário ativo é o que está no DOM: depois de um re-render da página
    // em outro modo (grade, lista) o `binder` antigo fica órfão e os eventos
    // dele não podem mexer em nada.
    const vivo = () => binder && binder.rail.isConnected;

    root.addEventListener("click", (event) => {
      if (!vivo()) return;
      const go = event.target.closest("[data-binder-go]");
      if (go) {
        const { current, pageCount } = binder;
        const dir = go.dataset.binderGo;
        goTo(dir === "first" ? 0 : dir === "prev" ? current - 1 : dir === "next" ? current + 1 : pageCount - 1);
        return;
      }
      const dot = event.target.closest("[data-binder-dot]");
      if (dot) goTo(Number(dot.dataset.binderDot));
    });
    root.addEventListener("change", (event) => {
      const sel = event.target.closest("[data-binder-select]");
      if (sel && vivo()) goTo(Number(sel.value));
    });
    // Setas do teclado quando o foco está no fichário (ou nas setas dele).
    root.addEventListener("keydown", (event) => {
      if (!vivo() || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      if (!binder.grid.contains(event.target)) return;
      if (event.target.closest("select")) return; // o select usa as setas pra si
      event.preventDefault();
      goTo(binder.current + (event.key === "ArrowLeft" ? -1 : 1));
    });

    // Já no fichário: o clique no botão troca o tamanho. Página 2 de 9 bolsos
    // não é a de 16: recomeça.
    function cycle() {
      pockets = POCKETS[(POCKETS.indexOf(pockets) + 1) % POCKETS.length];
      try { localStorage.setItem(storageKey, String(pockets)); } catch (e) { /* ignora */ }
      lembrada = 0;
    }

    // O botão do fichário diz quantos bolsos tem (número no canto + título):
    // é ele que troca o tamanho, então precisa mostrar o estado atual.
    function paintToggle(button) {
      if (!button) return;
      const badge = button.querySelector("[data-binder-badge]");
      if (badge) badge.textContent = String(pockets);
      const rotulo = t("view.binderPockets", { n: pockets });
      button.title = rotulo;
      button.setAttribute("aria-label", rotulo);
      button.removeAttribute("data-i18n-title");
      button.removeAttribute("data-i18n-aria");
    }

    return { render, cycle, paintToggle, get pockets() { return pockets; } };
  }

  window.TCGBinderView = { POCKETS, createBinderView };
})();
