// Fundação multi-jogo (Fase 0). Script SÍNCRONO no <head>, antes de tudo (o CSP
// 'self' impede inline). Decide qual TCG este subdomínio serve e carrega o
// catálogo correto:
//
//   poke.sleevu.app  | sleevu.app | localhost  -> "pokemon" (default)
//   lorcana.sleevu.app                          -> "lorcana"
//   localhost + ?game=<slug>                    -> override pra testar
//
// O catálogo é injetado por aqui (em vez de <script src="data/..."> fixo no HTML)
// porque o MESMO HTML é servido nos 3 subdomínios — então o caminho dos dados
// precisa sair do `dataDir` do jogo em runtime. Cada <script> da página declara
// o que precisa em data-catalog="cards,indexes,...". Os consumidores (shared.js
// loadCatalog/loadIndexesOnly) esperam window.SLEEVU.catalogReady antes de ler
// os globais window.TCG_*.
(function () {
  // Registro central de jogos. Por ora só Pokémon; Lorcana entra quando houver
  // catálogo (data/lorcana/...). dataDir do Pokémon = raiz de hoje (não move nada).
  var GAMES = {
    pokemon: { slug: "pokemon", name: "Pokémon", dataDir: "data/" },
    // Registrado, mas sem catálogo ainda: cai na página "em breve" (soon.html).
    // Quando o catálogo existir, troca comingSoon por dataDir: "data/lorcana/".
    lorcana: { slug: "lorcana", name: "Lorcana", comingSoon: true }
  };

  function detectGame() {
    var host = (location.hostname || "").toLowerCase();
    if (host.indexOf("lorcana.") === 0) return "lorcana";
    if (host.indexOf("poke.") === 0) return "pokemon";
    // Em localhost/preview dá pra forçar o jogo por query (?game=lorcana).
    try {
      var q = new URLSearchParams(location.search).get("game");
      if (q && GAMES[q]) return q;
    } catch (e) { /* sem URLSearchParams: ignora */ }
    return "pokemon"; // apex, poke. e dev caem no padrão
  }

  var game = detectGame();
  var cfg = GAMES[game] || GAMES.pokemon;
  document.documentElement.setAttribute("data-game", cfg.slug);

  // Jogo registrado mas ainda sem catálogo: manda pra página "em breve" — a não
  // ser que já esteja nela (senão dá loop). Vale pra qualquer rota do subdomínio
  // (o Cloudflare serve URL limpa, então a página pode chegar como /soon).
  if (cfg.comingSoon) {
    var page = location.pathname.replace(/\/+$/, "").split("/").pop();
    if (page !== "soon" && page !== "soon.html") {
      location.replace("soon.html" + location.search); // preserva ?game= em dev
      return;
    }
  }

  // Modo manifest (produção): o deploy flipa esta flag pra true (sed em game.js).
  // No modo manifest, cards/indexes/pricing viram os arquivos .generated mesclados.
  var MANIFEST = false; /* SLEEVU_MANIFEST */

  // dataset declarado -> arquivo real (depende do modo). set-id-map e os
  // pokemon-* não são mesclados, então são o mesmo arquivo nos dois modos.
  var FILE = {
    "cards":         MANIFEST ? "manifest.generated.js" : "cards.js",
    "indexes":       MANIFEST ? "indexes.generated.js"  : "indexes.js",
    "pricing":       MANIFEST ? "pricing.generated.js"  : "pricing.js",
    "set-id-map":    "set-id-map.js",
    "pokemon-names": "pokemon-names.js",
    "pokemon-types": "pokemon-types.js"
  };

  var me = document.currentScript;
  var list = ((me && me.getAttribute("data-catalog")) || "")
    .split(",").map(function (s) { return s.trim(); }).filter(Boolean);

  // Injeta os scripts do catálogo em ordem (async=false = execução ordenada) e
  // resolve catalogReady quando o último carregar. onerror não trava: um dataset
  // ausente não pode derrubar a página inteira.
  var resolveReady;
  var catalogReady = new Promise(function (res) { resolveReady = res; });
  function loadNext(i) {
    if (i >= list.length) { resolveReady(); return; }
    var file = FILE[list[i]];
    if (!file) { loadNext(i + 1); return; }
    var s = document.createElement("script");
    s.src = cfg.dataDir + file;
    s.async = false;
    s.onload = function () { loadNext(i + 1); };
    s.onerror = function () { loadNext(i + 1); };
    (document.head || document.documentElement).appendChild(s);
  }
  loadNext(0);

  window.SLEEVU = {
    game: cfg.slug,
    name: cfg.name,
    dataDir: cfg.dataDir,
    manifest: MANIFEST,
    catalogReady: catalogReady
  };
})();
