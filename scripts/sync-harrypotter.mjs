// Harry Potter Trading Card Game (Wizards of the Coast, 2001–2002): o jogo
// vintage `harrypotter`. Cinco coleções e o fim: Base Set (ago/2001), Quidditch
// Cup (nov/2001), Diagon Alley (mar/2002), Adventures at Hogwarts (jun/2002) e
// Chamber of Secrets (out/2002). A Wizards encerrou o jogo em 2003.
//
// Fontes (levantamento de 2026-09-30):
//   hpjson     — github.com/Tressley/hpjson, cards.json (o dado por trás do
//                accio.cards): nome, número, tipo, lição, raridade, artista e o
//                arquivo da imagem. Traz também os sets FAN-MADE da comunidade
//                Revival (2020→): ficam FORA (docs/CATALOGO.md, contrato 3), só
//                os cinco da Wizards entram. Tem um `NaN` cru, que o JSON.parse
//                não aceita: vira null antes.
//   nslists    — nslists.com/hptcg1.htm, hptcgqc/da/ah.htm (House of
//                Checklists): conferência carta a carta. O hpjson repete 6
//                números com grafias diferentes; o nome impresso é o do nslists
//                (NOME_IMPRESSO). De lá vem também o deck inicial do Diagon
//                Alley (EXTRAS). História encerrada: fica escrito aqui, não raspa.
//   accio.cards — as imagens, em accio.cards/cardimages{,2,3}/<arquivo>. Do Base
//                ao Adventures at Hogwarts são recriações da comunidade Revival
//                (745×1040, com "Revival" e "PROXY NOT FOR SALE" impressos):
//                mesma arte, texto, número e raridade da carta impressa —
//                conferido contra scans reais do MYP em 30/09/2026. O Chamber of
//                Secrets é scan REAL, mas só 250×350 (`&we`: o wsrv não estica).
//                As cartas deitadas (personagem, criatura, item…) já vêm giradas
//                pra retrato, então a moldura 63/88 serve. As cinco Lições usam a
//                MESMA imagem em todos os sets (a do Base, "113/116"): a arte é
//                a mesma, só o número e o símbolo mudam.
//   Símbolos dos sets: os do accio (Images/Icons/Set Symbols/logo<SET>.png),
//                espelhados em data/harrypotter/set-symbols/<code>.webp. Logo de
//                set não existe em fonte acessível: o tile mostra o nome.
//
// PREMIUM entra como CARTA SEPARADA (decisão do Fernando, 30/09/2026): toda
// rara das expansões tem a versão premium com o MESMO número — Holo Portrait no
// personagem, Foil Premium no resto (Wikipedia; o Fandom confirma no Chamber of
// Secrets). Id `hp-qc-7-premium`, nome com "(Holo)"/"(Foil)". No Base Set as
// cartas 1–20 SÓ existem premium: são cartas comuns do set, sem gêmea.
//
// Decks iniciais e promos entram como SETS próprios (EXTRAS), cada carta
// apontando pra carta de origem (nome, imagem, número impresso). Id
// `hp-<set extra>-<set de origem>-<número>`: hp-da2p-bs-30.
//
// IDs: hp-<set>-<número oficial>. O número não muda, então correção de nome ou
// de imagem na fonte não troca id. Snapshot (data/vintage/hptcg.json) nunca
// regride, e carta publicada que some da fonte continua no catálogo.
//
//   node scripts/sync-harrypotter.mjs             # fetch (se der) + build
//   node scripts/sync-harrypotter.mjs --no-fetch  # só build do snapshot
import { fileURLToPath } from "node:url";
import { readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog, sleep } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const SNAP = new URL("data/vintage/hptcg.json", ROOT);
const SOURCE = "https://raw.githubusercontent.com/Tressley/hpjson/master/cards.json";
const UA = { "User-Agent": "Sleevu (sleevu.app) catalog sync" };
const NO_FETCH = process.argv.includes("--no-fetch");
const GAME = "harrypotter";
const ID_PREFIX = "hp-";
const ACCIO = ["https://accio.cards/cardimages/", "https://accio.cards/cardimages2/", "https://accio.cards/cardimages3/"];

