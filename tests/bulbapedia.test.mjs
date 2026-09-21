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
import { parseSetList, parseSetLists, escolherLista, parseCardPage, parseExpansionList, normalizarNomeJa, mapaDeNomes, parseUrl, imagemOriginal, text } from "../scripts/lib/bulbapedia.mjs";

const LISTA = `
<div class="mw-parser-output"><p>intro</p>
<!-- a lista OCIDENTAL da mesma página (Noble Victories, 1/101): a célula do tipo é <th> -->
<table class="roundy"><tbody>
<tr><th>No.</th><th style="display:none;">Image</th><th class="unsortable">Card name</th><th class="unsortable">Type</th><th class="unsortable">Rarity</th><th style="display:none;">Promotion</th></tr>
<tr><td>1/101</td><td style="display:none;"><img src="https://archives.bulbagarden.net/media/upload/6/6e/TCG2_A01_Bulbasaur.png"></td><td><a href="/wiki/Sewaddle_(Noble_Victories_1)" title="Sewaddle (Noble Victories 1)">Sewaddle</a></td>
    <th align="center"><span typeof="mw:File"><a href="/wiki/Grass_Energy_(TCG)" title="Grass"><img alt="Grass" src="https://archives.bulbagarden.net/media/upload/thumb/2/2e/Grass-attack.png/20px-Grass-attack.png"></a></span></th>
    <td><a href="/wiki/Rarity" title="Common"><img alt="Common" src="https://archives.bulbagarden.net/media/upload/thumb/8/8c/Rarity_Common.png/21px-Rarity_Common.png"></a></td><td style="display:none;">Promotion</td></tr>
</tbody></table>
<!-- a lista JAPONESA (Red Collection, 001/066) -->
<table class="roundy"><tbody>
<tr><th>No.</th><th style="display:none;">Image</th><th class="unsortable">Card name</th><th class="unsortable">Type</th><th class="unsortable">Rarity</th><th style="display:none;">Promotion</th></tr>
<tr><td>001/066</td><td style="display:none;"><img src="https://archives.bulbagarden.net/media/upload/6/6e/TCG2_A01_Bulbasaur.png"></td><td><a href="/wiki/Dwebble_(Red_Collection_1)" class="mw-redirect" title="Dwebble (Red Collection 1)">Dwebble</a></td>
    <th align="center"><span typeof="mw:File"><a href="/wiki/Grass_Energy_(TCG)" title="Grass"><img alt="Grass" src="https://archives.bulbagarden.net/media/upload/thumb/2/2e/Grass-attack.png/20px-Grass-attack.png"></a></span></th>
    <td>C</td><td style="display:none;">Promotion</td></tr>
<tr><td>066/066</td><td style="display:none;"></td><td><a href="/wiki/Boss%27s_Orders_(Red_Collection_66)" title="Boss's Orders (Red Collection 66)">Boss&#39;s Orders</a></td>
    <th align="center">Supporter</th><td>SR</td><td style="display:none;">Promotion</td></tr>
<tr><td>lixo</td><td></td><td>sem link nem número</td><th></th><td></td><td></td></tr>
</tbody></table>
<table><tbody>
<tr><th>Rarity</th><th>Card name</th><th>No.</th></tr>
<tr><td>UR</td><td><a href="/wiki/Basic_Grass_Energy_(Red_Collection_67)" title="Basic Grass Energy (Red Collection 67)">Basic Grass Energy</a></td><td>067</td></tr>
</tbody></table>
<table><tbody><tr><th>Sem</th><th>Cabeçalho</th></tr><tr><td>x</td><td>y</td></tr></tbody></table>
</div>`;

test("lista de set: célula <th> no meio da linha, coluna oculta, ícone vira alt, várias tabelas, linha inválida fora", () => {
  const listas = parseSetLists(LISTA);
  assert.equal(listas.length, 3);
  assert.deepEqual(listas[0].cards, [{ number: "1/101", en: "Sewaddle", page: "Sewaddle (Noble Victories 1)", type: "Grass", rarity: "Common", mark: "" }]);
  assert.deepEqual(listas[1].cards[0], { number: "001/066", en: "Dwebble", page: "Dwebble (Red Collection 1)", type: "Grass", rarity: "C", mark: "" });
  assert.deepEqual(listas[1].cards[1], { number: "066/066", en: "Boss's Orders", page: "Boss's Orders (Red Collection 66)", type: "Supporter", rarity: "SR", mark: "" });
  assert.equal(listas[1].cards.length, 2);
  assert.deepEqual(listas[2].cards, [{ number: "067", en: "Basic Grass Energy", page: "Basic Grass Energy (Red Collection 67)", type: "", rarity: "UR", mark: "" }]);
  assert.equal(parseSetList(LISTA).length, 4);
  assert.deepEqual(parseSetLists("<p>sem tabela</p>"), []);
});

