// Um setId = um set (2026-11-22). Ver scripts/lib/setid-unico.mjs.
//
// Dois grupos do TCGplayer com a mesma abreviação caíam no mesmo setId, e um
// dos sets ficava sem cartão na tela de Sets: 27 sets e 1.847 cartas em
// 21/11/2026 (Yu-Gi-Oh! 19, Flesh and Blood 6, Digimon 1, Fusion World 1).
// Os groupIds abaixo são os da TCGCSV naquele dia.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { desempataSetIds } from "../scripts/lib/setid-unico.mjs";
import { codigoDoSet as codigoNoTitulo } from "../functions/_lib/pagina-carta.js";
import { codigoDoSet as codigoDoCartao } from "../scripts/lib/codigo-do-set.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const mudo = () => {};

// Monta `cards` e `marcas` como um sync faz: os grupos entram em ordem, cada
// um empurra as suas cartas. grupos: [groupId, abreviação, nº de cartas].
function sync(grupos) {
  const cards = [], marcas = [];
  for (const [groupId, abbr, n] of grupos) {
    const setId = abbr || String(groupId);
    marcas.push({ groupId, setId, de: cards.length });
    for (let i = 0; i < n; i++) cards.push({ id: `c-${groupId}-${i}`, setId, grupo: groupId });
  }
  return { cards, marcas };
}
const idsPorGrupo = (cards) => {
  const m = {};
  for (const c of cards) { (m[c.grupo] = m[c.grupo] || new Set()).add(c.setId); }
  return Object.fromEntries(Object.entries(m).map(([g, s]) => [g, [...s].join("+")]));
};

test("o grupo de menor groupId fica com o código; os outros levam o sufixo", () => {
  // Metal Raiders: a edição original (22882) e a de 25 anos (23052).
  const { cards, marcas } = sync([[23052, "MRD-EN", 144], [22882, "MRD-EN", 144], [1290, "LC01", 6]]);
  const mudados = desempataSetIds(cards, marcas, {}, mudo);
  assert.deepEqual(idsPorGrupo(cards), { 22882: "MRD-EN", 23052: "MRD-EN-23052", 1290: "LC01" });
  assert.deepEqual(mudados, [{ groupId: 23052, de: "MRD-EN", para: "MRD-EN-23052", cartas: 144 }]);
});

test("a ordem em que a fonte lista os grupos não muda quem fica com o código", () => {
  const a = sync([[24176, "GEM", 32], [24334, "GEM", 36], [24446, "GEM", 36]]);
  const b = sync([[24446, "GEM", 36], [24334, "GEM", 36], [24176, "GEM", 32]]);
  desempataSetIds(a.cards, a.marcas, {}, mudo);
  desempataSetIds(b.cards, b.marcas, {}, mudo);
  const esperado = { 24176: "GEM", 24334: "GEM-24334", 24446: "GEM-24446" };
  assert.deepEqual(idsPorGrupo(a.cards), esperado);
  assert.deepEqual(idsPorGrupo(b.cards), esperado);
});

test("grupo só com selados (sem carta) não disputa o código", () => {
  // Duelist Pack Collection Tin: 22964 tem a mesma abreviação e zero cartas.
  // E as seis abreviações repetidas do Yu-Gi-Oh! em que só UM grupo tem carta
  // (ex.: DP07, grupos 187 e 239) não podem mudar de id.
  const { cards, marcas } = sync([[22964, "DPCT", 0], [192, "DPCT", 10], [134, "DPCT", 10], [187, "DP07", 0], [239, "DP07", 30]]);
  desempataSetIds(cards, marcas, {}, mudo);
  assert.deepEqual(idsPorGrupo(cards), { 134: "DPCT", 192: "DPCT-192", 239: "DP07" });
});

test("setId fixo vence a regra e tira o grupo da disputa", () => {
  // Digimon: o evento de lançamento (24824) divide "BT-26" com o booster
  // (24623). Fixado em BT-26_PR, como a fonte escreve os outros eventos.
  const dgm = sync([[24824, "BT-26", 49], [24623, "BT-26", 136], [24000, "BT-25_PR", 49]]);
  desempataSetIds(dgm.cards, dgm.marcas, { 24824: "BT-26_PR" }, mudo);
  assert.deepEqual(idsPorGrupo(dgm.cards), { 24623: "BT-26", 24824: "BT-26_PR", 24000: "BT-25_PR" });
  // Fusion World: a fonte repetiu FB03_AR no New Adventure, que é o FB05.
  const fw = sync([[23823, "FB03_AR", 8], [24311, "FB03_AR", 1]]);
  desempataSetIds(fw.cards, fw.marcas, { 24311: "FB05_AR" }, mudo);
  assert.deepEqual(idsPorGrupo(fw.cards), { 23823: "FB03_AR", 24311: "FB05_AR" });
});