// `src` = setName no hpjson; `printed` = total impresso na carta ("7/80").
export const SETS = [
  { code: "bs", src: "Base", name: "Base Set", date: "2001-08", printed: 116 },
  { code: "qc", src: "Quidditch Cup", name: "Quidditch Cup", date: "2001-11", printed: 80 },
  { code: "da", src: "Diagon Alley", name: "Diagon Alley", date: "2002-03", printed: 80 },
  { code: "aah", src: "Adventures at Hogwarts", name: "Adventures at Hogwarts", date: "2002-06", printed: 80 },
  { code: "cos", src: "Chamber of Secrets", name: "Chamber of Secrets", date: "2002-10", printed: 140 }
];
const SET_BY_CODE = new Map(SETS.map((s) => [s.code, s]));
const SET_BY_SRC = new Map(SETS.map((s) => [s.src, s]));

// Números que o hpjson lista duas vezes com grafias diferentes. O nome é o do
// checklist do nslists (o impresso); a outra linha do hpjson só empresta a
// imagem se a desta não existir no accio.
export const NOME_IMPRESSO = {
  "qc-6": "Gaze Into the Mirror",
  "qc-7": "Gold Cauldron",
  "da-27": "The Leaky Cauldron",
  "aah-3": "Crabbe and Goyle",
  "aah-59": "Every-Flavour Beans",
  "aah-65": "Manegro Potion"
};

// Base #3 (Draco Malfoy) e #10 (Hermione Granger) têm DUAS cartas no hpjson,
// "3a"/"3b" e "10a"/"10b". A "b" é a do booster: premium, símbolo de premium,
// arte de Pete Venters e de Kevin McCann. A "a" é a do deck inicial do Diagon
// Alley: sem foil, estrela de rara, arte NOVA de Romas e de James Bernardin
// (os mesmos artistas que o nslists dá pro "[starter]"). Conferido nas imagens
// do accio em 30/09/2026.
export const VERSAO = {
  "bs-3": { booster: "3b", deck: "3a" },
  "bs-10": { booster: "10b", deck: "10a" }
};

// Sets extras: decks iniciais e promos. `from` + `num` apontam a carta de
// origem; `kind` diz o que muda nela (nome e variante). A raridade é a do
// SÍMBOLO impresso: a da carta de origem, ou a do `rarity` da entrada.
//   foil    — versão foil de carta que no booster não tem foil
//   starter — versão do deck inicial com arte própria (VERSAO.deck)
export const EXTRAS = [
  {
    // Diagon Alley 2-Player Starter Set (mar/2002): dois decks iguais por caixa,
    // "Norbert" e "River Troll", cada um com uma foil e um personagem do Base
    // na versão sem foil (nslists, hptcgda.htm, "STARTER BOX COMPOSITION").
    code: "da2p", name: "Diagon Alley 2-Player Starter Set", date: "2002-03", kind: "deck",
    cards: [
      { from: "bs", num: "30", kind: "foil" },                     // Norbert — deck "Norbert"
      { from: "bs", num: "3", kind: "starter", rarity: "Rare" },   // Draco Malfoy — deck "Norbert"
      { from: "da", num: "68", kind: "foil" },                     // River Troll — deck "River Troll"
      { from: "bs", num: "10", kind: "starter", rarity: "Rare" }   // Hermione Granger — deck "River Troll"
    ]
  }
];

const KIND = {
  foil: { suffix: "Foil", variant: "Foil" },
  starter: { suffix: "Starter", variant: "Normal" },
  promo: { suffix: "Promo", variant: "Normal" },
  promoFoil: { suffix: "Promo Foil", variant: "Foil" }
};

const asList = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);
const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
// O artista vem como texto, lista ou null; "NaN" é o buraco do próprio hpjson.
export const artistOf = (v) => asList(v).map(clean).filter((a) => a && a !== "NaN" && a !== "null").join(", ");

