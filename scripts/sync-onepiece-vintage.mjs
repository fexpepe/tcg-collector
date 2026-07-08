// Catálogo VINTAGE do One Piece: "Carddass Hyper Battle" (Bandai, 1999–2002).
// Fonte: Grand Line Wiki (grandlinewiki.net) — wiki de fã com a checklist.
//
// PADRÃO SNAPSHOT (fonte frágil -> dado versionado):
//   1. O build SEMPRE parte de data/vintage/onepiece-hyperbattle.json (no git).
//   2. O fetch do wiki só ATUALIZA o snapshot quando responde E não regride
//      (menos cartas que o snapshot = parse quebrado/HTML mudou: mantém o que há).
//   Assim o deploy é determinístico e não depende do uptime do wiki.
//
// Imagens: se data/onepiece/vintage-images/<num>.webp existir (espelhadas pelo
// mirror-vintage-images.mjs), usa o arquivo local; senão, proxy wsrv.nl que
// redimensiona o scan gigante do wiki (~7MB png -> ~60KB webp).
//
// Roda DEPOIS do sync-onepiece (TCGCSV): anexa o vintage ao catálogo moderno.
//   node scripts/sync-onepiece-vintage.mjs [--no-fetch]
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { decodeEntities as decode, slug, readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, sleep, writeGameCatalog } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/onepiece/", ROOT);
const SNAP = new URL("data/vintage/onepiece-hyperbattle.json", ROOT);
const IMG_DIR = new URL("data/onepiece/vintage-images/", ROOT);
const OVERVIEW = "https://grandlinewiki.net/tcg/carddasshyper.html";
const IMG_BASE = "grandlinewiki.net/images/tcg/hyperbattle/cards"; // sem https:// (wsrv aceita assim)
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
const NO_FETCH = process.argv.includes("--no-fetch");

// ── Parse do wiki (só roda no refresh do snapshot) ──────────────────────────
const MONTHS = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };
function toISO(dateText) {
  const m = /([A-Za-z]+),?\s*(\d{4})/.exec(dateText || "");
  if (!m) return "";
  const mm = MONTHS[m[1].toLowerCase()];
  return mm ? `${m[2]}-${mm}` : m[2];
}

// Célula do nome capturada inteira e destrinchada depois: linhas SEM link <a>
// ou SEM o <i> do nome JP também entram (o regex rígido antigo as pulava).
function cardsIn(block) {
  const out = [];
  const re = /HBcardNum">([A-Z0-9]+)<\/td>\s*<td id="HBcardName">([\s\S]*?)<\/td>\s*<td id="HBcardType">([^<]*)<\/td>\s*<td id="HBcardMark">([^<]*)<\/td>\s*<td id="HBcardValue">([^<]*)<\/td>/g;
  let m;
  while ((m = re.exec(block))) {
    const nameCell = m[2];
    const nameJp = (nameCell.match(/「([^」]*)」/) || [])[1] || "";
    const nameEn = decode(nameCell.replace(/<i id="HBcardNameJP">[\s\S]*?<\/i>/, ""));
    out.push({ num: m[1].trim(), nameEn, nameJp: nameJp.trim(), type: decode(m[3]), mark: decode(m[4]), power: decode(m[5]) });
  }
  return out;
}

function parseOverview(html) {
  const segs = html.split(/<table id="HBSetImageLogo">/).slice(1);
  const sets = [];
  const skipped = [];
  let order = 0;
  for (const seg of segs) {
    order++;
    const name = decode((seg.match(/id="HBStageHead"[^>]*>([\s\S]*?)<\/th>/) || [])[1] || `Set ${order}`);
    const date = toISO((seg.match(/id="HBsetDate">([^<]+)</) || [])[1] || "");
    const official = Number((seg.match(/id="HBsetCC">(\d+)</) || [])[1] || 0);
    const cards = cardsIn(seg);
    if (!cards.length) { skipped.push(name); continue; }
    sets.push({ name, date, official, cards });
  }
  return { sections: segs.length, sets, skipped };
}

