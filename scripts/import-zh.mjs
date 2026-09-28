// Passo do deploy: transforma o cache versionado da Bulbapedia
// (data/zh-import/<setId>.json, baixado LOCAL pelo sync-bulbapedia-zh.mjs) nas
// cartas do catálogo CHINÊS SIMPLIFICADO e grava
// data/zh-newcards.generated.json — o merge-catalogs injeta como faz com as
// cartas novas da TCGCSV/PPT (set sem chunk vira chunk novo; set com chunk
// ganha só o id que falta), com `prov: "bulbapedia"` (id escolhido por nós).
// A regra é pura e testada em scripts/lib/bulbapedia-zh.mjs; aqui é só o fs.
//
// IMAGEM: a carta chinesa usa a arte da impressão EN (ou JA) de que é
// reimpressão, casada pelo set + número que a página do wiki dá (ver
// arteDe). Por isso roda DEPOIS do sync-tcgdex/tcgcsv/enrich-ja (que montam
// os chunks EN/JA) e ANTES do merge. Sem rede; não derruba o build.
//
// Set que a TCGdex já publica com cartas (o chunk zh-cn tem carta SEM `prov`)
// fica de fora inteiro: a fonte do catálogo manda, e misturar numerações das
// duas fontes no mesmo set criaria duplicata. Hoje é só o CSMPiC.
//
//   node scripts/import-zh.mjs             # grava o artefato
//   node scripts/import-zh.mjs --dry-run   # só conta
import { readdir, readFile, writeFile } from "node:fs/promises";
import { montarCarta, indiceArte, arteDe, escolherImpressao, expandirImpressoes, tipoDoSet, LANG } from "./lib/bulbapedia-zh.mjs";

const RAIZ = new URL("../", import.meta.url);
const DATA = new URL("data/", RAIZ);
const CACHE = new URL("data/zh-import/", RAIZ);
const DRY = process.argv.includes("--dry-run");

async function leJson(url, padrao) { try { return JSON.parse(await readFile(url, "utf8")); } catch { return padrao; } }
async function arquivos(url) { try { return (await readdir(url)).filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort(); } catch { return []; } }

const setsZh = [];
for (const f of await arquivos(CACHE)) {
  const c = await leJson(new URL(f, CACHE), null);
  if (c && c.set && c.set.id && Array.isArray(c.cards)) setsZh.push(c);
}
if (!setsZh.length) {
  console.log("import-zh: sem cache em data/zh-import — nada a fazer.");
  process.exit(0);
}

// dexId por nome de espécie (PokéAPI), o mesmo mapa do sync-tcgcsv-pokemon.
const nomes = await readFile(new URL("pokemon-names.js", DATA), "utf8").catch(() => "");
const mNomes = nomes.match(/=\s*(\{[\s\S]*\});?\s*$/);
const revNames = {};
for (const [dex, nome] of Object.entries(mNomes ? JSON.parse(mNomes[1]) : {})) revNames[String(nome).toLowerCase()] = Number(dex);

// Índice de arte: chunks EN pelo nome do set; chunks JA pelo nome inglês da
// página da Bulbapedia (o cache do enrich-ja guarda qual página é de qual set).
const en = [];
for (const f of await arquivos(new URL("sets/en/", DATA))) {
  const cards = await leJson(new URL(`sets/en/${f}`, DATA), []);
  if (cards.length) en.push({ name: cards[0].set, cards });
}
const ja = [];
for (const f of await arquivos(new URL("ja-enrich/", DATA))) {
  const e = await leJson(new URL(`ja-enrich/${f}`, DATA), null);
  const page = e && e.page ? String(e.page).replace(/\s*\(TCG\)$/, "") : "";
  if (!page) continue;
  const cards = await leJson(new URL(`sets/ja/${f}`, DATA), []);
  if (cards.length) ja.push({ name: page, cards });
}
const idx = indiceArte({ en, ja });

const saida = [];
const pulados = [];
let comImagem = 0, deEn = 0, deJa = 0;
for (const { page, set, cards } of setsZh) {
  // A TCGdex já tem o set com cartas: ela manda.
  const chunk = await leJson(new URL(`sets/${LANG}/${set.id}.json`, DATA), []);
  if (chunk.some((c) => c && c.id && !c.prov)) { pulados.push(set.id); continue; }
  const logo = `data/set-logos/${LANG}/${set.id}.webp`;
  const temLogo = await readFile(new URL(logo, RAIZ)).then(() => true, () => false);
  const cab = { ...set, logo: temLogo ? logo : "", kind: tipoDoSet(page) };
  const vistos = new Map();
  for (const raw of cards) {
    const imp = escolherImpressao(expandirImpressoes(raw.prints), raw.rarity, { promo: /-PC$/.test(set.id) });
    const arte = imp ? arteDe(imp, idx) : null;
    const n = (vistos.get(raw.number) || 0) + 1;
    vistos.set(raw.number, n);
    const card = montarCarta(raw, cab, { arte, revNames, sufixo: n > 1 ? String(n) : "" });
    if (card.image) { comImagem++; if (arte.de === "en") deEn++; else deJa++; }
    saida.push(card);
  }
}

const pct = (x) => (saida.length ? Math.round((x / saida.length) * 100) : 0);
console.log(`import-zh: ${setsZh.length - pulados.length} set(s), ${saida.length} carta(s) — imagem ${pct(comImagem)}% (${deEn} da impressão EN, ${deJa} da JA)`
  + (pulados.length ? ` · pulados (a TCGdex já tem): ${pulados.join(", ")}` : ""));
if (!DRY) await writeFile(new URL("zh-newcards.generated.json", DATA), JSON.stringify(saida), "utf8");
