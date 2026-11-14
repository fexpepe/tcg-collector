// Padrão dos logos (de jogo e de set): os NÚMEROS e as contas, num lugar só.
// Quem usa: scripts/check-logos.mjs (confere no CI), scripts/normaliza-logo.mjs
// (gera o arquivo no padrão) e o caçador de logos de set. O texto do padrão,
// com o porquê de cada número, está em docs/LOGOS.md.
//
// Sem sharp aqui: as funções puras leem o cabeçalho do arquivo e contam pixel
// num RGBA cru que quem chama já decodificou. Assim o teste roda no CI sem
// instalar nada (tests/logo-padrao.test.mjs).
//
// A régua (2026-11-14): um logo tem de ficar NÍTIDO em tela de alta densidade
// (retina, 4K com escala, celular de 3×) em TODO lugar onde aparece, e LEVE.
// Densidade = pixels do arquivo por pixel CSS, no lugar onde o logo aparece:
//   ≥ 2    nítido em qualquer tela (é o que o normalizador entrega quando a
//          fonte deixa);
//   1,5–2  macio só em tela retina de perto (o navegador estica até 33%):
//          aviso, não barra;
//   < 1,5  borrado em tela retina: erro (ou exceção com o motivo).
// Leve = nunca maior que o lugar mais exigente pede (o teto) e com peso
// máximo por arquivo. Os lugares foram medidos no sleevu.app em 390, 1440 e
// 2560 px de largura (getBoundingClientRect + object-fit: contain).
import { limpaAlfa, encaixa } from "./logos-set.mjs";

// ── Onde cada logo aparece ──────────────────────────────────────────────────
// `css(r)` devolve a LARGURA pintada em px CSS de um logo de proporção r
// (largura/altura) naquele lugar. `dpr` é a densidade da tela mais exigente
// daquele lugar — 2 no desktop (retina, 4K a 200%), 3 no celular — e é dela
// que sai o teto (css × dpr). Caixa simples = `object-fit: contain` em W×H.
const caixa = (W, H) => (r) => Math.min(W, H * r);

export const LUGARES = {
  jogo: [
    // .hub-logo fora do celular: o tamanho sai da proporção (equilíbrio óptico,
    // ver o comentário no styles.css). 308 = conteúdo do tile mais largo
    // (348 − 2×20), 122 = altura útil, K = 165.
    { nome: "hub (desktop)", dpr: 2, css: (r) => Math.min(308, 122 * r, 165 * r ** 0.4) },
    { nome: "hub (celular)", dpr: 3, css: caixa(150, 86) },
    { nome: "/games", dpr: 2, css: caixa(204, 56) }
  ],
  // Jogo vintage (vintage no functions/_lib/jogos.js) aparece também na página
  // /vintage e no "Sobre" do topo da página do jogo — o maior lugar de todos.
  jogoVintage: [
    { nome: "/vintage (desktop)", dpr: 2, css: caixa(185, 92) },
    { nome: "/vintage (celular)", dpr: 3, css: caixa(146, 72) },
    { nome: "\"Sobre\" (desktop)", dpr: 2, css: caixa(385, 156) },
    { nome: "\"Sobre\" (celular)", dpr: 3, css: caixa(300, 84) }
  ],
  set: [
    { nome: "chip do set (desktop)", dpr: 2, css: caixa(176, 74) },
    { nome: "chip do set (celular)", dpr: 3, css: caixa(123, 60) },
    { nome: "página do set (desktop)", dpr: 2, css: caixa(253, 80) },
    { nome: "página do set (celular)", dpr: 3, css: caixa(220, 80) },
    // A vitrine do topo mostra o set MAIS NOVO — justamente o do logo que
    // acabou de entrar. Por isso conta no piso e não só no ideal.
    { nome: "vitrine do topo (desktop)", dpr: 2, css: caixa(385, 156) },
    { nome: "vitrine do topo (celular)", dpr: 3, css: caixa(300, 96) }
  ],
  simbolo: [
    { nome: "símbolo do set", dpr: 3, css: caixa(34, 34) }
  ]
};

