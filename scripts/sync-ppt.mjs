// Sincroniza preços/imagens da PokemonPriceTracker (PPT) para as cartas JP,
// onde a TCGdex falha (preço-lixo do Cardmarket e imagens faltando, ex.: era
// Mega). Roda no BUILD, nunca no navegador: a key fica no secret PPT_API_TOKEN.
//
// Saída: data/ppt-prices.generated.json — { cardId: { u: USD, img: url, g?:{p9,p10} } }
// que o merge-catalogs aplica por cima do pricing (preço melhor) e do chunk
// (preenche imagem faltante).
//
// Uso:
//   PPT_API_TOKEN=xxx node scripts/sync-ppt.mjs --probe            # validação barata
//   PPT_API_TOKEN=xxx node scripts/sync-ppt.mjs --dry-run --set SV4a   # testa join 1 set (não grava)
//   PPT_API_TOKEN=xxx node scripts/sync-ppt.mjs --set SV4a,SV9     # grava só esses sets
//   PPT_API_TOKEN=xxx node scripts/sync-ppt.mjs                    # incremental c/ orçamento (todos JP)
//
// Flags:
//   --probe        diagnóstico (não grava)
//   --dry-run      faz o join e loga, mas NÃO grava o artefato
//   --set A,B      limita a esses setIds (nossos, ex.: SV4a)
//   --graded       inclui PSA 9/10 (custa +1 crédito/carta)
//   --budget N     teto de créditos neste run (padrão 8000)
//
// Sem PPT_API_TOKEN, é no-op (sai com sucesso) — o deploy não quebra.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const TOKEN = process.env.PPT_API_TOKEN;
const BASE = "https://www.pokemonpricetracker.com/api/v2";
const PROD = "https://tcg-collector.pages.dev";
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const PROBE = has("--probe");
const DRY = has("--dry-run");
const GRADED = has("--graded");
const BUDGET = Number(val("--budget")) || 8000;
const ONLY_SETS = (val("--set") || "").split(",").map((s) => s.trim()).filter(Boolean);

const dataDir = new URL("../data/", import.meta.url);
const cacheDir = new URL("../data/.cache/ppt/", import.meta.url);
const OUT = new URL("ppt-prices.generated.json", dataDir);
const NEWOUT = new URL("ppt-newcards.generated.json", dataDir);

if (!TOKEN) { console.warn("PPT_API_TOKEN não definido — pulando sync da PPT (no-op)."); process.exit(0); }

let creditsUsed = 0;
let lastCall = 0;
// O rate limit da PPT é PONDERADO por cartas (~ceil(cartas/10) "minute calls",
// teto 60/min). Uma página de 100 cartas custa ~10, então ~6 chamadas/min é o
// teto -> ~10s entre chamadas. Sem isso, ~7 paginas ja estouram (429).
const MIN_GAP = 10500;
async function ppt(path, retries = 3) {
  const gap = MIN_GAP - (Date.now() - lastCall);
  if (gap > 0) await new Promise((r) => setTimeout(r, gap));
  lastCall = Date.now();
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (res.status === 429 && retries > 0) {
    await new Promise((r) => setTimeout(r, 8000)); // backoff e tenta de novo
    return ppt(path, retries - 1);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || (json && json.error)) throw new Error(`PPT ${res.status}: ${(json && (json.error || json.message)) || res.statusText}`);
  const c = json.metadata && json.metadata.apiCallsConsumed && json.metadata.apiCallsConsumed.total;
  if (c) creditsUsed += c;
  return json;
}

// setName "SV4a: Shiny Treasure ex" -> "SV4a" (nosso setId). Sem ":" -> null.
function setCodeFromName(name) {
  const m = String(name || "").match(/^([A-Za-z0-9.-]+):/);
  return m ? m[1] : null;
}
// "349/190" -> 349 (inteiro, pra casar com o número do nosso card id).
function numOf(s) { const m = String(s || "").match(/(\d+)/); return m ? Number(m[1]) : null; }
// Chave de número PRESERVANDO o prefixo alfabético: "TG08/TG30" -> "tg8",
// "077/071" -> "77", "199" -> "199", "GG05" -> "gg5". Crucial pros sets que a
// TCGdex junta a Trainer/Galarian Gallery no chunk principal: o "TG08" não pode
// colidir com o regular "8" (numOf daria 8 pros dois → preço trocado).
function normNum(s) {
  const t = String(s || "").split("/")[0].trim().toLowerCase();
  const m = t.match(/^([a-z]*)0*(\d+)([a-z]*)$/);
  return m ? m[1] + m[2] + m[3] : t;
}

// Nosso chunk JP do set: tenta local (gerado no build); senão produção (pra
// dry-run local funcionar sem rodar o sync-tcgdex antes).
async function ourChunk(setId, lang = "ja") {
  const local = new URL(`sets/${lang}/${setId}.json`, dataDir);
  try { if (existsSync(local)) return JSON.parse(await readFile(local, "utf8")); } catch { /* segue pra prod */ }
  // O Cloudflare devolve 200 + HTML (fallback de SPA) pra path inexistente, então
  // r.ok não basta: checa que o corpo é um array JSON antes de parsear (senão
  // o JSON.parse de "<!doctype..." estouraria e derrubaria o run).
  try {
    const r = await fetch(`${PROD}/data/sets/${lang}/${setId}.json`);
    if (r.ok) { const t = await r.text(); if (t.trim().startsWith("[")) return JSON.parse(t); }
  } catch { /* nada */ }
  return null;
}

