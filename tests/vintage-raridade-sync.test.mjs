// Raridade dos vintage que vem da página da fonte (2026-11-01), sem rede. Os
// trechos de HTML abaixo são cópias reduzidas das páginas reais: Grand Line
// Wiki (Carddass Hyper Battle e One Piece Card Game 2002) e tcg-db (Miracle
// Battle Carddass). O parse antigo parava antes da raridade em todos os três.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { cardsIn } from "../scripts/sync-onepiece-vintage.mjs";
import { parseCards, raridadeMb, buildCards } from "../scripts/sync-miracle-battle.mjs";
import { parseOverview, raridade2002 } from "../scripts/sync-onepiece-2002.mjs";

const linhaHB = (cor, num) => `<tr id="${cor}Hover">
  <td id="HBcardNum">${num}</td>
  <td id="HBcardName"><a id="HBcardNameHref" href="/tcg/hyperbattle/${num.toLowerCase()}.html">Luffy<i id="HBcardNameJP">「ルフィ」</i></a></td>
  <td id="HBcardType">Pirate</td>
  <td id="HBcardMark">賊 武 Ｌ</td>
  <td id="HBcardValue">500</td>
</tr>`;

test("Hyper Battle: o id da linha vira o acabamento; a marca fica no campo dela", () => {
  const cards = cardsIn(["holo", "grey", "gold", "rare"].map((c, i) => linhaHB(c, `C0${i + 1}`)).join("\n"));
  assert.deepEqual(cards.map((c) => c.finish), ["Holo", "Normal", "Gold Stamp", "Secret Rare"]);
  assert.equal(cards[0].mark, "賊 武 Ｌ");
  assert.equal(cards[0].nameJp, "ルフィ");
});

test("Hyper Battle: linha sem id (ou com id desconhecido) não chuta Normal", () => {
  const semId = linhaHB("grey", "C09").replace(/<tr id="greyHover">/, "<tr>");
  const estranho = linhaHB("purple", "C10");
  assert.deepEqual(cardsIn(semId + estranho).map((c) => c.finish), ["", ""]);
});

const linhaMb = (scan, num, nome, exp, rar) => `<tr><td><img src='/img/card/mb/${scan}.jpg' /><img src='/img/card/mb/back.jpg' /></td><td><span style='font-weight:bold;font-size:120%;'>${num}　<a href='?name=${nome}'>${nome}</a></span><br /><a href='?ctype=キャラ'>キャラ</a>　<a href='?exp=${exp}'>${exp}</a>${rar ? `　${rar}` : ""}<br />色：<a href='?color=赤'>赤</a></td></tr>`;

test("Miracle Battle: a raridade é o texto depois do link do set; sem marca = comum", () => {
  const exp = "ドラゴンボール改 ブースターパック 第1弾";
  const html = [
    linhaMb("DB01/16", "16", "怒りの孫悟飯", exp, "SR"),
    linhaMb("DB01/18", "18", "デンデ", exp, ""),
    linhaMb("OP09/CO29", "CO29", "海軍大将・赤犬", exp, "超Ω")
  ].join("");
  const cards = parseCards(html);
  assert.deepEqual(cards.map((c) => [c.scan, c.num, c.rarity]), [["DB01/16", "16", "SR"], ["DB01/18", "18", ""], ["OP09/CO29", "CO29", "超Ω"]]);
  assert.equal(raridadeMb(""), "C");
  assert.equal(raridadeMb("超Ω"), "超Ω");
  assert.equal(raridadeMb("R(foil)"), "R");
  // Snapshot de antes da raridade: o campo não existe → fica vazio, não vira comum.
  assert.equal(raridadeMb(undefined), "");
});

test("Miracle Battle: scan _2 marcado (foil) vira a versão Foil da carta base", () => {
  const snap = { sets: [{ code: "DBS04", name: "x", official: 2, cards: [
    { scan: "DBS04/01", num: "01", name: "天津飯", rarity: "" },
    { scan: "DBS04/01_2", num: "01", name: "天津飯", rarity: "(foil)" },
    { scan: "DBS04/02", num: "02", name: "ヤムチャ", rarity: "R" }
  ] }] };
  const cards = buildCards(snap);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards[0].variants, ["Normal", "Foil"]);
  assert.equal(cards[0].rarity, "C");
  assert.deepEqual(cards[1].variants, ["Normal"]);
  assert.equal(cards[1].rarity, "R");
});

const tabela2002 = (coluna, linhas) => `<table class="HBcardList">
  <tr id="greyRow"><th id="OP02numHead">Card #:</th><th id="OP02nameHead" colspan="2">Character Card Name:</th><th id="OP02pwrHead">Power:</th>${coluna ? `<th id="OP02holoHead">${coluna}:</th>` : ""}</tr>
  ${linhas.map(([num, nome, ultima]) => `<tr id="greyHover">
    <td id="HBcardNum">${num}</td>
    <td id="OP02cardName"><a id="HBcardNameHref" href="02cardgame/${num.toLowerCase()}.html">${nome}</a></td>
    <td id="OP02cardName">ルフィ</td>
    <td id="OP02cardDmg">500</td>
    ${coluna ? `<td id="OP02cardDmg">${ultima}</td>` : ""}
  </tr>`).join("")}
</table>`;

test("One Piece 2002: a ÚLTIMA célula da tabela com a coluna; estrela em hexa decodificada", () => {
  const html = `<td id="OP02setName">Road to the Pirate King</td><td id="OP02setDate">Feb. 22, 2002</td><td id="OP02setCC">66</td>
    ${tabela2002("Holo", [["LK-C01", "Luffy", "&#x2606;"], ["LK-C07", "Luffy", ""]])}
    ${tabela2002("", [["LK-T01", "Gum-Gum Pistol", ""]])}
    <td id="OP02setName">Justice on the Great Sea</td><td id="OP02setDate">Oct. 2003</td><td id="OP02setCC">59</td>
    ${tabela2002("Rarity", [["JS-C01", "Luffy", "&#x2606;&#x2606;&#x2606;"], ["JS-C04", "Luffy", "&#x2606;&#x2606;"], ["JS-C09", "Usopp", ""]])}`;
  const [lk, js] = parseOverview(html);
  assert.deepEqual(lk.cards.map((c) => [c.num, c.rarity]), [["LK-C01", "Holo"], ["LK-C07", "Normal"], ["LK-T01", ""]]);
  assert.deepEqual(js.cards.map((c) => [c.num, c.rarity]), [["JS-C01", "☆☆☆"], ["JS-C04", "☆☆"], ["JS-C09", "Normal"]]);
  // Tabela sem a coluna: não dá pra saber, fica vazio.
  assert.equal(raridade2002(undefined, "&#x2606;"), "");
});
