// Testes do sync do NARUTO CARD GAME novo (scripts/sync-naruto.mjs), sem rede:
// a promo curada que ABSORVE o produto do TCGplayer (id publicado não muda), o
// setId fixo por groupId, o preço market→mid e a carta da fonte que fica
// congelada em vez de sumir. O fixture é a TCGCSV de 30/09/2026 (categoria 93).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { setIdOf, montaLinha, precosPorProduto, CURATED, PRODUTO_CURADO, SET_FIXO } from "../scripts/sync-naruto.mjs";

const chakra = (productId, name) => ({
  productId,
  name,
  extendedData: [
    { name: "Rarity", value: "Promo" }, { name: "Number", value: "CP-001" },
    { name: "Description", value: "When using Chakra, turn this card face down." },
    { name: "CardType", value: "Chakra" }
  ]
});
// Um grupo novo a cada teste: montaLinha mexe nas cartas que monta.
const promos = () => ({
  g: { groupId: 24885, name: "Promotion Cards", abbreviation: "", publishedOn: "2026-09-16T00:00:00" },
  prods: [chakra(717832, "Chakra Card (Gen Con)"), chakra(717838, "Chakra Card (New York Yankees)")],
  prices: [
    { productId: 717832, lowPrice: 899.99, midPrice: 999.59, highPrice: 1000, marketPrice: null, subTypeName: "Normal" },
    { productId: 717838, lowPrice: 200, midPrice: 200, highPrice: 200, marketPrice: null, subTypeName: "Normal" }
  ]
});

test("setId: o grupo das promos cai no set que a curadoria já publicou", () => {
  assert.equal(setIdOf({ groupId: 24885, abbreviation: "" }), "nrt-ncg-promo");
  // A fonte preencher a abreviação depois não pode mudar setId publicado.
  assert.equal(setIdOf({ groupId: 24885, abbreviation: "PR" }), "nrt-ncg-promo");
});

test("setId: grupo novo sem pin cai na abreviação, ou no groupId se vier vazia", () => {
  assert.equal(setIdOf({ groupId: 1, abbreviation: "BT01" }, new Map([["bt01", 1]])), "nrt-ncg-bt01");
  assert.equal(setIdOf({ groupId: 2, abbreviation: " " }), "nrt-ncg-g2");
  assert.equal(setIdOf({ groupId: 3, abbreviation: "PR" }, new Map([["pr", 2]])), "nrt-ncg-pr-3");
});

test("curadoria: todo produto mapeado aponta pra uma carta curada; pins únicos", () => {
  const curados = new Set(CURATED.map((c) => c.id));
  for (const id of Object.values(PRODUTO_CURADO)) assert.ok(curados.has(id), id);
  const pins = Object.values(SET_FIXO);
  assert.equal(new Set(pins).size, pins.length);
  for (const s of pins) assert.match(s, /^nrt-ncg-[a-z0-9-]+$/);
});

test("Gen Con: a curada absorve o produto 717832 — mesmo id, nome e scan, preço da fonte", () => {
  const { cards, pricing } = montaLinha([promos()]);
  assert.deepEqual(cards.map((c) => c.id), ["nrt-ncg-cp-001", "nrt-ncg-717838"]);
  const genCon = cards[0];
  assert.equal(genCon.name, "Chakra Card -Gen Con 2026 Ver.-");
  assert.equal(genCon.image, "/assets/cards/naruto/nrt-ncg-cp-001.webp");
  assert.equal(genCon.rarity, "Promo");          // vazio na curadoria, veio da fonte
  assert.equal(genCon.cardType, "Chakra");
  assert.ok(!cards.some((c) => c.id === "nrt-ncg-717832"), "a mesma carta não pode entrar duas vezes");
  // Sem venda ainda (marketPrice null): vale o mid dos anúncios.
  assert.deepEqual(pricing["nrt-ncg-cp-001"], { u: 999.59 });
  assert.deepEqual(pricing["nrt-ncg-717838"], { u: 200 });
  assert.equal(pricing["nrt-ncg-717832"], undefined);
});

test("Yankees: entra pelo productId com o nome oficial e os campos de set da curadoria", () => {
  const { cards } = montaLinha([promos()]);
  const nyy = cards.find((c) => c.id === "nrt-ncg-717838");
  assert.equal(nyy.name, "Chakra Card -New York Yankees Ver.-");
  assert.equal(nyy.number, "CP-001");
  assert.equal(nyy.image, "https://tcgplayer-cdn.tcgplayer.com/product/717838_in_1000x1000.jpg");
  assert.equal(nyy.language, "en");
  // Campos de set iguais no set inteiro: data do primeiro evento (não a da
  // listagem no TCGplayer), logo e nome da curadoria, total = 2.
  for (const c of cards) {
    assert.equal(c.setId, "nrt-ncg-promo");
    assert.equal(c.set, "Promotion Cards");
    assert.equal(c.setReleaseDate, "2026-07-30");
    assert.equal(c.setLogo, "/assets/games/game_naruto_2027.webp");
    assert.equal(c.setTotal, 2);
  }
});

test("sem categoria (variável desligada): o que já foi publicado fica, congelado", () => {
  const publicada = { ...montaLinha([promos()]).cards[1] };
  const { cards, pricing, congeladas } = montaLinha([], { anteriores: [publicada, { id: "nrt-S-001", setId: "nrt-s01" }] });
  assert.deepEqual(cards.map((c) => c.id), ["nrt-ncg-cp-001", "nrt-ncg-717838"]);
  assert.equal(congeladas, 1);                    // só a da linha; o vintage não é daqui
  assert.equal(cards[0].setTotal, 2);
  assert.deepEqual(pricing, {});
});

test("preço: market quando há venda, mid quando não há, nada quando não há nenhum", () => {
  const by = precosPorProduto([
    { productId: 1, marketPrice: 3.5, midPrice: 9, subTypeName: "Normal" },
    { productId: 1, marketPrice: null, midPrice: 12.345, subTypeName: "Foil" },
    { productId: 2, marketPrice: null, midPrice: null, subTypeName: "Normal" }
  ]);
  assert.equal(by.get(1).get("Normal"), 3.5);
  assert.equal(by.get(1).get("Foil"), 12.35);
  assert.equal(by.has(2), false);
});

test("produto selado (sem Number) não vira carta", () => {
  const grupo = promos();
  grupo.prods.push({ productId: 999, name: "NARUTO CARD GAME Booster Box", extendedData: [] });
  const { cards } = montaLinha([grupo]);
  assert.ok(!cards.some((c) => c.id === "nrt-ncg-999"));
});
