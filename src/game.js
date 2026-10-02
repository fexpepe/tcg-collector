// Fundação multi-jogo. Script SÍNCRONO no <head>, antes de tudo (o CSP 'self'
// impede inline). Site ÚNICO (sleevu.app): o jogo é uma SESSÃO do site, não um
// subdomínio. Quem escolhe um jogo no HUB grava a escolha; as páginas de jogo
// leem essa sessão. Ordem de decisão:
//
//   página neutra (ver isNeutralPage)  -> "hub" (sem jogo, sem catálogo)
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
    swu: { slug: "swu", name: "Star Wars: Unlimited", dataDir: "data/swu/" }, // TCGCSV cat. 79 (FFG, EN; Hyperspace/Showcase = cartas próprias)
    cyberpunk: { slug: "cyberpunk", name: "Cyberpunk TCG", dataDir: "data/cyberpunk/" }, // TCGCSV cat. 92 (Weird Co. 2026, EN; edições Beta e Retail = sets próprios)
    sorcery: { slug: "sorcery", name: "Sorcery: Contested Realm", dataDir: "data/sorcery/" }, // TCGCSV cat. 77 (Erik's Curiosa 2023, EN; foil é outro produto, o sync junta)
    dbfw: { slug: "dbfw", name: "Dragon Ball Fusion World", dataDir: "data/dbfw/" }, // TCGCSV cat. 80 (Bandai, EN; Fusion World, ≠ Masters)
    ygo: { slug: "ygo", name: "Yu-Gi-Oh!", dataDir: "data/ygo/" }, // TCGCSV cat. 2 (Konami, EN; ~46k cartas, padrão Magic: chunks versionados)
    digimon: { slug: "digimon", name: "Digimon Card Game", dataDir: "data/digimon/" }, // TCGCSV cat. 63 (Bandai 2020+, EN)
    riftbound: { slug: "riftbound", name: "Riftbound", dataDir: "data/riftbound/" }, // TCGCSV cat. 89 (Riot — League of Legends, EN)
    unionarena: { slug: "unionarena", name: "Union Arena", dataDir: "data/unionarena/" }, // TCGCSV cat. 81 (Bandai, EN; um set por anime)
    naruto: { slug: "naruto", name: "Naruto Card Game", dataDir: "data/naruto/" },   // vintage Bandai 2003–2006 (+ moderno TCGCSV no futuro)
    hxh: { slug: "hxh", name: "Hunter × Hunter", dataDir: "data/hxh/" },             // vintage Bandai: Miracle Battle (2011–12); Hyper Battle 1999–2001 em curadoria
    dbc: { slug: "dbc", name: "Dragon Ball Carddass", dataDir: "data/dbc/" },       // vintage Bandai 1988–1997 (Hondan; cartas sem scan ainda)
    wow: { slug: "wow", name: "World of Warcraft TCG", dataDir: "data/wow/" },     // vintage Upper Deck/Cryptozoic 2006–2013, TCGCSV cat. 13 (EN, com preço)
    lotr: { slug: "lotr", name: "The Lord of the Rings TCG", dataDir: "data/lotr/" }, // vintage Decipher 2001–2007 (banco do Player's Council)
    harrypotter: { slug: "harrypotter", name: "Harry Potter TCG", dataDir: "data/harrypotter/" }, // vintage Wizards of the Coast 2001–2002 (hpjson; premium = cartas próprias)
    weiss: { slug: "weiss", name: "Weiß Schwarz", dataDir: "data/weiss/" }, // TCGCSV cat. 20 (Bushiroad, só a edição EN, 2013+; paralelas = cartas próprias)
    mbc: { slug: "mbc", name: "Miracle Battle Carddass", dataDir: "data/mbc/" }, // vintage Bandai 2009–2015, crossover da Jump (7 séries; tcg-db)
    // Em preparação (catálogo ainda vazio; tile "Em breve" no hub):
    jump: { slug: "jump", name: "JUMP", dataDir: "data/jump/" }            // promos curadas (Jump Festa, V-Jump…)
  };

  // Allowlist REAL: `GAMES[q]` sozinho deixa passar chave de protótipo
  // (?game=constructor, toString, __proto__…) — truthy, isHub undefined, e o
  // valor ia parar no localStorage e travava toda visita futura com "0 cartas".
  // indexOf num array de slugs não tem esse furo.
  var GAME_SLUGS = Object.keys(GAMES);
  function isRealGame(g) { return GAME_SLUGS.indexOf(g) >= 0 && !GAMES[g].isHub; }

  // Endereço público de cada jogo: /games/<url> é a tela de Sets dele
  // (2026-09-30). Cópia do registro de functions/_lib/jogos.js (este arquivo é
  // script clássico e não importa módulo); tests/games-url.test.mjs trava as
  // duas iguais. [url, jogo, linha, prefixos dos setIds da linha].
  var URL_DOS_JOGOS = [
    ["pokemon", "pokemon"], ["magic-the-gathering", "magic"], ["disney-lorcana", "lorcana"],
    ["one-piece-card-game", "onepiece"], ["riftbound", "riftbound"], ["star-wars-unlimited", "swu"],
    ["gundam-card-game", "gundam"], ["flesh-and-blood", "fab"], ["yu-gi-oh", "ygo"],
    ["dragon-ball-fusion-world", "dbfw"], ["digimon-card-game", "digimon"], ["union-arena", "unionarena"],
    ["cyberpunk-tcg", "cyberpunk"], ["sorcery-contested-realm", "sorcery"], ["naruto-card-game", "naruto", "nrt-ncg", "nrt-ncg-"],
    ["weiss-schwarz", "weiss"],
    ["dragon-ball-carddass", "dbc"], ["hunter-x-hunter-carddass", "hxh"],
    ["one-piece-carddass", "onepiece", "opcd", "opcd-"], ["lord-of-the-rings-tcg", "lotr"], ["harry-potter-tcg", "harrypotter"],
    ["one-piece-card-game-2002", "onepiece", "op2002", "op2002-"],
    ["naruto-card-game-2002", "naruto"], ["naruto-data-carddass", "naruto", "nrt-dc", "nrt-dc-,nrt-nf-,nrt-nx-"],
    ["naruto-ccg", "naruto", "nrt-ccg", "nrt-ccg-"], ["world-of-warcraft-tcg", "wow"], ["miracle-battle-carddass", "mbc"]
  ];
  // Linha que virou seção de outra (o LINE_ALIASES do shared.js).
  var LINHA_APELIDO = { "nrt-nf": "nrt-dc", "nrt-nx": "nrt-dc" };
  // Linha que virou JOGO (o LINHAS_VIRARAM_JOGO do functions/_lib/jogos.js): o
  // Miracle Battle era linha do One Piece, do Naruto e do HxH até 2026-10-01.
  var LINHA_VIROU_JOGO = { "op-mb": "mbc", "nrt-mb": "mbc", "hxh-mb": "mbc" };
  // /games/<url>, /games/<url>/<set> e /games/<url>/<set>/<carta>. O "_id" do
  // link de compartilhar não casa (tem "_"): ele é sempre um 301 da borda.
  var CAMINHO_DO_JOGO = /^\/games\/([a-z0-9-]+)(\/[a-z0-9-]+){0,2}\/?$/;
  function urlDoJogo(game, linha) {
    if (LINHA_VIROU_JOGO.hasOwnProperty(linha)) return urlDoJogo(LINHA_VIROU_JOGO[linha], "");
    var l = LINHA_APELIDO[linha] || linha || "";
    for (var i = 0; i < URL_DOS_JOGOS.length; i++) {
      var j = URL_DOS_JOGOS[i];
      if (j[1] === game && (j[2] || "") === l) return "/games/" + j[0];
    }
    return l ? urlDoJogo(game, "") : "";
  }
  // Em que /games/<url> mora um set: o da linha cujo prefixo casa com o setId,
  // senão o do jogo (a mesma régua do urlDoSet do servidor).
  function urlDoSet(game, setId) {
    var id = String(setId || "");
    for (var i = 0; i < URL_DOS_JOGOS.length; i++) {
      var j = URL_DOS_JOGOS[i];
      if (j[1] !== game || !j[3]) continue;
      var pre = j[3].split(",");
      for (var k = 0; k < pre.length; k++) if (id.indexOf(pre[k]) === 0) return "/games/" + j[0];
    }
    return urlDoJogo(game, "");
  }
  // /games/<url> aberto: [jogo, linha]. null fora da árvore ou em url que não
  // é do registro (apelido já saiu da borda como 301). Vale também pros níveis
  // de baixo, a tela do set e a da carta (/games/<url>/<set>[/<carta>], desde
  // 2026-10-01): o jogo e a linha são os do 1º segmento.
  function jogoDoCaminho() {
    var m = CAMINHO_DO_JOGO.exec(location.pathname || "");
    if (!m) return null;
    for (var i = 0; i < URL_DOS_JOGOS.length; i++) {
      if (URL_DOS_JOGOS[i][0] === m[1]) return [URL_DOS_JOGOS[i][1], URL_DOS_JOGOS[i][2] || ""];
    }
    return null;
  }
  var linhaDaUrl = ""; // linha vinda de /games/<url> (o shared.js lê via SLEEVU.line)

  var GAME_KEY = "tcg-collector-game-v1"; // sessão: jogo escolhido por último
  function readSession() {
    try { var g = localStorage.getItem(GAME_KEY); return isRealGame(g) ? g : null; } catch (e) { return null; }
  }
  function writeSession(g) {
    try { localStorage.setItem(GAME_KEY, g); } catch (e) { /* storage bloqueado: ignora */ }
  }
  // Páginas neutras: as que NÃO são de um jogo só. A Início e o HUB (que são a
  // porta de entrada), a busca global (Explorar), os Decks (galeria e "Meus
  // decks" mostram deck de qualquer jogo) e TODAS as páginas pessoais — elas
  // leem os 13 jogos de uma vez (stores mesclados + loadOwnedAcrossGames) e
  // filtram por jogo DENTRO da página. Aqui a sessão não é usada pra nada, e
  // carimbar ?game= (ver stampGame) só sujava o link que a pessoa copia: abrir
  // /collection e ver "?game=pokemon" na barra dá a entender que a página está
  // presa no Pokémon, quando o filtro dela começa em "Todos".
  // Cobre URL limpa do Cloudflare (/, /index, /decks) e o .html.
  // As ferramentas (2026-10-01: /tools, /condition, /centering, /sleeves) são
  // neutras também: o HTML delas já dizia "página NEUTRA", mas faltavam aqui,
  // e o /condition público saía com ?game= no link que a pessoa copia.
  function isNeutralPage() {
    var p = (location.pathname || "").replace(/\/+$/, "");
    return p === "" || /\/(index|hub|explore|search|account|dashboard|badges|backup|decks|my-decks|collection|portfolio|sales|binders|wishlist|graded|troca|tools|condition|centering|sleeves)(\.html)?$/i.test(p);
  }
  // Porta de entrada (Início/HUB): a única neutra onde ?game= grava a sessão.
  function isEntryPage() {
    var p = (location.pathname || "").replace(/\/+$/, "");
    return p === "" || /\/(index|hub)(\.html)?$/i.test(p);
  }

  function detectGame() {
    // /games/<url>: o jogo está no próprio endereço. Grava a sessão como o
    // ?game= fazia: quem abre a tela de um jogo segue nele pelas outras telas.
    var doCaminho = jogoDoCaminho();
    if (doCaminho) {
      linhaDaUrl = doCaminho[1];
      writeSession(doCaminho[0]);
      // ?game= e ?line= não valem aqui (o jogo e a linha são os do endereço).
      // Sobra de link velho sai da barra; senão um ?line= solto trocaria a
      // lista de sets debaixo de um endereço que diz outra coisa.
      try {
        var u = new URL(location.href);
        if (u.searchParams.has("game") || u.searchParams.has("line")) {
          u.searchParams.delete("game");
          u.searchParams.delete("line");
          history.replaceState(history.state, "", u.pathname + u.search + u.hash);
        }
      } catch (e) { /* history bloqueado: segue com a barra como veio */ }
      return doCaminho[0];
    }
    var q = null;
    try {
      var busca = new URLSearchParams(location.search);
      q = busca.get("game");
      // ?game=onepiece&line=op-mb (link de antes de 2026-10-01): o jogo agora é o mbc.
      if (LINHA_VIROU_JOGO.hasOwnProperty(busca.get("line"))) q = LINHA_VIROU_JOGO[busca.get("line")];
    } catch (e) { /* ignora */ }
    if (isNeutralPage()) {
      // Na porta de entrada, ?game= é intenção ("vim de um link daquele jogo"):
      // grava a sessão pra próxima navegação entrar no jogo certo. Nas DEMAIS
      // neutras (Decks etc.) o ?game= é sobra do carimbo antigo, em links que
      // ainda circulam — trocar a sessão de quem abre seria efeito colateral.
      if (isRealGame(q) && isEntryPage()) writeSession(q);
      return "hub";
    }
    if (q === "hub") return "hub";                              // deep-link legado (?game=hub): sessão neutra
    if (isRealGame(q)) { writeSession(q); vaiProEnderecoDoJogo(q); return q; } // troca/deep-link
    var s = readSession();
    if (s) { if (!vaiProEnderecoDoJogo(s)) stampGame(s); return s; }           // sessão atual
    if (!vaiProEnderecoDoJogo("pokemon")) stampGame("pokemon");
    return "pokemon";                                           // padrão
  }

  // /sets (e /sets?game=x&line=y) é o endereço ANTIGO da tela de Sets. Com
  // rede, a borda já responde 301 pra /games/<jogo>; chega aqui quando o
  // service worker serve a cópia guardada sem ir à rede, e quando /sets vem sem
  // jogo (a tela abre no da sessão). A barra passa pro endereço novo sem
  // recarregar: o que a pessoa copia e o que o "voltar" guarda já é o novo.
  // Depende do <base href="/"> do sets.html: com a barra em /games/…, os
  // caminhos relativos da tela continuam resolvendo na raiz.
  function vaiProEnderecoDoJogo(game) {
    try {
      if (!/^\/sets(\.html)?\/?$/.test(location.pathname || "")) return false;
      var url = new URL(location.href);
      var linha = url.searchParams.get("line") || "";
      var destino = urlDoJogo(game, linha);
      if (!destino) return false;
      // Linha que o registro não conhece cai no jogo principal (como o
      // lineScope faz); a que ele conhece segue valendo pelo SLEEVU.line.
      if (linha && destino !== urlDoJogo(game, "")) linhaDaUrl = LINHA_APELIDO[linha] || linha;
      url.searchParams.delete("game");
      url.searchParams.delete("line");
      history.replaceState(history.state, "", destino + url.search + url.hash);
      return true;
    } catch (e) { return false; }
  }

  // Escreve o jogo resolvido na barra de endereço quando ele NÃO veio da URL.
  // Sem isso, /sets e /detail?type=set&name=X são páginas de SESSÃO: cada
  // visitante abre no último jogo que ele visitou. Compartilhar "os sets do
  // Gundam" entregava os sets do Pokémon pra quem recebesse — e um link de set
  // de outro jogo abria a página vazia, porque o set não existe no catálogo que
  // foi carregado.
  // replaceState (não pushState): não cria entrada no histórico, então o
  // "voltar" do navegador segue funcionando igual. Roda no <head>, antes de
  // qualquer render — a URL já está certa quando a página aparece.
  // As <link rel="canonical"> são fixas e sem query, então o Google continua
  // consolidando tudo numa URL só.
  //
  // EXCEÇÃO: /users/<handle>. O perfil público é a vitrine da PESSOA, não de um
  // jogo — ele já abre em "Todos". Carimbar ali fazia dois estragos: o dono
  // copiava um link sujo (/users/fexpepe?game=onepiece) achando que o perfil
  // estava preso num jogo, e o jogo carimbado era o da sessão de QUEM VISITA —
  // então cada visitante via um sufixo diferente na mesma página.
  // Só o carimbo é suprimido: a detecção de jogo segue igual, então o catálogo
  // carrega como antes e a página não muda de comportamento.
  function stampGame(slug) {
    try {
      var url = new URL(location.href);
      if (url.searchParams.get("game")) return;
      if (/^\/users\//i.test(url.pathname)) return;
      url.searchParams.set("game", slug);
      history.replaceState(history.state, "", url);
    } catch (e) { /* history bloqueado: segue sem carimbar */ }
  }

  var game = detectGame();
  var cfg = (GAME_SLUGS.indexOf(game) >= 0 && GAMES[game]) || GAMES.pokemon;
  document.documentElement.setAttribute("data-game", cfg.slug);

  // Handshake do CDN de imagem ADIANTADO. O <head> das páginas é o mesmo pra
  // todos os jogos, então ele só consegue pré-conectar os dois hosts do Pokémon
  // e do TCGplayer — quem abre Magic ou Lorcana descobre o host da imagem só
  // quando a primeira carta é desenhada, e paga DNS + TCP + TLS inteiros dentro
  // do caminho do LCP. Aqui o jogo já é conhecido (isto roda síncrono no head,
  // antes do CSS), então dá pra abrir a conexão junto com o resto.
  // Só os hosts que NÃO estão no HTML: tcgdex e tcgplayer-cdn já têm a tag.
  // Todos estão no img-src/connect-src da CSP (ver _headers).
  var IMG_HOST = {
    magic: ["https://cards.scryfall.io", "https://svgs.scryfall.io"],
    lorcana: ["https://cards.lorcast.io"],
    naruto: ["https://wsrv.nl"],
    hxh: ["https://wsrv.nl"],
    lotr: ["https://wsrv.nl"],
    harrypotter: ["https://wsrv.nl"]
  };
  // SEM crossorigin, igual às tags que já existem no HTML: na PRIMEIRA visita —
  // a única em que o handshake pesa — o service worker ainda não controla a
  // página (ele só é registrado no evento load), então as imagens saem pelo
  // <img> comum, que não é CORS. Marcar `anonymous` aqui prepararia um pool de
  // conexão que essa requisição não reusaria, e o TLS sairia duas vezes.
  (IMG_HOST[cfg.slug] || []).forEach(function (host) {
    var l = document.createElement("link");
    l.rel = "preconnect";
    l.href = host;
    (document.head || document.documentElement).appendChild(l);
  });

  // Hosts de DADO das páginas com dinheiro/coleção: o câmbio (awesomeapi, que o
  // primeiro render espera) e o Supabase (a carga /api/collection e o pull do
  // sync). Os dois eram descobertos só quando o shared.js já tinha carregado e
  // pagavam DNS+TCP+TLS inteiros dentro do caminho crítico. Só nessas páginas —
  // preconnect é aposta: em página que não usa, é conexão aberta à toa.
  var PAGINAS_COM_DADO = /\/(collection|portfolio|dashboard|sales|graded|wishlist|binders|cards|detail|explore|my-decks|listas)(\.html)?$/i;
  // A tela do set também mora em /games/<jogo>/<set>[/<carta>] (2026-10-01).
  var TELA_DO_SET = /^\/games\/[a-z0-9-]+\/[a-z0-9-]+(\/[a-z0-9-]+)?\/?$/;
  if (PAGINAS_COM_DADO.test(location.pathname) || TELA_DO_SET.test(location.pathname) || /^\/users\//i.test(location.pathname)) {
    ["https://economia.awesomeapi.com.br", "https://dlnalopazitfdgnmdguu.supabase.co"].forEach(function (host) {
      var l = document.createElement("link");
      l.rel = "preconnect";
      l.href = host;
      l.crossOrigin = "anonymous"; // fetch()/XHR: CORS, ao contrário do <img>
      (document.head || document.documentElement).appendChild(l);
    });
  }

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

  // Tipo da página de detalhe (set / pokemon / artist / trainer), carimbado no
  // <html> pelo MESMO motivo do data-cardlang: sai da URL, e sair daqui é sair
  // antes do primeiro paint. Nas páginas de SET o cabeçalho de texto (eyebrow
  // "Set" + título gigante) não existe — o hero logo abaixo já traz o nome —, e
  // o detail.js recolhia os dois só quando executava, DEPOIS do primeiro paint:
  // a faixa do topo pintava alta e larga e depois encolhia, levando junto as
  // abas e a busca, que hoje moram na mesma fileira. Com o carimbo aqui o CSS
  // resolve isso antes de haver o que mover (ver html[data-detail] no
  // styles.css). O detail.js continua marcando `hidden` — este atributo só
  // ganha a corrida do paint, não é a fonte da verdade.
  if (/(^|\/)detail(\.html)?$/.test((location.pathname || "").replace(/\/+$/, ""))) {
    try {
      var dType = new URLSearchParams(location.search).get("type") || "";
      if (/^[a-z]+$/.test(dType)) document.documentElement.setAttribute("data-detail", dType);
    } catch (e) { /* URL estranha: segue sem carimbo, o detail.js recolhe depois */ }
  } else if (TELA_DO_SET.test(location.pathname || "")) {
    // Endereço do set (ou da carta): é sempre a página de SET.
    document.documentElement.setAttribute("data-detail", "set");
  }

  // Modo manifest (produção): o deploy flipa esta flag pra true (sed em game.js).
  // No modo manifest, cards/indexes/pricing viram os arquivos .generated mesclados.
  var MANIFEST = false; /* SLEEVU_MANIFEST */

  // Hosts de imagem já ESPELHADOS por completo no R2 (img.sleevu.app): o
  // deploy preenche a lista (scripts/apply-img-mirror.mjs) com o status que o
  // job de espelho publica. Vazia = toda imagem vem da origem, como sempre.
  var IMG_MIRROR_HOSTS = []; /* SLEEVU_IMG_MIRROR */

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
    // set-id-map é a MESMA história e faltava a guarda: o de-para de id de set
    // pro fallback de imagem EN só existe no Pokémon (build-set-id-map.mjs), mas
    // detail/sets/cards declaram o token pra todo jogo — 11 dos 12 pagavam um
    // 404 por pageview.
    if (token === "set-id-map" && cfg.slug !== "pokemon") return null;
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
    imgMirrorHosts: IMG_MIRROR_HOSTS,
    catalogReady: catalogReady,
    // O registro INTEIRO, não só o jogo da sessão: nas páginas neutras a sessão
    // é "hub" (name = "Sleevu"), mas elas mostram todos os jogos e precisam do
    // nome de cada um. O CSV do Portfólio lê daqui (csvGameName no portfolio.js).
    games: GAMES,
    // Linha vinda do endereço (/games/naruto-data-carddass): o lineParamOf do
    // shared.js lê daqui antes do ?line=.
    line: linhaDaUrl,
    // Endereço da tela de Sets de um jogo (e linha), e o de um set: os links
    // da tela de Sets, do hub e do "compartilhar" saem daqui.
    urlDoJogo: urlDoJogo,
    urlDoSet: urlDoSet
  };
})();
