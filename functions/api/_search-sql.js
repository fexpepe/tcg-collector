// Normalização e SQL da busca de cartas — compartilhado entre a Function
// (/api/search, rodando em D1) e o teste local (node:sqlite). Um lugar só,
// senão o teste passaria numa query e a produção rodaria outra.
//
// Modelo: cada nome de carta vira palavras normalizadas em `card_words`
// (game, word, id) com índice — a busca é PREFIXO por palavra ("char liz"
// acha Charizard via char* ∩ liz*). LIKE 'x%' usa o índice; um LIKE '%x%'
// varreria a tabela inteira, e no D1 linha varrida é linha COBRADA — 150k
// linhas por tecla digitada estourava a cota grátis em minutos.
//
// CUIDADO (aprendido na prática): a otimização de prefixo do LIKE só liga com
// as DUAS condições — coluna `word` COLLATE NOCASE (o LIKE é case-insensitive
// por padrão, e sobre coluna BINARY o SQLite se recusa a virar range de
// índice) e SEM cláusula ESCAPE (ela desliga a otimização por completo).
// Faltando qualquer uma, o plano degrada em silêncio pra varredura: a global
// lia 1,7M linhas POR PALAVRA digitada — ~5 buscas estouravam a cota diária
// grátis do D1 (5M leituras), a API passava a responder erro e o site inteiro
// caía no caminho lento. O teste do plano em tests/ trava as duas condições.

// Mesma régua do normalize do shared.js (minúsculas, sem acento latino) dos
// DOIS lados da busca. Divide por qualquer coisa que não seja letra OU dígito
// UNICODE — não [a-z0-9]: um split ascii jogava fora os nomes japoneses e
// chineses inteiros (リザードン virava zero palavras e as cartas JA/ZH ficavam
// inbuscáveis, sendo que a busca do cliente as acha). A faixa de acentos
// removida é SÓ a latina (U+0300–U+036F): o dakuten do kana fica, e fica dos
// dois lados — consistência importa mais que a forma. \p{M} na classe de
// palavra pelo MESMO motivo: o NFD decompõe ザ em サ + dakuten combinante, e
// sem as marcas o split cortava リザードン no meio (a marca virava separador).
export function palavras(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter(Boolean);
}

