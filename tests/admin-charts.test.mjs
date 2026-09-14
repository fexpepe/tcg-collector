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
