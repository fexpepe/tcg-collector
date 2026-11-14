// Texto no HTML pra quem não roda JavaScript (2026-11-14).
//
// Busca e IA leem o HTML que o servidor entrega. O Googlebot ainda roda o JS
// (com atraso), mas os robôs das IAs (OAI-SearchBot, ChatGPT-User,
// Claude-SearchBot, PerplexityBot) em geral não rodam, e o que eles não leem
// eles não citam. Medido em 13/11 no ar:
//   - /about, /faq, /help, /privacy, /terms e /comparar chegavam com 65
//     blocos VAZIOS (<section data-i18n-html="…"></section>): o texto só
//     entrava pelo i18n-docs.js no navegador. O /about tinha 20 palavras.
//   - /vintage tinha a lista dos jogos no HTML, mas nenhum dado estruturado.
//   - /llms.txt dava 404.
//
// Este passo roda no deploy (deploy.yml, logo depois do prerender) e:
//   1. põe o texto em português dentro de cada bloco vazio das páginas de
//      texto. O cliente segue trocando pelo idioma da pessoa (o
//      data-i18n-html fica), então nada muda na tela;
//   2. põe na /vintage um JSON-LD (CollectionPage + ItemList dos jogos), tirado
//      da própria lista do HTML, que o tests/vintage.test.mjs já trava contra
//      o registro;
//   3. escreve o /llms.txt (llmstxt.org): o que é o Sleevu, os jogos vintage
//      com fabricante, período e o resumo do "Sobre" em inglês, os jogos em
//      atividade e as páginas de referência.
// O repositório não muda: só o workspace do runner, como o split-css.
//
//   node scripts/seo-estatico.mjs           # confere (chave que falta = erro)
//   node scripts/seo-estatico.mjs --write   # grava (deploy)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JOGOS_URL } from "../functions/_lib/jogos.js";
import { jsonLdSeguro } from "../functions/_lib/json-ld.js";

const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const ORIGEM = "https://sleevu.app";

// As páginas cujo texto mora no i18n (i18n-docs.js e i18n.js).
export const PAGINAS_DE_TEXTO = ["about.html", "faq.html", "help.html", "privacy.html", "terms.html", "comparar.html"];

// As mensagens em português dos dois arquivos de tradução, como o navegador
// as monta (os dois mesclam em window.TCG_MESSAGES).
export function mensagensPt(raiz = RAIZ) {
  const w = {};
  for (const f of ["src/i18n.js", "src/i18n-docs.js"]) {
    new Function("window", "document", "navigator", readFileSync(raiz + f, "utf8"))(w, {}, {});
  }
  return (w.TCG_MESSAGES && w.TCG_MESSAGES.pt) || {};
}

// Cada bloco VAZIO com data-i18n-html ganha o texto em português. Bloco que já
// tem conteúdo não é tocado (rodar duas vezes não duplica). Chave sem texto
// em pt derruba o passo: melhor o deploy parar do que publicar bloco vazio
// achando que encheu.
const BLOCO_VAZIO = /<([a-z][a-z0-9]*)([^>]*?) data-i18n-html="([^"]+)"([^>]*)><\/\1>/g;
export function preencheTextos(html, pt) {
  const faltam = [];
  let n = 0;
  const novo = String(html).replace(BLOCO_VAZIO, (tudo, tag, antes, chave, depois) => {
    if (typeof pt[chave] !== "string" || !pt[chave].trim()) { faltam.push(chave); return tudo; }
    n++;
    return `<${tag}${antes} data-i18n-html="${chave}"${depois}>${pt[chave]}</${tag}>`;
  });
  if (faltam.length) throw new Error(`seo-estatico: chave sem texto em pt: ${faltam.join(", ")}`);
  return { html: novo, blocos: n };
}

