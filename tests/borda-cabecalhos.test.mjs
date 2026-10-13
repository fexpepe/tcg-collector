// Peças da borda revistas em 2026-10-13 (functions/_lib/borda.js e
// functions/_vitrine-csp.js). O que se trava aqui:
//   - a 404 montada por Function leva os cabeçalhos de segurança do asset
//     (CSP, frame-ancestors…) e não os que descrevem o corpo original;
//   - HEAD responde o mesmo status e cabeçalhos do GET, sem corpo (antes o
//     Pages dava 404 em /blog/<post>, /set/<slug> e /card/<slug>);
//   - a casca da tela é pedida sem Range nem condicionais (um 206 ia parar,
//     cortado, no cache da borda da tela do set).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { naoAchou, headDoGet, cabecalhosDoAsset } from "../functions/_lib/borda.js";
import { notFound } from "../functions/users/_perfil.js";
import { buscaPagina } from "../functions/_vitrine-csp.js";
import { onRequestHead as headDoFeed } from "../functions/blog/feed.xml.js";

const CSP = "default-src 'self'; frame-ancestors 'none'";
const asset404 = () => new Response("<h1>404</h1>", {
  headers: {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": CSP,
    "x-frame-options": "DENY",
    "etag": "\"abc\"",
    "content-encoding": "br"
  }
});
const env = { ASSETS: { fetch: async () => asset404() } };
const request = new Request("https://sleevu.app/games/pokemon/nao-existe");

test("404 da borda leva a CSP e o frame-ancestors do asset", async () => {
  for (const r of [await naoAchou(env, request), await notFound(env, request)]) {
    assert.equal(r.status, 404);
    assert.equal(r.headers.get("content-security-policy"), CSP);
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("content-encoding"), null, "o corpo daqui já vem decodificado");
    assert.equal(r.headers.get("etag"), null);
    assert.match(await r.text(), /404/);
  }
  assert.equal(cabecalhosDoAsset(new Response("x")).get("content-type"), "text/plain;charset=UTF-8");
  assert.equal(cabecalhosDoAsset({ headers: new Headers() }).get("content-type"), "text/html; charset=utf-8");
});

test("HEAD: mesmo status e cabeçalhos do GET, sem corpo", async () => {
  const head = headDoGet(async () => new Response("corpo", { status: 301, headers: { location: "/games/pokemon" } }));
  const r = await head({});
  assert.equal(r.status, 301);
  assert.equal(r.headers.get("location"), "/games/pokemon");
  assert.equal(await r.text(), "");
  assert.equal(typeof headDoFeed, "function", "o feed do blog também responde HEAD");
});

test("a casca é pedida inteira: sem Range nem condicionais", async () => {
  let pedido = null;
  const envCasca = { ASSETS: { fetch: async (req) => { pedido = req; return new Response("ok"); } } };
  const req = new Request("https://sleevu.app/games/pokemon/base-set", {
    headers: { range: "bytes=0-100", "if-range": "\"x\"", "if-none-match": "\"x\"", "if-modified-since": "Mon, 01 Jan 2024 00:00:00 GMT", "if-match": "\"x\"", "if-unmodified-since": "Mon, 01 Jan 2024 00:00:00 GMT", "accept-language": "pt-BR" }
  });
  await buscaPagina(envCasca, req, "/detail.html");
  assert.equal(new URL(pedido.url).pathname, "/detail.html");
  for (const h of ["range", "if-range", "if-none-match", "if-modified-since", "if-match", "if-unmodified-since"]) assert.equal(pedido.headers.get(h), null, h);
  assert.equal(pedido.headers.get("accept-language"), "pt-BR", "o resto segue");
});
