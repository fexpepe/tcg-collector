// A home em inglês, no endereço /en/ (2026-11-28, D3 da revisão de novembro).
//
// O problema: a busca em inglês mostrava título e descrição em português. A
// home tem UM endereço (/), o idioma do HTML é o português, e o robô do Google
// fica no idioma do HTML (src/theme.js). O site já atende inglês e dólar, mas
// quem busca em inglês não tinha por onde entrar nele. Os sets resolvem isso
// com uma variante -en estática e o hreflang nos dois; a home resolve com um
// endereço próprio, pelo mesmo desenho do functions/_lib/decora-app.js: tudo o
// que decide o HTML mora aqui, em funções PURAS (o tests/home-en.test.mjs roda
// daqui, em Node, com o index.html de verdade), e a Function (functions/en.js)
// só busca a casca, chama traduzHomeEn e devolve.
//
// Por que NÃO é um HTMLRewriter, como o do decora-app: ele não roda em Node, e
// a única conferência possível da cola seria uma imitação dele. A home tem
// 45 KB; ler o texto inteiro e devolver o texto trocado custa nada, e o que o
// teste e o ensaio local da borda exercitam é EXATAMENTE o que vai pro ar.
//
// O texto em inglês NÃO é copiado à mão: sai das chaves do src/i18n.js, as
// mesmas que a tela usa. A tabela que a borda lê (home-en-textos.js) é gerada
// por scripts/gen-home-en.mjs a partir do index.html + i18n.js, e o teste
// reprova se ela ficar pra trás (mexeu num texto da home no i18n: rode o
// gerador). A meta description e o título do Open Graph não têm chave própria
// em nenhum idioma; usam as da própria home (home.lp.sub e title.home), em vez
// de um texto inventado aqui.
//
// POR QUE /en/ COM BARRA, e não /en: o rodapé da home (links, aviso de
// projeto independente, termos e privacidade) é montado pelo shared.js só nas
// páginas cujo ÚLTIMO segmento do caminho está numa lista (""/"index", "about",
// "faq"…), e o shared.js está a 100% do teto de peso. Em /en o segmento é
// "en": a home em inglês ficaria sem rodapé. Em /en/ o segmento é vazio, como
// na home, e tudo (rodapé, "é a home", volta do link mágico) funciona sem
// tocar no núcleo. A barra cobra o <base href="/"> (o index.html usa caminho
// relativo: src/theme.js, hub, data/…), e o <base> cobra tirar o recorte do
// SVG do wordmark (ver semRecorteDoSvg). /en leva 301 pra /en/.
import { escapeAttr, escapeHtml, ORIGEM } from "./pagina-carta.js";
import { jsonLdSeguro } from "./json-ld.js";

export const CAMINHO_EN = "/en/";
export const CANONICAL_EN = `${ORIGEM}${CAMINHO_EN}`;

// Chaves que o <head> usa além das que o próprio index.html marca com data-i18n.
export const CHAVE_DO_TITULO = "title.home";
export const CHAVE_DA_DESCRICAO = "home.lp.sub";

const tem = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Toda chave de tradução que a home usa: as dos atributos data-i18n,
// data-i18n-html e data-i18n-aria, mais as do <head>. É a lista que o gerador
// da tabela copia do i18n.js.
export function chavesDaHome(html) {
  const chaves = new Set([CHAVE_DO_TITULO, CHAVE_DA_DESCRICAO]);
  for (const m of String(html).matchAll(/\sdata-i18n(?:-html|-aria)?\s*=\s*"([^"]+)"/g)) chaves.add(m[1]);
  return [...chaves].sort();
}

// Tipos de data-i18n-* que o index.html usa e que a troca sabe fazer. Um novo
// (placeholder, title…) na home sem a troca deixaria texto em português no /en/:
// o teste reprova.
export function atributosDeTraducaoNaoTratados(html) {
  const achados = new Set();
  for (const m of String(html).matchAll(/\sdata-i18n-([a-z]+)\s*=/g)) {
    if (!["html", "aria", "packs"].includes(m[1])) achados.add(`data-i18n-${m[1]}`);
  }
  return [...achados];
}

