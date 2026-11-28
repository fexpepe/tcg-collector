// POST /api/collection  { "pokemon": ["base1-4", …], "lorcana": [ … ] }
//
// Devolve as CARTAS e os PREÇOS exatamente dos ids que a pessoa tem — o que
// hoje custa baixar os chunks INTEIROS de cada set em que ela tem uma carta
// (dezenas de MB no Portfólio de quem coleciona há tempo, pra usar algumas
// centenas de linhas).
//
// DECISÃO CENTRAL: a borda devolve DADO, não o total calculado. A fórmula do
// valor (cardValue/collectionNetWorth) continua existindo num lugar só, no
// cliente — se a borda somasse por conta própria, existiriam duas fórmulas e
// mais cedo ou mais tarde elas discordariam, que é exatamente o bug de "o valor
// da Coleção não bate com o do Hub" que já custou caro. Aqui a resposta é
// equivalente ao que os chunks entregariam, só que sem o peso deles.
//
// Resposta: { c: { <game>: [carta…] }, p: { <game>: { <id>: preço } } }
// A carta sai no MESMO formato do chunk (campos do catálogo) e o preço é a
// entrada verbatim do pricing — então o cliente injeta os dois nos globais de
// sempre e nada mais muda.
import { buildCards, buildPrices, idsComBase, LOTE_IDS } from "./_search-sql.js";
import { apelidosDaCarta } from "../_lib/apelidos-jp.js";

const GAMES = new Set(["pokemon", "lorcana", "onepiece", "magic", "fab", "gundam", "swu", "cyberpunk", "sorcery",
  "dbfw", "dbs", "ygo", "digimon", "riftbound", "unionarena", "narutocg", "naruto", "hxh", "dbc", "dbsb", "dbva", "dbbw", "dbz", "wow", "lotr", "harrypotter", "weiss", "godzilla", "palworld", "fftcg", "grandarchive", "hololive", "shadowverse", "vanguard", "duelmasters", "narutomythos", "narutokayou", "herorush", "ikorr", "mbc", "cdm", "gcd", "gw", "seiya", "seiyatc", "seiyacr", "fma", "narutoboruto", "narutotc", "jump"]);

// Teto por requisição: uma coleção gigante vira várias chamadas do cliente, em
// vez de uma consulta que varre o banco inteiro (no D1, linha lida é linha
// cobrada). 1200 ids ≈ 14 lotes de 90 — bem dentro do orçamento de uma request.
const MAX_IDS = 1200;

