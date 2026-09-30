// O Ordenar de toda grade de cartas (src/ordenar.js, 2026-09-30). Eram onze
// cópias da lista de opções e do comparador, que já tinham divergido; agora é
// um bloco só, e este teste é o que segura as regras que as cópias perdiam:
// "sem preço vai pro fim nos DOIS sentidos", a chave antiga gravada no
// localStorage continuar valendo, a variação chegar depois e repintar UMA vez.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const ler = (rel) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");

function load({ deltas = {}, views = [] } = {}) {
  const pedidos = { pct: 0, views: 0 };
  const sandbox = {
    console, setTimeout,
    document: { addEventListener() {}, querySelectorAll: () => [] },
    addEventListener() {}
  };
  sandbox.window = sandbox;
  sandbox.window.TCGShared = {
    t: (k) => k,
    escapeHtml: String,
    escapeAttribute: String,
    getLocale: () => "pt-BR",
    normalizeGame: (g) => g,
    basePricingId: (id) => String(id).replace(/-(pt|ja)$/, ""),
    compareCardNumbers: (a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0),
    rarityRank: (r) => ({ c: 10, uc: 20, r: 30 })[r] || 0,
    memoValue: (f) => { const m = new Map(); return (x) => { if (!m.has(x)) m.set(x, f(x)); return m.get(x); }; },
    loadPriceDeltas7d: () => { pedidos.pct++; return Promise.resolve({ c: deltas }); },
    fetchTopViewed: () => { pedidos.views++; return Promise.resolve(views); }
  };
  vm.createContext(sandbox);
  vm.runInContext(ler("src/ordenar.js"), sandbox);
  return { O: sandbox.window.TCGOrdenar, pedidos };
}
const { O } = load();
// Lista do outro realm do vm -> Array daqui (deepEqual compara protótipo).
const ids = (arr) => Array.from(arr, (x) => (x.card || x).id);
const carta = (id, extra) => ({ id, name: id, number: "1", game: "pokemon", ...extra });

test("famílias viram as chaves na ordem do menu (a do Collectr)", () => {
  assert.deepEqual(Array.from(O.chaves("name value num")), ["value-asc", "value-desc", "num-asc", "num-desc", "name-asc", "name-desc"]);
  assert.deepEqual(Array.from(O.chaves("relevance value")), ["relevance", "value-asc", "value-desc"]);
});

test("valor gravado antes da unificação continua valendo; o resto cai no padrão", () => {
  assert.equal(O.valida("release", "value release"), "release-desc");
  assert.equal(O.valida("valor-asc", "value"), "value-asc");       // pastas
  assert.equal(O.valida("added", "value added"), "added-asc");      // pastas
  assert.equal(O.valida("grade-desc", "value num"), "value-desc");  // família que a tela não oferece
  assert.equal(O.valida(null, "value"), "value-desc");
  assert.equal(O.valida(null, "relevance value", "relevance"), "relevance");
  assert.equal(O.PADRAO, "value-desc");
});

test("rótulo é \"Critério: sentido\" (o menu pinta as duas metades)", () => {
  assert.equal(O.rotulo("value-desc"), "sort.k.price: sort.d.down");
  assert.equal(O.rotulo("release"), "sort.k.release: sort.d.newest");
  assert.equal(O.rotulo("relevance"), "sort.relevance");
  const html = O.opcoes("value", "value-asc");
  assert.match(html, /<option value="value-asc" selected>/);
  assert.doesNotMatch(html, /value="value-desc" selected/);
});

test("preço: sem preço vai pro fim nos DOIS sentidos", () => {
  const itens = [carta("a"), carta("zero"), carta("b")];
  const preco = { a: 10, zero: 0, b: 30 };
  const o = { carta: (x) => x, preco: (x) => preco[x.id] };
  assert.deepEqual(ids(itens.slice().sort(O.compara("value-desc", o))), ["b", "a", "zero"]);
  assert.deepEqual(ids(itens.slice().sort(O.compara("value-asc", o))), ["a", "b", "zero"]);
});

test("empate desfaz por número e depois nome — nas duas direções de nome", () => {
  const itens = [carta("b", { number: "2" }), carta("a", { number: "2" }), carta("c", { number: "1" })];
  assert.deepEqual(ids(itens.slice().sort(O.compara("value-desc"))), ["c", "a", "b"]);
  assert.deepEqual(ids(itens.slice().sort(O.compara("name-desc"))), ["c", "b", "a"]);
  assert.deepEqual(ids(itens.slice().sort(O.compara("num-desc"))), ["a", "b", "c"]);
});

test("lançamento: sem data vai pro fim; mesmo dia sai em bloco por set", () => {
  const itens = [
    carta("semData"),
    carta("x2", { set: "X", number: "2", setReleaseDate: "2020-01-01" }),
    carta("y1", { set: "Y", number: "1", setReleaseDate: "2020-01-01" }),
    carta("x1", { set: "X", number: "1", setReleaseDate: "2020-01-01" }),
    carta("novo", { setReleaseDate: "2024-05-01" })
  ];
  assert.deepEqual(ids(itens.slice().sort(O.compara("release-desc"))), ["novo", "x1", "x2", "y1", "semData"]);
  assert.deepEqual(ids(itens.slice().sort(O.compara("release-asc"))), ["x1", "x2", "y1", "novo", "semData"]);
});

