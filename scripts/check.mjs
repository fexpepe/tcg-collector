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

// 2) Carrega a tabela i18n. São VÁRIOS arquivos: o src/i18n.js (núcleo, que
//    toda página carrega) e os pacotes por página — hoje só o src/i18n-docs.js
//    (privacidade/termos/sobre/ajuda/faq). Todos mesclam em window.TCG_MESSAGES.
const I18N_FILES = srcFiles.filter((f) => /^src\/i18n(-[a-z]+)?\.js$/.test(f));
const I18N_EXTRAS = I18N_FILES.filter((f) => f !== "src/i18n.js");
let MESSAGES = {};
const keysOf = (file) => {
  try {
    const sandbox = { window: {} };
    new Function("window", read(file))(sandbox.window);
    return Object.keys((sandbox.window.TCG_MESSAGES || {}).pt || {});
  } catch (e) { fail(`Não consegui carregar ${file}: ${e.message}`); return []; }
};
try {
  const sandbox = { window: {} };
  for (const f of I18N_FILES) new Function("window", read(f))(sandbox.window);
  MESSAGES = sandbox.window.TCG_MESSAGES || {};
} catch (e) { fail(`Não consegui carregar a tabela i18n: ${e.message}`); }

const ptKeys = new Set(Object.keys(MESSAGES.pt || {}));
const enKeys = new Set(Object.keys(MESSAGES.en || {}));
const esKeys = new Set(Object.keys(MESSAGES.es || {}));

// 2b) Chave DUPLICADA dentro do mesmo idioma. Num objeto literal a última
//     definição vence e a primeira some — sem erro, sem aviso, sem o objeto
//     "parecer" diferente. Foi exatamente o que aconteceu com "market.title":
//     ele já existia ("Cotação de mercado", no preview da carta) e uma chave
//     nova com o mesmo nome ficou morta; a página nova saiu com o texto errado
//     e nenhuma guarda acusou. A paridade pt/en/es também não pega: duplicar
//     nos três idiomas mantém os três "iguais".
//
//     Varre o TEXTO do arquivo, e não o objeto (que já perdeu a informação).
//     A indentação dos blocos e das chaves varia entre os arquivos (o i18n.js
//     usa 4/6 espaços, o i18n-listas.js usa 2/4), então o bloco é achado por
//     regex frouxa e a indentação das CHAVES é a da primeira chave dele — o que
//     também evita descer em objeto aninhado, se algum dia houver um.
for (const arquivo of I18N_FILES) {
  const texto = read(arquivo);
  const blocos = [...texto.matchAll(/\n\s*(pt|en|es):\s*\{/g)];
  if (!blocos.length) { warn(`${arquivo}: não achei os blocos de idioma pra checar chave duplicada`); continue; }
  blocos.forEach((abre, i) => {
    const fim = i + 1 < blocos.length ? blocos[i + 1].index : texto.length;
    const corpo = texto.slice(abre.index, fim);
    const primeira = /\n([ \t]+)"[^"]+":/.exec(corpo);
    if (!primeira) return; // bloco vazio
    const re = new RegExp(`^${primeira[1]}"([^"]+)":`, "gm");
    const vistas = new Set();
    for (const m of corpo.matchAll(re)) {
      if (vistas.has(m[1])) {
        const linha = texto.slice(0, abre.index + m.index).split("\n").length;
        fail(`i18n: "${m[1]}" está DUPLICADA no bloco ${abre[1]} de ${arquivo} (linha ${linha}) — a primeira definição morre em silêncio`);
      } else vistas.add(m[1]);
    }
  });
}

