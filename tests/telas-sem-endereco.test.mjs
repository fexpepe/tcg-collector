// Telas sem endereço próprio fora do caminho do buscador (2026-11-10).
//
// Pokémon, artista e treinador abrem na casca /detail?type=…, que é noindex
// (só o set e a carta têm endereço em /games). O Googlebot renderiza o JS e
// seguia os links do app pra elas: a linha "Excluída pela tag noindex" do
// relatório de Páginas tinha 5.707 em 10/11 (só /pokedex expõe ~400 links
// desses), rastreio gasto em página que nunca entra, com 270 mil cartas na
// fila. Os links levam rel="nofollow".
// Não é o robots.txt de propósito: o Twitterbot o respeita, e a tela do
// Pikachu compartilhada no X perderia a prévia que o functions/detail.js monta.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const SRC = new URL("../src/", import.meta.url);
const arquivos = readdirSync(SRC).filter((f) => f.endsWith(".js") && !f.startsWith("i18n"));

// Todo detailUrl de Pokémon, artista ou treinador (ou com o tipo numa
// variável, como a grade de grupos) tem o nofollow por perto: no mesmo
// template, ou no elemento montado logo abaixo.
test("todo link do app pra tela de Pokémon, artista ou treinador leva rel=nofollow", () => {
  const achados = [];
  for (const f of arquivos) {
    const linhas = readFileSync(new URL(f, SRC), "utf8").split("\n");
    linhas.forEach((l, i) => {
      if (!/detailUrl\(\s*("pokemon"|"artist"|"trainer"|type\b|ctx && ctx\.view)/.test(l)) return;
      if (/function detailUrl\(/.test(l)) return;
      // A busca global (Ctrl+K) navega por script (window.location.href), sem
      // <a>: o robô não digita, e não há link pra seguir.
      if (f === "shared.js" && /const push = \(group, type, x\) =>/.test(l)) return;
      const perto = linhas.slice(i, i + 13).join("\n");
      if (!/nofollow/.test(perto)) achados.push(`${f}:${i + 1}: ${l.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(achados, [], `link pra tela noindex sem rel="nofollow":\n${achados.join("\n")}`);
});

test("os geradores conhecidos seguem na lista (a varredura acima não ficou cega)", () => {
  const todos = arquivos.map((f) => readFileSync(new URL(f, SRC), "utf8")).join("\n");
  for (const trecho of [
    'detailUrl("pokemon", item.name))}" rel="nofollow">', // Pokédex (grade)
    'if (type === "artist" || type === "trainer" || type === "pokemon") link.rel = "nofollow";', // grupos
    'el.rel = "nofollow"; // tela noindex', // Pokédex compacta, artistas e treinadores
    'href="${escapeAttribute(href)}" rel="nofollow">${miolo}</a>', // Lendários
    'detailUrl("artist", activeCard.artist, "", jogo))}" rel="nofollow">' // artista na tela da carta
  ]) assert.ok(todos.includes(trecho), trecho);
});

test("o robots.txt não barra as telas (a prévia do link compartilhado depende disso)", () => {
  const robots = readFileSync(new URL("../robots.txt", import.meta.url), "utf8");
  assert.doesNotMatch(robots, /^Disallow:\s*\/detail/m);
});
