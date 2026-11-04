// Listas oficiais do Data Carddass NARUTO (scripts/lib/naruto-dc-oficial.mjs e
// data/vintage/naruto-dc-oficial.json). Até 04/11/2026 a Formation e a Cross
// vinham só do Suruga-ya, que lista o acervo da loja: 91 das 344 cartas da
// Formation, 243 das 344 da Cross. As listas oficiais no Wayback completam;
// estes testes travam o leitor das páginas e o que o snapshot promete.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  numeroDaCelula, nomeDaCarta, parseFormation, parseCross, parsePromosCardBattle, parseClearMission, serieDaPromoCross, SERIE, CROSS_DO_PDF_5
} from "../scripts/lib/naruto-dc-oficial.mjs";
import { CAPITULOS, capituloDaCarta, totalDoSet, chaveDoPublicado, chaveDoSet } from "../scripts/lib/naruto-dc-capitulos.mjs";
import { readGlobalVar } from "../scripts/lib/sync-common.mjs";

const snap = JSON.parse(readFileSync(new URL("../data/vintage/naruto-dc-oficial.json", import.meta.url), "utf8"));
const numeros = (lista, re) => lista.filter((c) => re.test(c.num)).map((c) => Number(c.num.replace(/^\D+-/, "")));
const faltando = (nums, de, ate) => { const s = new Set(nums); const f = []; for (let i = de; i <= ate; i++) if (!s.has(i)) f.push(i); return f; };

test("número da célula: código com alias, relistagem fora, romano e largura cheia", () => {
  assert.deepEqual(numeroDaCelula("NFP-002(DMP-019)"), { num: "NFP-002", alias: "DMP-019" });
  assert.equal(numeroDaCelula("NF-005再録"), null);
  assert.equal(numeroDaCelula("NF-011【再録】"), null);
  assert.equal(numeroDaCelula("カードNo."), null);
  assert.equal(numeroDaCelula("NXP-SP Ⅱ").num, "NXP-SPII");
  assert.equal(numeroDaCelula("ＮＦ－００１").num, "NF-001");
  for (const c of ["NFM-SP", "NFP-USJ1", "NXP-PH001", "NX-MAC001", "VJCF-2009", "NXpf-001", "DNP-030S", "NA-004", "NC-032"]) {
    assert.equal(numeroDaCelula(c).num, c);
  }
});

test("nome: parêntese e dígito da Cross em meia largura, o resto como a fonte escreveu", () => {
  assert.equal(nomeDaCarta("重吾（状態１）"), "重吾(状態1)");
  assert.equal(nomeDaCarta("うずまきナルト<br>(疾風伝)"), "うずまきナルト(疾風伝)");
  assert.equal(nomeDaCarta("撃破&quot;暁&quot;"), "撃破\"暁\"");
  assert.equal(nomeDaCarta("出撃！"), "出撃！");
});

test("Formation: nome com e sem link, nome da missão, verso (wbarcode) não vira carta", () => {
  const html = `
    <tr class="ougi"><td rowspan="6" class="cardNum s_font_b">NF-002</td>
      <td class="m_font_b"><a href="javascript:;" onclick="x">うずまきナルト<br>(疾風伝)</a></td>
      <td class="s_font">2</td><td colspan="2" class="s_font">狙え優勝???集め勝負!</td><td class="s_font">第1章</td></tr>
    <tr class="wbarcode"><td class="m_font_b"><a href="javascript:;">九尾ナルト(四本目)</a></td></tr>
    <tr class="ougi"><td rowspan="6" class="cardNum s_font_b">NF-139</td>
      <td rowspan="4" class="m_font_b">デイダラ							</td>
      <td class="s_font">2</td><td colspan="2" class="s_font">対抗レースの試練デイダラ編</td></tr>`;
  assert.deepEqual(parseFormation(html).map((c) => [c.num, c.name, c.missao]), [
    ["NF-002", "うずまきナルト(疾風伝)", "狙え優勝???集め勝負!"],
    ["NF-139", "デイダラ", "対抗レースの試練デイダラ編"]
  ]);
});

