// Parse das listas de carta do 火の国庵 (scripts/lib/hinokunian-lista.mjs), a
// fonte do Carddass Masters do filme do Naruto (jogo cdm) e das cartas de
// coleção da Amada e da Ensky (linha nrt-tc). O fixture é um recorte fiel do
// HTML das páginas (tabelas de 2005, uma linha por carta), sem rede.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseListaHinokunian, confereLista, RARIDADE_DO_PREFIXO } from "../scripts/lib/hinokunian-lista.mjs";

// Resumo + lista, como em cardetting2.html e cardninjutsutaizen.html: a
// tabela de quantidades, a caixa da loja (que não é carta), o cabeçalho de
// cada grupo e as linhas de carta com 2 ou 3 colunas úteis.
const PAGINA = `
<H3><A name="pagetop">NARUTO-ナルト-エッチングカードコレクション・２</A></H3>
<TABLE border="1"><TBODY>
  <TR><TD bgcolor="#d3d3d3">レアリティ</TD><TD bgcolor="#d3d3d3">数量</TD></TR>
  <TR><TD><FONT color="#000000">スペシャル</FONT></TD><TD>１種類</TD></TR>
  <TR><TD><FONT color="#000000">パラレル</FONT></TD><TD>２種類</TD></TR>
  <TR><TD>ノーマル</TD><TD>３種類</TD></TR>
  <TR><TD bgcolor="#d3d3d3">発売日</TD><TD>2005.1.31</TD></TR>
</TBODY></TABLE>
<TABLE border="1"><TBODY><TR>
  <TD width="56"><a href="http://example.invalid/"><img src="x.jpeg" alt="ナルト　エッチングカードコレクション2【ボックス】"></a></TD>
  <TD width="198"><a href="http://example.invalid/">ナルト　エッチングカードコレクション2【ボックス】</a><BR>　<FONT size="-1">定価5,040円（税込）</FONT></TD>
</TR></TBODY></TABLE>
<TABLE width="380" border="1"><TBODY>
  <TR><TH colspan="4" bgcolor="#d3d3d3">ノーマルカード</TH></TR>
  <TR><TD align="center" colspan="2" bgcolor="#d3d3d3">カードNO</TD><TD bgcolor="#d3d3d3">カード名</TD><TD bgcolor="#d3d3d3"></TD></TR>
  <TR><TD width="30" align="center">　</TD><TD width="65" align="center">No.46</TD><TD width="244"><FONT size="-1">KONOHA</FONT></TD><TD width="28"></TD></TR>
  <TR><TD align="center">　</TD><TD align="center">No.47</TD><TD><FONT size="-1">NARUTO KABUTO</FONT></TD><TD></TD></TR>
  <TR><TD></TD><TD width="51"></TD><TD width="255">劇場版キャラクターカード</TD><TD width="11"></TD></TR>
  <TR><TD align="center">　</TD><TD align="center">No.048</TD><TD><FONT size="-1">うずまきナルト＆我愛羅</FONT></TD><TD></TD></TR>
  <TR><TD colspan="4" bgcolor="#d3d3d3"><B>パラレルエッチングカード</B></TD></TR>
  <TR><TD align="center">　</TD><TD align="center">Pa.01</TD><TD><FONT size="-1">NARUTO</FONT></TD><TD></TD></TR>
  <TR><TD align="center">　</TD><TD align="center">Pa.02</TD><TD><FONT size="-1">SASUKE SAKURA</FONT></TD><TD></TD></TR>
</TBODY></TABLE>
<TABLE width="380" border="1"><TBODY>
  <TR><TH colspan="4" bgcolor="#d3d3d3"><A name="shinobicard">スペシャルカード</A></TH></TR>
  <TR><TD colspan="2" bgcolor="#d3d3d3">カードNO</TD><TD bgcolor="#d3d3d3">カード名</TD><TD bgcolor="#d3d3d3">術者名</TD></TR>
  <TR><TD colspan="2" align="center">SP.01</TD><TD><FONT size="-1">口寄せの術</FONT></TD><TD><FONT size="-1">四代目</FONT></TD></TR>
</TBODY></TABLE>
<TABLE><TBODY><TR><TD>・1話～5話</TD><TD>・6話～10話</TD></TR><TR><TD>トレード</TD></TR></TBODY></TABLE>`;

