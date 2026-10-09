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
import { join, extname, basename, relative, sep, dirname } from "node:path";

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
if (existsSync(join(ROOT, "sw.js"))) alvos.push(join(ROOT, "sw.js"));
// Pages Functions: TODAS, não uma lista à mão. Era só a do perfil
// (functions/users/[handle].js); em 2026-09-30 o blog passou a IMPORTAR o
// src/blog-render.js na borda (functions/blog/_comum.js), e esse import
// precisa sair daqui com o nome com hash — senão o bundle do wrangler procura
// um arquivo que este script acabou de apagar.
function coletaFunctions(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) coletaFunctions(caminho, acc);
    else if (/\.m?js$/.test(nome)) acc.push(caminho);
  }
  return acc;
}
alvos.push(...coletaFunctions(join(ROOT, "functions")));

let reescritos = 0;
for (const caminho of alvos) {
  const antes = readFileSync(caminho, "utf8");
  const depois = reescreve(antes, hashes);
  if (depois !== antes) { writeFileSync(caminho, depois, "utf8"); reescritos++; }
}

// ── 6. Confere as referências: nome SEM hash e arquivo que NÃO existe ───────
// Uma que escape vira 404 em produção — e, com `immutable`, um 404 que o
// navegador guarda. Falhar aqui é muito melhor que descobrir depois do deploy.
//
// São duas conferências, e a segunda existe porque a primeira é cega pra um
// caso: ela procura o nome sem hash de cada arquivo que ESTE script versionou,
// ou seja, só enxerga o que ainda estava no disco. Referência a um arquivo que
// um passo ANTERIOR apagou passava calada. Foi o que aconteceu com o
// bundle-boot, que apagava o src/theme.js reescrevendo só os HTML da raiz: as
// páginas pré-renderizadas (set/, card/, artist/) seguiram pedindo
// /src/theme.js, e desde 30/08/2026 toda visita vinda do Google levava um 404
// (conferido em produção em 29/09) sem nenhum passo do build reclamar.
//
// A segunda confere pelo DESTINO, no estado final do workspace (o que sobe):
// toda referência ao app shell — src/<arquivo>.js|css ou styles*.css — precisa
// apontar pra um arquivo que existe. Vale pra:
//   - todo HTML publicado (raiz, set/, card/, artist/, deck/): cada <script src>
//     e <link href>, resolvido como o navegador resolveria — relativo à pasta
//     da página e respeitando <base href>. "src/x.js" dentro de set/ é
//     /set/src/x.js, e isso também é 404;
//   - o sw.js, cujo precache usa allSettled: arquivo faltando lá falha CALADO e
//     só aparece quando a pessoa abre o site offline;
//   - os próprios src/*.js (módulos injetados em runtime, o mapa de i18n do
//     theme.js), relativos à raiz.
const ORIGEM = "https://sleevu.app";
// "src/x.js", "/src/x.css", "./styles.<hash>.css", "../src/x.js" ou a URL
// absoluta do próprio site. Query e hash não contam.
const APONTA_PRO_SHELL = /^(?:https?:\/\/[^/]+)?(?:\.{0,2}\/)*(?:src\/[\w.-]+\.(?:m?js|css)|styles[\w.-]*\.css)$/;
// A mesma coisa como literal de string, dentro de JS.
const LITERAL_DO_SHELL = /["'`]((?:\.?\/)?(?:src\/[\w.-]+\.(?:m?js|css)|styles[\w.-]*\.css))["'`]/g;
const relRaiz = (caminho) => relative(ROOT, caminho).split(sep).join("/");

// Devolve o caminho que falta, ou null (existe, não é do shell, ou é de outro host).
function destinoFaltando(ref, base) {
  const limpa = ref.trim().replace(/[?#].*$/, "");
  if (!APONTA_PRO_SHELL.test(limpa)) return null;
  const url = new URL(limpa, base);
  if (url.origin !== ORIGEM) return null;
  return existsSync(join(ROOT, url.pathname.replace(/^\/+/, ""))) ? null : url.pathname;
}

// As referências que o NAVEGADOR segue num HTML: <script src> e <link href>.
// Comentário sai antes (tag comentada não é pedida), e o miolo de <script>
// inline também (o JSON-LD é texto, não tag).
const ATRIBUTO_DA_TAG = {
  script: /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i,
  link: /\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/i
};
function referenciasDoHtml(html) {
  const limpo = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, "$1$2");
  const base = /<base\b[^>]*\shref\s*=\s*["']([^"']*)["']/i.exec(limpo);
  const refs = [];
  for (const [tag, nome] of limpo.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const m = ATRIBUTO_DA_TAG[nome.toLowerCase()].exec(tag);
    if (m) refs.push(m[1] ?? m[2]);
  }
  return { base: base ? base[1] : null, refs };
}

const pendentes = [];
const orfas = new Map(); // caminho que falta -> quem pede
const anotaOrfa = (destino, quem) => {
  if (!orfas.has(destino)) orfas.set(destino, []);
  orfas.get(destino).push(quem);
};
function confereLiterais(texto, quem) {
  for (const [, ref] of texto.matchAll(LITERAL_DO_SHELL)) {
    const falta = destinoFaltando(ref, `${ORIGEM}/`);
    if (falta) anotaOrfa(falta, quem);
  }
}
for (const caminho of alvos) {
  const texto = readFileSync(caminho, "utf8");
  const quem = relRaiz(caminho);
  for (const { asset, re } of padroes) {
    re.lastIndex = 0;
    if (re.test(texto)) pendentes.push(`${quem} -> ${asset.path}`);
  }
  if (extname(caminho) === ".html") {
    const pagina = new URL(quem, `${ORIGEM}/`);
    const { base, refs } = referenciasDoHtml(texto);
    const baseUrl = base ? new URL(base, pagina) : pagina;
    for (const ref of refs) {
      const falta = destinoFaltando(ref, baseUrl);
      if (falta) anotaOrfa(falta, quem);
    }
  } else {
    confereLiterais(texto, quem);
  }
}
for (const asset of assets) {
  if (asset.ext === ".js") confereLiterais(readFileSync(join(ROOT, nomeFinal(asset)), "utf8"), nomeFinal(asset));
}
// `import` de Function que aponta pro src/ (o blog importa o renderizador),
// resolvido a partir da pasta da Function — é assim que o wrangler vai
// procurar o arquivo no bundle. O LITERAL_DO_SHELL não pega esse caso: o
// caminho começa com "../".
const IMPORT_RE = /\bimport\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/g;
for (const caminho of alvos) {
  if (!relRaiz(caminho).startsWith("functions/")) continue;
  for (const [, spec] of readFileSync(caminho, "utf8").matchAll(IMPORT_RE)) {
    if (!/(^|\/)src\//.test(spec)) continue;
    const destino = join(dirname(caminho), spec);
    if (!existsSync(destino)) anotaOrfa("/" + relRaiz(destino), relRaiz(caminho));
  }
}
if (pendentes.length) {
  console.error("hash-assets: sobrou referência ao nome SEM hash (viraria 404 em produção):");
  pendentes.slice(0, 20).forEach((linha) => console.error(`  ${linha}`));
  process.exit(1);
}
if (orfas.size) {
  console.error("hash-assets: referência a arquivo que NÃO EXISTE no build (404 em produção):");
  for (const [destino, quem] of orfas) {
    // Por pasta: nas pré-renderizadas o mesmo erro se repete milhares de vezes,
    // e "set/ 2540 · card/ 522" diz na hora de onde ele vem.
    const porPasta = new Map();
    for (const q of quem) {
      const pasta = q.includes("/") ? `${q.split("/")[0]}/` : "raiz";
      if (!porPasta.has(pasta)) porPasta.set(pasta, []);
      porPasta.get(pasta).push(q);
    }
    const resumo = [...porPasta].map(([pasta, lista]) => `${pasta} ${lista.length}`).join(" · ");
    const exemplos = [...porPasta.values()].map((lista) => lista[0]).slice(0, 5).join(", ");
    console.error(`  ${destino} — pedido por ${quem.length} arquivo(s) (${resumo}); ex.: ${exemplos}`);
  }
  console.error("Algum passo anterior do deploy (split-i18n, bundle-boot…) apagou ou renomeou o arquivo "
    + "sem reescrever quem aponta pra ele — ou a referência foi escrita errada na origem.");
  process.exit(1);
}

// ── 7. Id do build: no nome do cache do shell E em todo HTML ────────────────
// Sem o sufixo no SHELL_CACHE, cada deploy deixaria a leva ANTERIOR de
// arquivos com hash presa no cache pra sempre: nada mais os pede e o
// SHELL_CACHE não tem poda por tamanho. Com ele, o activate do SW apaga a
// leva velha inteira. O `vNNN` manual continua valendo na frente do nome.
//
// O id cobre os assets com hash E as páginas do shell (os HTML da raiz, já
// com as referências reescritas). Antes era só dos assets: um deploy que
// mudava só um HTML não mudava o sw.js, o navegador não via SW novo, o
// precache não rodava e a página em cache ficava a velha até a navegação
// seguinte — "abre antiga, depois a nova". Com o HTML no id, mudar uma
// página é um SW novo, que precacheia a página nova e apaga a antiga.
//
// O mesmo id vai em <meta name="sleevu-build"> de TODO HTML (shell e
// pré-renderizadas): quando um SW novo assume, a página aberta compara o id
// dela com o dele (mensagem sleevu:build) e recarrega se for outro — é o que
// impede uma página velha de seguir rodando sem os arquivos dela. O hash sai
// do HTML SEM a meta (senão seria circular); é determinístico do mesmo jeito.
const swPath = join(ROOT, "sw.js");
const htmlDaRaiz = readdirSync(ROOT).filter((f) => extname(f) === ".html").sort();
const buildId = sha8([
  ...assets.map((a) => hashes.get(a.path)),
  ...htmlDaRaiz.map((f) => sha8(readFileSync(join(ROOT, f), "utf8")))
].join("-"));
const META_BUILD = `<meta name="sleevu-build" content="${buildId}">`;
let carimbados = 0;
for (const caminho of alvos) {
  if (extname(caminho) !== ".html") continue;
  const antes = readFileSync(caminho, "utf8");
  if (antes.includes('name="sleevu-build"')) continue;
  // Logo depois do charset (toda página do site o declara primeiro no <head>);
  // sem ele, logo depois do <head>. HTML sem <head> (os modelos de e-mail em
  // supabase/) não é página do site: fica como está.
  let depois = antes.replace(/(<meta charset="utf-8">)/i, `$1\n    ${META_BUILD}`);
  if (depois === antes) depois = antes.replace(/(<head>)/i, `$1\n    ${META_BUILD}`);
  if (depois === antes) continue;
  writeFileSync(caminho, depois, "utf8");
  carimbados++;
}
if (existsSync(swPath)) {
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
  // Early Hints (103): o Cloudflare Pages transforma um header `Link` em
  // 103 Early Hints, que o navegador recebe ANTES do HTML. Sem isso, na
  // primeira visita o CSS e a fonte só começam a baixar depois de o HTML
  // chegar e ser escaneado — um round-trip inteiro parado no caminho do
  // primeiro paint, justo pra quem está conhecendo o site.
  //
  // Só o que vale pra TODAS as páginas: o núcleo do CSS (styles.<hash>.css) e
  // a fonte latin. As folhas por área têm nome por página (styles-decks…) e um
  // preload errado desperdiçaria banda; o i18n é escolhido em runtime pelo
  // idioma. A fonte precisa de `crossorigin` mesmo sendo same-origin — é a
  // regra do CORS pra fontes, e sem ela o navegador baixa DUAS vezes.
  const cssNucleo = assets.find((a) => a.path === "styles.css");
  if (cssNucleo) {
    const link = `</${nomeFinal(cssNucleo)}>; rel=preload; as=style, `
      + `</assets/fonts/outfit-latin.woff2>; rel=preload; as=font; crossorigin`;
    const marca = "  Speculation-Rules: \"/speculation-rules.json\"\n";
    if (!depois.includes(marca)) morra("não achei o bloco /* pra pendurar o Link de Early Hints.");
    depois = depois.replace(marca, `${marca}  Link: ${link}\n`);
    // O `/*` vale pra TODA resposta, e a Cloudflare guarda os arquivos
    // imutáveis por semanas com o header do deploy em que foram cacheados: sem
    // o `! Link` nos blocos dos arquivos, cada JS/CSS/fonte/logo levava um
    // preload pro núcleo de CSS de um build antigo, que o Chrome baixava
    // (2026-10-08, de 1 a 10 CSS inúteis por visita fria). Só o HTML leva o Link.
    for (const bloco of ["/src/*", "/styles*", "/assets/*", "/data/*"]) {
      const m = new RegExp(`^${bloco.replace(/[*]/g, "\\*")}\\n((?:  .*\\n)+)`, "m").exec(depois);
      if (!m || !/^  ! Link$/m.test(m[1])) morra(`o bloco ${bloco} do _headers perdeu o "! Link" (o preload do CSS iria em todo arquivo).`);
    }
  }
  writeFileSync(headersPath, depois, "utf8");
}

console.log(`hash-assets: ${assets.length} arquivos versionados, ${reescritos} arquivos reescritos, ${carimbados} páginas carimbadas com o build ${buildId}.`);
