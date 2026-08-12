// Export de listas (src/export-liga.js): linhas douradas por jogo pro formato
// "Compra por Lista" da Liga, o texto do site e o CSV. É lógica pura — carrega
// num vm mínimo, sem stub de DOM (mesmo padrão do deck-rules.test.mjs).
// Ver docs/LISTAS.md §6. Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

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
