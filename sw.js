// Service worker do Sleevu. Duas responsabilidades:
//
// 1. Imagens (cache-first): toda imagem de carta já vista fica no Cache Storage
//    e sobrevive a um outage do CDN (a TCGdex é um servidor comunitário que às
//    vezes cai). São imutáveis por URL, então cache-first é seguro.
//
// 2. App shell + dados (network-first): HTML/CSS/JS e os JSON do catálogo vêm
//    da rede quando online (assim um deploy novo é sempre pego, sem o app ficar
//    preso numa versão velha) e caem no cache quando offline — fazendo o app
//    abrir e a coleção já vista funcionar sem internet (PWA instalável).
// v228: o catálogo (data/) saiu do network-first e virou stale-while-revalidate
// (ver staleWhileRevalidate lá embaixo), e a página de login ganhou um script
// novo no <head> (src/login-boot.js). Bump obrigatório por causa do login: o
// HTML antigo em cache não pede esse arquivo, e é ele que evita o formulário
// piscar na volta do link mágico.
const SHELL_CACHE = "tcg-shell-v235";
// IMAGE_CACHE vai a v2: a versão anterior do SW podia cravar um erro 404/timeout
// como imagem "opaca" por 7 dias (imagem quebrada presa até um hard refresh).
// Renomear o cache faz o activate apagar o antigo UMA vez — limpa os erros
// cacheados; as imagens boas são re-baixadas sob demanda.
// v3: limpa de uma vez as imagens presas de sets NOVOS (ver MUTABLE_IMAGE_HOSTS).
const IMAGE_CACHE = "tcg-images-v3";
const DATA_CACHE = "tcg-data-v1";
const OPAQUE_TS_CACHE = "tcg-images-opaque-ts-v2"; // TTL das entradas opacas do IMAGE_CACHE
const CACHES = [SHELL_CACHE, IMAGE_CACHE, DATA_CACHE, OPAQUE_TS_CACHE];

const IMAGE_HOSTS = new Set([
  "assets.tcgdex.net",            // cartas e logos do catálogo
  "images.pokemontcg.io",         // fallback de cartas EN
  "raw.githubusercontent.com",    // artes da PokéAPI (Pokédex)
  "tcgplayer-cdn.tcgplayer.com",  // imagens JP da PPT (onde a TCGdex não tem)
  "cards.lorcast.io",             // imagens de cartas do Lorcana (Lorcast)
  "cards.scryfall.io",            // imagens de cartas do Magic (Scryfall)
  "svgs.scryfall.io",             // ícones de set do Magic (Scryfall)
  "wsrv.nl"                       // proxy de resize (scans vintage do One Piece Carddass)
]);

// Hosts onde a URL NÃO é imutável. O TCGplayer publica a carta assim que ela
// entra no catálogo, muitas vezes com uma arte provisória (a da carta base), e
// TROCA o arquivo na MESMA URL quando o scan real chega. Com cache-first puro
// isso congela a arte errada pra sempre — foi o que aconteceu com uma alt art
// de Gundam de um set de 2026: a miniatura (400x400, vista cedo) ficou com a
// arte da carta base, enquanto o popup (1000x1000, buscado depois) mostrava a
// certa. Duas URLs, dois momentos, duas artes.
// Aqui elas passam a valer pelo mesmo TTL das respostas opacas: servem do cache
// (rápido e offline), mas depois de 7 dias são conferidas de novo.
const MUTABLE_IMAGE_HOSTS = new Set(["tcgplayer-cdn.tcgplayer.com"]);

// Esqueleto do app: arquivos que existem tanto local quanto em produção
// (os JS de src e o styles não são trocados pelo deploy; o HTML é, mas a
// estratégia network-first sempre busca a versão fresca quando há rede).
// Virada pra true no deploy (scripts/hash-assets.mjs), junto com o hash nos
// nomes. Ver o uso no install.
const HASHED_ASSETS = false; /* SLEEVU_HASHED */

const SHELL_ASSETS = [
  "./", "index.html", "hub.html", "pokedex.html", "sets.html", "artists.html",
  "trainers.html", "collection.html", "wishlist.html", "portfolio.html", "explore.html", "dashboard.html", "badges.html",
  "backup.html", "detail.html", "binders.html", "cards.html", "sales.html", "graded.html", "about.html", "novidades.html", "faq.html", "help.html", "privacy.html", "terms.html", "login.html", "settings.html", "profile.html", "admin.html",
  "decks.html", "my-decks.html",
  "styles.css", "favicon.svg", "icon.svg", "assets/brand/sleevu-wordmark.svg", "manifest.json",
  // Fonte da marca (auto-hospedada): precisa estar no shell pra o app abrir
  // offline com a tipografia certa, sem "trocar de fonte" ao reconectar.
  "assets/fonts/outfit-latin.woff2", "assets/fonts/outfit-latin-ext.woff2",
  "src/theme.js", "src/game.js", "src/login-boot.js", "src/i18n.js", "src/i18n-docs.js", "src/i18n-decks.js", "src/i18n-binders.js", "src/shared.js", "src/app.js", "src/collection.js", "src/detail.js", "src/explore.js", "src/dashboard.js", "src/badges.js",
  "src/home.js", "src/wishlist.js", "src/portfolio.js", "src/binders.js",
  "src/backup.js", "src/graded-ui.js", "src/cards.js", "src/sales.js", "src/graded.js", "src/login.js", "src/hub.js", "src/settings.js", "src/profile.js", "src/admin.js",
  "src/deck-rules.js", "src/decks.js"
];

