// Página da raiz não pede arquivo de assets/ que não existe.
//
// O teste existe por causa do S9 do docs/PLANO-TECNICO.md: desde 2026-08-30 o
// index.html apontava pros logos de três lojas (MYP, TCGplayer e
// PriceCharting) que nunca chegaram em assets/shops/ — a ideia era "solta o
// arquivo e o logo aparece". O home.js escondia o ícone quebrado, então
// ninguém via nada na tela, mas era um 404 por logo em TODA visita à home:
// ruído no console, no relatório de erro (k: recurso) e no smoke, que ficou
// preso em 24/25 por isso. Tirados os <img> em 2026-11-14, isto impede a volta.
//
// Só olha caminho RELATIVO ao site e estático (assets/…, ícones da raiz): URL
// de outro host e caminho montado em JS ficam de fora — o primeiro não é
// nosso, o segundo não dá pra ler sem rodar a página.
// Roda com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

// Atributos que fazem o navegador baixar o arquivo. `srcset` pode ter vários
// candidatos ("a.webp 1x, b.webp 2x"): cada um é conferido.
const ATRIBUTO = /\b(src|href|srcset|poster)="([^"]*)"/g;
const NOSSO = /^\/?((?:assets\/|icon[-.]|favicon\.|apple-touch-icon|og-image)[^?#\s]*)/;

export function referenciasDeAssets(html) {
  const semComentario = html.replace(/<!--[\s\S]*?-->/g, "");
  const caminhos = [];
  for (const [, atributo, valor] of semComentario.matchAll(ATRIBUTO)) {
    const candidatos = atributo === "srcset"
      ? valor.split(",").map((c) => c.trim().split(/\s+/)[0])
      : [valor];
    for (const c of candidatos) {
      const m = NOSSO.exec(c);
      if (m) caminhos.push(m[1]);
    }
  }
  return caminhos;
}

test("referenciasDeAssets pega só caminho nosso e ignora comentário", () => {
  const html = `
    <img src="assets/shops/shop_ebay.webp" alt="">
    <!-- <img src="assets/shops/comentado.webp"> -->
    <link rel="icon" href="/favicon.svg">
    <img srcset="assets/a.webp 1x, /assets/b.webp 2x">
    <img src="https://cdn.exemplo.com/assets/x.webp">
    <a href="assets/games/">pasta</a>
    <script src="src/shared.js"></script>`;
  assert.deepEqual(referenciasDeAssets(html), [
    "assets/shops/shop_ebay.webp",
    "favicon.svg",
    "assets/a.webp",
    "assets/b.webp",
    "assets/games/"
  ]);
});

test("toda página da raiz só pede arquivo de assets/ que existe", () => {
  const paginas = readdirSync(raiz).filter((f) => f.endsWith(".html"));
  assert.ok(paginas.length > 10, "achou as páginas da raiz");
  const faltando = [];
  let total = 0;
  for (const pagina of paginas) {
    for (const caminho of referenciasDeAssets(readFileSync(join(raiz, pagina), "utf8"))) {
      total++;
      if (!existsSync(join(raiz, caminho))) faltando.push(`${pagina} → ${caminho}`);
    }
  }
  assert.ok(total > 50, `conferiu ${total} referências (esperava bem mais de 50)`);
  assert.deepEqual(faltando, [], "arquivo pedido pela página e ausente no repositório (404 em toda visita)");
});
