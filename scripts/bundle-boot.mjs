#!/usr/bin/env node
// Funde src/theme.js + src/game.js num src/boot.js só — passo de DEPLOY.
//
// Por que: os dois são scripts SÍNCRONOS no <head>, antes do <link> do CSS (é o
// que evita o flash de tema errado e resolve o jogo antes de qualquer render).
// Síncrono no head = o parser para e espera. São dois arquivos, então na
// PRIMEIRA visita (sem cache, sem service worker) são duas paradas em série no
// caminho do primeiro paint. Fundidos, é uma. Depois da primeira visita o ganho
// some — isto é otimização de primeira impressão, que é onde o site compete com
// quem já tem app instalado.
//
// Por que é seguro: os dois arquivos são IIFE (nada no escopo global, zero
// colisão ao concatenar) e só o game.js lê document.currentScript — pro
// data-catalog, que a tag fundida carrega igual. A ordem theme→game é a mesma
// das 33 páginas.
//
// ORDEM NO DEPLOY (importa):
//   split-i18n  →  ESTE SCRIPT  →  minify  →  hash-assets
// Depois do split-i18n porque ele injeta o mapa de idiomas DENTRO do theme.js;
// antes do hash-assets porque é ele que põe o hash no nome e reescreve as
// referências (inclusive a que este script acabou de criar).
//
// Uso: node scripts/bundle-boot.mjs [--check]
//   --check só confere que as 33 páginas casam o padrão, sem escrever nada.
import { readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const soConfere = process.argv.includes("--check");

function morra(mensagem) {
  console.error(`bundle-boot: ${mensagem}`);
  process.exit(1);
}

// theme.js e game.js, nesta ordem, com o data-catalog (que varia por página)
// preservado na tag fundida. Entre as duas tags pode haver comentário HTML
// (listas.html e troca.html explicam ali por que o data-catalog é vazio) — ele
// é preservado, e QUALQUER outra coisa no meio faz o script parar: script de
// terceiro entre as duas mudaria a ordem de execução sem ninguém notar.
const PAR = /([ \t]*)<script src="(?:\.?\/)?src\/theme\.js"><\/script>([\s\S]*?)([ \t]*)<script src="(?:\.?\/)?src\/game\.js"( data-catalog="[^"]*")?><\/script>/;
const SO_ESPACO_E_COMENTARIO = /^(?:\s|<!--[\s\S]*?-->)*$/;

function casa(html) {
  const m = html.match(PAR);
  return !!m && SO_ESPACO_E_COMENTARIO.test(m[2]);
}

const paginas = readdirSync(ROOT).filter((f) => f.endsWith(".html"));
const semPar = paginas.filter((f) => !casa(readFileSync(join(ROOT, f), "utf8")));
if (semPar.length) {
  morra(`estas páginas não têm o par theme.js+game.js no formato esperado: ${semPar.join(", ")}.\n`
    + "Alguém mudou a indentação, a ordem ou separou as duas tags — conferir antes de fundir.");
}

if (soConfere) {
  console.log(`bundle-boot: ${paginas.length} páginas com o par theme+game no formato esperado.`);
  process.exit(0);
}

const theme = readFileSync(join(ROOT, "src/theme.js"), "utf8");
const game = readFileSync(join(ROOT, "src/game.js"), "utf8");
writeFileSync(join(ROOT, "src/boot.js"),
  `// Gerado no build por scripts/bundle-boot.mjs: src/theme.js + src/game.js.\n`
  + `// Editar os originais, nunca este arquivo.\n${theme}\n;\n${game}`, "utf8");

let trocadas = 0;
for (const arquivo of paginas) {
  const caminho = join(ROOT, arquivo);
  const antes = readFileSync(caminho, "utf8");
  const depois = antes.replace(PAR, (m, indent, miolo, indentGame, catalogo) => {
    const comentarios = miolo.trim();
    const prefixo = comentarios ? `${indent}${comentarios}\n${indentGame}` : indent;
    return `${prefixo}<script src="src/boot.js"${catalogo || ""}></script>`;
  });
  if (depois !== antes) { writeFileSync(caminho, depois, "utf8"); trocadas++; }
}

// O service worker precacheia o shell por nome. Sem esta troca, o install
// pediria dois arquivos que não existem mais — e como ele usa allSettled, a
// falha seria SILENCIOSA: o boot ficaria fora do cache offline e ninguém saberia.
const swPath = join(ROOT, "sw.js");
const sw = readFileSync(swPath, "utf8");
const swNovo = sw.replace(/"src\/theme\.js",\s*"src\/game\.js",/, '"src/boot.js",');
if (swNovo === sw) morra('não achei "src/theme.js", "src/game.js" no SHELL_ASSETS do sw.js.');
writeFileSync(swPath, swNovo, "utf8");

// Os originais saem: ninguém mais os referencia, e deixá-los faria o
// hash-assets versionar dois arquivos que nenhuma página pede.
unlinkSync(join(ROOT, "src/theme.js"));
unlinkSync(join(ROOT, "src/game.js"));

console.log(`bundle-boot: src/boot.js criado; ${trocadas} páginas apontando pra ele.`);
