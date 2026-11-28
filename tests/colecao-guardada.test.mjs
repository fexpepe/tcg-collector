// Coleção guardada no aparelho (2026-11-27).
//
// Coleção, Painel e Explorar esperavam um POST /api/collection a cada abertura
// pra desenhar qualquer carta: medido em produção em 23/11, a página pronta aos
// 0,09 s ficava em esqueleto até 0,65–0,92 s no desktop e ~2 s num celular
// lento. O src/colecao-guardada.js guarda a última resposta no Cache Storage,
// pinta dela na hora e deixa a rede conferir por trás.
//
// O que este arquivo guarda:
//  - a cópia pinta primeiro, marcada `guardado` e `parcial` (ninguém grava o
//    ponto do dia nem republica o perfil com preço de ontem);
//  - resposta igual à cópia chega como `repetido` e não regrava nada;
//  - resposta diferente redesenha, troca a cópia e tira o preço que sumiu;
//  - sem rede a cópia fica; sem rede e sem cópia, o erro sobe;
//  - o nome do cache é o mesmo nos três lugares que precisam dele.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
// Checkout do Windows vem em CRLF: tira o CR na leitura (sem regex com barra).
const CR = String.fromCharCode(13);
const fonte = (arq) => readFileSync(join(raiz, arq), "utf8").split(CR).join("");
const modulo = fonte("src/colecao-guardada.js");
const CACHE = "tcg-colecao-v1";

// Cache Storage de mentira: um Map por nome de cache, contando as gravações.
function cachesDeMentira() {
  const caixas = new Map();
  const conta = { gravacoes: 0 };
  return {
    caixas, conta,
    open: async (nome) => {
      if (!caixas.has(nome)) caixas.set(nome, new Map());
      const caixa = caixas.get(nome);
      return {
        match: async (chave) => (caixa.has(chave) ? new Response(caixa.get(chave)) : undefined),
        put: async (chave, resposta) => { conta.gravacoes++; caixa.set(chave, await resposta.text()); }
      };
    }
  };
}

// Sobe o módulo numa página de mentira. `respostas` é a fila do que a "rede"
// (o shared.loadOwnedFast) devolve; uma função na fila é chamada (pra rejeitar).
function sobe(caches, respostas) {
  const pedidos = [];
  const window = {};
  window.TCGShared = {
    loadOwnedFast: async (pedido) => {
      pedidos.push(pedido);
      // A rede de verdade leva centenas de ms; a leitura da cópia, poucos.
      // Sem este atraso a "rede" ganharia a corrida e a cópia nem entraria
      // (o teste "rede mais rápida que a cópia" cobre esse caso de propósito).
      if (!respostas.naHora) await new Promise((ok) => setTimeout(ok, 2));
      const proxima = respostas.shift();
      const r = typeof proxima === "function" ? await proxima() : proxima;
      // O de verdade mescla a tabela de preços da resposta na da sessão.
      if (r && r.pricing) Object.assign(window.TCG_PRICING = window.TCG_PRICING || {}, r.pricing);
      return r;
    }
  };
  new Function("window", "caches", "Response", modulo)(window, caches, Response);
  return { window, pedidos, carrega: window.TCGGuardada.carrega };
}

const carta = (id, game, extra) => Object.assign({ id, name: "Carta " + id, set: "Set", setId: "s1", number: "1", variants: ["Normal"], game }, extra);
const daBorda = (cards, pricing) => ({ cards, pricing, indexesByGame: {}, viaApi: true, parcial: false });
const respiro = () => new Promise((ok) => setTimeout(ok, 5));
const PEDIDO = { pokemon: ["a", "b"], magic: ["m"] };
const cartas = () => [carta("a", "pokemon"), carta("b", "pokemon"), carta("m", "magic")];
const precos = () => ({ a: { usd: 1 }, b: { usd: 2 }, m: { usd: 3 } });

// Primeira visita: grava a cópia e devolve o cache pra próxima.
async function comCopia() {
  const caches = cachesDeMentira();
  const pag = sobe(caches, [daBorda(cartas(), precos())]);
  await pag.carrega(PEDIDO, "colecao", () => {});
  await respiro();
  caches.conta.gravacoes = 0;
  return caches;
}

