// A política de robôs de 16/11/2026, nos dois endereços.
//
// sleevu.app: o texto é aberto pra busca e pra IA, inclusive treino; os robôs
// de TREINO não leem as imagens das cartas nem os arquivos de dados.
// img.sleevu.app: imagem indexável por buscador, fora de treino e de resposta
// de IA (são das editoras, dos artistas e das fontes; ver
// scripts/lib/robots-espelho.mjs).
//
// O que se trava aqui é o que quebra calado: robô que acha o próprio nome num
// grupo IGNORA o grupo `*`, então uma regra nova no `*` que não for repetida
// no grupo de treino deixa a tela pessoal aberta só pra eles.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ROBOS_DE_TREINO, robotsDoEspelho } from "../scripts/lib/robots-espelho.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

// Grupos do robots.txt: linhas de User-agent seguidas formam um grupo, e as
// regras valem até o próximo User-agent que venha depois de uma regra.
function grupos(texto) {
  const out = [];
  let atual = null;
  for (const bruta of texto.split("\n")) {
    const l = bruta.replace(/#.*/, "").trim();
    if (!l) continue;
    const [campo, ...resto] = l.split(":");
    const valor = resto.join(":").trim();
    if (/^user-agent$/i.test(campo)) {
      if (!atual || atual.regras.length || atual.sinais.length) { atual = { robos: [], regras: [], sinais: [] }; out.push(atual); }
      atual.robos.push(valor);
    } else if (/^(allow|disallow)$/i.test(campo) && atual) atual.regras.push(`${campo}: ${valor}`);
    else if (/^content-signal$/i.test(campo) && atual) atual.sinais.push(valor);
  }
  return out;
}

const site = grupos(readFileSync(join(raiz, "robots.txt"), "utf8"));
const todos = site.find((g) => g.robos.includes("*"));
const treino = site.find((g) => g.robos.includes("GPTBot"));

test("sleevu.app: texto aberto pra busca e pra IA, inclusive treino", () => {
  assert.ok(todos, "sem o grupo *");
  assert.deepEqual(todos.sinais, ["search=yes, ai-input=yes, ai-train=yes"]);
  assert.ok(!todos.regras.includes("Disallow: /"), "o grupo * não pode fechar o site");
});

test("sleevu.app: o grupo de treino é a lista do robots-espelho, com as mesmas regras do * e sem imagem nem dados", () => {
  assert.ok(treino, "sem o grupo dos robôs de treino");
  assert.deepEqual(treino.robos, ROBOS_DE_TREINO);
  assert.deepEqual(treino.sinais, ["search=yes, ai-input=yes, ai-train=yes"]);
  for (const r of todos.regras.filter((r) => r.startsWith("Disallow"))) {
    assert.ok(treino.regras.includes(r), `"${r}" está no grupo * e falta no de treino: pra eles a tela ficaria aberta`);
  }
  for (const r of ["Disallow: /data/", "Disallow: /assets/cards/", "Disallow: /api/"]) assert.ok(treino.regras.includes(r), `falta "${r}" no grupo de treino`);
  // As páginas em si seguem abertas pra eles: é o texto que eles podem ler.
  for (const r of ["Disallow: /", "Disallow: /games", "Disallow: /games/"]) assert.ok(!treino.regras.includes(r), `"${r}" fecharia o texto pro treino`);
  // Nenhum robô de treino solto em outro grupo (ele leria só aquele).
  for (const g of site) if (g !== treino) for (const r of ROBOS_DE_TREINO) assert.ok(!g.robos.includes(r), `${r} em dois grupos`);
});

test("img.sleevu.app: imagem indexável, fora de treino e de resposta de IA", () => {
  const espelho = grupos(robotsDoEspelho());
  const t = espelho.find((g) => g.robos.includes("*"));
  assert.deepEqual(t.sinais, ["search=yes, ai-input=no, ai-train=no"]);
  assert.ok(t.regras.includes("Allow: /") && t.regras.includes("Disallow: /_index/"));
  const ia = espelho.find((g) => g.robos.includes("GPTBot"));
  assert.deepEqual(ia.robos, ROBOS_DE_TREINO);
  assert.deepEqual(ia.regras, ["Disallow: /"]);
  assert.match(robotsDoEspelho(), /https:\/\/sleevu\.app\/terms#uso-do-catalogo/);
});

test("os links da política apontam pra seção que existe nos Termos", () => {
  assert.match(readFileSync(join(raiz, "terms.html"), "utf8"), /<section id="uso-do-catalogo" data-i18n-html="terms\.s\.reuse">/);
  assert.match(readFileSync(join(raiz, "robots.txt"), "utf8"), /https:\/\/sleevu\.app\/terms#uso-do-catalogo/);
  const docs = readFileSync(join(raiz, "src/i18n-docs.js"), "utf8");
  assert.equal((docs.match(/"terms\.s\.reuse": /g) || []).length, 3, "a seção nos três idiomas");
});
