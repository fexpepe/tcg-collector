// Gráficos do /admin (src/admin.js): o arquivo desenha SVG na mão, sem
// biblioteca, e o treemap "squarified" é o único pedaço com matemática de
// verdade — um erro nele não quebra a página, só mostra um mosaico mentiroso
// (área desproporcional ao valor, retângulo saindo da caixa). Este teste
// carrega o admin.js sem o shared.js (ele expõe window.TCGAdminCharts antes do
// guard e sai) e confere as invariantes que valem pra qualquer entrada.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

function carrega() {
  const src = readFileSync(join(raiz, "src", "admin.js"), "utf8");
  const window = { document: { getElementById: () => null }, location: { hash: "" } };
  const sandbox = { window, document: window.document, location: window.location, history: {}, console };
  vm.runInNewContext(src, sandbox);
  assert.ok(sandbox.window.TCGAdminCharts, "admin.js não expôs TCGAdminCharts");
  return sandbox.window.TCGAdminCharts;
}
const C = carrega();

test("squarify: área proporcional ao valor, tudo dentro da caixa, sem sobreposição", () => {
  const vals = [50, 25, 12, 8, 3, 2];
  const W = 640, H = 320;
  const rects = C.squarify(vals, 0, 0, W, H);
  assert.equal(rects.length, vals.length);
  const total = vals.reduce((a, b) => a + b, 0);
  let soma = 0;
  for (const r of rects) {
    assert.ok(r.x >= -1e-6 && r.y >= -1e-6 && r.x + r.w <= W + 1e-6 && r.y + r.h <= H + 1e-6, `fora da caixa: ${JSON.stringify(r)}`);
    const esperada = (vals[r.i] / total) * W * H;
    assert.ok(Math.abs(r.w * r.h - esperada) < 1e-6, `área do item ${r.i}: ${r.w * r.h} ≠ ${esperada}`);
    soma += r.w * r.h;
  }
  assert.ok(Math.abs(soma - W * H) < 1e-6, "as áreas não preenchem a caixa");
  for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
    const p = rects[a], q = rects[b];
    const cruza = p.x < q.x + q.w - 1e-6 && q.x < p.x + p.w - 1e-6 && p.y < q.y + q.h - 1e-6 && q.y < p.y + p.h - 1e-6;
    assert.ok(!cruza, `retângulos ${p.i} e ${q.i} se sobrepõem`);
  }
});

test("squarify: zeros e negativos somem, entrada vazia devolve vazio", () => {
  // JSON.stringify porque os arrays nascem no contexto do vm (outro Array).
  assert.equal(JSON.stringify(C.squarify([], 0, 0, 100, 100)), "[]");
  assert.equal(JSON.stringify(C.squarify([0, 0], 0, 0, 100, 100)), "[]");
  const r = C.squarify([0, 10, -5, 30], 0, 0, 100, 100);
  assert.equal(JSON.stringify(r.map((x) => x.i).sort()), "[1,3]");
  // Um item só ocupa a caixa inteira.
  const um = C.squarify([7], 5, 5, 90, 40);
  assert.equal(JSON.stringify(um), JSON.stringify([{ i: 0, x: 5, y: 5, w: 90, h: 40 }]));
});

test("squarify: razão de aspecto fica razoável (é o que 'squarified' promete)", () => {
  const vals = Array.from({ length: 12 }, (_, i) => 100 - i * 7);
  const rects = C.squarify(vals, 0, 0, 640, 320);
  const pior = Math.max(...rects.map((r) => Math.max(r.w / r.h, r.h / r.w)));
  assert.ok(pior < 4, `pior razão de aspecto ${pior.toFixed(2)} — um mosaico de tiras`);
});

test("donut: soma dos arcos fecha o círculo e 100% num item só não degenera", () => {
  const html = C.donut([{ label: "A", value: 3 }, { label: "B", value: 1 }]);
  const dashes = [...html.matchAll(/stroke-dasharray="([\d.]+) ([\d.]+)"/g)].map((m) => Number(m[1]));
  const C0 = Number(dashes[0]) + Number(/stroke-dasharray="[\d.]+ ([\d.]+)"/.exec(html)[1]);
  assert.ok(Math.abs(dashes.reduce((a, b) => a + b, 0) - C0) < 0.05, "os arcos não somam a circunferência");
  assert.ok(html.includes("75%") && html.includes("25%"), "legenda sem as porcentagens");
  const solo = C.donut([{ label: "Só", value: 5 }, { label: "Zero", value: 0 }]);
  assert.equal((solo.match(/<circle /g) || []).length, 1, "item zerado não deveria virar arco");
  assert.ok(!solo.includes("Zero"), "item zerado não deveria aparecer na legenda");
  assert.ok(C.donut([]).includes("Sem dados"), "vazio precisa dizer que está vazio");
});

test("dailyBars: empilha gente e robô, e escapa o que vem do banco", () => {
  const html = C.dailyBars([{ day: "2026-09-01", views: 10, bots: 5 }, { day: "2026-09-02", views: 0, bots: 0 }]);
  assert.equal((html.match(/class="adm-bar-a"/g) || []).length, 2);
  assert.equal((html.match(/class="adm-bar-b"/g) || []).length, 1, "dia sem robô não desenha barra de robô");
  const alt = C.dailyBars([{ day: "<x>", views: 1, bots: 0 }]);
  assert.ok(alt.includes("&lt;x&gt;") && !alt.includes("<x>"), "day sem escape");
});

