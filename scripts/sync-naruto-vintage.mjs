// NARUTO カードゲーム (Bandai, 2002–2006): catálogo vintage do Naruto a partir
// de TRÊS fontes que se completam (a numeração 忍-N/術-N/作-N/依-N é global e
// bate entre elas):
//
//   1. tcg-db.nikita.jp (DB de fã)  -> scans grandes + cartas dos vols. 14–16 e
//      promos; INCOMPLETO (ex.: vol.1 só 41 de 70) e com grupos "※確認中".
//   2. TV Tokyo (site oficial do anime de 2002, ainda no ar) -> lista OFICIAL
//      dos vols. 1–13 com número, nome e thumbnail de cada carta.
//   3. cardcheckbox.com -> datas de lançamento, totais oficiais e FAIXAS de
//      numeração dos 17 volumes (transcritas em OFFICIAL_VOLUMES abaixo; são
//      história encerrada em 2006, não mudam — por isso hardcoded, sem scraper).
//
// Mesmo padrão-snapshot dos vintage do One Piece: o build SEMPRE parte dos
// snapshots versionados (data/vintage/naruto-*.json); o fetch só atualiza o
// snapshot quando responde e não regride. ANEXA ao catálogo do Naruto (mantém
// cartas de outras linhas — ex.: um futuro moderno da TCGCSV).
//
//   node scripts/sync-naruto-vintage.mjs             # fetch (se der) + build
//   node scripts/sync-naruto-vintage.mjs --no-fetch  # só build dos snapshots
//
// IDs são PEGAJOSOS: uma carta que já existe no catálogo mantém o id pra sempre
// (mapeado pelo número oficial), mesmo que a fonte da imagem mude — coleções de
// usuários referenciam esses ids.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog, sleep } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/naruto/", ROOT);
const SNAP_DB = new URL("data/vintage/naruto-carddass.json", ROOT);
const SNAP_TVT = new URL("data/vintage/naruto-tvtokyo.json", ROOT);
// Promos confirmadas publicamente sem scan no tcg-db (curadoria manual):
// entram com placeholder de imagem; um scan futuro do tcg-db assume na hora.
const CURATED_PROMOS = new URL("data/vintage/naruto-promos-curated.json", ROOT);
const CACHE_DIR = new URL("data/.cache/", ROOT);
const DB_BASE = "https://tcg-db.nikita.jp";
const TVT_BASE = "https://www.tv-tokyo.co.jp/anime/naruto2002/goods";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
const NO_FETCH = process.argv.includes("--no-fetch");

