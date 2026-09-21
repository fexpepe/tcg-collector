// Bulbapedia — a parte PURA da ingestão do catálogo japonês: parsers do HTML
// que a API do MediaWiki devolve (action=parse&prop=text) e a montagem das
// requisições. Sem rede e sem fs de propósito: é o que tests/bulbapedia.test.mjs
// trava com fixtures. Quem fala com a rede é scripts/sync-bulbapedia-ja.mjs.
//
// Por que HTML renderizado e não wikitext: as listas de set e as infoboxes de
// carta são templates ({{Setlist/entry}}, {{PokémoncardInfobox}}…) cujos
// parâmetros mudam de era pra era e de editor pra editor; a tabela RENDERIZADA
// tem cabeçalho com nome de coluna, e é pelo nome da coluna que se lê — mudou
// a ordem, o parser não liga. Tudo aqui é tolerante: coluna que não existe
// vira campo vazio, nunca erro.
//
// Escrito em 20/09/2026 sem acesso à Bulbapedia e conferido em 21/09 contra
// as páginas reais ("Red Collection (TCG)" e "Dwebble (Red Collection 1)"):
//   - na lista de set a célula do TIPO é um <th> no meio de <td>s — lendo só
//     <td> as colunas deslocavam (a raridade caía em tipo, e a coluna oculta
//     "Promotion" caía em raridade). As células são lidas em ordem, qualquer
//     tag;
//   - a página de uma expansão japonesa que tem par ocidental traz DUAS
//     listas (Noble Victories 1/101 e Red Collection 001/066): escolherLista
//     fica com a que casa com o total do set (ou com a contagem do chunk);
//   - o scan da carta é o primeiro .jpg do Archives; antes dele vêm os ícones
//     de tipo (.png). Os testes com fixture reproduzem essa forma.

export const API = "https://bulbapedia.bulbagarden.net/w/api.php";
export const UA = "Sleevu catalog sync (+https://sleevu.app; github.com/fexpepe/tcg-collector)";
export const LISTA_DE_EXPANSOES = "List of Japanese Pokémon Trading Card Game expansions";

// URL da API pra o HTML renderizado de uma página (segue redirect).
export function parseUrl(title) {
  const q = new URLSearchParams({ action: "parse", page: title, prop: "text", format: "json", formatversion: "2", redirects: "1", disablelimitreport: "1" });
  return `${API}?${q}`;
}

// ── HTML mínimo ─────────────────────────────────────────────────────────────
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#160": " " };
export function decode(s) {
  return String(s || "").replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}
