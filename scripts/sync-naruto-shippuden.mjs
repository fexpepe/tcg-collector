// NARUTO -ナルト- 疾風伝 カードゲーム (Bandai, 2007–2008): o jogo de mesa que
// sucedeu o NARUTO カードゲーム de 2002–2006 quando o anime virou Shippuden.
// Oito boosters (第一幕…第八幕), três starters, a Coin＋, o 忍者学校ルール
// (regras simplificadas, numeração própria 忍伝-学NNN) e as promos. Numeração
// GLOBAL por tipo — 忍伝 (ninja), 術伝 (jutsu), 作伝 (estratégia) —, então o
// número impresso é chave única do jogo. Pedido do Fernando em 2026-11-04 (uma
// carta dele, o 術伝-025 螺旋丸, não tinha onde ser cadastrada).
//
// FONTE: o site oficial da Bandai (carddas.com/naruto/cardgame/), fora do ar,
// pelas capturas do Wayback Machine. Cada produto tem uma lista oficial
// (product/cardlist_*.shtml|php, Shift-JIS) com número, nome e "収録" (em que
// produto vem). As capturas usadas são as MAIS NOVAS de cada página (a mais
// antiga às vezes é a de pré-lançamento) e estão fixas abaixo, pra o refresh
// ler sempre o mesmo documento. História encerrada (o 第八幕, nov/2008, foi o
// último), então a lista não muda: o fetch existe pra o snapshot poder ser
// refeito do zero, não pra pegar novidade. Conferido em 2026-11-04: 573
// números, com 忍伝 1–247, 術伝 1–198 e 作伝 1–65 sem buraco, e os totais
// batem com o "全NN種" das páginas de produto.
//
// DATAS: das páginas de produto do mesmo site, do catálogo da Bandai
// (bandai.co.jp/catalog) e do sec.carddass.com. Quando a fonte só dá o mês
// ("4月上旬", "7月下旬"), fica só o mês ("2008-04"): o app mostra "abril de
// 2008" e não inventa dia. O 第二幕 é 2007-05-18 na página do produto e no
// catálogo da Bandai; o log de novidades do site diz "6月18日" uma vez, e é o
// único lugar com essa data.
//
// IMAGENS: o site servia uma imagem por carta, mas o Wayback guardou só 5. O
// tcg-db.nikita.jp (cardlist/nrts) tem 13 scans, com raridade; o resto entra
// sem imagem (placeholder), como o Data Carddass. O Suruga-ya vende as avulsas
// com foto, mas barra acesso automatizado (desafio da Cloudflare): fica fora
// (contrato 4 do docs/CATALOGO.md). Raridade por carta também só existe nos
// 13 do tcg-db: as listas oficiais não a trazem.
//
// CADA NÚMERO MORA NO PRODUTO DE ESTREIA, como no Data Carddass: os starters
// repetem cartas dos boosters (o do 第一幕 tem 32, das quais 8 são novas), e
// a carta repetida fica no set onde apareceu primeiro. A lista do 忍者学校ルール
// também traz 9 cartas NM-xxx do Data Carddass ナルティメットミッション (as
// "対応カード" reimpressas): são da linha nrt-dc e ficam de fora daqui.
//
// Padrão-snapshot: o build parte de data/vintage/naruto-shippuden.json; o
// fetch só regrava quando responde e não regride. ANEXA ao catálogo do Naruto
// (ids nrt-scg-*) e o sync-naruto-vintage.mjs preserva a linha (OTHER_LINES).
// O deploy roda com --no-fetch: a lista é história encerrada, e 15 páginas
// esperando timeout com o Wayback fora do ar atrasariam o build inteiro. O
// fetch é pra refazer o snapshot à mão.
//
//   node scripts/sync-naruto-shippuden.mjs             # fetch + build
//   node scripts/sync-naruto-shippuden.mjs --no-fetch  # só build (o do deploy)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog, decodeEntities, sleep } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/naruto/", ROOT);
const SNAP = new URL("data/vintage/naruto-shippuden.json", ROOT);
const CACHE_DIR = new URL("data/.cache/", ROOT);
const WAYBACK = "http://web.archive.org/web/";
const SITE = "http://www.carddas.com/naruto/cardgame/product/";
const TCGDB = "https://tcg-db.nikita.jp/cardlist/nrts/";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
const NO_FETCH = process.argv.includes("--no-fetch");
const LOGO = "/assets/games/game_naruto-v2.webp";

