// Data Carddass NARUTO — ナルティメットフォーメーション (2007–10) e
// ナルティメットクロス (2009–10): as duas séries do arcade que faltavam.
//
// Duas fontes, as duas em snapshot versionado (sem rede no build):
//   1. As listas OFICIAIS da Bandai no Wayback (data/vintage/naruto-dc-oficial.json,
//      ver scripts/lib/naruto-dc-oficial.mjs): dizem QUAIS cartas existem, o
//      nome e a série. Desde 04/11/2026 são a fonte principal — a Formation
//      passou de 91 para 344 cartas de capítulo, a Cross de 243 para 342.
//   2. O catálogo do Suruga-ya (categoria 501080113, data/vintage/naruto-dc-suruga.json):
//      a RARIDADE (as listas oficiais não dão, só o PDF de checklist da Cross)
//      e as cartas que a lista oficial capturada não tem (NX-173–177 e 179, da
//      2ª página do 第4章 que o Wayback guardou incompleta; NX-SP, NX-CAM004,
//      NXP-009, VJCF-2008). O anti-bot do site barra fetch server-side: a
//      re-coleta é manual (Browser pane) e o snapshot nunca regride.
//
// Formato do item do Suruga-ya: { t: "NX-003[NR]：うずまきナルト(...)", s: "<série/capítulo>", d: "2009/01/25" }
// ANEXA ao catálogo do Naruto (ids nrt-nx-*/nrt-nf-*); roda DEPOIS dos outros
// syncs do Naruto no CI. Imagens: placeholder (fotos de loja não são fonte
// limpa); imagens curadas do dono entram por assets/cards/naruto/<id>.*.
// No site, Formation e Cross são SEÇÕES da linha nrt-dc (o arcade Data
// Carddass inteiro), não linhas próprias — ver GAME_LINES no shared.js. O
// `vintageLine` das cartas continua dizendo o título (nrt-nf/nrt-nx).
//
//   node scripts/sync-naruto-dc-cross-formation.mjs
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readGlobalVar, writeGameCatalog } from "./lib/sync-common.mjs";
import { capituloDaCarta, chaveDoSet, nomeDoSet, dataDoSet, atribuiSetIds, totalDoSet, NAO_E_FORMATION } from "./lib/naruto-dc-capitulos.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/naruto/", ROOT);
const SNAP = new URL("data/vintage/naruto-dc-suruga.json", ROOT);
const OFICIAL = new URL("data/vintage/naruto-dc-oficial.json", ROOT);

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

// Raridade: o Suruga-ya escreve a SIGLA impressa na carta (N, R, SR, UR, NR,
// NP, SP, WNR, P) quase sempre, mas às vezes o nome por extenso em japonês —
// e a mesma promo aparecia como "P", "プロモ" e "プロモーションカード", três
// opções no filtro de raridade pra uma coisa só (2026-11-01). Aqui vira a
// sigla; o que não tem sigla impressa vai em inglês, como o resto do jogo.
const RARIDADE_JP = {
  "プロモ": "P",
  "プロモーションカード": "P",
  "ホログラフィックレア": "HR",
  "銀ホロカード": "Silver Holo",
  "デザインレア": "Design Rare"
};

