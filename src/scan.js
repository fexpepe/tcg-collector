// Scanner de carta pela câmera — fase 1: OCR do CÓDIGO impresso na carta
// (OP01-001, BT1-001, 4/102, MH3 123…) e busca no catálogo. Ver
// docs/PLANO-SCANNER.md pro plano inteiro e os limites conhecidos.
//
// A FOTO NUNCA SAI DO APARELHO: o OCR é o Tesseract.js rodando em WASM dentro
// do navegador (auto-hospedado em assets/vendor/, a CSP é 'self'). Pra rede vai
// só o CÓDIGO lido — o mesmo texto que a pessoa digitaria na busca.
//
// ARQUIVO PRÓPRIO, injetado pelo shared.js no primeiro toque no ícone de
// câmera: o shared.js está colado no teto do orçamento de peso e viaja em toda
// página; este arquivo (e os ~3,5 MB do motor) só descem pra quem escaneia.
(function () {
  const shared = window.TCGShared;
  if (!shared) return;
  const { t, escapeHtml, escapeAttribute } = shared;

  // Pasta VERSIONADA no nome (ver o README dela). URL absoluta de propósito: o
  // worker do Tesseract resolve langPath/corePath contra a URL DELE, não a da
  // página — um caminho relativo viraria assets/vendor/…/assets/vendor/….
  const VENDOR = "assets/vendor/tesseract-7.0.0/";
  const BASE = location.origin + "/" + VENDOR;
  const WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-. ";
  const FAIXA = 0.24;        // fração INFERIOR da carta onde o código mora em quase todo jogo
  const LARGURA_OCR = 1400;  // px: o Tesseract lê melhor com ~30 px de altura de glifo

  // ── Extração de código (função PURA; testada em tests/scan-codes.test.mjs) ──
  // Confusões clássicas do OCR em texto que TEM de ser numérico. Só se aplica
  // à parte numérica do código — no prefixo (OP, BT, LOB) a letra é letra.
  function soDigitos(s) {
    return String(s).replace(/O/g, "0").replace(/[IL|]/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2");
  }
  // Prefixo de código com hífen: letras + dígitos opcionais (OP01, BT1, EXB,
  // LOB, ST01). Dígitos no prefixo passam pela mesma correção, mas a parte de
  // letras é preservada.
  // `sufixoNumerico`: o que vem depois do hífen é só número (OP05-119), e não
  // idioma + número (SHVI-EN001) — muda o quanto se desconfia da última letra.
  function prefixo(s, sufixoNumerico) {
    const m = String(s).match(/^([A-Z]+)([A-Z0-9]*)$/);
    if (!m) return String(s);
    let letras = m[1], resto = m[2];
    // "OPO5" e "BTI": o O/I no fim das letras é 0/1 lido errado. Só O e I (as
    // confusões mais comuns), só com 3+ letras ("EB01" e "PRB01" são reais) e,
    // sem dígito nenhum no prefixo, só com sufixo numérico — o Yu-Gi-Oh tem
    // sets de 4 letras terminados em I/O (SHVI, PRIO), sempre com "-EN".
    const movivel = /[OI]$/.test(letras) && letras.length > 2
      && (/\d/.test(resto) || (sufixoNumerico && letras.length === 3 && !resto));
    if (movivel) {
      resto = letras.slice(-1) + resto;
      letras = letras.slice(0, -1);
    }
    return letras + soDigitos(resto);
  }
  const IDIOMAS = "EN|PT|ES|FR|DE|IT|JA|JP|KO|RU|ZH|CN|TW";
  // Devolve os candidatos em ORDEM de confiança: o mais específico primeiro.
  // Cada candidato é um texto que a busca entende ("OP05-119", "4/102",
  // "MH3 123" — set e número separados por espaço, como na paleta Ctrl+K).
  function extrairCodigos(texto) {
    const up = String(texto || "").toUpperCase().replace(/[‐‑–—]/g, "-").replace(/\s+/g, " ");
    const out = [];
    const add = (c) => { if (c && !out.includes(c)) out.push(c); };
    let m;
    // Union Arena: UE21BT/RLY-1-082
    const reUA = /\b(UE\d{2}[A-Z]{2})\/([A-Z]{2,4})-(\d)-(\d{3})\b/g;
    while ((m = reUA.exec(up))) add(`${m[1]}/${m[2]}-${m[3]}-${m[4]}`);
    // Código com hífen: OP01-001, EB01-001, BT1-001, ST01-001, EXB-001,
    // LOB-EN001, FB01-001, P-001, GD01-001. Prefixo com pelo menos uma letra;
    // sufixo com 2-4 dígitos (às vezes precedido do idioma, como no Yu-Gi-Oh).
    const reHifen = /\b([A-Z][A-Z0-9]{0,5})-([A-Z]{0,2}[0-9OILSBZ]{2,4}[A-Z]?)\b/g;
    while ((m = reHifen.exec(up))) {
      // Idioma no sufixo (Yu-Gi-Oh: LOB-EN001) é EXATAMENTE 2 letras + 3-4
      // dígitos. Qualquer outra letra ali é o OCR confundindo (II9 -> 119).
      const idioma = m[2].match(/^([A-Z]{2})([0-9OILSBZ]{3,4}[A-Z]?)$/);
      const suf = idioma ? idioma[1] + soDigitos(idioma[2]) : soDigitos(m[2]);
      if (/\d{2}/.test(suf)) add(`${prefixo(m[1], !idioma)}-${suf}`);
    }
    // Magic (e quem imprime "CÓDIGO • IDIOMA"): o número vem logo antes.
    //   "0123/0281 R" / "MH3 • EN"  ->  "MH3 123"
    const reMagic = new RegExp(`\\b0*(\\d{1,4})(?:\\s*\\/\\s*0*\\d{1,4})?\\s*[A-Z]?\\s*\\b([A-Z][A-Z0-9]{2,3})\\s*[•·.\\-]?\\s*(?:${IDIOMAS})\\b`, "g");
    while ((m = reMagic.exec(up))) add(`${m[2]} ${parseInt(m[1], 10)}`);
    // Lorcana: "12/204 · EN · 4"  ->  "4 12" (set 4, carta 12)
    const reLorcana = new RegExp(`\\b(\\d{1,3})\\s*\\/\\s*(\\d{3})\\s*[•·.\\-]?\\s*(?:${IDIOMAS})\\s*[•·.\\-]?\\s*(\\d{1,2})\\b`, "g");
    while ((m = reLorcana.exec(up))) add(`${m[3]} ${parseInt(m[1], 10)}`);
    // FAB: WTR001, IRA002 (3 letras + 3 dígitos colados)
    const reFab = /\b([A-Z]{3})(\d{3})\b/g;
    while ((m = reFab.exec(up))) add(m[1] + m[2]);
    // Fração: 4/102, 123/198, 12/204 (Pokémon, Lorcana, Riftbound, Magic antigo)
    const reFrac = /\b([0-9OILSBZ]{1,3})\s*\/\s*([0-9OILSBZ]{1,3})\b/g;
    while ((m = reFrac.exec(up))) {
      const a = soDigitos(m[1]), b = soDigitos(m[2]);
      if (/^\d+$/.test(a) && /^\d+$/.test(b) && parseInt(b, 10) > 0) add(`${parseInt(a, 10)}/${parseInt(b, 10)}`);
    }
    return out.slice(0, 6);
  }

  // ── Busca do candidato no catálogo ──────────────────────────────────────────
  const normKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  async function buscar(codigo) {
    const vistos = new Set();
    const out = [];
    const add = (card, game) => {
      if (!card) return;
      const k = `${game}:${card.id}`;
      if (!vistos.has(k)) { vistos.add(k); out.push({ card, game }); }
    };
    // 1) Set + número EXATOS pelo manifest do jogo (a busca por código da
    //    paleta): baixa só o chunk do set certo.
    try { (await shared.cmdkCardsByCode(codigo)).forEach((h) => add(h.card, h.game)); }
    catch (e) { /* sem manifest/catálogo: segue pra borda */ }
    // 2) Borda (D1): indexa as palavras do número, então acha "4/102" em
    //    qualquer set de 102 cartas e "BT1-001" mesmo quando o setId do
    //    catálogo é "BT-01". Hidrata só as cartas devolvidas.
    if (out.length < 3) {
      const hits = await shared.searchApi("all", codigo, 12);
      if (hits && hits.length) {
        const porJogo = Object.create(null);
        hits.forEach((h) => { const g = h.g || "pokemon"; (porJogo[g] = porJogo[g] || []).push(h.i); });
        try {
          const cat = await shared.loadOwnedAcrossGames(porJogo);
          const byId = new Map((cat.cards || []).map((c) => [c.id, c]));
          hits.forEach((h) => { const c = byId.get(h.i); if (c) add(c, h.g || c.game || "pokemon"); });
        } catch (e) { /* rede oscilou: fica com o que já tem */ }
      }
    }
    // Número exato primeiro ("4/102" antes de um "4" solto de outro jogo).
    const alvo = normKey(codigo);
    const exato = (h) => (normKey(h.card.number) === alvo ? 0 : 1);
    out.sort((a, b) => exato(a) - exato(b));
    return out.slice(0, 12);
  }

  // ── Motor de OCR (carregado sob demanda, um worker por sessão) ─────────────
  let workerPromise = null;
  function carregarScript(src) {
    return new Promise((resolve, reject) => {
      if (window.Tesseract) { resolve(); return; }
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("tesseract.min.js"));
      document.head.appendChild(s);
    });
  }
  function obterWorker(status) {
    if (workerPromise) return workerPromise;
    workerPromise = (async () => {
      await carregarScript(BASE + "tesseract.min.js");
      const T = window.Tesseract;
      const criar = (core) => T.createWorker("eng", T.OEM.LSTM_ONLY, {
        workerPath: BASE + "worker.min.js",
        corePath: BASE + core,
        langPath: BASE.replace(/\/$/, ""),
        workerBlobURL: false, // worker por URL: worker-src 'self' sem blob:
        gzip: true,
        logger: (m) => { if (status && m && m.status) status(m.status, m.progress); }
      });
      let w;
      try { w = await criar("tesseract-core-simd-lstm.wasm.js"); }
      catch (e) { w = await criar("tesseract-core-lstm.wasm.js"); } // aparelho sem SIMD
      await w.setParameters({
        tessedit_char_whitelist: WHITELIST,
        tessedit_pageseg_mode: T.PSM.SPARSE_TEXT
      });
      return w;
    })();
    workerPromise.catch(() => { workerPromise = null; }); // deixa tentar de novo
    return workerPromise;
  }
  async function ocr(worker, canvas) {
    const r = await worker.recognize(canvas, {}, { text: true });
    return (r && r.data && r.data.text) || "";
  }

  // ── Recorte e preparo da imagem ─────────────────────────────────────────────
  // Reamostra pra largura fixa e sobe o contraste (faixa dinâmica esticada):
  // texto pequeno em foto de celular chega cinza e baixo; o Tesseract agradece.
  function preparar(fonte, sx, sy, sw, sh, largura) {
    const f = largura / sw;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(sw * f));
    c.height = Math.max(1, Math.round(sh * f));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(fonte, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    let lo = 255, hi = 0;
    const cinza = new Uint8ClampedArray(d.length / 4);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
      cinza[j] = g;
      if (g < lo) lo = g;
      if (g > hi) hi = g;
    }
    const esc = hi > lo ? 255 / (hi - lo) : 1;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const v = (cinza[j] - lo) * esc;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
  // Moldura-guia -> coordenadas do vídeo. O vídeo preenche o palco em
  // object-fit: cover, então o que a tela mostra é um recorte centralizado do
  // quadro; a moldura é uma fração desse recorte.
  function recorteDaGuia(video, palco, guia) {
    const vw = video.videoWidth, vh = video.videoHeight;
    const pr = palco.getBoundingClientRect();
    const gr = guia.getBoundingClientRect();
    const escala = Math.max(pr.width / vw, pr.height / vh);
    const ox = (vw * escala - pr.width) / 2;
    const oy = (vh * escala - pr.height) / 2;
    return {
      sx: (gr.left - pr.left + ox) / escala,
      sy: (gr.top - pr.top + oy) / escala,
      sw: gr.width / escala,
      sh: gr.height / escala
    };
  }
  async function bitmapDoArquivo(file) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch (e) { /* navegador sem createImageBitmap com orientação */ }
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("imagem")); };
      img.src = url;
    });
  }

  // ── Interface ───────────────────────────────────────────────────────────────
  const ESTILO = `
.scan-modal { align-items: stretch; padding: 0; z-index: 75; }
.scan-box { max-width: 560px; margin: auto; padding: 16px; border-radius: 16px; display: flex; flex-direction: column; gap: 12px; max-height: 100vh; max-height: 100dvh; }
.scan-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.scan-head h2 { margin: 0; font-size: 18px; }
.scan-palco { position: relative; width: 100%; aspect-ratio: 3 / 4; max-height: 52vh; max-height: 52dvh; background: #0b0d12; border-radius: 12px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.scan-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.scan-guia { position: absolute; left: 50%; top: 50%; height: 82%; aspect-ratio: 63 / 88; transform: translate(-50%, -50%); border: 2px solid rgba(255,255,255,.85); border-radius: 10px; box-shadow: 0 0 0 999px rgba(0,0,0,.45); pointer-events: none; }
.scan-faixa { position: absolute; left: 0; right: 0; bottom: 0; height: ${Math.round(FAIXA * 100)}%; border-top: 1px dashed rgba(0,229,255,.9); background: rgba(0,229,255,.12); }
.scan-semcam { position: relative; margin: 0; padding: 20px; text-align: center; color: #cfd6e2; font-size: 14px; line-height: 1.5; }
.scan-status { margin: 0; min-height: 18px; font-size: 13px; color: var(--muted); text-align: center; }
.scan-acoes { display: flex; gap: 10px; align-items: center; justify-content: center; flex-wrap: wrap; }
.scan-acoes .cta { min-height: 46px; padding: 0 26px; font-size: 15px; justify-content: center; }
.scan-acoes .cta[disabled] { opacity: .55; cursor: wait; }
.scan-file { cursor: pointer; display: inline-flex; align-items: center; min-height: 40px; padding: 0 16px; }
.scan-codigo { display: flex; gap: 8px; align-items: center; }
.scan-codigo label { flex: none; font-size: 12.5px; font-weight: 700; color: var(--muted); }
.scan-codigo input { flex: 1; min-width: 0; height: 40px; padding: 0 12px; border: 1px solid var(--line); border-radius: 9px; background: var(--panel); color: var(--text); font: inherit; font-size: 16px; font-weight: 700; text-transform: uppercase; }
.scan-codigo .lst-mini { min-height: 40px; }
.scan-res { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; overscroll-behavior: contain; min-height: 0; }
/* Linha de resultado em GRADE: no celular a fileira única da paleta (nome +
   dois botões + jogo) esmagava o nome em "Chariza…". Ações na 2ª linha. */
.scan-res .cmdk-carditem { display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; grid-template-areas: "th nm gm" "th ac ac"; column-gap: 10px; row-gap: 6px; align-items: center; min-height: 52px; }
.scan-res .cmdk-thumb { grid-area: th; width: 42px; }
.scan-res .cmdk-thumb img { width: 42px; height: auto; }
.scan-res .cmdk-item-name { grid-area: nm; }
.scan-res .cmdk-game { grid-area: gm; }
.scan-res .cmdk-actions { grid-area: ac; justify-content: flex-start; }
.scan-vazio { margin: 0; padding: 10px 4px; font-size: 13px; color: var(--muted); line-height: 1.5; }
.scan-vazio a { color: var(--accent); font-weight: 700; }
.scan-priv { margin: 0; font-size: 11.5px; color: var(--subtle); text-align: center; }
@media (max-width: 700px) {
  .scan-box { max-width: none; width: 100%; height: 100%; max-height: none; border-radius: 0; border: 0; margin: 0; }
  .scan-palco { max-height: 46vh; max-height: 46dvh; flex: none; }
}`;

  function abrir() {
    if (document.querySelector(".scan-modal")) return;
    if (!document.getElementById("scanStyle")) {
      const st = document.createElement("style");
      st.id = "scanStyle";
      st.textContent = ESTILO;
      document.head.appendChild(st);
    }
    let stream = null;
    let ocupado = false;
    let resultados = [];
    const stores = { col: {}, wl: {} };

    const wrap = document.createElement("div");
    wrap.className = "list-modal scan-modal";
    wrap.innerHTML = `
      <div class="list-modal-box scan-box" role="dialog" aria-modal="true" aria-label="${escapeAttribute(t("scan.title"))}">
        <div class="scan-head">
          <h2>${escapeHtml(t("scan.title"))}</h2>
          <button type="button" class="lst-mini" data-scan-close>${escapeHtml(t("export.close"))}</button>
        </div>
        <div class="scan-palco" data-scan-palco>
          <video class="scan-video" autoplay playsinline muted data-scan-video></video>
          <div class="scan-guia" data-scan-guia aria-hidden="true"><div class="scan-faixa"></div></div>
          <p class="scan-semcam" data-scan-semcam hidden></p>
        </div>
        <p class="scan-status" data-scan-status aria-live="polite">${escapeHtml(t("scan.status.camera"))}</p>
        <div class="scan-acoes">
          <button type="button" class="cta" data-scan-captura disabled>${escapeHtml(t("scan.capture"))}</button>
          <label class="lst-mini scan-file">${escapeHtml(t("scan.gallery"))}
            <input type="file" accept="image/*" capture="environment" data-scan-file hidden>
          </label>
        </div>
        <form class="scan-codigo" data-scan-form>
          <label for="scanCodigo">${escapeHtml(t("scan.codeLabel"))}</label>
          <input id="scanCodigo" type="text" data-scan-input autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="OP05-119 · 4/102">
          <button type="submit" class="lst-mini">${escapeHtml(t("scan.search"))}</button>
        </form>
        <div class="scan-res" data-scan-res></div>
        <p class="scan-priv">${escapeHtml(t("scan.privacy"))}</p>
      </div>`;
    document.body.appendChild(wrap);
    document.body.classList.add("preview-open");

    const $ = (sel) => wrap.querySelector(sel);
    const video = $("[data-scan-video]");
    const palco = $("[data-scan-palco]");
    const guia = $("[data-scan-guia]");
    const status = $("[data-scan-status]");
    const btnLer = $("[data-scan-captura]");
    const input = $("[data-scan-input]");
    const res = $("[data-scan-res]");

    const dizer = (msg) => { status.textContent = msg; };
    // Progresso do motor em linguagem de gente: só as duas fases que demoram
    // (baixar o núcleo e o modelo, na primeira vez) viram texto.
    const progresso = (fase, p) => {
      if (/core|traineddata|initializ/i.test(fase)) {
        const pct = typeof p === "number" && p > 0 && p < 1 ? ` ${Math.round(p * 100)}%` : "";
        dizer(t("scan.status.loading") + pct);
      }
    };

    function fechar() {
      if (stream) stream.getTracks().forEach((tr) => tr.stop());
      stream = null;
      wrap.remove();
      document.body.classList.remove("preview-open");
      document.removeEventListener("keydown", tecla);
    }
    const tecla = (ev) => { if (ev.key === "Escape") fechar(); };
    document.addEventListener("keydown", tecla);

    function semCamera(msg) {
      video.hidden = true;
      guia.hidden = true;
      const p = $("[data-scan-semcam]");
      p.textContent = msg;
      p.hidden = false;
      btnLer.hidden = true;
      dizer(t("scan.status.nocam"));
    }
    async function abrirCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { semCamera(t("scan.status.nocam")); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } }
        });
      } catch (e) { semCamera(t("scan.status.nocam")); return; }
      if (!wrap.isConnected) { stream.getTracks().forEach((tr) => tr.stop()); return; }
      video.srcObject = stream;
      // Foco contínuo onde a API deixa pedir (Android/Chrome); no resto, ignora.
      try {
        const tr = stream.getVideoTracks()[0];
        const caps = tr.getCapabilities ? tr.getCapabilities() : {};
        if (caps.focusMode && caps.focusMode.includes("continuous")) await tr.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
      } catch (e) { /* sem controle de foco */ }
      await new Promise((r) => { if (video.readyState >= 1) r(); else video.onloadedmetadata = () => r(); });
      try { await video.play(); } catch (e) { /* autoplay já cuidou */ }
      btnLer.disabled = false;
      dizer(t("scan.status.ready"));
    }

    // Lê UM candidato de cada vez até algum achar carta; devolve o vencedor.
    async function procurar(codigos) {
      for (const c of codigos) {
        dizer(t("scan.status.searching", { q: c }));
        const achados = await buscar(c);
        if (achados.length) return { codigo: c, achados };
      }
      return { codigo: codigos[0] || "", achados: [] };
    }
    function mostrar(codigo, achados) {
      resultados = achados;
      if (codigo) input.value = codigo;
      if (!achados.length) {
        const q = codigo || input.value.trim();
        res.innerHTML = `<p class="scan-vazio">${escapeHtml(t(q ? "scan.empty" : "scan.noCode"))}${q
          ? ` <a href="explore?q=${encodeURIComponent(q)}">${escapeHtml(t("cmdk.explore", { q }))}</a>` : ""}</p>`;
        return;
      }
      res.innerHTML = achados.map((h, i) => {
        const src = shared.cardImageSources(h.card);
        const img = shared.localizedImg(src.url, { alt: "", fallback: src.fallback, loading: "lazy", thumb: true });
        return `<div class="cmdk-item cmdk-carditem" data-scan-i="${i}">
            <span class="cmdk-thumb">${img}</span>
            <span class="cmdk-item-name">${escapeHtml(h.card.name)} <small class="cmdk-card-sub">${escapeHtml(`${h.card.set || ""} · ${h.card.number || ""}`)}</small></span>
            <span class="cmdk-actions">
              <button type="button" class="cmdk-add" data-scan-add="col:${i}">${escapeHtml(t("cmdk.addCol"))}</button>
              <button type="button" class="cmdk-add" data-scan-add="wl:${i}">${escapeHtml(t("cmdk.addWl"))}</button>
            </span>
            <span class="cmdk-game">${escapeHtml(shared.gameLabel(h.game))}</span>
          </div>`;
      }).join("");
    }

    // Pipeline de uma leitura: recorte -> OCR da faixa -> (OCR da carta) ->
    // candidatos -> busca. `fonte` é o vídeo ou uma imagem da galeria.
    async function ler(fonte, rec) {
      if (ocupado) return;
      ocupado = true;
      btnLer.disabled = true;
      res.innerHTML = "";
      try {
        const worker = await obterWorker(progresso);
        dizer(t("scan.status.reading"));
        // Carta inteira reamostrada uma vez; a faixa sai dela.
        const carta = preparar(fonte, rec.sx, rec.sy, rec.sw, rec.sh, 1000);
        const hFaixa = Math.round(carta.height * FAIXA);
        const faixa = preparar(carta, 0, carta.height - hFaixa, carta.width, hFaixa, LARGURA_OCR);
        let texto = await ocr(worker, faixa);
        let codigos = extrairCodigos(texto);
        if (!codigos.length) { // Yu-Gi-Oh (código sob a arte) e enquadramento torto
          texto = await ocr(worker, preparar(carta, 0, 0, carta.width, carta.height, LARGURA_OCR));
          codigos = extrairCodigos(texto);
        }
        if (!codigos.length) { mostrar("", []); dizer(t("scan.status.ready")); return; }
        const { codigo, achados } = await procurar(codigos);
        mostrar(codigo, achados);
        dizer(t("scan.status.ready"));
      } catch (e) {
        dizer(t("scan.error"));
      } finally {
        ocupado = false;
        if (stream) btnLer.disabled = false;
      }
    }

    btnLer.addEventListener("click", () => {
      if (!stream || !video.videoWidth) return;
      ler(video, recorteDaGuia(video, palco, guia));
    });
    $("[data-scan-file]").addEventListener("change", async (ev) => {
      const file = ev.target.files && ev.target.files[0];
      ev.target.value = "";
      if (!file) return;
      let img;
      try { img = await bitmapDoArquivo(file); } catch (e) { dizer(t("scan.error")); return; }
      const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
      await ler(img, { sx: 0, sy: 0, sw: w, sh: h });
      if (img.close) img.close();
    });
    $("[data-scan-form]").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const q = input.value.trim().toUpperCase();
      if (!q || ocupado) return;
      ocupado = true;
      res.innerHTML = "";
      try {
        const { achados } = await procurar([q]);
        mostrar(q, achados);
      } catch (e) { dizer(t("scan.error")); }
      finally { ocupado = false; dizer(t("scan.status.ready")); }
    });
    wrap.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-scan-close]")) { fechar(); return; }
      const add = ev.target.closest("[data-scan-add]");
      if (add) {
        const [tipo, i] = String(add.dataset.scanAdd).split(":");
        const h = resultados[Number(i)];
        if (!h) return;
        const v = shared.defaultVariant(h.card);
        if (tipo === "wl") {
          const st = stores.wl[h.game] || (stores.wl[h.game] = shared.createWishlistStore(h.game));
          const on = st.toggle(h.card.id, v);
          add.textContent = on ? "✓ " + t("cmdk.wl") : t("cmdk.addWl");
          add.classList.toggle("done", on);
        } else {
          const st = stores.col[h.game] || (stores.col[h.game] = shared.createCollectionStore(h.game));
          st.add(h.card.id, v, shared.DEFAULT_CONDITION, 1);
          add.textContent = `✓ ×${st.variantTotal(h.card.id, v)}`;
          add.classList.add("done");
        }
        return;
      }
      const item = ev.target.closest("[data-scan-i]");
      if (item) {
        const h = resultados[Number(item.dataset.scanI)];
        if (!h) return;
        fechar();
        window.location.href = shared.detailUrl("set", h.card.set, null, h.game, { setId: h.card.setId });
        return;
      }
      if (!ev.target.closest(".scan-box")) fechar();
    });

    abrirCamera();
    // Aquece o motor enquanto a pessoa enquadra: na primeira vez é o download
    // dos ~3,5 MB, que assim acontece ANTES do toque em "Ler carta".
    obterWorker(progresso).then(() => { if (stream && !ocupado) dizer(t("scan.status.ready")); }).catch(() => dizer(t("scan.error")));
  }

  window.TCGScan = { abrir, extrairCodigos, soDigitos };
})();
