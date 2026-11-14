// Testes do padrão dos logos (scripts/lib/logo-padrao.mjs, docs/LOGOS.md):
// leitura do cabeçalho sem decodificar, as contas de nitidez por lugar, a
// conta do teto e a avaliação que o scripts/check-logos.mjs usa no CI.
// Sem sharp e sem rede.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LUGARES, PADRAO, ALVO_DENSIDADE, PISO_DENSIDADE, tipoDoArquivo, lerCabecalho, densidades,
  pedidoPelosLugares, tamanhoMinimo, svgTemBitmap, medePixels, avalia, lugaresDo
} from "../scripts/lib/logo-padrao.mjs";
import { tipoDoArquivo as _t } from "../scripts/lib/logo-padrao.mjs";

// ── Cabeçalhos sintéticos ───────────────────────────────────────────────────
const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u24le = (n) => Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255]);
function png(largura, altura, tipoCor, { trns = false } = {}) {
  const ihdr = Buffer.concat([u32be(largura), u32be(altura), Buffer.from([8, tipoCor, 0, 0, 0])]);
  const chunk = (nome, dados) => Buffer.concat([u32be(dados.length), Buffer.from(nome, "latin1"), dados, Buffer.alloc(4)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), ...(trns ? [chunk("tRNS", Buffer.from([0]))] : []), chunk("IDAT", Buffer.alloc(2)), chunk("IEND", Buffer.alloc(0))
  ]);
}
const riff = (...chunks) => { const corpo = Buffer.concat([Buffer.from("WEBP"), ...chunks]); return Buffer.concat([Buffer.from("RIFF"), u32le(corpo.length), corpo]); };
const chunkWebp = (nome, dados) => Buffer.concat([Buffer.from(nome, "latin1"), u32le(dados.length), dados, dados.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
const vp8l = (l, a, alfa) => chunkWebp("VP8L", Buffer.concat([Buffer.from([0x2f]), u32le((l - 1) | ((a - 1) << 14) | ((alfa ? 1 : 0) << 28)), Buffer.alloc(4)]));
const vp8 = (l, a) => {
  const d = Buffer.alloc(10); d[3] = 0x9d; d[4] = 0x01; d[5] = 0x2a; d.writeUInt16LE(l, 6); d.writeUInt16LE(a, 8);
  return chunkWebp("VP8 ", d);
};
const vp8x = (l, a, flags) => chunkWebp("VP8X", Buffer.concat([Buffer.from([flags, 0, 0, 0]), u24le(l - 1), u24le(a - 1)]));
function jpeg(largura, altura) {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 8, altura >> 8, altura & 255, largura >> 8, largura & 255, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

test("cabeçalho: PNG com e sem alfa (RGBA, paleta com tRNS, RGB)", () => {
  assert.deepEqual(lerCabecalho(png(1000, 500, 6)), { formato: "png", largura: 1000, altura: 500, alfa: true, perda: "sem perda" });
  assert.equal(lerCabecalho(png(600, 200, 3, { trns: true })).alfa, true);
  assert.equal(lerCabecalho(png(600, 200, 3, { trns: true })).perda, "paleta");
  assert.equal(lerCabecalho(png(600, 200, 2)).alfa, false);
});

test("cabeçalho: WebP sem perda (VP8L), com perda (VP8) e estendido (VP8X)", () => {
  assert.deepEqual(lerCabecalho(riff(vp8l(512, 262, true))), { formato: "webp", largura: 512, altura: 262, alfa: true, perda: "sem perda" });
  assert.equal(lerCabecalho(riff(vp8l(300, 116, false))).alfa, false);
  assert.deepEqual(lerCabecalho(riff(vp8(496, 182))), { formato: "webp", largura: 496, altura: 182, alfa: false, perda: "com perda" });
  const x = lerCabecalho(riff(vp8x(640, 213, 0x10), chunkWebp("ALPH", Buffer.alloc(3)), vp8(640, 213)));
  assert.deepEqual(x, { formato: "webp", largura: 640, altura: 213, alfa: true, animado: false, perda: "com perda" });
  assert.equal(lerCabecalho(riff(vp8x(10, 10, 0x12), vp8l(10, 10, true))).animado, true);
});

test("cabeçalho: JPEG não tem alfa; SVG é vetor", () => {
  assert.deepEqual(lerCabecalho(jpeg(496, 182)), { formato: "jpeg", largura: 496, altura: 182, alfa: false, perda: "com perda" });
  assert.equal(lerCabecalho(Buffer.from('<?xml version="1.0"?>\n<svg viewBox="0 0 10 10"></svg>')).formato, "svg");
});

// Desde 2026-11-14 não sobra PNG de logo no repositório (os 14 do Lorcana
// viraram WebP): o PNG fica nos testes sintéticos acima, e aqui vão os
// formatos que o site serve de verdade.
test("os logos de verdade do repositório são lidos (WebP com e sem perda, SVG)", () => {
  const ler = (p) => lerCabecalho(readFileSync(new URL(`../${p}`, import.meta.url)));
  const lorcana = ler("data/lorcana/set-logos/1.webp");
  assert.equal(lorcana.formato, "webp");
  assert.equal(lorcana.perda, "com perda");
  assert.ok(lorcana.largura > 0 && lorcana.altura > 0 && lorcana.alfa);
  const grandArchive = ler("assets/games/game_grandarchive-v2.webp");
  assert.equal(grandArchive.formato, "webp");
  assert.equal(grandArchive.perda, "sem perda");
  assert.ok(grandArchive.largura > 0 && grandArchive.alfa);
  assert.equal(ler("data/magic/set-logos/10e.svg").formato, "svg");
});

test("tipo pelo caminho", () => {
  assert.equal(tipoDoArquivo("assets/games/game_pokemon.webp"), "jogo");
  assert.equal(tipoDoArquivo("assets/games/set_cdm_hxh.webp"), "set");
  assert.equal(tipoDoArquivo("assets/games/game_naruto.svg"), "jogo");
  assert.equal(tipoDoArquivo("assets/games/README.md"), null);
  assert.equal(tipoDoArquivo("data/lorcana/set-logos/14.png"), "set");
  assert.equal(tipoDoArquivo("data/set-logos/en/base1.webp"), "set");
  assert.equal(tipoDoArquivo("data/set-logos/symbol/base1.webp"), "simbolo");
  assert.equal(tipoDoArquivo("data/magic/set-logos/10e.svg"), "simbolo");
  assert.equal(tipoDoArquivo("assets/brand/Magic-The-Gathering-logo.png"), null); // fonte, não logo servido
  assert.equal(_t("data\\fab\\set-logos\\AUR.webp"), "set"); // barra do Windows
});

// ── Lugares e densidade ─────────────────────────────────────────────────────
test("hub (desktop): a fórmula bate com o tamanho medido no sleevu.app em 2026-11-14", () => {
  const hub = LUGARES.jogo.find((l) => l.nome === "hub (desktop)");
  // [arquivo L×A, largura pintada medida em px CSS]
  for (const [L, A, medido] of [[512, 131, 285], [300, 116, 241], [512, 262, 216], [512, 367, 170], [471, 117, 288]]) {
    assert.ok(Math.abs(hub.css(L / A) - medido) <= 1.5, `${L}×${A}: ${hub.css(L / A).toFixed(1)} × ${medido}`);
  }
});

test("densidade: o pior lugar vem primeiro, e jogo vintage soma o \"Sobre\"", () => {
  const d = densidades("set", 672, 141);
  assert.equal(d[0].lugar, "vitrine do topo (desktop)");
  assert.ok(Math.abs(d[0].densidade - 672 / 385) < 1e-9);
  const lotr = densidades("jogo", 200, 172, { vintage: true });
  assert.equal(lotr[0].lugar, "\"Sobre\" (desktop)");
  assert.ok(lotr[0].densidade < 1.2); // o borrado que a medição achou (1,1× no "Sobre")
  assert.ok(!densidades("jogo", 200, 172).some((x) => x.lugar.includes("Sobre")));
});

test("teto: cobre o que todo lugar pede (css × dpr) em qualquer proporção", () => {
  for (const [tipo, opcoes, pad] of [["jogo", {}, PADRAO.jogo], ["jogo", { vintage: true }, PADRAO.jogoVintage], ["set", {}, PADRAO.set], ["simbolo", {}, PADRAO.simbolo]]) {
    for (let r = 0.4; r <= 8; r += 0.05) {
      const pedido = pedidoPelosLugares(tipo, r, opcoes);
      const cabeL = Math.min(pad.teto[0], pad.teto[1] * r); // largura do arquivo encaixado no teto
      assert.ok(cabeL + 0.5 >= pedido.largura, `${tipo}${opcoes.vintage ? " vintage" : ""} r=${r.toFixed(2)}: teto dá ${cabeL.toFixed(0)}, lugares pedem ${pedido.largura.toFixed(0)}`);
    }
  }
});

test("teto não sobra demais: está a no máximo 10% do que o lugar mais exigente pede", () => {
  for (const [tipo, opcoes, pad] of [["jogo", {}, PADRAO.jogo], ["jogo", { vintage: true }, PADRAO.jogoVintage], ["set", {}, PADRAO.set]]) {
    let maxL = 0, maxA = 0;
    for (let r = 0.4; r <= 8; r += 0.05) { const p = pedidoPelosLugares(tipo, r, opcoes); maxL = Math.max(maxL, p.largura); maxA = Math.max(maxA, p.altura); }
    assert.ok(pad.teto[0] <= maxL * 1.1 && pad.teto[1] <= maxA * 1.1, `${tipo}: teto ${pad.teto} × pedido ${maxL.toFixed(0)}×${maxA.toFixed(0)}`);
  }
});

test("tamanho mínimo pra ficar nítido", () => {
  const m = tamanhoMinimo("set", 672, 141);
  assert.ok(m.largura >= 770 && m.largura <= 771);
  assert.ok(densidades("set", m.largura, m.altura)[0].densidade >= ALVO_DENSIDADE - 1e-9);
});

// ── Pixels ──────────────────────────────────────────────────────────────────
function tela(L, A, pinta) {
  const px = new Uint8Array(L * A * 4);
  for (let y = 0; y < A; y++) for (let x = 0; x < L; x++) { const a = pinta(x, y); if (a) { const i = (y * L + x) * 4; px[i] = 200; px[i + 3] = a; } }
  return px;
}

test("pixels: margem de cada lado, véu de fundo e borda antisserrilhada", () => {
  // Tinta de x 10..89, y 5..24 num quadro 100×30; uma faixa de alfa 5 (véu) no canto,
  // longe da tinta; e alfa 5 grudado na borda da tinta (antisserrilhado, não conta).
  const L = 100, A = 30;
  const px = tela(L, A, (x, y) => {
    if (x >= 10 && x < 90 && y >= 5 && y < 25) return 255;
    if (x === 9 && y >= 5 && y < 25) return 5;     // borda
    if (x < 4 && y < 3) return 5;                   // véu: 12 px
    return 0;
  });
  const m = medePixels(px, L, A);
  assert.deepEqual(m.margem, { esquerda: 10, topo: 5, direita: 10, base: 5 });
  assert.ok(Math.abs(m.veu - 12 / (L * A)) < 1e-12);
  assert.ok(m.transparente > 0.4);
  assert.equal(medePixels(new Uint8Array(4 * 4 * 4), 4, 4).vazio, true);
});

test("SVG com bitmap dentro não é vetor", () => {
  assert.ok(svgTemBitmap('<svg><image href="data:image/png;base64,AAAA"/></svg>'));
  assert.ok(svgTemBitmap("<svg><image xlink:href='logo.png' /></svg>"));
  assert.ok(!svgTemBitmap('<svg><path d="M0 0h10v10z"/></svg>'));
});

// ── Avaliação ───────────────────────────────────────────────────────────────
const regras = (p) => p.map((x) => `${x.nivel}:${x.regra}`).sort();
const pixelsOk = { vazio: false, margem: { esquerda: 2, topo: 2, direita: 2, base: 2 }, veu: 0, transparente: 0.4 };

test("avaliação: o logo no padrão passa", () => {
  const cab = { formato: "webp", largura: 640, altura: 213, alfa: true, perda: "com perda" };
  assert.deepEqual(avalia({ tipo: "jogo", bytes: 26 * 1024, cabecalho: cab, pixels: pixelsOk }), []);
});

test("avaliação: PNG gigante e pesado do Lorcana", () => {
  const cab = { formato: "png", largura: 1000, altura: 500, alfa: true, perda: "paleta" };
  const pixels = { ...pixelsOk, margem: { esquerda: 47, topo: 17, direita: 48, base: 17 } };
  assert.deepEqual(regras(avalia({ tipo: "set", bytes: 175 * 1024, cabecalho: cab, pixels })), ["erro:formato", "erro:peso", "erro:recorte", "erro:teto"]);
});

test("avaliação: nitidez — borrado é erro, macio é aviso", () => {
  const cab = (L, A) => ({ formato: "webp", largura: L, altura: A, alfa: true, perda: "com perda" });
  // One Piece da Bandai, 672×141: 1,75× na vitrine (desktop) → aviso.
  assert.deepEqual(regras(avalia({ tipo: "set", bytes: 20000, cabecalho: cab(672, 141) })), ["aviso:macio"]);
  // LOTR 200×172 no "Sobre": 1,1× → erro.
  assert.deepEqual(regras(avalia({ tipo: "jogo", vintage: true, bytes: 18000, cabecalho: cab(200, 172) })), ["erro:nitidez"]);
  // Jogo moderno não tem o "Sobre": o pior lugar é o hub. O Magic no padrão
  // (640×213) fica nítido; o Grand Archive de hoje (300×116) borra no hub.
  assert.deepEqual(avalia({ tipo: "jogo", bytes: 26000, cabecalho: cab(640, 213) }), []);
  const ga = avalia({ tipo: "jogo", bytes: 5000, cabecalho: cab(300, 116) });
  assert.deepEqual(regras(ga), ["erro:nitidez"]);
  assert.match(ga[0].msg, /hub \(desktop\)/);
});

test("avaliação: sem alfa, fundo opaco, véu e animado", () => {
  const jpg = { formato: "jpeg", largura: 496, altura: 182, alfa: false, perda: "com perda" };
  assert.ok(regras(avalia({ tipo: "jogo", bytes: 23000, cabecalho: jpg })).includes("erro:alfa"));
  const webp = { formato: "webp", largura: 600, altura: 200, alfa: true, perda: "com perda" };
  assert.ok(regras(avalia({ tipo: "set", bytes: 9000, cabecalho: webp, pixels: { ...pixelsOk, transparente: 0.01 } })).includes("erro:alfa"));
  assert.ok(regras(avalia({ tipo: "set", bytes: 9000, cabecalho: webp, pixels: { ...pixelsOk, veu: 0.12 } })).includes("erro:veu"));
  assert.ok(regras(avalia({ tipo: "set", bytes: 9000, cabecalho: { ...webp, animado: true } })).includes("erro:animado"));
});

test("avaliação: SVG só olha bitmap embutido e peso", () => {
  const svg = { formato: "svg", largura: 0, altura: 0, alfa: true, perda: "vetor" };
  assert.deepEqual(avalia({ tipo: "simbolo", bytes: 2000, cabecalho: svg, svgTexto: "<svg><path/></svg>" }), []);
  assert.deepEqual(regras(avalia({ tipo: "simbolo", bytes: 40 * 1024, cabecalho: svg, svgTexto: '<svg><image href="data:image/png;base64,A"/></svg>' })), ["erro:peso", "erro:svg"]);
});

test("piso abaixo do alvo, e todo tipo tem lugar e teto", () => {
  assert.ok(PISO_DENSIDADE < ALVO_DENSIDADE);
  for (const tipo of ["jogo", "set", "simbolo"]) {
    assert.ok(lugaresDo(tipo).length > 0);
    assert.ok(PADRAO[tipo].teto[0] > 0 && PADRAO[tipo].pesoKB > 0);
  }
});

// ── Exceções e caçador ──────────────────────────────────────────────────────
test("exceções: todo registro é de um logo, cala regra que existe e diz o motivo", () => {
  const exc = JSON.parse(readFileSync(new URL("../scripts/data/logos-excecoes.json", import.meta.url), "utf8"));
  const conhecidas = new Set(["formato", "animado", "alfa", "teto", "peso", "nitidez", "recorte", "veu", "svg"]);
  for (const [caminho, e] of Object.entries(exc)) {
    assert.ok(tipoDoArquivo(caminho), `${caminho} não é caminho de logo`);
    assert.ok(Array.isArray(e.regras) && e.regras.length && e.regras.every((r) => conhecidas.has(r)), `${caminho}: regras ${e.regras}`);
    assert.ok(typeof e.motivo === "string" && e.motivo.length >= 20, `${caminho}: motivo curto demais`);
  }
});

test("o caçador de logos de set normaliza pelo padrão (sem quadro fixo próprio)", () => {
  const fonte = readFileSync(new URL("../scripts/cacar-logos-set.mjs", import.meta.url), "utf8");
  assert.match(fonte, /from "\.\/lib\/logo-padrao\.mjs"/);
  assert.ok(!/width: 1000, height: 500/.test(fonte));
});
