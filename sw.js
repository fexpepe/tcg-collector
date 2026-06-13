// Service worker do TCG Collector: cache-first das imagens de carta.
// Toda imagem já vista fica no Cache Storage do navegador e sobrevive a um
// outage do CDN (a TCGdex é um servidor comunitário que às vezes cai). Não
// cacheia HTML/JS/CSS — assim o app nunca fica preso numa versão velha após
// um deploy; só as imagens, que são imutáveis por URL.
const IMAGE_CACHE = "tcg-images-v1";
const IMAGE_HOSTS = new Set([
  "assets.tcgdex.net",        // cartas e logos do catálogo
  "images.pokemontcg.io",     // fallback de cartas EN
  "raw.githubusercontent.com" // artes da PokéAPI (Pokédex)
]);
// ~1500 imagens; low.webp tem ~17KB, então o teto fica na casa de dezenas de MB.
const MAX_ENTRIES = 1500;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key.startsWith("tcg-images-") && key !== IMAGE_CACHE).map((key) => caches.delete(key))
    );
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
  if (!IMAGE_HOSTS.has(url.hostname)) return;
  event.respondWith(serveImage(url));
});

async function serveImage(url) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(url.href);
  if (cached) return cached;

  try {
    // Os três CDNs mandam Access-Control-Allow-Origin: *, então o fetch em
    // modo cors devolve resposta não-opaca — cacheável sem o padding de cota
    // das respostas opacas.
    const response = await fetch(url.href, { mode: "cors", credentials: "omit" });
    if (response && response.ok) {
      cache.put(url.href, response.clone());
      trim(cache);
    }
    return response;
  } catch (error) {
    // Offline/outage e sem cópia: deixa falhar para disparar o onerror em
    // cadeia do <img> (que tenta o pokemontcg.io nas cartas EN).
    return cached || Response.error();
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_ENTRIES;
  // keys() vem na ordem de inserção: remover os primeiros é um FIFO simples.
  for (let i = 0; i < excess; i++) {
    await cache.delete(keys[i]);
  }
}