// Os produtos, na ORDEM DE LANÇAMENTO: é ela que decide o set de estreia de
// uma carta repetida. `captura` é o timestamp do Wayback da lista oficial.
// `deck`: starter (setKind "deck" no catálogo). Nome sem o jogo na frente
// (contrato 7); o inglês de exibição mora no src/nomes-sets.js.
//
// Datas: 第一幕 e o starter, página do produto ("2007年２月15日発売予定");
// 第二幕, catálogo da Bandai e página do produto; Coin＋, catálogo da Bandai
// ("6月下旬"); 第三幕 e o starter, sec.carddass.com (2007-07-28; a Bandai diz
// "7月下旬"); 忍者学校ルール, "2007年9月中旬"; 第四幕 e 第五幕, dia exato na
// página; 第六幕 "4月上旬"; 第七幕 e o starter, "7月下旬"; 第八幕, "11月下旬".
export const PRODUTOS = [
  { key: "s01",  pagina: "cardlist_1st.shtml",      captura: "20100501175357", nome: "第一幕「砂隠に迫る脅威！編」", data: "2007-02-15" },
  { key: "st1",  pagina: "cardlist_1st_box.shtml",  captura: "20090227001026", nome: "第一幕 スターターBOX", data: "2007-02-15", deck: true },
  { key: "s02",  pagina: "cardlist_2nd.shtml",      captura: "20110215105956", nome: "第二幕「“暁”を追え！我愛羅奪還編」", data: "2007-05-18" },
  { key: "coin", pagina: "cardlist_coinplus.shtml", captura: "20090225172211", nome: "コインプラス", data: "2007-06" },
  { key: "s03",  pagina: "cardlist_3rd.shtml",      captura: "20120223212803", nome: "第三幕「激しき野望！傀儡演舞編」", data: "2007-07-28" },
  { key: "st3",  pagina: "cardlist_3rd_box.shtml",  captura: "20110215105129", nome: "第三幕 スターターBOX", data: "2007-07-28", deck: true },
  { key: "gaku", pagina: "cardlist_gaku.shtml",     captura: "20090209201912", nome: "忍者学校ルール", data: "2007-09" },
  { key: "s04",  pagina: "cardlist_4th.shtml",      captura: "20090206142754", nome: "第四幕「天地橋決戦！“根”から来た男編」", data: "2007-10-25" },
  { key: "s05",  pagina: "cardlist_5th.php",        captura: "20110215104546", nome: "第五幕「再会、忌まわしき写輪眼！編」", data: "2008-01-25" },
  { key: "s06",  pagina: "cardlist_6th.php",        captura: "20090228163306", nome: "第六幕「友との絆！断ち切れない想い編」", data: "2008-04" },
  { key: "s07",  pagina: "cardlist_7th.php",        captura: "20090206193606", nome: "第七幕「紅き烈風の絆編」", data: "2008-07" },
  { key: "st7",  pagina: "cardlist_7th_box.php",    captura: "20090228134845", nome: "第七幕 スターターセット", data: "2008-07", deck: true },
  { key: "s08",  pagina: "cardlist_8th.php",        captura: "20110215104923", nome: "第八幕「新術炸裂！伝説を超える力編」", data: "2008-11" },
  // Promos de evento, torneio e revista, de 2007 e 2008: sem data única,
  // como as promos do jogo de 2002 (nrt-promo). O nome leva "（疾風伝）"
  // porque "プロモーションカード" já é o set nrt-promo, e o nome é a chave do
  // set no catálogo do Naruto (índice de sets e endereço): dois sets não podem
  // dividir nome (contrato 7, homônimos).
  { key: "promo", pagina: "cardlist_promo.shtml",   captura: "20120228194530", nome: "プロモーションカード（疾風伝）", data: "" }
];

const TIPO = { "忍": "nin", "術": "jutsu", "作": "saku" };
const tres = (n) => String(Number(n)).padStart(3, "0");

// Id ASCII estável a partir do número impresso. Devolve null pro que não é
// desta linha (as NM-xxx do Data Carddass na lista do 忍者学校ルール).
//   忍伝-001 -> nrt-scg-nin-001     忍伝-学001 -> nrt-scg-gaku-nin-001
//   PR忍伝-1 -> nrt-scg-pr-nin-001  PR-学001   -> nrt-scg-pr-gaku-001
export function idDaCarta(num) {
  let m = /^(忍|術|作)伝-(\d+)$/.exec(num);
  if (m) return `nrt-scg-${TIPO[m[1]]}-${tres(m[2])}`;
  m = /^(忍|術|作)伝-学(\d+)$/.exec(num);
  if (m) return `nrt-scg-gaku-${TIPO[m[1]]}-${tres(m[2])}`;
  m = /^PR(忍|術|作)伝-(\d+)$/.exec(num);
  if (m) return `nrt-scg-pr-${TIPO[m[1]]}-${tres(m[2])}`;
  m = /^PR-学(\d+)$/.exec(num);
  if (m) return `nrt-scg-pr-gaku-${tres(m[1])}`;
  return null;
}

