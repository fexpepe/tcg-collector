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
  ["riftbound", "data/riftbound/"], ["unionarena", "data/unionarena/"],
  ["naruto", "data/naruto/"], ["hxh", "data/hxh/"],
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

// O D1 recusa statement acima de ~100 KB (SQLITE_TOOBIG) — e foi exatamente
// isso que derrubou a primeira carga com os campos novos: um lote fixo de 400
// cartas cabia quando a linha só tinha nome e número, e estourou quando ganhou
// URL de imagem, artista e variantes. Fatiar por BYTES em vez de por contagem
// resolve de uma vez: qualquer campo que cresça no futuro só faz o lote ficar
// menor, nunca inválido.
const TETO_STATEMENT = 60 * 1024;   // folga generosa sobre o limite do D1
function insertsEmLotes(prefixo, valores) {
  const out = [];
  let lote = [], tamanho = 0;
  const fecha = () => {
    if (!lote.length) return;
    out.push(`${prefixo} VALUES\n${lote.join(",\n")};`);
    lote = []; tamanho = 0;
  };
  for (const v of valores) {
    // +2 pela vírgula e quebra de linha entre valores.
    if (tamanho && tamanho + v.length + 2 > TETO_STATEMENT) fecha();
    lote.push(v);
    tamanho += v.length + 2;
  }
  fecha();
  return out;
}

// ── Cartas + palavras ───────────────────────────────────────────────────────
// Carga em tabelas SOMBRA (cards_new/card_words_new) + troca atômica no fim.
// O DROP-e-reinsere de antes deixava a busca respondendo VAZIO (200 {c:[]})
// pelos minutos que a carga leva — e o cliente mostrava "nenhum resultado"
// pra qualquer pessoa que buscasse durante um deploy. Com a sombra, quem
// consulta vê a geração ANTERIOR inteira até o último instante; a janela sem
// tabela são os 4 statements de metadados da troca lá no fim.
//
// O SCHEMA continua a fonte única (Function e testes leem dele): aqui ele é
// reescrito pra apontar pras sombras. Índices ficam pra DEPOIS dos INSERTs
// (carga em massa sem manutenção de índice) e ganham sufixo de GERAÇÃO: nome
// de índice é global no SQLite e sobrevive ao RENAME da tabela — um nome fixo
// colidiria com o da geração anterior (ainda vivo na tabela em produção) e o
// IF NOT EXISTS pularia a criação em silêncio, deixando a tabela nova SEM
// índice (busca virando varredura de 2,3M linhas, cobrada linha a linha no D1).
// O sufixo sai do hash dos DADOS: catálogo igual = SQL byte a byte igual, e o
// deploy-d1 continua pulando cargas idênticas.
const stmtsSchema = SCHEMA.trim().split(";").map((s) => s.trim()).filter(Boolean);
const paraSombra = (s) => s.replace(/\bcards\b/g, "cards_new").replace(/\bcard_words\b/g, "card_words_new");
const linhas = [];
linhas.push("PRAGMA defer_foreign_keys = on;");
// Sobra de uma carga interrompida: dropar a sombra derruba junto os índices dela.
linhas.push("DROP TABLE IF EXISTS cards_new;", "DROP TABLE IF EXISTS card_words_new;");
// `meta` NÃO é derrubada em canto nenhum — ela guarda também o hash dos
// preços, que tem vida própria. Aqui entram só as tabelas (índices no fim).
linhas.push(...stmtsSchema.filter((s) => !/^CREATE INDEX/i.test(s)).map((s) => `${paraSombra(s)};`));

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
  linhas.push(...insertsEmLotes(
    `INSERT INTO cards_new (${COLUNAS.join(",")})`,
    cards.map((c) => `(${COLUNAS.map((k) => aspas(c[k])).join(",")})`)
  ));
  linhas.push(...insertsEmLotes(
    "INSERT INTO card_words_new (game,word,id)",
    words.map((w) => `(${aspas(w.game)},${aspas(w.word)},${aspas(w.id)})`)
  ));
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

// Índices da sombra (ver o bloco lá em cima): depois dos INSERTs, com o
// sufixo de geração derivado dos dados.
const geracao = createHash("sha256").update(linhas.join("\n")).digest("hex").slice(0, 8);
const indicesSombra = stmtsSchema.filter((s) => /^CREATE INDEX/i.test(s))
  .map((s) => paraSombra(s).replace(/(idx_\w+?) ON/, `$1_${geracao} ON`));
