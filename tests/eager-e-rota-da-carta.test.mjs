// Imagens da grade x o que está na tela (2026-10-08).
// 1. O primeiro append da grade marcava 8 imagens eager (4 com prioridade
//    alta). Num celular de 390 px a tela de set mostra o trilho e só a primeira
//    fileira; as 8 (100 a 210 KB cada, variante de 600 px) desciam juntas e
//    disputavam banda com o que estava à vista. Agora 2 no celular, 8 no
//    desktop — conferido em produção: 2/2 e 8/4 (eager/alta).
// 2. Na rota da carta (/games/<jogo>/<set>/<carta>, o pouso do Google) a grade
//    era montada antes do popup e a imagem grande da carta — o que a pessoa
//    veio ver — entrava na fila depois das eager. Agora o popup abre antes e a
//    grade nasce sem eager: no 4G lento a imagem do popup passou a ser a
//    primeira pedida (antes, 4 da grade na frente).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const shared = readFileSync(join(raiz, "src/shared.js"), "utf8");
const detail = readFileSync(join(raiz, "src/detail.js"), "utf8");

test("eager: 2 no celular, 8 no desktop, nenhuma com o popup aberto", () => {
  assert.ok(shared.includes('if (primeiroAppend && !document.body.classList.contains("preview-open")) {'));
  assert.ok(shared.includes('const n = window.matchMedia && window.matchMedia("(max-width: 720px)").matches ? 2 : 8;'));
});

test("na rota da carta o popup abre antes de a grade ser montada", () => {
  const bloco = detail.slice(detail.indexOf("preview.openFromUrl();"), detail.indexOf("preparaEnderecos();", detail.indexOf("preview.openFromUrl();")));
  assert.ok(bloco.includes("preview.open(cartaDaRota"), "a rota da carta abre o popup");
  assert.ok(bloco.indexOf("preview.open(cartaDaRota") < bloco.indexOf("init();"), "o init (grade) vem depois do popup");
});
