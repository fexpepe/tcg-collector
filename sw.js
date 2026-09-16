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
// v237: descarta os caches envenenados por resposta REDIRECIONADA (ver
// semRedirect) — era a tela de "site não existe" ao navegar depois de deploy.
// v261: os links internos perderam o `.html` (o Pages redirecionava /x.html ->
// /x, 615ms por navegação no 4G). O navigationFast já casa os dois formatos —
// URL limpa cai no fallback que procura "<caminho>.html" no shell —, então o
// cache antigo continua servindo; o bump é pra o HTML novo (com os links
// limpos) entrar de uma vez, em vez de uma navegação atrás.
// v265 (2026-09-14): navegação passa a ter noção de VERSÃO. O Portfólio (e
// qualquer página) abria numa versão velha e quebrada antes da nova: o HTML
// cacheado da leva anterior era servido na hora, e os arquivos com hash que
// ele pedia já não existiam (o SW novo apaga o cache velho e o Pages só serve
// a leva atual). Três mudanças, todas aqui e no shared.js:
//   1. a chave de cache de uma página é UMA só (ver chaveDeNavegacao) — o
//      precache do deploy e a navegação escreviam em entradas diferentes, e a
//      da navegação (velha) ganhava da do precache (nova);
//   2. a primeira navegação depois de um tempo parado vai à REDE primeiro
//      (com teto de espera); dentro de uma sessão ativa segue cache-first;
//   3. quando o SW novo assume, a página aberta compara o build dela com o
//      dele e recarrega sozinha se for outra (antes só mostrava um aviso, e
//      a página velha seguia rodando sem os arquivos dela).
// O bump apaga de uma vez as entradas duplicadas (/portfolio e portfolio.html).
const SHELL_CACHE = "tcg-shell-v265";
// Id do build: o hash-assets.mjs (deploy) acrescenta "-<8 hex>" ao nome acima,
// calculado do conteúdo do shell (JS, CSS E as páginas HTML). É o mesmo id que
// ele carimba em <meta name="sleevu-build"> de todo HTML — assim a página sabe
// se foi gerada pela mesma leva que este SW. Em dev não há id (string vazia).
const BUILD_ID = (SHELL_CACHE.match(/^tcg-shell-v\d+-(.+)$/) || [])[1] || "";
// IMAGE_CACHE vai a v2: a versão anterior do SW podia cravar um erro 404/timeout
// como imagem "opaca" por 7 dias (imagem quebrada presa até um hard refresh).
// Renomear o cache faz o activate apagar o antigo UMA vez — limpa os erros
// cacheados; as imagens boas são re-baixadas sob demanda.
// v3: limpa de uma vez as imagens presas de sets NOVOS (ver MUTABLE_IMAGE_HOSTS).
const IMAGE_CACHE = "tcg-images-v3";
const DATA_CACHE = "tcg-data-v1";
const OPAQUE_TS_CACHE = "tcg-images-opaque-ts-v2"; // TTL das entradas opacas do IMAGE_CACHE
// Metadados do próprio SW (hoje: a hora da última confirmação de que o shell
// em cache é o da rede — ver confirmadoHaPouco). Cache Storage e não memória
// porque o navegador mata o SW ocioso em ~30 s e um global zeraria toda hora.
const META_CACHE = "tcg-meta-v1";
const CACHES = [SHELL_CACHE, IMAGE_CACHE, DATA_CACHE, OPAQUE_TS_CACHE, META_CACHE];

const IMAGE_HOSTS = new Set([
  "img.sleevu.app",               // espelho das imagens de carta no R2 (scripts/mirror-r2.mjs); imutável por URL
  "assets.tcgdex.net",            // cartas e logos do catálogo
  "images.pokemontcg.io",         // fallback de cartas EN
  "raw.githubusercontent.com",    // artes da PokéAPI (Pokédex)
  "tcgplayer-cdn.tcgplayer.com",  // imagens JP da PPT (onde a TCGdex não tem)
  "cards.lorcast.io",             // imagens de cartas do Lorcana (Lorcast)
  "cards.scryfall.io",            // imagens de cartas do Magic (Scryfall)
  "svgs.scryfall.io",             // ícones de set do Magic (Scryfall)
  "wsrv.nl"                       // proxy de resize (scans vintage do One Piece Carddass)
]);

