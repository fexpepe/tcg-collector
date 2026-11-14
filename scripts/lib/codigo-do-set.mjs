// CÓDIGO OFICIAL do set — o que vem no booster/caixa e, em vários jogos, no
// número da carta: OP17, GD05, BT27, FB11, UE24BT, MEW, LOB…
// (pedido de 2026-11-12: "tem gente que não sabe o nome do set OP17 de One
// Piece, mas sabe que é o OP17"). Vira o selo na linha da data, no cartão do
// set na tela de Sets (src/app.js), e entra na busca dela.
//
// Roda no enrich-manifest, que passa em TODO build (rápido ou completo) e
// enxerga as cartas do set: o código sai do número impresso quando o jogo o
// carrega, do setId quando ele já é o código, ou do campo setCode que o sync
// gravou (Pokémon EN/PT, vindo da TCGdex).
//
// Regra de ouro: na dúvida, SEM código. Um selo "PR" ou "JDG" (abreviação que
// o TCGplayer inventou pra um grupo de promos) não ajuda ninguém a reconhecer o
// set, e um código errado atrapalha mais do que a falta dele. Por isso cada
// jogo diz quais FAMÍLIAS de código são de verdade, em vez de mostrar qualquer
// setId.
//
// GRAFIA = a da PSA (decisão de 2026-11-12, a PSA foi a referência pedida).
// A pesquisa daquele dia achou:
//   - Caixa oficial: COM hífen no One Piece e no Digimon ("【OP-01】",
//     "【BT-01】"), SEM no Gundam, Fusion World e Union Arena ("[GD01]",
//     "[FB01]", "[UEX08BT]").
//   - PSA: NUNCA hífen no código — "2022 ONE PIECE OP01-ROMANCE DAWN", "…
//     EB01-EXTRA BOOSTER…", "2024 One Piece PRB01-…", "2021 DIGIMON BT01-03-…",
//     "2026 Gundam GD03-Steel Requiem". O hífen dela separa código e nome.
//   - Número da carta: sempre sem hífen ("OP01-001", "GD01-001").
// Então o selo segue a PSA e o número impresso: OP01, não OP-01. A busca acha
// as duas formas (src/app.js, entryMatchesQuery).

// Família de código por jogo: `re` casa o setId e devolve [sigla, número]
// (ou só [código] com `inteiro`). O número sai com 2 dígitos, menos onde o
// fabricante usa 1 (`semZero`: os starters do Digimon, ST1…ST9).
const FAMILIAS = {
  // ONE PIECE: booster OP, starter ST, extra EB, premium PRB e premium extra
  // PEB. "OP15-EB04" (o TCGplayer juntou a EB04 no OP15) fica OP15; os grupos
  // de evento "OP17 RE", "OP09 ANN", "OP08 PRE" ficam com o código do set pai.
  // Sem código: promos (OP-PR), demo deck (OP-DD), revision pack (OP-RP), o
  // "SD01" e o "LT-01" do TCGplayer, que não batem com produto oficial, e o
  // Carddass de 1999–2002 (op2002-, opcd-).
  onepiece: { re: /^(OP|ST|EB|PRB|PEB)-?(\d{1,2})(?![\d])/ },
  // GUNDAM CARD GAME: GD01, ST01, EB01. Edition Beta (GD01_b), promos e
  // fichas (GCG-PR, RP, EXRP, EXBP) e a Deck Build Box (SC01) ficam sem.
  gundam: { re: /^(GD|ST|EB)(\d{2})$/ },
  // DIGIMON: BT01, EX01, LM01, RB01, AD01, BD01, PB01 e os starters ST1…ST9,
  // ST10… (um dígito até o 9, como a Bandai escreve). O TCGplayer mistura
  // "BT27" e "BT-26"; sai tudo igual. Os combinados (BT01-03, BT18-19) e as
  // promos ficam sem.
  digimon: { re: /^(BT|EX|ST|LM|RB|AD|BD|PB)-?(\d{1,2})(?:$|[ _])/, semZero: ["ST"] },
  // DRAGON BALL SUPER FUSION WORLD: FB01 (booster), FS01 (starter), SB01
  // (manga booster) e ST01 (Story Booster, que no Fusion World é "ST" mesmo).
  dbfw: { re: /^(FB|FS|SB|ST)(\d{2})(?:$|_)/ },
  // UNION ARENA: o código inteiro é a sigla (UE01BT, UEX08BT, UE24ST,
  // UP01BT, UE10DC, UE01NC).
  unionarena: { re: /^(U[EP]X?\d{2}(?:BT|ST|DC|NC))(?:$|_)/, inteiro: true },
  // GODZILLA e PALWORLD (Bushiroad): na edição inglesa o código ganha um "E"
  // na frente, e é ele que vem no número da carta (EBP01-075, ETD02-001); o
  // japonês é BP01. O catálogo é o inglês, então o selo bate com a carta.
  // Promos (EPR) e protótipos (PC) sem.
  godzilla: { re: /^(E(?:BP|SD|SC|TD)\d{2})$/, inteiro: true },
  palworld: { re: /^(E(?:BP|SD|SC|TD|SS)\d{2})(?:$|-)/, inteiro: true },
  // HOLOLIVE OFFICIAL CARD GAME: o setId já é o código que a carta imprime
  // antes do hífen ("hBP01-001"), em caixa alta como os outros selos: HBP01,
  // HEB01, HSD12, HYS01. As promos (HPR) ficam sem.
  hololive: { re: /^(H(?:BP|EB|SD|YS)\d{2})$/, inteiro: true },
  // CARDFIGHT!! VANGUARD: o código é o que a carta imprime antes da barra
  // ("DZ-BT16/001EN", "BT01/046EN"), com o hífen da era (G-, V-, D-, DZ-;
  // a série original não tem). Boosters, extras e decks; as promos (PR, VPR,
  // D-PR), os marcadores (V-GM), os eventos e o "KA1-2" ficam sem.
  vanguard: { re: /^((?:(?:DZ|D|V|G)-)?(?:BT|EB|LBT|TBP?|SS|CB|CMB|CHB|TCB|MB|VS|PV|RC|FC|TD|MT|SD|LD|LTD|TTD|PS|CS)\d{2})$/, inteiro: true }
};

