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
  readGlobalVar, preserveMissingCards, snapshotCardCount,
  normNum, numDoId, fetchJsonRetry
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

// ── Número da carta: o que mantém o ID estável entre builds ─────────────────
// A PPT devolve várias impressões no MESMO número ("5" e "005") e a gente fica
// com a de maior preço — que muda todo dia. Se o id saísse do número cru, a
// mesma carta trocaria de id sozinha, e id de carta é a chave da coleção, do
// deck, da wishlist e do binder de quem já coleciona.
test("normNum: casa impressões do mesmo número, sem colidir com a galeria", () => {
  assert.equal(normNum("077/071"), "77");
  assert.equal(normNum("005"), "5");
  assert.equal(normNum("199"), "199");
  // O "TG08" da Trainer Gallery NÃO pode virar 8 (colidiria com o regular).
  assert.equal(normNum("TG08/TG30"), "tg8");
  assert.notEqual(normNum("TG08"), normNum("8"));
});

test("numDoId: número do id não depende de qual impressão ganhou no preço", () => {
  // Mesmo normNum -> MESMO número no id (é a garantia que trava a duplicata).
  for (const [a, b] of [["5", "005"], ["TG08", "TG8"], ["077", "77"]]) {
    assert.equal(normNum(a), normNum(b), `${a} e ${b} deviam casar`);
    assert.equal(numDoId(a), numDoId(b), `${a} e ${b} deviam dar o mesmo id`);
  }
  // Mantém a caixa da fonte (a TCGdex escreve "bwp-BW01") e não estraga o resto.
  assert.equal(numDoId("TG08"), "TG8");
  assert.equal(numDoId("4A"), "4A");
  assert.equal(numDoId("0"), "0");
  assert.equal(numDoId("077/071"), "77");
  assert.equal(numDoId(""), "");
});

// fetchJsonRetry: o retry que segura o sync-tcgdex quando a TCGdex cai.
// fetch e sleep falsos: as respostas vêm de uma fila e as esperas são anotadas.
function fakeFetch(queue) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const next = queue.shift();
    if (next instanceof Error) throw next;
    const { status = 200, body = {}, retryAfter } = next;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => (k === "retry-after" && retryAfter != null ? String(retryAfter) : null) },
      json: async () => body
    };
  };
  return { fetchImpl, calls };
}
function fakeSleep() {
  const waits = [];
  return { sleepImpl: async (ms) => { waits.push(ms); }, waits };
}

test("fetchJsonRetry: 503 e erro de rede repetem com backoff exponencial até responder", async () => {
  const { fetchImpl, calls } = fakeFetch([{ status: 503 }, new Error("ECONNRESET"), { status: 200, body: { ok: 1 } }]);
  const { sleepImpl, waits } = fakeSleep();
  const out = await fetchJsonRetry("https://x/sets", { fetchImpl, sleepImpl, baseDelayMs: 100 });
  assert.deepEqual(out, { ok: 1 });
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [100, 200]);
});

test("fetchJsonRetry: 404 lança na hora, sem repetir e sem marcar como transitório", async () => {
  const { fetchImpl, calls } = fakeFetch([{ status: 404 }, { status: 200 }]);
  const { sleepImpl, waits } = fakeSleep();
  await assert.rejects(fetchJsonRetry("https://x/cards/nope", { fetchImpl, sleepImpl }), (e) => e.status === 404 && !e.transient);
  assert.equal(calls.length, 1);
  assert.deepEqual(waits, []);
});

test("fetchJsonRetry: ao esgotar as tentativas lança com transient=true e o último status", async () => {
  const { fetchImpl, calls } = fakeFetch([{ status: 503 }, { status: 502 }, { status: 503 }]);
  const { sleepImpl, waits } = fakeSleep();
  await assert.rejects(fetchJsonRetry("https://x/sets", { fetchImpl, sleepImpl, retries: 2, baseDelayMs: 1000 }),
    (e) => e.status === 503 && e.transient === true);
  assert.equal(calls.length, 3); // 1 tentativa + 2 retries
  assert.deepEqual(waits, [1000, 2000]);
});

test("fetchJsonRetry: respeita Retry-After (segundos) quando maior que o backoff, com teto", async () => {
  const { fetchImpl } = fakeFetch([{ status: 429, retryAfter: 5 }, { status: 503, retryAfter: 3600 }, { status: 200, body: [] }]);
  const { sleepImpl, waits } = fakeSleep();
  await fetchJsonRetry("https://x/sets", { fetchImpl, sleepImpl, baseDelayMs: 1000, maxDelayMs: 60000 });
  assert.deepEqual(waits, [5000, 60000]);
});

test("fetchJsonRetry: padrão soma ~1 min de espera (1+2+4+8+16+32 s) antes de desistir", async () => {
  const { fetchImpl } = fakeFetch(Array.from({ length: 7 }, () => ({ status: 503 })));
  const { sleepImpl, waits } = fakeSleep();
  await assert.rejects(fetchJsonRetry("https://x/sets", { fetchImpl, sleepImpl }), (e) => e.transient);
  assert.equal(waits.reduce((a, b) => a + b, 0), 63000);
});
