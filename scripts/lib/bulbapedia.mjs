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
// `nomes`: Map número comparável -> nome comparável do chunk (espécie ou nome
// ASCII, minúsculo). Desempata listas com o MESMO total — a página de um par
// de sets (Scarlet ex / Violet ex, Black/White Collection) tem uma tabela por
// metade, as duas com 001/078: sem os nomes, as duas metades recebiam a
// primeira tabela e a segunda entrava com as cartas da irmã.
export function escolherLista(listas, { total, count, nomes } = {}) {
  const ls = (listas || []).filter((l) => l && l.cards && l.cards.length);
  if (!ls.length) return null;
  if (ls.length === 1) return ls[0];
  const den = (n) => { const m = /\/\s*0*(\d+)\s*$/.exec(String(n || "")); return m ? Number(m[1]) : 0; };
  const numKey = (n) => String(n || "").split("/")[0].trim().toLowerCase().replace(/^([a-z]*)0+(?=\d)/, "$1");
  const concordancia = (l) => {
    if (!nomes || !nomes.size) return 0;
    let n = 0;
    for (const c of l.cards) { const alvo = nomes.get(numKey(c.number)); if (alvo && String(c.en || "").toLowerCase().includes(alvo)) n++; }
    return n;
  };
  if (Number(total) > 0) {
    const casa = ls.map((l) => l.cards.filter((c) => den(c.number) === Number(total)).length / l.cards.length);
    const candidatas = ls.map((l, i) => [l, casa[i]]).filter(([, r]) => r >= 0.5).map(([l]) => l);
    if (candidatas.length === 1) return candidatas[0];
    if (candidatas.length > 1) return candidatas.slice().sort((a, b) => concordancia(b) - concordancia(a))[0];
    // Total conhecido e NENHUMA lista com ele: a página não é deste set (título
    // errado, ou o set ocidental homônimo). Chutar pela contagem aqui gravaria
    // nome, raridade e ilustrador de OUTRO set por número — melhor sem lista.
    return null;
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
// { <nome japonês>: <nome traduzido> }. No wiki real (conferido em
// 21/09/2026) o nome japonês e a tradução vêm na MESMA célula da coluna
// "Japanese name" — `<span lang="ja">拡張パック</span> Expansion Pack` —, e
// não em duas colunas; lendo duas colunas o 1º run gravou "拡張パック
// Expansion Pack" como chave E valor, além de linhas de outras tabelas que
// também têm "Japanese" no cabeçalho (datas, contagens). Regra: o japonês é o
// trecho lang="ja" (ou o prefixo não-ASCII da célula), a tradução é o que
// sobra na célula — ou a coluna "Translated" quando ela existe separada. Só
// entra par com japonês de verdade de um lado e latim do outro.
const JP_CHARS = /[぀-ヿ一-鿿]/;
export function normalizarNomeJa(s) {
  return String(s || "").normalize("NFKC").replace(/\s+/g, "").replace(/[＆]/g, "&").toLowerCase();
}
// Mapa nome japonês NORMALIZADO -> tradução, a partir do _set-names.json. A
// lista do wiki junta os sets em PAR numa linha só ("一撃マスター • 連撃マスター"
// -> "Single Strike Master • Rapid Strike Master"): o par é aberto e cada
// metade vira uma entrada, quando os dois lados têm o mesmo número de partes.
export function mapaDeNomes(names) {
  const m = new Map();
  const partes = (s) => String(s || "").split(/\s*[•・]\s*/).map((x) => x.trim()).filter(Boolean);
  for (const [ja, en] of Object.entries(names || {})) {
    const js = partes(ja), es = partes(en);
    if (js.length > 1 && js.length === es.length) js.forEach((j, i) => { if (!m.has(normalizarNomeJa(j))) m.set(normalizarNomeJa(j), es[i]); });
    else if (js.length === 1 && es.length === 1 && !m.has(normalizarNomeJa(ja))) m.set(normalizarNomeJa(ja), en);
  }
  return m;
}
export function parseExpansionList(html) {
  const out = {};
  for (const t of tables(html)) {
    const rs = rows(t);
    if (!rs.length) continue;
    const h = cells(rs[0]).map((c) => text(c).toLowerCase());
    const ja = h.findIndex((x) => /japanese/.test(x));
    if (ja < 0) continue;
    // Só uma coluna "Translated" separada conta como tradução. "English
    // expansion/name" é OUTRA coisa — o set ocidental equivalente ("Base Set"
    // pra 拡張パック), e foi o que o 2º run gravou; o JA_SET_EN e o título da
    // página do wiki usam a tradução ("Expansion Pack"), que fica na mesma
    // célula do nome japonês.
    const en = h.findIndex((x, i) => i !== ja && /translated/.test(x));
    for (const r of rs.slice(1)) {
      const tds = cells(r);
      if (tds.length <= ja) continue;
      const cel = tds[ja];
      const todo = text(cel);
      const span = /<[^>]+\blang="ja"[^>]*>([\s\S]*?)<\/[^>]+>/i.exec(cel);
      let nomeJa = span ? text(span[1]) : (todo.match(/^[^\x00-\x7F]+(?:[^\x00-\x7F\s]|\s(?=[^\x00-\x7F]))*/) || [""])[0].trim();
      let nomeEn = en >= 0 && tds[en] != null ? text(tds[en]) : "";
      if (!nomeEn && nomeJa) nomeEn = todo.replace(nomeJa, "").trim();
      if (!nomeJa || !nomeEn || !JP_CHARS.test(nomeJa) || JP_CHARS.test(nomeEn)) continue;
      if (!out[nomeJa]) out[nomeJa] = nomeEn;
    }
  }
  return out;
}
