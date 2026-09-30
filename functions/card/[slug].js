// /card/<slug> -> /games/<jogo>/<set>/<carta> (301). Até 2026-09-30 só as
// ~1.500 cartas mais caras e mais vistas tinham página, gerada no build em
// /card/<nome>-<número>. Hoje toda carta tem página na borda, em /games/.
//
// O mapa slug antigo -> endereço novo sai do prerender a cada build
// (data/game-pages/legado-cartas.json), recalculando o ranking e os slugs
// antigos com a mesma régua de antes. Carta que tinha página e saiu do
// ranking já dava 404 antes; continua dando.
import { naoAchou, redireciona, jsonDoSite, hasOwn } from "../_lib/borda.js";

export function destinoDaCartaAntiga(mapa, slug) {
  if (!mapa) return null;
  const s = String(slug || "").toLowerCase().replace(/\.html$/, "");
  return hasOwn(mapa, s) ? `/games/${mapa[s]}` : null;
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const mapa = await jsonDoSite(env, request, "/data/game-pages/legado-cartas.json");
  const destino = destinoDaCartaAntiga(mapa, params && params.slug);
  return destino ? redireciona(request, destino, 301) : naoAchou(env, request);
}
