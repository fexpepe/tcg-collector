// 聖闘士星矢 (Saint Seiya / Os Cavaleiros do Zodíaco): as cartas japonesas da
// marca de 1988 a 2023, em TRÊS jogos vintage, um por produto (a regra de
// 13/11/2026: jogo antigo diferente = jogo próprio; fica junto só o que é o
// mesmo jogo). Um sync só, porque a fonte, o snapshot e os nomes são os
// mesmos; cada família vai pro catálogo do jogo dela (JOGO, abaixo):
//   seiya    Saint Seiya Carddass (Bandai, 1988–2023), em data/seiya/, uma
//            seção por série:
//     cd  as partes de 42 cartas das máquinas Carddass 20 (1988–1989), da
//         primeira leva do sistema;
//     sp  セイントパラダイス (1991–1992): três partes ("ACT") numeradas em
//         sequência, 1 a 126, e a jumbo;
//     rb  新生セイントパラダイス (2022–2023): a volta da Saint Paradise, em
//         caixa com fichário, com a mesma numeração.
//   seiyatc  Saint Seiya Trading Collection (Amada, 2000–2003), em
//            data/seiyatc/: as coleções de cenas do anime e dos filmes, em
//            pacote. Outro fabricante e outro produto (como o narutotc).
//   seiyacr  Saint Seiya Crusade (Bandai, 2012–2014), em data/seiyacr/: o TCG
//            de mesa do sistema Crusade (クルセイドシステムカードシリーズ), de
//            cores e Gシンボル, os boosters do anime clássico e os do
//            聖闘士星矢Ω. É um card game, não carta de coleção (como o gw). O
//            "Carddass Masters G Crusade" do animecollection é o selo da caixa
//            (CARDDASS MASTERS G) somado ao nome da linha, não o nome oficial.
//
// Fonte das cartas (levantamento de 2026-11-12):
//   animecollection.fr — catálogo de fã (francês) com UMA página por parte:
//                        número impresso, raridade e scan de cada carta (~1000
//                        px, com a marca d'água do site no canto). É a fonte do
//                        Gundam Carddass (sync-gundam-carddass.mjs, de onde vem
//                        o parser). Só responde em HTTP, e por isso a imagem
//                        sai pelo wsrv.nl. NÃO dá o nome da carta.
//   nome da carta      — impresso na frente: TRANSCRITO dos scans em
//                        scripts/data/saint-seiya-nomes.json (o cabeçalho de lá
//                        diz como). Inglês por glossário
//                        (scripts/data/saint-seiya-nomes-en.json); sem tradução
//                        segura, fica o japonês.
//   cor do Crusade     — o número impresso (U-001, C-001…) REPETE em cada uma
//                        das quatro cores da parte: a cor é parte da
//                        identidade da carta, e vem de
//                        scripts/data/saint-seiya-cores.json (lida na moldura
//                        do scan e conferida a olho).
//
// IDs: <prefixo do jogo><parte>-<número impresso> (ss-cd02-1, ss-sp03-126,
// ss-rb01-ex05; sstc-m2-iii-001); no Crusade, com a letra da cor antes do
// número (sscr-01-b-u-001 = 黄金十二宮編, azul, U-001). Número repetido sem cor que o
// separe ganha sufixo pela ordem da fonte (b, c…). O id fica GRAVADO no
// snapshot junto do id da carta na fonte (`src`), e o refresh reaproveita o id
// da carta já conhecida: reordenar a página não troca id, e carta que some da
// fonte fica.
//
//   node scripts/sync-saint-seiya.mjs             # fetch (se der) + build
//   node scripts/sync-saint-seiya.mjs --no-fetch  # só build do snapshot
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog, sleep } from "./lib/sync-common.mjs";
import { parseAnimeCollection } from "./sync-gundam-carddass.mjs";

