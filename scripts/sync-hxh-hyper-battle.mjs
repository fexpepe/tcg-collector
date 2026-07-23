// HUNTER×HUNTER カードダスハイパーバトル (Carddass Hyper Battle, Bandai
// dez/1999–ago/2001): a LINHA PRINCIPAL do jogo hxh — 6 partes + promos de
// Jump Festa + as cartas que vieram com o jogo de Game Boy.
//
// Fonte: Hunterpedia (Fandom), via API MediaWiki — o mesmo tipo de fonte que o
// sync do Lorcana usa pros logos. A wiki é a ÚNICA que tem scan carta a carta
// desta linha (o tcg-db declara a パート5 com 0 cartas; Suruga-ya e Mandarake
// bloqueiam acesso automatizado). De cada arquivo tiramos:
//
//   nome do arquivo -> parte + código da carta   (hyper_battle_part_3_card_c61)
//   categorias      -> raridade                  (Regular / Holo / Secret Holo)
//   fileusage       -> PERSONAGEM da carta       (galerias "<Nome>/Image Gallery")
//
// ATENÇÃO ao `name`: é o personagem retratado, NÃO o título impresso em japonês
// (que nenhuma fonte pública lista). É o que identifica a carta pro colecionador
// — quem procura "Gon" acha —, e o número oficial (C02, S07…) continua sendo a
// chave. Se um dia aparecer a lista de títulos, o `name` melhora sem quebrar id.
//
//   node scripts/sync-hxh-hyper-battle.mjs             # fetch (se der) + build
//   node scripts/sync-hxh-hyper-battle.mjs --no-fetch  # só build do snapshot
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog, sleep } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const SNAP = new URL("data/vintage/hxh-hyper-battle.json", ROOT);
const API = "https://hunterxhunter.fandom.com/api.php";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
const NO_FETCH = process.argv.includes("--no-fetch");
const GAME = "hxh";
const ID_PREFIX = "hxh-hb";
const LOGO = "/assets/games/game_hxh.webp";

// Sets da linha, na ordem de lançamento. `code` entra no id (hxh-hb-p1-c02).
// Nomes JP/EN e datas: Hunterpedia + embalagens.
const SETS = [
  { code: "p1", name: "パート1 ハンター試験編", en: "Part 1 — Hunter Exam", date: "1999-12-01" },
  { code: "p2", name: "パート2 終了!×合格?×ハンター試験編", en: "Part 2 — Finished! × Passed? × Hunter Exam", date: "2000-03-01" },
  { code: "p3", name: "パート3 纏×絶×練×発×念SPECIAL編", en: "Part 3 — Ten × Zetsu × Ren × Hatsu × Nen Special", date: "2000-07-01" },
  { code: "p4", name: "パート4 競売?×暗躍×幻影旅団登場!!!編", en: "Part 4 — Auction? × Secret Maneuvers × Phantom Troupe!!!", date: "2001-01-15" },
  { code: "p5", name: "パート5 ヨークシン×幻影旅団×鎮魂曲", en: "Part 5 — Yorknew × Phantom Troupe × Requiem", date: "2001-05-15" },
  { code: "p6", name: "パート6 9月4日×G・I×発修行", en: "Part 6 — September 4th × G・I × Hatsu Training", date: "2001-08-25" },
  { code: "gb", name: "ゲームボーイ ハンターの系譜 特典", en: "Game Boy — Hunter's Genealogy bonus", date: "2000-06-15" },
  { code: "jf00", name: "ジャンプフェスタ2000 限定カード", en: "Jump Festa 2000 limited card", date: "1999-12-18" },
  { code: "jf01", name: "ジャンプフェスタ2001エディション パック", en: "Jump Festa 2001 Edition pack", date: "2000-12-16" },
  { code: "jf02", name: "ジャンプフェスタ2002エディション パック", en: "Jump Festa 2002 Edition pack", date: "2001-12-22" }
];
const SET_BY_CODE = new Map(SETS.map((s) => [s.code, s]));

