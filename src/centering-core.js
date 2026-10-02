// Centering Tool — núcleo de medição (2026-10-01).
//
// Tudo o que transforma pixels em "esq 57,5 · dir 42,5" mora aqui, SEM DOM: o
// arquivo roda igual no navegador e num vm do node (tests/centering-core.test.mjs),
// e a interface (src/centering.js) só desenha e chama. A especificação é o
// docs/PLANO-CENTERING-V2.md; as seções citadas (§6.4, §6.5…) são dele.
//
// Convenções que valem pro arquivo inteiro:
// - px da foto: o centro do pixel k mora em k + 0,5. O protótipo errava 0,7 px
//   em todo canto sem isso;
// - cantos sempre [[x,y] × 4] na ordem TL, TR, BR, BL;
// - espaço da carta (u,v) ∈ [0,1]², u → direita, v → baixo; a homografia m
//   (array de 9, linha a linha) leva (u,v) → foto;
// - linhas no espaço da carta: vertical u(v) = c + k·(v − ½), horizontal
//   v(u) = c + k·(u − ½). c é a posição no meio do lado, k a inclinação;
// - imagem = { data: Uint8ClampedArray RGBA, w, h }.
//
// Determinismo ("mesma foto, mesmo navegador, mesmo número"): nos caminhos que
// DECIDEM — escolha de pico, limiar do RANSAC, contagem de inliers — só entram
// + − × / e sqrt. As transcendentes do JS (pow, atan2, hypot…) não têm
// arredondamento correto e podem variar de um motor pro outro; aqui elas só
// aparecem em exibição (ângulo da pose, giro da moldura), no σ da paralaxe e
// na LUT do sRGB, que é arredondada pra uma grade grossa logo ao nascer.
(function () {
  "use strict";
  // Builtins em constantes locais: no vm do node (os testes), cada "Math.x" ou
  // "Infinity" passa pelo global do contexto e o laço quente fica ~10× mais
  // lento. No navegador não muda nada.
  const { abs, floor, ceil, sqrt, min, max, round } = Math, INF = Infinity;

  // ===========================================================================
  // 1) Cabeçalho do arquivo (§6.3): tamanho, orientação e focal SEM decodificar.
  // Decodificar só pra saber o tamanho custaria a foto inteira em memória
  // (98 MB a 24 MP), exatamente o pico que o teto de 12 MP quer evitar.
  // ===========================================================================
  const EXIF = [0x45, 0x78, 0x69, 0x66, 0, 0]; // "Exif" + 2 nulos, em bytes (sem escape no fonte)
  const HEIF = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];

  function lerCabecalho(bytes) {
    const r = { tipo: null, w: 0, h: 0, orientacao: 1, focal35: null };
    let exW = 0, exH = 0; // PixelX/YDimension do EXIF (0xA002/0xA003): o quadro que a câmera gravou
    const b = bytes;
    if (!b || !(b.length >= 12)) return r;
    const n = b.length;
    const u16 = (o, le) => (o + 2 <= n ? (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]) : -1);
    const u32 = (o, le) => (o + 4 <= n
      ? (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216
        : b[o] * 16777216 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]))
      : -1);
    const tem = (o, s) => {
      if (o + s.length > n) return false;
      for (let i = 0; i < s.length; i++) if (b[o + i] !== (typeof s === "string" ? s.charCodeAt(i) : s[i])) return false;
      return true;
    };
    // TIFF do EXIF: orientação (0x0112, no IFD0) e FocalLengthIn35mmFilm
    // (0xA405, no sub-IFD do EXIF, apontado por 0x8769). Tudo com limite: um
    // arquivo truncado ou malformado só deixa os campos no padrão.
    function tiff(t0, fim) {
      if (t0 + 8 > fim) return;
      const le = b[t0] === 0x49 && b[t0 + 1] === 0x49;
      if (!le && !(b[t0] === 0x4d && b[t0 + 1] === 0x4d)) return;
      if (u16(t0 + 2, le) !== 42) return;
      const ifd = (off, cada) => {
        const p = t0 + off;
        if (!(off >= 8) || p + 2 > fim) return;
        const cnt = u16(p, le);
        for (let i = 0; i < cnt; i++) {
          const e = p + 2 + 12 * i;
          if (e + 12 > fim) return;
          cada(u16(e, le), u16(e + 2, le), e + 8);
        }
      };
      let sub = 0;
      ifd(u32(t0 + 4, le), (tag, tipo, v) => {
        if (tag === 0x0112 && tipo === 3) { const o = u16(v, le); if (o >= 1 && o <= 8) r.orientacao = o; }
        else if (tag === 0x8769) sub = u32(v, le);
      });
      if (sub > 0) ifd(sub, (tag, tipo, v) => {
        const x = tipo === 4 ? u32(v, le) : tipo === 3 ? u16(v, le) : 0;
        if (tag === 0xa405) { if (x > 0) r.focal35 = x; } // 0 = "desconhecida" pela norma
        else if (tag === 0xa002) exW = x;
        else if (tag === 0xa003) exH = x;
      });
    }
    try {
      if (b[0] === 0xff && b[1] === 0xd8) {
        // JPEG: segmentos FF xx + tamanho, até o SOF (o EXIF vem antes dele).
        // A miniatura dentro do EXIF tem o próprio SOI/SOF, mas fica dentro do
        // APP1, que é pulado inteiro pelo tamanho.
        r.tipo = "jpeg";
        let o = 2;
        while (o + 4 <= n) {
          if (b[o] !== 0xff) break;
          const mk = b[o + 1];
          if (mk === 0xff) { o++; continue; } // byte de preenchimento
          if (mk === 0x01 || (mk >= 0xd0 && mk <= 0xd8)) { o += 2; continue; }
          if (mk === 0xd9 || mk === 0xda) break; // fim ou começo dos dados: não há mais cabeçalho
          const len = u16(o + 2, false);
          if (len < 2) break;
          const s = o + 4, fim = min(n, o + 2 + len);
          if (mk === 0xe1 && tem(s, EXIF)) tiff(s + 6, fim);
          else if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) {
            r.h = u16(s + 1, false); r.w = u16(s + 3, false);
            break;
          }
          o += 2 + len;
        }
      } else if (b[0] === 0x89 && tem(1, "PNG")) {
        r.tipo = "png";
        if (tem(12, "IHDR")) { r.w = u32(16, false); r.h = u32(20, false); }
        // eXIf (PNG 1.5) antes do IDAT: raro, mas é onde mora a orientação.
        for (let o = 8; o + 8 <= n;) {
          const len = u32(o, false);
          if (len < 0 || tem(o + 4, "IDAT") || tem(o + 4, "IEND")) break;
          if (tem(o + 4, "eXIf")) { tiff(o + 8, min(n, o + 8 + len)); break; }
          o += 12 + len;
        }
      } else if (tem(0, "RIFF") && tem(8, "WEBP")) {
        r.tipo = "webp";
        let extendido = false;
        for (let o = 12; o + 8 <= n;) {
          const tam = u32(o + 4, true), d = o + 8;
          if (tam < 0) break;
          if (tem(o, "VP8 ")) {
            if (b[d + 3] === 0x9d && b[d + 4] === 0x01 && b[d + 5] === 0x2a) { r.w = u16(d + 6, true) & 0x3fff; r.h = u16(d + 8, true) & 0x3fff; }
            if (!extendido) break;
          } else if (tem(o, "VP8L")) {
            if (b[d] === 0x2f) { const bits = u32(d + 1, true); r.w = (bits & 0x3fff) + 1; r.h = ((bits >>> 14) & 0x3fff) + 1; }
            if (!extendido) break;
          } else if (tem(o, "VP8X")) {
            extendido = true;
            r.w = 1 + (b[d + 4] | (b[d + 5] << 8) | (b[d + 6] << 16));
            r.h = 1 + (b[d + 7] | (b[d + 8] << 8) | (b[d + 9] << 16));
          } else if (tem(o, "EXIF")) {
            // Só a focal: o canvas do WebP já vem na orientação de exibição e os
            // navegadores não giram WebP pelo EXIF. A interface confere o
            // tamanho decodificado de qualquer jeito (§6.3).
            tiff(tem(d, EXIF) ? d + 6 : d, min(n, d + tam));
            r.orientacao = 1;
            break;
          }
          o = d + tam + (tam & 1);
        }
      } else if (tem(4, "ftyp")) {
        // HEIC/HEIF: só a assinatura. O Chrome e o Firefox não decodificam;
        // a interface mostra a mensagem da plataforma (§6.3). AVIF usa a mesma
        // caixa, mas os navegadores decodificam: fica "desconhecido" (<img>).
        const fim = min(n, u32(0, false), 64), marcas = [];
        for (let o = 8; o + 4 <= fim; o += 4) if (o !== 12) marcas.push(String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]));
        if (!marcas.some((m) => m === "avif" || m === "avis") && marcas.some((m) => HEIF.indexOf(m) >= 0)) r.tipo = "heic";
      }
    } catch (e) { /* cabeçalho torto: fica o que já foi lido */ }
    if (!(r.w > 0 && r.h > 0)) { r.w = 0; r.h = 0; }
    // Foto RECORTADA com o EXIF da câmera preservado (Fotos do iOS, Google
    // Fotos, galeria da Samsung): a focal 35 mm-eq é do quadro INTEIRO, mas a
    // pose a aplicaria à diagonal do recorte, com o centro óptico no meio dele
    // — a pose sai pela metade e a paralaxe zera. §6.3/§6.4: imagem recortada
    // é "ângulo desconhecido" (pior caso de 20°). Pega o recorte pelo
    // PixelX/YDimension que não bate com o SOF (antes da troca de eixos das
    // orientações 5–8; aceita os eixos trocados) e, quando o app reescreve os
    // dois, pela proporção que não é de sensor (1, 4:3, 3:2, 16:9). Um 20:9
    // nativo também cai: erra pro lado conservador.
    if (r.focal35 && r.w > 0) {
      const bate = !(exW > 0 && exH > 0) || (exW === r.w && exH === r.h) || (exW === r.h && exH === r.w);
      const p = max(r.w, r.h) / min(r.w, r.h);
      const sensor = [1, 4 / 3, 3 / 2, 16 / 9].some((q) => abs(p / q - 1) < 0.01);
      if (!bate || !sensor) r.focal35 = null;
    }
    if (r.orientacao >= 5) { const t = r.w; r.w = r.h; r.h = t; } // 5–8 trocam largura e altura na exibição
    return r;
  }

  // ===========================================================================
  // 2) Geometria (§6.4)
  // ===========================================================================

  // Quadrado unitário → quadrilátero, forma fechada de Heckbert (1989), sem
  // sistema linear. O DLT 8×8 só existe no teste, pra conferir.
  function squareToQuad(q) {
    const x0 = q[0][0], y0 = q[0][1], x1 = q[1][0], y1 = q[1][1], x2 = q[2][0], y2 = q[2][1], x3 = q[3][0], y3 = q[3][1];
    const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
    if (abs(sx) < 1e-12 && abs(sy) < 1e-12) return [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1];
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, den = dx1 * dy2 - dx2 * dy1;
    const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
    return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
  }

  // Inversa pela adjunta (foto → carta): converte toque, desenha e mapeia perfis.
  function inverte(m) {
    const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
    const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
    const det = a * A + b * B + c * C;
    return [A / det, (c * h - b * i) / det, (b * f - c * e) / det,
      B / det, (a * i - c * g) / det, (c * d - a * f) / det,
      C / det, (b * g - a * h) / det, (a * e - b * d) / det];
  }

  function aplica(m, u, v) {
    const w = m[6] * u + m[7] * v + m[8];
    return [(m[0] * u + m[1] * v + m[2]) / w, (m[3] * u + m[4] * v + m[5]) / w];
  }

  // Quadrilátero aceitável: convexo e na ordem TL→TR→BR→BL (os 4 produtos
  // vetoriais das arestas com o mesmo sinal — com y pra baixo, positivo), e
  // perspectiva não extrema. w = g·u + h·v + 1 é afim, então o extremo no
  // quadrado cai num canto: w vale 1, 1+g, 1+h e 1+g+h. A regra do plano é
  // min(…) > ε; aqui é min/max > ε, que coincide quando o TL é o canto mais
  // longe e não deixa passar a perspectiva extrema "ao contrário". Numa
  // gravata w chega a −0,98, num canto côncavo a −7,2: ambos caem.
  function quadValido(c, eps) {
    if (eps == null) eps = 0.15;
    if (!c || c.length !== 4) return false;
    for (let i = 0; i < 4; i++) if (!c[i] || !isFinite(c[i][0]) || !isFinite(c[i][1])) return false;
    let escala = 0;
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4], d = c[(i + 2) % 4];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      escala = max(escala, ex * ex + ey * ey);
      if (!(ex * (d[1] - b[1]) - ey * (d[0] - b[0]) > 0)) return false;
    }
    if (!(escala > 1e-6)) return false;
    const m = squareToQuad(c), g = m[6], h = m[7];
    const ws = [1, 1 + g, 1 + h, 1 + g + h];
    let mn = ws[0], mx = ws[0];
    for (const w of ws) { if (w < mn) mn = w; if (w > mx) mx = w; }
    return mn > 0 && mn > eps * mx;
  }

  // Foco em px pela FocalLengthIn35mmFilm: a norma mede a "equivalente" pela
  // DIAGONAL do quadro de 36×24 mm (43,27 mm), não pela largura.
  const DIAG35 = 43.2666;
  function focalPx(w, h, focal35) { return focal35 * sqrt(w * w + h * h) / DIAG35; }

  // M = K⁻¹·m, com K a priori (ponto principal no centro). As colunas são
  // λ·W·r1, λ·H·r2 e λ·t: a direção da normal (r1 × r2) não depende do
  // tamanho da carta, e M·(½,½,1) aponta pro centro dela.
  function camCols(m, w, h, f) {
    const cx = w / 2, cy = h / 2, M = new Array(9);
    for (let j = 0; j < 3; j++) {
      M[j] = (m[j] - cx * m[6 + j]) / f;
      M[3 + j] = (m[3 + j] - cy * m[6 + j]) / f;
      M[6 + j] = m[6 + j];
    }
    return M;
  }

  // Ângulo da foto (§6.4): entre a normal da carta e a reta câmera → centro da
  // carta (o eixo da câmera, quando a carta está no meio do quadro). É o que
  // decide a paralaxe da espessura. Sem focal, null ("ângulo desconhecido").
  function poseGraus(cantos, w, h, focal35) {
    if (!(focal35 > 0) || !(w > 0 && h > 0) || !quadValido(cantos, 0.01)) return null;
    const M = camCols(squareToQuad(cantos), w, h, focalPx(w, h, focal35));
    const a = [M[0], M[3], M[6]], b = [M[1], M[4], M[7]];
    const nx = a[1] * b[2] - a[2] * b[1], ny = a[2] * b[0] - a[0] * b[2], nz = a[0] * b[1] - a[1] * b[0];
    const dx = 0.5 * (M[0] + M[1]) + M[2], dy = 0.5 * (M[3] + M[4]) + M[5], dz = 0.5 * (M[6] + M[7]) + M[8];
    const cs = abs(nx * dx + ny * dy + nz * dz) / sqrt((nx * nx + ny * ny + nz * nz) * (dx * dx + dy * dy + dz * dz));
    return Math.acos(min(1, cs)) * 180 / Math.PI;
  }

  // Posição da câmera no referencial da carta, em mm (origem no TL, X → direita,
  // Y → baixo, Z pra dentro da carta; a câmera fica em Z < 0). Só pra
  // paralaxe: precisa da focal e do preset.
  function centroCamera(cantos, w, h, focal35, W, H) {
    const m = squareToQuad(cantos), M = camCols(m, w, h, focalPx(w, h, focal35));
    const c1 = [M[0] / W, M[3] / W, M[6] / W], c2 = [M[1] / H, M[4] / H, M[7] / H], c3 = [M[2], M[5], M[8]];
    const n1 = sqrt(c1[0] * c1[0] + c1[1] * c1[1] + c1[2] * c1[2]), n2 = sqrt(c2[0] * c2[0] + c2[1] * c2[1] + c2[2] * c2[2]);
    let lam = sqrt(n1 * n2);
    if (c3[2] < 0) lam = -lam; // a carta fica NA FRENTE da câmera (t_z > 0)
    const r1 = c1.map((x) => x * Math.sign(lam) / n1), r2 = c2.map((x) => x * Math.sign(lam) / n2), t = c3.map((x) => x / lam);
    const r3 = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    return [-dot(r1, t), -dot(r2, t), -dot(r3, t)]; // C = −Rᵀ·t
  }

  // ===========================================================================
  // 3) Pixels: LUT sRGB → linear, amostragem bilinear e achatamento (§6.7)
  // ===========================================================================

  // Intensidade LINEAR: em sRGB, com borrão, o centroide da aresta anda pro
  // lado escuro (−0,6 a −1,8 px medidos com σ de 0,8 a 3 px). A LUT nasce do
  // pow, mas arredondada numa grade de 2⁻²⁰: um pow que difira no último bit
  // entre motores não muda nenhuma entrada.
  const LUT = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255, l = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    LUT[i] = round(l * 1048576) / 1048576;
  }

  // Bilinear com a convenção de centro (x −= ½). Pra lupa e desenho; a medição
  // usa os perfis nativos da §6.5, nunca isto.
  function amostra(img, x, y) {
    const w = img.w, h = img.h, d = img.data;
    x -= 0.5; y -= 0.5;
    if (x < 0) x = 0; else if (x > w - 1) x = w - 1;
    if (y < 0) y = 0; else if (y > h - 1) y = h - 1;
    let x0 = floor(x), y0 = floor(y);
    if (x0 > w - 2) x0 = max(0, w - 2);
    if (y0 > h - 2) y0 = max(0, h - 2);
    const fx = x - x0, fy = y - y0, x1 = min(x0 + 1, w - 1), y1 = min(y0 + 1, h - 1);
    const k00 = (y0 * w + x0) * 4, k10 = (y0 * w + x1) * 4, k01 = (y1 * w + x0) * 4, k11 = (y1 * w + x1) * 4;
    const out = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const a = d[k00 + c] + (d[k10 + c] - d[k00 + c]) * fx, b = d[k01 + c] + (d[k11 + c] - d[k01 + c]) * fx;
      out[c] = a + (b - a) * fy;
    }
    return out;
  }

  // Achata a área (u0..u1, v0..v1) do espaço da carta num retângulo w×h, por
  // amostragem inversa: o passo homogêneo é incremental e custa UMA divisão
  // por pixel (1000×1397 em ~22 ms no node). Só desenho. Fora da foto fica
  // transparente, pra aparecer o fundo do palco.
  function achata(img, m, o) {
    const W = max(1, o.w | 0), Hh = max(1, o.h | 0);
    const u0 = o.u0 == null ? 0 : o.u0, v0 = o.v0 == null ? 0 : o.v0, u1 = o.u1 == null ? 1 : o.u1, v1 = o.v1 == null ? 1 : o.v1;
    const out = new Uint8ClampedArray(W * Hh * 4), src = img.data, sw = img.w, sh = img.h;
    const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i9 = m[8];
    const du = (u1 - u0) / W, dv = (v1 - v0) / Hh, dX = a * du, dY = d * du, dZ = g * du;
    for (let j = 0; j < Hh; j++) {
      const v = v0 + (j + 0.5) * dv, u = u0 + 0.5 * du;
      let X = a * u + b * v + c, Y = d * u + e * v + f, Z = g * u + h * v + i9;
      let p = j * W * 4;
      for (let i = 0; i < W; i++, X += dX, Y += dY, Z += dZ, p += 4) {
        const iz = 1 / Z;
        let x = X * iz - 0.5, y = Y * iz - 0.5;
        if (!(x >= -0.5 && y >= -0.5 && x <= sw - 0.5 && y <= sh - 0.5)) continue; // alfa 0
        if (x < 0) x = 0; else if (x > sw - 1) x = sw - 1;
        if (y < 0) y = 0; else if (y > sh - 1) y = sh - 1;
        let x0 = x | 0, y0 = y | 0;
        if (x0 > sw - 2) x0 = max(0, sw - 2);
        if (y0 > sh - 2) y0 = max(0, sh - 2);
        const fx = x - x0, fy = y - y0, k = (y0 * sw + x0) * 4, k2 = sh > 1 ? k + sw * 4 : k, kx = sw > 1 ? 4 : 0;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        out[p] = src[k] * w00 + src[k + kx] * w10 + src[k2] * w01 + src[k2 + kx] * w11;
        out[p + 1] = src[k + 1] * w00 + src[k + kx + 1] * w10 + src[k2 + 1] * w01 + src[k2 + kx + 1] * w11;
        out[p + 2] = src[k + 2] * w00 + src[k + kx + 2] * w10 + src[k2 + 2] * w01 + src[k2 + kx + 2] * w11;
        out[p + 3] = 255;
      }
    }
    return out;
  }

  // ===========================================================================
  // 4) Estimador de aresta (§6.5)
  //
  // Perfis ao longo da LINHA/COLUNA NATIVA mais próxima da normal, sem
  // interpolar (a aresta fica a < 45° do eixo); a posição achada vira um ponto
  // (x, j + ½) da foto e a reta sai do ajuste desses pontos (método da borda
  // inclinada). Pra cada fronteira entre pixels vizinhos guardamos a diferença
  // nativa em intensidade linear: D = ‖ΔL‖ (vetor RGB) pra ACHAR o pico, e o
  // próprio ΔL pro centroide.
  //
  // O centroide é o da §6.5 com dois ajustes, medidos na varredura de fase do
  // teste (|viés| ≤ 0,05 px em todas as fases, ângulos e borrões):
  // - as diferenças são PROJETADAS na direção de cor da aresta (a soma dos ΔL
  //   da janela) em vez de entrar pela norma. A soma telescopa, então o ruído
  //   de quantização dos 8 bits fica com média zero; pela norma, cada degrau de
  //   quantização na cauda soma sempre positivo e puxa pro lado claro (onde o
  //   degrau linear é maior). Pelo mesmo motivo não precisa do "nível de
  //   fundo": um fundo constante dentro de uma janela simétrica não move o
  //   ponto fixo;
  // - a janela de ±3σ é SIMÉTRICA em volta da estimativa (pesos fracionários
  //   nas pontas) e reavaliada até parar, em vez de ancorada no pixel do pico:
  //   a janela ancorada corta caudas desiguais e devolve o dente de serra.
  // ===========================================================================

  // Lê o trecho [a, b] (coordenadas contínuas) da linha (eixo 0) ou coluna
  // (eixo 1) nativa "fixo". A fronteira k fica entre os pixels i0+k e i0+k+1,
  // na coordenada nativa i0 + k + 1.
  function perfil(img, eixo, fixo, a, b) {
    const lim = eixo ? img.h : img.w, outro = eixo ? img.w : img.h;
    if (!(fixo >= 0 && fixo < outro)) return null;
    const i0 = max(0, floor(min(a, b))), i1 = min(lim - 1, ceil(max(a, b)));
    const n = i1 - i0;
    if (!(n >= 4)) return null;
    const D = new Float64Array(n), dl = new Float64Array(3 * n), data = img.data;
    const passo = eixo ? img.w * 4 : 4;
    let p = eixo ? (i0 * img.w + fixo) * 4 : (fixo * img.w + i0) * 4;
    let r0 = LUT[data[p]], g0 = LUT[data[p + 1]], b0 = LUT[data[p + 2]];
    // Cor (linear) do 1º pixel: com ela e os dl, a cor de qualquer pixel do
    // perfil sai por soma (a faixa da borda da sugestão da moldura usa).
    const c0 = [r0, g0, b0];
    for (let k = 0; k < n; k++) {
      p += passo;
      const r1 = LUT[data[p]], g1 = LUT[data[p + 1]], b1 = LUT[data[p + 2]];
      const dr = r1 - r0, dg = g1 - g0, db = b1 - b0;
      dl[3 * k] = dr; dl[3 * k + 1] = dg; dl[3 * k + 2] = db;
      D[k] = sqrt(dr * dr + dg * dg + db * db);
      r0 = r1; g0 = g1; b0 = b1;
    }
    return { eixo, fixo, i0, n, D, dl, c0 };
  }

  // Ponto da foto da posição nativa p (fronteira k → p = i0 + k + 1).
  function pontoNativo(pf, k) {
    const p = pf.i0 + k + 1;
    return pf.eixo ? [pf.fixo + 0.5, p] : [p, pf.fixo + 0.5];
  }

  // Máximos locais de D em [a, b] com força ≥ frac do máximo do trecho. Dois
  // picos são a MESMA aresta (fica o mais forte) quando estão a ≤ 2 amostras
  // (a parede de 0,3 mm) ou quando o vale entre eles é raso (≥ 80% do menor):
  // com borrão forte, o ruído racha o topo largo de uma aresta em vários picos.
  // `lim`, se vier, é o limiar absoluto (o máximo de OUTRO trecho já aplicado):
  // assim dá pra listar os picos de uma faixa maior que a janela de busca.
  function picos(D, a, b, frac, lim) {
    a = max(1, a); b = min(D.length - 2, b);
    let mx = 0;
    for (let k = a; k <= b; k++) if (D[k] > mx) mx = D[k];
    if (lim == null) lim = frac * mx;
    const out = [];
    if (!(mx > 0)) return out;
    for (let k = a; k <= b; k++) {
      const v = D[k];
      if (v >= lim && v >= D[k - 1] && v > D[k + 1]) {
        const u = out.length - 1;
        let junta = u >= 0 && k - out[u] <= 2;
        if (u >= 0 && !junta) {
          let vale = INF;
          for (let i = out[u] + 1; i < k; i++) if (D[i] < vale) vale = D[i];
          junta = vale >= 0.8 * min(v, D[out[u]]);
        }
        if (junta) { if (v > D[out[u]]) out[u] = k; } else out.push(k);
      }
    }
    return out;
  }

  // Largura do pico (σ pela meia altura). Entra pela mediana do lado.
  function sigmaPico(D, kp) {
    const n = D.length, pk = D[kp], m = 0.5 * pk;
    let a = kp, b = kp;
    while (a > 0 && D[a - 1] > m) a--;
    while (b < n - 1 && D[b + 1] > m) b++;
    const xa = a > 0 ? a - (D[a] - m) / (D[a] - D[a - 1]) : a - 0.5;
    const xb = b < n - 1 ? b + (D[b] - m) / (D[b] - D[b + 1]) : b + 0.5;
    return (xb - xa) / 2.3548;
  }

  // Variação líquida de cor (vetor) em ±r da fronteira k.
  function variacao(pf, k, r) {
    let x = 0, y = 0, z = 0;
    for (let i = max(0, k - r); i <= min(pf.n - 1, k + r); i++) { x += pf.dl[3 * i]; y += pf.dl[3 * i + 1]; z += pf.dl[3 * i + 2]; }
    return [x, y, z];
  }
  const norma = (v) => sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);

  // Candidatos que são DEGRAU, não LINHA fina. A aresta brilhante do
  // toploader/sleeve (~0,4 mm) aparece como dois picos colados que sobem e
  // descem: a cor de antes do primeiro é quase a de depois do segundo, então
  // a soma das duas variações é pequena perto da maior delas (só sobra o véu
  // do plástico). Quando o borrão funde os dois num pico só, a variação
  // líquida dele é quase nula. O corte (fundo → carta) e a moldura
  // (borda → arte) são degraus de verdade.
  // pos: posição (px) de cada candidato, de FORA pra dentro; v(i, r): variação
  // em ±r; elegivel(i): na janela de busca. Os pares saem da faixa INTEIRA
  // lida: uma aresta de plástico cortada ao meio pela janela pareceria degrau
  // sem o seu par. O pareamento é guloso de fora pra dentro, então a dupla do
  // plástico é consumida antes de olhar o corte logo depois dela (numa carta
  // de borda branca, "plástico → borda" também é oposto a "brilho → plástico").
  // Devolve os elegíveis com variação ≥ frac da maior.
  function degraus(pos, v, linhaMax, frac, elegivel) {
    // raio da variação: até cobrir uma aresta de plástico inteira (metade da
    // largura máxima), sem invadir o candidato vizinho
    const N = pos.length, linha = new Uint8Array(N), forca = new Float64Array(N), rMax = max(3, round(0.5 * linhaMax));
    const r = (i) => max(1, min(rMax, floor(0.5 * min(i > 0 ? pos[i] - pos[i - 1] : 99, i < N - 1 ? pos[i + 1] - pos[i] : 99))));
    const vs = pos.map((p, i) => v(i, r(i)));
    for (let i = 0; i + 1 < N; i++) {
      if (pos[i + 1] - pos[i] > linhaMax) continue;
      const a = vs[i], b = vs[i + 1], na = norma(a), nb = norma(b);
      const sx = a[0] + b[0], sy = a[1] + b[1], sz = a[2] + b[2];
      if (sx * sx + sy * sy + sz * sz <= 0.25 * max(na * na, nb * nb) && na > 0) { linha[i] = linha[i + 1] = 1; i++; }
    }
    let mx = 0;
    for (let i = 0; i < N; i++) { forca[i] = linha[i] || (elegivel && !elegivel(i)) ? 0 : norma(vs[i]); if (forca[i] > mx) mx = forca[i]; }
    const out = [];
    for (let i = 0; i < N; i++) if (forca[i] >= MIN_DEGRAU && forca[i] >= frac * mx) out.push(i);
    return out;
  }
  // Degrau mínimo (norma RGB em intensidade linear): abaixo disso é textura
  // do fundo ou ruído, por mais "de fora" que esteja.
  const MIN_DEGRAU = 0.03;
  // Largura máxima (px) de uma aresta de plástico: ~0,8 mm + borrão.
  const linhaPx = (esc, lado) => 0.8 * esc / (VERT[lado] ? 63 : 88) + 2;

  // Centroide sub-pixel em volta da fronteira kp, janela ±R (px nativos).
  // Devolve o índice fracionário (NaN se a janela sai do perfil ou não há aresta).
  function centroide(pf, kp, R) {
    const dl = pf.dl, n = pf.n;
    let er = 0, eg = 0, eb = 0;
    for (let k = max(0, floor(kp - R)); k <= min(n - 1, ceil(kp + R)); k++) { er += dl[3 * k]; eg += dl[3 * k + 1]; eb += dl[3 * k + 2]; }
    const en = sqrt(er * er + eg * eg + eb * eb);
    if (!(en > 0)) return NaN;
    er /= en; eg /= en; eb /= en;
    let c = kp;
    for (let it = 0; it < 6; it++) {
      const a = floor(c - R - 0.5), b = ceil(c + R + 0.5);
      if (a < 0 || b > n - 1) return NaN;
      let num = 0, den = 0;
      for (let k = a; k <= b; k++) {
        let w = R + 0.5 - abs(k - c);
        if (w <= 0) continue;
        if (w > 1) w = 1;
        const P = w * (dl[3 * k] * er + dl[3 * k + 1] * eg + dl[3 * k + 2] * eb);
        num += P * k; den += P;
      }
      if (!(den > 0)) return NaN;
      const cn = num / den;
      if (abs(cn - kp) > R) return NaN;
      const fim = abs(cn - c) < 1e-7;
      c = cn;
      if (fim) break;
    }
    return c;
  }

  const mediana = (a) => {
    if (!a.length) return NaN;
    const s = Array.from(a).sort((x, y) => x - y), h = s.length >> 1;
    return s.length & 1 ? s[h] : 0.5 * (s[h - 1] + s[h]);
  };

  // ===========================================================================
  // 5) Reta robusta: RANSAC de 2 pontos (semente FIXA, xorshift) + mínimos
  // quadrados totais nos inliers, com a covariância de posição e inclinação.
  // ===========================================================================
  function xorshift(semente) {
    let s = (semente >>> 0) || 0x9e3779b9;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
  }

  // TLS em forma fechada (autovetor do menor autovalor da dispersão 2×2), só
  // com sqrt. A normal sai com o sinal da normal de referência (nx0, ny0).
  function tls(xs, ys, sel, nx0, ny0) {
    let m = 0, cx = 0, cy = 0;
    for (let i = 0; i < xs.length; i++) if (sel[i]) { m++; cx += xs[i]; cy += ys[i]; }
    if (m < 2) return null;
    cx /= m; cy /= m;
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) if (sel[i]) { const dx = xs[i] - cx, dy = ys[i] - cy; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
    const hm = 0.5 * (sxx - syy), lam = 0.5 * (sxx + syy) - sqrt(hm * hm + sxy * sxy);
    let nx = sxy, ny = lam - sxx, ax = lam - syy, ay = sxy;
    if (ax * ax + ay * ay > nx * nx + ny * ny) { nx = ax; ny = ay; }
    let L = nx * nx + ny * ny;
    if (!(L > 1e-30)) { if (sxx < syy) { nx = 1; ny = 0; } else { nx = 0; ny = 1; } L = 1; }
    L = sqrt(L); nx /= L; ny /= L;
    if (nx * nx0 + ny * ny0 < 0) { nx = -nx; ny = -ny; }
    return { cx, cy, nx, ny, m };
  }

  function ajustaReta(xs, ys, o) {
    o = o || {};
    const n = xs.length, tol = o.tol || 0.8, iters = o.iters || 150, rnd = xorshift(o.semente || 0x2545f491);
    if (n < 3) return null;
    let melhor = -1, bnx = 0, bny = 0, bc = 0;
    for (let it = 0; it < iters; it++) {
      const i = rnd() % n;
      let j = rnd() % (n - 1);
      if (j >= i) j++;
      const dx = xs[j] - xs[i], dy = ys[j] - ys[i], L2 = dx * dx + dy * dy;
      if (!(L2 > 1e-12)) continue;
      const L = sqrt(L2), nx = -dy / L, ny = dx / L, c = nx * xs[i] + ny * ys[i];
      let cnt = 0;
      for (let k = 0; k < n; k++) { const r = nx * xs[k] + ny * ys[k] - c; if (r < tol && r > -tol) cnt++; }
      if (cnt > melhor) { melhor = cnt; bnx = nx; bny = ny; bc = c; }
    }
    if (melhor < 2) return null;
    // Tolerância do refit: os 0,8 px escolhem a hipótese; se os pontos forem
    // mais ruidosos que isso (borrão de 3 px numa foto escura), alarga pra
    // 2,5× a escala robusta dos resíduos (MAD), até 3 px. Senão metade dos
    // perfis bons vira "outlier" e o lado inteiro é recusado.
    const res = [];
    for (let k = 0; k < n; k++) res.push(abs(bnx * xs[k] + bny * ys[k] - bc));
    res.sort((x, y) => x - y);
    const tolR = min(3, max(tol, 2.5 * 1.4826 * res[n >> 1]));
    // Duas rodadas: inliers da hipótese → TLS → inliers da reta ajustada → TLS.
    const sel = new Uint8Array(n);
    let f = null, nx = bnx, ny = bny, c = bc;
    for (let rodada = 0; rodada < 2; rodada++) {
      for (let k = 0; k < n; k++) { const r = nx * xs[k] + ny * ys[k] - c; sel[k] = r < tolR && r > -tolR ? 1 : 0; }
      const g = tls(xs, ys, sel, nx, ny);
      if (!g) break;
      f = g; nx = g.nx; ny = g.ny; c = nx * g.cx + ny * g.cy;
    }
    if (!f) return null;
    // Covariância: resíduo na normal (r) e coordenada ao longo da reta (a).
    let s2 = 0, saa = 0, aMin = INF, aMax = -INF;
    for (let k = 0; k < n; k++) {
      if (!sel[k]) continue;
      const dx = xs[k] - f.cx, dy = ys[k] - f.cy, r = dx * f.nx + dy * f.ny, a = -dx * f.ny + dy * f.nx;
      s2 += r * r; saa += a * a;
      if (a < aMin) aMin = a; if (a > aMax) aMax = a;
    }
    const m = f.m;
    s2 = m > 2 ? s2 / (m - 2) : 0.25;
    // Perfis vizinhos correlacionados (borrão + sobreposição) valem menos que
    // n pontos independentes: n efetivo = n / fator (§6.8).
    const espac = m > 1 ? (aMax - aMin) / (m - 1) : 1;
    const fc = max(1, (1 + 2 * (o.sigmaBorrao || 0)) / max(1e-6, espac));
    return { cx: f.cx, cy: f.cy, nx: f.nx, ny: f.ny, s2, saa: max(saa, 1e-9), inl: m, total: n, fc, sel };
  }

  // Variância (px²) do deslocamento normal da reta no ponto (x, y).
  function varReta(f, x, y) {
    const a = -(x - f.cx) * f.ny + (y - f.cy) * f.nx;
    return f.s2 * (1 / f.inl + a * a / f.saa) * f.fc;
  }

  function cruzaRetas(f, g) {
    const c1 = f.nx * f.cx + f.ny * f.cy, c2 = g.nx * g.cx + g.ny * g.cy, det = f.nx * g.ny - f.ny * g.nx;
    if (!(abs(det) > 1e-12)) return null;
    return [(c1 * g.ny - c2 * f.ny) / det, (f.nx * c2 - g.nx * c1) / det];
  }

  // ===========================================================================
  // 6) Perfis de um lado, definidos no espaço da carta (§6.5)
  // ===========================================================================
  const VERT = { l: true, r: true, t: false, b: false };
  const DENTRO = { l: 1, r: -1, t: 1, b: -1 }; // sinal de "pra dentro" na coordenada do lado
  const BORDA = { l: 0, r: 1, t: 0, b: 1 };

  // Linha posta à mão pode vir sem k (reta, sem inclinação).
  const linhaEm = (L, t) => L.c + (L.k || 0) * (t - 0.5);
  const normaliza = (g) => { const o = {}; for (const l of ["l", "r", "t", "b"]) o[l] = { c: +g[l].c, k: +g[l].k || 0 }; return o; };

  // Ponto da carta a deslocamento o (pra DENTRO, em unidades da carta) da
  // linha L, na altura t do lado.
  function pontoLado(m, lado, L, t, o) {
    const x = linhaEm(L, t) + DENTRO[lado] * o;
    return VERT[lado] ? aplica(m, x, t) : aplica(m, t, x);
  }

  // px da foto por unidade da carta, pra dentro, no meio da linha L.
  function escalaLado(m, lado, L) {
    const a = pontoLado(m, lado, L, 0.5, 0), b = pontoLado(m, lado, L, 0.5, 0.01);
    return sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1])) / 0.01;
  }

  // nPerf perfis em t ∈ [t0, t1], cada um cobrindo o deslocamento [oLo, oHi] em
  // volta da linha L, lido na linha/coluna nativa mais perto da direção do
  // perfil. off[k] = deslocamento pra dentro (unidades da carta) da fronteira k.
  function perfisLado(img, m, mi, lado, L, oLo, oHi, nPerf, t0, t1) {
    const vert = VERT[lado], sg = DENTRO[lado], out = [];
    let ultimo = -1;
    for (let j = 0; j < nPerf; j++) {
      const t = t0 + (t1 - t0) * j / (nPerf - 1);
      const P0 = pontoLado(m, lado, L, t, oLo), P1 = pontoLado(m, lado, L, t, oHi);
      const ddx = P1[0] - P0[0], ddy = P1[1] - P0[1];
      const eixo = ddx * ddx >= ddy * ddy ? 0 : 1;
      const Pm = pontoLado(m, lado, L, t, 0.5 * (oLo + oHi));
      const fixo = floor(eixo ? Pm[0] : Pm[1]);
      if (fixo === ultimo) continue;
      // onde a linha/coluna nativa cruza as retas (da carta) o = oLo e o = oHi
      const cruza = (o) => {
        const A = pontoLado(m, lado, L, 0, o), B = pontoLado(m, lado, L, 1, o), c = fixo + 0.5;
        if (eixo === 0) { const den = B[1] - A[1]; return abs(den) > 1e-9 ? A[0] + (c - A[1]) * (B[0] - A[0]) / den : NaN; }
        const den = B[0] - A[0];
        return abs(den) > 1e-9 ? A[1] + (c - A[0]) * (B[1] - A[1]) / den : NaN;
      };
      const a = cruza(oLo), b = cruza(oHi);
      if (!isFinite(a) || !isFinite(b)) continue;
      const pf = perfil(img, eixo, fixo, a, b);
      if (!pf) continue;
      ultimo = fixo;
      const off = new Float64Array(pf.n);
      for (let k = 0; k < pf.n; k++) {
        const P = pontoNativo(pf, k), q = aplica(mi, P[0], P[1]);
        off[k] = vert ? sg * (q[0] - linhaEm(L, q[1])) : sg * (q[1] - linhaEm(L, q[0]));
      }
      pf.off = off;
      out.push(pf);
    }
    return out;
  }

  // Fronteira de cada perfil mais perto do deslocamento o.
  function kMaisPerto(pf, o) {
    let kb = -1, melhor = INF;
    for (let k = 0; k < pf.n; k++) { const d = abs(pf.off[k] - o); if (d < melhor) { melhor = d; kb = k; } }
    return kb;
  }

  // Soma dos D de todos os perfis numa grade de deslocamento (passo em
  // unidades da carta, ~½ px). O pico do agregado acha a aresta que se repete
  // ao longo do lado; a arte e o ruído, que mudam de perfil pra perfil, somem.
  function agrega(perfis, oLo, oHi, passo) {
    const nb = max(3, ceil((oHi - oLo) / passo) + 1), agg = new Float64Array(nb);
    for (const pf of perfis) for (let k = 0; k < pf.n; k++) {
      const x = (pf.off[k] - oLo) / passo;
      if (!(x >= 0 && x <= nb - 1)) continue;
      const i = floor(x), f = x - i;
      agg[i] += (1 - f) * pf.D[k];
      if (i + 1 < nb) agg[i + 1] += f * pf.D[k];
    }
    // Suaviza [1 2 1]/4: num lado alinhado ao eixo, todos os perfis têm as
    // fronteiras no MESMO deslocamento e caem de 2 em 2 bins (½ px); o
    // agregado alternava 0,8 / 0,15 e cada bin ímpar virava um "pico".
    for (let i = 0, ant = agg[0]; i < nb; i++) {
      const at = agg[i];
      agg[i] = 0.25 * ant + 0.5 * at + 0.25 * (i + 1 < nb ? agg[i + 1] : at);
      ant = at;
    }
    return { agg, oLo, passo, off: (i) => oLo + i * passo, idx: (o) => round((o - oLo) / passo) };
  }

  // Degraus de corte no agregado, na janela [a, b] dos bins: picos da faixa
  // INTEIRA (pro par da aresta de plástico), já de fora pra dentro (os bins
  // crescem pra dentro). Variação média dos perfis, em vetor: a cor de cada
  // lado da aresta é a mesma ao longo dela.
  function degrausAgregados(perfis, G, a, b, esc, lado, elegivel) {
    const agg = G.agg;
    let mx = 0;
    for (let k = max(0, a); k <= min(agg.length - 1, b); k++) if (agg[k] > mx) mx = agg[k];
    const todos = mx > 0 ? picos(agg, 1, agg.length - 2, 0, 0.2 * mx) : [];
    const v = (i, r) => {
      const s = [0, 0, 0];
      for (const pf of perfis) {
        const kk = kMaisPerto(pf, G.off(todos[i]));
        if (kk < 0) continue;
        const x = variacao(pf, kk, r);
        s[0] += x[0]; s[1] += x[1]; s[2] += x[2];
      }
      const n = perfis.length || 1;
      return [s[0] / n, s[1] / n, s[2] / n];
    };
    const ok = degraus(todos.map((k) => 0.5 * k), v, linhaPx(esc, lado), 0.2, (i) => todos[i] >= a && todos[i] <= b && elegivel(todos[i]));
    return ok.map((i) => todos[i]);
  }

  // Um candidato do agregado precisa se destacar do "chão" do trecho: na
  // carta sem moldura (full art) ou na borda lisa, o agregado é só arte/ruído.
  // O chão é o quartil de baixo, não a mediana: com corte, sleeve e moldura na
  // mesma janela, metade dos bins já é aresta. 2× o chão: a arte de uma full
  // art fica em 1,2–1,5×; uma moldura com borrão de 3 px e ruído forte, em
  // 2,1–2,4× (o RANSAC ainda barra o que passar por acaso).
  function destaca(agg, i, a, b) {
    const v = [];
    for (let k = max(0, a); k <= min(agg.length - 1, b); k++) v.push(agg[k]);
    if (!v.length) return false;
    v.sort((x, y) => x - y);
    return agg[i] > 0 && agg[i] >= 2 * v[floor(0.25 * (v.length - 1))];
  }

  // Refino perfil a perfil em volta do deslocamento alvo: máximo local de D a
  // ±busca px nativos, σ pela mediana do lado, centroide. Devolve os pontos da
  // foto e o σ do borrão.
  // oMin/oMax (opcionais): nenhuma fronteira mais pra fora/dentro que isso —
  // a moldura não pode voltar pro corte pela busca de ±busca px, nem a busca
  // pular pro lóbulo de outra aresta do agregado (ver linhaMedida).
  function pontosLado(perfis, alvo, busca, rMax, oMin, oMax) {
    const esc = [];
    for (const pf of perfis) {
      const kb = kMaisPerto(pf, alvo);
      if (kb < 0) { esc.push(-1); continue; }
      let kp = -1, vp = 0;
      for (let k = max(1, kb - busca); k <= min(pf.n - 2, kb + busca); k++) if (pf.D[k] > vp && !(pf.off[k] < oMin) && !(pf.off[k] > oMax)) { vp = pf.D[k]; kp = k; }
      esc.push(kp);
    }
    return centroides(perfis, esc, rMax);
  }

  // Raio livre em volta do pico kp: se, antes de R, D desce até um vale e
  // sobe pra OUTRO pico de verdade (≥ 25% do nosso, vale ≤ 60% dele) — a
  // aresta do sleeve a 0,4 mm do corte, a moldura numa borda fina —, a janela
  // para no vale. Fica simétrica, então cortar não enviesa.
  function raioLivre(D, kp, R) {
    let r = R;
    for (const s of [-1, 1]) {
      let k = kp;
      while (k + s >= 0 && k + s < D.length && D[k + s] <= D[k]) k += s;
      const vale = abs(k - kp);
      if (vale >= R + 0.5) continue;
      let j = k;
      while (j + s >= 0 && j + s < D.length && abs(j - kp) <= R + 3 && D[j + s] >= D[j]) j += s;
      if (D[j] >= 0.25 * D[kp] && D[k] <= 0.6 * D[j]) r = min(r, vale - 0.5);
    }
    return max(1, r);
  }

  function centroides(perfis, esc, rMax) {
    const sig = [];
    let pkMax = 0;
    for (let i = 0; i < perfis.length; i++) if (esc[i] >= 0) pkMax = max(pkMax, perfis[i].D[esc[i]]);
    for (let i = 0; i < perfis.length; i++) if (esc[i] >= 0 && perfis[i].D[esc[i]] >= 0.25 * pkMax) sig.push(sigmaPico(perfis[i].D, esc[i]));
    const sb = sig.length ? mediana(sig) : 1;
    let R = max(2, 3 * sb);
    if (rMax > 0) R = min(R, max(1.5, rMax));
    const xs = [], ys = [];
    for (let i = 0; i < perfis.length; i++) {
      const pf = perfis[i], kp = esc[i];
      if (kp < 0 || pf.D[kp] < 0.25 * pkMax) continue;
      const c = centroide(pf, kp, raioLivre(pf.D, kp, R));
      if (!isFinite(c)) continue;
      const k = floor(c), P = pontoNativo(pf, k), fr = c - k;
      if (pf.eixo) { xs.push(P[0]); ys.push(P[1] + fr); } else { xs.push(P[0] + fr); ys.push(P[1]); }
    }
    return { xs, ys, sigmaBorrao: sb, R };
  }

  // Reta da foto → linha (c, k) do lado no espaço da carta, com o σ de c.
  // Homografia leva reta em reta: dois pontos bastam e o resultado é exato.
  function linhaDaFoto(f, m, mi, lado) {
    const vert = VERT[lado];
    const conv = (cx, cy) => {
      const p = aplica(mi, cx - 400 * f.ny, cy + 400 * f.nx), q = aplica(mi, cx + 400 * f.ny, cy - 400 * f.nx);
      const da = vert ? q[1] - p[1] : q[0] - p[0];
      if (!(abs(da) > 1e-12)) return null;
      const k = vert ? (q[0] - p[0]) / da : (q[1] - p[1]) / da;
      return { c: vert ? p[0] + k * (0.5 - p[1]) : p[1] + k * (0.5 - p[0]), k };
    };
    const L = conv(f.cx, f.cy);
    if (!L) return null;
    // σ de c: variância do ajuste no ponto do meio, convertida pela variação
    // de c quando a reta da foto anda 1 px na própria normal.
    const meio = vert ? aplica(m, L.c, 0.5) : aplica(m, 0.5, L.c);
    const L1 = conv(f.cx + f.nx, f.cy + f.ny);
    const J = L1 ? abs(L1.c - L.c) : 0;
    return { c: L.c, k: L.k, sigma: sqrt(varReta(f, meio[0], meio[1])) * J };
  }

  // Reta de UMA aresta perto do segmento A→B da foto (pico mais perto dele a
  // ±janelaPx): o estimador isolado, sem carta em volta. Usado pela varredura
  // de fase do teste e pela bancada.
  function retaBorda(img, A, B, o) {
    o = o || {};
    const S = o.janelaPx || 8, nP = o.n || 48;
    const dx = B[0] - A[0], dy = B[1] - A[1], Ln = sqrt(dx * dx + dy * dy), nx = dy / Ln, ny = -dx / Ln;
    const eixo = nx * nx >= ny * ny ? 0 : 1, perfis = [], esc = [];
    let ultimo = -1;
    for (let j = 0; j < nP; j++) {
      const t = 0.12 + 0.76 * j / (nP - 1), P = [A[0] + t * dx, A[1] + t * dy];
      const fixo = floor(eixo ? P[0] : P[1]);
      if (fixo === ultimo) continue;
      const c = fixo + 0.5, cr = eixo ? A[1] + (c - A[0]) * dy / dx : A[0] + (c - A[1]) * dx / dy;
      const nn = abs(eixo ? ny : nx), alc = (S + 14) / nn;
      const pf = perfil(img, eixo, fixo, cr - alc, cr + alc);
      if (!pf) continue;
      ultimo = fixo;
      let kc = -1;
      for (const k of picos(pf.D, 0, pf.n - 1, 0.4)) {
        const d = abs(pf.i0 + k + 1 - cr) * nn;
        if (d <= S && (kc < 0 || d < abs(pf.i0 + kc + 1 - cr) * nn)) kc = k;
      }
      perfis.push(pf); esc.push(kc);
    }
    const pts = centroides(perfis, esc, 0);
    return ajustaReta(pts.xs, pts.ys, { sigmaBorrao: pts.sigmaBorrao });
  }

  // ===========================================================================
  // 7) Refino do corte (passo Ângulo, F1b): 48 perfis por lado em
  // t ∈ [0,12; 0,88], a aresta de corte em cada um, RANSAC, cantos pela
  // interseção das retas vizinhas; repete com a janela menor.
  // ===========================================================================
  const LADOS = ["t", "r", "b", "l"]; // na ordem TL→TR, TR→BR, BR→BL, BL→TL

  function refinaPasso(img, q, S) {
    const m = squareToQuad(q), mi = inverte(m), retas = [];
    let sbMax = 0;
    for (const lado of LADOS) {
      const L = { c: BORDA[lado], k: 0 }, esc = escalaLado(m, lado, L);
      if (!(esc > 0)) return null;
      const s = S / esc, mg = (S + 14) / esc;
      const perfis = perfisLado(img, m, mi, lado, L, -mg, mg, 48, 0.12, 0.88), escolha = [], lp = linhaPx(esc, lado);
      for (const pf of perfis) {
        // Corte = a aresta MAIS DE FORA que é um degrau (fundo/plástico do lado
        // de fora, carta do lado de dentro), não a aresta fina do toploader.
        let mx = 0;
        for (let k = 0; k < pf.n; k++) if (pf.off[k] >= -s && pf.off[k] <= s && pf.D[k] > mx) mx = pf.D[k];
        const cs = mx > 0 ? picos(pf.D, 1, pf.n - 2, 0, 0.2 * mx) : [];
        const sentido = pf.off[pf.n - 1] < pf.off[0] ? -1 : 1;
        if (sentido < 0) cs.reverse(); // de fora pra dentro
        const ok = degraus(cs.map((k) => sentido * k), (i, r) => variacao(pf, cs[i], r), lp, 0.2,
          (i) => pf.off[cs[i]] >= -s && pf.off[cs[i]] <= s);
        // Dois degraus colados (≤ uma aresta de plástico), com vale fundo entre
        // eles e força parecida: a faixa é o plástico de um sleeve justo (a
        // aresta de dentro dele se fundiu com o corte no picos e a de fora
        // ficou sem par) ou a parede, nunca a borda impressa (≥ 1,5 mm). O
        // corte é o de dentro. Sem isto, folga de 0,5 mm levava os 4 cantos
        // pro plástico com ok:true (revisão de 2026-10-02).
        let e = 0;
        while (e + 1 < ok.length && ok[e + 1] === ok[e] + 1) {
          const k0 = cs[ok[e]], k1 = cs[ok[e + 1]], gap = abs(k1 - k0);
          if (gap > lp) break;
          let vl = INF;
          for (let q = min(k0, k1) + 1; q < max(k0, k1); q++) if (pf.D[q] < vl) vl = pf.D[q];
          // vale raso: o mesmo degrau rachado pelo borrão. 75% e não 50%: a
          // 600×800 o plástico de 0,5 mm tem 3,4 px e o borrão enche o vale
          // até ~60% (o canto ia pro plástico com ok:true); o picos já junta
          // os rachados de vale ≥ 80%, e a bancada do borrão forte melhorou.
          if (vl > 0.75 * min(pf.D[k0], pf.D[k1])) break;
          const r = max(1, floor(0.5 * gap));
          if (norma(variacao(pf, k1, r)) < 0.5 * norma(variacao(pf, k0, r))) break; // textura da arte (full art)
          e++;
        }
        escolha.push(ok.length ? cs[ok[e]] : -1);
      }
      const pts = centroides(perfis, escolha, 0);
      const f = ajustaReta(pts.xs, pts.ys, { sigmaBorrao: pts.sigmaBorrao });
      if (!f || f.inl < 12 || f.inl < 0.5 * perfis.length) return null;
      sbMax = max(sbMax, pts.R);
      retas.push(f);
    }
    // TL = esq ∩ topo, TR = topo ∩ dir, BR = dir ∩ base, BL = base ∩ esq
    const pares = [[3, 0], [0, 1], [1, 2], [2, 3]], cantos = [], sig = [];
    for (const [i, j] of pares) {
      const p = cruzaRetas(retas[i], retas[j]);
      if (!p) return null;
      const sn = abs(retas[i].nx * retas[j].ny - retas[i].ny * retas[j].nx);
      cantos.push(p);
      sig.push(sqrt(varReta(retas[i], p[0], p[1]) + varReta(retas[j], p[0], p[1])) / max(sn, 0.2));
    }
    return { cantos, sigmaPx: sig, R: sbMax };
  }

  // o.so (opcional): índices dos cantos que a interface vai APLICAR (o canto
  // solto, ou os 2 da aresta). A guarda de "fugiu pra outra aresta" olha só
  // eles: um canto posto à mão com Alt longe de onde o refino o poria não
  // pode derrubar o encaixe do canto que acabou de ser solto.
  function refinaCantos(img, cantos, o) {
    const S0 = max(3, (o && o.janelaPx) || 12);
    const so = [0, 1, 2, 3].filter((i) => !(o && Array.isArray(o.so)) || o.so.indexOf(i) >= 0);
    // Sem refino, o canto vale o que a pessoa pôs: ~½ px de TELA, e a janela
    // (12 px de tela) diz quantos px da foto cabem num px de tela.
    const falha = { cantos, ok: false, sigmaPx: [0, 1, 2, 3].map(() => S0 / 24) };
    if (!img || !quadValido(cantos)) return falha;
    let q = cantos, r = refinaPasso(img, q, S0);
    if (!r || !quadValido(r.cantos)) return falha;
    q = r.cantos;
    const r2 = refinaPasso(img, q, max(0.5 * S0, r.R + 2, 4));
    if (r2 && quadValido(r2.cantos)) r = r2;
    for (const i of so) {
      const dx = r.cantos[i][0] - cantos[i][0], dy = r.cantos[i][1] - cantos[i][1];
      if (dx * dx + dy * dy > 4 * S0 * S0) return falha; // fugiu pra outra aresta
    }
    return { cantos: r.cantos, ok: true, sigmaPx: r.sigmaPx };
  }

  // ===========================================================================
  // 8) Sugestão das 8 linhas ao endireitar (F1b, estágio D do protótipo)
  // ===========================================================================
  // Reta da aresta no bin kAlvo do agregado.
  function linhaMedida(img, m, mi, lado, perfis, G, kAlvo, oMin) {
    // Busca por perfil presa ao LÓBULO do pico escolhido: no máximo até a
    // metade do caminho pro pico vizinho do agregado (≥ 25% do nosso), dos
    // dois lados e pros dois tipos de linha. Com ±5 px soltos, o maior D de
    // cada perfil levava o corte da borda preta pra aresta interna do sleeve
    // (~4 px), o ímã pra fora da própria janela e a moldura fina pra aresta
    // moldura→arte, sem "confira" (achado da revisão de 2026-10-02).
    const agg = G.agg;
    let lo = -INF, hi = INF;
    for (const k of picos(agg, 1, agg.length - 2, 0, 0.25 * agg[kAlvo])) {
      if (abs(k - kAlvo) <= 2) continue;
      if (k < kAlvo) lo = G.off(0.5 * (k + kAlvo));
      else if (hi === INF) hi = G.off(0.5 * (k + kAlvo));
    }
    if (oMin > lo) lo = oMin;
    const pts = pontosLado(perfis, G.off(kAlvo), 5, 0, lo, hi);
    const f = ajustaReta(pts.xs, pts.ys, { sigmaBorrao: pts.sigmaBorrao });
    if (!f || f.inl < 12 || f.inl < 0.6 * perfis.length) return null;
    return linhaDaFoto(f, m, mi, lado);
  }

  // Faixa da borda (2026-10-02): a moldura é onde a cor SAI da borda.
  // Borda clara com arte clara (One Piece: borda branca, céu quase branco no
  // topo da arte) faz a aresta borda→arte FRACA, e o "primeiro pico forte"
  // pulava pra 1ª aresta forte lá dentro (o círculo do custo, o "2000", a
  // faixa vermelha). Aqui a cor da borda é a mediana da faixa logo depois do
  // corte (0,3% a 1% pra dentro, nunca menos de 3 px), e a moldura é a
  // PRIMEIRA posição pra dentro em que a cor sai dela por mais que um limiar
  // — em luz linear, com o limiar pelo ruído medido na própria faixa e a
  // média de 2 px, pra um pixel ruidoso não disparar. Daí o pico do agregado
  // logo ali (o limiar cruza antes do centro de uma aresta borrada) e o
  // centroide perfil a perfil, como as outras linhas.
  // Só vale quando a faixa é UMA cor ao longo do lado (60% dos perfis perto da
  // mediana) e os perfis saem dela juntos: na full art a "faixa" já é arte e
  // muda de perfil pra perfil. Devolve o bin do agregado e se a aresta é
  // FRACA (abaixo dos 40% do máximo de [a, b], que o critério do pico forte
  // descartaria), ou null.
  // sbPx: borrão do corte (px) — a faixa começa depois da cauda dele, senão
  // a "cor da borda" seria a rampa do próprio corte. kForte: o 1º pico forte
  // (ou −1); uma saída que não tem VALE antes dele é a encosta da mesma
  // aresta (borrão forte com ruído), não uma aresta fraca própria.
  function molduraPorFaixa(perfis, G, oe, esc, oMax, a, b, sbPx, kForte) {
    const bA = max(0.003, max(2.5, 1.5 + 2.5 * (sbPx > 0 ? sbPx : 1)) / esc), bB = max(0.01, bA + 3 / esc);
    const d3 = (x, y) => { const p = x[0] - y[0], q = x[1] - y[1], r = x[2] - y[2]; return sqrt(p * p + q * q + r * r); };
    const fx = [];
    for (const pf of perfis) {
      const n = pf.n, off = pf.off, dl = pf.dl;
      if (!pf.c0 || n < 3) continue;
      // pixel j (0..n): cor linear absoluta (c0 + soma dos dl) e o
      // deslocamento do centro dele (entre as fronteiras j−1 e j)
      const cor = new Float64Array(3 * (n + 1)), po = new Float64Array(n + 1);
      cor[0] = pf.c0[0]; cor[1] = pf.c0[1]; cor[2] = pf.c0[2];
      for (let j = 1; j <= n; j++) for (let c = 0; c < 3; c++) cor[3 * j + c] = cor[3 * j - 3 + c] + dl[3 * j - 3 + c];
      for (let j = 0; j <= n; j++) po[j] = j === 0 ? 1.5 * off[0] - 0.5 * off[1] : j === n ? 1.5 * off[n - 1] - 0.5 * off[n - 2] : 0.5 * (off[j - 1] + off[j]);
      const fR = [], fG = [], fB = [];
      for (let j = 0; j <= n; j++) if (po[j] >= oe + bA && po[j] <= oe + bB) { fR.push(cor[3 * j]); fG.push(cor[3 * j + 1]); fB.push(cor[3 * j + 2]); }
      if (fR.length < 2) continue;
      const cb = [mediana(fR), mediana(fG), mediana(fB)], dv = [];
      for (let q = 0; q < fR.length; q++) dv.push(d3([fR[q], fG[q], fB[q]], cb));
      fx.push({ n, cor, po, s: off[n - 1] > off[0] ? 1 : -1, cb, nu: mediana(dv) });
    }
    const minimo = (x) => x >= 12 && x >= 0.6 * perfis.length;
    if (!minimo(fx.length)) return null;
    const cm = [0, 1, 2].map((c) => mediana(fx.map((f) => f.cb[c])));
    const T = max(0.04, 4 * mediana(fx.map((f) => f.nu)));
    const dentro = fx.filter((f) => d3(f.cb, cm) <= max(3 * T, 0.1));
    if (!minimo(dentro.length)) return null;
    const cruz = [];
    for (const f of dentro) {
      const { n, cor, po, s, cb } = f;
      let j = s > 0 ? 0 : n;
      while (j >= 0 && j <= n && !(po[j] > oe + bB)) j += s;
      for (; j >= 0 && j <= n && j + s >= 0 && j + s <= n && !(po[j] > oMax); j += s) {
        let d2 = 0;
        for (let c = 0; c < 3; c++) { const x = 0.5 * (cor[3 * j + c] + cor[3 * (j + s) + c]) - cb[c]; d2 += x * x; }
        if (d2 > T * T) { cruz.push(po[j]); break; }
      }
    }
    if (cruz.length < 0.6 * dentro.length) return null;
    const oc = mediana(cruz);
    let perto = 0;
    for (const x of cruz) if (abs(x - oc) <= 2 / esc) perto++;
    if (perto < 0.5 * dentro.length) return null;
    // Pico do agregado: sobe a encosta a partir do cruzamento (no máximo 8 px).
    const agg = G.agg;
    let k = min(agg.length - 2, max(1, G.idx(oc)));
    for (let it = 0; it < 16; it++) {
      if (k + 1 <= agg.length - 2 && agg[k + 1] > agg[k]) k++;
      else if (k - 1 >= 1 && agg[k - 1] > agg[k] && G.off(k - 1) > oe + bB) k--;
      else break;
    }
    if (!(agg[k] >= agg[k - 1] && agg[k] >= agg[k + 1])) return null;
    // (Longe do pico forte — mais que a cauda de um borrão, 3σ + 2 px — não é
    // encosta de nada: uma aresta fraca de verdade com ruído forte tem vale de
    // só ~60% dela mesma, e a regra a descartava.)
    if (kForte > k && 0.5 * (kForte - k) <= 3 * (sbPx > 0 ? sbPx : 1) + 2) {
      let vale = INF;
      for (let q = k + 1; q < kForte; q++) if (agg[q] < vale) vale = agg[q];
      if (!(vale <= 0.6 * agg[k])) return null;
    }
    let mx = 0;
    for (let q = max(0, a); q <= min(agg.length - 1, b); q++) if (agg[q] > mx) mx = agg[q];
    return { k, fraca: agg[k] < 0.4 * mx };
  }

  function sugereLinhas(img, cantos) {
    const ext = {}, int = {}, sExt = {}, sInt = {}, confere = [], fracas = [];
    const valido = img && quadValido(cantos);
    const m = valido ? squareToQuad(cantos) : null, mi = valido ? inverte(m) : null;
    for (const lado of ["l", "r", "t", "b"]) {
      const L0 = { c: BORDA[lado], k: 0 };
      let e = null, i = null, duvida = false;
      const esc = valido ? escalaLado(m, lado, L0) : 0;
      if (esc > 0) {
        const oLo = -0.03, oHi = 0.16, passo = 0.5 / esc;
        const perfis = perfisLado(img, m, mi, lado, L0, oLo, oHi, 41, 0.15, 0.85);
        const G = agrega(perfis, oLo, oHi, passo), agg = G.agg;
        // Externa: o degrau de corte mais perto de d = 0 (não a aresta fina
        // de um toploader logo ao lado).
        const ce = degrausAgregados(perfis, G, G.idx(-0.02), G.idx(0.015), esc, lado, () => true);
        let ie = -1;
        for (const k of ce) if (ie < 0 || abs(G.off(k)) < abs(G.off(ie))) ie = k;
        if (ie >= 0) {
          // A busca perfil a perfil não pode pular pra aresta de FORA de um
          // sleeve justo: para no meio do caminho até o degrau de fora (o
          // degrau de `ce`, não qualquer pico: com qualquer pico, o borrão
          // forte piorava o p95 de 0,52 pra 1,37 pp na bancada).
          let fora = null;
          for (const k of ce) if (k < ie && (fora == null || k > fora)) fora = k;
          e = linhaMedida(img, m, mi, lado, perfis, G, ie, fora == null ? undefined : G.off(0.5 * (fora + ie)));
        }
        // Interna: o primeiro pico pra dentro, forte e a ≥ 6 px da externa…
        const oe = ie >= 0 ? G.off(ie) : 0, a = G.idx(oe + 6 / esc), b = G.idx(oHi - 4 / esc);
        const ci = picos(agg, a, b, 0.4).filter((k) => destaca(agg, k, a, b));
        // …a não ser que a cor já saia da borda ANTES dele (aresta fraca: borda
        // clara com arte clara). Aí vale a saída da faixa, e o lado vai pro
        // "confira" com o aviso de arte clara.
        const sbCorte = ie >= 0 ? 0.5 * sigmaPico(agg, ie) : 1; // bins de ½ px
        const fb = molduraPorFaixa(perfis, G, oe, esc, oHi - 4 / esc, a, b, sbCorte, ci.length ? ci[0] : -1);
        // Tentativas em ordem: a saída da faixa, se vem antes do pico forte
        // (aresta fraca); senão o pico forte e, se a reta dele não fechar, a
        // saída da faixa (a One Piece real: o "2000" no topo, com 1/3 dos
        // perfis, vinha antes do friso vermelho de 2/3). Fora a 1ª opção
        // limpa, o lado fica em dúvida: "confira", com o aviso de arte clara.
        const separada = fb && (!ci.length || abs(G.off(fb.k) - G.off(ci[0])) > 1 / esc);
        const tent = [];
        if (fb && (!ci.length || G.off(fb.k) < G.off(ci[0]) - 1 / esc)) { tent.push(fb.k); if (ci.length) tent.push(ci[0]); }
        else if (ci.length) { tent.push(ci[0]); if (separada) tent.push(fb.k); }
        for (let q = 0; q < tent.length && !i; q++) {
          i = linhaMedida(img, m, mi, lado, perfis, G, tent[q], oe + 0.5 * (G.off(tent[q]) - oe));
          if (i) duvida = q > 0 || (fb != null && tent[q] === fb.k && fb.fraca);
        }
        // sanidade: moldura a menos de 3 px do corte é o próprio corte
        if (i && DENTRO[lado] * (i.c - (e ? e.c : BORDA[lado])) * esc < 3) { i = null; duvida = false; }
      }
      ext[lado] = e ? { c: e.c, k: e.k } : { c: BORDA[lado], k: 0 };
      sExt[lado] = e ? e.sigma : null;
      // Sem pico confiável, a moldura começa a 4,5% pra dentro e o lado entra
      // em "confira esta borda".
      int[lado] = i ? { c: i.c, k: i.k } : { c: ext[lado].c + DENTRO[lado] * 0.045, k: ext[lado].k };
      sInt[lado] = i ? i.sigma : null;
      if (!e || !i || duvida) confere.push(lado);
      // "fraca": a moldura foi posta, mas numa aresta fraca (ou ficou a forte
      // com a faixa dizendo outra coisa) — a interface avisa "pode errar em
      // arte clara". Os outros lados do confere são os sem moldura achada.
      if (i && duvida) fracas.push(lado);
    }
    return { ext, int, sigma: { ext: sExt, int: sInt }, confere, fraca: fracas };
  }

  // ===========================================================================
  // 9) Ímã ao soltar uma linha (F1b, §5.5): janela em unidades da carta,
  // candidatos por tipo, o mais perto de onde a linha foi solta.
  // ===========================================================================
  function ima(img, cantos, linha, o) {
    if (!img || !linha || !quadValido(cantos) || !(linha.lado in VERT)) return null;
    const lado = linha.lado, L = { c: linha.c, k: linha.k || 0 };
    const m = squareToQuad(cantos), mi = inverte(m), esc = escalaLado(m, lado, L);
    if (!(esc > 0)) return null;
    const J = max(1 / esc, (o && o.janela) || 8 / esc), mg = 14 / esc;
    const perfis = perfisLado(img, m, mi, lado, L, -J - mg, J + mg, 41, 0.15, 0.85);
    if (perfis.length < 12) return null;
    const G = agrega(perfis, -J - mg, J + mg, 0.5 / esc), agg = G.agg, a = G.idx(-J), b = G.idx(J);
    const naJanela = (k) => k >= a && k <= b && destaca(agg, k, a, b);
    let cs;
    const ref = o && o.ref;
    if (linha.tipo === "int") {
      cs = picos(agg, a, b, 0.4).filter(naJanela);
      // Moldura: só aresta por DENTRO do corte (2 px de folga).
      if (ref != null) cs = cs.filter((k) => DENTRO[lado] * (linha.c + DENTRO[lado] * G.off(k) - ref) > 2 / esc);
    } else {
      cs = degrausAgregados(perfis, G, a, b, esc, lado, naJanela);
      // Sleeve justo (a mesma regra do refino): dois degraus colados, a menos
      // de uma aresta de plástico, com vale fundo entre eles — o de fora é o
      // plástico (a aresta de dentro dele se fundiu com o corte) ou a parede;
      // o corte é o de dentro. Sem isto, soltar a linha no plástico (o "mais
      // perto da soltura") a deixava lá, agora que a busca por perfil não
      // pula mais pro D maior do lado.
      const lp = linhaPx(esc, lado);
      for (let q = 0; q + 1 < cs.length;) {
        const k0 = cs[q], k1 = cs[q + 1];
        let vl = INF;
        for (let z = k0 + 1; z < k1; z++) if (agg[z] < vl) vl = agg[z];
        if (0.5 * (k1 - k0) <= lp && vl <= 0.5 * min(agg[k0], agg[k1])) cs.splice(q, 1); else q++;
      }
    }
    // Moldura com o corte conhecido: a saída da faixa da borda (a mesma regra
    // da sugestão), se ela cai na janela e ANTES do 1º pico forte. Sem isto,
    // soltar a linha na aresta fraca de uma borda clara com arte clara a
    // arrancava pra aresta forte de dentro. Perfis próprios, do corte pra
    // dentro: os da janela nem sempre alcançam a faixa. Só com um pico forte
    // na janela (o caso que a regra corrige): sem nenhum, o ímã segue
    // devolvendo null — com borrão forte numa borda fina a faixa não chega a
    // ter cor própria e a saída dela erra 1–2 px (bancada, 2026-10-02).
    if (linha.tipo === "int" && ref != null && cs.length) {
      const oRef = DENTRO[lado] * (ref - linha.c), oLoB = oRef - 6 / esc, oHiB = J + mg;
      if (oHiB - oLoB > 16 / esc) {
        const pB = perfisLado(img, m, mi, lado, L, oLoB, oHiB, 41, 0.15, 0.85);
        const GB = agrega(pB, oLoB, oHiB, 0.5 / esc), ag = GB.agg;
        // borrão do corte: o pico do agregado a ±3 px do corte informado
        let kCorte = -1;
        for (let q = max(1, GB.idx(oRef - 3 / esc)); q <= min(ag.length - 2, GB.idx(oRef + 3 / esc)); q++) if (kCorte < 0 || ag[q] > ag[kCorte]) kCorte = q;
        const sb = kCorte > 0 ? 0.5 * sigmaPico(ag, kCorte) : 1;
        const fb = pB.length >= 12 ? molduraPorFaixa(pB, GB, oRef, esc, J, GB.idx(-J), GB.idx(J), sb, GB.idx(G.off(cs[0]))) : null;
        const oB = fb ? GB.off(fb.k) : NaN;
        if (oB >= -J && oB <= J && DENTRO[lado] * (linha.c + DENTRO[lado] * oB - ref) > 2 / esc && oB < G.off(cs[0]) - 1 / esc) {
          const r = linhaMedida(img, m, mi, lado, pB, GB, fb.k, oRef + 0.5 * (oB - oRef));
          if (r) return { c: r.c, k: r.k, sigma: r.sigma, candidatos: cs.length + 1 };
        }
      }
    }
    if (!cs.length) return null;
    // Moldura: a PRIMEIRA aresta por dentro do corte (os bins crescem pra
    // dentro), não a mais perto — solta 8 px pra dentro, a mais perto seria a
    // da faixa da moldura pra arte. Corte: o degrau mais perto da soltura.
    let kc = cs[0];
    if (linha.tipo !== "int") for (const k of cs) if (abs(G.off(k)) < abs(G.off(kc))) kc = k;
    const oRef = linha.tipo === "int" && ref != null ? DENTRO[lado] * (ref - linha.c) : null;
    const r = linhaMedida(img, m, mi, lado, perfis, G, kc, oRef == null ? undefined : oRef + 0.5 * (G.off(kc) - oRef));
    if (!r) return null;
    return { c: r.c, k: r.k, sigma: r.sigma, candidatos: cs.length };
  }

  // ===========================================================================
  // 10) Giro da moldura no espaço MÉTRICO (§6.4): em (u,v) um giro θ viraria
  // cisalhamento (com proporção 0,716, as verticais girariam 0,716θ e as
  // horizontais 1,397θ). graus > 0 = sentido horário na tela (y pra baixo).
  // ===========================================================================
  function giraMoldura(int, graus, preset) {
    int = normaliza(int);
    const W = (preset && preset.W) || 63, H = (preset && preset.H) || 88;
    const th = (graus || 0) * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
    // centro = encontro das linhas médias (esq/dir e topo/base)
    const cu = 0.5 * (int.l.c + int.r.c), ku = 0.5 * (int.l.k + int.r.k), cv = 0.5 * (int.t.c + int.b.c), kv = 0.5 * (int.t.k + int.b.k);
    const u0 = (cu + ku * (cv - 0.5) - 0.5 * ku * kv) / (1 - ku * kv), v0 = cv + kv * (u0 - 0.5);
    const X0 = u0 * W, Y0 = v0 * H;
    const gira = (u, v) => { const X = u * W - X0, Y = v * H - Y0; return [(X0 + cs * X - sn * Y) / W, (Y0 + sn * X + cs * Y) / H]; };
    const out = {};
    for (const lado of ["l", "r", "t", "b"]) {
      const L = int[lado], vert = VERT[lado];
      const p = vert ? gira(linhaEm(L, 0), 0) : gira(0, linhaEm(L, 0)), q = vert ? gira(linhaEm(L, 1), 1) : gira(1, linhaEm(L, 1));
      const k = vert ? (q[0] - p[0]) / (q[1] - p[1]) : (q[1] - p[1]) / (q[0] - p[0]);
      out[lado] = { c: vert ? p[0] + k * (0.5 - p[1]) : p[1] + k * (0.5 - p[0]), k };
    }
    return out;
  }

  // ===========================================================================
  // 11) Medida e incerteza (§4.6, §6.8)
  // ===========================================================================
  const PRESETS = { "63x88": { W: 63, H: 88 }, "59x86": { W: 59, H: 86 } };
  const T_PONTAS = [0.15, 0.85];
  // Variância dos t de 41 perfis uniformes em [0,15; 0,85]: com ela, o σ de uma
  // reta ajustada vale σ_c·√(1 + (t−½)²/VAR_T) no t (fator 1,96 nas pontas) e
  // a inclinação tem σ_k = σ_c/√VAR_T.
  const VAR_T = (0.7 * 0.7 / 12) * 42 / 40;
  const ESPESSURA = 0.3; // mm (§6.8)
  const PISO = 0.2; // pt; calibrado pelo p90 do corpus depois (§10.3)

  // 0/0 → 50 e margem negativa → 0 (a v1 já fazia o 50/50 no total zero).
  function pct(a, b) {
    if (!(a > 0)) a = 0;
    if (!(b > 0)) b = 0;
    const s = a + b;
    return s > 0 ? 100 * a / s : 50;
  }
  const maior = (x) => (x > 50 ? x : 100 - x);

  // Linha de um lado mapeada pela foto pra outra homografia (cantos com erro):
  // a reta física fica onde está e só muda a coordenada da carta. Externa
  // "colada" na borda do quadrilátero (F1a, sem ímã) anda com o canto.
  function remapeia(L, lado, colada, m0, mi1) {
    if (colada) return L;
    const vert = VERT[lado];
    const p0 = vert ? aplica(m0, linhaEm(L, 0), 0) : aplica(m0, 0, linhaEm(L, 0));
    const p1 = vert ? aplica(m0, linhaEm(L, 1), 1) : aplica(m0, 1, linhaEm(L, 1));
    const a = aplica(mi1, p0[0], p0[1]), b = aplica(mi1, p1[0], p1[1]);
    const k = vert ? (b[0] - a[0]) / (b[1] - a[1]) : (b[1] - a[1]) / (b[0] - a[0]);
    return { c: vert ? a[0] + k * (0.5 - a[1]) : a[1] + k * (0.5 - a[0]), k };
  }

  function medir(linhas, o) {
    o = o || {};
    const preset = o.preset || PRESETS["63x88"], W = preset.W, H = preset.H;
    const ext = normaliza(linhas.ext), int = normaliza(linhas.int), sg = o.sigma || null;
    const cantos = o.cantos && quadValido(o.cantos, 0.01) ? o.cantos : null;
    const m = cantos ? squareToQuad(cantos) : null;
    const esc = {};
    for (const lado of ["l", "r", "t", "b"]) esc[lado] = m ? escalaLado(m, lado, { c: BORDA[lado], k: 0 }) : 0;
    // σ da linha posta à mão, em px da foto: um número (vale pras 8) ou, como
    // manda a §6.8, um por linha — { ext: {l,r,t,b}, int: {…} }, gravado no
    // momento em que cada uma foi posta (~½ px de TELA no zoom daquela hora).
    // Com um número só, a última linha ajustada ditava o ± das outras 7.
    // Linha sem valor no mapa: 0,5 px, o padrão.
    const sMan = o.sigmaManualPx;
    const sManDe = (tipo, lado) => {
      const v = sMan && typeof sMan === "object" ? (sMan[tipo] ? sMan[tipo][lado] : null) : sMan;
      return v > 0 ? v : 0.5;
    };
    // σ de uma linha no t: número = reta ajustada (posição + inclinação); null
    // = posta à mão (só posição).
    const sigLinha = (tipo, lado, t) => {
      const s = sg && sg[tipo] ? sg[tipo][lado] : null;
      if (typeof s === "number" && isFinite(s)) return s * sqrt(1 + (t - 0.5) * (t - 0.5) / VAR_T);
      return esc[lado] > 0 ? sManDe(tipo, lado) / esc[lado] : 0.001;
    };
    const sigK = (tipo, lado) => {
      const s = sg && sg[tipo] ? sg[tipo][lado] : null;
      return typeof s === "number" && isFinite(s) ? s / sqrt(VAR_T) : 0;
    };
    const colada = {};
    for (const lado of ["l", "r", "t", "b"]) colada[lado] = abs(ext[lado].c - BORDA[lado]) < 1e-9 && abs(ext[lado].k) < 1e-9;
    const margens = (E, I, A, B, t) => [linhaEm(I[A], t) - linhaEm(E[A], t), linhaEm(E[B], t) - linhaEm(I[B], t)];

    // Paralaxe da espessura (§6.8): a parede de ~0,3 mm aparece por fora do
    // corte SÓ do lado mais perto da câmera, e a homografia (do plano da face)
    // não corrige. Com a focal e o preset, sai a posição da câmera e a largura
    // projetada da parede de cada lado; sem eles, o limite ortográfico pelo
    // ângulo (ou o pior caso de 20°), que é sempre maior.
    const mmMeio = {
      lr: margens(ext, int, "l", "r", 0.5).map((x) => x * W),
      tb: margens(ext, int, "t", "b", 0.5).map((x) => x * H),
    };
    const e = o.espessura > 0 ? o.espessura : ESPESSURA, par = { lr: 0, tb: 0 };
    const foto = o.foto;
    if (cantos && foto && foto.focal35 > 0 && foto.w > 0 && foto.h > 0) {
      const C = centroCamera(cantos, foto.w, foto.h, foto.focal35, W, H), alt = -C[2];
      if (alt > 0) {
        const d = (x) => e * max(0, x) / (alt + e);
        const efeito = (ab, dA, dB) => abs(pct(ab[0], ab[1]) - pct(ab[0] - dA, ab[1] - dB));
        par.lr = efeito(mmMeio.lr, d(-C[0]), d(C[0] - W));
        par.tb = efeito(mmMeio.tb, d(-C[1]), d(C[1] - H));
      }
    } else {
      const th = (o.poseGraus == null || !isFinite(o.poseGraus) ? 20 : min(60, abs(o.poseGraus))) * Math.PI / 180;
      const dl = e * Math.tan(th);
      for (const ax of ["lr", "tb"]) {
        const a = max(0, mmMeio[ax][0]), b = max(0, mmMeio[ax][1]);
        par[ax] = a + b > 0 ? 100 * dl * max(a, b) / ((a + b) * (a + b)) : 0;
      }
    }

    const eixo = (ax, A, B) => {
      const p = (t) => { const mg = margens(ext, int, A, B, t); return pct(mg[0], mg[1]); };
      const meio = p(0.5), pa = p(T_PONTAS[0]), pb = p(T_PONTAS[1]);
      const tPior = maior(pa) >= maior(pb) ? T_PONTAS[0] : T_PONTAS[1], pior = tPior === T_PONTAS[0] ? pa : pb;
      const m0 = margens(ext, int, A, B, 0.5), a0 = max(0, m0[0]), b0 = max(0, m0[1]), s0 = a0 + b0;
      // σdif: só as inclinações separam o pior do meio (posições somem na
      // diferença). Piso de 0,05 pt: numa foto limpa a covariância fica
      // minúscula e o "pior" ganharia por 0,02 pt de textura; abaixo de 0,1 pt
      // de diferença vale o meio, que é o mais estável.
      const vka = sigK("ext", A) ** 2 + sigK("int", A) ** 2, vkb = sigK("ext", B) ** 2 + sigK("int", B) ** 2;
      const sDif = max(0.05, s0 > 0 ? abs(tPior - 0.5) * 100 / (s0 * s0) * sqrt(b0 * b0 * vka + a0 * a0 * vkb) : 0);
      const decide = maior(pior) - maior(meio) > 2 * sDif ? "pior" : "meio";
      const t = decide === "pior" ? tPior : 0.5, usado = decide === "pior" ? pior : meio;
      // σ do ajuste no t lido
      const mt = margens(ext, int, A, B, t), a = max(0, mt[0]), b = max(0, mt[1]), s = a + b;
      const va = sigLinha("ext", A, t) ** 2 + sigLinha("int", A, t) ** 2, vb = sigLinha("ext", B, t) ** 2 + sigLinha("int", B, t) ** 2;
      const sAj = s > 0 ? 100 / (s * s) * sqrt(b * b * va + a * a * vb) : 0;
      // σ do canto: Jacobiano numérico, mapeando as linhas pela foto.
      let sCanto = 0;
      if (cantos) {
        const sc = o.sigmaCantoPx, ep = 0.5;
        const pCom = (q) => {
          const mi1 = inverte(squareToQuad(q)), E = {}, I = {};
          for (const l of [A, B]) { E[l] = remapeia(ext[l], l, colada[l], m, mi1); I[l] = remapeia(int[l], l, false, m, mi1); }
          const mg = margens(E, I, A, B, t);
          return pct(mg[0], mg[1]);
        };
        let v = 0;
        for (let i = 0; i < 4; i++) {
          const si = Array.isArray(sc) ? sc[i] : sc > 0 ? sc : 1;
          for (let c = 0; c < 2; c++) {
            const q1 = cantos.map((p) => p.slice()), q2 = cantos.map((p) => p.slice());
            q1[i][c] += ep; q2[i][c] -= ep;
            const dp = (pCom(q1) - pCom(q2)) / (2 * ep);
            v += dp * dp * si * si;
          }
        }
        sCanto = sqrt(v);
      }
      const sigma = sqrt(sAj * sAj + sCanto * sCanto + par[ax] * par[ax] + PISO * PISO);
      return { meio, pior, usado, sigma, sigmaDif: sDif, decide, tPior, partes: { ajuste: sAj, canto: sCanto, paralaxe: par[ax], piso: PISO } };
    };

    let bordaPx = null;
    if (m) {
      bordaPx = INF;
      for (const lado of ["l", "r", "t", "b"]) {
        const P = (L) => (VERT[lado] ? aplica(m, linhaEm(L, 0.5), 0.5) : aplica(m, 0.5, linhaEm(L, 0.5)));
        const p = P(ext[lado]), q = P(int[lado]);
        bordaPx = min(bordaPx, sqrt((p[0] - q[0]) * (p[0] - q[0]) + (p[1] - q[1]) * (p[1] - q[1])));
      }
    }
    return {
      lr: eixo("lr", "l", "r"),
      tb: eixo("tb", "t", "b"),
      mm: { l: mmMeio.lr[0], r: mmMeio.lr[1], t: mmMeio.tb[0], b: mmMeio.tb[1] },
      sigmaParalaxe: max(par.lr, par.tb),
      bordaPx,
    };
  }

  // ===========================================================================
  // 12) Formatação: a nota é decidida pela 1 casa, e os dois lados sempre
  // somam 100,0 (o segundo é 100 − o primeiro, nunca arredondado sozinho).
  // ===========================================================================
  // O +1e-9 desempata o "meio" que o binário guarda um tiquinho abaixo
  // (55,05 vira 55,049999…): o par arredonda pra cima como se lê.
  const arred1 = (p) => round(p * 10 + 1e-9) / 10;

  function par(p) {
    if (typeof p !== "number" || !isFinite(p)) return [50, 50];
    if (p <= 0) return [0, 100];
    if (p >= 100) return [100, 0];
    const a = arred1(p);
    return [a, round((100 - a) * 10) / 10];
  }

  function fmt(n, lang, casas) {
    if (casas == null) casas = 1;
    if (typeof n !== "number" || !isFinite(n)) return "";
    const f = Math.pow(10, casas), x = round(n * f + 1e-9) / f;
    const s = (x === 0 ? 0 : x).toFixed(casas);
    return /^en/i.test(lang || "") ? s : s.replace(".", ",");
  }

  const raiz = typeof window !== "undefined" ? window : globalThis;
  raiz.TCGCenteringCore = {
    lerCabecalho, squareToQuad, inverte, aplica, quadValido, poseGraus,
    amostra, achata, refinaCantos, sugereLinhas, ima, linhaEm, giraMoldura,
    medir, par, arred1, fmt, PRESETS,
    // Peças internas expostas só pros testes e pra bancada (não é contrato).
    interno: { ajustaReta, retaBorda, perfil, centroide, picos, centroCamera, LUT, VAR_T },
  };
})();