test("sem cópia: uma pintura só, com a resposta da rede, e a cópia fica gravada", async () => {
  const caches = cachesDeMentira();
  const pag = sobe(caches, [daBorda(cartas(), precos())]);
  const pinturas = [];
  const r = await pag.carrega(PEDIDO, "colecao", (res, repetido) => pinturas.push({ res, repetido }));
  await respiro();
  assert.equal(pinturas.length, 1);
  assert.equal(pinturas[0].repetido, false);
  assert.equal(pinturas[0].res.guardado, undefined);
  assert.equal(pinturas[0].res.parcial, false);
  assert.equal(r.cards.length, 3);
  assert.deepEqual(JSON.parse(caches.caixas.get(CACHE).get("/guardado/colecao.json")),
    { cards: cartas(), pricing: precos() });
});

test("com cópia igual: a cópia pinta primeiro (guardado, parcial) e a rede chega como repetido, sem regravar", async () => {
  const caches = await comCopia();
  const pag = sobe(caches, [daBorda(cartas(), precos())]);
  const pinturas = [];
  await pag.carrega(PEDIDO, "colecao", (res, repetido) => pinturas.push({ res, repetido }));
  await respiro();
  assert.equal(pinturas.length, 2);
  assert.deepEqual(pinturas[0].res.cards, cartas());
  assert.equal(pinturas[0].res.guardado, true);
  assert.equal(pinturas[0].res.parcial, true, "cópia nunca grava o ponto do dia");
  assert.equal(pinturas[0].res.viaApi, true);
  assert.equal(pinturas[0].repetido, false);
  assert.equal(pinturas[1].repetido, true);
  assert.equal(pinturas[1].res.guardado, undefined);
  assert.equal(pinturas[1].res.parcial, false);
  assert.equal(caches.conta.gravacoes, 0);
});

test("rede mais rápida que a cópia: pinta uma vez só, direto da rede", async () => {
  const caches = await comCopia();
  const respostas = [daBorda(cartas(), precos())];
  respostas.naHora = true;
  const pag = sobe(caches, respostas);
  const pinturas = [];
  await pag.carrega(PEDIDO, "colecao", (res, repetido) => pinturas.push([!!res.guardado, repetido]));
  assert.deepEqual(pinturas, [[false, false]]);
});

test("a cópia põe os preços dela na tabela da sessão antes de pintar", async () => {
  const caches = await comCopia();
  let naPintura = null;
  // Rede que nunca responde: o que está na tabela veio da cópia.
  const pag = sobe(caches, [() => new Promise(() => {})]);
  pag.carrega(PEDIDO, "colecao", () => { naPintura = Object.assign({}, pag.window.TCG_PRICING); });
  await respiro();
  assert.deepEqual(naPintura, precos());
});

test("preço mudou: a rede redesenha, a cópia é trocada e o preço que saiu da tabela some", async () => {
  const caches = await comCopia();
  const novos = { a: { usd: 9 }, m: { usd: 3 } }; // o `b` perdeu a cotação
  const pag = sobe(caches, [daBorda(cartas(), novos)]);
  const pinturas = [];
  await pag.carrega(PEDIDO, "colecao", (res, repetido) => pinturas.push({ res, repetido }));
  await respiro();
  assert.equal(pinturas.length, 2);
  assert.equal(pinturas[1].repetido, false);
  assert.deepEqual(pag.window.TCG_PRICING, novos);
  assert.equal(caches.conta.gravacoes, 1);
  assert.deepEqual(JSON.parse(caches.caixas.get(CACHE).get("/guardado/colecao.json")).pricing, novos);
});

test("carta que saiu do pedido não volta pra tela, e a resposta não conta como repetida", async () => {
  const caches = await comCopia();
  const menor = { pokemon: ["a"], magic: ["m"] };
  const resposta = daBorda([carta("a", "pokemon"), carta("m", "magic")], { a: { usd: 1 }, m: { usd: 3 } });
  const pag = sobe(caches, [resposta]);
  const pinturas = [];
  await pag.carrega(menor, "colecao", (res, repetido) => pinturas.push({ ids: res.cards.map((c) => c.id), repetido }));
  assert.deepEqual(pinturas, [{ ids: ["a", "m"], repetido: false }, { ids: ["a", "m"], repetido: false }]);
});

test("o id pedido em outro jogo não puxa a carta da cópia (slab é pedido a todos os jogos)", async () => {
  const caches = await comCopia();
  const pag = sobe(caches, [() => new Promise(() => {})]);
  const vistas = [];
  pag.carrega({ pokemon: ["m"], magic: ["a", "m"] }, "colecao", (res) => vistas.push(res.cards.map((c) => c.game + ":" + c.id)));
  await respiro();
  assert.deepEqual(vistas, [["magic:m"]]);
});

