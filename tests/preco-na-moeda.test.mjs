// Preço na moeda de quem lê (decisão D2 do plano de revisão de novembro/2026,
// pacote 4B). Em real o MYP (preço brasileiro) segue vencendo; em dólar e euro
// vale o mercado internacional (USD do TCGplayer, depois EUR do Cardmarket) e o
// MYP convertido fica de reserva. Quem lê em dólar via um número que não era o
// do mercado americano e não batia com o texto da página da carta, que a borda
// escreve com o dólar do TCGplayer.
//
// O que se trava aqui:
//   · cardValue nas três moedas, pra cada formato de entrada de preço;
//   · o valor do set no manifest (setValueBuckets, e o `vx` que ele grava) igual
//     à soma do cardValue das cartas, nas três moedas — a conta que o
//     src/app.js#entryRefValue faz com o manifest;
//   · o manifest velho (sem `vx`) segue valendo a soma de antes;
//   · o enrich-manifest, que roda em todo build e não pode deixar `vx` velho.
// Roda com: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setValueBuckets, setManifestMeta } from "../scripts/lib/sync-common.mjs";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

const EXPOSE = "window.__test = { cardValue, sumCardsValue, convertMoney, createPriceStore, pricingRefFor };";
// Câmbio em BRL por unidade (o formato do cache do shared.js), com carimbo de agora.
const FX = { USD: 5, EUR: 6 };

function monta(moeda, pricing) {
  const ls = makeLocalStorage({
    "tcg-collector-currency-v1": moeda,
    "tcg-fx-brl-v1": JSON.stringify({ r: FX, t: Date.now() })
  });
  const sb = loadShared(EXPOSE, { localStorage: ls });
  sb.window.TCG_PRICING = pricing;
  const api = sb.window.__test;
  return { api, prices: api.createPriceStore() };
}

const carta = (id, extra) => Object.assign({ id, set: "Set X", setId: "sx", variants: ["Normal"], game: "pokemon" }, extra);

// Cada linha é um formato de entrada; o esperado está na moeda DE ORIGEM da
// fonte que deve vencer em cada moeda de leitura (BRL, USD, EUR).
const PRECOS = {
  "x-1": { b: { md: 60 }, u: 10, e: 8 },     // MYP e USD (e EUR)
  "x-2": { b: { md: 30 } },                  // só MYP
  "x-3": { u: 4 },                           // só USD
  "x-4": { e: 3 },                           // só EUR
  "x-5": { u: 8 },                           // base da localizada
  "x-5-pt": { b: { md: 12 } },               // localizada só com MYP: a base USD vence em dólar/euro
  "x-6": { b: { md: 50 }, e: 7 },            // MYP e EUR, sem USD
  "x-7": { v: { Normal: 2, Reverse: 90 }, u: 2, b: { md: 20 } }, // impressão: Reverse tem cotação própria
  "x-9": { u: 0, e: 0 }                      // entrada sem preço nenhum
};
const CARTAS = [
  carta("x-1"), carta("x-2"), carta("x-3"), carta("x-4"), carta("x-5-pt"), carta("x-6"),
  carta("x-7", { variants: ["Reverse"] }), carta("x-8"), carta("x-9")
];

// Valor em cada moeda, por carta, conferido na mão (câmbio USD=5, EUR=6):
const ESPERADO = {
  BRL: { "x-1": 60, "x-2": 30, "x-3": 20, "x-4": 18, "x-5-pt": 12, "x-6": 50, "x-7": 20, "x-8": 0, "x-9": 0 },
  USD: { "x-1": 10, "x-2": 6, "x-3": 4, "x-4": 3.6, "x-5-pt": 8, "x-6": 8.4, "x-7": 90, "x-8": 0, "x-9": 0 },
  EUR: { "x-1": 10 * 5 / 6, "x-2": 5, "x-3": 4 * 5 / 6, "x-4": 3, "x-5-pt": 8 * 5 / 6, "x-6": 7, "x-7": 90 * 5 / 6, "x-8": 0, "x-9": 0 }
};
const perto = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);

for (const moeda of ["BRL", "USD", "EUR"]) {
  test(`cardValue em ${moeda}: cada formato de preço cai na fonte certa`, () => {
    const { api, prices } = monta(moeda, PRECOS);
    for (const card of CARTAS) {
      const v = api.cardValue(card, card.variants[0], prices, "NM");
      perto(v.value, ESPERADO[moeda][card.id], `${moeda} ${card.id}`);
      assert.equal(v.currency, moeda);
    }
  });
}

