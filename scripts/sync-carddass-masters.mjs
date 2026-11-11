// カードダスマスターズ (Carddass Masters, Bandai 1996–2009): o jogo vintage
// `cdm`, em data/cdm/. É a linha de cartas de coleção da Bandai em pacote de
// 10, com DEZENAS de IPs (Gundam, Evangelion, Cowboy Bebop, Hunter × Hunter,
// One Piece, Inuyasha, Bleach…). Por isso é jogo próprio, e não seção do jogo
// de cada marca (decisão do Fernando, 2026-11-09, no molde do mbc): cada
// edição de uma IP é um set, e a página de Sets tem uma seção por IP
// (groupCdmSets no app.js), com os sets em ordem de lançamento.
//
// Cada IP tem fonte própria, então cada uma tem o seu bloco aqui (IPS, no
// fim) e o seu snapshot (data/vintage/carddass-masters-<ip>.json, que só é
// regravado quando não regride). Têm lista carta a carta o HUNTER×HUNTER
// (2000–2001) e o 新世紀エヴァンゲリオン (1996–1997); IP nova entra como mais
// um bloco.
//
// IDs: cdm-<ip>-<set>-<número impresso> (cdm-hxh-p1-29, cdm-hxh-p2-sp4). O
// número é o que a Bandai imprimiu; o id não depende da ordem da fonte.
//
//   node scripts/sync-carddass-masters.mjs             # fetch (se der) + build
//   node scripts/sync-carddass-masters.mjs --no-fetch  # só build dos snapshots
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog, sleep } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
const NO_FETCH = process.argv.includes("--no-fetch");
const GAME = "cdm";
const ID_PREFIX = "cdm-";

// ── HUNTER×HUNTER (2000–2001) ───────────────────────────────────────────────
// Parte 1 (139 cartas), Premium Edition (20), Parte 2 (139) e os brindes das
// fitas VHS (só a VD3 é conhecida). Carta 64×90 mm com imagem do anime de 1999.
//
// Fontes (levantamento de 2026-11-09):
//   LISTA — scripts/data/carddass-masters-hxh.json: a カードリスト que a Bandai
//           imprimiu no verso das cartas (Parte 1: cartas 1 a 3; Parte 2: 7 a
//           9), lida nos scans. Dá o número, o nome em japonês (nameJp) e,
//           pela categoria, o que a carta é (puzzle, abertura, episódio,
//           personagem). O inglês sai das páginas de personagem da Hunterpedia
//           e da lista de episódios; o que a gente traduziu está marcado lá
//           ("traducao": "nossa"). A Premium Edition não tem lista no verso.
//   SCANS — Hunterpedia (Fandom), API MediaWiki, categorias "Carddass Masters
//           Regular Cards" e "… Special Cards": um arquivo por carta, a
//           raridade pela categoria e, na Premium Edition, o NOME pelas
//           galerias de personagem que usam o scan (o critério do Hyper Battle
//           do jogo hxh). Medido em 2026-11-09: 288 regulares + 10 especiais +
//           o brinde, a lista inteira das Partes 1 e 2 com scan.
//
// RECORTE: quase todo scan é a FRENTE E O VERSO na mesma imagem — lado a lado
// na carta vertical (1024×722), um embaixo do outro na horizontal (541×768). A
// frente sai pelo recorte do próprio servidor de imagem da Fandom
// (/revision/latest/window-crop/…), e não por parâmetro do wsrv.nl, de
// propósito: o espelho do R2 guarda a imagem pela URL de ORIGEM sem a query do
// wsrv (scripts/lib/img-mirror.mjs, chaveBase), então um &cx=… do wsrv
// sumiria no espelho e o site voltaria a mostrar o par. No caminho, o recorte
// faz parte da chave. Arquivo sem "front and back" no nome é só a frente (o
// formato da imagem não basta: carta horizontal sozinha também é larga). As
// cartas de episódio vêm deitadas no scan e aparecem giradas.
export const LISTA_HXH = JSON.parse(readFileSync(new URL("scripts/data/carddass-masters-hxh.json", ROOT), "utf8"));
const HUNTERPEDIA = "https://hunterxhunter.fandom.com/api.php";
const CATEGORIAS_HXH = ["Carddass Masters Regular Cards", "Carddass Masters Special Cards"];