test("data de adição e nota: o desconhecido vai pro fim nos dois sentidos", () => {
  const itens = [carta("velha"), carta("fora"), carta("nova")];
  const pos = { velha: 0, nova: 5 };
  const o = { adicao: (x) => pos[x.id] };
  assert.deepEqual(ids(itens.slice().sort(O.compara("added-asc", o))), ["velha", "nova", "fora"]);
  assert.deepEqual(ids(itens.slice().sort(O.compara("added-desc", o))), ["nova", "velha", "fora"]);
  const nota = { velha: 9, nova: 10 };
  const g = { nota: (x) => nota[x.id] || 0 };
  assert.deepEqual(ids(itens.slice().sort(O.compara("grade-desc", g))), ["nova", "velha", "fora"]);
  assert.deepEqual(ids(itens.slice().sort(O.compara("grade-asc", g))), ["velha", "nova", "fora"]);
});

test("variação: chega depois, repinta UMA vez, e R$ ≠ %", async () => {
  // barata: R$ 4 hoje, +100% (era R$ 2 -> +R$ 2). cara: R$ 900, +10% (+R$ 82).
  // caiu: -20%. semDado: fora do arquivo (conta 0). pt: acha pelo id base.
  const { O: O2, pedidos } = load({ deltas: { barata: 100, cara: 10, caiu: -20, base: 50 } });
  const itens = [carta("barata"), carta("cara"), carta("caiu"), carta("semDado"), carta("base-pt")];
  const preco = { barata: 4, cara: 900, caiu: 50, semDado: 7, "base-pt": 3 };
  let repintou = 0;
  const o = { preco: (x) => preco[x.id], depois: () => { repintou++; } };
  // 1ª passada: o arquivo ainda não chegou — tudo conta 0 e nada quebra.
  itens.slice().sort(O2.compara("pct-desc", o));
  itens.slice().sort(O2.compara("pct-desc", o)); // outra lista no mesmo render
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(repintou, 1, "uma leva de pedidos = um repinte");
  assert.equal(pedidos.pct, 1, "um pedido por jogo, com cache");
  assert.deepEqual(ids(itens.slice().sort(O2.compara("pct-desc", o))), ["barata", "base-pt", "cara", "semDado", "caiu"]);
  assert.deepEqual(ids(itens.slice().sort(O2.compara("change-desc", o))), ["cara", "barata", "base-pt", "semDado", "caiu"]);
  assert.deepEqual(ids(itens.slice().sort(O2.compara("change-asc", o))), ["caiu", "semDado", "base-pt", "barata", "cara"]);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(repintou, 1, "com o dado no cache não repinta de novo (nada de laço)");
  // Slab: a variação é do mercado da carta crua — não vale pra ele.
  const slab = { ...o, mercado: (x) => x.id !== "barata" };
  assert.equal(ids(itens.slice().sort(O2.compara("pct-desc", slab)))[0], "base-pt");
});

test("popularidade: o contador público, sem view conta 0", async () => {
  const { O: O2 } = load({ views: [{ card_id: "b", views: 40 }, { card_id: "a", views: 3 }] });
  const itens = [carta("a"), carta("c"), carta("b")];
  itens.slice().sort(O2.compara("views-desc", { depois() {} }));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(ids(itens.slice().sort(O2.compara("views-desc"))), ["b", "a", "c"]);
  assert.deepEqual(ids(itens.slice().sort(O2.compara("views-asc"))), ["c", "a", "b"]);
});

test("toda chave de rótulo do Ordenar existe em pt, en e es", () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(ler("src/i18n.js"), sandbox);
  const M = sandbox.window.TCG_MESSAGES;
  const chaves = new Set(ler("src/ordenar.js").match(/"sort\.[\w.]+"/g).map((s) => s.slice(1, -1)));
  assert.ok(chaves.size >= 15);
  for (const lang of ["pt", "en", "es"]) {
    for (const k of chaves) assert.ok(M[lang][k], `${lang}: falta "${k}"`);
    // O menu parte o rótulo no ": " — nenhuma metade pode trazer outro.
    for (const k of chaves) assert.ok(!M[lang][k].includes(": "), `${lang}: "${k}" tem ": "`);
  }
});

test("toda página que usa o Ordenar carrega o src/ordenar.js ANTES do script dela", () => {
  const usam = readdirSync(join(root, "src")).filter((f) => f.endsWith(".js") && f !== "ordenar.js" && ler(`src/${f}`).includes("TCGOrdenar"));
  assert.ok(usam.length >= 9, `só ${usam.length} scripts usam o TCGOrdenar`);
  const paginas = readdirSync(root).filter((f) => f.endsWith(".html"));
  for (const f of paginas) {
    const html = ler(f);
    const tag = html.indexOf('src="src/ordenar.js"');
    if (html.includes("data-ordenar")) assert.ok(tag >= 0, `${f} tem data-ordenar e não carrega o ordenar.js`);
    for (const js of usam) {
      const i = html.indexOf(`src="src/${js}"`);
      if (i < 0) continue;
      assert.ok(tag >= 0 && tag < i, `${f}: src/ordenar.js precisa vir antes de src/${js}`);
    }
  }
});
