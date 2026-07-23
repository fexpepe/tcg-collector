// Fundação multi-jogo. Script SÍNCRONO no <head>, antes de tudo (o CSP 'self'
// impede inline). Site ÚNICO (sleevu.app): o jogo é uma SESSÃO do site, não um
// subdomínio. Quem escolhe um jogo no HUB grava a escolha; as páginas de jogo
// leem essa sessão. Ordem de decisão:
//
//   Início (/) e HUB (hub.html)        -> "hub" (sem jogo, sem catálogo)
//   ?game=<slug> (deep-link / troca)   -> usa e GRAVA a sessão
//   sessão guardada (localStorage)     -> último jogo escolhido
//   página de jogo sem sessão          -> "pokemon" (padrão)
//
// O catálogo é injetado por aqui (em vez de <script src="data/..."> fixo) porque
// o MESMO HTML serve todos os jogos — o caminho dos dados sai do `dataDir` do
// jogo em runtime. Cada <script> declara o que precisa em data-catalog=
// "cards,indexes,...". Consumidores (shared.js) esperam window.SLEEVU.catalogReady.
(function () {
  // Registro central de jogos. dataDir do Pokémon = raiz de hoje (não move nada).
  var GAMES = {
    // Início/HUB: não é um jogo — não tem catálogo nem dados próprios.
    hub: { slug: "hub", name: "Sleevu", isHub: true },
    pokemon: { slug: "pokemon", name: "Pokémon", dataDir: "data/" },
    lorcana: { slug: "lorcana", name: "Lorcana", dataDir: "data/lorcana/" },
    onepiece: { slug: "onepiece", name: "One Piece", dataDir: "data/onepiece/" },
    magic: { slug: "magic", name: "Magic: The Gathering", dataDir: "data/magic/" }, // Scryfall (catálogo EN; pt-BR fase 2)
    fab: { slug: "fab", name: "Flesh and Blood", dataDir: "data/fab/" }, // TCGCSV cat. 62 (EN-só por design da LSS)
    naruto: { slug: "naruto", name: "Naruto Card Game", dataDir: "data/naruto/" },   // vintage Bandai 2003–2006 (+ moderno TCGCSV no futuro)
    hxh: { slug: "hxh", name: "Hunter × Hunter", dataDir: "data/hxh/" },             // vintage Bandai: Miracle Battle (2011–12); Hyper Battle 1999–2001 em curadoria
    // Em preparação (catálogo ainda vazio; tile "Em breve" no hub):
    jump: { slug: "jump", name: "JUMP", dataDir: "data/jump/" }            // promos curadas (Jump Festa, V-Jump…)
  };

  var GAME_KEY = "tcg-collector-game-v1"; // sessão: jogo escolhido por último
  function readSession() {
    try { var g = localStorage.getItem(GAME_KEY); return (g && GAMES[g] && !GAMES[g].isHub) ? g : null; } catch (e) { return null; }
  }
  function writeSession(g) {
    try { localStorage.setItem(GAME_KEY, g); } catch (e) { /* storage bloqueado: ignora */ }
  }
  // Páginas neutras (sem jogo): a Início e o HUB. Cobre URL limpa do Cloudflare
  // (/, /index, /hub) e o .html.
  function isNeutralPage() {
    var p = (location.pathname || "").replace(/\/+$/, "");
    return p === "" || /\/(index|hub|explore|dashboard|badges|backup)(\.html)?$/i.test(p);
  }

  function detectGame() {
    var q = null;
    try { q = new URLSearchParams(location.search).get("game"); } catch (e) { /* ignora */ }
    if (isNeutralPage()) {
      // Início/HUB são sempre o hub; mas se vier ?game= (de um link), já grava a
      // sessão pra próxima navegação entrar no jogo certo.
      if (q && GAMES[q] && !GAMES[q].isHub) writeSession(q);
      return "hub";
    }
    if (q === "hub") return "hub";                              // portfólio combinado
    if (q && GAMES[q] && !GAMES[q].isHub) { writeSession(q); return q; } // troca/deep-link
    var s = readSession();
    if (s) return s;                                            // sessão atual
    return "pokemon";                                           // padrão
  }

  var game = detectGame();
  var cfg = GAMES[game] || GAMES.pokemon;
  document.documentElement.setAttribute("data-game", cfg.slug);

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
    // Hub não tem catálogo (sem dataDir): resolve na hora, sem injetar nada.
    if (!cfg.dataDir || i >= list.length) { resolveReady(); return; }
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
