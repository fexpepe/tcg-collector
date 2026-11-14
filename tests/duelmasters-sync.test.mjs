// Testes do sync do Duel Masters (scripts/sync-duelmasters.mjs), sem rede: a
// leitura do banco oficial da Takara Tomy (filtro de produtos, lista, ficha),
// a leitura da página de set da Yuyu-tei e a chave do número impresso que casa
// as duas fontes (as quatro diferenças de grafia medidas em 13/11/2026).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseProdutos, codigoETitulo, setIdDe, parseLista, parseFicha, idDaCarta, chaveDoNumero, chavesNaLoja,
  parseLoja, parseSetsDaLoja, codigoNaLoja, cardOf, imagemDaCarta, visitaHoje
} from "../scripts/sync-duelmasters.mjs";
import { dataDoRelease, escolhePaginas } from "../scripts/duelmasters-datas.mjs";

test("filtro de produtos: valor e rótulo, sem o 'não especificado'", () => {
  const html = `<select name="products" id="x"><option value="">指定なし</option>
    <option value="26rp3">DM26-RP3 逆札篇 第3弾 勝敵！逆転おこせ鬼の∞ディスペクター!!</option>
    <option value="promoy5">プロモ限定カード 5期</option><option value="1">DM-01</option></select>`;
  assert.deepEqual(parseProdutos(html), [
    { valor: "26rp3", rotulo: "DM26-RP3 逆札篇 第3弾 勝敵！逆転おこせ鬼の∞ディスペクター!!" },
    { valor: "promoy5", rotulo: "プロモ限定カード 5期" },
    { valor: "1", rotulo: "DM-01" }
  ]);
});

test("código e título do rótulo; setId em ASCII", () => {
  assert.deepEqual(codigoETitulo("DM26-RP3 逆札篇 第3弾"), ["DM26-RP3", "逆札篇 第3弾"]);
  assert.deepEqual(codigoETitulo("DMR-01 エピソード1 ファースト・コンタクト"), ["DMR-01", "エピソード1 ファースト・コンタクト"]);
  assert.deepEqual(codigoETitulo("DM-01"), ["DM-01", ""]);
  // O kanji de edição cola no código, com ou sem espaço depois.
  assert.deepEqual(codigoETitulo("DMR-16真 ドラゴン・サーガ"), ["DMR-16真", "ドラゴン・サーガ"]);
  assert.deepEqual(codigoETitulo("DMART極-03 神アート極"), ["DMART極-03", "神アート極"]);
  assert.deepEqual(codigoETitulo("DMPCD-01デュエマプレイス・コラボデッキ"), ["DMPCD-01", "デュエマプレイス・コラボデッキ"]);
  // Sem código: as promos e os decks da CoroCoro.
  assert.deepEqual(codigoETitulo("プロモ限定カード 5期"), ["", "プロモ限定カード 5期"]);
  assert.deepEqual(codigoETitulo("コロコロ・スペシャル デッキ13"), ["", "コロコロ・スペシャル デッキ13"]);

  assert.equal(setIdDe({ valor: "26rp3", rotulo: "DM26-RP3 逆札篇 第3弾" }), "DM26-RP3");
  assert.equal(setIdDe({ valor: "1", rotulo: "DM-01" }), "DM-01");
  assert.equal(setIdDe({ valor: "r16s", rotulo: "DMR-16真 ドラゴン・サーガ" }), "DMR-16SHIN");
  assert.equal(setIdDe({ valor: "art極03", rotulo: "DMART極-03 神アート極" }), "DMARTKIWAMI-03");
  assert.equal(setIdDe({ valor: "promoy5", rotulo: "プロモ限定カード 5期" }), "PROMOY5");
});

