// NARUTO BORUTO CARD GAME (Bandai, 2019–2020): o primeiro jogo do Chrono Clash
// System, o sistema de turno e recurso que a Bandai lançou no Ocidente em
// junho de 2019 e depois usou no Godzilla e no Evangelion. Não tem booster:
// eram caixas de conteúdo fixo — Naruto & Naruto Shippuden Set (NB01) e Naruto
// Shippuden & Boruto Set (NB02) em junho de 2019, Hokage Set (NB03) e Master
// and Student Set (NB04) em novembro de 2019. Entrou a pedido do Fernando em
// 2026-11-12, na linha do tempo das cartas do Naruto ("2019 — Chrono Clash").
//
// O QUE ENTRA: as Tournament Pack Cards, as versões foil das cartas do NB01 e
// do NB02 que vinham nos Tournament Packs (dois por caixa da primeira edição,
// segundo a página do produto, e nos torneios de loja). É o único produto do
// jogo vendido carta a carta, e por isso o único que o TCGplayer lista como
// avulsa: 96 cartas numeradas (NB01-01 a 48 e NB02-01 a 48, sem buraco) e uma
// sem número. As caixas em si ficam de fora: o site oficial
// (chronoclashsystem.com, no Wayback) só tem a página de cada produto, sem
// lista carta a carta, e não achei outra fonte com a lista do NB03 e do NB04.
//
// FONTE: TCGCSV (espelho público do TCGplayer), categoria 60 "Chrono Clash
// System", grupo 2478 "NB Tournament Pack Cards". Conferido em 2026-11-12: 97
// produtos, 28 com foto (imageCount > 0) e 7 com preço. O id é
// "nrt-nb-<productId>": o número impresso é o MESMO da carta da caixa (o
// NB01-40-B foil e o não foil são cartas diferentes pra quem coleciona), então
// número não serve de chave se as caixas entrarem um dia.
//
// SEM PREÇO: o catálogo do Naruto é o vintage, sem preço (jogo encerrado, 7
// preços em 97 cartas). O link do TCGplayer não entra no popup pelo mesmo
// motivo das outras linhas (MARKETS do naruto).
//
// Padrão-snapshot, como as outras linhas do Naruto: o build parte de
// data/vintage/naruto-boruto.json; o fetch só regrava quando responde e não
// regride. O jogo acabou e a lista não muda, então o deploy roda com
// --no-fetch. ANEXA ao catálogo do Naruto (ids nrt-nb-*), e o
// sync-naruto-vintage.mjs preserva a linha (OTHER_LINES).
//
//   node scripts/sync-naruto-boruto.mjs             # fetch + build
//   node scripts/sync-naruto-boruto.mjs --no-fetch  # só build (o do deploy)
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { fetchJsonRetry, readGlobalVar, readSnapshot, writeSnapshot, snapshotCardCount, writeGameCatalog } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/naruto/", ROOT);
const SNAP = new URL("data/vintage/naruto-boruto.json", ROOT);
const BASE = "https://tcgcsv.com/tcgplayer";
const CATEGORIA = 60;
const HEADERS = { "User-Agent": "Sleevu (sleevu.app) catalog sync", Accept: "application/json" };
const NO_FETCH = process.argv.includes("--no-fetch");
const LOGO = "/assets/games/game_naruto_boruto.webp";

// Os grupos do TCGplayer que viram set, na ordem da página. O 2467 ("Naruto
// Boruto Card Game") são as caixas lacradas, não cartas. Nome sem o jogo na
// frente (contrato 7 do docs/CATALOGO.md): o grupo se chama "NB Tournament
// Pack Cards". Data: a página oficial do NB01 diz "Release: June 2019" e é o
// produto que trazia os Tournament Packs; fica o mês, sem dia inventado (o
// 28/06 do TCGplayer é a data da listagem).
export const SETS = [
  { groupId: 2478, key: "tpc", nome: "Tournament Pack Cards", data: "2019-06" }
];

export const ext = (p, key) => {
  const d = (p.extendedData || []).find((e) => e.name === key);
  return d && d.value != null ? String(d.value).trim() : "";
};

// O TCGplayer põe o número no nome quando há homônimos ("Rock Lee
// (NB02-10-B)"): o número já tem campo próprio. Parêntese que não é o número
// faz parte do nome ("Kurama (Kurama Link Mode)").
export function nomeLimpo(nome, numero) {
  const n = String(nome || "").trim();
  const sufixo = numero ? ` (${numero})` : "";
  return sufixo && n.endsWith(sufixo) ? n.slice(0, -sufixo.length).trim() : n;
}

// Nome que o TCGplayer digitou errado, pelo que a carta imprime (a foto do
// próprio produto é a prova): a NB02-48-EB é "Susano'o", não "Sasano'o".
export const NOME_IMPRESSO = {
  193306: "Majestic Attire: Susano'o"
};

// Produto da TCGCSV -> linha do snapshot (só o que o catálogo usa).
export function linhaDoProduto(p) {
  const numero = ext(p, "Number");
  return {
    productId: p.productId,
    num: numero,
    name: NOME_IMPRESSO[p.productId] || nomeLimpo(p.name, numero),
    tipo: ext(p, "CardType"),
    cor: ext(p, "CardColor"),
    foto: Number(p.imageCount) > 0
  };
}

