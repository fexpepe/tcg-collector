// Mescla os catálogos por idioma (data/sets/<lang>/*.json, gerados pelo
// sync-tcgdex.mjs) num catálogo unificado para o modo manifest:
//   - canoniza pokemonName via dexId usando o catálogo en (リザードン -> Charizard),
//     reescrevendo os chunks para a página de detalhe filtrar certo;
//   - gera data/indexes.generated.js e data/manifest.generated.js mesclados.
// Uso: node scripts/merge-catalogs.mjs en ja zh-tw pt
import { readdir, readFile, writeFile } from "node:fs/promises";
import { writeSplitIndexes, setManifestMeta } from "./lib/sync-common.mjs";
import { chunkNumberPrefixes, missAllowed, applyVariantPrices } from "./lib/pricing.mjs";
import { isRetiredChunk, resolveMergedId, stampIdMerges } from "./lib/set-supersede.mjs";
import { extraNumbersOf } from "./lib/tcgcsv-pokemon.mjs";
import { fillFromEn, learnLabels, findTwins } from "./lib/provisional-ids.mjs";

const langs = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
if (!langs.length) {
  console.error("Uso: node scripts/merge-catalogs.mjs <idioma> [idioma...]");
  process.exit(1);
}

const dataDir = new URL("../data/", import.meta.url);
const chunksByLang = {};

for (const lang of langs) {
  const dir = new URL(`sets/${lang}/`, dataDir);
  let files = [];
  try {
    files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
  } catch {
    console.warn(`Aviso: sem chunks para "${lang}" (rode o sync antes); pulando.`);
    continue;
  }
  chunksByLang[lang] = [];
  for (const file of files) {
    const cards = JSON.parse(await readFile(new URL(file, dir), "utf8"));
    if (!cards.length) continue;
    chunksByLang[lang].push({ file, setId: file.replace(/\.json$/, ""), cards });
  }
}

// Nome canônico de espécie por dexId. Base: PokéAPI (todos os 1025, sempre
// latino); o catálogo en só entra como fallback para dexIds fora da lista —
// nomes de carta ("M Absol", "Arcanine BREAK", "Iono's Bellibolt") não podem
// sobrescrever o nome da espécie.
const speciesByDex = new Map();
try {
  const raw = await readFile(new URL("pokemon-names.js", dataDir), "utf8");
  const map = JSON.parse(raw.replace(/^window\.TCG_POKEMON_NAMES = /, "").replace(/;\s*$/, ""));
  for (const [dexId, name] of Object.entries(map)) speciesByDex.set(Number(dexId), name);
} catch {
  console.warn("Aviso: data/pokemon-names.js ausente; rode sync-pokemon-names.mjs.");
}
for (const chunk of chunksByLang.en || []) {
  for (const card of chunk.cards) {
    const dexId = speciesDexId(card);
    if (dexId && card.pokemonName && !speciesByDex.has(dexId)) speciesByDex.set(dexId, card.pokemonName);
  }
}

// dexId FALTANTE: a TCGdex às vezes não preenche a cauda de secret rares dos
// sets JP/CN (ex.: SV8a 188–237 — a Umbreon ex SAR vinha sem dexId). Sem dexId a
// carta não canoniza o pokemonName, então fica FORA da página da espécie, da
// Pokédex e da busca por nome EN. Aprende nomeLocal→dex com as cartas que TÊM
// dexId (qualquer idioma: "ブラッキー"→197) e preenche as órfãs pelo nome.
// Nome ambíguo (2 dex diferentes) é descartado — preencher errado é pior.
const dexByLocalName = new Map();
for (const lang of langs) {
  for (const chunk of chunksByLang[lang] || []) {
    for (const card of chunk.cards) {
      const dex = speciesDexId(card);
      if (!dex || !card.pokemonName) continue;
      const cur = dexByLocalName.get(card.pokemonName);
      if (cur == null) dexByLocalName.set(card.pokemonName, dex);
      else if (cur !== dex) dexByLocalName.set(card.pokemonName, -1); // ambíguo
    }
  }
}
let dexBackfilled = 0;

