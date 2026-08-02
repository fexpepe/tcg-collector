// Gera o SQL que carrega o banco da API na borda (D1) a partir do MESMO
// catálogo que o build já monta (manifest + chunks por set, de cada jogo).
// Não existe segunda fonte de verdade: o banco é uma projeção dos chunks.
//
// Saída: out/d1.sql (recria as tabelas do zero — a carga é sempre total, e o
// deploy-d1.mjs decide SE carrega comparando o hash gravado em `meta`).
//
// Campos por carta: os do search-index.json (id/nome/set/número/tipo/custo/
// raridade/cor) — o contrato que o editor de decks já consome. Imagem e preço
// ficam FORA de propósito: o cliente já hidrata os resultados exibidos pelos
// chunks (≤60 cartas), e preço muda toda semana — recarregar o banco inteiro
// por causa dele multiplicaria as cargas sem servir à busca.
//
// Uso: node scripts/build-d1.mjs   (escreve out/d1.sql e imprime o hash)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { cardRows, SCHEMA } from "../functions/api/_search-sql.js";

const RAIZ = new URL("../", import.meta.url);
const JOGOS = [
  ["pokemon", "data/"], ["lorcana", "data/lorcana/"], ["onepiece", "data/onepiece/"],
  ["magic", "data/magic/"], ["fab", "data/fab/"], ["gundam", "data/gundam/"],
  ["dbfw", "data/dbfw/"], ["ygo", "data/ygo/"], ["digimon", "data/digimon/"],
  ["riftbound", "data/riftbound/"], ["naruto", "data/naruto/"], ["hxh", "data/hxh/"],
  ["jump", "data/jump/"]
];

async function leManifest(dir) {
  try {
    const t = await readFile(new URL(`${dir}manifest.generated.js`, RAIZ), "utf8");
    return JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;\s*$/, ""));
  } catch { return null; }
}

const aspas = (v) => `'${String(v).replace(/'/g, "''")}'`;

const linhas = [];
linhas.push("PRAGMA defer_foreign_keys = on;");
// Recria do zero: catálogo é substituição total, nunca merge.
linhas.push("DROP TABLE IF EXISTS cards;", "DROP TABLE IF EXISTS card_words;", "DROP TABLE IF EXISTS meta;");
linhas.push(SCHEMA.trim());

let totalCartas = 0, totalPalavras = 0, jogosOk = 0;
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
      .map((c) => `(${[c.game, c.id, c.name, c.set_name, c.number, c.card_type, c.cost, c.rarity, c.color].map(aspas).join(",")})`);
    linhas.push(`INSERT INTO cards (game,id,name,set_name,number,card_type,cost,rarity,color) VALUES\n${lote.join(",\n")};`);
  }
  for (let i = 0; i < words.length; i += 800) {
    const lote = words.slice(i, i + 800).map((w) => `(${aspas(w.game)},${aspas(w.word)},${aspas(w.id)})`);
    linhas.push(`INSERT INTO card_words (game,word,id) VALUES\n${lote.join(",\n")};`);
  }
  totalCartas += cards.length;
  totalPalavras += words.length;
  jogosOk++;
  console.log(`  ${game}: ${cards.length} cartas, ${words.length} palavras`);
}

if (!jogosOk) {
  console.error("build-d1: nenhum manifest com cartas — o catálogo não foi construído?");
  process.exit(1);
}

// O hash entra no PRÓPRIO SQL (tabela meta): quem importa grava junto, e o
// deploy-d1 compara com o remoto pra pular cargas idênticas.
const corpo = linhas.join("\n");
const hash = createHash("sha256").update(corpo).digest("hex").slice(0, 16);
const sql = `${corpo}\nINSERT INTO meta (k, v) VALUES ('hash', ${aspas(hash)}), ('geradoEm', ${aspas(new Date().toISOString())});\n`;

await mkdir(new URL("out/", RAIZ), { recursive: true });
await writeFile(new URL("out/d1.sql", RAIZ), sql, "utf8");
console.log(`build-d1: ${jogosOk} jogos · ${totalCartas} cartas · ${totalPalavras} palavras · ${(sql.length / 1048576).toFixed(1)} MB · hash ${hash}`);
