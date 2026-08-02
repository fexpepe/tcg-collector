// Reparte os arquivos de tradução (src/i18n*.js, cada um com pt+en+es dentro)
// em um arquivo POR IDIOMA, e liga a página pra carregar SÓ o idioma ativo.
// O i18n.js core viaja em toda página do site com os três idiomas — ~46 KB
// comprimidos dos quais dois terços nunca são lidos. Por idioma: ~16 KB.
//
// Roda NO DEPLOY (--write), antes da minificação — o repositório continua com
// os monólitos, que é onde se edita (e o check.mjs confere paridade en/es).
//
// COMO a página escolhe o arquivo em runtime (a língua é por usuário, então
// não dá pra resolver no HTML estático):
//   1. Este script troca as <script src="src/i18n*.js"> de cada página por um
//      atributo data-i18n-packs="i18n,i18n-docs" no <html> — a LISTA de pacotes que
//      a página usa, sem tag nenhuma.
//   2. O theme.js (síncrono no <head>, já calcula window.SLEEVU_LANG) lê o
//      atributo e document.write() a tag do arquivo certo. document.write de
//      script parser-blocking SAME-ORIGIN não sofre a intervenção do Chrome em
//      2G (ela é só pra terceiros), e o script escrito vira um defer normal —
//      executa ANTES do shared.js, como o monólito executava.
//   3. Os nomes de arquivo entram no theme.js como LITERAIS (o mapa
//      SLEEVU_I18N), porque o hash-assets.mjs reescreve referências por regex —
//      um nome montado por concatenação escaparia da reescrita e viraria 404
//      com cache imutável.
// Em dev nada disso acontece: sem o atributo, o theme.js não escreve nada e as
// tags estáticas dos monólitos continuam no HTML.
//
// A tabela de CADA idioma nasce completa (o check.mjs erra o build se en/es
// perderem paridade com pt), então o fallback `MESSAGES.pt[chave]` do t() é
// teórico — mas os arquivos en/es ainda declaram pt:{} vazio, porque esse
// fallback lê MESSAGES.pt sem guarda e um undefined ali seria TypeError.
import { readFileSync, writeFileSync, unlinkSync, readdirSync, existsSync } from "node:fs";
import vm from "node:vm";

const ESCREVER = process.argv.includes("--write");
const LANGS = ["pt", "en", "es"];

// Todo src/i18n*.js é um pacote de tradução com o MESMO formato (o merge por
// idioma do topo de cada arquivo).
const pacotes = readdirSync("src").filter((f) => /^i18n.*\.js$/.test(f) && !/\.(pt|en|es)\.js$/.test(f));

// Executa o pacote num sandbox e captura as tabelas — parsear o objeto literal
// na unha quebraria na primeira aspa criativa.
function tabelasDe(arquivo) {
  const sandbox = { window: {} };
  vm.runInNewContext(readFileSync(`src/${arquivo}`, "utf8"), sandbox);
  const M = sandbox.window.TCG_MESSAGES;
  if (!M) throw new Error(`${arquivo} não definiu window.TCG_MESSAGES`);
  return M;
}

const mapa = {};   // "i18n" -> { pt: "src/i18n.pt.js", ... }
let bytesAntes = 0, bytesDepois = 0;

for (const arquivo of pacotes) {
  const base = arquivo.replace(/\.js$/, "");
  const tabelas = tabelasDe(arquivo);
  bytesAntes += readFileSync(`src/${arquivo}`, "utf8").length;
  mapa[base] = {};
  for (const lang of LANGS) {
    const tabela = tabelas[lang] || {};
    // pt:{} vazio nos não-pt: ver o comentário do cabeçalho (fallback do t()).
    const corpo = lang === "pt" ? { pt: tabela } : { pt: {}, [lang]: tabela };
    const js = `window.TCG_MESSAGES = window.TCG_MESSAGES || {};\n`
      + `(function (M, novo) { Object.keys(novo).forEach(function (lang) { M[lang] = Object.assign(M[lang] || {}, novo[lang]); }); })(window.TCG_MESSAGES, ${JSON.stringify(corpo)});\n`;
    const nome = `src/${base}.${lang}.js`;
    mapa[base][lang] = nome;
    bytesDepois += js.length;
    if (ESCREVER) writeFileSync(nome, js, "utf8");
  }
  console.log(`  ${arquivo}: ${LANGS.map((l) => `${l}=${Object.keys(tabelas[l] || {}).length} chaves`).join(" · ")}`);
}
console.log(`split-i18n: ${pacotes.length} pacotes -> ${pacotes.length * LANGS.length} arquivos (por página só 1/3 viaja; total ${bytesAntes} -> ${bytesDepois} bytes)`);
if (!ESCREVER) { console.log("(simulação — rode com --write pra gravar)"); process.exit(0); }