// Número nacional da espécie; dexIds fracionários de forma (Rayquaza ☆ = 384.1)
// pertencem à espécie da parte inteira.
function speciesDexId(card) {
  return Math.trunc(Number(card.dexId)) || 0;
}

const allCards = [];
const manifestSets = [];
// Referência de preço por cardId (TCGdex), extraída para um artefato separado e
// removida dos chunks (mantém os chunks leves). { id: { u: USD, e: EUR } }.
const pricing = {};
// Preços/imagens da PPT (JP), se o sync rodou (data/ppt-prices.generated.json):
// { cardId: { u: USD, img: url, g?: {p9,p10} } }. Preenche imagem faltante no
// chunk e dá um preço JP melhor que o do Cardmarket da TCGdex. No-op sem o arquivo.
let pptData = {};
try { pptData = JSON.parse(await readFile(new URL("ppt-prices.generated.json", dataDir), "utf8")); } catch { /* sem PPT */ }

// Imagem EN por cardId (preenchida no loop), pra usar de fallback nas cartas
// localizadas sem imagem própria (ex.: MEP PT sem arte na TCGdex).
const enImageById = new Map();

// Cartas que a PPT tem e a TCGdex NÃO (add-on-miss): secret rares/promos que a
// fonte do catálogo não traz. Injetamos no chunk do set+idioma certo (dedupe por
// id), e o resto do merge (preço/índices) trata como qualquer carta.
// { "<lang>/<setId>": [card, ...] }
let pptNewCards = [];
try { pptNewCards = JSON.parse(await readFile(new URL("ppt-newcards.generated.json", dataDir), "utf8")); } catch { /* sem novas */ }
// Idem da TCGCSV (sync-tcgcsv-pokemon.mjs): promos EN que a TCGdex não lista e
// sets JP inteiros que ela não tem (S-P, SM-P, XY-P…). Mesmo formato, mesma
// injeção; a TCGCSV vem PRIMEIRO na lista porque é a fonte diária e sem crédito,
// e o dedupe por id deixa a PPT só com o que sobrar.
// Pins do casamento com o TCGplayer: daqui só sai o `extraNumbers` (guarda).
let setMapPins = {};
try { setMapPins = JSON.parse(await readFile(new URL("tcgcsv-set-map.json", dataDir), "utf8")); } catch { /* sem pins */ }
let csvNewCards = [];
try { csvNewCards = JSON.parse(await readFile(new URL("tcgcsv-newcards.generated.json", dataDir), "utf8")); } catch { /* sem TCGCSV */ }
const newBySet = {};
// `prov` carimba de onde veio o id (ver lib/provisional-ids.mjs): toda carta
// injetada aqui tem id escolhido por NÓS, não pela TCGdex.
const origemNova = [
  ...(Array.isArray(csvNewCards) ? csvNewCards : []).map((c) => [c, "tcgcsv"]),
  ...(Array.isArray(pptNewCards) ? pptNewCards : []).map((c) => [c, "ppt"])
];
for (const [c, prov] of origemNova) {
  if (!c || !c.id || !c.language || !c.setId) continue;
  (newBySet[`${c.language}/${c.setId}`] = newBySet[`${c.language}/${c.setId}`] || []).push({ ...c, prov });
}
// Arte que só o chunk APOSENTADO tinha (data/card-id-merges.json, escrito pelo
// retire-imported-sets.mjs): { <cardId novo>: url }. A TCGdex publica o set
// antes da arte de parte das cartas — o "30th Classic Collection" chegou com as
// 30 sem imagem, e o chunk importado que saiu tinha a do TCGplayer pra todas.
// Sem isto a aposentadoria do duplicado deixaria o set em branco. Carimba em
// TODO build (o sync-tcgdex reescreve o chunk a cada rodada) e se apaga sozinho
// quando a TCGdex publicar a arte, porque só preenche imagem VAZIA.
let idMerges = null;
try { idMerges = JSON.parse(await readFile(new URL("card-id-merges.json", dataDir), "utf8")) || null; } catch { /* nenhum set aposentado */ }
const mergeImgs = (idMerges && idMerges.images) || {};
// Id provisório que JÁ tem de-para gravado (a oficial chegou com outro id): não
// renasce — senão a duplicata que o de-para desfez voltaria no build seguinte.
const jaMigrado = (id) => !!(idMerges && resolveMergedId(id, idMerges));
// Preços por impressão da TCGCSV (TCGplayer, diário): { cardId: { u, v?, img? } }.
let csvData = {};
try { csvData = JSON.parse(await readFile(new URL("tcgcsv-prices.generated.json", dataDir), "utf8")); } catch { /* sem TCGCSV */ }
let injectedNew = 0;
let rejectedNew = 0;
// Sets que TÊM chunk (existem na TCGdex): marcados no loop. O que sobrar em
// newBySet sem chunk = set só-PPT (M5/MBG…) ou só-TCGCSV (promos JP S-P,
// SM-P…), tratado depois do loop.
const consumedSets = new Set();

