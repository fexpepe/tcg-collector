// Trava de set do scanner (src/scan.js): com o set travado, a busca roda nas
// cartas do set e o NÚMERO basta. É o que resolve o "4/102" do Pokémon (o
// mesmo número/total em vários sets) e o total lido errado, e é o que o
// ManaBox chama de "lock set".
//
// O que se trava aqui:
//   - o número de um código e de uma carta, em todas as escritas do catálogo
//     (fração, prefixo com hífen, "SET NÚMERO", raridade grudada, a barra do
//     Union Arena que não é fração);
//   - a ordem de confiança: código inteiro antes do número sozinho (a
//     reimpressão do One Piece junta OP01-006 e EB01-006 no mesmo set);
//   - a trava é da SESSÃO do scanner e muda a busca e a leitura.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const scanSrc = readFileSync(join(here, "..", "src", "scan.js"), "utf8");
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

test("número de código e de carta, em todas as escritas", () => {
  const casos = {
    "4/102": 4, "009/094": 9, "TG05/TG30": 5, // fração: o de antes da barra
    "OP05-119": 119, "EB01-006": 6, "LOB-EN001": 1, "WTR001": 1, "FB01-001": 1,
    "MH3 123": 123, "4 12": 12, "123a": 123, // Magic "SET NÚMERO", Lorcana "SET NÚMERO", variante com letra
    "BT1-003 R": 3, "BT16-082 SR": 82, // Digimon guarda a raridade junto
    "UE21BT/RLY-1-082": 82, // a barra do Union Arena não é fração
    "7": 7, "007": 7
  };
  for (const [s, n] of Object.entries(casos)) assert.equal(S.numeroDe(s), n, s);
  assert.ok(Number.isNaN(S.numeroDe("")));
  assert.ok(Number.isNaN(S.numeroDe("SVP")));
});

// Formas de busca de uma carta, como o cardCodeForms do shared (o suficiente
// pro teste: o número guardado e a fração).
const formas = (c) => [c.number, c.setTotal ? `${c.number}/${c.setTotal}` : ""].filter(Boolean);

test("código inteiro antes do número: a reimpressão do One Piece junta dois -006", () => {
  const prb = [
    { id: "a", number: "OP01-006", setId: "PRB-01" },
    { id: "b", number: "EB01-006", setId: "PRB-01" },
    { id: "c", number: "EB01-006", setId: "PRB-01" } // a Manga reimpressa: mesma carta, outra versão
  ];
  const r = S.noSet(prb, ["EB01-006"], formas);
  assert.equal(r.codigo, "EB01-006");
  assert.deepEqual(r.cartas.map((x) => x.id), ["b", "c"]);
  // Prefixo lido errado (não existe "EB07-006" no set): cai no número e traz
  // os dois -006 — a foto e a pessoa decidem entre eles.
  assert.deepEqual(S.noSet(prb, ["EB07-006"], formas).cartas.map((x) => x.id), ["a", "b", "c"]);
});

test("Pokémon: com o set travado, o número basta — até com o total lido errado", () => {
  const base = [1, 2, 3, 4, 5].map((n) => ({ id: `base1-${n}`, number: String(n), setTotal: 102 }));
  assert.deepEqual(S.noSet(base, ["4/102"], formas).cartas.map((x) => x.id), ["base1-4"]);
  // "4/182": nenhum set de 182 cartas tem essa carta; travado, o 4 acha.
  assert.deepEqual(S.noSet(base, ["4/182"], formas).cartas.map((x) => x.id), ["base1-4"]);
  // Número digitado sozinho na folha de correção.
  assert.deepEqual(S.noSet(base, ["4"], formas).cartas.map((x) => x.id), ["base1-4"]);
});

test("Digimon: o código lido casa com o número guardado com a raridade", () => {
  const bt1 = [{ id: "u", number: "BT1-003 R" }, { id: "v", number: "BT1-030 U" }];
  const r = S.noSet(bt1, ["BT1-003"], formas);
  assert.deepEqual(r.cartas.map((x) => x.id), ["u"]);
});

test("ordem dos códigos lidos vale; nada casa, null", () => {
  const set = [{ id: "x", number: "010" }, { id: "y", number: "011" }];
  // O 1º código não existe no set; o 2º sim: vence o 2º, e o resultado diz qual.
  const r = S.noSet(set, ["OP05-119", "OP05-011"], formas);
  assert.equal(r.codigo, "OP05-011");
  assert.deepEqual(r.cartas.map((x) => x.id), ["y"]);
  assert.equal(S.noSet(set, ["OP05-119"], formas), null);
  assert.equal(S.noSet(set, [], formas), null);
});

test("a trava é da sessão e muda a busca e a leitura", () => {
  // Estado dentro do abrir(): fechou o scanner, a trava some.
  const abrir = /function abrir\(\) \{[\s\S]*\n  \}\n/.exec(scanSrc)[0];
  assert.match(abrir, /let trava = null;/);
  // Travado, a busca vai pro set; a leitura pula a carta inteira (o jogo já é sabido).
  assert.match(scanSrc, /async function procurar\(codigos\) \{\s*if \(trava\) return procurarNoSet\(codigos\);/);
  assert.match(scanSrc, /!selJogo\.value && !trava && !deteccao\.confiante/);
  // A sugestão vem com três leituras seguidas no mesmo set.
  assert.match(scanSrc, /recentes\.length === 3 && recentes\.every\(\(k\) => k === recentes\[0\]\)/);
});
