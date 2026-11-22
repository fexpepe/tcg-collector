// "Mais vistas" do Explorar numa consulta só (2026-11-22).
//
// A abertura do Explorar pedia ao Supabase o top 6 de CADA jogo (47 pedidos de
// uma vez), esperava todos e só então buscava as cartas: conteúdo aos 3,1 s
// navegando e aos 5,7 s na primeira visita em 4G lento, medido em produção.
// Agora a lista global vem em um pedido (200 linhas; as 30 fecharam na linha
// 78 em produção em 22/11/2026), o corte de 6 por jogo é feito no cliente, e o
// ranking fica guardado no aparelho por 30 min.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadShared } from "./lib/shared-sandbox.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const explore = readFileSync(join(raiz, "src/explore.js"), "utf8").replace(/\r\n/g, "\n");

// A função sai do arquivo entre os marcadores (o explore.js é script clássico).
const trecho = explore.slice(explore.indexOf("// <escolhe-top>"), explore.indexOf("// </escolhe-top>"));
assert.ok(trecho.includes("function escolheTop("), "explore.js sem o bloco <escolhe-top>");
const escolheTop = new Function(`${trecho}\nreturn escolheTop;`)();

// A conta ANTIGA, como estava no explore.js: top 6 de cada jogo, junta, tira
// quem tem menos de 2 views, ordena e fica com 30.
function contaAntiga(linhas, games) {
  const porJogo = games.map((g) => linhas.filter((x) => x.game === g).sort((a, b) => b.views - a.views).slice(0, 6));
  return games.flatMap((g, i) => porJogo[i].map((x) => ({ id: x.card_id, views: x.views, game: g })))
    .filter((x) => x.views >= 2)
    .sort((a, b) => b.views - a.views)
    .slice(0, 30);
}

// Banco de mentira: views todas diferentes (sem empate, pra ordem ser única),
// um jogo dominante, jogos pequenos e linhas de 1 view.
function linhasDeTeste() {
  const linhas = [];
  let v = 5000;
  const jogos = { pokemon: 120, magic: 40, onepiece: 9, lorcana: 5, dbc: 3, wow: 1 };
  for (const [game, n] of Object.entries(jogos)) {
    for (let i = 0; i < n; i++) linhas.push({ card_id: `${game}-${i}`, game, views: (v -= 7) + (game === "pokemon" ? 3000 : 0) });
  }
  for (let i = 0; i < 20; i++) linhas.push({ card_id: `pouco-${i}`, game: "lorcana", views: 1 });
  linhas.push({ card_id: "fora-1", game: "jogo-que-saiu", views: 99999 });
  return linhas;
}
const GAMES = ["pokemon", "lorcana", "onepiece", "magic", "dbc", "wow", "ygo"];

test("uma lista global dá o MESMO ranking que os 47 pedidos davam", () => {
  const linhas = linhasDeTeste();
  const novo = escolheTop(linhas, GAMES);
  const antigo = contaAntiga(linhas.filter((x) => GAMES.includes(x.game)), GAMES);
  assert.deepEqual(novo, antigo);
  assert.equal(novo.length, 6 + 6 + 6 + 5 + 3 + 1, "6 por jogo no máximo, e só quem tem 2+ views");
});

test("corta em 30, no máximo 6 por jogo, ignora jogo fora do registro e menos de 2 views", () => {
  const linhas = [];
  for (let g = 0; g < 8; g++) for (let i = 0; i < 10; i++) linhas.push({ card_id: `g${g}-${i}`, game: `g${g}`, views: 1000 - g * 10 - i });
  const games = Array.from({ length: 8 }, (_, g) => `g${g}`);
  const tops = escolheTop(linhas, games);
  assert.equal(tops.length, 30);
  const porJogo = {};
  tops.forEach((x) => { porJogo[x.game] = (porJogo[x.game] || 0) + 1; });
  assert.ok(Object.values(porJogo).every((n) => n <= 6));
  assert.deepEqual(tops.map((x) => x.views), [...tops.map((x) => x.views)].sort((a, b) => b - a), "em ordem de views");
  assert.deepEqual(escolheTop([{ card_id: "a", game: "x", views: 50 }, { card_id: "b", game: "g0", views: 1 }], games), []);
  assert.deepEqual(escolheTop(null, games), []);
});

test("a lista que chega fora de ordem é ordenada antes do corte por jogo", () => {
  const linhas = [];
  for (let i = 0; i < 9; i++) linhas.push({ card_id: `p-${i}`, game: "pokemon", views: 10 + i });
  const tops = escolheTop(linhas, ["pokemon"]);
  assert.deepEqual(tops.map((x) => x.id), ["p-8", "p-7", "p-6", "p-5", "p-4", "p-3"]);
});

test("o Explorar faz UM pedido de ranking, guarda no aparelho e mostra esqueleto", () => {
  assert.ok(explore.includes('escolheTop(await shared.fetchTopViewed("", 200), games)'), "um pedido global de 200 linhas");
  assert.ok(!/games\.map\(\(g\) => shared\.fetchTopViewed/.test(explore), "sem o pedido por jogo");
  assert.ok(explore.includes('const TOP_GUARDADO = "tcg-explore-top-v1";'));
  assert.ok(explore.includes("localStorage.setItem(TOP_GUARDADO"));
  // ranking guardado e dentro da validade: nenhuma ida ao Supabase
  assert.ok(explore.includes("if (!topViewedReady || Date.now() - guardado.t > TOP_VALE_MS) {"));
  // esqueleto: na largada e em qualquer re-render enquanto carrega
  assert.ok(explore.includes('if (topCarregando) shared.showSkeletons(elements.grid, "card", 8);'));
  // a carga que não deu certo tira os esqueletos
  assert.ok(explore.includes("if (!topViewedReady && !isSearching()) render({ resetCount: true });"));
});

test("fetchTopViewed: com jogo filtra por ele; sem jogo pede o de todos, com o jogo na linha", async () => {
  const urls = [];
  const sb = loadShared("", {
    antes: (s) => {
      s.fetch = (url) => {
        urls.push(String(url));
        return Promise.resolve({ ok: true, json: async () => [{ card_id: "base1-4", views: 9, game: "pokemon" }], text: async () => "" });
      };
    }
  });
  urls.length = 0;
  const umJogo = await sb.TCGShared.fetchTopViewed("magic", 40);
  const todos = await sb.TCGShared.fetchTopViewed("", 200);
  assert.equal(umJogo[0].card_id, "base1-4");
  assert.equal(todos[0].game, "pokemon");
  const [a, b] = urls.filter((u) => u.includes("/rest/v1/card_views"));
  assert.match(a, /card_views\?game=eq\.magic&order=views\.desc&limit=40&select=card_id,views,game$/);
  assert.match(b, /card_views\?views=gte\.2&order=views\.desc&limit=200&select=card_id,views,game$/);
  // jogo que não existe continua caindo no padrão, como antes
  await sb.TCGShared.fetchTopViewed("nao-existe", 6);
  assert.match(urls.filter((u) => u.includes("/rest/v1/card_views"))[2], /game=eq\.pokemon&/);
});
