// NARUTO da KAYOU (卡游), edição em inglês: as cartas colecionáveis chinesas do
// Naruto, que a Kayou vende na China desde 2021 e passou a lançar em inglês na
// América do Norte em setembro de 2025. Não é jogo de mesa: é coleção, em
// caixas por série (Heaven Scroll, Earth Scroll, Chapter Jin, Ninja Age), com
// uma escada de raridades que é o assunto dos colecionadores. Jogo próprio
// (`narutokayou`), a pedido do Fernando em 2026-11-12 ("Sim, jogos próprios").
//
// O QUE ENTRA: só a edição em inglês, a que tem fonte oficial. A linha chinesa
// original (umas 2.900 cartas, 2021 em diante) só tem lista em site de fã, e o
// que achei esconde os dados de propósito pra não serem copiados: fica de
// fora. As séries em inglês são reimpressões das ondas chinesas (o Heaven
// Scroll 1 é o Tier 4 Wave 6, por exemplo), com código próprio.
//
// FONTE: o site oficial, kayouofficial.com/en-US/series/<id>. Cada página de
// série traz no próprio HTML (o payload do Next.js, sem API e sem login) as
// cartas com código impresso, nome, raridade e imagem, a tabela de raridades
// da série e a data de lançamento de cada caixa. O site não tem robots.txt
// (404) nem termos que proíbam leitura. Conferido em 2026-11-12: 8 séries,
// 1.188 cartas, todas com imagem (PNG de 733×1029 pra cima).
//
// ID: "nky-<série>-<código>", com o código impresso em minúsculas
// (NRSA01-SE-001L5 -> nky-hs1-nrsa01-se-001l5). A série entra no id porque o
// site repete código entre séries: as 4 Creative Rare do Earth Scroll 3 estão
// lá como NRI01-CR-00x, o mesmo das do Earth Scroll 1 (erro da fonte, mantido
// no número até ela corrigir). O "◇" que marca a paralela não é ASCII: sai do
// meio e vira "-par" no fim (NRSA03-◇UR-001L5 -> …-nrsa03-ur-001l5-par).
//
// SÉRIES: pinadas no SERIES pelo id da página, com o setId fixo. Série nova
// entra quando o id dela for posto aqui; o sync avisa das que achar no índice
// do site e não conhecer. Data: a mais antiga entre as caixas da série, com a
// precisão que a fonte dá (mês).
//
// RARIDADE: a sigla impressa (R, SR, SSR, UR, PTR, HR, PU, AR, MR, BP, CR, QR,
// XR, SP, ASP, SE, e as paralelas com ◇), que é como a coleção é falada. O
// nome por extenso muda de série pra série no próprio site (SSR é "Super
// Secret Rare" no Heaven Scroll e "Super Spark Rare" no Earth Scroll; AR é
// "Amber Rare" ou "Artist Rare"), então não dá um nome único por sigla.
//
// IMAGEM: a do site oficial, que traz a marca "KAYOU" em mosaico bem clara,
// posta pela própria fabricante (o mesmo caso do SAMPLE da Bandai). Os PNG têm
// de 1,5 a 7,6 MB: passam pelo wsrv.nl, como os scans do vintage, e daí pro
// espelho. Carta deitada (as peças de cena, 1029×733) vem deitada.
//
// SEM PREÇO: o TCGplayer não tem a linha (TCGCSV conferida em 2026-11-12).
//
// Padrão FAB: data/narutokayou/cards.js versionado, sync no build completo,
// carta que a fonte tirar fica congelada.
//
//   node scripts/sync-narutokayou.mjs
import { fileURLToPath } from "node:url";
import { readGlobalVar, writeGameCatalog, preserveMissingCards, sleep } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const GAME = "narutokayou";
const OUT = new URL(`data/${GAME}/`, ROOT);
const SITE = "https://www.kayouofficial.com/en-US/series/";
const HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)", Accept: "text/html" };

