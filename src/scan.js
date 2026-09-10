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
    // Fração: 4/102, 009/094, 12/204 (Pokémon, Lorcana, Riftbound, Magic antigo).
    // COMO IMPRESSA primeiro, sem os zeros depois: o catálogo guarda o número
    // do jeito que a carta imprime ("009/094" no Pokémon moderno, "4/102" no
    // antigo) e a busca da borda casa palavra por prefixo — "9" não acha
    // "009". Testado no celular: a Nymble 009/094 saía como 9/94 e não achava.
    const reFrac = /\b([0-9OILSBZ]{1,3})\s*\/\s*([0-9OILSBZ]{1,3})\b/g;
    while ((m = reFrac.exec(up))) {
      const a = soDigitos(m[1]), b = soDigitos(m[2]);
      if (!/^\d+$/.test(a) || !/^\d+$/.test(b) || parseInt(b, 10) === 0) continue;
      add(`${a}/${b}`);
      add(`${parseInt(a, 10)}/${parseInt(b, 10)}`);
    }
    return out.slice(0, 6);
  }

  // ── Detecção do JOGO (função PURA; testada em tests/scan-codes.test.mjs) ────
  // O mesmo número existe em vários jogos ("4/102" é Pokémon, mas "4" é um set
  // do Lorcana e um número do Magic), então buscar nos 13 de uma vez devolvia
  // Lorcana pra uma carta de Pokémon. Três pistas, somadas:
  //   1. o que a carta IMPRIME no rodapé (© Pokémon/Nintendo, Wizards of the
  //      Coast, Disney, Eiichiro Oda…) — a pista mais forte, +3 por palavra;
  //   2. o FORMATO do código (OP05- é One Piece, BT1- é Digimon, -EN001 é
  //      Yu-Gi-Oh; fração é Pokémon/Lorcana/Riftbound) — +2 por jogo possível;
  //   3. o jogo da SESSÃO (a página de onde o scanner abriu) — +1, desempate.
  // Palavras que vários jogos dividem (BANDAI, SHUEISHA) ficam de fora.
  const PISTAS = {
    pokemon: [/POKEMON/, /\bILLUS\b/, /NINTENDO/, /CREATURES/, /GAME ?FREAK/, /\bHP\b/],
    magic: [/WIZARDS/, /\bCOAST\b/],
    lorcana: [/DISNEY/, /RAVENSBURGER/, /LORCANA/],
    onepiece: [/EIICHIRO/, /\bODA\b/],
    dbfw: [/BIRD ?STUDIO/, /TORIYAMA/, /DRAGON ?BALL/, /FUSION ?WORLD/],
    digimon: [/DIGIMON/, /AKIYOSHI/, /HONGO/],
    gundam: [/GUNDAM/, /SOTSU/, /SUNRISE/],
    ygo: [/KONAMI/, /TAKAHASHI/, /YU-?GI-?OH/],
    fab: [/LEGEND ?STORY/, /FLESH ?AND ?BLOOD/],
    riftbound: [/RIOT ?GAMES/, /RIFTBOUND/, /LEAGUE ?OF ?LEGENDS/],
    unionarena: [/UNION ?ARENA/],
    naruto: [/NARUTO/, /KISHIMOTO/],
    hxh: [/HUNTER/, /TOGASHI/]
  };
  const FORMATOS = [
    [/^(OP|EB|PRB)\d{2}-/, ["onepiece"]],
    [/^ST\d{2}-\d{3}$/, ["onepiece", "gundam", "digimon"]],
    [/^ST\d{1,2}-\d{2}$/, ["digimon"]],
    [/^(BT|EX|RB|LM)\d{1,2}-/, ["digimon"]],
    [/^P-\d{3}$/, ["digimon", "onepiece"]],
    [/^(GD\d{2}|EXB|EXR|EXBP|EXRP)-/, ["gundam"]],
    [/^(FB|FS|FC|FP)\d{0,2}-/, ["dbfw"]],
    [/^[A-Z0-9]{2,4}-[A-Z]{2}\d{3}/, ["ygo"]],
    [/^UE\d{2}/, ["unionarena"]],
    [/^[A-Z]{3}\d{3}$/, ["fab"]],
    [/^\d+\/\d+$/, ["pokemon", "lorcana", "riftbound"]],
    [/^[A-Z][A-Z0-9]{2,3} \d+$/, ["magic"]],
    [/^\d{1,2} \d+$/, ["lorcana"]]
  ];
  function detectarJogo(texto, codigos, sessao) {
    const up = String(texto || "").toUpperCase();
    const pontos = {};
    const soma = (g, n) => { pontos[g] = (pontos[g] || 0) + n; };
    let impresso = false; // alguma palavra IMPRESSA bateu (formato + sessão nunca dão certeza)
    Object.keys(PISTAS).forEach((g) => PISTAS[g].forEach((re) => { if (re.test(up)) { soma(g, 3); impresso = true; } }));
    (codigos || []).slice(0, 2).forEach((c) => FORMATOS.forEach(([re, gs]) => { if (re.test(c)) gs.forEach((g) => soma(g, 2)); }));
    if (sessao && sessao !== "hub") soma(sessao, 1);
    const jogos = Object.keys(pontos).sort((a, b) => pontos[b] - pontos[a] || a.localeCompare(b));
    // "Confiante" = alguma palavra impressa bateu (>= 3) e ninguém empata.
    const confiante = impresso && pontos[jogos[0]] >= 3 && (jogos.length === 1 || pontos[jogos[1]] < pontos[jogos[0]]);
    // Sem pista nenhuma: todos os jogos valem (a busca decide).
    return { jogos, pontos, confiante, restritos: jogos.filter((g) => pontos[g] >= 2) };
  }

  // ── Busca do candidato no catálogo ──────────────────────────────────────────
  const normKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // `jogos`: lista ORDENADA de jogos permitidos (vazia = todos). A borda é
  // consultada por jogo quando são poucos — resposta menor e mais precisa.
  async function buscar(codigo, jogos) {
    const permitidos = jogos && jogos.length ? jogos : null;
    const permite = (g) => !permitidos || permitidos.includes(g);
    const posicao = (g) => (permitidos ? permitidos.indexOf(g) : 0);
    const vistos = new Set();
    const out = [];
    const add = (card, game) => {
      if (!card) return;
      const k = `${game}:${card.id}`;
      if (!vistos.has(k)) { vistos.add(k); out.push({ card, game }); }
    };
    // 1) Set + número EXATOS pelo manifest do jogo (a busca por código da
    //    paleta): baixa só o chunk do set certo.
    try { (await shared.cmdkCardsByCode(codigo)).forEach((h) => { if (permite(h.game)) add(h.card, h.game); }); }
    catch (e) { /* sem manifest/catálogo: segue pra borda */ }
    // 2) Borda (D1): indexa as palavras do número, então acha "4/102" em
    //    qualquer set de 102 cartas e "BT1-001" mesmo quando o setId do
    //    catálogo é "BT-01". Hidrata só as cartas devolvidas.
    if (out.length < 3) {
      let hits;
      if (permitidos && permitidos.length <= 3) {
        const porG = await Promise.all(permitidos.map((g) => shared.searchApi(g, codigo, 8)));
        hits = [].concat.apply([], porG.map((h, i) => (h || []).map((x) => Object.assign({ g: permitidos[i] }, x))));
      } else {
        hits = (await shared.searchApi("all", codigo, 12) || []).filter((h) => permite(h.g || "pokemon"));
      }
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
    // Número exato primeiro ("4/102" antes de um "4" solto), depois a ordem
    // de confiança dos jogos. "Exato" em qualquer escrita do código
    // (cardCodeForms): "009/094" lido na carta é exato pra carta guardada
    // como "9" + total 94.
    const alvo = normKey(codigo);
    const formas = (c) => (shared.cardCodeForms ? shared.cardCodeForms(c) : [c.number]);
    const exato = (h) => (formas(h.card).some((f) => normKey(f) === alvo) ? 0 : 1);
    out.sort((a, b) => exato(a) - exato(b) || posicao(a.game) - posicao(b.game));
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
  // A CÂMERA É A TELA (2026-09-09, segunda versão): o vídeo ocupa a tela inteira
  // e tudo flutua em vidro por cima, como num app de câmera. A moldura passa a
  // 86 % da largura — não é só estética: no vídeo de 1920×1440 o recorte vai de
  // ~700 pra ~1200 px de largura, e os glifos do código dobram de tamanho antes
  // do OCR. O disparador fica embaixo, onde o polegar já está; o resultado
  // aparece entre ele e a moldura, sem tirar o olho da carta; a correção
  // (código, jogo, candidatos) mora numa folha que só sobe quando precisa.
  // Tudo em cores FIXAS (escuro sobre vídeo), independentes do tema do site;
  // só os acentos (--accent) seguem o tema.
  const ESTILO = `
.scan-modal { position: fixed; inset: 0; z-index: 75; overflow: hidden; background: #0b0d12; color: #f3f5f7; --scan-top: max(env(safe-area-inset-top, 0px), 12px); --scan-bot: max(env(safe-area-inset-bottom, 0px), 16px); }
.scan-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.scan-guia { position: absolute; left: 50%; transform: translateX(-50%); border: 2px solid rgba(255,255,255,.9); border-radius: 14px; box-shadow: 0 0 0 200vmax rgba(6,8,12,.45); pointer-events: none; }
.scan-guia i { position: absolute; width: 34px; height: 34px; border: 0 solid #fff; }
.scan-guia .tl { left: -3px; top: -3px; border-left-width: 4px; border-top-width: 4px; border-top-left-radius: 16px; }
.scan-guia .tr { right: -3px; top: -3px; border-right-width: 4px; border-top-width: 4px; border-top-right-radius: 16px; }
.scan-guia .bl { left: -3px; bottom: -3px; border-left-width: 4px; border-bottom-width: 4px; border-bottom-left-radius: 16px; }
.scan-guia .br { right: -3px; bottom: -3px; border-right-width: 4px; border-bottom-width: 4px; border-bottom-right-radius: 16px; }
.scan-faixa { position: absolute; left: 10px; right: 10px; bottom: ${Math.round(FAIXA * 100)}%; border-top: 1px dashed rgba(0,229,255,.75); }
.scan-varredura { position: absolute; left: 6px; right: 6px; top: 40%; height: 2px; background: #00e5ff; box-shadow: 0 0 14px rgba(0,229,255,.9); display: none; animation: scanVarre 1.6s ease-in-out infinite alternate; }
.scan-guia.is-lendo { border-color: rgba(0,229,255,.9); }
.scan-guia.is-lendo i { border-color: #00e5ff; }
.scan-guia.is-lendo .scan-varredura { display: block; }
@keyframes scanVarre { from { top: 8%; } to { top: 90%; } }
@keyframes scanGira { to { transform: rotate(360deg); } }
.scan-top { position: absolute; left: 12px; right: 12px; top: var(--scan-top); height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 4px; border-radius: 999px; background: rgba(13,14,18,.72); border: 1px solid rgba(255,255,255,.1); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
.scan-ico { width: 44px; height: 44px; min-height: 0; flex: none; padding: 0; border: 0; border-radius: 999px; background: transparent; color: #f3f5f7; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.scan-ico svg { width: 22px; height: 22px; }
.scan-ico[aria-pressed="true"] { background: rgba(255,255,255,.16); }
.scan-ico[hidden] { display: none; }
.scan-jogo { appearance: none; -webkit-appearance: none; height: 36px; min-width: 0; max-width: 62%; padding: 0 30px 0 14px; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; background: rgba(255,255,255,.06) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23f3f5f7' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 10px center / 16px; color: #f3f5f7; font: inherit; font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.scan-jogo.is-auto { color: #cfd6e2; }
.scan-dica { position: absolute; left: 12px; right: 12px; display: flex; justify-content: center; pointer-events: none; }
.scan-dica span { padding: 6px 12px; border-radius: 999px; background: rgba(13,14,18,.62); color: #cfd6e2; font-size: 12.5px; font-weight: 600; text-align: center; }
.scan-toast { position: absolute; left: 0; right: 0; bottom: calc(var(--scan-bot) + 124px); display: flex; justify-content: center; pointer-events: none; }
.scan-toast[hidden] { display: none; }
.scan-toast span { display: inline-flex; align-items: center; gap: 10px; padding: 10px 16px; border-radius: 999px; background: rgba(29,33,43,.86); border: 1px solid rgba(255,255,255,.1); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); font-size: 14px; font-weight: 700; }
.scan-spin { width: 16px; height: 16px; border-radius: 999px; border: 2px solid rgba(255,255,255,.25); border-top-color: #00e5ff; animation: scanGira 1.1s linear infinite; }
.scan-semcam { position: absolute; left: 24px; right: 24px; top: 40%; margin: 0; text-align: center; color: #cfd6e2; font-size: 14px; line-height: 1.5; }
.scan-res { position: absolute; left: 12px; right: 12px; bottom: calc(var(--scan-bot) + 110px); display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 14px; background: rgba(29,33,43,.86); border: 1px solid rgba(255,255,255,.1); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); box-shadow: 0 18px 45px rgba(0,0,0,.32); }
.scan-res[hidden] { display: none; }
.scan-res-open { flex: 1; min-width: 0; min-height: 0; display: flex; align-items: center; gap: 12px; padding: 0; border: 0; background: none; color: inherit; text-align: left; font: inherit; cursor: pointer; }
.scan-res-thumb { flex: none; width: 46px; height: 64px; border-radius: 6px; overflow: hidden; background: #262b36; }
.scan-res-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.scan-res-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.scan-res-name { font-size: 16px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scan-res-game { font-size: 10.5px; font-weight: 800; letter-spacing: .03em; text-transform: uppercase; color: #8891a1; border: 1px solid #2d333f; border-radius: 999px; padding: 1px 7px; margin-left: 6px; vertical-align: 2px; }
.scan-res-sub { font-size: 12.5px; color: #9ba4b3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scan-res-price { font-size: 14px; font-weight: 800; color: #7ee2b8; }
.scan-res-acoes { flex: none; display: flex; flex-direction: column; gap: 6px; }
.scan-res-add { height: 34px; min-height: 0; padding: 0 12px; border: 0; border-radius: 9px; background: var(--accent, #dc2626); color: var(--on-accent, #fff); font: inherit; font-size: 12.5px; font-weight: 800; white-space: nowrap; cursor: pointer; }
.scan-res-add.done { background: #262b36; color: #7ee2b8; }
.scan-res-alt { height: 30px; min-height: 0; padding: 0 12px; border: 1px solid #2d333f; border-radius: 9px; background: #1d212b; color: #f3f5f7; font: inherit; font-size: 11.5px; font-weight: 700; white-space: nowrap; cursor: pointer; }
.scan-bottom { position: absolute; left: 0; right: 0; bottom: var(--scan-bot); height: 96px; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; padding: 0 20px; }
.scan-bottom > :first-child { justify-self: start; }
.scan-bottom > :last-child { justify-self: end; }
.scan-round { width: 52px; height: 52px; min-height: 0; flex: none; padding: 0; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; background: rgba(13,14,18,.62); color: #f3f5f7; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.scan-round svg { width: 22px; height: 22px; }
.scan-shutter { width: 94px; height: 94px; min-height: 0; flex: none; justify-self: center; padding: 0; border: 4px solid rgba(255,255,255,.35); border-radius: 999px; background: transparent; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.scan-shutter span { width: 76px; height: 76px; border-radius: 999px; background: #fff; display: block; }
.scan-shutter[disabled] { opacity: .55; cursor: wait; }
.scan-shutter[hidden] { display: none; }
.scan-lote { height: 44px; min-height: 0; flex: none; padding: 0 14px 0 12px; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; background: rgba(13,14,18,.62); color: #f3f5f7; font: inherit; font-size: 13px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.scan-lote.is-vazio { visibility: hidden; }
.scan-lote svg { width: 16px; height: 16px; }
.scan-lote-n { min-width: 22px; height: 22px; padding: 0 6px; border-radius: 999px; background: var(--accent, #dc2626); color: var(--on-accent, #fff); font-size: 12px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; }
.scan-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.35); }
.scan-backdrop[hidden] { display: none; }
.scan-sheet { position: absolute; left: 0; right: 0; bottom: 0; max-height: 84%; overflow-y: auto; overscroll-behavior: contain; padding: 12px 12px calc(var(--scan-bot) + 8px); border-radius: 18px 18px 0 0; background: rgba(19,21,27,.96); border-top: 1px solid rgba(255,255,255,.1); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); display: flex; flex-direction: column; gap: 12px; }
.scan-sheet[hidden] { display: none; }
.scan-sheet-handle { width: 40px; height: 4px; border-radius: 999px; background: #2d333f; margin: 0 auto; flex: none; }
.scan-sheet-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 0 4px; }
.scan-sheet-head strong { font-size: 15px; font-weight: 800; }
.scan-sheet-head span { font-size: 12.5px; color: #9ba4b3; white-space: nowrap; }
.scan-cands { display: flex; gap: 10px; overflow-x: auto; padding: 2px 4px 4px; -webkit-overflow-scrolling: touch; }
.scan-cands:empty { display: none; }
.scan-cand { flex: none; width: 128px; min-height: 0; display: flex; flex-direction: column; align-items: stretch; gap: 6px; padding: 8px; border: 1px solid #2d333f; border-radius: 12px; background: #1d212b; color: #f3f5f7; font: inherit; text-align: left; cursor: pointer; }
.scan-cand.is-on { border: 2px solid var(--accent, #dc2626); padding: 7px; }
.scan-cand-img { height: 150px; border-radius: 8px; overflow: hidden; background: #262b36; }
.scan-cand-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.scan-cand-name { font-size: 13px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scan-cand-sub { font-size: 11.5px; color: #9ba4b3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scan-cand-price { font-size: 13px; font-weight: 800; color: #7ee2b8; }
.scan-form { display: flex; gap: 8px; align-items: center; }
.scan-field { flex: 1; min-width: 0; height: 44px; display: flex; align-items: center; gap: 8px; padding: 0 12px; border: 1px solid #2d333f; border-radius: 9px; background: #1d212b; }
.scan-field span { flex: none; font-size: 12px; font-weight: 700; color: #8891a1; }
.scan-field input { flex: 1; min-width: 0; height: 40px; padding: 0; border: 0; background: none; color: #f3f5f7; font: inherit; font-size: 16px; font-weight: 800; text-transform: uppercase; outline: none; }
.scan-form .lst-mini { min-height: 44px; border-radius: 9px; background: #1d212b; border-color: #2d333f; color: #f3f5f7; }
.scan-sheet-acoes { display: flex; gap: 8px; }
.scan-sheet-acoes[hidden] { display: none; }
.scan-sheet-acoes .cta { flex: 1; min-width: 0; justify-content: center; min-height: 46px; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scan-heart { width: 46px; height: 46px; min-height: 0; flex: none; padding: 0; border: 1px solid #2d333f; border-radius: 9px; background: #1d212b; color: #f3f5f7; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.scan-heart svg { width: 20px; height: 20px; }
.scan-heart.done { color: var(--accent-ink, #ef4444); border-color: var(--accent-ink, #ef4444); }
.scan-vazio { margin: 0; padding: 0 4px; font-size: 13px; color: #9ba4b3; line-height: 1.5; }
.scan-vazio[hidden] { display: none; }
.scan-vazio a { color: var(--accent-ink, #ef4444); font-weight: 700; }
.scan-priv { margin: 0; font-size: 11.5px; color: #8891a1; text-align: center; }`;

  const ICO = {
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H13L13 2z"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5.5-5.5L7 19"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>'
  };
  // Valor de mercado da carta na moeda do site (mesma conta das grades), ou ""
  // quando não há preço carregado pra ela.
  function valorDe(card) {
    try {
      const v = shared.cardValue(card, shared.defaultVariant(card), null);
      if (!v || !(v.value > 0)) return "";
      const n = v.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return (v.currency === "BRL" ? "R$ " : v.currency === "USD" ? "US$ " : "€ ") + n;
    } catch (e) { return ""; }
  }
  function miniatura(card) {
    const src = shared.cardImageSources(card);
    return shared.localizedImg(src.url, { alt: "", fallback: src.fallback, loading: "lazy", thumb: true });
  }

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
    let primario = 0;
    let codigoAtual = "";
    let lote = 0;
    let ultimoTexto = ""; // texto do último OCR: a busca manual reaproveita as pistas
    const stores = { col: {}, wl: {} };
    const sessao = (window.SLEEVU && window.SLEEVU.game) || "";

    const wrap = document.createElement("div");
    wrap.className = "scan-modal";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-label", t("scan.title"));
    wrap.innerHTML = `
      <video class="scan-video" autoplay playsinline muted data-scan-video></video>
      <div class="scan-guia" data-scan-guia aria-hidden="true"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i><div class="scan-faixa"></div><div class="scan-varredura"></div></div>
      <p class="scan-semcam" data-scan-semcam hidden></p>
      <div class="scan-top">
        <button type="button" class="scan-ico" data-scan-close aria-label="${escapeAttribute(t("export.close"))}" title="${escapeAttribute(t("export.close"))}">${ICO.x}</button>
        <select class="scan-jogo is-auto" data-scan-jogo aria-label="${escapeAttribute(t("scan.gameLabel"))}">
          <option value="">${escapeHtml(t("scan.gameAuto"))}</option>
          ${shared.GAME_SLUGS.map((g) => `<option value="${escapeAttribute(g)}">${escapeHtml(shared.gameLabel(g))}</option>`).join("")}
        </select>
        <button type="button" class="scan-ico" data-scan-torch aria-pressed="false" aria-label="${escapeAttribute(t("scan.torch"))}" title="${escapeAttribute(t("scan.torch"))}" hidden>${ICO.bolt}</button>
      </div>
      <div class="scan-dica" data-scan-dica><span data-scan-status aria-live="polite">${escapeHtml(t("scan.status.camera"))}</span></div>
      <div class="scan-toast" data-scan-toast hidden><span><span class="scan-spin" aria-hidden="true"></span><span data-scan-toast-text></span></span></div>
      <div class="scan-res" data-scan-res hidden></div>
      <div class="scan-bottom">
        <label class="scan-round" aria-label="${escapeAttribute(t("scan.gallery"))}" title="${escapeAttribute(t("scan.gallery"))}">${ICO.image}<input type="file" accept="image/*" capture="environment" data-scan-file hidden></label>
        <button type="button" class="scan-shutter" data-scan-captura aria-label="${escapeAttribute(t("scan.capture"))}" title="${escapeAttribute(t("scan.capture"))}" disabled><span></span></button>
        <button type="button" class="scan-lote is-vazio" data-scan-lote><span class="scan-lote-n" data-scan-lote-n>0</span><span>${escapeHtml(t("scan.batch"))}</span>${ICO.arrow}</button>
      </div>
      <div class="scan-backdrop" data-scan-backdrop hidden></div>
      <div class="scan-sheet" data-scan-sheet hidden>
        <div class="scan-sheet-handle"></div>
        <div class="scan-sheet-head"><strong data-scan-sheet-title></strong><span data-scan-sheet-sub></span></div>
        <div class="scan-cands" data-scan-cands></div>
        <p class="scan-vazio" data-scan-vazio hidden></p>
        <form class="scan-form" data-scan-form>
          <label class="scan-field"><span>${escapeHtml(t("scan.codeLabel"))}</span><input type="text" data-scan-input autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="OP05-119 · 4/102"></label>
          <button type="submit" class="lst-mini">${escapeHtml(t("scan.search"))}</button>
        </form>
        <div class="scan-sheet-acoes" data-scan-sheet-acoes hidden>
          <button type="button" class="cta" data-scan-add="col:0"></button>
          <button type="button" class="scan-heart" data-scan-add="wl:0" aria-label="${escapeAttribute(t("cmdk.addWl"))}" title="${escapeAttribute(t("cmdk.addWl"))}">${ICO.heart}</button>
        </div>
        <p class="scan-priv">${escapeHtml(t("scan.privacy"))}</p>
      </div>`;
    document.body.appendChild(wrap);
    document.body.classList.add("preview-open");

    const $ = (sel) => wrap.querySelector(sel);
    const video = $("[data-scan-video]");
    const guia = $("[data-scan-guia]");
    const topo = $(".scan-top");
    const dica = $("[data-scan-dica]");
    const status = $("[data-scan-status]");
    const toast = $("[data-scan-toast]");
    const toastTexto = $("[data-scan-toast-text]");
    const btnLer = $("[data-scan-captura]");
    const btnTorch = $("[data-scan-torch]");
    const btnLote = $("[data-scan-lote]");
    const selJogo = $("[data-scan-jogo]");
    const resCard = $("[data-scan-res]");
    const folha = $("[data-scan-sheet]");
    const fundo = $("[data-scan-backdrop]");
    const cands = $("[data-scan-cands]");
    const vazio = $("[data-scan-vazio]");
    const input = $("[data-scan-input]");
    const acoesFolha = $("[data-scan-sheet-acoes]");

    // A dica sob a moldura some com a mensagem vazia (o [hidden] global vence o
    // display:flex). "Encaixe a carta na moldura…" é instrução de PRIMEIRA
    // vez: depois da primeira leitura ela não volta — voltava a cada leitura
    // e encavalava com o cartão de resultado, que ocupa o mesmo lugar.
    let jaLeu = false;
    const dizer = (msg) => { status.textContent = msg; dica.hidden = !msg; };
    const pronto = () => dizer(jaLeu ? "" : t("scan.status.ready"));
    const aviso = (msg) => { if (msg) { toastTexto.textContent = msg; toast.hidden = false; } else toast.hidden = true; };
    // Progresso do motor em linguagem de gente: só as duas fases que demoram
    // (baixar o núcleo e o modelo, na primeira vez) viram texto.
    const progresso = (fase, p) => {
      if (/core|traineddata|initializ/i.test(fase)) {
        const pct = typeof p === "number" && p > 0 && p < 1 ? ` ${Math.round(p * 100)}%` : "";
        dizer(t("scan.status.loading") + pct);
      }
    };
    // Jogos permitidos na busca: o escolhido no seletor, ou o que a carta diz.
    function jogosDaBusca(codigos) {
      if (selJogo.value) return [selJogo.value];
      const d = detectarJogo(ultimoTexto, codigos, sessao);
      return d.restritos.length ? d.jogos.filter((g) => d.pontos[g] >= 2) : [];
    }
    selJogo.addEventListener("change", () => {
      selJogo.classList.toggle("is-auto", !selJogo.value);
      if (codigoAtual && !ocupado) buscarManual(codigoAtual);
    });

    // Moldura: 86 % da largura (teto de 440 px), limitada pela altura que sobra
    // entre a barra de cima e a área do resultado + disparador. Em JS porque
    // width + aspect-ratio + max-height não fecham em CSS puro.
    function posicionaGuia() {
      const W = wrap.clientWidth, H = wrap.clientHeight;
      const y = topo.getBoundingClientRect().bottom + 12;
      const reserva = 244; // resultado + controles + folgas
      const altMax = Math.max(200, H - y - reserva);
      let w = Math.min(W * 0.86, 440), h = w * 88 / 63;
      if (h > altMax) { h = altMax; w = h * 63 / 88; }
      guia.style.width = `${Math.round(w)}px`;
      guia.style.height = `${Math.round(h)}px`;
      guia.style.top = `${Math.round(y)}px`;
      dica.style.top = `${Math.round(y + h + 10)}px`;
    }
    posicionaGuia();
    window.addEventListener("resize", posicionaGuia);

    function fechar() {
      if (stream) stream.getTracks().forEach((tr) => tr.stop());
      stream = null;
      wrap.remove();
      document.body.classList.remove("preview-open");
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("resize", posicionaGuia);
    }
    const tecla = (ev) => {
      if (ev.key !== "Escape") return;
      if (!folha.hidden) fecharFolha(); else fechar();
    };
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
      // Foco contínuo e lanterna onde a API deixa pedir (Android/Chrome); no
      // resto, ignora — o botão da lanterna só aparece se o aparelho tem uma.
      try {
        const tr = stream.getVideoTracks()[0];
        const caps = tr.getCapabilities ? tr.getCapabilities() : {};
        if (caps.focusMode && caps.focusMode.includes("continuous")) await tr.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
        if (caps.torch) btnTorch.hidden = false;
      } catch (e) { /* sem controle de foco/lanterna */ }
      await new Promise((r) => { if (video.readyState >= 1) r(); else video.onloadedmetadata = () => r(); });
      try { await video.play(); } catch (e) { /* autoplay já cuidou */ }
      btnLer.disabled = false;
      pronto();
    }
    btnTorch.addEventListener("click", async () => {
      if (!stream) return;
      const on = btnTorch.getAttribute("aria-pressed") !== "true";
      try {
        await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: on }] });
        btnTorch.setAttribute("aria-pressed", on ? "true" : "false");
      } catch (e) { /* aparelho recusou */ }
    });

    // ── Resultado e folha ────────────────────────────────────────────────────
    function textoAdd(h) {
      const st = stores.col[h.game];
      const v = shared.defaultVariant(h.card);
      const n = st ? st.variantTotal(h.card.id, v) : 0;
      return n > 0 ? `✓ ×${n}` : t("cmdk.addCol");
    }
    function pintarResultado() {
      const h = resultados[primario];
      if (!h) { resCard.hidden = true; return; }
      const preco = valorDe(h.card);
      const n = resultados.length;
      const jaTem = textoAdd(h);
      resCard.innerHTML = `
        <button type="button" class="scan-res-open" data-scan-open>
          <span class="scan-res-thumb">${miniatura(h.card)}</span>
          <span class="scan-res-text">
            <span class="scan-res-name">${escapeHtml(h.card.name)}<span class="scan-res-game">${escapeHtml(shared.gameLabel(h.game))}</span></span>
            <span class="scan-res-sub">${escapeHtml(`${h.card.set || ""} · ${h.card.number || ""}`)}</span>
            ${preco ? `<span class="scan-res-price">${escapeHtml(preco)}</span>` : ""}
          </span>
        </button>
        <span class="scan-res-acoes">
          <button type="button" class="scan-res-add${jaTem.startsWith("✓") ? " done" : ""}" data-scan-add="col:${primario}">${escapeHtml(jaTem)}</button>
          <button type="button" class="scan-res-alt" data-scan-more>${escapeHtml(n > 1 ? t("scan.more", { n: n - 1 }) : t("scan.notThis"))}</button>
        </span>`;
      resCard.hidden = false;
    }
    function pintarFolha() {
      const n = resultados.length;
      $("[data-scan-sheet-title]").textContent = n > 1 ? t("scan.sheetMany", { n, q: codigoAtual }) : t("scan.sheetFix");
      $("[data-scan-sheet-sub]").textContent = n > 1 ? t("scan.tapRight") : "";
      cands.innerHTML = resultados.map((h, i) => {
        const preco = valorDe(h.card);
        return `<button type="button" class="scan-cand${i === primario ? " is-on" : ""}" data-scan-cand="${i}">
            <span class="scan-cand-img">${miniatura(h.card)}</span>
            <span class="scan-cand-name">${escapeHtml(h.card.name)}</span>
            <span class="scan-cand-sub">${escapeHtml(`${h.card.set || ""} · ${h.card.number || ""}`)}</span>
            ${preco ? `<span class="scan-cand-price">${escapeHtml(preco)}</span>` : `<span class="scan-cand-sub">${escapeHtml(shared.gameLabel(h.game))}</span>`}
          </button>`;
      }).join("");
      const q = codigoAtual || input.value.trim();
      if (!n) {
        vazio.innerHTML = `${escapeHtml(t(q ? "scan.empty" : "scan.noCode"))}${q
          ? ` <a href="explore?q=${encodeURIComponent(q)}">${escapeHtml(t("cmdk.explore", { q }))}</a>` : ""}`;
        vazio.hidden = false;
      } else vazio.hidden = true;
      input.value = codigoAtual;
      const h = resultados[primario];
      acoesFolha.hidden = !h;
      if (h) {
        const add = acoesFolha.querySelector("[data-scan-add^='col']");
        add.dataset.scanAdd = `col:${primario}`;
        const jaTem = textoAdd(h);
        add.textContent = jaTem.startsWith("✓") ? jaTem : `${t("scan.addNamed")} ${h.card.name}`;
        add.classList.toggle("done", jaTem.startsWith("✓"));
        const wl = acoesFolha.querySelector("[data-scan-add^='wl']");
        wl.dataset.scanAdd = `wl:${primario}`;
        const stw = stores.wl[h.game] || (stores.wl[h.game] = shared.createWishlistStore(h.game));
        wl.classList.toggle("done", !!(stw.has && stw.has(h.card.id, shared.defaultVariant(h.card))));
      }
    }
    function abrirFolha() {
      pintarFolha();
      fundo.hidden = false;
      folha.hidden = false;
      if (!resultados.length) { try { input.focus(); } catch (e) { /* teclado não abriu */ } }
    }
    function fecharFolha() { folha.hidden = true; fundo.hidden = true; }
    function entregar(codigo, achados) {
      codigoAtual = codigo || "";
      resultados = achados;
      primario = 0;
      pintarResultado();
      if (!achados.length) abrirFolha(); // sem carta: a folha já abre com o código pra corrigir
      else if (navigator.vibrate) { try { navigator.vibrate(30); } catch (e) { /* sem vibração */ } }
    }
    function adicionar(tipo, i, btn) {
      const h = resultados[i];
      if (!h) return;
      const v = shared.defaultVariant(h.card);
      if (tipo === "wl") {
        const st = stores.wl[h.game] || (stores.wl[h.game] = shared.createWishlistStore(h.game));
        const on = st.toggle(h.card.id, v);
        btn.classList.toggle("done", on);
        if (!btn.classList.contains("scan-heart")) btn.textContent = on ? "✓ " + t("cmdk.wl") : t("cmdk.addWl");
        return;
      }
      const st = stores.col[h.game] || (stores.col[h.game] = shared.createCollectionStore(h.game));
      st.add(h.card.id, v, shared.DEFAULT_CONDITION, 1);
      lote += 1;
      $("[data-scan-lote-n]").textContent = String(lote);
      btnLote.classList.remove("is-vazio");
      if (navigator.vibrate) { try { navigator.vibrate(20); } catch (e) { /* sem vibração */ } }
      pintarResultado();
      if (!folha.hidden) fecharFolha();
    }

    // Lê UM candidato de cada vez até algum achar carta; devolve o vencedor.
    async function procurar(codigos) {
      const jogos = jogosDaBusca(codigos);
      for (const c of codigos) {
        aviso(t("scan.status.searching", { q: c }));
        const achados = await buscar(c, jogos);
        if (achados.length) return { codigo: c, achados };
      }
      // Restrito a um jogo detectado e nada achado: uma segunda chance sem o
      // filtro (a pista pode ter vindo de um reflexo ou de um texto errado).
      if (jogos.length && !selJogo.value) {
        for (const c of codigos) {
          const achados = await buscar(c, []);
          if (achados.length) return { codigo: c, achados };
        }
      }
      return { codigo: codigos[0] || "", achados: [] };
    }

    // Pipeline de uma leitura: recorte -> OCR da faixa -> (OCR da carta) ->
    // candidatos -> busca. `fonte` é o vídeo ou uma imagem da galeria.
    async function ler(fonte, rec) {
      if (ocupado) return;
      ocupado = true;
      let falhou = false;
      btnLer.disabled = true;
      resCard.hidden = true;
      fecharFolha();
      guia.classList.add("is-lendo");
      try {
        const worker = await obterWorker(progresso);
        aviso(t("scan.status.reading"));
        // Carta inteira reamostrada uma vez; a faixa sai dela.
        const carta = preparar(fonte, rec.sx, rec.sy, rec.sw, rec.sh, 1000);
        const hFaixa = Math.round(carta.height * FAIXA);
        const faixa = preparar(carta, 0, carta.height - hFaixa, carta.width, hFaixa, LARGURA_OCR);
        let texto = await ocr(worker, faixa);
        let codigos = extrairCodigos(texto);
        // Carta inteira quando a faixa não bastou: sem código (Yu-Gi-Oh imprime
        // sob a arte; enquadramento torto) ou sem saber o JOGO (a fração
        // "4/102" é de três jogos; o "© Pokémon" pode estar fora da faixa).
        let deteccao = detectarJogo(texto, codigos, sessao);
        if (!codigos.length || (!selJogo.value && !deteccao.confiante)) {
          texto += "\n" + await ocr(worker, preparar(carta, 0, 0, carta.width, carta.height, LARGURA_OCR));
          if (!codigos.length) codigos = extrairCodigos(texto);
          deteccao = detectarJogo(texto, codigos, sessao);
        }
        ultimoTexto = texto;
        // Seletor mostra o jogo detectado (a pessoa corrige se errar); sem
        // certeza fica em "automático" e a busca usa a lista de possíveis.
        if (!selJogo.value && deteccao.confiante) { selJogo.value = deteccao.jogos[0]; selJogo.classList.remove("is-auto"); }
        if (!codigos.length) { entregar("", []); return; }
        const { codigo, achados } = await procurar(codigos);
        entregar(codigo, achados);
      } catch (e) {
        falhou = true;
        dizer(t("scan.error"));
      } finally {
        ocupado = false;
        jaLeu = true;
        aviso("");
        guia.classList.remove("is-lendo");
        // Erro fica na tela (a dica só volta a sumir na próxima leitura).
        if (stream) { btnLer.disabled = false; if (!falhou) pronto(); }
      }
    }
    async function buscarManual(q) {
      if (!q || ocupado) return;
      ocupado = true;
      try {
        const { achados } = await procurar([q]);
        codigoAtual = q;
        resultados = achados;
        primario = 0;
        pintarResultado();
        if (!folha.hidden || !achados.length) pintarFolha();
        if (!achados.length) abrirFolha(); else fecharFolha();
      } catch (e) { dizer(t("scan.error")); }
      finally { ocupado = false; aviso(""); }
    }

    btnLer.addEventListener("click", () => {
      if (!stream || !video.videoWidth) return;
      ler(video, recorteDaGuia(video, wrap, guia));
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
    $("[data-scan-form]").addEventListener("submit", (ev) => {
      ev.preventDefault();
      buscarManual(input.value.trim().toUpperCase());
    });
    wrap.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-scan-close]")) { fechar(); return; }
      if (ev.target.closest("[data-scan-backdrop]") || ev.target.closest(".scan-sheet-handle")) { fecharFolha(); return; }
      if (ev.target.closest("[data-scan-more]")) { abrirFolha(); return; }
      if (ev.target.closest("[data-scan-lote]")) { fechar(); window.location.href = "collection"; return; }
      const add = ev.target.closest("[data-scan-add]");
      if (add) {
        const [tipo, i] = String(add.dataset.scanAdd).split(":");
        adicionar(tipo, Number(i), add);
        return;
      }
      const cand = ev.target.closest("[data-scan-cand]");
      if (cand) {
        primario = Number(cand.dataset.scanCand);
        pintarResultado();
        fecharFolha();
        return;
      }
      if (ev.target.closest("[data-scan-open]")) {
        const h = resultados[primario];
        if (!h) return;
        fechar();
        window.location.href = shared.detailUrl("set", h.card.set, null, h.game, { setId: h.card.setId });
      }
    });

    abrirCamera();
    // Aquece o motor enquanto a pessoa enquadra: na primeira vez é o download
    // dos ~3,5 MB, que assim acontece ANTES do toque no disparador.
    obterWorker(progresso).then(() => { if (stream && !ocupado) pronto(); }).catch(() => dizer(t("scan.error")));
  }

  window.TCGScan = { abrir, extrairCodigos, soDigitos, detectarJogo };
})();