// Graded EN: mapa curado nosso setId -> id PPT (tcgPlayerNumericId, EN). Só sets
// de alto valor (onde graded importa); evita match fuzzy de nome (preço errado é
// pior que ausente). Os preços EN base vêm da TCGdex; aqui só pegamos o graded.
const EN_GRADED_SETS = {
  base1: 604, base2: 635, base3: 630, base4: 605, base5: 1373,
  gym1: 1441, gym2: 1440,
  neo1: 1396, neo2: 1434, neo3: 1389, neo4: 1444,
  ecard1: 1375, ecard2: 1397, ecard3: 1372,
  sma: 2594, // Hidden Fates Shiny Vault
  cel25: 2867 // Celebrations (set principal 1-25; a Classic Collection "A" vive no
              // mesmo chunk com numeração própria e NÃO casa com este id — ok)
};

// Sets EN onde a PPT PREENCHE/SOBREPÕE preço (+ imagem faltante + add-on-miss):
// nosso setId -> id(s) PPT (tcgPlayerNumericId). Diferente do graded (só `g`):
// aqui é fill de img/preço de mercado (TCGplayer USD). Valor = array porque a
// TCGdex junta Trainer/Galarian Gallery no chunk principal, mas na PPT são sets
// separados — então buscamos os dois ids e casamos por número normalizado.
// Dois motivos pra estar aqui:
//  - MEP: a TCGdex não tem arte nenhuma (img + add-on-miss).
//  - Modernos de alto valor: a TCGdex às vezes só dá o PISO do Cardmarket (EUR),
//    baixo demais pras alt-art/chase (ex.: Brilliant Stars TG08 = €0,11). A PPT
//    sobrepõe com o preço de mercado do TCGplayer (USD).
// ATENÇÃO ao setId nosso (TCGdex): a era SV usa ZERO-PADDING e ".5" (sv01, sv03.5,
// sv04.5, swsh12.5), NÃO "sv1"/"sv4pt5"/"swsh12pt5". Keys erradas = chunk não casa
// e o fill é silenciosamente pulado. Confirmadas contra o manifest de produção.
const EN_FILL_SETS = {
  mep: [24451],               // MEP Black Star Promos (era Mega: 0 arte na TCGdex)
  // Black Star Promos: a TCGdex NÃO precifica promos -> sem preço no app. A PPT
  // tem o mercado do TCGplayer; casamos por número (SM04, 027, SWSH001, XY01...).
  smp: [1861],                // SM Black Star Promos  (PPT "SM Promos")
  svp: [22872],               // SVP Black Star Promos (PPT "SV: Scarlet & Violet Promo Cards")
  swshp: [2545],              // SWSH Black Star Promos (PPT "SWSH: Sword & Shield Promo Cards")
  xyp: [1451],                // XY Black Star Promos  (PPT "XY Promos")
  swsh7: [2848],              // Evolving Skies
  swsh8: [2906],              // Fusion Strike
  swsh9: [2948, 3020],        // Brilliant Stars (+ Trainer Gallery)
  swsh10: [3040, 3068],       // Astral Radiance (+ Trainer Gallery)
  swsh11: [3118, 3172],       // Lost Origin (+ Trainer Gallery)
  swsh12: [3170, 17674],      // Silver Tempest (+ Trainer Gallery)
  "swsh12.5": [17688, 17689], // Crown Zenith (+ Galarian Gallery)
  "swsh4.5": [2754],          // Shining Fates
  cel25: [2867],              // Celebrations
  sv01: [22873],              // Scarlet & Violet base
  sv03: [23228],              // Obsidian Flames
  "sv03.5": [23237],          // 151
  "sv04.5": [23353],          // Paldean Fates
  sv05: [23381],              // Temporal Forces
  sv06: [23473],              // Twilight Masquerade
  "sv06.5": [23529],          // Shrouded Fable
  sv07: [23537],              // Stellar Crown
  sv08: [23651],              // Surging Sparks
  "sv08.5": [23821],          // Prismatic Evolutions
  sv09: [24073]               // Journey Together
};

// Sets JP que a TCGdex AINDA NÃO tem (set INTEIRO faltando) e que importamos
// direto da PPT: imagem + preço + número/nome. Diferente do fill acima, aqui NÃO
// há chunk irmão da TCGdex — então o sync sintetiza as cartas do zero e o
// merge-catalogs cria um chunk novo pra esses setIds (ja). Quando a TCGdex
// finalmente cadastrar o set, é só tirar daqui (a TCGdex tem metadata melhor).
// O code tem que casar com o prefixo do setName da PPT (ex.: "M5: ..." -> M5).
// Entrada pode ser uma string (code resolvido via /sets) OU { code, ppt } com o
// tcgPlayerNumericId direto — pra sets cujo nome na PPT não tem prefixo "CÓDIGO:"
// (ex.: "SV-P Promotional Cards", que não cai no setMap). svpj = SV-P japonês.
const JP_IMPORT_SETS = ["M5", "MBG", { code: "svpj", ppt: 23779 }];

// Cartas avulsas CURADAS que a TCGdex não tem (ex.: Ancient Mew, promo de filme que
// não está em set nenhum da TCGdex). Puxamos da PPT pelo NOME EXATO (preço de
// mercado + graded PSA + imagem) e emitimos como carta nova num set próprio. Cada
// uma vira 1 carta no catálogo (merge cria o chunk do setId). `pptName` casa o
// nome limpo exato (a PPT tem várias "Ancient Mew" — só a principal).
const CURATED_SINGLES = [
  { id: "amew-1", pptName: "Ancient Mew", lang: "en", setId: "amew", set: "Ancient Mew",
    name: "Ancient Mew", number: "1", dexId: 151, year: "2000", rarity: "Promo", variants: ["Holo"] },
  { id: "amew-2", pptName: "Ancient Mew (Japanese Exclusive Print)", lang: "en", setId: "amew", set: "Ancient Mew",
    name: "Ancient Mew (Japanese Exclusive Print)", number: "2", dexId: 151, year: "2000", rarity: "Promo", variants: ["Holo"] }
];