// "NX-003[NR]：うずまきナルト(...)" -> { num, rarity, name }
function parseTitle(raw) {
  const t = normalize(raw);
  const m = t.match(/^([A-Za-z0-9-]+(?:\s?[IVX]+)?)\s*(?:\[([^\]]+)\])?[：:](.+)$/);
  if (!m) return null;
  const rarity = (m[2] || "").trim();
  return { num: m[1].replace(/\s+/g, ""), rarity: RARIDADE_JP[rarity] || rarity, name: m[3].trim() };
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
  console.log("Data Carddass NARUTO — Formation + Cross (listas oficiais + Suruga-ya)");
  const snap = JSON.parse(await readFile(SNAP, "utf8"));
  const oficial = JSON.parse(await readFile(OFICIAL, "utf8").catch(() => "null")) || {};
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
    // Carta de outro título que a loja pôs numa série daqui (a CAN-001 é da
    // Mission): quem monta é o sync do título dela.
    if (NAO_E_FORMATION.has(p.num)) continue;
    byNum.set(p.num, { ...p, serie: normalize(it.s), date: (it.d || "").replace(/\//g, "-") });
  }
  const soDoSuruga = byNum.size;

  // A lista oficial por cima: o nome e a série são os dela (o Suruga-ya
  // escreve "ディダラ", tira o "(第一部)" e põe a NFC-016 e a NFF-008 num set
  // "ナルティメットフォーメーション" sem série); a raridade fica a do
  // Suruga-ya, que é quem tem (a do PDF de checklist só quando ele não tem).
  // Carta de capítulo vai pelo número, então a série vazia dela não importa.
  let daOficial = 0, casadas = 0;
  for (const o of [...(oficial.formation || []), ...(oficial.cross || [])]) {
    if (NAO_E_FORMATION.has(o.num)) continue;
    const s = byNum.get(o.num);
    if (s) casadas++; else daOficial++;
    byNum.set(o.num, {
      num: o.num,
      name: o.name,
      rarity: (s && s.rarity) || o.rarity || "",
      serie: o.serie || (s && s.serie) || "",
      date: (s && s.date) || ""
    });
  }
  console.log(`  ${byNum.size} cartas: ${casadas} nas duas fontes, ${daOficial} só na lista oficial, ${soDoSuruga - casadas} só no Suruga-ya.`);

  // Sets: um por CAPÍTULO oficial e, fora deles, um por série do anúncio. O
  // capítulo sai da faixa de numeração do site oficial, não da série do
  // Suruga-ya — ela partia capítulo em dois ("第2章" e "第2章 再会！…") e punha
  // carta no capítulo errado. Nome, data e fontes: lib/naruto-dc-capitulos.mjs.
  const setsOut = new Map();
  let foraDaSerie = 0;
  for (const card of byNum.values()) {
    const line = lineOf(card.num, card.serie);
    const cap = capituloDaCarta(line, card.num, card.serie);
    if (cap && card.serie && cap !== capituloDaCarta(line, "", card.serie)) foraDaSerie++;
    const chave = chaveDoSet(line, cap, card.serie);
    if (!setsOut.has(chave)) setsOut.set(chave, { line, name: nomeDoSet(chave, card.serie), dates: [], cards: [] });
    const s = setsOut.get(chave);
    s.dates.push(card.date);
    s.cards.push(card);
  }
  for (const [chave, s] of setsOut) s.date = dataDoSet(chave, s.dates);
  if (foraDaSerie) console.log(`  ${foraDaSerie} carta(s) no capítulo da faixa oficial, não no da série do Suruga-ya.`);

  // setId pegajoso: cada capítulo/série fica com o id que já tem publicado (era
  // a posição na ordem por data, e corrigir uma data renumerava os sets).
  const publicados = existing.filter((c) => /^nrt-(nx|nf)-/.test(String(c.id))).map((c) => ({ setId: c.setId, set: c.set }));
  const { ids, juntados } = atribuiSetIds([...setsOut].map(([chave, s]) => ({ chave, linha: s.line })), publicados);
  for (const j of juntados) console.log(`  set ${j.de} juntou no ${j.para} (${j.chave}) — registre o de-para em data/card-id-merges.json`);

  const linePrefix = { nx: "nrt-nx", nf: "nrt-nf" };
  const lineTag = { nx: "nrt-nx", nf: "nrt-nf" };
  const cardsNew = [];
  // Ordem do catálogo: pelo número do setId, estável como ele (as telas
  // ordenam por data sozinhas). Não é detalhe: o slug da página /set/ de nome
  // japonês é "data-carddass-<dígitos>" e desempata pela ordem do catálogo —
  // ordenar por data trocava de set 10 dessas URLs a cada data corrigida.
  const numeroDoSet = ([chave]) => Number(ids.get(chave).replace(/^.*-s/, ""));
  const ordered = [...setsOut.entries()].sort((a, b) => numeroDoSet(a) - numeroDoSet(b));
  ordered.forEach(([chave, s]) => {
    const setId = ids.get(chave);
    const cmp = (a, b) => String(a.num).localeCompare(String(b.num), "ja", { numeric: true });
    for (const c of s.cards.sort(cmp)) {
      const cardId = idByNum.get(c.num) || `${linePrefix[s.line]}-${c.num.toLowerCase()}`;
      cardsNew.push({
        id: cardId,
        name: c.name,
        set: s.name,
        setId,
        number: c.num,
        setTotal: totalDoSet(chave, s.cards),
        setReleaseDate: s.date,
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
