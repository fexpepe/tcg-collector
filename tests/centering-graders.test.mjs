// Tabelas de centralização das graduadoras e a regra de nota do Centering Tool
// (src/centering-graders.js; docs/PLANO-CENTERING-V2.md §4 e §10.2).
//
// Os CASOS-ÂNCORA são a regra escrita de cada graduadora, executável: quando
// uma delas mudar a tabela, este arquivo muda junto (§4.8). Errar aqui não
// quebra tela nenhuma — entrega uma nota estimada errada com cara de certa,
// que é exatamente o defeito que a v2 critica no concorrente.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(here, "..");
const ler = (rel) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");

// Puro e sem DOM: num vm só com `window`, como no navegador.
function carrega() {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(ler("src/centering-graders.js"), sandbox);
  return sandbox.window.TCGCenteringGraders;
}
const G = carrega();
// O módulo roda em outro realm do vm: objetos dele não passam no deepEqual
// deste realm por causa do protótipo. Copiar resolve.
const copia = (x) => JSON.parse(JSON.stringify(x));

// Um lado medido. lr/tb DIRECIONAIS (esquerda/topo primeiro), 1 casa.
const L = (lr, tb = 50, sigma = 0.1, extra = {}) => Object.assign({ lr, tb, sigma }, extra);
const av = (code, f, v = null, opts) => copia(G.avaliar(code, { f, v }, opts));
const nota = (code, f, v, opts) => av(code, f, v, opts).nota;

const TODAS = () => G.lista.concat(G.mais);
const valorNota = (n) => parseFloat(n) + (/[P+]$/.test(n) ? 0.25 : 0);

// ── Estrutura ───────────────────────────────────────────────────────────────

test("as 5 do painel e as 5 de 'mais graduadoras', na ordem do plano", () => {
  assert.deepEqual(copia(G.lista.map((g) => g.code)), ["psa", "bgs", "cgc", "sgc", "tag"]);
  assert.deepEqual(copia(G.mais.map((g) => g.code)), ["ace", "pca", "ars", "capy", "edge"]);
  assert.match(G.revisado, /^\d{4}-\d{2}-\d{2}$/);
});

test("toda graduadora tem fontes https, conferido ISO e confiança válida", () => {
  const https = /^https:\/\/[^\s]+$/;
  for (const g of TODAS()) {
    assert.ok(Array.isArray(g.fontes) && g.fontes.length, `${g.code}: sem fontes`);
    for (const u of g.fontes) assert.match(u, https, `${g.code}: fonte não é URL https pura (${u})`);
    for (const k of Object.keys(g.variantes || {})) {
      for (const u of g.variantes[k].fontes) assert.match(u, https, `${g.code}/${k}: fonte da variante`);
    }
    assert.match(g.conferido, /^\d{4}-\d{2}-\d{2}$/, `${g.code}: conferido não é AAAA-MM-DD`);
    assert.ok(!Number.isNaN(Date.parse(g.conferido + "T00:00:00Z")), `${g.code}: conferido inválido`);
    assert.ok(["alta", "media", "baixa"].includes(g.confianca), `${g.code}: confianca`);
    assert.ok(Array.isArray(g.vigencias) && g.vigencias.length, `${g.code}: sem vigências`);
    assert.equal(g.vigencias.filter((v) => !v.historico).length, 1, `${g.code}: precisa de UMA vigência atual`);
    for (const vig of g.vigencias) {
      if (vig.fonte) assert.match(vig.fonte, https, `${g.code}: fonte da vigência`);
    }
  }
});

