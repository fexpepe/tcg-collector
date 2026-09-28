// Testes da linha "Marketplace EU" do preview da carta: o Cardmarket
// (cardmarketUrl/brMarketplaceLinks em src/shared.js). O que está travado aqui:
//   - com o id do produto (a cotação da TCGdex traz), o link é o redirecionamento
//     que o Cardmarket oferece — /<jogo>/Products?idProduct=N, o mesmo formato
//     do Scryfall — e cai direto na página da carta;
//   - sem id, a BUSCA no formato em que o Cardmarket nomeia o produto: o código
//     (One Piece, Digimon, Fusion World), nome + número (Pokémon), só o nome
//     (resto) — sempre o nome em INGLÊS e sem o sufixo de tratamento do TCGplayer;
//   - a linha só existe nos jogos que o Cardmarket vende, e nunca no vintage.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShared } from "./lib/shared-sandbox.mjs";

const api = loadShared("window.__test = { cardmarketUrl, brMarketplaceLinks };").window.__test;

const BASE = "https://www.cardmarket.com/en/";
// O texto que vai no searchString (decodificado), ou null se o link não é busca.
function busca(card) {
  const url = api.cardmarketUrl(card);
  const m = /\/Products\/Search\?searchString=([^&]*)$/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}
// href do chip do Cardmarket no bloco de lojas, ou null se a linha EU não saiu.
function chip(card) {
  const m = /data-mkt="cardmarket" href="([^"]+)"/.exec(api.brMarketplaceLinks(card));
  return m ? m[1].replace(/&amp;/g, "&") : null;
}

test("com o id do produto: link direto na página da carta", () => {
  const pineco = { id: "sv01-001", name: "Pineco", number: "001", setTotal: 198, game: "pokemon" };
  assert.equal(api.cardmarketUrl(pineco, 702298), `${BASE}Pokemon/Products?idProduct=702298`);
  // o id manda mesmo quando a busca seria outra (carta JP com nome em kana)
  const jp = { id: "M2a-126-ja", name: "メガカイリューex", pokemonName: "Dragonite", number: "126", language: "ja", game: "pokemon" };
  assert.equal(api.cardmarketUrl(jp, 861369), `${BASE}Pokemon/Products?idProduct=861369`);
});

test("Pokémon sem id: nome + número como impresso", () => {
  assert.equal(busca({ name: "Pikachu", number: "018", setTotal: 91, game: "pokemon" }), "Pikachu 018");
  assert.equal(busca({ name: "Charizard", number: "4", setTotal: 102, game: "pokemon" }), "Charizard 4");
  // catálogo que grava o total junto do número: só o número vai
  assert.equal(busca({ name: "Charizard", number: "4/102", game: "pokemon" }), "Charizard 4");
  // número com letra (TG, Shiny Vault, promo): o formato do Cardmarket varia,
  // então vai só o nome — busca larga, mas nunca vazia
  assert.equal(busca({ name: "Pikachu", number: "TG05", game: "pokemon" }), "Pikachu");
  assert.equal(busca({ name: "Sobble", number: "SV025", game: "pokemon" }), "Sobble");
});

test("carta japonesa/chinesa: busca pelo nome em inglês", () => {
  assert.equal(busca({ name: "メガカイリューex", pokemonName: "Dragonite", number: "126", language: "ja", game: "pokemon" }), "Dragonite 126");
  // nameEn (o nome da carta inteira, do enrich-ja) vence o da espécie
  assert.equal(busca({ name: "リザードンex", nameEn: "Charizard ex", pokemonName: "Charizard", number: "006", language: "ja", game: "pokemon" }), "Charizard ex 006");
  assert.equal(busca({ name: "小仙奶", pokemonName: "Milcery", number: "051", language: "zh-tw", game: "pokemon" }), "Milcery 051");
  // carta em inglês não troca o nome pelo da espécie
  assert.equal(busca({ name: "Charizard ex", pokemonName: "Charizard", number: "125", language: "en", game: "pokemon" }), "Charizard ex 125");
});

test("One Piece, Digimon e Fusion World: busca pelo código impresso", () => {
  // o Cardmarket nomeia "Foxy (EB04-036) (V.2)": o código acha, o sufixo do TCGplayer não
  assert.equal(busca({ name: "Foxy (Alternate Art)", number: "EB04-036", game: "onepiece" }), "EB04-036");
  assert.equal(busca({ name: "Monkey.D.Luffy", number: "P-001", game: "onepiece" }), "P-001");
  // Digimon: a raridade grudada no número fica de fora
  assert.equal(busca({ name: "Yokomon", number: "BT1-001 R", game: "digimon" }), "BT1-001");
  assert.equal(busca({ name: "Omnimon: Merciful Mode (Rare Pull)", number: "EX13-077 SEC", game: "digimon" }), "EX13-077");
  assert.equal(busca({ name: "Bardock - FB11-123 (Super Alternate Art)", number: "FB11-123", game: "dbfw" }), "FB11-123");
  // sem código no número: cai no nome limpo
  assert.equal(busca({ name: "DON!! Card (Alternate Art)", number: "", game: "onepiece" }), "DON!! Card");
});

