// Modal de "Exportar" (Liga / texto / CSV) — a PARTE DE TELA do export, que
// vale pra qualquer lista de cartas: a Coleção e a Lista de Desejo (2026-09-14,
// quando a wishlist ganhou os mesmos botões da Coleção) abrem este mesmo modal
// e só dizem de onde vêm as linhas. O gerador do texto continua no
// src/export-liga.js (lógica pura, com testes dourados); aqui é só o DOM: abas
// de formato, seletor de jogo, textarea, copiar/baixar.
//
// A preferência de formato e de jogo é do módulo (não da página): quem exporta
// pra Liga na Coleção quer Liga também na wishlist.
//
// Os DECKS (2026-10-02) usam o mesmo modal com formatos próprios (Archidekt,
// LigaMagic) e OPÇÕES por formato — as caixinhas do diálogo de export do
// Archidekt (1x, sigla, número, foil, categorias). As caixinhas marcadas ficam
// guardadas no navegador: quem desliga a categoria uma vez não quer religar a
// cada export.
(function () {
  "use strict";

  const FORMATOS = ["liga", "texto", "csv"];
  // Vazio até a pessoa escolher uma aba: abre no PRIMEIRO formato da página
  // (Liga na Coleção, Archidekt no deck de Magic).
  let formato = "";
  let jogo = "";

  const OPCOES_KEY = "tcg-export-opcoes";
  function lerOpcoes() {
    try { return JSON.parse(localStorage.getItem(OPCOES_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function gravarOpcoes(v) {
    try { localStorage.setItem(OPCOES_KEY, JSON.stringify(v)); } catch (e) { /* sem storage: vale só nesta aba */ }
  }

  // opts:
  //   titulo      — texto do <h2> (já traduzido)
  //   jogos       — slugs dos jogos presentes na lista (o seletor só aparece no
  //                 formato Liga com mais de um jogo: a Liga é por jogo)
  //   rotuloJogo  — (slug) => nome do jogo
  //   formatos    — abas de formato, na ordem (padrão: liga/texto/csv)
  //   opcoes      — { formato: [{ key, rotulo, padrao, depende }] }: caixinhas
  //                 daquele formato; `depende` = key que precisa estar marcada
  //                 pra esta valer (fica desabilitada sem ela)
  //   texto       — (formato, jogo, marcadas) => string com o export;
  //                 `marcadas` = { key: boolean } das opções do formato
  //   escopo      — (nLinhas, formato) => frase "Exportando N cartas…" (já traduzida)
  //   arquivo     — nome-base do arquivo baixado (sem extensão)
  //   vazio       — mensagem do toast quando não há nada pra exportar
  function abrir(opts) {
    const shared = window.TCGShared;
    const { t, escapeHtml, escapeAttribute } = shared;
    const jogos = opts.jogos || [];
    if (!jogos.length) { shared.toastSimples(opts.vazio || t("export.empty")); return; }
    if (!jogos.includes(jogo)) jogo = jogos[0] || "";
    const formatos = opts.formatos || FORMATOS;
    if (!formatos.includes(formato)) formato = formatos[0];
    const guardadas = lerOpcoes();
    // Marcadas do formato atual: o que a pessoa deixou da última vez, e o
    // padrão de cada opção pro que ela nunca mexeu.
    const marcadas = () => {
      const out = {};
      ((opts.opcoes || {})[formato] || []).forEach((o) => {
        const g = (guardadas[formato] || {})[o.key];
        out[o.key] = typeof g === "boolean" ? g : !!o.padrao;
      });
      return out;
    };
    // Liga é POR JOGO (ligamagic, ligapokemon, ligaonepiece…): um texto só com
    // dois jogos misturados não casa em lugar nenhum. Texto e CSV não têm essa
    // restrição e saem com tudo que está na tela.
    const textoAtual = () => opts.texto(formato, formato === "liga" ? (jogo || jogos[0] || "") : "", marcadas()) || "";
    const escopo = (texto) => opts.escopo(texto ? texto.split("\n").filter(Boolean).length : 0, formato);

    const wrap = document.createElement("div");
    wrap.className = "list-modal";
    document.body.appendChild(wrap);
    document.body.classList.add("preview-open"); // trava a rolagem do fundo

    function pinta() {
      const abas = formatos.map((f) =>
        `<button type="button" class="lst-chip${f === formato ? " is-on" : ""}" data-ex-fmt="${escapeAttribute(f)}">${escapeHtml(t("export.fmt." + f))}</button>`).join("");
      // O seletor de jogo só existe quando ele muda alguma coisa: formato Liga
      // E mais de um jogo na tela.
      const seletorJogo = (formato === "liga" && jogos.length > 1)
        ? `<p class="list-modal-hint">${escapeHtml(t("export.gameHint"))}</p>
           <div class="lst-chips">${jogos.map((g) =>
             `<button type="button" class="lst-chip${g === jogo ? " is-on" : ""}" data-ex-game="${escapeAttribute(g)}">${escapeHtml(opts.rotuloJogo ? opts.rotuloJogo(g) : g)}</button>`).join("")}</div>`
        : "";
      const texto = textoAtual();
      const m = marcadas();
      const caixas = ((opts.opcoes || {})[formato] || []).map((o) => {
        const off = !!o.depende && !m[o.depende];
        return `<label class="lst-opt"><input type="checkbox" data-ex-opt="${escapeAttribute(o.key)}"${m[o.key] ? " checked" : ""}${off ? " disabled" : ""}><span>${escapeHtml(o.rotulo)}</span></label>`;
      }).join("");
      wrap.innerHTML = `
        <div class="list-modal-box" role="dialog" aria-modal="true" aria-label="${escapeAttribute(opts.titulo)}">
          <h2>${escapeHtml(opts.titulo)}</h2>
          <div class="lst-chips">${abas}</div>
          ${seletorJogo}
          <p class="list-modal-hint">${escapeHtml(t("export.hint." + formato))}</p>
          ${caixas ? `<div class="lst-opts">${caixas}</div>` : ""}
          <textarea class="lst-export" readonly rows="12">${escapeHtml(texto)}</textarea>
          <p class="list-modal-hint" data-ex-scope>${escapeHtml(escopo(texto))}</p>
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

    // Caixinha: troca só o texto e o estado das dependentes, sem repintar o
    // modal — repintar tiraria o foco de quem navega pelo teclado.
    wrap.addEventListener("change", (ev) => {
      const cx = ev.target.closest("[data-ex-opt]");
      if (!cx) return;
      guardadas[formato] = Object.assign({}, guardadas[formato] || {}, { [cx.dataset.exOpt]: cx.checked });
      gravarOpcoes(guardadas);
      const m = marcadas();
      ((opts.opcoes || {})[formato] || []).forEach((o) => {
        const el = o.depende && wrap.querySelector(`[data-ex-opt="${o.key}"]`);
        if (el) el.disabled = !m[o.depende];
      });
      const texto = textoAtual();
      wrap.querySelector(".lst-export").value = texto;
      wrap.querySelector("[data-ex-scope]").textContent = escopo(texto);
      const b = wrap.querySelector("[data-ex-copy]");
      if (b) b.textContent = t("export.copy");   // "Copiado!" era do texto anterior
    });

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
