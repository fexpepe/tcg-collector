// "Em destaque" da galeria de decks, com DECAIMENTO.
//
// O problema: o destaque é o deck mais VISITADO entre os carregados, por
// contagem acumulada. Contagem acumulada só cresce, então o primeiro deck que
// viralizou fica no topo pra sempre e a galeria congela — quem publica hoje
// nunca aparece, e quem visita vê o mesmo card há semanas.
//
// A correção é a mesma dos agregadores de link: dividir a contagem pela idade.
//   hot = views / (idadeEmDias + 2) ^ GRAVIDADE
// Um deck de 60 dias com 500 visitas perde pra um de 2 dias com 40 — que é
// exatamente o comportamento que "em destaque" promete.
//
// As duas fontes já existem e são de LEITURA PÚBLICA (conferido na migration
// 20260804a: `create policy "deck_views public read" ... using (true)`), então
// isto é um GET com a chave publicável, sem tabela nova e sem RPC nova.
//
// Falha em silêncio de propósito: sem rede, sem permissão ou sem dado, não
// escreve arquivo — e a galeria mantém o comportamento de hoje. Um destaque
// desatualizado é melhor que uma galeria quebrada.
//
// Uso: node scripts/build-decks-hot.mjs
import { writeFile } from "node:fs/promises";
import { pontuaDecks } from "./lib/decks-hot.mjs";

const SUPABASE_URL = "https://dlnalopazitfdgnmdguu.supabase.co";
const SUPABASE_ANON = "sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL"; // pública
const SAIDA = new URL("../data/decks-hot.generated.json", import.meta.url);

// 200 entradas cobrem com folga o que a galeria carrega; o arquivo fica na
// casa dos KB. A PONTUAÇÃO mora em scripts/lib/decks-hot.mjs, pura e testada.
const TETO = 200;

async function pega(caminho) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
    headers: { apikey: SUPABASE_ANON }, signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

let decks, views;
try {
  [decks, views] = await Promise.all([
    pega("shares?kind=eq.deck&select=id,created_at&order=created_at.desc&limit=600"),
    pega("deck_views?select=share_id,views&order=views.desc&limit=600")
  ]);
} catch (e) {
  console.log(`Decks em destaque: pulado (${e.message}) — a galeria mantém o comportamento atual.`);
  process.exit(0);
}

if (!Array.isArray(decks) || !decks.length || !Array.isArray(views) || !views.length) {
  console.log("Decks em destaque: sem dado suficiente — nada publicado.");
  process.exit(0);
}

const pontuados = pontuaDecks(decks, views);

const hot = Object.fromEntries(pontuados.slice(0, TETO));
await writeFile(SAIDA, JSON.stringify({ v: 1, generatedAt: new Date().toISOString(), hot }), "utf8");
console.log(`Decks em destaque: ${Object.keys(hot).length} deck(s) pontuados de ${decks.length} publicados (topo: ${pontuados[0] ? pontuados[0][1] : 0}).`);
