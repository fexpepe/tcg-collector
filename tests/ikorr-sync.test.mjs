// Testes do sync do Rush of Ikorr (scripts/sync-ikorr.mjs), sem rede: os três
// produtos da mesma carta (o da carta, o Fracture Foil e o Rapture Foil)
// juntados pelo número, as versões e o preço por versão, o id pegajoso, o
// setId fixo e o conserto dos erros da fonte.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { setIdOf, ABREV_FIXA, acabamentoDe, numeroDe, nomeDaCarta, agrupaProdutos, versoesEPreco, cardOf, isCard } from "../scripts/sync-ikorr.mjs";
import { usdForVariant } from "../scripts/lib/pricing.mjs";

const prod = (productId, name, ext = {}) => ({
  productId, name,
  extendedData: Object.entries(ext).map(([name, value]) => ({ name, value }))
});
const GRUPO = { groupId: 24891, name: "Shattered Chaos Act 1 Part 1", publishedOn: "2025-06-25T00:00:00" };
const AMMIT = { Rarity: "R", Number: "ROI-103 R", CardType: "Fabled Champion", Loyalty: "Egyptian", Aspect: "Prophecy", ChampionType: "Divine;Beast", InfluenceCost: "7", Attack: "9", Health: "5", Raid: "1" };
const linhas = (pares) => new Map(pares.map(([id, sub]) => [id, new Map(Object.entries(sub))]));

test("setId: pin por groupId com o código impresso; grupo novo usa a abreviação", () => {
  assert.equal(setIdOf({ groupId: 24891, abbreviation: "ROI" }), "ROI");
  assert.equal(setIdOf({ groupId: 24949, abbreviation: "RIPC" }), "RIPC");
  assert.equal(setIdOf({ groupId: 1, abbreviation: "RFF" }), "RFF");
  assert.equal(setIdOf({ groupId: 2, abbreviation: "" }), "G2");
  assert.equal(setIdOf({ groupId: 3, abbreviation: "RFF" }, new Set(["RFF"])), "RFF-3");
  const ids = Object.values(ABREV_FIXA);
  assert.equal(new Set(ids).size, ids.length);
});

test("carta x selado: só produto com número é carta", () => {
  assert.equal(isCard(prod(1, "Shattered Chaos Act 1 Part 1 Booster Box")), false);
  assert.equal(isCard(prod(2, "Ammit, Soulgorger", AMMIT)), true);
});

test("acabamento e número: o foil especial pelo nome; o número como a carta imprime", () => {
  assert.equal(acabamentoDe(prod(1, "Ammit, Soulgorger (Fracture Foil)")), "Fracture Foil");
  assert.equal(acabamentoDe(prod(1, "Ammit, Soulgorger (Rapture Foil)")), "Rapture Foil");
  assert.equal(acabamentoDe(prod(1, "Apollo, Prophet of Harmony (Alt Art)")), "");
  assert.equal(numeroDe(prod(1, "x", { Number: "ROI-001 R" })), "ROI-001 R");
  // Erro de digitação da fonte (22/11/2026): o banco oficial tem ROI-206.
  assert.equal(numeroDe(prod(1, "x", { Number: "RO!-206 C" })), "ROI-206 C");
});

test("nome: sem o acabamento, sem o número desta carta, e o parêntese aberto pela fonte fechado", () => {
  assert.equal(nomeDaCarta("Ammit, Soulgorger (Fracture Foil)", "ROI-103 R"), "Ammit, Soulgorger");
  assert.equal(nomeDaCarta("Influence Card (ROI-197)", "ROI-197 C"), "Influence Card");
  assert.equal(nomeDaCarta("Influence Card (RO!-206)", "ROI-206 C"), "Influence Card");
  assert.equal(nomeDaCarta("Influence Card (ROI-197)", "ROI-198 C"), "Influence Card (ROI-197)");
  assert.equal(nomeDaCarta("Achaean Soldier (Scrollwork)", "RMB-159 C"), "Achaean Soldier (Scrollwork)");
  assert.equal(nomeDaCarta("Seth, Enigma of the Red Land (Alt Art (Fracture Foil)", "RMB-262 A"), "Seth, Enigma of the Red Land (Alt Art)");
});

test("agrupa: os três produtos do mesmo número viram uma carta; número próprio é carta própria", () => {
  const grupos = agrupaProdutos([
    prod(10, "Ammit, Soulgorger", AMMIT),
    prod(11, "Ammit, Soulgorger (Fracture Foil)", AMMIT),
    prod(12, "Ammit, Soulgorger (Rapture Foil)", AMMIT),
    prod(20, "Seth (Alt Art)", { ...AMMIT, Number: "RMB-262 A" }),
    prod(21, "Seth (Alt Art (Fracture Foil)", { ...AMMIT, Number: "RMB-262 A" }),
    prod(30, "Booster Pack"),
    prod(40, "Só Fracture (Fracture Foil)", { ...AMMIT, Number: "ROI-300 U" })
  ]);
  const ver = grupos.map((g) => [g.base && g.base.productId, g["Fracture Foil"] && g["Fracture Foil"].productId, g["Rapture Foil"] && g["Rapture Foil"].productId]);
  assert.deepEqual(ver, [[10, 11, 12], [20, 21, null], [null, 40, null]]);
});

