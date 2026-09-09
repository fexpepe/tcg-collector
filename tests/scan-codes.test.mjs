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
