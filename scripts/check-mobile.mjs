// Guarda de regressão MOBILE — estático, sem navegador (o CI é um portão de
// < 1 min; subir Chromium só pra isso não se paga).
//
//   node scripts/check-mobile.mjs
//
// Não tenta simular a cascata do CSS. Faz duas coisas que pegam a regressão
// real: (1) confirma que as regras-guarda continuam existindo — o jeito de
// quebrar isso é alguém apagá-las num refactor; (2) procura os PADRÕES que
// causaram os bugs que já aconteceram aqui.
//
// Histórico que originou cada regra (não apagar sem entender):
//   - .lp-wordmark usava `90vw`: vw ignora o padding do contêiner, então o
//     wordmark encostava/cortava na borda do celular.
//   - inputs com fonte < 16px: o Safari do iOS dá ZOOM ao focar e a página
//     "desfixa" com rolagem lateral.
//   - aria-pressed num <a>: inválido (só vale em role=button); o Lighthouse
//     acusa e o leitor de tela anuncia um botão que não existe.
//   - caixa do Turnstile: o iframe tem 300px fixos e o cartão de login tem
//     264px de conteúdo num celular de 402px — sem o zoom de --ts-scale a
//     caixa nasce mais larga que o campo de e-mail e vaza pela borda.
//   - bottom-bar colada em bottom:0 com padding de safe-area: no PWA do iOS o
//     env() vem ZERO (só vale com viewport-fit=cover), então a barrinha do
//     gesto de home ficava por cima dos rótulos. O piso do max() é que
//     garante a folga — trocar por env() puro traz o bug de volta.
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const erros = [];
const avisos = [];

const css = await readFile(new URL("styles.css", ROOT), "utf8");

