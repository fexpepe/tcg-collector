// ドラゴンボール カードダス (Dragon Ball Carddass, Bandai 1988–1997): o jogo
// vintage `dbc`. A linha principal é o 本弾 (Hondan, "série principal"), que
// começou em nov/1988 com o 第1弾 e teve 30 partes, a última em jun/1997 (já no
// GT). Em set/1997 a Bandai fechou a linha com o 特別弾 (Parte Especial), que
// juntou Hondan e Super Battle na mesma carta. Em paralelo vieram Super Battle
// (20 partes), Visual Adventure (8) e Super Barcode Wars (4) — todas
// levantadas em SETS abaixo com data e total. Desde 2026-11-13 cada uma dessas
// três é um jogo vintage próprio (dbsb, dbva, dbbw; ver JOGO_DA_SERIE), e este
// sync grava os quatro catálogos.
//
// Fontes (levantamento de 2026-09-24, refeito em 2026-11-12):
//   80storage.com    — lista CARTA A CARTA do Hondan (número, nome, BP/DP e os
//                      símbolos do verso), uma página por parte. Cobre o
//                      第1弾 ao 第20弾 (nov/2026) e o site publica ~1 parte por
//                      mês: o sync tenta as 30 partes e o 特別弾 e pega as
//                      novas sozinho. É a fonte do NOME onde existe.
//   dbzcollection.fr — catálogo de fã (francês, irmão do animecollection.fr do
//                      Gundam Carddass) com UMA página por parte de TODAS as
//                      séries: número impresso, raridade (Regular, Prism,
//                      "dedoublable" = carta de duas camadas, Gold, Laser) e o
//                      scan de cada carta (h3000, ~490 px de largura nas
//                      Carddass, marca d'água do site — nos scans antigos ela
//                      atravessa a carta). Só HTTP: a imagem sai pelo wsrv.nl.
//                      NÃO dá o nome. Snapshot em data/vintage/dbc-dbzcollection.json.
//   nome transcrito  — Hondan 21–30, 特別弾, Super Battle, Visual Adventure e
//                      Barcode Wars não têm nome em texto em fonte nenhuma: foi
//                      LIDO nos scans (scripts/data/dbc-nomes-lidos.json, o
//                      cabeçalho de lá diz como). Quando o 80storage publicar
//                      uma parte, o nome dele passa na frente e o id fica.
//   vintcollect.com  — o mês de lançamento e a composição de cada parte de
//                      todas as séries (?mode=f9, página em EUC-JP). Conferido
//                      com o dbzcollection (mês nas descrições das partes) e,
//                      nos subtítulos do 26–30, com o display da Bandai.
//   retroballz.net   — ano e composição; a régua até 2026-11, hoje 2ª fonte.
//   Imagem: o scan do dbzcollection em todas as cartas (2026-11-12, aprovado
//   pelo Fernando). Os 631 webp de 225 px do Wayback (dragonballcards.com) que
//   moravam em assets/cards/dbc/ saíram; a pasta segue valendo pra imagem
//   curada (ver o README de lá).
//
// Carta de DUAS CAMADAS (隠れプリズム, Wプリズム, リバース/両面プリズム): a
// Bandai conta UMA carta (a vintcollect diz "全44種（内…隠れプリズム2種）"), e
// o dbzcollection lista as duas faces com o mesmo número. As duas faces viram
// uma carta só (a 2ª fica no snapshot com `face: 2`, mesmo id), MENOS onde o
// 80storage já listou as duas como cartas (No.500 do 第12弾 e o par 646/No.0
// do 第16弾): aí cada face segue sendo a carta que já é.
//
// IDs: dbc-h06-215 = Hondan 第6弾, No.215. Número repetido dentro da parte
// ganha sufixo pela ordem da fonte (215, 215b). O id fica GRAVADO nos dois
// snapshots e o refresh reaproveita o id da carta já conhecida (mesmo número
// + nome no 80storage; mesmo id da carta na fonte no dbzcollection): correção
// de BP na fonte não troca id, e carta que some da fonte fica.
//
//   node scripts/sync-dbc-carddass.mjs             # fetch (se der) + build
//   node scripts/sync-dbc-carddass.mjs --no-fetch  # só build do snapshot
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog, decodeEntities, sleep } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const SNAP = new URL("data/vintage/dbc-carddass.json", ROOT);
const SNAP_DZ = new URL("data/vintage/dbc-dbzcollection.json", ROOT);
const NAMES = JSON.parse(readFileSync(new URL("scripts/data/dbc-names-en.json", ROOT), "utf8"));
const LIDOS = JSON.parse(readFileSync(new URL("scripts/data/dbc-nomes-lidos.json", ROOT), "utf8"));
const DZ = "www.dbzcollection.fr/2v2"; // sem esquema: o wsrv busca em HTTP, que é o que o site serve
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Sleevu/1.0 (+sleevu.app)" };
const NO_FETCH = process.argv.includes("--no-fetch");
const ID_PREFIX = "dbc-";
// Cada série é um JOGO desde 2026-11-13 (pedido do Fernando: os jogos antigos
// de Dragon Ball, um por linha de produto, como na página Vintage). O dbc ficou
// com o 本弾 e o 特別弾; Super Battle, Visual Adventure e Super Barcode Wars
// viraram dbsb, dbva e dbbw com os MESMOS ids e setIds (dbc-sb01-1…), o
// caminho do Miracle Battle e do Gundam Carddass (src/migra-mbc.js leva a
// coleção de quem marcou; MUDOU_DE_JOGO no lint). O sync segue um só, porque
// as fontes são as mesmas, e grava os quatro catálogos.
export const JOGO_DA_SERIE = { h: "dbc", sb: "dbsb", va: "dbva", bw: "dbbw" };
// Os três novos ainda sem logo (decisão de 2026-11-13): o cartão do set mostra
// o nome, como no Gundam Carddass.
const LOGO = { dbc: "/assets/games/game_dbc-v2.webp" };