// Esquema das CARTAS (recarregado só quando o catálogo muda).
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS cards (
  game TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  set_name TEXT,
  number TEXT,
  card_type TEXT,
  cost TEXT,
  rarity TEXT,
  color TEXT,
  set_id TEXT,
  artist TEXT,
  language TEXT,
  image TEXT,
  variants TEXT,
  released TEXT,
  PRIMARY KEY (game, id)
);
CREATE TABLE IF NOT EXISTS card_words (
  game TEXT NOT NULL,
  word TEXT NOT NULL COLLATE NOCASE,
  id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_card_words ON card_words (game, word, id);
CREATE INDEX IF NOT EXISTS idx_words_global ON card_words (word, game, id);
`;

// Esquema dos PREÇOS — tabela SEPARADA de propósito: o preço muda a cada sync
// (a cada 2 dias) e o catálogo quase nunca. Juntos, um ajuste de preço obrigaria
// a reescrever as 236 mil cartas e os 2,3 milhões de palavras; separados, cada
// um tem seu hash em `meta` e só recarrega o que mudou.
// `j` é a entrada de preço INTEIRA em JSON, verbatim do pricing.generated.js —
// não uma projeção coluna a coluna. É o que garante que o cliente receba
// exatamente o que receberia de um chunk (u, uf, e, b.md, g por nota…) e que a
// fórmula do valor (cardValue) continue existindo em UM lugar só.
export const SCHEMA_PRICES = `
CREATE TABLE IF NOT EXISTS prices (
  game TEXT NOT NULL,
  id TEXT NOT NULL,
  j TEXT NOT NULL,
  PRIMARY KEY (game, id)
);
`;

// Query de busca: interseção dos conjuntos de ids de cada palavra-prefixo,
// depois as cartas. SEM cláusula ESCAPE, de propósito (ver o aviso lá em
// cima): ela desligava o índice, e é dispensável porque palavras() só deixa
// passar letra/dígito/marca — nenhum termo contém %, _ ou \ pra escapar.
// LIMIT no chamador via parâmetro.
//
// game "all" = busca GLOBAL (o Explorar): a interseção passa a ser por
// (game, id) — id sozinho poderia colidir entre jogos — usando o índice
// idx_words_global (word na frente). Uma consulta só pros 13 jogos, em vez de
// 13 requisições por tecla digitada.
// Palavras-função caem ANTES da consulta: "the%" tem mais de 2000 linhas, o
// LIMIT do operando devolve um subconjunto ARBITRÁRIO delas e a interseção
// perde cartas que existem — "The One Ring" voltava VAZIO da borda. O cliente
// já fazia isso só no fillPrints (shared.js); aqui TODO chamador herda (decks,
// listas, cards, explore). Mesmo conjunto do cliente. Se a consulta é SÓ de
// stopwords ("the"), segue com elas — é o que a pessoa digitou.
const STOP = new Set(["the", "of", "a", "an", "and", "to", "de", "da", "do", "la", "el"]);

export function buildSearch(game, consulta, limite) {
  const todas = palavras(consulta);
  const uteis = todas.filter((w) => !STOP.has(w));
  const termos = (uteis.length ? uteis : todas).slice(0, 5); // 5 palavras bastam; mais = abuso
  if (!termos.length) return null;
  // Gate de 2 caracteres, espelhando o cliente (que já não busca com menos).
  // Sem ele, ?q=a caía no ramo de 1 char e o LIKE 'a%' varria o índice; iterar
  // a..z com game=all esgotava a cota de leitura do D1. Aqui a borda também barra.
  if (termos.join("").length < 2) return null;
  const global = game === "all";
  // Cada operando do INTERSECT é embrulhado num LIMIT 2000: teto de linhas LIDAS
  // por termo (no D1 linha lida é linha COBRADA — não a devolvida). Não muda o
  // resultado prático: o INTERSECT já afunila e o SELECT externo corta em ~40.
  const sub = termos
    .map(() => global
      ? `SELECT game, id FROM (SELECT game, id FROM card_words WHERE word LIKE ? LIMIT 2000)`
      : `SELECT id FROM (SELECT id FROM card_words WHERE game = ?1 AND word LIKE ? LIMIT 2000)`)
    .join("\nINTERSECT\n");
  const alvo = global ? `(game, id) IN` : `game = ?1 AND id IN`;
  // image/released no SELECT: a lista de IMPRESSÕES do popup da carta precisa
  // dos dois (miniatura no hover e ordenação por lançamento). Ler as colunas a
  // mais não custa linha no D1 (a cobrança é por linha lida, e a linha já era
  // lida pela PK) — quem decide se elas VÃO na resposta é o &img=1 do search.js,
  // pra busca do editor de decks seguir nos poucos KB de sempre.
  const sql = `SELECT game, id, name, set_name, number, card_type, cost, rarity, color, image, released
FROM cards WHERE ${alvo} (\n${sub}\n) LIMIT ${Math.max(1, Math.min(100, limite | 0 || 40))}`;
  const likes = termos.map((t) => t + "%");
  const params = global ? likes : [game, ...likes];
  return { sql, params };
}

// Mesma régua do shared.js: a carta localizada (-pt, -ja, -zh-tw…) não tem
// preço próprio e cai na referência da carta BASE. Repetido aqui (e não
// importado) porque a Function roda na borda, sem o bundle do cliente — o
// teste tests/collection-api.test.mjs trava as duas cópias no mesmo resultado.
export function basePricingId(cardId) {
  return String(cardId || "").replace(/-(pt|ja|zh-cn|zh-tw|zh)$/, "");
}

// D1 aceita no máximo 100 parâmetros por statement: o chamador fatia os ids
// nesse tamanho e junta as respostas. Fatia menor que o teto de propósito —
// sobra pro parâmetro do jogo.
export const LOTE_IDS = 90;

const COLUNAS_CARTA = "id, name, set_name, number, card_type, cost, rarity, color, set_id, artist, language, image, variants, released";

// Cartas de uma lista de ids (um jogo). Sem LIKE nem varredura: PK (game, id).
export function buildCards(game, ids) {
  if (!ids || !ids.length) return null;
  const marcas = ids.map(() => "?").join(",");
  return {
    sql: `SELECT ${COLUNAS_CARTA} FROM cards WHERE game = ? AND id IN (${marcas})`,
    params: [game, ...ids]
  };
}

// Ids que o preço precisa: os pedidos MAIS os ids BASE — a mesma inclusão que
// o split-pricing faz nos chunks. Sem os base, a carta -pt voltaria sem preço e
// o total sairia menor que o da tela que usa chunk. A expansão acontece ANTES
// do fatiamento (senão um lote de 90 viraria 180 parâmetros e estouraria).
export function idsComBase(ids) {
  return [...new Set((ids || []).flatMap((id) => [id, basePricingId(id)]))];
}

// Preços de uma lista de ids JÁ expandida por idsComBase.
export function buildPrices(game, ids) {
  if (!ids || !ids.length) return null;
  const marcas = ids.map(() => "?").join(",");
  return {
    sql: `SELECT id, j FROM prices WHERE game = ? AND id IN (${marcas})`,
    params: [game, ...ids]
  };
}

// Linhas de uma carta pro banco (usado pelo build do SQL e pelos testes).
// Espelha os campos do search-index.json (i/n/s/u/t/c/r/k) — é o contrato que
// o editor de decks já consome, então a troca do cliente não muda forma.
const COLOR_FIELDS = ["ink", "opColor", "color", "colorId", "types", "attribute"];
export function cardRows(game, card) {
  let color = "";
  for (const f of COLOR_FIELDS) {
    if (card[f] != null && card[f] !== "") { color = String(card[f]); break; }
  }
  const linha = {
    game, id: card.id, name: card.name || "",
    set_name: card.set || "", number: String(card.number || ""),
    card_type: card.cardType != null ? String(card.cardType) : "",
    cost: card.cost != null ? String(card.cost) : "",
    rarity: card.rarity || "", color,
    // Campos que a COLEÇÃO precisa (não a busca): sem eles a carta volta do
    // /api/collection sem imagem, sem variante e sem agrupamento por artista —
    // e a variante é o que decide de qual preço a cópia vale (foil × normal).
    set_id: card.setId || "", artist: card.artist || "",
    language: card.language || "", image: card.image || "",
    variants: JSON.stringify(card.variants || []),
    released: card.setReleaseDate || ""
  };
  // Palavras de busca: nome + SET + NÚMERO + ARTISTA — o mesmo alcance do
  // haystack do cliente (cardSearchHaystack), pra "pika 58", "pikachu jungle"
  // e "arita" acharem pela borda igual acham pelo caminho estático. O número
  // ganha a forma compacta pela mesma regra do shared ("H01" -> "h1").
  // Dedupe por carta ("Mega Mega Punch" não precisa de duas linhas).
  const num = String(card.number || "");
  const numCompact = num.replace(/([a-zA-Z]+)0+(\d)/, "$1$2");
  const unicas = new Set();
  for (const fonte of [card.name, card.set, num, numCompact === num ? "" : numCompact, card.artist]) {
    for (const w of palavras(fonte)) unicas.add(w);
  }
  return { linha, words: [...unicas].map((w) => ({ game, word: w, id: card.id })) };
}
