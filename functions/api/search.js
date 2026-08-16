// GET /api/search?game=<slug>&q=<termo>[&limit=40][&img=1]
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
  const { env, request, waitUntil } = context;
  const url = new URL(request.url);
  const game = String(url.searchParams.get("game") || "");
  const q = String(url.searchParams.get("q") || "");
  const limit = Number(url.searchParams.get("limit")) || 40;
  // &img=1 (lista de impressões do popup): acrescenta imagem (m) e data de
  // lançamento (d) a cada carta. Opt-in porque a busca por tecla digitada do
  // editor de decks não usa nenhum dos dois — seriam ~4KB de URL de imagem por
  // resposta à toa.
  const img = url.searchParams.get("img") === "1";

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
      // build. Só resposta COM carta: um vazio cacheado é veneno (ver o
      // chamador). O s-maxage sozinho NÃO tirava consulta nenhuma do banco:
      // resposta de Pages Function não entra no cache da Cloudflare por conta
      // própria — quem faz isso é o caches.default lá embaixo. Ele fica porque
      // descreve a intenção pra qualquer cache intermediário.
      "Cache-Control": cacheSeg ? `public, max-age=${cacheSeg}, s-maxage=${cacheSeg * 4}` : "no-store"
    }
  });

  // Sem o binding (banco ainda não criado/ligado): 503 dizendo "desligada".
  // O cliente cai no índice estático — a API escura não pode ser um erro.
  if (!env.DB) return json({ off: 1 }, 503, 0);
  if (!GAMES.has(game)) return json({ erro: "game" }, 400, 0);

  const query = buildSearch(game, q, limit);
  if (!query) return json({ c: [] }, 200, 0);

  // Cache DE BORDA de verdade. Cada consulta lê até 5 termos × 2.000 linhas no
  // D1 (~10 mil leituras cobradas), e sem isto a MESMA busca vinda de outra
  // pessoa pagava tudo de novo — o `s-maxage` do header não guarda resposta de
  // Function. Guardado por URL, então já separa game/q/limit/img.
  const cache = caches.default;
  const chaveCache = new Request(url.toString(), { method: "GET" });
  try {
    const guardada = await cache.match(chaveCache);
    if (guardada) return guardada;
  } catch (e) { /* sem cache disponível: segue pro banco */ }

  try {
    const r = await env.DB.prepare(query.sql).bind(...query.params).all();
    // g (jogo) na resposta: na busca global é o que diz de qual catálogo
    // hidratar cada resultado; nas por jogo é redundância inofensiva.
    const cartas = (r.results || []).map((linha) => {
      const c = {
        i: linha.id, n: linha.name, s: linha.set_name, u: linha.number,
        t: linha.card_type, c: linha.cost, r: linha.rarity, k: linha.color, g: linha.game
      };
      if (img) { c.m = linha.image || ""; c.d = linha.released || ""; }
      return c;
    });
    // Vazio NUNCA cacheia: durante a recarga do catálogo no D1 a busca responde
    // vazio, e um {c:[]} com max-age=300 grudava "nenhum resultado" no
    // navegador por 5 minutos DEPOIS de o banco já ter voltado ao normal. Vale
    // pro cache de borda pelo mesmo motivo — lá seria pior, valendo pra todo
    // mundo de uma vez.
    const resposta = json({ c: cartas }, 200, cartas.length ? 300 : 0);
    if (cartas.length && waitUntil) {
      try { waitUntil(cache.put(chaveCache, resposta.clone())); } catch (e) { /* sem cache: só não guarda */ }
    }
    return resposta;
  } catch (e) {
    // "no such table" = catálogo ainda não importado: a API está DESLIGADA de
    // propósito e o cliente deve parar de tentar por um tempo longo. Qualquer
    // outro erro é soluço do D1, e aí o `off` seria mentira: o cliente
    // interpretava os dois como "desligada" e ficava 5 MINUTOS sem borda (com
    // toda busca do Explorar baixando catálogo) por causa de uma falha de
    // segundos. Sem `off`, o cliente usa a pausa curta.
    const semTabela = /no such table|no such column/i.test(String((e && e.message) || e));
    return semTabela ? json({ off: 1 }, 503, 0) : json({ erro: "db" }, 500, 0);
  }
}
