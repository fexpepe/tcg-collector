// /card/<slug> -> /games/<jogo>/<set>/<carta> (301). Até 2026-09-30 só as
// ~1.500 cartas mais caras e mais vistas tinham página, gerada no build em
// /card/<nome>-<número>. Hoje toda carta tem página na borda, em /games/.
//
// O mapa slug antigo -> endereço novo sai do prerender a cada build
// (data/game-pages/legado-cartas/<letra>.json), com a mesma régua de slug de
// antes. Até 2026-10-08 ele recalculava também o RANKING, com o preço do dia:
// carta que saía das 1.500 mais caras perdia o 301, e 906 das 1.269 cartas
// que o sitemap de julho listava davam 404. Agora ele leva TODA carta dos três
// jogos que tinham página (Pokémon, Lorcana e One Piece), em fatias pela 1ª
// letra do slug (ver fatiaDoLegado).
import { naoAchou, redireciona, jsonDoSite, hasOwn, fatiaDoLegado } from "../_lib/borda.js";

const limpa = (slug) => String(slug || "").toLowerCase().replace(/\.html$/, "");

// A fatia do mapa onde mora o slug (null: slug que nenhuma fatia teria).
export function arquivoDaCartaAntiga(slug) {
  const fatia = fatiaDoLegado(limpa(slug));
  return fatia ? `/data/game-pages/legado-cartas/${fatia}.json` : null;
}

export function destinoDaCartaAntiga(mapa, slug) {
  if (!mapa) return null;
  const s = limpa(slug);
  return hasOwn(mapa, s) ? `/games/${mapa[s]}` : null;
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const arquivo = arquivoDaCartaAntiga(params && params.slug);
  const mapa = arquivo ? await jsonDoSite(env, request, arquivo) : null;
  const destino = destinoDaCartaAntiga(mapa, params && params.slug);
  return destino ? redireciona(request, destino, 301) : naoAchou(env, request);
}
