// Logo de set: uma regra só (2026-11-28, D6 do plano da revisão de novembro).
//
// Contrato 3 do docs/CATALOGO.md: set sem logo próprio fica com setLogo "" e a
// tela mostra o NOME. O logo do JOGO em todo set é exceção decidida pelo
// Fernando, jogo a jogo, e fica listada no próprio contrato. Imagem de carta
// como logo é proibida: o One Piece Carddass fazia isso (a arte da 1ª carta de
// cada um dos 16 sets) e o lint-catalog agora reprova.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setsComLogoDeCarta } from "../scripts/lib/logo-de-carta.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const lerCards = (jogo) => {
  const w = {};
  new Function("window", readFileSync(join(raiz, "data", jogo, "cards.js"), "utf8"))(w);
  return w.TCG_CARDS || [];
};

test("setsComLogoDeCarta acusa o setLogo que é a imagem de uma carta do próprio set", () => {
  const cards = [
    { id: "a-1", setId: "a", set: "A", image: "x/c1.webp", setLogo: "x/c1.webp" },
    { id: "a-2", setId: "a", set: "A", image: "x/c2.webp", setLogo: "x/c1.webp" },
    { id: "b-1", setId: "b", set: "B", image: "x/c3.webp", setLogo: "data/jogo/set-logos/b.webp" },
    { id: "c-1", setId: "c", set: "C", image: "x/c4.webp", setLogo: "" },
    { id: "d-1", setId: "d", set: "D", image: "", setLogo: "/assets/games/game_d.webp" }
  ];
  assert.deepEqual(setsComLogoDeCarta(cards), [{ setId: "a", set: "A", logo: "x/c1.webp", cartas: 2 }]);
  assert.deepEqual(setsComLogoDeCarta([]), []);
  assert.deepEqual(setsComLogoDeCarta(undefined), []);
});

test("a mesma imagem em OUTRO set não conta (o padrão é a arte da 1ª carta do próprio set)", () => {
  const cards = [
    { id: "a-1", setId: "a", set: "A", image: "x/c1.webp", setLogo: "" },
    { id: "b-1", setId: "b", set: "B", image: "x/c9.webp", setLogo: "x/c1.webp" }
  ];
  assert.deepEqual(setsComLogoDeCarta(cards), []);
});

test("One Piece: nenhum set do Carddass nem do 2002 usa imagem de carta como logo", () => {
  const cards = lerCards("onepiece");
  assert.deepEqual(setsComLogoDeCarta(cards), []);
  const vintage = cards.filter((c) => /^(opcd|op2002)-/.test(c.setId));
  assert.ok(vintage.length > 1000, "o catálogo vintage do One Piece sumiu do dado");
  assert.deepEqual(vintage.filter((c) => c.setLogo), [], "set vintage do One Piece sem logo próprio mostra o nome (setLogo vazio)");
});

test("o sync do Carddass não deriva setLogo da imagem das cartas", () => {
  const src = readFileSync(join(raiz, "scripts/sync-onepiece-vintage.mjs"), "utf8").replace(/\r\n/g, "\n");
  assert.ok(!/c\.setLogo\s*=/.test(src), "sync-onepiece-vintage.mjs voltou a gravar setLogo por cima do vazio");
  assert.ok(!/\bcover\b/.test(src.replace(/\/\/.*$/gm, "")), "sobrou a tabela `cover` (arte da 1ª carta) no sync-onepiece-vintage.mjs");
});

// O logo do jogo em todo set é exceção por jogo. O contrato 3 lista os jogos
// como estão no dado; jogo novo com logo de jogo no set sem entrar na lista
// (ou jogo da lista que perdeu o logo) quebra aqui, e a decisão é do Fernando.
test("os jogos com logo do jogo no setLogo são exatamente os da exceção do contrato 3", () => {
  const catalogo = readFileSync(join(raiz, "docs/CATALOGO.md"), "utf8").replace(/\r\n/g, "\n");
  const i = catalogo.indexOf("3. **Dado que falta não se inventa.**");
  const f = catalogo.indexOf("4. **Fonte com procedência.**");
  assert.ok(i > 0 && f > i, "contrato 3 não encontrado no docs/CATALOGO.md");
  const contrato = catalogo.slice(i, f);
  const [daExcecao, doNome] = contrato.split("Mostram o nome, e só viram exceção");
  assert.ok(doNome, "o contrato 3 perdeu a lista dos que mostram o nome");

  const slugs = (texto) => new Set([...texto.matchAll(/`([a-z0-9]+)`/g)].map((m) => m[1]));
  const lista = slugs(daExcecao);
  const nome = slugs(doNome);

  const comLogoDoJogo = [];
  for (const jogo of readdirSync(join(raiz, "data"))) {
    if (!existsSync(join(raiz, "data", jogo, "cards.js"))) continue;
    const cards = lerCards(jogo);
    // Logo de jogo ou de franquia do repositório (assets/games/), em vez de um
    // logo curado do set (data/<jogo>/set-logos/ ou data/set-logos/).
    if (cards.some((c) => /^\/?assets\/games\//.test(c.setLogo || ""))) comLogoDoJogo.push(jogo);
  }
  const naLista = comLogoDoJogo.filter((j) => lista.has(j));
  assert.deepEqual(comLogoDoJogo.filter((j) => !lista.has(j)), [], "jogo com logo do jogo no set que o contrato 3 não lista");
  for (const j of comLogoDoJogo) assert.ok(!nome.has(j), `${j} está nas duas listas do contrato 3`);
  // E o contrário: todo slug da exceção ainda é jogo com esse logo no dado.
  const semLogo = [...lista].filter((j) => existsSync(join(raiz, "data", j, "cards.js")) && !naLista.includes(j));
  assert.deepEqual(semLogo, [], "jogo da exceção do contrato 3 que não tem mais logo do jogo no set");
  // Os que o plano manda ficar no nome.
  for (const j of ["gw", "gcd", "seiya", "seiyatc", "seiyacr"]) {
    assert.ok(!comLogoDoJogo.includes(j), `${j} ganhou logo do jogo no set: exceção nova é decisão do Fernando`);
    assert.ok(nome.has(j), `${j} deveria estar na lista dos que mostram o nome`);
  }
});
