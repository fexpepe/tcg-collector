// Câmbio de reserva (2026-10-03, docs/PLANO-TECNICO.md S2). O build grava
// data/fx.generated.json e o shared.js cai nele quando a AwesomeAPI nega. Um
// parser errado aqui é pior que não ter reserva: o preço em R$ sairia com um
// câmbio inventado, calado. Por isso cada fonte é conferida contra a resposta
// real (formato de 02/10/2026) e a faixa de sanidade barra o resto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cotacaoSa, daAwesome, daPtax, daFrankfurter } from "../scripts/build-fx.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

test("PTAX: vale o boletim mais recente, na compra", () => {
  const usd = { value: [
    { cotacaoCompra: 5.2356, cotacaoVenda: 5.2362, dataHoraCotacao: "2026-10-02 12:08:11.740", tipoBoletim: "Intermediário" },
    { cotacaoCompra: 5.2232, cotacaoVenda: 5.2238, dataHoraCotacao: "2026-10-02 13:03:16.256", tipoBoletim: "Fechamento" },
    { cotacaoCompra: 5.30, cotacaoVenda: 5.31, dataHoraCotacao: "2026-10-01 13:03:00.000", tipoBoletim: "Fechamento" }
  ] };
  const eur = { value: [{ cotacaoCompra: 5.8803, cotacaoVenda: 5.8815, dataHoraCotacao: "2026-10-02 13:03:16.256", tipoBoletim: "Fechamento" }] };
  assert.deepEqual(daPtax(usd, eur), { r: { USD: 5.2232, EUR: 5.8803 }, d: "2026-10-02" });
  assert.equal(daPtax({ value: [] }, eur), null, "sem boletim de dólar não há reserva");
});

test("Frankfurter (base USD): EUR em reais sai da divisão", () => {
  const x = daFrankfurter({ amount: 1, base: "USD", date: "2026-10-02", rates: { BRL: 5.2214, EUR: 0.89087 } });
  assert.equal(x.r.USD, 5.2214);
  assert.equal(x.r.EUR, 5.861); // 5.2214 / 0.89087, 4 casas
  assert.equal(x.d, "2026-10-02");
});

test("AwesomeAPI: o bid, como no navegador", () => {
  assert.deepEqual(daAwesome({ USDBRL: { bid: "5.40" }, EURBRL: { bid: "6.30" } }), { USD: 5.4, EUR: 6.3 });
  assert.equal(daAwesome({ status: 429, code: "QuotaExceeded" }), null);
});

test("faixa de sanidade barra câmbio absurdo (API quebrada, campo trocado)", () => {
  assert.ok(cotacaoSa({ USD: 5.2, EUR: 5.9 }));
  assert.ok(!cotacaoSa({ USD: 0.19, EUR: 0.17 }), "BRL→USD invertido");
  assert.ok(!cotacaoSa({ USD: 5200, EUR: 5900 }));
  assert.ok(!cotacaoSa({ USD: NaN, EUR: 5.9 }));
  assert.ok(!cotacaoSa(null));
});

test("o deploy gera a reserva e o shared.js cai nela quando a API falha", () => {
  const deploy = readFileSync(join(raiz, ".github", "workflows", "deploy.yml"), "utf8");
  const shared = readFileSync(join(raiz, "src", "shared.js"), "utf8");
  assert.match(deploy, /run: node scripts\/build-fx\.mjs/);
  const iMin = deploy.indexOf("- name: Minifica JS e CSS"), iFx = deploy.indexOf("run: node scripts/build-fx.mjs");
  assert.ok(iFx > 0 && iFx < iMin, "a reserva tem de existir antes do deploy subir");
  assert.match(shared, /fetch\("data\/fx\.generated\.json"\)/);
  assert.match(shared, /logClientError\(`câmbio: /, "a falha do câmbio precisa chegar ao /admin, com o aparelho");
});
