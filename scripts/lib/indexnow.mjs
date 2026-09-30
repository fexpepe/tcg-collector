// IndexNow: o protocolo em que o SITE avisa o buscador de que uma URL entrou,
// mudou ou saiu, em vez de esperar o robô passar. Um aviso vale pra todos os
// buscadores que dividem o protocolo: Bing (que alimenta DuckDuckGo, Yahoo,
// Ecosia e a busca do ChatGPT e do Copilot), Yandex, Seznam, Naver e Yep. O
// Google não participa; lá quem avisa é o sitemap, lido pelo Search Console.
//
// Em 2026-09-30 o Bing não tinha NENHUMA página do sleevu.app (o `site:`
// voltava resultado de outros sites), três meses depois do domínio no ar.
//
// A chave NÃO é segredo. O protocolo exige que ela fique publicada na raiz do
// site (sleevu.app/<chave>.txt), e é isso que prova ao buscador que o aviso
// veio de quem controla o domínio. O arquivo de mesmo nome mora na raiz do
// repo; tests/indexnow.test.mjs confere que os dois batem. Trocar a chave =
// trocar a constante E renomear o arquivo.
//
// Por que avisar só o que ENTROU e SAIU do sitemap, e não tudo a cada deploy:
// o site sobe várias vezes por dia, quase sempre com o mesmo catálogo.
// Reenviar as ~7.800 URLs iguais a cada push é o uso que o protocolo pede pra
// não fazer, e buscador passa a ignorar quem faz. A exceção é a PRIMEIRA vez
// (chave ainda fora do ar): aí vai o sitemap inteiro, uma vez só.

export const HOST = "sleevu.app";
export const CHAVE = "93265e61594b47eb91a5e8ac8eea1175";
// Teto do protocolo por POST.
export const LOTE_MAX = 10000;

// Corpo do POST pro https://api.indexnow.org/indexnow.
export function payload(urlList) {
  return { host: HOST, key: CHAVE, keyLocation: `https://${HOST}/${CHAVE}.txt`, urlList };
}

function doHost(url) {
  try { return new URL(url).hostname === HOST; } catch (e) { return false; }
}

// O que mudou de um sitemap pro outro: as URLs que entraram e as que saíram.
// O protocolo aceita as duas; a removida o buscador confere, acha o 404 e
// tira do índice mais cedo. Só URLs do próprio host, porque uma de outro host
// faz o lote inteiro ser recusado (HTTP 422). Ordenadas: log legível e teste
// estável. Pra primeira vez, antes = [] dá o sitemap inteiro.
export function urlsAlteradas(antes, depois) {
  const a = new Set(antes);
  const d = new Set(depois);
  return {
    novas: [...d].filter((u) => !a.has(u) && doHost(u)).sort(),
    removidas: [...a].filter((u) => !d.has(u) && doHost(u)).sort()
  };
}

// Teto por deploy (2026-09-30). A mudança pra /games criou de uma vez ~290 mil
// URLs de carta (toda carta ganhou página) e moveu as ~5.400 de set. Mandar
// tudo num deploy é o que o protocolo trata como spam (HTTP 429), e buscador
// passa a ignorar quem faz. O que passa do teto fica pro sitemap, que o
// buscador lê sozinho. Prioridade: o que NÃO é página de carta (jogos, sets e
// os endereços antigos que viraram 301) vai primeiro, e as cartas completam
// até o teto.
export const TETO_POR_DEPLOY = 20000;
export function ehPaginaDeCarta(url) {
  try {
    const p = new URL(url).pathname.split("/").filter(Boolean);
    return (p[0] === "games" && p.length === 4) || p[0] === "card";
  } catch (e) { return false; }
}
export function priorizaComTeto(urls, teto = TETO_POR_DEPLOY) {
  const todas = [...urls.filter((u) => !ehPaginaDeCarta(u)), ...urls.filter(ehPaginaDeCarta)];
  return { enviar: todas.slice(0, teto), fora: Math.max(0, todas.length - teto) };
}

export function emLotes(urls, max = LOTE_MAX) {
  const lotes = [];
  for (let i = 0; i < urls.length; i += max) lotes.push(urls.slice(i, i + max));
  return lotes;
}