test("escolherLista: a japonesa pelo total do set; senão pela contagem; senão a última", () => {
  const listas = parseSetLists(LISTA);
  assert.equal(escolherLista(listas, { total: 66, count: 66 }).cards[0].en, "Dwebble");
  assert.equal(escolherLista(listas, { total: 101, count: 101 }).cards[0].en, "Sewaddle");
  assert.equal(escolherLista(listas, { total: 0, count: 1 }).cards[0].en, "Sewaddle");   // 1 carta: a mais próxima
  assert.equal(escolherLista(listas, { total: 999, count: 66 }), null);                   // total conhecido sem lista que case: não chuta
  // par de sets: duas tabelas com o MESMO total — os nomes do chunk desempatam
  const scarlet = { cards: [{ number: "001/078", en: "Sprigatito" }, { number: "002/078", en: "Floragato" }] };
  const violet = { cards: [{ number: "001/078", en: "Fuecoco" }, { number: "002/078", en: "Crocalor" }] };
  const nomesVioleta = new Map([["1", "fuecoco"], ["2", "crocalor"]]);
  assert.equal(escolherLista([scarlet, violet], { total: 78, nomes: nomesVioleta }), violet);
  assert.equal(escolherLista([scarlet, violet], { total: 78, nomes: new Map([["1", "sprigatito"]]) }), scarlet);
  assert.equal(escolherLista([scarlet, violet], { total: 78 }), scarlet);                  // sem nomes: a primeira
  assert.equal(escolherLista(listas, {}).cards[0].en, "Basic Grass Energy");             // sem pista: a última
  assert.equal(escolherLista([listas[1]], { total: 999 }).cards[0].en, "Dwebble");        // uma só: ela
  assert.equal(escolherLista([], { total: 66 }), null);
});

const CARTA = `
<div class="mw-parser-output">
<table class="roundy"><tbody>
<tr><th colspan="2"><b>Dwebble</b> <span lang="ja">イシズマイ</span> <i>Ishizumai</i></th></tr>
<tr><td><a href="/wiki/Grass_Energy_(TCG)"><img alt="Grass" src="https://archives.bulbagarden.net/media/upload/thumb/2/2e/Grass-attack.png/25px-Grass-attack.png"></a>
    <a href="/wiki/File:DwebbleNobleVictories6.jpg"><img src="https://archives.bulbagarden.net/media/upload/thumb/3/3c/DwebbleNobleVictories6.jpg/180px-DwebbleNobleVictories6.jpg" width="180" srcset="https://archives.bulbagarden.net/media/upload/thumb/3/3c/DwebbleNobleVictories6.jpg/360px-DwebbleNobleVictories6.jpg 2x"></a></td></tr>
<tr><td width="100px" align="right"><b>English expansion</b></td><td><a href="/wiki/Noble_Victories_(TCG)" title="Noble Victories (TCG)">Noble Victories</a></td></tr>
<tr><td width="100px" align="right"><b>Rarity</b></td><td><span typeof="mw:File"><a href="/wiki/Rarity" title="Common"><img alt="Common" src="https://archives.bulbagarden.net/media/upload/thumb/8/8c/Rarity_Common.png/21px-Rarity_Common.png"></a></span></td></tr>
<tr><th>Illus.</th><td><a href="/wiki/MAHOU" title="MAHOU">MAHOU</a></td></tr>
</tbody></table></div>`;