const ENTIDADES = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">" };
const decodifica = (s) => String(s || "").replace(/&(amp|quot|#39|lt|gt);/g, (e) => ENTIDADES[e]).trim();

// Os jogos da lista da /vintage, na ordem dela (a de lançamento).
export function jogosDoVintage(html) {
  const jogos = [];
  for (const m of String(html).matchAll(/<li class="vt-jogo"([^>]*)>([\s\S]*?)<\/li>/g)) {
    const dado = (nome) => (m[1].match(new RegExp(`data-${nome}="([^"]*)"`)) || [])[1] || "";
    const href = (m[2].match(/href="\/games\/([^"]+)"/) || [])[1] || "";
    const nome = decodifica((m[2].match(/<span class="vt-nome">([^<]+)</) || [])[1]);
    const editora = decodifica((m[2].match(/<span class="vt-editora">([^<]+)</) || [])[1]);
    if (href && nome) jogos.push({ url: href, nome, editora, inicio: dado("inicio"), fim: dado("fim"), pais: dado("pais") });
  }
  return jogos;
}

// A editora da linha é "Bandai · Carddass" (fabricante · tipo): a primeira
// parte é quem publicou.
const fabricante = (j) => String(j.editora || "").split(" · ")[0].trim();

export function jsonLdDoVintage(jogos) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Jogos de cartas vintage: o acervo dos TCGs que saíram de linha",
    url: `${ORIGEM}/vintage`,
    inLanguage: "pt-BR",
    isPartOf: { "@type": "WebSite", name: "Sleevu", url: `${ORIGEM}/` },
    mainEntity: {
      "@type": "ItemList",
      name: "Jogos de cartas vintage no Sleevu",
      numberOfItems: jogos.length,
      itemListElement: jogos.map((j, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "Game",
          name: j.nome,
          url: `${ORIGEM}/games/${j.url}`,
          ...(j.inicio ? { datePublished: j.inicio } : {}),
          ...(fabricante(j) ? { publisher: { "@type": "Organization", name: fabricante(j) } } : {})
        }
      }))
    }
  };
}

// O JSON-LD entra antes do </head>; rodar de novo troca o que já estava.
const MARCA = 'data-gerado="seo-estatico"';
export function comJsonLd(html, obj) {
  const tag = `<script type="application/ld+json" ${MARCA}>${jsonLdSeguro(obj)}</script>`;
  const semVelho = String(html).replace(new RegExp(`[ ]*<script type="application/ld\\+json" ${MARCA}>[\\s\\S]*?</script>\\n?`), "");
  if (!semVelho.includes("</head>")) throw new Error("seo-estatico: página sem </head>");
  return semVelho.replace("</head>", `  ${tag}\n  </head>`);
}

const PAIS = { jp: "Japan", us: "USA", br: "Brazil", fr: "France", de: "Germany", it: "Italy", es: "Spain", kr: "South Korea", cn: "China", tw: "Taiwan" };
const ano = (s) => String(s || "").slice(0, 4);
const emIngles = (v) => (v && typeof v === "object" ? v.en || v.pt || "" : String(v || "")).replace(/\s+/g, " ").trim();

