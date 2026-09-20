// Retenção por faixa do histórico de preços (scripts/lib/price-history-retention.mjs).
//
// O que motivou: o MAX_POINTS = 60 era uma JANELA ROLANTE — a série se repunha
// inteira a cada dois meses, então o histórico nunca virava acervo e daqui a um
// ano o site teria os mesmos dois meses de hoje. Preço de ontem não se compra
// depois. Agora o passado perde RESOLUÇÃO em vez de sumir.
//
// O que está travado aqui, porque é onde dá errado:
//   1. a faixa diária tem de sair INTACTA (os deltas 1d/7d e os movers vivem nela);
//   2. a regra tem de ser IDEMPOTENTE — aplicar a cada build não pode ir comendo
//      a série de pouco em pouco;
//   3. o crescimento tem de ser limitado, senão o maior JSON do site explode;
//   4. nada do futuro é descartado (relógio de runner atrasado, fuso).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  marcarMantidos, podarHistorico, podarGraded, DIAS_DIARIO, DIAS_SEMANAL,
  migrarIdsDoHistorico, serieMaisAdiantada
} from "../scripts/lib/price-history-retention.mjs";

const DIA = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
// Série diária de `n` dias terminando em `fim` (inclusive).
const diario = (n, fim = "2026-09-19") => {
  const t = Date.parse(fim + "T00:00:00Z");
  return Array.from({ length: n }, (_, k) => iso(t - (n - 1 - k) * DIA));
};
const mantidas = (datas, hoje) => datas.filter((_, i) => marcarMantidos(datas, hoje)[i]);

test("série curta (dentro da faixa diária) não perde nenhum ponto", () => {
  const d = diario(DIAS_DIARIO);
  assert.deepEqual(mantidas(d), d);
  // exatamente no limite também fica inteira
  assert.equal(mantidas(diario(DIAS_DIARIO + 1)).length, DIAS_DIARIO + 1);
});

test("a faixa diária sai intacta — é dela que saem os deltas 1d/7d e os movers", () => {
  const d = diario(400);
  const hoje = d[d.length - 1];
  const fica = new Set(mantidas(d, hoje));
  const corte = Date.parse(hoje + "T00:00:00Z") - DIAS_DIARIO * DIA;
  for (const dia of d) {
    if (Date.parse(dia + "T00:00:00Z") >= corte) {
      assert.ok(fica.has(dia), `o dia ${dia} está na faixa diária e foi descartado`);
    }
  }
});

test("faixa semanal: 1 ponto por semana, e é o ÚLTIMO dela", () => {
  const d = diario(200);
  const hoje = d[d.length - 1];
  const fica = mantidas(d, hoje);
  const idade = (x) => Math.round((Date.parse(hoje + "T00:00:00Z") - Date.parse(x + "T00:00:00Z")) / DIA);
  const semanais = fica.filter((x) => idade(x) > DIAS_DIARIO);

  // uma segunda-feira separa as semanas ISO; o representante é sempre domingo
  // (último dia da semana) quando a semana está inteira na série.
  const semana = (x) => {
    const t = Date.parse(x + "T00:00:00Z");
    return iso(t - ((new Date(t).getUTCDay() + 6) % 7) * DIA);
  };
  const baldes = semanais.map(semana);
  assert.equal(new Set(baldes).size, baldes.length, "duas datas da mesma semana sobreviveram");

  for (const s of semanais) {
    const mesmaSemana = d.filter((x) => semana(x) === semana(s));
    assert.equal(s, mesmaSemana[mesmaSemana.length - 1], `${s} não é o último ponto da sua semana`);
  }
});

test("faixa mensal: 1 ponto por mês além de um ano", () => {
  const d = diario(3 * 365);
  const hoje = d[d.length - 1];
  const fica = mantidas(d, hoje);
  const idade = (x) => Math.round((Date.parse(hoje + "T00:00:00Z") - Date.parse(x + "T00:00:00Z")) / DIA);
  const mensais = fica.filter((x) => idade(x) > DIAS_SEMANAL);
  const meses = mensais.map((x) => x.slice(0, 7));
  assert.equal(new Set(meses).size, meses.length, "dois pontos do mesmo mês sobreviveram na faixa mensal");
  assert.ok(mensais.length >= 20, `3 anos deviam deixar ~24 pontos mensais, vieram ${mensais.length}`);
});

test("IDEMPOTENTE: aplicar a cada build não vai comendo a série", () => {
  const d = diario(3 * 365);
  const hoje = d[d.length - 1];
  const uma = mantidas(d, hoje);
  const duas = mantidas(uma, hoje);
  assert.deepEqual(duas, uma, "a segunda passada descartou pontos que a primeira manteve");
  // e uma terceira também não
  assert.deepEqual(mantidas(duas, hoje), uma);
});