// ── Edição PT completada pela inglesa ─────────────────────────────────────
// A TCGdex publica a edição portuguesa aos pedaços: o "Celebração de 30 Anos"
// tinha 2 cartas PT contra 158 EN (24/09/2026) e a pessoa não conseguia marcar
// as outras 156 na bandeira certa. O id PT é SEMPRE o da EN + "-pt" (conferido
// nas 14.339 cartas PT do catálogo), então dá pra criar a carta que falta com o
// id que a oficial vai ter: nome e arte ficam em inglês até a TCGdex publicar,
// e aí a oficial ocupa o mesmo id sem mexer na coleção de ninguém. Só PT (os
// ids JA/ZH não seguem a EN), só set que JÁ tem edição PT e nunca promo — ver
// fillFromEn. Roda ANTES do laço pra a carta passar por canonização, índices e
// manifest como qualquer outra.
const FILL_LANGS = ["pt"].filter((l) => langs.includes(l) && langs.includes("en"));
let filledFromEn = 0;
if (FILL_LANGS.length) {
  const enBySet = new Map((chunksByLang.en || []).map((c) => [c.setId, c]));
  const pares = [];
  for (const lang of FILL_LANGS) {
    for (const chunk of chunksByLang[lang] || []) {
      const en = enBySet.get(chunk.setId);
      if (!en) continue;
      const enById = new Map(en.cards.map((c) => [c.id, c]));
      for (const c of chunk.cards) {
        const par = !c.prov && enById.get(String(c.id).slice(0, -(lang.length + 1)));
        if (par) pares.push([par, c]);
      }
    }
  }
  const labels = learnLabels(pares);
  for (const lang of FILL_LANGS) {
    for (const chunk of chunksByLang[lang] || []) {
      const en = enBySet.get(chunk.setId);
      if (!en) continue;
      // Molde só de carta da TCGdex: a injetada nesta rodada (TCGCSV/PPT) ainda
      // é aposta de id, e aposta em cima de aposta não entra.
      const skipEn = new Set((newBySet[`en/${chunk.setId}`] || []).map((c) => c.id));
      const skipIds = new Set(en.cards.map((c) => `${c.id}-${lang}`).filter(jaMigrado));
      const r = fillFromEn({ enCards: en.cards, locCards: chunk.cards, lang, skipIds, skipEn, labels });
      if (r.added || r.dropped) { chunk.cards = r.cards; chunk.dirty = true; }
      filledFromEn += r.added;
    }
  }
  if (filledFromEn) console.log(`Cartas ${FILL_LANGS.join("/").toUpperCase()} completadas pela edição inglesa (id provisório, prov:"en"): ${filledFromEn}`);
}

// Pares provisória -> oficial achados nesta rodada (ver findTwins): os únicos
// viram de-para automático; os ambíguos, só aviso. Vão pro relatório que o
// deploy transforma em issue (scripts/report-provisional-ids.mjs).
const twinsApplied = [];
const twinsPending = [];

