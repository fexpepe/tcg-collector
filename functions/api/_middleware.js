// Middleware de /api/* (Cloudflare Pages Functions): libera a leitura das
// respostas pro app (capacitor://localhost e https://localhost). A regra e o
// porquê estão em functions/_lib/cors-app.js. Roda na MESMA execução da
// Function (não é uma chamada a mais na conta) e não muda nada pro site.
import { preflightDoApp, comCorsDoApp } from "../_lib/cors-app.js";

export async function onRequest(context) {
  const preflight = preflightDoApp(context.request);
  if (preflight) return preflight;
  return comCorsDoApp(await context.next(), context.request);
}
