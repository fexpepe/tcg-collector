// Espelha os SÍMBOLOS de set do Magic localmente. O Scryfall serve um ícone SVG
// por set (svgs.scryfall.io, sem rate limit) — é a identidade visual canônica
// de cada coleção (Magic não tem "logo" de set em imagem, só o símbolo). Como
// não dependem do catálogo de cartas, este script busca a LISTA de sets numa
// única chamada /sets e baixa os ícones direto do CDN — independente do
// sync-magic (que é lento por causa do rate limit da API de cartas).
//
// Os SVGs do Scryfall são silhuetas SEM fill (renderizam em preto). O tile de
// set do site tem fundo sempre escuro (.set-art) e o hero de detalhe é temático
// (--panel, claro ou escuro): nenhum preto nem branco serve nos dois. Então
// assamos um fill CINZA-MÉDIO (#9aa4b2), visível em qualquer fundo — o símbolo
// é um identificador discreto, não arte de destaque.
//
// Saída: data/magic/set-logos/<code>.svg. O sync-magic lê esta pasta e usa o
// símbolo local como setLogo quando existe. Idempotente (skip-if-exists).
//   node scripts/mirror-magic-set-logos.mjs [--force]
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchRetry, mapLimit, sleep, winSafeName } from "./lib/sync-common.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/magic/set-logos/", ROOT);
const HEADERS = { "User-Agent": "Sleevu/1.0 (https://sleevu.app)", Accept: "application/json" };
const FORCE = process.argv.includes("--force");
const FILL = "#9aa4b2";

// Assa um fill nos SVGs monocromáticos do Scryfall (paths sem fill herdam do
// <svg>). Idempotente: não duplica se já houver fill no elemento raiz.
function bakeFill(svg) {
  if (/<svg[^>]*\sfill=/.test(svg)) return svg;
  return svg.replace(/<svg\b/, `<svg fill="${FILL}"`);
}

async function run() {
  console.log("Magic: buscando símbolos de set (Scryfall /sets)…");
  let sets;
  try {
    const j = await (await fetchRetry("https://api.scryfall.com/sets", { headers: HEADERS })).json();
    sets = (j.data || []).filter((s) => s.code && s.icon_svg_uri);
  } catch (e) {
    console.warn(`  /sets inacessível (${e.message}) — nada a espelhar.`);
    return;
  }
  console.log(`  ${sets.length} sets com símbolo.`);

  await mkdir(OUT, { recursive: true });
  let ok = 0, skip = 0, fail = 0;
  await mapLimit(sets, 6, async (s) => {
    const dest = new URL(`${winSafeName(s.code)}.svg`, OUT);
    if (!FORCE && existsSync(dest)) { skip++; return; }
    try {
      const url = s.icon_svg_uri.replace(/\?.*$/, ""); // sem querystring de cache
      const r = await fetchRetry(url, { timeoutMs: 20000 });
      const svg = await r.text();
      if (!svg.includes("<svg")) { fail++; return; }
      await writeFile(dest, bakeFill(svg), "utf8");
      await sleep(40); // CDN sem rate limit, mas educado
      ok++;
    } catch { fail++; }
  });
  console.log(`  baixados: ${ok} · já existiam: ${skip} · falharam: ${fail}`);
  console.log(`Saída: ${fileURLToPath(OUT)} — commitar os arquivos novos.`);
}

await run();
