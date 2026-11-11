// ガンダム カードダス (Gundam Carddass, Bandai 1988–1997): o jogo vintage
// `gcd`, em data/gcd/. Entrou em 10/11/2026 como LINHA do jogo gundam e, no
// mesmo dia, virou jogo próprio (decisão do Fernando), como os outros
// vintages: chip, cor e contagem dele, sem misturar com o Gundam Card Game de
// 2025 na Coleção. Os ids (gcd-) e o endereço não mudaram. É a linha que INAUGUROU o
// Carddass: o SDガンダムワールド 第1弾 saiu em julho de 1988 na "Carddass 20",
// quatro meses antes do Dragon Ball. Em paralelo ao 本弾 a Bandai lançou as
// séries de história (外伝, 戦国伝, コマンド戦記, ガンドランダー…), todas
// levantadas em SETS abaixo.
//
// Fontes (levantamento de 2026-11-10):
//   80storage.com      — a tabela de TODAS as séries: 弾, ano, total e quantos
//                        prismas (https://80storage.com/archive/sd-gundam-carddass-series/).
//                        Não tem lista carta a carta. É de lá o subtítulo e o
//                        ano de cada 弾 (a mesma fonte do Dragon Ball Carddass).
//   animecollection.fr — catálogo de fã (francês) com UMA página por parte:
//                        número impresso, raridade (Prism/Regular) e scan de
//                        cada carta (~1000 px, marca d'água do site no canto).
//                        Só responde em HTTP (o HTTPS redireciona pro HTTP), e
//                        por isso a imagem sai pelo wsrv.nl, como nos outros
//                        sites de fã. Cobre o 本弾 (13弾), a 外伝 (16弾), a
//                        戦国伝 (4弾), a 新戦国伝 (só o 第1弾), a 聖伝 (2) e o
//                        Gガンダム. NÃO dá o nome da carta.
//   nome da carta      — nenhuma fonte acessível lista (o Suruga-ya barra
//                        robô; o MUUSEO tem só o que o dono da coleção tem).
//                        O nome está impresso na frente: foi TRANSCRITO dos
//                        scans em scripts/data/gundam-carddass-nomes.json (o
//                        cabeçalho de lá diz como). Inglês por glossário
//                        (scripts/data/gundam-carddass-nomes-en.json); sem
//                        tradução segura, fica o japonês.
//
// Séries sem lista carta a carta NÃO geram cartas (新外伝, ネオバトル,
// コマンド戦記, ガンドランダー, スーパーバトル, バトル・オブ・ナイツ e a 新戦国伝
// do 第2弾 em diante): inventar "No.1..42" criaria ids que teriam de mudar
// quando a lista real aparecesse. Elas ficam em SETS, sem `ac`, pra entrarem
// sozinhas no dia em que a fonte publicar.
//
// IDs: gcd-<série><parte>-<número impresso> (gcd-wd01-1 = World 第1弾 No.1;
// gcd-gd08-345). Número repetido dentro da parte (o No.500 do World 第13弾
// saiu em prisma e em prisma duplo) ganha sufixo pela ordem da fonte (500,
// 500b). O id fica GRAVADO no snapshot junto do id da carta na fonte (`src`),
// e o refresh reaproveita o id da carta já conhecida: reordenar a página não
// troca id, e carta que some da fonte fica.
//
//   node scripts/sync-gundam-carddass.mjs             # fetch (se der) + build
//   node scripts/sync-gundam-carddass.mjs --no-fetch  # só build do snapshot
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog, decodeEntities, sleep } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const GAME = "gcd";
const OUT = new URL(`data/${GAME}/`, ROOT);
const GUNDAM = new URL("data/gundam/", ROOT);
const SNAP = new URL("data/vintage/gundam-carddass.json", ROOT);
const NOMES = JSON.parse(readFileSync(new URL("scripts/data/gundam-carddass-nomes.json", ROOT), "utf8"));
const NOMES_EN = JSON.parse(readFileSync(new URL("scripts/data/gundam-carddass-nomes-en.json", ROOT), "utf8"));
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
const NO_FETCH = process.argv.includes("--no-fetch");
export const ID_PREFIX = "gcd-";
const FONTE = "www.animecollection.fr"; // sem esquema: o wsrv busca em HTTP, que é o que o site serve

