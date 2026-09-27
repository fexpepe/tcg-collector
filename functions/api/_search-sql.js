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

// Esquema das CARTAS. `h`/`hw` são as impressões digitais da linha e das
// palavras (scripts/lib/d1-delta.mjs): o deploy compara as remotas com as do
// catálogo local e grava SÓ as cartas que mudaram — no D1 grátis a cota é de
// 100 mil linhas ESCRITAS por dia, e a recarga total (2,3M de linhas mais os
// índices, 6,8M de escritas) estourava a cota todo santo dia. A Function não
// lê as duas colunas. idx_words_id existe pra apagar as palavras de uma carta
// pelo id sem varrer as palavras do jogo inteiro (varredura é linha lida, e
// linha lida é cobrada).
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
  h TEXT,
  hw TEXT,
  PRIMARY KEY (game, id)
);
CREATE TABLE IF NOT EXISTS card_words (
  game TEXT NOT NULL,
  word TEXT NOT NULL COLLATE NOCASE,
  id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_card_words ON card_words (game, word, id);
CREATE INDEX IF NOT EXISTS idx_words_global ON card_words (word, game, id);
CREATE INDEX IF NOT EXISTS idx_words_id ON card_words (game, id);
`;

// Esquema dos PREÇOS — tabela SEPARADA de propósito: o preço muda a cada sync
// (a cada 2 dias) e o catálogo quase nunca. Juntos, um ajuste de preço obrigaria
// a reescrever as 236 mil cartas e os 2,3 milhões de palavras; separados, cada
// um tem seu hash em `meta` e só recarrega o que mudou.
// `j` é a entrada de preço INTEIRA em JSON, verbatim do pricing.generated.js —
// não uma projeção coluna a coluna. É o que garante que o cliente receba
// exatamente o que receberia de um chunk (u, uf, e, b.md, g por nota…) e que a
// fórmula do valor (cardValue) continue existindo em UM lugar só.
// `h` é a impressão digital de `j`, pela mesma razão das cartas: o deploy grava
// só os preços que mudaram.
export const SCHEMA_PRICES = `
CREATE TABLE IF NOT EXISTS prices (
  game TEXT NOT NULL,
  id TEXT NOT NULL,
  j TEXT NOT NULL,
  h TEXT,
  PRIMARY KEY (game, id)
);
`;

// Query de busca: cada palavra da consulta é um OPERANDO (as cartas que têm
// uma palavra começando por ela), e a carta entra se aparece em TODOS. SEM
// cláusula ESCAPE, de propósito (ver o aviso lá em cima): ela desligava o
// índice, e é dispensável porque palavras() só deixa passar letra/dígito/marca
// — nenhum termo contém %, _ ou \ pra escapar.
//
// game "all" = busca GLOBAL (o Explorar): a interseção passa a ser por
// (game, id) — id sozinho poderia colidir entre jogos — usando o índice
// idx_words_global (word na frente). Uma consulta só pros 13 jogos, em vez de
// 13 requisições por tecla digitada.
// Palavras-função caem ANTES da consulta: "the%" são 42 mil linhas só de
// cartas com "The" no nome ou no set, e não dizem nada sobre a carta que se
// procura. O cliente já fazia isso só no fillPrints (shared.js); aqui TODO
// chamador herda (decks, listas, cards, explore). Mesmo conjunto do cliente.
// Se a consulta é SÓ de stopwords ("the"), segue com elas — é o que a pessoa
// digitou.
export const STOP = new Set(["the", "of", "a", "an", "and", "to", "de", "da", "do", "la", "el"]);

// Teto de linhas LIDAS por operando (no D1 linha lida é linha cobrada). Até
// 27/09/2026 era 2.000 (6.000 no numérico) e o teto CORTAVA a resposta: o
// LIMIT do operando devolve as primeiras linhas do índice (word, game, id) —
// na global, os jogos em ordem alfabética —, e a interseção perdia tudo o que
// ficou depois do corte. Medido no catálogo inteiro: "charizard ex" achava 55
// de 110 cartas ("ex%" são 11,5 mil linhas), "dark magician" 115 de 296, e
// "blue eyes" voltava VAZIO — "blue%" tem 3,4 mil linhas e o Yu-Gi-Oh!, o
// último jogo em ordem alfabética, nunca entrava no recorte. 50 mil cobre a
// maior palavra de verdade do catálogo ("commander", 17 mil) com folga; só
// prefixo de duas letras ("en", 80 mil) ainda bate no teto — e quem busca
// "en" não está atrás de uma carta. Desde 10/09/2026 a conta está no Workers
// Paid (25 bilhões de leituras/mês): o pior caso razoável, uns 60 mil linhas
// por consulta, é troco — e a resposta vai pro cache de borda.
export const TETO_OPERANDO = 50000;
// Resposta: até 100 cartas na busca de digitação (decks, listas, scanner) e
// até 10 mil no modo COMPLETO (o Explorar, &full=1) — que é o que faz a busca
// global mostrar TODAS as cartas: "dragon", a maior busca de nome de verdade
// do catálogo, são 8,3 mil. Comprimida, a resposta completa dá ~200 KB.
export const LIMITE_PADRAO = 40;
export const LIMITE_CURTO = 100;
export const LIMITE_COMPLETO = 10000;

// O D1 recusa padrão de LIKE acima de 50 BYTES ("LIKE or GLOB pattern too
// complex") — e 17 caracteres de kana já são 51 bytes em UTF-8. Uma busca por
// nome japonês longo derrubava a consulta inteira com erro, e o cliente, lendo
// o 500 como "borda fora", baixava o catálogo completo. O prefixo é cortado
// (na fronteira de caractere) pra caber: acha um SUPERconjunto do que
// procurava, nunca menos — e a igualdade da palavra exata (o `x` da
// relevância) segue com o termo inteiro, que não tem esse teto.
const BYTES_LIKE = 49; // + o "%"
const utf8 = new TextEncoder();
export function prefixoLike(termo) {
  const chars = Array.from(String(termo || ""));
  while (chars.length > 1 && utf8.encode(chars.join("")).length > BYTES_LIKE) chars.pop();
  return chars.join("") + "%";
}

// Escritas de um termo SÓ de dígitos: sem zeros à esquerda e zero-preenchido
// a 3 (a largura impressa). "009" e "9" são o mesmo número de carta — o
// Pokémon moderno guarda "009", o antigo "9", e quem digita usa qualquer um.
// Mesma régua do numberSearchForms do shared.js (o teste trava as duas).
export function formasNumericas(termo) {
  const t = String(termo || "");
  if (!/^\d+$/.test(t)) return [t];
  const puro = String(parseInt(t, 10));
  return [...new Set([t, puro, puro.padStart(3, "0")])];
}

// Termos da consulta como a borda os usa: palavras normalizadas, sem
// palavra-função, sem repetição, no máximo 5. Exportado pro teste e pra
// quem quiser saber quantos termos a relevância (`x`) conta.
export function termosDaBusca(consulta) {
  const todas = palavras(consulta);
  const uteis = todas.filter((w) => !STOP.has(w));
  // Set: termo REPETIDO ("mega mega", ou o nome que aparece no nome e no set)
  // virava dois operandos idênticos — mesmo resultado, o DOBRO de linhas lidas
  // (e linha lida é linha cobrada no D1).
  return [...new Set(uteis.length ? uteis : todas)].slice(0, 5); // 5 palavras bastam; mais = abuso
}

// `opts.completo` (o &full=1 do Explorar): aceita limite até LIMITE_COMPLETO.
// Sem ele o teto segue 100 — decks, listas e scanner buscam por tecla digitada
// e mostram poucas linhas.
export function buildSearch(game, consulta, limite, opts) {
  const termos = termosDaBusca(consulta);
  if (!termos.length) return null;
  // Gate de 2 caracteres, espelhando o cliente (que já não busca com menos).
  // Sem ele, ?q=a caía no ramo de 1 char e o LIKE 'a%' varria o índice; iterar
  // a..z com game=all esgotava a cota de leitura do D1. Aqui a borda também barra.
  if (termos.join("").length < 2) return null;
  const global = game === "all";
  const teto = opts && opts.completo ? LIMITE_COMPLETO : LIMITE_CURTO;
  const lim = Math.max(1, Math.min(teto, limite | 0 || LIMITE_PADRAO));
  // Parâmetros NUMERADOS (?1, ?2…) em todo lugar: o jogo (?1) aparece em cada
  // operando e no join, e misturar ?1 com ? anônimo dependia da ordem em que
  // os dois aparecem no texto.
  const params = [];
  const p = (v) => `?${params.push(v)}`;
  const pJogo = global ? "" : p(game);
  // Cada operando devolve (game, id, e): as cartas que têm alguma palavra
  // casando com o termo, e `e` = 1 se uma delas é a palavra EXATA. A soma dos
  // `e` é o `x` da resposta — quantos termos casaram como palavra inteira — e
  // é o que põe "Mew" antes de "Mewtwo" numa busca por "mew", inclusive na
  // carta japonesa (nome ミュウ, palavra "mew" vinda do nameEn), que o cliente
  // não teria como ranquear pelo nome.
  //
  // Termo NUMÉRICO ("009", "94", o "9" de "9/94") casa por IGUALDADE nas suas
  // escritas (word IN ('9','009')), não por prefixo: quem digita um número
  // quer aquele número — "9" por prefixo trazia 9, 90-99 e 900-999. Termo de
  // UMA letra também: "charizard x" quer a palavra X (Mega Charizard X), e
  // "x%" seriam milhares de linhas (xatu, xerneas…) sem relação com a busca.
  const selJogo = global ? "game, id" : "id";
  const ondeJogo = global ? "" : `game = ${pJogo} AND `;
  const operando = (t) => {
    if (/^\d+$/.test(t) || Array.from(t).length === 1) {
      const formas = /^\d+$/.test(t) ? formasNumericas(t) : [t];
      return `SELECT ${selJogo}, 1 AS e FROM (SELECT ${selJogo} FROM card_words WHERE ${ondeJogo}word IN (${formas.map(p).join(",")}) LIMIT ${TETO_OPERANDO}) GROUP BY ${selJogo}`;
    }
    const exato = p(t);
    return `SELECT ${selJogo}, MAX(word = ${exato}) AS e FROM (SELECT ${selJogo}, word FROM card_words WHERE ${ondeJogo}word LIKE ${p(prefixoLike(t))} LIMIT ${TETO_OPERANDO}) GROUP BY ${selJogo}`;
  };
  // UNION ALL + GROUP BY … HAVING COUNT(*) = n é a interseção (a carta está em
  // todos os n operandos, cada um já deduplicado por carta) que ainda carrega a
  // soma dos `e`. Lê as mesmas linhas que o INTERSECT que existia aqui antes.
  const m = `SELECT ${selJogo}, SUM(e) AS x FROM (\n${termos.map(operando).join("\nUNION ALL\n")}\n) GROUP BY ${selJogo} HAVING COUNT(*) = ${termos.length}`;
  // Código impresso "009/094": os dois números já são termos (o 9 casa no
  // número, o 94 no total do set, que o cardRows indexa como palavra extra).
  // Mas palavra não sabe de onde veio — a EB03-009 de um set de 94 cartas
  // também tem "009" e "94". Aqui o NÚMERO da carta confere: tem de ser o da
  // fração (em qualquer escrita, ou guardado como "4/102"). Antes essa peneira
  // só existia no cliente, com a carta inteira na mão.
  // Duas frações no máximo: cada uma custa até 6 parâmetros, e o D1 recusa
  // statement com mais de 100.
  const fracoes = [...String(consulta || "").matchAll(/(\d+)\s*\/\s*\d+/g)].slice(0, 2).map((f) => f[1]);
  const condFracao = fracoes.map((n) => {
    const formas = formasNumericas(n);
    return `(c.number IN (${formas.map(p).join(",")})${formas.map((f) => ` OR c.number LIKE ${p(`${f}/%`)}`).join("")})`;
  });
  const join = global ? "c.game = m.game AND c.id = m.id" : `c.game = ${pJogo} AND c.id = m.id`;
  // ORDEM: relevância primeiro (termos casados como palavra inteira), depois o
  // lançamento mais novo, e (jogo, id) só pra ordem ser sempre a mesma. Antes
  // não havia ORDER BY nenhum: o LIMIT devolvia as primeiras cartas na ordem
  // do banco (os ids em ordem alfabética), e "mew" no Explorar mostrava 60
  // cartas do "30th Celebration" como se fossem as melhores.
  // `t` = total de cartas que casaram (antes do LIMIT): é o que deixa o
  // Explorar dizer "8.283 resultados" em vez de "60 resultados".
  // Colunas da COLEÇÃO (set_id, artist, language, variants…) no SELECT: o
  // modo completo devolve a carta pronta pra grade, sem o cliente baixar os
  // chunks dos sets. Ler as colunas a mais não custa linha no D1 (a cobrança é
  // por linha lida, e a linha já é lida pela PK) — quem decide o que VAI na
  // resposta é o search.js.
  const sql = `WITH m AS (${m})
SELECT c.game AS game, c.id AS id, c.name, c.set_name, c.number, c.card_type, c.cost, c.rarity, c.color,
  c.set_id, c.artist, c.language, c.image, c.variants, c.released, m.x AS x, COUNT(*) OVER () AS t
FROM m JOIN cards c ON ${join}${condFracao.length ? `\nWHERE ${condFracao.join(" AND ")}` : ""}
ORDER BY m.x DESC, c.released DESC, c.game, c.id
LIMIT ${lim}`;
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

// Preços de MUITOS ids num statement só (o modo completo da busca: até 10 mil
// cartas, 20 mil ids com os base). A lista vai como UM parâmetro JSON e o
// json_each a abre — fatiar em lotes de 90 (o teto de 100 parâmetros do D1)
// seriam 200+ consultas. Continua sendo busca pela PK, uma linha por id.
export function buildPricesJson(game, ids) {
  if (!ids || !ids.length) return null;
  return {
    sql: "SELECT id, j FROM prices WHERE game = ?1 AND id IN (SELECT value FROM json_each(?2))",
    params: [game, JSON.stringify(ids)]
  };
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
  // `extras`: as palavras que entraram DEPOIS da carga inicial — hoje o TOTAL
  // do set ("94" da Nymble 9/94), que é o que faz o código impresso "009/094"
  // achar a carta guardada como número "9" + setTotal 94. Separadas das
  // `legado` (a régua original, acima) de propósito: o deploy (d1-delta) só
  // INSERE as extras nas cartas cuja impressão remota ainda é a legada, em vez
  // de apagar e reescrever todas as palavras do catálogo — 10× menos escritas
  // na cota do D1. Palavra nova aqui = acrescentar em `fontesExtras`, nunca em
  // cima; e nunca mudar a régua das legado sem aceitar a reescrita total.
  const legado = [...unicas];
  const total = String(card.setTotal || "");
  // nameEn (20/09/2026): o nome em inglês das cartas japonesas do Pokémon
  // (enrich-ja), pra "boss's orders" achar a carta cujo `name` é o japonês.
  const fontesExtras = [num.includes("/") || !/^\d+$/.test(total) ? "" : total, card.nameEn && card.nameEn !== card.name ? card.nameEn : ""];
  const extras = [];
  for (const fonte of fontesExtras) {
    for (const w of palavras(fonte)) if (!unicas.has(w)) { unicas.add(w); extras.push(w); }
  }
  const palavra = (w) => ({ game, word: w, id: card.id });
  return { linha, words: [...legado, ...extras].map(palavra), legado: legado.map(palavra), extras: extras.map(palavra) };
}
