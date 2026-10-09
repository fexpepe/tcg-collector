// CORS da borda pro app (functions/_lib/cors-app.js + functions/api/_middleware.js):
// só as origens do Capacitor leem a API; o site segue igual.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ORIGENS_DO_APP, origemDoApp, preflightDoApp, comCorsDoApp } from "../functions/_lib/cors-app.js";
import { onRequest } from "../functions/api/_middleware.js";

const pedido = (method, origem) => new Request("https://sleevu.app/api/collection", {
  method, headers: origem ? { Origin: origem } : {}
});

test("as duas origens do app, e só elas", () => {
  assert.deepEqual(ORIGENS_DO_APP, ["capacitor://localhost", "https://localhost"]);
  assert.equal(origemDoApp("capacitor://localhost"), "capacitor://localhost");
  assert.equal(origemDoApp("https://localhost"), "https://localhost");
  for (const o of ["https://sleevu.app", "http://localhost", "https://localhost:8080", "https://golpe.com", "null", "", null]) {
    assert.equal(origemDoApp(o), null, String(o));
  }
});

test("preflight do app responde 204 com POST e Content-Type; o resto segue pra Function", () => {
  const r = preflightDoApp(pedido("OPTIONS", "capacitor://localhost"));
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "capacitor://localhost");
  assert.match(r.headers.get("Access-Control-Allow-Methods"), /POST/);
  assert.match(r.headers.get("Access-Control-Allow-Headers"), /Content-Type/);
  assert.equal(preflightDoApp(pedido("OPTIONS", "https://golpe.com")), null);
  assert.equal(preflightDoApp(pedido("POST", "capacitor://localhost")), null);
});

test("resposta da Function: licença só pra origem do app, corpo e status intactos", async () => {
  const original = () => new Response(JSON.stringify({ c: {} }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  const doApp = comCorsDoApp(original(), pedido("POST", "https://localhost"));
  assert.equal(doApp.headers.get("Access-Control-Allow-Origin"), "https://localhost");
  assert.match(doApp.headers.get("Vary"), /Origin/);
  assert.equal(doApp.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await doApp.json(), { c: {} });
  const doSite = original();
  assert.equal(comCorsDoApp(doSite, pedido("POST", null)), doSite, "pedido do site volta o MESMO objeto");
  assert.equal(comCorsDoApp(original(), pedido("POST", "https://golpe.com")).headers.get("Access-Control-Allow-Origin"), null);
});

test("middleware: preflight não chega na Function; GET/POST passam por ela", async () => {
  let chamou = 0;
  const next = async () => { chamou++; return new Response("ok", { status: 200 }); };
  const pre = await onRequest({ request: pedido("OPTIONS", "capacitor://localhost"), next });
  assert.equal(pre.status, 204);
  assert.equal(chamou, 0);
  const r = await onRequest({ request: pedido("POST", "capacitor://localhost"), next });
  assert.equal(chamou, 1);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "capacitor://localhost");
  assert.equal(await r.text(), "ok");
});
