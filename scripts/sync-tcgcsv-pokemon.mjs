// Preços do TCGplayer POR IMPRESSÃO pro Pokémon (EN e JP) + cobertura JP, a
// partir da TCGCSV (tcgcsv.com) — o mesmo espelho diário e gratuito que já
// alimenta One Piece, FAB, Gundam, DBFW, Yu-Gi-Oh!, Digimon, Riftbound e Union
// Arena. Roda no BUILD, todo dia, sem token.
//
// Por que existe (14/09/2026 — "as cartas mais valiosas do Pikachu não batem
// com o TCG Collector"):
//   - a TCGdex embute UM preço por carta (a 1ª impressão com cotação) e pra
//     muita carta EN só traz o piso do Cardmarket; promos (Black Star) vêm sem
//     preço nenhum;
//   - o preço JP vinha só da PokemonPriceTracker, por crédito, 3x/semana, com
//     teto de tempo por run — sets antigos JP nunca chegavam a ter cotação, e
//     carta sem cotação não entra em ranking nenhum;
//   - a TCGdex em japonês tem ~118 sets: faltam eras inteiras (DP/BW/XY, S1–S4,
//     as promos S-P/SM-P/XY-P/BW-P). O TCGplayer tem a categoria "Pokemon
//     Japan" com esses sets, numerados e com preço.
//
// O que sai:
//   data/tcgcsv-prices.generated.json   { cardId: { u, v?: {Normal,Holo,Reverse,"1st Edition"}, img } }
//   data/tcgcsv-newcards.generated.json [ carta ] — promos EN que a TCGdex não
//       lista (mesmo padrão de numeração do set: guarda missAllowed), sets EN
//       INTEIROS pinados em `enImport` (ver abaixo) e sets JP INTEIROS que a
//       TCGdex não tem (setId = código do set, ids "<CODE>-<número impresso>-ja")
// O merge-catalogs aplica os dois (o preço da TCGCSV vence TCGdex e PPT; a PPT
// fica com o graded).
//
// Casamento set ↔ grupo do TCGplayer:
//   EN: nome normalizado (lib/tcgcsv-pokemon.mjs#setNameKeys) + pins em
//       data/tcgcsv-set-map.json (versionado, editável) — e TODO casamento é
//       CONFIRMADO pelo conteúdo (groupFits: metade dos números batem). Nome
//       igual sem os números baterem = outro set — aí ainda se tenta pelo NOME
//       das cartas (matchGroupByName), que é o que salva a Classic Collection,
//       numerada de um jeito aqui e de outro no TCGplayer. Confirmações ficam
//       em data/.cache/tcgcsv/set-map.json por 30 dias. Grupo EN moderno,
//       recente e sem set nosso entra SOZINHO como set novo (autoImportGroups)
//       — a rede que segura isso é o retire-imported-sets, que aposenta o id
//       provisório quando a TCGdex publicar o dela.
//   JP: código no nome do grupo ("SV4a: …" → SV4a; "S-P Promotional Cards" →
//       S-P) = nosso setId (a TCGdex usa os mesmos códigos). Código sem chunk
//       nosso = set que a TCGdex não tem → importado inteiro. Código repetido
//       em vários grupos sem chunk (decks "SV: …", "sA: …", pares BW1 Black/
//       White…) é AMBÍGUO e fica de fora até ganhar apelido por nome de grupo
//       em ja.alias — importar tudo com o mesmo setId fundia os decks.
//
// Uso:
//   node scripts/sync-tcgcsv-pokemon.mjs                 # tudo (EN + JP)
//   node scripts/sync-tcgcsv-pokemon.mjs --en | --ja     # só um idioma
//   node scripts/sync-tcgcsv-pokemon.mjs --set base1,swshp,SV4a   # só esses sets nossos
//   node scripts/sync-tcgcsv-pokemon.mjs --dry-run       # não grava artefato
//   node scripts/sync-tcgcsv-pokemon.mjs --no-import     # só preço, sem sets novos (EN e JP)
//   node scripts/sync-tcgcsv-pokemon.mjs --no-auto       # EN: sem a janela de lançamento automática
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { fetchRetry, mapLimit, sleep, normNum } from "./lib/sync-common.mjs";
import {
  indexGroupsByName, candidateGroups, matchGroup, groupFits, jpSetCode, jpSerieOfCode, jpAliasOf, jpAmbiguousCodes, synthesizeCard,
  enImportEntries, findImportGroup, importSetFields, importNumberFilter,
  matchGroupByName, nameFits, autoImportGroups, autoImportEntry, isModernEnGroup,
  extraNumbersOf, mirrorLangsOf, mirrorCard
} from "./lib/tcgcsv-pokemon.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const DRY = has("--dry-run");
const ONLY_EN = has("--en") && !has("--ja");
const ONLY_JA = has("--ja") && !has("--en");
const NO_IMPORT = has("--no-import");
const NO_AUTO = has("--no-auto") || has("--no-import");
const ONLY_SETS = new Set((val("--set") || "").split(",").map((s) => s.trim()).filter(Boolean));
const MAX_NEW_PER_SET = 60;      // teto defensivo do add-on-miss num set que JÁ existe
const MIN_AUTO_SINGLES = 20;     // abaixo disso o grupo EN novo não é set (pré-venda só com selado)
const MAX_AUTO_SETS = 2;         // teto por rodada: lançamento é evento raro, e se a régua errar o estrago é pequeno
const CONCURRENCY = 4;           // requisições paralelas ao espelho comunitário
const CONFIRM_TTL = 30 * 864e5;  // reconfirma um casamento EN por conteúdo a cada 30 dias