test("Cross: os dois formatos do buscador (2009 e 2017)", () => {
  const html = `
    <td rowspan="3" class="card_num card_name_num_ma">NX-242</td>
    <td nowrap="nowrap" class="card_name_num_ma">
<a href="javascript:void(0)">うずまきナルト</a></td>
    <td rowspan="3" class="card_name_num_ma">NX-032</td>
    <td nowrap="nowrap" class="card_name_num_ma"><a href="javascript:void(0)">シズネ</a></td>`;
  assert.deepEqual(parseCross(html).map((c) => [c.num, c.name]), [["NX-242", "うずまきナルト"], ["NX-032", "シズネ"]]);
  assert.equal(serieDaPromoCross("NX-MAC002"), SERIE.nxmac);
  assert.equal(serieDaPromoCross("VJCF-2009"), SERIE.vjcf2009);
  assert.equal(serieDaPromoCross("NXP-PH001"), SERIE.nxp);
});

test("Card Battle e Mission: só a seção das promos, e só NC na lista do clear card", () => {
  const cb = `<td class="s_font_wb">DN-050T</td><td><a>自来也</a></td>
    <a name="p" id="p"></a>
    <tr><td rowspan="2" class="s_font_wb">DNP-030S</td><td class="m_font"><STRONG><a href="x">うずまきナルト</a></STRONG></td>
    <td>忍術 影分身の術</td><td>2500</td><td>イルカ</td><td>雷</td><td align="center">ジャンプフェスタ2007大会4連勝ほか
</td></tr>`;
  assert.deepEqual(parsePromosCardBattle(cb), [{ num: "DNP-030S", name: "うずまきナルト", origem: "ジャンプフェスタ2007大会4連勝ほか" }]);
  const nc = `<td rowspan="5" class="s_font_wb" nowrap>NC-001</td><td><strong><a href="x">うずまきナルト</a></strong></td>
    <td>3</td><td colspan="2"><span>捜索!蟲の呼び声を聞け!</span></td>
    <td rowspan="5" class="s_font_wb" nowrap>NM-005</td><td><a href="x">うずまきナルト</a></td>`;
  assert.deepEqual(parseClearMission(nc), [{ num: "NC-001", name: "うずまきナルト", missao: "捜索!蟲の呼び声を聞け!" }]);
});

