// ガンダムウォー (Gundam War, Bandai 1999–2011): o jogo vintage `gw`, em
// data/gw/. É o TCG de verdade da Bandai pro Gundam (cores, regras, decks),
// vendido sob a marca "Carddass Masters" (o pacote de loja, não a máquina) —
// tanto que o site oficial mora em carddass.com/cdmasters/gundamwar/. Por ser
// um JOGO, e não cartas de coleção de uma IP, é slug próprio e não seção do
// `cdm` (regra 4.1 do docs/CATALOGO.md; decisão de 2026-11-11). Também não é
// linha do `gundam` (o Gundam Card Game de 2025) nem do `gcd` (o Carddass de
// máquina de 1988): os dois são jogos específicos, como o `dbc` e o `dbfw`.
// Só a versão JAPONESA: a inglesa de 2005 (três sets) e o Gundam M.S. War
// americano de 2001 (outro jogo) ficam de fora, e o NEX-A (2012) também.
//
// Fontes (levantamento de 2026-11-11), as duas do site OFICIAL da Bandai, que
// segue no ar e responde a acesso automatizado:
//   lista antiga  — /outdated/products/card.php?team=<facção>: uma página por
//                   facção (地球連邦, ジオン…, mais デュアル, プロモ, 拡張シート
//                   e a オールウェイズビギニングセット), com número, nome,
//                   produto (収録), raridade e texto. Cobre do 第1弾 ao
//                   第23弾 e os produtos à parte até a EXTENSION BOOSTER3
//                   (2009). A COR da carta é o fundo da linha (bgcolor), a
//                   mesma régua de cores do jogo; o TIPO sai da âncora da seção
//                   (<a name="U|CH|C|O|G">).
//   lista atual   — /cardlist/?search=true&category=<n>: o 第26弾, 第27弾 e
//                   第28弾 e as três reedições de 2010–2011 (戦場の女神ADVENT,
//                   ウィナーズブースター01 e a ウィナーズスターター), com cor,
//                   tipo, raridade e ilustrador por carta. 20 cartas por página.
//   datas         — Wikipédia japonesa (ガンダムウォー, seção 商品), o mês de
//                   cada produto. Sem mês conhecido (promos, a
//                   オールウェイズビギニングセット, o 景品), fica sem data.
//
// Ficam DE FORA, sem lista carta a carta no site: o 第24弾 e o 第25弾 (2010), a
// セレクテッドブースター「赤い彗星 シャア編」(2003), o 入門用スターター (2001),
// o 乱世に生きる漢たち (2010), a コラボレーションブースター2 (ガンプラ30th,
// 2010), a DXウイナーズスターター「蒼空の覇者」(2010) e o 拡張シート do 覇王の
// 紋章 (2006). Set sem lista não gera carta (a regra do dbc).
//
// Reimpressão: a carta reimpressa mantém o número (a ウィナーズブースター01
// repete "青 U-325 Gブル" do lançamento). A lista antiga mostra cada número UMA
// vez, no produto em que ele estreou: as reimpressões dos produtos de 1999–2009
// (ベースドブースター, EXTENSION BOOSTER…) não aparecem lá, e esses sets mostram
// só as cartas novas. A lista atual mostra a reedição inteira.
//
// Imagem: nenhuma. A lista atual tem miniatura de 129×180 e a antiga só nas
// promos (100×140), abaixo da largura útil de 440 px do contrato de imagem
// (README, "Imagem de carta: contrato pra jogo novo"). Scan curado entra por
// assets/cards/gw/<id>.webp, sem mexer no sync.
//
// IDs: gw-<set>-<cor>-<número impresso> (gw-s01-b-u-1 = 第1弾, 青 U-1). O
// número se repete entre cores no mesmo set (cada cor tem seu U-1), então a cor
// entra no id. Cartas DUAIS (página デュアル) têm numeração própria e levam `d`.
// O id fica GRAVADO no snapshot com a chave da fonte (set + cor + número), e o
// refresh reaproveita o da carta já conhecida.
//
//   node scripts/sync-gundam-war.mjs             # fetch (se der) + build
//   node scripts/sync-gundam-war.mjs --no-fetch  # só build do snapshot
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog, decodeEntities, sleep } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const GAME = "gw";
const OUT = new URL(`data/${GAME}/`, ROOT);
const SNAP = new URL("data/vintage/gundam-war.json", ROOT);
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
const NO_FETCH = process.argv.includes("--no-fetch");
const BASE = "https://www.carddass.com/cdmasters/gundamwar";
export const ID_PREFIX = "gw-";

