// IDs provisórios (scripts/lib/provisional-ids.mjs): a edição PT completada pela
// inglesa e o detector de "a oficial chegou com outro id". O caso real que
// motivou (24/09/2026): o "Celebração de 30 Anos" tinha 2 cartas PT contra 158
// EN, e a pessoa marcava a carta PT sem ter onde.
import { test } from "node:test";
import assert from "node:assert/strict";
import { numKey, isPromoSet, learnLabels, fillFromEn, findTwins } from "../scripts/lib/provisional-ids.mjs";
import { stampIdMerges, idMergesPayload } from "../scripts/lib/set-supersede.mjs";

const en = (n, extra = {}) => ({ id: `30th-${n}`, name: `Carta ${n}`, number: n, set: "30th Celebration", setId: "30th", language: "en", rarity: "Common", category: "Pokemon", dexId: Number(n), image: `https://x/${n}.png`, ...extra });
const pt = (n, extra = {}) => ({ id: `30th-${n}-pt`, name: `Carta PT ${n}`, number: n, set: "Celebração de 30 Anos", setId: "30th", language: "pt", rarity: "Comum", category: "Pokémon", dexId: Number(n), ...extra });

test("numKey compara número entre fontes", () => {
  assert.equal(numKey("001"), "1");
  assert.equal(numKey("1"), "1");
  assert.equal(numKey("4/102"), "4");
  assert.equal(numKey("SWSH075"), "swsh75");
  assert.equal(numKey("TG08"), "tg8");
  assert.equal(numKey(""), "");
});

test("set de promo não é completado", () => {
  assert.equal(isPromoSet([{ set: "SWSH Black Star Promos" }]), true);
  assert.equal(isPromoSet([{ set: "30th Celebration" }]), false);
  assert.equal(isPromoSet([]), false);
});

test("rótulo EN -> PT aprendido pelos pares, vence o mais frequente", () => {
  const l = learnLabels([
    [en("001"), pt("001")], [en("002"), pt("002")],
    [en("003", { rarity: "Common" }), pt("003", { rarity: "Outra" })]
  ]);
  assert.equal(l.rarity.Common, "Comum");
  assert.equal(l.category.Pokemon, "Pokémon");
});

test("completa a PT com o id da EN + -pt, campos de set da irmã PT", () => {
  const labels = learnLabels([[en("001"), pt("001")]]);
  const r = fillFromEn({ enCards: [en("001"), en("002", { price: { u: 3 } })], locCards: [pt("001")], lang: "pt", labels });
  assert.equal(r.added, 1);
  const nova = r.cards.find((c) => c.id === "30th-002-pt");
  assert.ok(nova);
  assert.equal(nova.prov, "en");
  assert.equal(nova.language, "pt");
  assert.equal(nova.set, "Celebração de 30 Anos");   // nome do set no idioma
  assert.equal(nova.rarity, "Comum");                // rótulo traduzido
  assert.equal(nova.name, "Carta 002");              // nome fica o inglês até a oficial chegar
  assert.equal(nova.image, "");                      // o fallback EN do merge preenche
  assert.equal("price" in nova, false);              // preço vem da base (basePricingId)
});

test("a oficial ocupa o id e a cópia some; a cópia da rodada anterior é refeita", () => {
  const velha = { ...pt("002"), prov: "en", name: "Carta 002" };
  // Rodada seguinte: a TCGdex publicou a 002 PT de verdade.
  const r = fillFromEn({ enCards: [en("001"), en("002")], locCards: [pt("001"), velha, pt("002")], lang: "pt" });
  const ids = r.cards.map((c) => c.id);
  assert.deepEqual(ids, ["30th-001-pt", "30th-002-pt"]);
  assert.equal(r.cards[1].prov, undefined);          // ficou a oficial
  assert.equal(r.dropped, 1);
});

test("não copia: promo, id com de-para, molde provisório/injetado, chunk só aposentado", () => {
  const promo = fillFromEn({ enCards: [en("001", { set: "X Black Star Promos" }), en("002", { set: "X Black Star Promos" })], locCards: [pt("001")], lang: "pt" });
  assert.equal(promo.added, 0);
  const pulos = fillFromEn({
    enCards: [en("001"), en("002"), en("003", { prov: "tcgcsv" }), en("004")],
    locCards: [pt("001")], lang: "pt",
    skipIds: new Set(["30th-002-pt"]), skipEn: new Set(["30th-004"])
  });
  assert.equal(pulos.added, 0);
  const aposentado = fillFromEn({ enCards: [en("001"), en("002")], locCards: [pt("001", { retired: "x" })], lang: "pt" });
  assert.equal(aposentado.added, 0);
});

test("gêmea única: provisória com outro id, mesmo número e mesma espécie", () => {
  const cards = [
    { ...pt("005"), prov: "en", name: "Tropius" },            // nossa aposta: 30th-005-pt
    { ...pt("005"), id: "30th-5-pt", name: "Tropius PT" }      // oficial com outro formato
  ];
  assert.deepEqual(findTwins(cards).map((g) => [g.prov, g.twin]), [["30th-005-pt", "30th-5-pt"]]);
});

test("gêmea pelo nome (TCGCSV) e casos que não migram sozinhos", () => {
  const tcg = { id: "svp-213", name: "Feraligatr", number: "213", prov: "tcgcsv" };
  assert.equal(findTwins([tcg, { id: "svp-0213", name: "Feraligatr", number: "0213" }])[0].twin, "svp-0213");
  // Duas oficiais com a mesma cara: ambígua, fica pra gente.
  const amb = findTwins([tcg, { id: "svp-213a", name: "Feraligatr", number: "213" }, { id: "svp-213b", name: "Feraligatr", number: "213" }])[0];
  assert.deepEqual(amb.candidates, ["svp-213a", "svp-213b"]);
  // Mesmo número, outra carta: só suspeita.
  const sus = findTwins([tcg, { id: "svp-213x", name: "Pikachu", number: "213" }])[0];
  assert.deepEqual(sus.suspeita, ["svp-213x"]);
  // Sem oficial no número / sem prov: nada.
  assert.deepEqual(findTwins([tcg, { id: "svp-1", name: "Feraligatr", number: "1" }]), []);
  assert.deepEqual(findTwins([{ id: "a-1", name: "X", number: "1" }, { id: "a-01", name: "X", number: "01" }]), []);
});

test("carimbo do de-para no núcleo é o mesmo pros dois passos do build", () => {
  const merges = { sets: [{ from: "cel30", to: "30th" }], prefixes: { cel30: "30th" }, cards: { "30th-005-pt": "30th-5-pt" } };
  const src = 'x;\n  const ID_MERGES = {"s":{},"p":{},"c":{}}; /* SLEEVU_ID_MERGES */\ny;';
  const novo = stampIdMerges(src, merges);
  assert.ok(novo.includes(`const ID_MERGES = ${JSON.stringify(idMergesPayload(merges))}; /* SLEEVU_ID_MERGES */`));
  assert.ok(novo.includes('"30th-005-pt":"30th-5-pt"'));
  assert.throws(() => stampIdMerges("sem marcador", merges));
});
