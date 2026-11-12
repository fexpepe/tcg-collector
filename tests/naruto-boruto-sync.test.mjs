// NARUTO BORUTO CARD GAME (linha nrt-nb, 2026-11-12): o produto da TCGCSV que
// vira carta, o id pelo productId, a ordem do set e o snapshot versionado
// contra a numeração do jogo. Sem rede: fixtures e o snapshot do repositório.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SETS, ext, nomeLimpo, linhaDoProduto, ordena, montaLinha } from "../scripts/sync-naruto-boruto.mjs";

const snapshot = JSON.parse(readFileSync(new URL("../data/vintage/naruto-boruto.json", import.meta.url), "utf8"));
const catalogoNaruto = () => {
  const s = readFileSync(new URL("../data/naruto/cards.js", import.meta.url), "utf8");
  return JSON.parse(s.slice(s.indexOf("["), s.lastIndexOf("]") + 1));
};

const produto = (productId, name, numero, extra = {}) => ({
  productId, name, imageCount: 1,
  extendedData: [
    { name: "Rarity", value: "None" },
    ...(numero ? [{ name: "Number", value: numero }] : []),
    { name: "CardType", value: "Battler" },
    { name: "CardColor", value: "Purple" }
  ],
  ...extra
});

test("nome: o número que o TCGplayer cola nos homônimos sai; o resto do parêntese fica", () => {
  assert.equal(nomeLimpo("Rock Lee (NB02-10-B)", "NB02-10-B"), "Rock Lee");
  assert.equal(nomeLimpo("Kurama (Kurama Link Mode)", "NB02-46-EB"), "Kurama (Kurama Link Mode)");
  assert.equal(nomeLimpo("Tobi", "NB01-40-B"), "Tobi");
  // Sem número, nada a tirar.
  assert.equal(nomeLimpo("Inoichi Yamanaka", ""), "Inoichi Yamanaka");
});

test("produto -> linha do snapshot: número, nome limpo, tipo, cor e se tem foto", () => {
  assert.deepEqual(linhaDoProduto(produto(193309, "Rock Lee (NB02-10-B)", "NB02-10-B")), {
    productId: 193309, num: "NB02-10-B", name: "Rock Lee", tipo: "Battler", cor: "Purple", foto: true
  });
  assert.equal(linhaDoProduto(produto(193552, "Tenten", "NB01-03-B", { imageCount: 0 })).foto, false);
  assert.equal(ext(produto(1, "x", "NB01-01-B"), "Number"), "NB01-01-B");
  // A grafia impressa vence a do TCGplayer (a NB02-48-EB imprime "Susano'o").
  assert.equal(linhaDoProduto(produto(193306, "Majestic Attire: Sasano'o", "NB02-48-EB")).name, "Majestic Attire: Susano'o");
});

test("ordem do set: pelo número impresso, e a carta sem número no fim", () => {
  const ordem = ordena([
    { productId: 3, num: "" }, { productId: 2, num: "NB02-01-B" }, { productId: 9, num: "NB01-10-B" }, { productId: 5, num: "NB01-02-B" }
  ]).map((c) => c.num);
  assert.deepEqual(ordem, ["NB01-02-B", "NB01-10-B", "NB02-01-B", ""]);
});

test("montaLinha: id pelo productId, foil, sem imagem quando o TCGplayer não tem foto", () => {
  const snap = { sets: [{ key: "tpc", cards: [
    { productId: 193308, num: "NB01-40-B", name: "Tobi", tipo: "Battler", cor: "Purple", foto: true },
    { productId: 193552, num: "NB01-03-B", name: "Tenten", tipo: "Battler", cor: "Green", foto: false }
  ] }] };
  const line = montaLinha(snap);
  assert.deepEqual(line.map((c) => c.id), ["nrt-nb-193552", "nrt-nb-193308"]);
  const tobi = line[1];
  assert.equal(tobi.set, "Tournament Pack Cards");
  assert.equal(tobi.setId, "nrt-nb-tpc");
  assert.equal(tobi.number, "NB01-40-B");
  assert.equal(tobi.setTotal, 2);
  assert.equal(tobi.setReleaseDate, "2019-06");
  assert.deepEqual(tobi.variants, ["Foil"]);
  assert.equal(tobi.language, "en");
  assert.equal(tobi.vintageLine, "nrt-nb");
  assert.equal(tobi.image, "https://tcgplayer-cdn.tcgplayer.com/product/193308_in_1000x1000.jpg");
  assert.equal(line[0].image, "", "carta sem foto no TCGplayer não aponta pro verso genérico do CDN");
  // Imagem curada do dono vence a da fonte.
  assert.equal(montaLinha(snap, { imagemCurada: (id) => `/assets/cards/naruto/${id}.webp` })[0].image, "/assets/cards/naruto/nrt-nb-193552.webp");
});

test("snapshot versionado: NB01 e NB02 de 01 a 48 sem buraco, productId único", () => {
  const cards = snapshot.sets.flatMap((s) => s.cards);
  assert.equal(new Set(cards.map((c) => c.productId)).size, cards.length, "productId repetido");
  for (const set of ["NB01", "NB02"]) {
    const nums = cards.map((c) => c.num).filter((n) => n.startsWith(set + "-")).map((n) => Number(n.split("-")[1])).sort((a, b) => a - b);
    assert.deepEqual(nums, Array.from({ length: 48 }, (_, i) => i + 1), `${set}: numeração com buraco ou repetida`);
  }
  // Todo número impresso segue o formato do jogo: set, número e tipo
  // (B = Battler, A = Action, EB = Extra Deck Battler).
  for (const c of cards) if (c.num) assert.match(c.num, /^NB0[12]-\d{2}-(B|A|EB)$/, c.num);
  assert.equal(cards.filter((c) => !c.num).length, 1, "só a Inoichi Yamanaka vem sem número");
});

test("catálogo do Naruto: a linha está lá, com os ids do snapshot e sem roubar id de outra linha", () => {
  const daLinha = catalogoNaruto().filter((c) => /^nrt-nb-/.test(c.id));
  const esperado = montaLinha(snapshot);
  assert.equal(daLinha.length, esperado.length);
  assert.deepEqual(new Set(daLinha.map((c) => c.id)), new Set(esperado.map((c) => c.id)));
  assert.deepEqual([...new Set(daLinha.map((c) => c.setId))], SETS.map((s) => `nrt-nb-${s.key}`));
  for (const c of daLinha) {
    assert.equal(c.vintage, true);
    assert.equal(c.vintageLine, "nrt-nb");
  }
});