// Logo de Black Star Promo: todo set "* Black Star Promos" (SVP, MEP, SWSHP,
// XYP… qualquer era) usa o MESMO selo universal — a estrela preta com "PROMO".
// A TCGdex tem logo de era pra alguns e NADA pra outros (svp/mep vêm vazios);
// padronizamos TODOS com esse selo universal (servido pela própria TCGdex, já
// host de imagem liberado) como thumb do set. Override aqui no merge porque roda
// todo build — imune ao cache por-set do sync-tcgdex.
const BLACK_STAR_PROMO_LOGO = "https://assets.tcgdex.net/univ/swsh/swshp/symbol.png";

for (const lang of langs) {
  for (const chunk of chunksByLang[lang] || []) {
    let changed = !!chunk.dirty;
    consumedSets.add(`${lang}/${chunk.setId}`);
    // Injeta as cartas novas da PPT deste set+idioma (dedupe por id) antes do
    // processamento, pra entrarem no preço/índices/chunk como qualquer outra.
    const news = newBySet[`${lang}/${chunk.setId}`];
    if (news && news.length) {
      const have = new Set(chunk.cards.map((c) => c.id));
      // A MESMA guarda do sync (missAllowed): o artefato de cartas novas pode
      // vir do cache de build de uma rodada anterior à guarda, e uma promo JP
      // "227" em set EN "SWSH###" não pode voltar por essa porta.
      const prefixes = chunkNumberPrefixes(chunk.cards);
      // Exceção conferida à mão (Mew RGB: "R", "G", "B" no lugar do número),
      // a mesma que o sync aplicou — vale pro set em qualquer idioma.
      const extra = extraNumbersOf(setMapPins, chunk.setId);
      for (const nc of news) {
        if (have.has(nc.id) || jaMigrado(nc.id)) continue;
        if (!missAllowed(nc.number, prefixes, extra)) { rejectedNew++; continue; }
        const { _new, ...card } = nc; // remove a flag interna
        chunk.cards.push(card); have.add(nc.id); injectedNew++; changed = true;
      }
    }
    for (const card of chunk.cards) {
      // Backfill do dexId pelo nome local ANTES da canonização (Trainer/Energy
      // ficam fora: um treinador homônimo de espécie não pode virar Pokémon).
      if (!speciesDexId(card) && card.pokemonName && card.category !== "Trainer" && card.category !== "Energy") {
        const dex = dexByLocalName.get(card.pokemonName);
        if (dex && dex > 0) { card.dexId = dex; dexBackfilled++; changed = true; }
      }
      const canonical = speciesByDex.get(speciesDexId(card));
      if (canonical && card.pokemonName !== canonical) {
        card.pokemonName = canonical;
        changed = true;
      }
      if (card.price) {
        pricing[card.id] = card.price;
        delete card.price;
        changed = true;
      }
      // Black Star Promo: força o selo universal como logo do set (todas as eras).
      if (/black star promo/i.test(card.set || "") && card.setLogo !== BLACK_STAR_PROMO_LOGO) {
        card.setLogo = BLACK_STAR_PROMO_LOGO; changed = true;
      }
      // Imagem do TCGplayer (via TCGCSV ou PPT) onde a TCGdex não tem (ex.: era Mega JP).
      const pp = pptData[card.id], cp = csvData[card.id];
      const img = (cp && cp.img) || (pp && pp.img) || mergeImgs[card.id];
      if (img && !card.image) { card.image = img; changed = true; }
      // Coleta as imagens EN (já com o fill da PPT) por id, pra usar como fallback
      // nas cartas localizadas (PT/JA/ZH) que não têm imagem própria.
      if (lang === "en" && card.image) enImageById.set(card.id, card.image);
    }
    // Provisória com gêmea OFICIAL de outro id no mesmo set (a fonte publicou
    // a carta que apostamos, só que com outro id): a gêmea única vira de-para e
    // a provisória sai — a conta de quem marcou migra pelo ID_MERGES.
    for (const g of findTwins(chunk.cards)) {
      if (g.twin) {
        twinsApplied.push({ lang, setId: chunk.setId, from: g.prov, to: g.twin, name: g.name, number: g.number });
        chunk.cards = chunk.cards.filter((c) => c.id !== g.prov);
        changed = true;
      } else {
        twinsPending.push({ lang, setId: chunk.setId, id: g.prov, name: g.name, number: g.number, ...(g.candidates ? { candidates: g.candidates } : { suspeita: g.suspeita }) });
      }
    }
    if (changed) {
      await writeFile(new URL(`sets/${lang}/${chunk.file}`, dataDir), JSON.stringify(chunk.cards), "utf8");
    }
    allCards.push(...chunk.cards);
    const entrada = {
      id: chunk.setId,
      name: chunk.cards[0]?.set || chunk.setId,
      count: chunk.cards.length,
      language: lang,
      file: `data/sets/${lang}/${chunk.file}`
    };
    // Chunk CONGELADO (retire-imported-sets): sobra de set aposentado sem par
    // no set da TCGdex. Entra no manifest — o id tem que resolver na coleção,
    // no popup e na busca — mas marcado, pra tela de Sets e a contagem do
    // catálogo não o listarem como um set a mais (era o sintoma original: 4
    // coleções de 30 anos onde existem 2).
    if (isRetiredChunk(chunk.cards)) entrada.retired = chunk.cards[0].retired;
    manifestSets.push(entrada);
  }
}

