// Gera functions/_lib/home-en-textos.js: o texto em inglês de cada chave que a
// home usa, copiado do src/i18n.js (2026-11-28, D3 da revisão de novembro).
//
// A borda (functions/en.js) monta a home em inglês no endereço /en/ e não pode
// carregar o i18n.js inteiro (300 KB nos três idiomas) pra ler ~70 frases. Esta
// tabela é o recorte: as chaves do index.html (data-i18n, data-i18n-html,
// data-i18n-aria) e as duas do <head>, só em inglês. Não há texto à mão: mexeu
// num texto da home no i18n.js, rode
//   node scripts/gen-home-en.mjs
// e commite o arquivo. O tests/home-en.test.mjs reprova se ele ficar pra trás
// (e `--check` faz a mesma conferência na linha de comando).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { chavesDaHome } from "../functions/_lib/home-en.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DESTINO = join(raiz, "functions", "_lib", "home-en-textos.js");

// Tabela do idioma `lang` do pacote src/i18n.js (executado num sandbox, como o
// split-i18n: parsear o objeto na unha quebraria na primeira aspa criativa).
export function tabelaDoIdioma(fonteI18n, lang) {
  const sandbox = { window: {} };
  vm.runInNewContext(fonteI18n, sandbox);
  const M = sandbox.window.TCG_MESSAGES;
  if (!M || !M[lang]) throw new Error(`src/i18n.js sem a tabela "${lang}"`);
  return M[lang];
}

// O conteúdo do módulo. Pura: o teste a chama com os arquivos do disco.
export function moduloDaHome(html, fonteI18n) {
  const en = tabelaDoIdioma(fonteI18n, "en");
  const faltam = chavesDaHome(html).filter((c) => typeof en[c] !== "string");
  if (faltam.length) throw new Error(`chave da home sem texto em inglês no i18n.js: ${faltam.join(", ")}`);
  const linhas = chavesDaHome(html).map((c) => `  ${JSON.stringify(c)}: ${JSON.stringify(en[c])}`);
  return `// GERADO por scripts/gen-home-en.mjs a partir do index.html e do src/i18n.js.
// NÃO edite à mão: mexa no i18n.js e rode \`node scripts/gen-home-en.mjs\`.
// O porquê está em functions/_lib/home-en.js.
export const TEXTOS_HOME_EN = {
${linhas.join(",\n")}
};
`;
}

const lerLF = (caminho) => readFileSync(caminho, "utf8").replace(/\r\n/g, "\n");

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const novo = moduloDaHome(lerLF(join(raiz, "index.html")), lerLF(join(raiz, "src", "i18n.js")));
  if (process.argv.includes("--check")) {
    let atual = "";
    try { atual = lerLF(DESTINO); } catch (e) { /* não existe ainda */ }
    if (atual !== novo) { console.error("home-en-textos.js está desatualizado: rode node scripts/gen-home-en.mjs"); process.exit(1); }
    console.log("home-en-textos.js em dia.");
  } else {
    writeFileSync(DESTINO, novo, "utf8");
    console.log(`home-en-textos.js: ${chavesDaHome(lerLF(join(raiz, "index.html"))).length} chaves.`);
  }
}