// --- 1) As regras-guarda continuam de pé? ----------------------------------
const invariantes = [
  [/img,\s*svg,\s*video[^{]*\{[^}]*max-width:\s*100%/, "reset de mídia (img/svg/video { max-width: 100% })"],
  [/body\s*\{[^}]*overflow-x:\s*clip/, "overflow-x: clip no body"],
  [/@media\s*\(pointer:\s*coarse\),\s*\(max-width:\s*700px\)\s*\{[\s\S]{0,400}?font-size:\s*16px/, "fonte de 16px nos inputs em toque (anti-zoom do iOS)"],
  [/\.login-turnstile\s*>\s*iframe\s*\{[^}]*zoom:\s*var\(--ts-scale/, "zoom do widget do Turnstile (--ts-scale) — sem ele a caixa vaza no celular"],
  [/--tabbar-lift:\s*max\(env\(safe-area-inset-bottom/, "piso do --tabbar-lift (a bottom-bar tem que subir mesmo com env() = 0 no PWA do iOS)"],
  [/\.mobile-tabbar\s*\{[^}]*bottom:\s*var\(--tabbar-lift\)/, "bottom-bar levantada do chão (bottom: var(--tabbar-lift))"],
  // O site deu retorno só por :hover durante muito tempo — que no dedo não
  // existe, e fazia o app parecer lento sem ser. Um refactor de CSS que leve
  // este bloco embora devolve o problema sem ninguém perceber (não quebra
  // nada, só deixa de responder).
  [/@media\s*\(pointer:\s*coarse\)\s*\{[\s\S]{0,900}?:active[^{]*\{[^}]*scale:/, "retorno visual do toque (:active com scale em ponteiro grosso)"],
  [/touch-action:\s*manipulation/, "touch-action: manipulation nos controles (sem ele volta o double-tap-zoom no +1)"]
];
for (const [re, nome] of invariantes) {
  if (!re.test(css)) erros.push(`regra-guarda REMOVIDA: ${nome}`);
}

// A regra de CSS acima só serve com o JS que mede o espaço e grava a variável.
const loginJs = await readFile(new URL("src/login.js", ROOT), "utf8");
if (!/--ts-scale/.test(loginJs)) erros.push("src/login.js: parou de calcular --ts-scale (a caixa do Turnstile volta a vazar)");

// --- 1b) Metas mobile em TODA página ---------------------------------------
// viewport-fit=cover é o que faz o site desenhar sob o notch (e as regras de
// safe-area valerem); as apple-mobile-web-app-* são o que dá tela cheia de
// verdade no iPhone quando instalado. Página nova nasce copiada de outra, e
// quando a cópia vem de uma que já estava incompleta o buraco se propaga.
const METAS = [
  [/name="viewport"[^>]*viewport-fit=cover/, "viewport-fit=cover"],
  [/name="apple-mobile-web-app-capable"/, "apple-mobile-web-app-capable"],
  [/name="theme-color"/, "theme-color"],
];
const paginas = (await readdir(ROOT)).filter((n) => n.endsWith(".html"));
for (const arquivo of paginas) {
  const html = await readFile(new URL(arquivo, ROOT), "utf8");
  for (const [re, nome] of METAS) {
    if (!re.test(html)) avisos.push(`${arquivo}: sem <meta ${nome}>`);
  }
}

// --- 1c) SHELL_ASSETS aponta pra arquivo que existe? -----------------------
// O install do service worker usa Promise.allSettled: um arquivo que não
// existe falha em SILÊNCIO e simplesmente não entra no cache offline. Ou seja,
// renomear um HTML e esquecer o sw.js tira a página do modo avião sem quebrar
// nada visível — o tipo de regressão que só aparece no metrô.
const swSrc = await readFile(new URL("sw.js", ROOT), "utf8");
const lista = swSrc.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/);
if (!lista) {
  erros.push("sw.js: não achei o SHELL_ASSETS (a guarda de precache ficou cega)");
} else {
  // Tira os comentários antes de varrer: eles têm aspas no texto ("trocar de
  // fonte") e virariam nomes de arquivo inexistentes.
  const semComentario = lista[1].replace(/\/\/[^\n]*/g, "");
  for (const m of semComentario.matchAll(/"([^"]+)"/g)) {
    const caminho = m[1];
    if (caminho === "./" || caminho.startsWith("http")) continue;
    // Os src/*.js e styles*.css do i18n/split nascem no build; aqui só valem os
    // que devem existir no repositório.
    if (!existsSync(new URL(caminho, ROOT))) {
      erros.push(`sw.js: SHELL_ASSETS lista "${caminho}", que não existe no disco (o precache falharia calado)`);
    }
  }
}

// --- 2) Padrões que já causaram bug ----------------------------------------
// width/max-width em vw dentro do conteúdo: ignora o padding do contêiner.
// calc(100vw - Npx) é intencional (modais que ocupam a tela) — só sinaliza o
// vw "cru".
// calc(100vw - Npx) e clamp(Npx, Nvw, Npx) são intencionais e seguros (têm
// limite em px); só o vw "cru" é sinalizado.
const vwCru = [...css.matchAll(/^\s*(?:max-)?width:\s*(?:min\()?[^;]*?\b(\d{1,3})vw\b[^;]*;/gm)]
  .filter((m) => !/calc\(|clamp\(/.test(m[0]))
  .map((m) => m[0].trim());
if (vwCru.length) {
  avisos.push(`largura em vw sem calc (ignora o padding do contêiner): ${vwCru.slice(0, 4).join(" | ")}`);
}

// aria-pressed em âncora, dentro dos templates de JS.
const srcDir = new URL("src/", ROOT);
for (const f of (await readdir(srcDir)).filter((n) => n.endsWith(".js"))) {
  const js = await readFile(new URL(f, srcDir), "utf8");
  // <a ... aria-pressed  (na MESMA tag: sem > no meio)
  const m = js.match(/<a\b[^>]{0,200}?aria-pressed/);
  if (m) erros.push(`src/${f}: aria-pressed num <a> — link não aceita (use aria-current)`);
}
// E no HTML servido.
for (const f of (await readdir(ROOT)).filter((n) => n.endsWith(".html"))) {
  const html = await readFile(new URL(f, ROOT), "utf8");
  if (/<a\b[^>]{0,200}?aria-pressed/.test(html)) erros.push(`${f}: aria-pressed num <a>`);
}

// --- Saída ------------------------------------------------------------------
console.log("\nCheck mobile (guardas de layout e toque)");
avisos.forEach((a) => console.log(`  ⚠ ${a}`));
erros.forEach((e) => console.log(`  ✗ ${e}`));
if (!erros.length) console.log(`  ✓ guardas no lugar${avisos.length ? ` (${avisos.length} aviso(s))` : ""}`);
process.exit(erros.length ? 1 : 0);
