// ミラクルバトルカードダス (Miracle Battle Carddass, Bandai 2009–2015): o jogo
// crossover da Shonen Jump, jogo VINTAGE próprio do Sleevu (slug `mbc`, em
// data/mbc/). Cada franquia é uma SÉRIE do jogo, e a página de Sets mostra uma
// seção por série (groupMbcSets no app.js), como as eras do Pokémon.
//
// Até 2026-10-01 só três séries entravam, cada uma como linha vintage dentro
// do jogo da marca (op-mb no One Piece, nrt-mb no Naruto, hxh-mb no HxH), e as
// outras esperavam um "jogo-pai" no snapshot. O Fernando juntou as três num
// jogo só e pediu as sete: as cartas são do MESMO jogo (um deck mistura
// Luffy, Goku e Gon), não do jogo de cada marca. A migração de quem já tinha
// carta marcada no jogo da marca está no shared.js (moveMiracleBattle).
//
//   série              códigos         ids (os antigos ficam como eram)
//   Dragon Ball Kai    DBS/DB          mb-db01-12
//   One Piece          OPS/OP/OPC      op-mb-op01-23
//   Toriko             TR              mb-tr01-5
//   Hunter × Hunter    HHS/HH/HHEX     hxh-mb-hh01-3
//   Naruto Shippuden   NRS/NR          nrt-mb-nr01-7
//   J-Heroes           DAS/AS/JS       mb-as01-10
//   Kuroko's Basketball KB             mb-kb01-1
//
// O id é a ponte entre a coleção de alguém e a carta, então as séries que já
// estavam no ar mantêm o prefixo da marca (op-mb-, nrt-mb-, hxh-mb-); as que
// chegam agora usam `mb-`. Os dois formatos são do jogo mbc.
//
// Fonte: tcg-db.nikita.jp (mesmo DB de fã do Naruto vintage) — /cardlist/mb/
// devolve TODAS as cartas numa página, com o código de set embutido no caminho
// do scan (OP01/23.jpg). O snapshot versionado guarda o jogo inteiro.
// Padrão-snapshot: build parte do snapshot; fetch só atualiza quando responde
// e não regride.
//
//   node scripts/sync-miracle-battle.mjs             # fetch (se der) + build
//   node scripts/sync-miracle-battle.mjs --no-fetch  # só build do snapshot
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog, sleep } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const SNAP = new URL("data/vintage/miracle-battle.json", ROOT);
const DB_BASE = "https://tcg-db.nikita.jp";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
const NO_FETCH = process.argv.includes("--no-fetch");
const GAME = "mbc";
const LOGO = "/assets/games/game_mbc.webp";

// Séries: código de set -> prefixo de id e o que tirar do nome do set (a
// franquia, que o nome em inglês e a seção já dizem). Prefixos mais longos
// primeiro: "OPS" antes de "OP", "DBS" antes de "DB". `legado` é o jogo da
// marca onde a série morava até 2026-10-01 (o sync a tira de lá).
export const SERIES = [
  { key: "db", match: /^(DBS|DB)\d*$/, idPrefix: "mb", strip: /^ドラゴンボール改\s*/ },
  { key: "op", match: /^(OPS|OPC|OP)\d*$/, idPrefix: "op-mb", strip: /^ONEPIECE\s*/, legado: "onepiece" },
  { key: "tr", match: /^TR\d*$/, idPrefix: "mb", strip: /^トリコ\s*/ },
  { key: "hh", match: /^(HHS|HHEX|HH)\d*$/, idPrefix: "hxh-mb", strip: /^HUNTER×HUNTER\s*/, legado: "hxh" },
  { key: "nr", match: /^(NRS|NR)\d*$/, idPrefix: "nrt-mb", strip: /^ナルト疾風伝\s*/, legado: "naruto" },
  { key: "jh", match: /^(DAS|AS|JS)\d*$/, idPrefix: "mb", strip: null },
  { key: "kb", match: /^KB\d*$/, idPrefix: "mb", strip: /^黒子のバスケ\s*/ }
];
export function seriesOf(code) {
  return SERIES.find((s) => s.match.test(String(code || ""))) || null;
}

async function fetchText(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.text();
    } catch (e) { /* retry */ }
    await sleep(1200 * (i + 1));
  }
  return null;
}