test("lista: só os ids da grade de resultado", () => {
  const html = `<a href='/card/detail/?id=fora-001'>x</a><div id="cardlist"><ul>
    <li><a href='/card/detail/?id=dm26rp3-SEC001' data-href='/card/detail/?id=dm26rp3-SEC001'><img class='cardImage' data-href='/card/detail/?id=dm26rp3-SEC001' src='/wp-content/card/cardthumb/dm26rp3-SEC001.jpg'/></a></li>
    <li><a href='/card/detail/?id=dm26rp3-S001' data-href='/card/detail/?id=dm26rp3-S001'><img class='cardImage' data-href='/card/detail/?id=dm26rp3-S001' src='/wp-content/card/cardthumb/dm26rp3-S001.jpg'/></a></li></ul></div>`;
  assert.deepEqual(parseLista(html), ["dm26rp3-SEC001", "dm26rp3-S001"]);
  assert.deepEqual(parseLista("<html></html>"), []);
});

const FICHA = `<div class='cardDetail'><div class='card-itself'><div class='row'><h3 class='card-name'>SUPREME-GUN・ザ・ジョニー<span class='packname'>(DM26RP3 S1/S11)</span></h3></div>
<div class="card-img"><img src="/wp-content/card/cardimage/dm26rp3-S001.jpg" alt="x"></div>
<table><tbody><tr><th><p>カードの種類</p></th><td class='type'>S-MAX進化クリーチャー</td><th><p>文明</p></th><td class='civil'>ゼロ</td></tr></tbody></table>
<table><tbody><tr><th><p>レアリティ</p></th><td class='rarelity'>SR</td><th><p>パワー</p></th><td class='power'>10000</td></tr></tbody></table>
<table><tbody><tr><th><p>コスト</p></th><td class='cost'>7</td><th><p>マナ</p></th><td class='mana'>1</td></tr></tbody></table>
<table><tbody><tr><th><p>種族</p></th><td class='race'>ジョーカーズ/レクスターズ/スプリガン</td></tr></tbody></table>
<table><tbody><tr><th class='illusttitle'>イラストレーター</th><td colspan='3' class='illusttxt'>Adachi Yosuke</td></tr></tbody></table>
<table><tbody><tr><td class='skills full'><li>texto</li></td></tr></tbody></table></div></div>`;

test("ficha: os campos da carta e o número impresso", () => {
  assert.deepEqual(parseFicha(FICHA), {
    nome: "SUPREME-GUN・ザ・ジョニー", numero: "S1/S11", tipo: "S-MAX進化クリーチャー", civilizacao: "ゼロ",
    raridade: "SR", poder: "10000", custo: 7, raca: "ジョーカーズ/レクスターズ/スプリガン", ilustrador: "Adachi Yosuke",
    imagem: "https://dm.takaratomy.co.jp/wp-content/card/cardimage/dm26rp3-S001.jpg"
  });
  assert.equal(parseFicha("<html>fora do ar</html>"), null);
});

test("ficha de duas faces: vale a frente; secreta guarda o ㊙ do número", () => {
  const duas = FICHA.replace("SUPREME-GUN・ザ・ジョニー<span class='packname'>(DM26RP3 S1/S11)", "竜骨なる者ザビ・リゲル<span class='packname'>(DMR01 53/110)")
    + `<div class='card-itself'><h3 class='card-name'>死海竜ガロウズ・デビルドラゴン<span class='packname'>(DMR01 53/110)</span></h3><div class="card-img"><img src="/wp-content/card/cardimage/dmr01-053b.jpg"></div></div>`;
  const f = parseFicha(duas);
  assert.equal(f.nome, "竜骨なる者ザビ・リゲル");
  assert.equal(f.numero, "53/110");
  assert.equal(f.imagem, "https://dm.takaratomy.co.jp/wp-content/card/cardimage/dm26rp3-S001.jpg");
  const secreta = parseFicha(FICHA.replace("(DM26RP3 S1/S11)", "(DM26RP3 ㊙1/㊙24)"));
  assert.equal(secreta.numero, "㊙1/㊙24");
});

