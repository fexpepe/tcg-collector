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
const SHELL_CACHE = "tcg-shell-v224";
// IMAGE_CACHE vai a v2: a versão anterior do SW podia cravar um erro 404/timeout
// como imagem "opaca" por 7 dias (imagem quebrada presa até um hard refresh).
// Renomear o cache faz o activate apagar o antigo UMA vez — limpa os erros
// cacheados; as imagens boas são re-baixadas sob demanda.
const IMAGE_CACHE = "tcg-images-v2";
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

// Esqueleto do app: arquivos que existem tanto local quanto em produção
// (os JS de src e o styles não são trocados pelo deploy; o HTML é, mas a
// estratégia network-first sempre busca a versão fresca quando há rede).
const SHELL_ASSETS = [
  "./", "index.html", "hub.html", "pokedex.html", "sets.html", "artists.html",
  "trainers.html", "collection.html", "wishlist.html", "portfolio.html", "explore.html", "dashboard.html", "badges.html",
  "backup.html", "detail.html", "binders.html", "cards.html", "sales.html", "graded.html", "about.html", "novidades.html", "faq.html", "help.html", "privacy.html", "terms.html", "login.html", "settings.html", "profile.html", "admin.html",
  "styles.css", "favicon.svg", "icon.svg", "assets/brand/sleevu-wordmark.svg", "manifest.json",
  "src/theme.js", "src/game.js", "src/i18n.js", "src/shared.js", "src/app.js", "src/collection.js", "src/detail.js", "src/explore.js", "src/dashboard.js", "src/badges.js",
  "src/home.js", "src/wishlist.js", "src/portfolio.js", "src/binders.js",
  "src/backup.js", "src/graded-ui.js", "src/cards.js", "src/sales.js", "src/graded.js", "src/login.js", "src/hub.js", "src/settings.js", "src/profile.js", "src/admin.js"
];

// Tetos por cache (FIFO): imagens ~17KB cada; chunks de set são o catálogo.
const MAX_IMAGES = 1500;
const MAX_DATA = 600;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // allSettled: um arquivo ausente não derruba a instalação inteira. cache:reload
    // fura o cache HTTP do navegador, pra a instalação pegar a versão FRESCA do
    // deploy (e não uma cópia de 4h presa no cache).
    await Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(new Request(asset, { cache: "reload" }))));
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
  if (cached && (cached.type !== "opaque" || await opaqueFresh(url.href))) return cached;
  // 1) cors PRIMEIRO: se o host responde (mesmo com erro), o status é VISÍVEL.
  //    - ok         -> cacheia (imutável por URL) e retorna;
  //    - erro (404/5xx) -> devolve pro <img> (onerror/fallback) e NÃO cacheia,
  //      pra não cravar um 404 transitório no cache por dias. NÃO cai pro no-cors
  //      (que esconderia o status).
  try {
    const res = await fetch(url.href, { mode: "cors", credentials: "omit" });
    if (res && res.ok) {
      cache.put(url.href, res.clone());
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
