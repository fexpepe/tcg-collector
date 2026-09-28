// CSP das páginas COM VITRINE (o espaço de anúncio, src/ads.js) — fase 1 do
// docs/PLANO-ADS.md, seção 10. Sem handler exportado de propósito: não vira
// rota (mesmo desenho do functions/users/_perfil.js e do api/_search-sql.js).
//
// POR QUE EXISTE: o AdSense só suporta CSP ESTRITA com nonce — lista de
// domínios não, porque os domínios dele mudam sem aviso
// (support.google.com/adsense/answer/16283098). O site inteiro continua com a
// CSP do _headers (script-src 'self', nada de terceiro); só as páginas de
// catálogo, que são as que carregam o ads.js, passam por aqui e trocam a
// política por uma com nonce POR REQUISIÇÃO. Login, conta, coleção e o resto
// nunca rodam script de rede de anúncio — é onde vive a sessão.
//
// O que muda em relação ao _headers, e só nestas páginas:
//   script-src  'nonce-…' 'strict-dynamic' (o que o Google pede). Com eles o
//               navegador IGNORA 'self', https: e 'unsafe-inline' — ficam só
//               de reserva pra navegador velho, como o Google recomenda.
//               'strict-dynamic' propaga a confiança: script criado por um
//               script com nonce (game.js injetando catálogo, shared.js
//               injetando scan.js/beacon, ads.js injetando o adsbygoogle.js)
//               roda sem nonce próprio. Script escrito por document.write NÃO
//               — por isso o theme.js repassa o nonce dele pro <script> do
//               i18n que escreve.
//   img/frame/connect-src  + https: — criativo, iframe e medição da rede vêm
//               de domínios que mudam.
// object-src 'none', base-uri, frame-ancestors e form-action ficam como
// estão. O inline de detecção de robô que o Cloudflare injeta continua
// bloqueado, como já é hoje (não tem nonce).
//
// CACHE: página com nonce por requisição NÃO pode ser revalidada com 304 — o
// navegador juntaria o HTML guardado (nonce velho) com o cabeçalho novo (nonce
// novo) e bloquearia todos os scripts. Então: a busca do asset vai sem
// If-None-Match/If-Modified-Since, a resposta sai sem ETag/Last-Modified e com
// no-cache. O service worker guarda cabeçalho e corpo juntos, então a cópia
// offline continua coerente.
//
// PAÍS: o país da borda (request.cf.country) vai pro <html data-pais>. O
// ads.js não chama rede de anúncio pra UE/Reino Unido/Suíça, onde o Google
// exige um CMP certificado (TCF) que o Sleevu não tem — lá fica a vitrine da
// casa e dos parceiros, que não usa cookie.

const HTML = /text\/html/i;

// 16 bytes aleatórios em base64 — o mínimo que a especificação de CSP pede.
export function nonceNovo(bytes = crypto.getRandomValues(new Uint8Array(16))) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// Parte da CSP do _headers (que a resposta do asset já traz) e troca só o que
// o anúncio precisa. Diretiva ausente vira presente; a ordem é preservada.
export function cspComNonce(base, nonce) {
  const diretivas = [];
  const mapa = new Map();
  for (const parte of String(base || "").split(";")) {
    const tokens = parte.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const nome = tokens[0].toLowerCase();
    if (mapa.has(nome)) continue; // CSP: vale a primeira ocorrência
    mapa.set(nome, tokens.slice(1));
    diretivas.push(nome);
  }
  const poe = (nome, valores) => { if (!mapa.has(nome)) diretivas.push(nome); mapa.set(nome, valores); };
  const soma = (nome, extra) => {
    const atual = mapa.has(nome) ? mapa.get(nome) : (mapa.get("default-src") || ["'self'"]).slice();
    for (const v of extra) if (!atual.includes(v)) atual.push(v);
    poe(nome, atual);
  };
  // O 'wasm-unsafe-eval' do scanner de carta segue valendo nestas páginas.
  const wasm = (mapa.get("script-src") || []).includes("'wasm-unsafe-eval'") ? ["'wasm-unsafe-eval'"] : [];
  poe("script-src", [`'nonce-${nonce}'`, "'strict-dynamic'", ...wasm, "'unsafe-eval'", "https:", "'unsafe-inline'"]);
  soma("img-src", ["https:"]);
  soma("frame-src", ["https:"]);
  soma("connect-src", ["https:"]);
  if (!mapa.has("object-src")) poe("object-src", ["'none'"]);
  return diretivas.map((d) => `${d} ${mapa.get(d).join(" ")}`.trim()).join("; ");
}

// Busca o HTML da página no asset estático, SEM validadores (ver CACHE acima).
export function buscaPagina(env, request, caminho) {
  const url = new URL(caminho, request.url);
  const headers = new Headers(request.headers);
  headers.delete("if-none-match");
  headers.delete("if-modified-since");
  return env.ASSETS.fetch(new Request(url, { method: "GET", headers }));
}

// Carimba o nonce em todo <script> e o país no <html>, e troca a CSP.
// Resposta que não é HTML 200 passa intacta (redirect, 404, erro do asset).
export function comVitrine(resposta, request) {
  if (!resposta || resposta.status !== 200 || !HTML.test(resposta.headers.get("content-type") || "")) return resposta;
  const nonce = nonceNovo();
  const pais = String((request && request.cf && request.cf.country) || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  const transformada = new HTMLRewriter()
    .on("script", { element(el) { el.setAttribute("nonce", nonce); } })
    // O preload do i18n em português (split-i18n.mjs) também é regido pelo
    // script-src: sem o nonce, o navegador bloqueava a dica (e acusava violação
    // de CSP) — a tradução ainda chegava pelo theme.js, só que sem o ganho do
    // download adiantado.
    .on('link[rel="preload"][as="script"], link[rel="modulepreload"]', { element(el) { el.setAttribute("nonce", nonce); } })
    .on("html", { element(el) { if (pais) el.setAttribute("data-pais", pais); } })
    .transform(resposta);
  const headers = new Headers(transformada.headers);
  headers.set("content-security-policy", cspComNonce(resposta.headers.get("content-security-policy"), nonce));
  headers.delete("etag");
  headers.delete("last-modified");
  headers.set("cache-control", "private, no-cache");
  return new Response(transformada.body, { status: 200, headers });
}

// O handler inteiro de uma página de catálogo sem outra lógica de borda.
export async function paginaComVitrine(context, caminho) {
  try {
    return comVitrine(await buscaPagina(context.env, context.request, caminho), context.request);
  } catch (e) {
    // Qualquer falha aqui devolve a página como sempre foi (CSP do _headers,
    // sem nonce): o ads.js não acha rede de anúncio e mostra a casa.
    return context.env.ASSETS.fetch(new URL(caminho, context.request.url));
  }
}