async function refreshSnapshot(existing) {
  let html = null;
  for (let i = 0; i < 4 && !html; i++) {
    try { const r = await fetch(OVERVIEW, { headers: UA }); if (r.ok) html = await r.text(); } catch (e) { /* retry */ }
    if (!html) await sleep(1000 * (i + 1));
  }
  if (!html) { console.log("  wiki inacessível — build segue do snapshot versionado."); return existing; }

  const parsed = parseOverview(html);
  const candidate = { source: OVERVIEW, note: existing?.note || "", updatedAt: new Date().toISOString().slice(0, 10), sets: parsed.sets };
  const newCount = snapshotCardCount(candidate);
  const oldCount = snapshotCardCount(existing);

  // Relatório de completude — dá pra ver de uma olhada se falta SET ou CARTA.
  console.log(`  wiki: ${parsed.sections} seções, ${parsed.sets.length} sets com cartas, ${newCount} cartas.`);
  if (parsed.skipped.length) console.log(`  ⚠ SETS PULADOS (0 cartas extraídas):\n     - ${parsed.skipped.join("\n     - ")}`);
  const incomplete = parsed.sets.filter((s) => s.official && s.cards.length < s.official).map((s) => `${s.name} (${s.cards.length}/${s.official})`);
  if (incomplete.length) console.log(`  ⚠ Sets INCOMPLETOS (extraído < oficial):\n     - ${incomplete.join("\n     - ")}`);
  if (!parsed.skipped.length && !incomplete.length) console.log("  ✓ Todos os sets da página entraram completos.");

  if (newCount < oldCount) {
    console.log(`  ⚠ REGRESSÃO (${newCount} < ${oldCount}): parse suspeito — snapshot mantido.`);
    return existing;
  }
  if (newCount !== oldCount || (existing && candidate.sets.length !== existing.sets.length)) {
    await writeSnapshot(SNAP, candidate);
    console.log(`  snapshot atualizado: ${oldCount} -> ${newCount} cartas.`);
  } else {
    console.log("  snapshot já em dia (sem mudanças).");
  }
  return (await readSnapshot(SNAP)) || candidate;
}

// ── Build a partir do snapshot ───────────────────────────────────────────────
import { existsSync } from "node:fs";
function cardImage(num) {
  const file = String(num).toLowerCase();
  // Imagem espelhada localmente vence (imune a outage do wiki/wsrv).
  if (existsSync(new URL(`${file}.webp`, IMG_DIR))) return `data/onepiece/vintage-images/${file}.webp`;
  return `https://wsrv.nl/?url=${IMG_BASE}/${file}.png&w=440&output=webp`;
}

async function run() {
  console.log("One Piece Vintage (Carddass Hyper Battle)");
  let snap = await readSnapshot(SNAP);
  if (!snap) { console.error("  ERRO: snapshot data/vintage/onepiece-hyperbattle.json ausente."); process.exit(1); }
  if (!NO_FETCH) snap = await refreshSnapshot(snap);

  const vintage = [];
  // Reimpressões: Grand Box DX / Compilations repetem números de cartas de sets
  // anteriores. A 1ª ocorrência fica com o id histórico "opcd-<num>" (preserva
  // coleções já marcadas); as demais ganham sufixo do set (e contador, se preciso)
  // — sem isto 18 ids colidiam e posse/índices se misturavam entre sets.
  const takenIds = new Set();
  const uniqueId = (num, setName) => {
    let id = "opcd-" + num;
    if (takenIds.has(id)) id = `opcd-${num}-${slug(setName)}`;
    for (let n = 2; takenIds.has(id); n++) id = `opcd-${num}-${slug(setName)}-${n}`;
    takenIds.add(id);
    return id;
  };
  for (const s of snap.sets) {
    const setId = "opcd-" + slug(s.name);
    for (const c of s.cards) {
      vintage.push({
        id: uniqueId(c.num, s.name),
        name: c.nameEn || c.num,
        set: `Carddass — ${s.name}`,
        setId,
        number: c.num,
        setTotal: s.official || s.cards.length,
        setReleaseDate: s.date,
        rarity: c.mark || "",
        artist: "",
        language: "ja", // produto japonês (1999–2002)
        image: cardImage(c.num),
        variants: ["Normal"],
        setLogo: "", // arte da 1ª carta do set (abaixo) — o wiki não tem logo limpo
        opColor: null,
        cardType: c.type || null,
        cost: null,
        power: c.power || null,
        vintage: true,
        nameJp: c.nameJp || null
      });
    }
  }
  const localImgs = vintage.filter((c) => !c.image.startsWith("http")).length;
  console.log(`  build do snapshot: ${vintage.length} cartas em ${snap.sets.length} sets (${localImgs} com imagem local espelhada).`);

  const cover = {};
  for (const c of vintage) { if (!cover[c.setId]) cover[c.setId] = c.image; }
  for (const c of vintage) { c.setLogo = cover[c.setId]; }

  // Anexa ao catálogo moderno (TCGCSV). Dedupe por id.
  const modern = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  // Mantém tudo que NÃO é Carddass (opcd-) — inclusive a outra linha vintage
  // (op2002-, do sync-onepiece-2002) e o moderno — e regrava só o Carddass.
  const nonVintageModern = modern.filter((c) => !String(c.setId).startsWith("opcd-"));
  const have = new Set(nonVintageModern.map((c) => c.id));
  const merged = nonVintageModern.concat(vintage.filter((c) => !have.has(c.id)));
  merged.sort((a, b) => String(a.setId).localeCompare(String(b.setId)) || String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));

  const bySet = new Map();
  for (const c of merged) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c.id); }
  const indexes = {
    sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)),
    artists: []
  };
  const pricing = (await readGlobalVar(new URL("pricing.js", OUT), "TCG_PRICING")) || {}; // vintage não tem preço

  // Modo prod = manifest real + chunks por set (o front baixa sob demanda).
  await writeGameCatalog(OUT, { cards: merged, indexes, pricing, webDir: "data/onepiece/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} — ${merged.length} cartas totais (moderno + vintage).`);
}

await run();
