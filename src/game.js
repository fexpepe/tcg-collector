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
    gundam: { slug: "gundam", name: "Gundam Card Game", dataDir: "data/gundam/" }, // TCGCSV cat. 86 (Bandai, EN)
    dbfw: { slug: "dbfw", name: "Dragon Ball Fusion World", dataDir: "data/dbfw/" }, // TCGCSV cat. 80 (Bandai, EN; Fusion World, ≠ Masters)
    ygo: { slug: "ygo", name: "Yu-Gi-Oh!", dataDir: "data/ygo/" }, // TCGCSV cat. 2 (Konami, EN; ~46k cartas, padrão Magic: chunks versionados)
    digimon: { slug: "digimon", name: "Digimon Card Game", dataDir: "data/digimon/" }, // TCGCSV cat. 63 (Bandai 2020+, EN)
    riftbound: { slug: "riftbound", name: "Riftbound", dataDir: "data/riftbound/" }, // TCGCSV cat. 89 (Riot — League of Legends, EN)
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

  // Idioma de CARTA no <html>, ainda no <head>. Não é usado pra traduzir nada
  // aqui — serve pro CSS decidir, ANTES do primeiro paint, se os chips de
  // região (#setRegionChips) aparecem. Antes quem escondia era o app.js depois
  // de montar a página: os chips pintavam, sumiam, e tudo abaixo pulava 38px
  // pra cima. Espelha o default do shared.js ("all" quando não há preferência).
  var cardLang = "all";
  try {
    var savedLang = localStorage.getItem("tcg-collector-card-lang-v1");
    if (savedLang === "zh-tw" || savedLang === "zh-cn") cardLang = "zh";
    else if (savedLang === "all" || ["pt", "en", "ja", "zh"].indexOf(savedLang) >= 0) cardLang = savedLang;
  } catch (e) { /* storage bloqueado: fica em "all" */ }
  document.documentElement.setAttribute("data-cardlang", cardLang);

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

  // `indexes` inteiro tem ~800KB e nenhuma página usa mais de duas chaves. O
  // token `indexes:<chave>` pega só uma fatia (ver writeSplitIndexes no
  // sync-common). `indexes:auto` é da detail.html, que só sabe de qual índice
  // precisa lendo o ?type= da URL.
  var AUTO_INDEX = { artist: "artists", trainer: "trainers", set: "sets" };
  function autoIndexKey() {
    var type = "";
    try { type = new URLSearchParams(location.search).get("type") || ""; } catch (e) { /* ignora */ }
    return AUTO_INDEX[type] || "pokedex";
  }
  function fileFor(token) {
    if (token.slice(0, 8) === "indexes:") {
      var key = token.slice(8);
      if (key === "auto") key = autoIndexKey();
      // .json: entra por fetch + JSON.parse (ver loadJson), não por <script>.
      return "indexes-" + key + (MANIFEST ? ".generated.json" : ".json");
    }
    // pokemon-names/-types só existem em data/ (Pokémon). A detail.html e a
    // pokedex.html declaram os dois pra qualquer jogo, e em Lorcana/Magic/etc.
    // isso virava um 404 por pageview — round-trip jogado fora.
    if (token.slice(0, 8) === "pokemon-" && cfg.slug !== "pokemon") return null;
    return FILE[token] || null;
  }

  var me = document.currentScript;
  var list = ((me && me.getAttribute("data-catalog")) || "")
    .split(",").map(function (s) { return s.trim(); }).filter(Boolean);

  // Injeta TODOS os scripts de uma vez. `async = false` em script injetado
  // significa "execute na ordem de inserção", NÃO "baixe um de cada vez" — os
  // downloads acontecem em paralelo e só a execução é serializada. Antes cada
  // arquivo só era inserido no onload do anterior, o que virava uma cascata de
  // 4 round-trips (cards -> indexes -> set-id-map -> pricing) antes de a página
  // poder desenhar qualquer coisa.
  // catalogReady resolve quando o último terminar. onerror conta como terminado:
  // um dataset ausente não pode derrubar a página inteira.
  var resolveReady;
  var catalogReady = new Promise(function (res) { resolveReady = res; });
  // Dedupe: a detail.html pede `indexes:auto` + `indexes:sets`, e com ?type=set
  // os dois resolvem pro mesmo arquivo.
  var files = [];
  if (cfg.dataDir) {
    for (var i = 0; i < list.length; i++) {
      var f = fileFor(list[i]);
      if (f && files.indexOf(f) === -1) files.push(f);
    }
  }
  // Fatia de índice: baixa como DADO e faz JSON.parse. O nome do arquivo diz a
  // chave (indexes-sets.generated.json -> sets), e cada uma escreve num campo
  // diferente de window.TCG_INDEXES, então a ordem entre elas não importa.
  // Falha (404/JSON quebrado) não derruba a página: a chave fica vazia, mesmo
  // efeito do onerror do <script>.
  function loadJson(file, done) {
    var key = file.replace(/^indexes-/, "").replace(/\.generated/, "").replace(/\.json$/, "");
    if (key === "totals") key = "pokemonTotals";
    fetch(cfg.dataDir + file)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data) {
          window.TCG_INDEXES = window.TCG_INDEXES || {};
          window.TCG_INDEXES[key] = data;
        }
      })
      .catch(function () { /* índice ausente: a página degrada, não quebra */ })
      .then(done, done);
  }

  // Hub (sem dataDir) e páginas sem catálogo resolvem na hora.
  if (!files.length) resolveReady();
  else {
    var pending = files.length;
    var done = function () { if (--pending === 0) resolveReady(); };
    var head = document.head || document.documentElement;
    for (var j = 0; j < files.length; j++) {
      var file = files[j];
      if (file.slice(-5) === ".json") { loadJson(file, done); continue; }
      var s = document.createElement("script");
      s.src = cfg.dataDir + file;
      s.async = false;
      s.onload = done;
      s.onerror = done;
      head.appendChild(s);
    }
  }

  window.SLEEVU = {
    game: cfg.slug,
    name: cfg.name,
    dataDir: cfg.dataDir,
    manifest: MANIFEST,
    catalogReady: catalogReady
  };
})();