// explist: nomes/contagem por set — "【OP01】ONEPIECE ブースターパック 第1弾 (23 枚)".
function parseSetList(html) {
  const sets = new Map(); // code -> { code, name, official }
  const re = /<a href='\/cardlist\/mb\/\?exp=[^']+'>【([^】]+)】([^<]+?)\s*\((\d+)\s*枚\)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const code = m[1].trim();
    if (!sets.has(code)) sets.set(code, { code, name: m[2].trim(), official: Number(m[3]) || 0 });
  }
  return sets;
}

// cardlist inteiro: scan "OP01/23" (código do set / número local) + nome.
function parseCards(html) {
  const cards = [];
  const seen = new Set();
  const re = /<img src='\/img\/card\/mb\/([^']+)\.jpg'[^>]*>[\s\S]{0,200}?<span style='font-weight:bold;font-size:120%;'>([^<]+?)[\s　]+<a href='\?name=[^']*'>([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const scan = m[1].trim();
    if (scan === "back" || seen.has(scan)) continue;
    seen.add(scan);
    const slash = scan.indexOf("/");
    const setCode = slash > 0 ? scan.slice(0, slash) : "";
    if (!setCode) continue;
    cards.push({ scan, setCode, num: m[2].trim(), name: m[3].trim() });
  }
  return cards;
}

async function refreshSnapshot(existing) {
  const [listHtml, cardsHtml] = [
    await fetchText(`${DB_BASE}/explist/mb/`),
    await fetchText(`${DB_BASE}/cardlist/mb/`)
  ];
  if (!listHtml || !cardsHtml) { console.log("  tcg-db inacessível — segue com o snapshot versionado."); return existing; }
  const defs = parseSetList(listHtml);
  const all = parseCards(cardsHtml);
  if (!all.length) { console.log("  parser não achou cartas — snapshot mantido."); return existing; }

  const byCode = new Map();
  for (const c of all) {
    if (!byCode.has(c.setCode)) byCode.set(c.setCode, []);
    byCode.get(c.setCode).push({ scan: c.scan, num: c.num, name: c.name });
  }
  // Ordem do explist (starters -> boosters -> promos, por franquia); códigos que
  // só aparecem nos scans (sem entrada no explist) vão pro fim.
  const codes = [...defs.keys()].filter((c) => byCode.has(c)).concat([...byCode.keys()].filter((c) => !defs.has(c)));
  const sets = codes.map((code) => ({
    code,
    name: defs.has(code) ? defs.get(code).name : code,
    official: defs.has(code) ? defs.get(code).official : byCode.get(code).length,
    cards: byCode.get(code)
  }));
  const candidate = { source: `${DB_BASE}/cardlist/mb/`, updatedAt: new Date().toISOString().slice(0, 10), sets };
  const newCount = snapshotCardCount(candidate);
  const oldCount = snapshotCardCount(existing);
  console.log(`  tcg-db mb: ${sets.length} sets, ${newCount} cartas (snapshot: ${oldCount}).`);
  if (newCount < oldCount) { console.log(`  ⚠ REGRESSÃO (${newCount} < ${oldCount}) — snapshot mantido.`); return existing; }
  if (newCount !== oldCount) await writeSnapshot(SNAP, candidate);
  return (await readSnapshot(SNAP)) || candidate;
}

// Imagem CURADA do dono: assets/cards/mbc/<id>.(webp|jpg|png) substitui o
// scan/placeholder (mesmo mecanismo dos syncs do Naruto).
function curatedImg(id) {
  for (const ext of ["webp", "jpg", "png"]) {
    if (existsSync(fileURLToPath(new URL(`assets/cards/${GAME}/${id}.${ext}`, ROOT)))) {
      return `/assets/cards/${GAME}/${id}.${ext}`;
    }
  }
  return null;
}

const IMG = (scan) => `https://wsrv.nl/?url=${encodeURIComponent(`tcg-db.nikita.jp/img/card/mb/${scan}.jpg`)}&w=440&output=webp`;

// Nome do set no catálogo: "Miracle Battle <código> — <nome japonês sem a
// franquia>". É a CHAVE do set (link, lista, slug do endereço), então os sets
// que já estavam no ar seguem com o nome de sempre; o nome em inglês é só de
// exibição (VINTAGE_SET_EN em src/nomes-sets.js).
export function setNameOf(set, serie) {
  const nome = serie.strip ? set.name.replace(serie.strip, "") : set.name;
  return `Miracle Battle ${set.code} — ${nome.trim()}`;
}

// As cartas do jogo a partir do snapshot. `nomesEn` é o mapa japonês -> inglês
// dos nomes de Naruto (scripts/data/naruto-names-en.json): até 2026-10-01 o
// translate-naruto-names.mjs traduzia estas cartas dentro do catálogo do
// Naruto; aqui a tradução vem junto, no mesmo formato (original no `nameJp`).
export function buildCards(snap, { nomesEn = {}, imagemCurada = () => null } = {}) {
  const cards = [];
  for (const s of snap.sets || []) {
    const serie = seriesOf(s.code);
    if (!serie) continue;
    const code = s.code.toLowerCase();
    const setId = `${serie.idPrefix}-${code}`;
    const setName = setNameOf(s, serie);
    // 2+ scans pro mesmo número (re-impressão, ex.: OP01/86 e OP01/86_2) é a
    // MESMA carta física: fica um registro, com o scan de código base.
    const byNum = new Map();
    for (const c of s.cards) {
      const cur = byNum.get(c.num);
      if (!cur || (cur.scan.includes("_") && !c.scan.includes("_"))) byNum.set(c.num, c);
    }
    for (const c of byNum.values()) {
      // Id pelo NÚMERO oficial (não pelo arquivo do scan): estável mesmo que o
      // tcg-db troque/adicione scans (_2) depois.
      const numSlug = String(c.num).toLowerCase().replace(/[\s/]+/g, "-");
      const cardId = `${setId}-${numSlug}`;
      const en = serie.key === "nr" ? nomesEn[c.name] : "";
      cards.push({
        id: cardId,
        name: en || c.name,
        set: setName,
        setId,
        number: c.num,
        setTotal: s.cards.length,
        setReleaseDate: "",
        rarity: "",
        artist: "",
        language: "ja",
        image: imagemCurada(cardId) || (c.scan ? IMG(c.scan) : ""),
        variants: ["Normal"],
        setLogo: LOGO,
        vintage: true,
        vintageLine: serie.key,
        ...(en ? { nameJp: c.name } : {})
      });
    }
  }
  return cards;
}

async function run() {
  console.log("Miracle Battle Carddass (Bandai 2009–2015, vintage)");
  let snap = await readSnapshot(SNAP);
  if (!NO_FETCH) snap = await refreshSnapshot(snap);
  if (!snap || !snapshotCardCount(snap)) { console.log("  snapshot vazio — nada a construir."); return; }

  let nomesEn = {};
  try { nomesEn = JSON.parse(readFileSync(new URL("scripts/data/naruto-names-en.json", ROOT), "utf8")); } catch (e) { /* sem mapa: nomes originais */ }
  const line = buildCards(snap, { nomesEn, imagemCurada: curatedImg });
  const outDir = new URL(`data/${GAME}/`, ROOT);
  // O catálogo é só deste sync; mas carta publicada nunca some (alguém pode
  // tê-la na coleção), mesmo que a fonte a perca.
  const have = new Set(line.map((c) => c.id));
  const existing = (await readGlobalVar(new URL("cards.js", outDir), "TCG_CARDS")) || [];
  const merged = line.concat(existing.filter((c) => c && c.id && !have.has(c.id)));
  const pricing = (await readGlobalVar(new URL("pricing.js", outDir), "TCG_PRICING")) || {};
  await writeGameCatalog(outDir, { cards: merged, pricing, webDir: `data/${GAME}/` });
  console.log(`  ${GAME}: ${line.length} cartas (${(snap.sets || []).filter((s) => seriesOf(s.code)).length} sets) -> ${merged.length} totais`);

  // As séries que moravam no jogo da marca saem de lá (uma carta não pode
  // estar em dois catálogos: a coleção dela é de um jogo só).
  for (const serie of SERIES.filter((s) => s.legado)) {
    const dir = new URL(`data/${serie.legado}/`, ROOT);
    const cards = await readGlobalVar(new URL("cards.js", dir), "TCG_CARDS");
    if (!Array.isArray(cards)) continue;
    const ficam = cards.filter((c) => !(c && String(c.id).startsWith(`${serie.idPrefix}-`)));
    if (ficam.length === cards.length) continue;
    const precos = (await readGlobalVar(new URL("pricing.js", dir), "TCG_PRICING")) || {};
    await writeGameCatalog(dir, { cards: ficam, pricing: precos, webDir: `data/${serie.legado}/` });
    console.log(`  ${serie.legado}: −${cards.length - ficam.length} cartas ${serie.idPrefix}-* (foram pro ${GAME})`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
