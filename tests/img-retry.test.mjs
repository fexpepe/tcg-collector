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

// Carta cuja imagem falhou de vez vira o verso da Sleevu (2026-11-12), igual à
// carta sem URL nenhuma — só na grade (.image-open) e nas impressões
// (.print-art). Antes ficava a caixa cinza do carregamento, sem aviso.
function comPai(img, classe) {
  img.parentNode = { classList: { contains: (c) => c === classe } };
  img.outerHTML = null;
  return img;
}

test("cadeia esgotada na grade: a <img> vira o verso de carta", () => {
  const sandbox = loadShared();
  const img = comPai(imgFalso("https://img.sleevu.app/op/OP18-022.webp", ["https://tcgplayer-cdn.tcgplayer.com/product/718691_in_400x400.jpg"]), "image-open");
  falhaTudo(sandbox, img);
  assert.match(String(img.outerHTML), /class="card-back"/);
  assert.match(String(img.outerHTML), /class="card-back-art"/);
});

test("cadeia de um host só: o verso só entra depois da nova tentativa", () => {
  const sandbox = loadShared();
  const img = comPai(imgFalso("https://assets.tcgdex.net/en/sv/sv1/3/low.webp", []), "print-art");
  sandbox.TCGImg.fallback(img); // agenda o retry: ainda não desistiu
  assert.equal(img.outerHTML, null);
  sandbox.__flushTimers();
  sandbox.TCGImg.fallback(img); // o retry falhou também
  assert.match(String(img.outerHTML), /class="card-back"/);
});

test("fora da grade e das impressões a <img> que falhou fica como está", () => {
  const sandbox = loadShared();
  const img = comPai(imgFalso("https://img.sleevu.app/op/OP18-023.webp", ["https://tcgplayer-cdn.tcgplayer.com/product/1_in_400x400.jpg"]), "preview-image-stack");
  falhaTudo(sandbox, img);
  assert.equal(img.outerHTML, null);
});
