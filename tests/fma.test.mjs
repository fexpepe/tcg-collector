// Testes do sync do Fullmetal Alchemist Carddass (scripts/sync-fma.mjs, o
// jogo vintage fma): o id pegajoso pelo id da carta na fonte, a raridade, o
// tipo, o nome do set, a lista transcrita dos scans contra o snapshot e as
// cartas que a fonte lista sem scan.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SETS, SERIES, ID_PREFIX, assignIds, raridade, tipoDe, setName, setNameEn, setIdOf, scanDe, IMG, cartasDoJogo, SEM_SCAN
} from "../scripts/sync-fma.mjs";

const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SNAP = JSON.parse(ler("data/vintage/fma-carddass.json"));
const NOMES = JSON.parse(ler("scripts/data/fma-nomes.json"));

test("id: parte + número impresso; o id GRUDA no src e carta que some da fonte fica", () => {
  const pagina = [{ src: 1, num: "C-001", rar: "Super Rare", dir: "47/106" }, { src: 2, num: "B-001", rar: "Normal", dir: "47/106" }];
  const primeira = assignIds("f1", pagina, []);
  assert.deepEqual(primeira.map((c) => c.id), ["fma-f1-c-001", "fma-f1-b-001"]);
  const depois = assignIds("f1", [pagina[1], pagina[0]], primeira);
  assert.deepEqual(depois.map((c) => [c.src, c.id]), [[2, "fma-f1-b-001"], [1, "fma-f1-c-001"]]);
  const some = assignIds("f1", [pagina[0]], primeira);
  assert.deepEqual(some.map((c) => c.id), ["fma-f1-c-001", "fma-f1-b-001"]);
  // número repetido na mesma parte ganha sufixo
  assert.deepEqual(assignIds("pl1", [{ src: 5, num: "1" }, { src: 6, num: "1" }], []).map((c) => c.id), ["fma-pl1-1", "fma-pl1-1b"]);
});

test("raridade: a Regular do site é a Common do card game; o resto passa", () => {
  assert.equal(raridade("Normal"), "Common");
  assert.equal(raridade("Regular"), "Common");
  assert.equal(raridade("Uncommon"), "Uncommon");
  assert.equal(raridade("Super Rare"), "Super Rare");
});

test("tipo: o impresso no topo vale; sem leitura, o prefixo do número", () => {
  assert.equal(tipoDe("C-001", "Main Character"), "Main Character");
  assert.equal(tipoDe("C-087", ""), "Character");
  assert.equal(tipoDe("B-086"), "Battle");
  assert.equal(tipoDe("E-001"), "Event");
  assert.equal(tipoDe("1"), "");
});

test("set: o produto abre o nome (sem o 鋼の錬金術師 nem o jogo); o inglês é o do nomes-sets.js", () => {
  const win = {};
  new Function("window", ler("src/nomes-sets.js"))(win);
  const VINTAGE_SET_EN = win.SLEEVU_NOMES_SETS.vintage;
  for (const def of SETS) {
    assert.ok(!/^(鋼の錬金術師|Fullmetal|カードダス|Carddass)/i.test(setName(def)), setName(def));
    assert.equal(VINTAGE_SET_EN[setIdOf(def.code)], setNameEn(def), `${def.code}: inglês fora do nomes-sets.js`);
    assert.match(def.date, /^\d{4}-\d{2}$/);
    assert.ok(SERIES[def.series]);
  }
  assert.equal(setName(SETS[0]), "ALCHEMIC CARD BATTLE FILE.1");
  assert.equal(setIdOf("pl3"), `${ID_PREFIX}pl3`);
});

test("snapshot: as faixas de número de cada FILE do Card Check Box, sem buraco", () => {
  const FAIXAS = {
    f1: { C: [1, 21], B: [1, 21], E: [1, 15] }, f2: { C: [22, 54], B: [22, 54], E: [16, 45] },
    f3: { C: [55, 84], B: [55, 78], E: [46, 68] }, f4: { C: [85, 108], B: [79, 99], E: [69, 90] }
  };
  for (const [code, faixas] of Object.entries(FAIXAS)) {
    const nums = SNAP.sets.find((s) => s.code === code).cards.map((c) => c.num);
    const esperado = [];
    for (const [p, [a, b]] of Object.entries(faixas)) for (let n = a; n <= b; n++) esperado.push(`${p}-${String(n).padStart(3, "0")}`);
    assert.deepEqual([...nums].sort(), esperado.sort(), code);
  }
  assert.deepEqual(["pl1", "pl2", "pl3"].map((c) => SNAP.sets.find((s) => s.code === c).cards.length), [10, 10, 9]);
});

test("lista: todo número existe no snapshot, e toda carta com scan tem nome", () => {
  for (const s of SNAP.sets) {
    const lista = NOMES[s.code] || [];
    const nums = new Set(s.cards.map((c) => String(c.num)));
    for (const l of lista) {
      assert.ok(nums.has(String(l.n)), `${s.code} ${l.n}: fora do snapshot`);
      assert.ok(l.en && l.en.trim(), `${s.code} ${l.n}: sem inglês`);
      if (s.code.startsWith("f")) assert.ok(["Main Character", "Support Character", "Battle", "Event"].includes(l.tipo), `${s.code} ${l.n}: tipo ${l.tipo}`);
    }
    const comNome = new Set(lista.map((l) => String(l.n)));
    for (const c of s.cards) if (!SEM_SCAN[c.src]) assert.ok(comNome.has(String(c.num)), `${s.code} ${c.num}: com scan e sem nome`);
  }
});

test("cartas: nome, japonês, tipo e imagem; as sem scan ficam sem imagem e com o número", () => {
  const cards = cartasDoJogo(SNAP);
  assert.equal(cards.length, 326);
  assert.equal(new Set(cards.map((c) => c.id)).size, cards.length);
  const ed = cards.find((c) => c.id === "fma-f1-c-001");
  assert.equal(ed.name, "Edward Elric");
  assert.equal(ed.nameJp, "エドワード・エルリック");
  assert.equal(ed.cardType, "Main Character");
  assert.equal(ed.set, "ALCHEMIC CARD BATTLE FILE.1");
  assert.match(ed.image, /^https:\/\/wsrv\.nl\/\?url=www\.animecollection\.fr%2Fcartes%2F47%2F106%2Fh3000_/);
  const semScan = cards.filter((c) => !c.image).map((c) => c.id).sort();
  assert.deepEqual(semScan, ["fma-f4-b-086", "fma-f4-b-087", "fma-f4-c-087", "fma-f4-c-089"]);
  for (const c of cards.filter((x) => !x.image)) assert.equal(c.name, `No. ${c.number}`);
  const placa = cards.find((c) => c.id === "fma-pl1-1");
  assert.equal(placa.cardType, undefined);
  assert.equal(placa.vintageLine, "jumbo");
  assert.ok(cards.every((c) => c.vintage && c.language === "ja" && !c.setLogo));
  assert.equal(IMG(scanDe({ dir: "30/62", src: 2416 })), "https://wsrv.nl/?url=www.animecollection.fr%2Fcartes%2F30%2F62%2Fh3000_2416_carte.jpg&w=440&output=webp");
});
