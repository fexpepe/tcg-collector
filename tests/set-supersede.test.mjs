// Régua da aposentadoria de set importado (scripts/lib/set-supersede.mjs). O
// caso real está congelado aqui: o "30th Celebration" entrou em 16/09/2026 pelo
// pin `enImport` como cel30/cel30cc e a TCGdex publicou como 30th/30th-c dois
// dias depois — 4 coleções de 30 anos na tela de Sets onde existem 2.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cardNameKey, chunkSimilarity, pairCards, isPrefixSwap, findSupersededImports, isRetiredChunk
} from "../scripts/lib/set-supersede.mjs";

const c = (id, number, name, extra) => Object.assign({ id, number, name }, extra || {});
// Set principal: a TCGdex usou a MESMA numeração, só o id do set difere.
const CEL30 = [c("cel30-001", "001", "Exeggcute", { image: "T1" }), c("cel30-002", "002", "Exeggutor", { image: "T2" }),
  c("cel30-087", "087", "Nidoran F", { image: "T3" }), c("cel30-100", "100", "Poke Pad", { image: "T4" }),
  c("cel30-101", "101", "Pikachu", { image: "T5" }), c("cel30-102", "102", "Raichu", { image: "T6" })];
const TCGDEX30 = [c("30th-001", "001", "Exeggcute", { image: "D1" }), c("30th-002", "002", "Exeggutor", { image: "D2" }),
  c("30th-087", "087", "Nidoran♀", { image: "D3" }), c("30th-100", "100", "Poké Pad", { image: "D4" }),
  c("30th-101", "101", "Pikachu", { image: "D5" }), c("30th-102", "102", "Raichu", { image: "D6" })];
// Classic Collection: o TCGplayer usa o número ORIGINAL da carta reimpressa e a
// TCGdex numera em sequência — nenhum número bate, e o nome vem decorado com a
// mecânica num lado só. O LEGEND é uma carta em duas metades.
const CEL30CC = [c("cel30cc-4", "4", "Charizard", { image: "T1" }), c("cel30cc-94", "94", "Gengar (Prime)", { image: "T2" }),
  c("cel30cc-99", "99", "Darkrai & Cresselia Legend (Top)", { image: "T3" }),
  c("cel30cc-100", "100", "Darkrai & Cresselia Legend (Bottom)", { image: "T4" }),
  c("cel30cc-106-106", "106", "Palkia LV.X", { image: "T5" }), c("cel30cc-203", "203", "Magikarp", { image: "T6" })];
const TCGDEX30CC = [c("30th-c-001", "001", "Charizard"), c("30th-c-018", "018", "Gengar"),
  c("30th-c-019", "019", "Darkrai & Cresselia LEGEND"), c("30th-c-020", "020", "Darkrai & Cresselia LEGEND"),
  c("30th-c-022", "022", "Palkia"), c("30th-c-030", "030", "Magikarp")];

test("nome de carta casa entre as duas fontes apesar da decoração", () => {
  assert.equal(cardNameKey("Gengar (Prime)"), cardNameKey("Gengar"));
  assert.equal(cardNameKey("Genesect ex (Team Plasma)"), cardNameKey("Genesect EX"));
  assert.equal(cardNameKey("Palkia LV.X"), cardNameKey("Palkia"));
  assert.equal(cardNameKey("Nidoran F"), cardNameKey("Nidoran♀"));     // símbolo de gênero
  assert.equal(cardNameKey("Nidoran M"), cardNameKey("Nidoran♂"));
  assert.equal(cardNameKey("Poke Pad"), cardNameKey("Poké Pad"));       // acento
  assert.notEqual(cardNameKey("Pikachu"), cardNameKey("Raichu"));
});

test("semelhança é em MÃO DUPLA: reimpressão não casa com o set original", () => {
  assert.equal(chunkSimilarity(CEL30, TCGDEX30), 1);
  // Todas as 6 da "Classic Collection" existem no set de 60 cartas, mas o set
  // de 60 não tem metade dos nomes dela — não é duplicata (é o caso cel25cc × base1).
  const grande = Array.from({ length: 60 }, (_, i) => c(`g-${i}`, String(i), i < 6 ? TCGDEX30CC[i].name : `Filler ${i}`));
  assert.equal(chunkSimilarity(TCGDEX30CC, grande), 0.1);
  // Chunk pequeno demais pra a conta dizer algo.
  assert.equal(chunkSimilarity(CEL30.slice(0, 3), TCGDEX30.slice(0, 3)), 0);
});

test("de-para carta a carta pelo nome, desempatando pela ordem do número", () => {
  const r = pairCards(CEL30CC, TCGDEX30CC);
  assert.equal(Object.keys(r.cards).length, 6);
  assert.deepEqual(r.unmatched, []);
  assert.equal(r.cards["cel30cc-4"], "30th-c-001");
  assert.equal(r.cards["cel30cc-94"], "30th-c-018");
  assert.equal(r.cards["cel30cc-106-106"], "30th-c-022");
  // Nome repetido (as duas metades do LEGEND): Top antes de Bottom nas duas fontes.
  assert.equal(r.cards["cel30cc-99"], "30th-c-019");
  assert.equal(r.cards["cel30cc-100"], "30th-c-020");
  // A TCGdex publicou este set sem arte: a do TCGplayer vem junto no de-para.
  assert.equal(Object.keys(r.images).length, 6);
  assert.equal(r.images["30th-c-019"], "T3");
});

