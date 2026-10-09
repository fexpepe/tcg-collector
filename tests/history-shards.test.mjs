// Histórico de preço em fragmentos (2026-10-08): o popup baixava o
// price-history do jogo inteiro (1,5 MB brotli no Pokémon, 17,8 MB de JSON)
// pra desenhar uma carta. Agora o split-pricing escreve history-shards/<k>.json
// e o shared.js pede só o fragmento do set da carta. Conferido contra os
// dados de produção: Pokémon em 64 fragmentos (mediana 14 KB, máximo 55 KB em
// brotli), Magic em 64 (mediana 17 KB, máximo 82 KB); no 4G lento o gráfico
// do Charizard da Base Set saiu de 20,5 s pra ~8 s.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fragmentoDoSet, fragmentosPara, montaFragmentos, MAX_FRAGMENTOS } from "../scripts/lib/history-shards.mjs";
import { basePricingId } from "../scripts/lib/sync-common.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const shared = readFileSync(join(raiz, "src/shared.js"), "utf8");

// A cópia do cliente: tirada do shared.js e avaliada aqui.
function fragmentoDoCliente() {
  const i = shared.indexOf("function fragmentoDoSet(setId, n) {");
  assert.ok(i >= 0, "sumiu o fragmentoDoSet do shared.js");
  const fim = shared.indexOf("\n  }\n", i);
  return new Function(`${shared.slice(i, fim + 4)}; return fragmentoDoSet;`)();
}

test("o fragmento de um set é o MESMO no build e no cliente", () => {
  const cliente = fragmentoDoCliente();
  const ids = ["base1", "sv1", "sv03.5", "SV2a", "30th", "swsh12pt5gg", "mtg-10e", "OP01", "lea", "", "M2", "ドラゴン", "PCG-P"];
  for (const n of [1, 4, 8, 64]) {
    for (const id of ids) {
      const k = fragmentoDoSet(id, n);
      assert.ok(Number.isInteger(k) && k >= 0 && k < n);
      assert.equal(cliente(id, n), k, `${id} com ${n} fragmentos`);
    }
  }
});

test("quantos fragmentos: potência de 2 até ~300 KB cada, no máximo 64", () => {
  assert.equal(fragmentosPara(0), 1);
  assert.equal(fragmentosPara(250000), 1);
  assert.equal(fragmentosPara(800000), 4);
  assert.equal(fragmentosPara(2100000), 8);
  assert.equal(fragmentosPara(18400000), 64);
  assert.equal(fragmentosPara(1e9), MAX_FRAGMENTOS);
});

test("montaFragmentos: as cartas de um set juntas, com o id base da localizada, a variação e o graded", () => {
  const hist = { d: ["2026-10-07", "2026-10-08"], c: {
    "sv1-1": { s: "u", p: [1, 2] }, "sv1-2": { s: "u", p: [3, 4] }, "base1-4": { s: "u", p: [400, 410] }
  } };
  const deltas = { from: "2026-10-07", c: { "sv1-1": 100, "base1-4": 2.5 } };
  const graded = { d: ["2026-10-08"], c: { "base1-4": { "10": [9000] } } };
  const idsPorSet = new Map([["sv1", new Set(["sv1-1", "sv1-2", "sv1-1-pt"])], ["base1", new Set(["base1-4"])]]);
  const r = montaFragmentos({ hist, deltas, graded, idsPorSet, basePricingId });
  assert.equal(r.n, 1);
  const [f] = r.fragmentos;
  assert.deepEqual(f.d, hist.d);
  assert.deepEqual(Object.keys(f.c).sort(), ["base1-4", "sv1-1", "sv1-2"]);
  assert.equal(f.xf, "2026-10-07");
  assert.deepEqual(f.x, { "sv1-1": 100, "base1-4": 2.5 });
  assert.deepEqual(f.gd, graded.d);
  assert.deepEqual(f.g, { "base1-4": { "10": [9000] } });

  // Com vários fragmentos, cada set mora inteiro no seu, e a localizada (-pt)
  // leva junto a série da carta base, que é o preço que ela usa.
  const muitos = new Map();
  for (let i = 0; i < 40; i++) muitos.set(`set${i}`, new Set([`set${i}-1`, `set${i}-2`, `set${i}-1-pt`]));
  const histMuitos = { d: ["2026-10-08"], c: {} };
  for (let i = 0; i < 40; i++) { histMuitos.c[`set${i}-1`] = { s: "u", p: [i] }; histMuitos.c[`set${i}-2`] = { s: "u", p: [i] }; }
  histMuitos.c.pad = { s: "u", p: ["x".repeat(700000)] }; // força 4+ fragmentos
  const r2 = montaFragmentos({ hist: histMuitos, deltas: null, graded: null, idsPorSet: muitos, basePricingId });
  assert.ok(r2.n >= 4);
  for (let i = 0; i < 40; i++) {
    const f2 = r2.fragmentos[fragmentoDoSet(`set${i}`, r2.n)];
    assert.ok(f2.c[`set${i}-1`] && f2.c[`set${i}-2`], `set${i} inteiro no fragmento dele`);
    assert.equal(f2.x, undefined, "sem arquivo de variação, sem o campo");
    assert.equal(f2.g, undefined, "sem graded, sem o campo");
  }
  assert.equal(montaFragmentos({ hist: null, deltas, graded, idsPorSet, basePricingId }), null, "sem histórico: sem fragmentos (a flag hs não liga)");
});

test("o popup pede o fragmento do set e só cai nos arquivos inteiros sem a flag hs", () => {
  const corpo = (nome) => {
    const i = shared.indexOf(`async function ${nome}(`);
    assert.ok(i >= 0, `${nome} existe`);
    return shared.slice(i, shared.indexOf("\n  }\n", i));
  };
  assert.match(corpo("fillPriceHistory"), /const f = await fragmentoDaCarta\(card\);\s*const h = f === undefined \? await loadPriceHistory\(/);
  assert.match(corpo("fillPriceDelta"), /f === undefined \? await loadPriceDeltas\([^)]*\)\) : f && \{ from: f\.xf, c: f\.x \}/);
  assert.match(corpo("fillGradedHistory"), /f === undefined \? await loadGradedHistory\([^)]*\)\) : f && \{ d: f\.gd, c: f\.g \}/);
  const frag = corpo("fragmentoDaCarta");
  assert.ok(frag.includes("meta.manifest.hs") && frag.includes("if (!n) return undefined;"));
  assert.ok(frag.includes("history-shards/${fragmentoDoSet(card.setId, n)}.json"));
  const split = readFileSync(join(raiz, "scripts/split-pricing.mjs"), "utf8");
  assert.ok(split.includes("manifest.hs = montados.n;") && split.includes("delete manifest.hs;"));
});
