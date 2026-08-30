// Câmbio stale-while-revalidate e o ponto do dia no histórico.
//
// Por que este teste existe: o valor da coleção passa pelo câmbio mesmo pra
// quem usa BRL (a maioria das cartas é cotada em USD/EUR). Gravar o ponto de
// hoje com a cotação de ontem registra no gráfico do Portfólio uma "variação"
// que é só ruído de dólar — e o chip "+R$ X hoje" a anuncia como se fosse
// mercado. O guard do recordValueSnapshot existe pra isso, e um `return` a
// menos ali volta a contaminar o histórico em silêncio.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared, makeLocalStorage } from "./lib/shared-sandbox.mjs";

const HOJE = new Date().toISOString().slice(0, 10);
const KEY_PK = "tcg-collector-pokemon-history-v2";
const HORA = 3600000;

// Semeia o cache de câmbio com uma idade escolhida.
function comCambioDe(horasAtras) {
  const ls = makeLocalStorage({
    "tcg-fx-brl-v1": JSON.stringify({ t: Date.now() - horasAtras * HORA, r: { USD: 5.4, EUR: 5.9 } })
  });
  const sb = loadShared("window.__test = { recordValueSnapshot, valueHistory };", { localStorage: ls });
  sb.document.cookie = "";
  return { api: sb.window.__test, ls };
}

const pontoDeHoje = (ls) => JSON.parse(ls.getItem(KEY_PK) || "[]").find((p) => p.d === HOJE);

test("câmbio de hoje: o ponto do dia é gravado", () => {
  const { api, ls } = comCambioDe(2);
  api.recordValueSnapshot({ pokemon: { raw: 1000, graded: 0, wish: 0 } });
  assert.equal(pontoDeHoje(ls)?.c, 1000);
});

test("câmbio vencido (30h): NÃO grava — o ponto entra na carga seguinte, já com a cotação fresca", () => {
  const { api, ls } = comCambioDe(30);
  api.recordValueSnapshot({ pokemon: { raw: 1000, graded: 0, wish: 0 } });
  assert.equal(pontoDeHoje(ls), undefined, "ponto do dia não pode nascer de câmbio vencido");
});

test("câmbio velho demais (8 dias): grava assim mesmo — gráfico vazio é pior que ponto ruidoso", () => {
  const { api, ls } = comCambioDe(8 * 24);
  api.recordValueSnapshot({ pokemon: { raw: 1000, graded: 0, wish: 0 } });
  assert.equal(pontoDeHoje(ls)?.c, 1000, "a válvula existe pra API de câmbio fora do ar por dias");
});

test("sem cache de câmbio nenhum: grava (1ª visita, nada a contaminar)", () => {
  const ls = makeLocalStorage({});
  const sb = loadShared("window.__test = { recordValueSnapshot };", { localStorage: ls });
  sb.document.cookie = "";
  sb.window.__test.recordValueSnapshot({ pokemon: { raw: 1000, graded: 0, wish: 0 } });
  assert.equal(pontoDeHoje(ls)?.c, 1000);
});