// 2c) window.prompt está BANIDO. Ele é suprimido em webview de Instagram e
//     Facebook — de onde vem boa parte do tráfego brasileiro —, e lá o clique
//     não faz nada: nenhum diálogo, nenhum erro, nenhum jeito de a pessoa saber
//     que o site não quebrou. Batia em criar coleção, marcar alvo de preço e no
//     plano B de toda cópia de link. O substituto é shared.caixaDeTexto (mesma
//     coisa, em HTML). Sem esta guarda, o próximo `prompt` volta em silêncio.
for (const arquivo of srcFiles) {
  const texto = read(arquivo);
  texto.split("\n").forEach((linha, i) => {
    if (/(^|[^.\w])(window\.)?prompt\s*\(/.test(linha.replace(/\/\/.*$/, ""))) {
      fail(`${arquivo}:${i + 1}: window.prompt é suprimido em webview de rede social — use shared.caixaDeTexto`);
    }
  });
}

// 3) Paridade pt/en — toda chave deve existir nos dois idiomas.
for (const k of ptKeys) if (!enKeys.has(k)) fail(`i18n: "${k}" existe em pt mas falta em en`);
for (const k of enKeys) if (!ptKeys.has(k)) fail(`i18n: "${k}" existe em en mas falta em pt`);

// 3b) Espanhol: paridade TOTAL, núcleo e pacotes extras. Era aviso enquanto os
//     pacotes (i18n-docs.js) não tinham tradução; agora que têm, chave sem es é
//     ERRO — é o que mantém o espanhol em dia sem depender de alguém lembrar.
for (const k of esKeys) if (!ptKeys.has(k)) fail(`i18n: "${k}" existe em es mas falta em pt`);
for (const k of ptKeys) if (!esKeys.has(k)) fail(`i18n: "${k}" existe em pt mas falta em es`);

// 3c) O FALLBACK do HTML tem que dizer a mesma coisa que o i18n(pt).
//     Por que isto virou guarda: o subtítulo do Portfólio passou semanas
//     dizendo, EM RUNTIME e nos três idiomas, que o valor da coleção vinha
//     "dos preços que você registrou" — negando o preço automático de mercado
//     na página mais vitrine do site. O HTML tinha a copy nova; o dicionário
//     tinha a velha; e como o applyTranslations sobrescreve o HTML, quem
//     mandava era o dicionário. Ninguém percebeu porque os dois lados existem
//     em arquivos diferentes e nada os comparava.
//
//     O fallback importa por si: é o que o Google indexa e o que aparece no
//     primeiro paint, antes de o i18n aplicar. Divergir é sempre bug — de um
//     lado ou do outro.
//
//     Fallback com MARKUP dentro fica de fora: ali o HTML é estrutura, não
//     texto (o data-i18n-html tem outro contrato).
const semTags = (t) => t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
for (const arquivo of htmlFiles) {
  const txt = read(arquivo);
  for (const m of txt.matchAll(/<([a-z0-9]+)[^>]*\sdata-i18n="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
    const [, , chave, dentro] = m;
    if (dentro.includes("<")) continue;
    const valor = (MESSAGES.pt || {})[chave];
    if (!valor || !dentro.trim()) continue;
    if (semTags(dentro) !== semTags(valor)) {
      fail(`${arquivo}: o fallback de "${chave}" diverge do i18n(pt)\n      HTML: ${semTags(dentro).slice(0, 60)}…\n      i18n: ${semTags(valor).slice(0, 60)}…`);
    }
  }
}

// 3d) aria-label estático precisa de data-i18n-aria.
//     Rótulo de leitor de tela escrito direto no HTML fica em português fixo:
//     quem usa o site em inglês ou espanhol ouvia "Páginas" e "Resumo da
//     coleção" no meio da navegação, enquanto TODO o resto da interface já
//     estava traduzido (os aria-label construídos por JS passam por t()).
//     Eram 148 quando isto entrou; a guarda existe pra não voltarem um a um.
for (const arquivo of htmlFiles) {
  for (const m of read(arquivo).matchAll(/<[^>]*\saria-label="([^"]+)"[^>]*>/g)) {
    if (!m[0].includes("data-i18n-aria")) {
      fail(`${arquivo}: aria-label="${m[1]}" sem data-i18n-aria (fica em pt pra quem usa en/es)`);
    }
  }
}

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

// 7) Pacotes i18n por página: nenhuma chave de um pacote pode ser usada numa
//    página que NÃO o carrega — senão a página mostra a chave crua na tela.
//    É a guarda que torna a divisão segura: dividir de novo (decks, binders…)
//    é só criar o src/i18n-<nome>.js e apontar as páginas que o carregam.
//    Um .js do src conta como "usado" por toda página que carrega aquele .js.
const htmlPorScript = (js) => htmlFiles.filter((h) => read(h).includes(js));
for (const bundle of I18N_EXTRAS) {
  const donas = htmlFiles.filter((h) => read(h).includes(bundle.replace("src/", "src/")));
  if (!donas.length) { warn(`${bundle}: nenhuma página carrega este pacote`); continue; }
  const chaves = new Set(keysOf(bundle));
  for (const f of [...srcFiles.filter((s2) => !I18N_FILES.includes(s2)), ...htmlFiles]) {
    const txt = read(f);
    const usadas = [...chaves].filter((k) => txt.includes(`"${k}"`) || txt.includes(`'${k}'`));
    if (!usadas.length) continue;
    const paginas = f.endsWith(".html") ? [f] : htmlPorScript(f);
    const orfas = paginas.filter((p) => !donas.includes(p));
    if (orfas.length) {
      fail(`${f}: usa ${usadas.slice(0, 2).map((k) => `"${k}"`).join(", ")} do ${bundle}, mas ${orfas.join(", ")} não carrega esse arquivo`);
    }
  }
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