// Séries: `code` é o prefixo do setId (dbc-h06, dbc-sb01…); `ja` vai no nome
// do set. A ordem aqui é a ordem das seções na página de Sets. O Hondan era
// "カードダス本弾" até 2026-11-02: "カードダス" é o nome do jogo, que já está
// no cabeçalho (contrato 7 do docs/CATALOGO.md). O endereço não muda: nome só
// em japonês vira slug pelo setId.
const SERIES = {
  h: { ja: "本弾", en: "Hondan" },
  sb: { ja: "スーパーバトル", en: "Super Battle" },
  va: { ja: "ビジュアルアドベンチャー", en: "Visual Adventure" },
  bw: { ja: "スーパーバーコードウォーズ", en: "Super Barcode Wars" }
};

// Todas as coleções Bandai do Carddass de Dragon Ball, na ordem de lançamento
// dentro de cada série. `date`: o mês da cronologia da vintcollect (?mode=f9),
// que bate com o das descrições do dbzcollection em tudo o que as duas têm. O
// 第11弾 era 1992-06 (80storage) e virou 1992-05 pelas duas (2026-11-12).
// `total`: quantas cartas a Bandai conta na parte (a carta de duas camadas é
// uma). `s80`: número da página do 80storage (só Hondan). Subtítulos JP: do
// índice do 80storage no 1–25; do 26–30, da vintcollect, conferidos no
// display da Bandai que o dbzcollection fotografou (a Mandarake põe a manchete
// do display no lugar do subtítulo no 28 e erra o 29: 始動 por 発動).
// EN: tradução nossa, no padrão do hxh.
const H = (n, ja, en, date, total = 42) => ({ code: `h${String(n).padStart(2, "0")}`, series: "h", part: n, ja: `第${n}弾${ja ? `「${ja}」` : ""}`, en: `Part ${n}${en ? ` — ${en}` : ""}`, date, total, s80: n });
// `ja`/`en`: o nome da parte quando não é "第N弾"/"Part N" (a Visual Adventure
// conta em 集 e fecha com a Especial, a '95 e a '95EX; a Barcode Wars é パート).
const P = (series, n, date, total, ja, en) => ({ code: `${series}${String(n).padStart(2, "0")}`, series, part: n, ja: ja || `第${n}弾`, en: en || `Part ${n}`, date, total });
const SETS = [
  H(1, "格闘技大決戦", "Great Martial Arts Showdown", "1988-11"),
  H(2, "天下一武道会", "World Martial Arts Tournament", "1989-07"),
  H(3, "激闘！サイヤ人", "Fierce Battle! The Saiyans", "1989-11"),
  H(4, "大激闘！！ナメック星", "Great Battle!! Planet Namek", "1990-04"),
  H(5, "出撃！ギニュー特戦隊", "Sortie! The Ginyu Force", "1990-07"),
  H(6, "白熱！！悟空VSギニュー", "Heated!! Goku vs. Ginyu", "1990-11"),
  H(7, "戦慄！！フリーザ超変身！！", "Terror!! Frieza's Super Transformation!!", "1991-02"),
  H(8, "激震！！超サイヤ人", "Upheaval!! Super Saiyan", "1991-08"),
  H(9, "壮絶！！最強VS最強", "Magnificent!! Strongest vs. Strongest", "1991-11"),
  H(10, "戦慄！！人造人間起動", "Terror!! The Androids Awaken", "1992-02"),
  H(11, "猛威！鋼の超戦士", "Rampage! Warriors of Steel", "1992-05"),
  H(12, "逆襲！！3大超サイヤ人", "Counterattack!! The Three Super Saiyans", "1992-08"),
  H(13, "戦慄！！セルゲーム開始", "Terror!! The Cell Games Begin", "1992-11"),
  H(14, "決戦！究極超サイヤ人覚醒", "Showdown! The Ultimate Super Saiyan Awakens", "1993-03"),
  H(15, "勝利！金色の戦士誕生！！", "Victory! Birth of the Golden Warrior!!", "1993-06"),
  H(16, "決起！！新Z戦士たち", "Rise Up!! The New Z Fighters", "1993-09"),
  H(17, "始動！新章悟飯編", "Launch! The New Gohan Chapter", "1993-12"),
  // 魔人, não 魔神 (conferido em 2026-11-12): só o título do post do 80storage
  // diz 魔神; o cabeçalho e o texto da mesma página, o índice dele, a
  // cronologia da vintcollect, a tabela de compra da Mandarake e a lista da
  // gametaruru dizem 魔人 — e o 弾 é o do 魔人ブウ.
  H(18, "復活！伝説の魔人", "Revival! The Legendary Majin", "1994-03"),
  H(19, "乱戦！破壊王あらわる", "Melee! The King of Destruction Appears", "1994-07"),
  H(20, "震撼！究極パワー発動", "Tremor! Ultimate Power Unleashed", "1994-09"),
  H(21, "完成！超フュージョン", "Complete! Super Fusion", "1994-12"),
  H(22, "必殺！！史上最強のフュージョン", "Deadly!! The Strongest Fusion Ever", "1995-03"),
  H(23, "究極合体！超ベジット参上", "Ultimate Merge! Super Vegito Arrives", "1995-06"),
  H(24, "そして遥かなる戦いへ（前編）", "And On to a Distant Battle (Part 1)", "1995-09"),
  H(25, "そして遥かなる戦いへ（後編）", "And On to a Distant Battle (Part 2)", "1995-12"),
  // 26–30: fase GT (a numeração recomeça no No.1 do 第26弾).
  H(26, "出発！新たな冒険の旅へ", "Departure! On a New Adventure", "1996-03"),
  H(27, "爆発！超サイヤ人！！", "Explosion! Super Saiyan!!", "1996-06"),
  H(28, "来襲！超生命体", "Invasion! The Super Life-Form", "1996-11"),
  H(29, "超サイヤ人4発動！！", "Super Saiyan 4 Unleashed!!", "1997-02"),
  H(30, "出現！究極の敵DB！？", "Emergence! The Ultimate Enemy, the Dragon Balls!?", "1997-06"),
  // 特別弾 (set/1997): a Bandai conta 30 partes e fecha o Hondan com esta
  // Parte Especial, que juntou Hondan e Super Battle (verso com a numeração
  // própria 1–81 e as duas totais). Não existe "第31弾" de 1997: o 31弾
  // oficial é a caixa de Dragon Ball Super de 2015/16 (Complete Box 31弾・32弾).
  // O código h31 fica — é o setId gravado; o set ainda não tem cartas, então
  // nenhum endereço muda. 83 = 72 regulares + 8 prismas + 1 laser + as 2
  // limitadas da campanha (a No.82 e a carta grande do sorteio), pelo
  // RetroballZ. `s80` 31 é aposta: o 80storage ainda não publicou o 特別弾.
  { ...H(31, "", "", "1997-09", 83), ja: "特別弾", en: "Special Part" },
  // Super Battle: 44 por parte, numeração corrida (No.1 a No.880). Prismas,
  // 隠れプリズム (a prisma escondida sob uma carta comum) e, do 第3弾 em
  // diante, Wプリズム (duas prismas). O 19 e o 20 somam as メタル隠れプリズム
  // No.01–04 (as "silver"), com numeração própria: 46.
  P("sb", 1, "1991-11", 44), P("sb", 2, "1992-04", 44), P("sb", 3, "1992-07", 44), P("sb", 4, "1992-10", 44),
  P("sb", 5, "1993-02", 44), P("sb", 6, "1993-05", 44), P("sb", 7, "1993-08", 44), P("sb", 8, "1994-02", 44),
  P("sb", 9, "1994-05", 44), P("sb", 10, "1994-08", 44), P("sb", 11, "1994-11", 44), P("sb", 12, "1995-02", 44),
  P("sb", 13, "1995-05", 44), P("sb", 14, "1995-08", 44), P("sb", 15, "1995-11", 44), P("sb", 16, "1996-02", 44),
  P("sb", 17, "1996-05", 44), P("sb", 18, "1996-08", 44), P("sb", 19, "1996-12", 46), P("sb", 20, "1997-05", 46),
  // Visual Adventure: arte do próprio mangá (os originais coloridos do
  // Toriyama, ou os em P&B colorizados sob supervisão dele), sem números de
  // jogo; 36 regulares + 6 prismas. A Especial (1993) é a seleção do 第1–5集,
  // com as 6 prismas também em laser (o dbzcollection tem as duas).
  P("va", 1, "1991-06", 42, "第1集"), P("va", 2, "1991-09", 42, "第2集"), P("va", 3, "1991-12", 42, "第3集"),
  P("va", 4, "1992-05", 42, "第4集"), P("va", 5, "1992-09", 42, "第5集"), P("va", 6, "1993-06", 42, "スペシャル", "Special"),
  P("va", 7, "1995-04", 42, "'95", "'95"), P("va", 8, "1995-10", 42, "'95EX", "'95EX"),
  // Super Barcode Wars: carta com código de barras no verso, lida pelo
  // スーパーバーコードウォーズ, o portátil da Bandai de 1992 (マルチスキャニング
  // システム é só o nome do leitor dele).
  P("bw", 1, "1992-12", 42, "パート1"), P("bw", 2, "1993-04", 42, "パート2"), P("bw", 3, "1993-07", 42, "パート3"), P("bw", 4, "1993-11", 42, "パート4")
];
// Página de cada parte no dbzcollection: "<coleção>/<série>" do
// cartes.php?idc=<coleção>&ids=<série> (Hondan = 18, 特別弾 = 137, Super
// Battle = 34, Visual Adventure = 56, Barcode Wars = 43).
const DZ_SERIE = {
  h01: "18/65", h02: "18/73", h03: "18/74", h04: "18/75", h05: "18/76", h06: "18/78", h07: "18/79", h08: "18/80",
  h09: "18/81", h10: "18/82", h11: "18/83", h12: "18/84", h13: "18/85", h14: "18/86", h15: "18/88", h16: "18/89",
  h17: "18/90", h18: "18/91", h19: "18/92", h20: "18/93", h21: "18/94", h22: "18/95", h23: "18/96", h24: "18/97",
  h25: "18/98", h26: "18/99", h27: "18/100", h28: "18/101", h29: "18/102", h30: "18/103", h31: "137/104",
  sb01: "34/146", sb02: "34/147", sb03: "34/148", sb04: "34/149", sb05: "34/151", sb06: "34/152", sb07: "34/153",
  sb08: "34/154", sb09: "34/155", sb10: "34/156", sb11: "34/157", sb12: "34/158", sb13: "34/159", sb14: "34/160",
  sb15: "34/161", sb16: "34/163", sb17: "34/169", sb18: "34/171", sb19: "34/172", sb20: "34/173",
  va01: "56/246", va02: "56/249", va03: "56/250", va04: "56/251", va05: "56/253", va06: "56/254", va07: "56/255", va08: "56/256",
  bw01: "43/194", bw02: "43/195", bw03: "43/196", bw04: "43/197"
};
for (const s of SETS) s.dz = DZ_SERIE[s.code];
const SET_BY_CODE = new Map(SETS.map((s) => [s.code, s]));
const SET_ORDER = new Map(SETS.map((s, i) => [s.code, i]));

