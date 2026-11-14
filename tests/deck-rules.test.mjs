// Regras de deck (src/deck-rules.js) — 488 linhas de lógica pura que decide se
// um deck é LEGAL (tamanho de zona, limite de cópias, singleton, a conta do
// Commander) e não tinha teste nenhum, sendo o arquivo mais mexido do repo. Uma
// regressão aqui marca deck ilegal como legal (ou o contrário) sem nada acusar.
//
// deck-rules.js é uma IIFE que só encosta em `window` no fim — carrega num vm
// mínimo, sem stub de DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));

function loadDeckRules() {
  const src = readFileSync(join(here, "..", "src", "deck-rules.js"), "utf8");
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.TCGDeckRules;
}

const R = loadDeckRules();

// Monta um cardById a partir de uma lista de cartas.
const byId = (cards) => Object.fromEntries(cards.map((c) => [c.id, c]));

test("multi: separa por ; (Magic/OP) e por / (tinta dupla Lorcana)", () => {
  // spread pra trazer o array do realm do vm pro realm do teste (senão o
  // deepStrictEqual reprova pelo protótipo de Array diferente).
  assert.deepEqual([...R.multi("Green;Red")], ["Green", "Red"]);
  assert.deepEqual([...R.multi("Amber/Steel")], ["Amber", "Steel"]);
  assert.equal(R.multi("").length, 0);
  assert.equal(R.multi(null).length, 0);
});

test("countIn: soma as quantidades da zona; zona ausente = 0", () => {
  const deck = { zones: { main: [{ id: "a", qty: 2 }, { id: "b", qty: 3 }] } };
  assert.equal(R.countIn(deck, "main"), 5);
  assert.equal(R.countIn(deck, "side"), 0);
  assert.equal(R.countIn({}, "main"), 0);
});

test("Commander: 1 comandante pede 99 no main (sizeWith = 100 − comandantes)", () => {
  const main = Array.from({ length: 99 }, (_, i) => ({ id: `c${i}`, qty: 1 }));
  const cards = main.map((e) => ({ id: e.id, name: e.id, cardType: "Creature", colorId: "" }));
  cards.push({ id: "cmd", name: "Cmd", cardType: "Legendary Creature", colorId: "" });
  const deck = { game: "magic", format: "commander", zones: { commander: [{ id: "cmd", qty: 1 }], main } };
  const size = R.validate(deck, byId(cards)).filter((i) => i.code === "zoneMin" || i.code === "zoneMax");
  assert.equal(size.length, 0, "99 main + 1 comandante = deck de 100, sem erro de tamanho");
});

test("Commander: 98 no main com 1 comandante acusa zoneMin (faltou 1)", () => {
  const main = Array.from({ length: 98 }, (_, i) => ({ id: `c${i}`, qty: 1 }));
  const cards = main.map((e) => ({ id: e.id, name: e.id, cardType: "Creature", colorId: "" }));
  cards.push({ id: "cmd", name: "Cmd", cardType: "Legendary Creature", colorId: "" });
  const deck = { game: "magic", format: "commander", zones: { commander: [{ id: "cmd", qty: 1 }], main } };
  const min = R.validate(deck, byId(cards)).filter((i) => i.code === "zoneMin" && i.vals.zone === "main");
  assert.equal(min.length, 1, "target 99, tem 98 → zoneMin");
});

test("Commander/Partner: 2 comandantes baixam o alvo do main pra 98", () => {
  const main = Array.from({ length: 98 }, (_, i) => ({ id: `c${i}`, qty: 1 }));
  const cards = main.map((e) => ({ id: e.id, name: e.id, cardType: "Creature", colorId: "" }));
  cards.push({ id: "cmd1", name: "Cmd1", cardType: "Legendary Creature", colorId: "" });
  cards.push({ id: "cmd2", name: "Cmd2", cardType: "Legendary Creature", colorId: "" });
  const deck = { game: "magic", format: "commander", zones: { commander: [{ id: "cmd1", qty: 1 }, { id: "cmd2", qty: 1 }], main } };
  const size = R.validate(deck, byId(cards)).filter((i) => i.code === "zoneMin" || i.code === "zoneMax");
  assert.equal(size.length, 0, "100 − 2 comandantes = 98, e o main tem 98");
});

