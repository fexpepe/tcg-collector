// Catálogo do CARDFIGHT!! VANGUARD (Bushiroad; edição em inglês desde 2011) a
// partir da TCGCSV (tcgcsv.com), espelho público diário do TCGplayer —
// categoria 16 ("Cardfight Vanguard"), linha `cardfight-vanguard` (conferidas
// em 13/11/2026). Jogo ATIVO, na grade principal: em nov/2026 a TCGCSV já
// listava set em pré-venda até mar/2027. Mesmo padrão do Weiß Schwarz:
// catálogo inteiro em data/vanguard/ (cards.js versionado = durabilidade;
// 268 sets / ~26,4 mil cartas, sem o texto das cartas, que os jogos da TCGCSV
// não guardam).
//
// AS CINCO ERAS entram, por decisão do Fernando (13/11/2026): a série original
// (BT01…, 2011–2014), G (2014–2018), V (2018–2021), D (overDress/will+Dress,
// 2021–2024) e DZ (Divinez, 2024–). Só a edição inglesa: a japonesa não está
// no TCGplayer.
//
// Identidade: id = "vg-<productId>". O número impresso NÃO serve: nas promos a
// comum e a "(Foil)" dividem o número, e 107 sets têm número repetido.
// Cada paralela (SP/FR/FFR/SEC/assinada…) é um PRODUTO próprio no TCGplayer,
// com número próprio ("DZ-BT16/FR01EN") e preço próprio — vira carta separada,
// como no Weiß Schwarz. Por isso o preço só tem o subtipo Normal (u).
//
// Imagens: CDN do TCGplayer (_in_1000x1000), host já liberado na CSP e no SW e
// já coberto pelo espelho R2. A resolução varia por era (amostra de 14 cartas
// por era, 13/11/2026): DZ quase tudo 500×729, D 400×583, V de 400 a ~685 px,
// G e a série original muito em 200×29x. Aceito pelo Fernando ("sim, tudo");
// a busca de cartas do site oficial (en.cf-vanguard.com/cardlist) carrega por
// JavaScript e o tamanho da imagem de lá não foi medido — fica pra uma fase
// própria.
// Produto sem foto no TCGplayer (imageCount 0) usa a da carta-irmã do mesmo
// nome e número (a promo comum e a "(Foil)": scripts/lib/imagem-da-irma.mjs).
//
// setId: o CÓDIGO IMPRESSO do produto, que abre o nome do grupo ("DZ-BT16:
// Parallactic Dawn" -> DZ-BT16). Vale mais que a abreviação da fonte, que em 6
// grupos perde o prefixo da era ("SS04" pro D-SS04, "SSSB" pro DZ-SS04). Grupo
// sem código no nome (as promos, os trial decks antigos) fica com a
// abreviação, que não falta em nenhum e não se repete (13/11/2026); a barra do
// "KA1/2" vira hífen (setId é nome de arquivo e trecho de URL).
//
// Nome do set: sem o código na frente ("Parallactic Dawn"), como os outros
// jogos — o código aparece no selo do cartão (scripts/lib/codigo-do-set.mjs).
// Quando dois grupos ficam com o MESMO título (o booster e o trial deck de uma
// colaboração: "D-TB03: Shaman King" e "D-TTD03: Shaman King"; os dois Revival
// Collection), os dois guardam o nome inteiro da fonte, com o código: o nome
// do set é chave no índice e não pode repetir.
//
// Nome da carta: o TCGplayer repete o número no nome das homônimas ("Energy
// (SER) (DZ-BT09/SER01EN)", "Enjoy Summer Days! Holly (184)"). O número já vai
// no campo `number`, então sai do nome quando é o desta carta. Os outros
// qualificadores ficam: "(SP)", "(Foil)", "(Hot Stamped)".
//
// Fora do catálogo: os 45 produtos com raridade e SEM número (Energy,
// Fighter's Counter, marcadores) — carta, aqui, é produto com "Number", como
// em todo jogo da TCGCSV.
//
// Logo de set: nenhuma fonte conferida. Sem logo, o front desenha o NOME
// (política única do site). Arquivo que aparecer em
// data/vanguard/set-logos/<setId>.webp é usado.
//
//   node scripts/sync-vanguard.mjs
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { writeGameCatalog, readGlobalVar, preserveMissingCards, fetchJsonRetry, sleep } from "./lib/sync-common.mjs";
import { nomeDoSet } from "./lib/nome-do-set.mjs";
import { fotosDasIrmas } from "./lib/imagem-da-irma.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/vanguard/", ROOT);
const API = "https://tcgcsv.com/tcgplayer/16";
const UA = "Sleevu (sleevu.app) catalog sync";
const imagemDoProduto = (productId) => `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`;

