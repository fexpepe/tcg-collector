// Data de lançamento dos produtos do Duel Masters, pra onde o site oficial não
// publica: a página do produto (dm.takaratomy.co.jp/product/<slug>/) só traz
// 発売日 nos recentes (medido em 13/11/2026: DM23-SD1 e DM26-RP3 sim; DM-01,
// DM-39, DMR-01, DMRP-01, DMEX-01, DMBD-01 e DMX-01 não).
//
// Fonte: a wiki do Fandom (duelmasters.fandom.com), pela API pública do
// MediaWiki — a página de cada produto tem o campo "Release" na infobox. Quando
// existe a página "(OCG)", vale ela: a sem sufixo dos doze primeiros sets é a
// edição americana de 2004. Só entra data COMPLETA (dia, mês e ano); "March,
// 2004" não vira dia 1.
//
// Roda à mão, uma vez (e de novo se o snapshot precisar crescer). Grava
// scripts/data/duelmasters-datas.json, { "<valor do filtro oficial>": "AAAA-MM-DD" },
// que o sync-duelmasters.mjs lê. Produto novo não passa por aqui: o sync pega a
// data na página oficial.
//
//   node scripts/duelmasters-datas.mjs
import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sleep } from "./lib/sync-common.mjs";
import { parseProdutos, codigoETitulo } from "./sync-duelmasters.mjs";

const OUT = new URL("data/duelmasters-datas.json", import.meta.url);
const WIKI = "https://duelmasters.fandom.com/api.php";
const UA = "Mozilla/5.0 (compatible; Sleevu catalog sync; +https://sleevu.app)";
const MESES = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

const json = async (url) => (await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) })).json();
const iso = (a, m, d) => `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// "June 25, 2011", "25 June 2011", "2011-06-25", "2011年6月25日" -> ISO. Sem dia, "".
export function dataDoRelease(texto) {
  const t = String(texto || "").replace(/\[\[|\]\]|'''?/g, "");
  let m = /([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(t);
  if (m && MESES[m[1].toLowerCase()]) return iso(m[3], MESES[m[1].toLowerCase()], m[2]);
  m = /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Z][a-z]+),?\s+(\d{4})/.exec(t);
  if (m && MESES[m[2].toLowerCase()]) return iso(m[3], MESES[m[2].toLowerCase()], m[1]);
  m = /(\d{4})[-/.年]\s*(\d{1,2})[-/.月]\s*(\d{1,2})/.exec(t);
  return m ? iso(m[1], m[2], m[3]) : "";
}

// As páginas do produto entre os resultados da busca: começam pelo código e
// não são galeria, ciclo nem edição da CoroCoro. Os doze primeiros sets têm
// DUAS (a japonesa e a americana de 2004–2006, com títulos diferentes e sem
// sufixo fixo): quem chama fica com a data MAIS ANTIGA, que é a do Japão.
export function escolhePaginas(codigo, titulos) {
  return titulos.filter((t) => t.startsWith(codigo + " ") && !/Gallery|Cycle|CoroCoro Edition|\//.test(t)).slice(0, 3);
}

async function run() {
  const html = await (await fetch("https://dm.takaratomy.co.jp/card/", { headers: { "User-Agent": UA } })).text();
  const produtos = parseProdutos(html);
  const datas = existsSync(OUT) ? JSON.parse(await readFile(OUT, "utf8")) : {};
  let semPagina = 0, semData = 0;
  for (const p of produtos) {
    if (datas[p.valor]) continue;
    const [codigo] = codigoETitulo(p.rotulo);
    if (!codigo) continue;
    try {
      const busca = await json(`${WIKI}?action=query&list=search&srsearch=${encodeURIComponent(codigo)}&srlimit=20&format=json`);
      const paginas = escolhePaginas(codigo, ((busca.query && busca.query.search) || []).map((r) => r.title));
      await sleep(250);
      if (!paginas.length) { semPagina++; console.log(`  ${codigo}: sem página`); continue; }
      const achadas = [];
      for (const pagina of paginas) {
        const wt = await json(`${WIKI}?action=parse&page=${encodeURIComponent(pagina)}&prop=wikitext&format=json`);
        const texto = (wt.parse && wt.parse.wikitext && wt.parse.wikitext["*"]) || "";
        const campo = /\|\s*Release\s*=\s*([^\n|]*)/i.exec(texto);
        const d = dataDoRelease(campo ? campo[1] : "");
        if (d) achadas.push(d);
        await sleep(250);
      }
      const data = achadas.sort()[0] || "";
      if (!data) { semData++; console.log(`  ${codigo}: ${paginas.join(" | ")} sem data completa`); continue; }
      datas[p.valor] = data;
    } catch (e) { console.warn(`  ${codigo}: ${e.message}`); }
  }
  const ordenado = Object.fromEntries(Object.entries(datas).sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0])));
  await writeFile(OUT, JSON.stringify(ordenado, null, 1) + "\n", "utf8");
  console.log(`${Object.keys(ordenado).length} datas de ${produtos.length} produtos (${semPagina} sem página na wiki, ${semData} sem data completa).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