test("Singleton: 2 cópias da mesma carta acusam; terreno básico é isento", () => {
  const cards = [
    { id: "sol", name: "Sol Ring", cardType: "Artifact", colorId: "" },
    { id: "forest", name: "Forest", cardType: "Basic Land — Forest", colorId: "" },
    { id: "cmd", name: "Cmd", cardType: "Legendary Creature", colorId: "" }
  ];
  const deck = {
    game: "magic", format: "commander",
    zones: { commander: [{ id: "cmd", qty: 1 }], main: [{ id: "sol", qty: 2 }, { id: "forest", qty: 30 }] }
  };
  const issues = R.validate(deck, byId(cards));
  assert.equal(issues.filter((i) => i.code === "singleton" && i.cardId === "sol").length, 1, "2 Sol Ring = singleton");
  assert.equal(issues.filter((i) => i.code === "singleton" && i.cardId === "forest").length, 0, "30 Forest = isento");
});

test("canAdd: adicionar a 2ª cópia num singleton avisa (mas nunca barra)", () => {
  const card = { id: "sol", name: "Sol Ring", cardType: "Artifact", colorId: "" };
  const deck = { game: "magic", format: "commander", zones: { main: [{ id: "sol", qty: 1 }] } };
  const r = R.canAdd(deck, "main", card, byId([card]));
  assert.equal(r.ok, true);
  assert.ok(r.warn && r.warn.code === "singleton", "avisa singleton na 2ª cópia");
});

test("Modo livre (jogo sem pacote): validate não acusa nada", () => {
  const deck = { game: "jump", zones: { main: [{ id: "x", qty: 99 }] } };
  assert.equal(R.validate(deck, byId([{ id: "x", name: "X" }])).length, 0);
});

// ── Lote 1 de 2026-11-14: Gundam, SWU, FAB, Riftbound, Union Arena, Vanguard,
// FFTCG e Grand Archive. Cada teste é a regra oficial que o pacote promete
// (fonte no comentário do pacote, em src/deck-rules.js).
const carta = (id, campos) => Object.assign({ id, name: id }, campos);
const zonas = (z) => Object.fromEntries(Object.entries(z).map(([k, ids]) => [k, ids.map(([id, qty]) => ({ id, qty }))]));
const codigos = (issues) => [...issues].map((i) => i.code).sort();

test("nomeBase: tira a marca da impressão, não o subtítulo", () => {
  assert.equal(R.nomeBase({ name: "Darth Vader - Dark Lord of the Sith (Hyperspace)" }), "Darth Vader - Dark Lord of the Sith");
  assert.equal(R.nomeBase({ name: "Snatch (Red) - FAB331", number: "FAB331" }), "Snatch");
  assert.equal(R.nomeBase({ name: "Cloud LB (Full Art) (Prerelease Promo)" }), "Cloud LB");
  assert.equal(R.nomeBase({ name: "Luke Skywalker - Faithful Friend" }), "Luke Skywalker - Faithful Friend");
  assert.equal(R.nomeBase({ name: "(Só parêntese)" }), "(Só parêntese)", "não devolve nome vazio");
});

test("Gundam: 3 cores acusam; 10 cópias de Resource são isentas; ficha EX não cabe em deck", () => {
  const cards = [
    carta("u1", { cardType: "Unit", color: "Blue", number: "GD01-001" }),
    carta("u2", { cardType: "Unit", color: "Green", number: "GD01-002" }),
    carta("u3", { cardType: "Unit", color: "Red", number: "GD01-003" }),
    carta("r", { cardType: "Resource", color: null, number: "R-001", name: "Resource" }),
    carta("ex", { cardType: "EX Base", color: null, number: "EXB-001" })
  ];
  const deck = { game: "gundam", zones: zonas({ main: [["u1", 4], ["u2", 4], ["u3", 4]], resource: [["r", 10]] }) };
  const iss = R.validate(deck, byId(cards));
  assert.ok(codigos(iss).includes("identityMax"), "3 cores > 2");
  assert.equal(iss.filter((i) => i.code === "copyLimit").length, 0, "Resource ×10 é isento");
  assert.deepEqual([...R.zonesForCard(R.packFor("gundam"), cards[4])], [], "EX Base não entra");
});