// ── theme.js: injeta o mapa de literais no placeholder ─────────────────────
{
  const p = "src/theme.js";
  const antes = readFileSync(p, "utf8");
  const marcador = "var I18N = null; /* SLEEVU_I18N */";
  if (!antes.includes(marcador)) { console.error(`split-i18n: theme.js sem o marcador "${marcador}".`); process.exit(1); }
  writeFileSync(p, antes.replace(marcador, `var I18N = ${JSON.stringify(mapa)};`), "utf8");
}

// ── HTML: tags dos monólitos viram o atributo data-i18n-packs no <html> ──────────
const IGNORAR = new Set([".git", ".github", ".claude", "node_modules", "data", "assets", "scripts", "src"]);
function htmls(dir, acc = []) {
  for (const nome of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(nome.name)) continue;
    if (nome.isDirectory()) htmls(`${dir}/${nome.name}`, acc);
    else if (nome.name.endsWith(".html")) acc.push(`${dir}/${nome.name}`);
  }
  return acc;
}
let paginas = 0;
for (const caminho of htmls(".")) {
  let html = readFileSync(caminho, "utf8");
  const usados = [];
  for (const arquivo of pacotes) {
    const tag = new RegExp(`[ \\t]*<script[^>]*src="src/${arquivo.replace(".", "\\.")}"[^>]*></script>\\n?`);
    if (tag.test(html)) { usados.push(arquivo.replace(/\.js$/, "")); html = html.replace(tag, ""); }
  }
  if (!usados.length) continue;
  if (!/<html[^>]*>/.test(html)) { console.error(`split-i18n: ${caminho} sem <html>?`); process.exit(1); }
  // data-i18n-PACKS, não data-i18n: data-i18n puro é o marcador de elemento
  // traduzível — o aplicador do shared.js faria textContent = t("i18n") no
  // <html> inteiro e apagaria a página (aconteceu na primeira versão).
  html = html.replace(/<html([^>]*)>/, `<html$1 data-i18n-packs="${usados.join(",")}">`);
  writeFileSync(caminho, html, "utf8");
  paginas++;
}
if (!paginas) { console.error("split-i18n: nenhuma página tinha tag de i18n — nada foi ligado."); process.exit(1); }

// ── Service worker: precache dos por-idioma no lugar dos monólitos ─────────
// Os TRÊS idiomas entram no precache (o SW não sabe a língua do usuário na
// instalação, e trocar de idioma offline tem de funcionar). Total de bytes
// igual ao dos monólitos que saem.
{
  const p = "sw.js";
  let sw = readFileSync(p, "utf8");
  for (const arquivo of pacotes) {
    const base = arquivo.replace(/\.js$/, "");
    const entrada = `"src/${arquivo}"`;
    if (!sw.includes(entrada)) { console.error(`split-i18n: sw.js sem ${entrada} no SHELL_ASSETS.`); process.exit(1); }
    sw = sw.replace(entrada, LANGS.map((l) => `"src/${base}.${l}.js"`).join(", "));
  }
  writeFileSync(p, sw, "utf8");
}

// Monólitos fora do workspace: sem isto o hash-assets os versionaria e o
// deploy subiria os dois formatos — o corte viraria só duplicação.
for (const arquivo of pacotes) unlinkSync(`src/${arquivo}`);
console.log(`split-i18n: ${paginas} páginas ligadas, theme.js e sw.js atualizados, monólitos removidos do workspace.`);