// ── Tabela oficial dos 17 volumes (cardcheckbox.com, checada em 2026-07) ─────
// date: vols. 2 e 3 não têm mês na fonte ("2003年00月") — mês ESTIMADO entre as
// âncoras vizinhas (12/2002 e 08/2003), só pra ordenação; "下旬" (fim do mês)
// vira dia 25. total: o "構成" oficial (inclui cartas que as fontes ainda não
// listam — o progresso x/total fica honesto). ranges: faixas de numeração
// novas de cada volume; buracos entre faixas são produtos especiais (starters,
// folhas de expansão) e caem no set "拡張・スペシャル".
const OFFICIAL_VOLUMES = [
  { vol: 1,  name: "巻ノ壱",                        date: "2002-12-01", total: 70, ranges: { "忍": [1, 24],    "術": [1, 24],    "作": [1, 22] } },
  { vol: 2,  name: "巻ノ弐 鬼人！再不斬編",         date: "2003-03-01", total: 57, ranges: { "忍": [25, 43],   "術": [25, 42],   "作": [23, 42] } },
  { vol: 3,  name: "巻ノ参 挑戦者集結！編",         date: "2003-06-01", total: 57, ranges: { "忍": [44, 60],   "術": [43, 60],   "作": [43, 60],   "依": [1, 4] } },
  { vol: 4,  name: "巻ノ四 死の森の試験！編",       date: "2003-08-08", total: 57, ranges: { "忍": [67, 84],   "術": [67, 84],   "作": [67, 84],   "依": [5, 7] } },
  { vol: 5,  name: "巻ノ五 実力伯仲！予選死闘編",   date: "2003-10-24", total: 78, ranges: { "忍": [85, 114],  "術": [85, 105],  "作": [85, 107],  "依": [8, 11] } },
  { vol: 6,  name: "巻ノ六 それぞれの試験！編",     date: "2004-01-25", total: 57, ranges: { "忍": [118, 135], "術": [109, 126], "作": [115, 132], "依": [12, 14] } },
  { vol: 7,  name: "巻ノ七 激突！中忍最終選抜戦編", date: "2004-04-16", total: 57, ranges: { "忍": [136, 153], "術": [127, 144], "作": [133, 150], "依": [15, 17] } },
  { vol: 8,  name: "巻ノ八 強襲！木ノ葉崩し編",     date: "2004-07-09", total: 71, ranges: { "忍": [154, 180], "術": [145, 168], "作": [151, 168], "依": [18, 19] } },
  { vol: 9,  name: "巻ノ九 暁の凶星編",             date: "2004-09-25", total: 57, ranges: { "忍": [186, 204], "術": [173, 191], "作": [174, 190], "依": [25, 26] } },
  { vol: 10, name: "巻ノ十 受け継ぎ託すもの編",     date: "2004-12-07", total: 80, ranges: { "忍": [205, 233], "術": [192, 211], "作": [191, 213], "依": [27, 29] } },
  { vol: 11, name: "巻ノ十一 結成！木ノ葉小隊編",   date: "2005-04-13", total: 57, ranges: { "忍": [234, 254], "術": [214, 231], "作": [220, 235], "依": [30, 31] } },
  { vol: 12, name: "巻ノ十二 戦慄の刻印編",         date: "2005-07-15", total: 73, ranges: { "忍": [255, 283], "術": [232, 254], "作": [236, 254], "依": [32, 33] } },
  { vol: 13, name: "巻ノ十三 両雄激突！終末の谷編", date: "2005-09-06", total: 58, ranges: { "忍": [288, 306], "術": [255, 275], "作": [255, 267], "依": [34, 36], "騎": [7, 8] } },
  { vol: 14, name: "巻ノ十四 豪華絢爛！忍大結集編", date: "2005-12-16", total: 57, ranges: { "忍": [325, 342], "術": [276, 295], "作": [268, 285], "依": [37, 37] } },
  { vol: 15, name: "巻ノ十五 若き日の伝説編",       date: "2006-03-17", total: 64, ranges: { "忍": [344, 367], "術": [305, 323], "作": [286, 304], "依": [38, 39] } },
  { vol: 16, name: "巻ノ十六 火の継承者 編",        date: "2006-06-09", total: 66, ranges: { "忍": [368, 392], "術": [324, 343], "作": [305, 322], "依": [40, 42] } },
  { vol: 17, name: "巻ノ十七 雄き獣の島編",         date: "2006-09-08", total: 57, ranges: { "忍": [397, 417], "術": [344, 361], "作": [323, 337], "依": [44, 46] } }
];
const PROMO_SET = "プロモーションカード";
const EXTRA_SET = "拡張・スペシャル";   // starters, folhas de expansão, boxes (fora das faixas dos volumes)
const UNKNOWN_SET = "※確認中";          // sobras que nenhuma faixa/fonte classifica

async function fetchText(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
      if (r.ok) return await r.text();
    } catch (e) { /* retry */ }
    await sleep(1200 * (i + 1));
  }
  return null;
}

// Páginas antigas em Shift-JIS: baixa os BYTES e decodifica na mão.
async function fetchSjis(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
      if (r.ok) return new TextDecoder("shift_jis").decode(await r.arrayBuffer());
    } catch (e) { /* retry */ }
    await sleep(1200 * (i + 1));
  }
  return null;
}

