// Bancada sintética do Centering Tool (§10.3 do docs/PLANO-CENTERING-V2.md).
// FORA do CI: Monte Carlo com fotos sintéticas de verdade conhecida
// (tests/lib/carta-sintetica.mjs, com espessura de 0,30 mm), passando pelo
// MESMO caminho da interface — cantos com erro → refinaCantos → sugereLinhas →
// medir — e imprimindo média, p95 e máximo por cenário. O resultado vai no
// texto de cada PR que mexer no algoritmo.
//
//   node scripts/bench-centering.mjs              # 30 fotos por cenário (~2 min)
//   node scripts/bench-centering.mjs --n 200      # a rodada cheia do plano
//   node scripts/bench-centering.mjs --so toploader,20
//
// Colunas: erro |medido − verdade| em pp (L/R e T/B juntos, pelo "meio"),
// canto = pior dos 4 cantos depois do refino (px), ímã = linha solta a ±8 px
// (erro do encaixe em px), "≤2σ" = fração das medidas dentro de 2·σ_total
// exibido (a meta da §10.3 é ≥ 90%), ms = cantos → medida.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { cartaSintetica, rng } from "../tests/lib/carta-sintetica.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = {};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(raiz, "src", "centering-core.js"), "utf8"), sandbox);
const C = sandbox.window.TCGCenteringCore;

const arg = (nome, padrao) => { const i = process.argv.indexOf(nome); return i > 0 ? process.argv[i + 1] : padrao; };
const N = +arg("--n", 30);
const so = arg("--so", "");
const detalhe = process.argv.includes("--detalhe"); // imprime cada foto com erro > 1 pp

const R = rng(2026), U = (a, b) => a + (b - a) * R();
const margens = () => ({ L: U(1.5, 4.5), R: U(1.5, 4.5), T: U(1.5, 4.5), B: U(1.5, 4.5), alfa: U(-0.3, 0.3) });
const inclina = (a, b) => { const t = U(a, b), d = U(0, 2 * Math.PI); return { pitch: t * Math.cos(d), yaw: t * Math.sin(d) }; };

// Cada cenário: opções do gerador e o erro inicial dos cantos (fração da carta).
const CENARIOS = [
  ["frente (0–3°)", () => ({ ...inclina(0, 3), roll: U(-6, 6) }), 0.01],
  ["fase sub-px (0°, eixo reto)", () => ({ roll: 0, tx: U(-2, 2), ty: U(-2, 2) }), 0.01],
  ["10° (5–10°)", () => ({ ...inclina(5, 10), roll: U(-6, 6) }), 0.01],
  ["20° 2× (15–20°)", () => ({ ...inclina(15, 20), roll: U(-6, 6), f: 1600 }), 0.01],
  // folga desde 0,3 mm: o sleeve justo (perfect fit) é onde o refino ia pro
  // plástico com ok:true (revisão de 2026-10-02)
  ["toploader", () => ({ ...inclina(0, 10), roll: U(-5, 5), toploader: { mx: U(0.3, 4), my: U(0.3, 4) } }), 0.01],
  ["reflexo", () => ({ ...inclina(0, 8), roll: U(-5, 5), reflexo: { x: U(0.1, 0.9) * 800, y: U(0.1, 0.9) * 1066, rad: U(15, 40) } }), 0.01],
  ["lente k1 ±0,03", () => ({ ...inclina(0, 8), roll: U(-5, 5), k1: U(-0.03, 0.03) }), 0.01],
  ["borrão forte (σ 2–3)", () => ({ ...inclina(0, 8), roll: U(-5, 5), sigma: U(2, 3), ruido: U(2, 5) }), 0.01],
  ["600×800", () => ({ ...inclina(0, 10), roll: U(-5, 5), w: 600, h: 800 }), 0.01],
  ["cantos a ±2%", () => ({ ...inclina(0, 10), roll: U(-5, 5) }), 0.02],
  // borda branca com faixa clara logo depois da moldura e um elemento escuro
  // adiante (a One Piece da conferência visual de 2026-10-02): a moldura é a
  // saída da faixa da borda, e o lado vai pro "confira" (conta em falhas)
  ["borda clara, arte clara", () => ({ ...inclina(0, 8), roll: U(-5, 5), borda: [246, 246, 242], moldura: U(0.8, 1.4), corMoldura: [212, 226, 238], faixas: [{ de: 2.5, ate: 3.5, cor: [30, 22, 26] }] }), 0.01],
];

