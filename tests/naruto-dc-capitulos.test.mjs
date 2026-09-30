// Capítulos do Data Carddass NARUTO — Formation e Cross (scripts/lib/
// naruto-dc-capitulos.mjs). Os casos são os do catálogo de 30/09/2026: o
// snapshot do Suruga-ya partia capítulo em dois sets pelo subtítulo, punha
// carta no capítulo errado e dava data "só do ano" (AAAA-01-01) que jogava o
// 第2章 do Cross pra antes do 第1章. E o setId era a posição na ordem por
// data — corrigir a data renumerava os sets.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CAPITULOS, SETIDS_APOSENTADOS, capituloDaCarta, chaveDoSet, dataDoSet, atribuiSetIds
} from "../scripts/lib/naruto-dc-capitulos.mjs";
import { readGlobalVar } from "../scripts/lib/sync-common.mjs";

test("faixas oficiais contíguas e datas crescentes, nas duas linhas", () => {
  for (const [linha, caps] of Object.entries(CAPITULOS)) {
    caps.forEach((c, i) => {
      assert.equal(c.cap, i + 1, `${linha}: capítulo ${i + 1} fora de ordem`);
      assert.match(c.data, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(c.faixa[0] <= c.faixa[1]);
      if (!i) return assert.equal(c.faixa[0], 1);
      assert.equal(c.faixa[0], caps[i - 1].faixa[1] + 1, `${linha}: buraco ou sobreposição antes do ${c.cap}º`);
      assert.ok(c.data > caps[i - 1].data, `${linha}: ${c.cap}º não é depois do ${caps[i - 1].cap}º`);
    });
  }
  // Formation acabou antes do Cross começar.
  assert.ok(CAPITULOS.nf.at(-1).data < CAPITULOS.nx[0].data);
});

test("número de capítulo vale mais que a série do anúncio", () => {
  // [NP] do 火の意志伝承の章 anunciado como 第6章; NF-342 sem capítulo nenhum.
  assert.equal(capituloDaCarta("nf", "NF-297", "ナルティメットフォーメーション　第6章"), 7);
  assert.equal(capituloDaCarta("nf", "NF-342", "ナルティメットフォーメーション"), 7);
  assert.equal(capituloDaCarta("nf", "NF-258", "ナルティメットフォーメーション　第5章　激突！闇を穿つ火の意志編"), 6);
  assert.equal(capituloDaCarta("nx", "NX-192", "ナルティメットクロス　第4章"), 5);
  assert.equal(capituloDaCarta("nx", "NX-067", "ナルティメットクロス　第1章"), 2);
  // Sem número de capítulo: a série decide.
  assert.equal(capituloDaCarta("nx", "NX-CAM004", "ナルティメットクロス　第4章　～1億枚突破記念弾～"), 4);
  assert.equal(capituloDaCarta("nx", "NX-SPI", "ナルティメットクロス　第5章　～10周年SP弾～"), 5);
  assert.equal(capituloDaCarta("nf", "NFP-005", "ナルティメットフォーメーション　プロモーションカード"), 0);
  // Número da OUTRA linha não usa a faixa desta.
  assert.equal(capituloDaCarta("nx", "NF-010", "ナルティメットクロス　プロモーションカード"), 0);
});

test("capítulo com e sem subtítulo é um set só", () => {
  const nf = (num, serie) => chaveDoSet("nf", capituloDaCarta("nf", num, serie), serie);
  const nx = (num, serie) => chaveDoSet("nx", capituloDaCarta("nx", num, serie), serie);
  assert.equal(nf("NF-051", "ナルティメットフォーメーション　第2章"), "nf:cap2");
  assert.equal(nf("NF-055", "ナルティメットフォーメーション　第2章　再会！共鳴する宿命の二人編"), "nf:cap2");
  assert.equal(nx("NX-142", "ナルティメットクロス　第4章"), "nx:cap4");
  assert.equal(nx("NX-CAM004", "ナルティメットクロス　第4章　～1億枚突破記念弾～"), "nx:cap4");
  // Fora de capítulo, a série sem o título do jogo (e fullwidth normalizado).
  assert.equal(nf("NFPF-001", "ポケットファイルダス　ナルティメットフォーメーション"), "nf:ポケットファイルダス");
  assert.equal(nf("NFC-016", "ナルティメットフォーメーション"), "nf:");
});

test("data do set: a curada; senão a menor, e AAAA-01-01 é só o ano", () => {
  assert.equal(dataDoSet("nf:cap1", ["2007-01-01"]), "2007-12-14");
  assert.equal(dataDoSet("nx:cap2", ["2009-01-01"]), "2009-03-01");
  assert.equal(dataDoSet("nf:極秘任務", ["2008-01-01"]), "2008-06-05");
  assert.equal(dataDoSet("nf:プロモーションカード", ["2008-01-01", "2008-08-11", "2008-01-31"]), "2008-01-31");
  assert.equal(dataDoSet("nf:", ["2008-01-01", ""]), "2008-01-01");
  assert.equal(dataDoSet("nx:outra", ["", ""]), "");
});

test("setId pegajoso: capítulo juntado fica com o id do set maior; novo não reusa aposentado", () => {
  const pub = (setId, set, n) => Array.from({ length: n }, () => ({ setId, set }));
  const publicados = [
    ...pub("nrt-nf-s06", "Data Carddass — ナルティメットフォーメーション 第2章", 19),
    ...pub("nrt-nf-s09", "Data Carddass — ナルティメットフォーメーション 第2章 再会！共鳴する宿命の二人編", 4),
    ...pub("nrt-nf-s10", "Data Carddass — ナルティメットフォーメーション 第3章 奪還！砂漠に眠る友の魂編", 4),
    ...pub("nrt-nf-s26", "Data Carddass — ポケットファイルダス ナルティメットフォーメーション", 2)
  ];
  const chaves = ["nf:cap4", "nf:cap3", "nf:ポケットファイルダス", "nf:cap2"].map((chave) => ({ chave, linha: "nf" }));
  const { ids, juntados } = atribuiSetIds(chaves, publicados);
  assert.equal(ids.get("nf:cap2"), "nrt-nf-s06");
  assert.equal(ids.get("nf:cap3"), "nrt-nf-s10");
  assert.equal(ids.get("nf:ポケットファイルダス"), "nrt-nf-s26");
  assert.equal(ids.get("nf:cap4"), "nrt-nf-s27");
  assert.deepEqual(juntados, [{ de: "nrt-nf-s09", para: "nrt-nf-s06", chave: "nf:cap2" }]);
  // Catálogo sem nada acima do s08: o próximo pula os aposentados (s20 é o maior).
  const { ids: novos } = atribuiSetIds([{ chave: "nx:cap1", linha: "nx" }], pub("nrt-nf-s08", "Data Carddass — ナルティメットフォーメーション 第7章", 1));
  assert.equal(novos.get("nx:cap1"), "nrt-nx-s21");
  for (const [de, para] of Object.entries(SETIDS_APOSENTADOS)) assert.notEqual(de, para);
});

test("o snapshot não tem carta de capítulo fora das faixas oficiais", () => {
  const snap = JSON.parse(readFileSync(new URL("../data/vintage/naruto-dc-suruga.json", import.meta.url), "utf8"));
  for (const [chave, linha] of [["formation", "nf"], ["cross", "nx"]]) {
    for (const it of snap[chave]) {
      const num = (String(it.t).normalize("NFKC").match(/^(N[FX]-\d+)\b/) || [])[1];
      if (num && num.slice(0, 2).toLowerCase() === linha) {
        assert.ok(capituloDaCarta(linha, num, "") > 0, `${num}: fora de toda faixa — atualize CAPITULOS`);
      }
    }
  }
});

test("catálogo versionado: um set por capítulo, na data e com as cartas da faixa", async () => {
  const cards = await readGlobalVar(new URL("../data/naruto/cards.js", import.meta.url), "TCG_CARDS");
  const dc = cards.filter((c) => /^nrt-(nf|nx)-/.test(c.id));
  assert.ok(dc.length > 300, "catálogo do Naruto sem Formation/Cross?");
  const setsDoCap = new Map(); // "nf:cap2" -> Set(setId)
  for (const c of dc) {
    const linha = c.id.slice(4, 6);
    const cap = capituloDaCarta(linha, c.number, "");
    if (!cap) continue;
    const chave = `${linha}:cap${cap}`;
    if (!setsDoCap.has(chave)) setsDoCap.set(chave, new Set());
    setsDoCap.get(chave).add(c.setId);
    assert.equal(c.setReleaseDate, CAPITULOS[linha][cap - 1].data, `${c.number}: data do set`);
  }
  for (const [chave, ids] of setsDoCap) assert.equal(ids.size, 1, `${chave} partido em ${[...ids].join(", ")}`);
  const vivos = new Set(dc.map((c) => c.setId));
  for (const id of Object.keys(SETIDS_APOSENTADOS)) assert.ok(!vivos.has(id), `${id} aposentado voltou`);
});
