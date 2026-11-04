// Testes das fontes do NARUTO カードゲーム (Bandai 2002–2006), sem rede: os
// formatos da página da TV Tokyo que o leitor perdia até 2026-11-04 (a Itachi
// 忍-203 era um deles), o leitor da lista oficial da Bandai e o que o catálogo
// versionado tem de garantir depois de juntar as quatro fontes.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseTvtCards, parseBandaiCardlist, normNumBandai } from "../scripts/lib/naruto-vintage-fontes.mjs";

// Trechos de verdade das páginas da TV Tokyo (card_04, 08, 09 e 13), só sem
// os <table> de volta.
const bloco = (img, num, nome) => `<td width="144"><br>
  <img src="cardimg/${img}" width="80" height="114"> <br>
  <table width="90%" border="0" cellspacing="0" cellpadding="0">
    <tr><td align="center" class="size1115">${num}</td></tr>
    <tr><td align="center" class="size1115" nowrap>${nome}</td></tr>
  </table></td>`;

test("TV Tokyo: o caso comum sai com o mesmo nome de antes, sem nomeSolto", () => {
  const html = bloco("n201.jpg", '<font color="#FFCC66">忍-201</font>', '<font color="#666666">綱手姫</font>');
  assert.deepEqual(parseTvtCards(html), [{ num: "忍-201", name: "綱手姫", img: "n201.jpg" }]);
});

test("TV Tokyo: prefixo em tag própria (a Itachi 忍-203 do vol. 9)", () => {
  const html = bloco("n203.jpg", '<font color="#FFCC66"><font color="#FFCC66">忍</font>-203</font>', '<font color="#666666">うちはイタチ</font>');
  assert.deepEqual(parseTvtCards(html), [{ num: "忍-203", name: "うちはイタチ", img: "n203.jpg", nomeSolto: true }]);
});

test("TV Tokyo: nome em duas linhas, <font> com atributo e nome sem <font>", () => {
  const html = [
    bloco("n172.jpg", '<font color="#FFCC66"><font color="#FFCC66">忍</font>-172</font>', '<font color="#666666">はたけカカシ ＆<br>\n      マイト・ガイ</font>'),
    bloco("n071.jpg", '<font color="#FFCC66">忍-71</font>', '<font color="#666666" class="size1115">奈良シカマル \n </font>'),
    bloco("n190.jpg", '<font color="#FFCC66">忍-190</font>', "聖シモン")
  ].join("\n");
  const cards = parseTvtCards(html);
  assert.deepEqual(cards.map((c) => [c.num, c.name, c.img, !!c.nomeSolto]), [
    ["忍-172", "はたけカカシ ＆マイト・ガイ", "n172.jpg", true],
    ["忍-71", "奈良シカマル", "n071.jpg", true],
    ["忍-190", "聖シモン", "n190.jpg", true]
  ]);
});

test("TV Tokyo: carta sem miniatura não herda a da vizinha lida", () => {
  // Antes o 術-192 (sem miniatura) ficava com a n223.jpg: o leitor não via o
  // 忍-223 (prefixo embrulhado) e a imagem dele caía no trecho do 術-192.
  const html = bloco("n223.jpg", '<font color="#FFCC66"><font color="#FFCC66">忍</font>-223</font>', '<font color="#666666">綱手姫＆シズネ</font>')
    + '<td><table><tr><td class="size1115"><font color="#FFCC66">術-192</font></td></tr><tr><td><font color="#666666">デコピン</font></td></tr></table></td>';
  const cards = parseTvtCards(html);
  assert.equal(cards.find((c) => c.num === "術-192").img, "");
  assert.equal(cards.find((c) => c.num === "忍-223").img, "n223.jpg");
});

test("TV Tokyo: prefixos por extenso viram os curtos do jogo", () => {
  const html = bloco("s235.jpg", '<font color="#FFCC66">作戦-235</font>', '<font color="#666666">最適な<br>\n フォーメーション</font>')
    + bloco("ir030.jpg", '<font color="#FFCC66">依頼人-30</font>', '<font color="#666666">ツナミ</font>');
  assert.deepEqual(parseTvtCards(html).map((c) => [c.num, c.name]), [["作-235", "最適なフォーメーション"], ["依-30", "ツナミ"]]);
});

// Linha de verdade da lista oficial (carddas.com/naruto/cardlist/9th.shtml).
const linhaBandai = (num, nome, onde) => `<tr>
<td rowspan="2" align="center" nowrap bgcolor="#FFEEFF" class="s_font">${num}</td>
<td align="left" bgcolor="#FFFFFF" class="m_font_b" nowrap><a href="javascript:;" onClick="MM_openBrWindow('http://www.carddas.com/cgi-bin/naruto/view_naruto.cgi?/shinobi-203_9.gif','rangers','scrollbars=yes,width=300,height=390')"><font color="#990000">${nome}</font></a></td>
<td align="center" bgcolor="#FFFFFF" class="s_font" nowrap>${onde}</td>
</tr>
<tr>
<td align="left" bgcolor="#FFFFFF" class="s_font" colspan="2">≪真の写輪眼継承者≫ 【これ】は、「写輪眼」を持つ敵忍者がいない場合、激突判定ではダメージを受けない。</td>
</tr>`;

