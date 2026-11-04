// Data Carddass NARUTO — Card Battle e Mission (scripts/lib/
// naruto-datacarddass.mjs). O caso é o de 02/11/2026: o noihjp dá o título
// "第１弾" à página do 第2弾 e vice-versa, e como a carta é do set em que
// estreou, o 第１弾 publicado tinha DN-051–065 e o 第２弾 só as sobras do
// DN-001–050. O 第1弾 é DN-001–050 inteiro (cardcheckbox e hinokunian).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PAGES, estreias, estreiasForaDaFaixa, dataDoSet, PROMO_MISSION, parsePromoMission } from "../scripts/lib/naruto-datacarddass.mjs";
import { CAPITULOS } from "../scripts/lib/naruto-dc-capitulos.mjs";
import { readGlobalVar } from "../scripts/lib/sync-common.mjs";

const snap = JSON.parse(readFileSync(new URL("../data/vintage/naruto-datacarddass.json", import.meta.url), "utf8"));
const faixa = (prefixo, de, ate) => Array.from({ length: ate - de + 1 }, (_, i) => `${prefixo}-${String(de + i).padStart(3, "0")}`);
const codigos = (cartas) => cartas.map((c) => c.code || c.number).sort();

test("faixas oficiais contíguas em cada título, na ordem das páginas", () => {
  assert.deepEqual(PAGES.map((p) => p.seq), Array.from({ length: PAGES.length }, (_, i) => i + 1));
  assert.equal(new Set(PAGES.map((p) => p.page)).size, PAGES.length, "página repetida");
  const fim = {}; // prefixo -> último número da faixa anterior
  for (const { name, estreia } of PAGES) {
    if (!estreia) continue;
    const [[p, de], [p2, ate]] = estreia.map((c) => [c.split("-")[0], Number(c.split("-")[1])]);
    assert.equal(p, p2, `${name}: faixa com dois prefixos`);
    assert.equal(de, (fim[p] || 0) + 1, `${name}: buraco ou sobreposição antes de ${estreia[0]}`);
    assert.ok(ate >= de);
    fim[p] = ate;
  }
  assert.deepEqual(fim, { DN: 249, NM: 237 });
});

test("o 第1弾 é DN-001–050 inteiro e o 第2弾 estreia DN-051–065", () => {
  const [primeiro, segundo] = estreias(snap.sets);
  assert.equal(primeiro.set.name, "ナルティメットカードバトル 第１弾");
  assert.deepEqual(codigos(primeiro.estreias), faixa("DN", 1, 50));
  assert.equal(segundo.set.name, "ナルティメットカードバトル 第２弾");
  assert.deepEqual(codigos(segundo.estreias), faixa("DN", 51, 65));
});

test("snapshot: nome e ordem das páginas, e nenhuma estreia fora da faixa", () => {
  const porSeq = new Map(PAGES.map((p) => [p.seq, p.name]));
  for (const s of snap.sets) assert.equal(s.name, porSeq.get(s.seq), `seq ${s.seq} com nome de outra página`);
  assert.deepEqual(estreiasForaDaFaixa(snap.sets), []);
});

test("a trava pega o título trocado da fonte", () => {
  // O snapshot como era até 02/11/2026: a 01.php do noihjp no seq 1.
  const [a, b, ...resto] = snap.sets;
  const trocado = [{ ...a, cards: b.cards }, { ...b, cards: a.cards }, ...resto];
  const fora = estreiasForaDaFaixa(trocado);
  assert.ok(fora.includes("ナルティメットカードバトル 第１弾: DN-051"));
  assert.ok(fora.includes("ナルティメットカードバトル 第２弾: DN-005"));
  assert.equal(fora.length, 15 + 24);
});