const ROOT = new URL("../", import.meta.url);
const SNAP = new URL("data/vintage/saint-seiya.json", ROOT);
const NOMES = JSON.parse(readFileSync(new URL("scripts/data/saint-seiya-nomes.json", ROOT), "utf8"));
const NOMES_EN = JSON.parse(readFileSync(new URL("scripts/data/saint-seiya-nomes-en.json", ROOT), "utf8"));
const CORES_SRC = JSON.parse(readFileSync(new URL("scripts/data/saint-seiya-cores.json", ROOT), "utf8"));
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
const NO_FETCH = process.argv.includes("--no-fetch");
// Prefixo de id de cada jogo (exclusivo, docs/CATALOGO.md 1.1).
export const PREFIXO = { seiya: "ss-", seiyatc: "sstc-", seiyacr: "sscr-" };
export const ID_PREFIX = PREFIXO.seiya;
const FONTE = "www.animecollection.fr"; // sem esquema: o wsrv busca em HTTP, que é o que o site serve
const LICENCA = 37; // idl da licença Saint Seiya no animecollection

// Famílias e o jogo de cada uma. `ja` abre o NOME do set (contrato 7: sem o
// 聖闘士星矢 da frente, que é a marca, nem o nome do jogo, que já estão no
// cabeçalho e no endereço); `en` abre o nome de exibição (src/nomes-sets.js).
// No Saint Seiya Carddass a ordem é a das seções da página de Sets
// (groupSeiyaSets no app.js); as partes de 1988–89 não levam prefixo (o jogo
// É o Carddass). O Trading Collection e o Crusade são uma família cada, e o
// nome do set é o do produto.
export const SERIES = {
  cd: { jogo: "seiya", ja: "", en: "" },
  sp: { jogo: "seiya", ja: "セイントパラダイス", en: "Saint Paradise" },
  rb: { jogo: "seiya", ja: "新生セイントパラダイス", en: "Reborn Saint Paradise" },
  tc: { jogo: "seiyatc", ja: "", en: "" },
  cr: { jogo: "seiyacr", ja: "", en: "" }
};
export const JOGOS = Object.keys(PREFIXO);

// Cores do Crusade (as do site oficial: blue, black, green, red e o purple
// de Athena, das neutras e da 小宇宙レア) -> rótulo da faceta (em inglês, como o color do gw) e
// letra do id.
export const CORES = {
  "青": { en: "Blue", id: "b" }, "黒": { en: "Black", id: "k" }, "緑": { en: "Green", id: "g" },
  "赤": { en: "Red", id: "r" }, "紫": { en: "Purple", id: "p" }, "白": { en: "White", id: "w" }, "黄": { en: "Yellow", id: "y" }
};
// Tipo pelo prefixo do número do Crusade (U-001, CH-001, C-001), impresso no
// topo da carta (UNIT, CHARACTER, COMMAND).
export const TIPOS = { U: "Unit", CH: "Character", C: "Command" };

