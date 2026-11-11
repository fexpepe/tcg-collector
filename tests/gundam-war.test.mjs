// Gundam War (jogo vintage gw, Bandai 1999–2011): o parse das duas listas do
// site oficial, o id (cor + número, gravado no snapshot) e o catálogo gerado.
// Sem rede: as páginas são trechos copiados da fonte em 2026-11-11.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseListaAntiga, parseListaAtual, assignIds, cartasDoJogo, raridade, meiaLargura, SETS, CATEGORIAS, ID_PREFIX } from "../scripts/sync-gundam-war.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

// Lista antiga: a âncora da seção dá o tipo; o fundo da linha, a cor. A
// segunda linha de cada carta é o texto (ignorado).
const linha = (cor, num, nome, set, rar) => `
				<tr>
				    <td width="10%" align="center" bgcolor="${cor}" class=s_font>${num}</td>
				    <td width="45%" bgcolor="${cor}" class=m_font_b>${nome}</td>
				    <td width="40%" bgcolor="${cor}" class=s_font>${set}</td>
				    <td width="5%" align=center bgcolor="${cor}" class=s_font>${rar}</td>
				  </tr>
				  <tr>
				    <td></td>
				    <td colspan="3" bgcolor="#FFFFFF" class=s_font>高機動</td>
				  </tr>`;
const ANTIGA = `
<br><a name="U"></a><B class=m_font_b>ユニットカード</B>
${linha("#9999FF", "U-1", "ガンダム", "第1弾", "U")}
${linha("#9999FF", "U-ＯＯ１", "ジム", "第20弾「流転する世界」", "")}
<br><a name="CH"></a><B class=m_font_b>キャラクターカード</B>
${linha("#52BA52", "CH-3", "シャア・アズナブル", "第1弾", "Ｒ")}
<br><a name="G"></a><B class=m_font_b>ジェネレーションカード</B>
${linha("#999999", "G-1", "地球連邦国民", "プロモーションカード", "")}`;

test("lista antiga: tipo pela âncora, cor pelo fundo, largura cheia normalizada", () => {
  const cartas = parseListaAntiga(ANTIGA, "efsf");
  assert.deepEqual(cartas.map((c) => [c.num, c.name, c.set, c.tipo, c.cor, c.rar]), [
    ["U-1", "ガンダム", "第1弾", "Unit", "青", "U"],
    ["U-OO1", "ジム", "第20弾「流転する世界」", "Unit", "青", ""],
    ["CH-3", "シャア・アズナブル", "第1弾", "Character", "緑", "R"],
    // O cinza #999999 não é cor do jogo: fica sem cor (id com "x").
    ["G-1", "地球連邦国民", "プロモーションカード", "G", "", ""]
  ]);
});

test("lista antiga: a página デュアル tem numeração própria (cor 'dual'), e a cor do fundo vai pro filtro", () => {
  const [c] = parseListaAntiga(linha("#9999FF", "C-1", "私の戦争", "第17弾「不敗の流派」", "R"), "dual");
  assert.equal(c.cor, "dual");
  assert.equal(c.corDual, "青");
});

// Lista atual: uma tabela por carta, cabeçalho e valor em pares de linhas.
const ATUAL = `
<table border="0" cellspacing="0" cellpadding="0" class="cardlist-table">
  <tr><th class="unit-num">カード番号</th><th colspan="3" class="unit-name">カード名</th><th class="unit-name">型番</th><th>指定国力</th><th>合計国力</th><th>資源コスト</th></tr>
  <tr><td>U-447</td><td colspan="3" class="card-txt-left">ガンダム試作３号機</td><td>RX-78GP03</td><td>青2</td><td>8</td><td>4</td></tr>
  <tr><td rowspan="6" class="card-blue"><img src="../images/cardlist/1128/U-447_blue.png" width="129" height="180" /></td>
    <th>種類</th><th>格闘力</th><th>射撃力</th><th>防御力</th><th>地形適正</th><th>色</th><th>レアリティ</th></tr>
  <tr><td>UNIT</td><td>5</td><td>4</td><td>7</td><td>宇宙</td><td>青</td><td>AR</td></tr>
  <tr><th colspan="7">テキスト</th></tr>
  <tr><td colspan="7" class="card-txt-left"><p>戦闘配備</p></td></tr>
  <tr><th>収録</th><th colspan="5">フレーバー</th><th colspan="2">イラストレーター</th></tr>
  <tr><td>第28弾</td><td colspan="5" class="card-txt-left">連邦軍のMA。</td><td colspan="2">F.M.U</td></tr>
</table>
<table border="0" cellspacing="0" cellpadding="0" class="cardlist-table">
  <tr><th class="unit-num">カード番号</th><th colspan="3" class="unit-name">カード名</th></tr>
  <tr><td>G-35</td><td colspan="3" class="card-txt-left">茶基本G</td></tr>
  <tr><td rowspan="6" class="card-brown"><img src="../images/cardlist/1127/G-35_brown.png" width="129" height="180" /></td>
    <th>種類</th><th>色</th><th>レアリティ</th></tr>
  <tr><td>G</td><td>茶</td><td>-</td></tr>
  <tr><th>テキスト</th><th>イラストレーター</th></tr>
  <tr><td>-</td><td>-</td></tr>
</table>`;