const ROOT = new URL("../", import.meta.url);
const DATA = new URL("data/", ROOT);
const CACHE = new URL("data/.cache/tcgcsv/", ROOT);
const API = "https://tcgcsv.com/tcgplayer";
const UA = { "User-Agent": "Sleevu (sleevu.app) catalog sync", Accept: "application/json" };

async function api(path) {
  const r = await fetchRetry(`${API}${path}`, { headers: UA });
  const j = await r.json();
  return (j && Array.isArray(j.results)) ? j.results : [];
}
async function readJson(url, fallback) { try { return JSON.parse(await readFile(url, "utf8")); } catch { return fallback; } }
async function chunkOf(lang, setId) {
  return readJson(new URL(`sets/${lang}/${setId}.json`, DATA), null);
}
async function ourSets(lang) {
  const dir = new URL(`sets/${lang}/`, DATA);
  let files = [];
  try { files = (await readdir(dir)).filter((f) => f.endsWith(".json")); } catch { return []; }
  const out = [];
  for (const f of files) {
    const cards = await readJson(new URL(f, dir), []);
    if (!Array.isArray(cards) || !cards.length) continue;
    out.push({ id: f.replace(/\.json$/, ""), name: cards[0].set || "", cards });
  }
  return out;
}
// dexId por nome de espécie (data/pokemon-names.js), pra carta sintetizada
// entrar na página do Pokémon e na Pokédex.
async function revNames() {
  const t = await readFile(new URL("pokemon-names.js", DATA), "utf8").catch(() => "");
  const m = t.match(/=\s*(\{[\s\S]*\});?\s*$/);
  const map = m ? JSON.parse(m[1]) : {};
  const rev = {};
  for (const [dex, name] of Object.entries(map)) rev[String(name).toLowerCase()] = Number(dex);
  return rev;
}
// Ids já publicados de um set (chunk versionado), por número: o pino que
// impede o id de uma carta sintetizada de mudar entre builds.
function pinnedIds(chunk, setId) {
  const map = new Map();
  for (const c of chunk || []) {
    if (!c || !c.id) continue;
    const local = String(c.id).replace(`${setId}-`, "").replace(/-(pt|ja|zh-cn|zh-tw|zh)$/, "");
    const k = normNum(local);
    if (k && !map.has(k)) map.set(k, c.id);
  }
  return map;
}

