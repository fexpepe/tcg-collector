// Export de listas (src/export-liga.js): linhas douradas por jogo pro formato
// "Compra por Lista" da Liga, o texto do site e o CSV. É lógica pura — carrega
// num vm mínimo, sem stub de DOM (mesmo padrão do deck-rules.test.mjs). Só as
// cartas dos 30 anos rodam com o shared.js no mesmo sandbox: a regra delas
// mora lá (ligaSpecialCode), como no navegador.
// Ver docs/LISTAS.md §6. Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { loadShared } from "./lib/shared-sandbox.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function loadExport() {
  const src = readFileSync(join(here, "..", "src", "export-liga.js"), "utf8");
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.TCGExportLiga;
}
const X = loadExport();

// Cartas reais do catálogo (ids e campos como estão em data/<jogo>/cards.js).
const MAGIC = {
  "mtg-hob-283": { id: "mtg-hob-283", name: "The Arkenstone // Seek the Heart", set: "The Hobbit", number: "283" },
  "mtg-hob-33": { id: "mtg-hob-33", name: "Bilbo, Thief in the Night", set: "The Hobbit", number: "33" }
};
const POKEMON = {
  "sv08-078": { id: "sv08-078", name: "Gwynn", set: "Pitch Black", number: "78", setTotal: "84" },
  "sv08-116": { id: "sv08-116", name: "Mega Darkrai ex", set: "Pitch Black", number: "116", setTotal: "84" },
  "sv08-078-pt": { id: "sv08-078-pt", name: "Gwynn", set: "Pitch Black", number: "78", setTotal: "84" }
};
const ONEPIECE = {
  "op-544524": { id: "op-544524", name: "Kouzuki Oden (Alternate Art)", set: "Memorial Collection", number: "EB01-001" }
};

test("Magic: qualidade + edicao da sigla do id + extras foil", () => {
  const out = X.paraLiga(
    [{ id: "mtg-hob-33", v: "Foil", q: 1, c: "NM" }],
    MAGIC, "magic"
  );
  assert.equal(out, "1 Bilbo, Thief in the Night [QUALIDADE=NM] [EDICAO=HOB] [EXTRAS=foil]");
});

test("Magic: nome com // preservado (carta de duas faces)", () => {
  const out = X.paraLiga([{ id: "mtg-hob-283", v: "Normal", q: 2, c: "SP" }], MAGIC, "magic");
  assert.equal(out, "2 The Arkenstone // Seek the Heart [QUALIDADE=SP] [EDICAO=HOB]");
});

test("Pokemon: numero impresso (NNN/TTT) com zero a esquerda, sem EDICAO", () => {
  const out = X.paraLiga([{ id: "sv08-078", v: "Normal", q: 1, c: "NM" }], POKEMON, "pokemon");
  assert.equal(out, "1 Gwynn (078/084) [QUALIDADE=NM]");
});

test("Pokemon: numero acima do total do set mantem o formato impresso", () => {
  // 116/084 é como está impresso numa secret rare — não é erro de dado.
  const out = X.paraLiga([{ id: "sv08-116", v: "Normal", q: 2, c: "NM" }], POKEMON, "pokemon");
  assert.equal(out, "2 Mega Darkrai ex (116/084) [QUALIDADE=NM]");
});

test("Pokemon: carta -pt sai com IDIOMA=PT", () => {
  const out = X.paraLiga([{ id: "sv08-078-pt", v: "Reverse", q: 1, c: "NM" }], POKEMON, "pokemon");
  assert.equal(out, "1 Gwynn (078/084) [QUALIDADE=NM] [IDIOMA=PT] [EXTRAS=reverse holo]");
});

test("One Piece: sufixo (Alternate Art) sai do nome e vira EXTRAS", () => {
  // A Liga não acha "Kouzuki Oden (Alternate Art)" — o nome tem que ir limpo.
  const out = X.paraLiga([{ id: "op-544524", v: "Foil", q: 1, c: "NM" }], ONEPIECE, "onepiece");
  assert.equal(out, "1 Kouzuki Oden [QUALIDADE=NM] [EXTRAS=foil, alternate art]");
});

