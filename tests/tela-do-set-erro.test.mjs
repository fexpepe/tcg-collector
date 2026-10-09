// A tela do set na borda não vira página de erro (2026-10-08). Qualquer
// exceção na decoração do /games/<jogo>/<set> (chunk ou mapa fora do formato,
// um caso que as peças não previram) subia da Function e virava a tela de erro
// da Cloudflare. Agora cai na casca crua do detail.html, que abre a mesma tela
// (o detail.js acha o set e a carta pelo endereço) — como a tela do jogo já fazia.
// Aqui a exceção vem de graça: o Node não tem o HTMLRewriter da borda.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/games/[[path]].js";

test("exceção ao decorar a tela do set devolve a casca crua do detail.html", async () => {
  const pedidos = [];
  const env = {
    ASSETS: {
      fetch: async (req) => {
        const url = new URL(req instanceof Request ? req.url : String(req));
        pedidos.push(url.pathname);
        if (url.pathname === "/data/game-pages/pokemon.json") return Response.json({ s: { "base-set": { n: "Base Set", f: ["data/sets/en/base1.json"] } } });
        if (url.pathname === "/data/sets/en/base1.json") return Response.json([{ id: "base1-4", name: "Charizard", number: "4", set: "Base Set", setId: "base1" }]);
        if (url.pathname === "/detail.html") return new Response('<html><head><meta name="sleevu-build" content="abc12345"></head><body>casca</body></html>', { headers: { "content-type": "text/html; charset=utf-8" } });
        return new Response("", { status: 404 });
      }
    }
  };
  const request = new Request("https://sleevu.app/games/pokemon/base-set");
  const r = await onRequestGet({ request, env, params: { path: ["pokemon", "base-set"] }, waitUntil() {}, next: async () => new Response("next") });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /casca/);
  assert.equal(pedidos.filter((p) => p === "/detail.html").length >= 2, true, "a casca crua foi pedida de novo como reserva");
});