// Nome limpo da carta PPT: tira o sufixo de número e tags ("Snorlax - 077/071"
// -> "Snorlax"; "Meganium - 001 [Staff]" -> "Meganium").
function cleanName(name) {
  let s = String(name || "").replace(/\s*\[[^\]]*\]/g, ""); // tira [Staff] etc.
  // Tudo antes de "<traço> <número>" (qualquer traço: -, –, —; qualquer espaço).
  const m = s.match(/^(.*?)[\s ]*[-–—][\s ]*\d/);
  if (m) s = m[1];
  return s.trim();
}
// Espécie (mesma lógica do sync-tcgdex), pra casar no mapa de nomes.
function speciesOf(name) {
  return String(name || "").replace(/\b(VMAX|VSTAR|ex|EX|GX|V-UNION|V)\b/g, "").replace(/\s+/g, " ").trim();
}
// Variantes da carta sintetizada a partir do "printing" principal da PPT.
function variantsOf(c) {
  const p = String((c.prices && c.prices.primaryPrinting) || "").toLowerCase();
  if (p.includes("reverse")) return ["Reverse"];
  if (p.includes("holo")) return ["Holo"];
  return ["Normal"];
}
function genOf(dexId) {
  const id = Number(dexId); if (!id) return "";
  const caps = [151, 251, 386, 493, 649, 721, 809, 905];
  return caps.findIndex((c) => id <= c) + 1 || 9;
}
// Mapa reverso espécie(EN, minúsculo) -> dexId, a partir de pokemon-names.js.
let _revNames = null;
async function revNames() {
  if (_revNames) return _revNames;
  const m = await pokemonNames(); _revNames = {};
  for (const [dex, name] of Object.entries(m)) _revNames[String(name).toLowerCase()] = Number(dex);
  return _revNames;
}

// Busca graded EN de um set curado e casa por número com o nosso chunk EN.
// Retorna { cardId: { g } } (só graded — não mexe no preço/imagem EN da TCGdex).
async function syncGradedEN(ourSetId, pptNumericId) {
  const chunk = await ourChunk(ourSetId, "en");
  if (!chunk || !chunk.length) return null;
  // normNum (preserva sufixo: "5"->"5", "4A"->"4a") em vez de numOf, pra cards de
  // bônus no MESMO chunk (ex.: Celebrations Classic Collection "cel25-4A") não
  // colidirem com o número regular ("cel25-4") e roubarem/perderem o preço graded.
  const byNum = new Map();
  for (const card of chunk) { const n = normNum(String(card.id).replace(`${ourSetId}-`, "")); if (n) byNum.set(n, card.id); }
  const arr = [];
  for (let page = 0, offset = 0; page < 30; page++) {
    const j = await ppt(`/cards?setId=${pptNumericId}&language=english&limit=100&offset=${offset}&includeEbay=true&days=90`);
    const batch = j.data || [];
    arr.push(...batch);
    if (!(j.metadata && j.metadata.hasMore) || !batch.length) break;
    offset += batch.length;
  }
  // A PPT tem várias entradas no mesmo número (erros, staff, reverse...). Por
  // carta nossa, fica a impressão com MAIS vendas graded — a "principal" líquida,
  // não a variante de erro (que costuma vir sem graded).
  const best = {};
  for (const c of arr) {
    const ourId = byNum.get(normNum(c.cardNumber));
    if (!ourId) continue;
    const g = pickGraded(c);
    if (!g) continue;
    const score = ((g["10"] && g["10"].n) || 0) + ((g["9"] && g["9"].n) || 0);
    if (!best[ourId] || score > best[ourId].score) best[ourId] = { g, score };
  }
  const entries = {};
  for (const [id, b] of Object.entries(best)) entries[id] = { g: b.g };
  console.log(`  [EN graded] ${ourSetId} (ppt ${pptNumericId}): ${Object.keys(entries).length}/${arr.length} com graded`);
  return entries;
}

// Mapa setId(nosso) -> pptSetId, a partir do /sets da PPT (cacheado 7 dias).
const SETMAP_VERSION = 4; // bump invalida o cache do mapa de sets
const DISC_VERSION = 2;   // bump descarta o cache de descobertas (positivo+negativo)
const discoveredFile = () => new URL("discovered.json", cacheDir);
// Sets descobertos via cartas (ver discoverSetId) — { CODE: numericId|null }.
async function loadDiscovered() { try { const c = JSON.parse(await readFile(discoveredFile(), "utf8")); return c.v === DISC_VERSION ? (c.e || {}) : {}; } catch { return {}; } }
async function saveDiscovered(obj) { try { await writeFile(discoveredFile(), JSON.stringify({ v: DISC_VERSION, e: obj }), "utf8"); } catch { /* ignora */ } }

// Nome do Pokémon em INGLÊS por dexId (data/pokemon-names.js, gerado antes do
// sync-ppt). O chunk pré-merge tem pokemonName em japonês, que não casa na
// busca da PPT (catálogo inglês) — por isso a descoberta usa este mapa.
let _names = null;
async function pokemonNames() {
  if (_names) return _names;
  try {
    const raw = await readFile(new URL("pokemon-names.js", dataDir), "utf8");
    _names = JSON.parse(raw.replace(/^window\.TCG_POKEMON_NAMES = /, "").replace(/;\s*$/, ""));
  } catch { _names = {}; }
  return _names;
}

