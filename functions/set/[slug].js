// /set/<slug> -> /games/<jogo>/<set> (301). As páginas de set moraram em /set/
// até 2026-09-30, num diretório plano pra todos os jogos (por isso os slugs
// levavam -2 quando dois jogos tinham um set com o mesmo nome). Os endereços
// velhos seguem no índice dos buscadores, em links e no cache do PWA de quem já
// abriu; o 301 leva todos pro endereço novo, e o buscador transfere o que a
// página já tinha.
//
// O mapa slug antigo -> endereço novo sai do prerender a cada build
// (data/game-pages/legado-sets.json), calculado com a MESMA régua que gerava
// os slugs antigos. A variante em inglês (<slug>-en) segue o mesmo caminho.
import { naoAchou, redireciona, jsonDoSite, hasOwn } from "../_lib/borda.js";

export function destinoDoSetAntigo(mapa, slug) {
  if (!mapa) return null;
  const s = String(slug || "").toLowerCase().replace(/\.html$/, "");
  if (hasOwn(mapa, s)) return `/games/${mapa[s]}`;
  const en = /^(.+)-en$/.exec(s);
  if (en && hasOwn(mapa, en[1])) return `/games/${mapa[en[1]]}-en`;
  return null;
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const mapa = await jsonDoSite(env, request, "/data/game-pages/legado-sets.json");
  const destino = destinoDoSetAntigo(mapa, params && params.slug);
  return destino ? redireciona(request, destino, 301) : naoAchou(env, request);
}
