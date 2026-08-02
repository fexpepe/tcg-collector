// Helpers compartilhados dos scripts de sync/build de catálogo. Sem dependências.
// Cada jogo novo deve custar ~1 arquivo pequeno usando estas peças.
import { writeFile, readFile, mkdir, rm } from "node:fs/promises";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch com retry/backoff (rede/429/5xx). Lança no esgotamento.
export async function fetchRetry(url, { headers = {}, tries = 4, timeoutMs = 30000 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const signal = (typeof AbortSignal !== "undefined" && AbortSignal.timeout) ? AbortSignal.timeout(timeoutMs) : undefined;
      const r = await fetch(url, { headers, signal });
      if (r.ok) return r;
      last = new Error(`HTTP ${r.status} em ${url}`);
      if (r.status < 500 && r.status !== 429) throw last; // 4xx (menos 429): não adianta repetir
    } catch (e) { last = e; }
    await sleep(1000 * (i + 1));
  }
  throw last;
}

// map com concorrência limitada (ordem preservada).
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function slug(s) {
  return String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Entidades HTML comuns + strip de tags (parsers de wiki).
export const decodeEntities = (s) => String(s || "")
  .replace(/&#8217;|&#39;|&rsquo;/g, "'").replace(/&amp;/g, "&").replace(/&#8211;|&#8212;/g, "-")
  .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

// Nome de arquivo seguro pro Windows: CON/AUX/PRN/NUL/COM1-9/LPT1-9 são nomes
// de DISPOSITIVO reservados — o git (core.protectNTFS) recusa versioná-los e o
// checkout quebra em Windows. Ex.: o set "Conspiracy" do Magic tem código
// "con". Sufixa com "_" (mesma regra no mirror e no sync, pra os caminhos
// baterem). Case-insensitive (o Windows não distingue CON de con).
const WIN_RESERVED = /^(con|aux|prn|nul|com[0-9]|lpt[0-9])$/i;
export function winSafeName(name) {
  return WIN_RESERVED.test(name) ? name + "_" : name;
}

// Lê um window.<var> de um arquivo data/*.js (formato dos catálogos).
export async function readGlobalVar(fileUrl, varName) {
  try {
    const t = await readFile(fileUrl, "utf8");
    const g = { window: {} };
    new Function("window", t)(g.window);
    return g.window[varName];
  } catch { return null; }
}

// Índices padrão (sets/artists) a partir das cartas — formato que o front consome.
export function buildSetIndexes(cards) {
  const bySet = new Map();
  const byArtist = new Map();
  for (const c of cards) {
    if (!bySet.has(c.set)) bySet.set(c.set, []);
    bySet.get(c.set).push(c.id);
    if (c.artist) {
      if (!byArtist.has(c.artist)) byArtist.set(c.artist, []);
      byArtist.get(c.artist).push(c.id);
    }
  }
  return {
    sets: [...bySet.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name)),
    artists: [...byArtist.entries()].map(([name, cardIds]) => ({ name, cardIds })).sort((a, b) => a.name.localeCompare(b.name))
  };
}

// Escreve o catálogo completo de um jogo, nos DOIS modos que o front conhece:
//   dev  -> cards.js/indexes.js/pricing.js (versionados; catálogo inteiro)
//   prod -> manifest.generated.js = window.TCG_MANIFEST (só a LISTA de sets) +
//           chunks por set em <dir>/sets/<slug>.json + indexes/pricing .generated
// Antes o manifest.generated era uma CÓPIA integral do cards.js: toda página de
// Lorcana/One Piece parseava o catálogo inteiro (One Piece = 3,6MB de JS). Com o
// manifest real, os loaders do shared.js (game-agnósticos, provados no Pokémon)
// baixam só os chunks necessários.
// Índices FATIADOS por chave. O indexes.js junto tem ~800KB no Pokémon
// (pokedex 234 + sets 236 + artists 243 + trainers 83), mas NENHUMA página usa
// mais de uma ou duas chaves: sets.html só quer `sets`, artists.html só
// `artists`, e as telas de coleção/portfólio só `sets`. Baixar as quatro em
// todas as páginas era o maior peso do caminho crítico.
//
// Cada fatia faz `(window.TCG_INDEXES = window.TCG_INDEXES || {}).<k> = ...`,
// então as fatias COMPÕEM entre si e com o arquivo junto (que continua sendo
// gerado — o caminho multi-jogo do loadGameCatalog ainda o usa). Nenhum
// consumidor muda: quem lê `indexes.sets` continua lendo `indexes.sets`.
//
// O game.js pede uma fatia com o token `indexes:<chave>` no data-catalog.
export const INDEX_KEYS = ["pokedex", "trainers", "sets", "artists", "pokemonTotals"];

// Nome de arquivo da fatia (pokemonTotals vira "totals" pra casar com o token
// `indexes:totals` do data-catalog).
//
// .json e NÃO .js: o navegador roda JSON.parse em vez de parse+compile+execute
// de JavaScript, que é bem mais caro pro mesmo payload (o JSON.parse do V8 é um
// caminho especializado; um literal de objeto passa pelo parser da linguagem
// inteira). Na fatia do Magic são 1,4 MB, e isso pesa no celular.
// Deu pra fazer sem migração porque as fatias nasceram já assim.
export const indexSliceFile = (key, generated) =>
  `indexes-${key === "pokemonTotals" ? "totals" : key}${generated ? ".generated" : ""}.json`;

// Conteúdo exato da fatia. Usado tanto pela escrita quanto pelo --check do
// split-indexes.mjs, pra os dois nunca divergirem.
export function indexSliceBody(key, value) {
  // Chave ausente vira arquivo VAZIO de propósito, não 404: o 404 custaria um
  // round-trip em toda página do jogo (só o Pokémon tem pokedex/trainers).
  const fallback = key === "pokemonTotals" ? {} : [];
  return JSON.stringify(value === undefined ? fallback : value) + "\n";
}

// `only` limita a qual família escrever ("dev" = indexes-X.js, "generated" =
// indexes-X.generated.js). O padrão escreve as duas com o mesmo conteúdo, que é
// o caso da maioria dos jogos; no Pokémon o .generated é o merge de idiomas e
// difere do dev, então o split-indexes.mjs chama uma vez por família.
export async function writeSplitIndexes(outDirUrl, idx, { only } = {}) {
  for (const k of INDEX_KEYS) {
    const body = indexSliceBody(k, idx && idx[k]);
    if (only !== "generated") await writeFile(new URL(indexSliceFile(k, false), outDirUrl), body, "utf8");
    if (only !== "dev") await writeFile(new URL(indexSliceFile(k, true), outDirUrl), body, "utf8");
  }
}

// ── Manifest ENRIQUECIDO ────────────────────────────────────────────────────
// A LISTA de sets precisa, por set: logo, símbolo, data, série, total oficial e
// o valor de mercado. Tudo isso ou é METADADO DE SET (idêntico em toda carta do
// set) ou é uma SOMA. Enquanto viveu só dentro das cartas, desenhar a lista
// custava baixar o catálogo inteiro do jogo — 43 MB e 647 requisições no Magic,
// 29 MB e 452 no Pokémon, antes do primeiro tile aparecer. Passa a viajar no
// manifest, que a página já baixa de qualquer jeito (~100 KB).
//
// O valor vai SEPARADO POR MOEDA DE ORIGEM (vb=BRL/MYP, vu=USD, ve=EUR) porque
// é assim que o cliente converte: cada carta escolhe sua fonte pela MESMA
// precedência do cardValue (BR > USD > EUR) e o câmbio entra depois, na moeda
// que a pessoa escolheu. `vn` = quantas cartas do set ficaram sem preço nenhum.
export const basePricingId = (id) => String(id || "").replace(/-(pt|ja|zh-cn|zh-tw|zh)$/, "");

export function setValueBuckets(cards, pricing) {
  const table = pricing || {};
  let vb = 0, vu = 0, ve = 0, vn = 0;
  for (const card of cards) {
    const ref = table[card.id] || table[basePricingId(card.id)];
    if (!ref) { vn++; continue; }
    const variant = (card.variants && card.variants[0]) || "Normal";
    const usd = /foil/i.test(variant) && ref.uf > 0 ? ref.uf : ref.u;
    if (ref.b && ref.b.md > 0) vb += ref.b.md;
    else if (usd > 0) vu += usd;
    else if (ref.e > 0) ve += ref.e;
    else vn++;
  }
  const round = (n) => Math.round(n * 100) / 100;
  const out = {};
  if (vb) out.vb = round(vb);
  if (vu) out.vu = round(vu);
  if (ve) out.ve = round(ve);
  if (vn) out.vn = vn;
  return out;
}

// Metadados de set + somas, a partir das cartas do próprio chunk. `sample` é
// qualquer carta dele (os campos set* se repetem em todas).
export function setManifestMeta(chunkCards, pricing) {
  const sample = chunkCards[0] || {};
  const meta = { total: sample.setTotal || chunkCards.length };
  if (sample.setLogo) meta.logo = sample.setLogo;
  if (sample.setSymbol) meta.symbol = sample.setSymbol;
  if (sample.setReleaseDate) meta.release = sample.setReleaseDate;
  if (sample.setSerieId) meta.serieId = sample.setSerieId;
  if (sample.setSerieName) meta.serieName = sample.setSerieName;
  return Object.assign(meta, setValueBuckets(chunkCards, pricing));
}

export async function writeGameCatalog(outDirUrl, { cards, indexes, pricing, webDir }) {
  await mkdir(outDirUrl, { recursive: true });
  const w = (name, varName, value) => writeFile(new URL(name, outDirUrl), `window.${varName} = ${JSON.stringify(value)};\n`, "utf8");
  const idx = indexes || buildSetIndexes(cards);
  await w("cards.js", "TCG_CARDS", cards);
  await w("indexes.js", "TCG_INDEXES", idx);
  await w("indexes.generated.js", "TCG_INDEXES", idx);
  await writeSplitIndexes(outDirUrl, idx);
  await w("pricing.js", "TCG_PRICING", pricing || {});
  await w("pricing.generated.js", "TCG_PRICING", pricing || {});

  // Caminho do diretório NA URL DO SITE (o manifest.file é fetch()ado pelo
  // navegador da raiz): explícito via webDir ou inferido do path físico.
  const dir = webDir || (() => {
    const m = decodeURIComponent(outDirUrl.pathname).match(/\/(data\/.*)$/);
    return m ? m[1].replace(/\/?$/, "/") : "data/";
  })();

  // Um chunk por setId (arquivo = slug; colisão pós-slug ganha sufixo). O
  // diretório é recriado do zero pra não sobrar chunk órfão de set removido.
  const bySet = new Map();
  for (const c of cards) {
    const key = String(c.setId || c.set || "sem-set");
    if (!bySet.has(key)) bySet.set(key, []);
    bySet.get(key).push(c);
  }
  const setsDir = new URL("sets/", outDirUrl);
  await rm(setsDir, { recursive: true, force: true });
  await mkdir(setsDir, { recursive: true });
  const used = new Set();
  const manifestSets = [];
  for (const [setId, chunk] of bySet) {
    // Nome do chunk seguro pro Windows via winSafeName (CON/AUX/PRN/NUL/COM/LPT
    // são dispositivos reservados — ex.: Conflux do Magic = "con", que trava o
    // checkout/git no Windows; o CI Linux gera, mas o pull/rebase local quebra).
    // O manifest.file carrega o nome, então o cliente (que busca só por .file)
    // segue idêntico e o setId nos dados não muda.
    let f = winSafeName(slug(setId) || "set"), i = 2;
    const base = f;
    while (used.has(f)) f = `${base}-${i++}`;
    used.add(f);
    await writeFile(new URL(`${f}.json`, setsDir), JSON.stringify(chunk), "utf8");
    manifestSets.push(Object.assign({
      id: setId, name: chunk[0].set || String(setId), count: chunk.length,
      language: chunk[0].language || "en", file: `${dir}sets/${f}.json`
    }, setManifestMeta(chunk, pricing)));
  }
  await w("manifest.generated.js", "TCG_MANIFEST", { generatedAt: new Date().toISOString(), sets: manifestSets });

  // Índice de BUSCA (search-index.json): só o necessário pra achar a carta —
  // sem texto, sem imagem, sem preço. O construtor de decks precisa varrer nomes
  // do jogo inteiro; sem isto ele baixaria TODOS os chunks (Yu-Gi-Oh! tem 46k
  // cartas, Magic 97k). Achou a carta, aí sim baixa só o chunk dela.
  // Chaves curtas de propósito: o arquivo é servido a cada abertura do editor.
  //   i=id · n=nome · s=set · u=número · t=tipo · c=custo · k=cor · r=raridade
  // Set/tipo/raridade/cor repetem muito (um set name aparece em centenas de
  // cartas). Vão em DICIONÁRIO e a carta guarda só o índice — sem isso o arquivo
  // do Magic passaria de 10 MB. O cliente re-expande ao carregar.
  const COLOR_FIELDS = ["ink", "opColor", "color", "colorId", "types", "attribute"];
  const dicts = { s: [], t: [], r: [], k: [] };
  const dictPos = { s: new Map(), t: new Map(), r: new Map(), k: new Map() };
  const put = (key, value) => {
    const v = String(value);
    let i = dictPos[key].get(v);
    if (i === undefined) { i = dicts[key].length; dicts[key].push(v); dictPos[key].set(v, i); }
    return i;
  };
  const entries = cards.map((c) => {
    const e = { i: c.id, n: c.name };
    if (c.set) e.s = put("s", c.set);
    if (c.number) e.u = String(c.number);
    if (c.cardType != null && c.cardType !== "") e.t = put("t", c.cardType);
    if (c.cost != null && c.cost !== "") e.c = c.cost;          // numérico: não vale dicionário
    if (c.rarity) e.r = put("r", c.rarity);
    // Cor tem nome diferente por jogo (ink/opColor/color/types…): normaliza numa
    // chave só, senão o filtro do editor teria que conhecer cada jogo.
    for (const f of COLOR_FIELDS) { if (c[f] != null && c[f] !== "") { e.k = put("k", c[f]); break; } }
    return e;
  });
  await writeFile(new URL("search-index.json", outDirUrl), JSON.stringify({ d: dicts, c: entries }), "utf8");
}

// União preservadora: cartas do catálogo ANTERIOR que sumiram do novo são
// mantidas (append no fim). Carta indexada nunca some — API removeu = congela.
export function preserveMissingCards(previousCards, newCards) {
  const have = new Set((newCards || []).map((c) => c && c.id).filter(Boolean));
  return (previousCards || []).filter((c) => c && c.id && !have.has(c.id));
}

// Snapshot versionado (fontes-fã frágeis): lê/escreve data/vintage/<nome>.json.
// A regra de ouro: o build SEMPRE parte do snapshot; o fetch da fonte só
// ATUALIZA o snapshot quando responde e não regride (menos cartas = suspeito).
export async function readSnapshot(fileUrl) {
  try { return JSON.parse(await readFile(fileUrl, "utf8")); } catch { return null; }
}
export async function writeSnapshot(fileUrl, snap) {
  await mkdir(new URL("./", fileUrl), { recursive: true });
  await writeFile(fileUrl, JSON.stringify(snap, null, 1), "utf8");
}
export function snapshotCardCount(snap) {
  return (snap && snap.sets || []).reduce((n, s) => n + (s.cards ? s.cards.length : 0), 0);
}
