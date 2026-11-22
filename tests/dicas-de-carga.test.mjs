// Dicas de carga do <head> (2026-11-22): a pré-conexão das imagens aponta pro
// host de onde elas SAEM, e o shared.js desce com prioridade alta.
//
// As dicas antigas eram de antes do espelho (img.sleevu.app): o HTML abria
// conexão com tcgdex e tcgplayer-cdn e o game.js com Scryfall, Lorcast e
// wsrv.nl, enquanto em produção toda carta já saía do espelho. No pouso frio
// da carta em 4G lento a imagem, pedida aos 4,2 s, só chegava aos 7,3 s. E o
// shared.js, por ser `defer`, descia com prioridade baixa: na home dividia a
// banda com 17 logos e levava 6,1 s (2,0 s numa página sem a parede de logos),
// segurando menu, login e a tradução de quem chega em inglês ou espanhol.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { injetaEspelho } from "../scripts/lib/img-mirror.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (arq) => readFileSync(join(raiz, arq), "utf8").replace(/\r\n/g, "\n");
const paginas = readdirSync(raiz).filter((f) => f.endsWith(".html"));
const game = ler("src/game.js");

// Os seis hosts de carta que o espelho cobre em produção (lidos do boot no ar
// em 21/11/2026).
const ESPELHADOS = ["wsrv.nl", "cards.lorcast.io", "tcgplayer-cdn.tcgplayer.com", "assets.tcgdex.net", "cards.scryfall.io", "images.pokemontcg.io"];

// Roda o game.js num navegador de mentira e devolve os hosts em que ele abriu
// pré-conexão SEM crossorigin (os de imagem; os de dado levam `anonymous`).
function preconexoesDeImagem(jogo, hosts) {
  const links = [];
  const store = new Map([["tcg-collector-game-v1", jogo]]);
  const location = { pathname: "/cards", search: "", hash: "", href: "https://sleevu.app/cards" };
  const sandbox = {
    URL, URLSearchParams, location,
    history: { state: null, replaceState() {} },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    document: {
      documentElement: { setAttribute() {}, hasAttribute: () => false },
      head: { appendChild: (l) => { links.push(l); } }, currentScript: null, createElement: () => ({})
    },
    fetch: () => Promise.reject(new Error("sem rede"))
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(injetaEspelho(game, { hosts }), sandbox);
  return links.filter((l) => l.rel === "preconnect" && !l.crossOrigin).map((l) => l.href);
}

test("com o espelho completo, o game.js não abre conexão com origem espelhada", () => {
  assert.deepEqual(preconexoesDeImagem("pokemon", ESPELHADOS), []);
  assert.deepEqual(preconexoesDeImagem("onepiece", ESPELHADOS), []);
  assert.deepEqual(preconexoesDeImagem("lorcana", ESPELHADOS), []);
  assert.deepEqual(preconexoesDeImagem("naruto", ESPELHADOS), []);
  // o símbolo de set do Magic não tem espelho: esse segue
  assert.deepEqual(preconexoesDeImagem("magic", ESPELHADOS), ["https://svgs.scryfall.io"]);
});

test("sem espelho (dev, ou host que saiu da lista), a origem do jogo volta a ser pré-conectada", () => {
  assert.deepEqual(preconexoesDeImagem("pokemon", []), ["https://assets.tcgdex.net", "https://tcgplayer-cdn.tcgplayer.com"]);
  assert.deepEqual(preconexoesDeImagem("magic", []), ["https://cards.scryfall.io", "https://svgs.scryfall.io"]);
  assert.deepEqual(preconexoesDeImagem("lorcana", []), ["https://cards.lorcast.io"]);
  // só um host caiu: os outros continuam pelo espelho
  const semWsrv = ESPELHADOS.filter((h) => h !== "wsrv.nl");
  assert.deepEqual(preconexoesDeImagem("dbc", semWsrv), ["https://wsrv.nl"]);
  assert.deepEqual(preconexoesDeImagem("pokemon", semWsrv), []);
});

test("todo jogo que só tem imagem pelo wsrv.nl está na tabela do game.js", () => {
  // Oito estavam de fora até 2026-11-22 (item B2 do docs/CATALOGO.md).
  for (const jogo of ["naruto", "hxh", "lotr", "dbz", "cdm", "fma", "gcd", "dbc", "dbsb", "dbva", "dbbw", "harrypotter",
    "mbc", "seiya", "seiyatc", "seiyacr", "duelmasters", "herorush", "narutomythos", "narutokayou"]) {
    assert.deepEqual(preconexoesDeImagem(jogo, []), ["https://wsrv.nl"], jogo);
  }
});

test("nenhuma página pré-conecta em origem de carta que o espelho cobre", () => {
  // A exceção é o post do blog, que desenha a imagem pela URL da TCGdex que o
  // autor colou (src/blog-render.js), sem passar pelo espelho.
  for (const arq of paginas) {
    if (arq === "blog-post.html") continue;
    const html = ler(arq);
    for (const host of ESPELHADOS) {
      assert.ok(!html.includes(`rel="preconnect" href="https://${host}"`), `${arq} ainda pré-conecta em ${host}`);
    }
  }
});

test("as páginas de grade de carta pré-conectam no espelho", () => {
  for (const arq of ["detail.html", "cards.html", "explore.html", "collection.html", "sets.html", "search.html", "index.html"]) {
    assert.ok(ler(arq).includes('<link rel="preconnect" href="https://img.sleevu.app">'), arq);
  }
});

test("o shared.js desce com prioridade alta em toda página que o carrega", () => {
  let total = 0;
  for (const arq of paginas) {
    const html = ler(arq);
    if (!html.includes('src="src/shared.js"')) continue;
    total++;
    assert.ok(html.includes('<script defer src="src/shared.js" fetchpriority="high"></script>'), `${arq}: shared.js sem fetchpriority="high"`);
  }
  assert.ok(total >= 40, "a varredura achou as páginas do app");
});
