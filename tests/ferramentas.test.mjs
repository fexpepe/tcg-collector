// As duas ferramentas do HUB em página própria (docs/FERRAMENTAS.md): o Guia
// de condição (src/condicao.js) e Sleeves e fichários (src/sleeves.js). O que
// se testa é a CONTA, que é o produto: a condição que a pessoa vai mandar
// numa negociação e o número de folhas/sleeves que ela vai comprar. Errar aqui
// não quebra tela nenhuma — só entrega um número errado com cara de certo.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const ler = (rel) => readFileSync(join(here, "..", rel), "utf8").replace(/\r\n/g, "\n");

// Os textos de verdade (pt), com o mesmo {placeholder} do t() do shared.js.
function mensagens() {
  const sandbox = { window: {} };
  vm.runInNewContext(ler("src/i18n-ferramentas.js"), sandbox);
  return sandbox.window.TCG_MESSAGES;
}
const MSG = mensagens();

function carrega(arquivo, nome) {
  const t = (k, vars) => {
    let s = MSG.pt[k] != null ? MSG.pt[k] : k;
    Object.entries(vars || {}).forEach(([n, v]) => { s = s.split(`{${n}}`).join(v); });
    return s;
  };
  const sandbox = { console, document: { getElementById: () => null } };
  sandbox.window = sandbox;
  sandbox.window.TCGShared = {
    t, tn: (k, n, vars) => t(`${k}.${n === 1 ? "one" : "other"}`, Object.assign({ n }, vars)),
    escapeHtml: String, escapeAttribute: String, getLocale: () => "pt-BR", getCurrency: () => "BRL"
  };
  vm.createContext(sandbox);
  vm.runInContext(ler(arquivo), sandbox);
  return sandbox.window[nome];
}
const C = carrega("src/condicao.js", "TCGCondicao");
const S = carrega("src/sleeves.js", "TCGSleeves");
// O módulo roda em outro realm do vm: objetos dele não passam no deepEqual
// deste realm por causa do protótipo. Copiar resolve.
const copia = (x) => JSON.parse(JSON.stringify(x));

// ── Guia de condição ────────────────────────────────────────────────────────

test("vale o PIOR critério", () => {
  assert.equal(C.resultado({ danos: "M", cantos: "NM", bordas: "M", verso: "SP", superficie: "NM" }), "SP");
  assert.equal(C.resultado({ danos: "MP", cantos: "M", bordas: "M", verso: "M", superficie: "M" }), "MP");
  assert.equal(C.resultado({ danos: "M", cantos: "M", bordas: "M", verso: "M", superficie: "HP" }), "HP");
});

test("Mint só com tudo Mint; um detalhe mínimo já é NM", () => {
  const tudoM = { danos: "M", cantos: "M", bordas: "M", verso: "M", superficie: "M" };
  assert.equal(C.resultado(tudoM), "M");
  assert.equal(C.resultado({ ...tudoM, cantos: "NM" }), "NM");
});

test("dano que já decide (D) pula o resto das perguntas", () => {
  assert.equal(C.resultado({ danos: "D" }), "D");
  assert.equal(C.proximo({ danos: "D" }), C.CRITERIOS.length);
});

test("a próxima pergunta é a primeira sem resposta", () => {
  assert.equal(C.proximo({}), 0);
  assert.equal(C.proximo({ danos: "M" }), 1);
  // Voltou pra mudar o verso: a seguinte já respondida não é perguntada de novo.
  assert.equal(C.proximo({ danos: "M", cantos: "M", bordas: "M", superficie: "NM" }), 3);
  assert.equal(C.proximo({ danos: "M", cantos: "M", bordas: "M", verso: "M", superficie: "M" }), C.CRITERIOS.length);
});

test("critério sem resposta não entra na conta", () => {
  assert.equal(C.resultado({}), null);
  assert.equal(C.resultado({ cantos: "SP" }), "SP");
});

test("a escala é a do CARD_CONDITIONS do shared.js", () => {
  const m = ler("src/shared.js").match(/const CARD_CONDITIONS = (\[[^\]]*\]);/);
  assert.ok(m, "sumiu o CARD_CONDITIONS do shared.js");
  assert.deepEqual(copia(C.NIVEIS), JSON.parse(m[1]));
});