// Séries: `code` abre o código do set (gcd-wd01, gcd-gd08…). `ja` é como a
// série abre o NOME do set, no padrão do dbc ("本弾 第1弾", "外伝 第1弾「…」"):
// sem o "SDガンダム"/"SD" da frente, que é a marca da linha (ela se chama
// "SDガンダム カードダス" no Japão) e já está no cabeçalho e no endereço
// (contrato 7 do docs/CATALOGO.md). Tem um segundo motivo, de endereço: o
// slug da página do set sai do nome, e do japonês só sobra o que é latim —
// "SDガンダムワールド 第1弾", "SDガンダム外伝 第1弾" e "SD戦国伝 第1弾" davam
// os três "sd-1", com -2 e -3 pela ORDEM do catálogo. Sem o "SD" o nome cai
// na régua do setId (gcd-wd01-1), que não muda. `titulo` é o título completo
// da série, pros textos; `en` abre o nome de exibição (src/nomes-sets.js). A
// ordem aqui é a das seções na página de Sets (groupGundamCarddassSets).
export const SERIES = {
  wd: { ja: "本弾", titulo: "SDガンダムワールド", en: "SD Gundam World" },
  gd: { ja: "外伝", titulo: "SDガンダム外伝", en: "SD Gundam Gaiden" },
  sg: { ja: "戦国伝", titulo: "SD戦国伝", en: "SD Sengokuden" },
  ns: { ja: "新戦国伝", titulo: "新SD戦国伝", en: "Shin SD Sengokuden" },
  sd: { ja: "聖伝", titulo: "SDガンダム聖伝", en: "SD Gundam Seiden" },
  gg: { ja: "機動武闘伝Gガンダム", titulo: "機動武闘伝Gガンダム", en: "Mobile Fighter G Gundam" }
};