// Todas as partes, na ordem de lançamento dentro da família. `ac`: [coleção,
// série] da página do animecollection (sem `ac`, a parte não gera carta: fica
// pra quando a fonte publicar). `date`: a precisão que a fonte tem (ano ou
// mês), sem dia inventado. `ja`/`en`: o que vai depois do nome da família.
// `total`: só onde o total oficial difere da contagem da fonte. `promo`: set
// de promo (seção à parte dentro da família e fora do destaque).
export const SETS = [
  // カードダス (1988–1989): 42 cartas por parte (36 + 6 prismas). A Part 1
  // (jun/1988, o arco de Asgard) NÃO imprime número e não está no
  // animecollection: vem do saint-seiya.it (`ssit`, ver CARDDASS_P1), com o
  // rótulo do site no lugar do número (S1–S7 as prismas, 1–36 as normais;
  // o site tem uma 7ª prisma que a Mandarake não lista). A Part 2 e a Part 3
  // numeram de 1 a 42 cada.
  { code: "cd01", series: "cd", date: "1988-06", ssit: true, ja: "パート1", en: "Part 1" },
  { code: "cd02", series: "cd", date: "1988-09", ac: [118, 271], ja: "パート2「バトルメモリアル」", en: "Part 2 — Battle Memorial" },
  { code: "cd03", series: "cd", date: "1989-02", ac: [118, 617], ja: "パート3「海皇の野望」", en: "Part 3 — The Sea Emperor's Ambition" },
  // セイントパラダイス (Carddass 20, 1991–1992): 36 + 6 prismas por ACT, e a
  // numeração corre pelas três (1–42, 43–84, 85–126). Só o ano (o verso diz
  // "BANDAI 1991/1992"); o "6月下旬発売予定" da jumbo é anúncio, não data. A
  // jumbo dos cinco de bronze (a Mandarake a chama de 新生青銅聖闘士5人) foi brinde do
  // Tokyo Toy Show de 1991 e traz no verso a lista da ACT.1.
  { code: "sp01", series: "sp", date: "1991", ac: [273, 572], ja: "ACT.1", en: "Act 1" },
  { code: "sp02", series: "sp", date: "1991", ac: [273, 578], ja: "ACT.2", en: "Act 2" },
  { code: "sp03", series: "sp", date: "1992", ac: [273, 581], ja: "ACT.3", en: "Act 3" },
  { code: "spx", series: "sp", date: "1991", ac: [273, 658], ja: "ジャンボカードダス", en: "Jumbo Carddass", promo: true },
  // Saint Seiya Trading Collection (Amada, 2000–2003): frames do anime e dos
  // filmes, 10 cartas por pacote. O nome é o do produto como a Amada o
  // publicou, sem o 聖闘士星矢 e sem o トレーディングコレクション, que é o jogo;
  // `id` é o código do set no catálogo (sstc-<id>). A primeira, de 2000, não
  // tem subtítulo: o nome dela É トレーディングコレクション (exceção declarada
  // no tests/nome-do-set.test.mjs). A promo de cada coleção leva o nome dela +
  // "プロモ" e vira chip no cartão da coleção. Datas: o site oficial no Wayback
  // (amadagogo.com e amada-printing.co.jp) onde ele diz o mês; senão o
  // saint-seiya.it.
  { code: "tcsa", id: "2000", series: "tc", date: "2000-03", ac: [126, 287], name: "トレーディングコレクション", nameEn: "Trading Collection" },
  { code: "tcsap", id: "2000p", series: "tc", date: "2000-03", ac: [126, 288], name: "トレーディングコレクション プロモ", nameEn: "Trading Collection Promo", promo: true },
  { code: "tcm1", id: "m1", series: "tc", date: "2002-01", ac: [166, 349], name: "劇場版 第1弾", nameEn: "The Movie Part 1" },
  { code: "tcm1p", id: "m1p", series: "tc", date: "2002-01", ac: [166, 350], name: "劇場版 第1弾 プロモ", nameEn: "The Movie Part 1 Promo", promo: true },
  { code: "tcm3", id: "m2", series: "tc", date: "2002-06", ac: [190, 414], name: "劇場版 第2弾", nameEn: "The Movie Part 2" },
  { code: "tctv", id: "tv", series: "tc", date: "2003-02", ac: [157, 336], name: "TVシリーズ＆冥王ハーデス十二宮編", nameEn: "TV Series & The Hades Chapter Sanctuary" },
  { code: "tctvp", id: "tvp", series: "tc", date: "2003-02", ac: [157, 337], name: "TVシリーズ＆冥王ハーデス十二宮編 ボックスカード", nameEn: "TV Series & The Hades Chapter Sanctuary Box Cards", promo: true },
  { code: "tchd", id: "hd", series: "tc", date: "2003-12", ac: [134, 302], name: "冥王ハーデス十二宮編［完全版］", nameEn: "The Hades Chapter Sanctuary Complete Edition" },
  { code: "tchdp", id: "hdp", series: "tc", date: "2003-12", ac: [134, 303], name: "冥王ハーデス十二宮編［完全版］ プロモ", nameEn: "The Hades Chapter Sanctuary Complete Edition Promo", promo: true },
  // Saint Seiya Crusade (Bandai, 2012–2014): booster de 10 cartas + 1 índice,
  // caixa de 15. O nome oficial é 【クルセイド】聖闘士星矢～…編～ (sem o
  // クルセイド, que é o jogo, nem o 聖闘士星矢, que é a marca; o 聖闘士星矢Ω fica,
  // porque é o título do anime). Datas e composição: as páginas de produto do
  // site oficial no Wayback (carddas.com/crusade/item/…) e o Carddass Club; a
  // 1ª saiu em janeiro de 2012 (a Bandai diz 中旬, o site Crusade 下旬: só o
  // mês). A numeração é por cor e por série (a clássica e a Ω contam
  // separado), e o 聖闘士星矢Ω～黄金十二宮編～, de preto e vermelho, recomeça no
  // U-001. O de 2014 tem 91 cartas oficiais; a fonte tem 46.
  { code: "cr01", id: "01", series: "cr", date: "2012-01", ac: [115, 267], ja: "～黄金十二宮編～", en: "The Twelve Temples Arc" },
  { code: "cr02", id: "02", series: "cr", date: "2012-06-22", ac: [173, 368], ja: "聖闘士星矢Ω", en: "Saint Seiya Omega" },
  { code: "cr03", id: "03", series: "cr", date: "2012-11-16", ac: [115, 270], ja: "～アスガルド・海皇ポセイドン編～", en: "Asgard & Sea Emperor Poseidon Arc" },
  { code: "cr04", id: "04", series: "cr", date: "2013-03-15", ac: [173, 433], ja: "聖闘士星矢Ω～黄金十二宮編～", en: "Omega: The Twelve Temples Arc" },
  { code: "cr05", id: "05", series: "cr", date: "2013-06-21", ac: [115, 274], ja: "～冥王ハーデス編～", en: "Hades Arc" },
  { code: "cr06", id: "06", series: "cr", date: "2013-08-23", ac: [173, 457], ja: "聖闘士星矢Ω～新生聖衣編～", en: "Omega: New Cloth Arc" },
  { code: "cr07", id: "07", series: "cr", date: "2014-07-04", ac: [173, 695], ja: "～LEGEND of SANCTUARY／聖闘士星矢Ω～", en: "Legend of Sanctuary / Omega", total: 91 },
  { code: "crpr", id: "pr", series: "cr", date: "2012", ac: [115, 363], ja: "プロモーションカード", en: "Promotion Cards", promo: true },
  // 新生セイントパラダイス (2022–2023): 36 regulares na sequência 1–126 e 7
  // prismas EX por parte.
  { code: "rb01", series: "rb", date: "2022-03", ac: [305, 653], ja: "～よみがえれ！英雄伝説～", en: "— A Heroic Legend Revived!" },
  { code: "rb02", series: "rb", date: "2022-08", ac: [305, 711], ja: "～激突！誇り高き刺客～", en: "— Clash! The Proud Assassins" },
  { code: "rb03", series: "rb", date: "2023-05", ac: [305, 712], ja: "～集結！黄金聖闘士～", en: "— Assemble! Gold Saints" }
];
// Carddass Part 1 (1988): a checklist do saint-seiya.it (fã-site italiano,
// sem robots.txt), página https://www.saint-seiya.it/sito4/power/power.html,
// conferida em 2026-11-12: [rótulo do site, arquivo do scan, raridade]. As
// prismas batem com a lista de compra da Mandarake (card_seiya.php). Scan de
// 350×510 com a marca d'água do site — o maior que existe acessível (o
// animecollection não tem a parte).
const SSIT = "www.saint-seiya.it/sito4/";
export const CARDDASS_P1 = [
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => [`S${n}`, `power/spasg${n}.jpg`, "Prism"]),
  ...Array.from({ length: 36 }, (_, i) => [String(i + 1), `power/asg${String(i + 1).padStart(2, "0")}.jpg`, "Normal"])
];
const SET_BY_CODE = new Map(SETS.map((s) => [s.code, s]));
const SET_ORDER = new Map(SETS.map((s, i) => [s.code, i]));