test("notas na ordem da escala e limites só nos formatos da convenção", () => {
  const limiteOk = (x) => x === null || x === "qualquer" || x === "borda" || x === "igual" ||
    (typeof x === "number" && x >= 50 && x <= 100) ||
    (x && typeof x === "object" && x.melhor >= 50 && x.pior >= x.melhor);
  for (const g of TODAS()) {
    for (const vig of g.vigencias) {
      const notas = vig.notas.map((n) => n[0]);
      for (let i = 1; i < notas.length; i++) {
        assert.ok(valorNota(notas[i]) < valorNota(notas[i - 1]), `${g.code}: ${notas[i]} depois de ${notas[i - 1]}`);
      }
      for (const [n, f, v, x] of vig.notas) {
        assert.ok(limiteOk(f) && f !== "igual", `${g.code} ${n}: frente ${JSON.stringify(f)}`);
        assert.ok(limiteOk(v), `${g.code} ${n}: verso ${JSON.stringify(v)}`);
        // "inter" é nota SEM número: nunca tem limite.
        if (x && x.inter) assert.ok(f === null && v === null, `${g.code} ${n}: inter com número`);
      }
    }
  }
});

test("o lembrete de 180 dias do check.mjs acha o conferido de todas", async (t) => {
  const arq = join(RAIZ, "scripts/lib/lembrete-centering.mjs");
  if (!existsSync(arq)) return t.skip("scripts/lib/lembrete-centering.mjs ainda não existe");
  const { lembreteTabelas } = await import(pathToFileURL(arq).href);
  const texto = ler("src/centering-graders.js");
  assert.equal(lembreteTabelas(texto, new Date("2026-10-02T00:00:00Z")), null);
  const linha = lembreteTabelas(texto, new Date("2027-06-01T00:00:00Z"));
  assert.ok(linha, "conferido de 2026-10-01 deveria estar vencido em 2027-06");
  for (const g of TODAS()) assert.ok(linha.includes(g.code), `${g.code} fora do lembrete: ${linha}`);
});

// ── Monotonia, depois da herança do null ─────────────────────────────────────

test("monotonia: uma nota maior nunca permite mais, na frente e no verso, em todas as leituras", () => {
  // número → [N, N]; {melhor, pior} → [melhor, pior]; sem limite → [100, 100].
  const par = (x) => (typeof x === "number" ? [x, x] : x && typeof x === "object" ? [x.melhor, x.pior] : [100, 100]);
  const optsTodos = [{}, { categoria: "tcg" }, { categoria: "nao-esporte" }, { categoria: "depende" }];
  for (const g of TODAS()) {
    for (const opts of optsTodos) {
      for (const lt of copia(G.escalas(g.code, opts))) {
        const cands = lt.linhas.filter((l) => l.cand);
        for (let i = 1; i < cands.length; i++) {
          const a = cands[i - 1], b = cands[i];
          for (const lado of ["f", "v"]) {
            const [am, ap] = par(a[lado]), [bm, bp] = par(b[lado]);
            assert.ok(bm >= am && bp >= ap,
              `${g.code} (${lt.origem}): ${b.nota} pede ${JSON.stringify(b[lado])} no ${lado}, mais que ${a.nota} (${JSON.stringify(a[lado])})`);
          }
        }
      }
    }
  }
});

test("herança: o verso do CGC 10P é o 75 do Gem Mint 10; sem nota de baixo publicada, sem limite", () => {
  const [tcg] = copia(G.escalas("cgc", { categoria: "tcg" }));
  const p = tcg.linhas.find((l) => l.nota === "10P");
  assert.equal(p.v, 75);
  assert.equal(p.herdaDe, "10");
  assert.equal(tcg.linhas.find((l) => l.nota === "3.5").v, null);
  // ACE "só frente": o 10 não pode aceitar verso que o 9 reprova.
  const [, soFrente] = copia(G.escalas("ace"));
  assert.equal(soFrente.origem, "so-frente");
  assert.equal(soFrente.linhas[0].v, 70);
});

// ── Casos-âncora (§10.2) ─────────────────────────────────────────────────────

