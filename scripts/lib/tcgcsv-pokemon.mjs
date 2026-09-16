// Lógica PURA do sync da TCGCSV pro Pokémon (scripts/sync-tcgcsv-pokemon.mjs):
// casar set nosso ↔ grupo do TCGplayer, casar carta ↔ produto pelo número,
// sintetizar carta nova. Sem rede e sem fs de propósito — é o que os testes
// travam (tests/tcgcsv-pokemon.test.mjs), já que o sync de verdade só roda no
// deploy com a fonte viva.
import { normNum, numDoId } from "./sync-common.mjs";
import { compactTcgcsvPrice, chunkNumberPrefixes, missAllowed, VARIANTS, variantOfPrinting } from "./pricing.mjs";

// ── Nome de set: TCGdex ↔ TCGplayer ─────────────────────────────────────────
// O TCGplayer decora o nome com o código da era ("SWSH07: Evolving Skies",
// "SV01: Scarlet & Violet Base Set", "SM - Ultra Prism", "XY - Evolutions",
// "HS—Undaunted") e sufixos ("Base Set", "Trainer Gallery"); a TCGdex escreve
// o nome limpo ("Evolving Skies", "Scarlet & Violet"). A normalização tira
// tudo isso e iguala "&"/"and", acento e caixa. Devolve as duas formas: com e
// sem o sufixo "base set" — "Expedition Base Set" (TCGplayer) É "Expedition"
// (TCGdex), mas "Base Set" sozinho tem que continuar sendo "Base Set".
export function normalizeSetName(name) {
  let s = String(name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  s = s.replace(/^\s*(?:swsh|sv|sm|xy|bw|hs|hgss|dp|pl|pop|ex|me|mep|svp|swshp)\s*\d*(?:\.\d)?\s*[:\-–—]\s*/, ""); // "SWSH07: ", "SM - ", "XY - "
  s = s.replace(/^\s*(?:sv|swsh|sm|xy|bw)\s*:\s*/, "");
  s = s.replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  s = s.replace(/^(?:pokemon\s+)?(?:tcg\s+)?/, "");
  const semBase = s.replace(/\s+base\s+set$/, "").trim();
  return { full: s, short: semBase || s };
}

// Todas as chaves pelas quais um nome pode casar (as duas formas + apelidos
// de era que a TCGdex escreve diferente do TCGplayer).
const ALIAS = {
  "expedition": ["expedition base set"],
  "ruby and sapphire": ["ex ruby and sapphire"],
  "sword and shield": ["sword and shield base set"],
  "scarlet and violet": ["scarlet and violet base set"],
  "sun and moon": ["sm base set", "sun and moon base set"],
  "black and white": ["black and white base set"],
  "diamond and pearl": ["diamond and pearl base set"],
  "151": ["scarlet and violet 151"],
  "shining fates": ["shining fates shiny vault"],
  "hidden fates": ["hidden fates shiny vault"],
  "wizards black star promos": ["wotc promo", "wizards of the coast promos"],
  "mcdonald s collection 2011": ["mcdonald s promos 2011"]
};
export function setNameKeys(name) {
  const n = normalizeSetName(name);
  const keys = new Set([n.full, n.short]);
  for (const k of [...keys]) for (const a of ALIAS[k] || []) keys.add(a);
  for (const [canon, aliases] of Object.entries(ALIAS)) if (aliases.includes(n.full) || aliases.includes(n.short)) keys.add(canon);
  keys.delete("");
  return [...keys];
}

// Índice dos grupos do TCGplayer por chave de nome. Um nome pode ter vários
// grupos (o TCGplayer separa "Brilliant Stars" e "Brilliant Stars Trainer
// Gallery"; a TCGdex junta os dois num chunk) — por isso lista, não valor.
export function indexGroupsByName(groups) {
  const idx = new Map();
  for (const g of groups || []) {
    if (!g || g.groupId == null) continue;
    for (const k of setNameKeys(g.name)) {
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push(g);
    }
  }
  return idx;
}

// Candidatos de grupo pra um set nosso: pelo nome exato normalizado, mais as
// galerias-irmãs ("<nome> trainer gallery" / "galarian gallery") que na TCGdex
// vivem no mesmo chunk. Sem candidato → o set fica com o preço da TCGdex.
export function candidateGroups(ourSet, groupIndex) {
  const out = [];
  const seen = new Set();
  const push = (g) => { if (g && !seen.has(g.groupId)) { seen.add(g.groupId); out.push(g); } };
  for (const k of setNameKeys(ourSet.name)) {
    for (const g of groupIndex.get(k) || []) push(g);
    for (const suf of [" trainer gallery", " galarian gallery", " shiny vault"]) for (const g of groupIndex.get(k + suf) || []) push(g);
  }
  return out;
}

// Número da carta no produto do TCGplayer (extendedData "Number": "4/102",
// "SWSH227", "TG08/TG30", "025/165") → chave normNum ("4", "swsh227", "tg8", "25").
export function productNumber(product) {
  const d = (product && product.extendedData || []).find((e) => e && e.name === "Number");
  return d ? String(d.value) : "";
}
export function productKey(product) {
  const n = productNumber(product);
  return n ? normNum(n) : "";
}

// "Charizard ex - 199/165" / "Pikachu (025/165) (Poke Ball Pattern)" → nome
// limpo. O número já vai no campo próprio; sufixos de padrão ("Master Ball
// Pattern", "Poke Ball Pattern") são impressões separadas do MESMO número e
// ficam no nome, que é como o TCGplayer as distingue.
export function cleanProductName(name) {
  let s = String(name || "");
  // " - 199/165", " - SWSH227", " - 227/S-P" (o denominador JP é o código do set)
  s = s.replace(/\s*-\s*[A-Za-z]*\s?\d{1,4}[A-Za-z]?(?:\/[A-Za-z0-9-]{1,8})?\s*$/, "");
  s = s.replace(/\s*\(\s*[A-Za-z]*\d{1,4}[A-Za-z]?(?:\/[A-Za-z0-9-]{1,8})?\s*\)/g, "");     // " (025/165)"
  return s.replace(/\s{2,}/g, " ").trim();
}

// Produto "principal" entre vários do mesmo número (arte base × "Poke Ball
// Pattern" × "Master Ball Pattern"…): o de nome sem parêntese; empate pelo
// maior preço (é a impressão que existe de verdade no mercado).
export function pickMainProduct(products, priceOf) {
  let best = null, bestScore = -1;
  for (const p of products) {
    const plain = /\(/.test(String(p.name || "")) ? 0 : 1;
    const score = plain * 1e9 + (priceOf(p) || 0);
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

// Casa os produtos de um grupo com o chunk nosso. Devolve:
//   entries: { cardId: { u, v?, img } }
//   misses:  produtos com número fora do chunk E dentro do padrão de numeração
//            (candidatos a carta nova; a guarda missAllowed é a de sempre)
//   matched/total: pra confirmar que o grupo é mesmo o set (ver groupFits)
export function matchGroup(chunk, products, prices, { setId, lang }) {
  const suffix = lang === "en" ? "" : `-${lang}`;
  const byKey = new Map();
  for (const c of chunk || []) {
    const local = String(c.id).replace(`${setId}-`, "").replace(/-(pt|ja|zh-cn|zh-tw|zh)$/, "");
    const k = normNum(local);
    if (k && !byKey.has(k)) byKey.set(k, c.id);
  }
  const rowsByProduct = new Map();
  for (const p of prices || []) {
    if (!p || p.productId == null) continue;
    if (!rowsByProduct.has(p.productId)) rowsByProduct.set(p.productId, []);
    rowsByProduct.get(p.productId).push(p);
  }
  const priceOf = (p) => { const c = compactTcgcsvPrice(rowsByProduct.get(p.productId)); return c ? c.u : 0; };
  const byNumber = new Map();
  for (const p of products || []) {
    const k = productKey(p);
    if (!k) continue; // selado (booster, ETB…) não tem Number
    if (!byNumber.has(k)) byNumber.set(k, []);
    byNumber.get(k).push(p);
  }
  const prefixes = chunkNumberPrefixes(chunk);
  const entries = {};
  const misses = [];
  let matched = 0;
  // Set importado INTEIRO (sem chunk): o mesmo numerador com denominadores
  // diferentes são cartas DIFERENTES — a Classic Collection reimprime cada
  // carta com o número original ("Blastoise 2/102" e "Blaine's Charizard
  // 2/132" conviviam na de 2021), e escolher uma perderia a outra. A primeira
  // (menor denominador) fica com o id simples; as demais levam o denominador
  // no id (idExtra). Num set que já existe a régua é a de sempre: um número =
  // uma carta, e o que sobra são impressões (Poke Ball Pattern…) da mesma.
  const importMode = !(chunk && chunk.length);
  for (const [k, list] of byNumber) {
    const buckets = importMode ? splitByDenominator(list) : [{ den: "", list }];
    buckets.forEach((b, i) => {
      const main = pickMainProduct(b.list, priceOf);
      const compact = compactTcgcsvPrice(rowsByProduct.get(main.productId));
      const img = `https://tcgplayer-cdn.tcgplayer.com/product/${main.productId}_in_400x400.jpg`;
      const ourId = byKey.get(k);
      if (ourId) {
        matched++;
        const e = { img };
        if (compact) Object.assign(e, compact);
        entries[ourId] = e;
      } else if (missAllowed(productNumber(main), prefixes)) {
        // Impressões que o TCGplayer vende deste produto, na ordem canônica: é a
        // lista de variantes da carta sintetizada (uma promo só-Holo tem que
        // nascer ["Holo"], não ["Normal"], senão a Coleção oferece a versão errada).
        const printings = VARIANTS.filter((v) => (rowsByProduct.get(main.productId) || []).some((r) => variantOfPrinting(r.subTypeName) === v));
        misses.push({ product: main, key: i ? `${k}-${b.den}` : k, idExtra: i ? b.den : "", price: compact, img, variants: printings });
      }
    });
  }
  return { entries, misses, matched, total: byNumber.size, ourCount: byKey.size, suffix };
}
// Produtos do mesmo numerador agrupados pelo denominador impresso ("4/102" →
// "102"; sem barra → ""), em ordem numérica (depois alfabética) pra o id ser
// estável entre builds.
export function splitByDenominator(products) {
  const by = new Map();
  for (const p of products) {
    const n = productNumber(p);
    const den = n.includes("/") ? n.split("/")[1].trim().toLowerCase() : "";
    if (!by.has(den)) by.set(den, []);
    by.get(den).push(p);
  }
  const num = (d) => (/^\d+$/.test(d) ? Number(d) : Infinity);
  return [...by.entries()].sort((a, b) => num(a[0]) - num(b[0]) || a[0].localeCompare(b[0])).map(([den, list]) => ({ den, list }));
}

// Um grupo do TCGplayer É o set nosso quando os números batem: metade das
// nossas cartas achadas nele (ou metade das dele nas nossas, pra chunk que
// junta galeria + set). Nome igual sozinho não basta — "Base Set" existe em
// três eras e o Cardmarket/TCGplayer reciclam nomes.
export function groupFits(m) {
  if (!m || !m.ourCount || !m.total) return false;
  return m.matched / m.ourCount >= 0.5 || m.matched / m.total >= 0.5;
}

// Código do set japonês no nome do grupo: "SV4a: Shiny Treasure ex" -> "SV4a";
// "SV-P Promotional Cards" -> "SV-P"; "S-P Promotional Cards" -> "S-P". Sem
// código reconhecível → null (o sync loga e pula: não dá pra dar setId estável).
export function jpSetCode(name) {
  const s = String(name || "").trim();
  let m = s.match(/^([A-Za-z0-9.-]+)\s*[:：]\s*\S/);
  if (m) return m[1];
  m = s.match(/^([A-Za-z0-9-]+(?:-P)?)\s+Promo(?:tional)?\b/i);
  if (m) return m[1];
  return null;
}
// Nome do set sem o código: "SV4a: Shiny Treasure ex" -> "Shiny Treasure ex".
export function jpSetTitle(name) {
  return String(name || "").replace(/^[A-Za-z0-9.-]+\s*[:：]\s*/, "").trim() || String(name || "");
}

// Apelido de um grupo JP (data/tcgcsv-set-map.json, ja.alias): pelo NOME
// exato do grupo ("SV: Stellar Miracle Deck Build Box" -> "SVK") ou pelo
// código ("SVP" -> "SV-P"). O nome vem primeiro porque é o que desambigua:
// o TCGplayer batiza dezenas de decks iniciais só com o código da era.
export function jpAliasOf(group, code, alias) {
  const a = alias || {};
  const name = String(group && group.name || "").trim();
  return a[name] || a[code] || a[String(code || "").toUpperCase()] || null;
}

// Códigos AMBÍGUOS entre os grupos JP sem chunk nosso: o mesmo código em mais
// de um grupo (16/09/2026, 1º build do import JP em produção: 11 decks
// "SV: …", 5 "sA: … Starter Set V", os pares BW1 Black/White Collection…).
// Importar todos com o mesmo setId fundia decks diferentes num set só, com
// os números colidindo (a primeira carta de cada número ficava, as outras
// sumiam). Esses códigos são pulados até ganharem apelido por nome de grupo
// em ja.alias; o sync lista os grupos no log pra facilitar o pin.
//   groups: grupos do TCGplayer Japan; codeOf: grupo -> código (jpSetCode);
//   hasChunk: código -> bool; alias: ja.alias
// Devolve Map código -> [grupos] só dos ambíguos.
export function jpAmbiguousCodes(groups, { codeOf, hasChunk, alias }) {
  const byCode = new Map();
  for (const g of groups || []) {
    const code = codeOf(g);
    if (!code || hasChunk(code) || jpAliasOf(g, code, alias)) continue;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(g);
  }
  return new Map([...byCode].filter(([, list]) => list.length > 1));
}

// Série de um set JP importado inteiro, pelo prefixo do código — os MESMOS
// valores que a TCGdex grava nos chunks ja (setSerieId/setSerieName), pra o
// set cair no grupo certo da tela de Sets. Sem isso um "M6a: 30th Celebration"
// nascia sem série e ia parar em "Outros" (16/09/2026), longe dos irmãos M1–M6.
// Prefixo mais longo primeiro ("SV1a" é SV, não S; "SM10" é SM). Código de era
// que a TCGdex ja não cobre (DP, BW, L…) fica sem série de propósito: não há
// nome canônico pra copiar.
const JP_SERIES = [
  ["SV", "ポケモンカードゲーム スカーレット&バイオレット"],
  ["SM", "サン＆ムーン"],
  ["XY", "XY"], ["CP", "XY"],
  ["S", "剣と盾"],
  ["M", "ポケモンカードゲーム MEGA"]
].sort((a, b) => b[0].length - a[0].length);
export function jpSerieOfCode(code) {
  const c = String(code || "").toUpperCase();
  const hit = JP_SERIES.find(([prefix]) => c.startsWith(prefix));
  if (!hit) return null;
  return { setSerieId: hit[0] === "CP" ? "XY" : hit[0], setSerieName: hit[1] };
}

// ── Import de set EN inteiro (pins `enImport` em data/tcgcsv-set-map.json) ──
// A TCGdex demora dias pra publicar um set novo em inglês; o TCGplayer cria o
// grupo na pré-venda e lista os singles no lançamento. O pin diz qual grupo
// vira qual set nosso: { group: "ME: 30th Celebration" | <groupId>, setId,
// name?, serie?, numbers?, date?, total? }. `numbers` é uma regex sobre o
// número IMPRESSO ("001/158", "4/102") pra dividir um grupo em dois sets
// (set principal × Classic Collection) quando o TCGplayer junta tudo.
const EN_SERIES = {
  me: "Mega Evolution", sv: "Scarlet & Violet", swsh: "Sword & Shield", sm: "Sun & Moon", xy: "XY"
};
export function enImportEntries(pins) {
  const list = pins && Array.isArray(pins.enImport) ? pins.enImport : [];
  return list.filter((e) => e && e.setId && e.group != null);
}
// Grupo do TCGplayer que o pin aponta: pelo groupId (número) ou pelo nome
// normalizado (mesma régua do casamento por nome, então "ME: 30th Celebration"
// e "30th Celebration" são o mesmo grupo).
export function findImportGroup(entry, groups) {
  if (!entry) return null;
  if (typeof entry.group === "number") return (groups || []).find((g) => g && g.groupId === entry.group) || null;
  const want = normalizeSetName(entry.group).full;
  if (!want) return null;
  return (groups || []).find((g) => g && normalizeSetName(g.name).full === want) || null;
}
// Campos de set das cartas sintetizadas (faz as vezes da carta-irmã): nome de
// exibição, série, data e total vêm do pin, senão do grupo.
export function importSetFields(entry, group) {
  const serie = String(entry.serie || "").toLowerCase();
  return {
    set: entry.name || (group ? group.name : entry.setId),
    setSerieId: serie, setSerieName: EN_SERIES[serie] || "",
    setReleaseDate: entry.date || "",
    setTotal: entry.total || "",
    setLogo: "", setSymbol: ""
  };
}
// Filtro de número do pin (`numbers`): sem regex, tudo passa.
export function importNumberFilter(entry) {
  if (!entry || !entry.numbers) return () => true;
  const re = new RegExp(entry.numbers);
  return (product) => re.test(productNumber(product));
}

// Espécie a partir do nome da carta (mesma régua do sync-tcgdex/PPT).
export function speciesOf(name) {
  return String(name || "").replace(/\b(VMAX|VSTAR|ex|EX|GX|V-UNION|V|BREAK|LV\.X|Prime|LEGEND)\b/g, "").replace(/\s+/g, " ").trim();
}
export function genOf(dexId) {
  const id = Number(dexId); if (!id) return "";
  const caps = [151, 251, 386, 493, 649, 721, 809, 905];
  const i = caps.findIndex((c) => id <= c);
  return i < 0 ? 9 : i + 1;
}

// Sintetiza UMA carta nova (add-on-miss ou set importado inteiro) no formato
// do catálogo. `pinned` = id já publicado pra esse número (nunca muda id de
// quem já tem a carta); `sib` = carta-irmã do chunk (campos do set) ou null
// num set importado do zero (aí `group` dá nome/data).
// `keepZeros`: o id leva o número como impresso ("001", não "1") — é a
// convenção da TCGdex nas eras SV/ME ("me05-001", "sv01-001"); um set EN
// importado inteiro nasce assim pra, quando a TCGdex publicar o mesmo id, as
// cartas casarem em vez de duplicar. Promo/add-on segue sem zeros (numDoId).
// `idExtra`: sufixo do id quando o mesmo numerador aparece duas vezes num set
// importado (o denominador — ver matchGroup).
export function synthesizeCard({ product, price, img, setId, lang, sib, group, pinned, revNames, variants, keepZeros, idExtra }) {
  const name = cleanProductName(product.name);
  const number = productNumber(product).split("/")[0].trim();
  const suffix = lang === "en" ? "" : `-${lang}`;
  const species = speciesOf(name);
  const dexId = (revNames && revNames[species.toLowerCase()]) || "";
  const rarity = ((product.extendedData || []).find((e) => e && e.name === "Rarity") || {}).value || "";
  // Total do set só quando o denominador é número ("199/165" -> 165; "TG08/TG30"
  // -> 30). Promo JP "227/S-P" tem o CÓDIGO no lugar do total: fica vazio.
  const withDen = productNumber(product);
  const den = withDen.includes("/") ? withDen.split("/")[1].trim().replace(/^[A-Za-z]+/, "") : "";
  const total = /^\d+$/.test(den) ? Number(den) : "";
  const card = {
    id: pinned || `${setId}-${keepZeros ? number : numDoId(number)}${idExtra ? `-${idExtra}` : ""}${suffix}`,
    name,
    pokemonName: dexId ? "" : species, // o merge canoniza por dexId
    category: "",
    dexId, generation: genOf(dexId),
    pokemonImage: dexId ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${dexId}.png` : "",
    number,
    set: (sib && sib.set) || (group ? (lang === "ja" ? jpSetTitle(group.name) : group.name) : setId),
    setId,
    setLogo: (sib && sib.setLogo) || "", setSymbol: (sib && sib.setSymbol) || "",
    setTotal: (sib && sib.setTotal) || total || "",
    setReleaseDate: (sib && sib.setReleaseDate) || (group && String(group.publishedOn || "").slice(0, 10)) || "",
    setSerieId: (sib && sib.setSerieId) || "", setSerieName: (sib && sib.setSerieName) || "",
    artist: "", rarity: String(rarity || ""), language: lang,
    image: img,
    // Variantes = impressões vendidas (ordem canônica); sem informação, Normal.
    variants: (variants && variants.length) ? VARIANTS.filter((v) => variants.includes(v))
      : (price && price.v ? VARIANTS.filter((v) => price.v[v] > 0) : ["Normal"]),
    _new: true
  };
  if (price && price.u > 0) card.price = price;
  return card;
}
