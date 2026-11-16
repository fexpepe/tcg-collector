// Nome do SET do Naruto vintage em inglês no catálogo (14/11/2026).
//
// Decisão do Fernando: traduzir os sets como já se traduzia o nome das cartas.
// Até aqui só a lista de Sets e a página do set mostravam o inglês (pelo
// VINTAGE_SET_EN, na hora de exibir); o seletor de set, o tile e o modal liam o
// `set` cru e mostravam kanji. Agora o translate-naruto-names.mjs grava o
// inglês no `set` e o original no `setJp`, como faz com `name`/`nameJp`.
//
// O que este teste segura:
//   - o passo é idempotente (roda sobre o snapshot já traduzido em todo build);
//   - todo set japonês do catálogo tem tradução (senão volta a aparecer kanji);
//   - o nome traduzido é a CHAVE do set e do endereço: não pode repetir dentro
//     do jogo nem abrir com o nome do jogo ou da linha (contrato 7 do
//     docs/CATALOGO.md). Foi o que mudou dois nomes do mapa: "Promotional
//     Cards" (2002) já era o das promos do CCG, e "Shippuden Promotional
//     Cards" abria com a linha.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readGlobalVar } from "../scripts/lib/sync-common.mjs";
import { mapaDeSetsEn, traduzSet } from "../scripts/lib/naruto-nomes.mjs";

const temCjk = (s) => /[぀-ヿ一-鿿]/.test(String(s || ""));
const cards = await readGlobalVar(new URL("../data/naruto/cards.js", import.meta.url), "TCG_CARDS");

test("traduzSet: inglês no set, original no setJp, e rodar de novo não muda nada", () => {
  const mapa = { "nrt-s02": "Vol. 2 — Demon! Zabuza" };
  const c = { setId: "nrt-s02", set: "巻ノ弐 鬼人！再不斬編" };
  assert.equal(traduzSet(c, mapa), true);
  assert.equal(c.set, "Vol. 2 — Demon! Zabuza");
  assert.equal(c.setJp, "巻ノ弐 鬼人！再不斬編");
  traduzSet(c, mapa);
  assert.equal(c.set, "Vol. 2 — Demon! Zabuza");
  assert.equal(c.setJp, "巻ノ弐 鬼人！再不斬編", "o original não vira o inglês na 2ª rodada");
});

test("traduzSet: set já em inglês ou sem tradução no mapa fica como está", () => {
  const ccg = { setId: "nrt-ccg-s01", set: "The Path to Hokage" };
  assert.equal(traduzSet(ccg, {}), false);
  assert.equal(ccg.set, "The Path to Hokage");
  assert.equal(ccg.setJp, undefined);
  const semMapa = { setId: "nrt-novo", set: "新しい弾" };
  assert.equal(traduzSet(semMapa, {}), false);
  assert.equal(semMapa.set, "新しい弾");
});

test("todo set japonês do catálogo do Naruto tem nome em inglês no VINTAGE_SET_EN", () => {
  const mapa = mapaDeSetsEn();
  const faltando = new Set();
  for (const c of cards) {
    if (temCjk(c.setJp || c.set) && !mapa[c.setId]) faltando.add(`${c.setId} (${c.setJp || c.set})`);
  }
  assert.deepEqual([...faltando], [], "set novo em japonês: acrescentar a tradução em src/nomes-sets.js");
});

test("catálogo versionado já está traduzido: nenhum set em kanji, original no setJp", () => {
  const sets = new Map();
  for (const c of cards) if (!sets.has(c.setId)) sets.set(c.setId, c);
  const emKanji = [...sets.values()].filter((c) => temCjk(c.set)).map((c) => c.setId);
  assert.deepEqual(emKanji, [], "rode node scripts/translate-naruto-names.mjs");
  const traduzidos = [...sets.values()].filter((c) => c.setJp);
  assert.ok(traduzidos.length >= 75, `${traduzidos.length} sets com setJp`);
  for (const c of traduzidos) assert.ok(temCjk(c.setJp), `${c.setId}: setJp sem japonês`);
});

test("nome traduzido: único no jogo e sem o nome do jogo ou da linha na frente", () => {
  const LINHAS = ["Naruto", "NARUTO", "Data Carddass", "Shippuden"];
  const idsDoNome = new Map();
  for (const c of cards) {
    if (!idsDoNome.has(c.set)) idsDoNome.set(c.set, new Set());
    idsDoNome.get(c.set).add(c.setId);
  }
  for (const [nome, ids] of idsDoNome) {
    assert.equal(ids.size, 1, `"${nome}" é o nome de ${[...ids].join(", ")}`);
    const prefixo = LINHAS.find((l) => nome.startsWith(l) && !/^[A-Za-z0-9]/.test(nome.slice(l.length)));
    assert.equal(prefixo, undefined, `"${nome}" abre com "${prefixo}" (contrato 7)`);
  }
});
