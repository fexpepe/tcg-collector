// CORS da borda pro app (Capacitor, mobile/) — 2026-10-09.
//
// O app roda o código do site servido de DENTRO do aparelho, numa origem que
// não é o sleevu.app: capacitor://localhost no iOS e https://localhost no
// Android (os padrões do Capacitor 8; o mobile/capacitor.config.json não os
// troca). A ponte do app (mobile/web/app-nativo.js) manda os pedidos de /api
// pra cá, e o WebView só entrega a resposta ao código se ela disser que
// aquela origem pode lê-la.
//
// Só as duas origens do app, e não `*`: a busca e a coleção leem o D1, onde
// linha lida é linha cobrada — `*` deixaria qualquer site usar a API como
// backend dele, pelos navegadores dos visitantes. (O catálogo estático em
// /data/* é outra história: arquivo público, sem custo por leitura, e o
// _headers não sabe responder por origem — lá vai `*`.)
//
// Pura de propósito (tests/cors-app.test.mjs): o middleware só a chama.
export const ORIGENS_DO_APP = ["capacitor://localhost", "https://localhost"];

export function origemDoApp(origem) {
  return ORIGENS_DO_APP.includes(origem) ? origem : null;
}

// Resposta ao preflight (OPTIONS). O app manda POST com Content-Type JSON pro
// /api/collection, o que obriga o preflight; GET simples não passa por aqui.
// null = não é pedido do app (segue o caminho normal da Function).
export function preflightDoApp(request) {
  const origem = origemDoApp(request.headers.get("Origin"));
  if (request.method !== "OPTIONS" || !origem) return null;
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origem,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    }
  });
}

// A resposta da Function com a licença de leitura pra origem do app. Pedido do
// site (mesma origem, sem Origin ou com outro) volta exatamente como veio.
export function comCorsDoApp(resposta, request) {
  const origem = origemDoApp(request.headers.get("Origin"));
  if (!origem) return resposta;
  const r = new Response(resposta.body, resposta);
  r.headers.set("Access-Control-Allow-Origin", origem);
  r.headers.append("Vary", "Origin");
  return r;
}
