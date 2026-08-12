// Ordem de boot dos módulos de página. Uma `const`/`let` do módulo que o BOOT
// alcança antes da linha da declaração estoura ReferenceError (TDZ) e mata o
// módulo inteiro — a página carrega sem NENHUM listener, e sem nada na tela que
// denuncie o motivo.
//
// Não é hipotético: o cards.js quebrou assim em produção. O boot chamava
// hydrateFiltersDoManifest(), que chama reidratando(), que lê FILTER_SELECTS —
// declarada 20 linhas ABAIXO do boot. Em dev a primeira função voltava logo (não
// há manifest) e a cadeia nunca chegava na constante: o erro existia SÓ no site
// publicado.
//
// Por isso o teste segue a CADEIA de chamadas (boot -> f -> g), e não só o uso
// direto: era exatamente o elo do meio que escondia o problema.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

// Corpo de uma função declarada no módulo, por contagem de chaves.
function corpoDaFuncao(texto, nome) {
  const i = texto.search(new RegExp(`^\\s*(?:async )?function ${nome}\\s*\\(`, "m"));
  if (i < 0) return "";
  const abre = texto.indexOf("{", i);
  if (abre < 0) return "";
  let nivel = 1, k = abre + 1;
  while (k < texto.length && nivel) {
    if (texto[k] === "{") nivel++;
    else if (texto[k] === "}") nivel--;
    k++;
  }
  return texto.slice(abre, k);
}

// Tudo que o boot alcança: as funções chamadas nele, e as que elas chamam.
// Dois níveis bastam pro padrão real (boot -> hydrate -> reidratando) e mantêm
// a varredura barata e previsível.
function alcancadasPeloBoot(texto, linhas, ateLinha) {
  const diretas = new Set();
  linhas.slice(0, ateLinha).forEach((l) => {
    const m = /^ {2}([a-zA-Z_$][\w$]*)\s*\(/.exec(l);
    if (m) diretas.add(m[1]);
  });
  const todas = new Set(diretas);
  for (const nome of diretas) {
    const corpo = corpoDaFuncao(texto, nome);
    for (const m of corpo.matchAll(/\b([a-zA-Z_$][\w$]*)\s*\(/g)) todas.add(m[1]);
  }
  // Terceiro nível: o corpo das funções que o segundo nível chama.
  for (const nome of [...todas]) {
    const corpo = corpoDaFuncao(texto, nome);
    for (const m of corpo.matchAll(/\b([a-zA-Z_$][\w$]*)\s*\(/g)) todas.add(m[1]);
  }
  return todas;
}

function analisar(texto) {
  const linhas = texto.split("\n");
  // Primeira chamada no nível do módulo = início do boot.
  const iBoot = linhas.findIndex((l) => /^ {2}[a-zA-Z_$][\w$]*\s*\(\s*\)\s*;/.test(l));
  if (iBoot < 0) return [];
  const alcancadas = alcancadasPeloBoot(texto, linhas, iBoot + 1);

  const problemas = [];
  linhas.forEach((l, i) => {
    const m = /^ {2}(?:const|let) ([A-Z_][A-Z0-9_]*)\s*=/.exec(l);
    if (!m || i <= iBoot) return;               // declarada antes do boot: segura
    const nome = m[1];
    // A constante é lida por alguma função que o boot alcança?
    for (const fn of alcancadas) {
      const corpo = corpoDaFuncao(texto, fn);
      if (corpo && new RegExp(`\\b${nome}\\b`).test(corpo)) {
        problemas.push(`${nome} (linha ${i + 1}) é lida por ${fn}(), que o boot da linha ${iBoot + 1} alcança`);
        break;
      }
    }
  });
  return problemas;
}

test("nenhuma constante de módulo é alcançada pelo boot antes de existir", () => {
  const problemas = [];
  for (const arq of readdirSync(srcDir).filter((f) => f.endsWith(".js"))) {
    analisar(readFileSync(join(srcDir, arq), "utf8")).forEach((p) => problemas.push(`${arq}: ${p}`));
  }
  assert.deepEqual(problemas, [], "TDZ no boot derruba a página inteira, e só em produção");
});

test("a análise detecta o caso real que quebrou o cards.js", () => {
  // Reprodução mínima do padrão: boot -> f -> g -> CONST declarada depois.
  const comBug = [
    '(function () {',
    '  hydrate();',
    '',
    '  const TABELA = ["a", "b"];',
    '  function usa() { return TABELA.length; }',
    '  function hydrate() { return usa(); }',
    '})();'
  ].join("\n");
  assert.equal(analisar(comBug).length, 1, "o padrão indireto tem que ser pego");

  const corrigido = [
    '(function () {',
    '  const TABELA = ["a", "b"];',
    '  hydrate();',
    '',
    '  function usa() { return TABELA.length; }',
    '  function hydrate() { return usa(); }',
    '})();'
  ].join("\n");
  assert.deepEqual(analisar(corrigido), [], "declarada antes do boot: sem problema");
});