// Prefixo de número que aparece em pelo menos `minimo` das cartas do set.
// Usado onde o número impresso CARREGA o código (Yu-Gi-Oh! "LOB-EN001",
// Weiß "UMA/W119-E001", FaB "MON001"): é a prova de que o código é real, e de
// graça acerta os sets em que o setId do TCGplayer é um número (Yu-Gi-Oh!
// "1338" = GX05).
export function prefixoDominante(cartas, re, minimo = 0.6) {
  const conta = new Map();
  let total = 0;
  for (const carta of cartas || []) {
    total++;
    const m = String((carta && carta.number) || "").match(re);
    if (m) conta.set(m[1], (conta.get(m[1]) || 0) + 1);
  }
  let melhor = "", n = 0;
  for (const [p, c] of conta) if (c > n) { melhor = p; n = c; }
  return total && n / total >= minimo ? melhor : "";
}

function formata(familia, sigla, numero) {
  if (familia.inteiro) return sigla;
  const n = String(Number(numero));
  return sigla + ((familia.semZero || []).includes(sigla) ? n : n.padStart(2, "0"));
}

function romano(n) {
  let s = "";
  for (const [v, l] of [[50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]) while (n >= v) { s += l; n -= v; }
  return s;
}

// Nome que denuncia grupo de promo/evento: nesses jogos o setId é abreviação
// do TCGplayer, não código impresso, e promo não tem código de produto.
const NOME_DE_PROMO = /\bpromo|\bjudge\b|organized play|pre-?release|convention|championship|bundle|gift box|weekly play/i;

// Jogos em que o setId do TCGplayer É o código oficial de 3 letras (impresso
// na carta), menos os grupos de promo, que ganham sigla inventada.
const TRES_LETRAS = new Set(["swu", "riftbound"]);

// Pokémon inglês/português: só a era que IMPRIME o código na carta (desde o
// Scarlet & Violet: SVI, MEW, PFL…). Antes dela a carta só tinha o símbolo; o
// código que a TCGdex dá pros antigos (EVO, DAA) é o do jogo online, que nem
// a carta nem a PSA usam ("2016 POKEMON XY EVOLUTIONS", sem código).
const POKEMON_SERIES_COM_CODIGO = new Set(["sv", "me"]);

// Pokémon japonês e chinês tradicional: o setId da TCGdex já é o código da
// caixa e da carta (SV2a, M1L, S12a, SM11b) e os promos são "SV-P", "S-P"…
// Fica nas eras que imprimem o código (Sun & Moon pra cá). Fora disso (XY,
// BW, neo1, PMCG1, web1, os starters sB/smA) é id inventado ou sem marca na
// carta: sem.
const POKEMON_ASIA = /^(?:(?:SV|SM|S|M)\d+[A-Za-z]{0,2}|(?:SV|SM|S|M)-P)$/;

export function codigoDoSet(jogo, entrada, cartas) {
  const id = String((entrada && entrada.id) || "").trim();
  const nome = String((entrada && entrada.name) || "");
  const lingua = String((entrada && entrada.language) || "en");
  const amostra = (cartas && cartas[0]) || {};

  if (jogo === "pokemon") {
    if (lingua === "ja" || lingua === "zh-tw") return POKEMON_ASIA.test(id) ? id : "";
    // EN/PT: o código da TCGdex (abbreviation.official) que o sync gravou.
    // Subcoleção ("SIT:TG") mostra o código do set pai.
    if (amostra.setCode && POKEMON_SERIES_COM_CODIGO.has(amostra.setSerieId)) return String(amostra.setCode).split(":")[0].trim();
    return "";
  }

  if (jogo === "magic") {
    // Scryfall: o código do set em caixa alta, como vem na carta (DFT, TDM).
    return /^[a-z0-9]{3,5}$/i.test(id) ? id.toUpperCase() : "";
  }

  if (jogo === "ygo") {
    // "LOB-EN001", "25YC-EN002": o código vem antes do hífen.
    return prefixoDominante(cartas, /^([A-Z0-9]{2,5})-/);
  }

  if (jogo === "weiss") {
    // "UMA/W119-E001" -> "UMA/W119" (a barra é a grafia da Bushiroad).
    return prefixoDominante(cartas, /^([A-Z0-9]{1,5}\/[A-Z]{1,3}\d{1,3})-/);
  }

  if (jogo === "fab") {
    // "MON001", "1HP042": as 3 primeiras posições, quando o resto é número.
    return prefixoDominante(cartas, /^([A-Z0-9]{3})\d{3}$/);
  }

  if (jogo === "fftcg") {
    // Final Fantasy: o set é um "Opus" numerado, e é assim que a PSA escreve
    // ("FINAL FANTASY OPUS I"). O "OP30" do setId foi o sync que estendeu a
    // abreviação velha do TCGplayer (OP1…OP14) — não é oficial e ainda se
    // confunde com o One Piece. Starter, boss deck e promos ficam sem.
    const m = id.match(/^OP(\d{1,2})$/);
    return m ? `Opus ${romano(Number(m[1]))}` : "";
  }

  if (jogo === "lorcana") {
    // Lorcana não tem sigla: o set é o número que vem no rodapé da carta
    // ("1/204 · EN · 1"), e a comunidade fala "Set 1". O Illumineer's Quest
    // já vem como Q1, Q2… Promos e coleções de evento (P1, D23, cp) sem.
    if (/^\d{1,2}$/.test(id)) return `Set ${Number(id)}`;
    return /^Q\d$/.test(id) ? id : "";
  }

  if (TRES_LETRAS.has(jogo)) {
    // OPP/JDG/PRE/EEP são promos de nome curto; SGN é o "Secret Garden" do
    // Riftbound (3 cartas de brinde), RWB o bundle do Mundial.
    return /^[A-Z]{3}$/.test(id) && !NOME_DE_PROMO.test(nome) && !/^(OPP|JDG|PRE|EEP|SGN|RWB)$/.test(id) ? id : "";
  }

  if (jogo === "mbc") {
    // Miracle Battle Carddass: "mb-db01" -> "DB01", "op-mb-op18" -> "OP18"
    // (o código Bandai, que o nome do set já traz na frente).
    const m = id.match(/-([a-z]{2,4}\d{2})$/);
    return m ? m[1].toUpperCase() : "";
  }

  const familia = FAMILIAS[jogo];
  if (!familia) return "";
  const m = id.toUpperCase().match(familia.re);
  return m ? formata(familia, m[1], m[2]) : "";
}

// Jogo do diretório de dados, como no registro do src/game.js: o Pokémon é a
// raiz ("data/"), o resto é "data/<jogo>/".
export function jogoDoDiretorio(dir) {
  const m = String(dir || "").match(/^data\/([^/]+)\/$/);
  return m ? m[1] : "pokemon";
}
