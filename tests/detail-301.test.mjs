// 301 do link de set do app pro endereço /games/… (functions/detail.js).
//
// O app linka /detail?type=set&… (Impressões do popup, nome do set, grade de
// Sets), que é uma casca `noindex`. O Googlebot seguia esses links e gastava
// rastreio em página que nunca entra no índice (Search Console de 12/10/2026:
// "Excluída pela tag noindex" de 1.875 pra 5.427 em quatro dias). Agora o link
// de set puro responde 301 pra tela do set ou da carta no endereço próprio.
//
// Aqui roda o onRequestGet de verdade com um env.ASSETS de mentira (mapas e
// chunks em memória). O redirect volta antes do HTMLRewriter, que não existe
// em node; o caminho da casca cai no catch e devolve a casca crua.
//
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestGet, pedidoDeSet, urlsDoJogo, setsPeloNome, setsPeloId } from "../functions/detail.js";

const CASCA = "<!doctype html><title>Detalhe</title>";

const ARQUIVOS = {
  "/detail.html": CASCA,
  "/data/game-pages/pokemon.json": {
    s: {
      "sv03-5-151": { n: "151", f: ["data/sets/en/sv03.5.json", "data/sets/pt/sv03.5.json"] },
      // O mesmo setId em duas edições: a japonesa e a chinesa (caso real do S12a).
      "vstar": { n: "VSTARユニバース", f: ["data/sets/ja/S12a.json"] },
      "vstar-2": { n: "VSTAR 特別組合", f: ["data/sets/zh-tw/S12a.json"] }
    }
  },
  "/data/sets/en/sv03.5.json": [
    { id: "sv03.5-1", name: "Bulbasaur", number: "001", setTotal: "165", set: "151", language: "en" },
    { id: "sv03.5-2", name: "Ivysaur", number: "002", setTotal: "165", set: "151", language: "en" }
  ],
  "/data/sets/pt/sv03.5.json": [
    { id: "sv03.5-1-pt", name: "Bulbasaur", number: "001", setTotal: "165", set: "151", language: "pt" }
  ],
  "/data/sets/ja/S12a.json": [
    { id: "S12a-205", name: "ピカチュウ", nameEn: "Pikachu", number: "205", setTotal: "172", set: "VSTARユニバース", language: "ja" }
  ],
  "/data/sets/zh-tw/S12a.json": [
    { id: "S12a-205-zh-tw", name: "皮卡丘", nameEn: "Pikachu", number: "205", setTotal: "172", set: "VSTAR 特別組合", language: "zh-tw" }
  ],
  // Naruto: quatro endereços na mesma marca. Os vintage guardam o chunk em
  // data/<jogo>/sets/, sem pasta de idioma. Só dois mapas existem aqui: os
  // outros dão 404 e a busca segue.
  "/data/game-pages/naruto-data-carddass.json": {
    s: { "data-carddass-1": { n: "Data Carddass — 第１弾", f: ["data/naruto/sets/nrt-dc-s01.json"] } }
  },
  "/data/game-pages/naruto-card-game-2002.json": {
    s: { "nrt-s04": { n: "Naruto S04", f: ["data/naruto/sets/nrt-s04.json"] } }
  },
  "/data/naruto/sets/nrt-dc-s01.json": [
    { id: "nrt-dc-s01-001", name: "うずまきナルト", nameEn: "Naruto Uzumaki", number: "NM-001", set: "Data Carddass — 第１弾", language: "ja" }
  ],
  "/data/naruto/sets/nrt-s04.json": []
};

const env = {
  ASSETS: {
    async fetch(pedido) {
      // jsonDoSite manda URL; buscaPagina, Request.
      const caminho = new URL(pedido instanceof Request ? pedido.url : String(pedido)).pathname;
      if (!Object.prototype.hasOwnProperty.call(ARQUIVOS, caminho)) return new Response("não achou", { status: 404 });
      const corpo = ARQUIVOS[caminho];
      // A casca sai como texto puro: o comVitrine só reescreve HTML (e o
      // HTMLRewriter não existe em node).
      return typeof corpo === "string"
        ? new Response(corpo, { status: 200, headers: { "content-type": "text/plain" } })
        : new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
    }
  }
};

async function abre(query) {
  const request = new Request(`https://sleevu.app/detail?${query}`);
  return onRequestGet({ env, request });
}
async function destino(query) {
  const r = await abre(query);
  return r.status === 301 ? r.headers.get("location").replace("https://sleevu.app", "") : `${r.status} casca`;
}

test("carta do popup (nome + setId + card) vai pra página da carta", async () => {
  assert.equal(await destino("type=set&name=151&card=sv03.5-1&setId=sv03.5&game=pokemon"), "/games/pokemon/sv03-5-151/bulbasaur-001-165");
  // A edição PT mora na mesma página do set e ganha o -pt no fim.
  assert.equal(await destino("type=set&name=151&card=sv03.5-1-pt&setId=sv03.5&game=pokemon"), "/games/pokemon/sv03-5-151/bulbasaur-001-165-pt");
});