test("o desconto por condição é o mesmo da cotação do site (CONDITION_MULTIPLIERS)", () => {
  // O guia guarda uma cópia (o shared.js não exporta). Se a cotação mudar o
  // desconto, o "SP vale cerca de 85% do NM" do guia passaria a mentir.
  const m = ler("src/shared.js").match(/const CONDITION_MULTIPLIERS = (\{[^}]*\});/);
  assert.ok(m, "sumiu o CONDITION_MULTIPLIERS do shared.js");
  assert.deepEqual(copia(C.MULT), copia(vm.runInNewContext(`(${m[1]})`)));
});

test("cada critério só oferece degraus da escala, e só os danos chegam no D", () => {
  C.CRITERIOS.forEach((c) => {
    c.niveis.forEach((n) => assert.ok(C.NIVEIS.includes(n), `${c.id}: ${n}`));
    assert.equal(c.niveis.includes("D"), c.id === "danos", c.id);
  });
});

test("texto pra negociação: sigla do TCGplayer e os critérios respondidos", () => {
  const txt = C.textoCopia({ danos: "M", cantos: "NM", bordas: "M", verso: "SP", superficie: "NM" }).split("\n");
  assert.equal(txt[0], "Condição: SP — Slightly Played (≈ LP no TCGplayer)");
  assert.equal(txt[1], "Cantos NM · Bordas M · Verso SP · Superfície NM · sem dano estrutural");
  const rasgada = C.textoCopia({ danos: "D" }).split("\n");
  assert.equal(rasgada[0], "Condição: D — Damaged (≈ DMG no TCGplayer)");
  assert.equal(rasgada[1], "dano estrutural D");
});

test("toda chave que o guia monta existe em pt, en e es", () => {
  const chaves = [];
  C.CRITERIOS.forEach((c) => {
    ["lb", "fig", "q", "look"].forEach((k) => chaves.push(`gc.${c.id}.${k}`));
    c.niveis.forEach((n) => chaves.push(`gc.${c.id}.${n}`, `gc.${c.id}.${n}.d`));
  });
  C.NIVEIS.forEach((n) => chaves.push(`gc.sub.${n}`, `gc.scale.${n}`));
  for (const lang of ["pt", "en", "es"]) {
    const faltam = chaves.filter((k) => typeof MSG[lang][k] !== "string" || !MSG[lang][k]);
    assert.deepEqual(faltam, [], `${lang} sem: ${faltam.join(", ")}`);
  }
});

test("o pacote de textos tem as mesmas chaves nos três idiomas", () => {
  const pt = Object.keys(MSG.pt).sort();
  assert.deepEqual(Object.keys(MSG.en).sort(), pt);
  assert.deepEqual(Object.keys(MSG.es).sort(), pt);
});

// ── Sleeves e fichários ─────────────────────────────────────────────────────

const base = { fich: 0, bolsos: 9, doisLados: true, folhasFich: 20, decks: 0, porDeck: 60, duplo: false };

test("folhas: 18 cartas por folha de 9 bolsos, frente e verso", () => {
  const c = S.conta({ ...base, fich: 1110 });
  assert.equal(c.cap, 18);
  assert.equal(c.folhas, 62); // 61 cheias = 1.098, sobram 12 pra 62ª
  assert.equal(c.resto, 12);
  assert.equal(c.fichs, 4); // 62 folhas / 20 por fichário
});

test("conta exata enche a última folha (resto = capacidade, não zero)", () => {
  const c = S.conta({ ...base, fich: 36 });
  assert.equal(c.folhas, 2);
  assert.equal(c.resto, 18);
});

test("só frente: a capacidade cai pela metade", () => {
  const c = S.conta({ ...base, fich: 10, doisLados: false });
  assert.equal(c.cap, 9);
  assert.equal(c.folhas, 2);
  assert.equal(c.resto, 1);
});

test("fichário vazio não pede folha nem fichário", () => {
  const c = S.conta({ ...base });
  assert.deepEqual([c.folhas, c.resto, c.fichs], [0, 0, 0]);
});

test("sleeves = decks × cartas; inner só no sleeve duplo", () => {
  assert.deepEqual([S.conta({ ...base, decks: 2, porDeck: 60 }).sleeves, S.conta({ ...base, decks: 2, porDeck: 60 }).inner], [120, 0]);
  assert.equal(S.conta({ ...base, decks: 2, porDeck: 60, duplo: true }).inner, 120);
});

