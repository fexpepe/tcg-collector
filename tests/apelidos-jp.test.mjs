// Apelidos em romaji das cartas japonesas ("sasuke" acha うちはサスケ) saíram do
// núcleo (2026-11-28, pacote 4A do plano de revisão): a tabela mora em
// scripts/lib/apelidos-jp.mjs, o build grava o texto na carta (campo
// `apelidos`) e o cardSearchHaystack só junta `card.apelidos`.
//
// Este teste trava as três pontas:
//   1. a TABELA e a função, no módulo novo (e fora do shared.js);
//   2. os ESCRITORES (writeGameCatalog e o merge-catalogs do Pokémon), que são
//      quem carimba o campo em todo build;
//   3. o DADO versionado: nenhuma carta pode ter o campo diferente do que a
//      função calcula do nome — se alguém mexer na tabela ou no nome e esquecer
//      de regerar, a busca em romaji fica torta entre o deploy e o build seguinte.
// Roda com: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import {
  JP_NAME_ALIASES, jpNameAliases, apelidosDaCarta, carimbaApelido, carimbaApelidos
} from "../scripts/lib/apelidos-jp.mjs";
import { writeGameCatalog } from "../scripts/lib/sync-common.mjs";
import { loadShared } from "./lib/shared-sandbox.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
// Fim de linha do checkout Windows (CRLF) não pode reprovar o teste: o CI é LF.
const lerFonte = (rel) => readFileSync(join(raiz, rel), "utf8").replace(/\r\n/g, "\n");

// ── 1. A tabela e a função ──────────────────────────────────────────────────

test("a tabela mora no módulo novo, com as mesmas 111 entradas do shared.js de antes", () => {
  assert.equal(JP_NAME_ALIASES.length, 111);
  // Impressão da tabela como saiu do shared.js em 2026-11-28. Mexeu de propósito
  // (personagem novo)? Atualize este número E regere o dado (a prova do campo
  // abaixo reprova até regerar).
  const hash = createHash("sha256").update(JSON.stringify(JP_NAME_ALIASES)).digest("hex").slice(0, 16);
  assert.equal(hash, "641d24deaed227f6");
  const porNome = Object.fromEntries(JP_NAME_ALIASES);
  assert.deepEqual(porNome.sasuke, ["サスケ"]);
  assert.deepEqual(porNome.luffy, ["ルフィ"]);
  assert.deepEqual(porNome.killua, ["キルア"]);
});

test("a tabela e a função não voltaram pro shared.js", () => {
  const shared = lerFonte("src/shared.js");
  assert.ok(!shared.includes("JP_NAME_ALIASES"), "a tabela voltou pro núcleo");
  assert.ok(!shared.includes("jpNameAliases"), "a função voltou pro núcleo");
  assert.ok(shared.includes("card.apelidos"), "o cardSearchHaystack parou de ler o campo");
});

test("apelidosDaCarta: romaji dos nomes em japonês, na ordem da tabela, sem espaço nas pontas", () => {
  assert.equal(apelidosDaCarta({ name: "うちはサスケ" }), "sasuke");
  assert.equal(apelidosDaCarta({ name: "Monkey D. Luffy", nameJp: "モンキー・D・ルフィ" }), "luffy monkey");
  assert.equal(apelidosDaCarta({ name: "キルア＝ゾルディック" }), "killua zoldyck");
  // Só name + nameJp contam; latino puro, vazio e carta nula não ganham nada.
  assert.equal(apelidosDaCarta({ name: "Pikachu", nameEn: "サスケ" }), "");
  assert.equal(apelidosDaCarta({}), "");
  assert.equal(apelidosDaCarta(null), "");
  // A função do módulo devolve o texto com espaço na frente de cada termo (como
  // o shared.js devolvia); o campo da carta é esse texto sem as pontas.
  assert.equal(jpNameAliases("うちはサスケ"), " sasuke");
});

test("carimbaApelido: grava, regrava quando o nome muda, tira quando deixa de casar, e é idempotente", () => {
  const carta = { id: "x-1", name: "うちはサスケ" };
  assert.equal(carimbaApelido(carta), true);
  assert.equal(carta.apelidos, "sasuke");
  assert.equal(carimbaApelido(carta), false, "segunda passada não pode mudar nada");
  carta.name = "ナルト"; carta.nameJp = "";
  assert.equal(carimbaApelido(carta), true);
  assert.equal(carta.apelidos, "naruto");
  carta.name = "Naruto Uzumaki";
  assert.equal(carimbaApelido(carta), true);
  assert.ok(!("apelidos" in carta), "carta que deixou de casar perde o campo (nada de campo vazio no dado)");
  assert.equal(carimbaApelido(carta), false);
  const lista = [{ name: "サスケ" }, { name: "Pikachu" }, { name: "ルフィ" }];
  assert.equal(carimbaApelidos(lista), 2);
  assert.equal(carimbaApelidos(lista), 0);
  assert.equal(carimbaApelidos(null), 0);
});

// ── 2. O texto de busca lê o campo ──────────────────────────────────────────

test("matchesCardQuery acha pelo campo apelidos; sem o campo, o nome em japonês não casa o romaji", () => {
  const sb = loadShared();
  const { matchesCardQuery } = sb.window.TCGShared;
  const comCampo = { id: "a", name: "うちはサスケ", set: "Naruto", apelidos: "sasuke", variants: ["Normal"] };
  const semCampo = { id: "b", name: "うちはサスケ", set: "Naruto", variants: ["Normal"] };
  assert.equal(matchesCardQuery(comCampo, "sasuke"), true);
  assert.equal(matchesCardQuery(comCampo, "SASUKE"), true);
  assert.equal(matchesCardQuery(comCampo, "uchiha"), false);
  // O nome em japonês continua casando por si; o romaji só vem do campo.
  assert.equal(matchesCardQuery(semCampo, "うちは"), true);
  assert.equal(matchesCardQuery(semCampo, "sasuke"), false, "o núcleo não tem mais a tabela");
  // Mais de um termo: apelido + o resto do texto.
  // (carta nova: a anterior já guarda o texto memoizado em _haystack)
  assert.equal(matchesCardQuery({ id: "c", name: "うちはサスケ", number: "5", set: "Kayou", apelidos: "sasuke" }, "sasuke kayou"), true);
});