test("PSA: tabela de 24/01/2025 e folga de 5% pra notas ≥ 7", () => {
  assert.equal(nota("psa", L(55.0)), "10");
  let r = av("psa", L(55.1));
  assert.equal(r.nota, "9");
  assert.equal(r.folga, "10");
  r = av("psa", L(60.0));
  assert.equal(r.nota, "9");
  assert.equal(r.folga, "10");
  // 60,1 passa do 60/40 do 9: pela regra escrita (X ≤ N) a nota estrita é 8,
  // o 9 cabe na folga (≤ 65) e o 10 NÃO (pede ≤ 60). O texto do plano diz
  // "60,1 → 9 sem folga pro 10"; o que importa nele é a ausência de folga pro
  // 10 — e 60,1 sai "no limite" 8–9.
  r = av("psa", L(60.1));
  assert.equal(r.nota, "8");
  assert.equal(r.folga, "9");
  assert.notEqual(r.folga, "10");
  assert.deepEqual(r.noLimite, { de: "8", ate: "9" });
  r = av("psa", L(65.0));
  assert.equal(r.nota, "8");
  assert.equal(r.folga, "9");
  r = av("psa", L(75.0));
  assert.equal(r.nota, "6");
  assert.equal(r.folga, "7");
  assert.equal(av("psa", L(76.0)).folga, null, "a folga só vale pra notas ≥ 7");
  r = av("psa", L(92));
  assert.equal(r.nota, "1");          // "sem exigência"
  assert.equal(r.rot, "PR");
  assert.equal(nota("psa", L(90)), "3");
  assert.equal(nota("psa", L(10)), "3", "90/10 com o lado maior à direita é o mesmo 90/10");
  assert.equal(av("psa", L(55.0)).rot, "GEM-MT");
});

test("PSA: a folga também exige o verso da nota de cima", () => {
  // Frente 58 cabe na folga do 10 (≤ 60), mas o verso 80 reprova o 75 do 10.
  const r = av("psa", L(58), L(80));
  assert.equal(r.nota, "9");
  assert.equal(r.folga, null);
});

test("TAG: decimais oficiais, sem o arredondamento do concorrente", () => {
  assert.equal(nota("tag", L(62.5)), "8.5");
  assert.equal(nota("tag", L(62.6)), "8");
  assert.equal(nota("tag", L(98.3)), "1.5");
  assert.equal(nota("tag", L(98.4)), "1");
  assert.equal(nota("tag", L(51.0)), "10P");
  assert.equal(nota("tag", L(51.1)), "10");
  // Verso TCG: 9 pede ≤ 75 no verso.
  assert.equal(nota("tag", L(58), L(76)), "8.5");
  // "borda": 100/0 é miscut, não sobra borda — abaixo da última nota.
  const r = av("tag", L(100));
  assert.equal(r.nota, null);
  assert.equal(r.abaixoSemNumero, true);
  assert.equal(r.abaixoDe, "1");
  assert.equal(av("tag", L(58)).papel, "componente");
});

test("BGS: subnota, duas páginas oficiais e a nota pela mais rígida", () => {
  let r = av("bgs", L(55, 55), L(60, 50));
  assert.equal(r.nota, "9");
  assert.equal(r.papel, "subnota");
  assert.equal(r.leitura, "scale");
  assert.equal(r.divergem, true);
  assert.deepEqual(r.leituras.map((l) => [l.origem, l.nota]), [["standards", "9.5"], ["scale", "9"]]);

  r = av("bgs", L(50.0, 50.0));
  assert.equal(r.nota, "10");
  assert.equal(r.rot, "Pristine");
  assert.equal(r.compat50, true);
  // 50/50 sai sempre "no limite". A ponta de baixo é 9, não 9.5: pela
  // /grading/scale o 9.5 também pede 50/50 num eixo, que a leitura
  // pessimista nunca confirma.
  assert.deepEqual(r.noLimite, { de: "9", ate: "10" });

  // Verso 96/4: reprova o 95 do 6 e do 5.
  r = av("bgs", L(75), L(96));
  assert.equal(r.nota, "4");
  assert.deepEqual(r.semNumero, ["4.5"]);

  r = av("bgs", L(57.9));
  assert.equal(r.nota, "8");
  assert.deepEqual(r.semNumero, ["8.5"]);
  assert.equal(r.abaixoSemNumero, false);
});