// Imagens ESPELHADAS localmente (logos de set e os scans vintage baixados pelos
// mirror-*.mjs). Moram debaixo de /data/, então caíam na mesma rota do catálogo
// e disputavam os 3.000 slots do DATA_CACHE com os chunks — um jogo grande
// entrando expulsava os logos, que voltavam pra rede na visita seguinte. São
// imagens: pertencem ao IMAGE_CACHE, e são imutáveis de verdade (carta de 1999
// não muda; trocar um logo é subir arquivo com outro nome).
const LOCAL_IMAGE_RE = /\/(?:set-logos|vintage-images|vintage-images-2002)\//;

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
  "backup.html", "detail.html", "binders.html", "cards.html", "sales.html", "about.html", "novidades.html", "lancamentos.html", "comparar.html", "faq.html", "help.html", "privacy.html", "terms.html", "login.html", "settings.html", "profile.html", "admin.html",
  "decks.html", "my-decks.html", "listas.html", "troca.html", "search.html", "account.html",
  "styles.css", "favicon.svg", "icon.svg", "assets/brand/sleevu-wordmark.svg", "manifest.json",
  // Fonte da marca (auto-hospedada): precisa estar no shell pra o app abrir
  // offline com a tipografia certa, sem "trocar de fonte" ao reconectar.
  "assets/fonts/outfit-latin.woff2", "assets/fonts/outfit-latin-ext.woff2",
  "src/theme.js", "src/game.js", "src/login-boot.js", "src/i18n.js", "src/i18n-docs.js", "src/i18n-decks.js", "src/i18n-binders.js", "src/i18n-listas.js", "src/shared.js", "src/app.js", "src/collection.js", "src/detail.js", "src/explore.js", "src/dashboard.js", "src/primeiros-passos.js", "src/badges.js", "src/lancamentos.js", "src/goldfish.js",
  "src/home.js", "src/news.js", "src/wishlist.js", "src/portfolio.js", "src/binders.js",
  "src/backup.js", "src/graded-ui.js", "src/cards.js", "src/sales.js", "src/centering.js", "src/login.js", "src/hub.js", "src/settings.js", "src/profile.js", "src/admin.js",
  "src/deck-rules.js", "src/decks.js", "src/listas.js", "src/export-liga.js", "src/export-ui.js", "src/troca.js",
  // Módulos que saíram do shared.js (2026-09-14): dois sob demanda e um por página.
  "src/backup-import.js", "src/card-rescue.js", "src/facets.js",
  // Fichário (2026-09-16): motor das páginas de bolsos, carregado pelo set e pela Coleção.
  // Resumo (2026-09-16): gráficos de raridade/tipo, carregados pelo set e pela Coleção.
  "src/binder-view.js", "src/insights.js"
];

// Tetos por cache (FIFO): imagens ~17KB cada; chunks de set são o catálogo.
//
// MAX_DATA precisa caber um CATÁLOGO INTEIRO, senão o FIFO come o começo da
// carga antes de ela terminar e o stale-while-revalidate nunca entrega a 2ª
// visita instantânea — que é a razão de ele existir. Os maiores hoje: Magic
// 648 chunks (1.296 com os pricing-chunks irmãos), YGO 1.182, Pokémon 906 em
// todas as línguas. Somam-se a isso os ~400 logos/símbolos de set, que moram no
// mesmo cache. 3.000 dá folga pro maior jogo + o que já estiver guardado; os
// chunks são pequenos comprimidos (dezenas de KB), então o pior caso fica na
// casa das dezenas de MB de Cache Storage.
// 1.500 imagens era um teto que a colecao media ja estourava: o FIFO e PURO
// (a entrada mais ANTIGA sai, mesmo sendo a carta que voce abre toda semana),
// entao quem tem 2.000 cartas nunca tinha a colecao inteira offline — e a tese
// local-first do site ("sua colecao funciona no busao") ficava pela metade.
// 4.000 cobre uma colecao grande com folga.
const MAX_IMAGES = 4000;
const MAX_DATA = 3000;

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
    // NÃO usar cache.add: em produção o Pages redireciona hub.html -> /hub e o
    // add guardaria a resposta com a marca de redirect — que envenena o cache
    // (ver semRedirect). Busca, limpa a marca e grava sob o nome pedido.
    await Promise.allSettled(SHELL_ASSETS.map(async (asset) => {
      const res = await fetch(req(asset));
      if (res && res.ok) await cache.put(asset, semRedirect(res));
    }));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Navigation preload: o navegador dispara a requisição da navegação EM
    // PARALELO com o boot do service worker, em vez de a página esperar o SW
    // acordar (50-300ms num Android médio, mais se o processo estava frio) pra
    // só então o fetch sair. Aqui é ganho puro, sem requisição extra: o
    // navigationFast já busca a rede em toda navegação — o preload só antecipa
    // essa mesma busca. Ignorado por quem não suporta.
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) { /* segue sem */ }
    }
    // Limpa TUDO que não é desta leva: o shell das versões anteriores (nome
    // com outro build id), caches renomeados e qualquer vestígio de SW antigo.
    // As páginas velhas ainda abertas recarregam sozinhas logo em seguida (o
    // shared.js compara o build no controllerchange), então nada precisa
    // sobreviver daqui.
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => !CACHES.includes(key)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

