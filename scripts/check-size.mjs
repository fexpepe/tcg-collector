#!/usr/bin/env node
// Orçamento de peso do app shell.
//
// Por que existe: o elogio que o site persegue ("parece app, não trava") mora
// em dois números — quanto o navegador BAIXA e quanto ele PARSEIA a cada
// navegação. Como o site é multi-página sem bundler, o shared.js e o núcleo do
// CSS viajam em TODA página; cada feature nova os engorda um pouquinho e nada
// no CI acusava isso. Um teto explícito transforma "ficou mais pesado" numa
// decisão consciente (subir o teto, com o diff na frente) em vez de uma erosão
// silenciosa de vinte commits.
//
// Mede o que o usuário de fato recebe: minificado (esbuild, o mesmo do deploy)
// e comprimido (gzip -9 ≈ o que o Cloudflare serve; brotli seria ~15% menor
// ainda, então o teto é conservador de propósito).
//
// Uso:  node scripts/check-size.mjs <dir-com-os-minificados>
//       (o CI já minifica src/*.js em /tmp/ci-min; ver ci.yml)
//
// Ao estourar: não suba o teto por reflexo. Primeiro pergunte se o código novo
// precisa mesmo viver no shared.js — o padrão de injeção sob demanda existe
// (ui-editor.js) e é a saída certa pra bloco frio.
import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

// Tetos em BYTES do arquivo minificado+gzipado. Medidos em 2026-08-29 com
// ~6% de folga: shared.js 70.924 e styles.css 39.970.
const TETOS = [
  { arquivo: "shared.js", teto: 76800, nota: "núcleo JS de toda página" },
  { arquivo: "styles.min.css", teto: 44032, nota: "CSS antes do split por área" },
];

const dir = process.argv[2] || "/tmp/ci-min";
let falhou = false;

for (const { arquivo, teto, nota } of TETOS) {
  const caminho = join(dir, arquivo);
  if (!existsSync(caminho)) {
    console.error(`  ✗ ${arquivo} não encontrado em ${dir} — o passo de minificação rodou?`);
    falhou = true;
    continue;
  }
  const gz = gzipSync(readFileSync(caminho), { level: 9 }).length;
  const pct = Math.round((gz / teto) * 100);
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  if (gz > teto) {
    console.error(`  ✗ ${arquivo}: ${kb(gz)} gz — ESTOUROU o teto de ${kb(teto)} (${nota})`);
    falhou = true;
  } else {
    const alerta = pct >= 95 ? " ⚠ colado no teto" : "";
    console.log(`  ✓ ${arquivo}: ${kb(gz)} gz de ${kb(teto)} (${pct}%)${alerta}`);
  }
}

if (falhou) {
  console.error("\nOrçamento de peso estourado. Ou o código volta a caber, ou o teto sobe\nDE PROPÓSITO neste arquivo (com o porquê no commit).");
  process.exit(1);
}
console.log("\n  ✓ dentro do orçamento");