test("demais jogos: só o nome, sem o sufixo de tratamento do TCGplayer", () => {
  assert.equal(busca({ name: "Ancestor's Chosen", number: "1", game: "magic" }), "Ancestor's Chosen");
  // Magic "The List" tem código no número, mas o Cardmarket não põe código no nome do Magic
  assert.equal(busca({ name: "Llanowar Elves", number: "DOM-168", game: "magic" }), "Llanowar Elves");
  assert.equal(busca({ name: "Dark Cure", number: "GX05-EN002", game: "ygo" }), "Dark Cure");
  assert.equal(busca({ name: "Ariel - On Human Legs", number: "1", game: "lorcana" }), "Ariel - On Human Legs");
  assert.equal(busca({ name: "Soup Up (Blue)", number: "EVO113", game: "fab" }), "Soup Up");
  assert.equal(busca({ name: "Shadow Clone // Tentacle (Full Art)", number: "T05 // T06", game: "riftbound" }), "Shadow Clone // Tentacle");
});

test("caminho de cada jogo no Cardmarket", () => {
  const caminhos = {
    pokemon: "Pokemon", magic: "Magic", ygo: "YuGiOh", onepiece: "OnePiece", lorcana: "Lorcana",
    digimon: "Digimon", fab: "FleshAndBlood", dbfw: "DragonBallSuper", riftbound: "Riftbound"
  };
  for (const [game, caminho] of Object.entries(caminhos)) {
    const url = chip({ id: `${game}-1`, name: "X", number: "1", game });
    assert.ok(url && url.startsWith(`${BASE}${caminho}/Products/Search?searchString=`), `${game}: ${url}`);
  }
});

test("linha EU só onde o Cardmarket vende, e nunca no vintage", () => {
  // Gundam (seção ainda não aberta), Union Arena (não vendido) e os Carddass
  for (const game of ["gundam", "unionarena", "naruto", "hxh"]) {
    const html = api.brMarketplaceLinks({ id: `${game}-1`, name: "X", number: "1", game });
    assert.doesNotMatch(html, /cardmarket|price\.checkEu|Marketplace EU/, game);
  }
  // One Piece vintage (OP Card Game 2002, Carddass): o Cardmarket só tem o OPCG atual
  assert.equal(chip({ id: "op-mb-op-op-34", name: "モンキー・D・ルフィ", number: "OP 34", language: "ja", vintage: true, game: "onepiece" }), null);
  // a mesma carta vinda da borda (Coleção/Explorar) chega SEM a flag: o prefixo do id decide
  assert.equal(chip({ id: "op2002-baroque-works-12", name: "ルフィ", number: "12", language: "ja", game: "onepiece" }), null);
  assert.ok(chip({ id: "op-544523", name: "Kouzuki Oden", number: "EB01-001", game: "onepiece" }));
  // no Pokémon "vintage" é só data (até 2008) — o Base Set existe no Cardmarket
  assert.equal(chip({ id: "base1-4", name: "Charizard", number: "4", setTotal: 102, setReleaseDate: "1999-01-09", game: "pokemon" }),
    `${BASE}Pokemon/Products/Search?searchString=Charizard%204`);
});

// O caminho ao vivo: o popup abre com a busca e o fillMarketQuote troca o href
// pelo link direto quando a cotação da TCGdex chega com o idProduct.
async function abrePopup({ pricing, conectado = true }) {
  const sb = loadShared("window.__test = { fillMarketQuote };");
  const chipEl = { href: "busca" };
  const section = { isConnected: conectado, hidden: false, innerHTML: "", querySelector: () => null, insertAdjacentHTML() {} };
  sb.document.querySelector = (sel) => (/data-market-quote/.test(sel) ? section : /data-mkt="cardmarket"/.test(sel) ? chipEl : null);
  sb.fetch = async (url) => (/api\.tcgdex\.net/.test(url)
    ? { ok: true, json: async () => ({ pricing }) }
    : { ok: false, json: async () => null });
  await sb.window.__test.fillMarketQuote({ id: "sv01-001", name: "Pineco", number: "001", setTotal: 198, language: "en", game: "pokemon" });
  return chipEl.href;
}

test("cotação da TCGdex com idProduct: o chip passa a abrir a carta direto", async () => {
  assert.equal(await abrePopup({ pricing: { cardmarket: { idProduct: 702298, avg: 0.06 } } }), `${BASE}Pokemon/Products?idProduct=702298`);
});

test("sem idProduct, ou com o popup já em outra carta, o chip fica como estava", async () => {
  assert.equal(await abrePopup({ pricing: { cardmarket: { avg: 0.06 } } }), "busca");
  assert.equal(await abrePopup({ pricing: null }), "busca");
  assert.equal(await abrePopup({ pricing: { cardmarket: { idProduct: 702298 } }, conectado: false }), "busca");
});

test("chip do Cardmarket: medido pelo store_click, abre em aba nova, sem utm", () => {
  const html = api.brMarketplaceLinks({ id: "sv1-25", name: "Pikachu", number: "25", setTotal: 198, game: "pokemon" });
  assert.match(html, /<a class="br-link br-link-cardmarket" data-mkt="cardmarket" href="[^"]+" target="_blank" rel="noopener">Cardmarket<\/a>/);
  // EU é a última linha: depois de BR (Liga) e de EUA (PriceCharting fecha a de lá)
  assert.ok(html.indexOf('data-mkt="cardmarket"') > html.indexOf('data-mkt="pricecharting"'));
  assert.ok(html.indexOf('data-mkt="pricecharting"') > html.indexOf('data-mkt="liga"'));
  assert.doesNotMatch(chip({ id: "sv1-25", name: "Pikachu", number: "25", game: "pokemon" }), /utm_/);
});