// Todas as partes que a fonte cobre, na ordem de lançamento dentro da série.
// `date`: só o ANO, que é o que o 80storage dá (o Gガンダム, que ele não
// lista, vem do animecollection) — sem mês inventado. `ja`/`en`: o que vai
// depois do nome da série; subtítulo do 80storage, inglês tradução nossa (no
// padrão do dbc). `ac`: [coleção, série] da página do animecollection.
// `total`: só onde o total oficial difere da contagem da fonte (ver abaixo).
const P = (series, n, date, ac, ja = "", en = "", extra = {}) => ({
  code: `${series}${String(n).padStart(2, "0")}`, series, part: n, date, ac,
  ja: `第${n}弾${ja ? `「${ja}」` : ""}`, en: `Part ${n}${en ? ` — ${en}` : ""}`, ...extra
});
export const SETS = [
  // SDガンダムワールド 本弾: 13弾, No.1 a No.537. Sem subtítulo por 弾.
  P("wd", 1, "1988", [167, 351]), P("wd", 2, "1988", [167, 352]),
  // O 第3弾 tem 42 cartas no 80storage (e a numeração confirma: o 第4弾 começa
  // no 125), mas a fonte só tem do 83 ao 123: o No.124 falta lá.
  P("wd", 3, "1988", [167, 353], "", "", { total: 42 }),
  P("wd", 4, "1989", [167, 385]), P("wd", 5, "1989", [167, 386]), P("wd", 6, "1989", [167, 387]),
  P("wd", 7, "1989", [167, 388]), P("wd", 8, "1990", [167, 620]), P("wd", 9, "1990", [167, 621]),
  P("wd", 10, "1991", [167, 622]), P("wd", 11, "1991", [167, 623]), P("wd", 12, "1991", [167, 624]),
  P("wd", 13, "1992", [167, 625]),
  // SDガンダム外伝: 16弾 em quatro sagas (ジークジオン編, 円卓の騎士編,
  // 聖機兵物語, 機甲神伝説), No.1 a No.704.
  P("gd", 1, "1989", [7, 50], "ラクロアの勇者", "The Hero of Lacroa"),
  P("gd", 2, "1989", [7, 51], "伝説の巨人", "The Legendary Giant"),
  P("gd", 3, "1990", [7, 637], "アルガス騎士団", "The Knights of Argus"),
  P("gd", 4, "1990", [7, 638], "光の騎士", "The Knight of Light"),
  P("gd", 5, "1991", [7, 639], "ヴァトラスの剣", "The Sword of Vatras"),
  P("gd", 6, "1991", [7, 640], "流星の騎士団", "The Meteor Knights"),
  P("gd", 7, "1991", [7, 641], "キングガンダム", "King Gundam"),
  P("gd", 8, "1991", [7, 642], "円卓の騎士", "The Knights of the Round Table"),
  P("gd", 9, "1992", [7, 643], "復活の聖機兵", "The Holy Machine Soldier Revived"),
  P("gd", 10, "1992", [7, 644], "聖機兵VS機兵軍団", "Holy Machine Soldier vs. the Machine Soldier Army"),
  P("gd", 11, "1992", [7, 645], "もう一つの聖機兵", "The Other Holy Machine Soldier"),
  P("gd", 12, "1992", [7, 646], "真聖機兵誕生", "Birth of the True Holy Machine Soldier"),
  P("gd", 13, "1993", [7, 647], "紅の神秘機兵", "The Crimson Mystic Machine Soldier"),
  P("gd", 14, "1993", [7, 648], "六体の機甲神", "The Six Armored Gods"),
  P("gd", 15, "1993", [7, 649], "運命の三騎士", "The Three Knights of Fate"),
  P("gd", 16, "1993", [7, 650], "光の超機甲神", "The Super Armored God of Light"),
  // SD戦国伝: 4弾 de 21 cartas, numeradas em KANJI (一 a 八十四) na carta.
  P("sg", 1, "1990", [340, 720], "風林火山編", "Fūrinkazan Arc"),
  P("sg", 2, "1990", [340, 721], "風林火山編", "Fūrinkazan Arc"),
  P("sg", 3, "1991", [340, 722], "天下統一編", "Tenka Tōitsu Arc", { total: 21 }), // falta o 六十 (CORRECOES)
  P("sg", 4, "1991", [340, 723], "天下統一編", "Tenka Tōitsu Arc"),
  // 新SD戦国伝: a fonte só tem o 第1弾 (os outros três ficam sem `ac`).
  P("ns", 1, "1992", [345, 730], "地上最強編", "Chijō Saikyō Arc", { total: 21 }), // falta o 十九 (CORRECOES)
  P("ns", 2, "1992", null, "地上最強編 第2章", "Chijō Saikyō Arc, Chapter 2"),
  P("ns", 3, "1995", null, "超機動大将軍編", "Chō Kidō Daishōgun Arc"),
  P("ns", 4, "1996", null, "武神輝羅鋼編", "Bushin Kirahagane Arc"),
  // SDガンダム聖伝: as duas partes se chamam クエスト, e cada uma recomeça no 1.
  { code: "sd01", series: "sd", part: 1, date: "1996", ac: [307, 656], ja: "クエストワン「リオンの剣士」", en: "Quest One — The Swordsman of Rion" },
  { code: "sd02", series: "sd", part: 2, date: "1997", ac: [307, 657], ja: "クエストツー「最強の闘士」", en: "Quest Two — The Strongest Fighter" },
  // 機動武闘伝Gガンダム: parte única (1994), a única série que não é SD… no
  // nome; a arte é SD. O 80storage não lista: ano e total do animecollection.
  // Falta o No.031 (CORRECOES): 41 das 42.
  { code: "gg01", series: "gg", part: 1, date: "1994", ac: [342, 725], ja: "", en: "", total: 42 }
];
const SET_BY_CODE = new Map(SETS.map((s) => [s.code, s]));
const SET_ORDER = new Map(SETS.map((s, i) => [s.code, i]));

export function setName(def) { return [SERIES[def.series].ja, def.ja].filter(Boolean).join(" "); }
export function setNameEn(def) { return [SERIES[def.series].en, def.en].filter(Boolean).join(" "); }
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

