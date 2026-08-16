// Põe o HASH DO CONTEÚDO no nome dos arquivos do app shell (src/*.js e o
// styles.css) e troca o Cache-Control deles de `no-cache` para um ano
// `immutable`. Roda no DEPLOY, depois da minificação — o repositório continua
// com os nomes limpos, e isto só existe no workspace do runner (mesmo padrão do
// `sed` que liga o modo manifest no game.js).
//
// Por quê: sem versão na URL, a única forma de um deploy não ficar preso numa
// versão velha era mandar o navegador revalidar SEMPRE (`no-cache` no _headers).
// O efeito era que toda navegação refazia 6 requisições condicionais — theme,
// game, i18n, shared, o js da página e o CSS — só pra ouvir "não mudou". Com o
// hash no nome, o arquivo que não mudou nem é pedido, e o que mudou tem URL
// nova: o problema que o `no-cache` resolvia deixa de existir.
//
// O hash sai do conteúdo JÁ COM AS REFERÊNCIAS REESCRITAS. Isso importa: o
// shared.js injeta "src/ui-editor.js" em runtime, então o conteúdo dele muda
// quando o ui-editor muda. Se o hash do shared saísse antes dessa troca, ele
// ficaria com URL antiga apontando pra um arquivo que não existe mais — e
// `immutable` quer dizer que o navegador não vai conferir. Por isso o cálculo
// itera até o mapa de hashes parar de mudar (ponto fixo).
//
// Uso: node scripts/hash-assets.mjs
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, renameSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, basename } from "node:path";

const ROOT = process.cwd();
const MAX_ROUNDS = 10;
const UM_ANO = "public, max-age=31536000, immutable";

const sha8 = (texto) => createHash("sha256").update(texto).digest("hex").slice(0, 8);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function morra(mensagem) {
  console.error(`hash-assets: ${mensagem}`);
  process.exit(1);
}

// ── 1. Quais arquivos ganham hash ───────────────────────────────────────────
// Só o app shell. O catálogo (data/) fica de fora: é gerado por build e tem
// estratégia de cache própria no service worker.
const assets = [];
for (const arquivo of readdirSync(join(ROOT, "src")).sort()) {
  if (extname(arquivo) === ".js") assets.push({ path: `src/${arquivo}`, base: `src/${arquivo.slice(0, -3)}`, ext: ".js" });
}
// styles.css E as folhas por área (styles-decks.css…, criadas pelo split-css no
// mesmo build). Todas precisam de hash: a regra /styles.* do _headers marca as
// duas como immutable, e immutable SEM hash no nome prende o arquivo pra sempre.
for (const arquivo of readdirSync(ROOT).sort()) {
  if (/^styles(-[\w-]+)?\.css$/.test(arquivo)) assets.push({ path: arquivo, base: arquivo.slice(0, -4), ext: ".css" });
}
if (!assets.length) morra("nada em src/ nem styles.css — abortando.");

const original = new Map(assets.map((a) => [a.path, readFileSync(join(ROOT, a.path), "utf8")]));

// ── 2. Reescrita de referências ─────────────────────────────────────────────
// Casa "src/shared.js", "/src/shared.js" e "./src/shared.js"; nunca o
// "src/shared.js.map" (o sourcemap é tratado à parte, mais abaixo).
const padroes = assets.map((asset) => ({
  asset,
  re: new RegExp(`(?<![\\w.-])((?:\\.?/)?)${escapeRe(asset.path)}(?!\\.map)\\b`, "g")
}));

function reescreve(texto, hashes) {
  let saida = texto;
  for (const { asset, re } of padroes) {
    const hash = hashes.get(asset.path);
    if (!hash) continue;
    saida = saida.replace(re, (match, prefixo) => `${prefixo}${asset.base}.${hash}${asset.ext}`);
  }
  return saida;
}

// ── 3. Ponto fixo dos hashes ────────────────────────────────────────────────
let hashes = new Map();
for (let rodada = 0; ; rodada++) {
  const proximo = new Map();
  for (const asset of assets) proximo.set(asset.path, sha8(reescreve(original.get(asset.path), hashes)));
  const estavel = assets.every((a) => proximo.get(a.path) === hashes.get(a.path));
  hashes = proximo;
  if (estavel) break;
  if (rodada >= MAX_ROUNDS) morra(`os hashes não estabilizaram em ${MAX_ROUNDS} rodadas (referência circular dentro de src/?).`);
}
const nomeFinal = (asset) => `${asset.base}.${hashes.get(asset.path)}${asset.ext}`;