async function setMap() {
  await mkdir(cacheDir, { recursive: true });
  const cacheFile = new URL("sets.json", cacheDir);
  // TTL curto (2 dias): a PPT adiciona sets novos ao longo do tempo (ex.: o M3
  // entrou semanas depois do lançamento); refrescar o mapa cedo faz o set novo
  // ser pego em ~2 dias em vez de 7.
  let map = null;
  try {
    const c = JSON.parse(await readFile(cacheFile, "utf8"));
    if (c.v === SETMAP_VERSION && Date.now() - c.t < 2 * 864e5) map = new Map(c.m);
  } catch { /* sem cache */ }
  if (!map) {
    map = new Map();
    let offset = 0;
    // /sets não consome créditos de carta; pagina até acabar. Chave em MAIÚSCULA
    // porque a PPT mistura caixa ("m1L: Mega Brave" vs nosso setId "M1L").
    for (let page = 0; page < 50; page++) {
      const j = await ppt(`/sets?language=japanese&limit=100&offset=${offset}`);
      const arr = j.data || [];
      for (const s of arr) { const code = setCodeFromName(s.name); const id = s.tcgPlayerNumericId; if (code && id != null) { const k = code.toUpperCase(); if (!map.has(k)) map.set(k, id); } }
      if (!(j.metadata && j.metadata.hasMore)) break;
      offset += arr.length || 100;
    }
    await writeFile(cacheFile, JSON.stringify({ v: SETMAP_VERSION, t: Date.now(), m: [...map] }), "utf8");
  }
  // Sets que existem nas cartas mas faltam no /sets (ex.: M3) entram aqui.
  const disc = await loadDiscovered();
  for (const [code, id] of Object.entries(disc)) if (id != null && !map.has(code)) map.set(code, id);
  return map;
}

// Descobre o numericId de um set que não está no /sets (a PPT às vezes só lista
// o set semanas depois das cartas aparecerem). Busca cartas pelo pokemonName
// (inglês) do nosso chunk e casa o código do setName. Custa alguns créditos.
async function discoverSetId(ourSetId) {
  const chunk = await ourChunk(ourSetId);
  if (!chunk || !chunk.length) return null;
  const names = await pokemonNames();
  const code = ourSetId.toUpperCase();
  const tried = new Set();
  for (const card of chunk) {
    const q = names[card.dexId] || card.pokemonName; // INGLÊS (chunk pré-merge é JP)
    if (!q || tried.has(q)) continue;
    tried.add(q);
    if (tried.size > 2) break; // teto de buscas (custo); 2 basta p/ set que existe
    try {
      const j = await ppt(`/cards?search=${encodeURIComponent(q)}&language=japanese&limit=30`);
      const hit = (j.data || []).find((c) => { const cc = setCodeFromName(c.setName); return cc && cc.toUpperCase() === code; });
      if (hit && hit.setId != null) return hit.setId;
    } catch { /* tenta o próximo nome */ }
  }
  return null;
}

// Extrai o melhor valor unitário (USD) e a imagem de um card da PPT.
function pickPrice(c) {
  if (c.prices && c.prices.market > 0) return c.prices.market;
  const v = c.prices && c.prices.variants;
  if (v) for (const variant of Object.values(v)) for (const cond of Object.values(variant)) if (cond && cond.price > 0) return cond.price;
  return 0;
}
// Graded (eBay, por nota PSA). Por nota guarda: s = preço "mercado" (smartMarket
// ponderado, com fallback mediana/7d), r = recente 7 dias, m = mediana 90 dias,
// n = nº de vendas (90d), t = tendência (1 alta / -1 baixa). Tudo USD; o front
// converte. Só PSA 9 e 10 (as notas que movem o mercado).
function pickGraded(c) {
  const byGrade = c.ebay && c.ebay.salesByGrade;
  if (!byGrade) return null;
  const r2 = (x) => Math.round(x * 100) / 100;
  const one = (node) => {
    if (!node || !node.count) return null;
    const smart = node.smartMarketPrice && node.smartMarketPrice.price > 0 ? node.smartMarketPrice.price : 0;
    const med = node.medianPrice > 0 ? node.medianPrice : 0;
    const r7 = node.marketPrice7Day > 0 ? node.marketPrice7Day : 0;
    const s = smart || med || r7;
    if (!s) return null;
    const g = { s: r2(s) };
    if (r7 && Math.round(r7) !== Math.round(s)) g.r = r2(r7);
    if (med && Math.round(med) !== Math.round(s)) g.m = r2(med);
    if (node.count) g.n = node.count;
    if (node.marketTrend === "up") g.t = 1; else if (node.marketTrend === "down") g.t = -1;
    return g;
  };
  const out = {};
  const p10 = one(byGrade.psa10), p9 = one(byGrade.psa9);
  if (p10) out["10"] = p10;
  if (p9) out["9"] = p9;
  return Object.keys(out).length ? out : null;
}