test("Gundam e Union Arena: a mesma carta é o NÚMERO, com a arte alternativa e a promo juntas", () => {
  const g = [carta("a", { cardType: "Unit", color: "Blue", number: "GD01-005" }), carta("b", { cardType: "Unit", color: "Blue", number: "GD01-005", name: "a (LR+)" })];
  const iss = R.validate({ game: "gundam", zones: zonas({ main: [["a", 3], ["b", 2]] }) }, byId(g));
  assert.equal(iss.filter((i) => i.code === "copyLimit").length, 1, "3 + 2 do mesmo número = 5");
  const u = [carta("p", { cardType: "Character", series: "BLEACH", number: "UE10BT/BLC-1-034" }), carta("q", { cardType: "Character", series: "BLEACH", number: "UEPR/BLC-1-034" })];
  const iss2 = R.validate({ game: "unionarena", zones: zonas({ main: [["p", 4], ["q", 1]] }) }, byId(u));
  assert.equal(iss2.filter((i) => i.code === "copyLimit").length, 1, "o produto antes da / não separa a carta");
});

test("SWU Premier: a Hyperspace conta com a normal no limite de 3; Twin Suns é singleton", () => {
  const cards = [
    carta("n", { cardType: "Unit", name: "Luke Skywalker - Faithful Friend" }),
    carta("h", { cardType: "Unit", name: "Luke Skywalker - Faithful Friend (Hyperspace)" })
  ];
  const premier = R.validate({ game: "swu", format: "premier", zones: zonas({ main: [["n", 2], ["h", 2]] }) }, byId(cards));
  assert.equal(premier.filter((i) => i.code === "copyLimit").length, 1);
  const ts = R.validate({ game: "swu", format: "twinsuns", zones: zonas({ main: [["n", 1], ["h", 1]] }) }, byId(cards));
  assert.equal(ts.filter((i) => i.code === "singleton").length, 1);
  assert.equal(R.packFor("swu", null).format, "premier", "deck antigo (sem formato) abre no Premier");
});

test("FAB: a mesma carta é nome + pitch; o card-pool do CC acima de 80 acusa", () => {
  const cards = [
    carta("r", { cardType: "Action", name: "Snatch (Red)", pitch: "1" }),
    carta("r2", { cardType: "Action", name: "Snatch (Red) - FAB331", number: "FAB331", pitch: "1" }),
    carta("b", { cardType: "Action", name: "Snatch (Blue)", pitch: "3" }),
    carta("h", { cardType: "Hero", name: "Dorinthea Ironsong" }),
    carta("e", { cardType: "Equipment", name: "Helm" })
  ];
  const deck = { game: "fab", format: "cc", zones: zonas({ hero: [["h", 1]], main: [["r", 2], ["r2", 2], ["b", 3]], equipment: [["e", 1]] }) };
  const iss = R.validate(deck, byId(cards));
  assert.equal(iss.filter((i) => i.code === "copyLimit").length, 1, "4 Snatch vermelhas (com a promo) > 3; as azuis são outra carta");
  const big = Array.from({ length: 81 }, (_, i) => carta(`x${i}`, { cardType: "Action", pitch: "1" }));
  const pool = R.validate({ game: "fab", format: "cc", zones: { hero: [{ id: "h", qty: 1 }], main: big.map((c) => ({ id: c.id, qty: 1 })) } }, byId(big.concat(cards)));
  assert.ok(pool.some((i) => i.code === "limitMax" && i.vals.what === "pool" && i.vals.max === 80));
});

