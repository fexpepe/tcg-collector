// Captura e diagnóstico do scanner (src/scan.js), 2026-11-01. Em campo, com
// cartas de DBFW e Pokémon, o scanner errou com luz ruim — e nada dizia em que
// etapa. O que se trava aqui:
//   - a NITIDEZ que escolhe o melhor quadro da rajada do disparo: o quadro
//     nítido ganha do borrado da mesma cena, e o mais escuro não ganha só por
//     ter ruído;
//   - o RELATÓRIO do diagnóstico: uma linha por etapa, sem quebrar com campo
//     faltando, e sem nada além de texto;
//   - a fiação: a rajada no lugar do quadro único, o diagnóstico ligado pelo
//     toque longo, só na memória, e o `scan_done` contando as leituras com
//     pouca luz.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const scanSrc = readFileSync(join(here, "..", "src", "scan.js"), "utf8").replace(/\r\n/g, "\n");
function load() {
  const sandbox = {
    console,
    document: { querySelector: () => null, getElementById: () => null },
    location: { origin: "https://sleevu.app" }
  };
  sandbox.window = sandbox;
  sandbox.window.TCGShared = { t: (k) => k, escapeHtml: String, escapeAttribute: String };
  vm.createContext(sandbox);
  vm.runInContext(scanSrc, sandbox);
  return sandbox.window.TCGScan;
}
const S = load();

// Faixa de código sintética (w×h em cinza): listras verticais de "glifos".
const W = 120, H = 30;
const faixa = (f) => { const g = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = Math.max(0, Math.min(255, Math.round(f(x, y)))); return g; };
const nitida = faixa((x) => (Math.floor(x / 3) % 2 ? 230 : 25));
// Borrão de caixa horizontal de raio r sobre a nítida (o tremor da mão).
const borrada = (r) => faixa((x, y) => {
  let s = 0, n = 0;
  for (let k = -r; k <= r; k++) { const xx = Math.min(W - 1, Math.max(0, x + k)); s += nitida[y * W + xx]; n++; }
  return s / n;
});

test("cinzaDe usa a luminância do preparar()", () => {
  const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 200, 200, 200, 255]);
  assert.deepEqual(Array.from(S.cinzaDe(rgba)), [76, 149, 29, 200]);
});

test("nitidez: o quadro nítido ganha do borrado, e mais borrão vale menos", () => {
  const n0 = S.nitidez(nitida, W, H), n1 = S.nitidez(borrada(1), W, H), n3 = S.nitidez(borrada(3), W, H);
  assert.ok(n0 > n1 && n1 > n3, `${n0} > ${n1} > ${n3}`);
  // Cena lisa (mesa, dedo na frente) não tem nitidez nenhuma.
  assert.equal(S.nitidez(faixa(() => 128), W, H), 0);
  // Amostra menor que 3×3 não quebra.
  assert.equal(S.nitidez(new Uint8Array(4), 2, 2), 0);
});

test("nitidez: o mesmo quadro mais escuro não passa o nítido só por ter contraste menor", () => {
  // Escurecer reduz o salto (menos nitidez medida), mas o quadro escuro e
  // NÍTIDO ainda ganha do claro e borrado: a rajada compara a mesma cena.
  const escura = faixa((x) => (Math.floor(x / 3) % 2 ? 90 : 10));
  assert.ok(S.nitidez(escura, W, H) > S.nitidez(borrada(3), W, H));
});

