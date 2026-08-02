// Gera o SQL que carrega o banco da API na borda (D1) a partir do MESMO
// catálogo que o build já monta (manifest + chunks por set, de cada jogo).
// Não existe segunda fonte de verdade: o banco é uma projeção dos chunks.
//
// Saídas SEPARADAS, cada uma com seu hash em `meta`:
//   out/d1-cards.sql  — cartas + palavras de busca (muda quando o catálogo muda)
//   out/d1-prices.sql — tabela de preços (muda a cada sync, de 2 em 2 dias)
// Separar não é capricho: juntos, um ajuste de preço obrigaria a reescrever as
// 236 mil cartas e os 2,3 milhões de palavras a cada dois dias. O deploy-d1
// compara os dois hashes e recarrega só o que mudou.
//
// A carta leva o que a BUSCA usa (nome/set/número/tipo/custo/raridade/cor) e o
// que a COLEÇÃO usa (setId/artista/idioma/imagem/variantes/lançamento) — é o
// que permite o /api/collection devolver as cartas de quem coleciona sem o
// cliente baixar os chunks inteiros dos sets.
//
// Uso: node scripts/build-d1.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { cardRows, SCHEMA, SCHEMA_PRICES } from "../functions/api/_search-sql.js";

const RAIZ = new URL("../", import.meta.url);
const JOGOS = [
  ["pokemon", "data/"], ["lorcana", "data/lorcana/"], ["onepiece", "data/onepiece/"],
  ["magic", "data/magic/"], ["fab", "data/fab/"], ["gundam", "data/gundam/"],
  ["dbfw", "data/dbfw/"], ["ygo", "data/ygo/"], ["digimon", "data/digimon/"],
  ["riftbound", "data/riftbound/"], ["naruto", "data/naruto/"], ["hxh", "data/hxh/"],
  ["jump", "data/jump/"]
];

async function leGlobal(caminho) {
  try {
    const t = await readFile(new URL(caminho, RAIZ), "utf8");
    return JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;\s*$/, ""));
  } catch { return null; }
}
const leManifest = (dir) => leGlobal(`${dir}manifest.generated.js`);

const aspas = (v) => `'${String(v).replace(/'/g, "''")}'`;
const AGORA = new Date().toISOString();

// ── Cartas + palavras ───────────────────────────────────────────────────────
const linhas = [];
linhas.push("PRAGMA defer_foreign_keys = on;");
// Recria do zero: catálogo é substituição total, nunca merge. `meta` NÃO é
// derrubada aqui — ela guarda também o hash dos preços, que tem vida própria.
linhas.push("DROP TABLE IF EXISTS cards;", "DROP TABLE IF EXISTS card_words;");
linhas.push(SCHEMA.trim());

const COLUNAS = ["game", "id", "name", "set_name", "number", "card_type", "cost", "rarity",
  "color", "set_id", "artist", "language", "image", "variants", "released"];

let totalCartas = 0, totalPalavras = 0, jogosOk = 0;
// Preços coletados no MESMO passeio (o manifest e os chunks já estão abertos).
const precos = [];
for (const [game, dir] of JOGOS) {
  const manifest = await leManifest(dir);
  if (!manifest || !Array.isArray(manifest.sets) || !manifest.sets.length) continue;
  const vistos = new Set();
  const cards = [], words = [];
  for (const entrada of manifest.sets) {
    if (!entrada.file) continue;
    let cartas;
    try { cartas = JSON.parse(await readFile(new URL(entrada.file, RAIZ), "utf8")); } catch { continue; }
    for (const carta of cartas) {
      if (!carta || !carta.id || vistos.has(carta.id)) continue;
      vistos.add(carta.id);
      const { linha, words: ws } = cardRows(game, carta);
      cards.push(linha);
      words.push(...ws);
    }
  }
  if (!cards.length) continue;
  // INSERTs em lote (multi-values): o d1 execute processa statement a
  // statement — um INSERT por carta seriam 200k round-trips de parse.
  for (let i = 0; i < cards.length; i += 400) {
    const lote = cards.slice(i, i + 400)
      .map((c) => `(${COLUNAS.map((k) => aspas(c[k])).join(",")})`);
    linhas.push(`INSERT INTO cards (${COLUNAS.join(",")}) VALUES\n${lote.join(",\n")};`);
  }
  for (let i = 0; i < words.length; i += 800) {
    const lote = words.slice(i, i + 800).map((w) => `(${aspas(w.game)},${aspas(w.word)},${aspas(w.id)})`);
    linhas.push(`INSERT INTO card_words (game,word,id) VALUES\n${lote.join(",\n")};`);
  }
  totalCartas += cards.length;
  totalPalavras += words.length;
  jogosOk++;
  console.log(`  ${game}: ${cards.length} cartas, ${words.length} palavras`);

  // Preços: o monólito do jogo, entrada por entrada, guardado como JSON
  // verbatim — o cliente recebe o mesmo objeto que um chunk daria.
  const tabela = (await leGlobal(`${dir}pricing.generated.js`)) || (await leGlobal(`${dir}pricing.js`)) || {};
  for (const id of Object.keys(tabela)) {
    if (tabela[id] == null) continue;
    precos.push({ game, id, j: JSON.stringify(tabela[id]) });
  }
}

if (!jogosOk) {
  console.error("build-d1: nenhum manifest com cartas — o catálogo não foi construído?");
  process.exit(1);
}

await mkdir(new URL("out/", RAIZ), { recursive: true });

// O hash entra no PRÓPRIO SQL (tabela meta): quem importa grava junto, e o
// deploy-d1 compara com o remoto pra pular cargas idênticas.
const corpo = linhas.join("\n");
const hash = createHash("sha256").update(corpo).digest("hex").slice(0, 16);
const sqlCards = `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);\n${corpo}\n`
  + `INSERT INTO meta (k, v) VALUES ('hash', ${aspas(hash)}), ('geradoEm', ${aspas(AGORA)})\n`
  + `  ON CONFLICT(k) DO UPDATE SET v = excluded.v;\n`;
await writeFile(new URL("out/d1-cards.sql", RAIZ), sqlCards, "utf8");

// ── Preços (arquivo e hash próprios) ────────────────────────────────────────
const pl = [];
pl.push("DROP TABLE IF EXISTS prices;");
pl.push(SCHEMA_PRICES.trim());
for (let i = 0; i < precos.length; i += 500) {
  const lote = precos.slice(i, i + 500).map((p) => `(${aspas(p.game)},${aspas(p.id)},${aspas(p.j)})`);
  pl.push(`INSERT INTO prices (game,id,j) VALUES\n${lote.join(",\n")};`);
}
const corpoP = pl.join("\n");
const hashP = createHash("sha256").update(corpoP).digest("hex").slice(0, 16);
const sqlPrices = `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);\n${corpoP}\n`
  + `INSERT INTO meta (k, v) VALUES ('hashPrices', ${aspas(hashP)}), ('precosEm', ${aspas(AGORA)})\n`
  + `  ON CONFLICT(k) DO UPDATE SET v = excluded.v;\n`;
await writeFile(new URL("out/d1-prices.sql", RAIZ), sqlPrices, "utf8");

console.log(`build-d1: ${jogosOk} jogos · ${totalCartas} cartas · ${totalPalavras} palavras · ${(sqlCards.length / 1048576).toFixed(1)} MB · hash ${hash}`);
console.log(`build-d1: ${precos.length} preços · ${(sqlPrices.length / 1048576).toFixed(1)} MB · hash ${hashP}`);