// Numeração em kanji da 戦国伝 (一 … 八十四) -> arábico. O que já é arábico
// passa direto; o que não é número volta como veio.
const KANJI = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
export function numeroArabico(s) {
  const t = String(s || "").trim();
  if (/^\d+$/.test(t)) return String(Number(t));
  if (!/^[一二三四五六七八九十]+$/.test(t)) return t;
  const [dez, uni] = t.includes("十") ? t.split("十") : ["", t];
  const d = t.includes("十") ? (dez ? KANJI[dez] : 1) * 10 : 0;
  return String(d + (uni ? KANJI[uni] : 0));
}

// Texto de atributo/célula: a fonte escreve o kanji da 戦国伝 como entidade
// decimal (&#19968;), que o decodeEntities comum não cobre.
const texto = (s) => decodeEntities(String(s || "").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))).trim();

// Raridade como o Carddass a entende: o brilho. "Regular" da fonte é a carta
// comum (Normal, como no dbc); as prismas ficam com o nome que a fonte dá.
const RARIDADE = { Regular: "Normal", Prism: "Prism", "Double Prism": "Double Prism", "Prism Pixel": "Prism Pixel" };

// Página de uma parte do animecollection -> [{ src, num, rar }] na ordem da
// página. Cada carta é um bloco "bc_cadre": o cabeçalho traz a raridade (no
// title) e o número impresso; a miniatura, o id da carta no site e o caminho
// da imagem ("167/351/h400_14649"). Só o bloco "Cartes": a embalagem, que vem
// antes na página, usa outra função (afficher_detail_pack).
export function parseAnimeCollection(html) {
  const out = [];
  // Entre o cabeçalho e a miniatura não pode haver OUTRO cabeçalho: o item da
  // embalagem ("Display", "Dos des cartes") também tem um, e sem essa trava
  // ele casava com a miniatura da primeira carta.
  const re = /<div class="bc_cadre_numero" title="([^"]*)"[^>]*>\s*<div class="bc_texte_numero">([^<]*)<\/div>\s*<\/div>((?:(?!bc_cadre_numero)[\s\S])*?)afficher_detail\(\s*'(\d+)'\s*,\s*'(\d+)\/(\d+)\/h400_\4'\s*\)/g;
  let m;
  while ((m = re.exec(String(html || "")))) {
    out.push({
      src: Number(m[4]),
      num: numeroArabico(texto(m[2])),
      rar: RARIDADE[texto(m[1])] ?? texto(m[1]),
      dir: `${m[5]}/${m[6]}`
    });
  }
  return out;
}

// Erros DA FONTE, achados lendo o número impresso em cada scan (2026-11-10).
// Em três partes a página repete o scan de uma carta no lugar da seguinte: a
// carta de verdade falta lá, e a repetida não é carta nenhuma (`null` = sai).
// No Gガンダム a fonte ainda numera "31" a carta que imprime No.032. A chave é
// o id da carta na fonte.
export const CORRECOES = {
  29693: null,           // 戦国伝 第3弾: o mesmo scan do 五十九 (虐風乱); falta o 六十
  30029: null,           // 新戦国伝 第1弾: o mesmo scan do 十八; falta o 十九
  29795: null,           // Gガンダム: o mesmo scan do No.036; falta o No.031
  29790: { num: "32" }   // Gガンダム: impresso No.032 (シャイニングVSネロス), a fonte diz 31
};
export function corrige(cartas) {
  return cartas.filter((c) => CORRECOES[c.src] !== null).map((c) => (CORRECOES[c.src] ? { ...c, ...CORRECOES[c.src] } : c));
}

const numKey = (num) => String(num).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Casa as cartas da página com as do snapshot pelo id DA FONTE (`src`) pra
// manter o id. Carta nova: gcd-<set>-<número>, com sufixo (b, c…) se o número
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
      const base = `${ID_PREFIX}${setCode}-${numKey(c.num) || "x"}`;
      id = base;
      for (let i = 1; used.has(id); i++) id = `${base}${String.fromCharCode(97 + i)}`; // 500, 500b, 500c…
      used.add(id);
    }
    out.push({ id, src: c.src, num: c.num, rar: c.rar, dir: c.dir });
  }
  for (const k of known) if (!visto.has(k.src)) out.push(k);
  return out;
}