test("lista atual: campos pelo cabeçalho, ilustrador quando há, '-' vira vazio", () => {
  assert.deepEqual(parseListaAtual(ATUAL), [
    { cor: "青", num: "U-447", name: "ガンダム試作３号機", tipo: "Unit", rar: "AR", artist: "F.M.U" },
    { cor: "茶", num: "G-35", name: "茶基本G", tipo: "G", rar: "" }
  ]);
});

test("raridade e número: largura cheia vira ASCII, '-' vira vazio", () => {
  assert.equal(raridade("Ｕ"), "U");
  assert.equal(raridade("c"), "C");
  assert.equal(raridade("-"), "");
  assert.equal(meiaLargura("CH-ＯＯ１"), "CH-OO1");
});

test("id: set + cor + número; a mesma carta mantém o id quando a fonte reordena", () => {
  const fonte = [
    { cor: "青", num: "U-1", name: "ガンダム", tipo: "Unit", rar: "U" },
    { cor: "緑", num: "U-1", name: "ザクII", tipo: "Unit", rar: "" },
    { cor: "dual", corDual: "青", num: "C-1", name: "私の戦争", tipo: "Command", rar: "R" },
    { cor: "", num: "SP-23", name: "ガンダムTR-1", tipo: "Unit", rar: "" }
  ];
  const primeira = assignIds("s01", fonte, []);
  assert.deepEqual(primeira.map((c) => c.id), ["gw-s01-b-u-1", "gw-s01-g-u-1", "gw-s01-d-c-1", "gw-s01-x-sp-23"]);
  // Reordenada e sem a última: os ids ficam, e a que saiu da fonte continua.
  const depois = assignIds("s01", [fonte[2], fonte[1], fonte[0]], primeira);
  assert.deepEqual(depois.map((c) => c.id), ["gw-s01-d-c-1", "gw-s01-g-u-1", "gw-s01-b-u-1", "gw-s01-x-sp-23"]);
});

test("sets: códigos únicos, nome sem o jogo na frente e com nome único, categorias da lista atual registradas", () => {
  const codes = SETS.map((s) => s.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(new Set(SETS.map((s) => s.name)).size, SETS.length);
  for (const s of SETS) {
    assert.doesNotMatch(s.name, /ガンダムウォー|Gundam War|GUNDAM ?WAR/i, s.name);
    assert.ok(s.date === "" || /^\d{4}-\d{2}$/.test(s.date), `${s.code}: data ${s.date}`);
  }
  for (const code of Object.values(CATEGORIAS)) assert.ok(codes.includes(code), code);
});

test("catálogo: data/gw/ bate com o snapshot, todo id com o prefixo, vintage e sem imagem inventada", () => {
  const snap = JSON.parse(readFileSync(join(RAIZ, "data/vintage/gundam-war.json"), "utf8"));
  const w = {};
  new Function("window", readFileSync(join(RAIZ, "data/gw/cards.js"), "utf8"))(w);
  const cartas = w.TCG_CARDS;
  assert.equal(cartas.length, snap.sets.reduce((n, s) => n + s.cards.length, 0));
  assert.equal(new Set(cartas.map((c) => c.id)).size, cartas.length);
  assert.ok(cartas.every((c) => c.id.startsWith(ID_PREFIX) && c.vintage === true && c.language === "ja"));
  assert.ok(cartas.every((c) => c.image === "" || c.image.startsWith("/assets/cards/gw/")));
  // O mesmo build a partir do snapshot devolve as mesmas cartas (sem rede).
  assert.deepEqual(cartasDoJogo(snap).map((c) => c.id), cartas.map((c) => c.id));
});