// hpjson -> { <code>: [{ num, name, type, lesson, rarity, artist, files[] }] }.
// Uma entrada por número; as versões com letra ("3a", "3b") ficam separadas
// e o build escolhe qual é a do booster (VERSAO). Premium do hpjson nas
// expansões (as poucas linhas que ele traz) é descartada: a gêmea premium é
// gerada no build pra TODA rara.
export function parseHpjson(text) {
  const arr = JSON.parse(String(text).replace(/:\s*NaN\b/g, ": null"));
  const bySet = {};
  for (const c of arr) {
    const def = SET_BY_SRC.get(c && c.setName);
    if (!def) continue;                                   // fan-made (Revival)
    const raw = clean(c.number).toLowerCase();
    const m = /^(\d+)([a-z])?$/.exec(raw);
    if (!m) continue;
    const num = m[1] + (m[2] || "");
    const rarity = clean(c.rarity);
    const premiumDup = def.code !== "bs" && /premium/i.test(rarity);
    (bySet[def.code] = bySet[def.code] || []).push({
      num, premiumDup,
      name: clean(c.name),
      type: asList(c.type).map(clean).filter(Boolean).join("/"),
      lesson: asList(c.lesson).map(clean).filter(Boolean).join("/"),
      rarity, artist: artistOf(c.artist), file: clean(c.imgSrc)
    });
  }
  const out = {};
  for (const def of SETS) {
    const rows = bySet[def.code] || [];
    const byNum = new Map();
    for (const r of rows) {
      if (!byNum.has(r.num)) byNum.set(r.num, []);
      byNum.get(r.num).push(r);
    }
    const cards = [];
    for (const [num, list] of byNum) {
      const impresso = NOME_IMPRESSO[`${def.code}-${num}`];
      const normal = list.filter((r) => !r.premiumDup);
      const pool = normal.length ? normal : list;
      const pick = (impresso && pool.find((r) => r.name === impresso)) || pool[0];
      const files = [pick.file, ...list.map((r) => r.file)].filter((f, i, a) => f && a.indexOf(f) === i);
      // Lição: raridade própria ("Lesson"); o hpjson marca uma ou outra Common.
      const rarity = pick.type === "Lesson" ? "Lesson" : pick.rarity;
      cards.push({ num, name: impresso || pick.name, type: pick.type, lesson: pick.lesson, rarity, artist: pick.artist, files });
    }
    cards.sort((a, b) => parseInt(a.num, 10) - parseInt(b.num, 10) || a.num.localeCompare(b.num));
    out[def.code] = cards;
  }
  return out;
}

async function headOk(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { method: "HEAD", headers: UA, signal: AbortSignal.timeout(20000) });
      if (r.ok) return true;
      if (r.status === 404) return false;
    } catch { /* retry */ }
    await sleep(800 * (i + 1));
  }
  return false;
}

// Primeiro arquivo que existe, em qualquer das três pastas do accio. O que o
// snapshot já sabe não é perguntado de novo (a imagem não muda de pasta).
async function resolveImg(files, known) {
  for (const f of files) {
    const cached = known.get(f);
    if (cached) return cached;
  }
  for (const f of files) {
    for (const base of ACCIO) {
      const url = base + encodeURIComponent(f);
      if (await headOk(url)) { known.set(f, url); return url; }
      await sleep(120);
    }
  }
  return "";
}