test("agrupa: dois produtos do mesmo lado no mesmo número não se apagam", () => {
  const grupos = agrupaProdutos([prod(1, "X", AMMIT), prod(2, "X", AMMIT)]);
  assert.equal(grupos.length, 2);
});

test("versões: as que a fonte lista, na ordem Normal, Foil, Fracture, Rapture", () => {
  const [g] = agrupaProdutos([prod(10, "A", AMMIT), prod(11, "A (Fracture Foil)", AMMIT), prod(12, "A (Rapture Foil)", AMMIT)]);
  // Subtipo sem preço (0) também diz que a impressão existe.
  const l = linhas([[10, { Normal: 2.5, Foil: 0 }], [11, { Foil: 12.49 }]]);
  assert.deepEqual(versoesEPreco(g, l).variants, ["Normal", "Foil", "Fracture Foil", "Rapture Foil"]);
  // Alt Art e Expression só têm Foil; produto sem linha nenhuma fica Normal.
  const [alt] = agrupaProdutos([prod(20, "B (Alt Art)", AMMIT)]);
  assert.deepEqual(versoesEPreco(alt, linhas([[20, { Foil: 3 }]])).variants, ["Foil"]);
  assert.deepEqual(versoesEPreco(alt, new Map()).variants, ["Normal"]);
});

test("preço: u do Normal, uf do Foil, v só com os foils especiais que têm preço", () => {
  const [g] = agrupaProdutos([prod(10, "A", AMMIT), prod(11, "A (Fracture Foil)", AMMIT), prod(12, "A (Rapture Foil)", AMMIT)]);
  const { price } = versoesEPreco(g, linhas([[10, { Normal: 2.5, Foil: 6.25 }], [11, { Foil: 12.49 }], [12, { Foil: 0 }]]));
  assert.deepEqual(price, { u: 2.5, uf: 6.25, v: { "Fracture Foil": 12.49 } });
  // O cliente escolhe pela versão do tile; o Rapture sem venda cai no Foil.
  assert.equal(usdForVariant(price, "Normal"), 2.5);
  assert.equal(usdForVariant(price, "Foil"), 6.25);
  assert.equal(usdForVariant(price, "Fracture Foil"), 12.49);
  assert.equal(usdForVariant(price, "Rapture Foil"), 6.25);
  // Só foil especial com preço: ele vira u e uf.
  const { price: so } = versoesEPreco(g, linhas([[11, { Foil: 3 }]]));
  assert.deepEqual(so, { u: 3, uf: 3, v: { "Fracture Foil": 3 } });
  // Nada com preço: sem entrada.
  assert.equal(versoesEPreco(g, new Map()).price, null);
});

test("carta: id do produto da carta, pegajoso entre os três, e os campos do jogo", () => {
  const [g] = agrupaProdutos([prod(723958, "Ammit, Soulgorger", AMMIT), prod(723959, "Ammit, Soulgorger (Fracture Foil)", AMMIT)]);
  const { card } = cardOf(g, GRUPO, "ROI", 291, new Map());
  assert.equal(card.id, "ikr-723958");
  assert.equal(card.name, "Ammit, Soulgorger");
  assert.equal(card.set, "Shattered Chaos Act 1 Part 1");
  assert.equal(card.setId, "ROI");
  assert.equal(card.number, "ROI-103 R");
  assert.equal(card.setReleaseDate, "2025-06-25");
  assert.equal(card.image, "https://tcgplayer-cdn.tcgplayer.com/product/723958_in_1000x1000.jpg");
  assert.equal(card.color, "Egyptian");
  assert.equal(card.aspect, "Prophecy");
  assert.equal(card.trait, "Divine;Beast");
  assert.equal(card.cardType, "Fabled Champion");
  assert.equal(card.cost, 7);
  assert.equal(card.raid, "1");
  // O catálogo anterior já tinha a carta pelo id do Fracture: ele fica.
  assert.equal(cardOf(g, GRUPO, "ROI", 291, new Map(), new Set(["ikr-723959"])).card.id, "ikr-723959");
  // O grupo de promos perde o jogo na frente do nome.
  assert.equal(cardOf(g, { ...GRUPO, name: "Rush of Ikorr Promotional Cards" }, "RIPC", 7).card.set, "Promotional Cards");
});
