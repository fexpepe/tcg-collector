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
//
// O mapa sai do nome de HOJE: set renomeado depois do /set/ perdia o 301
// (2026-10-08, os Starter Decks do One Piece davam 404). A maioria ganhou só
// um prefixo e o setRenomeado acha; os de baixo mudaram no meio do nome.
import { naoAchou, redireciona, jsonDoSite, hasOwn, setRenomeado } from "../_lib/borda.js";

// Slug antigo -> chave de hoje no legado-sets.json (renomeados pelo TCGCSV em
// 30/09/2026).
const RENOMEADOS = {
  "starter-deck-ex-gear-5": "st-21-starter-deck-21-ex-gear-5",
  "starter-deck-ex-luffy-ace": "st-30-starter-deck-30-ex-luffy-ace",
  "super-pre-release-starter-deck-1-straw-hat-crew": "st-01-starter-deck-1-straw-hat-crew-super-pre-release-edition",
  "super-pre-release-starter-deck-2-worst-generation": "st-02-starter-deck-2-worst-generation-super-pre-release-edition",
  "super-pre-release-starter-deck-3-the-seven-warlords-of-the-sea": "st-03-starter-deck-3-the-seven-warlords-of-the-sea-super-pre-release-edition",
  "super-pre-release-starter-deck-4-animal-kingdom-pirates": "st-04-starter-deck-4-animal-kingdom-pirates-super-pre-release-edition"
};

export function destinoDoSetAntigo(mapa, slug) {
  if (!mapa) return null;
  const acha = (k) => {
    if (hasOwn(mapa, k)) return mapa[k];
    const hoje = hasOwn(RENOMEADOS, k) ? RENOMEADOS[k] : setRenomeado(Object.keys(mapa), k);
    return hoje && hasOwn(mapa, hoje) ? mapa[hoje] : null;
  };
  const s = String(slug || "").toLowerCase().replace(/\.html$/, "");
  const direto = acha(s);
  if (direto) return `/games/${direto}`;
  const en = /^(.+)-en$/.exec(s);
  const doEn = en && acha(en[1]);
  return doEn ? `/games/${doEn}-en` : null;
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const mapa = await jsonDoSite(env, request, "/data/game-pages/legado-sets.json");
  const destino = destinoDoSetAntigo(mapa, params && params.slug);
  return destino ? redireciona(request, destino, 301) : naoAchou(env, request);
}