async function refreshSnapshot(existing) {
  let text = null;
  try {
    const r = await fetch(SOURCE, { headers: UA, signal: AbortSignal.timeout(60000) });
    if (r.ok) text = await r.text();
  } catch { /* fonte fora do ar */ }
  if (!text) { console.log("  hpjson inacessível — segue com o snapshot versionado."); return existing; }
  let parsed;
  try { parsed = parseHpjson(text); } catch (e) { console.log(`  hpjson ilegível (${e.message}) — snapshot mantido.`); return existing; }

  const known = new Map();
  for (const s of existing?.sets || []) for (const c of s.cards || []) if (c.img && c.file) known.set(c.file, c.img);
  const sets = [];
  for (const def of SETS) {
    const prev = new Map(((existing?.sets || []).find((s) => s.code === def.code)?.cards || []).map((c) => [c.num, c]));
    const cards = [];
    for (const c of parsed[def.code] || []) {
      const img = await resolveImg(c.files, known);
      const file = img ? decodeURIComponent(img.split("/").pop()) : c.files[0] || "";
      cards.push({ num: c.num, name: c.name, type: c.type, lesson: c.lesson, rarity: c.rarity, artist: c.artist, file, img });
      prev.delete(c.num);
    }
    // Carta que a fonte tirou fica como estava (nunca regride).
    for (const c of prev.values()) cards.push(c);
    cards.sort((a, b) => parseInt(a.num, 10) - parseInt(b.num, 10) || a.num.localeCompare(b.num));
    sets.push({ code: def.code, cards });
  }
  const candidate = { source: SOURCE, updatedAt: new Date().toISOString().slice(0, 10), sets };
  const newCount = snapshotCardCount(candidate);
  const oldCount = snapshotCardCount(existing);
  const semImg = sets.reduce((n, s) => n + s.cards.filter((c) => !c.img).length, 0);
  console.log(`  hpjson: ${sets.length} sets, ${newCount} cartas, ${semImg} sem imagem (snapshot: ${oldCount}).`);
  if (newCount < oldCount) { console.log(`  ⚠ REGRESSÃO (${newCount} < ${oldCount}) — snapshot mantido.`); return existing; }
  const same = existing && JSON.stringify((existing.sets || []).map((s) => s.cards)) === JSON.stringify(sets.map((s) => s.cards));
  if (!same) await writeSnapshot(SNAP, candidate);
  return (await readSnapshot(SNAP)) || candidate;
}

