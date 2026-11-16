// Testes do sync da Pokémon Carddass (scripts/sync-pokemon-carddass.mjs, o
// jogo vintage pcd): as listas transcritas dos checklists impressos, o id
// (com a cor nas Partes 1 e 2), as cartas especiais, a raridade e o scan das
// Partes 3 e 4 pelo animecollection, e o nome do set (e o endereço que sai
// dele). Sem rede: o snapshot versionado e fixtures.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SETS, CORES, ESPECIAIS, ID_PREFIX, LISTAS, setIdOf, cartasDaParte, numeroImpresso, scanDe, IMG, cartasDoJogo } from "../scripts/sync-pokemon-carddass.mjs";
import { slugify } from "../functions/_lib/slug-carta.js";
import { chaveBase } from "../scripts/lib/img-mirror.mjs";

const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SNAP = JSON.parse(ler("data/vintage/pokemon-carddass.json"));
const dex = (code) => LISTAS.partes[code].map(Number);
const de1a151 = Array.from({ length: 151 }, (_, i) => i + 1);
const semCurada = () => "";

test("listas: as Partes 1 e 2 dividem os 151, e as 3 e 4 também", () => {
  for (const [a, b, na, nb] of [["p1", "p2", 75, 76], ["p3", "p4", 74, 77]]) {
    assert.equal(dex(a).length, na, a);
    assert.equal(dex(b).length, nb, b);
    const juntas = [...dex(a), ...dex(b)].sort((x, y) => x - y);
    assert.deepEqual(juntas, de1a151, `${a}+${b} não cobre 1–151 sem repetir`);
  }
  // número impresso com três dígitos, em ordem
  for (const code of ["p1", "p2", "p3", "p4"]) {
    const l = LISTAS.partes[code];
    assert.ok(l.every((n) => /^\d{3}$/.test(n)), code);
    assert.deepEqual(l, l.slice().sort(), `${code} fora de ordem`);
  }
});

test("listas: vale o checklist impresso, que põe a 046 na Parte 1 e a 045 na Parte 2 (a Bulbapedia troca)", () => {
  assert.ok(LISTAS.partes.p1.includes("046") && !LISTAS.partes.p1.includes("045"));
  assert.ok(LISTAS.partes.p2.includes("045") && !LISTAS.partes.p2.includes("046"));
  assert.match(LISTAS._partes, /045.*046/);
});

test("nomes: os 151 em japonês, todos diferentes, na grafia do checklist", () => {
  const nomes = Object.entries(LISTAS.pokemon);
  assert.equal(nomes.length, 151);
  assert.equal(new Set(nomes.map(([, v]) => v)).size, 151);
  assert.ok(nomes.every(([k, v]) => /^\d{3}$/.test(k) && /^[ァ-ヶー♀♂ィ]+$/.test(v)), "nome fora do katakana");
  assert.equal(LISTAS.pokemon["025"], "ピカチュウ");
  assert.equal(LISTAS.pokemon["029"], "ニドラン♀");
  assert.equal(LISTAS.pokemon["032"], "ニドラン♂");
  assert.equal(LISTAS.pokemon["151"], "ミュウ");
});

test("id: Partes 1 e 2 com a cor (verde e vermelha de cada Pokémon), 3 e 4 sem", () => {
  const p1 = cartasDaParte("p1");
  assert.ok(p1.some((c) => c.id === "pcd-p1-g-025") && p1.some((c) => c.id === "pcd-p1-r-025"));
  assert.ok(cartasDaParte("p3").some((c) => c.id === "pcd-p3-025"));
  assert.ok(cartasDaParte("p4").some((c) => c.id === "pcd-p4-carddass"));
  const ids = SETS.flatMap((s) => cartasDaParte(s.code).map((c) => c.id));
  assert.equal(new Set(ids).size, ids.length, "id repetido");
  assert.ok(ids.every((id) => id.startsWith(ID_PREFIX) && /^pcd-p[1-4]-([grb]-)?[a-z0-9]+$/.test(id)), "id fora do formato");
  // contagem por parte: 75×2+3, 76×2+4, 74+1, 77+1
  assert.deepEqual(SETS.map((s) => cartasDaParte(s.code).length), [153, 156, 75, 78]);
});

test("especiais: como cada uma se imprime, e a Title Card EX é azul", () => {
  assert.deepEqual(ESPECIAIS.p1.map((e) => e.num), ["000", "152", "153"]);
  assert.deepEqual(ESPECIAIS.p2.map((e) => e.num), ["000", "154", "155", "156"]);
  assert.ok(ESPECIAIS.p1.every((e) => e.cor === "g"));
  assert.deepEqual(ESPECIAIS.p2.map((e) => e.cor), ["r", "r", "r", "b"]);
  assert.equal(CORES.b, "Blue");
  assert.deepEqual([ESPECIAIS.p3[0].num, ESPECIAIS.p4[0].num], ["000", "CARDDASS"]);
});

test("número da fonte -> impresso", () => {
  assert.equal(numeroImpresso("1"), "001");
  assert.equal(numeroImpresso("0"), "000");
  assert.equal(numeroImpresso("151"), "151");
  assert.equal(numeroImpresso("CARDDASS"), "CARDDASS");
});