// Sets que SÓ existem na PPT (a TCGdex ainda não tem chunk): cria um chunk novo
// do zero a partir das cartas sintetizadas (importJpSet). Defensivo — um erro
// aqui não pode derrubar o build do catálogo inteiro. Add-on-miss normal nunca
// cai aqui (sempre tem chunk); só os JP_IMPORT_SETS (M5/MBG…) chegam órfãos.
for (const [key, news] of Object.entries(newBySet)) {
  if (consumedSets.has(key) || !news || !news.length) continue;
  try {
    const slash = key.indexOf("/");
    const lang = key.slice(0, slash), setId = key.slice(slash + 1);
    if (!langs.includes(lang)) continue;
    const cards = [];
    const have = new Set();
    for (const nc of news) {
      if (!nc || !nc.id || have.has(nc.id) || jaMigrado(nc.id)) continue;
      const { _new, ...card } = nc;
      if (card.price) { pricing[card.id] = card.price; delete card.price; }
      const canonical = speciesByDex.get(speciesDexId(card));
      if (canonical) card.pokemonName = canonical;
      cards.push(card); have.add(nc.id);
    }
    if (!cards.length) continue;
    const file = `${setId}.json`;
    await writeFile(new URL(`sets/${lang}/${file}`, dataDir), JSON.stringify(cards), "utf8");
    allCards.push(...cards);
    manifestSets.push({ id: setId, name: cards[0].set || setId, count: cards.length, language: lang, file: `data/sets/${lang}/${file}` });
    injectedNew += cards.length;
    console.log(`  [merge] set sem chunk na TCGdex criado da fonte de preço: ${lang}/${setId} "${cards[0].set || setId}" (${cards.length} cartas)`);
  } catch (e) { console.warn(`  [merge] falha criando set ${key}: ${e.message}`); }
}

// Fallback de imagem por idioma: carta localizada (PT/JA/ZH) sem imagem própria
// herda a imagem da MESMA carta em EN (mesmo id TCGdex, ex.: "mep-12-pt" ->
// "mep-12"). Texto/nome/bandeira seguem no idioma da carta — só a imagem é EN.
// Roda DEPOIS do loop (enImageById já completo, com o fill da PPT). Os objetos
// são os mesmos de allCards, então a alteração entra no catálogo unificado.
let imgFallbacks = 0;
for (const lang of langs) {
  if (lang === "en") continue;
  for (const chunk of chunksByLang[lang] || []) {
    let changed = false;
    for (const card of chunk.cards) {
      if (card.image) continue;
      const enImg = enImageById.get(String(card.id).replace(/-(pt|ja|zh-cn|zh-tw)$/, ""));
      if (enImg) { card.image = enImg; imgFallbacks++; changed = true; }
    }
    if (changed) await writeFile(new URL(`sets/${lang}/${chunk.file}`, dataDir), JSON.stringify(chunk.cards), "utf8");
  }
}
if (imgFallbacks) console.log(`Imagem EN herdada por cartas localizadas sem imagem própria: ${imgFallbacks}`);