// ── Os números do padrão ────────────────────────────────────────────────────
// teto: o arquivo CABE nesta caixa (nunca maior). É o maior css × dpr dos
//   lugares do tipo, arredondado pra cima (tests/logo-padrao.test.mjs refaz a
//   conta). Passar disso é peso que nenhuma tela mostra.
// pesoKB: teto de bytes por arquivo. Medido em 2026-11-14 com os 413 logos do
//   repo regravados no teto (WebP q90 ou sem perda, o menor): set com mediana
//   de 23 KB e 95% abaixo de 54 KB; jogo com mediana de 29 KB e 95% abaixo de
//   52 KB. O que passa disso é textura (purpurina do Lorcana 1, brilho do
//   OP-17): o normalizador baixa a qualidade até caber.
export const PADRAO = {
  jogo: { teto: [640, 260], pesoKB: 60 },
  jogoVintage: { teto: [960, 320], pesoKB: 80 },
  set: { teto: [960, 320], pesoKB: 60 },
  simbolo: { teto: [128, 128], pesoKB: 10 }
};
export const SVG_PESO_KB = 30;      // vetor: nítido em qualquer tela, só o peso conta
export const ALVO_DENSIDADE = 2;    // nítido em tela retina; abaixo disso, aviso
export const PISO_DENSIDADE = 1.5;  // abaixo disso borra: erro
export const LIMIAR_ALFA = 12;      // alfa 1–11 é véu: escurece o chip branco
export const FOLGA = 2;             // px em volta do conteúdo depois do recorte
export const MARGEM_MAX = (lado) => Math.max(4, Math.round(lado * 0.03)); // tolerância do recorte
export const VEU_MAX = 0.005;       // fração do quadro com véu de FUNDO (longe da tinta)
export const FUNDO_MIN = 0.05;      // fração do quadro totalmente transparente (fundo de verdade)

