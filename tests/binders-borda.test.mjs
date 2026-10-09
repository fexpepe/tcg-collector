// Binders sem o catálogo dos 22 jogos (2026-10-08).
//
// Tocar em "Info" num bolso, abrir o editor (bolso vazio) ou imprimir chamava
// o loadAllGamesCatalog: medido em produção, 6.045 arquivos e ~170 MB de JSON
// numa visita, e o modal de Info não abriu em 60 s. Agora cada uso pede só o
// que mostra — as cartas do binder ou da aba aberta pela borda
// (loadOwnedFast), e a aba Catálogo busca o termo digitado na /api/search
// completa. O catálogo de amostra só responde no dev local, sem manifest.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const binders = readFileSync(join(raiz, "src/binders.js"), "utf8");

function corpo(nome) {
  const i = binders.search(new RegExp(`^\\s*(?:async )?function ${nome}\\s*\\(`, "m"));
  assert.ok(i >= 0, `${nome} existe`);
  let nivel = 0, k = binders.indexOf("{", i);
  const abre = k;
  do {
    if (binders[k] === "{") nivel++;
    else if (binders[k] === "}") nivel--;
    k++;
  } while (nivel && k < binders.length);
  return binders.slice(abre, k);
}

test("o catálogo inteiro só é pedido pelo caminho do dev local (sem manifest)", () => {
  const chamadas = binders.match(/loadAllGamesCatalog\(/g) || [];
  assert.equal(chamadas.length, 1, "uma chamada só, a da amostra");
  assert.ok(corpo("catalogoDeAmostra").includes("shared.loadAllGamesCatalog()"));
  const garante = corpo("garanteCartas");
  assert.ok(garante.includes("if (!comBorda()) return catalogoDeAmostra();"), "com a borda, nunca a amostra");
  assert.ok(garante.includes("shared.loadOwnedFast(porJogo)"), "as cartas pedidas vêm pela borda");
  assert.ok(!/ensureCatalog/.test(binders), "o carregador antigo saiu");
});

test("Info, editor e impressão pedem só as cartas que mostram", () => {
  const info = binders.match(/garanteCartas\(\[slot\.cardId\]\)/g) || [];
  assert.equal(info.length, 2, "os dois botões de Info (folha do bolso e o do hover)");
  assert.ok(binders.includes("await garanteCartas(binder.slots.map((slot) => slot && slot.cardId))"), "imprimir: as cartas do binder");
  assert.ok(corpo("openEditor").includes("preparaAba().then("), "editor: a aba aberta");
  const prepara = corpo("preparaAba");
  assert.ok(prepara.includes("[...collectionIds]") && prepara.includes("[...wishlistIds]"));
});

test("a aba Catálogo busca na borda e não refiltra o que ela achou", () => {
  assert.ok(corpo("buscaNaBorda").includes("shared.searchApiFull("));
  const render = corpo("renderSearchResults");
  assert.ok(render.includes('if (editing.tab === "catalog" && comBorda())'));
  assert.ok(render.includes('hint(t("error.catalogSoft"))'), "borda fora vira aviso, não download");
  // A carta da resposta não traz o nameEn: refiltrar no cliente derrubava as
  // japonesas que a borda achou pelo nome em inglês (12 de 400 em "charizard").
  assert.ok(render.includes('editing.tab === "catalog" && comBorda() ? pool.slice() : pool.filter((card) => matchesCardQuery(card, term))'));
});
