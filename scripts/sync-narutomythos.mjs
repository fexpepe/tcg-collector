// NARUTO Mythos Trading Card Game (Cicaboom Srl, Gênova, 2026–): o TCG europeu
// do Naruto, licenciado, lançado em 13/03/2026 na Europa, no Reino Unido, na
// Turquia e no Oriente Médio, e desde agosto de 2026 na América do Norte. O
// site oficial promete a América do Sul, com suporte em português pro Brasil,
// a partir do Set 3 (2027). Jogo próprio (`narutomythos`), a pedido do
// Fernando em 2026-11-12 ("Sim, jogos próprios"): está vivo, tem set novo pela
// frente e não é do catálogo vintage do `naruto`.
//
// FONTE: a galeria oficial (narutotcgmythos.com/card-gallery), que lê um JSON
// público — API abaixo, um pedido por idioma, o mesmo que o navegador de
// qualquer visitante faz. O robots.txt do site e o do host das cartas liberam
// tudo. Conferido em 2026-11-12: 646 cartas, todas com imagem (webp de
// 700×957), nos sets 1 (1ª e 2ª edição) e 2. As imagens trazem a marca
// "SAMPLE" no meio, posta pela própria editora (o mesmo caso das da Bandai e
// da Bushiroad): é a única imagem oficial que existe.
//
// ID: "nmy-<SKU>", com o SKU oficial em minúsculas e sem o "NM-" da frente
// (NM-S1E1-C003FAV1 -> nmy-s1e1-c003fav1). O SKU é único nas 646 e diz o set,
// a edição, a raridade, o número, o acabamento e a versão; o número impresso
// ("133/130") não serve de chave, porque a Rare e a Rare Art dividem o número,
// e a Secret, a Secret Variant e a Legendary também.
//
// SETS: o trecho S<set>E<edição> do SKU.
//   - E1 é a 1ª edição: o set, com o nome que ele tem ("Konoha Shidō").
//   - E2 é a 2ª edição, o MESMO set impresso de novo com o selo "2nd Edition",
//     outras Secret Variant e outras Legendary: vira "<set> (2nd Edition)", e a
//     página do set mostra o seletor "Edição" (edicaoDoSet no nomes-sets.js).
//   - E0 são as cartas fora de edição: as Mythos de torneio (Weekly, Store
//     Championship, Regional, Release Event) e de feira. Viram "<set> Promos",
//     que a página de Sets põe como chip no cartão do set.
// Set ou edição que a fonte publicar e não estiver no SETS entra sozinho, com
// o nome da fonte e sem data, e o log avisa pra pinar.
//
// DATAS, do site oficial: Konoha Shidō em 13/03/2026 (notícia de 11/12/2025 e
// o roadmap); a 2ª edição em 26/06/2026, a data do Booster Display (notícia de
// 26/03/2026; vale pra Europa, Reino Unido e Turquia); Shinobi Shiren em
// 04/09/2026 (notícia de 17/04/2026, atualizada). As promos levam a data do
// set delas: a fonte não diz o dia de cada evento.
//
// RARIDADE: por extenso, como o site e o guia de coleção escrevem (Common,
// Uncommon, Rare, Rare Art, Special, Chibi, Shinobi, POP, Secret, Secret
// Variant, Legendary, Mythos). "Mission" é o que a fonte põe no campo das
// cartas de missão.
//
// ACABAMENTO: a galeria tem UMA entrada por número nas Common e Uncommon, com
// a arte Full Art (ou a holográfica, nos Attachments do Set 2), e o guia do
// Set 1 diz que cada uma existe em três versões (standard, full art e
// holográfica). O catálogo segue a galeria: uma carta por entrada, "Foil"
// quando a fonte diz Holo e "Normal" no resto. Separar as três versões fica
// pra quando a fonte as listar.
//
// SEM PREÇO: o TCGplayer não tem o jogo (conferido na TCGCSV em 2026-11-12,
// 94 categorias) e não há outra fonte de preço que aceite acesso automatizado.
//
// Padrão FAB: o data/narutomythos/cards.js é versionado, o sync roda no build
// completo, e carta que a fonte tirar fica congelada (contrato 2 do
// docs/CATALOGO.md). Fonte fora do ar = segue com o que está versionado.
//
//   node scripts/sync-narutomythos.mjs
import { fileURLToPath } from "node:url";
import { fetchJsonRetry, readGlobalVar, writeGameCatalog, preserveMissingCards } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const GAME = "narutomythos";
const OUT = new URL(`data/${GAME}/`, ROOT);
// O endereço que a galeria oficial chama (API_BASE no HTML dela). O host das
// cartas (cards.narutotcgmythos.com/api/cards) responde 401 sem passar por ele.
const API = "https://services.agenziamarketingcarpi.it/proxy/naruto/proxy.php?lang=en";
const HEADERS = { "User-Agent": "Sleevu (sleevu.app) catalog sync", Accept: "application/json" };