// Tetos por cache (FIFO): imagens ~17KB cada; chunks de set são o catálogo.
const MAX_IMAGES = 1500;
const MAX_DATA = 600;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // allSettled: um arquivo ausente não derruba a instalação inteira.
    //
    // cache:reload fura o cache HTTP do navegador. Isso era OBRIGATÓRIO enquanto
    // os arquivos não tinham versão na URL: sem furar, a instalação podia gravar
    // uma cópia velha do deploy anterior. O custo é que TODO deploy re-baixava os
    // 69 itens do shell (~345 KB) do zero, porque o SHELL_CACHE muda e o install
    // roda de novo.
    // Com hash no nome (scripts/hash-assets.mjs, só em produção) a URL É a versão:
    // não existe cópia velha pra furar, e o install passa a reaproveitar o cache
    // do navegador — num deploy que mexe em 3 arquivos, só esses 3 saem da rede.
    // A flag é virada pelo mesmo passo que põe o hash; em dev, sem hash, o
    // reload continua sendo o comportamento certo.
    const req = (asset) => (HASHED_ASSETS ? new Request(asset) : new Request(asset, { cache: "reload" }));
    await Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(req(asset))));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => !CACHES.includes(key)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  let url;
  try {
    url = new URL(event.request.url);
  } catch (error) {
    return;
  }

  if (IMAGE_HOSTS.has(url.hostname)) {
    event.respondWith(cacheFirst(url));
    return;
  }
  if (url.origin === self.location.origin) {
    // Catálogo (data/): stale-while-revalidate. Ver a função pra o porquê.
    if (url.pathname.includes("/data/") && event.request.mode !== "navigate") {
      event.respondWith(staleWhileRevalidate(event));
      return;
    }
    event.respondWith(networkFirst(event.request, url));
    return;
  }
  // Outras origens (ex.: JSON da PokéAPI): deixa o navegador tratar.
});

// NÃO usar circuit breaker nem AbortSignal.timeout artificial aqui: numa página
// pesada com o cache VAZIO (ex.: logo após um bump de versão do cache), o
// navegador enfileira as imagens (6 conexões/host) e o timeout, que conta o tempo
// NA FILA, abortava as do fim sem nem começar — o breaker então contava como
// falha e, ao estourar o limite, bloqueava o host inteiro, quebrando a grade em
// massa. Sem timeout, cada imagem espera a vez e carrega; o navegador tem seu
// próprio timeout de conexão pro caso raro de CDN realmente fora, e o <img> tem
// onerror/fallback na página.

// Imagens: serve do cache; em miss busca (cors → resposta não-opaca, cacheável
// sem o padding de cota), e em falha de rede deixa o <img> cair no onerror.
// Respostas OPACAS (no-cors) escondem o status: um 404/500 do CDN entra no
// cache parecendo imagem e, em cache-first, seria servido quebrado PARA SEMPRE.
// Solução: entradas opacas ganham um TTL (timestamp num cache paralelo) e são
// re-buscadas depois de 7 dias; as cors (status visível, só entra ok) ficam
// imutáveis como sempre.
const OPAQUE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
async function opaqueFresh(href) {
  try {
    const meta = await (await caches.open(OPAQUE_TS_CACHE)).match(href);
    if (!meta) return false;
    return (Date.now() - Number(await meta.text())) < OPAQUE_TTL_MS;
  } catch (e) { return true; } // sem metadado legível: não força refetch
}
async function markOpaque(href) {
  try { await (await caches.open(OPAQUE_TS_CACHE)).put(href, new Response(String(Date.now()))); } catch (e) { /* ignora */ }
}