test("cardValue: a fonte (source) acompanha a régua — em dólar o MYP só aparece quando é a única", () => {
  const usd = monta("USD", PRECOS);
  const fonte = (api, prices, id) => api.cardValue(CARTAS.find((c) => c.id === id), "Normal", prices, "NM").source;
  assert.equal(fonte(usd.api, usd.prices, "x-1"), "ref");   // USD vence o MYP
  assert.equal(fonte(usd.api, usd.prices, "x-2"), "myp");   // só MYP: reserva
  assert.equal(fonte(usd.api, usd.prices, "x-6"), "ref");   // EUR vence o MYP
  const brl = monta("BRL", PRECOS);
  assert.equal(fonte(brl.api, brl.prices, "x-1"), "myp");   // real: o MYP vence, como sempre
  assert.equal(fonte(brl.api, brl.prices, "x-3"), "ref");
});

test("cardValue: preço manual segue vencendo em qualquer moeda", () => {
  for (const moeda of ["BRL", "USD", "EUR"]) {
    const { api, prices } = monta(moeda, PRECOS);
    prices.setPrice("x-1", "Normal", "NM", 100, "auto"); // R$ 100 digitado à mão ("auto" não vai pra Comunidade)
    const v = api.cardValue(CARTAS[0], "Normal", prices, "NM");
    assert.equal(v.source, "manual");
    perto(v.value, moeda === "BRL" ? 100 : (moeda === "USD" ? 20 : 100 / 6), moeda);
  }
});

test("condição pior desconta igual nas duas ordens (HP = metade)", () => {
  for (const moeda of ["BRL", "USD"]) {
    const { api, prices } = monta(moeda, PRECOS);
    const nm = api.cardValue(CARTAS[0], "Normal", prices, "NM").value;
    perto(api.cardValue(CARTAS[0], "Normal", prices, "HP").value, nm * 0.5, moeda);
  }
});

// ── Valor do set: manifest × soma do cardValue ─────────────────────────────
// A mesma conta do src/app.js#entryRefValue: `vx` fora do real, e vb/vu/ve de
// sempre no real ou quando o manifest não tem `vx`.
function valorDoManifest(api, entry, moeda) {
  const src = (moeda !== "BRL" && entry.vx) || entry;
  let total = 0;
  [["vb", "BRL"], ["vu", "USD"], ["ve", "EUR"]].forEach(([campo, de]) => {
    if (!src[campo]) return;
    const v = api.convertMoney(src[campo], de, moeda);
    if (v != null) total += v;
  });
  return total;
}

for (const moeda of ["BRL", "USD", "EUR"]) {
  test(`valor do set em ${moeda}: o manifest soma o mesmo que o cardValue das cartas`, () => {
    const { api, prices } = monta(moeda, PRECOS);
    const entry = setManifestMeta(CARTAS, PRECOS);
    const soma = api.sumCardsValue(CARTAS, prices).value;
    // O manifest arredonda cada soma a 2 casas: tolerância de 1 centavo.
    assert.ok(Math.abs(valorDoManifest(api, entry, moeda) - soma) < 0.01, `${moeda}: manifest ${valorDoManifest(api, entry, moeda)} x cartas ${soma}`);
  });
}

test("setValueBuckets: a régua do real é a de sempre e a de dólar/euro vai em vx", () => {
  const b = setValueBuckets(CARTAS, PRECOS);
  // Real: MYP primeiro. x-1 60 + x-2 30 + x-6 50 + x-7 20 + x-5-pt 12 = 172 em vb;
  // x-3 USD 4, x-4 EUR 3.
  assert.deepEqual({ vb: b.vb, vu: b.vu, ve: b.ve, vn: b.vn }, { vb: 172, vu: 4, ve: 3, vn: 2 });
  // Dólar/euro: USD primeiro. vu = x-1 10 + x-3 4 + x-5 8 + x-7 90 = 112;
  // ve = x-4 3 + x-6 7 = 10; vb = só o x-2 (30).
  assert.deepEqual(b.vx, { vb: 30, vu: 112, ve: 10 });
});

