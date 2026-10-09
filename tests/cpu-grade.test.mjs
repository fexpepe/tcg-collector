// Contas que se repetiam por carta/cartão e custavam caro (2026-10-08):
// - Ordenar por nome: localeCompare com locale e opções monta a regra a cada
//   comparação — 5,6 mil nomes: 255 ms; com um Intl.Collator, 6 ms (Node).
// - Data de lançamento dos cartões de set: toLocaleDateString com opções monta
//   o formatador a cada chamada — 3 mil chamadas: 91 ms; cacheado, 1,6 ms.
// - Faceta Tipo do Magic: 17 RegExp montadas por carta a cada contagem.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (f) => readFileSync(join(raiz, f), "utf8");

test("ordenar por nome usa um Intl.Collator por ordenação", () => {
  const o = ler("src/ordenar.js");
  assert.ok(o.includes('const colacao = new Intl.Collator(locale, { sensitivity: "base", numeric: true });'));
  assert.ok(!/localeCompare\([^)]*,\s*locale,/.test(o), "voltou o localeCompare com locale e opções por comparação");
});

test("a data dos cartões de set sai de um Intl.DateTimeFormat guardado", () => {
  const a = ler("src/app.js");
  const i = a.indexOf("function formatReleaseDate(");
  const corpo = a.slice(i, a.indexOf("\n  }\n", i));
  assert.ok(corpo.includes("new Intl.DateTimeFormat(") && corpo.includes("formatosDeData.set(chave, f);"));
  assert.ok(!corpo.includes("toLocaleDateString"));
});

test("a faceta Tipo do Magic compila as RegExp uma vez", () => {
  const f = ler("src/facets.js");
  assert.ok(f.includes("const MTG_TYPE_RE = MTG_TYPES.map("));
  const i = f.indexOf("function mtgTypeBuckets(");
  assert.ok(!f.slice(i, f.indexOf("\n  }\n", i)).includes("new RegExp"));
});

// CSS (2026-10-08): o palpite de altura do content-visibility (380 px, o tile
// em grade) valia também pras linhas da lista (~130 px) e do compacto (48 px)
// — a barra de rolagem mentia o tamanho da página; e o .set-release tinha um
// backdrop-filter invisível (fundo opaco) que criava uma camada por cartão.
test("palpite de altura por modo da grade, e sem backdrop-filter no selo de lançamento", () => {
  const css = ler("styles.css");
  const regra = (sel) => { const i = css.indexOf(`${sel} {`); assert.ok(i >= 0, sel); return css.slice(i, css.indexOf("}", i)); };
  assert.match(regra(".card-grid.is-list .card-tile"), /contain-intrinsic-size: auto 130px;/);
  assert.match(regra(".card-tile.tile-compact"), /contain-intrinsic-size: auto 48px;/);
  assert.ok(!/backdrop-filter/.test(regra(".set-release")));
});