async function fetchText(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
      if (r.status === 404) return "";          // parte ainda não publicada
      if (r.ok) return await r.text();
    } catch { /* retry */ }
    await sleep(1000 * (i + 1));
  }
  return null;                                   // fonte fora do ar
}

const cellText = (html) => decodeEntities(String(html)
  .replace(/<img[^>]*alt="([^"]*)"[^>]*>/g, "[$1]")   // o 箔 às vezes é um ícone (ギニュー特戦隊)
  .replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();

// Tabela do 80storage -> [{ num, total, name, stats }]. A primeira coluna é a
// "カードNo" ("No.211", "43", "BH-1", "E-9"); do 第17弾 em diante há também a
// "Total No." (a numeração corrida antiga). O resto das colunas vai cru em
// `stats` (BP/DP, スカウター, 箔, 裏, 漢, 星…), que mudam de parte pra parte.
export function parse80storage(html) {
  const table = (String(html).match(/<table[\s\S]*?<\/table>/) || [""])[0];
  if (!table) return [];
  const head = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => cellText(m[1]));
  const iNum = head.indexOf("カードNo");
  const iName = head.indexOf("名前");
  const iTotal = head.indexOf("Total No.");
  if (iNum < 0 || iName < 0) return [];
  const out = [];
  for (const tr of table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => cellText(m[1]));
    if (tds.length < head.length || !tds[iNum] || !tds[iName]) continue;
    const stats = {};
    head.forEach((h, i) => { if (i !== iNum && i !== iName && i !== iTotal && tds[i]) stats[h] = tds[i]; });
    out.push({
      num: tds[iNum].replace(/^No\.?\s*/i, ""),
      ...(iTotal >= 0 && tds[iTotal] ? { total: tds[iTotal].replace(/^No\.?\s*/i, "") } : {}),
      name: tds[iName],
      stats
    });
  }
  return out;
}

