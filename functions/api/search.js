// GET /api/search?game=<slug>&q=<termo>[&limit=40][&img=1][&full=1]
//
// Busca de cartas no jogo INTEIRO respondida pela borda (D1), em poucos KB.
// Substitui, quando disponível, o search-index.json que o editor de decks
// baixa inteiro — 8 MB no Magic — pra buscar no cliente. O cliente trata
// qualquer resposta não-ok (inclusive o 503 de "API desligada") como sinal
// pra cair no caminho estático de sempre, então esta função pode existir em
// produção ANTES de o banco existir sem quebrar nada.
//
// Resposta: { t, c: [ { i, n, s, u, t, c, r, k, g, x } ] } — os MESMOS campos
// do search-index.json, pra troca no cliente ser só a origem dos dados, mais
// `g` (jogo), `x` (quantos termos casaram como palavra inteira: relevância) e
// o `t` da raiz: o TOTAL de cartas que casaram, antes do limite. As cartas
// vêm da mais relevante pra menos (ver buildSearch).
//
// &full=1 (o Explorar, 27/09/2026): a busca COMPLETA — até 10 mil cartas, já
// no formato do chunk (o mesmo contrato do /api/collection) e com os preços
// verbatim: { t, c: [carta…], p: { <jogo>: { <id>: preço } } }. É o que deixa
// o Explorar mostrar TODAS as cartas de "mew" (e ordenar todas por valor) sem
// baixar os chunks dos sets de cada uma — antes eram 60 cartas, hidratadas
// com o manifest + o índice inteiro de cada jogo (2,9 MB só o do Pokémon).
import { buildSearch, buildPricesJson, idsComBase, LIMITE_COMPLETO } from "./_search-sql.js";

// Jogos válidos (espelho do registro do game.js). Barra consulta arbitrária.
// "all" = busca global (o Explorar): todos os jogos numa consulta só.
const GAMES = new Set(["all", "pokemon", "lorcana", "onepiece", "magic", "fab", "gundam", "swu",
  "dbfw", "ygo", "digimon", "riftbound", "unionarena", "naruto", "hxh", "dbc", "jump"]);

export async function onRequestGet(context) {
  const { env, request, waitUntil } = context;
  const url = new URL(request.url);
  const game = String(url.searchParams.get("game") || "");
  const q = String(url.searchParams.get("q") || "");
  const full = url.searchParams.get("full") === "1";
  const limit = Number(url.searchParams.get("limit")) || (full ? LIMITE_COMPLETO : 40);
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

  const query = buildSearch(game, q, limit, { completo: full });
  if (!query) return json(full ? { t: 0, c: [], p: {} } : { t: 0, c: [] }, 200, 0);

  // Cache DE BORDA de verdade. Cada consulta lê as palavras de cada termo (até
  // TETO_OPERANDO por termo) e a linha de cada carta que casou — de centenas a
  // dezenas de milhares de leituras cobradas —, e sem isto a MESMA busca vinda
  // de outra pessoa pagava tudo de novo — o `s-maxage` do header não guarda
  // resposta de Function. Guardado por URL, então já separa game/q/limit/img/full.
  const cache = caches.default;
  const chaveCache = new Request(url.toString(), { method: "GET" });
  try {
    const guardada = await cache.match(chaveCache);
    if (guardada) return guardada;
  } catch (e) { /* sem cache disponível: segue pro banco */ }

  try {
    const r = await env.DB.prepare(query.sql).bind(...query.params).all();
    const linhas = r.results || [];
    const total = linhas.length ? Number(linhas[0].t) || linhas.length : 0;
    let corpo;
    if (full) {
      // De volta ao formato do CHUNK (o mesmo do /api/collection), com g e x.
      const cartas = linhas.map((linha) => ({
        id: linha.id, name: linha.name, set: linha.set_name, setId: linha.set_id,
        number: linha.number, rarity: linha.rarity, artist: linha.artist,
        language: linha.language, image: linha.image,
        variants: parseVariants(linha.variants),
        setReleaseDate: linha.released,
        cardType: linha.card_type || undefined, cost: linha.cost || undefined,
        g: linha.game, x: linha.x
      }));
      corpo = { t: total, c: cartas, p: await precosDe(env.DB, linhas) };
    } else {
      // g (jogo) na resposta: na busca global é o que diz de qual catálogo
      // hidratar cada resultado; nas por jogo é redundância inofensiva.
      const cartas = linhas.map((linha) => {
        const c = {
          i: linha.id, n: linha.name, s: linha.set_name, u: linha.number,
          t: linha.card_type, c: linha.cost, r: linha.rarity, k: linha.color, g: linha.game, x: linha.x
        };
        if (img) { c.m = linha.image || ""; c.d = linha.released || ""; }
        return c;
      });
      corpo = { t: total, c: cartas };
    }
    // Vazio NUNCA cacheia: durante a recarga do catálogo no D1 a busca responde
    // vazio, e um {c:[]} com max-age=300 grudava "nenhum resultado" no
    // navegador por 5 minutos DEPOIS de o banco já ter voltado ao normal. Vale
    // pro cache de borda pelo mesmo motivo — lá seria pior, valendo pra todo
    // mundo de uma vez.
    const resposta = json(corpo, 200, linhas.length ? 300 : 0);
    if (linhas.length && waitUntil) {
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

// Preços das cartas do modo completo: os ids delas MAIS os ids base (a carta
// -pt/-ja sem preço próprio cai na base, como no /api/collection), por jogo,
// num batch só — um round-trip pro D1 qualquer que seja o número de jogos.
// Fatias de 5 mil ids por statement só pra o parâmetro JSON não crescer sem
// teto (o D1 aceita string de até 2 MB).
async function precosDe(db, linhas) {
  const porJogo = {};
  for (const l of linhas) (porJogo[l.game] = porJogo[l.game] || []).push(l.id);
  const stmts = [], jogos = [];
  for (const game of Object.keys(porJogo)) {
    const ids = idsComBase(porJogo[game]);
    for (let i = 0; i < ids.length; i += 5000) {
      const q = buildPricesJson(game, ids.slice(i, i + 5000));
      if (!q) continue;
      stmts.push(db.prepare(q.sql).bind(...q.params));
      jogos.push(game);
    }
  }
  const tabela = {};
  if (!stmts.length) return tabela;
  const resultados = await db.batch(stmts);
  resultados.forEach((res, k) => {
    const alvo = tabela[jogos[k]] = tabela[jogos[k]] || {};
    for (const linha of (res && res.results) || []) {
      try { alvo[linha.id] = JSON.parse(linha.j); } catch (e) { /* entrada corrompida: sem preço */ }
    }
  });
  return tabela;
}

function parseVariants(texto) {
  try {
    const v = JSON.parse(texto || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}