const listOf = (j) => (j && Array.isArray(j.results)) ? j.results : [];
const api = async (path) => listOf(await fetchJsonRetry(`${API}${path}`, { headers: { "User-Agent": UA, Accept: "application/json" } }));

const r2 = (x) => Math.round(x * 100) / 100;
export const ext = (p, key) => {
  const d = (p.extendedData || []).find((e) => e.name === key);
  return d && d.value != null ? String(d.value).trim() : "";
};

// "DZ-BT16: Parallactic Dawn", "V-BT02 : Strongest! Team AL4", "EB12 - Waltz
// of the Goddess", "V-SS10 Premium Battle Deckset 2023" -> [código, título].
// O código tem de ter dígito ("Trial Deck 14: …" e "G-Legend Deck Vol.3: …"
// não são código) e é a grafia da Bushiroad: letras, hífen e número.
const CODIGO_NO_NOME = /^((?:DZ|D|V|G)-[A-Z]{2,4}\d{2}|[A-Z]{2,4}\d{2})\s*(?::|\s-\s|\s)\s*(\S.*)$/;
export function codigoETitulo(nome) {
  const m = CODIGO_NO_NOME.exec(String(nome || "").trim());
  return m ? [m[1], m[2].trim()] : ["", String(nome || "").trim()];
}

// `usados` = setIds já tomados nesta rodada: dois grupos nunca dividem o id.
export function setIdOf(g, usados = new Set()) {
  const [codigo] = codigoETitulo(g.name);
  const base = (codigo || String(g.abbreviation || "").trim().toUpperCase().replace(/[^A-Z0-9-]+/g, "-").replace(/^-+|-+$/g, ""))
    || `G${g.groupId}`;
  return usados.has(base) ? `${base}-${g.groupId}` : base;
}

// Título de cada grupo, sem o código — menos onde o título repete (cabeçalho).
// Recebe TODOS os grupos com carta, porque a repetição só se vê na lista.
export function nomesDosSets(grupos) {
  const titulo = (g) => nomeDoSet("vanguard", codigoETitulo(g.name)[1]);
  const vezes = new Map();
  for (const g of grupos) vezes.set(titulo(g).toLowerCase(), (vezes.get(titulo(g).toLowerCase()) || 0) + 1);
  const nomes = new Map();
  for (const g of grupos) {
    nomes.set(g.groupId, vezes.get(titulo(g).toLowerCase()) > 1 ? String(g.name || "").trim() : titulo(g));
  }
  return nomes;
}

// "Enjoy Summer Days! Holly (184)" com D-PR/184EN -> "Enjoy Summer Days!
// Holly"; "Energy (SER) (DZ-BT09/SER01EN)" -> "Energy (SER)". Número que NÃO é
// o desta carta fica (dado não se inventa).
export function nomeDaCarta(nome, numero) {
  const n = String(nome || "").trim();
  const num = String(numero || "").trim().toUpperCase();
  if (!num) return n;
  // Depois da barra: "D-PR/184EN" -> "184EN"; "V-PR/0209EN 2022" -> "0209EN".
  // Só número corrido conta ("FR01EN" não vira "(1)": o 1 pode ser versão).
  const parte = num.split("/").pop().split(/\s+/)[0];
  const cauda = (/^(\d+)/.exec(parte) || [])[1] || "";
  const limpo = n.replace(/\s*\(([^()]+)\)/g, (todo, dentro) => {
    const d = dentro.trim().toUpperCase();
    if (d === num || d === parte) return " ";
    if (/^\d+$/.test(d) && cauda && Number(d) === Number(cauda)) return " ";
    return todo;
  }).replace(/\s{2,}/g, " ").trim();
  return limpo || n;
}

