// GET /api/search?game=<slug>&q=<termo>[&limit=40]
//
// Busca de cartas no jogo INTEIRO respondida pela borda (D1), em poucos KB.
// Substitui, quando disponível, o search-index.json que o editor de decks
// baixa inteiro — 8 MB no Magic — pra buscar no cliente. O cliente trata
// qualquer resposta não-ok (inclusive o 503 de "API desligada") como sinal
// pra cair no caminho estático de sempre, então esta função pode existir em
// produção ANTES de o banco existir sem quebrar nada.
//
// Resposta: { c: [ { i, n, s, u, t, c, r, k } ] } — os MESMOS campos do
// search-index.json, pra troca no cliente ser só a origem dos dados.
import { buildSearch } from "./_search-sql.js";

// Jogos válidos (espelho do registro do game.js). Barra consulta arbitrária.
// "all" = busca global (o Explorar): todos os jogos numa consulta só.
const GAMES = new Set(["all", "pokemon", "lorcana", "onepiece", "magic", "fab", "gundam",
  "dbfw", "ygo", "digimon", "riftbound", "unionarena", "naruto", "hxh", "jump"]);

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const game = String(url.searchParams.get("game") || "");
  const q = String(url.searchParams.get("q") || "");
  const limit = Number(url.searchParams.get("limit")) || 40;

  const json = (corpo, status, cacheSeg) => new Response(JSON.stringify(corpo), {
    status,
    headers: {
      "Content-Type": "application/json",
      // Respostas montadas do zero não herdam o _headers do site: sem isto saíam
      // sem nosniff nem CSP. Não é explorável hoje (nada de input é refletido),
      // mas trava a regressão se algum dia um eco de input entrar aqui.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      // Busca é cacheável: mesma consulta = mesma resposta até o próximo
      // build. s-maxage curto na borda tira as consultas repetidas do banco.
      // Só resposta COM carta: um vazio cacheado é veneno (ver o chamador).
      "Cache-Control": cacheSeg ? `public, max-age=${cacheSeg}, s-maxage=${cacheSeg * 4}` : "no-store"
    }
  });

  // Sem o binding (banco ainda não criado/ligado): 503 dizendo "desligada".
  // O cliente cai no índice estático — a API escura não pode ser um erro.
  if (!env.DB) return json({ off: 1 }, 503, 0);
  if (!GAMES.has(game)) return json({ erro: "game" }, 400, 0);

  const query = buildSearch(game, q, limit);
  if (!query) return json({ c: [] }, 200, 0);

  try {
    const r = await env.DB.prepare(query.sql).bind(...query.params).all();
    // g (jogo) na resposta: na busca global é o que diz de qual catálogo
    // hidratar cada resultado; nas por jogo é redundância inofensiva.
    const cartas = (r.results || []).map((linha) => ({
      i: linha.id, n: linha.name, s: linha.set_name, u: linha.number,
      t: linha.card_type, c: linha.cost, r: linha.rarity, k: linha.color, g: linha.game
    }));
    // Vazio NUNCA cacheia: durante a recarga do catálogo no D1 a busca responde
    // vazio, e um {c:[]} com max-age=300 grudava "nenhum resultado" no
    // navegador por 5 minutos DEPOIS de o banco já ter voltado ao normal.
    return json({ c: cartas }, 200, cartas.length ? 300 : 0);
  } catch (e) {
    // Tabela ainda não importada, ou soluço do D1: mesma degradação do 503.
    return json({ off: 1 }, 503, 0);
  }
}
