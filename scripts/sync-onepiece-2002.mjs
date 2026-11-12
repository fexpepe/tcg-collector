// Catálogo VINTAGE #2 do One Piece: o "One Piece Card Game" de 2002–2005 (Bandai)
// — o jogo standalone de verso madeira ("From TV animation ONE PIECE CARD GAME"),
// distinto do Carddass Hyper Battle E do jogo moderno (TCGCSV). É onde vivem os
// prefixos LK/SB/JS/CS/MS/RG/RK/G/… que aparecem nos lotes vintage.
//
// Fonte: Grand Line Wiki (grandlinewiki.net/tcg/opcardgame2002.html) — checklist
// completa (22 sets, ~1330 cartas) na mesma família de markup do Hyper Battle,
// com ids "OP02*". Sem preço (não há fonte aberta) — set vintage de exibição.
//
// PADRÃO SNAPSHOT (fonte frágil -> dado versionado): o build parte do snapshot
// em data/vintage/onepiece-2002cardgame.json; o fetch do wiki só ATUALIZA quando
// responde e não regride. Determinístico e imune ao uptime/throttle do wiki.
//
// Imagens: o wiki não tem scan do 2002. Desde 2026-10-27 vêm do One Piece
// Collection pelo wsrv.nl, a partir do mapa versionado que o
// scans-onepiece-2002.mjs grava (1308 das 1317 cartas). Arquivo em
// data/onepiece/vintage-images-2002/, se um dia existir, vence.
//
// Roda DEPOIS do sync-onepiece + sync-onepiece-vintage: anexa ao mesmo catálogo
// do One Piece, dedupe pelo prefixo op2002- (coexiste com o Carddass opcd-).
//   node scripts/sync-onepiece-2002.mjs [--no-fetch]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeEntities as decode, slug, readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, sleep, writeGameCatalog } from "./lib/sync-common.mjs";
import { opcImageUrl } from "./lib/onepiececollection.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/onepiece/", ROOT);
const SNAP = new URL("data/vintage/onepiece-2002cardgame.json", ROOT);
const SCANS = new URL("data/vintage/onepiece-2002-scans.json", ROOT);
const CACHE = new URL("data/.cache/onepiece-2002.html", ROOT);
const IMG_DIR = new URL("data/onepiece/vintage-images-2002/", ROOT);
const OVERVIEW = "https://grandlinewiki.net/tcg/opcardgame2002.html";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };
const NO_FETCH = process.argv.includes("--no-fetch");

// DATA DA BANDAI vence a do wiki, set por set (2026-11-12). Só entra aqui
// data com fonte da própria Bandai; nome e setId (endereço) não mudam. Onde o
// catálogo Juggernauts (card.g1.xrea.com/t2/tbc21op2.html) diverge do wiki
// sem a Bandai dizer nada (Treasure Sheet 2), fica a do wiki. Fontes: a ficha
// do Carddass Club (sec.carddass.com/club/products/detail/<JAN>) e o site
// oficial antigo no Wayback (web.archive.org/web/<data>/http://www.carddas.com/onepiece/,
// com UM "s"; páginas em Shift-JIS).
export const DATA_BANDAI = {
  // Notícia de 2002/9/11 no site: "新製品が２種同時登場！ブースターパック第３弾
  // 『グランドラインへの導き』" junto da Starter 2, que o Carddass Club põe em
  // "2002年09月下旬" (detail/4543112139924000). Captura 20021001161712.
  "Grand Line's Guidance": "2002-09",
  // 麦わらの海賊旗: "2003年03月上旬" (detail/4543112164780000); o wiki dizia 2002.
  "Straw Hat Pirate Flag": "2003-03",
  // 冒険者たちの誓い: "2004年2月27日発売！" (product.html, captura 20040411183017).
  "The Adventurers' Oath": "2004-02",
  // 天空の黄金郷: booster pack "５月２８日(金)発売予定", vending "５月下旬"
  // (product.html, captura 20040603000732).
  "Golden Land in the Sky": "2004-05",
  // デービーバックファイトの罠 e o starter 悪魔の実: "８月下旬発売予定" até a
  // captura 20040830004242, "好評発売中" na 20040902051224.
  "Davy Back Fight Compilation": "2004-08",
  "Devil Fruit Users": "2004-08",
  // ウォーターセブンの秘宝 (9弾): "待望の最新弾 9月下旬発売！" (captura 20050907102238).
  "Hidden Treasures of Water 7": "2005-09"
};

