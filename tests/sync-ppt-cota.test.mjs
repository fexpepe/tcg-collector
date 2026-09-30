// sync-ppt sem crédito: cota do dia esgotada e o modo --so-cache.
//
// O teste existe por causa de 30/09/2026: cinco builds completos no mesmo dia
// (três da main, dois de preview de branch) somaram os 20.000 créditos da PPT.
// O build seguinte levou "PPT 429: Daily rate limit exceeded" no primeiro /sets
// — o único ppt() sem try em volta — e o sync saiu com exit 1: deploy parado.
// O anterior, que bateu na cota no meio, tinha perdido o preço/graded das
// cartas curadas (Ancient Mew), porque elas não tinham cache.
//
// Roda o script DE VERDADE numa raiz de mentira (cópia de scripts/sync-ppt.mjs
// e scripts/lib), com o fetch trocado via --import: a PPT responde 429 diário
// e a "produção" devolve um manifest com dois sets JP. Conta as chamadas à PPT
// pra travar que o 429 diário não é repetido.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

// fetch falso: PPT = 429 "Daily rate limit exceeded" sempre; produção = um
// manifest com SV4a e SV9 (JP); o resto 404. Imprime no stderr, ao sair,
// quantas vezes a PPT foi chamada.
const FETCH_FALSO = `
let chamadasPpt = 0;
process.on("exit", () => process.stderr.write("CHAMADAS_PPT=" + chamadasPpt + "\\n"));
globalThis.fetch = async (url) => {
  url = String(url);
  if (url.startsWith("https://www.pokemonpricetracker.com/")) {
    chamadasPpt++;
    return new Response(JSON.stringify({ error: "Daily rate limit exceeded" }), { status: 429, statusText: "Too Many Requests", headers: { "content-type": "application/json" } });
  }
  if (url.endsWith("/data/manifest.generated.js")) {
    return new Response('window.TCG_MANIFEST = {"sets":[{"id":"SV4a","language":"ja"},{"id":"SV9","language":"ja"}]};');
  }
  return new Response("", { status: 404 });
};
`;