// Preços de mercado BR (MYP), se o sync rodou com token (data/myp-prices.
// generated.json). Grava em pricing[id].b = { mn, md, mx }; o front prioriza
// isto sobre a referência internacional (shared.js#cardValue) e mostra o
// tooltip "Referência de mercado BR (MYP)". Sem o arquivo (token ausente) é
// no-op — o build segue só com a referência internacional.
//
// O JOIN entre a entrada do MYP e o cardId do catálogo é o ponto a calibrar
// quando o token chegar: a forma exata de editionCode/cardCode só se confirma
// com um retorno real (ver scripts/sync-myp.mjs). Hoje casa por nome
// normalizado + número da carta, registrando nos logs quantas casaram para
// validar/ajustar o join na primeira execução real.
await applyMypPrices(pricing, allCards);

// Preço/graded da PPT por cima: a TCGdex dá preço-lixo (Cardmarket EUR) pras
// cartas JP e pra várias EN (só o piso do Cardmarket, sem TCGplayer); o `u` da
// PPT é o mercado real do TCGplayer (JP + sets EN de alto valor), e sobrescreve.
// O front (shared.js#cardValue) prioriza `u` sobre `e`, então isso já conserta
// o valor JP. Graded (PSA 9/10) vai em `g` pra exibição no card.
// Ordem das fontes de USD, da pior pra melhor (a última a escrever vence):
//   TCGdex (embutido no card; pode ser só o piso do Cardmarket e fica até 7
//   dias no cache) < PPT (mesmo mercado TCGplayer, mas por crédito, 3x/semana,
//   com teto de tempo — chega atrasado) < TCGCSV (TCGplayer por impressão,
//   diário, grátis). O `g` (graded PSA) é exclusivo da PPT e entra sempre.
let pptApplied = 0;
for (const [id, p] of Object.entries(pptData)) {
  if (!p) continue;
  const ref = pricing[id] || (pricing[id] = {});
  if (p.u > 0 && !(csvData[id] && csvData[id].u > 0)) { applyVariantPrices(ref, p); pptApplied++; }
  if (p.g) ref.g = p.g;
}
if (Object.keys(pptData).length) console.log(`Preços PPT aplicados: ${pptApplied} (de ${Object.keys(pptData).length} no artefato)`);
let csvApplied = 0;
for (const [id, p] of Object.entries(csvData)) {
  if (!p || !(p.u > 0)) continue;
  applyVariantPrices(pricing[id] || (pricing[id] = {}), p);
  csvApplied++;
}
if (Object.keys(csvData).length) console.log(`Preços TCGCSV (TCGplayer por impressão) aplicados: ${csvApplied}`);
// Entradas sem preço nenhum (só imagem, por exemplo) não ocupam a tabela.
for (const [id, ref] of Object.entries(pricing)) {
  if (!(ref.u > 0 || ref.e > 0 || (ref.b && ref.b.md > 0) || ref.g)) delete pricing[id];
}

// Metadados de set + soma de preço em cada entrada do manifest, pra LISTA de
// sets não precisar dos chunks de carta (ver setManifestMeta). Roda AQUI, no
// fim: o `pricing` só está completo depois do MYP e da PPT, e um valor somado
// com a tabela pela metade sairia menor que o real.
{
  const cardsByEntry = new Map();
  for (const card of allCards) {
    const key = `${card.setId || ""}|${card.language || "en"}`;
    if (!cardsByEntry.has(key)) cardsByEntry.set(key, []);
    cardsByEntry.get(key).push(card);
  }
  let semGrupo = 0;
  for (const entry of manifestSets) {
    const group = cardsByEntry.get(`${entry.id}|${entry.language}`);
    // Sem grupo (não deveria acontecer): a entrada segue válida e o cliente cai
    // no caminho antigo — baixa o chunk daquele set pra desenhar o tile.
    if (!group) { semGrupo++; continue; }
    Object.assign(entry, setManifestMeta(group, pricing));
  }
  if (semGrupo) console.warn(`  [merge] ${semGrupo} entrada(s) de manifest sem cartas casadas — tile cai no chunk`);
}

const manifest = {
  languages: langs,
  generatedAt: new Date().toISOString(),
  sets: manifestSets
};