async function cacheFirst(url) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(url.href);
  // Host de URL mutável (TCGplayer): mesma regra de validade das opacas. Sem o
  // carimbo (entrada antiga, de antes desta regra) trata como vencida — é uma
  // requisição a mais UMA vez, e é justamente a que conserta a arte errada.
  const revalidar = MUTABLE_IMAGE_HOSTS.has(url.hostname) && !(await opaqueFresh(url.href));
  if (cached && !revalidar && (cached.type !== "opaque" || await opaqueFresh(url.href))) return cached;
  // 1) cors PRIMEIRO: se o host responde (mesmo com erro), o status é VISÍVEL.
  //    - ok         -> cacheia (imutável por URL) e retorna;
  //    - erro (404/5xx) -> devolve pro <img> (onerror/fallback) e NÃO cacheia,
  //      pra não cravar um 404 transitório no cache por dias. NÃO cai pro no-cors
  //      (que esconderia o status).
  try {
    const res = await fetch(url.href, { mode: "cors", credentials: "omit" });
    if (res && res.ok) {
      cache.put(url.href, res.clone());
      // Carimba a hora só nos hosts mutáveis — é o que dá a validade de 7 dias.
      // Os demais (TCGdex, Scryfall, Lorcast) são imutáveis de verdade e seguem
      // sem carimbo, então nunca voltam à rede.
      if (MUTABLE_IMAGE_HOSTS.has(url.hostname)) markOpaque(url.href);
      trim(IMAGE_CACHE, MAX_IMAGES);
      return res;
    }
    if (res) return res; // erro visível: não polui o cache
  } catch (e) { /* cors rejeitado -> host sem CORS, tenta no-cors abaixo */ }
  // 2) no-cors: só pros hosts que REJEITAM cors (ex.: cards.lorcast.io do Lorcana).
  //    A resposta opaca esconde o status, então ganha TTL (opaqueFresh) pra se
  //    auto-curar se for um erro escondido.
  try {
    const res = await fetch(url.href, { mode: "no-cors", credentials: "omit" });
    if (res && res.type === "opaque") {
      cache.put(url.href, res.clone());
      markOpaque(url.href);
      trim(IMAGE_CACHE, MAX_IMAGES);
      return res;
    }
  } catch (e) { /* falhou de vez */ }
  return cached || Response.error();
}

// App shell e dados: rede primeiro (sempre fresco quando online), cache como
// rede de segurança offline.
// Catálogo (data/): responde do CACHE na hora e revalida em segundo plano.
//
// Por que não network-first como o resto: a Coleção/Portfólio/Dashboard pedem
// dezenas de arquivos de catálogo por abertura, e network-first paga o
// round-trip de TODOS eles mesmo quando nada mudou (o 304 é barato em bytes,
// não em latência — no celular são ~40-150ms cada, em fila de 6 por host).
// Como o catálogo só muda no build (semanal pros preços), servir a cópia local
// e atualizar atrás é a troca certa: a 2ª visita abre instantânea e o dado
// fica, no pior caso, UMA visita atrasado.
//
// A revalidação roda mesmo quando o cache respondeu (waitUntil segura o SW
// vivo até ela terminar); falha de rede é silenciosa — já respondemos.
async function staleWhileRevalidate(event) {
  const request = event.request;
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);
  const rede = fetch(request, { cache: "no-cache" }).then((response) => {
    if (response && response.ok) {
      cache.put(request, response.clone());
      trim(DATA_CACHE, MAX_DATA);
    }
    return response;
  }).catch(() => null);
  if (cached) {
    event.waitUntil(rede);
    return cached;
  }
  return (await rede) || Response.error();
}

async function networkFirst(request, url) {
  const cacheName = url.pathname.includes("/data/") ? DATA_CACHE : SHELL_CACHE;
  // Recursos do app (CSS/JS/dados) têm cache HTTP de 4h e URL sem versão; ao
  // navegar, o navegador serviria a cópia velha. cache:"no-cache" força revalidar
  // (ETag → 304 barato, ou 200 fresco no deploy). HTML (navigate) já vem dinâmico.
  const init = request.mode === "navigate" ? undefined : { cache: "no-cache" };
  try {
    const response = await fetch(request, init);
    if (response && response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
      trim(cacheName, cacheName === DATA_CACHE ? MAX_DATA : Infinity);
    }
    return response;
  } catch (error) {
    // Offline: navegações ignoram a query (detail.html?type=... → detail.html).
    const cached = await caches.match(request, { ignoreSearch: request.mode === "navigate" });
    return cached || Response.error();
  }
}

// Web push (quedas da wishlist, enviado pelo robô semanal): mostra a notificação
// e, no toque, abre a wishlist (foca uma aba existente do site se houver).
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* payload não-JSON */ }
  event.waitUntil(self.registration.showNotification(data.title || "Sleevu", {
    body: data.body || "",
    icon: "apple-touch-icon.png",
    badge: "apple-touch-icon.png",
    data: { url: data.url || "wishlist.html" }
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "wishlist.html", self.location.href).href;
  event.waitUntil((async () => {
    const wins = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) { if (w.url.startsWith(self.location.origin)) { w.navigate(url); return w.focus(); } }
    return clients.openWindow(url);
  })());
});

async function trim(cacheName, maxEntries) {
  if (!Number.isFinite(maxEntries)) return;
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const excess = keys.length - maxEntries;
  // keys() vem na ordem de inserção: remover os primeiros é um FIFO simples.
  for (let i = 0; i < excess; i++) {
    await cache.delete(keys[i]);
  }
}
