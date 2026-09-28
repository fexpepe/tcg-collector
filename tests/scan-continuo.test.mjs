// Leitura AUTOMÁTICA e lista da sessão do scanner (src/scan.js) — o "modo
// ManaBox": a carta entra no quadro, é lida sozinha, vai pra lista; a pessoa
// revisa e adiciona tudo de uma vez.
//
// O que se trava aqui:
//   - as medidas do quadro (luz, reflexo, contraste, movimento);
//   - a máquina de estados do disparo: lê quando PARA, e não lê a mesma carta
//     duas vezes — só volta a ler quando a cena muda;
//   - a variante que entra na lista pela preferência da sessão;
//   - o laço pausa com folha aberta, falha automática sem código não abre a
//     folha, e a lista guarda só ids, por 24 h.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const scanSrc = readFileSync(join(here, "..", "src", "scan.js"), "utf8");
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
const W = 48, H = 66;

// Amostra sintética em cinza: `f(x, y)` → 0-255.
const amostra = (f) => { const g = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = Math.max(0, Math.min(255, f(x, y))); return g; };
const cartaA = amostra((x, y) => 120 + 80 * Math.sin(x / 3) * Math.cos(y / 4)); // carta: muito contraste
const cartaB = amostra((x, y) => 110 + 90 * Math.cos(x / 2.5 + y / 5));
const mesa = amostra(() => 95); // mesa lisa
const escuro = amostra((x, y) => 12 + 10 * Math.sin(x / 3));
const tremida = (g, d) => amostra((x, y) => g[y * W + x] + ((x + y) % 2 ? d : -d)); // tremor da mão

test("medidas do quadro: luz, reflexo, contraste e movimento", () => {
  const m = S.medirQuadro(mesa, W, H, null);
  assert.equal(Math.round(m.brilho), 95);
  assert.equal(m.contraste, 0);
  assert.equal(m.reflexo, 0);
  assert.ok(Number.isNaN(m.movimento), "sem amostra anterior: nem parada nem mudança");
  assert.equal(S.medirQuadro(cartaA, W, H, cartaA).movimento, 0);
  assert.ok(S.medirQuadro(cartaA, W, H, cartaB).movimento > S.AUTO.mudou, "trocar a carta é mudança de cena");
  assert.ok(S.medirQuadro(tremida(cartaA, 3), W, H, cartaA).movimento < S.AUTO.parada, "tremor leve ainda é parado");
  assert.ok(S.medirQuadro(cartaA, W, H, null).contraste > S.AUTO.contraste, "carta tem conteúdo");
  const estourada = amostra((x) => (x < 5 ? 255 : 120));
  assert.ok(Math.abs(S.medirQuadro(estourada, W, H, null).reflexo - 5 / W) < 1e-9);
});

// Roda uma sequência de amostras pela máquina de estados; devolve em quais
// índices ela disparou.
function disparos(seq, inicio) {
  let st = inicio || { armado: true, parados: 0 }, ant = null;
  const out = [];
  seq.forEach((g, i) => {
    const r = S.passoAuto(st, S.medirQuadro(g, W, H, ant));
    st = r.st;
    ant = g;
    if (r.disparar) out.push(i);
  });
  return out;
}
const vezes = (g, n) => Array.from({ length: n }, () => g);

test("dispara quando a carta PARA, uma vez só enquanto ela fica", () => {
  // 1ª amostra não tem anterior (não conta); depois três paradas: dispara na 4ª (índice 3).
  assert.deepEqual(Array.from(disparos(vezes(cartaA, 12))), [3]);
  // Tremor leve de quem segura na mão não impede.
  const mao = [cartaA, tremida(cartaA, 2), cartaA, tremida(cartaA, 2), cartaA, cartaA];
  assert.deepEqual(Array.from(disparos(mao)), [3]);
});

test("troca de carta rearma; mesa lisa e escuro não disparam", () => {
  // A (lê) → sai (mesa: muda a cena, rearma, mas é lisa) → B (muda, para, lê).
  const seq = [...vezes(cartaA, 6), ...vezes(mesa, 5), ...vezes(cartaB, 6)];
  const d = Array.from(disparos(seq));
  assert.equal(d.length, 2, `esperava duas leituras, deu ${d}`);
  assert.equal(d[0], 3);
  assert.ok(d[1] >= 11 + 3, "B só depois de parar três vezes");
  // Sem luz (tudo abaixo do brilho mínimo) não lê, mesmo parado.
  assert.deepEqual(Array.from(disparos(vezes(escuro, 10))), []);
  // Mesa lisa não lê.
  assert.deepEqual(Array.from(disparos(vezes(mesa, 10))), []);
});

