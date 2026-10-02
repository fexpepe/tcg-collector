// Export de DECK (src/export-liga.js, exportarDeck) e o leitor de linha do
// "Importar lista" (lerLinhaDeck). Linhas douradas por formato: Archidekt/
// Moxfield com as opções do diálogo do Archidekt, o cadastro de deck da
// LigaMagic e a Compra por Lista montada do deck. Nasceu do pedido de quem
// monta o deck aqui pra vender e leva a lista pra Liga (2026-10-02): o
// "Copiar lista" antigo só levava os nomes. Mesmo vm mínimo do
// liga-export.test.mjs. Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(here, "..", "src", "export-liga.js"), "utf8"), sandbox);
const X = sandbox.window.TCGExportLiga;
// Objetos do sandbox são de outro realm: deepStrictEqual compara protótipo.
const plano = (o) => JSON.parse(JSON.stringify(o));

// Campos como o sync-magic.mjs grava (setId = código do Scryfall).
const MAGIC = {
  "mtg-hob-33": { id: "mtg-hob-33", name: "Bilbo, Thief in the Night", setId: "hob", number: "33", variants: ["Normal", "Foil"] },
  "mtg-hob-283": { id: "mtg-hob-283", name: "The Arkenstone // Seek the Heart", setId: "hob", number: "283" },
  "mtg-c21-263": { id: "mtg-c21-263", name: "Sol Ring", setId: "c21", number: "263" },
  "mtg-cmm-410": { id: "mtg-cmm-410", name: "Sol Ring", setId: "cmm", number: "410" },
  "mtg-mh2-1": { id: "mtg-mh2-1", name: "Sanctum Linguist", setId: "mh2", number: "1" }
};

// Deck de Commander: comandante, deck, e o rascunho (Talvez) — scratch.
const COMMANDER = [
  { key: "commander", rotulo: "Comandante", scratch: false, entries: [{ id: "mtg-hob-33", qty: 1, variant: "Normal" }] },
  { key: "main", rotulo: "Deck", scratch: false, entries: [
    { id: "mtg-c21-263", qty: 1, variant: "Foil" },
    { id: "mtg-hob-283", qty: 1, variant: "Normal" }
  ] },
  { key: "maybe", rotulo: "Talvez", scratch: true, entries: [{ id: "mtg-mh2-1", qty: 1, variant: "Normal" }] }
];
const TUDO = { x: true, set: true, num: true, foil: true, cat: true };

test("Archidekt: todas as opções = o formato do diálogo do Archidekt", () => {
  assert.equal(X.exportarDeck("archidekt", COMMANDER, MAGIC, "magic", TUDO), [
    "1x Bilbo, Thief in the Night (hob) 33 [Commander{top}]",
    "1x Sol Ring (c21) 263 *F*",
    "1x The Arkenstone // Seek the Heart (hob) 283",
    "1x Sanctum Linguist (mh2) 1 [Maybeboard]"
  ].join("\n"));
});

test("Archidekt: sem categoria, as zonas saem em blocos com cabeçalho", () => {
  const out = X.exportarDeck("archidekt", COMMANDER, MAGIC, "magic", { x: false, set: true, num: true, foil: false, cat: false });
  assert.equal(out, [
    "Comandante", "1 Bilbo, Thief in the Night (hob) 33",
    "", "Deck", "1 Sol Ring (c21) 263", "1 The Arkenstone // Seek the Heart (hob) 283",
    "", "Talvez", "1 Sanctum Linguist (mh2) 1"
  ].join("\n"));
});

test("Archidekt: número só vale junto da sigla (sozinho viraria parte do nome)", () => {
  const out = X.exportarDeck("archidekt", [COMMANDER[1]], MAGIC, "magic", { x: true, set: false, num: true, foil: false, cat: true });
  assert.equal(out, "1x Sol Ring\n1x The Arkenstone // Seek the Heart");
});

test("Archidekt: tudo desligado = o texto de sempre (zona única sem cabeçalho)", () => {
  const out = X.exportarDeck("archidekt", [COMMANDER[1]], MAGIC, "magic", {});
  assert.equal(out, "1 Sol Ring\n1 The Arkenstone // Seek the Heart");
});

test("Archidekt: etched sai *E*, sideboard vai com a categoria exata", () => {
  const zonas = [
    { key: "main", rotulo: "Deck", entries: [{ id: "mtg-cmm-410", qty: 1, variant: "Etched" }] },
    { key: "side", rotulo: "Side Deck", entries: [{ id: "mtg-mh2-1", qty: 2, variant: "Normal" }] }
  ];
  assert.equal(X.exportarDeck("archidekt", zonas, MAGIC, "magic", TUDO),
    "1x Sol Ring (cmm) 410 *E*\n2x Sanctum Linguist (mh2) 1 [Sideboard]");
});

test("LigaMagic (deck): [SIGLA] em maiúsculas, comandante no topo, rascunho fora", () => {
  assert.equal(X.exportarDeck("ligaDeck", COMMANDER, MAGIC, "magic"), [
    "1 Bilbo, Thief in the Night [HOB]",
    "1 Sol Ring [C21]",
    "1 The Arkenstone // Seek the Heart [HOB]"
  ].join("\n"));
});