test("hbars e funnel: largura proporcional e escape de rótulos", () => {
  const h = C.hbars([{ label: "a&b", value: 10 }, { label: "c", value: 5 }]);
  assert.ok(h.includes("width:100.0%") && h.includes("width:50.0%"));
  assert.ok(h.includes("a&amp;b"));
  const f = C.funnel([{ label: "visitantes", value: 200 }, { label: "logados", value: 50 }]);
  assert.ok(f.includes("width:100.0%") && f.includes("width:25.0%"));
  assert.ok(f.includes("25%"), "funil sem a porcentagem do passo");
});

// ── Kit para parceiros (2026-09-29) ──────────────────────────────────────────
// O kit é o PDF que sai do painel pra loja, anunciante e investidor. Os
// números dele passam por estes três helpers, e um erro aqui vai pro papel.
test("niceMax: teto redondo e justo pro eixo (sem metade do gráfico vazia)", () => {
  const casos = [[0, 1], [1, 1], [95, 100], [1200, 1200], [1201, 1500], [5214, 6000], [60000, 60000], [99999, 100000]];
  for (const [v, esperado] of casos) assert.equal(C.niceMax(v), esperado, `niceMax(${v})`);
  for (let v = 1; v < 1e6; v = Math.ceil(v * 1.37)) {
    const t = C.niceMax(v);
    assert.ok(t >= v && t <= v * 1.5 + 1e-9, `niceMax(${v}) = ${t}: fora de [v, 1,5v]`);
  }
});

test("compacto: exato abaixo do corte, três dígitos acima, R$ quando é moeda", () => {
  assert.equal(C.compacto(5214), "5.214", "abaixo de 100 mil fica exato");
  assert.equal(C.compacto(99999), "99.999");
  assert.equal(C.compacto(422000), "422 mil");
  assert.equal(C.compacto(4360000), "4,36 mi");
  assert.equal(C.compacto(12500000), "12,5 mi");
  assert.equal(C.compacto(9800, true), "R$ 9.800", "moeda: exato abaixo de 10 mil");
  assert.equal(C.compacto(612400, true), "R$ 612 mil");
  assert.equal(C.compacto(4360000, true), "R$ 4,36 mi");
  assert.equal(C.compacto(null), "—");
  assert.equal(C.compacto(undefined, true), "—");
  assert.ok(!/ /.test(C.compacto(422000)), "espaço duro do Intl vira espaço comum");
});

test("area: desenha dentro da caixa, rotula o dia 1 de cada mês e marca o último valor", () => {
  const pts = Array.from({ length: 70 }, (_, i) => ({ day: new Date(Date.UTC(2026, 6, 20 + i)).toISOString().slice(0, 10), v: 1000 + i * 10 }));
  const svg = C.area(pts, { w: 600, h: 150 });
  assert.ok(svg.startsWith("<svg") && svg.includes('viewBox="0 0 600 150"'));
  const d = /<path d="([^"]+)" fill="none"/.exec(svg)[1];
  for (const [, x, y] of d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)) {
    assert.ok(Number(x) >= 0 && Number(x) <= 600 && Number(y) >= 0 && Number(y) <= 150, `ponto fora da caixa: ${x},${y}`);
  }
  // 20/07 → 27/09: viram agosto e setembro.
  assert.deepEqual([...svg.matchAll(/class="adm-axis">([a-zç]+)</g)].map((m) => m[1]), ["ago", "set"]);
  assert.ok(svg.includes(">1.690</text>"), "o último valor tem de vir escrito");
  // Último ponto no teto (1.200 com teto 1.200): o número vai pra baixo do
  // ponto, não pra fora da caixa.
  const teto = C.area([{ day: "2026-09-01", v: 600 }, { day: "2026-09-02", v: 1200 }], { w: 600, h: 150 });
  const yUlt = Number(/y="([\d.]+)" text-anchor="end" class="adm-kit-area-ult"/.exec(teto)[1]);
  assert.ok(yUlt >= 14, `rótulo do último valor fora da caixa (y=${yUlt})`);
  assert.equal(C.area([{ day: "2026-01-01", v: 3 }]), "", "um ponto só não é série");
  assert.equal(C.area([{ day: "2026-01-01", v: null }, { day: "2026-01-02", v: 4 }]), "", "ponto sem valor não conta");
});

test("kit: o tamanho do catálogo é o mesmo da home e do og-image", () => {
  // "240.000+" (home), "240 mil+" (og-image e kit), "2.200+": a mesma conta
  // escrita de três jeitos. Recontou o catálogo? Muda nos três lugares.
  const numero = (t) => {
    const m = /([\d.]+)\s*(mil)?/.exec(t);
    return Number(m[1].replace(/\./g, "")) * (m[2] ? 1000 : 1);
  };
  const admin = readFileSync(join(raiz, "src", "admin.js"), "utf8");
  const kit = /const KIT_CATALOGO = \{ cartas: "([^"]+)", sets: "([^"]+)" \}/.exec(admin);
  assert.ok(kit, "sumiu o KIT_CATALOGO do src/admin.js");
  const home = readFileSync(join(raiz, "index.html"), "utf8");
  const og = readFileSync(join(raiz, "scripts", "og", "og-image.html"), "utf8");
  const daHome = (chave) => new RegExp(`<strong>([^<]+)</strong><span data-i18n="home\\.lp\\.${chave}"`).exec(home)[1];
  const doOg = (rotulo) => new RegExp(`<strong>([^<]+)</strong><span>${rotulo}`).exec(og)[1];
  assert.equal(numero(kit[1]), numero(daHome("statCards")), "cartas: kit ≠ home");
  assert.equal(numero(kit[1]), numero(doOg("cartas catalogadas")), "cartas: kit ≠ og-image");
  assert.equal(numero(kit[2]), numero(daHome("statSets")), "sets: kit ≠ home");
  assert.equal(numero(kit[2]), numero(doOg("sets")), "sets: kit ≠ og-image");
});
