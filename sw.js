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
const SHELL_CACHE = "tcg-shell-v26";
const IMAGE_CACHE = "tcg-images-v1";
const DATA_CACHE = "tcg-data-v1";
const CACHES = [SHELL_CACHE, IMAGE_CACHE, DATA_CACHE];

const IMAGE_HOSTS = new Set([
  "assets.tcgdex.net",            // cartas e logos do catálogo
  "images.pokemontcg.io",         // fallback de cartas EN
  "raw.githubusercontent.com",    // artes da PokéAPI (Pokédex)
  "tcgplayer-cdn.tcgplayer.com",  // imagens JP da PPT (onde a TCGdex não tem)
  "cards.lorcast.io"              // imagens de cartas do Lorcana (Lorcast)
]);

// Esqueleto do app: arquivos que existem tanto local quanto em produção
// (os JS de src e o styles não são trocados pelo deploy; o HTML é, mas a
// estratégia network-first sempre busca a versão fresca quando há rede).
const SHELL_ASSETS = [
  "./", "index.html", "hub.html", "pokedex.html", "sets.html", "artists.html",
  "trainers.html", "collection.html", "wishlist.html", "portfolio.html",
  "detail.html", "binders.html", "cards.html", "privacy.html", "terms.html", "login.html",
  "styles.css", "favicon.svg", "icon.svg", "manifest.json",
  "src/theme.js", "src/game.js", "src/i18n.js", "src/shared.js", "src/app.js", "src/collection.js", "src/detail.js",
  "src/home.js", "src/wishlist.js", "src/portfolio.js", "src/binders.js",
  "src/cards.js", "src/login.js", "src/hub.js"
];

// Tetos por cache (FIFO): imagens ~17KB cada; chunks de set são o catálogo.
const MAX_IMAGES = 1500;
const MAX_DATA = 600;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // allSettled: um arquivo ausente não derruba a instalação inteira.
    await Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(asset)));
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

// Imagens: serve do cache; em miss busca (cors → resposta não-opaca, cacheável
// sem o padding de cota), e em falha de rede deixa o <img> cair no onerror.
async function cacheFirst(url) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(url.href);
  if (cached) return cached;
  // cors dá resposta não-opaca (cacheável sem padding de cota) — funciona com
  // hosts que enviam CORS (TCGdex etc.). Hosts SEM CORS (ex.: cards.lorcast.io do
  // Lorcana) rejeitam o fetch cors; aí cai no no-cors (resposta opaca: ainda
  // exibe no <img> e cacheia, só com padding de cota). Sem isto, a imagem quebrava.
  for (const mode of ["cors", "no-cors"]) {
    try {
      const response = await fetch(url.href, { mode, credentials: "omit" });
      if (response && (response.ok || response.type === "opaque")) {
        cache.put(url.href, response.clone());
        trim(IMAGE_CACHE, MAX_IMAGES);
        return response;
      }
    } catch (error) { /* tenta o próximo modo */ }
  }
  return cached || Response.error();
}

// App shell e dados: rede primeiro (sempre fresco quando online), cache como
// rede de segurança offline.
async function networkFirst(request, url) {
  const cacheName = url.pathname.includes("/data/") ? DATA_CACHE : SHELL_CACHE;
  try {
    const response = await fetch(request);
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
