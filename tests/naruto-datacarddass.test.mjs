// Data Carddass NARUTO — Card Battle e Mission (scripts/lib/
// naruto-datacarddass.mjs). O caso é o de 02/11/2026: o noihjp dá o título
// "第１弾" à página do 第2弾 e vice-versa, e como a carta é do set em que
// estreou, o 第１弾 publicado tinha DN-051–065 e o 第２弾 só as sobras do
// DN-001–050. O 第1弾 é DN-001–050 inteiro (cardcheckbox e hinokunian).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PAGES, estreias, estreiasForaDaFaixa } from "../scripts/lib/naruto-datacarddass.mjs";
import { readGlobalVar } from "../scripts/lib/sync-common.mjs";

const snap = JSON.parse(readFileSync(new URL("../data/vintage/naruto-datacarddass.json", import.meta.url), "utf8"));
const faixa = (prefixo, de, ate) => Array.from({ length: ate - de + 1 }, (_, i) => `${prefixo}-${String(de + i).padStart(3, "0")}`);
const codigos = (cartas) => cartas.map((c) => c.code || c.number).sort();

test("faixas oficiais contíguas em cada título, na ordem das páginas", () => {
  assert.deepEqual(PAGES.map((p) => p.seq), Array.from({ length: PAGES.length }, (_, i) => i + 1));
  assert.equal(new Set(PAGES.map((p) => p.page)).size, PAGES.length, "página repetida");
  const fim = {}; // prefixo -> último número da faixa anterior
  for (const { name, estreia } of PAGES) {
    if (!estreia) continue;
    const [[p, de], [p2, ate]] = estreia.map((c) => [c.split("-")[0], Number(c.split("-")[1])]);
    assert.equal(p, p2, `${name}: faixa com dois prefixos`);
    assert.equal(de, (fim[p] || 0) + 1, `${name}: buraco ou sobreposição antes de ${estreia[0]}`);
    assert.ok(ate >= de);
    fim[p] = ate;
  }
  assert.deepEqual(fim, { DN: 249, NM: 237 });
});

test("o 第1弾 é DN-001–050 inteiro e o 第2弾 estreia DN-051–065", () => {
  const [primeiro, segundo] = estreias(snap.sets);
  assert.equal(primeiro.set.name, "ナルティメットカードバトル 第１弾");
  assert.deepEqual(codigos(primeiro.estreias), faixa("DN", 1, 50));
  assert.equal(segundo.set.name, "ナルティメットカードバトル 第２弾");
  assert.deepEqual(codigos(segundo.estreias), faixa("DN", 51, 65));
});

test("snapshot: nome e ordem das páginas, e nenhuma estreia fora da faixa", () => {
  const porSeq = new Map(PAGES.map((p) => [p.seq, p.name]));
  for (const s of snap.sets) assert.equal(s.name, porSeq.get(s.seq), `seq ${s.seq} com nome de outra página`);
  assert.deepEqual(estreiasForaDaFaixa(snap.sets), []);
});

test("a trava pega o título trocado da fonte", () => {
  // O snapshot como era até 02/11/2026: a 01.php do noihjp no seq 1.
  const [a, b, ...resto] = snap.sets;
  const trocado = [{ ...a, cards: b.cards }, { ...b, cards: a.cards }, ...resto];
  const fora = estreiasForaDaFaixa(trocado);
  assert.ok(fora.includes("ナルティメットカードバトル 第１弾: DN-051"));
  assert.ok(fora.includes("ナルティメットカードバトル 第２弾: DN-005"));
  assert.equal(fora.length, 15 + 24);
});

test("catálogo versionado: DN-001–050 no nrt-dc-s01 (第１弾) e DN-051–065 no s02", async () => {
  const cards = await readGlobalVar(new URL("../data/naruto/cards.js", import.meta.url), "TCG_CARDS");
  const doSet = (setId) => cards.filter((c) => c.setId === setId);
  const s01 = doSet("nrt-dc-s01");
  assert.deepEqual(codigos(s01), faixa("DN", 1, 50));
  for (const c of s01) {
    assert.equal(c.set, "Data Carddass — ナルティメットカードバトル 第１弾");
    assert.equal(c.setTotal, 50);
  }
  const s02 = doSet("nrt-dc-s02");
  assert.deepEqual(codigos(s02), faixa("DN", 51, 65));
  for (const c of s02) {
    assert.equal(c.set, "Data Carddass — ナルティメットカードバトル 第２弾");
    assert.equal(c.setTotal, 15);
  }
  // Id de carta não muda com a correção: nrt-dc-<código>.
  for (const c of [...s01, ...s02]) assert.equal(c.id, `nrt-dc-${c.number.toLowerCase()}`);
});
