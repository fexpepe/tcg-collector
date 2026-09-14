// Modal de "Exportar" (Liga / texto / CSV) — a PARTE DE TELA do export, que
// vale pra qualquer lista de cartas: a Coleção e a Lista de Desejo (2026-09-14,
// quando a wishlist ganhou os mesmos botões da Coleção) abrem este mesmo modal
// e só dizem de onde vêm as linhas. O gerador do texto continua no
// src/export-liga.js (lógica pura, com testes dourados); aqui é só o DOM: abas
// de formato, seletor de jogo, textarea, copiar/baixar.
//
// A preferência de formato e de jogo é do módulo (não da página): quem exporta
// pra Liga na Coleção quer Liga também na wishlist.
(function () {
  "use strict";

  const FORMATOS = ["liga", "texto", "csv"];
  let formato = "liga";
  let jogo = "";

  // opts:
  //   titulo      — texto do <h2> (já traduzido)
  //   jogos       — slugs dos jogos presentes na lista (o seletor só aparece no
  //                 formato Liga com mais de um jogo: a Liga é por jogo)
  //   rotuloJogo  — (slug) => nome do jogo
  //   texto       — (formato, jogo) => string com o export
  //   escopo      — (nLinhas) => frase "Exportando N cartas…" (já traduzida)
  //   arquivo     — nome-base do arquivo baixado (sem extensão)
  //   vazio       — mensagem do toast quando não há nada pra exportar
  function abrir(opts) {
    const shared = window.TCGShared;
    const { t, escapeHtml, escapeAttribute } = shared;
    const jogos = opts.jogos || [];
    if (!jogos.length) { shared.toastSimples(opts.vazio || t("export.empty")); return; }
    if (!jogos.includes(jogo)) jogo = jogos[0] || "";

    const wrap = document.createElement("div");
    wrap.className = "list-modal";
    document.body.appendChild(wrap);
    document.body.classList.add("preview-open"); // trava a rolagem do fundo

    function pinta() {
      const abas = FORMATOS.map((f) =>
        `<button type="button" class="lst-chip${f === formato ? " is-on" : ""}" data-ex-fmt="${escapeAttribute(f)}">${escapeHtml(t("export.fmt." + f))}</button>`).join("");
      // O seletor de jogo só existe quando ele muda alguma coisa: formato Liga
      // E mais de um jogo na tela.
      const seletorJogo = (formato === "liga" && jogos.length > 1)
        ? `<p class="list-modal-hint">${escapeHtml(t("export.gameHint"))}</p>
           <div class="lst-chips">${jogos.map((g) =>
             `<button type="button" class="lst-chip${g === jogo ? " is-on" : ""}" data-ex-game="${escapeAttribute(g)}">${escapeHtml(opts.rotuloJogo ? opts.rotuloJogo(g) : g)}</button>`).join("")}</div>`
        : "";
      // Liga é POR JOGO (ligamagic, ligapokemon, ligaonepiece…): um texto só com
      // dois jogos misturados não casa em lugar nenhum. Texto e CSV não têm essa
      // restrição e saem com tudo que está na tela.
      const texto = opts.texto(formato, formato === "liga" ? (jogo || jogos[0] || "") : "") || "";
      const nLinhas = texto ? texto.split("\n").filter(Boolean).length : 0;
      wrap.innerHTML = `
        <div class="list-modal-box" role="dialog" aria-modal="true" aria-label="${escapeAttribute(opts.titulo)}">
          <h2>${escapeHtml(opts.titulo)}</h2>
          <div class="lst-chips">${abas}</div>
          ${seletorJogo}
          <p class="list-modal-hint">${escapeHtml(t("export.hint." + formato))}</p>
          <textarea class="lst-export" readonly rows="12">${escapeHtml(texto)}</textarea>
          <p class="list-modal-hint">${escapeHtml(opts.escopo(nLinhas))}</p>
          <div class="list-modal-foot">
            <button type="button" class="cta" data-ex-copy>${escapeHtml(t("export.copy"))}</button>
            <button type="button" class="lst-mini" data-ex-dl>${escapeHtml(t("export.download"))}</button>
            <button type="button" class="lst-mini" data-ex-close>${escapeHtml(t("export.close"))}</button>
          </div>
        </div>`;
    }
    pinta();

    const fechar = () => { wrap.remove(); document.body.classList.remove("preview-open"); document.removeEventListener("keydown", noEsc); };
    const noEsc = (ev) => { if (ev.key === "Escape") fechar(); };
    document.addEventListener("keydown", noEsc);

    wrap.addEventListener("click", (ev) => {
      if (ev.target === wrap || ev.target.closest("[data-ex-close]")) { fechar(); return; }
      const f = ev.target.closest("[data-ex-fmt]");
      if (f) { formato = f.dataset.exFmt; pinta(); return; }
      const g = ev.target.closest("[data-ex-game]");
      if (g) { jogo = g.dataset.exGame; pinta(); return; }

      if (ev.target.closest("[data-ex-copy]")) {
        const ta = wrap.querySelector(".lst-export");
        // navigator.clipboard exige contexto seguro; o fallback do textarea
        // cobre http:// e navegador antigo (mesmo caminho das listas).
        const ok = () => { const b = wrap.querySelector("[data-ex-copy]"); if (b) b.textContent = t("export.copied"); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(ta.value).then(ok, () => { ta.select(); document.execCommand("copy"); ok(); });
        } else { ta.select(); document.execCommand("copy"); ok(); }
        return;
      }

      if (ev.target.closest("[data-ex-dl]")) {
        const ext = formato === "csv" ? "csv" : "txt";
        const tipo = formato === "csv" ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8";
        // BOM só no CSV (é o que faz o Excel pt-BR abrir com acento certo).
        const conteudo = (formato === "csv" ? "﻿" : "") + wrap.querySelector(".lst-export").value;
        const blob = new Blob([conteudo], { type: tipo });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${opts.arquivo || "sleevu"}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
      }
    });
  }

  window.TCGExportUI = { abrir };
})();