// Nome como está impresso. A lista oficial às vezes põe a leitura em
// parênteses depois do nome (来迎千手殺(らいごうせんじゅさつ)): é furigana, não
// faz parte do nome. O "&" de meio-tamanho vira "＆", a grafia das outras
// duplas do catálogo (o mapa de nomes em inglês casa por texto exato). E o
// 術伝-124 tem um kanji fora do Shift-JIS escrito como entidade numérica.
export function nomeLimpo(bruto) {
  return decodeEntities(String(bruto || "").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))))
    .replace(/[(（][ぁ-ゖァ-ヺー・]+[)）]$/, "")
    .replace(/&/g, "＆")
    .replace(/\?/g, "？")
    .trim();
}

// Uma lista oficial: cada carta é uma linha <td rowspan="2">NÚMERO</td>
// <td>NOME</td><td>収録</td>, e a linha de baixo traz o texto da carta (que o
// catálogo não usa). O cabeçalho ("No.") não tem dígito e cai fora.
export function parseLista(html) {
  const cartas = [];
  const re = /<td[^>]*rowspan="2"[^>]*>\s*([^<>]+?)\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
  for (const m of html.matchAll(re)) {
    const num = decodeEntities(m[1]);
    if (!/\d$/.test(num)) continue;
    cartas.push({ num, name: nomeLimpo(m[2]), onde: decodeEntities(m[3]) });
  }
  return cartas;
}

// tcg-db: uma linha de tabela por carta, com o scan (/img/card/nrts/N-037.jpg,
// fora o verso "back"), o número ("忍伝-037") e, depois do grupo de set
// ("※確認中</a>　R<br"), a raridade quando a fonte a conhece.
export function parseTcgDb(html) {
  const out = [];
  for (const linha of String(html || "").split(/<tr>/).slice(1)) {
    const code = [...linha.matchAll(/\/img\/card\/nrts\/([A-Za-z0-9_-]+)\.jpg/g)].map((m) => m[1]).find((c) => c !== "back");
    const num = (/(?:忍|術|作)伝-\d+/.exec(linha) || [])[0];
    if (!code || !num) continue;
    const rar = /<\/a>　([A-Z]{1,3})<br/.exec(linha);
    out.push({ num, code, rarity: rar ? rar[1] : "" });
  }
  return out;
}

const IMG_DB = (code) => `https://wsrv.nl/?url=${encodeURIComponent(`tcg-db.nikita.jp/img/card/nrts/${code}.jpg`)}&w=440&output=webp`;

// Imagem CURADA do dono: assets/cards/naruto/<id>.* substitui qualquer scan
// (mesmo mecanismo dos outros syncs do Naruto).
function curatedImg(id) {
  for (const ext of ["webp", "jpg", "png"]) {
    if (existsSync(fileURLToPath(new URL(`assets/cards/naruto/${id}.${ext}`, ROOT)))) {
      return `/assets/cards/naruto/${id}.${ext}`;
    }
  }
  return "";
}

// O catálogo da linha, sem disco (os testes chamam com fixtures). `snap.sets`
// vem na ordem do PRODUTOS; a primeira aparição de um número decide o set.
export function montaLinha(snap, { imagemCurada = () => "" } = {}) {
  const defByKey = new Map(PRODUTOS.map((p) => [p.key, p]));
  const doDb = new Map(((snap && snap.tcgdb) || []).map((c) => [c.num, c]));
  const ordem = [...((snap && snap.sets) || [])]
    .filter((s) => defByKey.has(s.key))
    .sort((a, b) => PRODUTOS.findIndex((p) => p.key === a.key) - PRODUTOS.findIndex((p) => p.key === b.key));
  const visto = new Set();
  const porSet = new Map(); // key -> cartas que estreiam ali
  let reimpressas = 0, deFora = 0;
  for (const s of ordem) {
    for (const c of s.cards || []) {
      const id = idDaCarta(c.num);
      if (!id) { deFora++; continue; }
      if (visto.has(id)) { reimpressas++; continue; }
      visto.add(id);
      if (!porSet.has(s.key)) porSet.set(s.key, []);
      porSet.get(s.key).push({ ...c, id });
    }
  }
  const line = [];
  for (const def of PRODUTOS) {
    const cartas = porSet.get(def.key);
    if (!cartas) continue;
    for (const c of cartas) {
      const db = doDb.get(c.num);
      line.push({
        id: c.id,
        name: c.name,
        set: def.nome,
        setId: `nrt-scg-${def.key}`,
        number: c.num,
        setTotal: cartas.length,
        setReleaseDate: def.data,
        // Mesma grafia do jogo de 2002 (N/R/SR/UR), que é a do tcg-db.
        rarity: (db && db.rarity) || "",
        artist: "",
        language: "ja",
        image: imagemCurada(c.id) || (db ? IMG_DB(db.code) : ""),
        variants: ["Normal"],
        setLogo: LOGO,
        ...(def.deck ? { setKind: "deck" } : {}),
        vintage: true,
        vintageLine: "nrt-scg"
      });
    }
  }
  return { line, reimpressas, deFora };
}

