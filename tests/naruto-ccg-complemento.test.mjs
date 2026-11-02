// Complemento do Naruto CCG americano (scripts/naruto-ccg-complemento.mjs →
// data/vintage/naruto-ccg-complemento.json → sync-naruto-ccg.mjs), sem rede.
// O narutocards não tem ~400 cartas dos sets 3–15; elas vêm do N-CCG-DB
// (código impresso) cruzado com o ccgtrader (raridade). O que este teste
// trava: o alinhamento que casa as duas fontes, que o complemento nunca
// duplica uma carta do narutocards e que nenhum set volta a ficar com buraco.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { alinha, semelhanca, codigoCanonico, FAN_IMG } from "../scripts/naruto-ccg-complemento.mjs";
import { cartasDoSet, raridadeEVersoes } from "../scripts/sync-naruto-ccg.mjs";

const json = (arq) => JSON.parse(readFileSync(new URL(`../${arq}`, import.meta.url), "utf8"));
const snap = json("data/vintage/naruto-ccg.json");
const comp = json("data/vintage/naruto-ccg-complemento.json");
const ccgt = json("data/vintage/naruto-ccg-ccgtrader.json");
const DEF = { slug: "bandai-ccg-xx" };

test("semelhança de nome: igual, contido e erro de digitação casam; nome diferente não", () => {
  assert.equal(semelhanca("Hero's Water", "Hero&#x27;s Water"), 3);
  assert.equal(semelhanca("Ninja Info Cards", "Ninja Info Card"), 2);
  assert.ok(semelhanca("Self-Destruct Doppleganger", "Self-Destruct Doppelganger") > 0);
  assert.ok(semelhanca("Frustrated Ambition", "Riot in High-Security Facility") < 0);
});

test("alinhamento casa na ordem e pula a reimpressão que a outra lista não tem", () => {
  const fan = ["Kunai", "Orochimaru", "Shadow Clone Jutsu", "Rasengan"].map((name) => ({ name }));
  const ccg = ["Kunai", "Shadow Clone Jutsu", "Rasengan"].map((name) => ({ name }));
  assert.deepEqual(alinha(fan, ccg), [[0, 0], [2, 1], [3, 2]]);
});

test("código canônico: as grafias do narutocards e do N-CCG-DB batem", () => {
  assert.equal(codigoCanonico("NC-001"), codigoCanonico("N-C001"));
  assert.equal(codigoCanonico("M-US077"), codigoCanonico("MUS-077"));
  assert.notEqual(codigoCanonico("N-085"), codigoCanonico("N-086"));
});

test("cartasDoSet: o narutocards ganha no código repetido, o resto entra depois, starter vira Starter Deck", () => {
  const set = { key: "s07", cards: [{ code: "NC-001", name: "Naruto Uzumaki", rarity: "U", img: 1 }, { code: "M-211", name: "Surprise", rarity: "U" }] };
  const c = {
    starter: ["M-211"],
    cards: [
      { code: "N-C001", name: "Naruto Uzumaki", rarity: "Common", img: "set_7/nc001.webp" },
      { code: "J-US044", name: "Ninja Art: Mitotic Regeneration", rarity: "Rare", img: "set_7/jus044.webp" }
    ]
  };
  const out = cartasDoSet(set, DEF, c);
  assert.deepEqual(out.map((x) => x.code), ["NC-001", "M-211", "J-US044"]);
  assert.equal(out[1].rarity, "Starter Deck");
  assert.match(out[0].scan, /cdn\.narutocards\.ca/);
  assert.equal(out[2].scan, `https://wsrv.nl/?url=${encodeURIComponent(FAN_IMG + "set_7/jus044.webp")}&w=440&output=webp`);
  // Sem complemento, o set é só o do narutocards.
  assert.equal(cartasDoSet(set, DEF, undefined).length, 2);
});

test("Starter Deck do complemento não ganha foil paralelo; Common de booster ganha", () => {
  assert.deepEqual(raridadeEVersoes("s11", "Starter Deck"), { rarity: "Starter Deck", variants: ["Normal"] });
  assert.deepEqual(raridadeEVersoes("s11", "Common").variants, ["Normal", "Diamond Foil", "Wavy Foil"]);
  assert.deepEqual(raridadeEVersoes("s11", "Super Rare").variants, ["Normal"]);
});

test("snapshot do complemento: só sets de booster 3–15, sem código repetido nem do narutocards", () => {
  // Pelo número IMPRESSO (data/vintage/naruto-ccg-numero-impresso.json): o
  // M-275 do narutocards é o M-274, e o M-275 de verdade entra com id próprio.
  const impresso = json("data/vintage/naruto-ccg-numero-impresso.json");
  const numero = (key, c) => ((impresso.sets[key] || {})[c.code] || {}).numero || c.code;
  const doNc = new Set(snap.sets.filter((s) => /^s(0\d|1[0-6])$/.test(s.key)).flatMap((s) => s.cards.map((c) => codigoCanonico(numero(s.key, c)))));
  const idsDoNc = new Set(snap.sets.flatMap((s) => s.cards.map((c) => `nrt-ccg-${c.code.toLowerCase()}`)));
  const vistos = new Set();
  const RARIDADES = new Set(["Common", "Uncommon", "Rare", "Super Rare", "Starter Deck"]);
  for (const s of comp.sets) {
    assert.match(s.key, /^s(0[3-9]|1[0-5])$/, s.key);
    for (const c of s.cards) {
      const k = codigoCanonico(c.code);
      assert.ok(!doNc.has(k), `${c.code} já está no narutocards`);
      // Id próprio só quando o código impresso é id publicado de outra carta.
      const colide = idsDoNc.has(`nrt-ccg-${c.code.toLowerCase()}`);
      assert.equal(c.id, colide ? `nrt-ccg-${s.key}-${c.code.toLowerCase()}` : undefined, c.code);
      assert.ok(!vistos.has(k), `${c.code} repetido no complemento`);
      vistos.add(k);
      assert.ok(RARIDADES.has(c.rarity), `${c.code}: raridade "${c.rarity}"`);
      assert.ok(c.name && !/^[a-z]{1,3}\d+[a-z]?$/i.test(c.name), `${c.code}: nome "${c.name}"`);
    }
    // Starter só marca carta que existe no narutocards, no mesmo set.
    const doSet = new Set(snap.sets.find((x) => x.key === s.key).cards.map((c) => c.code));
    for (const code of s.starter) assert.ok(doSet.has(code), `${s.key} ${code}`);
  }
  assert.ok(vistos.size >= 390, `complemento encolheu: ${vistos.size}`);
});

test("cobertura: com o complemento, nenhum dos 10 sets fica mais de 1 carta atrás do ccgtrader", () => {
  for (const [key, lista] of Object.entries(ccgt.sets)) {
    const set = snap.sets.find((s) => s.key === key);
    const total = cartasDoSet(set, DEF, comp.sets.find((s) => s.key === key)).length;
    assert.ok(total >= lista.cartas.length - 1, `${key}: ${total} de ${lista.cartas.length}`);
  }
});
