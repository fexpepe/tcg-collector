// Cloudflare Pages Function: /en/ — a home em inglês (2026-11-28).
//
// A página é a MESMA home (index.html) com título, descrição, Open Graph,
// canonical, JSON-LD e os textos visíveis em inglês já no HTML, pra o robô sem
// JS (e o que lê em inglês antes de o i18n chegar) ver inglês. O porquê, o
// desenho e o motivo do endereço terminar em barra estão em
// functions/_lib/home-en.js; o texto em inglês, em home-en-textos.js (gerado).
//
//   /en/  -> a home em inglês
//   /en   -> 301 pra /en/
//
// O hreflang (pt-BR → /, en → /en/, x-default → /en/) mora no index.html e
// vale pras duas. Quem chega aqui sem idioma escolhido abre o app em inglês; a
// escolha salva vence (src/theme.js, data-idioma-padrao).
import { cabecalhosDoAsset, redireciona, headDoGet } from "./_lib/borda.js";
import { buscaPagina } from "./_vitrine-csp.js";
import { traduzHomeEn, CAMINHO_EN } from "./_lib/home-en.js";
import { TEXTOS_HOME_EN } from "./_lib/home-en-textos.js";

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  if (url.pathname !== CAMINHO_EN) return redireciona(request, CAMINHO_EN + url.search, 301);
  // A casca é a home de produção (com os nomes de arquivo com hash do build).
  const casca = await buscaPagina(env, request, "/");
  if (casca.status !== 200) return casca;
  const headers = cabecalhosDoAsset(casca);
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(traduzHomeEn(await casca.text(), TEXTOS_HOME_EN), { status: 200, headers });
}

export const onRequestHead = headDoGet(onRequestGet);