// O /llms.txt. Em inglês de propósito: é a língua em que as IAs mais buscam, e
// as páginas do site têm versão em inglês. `sobres`: url -> JSON do "Sobre";
// `sets`: url -> nº de sets (do data/game-pages, quando o prerender já rodou).
export function llmsTxt({ jogos = JOGOS_URL, vintage, sobres = {}, sets = {} }) {
  const urlsVintage = new Set(vintage.map((j) => j.url));
  const modernos = jogos.filter((j) => !urlsVintage.has(j.url));
  const total = modernos.length + vintage.length;
  const nSets = (url) => (sets[url] ? `: ${sets[url]} set${sets[url] === 1 ? "" : "s"}` : "");
  const linhaVintage = (j) => {
    const partes = [fabricante(j), PAIS[j.pais] || "", j.inicio ? `${ano(j.inicio)}–${ano(j.fim) || "?"}` : ""].filter(Boolean).join(", ");
    const resumo = emIngles((sobres[j.url] || {}).resumo);
    return `- [${j.nome}](${ORIGEM}/games/${j.url}): ${partes}.${resumo ? ` ${resumo}` : ""}`;
  };
  return [
    "# Sleevu",
    "",
    `> Sleevu (${ORIGEM}) is a free collection tracker and card catalog for ${total} trading card games: every set and card with images and market prices, plus collection, wishlist, portfolio, binder and deck tracking. It also keeps a historical archive of out-of-print card games ("vintage"), from the Bandai Carddass of 1988 to the TCGs and CCGs that went out of print, documented set by set with their history and sources.`,
    "",
    `The site is in Portuguese (default), English and Spanish. Each game has a page at ${ORIGEM}/games/<game>, each set at ${ORIGEM}/games/<game>/<set> and each card at ${ORIGEM}/games/<game>/<set>/<card>. The vintage game pages open with the game's history (release, publisher, rules, end) and the list of sources.`,
    "",
    "## Vintage archive: out-of-print card games",
    "",
    ...vintage.map(linhaVintage),
    "",
    "## Card games in print",
    "",
    ...modernos.map((j) => `- [${j.nome}](${ORIGEM}/games/${j.url})${nSets(j.url)}`),
    "",
    "## Pages",
    "",
    `- [Vintage timeline](${ORIGEM}/vintage): every out-of-print game on the site, by release date and by brand`,
    `- [All games](${ORIGEM}/hub)`,
    `- [Tools](${ORIGEM}/tools): collector tools (card condition, centering)`,
    `- [FAQ](${ORIGEM}/faq)`,
    `- [Help](${ORIGEM}/help)`,
    `- [About Sleevu](${ORIGEM}/about): what the site is and where its data comes from`,
    `- [Sitemap](${ORIGEM}/sitemap.xml): every game, set and card page`,
    ""
  ].join("\n");
}

function lerJson(caminho) {
  try { return JSON.parse(readFileSync(caminho, "utf8")); } catch { return null; }
}

export function montaTudo(raiz = RAIZ) {
  const pt = mensagensPt(raiz);
  const paginas = PAGINAS_DE_TEXTO.map((f) => ({ arquivo: f, ...preencheTextos(readFileSync(raiz + f, "utf8"), pt) }));
  const htmlVintage = readFileSync(raiz + "vintage.html", "utf8");
  const vintage = jogosDoVintage(htmlVintage);
  if (!vintage.length) throw new Error("seo-estatico: nenhuma linha na lista da /vintage");
  const sobres = {};
  for (const j of vintage) { const s = lerJson(`${raiz}data/sobre/${j.url}.json`); if (s) sobres[j.url] = s; }
  const sets = {};
  for (const j of JOGOS_URL) {
    const mapa = lerJson(`${raiz}data/game-pages/${j.url}.json`);
    if (mapa && mapa.s) sets[j.url] = Object.keys(mapa.s).length;
  }
  return {
    paginas,
    vintage: { html: comJsonLd(htmlVintage, jsonLdDoVintage(vintage)), jogos: vintage.length },
    llms: llmsTxt({ vintage, sobres, sets })
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const grava = process.argv.includes("--write");
  const r = montaTudo();
  if (grava) {
    for (const p of r.paginas) writeFileSync(RAIZ + p.arquivo, p.html, "utf8");
    writeFileSync(RAIZ + "vintage.html", r.vintage.html, "utf8");
    writeFileSync(RAIZ + "llms.txt", r.llms, "utf8");
  }
  const blocos = r.paginas.map((p) => `${p.arquivo} ${p.blocos}`).join(", ");
  console.log(`seo-estatico${grava ? "" : " (só conferindo)"}: texto em pt nos blocos (${blocos}); /vintage com ItemList de ${r.vintage.jogos} jogos; llms.txt com ${r.llms.length} bytes${existsSync(RAIZ + "data/game-pages") ? "" : " (sem contagem de sets: data/game-pages só existe depois do prerender)"}.`);
}