const numKey = (num) => String(num).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Casa as cartas novas com as do snapshot pra MANTER o id. Mesma posição de
// repetição (o 2º "215" com o 2º "215") + mesmo nome; sem par, id novo com
// sufixo livre. Cartas do snapshot sem par na fonte continuam (nunca regride).
// `outros`: cartas que JÁ têm id por outra fonte (as do dbzcollection, com o
// nome lido no scan): sem par por número + nome, a carta pega o id da 1ª
// delas com o mesmo número ainda livre — o nome lido pode não bater letra a
// letra com o do 80storage, e a carta não pode nascer duas vezes. Elas só
// emprestam o id: as que sobram não entram no snapshot do 80storage.
export function assignIds(setCode, fresh, known = [], outros = []) {
  const byKey = new Map();
  for (const c of known) {
    const k = `${c.num}\u0000${c.name}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(c);
  }
  const used = new Set([...known, ...outros].map((c) => c.id));
  const taken = new Set();
  const out = [];
  for (const c of fresh) {
    const pool = byKey.get(`${c.num}\u0000${c.name}`) || [];
    const match = pool.find((k) => !taken.has(k.id)) || outros.find((k) => k.num === c.num && !taken.has(k.id));
    let id;
    if (match) id = match.id;
    else {
      const base = `${ID_PREFIX}${setCode}-${numKey(c.num) || "x"}`;
      id = base;
      for (let i = 1; used.has(id); i++) id = `${base}${String.fromCharCode(97 + i)}`; // 215, 215b, 215c…
    }
    used.add(id);
    taken.add(id);
    out.push({ id, ...c });
  }
  for (const k of known) if (!taken.has(k.id)) out.push(k);
  return out;
}

async function refreshSnapshot(existing, dz) {
  const knownSets = new Map((existing?.sets || []).map((s) => [s.code, s.cards || []]));
  const dzSets = new Map((dz?.sets || []).map((s) => [s.code, s.cards || []]));
  const sets = [];
  let reached = 0;
  for (const def of SETS.filter((s) => s.s80)) {
    const html = await fetchText(`https://80storage.com/archive/dragonball-carddass-hondan-no${def.s80}/`);
    const known = knownSets.get(def.code) || [];
    if (html !== null) reached++;
    const fresh = html ? parse80storage(html) : [];
    // Parte que a fonte ainda não publicou (ou que o parser não entendeu) fica
    // como estava no snapshot. Parte nova herda o id das cartas que o
    // dbzcollection já trouxe (o 2º lado da carta de duas camadas fica de fora).
    const outros = (dzSets.get(def.code) || []).filter((c) => c.face !== 2);
    const cards = fresh.length ? assignIds(def.code, fresh, known, outros) : known;
    if (cards.length) sets.push({ code: def.code, cards });
    await sleep(400);
  }
  if (!reached) { console.log("  80storage inacessível — segue com o snapshot versionado."); return existing; }
  // Set que existia no snapshot e não é mais do 80storage (não deveria
  // acontecer) também fica.
  for (const [code, cards] of knownSets) if (!sets.some((s) => s.code === code) && cards.length) sets.push({ code, cards });
  sets.sort((a, b) => (SET_ORDER.get(a.code) ?? 999) - (SET_ORDER.get(b.code) ?? 999));

  const candidate = { source: "https://80storage.com/work/dragonball/", updatedAt: new Date().toISOString().slice(0, 10), sets };
  const newCount = snapshotCardCount(candidate);
  const oldCount = snapshotCardCount(existing);
  console.log(`  80storage: ${sets.length} partes, ${newCount} cartas (snapshot: ${oldCount}).`);
  if (newCount < oldCount) { console.log(`  ⚠ REGRESSÃO (${newCount} < ${oldCount}) — snapshot mantido.`); return existing; }
  const same = existing && JSON.stringify((existing.sets || []).map((s) => s.cards)) === JSON.stringify(sets.map((s) => s.cards));
  if (!same) await writeSnapshot(SNAP, candidate);
  return (await readSnapshot(SNAP)) || candidate;
}