test("snapshot do animecollection: as 153 cartas das Partes 3 e 4, cada número da lista com a sua", () => {
  assert.equal(SNAP.cards.length, 153);
  const nums = new Set(SNAP.cards.map((c) => numeroImpresso(c.num)));
  for (const code of ["p3", "p4"]) {
    for (const c of cartasDaParte(code)) assert.ok(nums.has(c.num), `${c.id}: sem carta na fonte`);
  }
  for (const c of SNAP.cards) assert.ok(Number.isInteger(c.src) && /^\d+\/\d+$/.test(c.dir), JSON.stringify(c));
  // 16 prismas, a Mew de metal e as duas especiais (Bulbapedia: "16 cards are
  // holographic prism cards and one is a rainbow holofoil mew")
  const rar = {};
  for (const c of SNAP.cards) rar[c.rar] = (rar[c.rar] || 0) + 1;
  assert.deepEqual(rar, { Normal: 134, Prism: 16, Metal: 1, Promo: 2 });
});

test("catálogo: nome inglês e japonês, cor, raridade e imagem só onde há fonte", () => {
  const ingles = { 25: "Pikachu", 151: "Mew" };
  const snap = { cards: [{ src: 4811, num: "25", rar: "Prism", dir: "59/130" }, { src: 4942, num: "CARDDASS", rar: "Promo", dir: "59/130" }] };
  const cartas = cartasDoJogo(snap, ingles, LISTAS, semCurada);
  const por = new Map(cartas.map((c) => [c.id, c]));
  const g = por.get("pcd-p1-g-025");
  assert.deepEqual([g.name, g.nameJp, g.color, g.set, g.setId, g.number, g.setTotal, g.rarity, g.image, g.artist], ["Pikachu (Green)", "ピカチュウ", "Green", "パート1", "pcd-p1", "025", 153, "", "", "Ken Sugimori"]);
  // a verde e a vermelha levam a cor no nome (sem ela, dois quadros iguais na grade)
  assert.deepEqual([por.get("pcd-p1-r-025").name, por.get("pcd-p1-r-025").color], ["Pikachu (Red)", "Red"]);
  const ex = por.get("pcd-p2-b-156");
  assert.deepEqual([ex.name, ex.nameJp, ex.color, ex.artist], ["Title Card EX", "タイトルカードEX", "Blue", ""]);
  const p3 = por.get("pcd-p3-025");
  assert.equal(p3.name, "Pikachu");
  assert.deepEqual([p3.rarity, p3.color, p3.artist, p3.setReleaseDate], ["Prism", undefined, "", "1997-04"]);
  assert.equal(p3.image, IMG(scanDe({ src: 4811, dir: "59/130" })));
  const sp = por.get("pcd-p4-carddass");
  assert.deepEqual([sp.name, sp.nameJp, sp.number, sp.rarity], ["Special Carddass", undefined, "CARDDASS", "Promo"]);
  // sem a carta na fonte: sem imagem e sem raridade, nunca inventado
  assert.deepEqual([por.get("pcd-p4-151").image, por.get("pcd-p4-151").rarity], ["", ""]);
  assert.ok(cartas.every((c) => c.vintage === true && c.language === "ja" && !("price" in c)));
});

test("catálogo inteiro do snapshot: toda carta com nome; Partes 3 e 4 com imagem e raridade", () => {
  const ingles = Object.fromEntries(de1a151.map((n) => [n, `P${n}`]));
  const cartas = cartasDoJogo(SNAP, ingles, LISTAS, semCurada);
  assert.equal(cartas.length, 462);
  assert.ok(cartas.every((c) => !/^No\. /.test(c.name)));
  const p34 = cartas.filter((c) => /^pcd-p[34]-/.test(c.id));
  assert.ok(p34.every((c) => c.image && c.rarity), "carta das Partes 3–4 sem imagem ou raridade");
});

test("imagem: o scan grande pelo wsrv, e o espelho do R2 guarda pela URL de origem", () => {
  const c = { src: 4811, dir: "59/130" };
  assert.equal(scanDe(c), "www.animecollection.fr/cartes/59/130/h3000_4811_carte.jpg");
  assert.equal(chaveBase(IMG(scanDe(c))), "wsrv.nl/www.animecollection.fr/cartes/59/130/h3000_4811_carte.jpg");
});

test("set: o nome é a parte, sem o jogo na frente, e o endereço não depende da ordem do catálogo", () => {
  for (const s of SETS) assert.match(s.ja, /^パート[1-4]$/);
  // a mesma conta do scripts/lib/paginas-de-set.mjs, sem o desempate -2
  const slugs = SETS.map((s) => {
    let base = slugify(s.ja) || slugify(setIdOf(s.code));
    if (base.length < 4) base = `${slugify(setIdOf(s.code))}-${base}`;
    return base;
  });
  assert.equal(new Set(slugs).size, slugs.length);
});

test("nome em inglês dos sets (src/nomes-sets.js) é o `en` do sync", () => {
  const fonte = ler("src/nomes-sets.js");
  const noArquivo = Object.fromEntries([...fonte.matchAll(/^\s*"(pcd-p\d)": ("(?:[^"\\]|\\.)*"),?$/gm)].map((m) => [m[1], JSON.parse(m[2])]));
  assert.deepEqual(noArquivo, Object.fromEntries(SETS.map((s) => [setIdOf(s.code), s.en])));
});
