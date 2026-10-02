// Guia de condição (condition.html, 2026-10-01; era condicao.html). Cinco perguntas — danos,
// cantos, bordas, marcas brancas no verso e superfície — e a condição na escala
// da Liga (M · NM · SP · MP · HP · D), a mesma do CARD_CONDITIONS do shared.js.
// Ver docs/FERRAMENTAS.md.
//
// Regra do resultado: vale o PIOR critério. É assim que loja e comprador
// conferem, e é a única regra que se defende numa negociação ("o verso é SP,
// então a carta é SP"). Média pareceria generosa e cairia na primeira foto.
//
// Conta pura, no navegador: não grava nada e não fala com a rede. Textos no
// src/i18n-ferramentas.js; os NOMES dos degraus (Mint, Near Mint…) são os
// mesmos nos três idiomas e moram aqui.
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const { t, escapeHtml: esc } = shared;

  const NIVEIS = ["M", "NM", "SP", "MP", "HP", "D"];
  const NOME = { M: "Mint", NM: "Near Mint", SP: "Slightly Played", MP: "Moderately Played", HP: "Heavily Played", D: "Damaged" };
  // Equivalência APROXIMADA, pra quem compra ou vende fora: o TCGplayer não tem
  // Mint (o topo dele é NM) e o Cardmarket tem sete degraus.
  const EQ = {
    M: ["Near Mint (NM)", "Mint (MT)"], NM: ["Near Mint (NM)", "Near Mint (NM)"],
    SP: ["Lightly Played (LP)", "Excellent (EX)"], MP: ["Moderately Played (MP)", "Good (GD)"],
    HP: ["Heavily Played (HP)", "Played (PL)"], D: ["Damaged (DMG)", "Poor (PO)"]
  };
  // Cópia do CONDITION_MULTIPLIERS do shared.js (que não é exportado). O
  // tests/ferramentas.test.mjs reprova se as duas divergirem.
  const MULT = { M: 1, NM: 1, SP: 0.85, MP: 0.7, HP: 0.5, D: 0.3 };

  // Cada critério e os degraus que a resposta dele pode dar. Danos não tem
  // "NM" (ou a carta está lisa ou não está) e só ele chega no D: dano que não
  // sai decide sozinho, e pula o resto das perguntas.
  const CRITERIOS = [
    { id: "danos", niveis: ["M", "SP", "MP", "HP", "D"] },
    { id: "cantos", niveis: ["M", "NM", "SP", "MP", "HP"] },
    { id: "bordas", niveis: ["M", "NM", "SP", "MP", "HP"] },
    { id: "verso", niveis: ["M", "NM", "SP", "MP", "HP"] },
    { id: "superficie", niveis: ["M", "NM", "SP", "MP", "HP"] }
  ];

  // O pior degrau entre as respostas dadas (critério sem resposta não conta:
  // com D nos danos, o resto nem é perguntado).
  function resultado(resp) {
    let pior = -1;
    CRITERIOS.forEach((c) => {
      const i = NIVEIS.indexOf(resp[c.id]);
      if (i > pior) pior = i;
    });
    return pior < 0 ? null : NIVEIS[pior];
  }
  // "Lightly Played (LP)" -> "LP": no texto da negociação a sigla basta.
  const sigla = (nivel) => (EQ[nivel][0].match(/\((\w+)\)/) || [, EQ[nivel][0]])[1];
  // Próxima pergunta sem resposta (ou o resultado, se todas têm).
  function proximo(resp) {
    if (resp.danos === "D") return CRITERIOS.length;
    const i = CRITERIOS.findIndex((c) => !resp[c.id]);
    return i < 0 ? CRITERIOS.length : i;
  }

  function textoCopia(resp) {
    const r = resultado(resp);
    const det = CRITERIOS.filter((c) => c.id !== "danos" && resp[c.id]).map((c) => `${t(`gc.${c.id}.lb`)} ${resp[c.id]}`);
    det.push(resp.danos === "M" ? t("gc.noDamage") : t("gc.damage", { c: resp.danos }));
    return [t("gc.copyLine", { c: r, n: NOME[r], tcg: sigla(r) }), det.join(" · "), t("gc.signature")].join("\n");
  }

  const ic = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC_OLHO = ic('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>');
  const IC_SETA = ic('<path d="m9 6 6 6-6 6"/>');
  const IC_VOLTA = ic('<path d="m15 6-6 6 6 6"/>');
  const IC_COPIA = ic('<rect x="9" y="9" width="12" height="12"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>');
  const IC_REFAZ = ic('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>');

  // A carta desenhada (proporção 63:88), com a área a examinar em ciano — o
  // mesmo ciano das guias do medidor de centralização.
  function figura(id) {
    const frente = '<rect class="gc-card" x="10" y="10" width="120" height="168" rx="7"/><rect class="gc-ln" x="20" y="20" width="100" height="148"/><rect class="gc-ln" x="28" y="36" width="84" height="62"/><path class="gc-ln-soft" d="M32 114h76M32 126h60M32 138h68"/>';
    const zona = {
      danos: frente + '<path class="gc-hl" d="M10 64 130 122" stroke-dasharray="7 5"/><path class="gc-hl" d="M130 140l-9 6 9 6"/>',
      cantos: frente + '<g class="gc-hl-fill"><circle cx="17" cy="17" r="15"/><circle cx="123" cy="17" r="15"/><circle cx="17" cy="171" r="15"/><circle cx="123" cy="171" r="15"/></g><path class="gc-hl" d="M10 30V17a7 7 0 0 1 7-7h13M110 10h13a7 7 0 0 1 7 7v13M130 158v13a7 7 0 0 1-7 7h-13M30 178H17a7 7 0 0 1-7-7v-13"/>',
      bordas: frente + '<path class="gc-hl" d="M32 10h76M32 178h76M10 32v124M130 32v124"/>',
      verso: '<rect class="gc-card" x="10" y="10" width="120" height="168" rx="7"/><path class="gc-hl-fill" fill-rule="evenodd" d="M10 17a7 7 0 0 1 7-7h106a7 7 0 0 1 7 7v154a7 7 0 0 1-7 7H17a7 7 0 0 1-7-7Zm12 5v144h96V22Z"/><rect class="gc-ln" x="22" y="22" width="96" height="144"/><circle class="gc-ln" cx="70" cy="94" r="24"/><path class="gc-ln" d="M46 94h48"/><g class="gc-speck"><circle cx="40" cy="11.5" r="1.8"/><circle cx="96" cy="11.5" r="1.4"/><circle cx="128.5" cy="60" r="1.8"/><circle cx="11.5" cy="130" r="1.6"/><rect x="62" y="175.5" width="16" height="2.5"/></g>',
      superficie: frente + '<path class="gc-hl-thin" d="M30 150 104 30M48 160 118 46" opacity=".55"/><path class="gc-hl" d="M60 70l14-8M84 104l10-4M44 132l9-7"/>'
    }[id];
    return `<svg viewBox="0 0 140 188" aria-hidden="true">${zona}</svg>`;
  }

  const lvl = (n) => `--lvl: var(--gc-${n})`;
  const pct = (n) => `${Math.round(MULT[n] * 100)}%`;

  function iniciar(app, regua) {
    let passo = 0;
    const resp = {};

    function pintaRegua() {
      const r = passo >= CRITERIOS.length ? resultado(resp) : null;
      regua.innerHTML = NIVEIS.map((n) => `
        <li class="gc-scale-row${n === r ? " is-res" : ""}" style="${lvl(n)}">
          <span class="gc-tag">${n}</span>
          <div class="gc-scale-b">
            <p class="gc-scale-name"><strong>${esc(NOME[n])}</strong><span>${esc(t("gc.ofNm", { p: pct(n) }))}</span></p>
            <p>${esc(t(`gc.scale.${n}`))}</p>
            <p class="gc-scale-eq">TCGplayer ≈ ${esc(sigla(n))} · Cardmarket ≈ ${esc(EQ[n][1])}</p>
          </div>
        </li>`).join("");
    }

    function trilha() {
      return `<ol class="gc-trail" aria-label="${esc(t("gc.trail"))}">${CRITERIOS.map((c, i) => {
        const r = resp[c.id];
        const cls = i === passo ? "is-now" : r ? "is-done" : "";
        const pode = r || i === passo;
        return `<li><button type="button" class="${cls}" style="${r ? lvl(r) : ""}" data-gc-ir="${i}"${pode ? "" : " disabled"}${i === passo ? ' aria-current="step"' : ""}><span>${esc(t(`gc.${c.id}.lb`))}${r ? `<b>${r}</b>` : ""}</span></button></li>`;
      }).join("")}</ol>`;
    }

    function telaPergunta() {
      const c = CRITERIOS[passo];
      return `
        <div class="gc-step">
          <figure class="gc-fig">${figura(c.id)}<figcaption>${esc(t(`gc.${c.id}.fig`))}</figcaption></figure>
          <div class="gc-q">
            <h2 tabindex="-1" data-gc-foco>${esc(t(`gc.${c.id}.q`))}</h2>
            <p class="gc-look">${IC_OLHO}<span>${esc(t(`gc.${c.id}.look`))}</span></p>
            <div class="gc-opts" role="group" aria-label="${esc(t(`gc.${c.id}.q`))}">${c.niveis.map((n) => `
              <button type="button" class="gc-opt" style="${lvl(n)}" data-gc-op="${n}" aria-pressed="${resp[c.id] === n}">
                <span class="gc-tag">${n}</span>
                <span class="gc-opt-b"><strong>${esc(t(`gc.${c.id}.${n}`))}</strong><span>${esc(t(`gc.${c.id}.${n}.d`))}</span></span>
                <span class="gc-opt-go">${IC_SETA}</span>
              </button>`).join("")}
            </div>
          </div>
        </div>
        <div class="fer-actions">
          ${passo > 0 ? `<button type="button" class="secondary fer-btn" data-gc-volta>${IC_VOLTA}<span>${esc(t("gc.back"))}</span></button>` : ""}
        </div>`;
    }

    function telaResultado() {
      const r = resultado(resp);
      const ri = NIVEIS.indexOf(r);
      // Régua: um critério por linha, seis degraus por coluna. A coluna do
      // resultado vem marcada e quem "puxou pra baixo" ganha o destaque.
      const linhas = CRITERIOS.map((c) => {
        const ci = NIVEIS.indexOf(resp[c.id]);
        return `<span class="gc-rl-lb${ci === ri ? " is-worst" : ""}">${esc(t(`gc.${c.id}.lb`))}</span>${NIVEIS.map((n, i) =>
          `<span class="gc-rl-cell${i === ri ? " is-col" : ""}${i === ci ? " is-on" : ""}" style="--c: var(--gc-${n})"></span>`).join("")}`;
      }).join("");
      const quem = CRITERIOS.filter((c) => resp[c.id] === r).map((c) => t(`gc.${c.id}.lb`).toLowerCase()).join(", ");
      return `
        <div class="gc-res" style="${lvl(r)}">
          <div class="gc-res-tag">${r}</div>
          <div class="gc-res-b">
            <h2 tabindex="-1" data-gc-foco>${esc(NOME[r])} <span class="gc-res-sub"><span class="gc-res-sep">· </span>${esc(t(`gc.sub.${r}`))}</span></h2>
            <p class="gc-res-eq"><span>TCGplayer <strong>≈ ${esc(EQ[r][0])}</strong></span><span>Cardmarket <strong>≈ ${esc(EQ[r][1])}</strong></span></p>
            <p class="gc-res-val">${esc(t("gc.value", { c: r, p: "@@" })).replace("@@", `<strong>${pct(r)}</strong>`)}</p>
          </div>
        </div>
        <div class="gc-ruler" style="${lvl(r)}">
          <span></span>${NIVEIS.map((n) => `<span class="gc-rl-hd${n === r ? " is-res" : ""}">${n}</span>`).join("")}
          ${linhas}
        </div>
        <p class="gc-why">${esc(t("gc.why", { k: "@@" })).replace("@@", `<strong>${esc(quem)}</strong>`)}</p>
        <p class="gc-copy-lb">${esc(t("gc.copyLabel"))}</p>
        <div class="gc-copy">${esc(textoCopia(resp))}</div>
        <div class="fer-actions">
          <button type="button" class="secondary fer-btn" data-gc-refaz>${IC_REFAZ}<span>${esc(t("gc.redo"))}</span></button>
          <button type="button" class="primary fer-btn" data-gc-copia>${IC_COPIA}<span>${esc(t("gc.copy"))}</span></button>
        </div>
        <p class="fer-fine">${esc(t("gc.fine"))}</p>`;
    }

    function pinta(focar) {
      const fim = passo >= CRITERIOS.length;
      app.innerHTML = `
        <div class="gc-head"><span>${esc(fim ? t("gc.result") : t("gc.counter", { n: passo + 1, total: CRITERIOS.length }))}</span></div>
        ${trilha()}
        ${fim ? telaResultado() : telaPergunta()}`;
      pintaRegua();
      if (!focar) return;
      // Pergunta nova: o foco vai pro título dela (o leitor de tela anuncia), e
      // a tela volta pro topo do cartão quando a pessoa tinha rolado pra baixo
      // pra tocar numa opção — no celular, a próxima pergunta nascia cortada.
      const alvo = app.querySelector("[data-gc-foco]");
      if (alvo) alvo.focus({ preventScroll: true });
      if (app.getBoundingClientRect().top < 0) app.scrollIntoView({ block: "start" });
    }

    // Cada passo é uma entrada no histórico: o voltar do navegador (e o botão
    // do Android) volta UMA pergunta, em vez de sair da página e perder as
    // respostas. O estado guarda só o número do passo; as respostas vivem aqui.
    const vaiPara = (n) => {
      passo = n;
      try { history.pushState({ gc: n }, ""); } catch (e) { /* sem histórico: segue só na tela */ }
      pinta(true);
    };
    try { history.replaceState({ gc: 0 }, ""); } catch (e) { /* idem */ }
    window.addEventListener("popstate", (ev) => {
      const n = ev.state && typeof ev.state.gc === "number" ? ev.state.gc : 0;
      // Nunca além da primeira pergunta sem resposta (o "avançar" do navegador
      // depois de um Refazer apontaria pra perguntas que não existem mais).
      passo = Math.min(n, proximo(resp));
      pinta(true);
    });

    app.addEventListener("click", (ev) => {
      const op = ev.target.closest("[data-gc-op]");
      if (op) {
        resp[CRITERIOS[passo].id] = op.dataset.gcOp;
        return vaiPara(proximo(resp));
      }
      const ir = ev.target.closest("[data-gc-ir]");
      if (ir && !ir.disabled && Number(ir.dataset.gcIr) !== passo) return vaiPara(Number(ir.dataset.gcIr));
      if (ev.target.closest("[data-gc-volta]")) return history.back();
      if (ev.target.closest("[data-gc-refaz]")) {
        CRITERIOS.forEach((c) => { delete resp[c.id]; });
        return vaiPara(0);
      }
      const cp = ev.target.closest("[data-gc-copia]");
      if (cp && navigator.clipboard) {
        navigator.clipboard.writeText(textoCopia(resp)).then(() => {
          cp.querySelector("span").textContent = t("export.copied");
        }, () => { /* sem permissão: o texto segue na tela pra copiar na mão */ });
      }
    });

    pinta(false);
  }

  const app = document.getElementById("gcApp");
  const regua = document.getElementById("gcScale");
  if (app && regua) iniciar(app, regua);

  // Exposto pro tests/ferramentas.test.mjs (a regra do resultado é o produto).
  window.TCGCondicao = { NIVEIS, CRITERIOS, MULT, resultado, proximo, sigla, textoCopia };
})();