// Recarga MANUAL do mesmo catálogo (mesma geração): o índice homônimo ainda
// vive na tabela em produção e o IF NOT EXISTS pularia a criação — a sombra
// entraria em produção SEM índice. Dropar antes garante; no fluxo normal
// (geração nova) é no-op, e no manual a produção só fica sem índice pelos
// segundos entre este DROP e a troca.
indicesSombra.forEach((s) => linhas.push(`DROP INDEX IF EXISTS ${s.match(/(idx_\w+) ON/)[1]};`));
linhas.push(...indicesSombra.map((s) => `${s};`));
// A TROCA: a única janela sem tabela `cards`/`card_words` são estes 4
// statements. O RENAME leva os índices junto (com o nome da geração — por isso
// o sufixo). As tabelas da geração anterior morrem aqui, índices e tudo.
linhas.push(
  "DROP TABLE IF EXISTS cards;",
  "DROP TABLE IF EXISTS card_words;",
  "ALTER TABLE cards_new RENAME TO cards;",
  "ALTER TABLE card_words_new RENAME TO card_words;"
);

// O hash entra no PRÓPRIO SQL (tabela meta): quem importa grava junto, e o
// deploy-d1 compara com o remoto pra pular cargas idênticas.
const corpo = linhas.join("\n");
const hash = createHash("sha256").update(corpo).digest("hex").slice(0, 16);
const sqlCards = `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);\n${corpo}\n`
  + `INSERT INTO meta (k, v) VALUES ('hash', ${aspas(hash)}), ('geradoEm', ${aspas(AGORA)})\n`
  + `  ON CONFLICT(k) DO UPDATE SET v = excluded.v;\n`;
await writeFile(new URL("out/d1-cards.sql", RAIZ), sqlCards, "utf8");

// ── Preços (arquivo e hash próprios) ────────────────────────────────────────
// Mesma sombra + troca das cartas: sem ela, o /api/collection respondia
// coleção SEM preço durante os minutos da recarga. Só a PK, sem índice extra —
// a troca dispensa o sufixo de geração.
const pl = [];
pl.push("DROP TABLE IF EXISTS prices_new;");
pl.push(SCHEMA_PRICES.trim().replace(/\bprices\b/g, "prices_new"));
pl.push(...insertsEmLotes(
  "INSERT INTO prices_new (game,id,j)",
  precos.map((p) => `(${aspas(p.game)},${aspas(p.id)},${aspas(p.j)})`)
));
pl.push("DROP TABLE IF EXISTS prices;", "ALTER TABLE prices_new RENAME TO prices;");
const corpoP = pl.join("\n");
const hashP = createHash("sha256").update(corpoP).digest("hex").slice(0, 16);
const sqlPrices = `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);\n${corpoP}\n`
  + `INSERT INTO meta (k, v) VALUES ('hashPrices', ${aspas(hashP)}), ('precosEm', ${aspas(AGORA)})\n`
  + `  ON CONFLICT(k) DO UPDATE SET v = excluded.v;\n`;
await writeFile(new URL("out/d1-prices.sql", RAIZ), sqlPrices, "utf8");

// Guarda: statement grande demais é recusado pelo D1 (SQLITE_TOOBIG) — e a
// carga falha DEPOIS de subir o arquivo, no meio do deploy. Falhar aqui, no
// build, é barato e não deixa a API meio carregada.
const LIMITE_D1 = 100 * 1024;
for (const [nome, sql] of [["d1-cards.sql", sqlCards], ["d1-prices.sql", sqlPrices]]) {
  let pior = 0;
  for (const stmt of sql.split(";\n")) if (stmt.length > pior) pior = stmt.length;
  if (pior > LIMITE_D1) {
    console.error(`build-d1: ${nome} tem statement de ${(pior / 1024).toFixed(0)} KB — acima do limite de ${LIMITE_D1 / 1024} KB do D1.`);
    process.exit(1);
  }
  console.log(`build-d1: ${nome} — maior statement ${(pior / 1024).toFixed(0)} KB (limite ${LIMITE_D1 / 1024} KB).`);
}

console.log(`build-d1: ${jogosOk} jogos · ${totalCartas} cartas · ${totalPalavras} palavras · ${(sqlCards.length / 1048576).toFixed(1)} MB · hash ${hash}`);
console.log(`build-d1: ${precos.length} preços · ${(sqlPrices.length / 1048576).toFixed(1)} MB · hash ${hashP}`);
