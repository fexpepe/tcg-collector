// ドラゴンボール カードダス (Dragon Ball Carddass, Bandai 1988–1997): o jogo
// vintage `dbc`. A linha principal é o 本弾 (Hondan, "série principal"), que
// começou em nov/1988 com o 第1弾 e foi até o 第31弾 (1997, já no GT). Em
// paralelo a Bandai lançou Super Battle (20 partes), Visual Adventure (8) e
// Super Barcode Wars (4) — todas levantadas em SETS abaixo com data e total.
//
// Fontes (levantamento de 2026-09-24):
//   80storage.com   — lista CARTA A CARTA do Hondan (número, nome, BP/DP e os
//                     símbolos do verso), uma página por parte. Hoje cobre o
//                     第1弾 ao 第18弾 e o site publica ~1 parte por mês: o sync
//                     tenta todas as 31 e pega as novas sozinho.
//   retroballz.net  — ano e composição (regulares/prismas) de TODAS as séries.
//                     Só tem uma foto por parte (os prismas, em ângulo), não
//                     scan por carta — por isso os totais em SETS vêm de lá,
//                     mas as cartas não.
//   Nenhuma fonte acessível tem scan carta a carta (dragonballcards.com tem,
//   mas só serve HTTP e o fetch do CI/sessão é HTTPS). As cartas entram SEM
//   imagem, como as do One Piece 2002; scan curado entra por
//   assets/cards/dbc/<id>.webp (mesmo mecanismo do hxh).
//
// Sets sem lista carta a carta NÃO geram cartas: a numeração do Carddass tem
// pegadinhas (dois No.215 no 第6弾, o No.216 escondido no 第7弾, No.0 e E-1..9
// no 第16弾, numeração que recomeça no 第17弾) e inventar "No.1..42" criaria
// ids que teriam de mudar quando a lista real aparecesse.
//
// IDs: dbc-h06-215 = Hondan 第6弾, No.215. Número repetido dentro da parte
// ganha sufixo pela ordem da fonte (215, 215b). O id fica GRAVADO no snapshot
// e o refresh reaproveita o id da carta já conhecida (mesmo número + nome):
// correção de BP na fonte não troca id, e carta que some da fonte fica.
//
//   node scripts/sync-dbc-carddass.mjs             # fetch (se der) + build
//   node scripts/sync-dbc-carddass.mjs --no-fetch  # só build do snapshot
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog, decodeEntities, sleep } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const SNAP = new URL("data/vintage/dbc-carddass.json", ROOT);
const NAMES = JSON.parse(readFileSync(new URL("scripts/data/dbc-names-en.json", ROOT), "utf8"));
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Sleevu/1.0 (+sleevu.app)" };
const NO_FETCH = process.argv.includes("--no-fetch");
const GAME = "dbc";
const ID_PREFIX = "dbc-";
const LOGO = "/assets/games/game_dbc.webp";

// Séries: `code` é o prefixo do setId (dbc-h06, dbc-sb01…); `ja` vai no nome
// do set. A ordem aqui é a ordem das seções na página de Sets.
const SERIES = {
  h: { ja: "カードダス本弾", en: "Hondan" },
  sb: { ja: "スーパーバトル", en: "Super Battle" },
  va: { ja: "ビジュアルアドベンチャー", en: "Visual Adventure" },
  bw: { ja: "スーパーバーコードウォーズ", en: "Super Barcode Wars" }
};

