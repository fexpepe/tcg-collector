// Endereço público de cada jogo (2026-09-30): /games/<url> é a tela de Sets
// daquele jogo; abaixo dela ficam /games/<url>/<set> (a página estática do
// set) e /games/<url>/<set>/<carta> (a página da carta, montada na borda).
// Antes a tela era /sets?game=swu: pro Google, uma variação de /sets com
// canonical pra /sets e descrição falando de Pokémon, ou seja, nenhum jogo
// tinha página própria.
//
// O `url` é o nome OFICIAL do jogo em inglês (regra do Fernando: endereço
// sempre em inglês, porque o site é pra todos). Quem busca digita "star wars
// unlimited", não "swu". A chave interna (swu, ygo, fab…) continua sendo a do
// app, do banco e do localStorage; aqui ela vira APELIDO, e /games/swu
// responde 301 pro endereço cheio.
//
// Linha vintage (GAME_LINES do shared.js) é jogo próprio no endereço, como o
// Explorar já trata: /games/naruto-data-carddass. `prefixos` são os mesmos do
// GAME_LINES: é por eles que um set cai na linha. O jogo principal de uma
// marca com linhas fica com os sets que não são de linha nenhuma.
//
// Fonte da verdade do servidor (Functions) e do build (prerender). O navegador
// tem uma cópia no src/game.js (script clássico, não importa módulo), e o
// tests/games-url.test.mjs trava as duas iguais, confere as linhas contra o
// GAME_LINES do shared.js e os tiles do hub contra esta lista.
//
// A ordem é a do hub (modernos, depois vintage por ano): a página /games
// segue a mesma.
export const JOGOS_URL = [
  { url: "pokemon", game: "pokemon", nome: "Pokémon TCG", logo: "assets/games/game_pokemon.webp" },
  { url: "magic-the-gathering", game: "magic", nome: "Magic: The Gathering", logo: "assets/games/game_magic-v2.webp" },
  { url: "disney-lorcana", game: "lorcana", nome: "Disney Lorcana", logo: "assets/games/game_lorcana-v2.webp" },
  { url: "one-piece-card-game", game: "onepiece", nome: "One Piece Card Game", logo: "assets/games/game_onepiece.webp" },
  { url: "riftbound", game: "riftbound", nome: "Riftbound", logo: "assets/games/game_riftbound-v2.webp" },
  { url: "star-wars-unlimited", game: "swu", nome: "Star Wars: Unlimited", logo: "assets/games/game_swu-v2.webp" },
  { url: "gundam-card-game", game: "gundam", nome: "Gundam Card Game", logo: "assets/games/game_gundam-v2.webp" },
  { url: "flesh-and-blood", game: "fab", nome: "Flesh and Blood", logo: "assets/games/game_fab.webp" },
  { url: "yu-gi-oh", game: "ygo", nome: "Yu-Gi-Oh!", logo: "assets/games/game_ygo-v2.webp" },
  { url: "dragon-ball-fusion-world", game: "dbfw", nome: "Dragon Ball Fusion World", logo: "assets/games/game_dbfw-v2.webp" },
  { url: "digimon-card-game", game: "digimon", nome: "Digimon Card Game", logo: "assets/games/game_digimon-v2.webp" },
  { url: "union-arena", game: "unionarena", nome: "Union Arena", logo: "assets/games/game_unionarena-v2.webp" },
  { url: "cyberpunk-tcg", game: "cyberpunk", nome: "Cyberpunk TCG", logo: "assets/games/game_cyberpunk.webp" },
  { url: "sorcery-contested-realm", game: "sorcery", nome: "Sorcery: Contested Realm", logo: "assets/games/game_sorcery-v2.webp" },
  { url: "naruto-card-game", game: "narutocg", nome: "Naruto Card Game (2027)", logo: "assets/games/game_naruto_2027.webp" },
  { url: "weiss-schwarz", game: "weiss", nome: "Weiß Schwarz", logo: "assets/games/game_weiss.webp" },
  { url: "godzilla-card-game", game: "godzilla", nome: "Godzilla Card Game", logo: "assets/games/game_godzilla.webp" },
  { url: "palworld-official-card-game", game: "palworld", nome: "Palworld Official Card Game", logo: "assets/games/game_palworld.webp" },
  { url: "final-fantasy-tcg", game: "fftcg", nome: "Final Fantasy TCG", logo: "assets/games/game_fftcg.webp" },
  { url: "grand-archive", game: "grandarchive", nome: "Grand Archive TCG", logo: "assets/games/game_grandarchive.webp" },
  { url: "hololive-official-card-game", game: "hololive", nome: "hololive Official Card Game", logo: "assets/games/game_hololive.webp" },
  { url: "shadowverse-evolve", game: "shadowverse", nome: "Shadowverse: Evolve", logo: "assets/games/game_shadowverse.webp" },
  { url: "cardfight-vanguard", game: "vanguard", nome: "Cardfight!! Vanguard", logo: "assets/games/game_vanguard.webp" },
  { url: "duel-masters", game: "duelmasters", nome: "Duel Masters", logo: "assets/games/game_duelmasters.webp" },
  // Os dois jogos vivos do Naruto que não são da Bandai (2026-11-12): o TCG europeu da Cicaboom e as
  // cartas de coleção da Kayou, na edição em inglês. A Kayou usa o logo do Naruto, como o site oficial dela.
  { url: "naruto-mythos-tcg", game: "narutomythos", nome: "Naruto Mythos TCG", logo: "assets/games/game_narutomythos.webp" },
  { url: "naruto-kayou", game: "narutokayou", nome: "Naruto Kayou", logo: "assets/games/game_narutokayou.webp" },
  { url: "gundam-carddass", game: "gcd", nome: "Gundam Carddass", logo: "assets/games/game_gcd-v2.webp", vintage: "1988–1997" },
  { url: "dragon-ball-carddass", game: "dbc", nome: "Dragon Ball Carddass", logo: "assets/games/game_dbc-v3.webp", vintage: "1988–1997" },
  // As três séries paralelas do Carddass de Dragon Ball, jogos próprios desde
  // 2026-11-13 (séries do dbc por um dia). Logo desde 2026-11-14, enviado pelo Fernando.
  { url: "dragon-ball-visual-adventure", game: "dbva", nome: "Dragon Ball Visual Adventure", logo: "assets/games/game_dbva.webp", vintage: "1991–1995" },
  { url: "dragon-ball-super-battle", game: "dbsb", nome: "Dragon Ball Super Battle", logo: "assets/games/game_dbsb.webp", vintage: "1991–1997" },
  { url: "dragon-ball-super-barcode-wars", game: "dbbw", nome: "Dragon Ball Super Barcode Wars", logo: "assets/games/game_dbbw.webp", vintage: "1992–1993" },
  { url: "gundam-war", game: "gw", nome: "Gundam War", logo: "assets/games/game_gw-v2.webp", vintage: "1999–2011" },
  { url: "hunter-x-hunter-carddass", game: "hxh", nome: "Hunter × Hunter Carddass Hyper Battle", logo: "assets/games/game_hxh-v2.webp", vintage: "1999–2001" },
  { url: "one-piece-carddass", game: "onepiece", linha: "opcd", prefixos: ["opcd-"], nome: "One Piece Carddass Hyper Battle", logo: "assets/games/game_onepiece_carddass-v2.webp", vintage: "1999–2002" },
  { url: "harry-potter-tcg", game: "harrypotter", nome: "Harry Potter Trading Card Game", logo: "assets/games/game_harrypotter.webp", vintage: "2001–2002" },
  { url: "lord-of-the-rings-tcg", game: "lotr", nome: "The Lord of the Rings TCG", logo: "assets/games/game_lotr.webp", vintage: "2001–2007" },
  { url: "dragon-ball-z-ccg", game: "dbz", nome: "Dragon Ball Z CCG", logo: "assets/games/game_dbz.webp", vintage: "2000–2006" },
  { url: "one-piece-card-game-2002", game: "onepiece", linha: "op2002", prefixos: ["op2002-"], nome: "One Piece Card Game (2002)", logo: "assets/games/game_onepiece_2002-v2.webp", vintage: "2002–2005" },
  { url: "naruto-card-game-2002", game: "naruto", nome: "Naruto Card Game (2002~2006)", logo: "assets/games/game_naruto_vintage.webp", vintage: "2002~2006" },
  { url: "naruto-data-carddass", game: "naruto", linha: "nrt-dc", prefixos: ["nrt-dc-", "nrt-nf-", "nrt-nx-"], nome: "Naruto Data Carddass", logo: "assets/games/game_naruto_datacarddass.webp", vintage: "2005–2010" },
  { url: "naruto-ccg", game: "naruto", linha: "nrt-ccg", prefixos: ["nrt-ccg-"], nome: "Naruto Collectible Card Game", logo: "assets/games/game_naruto_ccg-v3.webp", vintage: "2006–2013" },
  { url: "world-of-warcraft-tcg", game: "wow", nome: "World of Warcraft TCG", logo: "assets/games/game_wow.webp", vintage: "2006–2013" },
  // Sem logo recortado ainda: vale o genérico do Naruto, o mesmo dos sets da linha.
  { url: "naruto-shippuden-card-game", game: "naruto", linha: "nrt-scg", prefixos: ["nrt-scg-"], nome: "Naruto Shippuden Card Game", logo: "assets/games/game_naruto.webp", vintage: "2007–2008" },
  { url: "miracle-battle-carddass", game: "mbc", nome: "Miracle Battle Carddass", logo: "assets/games/game_mbc.webp", vintage: "2009–2014" },
  // Cartas de coleção da Amada e da Ensky (2026-11-13): jogo próprio, sem logo recortado de nenhum produto; vale o do Naruto, a marca impressa.
  // O período é o da família (2003–2006); o catálogo tem os quatro produtos com lista carta a carta (2004–2005).
  { url: "naruto-trading-cards", game: "narutotc", nome: "Naruto Trading Cards", logo: "assets/games/game_naruto.webp", vintage: "2003–2006" },
  // Chrono Clash System (2026-11-13): jogo próprio, só com as Tournament Pack Cards, o que o TCGplayer lista carta a carta.
  { url: "naruto-boruto-card-game", game: "narutoboruto", nome: "Naruto Boruto Card Game", logo: "assets/games/game_naruto_boruto.webp", vintage: "2019–2020" },
  { url: "carddass-masters", game: "cdm", nome: "Carddass Masters", logo: "assets/games/game_cdm-v2.webp", vintage: "1996–2011" }
];

