// Nomes das cartas vintage de Naruto: japonês -> inglês.
//
// POR QUE ISTO EXISTE. O One Piece vintage chega em inglês porque a fonte dele
// (Grand Line Wiki) é em inglês. As linhas de Naruto vêm de fontes japonesas
// (tcg-db, Suruga-ya, noihjp), então 1.797 cartas chegam com nome em kana/kanji
// — ilegível pra quase todo mundo que usa o site, e impossível de buscar.
//
// POR QUE UM PASSO SEPARADO, e não dentro de cada sync: são TRÊS scripts que
// alimentam o catálogo do Naruto (vintage, datacarddass, cross-formation).
// Traduzir em cada um significaria manter o mesmo mapa em três lugares. Aqui
// roda uma vez, depois de todos, sobre o catálogo pronto. O Miracle Battle
// também usa o mapa, mas no próprio sync: desde 2026-10-01 ele é o jogo mbc,
// fora do catálogo do Naruto.
//
// POR QUE EM BUILD, e não em runtime: um mapa de ~800 nomes no shared.js
// custaria ~40 KB em TODA página do site, inclusive nas que não têm Naruto.
// Assado no catálogo, ele viaja só no chunk que já seria baixado.
//
// IDEMPOTENTE: a chave de busca é `nameJp || name`. Depois da primeira rodada o
// `name` já é inglês, mas o `nameJp` guarda o original — então rodar de novo
// (ou rodar sobre o snapshot versionado) encontra a mesma chave e não degrada.
// É isso que permite o passo conviver com o snapshot que o build versiona.
//
// O ORIGINAL NÃO SE PERDE: vai pro campo `nameJp`, que a busca já varre (então
// procurar "うずまきナルト" continua achando) e que a interface mostra em
// "Nome original" ao abrir a carta.
//
// Roda com: node scripts/translate-naruto-names.mjs
import { readFile, writeFile } from "node:fs/promises";
import { readGlobalVar, writeGameCatalog } from "./lib/sync-common.mjs";
import { traduzSet } from "./lib/naruto-nomes.mjs";

const dataDir = new URL("../data/naruto/", import.meta.url);
const mapFile = new URL("data/naruto-names-en.json", import.meta.url);

let mapa = {};
try {
  mapa = JSON.parse(await readFile(mapFile, "utf8"));
} catch (e) {
  console.warn(`translate-naruto-names: sem ${mapFile.pathname} — nada a fazer.`);
  process.exit(0);
}

const cards = await readGlobalVar(new URL("cards.js", dataDir), "TCG_CARDS");
if (!Array.isArray(cards) || !cards.length) {
  console.warn("translate-naruto-names: catálogo do Naruto vazio — pulando.");
  process.exit(0);
}

const temCjk = (s) => /[぀-ヿ一-鿿]/.test(String(s || ""));
let traduzidas = 0;
let semTraducao = new Set();
for (const c of cards) {
  const jp = c.nameJp || c.name;
  if (!temCjk(jp)) continue;
  const en = mapa[jp];
  if (!en) { semTraducao.add(jp); continue; }
  c.nameJp = jp;
  c.name = en;
  traduzidas++;
}

// O NOME DO SET também (14/11/2026, decisão do Fernando): os 75 sets japoneses
// apareciam em kanji no seletor de set, no tile e no modal, que mostram o
// `set` cru — só a lista de Sets e a página do set usavam o nome de exibição.
// Mesma régua das cartas: `set` vira o inglês do VINTAGE_SET_EN e o original
// vai pro `setJp` (a busca e a página do set o mostram). O endereço do set sai
// do nome, então ele muda: o registra-cartas-movidas, logo adiante no deploy,
// compara com o catálogo publicado e grava o 301 em
// data/sets-renomeados-auto.json (docs/CATALOGO.md, 3.2).
const setsTraduzidos = new Set();
const setsSemTraducao = new Set();
for (const c of cards) {
  if (traduzSet(c)) setsTraduzidos.add(c.setId);
  else if (temCjk(c.setJp || c.set)) setsSemTraducao.add(`${c.setId} (${c.set})`);
}

// Reescreve o catálogo INTEIRO (cards + chunks + índices + search-index): sem
// isso o nome novo ficaria só no cards.js e a busca/grade continuariam com o
// japonês, porque elas leem os artefatos derivados.
const indexes = await readGlobalVar(new URL("indexes.js", dataDir), "TCG_INDEXES");
const pricing = await readGlobalVar(new URL("pricing.js", dataDir), "TCG_PRICING");
await writeGameCatalog(dataDir, { cards, indexes, pricing, webDir: "data/naruto/" });

const pendentes = [...semTraducao];
console.log(`translate-naruto-names: ${traduzidas} cartas com nome em inglês; ${pendentes.length} nomes ainda sem tradução.`);
if (pendentes.length) console.log(`  faltando (10 primeiros): ${pendentes.slice(0, 10).join(" · ")}`);
console.log(`translate-naruto-names: ${setsTraduzidos.size} sets com nome em inglês; ${setsSemTraducao.size} sem tradução no VINTAGE_SET_EN.`);
if (setsSemTraducao.size) console.log(`  sets faltando: ${[...setsSemTraducao].join(" · ")}`);
