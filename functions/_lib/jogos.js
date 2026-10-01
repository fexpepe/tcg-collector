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
  { url: "star-wars-unlimited", game: "swu", nome: "Star Wars: Unlimited", logo: "assets/games/game_swu.webp" },
  { url: "gundam-card-game", game: "gundam", nome: "Gundam Card Game", logo: "assets/games/game_gundam-v2.webp" },
  { url: "flesh-and-blood", game: "fab", nome: "Flesh and Blood", logo: "assets/games/game_fab.webp" },
  { url: "yu-gi-oh", game: "ygo", nome: "Yu-Gi-Oh!", logo: "assets/games/game_ygo-v2.webp" },
  { url: "dragon-ball-fusion-world", game: "dbfw", nome: "Dragon Ball Fusion World", logo: "assets/games/game_dbfw-v2.webp" },
  { url: "digimon-card-game", game: "digimon", nome: "Digimon Card Game", logo: "assets/games/game_digimon-v2.webp" },
  { url: "union-arena", game: "unionarena", nome: "Union Arena", logo: "assets/games/game_unionarena.webp" },
  { url: "cyberpunk-tcg", game: "cyberpunk", nome: "Cyberpunk TCG", logo: "assets/games/game_cyberpunk.webp" },
  { url: "naruto-card-game", game: "naruto", linha: "nrt-ncg", prefixos: ["nrt-ncg-"], nome: "Naruto Card Game (2027)", logo: "assets/games/game_naruto_2027.webp" },
  { url: "dragon-ball-carddass", game: "dbc", nome: "Dragon Ball Carddass", logo: "assets/games/game_dbc.webp", vintage: "1988–1997" },
  { url: "hunter-x-hunter-carddass", game: "hxh", nome: "Hunter × Hunter Carddass Hyper Battle", logo: "assets/games/game_hxh.webp", vintage: "1999–2001" },
  { url: "one-piece-carddass", game: "onepiece", linha: "opcd", prefixos: ["opcd-"], nome: "One Piece Carddass Hyper Battle", logo: "assets/games/game_onepiece_carddass.webp", vintage: "1999–2002" },
  { url: "one-piece-card-game-2002", game: "onepiece", linha: "op2002", prefixos: ["op2002-"], nome: "One Piece Card Game (2002)", logo: "", vintage: "2002–2005" },
  { url: "naruto-card-game-2002", game: "naruto", nome: "Naruto Card Game (2002~2006)", logo: "assets/games/game_naruto_vintage.webp", vintage: "2002~2006" },
  { url: "naruto-data-carddass", game: "naruto", linha: "nrt-dc", prefixos: ["nrt-dc-", "nrt-nf-", "nrt-nx-"], nome: "Naruto Data Carddass", logo: "assets/games/game_naruto_datacarddass.webp", vintage: "2005–2010" },
  { url: "naruto-ccg", game: "naruto", linha: "nrt-ccg", prefixos: ["nrt-ccg-"], nome: "Naruto Collectible Card Game", logo: "assets/games/game_naruto_ccg.webp", vintage: "2006–2013" },
  { url: "world-of-warcraft-tcg", game: "wow", nome: "World of Warcraft TCG", logo: "assets/games/game_wow.webp", vintage: "2006–2013" },
  { url: "one-piece-miracle-battle", game: "onepiece", linha: "op-mb", prefixos: ["op-mb-"], nome: "Miracle Battle Carddass One Piece", logo: "assets/games/game_onepiece_miracle.webp", vintage: "2010–2014" },
  { url: "hunter-x-hunter-miracle-battle", game: "hxh", linha: "hxh-mb", prefixos: ["hxh-mb-"], nome: "Miracle Battle Carddass Hunter × Hunter", logo: "assets/games/game_hxh_miracle.webp", vintage: "2011–2012" },
  { url: "naruto-miracle-battle", game: "naruto", linha: "nrt-mb", prefixos: ["nrt-mb-"], nome: "Miracle Battle Carddass Naruto Shippuden", logo: "assets/games/game_naruto_miracle.webp", vintage: "2012–2014" }
];

// Linha que virou SEÇÃO de outra: o mesmo LINE_ALIASES do shared.js.
export const LINHAS_APELIDO = { "nrt-nf": "nrt-dc", "nrt-nx": "nrt-dc" };

// /games/<apelido> responde 301 pro endereço oficial. As chaves internas (o
// ?game= e o ?line= de hoje) entram aqui sozinhas; o resto são as abreviações
// que a comunidade usa.
export const APELIDOS = (() => {
  const a = { mtg: "magic-the-gathering", yugioh: "yu-gi-oh" };
  for (const j of JOGOS_URL) {
    if (j.linha) a[j.linha] = j.url;
    else if (j.game !== j.url) a[j.game] = j.url;
  }
  for (const [velha, nova] of Object.entries(LINHAS_APELIDO)) a[velha] = a[nova];
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