export function setName(def) { return def.name || [SERIES[def.series].ja, def.ja].filter(Boolean).join(" "); }
export function setNameEn(def) { return def.nameEn || [SERIES[def.series].en, def.en].filter(Boolean).join(" "); }
// Jogo, prefixo e setId de uma parte: <prefixo do jogo><id ou código>.
export const jogoDe = (code) => SERIES[SET_BY_CODE.get(code).series].jogo;
export const setIdOf = (code) => { const def = SET_BY_CODE.get(code); return `${PREFIXO[SERIES[def.series].jogo]}${def.id || def.code}`; };

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

// Raridade: o que a fonte escreve, com o francês do "hors-série" e o plural
// do "Holographics" no padrão do catálogo. O resto (Prism, Common, Metal,
// Cosmo, SP…) passa como veio; "Regular" já chega como "Normal" do parser.
const RARIDADE = { "Hors-série": "Special", Holographics: "Holographic", "Metal": "Metal Rare", "Cosmo": "Cosmo Rare" };
export const raridade = (r) => RARIDADE[r] ?? r;

const numKey = (num) => String(num).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// Promos: a fonte rotula por extenso o que a carta não numera ("Promo",
// "Promo 01", "Box card 1"). No catálogo vira a sigla, curta e no padrão dos
// outros números (PR, PR-01, BOX-1); o resto passa como veio.
export function numeroDaFonte(num) {
  const t = String(num || "").trim();
  if (/^promo$/i.test(t)) return "PR";
  let m = t.match(/^promo\s*0*(\d+)$/i);
  if (m) return `PR-${m[1].padStart(2, "0")}`;
  m = t.match(/^box\s*card\s*(\d+)$/i);
  if (m) return `BOX-${m[1]}`;
  return t;
}
// Número IMPRESSO onde a fonte numera diferente (lido em cada scan,
// 2026-11-12). 劇場版 トレーディングコレクション 第2弾: o filme IV numera à parte
// (IV-001 a IV-036), e a fonte o lista como 145–180, continuação do III — com
// dois blocos de três trocados (os scans "154–156" são o IV-016–018 e os
// "160–162", o IV-010–012). E a jumbo da Saint Paradise imprime SPECIAL. A chave é o id da carta na fonte.
export const NUMERO_IMPRESSO = {
  27672: "SPECIAL",
  17229: "IV-001", 17228: "IV-002", 17230: "IV-003", 17231: "IV-004", 17232: "IV-005", 17233: "IV-006",
  17234: "IV-007", 17235: "IV-008", 17236: "IV-009", 17243: "IV-010", 17244: "IV-011", 17245: "IV-012",
  17240: "IV-013", 17241: "IV-014", 17242: "IV-015", 17237: "IV-016", 17238: "IV-017", 17239: "IV-018",
  17246: "IV-019", 17247: "IV-020", 17248: "IV-021", 17249: "IV-022", 17250: "IV-023", 17251: "IV-024",
  17252: "IV-025", 17253: "IV-026", 17254: "IV-027", 17255: "IV-028", 17256: "IV-029", 17257: "IV-030",
  17258: "IV-031", 17259: "IV-032", 17260: "IV-033", 17261: "IV-034", 17262: "IV-035", 17263: "IV-036"
};
export const corDe = (src) => CORES_SRC.cores[String(src)] || "";

