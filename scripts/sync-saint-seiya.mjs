// 聖闘士星矢 (Saint Seiya / Os Cavaleiros do Zodíaco): o jogo vintage `seiya`,
// em data/seiya/. Um jogo só pras cartas da marca, com uma seção por FAMÍLIA
// de produto (como o gcd faz por série e o cdm por IP): não existia slug de
// Saint Seiya, então a marca vira o jogo (regra 4.1 do docs/CATALOGO.md), e
// cada família é um produto diferente, de fabricante e época diferentes.
//
// Famílias (SERIES, na ordem das seções da página de Sets):
//   cd  カードダス (Bandai, 1988–1989): as partes de 42 cartas das máquinas
//       Carddass 20, da primeira leva do sistema.
//   sp  セイントパラダイス (Bandai Carddass, 1991–1992): três partes ("Act")
//       numeradas em sequência, 1 a 126.
//   tc  トレーディングコレクション (Amada, 2000–2003): as coleções de cenas do
//       anime e dos filmes, em pacote.
//   gc  Gクルセイド (Bandai, 2012–2013): o TCG de mesa, de cores e Gシンボル.
//   go  Gクルセイド Ω (Bandai, 2012–2014): a mesma regra, com o Saint Seiya Ω.
//   rb  新生セイントパラダイス (Bandai Carddass, 2022–2023): a volta da Saint
//       Paradise, em caixa com fichário.
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
//   cor do G Crusade   — o número impresso (U-001, C-001…) REPETE em cada uma
//                        das quatro cores da parte: a cor é parte da
//                        identidade da carta, e vem de
//                        scripts/data/saint-seiya-cores.json (lida na moldura
//                        do scan e conferida a olho).
//
// IDs: ss-<família><parte>-<número impresso> (ss-cd02-1, ss-sp03-126,
// ss-rb01-ex05); no G Crusade, com a letra da cor antes do número
// (ss-gc01-b-u-001 = Part 1, azul, U-001). Número repetido sem cor que o
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
const GAME = "seiya";
const OUT = new URL(`data/${GAME}/`, ROOT);
const SNAP = new URL("data/vintage/saint-seiya.json", ROOT);
const NOMES = JSON.parse(readFileSync(new URL("scripts/data/saint-seiya-nomes.json", ROOT), "utf8"));
const NOMES_EN = JSON.parse(readFileSync(new URL("scripts/data/saint-seiya-nomes-en.json", ROOT), "utf8"));
const CORES_SRC = JSON.parse(readFileSync(new URL("scripts/data/saint-seiya-cores.json", ROOT), "utf8"));
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
const NO_FETCH = process.argv.includes("--no-fetch");
export const ID_PREFIX = "ss-";
const FONTE = "www.animecollection.fr"; // sem esquema: o wsrv busca em HTTP, que é o que o site serve
const LICENCA = 37; // idl da licença Saint Seiya no animecollection

// Famílias. `ja` abre o NOME do set (contrato 7: sem o 聖闘士星矢 da frente,
// que é a marca e já está no cabeçalho e no endereço); `en` abre o nome de
// exibição (src/nomes-sets.js). A ordem aqui é a das seções na página de Sets
// (groupSeiyaSets no app.js).
export const SERIES = {
  cd: { ja: "カードダス", en: "Carddass" },
  sp: { ja: "セイントパラダイス", en: "Saint Paradise" },
  tc: { ja: "トレーディングコレクション", en: "Trading Collection" },
  gc: { ja: "Gクルセイド", en: "G Crusade" },
  go: { ja: "Gクルセイド Ω", en: "G Crusade Ω" },
  rb: { ja: "新生セイントパラダイス", en: "Reborn Saint Paradise" }
};

