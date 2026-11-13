// Promos do Naruto CCG americano que o narutocards não tem
// (scripts/naruto-ccg-promos.mjs → data/vintage/naruto-ccg-promos.json →
// sync-naruto-ccg.mjs), sem rede. O que este teste trava: carta cujo número o
// catálogo já tem não entra de novo, o número impresso repetido da Bandai
// (PR-018 missão × PR-018 ninja) vira duas cartas com ids diferentes, e as
// promos novas não tiram nem trocam nenhum id publicado.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { promosNovas, NUMERO_IMPRESSO } from "../scripts/naruto-ccg-promos.mjs";
import { codigoCanonico } from "../scripts/naruto-ccg-complemento.mjs";
import { montaLinha } from "../scripts/sync-naruto-ccg.mjs";
import { slugsDasCartas } from "../functions/_lib/slug-carta.js";

const json = (arq) => JSON.parse(readFileSync(new URL(`../${arq}`, import.meta.url), "utf8"));
const snap = json("data/vintage/naruto-ccg.json");
const comp = json("data/vintage/naruto-ccg-complemento.json");
const dp = json("data/vintage/naruto-ccg-numero-impresso.json");
const promos = json("data/vintage/naruto-ccg-promos.json");

const linha = (num, nome, img) => ({ "Collector Number": num, "Printed Name": nome, image_path: img || `promos/${num.toLowerCase().replace(/-/g, "")}.webp` });

test("promos: só entra número que o catálogo não tem; linha repetida do N-CCG-DB entra uma vez", () => {
  const grupo = [
    linha("PR-001", "Naruto Uzumaki"), linha("PR-010", "Hokage Rocks"), linha("PR-048", "Popularity"),
    linha("PR-048", "Popularity"), linha("N-086", "Sasuke Uchiha", "promos/n086ae.webp")
  ];
  const { cards, fora } = promosNovas(grupo, new Set(["PR010", "N086"]), new Set());
  assert.deepEqual(cards.map((c) => c.code), ["PR-001", "PR-048"]);
  assert.deepEqual(fora, { jaNoCatalogo: ["PR-010", "N-086"], repetida: ["PR-048"] });
  assert.deepEqual(cards[0], { code: "PR-001", name: "Naruto Uzumaki", rarity: "Promo", img: "promos/pr001.webp" });
});

test("promos: o B do N-CCG-DB não é impresso — o número fica PR-018 e o id sai do código com B", () => {
  // A PR-018 do catálogo é a missão "Naruto vs Sasuke"; a carta nova é o
  // ninja "The First Hokage", que a Bandai também imprimiu como "PR 018".
  const { cards } = promosNovas([linha("PR-018B", "The First Hokage")], new Set(["PR018"]), new Set(["nrt-ccg-pr-018"]));
  assert.deepEqual(cards, [{ code: "PR-018B", numero: "PR-018", name: "The First Hokage", rarity: "Promo", img: "promos/pr018b.webp" }]);
});

test("promos: código que é id publicado de OUTRA carta ganha -promo- (as 作 621–623)", () => {
  const { cards } = promosNovas([linha("M-621", "Fierce Ambition")], new Set(["M657"]), new Set(["nrt-ccg-m-621"]));
  assert.equal(cards[0].id, "nrt-ccg-promo-m-621");
});

test("promos: a ordem é a da série (PR, PR-US, EX, PS, resto), cada uma pelo número", () => {
  const grupo = ["M-621", "PS-001", "PR-US002", "EX-001", "PR-100", "PR-005R", "PR-005", "PR-US001"].map((n) => linha(n, "x"));
  assert.deepEqual(promosNovas(grupo, new Set(), new Set()).cards.map((c) => c.code),
    ["PR-005", "PR-005R", "PR-100", "PR-US001", "PR-US002", "EX-001", "PS-001", "M-621"]);
});

test("snapshot das promos: 98 cartas, todas com scan, nenhuma com número que o catálogo já tinha", () => {
  const numero = (key, c) => ((dp.sets[key] || {})[c.code] || {}).numero || c.code;
  const noCatalogo = new Set([
    ...snap.sets.flatMap((s) => s.cards.map((c) => codigoCanonico(numero(s.key, c)))),
    ...comp.sets.flatMap((s) => s.cards.map((c) => codigoCanonico(c.code)))
  ]);
  assert.equal(promos.cards.length, 98);
  const vistos = new Set();
  for (const c of promos.cards) {
    assert.ok(!noCatalogo.has(codigoCanonico(c.code)), `${c.code} já está no catálogo`);
    assert.ok(!vistos.has(c.code), `${c.code} repetida`);
    vistos.add(c.code);
    assert.equal(c.rarity, "Promo", c.code);
    assert.match(c.img, /^promos\/[a-z0-9]+\.webp$/, c.code);
    assert.ok(c.name, c.code);
    // `numero` só nas quatro em que o impresso não é o código.
    assert.equal(c.numero, NUMERO_IMPRESSO[c.code], c.code);
  }
  assert.deepEqual(promos.cards.filter((c) => c.numero).map((c) => c.code), ["PR-018B", "PR-024B", "PR-025B", "PR-026B"]);
  assert.deepEqual(promos.cards.filter((c) => c.id).map((c) => c.id), ["nrt-ccg-promo-m-621", "nrt-ccg-promo-m-622", "nrt-ccg-promo-m-623"]);
});

test("no catálogo: as promos entram no set de promos sem tirar nem mudar nenhum id publicado", () => {
  const antes = montaLinha(snap, comp, dp).line;
  const depois = montaLinha(snap, comp, dp, promos).line;
  assert.equal(depois.length, antes.length + 98);
  const porId = new Map(depois.map((c) => [c.id, c]));
  assert.equal(porId.size, depois.length, "id repetido");
  for (const c of antes) {
    const d = porId.get(c.id);
    assert.ok(d, `${c.id} sumiu`);
    // Só o total do set de promos muda (14 → 112).
    assert.deepEqual({ ...d, setTotal: 0 }, { ...c, setTotal: 0 }, c.id);
  }
  const doSet = depois.filter((c) => c.setId === "nrt-ccg-promo");
  assert.equal(doSet.length, 112);
  assert.ok(doSet.every((c) => c.setTotal === 112 && c.rarity === "Promo" && c.variants.join() === "Normal" && c.image));
  // As duas "PR-018": número impresso igual, cartas e ids diferentes.
  const pr018 = doSet.filter((c) => c.number === "PR-018").map((c) => [c.id, c.name]);
  assert.deepEqual(pr018, [["nrt-ccg-pr-018", "Naruto vs Sasuke"], ["nrt-ccg-pr-018b", "The First Hokage"]]);
  // E endereços diferentes na página do set, sem desempate por sufixo.
  const slugs = slugsDasCartas(doSet);
  assert.equal(slugs.get("nrt-ccg-pr-018"), "naruto-vs-sasuke-pr-018");
  assert.equal(slugs.get("nrt-ccg-pr-018b"), "the-first-hokage-pr-018");
  assert.equal(new Set(slugs.values()).size, doSet.length, "endereço repetido no set");
});
