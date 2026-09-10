// Miniatura de hover (Impressões do popup / editor de listas): hoverThumb do
// src/shared.js. Ela carregava a URL CRUA da carta sob o mouse, sem a cadeia
// de fallback que a imagem grande do popup tem — numa carta que a TCGdex não
// tem (illustration rare do 151) aparecia quebrada enquanto a imagem grande,
// vinda da pokemontcg.io, aparecia normal.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared } from "./lib/shared-sandbox.mjs";

const sb = loadShared();
const { hoverThumb, cardImgChain, localizedImg } = sb.window.TCGShared;

// <img> de mentira: só o que hoverThumb toca (atributos, classe, replaceWith).
function fakeImg(attrs = {}, className = "") {
  const map = { ...attrs };
  const el = {
    className,
    hidden: false,
    replacedBy: null,
    get attributes() { return Object.keys(map).map((name) => ({ name, value: map[name] })); },
    getAttribute: (k) => (k in map ? map[k] : null),
    setAttribute: (k, v) => { map[k] = String(v); },
    replaceWith(next) { el.replacedBy = next; }
  };
  return el;
}
sb.document.createElement = (tag) => { assert.equal(tag, "img"); return fakeImg(); };

const EN = "https://assets.tcgdex.net/en/sv/sv03.5/166/high.png";
const PTCG = "https://images.pokemontcg.io/sv3pt5/166.png";

test("mesma cadeia do localizedImg: webp → png → pokemontcg.io → outra língua", () => {
  const { src, chain } = cardImgChain(EN, { fallback: PTCG });
  assert.equal(src, "https://assets.tcgdex.net/en/sv/sv03.5/166/high.webp");
  assert.deepEqual([...chain], [EN, PTCG, "https://assets.tcgdex.net/pt/sv/sv03.5/166/high.png"]);
  // O localizedImg é só esta cadeia em HTML.
  const html = localizedImg(EN, { fallback: PTCG });
  assert.ok(html.includes(`src="${src}"`));
  assert.ok(html.includes(`data-img-fallbacks="${chain.join("|")}"`));
});

test("hoverThumb troca o nó por um <img> com a cadeia e os marcadores do antigo", () => {
  const old = fakeImg({ "data-print-thumb": "", hidden: "" }, "preview-print-thumb is-loaded");
  const next = hoverThumb(old, EN, { fallback: PTCG });
  assert.notEqual(next, old);
  assert.equal(old.replacedBy, next);
  assert.equal(next.className, "preview-print-thumb"); // sem o is-loaded do antigo
  assert.equal(next.getAttribute("data-print-thumb"), ""); // quem procura o thumb continua achando
  assert.equal(next.getAttribute("hidden"), null);
  assert.equal(next.getAttribute("src"), "https://assets.tcgdex.net/en/sv/sv03.5/166/high.webp");
  assert.equal(next.getAttribute("data-img-fallbacks"), [EN, PTCG, "https://assets.tcgdex.net/pt/sv/sv03.5/166/high.png"].join("|"));
  assert.equal(next.getAttribute("data-card-img"), ""); // elegível ao TCGImg.fallback
});

test("mesma URL = mesmo nó (sem refetch); outra carta = nó novo sem o estado do TCGImg", () => {
  const a = hoverThumb(fakeImg({ "data-print-thumb": "" }, "preview-print-thumb"), EN, {});
  assert.equal(hoverThumb(a, EN, {}), a);
  // O TCGImg.fallback já mexeu neste nó (a URL falhou, retry agendado).
  a.setAttribute("data-img-orig", "x"); a.setAttribute("data-img-retries", "2");
  const b = hoverThumb(a, "https://assets.tcgdex.net/en/sv/sv08/143/high.png", {});
  assert.notEqual(b, a);
  assert.equal(b.getAttribute("data-img-orig"), null);
  assert.equal(b.getAttribute("data-img-retries"), null);
  assert.equal(b.getAttribute("data-print-thumb"), "");
});

test("sem URL ou sem nó, devolve o que recebeu", () => {
  const el = fakeImg();
  assert.equal(hoverThumb(el, "", {}), el);
  assert.equal(hoverThumb(null, EN, {}), null);
});