test("entrada migrada de tag (v e q nulos) vale 1 copia em NM", () => {
  const out = X.paraLiga([{ id: "mtg-hob-33", v: null, q: null, c: null }], MAGIC, "magic");
  assert.equal(out, "1 Bilbo, Thief in the Night [QUALIDADE=NM] [EDICAO=HOB]");
});

test("carta fora do catalogo cai no id, sem quebrar a lista inteira", () => {
  const out = X.paraLiga([{ id: "sumiu-1", q: 3, c: "MP" }], {}, "magic");
  assert.equal(out, "3 sumiu-1 [QUALIDADE=MP]");
});

test("varias linhas saem uma por linha, na ordem da lista", () => {
  const out = X.paraLiga(
    [{ id: "mtg-hob-33", v: "Normal", q: 1, c: "NM" }, { id: "mtg-hob-283", v: "Normal", q: 1, c: "NM" }],
    MAGIC, "magic"
  );
  assert.deepEqual(out.split("\n").length, 2);
});

test("texto puro e o mesmo formato que o import de deck do site le", () => {
  const out = X.paraTexto([{ id: "mtg-hob-33", q: 4 }, { id: "mtg-hob-283", q: 1 }], MAGIC);
  assert.equal(out, "4 Bilbo, Thief in the Night\n1 The Arkenstone // Seek the Heart");
});

test("CSV do Magic sai no cabecalho do Moxfield", () => {
  const out = X.paraCsv([{ id: "mtg-hob-33", v: "Foil", q: 2, c: "NM" }], MAGIC, "magic");
  const [head, linha] = out.split("\n");
  assert.equal(head, "Count,Name,Edition,Condition,Language,Foil");
  assert.equal(linha, "2,\"Bilbo, Thief in the Night\",HOB,NM,English,foil");
});

test("CSV do Magic: etched nao vira foil comum", () => {
  const out = X.paraCsv([{ id: "mtg-hob-33", v: "Etched", q: 1, c: "NM" }], MAGIC, "magic");
  assert.ok(out.split("\n")[1].endsWith(",etched"));
});

test("CSV dos demais jogos usa o separador do site", () => {
  const out = X.paraCsv([{ id: "sv08-078", v: "Reverse", q: 1, c: "NM" }], POKEMON, "pokemon");
  assert.equal(out.split("\n")[0], "Quantidade;Nome;Set;Número;Variante;Condição");
  assert.equal(out.split("\n")[1], "1;Gwynn;Pitch Black;78;Reverse;NM");
});

test("exportar() roteia pelos tres formatos", () => {
  const e = [{ id: "mtg-hob-33", v: "Normal", q: 1, c: "NM" }];
  assert.ok(X.exportar("liga", e, MAGIC, "magic").includes("[QUALIDADE=NM]"));
  assert.equal(X.exportar("texto", e, MAGIC, "magic"), "1 Bilbo, Thief in the Night");
  assert.ok(X.exportar("csv", e, MAGIC, "magic").startsWith("Count,Name"));
});

test("lista vazia devolve string vazia (nao quebra o modal)", () => {
  assert.equal(X.paraLiga([], {}, "magic"), "");
  assert.equal(X.paraTexto(null, {}), "");
});

test("numeroPokemon: número que já traz o total não ganha o total de novo", () => {
  // "(4/102/102)" não casa com nada na busca da Liga. O catálogo de produção
  // grava só "4", mas uma fonte que grave "4/102" transformaria a linha em lixo.
  assert.equal(X.numeroPokemon({ number: "4/102", setTotal: 102 }), "(4/102)");
  assert.equal(X.numeroPokemon({ number: "78", setTotal: "84" }), "(078/084)");
  assert.equal(X.numeroPokemon({ number: "78" }), "(078)");
  assert.equal(X.numeroPokemon({}), "");
});

