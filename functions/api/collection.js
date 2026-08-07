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

const GAMES = new Set(["pokemon", "lorcana", "onepiece", "magic", "fab", "gundam",
  "dbfw", "ygo", "digimon", "riftbound", "unionarena", "naruto", "hxh", "jump"]);

// Teto por requisição: uma coleção gigante vira várias chamadas do cliente, em
// vez de uma consulta que varre o banco inteiro (no D1, linha lida é linha
// cobrada). 1200 ids ≈ 14 lotes de 90 — bem dentro do orçamento de uma request.
const MAX_IDS = 1200;

export async function onRequestPost(context) {
  const { env, request } = context;
  const json = (corpo, status) => new Response(JSON.stringify(corpo), {
    status,
    // Dado do usuário: nunca em cache compartilhado.
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });

  if (!env.DB) return json({ off: 1 }, 503);

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
    const cartas = {}, precos = {};
    for (const game of Object.keys(porJogo)) {
      const ids = porJogo[game];
      // Cada lote é uma consulta por PK — sem varredura, sem LIKE.
      const consultas = [];
      for (const lote of fatias(ids)) {
        const q = buildCards(game, lote);
        if (q) consultas.push(env.DB.prepare(q.sql).bind(...q.params).all());
      }
      for (const lote of fatias(idsComBase(ids))) {
        const q = buildPrices(game, lote);
        if (q) consultas.push(env.DB.prepare(q.sql).bind(...q.params).all().then((r) => ({ precos: r })));
      }
      const partes = await Promise.all(consultas);
      const lista = [], tabela = {};
      for (const parte of partes) {
        if (parte && parte.precos) {
          for (const linha of parte.precos.results || []) {
            try { tabela[linha.id] = JSON.parse(linha.j); } catch (e) { /* entrada corrompida: sem preço */ }
          }
          continue;
        }
        for (const linha of (parte && parte.results) || []) {
          // De volta ao formato do CHUNK: é o contrato que o cliente já sabe ler.
          lista.push({
            id: linha.id, name: linha.name, set: linha.set_name, setId: linha.set_id,
            number: linha.number, rarity: linha.rarity, artist: linha.artist,
            language: linha.language, image: linha.image,
            variants: parseVariants(linha.variants),
            setReleaseDate: linha.released,
            cardType: linha.card_type || undefined, cost: linha.cost || undefined
          });
        }
      }
      if (lista.length) cartas[game] = lista;
      if (Object.keys(tabela).length) precos[game] = tabela;
    }
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