// Páginas da lista antiga (uma por facção; a ordem não importa).
export const FACCOES = ["efsf", "zeon", "titans", "zanscale", "br00", "neozeon", "crossbone", "gw_turna", "x", "g", "w", "seed", "oo", "gr001", "sonota", "dual", "ex", "sp", "ev"];

// Produtos da lista atual: category -> code do set.
export const CATEGORIAS = { 1126: "s26", 1127: "s27", 1128: "s28", 1201: "gma", 1202: "wb1", 1203: "ws2" };

// Cor do jogo. A lista antiga pinta a linha da carta com a cor dela (dois
// tons por cor: a página de promos foi feita em outra época). O #999999 é o
// cinza de algumas duais e promos sem cor declarada: fica sem cor.
const COR_DO_FUNDO = {
  "#9999FF": "青", "#9C9AFF": "青", "#55BB55": "緑", "#52BA52": "緑", "#888888": "黒", "#8C8A8C": "黒",
  "#FF6666": "赤", "#FF6563": "赤", "#CCCC00": "茶", "#CECF00": "茶", "#CCCCCC": "白", "#CECFCE": "白", "#BB55DD": "紫"
};
// Cor -> rótulo da faceta (em inglês, como o color dos outros jogos) e letra do id.
export const CORES = {
  "青": { en: "Blue", id: "b" }, "緑": { en: "Green", id: "g" }, "黒": { en: "Black", id: "k" }, "赤": { en: "Red", id: "r" },
  "茶": { en: "Brown", id: "n" }, "白": { en: "White", id: "w" }, "紫": { en: "Purple", id: "p" }
};
// Tipo: âncora da seção na lista antiga e o 種類 da atual -> o nome impresso.
export const TIPOS = { U: "Unit", CH: "Character", C: "Command", O: "Operation", G: "G", A: "ACE",
  UNIT: "Unit", CHARACTER: "Character", COMMAND: "Command", OPERATION: "Operation", ACE: "ACE" };

