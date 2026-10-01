// The Lord of the Rings Trading Card Game (Decipher, nov/2001 – jun/2007): o
// jogo vintage `lotr`. 19 sets + os promos; a licença da Decipher acabou em
// 2007 e a lista de cartas não muda mais.
//
// Fonte (levantamento de 2026-09-30): o banco do Player's Council
// (lotrtcgpc.net), o grupo de fãs que mantém o jogo hoje.
//   files.lotrtcgpc.net/card_data/sql/lotr_tcg_csv_export_2020-06-24.zip
//     — tabelas Cards/Sets/Rarities/Cultures/CardTypes/Texts (TSV em
//       Windows-1252). Título e subtítulo saem do Texts em inglês "de
//       exibição" (LanguageID 2, com os acentos: Úlairë Enquëa); a coluna
//       Title do Cards é a forma sem acento, pra busca.
//   i.lotrtcgpc.net/decipher/<arquivo>.jpg
//     — os scans ORIGINAIS que a Decipher hospedava no site dela, 357×497
//       (abaixo dos 440 do contrato; o Fernando aceitou em 30/09/2026: é a
//       única versão autêntica). Pedidos via wsrv.nl, como os outros vintages
//       (host já liberado na CSP e no espelho R2).
//       ATENÇÃO: as pastas decipher/double/ e decipher/huge/ do mesmo host NÃO
//       são scans ampliados — são cartas REDESENHADAS pelo Player's Council,
//       com o rodapé "NOT ENDORSED BY NEW LINE…, TOLKIEN ESTATE, OR DECIPHER".
//       Fan-made: não usar (docs/CATALOGO.md, contrato 3).
//   Datas: dbo.Sets do export; a do set 0 vem da página "Promotional" do wiki
//   do PC (wiki.lotrtcgpc.net), 2001-11-06 — o export diz 2002-03-06, mas o
//   primeiro promo saiu com o Fellowship.
//   Fora: os sets V0–V3, o Hobbit Draft Game e as erratas do PC (fan-made).
//
// O CI só monta data/lotr/ a partir do snapshot versionado
// (data/vintage/lotr-pc.json): sem rede, o jogo acabou. `--importar` baixa o
// export de novo e regrava o snapshot, se não regredir.
//
// IDs: lotr-<código impresso em minúsculas> — 1R284 = set 1, Rare, nº 284 →
// lotr-1r284. Tengwar e a arte alternativa levam o sufixo (1R1T → lotr-1r1t,
// 15R29H → lotr-15r29h); Legends, lotr-11rf1; Masterworks, lotr-12o195; o
// "+" do Reflections vira "plus" (9R+32 → lotr-9rplus32), porque o banco só
// aceita [A-Za-z0-9._-] em id de carta. O id fica gravado no snapshot e o
// re-import reaproveita o da carta já conhecida (ids pegajosos).
//
// Sets (decisões do Fernando, 30/09/2026):
//   - lotr-01…lotr-19: os sets da Decipher. Tengwar, Legends (RF) e
//     Masterworks (O) são cartas próprias, dentro do set; o foil é VARIANTE
//     nos sets 1–8 e 10 (cada carta saiu nas duas versões, 1 foil a cada ~6
//     boosters); o Reflections (9) é todo foil.
//   - Promos: lotr-00 (os 0P), e quatro sets à parte pro que tem numeração
//     própria — Megasized (cartas gigantes, 0M1…6M3), os promos digitais do
//     LOTR Online (0D), a série W (LOTR Online e o concurso do Hunters) e as
//     cartas de piada do site da Decipher. Os três últimos NUNCA foram
//     impressos; entram a pedido do Fernando, marcados na raridade.
//   Num set só, as numerações D1/W1/1/M1 se intercalariam (a ordem por número
//   olha a primeira sequência de dígitos).
//
//   node scripts/sync-lotr.mjs             # build do snapshot (o que o CI roda)
//   node scripts/sync-lotr.mjs --importar  # baixa o export do PC e regrava o snapshot
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const SNAP = new URL("data/vintage/lotr-pc.json", ROOT);
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Sleevu/1.0 (+sleevu.app)" };
const EXPORT_URL = "https://files.lotrtcgpc.net/card_data/sql/lotr_tcg_csv_export_2020-06-24.zip";
const IMG_INDEX = "https://i.lotrtcgpc.net/decipher/";
const GAME = "lotr";
const ID_PREFIX = "lotr-";

