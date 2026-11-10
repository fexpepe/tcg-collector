// RECONHECIMENTO PELA ARTE no set travado (src/scan.js, 2026-11-10) — a fase 2
// do docs/PLANO-SCANNER.md no recorte que cabe no aparelho. Com o set
// travado, o scanner guarda a assinatura da miniatura de cada carta dele e
// compara a foto com o SET INTEIRO, sem ler código. É o caminho do jogo que
// imprime só o número (Dragon Ball Z, LOTR, Carddass, HxH) ou nem isso (WoW,
// Sorcery) — 17 mil cartas do catálogo que o leitor de código não alcança —
// e, quando a arte é inconfundível, dispensa o OCR.
//
// Como o jogo sem código não tem "primeira carta lida" pra travar por ela, o
// cadeado sem resultado abre um seletor de set.
//
// Aqui: a decisão (escolherPelaArte), o filtro do seletor (filtrarSets) e as
// amarras do fluxo. A taxa de acerto com foto simulada é medida na bancada,
// fora do CI.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const raiz = join(here, "..");
const scanSrc = readFileSync(join(raiz, "src", "scan.js"), "utf8");
function load() {
  const sandbox = {
    console,
    document: { querySelector: () => null, getElementById: () => null },
    location: { origin: "https://sleevu.app" }
  };
  sandbox.window = sandbox;
  sandbox.window.TCGShared = { t: (k) => k, escapeHtml: String, escapeAttribute: String };
  vm.createContext(sandbox);
  vm.runInContext(scanSrc, sandbox);
  return sandbox.window.TCGScan;
}
const S = load();
const lista = (x) => Array.from(x);

test("escolherPelaArte: uma carta clara, com folga sobre o resto do set", () => {
  const e = S.escolherPelaArte([0.41, 0.93, 0.52, 0.38, null]);
  assert.equal(e.i, 1);
  assert.equal(e.claro, true);
  assert.deepEqual(lista(e.empates), [1]);
  // A mais parecida abaixo da régua não vale, por mais sozinha que esteja.
  assert.equal(S.escolherPelaArte([0.2, 0.61, 0.1]), null);
  // Sem folga sobre a segunda: a foto ruim deixa o set inteiro parecido.
  assert.equal(S.escolherPelaArte([0.70, 0.66, 0.4]), null);
  assert.equal(S.escolherPelaArte([0.72, 0.65, 0.3]), null);
  // Set sem assinatura nenhuma, ou vazio.
  assert.equal(S.escolherPelaArte([null, null]), null);
  assert.equal(S.escolherPelaArte([]), null);
});

test("escolherPelaArte: a mesma arte em duas versões vai junta, pra conferir", () => {
  // Foil e normal (ou a reimpressão no mesmo set): empatam, e o resto longe.
  const e = S.escolherPelaArte([0.3, 0.91, 0.90, 0.45]);
  assert.equal(e.claro, false);
  assert.deepEqual(lista(e.empates), [1, 2]);
  // A ordem dos empates é a da semelhança.
  assert.deepEqual(lista(S.escolherPelaArte([0.89, 0.2, 0.91]).empates), [2, 0]);
  // Empate não dispensa a folga sobre quem NÃO empata.
  assert.equal(S.escolherPelaArte([0.91, 0.90, 0.86]), null);
});

test("filtrarSets: o seletor da trava acha o set pelo nome ou pelo id", () => {
  const sets = [
    { game: "dbz", id: "dbz-s1", name: "Saiyan Saga", lang: "en", n: 250 },
    { game: "dbz", id: "dbz-s7", name: "World Games Saga", lang: "en", n: 180 },
    { game: "lotr", id: "lotr-01", name: "The Fellowship of the Ring", lang: "en", n: 365 },
    { game: "pokemon", id: "sv06", name: "Máscaras do Crepúsculo", lang: "pt", n: 226 },
    { game: "onepiece", id: "OP05", name: "Awakening of the New Era", lang: "en", n: 150 }
  ];
  const ids = (x) => lista(x).map((s) => s.id);
  // Todas as palavras, em qualquer ordem, sem acento nem caixa.
  assert.deepEqual(ids(S.filtrarSets(sets, "saga saiyan", "", "hub")), ["dbz-s1"]);
  assert.deepEqual(ids(S.filtrarSets(sets, "mascaras", "", "hub")), ["sv06"]);
  // Pelo id também (quem lê "OP05" na caixa).
  assert.deepEqual(ids(S.filtrarSets(sets, "op05", "", "hub")), ["OP05"]);
  // Com o jogo escolhido no seletor, só os dele.
  assert.deepEqual(ids(S.filtrarSets(sets, "", "dbz", "hub")), ["dbz-s1", "dbz-s7"]);
  // Sem texto, os do jogo da página vêm antes.
  assert.equal(ids(S.filtrarSets(sets, "", "", "lotr"))[0], "lotr-01");
  // Quem COMEÇA pelo texto vem antes de quem só contém.
  assert.deepEqual(ids(S.filtrarSets(sets, "the", "", "hub")), ["lotr-01", "OP05"]);
  assert.deepEqual(ids(S.filtrarSets(sets, "nada disso", "", "hub")), []);
  assert.deepEqual(ids(S.filtrarSets(null, "x", "", "hub")), []);
});

