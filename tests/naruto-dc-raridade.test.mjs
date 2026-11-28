// Raridade do Data Carddass NARUTO de fora (2026-11-28): blog do nao-yoshi
// (Wayback) e Suruga-ya pela busca do Rakuten, sem rede. Os trechos de HTML
// são cópias reduzidas das páginas reais. Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseNaoYoshi, siglaNaoYoshi, parseRakuten, completaRaridade } from "../scripts/naruto-dc-raridade.mjs";

// Post do Card Battle: coluna 種 antes do número. Post da Cross: sem ela.
const linhaCb = (num, nome, rar) => `<TR><TD>-</TD><TD>${num}</TD><TD>${nome}</TD><TD>${rar}</TD><TD>A</TD><TD>NR9AB4Y86</TD><TD>GS</TD><TD>stop</TD></TR>`;
const linhaNx = (num, nome, rar) => `<TR><TD>${num}</TD><TD>${nome}</TD><TD>${rar}</TD><TD>A</TD><TD>NX5VC3336</TD><TD>FF</TD><TD>stop</TD></TR>`;

test("nao-yoshi: acha o número em qualquer coluna; seção 【】 não é carta", () => {
  const cb = `<TABLE>${linhaCb("DN-108T", "うずまきナルト", "激")}${linhaCb("DN-109T", "うずまきナルト", "Ｎ")}</TABLE>`;
  assert.deepEqual(parseNaoYoshi(cb), [["DN-108T", "激", "うずまきナルト"], ["DN-109T", "N", "うずまきナルト"]]);
  const nx = `<TR><TD>-</TD><TD>【第１章】</TD><TD>-</TD></TR>${linhaNx("NX-003", "うずまきナルト(九尾ナルト四本目)", "NR")}`;
  assert.deepEqual(parseNaoYoshi(nx), [["NX-003", "NR", "うずまきナルト(九尾ナルト四本目)"]]);
});

test("nao-yoshi: no arquivo mensal só entra o post pedido, do título até a próxima data", () => {
  const html = `<h2 class="date">2009年01月24日</h2>${linhaNx("NX-999", "outro post", "R")}` +
    `<h2 class="date">2009年01月22日</h2><h3 class="title">【ナルト疾風伝～ナルティメットクロス～】</h3>${linhaNx("NX-001", "うずまきナルト", "N")}` +
    `<h2 class="date">2009年01月20日</h2>${linhaNx("NX-998", "outro post", "SR")}`;
  assert.deepEqual(parseNaoYoshi(html, { de: "【ナルト疾風伝～ナルティメットクロス", ate: '<h2 class="date">' }), [["NX-001", "N", "うずまきナルト"]]);
});

test("nao-yoshi: 爆/激 viram UR/SR; o \"-\" é N só no 第6弾; relistagem abaixo do 108 e verso branco ficam de fora", () => {
  assert.deepEqual(siglaNaoYoshi(["DN-110T", "爆", "自来也"]), ["DN-110", "UR", "自来也"]);
  assert.deepEqual(siglaNaoYoshi(["DN-108T", "激", "うずまきナルト"]), ["DN-108", "SR", "うずまきナルト"]);
  assert.deepEqual(siglaNaoYoshi(["DN-142T", "-", "うずまきナルト"]), ["DN-142", "N", "うずまきナルト"]);
  assert.equal(siglaNaoYoshi(["DN-212T", "-", "うずまきナルト"]), null, "fora do 第6弾, \"-\" não é N");
  assert.equal(siglaNaoYoshi(["DN-051T", "激", "九尾のナルト"]), null, "relistagem no 第8弾");
  assert.equal(siglaNaoYoshi(["NM-001", "N", "うずまきナルト疾風伝(白)"]), null);
  assert.equal(siglaNaoYoshi(["DN-212T白", "R", "うずまきナルト"]), null, "no Card Battle o 白 vem no número");
  assert.deepEqual(siglaNaoYoshi(["NM-135", "NR", "初代火影"]), ["NM-135", "NR", "初代火影"]);
  assert.equal(siglaNaoYoshi(["DMP-001", "-", "うずまきナルト"]), null, "promo sem raridade na lista");
  assert.equal(siglaNaoYoshi(["NM-187", "SC", "うずまきナルト"]), null, "sigla que só ele usa");
});

