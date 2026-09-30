// Coluna "Jogo" do CSV do Portfólio (exportPortfolioCsv, no src/portfolio.js).
// Até 2026-09-30 o nome saía de um mapa fixo com 6 jogos, e os 9 que entraram
// pelo TCGCSV/Scryfall (Magic, Yu-Gi-Oh!, Star Wars…) iam pra planilha como
// slug cru ("ygo", "swu"). Agora o nome vem do registro GAMES do src/game.js,
// exposto em window.SLEEVU.games.
//
// O que se trava aqui:
//   - todo jogo com catálogo (o GAME_SLUGS do shared.js, que é o que o
//     Portfólio percorre) sai com nome, nunca com o slug;
//   - o registro fica exposto INTEIRO também na página neutra (sessão "hub"),
//     onde o SLEEVU.name é "Sleevu" e não serve pra coluna;
//   - os 6 nomes que o CSV já escrevia não mudam (planilha de quem já usa);
//   - as duas linhas do export (carta raw e slab) passam pelo nome.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { loadShared } from "./lib/shared-sandbox.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
// Lido sempre em LF: na checkout Windows (core.autocrlf=true) o fonte chega com
// CRLF e as regex que recortam função querem "\n" logo depois da "}".
const ler = (p) => readFileSync(join(raiz, p), "utf8").replace(/\r\n/g, "\n");
const portfolio = ler("src/portfolio.js");

// Roda o game.js de verdade, como na /portfolio: página neutra, sessão "hub".
function carregaGame() {
  const noop = () => {};
  const el = () => ({ setAttribute: noop, appendChild: noop });
  const sandbox = {
    location: { pathname: "/portfolio", search: "", href: "https://sleevu.app/portfolio" },
    localStorage: { getItem: () => null, setItem: noop },
    history: { replaceState: noop, state: null },
    document: { documentElement: el(), head: el(), createElement: el, currentScript: null },
    URL, URLSearchParams
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(ler("src/game.js"), sandbox);
  return sandbox;
}

const sandbox = carregaGame();
const SLEEVU = sandbox.SLEEVU;
// O csvGameName recortado do portfolio.js roda no MESMO sandbox, pra ler o
// window.SLEEVU que o game.js acabou de montar.
const trecho = /  const CSV_GAME_LEGACY = [^\n]*\n  function csvGameName\(g\) \{[\s\S]*?\n  \}\n/.exec(portfolio);
assert.ok(trecho, "não achei o CSV_GAME_LEGACY + csvGameName no src/portfolio.js");
vm.runInContext(`${trecho[0]}\nwindow.__csvGameName = csvGameName;`, sandbox);
const csvGameName = sandbox.__csvGameName;

const { GAME_SLUGS } = loadShared("").TCGShared;

// O que o CSV escrevia antes da troca (mapa fixo de 2026-07-07 a 2026-09-30).
const HISTORICO = {
  pokemon: "Pokémon", lorcana: "Lorcana", onepiece: "One Piece",
  naruto: "Naruto", hxh: "Hunter x Hunter", dbc: "Dragon Ball Carddass"
};

test("todo jogo com catálogo sai com nome na coluna Jogo, nunca com o slug", () => {
  // Os 9 que saíam crus: se sumirem do GAME_SLUGS, o laço abaixo passaria vazio.
  for (const g of ["magic", "fab", "gundam", "dbfw", "ygo", "digimon", "riftbound", "unionarena", "swu"]) {
    assert.ok(GAME_SLUGS.includes(g), `${g} fora do GAME_SLUGS do shared.js`);
  }
  for (const g of GAME_SLUGS) {
    const nome = csvGameName(g);
    assert.equal(typeof nome, "string", `${g}: nome não é texto`);
    assert.ok(nome.trim(), `${g}: nome vazio`);
    assert.notEqual(nome, g, `${g} sai como slug cru no CSV do Portfólio`);
  }
});

test("o registro do game.js fica exposto inteiro também na página neutra (sessão hub)", () => {
  assert.equal(SLEEVU.game, "hub");
  assert.equal(SLEEVU.name, "Sleevu", "o nome da SESSÃO não é o nome do jogo da carta");
  for (const g of GAME_SLUGS) {
    const r = SLEEVU.games && SLEEVU.games[g];
    assert.ok(r && r.dataDir, `${g} está no DATA_GAMES do shared.js e falta no registro GAMES do game.js`);
    assert.ok(r.name, `${g} sem name no registro GAMES do game.js`);
  }
});

test("jogo novo sai com o nome completo do registro, sem mexer no portfolio.js", () => {
  for (const g of GAME_SLUGS) {
    if (g in HISTORICO) continue;
    assert.equal(csvGameName(g), SLEEVU.games[g].name, `${g}: o nome do CSV não é o do registro GAMES`);
  }
  // Completo, não o rótulo curto dos filtros (shared.gameLabel: "Magic", "Star Wars").
  assert.equal(csvGameName("magic"), "Magic: The Gathering");
  assert.equal(csvGameName("swu"), "Star Wars: Unlimited");
});

test("os 6 nomes que o CSV já escrevia não mudam", () => {
  for (const [g, nome] of Object.entries(HISTORICO)) {
    assert.equal(csvGameName(g), nome, `${g}: mudaria a coluna Jogo de quem já usa o CSV`);
  }
});

test("as duas linhas do export (carta raw e slab) usam o nome, não o slug", () => {
  const corpo = /  function exportPortfolioCsv\(\) \{[\s\S]*?\n  \}\n/.exec(portfolio);
  assert.ok(corpo, "não achei o exportPortfolioCsv no src/portfolio.js");
  assert.match(corpo[0], /t\("portfolio\.csv\.card"\), csvGameName\(/);
  assert.match(corpo[0], /t\("portfolio\.csv\.slab"\), csvGameName\(/);
});