test("LigaMagic (deck): sideboard depois de uma linha em branco", () => {
  const zonas = [
    { key: "main", rotulo: "Deck", entries: [{ id: "mtg-c21-263", qty: 4 }] },
    { key: "side", rotulo: "Side Deck", entries: [{ id: "mtg-mh2-1", qty: 3 }] },
    { key: "maybe", rotulo: "Talvez", scratch: true, entries: [{ id: "mtg-hob-33", qty: 1 }] }
  ];
  assert.equal(X.exportarDeck("ligaDeck", zonas, MAGIC, "magic"), "4 Sol Ring [C21]\n\n3 Sanctum Linguist [MH2]");
});

test("Compra por Lista do deck: soma a mesma carta do deck e do side, sem o rascunho", () => {
  const zonas = [
    { key: "main", rotulo: "Deck", entries: [{ id: "mtg-c21-263", qty: 2, variant: "Normal" }] },
    { key: "side", rotulo: "Side Deck", entries: [{ id: "mtg-c21-263", qty: 1, variant: "Normal" }] },
    { key: "maybe", rotulo: "Talvez", scratch: true, entries: [{ id: "mtg-hob-33", qty: 1, variant: "Normal" }] }
  ];
  assert.equal(X.exportarDeck("liga", zonas, MAGIC, "magic"), "3 Sol Ring [QUALIDADE=NM] [EDICAO=C21]");
});

test("Texto (jogos fora do Magic): zona única sem cabeçalho", () => {
  const POKEMON = { "sv08-078": { id: "sv08-078", name: "Gwynn" } };
  const zonas = [{ key: "main", rotulo: "Deck", entries: [{ id: "sv08-078", qty: 4 }] }];
  assert.equal(X.exportarDeck("texto", zonas, POKEMON, "pokemon"), "4 Gwynn");
});

test("lerLinhaDeck: dialetos de lista", () => {
  const casos = [
    ["4 Gwynn", { qtd: 4, nome: "Gwynn", sigla: "", numero: "", acabamento: "", categorias: [] }],
    ["4x Gwynn", { qtd: 4, nome: "Gwynn" }],
    ["Gwynn", { qtd: 1, nome: "Gwynn" }],
    ["1x Sol Ring (c21) 263 *F* [Ramp,Commander{top}] ^Buy,#0066ff^",
      { qtd: 1, nome: "Sol Ring", sigla: "c21", numero: "263", acabamento: "foil", categorias: ["Ramp", "Commander{top}"] }],
    ["1 Sol Ring (CMM) 410 *E*", { nome: "Sol Ring", sigla: "cmm", numero: "410", acabamento: "etched" }],
    ["1 Domri, Anarch of Bolas [WAR]", { nome: "Domri, Anarch of Bolas", sigla: "war", categorias: [] }],
    ["1 The Arkenstone // Seek the Heart (hob) 283", { nome: "The Arkenstone // Seek the Heart", sigla: "hob", numero: "283" }],
    ["2 Charizard · 4/102", { qtd: 2, nome: "Charizard" }],
    ["9999 Island", { qtd: 99, nome: "Island" }]
  ];
  for (const [linha, esperado] of casos) {
    const r = plano(X.lerLinhaDeck(linha));
    for (const [k, v] of Object.entries(esperado)) assert.deepEqual(r[k], v, `${linha} → ${k}`);
  }
});

test("lerLinhaDeck: comentário e vazio não viram carta", () => {
  assert.equal(X.lerLinhaDeck(""), null);
  assert.equal(X.lerLinhaDeck("   "), null);
  assert.equal(X.lerLinhaDeck("# Sideboard"), null);
  assert.equal(X.lerLinhaDeck("// comentário"), null);
});

test("lerLinhaDeck: o (…) do One Piece fica no `bruto` (é parte do nome da carta)", () => {
  const r = X.lerLinhaDeck("4 Kouzuki Oden (Alternate Art)");
  assert.equal(r.bruto, "Kouzuki Oden (Alternate Art)");
  assert.equal(r.nome, "Kouzuki Oden");
});

test("Ida e volta: o que o Archidekt exporta, o leitor devolve com sigla, número e zona", () => {
  const linhas = X.exportarDeck("archidekt", COMMANDER, MAGIC, "magic", TUDO).split("\n").map((l) => plano(X.lerLinhaDeck(l)));
  assert.deepEqual(linhas.map((r) => [r.qtd, r.nome, r.sigla, r.numero, r.acabamento, r.categorias]), [
    [1, "Bilbo, Thief in the Night", "hob", "33", "", ["Commander{top}"]],
    [1, "Sol Ring", "c21", "263", "foil", []],
    [1, "The Arkenstone // Seek the Heart", "hob", "283", "", []],
    [1, "Sanctum Linguist", "mh2", "1", "", ["Maybeboard"]]
  ]);
});

test("Ida e volta: a linha da LigaMagic devolve a sigla", () => {
  const r = X.lerLinhaDeck(X.exportarDeck("ligaDeck", [COMMANDER[1]], MAGIC, "magic").split("\n")[0]);
  assert.equal(r.nome, "Sol Ring");
  assert.equal(r.sigla, "c21");
});