// Linha que virou SEÇÃO de outra: o mesmo LINE_ALIASES do shared.js.
export const LINHAS_APELIDO = { "nrt-nf": "nrt-dc", "nrt-nx": "nrt-dc" };

// Linha que virou JOGO próprio (o LINHA_VIROU_JOGO do src/game.js): o Miracle
// Battle era uma linha em cada marca até 2026-10-01 e virou o jogo mbc. O
// ?line= e o /games/<endereço> antigos levam pro jogo novo; o set e a carta
// abaixo do endereço seguem com o mesmo slug (o nome do set não mudou).
// O Gundam Carddass foi linha do gundam por um dia (10/11/2026): o ?line=gcd
// de quem guardou o link abre o jogo gcd. O NARUTO CARD GAME de 2027 foi a
// linha nrt-ncg do naruto até 11/11/2026 e virou o jogo narutocg.
export const LINHAS_VIRARAM_JOGO = { "op-mb": "mbc", "nrt-mb": "mbc", "hxh-mb": "mbc", "gcd": "gcd", "nrt-ncg": "narutocg" };
// Set que mudou de JOGO (2026-11-13): Super Battle, Visual Adventure e Super
// Barcode Wars foram séries do dbc por um dia (PR #299) e viraram os jogos
// dbsb, dbva e dbbw. O set e a carta seguem com o MESMO slug (o do set sai do
// setId, que não mudou: dbc-sb01-1); só o jogo do endereço muda, e a borda
// responde 301 (functions/games/[[path]].js). Endereço antigo do jogo ->
// [começo do slug do set, endereço novo]. O "95ex" é o '95EX da Visual
// Adventure, o único set cujo slug não sai do setId.
export const SETS_MUDARAM_DE_JOGO = {
  "dragon-ball-carddass": [["dbc-sb", "dragon-ball-super-battle"], ["dbc-va", "dragon-ball-visual-adventure"],
    ["95ex", "dragon-ball-visual-adventure"], ["dbc-bw", "dragon-ball-super-barcode-wars"]]
};
// Endereço de hoje do jogo de um set que saiu de `url`, ou null.
export function jogoNovoDoSet(url, set) {
  const regras = SETS_MUDARAM_DE_JOGO[String(url || "")];
  const s = String(set || "");
  const r = regras && regras.find(([inicio]) => s.startsWith(inicio));
  return r ? r[1] : null;
}
const ENDERECOS_ANTIGOS = {
  "one-piece-miracle-battle": "miracle-battle-carddass",
  "naruto-miracle-battle": "miracle-battle-carddass",
  "hunter-x-hunter-miracle-battle": "miracle-battle-carddass"
};