test("estável no tempo: o que já é representante continua sendo depois de novos dias", () => {
  // Simula o build rodando dia após dia e confere que nenhum ponto ANTIGO que
  // sobreviveu volta a ser descartado por capricho — só por mudar de faixa.
  let serie = diario(120);
  const visto = new Set(serie);
  for (let k = 0; k < 400; k++) {
    const prox = iso(Date.parse(serie[serie.length - 1] + "T00:00:00Z") + DIA);
    serie.push(prox);
    visto.add(prox);
    serie = mantidas(serie, prox);
    // a série nunca pode ficar fora de ordem nem ter data repetida
    assert.deepEqual(serie, [...serie].sort(), "a série saiu fora de ordem");
    assert.equal(new Set(serie).size, serie.length, "data repetida na série");
  }
  assert.ok(serie.length > DIAS_DIARIO, "depois de 400 dias a série tem de ser maior que a faixa diária");
});

test("crescimento travado: 5 anos cabem em ~150 pontos, não em 1825", () => {
  let serie = [];
  let t = Date.parse("2026-09-19T00:00:00Z");
  for (let k = 0; k < 5 * 365; k++) {
    serie.push(iso(t));
    serie = mantidas(serie, iso(t));
    t += DIA;
  }
  assert.ok(serie.length <= 200, `5 anos deram ${serie.length} pontos (teto esperado ~200)`);
  assert.ok(serie.length >= 110, `5 anos deram só ${serie.length} pontos — a poda está comendo demais`);
  // e cobre mesmo os 5 anos: o ponto mais antigo tem de ser bem velho
  const alcance = Math.round((Date.parse(serie[serie.length - 1]) - Date.parse(serie[0])) / DIA);
  assert.ok(alcance > 4 * 365, `a série só alcança ${alcance} dias — o acervo longo não existe`);
});

test("data no futuro (relógio do runner) nunca é descartada", () => {
  const d = [...diario(100), "2099-01-01"];
  assert.ok(mantidas(d, "2026-09-19").includes("2099-01-01"));
});

test("podarHistorico corta as séries junto com as datas", () => {
  const d = diario(400);
  const hist = {
    v: 1, d: [...d],
    c: {
      a: { s: "u", p: d.map((_, i) => i) },
      b: { s: "e", p: d.map((_, i) => i * 2) }
    }
  };
  const removidos = podarHistorico(hist, d[d.length - 1]);
  assert.ok(removidos > 0);
  assert.equal(hist.d.length, d.length - removidos);
  assert.equal(hist.c.a.p.length, hist.d.length, "a série `p` ficou desalinhada das datas");
  assert.equal(hist.c.b.p.length, hist.d.length);
  // o valor tem de continuar casando com a SUA data (p[i] == índice original)
  hist.d.forEach((data, i) => assert.equal(hist.c.a.p[i], d.indexOf(data), `ponto ${data} ficou com o valor errado`));
  // o último ponto (o de hoje) nunca se perde
  assert.equal(hist.d[hist.d.length - 1], d[d.length - 1]);
  assert.equal(hist.c.a.p[hist.d.length - 1], d.length - 1);
});

test("podarGraded corta cada NOTA junto com as datas", () => {
  const d = diario(400);
  const gh = { v: 1, d: [...d], c: { x: { "10": d.map((_, i) => i), "9": d.map((_, i) => i + 0.5) } } };
  const removidos = podarGraded(gh, d[d.length - 1]);
  assert.ok(removidos > 0);
  assert.equal(gh.c.x["10"].length, gh.d.length);
  assert.equal(gh.c.x["9"].length, gh.d.length);
  gh.d.forEach((data, i) => assert.equal(gh.c.x["10"][i], d.indexOf(data)));
});

test("série vazia e de um ponto só não explodem", () => {
  assert.deepEqual(marcarMantidos([]), []);
  assert.deepEqual(marcarMantidos(["2026-09-19"]), [true]);
  const h = { d: [], c: {} };
  assert.equal(podarHistorico(h, "2026-09-19"), 0);
});

// ── O outro lado da entrega: o EIXO do gráfico ──────────────────────────────
// Guardar o passado com resolução menor só vale se o gráfico souber desenhar
// cadência mista. Até 19/09/2026 os dois gráficos do card plotavam por ÍNDICE
// (`X = i / (n-1)`), então um salto de um mês ficaria do mesmo tamanho que um
// de um dia — a série longa viraria mentira desenhada. Isto trava a régua única
// (eixoTemporal, no shared.js) que os dois passaram a usar.
import { loadShared } from "./lib/shared-sandbox.mjs";