async function refreshSnapshot(existing) {
  const knownSets = new Map((existing?.sets || []).map((s) => [s.code, s.cards || []]));
  const sets = [];
  let reached = 0;
  for (const def of SETS.filter((s) => s.ac)) {
    const html = await fetchPage(`http://${FONTE}/cartes.php?idl=6&idc=${def.ac[0]}&ids=${def.ac[1]}`);
    const known = knownSets.get(def.code) || [];
    if (html !== null) reached++;
    const fresh = html ? corrige(parseAnimeCollection(html)) : [];
    // Parte que a fonte não devolveu (ou que o parser não entendeu) fica como
    // estava no snapshot.
    const cards = fresh.length ? assignIds(def.code, fresh, known) : known;
    if (cards.length) sets.push({ code: def.code, cards });
    await sleep(1200); // site pequeno, de fã: uma página por segundo
  }
  if (!reached) { console.log("  animecollection inacessível — segue com o snapshot versionado."); return existing; }
  for (const [code, cards] of knownSets) if (!sets.some((s) => s.code === code) && cards.length) sets.push({ code, cards });
  sets.sort((a, b) => (SET_ORDER.get(a.code) ?? 999) - (SET_ORDER.get(b.code) ?? 999));

  const candidate = { source: `http://${FONTE}/cartes.php?idl=6`, updatedAt: new Date().toISOString().slice(0, 10), sets };
  const newCount = snapshotCardCount(candidate);
  const oldCount = snapshotCardCount(existing);
  console.log(`  animecollection: ${sets.length} partes, ${newCount} cartas (snapshot: ${oldCount}).`);
  if (newCount < oldCount) { console.log(`  ⚠ REGRESSÃO (${newCount} < ${oldCount}) — snapshot mantido.`); return existing; }
  const same = existing && JSON.stringify((existing.sets || []).map((s) => s.cards)) === JSON.stringify(sets.map((s) => s.cards));
  if (!same) await writeSnapshot(SNAP, candidate);
  return (await readSnapshot(SNAP)) || candidate;
}

// Nome EN: o nome inteiro conhecido > composição por separador (VS/対 = "vs.";
// ＆ = "&"; ／ = "/"). Se QUALQUER pedaço não tiver tradução, fica o japonês
// inteiro — meia tradução confunde mais que ajuda (a regra do dbc).
export function nameEn(ja, nomes = NOMES_EN) {
  const s = String(ja || "").trim();
  if (!s) return "";
  if (nomes.phrases[s]) return nomes.phrases[s];
  if (nomes.atoms[s]) return nomes.atoms[s];
  const vs = s.split(/\s*(?:VS|ＶＳ|対)\s*/);
  if (vs.length > 1) {
    const parts = vs.map((p) => nameEn(p, nomes));
    return parts.every(Boolean) ? parts.join(" vs. ") : "";
  }
  const and = s.split(/\s*[＆&]\s*/);
  if (and.length > 1) {
    const parts = and.map((p) => nameEn(p, nomes));
    return parts.every(Boolean) ? parts.join(" & ") : "";
  }
  // "／": carta com mais de uma unidade, uma por linha (ver o cabeçalho do
  // scripts/data/gundam-carddass-nomes.json).
  const varias = s.split("／");
  if (varias.length > 1) {
    const parts = varias.map((p) => nameEn(p, nomes));
    return parts.every(Boolean) ? parts.join(" / ") : "";
  }
  return "";
}

// URL de ORIGEM do scan grande (sem esquema), e a do catálogo pelo wsrv. O
// "h3000" é o nome que a fonte dá à versão HD (na prática ~1000 px de largura).
export const scanDe = (c) => `${FONTE}/cartes/${c.dir}/h3000_${c.src}_carte.jpg`;
export const IMG = (src) => `https://wsrv.nl/?url=${encodeURIComponent(src)}&w=440&output=webp`;

// Imagem CURADA do dono substitui o scan (mesmo mecanismo dos outros vintages).
function curatedImg(id) {
  for (const ext of ["webp", "jpg", "png"]) {
    if (existsSync(fileURLToPath(new URL(`assets/cards/${GAME}/${id}.${ext}`, ROOT)))) return `/assets/cards/${GAME}/${id}.${ext}`;
  }
  return "";
}