// A página pergunta "qual é o seu build?" quando um SW novo assume o comando
// (controllerchange no shared.js) e compara com o <meta name="sleevu-build">
// dela: se for outro, recarrega — é a única forma de a versão nova entrar
// sem deixar uma página velha rodando sem os arquivos dela. Responde pela
// porta do MessageChannel quando vier uma; senão, direto ao cliente.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "sleevu:build") return;
  const resposta = { type: "sleevu:build", build: BUILD_ID, cache: SHELL_CACHE };
  if (event.ports && event.ports[0]) event.ports[0].postMessage(resposta);
  else if (event.source && event.source.postMessage) event.source.postMessage(resposta);
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
    // Imagem espelhada aqui mesmo: mesmo tratamento das imagens de fora
    // (cache-first no IMAGE_CACHE), fora da fila do catálogo. Ver LOCAL_IMAGE_RE.
    if (LOCAL_IMAGE_RE.test(url.pathname) && event.request.mode !== "navigate") {
      event.respondWith(cacheFirst(url));
      return;
    }
    // Catálogo (data/): stale-while-revalidate. Ver a função pra o porquê.
    if (url.pathname.includes("/data/") && event.request.mode !== "navigate") {
      event.respondWith(staleWhileRevalidate(event));
      return;
    }
    // NAVEGAÇÃO: cache primeiro dentro de uma sessão ativa, rede primeiro na
    // primeira navegação depois de um tempo parado. Ver navigationFast — o
    // porquê de cada lado está lá.
    if (event.request.mode === "navigate") {
      event.respondWith(navigationFast(event));
      return;
    }
    // Assets IMUTÁVEIS POR URL: o hash no nome (produção) e o rename-por-versão
    // das fontes tornam revalidação desperdício — o conteúdo de uma URL nunca
    // muda. cache-first zera os round-trips que o networkFirst (cache:no-cache)
    // fazia em toda carga, um por arquivo do shell. Em dev não há hash, o
    // padrão não casa e tudo segue no networkFirst (revalidar é o certo lá).
    // /assets/ (logos de jogo e de loja, ícones, wordmark): mesma natureza das
    // fontes — imutável por URL, trocado por RENAME. Só em produção
    // (HASHED_ASSETS), onde o _headers já os marca immutable; em dev revalidar
    // segue certo, senão editar uma arte local não apareceria. Sem isto o hub
    // — a porta de entrada — pagava ~20 requisições condicionais por abertura.
    if (HASHED_URL_RE.test(url.pathname) || url.pathname.includes("/assets/fonts/")
      || (HASHED_ASSETS && url.pathname.includes("/assets/"))) {
      event.respondWith(assetCacheFirst(event.request));
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
      // sem await de proposito (nao segurar a resposta), mas COM catch: com o
      // teto maior, QuotaExceededError deixa de ser hipotese — e uma rejeicao
      // solta aqui derruba o handler inteiro e a imagem nao chega na tela.
      cache.put(url.href, res.clone()).catch(() => {});
      // Carimba a hora só nos hosts mutáveis — é o que dá a validade de 7 dias.
      // Os demais (TCGdex, Scryfall, Lorcast) são imutáveis de verdade e seguem
      // sem carimbo, então nunca voltam à rede.
      if (MUTABLE_IMAGE_HOSTS.has(url.hostname)) markOpaque(url.href);
      maybeTrimImages();
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
      cache.put(url.href, res.clone()).catch(() => {});
      markOpaque(url.href);
      maybeTrimImages();
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
// src/<nome>.<8 hex>.js|css(.map) — o formato que o hash-assets.mjs produz.
const HASHED_URL_RE = /\.[0-9a-f]{8}\.(?:js|css)(?:\.map)?$/;

async function assetCacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

// Chave de cache de uma navegação: UMA por página, seja como for que ela é
// pedida. "/portfolio", "/portfolio?tab=x" e "/portfolio.html" são a mesma
// entrada — a que o precache do install grava ("portfolio.html", resolvida
// contra a origem). Antes a navegação gravava em "/portfolio" (URL limpa do
// Pages) e o precache em "/portfolio.html": duas entradas, e na leitura a da
// navegação vinha primeiro — o deploy novo precacheava a página certa e a
// navegação seguinte entregava a VELHA, que pedia arquivos com hash já
// apagados. Era o Portfólio "antigo e quebrado antes do novo".
// "/" é a raiz (o install guarda "./"); /users/<handle> é reescrito pelo
// Pages pra collection.html, então cai na mesma entrada (uma por perfil
// visitado não faria sentido — o conteúdo é o mesmo shell).
function chaveDeNavegacao(url) {
  const u = new URL(url);
  u.search = "";
  u.hash = "";
  if (u.pathname.endsWith("/")) return u.href; // raiz do site (ou do escopo, em dev sob subpasta)
  if (u.pathname.startsWith("/users/")) u.pathname = "/collection.html";
  else if (!/\.html$/.test(u.pathname)) u.pathname += ".html";
  return u.href;
}

// Quanto tempo uma confirmação da rede vale. Dentro desta janela a navegação
// é cache-first (a página aparece na hora, a rede atualiza por trás — o
// ganho do 4G que o network-first de antes não dava: toda troca de tela
// esperava a rede, sem timeout, com o site inteiro no aparelho). Passado
// isso, a próxima navegação vai à rede PRIMEIRO: é quase sempre a primeira
// abertura do dia, e o site publica todo dia às 06:20 — é aí que uma versão
// nova pode existir, e a página precisa ser a nova de cara, sem passar por
// uma velha antes. A busca da rede já sai em paralelo (navigation preload),
// então esperar por ela custa só o que ela demora; o teto abaixo é a
// garantia pro 4G morto: passou, a cópia local entra e a rede atualiza atrás.
const CONFIRMACAO_VALE_MS = 10 * 60 * 1000;
const REDE_PRIMEIRO_TETO_MS = 2500;
async function confirmadoHaPouco() {
  try {
    const meta = await (await caches.open(META_CACHE)).match("shell-confirmado");
    if (!meta) return false;
    return (Date.now() - Number(await meta.text())) < CONFIRMACAO_VALE_MS;
  } catch (e) { return false; }
}
async function marcaConfirmacao() {
  try { await (await caches.open(META_CACHE)).put("shell-confirmado", new Response(String(Date.now()))); } catch (e) { /* ignora */ }
}

// Resposta com a marca `redirected` NÃO PODE responder uma navegação: o
// navegador a troca por erro de rede (regra de segurança contra redirect
// escondido), e o usuário vê a tela de "site fora do ar". Em produção o Pages
// redireciona hub.html -> /hub, então qualquer resposta que seguiu esse
// redirect carrega a marca — o precache guardava exatamente isso, e a PRIMEIRA
// navegação depois de cada deploy dava erro até um F5 regravar a cópia limpa.
// Regravar o corpo numa Response nova derruba a marca; o resto é idêntico.
function semRedirect(res) {
  if (!res || !res.redirected) return res;
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

// Build de uma resposta HTML: o <meta name="sleevu-build"> que o hash-assets
// carimba em toda página no deploy. null = não dá pra saber (não é HTML, corpo
// ilegível); "" = página sem carimbo (dev).
async function buildDoHtml(response) {
  try {
    if (!/html/i.test(response.headers.get("content-type") || "")) return null;
    const texto = await response.clone().text();
    const m = texto.match(/<meta name="sleevu-build" content="([^"]*)">/);
    return m ? m[1] : "";
  } catch (e) { return null; }
}

// HTML de OUTRA leva chegou da rede: saiu deploy e este SW ainda é o antigo.
// Não guarda essa página aqui (ela pede arquivos que este cache não tem e o SW
// novo vai precacheá-la no cache dele) e pede a atualização do SW na hora —
// é o que faz a versão nova entrar em segundos, sem depender da checagem que
// o navegador faz no register() (o Chrome a pula quando checou há pouco;
// visto em 2026-09-14: uma navegação logo depois de outra ficava 30 s sem
// perceber o deploy). Uma vez por vida deste SW basta: o novo, ao ativar,
// assume tudo.
let atualizacaoPedida = false;
function pedeAtualizacao() {
  if (atualizacaoPedida || !self.registration || !self.registration.update) return;
  atualizacaoPedida = true;
  try { self.registration.update().catch(() => {}); } catch (e) { /* ignora */ }
}

// Navegações. Dois modos, decididos por confirmadoHaPouco():
//   - sessão ativa: cache -> resposta imediata; rede -> atualiza o cache por
//     trás (e renova a confirmação);
//   - primeira navegação depois de parado (ou dev, sem hash nos assets):
//     rede primeiro, com teto; estourou ou falhou, vai a cópia local.
// A chave ignora a query (detail.html?type=X é a MESMA página) e unifica os
// formatos (ver chaveDeNavegacao). Em dev (HASHED_ASSETS=false) é sempre rede
// primeiro: sem hash no nome, revalidar é o certo — senão editar uma página
// local mostraria a anterior.
async function navigationFast(event) {
  const request = event.request;
  const cache = await caches.open(SHELL_CACHE);
  const chave = chaveDeNavegacao(request.url);
  const cached = await cache.match(chave);
  // preloadResponse: a resposta que o navegador já começou a buscar enquanto o
  // SW acordava (ver navigationPreload no activate). Quando não houver (browser
  // sem suporte, ou preload desligado), busca normalmente.
  const rede = (async () => (await event.preloadResponse) || fetch(request))()
    .then(async (response) => {
      if (response && response.ok) {
        const build = await buildDoHtml(response);
        if (build === null || build === BUILD_ID) {
          cache.put(chave, semRedirect(response.clone()));
          marcaConfirmacao();
        } else {
          pedeAtualizacao();
        }
      }
      return response;
    }).catch(() => null);
  const fresco = HASHED_ASSETS && cached && await confirmadoHaPouco();
  if (fresco) {
    event.waitUntil(rede);
    // semRedirect também na SAÍDA: sara na hora um cache antigo já envenenado,
    // sem esperar o bump de versão descartá-lo.
    return semRedirect(cached);
  }
  // Rede primeiro. Com cópia local, espera no máximo o teto; sem ela, espera
  // o que for preciso (não há nada melhor pra mostrar).
  let resposta = null;
  if (cached) {
    resposta = await Promise.race([rede, new Promise((resolve) => setTimeout(() => resolve(null), REDE_PRIMEIRO_TETO_MS))]);
    if (!resposta) event.waitUntil(rede); // a rede termina por trás e grava pra próxima
  } else {
    resposta = await rede;
  }
  if (resposta) return resposta;
  return semRedirect(cached) || semRedirect(await caches.match(request, { ignoreSearch: true })) || Response.error();
}

async function staleWhileRevalidate(event) {
  const request = event.request;
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);
  // Sem cache:"no-cache": agora que o _headers dá /data/* um Cache-Control real
  // (max-age=3600, swr=86400), forçar revalidação anulava esse cache HTTP e cada
  // chunk pagava uma requisição condicional em toda revisita. Deixar o padrão
  // permite o navegador servir do próprio cache enquanto fresco.
  const rede = fetch(request).then((response) => {
    if (response && response.ok) {
      cache.put(request, response.clone());
      maybeTrim(DATA_CACHE, MAX_DATA);
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
      maybeTrim(cacheName, cacheName === DATA_CACHE ? MAX_DATA : Infinity);
    }
    return response;
  } catch (error) {
    // Offline: navegações ignoram a query (detail.html?type=... → detail.html).
    const cached = await caches.match(request, { ignoreSearch: request.mode === "navigate" });
    return (request.mode === "navigate" ? semRedirect(cached) : cached) || Response.error();
  }
}

// Web push (quedas da wishlist, enviado pelo robô semanal): mostra a notificação
// e, no toque, abre a wishlist (foca uma aba existente do site se houver).
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* payload não-JSON */ }
  // Bolinha no ÍCONE do app instalado, além da notificação. A notificação some
  // da bandeja quando a pessoa limpa; a bolinha fica até o app ser aberto — que
  // é o ponto de um aviso de queda de preço: ele vale enquanto a queda vale.
  // API progressiva: onde não existe (iOS fora do PWA instalado), o `?.` cobre.
  event.waitUntil(Promise.all([
    self.registration.showNotification(data.title || "Sleevu", {
      body: data.body || "",
      icon: "apple-touch-icon.png",
      badge: "apple-touch-icon.png",
      data: { url: data.url || "wishlist.html" }
    }),
    Promise.resolve().then(() => self.navigator && self.navigator.setAppBadge && self.navigator.setAppBadge(1)).catch(() => {})
  ]));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Clamp de origem: data.url vem do payload do push. A assinatura VAPID já barra
  // remetente forjado, mas um destino cross-origin aqui não teria motivo — cai na
  // wishlist. openWindow abriria qualquer origem; navigate recusa, mas melhor não depender disso.
  let alvo = new URL((event.notification.data && event.notification.data.url) || "wishlist.html", self.location.href);
  if (alvo.origin !== self.location.origin) alvo = new URL("wishlist.html", self.location.href);
  const url = alvo.href;
  event.waitUntil((async () => {
    const wins = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) { if (w.url.startsWith(self.location.origin)) { w.navigate(url); return w.focus(); } }
    return clients.openWindow(url);
  })());
});

