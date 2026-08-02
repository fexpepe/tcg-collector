// Normalização e SQL da busca de cartas — compartilhado entre a Function
// (/api/search, rodando em D1) e o teste local (node:sqlite). Um lugar só,
// senão o teste passaria numa query e a produção rodaria outra.
//
// Modelo: cada nome de carta vira palavras normalizadas em `card_words`
// (game, word, id) com índice — a busca é PREFIXO por palavra ("char liz"
// acha Charizard via char* ∩ liz*). LIKE 'x%' usa o índice; um LIKE '%x%'
// varreria a tabela inteira, e no D1 linha varrida é linha COBRADA — 150k
// linhas por tecla digitada estourava a cota grátis em minutos.

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
  PRIMARY KEY (game, id)
);
CREATE TABLE IF NOT EXISTS card_words (
  game TEXT NOT NULL,
  word TEXT NOT NULL,
  id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_card_words ON card_words (game, word, id);
`;

// Query de busca: interseção dos conjuntos de ids de cada palavra-prefixo,
// depois as cartas. `escape`: % e _ são curingas do LIKE — um "100%" digitado
// não pode virar curinga. LIMIT no chamador via parâmetro.
export function buildSearch(game, consulta, limite) {
  const termos = palavras(consulta).slice(0, 5); // 5 palavras bastam; mais = abuso
  if (!termos.length) return null;
  const sub = termos
    .map(() => `SELECT id FROM card_words WHERE game = ?1 AND word LIKE ? ESCAPE '\\'`)
    .join("\nINTERSECT\n");
  const sql = `SELECT id, name, set_name, number, card_type, cost, rarity, color
FROM cards WHERE game = ?1 AND id IN (\n${sub}\n) LIMIT ${Math.max(1, Math.min(100, limite | 0 || 40))}`;
  const params = [game, ...termos.map((t) => t.replace(/([%_\\])/g, "\\$1") + "%")];
  return { sql, params };
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
    rarity: card.rarity || "", color
  };
  // Dedupe de palavras por carta ("Mega Mega Punch" não precisa de duas linhas).
  const unicas = [...new Set(palavras(card.name))];
  return { linha, words: unicas.map((w) => ({ game, word: w, id: card.id })) };
}