test("cada nome tem a sua cópia: a do Explorar não pinta na Coleção", async () => {
  const caches = await comCopia();
  const pag = sobe(caches, [daBorda(cartas(), precos())]);
  const pinturas = [];
  await pag.carrega(PEDIDO, "explorar", (res, repetido) => pinturas.push(repetido));
  assert.deepEqual(pinturas, [false]);
});

test("sem rede, com cópia: a cópia fica na tela e a promessa resolve null", async () => {
  const caches = await comCopia();
  const pag = sobe(caches, [() => Promise.reject(new Error("offline"))]);
  const pinturas = [];
  const r = await pag.carrega(PEDIDO, "colecao", (res) => pinturas.push(res.guardado));
  assert.equal(r, null);
  assert.deepEqual(pinturas, [true]);
});

test("sem rede e sem cópia: o erro sobe pra página mostrar", async () => {
  const pag = sobe(cachesDeMentira(), [() => Promise.reject(new Error("offline"))]);
  await assert.rejects(pag.carrega(PEDIDO, "colecao", () => {}), /offline/);
});

test("borda fora e chunks incompletos: a cópia na tela não é trocada por meia coleção", async () => {
  const caches = await comCopia();
  const meia = { cards: [carta("a", "pokemon")], indexesByGame: {}, viaApi: false, parcial: true };
  const pag = sobe(caches, [meia]);
  const pinturas = [];
  const r = await pag.carrega(PEDIDO, "colecao", (res) => pinturas.push(res.cards.length));
  await respiro();
  assert.equal(r, null);
  assert.deepEqual(pinturas, [3]);
  assert.equal(caches.conta.gravacoes, 0);
});

test("resposta pelos chunks (borda fora, catálogo inteiro) redesenha, mas não vira cópia", async () => {
  const caches = await comCopia();
  const pelosChunks = { cards: cartas(), indexesByGame: { pokemon: {} }, viaApi: false, parcial: false };
  const pag = sobe(caches, [pelosChunks]);
  const pinturas = [];
  await pag.carrega(PEDIDO, "colecao", (res, repetido) => pinturas.push([!!res.guardado, repetido]));
  await respiro();
  assert.deepEqual(pinturas, [[true, false], [false, false]]);
  assert.equal(caches.conta.gravacoes, 0);
});

test("resposta sem a tabela de preços não vira cópia (pintaria a coleção valendo zero)", async () => {
  const caches = cachesDeMentira();
  const semPrecos = { cards: cartas(), indexesByGame: {}, viaApi: true, parcial: false };
  const pag = sobe(caches, [semPrecos]);
  await pag.carrega(PEDIDO, "colecao", () => {});
  await respiro();
  assert.equal(caches.conta.gravacoes, 0);
});

test("resposta vazia não apaga a cópia boa", async () => {
  const caches = await comCopia();
  const pag = sobe(caches, [daBorda([], {})]);
  await pag.carrega(PEDIDO, "colecao", () => {});
  await respiro();
  assert.equal(caches.conta.gravacoes, 0);
  assert.equal(JSON.parse(caches.caixas.get(CACHE).get("/guardado/colecao.json")).cards.length, 3);
});

test("a cópia guarda o que a borda mandou, não o campo que a página acrescenta depois", async () => {
  const caches = cachesDeMentira();
  const pag = sobe(caches, [daBorda(cartas(), precos())]);
  await pag.carrega(PEDIDO, "colecao", (res) => { res.cards.forEach((c) => { c.setTotal = 102; }); });
  await respiro();
  assert.ok(!caches.caixas.get(CACHE).get("/guardado/colecao.json").includes("setTotal"));
});

test("a pintura espera o câmbio; o pedido à rede sai na hora", async () => {
  const caches = await comCopia();
  const pag = sobe(caches, [daBorda(cartas(), precos())]);
  let solta;
  const cambio = new Promise((ok) => { solta = ok; });
  const pinturas = [];
  const fim = pag.carrega(PEDIDO, "colecao", (res, repetido) => pinturas.push(repetido), cambio);
  assert.equal(pag.pedidos.length, 1, "o pedido não pode esperar o câmbio nem a leitura da cópia");
  await respiro();
  assert.deepEqual(pinturas, []);
  solta();
  await fim;
  assert.deepEqual(pinturas, [false, true]);
});

test("sem Cache Storage (http, WebView antiga): segue só pela rede", async () => {
  const semCaches = { open: () => { throw new ReferenceError("caches is not defined"); } };
  const pag = sobe(semCaches, [daBorda(cartas(), precos())]);
  const pinturas = [];
  const r = await pag.carrega(PEDIDO, "colecao", (res, repetido) => pinturas.push(repetido));
  assert.deepEqual(pinturas, [false]);
  assert.equal(r.cards.length, 3);
});