test("id da carta: minúsculas, kanji por extenso, só o que o banco aceita", () => {
  assert.equal(idDaCarta("dm26rp3-S001"), "dm-dm26rp3-s001");
  assert.equal(idDaCarta("dmr01-053M"), "dm-dmr01-053m");
  assert.equal(idDaCarta("dmart極03-001"), "dm-dmartkiwami03-001");
  // "+" e "$" por extenso: como hífen, a "s06$" colidia com a "s06".
  assert.equal(idDaCarta("dm34+1s-001"), "dm-dm34plus1s-001");
  assert.equal(idDaCarta("dmrp07-s06$"), "dm-dmrp07-s06-dollar");
  assert.notEqual(idDaCarta("dmrp07-s06$"), idDaCarta("dmrp07-s06"));
  for (const id of ["dm26ex5-SEC002CHO", "dm01-s01", "dmr16真-01a"]) assert.match(idDaCarta(id), /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/);
});

test("chave do número: as quatro diferenças entre o oficial e a loja", () => {
  // secreta
  assert.equal(chaveDoNumero("㊙1/㊙24"), chaveDoNumero("(秘)1/(秘)24"));
  // zero à esquerda
  assert.equal(chaveDoNumero("S01/S10"), chaveDoNumero("S1/S10"));
  // numeração sem total
  assert.equal(chaveDoNumero("STD9/"), chaveDoNumero("STD9"));
  assert.equal(chaveDoNumero("STD超㊙9/"), chaveDoNumero("STD超(秘)9"));
  // duas faces e a edição alternativa
  assert.equal(chaveDoNumero("41/110"), chaveDoNumero("41a/110｜41b/110"));
  assert.equal(chaveDoNumero("53m/110"), chaveDoNumero("53am/110｜53b/110"));
  assert.equal(chaveDoNumero("V1/V2"), chaveDoNumero("V1a/V2｜V1b/V2"));
  // o ano que a loja cola nos sets de 2002 a 2018
  assert.equal(chaveDoNumero("S1/S5"), chaveDoNumero("S1/S5/Y5"));
  assert.equal(chaveDoNumero("53/55"), chaveDoNumero("53/55/Y6"));
  assert.equal(chaveDoNumero("76/80"), chaveDoNumero("76/80 [2017]"));
  assert.equal(chaveDoNumero("P12/Y5"), "P12/Y5"); // promo do oficial: o Y é o total, fica
  // duas faces com uma ficha por face no oficial ("66A/80", "66B/80")
  assert.deepEqual(chavesNaLoja("66a/80 [2015]｜66b/80 [2015]"), ["66/80", "66A/80", "66B/80"]);
  assert.deepEqual(chavesNaLoja("S1/S5/Y5"), ["S1/S5"]);
  // e o que NÃO pode casar
  assert.notEqual(chaveDoNumero("1/110"), chaveDoNumero("10/110"));
  assert.notEqual(chaveDoNumero("S1/S11"), chaveDoNumero("㊙1/㊙24"));
  assert.notEqual(chaveDoNumero("53/110"), chaveDoNumero("53m/110"));
});

test("loja: número, nome e preço de cada anúncio (com quebra de linha entre as tags)", () => {
  const html = `<a href="https://yuyu-tei.jp/sell/dm/card/dm26rp3/10121">
    <div class="position-relative product-img">
      <img src="https://card.yuyu-tei.jp/dm/100_140/dm26rp3/10121.jpg" alt="(秘)1/(秘)24 SE Σ龍" class="card img-fluid"/></div></a>
    <span class="d-block border border-dark p-1 w-100 text-center my-2">(秘)1/(秘)24</span>
    <a href="https://yuyu-tei.jp/sell/dm/card/dm26rp3/10121"><h4 class="text-primary fw-bold">Σ龍(シークレットレア仕様)</h4></a>
    <strong class="d-block text-end ">780 円</strong>
    <a href="https://yuyu-tei.jp/sell/dm/card/dm26rp3/10120">
    <div class="position-relative product-img"><img src="x.jpg" alt="y" class="card"/></div></a>
    <span class="d-block">DM1(秘)/DM1</span><a href="#"><h4 class="x">勝敵逆夢王 モウジャキンガ</h4></a>
    <strong class="d-block text-end text-danger">59,800 円</strong>`;
  assert.deepEqual(parseLoja(html), [
    { numero: "(秘)1/(秘)24", nome: "Σ龍(シークレットレア仕様)", iene: 780 },
    { numero: "DM1(秘)/DM1", nome: "勝敵逆夢王 モウジャキンガ", iene: 59800 }
  ]);
  assert.deepEqual(parseLoja("<html></html>"), []);
});

