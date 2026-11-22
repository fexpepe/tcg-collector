// 鋼の錬金術師 (Fullmetal Alchemist): as cartas de máquina da Bandai do anime
// de 2003, no jogo vintage `fma` ("Fullmetal Alchemist Carddass", em
// data/fma/), uma seção por produto (groupFmaSets no app.js):
//   acb    カードダス 鋼の錬金術師 ALCHEMIC CARD BATTLE (2004–2005): o card
//          game, vendido na máquina de Carddass (4 cartas) e em pacote de 6
//          da linha カードダスEX, com deck pronto de 30. Quatro FILE de booster
//          com numeração ÚNICA no jogo inteiro (C-001 a C-108 personagens,
//          B-001 a B-099 batalhas, E-001 a E-090 eventos).
//   jumbo  ジャンボカードダス クリアプレート 鋼の錬金術師 アルケミストプレート
//          コレクション (2004–2005): placas transparentes de ¥100 da máquina
//          de Jumbo Carddass, três séries de 10, 10 e 9. Ficam no mesmo jogo
//          por serem o Carddass da mesma IP (o precedente é a jumbo dentro do
//          Saint Seiya Carddass; decisão do Fernando em 2026-11-22).
// O Carddass Masters do FMA (2004–2005) é outro jogo: vai no `cdm`, como IP
// dele (sync-carddass-masters.mjs).
//
// Fontes (levantamento de 2026-11-22):
//   animecollection.fr — catálogo de fã (francês), licença idl=15, uma página
//       por parte: número impresso, raridade e um scan da FRENTE por carta
//       (~1000 px, com a marca d'água do site, como no Evangelion do cdm). Só
//       responde em HTTP; a imagem sai pelo wsrv.nl. Medido em 2026-11-22:
//       57 + 96 + 77 + 67 cartas no ACB e 10 + 10 + 9 placas, e as faixas de
//       número de cada FILE batem uma a uma com o Card Check Box. Todas com
//       scan, menos quatro do FILE.4 (SEM_SCAN, abaixo). NÃO dá o nome.
//   nome — impresso na frente do ACB (nome do personagem, da batalha ou do
//       evento): TRANSCRITO dos scans em scripts/data/fma-nomes.json, junto do
//       tipo impresso no topo (MAIN CHARACTER, SUPPORT CHARACTER, BATTLE,
//       EVENT). A placa não imprime nome: o nome é quem aparece nela, nosso
//       (o critério das CR do Evangelion no cdm).
//   datas e composição — Card Check Box (cardcheckbox.com/a06a-bandai-3/
//       cdds-hagaren-acb.html) pro ACB; pras placas, o levantamento da
//       キャラクターグッズ研究所 (dream-hobby.hatenablog.com/entry/2024/03/20/
//       070719). Só o mês, que é o que as duas dão.
// Ficam de fora, sem lista carta a carta achada: a コインプラス (CC-001 a
// CC-008, 2004-11), o EXTRA FILE do filme (2005-07-25, 45 novas e paralelas
// das antigas) e as promos (P e PR).
//
// IDs: fma-<parte>-<número impresso> (fma-f1-c-001, fma-pl1-1). O id fica
// GRAVADO no snapshot junto do id da carta na fonte (`src`): reordenar a
// página da fonte não troca id, e carta que some da fonte fica.
//
//   node scripts/sync-fma.mjs             # fetch (se der) + build
//   node scripts/sync-fma.mjs --no-fetch  # só build do snapshot
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog, sleep } from "./lib/sync-common.mjs";
import { parseAnimeCollection } from "./sync-gundam-carddass.mjs";

const ROOT = new URL("../", import.meta.url);
const SNAP = new URL("data/vintage/fma-carddass.json", ROOT);
const NOMES = JSON.parse(readFileSync(new URL("scripts/data/fma-nomes.json", ROOT), "utf8"));
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
const NO_FETCH = process.argv.includes("--no-fetch");
export const GAME = "fma";
export const ID_PREFIX = "fma-";
const FONTE = "www.animecollection.fr"; // sem esquema: o wsrv busca em HTTP, que é o que o site serve
const LICENCA = 15; // idl da licença Fullmetal Alchemist no animecollection

// Produtos (seções da página de Sets). `ja`/`en` abrem o nome do set (contrato
// 7: sem o 鋼の錬金術師 da frente, que é a marca, nem o nome do jogo).
export const SERIES = {
  acb: { ja: "ALCHEMIC CARD BATTLE", en: "Alchemic Card Battle" },
  jumbo: { ja: "", en: "" }
};

