// /sets — página de catálogo com vitrine (src/ads.js): serve o sets.html com a
// CSP de nonce que o AdSense exige. O porquê e as regras estão no
// functions/_vitrine-csp.js; a lista de páginas é a mesma da área "vitrine" do
// scripts/lib/css-areas.mjs (o tests/vitrine.test.mjs cruza as duas).
//
// Desde 2026-09-30 a tela de Sets de cada jogo mora em /games/<jogo>
// (functions/games/[[path]].js). Aqui ficam os dois caminhos antigos:
//   /sets?game=swu[&line=…]  -> 301 pro endereço do jogo. É o link que circula
//                               (hub antigo no cache do PWA, favoritos, o
//                               retorno do login, o Google).
//   /sets (sem jogo)         -> a tela como sempre, que abre no jogo da sessão.
//                               NÃO pode virar redirect: o service worker baixa
//                               "sets.html" na instalação e guarda o que vier,
//                               e é essa cópia que abre /games/<jogo> offline.
//                               Leva noindex: pro buscador, quem responde é
//                               /games e /games/<jogo>.
import { paginaComVitrine } from "./_vitrine-csp.js";
import { urlDoJogo } from "./_lib/jogos.js";

// Destino do /sets?game=… (ou null). O resto da query segue junto (?serie=).
export function destinoDoSets(endereco) {
  const u = new URL(endereco);
  const game = u.searchParams.get("game");
  if (!game) return null;
  const alvo = urlDoJogo(game, u.searchParams.get("line"));
  if (!alvo) return null;
  const resto = new URLSearchParams(u.search);
  resto.delete("game");
  resto.delete("line");
  const q = resto.toString();
  return `/games/${alvo}${q ? `?${q}` : ""}`;
}

export const onRequestGet = async (context) => {
  const destino = destinoDoSets(context.request.url);
  if (destino) return Response.redirect(new URL(destino, context.request.url).href, 301);
  const resposta = await paginaComVitrine(context, "/sets.html");
  if (resposta.status !== 200) return resposta;
  return new HTMLRewriter()
    .on("head", { element(el) { el.append('<meta name="robots" content="noindex, follow">', { html: true }); } })
    .transform(resposta);
};