const MONTHS = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12", january: "01", february: "02", march: "03", april: "04", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };
function toISO(dateText) {
  const m = /([A-Za-z]+)\.?[,\s]*(?:\d{1,2},?\s*)?(\d{4})/.exec(dateText || "");
  if (!m) return "";
  const mm = MONTHS[m[1].toLowerCase()];
  return mm ? `${m[2]}-${mm}` : m[2];
}

// RARIDADE: a última coluna de algumas tabelas. Nos sets do começo ela se
// chama "Holo:" e só existe na tabela de personagens (☆ = carta holo); de
// Baroque Works Assault em diante chama "Rarity:" e vale pra todas as
// tabelas, em estrelas (☆/☆☆/☆☆☆, como no wiki — a página não diz mais que
// isso, então o rótulo fica a estrela). Vazio nas duas = a comum ("Normal").
// Carta de tabela SEM a coluna (técnicas/eventos dos primeiros sets, promos)
// fica sem raridade — não dá pra saber, e chutar "Normal" mentiria.
// Medido em 2026-11-01: 1.105 linhas com a coluna, ~85% do catálogo.
export function raridade2002(coluna, valor) {
  // A estrela vem como entidade HEXA (&#x2606;), que o decodeEntities comum
  // não converte.
  const v = decode(String(valor || "").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))))
    .replace(/<[^>]+>/g, "").replace(/\s+/g, "");
  if (coluna === "Holo") return /☆/.test(v) ? "Holo" : "Normal";
  if (coluna === "Rarity") return /^☆+$/.test(v) ? v : "Normal";
  return "";
}
function raridadesDaTabela(tabela, mapa) {
  const coluna = (tabela.match(/id="OP02holoHead">\s*(Holo|Rarity):?\s*</) || [])[1];
  if (!coluna) return;
  for (const linha of tabela.split(/<tr\b/).slice(1)) {
    const num = (linha.match(/id="HBcardNum">([A-Z0-9-]+)</) || [])[1];
    if (!num) continue;
    // A ÚLTIMA célula da linha: o cabeçalho tem uma coluna a menos que os
    // dados (o nome ocupa duas células), então contar posição erra.
    const celulas = [...linha.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)];
    if (celulas.length) mapa.set(num.trim(), raridade2002(coluna, celulas[celulas.length - 1][1]));
  }
}

// Parser da página: 22 sets (split em OP02setName). Cada carta tem sempre um link
// <a href="02cardgame/<num>.html">NOME EN</a> (robusto a todas as layouts de linha
// — personagem/técnica/evento); o nome JP vem na célula OP02cardName seguinte.
export function parseOverview(html) {
  const segs = html.split(/<td id="OP02setName">/).slice(1);
  const sets = [];
  for (const seg of segs) {
    const name = seg.slice(0, seg.indexOf("</td>")).replace(/<[^>]+>/g, "").replace(/「[^」]*」/, "").replace(/\s+/g, " ").trim();
    const date = toISO((seg.match(/id="OP02setDate">([^<]+)</) || [])[1] || "");
    const official = Number((seg.match(/id="OP02setCC">(\d+)</) || [])[1] || 0);
    const cards = [];
    const raridades = new Map();
    for (const tabela of seg.split(/<table class="HBcardList">/).slice(1)) raridadesDaTabela(tabela, raridades);
    const re = /id="HBcardNum">([A-Z0-9-]+)<\/td>[\s\S]*?href="02cardgame\/[^"]*">([^<]*)<\/a>(?:[\s\S]{0,80}?id="OP02cardName">([^<]*)<\/td>)?/g;
    let m;
    while ((m = re.exec(seg))) {
      const num = m[1].trim();
      cards.push({ num, nameEn: decode(m[2]), nameJp: (m[3] || "").trim(), rarity: raridades.get(num) || "" });
    }
    if (cards.length) sets.push({ name, date, official, cards });
  }
  return sets;
}