// Tipo da carta pelo prefixo do código oficial (a wiki usa a mesma letra).
const TYPE_LABEL = { c: "Character", s: "Hunter", e: "Event", h: "Licence", n: "Ability" };

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: "json", ...params })}`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.json();
    } catch (e) { /* retry */ }
    await sleep(1000 * (i + 1));
  }
  return null;
}

// Todos os arquivos da wiki cujo nome começa com "Hyper battle" (a API é
// case-sensitive no prefixo, mas os arquivos seguem esse padrão).
async function fetchImages() {
  const out = [];
  let cont = null;
  for (let i = 0; i < 20; i++) {
    const j = await api({ action: "query", list: "allimages", aiprefix: "Hyper", ailimit: "500", ...(cont ? { aicontinue: cont } : {}) });
    if (!j) return out.length ? out : null;
    out.push(...(j.query?.allimages || []).map((x) => ({ name: x.name, url: x.url })));
    cont = j.continue?.aicontinue;
    if (!cont) break;
  }
  return out;
}

// nome do arquivo -> { setCode, num, type }. Cobre os 3 padrões da wiki.
function parseFile(name) {
  const f = name.replace(/\.(png|jpg|jpeg|webp)$/i, "").replace(/_/g, " ").toLowerCase();
  let m = f.match(/^hyper battle part (\d) card ([csenh])(\d+(?:-\d+)?)$/);
  if (m) return { setCode: `p${m[1]}`, type: m[2], num: `${m[2].toUpperCase()}${m[3].toUpperCase()}` };
  m = f.match(/^hyper battle jump festa (\d{4})(?: gon)? card ([cs])-j(\d+)$/);
  if (m) return { setCode: `jf${m[1].slice(2)}`, type: m[2], num: `${m[2].toUpperCase()}-J${m[3]}` };
  m = f.match(/^hyper battle game boy card ([cs])-k(\d+)$/);
  if (m) return { setCode: "gb", type: m[1], num: `${m[1].toUpperCase()}-K${m[2]}` };
  return null; // embalagem, box etc.
}

// categoria da wiki -> raridade exibida. Promos (Jump Festa, Game Boy) não têm
// categoria de raridade na wiki: entram como "Promo", que é o que elas são.
const PROMO_SETS = new Set(["gb", "jf00", "jf01", "jf02"]);
function rarityOf(cats, setCode) {
  const has = (s) => cats.some((c) => c.toLowerCase().includes(s));
  if (has("secret holo")) return "Secret Holo";
  if (has("holo")) return "Holo";
  if (has("regular")) return "Normal";
  return PROMO_SETS.has(setCode) ? "Promo" : "";
}

// páginas que EMBUTEM o scan -> personagem(ns) da carta. As galerias de
// personagem são "<Nome>/Image Gallery[/…]"; ignoramos as páginas-índice.
const SKIP_PAGE = /^(Hunter × Hunter Alphabet|Hunter × Hunter Carddass Collections)/;
function charactersOf(usage) {
  const names = [];
  for (const title of usage) {
    const m = String(title).match(/^(.+?)\/Image Gallery/);
    if (!m) continue;
    const who = m[1].trim();
    if (SKIP_PAGE.test(who) || names.includes(who)) continue;
    names.push(who);
  }
  return names;
}

async function refreshSnapshot(existing) {
  const imgs = await fetchImages();
  if (!imgs) { console.log("  Hunterpedia inacessível — segue com o snapshot versionado."); return existing; }
  const cards = [];
  const wanted = [];
  for (const img of imgs) {
    const p = parseFile(img.name);
    if (p && SET_BY_CODE.has(p.setCode)) wanted.push({ img, p });
  }
  if (!wanted.length) { console.log("  parser não achou cartas — snapshot mantido."); return existing; }

  // Categorias (raridade) + fileusage (personagem) em lote: 50 títulos por chamada.
  const meta = new Map();
  for (let i = 0; i < wanted.length; i += 50) {
    const batch = wanted.slice(i, i + 50);
    const j = await api({
      action: "query", prop: "categories|fileusage", cllimit: "500", fulimit: "500",
      titles: batch.map((w) => `File:${w.img.name.replace(/_/g, " ")}`).join("|")
    });
    for (const page of Object.values(j?.query?.pages || {})) {
      if (!page.title) continue;
      meta.set(page.title.replace(/^File:/, "").replace(/ /g, "_"), {
        cats: (page.categories || []).map((c) => String(c.title).replace(/^Category:/, "")),
        usage: (page.fileusage || []).map((u) => u.title)
      });
    }
    await sleep(250);
  }

  for (const { img, p } of wanted) {
    const m = meta.get(img.name) || { cats: [], usage: [] };
    const chars = charactersOf(m.usage);
    cards.push({
      set: p.setCode,
      num: p.num,
      type: TYPE_LABEL[p.type] || "",
      rarity: rarityOf(m.cats, p.setCode),
      chars,
      file: img.name,
      // URL do arquivo sem o ?cb= (o parâmetro muda a cada re-upload e sujaria o diff)
      img: String(img.url).split("/revision/")[0]
    });
  }
  const order = new Map(SETS.map((s, i) => [s.code, i]));
  cards.sort((a, b) => (order.get(a.set) - order.get(b.set)) || a.num.localeCompare(b.num, "en", { numeric: true }));

  const sets = SETS.map((s) => ({ code: s.code, name: s.name, cards: cards.filter((c) => c.set === s.code) }))
    .filter((s) => s.cards.length);
  const candidate = { source: "https://hunterxhunter.fandom.com/wiki/Hunter_%C3%97_Hunter_Carddass_Collections", updatedAt: new Date().toISOString().slice(0, 10), sets };
  const newCount = snapshotCardCount(candidate);
  const oldCount = snapshotCardCount(existing);
  console.log(`  Hunterpedia: ${sets.length} sets, ${newCount} cartas (snapshot: ${oldCount}).`);
  if (newCount < oldCount) { console.log(`  ⚠ REGRESSÃO (${newCount} < ${oldCount}) — snapshot mantido.`); return existing; }
  // Grava quando o CONTEÚDO muda, não só quando a contagem muda: correção de
  // raridade/personagem numa carta já existente também tem que entrar.
  const same = existing && JSON.stringify((existing.sets || []).map((s) => s.cards)) === JSON.stringify(sets.map((s) => s.cards));
  if (!same) await writeSnapshot(SNAP, candidate);
  return (await readSnapshot(SNAP)) || candidate;
}

// Imagem CURADA do dono substitui o scan da wiki (mesmo mecanismo dos syncs do Naruto).
function curatedImg(id) {
  for (const ext of ["webp", "jpg", "png"]) {
    if (existsSync(fileURLToPath(new URL(`assets/cards/${GAME}/${id}.${ext}`, ROOT)))) return `/assets/cards/${GAME}/${id}.${ext}`;
  }
  return null;
}
const IMG = (url) => `https://wsrv.nl/?url=${encodeURIComponent(String(url).replace(/^https?:\/\//, ""))}&w=440&output=webp`;

