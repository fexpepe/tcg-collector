// Carimbo do jogo na barra de endereço (stampGame do src/game.js). Página de
// SESSÃO (/cards, /detail…) ganha ?game=<jogo> pra o link copiado abrir no
// mesmo jogo pra quem recebe. Página que não mostra jogo nenhum NÃO pode
// ganhar: em 18/11/2026 o /login abria como /login?game=pokemon, e o mesmo
// acontecia em Sobre, FAQ, Termos, blog, admin e na 404.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const fonte = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src/game.js"), "utf8");

// Abre `caminho` num navegador de mentira e devolve a busca (?…) que ficou na
// barra depois do game.js rodar. `sessao` é o jogo guardado; `marcas`, os
// atributos que o HTML da página já traz no <html>.
function barraDepois(caminho, { sessao = null, marcas = [] } = {}) {
  const store = new Map(sessao ? [["tcg-collector-game-v1", sessao]] : []);
  const location = { pathname: caminho, search: "", hash: "", href: `https://sleevu.app${caminho}` };
  const sandbox = {
    URL, URLSearchParams, location,
    history: { state: null, replaceState(_s, _t, url) { location.search = new URL(String(url), location.href).search; } },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    document: {
      documentElement: { setAttribute() {}, hasAttribute: (k) => marcas.includes(k) },
      head: { appendChild() {} }, currentScript: null, createElement: () => ({})
    },
    fetch: () => Promise.reject(new Error("sem rede"))
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fonte, sandbox);
  return location.search;
}

test("página de sessão segue carimbada com o jogo", () => {
  assert.equal(barraDepois("/cards"), "?game=pokemon");
  assert.equal(barraDepois("/cards", { sessao: "magic" }), "?game=magic");
  assert.equal(barraDepois("/detail", { sessao: "lorcana" }), "?game=lorcana");
  assert.equal(barraDepois("/pokedex.html"), "?game=pokemon");
});

test("página sem jogo não ganha ?game= na barra", () => {
  const semJogo = ["/login", "/login.html", "/login/", "/about", "/faq", "/help", "/privacy", "/terms",
    "/comparar", "/settings", "/novidades", "/lancamentos", "/blog", "/blog/", "/blog/en/um-post",
    "/blog-post.html", "/blog-editor", "/admin", "/admin/medicao", "/parceiro", "/users/fexpepe"];
  for (const caminho of semJogo) {
    assert.equal(barraDepois(caminho), "", caminho);
    assert.equal(barraDepois(caminho, { sessao: "onepiece" }), "", `${caminho} com sessão`);
  }
});

test("a 404 responde em qualquer endereço e se marca no <html>", () => {
  assert.equal(barraDepois("/endereco-que-nao-existe", { marcas: ["data-sem-jogo"] }), "");
  assert.equal(barraDepois("/cards/sobra", { sessao: "magic", marcas: ["data-sem-jogo"] }), "");
  const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "404.html"), "utf8");
  assert.match(html, /<html[^>]*\sdata-sem-jogo[\s>]/, "404.html perdeu o data-sem-jogo");
});

test("nome parecido com o de página sem jogo não escapa do carimbo", () => {
  assert.equal(barraDepois("/login-novo"), "?game=pokemon");
  assert.equal(barraDepois("/blogueiros"), "?game=pokemon");
});