const mergedIndexes = buildIndexes(allCards);
await writeFile(new URL("indexes.generated.js", dataDir), `window.TCG_INDEXES = ${JSON.stringify(mergedIndexes)};\n`, "utf8");
// Fatias por chave (indexes-sets/-artists/…): é o que as páginas realmente
// carregam. SÓ a família .generated: o índice MESCLADO é artefato de produção,
// e escrever as fatias de dev com ele deixava indexes-sets.json (versionado,
// espelho do data/indexes.js de dev) com conteúdo mesclado — o snapshot
// automático commitava a mistura e o `split-indexes.mjs --check` do CI quebrava
// no push seguinte. A família de dev é do split-indexes.mjs (backfill).
await writeSplitIndexes(dataDir, mergedIndexes, { only: "generated" });
await writeFile(new URL("manifest.generated.js", dataDir), `window.TCG_MANIFEST = ${JSON.stringify(manifest)};\n`, "utf8");
await writeFile(new URL("pricing.generated.js", dataDir), `window.TCG_PRICING = ${JSON.stringify(pricing)};\n`, "utf8");

// De-para das provisórias que ganharam gêmea oficial: grava no arquivo
// VERSIONADO (o snapshot do deploy commita data/) e recarimba o núcleo, pra a
// migração da conta valer já neste deploy — mesmo caminho do
// retire-imported-sets, que carimba antes do merge e não veria estes pares.
if (twinsApplied.length) {
  const merges = idMerges || { sets: [], prefixes: {}, cards: {}, images: {} };
  merges.cards = merges.cards || {};
  for (const t of twinsApplied) merges.cards[t.from] = t.to;
  await writeFile(new URL("card-id-merges.json", dataDir), JSON.stringify(merges, null, 1) + "\n", "utf8");
  const sharedUrl = new URL("../src/shared.js", dataDir);
  try {
    await writeFile(sharedUrl, stampIdMerges(await readFile(sharedUrl, "utf8"), merges), "utf8");
  } catch (e) { console.warn(`  [merge] de-para gravado no JSON, mas o carimbo no núcleo falhou: ${e.message}`); }
  console.log(`IDs provisórios com gêmea oficial — de-para automático: ${twinsApplied.map((t) => `${t.from} -> ${t.to}`).join(", ")}`);
}
if (twinsPending.length) console.warn(`  [merge] ${twinsPending.length} id(s) provisório(s) com possível gêmea oficial AMBÍGUA (ver provisional-ids.generated.json): ${twinsPending.slice(0, 10).map((t) => t.id).join(", ")}`);
// Relatório pro passo que avisa (report-provisional-ids.mjs): quantas apostas de
// id estão no ar por origem, o que foi migrado sozinho e o que precisa de gente.
{
  const porOrigem = {};
  for (const c of allCards) if (c.prov) porOrigem[c.prov] = (porOrigem[c.prov] || 0) + 1;
  await writeFile(new URL("provisional-ids.generated.json", dataDir), JSON.stringify({
    generatedAt: new Date().toISOString(), provisional: porOrigem, applied: twinsApplied, pending: twinsPending
  }, null, 1), "utf8");
}

if (pptNewCards.length || csvNewCards.length) console.log(`Cartas novas (TCGCSV ${csvNewCards.length} + PPT ${pptNewCards.length}) injetadas: ${injectedNew}${rejectedNew ? ` · ${rejectedNew} recusadas pela guarda de numeração` : ""}`);
if (dexBackfilled) console.log(`dexId preenchido pelo nome local (secret rares JP/CN sem metadado): ${dexBackfilled}`);
console.log(`Mesclados: ${allCards.length} cartas, ${manifestSets.length} sets (${langs.join(", ")})`);
console.log(`Preços de referência: ${Object.keys(pricing).length} cartas`);
console.log(`Espécies canônicas conhecidas: ${speciesByDex.size}`);