export function text(html) {
  return decode(String(html || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}
// Células em ORDEM, <td> ou <th>: a lista de set usa <th> pra célula do tipo.
const cells = (row) => [...row.matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
const rows = (table) => [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
// Tabelas de primeiro nível (o wiki não aninha tabela nas listas de set).
const tables = (html) => [...String(html || "").matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((m) => m[1]);
// Primeiro link com title (a página da carta/set) e o texto dele.
function link(cell) {
  const m = /<a\b[^>]*href="\/wiki\/([^"#?]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(cell) || /<a\b[^>]*title="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(cell);
  if (!m) return null;
  return { page: decodeURIComponent(m[1]).replace(/_/g, " "), text: text(m[2]) };
}
// Valor de uma célula que pode ser ícone: alt da imagem, title do link, ou o texto.
function iconValue(cell) {
  const alt = /<img\b[^>]*\balt="([^"]*)"/i.exec(cell);
  if (alt && alt[1].trim()) return decode(alt[1]).replace(/\s*\(TCG\)$/i, "").replace(/\s+\d+px$/, "").trim();
  const t = text(cell);
  if (t) return t;
  const ti = /<a\b[^>]*\btitle="([^"]*)"/i.exec(cell);
  return ti ? decode(ti[1]).replace(/\s*\(TCG\)$/i, "").trim() : "";
}
// Índice das colunas pelo texto do cabeçalho.
function columns(headerCells) {
  const h = headerCells.map((c) => text(c).toLowerCase());
  const find = (re) => h.findIndex((x) => re.test(x));
  return {
    no: find(/^(no\.?|#|number|card no\.?)$/), name: find(/name/), type: find(/^type$/), rarity: find(/rarit/), mark: find(/^mark$|regulation/)
  };
}

// ── Lista de set ────────────────────────────────────────────────────────────
// UMA lista por tabela da página que tenha cabeçalho com "Card name" e "No.":
// [{ cards: [{ number, en, page, type, rarity, mark }] }]. A página de uma
// expansão pode ter várias (a ocidental e a japonesa, galerias, secretas).
export function parseSetLists(html) {
  const out = [];
  for (const t of tables(html)) {
    const rs = rows(t);
    if (!rs.length) continue;
    const head = cells(rs[0]);
    if (!head.length) continue;
    const col = columns(head);
    if (col.name < 0 || col.no < 0) continue;
    const cards = [];
    for (const r of rs.slice(1)) {
      const tds = cells(r);
      if (tds.length <= Math.max(col.no, col.name)) continue;
      const number = (text(tds[col.no]).match(/[A-Za-z]*\d+[A-Za-z]?(?:\/[A-Za-z0-9-]+)?/) || [""])[0];
      const l = link(tds[col.name]);
      const en = l ? l.text : text(tds[col.name]);
      if (!number || !en) continue;
      cards.push({
        number, en, page: l ? l.page : "",
        type: col.type >= 0 && tds[col.type] != null ? iconValue(tds[col.type]) : "",
        rarity: col.rarity >= 0 && tds[col.rarity] != null ? iconValue(tds[col.rarity]) : "",
        mark: col.mark >= 0 && tds[col.mark] != null ? text(tds[col.mark]) : ""
      });
    }
    if (cards.length) out.push({ cards });
  }
  return out;
}
// Todas as listas achatadas (probe e compatibilidade).
export function parseSetList(html) {
  return parseSetLists(html).flatMap((l) => l.cards);
}
// A lista que É o set: pelo denominador do número ("001/066" -> 66 = total
// do set), senão a de contagem mais próxima da do chunk, senão a última (a
// japonesa vem depois da ocidental na página). null sem lista nenhuma.
export function escolherLista(listas, { total, count } = {}) {
  const ls = (listas || []).filter((l) => l && l.cards && l.cards.length);
  if (!ls.length) return null;
  if (ls.length === 1) return ls[0];
  const den = (n) => { const m = /\/\s*0*(\d+)\s*$/.exec(String(n || "")); return m ? Number(m[1]) : 0; };
  if (Number(total) > 0) {
    const casa = ls.map((l) => l.cards.filter((c) => den(c.number) === Number(total)).length / l.cards.length);
    const melhor = casa.indexOf(Math.max(...casa));
    if (casa[melhor] >= 0.5) return ls[melhor];
  }
  if (Number(count) > 0) {
    return ls.slice().sort((a, b) => Math.abs(a.cards.length - count) - Math.abs(b.cards.length - count))[0];
  }
  return ls[ls.length - 1];
}

// ── Página de carta ─────────────────────────────────────────────────────────
// { ja, romaji, artist, rarity, image } — cada um vazio quando não achado. O
// nome japonês é o primeiro trecho marcado lang="ja" da página (o wiki marca
// todo japonês assim); o ilustrador é o valor da linha "Illus."; a imagem é
// o primeiro upload do Archives (thumb vira o original — ver matriz do
// img-mirror). `preferEra`: quando a página lista várias impressões, o scan
// da impressão japonesa vem antes das ocidentais, então a primeira serve.
export function parseCardPage(html) {
  const h = String(html || "");
  const ja = /<[^>]+\blang="ja"[^>]*>([\s\S]*?)<\/[^>]+>/i.exec(h);
  const artist = /Illus(?:trator|\.)?\s*(?:<\/(?:th|b|strong|td|span)>)?[\s\S]{0,200}?<a\b[^>]*>([^<]+)<\/a>/i.exec(h);
  const rarity = /Rarity[\s\S]{0,300}?(?:<img\b[^>]*\balt="([^"]+)"|<a\b[^>]*\btitle="([^"]+)"[^>]*>([^<]*)<\/a>)/i.exec(h);
  // Scan = o primeiro .jpg do Archives: os ícones de tipo/raridade e os
  // símbolos de set são .png e vêm antes na página. Sem .jpg, nada — melhor
  // sem imagem do que com o ícone de Grama (foi o que saiu no 1º run).
  const uploads = [...h.matchAll(/(?:https?:)?\/\/archives\.bulbagarden\.net\/media\/upload\/[^"'\s]+\.(?:jpe?g|png|webp)/gi)]
    .map((m) => imagemOriginal(m[0].startsWith("//") ? `https:${m[0]}` : m[0]));
  const image = uploads.find((u) => /\.jpe?g$/i.test(u)) || "";
  return {
    ja: ja ? text(ja[1]) : "",
    artist: artist ? text(artist[1]) : "",
    rarity: rarity ? decode(rarity[1] || rarity[3] || rarity[2] || "").replace(/\s*\(TCG\)$/i, "").trim() : "",
    image
  };
}
export function imagemOriginal(u) {
  return String(u || "").replace(/\/media\/upload\/thumb\/([0-9a-f])\/([0-9a-f]{2})\/([^/]+)\/\d+px-[^/?#]+$/, "/media/upload/$1/$2/$3");
}

// ── Lista de expansões ──────────────────────────────────────────────────────
// { <nome japonês>: <nome traduzido> } das tabelas que têm "Japanese" e
// "Translated" (ou "English") no cabeçalho — é a coluna que o JA_SET_EN do
// shared.js copia verbatim.
export function parseExpansionList(html) {
  const out = {};
  for (const t of tables(html)) {
    const rs = rows(t);
    if (!rs.length) continue;
    const h = cells(rs[0], "th").map((c) => text(c).toLowerCase());
    const ja = h.findIndex((x) => /japanese/.test(x));
    const en = h.findIndex((x) => /translated|english/.test(x));
    if (ja < 0 || en < 0) continue;
    for (const r of rs.slice(1)) {
      const tds = cells(r, "td");
      if (tds.length <= Math.max(ja, en)) continue;
      const nomeJa = text(tds[ja]), nomeEn = text(tds[en]);
      if (nomeJa && nomeEn && !out[nomeJa]) out[nomeJa] = nomeEn;
    }
  }
  return out;
}
