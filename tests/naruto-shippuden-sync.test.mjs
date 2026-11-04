// NARUTO 疾風伝 カードゲーム (linha nrt-scg, 2026-11-04): o parse das listas
// oficiais do site da Bandai (pelo Wayback), o id a partir do número impresso,
// a regra do set de estreia e o snapshot versionado contra os totais oficiais.
// Sem rede: fixtures e o snapshot do repositório.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRODUTOS, idDaCarta, nomeLimpo, parseLista, parseTcgDb, montaLinha } from "../scripts/sync-naruto-shippuden.mjs";

const snapshot = JSON.parse(readFileSync(new URL("../data/vintage/naruto-shippuden.json", import.meta.url), "utf8"));
const catalogoNaruto = () => {
  const s = readFileSync(new URL("../data/naruto/cards.js", import.meta.url), "utf8");
  return JSON.parse(s.slice(s.indexOf("["), s.lastIndexOf("]") + 1));
};

test("id ASCII a partir do número impresso; o que não é da linha fica de fora", () => {
  assert.equal(idDaCarta("忍伝-001"), "nrt-scg-nin-001");
  assert.equal(idDaCarta("術伝-025"), "nrt-scg-jutsu-025");
  assert.equal(idDaCarta("作伝-065"), "nrt-scg-saku-065");
  assert.equal(idDaCarta("忍伝-学040"), "nrt-scg-gaku-nin-040");
  assert.equal(idDaCarta("PR忍伝-1"), "nrt-scg-pr-nin-001");
  assert.equal(idDaCarta("PR作伝-5"), "nrt-scg-pr-saku-005");
  assert.equal(idDaCarta("PR-学010"), "nrt-scg-pr-gaku-010");
  // As NM-xxx da lista do 忍者学校ルール são do Data Carddass (linha nrt-dc).
  assert.equal(idDaCarta("NM-053"), null);
  // O jogo de 2002 numera sem o 伝: não é desta linha.
  assert.equal(idDaCarta("忍-001"), null);
});

test("nome como está impresso: sem a leitura em parênteses, ＆ e entidade decodificada", () => {
  assert.equal(nomeLimpo("来迎千手殺(らいごうせんじゅさつ)"), "来迎千手殺");
  assert.equal(nomeLimpo("究極連係（ナルティメットコンビネーション）"), "究極連係");
  assert.equal(nomeLimpo("うずまきナルト&amp;うちはサスケ"), "うずまきナルト＆うちはサスケ");
  assert.equal(nomeLimpo("火影式耳順術・廓庵入&#37181;垂手"), "火影式耳順術・廓庵入" + String.fromCodePoint(37181) + "垂手");
  assert.equal(nomeLimpo("?????"), "？？？？？");
  // Qualificador em kanji não é leitura: fica.
  assert.equal(nomeLimpo("うずまきナルト(疾風伝)"), "うずまきナルト(疾風伝)");
});

test("parseLista: número, nome e 収録 de cada carta; o cabeçalho cai fora", () => {
  const html = `<table><tr>
<td rowspan="2" align="center" class="s_font_wb">No.</td>
<td class="s_font_wb">カード名</td>
<td class="s_font_wb">収録</td>
</tr>
<tr>
<td rowspan="2" align="center" nowrap bgcolor="#FFEEFF" class="s_font">術伝-025</td>
<td align="left" class="m_font_b" nowrap><a href="javascript:;" onClick="MM_openBrWindow('x')"><font color="#990000">螺旋丸</font></a></td>
<td align="center" class="s_font" nowrap>第一幕スターター</td>
</tr>
<td align="left" class="s_font" colspan="2">条件：「うずまきナルト」、「自来也」</td>
<tr>
<td rowspan="2" class="s_font" align="center" bgcolor="#ffeeff" nowrap="nowrap">忍伝-075</td>
<td class="m_font_b" align="left" bgcolor="#ffffff" nowrap="nowrap"><a href="javascript:void(0);">うずまきナルト&amp;紫苑</a></td>
<td class="s_font" align="center" bgcolor="#ffffff" nowrap="nowrap">第三幕ブースター</td>
</tr></table>`;
  assert.deepEqual(parseLista(html), [
    { num: "術伝-025", name: "螺旋丸", onde: "第一幕スターター" },
    { num: "忍伝-075", name: "うずまきナルト＆紫苑", onde: "第三幕ブースター" }
  ]);
});

test("parseTcgDb: scan e raridade por número, sem o verso", () => {
  const html = `<table border='1'><tr><td><img src='/img/card/nrts/N-037.jpg' /><img src='/img/card/nrts/back.jpg' /></td><td><span>忍伝-037　<a href='?name=x'>うずまきナルト</a></span><br /><a href='?ctype=忍'>忍</a>　<a href='?exp=※確認中'>※確認中</a>　R<br />色：</td></tr>`
    + `<tr><td><img src='/img/card/nrts/J-023.jpg' /><img src='/img/card/nrts/back.jpg' /></td><td><span>術伝-023　<a href='?name=y'>影真似の術</a></span><br /><a href='?ctype=術'>術</a>　<a href='?exp=※確認中'>※確認中</a>　<br />色：</td></tr></table>`;
  assert.deepEqual(parseTcgDb(html), [
    { num: "忍伝-037", code: "N-037", rarity: "R" },
    { num: "術伝-023", code: "J-023", rarity: "" }
  ]);
});

