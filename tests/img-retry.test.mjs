// Imagem que não existe não vira rajada (2026-10-08). Quando a cadeia de
// fallback esgotava, o TCGImg refazia a cadeia INTEIRA até 4 vezes, com
// cache-buster: medido em produção, 15 pedidos por carta sem imagem em todo
// set recém-lançado (404 do espelho e 403 do TCGplayer), 150 pedidos falhos
// pra 10 cartas, repetidos em toda visita. Agora: cadeia que falhou em hosts
// diferentes é falta de imagem e para ali; cadeia de um host só (rate-limit)
// ganha UMA nova tentativa, só da URL original.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared } from "./lib/shared-sandbox.mjs";

// <img> de mentira: guarda os atributos e conta cada `src` pedido.
function imgFalso(src, cadeia) {
  const attrs = new Map([["src", src]]);
  if (cadeia.length) attrs.set("data-img-fallbacks", cadeia.join("|"));
  attrs.set("data-card-img", "");
  const pedidos = [src];
  return {
    pedidos,
    isConnected: true,
    classList: { contains: () => false },
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
    hasAttribute: (k) => attrs.has(k),
    set src(v) { attrs.set("src", v); pedidos.push(v); },
    get src() { return attrs.get("src"); }
  };
}
// Falha cada URL até não sobrar nada pra tentar (os timers do retry rodam na hora).
function falhaTudo(sandbox, img) {
  for (let i = 0; i < 20; i++) {
    const antes = img.pedidos.length;
    sandbox.TCGImg.fallback(img);
    sandbox.__flushTimers();
    if (img.pedidos.length === antes) break;
  }
}

test("cadeia que falhou em hosts diferentes: nenhuma nova tentativa", () => {
  const sandbox = loadShared();
  const img = imgFalso("https://img.sleevu.app/op/OP18-022.webp", ["https://tcgplayer-cdn.tcgplayer.com/product/718691_in_400x400.jpg"]);
  falhaTudo(sandbox, img);
  assert.deepEqual(img.pedidos, [
    "https://img.sleevu.app/op/OP18-022.webp",
    "https://tcgplayer-cdn.tcgplayer.com/product/718691_in_400x400.jpg"
  ], "2 pedidos e acabou (eram 10: a cadeia refeita 4 vezes)");
});

test("cadeia de um host só: UMA nova tentativa, só da URL original", () => {
  const sandbox = loadShared();
  const img = imgFalso("https://assets.tcgdex.net/en/sv/sv1/1/low.webp", ["https://assets.tcgdex.net/en/sv/sv1/1/high.png"]);
  falhaTudo(sandbox, img);
  assert.deepEqual(img.pedidos, [
    "https://assets.tcgdex.net/en/sv/sv1/1/low.webp",
    "https://assets.tcgdex.net/en/sv/sv1/1/high.png",
    "https://assets.tcgdex.net/en/sv/sv1/1/low.webp?_r=1"
  ]);
});

test("imagem que carregou ou saiu da tela antes do retry não é pedida de novo", () => {
  const sandbox = loadShared();
  const img = imgFalso("https://assets.tcgdex.net/en/sv/sv1/2/low.webp", []);
  sandbox.TCGImg.fallback(img); // agenda o retry
  img.isConnected = false;
  sandbox.__flushTimers();
  assert.equal(img.pedidos.length, 1);
});