// Partes, na ordem de lançamento. `ac`: [coleção, série] no animecollection.
// `lista`: a chave da parte em fma-nomes.json. Datas: o mês do Card Check Box
// (ACB) e da キャラクターグッズ研究所 (placas). O nome do ACB é o da embalagem
// ("ALCHEMIC CARD BATTLE FILE.1"); o das placas, o do produto (a primeira não
// tem número).
export const SETS = [
  { code: "f1", series: "acb", date: "2004-05", ac: [47, 106], ja: "FILE.1", en: "File 1" },
  { code: "f2", series: "acb", date: "2004-08", ac: [47, 187], ja: "FILE.2", en: "File 2" },
  { code: "f3", series: "acb", date: "2004-10", ac: [47, 161], ja: "FILE.3", en: "File 3" },
  { code: "f4", series: "acb", date: "2005-01", ac: [47, 188], ja: "FILE.4", en: "File 4" },
  { code: "pl1", series: "jumbo", date: "2004-06", ac: [30, 62], ja: "アルケミストプレートコレクション", en: "Alchemist Plate Collection" },
  { code: "pl2", series: "jumbo", date: "2004-10", ac: [30, 63], ja: "アルケミストプレートコレクション2", en: "Alchemist Plate Collection 2" },
  { code: "pl3", series: "jumbo", date: "2005-07", ac: [30, 177], ja: "アルケミストプレートコレクション3", en: "Alchemist Plate Collection 3" }
];
const SET_BY_CODE = new Map(SETS.map((s) => [s.code, s]));
const SET_ORDER = new Map(SETS.map((s, i) => [s.code, i]));

export const setName = (def) => [SERIES[def.series].ja, def.ja].filter(Boolean).join(" ");
export const setNameEn = (def) => [SERIES[def.series].en, def.en].filter(Boolean).join(" ");
export const setIdOf = (code) => `${ID_PREFIX}${code}`;
const numKey = (num) => String(num).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Raridade: a do site. No ACB, "Regular" é a comum do card game (o resto,
// Uncommon, Rare e Super Rare, passa como veio); nas placas, as duas "Rare" de
// cada série ficam Rare e as outras, Common.
export const raridade = (rar) => (rar === "Normal" || rar === "Regular" ? "Common" : rar || "");

// Tipo do ACB: o impresso no topo da carta (fma-nomes.json); sem leitura, o
// prefixo do número (C = personagem, B = batalha, E = evento).
const TIPO_DO_PREFIXO = { C: "Character", B: "Battle", E: "Event" };
export function tipoDe(num, lido) {
  if (lido) return lido;
  return TIPO_DO_PREFIXO[(String(num).match(/^([CBE])-/) || [])[1]] || "";
}

async function fetchPage(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
      // A página é ISO-8859-1 (o cabeçalho diz): decodifica como tal.
      if (r.ok) return new TextDecoder("latin1").decode(await r.arrayBuffer());
    } catch { /* retry */ }
    await sleep(1000 * (i + 1));
  }
  return null; // fonte fora do ar
}

// Casa as cartas da página com as do snapshot pelo id DA FONTE (`src`) pra
// manter o id. Carta nova: fma-<parte>-<número>, com sufixo (b, c…) se o id
// já está tomado na parte. Carta do snapshot que saiu da fonte continua.
export function assignIds(setCode, fresh, known = []) {
  const porSrc = new Map(known.map((c) => [c.src, c]));
  const used = new Set(known.map((c) => c.id));
  const visto = new Set();
  const out = [];
  for (const c of fresh) {
    if (visto.has(c.src)) continue; // a mesma carta duas vezes na página
    visto.add(c.src);
    const antiga = porSrc.get(c.src);
    let id = antiga && antiga.id;
    if (!id) {
      const base = `${setIdOf(setCode)}-${numKey(c.num) || "x"}`;
      id = base;
      for (let i = 1; used.has(id); i++) id = `${base}${String.fromCharCode(97 + i)}`;
      used.add(id);
    }
    out.push({ id, src: c.src, num: c.num, rar: raridade(c.rar), dir: c.dir });
  }
  for (const k of known) if (!visto.has(k.src)) out.push(k);
  return out;
}

async function refreshSnapshot(existing) {
  const knownSets = new Map((existing?.sets || []).map((s) => [s.code, s.cards || []]));
  const sets = [];
  let reached = 0;
  for (const def of SETS) {
    const html = await fetchPage(`http://${FONTE}/cartes.php?idl=${LICENCA}&idc=${def.ac[0]}&ids=${def.ac[1]}`);
    const known = knownSets.get(def.code) || [];
    if (html !== null) reached++;
    const fresh = html ? parseAnimeCollection(html) : [];
    // Parte que a fonte não devolveu (ou que o parser não entendeu) fica como
    // estava no snapshot.
    const cards = fresh.length ? assignIds(def.code, fresh, known) : known;
    if (cards.length) sets.push({ code: def.code, cards });
    await sleep(1200); // site pequeno, de fã: uma página por segundo
  }
  if (!reached) { console.log("  animecollection inacessível — segue com o snapshot versionado."); return existing; }
  for (const [code, cards] of knownSets) if (!sets.some((s) => s.code === code) && cards.length) sets.push({ code, cards });
  sets.sort((a, b) => (SET_ORDER.get(a.code) ?? 999) - (SET_ORDER.get(b.code) ?? 999));
  const candidate = { source: `http://${FONTE}/cartes.php?idl=${LICENCA}`, updatedAt: new Date().toISOString().slice(0, 10), sets };
  const newCount = snapshotCardCount(candidate);
  const oldCount = snapshotCardCount(existing);
  console.log(`  animecollection: ${sets.length} partes, ${newCount} cartas (snapshot: ${oldCount}).`);
  if (newCount < oldCount) { console.log(`  ⚠ REGRESSÃO (${newCount} < ${oldCount}) — snapshot mantido.`); return existing; }
  const same = existing && JSON.stringify((existing.sets || []).map((s) => s.cards)) === JSON.stringify(sets.map((s) => s.cards));
  if (!same) await writeSnapshot(SNAP, candidate);
  return (await readSnapshot(SNAP)) || candidate;
}