test("catálogo versionado: DN-001–050 no nrt-dc-s01 (第１弾) e DN-051–065 no s02", async () => {
  const cards = await readGlobalVar(new URL("../data/naruto/cards.js", import.meta.url), "TCG_CARDS");
  const doSet = (setId) => cards.filter((c) => c.setId === setId);
  const s01 = doSet("nrt-dc-s01");
  assert.deepEqual(codigos(s01), faixa("DN", 1, 50));
  // Sem "Data Carddass — " na frente desde o contrato 7 do docs/CATALOGO.md.
  for (const c of s01) {
    assert.equal(c.set, "ナルティメットカードバトル 第１弾");
    assert.equal(c.setTotal, 50);
  }
  const s02 = doSet("nrt-dc-s02");
  assert.deepEqual(codigos(s02), faixa("DN", 51, 65));
  for (const c of s02) {
    assert.equal(c.set, "ナルティメットカードバトル 第２弾");
    assert.equal(c.setTotal, 15);
  }
  // Id de carta não muda com a correção: nrt-dc-<código>.
  for (const c of [...s01, ...s02]) assert.equal(c.id, `nrt-dc-${c.number.toLowerCase()}`);
});

// Data curada por página (02/11/2026): até aqui o sync gravava "" e a tela
// dizia "Data de lançamento: N/A". Fonte: o 発売日 do cardcheckbox.
test("datas: dia válido em toda página e crescentes na ordem do seq", () => {
  let anterior = "";
  for (const { name, data } of PAGES) {
    assert.match(data, /^\d{4}-\d{2}-\d{2}$/, `${name}: data fora do AAAA-MM-DD`);
    assert.equal(new Date(`${data}T00:00:00Z`).toISOString().slice(0, 10), data, `${name}: dia que não existe`);
    assert.ok(data > anterior, `${name}: ${data} não vem depois de ${anterior}`);
    anterior = data;
  }
  // Os dois primeiros títulos do arcade vêm antes do terceiro (Formation).
  assert.ok(anterior < CAPITULOS.nf[0].data, "a Mission termina depois do 第1章 da Formation");
  // As âncoras da régua: 下旬 = 25, 中旬 = 15, 上旬 = 5, e o dia do 確認 vence o 旬.
  assert.equal(dataDoSet(1), "2005-10-25"); // 第1弾: 2005年10月下旬
  assert.equal(dataDoSet(2), "2005-12-15"); // 第2弾: 2005年12月中旬
  assert.equal(dataDoSet(8), "2006-08-05"); // 第6弾: 2006年8月上旬
  assert.equal(dataDoSet(11), "2007-02-23"); // 第1章: 2007年2月下旬(…2月23日 確認)
  assert.equal(dataDoSet(99), "");
});

test("catálogo versionado: toda carta do Card Battle e da Mission com a data do set", async () => {
  const cards = await readGlobalVar(new URL("../data/naruto/cards.js", import.meta.url), "TCG_CARDS");
  const dc = cards.filter((c) => /^nrt-dc-s\d+$/.test(c.setId));
  assert.ok(dc.length > 400, "o Data Carddass sumiu do catálogo");
  for (const c of dc) assert.equal(c.setReleaseDate, dataDoSet(Number(c.setId.slice(8))), `${c.id} (${c.setId})`);
});

// ── Promos da Mission (04/11/2026) ──────────────────────────────────────────
// A DMP-000 é o PSA do Fernando ("2006 DCD NARUTO SHIPPUDEN #000 ... PR-TNMT
// PARTICIPATION"), que não tinha onde ser cadastrado. Fonte: a promocard.shtml
// oficial, no Wayback (PROMO_MISSION na lib).
test("promos da Mission: o parser lê código, nome, missão e origem da lista oficial", () => {
  // Recorte da estrutura real (a carta tem frente e verso — o "（疾風伝）" —
  // e só a frente vira carta; a variante J vem sem o 入手方法).
  const linha = (code, nome, lv, missao, origem) => `
    <tr>
      <td rowspan="5" bgcolor="#006DB8" class="s_font_wb" align="center" nowrap>${code}</td>
      <td rowspan="3" bgcolor="#EEFFFF"><strong><a href="javascript:;" onclick="MM_openBrWindow('http://www.carddas.com/naruto/mission/cardlist/carddata/${code}_p.html','skill')">${nome}</a></strong></td>
      <td bgcolor="#EEFFFF" align="center" nowrap>${lv}</td>
      <td colspan="2" bgcolor="#EEFFFF" nowrap>${missao}</td>
      <td bgcolor="#EEFFFF" align="left" class="s_font">${origem}</td>
    </tr>
    <tr><td bgcolor="#EEFFFF" align="center" nowrap>影分身の術</td><td bgcolor="#EEFFFF" align="center" nowrap class="s_font">メイン＆サポート</td></tr>
    <tr><td rowspan="2" bgcolor="#FFFFEE" nowrap><strong><a href="javascript:;">うずまきナルト<br>（疾風伝）</a></strong></td></tr>`;
  const html = linha("DMP-000", "うずまきナルト", "Lv2", "探索！　ウワサの人物！", "ジャンプフェスタ2007、公認大会参加賞2007など")
    + linha("DMP-000J", "うずまきナルト", "Lv2", "探索！　ウワサの人物！", "")
    + linha("DMP-012", "？？？？？", "Lv3", "突破！　残された脱出ルート", "週刊少年ジャンプ2007年2月19日号付録（終了しました）");
  assert.deepEqual(parsePromoMission(html), [
    { code: "DMP-000", name: "うずまきナルト", missao: "Lv2 探索！ ウワサの人物！", origem: "ジャンプフェスタ2007、公認大会参加賞2007など" },
    { code: "DMP-000J", name: "うずまきナルト", missao: "Lv2 探索！ ウワサの人物！", origem: "" },
    { code: "DMP-012", name: "？？？？？", missao: "Lv3 突破！ 残された脱出ルート", origem: "週刊少年ジャンプ2007年2月19日号付録（終了しました）" }
  ]);
  assert.deepEqual(parsePromoMission(""), []);
});

