// Listas de carta do 火の国庵 (hinokunian.konohashigure.com, site de fã de
// Naruto, parado desde 2006): a seção "カード・シール" tem uma página por
// produto, com número, nome e raridade de cada carta. É a única fonte aberta
// com a lista carta a carta dos colecionáveis japoneses de 2004–2005 (o
// Carddass Masters do filme, os Etching Card Collection e a 忍術大全): TCDB,
// Mandarake, Suruga-ya, Coleka e eBay barram acesso automatizado, e isso não
// se contorna (contrato 4 do docs/CATALOGO.md).
//
// Conferido em 2026-11-13: as páginas respondem 200 em http e https, em
// Shift-JIS, e o site não tem robots.txt. Não há imagem de carta lá.
//
// FORMATO DA PÁGINA (HTML de 2005, tabelas):
//   - uma tabela de resumo: "レアリティ | 数量" com uma linha por raridade
//     ("スペシャル | ９種類") e a "発売日";
//   - as tabelas de carta: cada linha tem a célula do número ("No.001",
//     "Pa.01", "V.01", "SP.1"), a do nome e, na 忍術大全, a de quem usa o
//     jutsu (術者名);
//   - entre as cartas, linhas de uma célula só que dão o grupo
//     ("劇場版キャラクターカード", "スペシャルカード").
// O resumo serve de autoconferência: o parse só vale se a contagem por
// prefixo bater com o que a própria página anuncia (confereLista).
import { decodeEntities, sleep } from "./sync-common.mjs";

export const HINOKUNIAN = "https://hinokunian.konohashigure.com/";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sleevu/1.0 (+sleevu.app)" };

// Prefixo do número -> como a página chama a raridade no resumo.
export const RARIDADE_DO_PREFIXO = { No: "ノーマル", Pa: "パラレル", V: "バラエティ", SP: "スペシャル" };

const texto = (html) => decodeEntities(String(html).replace(/<br[^>]*>/gi, " ").replace(/<[^>]+>/g, ""))
  .replace(/[\s　]+/g, " ").trim();
// Algarismo de largura cheia ("５４種類") -> número.
const numero = (s) => Number(String(s).normalize("NFKC").replace(/[^0-9]/g, "")) || 0;

// Página -> { titulo, data, quantidades, cartas }. `cartas` na ordem da
// página: { prefixo, num, nome, extra, grupo }, com `num` como a página
// escreve ("001", "46", "01") e `grupo` a última linha de grupo vista.
export function parseListaHinokunian(html) {
  const s = String(html);
  const titulo = texto((s.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) || [])[1] || "");
  const quantidades = {};
  let data = "";
  let grupo = "";
  const cartas = [];
  for (const tr of s.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cels = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => texto(c[1]));
    const i = cels.findIndex((c) => /^(No|Pa|V|SP)\.\s*\d+$/.test(c));
    if (i >= 0) {
      const m = cels[i].match(/^(No|Pa|V|SP)\.\s*(\d+)$/);
      cartas.push({ prefixo: m[1], num: m[2], nome: cels[i + 1] || "", extra: cels[i + 2] || "", grupo });
      continue;
    }
    const cheias = cels.filter(Boolean);
    if (cels.length === 2 && cheias.length === 2) {
      if (cels[0] === "発売日") data = cels[1];
      else if (/種類$/.test(cels[1])) quantidades[cels[0]] = numero(cels[1]);
    } else if (cheias.length === 1 && /カード$/.test(cheias[0]) && cheias[0].length <= 30) {
      grupo = cheias[0];
    }
  }
  return { titulo, data, quantidades, cartas };
}

// O que a página anuncia × o que o parse achou. Devolve a lista de diferenças
// (vazia = confere). Raridade anunciada sem quantidade ("スペシャル | " no
// Etching 1, que não tem especial) não conta.
export function confereLista(lista) {
  const achadas = {};
  for (const c of lista.cartas) {
    const r = RARIDADE_DO_PREFIXO[c.prefixo];
    achadas[r] = (achadas[r] || 0) + 1;
  }
  const erros = [];
  for (const r of new Set([...Object.keys(lista.quantidades), ...Object.keys(achadas)])) {
    const diz = lista.quantidades[r] || 0, tem = achadas[r] || 0;
    if (diz !== tem) erros.push(`${r}: a página diz ${diz}, o parse achou ${tem}`);
  }
  if (!lista.cartas.length) erros.push("nenhuma carta");
  if (lista.cartas.some((c) => !c.nome)) erros.push("carta sem nome");
  const chave = (c) => `${c.prefixo}.${c.num}`;
  if (new Set(lista.cartas.map(chave)).size !== lista.cartas.length) erros.push("número repetido");
  return erros;
}

// Baixa e lê uma página (`pagina` sem o .html). null = não respondeu, ou
// respondeu algo que não confere com o próprio resumo: quem chama fica com o
// snapshot versionado.
export async function baixaLista(pagina) {
  const url = `${HINOKUNIAN}${pagina}.html`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
      if (r.ok) {
        const lista = parseListaHinokunian(new TextDecoder("shift_jis").decode(await r.arrayBuffer()));
        const erros = confereLista(lista);
        if (!erros.length) return lista;
        console.log(`  ${pagina}: lista não confere (${erros.join("; ")})`);
        return null;
      }
    } catch (e) { /* tenta de novo */ }
    await sleep(1500 * (i + 1));
  }
  console.log(`  ${pagina}: inacessível`);
  return null;
}