// A chave sem texto na tabela: o elemento fica como está no HTML (português) e
// o teste acusa. {game} segue a regra do traduzCedo do theme.js (Pokémon).
function textoDa(textos, chave) {
  return tem(textos, chave) ? String(textos[chave]).split("{game}").join("Pokémon") : null;
}
export const chavesSemTexto = (html, textos) => chavesDaHome(html).filter((c) => textoDa(textos, c) == null);

// Título, descrição e Open Graph da home em inglês.
export function pecasDaHomeEn(textos) {
  const titulo = textoDa(textos, CHAVE_DO_TITULO) || "Sleevu";
  const desc = textoDa(textos, CHAVE_DA_DESCRICAO) || "";
  return { titulo, desc, ogTitulo: titulo, canonical: CANONICAL_EN };
}

// ── pedaços de tag ──────────────────────────────────────────────────────────
// `attrs` é o texto entre o nome da tag e o ">".
function lerAttr(attrs, nome) {
  const m = new RegExp(`(?:^|\\s)${nome}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attrs);
  return m ? (m[1] !== undefined ? m[1] : m[2]) : null;
}
function poeAttr(attrs, nome, valor) {
  const re = new RegExp(`((?:^|\\s)${nome}\\s*=\\s*)(?:"[^"]*"|'[^']*')`, "i");
  if (re.test(attrs)) return attrs.replace(re, (_, antes) => `${antes}"${escapeAttr(valor)}"`);
  return attrs.replace(/(\s*\/?)$/, ` ${nome}="${escapeAttr(valor)}"$1`);
}

// <base href="/"> muda a base de TODA referência por URL, inclusive a de dentro
// do SVG. O <use xlink:href="#font_1"> do wordmark segue interno (fragmento
// puro é referência ao próprio documento, em qualquer base; conferido no
// Chrome), mas o clip-path="url(#clip_1)" é URL de CSS: o Safari e o Firefox o
// resolvem contra a base e o desenho some. Esse recorte é o retângulo inteiro
// do viewBox (M0 178H667V0H0Z), então o SVG já faz o mesmo sozinho: sai o
// atributo, e o desenho fica idêntico. (Apontar a referência pro caminho
// completo, "/en/#clip_1", foi a primeira tentativa e quebra assim que a URL
// ganha uma query, como o ?game= que o game.js põe: o documento deixa de ser o
// mesmo e o wordmark some até no Chrome.)
function semRecorteDoSvg(attrs) {
  return attrs.replace(/\sclip-path\s*=\s*(?:"url\(\s*#[^)"]*\)"|'url\(\s*#[^)']*\)')/gi, "");
}

// Troca os atributos de UMA tag de abertura. Devolve a string de atributos nova.
function atributosDaTag(nome, attrs, pecas) {
  let a = attrs;
  if (nome === "html") {
    a = poeAttr(a, "lang", "en");
    // O idioma em que o HTML já vem e o de quem não escolheu idioma (theme.js):
    // sem isto o navegador em português abria o /en/ em português.
    a = poeAttr(a, "data-idioma-padrao", "en");
  } else if (nome === "meta") {
    const chave = (lerAttr(a, "name") || lerAttr(a, "property") || "").toLowerCase();
    if (chave === "description" || chave === "og:description" || chave === "twitter:description") a = poeAttr(a, "content", pecas.desc);
    else if (chave === "og:title" || chave === "twitter:title") a = poeAttr(a, "content", pecas.ogTitulo);
    else if (chave === "og:url") a = poeAttr(a, "content", pecas.canonical);
  } else if (nome === "link" && String(lerAttr(a, "rel") || "").toLowerCase() === "canonical") {
    a = poeAttr(a, "href", pecas.canonical);
  }
  // O "Tentar de novo" da saída de emergência é href="" (recarregar a própria
  // tela). Com a base "/", ele levaria pra home em português.
  if (lerAttr(a, "href") === "") a = poeAttr(a, "href", CAMINHO_EN);
  return semRecorteDoSvg(a);
}

const SEM_FECHAMENTO = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

// O JSON-LD da home (WebSite + Organization): descrição e idioma do WebSite.
function jsonLdEn(corpo, pecas) {
  let o;
  try { o = JSON.parse(corpo); } catch (e) { return corpo; }
  const nos = Array.isArray(o && o["@graph"]) ? o["@graph"] : [o];
  for (const no of nos) {
    if (no && no["@type"] === "WebSite") { no.description = pecas.desc; no.inLanguage = "en"; }
  }
  return jsonLdSeguro(o);
}

// Tag (ou comentário) por vez, com o nome e os atributos. As aspas dos
// atributos podem conter ">" (o d= de um SVG não, mas é barato acertar).
const RE_TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

// O index.html (já como o build o deixa) -> a mesma página em inglês.
//  - <html lang="en" data-idioma-padrao="en">;
//  - título, descrição, Open Graph, Twitter e canonical em inglês;
//  - o JSON-LD do WebSite em inglês;
//  - cada elemento com data-i18n / data-i18n-html / data-i18n-aria com o texto
//    em inglês da mesma chave;
//  - <base href="/"> e as referências do SVG apontando pro próprio documento.
// O hreflang NÃO é daqui: as três tags moram no index.html e valem pras duas.
export function traduzHomeEn(html, textos) {
  const fonte = String(html);
  const pecas = pecasDaHomeEn(textos);
  const re = new RegExp(RE_TAG.source, "g");
  let saida = "";
  let ate = 0; // fonte[0..ate) já foi copiado ou descartado de propósito
  let pulando = null; // elemento cujo miolo foi trocado: { nome, nivel }
  let m;
  while ((m = re.exec(fonte))) {
    const [tag, barra, nome, attrs] = m;
    if (pulando) {
      // Descarta o miolo antigo até o fechamento do elemento trocado.
      if (nome && nome.toLowerCase() === pulando.nome) {
        if (barra) {
          if (--pulando.nivel === 0) { saida += tag; ate = re.lastIndex; pulando = null; }
        } else if (!/\/\s*$/.test(attrs)) pulando.nivel++;
      }
      continue;
    }
    saida += fonte.slice(ate, m.index);
    ate = re.lastIndex;
    if (!nome || barra) { saida += tag; continue; } // comentário ou fechamento
    const minusculo = nome.toLowerCase();
    // Conteúdo cru (script, style): não se interpreta o miolo como HTML.
    if (minusculo === "script" || minusculo === "style") {
      const reFim = new RegExp(`</${minusculo}`, "ig");
      reFim.lastIndex = re.lastIndex;
      const achou = reFim.exec(fonte);
      const fim = achou ? achou.index : -1;
      const corpo = fim < 0 ? fonte.slice(re.lastIndex) : fonte.slice(re.lastIndex, fim);
      const ld = minusculo === "script" && /application\/ld\+json/i.test(attrs);
      saida += `<${nome}${atributosDaTag(minusculo, attrs, pecas)}>${ld ? jsonLdEn(corpo, pecas) : corpo}`;
      ate = fim < 0 ? fonte.length : fim;
      re.lastIndex = ate;
      continue;
    }
    let novos = atributosDaTag(minusculo, attrs, pecas);
    const chaveAria = lerAttr(novos, "data-i18n-aria");
    const aria = chaveAria != null ? textoDa(textos, chaveAria) : null;
    if (aria != null) novos = poeAttr(novos, "aria-label", aria);
    saida += `<${nome}${novos}>`;
    if (minusculo === "head") saida += '<base href="/">';
    if (SEM_FECHAMENTO.has(minusculo) || /\/\s*$/.test(attrs)) continue;
    const chaveHtml = lerAttr(attrs, "data-i18n-html");
    const chaveTexto = lerAttr(attrs, "data-i18n");
    const novoHtml = chaveHtml != null ? textoDa(textos, chaveHtml) : null;
    const novoTexto = novoHtml == null && chaveTexto != null ? textoDa(textos, chaveTexto) : null;
    if (novoHtml != null || novoTexto != null) {
      saida += novoHtml != null ? novoHtml : escapeHtml(novoTexto);
      pulando = { nome: minusculo, nivel: 1 };
    }
  }
  return saida + fonte.slice(ate);
}
