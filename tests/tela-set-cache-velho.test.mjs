// Tela de set vazia que o F5 consertava (2026-11-11).
//
// O service worker serve o manifest e o chunk do set do cache e revalida por
// trás, cada um só quando é pedido, e a tela cruza os dois pelo NOME do set.
// Quando eles vinham de levas diferentes (set renomeado, set que o manifest
// guardado não conhece, manifest que nem chegou), a tela dizia "Nenhuma carta
// encontrada nessa página" e só o F5 trazia as cartas. Visto em produção no
// Dragon Ball Carddass: o chunk do 第1弾 guardado de antes de 02/11 dizia
// "カードダス本弾 第1弾…", o manifest já dizia "本弾 第1弾…".
//
// O teste roda o bloco <cartas-do-set> e o resolveSetNameFromId do próprio
// detail.js, com o manifest, o recarregaManifest e os chunks de mentira.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const fonte = readFileSync(join(raiz, "src/detail.js"), "utf8");

function trecho(inicio, fim) {
  const i = fonte.indexOf(inicio);
  assert.ok(i > 0, `o detail.js perdeu: ${inicio}`);
  const f = fonte.indexOf(fim, i);
  assert.ok(f > i, `o detail.js perdeu o fim de: ${inicio}`);
  return fonte.slice(i, f + fim.length);
}
const BLOCO = trecho("// <cartas-do-set>", "// </cartas-do-set>");
const RESOLVE_NOME = trecho("function resolveSetNameFromId() {", "\n  }\n");

const NOME_VELHO = "カードダス本弾 第1弾「格闘技大決戦」";
const NOME_NOVO = "本弾 第1弾「格闘技大決戦」";
const ARQUIVO = "data/dbc/sets/dbc-h01.json";
const entrada = (name) => ({ id: "dbc-h01", name, language: "ja", file: ARQUIVO });
const manifest = (...sets) => ({ sets });
const cartas = (set) => [1, 2, 3].map((n) => ({ id: `dbc-h01-${n}`, set, setId: "dbc-h01" }));

// A tela com a URL dada (nome e/ou setId), o manifest que o game.js deixou e
// o que a releitura furando o cache traz. `chunk(url)` responde cada pedido.
function tela({ nome = "", setId = "", guardado, fresco = null, chunk }) {
  const window = { TCG_MANIFEST: guardado };
  const pedidos = [];
  let releituras = 0;
  const shared = {
    cardLanguageRegion: () => "japanese",
    fetchSetChunks: async (entries) => {
      const urls = entries.map((e) => e.file);
      pedidos.push(...urls);
      return [].concat(...urls.map(chunk));
    }
  };
  const recarregaManifest = async () => {
    releituras++;
    if (fresco) window.TCG_MANIFEST = fresco;
    return fresco;
  };
  const api = new Function("window", "shared", "recarregaManifest", `
    let detailName = ${JSON.stringify(nome)};
    let nomePeloId = false;
    const detailType = "set";
    const detailSetId = ${JSON.stringify(setId)};
    const detailRegion = "";
    const regiaoPedida = () => "";
    const pintaTituloDoSet = () => {};
    ${RESOLVE_NOME}
    ${BLOCO}
    return { resolveSetNameFromId, cartasDoSet, nome: () => detailName };
  `)(window, shared, recarregaManifest);
  return {
    pedidos,
    releituras: () => releituras,
    nome: api.nome,
    // A mesma ordem do resolveCards: nome pelo id, depois as cartas.
    async abre() { api.resolveSetNameFromId(); return api.cartasDoSet(); }
  };
}

test("caminho de sempre: manifest e chunk da mesma leva, um pedido e nenhuma releitura", async () => {
  const t = tela({ setId: "dbc-h01", guardado: manifest(entrada(NOME_NOVO)), chunk: () => cartas(NOME_NOVO) });
  const lista = await t.abre();
  assert.equal(lista.length, 3);
  assert.equal(t.nome(), NOME_NOVO);
  assert.deepEqual(t.pedidos, [ARQUIVO]);
  assert.equal(t.releituras(), 0);
});

test("chunk guardado de antes da renomeação: busca o chunk de novo furando o cache", async () => {
  const t = tela({
    setId: "dbc-h01",
    guardado: manifest(entrada(NOME_NOVO)),
    fresco: manifest(entrada(NOME_NOVO)),
    // A URL canônica sai do cache (velha); a com ?v= vai à rede (nova).
    chunk: (url) => cartas(url.includes("?v=") ? NOME_NOVO : NOME_VELHO)
  });
  const lista = await t.abre();
  assert.ok(lista.length && lista.every((c) => c.set === NOME_NOVO), "as cartas têm que vir com o nome do manifest");
  assert.equal(t.pedidos.length, 2);
  assert.match(t.pedidos[1], /^data\/dbc\/sets\/dbc-h01\.json\?v=\d+$/);
});

test("manifest guardado com o nome velho e chunk novo: o nome é resolvido de novo pelo setId", async () => {
  const t = tela({
    setId: "dbc-h01",
    guardado: manifest(entrada(NOME_VELHO)),
    fresco: manifest(entrada(NOME_NOVO)),
    chunk: () => cartas(NOME_NOVO)
  });
  const lista = await t.abre();
  assert.equal(t.nome(), NOME_NOVO);
  assert.ok(lista.some((c) => c.set === t.nome()));
});

test("link só com ?setId= de um set que o manifest guardado não conhece: relê o manifest", async () => {
  const t = tela({
    setId: "dbc-h01",
    guardado: manifest(),
    fresco: manifest(entrada(NOME_NOVO)),
    chunk: () => cartas(NOME_NOVO)
  });
  const lista = await t.abre();
  assert.equal(t.nome(), NOME_NOVO);
  assert.equal(lista.length, 3);
  assert.equal(t.releituras(), 1);
});

test("manifest que nem chegou (o <script> falhou): relê e abre o set", async () => {
  for (const url of [{ setId: "dbc-h01" }, { nome: NOME_NOVO }]) {
    const t = tela({ ...url, guardado: undefined, fresco: manifest(entrada(NOME_NOVO)), chunk: () => cartas(NOME_NOVO) });
    const lista = await t.abre();
    assert.equal(lista.length, 3, JSON.stringify(url));
    assert.equal(t.nome(), NOME_NOVO);
  }
});

test("set que não existe mesmo: uma releitura só e a tela vazia de sempre", async () => {
  const t = tela({ setId: "dbc-zz", guardado: manifest(entrada(NOME_NOVO)), fresco: manifest(entrada(NOME_NOVO)), chunk: () => cartas(NOME_NOVO) });
  assert.deepEqual(await t.abre(), []);
  assert.equal(t.releituras(), 1);
  assert.deepEqual(t.pedidos, []);
});