// Monta a raiz de mentira. `cache`: { arquivo: conteúdo } dentro de
// data/.cache/ppt/; `artefato`: conteúdo pros dois .generated.json (ou nada).
function montaRaiz({ cache = {}, artefato = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sync-ppt-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  cpSync(join(raiz, "scripts", "sync-ppt.mjs"), join(dir, "scripts", "sync-ppt.mjs"));
  cpSync(join(raiz, "scripts", "lib"), join(dir, "scripts", "lib"), { recursive: true });
  mkdirSync(join(dir, "data", ".cache", "ppt", "sets"), { recursive: true });
  for (const [nome, corpo] of Object.entries(cache)) {
    writeFileSync(join(dir, "data", ".cache", "ppt", nome), JSON.stringify(corpo), "utf8");
  }
  if (artefato) {
    writeFileSync(join(dir, "data", "ppt-prices.generated.json"), artefato.precos, "utf8");
    writeFileSync(join(dir, "data", "ppt-newcards.generated.json"), artefato.novas, "utf8");
  }
  writeFileSync(join(dir, "fetch-falso.mjs"), FETCH_FALSO, "utf8");
  return dir;
}

// Roda o sync; devolve { ok, saida, chamadas, precos, novas }.
function roda(dir, args = []) {
  const argv = ["--import", pathToFileURL(join(dir, "fetch-falso.mjs")).href, join(dir, "scripts", "sync-ppt.mjs"), "--budget", "8000", "--graded", ...args];
  const p = spawnSync(process.execPath, argv, { cwd: dir, encoding: "utf8", env: { ...process.env, PPT_API_TOKEN: "falso" } });
  const saida = `${p.stdout || ""}${p.stderr || ""}`;
  const m = saida.match(/CHAMADAS_PPT=([0-9]+)/);
  const ler = (f) => { const c = join(dir, "data", f); return existsSync(c) ? readFileSync(c, "utf8") : null; };
  return { ok: p.status === 0, saida, chamadas: m ? Number(m[1]) : null, precos: ler("ppt-prices.generated.json"), novas: ler("ppt-newcards.generated.json") };
}

// Carta sintetizada mínima (o que o cache por set guarda em newCards).
const nova = (id) => ({ id, name: id, number: "1", setId: id.split("-")[0], language: "ja", image: "x", _new: true });

// Cache de set VENCIDO (t: 0): sem a cota, é o que existe — e tem de ir pro artefato.
const CACHE_COMPLETO = {
  "sets.json": { v: 4, t: 0, m: [["SV4A", 111]] },
  "sets/SV4a.json": { t: 0, entries: { "SV4a-1-ja": { u: 1.5 } }, newCards: [nova("SV4a-999-ja")] },
  "sets/enfill-swsh9.json": { t: 0, entries: { "swsh9-TG08": { u: 3.95 } }, newCards: [] },
  "sets/en-base1.json": { t: 0, entries: { "base1-4": { g: { 10: { s: 14800 } } } } },
  "sets/jpimport-M5.json": { t: 0, newCards: [nova("M5-1-ja")] },
  "sets/curado-amew-1.json": { t: 0, entry: { u: 527.22 }, card: { id: "amew-1", name: "Ancient Mew", setId: "amew", _new: true } }
};

test("cota do dia esgotada: sai com sucesso, sem repetir o 429, e monta o artefato do cache", () => {
  const dir = montaRaiz({ cache: CACHE_COMPLETO });
  const r = roda(dir);
  assert.equal(r.ok, true, `o sync devia sair com 0:\n${r.saida}`);
  const precos = JSON.parse(r.precos);
  assert.deepEqual(precos["SV4a-1-ja"], { u: 1.5 }, "set JP do cache");
  assert.deepEqual(precos["swsh9-TG08"], { u: 3.95 }, "fill EN do cache");
  assert.ok(precos["base1-4"] && precos["base1-4"].g, "graded EN do cache");
  assert.deepEqual(precos["amew-1"], { u: 527.22 }, "curada do cache (antes sumia)");
  const ids = JSON.parse(r.novas).map((c) => c.id).sort();
  assert.deepEqual(ids, ["M5-1-ja", "SV4a-999-ja", "amew-1"]);
  assert.match(r.saida, /::warning::PPT: cota da PPT esgotada/);
  // Uma chamada só no run inteiro: o /sets que levou o 429. Repetir o diário
  // custava 3×8s por chamada, até o teto de tempo do run.
  assert.equal(r.chamadas, 1, r.saida);
});

test("sem mapa de sets (nem cache dele) e cota esgotada: os sets JP saem do cache mesmo assim", () => {
  const { "sets.json": _semMapa, ...semMapa } = CACHE_COMPLETO;
  const dir = montaRaiz({ cache: semMapa });
  const r = roda(dir);
  assert.equal(r.ok, true, r.saida);
  // Antes o set sem pptId dava "sem equivalente na PPT" e o cache era ignorado.
  assert.deepEqual(JSON.parse(r.precos)["SV4a-1-ja"], { u: 1.5 });
  assert.ok(JSON.parse(r.novas).some((c) => c.id === "SV4a-999-ja"));
});

test("--so-cache com o artefato já no disco: não chama a PPT e não mexe nele", () => {
  const artefato = { precos: '{"sentinela":{"u":1}}', novas: "[]" };
  const dir = montaRaiz({ cache: CACHE_COMPLETO, artefato });
  const r = roda(dir, ["--so-cache"]);
  assert.equal(r.ok, true, r.saida);
  assert.equal(r.chamadas, 0, r.saida);
  assert.equal(r.precos, artefato.precos);
  assert.equal(r.novas, artefato.novas);
  assert.doesNotMatch(r.saida, /::warning::/);
});

test("--so-cache sem artefato: remonta do cache sem chamar a PPT e sem aviso", () => {
  const dir = montaRaiz({ cache: CACHE_COMPLETO });
  const r = roda(dir, ["--so-cache"]);
  assert.equal(r.ok, true, r.saida);
  assert.equal(r.chamadas, 0, r.saida);
  assert.deepEqual(JSON.parse(r.precos)["SV4a-1-ja"], { u: 1.5 });
  assert.ok(JSON.parse(r.novas).some((c) => c.id === "amew-1"));
  assert.doesNotMatch(r.saida, /::warning::/);
});

test("cota esgotada e cache vazio: o artefato que veio do build não vira um vazio", () => {
  const artefato = { precos: '{"sentinela":{"u":1}}', novas: '[{"id":"x"}]' };
  const dir = montaRaiz({ artefato });
  const r = roda(dir);
  assert.equal(r.ok, true, r.saida);
  assert.equal(r.precos, artefato.precos);
  assert.equal(r.novas, artefato.novas);
});