async function cached(name, getter) {
  const file = new URL(name, CACHE_DIR);
  try { return await readFile(file, "utf8"); } catch { /* sem cache */ }
  const text = await getter();
  if (text) { await mkdir(CACHE_DIR, { recursive: true }); await writeFile(file, text, "utf8"); }
  return text;
}

// ── Fonte 1: tcg-db.nikita.jp (igual à v1 deste script) ──────────────────────
function parseDbSetList(html) {
  const sets = [];
  const seen = new Set();
  const re = /<a href='\/cardlist\/nrt\/\?exp=([^'&]+)'>([^<]+?)\s*\((\d+)\s*枚\)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const exp = decodeURIComponent(m[1]);
    if (seen.has(exp)) continue;
    seen.add(exp);
    sets.push({ exp, name: m[2].trim(), official: Number(m[3]) || 0 });
  }
  return sets;
}

function parseDbCards(html) {
  const cards = [];
  const seen = new Set();
  const re = /<img src='\/img\/card\/nrt\/([^']+)\.jpg'[^>]*>[\s\S]{0,200}?<span style='font-weight:bold;font-size:120%;'>([^<]+?)[\s　]+<a href='\?name=[^']*'>([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const code = m[1].trim();
    if (code === "back" || seen.has(code)) continue;
    seen.add(code);
    cards.push({ code, num: m[2].trim(), name: m[3].trim() });
  }
  return cards;
}

async function refreshDbSnapshot(existing) {
  const listHtml = await cached("naruto-explist.html", () => fetchText(`${DB_BASE}/explist/nrt/`));
  if (!listHtml) { console.log("  tcg-db inacessível — segue com o snapshot versionado."); return existing; }
  const setDefs = parseDbSetList(listHtml);
  if (!setDefs.length) { console.log("  parser não achou sets no tcg-db — snapshot mantido."); return existing; }
  const sets = [];
  for (const def of setDefs) {
    const html = await fetchText(`${DB_BASE}/cardlist/nrt/?exp=${encodeURIComponent(def.exp)}`);
    const cards = html ? parseDbCards(html) : [];
    if (cards.length) sets.push({ name: def.name, official: def.official, cards });
    await sleep(700); // gentileza com o site de fã
  }
  const candidate = { source: `${DB_BASE}/explist/nrt/`, updatedAt: new Date().toISOString().slice(0, 10), sets };
  const newCount = snapshotCardCount(candidate);
  const oldCount = snapshotCardCount(existing);
  console.log(`  tcg-db: ${sets.length} sets, ${newCount} cartas (snapshot: ${oldCount}).`);
  if (newCount < oldCount) { console.log(`  ⚠ REGRESSÃO tcg-db (${newCount} < ${oldCount}) — snapshot mantido.`); return existing; }
  if (newCount !== oldCount) await writeSnapshot(SNAP_DB, candidate);
  return (await readSnapshot(SNAP_DB)) || candidate;
}

// ── Fonte 2: TV Tokyo (lista oficial dos vols. 1–13, Shift-JIS) ──────────────
// Cada carta na página: [<img cardimg/xNNN.jpg>] ... >忍-1< ... <font
// color="#666666">NOME</font>. Prefixos por extenso (作戦/依頼人) viram os
// curtos do jogo (作/依). Nem toda carta tem thumbnail.
const TVT_PREFIX = { "忍": "忍", "術": "術", "作戦": "作", "依頼人": "依", "騎": "騎" };

function parseTvtCards(html) {
  const numRe = />(忍|術|作戦|依頼人|騎)[-ー―−](\d+)</g;
  const hits = [];
  let m;
  while ((m = numRe.exec(html))) hits.push({ at: m.index, prefix: TVT_PREFIX[m[1]], n: Number(m[2]), end: numRe.lastIndex });
  const cards = [];
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    // imagem: a última cardimg ENTRE a carta anterior e esta (cada bloco tem no
    // máximo uma; carta sem thumb não acha nenhuma no seu trecho).
    const from = i > 0 ? hits[i - 1].end : 0;
    const seg = html.slice(from, h.at);
    const imgs = seg.match(/cardimg\/([a-z]+\d+\.jpg)/g);
    const img = imgs ? imgs[imgs.length - 1].replace("cardimg/", "") : "";
    // nome: primeiro <font cinza> depois do número
    const tail = html.slice(h.end, h.end + 500);
    const nm = tail.match(/<font color="#666666">([^<]+)<\/font>/);
    const name = nm ? nm[1].trim() : "";
    if (!name) continue;
    cards.push({ num: `${h.prefix}-${h.n}`, name, img });
  }
  return cards;
}