test("desarmado (acabou de ler), a mesma carta não é lida de novo", () => {
  // Inclusive quando o laço começa DEPOIS da leitura (a 1ª carta lida no
  // toque, com o motor ainda aquecendo): a 1ª amostra, sem anterior, não
  // conta como carta trocada.
  assert.deepEqual(Array.from(disparos(vezes(cartaA, 20), { armado: false, parados: 0 })), []);
  // Só a mudança de cena rearma: depois dela, lê a carta que parar.
  const d = Array.from(disparos([cartaA, cartaB, ...vezes(cartaB, 5)], { armado: false, parados: 0 }));
  assert.deepEqual(d, [4]);
});

test("dica do quadro: pouca luz e reflexo", () => {
  assert.equal(S.dicaDoQuadro(S.medirQuadro(escuro, W, H, null)), "scan.hint.dark");
  const brilho = amostra((x) => (x < 8 ? 255 : 140));
  assert.equal(S.dicaDoQuadro(S.medirQuadro(brilho, W, H, null)), "scan.hint.glare");
  assert.equal(S.dicaDoQuadro(S.medirQuadro(cartaA, W, H, null)), "");
});

test("variante da sessão: padrão, foil/holo e reverse, com volta pra padrão", () => {
  const pk = ["Normal", "Reverse Holofoil"];
  assert.equal(S.varianteDe(pk, "padrao"), "Normal");
  assert.equal(S.varianteDe(pk, "reverse"), "Reverse Holofoil");
  assert.equal(S.varianteDe(pk, "foil"), "Normal", "reverse não é o foil da carta");
  const holo = ["Holofoil", "Reverse Holofoil"];
  assert.equal(S.varianteDe(holo, "foil"), "Holofoil");
  const mtg = ["Normal", "Foil", "Etched"];
  assert.equal(S.varianteDe(mtg, "foil"), "Foil");
  assert.equal(S.varianteDe(mtg, "reverse"), "Normal");
  assert.equal(S.varianteDe([], "foil"), "Normal");
  assert.equal(S.varianteDe(undefined, "padrao"), "Normal");
});

test("o laço pausa com folha aberta, e a leitura automática sem código não abre nada", () => {
  assert.match(scanSrc, /!folha\.hidden \|\| !folhaSom\.hidden \|\| !folhaLista\.hidden \|\| document\.hidden/);
  // Qualquer leitura desarma (a do toque também).
  assert.match(scanSrc, /async function ler\(fonte, rec, auto\) \{[\s\S]{0,300}?estAuto = \{ armado: false, parados: 0 \};/);
  assert.match(scanSrc, /if \(auto && !codigo\) \{ dicaFalha = t\("scan\.hint\.retry"\); return; \}/);
  // O resumo conta as leituras automáticas.
  const m = /logEvento\("scan_done",\s*\{([\s\S]{0,260}?)\}\)/.exec(scanSrc);
  assert.ok(m && /\bauto: funil\.auto/.test(m[1]), "scan_done sem auto");
});

test("a lista guarda só ids, por 24 h, e adiciona com a condição da sessão", () => {
  assert.match(scanSrc, /const CHAVE_LISTA = "tcg-scan-lista-v1";/);
  const salvar = /function salvarLista\(\) \{[\s\S]*?\n    \}/.exec(scanSrc)[0];
  assert.match(salvar, /itens: lista\.map\(\(it\) => \(\{ g: it\.game, id: it\.card\.id, v: it\.variante, q: it\.qtd, a: it\.adicionadas, c: it\.conferir \? 1 : 0 \}\)\)/);
  assert.doesNotMatch(salvar, /image|canvas|quadro/, "a foto nunca vai pro storage");
  assert.match(scanSrc, /Date\.now\(\) - salvo\.t < 86400000/);
  assert.match(scanSrc, /st\.add\(it\.card\.id, it\.variante, prefCond, q\);/);
});