// ── Cartas dos 30 anos (29/09/2026) ──────────────────────────────────────────
// A Liga cataloga duas famílias do jeito dela, e a regra é a da busca da Liga,
// que mora no shared.js (ligaSpecialCode). Aqui o export roda no MESMO sandbox
// do shared, como no navegador, com as cartas reais de data/sets/.
function loadExportComShared() {
  const sandbox = loadShared("window.__test = { ligaPokemonQuery };");
  vm.runInContext(readFileSync(join(here, "..", "src", "export-liga.js"), "utf8"), sandbox);
  return { XS: sandbox.window.TCGExportLiga, busca: sandbox.window.__test.ligaPokemonQuery };
}
const { XS, busca } = loadExportComShared();
const CARTAS_30 = {};
for (const lang of ["en", "pt"]) {
  for (const setId of ["30th", "30th-c"]) {
    const cartas = JSON.parse(readFileSync(join(here, "..", "data", "sets", lang, `${setId}.json`), "utf8"));
    cartas.forEach((card) => { CARTAS_30[card.id] = card; });
  }
}
const linha30 = (id) => XS.paraLiga([{ id, v: "Normal", q: 1, c: "NM" }], CARTAS_30, "pokemon");

test("Classic Collection dos 30 anos: número da carta antiga com três dígitos, total sem zero", () => {
  // Ia "1 Gengar (018/030)" — a numeração sequencial da TCGdex — e a Liga não achava.
  assert.equal(linha30("30th-c-018"), "1 Gengar (094/30) [QUALIDADE=NM]");
  assert.equal(linha30("30th-c-001"), "1 Charizard (004/30) [QUALIDADE=NM]");
  assert.equal(linha30("30th-c-029"), "1 Lugia (149/30) [QUALIDADE=NM]");
  // PT ("Coleção Clássica de 30 Anos"): mesma numeração, com IDIOMA=PT.
  assert.equal(linha30("30th-c-018-pt"), "1 Gengar (094/30) [QUALIDADE=NM] [IDIOMA=PT]");
});

test("Mew RGB dos 30 anos: só o nome, que já traz o código", () => {
  // Ia "1 Mew - B/RGB (B/128)"; a Liga só tem "Mew - B/RGB".
  assert.equal(linha30("30th-B"), "1 Mew - B/RGB [QUALIDADE=NM]");
  assert.equal(linha30("30th-G"), "1 Mew - G/RGB [QUALIDADE=NM]");
  assert.equal(linha30("30th-R"), "1 Mew - R/RGB [QUALIDADE=NM]");
  assert.equal(linha30("30th-B-pt"), "1 Mew - B/RGB [QUALIDADE=NM] [IDIOMA=PT]");
});

test("com o shared carregado, o resto segue a regra de sempre", () => {
  assert.equal(XS.paraLiga([{ id: "sv08-078", v: "Normal", q: 1, c: "NM" }], POKEMON, "pokemon"), "1 Gwynn (078/084) [QUALIDADE=NM]");
  assert.equal(linha30("30th-001"), "1 Exeggcute (001/128) [QUALIDADE=NM]");
  // Mew RGB japonês (M6a): a exceção é só do EN/PT, a JP continua com o número.
  const mewJp = { id: "M6a-B-ja", name: "Mew - B/RGB", pokemonName: "Mew", number: "B", setId: "M6a", setTotal: "", language: "ja" };
  assert.equal(XS.paraLiga([{ id: mewJp.id, v: "Normal", q: 1, c: "NM" }], { [mewJp.id]: mewJp }, "pokemon"),
    "1 Mew - B/RGB (B) [QUALIDADE=NM] [IDIOMA=JP]");
  // Texto e CSV não passam pela regra da Liga.
  assert.equal(XS.paraTexto([{ id: "30th-B", q: 1 }], CARTAS_30), "1 Mew - B/RGB");
  assert.equal(XS.paraCsv([{ id: "30th-c-018", v: "Normal", q: 1, c: "NM" }], CARTAS_30, "pokemon").split("\n")[1],
    "1;Gengar;30th Classic Collection;018;Normal;NM");
});

// Export e busca da Liga (preview da carta) mandam o MESMO nome e número nos
// dois sets dos 30 anos, EN e PT: foi a divergência entre os dois que deixou o
// export pra trás quando a busca foi corrigida (d2047d4).
test("sets dos 30 anos: o export sai com o mesmo nome e número da busca da Liga", () => {
  for (const card of Object.values(CARTAS_30)) {
    const idioma = card.language === "pt" ? " [IDIOMA=PT]" : "";
    assert.equal(linha30(card.id), `1 ${busca(card)} [QUALIDADE=NM]${idioma}`, card.id);
    if (card.setId === "30th-c") assert.match(linha30(card.id), /\(\d{3}\/30\) \[/, card.id);
  }
});