// S<set>E<edição> do SKU -> set do catálogo. Chave pinada: o setId não muda
// se a fonte renomear o set.
export const SETS = {
  S1E1: { setId: "nmy-s1", nome: "Konoha Shidō", data: "2026-03-13" },
  S1E2: { setId: "nmy-s1-2e", nome: "Konoha Shidō (2nd Edition)", data: "2026-06-26" },
  S1E0: { setId: "nmy-s1-promo", nome: "Konoha Shidō Promos", data: "2026-03-13" },
  S2E1: { setId: "nmy-s2", nome: "Shinobi Shiren", data: "2026-09-04" },
  S2E0: { setId: "nmy-s2-promo", nome: "Shinobi Shiren Promos", data: "2026-09-04" }
};

export const RARIDADE = {
  C: "Common", UC: "Uncommon", R: "Rare", RA: "Rare Art", SP: "Special", CHIBI: "Chibi", Shinobi: "Shinobi",
  POP: "POP", S: "Secret", SV: "Secret Variant", L: "Legendary", M: "Mythos", Mission: "Mission"
};

// "NM-S1E1-C003FAV1" -> { chave: "S1E1", set: 1, edicao: 1, id: "nmy-s1e1-c003fav1" }.
// SKU fora do formato não vira carta (devolve null): sem ele não há id estável.
export function lerSku(sku) {
  const m = /^NM-(S(\d+)E(\d+))-([A-Z0-9-]+)$/i.exec(String(sku || "").trim());
  if (!m) return null;
  return { chave: m[1].toUpperCase(), set: Number(m[2]), edicao: Number(m[3]), id: `nmy-${m[1]}-${m[4]}`.toLowerCase() };
}

// Set de uma chave que não está pinada: o nome é o da fonte sem o "Set N: " da
// frente, com a edição no padrão da régua (edicaoDoSet) e "Promos" na E0.
const ORDINAL = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;
export function setDaChave(sku, nomeDaFonte) {
  if (SETS[sku.chave]) return SETS[sku.chave];
  const base = String(nomeDaFonte || "").replace(/^Set\s*\d+\s*:\s*/i, "").trim() || `Set ${sku.set}`;
  if (sku.edicao === 0) return { setId: `nmy-s${sku.set}-promo`, nome: `${base} Promos`, data: "", novo: true };
  if (sku.edicao === 1) return { setId: `nmy-s${sku.set}`, nome: base, data: "", novo: true };
  return { setId: `nmy-s${sku.set}-${sku.edicao}e`, nome: `${base} (${ORDINAL(sku.edicao)} Edition)`, data: "", novo: true };
}

// "Naruto Uzumaki" + "I'll be the greatest Hokage" -> "Naruto Uzumaki - I'll be
// the greatest Hokage" (o formato do Lorcana): há dezenas de "Naruto Uzumaki",
// e é a versão que separa uma da outra na busca e na coleção.
export function nomeDaCarta(titulo, versao) {
  const t = String(titulo || "").replace(/\s+/g, " ").trim();
  const v = String(versao || "").replace(/\s+/g, " ").trim();
  return v ? `${t} - ${v}` : t;
}