// Ordem do set: pelo número impresso (NB01-01… NB02-48); a carta sem número
// vai pro fim, pelo productId.
export function ordena(cards) {
  return [...cards].sort((a, b) => {
    if (!a.num !== !b.num) return a.num ? -1 : 1;
    return a.num.localeCompare(b.num, "en", { numeric: true }) || a.productId - b.productId;
  });
}

// Imagem CURADA do dono: assets/cards/naruto/<id>.* substitui a foto da fonte
// (mesmo mecanismo dos outros syncs do Naruto).
function curatedImg(id) {
  for (const e of ["webp", "jpg", "png"]) {
    if (existsSync(fileURLToPath(new URL(`assets/cards/naruto/${id}.${e}`, ROOT)))) return `/assets/cards/naruto/${id}.${e}`;
  }
  return "";
}

// O catálogo da linha, sem disco (os testes chamam com fixture).
export function montaLinha(snap, { imagemCurada = () => "" } = {}) {
  const porKey = new Map(((snap && snap.sets) || []).map((s) => [s.key, s]));
  const line = [];
  for (const def of SETS) {
    const cartas = ordena((porKey.get(def.key) || {}).cards || []);
    for (const c of cartas) {
      const id = `nrt-nb-${c.productId}`;
      line.push({
        id,
        name: c.name,
        set: def.nome,
        setId: `nrt-nb-${def.key}`,
        number: c.num,
        setTotal: cartas.length,
        setReleaseDate: def.data,
        rarity: "", // o TCGplayer não dá raridade ("None"): as caixas eram de conteúdo fixo
        artist: "",
        language: "en",
        // Carta sem foto no TCGplayer fica sem imagem: a URL do CDN existe pra
        // todo productId, mas devolve o verso genérico.
        image: imagemCurada(id) || (c.foto ? `https://tcgplayer-cdn.tcgplayer.com/product/${c.productId}_in_1000x1000.jpg` : ""),
        variants: ["Foil"],
        setLogo: LOGO,
        cardType: c.tipo || null,
        vintage: true,
        vintageLine: "nrt-nb"
      });
    }
  }
  return line;
}

async function refreshSnapshot(existing) {
  const sets = [];
  for (const def of SETS) {
    try {
      const j = await fetchJsonRetry(`${BASE}/${CATEGORIA}/${def.groupId}/products`, { headers: HEADERS, retries: 3 });
      const cards = ordena((j.results || []).map(linhaDoProduto));
      if (cards.length) sets.push({ key: def.key, groupId: def.groupId, cards });
    } catch (e) {
      console.log(`  grupo ${def.groupId}: ${e.message}`);
    }
  }
  if (!sets.length) { console.log("  TCGCSV inacessível — segue com o snapshot versionado."); return existing; }
  // Grupo que falhou fica com o que o snapshot anterior tinha.
  const antes = new Map(((existing && existing.sets) || []).map((s) => [s.key, s]));
  const novos = new Map(sets.map((s) => [s.key, s]));
  const merged = SETS.map((d) => novos.get(d.key) || antes.get(d.key)).filter(Boolean);
  const candidate = { source: `${BASE}/${CATEGORIA}`, updatedAt: new Date().toISOString().slice(0, 10), sets: merged };
  const newCount = snapshotCardCount(candidate);
  const oldCount = snapshotCardCount(existing);
  console.log(`  TCGCSV: ${newCount} cartas (snapshot: ${oldCount}).`);
  if (newCount < oldCount) { console.log(`  ⚠ REGRESSÃO (${newCount} < ${oldCount}) — snapshot mantido.`); return existing; }
  if (JSON.stringify({ ...candidate, updatedAt: "" }) !== JSON.stringify({ ...(existing || {}), updatedAt: "" })) await writeSnapshot(SNAP, candidate);
  return (await readSnapshot(SNAP)) || candidate;
}

async function run() {
  console.log("NARUTO BORUTO CARD GAME (Bandai 2019–2020, Chrono Clash System)");
  let snap = await readSnapshot(SNAP);
  if (!NO_FETCH) snap = await refreshSnapshot(snap);
  if (!snap || !snapshotCardCount(snap)) { console.log("  snapshot vazio — nada a construir."); return; }

  const line = montaLinha(snap, { imagemCurada: curatedImg });
  const comImg = line.filter((c) => c.image).length;
  console.log(`  build: ${line.length} cartas em ${new Set(line.map((c) => c.setId)).size} set(s) (${comImg} com imagem).`);

  const existing = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const kept = existing.filter((c) => c && !/^nrt-nb-/.test(String(c.id)));
  const merged = kept.concat(line);
  const pricing = (await readGlobalVar(new URL("pricing.js", OUT), "TCG_PRICING")) || {}; // vintage sem preço
  await writeGameCatalog(OUT, { cards: merged, pricing, webDir: "data/naruto/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} — ${merged.length} cartas totais.`);
}

// Importável pelos testes sem rodar o sync (ver tests/naruto-boruto-sync.test.mjs).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
