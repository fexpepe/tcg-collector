// Prova REAL da busca da API: gera o SQL com o build-d1, carrega num SQLite
// de verdade (node:sqlite) e roda as MESMAS queries da Function (o SQL vem do
// mesmo módulo, functions/api/_search-sql.js). Se isto passa, o que muda em
// produção é só o motor (D1 é SQLite) e o transporte.
//
// Uso: sirva nada, rode: node scripts/test-d1-search.mjs
// Pré-requisito: out/d1-cards.sql gerado (node scripts/build-d1.mjs).
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { buildSearch } from "../functions/api/_search-sql.js";

const db = new DatabaseSync(":memory:");
db.exec(readFileSync(new URL("../out/d1-cards.sql", import.meta.url), "utf8"));

const conta = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
console.log(`carregado: ${conta("cards")} cartas · ${conta("card_words")} palavras`);

function busca(game, q, limite) {
  const query = buildSearch(game, q, limite);
  if (!query) return [];
  // node:sqlite não repete parâmetro posicional ?1 como o D1: troca por ? e
  // repete o valor — só no TESTE; a Function usa a query como está.
  // A query GLOBAL (game=all) não tem ?1 nenhum: a fila então são TODOS os
  // parâmetros, na ordem.
  const temGame = query.sql.includes("?1");
  const sql = query.sql.replace(/\?1/g, "?");
  const fila = temGame ? query.params.slice(1) : query.params.slice();
  const ordem = query.sql.match(/\?1|\?(?!\d)/g) || [];
  const finais = ordem.map((token) => (token === "?1" ? query.params[0] : fila.shift()));
  return db.prepare(sql).all(...finais);
}

let falhas = 0;
function espera(nome, cond, extra) {
  console.log(`${cond ? "ok   " : "FALHA"} ${nome}${extra ? ` — ${extra}` : ""}`);
  if (!cond) falhas++;
}

// Prefixo simples
const pika = busca("pokemon", "pika");
espera("'pika' acha Pikachu no Pokémon", pika.length > 0 && pika.every((c) => /pika/i.test(c.name)) === false || pika.some((c) => /^pika/i.test(c.name)), `${pika.length} resultados, 1º: ${pika[0] && pika[0].name}`);

// Duas palavras = interseção (ordem indiferente)
const zard = busca("pokemon", "ex charizard");
espera("'ex charizard' (ordem invertida) acha Charizard ex", zard.some((c) => /charizard/i.test(c.name) && /ex/i.test(c.name)), `${zard.length} resultados`);

// Acento e caixa não importam (mesma régua do normalize do site)
const acei = busca("pokemon", "PIKACHU");
espera("caixa alta acha igual", acei.length === busca("pokemon", "pikachu").length, `${acei.length} resultados`);

// Jogo errado não vaza
espera("'pikachu' no magic devolve vazio", busca("magic", "pikachu").length === 0);

// Curinga de LIKE não é curinga aqui
espera("'100%' não explode nem vira curinga", Array.isArray(busca("pokemon", "100%")));

// Nome japonês: uma carta JA tem de ser achável pelo nome JA (o cliente acha)
const ja = busca("pokemon", "リザードン");
espera("'リザードン' acha carta japonesa", ja.length > 0, `${ja.length} resultados, 1º: ${ja[0] && ja[0].name}`);

// Consulta vazia
espera("consulta vazia devolve vazio", buildSearch("pokemon", "   ", 40) === null);

// Limite respeitado (termo de 2+ chars: a borda agora recusa 1 char)
espera("limite 5 corta em 5", busca("pokemon", "pi", 5).length <= 5);

// Gate de 2 caracteres: consulta de 1 char é recusada (protege a cota do D1)
espera("1 caractere devolve vazio", buildSearch("pokemon", "e", 40) === null);
espera("2 caracteres passam", buildSearch("pokemon", "pi", 40) !== null);

// Set, número e artista também são palavras (o alcance do haystack do cliente)
const pele = busca("pokemon", "pikachu jungle");
espera("'pikachu jungle' acha pelo NOME DO SET", pele.length > 0 && pele.every((c) => /jungle/i.test(c.set_name)), `${pele.length} resultados`);
const pnum = busca("pokemon", "pikachu 58");
espera("'pikachu 58' acha pelo NÚMERO", pnum.length > 0 && pnum.some((c) => String(c.number).startsWith("58")), `${pnum.length} resultados`);
const arita = busca("pokemon", "arita");
espera("'arita' acha pelo ARTISTA", arita.length > 0, `${arita.length} resultados, 1º: ${arita[0] && arita[0].name}`);

// Busca GLOBAL (game=all, o Explorar): acha e diz o jogo de cada resultado
const global = busca("all", "pikachu");
espera("global 'pikachu' acha e carimba o jogo", global.length > 0 && global.every((c) => c.game === "pokemon"), `${global.length} resultados`);
const globalDupla = busca("all", "ex charizard");
espera("global com duas palavras intersecta por (game,id)", globalDupla.some((c) => /charizard/i.test(c.name)), `${globalDupla.length} resultados`);

// Contrato de campos (o que o editor de decks e o Explorar re-mapeiam)
const campos = pika[0] && Object.keys(pika[0]).sort().join(",");
espera("colunas do contrato", campos === "card_type,color,cost,game,id,name,number,rarity,set_name", campos);

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1); }
console.log("\nbusca D1 conferida no SQLite local.");
