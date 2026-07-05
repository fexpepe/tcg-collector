// Catálogo VINTAGE #2 do One Piece: o "One Piece Card Game" de 2002–2005 (Bandai)
// — o jogo standalone de verso madeira ("From TV animation ONE PIECE CARD GAME"),
// distinto do Carddass Hyper Battle E do jogo moderno (TCGCSV). É onde vivem os
// prefixos LK/SB/JS/CS/MS/RG/RK/G/… que aparecem nos lotes vintage.
//
// Fonte: Grand Line Wiki (grandlinewiki.net/tcg/opcardgame2002.html) — checklist
// completa (22 sets, ~1330 cartas) na mesma família de markup do Hyper Battle,
// com ids "OP02*". Sem preço (não há fonte aberta) — set vintage de exibição.
//
// PADRÃO SNAPSHOT (fonte frágil -> dado versionado): o build parte do snapshot
// em data/vintage/onepiece-2002cardgame.json; o fetch do wiki só ATUALIZA quando
// responde e não regride. Determinístico e imune ao uptime/throttle do wiki.
//
// Imagens: os scans do wiki são grandes -> proxy wsrv.nl (resize p/ ~440px webp).
// Espelhadas em data/onepiece/vintage-images-2002/ quando existirem (mirror).
//
// Roda DEPOIS do sync-onepiece + sync-onepiece-vintage: anexa ao mesmo catálogo
// do One Piece, dedupe pelo prefixo op2002- (coexiste com o Carddass opcd-).
//   node scripts/sync-onepiece-2002.mjs [--no-fetch]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeEntities as decode, slug, readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, sleep } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/onepiece/", ROOT);
const SNAP = new URL("data/vintage/onepiece-2002cardgame.json", ROOT);
const CACHE = new URL("data/.cache/onepiece-2002.html", ROOT);
const IMG_DIR = new URL("data/onepiece/vintage-images-2002/", ROOT);
const OVERVIEW = "https://grandlinewiki.net/tcg/opcardgame2002.html";
const IMG_BASE = "grandlinewiki.net/images/tcg/02cardgame/cards";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
const NO_FETCH = process.argv.includes("--no-fetch");

const MONTHS = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12", january: "01", february: "02", march: "03", april: "04", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };
function toISO(dateText) {
  const m = /([A-Za-z]+)\.?[,\s]*(?:\d{1,2},?\s*)?(\d{4})/.exec(dateText || "");
  if (!m) return "";
  const mm = MONTHS[m[1].toLowerCase()];
  return mm ? `${m[2]}-${mm}` : m[2];
}

// Parser da página: 22 sets (split em OP02setName). Cada carta tem sempre um link
// <a href="02cardgame/<num>.html">NOME EN</a> (robusto a todas as layouts de linha
// — personagem/técnica/evento); o nome JP vem na célula OP02cardName seguinte.
function parseOverview(html) {
  const segs = html.split(/<td id="OP02setName">/).slice(1);
  const sets = [];
  for (const seg of segs) {
    const name = seg.slice(0, seg.indexOf("</td>")).replace(/<[^>]+>/g, "").replace(/「[^」]*」/, "").replace(/\s+/g, " ").trim();
    const date = toISO((seg.match(/id="OP02setDate">([^<]+)</) || [])[1] || "");
    const official = Number((seg.match(/id="OP02setCC">(\d+)</) || [])[1] || 0);
    const cards = [];
    const re = /id="HBcardNum">([A-Z0-9-]+)<\/td>[\s\S]*?href="02cardgame\/[^"]*">([^<]*)<\/a>(?:[\s\S]{0,80}?id="OP02cardName">([^<]*)<\/td>)?/g;
    let m;
    while ((m = re.exec(seg))) {
      cards.push({ num: m[1].trim(), nameEn: decode(m[2]), nameJp: (m[3] || "").trim() });
    }
    if (cards.length) sets.push({ name, date, official, cards });
  }
  return sets;
}

