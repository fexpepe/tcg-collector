// Testes do sync do Dragon Ball Carddass (scripts/sync-dbc-carddass.mjs): o
// parser da tabela do 80storage, a regra de id estável e a tradução dos nomes.
// A numeração do Carddass tem pegadinhas de propósito (dois No.215 no 第6弾,
// No.216 escondido no 第7弾, E-1..9 no 第16弾) — é isso que fica travado aqui.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse80storage, assignIds, nameEn, SETS } from "../scripts/sync-dbc-carddass.mjs";

const TABELA = `<figure><table><thead>
<tr><th>カードNo</th><th>名前</th><th>BP</th><th>スカウター</th><th>箔</th></tr></thead><tbody>
<tr><td>No.214</td><td>孫悟空</td><td>24000</td><td>ヒキワケ</td><td>悟</td></tr>
<tr><td>No.215</td><td>孫悟空</td><td>24000</td><td>ニセモノ</td><td>惑</td></tr>
<tr><td>No.215</td><td>孫悟空</td><td>80000</td><td>ホンモノ</td><td>悟</td></tr>
<tr><td>No.235</td><td>ギニュー</td><td>45000</td><td>SDB×7</td><td><img src="x.webp" alt="ギニュー特戦隊"></td></tr>
<tr><td>E-9</td><td>ビーデル</td><td>&#8211;</td><td>ー</td><td>武</td></tr>
</tbody></table></figure>`;

test("parser: número sem o 'No.', stats crus e ícone do 箔 pelo alt", () => {
  const cards = parse80storage(TABELA);
  assert.equal(cards.length, 5);
  assert.deepEqual(cards.map((c) => c.num), ["214", "215", "215", "235", "E-9"]);
  assert.equal(cards[3].stats["箔"], "[ギニュー特戦隊]");
  assert.equal(cards[4].stats.BP, "-");
  assert.equal(parse80storage("<p>sem tabela</p>").length, 0);
});

test("parser: 'Total No.' do 第17弾 em diante vira `total`, fora dos stats", () => {
  const [c] = parse80storage(`<table><tr><th>カードNo</th><th>Total No.</th><th>名前</th><th>DP</th></tr>
    <tr><td>No.1</td><td>No.647</td><td>新三大超サイヤ人</td><td>2000</td></tr></table>`);
  assert.deepEqual(c, { num: "1", total: "647", name: "新三大超サイヤ人", stats: { DP: "2000" } });
});

test("id: número repetido na parte ganha sufixo pela ordem da fonte", () => {
  const ids = assignIds("h06", parse80storage(TABELA)).map((c) => c.id);
  assert.deepEqual(ids, ["dbc-h06-214", "dbc-h06-215", "dbc-h06-215b", "dbc-h06-235", "dbc-h06-e-9"]);
});

test("id: refresh reaproveita o id conhecido e nunca derruba carta que sumiu", () => {
  const primeira = assignIds("h06", parse80storage(TABELA));
  // Fonte corrigiu um BP, reordenou e deixou de listar a E-9.
  const nova = parse80storage(TABELA).filter((c) => c.num !== "E-9").reverse();
  nova[0].stats.BP = "46000";
  const segunda = assignIds("h06", nova, primeira);
  const porId = new Map(segunda.map((c) => [c.id, c]));
  assert.equal(segunda.length, 5);                          // a E-9 continua
  assert.equal(porId.get("dbc-h06-235").stats.BP, "46000"); // correção entra no mesmo id
  assert.ok(porId.has("dbc-h06-e-9"));
  assert.deepEqual(new Set(segunda.map((c) => c.id)), new Set(primeira.map((c) => c.id)));
});

test("nome EN: personagem, composição por separador e fallback pro japonês", () => {
  assert.equal(nameEn("孫悟空"), "Goku");
  assert.equal(nameEn("悟空＆ベジータ"), "Goku & Vegeta");
  assert.equal(nameEn("天津飯・餃子・ヤムチャ"), "Tien & Chiaotzu & Yamcha");
  assert.equal(nameEn("孫悟飯VSセルJr."), "Gohan vs. Cell Jr.");
  assert.equal(nameEn("孫悟空対ピッコロ（マジュニア）"), "Goku vs. Piccolo (Jr.)");
  assert.equal(nameEn("チチ＆父"), "Chi-Chi & Ox-King");            // frase inteira ganha da composição
  assert.equal(nameEn("ライチとザークロ"), "");                       // meia tradução não: fica o japonês
});

test("SETS: códigos únicos, Hondan 1–31 e o 第1弾 em nov/1988", () => {
  const codes = SETS.map((s) => s.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(SETS.filter((s) => s.series === "h").length, 31);
  assert.equal(SETS[0].code, "h01");
  assert.equal(SETS[0].date, "1988-11");
});

test("snapshot versionado: ids únicos, no formato e só de sets conhecidos", () => {
  const snap = JSON.parse(readFileSync(new URL("../data/vintage/dbc-carddass.json", import.meta.url), "utf8"));
  const conhecidos = new Set(SETS.map((s) => s.code));
  const ids = [];
  for (const s of snap.sets) {
    assert.ok(conhecidos.has(s.code), s.code);
    for (const c of s.cards) {
      assert.match(c.id, new RegExp(`^dbc-${s.code}-[a-z0-9-]+$`));
      ids.push(c.id);
    }
  }
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 758);
});
