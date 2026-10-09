// Nada no caminho que segura a tela fica esperando pra sempre (2026-10-08).
// Um <script> de catálogo ou um chunk cuja conexão pendura (nem resposta, nem
// erro) deixava a grade em esqueleto com "Carregando" indefinidamente — sem
// erro, sem "Tentar de novo", e sem o cartão de emergência, porque o app já
// tinha subido.
// 1. O catalogReady do game.js tem teto de 30 s: resolve assim mesmo e marca
//    window.SLEEVU.catalogoAtrasado.
// 2. Sem o manifest depois do teto, o awaitCatalog do shared.js vira erro —
//    quem chamou mostra o erro com saída, e não "nenhuma carta".
// 3. Os chunks têm prazo (AbortSignal.timeout) e a 2ª tentativa espera 1,5 s.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { loadShared } from "./lib/shared-sandbox.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const GAME = readFileSync(join(raiz, "src/game.js"), "utf8");

// game.js como no <head> do detail.html, com o manifest que nunca responde.
function gameComScriptPendurado() {
  const timers = [];
  const attrs = new Map();
  const el = () => ({ setAttribute() {}, getAttribute: () => null, appendChild: (x) => x, style: {}, dataset: {} });
  const document = {
    currentScript: { getAttribute: (n) => (n === "data-catalog" ? "cards" : null) },
    documentElement: { setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null), hasAttribute: (k) => attrs.has(k), removeAttribute: (k) => attrs.delete(k), classList: { add() {}, remove() {} }, style: {}, dataset: {} },
    head: { appendChild: (s) => s }, // o onload do <script> nunca vem
    createElement: () => el(), querySelector: () => null, addEventListener() {}, cookie: ""
  };
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const sandbox = {
    document, localStorage: storage, sessionStorage: storage,
    location: { pathname: "/games/pokemon/base-set", search: "", hash: "", origin: "https://sleevu.app", href: "https://sleevu.app/games/pokemon/base-set", replace() {} },
    history: { state: null, replaceState() {} },
    navigator: { language: "pt-BR", languages: ["pt-BR"] },
    fetch: () => new Promise(() => {}),
    URLSearchParams, URL, matchMedia: () => ({ matches: false }), addEventListener() {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(GAME.replace("var MANIFEST = false", "var MANIFEST = true"), sandbox);
  return { SLEEVU: sandbox.SLEEVU, timers };
}

test("catalogReady com script pendurado resolve no teto de 30 s e marca o atraso", async () => {
  const { SLEEVU, timers } = gameComScriptPendurado();
  assert.equal(SLEEVU.catalogoAtrasado, false);
  const teto = timers.find((x) => x.ms === 30000);
  assert.ok(teto, "sem o teto, a tela espera pra sempre");
  let resolveu = false;
  SLEEVU.catalogReady.then(() => { resolveu = true; });
  await Promise.resolve();
  assert.equal(resolveu, false, "antes do teto, segue esperando");
  teto.fn();
  await Promise.resolve();
  assert.equal(resolveu, true);
  assert.equal(SLEEVU.catalogoAtrasado, true);
});

test("sem o manifest depois do teto, o catálogo vira erro (com saída), não \"nenhuma carta\"", async () => {
  const sandbox = loadShared("window.__t = { loadCatalog };");
  sandbox.SLEEVU = { catalogReady: Promise.resolve(), catalogoAtrasado: true, manifest: true, game: "pokemon" };
  await assert.rejects(sandbox.__t.loadCatalog(), /catálogo não chegou/);
  // Com o manifest (ele chegou, quem atrasou foi outro arquivo), segue normal.
  sandbox.TCG_MANIFEST = { sets: [] };
  const r = await sandbox.__t.loadCatalog();
  assert.equal(r.cards.length, 0); // array de outro realm (vm): compara pelo tamanho
});

test("chunks: prazo em cada pedido e espera antes da 2ª tentativa", () => {
  const shared = readFileSync(join(raiz, "src/shared.js"), "utf8");
  const i = shared.indexOf("async function fetchSetChunks(");
  const corpo = shared.slice(i, shared.indexOf("\n  }\n", i));
  assert.ok(corpo.includes("AbortSignal.timeout(45000)"));
  assert.ok(corpo.includes("const r = await fetch(url, prazo());"));
  assert.ok(corpo.includes('fetch(entry.file.replace("/sets/", "/pricing-chunks/"), prazo())'));
  assert.ok(/catch \(e\) \{\s*await new Promise\(\(res\) => setTimeout\(res, 1500\)\);\s*try \{ dados = await baixa\(entry\.file\); \}/.test(corpo));
});