test("fixo que cai num id vivo para o sync, em vez de juntar dois sets de novo", () => {
  const { cards, marcas } = sync([[1, "AAA", 3], [2, "BBB", 3]]);
  assert.throws(() => desempataSetIds(cards, marcas, { 2: "AAA" }, mudo), /setId "AAA" ficaria com dois grupos/);
});

test("sem abreviação repetida nada muda (inclusive grupo sem abreviação)", () => {
  const { cards, marcas } = sync([[10, "OP01", 5], [11, "", 4], [12, "OP02", 5]]);
  const antes = cards.map((c) => c.setId);
  assert.deepEqual(desempataSetIds(cards, marcas, {}, mudo), []);
  assert.deepEqual(cards.map((c) => c.setId), antes);
  assert.equal(cards[5].setId, "11");
});

test("só as cartas do grupo que perdeu o código mudam, na faixa dele", () => {
  const { cards, marcas } = sync([[50, "X", 2], [40, "X", 3], [60, "Y", 1]]);
  desempataSetIds(cards, marcas, {}, mudo);
  assert.deepEqual(cards.map((c) => c.setId), ["X-50", "X-50", "X", "X", "X", "Y"]);
});

test("o sufixo do desempate não vaza pro título da página da carta", () => {
  // Yu-Gi-Oh!: o número da carta já traz o código, então o título fica sem ele.
  assert.equal(codigoNoTitulo({ setId: "MRD-EN-23052", number: "MRD-EN001" }), "");
  assert.equal(codigoNoTitulo({ setId: "MRD-EN", number: "MRD-EN001" }), "");
  // Flesh and Blood: o código é o do set, sem o groupId.
  assert.equal(codigoNoTitulo({ setId: "GEM-24334", number: "007" }), "GEM");
  // Star Wars já tinha ids assim (o sync dele desempata desde antes).
  assert.equal(codigoNoTitulo({ setId: "P26-24784", number: "12" }), "P26");
  // Os fixos e os códigos comuns seguem como eram.
  assert.equal(codigoNoTitulo({ setId: "BT-26_PR", number: "P-200" }), "BT-26");
  assert.equal(codigoNoTitulo({ setId: "OP16", number: "079" }), "OP16");
  assert.equal(codigoNoTitulo({ setId: "EB-01", number: "010" }), "EB-01");
  assert.equal(codigoNoTitulo({ setId: "sstc-2000", number: "1" }), "", "id sem maiúscula nunca foi código");
});

test("os dois sets fixados seguem com o selo certo no cartão do set", () => {
  // O selo do cartão sai do id por regex no Digimon e no Fusion World: o
  // evento de lançamento mostra BT26, como os outros, e o New Adventure, FB05.
  assert.equal(codigoDoCartao("digimon", { id: "BT-26_PR", name: "Timeless Bonds Release Event Cards" }, []), "BT26");
  assert.equal(codigoDoCartao("digimon", { id: "BT-26", name: "Timeless Bonds" }, []), "BT26");
  assert.equal(codigoDoCartao("dbfw", { id: "FB05_AR", name: "New Adventure Alternate Art Reprints" }, []), "FB05");
});

test("todo sync que tira o setId da abreviação do grupo passa pelo desempate", () => {
  // A linha `g.abbreviation || String(g.groupId)` sem o desempate depois é o
  // bug: um sync novo copiado de um destes volta a esconder set.
  const dir = join(raiz, "scripts");
  const culpados = [];
  for (const arq of readdirSync(dir).filter((f) => /^sync-.*\.mjs$/.test(f))) {
    const src = readFileSync(join(dir, arq), "utf8");
    if (!/g\.abbreviation \|\| String\(g\.groupId\)/.test(src)) continue;
    if (!/marcas\.push\(\{ groupId: g\.groupId, setId, de: cards\.length \}\);/.test(src) || !/desempataSetIds\(cards, marcas/.test(src)) culpados.push(arq);
  }
  assert.deepEqual(culpados, []);
});