const IMG = (url) => {
  const limpa = String(url || "").replace(/^https?:\/\//, "");
  return limpa ? `https://wsrv.nl/?url=${encodeURIComponent(limpa)}&w=440&output=webp` : "";
};

// Registro da API -> carta do catálogo (sem o setTotal, contado depois).
export function cardOf(c) {
  const sku = lerSku(c && c.SKU);
  if (!sku) return null;
  const set = setDaChave(sku, c.Set);
  return {
    card: {
      id: sku.id,
      name: nomeDaCarta(c.Title, c.Version),
      set: set.nome,
      setId: set.setId,
      number: String(c.ID || "").trim(),
      setTotal: 0,
      setReleaseDate: set.data,
      rarity: RARIDADE[c.Rarity] || String(c.Rarity || "").trim(),
      artist: "",
      language: "en",
      image: IMG(c.Image),
      variants: [/^holo$/i.test(String(c.Variant || "")) ? "Foil" : "Normal"],
      setLogo: "",
      cardType: String(c.CardType || "").trim() || null
    },
    ordem: Number(c.Order) || 0,
    setNovo: set.novo ? `${sku.chave} -> ${set.setId} "${set.nome}"` : ""
  };
}

// A lista da API -> { cards, avisos }. A ordem dentro do set é a da galeria
// oficial (campo Order). SKU repetido fica com o primeiro.
export function montaCatalogo(registros) {
  const vistos = new Set();
  const linhas = [];
  const avisos = new Set();
  let semSku = 0;
  for (const r of registros || []) {
    const x = cardOf(r);
    if (!x) { semSku++; continue; }
    if (vistos.has(x.card.id)) continue;
    vistos.add(x.card.id);
    if (x.setNovo) avisos.add(`set sem pin: ${x.setNovo} (pinar no SETS, com a data)`);
    linhas.push(x);
  }
  if (semSku) avisos.add(`${semSku} registro(s) sem SKU no formato NM-S<set>E<edição>-… ficaram de fora`);
  linhas.sort((a, b) => a.card.setId.localeCompare(b.card.setId) || a.ordem - b.ordem || a.card.id.localeCompare(b.card.id));
  const total = new Map();
  for (const { card } of linhas) total.set(card.setId, (total.get(card.setId) || 0) + 1);
  const cards = linhas.map(({ card }) => ({ ...card, setTotal: total.get(card.setId) }));
  return { cards, avisos: [...avisos] };
}

async function run() {
  console.log("NARUTO Mythos TCG: buscando a galeria oficial…");
  let registros = null;
  try {
    const j = await fetchJsonRetry(API, { headers: HEADERS, retries: 3 });
    registros = j && j[0] && Array.isArray(j[0].Cards) ? j[0].Cards : null;
  } catch (e) {
    console.log(`  fonte inacessível (${e.message}).`);
  }
  const prev = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  if (!registros || !registros.length) {
    console.log(`  sem resposta da galeria — segue com o catálogo versionado (${prev.length} cartas).`);
    return;
  }
  const { cards, avisos } = montaCatalogo(registros);
  for (const a of avisos) console.warn(`  AVISO: ${a}`);
  // Carta que a galeria tirar fica (id publicado nunca some).
  const congeladas = preserveMissingCards(prev, cards);
  const merged = cards.concat(congeladas);
  const porSet = new Map();
  for (const c of merged) porSet.set(c.set, (porSet.get(c.set) || 0) + 1);
  for (const [nome, n] of porSet) console.log(`  ${nome}: ${n} cartas`);
  console.log(`Total: ${merged.length} cartas (${merged.filter((c) => c.image).length} com imagem${congeladas.length ? `; ${congeladas.length} congeladas` : ""}).`);
  await writeGameCatalog(OUT, { cards: merged, pricing: {}, webDir: `data/${GAME}/` });
  console.log(`Gravado em ${fileURLToPath(OUT)}.`);
}

// Importável pelos testes sem rodar o sync (ver tests/narutomythos-sync.test.mjs).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