test("página de carta: nome japonês, ilustrador, raridade e o scan ORIGINAL do Archives", () => {
  const r = parseCardPage(CARTA);
  assert.equal(r.ja, "イシズマイ");
  assert.equal(r.artist, "MAHOU");
  assert.equal(r.rarity, "Common");
  // o scan é o 1º .jpg (o ícone de Grama vem antes e é .png); thumb vira o original
  assert.equal(r.image, "https://archives.bulbagarden.net/media/upload/3/3c/DwebbleNobleVictories6.jpg");
  // página só com ícones .png: sem imagem, em vez do ícone
  assert.equal(parseCardPage('<img src="https://archives.bulbagarden.net/media/upload/thumb/2/2e/Grass-attack.png/25px-Grass-attack.png">').image, "");
  assert.deepEqual(parseCardPage("<p>nada</p>"), { ja: "", artist: "", rarity: "", image: "" });
  assert.equal(imagemOriginal("https://archives.bulbagarden.net/media/upload/3/3a/X.jpg"), "https://archives.bulbagarden.net/media/upload/3/3a/X.jpg");
});

test("lista de expansões: japonês e tradução na MESMA célula (forma real), ou em duas colunas", () => {
  // forma real do wiki: uma célula "Japanese name" com o span lang="ja" e a tradução ao lado
  const real = `<table><tbody><tr><th>Set</th><th>Japanese name</th><th>Cards</th><th>Release date</th></tr>
    <tr><td>1</td><td><span lang="ja">拡張パック</span> Expansion Pack</td><td>102</td><td>October 20, 1996</td></tr>
    <tr><td>2</td><td>闇からの挑戦 Challenge from the Darkness</td><td>65</td><td>1997</td></tr>
    <tr><td>3</td><td><a href="/wiki/Gym_Challenge_(TCG)">Gym Challenge</a></td><td>132</td><td>1998</td></tr>
    <tr><td>4</td><td><span lang="ja">TAG TEAM GX タッグオールスターズ</span> TAG TEAM GX Tag All Stars</td><td>173</td><td>2019</td></tr></tbody></table>
    <!-- coluna "English expansion" é o set OCIDENTAL equivalente, não a tradução: fica a da célula -->
    <table><tbody><tr><th>Japanese name</th><th>English expansion</th></tr>
    <tr><td><span lang="ja">レッドコレクション</span> Red Collection</td><td><a href="/wiki/Noble_Victories_(TCG)">Noble Victories</a></td></tr></tbody></table>
    <table><tbody><tr><th>Japanese release</th><th>Cards</th></tr><tr><td>2</td><td>August 2001 – July 2002</td></tr></tbody></table>`;
  assert.deepEqual(parseExpansionList(real), {
    "拡張パック": "Expansion Pack",
    "闇からの挑戦": "Challenge from the Darkness",
    "TAG TEAM GX タッグオールスターズ": "TAG TEAM GX Tag All Stars",
    "レッドコレクション": "Red Collection"
  });
  // duas colunas separadas também funciona
  const duas = `<table><tbody><tr><th>Japanese name</th><th>Translated name</th><th>Release</th></tr>
    <tr><td><span lang="ja">シャイニートレジャーex</span></td><td><a href="/wiki/Shiny_Treasure_ex_(TCG)">Shiny Treasure ex</a></td><td>2023</td></tr>
    <tr><td>レイジングサーフ</td><td>Raging Surf</td><td>2023</td></tr></tbody></table>`;
  assert.deepEqual(parseExpansionList(duas), { "シャイニートレジャーex": "Shiny Treasure ex", "レイジングサーフ": "Raging Surf" });
  assert.equal(normalizarNomeJa("サン＆ムーン "), "サン&ムーン");
  // pares numa linha só viram duas entradas; par desigual não entra
  const m = mapaDeNomes({ "一撃マスター • 連撃マスター": "Single Strike Master • Rapid Strike Master", "禁断の光": "Forbidden Light", "白銀のランス • 漆黒のガイスト": "Chilling Reign" });
  assert.equal(m.get(normalizarNomeJa("連撃マスター")), "Rapid Strike Master");
  assert.equal(m.get(normalizarNomeJa("禁断の光")), "Forbidden Light");
  assert.equal(m.get(normalizarNomeJa("白銀のランス")), undefined);
  assert.equal(normalizarNomeJa("TAG TEAM GX タッグオールスターズ"), "tagteamgxタッグオールスターズ");
});

test("utilitários: URL da API e texto sem tags", () => {
  const u = new URL(parseUrl("Shiny Treasure ex (TCG)"));
  assert.equal(u.searchParams.get("action"), "parse");
  assert.equal(u.searchParams.get("page"), "Shiny Treasure ex (TCG)");
  assert.equal(u.searchParams.get("prop"), "text");
  assert.equal(text("<b>Boss&#39;s</b>&nbsp;<i>Orders</i>"), "Boss's Orders");
});
