// Centering Tool v2 (centering.html, 2026-10-01): a INTERFACE. Ver
// docs/PLANO-CENTERING-V2.md — este arquivo é a §5 (experiência) e a parte de
// tela da §6 (entrada, palco, lupa, zoom, teclado, desfazer). As contas moram
// em dois arquivos PUROS, sem DOM, que rodam no node e têm teste próprio:
//   src/centering-core.js     → window.TCGCenteringCore (cabeçalho, homografia,
//                                achatar, ímã, sugestão das linhas, medir)
//   src/centering-graders.js  → window.TCGCenteringGraders (tabelas e regras)
// Aqui só se desenha, se mexe nos cantos e nas linhas e se mostra o número.
// Toda chamada ao núcleo passa por tem(): se um dos dois não carregou, a
// página diz isso em vez de quebrar no meio do gesto.
//
// A FOTO NUNCA SAI DO NAVEGADOR (herança da v1, e a promessa da página): nada
// de upload, nada de IndexedDB, nada no sessionStorage além de NÚMEROS. A foto
// vive em memória como Blob + os pixels do lado ativo; ao sair, os object URLs
// são revogados, os ImageBitmap fechados e os canvas zerados.
//
// O modal da v1 (aberto pelo HUB e pela página Ferramentas) saiu: a
// ferramenta é a página /centering, pública, com endereço próprio.
(function () {
  "use strict";
  const shared = window.TCGShared;
  const app = document.getElementById("ctrApp");
  if (!shared || !app) return;
  const { t } = shared;
  // escapeHtml do shared engole o 0 (`value || ""`): número passa como texto.
  const esc = (v) => shared.escapeHtml(v == null ? "" : String(v));
  const escA = (v) => shared.escapeAttribute(v == null ? "" : String(v));
  const core = window.TCGCenteringCore || {};
  const grad = window.TCGCenteringGraders || null;
  const tem = (...nomes) => nomes.every((n) => typeof core[n] === "function");
  const lang = () => { try { return shared.getLanguage() || "pt"; } catch (e) { return "pt"; } };

  // ── Constantes ────────────────────────────────────────────────────────────
  const CHAVE = "ctr-sessao-v1";        // números da medição (pixels, nunca)
  const CAMERA = "ctr-camera-aberta";   // marca de "a câmera nativa pode matar a aba"
  // O palco é sempre escuro, em qualquer tema: as cores das linhas são fixas e
  // a distinção nunca depende só delas (tracejado × sólido, anel × quadrado).
  const PALCO_BG = "#0b0d12";
  const COR = { corte: "#f3f5f7", moldura: "#00e5ff", sel: "#ff3d7f", halo: "rgba(0,0,0,.65)", fora: "rgba(6,8,12,.55)", faixa: "rgba(255,255,255,.10)" };
  const LADOS = ["l", "r", "t", "b"];
  const GUIA = ["l", "r", "t", "b"];   // a ordem do modo guiado e do Tab
  const VERT = { l: true, r: true, t: false, b: false };
  // Ordem obrigatória por eixo: corte_esq < moldura_esq < moldura_dir < corte_dir.
  const ORDEM = { v: [["ext", "l"], ["int", "l"], ["int", "r"], ["ext", "r"]], h: [["ext", "t"], ["int", "t"], ["int", "b"], ["ext", "b"]] };
  const PRESETS = core.PRESETS || { "63x88": { W: 63, H: 88 }, "59x86": { W: 59, H: 86 } };
  const CANTOS = ["tl", "tr", "br", "bl"];
  const ARESTAS = ["t", "r", "b", "l"];  // aresta i = do canto i ao i+1
  const ORDEM_NOTAS = ["10+", "10P", "10", "9.5", "9", "8.5", "8", "7.5", "7", "6.5", "6", "5.5", "5", "4.5", "4", "3.5", "3", "2.5", "2", "1.5", "1"];
  const MAX_LADO = 4096;
  const DPR_MAX = 3;
  const reduzMov = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const toque = () => window.matchMedia && matchMedia("(pointer: coarse)").matches;

  // Ícones: SVG de traço com currentColor (CLAUDE.md: nunca glifo em botão).
  const ic = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    camera: ic('<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H7l2-2.5h6L17 6h1.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z"/><circle cx="12" cy="13" r="3.5"/>'),
    imagem: ic('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>'),
    colar: ic('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>'),
    gira: ic('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
    reta: ic('<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>'),
    desfaz: ic('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
    refaz: ic('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
    mais3: ic('<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>'),
    volta: ic('<path d="m15 6-6 6 6 6"/>'),
    seta: ic('<path d="m9 6 6 6-6 6"/>'),
    cima: ic('<path d="m18 15-6-6-6 6"/>'),
    menos: ic('<path d="M5 12h14"/>'),
    mais: ic('<path d="M12 5v14M5 12h14"/>'),
    ajusta: ic('<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>'),
    ima: ic('<path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"/><path d="m5 8 4 4"/><path d="m12 15 4 4"/>'),
    teclado: ic('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
    lupa: ic('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
    check: ic('<path d="M20 6 9 17l-5-5"/>'),
    cantos: ic('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
    fecha: ic('<path d="M18 6 6 18M6 6l12 12"/>')
  };

  // ── Estado ────────────────────────────────────────────────────────────────
  // Medicao (uma por lado): o Blob da foto, os pixels SÓ do lado ativo, os
  // cantos em px da foto (TL, TR, BR, BL) e as 8 linhas no espaço da carta.
  const sessao = { ladoAtivo: "f", preset: "63x88", custom: { W: 63, H: 88 }, categoria: "tcg", ima: true, lados: { f: null, v: null } };
  // A pilha de passos é por LADO ("f:bordas", "v:entrada"): só pelo nome do
  // passo, "Medir o verso" achava a "entrada" da frente no fundo da pilha e
  // voltava 3 entradas do histórico — o voltar seguinte saía da ferramenta.
  const chave = (p, lado) => (lado || sessao.ladoAtivo) + ":" + p;
  const ui = {
    passo: "entrada", pilha: [chave("entrada")], modo: "pc", aberto: false,
    va: null, vb: null, vbDesenho: null, tam: { w: 0, h: 0 },
    sel: { tipo: "int", lado: "l" }, guiado: 0, folha: 0, maisAberto: false, tabLado: "f",
    ponteiros: new Map(), gesto: null, espaco: false, ultimoToque: null, engoleClick: 0,
    lupa: null, lupaVisivel: false, lupaLado: "dir", lupaTimer: 0,
    menu: false, atalhos: false, limita: null, sugereGuiado: false, sobrePalco: false,
    sujo: {}, rafId: 0, renderTimer: 0, vivoTimer: 0, toastTimer: 0,
    carregando: false, anterior: null, sincronizando: false,
    // geracao: cada aplicaPasso invalida a espera de uma redecodificação
    // anterior; nCarregando: decodificações em curso (o "Abrindo a foto…" só
    // some quando a última acaba); pendente: foto que chegou durante a
    // sincronização da conta; tipoUltimo: o ponteiro do último toque no palco.
    geracao: 0, nCarregando: 0, pendente: null, tipoUltimo: ""
  };
  const el = {};
  const urls = new Set();

  function novaMedicao(blob, nome) {
    return {
      blob: blob || null, nome: nome || "", tipo: null, w: 0, h: 0, exif: null, img: null, mips: null, bmps: [],
      // cantoMao por canto: 0 = ainda no quadrilátero inicial, 1 = solto com o
      // ímã (o refino pode reencaixar), 2 = posto à mão (Alt, ímã desligado,
      // teclado ou "Foto já reta": o refino não mexe).
      cantos: null, cantoMao: [0, 0, 0, 0], sigmaCantoPx: [3, 3, 3, 3], sigmaManual: null, rot: 0, pose: null,
      linhas: null, sigma: null, origem: null, confere: [], fraca: [], giro: 0, res: null,
      undo: [], redo: [], ultimoPasso: 0, m: null, mi: null, chaveM: "", dec: null
    };
  }
  const ativa = () => sessao.lados[sessao.ladoAtivo];
  const outroLado = (k) => (k === "f" ? "v" : "f");
  const emBordas = () => ui.passo === "bordas" || ui.passo === "guiado" || ui.passo === "resultado";

  // ── Utilidades ────────────────────────────────────────────────────────────
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const limita = (x, a, b) => Math.max(a, Math.min(b, x));
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const em = (L, s) => L.c + L.k * (s - 0.5);
  const ehNum = (x) => typeof x === "number" && isFinite(x);

  function num(n, casas) {
    const c = casas == null ? 1 : casas;
    if (!ehNum(n)) return "—";
    if (tem("fmt")) { try { return core.fmt(n, lang(), c); } catch (e) { /* cai no padrão */ } }
    const s = n.toFixed(c);
    return lang() === "en" ? s : s.replace(".", ",");
  }
  const arred1 = (p) => (tem("arred1") ? core.arred1(p) : Math.round(p * 10 + 1e-9) / 10);
  function par(p) {
    if (tem("par")) return core.par(p);
    const a = arred1(p);
    return [a, Math.round((100 - a) * 10) / 10];
  }
  function preset() {
    if (sessao.preset === "personalizado") return sessao.custom;
    return PRESETS[sessao.preset] || PRESETS["63x88"];
  }
  function debounce(fn, ms) {
    let id = 0;
    return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); };
  }

  // ── Geometria (desenho; a medição é do núcleo) ───────────────────────────
  // Homografia em cache: (u,v) da carta → px da foto, refeita só quando os
  // cantos mudam.
  function mat(med) {
    const chave = String(med.cantos);
    if (med.chaveM !== chave) { med.m = core.squareToQuad(med.cantos); med.mi = core.inverte(med.m); med.chaveM = chave; }
    return med.m;
  }
  function cartaPx(med) {
    const c = med.cantos;
    return { w: Math.max(1, (dist(c[0], c[1]) + dist(c[3], c[2])) / 2), h: Math.max(1, (dist(c[0], c[3]) + dist(c[1], c[2])) / 2) };
  }
  // px da foto por mm da carta (o lado mais bem resolvido): é o que limita o
  // zoom (1 px da foto = no máximo 4 px de tela) e converte a lupa.
  function pxPorMm(med) { const p = preset(), c = cartaPx(med); return Math.max(c.w / p.W, c.h / p.H, 1e-6); }
  // px da foto por unidade de u (ou v) no ponto: com perspectiva, 1 px da foto
  // perto da borda de cima não vale o mesmo que perto da de baixo.
  function pxPorUnid(med, vertical, u, v) {
    const m = mat(med), e = 1e-3, a = core.aplica(m, u, v), b = vertical ? core.aplica(m, u + e, v) : core.aplica(m, u, v + e);
    return Math.max(1e-6, Math.hypot(b[0] - a[0], b[1] - a[1]) / e);
  }
  const telaPorFotoB = (med) => ui.vb.z / pxPorMm(med);

  function linhasPadrao() {
    // Sem a sugestão do núcleo: o corte na borda do quadrilátero e a moldura
    // a 4,5% pra dentro (a mesma regra do sugereLinhas sem pico confiável).
    const L = (c) => ({ c, k: 0 });
    return { ext: { l: L(0), r: L(1), t: L(0), b: L(1) }, int: { l: L(0.045), r: L(0.955), t: L(0.045), b: L(0.955) } };
  }
  const todosLados = (v) => ({ l: v, r: v, t: v, b: v });
  const origemToda = (v) => ({ ext: todosLados(v), int: todosLados(v) });
  // σ null = linha posta à mão (o núcleo usa o sigmaManual DELA, em px da
  // foto); número = reta ajustada pelo ímã ou pela sugestão, em u ou v.
  const sigmaVazio = () => ({ ext: todosLados(null), int: todosLados(null) });
  // Linha posta à mão: não se localiza a aresta melhor que ~½ px de TELA, no
  // zoom de AGORA (piso de 0,3 px da foto). Vale só pra ela (§6.8): com um
  // número por lado, um toque com zoom 4× encolhia o ± das 7 postas na visão
  // geral, e vice-versa.
  function marcaManual(med, tipo, lado) {
    if (!med.sigmaManual) med.sigmaManual = sigmaVazio();
    const tpf = ui.vb ? telaPorFotoB(med) : 0; // sem vista (não acontece nas Bordas): o padrão de 0,5 px
    med.sigmaManual[tipo][lado] = tpf > 0 ? Math.max(0.5 / tpf, 0.3) : 0.5;
  }

  function quadInicial(med) {
    const a = 0.08, w = med.w, h = med.h;
    return [[w * a, h * a], [w * (1 - a), h * a], [w * (1 - a), h * (1 - a)], [w * a, h * (1 - a)]];
  }

  // O quadrilátero vale se é convexo, na ordem TL→TR→BR→BL, sem perspectiva
  // extrema (núcleo, §6.4) e com os cantos perto da foto. Um arrasto que o
  // violaria trava no último estado válido.
  function valido(med, c) {
    const fw = med.w * 0.25, fh = med.h * 0.25;
    for (const p of c) if (!(p[0] >= -fw && p[0] <= med.w + fw && p[1] >= -fh && p[1] <= med.h + fh)) return false;
    if (tem("quadValido")) { try { return !!core.quadValido(c, 0.15); } catch (e) { return false; } }
    return false;
  }
  function calculaPose(med) {
    if (!tem("poseGraus") || !med.cantos) return null;
    try {
      const g = core.poseGraus(med.cantos, med.w, med.h, med.exif ? med.exif.focal35 : null);
      return ehNum(g) ? g : null;
    } catch (e) { return null; }
  }

  // Girar 90° gira a VISTA da foto (e reetiqueta os cantos); a foto em si fica
  // como veio. rot = quantos quartos de volta no sentido horário.
  function rotP(med, x, y) {
    switch (med.rot) {
      case 1: return [med.h - y, x];
      case 2: return [med.w - x, med.h - y];
      case 3: return [y, med.w - x];
      default: return [x, y];
    }
  }
  function desrotP(med, xr, yr) {
    switch (med.rot) {
      case 1: return [yr, med.h - xr];
      case 2: return [med.w - xr, med.h - yr];
      case 3: return [med.w - yr, xr];
      default: return [xr, yr];
    }
  }
  function desrotD(rot, dx, dy) { // delta na tela → delta na foto
    switch (rot) { case 1: return [dy, -dx]; case 2: return [-dx, -dy]; case 3: return [-dy, dx]; default: return [dx, dy]; }
  }
  function rotD(rot, dx, dy) { // delta na foto → delta na tela
    switch (rot) { case 1: return [-dy, dx]; case 2: return [-dx, -dy]; case 3: return [dy, -dx]; default: return [dx, dy]; }
  }
  const telaA = (med, x, y) => { const [xr, yr] = rotP(med, x, y), v = ui.va; return [v.ox + v.s * xr, v.oy + v.s * yr]; };
  const fotoA = (med, X, Y) => { const v = ui.va; return desrotP(med, (X - v.ox) / v.s, (Y - v.oy) / v.s); };
  const telaB = (u, v) => { const p = preset(), b = ui.vb; return [b.bx + b.z * p.W * u, b.by + b.z * p.H * v]; };
  const cartaB = (X, Y) => { const p = preset(), b = ui.vb; return [(X - b.bx) / (b.z * p.W), (Y - b.by) / (b.z * p.H)]; };

  // Encontro de uma linha vertical (u = a + b·v) com uma horizontal (v = c + d·u).
  function cruza(V, Hz) {
    const a = V.c - V.k / 2, b = V.k, c = Hz.c - Hz.k / 2, d = Hz.k, den = 1 - b * d;
    const u = Math.abs(den) < 1e-9 ? a : (a + b * c) / den;
    return [u, c + d * u];
  }
  const quadLinhas = (g) => [cruza(g.l, g.t), cruza(g.r, g.t), cruza(g.r, g.b), cruza(g.l, g.b)];
  // Inclinação média das 4 linhas, em graus, no espaço MÉTRICO (u·W, v·H):
  // pro aviso "moldura girada X° em relação ao corte".
  function anguloLinhas(g) {
    const p = preset(), r = 180 / Math.PI;
    return (-Math.atan(g.l.k * p.W / p.H) - Math.atan(g.r.k * p.W / p.H) + Math.atan(g.t.k * p.H / p.W) + Math.atan(g.b.k * p.H / p.W)) * r / 4;
  }

  // ── Desfazer / refazer ───────────────────────────────────────────────────
  // Uma pilha por lado, 50 passos. Cada fim de arrasto é um passo; rajada de
  // teclado ou de botão em menos de 400 ms vira um passo só.
  function foto(med) {
    return clone({ cantos: med.cantos, cantoMao: med.cantoMao, rot: med.rot, linhas: med.linhas, sigma: med.sigma, origem: med.origem, giro: med.giro, sigmaCantoPx: med.sigmaCantoPx, sigmaManual: med.sigmaManual, confere: med.confere, fraca: med.fraca, pose: med.pose });
  }
  function antesDeMudar(med, rajada) {
    const agora = Date.now();
    if (!(rajada && agora - med.ultimoPasso < 400)) {
      med.undo.push(foto(med));
      if (med.undo.length > 50) med.undo.shift();
      med.redo.length = 0;
    }
    med.ultimoPasso = rajada ? agora : 0;
  }
  // Sem linhas, sem resultado (a regra do girar): desfazer até antes do
  // Endireitar, ou refazer um Girar, deixava na tela e no sessionStorage o
  // número de linhas que não existem mais.
  function restaura(med, f) { Object.assign(med, clone(f)); if (!med.linhas) med.res = null; med.chaveM = ""; med.ultimoPasso = 0; }
  function desfazer(volta) {
    const med = ativa();
    if (!med || !med.img) return;
    const de = volta ? med.redo : med.undo, para = volta ? med.undo : med.redo;
    if (!de.length) return;
    const rotAntes = med.rot;
    para.push(foto(med));
    restaura(med, de.pop());
    if (ui.passo === "angulo" && med.rot !== rotAntes) ajustaA(med);
    if (emBordas() && !med.linhas) { irPara("angulo"); salvaDepois(); return; }
    if (emBordas()) marca("b");
    depoisDeMudar(true);
  }

  // ── Persistência: só números ─────────────────────────────────────────────
  function salva() {
    try {
      const lados = {};
      for (const k of ["f", "v"]) {
        const m = sessao.lados[k];
        if (!m || !m.res) continue;
        lados[k] = { w: m.w, h: m.h, cantos: m.cantos, rot: m.rot, linhas: m.linhas, giro: m.giro, sigma: m.sigma, origem: m.origem, sigmaCantoPx: m.sigmaCantoPx, sigmaManual: m.sigmaManual, pose: m.pose, confere: m.confere, fraca: m.fraca, res: m.res, temFoto: !!m.blob };
      }
      sessionStorage.setItem(CHAVE, JSON.stringify({ v: 1, ladoAtivo: sessao.ladoAtivo, preset: sessao.preset, custom: sessao.custom, categoria: sessao.categoria, ima: sessao.ima, lados }));
    } catch (e) { /* aba privada / cota: segue só em memória */ }
  }
  const salvaDepois = debounce(salva, 400);
  function restauraSessao() {
    let s = null;
    try { s = JSON.parse(sessionStorage.getItem(CHAVE) || "null"); } catch (e) { s = null; }
    if (!s || s.v !== 1) return false;
    if (s.preset === "personalizado" || PRESETS[s.preset]) sessao.preset = s.preset;
    if (s.custom && s.custom.W > 0 && s.custom.H > 0) sessao.custom = { W: +s.custom.W, H: +s.custom.H };
    if (["tcg", "nao-esporte", "depende"].includes(s.categoria)) sessao.categoria = s.categoria;
    if (typeof s.ima === "boolean") sessao.ima = s.ima;
    if (s.ladoAtivo === "f" || s.ladoAtivo === "v") sessao.ladoAtivo = s.ladoAtivo;
    let algum = false;
    for (const k of ["f", "v"]) {
      const d = s.lados && s.lados[k];
      if (!d || !d.res || !d.res.lr || !d.res.tb || !ehNum(d.res.lr.usado) || !ehNum(d.res.tb.usado)) continue;
      const med = novaMedicao(null, "");
      Object.assign(med, {
        w: d.w, h: d.h, cantos: d.cantos, rot: d.rot || 0, linhas: d.linhas, giro: d.giro || 0, sigma: d.sigma, origem: d.origem,
        sigmaCantoPx: d.sigmaCantoPx || [3, 3, 3, 3], sigmaManual: d.sigmaManual && typeof d.sigmaManual === "object" ? d.sigmaManual : null,
        pose: ehNum(d.pose) ? d.pose : null, confere: Array.isArray(d.confere) ? d.confere : [], fraca: Array.isArray(d.fraca) ? d.fraca : [], res: d.res
      });
      sessao.lados[k] = med;
      algum = true;
    }
    return algum;
  }

  // ── Mensagens ────────────────────────────────────────────────────────────
  // As regiões vivas (#ctrMsg, #ctrStatus, o toast) ficam SEMPRE na árvore de
  // acessibilidade e "somem" só esvaziando (o :empty do CSS tira a caixa): uma
  // região que sai do hidden já com o texto não é lida pelo VoiceOver nem
  // pelo JAWS — o erro de HEIC e o "Abrindo a foto…" passavam calados.
  function msg(texto) {
    if (ui.aberto) { toast(texto); return; }
    el.msg.textContent = texto;
  }
  // O toast mora no <body> ou, no editor imersivo (role=dialog aria-modal),
  // DENTRO dele: fora do diálogo, o Tab (prendeFoco) nunca chegava no
  // "Desfazer" e o leitor de tela trata o resto da página como inerte.
  function casaDoToast() { return ui.aberto && ui.modo !== "pc" && el.editor ? el.editor : document.body; }
  function toast(texto, desfazerFn) {
    if (!el.toast) return;
    const casa = casaDoToast();
    if (el.toast.parentNode !== casa) casa.appendChild(el.toast);
    clearTimeout(ui.toastTimer);
    el.toast.innerHTML = `<span>${esc(texto)}</span>${desfazerFn ? `<button type="button" class="ctr-toast-b">${esc(t("cen.desfazer"))}</button>` : ""}`;
    if (desfazerFn) el.toast.querySelector("button").addEventListener("click", () => { el.toast.replaceChildren(); desfazerFn(); });
    ui.toastTimer = setTimeout(() => { el.toast.replaceChildren(); }, desfazerFn ? 6000 : 5000);
  }

  // ── Entrada: arquivo, câmera, colar, arrastar ────────────────────────────
  function ehHeic(blob, nome, med) {
    return (med && med.tipo === "heic") || /hei[cf]/i.test((blob && blob.type) || "") || /\.hei[cf]$/i.test(nome || "");
  }
  // O Chrome e o Firefox (desktop E Android) não abrem HEIC; o Safari do Mac
  // abre; o iOS converte sozinho no <input accept="image/*">.
  function msgHeic() {
    const ua = navigator.userAgent || "";
    if (/Android/i.test(ua)) return t("cen.erro.heicAndroid");
    if (/Macintosh/i.test(ua) && !("ontouchend" in document)) return t("cen.erro.heicMac");
    return t("cen.erro.heicOutro");
  }

  function viaImg(blob) {
    return new Promise((ok, falha) => {
      const url = URL.createObjectURL(blob);
      urls.add(url);
      const im = new Image();
      im.onload = () => ok({ fonte: im, url });
      im.onerror = () => { URL.revokeObjectURL(url); urls.delete(url); falha(new Error("img")); };
      im.src = url;
    });
  }

  // Decodifica UMA vez, já no tamanho final (§6.3). Um createImageBitmap sem
  // redução, só pra saber o tamanho, decodificaria a foto inteira — 98 MB a
  // 24 MP —, justamente o pico que o teto quer evitar. O cabeçalho (SOF/EXIF)
  // é lido dos primeiros 256 KB sem decodificar.
  async function decodifica(med) {
    let cab = null;
    if (tem("lerCabecalho")) {
      try { cab = core.lerCabecalho(new Uint8Array(await med.blob.slice(0, 262144).arrayBuffer())); } catch (e) { cab = null; }
    }
    med.tipo = cab ? cab.tipo : null;
    med.exif = cab ? { focal35: ehNum(cab.focal35) ? cab.focal35 : null, orientacao: cab.orientacao || 1 } : null;
    // Celular com pouca memória (só o Chrome expõe): teto de 8 MP.
    const maxPx = navigator.deviceMemory && navigator.deviceMemory <= 2 ? 8e6 : 12e6;
    const escala = (w, h) => Math.min(1, Math.sqrt(maxPx / (w * h)), MAX_LADO / Math.max(w, h));
    let fonte = null, url = null;
    if (cab && cab.w > 0 && cab.h > 0 && typeof createImageBitmap === "function") {
      const s = escala(cab.w, cab.h), tw = Math.max(1, Math.round(cab.w * s)), th = Math.max(1, Math.round(cab.h * s));
      const opts = { imageOrientation: "from-image" };
      if (s < 1) Object.assign(opts, { resizeWidth: tw, resizeHeight: th, resizeQuality: "high" });
      try {
        fonte = await createImageBitmap(med.blob, opts);
        // A ordem orientação × redução não é a mesma em todo navegador: se o
        // tamanho voltou trocado, a redução foi antes de girar e a imagem saiu
        // esticada. Cai pro <img>, que decodifica e reduz no canvas.
        if (s < 1 && (fonte.width !== tw || fonte.height !== th)) { fonte.close(); fonte = null; }
      } catch (e) { fonte = null; }
    }
    if (!fonte) { const r = await viaImg(med.blob); fonte = r.fonte; url = r.url; }
    const fw = fonte.naturalWidth || fonte.width, fh = fonte.naturalHeight || fonte.height;
    if (!(fw > 0 && fh > 0)) throw new Error("vazia");
    const s2 = escala(fw, fh), tw = Math.max(1, Math.round(fw * s2)), th = Math.max(1, Math.round(fh * s2));
    const cv = document.createElement("canvas");
    cv.width = tw; cv.height = th;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.imageSmoothingQuality = "high";
    cx.drawImage(fonte, 0, 0, tw, th);
    // Fecha o bitmap ANTES do getImageData: é o que segura o pico em ~144 MB.
    if (fonte.close) fonte.close();
    if (url) { URL.revokeObjectURL(url); urls.delete(url); }
    const dados = cx.getImageData(0, 0, tw, th).data;
    cv.width = cv.height = 0;
    // A pirâmide devolve a vez ao navegador entre os níveis: com med.img já
    // posto e med.mips ainda null, um quadro (ResizeObserver, renderTimer, um
    // toque no palco) passava no guarda "!med.img" e quebrava em
    // med.mips.length. Os dois entram juntos, no fim.
    const img = { data: dados, w: tw, h: th };
    const mips = await piramide(img);
    med.w = tw; med.h = th;
    med.img = img; med.mips = mips; med.bmps = [];
  }
  // Mips 1/2, 1/4… pra tela, por média 2×2. A coordenada contínua só escala
  // (o centro do pixel j do mip cai em 2j+1 da foto), então a homografia do
  // mip é a da foto vezes 2^-n.
  async function piramide(img) {
    const niveis = [img];
    let atual = img;
    while (Math.max(atual.w, atual.h) > 640 && niveis.length < 7) {
      await new Promise((r) => setTimeout(r, 0)); // devolve a vez pro navegador entre os níveis
      atual = metade(atual);
      niveis.push(atual);
    }
    return niveis;
  }
  function metade(img) {
    const w = img.w >> 1, h = img.h >> 1, s = img.data, o = new Uint8ClampedArray(w * h * 4), lin = img.w * 4;
    for (let y = 0; y < h; y++) {
      let i = 2 * y * lin, j = y * w * 4;
      for (let x = 0; x < w; x++, i += 8, j += 4) {
        o[j] = (s[i] + s[i + 4] + s[i + lin] + s[i + lin + 4] + 2) >> 2;
        o[j + 1] = (s[i + 1] + s[i + 5] + s[i + lin + 1] + s[i + lin + 5] + 2) >> 2;
        o[j + 2] = (s[i + 2] + s[i + 6] + s[i + lin + 2] + s[i + lin + 6] + 2) >> 2;
        o[j + 3] = 255;
      }
    }
    return { data: o, w, h };
  }
  function liberaPixels(med) {
    if (!med) return;
    (med.bmps || []).forEach((b) => { if (b) { if (b.close) b.close(); else { b.width = 0; b.height = 0; } } });
    med.bmps = [];
    med.img = null;
    med.mips = null;
  }
  // O lado inativo guarda só o Blob e os números; voltar a ele redecodifica.
  function garantePixels(med) {
    if (med.img) return Promise.resolve();
    if (!med.blob) return Promise.reject(new Error("sem foto"));
    if (!med.dec) {
      carregando(true);
      // §6.3: só o lado ATIVO tem pixels. Trocar de lado no meio da
      // decodificação deixava os pixels e os mips do outro em memória (o pico
      // dobrava num celular de 2 GB, justo o que o teto de 8 MP evita).
      med.dec = decodifica(med)
        .then(() => { if (ativa() !== med) liberaPixels(med); })
        .finally(() => { med.dec = null; carregando(false); });
    }
    return med.dec;
  }
  // Contador, não booleano: com duas decodificações (Frente e logo Verso), a
  // que acabava primeiro apagava o "Abrindo a foto…" e reabria a entrada.
  function carregando(on) {
    ui.nCarregando = Math.max(0, ui.nCarregando + (on ? 1 : -1));
    on = ui.carregando = ui.nCarregando > 0;
    if (el.status) el.status.textContent = on ? t("cen.entrada.carregando") : "";
    if (el.palcoMsg) { el.palcoMsg.hidden = !on; el.palcoMsg.textContent = on ? t("cen.entrada.carregando") : ""; }
    vigiaSincronia();
    ocupado();
  }
  // Enquanto houver foto em memória, o <html> leva data-ocupado: o shared.js
  // não recarrega sozinho (versão nova do SW, pull da nuvem) e a foto, que só
  // existe aqui, não some no meio do ajuste.
  function ocupado() {
    const tem1 = ui.carregando || !!ui.pendente || ["f", "v"].some((k) => sessao.lados[k] && sessao.lados[k].blob);
    document.documentElement.toggleAttribute("data-ocupado", tem1);
  }

  async function recebeArquivo(blob, nome) {
    if (!blob || ui.carregando) return;
    // Pull da nuvem em curso (o fim dele pode recarregar a página): a foto
    // ESPERA em memória, protegida pelo data-ocupado, e entra quando a
    // pílula some — antes ela era jogada fora com a promessa de "entra em
    // instantes". A pílula é olhada AGORA (a vigia do boot para em 15 s).
    if (vigiaSincronia()) {
      ui.pendente = { blob, nome };
      ocupado();
      msg(t("cen.entrada.sincronizando"));
      const espera = () => { if (vigiaSincronia()) setTimeout(espera, 500); };
      espera();
      return;
    }
    if (el.msg) msg("");
    const n = nome || blob.name || "";
    if (!/^image\//i.test(blob.type || "") && !/\.(jpe?g|png|webp|gif|bmp|avif|hei[cf])$/i.test(n)) { msg(t("cen.erro.abrir")); return; }
    if (!tem("squareToQuad", "inverte", "aplica", "medir")) { msg(t("cen.erro.semCore")); return; }
    const lado = sessao.ladoAtivo, antes = sessao.lados[lado];
    const med = novaMedicao(blob, n);
    carregando(true);
    try { await decodifica(med); } catch (e) {
      carregando(false);
      msg(ehHeic(blob, n, med) ? msgHeic() : t("cen.erro.abrir"));
      return;
    }
    carregando(false);
    try { sessionStorage.removeItem(CAMERA); } catch (e) { /* idem */ }
    // O outro lado volta a ser só Blob + números (§6.3: só o ativo tem pixels).
    const outro = sessao.lados[outroLado(lado)];
    if (outro) liberaPixels(outro);
    med.cantos = quadInicial(med);
    med.cantoMao = [0, 0, 0, 0];
    med.pose = calculaPose(med);
    sessao.lados[lado] = med;
    // Trocar a foto no meio: a anterior fica 6 s pro Desfazer.
    if (antes && antes.blob) guardaAnterior(lado, antes);
    else liberaPixels(antes);
    ui.va = null; ui.vb = null; ui.guiado = 0; ui.sel = { tipo: "int", lado: "l" };
    ocupado();
    salva();
    irPara("angulo");
  }
  function guardaAnterior(lado, antes) {
    if (ui.anterior) liberaPixels(ui.anterior.med);
    const reg = { lado, med: antes };
    ui.anterior = reg;
    toast(t("cen.trocada"), () => {
      if (ui.anterior !== reg) return;
      const atual = sessao.lados[lado];
      sessao.lados[lado] = antes;
      liberaPixels(atual);
      ui.anterior = null;
      sessao.ladoAtivo = lado;
      ui.va = null; ui.vb = null;
      salva();
      irPara(antes.linhas ? "bordas" : "angulo");
    });
    setTimeout(() => { if (ui.anterior === reg) { liberaPixels(reg.med); ui.anterior = null; } }, 6200);
  }

  async function colarDoBotao() {
    try {
      const itens = await navigator.clipboard.read();
      for (const it of itens) {
        const tipo = it.types.find((x) => /^image\//.test(x));
        if (tipo) { const b = await it.getType(tipo); recebeArquivo(b, "colada." + tipo.split("/")[1]); return; }
      }
      msg(t("cen.erro.semImagem"));
    } catch (e) { msg(t(toque() ? "cen.erro.colarToque" : "cen.erro.colar")); } // no celular não existe Ctrl+V
  }

  // Enquanto o pull da nuvem do boot roda (#pageLoadingPill), a entrada fica
  // parada: o fim dele pode recarregar a página e jogar a foto fora.
  function vigiaSincronia() {
    const pill = document.getElementById("pageLoadingPill");
    const sinc = !!(pill && !pill.hidden);
    ui.sincronizando = sinc;
    if (!sinc && ui.pendente && !ui.carregando) {
      const pend = ui.pendente;
      ui.pendente = null;
      setTimeout(() => recebeArquivo(pend.blob, pend.nome));
    }
    (el.entradaBtns || []).forEach((b) => { b.disabled = sinc || ui.carregando; });
    if (el.sinc) el.sinc.hidden = !sinc;
    return sinc;
  }

  // ── Editor: a casca ──────────────────────────────────────────────────────
  function montaEditor() {
    const canto = (i) => `<button type="button" class="ctr-alca ctr-canto" data-ctr-alca="canto" data-i="${i}" aria-label="${escA(t(`cen.canto.${CANTOS[i]}`))}" aria-describedby="ctrTeclas"></button>`;
    const meio = (i) => `<button type="button" class="ctr-alca ctr-meio" data-ctr-alca="meio" data-i="${i}" aria-label="${escA(t(`cen.aresta.${ARESTAS[i]}`))}" aria-describedby="ctrTeclas"></button>`;
    const linha = (tipo, lado) => `<div class="ctr-alca ctr-lin ctr-lin-${tipo}" data-ctr-alca="linha" data-tipo="${tipo}" data-lado="${lado}" role="slider" tabindex="0" aria-orientation="${VERT[lado] ? "horizontal" : "vertical"}" aria-label="${escA(t(`cen.aria.${tipo}.${lado}`))}" aria-describedby="ctrTeclas"></div>`;
    const linhas = GUIA.map((l) => linha("ext", l) + linha("int", l)).join("");
    const opcPreset = ["63x88", "59x86", "personalizado"].map((k) => `<option value="${k}">${esc(t(`cen.tam.${k === "personalizado" ? "personalizado" : "p" + k}`))}</option>`).join("");
    const passo = (p, n) => `<li><button type="button" class="ctr-passo" data-ctr-acao="passo" data-p="${p}"><span class="ctr-passo-n">${n}</span><span class="ctr-passo-ok">${IC.check}</span><span>${esc(t(`cen.passo.${p}`))}</span></button></li>`;
    const item = (acao, chave, quando) => `<button type="button" role="menuitem" class="ctr-menu-i" data-ctr-acao="${acao}" data-menu="${quando}">${esc(t(chave))}</button>`;
    const tecla = (k, chave) => `<div class="ctr-pop-l"><dt>${k}</dt><dd>${esc(t(chave))}</dd></div>`;

    const ed = document.createElement("div");
    ed.className = "ctr-editor";
    ed.id = "ctrEditor";
    ed.hidden = true;
    ed.innerHTML = `
      <div class="ctr-barra">
        <button type="button" class="ctr-ib ctr-so-cel" data-ctr-acao="voltar" aria-label="${escA(t("cen.ctl.voltar"))}">${IC.volta}</button>
        <h2 class="ctr-titulo" id="ctrTitulo" tabindex="-1"></h2>
        <div class="ctr-seg ctr-lados" role="group" aria-label="${escA(t("cen.aria.lado"))}">
          <button type="button" data-ctr-acao="lado" data-lado="f" aria-pressed="true">${esc(t("cen.lado.f"))}</button>
          <button type="button" data-ctr-acao="lado" data-lado="v" aria-pressed="false">${esc(t("cen.lado.v"))}</button>
        </div>
        <ol class="ctr-passos ctr-so-pc" aria-label="${escA(t("cen.aria.passos"))}">${passo("angulo", 1)}${passo("bordas", 2)}${passo("resultado", 3)}</ol>
        <span class="ctr-barra-esp"></span>
        <button type="button" class="ctr-ib" data-ctr-acao="desfazer" aria-label="${escA(t("cen.ctl.desfazer"))}" title="${escA(t("cen.ctl.desfazer"))}">${IC.desfaz}</button>
        <button type="button" class="ctr-ib ctr-so-pc" data-ctr-acao="refazer" aria-label="${escA(t("cen.ctl.refazer"))}" title="${escA(t("cen.ctl.refazer"))}">${IC.refaz}</button>
        <button type="button" class="ctr-ib ctr-so-pc ctr-so-tecla" data-ctr-acao="atalhos" aria-expanded="false" aria-label="${escA(t("cen.atalhos.titulo"))}" title="${escA(t("cen.atalhos.titulo"))}">${IC.teclado}</button>
        <button type="button" class="lst-mini ctr-b ctr-so-pc" data-ctr-acao="nova">${IC.imagem}<span>${esc(t("cen.ctl.novaFoto"))}</span></button>
        <button type="button" class="ctr-ib" data-ctr-acao="menu" aria-haspopup="true" aria-expanded="false" aria-label="${escA(t("cen.ctl.menu"))}" title="${escA(t("cen.ctl.menu"))}">${IC.mais3}</button>
        <div class="ctr-menu" role="menu" aria-label="${escA(t("cen.ctl.menu"))}" hidden>
          ${item("jareta", "cen.ctl.jaReta", "angulo")}
          ${item("resugere", "cen.ctl.resugere", "bordas")}
          ${item("cantos", "cen.ctl.editarCantos", "bordas-cel")}
          ${item("refazer", "cen.ctl.refazer", "cel")}
          ${item("ima", "cen.ctl.imaAlterna", "cel")}
          ${item("nova", "cen.ctl.novaFoto", "cel")}
          ${item("atalhos", "cen.atalhos.titulo", "pc")}
          ${item("ajuda", "cen.ctl.ajuda", "sempre")}
          ${item("fechar", "cen.ctl.fechar", "cel")}
        </div>
        <div class="ctr-pop" role="dialog" aria-labelledby="ctrPopT" hidden>
          <h3 id="ctrPopT">${esc(t("cen.atalhos.titulo"))}</h3>
          <dl>
            ${tecla("Tab", "cen.atalhos.tab")}
            ${tecla("← → ↑ ↓", "cen.atalhos.setas")}
            ${tecla("Shift / Alt", "cen.atalhos.passo")}
            ${tecla("[ ]", "cen.atalhos.lados")}
            ${tecla("C / M", "cen.atalhos.cm")}
            ${tecla("Ctrl/Cmd+Z · Ctrl/Cmd+Y", "cen.atalhos.desfazer")}
            ${tecla("Enter", "cen.atalhos.enter")}
            ${tecla("Esc", "cen.atalhos.esc")}
            ${tecla("Ctrl/Cmd+V", "cen.atalhos.colar")}
            ${tecla(esc(t("cen.tecla.espaco")), "cen.atalhos.espaco")}
            ${tecla("Alt", "cen.atalhos.alt")}
            ${tecla("?", "cen.atalhos.ajuda")}
          </dl>
          <p>${esc(t("cen.atalhos.zoom"))}</p>
        </div>
      </div>
      <div class="ctr-corpo">
        <div class="ctr-palco" role="group" aria-label="${escA(t("cen.aria.palco"))}">
          <canvas class="ctr-tela ctr-tela-a" aria-hidden="true"></canvas>
          <canvas class="ctr-tela ctr-tela-b" aria-hidden="true"></canvas>
          <svg class="ctr-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"></svg>
          <div class="ctr-alcas">${[0, 1, 2, 3].map(canto).join("")}${[0, 1, 2, 3].map(meio).join("")}${linhas}</div>
          <div class="ctr-rotulo" aria-hidden="true" hidden></div>
          <canvas class="ctr-lupa ctr-lupa-cel" width="144" height="144" aria-hidden="true" hidden></canvas>
          <p class="ctr-palco-msg" hidden></p>
        </div>
        <p class="sr-only" id="ctrTeclas">${esc(t("cen.teclas"))}</p>
        <p class="sr-only ctr-vivo" aria-live="polite"></p>
        <div class="ctr-ctl">
          <p class="ctr-dica" data-bloco="dica"></p>
          <p class="ctr-aviso-b" hidden></p>
          <div class="ctr-grupo ctr-ang-ctl" data-bloco="angCtl">
            <div class="ctr-fila">
              <button type="button" class="lst-mini ctr-b" data-ctr-acao="girar">${IC.gira}<span>${esc(t("cen.ctl.girar"))}</span></button>
              <button type="button" class="lst-mini ctr-b" data-ctr-acao="jareta" data-bloco="jaReta">${IC.reta}<span>${esc(t("cen.ctl.jaReta"))}</span></button>
            </div>
            <label class="ctr-campo"><span>${esc(t("cen.ctl.tamanho"))}</span><select class="ctr-sel" data-ctr-campo="preset" aria-describedby="ctrTamJogos">${opcPreset}</select></label>
            <p class="ctr-tam-jogos" id="ctrTamJogos"></p>
            <div class="ctr-custom" hidden>
              <label class="ctr-campo"><span>${esc(t("cen.tam.largura"))}</span><input type="number" inputmode="decimal" min="20" max="200" step="0.5" data-ctr-campo="W"></label>
              <label class="ctr-campo"><span>${esc(t("cen.tam.altura"))}</span><input type="number" inputmode="decimal" min="20" max="200" step="0.5" data-ctr-campo="H"></label>
            </div>
            <p class="ctr-nota-p">${esc(t("cen.tam.nota"))}</p>
            <p class="ctr-ang"></p>
          </div>
          <button type="button" class="ctr-toggle" data-bloco="ima" data-ctr-acao="ima" aria-pressed="true">${IC.ima}<span class="ctr-toggle-t">${esc(t("cen.ctl.ima"))}</span><span class="ctr-toggle-v"></span></button>
          <button type="button" class="cta ctr-largo" data-bloco="endireitar" data-ctr-acao="endireitar"><span>${esc(t("cen.ctl.endireitar"))}</span>${IC.seta}</button>
          <div class="ctr-prog" data-bloco="guiaTopo" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
          <div class="ctr-grupo" data-bloco="linhaCtl">
            <div class="ctr-seg ctr-seg-4" role="group" aria-label="${escA(t("cen.aria.ladoLinha"))}" data-bloco="chipsLado">
              ${GUIA.map((l) => `<button type="button" data-ctr-acao="sel-lado" data-lado="${l}" aria-pressed="false">${esc(t(`cen.ladoCurto.${l}`))}</button>`).join("")}
            </div>
            <div class="ctr-seg" role="group" aria-label="${escA(t("cen.aria.tipoLinha"))}">
              <button type="button" data-ctr-acao="sel-tipo" data-tipo="ext" aria-pressed="false">${esc(t("cen.ctl.corte"))}</button>
              <button type="button" data-ctr-acao="sel-tipo" data-tipo="int" aria-pressed="true">${esc(t("cen.ctl.moldura"))}</button>
            </div>
            <p class="ctr-valor"></p>
            <div class="ctr-ajuste">
              <button type="button" class="ctr-ib" data-ctr-passo="-1" aria-label="${escA(t("cen.ctl.menos"))}">${IC.menos}</button>
              <div class="ctr-regua" aria-hidden="true"><span class="ctr-regua-m"></span></div>
              <button type="button" class="ctr-ib" data-ctr-passo="1" aria-label="${escA(t("cen.ctl.mais"))}">${IC.mais}</button>
            </div>
            <p class="ctr-nota-p">${esc(t("cen.regua"))}</p>
          </div>
          <div class="ctr-fila ctr-guia-nav" data-bloco="guiaNav">
            <button type="button" class="secondary fer-btn" data-ctr-acao="guia-ant">${IC.volta}<span>${esc(t("cen.ctl.anterior"))}</span></button>
            <button type="button" class="primary fer-btn" data-ctr-acao="guia-prox"><span class="ctr-guia-prox-t">${esc(t("cen.ctl.proximo"))}</span>${IC.seta}</button>
          </div>
          <button type="button" class="secondary fer-btn ctr-largo" data-bloco="conferir" data-ctr-acao="conferir">${IC.lupa}<span>${esc(t("cen.ctl.conferir"))}</span></button>
          <div class="ctr-grupo" data-bloco="giro">
            <div class="ctr-giro-cab"><span id="ctrGiroL">${esc(t("cen.ctl.giro"))}</span><output class="ctr-giro-v" for="ctrGiro"></output><button type="button" class="lst-mini" data-ctr-acao="giro0">${esc(t("cen.ctl.giroZero"))}</button></div>
            <div class="ctr-ajuste">
              <button type="button" class="ctr-ib" data-ctr-giro="-1" aria-label="${escA(t("cen.ctl.giroMenos"))}">${IC.menos}</button>
              <input type="range" class="ctr-range" id="ctrGiro" min="-5" max="5" step="0.05" value="0" aria-labelledby="ctrGiroL" data-ctr-campo="giro">
              <button type="button" class="ctr-ib" data-ctr-giro="1" aria-label="${escA(t("cen.ctl.giroMais"))}">${IC.mais}</button>
            </div>
          </div>
          <div class="ctr-fila ctr-zoom" data-bloco="zoom">
            <button type="button" class="ctr-ib" data-ctr-acao="zoom-" aria-label="${escA(t("cen.ctl.afastar"))}" title="${escA(t("cen.ctl.afastar"))}">${IC.menos}</button>
            <span class="ctr-zoom-v"></span>
            <button type="button" class="ctr-ib" data-ctr-acao="zoom+" aria-label="${escA(t("cen.ctl.aproximar"))}" title="${escA(t("cen.ctl.aproximar"))}">${IC.mais}</button>
            <button type="button" class="lst-mini ctr-b" data-ctr-acao="ajustar">${IC.ajusta}<span>${esc(t("cen.ctl.ajustar"))}</span></button>
          </div>
          <button type="button" class="lst-mini ctr-b" data-bloco="editarCantos" data-ctr-acao="cantos">${IC.cantos}<span>${esc(t("cen.ctl.editarCantos"))}</span></button>
        </div>
        <div class="ctr-col"><div class="ctr-col-in">
          <div class="ctr-lupa-pc" data-bloco="lupaPc"><canvas class="ctr-lupa" width="200" height="200" aria-hidden="true"></canvas><p class="ctr-lupa-leg"></p></div>
          <div class="ctr-res-col" data-bloco="res"></div>
        </div></div>
        <div class="ctr-folha" data-altura="0" hidden>
          <button type="button" class="ctr-folha-cab" data-ctr-acao="folha" aria-expanded="false"><span class="sr-only ctr-folha-acao"></span><span class="ctr-mini"></span>${IC.cima}</button>
          <div class="ctr-folha-corpo"></div>
        </div>
      </div>`;
    app.appendChild(ed);
    const q = (s) => ed.querySelector(s);
    Object.assign(el, {
      editor: ed, barra: q(".ctr-barra"), titulo: q(".ctr-titulo"), palco: q(".ctr-palco"),
      telaA: q(".ctr-tela-a"), telaB: q(".ctr-tela-b"), svg: q(".ctr-svg"), rotulo: q(".ctr-rotulo"),
      lupaCel: q(".ctr-lupa-cel"), lupaPc: q(".ctr-lupa-pc canvas"), lupaLeg: q(".ctr-lupa-leg"), palcoMsg: q(".ctr-palco-msg"),
      cantos: [...ed.querySelectorAll(".ctr-canto")], meios: [...ed.querySelectorAll(".ctr-meio")], linhas: [...ed.querySelectorAll(".ctr-lin")],
      ctl: q(".ctr-ctl"), col: q(".ctr-col"), resCol: q(".ctr-res-col"), folha: q(".ctr-folha"), folhaCab: q(".ctr-folha-cab"), folhaCorpo: q(".ctr-folha-corpo"), mini: q(".ctr-mini"),
      menuBtn: q('[data-ctr-acao="menu"]'), menu: q(".ctr-menu"), pop: q(".ctr-pop"), atalhosBtn: q('[data-ctr-acao="atalhos"]'),
      ladoBtns: [...ed.querySelectorAll('[data-ctr-acao="lado"]')], passos: [...ed.querySelectorAll(".ctr-passo")],
      desfazer: q('[data-ctr-acao="desfazer"]'), refazer: q('[data-ctr-acao="refazer"]'),
      dica: q(".ctr-dica"), ang: q(".ctr-ang"), presetSel: q('[data-ctr-campo="preset"]'), custom: q(".ctr-custom"),
      inW: q('[data-ctr-campo="W"]'), inH: q('[data-ctr-campo="H"]'), imaBtn: q('[data-bloco="ima"]'),
      valor: q(".ctr-valor"), regua: q(".ctr-regua"), reguaM: q(".ctr-regua-m"), prog: [...ed.querySelectorAll(".ctr-prog span")],
      chipsLado: [...ed.querySelectorAll('[data-ctr-acao="sel-lado"]')], chipsTipo: [...ed.querySelectorAll('[data-ctr-acao="sel-tipo"]')],
      giroIn: q(".ctr-range"), giroV: q(".ctr-giro-v"), zoomV: q(".ctr-zoom-v"), guiaProxT: q(".ctr-guia-prox-t"),
      vivo: q(".ctr-vivo"), avisoB: q(".ctr-aviso-b"), tamJogos: q(".ctr-tam-jogos"), folhaAcao: q(".ctr-folha-acao")
    });
    el.res = document.createElement("div");
    el.res.className = "ctr-res";
    el.resCol.appendChild(el.res);
    // O <details> de "Mais graduadoras" é redesenhado a cada ajuste: guarda se
    // a pessoa abriu, senão ele fecharia sozinho no meio da leitura.
    el.res.addEventListener("toggle", (ev) => { if (ev.target.matches && ev.target.matches("details.ctr-mais")) ui.maisAberto = ev.target.open; }, true);

    // Palco: um caminho só pro dedo e pro mouse (pointer events).
    el.palco.addEventListener("pointerdown", onDown);
    el.palco.addEventListener("pointermove", onMove);
    el.palco.addEventListener("pointerup", onUp);
    el.palco.addEventListener("pointercancel", onUp);
    el.palco.addEventListener("lostpointercapture", (ev) => { if (ui.ponteiros.has(ev.pointerId)) onUp(ev); });
    el.palco.addEventListener("wheel", (ev) => {
      const med = ativa();
      if (!med || !med.img || !ui.va && !ui.vb) return;
      ev.preventDefault();
      const [x, y] = local(ev), k = ev.deltaMode === 1 ? 0.05 : ev.deltaMode === 2 ? 1 : 0.0018;
      zoomEm(Math.exp(-ev.deltaY * k), x, y);
    }, { passive: false });
    el.palco.addEventListener("dblclick", (ev) => {
      // Só o mouse: no toque o toque duplo já alternou no toqueVazio
      // (pointerup), e o Chrome do Android ainda manda um dblclick depois (do
      // click detail=2), que desfazia o zoom — o "4× e volta" não fazia nada.
      // O dblclick chega como MouseEvent sem pointerType: vale o do último
      // pointerdown no palco.
      if (ui.tipoUltimo !== "mouse") return;
      if (ev.target.closest("[data-ctr-alca]")) return;
      const [x, y] = local(ev);
      alternaZoom(x, y);
    });
    el.palco.addEventListener("contextmenu", (ev) => { if (ev.pointerType !== "mouse") ev.preventDefault(); });
    el.palco.addEventListener("pointerenter", () => { ui.sobrePalco = true; });
    el.palco.addEventListener("pointerleave", () => { ui.sobrePalco = false; });
    ligaRegua();
    ligaRepeticao();
    if (window.ResizeObserver) new ResizeObserver(() => medePalco()).observe(el.palco);
  }

  // ── Layout: PC, celular em pé, celular deitado ───────────────────────────
  // O deitado é escolhido por ponteiro grosso + paisagem, não pela largura,
  // pra um celular a 844×390 não cair no layout de PC (§5.4, M5).
  function calculaModo() {
    const grosso = toque(), deitado = window.matchMedia && matchMedia("(orientation: landscape)").matches;
    if (grosso && deitado) return window.innerHeight <= 600 ? "deitado" : "pc";
    if (grosso) return window.innerWidth <= 900 ? "retrato" : "pc";
    return window.innerWidth <= 700 ? "retrato" : "pc";
  }
  function arrumaLayout() {
    if (!el.editor) return;
    const modo = calculaModo(), mudou = modo !== ui.modo;
    ui.modo = modo;
    el.editor.classList.toggle("ctr-imersivo", modo !== "pc");
    el.editor.classList.toggle("ctr-deitado", modo === "deitado");
    imersivo(ui.aberto && modo !== "pc");
    // O resultado mora na coluna ao lado da lupa (PC), embaixo dos controles
    // (deitado: a coluna da direita rola inteira) ou na folha (em pé).
    const casa = modo === "retrato" ? el.folhaCorpo : modo === "deitado" ? el.ctl : el.resCol;
    if (el.res.parentNode !== casa) casa.appendChild(el.res);
    visibilidade();
    medePalco(mudou);
  }
  // Celular: editor imersivo POR CIMA da tabbar, como diálogo (foco preso, o
  // Esc pela pilha de passos) e com a barra do sistema escura.
  function imersivo(on) {
    const ed = el.editor;
    if (on) {
      ed.setAttribute("role", "dialog");
      ed.setAttribute("aria-modal", "true");
      ed.setAttribute("aria-labelledby", "ctrTitulo");
      document.body.classList.add("preview-open");
      // O toast entra no diálogo (ver casaDoToast): o "Foto trocada [Desfazer]"
      // da Nova foto nasce ANTES de o editor abrir.
      if (el.toast && el.toast.parentNode !== ed) ed.appendChild(el.toast);
    } else {
      ed.removeAttribute("role");
      ed.removeAttribute("aria-modal");
      ed.removeAttribute("aria-labelledby");
      document.body.classList.remove("preview-open");
      if (el.toast && el.toast.parentNode !== document.body) document.body.appendChild(el.toast);
    }
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      if (on) { if (m.dataset.ctrOriginal == null) m.dataset.ctrOriginal = m.getAttribute("content") || ""; m.setAttribute("content", PALCO_BG); }
      else if (m.dataset.ctrOriginal != null) { m.setAttribute("content", m.dataset.ctrOriginal); delete m.dataset.ctrOriginal; }
    });
  }
  function medePalco(forcaAjuste) {
    if (!el.palco || !ui.aberto) return;
    const w = el.palco.clientWidth, h = el.palco.clientHeight;
    if (!w || !h) return;
    const mudou = w !== ui.tam.w || h !== ui.tam.h;
    if (!mudou && !forcaAjuste) return;
    const med = ativa();
    const naA = ui.va && Math.abs(ui.va.s / ui.va.fit - 1) < 0.02, naB = ui.vb && Math.abs(ui.vb.z / ui.vb.fit - 1) < 0.02;
    ui.tam = { w, h };
    if (med && med.img) {
      if (!ui.va || naA || forcaAjuste) ajustaA(med); else ui.va.fit = fitA(med);
      if (med.linhas) {
        if (ui.passo === "guiado") focaGuiado();
        else if (!ui.vb || naB || forcaAjuste) ajustaB(); else ui.vb.fit = fitB();
      }
    }
    marca("palco", "b", "lupa");
  }
  function visibilidade() {
    const p = ui.passo, m = ui.modo, A = p === "angulo", G = p === "guiado", B = p === "bordas" || p === "resultado";
    const ver = {
      lupaPc: m === "pc" && (A || B || G), dica: A || (B && m === "pc"),
      angCtl: A, jaReta: A && m === "pc", ima: (A || B) && m !== "retrato", endireitar: A,
      guiaTopo: G, linhaCtl: (B && m !== "retrato") || G, chipsLado: B && m !== "retrato", guiaNav: G,
      conferir: B && m !== "pc", giro: B, zoom: (A || B) && m === "pc", editarCantos: B && m === "pc", res: true
    };
    el.editor.querySelectorAll("[data-bloco]").forEach((b) => { b.hidden = !ver[b.dataset.bloco]; });
    el.editor.dataset.passo = p;
    el.editor.classList.toggle("is-guiado", G);
    el.cantos.concat(el.meios).forEach((b) => { b.hidden = !A; });
    el.linhas.forEach((b) => { b.hidden = A; });
    el.telaA.hidden = !A;
    el.telaB.hidden = A;
    el.folha.hidden = !(m === "retrato" && !A);
    if (m !== "retrato") ui.folha = 0;
    pintaFolha();
    el.lupaCel.hidden = true;
    if (!A) el.rotulo.hidden = false;
    else el.rotulo.hidden = true;
  }

  // ── Vistas e zoom ────────────────────────────────────────────────────────
  function fitA(med) {
    const W = ui.tam.w, H = ui.tam.h, rw = med.rot % 2 ? med.h : med.w, rh = med.rot % 2 ? med.w : med.h, pad = ui.modo === "pc" ? 28 : 18;
    return Math.max(1e-4, Math.min((W - 2 * pad) / rw, (H - 2 * pad) / rh));
  }
  function ajustaA(med) {
    const s = fitA(med), rw = med.rot % 2 ? med.h : med.w, rh = med.rot % 2 ? med.w : med.h;
    ui.va = { s, ox: (ui.tam.w - rw * s) / 2, oy: (ui.tam.h - rh * s) / 2, fit: s };
  }
  // A carta endireitada com margem em volta (o fundo escurecido mostra onde o
  // corte termina e deixa espaço pras alças de fora).
  function fitB() { const p = preset(); return Math.max(1e-4, Math.min(ui.tam.w / (p.W * 1.12), ui.tam.h / (p.H * 1.12))); }
  function ajustaB() {
    const p = preset(), z = fitB();
    ui.vb = { z, bx: (ui.tam.w - p.W * z) / 2, by: (ui.tam.h - p.H * z) / 2, fit: z };
  }
  // Zoom máximo: 1 px da foto (endireitada) = 4 px de tela.
  function zoomMax(med) { return ui.passo === "angulo" ? Math.max(ui.va.fit, 4) : Math.max(ui.vb.fit, 4 * pxPorMm(med)); }
  function zoomEm(f, X, Y) {
    const med = ativa();
    if (!med || !med.img) return;
    if (ui.passo === "angulo") {
      const v = ui.va, s = limita(v.s * f, v.fit * 0.5, zoomMax(med)), k = s / v.s;
      v.ox = X - (X - v.ox) * k; v.oy = Y - (Y - v.oy) * k; v.s = s;
    } else if (ui.vb) {
      const v = ui.vb, z = limita(v.z * f, v.fit * 0.5, zoomMax(med)), k = z / v.z;
      v.bx = X - (X - v.bx) * k; v.by = Y - (Y - v.by) * k; v.z = z;
    }
    mudouVista();
  }
  function arrasta(dx, dy) {
    if (ui.passo === "angulo") { ui.va.ox += dx; ui.va.oy += dy; } else { ui.vb.bx += dx; ui.vb.by += dy; }
    mudouVista();
  }
  function alternaZoom(X, Y) {
    const med = ativa();
    if (!med || !med.img) return;
    const A = ui.passo === "angulo", v = A ? ui.va : ui.vb;
    if (!v) return;
    if ((A ? v.s : v.z) > v.fit * 1.1) { if (A) ajustaA(med); else ajustaB(); mudouVista(); }
    else zoomEm(4, X, Y);
  }
  // Durante pinça, pan e roda, o canvas da carta endireitada só ganha
  // transformação CSS (rápido, borrado por um instante); 120 ms sem gesto,
  // ele é redesenhado nítido (§6.7).
  function mudouVista() {
    marca("palco", "lupa", "ctl");
    clearTimeout(ui.renderTimer);
    ui.renderTimer = setTimeout(() => marca("b"), 120);
  }

  // ── Desenho ──────────────────────────────────────────────────────────────
  function marca(...partes) {
    partes.forEach((p) => { ui.sujo[p] = true; });
    if (!ui.rafId) ui.rafId = requestAnimationFrame(quadro);
  }
  function quadro() {
    ui.rafId = 0;
    const s = ui.sujo;
    ui.sujo = {};
    if (s.res) pintaResultado();
    const med = ativa();
    if (!ui.aberto || !med || !med.img) return;
    if (ui.passo === "angulo") {
      if (!ui.va) ajustaA(med);
      if (s.palco || s.b) { pintaFotoA(med); pintaSvgA(med); posicionaAlcasA(med); }
    } else if (med.linhas) {
      if (!ui.vb) ajustaB();
      if (s.b) pintaFotoB(med);
      if (s.palco || s.b) { transformaB(); pintaSvgB(med); posicionaAlcasB(med); }
    }
    if (s.lupa || s.palco) pintaLupa(med);
    if (s.ctl || s.res || s.palco) pintaControles();
  }

  function dimensiona(cv) {
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX), w = Math.max(1, Math.round(ui.tam.w * dpr)), h = Math.max(1, Math.round(ui.tam.h * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return dpr;
  }
  // Passo Ângulo: a foto inteira pelo mip que dá ~1–2 px de fonte por px de
  // tela, com drawImage (rápido o bastante pra redesenhar a cada quadro).
  function pintaFotoA(med) {
    const cv = el.telaA, dpr = dimensiona(cv), cx = cv.getContext("2d"), v = ui.va;
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.fillStyle = PALCO_BG;
    cx.fillRect(0, 0, cv.width, cv.height);
    // A foto cheia de 12 MP viraria um bitmap de 48 MB só pra tela: no Ângulo
    // o palco usa no máximo o mip 1/2, e a lupa lê a foto cheia.
    const nMin = med.mips.length > 1 && med.w * med.h > 4e6 ? 1 : 0;
    const nivel = limita(Math.floor(Math.log2(Math.max(1, 1 / (v.s * dpr)))), nMin, med.mips.length - 1);
    const b = bitmap(med, nivel);
    if (!b) return;
    cx.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.ox, dpr * v.oy);
    if (med.rot === 1) cx.transform(0, 1, -1, 0, med.h, 0);
    else if (med.rot === 2) cx.transform(-1, 0, 0, -1, med.w, med.h);
    else if (med.rot === 3) cx.transform(0, -1, 1, 0, 0, med.w);
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = "high";
    cx.drawImage(b, 0, 0, med.w, med.h);
  }
  function bitmap(med, nivel) {
    if (med.bmps[nivel]) return med.bmps[nivel];
    if (med.bmps[nivel] === undefined && med.mips && med.mips[nivel]) {
      med.bmps[nivel] = null; // pedido em andamento
      const mip = med.mips[nivel];
      const pronto = (b) => {
        if (med.mips) { med.bmps[nivel] = b; marca("palco"); }
        else if (b) { if (b.close) b.close(); else b.width = b.height = 0; }
      };
      try {
        const dados = new ImageData(mip.data, mip.w, mip.h);
        if (typeof createImageBitmap === "function") createImageBitmap(dados).then(pronto, () => pronto(canvasDe(dados)));
        else pronto(canvasDe(dados));
      } catch (e) { /* sem bitmap: o palco fica escuro, mas a lupa segue lendo a foto */ }
    }
    for (let i = nivel + 1; i < med.bmps.length; i++) if (med.bmps[i]) return med.bmps[i];
    for (let i = nivel - 1; i >= 0; i--) if (med.bmps[i]) return med.bmps[i];
    return null;
  }
  function canvasDe(dados) {
    const c = document.createElement("canvas");
    c.width = dados.width; c.height = dados.height;
    c.getContext("2d").putImageData(dados, 0, 0);
    return c;
  }

  // Passo Bordas: achata em software só a ÁREA VISÍVEL (núcleo, amostragem
  // inversa), pelo mip certo. É só desenho: a medição lê a foto cheia.
  function pintaFotoB(med) {
    const cv = el.telaB;
    if (!tem("achata")) return;
    const p = preset(), v = ui.vb, W = ui.tam.w, H = ui.tam.h;
    // Longe da carta a foto pode nem existir: a área fica presa a uma margem.
    const u0 = limita(-v.bx / (v.z * p.W), -0.2, 1.2), u1 = limita((W - v.bx) / (v.z * p.W), -0.2, 1.2);
    const v0 = limita(-v.by / (v.z * p.H), -0.2, 1.2), v1 = limita((H - v.by) / (v.z * p.H), -0.2, 1.2);
    if (u1 - u0 <= 1e-6 || v1 - v0 <= 1e-6) { ui.vbDesenho = null; cv.style.visibility = "hidden"; return; }
    const [X0, Y0] = telaB(u0, v0), [X1, Y1] = telaB(u1, v1), cssW = X1 - X0, cssH = Y1 - Y0;
    let dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
    // Teto de ~2,5 MP por desenho: acima disso o celular passa de 150 ms.
    const area = cssW * cssH * dpr * dpr;
    if (area > 2.5e6) dpr *= Math.sqrt(2.5e6 / area);
    const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
    const fontePorPx = pxPorMm(med) / (v.z * (w / cssW));
    const nivel = limita(Math.floor(Math.log2(Math.max(1, fontePorPx))), 0, med.mips.length - 1);
    const f = Math.pow(2, -nivel), m = mat(med).slice();
    for (let i = 0; i < 6; i++) m[i] *= f;
    let px;
    try { px = core.achata(med.mips[nivel], m, { u0, v0, u1, v1, w, h }); } catch (e) { return; }
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    cv.getContext("2d").putImageData(new ImageData(px instanceof Uint8ClampedArray ? px : new Uint8ClampedArray(px), w, h), 0, 0);
    cv.style.width = cssW + "px";
    cv.style.height = cssH + "px";
    cv.style.visibility = "";
    ui.vbDesenho = { z: v.z, bx: v.bx, by: v.by, X0, Y0 };
  }
  function transformaB() {
    const d = ui.vbDesenho, v = ui.vb;
    if (!d) return;
    const k = v.z / d.z;
    el.telaB.style.transform = `translate(${v.bx + k * (d.X0 - d.bx)}px, ${v.by + k * (d.Y0 - d.by)}px) scale(${k})`;
  }

  const ptS = (p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  function pintaSvgA(med) {
    const W = ui.tam.w, H = ui.tam.h, c = med.cantos.map(([x, y]) => telaA(med, x, y));
    let s = `<path d="M0 0H${W}V${H}H0Z M${ptS(c[0])}L${ptS(c[1])}L${ptS(c[2])}L${ptS(c[3])}Z" fill="${COR.fora}" fill-rule="evenodd"/>`;
    // As arestas são RETAS PROLONGADAS: o canto da carta é arredondado, e o
    // canto certo é o encontro das retas, não a curva.
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4], L = dist(a, b) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, E = 3000;
      const a2 = [a[0] - ux * E, a[1] - uy * E], b2 = [b[0] + ux * E, b[1] + uy * E];
      s += `<path d="M${ptS(a2)}L${ptS(a)}M${ptS(b)}L${ptS(b2)}" fill="none" stroke="${COR.corte}" stroke-width="1" stroke-dasharray="5 6" opacity=".6"/>`;
      s += `<path d="M${ptS(a)}L${ptS(b)}" fill="none" stroke="${COR.halo}" stroke-width="3.5"/>`;
      s += `<path d="M${ptS(a)}L${ptS(b)}" fill="none" stroke="${COR.corte}" stroke-width="1.5"/>`;
    }
    el.svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    el.svg.innerHTML = s;
  }
  function posicionaAlcasA(med) {
    const c = med.cantos.map(([x, y]) => telaA(med, x, y));
    el.cantos.forEach((b, i) => { b.style.transform = `translate(${c[i][0]}px, ${c[i][1]}px)`; });
    el.meios.forEach((b, i) => {
      const a = c[i], d = c[(i + 1) % 4];
      b.style.transform = `translate(${(a[0] + d[0]) / 2}px, ${(a[1] + d[1]) / 2}px)`;
    });
  }

  function pintaSvgB(med) {
    const W = ui.tam.w, H = ui.tam.h, L = med.linhas, P = (uv) => ptS(telaB(uv[0], uv[1]));
    const poli = (q) => `M${P(q[0])}L${P(q[1])}L${P(q[2])}L${P(q[3])}Z`;
    const qe = poli(quadLinhas(L.ext)), qi = poli(quadLinhas(L.int));
    let s = `<path d="M0 0H${W}V${H}H0Z ${qe}" fill="${COR.fora}" fill-rule="evenodd"/>`;
    s += `<path d="${qe} ${qi}" fill="${COR.faixa}" fill-rule="evenodd"/>`;
    let selS = "";
    for (const tipo of ["ext", "int"]) {
      for (const lado of LADOS) {
        const Lx = L[tipo][lado], ext = tipo === "ext", a = -0.03, b = 1.03;
        const p1 = VERT[lado] ? [em(Lx, a), a] : [a, em(Lx, a)], p2 = VERT[lado] ? [em(Lx, b), b] : [b, em(Lx, b)];
        const d = `M${P(p1)}L${P(p2)}`, eSel = ui.sel.tipo === tipo && ui.sel.lado === lado;
        const cor = eSel ? COR.sel : ext ? COR.corte : COR.moldura, larg = eSel ? 3 : ext ? 1.5 : 2, tr = ext ? ' stroke-dasharray="7 5"' : "";
        const linha = `<path d="${d}" fill="none" stroke="${COR.halo}" stroke-width="${larg + 2}"${tr}/><path d="${d}" fill="none" stroke="${cor}" stroke-width="${larg}"${tr}/>`;
        if (eSel) selS = linha; else s += linha;
      }
    }
    el.svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    el.svg.innerHTML = s + selS;
  }
  // Alça do corte: anel POR FORA da linha, a 30% do comprimento; da moldura:
  // quadrado POR DENTRO, a 70%. As duas de um lado nunca se sobrepõem, mesmo
  // com a borda de ~17 px da visão geral do celular.
  function pontoAlca(med, tipo, lado) {
    const L = med.linhas[tipo][lado];
    let s = tipo === "ext" ? 0.3 : 0.7;
    if (ui.passo === "guiado") {
      // No guiado (zoom 4× no meio do lado) as pontas ficam fora da tela: as
      // alças vão pro centro do palco, uma acima da outra.
      const c = cartaB(ui.tam.w / 2, ui.tam.h / 2), dim = VERT[lado] ? preset().H : preset().W;
      s = limita((VERT[lado] ? c[1] : c[0]) + (tipo === "ext" ? -36 : 36) / (ui.vb.z * dim), 0.02, 0.98);
    }
    const uv = VERT[lado] ? [em(L, s), s] : [s, em(L, s)];
    let [X, Y] = telaB(uv[0], uv[1]);
    const fora = (lado === "l" || lado === "t" ? -1 : 1) * (tipo === "ext" ? 20 : -20);
    if (VERT[lado]) X += fora; else Y += fora;
    return [limita(X, 22, ui.tam.w - 22), limita(Y, 22, ui.tam.h - 22)];
  }
  function posicionaAlcasB(med) {
    let sel = null;
    el.linhas.forEach((h) => {
      const tipo = h.dataset.tipo, lado = h.dataset.lado, p = pontoAlca(med, tipo, lado), eSel = ui.sel.tipo === tipo && ui.sel.lado === lado;
      h.style.transform = `translate(${p[0]}px, ${p[1]}px)`;
      h.classList.toggle("is-sel", eSel);
      h.classList.toggle("is-ima", !!(med.origem && med.origem[tipo][lado] === "ima"));
      if (eSel) sel = p;
    });
    // Rótulo flutuante da selecionada: "Esq · moldura · 2,82 mm".
    if (sel) {
      el.rotulo.hidden = false;
      el.rotulo.textContent = rotuloLinha(med, ui.sel.tipo, ui.sel.lado);
      const dir = sel[0] > ui.tam.w / 2 ? -1 : 1;
      el.rotulo.style.transform = `translate(${dir > 0 ? sel[0] + 26 : sel[0] - 26}px, ${sel[1]}px) translate(${dir > 0 ? "0" : "-100%"}, -50%)`;
    }
  }
  function rotuloLinha(med, tipo, lado) {
    const mm = med.res && med.res.mm ? med.res.mm[lado] : null;
    let txt = `${t(`cen.ladoCurto.${lado}`)} · ${t(`cen.linha.${tipo}`)}${ehNum(mm) ? ` · ${num(mm, 2)} mm` : ""}`;
    if (med.origem && med.origem[tipo][lado] === "ima") txt += ` · ${t("cen.ajustada")}`;
    return txt;
  }

  // ── Lupa ─────────────────────────────────────────────────────────────────
  // Lê a FOTO CHEIA (via H no passo Bordas), com até 6 px de tela por px da
  // foto. No celular: círculo de 132 px no canto de cima OPOSTO ao dedo; no PC:
  // 300 px fixa no painel.
  function mostraLupa(x) {
    clearTimeout(ui.lupaTimer);
    ui.lupaVisivel = true;
    ui.lupaLado = x > ui.tam.w / 2 ? "esq" : "dir";
  }
  function escondeLupaDepois() {
    clearTimeout(ui.lupaTimer);
    ui.lupaTimer = setTimeout(() => { ui.lupaVisivel = false; marca("lupa"); }, 300);
  }
  function pintaLupa(med) {
    const pc = ui.modo === "pc", cv = pc ? el.lupaPc : el.lupaCel;
    if (!pc) {
      el.lupaCel.hidden = !ui.lupaVisivel;
      el.lupaCel.classList.toggle("is-esq", ui.lupaLado === "esq");
      if (!ui.lupaVisivel) return;
    }
    if (!cv || !med.img || !tem("amostra")) return;
    const N = cv.width, css = pc ? 300 : 132, cx = cv.getContext("2d"), im = cx.createImageData(N, N), d = im.data, amostra = core.amostra, img = med.img;
    let k = 0, leg = "";
    if (ui.passo === "angulo") {
      const alvo = ui.lupa && (ui.lupa.tipo === "canto" || ui.lupa.tipo === "meio") ? ui.lupa : { tipo: "canto", i: 0 };
      const c = med.cantos, i2 = (alvo.i + 1) % 4;
      const centro = alvo.tipo === "meio" ? [(c[alvo.i][0] + c[i2][0]) / 2, (c[alvo.i][1] + c[i2][1]) / 2] : c[alvo.i];
      const mag = Math.min(6, 4 * ui.va.s), passo = css / mag / N; // px da foto por px da lupa
      const ex = desrotD(med.rot, passo, 0), ey = desrotD(med.rot, 0, passo);
      for (let j = 0; j < N; j++) {
        const dj = j + 0.5 - N / 2;
        for (let i = 0; i < N; i++, k += 4) {
          const di = i + 0.5 - N / 2, p = amostra(img, centro[0] + ex[0] * di + ey[0] * dj, centro[1] + ex[1] * di + ey[1] * dj);
          d[k] = p[0]; d[k + 1] = p[1]; d[k + 2] = p[2]; d[k + 3] = 255;
        }
      }
      cx.putImageData(im, 0, 0);
      const pl = (q) => { const r = rotD(med.rot, q[0] - centro[0], q[1] - centro[1]); return [r[0] / passo + N / 2, r[1] / passo + N / 2]; };
      // As duas retas do canto (ou a aresta), prolongadas, e a cruz no encontro.
      const arestas = alvo.tipo === "meio" ? [alvo.i] : [(alvo.i + 3) % 4, alvo.i];
      cx.setLineDash([4, 3]);
      arestas.forEach((e) => tracaReta(cx, pl(c[e]), pl(c[(e + 1) % 4]), COR.corte, 1.25));
      cx.setLineDash([]);
      cruz(cx, pl(centro), N);
      leg = t(alvo.tipo === "meio" ? `cen.aresta.${ARESTAS[alvo.i]}` : `cen.canto.${CANTOS[alvo.i]}`);
    } else if (med.linhas) {
      const p = preset(), ppm = pxPorMm(med), mag = Math.min(6, 4 * ui.vb.z / ppm), mmPx = css / (mag * ppm) / N;
      const alvo = ui.lupa && ui.lupa.tipo === "linha" ? ui.lupa : { tipoL: ui.sel.tipo, lado: ui.sel.lado, s: 0.5 };
      const L = med.linhas[alvo.tipoL][alvo.lado], s = limita(ehNum(alvo.s) ? alvo.s : 0.5, 0.12, 0.88);
      const uc = VERT[alvo.lado] ? em(L, s) : s, vc = VERT[alvo.lado] ? s : em(L, s);
      const m = mat(med), du = mmPx / p.W, dv = mmPx / p.H;
      for (let j = 0; j < N; j++) {
        const v = vc + (j + 0.5 - N / 2) * dv, u = uc + (0.5 - N / 2) * du;
        // passo homogêneo incremental: uma divisão por pixel
        let X = m[0] * u + m[1] * v + m[2], Y = m[3] * u + m[4] * v + m[5], Z = m[6] * u + m[7] * v + m[8];
        const dX = m[0] * du, dY = m[3] * du, dZ = m[6] * du;
        for (let i = 0; i < N; i++, k += 4, X += dX, Y += dY, Z += dZ) {
          const q = amostra(img, X / Z, Y / Z);
          d[k] = q[0]; d[k + 1] = q[1]; d[k + 2] = q[2]; d[k + 3] = 255;
        }
      }
      cx.putImageData(im, 0, 0);
      const pl = (uv) => [(uv[0] - uc) / du + N / 2, (uv[1] - vc) / dv + N / 2];
      for (const tipo of ["ext", "int"]) {
        for (const lado of LADOS) {
          const Lx = med.linhas[tipo][lado], a = -0.1, b = 1.1, eSel = tipo === alvo.tipoL && lado === alvo.lado;
          const p1 = VERT[lado] ? [em(Lx, a), a] : [a, em(Lx, a)], p2 = VERT[lado] ? [em(Lx, b), b] : [b, em(Lx, b)];
          cx.setLineDash(tipo === "ext" ? [5, 4] : []);
          tracaReta(cx, pl(p1), pl(p2), eSel ? COR.sel : tipo === "ext" ? COR.corte : COR.moldura, eSel ? 2 : 1.25);
        }
      }
      cx.setLineDash([]);
      cruz(cx, [N / 2, N / 2], N);
      leg = `${t(`cen.ladoNome.${alvo.lado}`)} · ${t(`cen.linha.${alvo.tipoL}`)}`;
    }
    if (pc && el.lupaLeg) el.lupaLeg.textContent = leg;
  }
  function tracaReta(cx, a, b, cor, larg) {
    cx.lineWidth = larg + 2; cx.strokeStyle = COR.halo;
    cx.beginPath(); cx.moveTo(a[0], a[1]); cx.lineTo(b[0], b[1]); cx.stroke();
    cx.lineWidth = larg; cx.strokeStyle = cor;
    cx.beginPath(); cx.moveTo(a[0], a[1]); cx.lineTo(b[0], b[1]); cx.stroke();
  }
  function cruz(cx, p, N) {
    const r = N * 0.06;
    cx.setLineDash([]);
    [[COR.halo, 3], ["#ffffff", 1]].forEach(([cor, w]) => {
      cx.strokeStyle = cor; cx.lineWidth = w;
      cx.beginPath(); cx.moveTo(p[0] - r, p[1]); cx.lineTo(p[0] + r, p[1]); cx.moveTo(p[0], p[1] - r); cx.lineTo(p[0], p[1] + r); cx.stroke();
    });
  }

  // ── Gestos no palco ──────────────────────────────────────────────────────
  function local(ev) { const r = el.palco.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }

  function onDown(ev) {
    ui.tipoUltimo = ev.pointerType;
    const med = ativa();
    if (!med || !med.img || !ui.aberto) return;
    if (ev.pointerType === "mouse" && ev.button !== 0 && ev.button !== 1) return;
    const [x, y] = local(ev);
    ui.ponteiros.set(ev.pointerId, { x, y, tipo: ev.pointerType });
    try { el.palco.setPointerCapture(ev.pointerId); } catch (e) { /* ponteiro já solto */ }
    fechaPops();
    if (ui.ponteiros.size === 2) { iniciaPinca(med); ev.preventDefault(); return; }
    if (ui.ponteiros.size > 2) return;
    const alca = ev.target.closest && ev.target.closest("[data-ctr-alca]");
    const pan = () => { ui.gesto = { tipo: "pan", x0: x, y0: y, x, y, mexeu: false, livre: ui.espaco || ev.button === 1 || ev.pointerType === "mouse" }; };
    if (ui.espaco || ev.button === 1) pan();
    else if (alca && ui.passo === "angulo" && (alca.dataset.ctrAlca === "canto" || alca.dataset.ctrAlca === "meio")) iniciaCanto(med, alca, x, y);
    else if (alca && alca.dataset.ctrAlca === "linha") iniciaLinha(med, alca.dataset.tipo, alca.dataset.lado, x, y, ev, alca);
    else if (emBordas() && med.linhas) {
      // Arrastar o CORPO da linha move a linha inteira, em paralelo.
      const perto = linhaPerto(med, x, y, ev.pointerType);
      if (perto) iniciaLinha(med, perto.tipo, perto.lado, x, y, ev, null);
      else pan();
    } else pan();
    ev.preventDefault();
  }
  function onMove(ev) {
    const pt = ui.ponteiros.get(ev.pointerId);
    if (!pt) return;
    const [x, y] = local(ev);
    pt.x = x; pt.y = y;
    const g = ui.gesto, med = ativa();
    if (!g || !med || !med.img) return;
    if (g.tipo === "pinca") movePinca(g);
    else if (g.tipo === "canto" || g.tipo === "meio") moveCanto(med, g, x, y);
    else if (g.tipo === "linha") moveLinha(med, g, x, y, ev);
    else if (g.tipo === "pan") {
      if (!g.mexeu && Math.hypot(x - g.x0, y - g.y0) < 6) return;
      // Um dedo num vazio só faz pan com zoom acima do ajuste (§5.5).
      const v = ui.passo === "angulo" ? ui.va : ui.vb, z = ui.passo === "angulo" ? v.s : v.z;
      if (!g.livre && z <= v.fit * 1.01) return;
      g.mexeu = true;
      arrasta(x - g.x, y - g.y);
      g.x = x; g.y = y;
    }
    ev.preventDefault();
  }
  function onUp(ev) {
    const pt = ui.ponteiros.get(ev.pointerId);
    if (!pt) return;
    ui.ponteiros.delete(ev.pointerId);
    try { el.palco.releasePointerCapture(ev.pointerId); } catch (e) { /* idem */ }
    const g = ui.gesto, med = ativa();
    if (!g) return;
    if (g.tipo === "pinca") { if (ui.ponteiros.size < 2) { ui.gesto = null; mudouVista(); } return; }
    if (ui.ponteiros.size) return;
    ui.gesto = null;
    const cancelado = ev.type === "pointercancel";
    if (med && med.img) {
      if ((g.tipo === "canto" || g.tipo === "meio") && g.mexeu) fimCanto(med, g, ev.altKey);
      else if (g.tipo === "linha" && g.mexeu) fimLinha(med, g, ev.altKey || g.alt);
      else if (g.tipo === "pan" && !g.mexeu && !cancelado) toqueVazio(pt.x, pt.y, ev);
    }
    // Um arrasto que termina em cima de um botão (o Endireitar logo abaixo do
    // palco, no celular; o fundo do editor) dispara o click NELE — na v1 o
    // gesto de medir fechava a janela e jogava a foto fora. Engole o click que
    // nasce de um arrasto.
    if (g.mexeu) ui.engoleClick = Date.now();
    escondeLupaDepois();
    if (g.mexeu && g.tipo !== "pan") depoisDeMudar(true);
    marca("palco", "lupa");
  }
  function toqueVazio(x, y, ev) {
    if (ev.pointerType === "mouse") return; // o mouse tem o dblclick
    const agora = Date.now(), u = ui.ultimoToque;
    if (u && agora - u.t < 320 && Math.hypot(x - u.x, y - u.y) < 30) { ui.ultimoToque = null; alternaZoom(x, y); }
    else ui.ultimoToque = { t: agora, x, y };
  }

  function iniciaCanto(med, alca, x, y) {
    const i = Number(alca.dataset.i), tipo = alca.dataset.ctrAlca, c = med.cantos;
    const ref = tipo === "canto" ? telaA(med, c[i][0], c[i][1]) : null;
    // O deslocamento entre o dedo e o canto fica: o canto não pula pra baixo
    // do dedo, que o cobriria justo na hora de mirar.
    ui.gesto = { tipo, i, x0: x, y0: y, dx: ref ? x - ref[0] : 0, dy: ref ? y - ref[1] : 0, c0: clone(c), mexeu: false };
    ui.lupa = { tipo, i };
    mostraLupa(x);
    try { alca.focus({ preventScroll: true }); } catch (e) { /* idem */ }
    marca("lupa");
  }
  function moveCanto(med, g, x, y) {
    if (!g.mexeu && Math.hypot(x - g.x0, y - g.y0) < 2) return;
    const novo = g.c0.map((p) => p.slice());
    if (g.tipo === "canto") novo[g.i] = fotoA(med, x - g.dx, y - g.dy);
    else {
      // Meio da aresta: a aresta inteira anda em paralelo (só a componente
      // normal do gesto; ao longo dela não faz nada).
      const j = (g.i + 1) % 4, a = g.c0[g.i], b = g.c0[j], L = dist(a, b) || 1, n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
      const p0 = fotoA(med, g.x0, g.y0), p1 = fotoA(med, x, y), k = (p1[0] - p0[0]) * n[0] + (p1[1] - p0[1]) * n[1];
      novo[g.i] = [a[0] + n[0] * k, a[1] + n[1] * k];
      novo[j] = [b[0] + n[0] * k, b[1] + n[1] * k];
    }
    if (!valido(med, novo)) return; // trava no último estado válido
    if (!g.mexeu) { antesDeMudar(med, false); g.mexeu = true; }
    med.cantos = novo;
    marca("palco", "lupa");
  }
  function fimCanto(med, g, alt) {
    // Canto solto à mão: ~½ px de TELA em px da foto (piso de 0,3 px).
    const sig = Math.max(0.5 / ui.va.s, 0.3);
    med.sigmaCantoPx = med.sigmaCantoPx.slice();
    med.sigmaCantoPx[g.i] = sig;
    if (g.tipo === "meio") med.sigmaCantoPx[(g.i + 1) % 4] = sig;
    // Refino sub-pixel (F1b): as retas de corte por RANSAC com semente fixa.
    // O Desfazer desfaz o encaixe primeiro, por isso ele é um passo próprio.
    const mexidos = g.tipo === "meio" ? [g.i, (g.i + 1) % 4] : [g.i];
    const comIma = sessao.ima && !alt;
    med.cantoMao = med.cantoMao.slice();
    for (const k of mexidos) med.cantoMao[k] = comIma ? 1 : 2;
    if (comIma && tem("refinaCantos")) {
      // Aplica o encaixe a TODO canto já solto com o ímã, não só ao último:
      // um canto solto enquanto os vizinhos ainda estavam no quadrilátero
      // inicial não tinha aresta pra encaixar (as retas dele cruzavam o
      // fundo), e ficava ~14 px fora pra sempre — conferido no Chrome em
      // 2026-10-02 com a carta sintética. Fica de fora o que a pessoa pôs à
      // mão (Alt, ímã desligado, teclado), que o refino desfaria calado, e o
      // canto que ninguém tocou ainda.
      const aplicar = [0, 1, 2, 3].filter((k) => med.cantoMao[k] === 1);
      try {
        const r = core.refinaCantos(med.img, med.cantos, { janelaPx: Math.max(3, 12 / ui.va.s), so: aplicar });
        if (r && r.ok && Array.isArray(r.cantos)) {
          const novo = med.cantos.map((p) => [p[0], p[1]]), sg = med.sigmaCantoPx.slice();
          for (const k of aplicar) {
            novo[k] = [r.cantos[k][0], r.cantos[k][1]];
            if (Array.isArray(r.sigmaPx) && ehNum(r.sigmaPx[k])) sg[k] = r.sigmaPx[k];
          }
          if (valido(med, novo)) { antesDeMudar(med, false); med.cantos = novo; med.sigmaCantoPx = sg; }
        }
      } catch (e) { /* sem refino: o canto fica onde foi solto */ }
    }
    med.pose = calculaPose(med);
  }

  function iniciaLinha(med, tipo, lado, x, y, ev, alca) {
    const L = med.linhas[tipo][lado], uv = cartaB(x, y);
    ui.sel = { tipo, lado };
    ui.gesto = { tipo: "linha", tipoL: tipo, lado, x0: x, y0: y, c0: L.c, mexeu: false, alt: !!ev.altKey };
    ui.lupa = { tipo: "linha", tipoL: tipo, lado, s: limita(VERT[lado] ? uv[1] : uv[0], 0.12, 0.88) };
    mostraLupa(x);
    const h = alca || alcaDe(tipo, lado);
    try { if (h) h.focus({ preventScroll: true }); } catch (e) { /* idem */ }
    marca("palco", "lupa", "ctl");
  }
  function moveLinha(med, g, x, y, ev) {
    if (!g.mexeu) {
      if (Math.abs(x - g.x0) + Math.abs(y - g.y0) < 2) return;
      antesDeMudar(med, false);
      g.mexeu = true;
    }
    const p = preset(), v = ui.vb, d = VERT[g.lado] ? (x - g.x0) / (v.z * p.W) : (y - g.y0) / (v.z * p.H);
    poe(med, g.tipoL, g.lado, g.c0 + d, "manual");
    const uv = cartaB(x, y);
    ui.lupa.s = limita(VERT[g.lado] ? uv[1] : uv[0], 0.12, 0.88);
    g.alt = !!ev.altKey;
    marca("palco", "lupa", "res");
  }
  // Ímã ao soltar (F1b): janela de ±max(4 px da foto; 30% da margem), nunca
  // mais que ±12 px de tela; candidatos por tipo de linha (núcleo). Sem
  // aresta, a linha fica onde foi solta. Alt (PC) solta sem ímã.
  function fimLinha(med, g, alt) {
    if (!sessao.ima || alt || !tem("ima")) return;
    const lado = g.lado, L = med.linhas[g.tipoL][lado], vert = VERT[lado];
    const ppu = pxPorUnid(med, vert, vert ? em(L, 0.5) : 0.5, vert ? 0.5 : em(L, 0.5)), tpf = telaPorFotoB(med);
    const margemPx = Math.abs(em(med.linhas.int[lado], 0.5) - em(med.linhas.ext[lado], 0.5)) * ppu;
    const janelaPx = Math.min(Math.max(4, 0.3 * margemPx), 12 / tpf);
    let r = null;
    try { r = core.ima(med.img, med.cantos, { lado, tipo: g.tipoL, c: L.c, k: L.k }, { janela: janelaPx / ppu, ref: med.linhas.ext[lado].c }); } catch (e) { r = null; }
    if (!r || !ehNum(r.c)) return;
    // Visão geral do celular (1 px de tela > 3 px da foto) com mais de um
    // candidato na janela: corte, moldura e sleeve cabem nela. A linha fica
    // onde foi solta e o painel sugere o modo guiado.
    if (ui.modo !== "pc" && 1 / tpf > 3 && r.candidatos > 1) { ui.sugereGuiado = true; return; }
    const k = ehNum(r.k) ? r.k : L.k, [lo, hi] = faixa(med, g.tipoL, lado, k);
    if (r.c < lo || r.c > hi) return;
    antesDeMudar(med, false);
    L.c = r.c; L.k = k;
    med.origem[g.tipoL][lado] = "ima";
    med.sigma[g.tipoL][lado] = ehNum(r.sigma) ? r.sigma : null;
    if (!ehNum(r.sigma)) marcaManual(med, g.tipoL, lado);
    conferido(med, g.tipoL, lado);
  }
  // A pessoa mexeu na moldura de um lado do "confira": o aviso desse lado sai
  // (ela conferiu). O desfazer devolve o aviso junto com a linha.
  function conferido(med, tipo, lado) {
    if (tipo !== "int" || !med.confere || med.confere.indexOf(lado) < 0) return;
    med.confere = med.confere.filter((l) => l !== lado);
    med.fraca = (med.fraca || []).filter((l) => l !== lado);
  }
  // Põe a linha em c, preso entre as vizinhas (a ordem por eixo nunca cruza:
  // o arrasto TRAVA no vizinho), com 1 px da foto de folga, no comprimento todo.
  function poe(med, tipo, lado, c, origem) {
    const L = med.linhas[tipo][lado], [lo, hi] = faixa(med, tipo, lado, L.k);
    if (lo > hi) return false;
    L.c = limita(c, lo, hi);
    med.origem[tipo][lado] = origem;
    if (origem === "manual") {
      med.sigma[tipo][lado] = null;
      marcaManual(med, tipo, lado);
      conferido(med, tipo, lado);
    }
    return true;
  }
  function faixa(med, tipo, lado, k) {
    const ord = VERT[lado] ? ORDEM.v : ORDEM.h, i = ord.findIndex(([a, b]) => a === tipo && b === lado);
    const cp = cartaPx(med), gap = 1 / (VERT[lado] ? cp.w : cp.h);
    let lo = -0.25, hi = 1.25;
    if (i > 0) { const N = med.linhas[ord[i - 1][0]][ord[i - 1][1]]; for (const s of [0, 1]) lo = Math.max(lo, em(N, s) + gap - k * (s - 0.5)); }
    if (i < 3) { const N = med.linhas[ord[i + 1][0]][ord[i + 1][1]]; for (const s of [0, 1]) hi = Math.min(hi, em(N, s) - gap - k * (s - 0.5)); }
    return [lo, hi];
  }
  function linhaPerto(med, x, y, tipoPonteiro) {
    const tol = tipoPonteiro === "mouse" ? 8 : 18, uv = cartaB(x, y);
    let melhor = null, dm = tol;
    for (const tipo of ["int", "ext"]) {
      for (const lado of LADOS) {
        const L = med.linhas[tipo][lado], s = VERT[lado] ? uv[1] : uv[0];
        if (s < -0.05 || s > 1.05) continue;
        const P = VERT[lado] ? telaB(em(L, s), s) : telaB(s, em(L, s)), dd = VERT[lado] ? Math.abs(P[0] - x) : Math.abs(P[1] - y);
        if (dd < dm) { dm = dd; melhor = { tipo, lado }; }
      }
    }
    return melhor;
  }
  const alcaDe = (tipo, lado) => el.linhas.find((h) => h.dataset.tipo === tipo && h.dataset.lado === lado) || null;

  function iniciaPinca(med) {
    const g = ui.gesto;
    // O 2º dedo interrompeu um arrasto: devolve o que o 1º já tinha mexido.
    if (g && g.mexeu && (g.tipo === "canto" || g.tipo === "meio" || g.tipo === "linha") && med.undo.length) {
      restaura(med, med.undo.pop());
      if (emBordas()) mede(med);
    }
    const [a, b] = [...ui.ponteiros.values()];
    ui.gesto = { tipo: "pinca", d0: Math.max(10, dist([a.x, a.y], [b.x, b.y])), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, mexeu: true };
    ui.lupaVisivel = false;
    marca("palco", "lupa", "res");
  }
  function movePinca(g) {
    const pts = [...ui.ponteiros.values()];
    if (pts.length < 2) return;
    const [a, b] = pts, d = Math.max(10, dist([a.x, a.y], [b.x, b.y])), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    zoomEm(d / g.d0, g.mx, g.my);
    arrasta(mx - g.mx, my - g.my);
    g.d0 = d; g.mx = mx; g.my = my;
  }

  // Régua fina (F1b): 10 px de arrasto = 1 px da foto.
  function ligaRegua() {
    let g = null;
    el.regua.addEventListener("pointerdown", (ev) => {
      const med = ativa();
      if (!med || !med.linhas) return;
      const L = med.linhas[ui.sel.tipo][ui.sel.lado], vert = VERT[ui.sel.lado];
      g = { x0: ev.clientX, c0: L.c, ppu: pxPorUnid(med, vert, vert ? em(L, 0.5) : 0.5, vert ? 0.5 : em(L, 0.5)), mexeu: false };
      try { el.regua.setPointerCapture(ev.pointerId); } catch (e) { /* idem */ }
      ui.lupa = { tipo: "linha", tipoL: ui.sel.tipo, lado: ui.sel.lado, s: 0.5 };
      mostraLupa(ui.tam.w * (ui.sel.lado === "r" ? 0.75 : 0.25));
      marca("lupa");
      ev.preventDefault();
    });
    el.regua.addEventListener("pointermove", (ev) => {
      const med = ativa();
      if (!g || !med || !med.linhas) return;
      const dx = ev.clientX - g.x0;
      if (!g.mexeu) { if (Math.abs(dx) < 2) return; antesDeMudar(med, false); g.mexeu = true; }
      poe(med, ui.sel.tipo, ui.sel.lado, g.c0 + dx / 10 / g.ppu, "manual");
      el.reguaM.style.transform = `translateX(${dx % 20}px)`;
      marca("palco", "lupa", "res");
    });
    const fim = () => {
      if (!g) return;
      const mexeu = g.mexeu;
      g = null;
      el.reguaM.style.transform = "";
      escondeLupaDepois();
      if (mexeu) { ui.engoleClick = Date.now(); depoisDeMudar(true); }
    };
    el.regua.addEventListener("pointerup", fim);
    el.regua.addEventListener("pointercancel", fim);
  }
  // Botões −/+ das linhas e do giro: 1 passo por toque e, segurando, repetição
  // a 12/s depois de 400 ms. O click de teclado (detail 0) dá um passo só; o
  // de dedo já foi dado no pointerdown.
  function ligaRepeticao() {
    let espera = 0, ritmo = 0;
    const para = () => { clearTimeout(espera); clearInterval(ritmo); espera = ritmo = 0; };
    const passoDe = (b) => {
      const med = ativa();
      if (!med || !med.linhas) return;
      if (b.dataset.ctrPasso) moveLinhaPx(med, ui.sel.tipo, ui.sel.lado, Number(b.dataset.ctrPasso));
      else if (b.dataset.ctrGiro) gira(med.giro + 0.05 * Number(b.dataset.ctrGiro));
    };
    el.editor.querySelectorAll("[data-ctr-passo], [data-ctr-giro]").forEach((b) => {
      b.addEventListener("pointerdown", (ev) => {
        if (ev.pointerType === "mouse" && ev.button !== 0) return;
        para();
        passoDe(b);
        espera = setTimeout(() => { ritmo = setInterval(() => passoDe(b), 83); }, 400);
      });
      ["pointerup", "pointerleave", "pointercancel"].forEach((n) => b.addEventListener(n, para));
      b.addEventListener("click", (ev) => { if (ev.detail === 0) passoDe(b); });
    });
  }

  // ── Mudanças ─────────────────────────────────────────────────────────────
  function moveLinhaPx(med, tipo, lado, px) {
    const L = med.linhas[tipo][lado], vert = VERT[lado];
    const ppu = pxPorUnid(med, vert, vert ? em(L, 0.5) : 0.5, vert ? 0.5 : em(L, 0.5));
    antesDeMudar(med, true);
    ui.sel = { tipo, lado };
    poe(med, tipo, lado, L.c + px / ppu, "manual");
    ui.lupa = { tipo: "linha", tipoL: tipo, lado, s: 0.5 };
    depoisDeMudar(false);
    anunciaDepois();
  }
  function depoisDeMudar(final) {
    const med = ativa();
    if (med && med.linhas) mede(med);
    marca("palco", "lupa", "res", "ctl");
    pintaBarra();
    salvaDepois();
    // O valor das alças (aria-valuetext) acompanha todo passo de teclado e de
    // botão; a fala do resumo, só no fim (ou 600 ms depois do último ajuste).
    atualizaAria();
    if (final) anunciaDepois();
  }
  function mede(med) {
    if (!med || !med.linhas || !tem("medir")) return;
    try {
      med.res = core.medir({ ext: med.linhas.ext, int: med.linhas.int }, {
        sigma: med.sigma, preset: preset(), cantos: med.cantos, sigmaCantoPx: med.sigmaCantoPx,
        sigmaManualPx: med.sigmaManual, poseGraus: med.pose,
        foto: { focal35: med.exif ? med.exif.focal35 : null, w: med.w, h: med.h }
      });
    } catch (e) { med.res = null; }
  }
  // Sugestão das 8 linhas ao endireitar (F1b). Sem pico confiável o lado
  // entra em "confira" e a moldura fica a 4,5% pra dentro.
  function sugere(med) {
    let s = null;
    if (tem("sugereLinhas")) { try { s = core.sugereLinhas(med.img, med.cantos); } catch (e) { s = null; } }
    const ok = s && s.ext && s.int && LADOS.every((l) => s.ext[l] && s.int[l] && ehNum(s.ext[l].c) && ehNum(s.int[l].c));
    med.sigma = sigmaVazio();
    med.sigmaManual = null;
    if (ok) {
      med.linhas = { ext: {}, int: {} };
      for (const tp of ["ext", "int"]) {
        for (const l of LADOS) {
          med.linhas[tp][l] = { c: s[tp][l].c, k: ehNum(s[tp][l].k) ? s[tp][l].k : 0 };
          const sg = s.sigma && s.sigma[tp] ? s.sigma[tp][l] : null;
          med.sigma[tp][l] = ehNum(sg) ? sg : null;
        }
      }
      med.confere = Array.isArray(s.confere) ? s.confere.filter((l) => LADOS.includes(l)) : [];
      // "fraca": moldura posta numa aresta fraca (borda clara, arte clara) —
      // o aviso do passo Bordas diz "pode errar em arte clara".
      med.fraca = Array.isArray(s.fraca) ? s.fraca.filter((l) => med.confere.includes(l)) : [];
      med.origem = origemToda("auto");
      med.confere.forEach((l) => { med.origem.int[l] = "manual"; });
    } else {
      med.linhas = linhasPadrao();
      med.confere = [];
      med.fraca = [];
      med.origem = origemToda("manual");
    }
    med.giro = 0;
    ui.sel = { tipo: "int", lado: med.confere[0] || "l" };
  }
  function endireitar() {
    const med = ativa();
    if (!med || !med.img || !med.cantos) return;
    if (!tem("squareToQuad", "inverte", "aplica", "achata", "medir")) { toast(t("cen.erro.semCore")); return; }
    if (!valido(med, med.cantos)) { toast(t("cen.erro.quad")); return; }
    if (!med.linhas) sugere(med);
    med.pose = calculaPose(med);
    mede(med);
    ui.vb = null;
    salva();
    irPara("bordas");
  }
  function girar() {
    const med = ativa();
    if (!med || !med.cantos) return;
    antesDeMudar(med, false);
    med.rot = (med.rot + 1) % 4;
    const c = med.cantos, s = med.sigmaCantoPx;
    // Girar a vista 90° no horário: o canto que estava embaixo à esquerda vira
    // o de cima à esquerda. As linhas eram da orientação antiga: recomeçam.
    const mao = med.cantoMao;
    med.cantos = [c[3], c[0], c[1], c[2]];
    med.cantoMao = [mao[3], mao[0], mao[1], mao[2]];
    med.sigmaCantoPx = [s[3], s[0], s[1], s[2]];
    med.linhas = null; med.sigma = null; med.sigmaManual = null; med.origem = null; med.res = null; med.giro = 0;
    ajustaA(med);
    depoisDeMudar(true);
  }
  function jaReta() {
    const med = ativa();
    if (!med || !med.img) return;
    antesDeMudar(med, false);
    let c = [[0, 0], [med.w, 0], [med.w, med.h], [0, med.h]];
    for (let i = 0; i < med.rot; i++) c = [c[3], c[0], c[1], c[2]];
    med.cantos = c;
    med.cantoMao = [2, 2, 2, 2];
    med.sigmaCantoPx = [0.5, 0.5, 0.5, 0.5];
    med.linhas = null;
    endireitar();
  }
  function resugere() {
    const med = ativa();
    if (!med || !med.img) return;
    antesDeMudar(med, false);
    sugere(med);
    mede(med);
    depoisDeMudar(true);
  }
  // Giro da moldura: as 4 linhas de moldura juntas, em volta do centro delas,
  // no espaço MÉTRICO (núcleo). −5° a +5°, passo de 0,05°.
  function gira(novo) {
    const med = ativa();
    if (!med || !med.linhas || !tem("giraMoldura")) return;
    novo = limita(Math.round(novo * 20) / 20, -5, 5);
    const delta = novo - med.giro;
    if (Math.abs(delta) < 1e-9) return;
    antesDeMudar(med, true);
    try { med.linhas.int = core.giraMoldura(med.linhas.int, delta, preset()); } catch (e) { return; }
    med.giro = novo;
    LADOS.forEach((l) => { if (med.origem.int[l] !== "manual") med.origem.int[l] = "manual"; med.sigma.int[l] = null; marcaManual(med, "int", l); });
    depoisDeMudar(false);
    anunciaDepois();
  }
  function trocaPreset(valor) {
    sessao.preset = valor === "personalizado" || PRESETS[valor] ? valor : "63x88";
    if (sessao.preset !== "personalizado") sessao.custom = Object.assign({}, PRESETS[sessao.preset]);
    // O tamanho não muda a porcentagem (H' = diag(W, H, 1)·H), só os mm, o
    // desenho e o giro: remede os dois lados.
    ["f", "v"].forEach((k) => { const m = sessao.lados[k]; if (m && m.linhas && m.cantos) mede(m); });
    if (emBordas()) { ajustaB(); marca("b"); }
    depoisDeMudar(true);
    salva();
  }

  // ── Teclado ──────────────────────────────────────────────────────────────
  function teclaAlca(ev, alca) {
    const med = ativa();
    if (!med || !med.img) return false;
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
    if (!dir) return false;
    const passo = ev.shiftKey ? 10 : ev.altKey ? 0.25 : 1;
    const tipo = alca.dataset.ctrAlca;
    if (tipo === "canto" || tipo === "meio") {
      if (ui.passo !== "angulo") return false;
      const i = Number(alca.dataset.i), [dx, dy] = desrotD(med.rot, dir[0] * passo, dir[1] * passo), novo = med.cantos.map((p) => p.slice());
      if (tipo === "canto") novo[i] = [novo[i][0] + dx, novo[i][1] + dy];
      else {
        const j = (i + 1) % 4, a = novo[i], b = novo[j], L = dist(a, b) || 1, n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L], k = dx * n[0] + dy * n[1];
        novo[i] = [a[0] + n[0] * k, a[1] + n[1] * k];
        novo[j] = [b[0] + n[0] * k, b[1] + n[1] * k];
      }
      if (valido(med, novo)) {
        antesDeMudar(med, true);
        med.cantos = novo;
        // Canto movido pelo teclado: o σ do encaixe (~0,2 px) não vale mais —
        // o mesmo ~½ px de TELA do canto solto à mão (fimCanto).
        const sig = Math.max(0.5 / ui.va.s, 0.3);
        med.sigmaCantoPx = med.sigmaCantoPx.slice();
        med.sigmaCantoPx[i] = Math.max(med.sigmaCantoPx[i], sig);
        if (tipo === "meio") med.sigmaCantoPx[(i + 1) % 4] = Math.max(med.sigmaCantoPx[(i + 1) % 4], sig);
        // Ajuste fino pelo teclado é decisão da pessoa: o próximo encaixe
        // (de outro canto solto com o ímã) não pode desfazê-lo.
        med.cantoMao = med.cantoMao.slice();
        med.cantoMao[i] = 2;
        if (tipo === "meio") med.cantoMao[(i + 1) % 4] = 2;
        med.pose = calculaPose(med);
        ui.lupa = { tipo, i };
        depoisDeMudar(false);
        anunciaDepois();
      }
      return true;
    }
    const lado = alca.dataset.lado, comp = VERT[lado] ? dir[0] : dir[1];
    if (comp && med.linhas) moveLinhaPx(med, alca.dataset.tipo, lado, comp * passo);
    return true;
  }
  function onTecla(ev) {
    if (!ui.aberto) return;
    const alvo = ev.target, campo = alvo && alvo.closest && alvo.closest("input, select, textarea");
    const mod = ev.ctrlKey || ev.metaKey;
    // Esc e Ctrl+Z/Ctrl+Y só valem quando a tecla nasce no editor (ou no
    // body). Fora dele (a busca do Ctrl+K, o mega-menu, o seletor de idioma)
    // a tecla é de quem está lá: o listener do shared.js fecha o overlay ANTES
    // deste rodar, então perguntar se ele está aberto não adianta — o Esc que
    // fechava a busca também recuava o editor. Num campo, o Ctrl+Z é o
    // desfazer do TEXTO. O Tab fica fora disso: a trava de foco do imersivo
    // precisa puxar de volta o foco que escapou.
    const doEditor = !alvo || alvo === document.body || alvo === document.documentElement || !!(el.editor && el.editor.contains(alvo));
    if (ev.key === "Escape") { if (doEditor && !ev.defaultPrevented) { ev.preventDefault(); voltaUm(); } return; }
    if (mod && doEditor && !campo && !ev.altKey && (ev.key === "z" || ev.key === "Z")) { ev.preventDefault(); desfazer(ev.shiftKey); return; }
    if (mod && doEditor && !campo && (ev.key === "y" || ev.key === "Y")) { ev.preventDefault(); desfazer(true); return; }
    if (ev.key === "Tab" && ui.modo !== "pc") { prendeFoco(ev); return; }
    if (campo) return;
    const alca = alvo && alvo.closest && alvo.closest("[data-ctr-alca]");
    if (alca && teclaAlca(ev, alca)) { ev.preventDefault(); return; }
    if (mod || ev.altKey) return;
    const interativo = alvo && alvo.closest && alvo.closest("button, a, [role=slider], [role=menuitem], summary");
    // Espaço+arrastar move a vista — só com o ponteiro sobre o palco (ou no
    // editor imersivo): no PC o editor mora na página, e o Espaço fora dele
    // continua rolando a página.
    if (ev.key === " " && !interativo && (ui.sobrePalco || ui.modo !== "pc")) { ev.preventDefault(); ui.espaco = true; el.palco.classList.add("is-mao"); return; }
    if (ev.key === "Enter" && (!interativo || alca)) { ev.preventDefault(); enter(); return; }
    if (ev.key === "?") { ev.preventDefault(); alternaAtalhos(); return; }
    if (emBordas()) {
      if (ev.key === "[" || ev.key === "]") { ev.preventDefault(); mudaLadoLinha(ev.key === "]" ? 1 : -1); return; }
      if (ev.key === "c" || ev.key === "C") { ev.preventDefault(); escolhe("ext", ui.sel.lado, true); return; }
      if (ev.key === "m" || ev.key === "M") { ev.preventDefault(); escolhe("int", ui.sel.lado, true); }
    }
  }
  function enter() {
    if (ui.passo === "angulo") endireitar();
    else if (ui.passo === "guiado") guiaPasso(1);
    else if (emBordas()) mudaLadoLinha(1);
  }
  function mudaLadoLinha(d) {
    const i = (GUIA.indexOf(ui.sel.lado) + d + 4) % 4;
    escolhe(ui.sel.tipo, GUIA[i], true);
  }
  function escolhe(tipo, lado, focar) {
    ui.sel = { tipo, lado };
    ui.lupa = { tipo: "linha", tipoL: tipo, lado, s: 0.5 };
    if (focar) { const h = alcaDe(tipo, lado); try { if (h && !h.hidden) h.focus({ preventScroll: true }); } catch (e) { /* idem */ } }
    marca("palco", "lupa", "ctl");
  }
  function prendeFoco(ev) {
    // offsetParent não enxerga visibility:hidden (o corpo da folha recolhida)
    // nem o conteúdo de um <details> fechado: o fim da lista virava botão que
    // o navegador não foca, e o Tab escapava pro chip "Como funciona" da
    // página, atrás do editor.
    const visivel = (x) => (typeof x.checkVisibility === "function"
      ? x.checkVisibility({ visibilityProperty: true })
      : x.offsetParent !== null && getComputedStyle(x).visibility !== "hidden");
    const foco = [...el.editor.querySelectorAll("button, [tabindex='0'], select, input, summary, a[href]")]
      .filter((x) => !x.disabled && !x.closest("[hidden]") && visivel(x));
    if (!foco.length) return;
    const i = foco.indexOf(document.activeElement);
    if (ev.shiftKey && (i <= 0)) { ev.preventDefault(); foco[foco.length - 1].focus(); }
    else if (!ev.shiftKey && (i === foco.length - 1 || i < 0)) { ev.preventDefault(); foco[0].focus(); }
  }
  // Esc fecha antes o menu, a lupa e a folha; senão recua um passo.
  function voltaUm() {
    if (ui.menu || ui.atalhos) { fechaPops(); return; }
    if (ui.lupaVisivel && ui.modo !== "pc") { ui.lupaVisivel = false; marca("lupa"); return; }
    if (ui.folha > 0 && ui.passo !== "resultado") { ui.folha = 0; pintaFolha(); return; }
    recua();
  }
  function recua() {
    if (ui.pilha.length > 1) { history.back(); return; }
    const ant = { resultado: "bordas", guiado: "bordas", bordas: "angulo", angulo: "entrada" }[ui.passo] || "entrada";
    ui.pilha = [chave("entrada")];
    aplicaPasso(ant);
  }

  // ── Navegação: passos no histórico ───────────────────────────────────────
  // Cada passo de topo é uma entrada no histórico, SEMPRE com a URL absoluta
  // da página: com <base href="/">, um "?passo=" ou "#…" relativo resolveria
  // na HOME (o F5 abriria a Início e o voltar do Android sairia da ferramenta).
  const urlAtual = () => location.pathname + location.search;
  // Id desta CARGA da página: uma entrada do histórico de uma carga anterior
  // (recarregou no meio da medição; voltou sem bfcache) vira "entrada" e não
  // reabre o editor — antes, voltar até ela abria o Ângulo com a foto nova.
  const CARGA = Math.random().toString(36).slice(2);
  // A pilha é por lado (ver chave): o passo procurado é o DO LADO ATIVO.
  // Achar o mesmo passo mais embaixo volta até ele (o voltar do Android recua
  // um passo de cada vez, §5.3); um passo novo empilha.
  function irPara(p) {
    const k = chave(p), topo = ui.pilha.length - 1, i = ui.pilha.lastIndexOf(k);
    if (i >= 0 && i < topo) { history.go(i - topo); return; }
    if (i === topo) { aplicaPasso(p); return; }
    ui.pilha.push(k);
    try { history.pushState({ ctr: p, lado: sessao.ladoAtivo, carga: CARGA }, "", urlAtual()); } catch (e) { /* sem histórico: segue só na tela */ }
    aplicaPasso(p);
  }
  function onPop(ev) {
    const s = ev.state && ev.state.carga === CARGA ? ev.state : null;
    const p = (s && s.ctr) || "entrada";
    // Voltar pra uma entrada do OUTRO lado (o resultado da frente, depois de
    // "Medir o verso"): o lado ativo volta junto, e o aplicaPasso redecodifica
    // a foto dele, que só tinha o Blob.
    if (s && (s.lado === "f" || s.lado === "v") && s.lado !== sessao.ladoAtivo) {
      const atual = ativa();
      sessao.ladoAtivo = s.lado;
      if (atual && atual !== ativa()) liberaPixels(atual);
      ui.va = null; ui.vb = null; ui.guiado = 0;
      salva();
    }
    const k = chave(p), i = ui.pilha.lastIndexOf(k);
    if (i >= 0) ui.pilha.length = i + 1; else if (s) ui.pilha.push(k); else ui.pilha = [k];
    aplicaPasso(p);
  }
  function aplicaPasso(p) {
    const med = ativa(), g = ++ui.geracao;
    if (p !== "entrada") {
      if (!med || !med.blob) p = "entrada";
      else if (!med.img) {
        // Lado com foto, mas sem pixels (o outro estava ativo): redecodifica.
        // Só reaplica se nada mudou no meio — Fechar/Nova foto, outro passo,
        // outro lado: antes o fim da decodificação REABRIA o editor sozinho,
        // com o histórico parado na entrada.
        const vale = () => g === ui.geracao && ativa() === med;
        garantePixels(med).then(() => { if (vale()) aplicaPasso(p); }, () => { if (vale()) { msg(t("cen.erro.abrir")); aplicaPasso("entrada"); } });
        return;
      }
    }
    if ((p === "bordas" || p === "guiado" || p === "resultado") && !med.linhas) p = "angulo";
    const antes = ui.passo;
    ui.passo = p;
    fechaPops();
    if (p === "entrada") {
      // O editor fechou com o foco dentro dele (ou já caído no <body>): o foco
      // vai pra entrada, senão o leitor de tela volta pro topo da página. Não
      // rouba o foco no boot (editor fechado) nem o do h2 da Ajuda.
      const a = document.activeElement;
      const devolve = ui.aberto && (!a || a === document.body || !!(el.editor && el.editor.contains(a)));
      fechaEditor();
      pintaEntrada();
      if (devolve) {
        const alvo = el.continuar && !el.continuar.hidden ? el.continuar : el.entrada.querySelector(".ctr-drop-t");
        if (alvo) {
          if (alvo.tagName === "H2" && !alvo.hasAttribute("tabindex")) alvo.setAttribute("tabindex", "-1");
          try { alvo.focus({ preventScroll: true }); } catch (e) { /* idem */ }
        }
      }
      return;
    }
    abreEditor();
    if (p === "angulo") {
      ui.lupa = { tipo: "canto", i: 0 };
      if (!ui.va) ajustaA(med);
    } else {
      if (p === "guiado") focaGuiado();
      else if (!ui.vb || antes === "guiado" || antes === "angulo") ajustaB();
      if (p !== "guiado") ui.lupa = { tipo: "linha", tipoL: ui.sel.tipo, lado: ui.sel.lado, s: 0.5 };
      ui.folha = p === "resultado" ? Math.max(ui.folha, 1) : 0;
    }
    visibilidade();
    pintaBarra();
    marca("palco", "b", "lupa", "res", "ctl");
    if (p === "resultado" && ui.modo !== "retrato") {
      const h = el.res.querySelector(".ctr-res-t");
      if (h) { h.scrollIntoView({ block: "nearest" }); h.focus({ preventScroll: true }); }
    } else if (antes !== p) focaTitulo();
    atualizaAria();
  }
  function abreEditor() {
    if (!el.editor) montaEditor();
    if (ui.aberto) { arrumaLayout(); return; }
    ui.aberto = true;
    el.editor.hidden = false;
    el.entrada.hidden = true;
    el.salvo.hidden = true;
    el.msg.textContent = ""; // esvazia, nunca hidden (ver msg)
    arrumaLayout();
    medePalco(true);
    if (ui.modo === "pc") {
      const r = el.editor.getBoundingClientRect();
      if (r.top < 0 || r.top > window.innerHeight * 0.5) el.editor.scrollIntoView({ block: "start", behavior: reduzMov() ? "auto" : "smooth" });
    }
  }
  function fechaEditor() {
    if (!el.editor || !ui.aberto) { if (el.entrada) el.entrada.hidden = false; return; }
    ui.aberto = false;
    el.editor.hidden = true;
    el.entrada.hidden = false;
    imersivo(false);
    ui.gesto = null;
    ui.ponteiros.clear();
  }
  function focaTitulo() { try { el.titulo.focus({ preventScroll: true }); } catch (e) { /* idem */ } }

  function trocaLado(k) {
    if (k === sessao.ladoAtivo) return;
    const atual = ativa();
    sessao.ladoAtivo = k;
    const med = ativa();
    if (atual && atual !== med) liberaPixels(atual);
    ui.va = null; ui.vb = null; ui.guiado = 0;
    salva();
    if (!med || !med.blob) { irPara("entrada"); pintaEntrada(); return; }
    // Sempre pelo irPara: o passo do outro lado é outra entrada da pilha (e do
    // histórico), mesmo com o mesmo nome — o voltar devolve o lado anterior.
    irPara(med.linhas ? "bordas" : "angulo");
  }

  // ── Modo guiado (celular): "Conferir lados" ──────────────────────────────
  function focaGuiado() {
    const med = ativa();
    if (!med || !med.linhas) return;
    const lado = GUIA[ui.guiado], L = med.linhas, p = preset();
    ui.sel = { tipo: ui.sel.tipo, lado };
    if (!ui.vb) ajustaB();
    const v = ui.vb, z = Math.min(v.fit * 4, Math.max(v.fit, 4 * pxPorMm(med)));
    const meio = (em(L.ext[lado], 0.5) + em(L.int[lado], 0.5)) / 2, uv = VERT[lado] ? [meio, 0.5] : [0.5, meio];
    v.z = z;
    v.bx = ui.tam.w / 2 - z * p.W * uv[0];
    v.by = ui.tam.h / 2 - z * p.H * uv[1];
    ui.lupa = { tipo: "linha", tipoL: ui.sel.tipo, lado, s: 0.5 };
    mudouVista();
    marca("b");
  }
  function guiaPasso(d) {
    const n = ui.guiado + d;
    if (n < 0) return;
    if (n > 3) { irPara("resultado"); ui.folha = 2; pintaFolha(); return; }
    ui.guiado = n;
    focaGuiado();
    pintaBarra();
    visibilidade();
  }

  // ── Barra, controles, folha, menus ───────────────────────────────────────
  function pintaBarra() {
    if (!el.editor) return;
    const med = ativa(), p = ui.passo;
    const lado = t(`cen.lado.${sessao.ladoAtivo}`);
    el.titulo.textContent = p === "guiado"
      ? t("cen.guiado.titulo", { lado: t(`cen.ladoNome.${GUIA[ui.guiado]}`), n: String(ui.guiado + 1) })
      : `${t(p === "angulo" ? "cen.passo.angulo" : p === "resultado" ? "cen.passo.resultado" : "cen.passo.bordas")} · ${lado}`;
    el.ladoBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lado === sessao.ladoAtivo)));
    const atual = p === "angulo" ? 0 : p === "resultado" ? 2 : 1;
    el.passos.forEach((b, i) => {
      if (i === atual) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
      b.classList.toggle("is-feito", i < atual);
      b.disabled = i === 2 && !(med && med.linhas);
    });
    el.desfazer.disabled = !(med && med.undo.length);
    el.refazer.disabled = !(med && med.redo.length);
    el.prog.forEach((s, i) => { s.className = i < ui.guiado ? "is-feito" : i === ui.guiado ? "is-atual" : ""; });
    if (el.guiaProxT) el.guiaProxT.textContent = t(ui.guiado >= 3 ? "cen.ctl.verResultado" : "cen.ctl.proximo");
  }
  function pintaControles() {
    if (!el.editor || !ui.aberto) return;
    const med = ativa();
    if (!med) return;
    if (ui.passo === "angulo") {
      el.dica.textContent = t("cen.angulo.dica");
      el.ang.textContent = med.pose != null ? t("cen.angulo.foto", { g: num(med.pose, 0) }) : t("cen.angulo.desconhecido");
    } else {
      el.dica.textContent = t("cen.bordas.dica");
    }
    if (el.presetSel.value !== sessao.preset) el.presetSel.value = sessao.preset;
    // Os jogos de cada tamanho numa dica ao lado (o rótulo do select é só a
    // medida: no celular, "63 × 88 mm (Pokémon, Mc…" cortava).
    if (el.tamJogos) el.tamJogos.textContent = sessao.preset === "personalizado" ? "" : t(`cen.tam.j${sessao.preset}`);
    el.custom.hidden = sessao.preset !== "personalizado";
    // "Confira" visível no passo Bordas (antes só aparecia na lista de avisos
    // do resultado, que no celular mora na folha recolhida).
    if (el.avisoB) {
      const txt = emBordas() ? avisosConfere(med).join(" ") : "";
      if (el.avisoB.textContent !== txt) el.avisoB.textContent = txt;
      el.avisoB.hidden = !txt;
    }
    if (document.activeElement !== el.inW) el.inW.value = String(sessao.custom.W);
    if (document.activeElement !== el.inH) el.inH.value = String(sessao.custom.H);
    el.imaBtn.setAttribute("aria-pressed", String(sessao.ima));
    el.imaBtn.querySelector(".ctr-toggle-v").textContent = t(sessao.ima ? "cen.ima.ligado" : "cen.ima.desligado");
    el.chipsLado.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lado === ui.sel.lado)));
    el.chipsTipo.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tipo === ui.sel.tipo)));
    if (med.linhas) {
      el.valor.textContent = rotuloLinha(med, ui.sel.tipo, ui.sel.lado);
      const g = Math.round(med.giro * 100) / 100;
      if (document.activeElement !== el.giroIn) el.giroIn.value = String(g);
      el.giroIn.setAttribute("aria-valuetext", t("cen.aria.giro", { g: num(g, 2) }));
      el.giroV.textContent = `${num(g, 2)}°`;
    }
    const v = ui.passo === "angulo" ? ui.va : ui.vb;
    if (v) el.zoomV.textContent = `${Math.round(100 * (ui.passo === "angulo" ? v.s : v.z) / v.fit)}%`;
  }
  // Folha do resultado no celular em pé: recolhida (52 px), média e cheia.
  function pintaFolha() {
    if (!el.folha) return;
    el.folha.dataset.altura = String(ui.folha);
    el.folhaCab.setAttribute("aria-expanded", String(ui.folha > 0));
    // Texto só pro leitor de tela ANTES do resumo visível, não aria-label: o
    // aria-label trocava o "L/R 57,5/42,5 · … · PSA 9" do nome acessível
    // (WCAG 2.5.3) e a nota sumia com a folha recolhida.
    if (el.folhaAcao) el.folhaAcao.textContent = t(ui.folha > 0 ? "cen.res.folhaFecha" : "cen.res.folhaAbre") + ": ";
  }
  function alternaFolha() {
    if (ui.folha === 0) { ui.folha = 1; irPara("resultado"); return; }
    if (ui.folha === 1) { ui.folha = 2; pintaFolha(); return; }
    ui.folha = 0;
    if (ui.passo === "resultado") recua(); else pintaFolha();
  }
  function pintaMenu() {
    const p = ui.passo, cel = ui.modo !== "pc";
    el.menu.querySelectorAll("[data-menu]").forEach((b) => {
      const q = b.dataset.menu;
      b.hidden = !(q === "sempre" || (q === "angulo" && p === "angulo") || (q === "bordas" && emBordas()) ||
        (q === "bordas-cel" && emBordas() && cel) || (q === "cel" && cel) || (q === "pc" && !cel)) ||
        (b.dataset.ctrAcao === "atalhos" && toque()); // atalhos de teclado: só com ponteiro fino
      if (b.dataset.ctrAcao === "ima") b.textContent = t(sessao.ima ? "cen.ctl.imaDesliga" : "cen.ctl.imaLiga");
      if (b.dataset.ctrAcao === "refazer") b.disabled = !(ativa() && ativa().redo.length);
    });
  }
  function alternaMenu() {
    const abrir = !ui.menu;
    fechaPops();
    if (!abrir) return;
    ui.menu = true;
    pintaMenu();
    el.menu.hidden = false;
    el.menuBtn.setAttribute("aria-expanded", "true");
    const i = el.menu.querySelector("[data-menu]:not([hidden])");
    if (i) i.focus();
  }
  function alternaAtalhos() {
    const abrir = !ui.atalhos;
    fechaPops();
    if (!abrir) return;
    ui.atalhos = true;
    el.pop.hidden = false;
    el.atalhosBtn.setAttribute("aria-expanded", "true");
  }
  function fechaPops() {
    if (!el.editor) return;
    // Menu fechado com o foco num item (Esc, clique num item): o foco volta
    // pro botão que o abriu (padrão WAI-ARIA), senão cai no <body> e sai do
    // diálogo imersivo. O teste vem ANTES de esconder.
    const f = document.activeElement;
    const volta = ui.menu && el.menu.contains(f) ? el.menuBtn : ui.atalhos && el.pop.contains(f) ? el.atalhosBtn : null;
    if (ui.menu) { el.menu.hidden = true; el.menuBtn.setAttribute("aria-expanded", "false"); }
    if (ui.atalhos) { el.pop.hidden = true; el.atalhosBtn.setAttribute("aria-expanded", "false"); }
    ui.menu = false;
    ui.atalhos = false;
    if (volta && volta.offsetParent !== null) { try { volta.focus({ preventScroll: true }); } catch (e) { /* idem */ } }
  }

  // ── Acessibilidade: valores das alças e o resumo falado ──────────────────
  function atualizaAria() {
    if (!el.editor) return;
    const med = ativa();
    if (!med || !med.cantos) return;
    if (!emBordas() || !med.linhas) return;
    const cp = cartaPx(med), res = med.res;
    const lr = res ? par(res.lr.usado) : null, tb = res ? par(res.tb.usado) : null;
    el.linhas.forEach((h) => {
      const tipo = h.dataset.tipo, lado = h.dataset.lado, L = med.linhas[tipo][lado], dim = VERT[lado] ? cp.w : cp.h;
      h.setAttribute("aria-valuemin", "0");
      h.setAttribute("aria-valuemax", String(Math.round(dim)));
      h.setAttribute("aria-valuenow", String(Math.round(L.c * dim)));
      const mm = res && res.mm ? res.mm[lado] : null, eixo = VERT[lado] ? lr : tb;
      h.setAttribute("aria-valuetext", t(VERT[lado] ? "cen.aria.valorLR" : "cen.aria.valorTB", {
        nome: t(`cen.aria.${tipo}.${lado}`), mm: ehNum(mm) ? num(mm, 2) : "—",
        a: eixo ? num(eixo[0]) : "—", b: eixo ? num(eixo[1]) : "—"
      }));
    });
  }
  // A região aria-live fala o resumo no FIM do gesto (ou 600 ms depois do
  // último ajuste), nunca a cada pixel.
  function anunciaDepois() {
    clearTimeout(ui.vivoTimer);
    ui.vivoTimer = setTimeout(() => {
      const med = ativa();
      if (!el.vivo || !med || !med.res || !emBordas()) return;
      const r = med.res, [a, b] = par(r.lr.usado), [c, d] = par(r.tb.usado);
      const g0 = listaG()[0], r0 = g0 ? avalia(g0.code) : null;
      let g = r0 ? `, ${g0.nome} ${notaCurta(r0)}` : "";
      if (r0 && r0.limita) g += `, ${t("cen.res.limita", { e: nomeEixo(r0.limita.eixo) })}`;
      el.vivo.textContent = t("cen.res.resumo", { lr: `${num(a)} ${t("cen.res.por")} ${num(b)}`, tb: `${num(c)} ${t("cen.res.por")} ${num(d)}` }) + g;
    }, 600);
  }

  // ── Resultado ────────────────────────────────────────────────────────────
  const listaG = () => (grad && Array.isArray(grad.lista) ? grad.lista : []).map(infoG).filter(Boolean);
  const maisG = () => (grad && Array.isArray(grad.mais) ? grad.mais : []).map(infoG).filter(Boolean);
  function infoG(g) { return typeof g === "string" ? { code: g, nome: g.toUpperCase() } : g && g.code ? g : null; }
  // Um lado medido, no formato que o TCGCenteringGraders lê: o "usado" com 1
  // casa (a nota é SEMPRE decidida por ele, nunca pelo inteiro exibido), o
  // meio pros limites de 50/50 e os mm pro "falta ≈ X mm".
  function medidaDe(med) {
    if (!med || !med.res || !med.res.lr || !med.res.tb) return null;
    const r = med.res;
    return {
      lr: arred1(r.lr.usado), tb: arred1(r.tb.usado),
      sigma: Math.max(ehNum(r.lr.sigma) ? r.lr.sigma : 0, ehNum(r.tb.sigma) ? r.tb.sigma : 0),
      meio: { lr: r.lr.meio, tb: r.tb.meio }, mm: r.mm || null
    };
  }
  function avalia(code) {
    if (!grad || typeof grad.avaliar !== "function") return null;
    try { return grad.avaliar(code, { f: medidaDe(sessao.lados.f), v: medidaDe(sessao.lados.v) }, { categoria: sessao.categoria }); } catch (e) { return null; }
  }
  const nomeEixo = (e) => (e === "lr" ? "L/R" : "T/B");
  const camel = (s) => String(s).replace(/-([a-z])/g, (m, c) => c.toUpperCase());
  // No limite, as duas pontas (X ± δ) podem ser "abaixo, sem número" (null):
  // a CGC em TCG com foto pobre dá { de: "3.5", ate: null } (o otimista cai
  // no "abaixo de 10 · sem número") e até { de: null, ate: null }. Ponta de
  // cima null não vira faixa ("3.5–null"): vale a nota nominal, e o "no
  // limite" segue no detalhe.
  const faixaNoLimite = (r) => !!(r.noLimite && r.noLimite.ate != null);
  function notaCurta(r) {
    if (faixaNoLimite(r)) {
      const { de, ate } = r.noLimite;
      return de == null ? `≤ ${ate}` : ate === de ? String(de) : `${de}–${ate}`;
    }
    if (r.nota != null) return String(r.nota);
    return r.abaixoDe ? `< ${r.abaixoDe}` : "—";
  }
  // "abaixo de 10 · sem número pra TCG", "8 (8.5 sem número)", "abaixo da
  // última nota com número".
  function notaTexto(x, code) {
    if (x.nota != null) {
      let s = String(x.nota);
      if (x.semNumero && x.semNumero.length) s += ` (${t("cen.res.semNumero", { n: x.semNumero.join(", ") })})`;
      return s;
    }
    if (x.abaixoSemNumero && x.abaixoDe) {
      const tcg = code === "cgc" && sessao.categoria !== "nao-esporte";
      return t(tcg ? "cen.res.abaixoTcg" : "cen.res.abaixoSem", { n: x.abaixoDe });
    }
    return t("cen.res.abaixoUltima");
  }
  function htmlGrader(g, r) {
    if (!r || r.semMedida) return `<li class="ctr-g"><span class="ctr-g-n">${esc(g.nome)}</span><span class="ctr-g-v">—</span></li>`;
    const limite = !!(r.noLimite || r.compat50);
    let valor;
    if (faixaNoLimite(r)) {
      valor = r.noLimite.de == null ? t("cen.res.noLimiteAbaixo", { n: r.noLimite.ate }) : `${r.noLimite.de}–${r.noLimite.ate}`;
    } else valor = notaTexto(r, g.code);
    const det = [];
    if (r.papel === "subnota") det.push(t("cen.res.subnota"));
    else if (r.papel === "componente") det.push(t("cen.res.componente"));
    if (limite) det.push(r.compat50 ? t("cen.res.compat50", { s: num(medidaSigma(), 1) }) : t("cen.res.noLimite"));
    if (r.limita) det.push(t(r.limita.lado === "v" ? "cen.res.limitaVerso" : "cen.res.limita", { e: nomeEixo(r.limita.eixo) }));
    // "o 10 pede ≤ 55: L/R 3,0 pt (≈ 0,17 mm) + T/B 2,0 pt (≈ 0,11 mm)" — de
    // CADA eixo e lado que falha, não só do que limita.
    // Agrupa por NOTA E LIMITE: a frente e o verso pedem limites diferentes
    // pra mesma nota (PSA 10: 55 na frente, 75 no verso), e um grupo só por
    // nota mostrava o limite da frente pros pontos do verso. Chave com "|"
    // (não inteira): a ordem de inserção se mantém.
    const grupos = {};
    (r.falta || []).forEach((f) => {
      const k = `${f.nota}|${typeof f.limite === "object" ? JSON.stringify(f.limite) : f.limite}`;
      (grupos[k] = grupos[k] || { n: f.nota, fs: [] }).fs.push(f);
    });
    Object.values(grupos).forEach(({ n, fs }) => {
      const l0 = fs[0].limite;
      const itens = fs.filter((f) => ehNum(f.pts)).map((f) => t(f.lado === "v" ? "cen.res.faltaVerso" : "cen.res.falta", {
        e: nomeEixo(f.eixo), p: num(f.pts, 1), mm: num(ehNum(f.mm) ? f.mm : mmFalta(f), 2)
      }));
      if (itens.length) det.push(`${t("cen.res.pede", { n, l: ehNum(l0) ? num(l0, Number.isInteger(l0) ? 0 : 1) : "—" })} ${itens.join(" + ")}`);
      else if (l0 === "borda") det.push(t("cen.res.pedeBorda", { n }));
    });
    if (r.folga) det.push(t("cen.res.folga", { n: r.folga }));
    if (r.divergem && r.leituras && r.leituras.length > 1) {
      det.push(r.leituras.map((l) => t(`cen.res.leitura.${camel(l.origem || "padrao")}`, { n: notaTexto(l, g.code) })).join(" · "));
    }
    if (r.verso === "nao-publicado") det.push(t("cen.res.versoNaoPub"));
    else if (r.verso === "igual-frente" || (r.ladoNaoEspecificado && r.verso === "nao-medido")) det.push(t("cen.res.versoIgual"));
    const rot = r.rot && !faixaNoLimite(r) ? ` <small>${esc(r.rot)}</small>` : "";
    return `<li class="ctr-g${limite ? " is-limite" : ""}${r.limita ? " is-limita" : ""}">
      <span class="ctr-g-n">${esc(g.nome)}</span>
      <span class="ctr-g-v">${esc(valor)}${rot}</span>
      ${det.length ? `<p class="ctr-g-d">${esc(det.join(" · "))}</p>` : ""}
    </li>`;
  }
  function medidaSigma() {
    const ms = ["f", "v"].map((k) => medidaDe(sessao.lados[k])).filter(Boolean);
    return ms.length ? Math.max(...ms.map((m) => m.sigma)) : 0;
  }
  // σ só do que é da FOTO (ajuste da reta, cantos, piso), sem a paralaxe: o
  // σ grande de uma foto sem dados de câmera (colada, print, scanner, "Foto
  // já reta") vem do pior caso de 20° e já tem o aviso de ângulo. Ele decide
  // o aviso de resolução E o número inteiro (§5.6); o "±" exibido segue o
  // total. Antes, toda imagem colada saía "57 · 43 ±1", nítida ou não.
  const sigmaFoto = (e) => {
    const p = e && e.partes;
    return p ? Math.sqrt((p.ajuste || 0) ** 2 + (p.canto || 0) ** 2 + (p.piso || 0) ** 2) : (e && e.sigma) || 0;
  };
  function mmFalta(f) {
    const med = sessao.lados[f.lado], mm = med && med.res && med.res.mm;
    if (!mm || !ehNum(f.pts)) return null;
    return (f.pts / 100) * (f.eixo === "lr" ? mm.l + mm.r : mm.t + mm.b);
  }
  function htmlEixo(k, med, eixo) {
    const r = med.res[eixo];
    if (!r || !ehNum(r.usado)) return "";
    // Foto pobre (σ da foto > 0,5): o número APARECE inteiro com "±", mas a
    // nota segue decidida pela 1 casa (§4.6) — o arredondamento do
    // concorrente não volta.
    const baixa = sigmaFoto(r) > 0.5, casas = baixa ? 0 : 1;
    let a, b;
    if (baixa) { a = Math.round(r.usado); b = 100 - a; } else [a, b] = par(r.usado);
    const lados = eixo === "lr" ? ["l", "r"] : ["t", "b"], mm = med.res.mm || {};
    const obs = [];
    if (ehNum(mm[lados[0]]) && ehNum(mm[lados[1]])) {
      obs.push(Math.abs(mm[lados[0]] - mm[lados[1]]) < 0.005 ? t("cen.res.centrado") : t(`cen.res.grosso.${mm[lados[0]] > mm[lados[1]] ? lados[0] : lados[1]}`));
    }
    // Pior ponto × meio: os dois aparecem quando diferem.
    if (ehNum(r.pior) && ehNum(r.meio) && Math.abs(arred1(r.pior) - arred1(r.meio)) >= 0.1) {
      obs.push(t(r.decide === "pior" || r.usado === r.pior ? "cen.res.piorDecide" : "cen.res.piorDentro", { p: num(arred1(r.pior)) }));
    }
    const lim = ui.limita && ui.limita.lado === k && ui.limita.eixo === eixo;
    return `<div class="ctr-eixo${lim ? " is-limita" : ""}">
      <span class="ctr-eixo-n">${nomeEixo(eixo)}</span>
      <span class="ctr-eixo-v">${esc(t(`cen.res.${lados[0]}`))} <strong>${esc(num(a, casas))}</strong> · ${esc(t(`cen.res.${lados[1]}`))} <strong>${esc(num(b, casas))}</strong></span>
      <span class="ctr-sigma">±${esc(num(r.sigma, casas))}</span>
      ${lim ? `<span class="ctr-eixo-lim">${esc(t("cen.res.limitaCurto"))}</span>` : ""}
      ${obs.length ? `<p class="ctr-eixo-obs">${esc(obs.join(" · "))}</p>` : ""}
    </div>`;
  }
  function htmlLado(k, vivo) {
    const med = sessao.lados[k], nome = t(`cen.lado.${k}`);
    if (!med || !med.res) {
      if (k === "f") return `<p class="ctr-res-vazio">${esc(t("cen.res.vazio"))}</p>`;
      return `<div class="ctr-res-verso"><p>${esc(t("cen.res.versoNao"))}</p>${vivo ? `<button type="button" class="lst-mini ctr-b" data-ctr-acao="medir-v" data-ctr-foco="medir-v">${IC.camera}<span>${esc(t("cen.ctl.medirVerso"))}</span></button>` : ""}</div>`;
    }
    const ang = med.pose != null ? t("cen.res.anguloFoto", { g: num(med.pose, 0) }) : t("cen.res.anguloDesc");
    return `<section class="ctr-res-lado">
      <h4>${esc(nome)} <span>${esc(ang)}${med.blob ? "" : ` · ${esc(t("cen.res.semFoto"))}`}</span></h4>
      ${htmlEixo(k, med, "lr")}${htmlEixo(k, med, "tb")}
    </section>`;
  }
  function avisos(vivo) {
    const out = [];
    ["f", "v"].forEach((k) => {
      const med = sessao.lados[k];
      if (!med || !med.res) return;
      const pre = sessao.lados.f && sessao.lados.v && sessao.lados.f.res && sessao.lados.v.res ? `${t(`cen.lado.${k}`)}: ` : "";
      const r = med.res;
      // Aviso de RESOLUÇÃO só pelo que é da foto (ver sigmaFoto): chamar a
      // paralaxe de "pouca resolução" mandaria a pessoa chegar mais perto à toa.
      const sg = Math.max(sigmaFoto(r.lr), sigmaFoto(r.tb));
      if (sg > 0.5) out.push(pre + t("cen.aviso.resolucao", { s: num(sg, sg < 1 ? 1 : 0) }));
      else if (ehNum(r.bordaPx) && r.bordaPx < 12) out.push(pre + t("cen.aviso.bordaFina"));
      if (med.pose != null && med.pose > 10) out.push(pre + t("cen.aviso.angulo", { g: num(med.pose, 0), s: num(r.sigmaParalaxe || 0, 1) }));
      else if (med.pose == null && med.blob) out.push(pre + t("cen.aviso.anguloDesc"));
      if (vivo && k === sessao.ladoAtivo) out.push(...avisosConfere(med));
      if (med.linhas && med.origem && LADOS.some((l) => med.origem.int[l] !== "manual") && LADOS.some((l) => med.origem.ext[l] !== "manual")) {
        const d = anguloLinhas(med.linhas.int) - anguloLinhas(med.linhas.ext);
        if (Math.abs(d) > 0.15) out.push(pre + t("cen.aviso.giroRel", { g: num(Math.abs(d), 1) }));
      }
    });
    if (vivo && ui.sugereGuiado && ui.modo !== "pc") out.push(t("cen.aviso.guiado"));
    return out;
  }
  // "Confira a moldura em cima e embaixo: a sugestão pode errar em arte
  // clara." (lados de moldura FRACA) e o "não achei a moldura" (lados sem
  // moldura achada) — no passo Bordas e na lista do resultado.
  function onde(lados) {
    const xs = lados.map((l) => t(`cen.onde.${l}`));
    return xs.length > 1 ? `${xs.slice(0, -1).join(", ")}${t("cen.onde.e")}${xs[xs.length - 1]}` : xs.join("");
  }
  function avisosConfere(med) {
    const out = [];
    if (!med || !med.linhas || !Array.isArray(med.confere) || !med.confere.length) return out;
    const fracas = GUIA.filter((l) => med.confere.includes(l) && (med.fraca || []).includes(l));
    const sem = GUIA.filter((l) => med.confere.includes(l) && !fracas.includes(l));
    if (fracas.length) out.push(t("cen.aviso.confereClara", { l: onde(fracas) }));
    if (sem.length) out.push(t("cen.aviso.confere", { l: sem.map((l) => t(`cen.ladoNome.${l}`).toLowerCase()).join(", ") }));
    return out;
  }
  function htmlResultado(vivo) {
    const gs = listaG(), rs = gs.map((g) => avalia(g.code));
    const lim = rs.find((r) => r && r.limita);
    ui.limita = lim ? lim.limita : null;
    const algum = ["f", "v"].some((k) => sessao.lados[k] && sessao.lados[k].res);
    // data-ctr-foco: o pintaResultado devolve o foco ao título redesenhado (o
    // aplicaPasso do passo 3 foca o h3 e o quadro seguinte troca o innerHTML).
    let h = vivo ? `<h3 class="ctr-res-t" tabindex="-1" data-ctr-foco="titulo">${esc(t("cen.res.titulo"))}</h3>` : "";
    h += algum ? htmlLado("f", vivo) + htmlLado("v", vivo) : `<p class="ctr-res-vazio">${esc(t("cen.res.vazio"))}</p>`;
    if (algum) {
      const av = avisos(vivo);
      if (av.length) h += `<ul class="ctr-avisos">${av.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>`;
      if (gs.length) h += `<ul class="ctr-gs">${gs.map((g, i) => htmlGrader(g, rs[i])).join("")}</ul>`;
      else h += `<p class="ctr-nota-p">${esc(t("cen.tab.semDados"))}</p>`;
      if (gs.some((g) => g.code === "cgc")) {
        h += `<div class="ctr-cgc"><span>${esc(t("cen.res.cgcTipo"))}</span><div class="ctr-seg" role="group" aria-label="${escA(t("cen.res.cgcTipo"))}">
          ${["tcg", "nao-esporte"].map((c) => `<button type="button" data-ctr-acao="cgc" data-cat="${c}" data-ctr-foco="cgc-${c}" aria-pressed="${sessao.categoria === c}">${esc(t(`cen.res.cgc.${camel(c)}`))}</button>`).join("")}
        </div></div>`;
      }
      const mais = maisG();
      if (mais.length) {
        h += `<details class="ctr-mais"${ui.maisAberto ? " open" : ""}><summary data-ctr-foco="mais">${esc(t("cen.res.mais"))}</summary>
          <p class="ctr-nota-p">${esc(t("cen.res.maisNota"))}</p>
          <ul>${mais.map((g) => `<li><strong>${esc(g.nome)}</strong> ${esc(resumoCriterio(g.code))}</li>`).join("")}</ul>
          <button type="button" class="lst-mini" data-ctr-rola="ctrCriterios">${esc(t("cen.res.verTabela"))}</button>
        </details>`;
      }
    }
    h += `<p class="fer-fine ctr-fim">${esc(t("cen.res.estimativa"))}</p>`;
    return h;
  }
  // "10: 60/40 · 9: 65/35 · 8: 70/30" — as 3 primeiras notas com número da frente.
  function resumoCriterio(code) {
    if (!grad || typeof grad.tabela !== "function") return "";
    // ARS: sem tabela de propósito (a centralização não entra na nota); "não
    // publicado" diria o contrário do que a graduadora publica.
    const g = typeof grad.acha === "function" ? grad.acha(code) : null;
    if (g && g.papel === "nenhum") return "· " + t("cen.tab.naoConta");
    let rows = [];
    try { rows = grad.tabela(code, "f", { categoria: sessao.categoria }) || []; } catch (e) { rows = []; }
    const com = rows.filter((r) => r.limite != null && r.limite !== "igual").slice(0, 3);
    if (!com.length) return "· " + t("cen.tab.naoPublicado");
    return "· " + com.map((r) => `${r.nota}: ${limTxt(r.limite)}`).join(" · ");
  }
  function pintaResultado() {
    if (el.res && ui.aberto) {
      const foco = document.activeElement && el.res.contains(document.activeElement) ? document.activeElement.getAttribute("data-ctr-foco") : null;
      el.res.innerHTML = htmlResultado(true);
      if (foco) { const f = el.res.querySelector(`[data-ctr-foco="${foco}"]`); if (f) f.focus({ preventScroll: true }); }
      pintaMini();
    }
    if (el.salvo && !ui.aberto) pintaSalvo();
  }
  function pintaMini() {
    if (!el.mini) return;
    const med = ativa();
    if (!med || !med.res) { el.mini.textContent = t("cen.res.vazio"); return; }
    const r = med.res, [a, b] = par(r.lr.usado), [c, d] = par(r.tb.usado), g0 = listaG()[0], r0 = g0 ? avalia(g0.code) : null;
    el.mini.textContent = `L/R ${num(a)}/${num(b)} · T/B ${num(c)}/${num(d)}${r0 ? ` · ${g0.nome} ${notaCurta(r0)}` : ""}`;
  }

  // ── Tabela de critérios (conteúdo indexável abaixo da ferramenta) ────────
  function limTxt(lim) {
    if (ehNum(lim)) {
      const c = Number.isInteger(lim) ? 0 : Number.isInteger(lim * 10) ? 1 : 2;
      return `${num(lim, c)}/${num(100 - lim, c)}`;
    }
    if (lim === "qualquer") return t("cen.tab.qualquer");
    if (lim === "borda") return t("cen.tab.borda");
    if (lim === "igual") return t("cen.tab.igual");
    if (lim && typeof lim === "object" && ehNum(lim.melhor) && ehNum(lim.pior)) return t("cen.tab.cruzada", { a: limTxt(lim.melhor), b: limTxt(lim.pior) });
    return t("cen.tab.naoPublicado");
  }
  function celula(r) {
    const obs = Array.isArray(r.obs) ? r.obs : [];
    let txt;
    if (obs.includes("inter")) txt = t("cen.tab.semNumero");
    else if (r.limite == null) txt = r.herdaDe && r.limiteEfetivo != null ? t("cen.tab.herda", { n: r.herdaDe, l: limTxt(r.limiteEfetivo) }) : t("cen.tab.naoPublicado");
    else txt = (obs.includes("aprox") && ehNum(r.limite) ? "~" : "") + (obs.includes("estrito") ? "< " : "") + limTxt(r.limite);
    const extra = [];
    if (obs.includes("so-nao-esporte")) extra.push(t("cen.obs.soNaoEsporte"));
    if (obs.includes("como-publicado") && r.publicado) extra.push(t("cen.obs.comoPublicado", { p: String(r.publicado) }));
    Object.keys(r.variantes || {}).forEach((k) => { extra.push(t("cen.obs.variante", { p: k === "scale" ? "/grading/scale" : k, l: limTxt(r.variantes[k]) })); });
    return `<span class="ctr-lim">${esc(txt)}</span>${r.rot ? `<span class="ctr-rot">${esc(r.rot)}</span>` : ""}${extra.map((x) => `<span class="ctr-obs">${esc(x)}</span>`).join("")}`;
  }
  const urlDe = (s) => (String(s).match(/https?:\/\/[^\s)]+/) || [])[0] || null;
  function dataLocal(iso) {
    if (!iso) return "";
    try { return new Date(iso + "T12:00:00").toLocaleDateString(shared.getLocale ? shared.getLocale() : undefined); } catch (e) { return iso; }
  }
  function fonteHtml(g) {
    const fontes = (g.fontes || []).map((f) => {
      const u = urlDe(f);
      if (!u) return esc(f);
      let rotulo = u.replace(/^https?:\/\/(www\.)?/, "");
      if (/wayback/i.test(f)) rotulo += " (Wayback)";
      return `<a href="${escA(u)}" target="_blank" rel="noopener noreferrer">${esc(rotulo)}</a>`;
    });
    const partes = [fontes.join(", ")];
    if (g.conferido) partes.push(esc(t("cen.tab.conferido", { d: dataLocal(g.conferido) })));
    if (g.confianca) partes.push(esc(t(`cen.tab.confianca.${g.confianca}`)));
    return `<li><strong>${esc(g.nome)}</strong> · ${partes.join(" · ")}</li>`;
  }
  function pintaTabela() {
    const host = document.getElementById("ctrTabela");
    if (!host) return;
    if (!grad || typeof grad.tabela !== "function") { host.innerHTML = `<p class="ctr-nota-p">${esc(t("cen.tab.semDados"))}</p>`; return; }
    const lado = ui.tabLado, gs = listaG();
    const linhasDe = (code) => { try { return grad.tabela(code, lado, { categoria: sessao.categoria }) || []; } catch (e) { return []; } };
    const tabs = gs.map((g) => linhasDe(g.code));
    const notas = ORDEM_NOTAS.filter((n) => tabs.some((rows) => rows.some((r) => String(r.nota) === n)));
    tabs.forEach((rows) => rows.forEach((r) => { if (!notas.includes(String(r.nota))) notas.push(String(r.nota)); }));
    let h = `<div class="ctr-tab-rola" tabindex="0" role="region" aria-label="${escA(t("cen.tab.titulo"))}"><table class="ctr-tab"><thead><tr><th scope="col">${esc(t("cen.tab.nota"))}</th>${gs.map((g) => `<th scope="col">${esc(g.nome)}</th>`).join("")}</tr></thead><tbody>`;
    notas.forEach((n) => {
      h += `<tr><th scope="row">${esc(n)}</th>`;
      tabs.forEach((rows) => { const r = rows.find((x) => String(x.nota) === n); h += `<td>${r ? celula(r) : ""}</td>`; });
      h += "</tr>";
    });
    h += "</tbody></table></div>";
    const temIgual = tabs.some((rows) => rows.some((r) => (r.obs || []).includes("lado-nao-especificado")));
    const notasRodape = [];
    if (temIgual) notasRodape.push(t("cen.tab.notaIgual"));
    if (gs.some((g) => g.code === "psa") && lado === "f") notasRodape.push(t("cen.tab.notaFolga"));
    if (gs.some((g) => g.code === "bgs")) notasRodape.push(t("cen.tab.notaBgs"));
    if (gs.some((g) => g.code === "cgc")) notasRodape.push(t(sessao.categoria === "nao-esporte" ? "cen.tab.notaCgcNao" : "cen.tab.notaCgc"));
    if (notasRodape.length) h += `<ul class="ctr-tab-notas">${notasRodape.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
    h += `<h3 class="ctr-tab-sub">${esc(t("cen.tab.fontes"))}</h3><ul class="ctr-fontes">${gs.map(fonteHtml).join("")}</ul>`;
    const mais = maisG();
    if (mais.length) {
      h += `<h3 class="ctr-tab-sub">${esc(t("cen.tab.mais"))}</h3><p class="ctr-nota-p">${esc(t("cen.res.maisNota"))}</p><div class="ctr-mais-grade">`;
      mais.forEach((g) => {
        const f = (() => { try { return grad.tabela(g.code, "f", {}) || []; } catch (e) { return []; } })();
        const v = (() => { try { return grad.tabela(g.code, "v", {}) || []; } catch (e) { return []; } })();
        if (!f.length) {
          // Sem linha nenhuma (ARS): a frase no lugar de uma tabela vazia.
          h += `<div class="ctr-mais-g"><h4>${esc(g.nome)}</h4><p class="ctr-nota-p">${esc(g.papel === "nenhum" ? t("cen.tab.naoConta") : t("cen.tab.naoPublicado"))}</p><ul class="ctr-fontes">${fonteHtml(g)}</ul></div>`;
          return;
        }
        h += `<div class="ctr-mais-g"><h4>${esc(g.nome)}</h4><table class="ctr-tab ctr-tab-p"><thead><tr><th scope="col">${esc(t("cen.tab.nota"))}</th><th scope="col">${esc(t("cen.tab.frente"))}</th><th scope="col">${esc(t("cen.tab.verso"))}</th></tr></thead><tbody>`;
        f.forEach((r, i) => { const rv = v[i] && String(v[i].nota) === String(r.nota) ? v[i] : v.find((x) => String(x.nota) === String(r.nota)); h += `<tr><th scope="row">${esc(r.nota)}</th><td>${celula(r)}</td><td>${rv ? celula(rv) : ""}</td></tr>`; });
        h += `</tbody></table><ul class="ctr-fontes">${fonteHtml(g)}</ul></div>`;
      });
      h += "</div>";
    }
    host.innerHTML = h;
    document.querySelectorAll('[data-ctr-acao="tab"]').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lado === lado)));
  }

  // ── Página: entrada e resultado guardado ─────────────────────────────────
  function pintaEntrada() {
    const comFoto = ["f", "v"].some((k) => sessao.lados[k] && sessao.lados[k].blob);
    const doVerso = sessao.ladoAtivo === "v";
    el.entradaLado.hidden = !(doVerso || sessao.lados.f || sessao.lados.v);
    el.entradaLado.textContent = t(doVerso ? "cen.entrada.ladoV" : "cen.entrada.ladoF");
    el.continuar.hidden = !comFoto;
    const algumRes = ["f", "v"].some((k) => sessao.lados[k] && sessao.lados[k].res);
    el.salvo.hidden = !algumRes;
    if (algumRes) pintaSalvo();
    vigiaSincronia();
  }
  function pintaSalvo() {
    if (!el.salvo || el.salvo.hidden) return;
    el.salvo.innerHTML = `<div class="fer-card ctr-salvo-card">
      <div class="ctr-salvo-cab"><h2>${esc(t("cen.salvo.titulo"))}</h2><button type="button" class="lst-mini ctr-b" data-ctr-acao="limpar">${esc(t("cen.ctl.limpar"))}</button></div>
      <div class="ctr-res">${htmlResultado(false)}</div>
    </div>`;
  }
  function limpaTudo() {
    ["f", "v"].forEach((k) => { liberaPixels(sessao.lados[k]); sessao.lados[k] = null; });
    if (ui.anterior) { liberaPixels(ui.anterior.med); ui.anterior = null; }
    sessao.ladoAtivo = "f";
    try { sessionStorage.removeItem(CHAVE); } catch (e) { /* idem */ }
    msg("");
    ocupado();
    pintaEntrada();
  }
  function continuar() {
    let med = ativa();
    if (!med || !med.blob) {
      const outro = outroLado(sessao.ladoAtivo);
      if (sessao.lados[outro] && sessao.lados[outro].blob) { sessao.ladoAtivo = outro; med = ativa(); }
    }
    if (!med || !med.blob) return;
    irPara(med.linhas ? "bordas" : "angulo");
  }
  function rola(id) {
    const alvo = document.getElementById(id);
    if (!alvo) return;
    // Botão que rola por JS, nunca âncora com "#…": numa página com <base> a âncora
    // levaria pra /#…, a home (o mesmo bug que o skip-link já teve).
    const ir = () => {
      alvo.scrollIntoView({ block: "start", behavior: reduzMov() ? "auto" : "smooth" });
      const h = alvo.querySelector("h2");
      if (h) { if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
    };
    if (ui.aberto && ui.modo !== "pc") { irPara("entrada"); setTimeout(ir, 60); } else ir();
  }

  // ── Cliques, campos e eventos da página ──────────────────────────────────
  function onClick(ev) {
    // Click que nasce de um arrasto (ver onUp): engolido. Só o que vem LOGO
    // depois do arrasto e sem um toque novo no meio (o pointerdown seguinte
    // limpa a marca): um "Endireitar" de verdade, logo após soltar o último
    // canto, não pode sumir.
    if (ui.engoleClick && Date.now() - ui.engoleClick < 400) { ui.engoleClick = 0; ev.preventDefault(); ev.stopPropagation(); return; }
    ui.engoleClick = 0;
    const b = ev.target.closest && ev.target.closest("[data-ctr-acao], [data-ctr-rola]");
    if (!b || b.disabled) {
      if (ui.menu && !(ev.target.closest && ev.target.closest(".ctr-menu"))) fechaPops();
      return;
    }
    if (b.dataset.ctrRola) { rola(b.dataset.ctrRola); return; }
    const a = b.dataset.ctrAcao, med = ativa();
    if (a !== "menu" && a !== "atalhos") fechaPops();
    switch (a) {
      case "camera":
        if (vigiaSincronia()) return;
        // Antes de abrir a câmera nativa: no Android ela pode MATAR a aba, e
        // na volta a página diz o que houve (§5.3).
        try { sessionStorage.setItem(CAMERA, "1"); } catch (e) { /* idem */ }
        el.inCamera.value = "";
        el.inCamera.click();
        break;
      case "galeria": if (!vigiaSincronia()) { el.inGaleria.value = ""; el.inGaleria.click(); } break;
      case "colar": if (!vigiaSincronia()) colarDoBotao(); break;
      case "continuar": continuar(); break;
      case "limpar": limpaTudo(); break;
      case "voltar": recua(); break;
      case "fechar": irPara("entrada"); break;
      case "lado": trocaLado(b.dataset.lado); break;
      case "passo":
        if (b.dataset.p === "angulo") irPara("angulo");
        else if (b.dataset.p === "bordas") { if (ui.passo === "angulo") endireitar(); else irPara("bordas"); }
        else irPara("resultado");
        break;
      case "desfazer": desfazer(false); break;
      case "refazer": desfazer(true); break;
      case "atalhos": alternaAtalhos(); break;
      case "menu": alternaMenu(); break;
      case "nova": irPara("entrada"); break;
      case "ajuda": rola("ctrComo"); break;
      case "girar": girar(); break;
      case "jareta": jaReta(); break;
      case "resugere": resugere(); break;
      case "endireitar": endireitar(); break;
      case "cantos": irPara("angulo"); break;
      case "ima":
        sessao.ima = !sessao.ima;
        salva();
        marca("ctl");
        break;
      case "sel-lado": escolhe(ui.sel.tipo, b.dataset.lado, false); break;
      case "sel-tipo": escolhe(b.dataset.tipo, ui.sel.lado, false); break;
      case "conferir": ui.guiado = Math.max(0, GUIA.indexOf((med && med.confere && med.confere[0]) || "l")); ui.sugereGuiado = false; irPara("guiado"); break;
      case "guia-ant": guiaPasso(-1); break;
      case "guia-prox": guiaPasso(1); break;
      case "giro0": if (med) gira(0); break;
      case "zoom+": zoomEm(1.5, ui.tam.w / 2, ui.tam.h / 2); break;
      case "zoom-": zoomEm(1 / 1.5, ui.tam.w / 2, ui.tam.h / 2); break;
      case "ajustar": if (med) { if (ui.passo === "angulo") ajustaA(med); else ajustaB(); mudouVista(); marca("b"); } break;
      case "folha": alternaFolha(); break;
      case "medir-v": trocaLado("v"); break;
      case "cgc":
        sessao.categoria = b.dataset.cat === "nao-esporte" ? "nao-esporte" : "tcg";
        salva();
        marca("res");
        pintaTabela();
        if (!ui.aberto) pintaSalvo();
        break;
      case "tab": ui.tabLado = b.dataset.lado === "v" ? "v" : "f"; pintaTabela(); break;
      default: break;
    }
  }
  function onCampo(ev) {
    const c = ev.target.closest && ev.target.closest("[data-ctr-campo]");
    if (!c) return;
    const k = c.dataset.ctrCampo;
    if (k === "giro") { if (ev.type === "input") gira(parseFloat(c.value) || 0); return; }
    if (ev.type !== "change") return;
    if (k === "preset") trocaPreset(c.value);
    else if (k === "W" || k === "H") {
      const v = parseFloat(String(c.value).replace(",", "."));
      if (!(v >= 20 && v <= 200)) { c.value = String(sessao.custom[k]); return; }
      sessao.custom = Object.assign({}, sessao.custom, { [k]: v });
      trocaPreset("personalizado");
    }
  }
  function onArquivo(ev) {
    const inp = ev.target;
    const f = inp.files && inp.files[0];
    try { sessionStorage.removeItem(CAMERA); } catch (e) { /* idem */ }
    if (f) recebeArquivo(f, f.name);
  }
  function onColar(ev) {
    const alvo = ev.target;
    if (alvo && alvo.closest && alvo.closest("input, textarea, [contenteditable]")) return;
    const dt = ev.clipboardData;
    if (!dt) return;
    const f = [...(dt.files || [])].find((x) => /^image\//.test(x.type));
    if (f) { ev.preventDefault(); recebeArquivo(f, f.name || "colada"); return; }
    const txt = dt.getData ? dt.getData("text/plain") : "";
    if (txt && /^https?:\/\//i.test(txt.trim())) { ev.preventDefault(); msg(t("cen.erro.url")); }
  }
  const temArquivo = (ev) => { const ty = ev.dataTransfer && ev.dataTransfer.types; return !!ty && [...ty].some((x) => x === "Files" || x === "text/uri-list"); };

  function liberaTudo() {
    ["f", "v"].forEach((k) => liberaPixels(sessao.lados[k]));
    if (ui.anterior) liberaPixels(ui.anterior.med);
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls.clear();
    [el.telaA, el.telaB, el.lupaPc, el.lupaCel].forEach((c) => { if (c) c.width = c.height = 0; });
    document.documentElement.removeAttribute("data-ocupado");
    if (el.editor) imersivo(false);
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  function iniciar() {
    Object.assign(el, {
      entrada: document.getElementById("ctrEntrada"), drop: document.getElementById("ctrDrop"),
      msg: document.getElementById("ctrMsg"), status: document.getElementById("ctrStatus"), sinc: document.getElementById("ctrSinc"),
      salvo: document.getElementById("ctrSalvo"),
      entradaLado: document.getElementById("ctrEntradaLado"), continuar: app.querySelector('[data-ctr-acao="continuar"]'),
      inCamera: document.getElementById("ctrInCamera"), inGaleria: document.getElementById("ctrInGaleria")
    });
    if (!el.entrada || !el.msg || !el.salvo || !el.inCamera || !el.inGaleria) return;
    el.entradaBtns = [...el.entrada.querySelectorAll('[data-ctr-acao="camera"], [data-ctr-acao="galeria"], [data-ctr-acao="colar"]')];

    // Tirar foto só no celular (ponteiro grosso): no Android o capture abre a
    // câmera DIRETO, sem galeria — por isso são dois botões.
    const cam = el.entrada.querySelector('[data-ctr-acao="camera"]');
    const gal = el.entrada.querySelector('[data-ctr-acao="galeria"] span');
    const colar = el.entrada.querySelector('[data-ctr-acao="colar"]');
    if (toque()) {
      // No celular não se arrasta arquivo nem se cola com Ctrl+V: o título da
      // caixa vira o convite pra foto.
      const tit = el.entrada.querySelector(".ctr-drop-t");
      if (cam) cam.hidden = false;
      if (gal) gal.textContent = t("cen.entrada.galeria");
      if (tit) tit.textContent = t("cen.entrada.tituloToque");
      el.entrada.classList.add("is-toque");
    }
    if (colar) colar.hidden = !(navigator.clipboard && typeof navigator.clipboard.read === "function");

    el.inCamera.addEventListener("change", onArquivo);
    el.inGaleria.addEventListener("change", onArquivo);
    el.inCamera.addEventListener("cancel", () => { try { sessionStorage.removeItem(CAMERA); } catch (e) { /* idem */ } });
    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerdown", (ev) => { if (!el.palco || !el.palco.contains(ev.target)) ui.engoleClick = 0; }, true);
    document.addEventListener("change", onCampo);
    document.addEventListener("input", onCampo);
    document.addEventListener("keydown", onTecla);
    document.addEventListener("keyup", (ev) => { if (ev.key === " ") { ui.espaco = false; if (el.palco) el.palco.classList.remove("is-mao"); } });
    document.addEventListener("paste", onColar);
    document.addEventListener("dragover", (ev) => { if (!temArquivo(ev)) return; ev.preventDefault(); if (el.drop) el.drop.classList.add("is-sobre"); });
    document.addEventListener("dragleave", (ev) => { if (!ev.relatedTarget && el.drop) el.drop.classList.remove("is-sobre"); });
    document.addEventListener("drop", (ev) => {
      if (el.drop) el.drop.classList.remove("is-sobre");
      const dt = ev.dataTransfer;
      if (!dt || !temArquivo(ev)) return;
      // O dragover já aceitou (temArquivo): sem cancelar aqui, o navegador
      // ABRE o arquivo — o Firefox e o Safari na própria aba, e a foto que só
      // vivia em memória some. Um PDF (ou uma imagem com type vazio) cai no
      // recebeArquivo, que confere pela extensão e diz o que houve.
      ev.preventDefault();
      const arqs = [...(dt.files || [])];
      const f = arqs.find((x) => /^image\//.test(x.type) || /\.hei[cf]$/i.test(x.name)) || arqs[0];
      if (f) { recebeArquivo(f, f.name); return; }
      // Imagem arrastada de outra aba chega como URL: com a CSP atual não dá
      // pra buscar (e a foto passaria pelo servidor de alguém). Pede o colar.
      if ([...dt.types].some((x) => x === "text/uri-list")) msg(t("cen.erro.url"));
    });
    window.addEventListener("popstate", onPop);
    window.addEventListener("resize", debounce(() => { if (ui.aberto) arrumaLayout(); }, 120));
    // Voltou da câmera com a aba viva: a marca não serve mais.
    const aba = () => { if (document.visibilityState === "visible") { try { sessionStorage.removeItem(CAMERA); } catch (e) { /* idem */ } } };
    window.addEventListener("focus", aba);
    document.addEventListener("visibilitychange", aba);
    window.addEventListener("pagehide", (ev) => { if (!ev.persisted) liberaTudo(); });

    let camPerdida = false;
    try { camPerdida = sessionStorage.getItem(CAMERA) === "1"; sessionStorage.removeItem(CAMERA); } catch (e) { /* idem */ }
    const restaurou = restauraSessao();
    // O passo vive no histórico; a foto, não. Recarregar no meio cai na
    // entrada, com os números guardados e o aviso. A entrada atual vira a
    // "entrada" DESTA carga (com o lado restaurado); as de uma carga anterior
    // que ficaram atrás valem "entrada" no onPop (ver CARGA).
    try { history.replaceState({ ctr: "entrada", lado: sessao.ladoAtivo, carga: CARGA }, "", urlAtual()); } catch (e) { /* idem */ }
    ui.pilha = [chave("entrada")];
    // O toast nasce vazio e fica na árvore (ver msg); o editor imersivo o puxa
    // pra dentro dele.
    el.toast = document.createElement("div");
    el.toast.className = "ctr-toast";
    el.toast.setAttribute("role", "status");
    document.body.appendChild(el.toast);
    const avisos0 = [];
    if (camPerdida) avisos0.push(t("cen.camPerdida"));
    if (restaurou) avisos0.push(t("cen.descartada"));
    if (avisos0.length) msg(avisos0.join(" "));
    if (!grad || !tem("squareToQuad", "aplica", "medir")) msg(t("cen.erro.semCore"));
    pintaEntrada();
    pintaTabela();
    // O pull da nuvem do boot pode começar depois deste script: vigia por um tempo.
    let n = 0;
    const vigia = () => { vigiaSincronia(); if (++n < 30 || ui.sincronizando) setTimeout(vigia, 500); };
    vigia();
  }

  iniciar();
  window.TCGCentering = { versao: 2 };
})();