test("Riftbound: carta fora dos domínios da Legend acusa; campo de batalha repetido e a 4ª Signature também", () => {
  const cards = [
    carta("leg", { cardType: "Legend", domain: "Fury;Chaos" }),
    carta("ok", { cardType: "Unit", domain: "Fury" }),
    carta("multi", { cardType: "Spell", domain: "Fury;Chaos" }),
    carta("fora", { cardType: "Unit", domain: "Calm" }),
    carta("bf", { cardType: "Battlefield", domain: "None" }),
    carta("sig", { cardType: "Signature Spell", domain: "Fury" }),
    carta("sig2", { cardType: "Signature Gear", domain: "Chaos" })
  ];
  const deck = { game: "riftbound", zones: zonas({ legend: [["leg", 1]], main: [["ok", 3], ["multi", 1], ["fora", 1], ["sig", 2], ["sig2", 2]], battlefield: [["bf", 2]] }) };
  const iss = R.validate(deck, byId(cards));
  const fora = iss.filter((i) => i.code === "domainMismatch");
  assert.deepEqual([...fora.map((i) => i.cardId)], ["fora"], "só a Calm; a de domínio None (campo) passa");
  assert.ok(iss.some((i) => i.code === "zoneSingleton" && i.cardId === "bf" && i.vals.zone === "battlefield"), "dois campos de batalha iguais: o aviso diz a zona, não que o formato é singleton");
  assert.ok(iss.some((i) => i.code === "limitMax" && i.vals.what === "signature" && i.vals.n === 4));
});

test("Union Arena: obra única e no máximo 4 Final", () => {
  const cards = [
    carta("a", { cardType: "Character", series: "BLEACH", number: "UE01BT/BLC-1-001", trigger: "Final" }),
    carta("b", { cardType: "Character", series: "BLEACH", number: "UE01BT/BLC-1-002", trigger: "FINAL" }),
    carta("c", { cardType: "Character", series: "Jujutsu Kaisen", number: "UE02BT/JJK-1-001" }),
    carta("ap", { cardType: "Action Point", series: null, number: "UEPR/2025-AP01" })
  ];
  const iss = R.validate({ game: "unionarena", zones: zonas({ main: [["a", 3], ["b", 2], ["c", 1]] }) }, byId(cards));
  assert.ok(iss.some((i) => i.code === "limitMax" && i.vals.what === "final" && i.vals.n === 5), "3 + 2 Final, sem caixa");
  assert.ok(iss.some((i) => i.code === "seriesMax"));
  assert.deepEqual([...R.zonesForCard(R.packFor("unionarena"), cards[3])], [], "carta de AP fica fora do deck");
});

test("Vanguard Standard: 16 gatilhos, no máximo 4 de cura, uma nação (Other não conta)", () => {
  const cards = [
    carta("crit", { cardType: "Trigger Unit", trigger: "Critical", color: "Dragon Empire", grade: 0 }),
    carta("heal", { cardType: "Trigger Unit", trigger: "Heal", color: "Dragon Empire", grade: 0 }),
    carta("heal2", { cardType: "Trigger Unit", trigger: "Heal", color: "Dragon Empire", grade: 0, name: "heal2" }),
    carta("n", { cardType: "Normal Unit", color: "Dragon Empire", grade: 2 }),
    carta("x", { cardType: "Normal Unit", color: "Keter Sanctuary", grade: 2 }),
    carta("g", { cardType: "G Unit", color: "Other", grade: 4 })
  ];
  const deck = { game: "vanguard", format: "standard", zones: zonas({ main: [["crit", 4], ["heal", 4], ["heal2", 1], ["n", 4], ["x", 4]], gdeck: [["g", 1]] }) };
  const iss = R.validate(deck, byId(cards));
  assert.ok(iss.some((i) => i.code === "limitMin" && i.vals.what === "trigger" && i.vals.n === 9));
  assert.ok(iss.some((i) => i.code === "limitMax" && i.vals.what === "heal" && i.vals.n === 5));
  const nacao = iss.filter((i) => i.code === "nationMax");
  assert.equal(nacao.length, 1);
  assert.ok(!nacao[0].vals.list.includes("Other"), "unidade sem nação vai em qualquer deck");
  const p = R.packFor("vanguard", "standard");
  assert.deepEqual([...R.zonesForCard(p, cards[3])].sort(), ["main", "ride"], "grau 2 pode ir pro ride deck, por escolha");
  assert.equal(R.zoneForCard(p, cards[3]), "main");
  assert.equal(R.zoneForCard(p, cards[5]), "gdeck");
});

