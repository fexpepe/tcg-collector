// Extração de código de carta do texto que o OCR devolve (src/scan.js). É a
// função que decide o que vai pra busca — se ela perde um "OP05-119" ou inventa
// um "4/102" a partir de uma data, o scanner "não acha" ou acha a carta errada,
// e a pessoa não tem como saber que o problema é a regex e não a foto.
//
// Os textos de entrada imitam o que o Tesseract devolve de verdade: caixa alta
// (whitelist), lixo em volta, quebras de linha e as confusões clássicas (O por
// 0, I por 1) em posições numéricas.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
function load() {
  const sandbox = {
    console,
    document: { querySelector: () => null, getElementById: () => null },
    location: { origin: "https://sleevu.app" }
  };
  sandbox.window = sandbox;
  sandbox.window.TCGShared = { t: (k) => k, escapeHtml: String, escapeAttribute: String };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(here, "..", "src", "scan.js"), "utf8"), sandbox);
  return sandbox.window.TCGScan;
}
const S = load();
const codigos = (txt) => Array.from(S.extrairCodigos(txt));

test("One Piece: código com hífen no rodapé, com lixo em volta", () => {
  assert.deepEqual(codigos("©2023 EIICHIRO ODA\nOP05-119 SR  L"), ["OP05-119"]);
  assert.deepEqual(codigos("EB01-001 C")[0], "EB01-001");
});

test("Digimon, Gundam, DBFW e Yu-Gi-Oh seguem o mesmo molde", () => {
  assert.equal(codigos("BT1-001 R")[0], "BT1-001");
  assert.equal(codigos("ST01-001")[0], "ST01-001");
  assert.equal(codigos("EXB-001 RR")[0], "EXB-001");
  assert.equal(codigos("FB01-001")[0], "FB01-001");
  assert.equal(codigos("LOB-EN001 1ST EDITION")[0], "LOB-EN001");
});

test("confusão de OCR na parte numérica é corrigida; no prefixo a letra fica", () => {
  // "OP" é prefixo (letras); "O5" e "II9" são numéricos: O->0, I->1.
  assert.equal(codigos("OPO5-II9")[0], "OP05-119");
  assert.equal(codigos("BTI-OOI")[0], "BT1-001");
  // Fração: "4/1O2" -> 4/102.
  assert.equal(codigos("4/1O2")[0], "4/102");
});

test("Pokémon e Lorcana: fração N/T (zeros à esquerda somem)", () => {
  assert.equal(codigos("ILLUS. MITSUHIRO ARITA  004/102")[0], "4/102");
  assert.equal(codigos("123/198")[0], "123/198");
});

test("Lorcana: número/total · idioma · set vira 'set número' antes da fração", () => {
  const c = codigos("12/204 · EN · 4");
  assert.equal(c[0], "4 12");
  assert.ok(c.includes("12/204"));
});

test("Magic moderno: número e 'SET • IDIOMA' viram 'SET NÚMERO'", () => {
  const c = codigos("0123/0281 R\nMH3 • EN\n™ & © 2024 WIZARDS OF THE COAST");
  assert.equal(c[0], "MH3 123");
});

test("Union Arena e FAB", () => {
  assert.equal(codigos("UE21BT/RLY-1-082")[0], "UE21BT/RLY-1-082");
  assert.equal(codigos("WTR001 - C")[0], "WTR001");
});

test("o mais específico vem primeiro; sem código não inventa nada", () => {
  // Um código com hífen vale mais que uma fração solta no mesmo texto.
  const c = codigos("OP01-001 12/24");
  assert.equal(c[0], "OP01-001");
  assert.deepEqual(codigos(""), []);
  assert.deepEqual(codigos("PIKACHU HP 60"), []);
  // Fração com total zero é lixo (não existe set de 0 cartas).
  assert.deepEqual(codigos("3/0"), []);
});

test("candidatos não se repetem e têm teto", () => {
  const c = codigos("OP01-001 OP01-001 OP01-002 OP01-003 OP01-004 OP01-005 OP01-006 OP01-007");
  assert.equal(new Set(c).size, c.length);
  assert.ok(c.length <= 6);
});

// ── Detecção do JOGO ──────────────────────────────────────────────────────────
// O bug que motivou isto: uma carta de Pokémon ("4/102") voltava Lorcana (set
// "4") e Magic (número 4), porque a busca cruzava os 13 jogos e a ordenação
// só olhava o número.
const detecta = (txt, codigos, sessao) => {
  const d = S.detectarJogo(txt, codigos, sessao);
  return { top: d.jogos[0], confiante: d.confiante, restritos: Array.from(d.restritos) };
};

test("Pokémon: o rodapé impresso decide, mesmo com fração ambígua", () => {
  const d = detecta("ILLUS. MITSUHIRO ARITA 4/102 1999 NINTENDO CREATURES GAME FREAK", ["4/102"]);
  assert.equal(d.top, "pokemon");
  assert.equal(d.confiante, true);
  assert.deepEqual(d.restritos, ["pokemon", "lorcana", "riftbound"]);
});

test("Magic e Lorcana pelo copyright; One Piece pelo autor", () => {
  assert.equal(detecta("0123/0281 R MH3 EN TM AND 2024 WIZARDS OF THE COAST", ["MH3 123"]).top, "magic");
  assert.equal(detecta("12/204 EN 4 DISNEY", ["4 12", "12/204"]).top, "lorcana");
  assert.equal(detecta("2023 EIICHIRO ODA SHUEISHA OP05-119", ["OP05-119"]).top, "onepiece");
});

test("só o formato do código: restringe aos jogos possíveis sem cravar", () => {
  const d = detecta("OP05-119 SR", ["OP05-119"]);
  assert.equal(d.top, "onepiece");
  assert.deepEqual(d.restritos, ["onepiece"]);
  const frac = detecta("4/102", ["4/102"]);
  assert.equal(frac.confiante, false);
  assert.deepEqual(frac.restritos, ["lorcana", "pokemon", "riftbound"]);
  assert.equal(detecta("LOB-EN001 1ST EDITION", ["LOB-EN001"]).top, "ygo");
  assert.equal(detecta("BT1-001 R", ["BT1-001"]).top, "digimon");
});

test("o jogo da sessão desempata, mas não vence uma pista impressa", () => {
  const d = detecta("4/102", ["4/102"], "pokemon");
  assert.equal(d.top, "pokemon");
  assert.equal(d.confiante, false); // 3 pontos por formato+sessão, mas Lorcana tem 2: não é "certeza"
  assert.equal(detecta("DISNEY 12/204", ["12/204"], "pokemon").top, "lorcana");
});

test("sem pista nenhuma, ninguém é restringido", () => {
  const d = detecta("", []);
  assert.deepEqual(d.restritos, []);
  assert.equal(d.confiante, false);
});
