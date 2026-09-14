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
//
// 2026-09-03: teto do CSS sobe de 44.032 pra 46.080. O CSS cresceu ~4 KB gz em
// cinco dias de feature deliberada (showcase em pilha, modo compacto, linha de
// título com Ordenar/Visualização/Filtros) e estourou por ~130 bytes. Antes de
// subir, saiu o que era morto de verdade (.hero-cards, .tag-chip, um comentário
// mal fechado que vazava prosa pro CSS, duas @media iguais fundidas); o que
// sobrou de "duplicado" é o fallback de @media pras container queries, que é
// intencional. O número medido aqui é o CSS INTEIRO — em produção o split-css
// tira ~90 KB brutos do núcleo, então o que viaja por página é bem menor.
//
// 2026-09-06: teto do shared.js sobe de 76.800 pra 79.872. O núcleo já estava
// ~900 bytes gz acima desde a importação de backup com prévia/mesclar/desfazer
// (2026-09-05; a main falhava só neste passo), e a Pokédex "já tenho" põe mais
// ~300 bytes gz no shared (store + chave de sync + merge + backup — tem que
// viver aqui porque o sync e o backup são do núcleo). ~3 KB de folga pra não
// voltar a estourar no próximo bloco pequeno; bloco FRIO grande continua tendo
// que ir pra injeção sob demanda.
//
// 2026-09-10: teto do shared.js sobe de 79.872 pra 80.896. A main já estava a
// 148 bytes gz do teto (scanner + miniatura de hover das Impressões), e o
// espelho de imagens no R2 (mirrorImageUrl + espelho na frente da cadeia do
// <img>, +248 bytes gz) é bloco QUENTE — roda em toda grade — e não tem como
// ser injetado sob demanda. 1 KB de folga; o próximo bloco frio continua
// tendo que sair do núcleo.
//
// 2026-09-13: os dois tetos sobem — shared.js de 80.896 pra 81.920 e CSS de
// 46.080 pra 47.104. A main estava VERMELHA desde a tela de busca no molde de
// app (3bde76d): o CSS passou o teto por 14 bytes gz ali e ninguém viu, porque
// os oito commits seguintes de celular (tabbar, card da carta, linha compacta,
// ficha "Detalhes", chips da busca, cartão de patrimônio) só empilharam mais
// ~300 bytes gz em cima — cada um chegava com o CI já falhando e o e-mail de
// falha virou ruído. O shared.js, na mesma leva, ficou a 22 bytes do teto
// (vibrar() háptico do iOS + saneiaHistorico, ambos núcleo: sync e merge).
// Antes de subir, uma varredura de classe sem referência em HTML/JS só achou
// nome montado dinamicamente (variant-${}, rar-${}, is-${kind}, ctr-${v|h}) —
// nada morto pra cortar. ~700 bytes gz de folga no CSS e ~1 KB no JS; bloco
// FRIO grande continua tendo que ir pra injeção sob demanda.
// 2026-09-14: teto do CSS sobe de 47.104 pra 48.128. A main ficou vermelha de
// novo com a Lista de Desejo no molde da Coleção (c7e4b5b), o Admin 2.0
// (267fca3) e a limpeza das abas (380bc5e): +80 linhas de CSS, ~300 bytes gz
// acima do teto — e, como da outra vez, os commits seguintes chegaram com o
// CI já falhando. Neste mesmo dia saíram a página /graded (com a grade
// #gradedGrid) e a seção "Continuar de onde parou" do Hub, então o que dava
// pra cortar de morto já foi cortado. 1 KB de folga; o próximo bloco frio
// grande (o painel do Admin é candidato: só quem administra abre) tem que ir
// pra uma folha por área (split-css) ou injeção sob demanda, não pro núcleo.
const TETOS = [
  { arquivo: "shared.js", teto: 81920, nota: "núcleo JS de toda página" },
  { arquivo: "styles.min.css", teto: 48128, nota: "CSS antes do split por área" },
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