// Imagem pelo proxy de resize (o accio serve PNG de ~1,8 MB). O scan real do
// Chamber of Secrets tem 250px: `&we` impede o wsrv de esticar.
export function imageUrl(img, code) {
  if (!img) return "";
  const host = String(img).replace(/^https?:\/\//, "");
  return `https://wsrv.nl/?url=${encodeURIComponent(host)}&w=440${code === "cos" ? "&we" : ""}&output=webp`;
}

const isCharacter = (c) => /(^|\/)Character($|\/)/.test(c.type || "");
const symbolOf = (code) => `data/${GAME}/set-symbols/${code}.webp`;

// Cartas do catálogo a partir do snapshot: os cinco sets (com as gêmeas
// premium) e os sets extras.
export function buildCards(snapshot) {
  const bySet = new Map((snapshot.sets || []).map((s) => [s.code, s.cards || []]));
  const out = [];
  const origem = new Map();                       // "bs-30" -> carta do snapshot
  for (const def of SETS) {
    const lista = bySet.get(def.code) || [];
    const porNum = new Map(lista.map((c) => [c.num, c]));
    const base = [];
    for (const c of lista) {
      const key = `${def.code}-${c.num}`;
      if (/^\d+$/.test(c.num)) { base.push(c); origem.set(key, c); continue; }
      // Versão com letra: a do booster vira a carta do número; a do deck fica
      // só como origem do set extra.
      const n = c.num.replace(/\D+$/, "");
      const v = VERSAO[`${def.code}-${n}`];
      if (v && v.booster === c.num && !porNum.has(n)) { const b = { ...c, num: n }; base.push(b); origem.set(`${def.code}-${n}`, b); }
      if (v && v.deck === c.num) origem.set(`${def.code}-${n}:deck`, c);
    }
    base.sort((a, b) => parseInt(a.num, 10) - parseInt(b.num, 10));
    // Base: as 1–20 já são as premium. Expansões: toda rara ganha a gêmea.
    const premium = def.code === "bs" ? [] : base.filter((c) => c.rarity === "Rare");
    const total = base.length + premium.length;
    const comum = (c) => ({
      set: def.name, setId: `${ID_PREFIX}${def.code}`, number: `${c.num}/${def.printed}`,
      setTotal: total, setReleaseDate: def.date, setSymbol: symbolOf(def.code),
      artist: c.artist, language: "en", image: imageUrl(c.img, def.code),
      cardType: c.type, ...(c.lesson ? { lesson: c.lesson } : {}), setLogo: "", vintage: true
    });
    for (const c of base) {
      const holo = /holo portrait/i.test(c.rarity);
      const foil = !holo && /premium/i.test(c.rarity);
      out.push({ id: `${ID_PREFIX}${def.code}-${c.num}`, name: c.name, ...comum(c), rarity: c.rarity, variants: [holo ? "Holo" : foil ? "Foil" : "Normal"] });
    }
    for (const c of premium) {
      const holo = isCharacter(c);
      out.push({
        id: `${ID_PREFIX}${def.code}-${c.num}-premium`, name: `${c.name} (${holo ? "Holo" : "Foil"})`, ...comum(c),
        rarity: holo ? "Holo Portrait Premium" : "Foil Premium", variants: [holo ? "Holo" : "Foil"]
      });
    }
  }
  for (const ex of EXTRAS) {
    const cards = [];
    for (const e of ex.cards) {
      const def = SET_BY_CODE.get(e.from);
      // A versão de deck (VERSAO) tem arte própria; sem ela, a carta do booster.
      const c = (e.kind === "starter" && origem.get(`${e.from}-${e.num}:deck`)) || origem.get(`${e.from}-${e.num}`);
      if (!def || !c) { console.log(`  ⚠ ${ex.code}: origem ${e.from}-${e.num} não está no snapshot — pulada.`); continue; }
      const k = KIND[e.kind];
      cards.push({
        id: `${ID_PREFIX}${ex.code}-${e.from}-${e.num}`, name: `${c.name} (${k.suffix})`,
        set: ex.name, setId: `${ID_PREFIX}${ex.code}`, number: `${e.num}/${def.printed}`,
        setReleaseDate: e.date || ex.date, ...(ex.kind === "deck" ? { setKind: "deck" } : {}),
        rarity: e.rarity || (e.kind === "promo" || e.kind === "promoFoil" ? "Promo" : c.rarity),
        artist: c.artist, language: "en", image: imageUrl(c.img, e.from),
        cardType: c.type, ...(c.lesson ? { lesson: c.lesson } : {}), setLogo: "", vintage: true, variants: [k.variant]
      });
    }
    for (const c of cards) c.setTotal = cards.length;
    out.push(...cards);
  }
  return out;
}

async function build(snapshot) {
  const outDir = new URL(`data/${GAME}/`, ROOT);
  const line = buildCards(snapshot);
  const existing = (await readGlobalVar(new URL("cards.js", outDir), "TCG_CARDS")) || [];
  // O catálogo é só deste sync; mas carta publicada nunca some (usuário pode tê-la).
  const have = new Set(line.map((c) => c.id));
  const kept = existing.filter((c) => c && c.id && !have.has(c.id));
  const merged = line.concat(kept);
  const pricing = (await readGlobalVar(new URL("pricing.js", outDir), "TCG_PRICING")) || {};
  await writeGameCatalog(outDir, { cards: merged, pricing, webDir: `data/${GAME}/` });
  const sets = new Set(merged.map((c) => c.setId)).size;
  const semImg = merged.filter((c) => !c.image).length;
  console.log(`  ${GAME}: ${line.length} cartas em ${sets} sets (${semImg} sem imagem) -> ${merged.length} totais`);
}

async function run() {
  console.log("Harry Potter TCG (Wizards of the Coast 2001–2002, vintage)");
  let snapshot = await readSnapshot(SNAP);
  if (!NO_FETCH) snapshot = await refreshSnapshot(snapshot);
  if (!snapshot || !snapshotCardCount(snapshot)) { console.log("  sem snapshot e sem fetch — nada a fazer."); return; }
  await build(snapshot);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