const eixo = loadShared("window.__test = { eixoTemporal };").window.__test.eixoTemporal;
const W = 560, P = 6, UTIL = W - 2 * P;

test("eixo: a largura é proporcional ao TEMPO, não à posição na lista", () => {
  // Cadência mista real: 2 pontos mensais, depois 3 diários.
  const datas = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-03-02", "2026-03-03"];
  const { X } = eixo(datas, W, P);
  const span = (Date.parse("2026-03-03") - Date.parse("2026-01-01")) / 86400000; // 61 dias

  assert.equal(Math.round(X(0)), P, "o 1º ponto tem de encostar na margem esquerda");
  assert.equal(Math.round(X(4)), W - P, "o último ponto tem de encostar na margem direita");

  // Jan→Fev (31 dias) tem de ocupar ~31/61 da largura útil; os dois últimos
  // dias juntos, ~2/61 — e não 1/4 cada, como o eixo por índice daria.
  assert.ok(Math.abs((X(1) - X(0)) - (31 / span) * UTIL) < 0.5, "o salto mensal não é proporcional");
  assert.ok(Math.abs((X(4) - X(3)) - (1 / span) * UTIL) < 0.5, "o salto diário não é proporcional");
  // A prova direta: o intervalo de 31 dias tem de sair ~31x mais largo que o de
  // 1 dia. Por índice os dois sairiam IGUAIS (um passo cada) — é esse o bug.
  const razao = (X(1) - X(0)) / (X(4) - X(3));
  assert.ok(Math.abs(razao - 31) < 0.1, `o salto mensal deu ${razao.toFixed(2)}x o diário, esperado ~31x`);
});

test("eixo: série equidistante continua saindo equidistante (não regride o caso comum)", () => {
  const datas = diario(30);
  const { X } = eixo(datas, W, P);
  const passo = UTIL / (datas.length - 1);
  for (let i = 1; i < datas.length; i++) {
    assert.ok(Math.abs((X(i) - X(i - 1)) - passo) < 0.001, `passo ${i} fora do esperado`);
  }
});

test("eixo: pontoEmX acha o ponto mais próximo, não o da regra de três", () => {
  const datas = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-03-02", "2026-03-03"];
  const { X, pontoEmX } = eixo(datas, W, P);
  datas.forEach((_, i) => assert.equal(pontoEmX(X(i)), i, `o dedo em cima do ponto ${i} achou outro`));
  // No MEIO da largura o eixo temporal cai perto do ponto de fevereiro (dia 31
  // de 61); a regra de três antiga devolveria o índice 2.
  assert.equal(pontoEmX(P + UTIL / 2), 1);
});

test("eixo: um ponto só, ou todas as datas iguais, centraliza em vez de dividir por zero", () => {
  assert.equal(eixo(["2026-01-01"], W, P).X(0), P + UTIL / 2);
  const ig = eixo(["2026-01-01", "2026-01-01"], W, P);
  assert.equal(ig.X(0), P + UTIL / 2);
  assert.ok(Number.isFinite(ig.X(1)));
  assert.deepEqual(eixo([], W, P).X(0), P + UTIL / 2);
});

// ── Teto de bytes ───────────────────────────────────────────────────────────
import { caberEmBytes } from "../scripts/lib/price-history-retention.mjs";

test("teto de bytes: acervo que não cabe perde o ANTIGO, nunca a ponta recente", () => {
  const d = diario(2000);
  const serie = {
    v: 1, d: [...d],
    c: Object.fromEntries(Array.from({ length: 200 }, (_, k) =>
      [`c${k}`, { s: "u", p: d.map((_, i) => 1000 + i) }]))
  };
  const alvo = 300 * 1024;
  const r = caberEmBytes(serie, false, alvo);
  assert.ok(r.estourou);
  assert.ok(r.bytes <= alvo, `sobrou ${r.bytes} bytes, teto ${alvo}`);
  assert.equal(serie.d.length, d.length - r.removidos);
  assert.equal(serie.c.c0.p.length, serie.d.length, "série desalinhou das datas");
  // o fim (a janela recente) tem de estar intacto
  assert.equal(serie.d[serie.d.length - 1], d[d.length - 1]);
  assert.equal(serie.c.c0.p[serie.c.c0.p.length - 1], 1000 + d.length - 1);
});

test("teto de bytes: acervo que já cabe não é tocado", () => {
  const d = diario(10);
  const serie = { v: 1, d: [...d], c: { a: { s: "u", p: d.map((_, i) => i) } } };
  const r = caberEmBytes(serie, false);
  assert.equal(r.removidos, 0);
  assert.equal(r.estourou, false);
  assert.deepEqual(serie.d, d);
});

