// Parsers da Bulbapedia (scripts/lib/bulbapedia.mjs) sobre FIXTURES — a forma
// de tabela e infobox que o parser espera. Escritos sem acesso ao wiki
// (20/09/2026): se o `--probe` do sync-bulbapedia-ja mostrar outra forma, é
// aqui que se registra a forma real e se ajusta o parser. O que está travado:
// (1) coluna lida pelo NOME do cabeçalho, em qualquer ordem; (2) tipo e
// raridade saem do alt do ícone quando a célula é ícone; (3) número com o
// total ("001/190") e sem; (4) nome japonês = primeiro lang="ja";
// (5) thumb do Archives vira o upload original.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSetList, parseCardPage, parseExpansionList, parseUrl, imagemOriginal, text } from "../scripts/lib/bulbapedia.mjs";

const LISTA = `
<div class="mw-parser-output"><p>intro</p>
<table class="roundy"><tbody>
<tr><th>No.</th><th>Mark</th><th>Card name</th><th>Type</th><th>Rarity</th></tr>
<tr><td>001/190</td><td>H</td><td><a href="/wiki/Oddish_(Shiny_Treasure_ex_1)" title="Oddish (Shiny Treasure ex 1)">Oddish</a></td>
    <td><a href="/wiki/Grass_(TCG)" title="Grass (TCG)"><img alt="Grass" src="//archives.bulbagarden.net/media/upload/thumb/x/xy/Grass-attack.png/20px-Grass-attack.png"></a></td>
    <td><a href="/wiki/Rarity" title="Rarity"><img alt="Common" src="//archives.bulbagarden.net/media/upload/thumb/x/xy/Rarity_Common.png/20px-Rarity_Common.png"></a></td></tr>
<tr><td>190/190</td><td>H</td><td><a href="/wiki/Boss%27s_Orders_(Shiny_Treasure_ex_190)" title="Boss's Orders (Shiny Treasure ex 190)">Boss&#39;s Orders</a></td>
    <td>Supporter</td><td>SR</td></tr>
<tr><td>lixo</td><td></td><td>sem link nem número</td><td></td><td></td></tr>
</tbody></table>
<table><tbody>
<tr><th>Rarity</th><th>Card name</th><th>No.</th></tr>
<tr><td>UR</td><td><a href="/wiki/Basic_Grass_Energy_(Shiny_Treasure_ex_191)" title="Basic Grass Energy (Shiny Treasure ex 191)">Basic Grass Energy</a></td><td>191</td></tr>
</tbody></table>
<table><tbody><tr><th>Sem</th><th>Cabeçalho</th></tr><tr><td>x</td><td>y</td></tr></tbody></table>
</div>`;

test("lista de set: colunas pelo nome do cabeçalho, ícone vira alt, várias tabelas, linha inválida fora", () => {
  const r = parseSetList(LISTA);
  assert.equal(r.length, 3);
  assert.deepEqual(r[0], { number: "001/190", en: "Oddish", page: "Oddish (Shiny Treasure ex 1)", type: "Grass", rarity: "Common", mark: "H" });
  assert.deepEqual(r[1], { number: "190/190", en: "Boss's Orders", page: "Boss's Orders (Shiny Treasure ex 190)", type: "Supporter", rarity: "SR", mark: "H" });
  assert.deepEqual(r[2], { number: "191", en: "Basic Grass Energy", page: "Basic Grass Energy (Shiny Treasure ex 191)", type: "", rarity: "UR", mark: "" });
  assert.deepEqual(parseSetList("<p>sem tabela</p>"), []);
});

const CARTA = `
<div class="mw-parser-output">
<table class="roundy"><tbody>
<tr><th colspan="2"><b>Oddish</b> <span lang="ja">ナゾノクサ</span> <i>Nazonokusa</i></th></tr>
<tr><td><a href="/wiki/File:OddishShinyTreasure1.jpg"><img src="//archives.bulbagarden.net/media/upload/thumb/3/3a/OddishShinyTreasure1.jpg/200px-OddishShinyTreasure1.jpg" width="200"></a></td></tr>
<tr><th>Illus.</th><td><a href="/wiki/Sekio" title="Sekio">Sekio</a></td></tr>
<tr><th>Rarity</th><td><a href="/wiki/Rarity" title="Rarity"><img alt="Common" src="//archives.bulbagarden.net/media/upload/thumb/x/xy/Rarity_Common.png/20px-Rarity_Common.png"></a></td></tr>
</tbody></table></div>`;

test("página de carta: nome japonês, ilustrador, raridade e o scan ORIGINAL do Archives", () => {
  const r = parseCardPage(CARTA);
  assert.equal(r.ja, "ナゾノクサ");
  assert.equal(r.artist, "Sekio");
  assert.equal(r.rarity, "Common");
  assert.equal(r.image, "https://archives.bulbagarden.net/media/upload/3/3a/OddishShinyTreasure1.jpg");
  assert.deepEqual(parseCardPage("<p>nada</p>"), { ja: "", artist: "", rarity: "", image: "" });
  assert.equal(imagemOriginal("https://archives.bulbagarden.net/media/upload/3/3a/X.jpg"), "https://archives.bulbagarden.net/media/upload/3/3a/X.jpg");
});

test("lista de expansões: nome japonês -> nome traduzido", () => {
  const html = `<table><tbody><tr><th>Japanese name</th><th>Translated name</th><th>Release</th></tr>
    <tr><td><span lang="ja">シャイニートレジャーex</span></td><td><a href="/wiki/Shiny_Treasure_ex_(TCG)">Shiny Treasure ex</a></td><td>2023</td></tr>
    <tr><td>レイジングサーフ</td><td>Raging Surf</td><td>2023</td></tr></tbody></table>`;
  assert.deepEqual(parseExpansionList(html), { "シャイニートレジャーex": "Shiny Treasure ex", "レイジングサーフ": "Raging Surf" });
});

test("utilitários: URL da API e texto sem tags", () => {
  const u = new URL(parseUrl("Shiny Treasure ex (TCG)"));
  assert.equal(u.searchParams.get("action"), "parse");
  assert.equal(u.searchParams.get("page"), "Shiny Treasure ex (TCG)");
  assert.equal(u.searchParams.get("prop"), "text");
  assert.equal(text("<b>Boss&#39;s</b>&nbsp;<i>Orders</i>"), "Boss's Orders");
});