const est = (a) => {
  const s = a.map(Math.abs).filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return "—";
  const m = s.reduce((p, q) => p + q, 0) / s.length;
  return `${m.toFixed(3)} / ${s[Math.floor(0.95 * (s.length - 1))].toFixed(3)} / ${s[s.length - 1].toFixed(3)}`;
};

console.log(`Centering Tool — bancada sintética, ${N} fotos por cenário (média / p95 / máx)\n`);
console.log("cenário".padEnd(28), "erro pp".padEnd(22), "canto px".padEnd(22), "ímã px".padEnd(22), "≤2σ".padEnd(6), "falhas", "ms (méd)");
for (const [nome, gera, fracErro] of CENARIOS) {
  if (so && !so.split(",").some((s) => nome.includes(s))) continue;
  const erros = [], cantos = [], imas = [], ts = [];
  let dentro = 0, falhas = 0, total = 0;
  for (let i = 0; i < N; i++) {
    const o = { w: 800, h: 1066, ss: 2, seed: 1000 + i, sigma: U(0.7, 1.4), ruido: U(1.5, 4), ...margens(), ...gera() };
    const S = cartaSintetica(o);
    const e = fracErro * S.img.h * 0.75;
    const c0 = S.cantos.map(([x, y]) => [x + U(-e, e), y + U(-e, e)]);
    const t0 = performance.now();
    const rc = C.refinaCantos(S.img, c0, { janelaPx: Math.max(12, 2.5 * e) });
    const sug = C.sugereLinhas(S.img, rc.cantos);
    const pose = C.poseGraus(rc.cantos, S.img.w, S.img.h, S.focal35);
    const med = C.medir({ ext: sug.ext, int: sug.int }, {
      sigma: sug.sigma, cantos: rc.cantos, sigmaCantoPx: rc.sigmaPx, poseGraus: pose,
      foto: { w: S.img.w, h: S.img.h, focal35: S.focal35 },
    });
    ts.push(performance.now() - t0);
    total++;
    if (!rc.ok || sug.confere.length) falhas++;
    cantos.push(Math.max(...rc.cantos.map((p, k) => Math.hypot(p[0] - S.cantos[k][0], p[1] - S.cantos[k][1]))));
    for (const [ax, v] of [["lr", S.verdade.LR], ["tb", S.verdade.TB]]) {
      const d = med[ax].meio - v;
      erros.push(d);
      if (Math.abs(d) <= 2 * med[ax].sigma) dentro++;
      if (detalhe && Math.abs(d) > 1) console.log(`  ${nome} #${i} ${ax} erro ${d.toFixed(2)} pp, refino ${rc.ok}, confere [${sug.confere}]`, JSON.stringify({ ...o, c0 }));
    }
    // ímã: a moldura da esquerda solta a ±8 px da reta sugerida
    const und = (S.pxPorMm || 9) * 63, alvo = sug.int.l;
    for (const d of [-8, 8]) {
      const r = C.ima(S.img, rc.cantos, { lado: "l", tipo: "int", c: alvo.c + d / und, k: alvo.k }, { janela: 10 / und, ref: sug.ext.l.c });
      imas.push(r ? (r.c - alvo.c) * und : NaN);
    }
  }
  const media = ts.reduce((a, b) => a + b, 0) / ts.length;
  console.log(nome.padEnd(28), est(erros).padEnd(22), est(cantos).padEnd(22), est(imas).padEnd(22),
    `${Math.round((100 * dentro) / (2 * total))}%`.padEnd(6), String(falhas).padEnd(6), media.toFixed(1));
}
console.log("\nfalhas = refino recusado (ok=false) ou lado mandado conferir; o erro dessas fotos entra na conta mesmo assim.");
