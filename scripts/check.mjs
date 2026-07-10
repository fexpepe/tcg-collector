// Smoke test estático do Sleevu — roda rápido, sem dependências.
//   node scripts/check.mjs
//
// Pega a classe de bug que mais nos mordeu: chave i18n usada mas inexistente,
// pt/en fora de paridade, sintaxe quebrada e ordem errada de <script>.
import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const errors = [];
const warnings = [];
const fail = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const srcFiles = readdirSync(`${ROOT}/src`).filter((f) => f.endsWith(".js")).map((f) => `src/${f}`);
const htmlFiles = readdirSync(ROOT).filter((f) => f.endsWith(".html"));
const read = (rel) => readFileSync(`${ROOT}/${rel}`, "utf8");

// 1) Sintaxe de todos os JS (src + sw).
for (const f of [...srcFiles, "sw.js"]) {
  try { execSync(`node --check "${ROOT}/${f}"`, { stdio: "pipe" }); }
  catch (e) { fail(`Sintaxe inválida em ${f}: ${String(e.stderr || e).split("\n")[0]}`); }
}

// 2) Carrega a tabela i18n (src/i18n.js define window.TCG_MESSAGES).
let MESSAGES = {};
try {
  const sandbox = { window: {} };
  new Function("window", read("src/i18n.js"))(sandbox.window);
  MESSAGES = sandbox.window.TCG_MESSAGES || {};
} catch (e) { fail(`Não consegui carregar src/i18n.js: ${e.message}`); }

const ptKeys = new Set(Object.keys(MESSAGES.pt || {}));
const enKeys = new Set(Object.keys(MESSAGES.en || {}));

// 3) Paridade pt/en — toda chave deve existir nos dois idiomas.
for (const k of ptKeys) if (!enKeys.has(k)) fail(`i18n: "${k}" existe em pt mas falta em en`);
for (const k of enKeys) if (!ptKeys.has(k)) fail(`i18n: "${k}" existe em en mas falta em pt`);

// 4) Chaves usadas DIRETO — t("x"), tn("x"), data-i18n*="x" — que não existem.
//    (Pega o bug clássico: t("set.officialCards") sem a chave definida.)
const haystack = [...srcFiles, ...htmlFiles].map(read).join("\n");
// Prefixo dinâmico nas DUAS formas: template (`x.${k}`) e concatenação ("x." + k).
const dynPrefixes = [
  ...[...haystack.matchAll(/["'`]([a-zA-Z0-9_.]+)\.\$\{/g)].map((m) => m[1] + "."),
  ...[...haystack.matchAll(/["']([a-zA-Z0-9_.]+)\.["']\s*\+/g)].map((m) => m[1] + ".")
];
const skip = (k) => dynPrefixes.some((p) => k.startsWith(p));
// t("x") e data-i18n="x" exigem "x". tn("x") exige "x.one" e "x.other" (plural).
const tUsed = new Set();
const tnUsed = new Set();
for (const m of haystack.matchAll(/\btn\(\s*["']([a-zA-Z0-9_.]+)["']/g)) tnUsed.add(m[1]);
for (const m of haystack.matchAll(/(?<![a-zA-Z0-9_.])t\(\s*["']([a-zA-Z0-9_.]+)["']/g)) tUsed.add(m[1]);
for (const m of haystack.matchAll(/data-i18n(?:-html|-placeholder)?="([a-zA-Z0-9_.]+)"/g)) tUsed.add(m[1]);
for (const k of tUsed) if (!ptKeys.has(k) && !skip(k)) fail(`i18n: chave usada mas inexistente: "${k}"`);
for (const k of tnUsed) {
  if (skip(k)) continue;
  for (const suf of ["one", "other"]) if (!ptKeys.has(`${k}.${suf}`)) fail(`i18n: plural usado mas falta "${k}.${suf}"`);
}

// 5) Chaves órfãs (definidas e sem nenhuma referência). Considera "referenciada"
//    se a string aparece em qualquer fonte (cobre uso indireto: link("x","nav.y"),
//    arrays [k, key], etc.), se bate um prefixo dinâmico, ou se é variante de
//    plural (.one/.other) cuja base é chamada via tn().
const codeNoI18n = [...srcFiles.filter((f) => f !== "src/i18n.js"), ...htmlFiles].map(read).join("\n");
const literals = new Set([...codeNoI18n.matchAll(/["']([a-zA-Z0-9_.]+)["']/g)].map((m) => m[1]));
const isReferenced = (k) => {
  if (literals.has(k)) return true;
  if (dynPrefixes.some((p) => k.startsWith(p))) return true;
  const m = k.match(/^(.*)\.(one|other|zero|two|few|many)$/);
  return !!(m && literals.has(m[1]));
};
for (const k of ptKeys) if (!isReferenced(k)) warn(`i18n: chave órfã (definida, sem referência): "${k}"`);

// 6) Ordem de scripts: i18n.js antes de shared.js em toda página que usa shared.
for (const f of htmlFiles) {
  const html = read(f);
  if (!html.includes("src/shared.js")) continue;
  const i = html.indexOf("src/i18n.js");
  const s = html.indexOf("src/shared.js");
  if (i < 0) fail(`${f}: carrega shared.js mas não carrega i18n.js`);
  else if (i > s) fail(`${f}: i18n.js precisa vir ANTES de shared.js`);
}

// Relatório. Avisos só listam com --verbose (senão poluem o uso diário).
const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
console.log(`\n  i18n: ${ptKeys.size} chaves (pt) · ${enKeys.size} (en)`);
console.log(`  arquivos: ${srcFiles.length} JS · ${htmlFiles.length} HTML\n`);
if (warnings.length) {
  console.log(`  ⚠ ${warnings.length} aviso(s)${verbose ? ":" : " (rode com --verbose para listar)"}`);
  if (verbose) for (const w of warnings) console.log(`     - ${w}`);
  console.log("");
}
if (errors.length) {
  console.log(`  ✖ ${errors.length} ERRO(S):`);
  for (const e of errors) console.log(`     - ${e}`);
  console.log("");
  process.exit(1);
}
console.log("  ✓ tudo certo\n");
