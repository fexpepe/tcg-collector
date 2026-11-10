// O preload do Early Hints só pode ir na resposta HTML (2026-10-08).
//
// O hash-assets pendura `Link: </styles.<hash>.css>; rel=preload` no bloco `/*`
// do _headers, que vale pra TODA resposta. A Cloudflare guarda os arquivos
// imutáveis (JS e CSS com hash, fonte, logos, chunks) por semanas com o header
// do deploy em que foram cacheados, e o Chrome segue `Link: preload` de
// sub-recurso. Medido em produção: cada visita fria baixava de 1 a 10 núcleos
// de CSS de builds antigos (até ~330 KB no Início), com prioridade máxima,
// disputando banda com o shared.js e o catálogo. O `! Link` dos blocos dos
// arquivos tira o header deles; o HTML segue com o Early Hints.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const linhas = readFileSync(join(raiz, "_headers"), "utf8").split("\n");

function cabecalhosDoBloco(caminho) {
  const i = linhas.indexOf(caminho);
  assert.ok(i >= 0, `_headers sem o bloco ${caminho}`);
  const out = [];
  for (let j = i + 1; j < linhas.length && linhas[j].startsWith("  "); j++) out.push(linhas[j].trim());
  return out;
}

test("os blocos dos arquivos tiram o Link de preload do bloco /*", () => {
  for (const bloco of ["/src/*", "/styles.css", "/assets/*", "/data/*"]) {
    assert.ok(cabecalhosDoBloco(bloco).includes("! Link"), `${bloco} sem "! Link": o preload do CSS iria junto de cada arquivo imutável`);
  }
});

test("o hash-assets confere o detach depois de pendurar o Link (deploy para se ele sumir)", () => {
  const hash = readFileSync(join(raiz, "scripts/hash-assets.mjs"), "utf8");
  assert.ok(hash.includes('for (const bloco of ["/src/*", "/styles*", "/assets/*", "/data/*"])'));
  assert.ok(hash.includes('perdeu o "! Link"'));
});

// Os arquivos SOLTOS da raiz (2026-11-10). O `! Link` de cima só cobria as
// pastas, e os ícones, o manifest, o sw.js e o robots.txt seguiam levando o
// preload. Como não mudam entre deploys, a borda só revalida a cópia dela e
// continua servindo o header do deploy em que a guardou: em produção o
// /favicon.svg, o /icon.svg, o /icon-192.png e o /robots.txt apontavam cada um
// pro CSS de um build diferente, todos 404, e o Chrome segue o preload também
// na resposta de imagem. Arquivo novo na raiz sem bloco cai aqui.
test("todo arquivo solto da raiz que vai pro site tira o Link de preload", () => {
  // O que o deploy apaga antes de subir (passo "Remove arquivos que não vão
  // para o site") e o que o Pages lê em vez de servir.
  const naoSobe = new Set(["README.md", "ROADMAP.md", "CLAUDE.md", "codemagic.yaml", "_headers", "_redirects"]);
  const soltos = readdirSync(raiz, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith(".") && !e.name.endsWith(".html") && !naoSobe.has(e.name))
    .map((e) => e.name);
  assert.ok(soltos.includes("favicon.svg") && soltos.includes("sw.js"), "a lista de arquivos da raiz veio vazia?");
  for (const nome of soltos) {
    // styles.css tem o bloco próprio (vira /styles* no deploy), conferido acima.
    assert.ok(cabecalhosDoBloco(`/${nome}`).includes("! Link"), `/${nome} sem "! Link": a resposta dele leva o preload do CSS de um build que já saiu do ar`);
  }
});

test("o que nasce na raiz só no deploy também tira o Link (favicon.ico, sitemaps, .well-known)", () => {
  for (const bloco of ["/favicon.ico", "/sitemap*", "/.well-known/*", "/lancamentos.ics"]) {
    assert.ok(cabecalhosDoBloco(bloco).includes("! Link"), `${bloco} sem "! Link"`);
  }
});
