// Prévia e canonical do link de SET compartilhado (functions/detail.js).
//
// O link que a pessoa copia da barra (/detail?type=set&...) é a casca do app:
// sem conteúdo no HTML, ele aparecia como URL pelada no WhatsApp e é `noindex`.
// A Function da borda troca título/descrição/imagem pelos do set e aponta a
// canonical pra /set/<slug>, a página estática indexável.
//
// O encanamento da borda (HTMLRewriter, env.ASSETS) não roda em node; o que dá
// pra testar — e o que tem regra de verdade — é a resolução do set no mapa que
// o build escreve e o texto que sai dali.
//
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { metaDoSet } from "../functions/detail.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

// [slug, nome, imagem, nº de cartas, lançamento] — o formato que o
// prerender-catalog.mjs escreve em data/set-pages/<jogo>.json.
const MAPA = {
  cel30: ["30th-celebration", "30th Celebration", "https://sleevu.app/data/set-logos/en/cel30.webp", 154, "2026-09-16"],
  cel30cc: ["30th-celebration-classic-collection", "30th Celebration Classic Collection", "", 30, ""],
  base1: ["base-set", "Base Set", "https://exemplo/logo.png", 102, "1999-01-09"]
};

test("acha o set pelo setId e monta canonical, título e descrição", () => {
  const m = metaDoSet(MAPA, "cel30", "30th Celebration");
  assert.equal(m.canonical, "https://sleevu.app/set/30th-celebration");
  assert.equal(m.titulo, "30th Celebration — lista de cartas | Sleevu");
  assert.match(m.desc, /154 cartas/);
  assert.match(m.desc, /16 de setembro de 2026/);
  assert.equal(m.imagem, "https://sleevu.app/data/set-logos/en/cel30.webp");
});

test("sem setId, acha pelo nome exato", () => {
  const m = metaDoSet(MAPA, "", "Base Set");
  assert.equal(m.canonical, "https://sleevu.app/set/base-set");
  assert.match(m.desc, /9 de janeiro de 1999/);
});

// O setId manda: os dois sets de 30 anos têm nomes em que um é PREFIXO do
// outro, e o link do app carrega os dois campos.
test("setId vence o nome quando os dois vêm no link", () => {
  const m = metaDoSet(MAPA, "cel30cc", "30th Celebration");
  assert.equal(m.setNome, "30th Celebration Classic Collection");
  assert.match(m.desc, /30 cartas/);
});

test("set sem lançamento não inventa data na descrição", () => {
  const m = metaDoSet(MAPA, "cel30cc", "");
  assert.doesNotMatch(m.desc, /lançado em/);
  assert.equal(m.imagem, ""); // sem logo, a prévia fica com a imagem genérica
});

test("id e nome desconhecidos devolvem null (a casca genérica serve)", () => {
  assert.equal(metaDoSet(MAPA, "nao-existe", ""), null);
  assert.equal(metaDoSet(MAPA, "", "Set Que Não Existe"), null);
  assert.equal(metaDoSet(MAPA, "", ""), null);
});

// Chave de protótipo não pode virar "set encontrado" (o id vem da URL).
test("chave de protótipo não passa por set", () => {
  assert.equal(metaDoSet(MAPA, "constructor", ""), null);
  assert.equal(metaDoSet(MAPA, "__proto__", ""), null);
  assert.equal(metaDoSet(MAPA, "toString", ""), null);
});

// O mapa é gerado no build (não versionado). Quando ele existe no working dir,
// confere que o formato é o que a Function espera — pega mudança de formato no
// prerender que passaria despercebida até alguém colar um link.
test("mapa gerado (se existir) casa com o formato esperado", () => {
  const arquivo = join(RAIZ, "data", "set-pages", "pokemon.json");
  if (!existsSync(arquivo)) return; // sem build local: nada a conferir
  const mapa = JSON.parse(readFileSync(arquivo, "utf8"));
  const ids = Object.keys(mapa);
  assert.ok(ids.length > 0, "mapa vazio");
  for (const id of ids.slice(0, 20)) {
    const linha = mapa[id];
    assert.ok(Array.isArray(linha) && linha.length === 5, `linha fora do formato em ${id}`);
    assert.equal(typeof linha[0], "string");
    assert.equal(typeof linha[1], "string");
    assert.equal(typeof linha[3], "number");
  }
  const m = metaDoSet(mapa, ids[0], "");
  assert.ok(m && m.canonical.startsWith("https://sleevu.app/set/"));
});