test("snapshot: a Formation tem as 344 NF e as séries à parte", () => {
  const f = snap.formation;
  assert.deepEqual(faltando(numeros(f, /^NF-\d+$/), 1, 344), []);
  assert.equal(new Set(f.map((c) => c.num)).size, f.length, "número repetido");
  assert.deepEqual(numeros(f, /^NFC-/), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.deepEqual(numeros(f, /^NFF-/), Array.from({ length: 22 }, (_, i) => i + 1));
  assert.deepEqual(numeros(f, /^NFPF-/), [1, 2, 3]);
  assert.equal(f.filter((c) => /^NFP-\d+$/.test(c.num)).length, 20);
  assert.deepEqual(f.filter((c) => /^NFM-/.test(c.num)).map((c) => c.num), ["NFM-001", "NFM-002", "NFM-003", "NFM-004", "NFM-005", "NFM-SP"]);
  // A シークレットミッションカード leva o nome da missão, não o genérico.
  assert.equal(f.find((c) => c.num === "NFM-004").name, "我愛羅奪還!");
  for (const c of f.filter((c) => /^NF-\d+$/.test(c.num))) {
    assert.ok(capituloDaCarta("nf", c.num, "") > 0, `${c.num} fora de toda faixa`);
    assert.equal(c.serie, "", `${c.num}: carta de capítulo não tem série`);
  }
});

test("snapshot: a Cross tem 342 de 344 — só a NX-172 e a NX-191 sem fonte", () => {
  const x = snap.cross;
  assert.equal(new Set(x.map((c) => c.num)).size, x.length, "número repetido");
  // NX-173–177 e 179 estão no Suruga-ya (o sync junta); 172 e 191 em lugar nenhum.
  assert.deepEqual(faltando(numeros(x, /^NX-\d+$/), 1, 344), [172, 173, 174, 175, 176, 177, 179, 191]);
  for (const [num, , rarity] of CROSS_DO_PDF_5.cartas) {
    assert.equal(x.find((c) => c.num === num).rarity, rarity, num);
  }
  assert.deepEqual(numeros(x, /^NXpf-/), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(x.filter((c) => c.serie === SERIE.nxmac).length, 4);
  assert.equal(x.filter((c) => c.serie === SERIE.nxp).length, 12);
});

test("snapshot: promos do Card Battle e 疾風クリアカード da Mission", () => {
  const p = snap.cardBattlePromos.map((c) => c.num);
  const dnp = Array.from({ length: 30 }, (_, i) => `DNP-${String(i + 1).padStart(3, "0")}`);
  assert.deepEqual(p, [...dnp, "DNP-030S", "DNP-030J", "NA-001", "NA-002", "NA-003", "NA-004"]);
  assert.ok(snap.cardBattlePromos.every((c) => c.name && c.origem), "promo sem nome ou sem origem");
  assert.deepEqual(snap.missionClear.map((c) => c.num), Array.from({ length: 32 }, (_, i) => `NC-${String(i + 1).padStart(3, "0")}`));
});

test("setTotal do capítulo: a faixa oficial inteira mais o que o set tem fora dela", () => {
  const cartas = (nums) => nums.map((num) => ({ num }));
  const quarto = Array.from({ length: 50 }, (_, i) => `NX-${142 + i}`).filter((n) => n !== "NX-172" && n !== "NX-191");
  assert.equal(totalDoSet("nx:cap4", cartas([...quarto, "NX-CAM004"])), 51);
  assert.equal(totalDoSet("nf:cap4", cartas(["NF-151"])), CAPITULOS.nf[3].faixa[1] - CAPITULOS.nf[3].faixa[0] + 1);
  assert.equal(totalDoSet("nf:プロモーションカード", cartas(["NFP-001", "NFP-002"])), 2);
});

test("o nrt-nf-s03 (\"ナルティメットフォーメーション\", sem série) é a folha de 4 do 出撃！", () => {
  assert.equal(chaveDoPublicado("nrt-nf-s03", "ナルティメットフォーメーション"), chaveDoSet("nf", 0, SERIE.nff));
});

test("catálogo: toda carta da lista oficial está publicada, no título certo", async () => {
  const cards = await readGlobalVar(new URL("../data/naruto/cards.js", import.meta.url), "TCG_CARDS");
  const porNumero = new Map(cards.filter((c) => /^nrt-(dc|nf|nx)-/.test(c.id)).map((c) => [c.number, c]));
  const confere = (lista, prefixo) => {
    for (const { num } of lista) {
      const c = porNumero.get(num);
      assert.ok(c, `${num} não está no catálogo`);
      assert.ok(c.id.startsWith(prefixo), `${num} é ${c.id}, devia ser ${prefixo}*`);
    }
  };
  confere(snap.formation, "nrt-nf-");
  confere(snap.cross, "nrt-nx-");
  confere(snap.cardBattlePromos, "nrt-dc-");
  confere(snap.missionClear, "nrt-dc-");
  // NFC-016 e NFF-008 saíram juntas do Suruga-ya num set sem série; cada uma
  // foi pro da sua série, e o set velho ficou com a folha.
  assert.equal(porNumero.get("NFF-008").setId, "nrt-nf-s03");
  assert.notEqual(porNumero.get("NFC-016").setId, "nrt-nf-s03");
  assert.equal(porNumero.get("NFC-016").setId, porNumero.get("NFC-001").setId);
});

test("Sets: a promo do Card Battle (s17) fica na seção do Card Battle, o s16 e o s18 na da Mission", async () => {
  const { PROMO_CARD_BATTLE, PROMO_MISSION, CLEAR_MISSION, PAGES } = await import("../scripts/lib/naruto-datacarddass.mjs");
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const m = /"sets\.category\.dcnrCardBattle", \(id\) => (\/.+?\/)\.test\(id\)/.exec(app);
  assert.ok(m, "regra da seção Card Battle não achada no app.js");
  const re = new Function(`return ${m[1]}`)();
  const id = (seq) => `nrt-dc-s${String(seq).padStart(2, "0")}`;
  const cardBattle = [...PAGES.filter((p) => /カードバトル/.test(p.name)).map((p) => p.seq), PROMO_CARD_BATTLE.seq];
  const mission = [...PAGES.filter((p) => /ミッション/.test(p.name)).map((p) => p.seq), PROMO_MISSION.seq, CLEAR_MISSION.seq];
  for (const seq of cardBattle) assert.ok(re.test(id(seq)), `${id(seq)} devia ser Card Battle`);
  for (const seq of mission) assert.ok(!re.test(id(seq)), `${id(seq)} devia ser Mission`);
});
