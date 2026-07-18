// ミラクルバトルカードダス (Miracle Battle Carddass, Bandai 2009–2015): jogo
// crossover da Shonen Jump. Importamos as séries licenciadas que têm jogo no
// Sleevu, como LINHA VINTAGE dentro do jogo-pai (igual Carddass/OP-2002 no
// One Piece):
//
//   OPS/OP/OPC (ONE PIECE, 2010–2014)      -> data/onepiece/  ids op-mb-*
//   NRS/NR (NARUTO 疾風伝, 2012–2014)      -> data/naruto/    ids nrt-mb-*
//
// Fonte: tcg-db.nikita.jp (mesmo DB de fã do Naruto vintage) — /cardlist/mb/
// devolve TODAS as cartas numa página, com o código de set embutido no caminho
// do scan (OP01/23.jpg). O snapshot versionado guarda o jogo INTEIRO (inclui
// Dragon Ball, Toriko etc.) — se o JUMP sair do "Em breve", os Jヒーロー (AS/JS)
// já estarão aqui. Padrão-snapshot: build parte do snapshot; fetch só atualiza
// quando responde e não regride.
//
//   node scripts/sync-miracle-battle.mjs             # fetch (se der) + build
//   node scripts/sync-miracle-battle.mjs --no-fetch  # só build do snapshot
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog, sleep } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const SNAP = new URL("data/vintage/miracle-battle.json", ROOT);
const DB_BASE = "https://tcg-db.nikita.jp";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
const NO_FETCH = process.argv.includes("--no-fetch");

// Séries importadas: prefixo de código de set -> jogo-pai do Sleevu.
// (Prefixos mais longos primeiro: "OPS" antes de "OP", "NRS" antes de "NR".)
const LINES = [
  { match: /^(OPS|OPC|OP)\d*$/, game: "onepiece", idPrefix: "op-mb", strip: /^ONEPIECE\s*/, logo: "/assets/games/game_onepiece_miracle.webp" },
  { match: /^(NRS|NR)\d*$/, game: "naruto", idPrefix: "nrt-mb", strip: /^ナルト疾風伝\s*/, logo: "/assets/games/game_naruto_miracle.webp" }
];

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

// Imagem CURADA do dono: assets/cards/<game>/<id>.(webp|jpg|png) substitui o
// scan/placeholder (mesmo mecanismo dos outros syncs do Naruto).
function curatedImg(game, id) {
  for (const ext of ["webp", "jpg", "png"]) {
    if (existsSync(fileURLToPath(new URL(`assets/cards/${game}/${id}.${ext}`, ROOT)))) {
      return `/assets/cards/${game}/${id}.${ext}`;
    }
  }
  return null;
}

const IMG = (scan) => `https://wsrv.nl/?url=${encodeURIComponent(`tcg-db.nikita.jp/img/card/mb/${scan}.jpg`)}&w=440&output=webp`;

async function appendToGame(game, sets, idPrefix, stripRe, logo) {
  const outDir = new URL(`data/${game}/`, ROOT);
  const line = [];
  for (const s of sets) {
    const setId = `${idPrefix}-${s.code.toLowerCase()}`;
    const setName = `Miracle Battle ${s.code} — ${s.name.replace(stripRe, "").trim()}`;
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
      const cardId = `${idPrefix}-${s.code.toLowerCase()}-${numSlug}`;
      line.push({
        id: cardId,
        name: c.name,
        set: setName,
        setId,
        number: c.num,
        setTotal: s.cards.length,
        setReleaseDate: "",
        rarity: "",
        artist: "",
        language: "ja",
        image: curatedImg(game, cardId) || (c.scan ? IMG(c.scan) : ""),
        variants: ["Normal"],
        setLogo: logo || "",
        vintage: true,
        vintageLine: "mb"
      });
    }
  }
  const existing = (await readGlobalVar(new URL("cards.js", outDir), "TCG_CARDS")) || [];
  const kept = existing.filter((c) => c && !String(c.id).startsWith(`${idPrefix}-`));
  const have = new Set(kept.map((c) => c.id));
  const merged = kept.concat(line.filter((c) => !have.has(c.id)));
  const pricing = (await readGlobalVar(new URL("pricing.js", outDir), "TCG_PRICING")) || {};
  await writeGameCatalog(outDir, { cards: merged, pricing, webDir: `data/${game}/` });
  console.log(`  ${game}: +${line.length} cartas Miracle Battle (${sets.length} sets) -> ${merged.length} totais em ${fileURLToPath(outDir)}`);
}

async function run() {
  console.log("Miracle Battle Carddass (Bandai 2009–2015, vintage)");
  let snap = await readSnapshot(SNAP);
  if (!NO_FETCH) snap = await refreshSnapshot(snap);
  if (!snap || !snapshotCardCount(snap)) { console.log("  snapshot vazio — nada a construir."); return; }

  for (const lineDef of LINES) {
    const sets = snap.sets.filter((s) => lineDef.match.test(s.code));
    if (sets.length) await appendToGame(lineDef.game, sets, lineDef.idPrefix, lineDef.strip, lineDef.logo);
  }
}

await run();