// ── 4. Escreve com o nome novo e apaga o antigo ─────────────────────────────
// O sourcemap acompanha: o .map é renomeado e o comentário que aponta pra ele
// (escrito pelo esbuild com o nome antigo) é corrigido.
for (const asset of assets) {
  const novo = nomeFinal(asset);
  let conteudo = reescreve(original.get(asset.path), hashes);
  const mapaAntigo = join(ROOT, `${asset.path}.map`);
  if (existsSync(mapaAntigo)) {
    const mapaNovo = `${novo}.map`;
    renameSync(mapaAntigo, join(ROOT, mapaNovo));
    conteudo = conteudo.replace(/(\/\/# sourceMappingURL=)\S+/, `$1${basename(mapaNovo)}`);
  }
  writeFileSync(join(ROOT, novo), conteudo, "utf8");
  unlinkSync(join(ROOT, asset.path));
}

// ── 5. Reescreve quem aponta pros arquivos ──────────────────────────────────
// Todo HTML do site (inclui as páginas pré-renderizadas em set/, card/ e deck/),
// o service worker (a lista SHELL_ASSETS) e as Pages Functions.
const IGNORAR = new Set([".git", ".github", ".claude", "node_modules", "data", "assets", "scripts"]);
function coletaHtml(dir, acc = []) {
  for (const nome of readdirSync(dir)) {
    if (IGNORAR.has(nome)) continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) coletaHtml(caminho, acc);
    else if (extname(nome) === ".html") acc.push(caminho);
  }
  return acc;
}
const alvos = coletaHtml(ROOT);
for (const extra of ["sw.js", "functions/users/[handle].js"]) {
  if (existsSync(join(ROOT, extra))) alvos.push(join(ROOT, extra));
}

let reescritos = 0;
for (const caminho of alvos) {
  const antes = readFileSync(caminho, "utf8");
  const depois = reescreve(antes, hashes);
  if (depois !== antes) { writeFileSync(caminho, depois, "utf8"); reescritos++; }
}

// ── 6. Confere que não sobrou referência ao nome SEM hash ───────────────────
// Uma que escape vira 404 em produção — e, com `immutable`, um 404 que o
// navegador guarda. Falhar aqui é muito melhor que descobrir depois do deploy.
const pendentes = [];
for (const caminho of alvos) {
  const texto = readFileSync(caminho, "utf8");
  for (const { asset, re } of padroes) {
    re.lastIndex = 0;
    if (re.test(texto)) pendentes.push(`${caminho.replace(`${ROOT}/`, "")} -> ${asset.path}`);
  }
}
if (pendentes.length) {
  console.error("hash-assets: sobrou referência ao nome SEM hash (viraria 404 em produção):");
  pendentes.slice(0, 20).forEach((linha) => console.error(`  ${linha}`));
  process.exit(1);
}

// ── 7. Nome do cache do shell ganha um id do build ──────────────────────────
// Sem isto, cada deploy deixaria a leva ANTERIOR de arquivos com hash presa no
// cache pra sempre: nada mais os pede e o SHELL_CACHE não tem poda por tamanho.
// Com o sufixo, o activate do SW apaga a leva velha inteira. O `vNNN` manual
// continua valendo na frente do nome.
const swPath = join(ROOT, "sw.js");
if (existsSync(swPath)) {
  const buildId = sha8(assets.map((a) => hashes.get(a.path)).join("-"));
  const sw = readFileSync(swPath, "utf8");
  let novo = sw.replace(/(const SHELL_CACHE\s*=\s*")([^"]+)(")/, `$1$2-${buildId}$3`);
  if (novo === sw) morra("não achei o SHELL_CACHE no sw.js.");
  writeFileSync(swPath, novo, "utf8");
  // A flag HASHED_ASSETS diz ao install pra parar de usar cache:"reload" e
  // reaproveitar o cache do navegador — o que só é correto porque a URL passou a
  // carregar a versão. Ela é virada por `sed` ANTES da minificação (o esbuild
  // dobra `false` em `!1` e o padrão some), então aqui a gente só CONFERE. Se os
  // dois passos se separarem, o deploy para em vez de re-baixar os ~345 KB do
  // shell inteiro em cada visita, calado.
  if (!/HASHED_ASSETS\s*=\s*(true|!0)/.test(novo)) {
    morra("o sw.js foi versionado por hash mas HASHED_ASSETS continua false — falta o passo que vira a flag ANTES da minificação.");
  }
}

// ── 8. _headers: de `no-cache` pra um ano `immutable` ───────────────────────
const headersPath = join(ROOT, "_headers");
if (existsSync(headersPath)) {
  const antes = readFileSync(headersPath, "utf8");
  let depois = antes;
  const trocas = [
    ["/src/*\n  Cache-Control: no-cache\n", `/src/*\n  Cache-Control: ${UM_ANO}\n`],
    // O CSS vira styles.<hash>.css na raiz, então a regra precisa do curinga.
    // `/styles*` e não `/styles.*`: o split-css gera também as folhas por área
    // (styles-landing.<hash>.css, styles-decks…), e o ponto literal não casava
    // com o hífen — elas ficavam com o padrão de 4h do Pages, revalidando a
    // cada revisita apesar de terem hash no nome (= imutáveis por construção).
    ["/styles.css\n  Cache-Control: no-cache\n", `/styles*\n  Cache-Control: ${UM_ANO}\n`]
  ];
  for (const [de, para] of trocas) {
    if (!depois.includes(de)) morra(`não achei o bloco "${de.split("\n")[0]}" com no-cache no _headers.`);
    depois = depois.replace(de, para);
  }
  writeFileSync(headersPath, depois, "utf8");
}

console.log(`hash-assets: ${assets.length} arquivos versionados, ${reescritos} arquivos reescritos.`);