test("Rakuten: título do Suruga-ya vira [número, sigla, nome]; relistagem do Card Battle fica de fora", () => {
  const html = `<a title="【中古】NARUTOデータカードダス NF-185[SR]：自来也">` +
    `<a title="【中古】NARUTOデータカードダス DN-120T[N]：シズネ">` +
    `<a title="【中古】NARUTOデータカードダス DN-025T2[N]：大蛇丸">` +
    `<a title="【中古】NARUTOデータカードダス DN-067T[爆レア]：うちはイタチ">` +
    `<a title="【中古】NARUTOデータカードダス NFP-010[プロモ]：うずまきナルト(疾風伝)">` +
    `{"name":"【中古】NARUTOデータカードダス NM-018[激レア]：はたけカカシ\\"}`;
  assert.deepEqual(parseRakuten(html), [
    ["NF-185", "SR", "自来也"],
    ["DN-120", "N", "シズネ"],
    ["DN-067", "UR", "うちはイタチ"],
    ["NFP-010", "P", "うずまきナルト(疾風伝)"],
    ["NM-018", "SR", "はたけカカシ"]
  ]);
});

test("completaRaridade: só carta vazia; as duas fontes discordando = fica sem; N e NP do mesmo nome no Suruga-ya = ele não conta", () => {
  const cartas = [
    { number: "NF-001", name: "うずまきナルト(疾風伝)", rarity: "" },
    { number: "NF-002", name: "うずまきナルト(疾風伝)", rarity: "UR" },
    { number: "NF-003", name: "うずまきナルト", rarity: "" },
    { number: "NX-010", name: "日向ネジ", rarity: "" },
    { number: "DN-152", name: "綱手", rarity: "" },
    { number: "NM-001", name: "うずまきナルト", rarity: "" },
    { number: "NM-002", name: "うずまきナルト", rarity: "" }
  ];
  const snap = {
    suruga: [
      ["NF-001", "N", "うずまきナルト(疾風伝)"], ["NF-002", "N", "うずまきナルト(疾風伝)"],
      ["NF-003", "N", "うずまきナルト"], ["NF-003", "NP", "うずまきナルト"],
      ["DN-152", "R", "綱手"], ["NM-001", "N", "うずまきナルト"], ["NM-002", "N", "うちはサスケ"]
    ],
    naoYoshi: [["NF-003", "R", "うずまきナルト"], ["NX-010", "SR", "日向ネジ"], ["DN-152", "N", "綱手"], ["NM-001", "N", "うずまきナルト"]]
  };
  const r = completaRaridade(cartas, snap, { nomeDe: (c) => c.name });
  assert.deepEqual(r, { suruga: 2, naoYoshi: 2, conflitos: ["DN-152 (Suruga-ya R × nao-yoshi N)"] });
  // NM-002: o Suruga-ya tem o número com OUTRO nome — não vale.
  assert.deepEqual(cartas.map((c) => c.rarity), ["N", "UR", "R", "SR", "", "N", ""]);
});

test("snapshot versionado: Card Battle 第5〜8弾 inteiro, sem relistagem abaixo do DN-108", () => {
  const snap = JSON.parse(readFileSync(new URL("../data/vintage/naruto-dc-raridade.json", import.meta.url), "utf8"));
  const dn = new Set(snap.naoYoshi.filter(([n]) => /^DN-/.test(n)).map(([n]) => n));
  for (let i = 108; i <= 249; i++) assert.ok(dn.has(`DN-${i}`), `falta DN-${i}`);
  assert.equal(dn.size, 142);
  const siglas = new Set([...snap.naoYoshi, ...snap.suruga].map(([, r]) => r));
  for (const s of siglas) assert.match(s, /^(N|R|SR|UR|NR|WNR|HR|NP|SP|P|Silver Holo|Design Rare)$/, `sigla fora do vocabulário: ${s}`);
});