// id da página -> chave do set (o setId é "nky-<chave>"). Ordem de lançamento.
export const SERIES = [
  { id: "series-5zdty4vj", key: "hs1" }, // Heaven Scroll Series 1 (09/2025)
  { id: "series-jj9iw6u0", key: "cj2" }, // Chapter Jin Series 2 (11/2025)
  { id: "series-ldbindyv", key: "es1" }, // Earth Scroll Series 1 (12/2025)
  { id: "series-8idoe481", key: "es2" }, // Earth Scroll Series 2 (03/2026)
  { id: "series-cv8e3pgi", key: "cj3" }, // Chapter Jin Series 3 (04/2026)
  { id: "series-0nyket49", key: "na" },  // Ninja Age Premium Collector Box (08/2026)
  { id: "series-md6xr8u7", key: "es3" }, // Earth Scroll Series 3 (10/2026)
  { id: "series-05l5tw1o", key: "cj4" }  // Chapter Jin Series 4 (11/2026)
];

// Junta os pedaços do payload do Next.js (self.__next_f.push([1,"…"])).
const MARCA = "self.__next_f.push([1,";
export function rscDe(html) {
  let out = "";
  let pos = 0;
  for (;;) {
    const i = html.indexOf(MARCA, pos);
    if (i < 0) break;
    const ini = i + MARCA.length;
    const fim = html.indexOf("])</script>", ini);
    if (fim < 0) break;
    try { out += JSON.parse(html.slice(ini, fim)); } catch { /* pedaço que não é string */ }
    pos = fim;
  }
  return out;
}

// O objeto que vem depois de `chave` ("detail":{…}), achando a chave que fecha
// fora de string. Devolve o objeto lido ou null.
export function objetoEm(txt, chave) {
  const i = txt.indexOf(chave);
  if (i < 0) return null;
  const p = txt.indexOf("{", i);
  if (p < 0) return null;
  let nivel = 0, emStr = false;
  for (let k = p; k < txt.length; k++) {
    const ch = txt[k];
    if (emStr) {
      if (ch === "\\") k++;
      else if (ch === '"') emStr = false;
    } else if (ch === '"') emStr = true;
    else if (ch === "{") nivel++;
    else if (ch === "}") {
      nivel--;
      if (!nivel) { try { return JSON.parse(txt.slice(p, k + 1)); } catch { return null; } }
    }
  }
  return null;
}

export const detalheDaPagina = (html) => objetoEm(rscDe(String(html || "")), '"detail":{');