test("BGS: o verso do Pristine diverge entre as páginas (55 × 60)", () => {
  const r = av("bgs", L(50, 50), L(57, 50));
  // /grading-standards: verso 57 > 55 reprova o 10; /grading/scale aceita até 60.
  assert.deepEqual(r.leituras.map((l) => [l.origem, l.nota]), [["standards", "9.5"], ["scale", "10"]]);
  assert.equal(r.nota, "9.5");
  assert.equal(r.leitura, "standards");
});

test("CGC: só 10P, 10 e 3.5 têm número pra TCG; non-sports pela régua dela", () => {
  let r = av("cgc", L(54));
  assert.equal(r.nota, "10");
  assert.equal(r.rot, "Gem Mint");

  r = av("cgc", L(56));
  assert.equal(r.nota, null);
  assert.equal(r.abaixoSemNumero, true);
  assert.equal(r.abaixoDe, "10");
  assert.equal(r.piso, "3.5");

  // O verso do 10P herda o 75 do 10: F 50,0 e V 80 reprova os dois 10.
  r = av("cgc", L(50.0, 50.0), L(80));
  assert.equal(r.nota, null);
  assert.equal(r.abaixoSemNumero, true);
  assert.equal(r.abaixoDe, "10");

  r = av("cgc", L(89));
  assert.equal(r.nota, "3.5");
  assert.equal(r.abaixoSemNumero, false);

  assert.equal(nota("cgc", L(58), null, { categoria: "nao-esporte" }), "9");
  r = av("cgc", L(62), null, { categoria: "nao-esporte" });
  assert.equal(r.nota, "8");
  assert.deepEqual(r.semNumero, ["8.5"]);

  // Carddass: a CGC classifica dos dois jeitos → duas leituras.
  r = av("cgc", L(58), null, { categoria: "depende" });
  assert.equal(r.nota, null, "a mais rígida é a TCG (abaixo de 10, sem número)");
  assert.equal(r.abaixoSemNumero, true);
  assert.equal(r.abaixoDe, "10");
  assert.equal(r.leitura, "tcg");
  assert.equal(r.divergem, true);
  assert.deepEqual(r.leituras.map((l) => [l.origem, l.nota, l.abaixoSemNumero]),
    [["tcg", null, true], ["nao-esporte", "9", false]]);

  // Acima do 90/10: abaixo da última nota com número.
  r = av("cgc", L(91));
  assert.equal(r.nota, null);
  assert.equal(r.abaixoDe, "3.5");
  assert.equal(r.piso, null);
});

test("CGC: Pristine 10 é 50/50 'no limite'; abaixo do 10 o verso não é publicado", () => {
  let r = av("cgc", L(50.2, 50.0), L(70));
  assert.equal(r.nota, "10P");
  assert.equal(r.compat50, true);
  assert.ok(r.noLimite);
  r = av("cgc", L(89), L(60));
  assert.equal(r.verso, "nao-publicado");
});

test("SGC: lado não especificado — conservadora decide, 'só frente' ao lado", () => {
  let r = av("sgc", L(55), L(70));
  assert.equal(r.nota, "7.5");
  assert.equal(r.leitura, "conservadora");
  assert.equal(r.verso, "igual-frente");
  assert.equal(r.divergem, true);
  assert.deepEqual(r.leituras.map((l) => [l.origem, l.nota]), [["conservadora", "7.5"], ["so-frente", "10"]]);

  r = av("sgc", L(55));
  assert.equal(r.nota, "10");
  assert.equal(r.verso, "nao-medido");
  assert.equal(r.ladoNaoEspecificado, true, "o painel avisa que o verso não medido pode baixar");
  assert.equal(r.divergem, false);

  // 9.5 "appears to be Gem Mint 10" não é intermediária; 6.5 é.
  assert.deepEqual(av("sgc", L(58)).semNumero, []);
  r = av("sgc", L(73));
  assert.equal(r.nota, "6");
  assert.deepEqual(r.semNumero, ["6.5"]);
  // Acima de 90/10: o 1 não tem número.
  r = av("sgc", L(92));
  assert.equal(r.nota, null);
  assert.equal(r.abaixoDe, "1.5");
});