// Casa as cartas da página com as do snapshot pelo id DA FONTE (`src`) pra
// manter o id. Carta nova: ss-<set>-[<cor>-]<número>, com sufixo (b, c…) se o
// id já está tomado na parte. Carta do snapshot que saiu da fonte continua.
export function assignIds(setCode, fresh, known = [], cor = corDe) {
  const porSrc = new Map(known.map((c) => [c.src, c]));
  const used = new Set(known.map((c) => c.id));
  const visto = new Set();
  const out = [];
  for (const bruta of fresh) {
    const c = { ...bruta, num: NUMERO_IMPRESSO[bruta.src] || numeroDaFonte(bruta.num) };
    if (visto.has(c.src)) continue; // a mesma carta duas vezes na página
    visto.add(c.src);
    const antiga = porSrc.get(c.src);
    let id = antiga && antiga.id;
    if (!id) {
      const letra = CORES[cor(c.src)] ? `${CORES[cor(c.src)].id}-` : "";
      const base = `${setIdOf(setCode)}-${letra}${numKey(c.num) || "x"}`;
      id = base;
      for (let i = 1; used.has(id); i++) id = `${base}${String.fromCharCode(97 + i)}`; // 1, 1b, 1c…
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
  for (const def of SETS.filter((s) => s.ac)) {
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
  // Partes do saint-seiya.it: a lista está no próprio sync (CARDDASS_P1). A
  // carta já conhecida fica como está; o id sai do rótulo do site e GRUDA no
  // arquivo do scan (`src`), como o id do animecollection gruda no dele.
  for (const def of SETS.filter((s) => s.ssit)) {
    const known = knownSets.get(def.code) || [];
    const fresh = CARDDASS_P1.map(([num, arq, rar]) => ({ src: arq, num, rar, img: `${SSIT}${arq}` }));
    const porSrc = new Map(known.map((c) => [c.src, c]));
    const cards = fresh.map((c) => porSrc.get(c.src) || { id: `${setIdOf(def.code)}-${numKey(c.num)}`, ...c });
    for (const k of known) if (!cards.some((c) => c.src === k.src)) cards.push(k);
    sets.push({ code: def.code, cards });
  }
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

// Nome EN: o nome inteiro conhecido > composição. A armadura vem antes do
// nome, como em inglês: 天馬星座（ペガサス）の星矢 (a grafia da lista oficial do
// Crusade, a furigana entre parênteses), ペルセウス座のアルゴル e o rótulo da
// Saint Paradise "天馬星座 星矢" viram "Pegasus Seiya" — com furigana, vale a
// leitura (鷲座（アクィラ） = Aquila no Ω; 鷲星座 = Eagle no clássico). E ＆ =
// "&", ／ = "/". Se QUALQUER pedaço não tiver tradução, fica o japonês inteiro
// — meia tradução confunde mais que ajuda (a regra do dbc e do gcd).
const LEITURA = /[（(]([^）)]+)[）)]/;
export function nameEn(ja, nomes = NOMES_EN) {
  const s = String(ja || "").trim();
  if (!s) return "";
  if (nomes.phrases[s]) return nomes.phrases[s];
  if (nomes.atoms[s]) return nomes.atoms[s];
  const constelacao = (x) => {
    const m = x.match(LEITURA);
    return (m && nomes.constelacoes[m[1]]) || nomes.constelacoes[x.replace(LEITURA, "")] || "";
  };
  // armadura + nome: "Xの Y" (com ou sem a leitura) ou "X Y" (rótulo da SP)
  const arm = s.match(/^(.+?(?:[（(][^）)]+[）)])?)(?:の|\s+)(.+)$/);
  if (arm && constelacao(arm[1])) {
    const nome = nameEn(arm[2], nomes);
    return nome ? `${constelacao(arm[1])} ${nome}` : "";
  }
  // golpe/coisa com a leitura entre parênteses: 聖剣（エクスカリバー）
  const semLeitura = s.replace(new RegExp(LEITURA.source, "g"), "");
  if (semLeitura !== s && (nomes.phrases[semLeitura] || nomes.atoms[semLeitura])) return nomes.phrases[semLeitura] || nomes.atoms[semLeitura];
  const and = s.split(/\s*[＆&]\s*/);
  if (and.length > 1) {
    const parts = and.map((p) => nameEn(p, nomes));
    return parts.every(Boolean) ? parts.join(" & ") : "";
  }
  const varias = s.split("／");
  if (varias.length > 1) {
    const parts = varias.map((p) => nameEn(p, nomes));
    return parts.every(Boolean) ? parts.join(" / ") : "";
  }
  return "";
}

// URL de ORIGEM do scan grande (sem esquema), e a do catálogo pelo wsrv. O
// "h3000" é o nome que a fonte dá à versão HD (na prática ~1000 px).
export const scanDe = (c) => `${FONTE}/cartes/${c.dir}/h3000_${c.src}_carte.jpg`;
export const IMG = (src) => `https://wsrv.nl/?url=${encodeURIComponent(src)}&w=440&output=webp`;

// Erros DA FONTE, achados lendo cada scan (2026-11-12): carta cuja página
// mostra o scan de OUTRA carta. A carta existe (número, cor e raridade batem
// com a lista da loja BIGWEB, api.bigweb.co.jp, e com a composição oficial),
// então fica no catálogo, mas sem a imagem errada. A chave é o id da carta na
// fonte.
export const SCAN_ERRADO = {
  10726: "Crusade ～アスガルド・海皇ポセイドン編～ C-012 verde: a fonte repete o scan do U-012 verde (10691, シャイナ); o nome, マハローシニー, é o da BIGWEB"
};

// Imagem CURADA do dono substitui o scan (mesmo mecanismo dos outros vintages).
function curatedImg(id, jogo) {
  for (const ext of ["webp", "jpg", "png"]) {
    if (existsSync(fileURLToPath(new URL(`assets/cards/${jogo}/${id}.${ext}`, ROOT)))) return `/assets/cards/${jogo}/${id}.${ext}`;
  }
  return "";
}

// Cartas do jogo a partir do snapshot. `nomes`: id -> nome impresso.
// `descricoes`: id -> descrição em inglês, NOSSA, da carta que não imprime nome
// nem título (as cenas das Trading Collection): vira o nome, sem nameJp.
export function cartasDoJogo(snapshot, nomes = NOMES.nomes, nomesEn = NOMES_EN, cor = corDe, descricoes = NOMES.descricoes || {}) {
  const out = [];
  for (const s of (snapshot && snapshot.sets) || []) {
    const def = SET_BY_CODE.get(s.code);
    if (!def) continue;
    // Y do "X/Y": o total oficial onde ele é conhecido e maior que o da fonte;
    // senão, quantas cartas a parte tem na fonte.
    const total = def.total || s.cards.length;
    for (const c of s.cards) {
      const ja = nomes[c.id] || "";
      const en = nameEn(ja, nomesEn) || (!ja && descricoes[c.id]) || "";
      const k = cor(c.src);
      const tipo = (String(c.num).match(/^(CH|U|C)-/) || [])[1];
      out.push({
        id: c.id,
        // Sem nome transcrito (carta nova na fonte): o número, que é o que a
        // carta tem de certo. Não se inventa nome.
        name: en || ja || `No. ${c.num}`,
        ...(en && ja && en !== ja ? { nameJp: ja } : {}),
        set: setName(def),
        setId: setIdOf(s.code),
        number: c.num,
        setTotal: total,
        setReleaseDate: def.date,
        rarity: c.rar || "",
        ...(def.series === "cr" ? { cardType: TIPOS[tipo] || "" } : {}),
        ...(CORES[k] ? { color: CORES[k].en } : {}),
        artist: "",
        language: "ja",
        image: curatedImg(c.id, SERIES[def.series].jogo) || (SCAN_ERRADO[c.src] ? "" : IMG(c.img || scanDe(c))),
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

// Jogo de uma carta pelo setId (ss-sp01 -> seiya; sstc-m1 -> seiyatc).
export function jogoDaCarta(c) {
  const id = String((c && c.setId) || "");
  return JOGOS.find((j) => id.startsWith(PREFIXO[j])) || "seiya";
}

async function build(snapshot) {
  const line = cartasDoJogo(snapshot);
  for (const jogo of JOGOS) {
    const out = new URL(`data/${jogo}/`, ROOT);
    const doJogo = line.filter((c) => jogoDaCarta(c) === jogo);
    const existing = (await readGlobalVar(new URL("cards.js", out), "TCG_CARDS")) || [];
    // O catálogo é só deste sync; mas carta publicada nunca some.
    const have = new Set(doJogo.map((c) => c.id));
    const merged = doJogo.concat(existing.filter((c) => c && c.id && !have.has(c.id) && jogoDaCarta(c) === jogo));
    const pricing = (await readGlobalVar(new URL("pricing.js", out), "TCG_PRICING")) || {}; // sem preço
    await writeGameCatalog(out, { cards: merged, pricing, webDir: `data/${jogo}/` });
    const semNome = doJogo.filter((c) => /^No\. /.test(c.name)).length;
    const comEn = doJogo.filter((c) => c.nameJp).length;
    const partes = new Set(doJogo.map((c) => c.setId)).size;
    console.log(`  ${jogo}: ${doJogo.length} cartas em ${partes} partes (${comEn} com nome EN, ${semNome} sem nome) -> ${merged.length} totais`);
  }
}

async function run() {
  console.log("Saint Seiya: Carddass, Trading Collection e Crusade (Bandai e Amada, 1988–2023, vintage)");
  let snapshot = await readSnapshot(SNAP);
  if (!NO_FETCH) snapshot = await refreshSnapshot(snapshot);
  if (!snapshot || !snapshot.sets) { console.log("  sem snapshot e sem fetch — nada a fazer."); return; }
  await build(snapshot);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