const out = {};           // cardId -> { u, v?, img }
const newCards = [];      // cartas sintetizadas
const rev = await revNames();
await mkdir(CACHE, { recursive: true });
// O artefato de cartas novas da rodada ANTERIOR sai antes de qualquer rede: ele
// vem do cache de build, e se esta rodada morrer no meio (o deploy segue com
// "|| echo") o merge o injetaria de novo — foi por essa porta que um set
// fundido, já apagado do repo, poderia voltar. Sem o artefato o merge só perde
// as cartas novas DESTA rodada; as das anteriores já estão nos chunks versionados.
if (!DRY) await writeFile(new URL("tcgcsv-newcards.generated.json", DATA), "[]", "utf8").catch(() => {});

// ── Categorias ───────────────────────────────────────────────────────────────
// Pelo NOME, não por id fixo: o id do "Pokemon Japan" é recente e a lista é
// pública — e se o nome mudar o log diz que não achou, em vez de precificar
// a categoria errada em silêncio.
const cats = await api("/categories");
const catEN = cats.find((c) => /^pok[eé]mon$/i.test(String(c.name || "").trim()));
const catJA = cats.find((c) => /^pok[eé]mon\s+japan/i.test(String(c.name || "").trim()));
console.log(`TCGCSV: categoria Pokémon EN = ${catEN ? catEN.categoryId : "NÃO ACHADA"} · Pokémon Japan = ${catJA ? catJA.categoryId : "NÃO ACHADA"}`);

const stats = { enSets: 0, enPriced: 0, enNew: 0, enImported: 0, jaSets: 0, jaPriced: 0, jaNew: 0, jaImported: 0, unmatchedEN: [], unmatchedJA: [], candidatesEN: [] };