// A fonte grafa o tipo de mais de 90 jeitos (erro de digitação, o subtipo da
// ordem colado: "Nornal", "Set Order/Research", "Normal Order Zeus"). Fica o
// tipo que a carta imprime; o que não dá pra saber vira null.
export function tipoDaCarta(bruto) {
  const s = String(bruto || "").trim();
  if (!s || /^none$/i.test(s)) return null;
  if (/^g[- ]guardian/i.test(s)) return "G Guardian";
  if (/^g(?:[- ]unit)?$/i.test(s)) return "G Unit";
  const ordem = /^(?:token\s+)?(normal|blitz|set|trigger)\s+order/i.exec(s);
  if (ordem) return `${ordem[1][0].toUpperCase()}${ordem[1].slice(1).toLowerCase()} Order`;
  if (/^trigger(?: unit)?$/i.test(s)) return "Trigger Unit";
  if (/^token/i.test(s)) return "Token";
  if (/crea?st/i.test(s)) return "Crest";
  if (/gift|marker/i.test(s)) return "Gift Marker";
  if (/^(?:n[a-z]{4,6}|unit)(?: unit)?(?:,.*)?$/i.test(s)) return "Normal Unit";
  if (/^(?:clan card|counter|energy)$/i.test(s)) return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return null;
}

// "Critical Trigger +10000", "Critcal", "Dront" (sic) -> o nome do gatilho.
// "Boost", "Intercept" e "Twin Drive!!" são o ícone de habilidade no campo
// errado: não são gatilho.
const GATILHOS = [[/^c[a-z]*t[a-z]*cal/i, "Critical"], [/^draw/i, "Draw"], [/^heal/i, "Heal"], [/^stand/i, "Stand"], [/^[fd]ront/i, "Front"], [/^over/i, "Over"]];
export function gatilhoDaCarta(bruto) {
  const s = String(bruto || "").trim();
  for (const [re, nome] of GATILHOS) if (re.test(s)) return nome;
  return null;
}

// A raridade por extenso de três famílias vira a sigla que a carta imprime e
// que a mesma fonte usa no resto do catálogo. "Gift Marker" não é raridade.
const RARIDADE_SIGLA = { "frame rare": "FR", "double frame rare": "FFR", "trial deck rare": "TDR", "gift marker": "", none: "" };
export function raridadeDaCarta(bruto) {
  const s = String(bruto || "").trim();
  const sigla = RARIDADE_SIGLA[s.toLowerCase()];
  return sigla != null ? sigla : s;
}

const NACAO_CERTA = { "united sanctary": "United Sanctuary" };
const nacaoDaCarta = (bruto) => {
  const s = String(bruto || "").trim();
  if (!s || /^none$/i.test(s)) return null;
  return NACAO_CERTA[s.toLowerCase()] || s;
};

// Produto da TCGCSV -> { card, price }. `by` = Map(subTypeName -> USD).
export function cardOf(p, g, setId, setName, setTotal, by = new Map()) {
  const id = `vg-${p.productId}`;
  const number = ext(p, "Number");
  const u = Number(by.get("Normal")) > 0 ? by.get("Normal") : ([...by.values()].find((v) => Number(v) > 0) || 0);
  const grau = ext(p, "Grade");
  const card = {
    id,
    name: nomeDaCarta(p.name, number),
    set: setName,
    setId,
    number,
    setTotal,
    setReleaseDate: (g.publishedOn || "").slice(0, 10),
    rarity: raridadeDaCarta(ext(p, "Rarity")),
    artist: "", // a TCGCSV não publica o ilustrador
    language: "en",
    image: imagemDoProduto(p.productId),
    variants: ["Normal"],
    // Normal Unit / Trigger Unit / G Unit / G Guardian / as Orders.
    cardType: tipoDaCarta(ext(p, "Unit")),
    // NAÇÃO (Dragon Empire, Keter Sanctuary…; nas colaborações, o título):
    // `color` é o nome que o índice de busca e o editor de decks esperam
    // (COLOR_FIELDS no sync-common). É o que monta o deck desde a era D.
    color: nacaoDaCarta(ext(p, "Nation")),
    // CLÃ (Royal Paladin, Kagero…): só as eras original, G e V imprimem.
    clan: /^none$/i.test(ext(p, "Clan")) ? null : (ext(p, "Clan") || null),
    grade: grau !== "" && Number.isFinite(Number(grau)) ? Number(grau) : null,
    trigger: gatilhoDaCarta(ext(p, "Trigger"))
  };
  return { card, price: u ? { u } : null };
}

