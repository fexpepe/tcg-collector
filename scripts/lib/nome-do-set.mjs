// Nome do set sem o nome do jogo na frente (contrato 7 do docs/CATALOGO.md,
// 2026-11-02).
//
// O TCGplayer, e a TCGCSV que o espelha, põe o jogo na frente dos grupos
// genéricos: "One Piece Promotion Cards", "Flesh and Blood: Promo Cards",
// "Riftbound Judge Promotional Cards". Na página do jogo isso só repete o
// cabeçalho, e o tile corta justo o fim do nome. Todo sync da família TCGCSV
// passa o nome do grupo por aqui, então grupo novo já entra limpo.
//
// Fica como a fonte publica quando a marca abre o TÍTULO de outra obra
// (série, mangá, videogame, filme, evento) e sem ela o nome perde o sentido:
// "Digimon LIBERATOR", "Yu-Gi-Oh! GX Tag Force Promotional Cards",
// "Yu-Gi-Oh! Day Promos". É o mesmo caso do "Pokémon GO" e do "Magic 2015",
// que nem passam por aqui (TCGdex e Scryfall).

// Como o jogo aparece na frente do nome, o mais longo primeiro.
export const NOMES_DO_JOGO = {
  onepiece: ["One Piece"],
  digimon: ["Digimon"],
  fab: ["Flesh and Blood"],
  gundam: ["Gundam"],
  dbfw: ["Dragon Ball Super Fusion World", "Fusion World"],
  riftbound: ["Riftbound"],
  unionarena: ["Union Arena"],
  ygo: ["Yu-Gi-Oh!"],
  swu: ["Star Wars: Unlimited", "Star Wars Unlimited"],
  sorcery: ["Sorcery: Contested Realm", "Sorcery"],
  cyberpunk: ["Cyberpunk TCG", "Cyberpunk"],
  weiss: ["Weiss Schwarz", "Weiß Schwarz"],
  wow: ["World of Warcraft TCG", "World of Warcraft"],
  // NARUTO CARD GAME de 2027 (jogo narutocg; até 11/11/2026, linha do naruto).
  narutocg: ["Naruto Card Game", "Naruto"],
  // Godzilla Card Game: só o nome inteiro do jogo. "Godzilla" sozinho NÃO
  // entra: é o começo de nome de set de verdade ("Godzilla VS. Godzilla",
  // "Godzilla Minus One"), que perderia o monstro.
  godzilla: ["Godzilla Card Game"],
  // Palworld OFFICIAL CARD GAME (Bushiroad, 2026): "Palworld Promo Cards".
  palworld: ["Palworld OFFICIAL CARD GAME", "Palworld Official Card Game", "Palworld"]
};

// Títulos de outra obra que começam com a marca: ficam inteiros. No Yu-Gi-Oh!
// são as séries (GX, 5D's, ZEXAL…, e o mangá "R"), os filmes, os videogames
// (Duel Monsters International) e os eventos (Championship Series, Day).
export const TITULOS_COM_A_MARCA = {
  digimon: /^Digimon LIBERATOR\b/,
  ygo: /^Yu-Gi-Oh! (GX|5D's|ZEXAL|ARC-V|VRAINS|SEVENS|GO RUSH|R |The Movie|Movie|Championship Series|Day|Duel Monsters)/
};

export function nomeDoSet(jogo, nome) {
  const n = String(nome == null ? "" : nome).trim();
  const titulo = TITULOS_COM_A_MARCA[jogo];
  if (titulo && titulo.test(n)) return n;
  for (const marca of NOMES_DO_JOGO[jogo] || []) {
    if (!n.startsWith(marca)) continue;
    // A marca inteira, seguida de espaço, dois-pontos ou travessão:
    // "Gundam Promotional Cards" sim, "Gundamverse" não.
    const resto = n.slice(marca.length);
    if (!/^[\s:–—-]/.test(resto)) continue;
    const limpo = resto.replace(/^[\s:–—-]+/, "");
    if (limpo) return limpo;
  }
  return n;
}