test("cópia torta no aparelho não derruba a página", async () => {
  const caches = cachesDeMentira();
  (await caches.open(CACHE)).put("/guardado/colecao.json", new Response("{isto não é json"));
  await respiro();
  const pag = sobe(caches, [daBorda(cartas(), precos())]);
  const pinturas = [];
  await pag.carrega(PEDIDO, "colecao", (res, repetido) => pinturas.push(repetido));
  assert.deepEqual(pinturas, [false]);
});

test("o nome do cache é o mesmo no módulo, no sw.js (que o mantém) e no apagar conta", () => {
  assert.ok(modulo.includes(`const CACHE = "${CACHE}";`));
  const sw = fonte("sw.js");
  assert.ok(sw.includes(`const COLECAO_CACHE = "${CACHE}";`));
  const lista = sw.slice(sw.indexOf("const CACHES = ["), sw.indexOf("];", sw.indexOf("const CACHES = [")));
  assert.ok(lista.includes("COLECAO_CACHE"), "fora do CACHES o activate apaga a cópia a cada deploy");
  const shared = fonte("src/shared.js");
  const apaga = shared.slice(shared.indexOf("async function deleteAccountFlow()"));
  assert.ok(apaga.slice(0, 1600).includes(`await caches.delete("${CACHE}")`), "apagar conta e dados tem de levar a cópia junto");
});

test("o loadOwnedFast devolve a tabela de preços DESTA resposta, que é o que a cópia guarda", () => {
  const shared = fonte("src/shared.js");
  assert.ok(shared.includes("return Object.assign(viaApi, { indexesByGame: {}, viaApi: true, parcial: !!viaApi.parcial });"));
});

test("as três telas usam a cópia e carregam o módulo antes do script delas; o sw.js o precacheia", () => {
  const telas = [
    ["collection", 'window.TCGGuardada.carrega(shared.collectionLoadIds(ownedByGame), "colecao", recebe, shared.loadFxRates())'],
    ["dashboard", 'window.TCGGuardada.carrega(idsByGame, "colecao", hidrata, shared.loadFxRates())'],
    ["explore", 'window.TCGGuardada.carrega(idsByGame, "explorar",']
  ];
  for (const [tela, chamada] of telas) {
    assert.ok(fonte(`src/${tela}.js`).includes(chamada), `${tela}.js não usa a cópia guardada`);
    const html = fonte(`${tela}.html`);
    const modPos = html.indexOf('<script defer src="src/colecao-guardada.js"></script>');
    const telaPos = html.indexOf(`<script defer src="src/${tela}.js"></script>`);
    const sharedPos = html.indexOf('<script defer src="src/shared.js"');
    assert.ok(modPos > sharedPos && sharedPos > 0, `${tela}.html: o módulo vem depois do shared.js`);
    assert.ok(telaPos > modPos, `${tela}.html: o módulo vem antes do ${tela}.js`);
  }
  assert.ok(fonte("sw.js").includes('"src/colecao-guardada.js"'), "fora do SHELL_ASSETS a tela quebra offline");
});

test("Coleção e Painel não gravam o ponto do dia nem republicam o perfil com a cópia", () => {
  const colecao = fonte("src/collection.js");
  const recebe = colecao.slice(colecao.indexOf("const recebe = (result, repetido) => {"), colecao.indexOf('window.TCGGuardada.carrega('));
  // O ponto do dia segue atrás do `parcial` (que a cópia sempre traz)...
  assert.ok(recebe.includes("if (!result.parcial) {"));
  // ...e o perfil público só sai depois de a rede responder.
  assert.ok(recebe.includes("if (!result.guardado) confirmado = true;"));
  assert.equal(recebe.split("shared.publishProfile(cards, owned, prices)").length - 1, 3);
  assert.equal(recebe.split("if (confirmado) shared.publishProfile(cards, owned, prices)").length - 1, 2,
    "na Coleção pela borda, publicar só com a rede confirmada");
  const painel = fonte("src/dashboard.js");
  const hidrata = painel.slice(painel.indexOf("const hidrata = (catalog, repetido) => {"), painel.indexOf('window.TCGGuardada.carrega('));
  const grava = hidrata.indexOf("if (!catalog.parcial) {");
  const sai = hidrata.indexOf("if (repetido) return;");
  assert.ok(grava > 0 && sai > grava, "o ponto do dia é gravado antes de o `repetido` sair sem redesenhar");
});