// Sets na ordem de lançamento. `name` vai depois de "HUNTER×HUNTER " (a IP é o
// que separa os sets dentro do jogo; contrato 7 do docs/CATALOGO.md), sem
// "カードダスマスターズ", que é o jogo. A Parte 1 tem o subtítulo do pacote
// ("CARDDASS MASTERS 1 — ゴン×ライバル×ハンター試験開始!"); da Parte 2 nenhuma
// fonte achada dá subtítulo. A Premium Edition só tem nome em inglês
// (Hunterpedia): os pacotes dizem "ゴン×クラピカ×レオリオ VERSION" e as cartas
// "SPECIAL LIMITED". Datas: só o ano (Hunterpedia e o "BANDAI 2000/2001" do
// verso) — sem mês inventado.
export const SETS_HXH = [
  { code: "p1", name: "パート1 ゴン×ライバル×ハンター試験開始!", date: "2000", lista: "p1" },
  { code: "pe", name: "Premium Edition", date: "2000" },
  { code: "p2", name: "パート2", date: "2001", lista: "p2" },
  { code: "vd", name: "セルビデオ 購入特典カード", date: "2000", lista: "vd" }
];

async function api(base, params) {
  const url = `${base}?${new URLSearchParams({ format: "json", ...params })}`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.json();
    } catch (e) { /* retry */ }
    await sleep(1000 * (i + 1));
  }
  return null;
}

// nome do arquivo -> { setCode, num, fb } (fb = frente e verso na mesma
// imagem). Embalagem, caixa e o VERSO do brinde caem fora (null).
export function parseFile(name) {
  const f = String(name).replace(/^File:/, "").replace(/\.(png|jpe?g|webp)$/i, "").replace(/_/g, " ").toLowerCase().trim();
  const fb = / front and back$/.test(f);
  const base = f.replace(/ front and back$/, "");
  const num = (sp, n) => (sp ? `SP${Number(n)}` : String(Number(n)));
  let m = base.match(/^carddass masters part ([12]) card (sp)?(\d+)$/);
  if (m) return { setCode: `p${m[1]}`, num: num(m[2], m[3]), fb };
  m = base.match(/^carddass masters premium edition card (sp)?(\d+)$/);
  if (m) return { setCode: "pe", num: num(m[1], m[2]), fb };
  if (base === "hxh cm jacket collection bonus card - front") return { setCode: "vd", num: "VD3", fb: false };
  return null;
}

// Recorte da FRENTE, em pixels da imagem original: metade esquerda do par lado
// a lado, metade de cima do par empilhado; null = a imagem já é só a frente.
export function frontCrop(fb, w, h) {
  if (!fb || !w || !h) return null;
  return w > h ? { x: 0, y: 0, w: Math.floor(w / 2), h } : { x: 0, y: 0, w, h: Math.floor(h / 2) };
}

