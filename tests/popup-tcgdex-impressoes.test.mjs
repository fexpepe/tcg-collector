// Popup da carta (2026-10-08):
// 1. A TCGdex só tem Pokémon: todo popup de Magic/One Piece/… pedia
//    api.tcgdex.net/…/mtg-… e levava 404, e a cotação, o gráfico e os
//    vendedores esperavam esse pedido, que não tinha prazo. Agora sai cedo
//    fora do Pokémon, tem prazo, e o 404 fica guardado como "não tem".
// 2. No celular as Impressões nasciam escondidas ENTRE a carta e o título e
//    apareciam quando a borda respondia: a fileira do "+" pulava ~60 px bem na
//    hora do toque. Agora descem com a ficha, pra depois das ações.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadShared } from "./lib/shared-sandbox.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

test("fetchCardPricing: fora do Pokémon não pede a TCGdex; 404 fica guardado", async () => {
  const sandbox = loadShared("window.__test = { fetchCardPricing };");
  const pedidos = [];
  sandbox.fetch = (url) => { pedidos.push(String(url)); return Promise.resolve({ ok: false, status: 404, json: async () => null }); };
  const { fetchCardPricing } = sandbox.__test;
  assert.equal(await fetchCardPricing({ id: "mtg-mbc-22", game: "magic", language: "en" }), null);
  assert.equal(await fetchCardPricing({ id: "op-718691", game: "onepiece", language: "en" }), null);
  assert.deepEqual(pedidos, [], "carta de outro jogo não vai à TCGdex");
  assert.equal(await fetchCardPricing({ id: "zzz-999", game: "pokemon", language: "en" }), null);
  assert.equal(pedidos.length, 1);
  assert.equal(await fetchCardPricing({ id: "zzz-999", game: "pokemon", language: "en" }), null);
  assert.equal(pedidos.length, 1, "o 404 ficou guardado: a 2ª abertura não pede de novo");
  // Erro que não é 404 (rede, 5xx) não fica guardado.
  sandbox.fetch = (url) => { pedidos.push(String(url)); return Promise.resolve({ ok: false, status: 503, json: async () => null }); };
  await fetchCardPricing({ id: "zzz-998", game: "pokemon", language: "en" });
  await fetchCardPricing({ id: "zzz-998", game: "pokemon", language: "en" });
  assert.equal(pedidos.length, 3);
});

test("fetchCardPricing tem prazo", () => {
  const shared = readFileSync(join(raiz, "src/shared.js"), "utf8");
  const i = shared.indexOf("async function fetchCardPricing(card) {");
  const corpo = shared.slice(i, shared.indexOf("\n  }\n", i));
  assert.ok(corpo.includes("AbortSignal.timeout(5000)"));
});

test("no celular as Impressões descem com a ficha, pra depois das ações", () => {
  const shared = readFileSync(join(raiz, "src/shared.js"), "utf8");
  const i = shared.indexOf('if (acoes && acoes.parentNode) acoes.insertAdjacentElement("afterend", det);');
  assert.ok(i > 0, "sumiu a descida da ficha no celular");
  const depois = shared.slice(i, i + 700);
  assert.ok(depois.includes('const imp = modal.querySelector("[data-preview-prints]");'));
  assert.ok(depois.includes('if (imp) det.insertAdjacentElement("afterend", imp);'));
});