test("link do set (grade de Sets, nome do set no popup) vai pra página do set", async () => {
  assert.equal(await destino("type=set&name=151&setId=sv03.5&game=pokemon"), "/games/pokemon/sv03-5-151");
  // Sem ?game= o detail é Pokémon (a mesma regra da casca).
  assert.equal(await destino("type=set&name=151"), "/games/pokemon/sv03-5-151");
});

// Set de nome não-ASCII: o detailUrl tira o nome e deixa só o setId. O S12a
// é a japonesa E a chinesa; a carta do link diz qual.
test("só setId com a carta: a carta desempata a edição", async () => {
  assert.equal(await destino("type=set&card=S12a-205-zh-tw&setId=S12a&game=pokemon"), "/games/pokemon/vstar-2/pikachu-205-172-zh");
  assert.equal(await destino("type=set&card=S12a-205&setId=S12a&game=pokemon"), "/games/pokemon/vstar/pikachu-205-172-jp");
});

test("só setId sem carta: a região desempata; sem ela, fica na casca", async () => {
  assert.equal(await destino("type=set&setId=S12a&region=japanese&game=pokemon"), "/games/pokemon/vstar");
  assert.equal(await destino("type=set&setId=S12a&region=chinese&game=pokemon"), "/games/pokemon/vstar-2");
  assert.equal(await destino("type=set&setId=S12a&game=pokemon"), "200 casca");
});

test("linha vintage: pelo prefixo do setId e, sem ele, pelo nome nos outros mapas", async () => {
  assert.equal(await destino("type=set&setId=nrt-dc-s01&game=naruto"), "/games/naruto-data-carddass/data-carddass-1");
  assert.equal(await destino("type=set&card=nrt-dc-s01-001&setId=nrt-dc-s01&game=naruto"),
    "/games/naruto-data-carddass/data-carddass-1/naruto-uzumaki-nm-001-jp");
  // O link da lista de desejos não leva setId: o nome acha o set fora do mapa principal.
  assert.equal(await destino(`type=set&name=${encodeURIComponent("Data Carddass — 第１弾")}&game=naruto`), "/games/naruto-data-carddass/data-carddass-1");
});

test("o que não é link de set puro fica na casca", async () => {
  // A tela "dentro da coleção" não tem endereço próprio.
  assert.equal(await destino("type=set&name=151&setId=sv03.5&game=pokemon&scope=collection"), "200 casca");
  // Parâmetro que o redirect perderia (utm, filtro…).
  assert.equal(await destino("type=set&name=151&game=pokemon&utm_source=x"), "200 casca");
  // Pokémon, artista e treinador seguem em /detail.
  assert.equal(await destino("type=pokemon&name=Pikachu&game=pokemon"), "200 casca");
  assert.equal(await destino("type=artist&name=Mitsuhiro+Arita&game=pokemon"), "200 casca");
});

test("set ou carta que não se acha fica na casca", async () => {
  assert.equal(await destino("type=set&name=Set+Que+Nao+Existe&game=pokemon"), "200 casca");
  assert.equal(await destino("type=set&name=151&card=nao-existe&game=pokemon"), "200 casca");
  assert.equal(await destino("type=set&name=151&game=jogo-que-nao-existe"), "200 casca");
  assert.equal(await destino("type=set&game=pokemon"), "200 casca");
});

test("pedidoDeSet só aceita os parâmetros do link de set", () => {
  const p = (q) => pedidoDeSet(new URLSearchParams(q));
  assert.deepEqual(p("type=set&name=151&setId=sv03.5&game=pokemon&card=x&region=english"),
    { game: "pokemon", name: "151", setId: "sv03.5", region: "english", card: "x" });
  assert.equal(p("type=set&name=151&scope=collection"), null);
  assert.equal(p("type=trainer&name=Ash"), null);
  assert.equal(p("type=set"), null);
});

test("urlsDoJogo põe a linha do setId na frente e as outras da marca depois", () => {
  const naruto = urlsDoJogo("naruto", "nrt-dc-s01");
  assert.equal(naruto[0], "naruto-data-carddass");
  assert.deepEqual([...naruto].sort(), ["naruto-card-game", "naruto-card-game-2002", "naruto-ccg", "naruto-data-carddass"]);
  assert.deepEqual(urlsDoJogo("pokemon", "sv03.5"), ["pokemon"]);
  assert.deepEqual(urlsDoJogo("nao-existe", ""), []);
});

// O nome e o id vêm da URL: chave de protótipo não pode virar set.
test("chave de protótipo não passa por set", () => {
  const sets = ARQUIVOS["/data/game-pages/pokemon.json"].s;
  assert.deepEqual(setsPeloNome(sets, "constructor"), []);
  assert.deepEqual(setsPeloNome(sets, "__proto__"), []);
  assert.deepEqual(setsPeloId(sets, "__proto__", ""), []);
  assert.deepEqual(urlsDoJogo("__proto__", ""), []);
});