test("FFTCG: LB vai pro deck LB; 3 cópias pelo número, com a promo de reimpressão junto", () => {
  const cards = [
    carta("lb", { cardType: "Forward", name: "Cloud LB", number: "PR-160/22-120H" }),
    carta("c1", { cardType: "Forward", name: "Bahamut", number: "8-015H" }),
    carta("c2", { cardType: "Summon", name: "Bahamut", number: "PR-043/8-015H" })
  ];
  const p = R.packFor("fftcg");
  assert.equal(R.zoneForCard(p, cards[0]), "lb");
  assert.equal(R.zoneForCard(p, cards[1]), "main");
  const iss = R.validate({ game: "fftcg", zones: zonas({ main: [["c1", 2], ["c2", 2]] }) }, byId(cards));
  assert.equal(iss.filter((i) => i.code === "copyLimit").length, 1);
});

test("Grand Archive: material singleton e com campeão de nível 0; o main segue com 4 por nome", () => {
  const cards = [
    carta("ch0", { cardType: "Champion", cost: 0, name: "Spirit of Fire" }),
    carta("ch1", { cardType: "Champion", cost: 1, name: "Lorraine, Wandering Warrior" }),
    carta("reg", { cardType: "Item;Regalia", cost: 0, name: "Bauble" }),
    carta("ac", { cardType: "Action", cost: 2, name: "Slice" })
  ];
  const p = R.packFor("grandarchive");
  assert.equal(R.zoneForCard(p, cards[1]), "material");
  assert.equal(R.zoneForCard(p, cards[3]), "main");
  const semL0 = R.validate({ game: "grandarchive", zones: zonas({ main: [["ac", 4]], material: [["ch1", 1], ["reg", 2]] }) }, byId(cards));
  assert.ok(semL0.some((i) => i.code === "limitMin" && i.vals.what === "champion0"));
  assert.ok(semL0.some((i) => i.code === "zoneSingleton" && i.cardId === "reg" && i.vals.zone === "material"), "2 regalias iguais no material");
  assert.equal(semL0.filter((i) => i.code === "copyLimit").length, 0, "4 Slice no main pode");
});

test("canAdd: o grupo cheio avisa no clique (a 5ª cura do Vanguard), sem barrar", () => {
  const heal = carta("heal", { cardType: "Trigger Unit", trigger: "Heal", color: "Dragon Empire", grade: 0 });
  const heal2 = carta("heal2", { cardType: "Trigger Unit", trigger: "Heal", color: "Dragon Empire", grade: 0, name: "Outra cura" });
  const deck = { game: "vanguard", format: "standard", zones: zonas({ main: [["heal", 4]] }) };
  const r = R.canAdd(deck, "main", heal2, byId([heal]));
  assert.equal(r.ok, true);
  assert.equal(r.warn && r.warn.code, "limitMax");
  assert.equal(r.warn.vals.what, "heal");
  assert.equal(r.warn.vals.n, 5);
});

test("formatos novos: FAB abre no CC, Vanguard no Standard, e a lista de formatos é a do pacote", () => {
  assert.deepEqual([...R.formatsOf("fab")], ["cc", "blitz"]);
  assert.deepEqual([...R.formatsOf("vanguard")], ["standard", "premium"]);
  assert.deepEqual([...R.formatsOf("swu")], ["premier", "twinsuns"]);
  assert.equal(R.packFor("fab", null).format, "cc");
  assert.equal(R.packFor("gundam").free, undefined, "Gundam saiu do modo livre");
});