// ---- dbzcollection.fr ----------------------------------------------------

async function fetchLatin1(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
      // A página é ISO-8859-1: o "n°" do número vem num byte só.
      if (r.ok) return new TextDecoder("latin1").decode(await r.arrayBuffer());
    } catch { /* retry */ }
    await sleep(1000 * (i + 1));
  }
  return null; // fonte fora do ar
}

// Página de uma parte -> [{ src, num, rar, dir }] na ordem da página. É o
// HTML do animecollection (parseAnimeCollection, sync-gundam-carddass.mjs):
// cada carta é um bloco "bc_cadre", com a raridade no title do cabeçalho, o
// número impresso ("n°215", "BH-1", "C1A", "646=0") e o caminho da imagem
// ("18/78/h400_3867"). A embalagem usa outra função (afficher_detail_pack) e
// fica de fora; o que não tem número (o "Display", a folha "Extrait Book")
// também.
export function parseDbzCollection(html) {
  const out = [];
  const re = /<div class="bc_cadre_numero" title="([^"]*)"[^>]*>\s*<div class="bc_texte_numero">([^<]*)<\/div>\s*<\/div>((?:(?!bc_cadre_numero)[\s\S])*?)afficher_detail\(\s*'(\d+)'\s*,\s*'(\d+)\/(\d+)\/h400_\4'\s*\)/g;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const num = decodeEntities(m[2]).replace(/^n\s*°\s*/i, "").trim();
    if (!/^[A-Za-z]{0,2}-?\d+[A-Za-z]?(=\d+)?$/.test(num)) continue;
    out.push({ src: Number(m[4]), num, rar: decodeEntities(m[1]).trim(), dir: `${m[5]}/${m[6]}` });
  }
  return out;
}