// O site escreve o losango da paralela como entidade em alguns campos.
export const limpa = (s) => String(s == null ? "" : s).replace(/&#x25C7;/gi, "◇").replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();

const MESES = { January: "01", February: "02", March: "03", April: "04", May: "05", June: "06", July: "07", August: "08", September: "09", October: "10", November: "11", December: "12" };
// "September 2025" -> "2025-09"; o que não for mês e ano fica vazio.
export function dataDe(txt) {
  const m = /^([A-Z][a-z]+) (\d{4})$/.exec(limpa(txt));
  return m && MESES[m[1]] ? `${m[2]}-${MESES[m[1]]}` : "";
}

// A data da série: a mais antiga entre as caixas (cada "edition" é uma caixa).
export function dataDaSerie(d) {
  const datas = ((d && d.editions) || [])
    .map((e) => dataDe(((e.productSpecs || []).find((p) => p.label === "Release Date") || {}).value))
    .filter(Boolean)
    .sort();
  return datas[0] || "";
}

// "NRSA03-◇UR-001L5" -> "nrsa03-ur-001l5-par"; só [a-z0-9-] sobra.
export function slugDoCodigo(codigo) {
  const c = limpa(codigo);
  const paralela = c.includes("◇");
  const s = c.replace(/◇/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s ? (paralela ? `${s}-par` : s) : "";
}

const IMG = (url) => {
  const limpo = String(url || "").replace(/^https?:\/\//, "");
  return limpo ? `https://wsrv.nl/?url=${encodeURIComponent(limpo)}&w=440&output=webp` : "";
};

// Uma série (o "detail" da página) -> cartas do catálogo, na ordem do site.
// Carta sem código não entra (sem ele não há id estável); código repetido
// DENTRO da série ganha -2, -3… na ordem do site.
export function cartasDaSerie(d, key) {
  const set = limpa(`${d.seriesTypeName || ""} ${d.title || ""}`);
  const setId = `nky-${key}`;
  const data = dataDaSerie(d);
  const usados = new Map();
  const cards = [];
  let semCodigo = 0;
  for (const c of [...(d.cards || [])].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))) {
    const slug = slugDoCodigo(c.idCode);
    if (!slug) { semCodigo++; continue; }
    const n = (usados.get(slug) || 0) + 1;
    usados.set(slug, n);
    cards.push({
      id: `${setId}-${slug}${n > 1 ? `-${n}` : ""}`,
      name: limpa(c.name),
      set,
      setId,
      number: limpa(c.idCode),
      setTotal: 0,
      setReleaseDate: data,
      rarity: limpa(c.rarity),
      artist: "",
      language: "en",
      image: IMG(c.image),
      variants: ["Normal"],
      setLogo: ""
    });
  }
  for (const c of cards) c.setTotal = cards.length;
  return { cards, semCodigo };
}

async function baixa(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(60000) });
      if (r.ok) return await r.text();
      if (r.status < 500 && r.status !== 429) return null;
    } catch { /* tenta de novo */ }
    await sleep(2000 * (i + 1));
  }
  return null;
}

async function run() {
  console.log("NARUTO Kayou (edição em inglês): lendo as séries do site oficial…");
  const prev = (await readGlobalVar(new URL("cards.js", OUT), "TCG_CARDS")) || [];
  const cards = [];
  const conhecidas = new Set(SERIES.map((s) => s.id));
  const outras = new Set();
  let falhas = 0;
  for (const s of SERIES) {
    const html = await baixa(SITE + s.id);
    const d = html ? detalheDaPagina(html) : null;
    if (!d || !Array.isArray(d.cards) || !d.cards.length) { falhas++; console.log(`  ${s.id} (${s.key}): inacessível ou sem cartas`); continue; }
    const { cards: doSet, semCodigo } = cartasDaSerie(d, s.key);
    cards.push(...doSet);
    console.log(`  nky-${s.key} ${doSet[0].set}: ${doSet.length} cartas${semCodigo ? ` (${semCodigo} sem código ficaram de fora)` : ""}`);
    // Outras séries que a página linka: se alguma for nova, o log diz.
    for (const m of html.matchAll(/series-[a-z0-9]{8}/g)) if (!conhecidas.has(m[0])) outras.add(m[0]);
    await sleep(600); // educado com o site
  }
  if (outras.size) console.warn(`  AVISO: série(s) no site que o SERIES não conhece: ${[...outras].join(", ")} (pode ser de outra marca; se for Naruto, pinar).`);
  if (!cards.length) { console.log(`  nenhuma série respondeu — segue com o catálogo versionado (${prev.length} cartas).`); return; }
  // Série que falhou e carta que a fonte tirou ficam como estavam.
  const congeladas = preserveMissingCards(prev, cards);
  const merged = cards.concat(congeladas);
  console.log(`Total: ${merged.length} cartas (${merged.filter((c) => c.image).length} com imagem${congeladas.length ? `; ${congeladas.length} mantidas do catálogo anterior` : ""}${falhas ? `; ${falhas} série(s) sem resposta` : ""}).`);
  await writeGameCatalog(OUT, { cards: merged, pricing: {}, webDir: `data/${GAME}/` });
  console.log(`Gravado em ${fileURLToPath(OUT)}.`);
}

// Importável pelos testes sem rodar o sync (ver tests/narutokayou-sync.test.mjs).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