// A poda enumera o cache INTEIRO (cache.keys() materializa até MAX_DATA
// Requests). Chamada a cada put, uma grade de 60 tiles com cache frio = 60
// varreduras completas na thread do SW, que é a mesma que responde todo fetch.
// O contador amortiza: enumera só a cada ~50 gravações. Entre podas o cache
// pode passar do teto por até ~50 entradas — irrelevante nos tetos atuais.
//
// O caminho das IMAGENS chamava trim() direto e era o pior caso justamente: a
// grade fria é exatamente a hora em que o SW mais precisa responder rápido.
let putsDesdePoda = 0;
// Teto EFETIVO das imagens. O FIFO conta entradas, nao bytes — e depois do
// srcset (P4) uma entrada pode ser a variante de 600px (~48 KB) em vez da de
// 245px (~14 KB), entao o mesmo 4.000 significa ~55 MB num desktop 1x e ~190 MB
// num celular 3x. Em vez de escolher um numero que serve mal aos dois, pergunta
// ao navegador quanto da cota ja foi: sob pressao o teto cai, e as imagens (que
// se re-baixam) cedem lugar antes do catalogo e da colecao, que nao se re-fazem.
// Sem storage.estimate (Safari antigo) segue o teto fixo, como antes.
async function tetoDeImagens() {
  try {
    if (!self.navigator || !navigator.storage || !navigator.storage.estimate) return MAX_IMAGES;
    const { usage, quota } = await navigator.storage.estimate();
    if (!usage || !quota) return MAX_IMAGES;
    const uso = usage / quota;
    if (uso > 0.9) return Math.round(MAX_IMAGES / 4);
    if (uso > 0.8) return Math.round(MAX_IMAGES / 2);
  } catch (e) { /* sem estimativa: teto fixo */ }
  return MAX_IMAGES;
}

function maybeTrimImages() {
  if (++putsDesdePoda < 50) return;
  putsDesdePoda = 0;
  tetoDeImagens().then((teto) => trim(IMAGE_CACHE, teto)).catch(() => {});
}

function maybeTrim(cacheName, maxEntries) {
  if (!Number.isFinite(maxEntries)) return;
  if (++putsDesdePoda < 50) return;
  putsDesdePoda = 0;
  trim(cacheName, maxEntries);
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