test("promos da Mission: o snapshot tem a lista oficial inteira, sem buraco", () => {
  const promos = JSON.parse(readFileSync(new URL("../data/vintage/naruto-dc-promos.json", import.meta.url), "utf8"));
  assert.equal(promos.captura, PROMO_MISSION.captura);
  const esperado = ["CAN-001", "DMP-000", "DMP-000J", "DMP-000S", ...faixa("DMP", 1, 18)];
  assert.deepEqual(promos.cards.map((c) => c.code), esperado);
  for (const c of promos.cards) assert.ok(c.name, `${c.code} sem nome`);
  const dmp000 = promos.cards.find((c) => c.code === "DMP-000");
  assert.equal(dmp000.name, "うずまきナルト");
  assert.match(dmp000.origem, /公認大会参加賞/);
});

test("promos da Mission no catálogo: set nrt-dc-s16, id pelo código, CAN-001 com o id novo", async () => {
  const cards = await readGlobalVar(new URL("../data/naruto/cards.js", import.meta.url), "TCG_CARDS");
  const promo = cards.filter((c) => c.setId === "nrt-dc-s16");
  assert.equal(promo.length, 22);
  for (const c of promo) {
    assert.equal(c.id, `nrt-dc-${c.number.toLowerCase()}`);
    assert.equal(c.set, PROMO_MISSION.name);
    assert.equal(c.setTotal, 22);
    assert.equal(c.setReleaseDate, "2006-12");
    assert.equal(c.rarity, "P");
    assert.equal(c.vintageLine, "dc");
  }
  // J e S são cartas próprias, com o código impresso delas.
  for (const id of ["nrt-dc-dmp-000", "nrt-dc-dmp-000j", "nrt-dc-dmp-000s"]) assert.ok(promo.some((c) => c.id === id), id);
  // O nome do set é a chave dele no Naruto: não pode repetir o de outro setId.
  assert.ok(!cards.some((c) => c.set === PROMO_MISSION.name && c.setId !== "nrt-dc-s16"));
  // A CAN-001 que o Suruga-ya punha na Formation: id novo, imagem curada junto,
  // e o velho fora do catálogo, com de-para pra conta de quem marcou.
  const can = promo.find((c) => c.number === "CAN-001");
  assert.equal(can.id, "nrt-dc-can-001");
  assert.equal(can.image, "/assets/cards/naruto/nrt-dc-can-001.webp");
  assert.ok(!cards.some((c) => c.id === "nrt-nf-can-001" || c.setId === "nrt-nf-s02"));
  const merges = JSON.parse(readFileSync(new URL("../data/card-id-merges.json", import.meta.url), "utf8"));
  assert.equal(merges.cards["nrt-nf-can-001"], "nrt-dc-can-001");
  assert.ok(merges.sets.some((s) => s.from === "nrt-nf-s02" && s.to === "nrt-dc-s16"));
});