// Cartas do jogo a partir do snapshot. `nomes`: id -> nome impresso (ja).
export function cartasDaLinha(snapshot, nomes = NOMES.nomes, nomesEn = NOMES_EN) {
  const line = [];
  for (const s of (snapshot && snapshot.sets) || []) {
    const def = SET_BY_CODE.get(s.code);
    if (!def) continue;
    // Y do "X/Y": o total oficial onde ele é conhecido e maior que o da fonte;
    // senão, quantos NÚMEROS a parte tem (a 2ª versão do mesmo número não conta).
    const total = def.total || new Set(s.cards.map((c) => c.num)).size;
    for (const c of s.cards) {
      const ja = nomes[c.id] || "";
      const en = nameEn(ja, nomesEn);
      line.push({
        id: c.id,
        // Sem nome transcrito (carta nova na fonte): o número, que é o que a
        // carta tem de certo. Não se inventa nome.
        name: en || ja || `No. ${c.num}`,
        ...(en && en !== ja ? { nameJp: ja } : {}),
        set: setName(def),
        setId: setIdOf(s.code),
        number: c.num,
        setTotal: total,
        setReleaseDate: def.date,
        rarity: c.rar || "",
        artist: "",
        language: "ja",
        image: curatedImg(c.id) || IMG(scanDe(c)),
        variants: ["Normal"],
        // Sem logo: nenhuma parte tem logo próprio, e o cartão do set mostra o
        // nome (contrato 3 do docs/CATALOGO.md).
        setLogo: "",
        vintage: true,
        vintageLine: def.series
      });
    }
  }
  return line;
}

// As cartas gcd- moraram no catálogo do Gundam Card Game enquanto isto foi
// linha dele. Tira de lá (cards, índices, chunks e manifest): o sync-gundam
// também as descarta, mas ele não roda no build rápido, e o data/gundam/sets
// que vem do cache ainda teria os 37 sets. Sem carta gcd- lá, não faz nada.
async function tiraDoGundam() {
  const cards = (await readGlobalVar(new URL("cards.js", GUNDAM), "TCG_CARDS")) || [];
  const resto = cards.filter((c) => c && !String(c.id).startsWith(ID_PREFIX));
  if (!cards.length || resto.length === cards.length) return 0;
  const bySet = new Map();
  for (const c of resto) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c.id); }
  const indexes = {
    sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)),
    artists: []
  };
  const pricing = (await readGlobalVar(new URL("pricing.js", GUNDAM), "TCG_PRICING")) || {};
  await writeGameCatalog(GUNDAM, { cards: resto, indexes, pricing, webDir: "data/gundam/" });
  return cards.length - resto.length;
}

async function build(snapshot) {
  const line = cartasDaLinha(snapshot);
  const existing = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  // O catálogo é só deste sync; mas carta publicada nunca some.
  const have = new Set(line.map((c) => c.id));
  const merged = line.concat(existing.filter((c) => c && c.id && !have.has(c.id)));
  const pricing = (await readGlobalVar(new URL("pricing.js", OUT), "TCG_PRICING")) || {}; // sem preço
  await writeGameCatalog(OUT, { cards: merged, pricing, webDir: `data/${GAME}/` });
  const tiradas = await tiraDoGundam();
  const semNome = line.filter((c) => /^No\. /.test(c.name)).length;
  const comEn = line.filter((c) => c.nameJp).length;
  console.log(`  ${GAME}: ${line.length} cartas em ${(snapshot.sets || []).length} partes (${comEn} com nome EN, ${semNome} sem nome) -> ${merged.length} totais${tiradas ? `; ${tiradas} saíram do catálogo do Gundam` : ""}`);
}

async function run() {
  console.log("Gundam Carddass (Bandai 1988–1997, vintage)");
  let snapshot = await readSnapshot(SNAP);
  if (!NO_FETCH) snapshot = await refreshSnapshot(snapshot);
  if (!snapshot || !snapshot.sets) { console.log("  sem snapshot e sem fetch — nada a fazer."); return; }
  await build(snapshot);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
