// ポケモンカードダス (Pokémon Carddass): as cartas de máquina Carddass da
// Bandai com os 151 Pokémon de Red e Green, em 1996 e 1997 — o jogo vintage
// pcd. São cartas de coleção, não de batalha (sem HP nem ataque): a frente é a
// arte, o verso é a ficha do Pokémon. Quatro partes, um set cada:
//   p1  パート1 (fim de setembro de 1996): 75 Pokémon, cada um em VERDE e em
//       VERMELHO (as duas versões do jogo), a タイトルカード e as
//       カードリスト1–2, todas verdes: 153 cartas;
//   p2  パート2 (começo de outubro de 1996): os outros 76, nas duas cores, a
//       タイトルカード e as カードリスト3–4, vermelhas, e a タイトルカードEX,
//       azul: 156 cartas;
//   p3  パート3 (meados de abril de 1997) e
//   p4  パート4 (começo de junho de 1997): arte nova, uma carta por Pokémon
//       (74 e 77), mais uma SPECIAL CARDDASS em cada (a FILE No.000 e a
//       CARDDASS, com o checklist da parte no verso): 75 e 78 cartas.
// A série do anime (アニメコレクション, 1998–2000) é outro produto e fica de
// fora: nenhuma fonte acessível tem a lista carta a carta nem as imagens
// (levantamento de 2026-11-16, ver o ROADMAP).
//
// Fontes:
//   o que a carta imprime — quais Pokémon cada parte tem e o nome japonês de
//        cada um, transcritos dos checklists impressos em
//        scripts/data/pokemon-carddass.json (o cabeçalho de lá diz como). A
//        Bulbapedia tem a mesma lista (e foi com ela que se conferiu), mas ela
//        e o Bulbagarden Archives devolvem o desafio do Cloudflare ao Node
//        (403 em 2026-11-16), e fonte que recusa acesso automatizado não entra
//        no sync (contrato 4 do docs/CATALOGO.md).
//   animecollection.fr — número, raridade (Regular, Prism, Metal, Promo) e scan
//        das Partes 3 e 4, numa página só (a mesma fonte de fã do gcd e do
//        seiya, com o parser do gcd). Snapshot em
//        data/vintage/pokemon-carddass.json. Só responde em HTTP: a imagem sai
//        pelo wsrv.nl. As Partes 1 e 2 não estão lá: ficam SEM IMAGEM (e sem
//        raridade: cada cor tem 6 prismas, mas nenhuma fonte acessível diz
//        quais) até haver fonte — ou imagem curada em assets/cards/pcd/<id>.
//   nome em inglês — o oficial da espécie, pelo número (data/pokemon-names.js).
//
// IDs: pcd-<parte>-<cor>-<número impresso> nas Partes 1 e 2 (pcd-p1-g-025 e
// pcd-p1-r-025 são as duas Pikachu da Parte 1: a cor é parte da carta, como no
// Saint Seiya Crusade) e pcd-<parte>-<número> nas 3 e 4 (pcd-p3-025,
// pcd-p4-carddass). O número é o impresso e a lista é fixa (o produto é de
// 1996–97), então o id sai direto dele; carta publicada que sumir do catálogo
// gerado continua (build, abaixo).
//
//   node scripts/sync-pokemon-carddass.mjs             # fetch (se der) + build
//   node scripts/sync-pokemon-carddass.mjs --no-fetch  # só build do snapshot
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog, sleep } from "./lib/sync-common.mjs";
import { parseAnimeCollection } from "./sync-gundam-carddass.mjs";

const ROOT = new URL("../", import.meta.url);
const SNAP = new URL("data/vintage/pokemon-carddass.json", ROOT);
const OUT = new URL("data/pcd/", ROOT);
export const LISTAS = JSON.parse(readFileSync(new URL("scripts/data/pokemon-carddass.json", ROOT), "utf8"));
const NO_FETCH = process.argv.includes("--no-fetch");
export const ID_PREFIX = "pcd-";
const FONTE = "www.animecollection.fr"; // sem esquema: o wsrv busca em HTTP, que é o que o site serve
const PAGINA_34 = `http://${FONTE}/cartes.php?idl=19&idc=59&ids=130`; // Pokémon > Carddass > Part 3&4
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };

// As partes, na ordem de lançamento. `date`: o mês que a fonte dá (o anúncio
// da CoroCoro de outubro de 1996, "9月下旬発売" e "パート2は10月上旬ころ
// 発売", e o verso da jumbo da Pikachu de 1997, "4月中旬" e "6月上旬"), sem
// dia inventado. `cores`: a parte sai em verde e em vermelho.
export const SETS = [
  { code: "p1", date: "1996-09", ja: "パート1", en: "Part 1", cores: true },
  { code: "p2", date: "1996-10", ja: "パート2", en: "Part 2", cores: true },
  { code: "p3", date: "1997-04", ja: "パート3", en: "Part 3" },
  { code: "p4", date: "1997-06", ja: "パート4", en: "Part 4" }
];
const SET_BY_CODE = new Map(SETS.map((s) => [s.code, s]));
export const setIdOf = (code) => `${ID_PREFIX}${code}`;

// Cor impressa (a moldura e a versão do jogo) -> rótulo da faceta.
export const CORES = { g: "Green", r: "Red", b: "Blue" };

// As cartas que não são um Pokémon, como cada uma se imprime (lido nos scans
// em 2026-11-16), por parte. Nas Partes 1 e 2 o número é o do checklist ("000
// タイトルカード", "152 カードリスト1"…), e a cor é a da parte — menos a
// タイトルカードEX, que imprime 156 e é AZUL (青, a Pokémon Blue). Nas Partes
// 3 e 4 as duas SPECIAL CARDDASS imprimem "FILE No.000" e "CARDDASS" na frente,
// e só o nome em inglês.
export const ESPECIAIS = {
  p1: [
    { num: "000", cor: "g", ja: "タイトルカード", en: "Title Card" },
    { num: "152", cor: "g", ja: "カードリスト1", en: "Card List 1" },
    { num: "153", cor: "g", ja: "カードリスト2", en: "Card List 2" }
  ],
  p2: [
    { num: "000", cor: "r", ja: "タイトルカード", en: "Title Card" },
    { num: "154", cor: "r", ja: "カードリスト3", en: "Card List 3" },
    { num: "155", cor: "r", ja: "カードリスト4", en: "Card List 4" },
    { num: "156", cor: "b", ja: "タイトルカードEX", en: "Title Card EX" }
  ],
  p3: [{ num: "000", en: "Special Carddass" }],
  p4: [{ num: "CARDDASS", en: "Special Carddass" }]
};

// Número da página do animecollection ("1", "0", "CARDDASS") -> o impresso
// ("001", "000", "CARDDASS").
export const numeroImpresso = (n) => (/^\d+$/.test(String(n).trim()) ? String(n).trim().padStart(3, "0") : String(n).trim().toUpperCase());

