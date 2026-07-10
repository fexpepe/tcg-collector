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
const SHELL_CACHE = "tcg-shell-v149";
const IMAGE_CACHE = "tcg-images-v1";
const DATA_CACHE = "tcg-data-v1";
const OPAQUE_TS_CACHE = "tcg-images-opaque-ts-v1"; // TTL das entradas opacas do IMAGE_CACHE
const CACHES = [SHELL_CACHE, IMAGE_CACHE, DATA_CACHE, OPAQUE_TS_CACHE];

const IMAGE_HOSTS = new Set([
  "assets.tcgdex.net",            // cartas e logos do catálogo
  "images.pokemontcg.io",         // fallback de cartas EN
  "raw.githubusercontent.com",    // artes da PokéAPI (Pokédex)
  "tcgplayer-cdn.tcgplayer.com",  // imagens JP da PPT (onde a TCGdex não tem)
  "cards.lorcast.io",             // imagens de cartas do Lorcana (Lorcast)
  "wsrv.nl"                       // proxy de resize (scans vintage do One Piece Carddass)
]);

// Esqueleto do app: arquivos que existem tanto local quanto em produção
// (os JS de src e o styles não são trocados pelo deploy; o HTML é, mas a
// estratégia network-first sempre busca a versão fresca quando há rede).
const SHELL_ASSETS = [
  "./", "index.html", "hub.html", "pokedex.html", "sets.html", "artists.html",
  "trainers.html", "collection.html", "wishlist.html", "portfolio.html",
  "detail.html", "binders.html", "cards.html", "sales.html", "graded.html", "about.html", "faq.html", "help.html", "privacy.html", "terms.html", "login.html", "settings.html", "profile.html", "admin.html",
  "styles.css", "favicon.svg", "icon.svg", "manifest.json",
  "src/theme.js", "src/game.js", "src/i18n.js", "src/shared.js", "src/app.js", "src/collection.js", "src/detail.js",
  "src/home.js", "src/wishlist.js", "src/portfolio.js", "src/binders.js",
  "src/cards.js", "src/sales.js", "src/graded.js", "src/login.js", "src/hub.js", "src/settings.js", "src/profile.js", "src/admin.js"
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

// Circuit breaker por host de imagem: quando um CDN cai (a TCGdex some do ar de
// vez em quando), cada tentativa ficava pendurada ~20s no timeout de conexão e a
// grade inteira parecia morta — o fallback (onerror da página) só disparava
// depois. Agora cada tentativa tem timeout curto e, após 3 falhas seguidas do
// host, as próximas falham NA HORA por 30s (aí o onerror troca pro fallback
// imediatamente). Estado em memória do SW: zera sozinho quando o SW recicla.
const FETCH_TIMEOUT_MS = 6000;
const HOST_FAIL_LIMIT = 3;
const HOST_FAIL_COOLDOWN_MS = 30000;
const hostFails = new Map(); // host -> { n, until }
function hostDown(host) {
  const s = hostFails.get(host);
  return !!s && s.n >= HOST_FAIL_LIMIT && Date.now() < s.until;
}
function noteHostFail(host) {
  const s = hostFails.get(host) || { n: 0, until: 0 };
  s.n += 1;
  s.until = Date.now() + HOST_FAIL_COOLDOWN_MS;
  hostFails.set(host, s);
}
function fetchWithTimeout(href, init) {
  if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
    return fetch(href, Object.assign({ signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }, init));
  }
  return fetch(href, init); // navegador sem AbortSignal.timeout: segue sem
}

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
  if (hostDown(url.hostname)) return cached || Response.error(); // CDN caído: falha rápida -> onerror/fallback
  // cors dá resposta não-opaca (cacheável sem padding de cota) — funciona com
  // hosts que enviam CORS (TCGdex etc.). Hosts SEM CORS (ex.: cards.lorcast.io do
  // Lorcana) rejeitam o fetch cors; aí cai no no-cors (resposta opaca: ainda
  // exibe no <img> e cacheia, só com padding de cota). Sem isto, a imagem quebrava.
  for (const mode of ["cors", "no-cors"]) {
    try {
      const response = await fetchWithTimeout(url.href, { mode, credentials: "omit" });
      if (response && (response.ok || response.type === "opaque")) {
        hostFails.delete(url.hostname);
        cache.put(url.href, response.clone());
        if (response.type === "opaque") markOpaque(url.href); // TTL: pode ser um erro escondido
        trim(IMAGE_CACHE, MAX_IMAGES);
        return response;
      }
    } catch (error) { /* tenta o próximo modo */ }
  }
  noteHostFail(url.hostname);
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