test("no limite: δ = max(0,5; 2σ), pessimista × otimista", () => {
  const casos = [
    // [valor, σ, nota, noLimite]
    [54.6, 0.1, "10", { de: "9", ate: "10" }],
    [55.4, 0.1, "9", { de: "9", ate: "10" }],
    [55.6, 0.1, "9", null],
    [54.6, 0.4, "10", { de: "9", ate: "10" }],
    [55.4, 0.4, "9", { de: "9", ate: "10" }],
    [55.6, 0.4, "9", { de: "9", ate: "10" }],     // δ = 0,8: 55,6 − 0,8 = 54,8
    [53.0, 0.1, "10", null]
  ];
  for (const [x, s, n, lim] of casos) {
    const r = av("psa", L(x, 50, s));
    assert.equal(r.nota, n, `${x} σ${s}`);
    assert.deepEqual(r.noLimite, lim, `${x} σ${s}`);
  }
  assert.equal(G.delta(0.1), 0.5);
  assert.equal(G.delta(0.4), 0.8);
  assert.equal(G.delta(null), 0.5);
});

test("50/50 decide pelo MEIO ± σ, nunca pelo pior ponto", () => {
  // O pior ponto de uma carta perfeita lê acima de 50 (viés do máximo).
  const f = L(51.2, 50.0, 0.1, { meio: { lr: 50.2, tb: 50.0 } });
  let r = av("bgs", f);
  assert.equal(r.nota, "10");
  assert.equal(r.compat50, true);
  // Sem o meio, o "usado" 51,2 já passa do 50 + δ.
  r = av("bgs", L(51.2, 50.0));
  assert.equal(r.nota, "9.5");
  // σ maior alarga o 50/50: 50,7 cabe com σ 0,4 (δ 0,8), não com σ 0,1.
  assert.equal(nota("bgs", L(50.7, 50, 0.4)), "10");
  assert.equal(nota("bgs", L(50.7, 50, 0.1)), "9.5");
});

test("falta pro próximo: cada eixo e cada lado que falha, com mm", () => {
  const mm = { l: 3.1, r: 2.3, t: 3.0, b: 2.6 };
  let r = av("psa", L(58.0, 57.0, 0.1, { mm }));
  assert.equal(r.nota, "9");
  assert.deepEqual(r.falta.map((f) => [f.nota, f.lado, f.eixo, f.pts, f.limite]),
    [["10", "f", "lr", 3, 55], ["10", "f", "tb", 2, 55]]);
  assert.ok(Math.abs(r.falta[0].mm - (3.0 / 100) * (3.1 + 2.3)) < 1e-9);
  assert.ok(Math.abs(r.falta[1].mm - (2.0 / 100) * (3.0 + 2.6)) < 1e-9);
  assert.deepEqual(r.limita, { lado: "f", eixo: "lr" });

  // O verso também entra quando é ele que falha.
  r = av("sgc", L(55), L(70));
  assert.deepEqual(r.falta.map((f) => [f.nota, f.lado, f.eixo, f.pts, f.limite]), [["8", "v", "lr", 5, 65]]);
  assert.deepEqual(r.limita, { lado: "v", eixo: "lr" });

  // No topo não falta nada.
  r = av("psa", L(52));
  assert.deepEqual(r.falta, []);
  assert.equal(r.limita, null);

  // "8 (8.5 sem número)": a próxima com número é o 9.
  r = av("bgs", L(57.9));
  assert.deepEqual(r.falta.map((f) => [f.nota, f.eixo, f.pts]), [["9", "lr", 2.9]]);
});