// As cartas de uma parte, na ordem do catálogo: os Pokémon pelo número (nas
// Partes 1 e 2, verde e vermelha de cada um), depois as especiais.
// { id, num, cor?, dex? }
export function cartasDaParte(code, listas = LISTAS) {
  const def = SET_BY_CODE.get(code);
  const out = [];
  for (const num of listas.partes[code] || []) {
    for (const cor of def.cores ? ["g", "r"] : [""]) {
      out.push({ id: `${setIdOf(code)}-${cor ? `${cor}-` : ""}${num}`, num, ...(cor ? { cor } : {}), dex: Number(num) });
    }
  }
  for (const e of ESPECIAIS[code] || []) {
    out.push({ id: `${setIdOf(code)}-${e.cor ? `${e.cor}-` : ""}${e.num.toLowerCase()}`, num: e.num, ...(e.cor ? { cor: e.cor } : {}), esp: e });
  }
  return out;
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

// Snapshot: as cartas da página das Partes 3 e 4 como a fonte as dá ({ src,
// num, rar, dir }). Carta que some da página fica (pelo id da fonte, `src`).
async function refreshSnapshot(existing) {
  const html = await fetchPage(PAGINA_34);
  if (html === null) { console.log("  animecollection inacessível — segue com o snapshot versionado."); return existing; }
  const fresh = parseAnimeCollection(html);
  const known = (existing && existing.cards) || [];
  const visto = new Set(fresh.map((c) => c.src));
  const cards = fresh.concat(known.filter((c) => !visto.has(c.src)));
  const candidate = { source: PAGINA_34, updatedAt: new Date().toISOString().slice(0, 10), cards };
  const contagem = (s) => ((s && s.cards) || []).length;
  console.log(`  animecollection: ${contagem(candidate)} cartas das Partes 3 e 4 (snapshot: ${contagem(existing)}).`);
  if (contagem(candidate) < contagem(existing)) { console.log("  ⚠ REGRESSÃO — snapshot mantido."); return existing; }
  const same = existing && JSON.stringify(existing.cards) === JSON.stringify(cards);
  if (!same) await writeSnapshot(SNAP, candidate);
  return (await readSnapshot(SNAP)) || candidate;
}

// URL de ORIGEM do scan grande (sem esquema) e a do catálogo pelo wsrv — como
// no gcd: o "h3000" é a versão HD da fonte (na prática ~1000 px).
export const scanDe = (c) => `${FONTE}/cartes/${c.dir}/h3000_${c.src}_carte.jpg`;
export const IMG = (src) => `https://wsrv.nl/?url=${encodeURIComponent(src)}&w=440&output=webp`;

// Imagem CURADA do dono substitui o scan (mesmo mecanismo dos outros vintages).
function curatedImg(id) {
  for (const ext of ["webp", "jpg", "png"]) {
    if (existsSync(fileURLToPath(new URL(`assets/cards/pcd/${id}.${ext}`, ROOT)))) return `/assets/cards/pcd/${id}.${ext}`;
  }
  return "";
}

// Cartas do jogo. `snapshot`: o do animecollection (Partes 3 e 4);
// `ingles`: número da Pokédex -> nome oficial em inglês.
export function cartasDoJogo(snapshot, ingles = {}, listas = LISTAS, curada = curatedImg) {
  const porNum = new Map();
  for (const c of (snapshot && snapshot.cards) || []) {
    const n = numeroImpresso(c.num);
    if (!porNum.has(n)) porNum.set(n, c);
  }
  const out = [];
  for (const def of SETS) {
    const cartas = cartasDaParte(def.code, listas);
    for (const c of cartas) {
      const en = c.esp ? c.esp.en : (ingles[String(c.dex)] || "");
      const ja = c.esp ? (c.esp.ja || "") : (listas.pokemon[c.num] || "");
      const ac = def.cores ? null : porNum.get(c.num);
      out.push({
        id: c.id,
        // Sem nome (não acontece com os 151): o número, que é o certo.
        name: en || ja || `No. ${c.num}`,
        ...(en && ja ? { nameJp: ja } : {}),
        set: def.ja,
        setId: setIdOf(def.code),
        number: c.num,
        setTotal: cartas.length,
        setReleaseDate: def.date,
        // Partes 1–2: nenhuma fonte acessível diz quais são as prismas
        // (vazio, contrato 3). Partes 3–4: a do animecollection ("Regular" já
        // chega como "Normal").
        rarity: (ac && ac.rar) || "",
        ...(c.cor ? { color: CORES[c.cor] } : {}),
        // A arte da frente das Partes 1 e 2 é a aquarela do Ken Sugimori
        // (Bulbapedia, pelo material do jogo); a das Partes 3 e 4 não tem
        // autor confirmado, nem as cartas de título e checklist.
        artist: def.cores && !c.esp ? "Ken Sugimori" : "",
        language: "ja",
        image: curada(c.id) || (ac ? IMG(scanDe(ac)) : ""),
        variants: ["Normal"],
        // Sem logo de set publicado: o cartão do set mostra o nome.
        setLogo: "",
        vintage: true
      });
    }
  }
  return out;
}

async function build(snapshot) {
  const ingles = (await readGlobalVar(new URL("data/pokemon-names.js", ROOT), "TCG_POKEMON_NAMES")) || {};
  const cards = cartasDoJogo(snapshot, ingles);
  const existing = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  // O catálogo é só deste sync; mas carta publicada nunca some.
  const have = new Set(cards.map((c) => c.id));
  const merged = cards.concat(existing.filter((c) => c && c.id && !have.has(c.id)));
  await writeGameCatalog(OUT, { cards: merged, pricing: {}, webDir: "data/pcd/" }); // vintage: sem preço
  const porSet = {};
  for (const c of cards) porSet[c.setId] = (porSet[c.setId] || 0) + 1;
  const comImagem = cards.filter((c) => c.image).length;
  const semRaridade = cards.filter((c) => !c.rarity && !/^pcd-p[12]-/.test(c.id)).length;
  console.log(`  pcd: ${cards.length} cartas (${Object.entries(porSet).map(([k, v]) => `${k} ${v}`).join(", ")}; ${comImagem} com imagem${semRaridade ? `; ${semRaridade} das Partes 3–4 SEM raridade` : ""}) -> ${merged.length} totais`);
}

async function run() {
  console.log("Pokémon Carddass: Partes 1–4 (Bandai, 1996–1997, vintage)");
  let snapshot = await readSnapshot(SNAP);
  if (!NO_FETCH) snapshot = await refreshSnapshot(snapshot);
  await build(snapshot || { cards: [] });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