async function run() {
  console.log("Cardfight!! Vanguard: buscando sets (TCGCSV cat. 16)…");
  const groups = await api("/groups");
  console.log(`  ${groups.length} grupos.`);

  const baixados = [];
  for (const g of groups) {
    await sleep(90); // educado com o espelho comunitário
    try {
      const products = await api(`/${g.groupId}/products`);
      const prices = await api(`/${g.groupId}/prices`);
      // Carta = produto com "Number"; o resto é selado ou marcador.
      const setCards = products.filter((p) => ext(p, "Number"));
      if (!setCards.length) { console.log(`  ${g.groupId} ${g.name}: 0 cartas (só selados ou pré-venda)`); continue; }
      baixados.push({ g, setCards, prices });
    } catch (e) {
      console.warn(`  ${g.groupId} ${g.name}: erro ${e.message} (pulado)`);
    }
  }

  const nomes = nomesDosSets(baixados.map((b) => b.g));
  const usados = new Set();
  const cards = [];
  const pricing = {}; // { id: { u } } — USD market do TCGplayer
  const irmas = fotosDasIrmas();

  for (const { g, setCards, prices } of baixados) {
    const priceBy = new Map(); // productId -> Map(subType -> USD)
    for (const p of prices) {
      const v = Number(p.marketPrice) > 0 ? p.marketPrice : (Number(p.midPrice) > 0 ? p.midPrice : 0);
      if (v <= 0) continue;
      if (!priceBy.has(p.productId)) priceBy.set(p.productId, new Map());
      priceBy.get(p.productId).set(p.subTypeName, r2(v));
    }
    const setId = setIdOf(g, usados);
    usados.add(setId);
    for (const p of setCards) {
      const { card, price } = cardOf(p, g, setId, nomes.get(g.groupId), setCards.length, priceBy.get(p.productId));
      cards.push(card);
      if (price) pricing[card.id] = price;
      irmas.anota(p, g, card.number, card);
    }
  }
  console.log(`  ${baixados.length} sets com carta.`);
  console.log((await irmas.aplica(imagemDoProduto)).resumo);

  // União preservadora: carta que sumiu do espelho fica (do cards.js anterior).
  const prev = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const merged = cards.concat(preserveMissingCards(prev, cards));

  merged.sort((a, b) =>
    String(a.setReleaseDate).localeCompare(String(b.setReleaseDate))
    || a.setId.localeCompare(b.setId)
    || a.number.localeCompare(b.number, undefined, { numeric: true })
    || a.id.localeCompare(b.id));
  console.log(`Total: ${merged.length} cartas, ${Object.keys(pricing).length} com preço.`);

  // setLogo: o arquivo local quando existir; senão VAZIO, e o front desenha o
  // NOME do set como título (.set-logo-placeholder).
  for (const c of merged) {
    const local = `data/vanguard/set-logos/${c.setId}.webp`;
    c.setLogo = existsSync(new URL(local, ROOT)) ? local : "";
  }

  const bySet = new Map();
  for (const c of merged) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c.id); }
  const indexes = {
    sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)),
    artists: []
  };

  await writeGameCatalog(OUT, { cards: merged, indexes, pricing, webDir: "data/vanguard/" });
  console.log(`Gravado em ${fileURLToPath(OUT)} (cards/indexes/pricing + manifest/chunks).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
