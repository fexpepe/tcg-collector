// Raridade do ナルティメットカードバトル 第1〜4弾 pela lista do blog do hash1ag
// no Ameblo (2026-11-27), sem rede. O trecho de HTML é cópia reduzida do post
// real. Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseAmeblo, TOTAL } from "../scripts/naruto-raridade-ameblo.mjs";
import { aplicaRaridade } from "../scripts/naruto-raridade-hinokunian.mjs";

const snap = (arq) => JSON.parse(readFileSync(new URL(`../data/vintage/${arq}`, import.meta.url), "utf8"));

const linha = (num, nome, rar, cor = "#ffcc00") =>
  `<p><span style="font-weight:bold;">${num} <span style="text-decoration:underline;">${nome}</span>${rar ? `　<span style="color:${cor};">${rar}</span>` : ""}</span></p>\n<p>&nbsp;</p>\n`;

test("Ameblo: nada/レア/激レア/爆レア viram N/R/SR/UR, sem o T do número", () => {
  const html = `<div class="skin-entryBody" id="entryBody">${
    linha("DN-001T", "うずまきナルト", "") +
    linha("DN-011T", "ロック・リー", "レア") +
    linha("DN-003T", "うずまきナルト", "激レア") +
    linha("DN-004T", "うずまきナルト", "爆レア", "#ff0000")
  }<p>&nbsp;</p></div><div>DN-099T 広告</div>`;
  assert.deepEqual(parseAmeblo(html), [
    ["DN-001", "N", "うずまきナルト"],
    ["DN-011", "R", "ロック・リー"],
    ["DN-003", "SR", "うずまきナルト"],
    ["DN-004", "UR", "うずまきナルト"]
  ]);
});

test("Ameblo: só o corpo do post — o mesmo texto no JSON da página não entra de novo", () => {
  const html = `<script>window.INIT_DATA={"text":"DN-001T うずまきナルト"}</script>` +
    `<div id="entryBody">${linha("DN-002T", "うずまきナルト", "")}</div>` +
    `<p>DN-005T うちはサスケ</p>`;
  assert.deepEqual(parseAmeblo(html), [["DN-002", "N", "うずまきナルト"]]);
  assert.deepEqual(parseAmeblo("<p>DN-001T うずまきナルト</p>"), [], "sem #entryBody, nada");
});

test("Ameblo: o snapshot versionado tem DN-001 a DN-107, um de cada, só com N/R/SR/UR", () => {
  const { cards } = snap("naruto-raridade-ameblo.json");
  assert.deepEqual(cards.map(([num]) => num), Array.from({ length: TOTAL }, (_, i) => `DN-${String(i + 1).padStart(3, "0")}`));
  assert.deepEqual([...new Set(cards.map(([, rar]) => rar))].sort(), ["N", "R", "SR", "UR"]);
});

// A ordem do sync-naruto-datacarddass.mjs: hinokunian primeiro, a lista do
// Ameblo por cima. Nomes como o catálogo grava (o noihjp escreve 砂瀑 e 油女;
// o blog, 砂漠 e 油目 — um kanji, o aplicaRaridade aceita).
test("Ameblo por cima do hinokunian: as 4 que o hinokunian errava, e o resto igual", () => {
  const hino = snap("naruto-raridade.json");
  const blog = snap("naruto-raridade-ameblo.json");
  const nomeDoCatalogo = { "砂漠の我愛羅": "砂瀑の我愛羅", "油目シノ": "油女シノ" };
  const cartas = () => blog.cards.map(([number, , nome]) => ({ number, name: nomeDoCatalogo[nome] || nome, rarity: "" }));

  const soHino = cartas();
  aplicaRaridade(soHino, hino, { nomeDe: (c) => c.name });
  const final = cartas();
  aplicaRaridade(final, hino, { nomeDe: (c) => c.name });
  const r = aplicaRaridade(final, blog, { nomeDe: (c) => c.name });
  assert.deepEqual(r, { aplicadas: TOTAL, nomeDiferente: 0 });

  const mudou = final.map((c, i) => [c.number, soHino[i].rarity, c.rarity]).filter(([, antes, depois]) => antes !== depois);
  assert.deepEqual(mudou, [
    ["DN-025", "R", "N"], // 大蛇丸: o par é normal → rara, como o do 白
    ["DN-026", "N", "R"],
    ["DN-053", "R", "SR"], // 我愛羅: o 第2弾 abre com 3 激レア
    ["DN-062", "", "N"] // o hinokunian chama de うずまきナルト; é 九尾のナルト
  ]);
  assert.equal(final.find((c) => c.number === "DN-067").rarity, "UR", "a 爆レア da イタチ");
});