test("decisão × exibição: a nota sai da 1 casa, nunca do inteiro exibido", () => {
  // Foto pobre (σ > 0,5): a tela mostra "55 ±1", mas 55,4 continua PSA 9.
  assert.equal(nota("psa", L(55.4, 50, 0.8)), "9");
  // Entrada sem arredondar vira 1 casa antes de decidir.
  assert.equal(nota("psa", L(55.44)), "9");
  assert.equal(nota("psa", L(54.96)), "10");
  // Direcional: 44,6/55,4 é o mesmo 55,4.
  assert.equal(nota("psa", L(44.6)), "9");
});

test("aceita a saída do medir() do núcleo ({ meio, pior, usado, sigma } por eixo)", () => {
  const f = { lr: { meio: 50.1, pior: 51.0, usado: 50.1, sigma: 0.15 }, tb: { meio: 50.0, pior: 50.4, usado: 50.0, sigma: 0.12 },
    mm: { l: 2.5, r: 2.5, t: 2.5, b: 2.5 } };
  const r = av("bgs", f);
  assert.equal(r.nota, "10");
  assert.equal(r.compat50, true);
  const r2 = av("psa", { lr: { meio: 57, pior: 58, usado: 58, sigma: 0.2 }, tb: { meio: 50, pior: 50, usado: 50, sigma: 0.2 }, mm: { l: 2.9, r: 2.1, t: 2.5, b: 2.5 } });
  assert.equal(r2.nota, "9");
  assert.ok(Math.abs(r2.falta[0].mm - 0.03 * 5) < 1e-9);
});

test("ACE: texto em 'melhor que' — o limite exato já reprova", () => {
  // "less than a 60/40 split" / "greater than 65/35".
  assert.equal(nota("ace", L(59.9)), "10");
  assert.equal(nota("ace", L(60.0)), "9");
  assert.equal(nota("ace", L(65.0)), "8");
});

test("mais graduadoras: PCA/Edge só no topo, ARS não conta, Capy como publicado", () => {
  // ACE 10 sem lado: conservadora usa o 60 no verso; verso 65 cabe no < 70 do 9.
  let r = av("ace", L(55), L(65));
  assert.equal(r.nota, "9");
  assert.deepEqual(r.leituras.map((l) => [l.origem, l.nota]), [["conservadora", "9"], ["so-frente", "10"]]);
  // PCA e Edge publicam só o topo: abaixo do 10, sem número.
  r = av("pca", L(62));
  assert.equal(r.nota, null);
  assert.equal(r.abaixoSemNumero, true);
  assert.equal(r.abaixoDe, "10");
  assert.equal(nota("edge", L(52)), "10+");
  assert.equal(nota("edge", L(54), L(65)), "10");
  // ARS: a centralização não desconta.
  r = av("ars", L(70));
  assert.equal(r.naoConta, true);
  assert.equal(r.nota, null);
  assert.deepEqual(copia(G.tabela("ars", "f")), []);
  // Capy: como publicado (o 7 igual ao 7,5 na frente).
  assert.equal(nota("capy", L(67.5)), "7.5");
  assert.equal(nota("capy", L(67.5), L(70)), "7");
});