// Onde a ordem do dbzcollection não é a do 80storage, o id da carta na fonte
// manda (conferido no scan, 2026-11-12). A chave é o `src`.
export const FACE_DE = {
  4155: "dbc-h12-500b", // 第12弾: a página traz o 三大超サイヤ人 antes do THE MEMORIAL CARDDASS
  7798: "dbc-h12-500",
  7794: "dbc-h16-0"     // 第16弾: o "646=0" da fonte é o No.0 (孫悟空一家), a camada de baixo do No.646
};

// Ids das cartas de uma parte. Casa pelo id DA FONTE (`src`) com o snapshot;
// carta nova pega o FACE_DE, ou, pela ordem, o id da carta do 80storage com o
// mesmo número, ou um id novo (dbc-<set>-<número>, sufixo b, c… se o número
// já está tomado). Duas entradas "dedoublable" com o mesmo número são as duas
// faces de UMA carta: a 2ª leva o id da 1ª e `face: 2` — menos onde o
// 80storage lista o número duas vezes (aí cada face é a carta que já é).
// Carta do snapshot que saiu da fonte continua.
export function assignIdsDz(setCode, fresh, known = [], cards80 = []) {
  const porSrc = new Map(known.map((c) => [c.src, c]));
  const por80 = new Map();
  for (const c of cards80) { if (!por80.has(c.num)) por80.set(c.num, []); por80.get(c.num).push(c.id); }
  const used = new Set([...known, ...cards80].map((c) => c.id));
  const tomado = new Set();
  const frente = new Map(); // número -> carta de cima de um par ainda sem a 2ª face
  const visto = new Set();
  const out = [];
  for (const c of fresh) {
    if (visto.has(c.src)) continue; // a mesma carta duas vezes na página
    visto.add(c.src);
    const antiga = porSrc.get(c.src);
    if (antiga) {
      const card = { ...antiga, num: c.num, rar: c.rar, dir: c.dir };
      out.push(card);
      tomado.add(card.id);
      if (c.rar === "dedoublable" && card.face !== 2) frente.set(c.num, card);
      else if (card.face === 2) frente.delete(c.num);
      continue;
    }
    const par = c.rar === "dedoublable" && frente.get(c.num);
    if (par && (por80.get(c.num) || []).length < 2) {
      out.push({ id: par.id, src: c.src, num: c.num, rar: c.rar, dir: c.dir, face: 2 });
      frente.delete(c.num);
      continue;
    }
    let id = FACE_DE[c.src] || (por80.get(c.num) || []).find((x) => !tomado.has(x));
    if (!id) {
      const base = `${ID_PREFIX}${setCode}-${numKey(c.num) || "x"}`;
      id = base;
      for (let i = 1; used.has(id); i++) id = `${base}${String.fromCharCode(97 + i)}`;
    }
    used.add(id);
    tomado.add(id);
    const card = { id, src: c.src, num: c.num, rar: c.rar, dir: c.dir };
    out.push(card);
    if (c.rar === "dedoublable") frente.set(c.num, card);
  }
  for (const k of known) if (!visto.has(k.src)) out.push(k);
  return out;
}

async function refreshDz(existing, snap80) {
  const known = new Map((existing?.sets || []).map((s) => [s.code, s.cards || []]));
  const s80 = new Map((snap80?.sets || []).map((s) => [s.code, s.cards || []]));
  const sets = [];
  let reached = 0;
  for (const def of SETS.filter((s) => s.dz)) {
    const [idc, ids] = def.dz.split("/");
    const html = await fetchLatin1(`http://${DZ}/cartes.php?idc=${idc}&ids=${ids}`);
    if (html !== null) reached++;
    const fresh = html ? parseDbzCollection(html) : [];
    const k = known.get(def.code) || [];
    // Parte que a fonte não devolveu (ou que o parser não entendeu) fica como
    // estava no snapshot.
    const cards = fresh.length ? assignIdsDz(def.code, fresh, k, s80.get(def.code) || []) : k;
    if (cards.length) sets.push({ code: def.code, cards });
    await sleep(1200); // site pequeno, de fã: uma página por segundo
  }
  if (!reached) { console.log("  dbzcollection inacessível — segue com o snapshot versionado."); return existing; }
  for (const [code, cards] of known) if (!sets.some((s) => s.code === code) && cards.length) sets.push({ code, cards });
  sets.sort((a, b) => (SET_ORDER.get(a.code) ?? 999) - (SET_ORDER.get(b.code) ?? 999));

  const candidate = { source: `http://${DZ}/cartes.php`, updatedAt: new Date().toISOString().slice(0, 10), sets };
  const newCount = snapshotCardCount(candidate);
  const oldCount = snapshotCardCount(existing);
  console.log(`  dbzcollection: ${sets.length} partes, ${newCount} faces (snapshot: ${oldCount}).`);
  if (newCount < oldCount) { console.log(`  ⚠ REGRESSÃO (${newCount} < ${oldCount}) — snapshot mantido.`); return existing; }
  const same = existing && JSON.stringify((existing.sets || []).map((s) => s.cards)) === JSON.stringify(sets.map((s) => s.cards));
  if (!same) await writeSnapshot(SNAP_DZ, candidate);
  return (await readSnapshot(SNAP_DZ)) || candidate;
}