test("carta repetida mora no produto de estreia; starter é deck; data só com mês fica só com mês", () => {
  const snap = {
    sets: [
      // Fora de ordem de propósito: quem decide é a ordem do PRODUTOS.
      { key: "st1", cards: [{ num: "忍伝-005", name: "自来也" }, { num: "術伝-025", name: "螺旋丸" }] },
      { key: "s01", cards: [{ num: "忍伝-005", name: "自来也" }, { num: "忍伝-001", name: "うずまきナルト" }] },
      { key: "gaku", cards: [{ num: "NM-053", name: "うずまきナルト" }, { num: "忍伝-学001", name: "うずまきナルト" }] },
      { key: "s06", cards: [{ num: "忍伝-169", name: "うずまきナルト" }] }
    ],
    tcgdb: [{ num: "忍伝-001", code: "N-001", rarity: "R" }]
  };
  const { line, reimpressas, deFora } = montaLinha(snap);
  const de = (num) => line.find((c) => c.number === num);
  assert.equal(de("忍伝-005").setId, "nrt-scg-s01");
  assert.equal(de("術伝-025").setId, "nrt-scg-st1");
  assert.equal(de("術伝-025").setKind, "deck");
  assert.equal(de("忍伝-001").setKind, undefined);
  assert.equal(reimpressas, 1);
  assert.equal(deFora, 1);
  assert.ok(!line.some((c) => c.number === "NM-053"));
  assert.equal(de("忍伝-169").setReleaseDate, "2008-04");
  assert.equal(de("忍伝-001").rarity, "R");
  assert.match(de("忍伝-001").image, /tcg-db\.nikita\.jp%2Fimg%2Fcard%2Fnrts%2FN-001\.jpg/);
  assert.equal(de("忍伝-005").image, "");
  assert.equal(de("忍伝-001").setTotal, 2);
  for (const c of line) {
    assert.equal(c.vintageLine, "nrt-scg");
    assert.equal(c.language, "ja");
    assert.ok(c.id.startsWith("nrt-scg-"));
  }
});

test("snapshot: as 573 cartas, numeração sem buraco e os totais oficiais por booster", () => {
  const { line } = montaLinha(snapshot);
  assert.equal(line.length, 573);
  assert.equal(new Set(line.map((c) => c.id)).size, line.length, "id repetido");
  for (const [tipo, ate] of [["忍伝", 247], ["術伝", 198], ["作伝", 65]]) {
    const nums = line.filter((c) => new RegExp(`^${tipo}-[0-9]+$`).test(c.number)).map((c) => Number(c.number.split("-")[1])).sort((a, b) => a - b);
    assert.deepEqual(nums, Array.from({ length: ate }, (_, i) => i + 1), `${tipo}: buraco ou repetição`);
  }
  // "全69種+1種" etc. das páginas de produto do site oficial.
  const total = (key) => line.filter((c) => c.setId === `nrt-scg-${key}`).length;
  assert.equal(total("s01"), 70);
  for (const key of ["s02", "s03", "s04", "s05", "s06", "s07"]) assert.equal(total(key), 58, key);
  assert.equal(total("s08"), 48);
  assert.equal(total("promo"), 23);
  // A carta que motivou a linha: o Rasengan do Starter BOX do 第一幕.
  const rasengan = line.find((c) => c.number === "術伝-025");
  assert.equal(rasengan.setId, "nrt-scg-st1");
  assert.equal(rasengan.name, "螺旋丸");
});

test("todo produto tem nome em inglês de exibição e nenhum nome de set se repete no Naruto", () => {
  const nomesEn = readFileSync(new URL("../src/nomes-sets.js", import.meta.url), "utf8");
  for (const p of PRODUTOS) assert.ok(nomesEn.includes(`"nrt-scg-${p.key}":`), `nrt-scg-${p.key} sem nome em inglês no src/nomes-sets.js`);
  // O nome é a chave do set no catálogo (índice de sets, endereço): dois
  // setIds com o mesmo nome se misturariam.
  const setIdDoNome = new Map();
  for (const c of catalogoNaruto()) {
    const ja = setIdDoNome.get(c.set);
    assert.ok(!ja || ja === c.setId, `"${c.set}" é o nome de ${ja} e de ${c.setId}`);
    setIdDoNome.set(c.set, c.setId);
  }
  assert.ok([...setIdDoNome.values()].includes("nrt-scg-s01"), "a linha nrt-scg não está no catálogo do Naruto");
});