// URL de ORIGEM da frente (sem https://, sem ?cb=): o arquivo, ou o arquivo com
// o window-crop da Fandom no caminho (ver RECORTE acima).
export function frontUrl(url, crop) {
  const base = String(url).split("/revision/")[0].replace(/^https?:\/\//, "");
  if (!crop) return base;
  return `${base}/revision/latest/window-crop/width/${crop.w}/x-offset/${crop.x}/y-offset/${crop.y}/window-width/${crop.w}/window-height/${crop.h}`;
}
export const IMG = (src) => `https://wsrv.nl/?url=${encodeURIComponent(src)}&w=440&output=webp`;

// Categoria da Hunterpedia -> raridade. O brinde da fita mora na categoria das
// especiais, mas é brinde: Promo.
export function rarityOf(cats, setCode) {
  if (setCode === "vd") return "Promo";
  const has = (s) => cats.some((c) => c.toLowerCase().includes(s));
  if (has("special cards")) return "Special";
  if (has("regular cards")) return "Normal";
  return "";
}

// Páginas que EMBUTEM o scan -> personagem(ns) da carta (galerias
// "<Nome>/Image Gallery[/…]"), fora as páginas-índice.
const SKIP_PAGE = /^(Hunter × Hunter Alphabet|Hunter × Hunter Carddass Collections)/;
export function charactersOf(usage) {
  const names = [];
  for (const title of usage) {
    const m = String(title).match(/^(.+?)\/Image Gallery/);
    if (!m) continue;
    const who = m[1].trim();
    if (SKIP_PAGE.test(who) || names.includes(who)) continue;
    names.push(who);
  }
  return names;
}

// Scans da Hunterpedia -> sets do snapshot ({ code, cards: [{ num, rarity,
// chars, file, img }] }), ou null se a wiki não respondeu.
async function scansHxh() {
  const titles = [];
  for (const cat of CATEGORIAS_HXH) {
    let cont = null;
    for (let i = 0; i < 10; i++) {
      const j = await api(HUNTERPEDIA, { action: "query", list: "categorymembers", cmtitle: `Category:${cat}`, cmtype: "file", cmlimit: "500", ...(cont ? { cmcontinue: cont } : {}) });
      if (!j) return null;
      titles.push(...(j.query?.categorymembers || []).map((x) => x.title));
      cont = j.continue?.cmcontinue;
      if (!cont) break;
    }
  }
  const codes = new Set(SETS_HXH.map((s) => s.code));
  const wanted = titles.map((t) => ({ title: t, p: parseFile(t) })).filter((w) => w.p && codes.has(w.p.setCode));
  if (!wanted.length) return null;

  // Tamanho (pro recorte), categorias (raridade) e fileusage (personagem) em
  // lote: 50 títulos por chamada.
  const meta = new Map();
  for (let i = 0; i < wanted.length; i += 50) {
    const j = await api(HUNTERPEDIA, {
      action: "query", prop: "imageinfo|categories|fileusage", iiprop: "url|size", cllimit: "500", fulimit: "500",
      titles: wanted.slice(i, i + 50).map((w) => w.title).join("|")
    });
    if (!j) return null;
    for (const page of Object.values(j.query?.pages || {})) {
      const info = (page.imageinfo || [])[0] || {};
      meta.set(page.title, {
        url: info.url || "", w: info.width || 0, h: info.height || 0,
        cats: (page.categories || []).map((c) => String(c.title).replace(/^Category:/, "")),
        usage: (page.fileusage || []).map((u) => u.title)
      });
    }
    await sleep(250);
  }

  const cards = [];
  for (const { title, p } of wanted) {
    const m = meta.get(title);
    if (!m || !m.url) continue;
    if (cards.some((c) => c.set === p.setCode && c.num === p.num)) continue; // arquivo repetido: fica o primeiro
    cards.push({
      set: p.setCode,
      num: p.num,
      rarity: rarityOf(m.cats, p.setCode),
      chars: charactersOf(m.usage),
      file: title.replace(/^File:/, ""),
      img: frontUrl(m.url, frontCrop(p.fb, m.w, m.h))
    });
  }
  const numKey = (n) => (n.startsWith("SP") ? 1000 + Number(n.slice(2)) : Number(n.replace(/\D/g, "")) || 0);
  return SETS_HXH.map((s) => ({
    code: s.code, name: s.name,
    cards: cards.filter((c) => c.set === s.code).sort((a, b) => numKey(a.num) - numKey(b.num))
  })).filter((s) => s.cards.length);
}

// Cartas de um set: da LISTA quando o set tem lista (o scan só põe imagem e
// raridade), senão dos scans (Premium Edition, nome pelo personagem).
export function cardsOfSet(ip, def, scans) {
  const porNum = new Map((scans || []).map((c) => [c.num, c]));
  const base = def.lista
    ? ip.lista[def.lista].map((l) => ({ num: l.n, en: l.en, ja: l.ja, scan: porNum.get(l.n) }))
    : (scans || []).map((c) => ({ num: c.num, en: c.chars.length ? c.chars.slice(0, 2).join(" & ") : `Card ${c.num}`, ja: "", scan: c }));
  return base.map((c) => ({
    id: cardId(ip.ip, def.code, c.num),
    name: c.en,
    ...(c.ja && c.ja !== c.en ? { nameJp: c.ja } : {}),
    number: c.num,
    rarity: c.scan ? c.scan.rarity : (def.code === "vd" ? "Promo" : /^SP/.test(c.num) ? "Special" : "Normal"),
    img: c.scan ? c.scan.img : ""
  }));
}

// ── 新世紀エヴァンゲリオン (1996–1997) ──────────────────────────────────────
// 第壱集 (172 cartas), 第弐集 (172) e os dois カードダスマスターズワイド dos
// filmes (132 cada, carta larga 2:1). Foram as edições que abriram a linha.
//
// Fontes (levantamento de 2026-11-10):
//   LISTA — scripts/data/carddass-masters-eva.json: número impresso e nome em
//           japonês das listas de um colecionador de 1998 (fukumitu,
//           www2.nsknet.or.jp/~fukumitu/card_eva_1.html, _2, _dar e _eoe).
//           Página parada desde 1998, então é transcrição versionada, como a
//           カードリスト do HxH, e não fetch. O cabeçalho do arquivo diz de
//           onde sai o inglês e marca o que a gente traduziu.
//   SCANS — animecollection.fr (colecionador francês), uma página por edição
//           (cartes.php?idl=20&idc=<coleção>&ids=<série>): o número, a
//           raridade e um scan da FRENTE por carta. Medido em 2026-11-10:
//           172 + 132 + 132, e os 436 números batem um a um com a lista. A
//           第弐集 não está lá: entra pela lista, sem imagem. Todo scan traz a
//           marca d'água do site no canto (aceito pelo Fernando em 2026-11-10,
//           até a gente ter imagem própria: assets/cards/cdm/<id>.webp vence o
//           scan, ver curatedImg).
//   FICHA — エヴァンゲリオンカードのすべて (www2.hp-ez.com/hp/evacard/page1 e
//           /page7): mês de lançamento, total e subsets de cada edição.
//
// Ficam de fora, sem lista carta a carta achada: 第参集 (1998, 181), 第四集
// (2003, 99) e as do 新劇場版 (序 2008, 破 2010). As de pachinko (CR, 2008–
// 2010) e a 破 第2章 (2011) têm scan no animecollection.fr, mas não nome.
//
// O site só responde em http (o https devolve 301 pro http); o wsrv.nl busca a
// origem sem esquema e serve em https, então a CSP não muda.
export const LISTA_EVA = JSON.parse(readFileSync(new URL("scripts/data/carddass-masters-eva.json", ROOT), "utf8"));
const ANIMECOLLECTION = "http://animecollection.fr";

// `name` vai depois de "新世紀エヴァンゲリオン " (setPrefix). Os Wide são
// "カードダスマスターズワイド 新世紀エヴァンゲリオン劇場版 <filme>": o
// "カードダスマスターズワイド" é o jogo/formato e fica fora (contrato 7), o
// filme é o que nomeia o set. `ac`: [coleção, série] no animecollection.fr.
export const SETS_EVA = [
  { code: "p1", name: "第壱集", date: "1996-08", lista: "p1", ac: [61, 561] },
  { code: "p2", name: "第弐集", date: "1997-01", lista: "p2" },
  { code: "w1", name: "劇場版 シト新生", date: "1997-08", lista: "w1", ac: [63, 149] },
  { code: "w2", name: "劇場版 Air/まごころを、君に", date: "1997-12", lista: "w2", ac: [63, 151] }
];

// Rótulo do animecollection.fr -> número como está na lista: "CH - 23" ->
// CH23, "SP-06" -> SP6, "DEATH-001" -> DEATH-1, "25-01" -> 25-01 (第25話 1).
// No Air o número fica com dois dígitos de propósito: a tela ordena pelo
// primeiro número e desempata por TEXTO (compareCardNumbers), e "26-7" cairia
// depois de "26-10". "Puzzle", "Binder", "Booster" (montagens e embalagem) não
// são carta: null.
export function numAc(label) {
  const s = String(label).replace(/\s+/g, "").toUpperCase();
  let m = s.match(/^(DEATH|REBIRTH)-0*(\d+)$/);
  if (m) return `${m[1]}-${m[2]}`;
  m = s.match(/^(25|26)-0*(\d+)$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = s.match(/^([A-Z]{2})-0*(\d+)$/);
  return m ? `${m[1]}${m[2]}` : null;
}

// Página de uma série -> [{ num, rarity, img }]. Cada carta é um bloco
// "bc_cadre_numero" (title = raridade) com o rótulo e a miniatura
// cartes/<coleção>/<série>/h100_<id>_carte.jpg; o mesmo id tem a versão maior,
// h3000_ (713×1024 na carta normal, 1024×540 na Wide). Bloco sem miniatura de
// carta (embalagem, puzzle montado) e número repetido caem fora.
export function parseAc(html, idc, ids) {
  const out = [];
  const thumb = new RegExp(`cartes/${idc}/${ids}/h100_(\\d+)_carte\\.jpg`);
  for (const b of String(html).split('class="bc_cadre_numero"').slice(1)) {
    const rar = ((b.match(/^\s*title="([^"]*)"/) || [])[1] || "").trim();
    const num = numAc((b.match(/class="bc_texte_numero">([^<]*)</) || [])[1] || "");
    const id = (b.match(thumb) || [])[1];
    if (!num || !id || out.some((c) => c.num === num)) continue;
    out.push({ num, rarity: /^(SP|Super Rare)$/i.test(rar) ? "Special" : "Normal", img: `animecollection.fr/cartes/${idc}/${ids}/h3000_${id}_carte.jpg` });
  }
  return out;
}

// O site responde em ISO-8859-1; só o ASCII interessa, mas decodifica certo.
async function paginaLatin1(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
      if (r.ok) return new TextDecoder("latin1").decode(await r.arrayBuffer());
    } catch (e) { /* retry */ }
    await sleep(1000 * (i + 1));
  }
  return null;
}

// Scans do animecollection.fr -> sets do snapshot, ou null se uma página não
// respondeu (aí fica o snapshot versionado inteiro, e não meio catálogo).
async function scansEva() {
  const sets = [];
  for (const def of SETS_EVA) {
    if (!def.ac) continue;
    const [idc, ids] = def.ac;
    const html = await paginaLatin1(`${ANIMECOLLECTION}/cartes.php?idl=20&idc=${idc}&ids=${ids}`);
    if (!html) return null;
    const cards = parseAc(html, idc, ids).map((c) => ({ set: def.code, ...c }));
    if (cards.length) sets.push({ code: def.code, name: def.name, cards });
    await sleep(500);
  }
  return sets.length ? sets : null;
}

// ── Registro das IPs ────────────────────────────────────────────────────────
// `setPrefix`: como a IP abre o nome de cada set dela (o logo da série). O
// groupCdmSets tira o equivalente em inglês dentro da seção da IP.
// `logo`: o setLogo de TODOS os sets da IP — o logo da série com o do Carddass
// Masters pequeno no canto superior esquerdo, numa imagem só (pedido do
// Fernando, 2026-11-11: o jogo junta dezenas de IPs, e o tile só com o nome do
// set não dizia de qual série nem de qual jogo era). IP sem arquivo fica com
// "" e o tile mostra o nome. Montagem dos arquivos: assets/games/README.md.
export const IPS = [
  { ip: "hxh", setPrefix: "HUNTER×HUNTER", sets: SETS_HXH, lista: LISTA_HXH, scans: scansHxh,
    logo: "/assets/games/set_cdm_hxh.webp",
    snap: new URL("data/vintage/carddass-masters-hxh.json", ROOT),
    source: "https://hunterxhunter.fandom.com/wiki/Hunter_%C3%97_Hunter_Carddass_Collections" },
  // Depois do HxH no arquivo (a ordem aqui é só a do cards.js; na tela a seção
  // de 1996 vem antes, o groupCdmSets ordena pela data).
  { ip: "eva", setPrefix: "新世紀エヴァンゲリオン", sets: SETS_EVA, lista: LISTA_EVA, scans: scansEva,
    logo: "/assets/games/set_cdm_eva.webp",
    snap: new URL("data/vintage/carddass-masters-eva.json", ROOT),
    source: "http://animecollection.fr/cartes.php?idl=20" }
];

export const cardId = (ip, setCode, num) => `${ID_PREFIX}${ip}-${setCode}-${String(num).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
export const setIdOf = (ip, setCode) => `${ID_PREFIX}${ip}-${setCode}`;
export const setNameOf = (ip, def) => `${ip.setPrefix} ${def.name}`;

async function refreshSnapshot(ip, existing) {
  const sets = await ip.scans();
  if (!sets) { console.log(`  ${ip.ip}: fonte inacessível — segue com o snapshot versionado.`); return existing; }
  const candidate = { source: ip.source, updatedAt: new Date().toISOString().slice(0, 10), sets };
  const newCount = snapshotCardCount(candidate);
  const oldCount = snapshotCardCount(existing);
  console.log(`  ${ip.ip}: ${sets.length} sets, ${newCount} scans (snapshot: ${oldCount}).`);
  if (newCount < oldCount) { console.log(`  ⚠ REGRESSÃO (${newCount} < ${oldCount}) — snapshot mantido.`); return existing; }
  const same = existing && JSON.stringify((existing.sets || []).map((s) => s.cards)) === JSON.stringify(sets.map((s) => s.cards));
  if (!same) await writeSnapshot(ip.snap, candidate);
  return (await readSnapshot(ip.snap)) || candidate;
}

// Imagem CURADA do dono substitui o scan (mesmo mecanismo dos outros vintages).
function curatedImg(id) {
  for (const ext of ["webp", "jpg", "png"]) {
    if (existsSync(fileURLToPath(new URL(`assets/cards/${GAME}/${id}.${ext}`, ROOT)))) return `/assets/cards/${GAME}/${id}.${ext}`;
  }
  return null;
}

function cartasDaIp(ip, snapshot) {
  const scansDe = new Map(((snapshot && snapshot.sets) || []).map((s) => [s.code, s.cards]));
  const out = [];
  for (const def of ip.sets) {
    const cards = cardsOfSet(ip, def, scansDe.get(def.code));
    for (const c of cards) {
      out.push({
        id: c.id,
        name: c.name,
        ...(c.nameJp ? { nameJp: c.nameJp } : {}),
        set: setNameOf(ip, def),
        setId: setIdOf(ip.ip, def.code),
        number: c.number,
        setTotal: cards.length,
        setReleaseDate: def.date,
        rarity: c.rarity,
        artist: "",
        language: "ja",
        image: curatedImg(c.id) || (c.img ? IMG(c.img) : ""),
        variants: ["Normal"],
        // Logo da IP com o selo do jogo (ver `logo` no registro das IPs).
        setLogo: ip.logo || "",
        vintage: true,
        vintageLine: ip.ip
      });
    }
  }
  return out;
}

async function run() {
  console.log("Carddass Masters (Bandai 1996–2009, vintage)");
  const outDir = new URL(`data/${GAME}/`, ROOT);
  const line = [];
  for (const ip of IPS) {
    let snapshot = await readSnapshot(ip.snap);
    if (!NO_FETCH) snapshot = await refreshSnapshot(ip, snapshot);
    line.push(...cartasDaIp(ip, snapshot));
  }
  if (!line.length) { console.log("  sem snapshot e sem fetch — nada a fazer."); return; }
  const existing = (await readGlobalVar(new URL("cards.js", outDir), "TCG_CARDS")) || [];
  // Carta publicada nunca some: a que saiu da lista/scans fica congelada.
  const have = new Set(line.map((c) => c.id));
  const merged = line.concat(existing.filter((c) => c && !have.has(c.id)));
  const pricing = (await readGlobalVar(new URL("pricing.js", outDir), "TCG_PRICING")) || {};
  await writeGameCatalog(outDir, { cards: merged, pricing, webDir: `data/${GAME}/` });
  const semImg = line.filter((c) => !c.image).length;
  console.log(`  ${GAME}: ${line.length} cartas de ${IPS.length} IP(s), ${semImg} sem imagem -> ${merged.length} totais`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