async function refreshTvtSnapshot(existing) {
  const vols = [];
  let missed = 0;
  for (let v = 1; v <= 13; v++) {
    const nn = String(v).padStart(2, "0");
    const html = await cached(`naruto-tvtokyo-${nn}.html`, () => fetchSjis(`${TVT_BASE}/card_${nn}.html`));
    if (!html) { missed++; continue; }
    const cards = parseTvtCards(html);
    if (cards.length) vols.push({ vol: v, cards });
    await sleep(400);
  }
  if (missed && !vols.length) { console.log("  TV Tokyo inacessível — segue com o snapshot versionado."); return existing; }
  const candidate = { source: `${TVT_BASE}/card_01.html`, updatedAt: new Date().toISOString().slice(0, 10), sets: vols.map((v) => ({ name: `vol${v.vol}`, vol: v.vol, cards: v.cards })) };
  const newCount = snapshotCardCount(candidate);
  const oldCount = snapshotCardCount(existing);
  console.log(`  TV Tokyo: ${vols.length} volumes, ${newCount} cartas (snapshot: ${oldCount}).`);
  if (newCount < oldCount) { console.log(`  ⚠ REGRESSÃO TV Tokyo (${newCount} < ${oldCount}) — snapshot mantido.`); return existing; }
  if (newCount !== oldCount) await writeSnapshot(SNAP_TVT, candidate);
  return (await readSnapshot(SNAP_TVT)) || candidate;
}

// ── Classificação e build ─────────────────────────────────────────────────────
function classifyByRange(num) {
  const m = String(num).match(/^(忍|術|作|依|騎)-(\d+)$/);
  if (!m) return null;
  const [, prefix, nRaw] = m;
  const n = Number(nRaw);
  for (const v of OFFICIAL_VOLUMES) {
    const r = v.ranges[prefix];
    if (r && n >= r[0] && n <= r[1]) return v;
  }
  return null;
}

const IMG_DB = (code) => `https://wsrv.nl/?url=${encodeURIComponent(`tcg-db.nikita.jp/img/card/nrt/${code}.jpg`)}&w=440&output=webp`;
// Thumbs da TV Tokyo são pequenas: &we (without enlargement) evita esticar.
const IMG_TVT = (file) => `https://wsrv.nl/?url=${encodeURIComponent(`www.tv-tokyo.co.jp/anime/naruto2002/goods/cardimg/${file}`)}&w=440&we&output=webp`;

// Id ASCII estável pra carta sem scan do tcg-db: nrt-nin-19, nrt-jutsu-30...
// Promos seguem o padrão dos códigos do tcg-db (PRN-006 = PR忍-6), com pad 3,
// pra um scan futuro cair no MESMO id (e o id pegajoso segurar de qualquer jeito).
const NUM_SLUG = { "忍": "nin", "術": "jutsu", "作": "saku", "依": "irai", "騎": "ki" };
const PR_SLUG = { "忍": "PRN", "術": "PRJ", "作": "PRS", "依": "PRI", "騎士": "PRK" };
function numId(num) {
  const pr = String(num).match(/^PR(忍|術|作|依|騎士)-(\d+)$/);
  if (pr) return `nrt-${PR_SLUG[pr[1]]}-${String(pr[2]).padStart(3, "0")}`;
  const op = String(num).match(/^OP忍-?(\d+)$/);
  if (op) return `nrt-OPN-${String(op[1]).padStart(3, "0")}`;
  const m = String(num).match(/^(忍|術|作|依|騎)-(\d+)$/);
  return m ? `nrt-${NUM_SLUG[m[1]]}-${m[2]}` : `nrt-x-${encodeURIComponent(num)}`;
}