// ── EN: preço por impressão + promos que a TCGdex não lista ──────────────────
if (catEN && !ONLY_JA) {
  const groups = await api(`/${catEN.categoryId}/groups`);
  const byName = indexGroupsByName(groups);
  const byId = new Map(groups.map((g) => [g.groupId, g]));
  const pins = await readJson(new URL("tcgcsv-set-map.json", DATA), {});
  const confirmed = await readJson(new URL("set-map.json", CACHE), {}); // { "en/<setId>": { g: [ids], t } }
  const allOurSets = await ourSets("en");
  const sets = allOurSets.filter((s) => !ONLY_SETS.size || ONLY_SETS.has(s.id));
  const importBySet = new Map(enImportEntries(pins).map((e) => [e.setId, e]));
  const matchedGroupIds = new Set(); // grupos já casados com um set nosso
  console.log(`EN: ${groups.length} grupos no TCGplayer · ${sets.length} sets nossos · ${importBySet.size} pin(s) de import`);

  await mapLimit(sets, CONCURRENCY, async (set) => {
    // Candidatos: pin manual > confirmação em cache (válida) > nome.
    const pinned = pins.en && pins.en[set.id];
    const cached = confirmed[`en/${set.id}`];
    let candidates;
    // O pin aceita groupId (número) ou o NOME do grupo. O nome entrou porque o
    // groupId só se descobre com a API na mão, e há set cujo NOME de set também
    // diverge — o "30th Classic Collection" da TCGdex é "ME: 30th Celebration
    // Classic Collection" no TCGplayer, então o casamento por nome de set nunca
    // acha o grupo e o set ficava sem preço (19/09/2026).
    if (pinned) candidates = [].concat(pinned)
      .map((x) => (typeof x === "number" ? byId.get(x) : findImportGroup({ group: x }, groups)))
      .filter(Boolean);
    else if (cached && Date.now() - (cached.t || 0) < CONFIRM_TTL) candidates = cached.g.map((id) => byId.get(id)).filter(Boolean);
    else candidates = candidateGroups(set, byName);
    if (!candidates.length) { stats.unmatchedEN.push(`${set.id} "${set.name}"`); return; }

    const entries = {};
    const misses = new Map(); // key -> miss
    const usedGroups = [];
    let sibSetId = set.id;
    for (const g of candidates) {
      let products, prices;
      try {
        products = await api(`/${catEN.categoryId}/${g.groupId}/products`);
        prices = await api(`/${catEN.categoryId}/${g.groupId}/prices`);
      } catch (e) { console.warn(`  ${set.id}: grupo ${g.groupId} "${g.name}" erro ${e.message}`); continue; }
      await sleep(80);
      let m = matchGroup(set.cards, products, prices, { setId: set.id, lang: "en", extraNumbers: extraNumbersOf(pins, set.id) });
      // Número que não bate pode ser OUTRO set — ou a Classic Collection, que a
      // TCGdex numera em sequência e o TCGplayer pelo número original da carta
      // reimpressa. Antes de desistir do grupo, tenta casar pelo NOME
      // (matchGroupByName: só nome inequívoco, e sem sintetizar carta nenhuma —
      // o número de lá não serve de id aqui). Foi o que devolveu preço e imagem
      // ao 30th-c e ao cel25cc, que estavam com o set inteiro em branco.
      if (!groupFits(m)) {
        const porNome = matchGroupByName(set.cards, products, prices);
        if (nameFits(porNome)) {
          console.log(`  ${set.id}: grupo ${g.groupId} "${g.name}" casou pelo NOME (${porNome.matched}/${porNome.ourCount}; por número era ${m.matched}/${m.ourCount})`);
          m = { ...m, entries: porNome.entries, misses: [], matched: porNome.matched, ourCount: porNome.ourCount };
        }
      }
      // Confirmação pelo conteúdo: nome igual mas números que não batem = outro
      // set (o pin manual é a exceção — quem pinou conferiu).
      if (!pinned && !groupFits(m)) { console.log(`  ${set.id}: grupo ${g.groupId} "${g.name}" não confere (${m.matched}/${m.ourCount} números) — ignorado`); continue; }
      usedGroups.push(g.groupId); matchedGroupIds.add(g.groupId);
      Object.assign(entries, m.entries);
      // Set importado por pin com filtro de número (grupo dividido em dois
      // sets): o add-on-miss respeita o mesmo filtro, senão as cartas do
      // set-irmão voltariam por aqui no dia seguinte.
      const keep = importNumberFilter(importBySet.get(set.id));
      for (const miss of m.misses) if (keep(miss.product) && !misses.has(miss.key)) misses.set(miss.key, { ...miss, group: g });
    }
    if (!usedGroups.length) { stats.unmatchedEN.push(`${set.id} "${set.name}" (nome bate, números não)`); return; }
    if (!pinned) confirmed[`en/${set.id}`] = { g: usedGroups, t: Date.now() };
    Object.assign(out, entries);
    stats.enSets++; stats.enPriced += Object.keys(entries).length;

    // Add-on-miss (guarda de numeração já aplicada no matchGroup), ordem
    // estável por número e id pinado no chunk publicado.
    const pinsById = pinnedIds(set.cards, sibSetId);
    const sib = set.cards[0];
    // Número fora do padrão pinado em extraNumbers (Mew RGB) também nasce nos
    // idiomas do `mirror`, com os campos de set do chunk daquele idioma.
    const extra = extraNumbersOf(pins, set.id);
    const mirrors = [];
    for (const lang of mirrorLangsOf(pins, set.id)) {
      const chunk = await chunkOf(lang, set.id);
      if (Array.isArray(chunk) && chunk.length) mirrors.push({ lang, sib: chunk[0] });
      else console.log(`  ${set.id}: espelho ${lang} sem chunk do set nesse idioma — pulado`);
    }
    let added = 0;
    for (const [key, miss] of [...misses.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (added >= MAX_NEW_PER_SET) break;
      const card = synthesizeCard({ product: miss.product, price: miss.price, img: miss.img, setId: set.id, lang: "en", sib, group: miss.group, pinned: pinsById.get(key), revNames: rev, variants: miss.variants });
      if (!card.name) continue;
      newCards.push(card); added++;
      if (extra && extra.test(card.number)) for (const mr of mirrors) newCards.push(mirrorCard(card, mr.lang, mr.sib));
    }
    stats.enNew += added;
    console.log(`  ${set.id} "${set.name}": ${Object.keys(entries).length} preços (grupos ${usedGroups.join("+")})${added ? `, ${added} cartas novas` : ""}`);
  });
  if (!DRY) await writeFile(new URL("set-map.json", CACHE), JSON.stringify(confirmed), "utf8");

  // ── EN: sets INTEIROS que a TCGdex ainda não tem (pins `enImport`) ──────────
  const ourIds = new Set(allOurSets.map((s) => s.id));
  // Sets que o import criou e a TCGdex depois publicou com OUTRO setId: o chunk
  // nosso foi APOSENTADO (retire-imported-sets.mjs) e o pin não pode ressuscitá-lo
  // — sem esta lista o build seguinte veria "sem chunk" e importaria de novo, e a
  // tela de Sets voltaria a ter duas entradas do mesmo set (18/09/2026).
  const merges = await readJson(new URL("card-id-merges.json", DATA), {});
  const aposentados = new Set((merges.sets || []).map((r) => r && r.from).filter(Boolean));
  for (const entry of importBySet.values()) {
    if (ONLY_SETS.size && !ONLY_SETS.has(entry.setId)) continue;
    if (aposentados.has(entry.setId)) { console.log("  EN import " + entry.setId + ": aposentado (a TCGdex publicou o set com outro id) — pin ignorado"); continue; }
    // Chunk já existe (TCGdex publicou, ou um build anterior importou e o
    // snapshot versionou): o casamento normal acima já cuidou dele.
    if (ourIds.has(entry.setId)) continue;
    const g = findImportGroup(entry, groups);
    if (!g) { console.log(`  EN import ${entry.setId}: grupo "${entry.group}" ainda não existe no TCGplayer — nada a importar`); continue; }
    if (matchedGroupIds.has(g.groupId)) { console.warn(`  EN import ${entry.setId}: grupo ${g.groupId} "${g.name}" já casou com outro set nosso — pin ignorado`); continue; }
    let products, prices;
    try {
      products = await api(`/${catEN.categoryId}/${g.groupId}/products`);
      prices = await api(`/${catEN.categoryId}/${g.groupId}/prices`);
    } catch (e) { console.warn(`  EN import ${entry.setId}: grupo ${g.groupId} erro ${e.message}`); continue; }
    await sleep(80);
    const m = matchGroup([], products, prices, { setId: entry.setId, lang: "en" });
    const keep = importNumberFilter(entry);
    const misses = m.misses.filter((miss) => keep(miss.product));
    // Na pré-venda o grupo só tem selados (ETB, booster bundle…): os singles
    // aparecem no lançamento. Sem número, sem carta — tenta de novo amanhã.
    if (!misses.length) { console.log(`  EN import ${entry.setId}: grupo ${g.groupId} "${g.name}" ainda sem singles (${products.length} produtos, só selados) — nada a importar`); continue; }
    const sib = importSetFields(entry, g);
    let added = 0;
    for (const miss of misses.sort((a, b) => a.key.localeCompare(b.key))) {
      const card = synthesizeCard({ product: miss.product, price: miss.price, img: miss.img, setId: entry.setId, lang: "en", sib, group: g, pinned: null, revNames: rev, variants: miss.variants, keepZeros: true, idExtra: miss.idExtra });
      if (!card.name) continue;
      newCards.push(card); added++;
    }
    stats.enImported++; stats.enNew += added;
    console.log(`  EN import ${entry.setId} "${sib.set}": set importado inteiro do grupo ${g.groupId} "${g.name}" (${added} cartas)`);
  }

  // ── Janela de lançamento: set EN novo entra SOZINHO ───────────────────────
  // Grupo EN moderno, publicado na janela e sem set nosso vira set aqui mesmo,
  // sem esperar pin à mão (ver autoImportGroups). O que segura a mão é a
  // aposentadoria automática: se a TCGdex publicar o mesmo set com outro id, o
  // retire-imported-sets apaga o nosso e migra a conta de quem marcou. Sem essa
  // rede, importar sem curadoria seria irresponsável.
  const pinnedGroups = new Set([...importBySet.values()].map((e) => findImportGroup(e, groups)).filter(Boolean).map((g) => g.groupId));
  const usados = new Set([...matchedGroupIds, ...pinnedGroups]);
  const elegiveis = NO_AUTO ? [] : autoImportGroups(groups, { usedIds: usados, existingIds: ourIds });
  const autoIds = new Set(elegiveis.map((e) => e.group.groupId));
  // Teto por rodada. Set novo em inglês é evento de algumas vezes por ano: se a
  // régua um dia deixar passar uma penca de grupos, entram 2 e o log grita, em
  // vez de o site ganhar quinze sets de uma vez.
  if (elegiveis.length > MAX_AUTO_SETS) {
    console.warn(`  EN auto: ${elegiveis.length} grupos elegíveis de uma vez (teto ${MAX_AUTO_SETS}) — CONFERIR a régua: ${elegiveis.map((e) => `${e.group.groupId} "${e.group.name}"`).join(", ")}`);
    elegiveis.length = MAX_AUTO_SETS;
  }
  for (const { group: g, setId } of elegiveis) {
    if (ONLY_SETS.size && !ONLY_SETS.has(setId)) continue;
    if (aposentados.has(setId)) continue; // já entrou e já foi aposentado
    let products, prices;
    try {
      products = await api(`/${catEN.categoryId}/${g.groupId}/products`);
      prices = await api(`/${catEN.categoryId}/${g.groupId}/prices`);
    } catch (e) { console.warn(`  EN auto ${setId}: grupo ${g.groupId} erro ${e.message}`); continue; }
    await sleep(80);
    const m = matchGroup([], products, prices, { setId, lang: "en" });
    // Grupo só com selado (pré-venda) ou com meia dúzia de singles não é set:
    // na pré-venda o grupo existe antes de o TCGplayer listar as cartas.
    if (m.misses.length < MIN_AUTO_SINGLES) {
      console.log(`  EN auto ${setId}: grupo ${g.groupId} "${g.name}" com ${m.misses.length} single(s) de ${products.length} produtos — abaixo de ${MIN_AUTO_SINGLES}, fica pra amanhã`);
      continue;
    }
    const entry = autoImportEntry(g, setId);
    const sib = importSetFields(entry, g);
    let added = 0;
    for (const miss of m.misses.sort((a, b) => a.key.localeCompare(b.key))) {
      const card = synthesizeCard({ product: miss.product, price: miss.price, img: miss.img, setId, lang: "en", sib, group: g, pinned: null, revNames: rev, variants: miss.variants, keepZeros: true, idExtra: miss.idExtra });
      if (!card.name) continue;
      newCards.push(card); added++;
    }
    stats.enImported++; stats.enNew += added;
    console.log(`  EN auto ${setId} "${sib.set}": set NOVO importado sozinho do grupo ${g.groupId} "${g.name}" (${added} cartas) — a TCGdex ainda não publicou`);
  }

  // O que não entrou continua saindo no log: é assim que se descobre um set que
  // a régua automática não pegou (nome fora do padrão de era, fora da janela).
  for (const g of groups) {
    if (usados.has(g.groupId) || autoIds.has(g.groupId)) continue;
    if (isModernEnGroup(g.name)) stats.candidatesEN.push(`${g.groupId} "${g.name}" (${String(g.publishedOn || "").slice(0, 10)})`);
  }
}

// ── JP: preço por impressão nos sets que temos + import dos que faltam ───────
if (catJA && !ONLY_EN) {
  const groups = await api(`/${catJA.categoryId}/groups`);
  const sets = await ourSets("ja");
  const byCode = new Map(sets.map((s) => [s.id.toUpperCase(), s]));
  const pins = await readJson(new URL("tcgcsv-set-map.json", DATA), {});
  // Apelidos: NOME exato do grupo ou código do TCGplayer -> nosso setId, quando
  // diferem (a TCGdex escreve "SV-P" e "SVK"; o TCGplayer, "SVP" e "SV: Stellar
  // Miracle Deck Build Box"). Ficam em data/tcgcsv-set-map.json (ja.alias).
  const alias = (pins.ja && pins.ja.alias) || {};
  const skip = new Set(((pins.ja && pins.ja.skip) || []).map((s) => String(s).toUpperCase()));
  // Código repetido em vários grupos SEM chunk nosso = ambíguo: não dá pra
  // importar sem fundir decks diferentes num set só (ver jpAmbiguousCodes).
  const ambiguos = jpAmbiguousCodes(groups, { codeOf: (g) => jpSetCode(g.name), hasChunk: (c) => byCode.has(c.toUpperCase()), alias });
  console.log(`JP: ${groups.length} grupos no TCGplayer Japan · ${sets.length} sets nossos · ${ambiguos.size} código(s) ambíguo(s)`);
  for (const [code, list] of ambiguos) {
    stats.unmatchedJA.push(`${code}: ${list.length} grupos com o mesmo código, sem chunk — pular até pinar por nome em ja.alias: ${list.map((g) => `${g.groupId} "${g.name}"`).join(" · ")}`);
  }

  await mapLimit(groups, CONCURRENCY, async (g) => {
    const code = jpSetCode(g.name);
    if (!code) { stats.unmatchedJA.push(`${g.groupId} "${g.name}" (sem código)`); return; }
    const key = code.toUpperCase();
    // Apelido por nome vem ANTES da ambiguidade: "SV: Ceruledge ex…" tem
    // apelido (SVLS) e casa mesmo com outros 17 grupos "SV: …" no ar (o 2º
    // build de 16/09 pulou os três apelidados por conferir a ordem errada).
    const apelido = jpAliasOf(g, code, alias);
    if (skip.has(key) || (!apelido && ambiguos.has(code))) return;
    const ourId = apelido || (byCode.has(key) ? byCode.get(key).id : null);
    if (ONLY_SETS.size && !ONLY_SETS.has(ourId || code)) return;
    let products, prices;
    try {
      products = await api(`/${catJA.categoryId}/${g.groupId}/products`);
      prices = await api(`/${catJA.categoryId}/${g.groupId}/prices`);
    } catch (e) { console.warn(`  JP ${code}: grupo ${g.groupId} erro ${e.message}`); return; }
    await sleep(80);

    if (ourId) {
      const set = sets.find((s) => s.id === ourId);
      const m = matchGroup(set.cards, products, prices, { setId: set.id, lang: "ja" });
      if (!groupFits(m)) { console.log(`  JP ${code}: grupo ${g.groupId} "${g.name}" não confere com ${set.id} (${m.matched}/${m.ourCount}) — ignorado`); return; }
      Object.assign(out, m.entries);
      stats.jaSets++; stats.jaPriced += Object.keys(m.entries).length;
      const pinsById = pinnedIds(set.cards, set.id);
      let added = 0;
      for (const miss of m.misses.sort((a, b) => a.key.localeCompare(b.key))) {
        if (added >= MAX_NEW_PER_SET) break;
        newCards.push(synthesizeCard({ product: miss.product, price: miss.price, img: miss.img, setId: set.id, lang: "ja", sib: set.cards[0], group: g, pinned: pinsById.get(miss.key), revNames: rev, variants: miss.variants }));
        added++;
      }
      stats.jaNew += added;
      console.log(`  JP ${set.id} "${g.name}": ${Object.keys(m.entries).length} preços${added ? `, ${added} cartas novas` : ""}`);
      return;
    }

    if (NO_IMPORT) { stats.unmatchedJA.push(`${code} "${g.name}" (sem chunk; --no-import)`); return; }
    // Set que a TCGdex não tem: importa INTEIRO. setId = código (mesma família
    // dos ids da TCGdex em ja), ids pinados pelo chunk que um build anterior
    // já tenha escrito em data/sets/ja/<code>.json.
    const m = matchGroup([], products, prices, { setId: code, lang: "ja" });
    if (!m.misses.length) return; // grupo só de selados
    const prev = await chunkOf("ja", code);
    const pinsById = pinnedIds(prev, code);
    let added = 0;
    // Série pelo código (M6a → MEGA), senão o set nasce sem série e a tela de
    // Sets o joga em "Outros". O id leva o número como impresso ("M6a-001-ja"):
    // é a convenção da TCGdex em ja (M-P-001-ja, SV1a-001-ja), e quando ela
    // publicar o set as cartas casam em vez de duplicar. Nenhum set JP inteiro
    // chegou a ser publicado sem zeros (o import JP entrou em 14/09/2026 e o
    // deploy diário não completou desde então), então não há id a preservar.
    const sib = jpSerieOfCode(code);
    for (const miss of m.misses.sort((a, b) => a.key.localeCompare(b.key))) {
      newCards.push(synthesizeCard({ product: miss.product, price: miss.price, img: miss.img, setId: code, lang: "ja", sib, group: g, pinned: pinsById.get(miss.key), revNames: rev, variants: miss.variants, keepZeros: true, idExtra: miss.idExtra }));
      added++;
    }
    stats.jaImported++; stats.jaNew += added;
    console.log(`  JP ${code} "${g.name}": set importado inteiro (${added} cartas)`);
  });
}

console.log(`\nTCGCSV Pokémon: EN ${stats.enSets} sets · ${stats.enPriced} preços · ${stats.enImported} sets importados · ${stats.enNew} cartas novas | JP ${stats.jaSets} sets · ${stats.jaPriced} preços · ${stats.jaImported} sets importados · ${stats.jaNew} cartas novas`);
if (stats.unmatchedEN.length) console.log(`EN sem grupo confirmado (ficam com o preço da TCGdex): ${stats.unmatchedEN.length}\n  ${stats.unmatchedEN.slice(0, 40).join("\n  ")}${stats.unmatchedEN.length > 40 ? "\n  …" : ""}`);
if (stats.candidatesEN.length) console.log(`EN grupos modernos sem set nosso nem pin (candidatos a enImport em data/tcgcsv-set-map.json): ${stats.candidatesEN.length}\n  ${stats.candidatesEN.slice(0, 40).join("\n  ")}${stats.candidatesEN.length > 40 ? "\n  …" : ""}`);
if (stats.unmatchedJA.length) console.log(`JP grupos ignorados: ${stats.unmatchedJA.length}\n  ${stats.unmatchedJA.slice(0, 40).join("\n  ")}${stats.unmatchedJA.length > 40 ? "\n  …" : ""}`);

if (DRY) { console.log("[dry-run] nada gravado."); process.exit(0); }
if (!catEN && !catJA) { console.warn("Nenhuma categoria Pokémon na TCGCSV — artefatos não regravados (o merge segue com o que houver)."); process.exit(0); }
await writeFile(new URL("tcgcsv-prices.generated.json", DATA), JSON.stringify(out), "utf8");
await writeFile(new URL("tcgcsv-newcards.generated.json", DATA), JSON.stringify(newCards), "utf8");
console.log(`Gravados data/tcgcsv-prices.generated.json (${Object.keys(out).length}) e data/tcgcsv-newcards.generated.json (${newCards.length}).`);
