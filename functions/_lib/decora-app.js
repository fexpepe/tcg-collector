// A tela do set do app (detail.html) com o que o endereço dela tem de SEO
// (2026-10-01). É o mesmo desenho da tela de cada jogo (sets.html em
// /games/<jogo>): a página é a do app, e a borda põe no HTML, antes de
// qualquer JS, o título, a descrição, a canonical, o Open Graph, o JSON-LD, o
// hreflang e o texto que o robô sem JS precisa ler.
//
// E a ROTA: um <meta name="sleevu-rota"> com o nome do set, o jogo e a carta
// que o endereço pede. É por ele que o detail.js sabe o que abrir numa URL sem
// query (/games/pokemon/base-set/charizard-4-102), antes de o catálogo chegar.
// O content é o próprio caminho: numa cópia guardada pelo service worker que
// chegue pra OUTRO endereço, o detail.js vê que não bate e acha a rota sozinho.
import { escapeAttr } from "./pagina-carta.js";
import { jsonLdSeguro } from "./json-ld.js";

// O que entra no <head> além do que a casca já tem. Pura (o HTMLRewriter não
// roda em node; tests/games-rota.test.mjs testa daqui).
// rota: { caminho, game, set, setId?, card? }
export function cabecaDaRota(pecas, rota) {
  const alternates = (pecas.alternates || [])
    .map((a) => `<link rel="alternate" hreflang="${escapeAttr(a.hreflang)}" href="${escapeAttr(a.href)}">`).join("");
  const jsonLds = (pecas.jsonLds || [])
    .map((o) => `<script type="application/ld+json">${jsonLdSeguro(o)}</script>`).join("");
  const dado = (nome, valor) => (valor ? ` data-${nome}="${escapeAttr(valor)}"` : "");
  const meta = `<meta name="sleevu-rota" content="${escapeAttr(rota.caminho)}"${dado("game", rota.game)}${dado("set", rota.set)}${dado("set-id", rota.setId)}${dado("card", rota.card)}>`;
  return alternates + jsonLds + meta;
}

const conteudo = (valor) => ({ element(el) { el.setAttribute("content", valor); } });
const remove = { element(el) { el.remove(); } };
// O <title> e o <h1> da casca vêm com data-i18n: sem tirar o atributo, a
// tradução do cliente trocava o texto do set por "Detalhe"/"Carregando".
const texto = (valor) => ({ element(el) { el.removeAttribute("data-i18n"); el.setInnerContent(valor, { html: false }); } });

// Os títulos em inglês e espanhol, nos atributos do <title> (2026-11-22). O
// <title> da borda é o português (é o que o robô do Google lê, e ele roda o JS
// em português) e o cliente nunca o traduzia: quem lê em inglês ou espanhol via
// o título da aba em português. O data-i18n NÃO volta pro <title> (indexaria o
// genérico "Sets - Sleevu"); o cliente só troca o document.title pelo atributo
// do idioma quando o idioma não é o português. Sem título no idioma, sem
// atributo (a página da carta, por exemplo, não tem idioma).
export function atributosDoTitulo(pecas) {
  const attrs = [];
  if (pecas.tituloEn) attrs.push(["data-titulo-en", pecas.tituloEn]);
  if (pecas.tituloEs) attrs.push(["data-titulo-es", pecas.tituloEs]);
  return attrs;
}
export const tituloDaTela = (pecas) => ({ element(el) {
  el.removeAttribute("data-i18n");
  el.setInnerContent(pecas.titulo, { html: false });
  for (const [nome, valor] of atributosDoTitulo(pecas)) el.setAttribute(nome, valor);
} });

// Resposta da casca -> resposta decorada (streaming).
export function decoraApp(casca, pecas, rota) {
  let rw = new HTMLRewriter()
    // O CSS esconde o cabeçalho de texto das páginas de SET antes do 1º paint
    // (html[data-detail]); o game.js carimba o mesmo, isto só adianta.
    .on("html", { element(el) { el.setAttribute("data-detail", "set"); } })
    .on("title", tituloDaTela(pecas))
    .on('meta[name="description"]', conteudo(pecas.desc))
    // A casca é noindex (em /detail?type=set a indexável é esta); aqui é ela.
    .on('meta[name="robots"]', conteudo("index, follow"))
    .on('link[rel="canonical"]', { element(el) { el.setAttribute("href", pecas.canonical); } })
    .on('meta[property="og:url"]', conteudo(pecas.canonical))
    .on('meta[property="og:title"]', conteudo(pecas.ogTitulo))
    .on('meta[property="og:description"]', conteudo(pecas.desc))
    .on('meta[name="twitter:title"]', conteudo(pecas.ogTitulo))
    .on('meta[name="twitter:description"]', conteudo(pecas.desc))
    .on("head", { element(el) { el.append(cabecaDaRota(pecas, rota), { html: true }); } })
    .on("#detailTitle", texto(pecas.h1))
    .on("main", { element(el) {
      // O esqueleto da carta no COMEÇO do main (2026-11-22): o detail.js só o
      // punha depois do shared.js, e a rota da carta esconde o resto da tela.
      if (pecas.esqueletoHtml) el.prepend(pecas.esqueletoHtml, { html: true });
      if (pecas.corpoHtml) el.append(pecas.corpoHtml, { html: true });
    } });
  if (pecas.ogImagem) {
    rw = rw
      .on('meta[property="og:image"]', conteudo(pecas.ogImagem))
      .on('meta[name="twitter:image"]', conteudo(pecas.ogImagem))
      // O logo do set e o scan da carta não são 1200x630 (as dimensões do
      // og-image genérico): anunciar tamanho errado corta a prévia.
      .on('meta[property="og:image:width"]', remove)
      .on('meta[property="og:image:height"]', remove);
  }
  return rw.transform(casca);
}
