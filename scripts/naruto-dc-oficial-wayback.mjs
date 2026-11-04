// Data Carddass NARUTO — relê as listas OFICIAIS da Bandai no Wayback e grava
// o snapshot data/vintage/naruto-dc-oficial.json (Formation, Cross, promos do
// Card Battle e 疾風クリアカード da Mission). Roda À MÃO: a história acabou em
// 2010, as capturas são fixas (scripts/lib/naruto-dc-oficial.mjs) e o build só
// lê o snapshot. Rodar de novo só pra conferir ou trocar de captura.
//
//   node scripts/naruto-dc-oficial-wayback.mjs
//
// Cache em data/.cache/naruto-dc-oficial/ (fora do git): o Wayback cai várias
// vezes por dia ("Temporarily Offline", 504), e o que já veio não é baixado de
// novo. Não regride: se uma parte vier menor que a do snapshot, a do snapshot
// fica, com aviso.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  PAGINAS_FORMATION, PAGINAS_CROSS, PAGINA_CARD_BATTLE, PAGINA_CLEAR_MISSION, CROSS_DO_PDF_5, montaSnapshot
} from "./lib/naruto-dc-oficial.mjs";

const ROOT = new URL("../", import.meta.url);
const SNAP = new URL("data/vintage/naruto-dc-oficial.json", ROOT);
const CACHE = new URL("data/.cache/naruto-dc-oficial/", ROOT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Decodifica pelo meta charset: a Formation e o Card Battle são Shift-JIS, a
// Cross é UTF-8.
function decodifica(buf) {
  const cabeca = Buffer.from(buf.slice(0, 3000)).toString("latin1");
  const cs = (/charset=["']?([\w-]+)/i.exec(cabeca) || [])[1] || "utf-8";
  return new TextDecoder(/shift|sjis/i.test(cs) ? "shift_jis" : /euc/i.test(cs) ? "euc-jp" : "utf-8").decode(buf);
}

async function captura({ ts, url }) {
  const arquivo = new URL(createHash("md5").update(`${ts} ${url}`).digest("hex").slice(0, 16) + ".html", CACHE);
  try { return await readFile(arquivo, "utf8"); } catch { /* sem cache */ }
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(`http://web.archive.org/web/${ts}id_/${url}`, { signal: AbortSignal.timeout(60000) });
      const html = decodifica(new Uint8Array(await r.arrayBuffer()));
      if (r.ok && !html.slice(0, 2000).includes("Temporarily Offline")) {
        await mkdir(CACHE, { recursive: true });
        await writeFile(arquivo, html, "utf8");
        return html;
      }
    } catch { /* tenta de novo */ }
    await sleep(4000 * (i + 1));
  }
  console.log(`  falhou: ${ts} ${url}`);
  return "";
}

async function run() {
  console.log("Data Carddass NARUTO — listas oficiais no Wayback");
  const paginas = new Map();
  for (const p of [...PAGINAS_FORMATION, ...PAGINAS_CROSS, PAGINA_CARD_BATTLE, PAGINA_CLEAR_MISSION]) {
    paginas.set(p.url, await captura(p));
  }
  const novo = montaSnapshot(paginas);
  const antigo = JSON.parse(await readFile(SNAP, "utf8").catch(() => "null")) || {};
  const partes = ["formation", "cross", "cardBattlePromos", "missionClear"];
  for (const k of partes) {
    const antes = (antigo[k] || []).length;
    if (novo[k].length < antes) {
      console.log(`  ${k}: ${novo[k].length} cartas, o snapshot tem ${antes} — mantido o do snapshot.`);
      novo[k] = antigo[k];
    } else console.log(`  ${k}: ${novo[k].length} cartas.`);
  }
  const fontes = [...PAGINAS_FORMATION, ...PAGINAS_CROSS, CROSS_DO_PDF_5.fonte, PAGINA_CARD_BATTLE, PAGINA_CLEAR_MISSION]
    .map(({ ts, url }) => `${ts} ${url}`);
  const snap = {
    _: "Listas oficiais da Bandai no Wayback Machine (scripts/lib/naruto-dc-oficial.mjs). Gerado por scripts/naruto-dc-oficial-wayback.mjs; não editar à mão.",
    updatedAt: new Date().toISOString().slice(0, 10),
    fontes,
    ...Object.fromEntries(partes.map((k) => [k, novo[k]]))
  };
  await writeFile(SNAP, JSON.stringify(snap, null, 1) + "\n", "utf8");
  console.log(`Gravado em ${fileURLToPath(SNAP)}.`);
}

await run();