async function refreshSnapshot(existing) {
  let html = null;
  // Cache local primeiro (seed do build), senão busca o wiki.
  try { html = await readFile(CACHE, "utf8"); } catch { /* sem cache */ }
  if (!html) {
    for (let i = 0; i < 4 && !html; i++) {
      try { const r = await fetch(OVERVIEW, { headers: UA }); if (r.ok) { html = await r.text(); await mkdir(new URL("data/.cache/", ROOT), { recursive: true }); await writeFile(CACHE, html, "utf8"); } } catch (e) { /* retry */ }
      if (!html) await sleep(1500 * (i + 1));
    }
  }
  if (!html) { console.log("  wiki inacessível — build segue do snapshot versionado."); return existing; }

  const sets = parseOverview(html);
  const candidate = { source: OVERVIEW, updatedAt: new Date().toISOString().slice(0, 10), sets };
  const newCount = snapshotCardCount(candidate);
  const oldCount = snapshotCardCount(existing);
  console.log(`  wiki: ${sets.length} sets, ${newCount} cartas.`);
  if (newCount < oldCount) { console.log(`  ⚠ REGRESSÃO (${newCount} < ${oldCount}) — snapshot mantido.`); return existing; }
  if (newCount !== oldCount || (existing && sets.length !== existing.sets.length)) {
    await writeSnapshot(SNAP, candidate);
    console.log(`  snapshot atualizado: ${oldCount} -> ${newCount} cartas.`);
  }
  return (await readSnapshot(SNAP)) || candidate;
}

// Imagem: local espelhada vence; senão wsrv (num sem hífen, minúsculo -> lkc01.png).
function cardImage(num) {
  const file = String(num).toLowerCase().replace(/-/g, "");
  if (existsSync(new URL(`${file}.webp`, IMG_DIR))) return `data/onepiece/vintage-images-2002/${file}.webp`;
  return `https://wsrv.nl/?url=${IMG_BASE}/${file}.png&w=440&output=webp`;
}

async function run() {
  console.log("One Piece Card Game 2002–2005 (vintage #2)");
  let snap = await readSnapshot(SNAP);
  if (!NO_FETCH || !snap) snap = await refreshSnapshot(snap);
  if (!snap || !snap.sets || !snap.sets.length) { console.error("  ERRO: sem snapshot nem fonte."); process.exit(1); }

  const cards2002 = [];
  const takenIds = new Set();
  for (const s of snap.sets) {
    const setId = "op2002-" + slug(s.name);
    for (const c of s.cards) {
      let id = "op2002-" + c.num;
      while (takenIds.has(id)) id += "b"; // colisão rara (mesmo num em 2 sets) -> sufixo
      takenIds.add(id);
      cards2002.push({
        id,
        name: c.nameEn || c.num,
        set: `OP 2002 — ${s.name}`,
        setId,
        number: c.num,
        setTotal: s.official || s.cards.length,
        setReleaseDate: s.date,
        rarity: "",
        artist: "",
        language: "ja",
        image: cardImage(c.num),
        variants: ["Normal"],
        setLogo: "",
        opColor: null,
        cardType: null,
        cost: null,
        power: null,
        vintage: true,
        vintageLine: "op2002",
        nameJp: c.nameJp || null
      });
    }
  }
  const localImgs = cards2002.filter((c) => !c.image.startsWith("http")).length;
  console.log(`  build: ${cards2002.length} cartas em ${snap.sets.length} sets (${localImgs} com imagem local).`);

  const cover = {};
  for (const c of cards2002) { if (!cover[c.setId]) cover[c.setId] = c.image; }
  for (const c of cards2002) { c.setLogo = cover[c.setId]; }

  // Anexa ao catálogo: mantém tudo que NÃO é desta linha (op2002-), acrescenta o rebuild.
  const existing = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const kept = existing.filter((c) => !String(c.setId).startsWith("op2002-"));
  const have = new Set(kept.map((c) => c.id));
  const merged = kept.concat(cards2002.filter((c) => !have.has(c.id)));
  merged.sort((a, b) => String(a.setId).localeCompare(String(b.setId)) || String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));

  const bySet = new Map();
  for (const c of merged) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c.id); }
  const indexes = { sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)), artists: [] };
  const pricing = (await readGlobalVar(new URL("pricing.js", OUT), "TCG_PRICING")) || {};

  await mkdir(OUT, { recursive: true });
  const w = async (name, varName, value) => writeFile(new URL(name, OUT), `window.${varName} = ${JSON.stringify(value)};\n`, "utf8");
  await w("cards.js", "TCG_CARDS", merged);
  await w("manifest.generated.js", "TCG_CARDS", merged);
  await w("indexes.js", "TCG_INDEXES", indexes);
  await w("indexes.generated.js", "TCG_INDEXES", indexes);
  await w("pricing.js", "TCG_PRICING", pricing);
  await w("pricing.generated.js", "TCG_PRICING", pricing);
  console.log(`Gravado em ${fileURLToPath(OUT)} — ${merged.length} cartas totais.`);
}

await run();