test("imagem só viaja quando a TCGdex não tem a dela", () => {
  const r = pairCards(CEL30, TCGDEX30);
  assert.equal(Object.keys(r.cards).length, 6);
  assert.deepEqual(r.images, {});
});

test("troca de prefixo é reconhecida (e não é quando a numeração muda)", () => {
  assert.equal(isPrefixSwap(pairCards(CEL30, TCGDEX30).cards, "cel30", "30th"), true);
  assert.equal(isPrefixSwap(pairCards(CEL30CC, TCGDEX30CC).cards, "cel30cc", "30th-c"), false);
  assert.equal(isPrefixSwap({}, "cel30", "30th"), false);
});

test("só set IMPORTADO é aposentado, e só com um vencedor único", () => {
  const chunks = [
    { lang: "en", setId: "cel30", cards: CEL30 }, { lang: "en", setId: "30th", cards: TCGDEX30 },
    { lang: "en", setId: "cel30cc", cards: CEL30CC }, { lang: "en", setId: "30th-c", cards: TCGDEX30CC },
    // Mesmo nome de carta, outro IDIOMA: nunca casa (ids e contas são por idioma).
    { lang: "pt", setId: "30th", cards: TCGDEX30 }
  ];
  const r = findSupersededImports(chunks, new Set(["cel30", "cel30cc"]));
  assert.deepEqual(r.map((x) => `${x.lang}/${x.from}->${x.to}`), ["en/cel30->30th", "en/cel30cc->30th-c"]);
  // Sem pin de import, nada é apagado — nem o par cel30/30th, que é idêntico.
  assert.deepEqual(findSupersededImports(chunks, new Set()), []);
  // Dois candidatos empatados no topo: aviso, nunca exclusão.
  const empate = findSupersededImports(
    [{ lang: "en", setId: "cel30", cards: CEL30 }, { lang: "en", setId: "30th", cards: TCGDEX30 }, { lang: "en", setId: "me06", cards: TCGDEX30 }],
    new Set(["cel30"])
  );
  assert.equal(empate.length, 1);
  assert.deepEqual(empate[0].ambiguous, ["30th", "me06"]);
  assert.equal(empate[0].to, undefined);
});

// ── Carta sem par: 2º passo pelo número, e o que sobrar congela (20/09/2026) ──
test("2º passo pelo número: nome que a régua não previu casa quando a numeração se preservou", () => {
  const velho = CEL30.concat([c("cel30-103", "103", "Team Rocket's Mewtwo ex", { image: "T7" })]);
  const novo = TCGDEX30.concat([c("30th-103", "103", "Mewtwo ex")]);
  const r = pairCards(velho, novo);
  assert.equal(r.cards["cel30-103"], "30th-103");
  assert.deepEqual(r.unmatched, []);
  assert.equal(r.images["30th-103"], "T7");
  assert.equal(isPrefixSwap(r.cards, "cel30", "30th"), true);
  // Número já tomado por um par de nome não é reaproveitado.
  const disputa = pairCards(CEL30.concat([c("cel30-999", "101", "Outro Pikachu")]), TCGDEX30);
  assert.deepEqual(disputa.unmatched, ["cel30-999"]);
});

test("numeração diferente (Classic Collection): número igual seria OUTRA carta, então segue sem par", () => {
  const velho = CEL30CC.concat([c("cel30cc-58", "58", "Umbreon Star")]);
  const novo = TCGDEX30CC.concat([c("30th-c-058", "058", "Blastoise")]);
  const r = pairCards(velho, novo);
  assert.deepEqual(r.unmatched, ["cel30cc-58"]);
  assert.equal(r.cards["cel30cc-58"], undefined);
});

test("chunk congelado (sobra de aposentadoria) não é aposentado de novo nem serve de alvo", () => {
  const congelado = [c("cel30-200", "200", "Sobra", { retired: "30th" })];
  assert.equal(isRetiredChunk(congelado), true);
  assert.equal(isRetiredChunk(CEL30), false);
  assert.equal(isRetiredChunk(CEL30.concat(congelado)), false); // metade carimbada não é chunk congelado
  assert.equal(isRetiredChunk([]), false);
  assert.deepEqual(findSupersededImports(
    [{ lang: "en", setId: "cel30", cards: congelado }, { lang: "en", setId: "30th", cards: TCGDEX30 }],
    new Set(["cel30"])
  ), []);
  // Como candidato: um import novo idêntico a um chunk congelado não casa com ele.
  const congeladoGrande = TCGDEX30.map((x) => ({ ...x, id: `velho-${x.number}`, retired: "30th" }));
  const r = findSupersededImports(
    [{ lang: "en", setId: "cel30", cards: CEL30 }, { lang: "en", setId: "velho", cards: congeladoGrande }, { lang: "en", setId: "30th", cards: TCGDEX30 }],
    new Set(["cel30"])
  );
  assert.deepEqual(r.map((x) => x.to), ["30th"]);
});