// Busca um set na PPT e casa cada card com o nosso cardId pelo número.
// `lang`: "japanese" (default) ou "english". Retorna { entries, newCards }:
//  - entries: { cardId: { u, img, g? } } — ENRIQUECE cartas que já temos;
//  - newCards: cartas que a PPT tem e a TCGdex NÃO (add-on-miss), sintetizadas
//    a partir de uma carta-irmã do chunk (campos do set) + nome/num/img/preço.
// Retorna null se não houver chunk nosso desse set.
const MAX_NEW_PER_SET = 30; // teto defensivo contra lixo/erros da PPT num set
async function syncSet(ourSetId, pptSetId, lang = "japanese", withGraded = GRADED) {
  const ourLang = lang === "english" ? "en" : "ja";
  const chunk = await ourChunk(ourSetId, ourLang);
  if (!chunk || !chunk.length) { console.log(`  ${ourSetId}: sem chunk nosso (pulado)`); return null; }
  const byNum = new Map();
  for (const card of chunk) {
    const local = String(card.id).replace(`${ourSetId}-`, "").replace(/-(ja|zh|pt)$/, "");
    const k = normNum(local);
    if (k) byNum.set(k, card.id);
  }
  const sib = chunk[0]; // carta-irmã: campos do set (logo/símbolo/data/série).
  const rev = await revNames();

  const inc = withGraded ? "&includeEbay=true&days=90" : "";
  const pptIds = Array.isArray(pptSetId) ? pptSetId : [pptSetId];
  const arr = [];
  for (const pid of pptIds) {
    for (let page = 0, offset = 0; page < 30; page++) {
      const j = await ppt(`/cards?setId=${pid}&language=${lang}&limit=100&offset=${offset}${inc}`);
      const batch = j.data || [];
      arr.push(...batch);
      if (!(j.metadata && j.metadata.hasMore) || !batch.length) break;
      offset += batch.length;
    }
  }
  const entries = {};
  const misses = new Map(); // chave(normNum) -> melhor candidato (com imagem)
  for (const c of arr) {
    const rawNum = String(c.cardNumber || "").split("/")[0].trim(); // "TG08", "077", "199"
    const key = normNum(rawNum);
    const u = pickPrice(c), img = c.imageCdnUrl400 || c.imageCdnUrl200 || c.imageUrl || null;
    const ourId = key ? byNum.get(key) : null;
    if (ourId) {
      const e = {};
      if (u > 0) e.u = Math.round(u * 100) / 100;
      if (img) e.img = img;
      if (withGraded) { const g = pickGraded(c); if (g) e.g = g; }
      if (Object.keys(e).length) entries[ourId] = e;
    } else if (key && img) {
      // Add-on-miss: número que não existe no nosso chunk + tem imagem. Por número,
      // fica o de MAIOR preço (a impressão "principal", não a de erro/staff).
      const prev = misses.get(key);
      if (!prev || (u || 0) > (prev._u || 0)) misses.set(key, { c, _u: u || 0, img, rawNum });
    }
  }

  const newCards = [];
  for (const [, m] of misses) {
    if (newCards.length >= MAX_NEW_PER_SET) break;
    const name = cleanName(m.c.name);
    if (!name) continue;
    const num = m.rawNum;
    const id = ourLang === "en" ? `${ourSetId}-${num}` : `${ourSetId}-${num}-${ourLang}`;
    const dexId = rev[speciesOf(name).toLowerCase()] || "";
    const card = {
      id, name, pokemonName: dexId ? null : speciesOf(name),
      category: "", dexId, generation: genOf(dexId),
      pokemonImage: dexId ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${dexId}.png` : "",
      number: String(num),
      set: (sib && sib.set) || setCodeFromName(m.c.setName) || ourSetId,
      setId: ourSetId,
      setLogo: (sib && sib.setLogo) || "", setSymbol: (sib && sib.setSymbol) || "",
      setTotal: (sib && sib.setTotal) || "", setReleaseDate: (sib && sib.setReleaseDate) || "",
      setSerieId: (sib && sib.setSerieId) || "", setSerieName: (sib && sib.setSerieName) || "",
      artist: "", rarity: "", language: ourLang,
      image: m.img, variants: variantsOf(m.c),
      _new: true
    };
    if (card.pokemonName == null) card.pokemonName = ""; // o merge canoniza por dexId
    if (m._u > 0) card.price = { u: Math.round(m._u * 100) / 100 };
    newCards.push(card);
  }

  console.log(`  ${ourSetId} (ppt ${pptIds.join("+")}, ${lang}): ${Object.keys(entries).length} casadas, ${newCards.length} novas (add-on-miss)`);
  return { entries, newCards };
}

// Importa um set JP INTEIRO da PPT (a TCGdex não tem o set). Sem chunk irmão: os
// campos do set saem da própria PPT (nome do set pelo setName; total pelo
// "NNN/TTT"). Cada carta vira um _new (id "<CODE>-<num>-ja") que o merge injeta
// num chunk novo. Mantém só a impressão de MAIOR preço por número (não a de erro).
async function importJpSet(code, pptSetId) {
  const rev = await revNames();
  const pptIds = Array.isArray(pptSetId) ? pptSetId : [pptSetId];
  const arr = [];
  for (const pid of pptIds) {
    for (let page = 0, offset = 0; page < 30; page++) {
      const j = await ppt(`/cards?setId=${pid}&language=japanese&limit=100&offset=${offset}`);
      const batch = j.data || [];
      arr.push(...batch);
      if (!(j.metadata && j.metadata.hasMore) || !batch.length) break;
      offset += batch.length;
    }
  }
  // Nome do set e total, a partir das cartas (a PPT não tem endpoint de logo/símbolo).
  const setNameRaw = (arr.find((c) => c.setName) || {}).setName || code;
  const setName = setNameRaw.replace(/^[A-Za-z0-9.]+\s*[:：]\s*/, "").trim() || setNameRaw;
  const withDen = arr.find((c) => String(c.cardNumber || "").includes("/"));
  const setTotal = withDen ? String(withDen.cardNumber).split("/")[1].trim() : "";
  const best = new Map(); // normNum -> melhor candidato (maior preço, com imagem)
  for (const c of arr) {
    const rawNum = String(c.cardNumber || "").split("/")[0].trim();
    const key = normNum(rawNum);
    const img = c.imageCdnUrl400 || c.imageCdnUrl200 || c.imageUrl || null;
    if (!key || !img) continue;
    const u = pickPrice(c);
    const prev = best.get(key);
    if (!prev || (u || 0) > (prev._u || 0)) best.set(key, { c, _u: u || 0, img, rawNum });
  }
  const newCards = [];
  for (const [, m] of best) {
    const name = cleanName(m.c.name);
    if (!name) continue;
    const num = m.rawNum;
    const dexId = rev[speciesOf(name).toLowerCase()] || "";
    const card = {
      id: `${code}-${num}-ja`, name, pokemonName: dexId ? "" : speciesOf(name),
      category: "", dexId, generation: genOf(dexId),
      pokemonImage: dexId ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${dexId}.png` : "",
      number: String(num), set: setName, setId: code,
      setLogo: "", setSymbol: "", setTotal, setReleaseDate: "",
      setSerieId: "", setSerieName: "", artist: "", rarity: "", language: "ja",
      image: m.img, variants: variantsOf(m.c), _new: true
    };
    if (m._u > 0) card.price = { u: Math.round(m._u * 100) / 100 };
    newCards.push(card);
  }
  console.log(`  [JP import] ${code} (ppt ${pptIds.join("+")}): ${newCards.length} cartas (set "${setName}", total ${setTotal || "?"})`);
  return newCards;
}