test("o índice de sets guarda nome, idioma e contagem pro seletor", () => {
  const m = S.montarIndice([["dbz", { sets: [{ id: "dbz-s1", name: "Saiyan Saga", count: 250 }] }], ["pokemon", { sets: [{ id: "sv06", name: "Máscaras", language: "pt", count: 226 }] }]]);
  assert.deepEqual(JSON.parse(JSON.stringify(m.sets)), [
    { game: "dbz", id: "dbz-s1", name: "Saiyan Saga", lang: "en", n: 250 },
    { game: "pokemon", id: "sv06", name: "Máscaras", lang: "pt", n: 226 }
  ]);
});

test("o set travado aprende as artes e a leitura as consulta antes do OCR", () => {
  // A arte só decide com o set quase todo aprendido: com metade das cartas,
  // a que falta pode ser a da foto.
  assert.match(scanSrc, /a\.sigs\.length < 2 \|\| a\.prontas < a\.total \* 0\.9\) return null;/);
  // Antes das passadas; uma carta clara dispensa o OCR, e a arte ambígua
  // (versões da mesma arte) fica de reserva se o código não fechar.
  assert.match(scanSrc, /const pelaArte = trava \? pelaArteDoSet\(trava, fotos\) : null;\s*if \(pelaArte && pelaArte\.foto\.claro\) r = pelaArte;/);
  assert.match(scanSrc, /if \(pelaArte && r\.estado !== "certo"\) r = pelaArte;/);
  // Com a economia de dados do aparelho, nada desce: o set segue pelo código.
  assert.match(scanSrc, /if \(navigator\.connection && navigator\.connection\.saveData\) \{ tr\.arte\.fim = true; return; \}/);
  // O aprendizado para quando a trava muda ou o scanner fecha.
  assert.match(scanSrc, /while \(i < cartas\.length && trava === tr && wrap\.isConnected\) \{/);
  // O cadeado sem carta lida abre o seletor de set; escolher trava.
  assert.match(scanSrc, /if \(m\.sets && m\.sets\.length\) abrirSets\(\); else dizer\(t\("scan\.lockHint"\)\);/);
  assert.match(scanSrc, /if \(st\) travarEm\(\{ game: st\.game, setId: st\.id, set: st\.name, lang: st\.lang \}\);/);
  // A foto continua sem sair do aparelho: o que desce são miniaturas do catálogo.
  assert.match(scanSrc, /assinaturaDaCarta\(\{ card, game: tr\.game \}, Date\.now\(\) \+ 20000\)/);
  // scan_done conta as leituras resolvidas pela arte.
  const m = /logEvento\("scan_done",\s*\{([\s\S]{0,520}?)\}\)/.exec(scanSrc);
  assert.ok(m && /\barte: funil\.arte/.test(m[1]), "scan_done sem arte");
});

test("os textos novos do scanner existem em pt, en e es", () => {
  const i18n = readFileSync(join(raiz, "src", "i18n.js"), "utf8");
  for (const chave of ["scan.sets.title", "scan.sets.label", "scan.sets.search", "scan.sets.empty", "scan.sets.hint", "scan.art.learning", "scan.art.ready"]) {
    const n = i18n.split(`"${chave}":`).length - 1;
    assert.equal(n, 3, `${chave} aparece ${n} vez(es) no i18n (precisa de pt, en e es)`);
    assert.ok(scanSrc.includes(`"${chave}"`), `${chave} não é usada no scan.js`);
  }
});