// ── 3. Os escritores ────────────────────────────────────────────────────────

test("writeGameCatalog carimba o campo em cards.js e no chunk do set, e tira de quem não casa mais", async () => {
  const dir = mkdtempSync(join(tmpdir(), "apelidos-jp-"));
  try {
    const cards = [
      { id: "t-1", name: "うちはサスケ", set: "Set A", setId: "seta", number: "1", language: "ja", variants: ["Normal"] },
      { id: "t-2", name: "Pikachu", set: "Set A", setId: "seta", number: "2", language: "en", variants: ["Normal"], apelidos: "sobra-de-nome-antigo" },
      { id: "t-3", name: "X", nameJp: "モンキー・D・ルフィ", set: "Set B", setId: "setb", number: "1", language: "ja", variants: ["Normal"] }
    ];
    await writeGameCatalog(pathToFileURL(dir + "/"), { cards, indexes: { sets: [], artists: [] }, pricing: {}, webDir: "data/teste/" });
    const lido = (rel) => readFileSync(join(dir, rel), "utf8");
    const monolito = JSON.parse(lido("cards.js").replace(/^window\.TCG_CARDS = /, "").replace(/;\s*$/, ""));
    assert.equal(monolito[0].apelidos, "sasuke");
    assert.ok(!("apelidos" in monolito[1]), "o campo velho de carta que não casa tem de sair");
    assert.equal(monolito[2].apelidos, "luffy monkey");
    const chunkA = JSON.parse(lido("sets/seta.json"));
    assert.equal(chunkA[0].apelidos, "sasuke");
    assert.ok(!("apelidos" in chunkA[1]));
    assert.equal(JSON.parse(lido("sets/setb.json"))[0].apelidos, "luffy monkey");
    // O índice de busca do construtor de decks (chaves curtas) não leva o campo.
    assert.ok(!lido("search-index.json").includes("apelidos"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("o merge-catalogs (Pokémon) carimba as cartas dos dois caminhos: chunk existente e set só da fonte de preço", () => {
  const merge = lerFonte("scripts/merge-catalogs.mjs");
  assert.ok(merge.includes('import { carimbaApelido } from "./lib/apelidos-jp.mjs";'));
  // laço dos chunks que já existem: o carimbo marca o chunk como mudado pra regravar
  assert.ok(merge.includes("if (carimbaApelido(card)) changed = true;"));
  // set criado do zero a partir da fonte de preço: carimba antes de gravar
  assert.ok(/carimbaApelido\(card\); \/\/ set que só existe na fonte de preço[^\n]*\n\s*cards\.push\(card\); have\.add\(nc\.id\);/.test(merge));
});

// ── 4. O dado versionado ────────────────────────────────────────────────────

function arquivosDeCatalogo() {
  const dados = join(raiz, "data");
  const lista = [];
  const chunks = (dir, jogo) => {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return;
    for (const f of readdirSync(dir)) if (f.endsWith(".json")) lista.push({ f: join(dir, f), json: true, jogo });
  };
  for (const d of readdirSync(dados)) {
    const p = join(dados, d);
    if (!statSync(p).isDirectory()) continue;
    if (d === "sets") { for (const l of ["en", "ja", "pt", "zh-cn", "zh-tw"]) chunks(join(p, l), "pokemon-" + l); continue; }
    if (existsSync(join(p, "cards.js"))) lista.push({ f: join(p, "cards.js"), json: false, jogo: d });
    chunks(join(p, "sets"), d);
  }
  return lista;
}

test("o dado versionado: o campo apelidos de TODA carta é o que a função calcula do nome (e só as que casam o têm)", () => {
  const arquivos = arquivosDeCatalogo();
  assert.ok(arquivos.length > 1500, "achou poucos arquivos de catálogo: " + arquivos.length);
  let cartas = 0, comCampo = 0;
  const achou = { sasuke: 0, luffy: 0, killua: 0 };
  const erros = [];
  for (const { f, json } of arquivos) {
    const texto = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
    const lista = JSON.parse(json ? texto : texto.slice(texto.indexOf("=") + 1).trim().replace(/;\s*$/, ""));
    for (const c of lista) {
      cartas++;
      const esperado = apelidosDaCarta(c);
      if ((c.apelidos || "") !== esperado) {
        if (erros.length < 5) erros.push(`${f.replace(raiz, "")} ${c.id}: campo=${JSON.stringify(c.apelidos)} esperado=${JSON.stringify(esperado)}`);
        continue;
      }
      if (esperado) {
        comCampo++;
        for (const k of Object.keys(achou)) if (esperado.split(" ").includes(k)) achou[k]++;
      }
    }
  }
  assert.deepEqual(erros, [], "carta com o campo torto — rode a regeneração (o escritor do jogo recalcula, ou o merge-catalogs no Pokémon)");
  assert.ok(cartas > 400000, "varreu poucas cartas: " + cartas);
  assert.ok(comCampo > 8000, "poucas cartas com apelidos: " + comCampo);
  // Os três exemplos do plano existem no dado (Naruto, One Piece, Hunter×Hunter).
  assert.ok(achou.sasuke > 0 && achou.luffy > 0 && achou.killua > 0, JSON.stringify(achou));
});