async function fetchText(url, encoding) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(45000) });
      if (r.ok) return new TextDecoder(encoding).decode(await r.arrayBuffer());
    } catch (e) { /* o Wayback recusa conexão às vezes: tenta de novo */ }
    await sleep(3000 * (i + 1));
  }
  return null;
}

async function cached(name, getter) {
  const file = new URL(name, CACHE_DIR);
  try { return await readFile(file, "utf8"); } catch { /* sem cache */ }
  const text = await getter();
  if (text) { await mkdir(CACHE_DIR, { recursive: true }); await writeFile(file, text, "utf8"); }
  return text;
}

async function refreshSnapshot(existing) {
  const sets = [];
  let missed = 0;
  for (const p of PRODUTOS) {
    // `id_` devolve o HTML original, sem a barra do Wayback.
    const html = await cached(`naruto-scg-${p.pagina}.html`, () => fetchText(`${WAYBACK}${p.captura}id_/${SITE}${p.pagina}`, "shift_jis"));
    const cards = html ? parseLista(html) : [];
    if (!cards.length) { missed++; console.log(`  ${p.pagina}: inacessível ou vazia`); continue; }
    sets.push({ key: p.key, cards: cards.map(({ num, name }) => ({ num, name })) });
    await sleep(800); // gentileza com o Wayback
  }
  const db = await cached("naruto-scg-tcgdb.html", () => fetchText(TCGDB, "utf-8"));
  const tcgdb = db ? parseTcgDb(db) : ((existing && existing.tcgdb) || []);
  if (missed === PRODUTOS.length) { console.log("  Wayback inacessível — segue com o snapshot versionado."); return existing; }
  // Snapshot parcial não substitui o completo: produto que falhou fica com o
  // que o snapshot anterior tinha.
  const antes = new Map(((existing && existing.sets) || []).map((s) => [s.key, s]));
  const porKey = new Map(sets.map((s) => [s.key, s]));
  const merged = PRODUTOS.map((p) => porKey.get(p.key) || antes.get(p.key)).filter(Boolean);
  const candidate = { source: `${WAYBACK}*/${SITE}`, updatedAt: new Date().toISOString().slice(0, 10), sets: merged, tcgdb };
  const newCount = snapshotCardCount(candidate);
  const oldCount = snapshotCardCount(existing);
  console.log(`  Wayback: ${sets.length} de ${PRODUTOS.length} listas, ${newCount} linhas (snapshot: ${oldCount}); tcg-db: ${tcgdb.length} scans.`);
  if (newCount < oldCount) { console.log(`  ⚠ REGRESSÃO (${newCount} < ${oldCount}) — snapshot mantido.`); return existing; }
  if (JSON.stringify({ ...candidate, updatedAt: "" }) !== JSON.stringify({ ...(existing || {}), updatedAt: "" })) await writeSnapshot(SNAP, candidate);
  return (await readSnapshot(SNAP)) || candidate;
}

async function run() {
  console.log("NARUTO 疾風伝 カードゲーム (Bandai 2007–2008, vintage)");
  let snap = await readSnapshot(SNAP);
  if (!NO_FETCH) snap = await refreshSnapshot(snap);
  if (!snap || !snapshotCardCount(snap)) { console.log("  snapshot vazio — nada a construir."); return; }

  const { line, reimpressas, deFora } = montaLinha(snap, { imagemCurada: curatedImg });
  const comImg = line.filter((c) => c.image).length;
  const sets = new Set(line.map((c) => c.setId)).size;
  console.log(`  build: ${line.length} cartas em ${sets} sets (${comImg} com imagem; ${reimpressas} reimpressões ficaram no set de estreia; ${deFora} de outra linha).`);

  const existing = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const kept = existing.filter((c) => c && !/^nrt-scg-/.test(String(c.id)));
  const merged = kept.concat(line);
  const pricing = (await readGlobalVar(new URL("pricing.js", OUT), "TCG_PRICING")) || {}; // vintage sem preço
  await writeGameCatalog(OUT, { cards: merged, pricing, webDir: "data/naruto/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} — ${merged.length} cartas totais.`);
}

// Importável pelos testes sem rodar o sync (ver tests/naruto-shippuden-sync.test.mjs).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
