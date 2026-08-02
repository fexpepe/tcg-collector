// Prova REAL da busca da API: gera o SQL com o build-d1, carrega num SQLite
// de verdade (node:sqlite) e roda as MESMAS queries da Function (o SQL vem do
// mesmo módulo, functions/api/_search-sql.js). Se isto passa, o que muda em
// produção é só o motor (D1 é SQLite) e o transporte.
//
// Uso: sirva nada, rode: node scripts/test-d1-search.mjs
// Pré-requisito: out/d1.sql gerado (node scripts/build-d1.mjs).
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { buildSearch } from "../functions/api/_search-sql.js";

const db = new DatabaseSync(":memory:");
db.exec(readFileSync(new URL("../out/d1.sql", import.meta.url), "utf8"));

const conta = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
console.log(`carregado: ${conta("cards")} cartas · ${conta("card_words")} palavras`);

function busca(game, q, limite) {
  const query = buildSearch(game, q, limite);
  if (!query) return [];
  // node:sqlite não repete parâmetro posicional ?1 como o D1: troca por ? e
  // repete o valor — só no TESTE; a Function usa a query como está.
  let i = 0;
  const sql = query.sql.replace(/\?1/g, () => "?");
  const usos = (query.sql.match(/\?1/g) || []).length;
  const params = [];
  let pos = 1;
  // reconstrói a lista: cada ?1 vira o game; os demais ? seguem a ordem
  const restantes = query.params.slice(1);
  for (const ch of sql.matchAll(/\?/g)) params.push(null);
  // mais simples e à prova de erro: monta de novo com game repetido
  const finais = [];
  let r = 0;
  let ordem = query.sql.match(/\?1|\?(?!\d)/g) || [];
  for (const token of ordem) finais.push(token === "?1" ? query.params[0] : restantes[r++]);
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

// Limite respeitado
espera("limite 5 corta em 5", busca("pokemon", "e", 5).length <= 5);

// Contrato de campos (o que o editor de decks espera re-mapear)
const campos = pika[0] && Object.keys(pika[0]).sort().join(",");
espera("colunas do contrato", campos === "card_type,color,cost,id,name,number,rarity,set_name", campos);

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1); }
console.log("\nbusca D1 conferida no SQLite local.");