// Ordem = ordem de lançamento. `code` vira o setId (lotr-<code>).
const SETS = [
  { code: "00", name: "Promotional", date: "2001-11-06", promo: true },
  { code: "00m", name: "Megasized Promos", date: "2001-11-06", promo: true },
  { code: "00d", name: "LOTR Online Promos", date: "2001-11-06", promo: true },
  { code: "00w", name: "W-Series (LOTR Online)", date: "2001-11-06", promo: true },
  { code: "00j", name: "Joke Cards", date: "2001-11-06", promo: true },
  { code: "01", name: "The Fellowship of the Ring", date: "2001-11-06" },
  { code: "02", name: "Mines of Moria", date: "2002-03-06" },
  { code: "03", name: "Realms of the Elf-lords", date: "2002-06-19" },
  { code: "04", name: "The Two Towers", date: "2002-11-06" },
  { code: "05", name: "Battle of Helm's Deep", date: "2003-03-12" },
  { code: "06", name: "Ents of Fangorn", date: "2003-07-02" },
  { code: "07", name: "The Return of the King", date: "2003-11-05" },
  { code: "08", name: "Siege of Gondor", date: "2004-03-10" },
  { code: "09", name: "Reflections", date: "2004-05-12" },
  { code: "10", name: "Mount Doom", date: "2004-07-14" },
  { code: "11", name: "Shadows", date: "2004-11-03" },
  { code: "12", name: "Black Rider", date: "2005-03-18" },
  { code: "13", name: "Bloodlines", date: "2005-08-12" },
  { code: "14", name: "Expanded Middle-earth", date: "2006-02-17" },
  { code: "15", name: "The Hunters", date: "2006-06-09" },
  { code: "16", name: "The Wraith Collection", date: "2006-08-26" },
  { code: "17", name: "Rise of Saruman", date: "2007-03-01" },
  { code: "18", name: "Treachery & Deceit", date: "2007-05-01" },
  { code: "19", name: "Age's End", date: "2007-06-01" }
];
const SET_BY_CODE = new Map(SETS.map((s) => [s.code, s]));

// dbo.Rarities (ID → rótulo). Os dois "P" são raridades diferentes: o 6 é o
// promo do set 0, o 7 é o Premium dos starters (2 cópias por caixa).
const RARITY = {
  1: "April Fool's", 2: "Common", 3: "Digital Promo", 4: "Megasized Promo", 5: "Masterwork",
  6: "Promo", 7: "Premium", 8: "Rare", 9: "Rare Plus", 10: "Legends", 11: "Starter",
  12: "St. Patrick's Day", 13: "Uncommon", 14: "W-Series"
};
const KIND_BY_RARITY = { 1: "joke", 12: "joke", 3: "digital", 14: "w", 4: "mega", 10: "legends", 5: "masterwork" };

// ---------------------------------------------------------------------------
// Do export do PC pro snapshot
// ---------------------------------------------------------------------------

// Linhas do TSV do SQL Server. Texto com quebra de linha parte a linha: só
// valem as que começam com o ID numérico e têm todas as colunas.
export function parseTsv(text) {
  const lines = String(text).split(/\r?\n/);
  const head = lines.shift().split("\t");
  const rows = [];
  for (const l of lines) {
    const cols = l.split("\t");
    if (cols.length < head.length || !/^\d+$/.test(cols[0])) continue;
    const o = {};
    head.forEach((h, i) => { o[h] = cols[i]; });
    rows.push(o);
  }
  return rows;
}