// URL de ORIGEM do scan grande (sem esquema) e a do catálogo pelo wsrv. O
// "h3000" é o nome que a fonte dá à versão HD (~490 px de largura nas Carddass).
export const scanDe = (c) => `${DZ}/cartes/${c.dir}/h3000_${c.src}_carte.jpg`;
export const IMG = (src) => `https://wsrv.nl/?url=${encodeURIComponent(src)}&w=440&output=webp`;

// Raridade como o Carddass a entende: o brilho. "Regular" é a carta comum
// (Normal); o "Holo" do No.271 do 第7弾 é uma das 6 prismas que a Bandai conta
// lá. A carta de duas camadas ("dedoublable") leva o nome pela composição da
// Bandai em cada parte (vintcollect): Wプリズム no 第12弾 e no 第16弾,
// リバースプリズム (両面) do 第20弾 em diante. No 第13弾 os dois
// "dedoublable" (No.542 e 543) são comuns: as 6 prismas de lá já estão
// marcadas. Na Super Battle a leitura do scan diz se a carta de cima é comum
// (隠れプリズム) ou prisma (Wプリズム): fica em `raridade` no
// scripts/data/dbc-nomes-lidos.json, como a メタル隠れプリズム do 19 e do 20.
const RARIDADE_DZ = { Regular: "Normal", Prism: "Prism", Holo: "Prism", Gold: "Gold", Laser: "Laser" };
export function raridadeDbc(setCode, card, lida = "") {
  if (!card) return "";
  if (card.rar !== "dedoublable") return RARIDADE_DZ[card.rar] ?? card.rar ?? "";
  if (lida) return lida;
  if (setCode === "h13") return "Normal";
  if (setCode === "h12" || setCode === "h16") return "Double Prism";
  if (/^h/.test(setCode)) return "Reverse Prism";
  return "Double Prism";
}

// Nome EN: frase inteira conhecida > personagem avulso > composição por
// separador (＆ ・ 、 と = "&"; VS 対 = "vs."). Se QUALQUER pedaço não tiver
// tradução, fica o japonês inteiro — meia tradução confunde mais que ajuda.
export function nameEn(ja) {
  const s = String(ja || "").trim();
  if (NAMES.phrases[s]) return NAMES.phrases[s];
  if (NAMES.atoms[s]) return NAMES.atoms[s];
  const vs = s.split(/\s*(?:VS|対)\s*/);
  if (vs.length > 1) {
    const parts = vs.map(nameEn);
    return parts.every(Boolean) ? parts.join(" vs. ") : "";
  }
  const and = s.split(/[＆&・、]|(?<=[^\s])と(?=[^\s])/);
  if (and.length > 1) {
    const parts = and.map((p) => NAMES.atoms[p.trim()] || NAMES.phrases[p.trim()] || "");
    return parts.every(Boolean) ? parts.join(" & ") : "";
  }
  return "";
}

// A pasta de imagem curada é uma só pros quatro jogos (o id já diz a série).
function curatedImg(id) {
  for (const ext of ["webp", "jpg", "png"]) {
    if (existsSync(fileURLToPath(new URL(`assets/cards/dbc/${id}.${ext}`, ROOT)))) return `/assets/cards/dbc/${id}.${ext}`;
  }
  return "";
}

// Nome do set: no dbc o 本弾 abre o nome ("本弾 第1弾「…」"), como sempre foi;
// nos jogos de série única a série É o jogo e não abre o nome (contrato 7 do
// docs/CATALOGO.md): "第1弾", "Part 1". O endereço não muda: nome curto ou só
// em japonês vira slug pelo setId (dbc-sb01-1), o mesmo de antes.
export function setName(def) { return def.series === "h" ? `${SERIES.h.ja} ${def.ja}` : def.ja; }
export function setNameEn(def) { return def.series === "h" ? `${SERIES.h.en} ${def.en}` : def.en; }
export function jogoDoSet(def) { return JOGO_DA_SERIE[def.series]; }