// Sets, na ordem de lançamento. `src`: como o produto aparece no 収録 da lista
// antiga (o código vem da categoria na atual). `name`: o nome do set no
// catálogo — o do produto, sem o jogo na frente (contrato 7), com a grafia
// da fonte padronizada (「」 em volta do subtítulo, katakana no lugar do
// "DX Tactical Starter" que a fonte mistura). `date`: mês da Wikipédia
// japonesa. `deck`: starter (seção de decks na página de Sets).
const M = (n, date, sub = "") => ({ code: `s${String(n).padStart(2, "0")}`, src: `第${n}弾${sub ? `「${sub}」` : ""}`, name: `第${n}弾${sub ? `「${sub}」` : ""}`, date });
export const SETS = [
  M(1, "1999-02"), M(2, "1999-06", "撃墜王出撃"),
  { code: "ds1a", src: "ドラマチックスターター「決戦!星1号作戦」", name: "ドラマチックスターター「決戦!星1号作戦」", date: "1999-09", deck: true },
  { code: "ds1b", src: "ドラマチックスターター「宇宙要塞ア・バオア・クー」", name: "ドラマチックスターター「宇宙要塞ア・バオア・クー」", date: "1999-09", deck: true },
  M(3, "1999-10", "宇宙の記憶"), M(4, "2000-02", "新しき翼"),
  { code: "ds2a", src: "ドラマチックスターター「正義の創痕」", name: "ドラマチックスターター「正義の創痕」", date: "2000-06", deck: true },
  { code: "ds2b", src: "ドラマチックスターター「黒い覇道」", name: "ドラマチックスターター「黒い覇道」", date: "2000-06", deck: true },
  { code: "ds2c", src: "ドラマチックスターター「赤き脅威」", name: "ドラマチックスターター「赤き脅威」", date: "2000-06", deck: true },
  M(5, "2000-08", "永久の絆"),
  { code: "db1", src: "ドラマチックブースター「一年戦争編」", name: "ドラマチックブースター「一年戦争編」", date: "2000-12" },
  M(6, "2001-02", "新世紀の鼓動"),
  { code: "db2", src: "ドラマチックブースター「ウイング/ターンA編」", name: "ドラマチックブースター「ウイング/ターンA編」", date: "2001-06" },
  M(7, "2001-08", "革新の波濤"),
  { code: "bb1", src: "ベースドブースター", name: "ベースドブースター", date: "2001-11" },
  M(8, "2002-02", "月下の戦塵"),
  { code: "ds3a", src: "ドラマチックスターター「ギレンの野望編」A", name: "ドラマチックスターター「ギレンの野望編」A", date: "2002-06", deck: true },
  { code: "ds3b", src: "ドラマチックスターター「ギレンの野望編」B", name: "ドラマチックスターター「ギレンの野望編」B", date: "2002-06", deck: true },
  M(9, "2002-08", "相剋の軌跡"),
  { code: "bb2", src: "ベースドブースター2", name: "ベースドブースター2", date: "2002-11" },
  M(10, "2003-02", "刻の末裔"),
  { code: "ds4", src: "ドラマチックスターターガンダムSEED編「栄光のザフト」", name: "ドラマチックスターター「栄光のザフト」", date: "2003-05", deck: true },
  { code: "db3", src: "ドラマチックブースターガンダムSEED編", name: "ドラマチックブースター「ガンダムSEED編」", date: "2003-05" },
  M(11, "2003-08", "蒼海の死闘"),
  { code: "cb1", src: "コラボレーションブースター「ガンダムエース編」", name: "コラボレーションブースター「ガンダムエース編」", date: "2003-12" },
  M(12, "2004-02", "宿命の螺旋"),
  { code: "bb3", src: "ベースドブースター3", name: "ベースドブースター3", date: "2004-05" },
  M(13, "2004-08", "烈火の咆哮"),
  // A fonte chama a 1ª de só "拡張シート"; com esse nome a Ver.2 virava chip
  // dela na página de Sets (aninhaPorNome). Ver1/Ver2 como a Wikipédia japonesa.
  { code: "ext1", src: "拡張シート", name: "拡張シート Ver.1", date: "2004-10" },
  { code: "gm1", src: "ドラマチックブースター「戦場の女神」", name: "ドラマチックブースター「戦場の女神」", date: "2004-11" },
  { code: "ext2", src: "拡張シート Ver.2", name: "拡張シート Ver.2", date: "2005-01" },
  M(14, "2005-02", "果てなき運命"),
  { code: "ds5", src: "ドラマチックスターターガンダムSEEDDESTINY編「閃光のミネルバ」", name: "ドラマチックスターター「閃光のミネルバ」", date: "2005-05", deck: true },
  { code: "db4", src: "ドラマチックブースター「ガンダムSEEDDESTINY編」", name: "ドラマチックブースター「ガンダムSEED DESTINY編」", date: "2005-05" },
  M(15, "2005-08", "禁忌の胎動"),
  { code: "db5", src: "ドラマチックブースター「機動戦士ZガンダムTheMovie」", name: "ドラマチックブースター「機動戦士Zガンダム The Movie」", date: "2005-11" },
  { code: "ts1a", src: "タクティカルスターター「疾風の砲火」", name: "タクティカルスターター「疾風の砲火」", date: "2005-11", deck: true },
  { code: "ts1b", src: "タクティカルスターター「戦乱の兇刃」", name: "タクティカルスターター「戦乱の兇刃」", date: "2005-11", deck: true },
  M(16, "2006-02", "覇王の紋章"),
  { code: "db6", src: "ドラマチックブースター「ガンダム・ザ・ガンダム編」", name: "ドラマチックブースター「ガンダム・ザ・ガンダム編」", date: "2006-05" },
  { code: "ts2", src: "タクティカルスターター「爆炎の決闘場」", name: "タクティカルスターター「爆炎の決闘場」", date: "2006-05", deck: true },
  M(17, "2006-08", "不敗の流派"),
  { code: "eb1", src: "EXTENSION BOOSTER", name: "EXTENSION BOOSTER", date: "2006-11" },
  { code: "gmc", src: "「戦場の女神コインプラス」", name: "戦場の女神コインプラス", date: "2006-12" },
  M(18, "2007-02", "戦慄の兵威"),
  { code: "db7", src: "ドラマチックブースター「前線のフォトグラフ」", name: "ドラマチックブースター「前線のフォトグラフ」", date: "2007-05" },
  M(19, "2007-08", "変革の叛旗"),
  { code: "eb2", src: "EXTENSION BOOSTER2", name: "EXTENSION BOOSTER2", date: "2007-11" },
  M(20, "2008-02", "流転する世界"),
  { code: "dx1a", src: "DXタクティカルスターター「知略の猛将」", name: "DXタクティカルスターター「知略の猛将」", date: "2008-05", deck: true },
  { code: "dx1b", src: "DXタクティカルスターター「迅雷の騎兵」", name: "DXタクティカルスターター「迅雷の騎兵」", date: "2008-05", deck: true },
  M(21, "2008-08", "放たれた刃"),
  { code: "gm2", src: "ドラマチックブースター「戦場の女神2」", name: "ドラマチックブースター「戦場の女神2」", date: "2008-11" },
  M(22, "2009-02", "武神降臨"),
  { code: "dx2a", src: "DX Tactical Starter「破壊と再生の剣」", name: "DXタクティカルスターター「破壊と再生の剣」", date: "2009-05", deck: true },
  { code: "dx2b", src: "DX Tactical Starter「異世界からの使者」", name: "DXタクティカルスターター「異世界からの使者」", date: "2009-05", deck: true },
  M(23, "2009-08", "栄光の戦史"),
  { code: "eb3", src: "EXTENSION BOOSTER3", name: "EXTENSION BOOSTER3", date: "2009-11" },
  // Lista atual (categoria em CATEGORIAS).
  { code: "s26", name: "第26弾「戦いという名の対話」", date: "2010-11" },
  { code: "gma", name: "戦場の女神ADVENT", date: "2010-12" },
  { code: "wb1", name: "ウィナーズブースター01", date: "2011-01" },
  { code: "s27", name: "第27弾「雷鳴の使徒」", date: "2011-02" },
  { code: "ws2", name: "ウィナーズスターター「純白の鋼翼」", date: "2011-03", deck: true },
  { code: "s28", name: "第28弾「絶対戦力」", date: "2011-05" },
  // Sem data na fonte nem na Wikipédia.
  { code: "abs", src: "オールウェイズビギニングセット", name: "オールウェイズビギニングセット", date: "", deck: true },
  { code: "promo", src: "プロモーションカード", name: "プロモーションカード", date: "" },
  { code: "prize", src: "景品", name: "景品", date: "" }
];
// Nome em INGLÊS de cada set (exibido pelo src/nomes-sets.js, travado no
// tests/gundam-war.test.mjs). Tradução NOSSA: o jogo não saiu em inglês com
// esses produtos (a edição de 2005 teve três sets próprios), e nem a Bandai
// nem a Wikipédia dão nome em inglês. "第N弾" vira "Part N", como o 本弾 do
// gcd; título de anime e jogo pelo nome oficial em inglês (Gihren's Greed,
// Gundam the Gundam, Turn A). Revisado em 2026-11-11.
export const SET_EN = {
  s01: "Part 1",
  s02: "Part 2 — The Ace Pilot Sorties",
  ds1a: "Dramatic Starter — Decisive Battle! Operation Star One",
  ds1b: "Dramatic Starter — Space Fortress A Baoa Qu",
  s03: "Part 3 — Memories of Space",
  s04: "Part 4 — New Wings",
  ds2a: "Dramatic Starter — Scars of Justice",
  ds2b: "Dramatic Starter — The Black Path of Conquest",
  ds2c: "Dramatic Starter — The Red Menace",
  s05: "Part 5 — Eternal Bonds",
  db1: "Dramatic Booster — One Year War",
  s06: "Part 6 — Pulse of a New Century",
  db2: "Dramatic Booster — Wing / Turn A",
  s07: "Part 7 — Waves of Innovation",
  bb1: "Based Booster",
  s08: "Part 8 — Battle Dust Under the Moon",
  ds3a: "Dramatic Starter — Gihren's Greed A",
  ds3b: "Dramatic Starter — Gihren's Greed B",
  s09: "Part 9 — Trails of Conflict",
  bb2: "Based Booster 2",
  s10: "Part 10 — Descendants of Time",
  ds4: "Dramatic Starter — Gundam SEED: Glorious ZAFT",
  db3: "Dramatic Booster — Gundam SEED",
  s11: "Part 11 — Death Match on the Blue Sea",
  cb1: "Collaboration Booster — Gundam Ace",
  s12: "Part 12 — Spiral of Fate",
  bb3: "Based Booster 3",
  s13: "Part 13 — Roar of Raging Fire",
  ext1: "Expansion Sheet Ver.1",
  gm1: "Dramatic Booster — Goddesses of the Battlefield",
  ext2: "Expansion Sheet Ver.2",
  s14: "Part 14 — Endless Destiny",
  ds5: "Dramatic Starter — Gundam SEED Destiny: Flash of the Minerva",
  db4: "Dramatic Booster — Gundam SEED Destiny",
  s15: "Part 15 — Stirrings of the Forbidden",
  db5: "Dramatic Booster — Mobile Suit Z Gundam The Movie",
  ts1a: "Tactical Starter — Gale of Gunfire",
  ts1b: "Tactical Starter — Wicked Blade of War",
  s16: "Part 16 — Crest of the Conqueror",
  db6: "Dramatic Booster — Gundam the Gundam",
  ts2: "Tactical Starter — Arena of Blazing Flames",
  s17: "Part 17 — The Undefeated School",
  eb1: "Extension Booster",
  gmc: "Goddesses of the Battlefield Coin Plus",
  s18: "Part 18 — Terrifying Military Might",
  db7: "Dramatic Booster — Photographs from the Front",
  s19: "Part 19 — Banner of Revolt",
  eb2: "Extension Booster 2",
  s20: "Part 20 — A World in Flux",
  dx1a: "DX Tactical Starter — The Cunning Commander",
  dx1b: "DX Tactical Starter — Lightning Cavalry",
  s21: "Part 21 — The Unleashed Blade",
  gm2: "Dramatic Booster — Goddesses of the Battlefield 2",
  s22: "Part 22 — Descent of the War God",
  dx2a: "DX Tactical Starter — Sword of Destruction and Rebirth",
  dx2b: "DX Tactical Starter — Envoy from Another World",
  s23: "Part 23 — Glorious War Archive",
  eb3: "Extension Booster 3",
  s26: "Part 26 — A Dialogue Called Battle",
  gma: "Goddesses of the Battlefield ADVENT",
  wb1: "Winners Booster 01",
  s27: "Part 27 — Apostles of Thunder",
  ws2: "Winners Starter — Pure White Steel Wings",
  s28: "Part 28 — Absolute Force",
  abs: "Always Beginning Set",
  promo: "Promotional Cards",
  prize: "Prize Cards"
};
export const setNameEn = (code) => SET_EN[code] || "";
const SET_BY_CODE = new Map(SETS.map((s) => [s.code, s]));
const SET_BY_SRC = new Map(SETS.filter((s) => s.src).map((s) => [s.src, s]));
const SET_ORDER = new Map(SETS.map((s, i) => [s.code, i]));
export const setIdOf = (code) => `${ID_PREFIX}${code}`;