// Todas as coleções Bandai do Carddass de Dragon Ball, na ordem de lançamento
// dentro de cada série. `date`: mês (80storage) quando conhecido, senão só o
// ano (RetroballZ). `total`: composição do RetroballZ. `s80`: número da página
// do 80storage (só Hondan). Subtítulos JP do Hondan 1–25: índice do 80storage;
// EN: tradução nossa, no padrão do hxh.
const H = (n, ja, en, date, total = 42) => ({ code: `h${String(n).padStart(2, "0")}`, series: "h", part: n, ja: `第${n}弾${ja ? `「${ja}」` : ""}`, en: `Part ${n}${en ? ` — ${en}` : ""}`, date, total, s80: n });
const P = (series, n, date, total, label) => ({ code: `${series}${String(n).padStart(2, "0")}`, series, part: n, ja: `第${label || n}弾`, en: `Part ${label || n}`, date, total });
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
  H(11, "猛威！鋼の超戦士", "Rampage! Warriors of Steel", "1992-06"),
  H(12, "逆襲！！3大超サイヤ人", "Counterattack!! The Three Super Saiyans", "1992-08"),
  H(13, "戦慄！！セルゲーム開始", "Terror!! The Cell Games Begin", "1992-11"),
  H(14, "決戦！究極超サイヤ人覚醒", "Showdown! The Ultimate Super Saiyan Awakens", "1993-03"),
  H(15, "勝利！金色の戦士誕生！！", "Victory! Birth of the Golden Warrior!!", "1993-06"),
  H(16, "決起！！新Z戦士たち", "Rise Up!! The New Z Fighters", "1993-09"),
  H(17, "始動！新章悟飯編", "Launch! The New Gohan Chapter", "1993-12"),
  H(18, "復活！伝説の魔人", "Revival! The Legendary Majin", "1994-03"),
  H(19, "乱戦！破壊王あらわる", "Melee! The King of Destruction Appears", "1994"),
  H(20, "震撼！究極パワー発動", "Tremor! Ultimate Power Unleashed", "1994"),
  H(21, "完成！超フュージョン", "Complete! Super Fusion", "1994"),
  H(22, "必殺！！史上最強のフュージョン", "Deadly!! The Strongest Fusion Ever", "1995"),
  H(23, "究極合体！超ベジット参上", "Ultimate Merge! Super Vegito Arrives", "1995"),
  H(24, "そして遥かなる戦いへ（前編）", "And On to a Distant Battle (Part 1)", "1995"),
  H(25, "そして遥かなる戦いへ（後編）", "And On to a Distant Battle (Part 2)", "1995"),
  // 26–31: fase GT. Subtítulo JP sem fonte confiável ainda — fica só o número.
  H(26, "", "", "1996"), H(27, "", "", "1996"), H(28, "", "", "1996"),
  H(29, "", "", "1997"), H(30, "", "", "1997"), H(31, "", "", "1997", 83),
  // Super Battle: 44 por parte (38 regulares + prismas, 2 escondidos por baixo).
  P("sb", 1, "1991", 44), P("sb", 2, "1992", 44), P("sb", 3, "1992", 44), P("sb", 4, "1992", 44),
  P("sb", 5, "1993", 44), P("sb", 6, "1993", 44), P("sb", 7, "1993", 44), P("sb", 8, "1994", 44),
  P("sb", 9, "1994", 44), P("sb", 10, "1994", 44), P("sb", 11, "1995", 44), P("sb", 12, "1995", 44),
  P("sb", 13, "1995", 44), P("sb", 14, "1995", 44), P("sb", 15, "1995", 44), P("sb", 16, "1996", 44),
  P("sb", 17, "1996", 44), P("sb", 18, "1996", 44), P("sb", 19, "1996", 44), P("sb", 20, "1997", 46),
  // Visual Adventure: arte original do Toriyama, 36 regulares + 6 holo.
  P("va", 1, "1991", 42), P("va", 2, "1991", 42), P("va", 3, "1991", 42), P("va", 4, "1992", 42),
  P("va", 5, "1992", 42), P("va", 6, "1993", 42, "SP"), P("va", 7, "1995", 42, "'95"), P("va", 8, "1995", 42, "EX"),
  // Super Barcode Wars: carta com código de barras (Super Barcode Multi Scanning System).
  P("bw", 1, "1992", 42), P("bw", 2, "1993", 42), P("bw", 3, "1993", 42), P("bw", 4, "1993", 42)
];
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
export function assignIds(setCode, fresh, known = []) {
  const byKey = new Map();
  for (const c of known) {
    const k = `${c.num}\u0000${c.name}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(c);
  }
  const used = new Set(known.map((c) => c.id));
  const taken = new Set();
  const out = [];
  for (const c of fresh) {
    const pool = byKey.get(`${c.num}\u0000${c.name}`) || [];
    const match = pool.find((k) => !taken.has(k.id));
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

async function refreshSnapshot(existing) {
  const knownSets = new Map((existing?.sets || []).map((s) => [s.code, s.cards || []]));
  const sets = [];
  let reached = 0;
  for (const def of SETS.filter((s) => s.s80)) {
    const html = await fetchText(`https://80storage.com/archive/dragonball-carddass-hondan-no${def.s80}/`);
    const known = knownSets.get(def.code) || [];
    if (html !== null) reached++;
    const fresh = html ? parse80storage(html) : [];
    // Parte que a fonte ainda não publicou (ou que o parser não entendeu) fica
    // como estava no snapshot.
    const cards = fresh.length ? assignIds(def.code, fresh, known) : known;
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

function curatedImg(id) {
  for (const ext of ["webp", "jpg", "png"]) {
    if (existsSync(fileURLToPath(new URL(`assets/cards/${GAME}/${id}.${ext}`, ROOT)))) return `/assets/cards/${GAME}/${id}.${ext}`;
  }
  return "";
}

export function setName(def) { return `${SERIES[def.series].ja} ${def.ja}`; }
export function setNameEn(def) { return `${SERIES[def.series].en} ${def.en}`; }

async function build(snapshot) {
  const outDir = new URL(`data/${GAME}/`, ROOT);
  const line = [];
  let named = 0;
  for (const s of snapshot.sets || []) {
    const def = SET_BY_CODE.get(s.code);
    if (!def) continue;
    const setId = `${ID_PREFIX}${s.code}`;
    for (const c of s.cards) {
      const en = nameEn(c.name);
      if (en) named++;
      line.push({
        id: c.id,
        name: en || c.name,
        ...(en && en !== c.name ? { nameJp: c.name } : {}),
        set: setName(def),
        setId,
        number: c.num,
        setTotal: s.cards.length,
        setReleaseDate: def.date,
        rarity: "",
        artist: "",
        language: "ja",
        image: curatedImg(c.id),
        variants: ["Normal"],
        setLogo: LOGO,
        vintage: true,
        vintageLine: def.series
      });
    }
  }
  const existing = (await readGlobalVar(new URL("cards.js", outDir), "TCG_CARDS")) || [];
  // O catálogo é só deste sync; mas carta publicada nunca some (usuário pode tê-la).
  const have = new Set(line.map((c) => c.id));
  const kept = existing.filter((c) => c && c.id && !have.has(c.id));
  const merged = line.concat(kept);
  const pricing = (await readGlobalVar(new URL("pricing.js", outDir), "TCG_PRICING")) || {};
  await writeGameCatalog(outDir, { cards: merged, pricing, webDir: `data/${GAME}/` });
  console.log(`  ${GAME}: ${line.length} cartas (${(snapshot.sets || []).length} partes, ${named} com nome EN) -> ${merged.length} totais`);
}

async function run() {
  console.log("Dragon Ball Carddass (Bandai 1988–1997, vintage)");
  let snapshot = await readSnapshot(SNAP);
  if (!NO_FETCH) snapshot = await refreshSnapshot(snapshot);
  if (!snapshot || !snapshot.sets) { console.log("  sem snapshot e sem fetch — nada a fazer."); return; }
  await build(snapshot);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
export { SETS, SERIES };