test("relatório: uma linha por etapa, com o quadro escolhido marcado", () => {
  const txt = S.relatorio({
    t: Date.UTC(2026, 10, 1, 14, 3, 22), modo: "toque",
    fonte: [1920, 1080], rec: [912.4, 1268.9], poi: "0.50,0.81",
    quadros: [{ nitidez: 41.2, brilho: 96, reflexo: 0.004 }, { nitidez: 88, brilho: 97, reflexo: 0.003 }], escolhido: 1,
    passos: [
      { nome: "rodape", w: 1800, h: 412, ms: 420.4, texto: "FB03-036 UC\nSON GOKU", cands: [{ codigo: "FB03-036", peso: 3, conf: 91.2 }] },
      { nome: "carta", w: 1400, h: 1950, ms: 900, texto: "", cands: [] }
    ],
    jogo: { pontos: { pokemon: 1, dbfw: 3 }, confiante: true, busca: ["dbfw"], trava: "" },
    busca: { codigo: "FB03-036", n: 2, cartas: ["Son Goku", "Son Goku (Alternate Art)"] },
    foto: { mudou: true, claro: false, notas: [0.712, 0.6] },
    ms: 2100.2
  });
  const L = txt.split("\n");
  assert.equal(L[0], "sleevu scan · 2026-11-01 14:03:22 · toque");
  assert.equal(L[1], "fonte 1920x1080 · carta 912x1269 · foco 0.50,0.81");
  assert.equal(L[2], "quadros nitidez 41 88* · luz 97 · reflexo 0.3%");
  assert.ok(L.includes("#1 rodape 1800x412 420ms"));
  assert.ok(L.includes("   | FB03-036 UC") && L.includes("   | SON GOKU"));
  assert.ok(L.includes("   -> FB03-036 p3 c91"));
  // Etapa sem texto nem código: um traço, não uma linha vazia.
  assert.ok(L.includes("#2 carta 1400x1950 900ms") && L.includes("   | -") && L.includes("   -> -"));
  assert.ok(L.includes("jogo dbfw:3 pokemon:1 ! · busca dbfw"));
  assert.ok(L.includes("achou FB03-036 -> 2 · Son Goku | Son Goku (Alternate Art)"));
  assert.ok(L.includes("foto mudou · 0.71 0.60"));
  assert.equal(L[L.length - 1], "total 2100ms");
});

test("relatório: leitura da galeria, sem rajada nem busca, não quebra", () => {
  const txt = S.relatorio({ t: 0, modo: "galeria", fonte: [4000, 3000], rec: [4000, 3000], poi: "", quadros: null, escolhido: -1, passos: [], erro: "leitor sem resposta" });
  assert.match(txt, /· galeria$/m);
  assert.match(txt, /foco padrao/);
  assert.doesNotMatch(txt, /quadros|achou|foto |total/);
  assert.match(txt, /^erro leitor sem resposta$/m);
  assert.equal(S.relatorio(null), "");
});