// Nome exibido: personagem(ns) da carta. Sem personagem identificado, cai no
// tipo + número (nunca inventa título).
function cardName(c) {
  if (c.chars && c.chars.length) return c.chars.slice(0, 2).join(" & ");
  return `${c.type || "Card"} ${c.num}`;
}

async function build(snapshot) {
  const outDir = new URL(`data/${GAME}/`, ROOT);
  const line = [];
  for (const s of snapshot.sets || []) {
    const def = SET_BY_CODE.get(s.code);
    if (!def) continue;
    const setId = `${ID_PREFIX}-${s.code}`;
    const setName = `Hyper Battle ${def.name}`;
    for (const c of s.cards) {
      const cardId = `${setId}-${String(c.num).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      line.push({
        id: cardId,
        name: cardName(c),
        set: setName,
        setId,
        number: c.num,
        setTotal: s.cards.length,
        setReleaseDate: def.date,
        rarity: c.rarity || "",
        artist: "",
        language: "ja",
        image: curatedImg(cardId) || (c.img ? IMG(c.img) : ""),
        variants: ["Normal"],
        setLogo: LOGO,
        vintage: true,
        vintageLine: "hb"
      });
    }
  }
  const existing = (await readGlobalVar(new URL("cards.js", outDir), "TCG_CARDS")) || [];
  const kept = existing.filter((c) => c && !String(c.id).startsWith(`${ID_PREFIX}-`));
  const have = new Set(kept.map((c) => c.id));
  const merged = kept.concat(line.filter((c) => !have.has(c.id)));
  const pricing = (await readGlobalVar(new URL("pricing.js", outDir), "TCG_PRICING")) || {};
  await writeGameCatalog(outDir, { cards: merged, pricing, webDir: `data/${GAME}/` });
  const named = line.filter((c) => !/^(Character|Hunter|Event|Licence|Ability|Card) /.test(c.name)).length;
  console.log(`  ${GAME}: +${line.length} cartas Hyper Battle (${(snapshot.sets || []).length} sets, ${named} com personagem) -> ${merged.length} totais`);
}

async function run() {
  console.log("Carddass Hyper Battle — HUNTER×HUNTER (Bandai 1999–2001, vintage)");
  let snapshot = await readSnapshot(SNAP);
  if (!NO_FETCH) snapshot = await refreshSnapshot(snapshot);
  if (!snapshot || !snapshot.sets) { console.log("  sem snapshot e sem fetch — nada a fazer."); return; }
  await build(snapshot);
}
run();