// Que tipo de logo é, pelo caminho. null = não é logo (fonte, README...).
export function tipoDoArquivo(caminho) {
  const p = String(caminho).replace(/\\/g, "/");
  if (!/\.(webp|png|jpe?g|gif|avif|svg)$/i.test(p)) return null;
  if (/^assets\/games\/game_[^/]+$/.test(p)) return "jogo";
  if (/^assets\/games\/set_[^/]+$/.test(p)) return "set";
  if (/^data\/set-logos\/symbol\//.test(p)) return "simbolo";
  if (/^data\/magic\/set-logos\//.test(p)) return "simbolo"; // o Magic usa o símbolo como logo do set
  if (/^data\/(?:[^/]+\/)?set-logos\//.test(p)) return "set";
  return null;
}

// Lugares e teto de um tipo (jogo vintage soma os lugares do vintage).
export function lugaresDo(tipo, { vintage = false } = {}) {
  if (tipo === "jogo") return vintage ? [...LUGARES.jogo, ...LUGARES.jogoVintage] : LUGARES.jogo;
  return LUGARES[tipo] || [];
}
export function padraoDo(tipo, { vintage = false } = {}) {
  return tipo === "jogo" && vintage ? PADRAO.jogoVintage : PADRAO[tipo];
}

// Densidade (px do arquivo por px CSS) em cada lugar, do pior pro melhor.
export function densidades(tipo, largura, altura, opcoes = {}) {
  const r = largura / altura;
  return lugaresDo(tipo, opcoes)
    .map((l) => {
      const cssL = l.css(r);
      return { lugar: l.nome, dpr: l.dpr, css: `${Math.round(cssL)}×${Math.round(cssL / r)}`, densidade: largura / cssL };
    })
    .sort((a, b) => a.densidade - b.densidade);
}

// Menor tamanho que chega a `densidade` em todos os lugares (pra dizer
// "precisa de uma fonte de pelo menos L×A").
export function tamanhoMinimo(tipo, largura, altura, opcoes = {}, densidade = ALVO_DENSIDADE) {
  const pior = densidades(tipo, largura, altura, opcoes)[0];
  if (!pior) return null;
  const k = densidade / pior.densidade;
  return { largura: Math.ceil(largura * k), altura: Math.ceil(altura * k) };
}

// O que cada lugar pede de arquivo (css × dpr) pra uma proporção r: a conta
// de onde sai o teto.
export function pedidoPelosLugares(tipo, r, opcoes = {}) {
  let largura = 0, altura = 0;
  for (const l of lugaresDo(tipo, opcoes)) {
    const cssL = l.css(r);
    largura = Math.max(largura, cssL * l.dpr);
    altura = Math.max(altura, (cssL / r) * l.dpr);
  }
  return { largura, altura };
}

// ── Cabeçalho do arquivo (sem decodificar) ──────────────────────────────────
// Formato, tamanho e se declara alfa. PNG, WebP (VP8, VP8L, VP8X), JPEG e GIF.
export function lerCabecalho(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) {
    const largura = b.readUInt32BE(16), altura = b.readUInt32BE(20), tipoCor = b[25];
    let alfa = tipoCor === 4 || tipoCor === 6;
    for (let p = 8; p + 8 <= b.length;) {
      const len = b.readUInt32BE(p), nome = b.toString("latin1", p + 4, p + 8);
      if (nome === "tRNS") alfa = true;
      if (nome === "IDAT" || nome === "IEND") break;
      p += 12 + len;
    }
    return { formato: "png", largura, altura, alfa, perda: tipoCor === 3 ? "paleta" : "sem perda" };
  }
  if (b.length >= 30 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
    const chunk = b.toString("latin1", 12, 16);
    if (chunk === "VP8 ") {
      return { formato: "webp", largura: b.readUInt16LE(26) & 0x3fff, altura: b.readUInt16LE(28) & 0x3fff, alfa: false, perda: "com perda" };
    }
    if (chunk === "VP8L") {
      const v = b.readUInt32LE(21);
      return { formato: "webp", largura: (v & 0x3fff) + 1, altura: ((v >>> 14) & 0x3fff) + 1, alfa: Boolean((v >>> 28) & 1), perda: "sem perda" };
    }
    if (chunk === "VP8X") {
      const flags = b[20];
      const largura = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1;
      const altura = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1;
      let perda = "?";
      for (let p = 30; p + 8 <= b.length;) {
        const nome = b.toString("latin1", p, p + 4), len = b.readUInt32LE(p + 4);
        if (nome === "VP8 ") { perda = "com perda"; break; }
        if (nome === "VP8L") { perda = "sem perda"; break; }
        p += 8 + len + (len & 1);
      }
      return { formato: "webp", largura, altura, alfa: Boolean(flags & 0x10), animado: Boolean(flags & 0x02), perda };
    }
    return { formato: "webp", largura: 0, altura: 0, alfa: false, perda: "?" };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let p = 2; p + 9 < b.length;) {
      if (b[p] !== 0xff) { p++; continue; }
      const m = b[p + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { formato: "jpeg", largura: b.readUInt16BE(p + 7), altura: b.readUInt16BE(p + 5), alfa: false, perda: "com perda" };
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
      p += 2 + b.readUInt16BE(p + 2);
    }
    return { formato: "jpeg", largura: 0, altura: 0, alfa: false, perda: "com perda" };
  }
  if (b.length >= 10 && b.toString("latin1", 0, 3) === "GIF") {
    return { formato: "gif", largura: b.readUInt16LE(6), altura: b.readUInt16LE(8), alfa: false, perda: "paleta" };
  }
  const texto = b.toString("utf8", 0, Math.min(b.length, 4096));
  if (/<svg[\s>]/i.test(texto)) return { formato: "svg", largura: 0, altura: 0, alfa: true, perda: "vetor" };
  return { formato: "?", largura: 0, altura: 0, alfa: false, perda: "?" };
}

// SVG com bitmap dentro (<image href="data:image/png…"> ou .png/.jpg) não é
// vetor: fica borrado como qualquer bitmap e ainda pesa em base64.
export function svgTemBitmap(texto) {
  return /<image\b[^>]*\bhref\s*=\s*["'](?:data:image\/(?:png|jpe?g|webp|gif)|[^"']+\.(?:png|jpe?g|webp|gif)["'])/i.test(String(texto));
}

// ── Pixels (RGBA cru, sem mexer no buffer) ──────────────────────────────────
// Caixa da tinta (alfa ≥ 12), margem de cada lado, fração do quadro com véu de
// FUNDO (alfa 1–11 a mais de 3 px da tinta: o antisserrilhado da borda e o
// brilho grudado no logo não contam) e fração totalmente transparente.
export function medePixels(rgba, largura, altura) {
  const n = largura * altura;
  const tinta = new Uint8Array(n);
  let x0 = largura, y0 = altura, x1 = -1, y1 = -1, transparentes = 0;
  for (let p = 0; p < n; p++) {
    const a = rgba[p * 4 + 3];
    if (a === 0) transparentes++;
    if (a >= LIMIAR_ALFA) {
      tinta[p] = 1;
      const x = p % largura, y = (p - x) / largura;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { vazio: true, veu: 0, transparente: transparentes / n };
  // Dilata a tinta em 3 px (quadrado 7×7, em duas passadas separáveis).
  const R = 3, h = new Uint8Array(n), perto = new Uint8Array(n);
  for (let y = 0; y < altura; y++) {
    let ultimo = -Infinity;
    for (let x = 0; x < largura; x++) { if (tinta[y * largura + x]) ultimo = x; if (x - ultimo <= R) h[y * largura + x] = 1; }
    ultimo = Infinity;
    for (let x = largura - 1; x >= 0; x--) { if (tinta[y * largura + x]) ultimo = x; if (ultimo - x <= R) h[y * largura + x] = 1; }
  }
  for (let x = 0; x < largura; x++) {
    let ultimo = -Infinity;
    for (let y = 0; y < altura; y++) { if (h[y * largura + x]) ultimo = y; if (y - ultimo <= R) perto[y * largura + x] = 1; }
    ultimo = Infinity;
    for (let y = altura - 1; y >= 0; y--) { if (h[y * largura + x]) ultimo = y; if (ultimo - y <= R) perto[y * largura + x] = 1; }
  }
  let veu = 0;
  for (let p = 0; p < n; p++) {
    const a = rgba[p * 4 + 3];
    if (a > 0 && a < LIMIAR_ALFA && !perto[p]) veu++;
  }
  return {
    vazio: false,
    caixa: { x0, y0, x1, y1 },
    margem: { esquerda: x0, topo: y0, direita: largura - 1 - x1, base: altura - 1 - y1 },
    veu: veu / n,
    transparente: transparentes / n
  };
}

// ── Avaliação de um arquivo ─────────────────────────────────────────────────
// Devolve os problemas como { regra, nivel, msg }; nivel "erro" barra o CI
// (a não ser que a exceção cale a regra), "aviso" só informa. Regras:
//   formato   erro   não é WebP (bitmap) nem SVG
//   animado   erro   WebP animado
//   alfa      erro   sem fundo transparente
//   teto      erro   maior que a caixa do teto
//   peso      erro   acima do teto de KB
//   nitidez   erro   abaixo de 1,5× em algum lugar (borra em tela retina)
//   macio     aviso  entre 1,5× e 2× em algum lugar
//   recorte   erro   margem dentro do arquivo (precisa de pixels)
//   veu       erro   véu de alfa no fundo (precisa de pixels)
//   svg       erro   SVG com bitmap dentro
// `pixels` (opcional) = resultado do medePixels; sem ele, recorte e véu não
// são conferidos.
export function avalia({ tipo, vintage = false, bytes, cabecalho, pixels = null, svgTexto = null }) {
  const problemas = [];
  const erro = (regra, msg) => problemas.push({ regra, nivel: "erro", msg });
  const kb = bytes / 1024;
  const pad = padraoDo(tipo, { vintage });
  if (cabecalho.formato === "svg") {
    if (svgTexto != null && svgTemBitmap(svgTexto)) erro("svg", "SVG com bitmap dentro (não é vetor)");
    if (kb > SVG_PESO_KB) erro("peso", `${kb.toFixed(0)} KB (teto do SVG: ${SVG_PESO_KB} KB)`);
    return problemas;
  }
  if (cabecalho.formato !== "webp") erro("formato", `${cabecalho.formato.toUpperCase()} (o padrão é WebP)`);
  if (cabecalho.animado) erro("animado", "WebP animado");
  const { largura: L, altura: A } = cabecalho;
  if (!cabecalho.alfa) erro("alfa", "sem canal alfa");
  else if (pixels && pixels.vazio) erro("alfa", "imagem toda transparente");
  else if (pixels && pixels.transparente < FUNDO_MIN) erro("alfa", `fundo opaco (só ${(pixels.transparente * 100).toFixed(1)}% transparente)`);
  if (L > pad.teto[0] || A > pad.teto[1]) {
    const cabe = encaixa(L, A, pad.teto[0], pad.teto[1]);
    erro("teto", `${L}×${A} passa do teto ${pad.teto[0]}×${pad.teto[1]} (reduzir pra ${cabe.largura}×${cabe.altura})`);
  }
  if (kb > pad.pesoKB) erro("peso", `${kb.toFixed(0)} KB (teto: ${pad.pesoKB} KB)`);
  if (L && A) {
    const pior = densidades(tipo, L, A, { vintage })[0];
    if (pior && pior.densidade < ALVO_DENSIDADE) {
      const min = tamanhoMinimo(tipo, L, A, { vintage });
      const onde = `${pior.densidade.toFixed(2)}× em ${pior.lugar} (${pior.css} px CSS)`;
      if (pior.densidade < PISO_DENSIDADE) erro("nitidez", `${onde}: borra em tela retina; pra ficar nítido precisa de ${min.largura}×${min.altura}`);
      else problemas.push({ regra: "macio", nivel: "aviso", msg: `${onde}: macio em tela retina; nítido com ${min.largura}×${min.altura}` });
    }
  }
  if (pixels && !pixels.vazio) {
    const m = pixels.margem;
    const sobra = [["esquerda", m.esquerda, L], ["direita", m.direita, L], ["topo", m.topo, A], ["base", m.base, A]]
      .filter(([, px, lado]) => px > MARGEM_MAX(lado));
    if (sobra.length) erro("recorte", `margem dentro do arquivo (${sobra.map(([lado, px]) => `${lado} ${px}px`).join(", ")}): o logo sai menor que os vizinhos`);
    if (pixels.veu > VEU_MAX) erro("veu", `${(pixels.veu * 100).toFixed(1)}% do fundo com alfa 1–11 (escurece o chip branco)`);
  }
  return problemas;
}

// ── Normalização (precisa do sharp de quem chama) ───────────────────────────
// Do arquivo de origem ao arquivo no padrão:
//  1. limpa o alfa: véu < 12 vira 0 e manchas soltas somem (limpaAlfa);
//  2. recorta na tinta + FOLGA px;
//  3. reduz pra caber no teto do tipo (Lanczos, alfa pré-multiplicado pelo
//     libvips). Só amplia com `amplia: true` — ampliar não cria detalhe; o
//     piso de nitidez acusa e a exceção registra o motivo;
//  4. zera de novo o alfa < 12 que a redução cria na borda;
//  5. grava WebP com perda (q90, alfa sem perda) e WebP sem perda, e fica com
//     o MENOR (logo de cor chapada sai menor sem perda; com degradê, com perda).
//     Se o menor passa do peso do tipo, desce os degraus de DEGRAUS até caber.
//     Primeiro a cor (q85→q75); depois o alfa (q80/q60), que é o que pesa
//     em logo com purpurina ou brilho pontilhado: no Lorcana 1 e no OP-17, o
//     alfa sem perda passava de dois terços do arquivo. Conferido em 2026-11-14 lado a lado
//     no fundo branco do chip: o alfa q60 não se distingue do sem perda.
export const DEGRAUS = [
  { q: 90, alfa: 100 }, { q: 85, alfa: 100 }, { q: 80, alfa: 100 }, { q: 75, alfa: 100 },
  { q: 80, alfa: 80 }, { q: 80, alfa: 60 }
];
export async function normaliza(sharp, entrada, { tipo, vintage = false, amplia = false } = {}) {
  const pad = padraoDo(tipo, { vintage });
  if (!pad) throw new Error(`tipo desconhecido: ${tipo}`);
  const fonte = sharp(entrada, { limitInputPixels: 60e6, density: 600 });
  const meta = await fonte.metadata();
  if (!meta.hasAlpha) throw new Error(`a fonte não tem canal alfa (${meta.format} ${meta.width}×${meta.height}): recorte o fundo antes`);
  const { data, info } = await sharp(entrada, { limitInputPixels: 60e6, density: 600 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const limpeza = limpaAlfa(data, info.width, info.height, { limiarAlfa: LIMIAR_ALFA });
  if (!limpeza.caixa) throw new Error("nada sobrou depois de limpar o alfa");
  const { x0, y0, x1, y1 } = limpeza.caixa;
  const left = Math.max(0, x0 - FOLGA), top = Math.max(0, y0 - FOLGA);
  const width = Math.min(info.width, x1 + 1 + FOLGA) - left;
  const height = Math.min(info.height, y1 + 1 + FOLGA) - top;
  const alvo = encaixa(width, height, pad.teto[0], pad.teto[1], { aumenta: amplia });
  const reduzido = await sharp(data, { raw: info })
    .extract({ left, top, width, height })
    .resize(alvo.largura, alvo.altura, { kernel: "lanczos3" })
    .raw().toBuffer({ resolveWithObject: true });
  const px = reduzido.data;
  for (let i = 3; i < px.length; i += 4) if (px[i] < LIMIAR_ALFA) { px[i] = 0; px[i - 1] = 0; px[i - 2] = 0; px[i - 3] = 0; }
  // Relê SEM o `premultiplied` do info: o sharp devolve o raw do resize já
  // desfeito da pré-multiplicação, mas marcado `premultiplied: true`; repassar
  // o info inteiro o faz desfazer DE NOVO, e todo pixel semitransparente
  // clareava. No Shadowverse (círculo mágico de brilho), +6,5 em média sobre o
  // branco no círculo; medido em 2026-11-14 contra a fonte reduzida pelo Pillow
  // (0,7 depois desta correção).
  const { width: wOut, height: hOut, channels } = reduzido.info;
  const cru = () => sharp(px, { raw: { width: wOut, height: hOut, channels } });
  const comPerda = ({ q, alfa }) => cru().webp({ quality: q, alphaQuality: alfa, effort: 6, smartSubsample: true }).toBuffer();
  const semPerda = await cru().webp({ lossless: true, effort: 6 }).toBuffer();
  const limite = pad.pesoKB * 1024;
  let escolhido = null, q90 = null;
  for (const d of DEGRAUS) {
    const buf = await comPerda(d);
    if (q90 == null) q90 = buf.length;
    escolhido = semPerda.length <= buf.length
      ? { buf: semPerda, modo: "sem perda" }
      : { buf, modo: `com perda q${d.q}${d.alfa < 100 ? `, alfa q${d.alfa}` : ""}` };
    if (escolhido.buf.length <= limite) break;
  }
  return {
    ...escolhido,
    acimaDoPeso: escolhido.buf.length > limite,
    largura: reduzido.info.width,
    altura: reduzido.info.height,
    origem: { largura: info.width, altura: info.height, recorte: `${width}×${height}` },
    ampliado: alvo.largura > width,
    limpeza: { veu: limpeza.veu, manchas: limpeza.manchas },
    alternativa: { comPerdaQ90: q90, semPerda: semPerda.length }
  };
}