test("teto de bytes: acumulador graded corta cada nota junto", () => {
  const d = diario(1500);
  const serie = {
    v: 1, d: [...d],
    c: Object.fromEntries(Array.from({ length: 80 }, (_, k) =>
      [`c${k}`, { "10": d.map((_, i) => i), "9": d.map((_, i) => i + 1) }]))
  };
  const r = caberEmBytes(serie, true, 200 * 1024);
  assert.ok(r.estourou && r.bytes <= 200 * 1024);
  assert.equal(serie.c.c0["10"].length, serie.d.length);
  assert.equal(serie.c.c0["9"].length, serie.d.length);
});

// ── Id aposentado dentro do acervo ──────────────────────────────────────────
// O cel30 virou 30th em 18/09/2026 e a conta de quem marcou migrou; a série de
// preço tem de mudar de chave junto, senão a carta perde o gráfico e os deltas.
const MERGES = { prefixes: { cel30: "30th" }, cards: { "cel30cc-4": "30th-c-001" } };

test("id aposentado sem série nova: a série só muda de chave", () => {
  const serie = { v: 1, d: diario(3), c: { "cel30-001": { s: "u", p: [1, 2, 3] }, "sv01-050": { s: "u", p: [9, 9, 9] } } };
  assert.equal(migrarIdsDoHistorico(serie, MERGES, false), 1);
  assert.deepEqual(Object.keys(serie.c).sort(), ["30th-001", "sv01-050"]);
  assert.deepEqual(serie.c["30th-001"], { s: "u", p: [1, 2, 3] });
});

test("id aposentado com série nova: os buracos da nova recebem os pontos da velha (mesma fonte)", () => {
  const serie = { v: 1, d: diario(4), c: {
    "cel30-001": { s: "u", p: [1, 2, null, null] },      // o velho parou quando o set foi aposentado
    "30th-001": { s: "u", p: [null, null, 3, 4] },       // o novo nasceu no dia seguinte
    "cel30cc-4": { s: "e", p: [5, 5, null, null] },      // par a par, fonte DIFERENTE da nova
    "30th-c-001": { s: "u", p: [null, null, 7, 7] }
  } };
  assert.equal(migrarIdsDoHistorico(serie, MERGES, false), 2);
  assert.deepEqual(serie.c["30th-001"], { s: "u", p: [1, 2, 3, 4] });
  // Moedas diferentes não se misturam: a nova fica como está, a velha sai.
  assert.deepEqual(serie.c["30th-c-001"], { s: "u", p: [null, null, 7, 7] });
  assert.equal(serie.c["cel30-001"], undefined);
  assert.equal(serie.c["cel30cc-4"], undefined);
});

test("graded: migra por nota, e a nota que só a velha tinha viaja inteira", () => {
  const gh = { v: 1, d: diario(3), c: {
    "cel30-001": { "10": [100, 110, null], "9": [50, 50, null] },
    "30th-001": { "10": [null, null, 120] }
  } };
  assert.equal(migrarIdsDoHistorico(gh, MERGES, true), 1);
  assert.deepEqual(gh.c["30th-001"], { "10": [100, 110, 120], "9": [50, 50, null] });
});

test("sem de-para (ou sem acervo) é no-op", () => {
  const serie = { v: 1, d: diario(2), c: { "cel30-001": { s: "u", p: [1, 2] } } };
  assert.equal(migrarIdsDoHistorico(serie, null, false), 0);
  assert.equal(migrarIdsDoHistorico(serie, { prefixes: {}, cards: {} }, false), 0);
  assert.equal(migrarIdsDoHistorico(null, MERGES, false), 0);
  assert.deepEqual(Object.keys(serie.c), ["cel30-001"]);
});

test("entre cópias do acervo (R2, produção, cache) vence a mais adiantada", () => {
  const ontem = { v: 1, d: diario(5, "2026-09-18"), c: {} };
  const hoje = { v: 1, d: diario(6, "2026-09-19"), c: {} };
  const hojeCurta = { v: 1, d: diario(2, "2026-09-19"), c: {} };
  assert.equal(serieMaisAdiantada([ontem, hoje]), hoje);
  assert.equal(serieMaisAdiantada([hoje, ontem]), hoje);
  assert.equal(serieMaisAdiantada([hojeCurta, hoje]), hoje);   // mesma data: mais pontos
  assert.equal(serieMaisAdiantada([null, undefined, { d: "x" }, ontem]), ontem);
  assert.equal(serieMaisAdiantada([null, {}]), null);
});
