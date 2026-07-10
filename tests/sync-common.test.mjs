// Testes dos helpers de sync/build (scripts/lib/sync-common.mjs).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  slug, decodeEntities, buildSetIndexes, writeGameCatalog,
  readGlobalVar, preserveMissingCards, snapshotCardCount
} from "../scripts/lib/sync-common.mjs";

test("slug: normaliza acentos, caixa e separadores", () => {
  assert.equal(slug("Pokémon: Édition Spéciale!"), "pokemon-edition-speciale");
  assert.equal(slug("OP-05"), "op-05");
  assert.equal(slug("  --  "), "");
});

test("decodeEntities: entidades comuns + strip de tags", () => {
  assert.equal(decodeEntities("Luffy&#39;s &amp; Zoro <b>Ace</b>"), "Luffy's & Zoro Ace");
  assert.equal(decodeEntities("a &#8211; b"), "a - b");
});

test("buildSetIndexes: agrupa por set e artista, ordenado", () => {
  const idx = buildSetIndexes([
    { id: "x-2", set: "Beta", artist: "Zed" },
    { id: "x-1", set: "Alpha", artist: "Ana" },
    { id: "x-3", set: "Alpha" } // sem artista: só no set
  ]);
  assert.deepEqual(idx.sets.map((s) => s.name), ["Alpha", "Beta"]);
  assert.deepEqual(idx.sets[0].cardIds, ["x-1", "x-3"]);
  assert.deepEqual(idx.artists.map((a) => a.name), ["Ana", "Zed"]);
});

test("preserveMissingCards: mantém o que sumiu, ignora o que continua", () => {
  const prev = [{ id: "a" }, { id: "b" }, { id: "c" }, { bad: true }];
  const fresh = [{ id: "b" }];
  assert.deepEqual(preserveMissingCards(prev, fresh).map((c) => c.id), ["a", "c"]);
  assert.deepEqual(preserveMissingCards(null, fresh), []);
  assert.equal(preserveMissingCards(prev, null).length, 3);
});

test("snapshotCardCount: soma cartas dos sets do snapshot", () => {
  assert.equal(snapshotCardCount({ sets: [{ cards: [1, 2] }, { cards: [3] }, {}] }), 3);
  assert.equal(snapshotCardCount(null), 0);
});

test("writeGameCatalog: cards.js completo + manifest real + chunks íntegros", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sleevu-cat-"));
  const outUrl = new URL(pathToFileURL(dir) + "/");
  const cards = [
    { id: "g-1", set: "Alpha", setId: "AL-01", number: "1", language: "en" },
    { id: "g-2", set: "Alpha", setId: "AL-01", number: "2", language: "en" },
    { id: "g-3", set: "Beta", setId: "BE 01", number: "1", language: "ja" }, // slug com espaço
    { id: "g-4", set: "Beta2", setId: "BE_01", number: "1", language: "en" } // colide pós-slug
  ];
  try {
    await writeGameCatalog(outUrl, { cards, pricing: { "g-1": { u: 5 } }, webDir: "data/teste/" });

    const full = await readGlobalVar(new URL("cards.js", outUrl), "TCG_CARDS");
    assert.equal(full.length, 4);

    const manifest = await readGlobalVar(new URL("manifest.generated.js", outUrl), "TCG_MANIFEST");
    assert.equal(manifest.sets.length, 3);
    assert.equal(manifest.sets.reduce((s, x) => s + x.count, 0), 4);
    // Todos os arquivos de chunk existem, com paths do site (webDir) e ids íntegros.
    const seen = new Set();
    for (const s of manifest.sets) {
      assert.ok(s.file.startsWith("data/teste/sets/"), `file com webDir: ${s.file}`);
      const chunk = JSON.parse(await readFile(join(dir, s.file.replace("data/teste/", "")), "utf8"));
      assert.equal(chunk.length, s.count);
      chunk.forEach((c) => seen.add(c.id));
    }
    assert.equal(seen.size, 4, "todas as cartas presentes nos chunks, sem perda");
    // Colisão pós-slug (BE 01 e BE_01 -> be-01) resolvida com sufixo, sem sobrescrever.
    const files = await readdir(join(dir, "sets"));
    assert.equal(files.length, 3);

    const pricing = await readGlobalVar(new URL("pricing.generated.js", outUrl), "TCG_PRICING");
    assert.equal(pricing["g-1"].u, 5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