test("tabela de critérios: limite cru, efetivo e observações em código", () => {
  const psaF = copia(G.tabela("psa", "f"));
  assert.deepEqual(psaF.map((l) => l.nota), ["10", "9", "8", "7", "6", "5", "4", "3", "2", "1.5", "1"]);
  assert.equal(psaF[0].limite, 55);
  assert.equal(psaF[0].rot, "GEM-MT");
  assert.ok(psaF[0].obs.includes("aprox"));
  assert.equal(psaF[0].folga, 5);
  assert.equal(psaF[4].folga, undefined, "a folga só vale da 7 pra cima");
  assert.equal(psaF[10].limite, "qualquer");

  const hist = copia(G.tabela("psa", "f", { historico: true }));
  assert.deepEqual(hist.map((l) => [l.nota, l.limite, l.faixaAte]), [["10", 55, 60], ["9", 60, 65], ["8", 65, 70], ["7", 70, 75]]);

  const cgcV = copia(G.tabela("cgc", "v"));
  assert.equal(cgcV[0].limite, null);
  assert.ok(cgcV[0].obs.includes("herda"));
  assert.equal(cgcV[0].herdaDe, "10");
  assert.equal(cgcV[0].limiteEfetivo, 75);
  const cgcF = copia(G.tabela("cgc", "f"));
  assert.ok(cgcF.find((l) => l.nota === "9").obs.includes("so-nao-esporte"));
  assert.ok(cgcF.find((l) => l.nota === "8.5").obs.includes("inter"));
  assert.ok(!cgcF.find((l) => l.nota === "3.5").obs.includes("so-nao-esporte"));

  const bgsF = copia(G.tabela("bgs", "f"));
  assert.deepEqual(bgsF[1].variantes, { scale: { melhor: 50, pior: 55 } });
  const bgsV = copia(G.tabela("bgs", "v"));
  assert.deepEqual(bgsV[0].variantes, { scale: 60 });

  const sgcV = copia(G.tabela("sgc", "v"));
  assert.equal(sgcV[1].limite, "igual");
  assert.equal(sgcV[1].limiteEfetivo, 55);
  assert.ok(sgcV[1].obs.includes("lado-nao-especificado"));

  const capyV = copia(G.tabela("capy", "v"));
  const sete5 = capyV.find((l) => l.nota === "7.5");
  assert.equal(sete5.publicado, "67,5/29");
  assert.ok(sete5.obs.includes("como-publicado"));

  assert.ok(copia(G.tabela("ace", "f"))[0].obs.includes("estrito"));
  assert.ok(copia(G.tabela("tag", "f")).every((l) => l.obs.includes("aprox")));
  assert.deepEqual(copia(G.tabela("nao-existe", "f")), []);
});

test("bordas da API: graduadora desconhecida, sem frente, e dados intactos", () => {
  assert.equal(G.avaliar("nao-existe", { f: L(55) }), null);
  const r = av("psa", null, L(60));
  assert.equal(r.semMedida, true);
  assert.equal(r.nota, null);
  const antes = JSON.stringify(TODAS());
  for (const g of TODAS()) {
    for (const opts of [{}, { categoria: "depende" }]) {
      G.avaliar(g.code, { f: L(57.3, 52.1, 0.3), v: L(66, 58, 0.3) }, opts);
      G.tabela(g.code, "f", opts);
      G.tabela(g.code, "v", opts);
    }
  }
  assert.equal(JSON.stringify(TODAS()), antes, "avaliar/tabela não podem mexer nos dados");
});

test("varredura: a nota nunca SOBE quando a centralização piora", () => {
  // Monotonia da regra inteira (não só da tabela): de 50,0 a 100,0 em passos
  // de 0,1, frente e verso, a rigidez da nota não pode melhorar.
  const rank = (code, r) => {
    const g = TODAS().find((x) => x.code === code);
    const notas = g.vigencias.find((v) => !v.historico).notas.map((n) => n[0]);
    if (r.nota != null) return notas.indexOf(r.nota);
    return r.piso != null ? notas.indexOf(r.piso) - 0.5 : notas.length;
  };
  for (const g of TODAS()) {
    for (const opts of [{}, { categoria: "nao-esporte" }, { categoria: "depende" }]) {
      for (const comVerso of [false, true]) {
        let ant = -Infinity;
        for (let k = 500; k <= 1000; k++) {
          const x = k / 10;
          const r = G.avaliar(g.code, { f: L(x, 50), v: comVerso ? L(x, 50) : null }, opts);
          const rk = rank(g.code, r);
          assert.ok(rk >= ant, `${g.code} ${JSON.stringify(opts)} verso=${comVerso}: ${x} melhorou a nota`);
          ant = rk;
        }
      }
    }
  }
});