test("o disparo lê o quadro mais nítido da rajada, e o congelar() de um quadro fica de reserva", () => {
  assert.match(scanSrc, /cap = await rajada\(rec, auto \? RAJADA\.auto : RAJADA\.toque\)/);
  assert.match(scanSrc, /const quadro = cap \? cap\.canvas : congelar\(\);/);
  // Só UM quadro inteiro na memória: redesenha o mesmo canvas quando um mais nítido chega.
  assert.match(scanSrc, /if \(escolhido < 0 \|\| m\.nitidez > quadros\[escolhido\]\.nitidez\) \{\s*escolhido = k;\s*ctx\.drawImage\(video, 0, 0\);/);
  // O laço ao vivo pausa durante a rajada, e a rajada não começa duas vezes.
  assert.match(scanSrc, /ocupado \|\| disparando\s*\|\| !folha\.hidden/);
  assert.match(scanSrc, /if \(!stream \|\| !video\.videoWidth \|\| ocupado \|\| disparando\) return;/);
});

test("as dicas de luz valem com a leitura automática desligada; ela só não dispara", () => {
  const tick = /function tickAuto\(\) \{[\s\S]*?\n    \}\n/.exec(scanSrc)[0];
  assert.doesNotMatch(tick, /const pausado = !autoLigado/);
  assert.match(tick, /if \(autoLigado\) \{\s*r = passoAuto\(estAuto, m\);/);
  assert.match(tick, /if \(r && r\.disparar\) lerAgora\(true\);/);
  assert.match(tick, /sugerirLanterna\(escuro\);/);
});

test("diagnóstico: toque longo liga, fica só na memória, e o scan_done conta a luz", () => {
  assert.match(scanSrc, /tmSegura = setTimeout\(\(\) => \{ segurou = true; alternarDiag\(\); \}, 1200\);/);
  assert.match(scanSrc, /if \(segurou\) \{ segurou = false; return; \}/);
  // A preferência guarda só o liga/desliga; o relatório e as miniaturas não vão pro storage.
  const sets = scanSrc.match(/localStorage\.setItem\(CHAVE_DIAG[^;]*;/g) || [];
  assert.ok(sets.length >= 1);
  for (const s of sets) assert.doesNotMatch(s, /diagAtual|relatorio|canvas/);
  assert.match(scanSrc, /diagAtual = null; \/\/ as miniaturas do diagnóstico morrem com o scanner/);
  const m = /logEvento\("scan_done",\s*\{([\s\S]{0,360}?)\}\)/.exec(scanSrc);
  assert.ok(m && /\bluz: funil\.luz, luzOk: funil\.luzOk/.test(m[1]), "scan_done sem luz/luzOk");
  assert.match(scanSrc, /if \(captura && captura\.ruim\) \{[^\n]*\n\s*funil\.luz \+= 1;\s*if \(achados\.length\) funil\.luzOk \+= 1;/);
});

// ── Passadas do OCR (2026-11-10) ─────────────────────────────────────────────
// No laboratório (139 cartas reais, foto simulada, só OCR + extração), as seis
// passadas de antes — todas do mesmo tratamento — liam 60 códigos. Trocar as
// redundantes por outra POLARIDADE e outra ESCALA lê 69 com seis, 73 com oito.
test("realcarLocal: texto claro em faixa escura vira tinta escura em fundo claro", () => {
  // Uma faixa escura (40) com um traço claro (200) no meio, ao lado de um
  // bloco claro (230) — o rodapé do One Piece ao lado da borda da carta.
  const w = 60, h = 20, g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = x < 30 ? (y >= 9 && y <= 10 && x >= 8 && x <= 22 ? 200 : 40) : 230;
  const claro = S.realcarLocal(g, w, h, 6, true);
  const traco = claro[9 * w + 15], faixa = claro[3 * w + 15], bloco = claro[3 * w + 50];
  assert.ok(traco < 60, `o traço claro tem de sair escuro (saiu ${traco})`);
  assert.ok(faixa > 170 && bloco > 170, `fundo escuro e fundo claro saem os dois claros (${faixa}, ${bloco})`);
  // Sem `claro`, o contrário: realça o que é mais ESCURO que a vizinhança.
  const escuro = S.realcarLocal(g, w, h, 6, false);
  assert.ok(escuro[9 * w + 15] > 200, "no modo escuro o traço claro some no fundo");
  // Imagem lisa não ganha textura.
  const liso = S.realcarLocal(new Uint8Array(w * h).fill(120), w, h, 6, true);
  assert.ok(liso.every((v) => v === 200));
});

test("plano das passadas: rodapé nos três tratamentos antes da carta inteira; Gundam começa pelo topo", () => {
  const nomes = (jogo) => Array.from(S.planoDasPassadas(jogo), (p) => p[0]);
  const padrao = nomes("");
  assert.deepEqual(padrao.slice(0, 3), ["rodape", "rodape-claro", "rodape-escuro"]);
  assert.ok(padrao.indexOf("carta") > padrao.indexOf("canto-topo"));
  assert.equal(padrao.length, 8);
  // Polaridade e escala variam: não há duas passadas iguais.
  const chaves = Array.from(S.planoDasPassadas(""), (p) => p.slice(1).join("|"));
  assert.equal(new Set(chaves).size, chaves.length);
  // O Gundam imprime o código no ALTO: com o jogo sabido, o topo vem primeiro.
  assert.deepEqual(nomes("gundam").slice(0, 2), ["canto-topo", "topo-claro"]);
  assert.equal(nomes("gundam").length, 8);
  // O laço: busca a cada passada com candidato novo, e para quando a foto confirma.
  assert.match(scanSrc, /for \(const \[nome, fx, fy, fw, fh, largura, modo, origem\] of planoDasPassadas\(jogoSabido\(\)\)\) \{/);
  assert.match(scanSrc, /if \(rr\.estado === "certo" \|\| rr\.estado === "semfoto"\) \{ r = rr; break; \}/);
  assert.match(scanSrc, /if \(performance\.now\(\) - t0 > TETO_PASSADAS\) break;/);
});