async function run() {
  console.log("NARUTO カードゲーム (Bandai 2002–2006, vintage)");
  let snapDb = await readSnapshot(SNAP_DB);
  let snapTvt = await readSnapshot(SNAP_TVT);
  if (!NO_FETCH) {
    snapDb = await refreshDbSnapshot(snapDb);
    snapTvt = await refreshTvtSnapshot(snapTvt);
  }
  if (!snapDb && !snapTvt) { console.log("  sem snapshot algum — nada a construir."); return; }

  // União por NÚMERO oficial. tcg-db manda no nome/scan quando tem a carta;
  // TV Tokyo completa o resto (nome oficial + thumb).
  const byNum = new Map(); // num -> { num, name, code (scan tcg-db), img (thumb tvt), dbSet, tvtVol }
  for (const s of (snapDb && snapDb.sets) || []) {
    for (const c of s.cards || []) {
      const cur = byNum.get(c.num);
      // O tcg-db tem 2+ scans pro mesmo número (re-impressões: N-001 e N-001_2).
      // É a MESMA carta física: fica um registro só, com o scan de código base
      // (sem sufixo _N) — o id nrt-<código> derivado dele é o estável.
      if (!cur) byNum.set(c.num, { num: c.num, name: c.name, code: c.code, img: "", dbSet: s.name });
      else if (cur.code.includes("_") && !c.code.includes("_")) { cur.code = c.code; cur.name = c.name; }
    }
  }
  for (const s of (snapTvt && snapTvt.sets) || []) {
    for (const c of s.cards || []) {
      const cur = byNum.get(c.num);
      if (cur) { if (!cur.img && c.img) cur.img = c.img; if (cur.tvtVol == null) cur.tvtVol = s.vol; }
      else byNum.set(c.num, { num: c.num, name: c.name, code: "", img: c.img, dbSet: "", tvtVol: s.vol });
    }
  }

  // Promos curadas: só COMPLETAM (número que nenhuma fonte tem). Nunca tocam
  // numa carta que já veio com scan — o snapshot/tcg-db sempre manda.
  try {
    const curated = JSON.parse(await readFile(CURATED_PROMOS, "utf8"));
    let added = 0;
    for (const c of curated.cards || []) {
      if (byNum.has(c.num)) { if (c.rarity && !byNum.get(c.num).rarity) byNum.get(c.num).rarity = c.rarity; continue; }
      byNum.set(c.num, { num: c.num, name: c.name, code: "", img: "", dbSet: PROMO_SET, rarity: c.rarity || "" });
      added += 1;
    }
    console.log(`  promos curadas: +${added} sem scan (de ${curated.cards.length} confirmadas).`);
  } catch (e) { console.log("  promos curadas: arquivo ausente/inválido — seguindo sem."); }

  // Ids pegajosos: número -> id já publicado no catálogo atual.
  const existing = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const idByNum = new Map();
  // Primeiro vence: no catálogo os sets oficiais vêm antes dos grupos de
  // sobras, então o id base (nrt-N-001) ganha do scan repetido (nrt-N-001_2).
  for (const c of existing) {
    if (String(c.id).startsWith("nrt-") && c.number && !idByNum.has(c.number)) idByNum.set(c.number, c.id);
  }

  // Set de cada carta: lista da TV Tokyo (oficial, vols. 1–13) > faixas de
  // numeração (vols. 14–17 e reclassificação dos "※確認中" do tcg-db) >
  // promo do tcg-db > extras (produtos especiais) > desconhecido.
  const volByNo = new Map(OFFICIAL_VOLUMES.map((v) => [v.vol, v]));
  const setsOut = new Map(); // setName -> { meta, cards: [] }
  for (const card of byNum.values()) {
    const vol = card.tvtVol != null ? volByNo.get(card.tvtVol) : classifyByRange(card.num);
    let setName, meta;
    if (vol) { setName = vol.name; meta = vol; }
    else if (/^(PR|OP忍)/.test(card.num) || card.dbSet === PROMO_SET) { setName = PROMO_SET; meta = null; }
    else if (/^(忍|術|作|依|騎|K|COIN)/.test(card.num)) { setName = EXTRA_SET; meta = null; }
    else { setName = UNKNOWN_SET; meta = null; }
    if (!setsOut.has(setName)) setsOut.set(setName, { meta, cards: [] });
    setsOut.get(setName).cards.push(card);
  }

  // Ordem dos sets: volumes 1..17, depois promo, extras e o resto.
  const orderedNames = [
    ...OFFICIAL_VOLUMES.map((v) => v.name).filter((n) => setsOut.has(n)),
    ...[PROMO_SET, EXTRA_SET, UNKNOWN_SET].filter((n) => setsOut.has(n)),
    ...Array.from(setsOut.keys()).filter((n) => !OFFICIAL_VOLUMES.some((v) => v.name === n) && ![PROMO_SET, EXTRA_SET, UNKNOWN_SET].includes(n))
  ];

  const cardsNrt = [];
  orderedNames.forEach((setName, i) => {
    const { meta, cards } = setsOut.get(setName);
    const setId = meta ? `nrt-s${String(meta.vol).padStart(2, "0")}` : (setName === PROMO_SET ? "nrt-promo" : setName === EXTRA_SET ? "nrt-extra" : `nrt-unk${i}`);
    const cmp = (a, b) => String(a.num).localeCompare(String(b.num), "ja", { numeric: true });
    for (const c of cards.sort(cmp)) {
      cardsNrt.push({
        id: idByNum.get(c.num) || (c.code ? `nrt-${c.code}` : numId(c.num)),
        name: c.name,
        set: setName,
        setId,
        number: c.num,
        setTotal: meta ? meta.total : cards.length,
        setReleaseDate: meta ? meta.date : "",
        rarity: c.rarity || "",
        artist: "",
        language: "ja",
        image: c.code ? IMG_DB(c.code) : (c.img ? IMG_TVT(c.img) : ""),
        variants: ["Normal"],
        setLogo: "/assets/games/game_naruto.webp",
        vintage: true,
        vintageLine: "nrtcg"
      });
    }
  });
  const withScan = cardsNrt.filter((c) => c.image.includes("tcg-db")).length;
  const withThumb = cardsNrt.filter((c) => c.image.includes("tv-tokyo")).length;
  console.log(`  build: ${cardsNrt.length} cartas em ${orderedNames.length} sets (${withScan} scans tcg-db, ${withThumb} thumbs TV Tokyo, ${cardsNrt.length - withScan - withThumb} sem imagem).`);

  // Anexa: mantém o que NÃO é desta linha (ids nrt-*) — ex.: um futuro moderno
  // da TCGCSV — e regrava a linha vintage inteira.
  const kept = existing.filter((c) => c && !String(c.id).startsWith("nrt-"));
  const have = new Set(kept.map((c) => c.id));
  const merged = kept.concat(cardsNrt.filter((c) => !have.has(c.id)));
  const pricing = (await readGlobalVar(new URL("pricing.js", OUT), "TCG_PRICING")) || {}; // vintage sem preço

  await writeGameCatalog(OUT, { cards: merged, pricing, webDir: "data/naruto/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} — ${merged.length} cartas totais.`);
}

await run();