test("pacotes cobrem a quantidade e dizem quanto sobra", () => {
  assert.deepEqual(copia(S.pacotes(120, 100)), { n: 2, sobra: 80 });
  assert.deepEqual(copia(S.pacotes(100, 100)), { n: 1, sobra: 0 });
  assert.deepEqual(copia(S.pacotes(174, 25)), { n: 7, sobra: 1 });
  assert.equal(S.pacotes(0, 100), null);
});

test("decks salvos: soma todas as zonas e ignora entrada torta", () => {
  const dados = { decks: [
    { zones: { main: [{ id: "a", qty: 4 }, { id: "b", qty: 56 }], side: [{ id: "c", qty: 15 }] } },
    { zones: { leader: [{ id: "L", qty: 1 }], main: [{ id: "d", qty: 50 }, null, { id: "e" }, { id: "f", qty: -3 }] } }
  ] };
  assert.deepEqual(copia(S.cartasDosDecks(dados)), { decks: 2, cartas: 126 });
  assert.deepEqual(copia(S.cartasDosDecks(null)), { decks: 0, cartas: 0 });
  assert.deepEqual(copia(S.cartasDosDecks({ decks: "x" })), { decks: 0, cartas: 0 });
});

test("toploader: conta as cópias que valem o limite ou mais", () => {
  const linhas = [[25, 2], [19.99, 5], [20, 1], [0.5, 40]];
  assert.equal(S.separaPorValor(linhas, 20), 3);
  assert.equal(S.separaPorValor(linhas, 0), 48);
  assert.equal(S.separaPorValor([], 20), 0);
});

test("medidas: a sleeve é maior que a inner, que é maior que a carta", () => {
  Object.values(S.TAM).forEach((tam) => {
    assert.ok(tam.inner[0] > tam.carta[0] && tam.inner[1] > tam.carta[1]);
    assert.ok(tam.sleeve[0] > tam.inner[0] && tam.sleeve[1] > tam.inner[1]);
  });
});

// ── Menu "Mais", portão e sitemap (2026-10-01, 2ª rodada) ───────────────────

test("o menu de topo FECHA com o Mais, depois da Coleção e do Portfólio", () => {
  const src = ler("src/shared.js");
  const m = src.match(/nav\.innerHTML = `([\s\S]*?)`;\n/);
  assert.ok(m, "sumiu o nav.innerHTML do initPageNav");
  const corpo = m[1];
  const ordem = ["nav.home", "exploreMega", "nav.decks", "collectionMega", "nav.portfolio", "moreMega"].map((k) => corpo.indexOf(k));
  ordem.forEach((i, n) => assert.ok(i >= 0, `item ${n} sumiu do menu`));
  assert.deepEqual([...ordem].sort((a, b) => a - b), ordem, "ordem do menu mudou");
  assert.ok(!/link\("blog"/.test(corpo), "o Blog saiu do meio do menu: mora no painel do Mais");
});

// Endereços em inglês desde 2026-10-01 (/tools, /condition, /centering): o
// AUTH_PAGES olha o data-active-page, que passou a ter esses nomes.
test("o Guia de condição e o Centering Tool são públicos; o Sleeves segue exigindo login", () => {
  const m = ler("src/shared.js").match(/const AUTH_PAGES = (\[[^\]]*\]);/);
  const auth = JSON.parse(m[1]);
  for (const p of ["condition", "tools", "centering", "condicao", "ferramentas"]) assert.ok(!auth.includes(p), p);
  assert.ok(auth.includes("sleeves"));
  assert.ok(!/noindex/.test(ler("condition.html")) && !/noindex/.test(ler("tools.html")));
  assert.ok(/noindex/.test(ler("sleeves.html")));
});

test("o sitemap anuncia as páginas públicas e só elas", () => {
  const src = ler("scripts/prerender-catalog.mjs");
  assert.ok(src.includes('"/tools", "/condition", "/centering"'));
  // Os antigos são 301: sitemap que anuncia redirect vira aviso no Search Console.
  assert.ok(!/"\/ferramentas"|"\/condicao"/.test(src), "endereço antigo (301) no sitemap");
  assert.ok(!/"\/sleeves"/.test(src), "o Sleeves exige login: anunciar no sitemap seria página fina");
});