// Cartas avulsas curadas (CURATED_SINGLES): busca por nome exato na PPT, com
// graded (includeEbay) + imagem, e popula `out` (preço/g) + `newCards` (a carta).
async function syncCuratedSingles(out, newCards) {
  for (const s of CURATED_SINGLES) {
    try {
      const lang = s.lang === "en" ? "english" : "japanese";
      const j = await ppt(`/cards?search=${encodeURIComponent(s.pptName)}&language=${lang}&limit=10&includeEbay=true&days=90`);
      const hit = (j.data || []).find((c) => cleanName(c.name).toLowerCase() === s.pptName.toLowerCase());
      if (!hit) { console.log(`  [curado] ${s.id}: nome "${s.pptName}" não achado na PPT`); continue; }
      const u = pickPrice(hit), img = hit.imageCdnUrl400 || hit.imageCdnUrl200 || hit.imageUrl || null;
      const g = pickGraded(hit);
      const e = {};
      if (u > 0) e.u = Math.round(u * 100) / 100;
      if (img) e.img = img;
      if (g) e.g = g;
      if (Object.keys(e).length) out[s.id] = e;
      newCards.push({
        id: s.id, name: s.name, pokemonName: "", category: "",
        dexId: s.dexId || "", generation: s.dexId ? genOf(s.dexId) : "",
        pokemonImage: s.dexId ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${s.dexId}.png` : "",
        number: s.number, set: s.set, setId: s.setId,
        setLogo: "", setSymbol: "", setTotal: "", setReleaseDate: s.year || "",
        setSerieId: "", setSerieName: "", artist: "", rarity: s.rarity || "Promo",
        language: s.lang, image: img, variants: s.variants || ["Normal"], _new: true
      });
      console.log(`  [curado] ${s.id}: "${s.name}" u=${e.u || "-"} graded=${g ? "sim" : "não"} img=${img ? "sim" : "não"}`);
    } catch (err) { console.log(`  [curado] ${s.id}: erro ${err.message}`); }
  }
}

const REFRESH_DAYS = 7; // re-busca um set se o cache dele tiver mais que isso

async function run() {
  const map = await setMap();
  console.log(`Mapa de sets JP (PPT): ${map.size} sets com código.`);

  // Quais sets: --set, senão todos os nossos JP do manifest de produção.
  let targets = ONLY_SETS;
  if (!targets.length) {
    try {
      const r = await fetch(`${PROD}/data/manifest.generated.js`); const txt = await r.text();
      const m = txt.match(/=\s*(\{[\s\S]*\});?\s*$/); const man = JSON.parse(m[1]);
      targets = man.sets.filter((s) => s.language === "ja").map((s) => s.id);
    } catch { console.warn("Sem manifest de produção; use --set."); targets = []; }
  }

  const setsCache = new URL("sets/", cacheDir);
  await mkdir(setsCache, { recursive: true });
  const cacheFileOf = (id) => new URL(`${id.replace(/[^A-Za-z0-9_.-]/g, "_")}.json`, setsCache);
  const readCache = async (id) => { try { return JSON.parse(await readFile(cacheFileOf(id), "utf8")); } catch { return null; } };

  // Sem --set, processa os mais ANTIGOS/faltantes primeiro: refresh rotativo
  // que cobre tudo em alguns runs e nunca estoura o orçamento.
  if (!ONLY_SETS.length) {
    const ages = await Promise.all(targets.map(async (s) => [s, (await readCache(s) || {}).t || 0]));
    targets = ages.sort((a, b) => a[1] - b[1]).map((x) => x[0]);
  }

  // Teto de tempo por run: com ~10s/chamada, o orçamento de créditos sozinho
  // deixaria o build longo demais. O que não couber agora entra nos próximos
  // deploys (rotação dos mais antigos primeiro + cache). 0 = sem teto.
  const TIME_CAP_MS = (Number(val("--max-minutes")) || 6) * 60 * 1000;
  const startedAt = Date.now();
  const discovered = await loadDiscovered();
  let discDirty = false;
  const out = {};
  const newCardsAll = []; // cartas que a PPT tem e a TCGdex não (add-on-miss)
  let fetched = 0, cacheHits = 0;

  // Sets EN de fill (MEP + modernos de alto valor): sobrepõe preço de mercado
  // (TCGplayer USD) + imagem faltante + add-on-miss. Sem graded (withGraded=false)
  // pra não dobrar o custo de crédito. Cacheia igual (chave "enfill-<setId>").
  const enFillTargets = ONLY_SETS.length
    ? Object.entries(EN_FILL_SETS).filter(([id]) => ONLY_SETS.includes(id))
    : Object.entries(EN_FILL_SETS);
  for (const [ourSetId, pptId] of enFillTargets) {
    const ck = `enfill-${ourSetId}`;
    const cached = await readCache(ck);
    if (cached && Date.now() - (cached.t || 0) < REFRESH_DAYS * 864e5 && !DRY) {
      Object.assign(out, cached.entries || {}); newCardsAll.push(...(cached.newCards || [])); continue;
    }
    if (creditsUsed >= BUDGET || (TIME_CAP_MS && Date.now() - startedAt > TIME_CAP_MS)) {
      if (cached) { Object.assign(out, cached.entries || {}); newCardsAll.push(...(cached.newCards || [])); }
      continue;
    }
    try {
      const r = await syncSet(ourSetId, pptId, "english", false);
      if (r) {
        Object.assign(out, r.entries); newCardsAll.push(...r.newCards);
        if (!DRY) await writeFile(cacheFileOf(ck), JSON.stringify({ t: Date.now(), entries: r.entries, newCards: r.newCards }), "utf8");
      } else if (cached) { Object.assign(out, cached.entries || {}); newCardsAll.push(...(cached.newCards || [])); }
    } catch (e) { console.log(`  [EN fill] ${ourSetId}: erro ${e.message}`); if (cached) { Object.assign(out, cached.entries || {}); newCardsAll.push(...(cached.newCards || [])); } }
  }

  // Graded EN (curado) primeiro: sets de alto valor onde graded importa (base set
  // etc.). Cacheia/rotaciona igual aos JP (chave "en-<setId>", janela REFRESH_DAYS).
  if (GRADED) {
    let enF = 0, enH = 0;
    for (const [ourSetId, pptNumericId] of Object.entries(EN_GRADED_SETS)) {
      const ck = `en-${ourSetId}`;
      const cached = await readCache(ck);
      if (cached && Date.now() - (cached.t || 0) < REFRESH_DAYS * 864e5 && !DRY) { Object.assign(out, cached.entries); enH++; continue; }
      if (creditsUsed >= BUDGET || (TIME_CAP_MS && Date.now() - startedAt > TIME_CAP_MS)) { if (cached) { Object.assign(out, cached.entries); enH++; } continue; }
      try {
        const entries = await syncGradedEN(ourSetId, pptNumericId);
        if (entries) { Object.assign(out, entries); enF++; if (!DRY) await writeFile(cacheFileOf(ck), JSON.stringify({ t: Date.now(), entries }), "utf8"); }
        else if (cached) Object.assign(out, cached.entries);
      } catch (e) { console.log(`  [EN graded] ${ourSetId}: erro ${e.message}`); if (cached) Object.assign(out, cached.entries); }
    }
    console.log(`Graded EN: ${enF} buscados, ${enH} do cache`);
  }

  for (const setId of targets) {
    const code = setId.toUpperCase();
    let pptId = map.get(code);
    // Set não listado no /sets (ex.: M3): descobre pelas cartas. Cache negativo
    // (`code in discovered`, valor null) evita re-tentar sets que de fato não
    // existem na PPT (E*/PCG*/neo*...). Gasta crédito, então só com orçamento/tempo.
    if (pptId == null && !(code in discovered) && creditsUsed < BUDGET && !(TIME_CAP_MS && Date.now() - startedAt > TIME_CAP_MS)) {
      const found = await discoverSetId(setId);
      if (!DRY) { discovered[code] = found; discDirty = true; }
      if (found != null) { pptId = found; map.set(code, found); console.log(`  ${setId}: descoberto via cartas (ppt ${found})`); }
    }
    if (pptId == null) { console.log(`  ${setId}: sem equivalente na PPT (pulado)`); continue; }
    const cached = await readCache(setId);
    const fresh = cached && Date.now() - (cached.t || 0) < REFRESH_DAYS * 864e5;
    const restoreCache = (c) => { Object.assign(out, c.entries || {}); newCardsAll.push(...(c.newCards || [])); };
    // Fresco (e não é dry-run): usa o cache, não gasta crédito.
    if (fresh && !DRY) { restoreCache(cached); cacheHits++; continue; }
    // Sem orçamento OU sem tempo: mantém o que já tem em cache (não regride).
    if (creditsUsed >= BUDGET || (TIME_CAP_MS && Date.now() - startedAt > TIME_CAP_MS)) {
      if (cached) { restoreCache(cached); cacheHits++; }
      continue;
    }
    try {
      const r = await syncSet(setId, pptId);
      if (r) {
        Object.assign(out, r.entries); newCardsAll.push(...r.newCards); fetched++;
        if (!DRY) await writeFile(cacheFileOf(setId), JSON.stringify({ t: Date.now(), entries: r.entries, newCards: r.newCards }), "utf8");
      } else if (cached) restoreCache(cached);
    } catch (e) { console.log(`  ${setId}: erro ${e.message}`); if (cached) restoreCache(cached); }
  }

  // Importação de sets JP inteiros que a TCGdex ainda não tem (M5, MBG…). O
  // pptId vem do /sets (grátis); se a PPT ainda não listar o set, loga e segue
  // (é o "probe": no próximo run que a PPT tiver, importa). Cacheia por code.
  for (const entry of JP_IMPORT_SETS) {
    const code = typeof entry === "string" ? entry : entry.code;
    const explicitPpt = (entry && typeof entry === "object") ? entry.ppt : null;
    const ck = `jpimport-${code}`;
    const cached = await readCache(ck);
    if (cached && Date.now() - (cached.t || 0) < REFRESH_DAYS * 864e5 && !DRY) { newCardsAll.push(...(cached.newCards || [])); continue; }
    const pptId = explicitPpt != null ? explicitPpt : map.get(code.toUpperCase());
    if (pptId == null) {
      console.log(`  [JP import] ${code}: a PPT ainda não lista esse set (pulado)`);
      if (cached) newCardsAll.push(...(cached.newCards || []));
      continue;
    }
    if (creditsUsed >= BUDGET || (TIME_CAP_MS && Date.now() - startedAt > TIME_CAP_MS)) {
      if (cached) newCardsAll.push(...(cached.newCards || []));
      continue;
    }
    try {
      const nc = await importJpSet(code, pptId);
      newCardsAll.push(...nc); fetched++;
      if (!DRY) await writeFile(cacheFileOf(ck), JSON.stringify({ t: Date.now(), newCards: nc }), "utf8");
    } catch (e) { console.log(`  [JP import] ${code}: erro ${e.message}`); if (cached) newCardsAll.push(...(cached.newCards || [])); }
  }

  if (discDirty) await saveDiscovered(discovered);

  // Cartas avulsas curadas (Ancient Mew etc.) — barato (1 busca/carta), sempre roda.
  if (CURATED_SINGLES.length && creditsUsed < BUDGET) {
    try { await syncCuratedSingles(out, newCardsAll); } catch (e) { console.log(`  [curado] erro: ${e.message}`); }
  }

  // Dedupe das cartas novas por id (sets podem repetir entre runs/cache).
  const newById = new Map();
  for (const c of newCardsAll) if (c && c.id && !newById.has(c.id)) newById.set(c.id, c);
  const newCards = [...newById.values()];
  console.log(`\nSets: ${fetched} buscados, ${cacheHits} do cache | enriquecidas: ${Object.keys(out).length} | novas: ${newCards.length} | créditos: ${creditsUsed}/${BUDGET}`);
  if (DRY) {
    console.log("[dry-run] nada gravado. Amostra enriquecidas:", JSON.stringify(Object.fromEntries(Object.entries(out).slice(0, 3)), null, 1));
    console.log("[dry-run] Amostra novas:", JSON.stringify(newCards.slice(0, 3).map((c) => ({ id: c.id, name: c.name, num: c.number, set: c.set, img: !!c.image, price: c.price })), null, 1));
    return;
  }
  // Artefatos montados a partir de TODOS os sets em cache (cobertura completa).
  await writeFile(OUT, JSON.stringify(out), "utf8");
  await writeFile(NEWOUT, JSON.stringify(newCards), "utf8");
  console.log(`Gravado ${Object.keys(out).length} cartas (enriquecidas) e ${newCards.length} novas (add-on-miss).`);
}

// --- INSPECT: descobre qual id de set o /cards?fetchAllInSet aceita ---
async function inspect() {
  console.log("=== INSPECT sets ===");
  // pagina /sets e acha as entradas dos códigos pedidos (--set)
  const wanted = new Set(ONLY_SETS);
  const found = new Map();
  let offset = 0;
  for (let p = 0; p < 50 && found.size < wanted.size; p++) {
    const j = await ppt(`/sets?language=japanese&limit=100&offset=${offset}`);
    const arr = j.data || [];
    for (const s of arr) { const code = setCodeFromName(s.name); if (wanted.has(code) && !found.has(code)) found.set(code, s); }
    if (!(j.metadata && j.metadata.hasMore)) break;
    offset += arr.length || 100;
  }
  for (const [code, s] of found) {
    console.log(`\n[${code}] ids: id=${s.id} | tcgPlayerId=${s.tcgPlayerId} | tcgPlayerNumericId=${s.tcgPlayerNumericId}`);
    // candidatos (param, valor) — log verboso: contagem OU erro de cada um.
    const tries = [
      ["setId", s.tcgPlayerNumericId, "numericId"],
      ["setId", s.tcgPlayerId, "slug"]
    ];
    for (const [param, value, label] of tries) {
      if (value == null) continue;
      try {
        const r = await ppt(`/cards?${param}=${encodeURIComponent(value)}&language=japanese&fetchAllInSet=true&limit=3`);
        const n = (r.data || []).length;
        console.log(`  ${n ? "✓" : "·"} ${param}=${label}(${value}) +lang=ja +fetchAll -> ${n} cartas${n ? ` | ex: ${r.data[0].name} #${r.data[0].cardNumber} setId=${r.data[0].setId}` : ""}`);
      } catch (e) { console.log(`  ✗ ${param}=${label}(${value}) -> ${e.message}`); }
    }
  }
  console.log(`\n=== créditos: ${creditsUsed} ===`);
}

// --- PROBE: diagnóstico barato (mantido) ---
async function probe() {
  console.log("=== PPT PROBE ===\n");
  let ours = {};
  try { const r = await fetch(`${PROD}/data/pricing.generated.js`); const t = await r.text(); const m = t.match(/=\s*(\{[\s\S]*\});?\s*$/); ours = JSON.parse(m[1]); } catch { /* nada */ }
  try {
    const en = await ppt(`/cards?search=charizard&language=english&limit=20`);
    const base = (en.data || []).find((c) => /base set/i.test(c.setName || "") && String(c.cardNumber) === "4") || (en.data || [])[0];
    console.log("[1] EN:", base && `${base.name} | ${base.setName} #${base.cardNumber} | ${JSON.stringify(base.prices).slice(0, 200)}`);
    console.log("    nosso base1-4:", JSON.stringify(ours["base1-4"] || "(sem)"));
  } catch (e) { console.log("[1] EN falhou:", e.message); }
  try {
    const g = await ppt(`/cards?search=charizard&language=english&limit=3&includeEbay=true&days=90`);
    console.log("\n[2] GRADED:");
    (g.data || []).forEach((c) => console.log(`    ${c.name}: ${c.ebay && c.ebay.salesByGrade ? JSON.stringify(c.ebay.salesByGrade).slice(0, 300) : "(sem)"}`));
  } catch (e) { console.log("[2] graded falhou:", e.message); }
  try {
    const jp = await ppt(`/cards?search=charizard&language=japanese&limit=10`);
    console.log("\n[3] JOIN:");
    (jp.data || []).slice(0, 6).forEach((c) => console.log(`    ${c.name} | code=${setCodeFromName(c.setName)} | num=${numOf(c.cardNumber)} | img=${c.imageCdnUrl400 ? "sim" : "não"} | market=${c.prices && c.prices.market}`));
  } catch (e) { console.log("[3] JP falhou:", e.message); }
  console.log(`\n=== créditos: ${creditsUsed} ===`);
}

const entry = has("--inspect") ? inspect : PROBE ? probe : run;
entry().catch((e) => { console.error("falhou:", e.message); process.exit(1); });