// Lê data/myp-prices.generated.json (se existir) e aplica os preços BR em
// pricing[id].b. Defensivo: ausência do arquivo = no-op silencioso.
async function applyMypPrices(priceTable, sourceCards) {
  let entries;
  try {
    entries = JSON.parse(await readFile(new URL("myp-prices.generated.json", dataDir), "utf8"));
  } catch {
    return; // sem token / sem arquivo — segue só com referência internacional
  }
  if (!Array.isArray(entries) || !entries.length) return;

  // Índice das entradas MYP por nome normalizado + número. Calibrar este join
  // (e o normalize() do sync-myp) quando houver retorno real da API.
  const byKey = new Map();
  for (const e of entries) {
    const num = mypNumber(e.cardCode);
    const name = normName(e.nameEn) || normName(e.namePt);
    if (name && num) byKey.set(`${name}#${num}`, e);
  }

  let applied = 0;
  for (const card of sourceCards) {
    const e = byKey.get(`${normName(card.name)}#${mypNumber(card.number)}`);
    if (!e) continue;
    const mn = num(e.min), md = num(e.avg) || num(e.min), mx = num(e.max);
    if (!md) continue;
    const ref = priceTable[card.id] || (priceTable[card.id] = {});
    ref.b = { mn: mn || md, md, mx: mx || md };
    applied++;
  }
  console.log(`Preços BR (MYP): ${entries.length} entradas, ${applied} casadas com o catálogo`);
}

function normName(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
// Número da carta (parte antes da barra, sem zeros à esquerda): "012/198" -> "12".
function mypNumber(s) {
  const m = String(s || "").match(/(\d+)/);
  return m ? String(Number(m[1])) : "";
}
function num(v) {
  const n = Number(String(v == null ? "" : v).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

function buildIndexes(sourceCards) {
  return {
    pokedex: buildPokedexIndex(sourceCards),
    // Treinadores agrupados por nome (Supporter/Item/Stadium/Tool).
    trainers: groupToIndex(sourceCards.filter((card) => card.category === "Trainer"), (card) => card.name),
    sets: groupToIndex(sourceCards, (card) => card.set),
    artists: groupToIndex(sourceCards, (card) => card.artist || "Artista desconhecido"),
    // Totais (só contagem) por chave da aba "Pokémon" da Coleção, que agrupa por
    // pokemonName OU speciesName(name) — logo inclui Treinador/Energia/Item, que
    // ficam de fora do índice pokedex. A Coleção usa isto para os denominadores
    // de progresso sem precisar baixar o catálogo inteiro.
    pokemonTotals: countByKey(sourceCards, (card) => card.pokemonName || speciesNameKey(card.name))
  };
}

// Replica shared.js#speciesName: a chave precisa ser idêntica à do front.
function speciesNameKey(name) {
  return String(name || "")
    .replace(/\b(VMAX|VSTAR|ex|EX|GX|V-UNION|V)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function countByKey(sourceCards, getKey) {
  const counts = {};
  for (const card of sourceCards) {
    const key = getKey(card) || "—";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// Pokédex nacional completa: uma entrada por espécie (dexId 1..1025), em ordem
// de número e mesmo sem carta no catálogo. Só cartas com dexId entram como
// cardIds — Treinador/Energia/Item ficam de fora.
function buildPokedexIndex(sourceCards) {
  const byDex = new Map();
  for (const [dexId, name] of speciesByDex) byDex.set(dexId, { dexId, name, cardIds: [] });
  for (const card of sourceCards) {
    const dexId = speciesDexId(card);
    if (!dexId) continue;
    if (!byDex.has(dexId)) byDex.set(dexId, { dexId, name: card.pokemonName, cardIds: [] });
    byDex.get(dexId).cardIds.push(card.id);
  }
  return Array.from(byDex.values())
    .sort((a, b) => a.dexId - b.dexId)
    .map((entry) => ({ ...entry, cardIds: entry.cardIds.sort((a, b) => a.localeCompare(b)) }));
}

function groupToIndex(sourceCards, getKey) {
  const groups = new Map();
  for (const card of sourceCards) {
    const key = getKey(card) || "Sem grupo";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card.id);
  }
  return Array.from(groups, ([name, cardIds]) => ({
    name,
    cardIds: cardIds.sort((a, b) => a.localeCompare(b))
  })).sort((a, b) => a.name.localeCompare(b.name));
}