export async function onRequestPost(context) {
  const { env, request } = context;
  const json = (corpo, status) => new Response(JSON.stringify(corpo), {
    status,
    // Dado do usuário: nunca em cache compartilhado. nosniff + CSP porque a
    // resposta é montada do zero e não herda o _headers do site.
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'"
    }
  });

  if (!env.DB) return json({ off: 1 }, 503);

  // Teto de tamanho ANTES de materializar o corpo. Sem isto, o request.json()
  // lia o payload inteiro e só depois o MAX_IDS o rejeitava — e como o endpoint
  // é anônimo e sem preflight (simple request), qualquer site podia mandar os
  // navegadores dos visitantes postarem corpos enormes. 1200 ids ≈ 20 KB; 64 KB
  // dá folga e ainda barra o abuso cedo. content-length ausente cai no MAX_IDS.
  const tam = Number(request.headers.get("content-length"));
  if (tam > 65536) return json({ erro: "grande", max: MAX_IDS }, 413);

  let pedido;
  try { pedido = await request.json(); } catch (e) { return json({ erro: "json" }, 400); }
  if (!pedido || typeof pedido !== "object") return json({ erro: "json" }, 400);

  // Normaliza e barra o que não é jogo conhecido; conta o total pedido.
  const porJogo = {};
  let total = 0;
  for (const game of Object.keys(pedido)) {
    if (!GAMES.has(game)) continue;
    const ids = Array.isArray(pedido[game]) ? pedido[game].filter((x) => typeof x === "string" && x) : [];
    if (!ids.length) continue;
    const unicos = [...new Set(ids)];
    porJogo[game] = unicos;
    total += unicos.length;
  }
  if (!total) return json({ c: {}, p: {} }, 200);
  if (total > MAX_IDS) return json({ erro: "muitos", max: MAX_IDS }, 413);

  const fatias = (lista) => {
    const out = [];
    for (let i = 0; i < lista.length; i += LOTE_IDS) out.push(lista.slice(i, i + LOTE_IDS));
    return out;
  };

  try {
    // UMA ida ao banco pra todos os jogos (2026-11-22). Antes cada jogo esperava
    // o anterior (`await` dentro do laço), e o tempo crescia com o número de
    // JOGOS, não de cartas — medido em produção com 6 ids por jogo: 162 ms com
    // 1 jogo, 598 ms com 4, 1.176 ms com 8, 2.050 ms com 14 (~147 ms por jogo);
    // 72 ids de um jogo só, 169 ms. É o que Coleção, Portfólio, Painel,
    // Fichários e Explorar pagavam a cada abertura. O batch() manda todas as
    // consultas numa viagem e devolve os resultados NA ORDEM em que entraram;
    // são leituras por PK que não dependem uma da outra. Um Promise.all das
    // consultas soltas não serviria: o Worker só mantém 6 conexões com o D1 ao
    // mesmo tempo, e um pedido de vários jogos passa disso.
    const consultas = [];
    const donos = [];   // de quem é cada consulta: { game, preco }
    for (const game of Object.keys(porJogo)) {
      const ids = porJogo[game];
      // Cada lote é uma consulta por PK — sem varredura, sem LIKE.
      for (const lote of fatias(ids)) {
        const q = buildCards(game, lote);
        if (q) { consultas.push(env.DB.prepare(q.sql).bind(...q.params)); donos.push({ game, preco: false }); }
      }
      for (const lote of fatias(idsComBase(ids))) {
        const q = buildPrices(game, lote);
        if (q) { consultas.push(env.DB.prepare(q.sql).bind(...q.params)); donos.push({ game, preco: true }); }
      }
    }
    const partes = consultas.length ? await env.DB.batch(consultas) : [];
    const cartas = {}, precos = {};
    partes.forEach((parte, i) => {
      const { game, preco } = donos[i];
      const linhas = (parte && parte.results) || [];
      // Jogo sem linha nenhuma continua FORA da resposta, como antes.
      if (!linhas.length) return;
      if (preco) {
        const tabela = precos[game] || (precos[game] = {});
        for (const linha of linhas) {
          try { tabela[linha.id] = JSON.parse(linha.j); } catch (e) { /* entrada corrompida: sem preço */ }
        }
        return;
      }
      const lista = cartas[game] || (cartas[game] = []);
      for (const linha of linhas) {
        // De volta ao formato do CHUNK: é o contrato que o cliente já sabe ler.
        const carta = {
          id: linha.id, name: linha.name, set: linha.set_name, setId: linha.set_id,
          number: linha.number, rarity: linha.rarity, artist: linha.artist,
          language: linha.language, image: linha.image,
          variants: parseVariants(linha.variants),
          setReleaseDate: linha.released,
          cardType: linha.card_type || undefined, cost: linha.cost || undefined
        };
        // Apelidos em romaji ("sasuke" acha うちはサスケ). O chunk traz o campo
        // gravado no build; o D1 não tem a coluna nem o `nameJp`, então sai do
        // `name` — o mesmo texto que o cliente calculava aqui antes de a tabela
        // sair do shared.js (2026-11-28). Só quando casa: carta latina segue
        // com o formato de sempre. Coleção, Portfólio, Painel, Fichários e
        // Explorar filtram por texto com estas cartas, não com as dos chunks.
        const apelidos = apelidosDaCarta({ name: linha.name });
        if (apelidos) carta.apelidos = apelidos;
        lista.push(carta);
      }
    });
    return json({ c: cartas, p: precos }, 200);
  } catch (e) {
    // Banco fora ou tabela ainda não carregada: mesma degradação da /api/search
    // — o cliente cai nos chunks e a tela não muda de comportamento.
    return json({ off: 1 }, 503);
  }
}

function parseVariants(texto) {
  try {
    const v = JSON.parse(texto || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}