async function refreshSnapshot(existing) {
  let html = null;
  // Cache local primeiro (seed do build), senão busca o wiki.
  try { html = await readFile(CACHE, "utf8"); } catch { /* sem cache */ }
  if (!html) {
    for (let i = 0; i < 4 && !html; i++) {
      try { const r = await fetch(OVERVIEW, { headers: UA }); if (r.ok) { html = await r.text(); await mkdir(new URL("data/.cache/", ROOT), { recursive: true }); await writeFile(CACHE, html, "utf8"); } } catch (e) { /* retry */ }
      if (!html) await sleep(1500 * (i + 1));
    }
  }
  if (!html) { console.log("  wiki inacessível — build segue do snapshot versionado."); return existing; }

  const sets = parseOverview(html);
  const candidate = { source: OVERVIEW, updatedAt: new Date().toISOString().slice(0, 10), sets };
  const newCount = snapshotCardCount(candidate);
  const oldCount = snapshotCardCount(existing);
  console.log(`  wiki: ${sets.length} sets, ${newCount} cartas.`);
  if (newCount < oldCount) { console.log(`  ⚠ REGRESSÃO (${newCount} < ${oldCount}) — snapshot mantido.`); return existing; }
  // Snapshot de antes de 2026-11-01 não tem a raridade: reescreve com a
  // contagem igual.
  const semRaridade = (existing?.sets || []).some((st) => st.cards.some((c) => !("rarity" in c)));
  if (newCount !== oldCount || (existing && sets.length !== existing.sets.length) || semRaridade) {
    await writeSnapshot(SNAP, candidate);
    console.log(`  snapshot atualizado: ${oldCount} -> ${newCount} cartas.`);
  }
  return (await readSnapshot(SNAP)) || candidate;
}

// Imagem: a local espelhada (num sem hífen, minúsculo -> lkc01.webp) vence; senão
// o scan do One Piece Collection DAQUELE set (o Treasure Sheet reimprime números
// com outro visual). Sem nenhum dos dois a carta fica SEM image — o app mostra
// placeholder e o prerender de SEO não emite <img> quebrado.
function cardImage(num, setName, scans) {
  const file = String(num).toLowerCase().replace(/-/g, "");
  if (file && existsSync(new URL(`${file}.webp`, IMG_DIR))) return `data/onepiece/vintage-images-2002/${file}.webp`;
  const path = scans?.sets?.[setName]?.scans?.[num];
  return path ? opcImageUrl(path) : "";
}

async function run() {
  console.log("One Piece Card Game 2002–2005 (vintage #2)");
  let snap = await readSnapshot(SNAP);
  if (!NO_FETCH || !snap) snap = await refreshSnapshot(snap);
  if (!snap || !snap.sets || !snap.sets.length) { console.error("  ERRO: sem snapshot nem fonte."); process.exit(1); }
  const scans = await readSnapshot(SCANS);

  const cards2002 = [];
  const takenIds = new Set();
  for (const s of snap.sets) {
    const setId = "op2002-" + slug(s.name);
    for (const c of s.cards) {
      let id = "op2002-" + c.num;
      while (takenIds.has(id)) id += "b"; // colisão rara (mesmo num em 2 sets) -> sufixo
      takenIds.add(id);
      cards2002.push({
        id,
        name: c.nameEn || c.num,
        // Só o nome do set (até 2026-11-02 era "OP 2002 — …"): a linha já
        // está no cabeçalho e no endereço. Regra 3.0 do docs/CATALOGO.md.
        set: s.name,
        setId,
        number: c.num,
        setTotal: s.official || s.cards.length,
        setReleaseDate: DATA_BANDAI[s.name] || s.date,
        rarity: c.rarity || "",
        artist: "",
        language: "ja",
        image: cardImage(c.num, s.name, scans),
        variants: ["Normal"],
        setLogo: "",
        opColor: null,
        cardType: null,
        cost: null,
        power: null,
        vintage: true,
        vintageLine: "op2002",
        nameJp: c.nameJp || null
      });
    }
  }
  const withImg = cards2002.filter((c) => c.image).length;
  console.log(`  build: ${cards2002.length} cartas em ${snap.sets.length} sets (${withImg} com imagem).`);

  // setLogo fica vazio (o front mostra o NOME do set): nenhum set do 2002 tem
  // logo, e a arte da 1ª carta no lugar dele foi abolida em todos os jogos
  // (docs/CATALOGO.md, regra 3). Antes dos scans isso já saía vazio sozinho.

  // Anexa ao catálogo: mantém tudo que NÃO é desta linha (op2002-), acrescenta o rebuild.
  const existing = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const kept = existing.filter((c) => !String(c.setId).startsWith("op2002-"));
  const have = new Set(kept.map((c) => c.id));
  const merged = kept.concat(cards2002.filter((c) => !have.has(c.id)));
  merged.sort((a, b) => String(a.setId).localeCompare(String(b.setId)) || String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));

  const bySet = new Map();
  for (const c of merged) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c.id); }
  const indexes = { sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)), artists: [] };
  const pricing = (await readGlobalVar(new URL("pricing.js", OUT), "TCG_PRICING")) || {};

  // Modo prod = manifest real + chunks por set (o front baixa sob demanda).
  await writeGameCatalog(OUT, { cards: merged, indexes, pricing, webDir: "data/onepiece/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} — ${merged.length} cartas totais.`);
}

// Importável pelos testes sem rodar o sync.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
