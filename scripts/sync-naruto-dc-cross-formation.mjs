// Data Carddass NARUTO — ナルティメットフォーメーション (2007–10) e
// ナルティメットクロス (2009–10): as duas séries do arcade que faltavam.
//
// Fonte: catálogo estruturado do Suruga-ya (categoria 501080113), snapshot
// versionado em data/vintage/naruto-dc-suruga.json. O anti-bot do site barra
// fetch server-side, então NÃO há refresh automático: a re-coleta é manual
// (Browser pane) e o snapshot nunca regride. Cobertura parcial por natureza
// (é o acervo público da loja) — os sets crescem conforme a re-coleta.
//
// Formato do item: { t: "NX-003[NR]：うずまきナルト(...)", s: "<série/capítulo>", d: "2009/01/25" }
// ANEXA ao catálogo do Naruto (ids nrt-nx-*/nrt-nf-*); roda DEPOIS dos outros
// syncs do Naruto no CI. Imagens: placeholder (fotos de loja não são fonte
// limpa); imagens curadas do dono entram por assets/cards/naruto/<id>.*.
//
//   node scripts/sync-naruto-dc-cross-formation.mjs
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readGlobalVar, writeGameCatalog } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/naruto/", ROOT);
const SNAP = new URL("data/vintage/naruto-dc-suruga.json", ROOT);

// Mesmo mecanismo de imagem curada do sync vintage (assets/cards/naruto/<id>.*).
function curatedImg(id) {
  for (const ext of ["webp", "jpg", "png"]) {
    if (existsSync(fileURLToPath(new URL(`assets/cards/naruto/${id}.${ext}`, ROOT)))) {
      return `/assets/cards/naruto/${id}.${ext}`;
    }
  }
  return null;
}

// Normaliza fullwidth (ＮＦ→NF, Ｎ→N) e espaços ideográficos.
const normalize = (s) => String(s || "").replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, " ").trim();

// "NX-003[NR]：うずまきナルト(...)" -> { num, rarity, name }
function parseTitle(raw) {
  const t = normalize(raw);
  const m = t.match(/^([A-Za-z0-9-]+(?:\s?[IVX]+)?)\s*(?:\[([^\]]+)\])?[：:](.+)$/);
  if (!m) return null;
  return { num: m[1].replace(/\s+/g, ""), rarity: (m[2] || "").trim(), name: m[3].trim() };
}

// Linha pela SÉRIE (nome contém フォーメーション/クロス); fallback pela família
// do número (NF* -> Formation) — cobre promos tipo VJCF-2008 que só o nome
// da série situa na era certa.
const lineOf = (num, serie) => {
  if (/フォーメーション/.test(serie || "")) return "nf";
  if (/クロス/.test(serie || "")) return "nx";
  return /^NF/i.test(num) ? "nf" : "nx";
};

async function run() {
  console.log("Data Carddass NARUTO — Formation + Cross (Suruga-ya snapshot)");
  const snap = JSON.parse(await readFile(SNAP, "utf8"));
  const items = [...(snap.cross || []), ...(snap.formation || [])];

  // Ids pegajosos: número -> id já publicado (coleções referenciam ids).
  const existing = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const idByNum = new Map();
  for (const c of existing) {
    if (/^nrt-(nx|nf)-/.test(String(c.id)) && c.number && !idByNum.has(c.number)) idByNum.set(c.number, c.id);
  }

  // Dedupe por número (variantes de raridade da loja = mesma carta física
  // catalogada 2x; fica a primeira, que vem primeiro no acervo).
  const byNum = new Map();
  for (const it of items) {
    const p = parseTitle(it.t);
    if (!p || byNum.has(p.num)) continue;
    byNum.set(p.num, { ...p, serie: normalize(it.s), date: (it.d || "").replace(/\//g, "-") });
  }

  // Sets: nome do capítulo/série; data = menor data vista no set.
  const setsOut = new Map();
  for (const card of byNum.values()) {
    const line = lineOf(card.num, card.serie);
    const setName = `Data Carddass — ${card.serie}`;
    if (!setsOut.has(setName)) setsOut.set(setName, { line, date: card.date || "9999", cards: [] });
    const s = setsOut.get(setName);
    if (card.date && card.date < s.date) s.date = card.date;
    s.cards.push(card);
  }

  const linePrefix = { nx: "nrt-nx", nf: "nrt-nf" };
  const lineTag = { nx: "nrt-nx", nf: "nrt-nf" };
  const cardsNew = [];
  // Ordem: Formation (2007) antes de Cross (2009); dentro, por data e nome.
  const ordered = [...setsOut.entries()].sort((a, b) => (a[1].date + a[0]).localeCompare(b[1].date + b[0], "ja"));
  ordered.forEach(([setName, s], i) => {
    const setId = `${linePrefix[s.line]}-s${String(i + 1).padStart(2, "0")}`;
    const cmp = (a, b) => String(a.num).localeCompare(String(b.num), "ja", { numeric: true });
    for (const c of s.cards.sort(cmp)) {
      const cardId = idByNum.get(c.num) || `${linePrefix[s.line]}-${c.num.toLowerCase()}`;
      cardsNew.push({
        id: cardId,
        name: c.name,
        set: setName,
        setId,
        number: c.num,
        setTotal: s.cards.length, // acervo conhecido (parcial por natureza)
        setReleaseDate: s.date === "9999" ? "" : s.date,
        rarity: c.rarity,
        artist: "",
        language: "ja",
        image: curatedImg(cardId) || "",
        variants: ["Normal"],
        setLogo: "/assets/games/game_naruto.webp",
        vintage: true,
        vintageLine: lineTag[s.line]
      });
    }
  });

  const kept = existing.filter((c) => c && !/^nrt-(nx|nf)-/.test(String(c.id)));
  const have = new Set(kept.map((c) => c.id));
  const merged = kept.concat(cardsNew.filter((c) => !have.has(c.id)));
  const pricing = (await readGlobalVar(new URL("pricing.js", OUT), "TCG_PRICING")) || {};
  const nx = cardsNew.filter((c) => c.vintageLine === "nrt-nx").length;
  const nf = cardsNew.filter((c) => c.vintageLine === "nrt-nf").length;
  console.log(`  build: ${cardsNew.length} cartas (${nx} Cross, ${nf} Formation) em ${setsOut.size} sets.`);
  await writeGameCatalog(OUT, { cards: merged, pricing, webDir: "data/naruto/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} — ${merged.length} cartas totais.`);
}

await run();