test("página: título, data, quantidades e uma carta por linha, com o grupo e a 3ª coluna", () => {
  const l = parseListaHinokunian(PAGINA);
  assert.equal(l.titulo, "NARUTO-ナルト-エッチングカードコレクション・２");
  assert.equal(l.data, "2005.1.31");
  // algarismo de largura cheia vira número
  assert.deepEqual(l.quantidades, { "スペシャル": 1, "パラレル": 2, "ノーマル": 3 });
  assert.deepEqual(l.cartas, [
    { prefixo: "No", num: "46", nome: "KONOHA", extra: "", grupo: "ノーマルカード" },
    { prefixo: "No", num: "47", nome: "NARUTO KABUTO", extra: "", grupo: "ノーマルカード" },
    // o zero à esquerda fica como a página escreve; o grupo muda na linha de uma célula só
    { prefixo: "No", num: "048", nome: "うずまきナルト＆我愛羅", extra: "", grupo: "劇場版キャラクターカード" },
    { prefixo: "Pa", num: "01", nome: "NARUTO", extra: "", grupo: "パラレルエッチングカード" },
    { prefixo: "Pa", num: "02", nome: "SASUKE SAKURA", extra: "", grupo: "パラレルエッチングカード" },
    // 忍術大全: a 3ª coluna é quem usa o jutsu
    { prefixo: "SP", num: "01", nome: "口寄せの術", extra: "四代目", grupo: "スペシャルカード" }
  ]);
  // a caixa da loja, os cabeçalhos e o menu do site não viram carta nem grupo
  assert.ok(l.cartas.every((c) => !/ボックス|カードNO|話/.test(c.nome + c.grupo)));
});

test("autoconferência: o parse só vale se bater com o resumo da própria página", () => {
  const l = parseListaHinokunian(PAGINA);
  assert.deepEqual(confereLista(l), []);
  // uma carta a menos que o anunciado
  const falta = { ...l, cartas: l.cartas.slice(1) };
  assert.deepEqual(confereLista(falta), ["ノーマル: a página diz 3, o parse achou 2"]);
  // raridade que a página não anuncia (layout novo, tabela de outro produto)
  const sobra = { ...l, cartas: [...l.cartas, { prefixo: "V", num: "01", nome: "X", extra: "", grupo: "" }] };
  assert.deepEqual(confereLista(sobra), ["バラエティ: a página diz 0, o parse achou 1"]);
  // número repetido e carta sem nome
  assert.ok(confereLista({ ...l, cartas: [...l.cartas.slice(0, 5), l.cartas[4]] }).includes("número repetido"));
  assert.ok(confereLista({ ...l, cartas: l.cartas.map((c, i) => (i ? c : { ...c, nome: "" })) }).includes("carta sem nome"));
  // página vazia (fora do ar com 200, erro do hospedeiro)
  assert.ok(confereLista(parseListaHinokunian("<html><body>404</body></html>")).includes("nenhuma carta"));
  // raridade anunciada sem quantidade (o Etching 1 lista "スペシャル" em branco) não conta
  const semEspecial = parseListaHinokunian(PAGINA.replace("<TD>１種類</TD>", "<TD>　</TD>").replace(/<TR><TD colspan="2" align="center">SP\.01[\s\S]*?<\/TR>/, ""));
  assert.deepEqual(confereLista(semEspecial), []);
  assert.deepEqual(Object.keys(RARIDADE_DO_PREFIXO), ["No", "Pa", "V", "SP"]);
});
