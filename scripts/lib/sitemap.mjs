// Sitemap do site: montagem (prerender-catalog.mjs) e leitura (indexnow.mjs).
//
// Montagem: um ÍNDICE (sitemap.xml) apontando pra um arquivo por tipo de
// página. O porquê do índice mora no prerender, junto dos grupos.
//
// Leitura: devolve os <loc> de um sitemap, seja ele o índice ou uma lista de
// URLs. É regex e não parser de XML: o arquivo é gerado aqui mesmo, sem
// namespace extra nem CDATA, e o site não tem package.json pra trazer
// dependência.

const XML = '<?xml version="1.0" encoding="UTF-8"?>\n';
const NS = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';
const ENTIDADES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

function escapaXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ENTIDADES[c]);
}
function desescapaXml(s) {
  return String(s).replace(/&(amp|lt|gt|quot|apos);/g, (m) =>
    Object.keys(ENTIDADES).find((c) => ENTIDADES[c] === m));
}

// Uma entrada é a URL, ou { loc, lastmod } quando a página tem data de edição
// confiável (os posts do blog). As geradas a cada build não levam lastmod: data
// que muda sem o conteúdo mudar ensina o buscador a ignorar o campo.
function linha(u) {
  if (typeof u === "string") return `  <url><loc>${escapaXml(u)}</loc></url>`;
  const data = u.lastmod ? `<lastmod>${escapaXml(u.lastmod)}</lastmod>` : "";
  return `  <url><loc>${escapaXml(u.loc)}</loc>${data}</url>`;
}

// grupos: [[nomeDoArquivo, [entrada, ...]], ...], na ordem em que entram no
// índice. Grupo vazio fica de fora: sitemap sem URL é aviso no Search Console
// e não informa nada. Devolve { nomeDoArquivo: xml }, com o sitemap.xml.
export function montaSitemaps(origin, grupos) {
  const cheios = grupos.filter(([, urls]) => urls.length > 0);
  const arquivos = {};
  for (const [nome, urls] of cheios) {
    const linhas = urls.map(linha).join("\n");
    arquivos[nome] = `${XML}<urlset ${NS}>\n${linhas}\n</urlset>\n`;
  }
  const filhos = cheios.map(([nome]) => `  <sitemap><loc>${escapaXml(`${origin}/${nome}`)}</loc></sitemap>`).join("\n");
  arquivos["sitemap.xml"] = `${XML}<sitemapindex ${NS}>\n${filhos}\n</sitemapindex>\n`;
  return arquivos;
}

// { indice: true } quando é <sitemapindex> (os locs são outros sitemaps);
// senão os locs são as páginas.
export function lerSitemap(xml) {
  const texto = String(xml || "");
  return {
    indice: /<sitemapindex[\s>]/.test(texto),
    locs: [...texto.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => desescapaXml(m[1]))
  };
}

// Endereços de um post: a original em /blog/<slug> e cada tradução em
// /blog/<idioma>/<slug> — a mesma regra do caminhoDaVersao (src/blog-render.js;
// tests/blog-traducoes.test.mjs confere as duas).
export function enderecosDoPost(p) {
  const original = ["pt", "en", "es"].includes(p.lang) ? p.lang : "pt";
  const traducoes = ["pt", "en", "es"].filter((l) => l !== original && p.versoes && p.versoes[l]);
  return [`/blog/${p.slug}`].concat(traducoes.map((l) => `/blog/${l}/${p.slug}`));
}