// /games/<apelido> responde 301 pro endereço oficial. As chaves internas (o
// ?game= e o ?line= de hoje) entram aqui sozinhas; o resto são as abreviações
// que a comunidade usa e os endereços que deixaram de existir.
export const APELIDOS = (() => {
  const a = { mtg: "magic-the-gathering", yugioh: "yu-gi-oh", ws: "weiss-schwarz", ...ENDERECOS_ANTIGOS };
  for (const j of JOGOS_URL) {
    if (j.linha) a[j.linha] = j.url;
    else if (j.game !== j.url) a[j.game] = j.url;
  }
  for (const [velha, nova] of Object.entries(LINHAS_APELIDO)) a[velha] = a[nova];
  for (const [linha, jogo] of Object.entries(LINHAS_VIRARAM_JOGO)) a[linha] = a[jogo] || jogo;
  return a;
})();

const POR_URL = new Map(JOGOS_URL.map((j) => [j.url, j]));

// A entrada do registro para /games/<url>, ou null. Só o endereço oficial:
// apelido é resolvido à parte (vira redirect, não página).
export function jogoDaUrl(url) {
  return POR_URL.get(String(url || "")) || null;
}

// Endereço oficial de um apelido (ou do próprio oficial), ou null.
export function urlOficial(url) {
  const u = String(url || "").toLowerCase();
  if (POR_URL.has(u)) return u;
  return Object.prototype.hasOwnProperty.call(APELIDOS, u) ? APELIDOS[u] : null;
}

// /games/<url> de um jogo (e linha): o que o ?game=&line= de hoje vira.
export function urlDoJogo(game, linha) {
  let l = String(linha || "");
  if (Object.prototype.hasOwnProperty.call(LINHAS_VIRARAM_JOGO, l)) return urlDoJogo(LINHAS_VIRARAM_JOGO[l], "");
  if (Object.prototype.hasOwnProperty.call(LINHAS_APELIDO, l)) l = LINHAS_APELIDO[l];
  const achou = JOGOS_URL.find((j) => j.game === game && (l ? j.linha === l : !j.linha));
  // Linha desconhecida cai no jogo principal, como o lineScope do shared.js
  // faz com um ?line= que ele não conhece.
  return achou ? achou.url : (l ? urlDoJogo(game, "") : null);
}

// Em que /games/<url> mora um set: o da linha cujo prefixo casa com o setId,
// senão o do jogo principal.
export function urlDoSet(game, setId) {
  const id = String(setId || "");
  const linha = JOGOS_URL.find((j) => j.game === game && j.linha && j.prefixos.some((p) => id.indexOf(p) === 0));
  return linha ? linha.url : urlDoJogo(game, "");
}
