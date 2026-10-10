// Popup da carta: a miniatura de carregamento some quando a imagem grande
// chega (2026-10-10, teste do Fernando no app, no Galaxy S10: "como se
// tivesse duas cartas renderizadas uma em cima da outra"). O ouvinte de
// "load" do src/shared.js marca o stack; o CSS esconde a miniatura.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadShared } from "./lib/shared-sandbox.mjs";

// Carrega o shared.js guardando os ouvintes que ele põe no document.
const ouvintes = {};
loadShared("", {
  antes(s) { s.document.addEventListener = (tipo, fn) => { (ouvintes[tipo] ||= []).push(fn); }; }
});

function classes(lista = []) {
  const set = new Set(lista);
  return { add: (c) => set.add(c), contains: (c) => set.has(c), has: (c) => set.has(c), set };
}
function carrega(img) { (ouvintes.load || []).forEach((fn) => fn({ target: img })); }

test("a grande carregou: o stack ganha tem-grande (a miniatura some pelo CSS)", () => {
  const stack = { classList: classes(["preview-image-stack"]) };
  const thumb = { tagName: "IMG", parentNode: stack, classList: classes(["preview-image-thumb"]), naturalWidth: 245, naturalHeight: 337 };
  const grande = { tagName: "IMG", parentNode: stack, classList: classes([]), naturalWidth: 600, naturalHeight: 825 };
  carrega(thumb);
  assert.equal(stack.classList.has("tem-grande"), false, "a miniatura sozinha não esconde nada");
  carrega(grande);
  assert.equal(stack.classList.has("tem-grande"), true);
  assert.equal(stack.classList.has("is-landscape"), false);
  assert.equal(grande.classList.has("is-loaded"), true); // o fade de sempre segue igual
});

test("carta deitada segue marcando is-landscape; img fora do popup não ganha nada", () => {
  const stack = { classList: classes(["preview-image-stack"]) };
  carrega({ tagName: "IMG", parentNode: stack, classList: classes([]), naturalWidth: 880, naturalHeight: 630 });
  assert.equal(stack.classList.has("is-landscape"), true);
  const tile = { classList: classes(["image-open"]) };
  carrega({ tagName: "IMG", parentNode: tile, classList: classes([]), naturalWidth: 600, naturalHeight: 825 });
  assert.equal(tile.classList.has("tem-grande"), false);
  // Pai sem classList (raro, mas não pode quebrar o ouvinte de todas as imagens).
  assert.doesNotThrow(() => carrega({ tagName: "IMG", parentNode: {}, classList: classes([]), naturalWidth: 1, naturalHeight: 1 }));
});

test("o CSS esconde a miniatura quando o stack tem a grande", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /\.preview-image-stack\.tem-grande \.preview-image-thumb \{ visibility: hidden; \}/);
});
