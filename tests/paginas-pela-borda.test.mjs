// Desejos, Badges, Troca e Blog pelo caminho rápido (2026-11-22).
//
// As quatro páginas carregavam "as cartas desta pessoa" com o
// loadOwnedAcrossGames, que baixa o manifesto e o arquivo INTEIRO de cada set
// onde há uma carta. Passaram pro loadOwnedFast: um POST /api/collection só com
// os ids, e os chunks de reserva se a borda cair.
//
// O que a borda NÃO devolve (setTotal, vintage, pokemonName, dexId, setLogo,
// setSymbol) é o que faria a troca de nome de função quebrar CALADA — e o
// servidor estático esconde isso, porque sem /api/collection o site volta
// sozinho pro caminho antigo. Por isso o teste trava as compensações:
//  - Badges: o total do set vem do enrichSetTotals (senão "set completo" nunca
//    desbloqueia) e o vintage vem do isVintageCard (a marca `c.vintage` não
//    chega da borda);
//  - Desejos: o enrichSetTotals redesenha, pro código sair "063/197";
//  - Troca: a chamada da reserva (índice estático) segue no caminho antigo;
//  - Vendas, perfil público, scanner e Portfólio-órfãos NÃO migram (ver o plano
//    de 2026-11-22, pacote 2B).
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
// Normaliza o fim de linha (a cópia no Windows é CRLF) e tira os comentários de
// linha: os comentários citam os nomes que o código não pode mais usar.
const fonte = (arquivo) => readFileSync(join(raiz, arquivo), "utf8")
  .replace(/\r\n/g, "\n")
  .split("\n")
  .map((linha) => linha.replace(/(^|\s)\/\/.*$/, ""))
  .join("\n");

const wishlist = fonte("src/wishlist.js");
const badges = fonte("src/badges.js");
const troca = fonte("src/troca.js");
const blog = fonte("src/blog.js");

test("Desejos, Badges, Troca e Blog carregam pela borda (loadOwnedFast)", () => {
  // Desde 2026-11-28 Desejos e Badges passam pela cópia guardada no aparelho
  // (src/colecao-guardada.js), que é quem chama o loadOwnedFast.
  assert.ok(fonte("src/colecao-guardada.js").includes("shared.loadOwnedFast(pedido)"));
  assert.ok(wishlist.includes('window.TCGGuardada.carrega(pedido, "desejos", recebe, shared.loadFxRates())'));
  assert.ok(!wishlist.includes("loadOwnedAcrossGames"));
  assert.ok(badges.includes('window.TCGGuardada.carrega(idsByGame, "colecao",'));
  assert.ok(!badges.includes("loadOwnedAcrossGames"));
  assert.ok(troca.includes("shared.loadOwnedFast(idsByGame).catch("));
  assert.ok(blog.includes("shared.loadOwnedFast(idsByGame)"));
  assert.ok(!blog.includes("loadOwnedAcrossGames"));
});

test("Desejos completa o setTotal e redesenha quando ele muda", () => {
  // `destas` = as cartas da passada que pediu o total: com a cópia guardada a
  // tela recebe as cartas duas vezes, e o redesenho só vale pras que estão nela.
  assert.ok(wishlist.includes("shared.enrichSetTotals(destas).then((mudou) => { if (mudou && cards === destas) render(); })"));
});

test("Badges: o total do set vem antes do laço por set, e o vintage não depende da marca da borda", () => {
  const enrich = badges.indexOf("await shared.enrichSetTotals(cards)");
  const laco = badges.indexOf("mine.forEach((c) => {");
  assert.ok(enrich > 0, "Badges precisa esperar o enrichSetTotals");
  assert.ok(laco > enrich, "o enrichSetTotals tem de rodar ANTES do laço bySet");
  assert.ok(badges.includes('mine.some((c) => c.game !== "pokemon" && shared.isVintageCard(c))'));
  assert.ok(!/\bc\.vintage\b/.test(badges), "a marca c.vintage não chega da borda");
  // O que impede zerar as conquistas continua, nas duas saídas: a conta que
  // quebra no meio e a carga que não veio (sem rede e sem cópia).
  assert.ok(badges.includes("const naoVeio = () => { render(); finish(); };"));
  assert.ok(badges.includes("calcula(catalog, repetido).catch(naoVeio);"));
  assert.ok(badges.includes(".catch(naoVeio);\n})();"));
});

test("Troca: só a busca migrou; a reserva do índice estático segue no caminho antigo", () => {
  assert.ok(troca.includes("shared.loadOwnedAcrossGames({ [jogo]: achados.map((e) => e.i) })"));
  assert.equal(troca.split("loadOwnedAcrossGames").length - 1, 1);
});

test("as páginas que dependem do conjunto inteiro continuam no caminho antigo", () => {
  assert.ok(fonte("src/sales.js").includes("shared.loadOwnedAcrossGames("));
  assert.ok(fonte("src/collection.js").includes("shared.loadOwnedAcrossGames(idsByGame)"));
  assert.ok(fonte("src/scan.js").includes("shared.loadOwnedAcrossGames(porJogo)"));
  assert.ok(fonte("src/portfolio.js").includes("shared.loadOwnedAcrossGames(porJogo)"));
});