// Uma linha de dbo.Cards (+ tabelas de apoio) → carta do snapshot, ou null.
// `setNumber` é o SetNumber da Decipher (0–19); o SetID do Cards é o ID da
// tabela Sets (= SetNumber + 1).
export function cardFromRow(row, { setNumber, title, subtitle, culture, type, images }) {
  const rarityId = Number(row.RarityID);
  const rarity = RARITY[rarityId];
  if (!rarity) return null;
  const suffix = String(row.CardSuffix || "").trim().toUpperCase();   // T (Tengwar) | H (arte alternativa)
  const n = Number(row.CardNumber);
  // O código impresso. A carta de piada do 1º de abril vem sem; o arquivo da
  // imagem (LOTR00AFD) dá o nome.
  let code = String(row.CollectorsInfo || "").trim();
  if (!code && rarityId === 1) code = `${setNumber}AFD`;
  if (!code) return null;
  code += suffix;
  const kind = KIND_BY_RARITY[rarityId] || (suffix === "T" ? "tengwar" : "base");

  let setCode = String(setNumber).padStart(2, "0");
  let num;
  if (kind === "mega") { setCode = "00m"; num = code; }                     // 0M1, 1M1… (o set na frente ordena)
  else if (kind === "digital") { setCode = "00d"; num = `D${n}`; }
  else if (kind === "w") { setCode = "00w"; num = `W${n}`; }
  else if (kind === "joke") { setCode = "00j"; num = code.replace(/^\d+/, ""); }  // AFD, SPD1…
  else if (kind === "legends") num = `F${n}`;                               // numeração própria, F1–F18 por set
  // O "Forth the Three Hunters!" (15C60) saiu com três artes; o PC guarda as
  // outras duas como 2060 e 3060. Na carta o número é 60 nas três.
  else if (kind === "base" && n >= 1000) num = `${n % 1000}-${Math.floor(n / 1000)}`;
  else num = `${n}${suffix}`;                                               // 284, 1T, 29H; Masterworks seguem a numeração (195+)

  const id = ID_PREFIX + code.toLowerCase().replace(/\+/g, "plus");
  const img = String(row.TLHH_ImageNum || "").trim();
  return {
    id,
    code,
    set: setCode,
    num,
    // "Título, Subtítulo" é como o MYP e a comunidade escrevem; a Tengwar leva
    // o "(T)" de lá (com "(Tengwar)" a busca do MYP não acha nada).
    name: (subtitle ? `${title}, ${subtitle}` : title) + (suffix === "T" ? " (T)" : ""),
    rarity: suffix === "T" ? "Tengwar" : rarity,
    kind,
    ...(culture ? { culture } : {}),
    ...(type ? { type } : {}),
    img: img && images.has(img) ? img : ""
  };
}

// Reaproveita o id da carta já conhecida (mesmo código impresso) e mantém no
// snapshot o que a fonte deixou de listar.
export function mergeSnapshotCards(fresh, known = []) {
  const byCode = new Map(known.map((c) => [c.code, c]));
  const out = fresh.map((c) => (byCode.has(c.code) ? { ...c, id: byCode.get(c.code).id } : c));
  const seen = new Set(out.map((c) => c.code));
  for (const k of known) if (!seen.has(k.code)) out.push(k);
  return out;
}

// Zip mínimo (diretório central + deflate), só pro export do PC: evita
// dependência e unzip no CI. Devolve { nome: Buffer }.
export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("zip sem diretório central");
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let k = 0; k < total; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("zip: entrada inválida");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataAt, dataAt + size);
    out[name] = method === 8 ? inflateRawSync(data) : Buffer.from(data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function fetchBuf(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    } catch { /* tenta de novo */ }
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  return null;
}

export function snapshotFromExport(files, images) {
  const dec = new TextDecoder("windows-1252");
  const table = (name) => {
    const key = Object.keys(files).find((k) => k.toLowerCase().endsWith(`dbo.${name.toLowerCase()}.csv`));
    if (!key) throw new Error(`export sem dbo.${name}.csv`);
    return parseTsv(dec.decode(files[key]));
  };
  const setNumberById = new Map(table("Sets").map((s) => [s.ID, Number(s.SetNumber)]));
  const cultures = new Map(table("Cultures").map((c) => [c.ID, c]));
  const types = new Map(table("CardTypes").map((t) => [t.ID, t.Name]));
  // Texts: LanguageID 2 = inglês de exibição; TextTypeID 4 = título, 5 = subtítulo.
  const titles = new Map();
  const subtitles = new Map();
  for (const t of table("Texts")) {
    if (t.LanguageID !== "2" || !t.CardID) continue;
    if (t.TextTypeID === "4") titles.set(t.CardID, t.Text.trim());
    else if (t.TextTypeID === "5") subtitles.set(t.CardID, t.Text.trim());
  }
  const cards = [];
  for (const row of table("Cards")) {
    const setNumber = setNumberById.get(row.SetID);
    if (setNumber === undefined || setNumber < 0 || setNumber > 19) continue;
    const cult = cultures.get(row.CultureID);
    // O Ringwraith virou "Wraith" a partir do Shadows (set 11): vale o que
    // está impresso na carta.
    const culture = cult ? (setNumber >= 11 ? cult.PostShadowsName : cult.Name) : "";
    const card = cardFromRow(row, {
      setNumber,
      title: titles.get(row.ID) || row.Title,
      subtitle: subtitles.get(row.ID) || row.Subtitle || "",
      culture,
      type: types.get(row.CardTypeID) || "",
      images
    });
    if (card) cards.push(card);
  }
  return cards;
}