test("setValueBuckets: set sem preço MYP não ganha vx (as duas réguas dão o mesmo número)", () => {
  const sem = { "y-1": { u: 5, e: 4 }, "y-2": { u: 2 }, "y-3": { e: 1 } };
  const b = setValueBuckets([carta("y-1"), carta("y-2"), carta("y-3")], sem);
  assert.equal(b.vx, undefined);
  assert.deepEqual(b, { vu: 7, ve: 1 });
});

test("setValueBuckets: set com MYP que não muda a escolha também não ganha vx", () => {
  // Só MYP: nas duas réguas a soma cai no mesmo bucket (vb).
  const b = setValueBuckets([carta("y-1")], { "y-1": { b: { md: 9 } } });
  assert.equal(b.vx, undefined);
  assert.deepEqual(b, { vb: 9 });
});

test("manifest velho (sem vx): em dólar cai na soma de antes, sem quebrar", () => {
  const { api } = monta("USD", PRECOS);
  const novo = setManifestMeta(CARTAS, PRECOS);
  const velho = { ...novo };
  delete velho.vx;
  assert.ok(valorDoManifest(api, velho, "USD") !== valorDoManifest(api, novo, "USD"), "o caso de teste precisa diferir");
  // A soma do velho é a de antes: vb 172 (R$), vu 4, ve 3, convertidas.
  perto(valorDoManifest(api, velho, "USD"), 172 / 5 + 4 + 3 * 6 / 5, "soma antiga em dólar");
  // Em real o vx é ignorado: novo e velho dão o mesmo número.
  perto(valorDoManifest(api, velho, "BRL"), valorDoManifest(api, novo, "BRL"), "real não muda");
});

test("o app.js escolhe a soma pela moeda e cai em vb/vu/ve sem vx", () => {
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(app, /const src = \(cur !== "BRL" && entry\.vx\) \|\| entry;/);
  assert.match(app, /if \(!src\[field\]\) return;/);
});

// ── enrich-manifest: roda em todo build (rápido e completo) ─────────────────
test("enrich-manifest regrava o valor do zero: vx velho não sobra num set que deixou de diferir", () => {
  const raiz = fileURLToPath(new URL("../", import.meta.url));
  const tmp = mkdtempSync(join(tmpdir(), "enrich-vx-"));
  try {
    // Espelha só o que o script importa; RAIZ dele é a pasta acima de scripts/.
    cpSync(join(raiz, "scripts", "lib"), join(tmp, "scripts", "lib"), { recursive: true });
    cpSync(join(raiz, "scripts", "enrich-manifest.mjs"), join(tmp, "scripts", "enrich-manifest.mjs"));
    cpSync(join(raiz, "functions", "_lib"), join(tmp, "functions", "_lib"), { recursive: true });
    mkdirSync(join(tmp, "data", "sets"), { recursive: true });
    const cartas = [carta("z-1"), carta("z-2")];
    writeFileSync(join(tmp, "data", "sets", "sx.json"), JSON.stringify(cartas));
    // Preço sem MYP: as duas réguas dão o mesmo número, então NÃO pode haver vx.
    writeFileSync(join(tmp, "data", "pricing.generated.js"), `window.TCG_PRICING = ${JSON.stringify({ "z-1": { u: 5 }, "z-2": { e: 2 } })};\n`);
    // Manifest do "cache do build anterior": vx e vb de um tempo em que o set tinha MYP.
    const velho = { sets: [{ id: "sx", name: "Set X", count: 2, language: "en", file: "data/sets/sx.json", vb: 99, vx: { vu: 1 } }] };
    writeFileSync(join(tmp, "data", "manifest.generated.js"), `window.TCG_MANIFEST = ${JSON.stringify(velho)};\n`);
    execFileSync(process.execPath, [join(tmp, "scripts", "enrich-manifest.mjs")], { cwd: tmp, stdio: "pipe" });
    const txt = readFileSync(join(tmp, "data", "manifest.generated.js"), "utf8");
    const m = JSON.parse(txt.slice(txt.indexOf("=") + 1).trim().replace(/;\s*$/, ""));
    const e = m.sets[0];
    assert.equal(e.vx, undefined, "vx velho foi mantido");
    assert.equal(e.vb, undefined, "vb velho foi mantido");
    assert.equal(e.vu, 5);
    assert.equal(e.ve, 2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