// Cartas do jogo a partir dos dois snapshots, na ordem de SETS. Em cada parte:
// as do 80storage (na ordem dele) e depois as que só o dbzcollection tem.
// Nome: o do 80storage > o lido no scan > o número (sem nome não se inventa).
// Raridade e imagem: as da 1ª face no dbzcollection; a imagem curada em
// assets/cards/dbc/ passa na frente.
export function cartasDoJogo(snap80, dz, lidos = LIDOS) {
  const s80 = new Map((snap80?.sets || []).map((s) => [s.code, s.cards || []]));
  const sDz = new Map((dz?.sets || []).map((s) => [s.code, s.cards || []]));
  const line = [];
  for (const def of SETS) {
    const c80 = s80.get(def.code) || [];
    const faces = new Map();
    for (const c of sDz.get(def.code) || []) { if (!faces.has(c.id)) faces.set(c.id, []); faces.get(c.id).push(c); }
    const de80 = new Map(c80.map((c) => [c.id, c]));
    const ids = [...c80.map((c) => c.id), ...[...faces.keys()].filter((id) => !de80.has(id))];
    for (const id of ids) {
      const a = de80.get(id);
      const f = (faces.get(id) || []).find((x) => x.face !== 2);
      const ja = (a && a.name) || lidos.nomes[id] || "";
      const en = nameEn(ja);
      const num = a ? a.num : f.num;
      line.push({
        id,
        name: en || ja || `No. ${num}`,
        ...(en && en !== ja ? { nameJp: ja } : {}),
        set: setName(def),
        setId: `${ID_PREFIX}${def.code}`,
        number: num,
        setTotal: ids.length,
        setReleaseDate: def.date,
        rarity: raridadeDbc(def.code, f, lidos.raridade[id]),
        artist: "",
        language: "ja",
        image: curatedImg(id) || (f ? IMG(scanDe(f)) : ""),
        variants: ["Normal"],
        setLogo: LOGO[jogoDoSet(def)] || "",
        vintage: true,
        vintageLine: def.series
      });
    }
  }
  return line;
}

// Jogo de uma carta pelo setId (dbc-sb01 -> dbsb). Carta guardada de um
// catálogo antigo sem série conhecida fica no dbc.
export function jogoDaCarta(c) {
  const m = /^dbc-([a-z]+)\d/.exec(String((c && c.setId) || ""));
  return (m && JOGO_DA_SERIE[m[1]]) || "dbc";
}

async function build(snapshot, dz) {
  const line = cartasDoJogo(snapshot, dz);
  for (const jogo of Object.values(JOGO_DA_SERIE)) {
    const outDir = new URL(`data/${jogo}/`, ROOT);
    const doJogo = line.filter((c) => jogoDaCarta(c) === jogo);
    const named = doJogo.filter((c) => c.nameJp).length;
    const semNome = doJogo.filter((c) => /^No\. /.test(c.name)).length;
    const semImagem = doJogo.filter((c) => !c.image).length;
    const existing = (await readGlobalVar(new URL("cards.js", outDir), "TCG_CARDS")) || [];
    // O catálogo é só deste sync; mas carta publicada nunca some (usuário pode
    // tê-la) — MENOS a que mudou de jogo: a dbc-sb… que o catálogo do dbc ainda
    // guarda de antes da separação vai pro dbsb e sai daqui.
    const have = new Set(doJogo.map((c) => c.id));
    const kept = existing.filter((c) => c && c.id && !have.has(c.id) && jogoDaCarta(c) === jogo);
    const merged = doJogo.concat(kept);
    const pricing = (await readGlobalVar(new URL("pricing.js", outDir), "TCG_PRICING")) || {};
    await writeGameCatalog(outDir, { cards: merged, pricing, webDir: `data/${jogo}/` });
    const partes = new Set(doJogo.map((c) => c.setId)).size;
    const saiu = existing.filter((c) => c && c.id && jogoDaCarta(c) !== jogo).length;
    console.log(`  ${jogo}: ${doJogo.length} cartas em ${partes} partes (${named} com nome EN, ${semNome} sem nome, ${semImagem} sem imagem) -> ${merged.length} totais${saiu ? `; ${saiu} mudaram de jogo` : ""}`);
  }
}

async function run() {
  console.log("Dragon Ball Carddass (Bandai 1988–1997, vintage)");
  let snapshot = await readSnapshot(SNAP);
  let dz = await readSnapshot(SNAP_DZ);
  if (!NO_FETCH) {
    // O dbzcollection primeiro: parte nova do 80storage herda o id dele.
    dz = await refreshDz(dz, snapshot);
    snapshot = await refreshSnapshot(snapshot, dz);
  }
  if (!snapshot && !dz) { console.log("  sem snapshot e sem fetch — nada a fazer."); return; }
  await build(snapshot, dz);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
export { SETS, SERIES };
