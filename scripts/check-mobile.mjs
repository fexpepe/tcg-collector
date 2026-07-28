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
  [/\.mobile-tabbar\s*\{[^}]*bottom:\s*var\(--tabbar-lift\)/, "bottom-bar levantada do chão (bottom: var(--tabbar-lift))"]
];
for (const [re, nome] of invariantes) {
  if (!re.test(css)) erros.push(`regra-guarda REMOVIDA: ${nome}`);
}

// A regra de CSS acima só serve com o JS que mede o espaço e grava a variável.
const loginJs = await readFile(new URL("src/login.js", ROOT), "utf8");
if (!/--ts-scale/.test(loginJs)) erros.push("src/login.js: parou de calcular --ts-scale (a caixa do Turnstile volta a vazar)");

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