// URL de ORIGEM do scan grande (sem esquema), e a do catálogo pelo wsrv. O
// "h3000" é o nome que a fonte dá à versão HD (na prática ~1000 px).
export const scanDe = (c) => `${FONTE}/cartes/${c.dir}/h3000_${c.src}_carte.jpg`;
export const IMG = (src) => `https://wsrv.nl/?url=${encodeURIComponent(src)}&w=440&output=webp`;

// Cartas que a fonte lista SEM scan: a página mostra a imagem genérica "Scan à
// venir" do site (12 KB, a mesma nas quatro; achadas comparando os arquivos em
// 2026-11-22). Número e raridade valem; a imagem fica vazia até a fonte (ou o
// dono) ter o scan. Sem scan, ninguém leu o nome: o catálogo mostra o número.
// A chave é o id da carta na fonte.
export const SEM_SCAN = {
  7408: "FILE.4 B-086", 7409: "FILE.4 B-087", 7345: "FILE.4 C-087", 7347: "FILE.4 C-089"
};

// Imagem CURADA do dono substitui o scan (mesmo mecanismo dos outros vintages).
function curatedImg(id) {
  for (const ext of ["webp", "jpg", "png"]) {
    if (existsSync(fileURLToPath(new URL(`assets/cards/${GAME}/${id}.${ext}`, ROOT)))) return `/assets/cards/${GAME}/${id}.${ext}`;
  }
  return "";
}

// Cartas do jogo a partir do snapshot e da lista de nomes (parte -> [{ n, ja,
// en, tipo }], pelo número impresso; o número das placas sem o zero da
// frente, como o parser devolve).
export function cartasDoJogo(snapshot, nomes = NOMES) {
  const out = [];
  for (const s of (snapshot && snapshot.sets) || []) {
    const def = SET_BY_CODE.get(s.code);
    if (!def) continue;
    const lista = new Map((nomes[s.code] || []).map((l) => [String(l.n), l]));
    for (const c of s.cards) {
      const l = lista.get(String(c.num)) || {};
      const ja = l.ja || "";
      const en = l.en || "";
      out.push({
        id: c.id,
        // Sem nome transcrito (carta nova na fonte): o número, que é o que a
        // carta tem de certo. Não se inventa nome.
        name: en || ja || `No. ${c.num}`,
        ...(en && ja && en !== ja ? { nameJp: ja } : {}),
        set: setName(def),
        setId: setIdOf(s.code),
        number: c.num,
        setTotal: s.cards.length,
        setReleaseDate: def.date,
        rarity: c.rar || "",
        ...(def.series === "acb" ? { cardType: tipoDe(c.num, l.tipo) } : {}),
        artist: "",
        language: "ja",
        image: curatedImg(c.id) || (SEM_SCAN[c.src] ? "" : IMG(c.img || scanDe(c))),
        variants: ["Normal"],
        // Sem logo de set: nenhuma parte tem logo próprio no catálogo, e o
        // cartão do set mostra o nome (contrato 3 do docs/CATALOGO.md).
        setLogo: "",
        vintage: true,
        vintageLine: def.series
      });
    }
  }
  return out;
}

async function build(snapshot) {
  const out = new URL(`data/${GAME}/`, ROOT);
  const line = cartasDoJogo(snapshot);
  const existing = (await readGlobalVar(new URL("cards.js", out), "TCG_CARDS")) || [];
  // Carta publicada nunca some: a que saiu da fonte fica congelada.
  const have = new Set(line.map((c) => c.id));
  const merged = line.concat(existing.filter((c) => c && c.id && !have.has(c.id)));
  const pricing = (await readGlobalVar(new URL("pricing.js", out), "TCG_PRICING")) || {}; // sem preço
  await writeGameCatalog(out, { cards: merged, pricing, webDir: `data/${GAME}/` });
  const semNome = line.filter((c) => /^No\. /.test(c.name)).length;
  const partes = new Set(line.map((c) => c.setId)).size;
  console.log(`  ${GAME}: ${line.length} cartas em ${partes} partes (${semNome} sem nome) -> ${merged.length} totais`);
}

async function run() {
  console.log("Fullmetal Alchemist Carddass: Alchemic Card Battle e Alchemist Plate Collection (Bandai, 2004–2005, vintage)");
  let snapshot = await readSnapshot(SNAP);
  if (!NO_FETCH) snapshot = await refreshSnapshot(snapshot);
  if (!snapshot || !snapshot.sets) { console.log("  sem snapshot e sem fetch — nada a fazer."); return; }
  await build(snapshot);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