test("código do set na loja: prefixo do id, código do rótulo e o DM-01", () => {
  const loja = parseSetsDaLoja(`<option value="dm26rp3">x</option><option value="dm01">y</option><option value="dmartkiwami03">z</option><option value="spdeck11">w</option>`);
  assert.equal(codigoNaLoja({ valor: "26rp3", rotulo: "DM26-RP3 逆札篇" }, "dm26rp3", loja), "dm26rp3");
  assert.equal(codigoNaLoja({ valor: "1", rotulo: "DM-01" }, "", loja), "dm01");
  assert.equal(codigoNaLoja({ valor: "art極03", rotulo: "DMART極-03 神アート極" }, "", loja), "dmartkiwami03");
  assert.equal(codigoNaLoja({ valor: "spdeck11", rotulo: "コロコロ・スペシャル デッキ11" }, "", loja), "spdeck11");
  assert.equal(codigoNaLoja({ valor: "promoy5", rotulo: "プロモ限定カード 5期" }, "", loja), "");
});

test("carta: campos do catálogo e a imagem pelo proxy", () => {
  const c = cardOf("dm26rp3-S001", parseFicha(FICHA), { id: "DM26-RP3", nome: "逆札篇 第3弾", total: 156, data: "2026-09-19" });
  assert.equal(c.id, "dm-dm26rp3-s001");
  assert.equal(c.setId, "DM26-RP3");
  assert.equal(c.number, "S1/S11");
  assert.equal(c.language, "ja");
  assert.equal(c.color, "ゼロ");
  assert.equal(c.cost, 7);
  assert.equal(c.artist, "Adachi Yosuke");
  assert.deepEqual(c.variants, ["Normal"]);
  assert.equal(c.image, "https://wsrv.nl/?url=dm.takaratomy.co.jp%2Fwp-content%2Fcard%2Fcardimage%2Fdm26rp3-S001.jpg&w=650&we&output=webp");
  assert.equal(imagemDaCarta(""), "");
});

test("loja no incremental: set novo todo dia, antigo uma vez por semana", () => {
  const hoje = "2026-11-13"; // sexta: getUTCDay() = 5
  assert.equal(visitaHoje({ data: "2026-09-19" }, 3, hoje), true);
  assert.equal(visitaHoje({ data: "2011-06-25" }, 5, hoje), true);
  assert.equal(visitaHoje({ data: "2011-06-25" }, 6, hoje), false);
  assert.equal(visitaHoje({ data: "" }, 12, hoje), true); // 12 % 7 = 5
  assert.equal(visitaHoje({ data: "" }, 13, hoje), false);
});

test("datas da wiki: só data completa, e as páginas do produto", () => {
  assert.equal(dataDoRelease("June 25, 2011"), "2011-06-25");
  assert.equal(dataDoRelease("[[May]] 30th, 2002"), "2002-05-30");
  assert.equal(dataDoRelease("25 June 2011"), "2011-06-25");
  assert.equal(dataDoRelease("2011年6月25日"), "2011-06-25");
  assert.equal(dataDoRelease("March, 2004"), "");
  assert.equal(dataDoRelease(""), "");
  assert.deepEqual(escolhePaginas("DM-06", ["DM-06 Stomp-A-Trons of Invincible Wrath Gallery (TCG)", "DM-06", "DM-06 Stomp-A-Trons of Invincible Wrath", "DM-06 Invincible Soul Gallery (OCG)", "DM-06 Invincible Soul", "Cycle/DM-06 to DM-09"]),
    ["DM-06 Stomp-A-Trons of Invincible Wrath", "DM-06 Invincible Soul"]);
});
