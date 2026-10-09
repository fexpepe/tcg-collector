// Explorar sem o catálogo dos 22 jogos (2026-10-08).
//
// 1. A abertura ("mais vistas", ~30 cartas) injetava, por jogo, o manifest e
//    o indexes.generated.js INTEIRO (663 KB no Pokémon, 514 KB no Magic) e os
//    chunks dos sets: 1,5 MB de dado medido em produção. Agora vem pela borda
//    (/api/collection, só as cartas), com os chunks de reserva.
// 2. Qualquer null da busca da borda (rede caiu, 429/5xx, a pausa de 30 s
//    depois de um erro) baixava o catálogo dos 22 jogos — 1.899 pedidos em
//    20 s, medido com a borda fora. Agora a tela avisa e oferece tentar de
//    novo; só o dev local (sem manifest) cai na amostra.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const explore = readFileSync(join(raiz, "src/explore.js"), "utf8");

test("as mais vistas vêm pela borda, não pela carga cruzada com o índice inteiro", () => {
  assert.ok(explore.includes("shared.loadOwnedFast(idsByGame)"));
  assert.ok(!explore.includes("shared.loadOwnedAcrossGames(idsByGame)"));
});

test("borda que não responde vira aviso, e o catálogo inteiro só no dev local", () => {
  assert.ok(explore.includes("if (respostas.some((r) => !r)) { semBorda(); return; }"));
  assert.ok(explore.includes("catch (e) { semBorda(); }"));
  const semBorda = explore.slice(explore.indexOf("function semBorda() {"), explore.indexOf("function semBorda() {") + 400);
  assert.ok(semBorda.includes("if (!(window.SLEEVU && window.SLEEVU.manifest)) { renderFromCatalog(); return; }"));
  assert.ok(semBorda.includes("shared.mostraErroDeCatalogo(elements.empty"));
});