test("Bandai: número, nome e produto de cada linha; o cabeçalho e o texto ficam de fora", () => {
  const html = `<tr><td rowspan="2" align="center" nowrap bgcolor="#990000" class="s_font_wb">No.</td>
    <td align="left" nowrap bgcolor="#990000" class="s_font_wb">カード名</td>
    <td align="center" nowrap bgcolor="#990000" class="s_font_wb">収録</td></tr>`
    + linhaBandai("忍-203", "うちはイタチ", "巻ノ九")
    + linhaBandai("PR-忍-4", "うずまきナルト", "オフィシャルイベント<BR>店舗イベント");
  assert.deepEqual(parseBandaiCardlist(html), [
    { num: "忍-203", name: "うちはイタチ", where: "巻ノ九" },
    { num: "PR忍-4", name: "うずまきナルト", where: "オフィシャルイベント / 店舗イベント" }
  ]);
});

test("Bandai: a numeração das promos vira a grafia do catálogo", () => {
  assert.equal(normNumBandai("PR-忍-3"), "PR忍-3");
  assert.equal(normNumBandai("PR忍-8"), "PR忍-8");
  assert.equal(normNumBandai("PR作15"), "PR作-15");
  assert.equal(normNumBandai("PR騎-1"), "PR騎士-1");
  assert.equal(normNumBandai("忍-1（PS）"), "忍-1(PS)");
  assert.equal(normNumBandai("COIN-8"), "COIN-8");
});

// ── O catálogo versionado ────────────────────────────────────────────────────
const lerCatalogo = () => {
  const s = readFileSync(new URL("../data/naruto/cards.js", import.meta.url), "utf8");
  return JSON.parse(s.slice(s.indexOf("["), s.lastIndexOf("]") + 1));
};
const cards = lerCatalogo();
const vintage = cards.filter((c) => c.vintageLine === "nrtcg");
const porNumero = new Map(vintage.map((c) => [c.number, c]));
const oficial = JSON.parse(readFileSync(new URL("../data/vintage/naruto-bandai-oficial.json", import.meta.url), "utf8"));

test("catálogo: todo número da lista oficial da Bandai está no catálogo", () => {
  const faltam = [...new Set(oficial.pages.flatMap((p) => p.cards.map((c) => c.num)))].filter((n) => !porNumero.has(n));
  assert.deepEqual(faltam, []);
});

test("catálogo: as seis Itachi do jogo (eram 2 até 2026-11-04)", () => {
  const itachi = vintage.filter((c) => /イタチ/.test(c.nameJp || "") && !/カマイタチ/.test(c.nameJp)).map((c) => c.number).sort();
  assert.deepEqual(itachi, ["COIN-8", "忍-203", "忍-259", "忍-263", "忍-365", "忍-367"].sort());
  assert.equal(porNumero.get("忍-203").setId, "nrt-s09");
  assert.equal(porNumero.get("忍-365").setId, "nrt-s15");
});

test("catálogo: ids únicos e todo nome em inglês (o original fica no nameJp)", () => {
  const ids = new Set();
  for (const c of cards) { assert.ok(!ids.has(c.id), `id repetido: ${c.id}`); ids.add(c.id); }
  const semTraducao = vintage.filter((c) => /[぀-ヿ一-鿿]/.test(c.name)).map((c) => `${c.number} ${c.name}`);
  assert.deepEqual(semTraducao, []);
});

test("catálogo: erros da TV Tokyo corrigidos sem trocar a carta por trás do id", () => {
  // エミナ é o 依-35 e segue com o id que as coleções marcaram.
  const emina = cards.find((c) => c.id === "nrt-saku-35");
  assert.equal(emina.number, "依-35");
  assert.equal(emina.nameJp, "エミナ");
  assert.equal(porNumero.get("作-35").nameJp, "紅き四つ葉のクローバーを探せ");
  assert.notEqual(porNumero.get("作-35").id, "nrt-saku-35");
  // 木ノ葉大旋風 é do vol. 12; o 柔拳 do vol. 11 é o 術-231.
  assert.equal(cards.find((c) => c.id === "nrt-J-232").setId, "nrt-s12");
  assert.equal(porNumero.get("術-231").nameJp, "柔拳");
  // K-7 do tcg-db = 騎-7 da Bandai: um 騎-7 só (a Temujin do vol. 13), com o
  // id de sempre, e nenhum "K-" sobrando. (Há outras Temujin com outro
  // número: 騎-1 da 拡張ファイリングシート e a promo PR騎士-1.)
  const ki7 = vintage.filter((c) => c.number === "騎-7" || /^K-/.test(c.number));
  assert.deepEqual(ki7.map((c) => [c.id, c.number, c.nameJp, c.setId]), [["nrt-K-007", "騎-7", "テムジン", "nrt-s13"]]);
});

test("catálogo: volume com a faixa inteira bate com o total oficial", () => {
  // O vol. 10 é a exceção conhecida: 75 números na faixa, total 80 na fonte.
  const porSet = new Map();
  for (const c of vintage) porSet.set(c.setId, (porSet.get(c.setId) || 0) + 1);
  for (const c of vintage.filter((x) => /^nrt-s\d\d$/.test(x.setId) && x.setId !== "nrt-s10")) {
    assert.equal(porSet.get(c.setId), c.setTotal, `${c.setId}: ${porSet.get(c.setId)} de ${c.setTotal}`);
  }
});