async function fetchPage(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.text();
    } catch { /* retry */ }
    await sleep(1000 * (i + 1));
  }
  return null; // fonte fora do ar
}

// Largura cheia (Ｕ, ０-９) -> ASCII: a fonte mistura as duas no número e na raridade.
export const meiaLargura = (s) => String(s || "").replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const texto = (s) => decodeEntities(String(s || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();

// Raridade como a carta imprime. A lista antiga deixa VAZIO o que não tem
// marca (a maioria é comum, mas promo e starter também vêm vazios): fica vazio,
// sem chute. "-" da lista atual (G básico, starter) idem.
export function raridade(s) {
  const r = meiaLargura(texto(s)).toUpperCase();
  return r === "-" ? "" : r;
}

// Página de facção da lista antiga -> [{ cor, num, name, set, tipo, rar }] na
// ordem da página. A linha da carta tem 4 células (número, nome, 収録,
// raridade) com o fundo na cor da carta; a de baixo, o texto (não guardamos).
export function parseListaAntiga(html, faccao = "") {
  const out = [];
  const h = String(html || "");
  const ancoras = [...h.matchAll(/<a name="([A-Z]+)"><\/a>/g)].map((m) => ({ pos: m.index, tipo: m[1] }));
  const re = /<td width="10%"[^>]*bgcolor="(#[0-9A-Fa-f]{6})"[^>]*>([^<]*)<\/td>\s*<td width="45%"[^>]*>([\s\S]*?)<\/td>\s*<td width="40%"[^>]*>([\s\S]*?)<\/td>\s*<td width="5%"[^>]*>([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(h))) {
    let tipo = "";
    for (const a of ancoras) { if (a.pos < m.index) tipo = a.tipo; else break; }
    out.push({
      cor: faccao === "dual" ? "dual" : COR_DO_FUNDO[m[1].toUpperCase()] || "",
      // A dual tem cor própria no fundo (a principal); guarda pro filtro.
      ...(faccao === "dual" && COR_DO_FUNDO[m[1].toUpperCase()] ? { corDual: COR_DO_FUNDO[m[1].toUpperCase()] } : {}),
      num: meiaLargura(texto(m[2])),
      name: texto(m[3]),
      set: texto(m[4]),
      tipo: TIPOS[tipo] || "",
      rar: raridade(m[5])
    });
  }
  return out;
}

// Página da lista atual -> [{ cor, num, name, tipo, rar, artist }]. Cada carta
// é uma tabela "cardlist-table" em pares de linhas: cabeçalho (<th>) e valores
// (<td>), com a miniatura numa célula à parte (pulada).
export function parseListaAtual(html) {
  const out = [];
  for (const bloco of String(html || "").split('class="cardlist-table"').slice(1)) {
    const trs = [...bloco.split("</table>")[0].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((x) => x[1]);
    const o = {};
    for (let i = 0; i < trs.length - 1; i++) {
      const ths = [...trs[i].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((x) => texto(x[1]));
      if (!ths.length) continue;
      const tds = [...trs[i + 1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].filter((x) => !/<img/.test(x[1])).map((x) => texto(x[1]));
      ths.forEach((t, j) => { if (!(t in o)) o[t] = tds[j]; });
      i++;
    }
    if (!o["カード番号"]) continue;
    const ilustrador = o["イラストレーター"] && o["イラストレーター"] !== "-" ? o["イラストレーター"] : "";
    out.push({
      cor: CORES[o["色"]] ? o["色"] : "",
      num: meiaLargura(o["カード番号"]),
      name: o["カード名"] || "",
      tipo: TIPOS[String(o["種類"] || "").toUpperCase()] || "",
      rar: raridade(o["レアリティ"]),
      ...(ilustrador ? { artist: ilustrador } : {})
    });
  }
  return out;
}

const numKey = (num) => String(num).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const corKey = (cor) => (cor === "dual" ? "d" : (CORES[cor] && CORES[cor].id) || "x");
export const chaveDaFonte = (c) => `${c.cor}|${c.num}`;

// Casa as cartas da fonte com as do snapshot pela chave (cor + número) pra
// manter o id. Carta nova: gw-<set>-<cor>-<número>, com sufixo (b, c…) se o
// id já está tomado no set. Carta do snapshot que saiu da fonte continua.
export function assignIds(setCode, fresh, known = []) {
  const porChave = new Map(known.map((c) => [c.key, c]));
  const used = new Set(known.map((c) => c.id));
  const visto = new Set();
  const out = [];
  for (const c of fresh) {
    const key = chaveDaFonte(c);
    if (visto.has(key)) continue; // a mesma carta duas vezes (duas páginas)
    visto.add(key);
    const antiga = porChave.get(key);
    let id = antiga && antiga.id;
    if (!id) {
      const base = `${ID_PREFIX}${setCode}-${corKey(c.cor)}-${numKey(c.num) || "x"}`;
      id = base;
      for (let i = 1; used.has(id); i++) id = `${base}${String.fromCharCode(97 + i)}`;
      used.add(id);
    }
    const { set, ...resto } = c;
    out.push({ id, key, ...resto });
  }
  for (const k of known) if (!visto.has(k.key)) out.push(k);
  return out;
}

async function refreshSnapshot(existing) {
  const knownSets = new Map((existing?.sets || []).map((s) => [s.code, s.cards || []]));
  const porSet = new Map();
  const add = (code, c) => { if (!porSet.has(code)) porSet.set(code, []); porSet.get(code).push(c); };
  let reached = 0;
  const semSet = new Map();
  for (const f of FACCOES) {
    const html = await fetchPage(`${BASE}/outdated/products/card.php?team=${f}`);
    await sleep(800);
    if (!html) continue;
    reached++;
    for (const c of parseListaAntiga(html, f)) {
      const def = SET_BY_SRC.get(c.set);
      if (def) add(def.code, c); else semSet.set(c.set, (semSet.get(c.set) || 0) + 1);
    }
  }
  for (const [cat, code] of Object.entries(CATEGORIAS)) {
    for (let page = 0; page < 1000; page += 20) {
      const html = await fetchPage(`${BASE}/cardlist/?page=${page}&search=true&category=${cat}`);
      await sleep(800);
      if (!html) break;
      if (!page) reached++;
      const cartas = parseListaAtual(html);
      for (const c of cartas) add(code, c);
      if (cartas.length < 20) break;
    }
  }
  if (!reached) { console.log("  carddass.com inacessível — segue com o snapshot versionado."); return existing; }
  for (const [nome, n] of semSet) console.log(`  ⚠ produto sem set no SETS: "${nome}" (${n} cartas) — fica de fora.`);

  const sets = [];
  for (const def of SETS) {
    const known = knownSets.get(def.code) || [];
    const fresh = porSet.get(def.code) || [];
    const cards = fresh.length ? assignIds(def.code, fresh, known) : known;
    if (cards.length) sets.push({ code: def.code, cards });
  }
  for (const [code, cards] of knownSets) if (!sets.some((s) => s.code === code) && cards.length) sets.push({ code, cards });
  sets.sort((a, b) => (SET_ORDER.get(a.code) ?? 999) - (SET_ORDER.get(b.code) ?? 999));

  const candidate = { source: `${BASE}/`, updatedAt: new Date().toISOString().slice(0, 10), sets };
  const newCount = snapshotCardCount(candidate);
  const oldCount = snapshotCardCount(existing);
  console.log(`  carddass.com: ${sets.length} sets, ${newCount} cartas (snapshot: ${oldCount}).`);
  if (newCount < oldCount) { console.log(`  ⚠ REGRESSÃO (${newCount} < ${oldCount}) — snapshot mantido.`); return existing; }
  const same = existing && JSON.stringify((existing.sets || []).map((s) => s.cards)) === JSON.stringify(sets.map((s) => s.cards));
  if (!same) await writeSnapshot(SNAP, candidate);
  return (await readSnapshot(SNAP)) || candidate;
}

// Imagem CURADA do dono (mesmo mecanismo dos outros vintages); sem ela, sem imagem.
function curatedImg(id) {
  for (const ext of ["webp", "jpg", "png"]) {
    if (existsSync(fileURLToPath(new URL(`assets/cards/${GAME}/${id}.${ext}`, ROOT)))) return `/assets/cards/${GAME}/${id}.${ext}`;
  }
  return "";
}

// Cartas do jogo a partir do snapshot.
export function cartasDoJogo(snapshot) {
  const out = [];
  for (const s of (snapshot && snapshot.sets) || []) {
    const def = SET_BY_CODE.get(s.code);
    if (!def) continue;
    for (const c of s.cards) {
      const cor = c.cor === "dual" ? c.corDual : c.cor;
      out.push({
        id: c.id,
        // Só japonês: não há nome oficial em inglês pra quase nenhuma carta, e
        // meia tradução confunde mais que ajuda (a regra do dbc e do gcd).
        name: c.name || `${c.num}`,
        set: def.name,
        setId: setIdOf(s.code),
        number: c.num,
        // Sem setTotal: a lista antiga não mostra as reimpressões de cada
        // produto (cabeçalho), e o total oficial que a Wikipédia dá as conta.
        setReleaseDate: def.date,
        ...(def.deck ? { setKind: "deck" } : {}),
        rarity: c.rar || "",
        ...(c.tipo ? { cardType: c.tipo } : {}),
        ...(CORES[cor] ? { color: CORES[cor].en } : {}),
        ...(c.cor === "dual" ? { dual: true } : {}),
        artist: c.artist || "",
        language: "ja",
        image: curatedImg(c.id),
        variants: ["Normal"],
        // Sem logo: nenhum produto tem logo próprio no catálogo, e o cartão
        // do set mostra o nome (contrato 3 do docs/CATALOGO.md).
        setLogo: "",
        vintage: true
      });
    }
  }
  return out;
}

async function build(snapshot) {
  const line = cartasDoJogo(snapshot);
  const existing = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const have = new Set(line.map((c) => c.id));
  const merged = line.concat(existing.filter((c) => c && c.id && !have.has(c.id))); // carta publicada nunca some
  await writeGameCatalog(OUT, { cards: merged, pricing: {}, webDir: `data/${GAME}/` });
  console.log(`  ${GAME}: ${line.length} cartas em ${(snapshot.sets || []).length} sets -> ${merged.length} totais`);
}

async function run() {
  console.log("Gundam War (Bandai 1999–2011, vintage)");
  let snapshot = await readSnapshot(SNAP);
  if (!NO_FETCH) snapshot = await refreshSnapshot(snapshot);
  if (!snapshot || !snapshot.sets) { console.log("  sem snapshot e sem fetch — nada a fazer."); return; }
  await build(snapshot);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