// Cores do G Crusade -> rótulo da faceta (em inglês, como o color do gw) e
// letra do id.
export const CORES = {
  "青": { en: "Blue", id: "b" }, "黒": { en: "Black", id: "k" }, "緑": { en: "Green", id: "g" },
  "赤": { en: "Red", id: "r" }, "紫": { en: "Purple", id: "p" }, "白": { en: "White", id: "w" }, "黄": { en: "Yellow", id: "y" }
};
// Tipo pelo prefixo do número do G Crusade (U-001, CH-001, C-001).
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
  // jumbo "新生青銅聖闘士5人" (o hors-série do animecollection) foi brinde do
  // Tokyo Toy Show de 1991 e traz no verso a lista da ACT.1.
  { code: "sp01", series: "sp", date: "1991", ac: [273, 572], ja: "ACT.1", en: "Act 1" },
  { code: "sp02", series: "sp", date: "1991", ac: [273, 578], ja: "ACT.2", en: "Act 2" },
  { code: "sp03", series: "sp", date: "1992", ac: [273, 581], ja: "ACT.3", en: "Act 3" },
  { code: "spx", series: "sp", date: "1991", ac: [273, 658], ja: "ジャンボカードダス", en: "Jumbo Carddass", promo: true },
  // トレーディングコレクション da Amada (2000–2003): frames do anime e dos
  // filmes, 10 cartas por pacote. O nome é o do produto como a Amada o
  // publicou (sem o 聖闘士星矢), e por isso explícito (`name`); a promo de cada
  // coleção leva o nome dela + "プロモ" e vira chip no cartão da coleção. A
  // primeira, de 2000, não tem subtítulo. Datas: o site oficial no Wayback
  // (amadagogo.com e amada-printing.co.jp) onde ele diz o mês; senão o
  // saint-seiya.it.
  { code: "tcsa", series: "tc", date: "2000-03", ac: [126, 287], name: "トレーディングコレクション", nameEn: "Trading Collection" },
  { code: "tcsap", series: "tc", date: "2000-03", ac: [126, 288], name: "トレーディングコレクション プロモ", nameEn: "Trading Collection Promo", promo: true },
  { code: "tcm1", series: "tc", date: "2002-01", ac: [166, 349], name: "劇場版 トレーディングコレクション 第1弾", nameEn: "Trading Collection The Movie Part 1" },
  { code: "tcm1p", series: "tc", date: "2002-01", ac: [166, 350], name: "劇場版 トレーディングコレクション 第1弾 プロモ", nameEn: "Trading Collection The Movie Part 1 Promo", promo: true },
  { code: "tcm3", series: "tc", date: "2002-06", ac: [190, 414], name: "劇場版 トレーディングコレクション 第2弾", nameEn: "Trading Collection The Movie Part 2" },
  { code: "tctv", series: "tc", date: "2003-02", ac: [157, 336], name: "トレーディングコレクション TVシリーズ＆冥王ハーデス十二宮編", nameEn: "Trading Collection TV Series & The Hades Chapter Sanctuary" },
  { code: "tctvp", series: "tc", date: "2003-02", ac: [157, 337], name: "トレーディングコレクション TVシリーズ＆冥王ハーデス十二宮編 ボックスカード", nameEn: "Trading Collection TV Series & The Hades Chapter Sanctuary Box Cards", promo: true },
  { code: "tchd", series: "tc", date: "2003-12", ac: [134, 302], name: "トレーディングコレクション 冥王ハーデス十二宮編［完全版］", nameEn: "Trading Collection The Hades Chapter Sanctuary Complete Edition" },
  { code: "tchdp", series: "tc", date: "2003-12", ac: [134, 303], name: "トレーディングコレクション 冥王ハーデス十二宮編［完全版］ プロモ", nameEn: "Trading Collection The Hades Chapter Sanctuary Complete Edition Promo", promo: true },
  // Gクルセイド (2012–2013) e Gクルセイド Ω (2012–2014).
  { code: "gc01", series: "gc", date: "2012-01", ac: [115, 267], ja: "第1弾", en: "Part 1" },
  { code: "gc02", series: "gc", date: "2012-11", ac: [115, 270], ja: "第2弾", en: "Part 2" },
  { code: "gc03", series: "gc", date: "2013-06", ac: [115, 274], ja: "第3弾", en: "Part 3" },
  { code: "gcpr", series: "gc", date: "2012", ac: [115, 363], ja: "プロモーションカード", en: "Promotion Cards", promo: true },
  { code: "go01", series: "go", date: "2012", ac: [173, 368], ja: "第1弾", en: "Part 1" },
  { code: "go02", series: "go", date: "2013", ac: [173, 433], ja: "第2弾", en: "Part 2" },
  { code: "go03", series: "go", date: "2013", ac: [173, 457], ja: "第3弾", en: "Part 3" },
  { code: "go04", series: "go", date: "2014", ac: [173, 695], ja: "第4弾", en: "Part 4" },
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
export const setIdOf = (code) => `${ID_PREFIX}${code}`;

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
    const c = { ...bruta, num: numeroDaFonte(bruta.num) };
    if (visto.has(c.src)) continue; // a mesma carta duas vezes na página
    visto.add(c.src);
    const antiga = porSrc.get(c.src);
    let id = antiga && antiga.id;
    if (!id) {
      const letra = CORES[cor(c.src)] ? `${CORES[cor(c.src)].id}-` : "";
      const base = `${ID_PREFIX}${setCode}-${letra}${numKey(c.num) || "x"}`;
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
    const cards = fresh.map((c) => porSrc.get(c.src) || { id: `${ID_PREFIX}${def.code}-${numKey(c.num)}`, ...c });
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

// Nome EN: o nome inteiro conhecido > composição por separador (＆ = "&";
// ／ = "/"; espaço entre constelação e nome = "<nome> de <constelação>" no
// glossário). Se QUALQUER pedaço não tiver tradução, fica o japonês inteiro —
// meia tradução confunde mais que ajuda (a regra do dbc e do gcd).
export function nameEn(ja, nomes = NOMES_EN) {
  const s = String(ja || "").trim();
  if (!s) return "";
  if (nomes.phrases[s]) return nomes.phrases[s];
  if (nomes.atoms[s]) return nomes.atoms[s];
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

// Imagem CURADA do dono substitui o scan (mesmo mecanismo dos outros vintages).
function curatedImg(id) {
  for (const ext of ["webp", "jpg", "png"]) {
    if (existsSync(fileURLToPath(new URL(`assets/cards/${GAME}/${id}.${ext}`, ROOT)))) return `/assets/cards/${GAME}/${id}.${ext}`;
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
        ...(def.series === "gc" || def.series === "go" ? { cardType: TIPOS[tipo] || "" } : {}),
        ...(CORES[k] ? { color: CORES[k].en } : {}),
        artist: "",
        language: "ja",
        image: curatedImg(c.id) || IMG(c.img || scanDe(c)),
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
  const line = cartasDoJogo(snapshot);
  const existing = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  // O catálogo é só deste sync; mas carta publicada nunca some.
  const have = new Set(line.map((c) => c.id));
  const merged = line.concat(existing.filter((c) => c && c.id && !have.has(c.id)));
  const pricing = (await readGlobalVar(new URL("pricing.js", OUT), "TCG_PRICING")) || {}; // sem preço
  await writeGameCatalog(OUT, { cards: merged, pricing, webDir: `data/${GAME}/` });
  const semNome = line.filter((c) => /^No\. /.test(c.name)).length;
  const comEn = line.filter((c) => c.nameJp).length;
  console.log(`  ${GAME}: ${line.length} cartas em ${(snapshot.sets || []).length} partes (${comEn} com nome EN, ${semNome} sem nome) -> ${merged.length} totais`);
}

async function run() {
  console.log("Saint Seiya (Bandai e Amada, 1988–2023, vintage)");
  let snapshot = await readSnapshot(SNAP);
  if (!NO_FETCH) snapshot = await refreshSnapshot(snapshot);
  if (!snapshot || !snapshot.sets) { console.log("  sem snapshot e sem fetch — nada a fazer."); return; }
  await build(snapshot);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