async function importar(existing) {
  console.log(`  baixando ${EXPORT_URL}`);
  const zip = await fetchBuf(EXPORT_URL);
  if (!zip) { console.log("  export do PC inacessível — snapshot mantido."); return existing; }
  const html = await fetchBuf(IMG_INDEX);
  if (!html) { console.log("  índice de imagens inacessível — snapshot mantido."); return existing; }
  const images = new Set([...html.toString("utf8").matchAll(/href="(LOTR[^"/]+)\.jpg"/g)].map((m) => m[1]));
  const fresh = snapshotFromExport(unzip(zip), images);
  const known = (existing && existing.sets || []).flatMap((s) => s.cards || []);
  const all = mergeSnapshotCards(fresh, known);
  const sets = SETS.map((def) => ({ code: def.code, cards: all.filter((c) => c.set === def.code).map(({ set, ...c }) => c) }))
    .filter((s) => s.cards.length);
  const candidate = { source: EXPORT_URL, images: IMG_INDEX, importedAt: new Date().toISOString().slice(0, 10), sets };
  const n = snapshotCardCount(candidate);
  const antes = snapshotCardCount(existing);
  console.log(`  export: ${fresh.length} cartas, ${fresh.filter((c) => c.img).length} com imagem (snapshot: ${antes}).`);
  if (n < antes) { console.log(`  ⚠ REGRESSÃO (${n} < ${antes}) — snapshot mantido.`); return existing; }
  await writeSnapshot(SNAP, candidate);
  return candidate;
}

// ---------------------------------------------------------------------------
// Do snapshot pro catálogo
// ---------------------------------------------------------------------------

export const imageUrl = (file) => (file
  ? `https://wsrv.nl/?url=${encodeURIComponent(`i.lotrtcgpc.net/decipher/${file}.jpg`)}&w=440&we&output=webp`
  : "");

// Foil como variante: só nos sets 1–8 e 10, e só nas cartas de booster (C/U/R)
// — Premium, Tengwar e promos saíram de outro jeito. Reflections: todo foil.
// Legends e Masterworks são as foils do Shadows em diante.
export function variantsOf(card, setCode) {
  if (card.kind === "legends" || card.kind === "masterwork") return ["Foil"];
  if (setCode === "09") return ["Foil"];
  const n = Number(setCode);
  const booster = ["Common", "Uncommon", "Rare"].includes(card.rarity);
  if (booster && n >= 1 && n <= 10) return ["Normal", "Foil"];
  return ["Normal"];
}

// Total oficial: o maior número das cartas "de linha" do set (sem Tengwar,
// Legends, Masterworks). Nos sets de promo especiais, sem total (a página
// conta as cartas).
export function setTotalOf(cards, def) {
  if (def.promo && def.code !== "00") return "";
  let max = 0;
  for (const c of cards) {
    if (c.kind !== "base" || !/^\d+$/.test(c.num)) continue;
    max = Math.max(max, Number(c.num));
  }
  return max ? String(max) : "";
}

async function build(snapshot) {
  const outDir = new URL(`data/${GAME}/`, ROOT);
  const line = [];
  let comImagem = 0;
  for (const s of snapshot.sets || []) {
    const def = SET_BY_CODE.get(s.code);
    if (!def) continue;
    const total = setTotalOf(s.cards, def);
    for (const c of s.cards) {
      const image = imageUrl(c.img);
      if (image) comImagem++;
      line.push({
        id: c.id,
        name: c.name,
        set: def.name,
        setId: `${ID_PREFIX}${def.code}`,
        number: c.num,
        ...(total ? { setTotal: total } : {}),
        setReleaseDate: def.date,
        rarity: c.rarity,
        artist: "",
        language: "en",
        image,
        variants: variantsOf(c, s.code),
        setLogo: "",
        vintage: true,
        ...(c.culture ? { culture: c.culture } : {}),
        ...(c.type ? { cardType: c.type } : {})
      });
    }
  }
  const existing = (await readGlobalVar(new URL("cards.js", outDir), "TCG_CARDS")) || [];
  // Carta publicada nunca some (alguém pode tê-la na coleção).
  const have = new Set(line.map((c) => c.id));
  const kept = existing.filter((c) => c && c.id && !have.has(c.id));
  const merged = line.concat(kept);
  await writeGameCatalog(outDir, { cards: merged, pricing: {}, webDir: `data/${GAME}/` });
  console.log(`  ${GAME}: ${line.length} cartas (${(snapshot.sets || []).length} sets, ${comImagem} com imagem) -> ${merged.length} totais`);
}

async function run() {
  console.log("The Lord of the Rings TCG (Decipher 2001–2007, vintage)");
  let snapshot = await readSnapshot(SNAP);
  if (process.argv.includes("--importar")) snapshot = await importar(snapshot);
  if (!snapshot || !snapshot.sets) { console.log("  sem snapshot — rode com --importar."); return; }
  await build(snapshot);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
export { SETS };
